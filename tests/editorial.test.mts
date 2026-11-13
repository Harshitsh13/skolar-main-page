/**
 * Regression tests for the SKOLAR Studio editorial workflow (Nov 2026 fixes):
 * source lifecycle, [[n]] citation resolution, the claim checker (negation,
 * disclaimers, passage/table citations, estimates), manual vs AI approval,
 * AI improvements that never overwrite, Blob cover upload, and publishing
 * (technical errors block; editorial warnings are kept on the record).
 *
 * Real: local store, checker, image optimisation (sharp), Markdown file build.
 * Mocked: Vercel Blob SDK (in-memory), AI provider, the public website fetch.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { html, mockFetch, setupEnv } from "./helpers.mts";

setupEnv("editorial");
process.env.NEXT_PUBLIC_SITE_URL = "https://site.test";
process.env.BLOB_READ_WRITE_TOKEN = "vercel_blob_rw_test_token";
process.env.TEST_AI_KEY = "test-ai-key-123456789";

const here = path.dirname(fileURLToPath(import.meta.url));
const ARTICLE = fs.readFileSync(path.join(here, "fixtures", "italy-cost-article.md"), "utf8");

const storeMod = await import("../src/studio/core/store");
const { getStore, COL, setStoreForTests } = storeMod;
const { LocalStore } = await import("../src/studio/core/store/local");
const sources = await import("../src/studio/core/sources");
const { lintArticle, verifyClaims, negatedAt } = await import("../src/studio/core/safety");
const articles = await import("../src/studio/core/articles");
const review = await import("../src/studio/core/review");
const publish = await import("../src/studio/core/publish");
const media = await import("../src/studio/core/media");
const gallery = await import("../src/studio/core/images/articleImages");
const ai = await import("../src/studio/core/ai");
const { DEFAULT_SETTINGS } = await import("../src/studio/core/settings");
type StudioArticle = import("../src/studio/core/types").StudioArticle;
type ArticleSource = import("../src/studio/core/types").ArticleSource;
type ChatRequest = import("../src/studio/core/ai").ChatRequest;

const SEVEN = [
  "[1] Study in Italy: tuition fees and living costs — European Commission https://commission.europa.eu/study-in-italy",
  "[2] Single-room rents in Italian university cities, August 2026 — Immobiliare.it Insights https://insights.immobiliare.it/rents-2026",
  "[3] Student transport pass — University of Messina https://www.unime.it/transport",
  "[4] Study visa: financial means 2026–27 and 2027–28 — Italian Ministry of Foreign Affairs https://vistoperitalia.esteri.it/study",
  "[5] Euro foreign exchange reference rates — European Central Bank https://www.ecb.europa.eu/stats/eurofxref",
  "[6] Scholarships for international students — EDISU Piemonte https://www.edisu.piemonte.it/international",
  "[7] Income documentation for foreign applicants — ERSU Palermo https://www.ersupalermo.it/foreign-applicants",
].join("\n");

/* ═════════════ Sources ═════════════ */

test("sources: a pasted list of seven sources parses with titles, URLs and [[n]] numbers; nothing is guessed", () => {
  const r = sources.parseSourceList(`Sources\n${SEVEN}\nA line with no link at all`);
  assert.equal(r.sources.length, 7);
  assert.deepEqual(r.sources.map((s) => s.n), [1, 2, 3, 4, 5, 6, 7]);
  assert.ok(r.sources.every((s) => s.title.length > 3 && /^https:\/\//.test(s.url)));
  assert.equal(r.sources[0].title, "Study in Italy: tuition fees and living costs — European Commission");
  assert.equal(r.sources[3].type, "application_portal");
  assert.equal(r.sources[4].type, "government");
  assert.equal(r.sources[5].type, "scholarship_authority");
  assert.equal(r.problems.length, 1, "line without URL is reported, not invented");
  const md = sources.parseSourceList("- [ECB reference rates](https://www.ecb.europa.eu/x)\n2. Title only, no url\nhttps://example.org/no-title");
  assert.equal(md.sources.length, 1);
  assert.equal(md.problems.length, 2);
});

test("sources: empty titles, invalid URLs and duplicate numbers give clear, per-source errors; save keeps stable ids", () => {
  const bad: ArticleSource[] = [
    { n: 1, title: "", url: "https://", type: "publication" },
    { n: 1, title: "Ok", url: "not a url", type: "publication" },
    { n: 0, title: "x", url: "https://example.org", type: "publication" },
  ];
  const p = sources.validateSources(bad);
  assert.ok(p.some((x) => x.index === 0 && x.field === "title" && /title is empty/.test(x.message)));
  assert.ok(p.some((x) => x.index === 0 && x.field === "url"), "\"https://\" alone is not a URL");
  assert.ok(p.some((x) => x.index === 1 && x.field === "n" && /used twice/.test(x.message)));
  assert.ok(p.some((x) => x.index === 2 && x.field === "n"));
  assert.ok(!p.some((x) => /Too small/.test(x.message)), "no raw schema jargon");

  const first = sources.prepareSourcesForSave(sources.parseSourceList(SEVEN).sources, []);
  assert.equal(first.problems.length, 0);
  assert.ok(first.sources.every((s) => /^src_/.test(s.id!)));
  // Re-save after editing a title and reordering: ids stay with their source.
  const edited = [...first.sources].reverse().map((s) => (s.n === 3 ? { ...s, title: "Edited title" } : s));
  const second = sources.prepareSourcesForSave(edited, first.sources);
  assert.deepEqual(second.sources.map((s) => s.n), [1, 2, 3, 4, 5, 6, 7], "sorted by citation number");
  assert.deepEqual(second.sources.map((s) => s.id), first.sources.map((s) => s.id));
  assert.equal(second.sources[2].title, "Edited title");
});

test("citations: [[n]] resolves against the saved list; missing, unused and malformed markers are reported", () => {
  const list = sources.parseSourceList(SEVEN).sources;
  const r = sources.resolveCitations(ARTICLE, list);
  assert.deepEqual(r.cited, [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(r.missing, []);
  assert.deepEqual(sources.resolveCitations(ARTICLE, list.slice(0, 1)).missing, [2, 3, 4, 5, 6, 7]);
  assert.deepEqual(sources.resolveCitations("A [[1]].", list).unused, [2, 3, 4, 5, 6, 7]);
  assert.deepEqual(sources.malformedCitations("Bad [[ 1 ]] and [[1, 2]] but fine [[3]]."), ["[[ 1 ]]", "[[1, 2]]"]);
});

/* ═════════════ Checker ═════════════ */

const lint = (body: string, category: StudioArticle["category"] = "cost_of_living", src: ArticleSource[] = []) =>
  lintArticle({ title: "T", body, category, academicYear: "2026/2027", claims: verifyClaims(body, [], src), sources: src });

test("checker: disclaimers and explicit denials of guarantees are not promises; real promises still block", () => {
  const ok = [
    "SKOLAR does not guarantee admission, scholarships, employment or visa approval.",
    "*Disclaimer: Example budgets are not guaranteed costs. SKOLAR does not guarantee admission, scholarships, employment or visa approval.*",
    "It is not a fixed monthly spending allowance, university tuition fee or guarantee of visa approval.",
    "Part-time work should not be treated as guaranteed funding for tuition, rent or visa requirements.",
    "No consultant can guarantee a visa.",
    "Admission is never guaranteed.",
    "### Does a scholarship guarantee free education?",
  ];
  for (const body of ok) {
    const w = lint(body, "other");
    for (const code of ["guaranteed_admission", "guaranteed_visa", "guaranteed_scholarship", "employment_promise"]) assert.ok(!w.some((x) => x.code === code), `${code} wrongly flagged in: ${body}`);
  }
  const bad: Array<[string, string]> = [
    ["With SKOLAR you are guaranteed admission to the university.", "guaranteed_admission"],
    ["Don't worry, we guarantee your visa.", "guaranteed_visa"],
    ["No agent can promise this, but SKOLAR guarantees admission.", "guaranteed_admission"],
    ["You will definitely get a scholarship.", "guaranteed_scholarship"],
    ["We guarantee a job after graduation.", "employment_promise"],
  ];
  for (const [body, code] of bad) assert.ok(lint(body, "other").some((x) => x.code === code && x.severity === "block"), `${code} missed in: ${body}`);
  assert.equal(negatedAt("SKOLAR does not guarantee admission", 21), true);
  assert.equal(negatedAt("Don't worry, we guarantee admission", 16), false);
});

test("checker: 'position in the ranking' is not a ranking claim; a real ranking claim is", () => {
  assert.ok(!lint("The package depends on the student's position in the ranking.", "other").some((w) => w.code === "ranking_claim"));
  assert.ok(lint("Politecnico di Milano is ranked in the world top 150.", "other").some((w) => w.code === "ranking_claim"));
});

test("checker: a citation covers the passage before it, not sentences after it; tables inherit the introducing paragraph's citation", () => {
  const src = sources.parseSourceList(SEVEN).sources;
  const body = [
    "Immobiliare.it published an analysis of room rents in August 2026. Its figures show large differences. [[2]] Rents rose by 12% in 2025.",
    "",
    "The figures below come from that report. [[2]]",
    "",
    "| City | Rent |",
    "|---|---:|",
    "| Milan | €704/month |",
    "| Messina | €285/month |",
  ].join("\n");
  const claims = verifyClaims(body, [], src);
  const by = (t: string) => claims.find((c) => c.text.includes(t))!;
  assert.deepEqual(by("published an analysis").sourceNs, [2]);
  assert.equal(by("published an analysis").basis, "paragraph");
  assert.equal(by("Rents rose").status, "unverified", "sentence after the last citation stays uncited");
  assert.deepEqual(by("Milan").sourceNs, [2]);
  assert.equal(by("Milan").basis, "lead_in");
  assert.equal(by("Milan").status, "needs_review", "cited but not auto-verified without evidence — never marked verified");
  assert.ok(!claims.some((c) => c.status === "verified"));
});

test("checker: money needs a source or an explicit estimate/personal label; 'in euros' alone is not an amount", () => {
  assert.ok(lint("Rent in Messina costs €300 per month for everyone.").some((w) => w.code === "unlabelled_estimate"));
  assert.ok(!lint("Track your expenses in euros and rupees.").some((w) => w.code === "unlabelled_estimate"));
  assert.ok(!lint("Let's create three illustrative monthly budgets.\n\n| Expense | Low |\n|---|---:|\n| Rent | €285 |\n\nThese are planning scenarios, not official averages.").some((w) => w.code === "unlabelled_estimate"));
  const personal = "One international student in Messina reports spending approximately €440 per month.\n\nThat is a personal example, not an average.";
  assert.ok(!lint(personal).some((w) => w.code === "unlabelled_estimate"));
  assert.equal(verifyClaims(personal, [], []).find((c) => /€440/.test(c.text))!.kind, "personal");
  assert.ok(lint("Living costs are €700–€1,100 per month. [[1]]", "cost_of_living", [{ n: 1, title: "EC", url: "https://example.org", type: "government" }]).every((w) => w.code !== "unlabelled_estimate"));
});

test("regression: the real 'Cost of studying in Italy' article — 0 sources → broken citations; 7 sources → no blocking warnings", () => {
  const none = lint(ARTICLE);
  assert.ok(none.some((w) => w.code === "broken_citation" && w.category === "technical"));
  for (const code of ["guaranteed_admission", "guaranteed_visa", "guaranteed_scholarship", "employment_promise", "ranking_claim"]) assert.ok(!none.some((w) => w.code === code), `${code} is a false positive`);
  const seven = sources.parseSourceList(SEVEN).sources;
  const claims = verifyClaims(ARTICLE, [], seven);
  const w = lintArticle({ title: "Cost", body: ARTICLE, category: "cost_of_living", claims, sources: seven });
  assert.deepEqual(w.filter((x) => x.severity === "block").map((x) => x.code), []);
  const uncited = claims.filter((c) => c.status === "unverified" && !c.labelled).length;
  assert.ok(uncited <= 5, `only genuinely uncited statements remain (was 46): ${uncited}`);
  assert.ok(w.some((x) => x.code === "body_h1"), "the duplicate '# title' in the body is a real warning");
});

/* ═════════════ Workflow ═════════════ */

// In-memory Vercel Blob
const blobs = new Map<string, Buffer>();
media.setBlobApiForTests({
  put: (async (pathname: string, body: Buffer) => {
    if (blobs.has(pathname)) throw new Error("This blob already exists");
    blobs.set(pathname, body);
    return { url: `https://teststore.public.blob.vercel-storage.com/${pathname}`, pathname };
  }) as never,
  head: (async (url: string) => {
    const p = url.replace(/^https:\/\/[^/]+\//, "");
    if (!blobs.has(p)) throw new Error("BlobNotFoundError: The requested blob does not exist");
    return { url, pathname: p };
  }) as never,
  del: (async (urls: string[]) => {
    for (const u of [urls].flat()) blobs.delete(u.replace(/^https:\/\/[^/]+\//, ""));
  }) as never,
});

// The public website: serves the article page with the content key of what was published.
const live = new Map<string, string>();
const web = mockFetch([
  (url) => {
    const m = /^https:\/\/site\.test\/insights\/([a-z0-9-]+)/.exec(url);
    if (!m) return null;
    return live.has(m[1]) ? html(`<meta name="skolar-content-key" content="${live.get(m[1])}"><h1>x</h1>`) : new Response("nf", { status: 404 });
  },
  (url, init) => (url.startsWith("https://teststore.public.blob.vercel-storage.com/") && init?.method === "HEAD" ? new Response(null, { status: 200 }) : null),
]);

/** Firestore-like store (kind "firestore") backed by the local store, to exercise the Firestore publishing target. */
function firestoreLike() {
  const inner = new LocalStore(path.join(process.env.STUDIO_DATA_DIR!, "fs"));
  return new Proxy(inner, { get: (t, k) => (k === "kind" ? "firestore" : (t as unknown as Record<string | symbol, unknown>)[k] instanceof Function ? ((t as unknown as Record<string | symbol, (...a: unknown[]) => unknown>)[k] as (...a: unknown[]) => unknown).bind(t) : (t as unknown as Record<string | symbol, unknown>)[k]) });
}

async function pngBytes(w = 1800, h = 1200): Promise<Buffer> {
  const sharp = (await import("sharp")).default;
  return sharp({ create: { width: w, height: h, channels: 3, background: { r: 20, g: 40, b: 90 } } }).png().toBuffer();
}

const check = async (id: string) => {
  const a = (await articles.getArticle(id))!;
  const c = articles.runChecks(a, DEFAULT_SETTINGS);
  return articles.updateArticle(id, { claims: c.claims, warnings: c.warnings, qualityGate: c.qualityGate });
};

test("workflow (manual): create → 7 sources → save → refresh → image to Blob → excerpt → checks → approve with warnings → publish (Firestore) → verified", async () => {
  setStoreForTests(firestoreLike());
  const store = getStore();
  // 1. Create (manual) and save the body.
  const a = articles.blankArticle({ id: "art_cost", title: "How Much Does It Really Cost to Study in Italy?", slug: "cost-of-studying-in-italy", category: "cost_of_living", origin: "manual", body: ARTICLE });
  await store.set(COL.articles, a.id, a as unknown as Record<string, unknown>);
  let cur = await check(a.id);
  assert.ok(cur.warnings.some((w) => w.code === "broken_citation"));
  assert.ok(articles.approvalBlockers(cur).some((b) => /\[\[1\]\]/.test(b)), "broken citations block approval for manual articles too (technical)");

  // 2–3. Add seven sources and save (as the PATCH route does).
  const prep = sources.prepareSourcesForSave(sources.parseSourceList(SEVEN).sources, cur.sources);
  assert.equal(prep.problems.length, 0);
  await articles.updateArticle(a.id, { sources: prep.sources }, { expectedVersion: cur.version });
  cur = await check(a.id);

  // 4–6. Refresh: all seven remain with the same ids; citations resolve.
  const reloaded = (await articles.getArticle(a.id))!;
  assert.equal(reloaded.sources.length, 7);
  assert.deepEqual(reloaded.sources.map((s) => s.id), prep.sources.map((s) => s.id));
  assert.deepEqual(sources.resolveCitations(reloaded.body, reloaded.sources).missing, []);
  assert.ok(!reloaded.warnings.some((w) => w.code === "broken_citation" || w.code === "no_sources"));

  // 7–9. Upload an image to (mock) Vercel Blob; the URL is saved on the article and survives a refresh.
  const before = reloaded.version;
  const up = await gallery.uploadArticleImage(a.id, { bytes: await pngBytes(), name: "Italy Study Costs.png" }, { alt: "Cost of studying in Italy cover", credit: "SKOLAR", license: "Owned by SKOLAR", makeCover: true });
  assert.match(up.coverImage!.url, /^https:\/\/teststore\.public\.blob\.vercel-storage\.com\/skolar\/articles\/art_cost\/upload-[a-f0-9]{16}\.webp$/);
  assert.equal(up.version, before + 1);
  const afterRefresh = (await articles.getArticle(a.id))!;
  assert.equal(afterRefresh.coverImage?.url, up.coverImage!.url);
  assert.equal(afterRefresh.images?.length, 1);
  assert.ok(blobs.size >= 1);

  // 10–11. Excerpt, then checks.
  await articles.updateArticle(a.id, { excerpt: "University fees, rent, food, scholarships and visa funds: a 2026–27 budget guide for Indian students." });
  cur = await check(a.id);
  assert.deepEqual(articles.technicalProblems(cur, { forPublish: true }), []);
  const open = articles.openEditorialWarnings(cur);
  assert.ok(open.length > 0, "the article keeps legitimate editorial warnings (e.g. duplicate # title)");

  // 13. Approve: needs explicit acknowledgement, then persists with the warnings on record.
  await assert.rejects(review.approveArticle(a.id), review.WarningsNeedAcknowledgementError);
  const approved = await review.approveArticle(a.id, { acknowledgeWarnings: true });
  assert.equal(approved.status, "approved");
  assert.equal(approved.review?.approvedWithWarnings?.count, open.length);
  assert.ok(!approved.claims.some((c) => c.status === "verified"), "approval never marks claims verified");
  assert.equal((await articles.getArticle(a.id))!.status, "approved", "approval persists after refresh");

  // 15. Publish to the Firestore target the public route reads; verified only once the page shows this version.
  process.env.VERCEL = "1";
  try {
    const t = publish.publishTargets();
    assert.equal(t.primary, "firestore");
    assert.equal(t.unavailable, null);
    const pub = await publish.publishArticle(a.id, { actor: "admin", revalidate: async () => undefined, skipImageCheck: true });
    assert.equal(pub.status, "publishing", "not published before the live page is verified");
    const rec = (await store.get<Record<string, unknown>>(COL.siteArticles, `studio-${a.id}`))!;
    assert.match(String(rec.content), /contentKey:/);
    assert.equal(rec.status, "published");
    live.set(pub.slug, pub.publish!.contentKey!);
    const done = (await publish.advanceOne(a.id, async () => undefined))!;
    assert.equal(done.status, "published");
    assert.ok(done.publish?.verifiedAt);
    assert.equal(done.publish?.target, "firestore");
    assert.equal(done.publish?.openWarnings?.count, open.length, "warnings preserved on the publish record");
    assert.ok(done.warnings.length >= open.length, "warnings still on the article");
    const rec2 = (await store.get<Record<string, unknown>>(COL.siteArticles, `studio-${a.id}`))!;
    assert.match(String(rec2.content), /contentKey:/, "verification keeps the published content (merge)");
  } finally {
    delete process.env.VERCEL;
  }
});

test("publishing: genuine technical errors and missing configuration block; editorial warnings do not", async () => {
  setStoreForTests(new LocalStore(path.join(process.env.STUDIO_DATA_DIR!, "local2")));
  const store = getStore();
  const base = articles.blankArticle({
    id: "art_tech",
    title: "A manual guide",
    slug: "a-manual-guide",
    category: "other",
    origin: "manual",
    excerpt: "Short excerpt.",
    body: `${"Plain explanatory text about studying abroad. ".repeat(30)}\n\nRent is €300 per month [[9]].`,
    coverImage: { url: "https://teststore.public.blob.vercel-storage.com/x.webp", alt: "Cover" },
  });
  await store.set(COL.articles, base.id, base as unknown as Record<string, unknown>);
  await check(base.id);
  await assert.rejects(review.approveArticle(base.id, { acknowledgeWarnings: true }), (e: unknown) => e instanceof review.ApprovalBlockedError && /\[\[9\]\]/.test(e.message));
  // Even if forced into "approved", publishing validates again.
  await store.set(COL.articles, base.id, { status: "approved" }, { merge: true });
  await assert.rejects(publish.publishArticle(base.id, { actor: "admin", skipImageCheck: true }), /Citations \[\[9\]\] have no matching source/);
  // Missing slug is technical.
  assert.ok(articles.technicalProblems({ ...base, slug: "" }).some((p) => /Slug/.test(p)));
  // On Vercel without GitHub or Firestore: publishing unavailable (approval unaffected).
  process.env.VERCEL = "1";
  try {
    const t = publish.publishTargets();
    assert.equal(t.primary, "none");
    assert.match(t.unavailable!, /GITHUB_TOKEN/);
    await store.set(COL.articles, base.id, { body: base.body.replace("[[9]]", "(illustrative estimate)") }, { merge: true });
    await assert.rejects(publish.publishArticle(base.id, { actor: "admin", skipImageCheck: true }), /Publishing is not configured/);
  } finally {
    delete process.env.VERCEL;
  }
});

test("workflow (AI-generated): blocking editorial warnings still prevent approval, even with acknowledgement", async () => {
  const store = getStore();
  const a = articles.blankArticle({
    id: "art_ai",
    title: "Scholarships guide",
    slug: "scholarships-guide",
    category: "scholarship",
    origin: "ai",
    academicYear: "2026/2027",
    excerpt: "x",
    body: `${"General scholarship guidance for students. ".repeat(40)}\n\nWith SKOLAR you are guaranteed admission to the university.`,
  });
  await store.set(COL.articles, a.id, a as unknown as Record<string, unknown>);
  await check(a.id);
  await assert.rejects(review.approveArticle(a.id, { acknowledgeWarnings: true }), (e: unknown) => e instanceof review.ApprovalBlockedError && /guaranteed admission/.test(e.message));
  // Recheck after fixing the text clears the block.
  await store.set(COL.articles, a.id, { body: a.body.replace("With SKOLAR you are guaranteed admission to the university.", "Admission decisions are made by each university.") }, { merge: true });
  const rechecked = await check(a.id);
  assert.ok(!rechecked.warnings.some((w) => w.code === "guaranteed_admission"), "recheck reflects the edited text");
  // The AI research quality gate (minimum words / sources) is unchanged for AI drafts.
  await assert.rejects(review.approveArticle(a.id, { acknowledgeWarnings: true }), (e: unknown) => e instanceof review.ApprovalBlockedError && /minimum/.test(e.message) && !/guaranteed/.test(e.message));
});

test("AI improvements: proposal is stored beside the article, compared, applied only on request; invented citations are rejected", async () => {
  const store = getStore();
  const t = new Date().toISOString();
  await store.set(COL.providers, "mock", { id: "mock", name: "Mock", kind: "openai_compatible", baseUrl: "https://example.invalid/v1", model: "mock-1", keyRef: "env:TEST_AI_KEY", keyHint: "t", enabled: true, priority: 1, structuredOutput: "json_schema", capabilities: ["json"], pricing: null, state: {}, createdAt: t, updatedAt: t });
  let mode: "good" | "invent" = "good";
  ai.setAdapterForTests("openai_compatible", {
    async chat(_c, _k, req: ChatRequest) {
      const section = /SECTION MARKDOWN:\n([\s\S]*)$/.exec(req.user)?.[1] ?? "";
      const markdown = mode === "good" ? section.replace("We guarantee", "We cannot guarantee") : `${section} Fees are €999. [[8]]`;
      return { text: JSON.stringify({ markdown, notes: ["Removed a promise"] }), inputTokens: 10, outputTokens: 10, model: "mock-1" };
    },
  });
  const a = articles.blankArticle({
    id: "art_imp",
    title: "Visa basics",
    slug: "visa-basics",
    category: "other",
    origin: "manual",
    excerpt: "x",
    sources: [{ id: "src_a", n: 1, title: "Ministry", url: "https://vistoperitalia.esteri.it/", type: "government" }],
    body: "## Visa\n\nWe guarantee your visa approval. Apply early. [[1]]\n\n## Other\n\nNothing to fix here.",
  });
  await store.set(COL.articles, a.id, a as unknown as Record<string, unknown>);
  const checked = await check(a.id);
  const original = checked.body;

  const proposed = await review.requestImprovement(a.id, { expectedVersion: checked.version });
  assert.equal(proposed.body, original, "the article text is untouched by a proposal");
  const p = proposed.improvement!;
  const sec = p.sections.find((s) => s.changed)!;
  assert.equal(sec.heading, "Visa");
  assert.match(sec.proposed, /cannot guarantee/);
  assert.equal(sec.rejected, undefined);

  // Keep original: discard.
  const kept = await review.discardImprovement(a.id);
  assert.equal(kept.improvement, undefined);
  assert.equal(kept.body, original);

  // Again, then apply explicitly: previous text kept as a revision; checks re-run.
  const again = await review.requestImprovement(a.id, { expectedVersion: kept.version });
  const applied = await review.applyStoredImprovement(a.id, { proposalId: again.improvement!.id, expectedVersion: again.version });
  assert.match(applied.body, /We cannot guarantee your visa approval/);
  assert.equal(applied.revisions?.at(-1)?.body, original);
  assert.equal(applied.improvement, undefined);
  assert.ok(!applied.warnings.some((w) => w.code === "guaranteed_visa"));

  // A proposal that cites a non-existent source cannot be applied; new numbers are flagged.
  mode = "invent";
  const bad = await review.requestImprovement(a.id, { expectedVersion: applied.version });
  const badSec = bad.improvement!.sections.find((s) => s.changed)!;
  assert.match(badSec.rejected!, /\[\[8\]\]/);
  assert.ok(badSec.newNumbers.includes("999"));
  await assert.rejects(review.applyStoredImprovement(a.id, { proposalId: bad.improvement!.id, expectedVersion: bad.version }), /cannot be applied/);
  assert.equal((await articles.getArticle(a.id))!.body, applied.body, "rejected proposal changed nothing");
});

test("blob uploads: re-uploading an image whose Blob file was deleted uploads it again instead of reusing a dead URL", async () => {
  const bytes = await pngBytes(900, 600);
  const first = await media.storeUpload({ bytes, name: "a.png" }, { alt: "a", articleId: "art_dead" });
  blobs.delete(first.path);
  const second = await media.storeUpload({ bytes, name: "a.png" }, { alt: "a", articleId: "art_dead" });
  assert.equal(second.url, first.url);
  assert.ok(blobs.has(first.path), "file restored in Blob");
  assert.equal(media.sniffImageType(bytes), "image/png");
  assert.equal(media.sniffImageType(Buffer.from("GIF89a-----------")), null);
  assert.match(media.explainBlobError("Vercel Blob: Access denied, please provide a valid token for this resource."), /BLOB_READ_WRITE_TOKEN is invalid/);
  await assert.rejects(media.storeUpload({ bytes: Buffer.from("not an image at all"), name: "x.png" }, { alt: "x" }), /could not be read/);
});

test.after(() => web.restore());
