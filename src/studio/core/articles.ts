import { COL, getStore } from "./store";
import type { ArticleStatus, StudioArticle, StudioSettings, StudioTopic } from "./types";
import { hasBlockingWarnings, lintArticle, verifyClaims } from "./safety";
import { newId, nowIso, readingMinutes, similarity, slugify, wordCount } from "./util";
import { STRATEGIES } from "./strategies";

type Row = StudioArticle & Record<string, unknown>;

export async function listArticles(): Promise<StudioArticle[]> {
  const rows = await getStore().list<Row>(COL.articles);
  return rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function getArticle(id: string): Promise<StudioArticle | null> {
  return getStore().get<Row>(COL.articles, id);
}

export class ConflictError extends Error {}
export class NotFoundError extends Error {}

/** Saves with optimistic concurrency: `expectedVersion` must match the stored version. */
export async function updateArticle(
  id: string,
  patch: Partial<StudioArticle>,
  opts?: { expectedVersion?: number },
): Promise<StudioArticle> {
  const out = await getStore().transact<Row>(COL.articles, id, (cur) => {
    if (!cur) throw new NotFoundError("Article not found.");
    if (opts?.expectedVersion !== undefined && cur.version !== opts.expectedVersion) {
      throw new ConflictError("This article was changed elsewhere (another tab or the worker). Reload to see the latest version.");
    }
    const next = { ...cur, ...patch, id, version: cur.version + 1, updatedAt: nowIso() } as Row;
    if (patch.body !== undefined) next.readingMinutes = readingMinutes(next.body);
    return next;
  });
  return out!;
}

export async function uniqueSlug(base: string, excludeId?: string): Promise<string> {
  const rows = await getStore().list<Row>(COL.articles);
  const taken = new Set(rows.filter((r) => r.id !== excludeId).map((r) => r.slug));
  let slug = slugify(base) || "article";
  let n = 2;
  while (taken.has(slug)) slug = `${slugify(base)}-${n++}`;
  return slug;
}

export function blankArticle(partial: Partial<StudioArticle> & { title: string }): StudioArticle {
  const now = nowIso();
  return {
    id: partial.id ?? newId("art"),
    slug: partial.slug ?? slugify(partial.title),
    title: partial.title,
    excerpt: partial.excerpt ?? "",
    body: partial.body ?? "",
    category: partial.category ?? "other",
    countryId: partial.countryId ?? "it",
    universityIds: partial.universityIds ?? [],
    scholarshipIds: partial.scholarshipIds ?? [],
    audience: partial.audience ?? STRATEGIES[partial.category ?? "other"].audience,
    academicYear: partial.academicYear,
    seoTitle: partial.seoTitle ?? partial.title.slice(0, 60),
    metaDescription: partial.metaDescription ?? "",
    readingMinutes: readingMinutes(partial.body ?? ""),
    tags: partial.tags ?? [],
    coverImage: partial.coverImage,
    cta: partial.cta,
    sources: partial.sources ?? [],
    facts: partial.facts ?? [],
    claims: partial.claims ?? [],
    warnings: partial.warnings ?? [],
    relatedSlugs: partial.relatedSlugs ?? [],
    status: partial.status ?? "draft",
    origin: partial.origin ?? "manual",
    jobId: partial.jobId,
    topicId: partial.topicId,
    version: 1,
    createdAt: now,
    updatedAt: now,
  };
}

/* ───────────── Checks (shared by AI and manual articles) ───────────── */

export function runChecks(a: StudioArticle, settings: StudioSettings) {
  const claims = verifyClaims(a.body, a.facts, a.sources);
  const ruleWarnings = lintArticle({
    title: a.title,
    body: a.body,
    category: a.category,
    academicYear: a.academicYear,
    claims,
    sources: a.sources,
  });
  // keep AI review warnings whose excerpt still exists in the text
  const aiWarnings = a.warnings.filter((w) => w.origin === "ai" && (!w.excerpt || a.body.includes(w.excerpt.slice(0, 60))));
  const pipelineWarnings = a.warnings.filter((w) => w.origin === "pipeline");
  const warnings = [...ruleWarnings, ...aiWarnings, ...pipelineWarnings];
  const reasons: string[] = [];
  const words = wordCount(a.body);
  if (words < settings.automation.minWords) reasons.push(`Only ${words} words (minimum ${settings.automation.minWords}).`);
  if (a.origin === "ai" && a.sources.length < settings.automation.minSourcesForDraft) {
    reasons.push(`Only ${a.sources.length} usable source(s) (minimum ${settings.automation.minSourcesForDraft}).`);
  }
  if (hasBlockingWarnings(warnings)) reasons.push("Has blocking editorial warnings.");
  const verified = claims.filter((c) => c.status === "verified" || c.status === "partially_verified").length;
  if (a.origin === "ai" && claims.length >= 4 && verified / claims.length < 0.5) {
    reasons.push(`Only ${verified} of ${claims.length} factual claims are supported by sources.`);
  }
  return { claims, warnings, qualityGate: { passed: reasons.length === 0, reasons, checkedAt: nowIso() } };
}

/** Problems that prevent publishing (independent of the AI quality gate). */
export function publishBlockers(a: StudioArticle): string[] {
  const out: string[] = [];
  if (!a.title.trim()) out.push("Title is missing.");
  if (!a.slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(a.slug)) out.push("Slug must use lowercase letters, numbers and hyphens.");
  if (!a.excerpt.trim()) out.push("Excerpt is missing.");
  if (wordCount(a.body) < 150) out.push("Article body is too short.");
  if (!a.coverImage?.url) out.push("Featured image is missing.");
  else if (!a.coverImage.alt.trim()) out.push("Featured image needs alt text.");
  if (hasBlockingWarnings(a.warnings)) out.push("Resolve the blocking editorial warnings first.");
  return out;
}

/* ───────────── Duplicate detection ───────────── */

export interface DuplicateHit {
  kind: "article" | "topic";
  id: string;
  title: string;
  similarity: number;
  status: string;
}

const LIVE: ArticleStatus[] = ["researching", "draft", "needs_review", "approved", "scheduled", "published"];

export async function findDuplicates(title: string, opts?: { excludeArticleId?: string; excludeTopicId?: string; threshold?: number }) {
  const threshold = opts?.threshold ?? 0.5;
  const hits: DuplicateHit[] = [];
  const articles = await getStore().list<Row>(COL.articles);
  for (const a of articles) {
    if (a.id === opts?.excludeArticleId || !LIVE.includes(a.status)) continue;
    const s = Math.max(similarity(title, a.title), slugify(title) === a.slug ? 1 : 0);
    if (s >= threshold) hits.push({ kind: "article", id: a.id, title: a.title, similarity: s, status: a.status });
  }
  const topics = await getStore().list<StudioTopic & Record<string, unknown>>(COL.topics);
  for (const t of topics) {
    // "used" topics already became articles, which are checked above.
    if (t.id === opts?.excludeTopicId || t.status === "dismissed" || t.status === "used") continue;
    const s = similarity(title, t.title);
    if (s >= threshold) hits.push({ kind: "topic", id: t.id, title: t.title, similarity: s, status: t.status });
  }
  // Published articles that live only on the site (manually created in the old admin)
  try {
    const site = await getStore().list<{ title?: string } & Record<string, unknown>>(COL.siteArticles);
    for (const s of site) {
      if (!s.title || articles.some((a) => a.publish?.url && String(s.id) === `studio-${a.id}`)) continue;
      const sim = similarity(title, String(s.title));
      if (sim >= threshold) hits.push({ kind: "article", id: String(s.id), title: String(s.title), similarity: sim, status: "published (site)" });
    }
  } catch {
    /* siteArticles not reachable in local mode */
  }
  return hits.sort((a, b) => b.similarity - a.similarity);
}
