import fs from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";
import { COL, getStore } from "./store";
import type { PublishHistoryEntry, PublishState, StudioArticle } from "./types";
import { studioEnv } from "./env";
import { publishBlockers } from "./articles";
import { citedNumbers } from "./markdown";
import { STRATEGIES } from "./strategies";
import { addToDay, logActivity, notify } from "./ops";
import { deploymentFor, triggerRedeploy, verifyPublicArticle } from "./deploy";
import { errorMessage, nowIso, sha256 } from "./util";

type Row = StudioArticle & Record<string, unknown>;

/**
 * Publishing pipeline:
 *   approval → validation → Markdown file → GitHub commit → production
 *   deployment → public verification → "published".
 *
 * An article is only marked published when its production page is reachable
 * and shows the exact content version (content key) that was committed.
 * Every step is idempotent: unchanged content makes no new commit.
 */

const DEPLOY_TIMEOUT_MS = 30 * 60_000;

export interface PublishTargets {
  github: ReturnType<typeof studioEnv.github>;
  localFiles: boolean;
  siteRecord: boolean;
}

export function publishTargets(): PublishTargets {
  const github = studioEnv.github();
  let kind = "none";
  try {
    kind = getStore().kind;
  } catch {
    /* not configured */
  }
  return { github, localFiles: !github && !studioEnv.isVercel(), siteRecord: kind === "firestore" };
}

export function articleFilePath(slug: string, dir = "content/insights") {
  return `${dir.replace(/\/+$/, "")}/${slug}.md`;
}

export function contentKeyOf(a: StudioArticle): string {
  return sha256(
    JSON.stringify([a.title, a.slug, a.excerpt, a.body, a.category, a.countryId, a.academicYear ?? null, a.seoTitle, a.metaDescription, a.tags, a.coverImage ?? null, a.cta ?? null, a.sources, a.relatedSlugs]),
  ).slice(0, 24);
}

export function buildMarkdownFile(a: StudioArticle, publishedAt: string, updatedAt = publishedAt): string {
  const fm: Record<string, unknown> = {
    id: a.id,
    contentKey: contentKeyOf(a),
    title: a.title,
    slug: a.slug,
    excerpt: a.excerpt,
    category: a.category,
    categoryLabel: STRATEGIES[a.category]?.label ?? "Insights",
    country: a.countryId,
    academicYear: a.academicYear ?? null,
    seoTitle: a.seoTitle || a.title,
    metaDescription: a.metaDescription || a.excerpt,
    tags: a.tags,
    publishedAt,
    updatedAt,
    lastVerified: (a.sources.map((s) => s.accessedAt).filter(Boolean).sort().pop() as string | undefined) ?? publishedAt.slice(0, 10),
    readingMinutes: a.readingMinutes,
    coverImage: a.coverImage ? { url: a.coverImage.url, cardUrl: a.coverImage.cardUrl ?? null, alt: a.coverImage.alt, caption: a.coverImage.caption ?? null, credit: a.coverImage.credit ?? null, license: a.coverImage.license ?? null, sourceUrl: a.coverImage.sourceUrl ?? null } : null,
    cta: a.cta ? { text: a.cta.text, label: a.cta.label } : null,
    sources: a.sources,
    relatedSlugs: a.relatedSlugs,
    origin: a.origin,
  };
  return matter.stringify(`${a.body.trim()}\n`, JSON.parse(JSON.stringify(fm)));
}

/* ───────────── Validation ───────────── */

export async function validateForPublish(a: StudioArticle, opts: { checkImage?: boolean } = {}): Promise<string[]> {
  const problems = publishBlockers(a);
  const cited = citedNumbers(a.body);
  const ns = new Set(a.sources.map((s) => s.n));
  const broken = cited.filter((n) => !ns.has(n));
  if (broken.length) problems.push(`Citations [${broken.join(", ")}] have no matching source.`);
  if (a.sources.some((s) => !/^https?:\/\//.test(s.url))) problems.push("Every source needs a valid http(s) URL.");
  if (!a.seoTitle.trim() || a.seoTitle.length > 70) problems.push("SEO title must be 1–70 characters.");
  if (!a.metaDescription.trim() || a.metaDescription.length > 170) problems.push("Meta description must be 1–170 characters.");
  const published = (await getStore().list<Row>(COL.articles)).filter((x) => x.id !== a.id && ["published", "publishing"].includes(x.status) && x.slug === a.slug);
  if (published.length) problems.push(`Slug "${a.slug}" is already used by a published article.`);
  if (opts.checkImage !== false && a.coverImage?.url && /^https?:\/\//.test(a.coverImage.url)) {
    try {
      const res = await fetch(a.coverImage.url, { method: "HEAD", signal: AbortSignal.timeout(15_000), cache: "no-store" });
      if (!res.ok) problems.push(`Cover image is not reachable (HTTP ${res.status}).`);
    } catch (err) {
      problems.push(`Cover image could not be checked: ${errorMessage(err)}`);
    }
  }
  return problems;
}

/* ───────────── GitHub ───────────── */

async function gh(pathname: string, init?: RequestInit & { token: string }) {
  return fetch(`https://api.github.com${pathname}`, {
    ...init,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${init?.token}`,
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "skolar-studio",
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
    },
    signal: AbortSignal.timeout(30_000),
    cache: "no-store",
  });
}

export async function githubPutFile(cfg: NonNullable<PublishTargets["github"]>, filePath: string, content: string, message: string): Promise<{ commitSha: string | null; unchanged: boolean }> {
  const encPath = filePath.split("/").map(encodeURIComponent).join("/");
  const get = await gh(`/repos/${cfg.repo}/contents/${encPath}?ref=${encodeURIComponent(cfg.branch)}`, { token: cfg.token });
  let sha: string | undefined;
  if (get.ok) {
    const cur = (await get.json()) as { sha: string; content?: string; encoding?: string };
    sha = cur.sha;
    const existing = cur.content && cur.encoding === "base64" ? Buffer.from(cur.content, "base64").toString("utf8") : null;
    if (existing === content) return { commitSha: null, unchanged: true };
  } else if (get.status !== 404) {
    throw new Error(`GitHub read failed (${get.status}): ${(await get.text()).slice(0, 200)}`);
  }
  const put = await gh(`/repos/${cfg.repo}/contents/${encPath}`, {
    token: cfg.token,
    method: "PUT",
    body: JSON.stringify({ message, content: Buffer.from(content, "utf8").toString("base64"), branch: cfg.branch, ...(sha ? { sha } : {}) }),
  });
  if (!put.ok) throw new Error(`GitHub commit failed (${put.status}): ${(await put.text()).slice(0, 300)}`);
  const out = (await put.json()) as { commit?: { sha?: string } };
  return { commitSha: out.commit?.sha ?? null, unchanged: false };
}

/** Latest commit that touched a path (used when content was already committed earlier). */
async function lastCommitFor(cfg: NonNullable<PublishTargets["github"]>, filePath: string): Promise<string | null> {
  const res = await gh(`/repos/${cfg.repo}/commits?path=${encodeURIComponent(filePath)}&sha=${encodeURIComponent(cfg.branch)}&per_page=1`, { token: cfg.token });
  if (!res.ok) return null;
  const list = (await res.json()) as Array<{ sha: string }>;
  return list[0]?.sha ?? null;
}

export async function githubCheck(): Promise<{ ok: boolean; message: string }> {
  const cfg = studioEnv.github();
  if (!cfg) return { ok: false, message: "Set GITHUB_TOKEN and GITHUB_REPO (owner/name)." };
  const res = await gh(`/repos/${cfg.repo}`, { token: cfg.token });
  if (!res.ok) return { ok: false, message: `GitHub ${res.status}: ${(await res.text()).slice(0, 160)}` };
  const repo = (await res.json()) as { full_name: string; permissions?: { push?: boolean } };
  if (repo.permissions && !repo.permissions.push) return { ok: false, message: `Token can read ${repo.full_name} but cannot push.` };
  const br = await gh(`/repos/${cfg.repo}/branches/${encodeURIComponent(cfg.branch)}`, { token: cfg.token });
  if (!br.ok) return { ok: false, message: `Branch ${cfg.branch} not found in ${repo.full_name}.` };
  return { ok: true, message: `Connected to ${repo.full_name} (branch ${cfg.branch}, push allowed)` };
}

/* ───────────── Cache refresh ───────────── */

export type Revalidator = (paths: string[]) => Promise<void>;

export const httpRevalidate: Revalidator = async () => {
  const secret = studioEnv.revalidateSecret();
  if (!secret) return;
  try {
    await fetch(`${studioEnv.siteUrl()}/api/revalidate`, { method: "POST", headers: { "x-revalidate-secret": secret }, signal: AbortSignal.timeout(15_000) });
  } catch {
    /* ISR refreshes within 5 minutes anyway */
  }
};

/* ───────────── Publish (commit) ───────────── */

export class PublishError extends Error {}

function history(cur: Row, e: Omit<PublishHistoryEntry, "at">): PublishHistoryEntry[] {
  return [...(cur.publishHistory ?? []), { at: nowIso(), ...e }].slice(-50);
}

async function patch(id: string, fn: (cur: Row) => Partial<StudioArticle>): Promise<StudioArticle | null> {
  return getStore().transact<Row>(COL.articles, id, (cur) => (cur ? ({ ...cur, ...fn(cur), updatedAt: nowIso() } as Row) : undefined));
}

/**
 * Commits the approved article. Afterwards the article is "publishing" until
 * advancePublishing() confirms the deployment and the live page.
 */
export async function publishArticle(id: string, opts: { actor: "admin" | "worker"; revalidate?: Revalidator; reason?: string; skipImageCheck?: boolean }): Promise<StudioArticle> {
  const store = getStore();
  const current = await store.get<Row>(COL.articles, id);
  if (!current) throw new PublishError("Article not found.");
  if (!["approved", "scheduled", "published", "publishing"].includes(current.status)) throw new PublishError("Only approved articles can be published. Approve it first.");
  const problems = await validateForPublish(current, { checkImage: !opts.skipImageCheck });
  if (problems.length) {
    await patch(id, (cur) => ({ publish: { ...(cur.publish ?? { attempts: 0 }), state: "failed", failedStep: "validation", lastError: problems.join(" "), lastAttemptAt: nowIso() } as PublishState, publishHistory: history(cur, { action: "failed", message: `Validation: ${problems.join(" ")}` }) }));
    throw new PublishError(problems.join(" "));
  }

  // Lock against double publishing (two tabs, worker + admin, cron).
  const lockUntil = new Date(Date.now() + 5 * 60_000).toISOString();
  let locked = false;
  await store.transact<Row>(COL.articles, id, (a) => {
    if (!a) return undefined;
    if (a.publish?.lockUntil && Date.parse(a.publish.lockUntil) > Date.now()) return undefined;
    locked = true;
    return { ...a, publish: { ...(a.publish ?? { attempts: 0 }), lockUntil, attempts: (a.publish?.attempts ?? 0) + 1, lastAttemptAt: nowIso() } as PublishState } as Row;
  });
  if (!locked) throw new PublishError("This article is already being published.");

  const a = (await store.get<Row>(COL.articles, id))!;
  const targets = publishTargets();
  const isUpdate = a.status === "published";
  const publishedAt = a.publish?.publishedAt ?? a.publish?.fileDate ?? nowIso();
  const dir = targets.github?.dir ?? "content/insights";
  const filePath = articleFilePath(a.slug, dir);
  const contentKey = contentKeyOf(a);
  const contentUpdatedAt = a.publish?.contentKey === contentKey ? a.publish.contentUpdatedAt ?? publishedAt : a.publish?.fileDate ? nowIso() : publishedAt;
  const file = buildMarkdownFile(a, publishedAt, contentUpdatedAt);

  try {
    let commitSha = a.publish?.commitSha;
    let state: PublishState["state"];
    let entry: Omit<PublishHistoryEntry, "at">;
    if (targets.github) {
      const r = await githubPutFile(targets.github, filePath, file, `${isUpdate ? "Update" : "Publish"} insight: ${a.title}`);
      if (r.commitSha) commitSha = r.commitSha;
      else if (!commitSha || a.publish?.contentKey !== contentKey) commitSha = (await lastCommitFor(targets.github, filePath)) ?? commitSha;
      entry = r.unchanged ? { action: "no_change", message: "Content already in the repository — no new commit.", commitSha } : { action: "commit", message: `Committed ${filePath}`, commitSha };
      state = "deploying";
    } else if (targets.localFiles) {
      const abs = path.join(studioEnv.projectRoot(), ...filePath.split("/"));
      await fs.mkdir(path.dirname(abs), { recursive: true });
      const existing = await fs.readFile(abs, "utf8").catch(() => null);
      if (existing !== file) await fs.writeFile(abs, file, "utf8");
      entry = { action: "local_file", message: `Wrote ${filePath} locally (GitHub not configured). Commit and push it to deploy.` };
      state = "awaiting_push";
    } else {
      throw new PublishError("No publishing target: configure GITHUB_TOKEN and GITHUB_REPO.");
    }

    const saved = await patch(id, (cur) => ({
      status: isUpdate ? "published" : "publishing",
      publish: {
        ...(cur.publish ?? { attempts: 1 }),
        state,
        isUpdate,
        failedStep: undefined,
        lockUntil: undefined,
        lastError: undefined,
        commitSha,
        committedAt: entry.action === "commit" ? nowIso() : cur.publish?.committedAt ?? nowIso(),
        repo: targets.github?.repo,
        branch: targets.github?.branch,
        path: filePath,
        url: `/insights/${a.slug}`,
        contentHash: sha256(file),
        contentKey,
        contentUpdatedAt,
        target: targets.github ? "github" : "local-file",
        deploymentId: entry.action === "commit" ? undefined : cur.publish?.deploymentId,
        deployment: state === "awaiting_push" ? "Waiting for git push + deployment" : "Waiting for deployment",
        publishedAt: cur.publish?.publishedAt,
        fileDate: publishedAt,
        verifiedAt: undefined,
      } as PublishState,
      schedule: cur.schedule ? { ...cur.schedule, history: [...cur.schedule.history, { at: nowIso(), from: cur.schedule.at, to: null, reason: opts.reason ?? (opts.actor === "worker" ? "Published on schedule" : "Published manually") }] } : cur.schedule,
      publishHistory: history(cur, entry),
    }));
    await logActivity(opts.actor, "article.publish_started", `${isUpdate ? "Update" : "Publish"} started: ${a.title} — ${entry.message}`, id);
    // Try to confirm straight away (the deployment usually takes a minute or two).
    return (await advanceOne(id, opts.revalidate)) ?? saved!;
  } catch (err) {
    const message = errorMessage(err);
    await patch(id, (cur) => ({ publish: { ...(cur.publish ?? { attempts: 1 }), state: "failed", failedStep: "commit", lockUntil: undefined, lastError: message } as PublishState, publishHistory: history(cur, { action: "failed", message: `Commit: ${message}` }) }));
    await notify({ kind: "publish_failed", level: "error", title: "Publishing failed", body: `${a.title}: ${message}`, href: `/admin/articles/${id}` }, { dedupeKey: `publish-failed-${id}` });
    throw err instanceof PublishError ? err : new PublishError(message);
  }
}

/* ───────────── Deployment & verification ───────────── */

async function markPublished(id: string, revalidate?: Revalidator): Promise<StudioArticle | null> {
  const store = getStore();
  const a = await store.get<Row>(COL.articles, id);
  if (!a) return null;
  const now = nowIso();
  const publishedAt = a.publish?.publishedAt ?? now;
  if (publishTargets().siteRecord) {
    await store.set(COL.siteArticles, `studio-${a.id}`, {
      title: a.title,
      excerpt: a.excerpt,
      category: STRATEGIES[a.category]?.label ?? "Insights",
      coverImageUrl: a.coverImage?.cardUrl ?? a.coverImage?.url ?? "",
      coverImageAlt: a.coverImage?.alt ?? "",
      publishedAt,
      readingMinutes: a.readingMinutes,
      url: `/insights/${a.slug}`,
      slug: a.slug,
      featured: false,
      status: "published",
      source: "studio",
      updatedAt: now,
    });
  }
  await (revalidate ?? httpRevalidate)(["/", "/insights", `/insights/${a.slug}`]);
  const saved = await patch(id, (cur) => ({
    status: "published",
    publish: { ...cur.publish!, state: "published", publishedAt, verifiedAt: now, deployment: cur.publish?.deployment ?? "verified", lastError: undefined, failedStep: undefined },
    publishHistory: history(cur, { action: "verified", message: `Verified live at ${studioEnv.siteUrl()}/insights/${cur.slug}`, commitSha: cur.publish?.commitSha, deploymentId: cur.publish?.deploymentId }),
  }));
  if (!a.publish?.isUpdate) await addToDay("publishedIds", id);
  await logActivity("system", "article.published", `Published and verified: ${a.title}`, id);
  await notify({ kind: "published", level: "success", title: a.publish?.isUpdate ? "Article update is live" : "Article is live", body: a.title, href: `/admin/articles/${id}` }, { dedupeKey: `published-${id}-${a.publish?.contentKey ?? ""}` });
  return saved;
}

/** Advances one article in deploying/verifying/awaiting_push. Returns the updated article. */
export async function advanceOne(id: string, revalidate?: Revalidator): Promise<StudioArticle | null> {
  const store = getStore();
  const a = await store.get<Row>(COL.articles, id);
  const p = a?.publish;
  if (!a || !p || !["deploying", "verifying", "awaiting_push"].includes(p.state)) return a;

  if (p.state === "deploying" && p.commitSha) {
    const d = await deploymentFor(p.commitSha);
    if (d.id && d.id !== p.deploymentId) {
      await patch(id, (cur) => ({ publishHistory: history(cur, { action: "deployment", message: d.message, deploymentId: d.id, commitSha: p.commitSha }) }));
    }
    if (d.state === "error" || d.state === "canceled") {
      await patch(id, (cur) => ({ publish: { ...cur.publish!, state: "failed", failedStep: "deployment", deploymentId: d.id, deploymentProvider: d.provider, deploymentUrl: d.url, deployment: d.state, lastError: d.message }, publishHistory: history(cur, { action: "failed", message: `Deployment ${d.state}: ${d.message}`, deploymentId: d.id }) }));
      await notify({ kind: "publish_failed", level: "error", title: "Deployment failed", body: `${a.title}: ${d.message}`, href: `/admin/articles/${id}` }, { dedupeKey: `deploy-failed-${id}-${p.commitSha}` });
      return store.get<Row>(COL.articles, id);
    }
    await patch(id, (cur) => ({ publish: { ...cur.publish!, deploymentId: d.id ?? cur.publish?.deploymentId, deploymentProvider: d.provider, deploymentUrl: d.url, deployment: d.message, state: d.state === "ready" || d.provider === "none" ? "verifying" : "deploying" } }));
  }

  const fresh = (await store.get<Row>(COL.articles, id))!;
  if (["verifying", "awaiting_push"].includes(fresh.publish!.state)) {
    const v = await verifyPublicArticle(fresh.slug, fresh.publish!.contentKey ?? contentKeyOf(fresh));
    if (v.ok) return markPublished(id, revalidate);
    const since = Date.parse(fresh.publish!.committedAt ?? fresh.publish!.lastAttemptAt ?? nowIso());
    if (fresh.publish!.state === "verifying" && Date.now() - since > DEPLOY_TIMEOUT_MS) {
      await patch(id, (cur) => ({ publish: { ...cur.publish!, state: "failed", failedStep: "verification", lastError: v.message }, publishHistory: history(cur, { action: "failed", message: `Not verified after 30 min: ${v.message}` }) }));
      await notify({ kind: "publish_failed", level: "error", title: "Published article not verified", body: `${fresh.title}: ${v.message}`, href: `/admin/articles/${id}` }, { dedupeKey: `verify-failed-${id}-${fresh.publish!.contentKey}` });
    } else {
      await patch(id, (cur) => ({ publish: { ...cur.publish!, lastError: v.message, deployment: cur.publish?.state === "awaiting_push" ? "Waiting for git push + deployment" : cur.publish?.deployment } }));
    }
  }
  return store.get<Row>(COL.articles, id);
}

/** Called by the leader worker and the cron endpoint. */
export async function advancePublishing(revalidate?: Revalidator): Promise<number> {
  const rows = await getStore().list<Row>(COL.articles);
  let n = 0;
  for (const a of rows) {
    if (a.publish && ["deploying", "verifying", "awaiting_push"].includes(a.publish.state)) {
      await advanceOne(a.id, revalidate).catch(() => undefined);
      n++;
    }
  }
  return n;
}

/**
 * Retry after a failure. Unchanged content that is already committed is not
 * committed again: the deployment is re-triggered (deploy hook) or simply
 * re-checked; otherwise the commit step is retried.
 */
export async function retryPublish(id: string, revalidate?: Revalidator): Promise<StudioArticle | null> {
  const a = await getStore().get<Row>(COL.articles, id);
  if (!a?.publish) throw new PublishError("Nothing to retry.");
  const committed = a.publish.commitSha && a.publish.contentKey === contentKeyOf(a) && a.publish.failedStep !== "commit" && a.publish.failedStep !== "validation";
  if (committed) {
    const hook = a.publish.failedStep === "deployment" ? await triggerRedeploy() : { ok: true, message: "Re-checking deployment" };
    await patch(id, (cur) => ({
      publish: { ...cur.publish!, state: "deploying", failedStep: undefined, lastError: hook.ok ? undefined : hook.message, committedAt: nowIso() },
      publishHistory: history(cur, { action: hook.ok && a.publish?.failedStep === "deployment" ? "redeploy" : "retry", message: hook.message, commitSha: cur.publish?.commitSha }),
    }));
    return advanceOne(id, revalidate);
  }
  return publishArticle(id, { actor: "admin", revalidate, reason: "Retry" });
}

/** Back-compat for the worker loop. */
export async function refreshDeployments(): Promise<number> {
  return advancePublishing();
}
