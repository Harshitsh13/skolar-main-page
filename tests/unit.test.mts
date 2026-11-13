import { test } from "node:test";
import assert from "node:assert/strict";
import { setupEnv } from "./helpers.mts";

setupEnv("unit");

const { nextSlot, compactQueue } = await import("../src/studio/core/scheduler");
const { zonedToUtc, dayKey, academicYearFor, nextIntakeAcademicYear } = await import("../src/studio/core/time");
const { lintArticle, verifyClaims, hasBlockingWarnings } = await import("../src/studio/core/safety");
const { renderArticleMarkdown, splitSections, joinSections } = await import("../src/studio/core/markdown");
const { quoteStatus, convertFactMarkers } = await import("../src/studio/core/pipeline");
const { robotsAllows, htmlToPage } = await import("../src/studio/core/fetcher");
const { similarity, redact } = await import("../src/studio/core/util");
const { DEFAULT_SETTINGS } = await import("../src/studio/core/settings");

const pub = { ...DEFAULT_SETTINGS.publishing, timezone: "Asia/Kolkata", times: ["18:00"], days: [1, 2, 3, 4, 5], maxPerDay: 1, minIntervalMinutes: 120 };
const ist = (y: number, m: number, d: number, h = 18, min = 0) => zonedToUtc(y, m, d, h, min, "Asia/Kolkata").toISOString();

test("scheduler: Mon/Tue/Wed taken → next article gets Thursday 18:00", () => {
  // Sunday 15 Nov 2026, 10:00 IST
  const now = new Date(ist(2026, 11, 15, 10));
  const taken = [ist(2026, 11, 16), ist(2026, 11, 17), ist(2026, 11, 18)];
  const slot = nextSlot(pub, { now, taken })!;
  assert.equal(slot.toISOString(), ist(2026, 11, 19));
});

test("scheduler: today's slot used if free and not passed; skipped once passed", () => {
  const morning = new Date(ist(2026, 11, 16, 9)); // Monday 09:00
  assert.equal(nextSlot(pub, { now: morning, taken: [] })!.toISOString(), ist(2026, 11, 16));
  const evening = new Date(ist(2026, 11, 16, 19)); // Monday 19:00 — passed
  assert.equal(nextSlot(pub, { now: evening, taken: [] })!.toISOString(), ist(2026, 11, 17));
});

test("scheduler: weekends skipped unless allowed; maxPerDay and min interval respected", () => {
  const fri = new Date(ist(2026, 11, 20, 19)); // Friday after slot
  assert.equal(nextSlot(pub, { now: fri, taken: [] })!.toISOString(), ist(2026, 11, 23)); // Monday
  const weekend = { ...pub, allowWeekends: true, days: [0, 1, 2, 3, 4, 5, 6] };
  assert.equal(nextSlot(weekend, { now: fri, taken: [] })!.toISOString(), ist(2026, 11, 21)); // Saturday
  const two = { ...pub, times: ["10:00", "11:00", "18:00"], maxPerDay: 2, minIntervalMinutes: 120 };
  const mon = new Date(ist(2026, 11, 16, 8));
  // 10:00 taken → 11:00 too close (60 min) → 18:00
  assert.equal(nextSlot(two, { now: mon, taken: [ist(2026, 11, 16, 10)] })!.toISOString(), ist(2026, 11, 16, 18));
  // two already that day → Tuesday 10:00
  assert.equal(nextSlot(two, { now: mon, taken: [ist(2026, 11, 16, 10), ist(2026, 11, 16, 18)] })!.toISOString(), ist(2026, 11, 17, 10));
});

test("scheduler: compaction only moves unpinned items earlier and never collides", () => {
  const now = new Date(ist(2026, 11, 15, 10));
  const changes = compactQueue(pub, [
    { id: "a", at: ist(2026, 11, 18), pinned: false },
    { id: "b", at: ist(2026, 11, 20), pinned: true },
    { id: "c", at: ist(2026, 11, 24), pinned: false },
  ], now);
  const moved = Object.fromEntries(changes.map((c) => [c.id, c.to]));
  assert.equal(moved.a, ist(2026, 11, 16));
  assert.equal(moved.b, undefined); // pinned
  assert.equal(moved.c, ist(2026, 11, 17));
  const finalTimes = [moved.a, ist(2026, 11, 20), moved.c];
  assert.equal(new Set(finalTimes).size, 3);
});

test("time: day keys and academic years", () => {
  assert.equal(dayKey(new Date("2026-11-12T20:00:00Z"), "Asia/Kolkata"), "2026-11-13");
  assert.equal(academicYearFor(new Date("2026-11-12T00:00:00Z"), 9), "2026/2027");
  assert.equal(academicYearFor(new Date("2027-03-01T00:00:00Z"), 9), "2026/2027");
  assert.equal(nextIntakeAcademicYear(new Date("2026-11-12T00:00:00Z"), 9), "2027/2028");
});

test("safety: guaranteed admission / visa / partnership claims block", () => {
  const w = lintArticle({ title: "Guide", body: "With SKOLAR you are guaranteed admission to the university. SKOLAR is an official partner of the University of Messina.", category: "admissions", academicYear: "2027/2028", claims: [], sources: [] });
  assert.ok(w.some((x) => x.code === "guaranteed_admission" && x.severity === "block"));
  assert.ok(w.some((x) => x.code === "skolar_partnership"));
  assert.ok(hasBlockingWarnings(w));
});

test("safety: unlabelled money amounts in cost articles block; labelled estimates pass", () => {
  const bad = lintArticle({ title: "Costs", body: "Rent in Messina costs €300 per month for everyone.", category: "cost_of_living", academicYear: "2026/2027", claims: [], sources: [] });
  assert.ok(bad.some((x) => x.code === "unlabelled_estimate"));
  const ok = lintArticle({ title: "Costs", body: "Assumptions: a shared room, autumn 2026. Based on these assumptions, an illustrative estimate for rent is around €300 per month.", category: "cost_of_living", academicYear: "2026/2027", claims: [], sources: [] });
  assert.ok(!ok.some((x) => x.code === "unlabelled_estimate"));
});

test("claims: verified only when numbers match cited evidence", () => {
  const facts = [{ id: "F1", statement: "The programme lasts 3 years (180 ECTS).", quote: "durata 3 anni, 180 CFU", sourceN: 1, status: "verified" as const }];
  const sources = [{ n: 1, title: "Unime", url: "https://www.unime.it", type: "official_university" as const }];
  const claims = verifyClaims("The programme lasts 3 years and has 180 credits [[1]]. Tuition is €2,500 per year [[1]]. Applications close on 15 March 2027.", facts, sources);
  assert.equal(claims[0].status, "verified");
  assert.equal(claims[1].status, "needs_review"); // 2500 not in evidence
  assert.equal(claims[2].status, "unverified"); // no citation
});

test("markdown: escapes raw HTML, renders citations, tables and heading ids", () => {
  const { html, toc } = renderArticleMarkdown("## Fees & costs\n\nText [[2]] <script>alert(1)</script>\n\n| A | B |\n|---|---|\n| 1 | 2 |\n\n[bad](javascript:alert(1)) [ok](https://unime.it)");
  assert.ok(!html.includes("<script>"));
  assert.ok(html.includes('href="#source-2"'));
  assert.ok(html.includes('class="table-scroll"'));
  assert.ok(html.includes('id="fees-costs"'));
  assert.ok(!html.includes("javascript:"));
  assert.ok(html.includes('rel="noopener noreferrer"'));
  assert.deepEqual(toc.map((t) => t.id), ["fees-costs"]);
});

test("markdown: sections split and join losslessly", () => {
  const md = "Intro text.\n\n## One\n\nA\n\n## Two\n\nB\n";
  const s = splitSections(md);
  assert.equal(s.length, 3);
  assert.equal(joinSections(s), md);
});

test("pipeline helpers: quotes must exist in the page; fact markers become citations", () => {
  const page = "Il corso di laurea ha una durata di 3 anni e prevede 180 CFU. Le lezioni sono in inglese.";
  assert.equal(quoteStatus("ha una durata di 3 anni e prevede 180 CFU", page), "verified");
  assert.equal(quoteStatus("The course is free for all students worldwide", page), null);
  const facts = [{ id: "F1", statement: "", quote: "", sourceN: 2, status: "verified" as const }, { id: "F2", statement: "", quote: "", sourceN: 3, status: "verified" as const }];
  const out = convertFactMarkers("Three years [F1]. Taught in English [F1, F2]. Made up [F9].", facts);
  assert.equal(out.md, "Three years [[2]]. Taught in English [[2]][[3]]. Made up .");
  assert.equal(out.unknown, 1);
});

test("robots.txt rules and HTML extraction", () => {
  const rules = [{ allow: false, path: "/private" }, { allow: true, path: "/private/public" }];
  assert.equal(robotsAllows(rules, "/private/x"), false);
  assert.equal(robotsAllows(rules, "/private/public/y"), true);
  assert.equal(robotsAllows(rules, "/news"), true);
  const p = htmlToPage('<html><head><title>T &amp; C</title><meta name="description" content="D"></head><body><nav>menu</nav><main><p>Hello <b>world</b></p><a href="/bando-2026">Bando 2026/2027</a></main></body></html>', "https://ersu.example.it/");
  assert.equal(p.title, "T & C");
  assert.ok(p.text.includes("Hello world"));
  assert.equal(p.links[0].url, "https://ersu.example.it/bando-2026");
});

test("duplicate similarity and secret redaction", () => {
  assert.ok(similarity("University of Messina vs University of Palermo", "Palermo vs Messina: which university?") >= 0.6);
  assert.ok(similarity("ERSU Messina scholarship guide", "Opening a bank account in Italy") < 0.2);
  assert.equal(redact("Authorization: Bearer gsk_abcdefghijklmnopqrstuv"), "Authorization: Bearer [redacted]");
  assert.ok(!redact("https://x.com/a?key=AIzaSyABCDEFGHIJKLMNOP").includes("AIza"));
});

test("claims: table headers, academic-year labels and reader advice are not factual claims", async () => {
  const { isFactualSentence } = await import("../src/studio/core/safety");
  const body = "| Item | Amount (2027/2028) | Notes |\n|---|---|---|\n| Registration fee | €40 | Per application |\n\nCheck the latest eligibility criteria and deadlines on the official page.\n\nFee structures and deadlines can change from year to year.\n\nApplications close on 22 July 2027.";
  const claims = verifyClaims(body, [], []);
  const texts = claims.map((c) => c.text);
  assert.ok(!texts.some((t) => t.includes("Amount (2027/2028)")), "header row skipped");
  assert.ok(texts.some((t) => t.includes("€40")), "data row still checked");
  assert.ok(texts.some((t) => t.includes("22 July 2027")), "real deadline still checked");
  assert.ok(!texts.some((t) => /latest eligibility|can change/.test(t)), "advice is not a claim");
  assert.equal(isFactualSentence("For the 2027/2028 academic year, read the guide."), false);
});

test("citations: status-echoed markers are converted; leftovers block; evidence-based autocite never invents", async () => {
  const { addCitationsFromEvidence, convertFactMarkers } = await import("../src/studio/core/citations");
  const facts = [
    { id: "F5", statement: "Applications must also be filed on Universitaly by 22 July 2027.", quote: "entro il 22 luglio 2027", sourceN: 2, status: "conflicting" as const },
    { id: "F7", statement: "The University charges a €40 registration fee covering up to two applications.", quote: "contributo di 40 euro", sourceN: 3, status: "verified" as const },
  ];
  assert.equal(convertFactMarkers("Deadline 22 July 2027 [F5, CONFLICTING].", facts).md, "Deadline 22 July 2027 [[2]].");
  assert.equal(convertFactMarkers("Fee [F7 – OUTDATED] and [F5; F7].", facts).md, "Fee [[3]] and [[2]][[3]].");
  const w = lintArticle({ title: "t", body: "Leaked [F9, CONFLICTING] marker.", category: "other", claims: [], sources: [] });
  assert.ok(w.some((x) => x.code === "research_marker" && x.severity === "block"));
  const r = addCitationsFromEvidence("You pay a €40 registration fee (e.g. by card) for up to two applications. Tuition is €2,500 per year.", facts);
  assert.match(r.body, /€40 registration fee \(e\.g\. by card\) for up to two applications \[\[3]]\./, "cited at the real sentence end, e.g. kept intact");
  assert.ok(!/2,500[^.]*\[\[/.test(r.body), "unsupported number is not cited");
  assert.equal(r.unresolved.length, 1);
});
