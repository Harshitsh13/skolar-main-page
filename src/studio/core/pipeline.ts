import { z } from "zod";
import { COL, getStore } from "./store";
import type {
  ArticleFact,
  ArticleImage,
  ArticleSource,
  EditorialWarning,
  SourceType,
  StageKey,
  StudioArticle,
  StudioJob,
  StudioSettings,
} from "./types";
import { PIPELINE_STAGES } from "./types";
import { chatJson, type CallContext } from "./ai";
import { STRATEGIES } from "./strategies";
import { getCountry, listScholarships, listSources, listUniversities, officialDomains } from "./entities";
import { fetchPage, FetchBlockedError, hostOf, NetworkError } from "./fetcher";
import { searchProviderName, webSearch } from "./search";
import { discoveredFor, PAGE_CATEGORY_LABEL } from "./discovery";
import { academicYearFor, nextIntakeAcademicYear } from "./time";
import { blankArticle, findDuplicates, getArticle, listArticles, runChecks, uniqueSlug } from "./articles";
import { getSettings } from "./settings";
import { joinSections } from "./markdown";
import { convertFactMarkers } from "./citations";
import fs from "node:fs/promises";
import path from "node:path";
import { studioEnv } from "./env";
import { MediaNotConfiguredError } from "./media";
import { aiProvider, ImageProviderError } from "./images/providers";
import { altFor, analyseArticle, chooseConcept, FORMAT_LABELS, generateImage, renderConcept, uploadGenerated, type ImageConcept } from "./images/service";
import { normForMatch, nowIso, sha256, similarity, slugify, truncate, uniq } from "./util";

/* ═════════════════════════ Checkpoint shapes ═════════════════════════ */

export interface PlanData {
  intent: string;
  audience: string;
  angle: string;
  questions: string[];
  queries: string[];
  entities: string[];
  academicYear: string;
  duplicates: Array<{ id: string; title: string; similarity: number }>;
}
interface Candidate {
  url: string;
  title: string;
  type: SourceType;
  origin: "registry" | "search" | "follow";
  /** Link depth from a registry page (0 = the registry page itself). */
  depth?: number;
  why: string;
}
interface SourcesData {
  candidates: Candidate[];
  search: { provider: string | null; error?: string; related: string[] };
}
interface CollectedPage {
  url: string;
  pageId: string;
  title: string;
  type: SourceType;
  ok: boolean;
  error?: string;
  isPdf?: boolean;
  pageDate?: string;
  chars?: number;
}
interface CollectData {
  queue: Candidate[];
  pages: CollectedPage[];
  followed: boolean;
}
interface RawFact {
  id: string;
  statement: string;
  quote: string;
  academicYear: string | null;
  question: string | null;
  url: string;
  status: ArticleFact["status"];
}
interface ExtractData {
  processed: string[];
  facts: RawFact[];
  discarded: number;
}
interface OrganiseData {
  sources: ArticleSource[];
  facts: ArticleFact[];
  gaps: string[];
  conflicts: string[];
}
interface OutlineData {
  title: string;
  sections: Array<{ heading: string; purpose: string; factIds: string[] }>;
}
interface WriteData {
  sections: Array<{ heading: string; body: string }>;
  unknownFactRefs: number;
}
interface SeoData {
  seoTitle: string;
  metaDescription: string;
  excerpt: string;
  slug: string;
  tags: string[];
}

export class PipelineHalt extends Error {
  constructor(
    message: string,
    readonly outcome: "failed" | "needs_review" = "failed",
  ) {
    super(message);
  }
}

type StageOutput = { done: boolean; data: unknown; log?: string };
type StageFn = (job: StudioJob, ctx: StageCtx) => Promise<StageOutput>;

export interface StageCtx {
  settings: StudioSettings;
  call: CallContext;
  /** Live progress line shown in Studio (persisted). */
  report: (message: string) => Promise<void>;
}

const cp = <T>(job: StudioJob, stage: StageKey) => job.checkpoints[stage] as T | undefined;

const SYSTEM_BASE = [
  "You work for SKOLAR, an education consultancy that helps Indian students study in Italy.",
  "You are part of an editorial research pipeline whose top priority is accuracy and trust.",
  "Never invent facts, numbers, dates, deadlines, fees, scholarship amounts, requirements, quotes, rankings, testimonials or partnerships.",
  "Never promise admission, scholarships, visas or jobs.",
  "Write in clear British English for 17–25 year-old students reading on a phone.",
].join(" ");

/* ═════════════════════════ 1. plan ═════════════════════════ */

const planSchema = {
  type: "object",
  additionalProperties: false,
  required: ["intent", "audience", "angle", "questions", "queries", "entities"],
  properties: {
    intent: { type: "string" },
    audience: { type: "string" },
    angle: { type: "string" },
    questions: { type: "array", items: { type: "string" } },
    queries: { type: "array", items: { type: "string" } },
    entities: { type: "array", items: { type: "string" } },
  },
};
const planZ = z.object({
  intent: z.string(),
  audience: z.string(),
  angle: z.string(),
  questions: z.array(z.string()),
  queries: z.array(z.string()),
  entities: z.array(z.string()),
});

const plan: StageFn = async (job, ctx) => {
  const strategy = STRATEGIES[job.category];
  const country = await getCountry(job.countryId);
  const now = new Date();
  const ay =
    job.category === "scholarship" || job.category === "cost_of_living" || job.category === "student_life"
      ? academicYearFor(now, country.academicYearStartMonth)
      : nextIntakeAcademicYear(now, country.academicYearStartMonth);

  await ctx.report(`Checking for duplicate articles and topics`);
  const dups = await findDuplicates(job.topic, {
    excludeTopicId: job.topicId,
    excludeArticleId: job.targetArticleId,
    threshold: 0.6,
  });
  const blocking = dups.filter((d) => d.kind === "article" && d.similarity >= 0.75);
  if (blocking.length && job.origin !== "regenerate") {
    throw new PipelineHalt(`Possible duplicate of "${blocking[0].title}" (${Math.round(blocking[0].similarity * 100)}% similar).`, "needs_review");
  }

  await ctx.report(`Analysing search intent for “${job.topic}” (${ay})`);
  const out = await chatJson(
    {
      system: `${SYSTEM_BASE} Plan the research for one article. Return JSON only.`,
      user: [
        `Article topic: "${job.topic}"`,
        `Category: ${strategy.label} — ${strategy.description}`,
        `Country: ${country.name}. Academic year to research: ${ay}.`,
        `Default audience: ${strategy.audience}.`,
        `Required research questions (keep them, refine if useful, max 9 total):\n- ${strategy.researchQuestions.join("\n- ")}`,
        "Return: intent (what the searcher wants to know, 1 sentence), audience, angle (how SKOLAR can be genuinely useful, 1 sentence),",
        "questions (max 9), queries (3 short web search queries targeting OFFICIAL sources; include the Italian term when useful),",
        "entities (exact names of universities, scholarship bodies, cities or programmes the article is about).",
      ].join("\n"),
      json: { name: "research_plan", schema: planSchema },
      maxTokens: 1500,
      reasoning: "low",
    },
    (v) => planZ.parse(v),
    { ...ctx.call, stage: "plan" },
  );
  const data: PlanData = {
    intent: truncate(out.intent, 300),
    audience: truncate(out.audience || strategy.audience, 160),
    angle: truncate(out.angle, 300),
    questions: uniq([...out.questions, ...strategy.researchQuestions]).slice(0, 9),
    queries: out.queries.slice(0, 3),
    entities: out.entities.slice(0, 8),
    academicYear: ay,
    duplicates: dups.slice(0, 3).map((d) => ({ id: d.id, title: d.title, similarity: d.similarity })),
  };
  return { done: true, data, log: `Intent: ${data.intent}` };
};

/* ═════════════════════════ 2. sources ═════════════════════════ */

const BLOCKED_HOSTS = /(facebook|instagram|tiktok|youtube|x\.com|twitter|linkedin|pinterest|quora|reddit)\./i;

function classifyHost(host: string, official: Map<string, string>): SourceType {
  const t = official.get(host) ?? [...official.entries()].find(([d]) => host.endsWith(`.${d}`))?.[1];
  if (t) return t as SourceType;
  if (/(\.gov\.it|\.gov|esteri\.it|\.europa\.eu|governo\.it|interno\.gov\.it)$/.test(host)) return "government";
  if (/^(universitaly\.it|studyinitaly\.esteri\.it)$/.test(host)) return "application_portal";
  return "other";
}

const sources: StageFn = async (job, ctx) => {
  const planData = cp<PlanData>(job, "plan")!;
  const strategy = STRATEGIES[job.category];
  const official = await officialDomains();
  const unis = await listUniversities();
  const schs = await listScholarships();
  const regSources = await listSources();
  const haystack = `${job.topic} ${planData.entities.join(" ")}`.toLowerCase();
  const candidates: Candidate[] = [];
  const add = (c: Candidate) => {
    const url = c.url.replace(/#.*$/, "");
    if (!candidates.some((x) => x.url.replace(/\/$/, "") === url.replace(/\/$/, ""))) candidates.push({ ...c, url });
  };

  // Registry entities mentioned in the topic (or attached to the job)
  const mentions = (name: string, short?: string) => {
    const n = name.toLowerCase();
    const core = n.replace(/^(university|università|universita) (of|degli studi di|di) /, "");
    return haystack.includes(n) || (core.length > 3 && haystack.includes(core)) || (short ? haystack.includes(short.toLowerCase()) : false);
  };
  const matchedUnis = unis.filter((u) => u.researchEnabled && (job.entityIds.includes(u.id) || mentions(u.name, u.shortName)));
  const matchedSch = schs.filter((s) => job.entityIds.includes(s.id) || mentions(s.name) || mentions(s.organisation));
  for (const u of matchedUnis) add({ url: u.website, title: u.name, type: "official_university", origin: "registry", why: "University in the registry" });
  for (const s of matchedSch) {
    add({ url: s.website, title: s.organisation, type: "scholarship_authority", origin: "registry", why: "Scholarship body in the registry" });
    if (s.portalUrl) add({ url: s.portalUrl, title: `${s.organisation} portal`, type: "application_portal", origin: "registry", why: "Official application portal" });
  }
  for (const src of regSources) {
    const linked =
      (src.universityId && matchedUnis.some((u) => u.id === src.universityId)) ||
      (src.scholarshipId && matchedSch.some((s) => s.id === src.scholarshipId));
    const generic =
      !src.universityId &&
      !src.scholarshipId &&
      ((["admissions", "visa", "trending", "practical"].includes(job.category) && ["government", "application_portal", "consulate"].includes(src.category)) ||
        (job.category === "scholarship" && src.category === "scholarship" && !matchedSch.length));
    if (linked || generic) {
      add({ url: src.url, title: src.name, type: classifyHost(hostOf(src.url), official), origin: "registry", why: "Official source registry" });
    }
  }

  await ctx.report(`${candidates.length} official source(s) found in the registry`);
  // Official pages found by page discovery for the matched institutions (verified first).
  const wanted: Record<string, string[]> = {
    comparison: ["admissions", "courses", "fees", "international", "services"],
    university_guide: ["courses", "admissions", "international", "fees", "housing", "services"],
    programmes: ["courses", "admissions"],
    scholarship: ["scholarships", "notices", "fees"],
    admissions: ["admissions", "international", "visa"],
    visa: ["visa", "international"],
    student_life: ["services", "housing", "international"],
    cost_of_living: ["housing", "fees", "services"],
    city_guide: ["housing", "services", "international"],
    trending: ["admissions", "international", "fees"],
    practical: ["services", "international", "visa"],
    other: ["international", "admissions"],
  };
  const disc = await discoveredFor([...matchedUnis.map((u) => u.id), ...matchedSch.map((x) => x.id)]);
  for (const d of disc.filter((x) => wanted[job.category]?.includes(x.category)).slice(0, 6)) {
    add({ url: d.url, title: d.title, type: d.institution.kind === "scholarship" ? "scholarship_authority" : d.institution.kind === "university" ? "official_university" : "government", origin: "registry", why: `Discovered ${PAGE_CATEGORY_LABEL[d.category]} page${d.status === "verified" ? " (verified)" : ""}` });
  }

  // Web search (discovery only)
  const provider = searchProviderName();
  let searchError: string | undefined;
  const related: string[] = [];
  if (provider) {
    for (const q of planData.queries) {
      try {
        await ctx.report(`Searching: ${q}`);
        const r = await webSearch(q, { num: 8 });
        related.push(...r.related);
        for (const hit of r.results) {
          const host = hostOf(hit.url);
          if (!host || BLOCKED_HOSTS.test(host)) continue;
          const type = classifyHost(host, official);
          // Keep official results; at most 2 reputable non-official pages overall.
          if (type === "other" && candidates.filter((c) => c.type === "other" || c.type === "publication").length >= 2) continue;
          add({ url: hit.url, title: hit.title, type: type === "other" ? "publication" : type, origin: "search", why: `Search: ${q}` });
        }
      } catch (err) {
        searchError = err instanceof Error ? err.message : String(err);
      }
    }
  }

  const rank = (t: SourceType) => strategy.preferredSources.indexOf(t) === -1 ? 10 : strategy.preferredSources.indexOf(t);
  candidates.sort((a, b) => rank(a.type) - rank(b.type) || (a.origin === "registry" ? -1 : 1));
  const picked = candidates.slice(0, 10);
  if (!picked.length) {
    throw new PipelineHalt(
      provider
        ? "No usable sources were found for this topic. Add official sources for it under Research & Sources."
        : "No sources available: add the relevant university/scholarship/official source under Countries & Universities or Research & Sources, or configure a search provider.",
    );
  }
  const data: SourcesData = { candidates: picked, search: { provider, error: searchError, related: uniq(related).slice(0, 10) } };
  return { done: true, data, log: `${picked.length} candidate source(s)${provider ? ` (search: ${provider})` : " (registry only)"}` };
};

/* ═════════════════════════ 3. collect ═════════════════════════ */

export function pageId(url: string) {
  return sha256(url).slice(0, 32);
}

async function savePage(url: string, type: SourceType, page: Awaited<ReturnType<typeof fetchPage>>) {
  await getStore().set(COL.pages, pageId(url), {
    url,
    finalUrl: page.finalUrl,
    title: page.title,
    description: page.description,
    text: page.text.slice(0, 60_000),
    pageDate: page.pageDate,
    lastModified: page.lastModified,
    isPdf: page.isPdf,
    type,
    links: page.links.slice(0, 150),
    fetchedAt: page.fetchedAt,
  });
}

const collect: StageFn = async (job, ctx) => {
  const src = cp<SourcesData>(job, "sources")!;
  const prev = cp<CollectData>(job, "collect");
  const data: CollectData = prev ?? { queue: [...src.candidates], pages: [], followed: false };
  const strategy = STRATEGIES[job.category];
  const planData = cp<PlanData>(job, "plan")!;

  let networkErrors = 0;
  for (let i = 0; i < 3 && data.queue.length; i++) {
    const c = data.queue.shift()!;
    if (data.pages.some((p) => p.url === c.url)) continue;
    try {
      await ctx.report(`Reading ${c.url}`);
      const page = await fetchPage(c.url);
      await savePage(c.url, c.type, page);
      data.pages.push({
        url: c.url,
        pageId: pageId(c.url),
        title: page.title || c.title,
        type: c.type,
        ok: !page.isPdf && page.text.length > 200,
        isPdf: page.isPdf,
        pageDate: page.pageDate ?? page.lastModified,
        chars: page.text.length,
        error: page.isPdf ? "PDF document — not parsed automatically; review manually." : page.text.length <= 200 ? "Page had almost no readable text." : undefined,
      });
      // One hop deeper on official homepages: follow the most relevant same-site links.
      const depth = c.depth ?? (c.origin === "registry" ? 0 : 9);
      // Up to two hops from official registry pages: homepages are usually navigation hubs.
      if (depth < 2 && !page.isPdf && data.pages.filter((p) => p.ok).length + data.queue.length < 14) {
        const host = hostOf(page.finalUrl);
        const keywords = [
          ...strategy.linkKeywords,
          ...planData.entities.flatMap((e) => e.toLowerCase().split(/\s+/)).filter((w) => w.length > 4),
        ];
        const scored = page.links
          .filter((l) => hostOf(l.url) === host && l.url !== page.finalUrl && !/\.(jpg|png|zip|docx?)$/i.test(l.url))
          .map((l) => {
            const text = l.text.toLowerCase();
            const urlPath = (() => {
              try {
                return new URL(l.url).pathname.toLowerCase();
              } catch {
                return "";
              }
            })();
            let score = keywords.reduce((s, k) => s + (text.includes(k) ? 2 : 0) + (urlPath.includes(k) ? 1 : 0), 0);
            // News/event stories rarely hold programme, fee or admission facts (scholarship notices are the exception).
            if (job.category !== "scholarship" && /\/(notizie|news|eventi|events|comunicati|press|blog)\//.test(urlPath)) score -= 4;
            if (/\/(ricerca|research|musei|museum|terza-missione|amministrazione-trasparente|bandi-di-gara|concorsi-personale)(\/|$)/.test(urlPath)) score -= 4;
            if (/\/(en|english)(\/|$)/.test(urlPath) || /\benglish\b/.test(text)) score += 1;
            if (urlPath.split("/").filter(Boolean).length > 6) score -= 1;
            return { l, score };
          })
          .filter((x) => x.score > 0)
          .sort((a, b) => b.score - a.score)
          .slice(0, depth === 0 ? (src.candidates.length < 3 ? 6 : 3) : 2); // follow more when the registry offers few pages
        for (const { l } of scored) {
          if (!data.queue.some((q) => q.url === l.url) && !data.pages.some((p) => p.url === l.url)) {
            data.queue.push({ url: l.url, title: l.text || c.title, type: c.type, origin: "follow", depth: depth + 1, why: `Linked from ${c.title}` });
          }
        }
      }
    } catch (err) {
      if (err instanceof NetworkError) networkErrors++;
      data.pages.push({
        url: c.url,
        pageId: pageId(c.url),
        title: c.title,
        type: c.type,
        ok: false,
        error: err instanceof FetchBlockedError ? `Not accessed: ${err.message}` : err instanceof Error ? err.message : String(err),
      });
    }
  }
  if (networkErrors && !data.pages.some((p) => p.ok)) {
    // Give the network a chance: do not burn the candidates.
    throw new NetworkError("Pages could not be reached (network).");
  }
  const done = data.queue.length === 0 || data.pages.filter((p) => p.ok).length >= 10;
  if (done && !data.pages.some((p) => p.ok)) {
    throw new PipelineHalt(`None of the ${data.pages.length} source page(s) could be read: ${data.pages.map((p) => `${hostOf(p.url)} (${p.error ?? "no text"})`).join("; ")}`);
  }
  return { done, data, log: `${data.pages.filter((p) => p.ok).length} page(s) read, ${data.queue.length} queued` };
};

/* ═════════════════════════ 4. extract ═════════════════════════ */

function relevantText(text: string, keywords: string[], max = 4500): string {
  const paras = text.split(/\n+/).map((p) => p.trim()).filter((p) => p.length > 30);
  const kws = keywords.map((k) => k.toLowerCase()).filter((k) => k.length > 3);
  const scored = paras.map((p, i) => {
    const l = p.toLowerCase();
    let s = kws.reduce((acc, k) => acc + (l.includes(k) ? 1 : 0), 0);
    if (/\d/.test(p)) s += 0.5;
    if (/20\d{2}\s?[/-]\s?(20)?\d{2}/.test(p)) s += 1;
    return { p, i, s };
  });
  const chosen: typeof scored = [];
  let total = 0;
  for (const x of [...scored].sort((a, b) => b.s - a.s)) {
    if (total + x.p.length > max) continue;
    chosen.push(x);
    total += x.p.length;
  }
  return chosen.sort((a, b) => a.i - b.i).map((x) => x.p).join("\n");
}

const extractSchema = {
  type: "object",
  additionalProperties: false,
  required: ["facts"],
  properties: {
    facts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["statement", "quote", "academic_year", "question"],
        properties: {
          statement: { type: "string" },
          quote: { type: "string" },
          academic_year: { type: ["string", "null"] },
          question: { type: ["integer", "null"] },
        },
      },
    },
  },
};
const extractZ = z.object({
  facts: z.array(
    z.object({
      statement: z.string(),
      quote: z.string(),
      academic_year: z.string().nullable(),
      question: z.number().int().nullable(),
    }),
  ),
});

/** Checks the quote really appears in the page text. */
export function quoteStatus(quote: string, pageText: string): ArticleFact["status"] | null {
  const q = normForMatch(quote).replace(/^["'“]|["'”]$/g, "");
  if (q.length < 12) return null;
  const hay = normForMatch(pageText);
  if (hay.includes(q)) return "verified";
  const words = q.split(" ");
  if (words.length < 6) return null;
  const shingles: string[] = [];
  for (let i = 0; i + 5 <= words.length; i++) shingles.push(words.slice(i, i + 5).join(" "));
  const hits = shingles.filter((s) => hay.includes(s)).length;
  return hits / shingles.length >= 0.6 ? "partially_verified" : null;
}

const extract: StageFn = async (job, ctx) => {
  const col = cp<CollectData>(job, "collect")!;
  const planData = cp<PlanData>(job, "plan")!;
  const prev = cp<ExtractData>(job, "extract");
  const data: ExtractData = prev ?? { processed: [], facts: [], discarded: 0 };
  const targetStart = Number(planData.academicYear.slice(0, 4));
  const country = await getCountry(job.countryId);
  const runningStart = Number(academicYearFor(new Date(), country.academicYearStartMonth).slice(0, 4));
  const todo = col.pages.filter((p) => p.ok && !data.processed.includes(p.pageId)).slice(0, 2);
  for (const p of todo) {
    const page = await getStore().get<{ text: string; title: string } & Record<string, unknown>>(COL.pages, p.pageId);
    data.processed.push(p.pageId);
    if (!page?.text) continue;
    const excerpt = relevantText(page.text, [
      ...planData.questions.join(" ").split(/\W+/),
      ...planData.entities,
      ...STRATEGIES[job.category].linkKeywords, // includes the Italian terms official pages use
      job.topic,
    ]);
    if (excerpt.length < 150) continue;
    await ctx.report(`Extracting facts from ${p.url}`);
    const out = await chatJson(
      {
        system: [
          SYSTEM_BASE,
          "Extract facts from ONE official web page for a research team.",
          "Rules: use only the PAGE TEXT. `quote` must be copied character-for-character from the page text (keep the original language, max 300 characters).",
          "`statement` is a precise English sentence of what the quote says, including the subject (which university/body) and any academic year.",
          "`academic_year` only if the page explicitly states it (format 2026/2027), else null. `question` is the 1-based number of the research question answered, or null.",
          "Ignore navigation, cookie notices and unrelated content. If nothing is relevant return an empty list. Max 12 facts.",
        ].join(" "),
        user: [
          `Article topic: ${job.topic}`,
          `Research questions:\n${planData.questions.map((q, i) => `${i + 1}. ${q}`).join("\n")}`,
          `PAGE: ${page.title} — ${p.url}`,
          `PAGE TEXT:\n"""\n${excerpt}\n"""`,
        ].join("\n\n"),
        json: { name: "facts", schema: extractSchema },
        maxTokens: 3000,
        reasoning: "low",
      },
      (v) => extractZ.parse(v),
      { ...ctx.call, stage: "extract" },
    );
    for (const f of out.facts.slice(0, 12)) {
      const status = quoteStatus(f.quote, page.text);
      if (!status) {
        data.discarded++;
        continue;
      }
      const ay = f.academic_year && /^20\d{2}\/20\d{2}$/.test(f.academic_year) ? f.academic_year : null;
      const ayStart = ay ? Number(ay.slice(0, 4)) : null;
      data.facts.push({
        id: `F${data.facts.length + 1}`,
        statement: truncate(f.statement, 400),
        quote: truncate(f.quote, 320),
        academicYear: ay,
        question: f.question && planData.questions[f.question - 1] ? planData.questions[f.question - 1] : null,
        url: p.url,
        // Information for a year before the one now running is outdated.
        status: ayStart !== null && ayStart < Math.min(targetStart, runningStart) ? "outdated" : status,
      });
    }
  }
  const remaining = col.pages.filter((p) => p.ok && !data.processed.includes(p.pageId)).length;
  if (remaining === 0 && data.facts.length === 0) {
    throw new PipelineHalt("No verifiable facts could be extracted from the sources. The topic needs better official sources.");
  }
  return { done: remaining === 0, data, log: `${data.facts.length} verified fact(s), ${data.discarded} unverifiable discarded` };
};

/* ═════════════════════════ 5. organise ═════════════════════════ */

const organiseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["conflicts", "gaps"],
  properties: {
    conflicts: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["fact_ids", "explanation"],
        properties: { fact_ids: { type: "array", items: { type: "string" } }, explanation: { type: "string" } },
      },
    },
    gaps: { type: "array", items: { type: "string" } },
  },
};
const organiseZ = z.object({
  conflicts: z.array(z.object({ fact_ids: z.array(z.string()), explanation: z.string() })),
  gaps: z.array(z.string()),
});

const organise: StageFn = async (job, ctx) => {
  const ex = cp<ExtractData>(job, "extract")!;
  const col = cp<CollectData>(job, "collect")!;
  const planData = cp<PlanData>(job, "plan")!;

  // Number the sources that actually back at least one fact.
  const urls = uniq(ex.facts.map((f) => f.url));
  const srcList: ArticleSource[] = urls.map((url, i) => {
    const p = col.pages.find((x) => x.url === url)!;
    return {
      n: i + 1,
      title: truncate(p.title || hostOf(url), 160),
      url,
      type: p.type,
      publisher: hostOf(url),
      accessedAt: nowIso().slice(0, 10),
      pageDate: p.pageDate ? p.pageDate.slice(0, 10) : undefined,
      academicYear: ex.facts.find((f) => f.url === url && f.academicYear)?.academicYear ?? undefined,
    };
  });
  const facts: ArticleFact[] = ex.facts.map((f) => ({
    id: f.id,
    statement: f.statement,
    quote: f.quote,
    sourceN: srcList.find((s) => s.url === f.url)!.n,
    academicYear: f.academicYear,
    status: f.status,
    question: f.question ?? undefined,
  }));

  let conflicts: string[] = [];
  let gaps = planData.questions.filter((q) => !facts.some((f) => f.question === q));
  if (facts.length >= 2) {
    await ctx.report(`Checking ${facts.length} facts for conflicts and gaps`);
    const out = await chatJson(
      {
        system: `${SYSTEM_BASE} Review a list of extracted facts. Identify facts that contradict each other (e.g. different fees or dates for the same thing and year) and research questions with no supporting fact. Return JSON only.`,
        user: [
          `Questions:\n${planData.questions.map((q, i) => `${i + 1}. ${q}`).join("\n")}`,
          `Facts:\n${facts.map((f) => `${f.id} [source ${f.sourceN}${f.academicYear ? `, ${f.academicYear}` : ""}]: ${f.statement}`).join("\n")}`,
        ].join("\n\n"),
        json: { name: "organise", schema: organiseSchema },
        maxTokens: 2000,
        reasoning: "low",
      },
      (v) => organiseZ.parse(v),
      { ...ctx.call, stage: "organise" },
    );
    const ids = new Set(facts.map((f) => f.id));
    for (const c of out.conflicts) {
      const valid = c.fact_ids.filter((id) => ids.has(id));
      if (valid.length < 2) continue;
      for (const f of facts) if (valid.includes(f.id)) f.status = "conflicting";
      conflicts.push(`${valid.join(" vs ")}: ${truncate(c.explanation, 200)}`);
    }
    gaps = uniq([...gaps, ...out.gaps.map((g) => truncate(g, 200))]).slice(0, 10);
  }
  conflicts = conflicts.slice(0, 10);
  const data: OrganiseData = { sources: srcList, facts, gaps, conflicts };
  return { done: true, data, log: `${srcList.length} source(s), ${conflicts.length} conflict(s), ${gaps.length} gap(s)` };
};

/* ═════════════════════════ 6. outline ═════════════════════════ */

const outlineSchema = {
  type: "object",
  additionalProperties: false,
  required: ["title", "sections"],
  properties: {
    title: { type: "string" },
    sections: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["heading", "purpose", "fact_ids"],
        properties: { heading: { type: "string" }, purpose: { type: "string" }, fact_ids: { type: "array", items: { type: "string" } } },
      },
    },
  },
};
const outlineZ = z.object({
  title: z.string(),
  sections: z.array(z.object({ heading: z.string(), purpose: z.string(), fact_ids: z.array(z.string()) })),
});

const outline: StageFn = async (job, ctx) => {
  const org = cp<OrganiseData>(job, "organise")!;
  const planData = cp<PlanData>(job, "plan")!;
  const strategy = STRATEGIES[job.category];
  await ctx.report(`Building the outline from ${org.facts.length} verified facts`);
  const out = await chatJson(
    {
      system: `${SYSTEM_BASE} Create an article outline that uses the verified facts. Return JSON only.`,
      user: [
        `Topic: ${job.topic}`,
        `Intent: ${planData.intent}. Angle: ${planData.angle}. Academic year: ${planData.academicYear}.`,
        `Required structure (keep this order; you may rename headings to be specific and reader-friendly, and add at most 2 sections): ${strategy.skeleton.join(" → ")}`,
        `Facts:\n${org.facts.map((f) => `${f.id}${f.status !== "verified" ? ` (${f.status})` : ""}: ${f.statement}`).join("\n")}`,
        org.gaps.length ? `Not covered by sources (do NOT promise details on these; at most mention they should be checked officially): ${org.gaps.join("; ")}` : "",
        "title: a specific, honest article title (max 75 characters, no clickbait, include the academic year only if time-sensitive).",
        "For each section give heading, purpose (1 sentence) and fact_ids (facts that belong there; each fact used at most twice).",
      ].join("\n\n"),
      json: { name: "outline", schema: outlineSchema },
      maxTokens: 2500,
      reasoning: "low",
    },
    (v) => outlineZ.parse(v),
    { ...ctx.call, stage: "outline" },
  );
  const ids = new Set(org.facts.map((f) => f.id));
  const sections = out.sections
    .filter((s) => s.heading.trim())
    .slice(0, 12)
    .map((s) => ({ heading: truncate(s.heading.replace(/^#+\s*/, ""), 90), purpose: truncate(s.purpose, 240), factIds: s.fact_ids.filter((id) => ids.has(id)) }));
  if (sections.length < 3) throw new Error("Outline had too few sections.");
  const data: OutlineData = { title: truncate(out.title.replace(/^["']|["']$/g, ""), 100), sections };
  return { done: true, data, log: `${sections.length} sections: ${data.title}` };
};

/* ═════════════════════════ 7. write (section by section) ═════════════════════════ */

const writeSchema = {
  type: "object",
  additionalProperties: false,
  required: ["markdown"],
  properties: { markdown: { type: "string" } },
};
const writeZ = z.object({ markdown: z.string() });

export { convertFactMarkers };

export async function writeSection(
  job: Pick<StudioJob, "topic" | "category">,
  args: {
    title: string;
    academicYear: string;
    section: { heading: string; purpose: string; factIds: string[] };
    allHeadings: string[];
    facts: ArticleFact[];
    sources: ArticleSource[];
    instruction?: string;
  },
  call: CallContext,
): Promise<{ body: string; unknown: number }> {
  const strategy = STRATEGIES[job.category];
  const own = args.facts.filter((f) => args.section.factIds.includes(f.id));
  const others = args.facts.filter((f) => !args.section.factIds.includes(f.id)).slice(0, 15);
  const fmt = (f: ArticleFact) => {
    const s = args.sources.find((x) => x.n === f.sourceN);
    return `${f.id} [${s?.type ?? "source"}${f.academicYear ? `, ${f.academicYear}` : ""}${f.status !== "verified" ? `, ${f.status.toUpperCase()}` : ""}]: ${f.statement}`;
  };
  const out = await chatJson(
    {
      system: [
        SYSTEM_BASE,
        "Write ONE section of a SKOLAR Insights article in Markdown.",
        "Hard rules:",
        "1) Every specific fact (number, date, fee, deadline, requirement, programme name, benefit) must come from the FACTS list and be followed by its marker, e.g. 'The programme lasts three years [F4].'",
        "2) If something is not in the facts, do not state it. You may say it 'could not be verified from official sources at the time of writing' and advise checking the official website.",
        "3) Facts marked OUTDATED must be presented as previous-year information. Facts marked CONFLICTING must mention that sources differ.",
        "4) No invented examples of real people, no testimonials, no rankings without a fact, no promises, no SKOLAR partnerships.",
        "5) Do NOT include the section heading (it is added automatically). You may use ### sub-headings, short paragraphs, bullet lists and Markdown tables. No HTML.",
        "6) Mobile-friendly: paragraphs of 2–4 sentences. 120–350 words for this section.",
        ...strategy.writerRules.map((r) => `- ${r}`),
      ].join("\n"),
      user: [
        `Article title: ${args.title}`,
        `Academic year: ${args.academicYear}`,
        `All section headings: ${args.allHeadings.join(" | ")}`,
        `THIS SECTION: "${args.section.heading}" — ${args.section.purpose}`,
        `FACTS for this section:\n${own.map(fmt).join("\n") || "(none — keep this section general and explanatory, with no specific factual claims)"}`,
        others.length ? `Other facts (only if essential):\n${others.map(fmt).join("\n")}` : "",
        args.instruction ? `Editor's instruction for this rewrite: ${args.instruction}` : "",
        'Return {"markdown": "..."}',
      ]
        .filter(Boolean)
        .join("\n\n"),
      json: { name: "section", schema: writeSchema },
      maxTokens: 3500,
      temperature: 0.4,
      reasoning: "low",
    },
    (v) => writeZ.parse(v),
    call,
  );
  const headingText = args.section.heading.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const cleaned = out.markdown
    .trim()
    // drop a leading heading that repeats the section title (any level)
    .replace(/^#{1,6}\s+(.*)\n+/, (m, h: string) => (h.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() === headingText ? "" : m))
    .replace(/^#{1,2}\s+.*\n+/, "") // drop a repeated top-level heading
    .replace(/^#{1,2}\s/gm, "### ")
    .trim();
  const conv = convertFactMarkers(cleaned, args.facts);
  return { body: conv.md, unknown: conv.unknown };
}

const write: StageFn = async (job, ctx) => {
  const ol = cp<OutlineData>(job, "outline")!;
  const org = cp<OrganiseData>(job, "organise")!;
  const planData = cp<PlanData>(job, "plan")!;
  const prev = cp<WriteData>(job, "write");
  const data: WriteData = prev ?? { sections: [], unknownFactRefs: 0 };
  for (let i = 0; i < 2 && data.sections.length < ol.sections.length; i++) {
    const s = ol.sections[data.sections.length];
    await ctx.report(`Writing section ${data.sections.length + 1}/${ol.sections.length}: ${s.heading}`);
    const r = await writeSection(
      job,
      { title: ol.title, academicYear: planData.academicYear, section: s, allHeadings: ol.sections.map((x) => x.heading), facts: org.facts, sources: org.sources },
      { ...ctx.call, stage: "write" },
    );
    data.sections.push({ heading: s.heading, body: r.body });
    data.unknownFactRefs += r.unknown;
  }
  return { done: data.sections.length >= ol.sections.length, data, log: `${data.sections.length}/${ol.sections.length} sections written` };
};

/* ═════════════════════════ 8. verify ═════════════════════════ */

const verify: StageFn = async (job) => {
  // Deterministic: claim verification happens in runChecks(); here we only
  // record the body and citation integrity so later stages work on a fixed text.
  const w = cp<WriteData>(job, "write")!;
  const body = joinSections(w.sections);
  return { done: true, data: { body, unknownFactRefs: w.unknownFactRefs }, log: "Citations converted and claims prepared" };
};

/* ═════════════════════════ 9. review (AI editorial review) ═════════════════════════ */

const reviewSchema = {
  type: "object",
  additionalProperties: false,
  required: ["issues"],
  properties: {
    issues: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["severity", "excerpt", "problem"],
        properties: {
          severity: { type: "string", enum: ["block", "warn", "info"] },
          excerpt: { type: "string" },
          problem: { type: "string" },
        },
      },
    },
  },
};
const reviewZ = z.object({
  issues: z.array(z.object({ severity: z.enum(["block", "warn", "info"]), excerpt: z.string(), problem: z.string() })),
});

export async function aiEditorialReview(
  body: string,
  facts: ArticleFact[],
  category: StudioJob["category"],
  call: CallContext,
): Promise<EditorialWarning[]> {
  const out = await chatJson(
    {
      system: [
        SYSTEM_BASE,
        "You are the strict SKOLAR editorial reviewer. Find problems that could mislead students or damage trust:",
        "unsupported claims, outdated or wrong academic years, misleading scholarship/admission/visa/job promises, unverified rankings, fake testimonials, invented facilities, unlabelled estimates, one-sided comparisons, sales-pitch tone.",
        "`excerpt` must be copied exactly from the article (max 150 characters). Max 8 issues. Only real problems; an empty list is fine.",
      ].join(" "),
      user: [`Category: ${STRATEGIES[category].label}`, `Verified facts:\n${facts.map((f) => `- ${f.statement}`).join("\n").slice(0, 3500)}`, `ARTICLE:\n${body.slice(0, 14_000)}`].join("\n\n"),
      json: { name: "review", schema: reviewSchema },
      maxTokens: 2500,
      reasoning: "medium",
    },
    (v) => reviewZ.parse(v),
    call,
  );
  const norm = normForMatch(body);
  return out.issues
    .filter((i) => i.excerpt.trim().length > 8 && norm.includes(normForMatch(i.excerpt).slice(0, 80)))
    .slice(0, 8)
    .map((i) => ({ code: "ai_review", severity: i.severity, message: truncate(i.problem, 300), excerpt: truncate(i.excerpt, 200), origin: "ai" as const }));
}

const review: StageFn = async (job, ctx) => {
  const v = cp<{ body: string }>(job, "verify")!;
  const org = cp<OrganiseData>(job, "organise")!;
  await ctx.report(`Editorial review of ${v.body.split(/\s+/).length} words`);
  const warnings = await aiEditorialReview(v.body, org.facts, job.category, { ...ctx.call, stage: "review" });
  return { done: true, data: { warnings }, log: `${warnings.length} editorial issue(s) flagged` };
};

/* ═════════════════════════ 10. seo ═════════════════════════ */

const seoSchema = {
  type: "object",
  additionalProperties: false,
  required: ["seo_title", "meta_description", "excerpt", "slug", "tags"],
  properties: {
    seo_title: { type: "string" },
    meta_description: { type: "string" },
    excerpt: { type: "string" },
    slug: { type: "string" },
    tags: { type: "array", items: { type: "string" } },
  },
};
const seoZ = z.object({ seo_title: z.string(), meta_description: z.string(), excerpt: z.string(), slug: z.string(), tags: z.array(z.string()) });

const seo: StageFn = async (job, ctx) => {
  const ol = cp<OutlineData>(job, "outline")!;
  const v = cp<{ body: string }>(job, "verify")!;
  await ctx.report("Writing SEO title, meta description and slug");
  const out = await chatJson(
    {
      system: `${SYSTEM_BASE} Write search metadata that accurately reflects the article (no clickbait, no promises). Return JSON only.`,
      user: [
        `Title: ${ol.title}`,
        `Article start:\n${v.body.slice(0, 2500)}`,
        "seo_title ≤ 60 characters; meta_description 120–155 characters; excerpt ≤ 200 characters (one or two sentences for the article card); slug: short lowercase-hyphenated; tags: 3–6 short topic tags.",
      ].join("\n\n"),
      json: { name: "seo", schema: seoSchema },
      maxTokens: 1200,
      reasoning: "low",
    },
    (val) => seoZ.parse(val),
    { ...ctx.call, stage: "seo" },
  );
  const data: SeoData = {
    seoTitle: truncate(out.seo_title.trim(), 65),
    metaDescription: truncate(out.meta_description.trim(), 160),
    excerpt: truncate(out.excerpt.trim(), 220),
    slug: slugify(out.slug || ol.title, 70),
    tags: out.tags.map((t) => truncate(t.trim(), 30)).filter(Boolean).slice(0, 6),
  };
  return { done: true, data, log: `SEO title: ${data.seoTitle}` };
};

/* ═════════════════════════ 11. links ═════════════════════════ */

export async function relatedFor(title: string, excludeId?: string): Promise<string[]> {
  const all = await listArticles();
  return all
    .filter((a) => a.id !== excludeId && ["published", "scheduled", "approved"].includes(a.status))
    .map((a) => ({ slug: a.slug, s: similarity(title, a.title) + (a.status === "published" ? 0.05 : 0) }))
    .filter((x) => x.s > 0.08)
    .sort((a, b) => b.s - a.s)
    .slice(0, 3)
    .map((x) => x.slug);
}

const links: StageFn = async (job) => {
  const ol = cp<OutlineData>(job, "outline")!;
  const relatedSlugs = await relatedFor(`${ol.title} ${job.topic}`, job.targetArticleId);
  return { done: true, data: { relatedSlugs }, log: `${relatedSlugs.length} related article(s)` };
};

/* ═════════════════════════ 12–14. images ═════════════════════════ */

export function articleIdFor(job: Pick<StudioJob, "id" | "targetArticleId">): string {
  return job.targetArticleId ?? `art_${job.id.replace(/^job_/, "")}`;
}

function imageInput(job: StudioJob) {
  const ol = cp<OutlineData>(job, "outline")!;
  const v = cp<{ body: string }>(job, "verify")!;
  const s = cp<SeoData>(job, "seo");
  const planData = cp<PlanData>(job, "plan")!;
  return { title: ol.title, category: job.category, body: v.body, academicYear: STRATEGIES[job.category].timeSensitive ? planData.academicYear : undefined, tags: s?.tags ?? [] };
}

interface ImageGenData {
  failed?: string;
  files?: { cover: string; card: string };
  hash?: string;
  attempts?: number;
  problems?: string[];
  provider?: string;
  model?: string;
  concept?: ImageConcept;
}

const imageConcept: StageFn = async (job, ctx) => {
  const input = imageInput(job);
  const an = analyseArticle(input);
  const existing = await getArticle(articleIdFor(job));
  const c = chooseConcept(an, { variant: (existing?.images ?? []).length, recent: existing?.images ?? [], useAi: Boolean(aiProvider()), articleKey: articleIdFor(job) });
  await ctx.report(`Visual concept: ${c.concept}`);
  return {
    done: true,
    data: { analysis: an, format: c.format, palette: c.palette, concept: c.concept, prompt: c.prompt, aiProvider: aiProvider()?.label ?? null },
    log: `Concept: ${FORMAT_LABELS[c.format]}`,
  };
};

const imageGenerate: StageFn = async (job, ctx) => {
  const articleId = articleIdFor(job);
  const existing = await getArticle(articleId);
  let g;
  try {
    g = await generateImage({ id: articleId, ...imageInput(job), images: existing?.images ?? [] }, { report: ctx.report });
  } catch (err) {
    if (err instanceof ImageProviderError && !err.permanent) throw err; // transient: retry the stage
    const failed = err instanceof Error ? err.message : String(err);
    await ctx.report(`Image generation failed: ${failed}`);
    return { done: true, data: { failed } as ImageGenData, log: `Image generation failed: ${failed}` };
  }
  const dir = path.join(studioEnv.dataDir(), "tmp", "images", job.id);
  await fs.mkdir(dir, { recursive: true });
  const files = { cover: path.join(dir, "cover.webp"), card: path.join(dir, "card.webp") };
  await fs.writeFile(files.cover, g.rendered.cover);
  await fs.writeFile(files.card, g.rendered.card);
  const data: ImageGenData = { files, hash: g.rendered.hash, attempts: g.attempts, problems: g.rendered.problems, provider: g.provider, model: g.model, concept: g.concept };
  return { done: true, data, log: `Generated ${FORMAT_LABELS[g.concept.format]} (${g.attempts} attempt${g.attempts === 1 ? "" : "s"}, QC passed)` };
};

const imageUpload: StageFn = async (job, ctx) => {
  const gen = cp<ImageGenData>(job, "image_generate")!;
  if (gen.failed || !gen.concept) return { done: true, data: { failed: gen.failed ?? "No image was generated" }, log: "Skipped upload (no image)" };
  const articleId = articleIdFor(job);
  const existing = await getArticle(articleId);
  let cover: Buffer;
  let card: Buffer;
  try {
    cover = await fs.readFile(gen.files!.cover);
    card = await fs.readFile(gen.files!.card);
  } catch {
    // Temp files lost (e.g. another machine resumed the job): re-render the same concept.
    await ctx.report("Temporary image files missing — re-rendering the chosen concept");
    const r = await renderConcept(gen.concept);
    cover = r.cover;
    card = r.card;
  }
  const version = (existing?.images ?? []).length + 1;
  await ctx.report(`Uploading cover and card images to Vercel Blob (v${version})`);
  try {
    const img = await uploadGenerated(
      articleId,
      { concept: gen.concept, rendered: { cover, card, hash: gen.hash ?? "", problems: gen.problems ?? [] }, attempts: gen.attempts ?? 1, provider: gen.provider ?? "skolar-render", model: gen.model },
      version,
      altFor({ title: imageInput(job).title }, gen.concept),
    );
    if (gen.files) await fs.rm(path.dirname(gen.files.cover), { recursive: true, force: true }).catch(() => undefined);
    return { done: true, data: { image: img }, log: `Uploaded ${img.url}` };
  } catch (err) {
    if (err instanceof MediaNotConfiguredError) return { done: true, data: { failed: err.message }, log: err.message };
    throw err; // transient upload failure → retried with backoff
  }
};

/* ═════════════════════════ 15. finalize ═════════════════════════ */

const finalize: StageFn = async (job, ctx) => {
  const ol = cp<OutlineData>(job, "outline")!;
  const org = cp<OrganiseData>(job, "organise")!;
  const planData = cp<PlanData>(job, "plan")!;
  const v = cp<{ body: string; unknownFactRefs: number }>(job, "verify")!;
  const rv = cp<{ warnings: EditorialWarning[] }>(job, "review")!;
  const s = cp<SeoData>(job, "seo")!;
  const ln = cp<{ relatedSlugs: string[] }>(job, "links")!;
  const col = cp<CollectData>(job, "collect")!;
  const src = cp<SourcesData>(job, "sources")!;
  const strategy = STRATEGIES[job.category];
  const cta = ctx.settings.ctas.find((c) => c.key === strategy.defaultCta) ?? ctx.settings.ctas.find((c) => c.categories.includes(job.category)) ?? ctx.settings.ctas[0];

  const pipelineWarnings: EditorialWarning[] = [];
  if (org.conflicts.length) pipelineWarnings.push({ code: "source_conflict", severity: "warn", message: `Sources disagree: ${org.conflicts.join(" · ")}`, origin: "pipeline" });
  if (org.gaps.length) pipelineWarnings.push({ code: "research_gaps", severity: "info", message: `Not covered by sources: ${org.gaps.join("; ")}`, origin: "pipeline" });
  const failed = col.pages.filter((p) => !p.ok);
  if (failed.length) pipelineWarnings.push({ code: "sources_unread", severity: "info", message: `Could not read: ${failed.map((p) => `${p.url} (${p.error ?? "no text"})`).join("; ")}`.slice(0, 900), origin: "pipeline" });
  if (v.unknownFactRefs) pipelineWarnings.push({ code: "unknown_fact_refs", severity: "warn", message: `${v.unknownFactRefs} citation marker(s) referred to unknown facts and were removed — check those sentences.`, origin: "pipeline" });
  if (!src.search.provider) pipelineWarnings.push({ code: "registry_only", severity: "info", message: "Researched from the source registry only (no search provider configured).", origin: "pipeline" });

  const existing = job.targetArticleId ? await getArticle(job.targetArticleId) : null;
  const articleId = articleIdFor(job);
  const up = cp<{ image?: ArticleImage; failed?: string }>(job, "image_upload");
  if (up?.failed) pipelineWarnings.push({ code: "image_failed", severity: "warn", message: `Cover image was not generated: ${up.failed}. Use “Generate image” in the Image tab.`, origin: "pipeline" });
  const already = existing ?? (await getArticle(articleId));
  const slug = already?.slug ?? (await uniqueSlug(s.slug || ol.title, articleId));
  const startedAt = job.startedAt ?? job.createdAt;
  const base: StudioArticle = blankArticle({
    id: articleId,
    title: ol.title,
    slug,
    excerpt: s.excerpt,
    body: v.body,
    category: job.category,
    countryId: job.countryId,
    universityIds: job.entityIds.filter((id) => !id.startsWith("sch:")),
    scholarshipIds: [],
    audience: planData.audience,
    academicYear: strategy.timeSensitive ? planData.academicYear : undefined,
    seoTitle: s.seoTitle,
    metaDescription: s.metaDescription,
    tags: s.tags,
    cta: cta ? { key: cta.key, text: cta.text, label: cta.label } : undefined,
    sources: org.sources,
    facts: org.facts,
    warnings: [...rv.warnings, ...pipelineWarnings],
    relatedSlugs: ln.relatedSlugs,
    origin: "ai",
    jobId: job.id,
    topicId: job.topicId ?? existing?.topicId,
  });
  const checks = runChecks(base, ctx.settings);
  const article: StudioArticle = {
    ...base,
    claims: checks.claims,
    warnings: checks.warnings,
    qualityGate: checks.qualityGate,
    status: checks.qualityGate.passed ? "draft" : "needs_review",
    coverImage: up?.image
      ? { url: up.image.url, cardUrl: up.image.cardUrl, imageId: up.image.id, alt: up.image.alt, credit: up.image.credit, license: up.image.license, sourceUrl: up.image.sourceUrl }
      : already?.coverImage,
    images: [...(already?.images ?? []).filter((i) => i.id !== up?.image?.id), ...(up?.image ? [up.image] : [])],
    imageState: up?.image ? { status: "ready", at: nowIso() } : { status: "failed", error: up?.failed ?? "No image", at: nowIso() },
    generation: {
      startedAt,
      finishedAt: nowIso(),
      durationMs: Date.now() - Date.parse(startedAt),
      calls: [...(job.calls ?? []), ...(ctx.call.audit ?? [])].slice(-60),
    },
  };

  await getStore().transact<StudioArticle & Record<string, unknown>>(COL.articles, articleId, (cur) => {
    if (cur && ["approved", "scheduled", "published"].includes(cur.status) && job.origin !== "regenerate") {
      return undefined; // never overwrite an approved/published article from a resumed job
    }
    if (cur) {
      return { ...cur, ...article, schedule: cur.schedule, publish: cur.publish, createdAt: cur.createdAt, version: cur.version + 1, coverImage: article.coverImage ?? cur.coverImage } as StudioArticle & Record<string, unknown>;
    }
    return article as StudioArticle & Record<string, unknown>;
  });

  return {
    done: true,
    data: { articleId, passed: checks.qualityGate.passed, reasons: checks.qualityGate.reasons },
    log: checks.qualityGate.passed ? "Draft ready for review" : `Saved for review: ${checks.qualityGate.reasons.join(" ")}`,
  };
};

export const STAGES: Record<StageKey, StageFn> = {
  plan,
  sources,
  collect,
  extract,
  organise,
  outline,
  write,
  verify,
  review,
  seo,
  links,
  image_concept: imageConcept,
  image_generate: imageGenerate,
  image_upload: imageUpload,
  finalize,
};

export const STAGE_LABELS: Record<StageKey, string> = {
  plan: "Search intent & duplicate check",
  sources: "Source discovery",
  collect: "Reading official sources",
  extract: "Fact extraction",
  organise: "Organising facts & conflicts",
  outline: "Outline",
  write: "Writing with citations",
  verify: "Citation & claim preparation",
  review: "Editorial review",
  seo: "SEO",
  links: "Internal links",
  image_concept: "Image concept selection",
  image_generate: "Image generation & QC",
  image_upload: "Image upload to Vercel Blob",
  finalize: "Claim verification & review preparation",
};

export function nextStage(stage: StageKey): StageKey | null {
  const i = PIPELINE_STAGES.indexOf(stage);
  return i >= 0 && i < PIPELINE_STAGES.length - 1 ? PIPELINE_STAGES[i + 1] : null;
}

export { getSettings };
