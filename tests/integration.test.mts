/**
 * Integration tests with MOCKED external services (AI provider, web pages,
 * GitHub, network). They exercise the real store, pipeline, job queue,
 * publishing and worker code against a temporary local data folder.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { html, mockFetch, setupEnv } from "./helpers.mts";

const root = setupEnv("integration");
process.env.TEST_KEY_A = "test-key-a-123456789";
process.env.NEXT_PUBLIC_SITE_URL = "https://site.test";
process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_test_token";
process.env.TEST_KEY_B = "test-key-b-123456789";

const { getStore, COL } = await import("../src/studio/core/store");
const ai = await import("../src/studio/core/ai");
const { createJob, runJobStep, nextRunnableJob, getJob, controlJob } = await import("../src/studio/core/jobs");
const { getDay, todayKey } = await import("../src/studio/core/ops");
const { getArticle, updateArticle } = await import("../src/studio/core/articles");
const { publishArticle, advanceOne, retryPublish } = await import("../src/studio/core/publish");
const media = await import("../src/studio/core/media");

// In-memory Vercel Blob (mocked SDK) so uploads are exercised end to end.
const blobs = new Map<string, Buffer>();
media.setBlobApiForTests({
  put: (async (pathname: string, body: Buffer, o: { allowOverwrite?: boolean }) => {
    if (blobs.has(pathname) && !o.allowOverwrite) throw new Error("This blob already exists");
    blobs.set(pathname, body);
    return { url: `https://store.public.blob.vercel-storage.com/${pathname}`, pathname, downloadUrl: "", contentType: "", contentDisposition: "" };
  }) as never,
  head: (async (pathname: string) => ({ url: `https://store.public.blob.vercel-storage.com/${pathname}`, pathname })) as never,
  del: (async (urls: string[]) => {
    for (const u of [urls].flat()) blobs.delete(u.replace(/^https:\/\/[^/]+\//, ""));
  }) as never,
});
const { scheduleArticle, publishDue, previewSlot } = await import("../src/studio/core/schedule");
const { saveSettings } = await import("../src/studio/core/settings");
const { acquirePidLock, releasePidLock, runWorker } = await import("../src/studio/core/worker");
const { addTopic } = await import("../src/studio/core/topics");
type ProviderConfig = import("../src/studio/core/types").ProviderConfig;
type ChatRequest = import("../src/studio/core/ai").ChatRequest;

const store = getStore();
const now = () => new Date().toISOString();

async function putProvider(id: string, kind: ProviderConfig["kind"], priority: number, envVar: string) {
  const p: ProviderConfig = {
    id, name: id, kind, baseUrl: "https://example.invalid/v1", model: `${id}-model`, keyRef: `env:${envVar}`, keyHint: "test",
    enabled: true, priority, structuredOutput: "json_schema", capabilities: ["json"], pricing: { inputPerMTok: 1, outputPerMTok: 2, currency: "USD" },
    state: {}, createdAt: now(), updatedAt: now(),
  };
  await store.set(COL.providers, id, p as unknown as Record<string, unknown>);
}

/* ───────────── Mock AI that behaves like a careful model ───────────── */

const aiCalls: string[] = [];
function mockModel(req: ChatRequest) {
  const name = req.json?.name ?? "text";
  aiCalls.push(name);
  const out = (v: unknown) => ({ text: JSON.stringify(v), inputTokens: 500, outputTokens: 200, model: "mock" });
  switch (name) {
    case "research_plan":
      return out({ intent: "Understand programmes and fees at Testville", audience: "Indian students", angle: "Official facts only", questions: ["Programmes", "Fees"], queries: ["unitest programmes"], entities: ["University of Testville"] });
    case "facts": {
      const text = /PAGE TEXT:\n"""\n([\s\S]*?)\n"""/.exec(req.user)?.[1] ?? "";
      const sentences = text.split(/(?<=\.)\s+/).filter((s) => /\d/.test(s)).slice(0, 3);
      return out({
        facts: [
          ...sentences.map((s) => ({ statement: s, quote: s, academic_year: /2027\/2028/.test(s) ? "2027/2028" : null, question: 1 })),
          { statement: "Testville is ranked first in Europe", quote: "Testville is the number one university in Europe", academic_year: null, question: null }, // fabricated → must be discarded
        ],
      });
    }
    case "organise":
      return out({ conflicts: [], gaps: ["Accommodation"] });
    case "outline":
      return out({ title: "University of Testville: guide for 2027/2028", sections: ["Introduction", "Programmes", "Fees", "How to apply", "Student life", "Final thoughts"].map((h, i) => ({ heading: h, purpose: h, fact_ids: i === 1 ? ["F1"] : i === 2 ? ["F2", "F3"] : [] })) });
    case "section": {
      const facts = [...req.user.matchAll(/^(F\d+) \[[^\]]*\]: (.*)$/gm)].slice(0, 1);
      const filler = Array.from({ length: 9 }, () => "Students should read the official pages carefully and plan their application well ahead of time with a clear checklist.").join(" ");
      const factLine = facts.length ? `${facts[0][2]} [${facts[0][1]}]` : "";
      return out({ markdown: `${factLine}\n\n${filler}` });
    }
    case "review":
      return out({ issues: [{ severity: "warn", excerpt: "This sentence does not exist in the article at all", problem: "hallucinated issue" }] });
    case "seo":
      return out({ seo_title: "University of Testville guide 2027/2028", meta_description: "Programmes, fees and how to apply at the University of Testville for 2027/2028, checked against official university sources.", excerpt: "Programmes, fees and applications at Testville, from official sources.", slug: "university-of-testville-guide", tags: ["Testville", "Italy"] });
    case "topic_picks":
      return out({ picks: [{ index: 0, title: "University of Testville complete guide", score: 90, rationale: "useful" }] });
    case "ping":
      return out({ ok: true });
    default:
      return out({});
  }
}

/* ───────────── Mock web ───────────── */

const PAGES: Record<string, string> = {
  "https://www.unitest.it/": "<p>The University of Testville offers a Bachelor in Computer Science that lasts 3 years and is taught in English.</p><p>Tuition fees for 2027/2028 range from 156 to 2,500 euro per year depending on family income.</p><a href='https://www.unitest.it/international-admissions'>International admissions</a>",
  "https://www.unitest.it/international-admissions": "<p>International applicants must pre-enrol on Universitaly by 30 April 2027 for the 2027/2028 intake.</p><p>An English certificate at B2 level is required for 2027/2028 admission.</p>",
  "https://www.unitest.it/international": "<p>The International Office answers emails within 5 working days.</p><p>Orientation week for 2027/2028 starts in September 2027.</p>",
};
let offline = false;
const liveKeys: Record<string, string> = {};
let deployState = "pending";
let githubFiles: Record<string, string> = {};
let githubCommits = 0;
let githubFail = false;

const web = mockFetch([
  (url) => (offline ? null : null),
  (url) => (url.includes("generate_204") ? (offline ? null : new Response(null, { status: 204 })) : null),
  (url) => (url.endsWith("/robots.txt") ? (offline ? null : new Response("User-agent: *\nDisallow: /private", { status: 200 })) : null),
  (url) => {
    const m = /^https:\/\/site\.test\/insights\/([a-z0-9-]+)/.exec(url);
    if (!m) return null;
    const key = liveKeys[m[1]];
    return key ? html(`<meta name="skolar-content-key" content="${key}"><h1>Article</h1>`) : new Response("Not found", { status: 404 });
  },
  (url) => (url.startsWith("https://store.public.blob.vercel-storage.com/") ? new Response(blobs.get(url.replace(/^https:\/\/[^/]+\//, "")) ?? null, { status: blobs.has(url.replace(/^https:\/\/[^/]+\//, "")) ? 200 : 404 }) : null),
  (url) => {
    if (/\/repos\/acme\/site\/deployments\?sha=/.test(url)) return Response.json([{ id: 7, environment: "Production", production_environment: true }]);
    if (/\/repos\/acme\/site\/deployments\/7\/statuses/.test(url)) return Response.json([{ state: deployState, environment_url: "https://site.test" }]);
    if (/\/repos\/acme\/site\/commits\?path=/.test(url)) return Response.json([{ sha: `commit${githubCommits}` }]);
    return null;
  },
  (url, init) => {
    if (!url.startsWith("https://api.github.com/")) return null;
    const m = /\/repos\/acme\/site\/contents\/(.+?)(\?|$)/.exec(url);
    if (m && (init?.method ?? "GET") === "GET") {
      const p = decodeURIComponent(m[1]);
      return githubFiles[p] !== undefined
        ? Response.json({ sha: `sha-${p}`, encoding: "base64", content: Buffer.from(githubFiles[p]).toString("base64") })
        : new Response("Not Found", { status: 404 });
    }
    if (m && init?.method === "PUT") {
      if (githubFail) return new Response("boom", { status: 500 });
      const body = JSON.parse(String(init.body)) as { content: string };
      githubFiles[decodeURIComponent(m[1])] = Buffer.from(body.content, "base64").toString("utf8");
      githubCommits++;
      return Response.json({ commit: { sha: `commit${githubCommits}` } });
    }
    return null;
  },
  (url) => {
    if (offline) return null;
    const key = url.endsWith("/") || url.includes("/international") ? url : `${url}/`;
    const body = PAGES[key] ?? PAGES[url];
    return body ? html(`${body}<p>${"Students from many countries study here and the university publishes its official information on these pages for applicants. ".repeat(3)}</p>`, "Testville") : null;
  },
]);

/* ═════════════════════════ Tests ═════════════════════════ */

test("AI fallback: rate limit moves to next provider; auth errors are not retried; usage recorded", async () => {
  await putProvider("A", "groq", 1, "TEST_KEY_A");
  await putProvider("B", "openai_compatible", 2, "TEST_KEY_B");
  let aCalls = 0;
  ai.setAdapterForTests("groq", { async chat() { aCalls++; throw new ai.AiError("A 429", "rate_limit", 120); } });
  ai.setAdapterForTests("openai_compatible", { async chat(_c, _k, req) { return mockModel(req); } });
  const audit: Array<{ stage: string; provider: string; model: string; at: string }> = [];
  const r = await ai.chat({ system: "s", user: "u", json: { name: "ping", schema: {} } }, { stage: "t", audit });
  assert.equal(r.providerId, "B");
  assert.equal(audit[0].provider, "B");
  const a = (await store.get<ProviderConfig & Record<string, unknown>>(COL.providers, "A"))!;
  assert.ok(a.state.rateLimitedUntil && Date.parse(a.state.rateLimitedUntil) > Date.now());
  await ai.chat({ system: "s", user: "u", json: { name: "ping", schema: {} } });
  assert.equal(aCalls, 1, "rate-limited provider is skipped until its window passes");

  // Auth error → needs attention, never retried
  await store.set(COL.providers, "A", { state: {} }, { merge: true });
  ai.setAdapterForTests("groq", { async chat() { aCalls++; throw new ai.AiError("A 401", "auth"); } });
  await ai.chat({ system: "s", user: "u", json: { name: "ping", schema: {} } });
  const before = aCalls;
  await ai.chat({ system: "s", user: "u", json: { name: "ping", schema: {} } });
  assert.equal(aCalls, before);
  assert.ok((await store.get<ProviderConfig & Record<string, unknown>>(COL.providers, "A"))!.state.needsAttention);

  // All limited → NoProviderAvailableError with a retry time
  ai.setAdapterForTests("openai_compatible", { async chat() { throw new ai.AiError("B 429", "rate_limit", 60); } });
  await assert.rejects(ai.chat({ system: "s", user: "u" }), (e: unknown) => e instanceof ai.AiError || e instanceof ai.NoProviderAvailableError);
  await assert.rejects(ai.chat({ system: "s", user: "u" }), (e: unknown) => e instanceof ai.NoProviderAvailableError && e.reason !== "none_configured");

  const usage = await store.list<{ requests: number; rateLimits: number; estimatedCost: number | null } & Record<string, unknown>>(COL.usage);
  assert.ok(usage.reduce((s, u) => s + u.requests, 0) >= 5);
  assert.ok(usage.reduce((s, u) => s + u.rateLimits, 0) >= 2);
  assert.ok(usage.some((u) => u.estimatedCost !== null));

  // Reset for the pipeline tests: one healthy provider
  await store.remove(COL.providers, "A");
  await store.set(COL.providers, "B", { state: {} }, { merge: true });
  ai.setAdapterForTests("openai_compatible", { async chat(_c, _k, req) { return mockModel(req); } });
});

async function seedRegistry() {
  const t = now();
  await store.set(COL.countries, "it", { name: "Italy", code: "IT", active: true, currency: "EUR", academicYearStartMonth: 9, academicYearFormat: "YYYY/YYYY", extraCategories: [], createdAt: t, updatedAt: t });
  await store.set(COL.universities, "unitest", { countryId: "it", name: "University of Testville", website: "https://www.unitest.it/", officialDomains: ["unitest.it"], campuses: [], departments: [], courses: [], scholarshipIds: [], researchEnabled: true, createdAt: t, updatedAt: t });
  await store.set(COL.sources, "src-unitest-int", { name: "Testville International", url: "https://www.unitest.it/international", countryId: "it", universityId: "unitest", category: "university", monitor: false, frequencyHours: 24, consecutiveFailures: 0, createdAt: t, updatedAt: t });
}

async function runToEnd(jobId: string, owner = "test", max = 60) {
  for (let i = 0; i < max; i++) {
    const r = await runJobStep(jobId, owner);
    if (["completed", "needs_review", "failed", "waiting_network", "waiting_api", "skipped"].includes(r.result)) return r;
  }
  throw new Error("pipeline did not finish");
}

test("pipeline: researches, cites, verifies and saves a draft; counted once; no duplicate jobs", async () => {
  await seedRegistry();
  await saveSettings({ automation: { enabled: true, dailyTarget: 5, autoPickTopics: true, maxRetries: 3, maxJobsPerDay: 12, minSourcesForDraft: 2, minWords: 500 } });
  const { topic } = await addTopic({ title: "University of Testville complete guide", category: "university_guide", countryId: "it", entityIds: ["unitest"], origin: "manual", status: "approved" });
  assert.ok(topic);
  const { job, created } = await createJob({ topic: topic!.title, category: "university_guide", countryId: "it", entityIds: ["unitest"], origin: "manual", topicId: topic!.id });
  assert.ok(created);
  const again = await createJob({ topic: topic!.title, category: "university_guide", countryId: "it", origin: "manual", topicId: topic!.id });
  assert.equal(again.created, false, "same topic never creates a second job");

  const r = await runToEnd(job.id);
  assert.equal(r.result, "completed", `expected completed, got ${r.result}: ${r.message}`);
  const done = (await getJob(job.id))!;
  const art = (await getArticle(done.articleId!))!;
  assert.equal(art.status, "draft");
  assert.ok(art.sources.length >= 2, "facts from at least two official pages");
  assert.ok(art.facts.every((f) => !/number one/.test(f.quote)), "fabricated quote discarded");
  assert.ok(/\[\[\d+]]/.test(art.body), "citations inserted");
  assert.ok(art.claims.some((c) => c.status === "verified"));
  assert.ok(!art.warnings.some((w) => w.message === "hallucinated issue"), "AI review issues must quote the article");
  assert.equal(art.academicYear, "2027/2028");
  assert.ok(art.generation?.calls.length, "provider audit trail stored");
  assert.ok(art.coverImage?.url.startsWith("https://store.public.blob.vercel-storage.com/skolar/articles/"), "cover uploaded to Blob");
  assert.match(art.coverImage!.url, /\/cover-v1-[a-f0-9]{12}\.webp$/);
  assert.ok(art.coverImage?.cardUrl?.includes("/card-v1-"));
  assert.equal(art.images?.length, 1);
  assert.equal(art.images![0].qc?.passed, true);
  assert.equal(art.imageState?.status, "ready");
  const { jobEvents } = await import("../src/studio/core/events");
  const evs = await jobEvents(job.id);
  for (const st of ["plan", "collect", "write", "image_generate", "image_upload", "finalize"]) {
    assert.equal(evs.filter((e) => e.type === "stage_started" && e.stage === st).length, 1, `one stage_started event for ${st}`);
    assert.equal(evs.filter((e) => e.type === "stage_completed" && e.stage === st).length, 1, `one stage_completed event for ${st}`);
  }
  assert.ok(evs.some((e) => e.type === "progress" && /^Reading https:\/\/www\.unitest\.it/.test(e.message)), "live progress names the page being read");
  assert.ok(evs.some((e) => e.type === "job_completed"));

  const day = await getDay(await todayKey());
  assert.equal(day.completedDraftIds.filter((x) => x === art.id).length, 1);
  // Re-running a finished job does nothing and does not double count.
  assert.equal((await runJobStep(job.id, "test")).result, "skipped");
  assert.equal((await getDay(await todayKey())).completedDraftIds.length, 1);
});

test("resume: a crash mid-pipeline continues from the last checkpoint without repeating stages", async () => {
  const { topic } = await addTopic({ title: "Testville international admissions explained", category: "admissions", countryId: "it", entityIds: ["unitest"], origin: "manual", status: "approved" }, { allowDuplicate: true });
  const { job } = await createJob({ topic: topic!.title, category: "admissions", countryId: "it", entityIds: ["unitest"], origin: "manual", topicId: topic!.id });
  // run until writing has started
  for (let i = 0; i < 40; i++) {
    await runJobStep(job.id, "worker-1");
    const j = (await getJob(job.id))!;
    if (j.stage === "write" && (j.checkpoints.write as { sections?: unknown[] } | undefined)?.sections?.length) break;
  }
  // Simulate a crash: job left "running" with an expired lease.
  await store.transact(COL.jobs, job.id, (j) => (j ? { ...j, status: "running", lease: { owner: "worker-1", until: new Date(Date.now() - 1000).toISOString() } } : undefined));
  const plansBefore = aiCalls.filter((c) => c === "research_plan").length;
  const extractBefore = aiCalls.filter((c) => c === "facts").length;
  const next = await nextRunnableJob();
  assert.equal(next?.id, job.id, "crashed job is picked up again");
  const r = await runToEnd(job.id, "worker-2");
  assert.ok(["completed", "needs_review"].includes(r.result));
  assert.equal(aiCalls.filter((c) => c === "research_plan").length, plansBefore, "plan not repeated");
  assert.equal(aiCalls.filter((c) => c === "facts").length, extractBefore, "extraction not repeated");
});

test("network interruption: job waits for the network (no retry burned) and resumes", async () => {
  const { topic } = await addTopic({ title: "Testville orientation week overview", category: "student_life", countryId: "it", entityIds: ["unitest"], origin: "manual", status: "approved" }, { allowDuplicate: true });
  const { job } = await createJob({ topic: topic!.title, category: "student_life", countryId: "it", entityIds: ["unitest"], origin: "manual", topicId: topic!.id });
  await runJobStep(job.id, "w"); // plan
  await runJobStep(job.id, "w"); // sources
  offline = true;
  const r = await runJobStep(job.id, "w"); // collect
  assert.equal(r.result, "waiting_network");
  const j = (await getJob(job.id))!;
  assert.equal(j.retryCount, 0);
  assert.equal(j.stage, "collect");
  offline = false;
  await store.transact(COL.jobs, job.id, (x) => (x ? { ...x, nextRunAt: undefined } : undefined));
  const end = await runToEnd(job.id, "w");
  assert.ok(["completed", "needs_review"].includes(end.result));
  await controlJob(job.id, "cancel").catch(() => undefined);
});

test("publishing: commit → deployment → live verification; idempotent; failures keep the draft; retry without duplicate commits", async () => {
  const day = await getDay(await todayKey());
  const id = day.completedDraftIds[0];
  const a0 = (await getArticle(id))!;
  assert.ok(a0.coverImage?.url?.includes(".public.blob.vercel-storage.com/skolar/articles/"), "pipeline produced a Blob cover image");
  await updateArticle(id, { warnings: [] });
  await store.set(COL.articles, id, { status: "approved" }, { merge: true });

  // 1. Local file target (no GitHub): written locally, NOT marked published until the live site shows it.
  const p1 = await publishArticle(id, { actor: "admin", revalidate: async () => undefined });
  assert.equal(p1.status, "publishing");
  assert.equal(p1.publish?.state, "awaiting_push");
  const file = path.join(root, "content", "insights", `${p1.slug}.md`);
  const first = fs.readFileSync(file, "utf8");
  assert.ok(first.includes(`contentKey: ${p1.publish!.contentKey}`));
  const p2 = await publishArticle(id, { actor: "admin", revalidate: async () => undefined });
  assert.equal(p2.publish?.contentHash, p1.publish?.contentHash, "re-publish without changes produces identical content");
  assert.equal(fs.readFileSync(file, "utf8"), first);
  // the live site now serves this version → verified → published
  liveKeys[p1.slug] = p1.publish!.contentKey!;
  const live = await advanceOne(id, async () => undefined);
  assert.equal(live?.status, "published");
  assert.ok(live?.publish?.verifiedAt);
  assert.equal((await getDay(await todayKey())).publishedIds.filter((x) => x === id).length, 1);

  // 2. GitHub target: an edit → update commit → deployment pending → ready → verification.
  process.env.GITHUB_TOKEN = "ghp_testtoken1234567890";
  process.env.GITHUB_REPO = "acme/site";
  githubFiles = {};
  githubCommits = 0;
  deployState = "pending";
  await updateArticle(id, { excerpt: `${a0.excerpt} (updated)` });
  const g1 = await publishArticle(id, { actor: "admin", revalidate: async () => undefined });
  assert.equal(g1.status, "published", "an update keeps the old version live meanwhile");
  assert.equal(g1.publish?.state, "deploying");
  assert.equal(githubCommits, 1);
  assert.equal(g1.publish?.commitSha, "commit1");
  // deployment still building → stays deploying
  assert.equal((await advanceOne(id))?.publish?.state, "deploying");
  // deployment ready but the old version is still served → verifying, not published
  deployState = "success";
  assert.equal((await advanceOne(id))?.publish?.state, "verifying");
  liveKeys[g1.slug] = g1.publish!.contentKey!;
  const g2 = await advanceOne(id);
  assert.equal(g2?.publish?.state, "published");
  assert.equal(g2?.publish?.deploymentId, "7");
  // re-publish unchanged → no new commit
  await publishArticle(id, { actor: "admin", revalidate: async () => undefined });
  assert.equal(githubCommits, 1, "unchanged content → no second commit");
  assert.ok((await getArticle(id))!.publishHistory!.some((h) => h.action === "no_change"));

  // 3. Deployment failure → failed; retry re-checks without a new commit.
  await updateArticle(id, { excerpt: `${a0.excerpt} (second update)` });
  deployState = "failure";
  const f1 = await publishArticle(id, { actor: "admin", revalidate: async () => undefined });
  assert.equal(githubCommits, 2);
  const f2 = await advanceOne(f1.id);
  assert.equal(f2?.publish?.state, "failed");
  assert.equal(f2?.publish?.failedStep, "deployment");
  deployState = "success";
  liveKeys[f1.slug] = f1.publish!.contentKey!;
  const f3 = await retryPublish(id, async () => undefined);
  assert.equal(githubCommits, 2, "retrying a failed deployment does not commit again");
  assert.equal(f3?.publish?.state, "published");

  // 4. Commit failure on another article keeps it approved.
  const other = (await getDay(await todayKey())).completedDraftIds.find((x) => x !== id)!;
  await updateArticle(other, { warnings: [], slug: `${(await getArticle(other))!.slug}-x` });
  await store.set(COL.articles, other, { status: "approved" }, { merge: true });
  githubFail = true;
  await assert.rejects(publishArticle(other, { actor: "admin", revalidate: async () => undefined }));
  const failed = (await getArticle(other))!;
  assert.equal(failed.status, "approved");
  assert.equal(failed.publish?.state, "failed");
  assert.equal(failed.publish?.failedStep, "commit");
  githubFail = false;
  // validation: a broken citation blocks publishing
  await updateArticle(other, { body: `${failed.body}\n\nExtra claim [[99]].` });
  await assert.rejects(publishArticle(other, { actor: "admin", revalidate: async () => undefined }), /Citations \[\[99\]\] have no matching source/);
  delete process.env.GITHUB_TOKEN;
  delete process.env.GITHUB_REPO;
});

test("scheduling: next free slot, stale preview rejected, due articles publish once", async () => {
  await saveSettings({ publishing: { timezone: "Asia/Kolkata", times: ["18:00"], days: [0, 1, 2, 3, 4, 5, 6], maxPerDay: 1, minIntervalMinutes: 60, allowWeekends: true, autoQueue: true } });
  const t = now();
  const mk = async (id: string) => {
    await store.set(COL.articles, id, {
      id, slug: id, title: `Sched ${id}`, excerpt: "Excerpt text", body: "word ".repeat(300), category: "practical", countryId: "it", universityIds: [], scholarshipIds: [], audience: "", seoTitle: "S", metaDescription: "M", readingMinutes: 2, tags: [],
      coverImage: { url: "/images/library-dome.webp", alt: "Library" }, sources: [], facts: [], claims: [], warnings: [], relatedSlugs: [], status: "approved", origin: "manual", version: 1, createdAt: t, updatedAt: t,
    });
  };
  await mk("s-one");
  await mk("s-two");
  const preview = await previewSlot("s-one");
  const a1 = await scheduleArticle("s-one", { expectedSlot: preview! });
  assert.equal(a1.schedule?.at, preview);
  await assert.rejects(scheduleArticle("s-two", { expectedSlot: preview! }), /queue changed/);
  const a2 = await scheduleArticle("s-two", {});
  assert.notEqual(a2.schedule?.at, a1.schedule?.at);
  assert.ok(Date.parse(a2.schedule!.at) - Date.parse(a1.schedule!.at) >= 86400_000 - 1000, "max 1 per day");

  // Make s-one due and run the publisher twice
  await store.transact(COL.articles, "s-one", (x) => (x ? { ...x, schedule: { ...(x.schedule as object), at: new Date(Date.now() - 60_000).toISOString() } } : undefined));
  const r1 = await publishDue({ actor: "worker", revalidate: async () => undefined });
  assert.deepEqual(r1.map((r) => [r.id, r.ok]), [["s-one", true]]);
  assert.equal((await getArticle("s-one"))!.status, "publishing", "committed/written, waiting for the live page");
  const r2 = await publishDue({ actor: "worker", revalidate: async () => undefined });
  assert.equal(r2.length, 0, "already published → not published again");
  assert.equal((await getArticle("s-two"))!.status, "scheduled", "future article untouched");
});

test("worker: single instance lock", async () => {
  fs.mkdirSync(process.env.STUDIO_DATA_DIR!, { recursive: true });
  const lock = path.join(process.env.STUDIO_DATA_DIR!, "worker.pid");
  fs.writeFileSync(lock, String(process.ppid)); // a live process
  assert.equal(acquirePidLock(), false, "second worker refuses to start");
  fs.writeFileSync(lock, "99999999"); // stale
  assert.equal(acquirePidLock(), true, "stale lock is taken over");
  releasePidLock();
});

test("worker: starts, discovers a topic, produces drafts up to the daily target, then stops (once mode)", async () => {
  const before = (await getDay(await todayKey())).completedDraftIds.length;
  await saveSettings({ automation: { enabled: true, dailyTarget: before + 1, autoPickTopics: true, maxRetries: 3, maxJobsPerDay: 20, minSourcesForDraft: 2, minWords: 500 } });
  // A fresh registry entity gives discovery something new to suggest.
  const t = now();
  await store.set(COL.universities, "unitest2", { countryId: "it", name: "University of Testburg", website: "https://www.unitest.it/", officialDomains: ["unitest.it"], campuses: [], departments: [], courses: [], scholarshipIds: [], researchEnabled: true, createdAt: t, updatedAt: t });
  const logs: string[] = [];
  await runWorker({ once: true, log: (m) => logs.push(m), idleSleepMs: 10, stepSleepMs: 0 });
  const after = (await getDay(await todayKey())).completedDraftIds.length;
  assert.equal(after, before + 1, `worker reached the target. Log:\n${logs.slice(-15).join("\n")}`);
  const { listWorkers } = await import("../src/studio/core/worker");
  const ws = await listWorkers();
  assert.equal(ws.length, 1);
  assert.equal(ws[0].state, "stopped");
  assert.equal(ws[0].cleanShutdown, true);
  assert.equal(ws[0].online, false);
  web.restore();
});
