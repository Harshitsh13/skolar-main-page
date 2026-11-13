import "server-only";
import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { isAdminAuthenticated } from "@/lib/admin-auth";
import { imageCredits } from "@/content/credits";
import { COL, getStore, storeInfo, StoreNotConfiguredError } from "../core/store";
import type {
  ArticleSource,
  CategoryKey,
  DailyStats,
  ProviderConfig,
  SourceCategory,
  StudioArticle,
  StudioCountry,
  StudioNotification,
  StudioRegion,
  StudioScholarship,
  StudioSource,
  StudioUniversity,
  UsageDay,
} from "../core/types";
import { CATEGORY_KEYS, STRATEGIES } from "../core/strategies";
import { getSettings, saveSettings, ValidationError } from "../core/settings";
import {
  blankArticle,
  ConflictError,
  findDuplicates,
  getArticle,
  listArticles,
  NotFoundError,
  publishBlockers,
  runChecks,
  uniqueSlug,
  updateArticle,
} from "../core/articles";
import { addToDay, getDay, logActivity, recentActivity, todayKey } from "../core/ops";
import { listJobs, getJob, createJob, controlJob, ACTIVE } from "../core/jobs";
import { STAGE_LABELS, writeSection, relatedFor } from "../core/pipeline";
import { addCitationsFromEvidence } from "../core/citations";
import { addTopic, discoverTopics, listTopics, updateTopic } from "../core/topics";
import { checkSource, listChanges } from "../core/monitor";
import {
  listCountries,
  listRegions,
  listScholarships,
  listSources,
  listUniversities,
  seedItaly,
} from "../core/entities";
import { listProviders, PROVIDER_PRESETS, testProvider, NoProviderAvailableError } from "../core/ai";
import { canEncrypt, encryptSecret, keyHint } from "../core/secrets";
import { publishArticle, publishTargets, githubCheck, PublishError } from "../core/publish";
import { applyCompaction, cancelSchedule, previewSlot, proposeCompaction, publishDue, scheduleArticle, ScheduleError, swapSlots } from "../core/schedule";
import { ALLOWED_IMAGE_TYPES, blobConfigured, listMedia, MAX_UPLOAD_BYTES, storeUpload } from "../core/media";
import { deleteImage, regenerateImage, selectImage, uploadArticleImage, useLibraryImage } from "../core/images/articleImages";
import { FORMAT_LABELS } from "../core/images/service";
import { emitJobEvent, jobEvents } from "../core/events";
import { listIntegrations, testIntegration } from "../core/integrations";
import { discoverOfficialPages, listDiscovered, PAGE_CATEGORY_LABEL, rejectDiscovered, verifyDiscovered } from "../core/discovery";
import { advanceCountry, countryProblems, importExistingCountries, publishCountry } from "../core/countries";
import { advanceOne, retryPublish, validateForPublish } from "../core/publish";
import { encryptionStatus, needsReencryption, resolveSecret as resolveKey } from "../core/secrets";
import { listWorkers } from "../core/worker";
import { SIGNAL_LABEL } from "../core/demand";
import { PIPELINE_STAGES } from "../core/types";
import { readWorkerStatus } from "../core/worker";
import { sleep } from "../core/util";
import { searchProviderName } from "../core/search";
import { studioEnv } from "../core/env";
import { joinSections, splitSections } from "../core/markdown";
import { errorMessage, newId, nowIso, slugify } from "../core/util";
import { dayKey } from "../core/time";

/* ═════════════════════════ Router plumbing ═════════════════════════ */

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

type Ctx = { req: Request; params: Record<string, string>; url: URL };
type Handler = (ctx: Ctx) => Promise<unknown>;

const routes: Array<{ method: string; pattern: string[]; handler: Handler }> = [];
function route(method: string, path: string, handler: Handler) {
  routes.push({ method, pattern: path.split("/").filter(Boolean), handler });
}

function match(pattern: string[], parts: string[]): Record<string, string> | null {
  if (pattern.length !== parts.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < pattern.length; i++) {
    if (pattern[i].startsWith(":")) params[pattern[i].slice(1)] = decodeURIComponent(parts[i]);
    else if (pattern[i] !== parts[i]) return null;
  }
  return params;
}

async function body<T>(req: Request, schema: z.ZodType<T>): Promise<T> {
  const raw = await req.json().catch(() => null);
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new HttpError(400, `${issue?.path.join(".") || "input"}: ${issue?.message ?? "invalid"}`);
  }
  return parsed.data;
}

function sameOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true; // non-browser clients; the auth cookie is SameSite=Lax
  try {
    const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export async function handleStudio(req: Request, path: string[]): Promise<Response> {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "unauthorized", message: "Please sign in." }, { status: 401 });
  }
  if (req.method !== "GET" && !sameOrigin(req)) {
    return NextResponse.json({ error: "forbidden", message: "Cross-site request blocked." }, { status: 403 });
  }
  const url = new URL(req.url);
  for (const r of routes) {
    if (r.method !== req.method) continue;
    const params = match(r.pattern, path);
    if (!params) continue;
    try {
      const out = await r.handler({ req, params, url });
      if (out instanceof Response) return out;
      return NextResponse.json(out ?? { ok: true }, { headers: { "Cache-Control": "no-store" } });
    } catch (err) {
      const status =
        err instanceof HttpError
          ? err.status
          : err instanceof ValidationError || err instanceof ScheduleError || err instanceof PublishError
            ? 400
            : err instanceof ConflictError
              ? 409
              : err instanceof NotFoundError
                ? 404
                : err instanceof StoreNotConfiguredError
                  ? 503
                  : err instanceof NoProviderAvailableError
                    ? 503
                    : 500;
      if (status === 500) console.error("[studio]", errorMessage(err));
      return NextResponse.json({ error: "studio_error", message: errorMessage(err) }, { status });
    }
  }
  return NextResponse.json({ error: "not_found", message: "Unknown Studio endpoint." }, { status: 404 });
}

const revalidateSite = async (paths: string[]) => {
  for (const p of paths) revalidatePath(p);
  revalidatePath("/", "layout");
};

/* ═════════════════════════ Overview ═════════════════════════ */

route("GET", "overview", async () => {
  const settings = await getSettings();
  const [articles, jobs, worker, activity, providers] = await Promise.all([
    listArticles(),
    listJobs(),
    readWorkerStatus(),
    recentActivity(12),
    listProviders(),
  ]);
  const today = await todayKey();
  const day = await getDay(today);
  const usage = (await getStore().list<UsageDay & Record<string, unknown>>(COL.usage, { where: [["day", today]] })) as UsageDay[];
  const unread = (await getStore().list<StudioNotification & Record<string, unknown>>(COL.notifications, { where: [["read", false]] })).length;
  const count = (s: StudioArticle["status"]) => articles.filter((a) => a.status === s).length;
  const failedJobs = jobs.filter((j) => j.status === "failed").length;
  const pausedJobs = jobs.filter((j) => j.status === "paused").length;
  const waitingApi = jobs.filter((j) => j.status === "waiting_api").length;
  const waitingNet = jobs.filter((j) => j.status === "waiting_network").length;
  const activeProviders = providers.filter((p) => p.enabled && !p.state.needsAttention);

  let status: { tone: "ok" | "idle" | "warn" | "error"; label: string; detail: string };
  if (!worker?.online) {
    status = { tone: "warn", label: "Worker not running", detail: worker ? `Last seen ${new Intl.DateTimeFormat("en-GB", { timeZone: settings.publishing.timezone, dateStyle: "medium", timeStyle: "short" }).format(new Date(worker.heartbeatAt))}` : "Start the SKOLAR Studio worker on the automation computer." };
  } else if (!settings.automation.enabled) status = { tone: "idle", label: "Paused", detail: "Automation is switched off." };
  else if (!activeProviders.length) status = { tone: "error", label: "Requires attention", detail: "No working AI provider." };
  else if (worker.state === "offline") status = { tone: "warn", label: "Network unavailable", detail: worker.message };
  else if (worker.state === "api_limited" || (waitingApi && !jobs.some((j) => j.status === "running"))) status = { tone: "warn", label: "API limit reached", detail: worker.message };
  else if (worker.state === "attention") status = { tone: "error", label: "Requires attention", detail: worker.message };
  else if (worker.state === "running") status = { tone: "ok", label: "Automation running", detail: worker.message };
  else status = { tone: "idle", label: "Waiting for next task", detail: worker.message };

  return {
    status,
    worker,
    store: storeInfo(),
    automation: settings.automation,
    today: {
      key: today,
      generated: day.completedDraftIds.length,
      target: settings.automation.dailyTarget,
      shortfallReason: day.shortfallReason ?? null,
    },
    counts: {
      awaiting: count("draft") + count("needs_review"),
      needsReview: count("needs_review"),
      approved: count("approved"),
      scheduled: count("scheduled"),
      published: count("published"),
      failedJobs,
      pausedJobs,
      waitingApi,
      waitingNet,
      runningJobs: jobs.filter((j) => j.status === "running" || j.status === "queued").length,
      publishing: count("publishing"),
    },
    activeJob: (() => {
      const j = jobs.find((x) => x.status === "running") ?? jobs.find((x) => x.status === "queued" || x.status === "waiting_api" || x.status === "waiting_network");
      return j ? { id: j.id, topic: j.topic, status: j.status, stage: j.stage, stageLabel: STAGE_LABELS[j.stage], progress: j.progress, activity: j.activity ?? null } : null;
    })(),
    usage: {
      requests: usage.reduce((s, u) => s + u.requests, 0),
      inputTokens: usage.reduce((s, u) => s + u.inputTokens, 0),
      outputTokens: usage.reduce((s, u) => s + u.outputTokens, 0),
      failures: usage.reduce((s, u) => s + u.failures, 0),
      rateLimits: usage.reduce((s, u) => s + u.rateLimits, 0),
      cost: usage.some((u) => u.estimatedCost !== null) ? usage.reduce((s, u) => s + (u.estimatedCost ?? 0), 0) : null,
      currency: usage.find((u) => u.currency)?.currency ?? null,
    },
    unreadNotifications: unread,
    activity,
    nextScheduled: articles
      .filter((a) => a.status === "scheduled" && a.schedule?.at)
      .sort((a, b) => a.schedule!.at.localeCompare(b.schedule!.at))
      .slice(0, 3)
      .map((a) => ({ id: a.id, title: a.title, at: a.schedule!.at })),
    timezone: settings.publishing.timezone,
  };
});

/* ═════════════════════════ Articles ═════════════════════════ */

function lightArticle(a: StudioArticle) {
  return {
    id: a.id,
    title: a.title,
    slug: a.slug,
    excerpt: a.excerpt,
    category: a.category,
    countryId: a.countryId,
    universityIds: a.universityIds,
    scholarshipIds: a.scholarshipIds,
    status: a.status,
    origin: a.origin,
    academicYear: a.academicYear,
    coverImage: a.coverImage?.cardUrl ?? a.coverImage?.url ?? null,
    imageState: a.imageState?.status ?? null,
    readingMinutes: a.readingMinutes,
    warnings: a.warnings.filter((w) => w.severity === "block").length,
    warningsTotal: a.warnings.length,
    claims: {
      total: a.claims.length,
      verified: a.claims.filter((c) => c.status === "verified").length,
      flagged: a.claims.filter((c) => !["verified", "partially_verified"].includes(c.status)).length,
    },
    sources: a.sources.length,
    qualityPassed: a.qualityGate?.passed ?? null,
    scheduleAt: a.status === "scheduled" ? a.schedule?.at ?? null : null,
    publishedAt: a.publish?.publishedAt ?? null,
    publishState: a.publish?.state ?? null,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
  };
}

route("GET", "articles", async () => ({ items: (await listArticles()).map(lightArticle) }));

const manualSchema = z.object({
  title: z.string().trim().min(5).max(160),
  category: z.enum(CATEGORY_KEYS as [CategoryKey, ...CategoryKey[]]),
  countryId: z.string().trim().min(2).max(40).default("it"),
  universityIds: z.array(z.string().max(80)).max(10).default([]),
  scholarshipIds: z.array(z.string().max(80)).max(10).default([]),
  allowDuplicate: z.boolean().default(false),
});

route("POST", "articles", async ({ req }) => {
  const input = await body(req, manualSchema);
  const dups = await findDuplicates(input.title, { threshold: 0.6 });
  if (dups.length && !input.allowDuplicate) {
    return { duplicate: dups.slice(0, 3) };
  }
  const settings = await getSettings();
  const cta = settings.ctas.find((c) => c.key === STRATEGIES[input.category].defaultCta);
  const a = blankArticle({
    title: input.title,
    slug: await uniqueSlug(input.title),
    category: input.category,
    countryId: input.countryId,
    universityIds: input.universityIds,
    scholarshipIds: input.scholarshipIds,
    origin: "manual",
    status: "draft",
    cta: cta ? { key: cta.key, text: cta.text, label: cta.label } : undefined,
  });
  await getStore().set(COL.articles, a.id, a as unknown as Record<string, unknown>);
  await logActivity("admin", "article.created", `Manual article created: ${a.title}`, a.id);
  return { item: a };
});

route("GET", "articles/:id", async ({ params }) => {
  const a = await getArticle(params.id);
  if (!a) throw new HttpError(404, "Article not found.");
  const job = a.jobId ? await getJob(a.jobId) : null;
  return {
    item: a,
    blockers: publishBlockers(a),
    duplicates: (await findDuplicates(a.title, { excludeArticleId: a.id, excludeTopicId: a.topicId, threshold: 0.55 })).slice(0, 3),
    nextSlot: ["approved", "scheduled"].includes(a.status) ? await previewSlot(a.id) : null,
    targets: (() => {
      const t = publishTargets();
      return { github: t.github ? `${t.github.repo}@${t.github.branch}` : null, localFiles: t.localFiles, siteRecord: t.siteRecord };
    })(),
    job: job ? { id: job.id, status: job.status, gaps: (job.checkpoints.organise as { gaps?: string[] } | undefined)?.gaps ?? [] } : null,
    timezone: (await getSettings()).publishing.timezone,
  };
});

const sourceSchema = z.object({
  n: z.number().int().min(1).max(99),
  title: z.string().trim().min(1).max(200),
  url: z.string().trim().url().max(600),
  type: z.enum(["official_university", "government", "scholarship_authority", "application_portal", "publication", "other"]),
  publisher: z.string().max(120).optional(),
  accessedAt: z.string().max(30).optional(),
  pageDate: z.string().max(30).optional(),
  academicYear: z.string().max(20).optional(),
});

const patchArticleSchema = z.object({
  expectedVersion: z.number().int(),
  title: z.string().trim().min(3).max(160).optional(),
  slug: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "lowercase letters, numbers and hyphens only").max(90).optional(),
  excerpt: z.string().trim().max(300).optional(),
  body: z.string().max(120_000).optional(),
  category: z.enum(CATEGORY_KEYS as [CategoryKey, ...CategoryKey[]]).optional(),
  countryId: z.string().max(40).optional(),
  universityIds: z.array(z.string().max(80)).max(10).optional(),
  scholarshipIds: z.array(z.string().max(80)).max(10).optional(),
  audience: z.string().max(200).optional(),
  academicYear: z.string().regex(/^(20\d{2}\/20\d{2})?$/, "format 2026/2027").optional(),
  seoTitle: z.string().max(70).optional(),
  metaDescription: z.string().max(170).optional(),
  tags: z.array(z.string().max(30)).max(8).optional(),
  cta: z.object({ key: z.string().max(40), text: z.string().max(300), label: z.string().max(60) }).nullable().optional(),
  sources: z.array(sourceSchema).max(40).optional(),
  coverImage: z
    .object({
      url: z.string().max(800).refine((u) => /^https:\/\//.test(u) || u.startsWith("/"), "must be https or a site path"),
      alt: z.string().max(200),
      caption: z.string().max(240).optional(),
      credit: z.string().max(200).optional(),
      license: z.string().max(80).optional(),
      sourceUrl: z.string().max(600).optional(),
      mediaId: z.string().max(80).optional(),
    })
    .nullable()
    .optional(),
});

route("PATCH", "articles/:id", async ({ req, params }) => {
  const input = await body(req, patchArticleSchema);
  const { expectedVersion, cta, coverImage, academicYear, ...rest } = input;
  const current = await getArticle(params.id);
  if (!current) throw new HttpError(404, "Article not found.");
  if (current.status === "published" && (rest.slug && rest.slug !== current.slug)) {
    throw new HttpError(400, "The slug of a published article cannot change (it would break its URL).");
  }
  if (rest.slug && rest.slug !== current.slug && (await uniqueSlug(rest.slug, current.id)) !== rest.slug) {
    throw new HttpError(400, "Another article already uses this slug.");
  }
  const patch: Partial<StudioArticle> = { ...rest } as Partial<StudioArticle>;
  if (cta !== undefined) patch.cta = cta ?? undefined;
  if (coverImage !== undefined) patch.coverImage = coverImage ?? undefined;
  if (academicYear !== undefined) patch.academicYear = academicYear || undefined;
  // Editing an approved/scheduled article sends it back for approval.
  const contentChanged = ["title", "body", "excerpt", "sources"].some((k) => k in rest);
  if (contentChanged && ["approved", "scheduled"].includes(current.status)) {
    patch.status = "draft";
    if (current.status === "scheduled" && current.schedule) {
      patch.schedule = { ...current.schedule, at: "", history: [...current.schedule.history, { at: nowIso(), from: current.schedule.at, to: null, reason: "Edited after approval — needs re-approval" }] };
    }
  }
  const merged = { ...current, ...patch } as StudioArticle;
  const checks = runChecks(merged, await getSettings());
  patch.claims = checks.claims;
  patch.warnings = checks.warnings;
  patch.qualityGate = checks.qualityGate;
  if (merged.status === "needs_review" && checks.qualityGate.passed) patch.status = "draft";
  const saved = await updateArticle(params.id, patch, { expectedVersion });
  return { item: saved, blockers: publishBlockers(saved) };
});

const actionSchema = z.object({
  action: z.enum(["approve", "reject", "reopen", "publish", "schedule", "unschedule", "check", "retry_publish", "check_publish", "validate_publish", "autocite"]),
  reason: z.string().max(400).optional(),
  at: z.string().max(40).optional(),
  expectedSlot: z.string().max(40).optional(),
  expectedVersion: z.number().int().optional(),
});

route("POST", "articles/:id/action", async ({ req, params }) => {
  const input = await body(req, actionSchema);
  const a = await getArticle(params.id);
  if (!a) throw new HttpError(404, "Article not found.");
  const now = nowIso();
  switch (input.action) {
    case "autocite": {
      if (a.status === "published" || a.status === "publishing") throw new HttpError(400, "Edit the text of a published article directly, then re-publish.");
      const r = addCitationsFromEvidence(a.body, a.facts);
      const merged = { ...a, body: r.body };
      const checks = runChecks(merged, await getSettings());
      const saved = await updateArticle(a.id, { body: r.body, claims: checks.claims, warnings: checks.warnings, qualityGate: checks.qualityGate, status: a.status === "needs_review" && checks.qualityGate.passed ? "draft" : a.status }, { expectedVersion: input.expectedVersion });
      await logActivity("admin", "article.autocite", `Added ${r.added.length} citation(s) from research evidence${r.repairedMarkers ? `, repaired ${r.repairedMarkers} marker(s)` : ""}: ${a.title}`, a.id);
      return { item: saved, blockers: publishBlockers(saved), autocite: { added: r.added, repairedMarkers: r.repairedMarkers, unresolved: r.unresolved } };
    }
    case "check": {
      const checks = runChecks(a, await getSettings());
      const saved = await updateArticle(a.id, { claims: checks.claims, warnings: checks.warnings, qualityGate: checks.qualityGate });
      return { item: saved, blockers: publishBlockers(saved) };
    }
    case "approve": {
      if (!["draft", "needs_review", "rejected"].includes(a.status)) throw new HttpError(400, `Cannot approve an article that is ${a.status}.`);
      const checks = runChecks(a, await getSettings());
      if (checks.warnings.some((w) => w.severity === "block")) throw new HttpError(400, "Resolve the blocking editorial warnings before approving.");
      const saved = await updateArticle(a.id, { status: "approved", claims: checks.claims, warnings: checks.warnings, review: { ...a.review, approvedAt: now } }, { expectedVersion: input.expectedVersion });
      await addToDay("approvedIds", a.id);
      await logActivity("admin", "article.approved", `Approved: ${a.title}`, a.id);
      const settings = await getSettings();
      return { item: saved, blockers: publishBlockers(saved), autoQueue: settings.publishing.autoQueue, nextSlot: await previewSlot(a.id) };
    }
    case "reject": {
      if (a.status === "published") throw new HttpError(400, "Published articles cannot be rejected.");
      const saved = await updateArticle(a.id, { status: "rejected", review: { ...a.review, rejectedAt: now, rejectReason: input.reason } });
      await addToDay("rejectedIds", a.id);
      await logActivity("admin", "article.rejected", `Rejected: ${a.title}${input.reason ? ` — ${input.reason}` : ""}`, a.id);
      return { item: saved };
    }
    case "reopen": {
      if (!["rejected", "approved"].includes(a.status)) throw new HttpError(400, "Only rejected or approved articles can be reopened.");
      return { item: await updateArticle(a.id, { status: "draft" }) };
    }
    case "publish": {
      if (a.status === "draft" || a.status === "needs_review") throw new HttpError(400, "Approve the article before publishing.");
      const saved = await publishArticle(a.id, { actor: "admin", revalidate: revalidateSite });
      return { item: saved };
    }
    case "schedule": {
      const saved = await scheduleArticle(a.id, { at: input.at, expectedSlot: input.expectedSlot });
      return { item: saved };
    }
    case "unschedule":
      return { item: await cancelSchedule(a.id) };
    case "retry_publish":
      return { item: await retryPublish(a.id, revalidateSite) };
    case "check_publish":
      return { item: await advanceOne(a.id, revalidateSite) };
    case "validate_publish":
      return { problems: await validateForPublish(a) };
  }
});

route("POST", "articles/:id/regenerate-section", async ({ req, params }) => {
  const input = await body(req, z.object({ heading: z.string().min(1).max(200), instruction: z.string().max(500).optional(), expectedVersion: z.number().int() }));
  const a = await getArticle(params.id);
  if (!a) throw new HttpError(404, "Article not found.");
  if (a.status === "published") throw new HttpError(400, "Edit published articles by changing the text directly, then re-publish.");
  const sections = splitSections(a.body);
  const idx = sections.findIndex((s) => s.heading === input.heading);
  if (idx < 0) throw new HttpError(400, "Section not found — save the article first.");
  if (!a.facts.length) throw new HttpError(400, "This article has no research facts to write from (manual article). Edit the section directly.");
  const r = await writeSection(
    { topic: a.title, category: a.category },
    {
      title: a.title,
      academicYear: a.academicYear ?? "",
      section: { heading: input.heading, purpose: input.instruction ?? "Rewrite this section", factIds: a.facts.map((f) => f.id) },
      allHeadings: sections.map((s) => s.heading ?? "").filter(Boolean),
      facts: a.facts,
      sources: a.sources,
      instruction: input.instruction,
    },
    { stage: "regenerate-section" },
  );
  sections[idx] = { heading: input.heading, body: r.body };
  const merged = { ...a, body: joinSections(sections) };
  const checks = runChecks(merged, await getSettings());
  const saved = await updateArticle(a.id, { body: merged.body, claims: checks.claims, warnings: checks.warnings, qualityGate: checks.qualityGate, status: a.status === "approved" ? "draft" : a.status }, { expectedVersion: input.expectedVersion });
  await logActivity("admin", "article.section_regenerated", `Regenerated "${input.heading}" in ${a.title}`, a.id);
  return { item: saved, blockers: publishBlockers(saved) };
});

route("POST", "articles/:id/regenerate", async ({ params }) => {
  const a = await getArticle(params.id);
  if (!a) throw new HttpError(404, "Article not found.");
  if (["published", "scheduled"].includes(a.status)) throw new HttpError(400, "Unschedule or unpublish before regenerating.");
  const r = await createJob({ topic: a.title, category: a.category, countryId: a.countryId, entityIds: [...a.universityIds, ...a.scholarshipIds], origin: "regenerate", targetArticleId: a.id });
  await updateArticle(a.id, { status: "researching" });
  return { job: r.job };
});

route("POST", "articles/:id/related", async ({ params }) => {
  const a = await getArticle(params.id);
  if (!a) throw new HttpError(404, "Article not found.");
  return { item: await updateArticle(a.id, { relatedSlugs: await relatedFor(a.title, a.id) }) };
});

/* ═════════════════════════ Scheduling & calendar ═════════════════════════ */

route("GET", "calendar", async () => {
  const s = await getSettings();
  const articles = await listArticles();
  return {
    timezone: s.publishing.timezone,
    publishing: s.publishing,
    scheduled: articles
      .filter((a) => a.status === "scheduled" && a.schedule?.at)
      .sort((a, b) => a.schedule!.at.localeCompare(b.schedule!.at))
      .map((a) => ({ ...lightArticle(a), at: a.schedule!.at, pinned: a.schedule!.pinned, history: a.schedule!.history.slice(-5), publishError: a.publish?.state === "failed" ? a.publish.lastError : null })),
    published: articles
      .filter((a) => a.status === "published")
      .sort((a, b) => (b.publish?.publishedAt ?? "").localeCompare(a.publish?.publishedAt ?? ""))
      .slice(0, 60)
      .map((a) => ({ ...lightArticle(a), at: a.publish?.publishedAt ?? a.updatedAt, url: a.publish?.url, deployment: a.publish?.deployment })),
    approved: articles.filter((a) => a.status === "approved").map(lightArticle),
    nextSlot: await previewSlot(),
  };
});

route("POST", "schedule/swap", async ({ req }) => {
  const { a, b } = await body(req, z.object({ a: z.string().max(80), b: z.string().max(80) }));
  await swapSlots(a, b);
  return { ok: true };
});
route("GET", "schedule/compact", async () => ({ changes: await proposeCompaction() }));
route("POST", "schedule/compact", async ({ req }) => {
  const { changes } = await body(req, z.object({ changes: z.array(z.object({ id: z.string(), from: z.string(), to: z.string() })).max(200) }));
  await applyCompaction(changes);
  return { ok: true };
});
route("POST", "schedule/run-due", async () => ({ results: await publishDue({ actor: "admin", revalidate: revalidateSite }) }));

/* ═════════════════════════ Topics & jobs ═════════════════════════ */

route("GET", "topics", async () => ({ items: await listTopics(), signalLabels: SIGNAL_LABEL }));

route("POST", "topics", async ({ req }) => {
  const input = await body(
    req,
    z.object({
      title: z.string().trim().min(5).max(160),
      category: z.enum(CATEGORY_KEYS as [CategoryKey, ...CategoryKey[]]),
      countryId: z.string().default("it"),
      entityIds: z.array(z.string().max(80)).max(6).default([]),
      approve: z.boolean().default(true),
      allowDuplicate: z.boolean().default(false),
    }),
  );
  const r = await addTopic(
    { title: input.title, category: input.category, countryId: input.countryId, entityIds: input.entityIds, origin: "manual", rationale: "Added by an administrator.", score: 75, status: input.approve ? "approved" : "suggested" },
    { allowDuplicate: input.allowDuplicate },
  );
  if (!r.topic) return { duplicate: r.duplicate };
  return { item: r.topic };
});

route("PATCH", "topics/:id", async ({ req, params }) => {
  const input = await body(req, z.object({ status: z.enum(["suggested", "approved", "dismissed"]) }));
  return { item: await updateTopic(params.id, { status: input.status }) };
});

route("POST", "topics/discover", async () => discoverTopics({ max: 10 }));

route("POST", "topics/:id/generate", async ({ params }) => {
  const t = (await listTopics()).find((x) => x.id === params.id);
  if (!t) throw new HttpError(404, "Topic not found.");
  if (t.status === "used" || t.status === "in_progress") throw new HttpError(400, "This topic already has a job.");
  const r = await createJob({ topic: t.title, category: t.category, countryId: t.countryId, entityIds: t.entityIds, origin: "manual", topicId: t.id });
  return { job: r.job, created: r.created };
});

route("GET", "jobs", async () => {
  const jobs = await listJobs();
  return {
    stageLabels: STAGE_LABELS,
    items: jobs.slice(0, 80).map((j) => ({
      id: j.id,
      topic: j.topic,
      category: j.category,
      origin: j.origin,
      status: j.status,
      stage: j.stage,
      progress: j.progress,
      retryCount: j.retryCount,
      maxRetries: j.maxRetries,
      nextRunAt: j.nextRunAt,
      lastError: j.lastError,
      articleId: j.articleId ?? j.targetArticleId,
      createdAt: j.createdAt,
      updatedAt: j.updatedAt,
      lastCheckpointAt: j.lastCheckpointAt,
      active: ACTIVE.includes(j.status),
    })),
  };
});

route("GET", "jobs/:id", async ({ params }) => {
  const j = await getJob(params.id);
  if (!j) throw new HttpError(404, "Job not found.");
  const cps = j.checkpoints as Record<string, unknown>;
  const collect = cps.collect as { pages?: Array<{ url: string; title: string; ok: boolean; error?: string; type: string }> } | undefined;
  const plan = cps.plan as { intent?: string; questions?: string[]; academicYear?: string } | undefined;
  return {
    item: { ...j, checkpoints: undefined },
    stageLabels: STAGE_LABELS,
    research: {
      intent: plan?.intent,
      academicYear: plan?.academicYear,
      questions: plan?.questions ?? [],
      pages: collect?.pages ?? [],
      facts: ((cps.organise as { facts?: unknown[] } | undefined)?.facts ?? (cps.extract as { facts?: unknown[] } | undefined)?.facts ?? []).length,
      gaps: (cps.organise as { gaps?: string[] } | undefined)?.gaps ?? [],
      conflicts: (cps.organise as { conflicts?: string[] } | undefined)?.conflicts ?? [],
    },
  };
});

route("POST", "jobs", async ({ req }) => {
  const input = await body(
    req,
    z.object({
      topic: z.string().trim().min(5).max(160),
      category: z.enum(CATEGORY_KEYS as [CategoryKey, ...CategoryKey[]]),
      countryId: z.string().default("it"),
      entityIds: z.array(z.string().max(80)).max(6).default([]),
      allowDuplicate: z.boolean().default(false),
    }),
  );
  const r = await addTopic(
    { title: input.topic, category: input.category, countryId: input.countryId, entityIds: input.entityIds, origin: "manual", rationale: "Requested by an administrator.", status: "approved", score: 90 },
    { allowDuplicate: input.allowDuplicate },
  );
  if (!r.topic) return { duplicate: r.duplicate };
  const j = await createJob({ topic: r.topic.title, category: r.topic.category, countryId: r.topic.countryId, entityIds: r.topic.entityIds, origin: "manual", topicId: r.topic.id });
  return { job: j.job };
});

route("POST", "jobs/:id/:action", async ({ params }) => {
  const action = z.enum(["pause", "resume", "retry", "cancel"]).parse(params.action);
  return { item: await controlJob(params.id, action) };
});

/* ═════════════════════════ Sources ═════════════════════════ */

const sourceInput = z.object({
  name: z.string().trim().min(2).max(120),
  url: z.string().trim().url().max(500).refine((u) => /^https?:\/\//.test(u), "must be http(s)"),
  countryId: z.string().max(40).default("it"),
  regionId: z.string().max(80).optional(),
  universityId: z.string().max(80).optional(),
  scholarshipId: z.string().max(80).optional(),
  category: z.enum(["university", "government", "scholarship", "application_portal", "consulate", "publication", "other"]),
  monitor: z.boolean().default(true),
  frequencyHours: z.number().int().min(1).max(24 * 30).default(24),
});

route("GET", "sources", async () => ({ items: await listSources(), changes: await listChanges(30) }));
route("POST", "sources", async ({ req }) => {
  const input = await body(req, sourceInput);
  const existing = (await listSources()).find((s) => s.url.replace(/\/$/, "") === input.url.replace(/\/$/, ""));
  if (existing) throw new HttpError(400, `This URL is already registered as "${existing.name}".`);
  const now = nowIso();
  const id = `src-${slugify(new URL(input.url).hostname + new URL(input.url).pathname, 60)}`;
  const doc: StudioSource = { ...input, category: input.category as SourceCategory, id, consecutiveFailures: 0, createdAt: now, updatedAt: now };
  if (!(await getStore().create(COL.sources, id, doc as unknown as Record<string, unknown>))) throw new HttpError(400, "A source with a similar URL already exists.");
  await logActivity("admin", "source.added", `Source added: ${input.name}`, id);
  return { item: doc };
});
route("PATCH", "sources/:id", async ({ req, params }) => {
  const input = await body(req, sourceInput.partial());
  await getStore().set(COL.sources, params.id, { ...input, updatedAt: nowIso(), ...(input.frequencyHours ? { nextCheckAt: undefined } : {}) }, { merge: true });
  return { ok: true };
});
route("DELETE", "sources/:id", async ({ params }) => {
  await getStore().remove(COL.sources, params.id);
  return { ok: true };
});
route("POST", "sources/:id/check", async ({ params }) => checkSource(params.id));

/* ═════════════════════════ Countries, regions, universities, scholarships ═════════════════════════ */

route("GET", "data", async () => ({
  countries: await listCountries(),
  regions: await listRegions(),
  universities: await listUniversities(),
  scholarships: await listScholarships(),
}));

route("POST", "data/seed-italy", async () => seedItaly());

const urlish = z.string().trim().max(500).refine((u) => u === "" || /^https?:\/\//.test(u), "must start with http(s)://");
const kinds = {
  countries: {
    col: COL.countries,
    schema: z.object({
      name: z.string().trim().min(2).max(80),
      code: z.string().trim().min(2).max(3).transform((s) => s.toUpperCase()),
      active: z.boolean().default(true),
      currency: z.string().trim().min(3).max(3).transform((s) => s.toUpperCase()).default("EUR"),
      academicYearStartMonth: z.number().int().min(1).max(12).default(9),
      academicYearFormat: z.enum(["YYYY/YYYY", "YYYY"]).default("YYYY/YYYY"),
      extraCategories: z.array(z.string().max(60)).max(20).default([]),
      slug: z.string().trim().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "lowercase letters, numbers and hyphens").max(60).optional(),
      flag: z.string().trim().max(16).optional(),
      cardTitle: z.string().trim().max(120).optional(),
      shortDescription: z.string().trim().max(400).optional(),
      focus: z.string().trim().max(120).optional(),
      image: z.object({ url: z.string().max(800), alt: z.string().max(200), credit: z.string().max(200).optional(), license: z.string().max(80).optional() }).optional(),
      introContent: z.string().max(40_000).optional(),
      links: z.array(z.object({ label: z.string().min(1).max(100), url: z.string().url().max(500) })).max(30).optional(),
      platformUrl: z.string().trim().max(300).refine((u) => u === "" || /^https:\/\//.test(u), "must start with https://").optional(),
      ctaLabel: z.string().trim().max(60).optional(),
      order: z.number().int().min(0).max(999).optional(),
    }),
    id: (d: { code: string }) => d.code.toLowerCase(),
  },
  regions: {
    col: COL.regions,
    schema: z.object({
      countryId: z.string().min(2).max(40),
      name: z.string().trim().min(2).max(80),
      cities: z.array(z.string().trim().min(1).max(60)).max(40).default([]),
      resources: z.array(z.object({ label: z.string().max(100), url: urlish })).max(30).default([]),
    }),
    id: (d: { countryId: string; name: string }) => `${d.countryId}-${slugify(d.name, 40)}`,
  },
  universities: {
    col: COL.universities,
    schema: z.object({
      countryId: z.string().min(2).max(40),
      regionId: z.string().max(80).optional(),
      name: z.string().trim().min(3).max(140),
      shortName: z.string().trim().max(30).optional(),
      city: z.string().trim().max(60).optional(),
      website: urlish.refine((u) => u !== "", "required"),
      officialDomains: z.array(z.string().trim().max(100)).max(10).default([]),
      campuses: z.array(z.string().trim().max(100)).max(20).default([]),
      departments: z.array(z.string().trim().max(140)).max(60).default([]),
      courses: z
        .array(
          z.object({
            name: z.string().trim().min(2).max(160),
            level: z.enum(["bachelor", "master", "single_cycle", "phd", "other"]),
            language: z.enum(["english", "italian", "mixed", "unknown"]),
            academicYear: z.string().regex(/^20\d{2}\/20\d{2}$/, "format 2026/2027"),
            durationYears: z.number().min(0).max(8).nullable().optional(),
            url: urlish.optional(),
            verified: z.boolean().default(false),
          }),
        )
        .max(200)
        .default([]),
      scholarshipIds: z.array(z.string().max(80)).max(20).default([]),
      languageNotes: z.string().max(500).optional(),
      notes: z.string().max(1000).optional(),
      researchEnabled: z.boolean().default(true),
    }),
    id: (d: { name: string }) => slugify(d.name, 50),
  },
  scholarships: {
    col: COL.scholarships,
    schema: z.object({
      countryId: z.string().min(2).max(40),
      regionId: z.string().max(80).optional(),
      name: z.string().trim().min(3).max(140),
      organisation: z.string().trim().min(2).max(140),
      website: urlish.refine((u) => u !== "", "required"),
      portalUrl: urlish.optional(),
      universityIds: z.array(z.string().max(80)).max(40).default([]),
      academicYear: z.string().regex(/^(20\d{2}\/20\d{2})?$/, "format 2026/2027").optional(),
      eligibility: z.string().max(2000).optional(),
      benefits: z.string().max(2000).optional(),
      notes: z.string().max(1000).optional(),
      monitor: z.boolean().default(true),
    }),
    id: (d: { name: string }) => slugify(d.name, 50),
  },
} as const;

function kindOf(k: string) {
  const def = kinds[k as keyof typeof kinds];
  if (!def) throw new HttpError(404, "Unknown data type.");
  return def;
}

route("POST", "data/:kind", async ({ req, params }) => {
  const def = kindOf(params.kind);
  const input = (await body(req, def.schema as z.ZodType<Record<string, unknown>>)) as Record<string, unknown>;
  const id = (def.id as (d: Record<string, unknown>) => string)(input) || newId(params.kind.slice(0, 3));
  const now = nowIso();
  if (!(await getStore().create(def.col, id, { ...input, createdAt: now, updatedAt: now }))) {
    throw new HttpError(400, "A record with this name already exists.");
  }
  // Universities/scholarships with a website become monitored official sources automatically.
  if (params.kind === "universities" || params.kind === "scholarships") {
    const website = String(input.website);
    const exists = (await listSources()).some((s) => s.url.replace(/\/$/, "") === website.replace(/\/$/, ""));
    if (!exists) {
      const sid = `src-${slugify(new URL(website).hostname, 60)}`;
      await getStore().create(COL.sources, sid, {
        name: String(input.name),
        url: website,
        countryId: String(input.countryId),
        regionId: input.regionId,
        ...(params.kind === "universities" ? { universityId: id, category: "university" } : { scholarshipId: id, category: "scholarship" }),
        monitor: params.kind === "scholarships",
        frequencyHours: 24,
        consecutiveFailures: 0,
        createdAt: now,
        updatedAt: now,
      });
    }
  }
  await logActivity("admin", `${params.kind}.added`, `${params.kind.slice(0, -1)} added: ${String(input.name)}`, id);
  return { id };
});

route("PATCH", "data/:kind/:id", async ({ req, params }) => {
  const def = kindOf(params.kind);
  const input = await body(req, (def.schema as unknown as z.ZodObject<z.ZodRawShape>).partial());
  await getStore().set(def.col, params.id, { ...(input as Record<string, unknown>), updatedAt: nowIso() }, { merge: true });
  return { ok: true };
});

route("DELETE", "data/:kind/:id", async ({ params }) => {
  const def = kindOf(params.kind);
  await getStore().remove(def.col, params.id);
  return { ok: true };
});

/* ═════════════════════════ Providers & usage ═════════════════════════ */

function maskProvider(p: ProviderConfig) {
  const { keyRef, ...rest } = p;
  return { ...rest, keySource: keyRef.startsWith("env:") ? `Environment variable ${keyRef.slice(4)}` : "Stored encrypted" };
}

route("GET", "providers", async () => {
  const providers = await listProviders();
  const since = dayKey(new Date(Date.now() - 30 * 86400_000), (await getSettings()).publishing.timezone);
  const usage = (await getStore().list<UsageDay & Record<string, unknown>>(COL.usage)).filter((u) => u.day >= since);
  return { items: providers.map(maskProvider), usage, presets: PROVIDER_PRESETS, canEncrypt: canEncrypt() };
});

const providerInput = z.object({
  name: z.string().trim().min(2).max(60),
  kind: z.enum(["groq", "openai_compatible"]),
  baseUrl: z.string().trim().url().refine((u) => u.startsWith("https://"), "must be https"),
  model: z.string().trim().min(2).max(120),
  apiKey: z.string().trim().max(400).optional(),
  envVar: z.string().trim().regex(/^[A-Z][A-Z0-9_]{1,80}$/).optional(),
  enabled: z.boolean().default(true),
  priority: z.number().int().min(1).max(99).default(10),
  structuredOutput: z.enum(["json_schema", "json_object"]).default("json_schema"),
  capabilities: z.array(z.string().max(40)).max(10).default(["json"]),
  pricing: z.object({ inputPerMTok: z.number().min(0), outputPerMTok: z.number().min(0), currency: z.string().length(3) }).nullable().optional(),
});

function keyFields(apiKey?: string, envVar?: string): { keyRef: string; keyHint: string } | null {
  if (envVar) return { keyRef: `env:${envVar}`, keyHint: `from ${envVar}` };
  if (apiKey) {
    if (!canEncrypt()) throw new HttpError(400, "Set STUDIO_ENCRYPTION_KEY on the server to store keys, or use an environment variable name instead.");
    return { keyRef: encryptSecret(apiKey), keyHint: keyHint(apiKey) };
  }
  return null;
}

route("POST", "providers", async ({ req }) => {
  const input = await body(req, providerInput);
  const k = keyFields(input.apiKey, input.envVar);
  if (!k) throw new HttpError(400, "Provide an API key or the name of an environment variable that holds it.");
  const now = nowIso();
  const { apiKey: _a, envVar: _e, ...rest } = input;
  void _a;
  void _e;
  const p: ProviderConfig = { ...rest, ...k, pricing: input.pricing ?? null, id: newId("prv"), state: {}, createdAt: now, updatedAt: now };
  await getStore().set(COL.providers, p.id, p as unknown as Record<string, unknown>);
  await logActivity("admin", "provider.added", `AI provider added: ${p.name} (${p.model})`, p.id);
  return { item: maskProvider(p) };
});

route("PATCH", "providers/:id", async ({ req, params }) => {
  const input = await body(req, providerInput.partial());
  const { apiKey, envVar, ...rest } = input;
  const k = keyFields(apiKey, envVar);
  const saved = await getStore().transact<ProviderConfig & Record<string, unknown>>(COL.providers, params.id, (cur) => {
    if (!cur) throw new HttpError(404, "Provider not found.");
    const reset = k || rest.model || rest.baseUrl ? { ...cur.state, needsAttention: undefined, rateLimitedUntil: undefined } : cur.state;
    return { ...cur, ...rest, ...(k ?? {}), state: reset, updatedAt: nowIso() } as ProviderConfig & Record<string, unknown>;
  });
  return { item: maskProvider(saved!) };
});

route("DELETE", "providers/:id", async ({ params }) => {
  await getStore().remove(COL.providers, params.id);
  return { ok: true };
});

route("POST", "providers/:id/test", async ({ params }) => {
  const p = (await listProviders()).find((x) => x.id === params.id);
  if (!p) throw new HttpError(404, "Provider not found.");
  return testProvider(p);
});

/* ═════════════════════════ Integrations ═════════════════════════ */

route("POST", "integrations/github/test", async () => githubCheck());

/* ═════════════════════════ Settings ═════════════════════════ */

route("GET", "settings", async () => ({ settings: await getSettings(), categories: CATEGORY_KEYS.map((k) => ({ key: k, label: STRATEGIES[k].label })) }));

route("PUT", "settings", async ({ req }) => {
  const input = await body(
    req,
    z.object({
      automation: z
        .object({
          enabled: z.boolean(),
          dailyTarget: z.number().int().min(0).max(20),
          autoPickTopics: z.boolean(),
          maxRetries: z.number().int().min(0).max(10),
          maxJobsPerDay: z.number().int().min(1).max(60),
          minSourcesForDraft: z.number().int().min(1).max(10),
          minWords: z.number().int().min(200).max(5000),
        })
        .partial()
        .optional(),
      publishing: z
        .object({
          timezone: z.string().max(60),
          times: z.array(z.string().regex(/^\d{1,2}:\d{2}$/)).min(1).max(6),
          days: z.array(z.number().int().min(0).max(6)).max(7),
          maxPerDay: z.number().int().min(1).max(10),
          minIntervalMinutes: z.number().int().min(0).max(1440),
          allowWeekends: z.boolean(),
          autoQueue: z.boolean(),
        })
        .partial()
        .optional(),
      monitoring: z.object({ enabled: z.boolean(), defaultFrequencyHours: z.number().int().min(1).max(720) }).partial().optional(),
      demand: z.object({ suggestEnabled: z.boolean() }).partial().optional(),
      ctas: z
        .array(
          z.object({
            key: z.string().regex(/^[a-z0-9-]{2,40}$/),
            label: z.string().min(2).max(60),
            text: z.string().min(10).max(300),
            categories: z.array(z.enum(CATEGORY_KEYS as [CategoryKey, ...CategoryKey[]])),
          }),
        )
        .min(1)
        .max(20)
        .optional(),
    }),
  );
  const saved = await saveSettings(input as Parameters<typeof saveSettings>[0]);
  await logActivity("admin", "settings.updated", "Settings updated");
  return { settings: saved };
});

/* ═════════════════════════ Notifications & reports ═════════════════════════ */

route("GET", "notifications", async () => ({
  items: await getStore().list<StudioNotification & Record<string, unknown>>(COL.notifications, { orderBy: { field: "createdAt", direction: "desc" }, limit: 60 }),
}));

route("POST", "notifications/read", async ({ req }) => {
  const input = await body(req, z.object({ ids: z.array(z.string().max(160)).max(200).optional(), all: z.boolean().optional() }));
  const rows = await getStore().list<StudioNotification & Record<string, unknown>>(COL.notifications, { where: [["read", false]] });
  for (const n of rows) if (input.all || input.ids?.includes(n.id)) await getStore().set(COL.notifications, n.id, { read: true }, { merge: true });
  return { ok: true };
});

route("GET", "reports", async ({ url }) => {
  const period = url.searchParams.get("period") === "month" ? "month" : "day";
  const tz = (await getSettings()).publishing.timezone;
  const today = dayKey(new Date(), tz);
  const prefix = period === "day" ? today : today.slice(0, 7);
  const days = (await getStore().list<DailyStats & Record<string, unknown>>(COL.daily)).filter((d) => d.id.startsWith(prefix));
  const usage = (await getStore().list<UsageDay & Record<string, unknown>>(COL.usage)).filter((u) => u.day.startsWith(prefix));
  const providerDist = new Map<string, { requests: number; inputTokens: number; outputTokens: number; failures: number; rateLimits: number; cost: number | null; currency: string | null }>();
  for (const u of usage) {
    const k = `${u.providerName} · ${u.model}`;
    const cur = providerDist.get(k) ?? { requests: 0, inputTokens: 0, outputTokens: 0, failures: 0, rateLimits: 0, cost: null, currency: null };
    cur.requests += u.requests;
    cur.inputTokens += u.inputTokens;
    cur.outputTokens += u.outputTokens;
    cur.failures += u.failures;
    cur.rateLimits += u.rateLimits;
    if (u.estimatedCost !== null) {
      cur.cost = (cur.cost ?? 0) + u.estimatedCost;
      cur.currency = u.currency;
    }
    providerDist.set(k, cur);
  }
  const sum = (f: (d: DailyStats) => number) => days.reduce((s, d) => s + f(d), 0);
  const generated = sum((d) => d.completedDraftIds.length);
  return {
    period,
    label: prefix,
    researched: sum((d) => d.researchedTopics),
    generated,
    approved: sum((d) => d.approvedIds.length),
    published: sum((d) => d.publishedIds.length),
    rejected: sum((d) => d.rejectedIds.length),
    failedJobs: sum((d) => d.failedJobIds.length),
    avgGenerationMinutes: generated ? Math.round(sum((d) => d.generationMs) / generated / 60000) : null,
    shortfalls: days.filter((d) => d.shortfallReason).map((d) => ({ day: d.id, reason: d.shortfallReason })),
    providers: [...providerDist.entries()].map(([name, v]) => ({ name, ...v })),
    days: days.sort((a, b) => a.id.localeCompare(b.id)).map((d) => ({ day: d.id, generated: d.completedDraftIds.length, published: d.publishedIds.length, failed: d.failedJobIds.length })),
  };
});

/* ═════════════════════════ Media & article images ═════════════════════════ */

route("GET", "media", async () => ({
  backend: blobConfigured() ? "blob" : null,
  items: await listMedia(),
  library: imageCredits.map((c) => ({ url: c.image, title: c.title, credit: c.author, license: c.license, sourceUrl: c.source })),
  formats: FORMAT_LABELS,
}));

async function readUpload(req: Request) {
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) throw new HttpError(400, "Choose an image file.");
  if (!ALLOWED_IMAGE_TYPES.has(file.type)) throw new HttpError(400, "Only JPEG, PNG, WebP or AVIF images.");
  if (file.size > MAX_UPLOAD_BYTES) throw new HttpError(400, "Image must be 8 MB or smaller.");
  const alt = String(form?.get("alt") ?? "").trim().slice(0, 200);
  if (!alt) throw new HttpError(400, "Alt text is required.");
  if (form?.get("rightsConfirmed") !== "true") throw new HttpError(400, "Confirm that SKOLAR has the right to use this image.");
  return {
    file: { bytes: Buffer.from(await file.arrayBuffer()), name: file.name },
    meta: {
      alt,
      credit: String(form?.get("credit") ?? "").trim().slice(0, 200) || undefined,
      license: String(form?.get("license") ?? "").trim().slice(0, 80) || undefined,
      sourceUrl: String(form?.get("sourceUrl") ?? "").trim().slice(0, 600) || undefined,
    },
  };
}

route("POST", "media", async ({ req }) => {
  const { file, meta } = await readUpload(req);
  return { item: await storeUpload(file, meta) };
});

route("POST", "articles/:id/images/upload", async ({ req, params }) => {
  const { file, meta } = await readUpload(req);
  const item = await uploadArticleImage(params.id, file, { ...meta, makeCover: true });
  return { item, blockers: publishBlockers(item) };
});
route("POST", "articles/:id/images/generate", async ({ params }) => {
  const item = await regenerateImage(params.id);
  return { item, blockers: publishBlockers(item) };
});
route("POST", "articles/:id/images/select", async ({ req, params }) => {
  const { imageId } = await body(req, z.object({ imageId: z.string().max(120) }));
  const item = await selectImage(params.id, imageId);
  return { item, blockers: publishBlockers(item) };
});
route("POST", "articles/:id/images/library", async ({ req, params }) => {
  const input = await body(req, z.object({ url: z.string().max(300), alt: z.string().min(3).max(200) }));
  const lib = imageCredits.find((c) => c.image === input.url);
  if (!lib) throw new HttpError(400, "Not a library image.");
  const item = await useLibraryImage(params.id, { url: lib.image, title: lib.title, credit: lib.author, license: lib.license, sourceUrl: lib.source }, input.alt);
  return { item, blockers: publishBlockers(item) };
});
route("DELETE", "articles/:id/images/:imageId", async ({ params }) => {
  const item = await deleteImage(params.id, params.imageId);
  return { item, blockers: publishBlockers(item) };
});

/* ═════════════════════════ Live job view (persisted events + SSE) ═════════════════════════ */

async function stageAverages(): Promise<Record<string, number> | null> {
  const done = (await listJobs()).filter((j) => j.status === "completed" && j.stageTimes).slice(0, 10);
  if (done.length < 3) return null;
  const avg: Record<string, number> = {};
  for (const k of PIPELINE_STAGES) {
    const ds = done.map((j) => j.stageTimes?.[k]).filter((t): t is NonNullable<typeof t> => Boolean(t?.startedAt && t?.completedAt)).map((t) => Date.parse(t.completedAt!) - Date.parse(t.startedAt));
    if (ds.length >= 3) avg[k] = ds.reduce((x, y) => x + y, 0) / ds.length;
  }
  return avg;
}

async function liveJob(id: string) {
  const j = await getJob(id);
  if (!j) throw new HttpError(404, "Job not found.");
  const cps = j.checkpoints as Record<string, unknown>;
  const collect = cps.collect as { pages?: Array<{ url: string; title: string; ok: boolean; error?: string; type: string }>; queue?: Array<{ url: string; title: string }> } | undefined;
  const src = cps.sources as { candidates?: Array<{ url: string; title: string; type: string; why: string }> } | undefined;
  const plan = cps.plan as { intent?: string; academicYear?: string; questions?: string[] } | undefined;
  const img = cps.image_concept as { format?: string; concept?: string; prompt?: string } | undefined;
  const up = cps.image_upload as { image?: { url: string; cardUrl?: string }; failed?: string } | undefined;
  const failedStage = j.status === "failed" ? j.stage : null;
  const stages = PIPELINE_STAGES.map((k) => {
    const t = j.stageTimes?.[k];
    const done = j.completedStages.includes(k);
    const current = j.stage === k && !done;
    const status = done ? "done" : failedStage === k ? "failed" : current ? (j.status === "running" ? "running" : j.status === "waiting_api" || j.status === "waiting_network" ? "waiting" : j.status === "paused" ? "paused" : t?.failedAt ? "retrying" : "next") : "pending";
    return { key: k, label: STAGE_LABELS[k], status, startedAt: t?.startedAt ?? null, completedAt: t?.completedAt ?? null, failedAt: t?.failedAt ?? null, attempts: t?.attempts ?? 0 };
  });
  const avg = await stageAverages();
  const remaining = avg ? stages.filter((s) => s.status !== "done").map((s) => avg[s.key]).filter((x): x is number => typeof x === "number") : [];
  const eta = avg && remaining.length && ["running", "queued"].includes(j.status) ? Math.round(remaining.reduce((x, y) => x + y, 0) / 60000) : null;
  return {
    job: {
      id: j.id,
      topic: j.topic,
      category: j.category,
      origin: j.origin,
      status: j.status,
      stage: j.stage,
      progress: j.progress,
      completed: j.completedStages.length,
      total: PIPELINE_STAGES.length,
      activity: j.activity ?? null,
      retryCount: j.retryCount,
      maxRetries: j.maxRetries,
      nextRunAt: j.nextRunAt ?? null,
      lastError: j.lastError ?? null,
      articleId: j.articleId ?? j.targetArticleId ?? null,
      createdAt: j.createdAt,
      startedAt: j.startedAt ?? null,
      updatedAt: j.updatedAt,
      finishedAt: j.finishedAt ?? null,
      lease: j.lease ?? null,
      calls: [...new Set((j.calls ?? []).map((c) => `${c.provider} · ${c.model}`))],
    },
    stages,
    sources: {
      candidates: src?.candidates ?? [],
      read: collect?.pages ?? [],
      queued: collect?.queue ?? [],
    },
    research: { intent: plan?.intent ?? null, academicYear: plan?.academicYear ?? null, questions: plan?.questions ?? [], gaps: (cps.organise as { gaps?: string[] } | undefined)?.gaps ?? [], conflicts: (cps.organise as { conflicts?: string[] } | undefined)?.conflicts ?? [] },
    image: { concept: img?.concept ?? null, format: img?.format ?? null, url: up?.image?.cardUrl ?? up?.image?.url ?? null, failed: up?.failed ?? null },
    events: (await jobEvents(id)).slice(-150),
    etaMinutes: eta,
  };
}

route("GET", "jobs/:id/live", async ({ params }) => liveJob(params.id));

route("GET", "jobs/:id/stream", async ({ params, req }) => {
  const enc = new TextEncoder();
  const id = params.id;
  const stream = new ReadableStream({
    async start(controller) {
      let last = "";
      let lastPing = Date.now();
      const until = Date.now() + 55_000; // clients reconnect automatically
      try {
        while (Date.now() < until && !req.signal.aborted) {
          const live = await liveJob(id);
          const key = `${live.job.updatedAt}|${live.events.length}`;
          if (key !== last) {
            last = key;
            controller.enqueue(enc.encode(`data: ${JSON.stringify(live)}\n\n`));
          } else if (Date.now() - lastPing > 15_000) {
            lastPing = Date.now();
            controller.enqueue(enc.encode(`: ping\n\n`));
          }
          await sleep(1500);
        }
      } catch (err) {
        controller.enqueue(enc.encode(`event: error\ndata: ${JSON.stringify({ message: errorMessage(err) })}\n\n`));
      }
      controller.close();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-store, no-transform", Connection: "keep-alive" } });
});

/* ═════════════════════════ Integrations, workers, security ═════════════════════════ */

route("GET", "integrations/status", async () => ({ items: await listIntegrations(), workers: await listWorkers(), encryption: encryptionStatus() }));
route("POST", "integrations/:key/test", async ({ params }) => testIntegration(params.key));

route("POST", "security/reencrypt", async () => {
  const st = encryptionStatus();
  if (!st.configured) throw new HttpError(400, st.problem ?? "Encryption is not configured.");
  const { encryptSecret } = await import("../core/secrets");
  let migrated = 0;
  const failed: string[] = [];
  for (const p of await listProviders()) {
    if (!needsReencryption(p.keyRef)) continue;
    const plain = resolveKey(p.keyRef);
    if (!plain) {
      failed.push(p.name);
      continue;
    }
    await getStore().set(COL.providers, p.id, { keyRef: encryptSecret(plain), updatedAt: nowIso() }, { merge: true });
    migrated++;
  }
  await logActivity("admin", "security.reencrypt", `Re-encrypted ${migrated} stored key(s)${failed.length ? `; could not decrypt: ${failed.join(", ")}` : ""}`);
  return { migrated, failed };
});

/* ═════════════════════════ Official page discovery ═════════════════════════ */

route("GET", "discovery", async () => ({
  items: await listDiscovered(),
  labels: PAGE_CATEGORY_LABEL,
  lastRun: await getStore().get(COL.integrations, "discovery-last-run"),
}));
route("POST", "discovery/run", async ({ req }) => {
  const input = await body(req, z.object({ institutionId: z.string().max(80).optional() }));
  return discoverOfficialPages({ institutionId: input.institutionId, perInstitution: 30 });
});
route("POST", "discovery/:id/verify", async ({ params }) => ({ source: await verifyDiscovered(params.id) }));
route("POST", "discovery/:id/reject", async ({ params }) => {
  await rejectDiscovered(params.id);
  return { ok: true };
});

/* ═════════════════════════ Countries (public website) ═════════════════════════ */

route("POST", "data/import-countries", async () => importExistingCountries());
route("POST", "countries/:id/publish", async ({ params }) => ({ item: await publishCountry(params.id, revalidateSite) }));
route("POST", "countries/:id/check", async ({ params }) => ({ item: await advanceCountry(params.id) }));
route("POST", "countries/:id/image", async ({ req, params }) => {
  const { file, meta } = await readUpload(req);
  const rec = await storeUpload(file, { ...meta, articleId: `country-${params.id}` });
  await getStore().set(COL.countries, params.id, { image: { url: rec.url, alt: meta.alt, credit: meta.credit, license: meta.license }, updatedAt: nowIso() }, { merge: true });
  return { image: { url: rec.url, alt: meta.alt, credit: meta.credit, license: meta.license } };
});
route("GET", "countries/:id/problems", async ({ params }) => {
  const all = await listCountries();
  const c = all.find((x) => x.id === params.id);
  if (!c) throw new HttpError(404, "Country not found.");
  return { problems: countryProblems(c, all) };
});

/* ═════════════════════════ Helpers for the editor ═════════════════════════ */

route("GET", "meta", async () => ({
  categories: CATEGORY_KEYS.map((k) => ({ key: k, label: STRATEGIES[k].label, description: STRATEGIES[k].description })),
  countries: (await listCountries()).map((c) => ({ id: c.id, name: c.name, active: c.active })),
  universities: (await listUniversities()).map((u) => ({ id: u.id, name: u.name, countryId: u.countryId })),
  scholarships: (await listScholarships()).map((s) => ({ id: s.id, name: s.name, countryId: s.countryId })),
  ctas: (await getSettings()).ctas,
}));

export type { ArticleSource };
