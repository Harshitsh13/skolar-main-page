/**
 * Feature tests for SKOLAR Studio round 2 (MOCKED external services: AI image
 * provider, Vercel Blob SDK, websites, deployment). Real: store, encryption,
 * renderer (resvg/sharp with the brand fonts), job queue, worker leases.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { html, mockFetch, setupEnv } from "./helpers.mts";

const root = setupEnv("features");
process.env.NEXT_PUBLIC_SITE_URL = "https://site.test";
process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_test_token";
process.env.STUDIO_ENCRYPTION_KEY = "test-encryption-key-0123456789-abcdef";

const { getStore, COL } = await import("../src/studio/core/store");
const media = await import("../src/studio/core/media");
const secrets = await import("../src/studio/core/secrets");
const images = await import("../src/studio/core/images/service");
const providers = await import("../src/studio/core/images/providers");
const gallery = await import("../src/studio/core/images/articleImages");
const { blankArticle } = await import("../src/studio/core/articles");
const store = getStore();

/* ── in-memory Blob with injectable failures ── */
const blobs = new Map<string, Buffer>();
let blobFailures = 0;
let blobCalls = 0;
media.setBlobApiForTests({
  put: (async (pathname: string, body: Buffer, o: { allowOverwrite?: boolean }) => {
    blobCalls++;
    if (blobFailures > 0) {
      blobFailures--;
      throw new Error("BlobServiceNotAvailable: 503");
    }
    if (blobs.has(pathname) && !o.allowOverwrite) throw new Error("This blob already exists");
    blobs.set(pathname, body);
    return { url: `https://store.public.blob.vercel-storage.com/${pathname}`, pathname };
  }) as never,
  head: (async (pathname: string) => ({ url: `https://store.public.blob.vercel-storage.com/${pathname}`, pathname })) as never,
  del: (async (urls: string[]) => {
    for (const u of [urls].flat()) blobs.delete(u.replace(/^https:\/\/[^/]+\//, ""));
  }) as never,
});

const siteKeys: Record<string, string> = {};
const web = mockFetch([
  (url) => (url.includes("generate_204") ? new Response(null, { status: 204 }) : null),
  (url) => {
    const m = /^https:\/\/site\.test\/countries\/([a-z0-9-]+)/.exec(url);
    if (!m) return null;
    return siteKeys[m[1]] ? html(`<meta name="skolar-content-key" content="${siteKeys[m[1]]}">`) : new Response("nf", { status: 404 });
  },
  (url) => (url === "https://uni.test/robots.txt" ? new Response("User-agent: *\nDisallow: /private\nSitemap: https://uni.test/sitemap.xml") : null),
  (url) =>
    url === "https://uni.test/sitemap.xml"
      ? new Response(
          `<?xml version="1.0"?><urlset>${[
            "/international/admission-for-foreign-students",
            "/didattica/tasse-e-contributi",
            "/borse-di-studio-2026-2027",
            "/corsi-di-laurea/computer-science",
            "/servizi/alloggi",
            "/news/rector-visits-museum",
            "/private/admin",
            "/amministrazione-trasparente/bandi-di-gara",
          ]
            .map((p) => `<url><loc>https://uni.test${p}</loc></url>`)
            .join("")}</urlset>`,
          { headers: { "content-type": "application/xml" } },
        )
      : null,
  (url) => (url.startsWith("https://suggestqueries.google.com/") ? Response.json(["q", ["study in italy without ielts", "study in italy fees"]]) : null),
  (url) => (url.startsWith("https://store.public.blob.vercel-storage.com/") ? new Response("ok") : null),
]);

/* ═════════════ Encryption ═════════════ */

test("encryption: AES-256-GCM round trip, tamper detection, key rotation, no plaintext at rest", () => {
  const enc = secrets.encryptSecret("gsk_supersecretvalue123456");
  assert.match(enc, /^enc:v2:[a-f0-9]{8}:/);
  assert.ok(!enc.includes("supersecret"));
  assert.equal(secrets.decryptSecret(enc), "gsk_supersecretvalue123456");
  const parts = enc.split(":");
  const data = Buffer.from(parts[5], "base64");
  data[0] ^= 1;
  parts[5] = data.toString("base64");
  assert.throws(() => secrets.decryptSecret(parts.join(":")), /authentication/);
  assert.equal(secrets.encryptionSelfTest().ok, true);

  // rotate: new key, old key as previous → old ciphertext still readable, flagged for re-encryption
  process.env.STUDIO_ENCRYPTION_KEY_PREVIOUS = process.env.STUDIO_ENCRYPTION_KEY;
  process.env.STUDIO_ENCRYPTION_KEY = "rotated-key-9876543210-zyxwvutsrqponm";
  assert.equal(secrets.decryptSecret(enc), "gsk_supersecretvalue123456");
  assert.equal(secrets.needsReencryption(enc), true);
  const re = secrets.encryptSecret(secrets.decryptSecret(enc));
  assert.equal(secrets.needsReencryption(re), false);
  // without the previous key the old value is unreadable — but never returns garbage
  delete process.env.STUDIO_ENCRYPTION_KEY_PREVIOUS;
  assert.throws(() => secrets.decryptSecret(enc), /not configured/);
  assert.equal(secrets.resolveSecret(enc), null);
  // missing key → saving is refused (nothing stored unencrypted)
  const k = process.env.STUDIO_ENCRYPTION_KEY;
  delete process.env.STUDIO_ENCRYPTION_KEY;
  assert.throws(() => secrets.encryptSecret("x"), /not configured/);
  process.env.STUDIO_ENCRYPTION_KEY = k;
});

/* ═════════════ Images ═════════════ */

const article = (id: string, title: string, category: string, body: string) =>
  blankArticle({ id, title, category: category as never, body, academicYear: "2027/2028", origin: "ai", status: "draft" });

test("images: different articles get different, QC-passed concepts; renditions have the right sizes", async () => {
  const sharp = (await import("sharp")).default;
  const a = article("art_a", "University of Messina vs University of Palermo", "comparison", "## Programmes\n\nx\n\n## Fees\n\nx");
  const b = article("art_b", "ERSU Messina scholarship guide 2026/2027", "scholarship", "## Eligibility\n\nx\n\n## Benefits\n\nx");
  const ga = await images.generateImage({ ...a, images: [] }, { allowAi: false });
  const gb = await images.generateImage({ ...b, images: [] }, { allowAi: false });
  assert.equal(ga.concept.format, "versus");
  assert.equal(gb.concept.format, "bulletin");
  assert.deepEqual(ga.rendered.problems, []);
  const mc = await sharp(ga.rendered.cover).metadata();
  const mk = await sharp(ga.rendered.card).metadata();
  assert.deepEqual([mc.width, mc.height, mc.format], [1600, 1000, "webp"]);
  assert.deepEqual([mk.width, mk.height], [1200, 900]);
  assert.ok(images.hamming(ga.rendered.hash, gb.rendered.hash) > 6, "visually different");
  // regenerating the same article picks a different concept than its previous image
  const img1 = await images.uploadGenerated(a.id, ga, 1, images.altFor(a, ga.concept));
  const g2 = await images.generateImage({ ...a, images: [img1] }, { allowAi: false });
  assert.notEqual(`${g2.concept.format}|${g2.concept.palette}`, `${ga.concept.format}|${ga.concept.palette}`);
  // headline/labels only come from the article — no invented numbers drawn in the image
  assert.ok(!/\d{3,}/.test(ga.concept.spec.headline.replace(/20\d{2}\/20\d{2}/, "")));
});

test("images: AI provider base image is composited with SKOLAR branding; permanent failure falls back; transient failure retries", async () => {
  const sharp = (await import("sharp")).default;
  const scene = await sharp({ create: { width: 1536, height: 1024, channels: 3, background: "#556677" } }).png().toBuffer();
  let calls = 0;
  let prompts: string[] = [];
  const mockAi = {
    key: "openai" as const,
    label: "Mock images",
    model: () => "mock-image-1",
    configured: () => true,
    missing: () => "",
    test: async () => ({ ok: true, message: "ok" }),
    generate: async (prompt: string) => {
      calls++;
      prompts.push(prompt);
      return scene;
    },
  };
  providers.setAiImageProviderForTests(mockAi);
  const a = article("art_ai", "Living in Bologna as an international student", "student_life", "## Housing\n\nx");
  const g = await images.generateImage({ ...a, images: [] });
  assert.equal(g.concept.format, "ai");
  assert.equal(g.provider, "openai");
  assert.equal(calls, 1);
  assert.match(prompts[0], /No text, no letters, no logos, no crests/);
  assert.deepEqual(g.rendered.problems, []);

  // permanent failure (e.g. invalid key) → no placeholder; falls back to a rendered SKOLAR format and records why
  providers.setAiImageProviderForTests({ ...mockAi, generate: async () => { throw new providers.ImageProviderError("OpenAI HTTP 401: invalid key", true); } });
  const g2 = await images.generateImage({ ...a, images: [] });
  assert.notEqual(g2.concept.format, "ai");
  // transient failure → error is thrown so the job stage retries
  providers.setAiImageProviderForTests({ ...mockAi, generate: async () => { throw new providers.ImageProviderError("OpenAI network error", false); } });
  await assert.rejects(images.generateImage({ ...a, images: [] }), /network/);
  providers.setAiImageProviderForTests(null);
});

test("blob: versioned paths, retry on transient errors, idempotent re-upload, clear error without token", async () => {
  const a = article("art_blob", "Opening a bank account in Italy", "practical", "## Documents\n\nx\n\n## Steps\n\nx");
  const g = await images.generateImage({ ...a, images: [] }, { allowAi: false });
  blobFailures = 2;
  blobCalls = 0;
  const img = await images.uploadGenerated(a.id, g, 3, "alt");
  assert.ok(blobCalls >= 4, "retried after transient failures");
  assert.match(img.url, /\/skolar\/articles\/art_blob\/cover-v3-[a-f0-9]{12}\.webp$/);
  assert.match(img.cardUrl!, /\/skolar\/articles\/art_blob\/card-v3-[a-f0-9]{12}\.webp$/);
  const again = await images.uploadGenerated(a.id, g, 3, "alt");
  assert.equal(again.url, img.url, "same content + version → same blob (no duplicate)");
  const tok = process.env.BLOB_READ_WRITE_TOKEN;
  delete process.env.BLOB_READ_WRITE_TOKEN;
  await assert.rejects(images.uploadGenerated(a.id, g, 4, "alt"), /BLOB_READ_WRITE_TOKEN/);
  process.env.BLOB_READ_WRITE_TOKEN = tok;
});

test("gallery: regenerate adds + switches cover; the cover cannot be deleted; deleting removes the Blob file only after unreferencing", async () => {
  const a = article("art_gal", "Universitaly pre-enrolment step by step", "admissions", "## Create an account\n\nx\n\n## Upload documents\n\nx");
  await store.set(COL.articles, a.id, a as unknown as Record<string, unknown>);
  const r1 = await gallery.regenerateImage(a.id, { allowAi: false });
  const first = r1.images![0];
  assert.equal(r1.coverImage?.imageId, first.id);
  const r2 = await gallery.regenerateImage(a.id, { allowAi: false });
  assert.equal(r2.images!.length, 2);
  const second = r2.images![1];
  assert.equal(r2.coverImage?.imageId, second.id);
  await assert.rejects(gallery.deleteImage(a.id, second.id), /in use/);
  const firstPath = first.url.replace(/^https:\/\/[^/]+\//, "");
  assert.ok(blobs.has(firstPath));
  const r3 = await gallery.deleteImage(a.id, first.id);
  assert.equal(r3.images!.length, 1);
  assert.ok(!blobs.has(firstPath), "old file deleted after it was no longer referenced");
  const r4 = await gallery.selectImage(a.id, second.id);
  assert.equal(r4.coverImage?.url, second.url);
});

/* ═════════════ Worker identity & locking ═════════════ */

test("workers: two instances share the queue without processing the same job twice; one leader", async () => {
  const ai = await import("../src/studio/core/ai");
  const jobsMod = await import("../src/studio/core/jobs");
  const worker = await import("../src/studio/core/worker");
  // A trivial provider so jobs can run: plan→… will fail fast at "sources" with no registry (PipelineHalt) — enough to test locking.
  const now = new Date().toISOString();
  await store.set(COL.providers, "P", { id: "P", name: "P", kind: "groq", baseUrl: "https://x.invalid/v1", model: "m", keyRef: "env:TEST_KEY", keyHint: "", enabled: true, priority: 1, structuredOutput: "json_schema", capabilities: [], pricing: null, state: {}, createdAt: now, updatedAt: now });
  process.env.TEST_KEY = "k";
  ai.setAdapterForTests("groq", {
    async chat() {
      await new Promise((r) => setTimeout(r, 40));
      return { text: JSON.stringify({ intent: "i", audience: "a", angle: "x", questions: ["q"], queries: ["q"], entities: [] }), inputTokens: 1, outputTokens: 1, model: "m" };
    },
  });
  const ids: string[] = [];
  for (let i = 0; i < 4; i++) ids.push((await jobsMod.createJob({ topic: `Lock test topic number ${i} about Italy`, category: "other", countryId: "it", origin: "manual" })).job.id);
  await Promise.all([
    worker.runWorker({ once: true, instanceId: "wk-alpha-11111111", skipPidLock: true, idleSleepMs: 10, stepSleepMs: 0, heartbeatMs: 200, log: () => undefined }),
    worker.runWorker({ once: true, instanceId: "wk-beta-22222222", skipPidLock: true, idleSleepMs: 10, stepSleepMs: 0, heartbeatMs: 200, log: () => undefined }),
  ]);
  const { jobEvents } = await import("../src/studio/core/events");
  const owners = new Set<string>();
  for (const id of ids) {
    const evs = await jobEvents(id);
    const starts = evs.filter((e) => e.type === "stage_started" && e.stage === "plan");
    assert.equal(starts.length, 1, `plan started exactly once for ${id}`);
    owners.add(starts[0].worker!);
    const j = await jobsMod.getJob(id);
    assert.ok(["needs_review", "failed"].includes(j!.status), `job ended (${j!.status})`);
  }
  const ws = await worker.listWorkers();
  assert.deepEqual(ws.map((w) => w.id).sort(), ["wk-alpha-11111111", "wk-beta-22222222"]);
  assert.ok(ws.every((w) => w.cleanShutdown));
  assert.ok(owners.size >= 1);
  // leader lease: only one holder at a time, released on shutdown, and a crashed holder's lease expires
  assert.equal(await worker.acquireLease("wk-gamma"), true);
  assert.equal(await worker.acquireLease("wk-delta"), false);
  await store.set(COL.worker, "lease", { owner: "wk-gamma", until: new Date(Date.now() - 1000).toISOString() });
  assert.equal(await worker.acquireLease("wk-delta"), true, "expired lease (crashed worker) is taken over");
});

/* ═════════════ Countries ═════════════ */

test("countries: validation, publish writes the public file, verification marks live, deactivation hides", async () => {
  const countries = await import("../src/studio/core/countries");
  const now = new Date().toISOString();
  await store.set(COL.countries, "de", { name: "Germany", code: "DE", active: true, currency: "EUR", academicYearStartMonth: 10, academicYearFormat: "YYYY/YYYY", extraCategories: [], createdAt: now, updatedAt: now });
  await assert.rejects(countries.publishCountry("de", async () => undefined), /Card title is required/);
  await store.set(COL.countries, "de", { slug: "germany", flag: "🇩🇪", cardTitle: "Study in Germany", shortDescription: "Public universities with low fees.", image: { url: "https://store.public.blob.vercel-storage.com/skolar/countries/de.webp", alt: "Campus" }, introContent: "## Why Germany\n\nText.", order: 3 }, { merge: true });
  const c1 = await countries.publishCountry("de", async () => undefined);
  // a second country with the same slug is rejected
  await store.set(COL.countries, "at", { name: "Austria", code: "AT", slug: "germany", active: false, currency: "EUR", academicYearStartMonth: 10, academicYearFormat: "YYYY/YYYY", extraCategories: [], createdAt: now, updatedAt: now });
  await assert.rejects(countries.publishCountry("at", async () => undefined), /already used/);
  await store.remove(COL.countries, "at");
  assert.equal(c1.publish?.state, "awaiting_push");
  const file = path.join(root, "content", "countries", "germany.json");
  const pub = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.equal(pub.cardTitle, "Study in Germany");
  assert.equal(pub.active, true);
  siteKeys.germany = pub.contentKey;
  assert.equal((await countries.advanceCountry("de"))?.publish?.state, "published");
  // deactivate → file says inactive
  await store.set(COL.countries, "de", { active: false }, { merge: true });
  await countries.publishCountry("de", async () => undefined);
  assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).active, false);
  // import existing homepage countries (fills, never overwrites)
  const r = await countries.importExistingCountries();
  assert.ok(r.created + r.updated >= 1);
  const it = await store.get<{ cardTitle: string; platformUrl: string } & Record<string, unknown>>(COL.countries, "it");
  assert.equal(it?.platformUrl, "https://italy.skolar.it/");
});

/* ═════════════ Discovery & demand ═════════════ */

test("official page discovery: sitemap pages classified, noise and robots-blocked paths skipped, de-duplicated, verify → registry", async () => {
  const disc = await import("../src/studio/core/discovery");
  const now = new Date().toISOString();
  await store.set(COL.universities, "uni", { countryId: "it", name: "University of Test", website: "https://uni.test", officialDomains: ["uni.test"], campuses: [], departments: [], courses: [], scholarshipIds: [], researchEnabled: true, createdAt: now, updatedAt: now });
  const run = await disc.discoverOfficialPages({ institutionId: "uni" });
  const pages = await disc.listDiscovered();
  const cats = Object.fromEntries(pages.map((p) => [new URL(p.url).pathname, p.category]));
  assert.equal(cats["/international/admission-for-foreign-students"], "admissions");
  assert.equal(cats["/didattica/tasse-e-contributi"], "fees");
  assert.equal(cats["/borse-di-studio-2026-2027"], "scholarships");
  assert.equal(cats["/corsi-di-laurea/computer-science"], "courses");
  assert.equal(cats["/servizi/alloggi"], "housing");
  assert.equal(cats["/news/rector-visits-museum"], undefined, "unclassified news page skipped");
  assert.equal(cats["/amministrazione-trasparente/bandi-di-gara"], undefined, "procurement noise skipped");
  assert.equal(run.added, pages.length);
  const again = await disc.discoverOfficialPages({ institutionId: "uni" });
  assert.equal(again.added, 0, "no duplicates on re-run");
  const src = await disc.verifyDiscovered(pages.find((p) => p.category === "scholarships")!.id);
  assert.equal(src.universityId, "uni");
  assert.equal(src.monitor, true);
  assert.equal((await disc.listDiscovered()).find((p) => p.id === pages.find((x) => x.category === "scholarships")!.id)?.status, "verified");
});

test("demand: signals are labelled by real source; Google Trends never claimed; suggestions only when enabled", async () => {
  const demand = await import("../src/studio/core/demand");
  const { saveSettings } = await import("../src/studio/core/settings");
  let r = await demand.collectDemand();
  assert.ok(r.notes.some((n) => /Google Trends: waiting/.test(n)));
  assert.ok(!r.candidates.some((c) => c.signal.kind === "google_trends"));
  assert.equal(r.candidates.filter((c) => c.signal.kind === "search_suggestion").length, 0, "disabled by default");
  await saveSettings({ demand: { suggestEnabled: true } });
  r = await demand.collectDemand();
  const sug = r.candidates.filter((c) => c.signal.kind === "search_suggestion");
  assert.ok(sug.length > 0);
  assert.ok(sug.every((c) => /unofficial/.test(c.signal.source) && c.signal.collectedAt));
  await assert.rejects(demand.googleTrends(), /not been granted/);
});

/* ═════════════ Integration centre ═════════════ */

test("integrations: never 'connected' without a passing test of the current configuration", async () => {
  const integ = await import("../src/studio/core/integrations");
  let list = await integ.listIntegrations();
  const st = (k: string) => list.find((i) => i.key === k)!.state;
  assert.equal(st("google-trends"), "waiting_access");
  assert.equal(st("image-ai"), "not_configured");
  assert.equal(st("github"), "not_configured");
  assert.equal(st("blob"), "configured_untested");
  assert.equal(st("suggest"), "configured_untested", "enabled in the previous test");
  const r = await integ.testIntegration("blob");
  assert.equal(r.ok, true, r.message);
  const d = await integ.testIntegration("database");
  assert.equal(d.ok, true);
  const e = await integ.testIntegration("encryption");
  assert.equal(e.ok, true, e.message);
  list = await integ.listIntegrations();
  assert.equal(st("blob"), "connected");
  assert.equal(st("database"), "connected");
  assert.equal(st("encryption"), "connected");
  // configuration change → back to untested
  process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_other_token";
  list = await integ.listIntegrations();
  assert.equal(st("blob"), "configured_untested");
  const g = await integ.testIntegration("github");
  assert.equal(g.ok, false);
  assert.match(g.message, /Not configured/);
  web.restore();
});
