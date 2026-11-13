import type { ArticleClaim, ArticleFact, ArticleSource, CategoryKey, ClaimKind, EditorialWarning, VerificationStatus } from "./types";
import { splitSections } from "./markdown";
import { citationNumbers, malformedCitations, resolveCitations, validateSources } from "./sources";
import { normForMatch, similarity } from "./util";

/**
 * Deterministic editorial safety checks. These run on every AI and manual
 * article and are the backbone of the review layer; the AI review adds to
 * them but can never remove them.
 *
 * Citation model (the editor's format is [[n]]):
 *  - a citation covers its own sentence;
 *  - a citation at the end of a passage also covers the uncited sentences
 *    directly before it in the same paragraph (sentences AFTER the last
 *    citation of a paragraph stay uncited);
 *  - table rows and list items inherit the citations of the paragraph that
 *    introduces them (same section).
 * Coverage only decides whether a statement HAS a source. Whether the source
 * supports it is a separate status ("verified" needs matching evidence).
 */

/* ───────────────────────── Text model ───────────────────────── */

interface Block {
  type: "heading" | "para" | "list" | "table" | "quote" | "hr";
  text: string;
  rows?: string[];
  heading: string;
}

function parseBlocks(body: string): Block[] {
  const blocks: Block[] = [];
  let cur: Block | null = null;
  let heading = "";
  let fence = false;
  const flush = () => {
    if (cur) blocks.push(cur);
    cur = null;
  };
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, "");
    if (/^\s*```/.test(line)) {
      fence = !fence;
      flush();
      continue;
    }
    if (fence) continue;
    if (!line.trim()) {
      flush();
      continue;
    }
    const h = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (h) {
      flush();
      heading = h[2];
      blocks.push({ type: "heading", text: h[2], heading });
      continue;
    }
    if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      flush();
      blocks.push({ type: "hr", text: "", heading });
      continue;
    }
    if (/^\s*\|/.test(line)) {
      if (cur?.type !== "table") {
        flush();
        cur = { type: "table", text: "", rows: [], heading };
      }
      cur!.rows!.push(line.trim());
      continue;
    }
    const li = /^\s*(?:[-*•+]|\d{1,2}[.)])\s+(.*)$/.exec(line);
    if (li && !/^\s*\*\*/.test(line)) {
      flush();
      cur = { type: "list", text: li[1].trim(), heading };
      continue;
    }
    if (/^\s*>/.test(line)) {
      if (cur?.type !== "quote") {
        flush();
        cur = { type: "quote", text: "", heading };
      }
      cur!.text = `${cur!.text} ${line.replace(/^\s*>\s?/, "")}`.trim();
      continue;
    }
    if (cur && (cur.type === "para" || cur.type === "list" || cur.type === "quote")) {
      cur.text = `${cur.text} ${line.trim()}`;
      continue;
    }
    flush();
    cur = { type: "para", text: line.trim(), heading };
  }
  flush();
  return blocks;
}

const ABBR = /\b(e\.g|i\.e|etc|approx|vs|no|nos|art|min|max|St|Dr|Prof)\./gi;

/** Splits prose into sentences; trailing citations ("… Italy. [[1]]") stay with their sentence. */
function splitProse(text: string): string[] {
  const guarded = text.replace(ABBR, (m) => m.replace(/\./g, "\u0000"));
  return guarded
    .split(/(?<=[.!?](?:\*{1,2}|_)?(?:\s*\[\[\d{1,3}]])*)\s+(?=["“(*_]*[A-Z0-9€₹])/)
    .map((s) => s.replace(/\u0000/g, ".").trim())
    .filter(Boolean);
}

function isTableSeparator(row: string) {
  return /^\|?\s*:?-{3,}/.test(row) && /^[|\s:-]+$/.test(row);
}

export interface TextUnit {
  text: string;
  /** Citations written in this sentence/row. */
  own: number[];
  /** Citations this unit inherits (passage or lead-in paragraph). */
  inherited: number[];
  basis: "sentence" | "paragraph" | "lead_in" | null;
  blockType: Block["type"];
  /** Paragraph + lead-in + following note + heading: used to detect estimate/personal labels. */
  context: string;
  heading: string;
}

/** Every checkable sentence / table row / list item with the citations that cover it. */
export function textUnits(body: string): TextUnit[] {
  const blocks = parseBlocks(body);
  const out: TextUnit[] = [];
  blocks.forEach((b, i) => {
    if (b.type === "heading" || b.type === "hr") return;
    if (b.type === "quote" && /^\*\*/.test(b.text)) return; // callouts ("> **Note** …")
    // Paragraphs introducing this block (same section), skipping the preceding items of the same list.
    const leadIn: Block[] = [];
    if (b.type === "table" || b.type === "list") {
      for (let j = i - 1; j >= 0 && leadIn.length < 2; j--) {
        const p = blocks[j];
        if (p.type === "heading" || p.type === "hr" || p.type === "table") break;
        if (p.type === "list") {
          if (b.type === "list" && leadIn.length === 0) continue;
          break;
        }
        if (p.type === "para") leadIn.push(p);
      }
    }
    let after = "";
    for (let j = i + 1; j < blocks.length; j++) {
      const p = blocks[j];
      if (p.type === "heading" || p.type === "hr") break;
      if (p.type === "para") {
        after = p.text;
        break;
      }
      if (p.type !== b.type) break;
    }
    const leadCites = [...new Set(leadIn.flatMap((p) => citationNumbers(p.text)))].sort((x, y) => x - y);
    const context = [b.text, ...leadIn.map((p) => p.text), after, b.heading].join(" \n ");

    if (b.type === "table") {
      const rows = b.rows ?? [];
      rows.forEach((row, r) => {
        if (isTableSeparator(row) || isTableSeparator(rows[r + 1] ?? "")) return; // separator / header row
        const own = citationNumbers(row);
        out.push({ text: row, own, inherited: own.length ? [] : leadCites, basis: own.length ? "sentence" : leadCites.length ? "lead_in" : null, blockType: "table", context: `${row} \n ${context}`, heading: b.heading });
      });
      return;
    }
    const sents = splitProse(b.text);
    // A citation covers the uncited sentences directly before it in the same passage.
    const cover: number[][] = new Array(sents.length).fill(null).map(() => []);
    let pending: number[] = [];
    sents.forEach((s, k) => {
      const own = citationNumbers(s);
      if (own.length) {
        for (const p of pending) cover[p] = own;
        pending = [];
      } else pending.push(k);
    });
    sents.forEach((s, k) => {
      const own = citationNumbers(s);
      const passage = own.length ? [] : cover[k];
      const inherited = own.length ? [] : passage.length ? passage : b.type === "list" ? leadCites : [];
      out.push({
        text: s,
        own,
        inherited,
        basis: own.length ? "sentence" : passage.length ? "paragraph" : inherited.length ? "lead_in" : null,
        blockType: b.type,
        context,
        heading: b.heading,
      });
    });
  });
  return out;
}

/* ───────────────────────── Classification ───────────────────────── */

const NUMBERISH = /(€|\beur\b|\binr\b|₹|\$|\d+(?:[.,]\d+)?\s?%|\b\d{1,3}(?:[.,]\d{3})+\b|\b\d+(?:[.,]\d+)?\s?(?:euro|ects|cfu|credits|years?|months?|days?|hours?|lakh|crore)\b|\b(?:19|20)\d{2}\b|\b\d{1,2}\s(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b)/i;
const REQUIREMENT = /\b(must|required|mandatory|deadline|eligible|eligibility|minimum|maximum|at least|no later than|by \d)/i;
/** Academic-year labels ("2027/2028") alone do not make a sentence a factual claim. */
const AY_LABEL = /\b20\d{2}\s?[/–-]\s?(?:20)?\d{2}\b/g;
/** Advice to the reader ("check the official page…", "deadlines can change…") is not a factual claim. */
const ADVISORY =
  /\b(check(?:ed|ing)?|confirm|verify|consult|we recommend|recommended|make sure|ensure you|can change|may change|could change|may be updated|subject to change|sources differ|could not be verified|where (?:required|applicable)|if (?:required|applicable)|when required|you (?:may|might|will|would) (?:also )?need to|you need to (?:know|understand|check|consider|plan|prepare)|think about|ask whether|depending on)\b/i;

/** Hedged general statements ("may be eligible", "depends on eligibility") are not concrete requirement claims. */
const HEDGE = /\b(may|might|could|can|depends? on|vary|varies|generally|usually|often)\b/i;

export function isFactualSentence(s: string): boolean {
  const plain = s.replace(/\[\[\d+]]/g, "").replace(AY_LABEL, "");
  if (NUMBERISH.test(plain)) return true;
  return REQUIREMENT.test(plain) && !ADVISORY.test(plain) && !HEDGE.test(plain);
}

/** A money AMOUNT (a currency word alone, e.g. "track your expenses in euros", is not one). */
const MONEY = /[€₹$]\s?\d|\d[\d.,]*\s?[€₹]|\b(?:eur|euros?|inr|rs\.?|rupees?)\s?\d|\d[\d.,]*\s?(?:eur|euros?|inr|rupees?|lakh|crore)\b/i;
/** Labels inside the sentence itself. */
const SENTENCE_ESTIMATE = /\b(illustrative|illustration|estimat\w*|approximat\w*|approx\.|roughly|around|about\s(?=[€₹$\d])|assum\w*|scenarios?|indicative|hypothetical|typical(?:ly)?|may vary|varies|vary by|for reference only|reference conversions?|budgeting assumptions?|planning (?:figures?|guidelines?|scenarios?))/i;
/** Explicit labels in the surrounding paragraph / table introduction / note. */
const CONTEXT_ESTIMATE = /\b(illustrative|illustration|estimates?|estimated|assumptions?|scenarios?|hypothetical|budgeting assumptions?|planning (?:figures?|guidelines?|scenarios?)|broad (?:planning )?(?:figures?|guidelines?)|not (?:official|fixed|guaranteed) (?:prices?|averages?|costs?|spending)|reference conversions?)\b/i;
const HYPOTHETICAL = /\b(?:may|might|could|would)\b[^.]{0,90}\bif\b|\bif\b[^.]{0,90}\b(?:may|might|could|would)\b|\b(?:imagine|suppose|say you)\b/i;
const PERSONAL_SENTENCE = /\b(in my experience|when I (?:arrived|moved|studied|lived)|I (?:spent|paid|spend|pay)|(?:one|a) (?:real |current |former )?(?:international |indian )?student\b[^.]{0,60}\b(?:reports?|says|said|spends?|spent|pays?|paid|shared|told))\b/i;
const PERSONAL_CONTEXT = /\b(personal (?:example|experience|estimate|observation|account|budget)|anecdot\w*|real student example|individual (?:spending|experience))\b/i;
const OFFICIAL = /\b(ministry|government|consulate|embassy|official|regulation|decree|law|must|required|mandatory|eligib\w*|deadline|minimum|maximum|visa|permit)\b/i;

export function classifyUnit(u: Pick<TextUnit, "text" | "context">): { kind: ClaimKind; labelled: boolean } {
  const s = u.text;
  const ctx = u.context;
  if (PERSONAL_SENTENCE.test(s) || (PERSONAL_CONTEXT.test(ctx) && (MONEY.test(s) || /\b(I|my|reports?)\b/.test(s)))) {
    return { kind: "personal", labelled: PERSONAL_CONTEXT.test(ctx) || /\bpersonal\b/i.test(s) };
  }
  if (SENTENCE_ESTIMATE.test(s) || HYPOTHETICAL.test(s) || CONTEXT_ESTIMATE.test(ctx)) return { kind: "estimate", labelled: true };
  if (/\bSKOLAR\b/.test(s) && !NUMBERISH.test(s.replace(AY_LABEL, ""))) return { kind: "promotional", labelled: false };
  if (OFFICIAL.test(s)) return { kind: "official_requirement", labelled: false };
  return { kind: "fact", labelled: false };
}

const isQuestion = (s: string) => /\?\s*(?:\*{1,2}|_)?\s*$/.test(s.replace(/\s*\[\[\d+]]/g, ""));
const isDisclaimer = (u: TextUnit) => /^\W*disclaimer\b/i.test(u.text) || /^\W*disclaimer\b/i.test(u.context.trimStart());

function numberTokens(s: string): string[] {
  return [...s.matchAll(/\d+(?:[.,]\d+)*/g)].map((m) => m[0].replace(/[.,](?=\d{3}\b)/g, "").replace(",", ".")).filter((t) => t.length > 0);
}

/* ───────────────────────── Claims ───────────────────────── */

/** Classifies factual sentences against the cited facts. Never marks anything verified without matching evidence. */
export function verifyClaims(body: string, facts: ArticleFact[], sources: ArticleSource[]): ArticleClaim[] {
  const claims: ArticleClaim[] = [];
  const bySource = new Map<number, ArticleFact[]>();
  for (const f of facts) bySource.set(f.sourceN, [...(bySource.get(f.sourceN) ?? []), f]);
  const knownSources = new Set(sources.map((s) => s.n));
  let i = 0;
  for (const u of textUnits(body)) {
    const s = u.text.replace(/^[-*•]\s+/, "");
    if (s.replace(/[|*_\s]/g, "").length < 12) continue;
    if (isQuestion(s) || isDisclaimer(u)) continue;
    const isFactual = isFactualSentence(s);
    const cites = u.own.length ? u.own : u.inherited;
    if (!isFactual && !u.own.length) continue;
    const text = s.replace(/\s*\[\[\d+]]/g, "").replace(/\s+/g, " ").trim();
    const ayMatch = /\b(20\d{2})\s?[/–-]\s?(?:20)?(\d{2})\b/.exec(text);
    const { kind, labelled } = classifyUnit(u);
    let status: VerificationStatus;
    let note: string | undefined;
    let evidence: boolean | undefined;
    const unknown = cites.filter((n) => !knownSources.has(n));
    if (!cites.length) {
      status = "unverified";
      note = labelled
          ? kind === "personal"
            ? "Labelled personal example — not presented as a general fact (no source needed; keep the label)."
            : "Labelled estimate / illustration — no source needed, but keep the label."
          : "Factual statement without a citation.";
    } else if (unknown.length) {
      status = "needs_review";
      note = `Cites source ${unknown.join(", ")}, which is not in the saved source list.`;
    } else {
      const supporting = cites.flatMap((n) => bySource.get(n) ?? []);
      const supportText = normForMatch(supporting.map((f) => `${f.statement} ${f.quote}`).join(" "));
      const nums = numberTokens(text).filter((n) => !/^(1|2|3|4|5)$/.test(n));
      const missing = nums.filter((n) => !supportText.includes(n));
      // Conflict/outdated status comes only from the facts this sentence is actually about.
      const relevant = supporting
        .map((f) => ({ f, s: similarity(text, `${f.statement} ${f.quote}`) }))
        .filter((x) => x.s >= 0.2)
        .sort((a, b) => b.s - a.s)
        .slice(0, 2)
        .map((x) => x.f);
      const flagged = relevant.find((f) => f.status === "conflicting" || f.status === "outdated");
      if (!supporting.length) {
        // Manually added sources have no extracted facts: a human must confirm.
        status = "needs_review";
        evidence = false;
        note = u.basis === "sentence" ? "Source cited — no extracted evidence to compare against; confirm the source supports it." : `Covered by the ${u.basis === "paragraph" ? "passage" : "introducing paragraph"}'s citation — confirm the source supports it.`;
      } else if (flagged) {
        status = flagged.status;
        note = flagged.status === "conflicting" ? "Sources disagree on this point." : "Evidence refers to an older academic year.";
      } else if (nums.length && missing.length === nums.length) {
        status = "needs_review";
        note = `Numbers not found in the cited evidence: ${missing.join(", ")}`;
      } else if (missing.length) {
        status = "partially_verified";
        note = `Some numbers not found in the cited evidence: ${missing.join(", ")}`;
      } else if ((relevant.length ? relevant : supporting).every((f) => f.status === "verified") && (relevant.length > 0 || nums.length > 0)) {
        status = "verified";
      } else {
        status = "partially_verified";
        if (!relevant.length && !nums.length) note = "Cited, but the evidence wording differs — check the source supports it.";
      }
    }
    claims.push({
      id: `c${++i}`,
      text: text.slice(0, 400),
      sourceNs: cites,
      status,
      note,
      academicYear: ayMatch ? `${ayMatch[1]}/${ayMatch[1].slice(0, 2)}${ayMatch[2]}` : undefined,
      kind,
      basis: cites.length ? (u.basis ?? undefined) : undefined,
      labelled: labelled || undefined,
      evidence,
    });
  }
  return claims;
}

/* ───────────────────────── Rules ───────────────────────── */

const NEGATION = /\b(?:not|no|never|cannot|can't|can not|don't|doesn't|does not|do not|isn't|is not|aren't|are not|won't|will not|without|neither|nor|nothing|nobody|no one)\b/i;
const CLAUSE_BREAK = /(?:[;:]|\bbut\b|\bhowever\b|\byet\b|\balthough\b|\bthough\b|\bwhereas\b|,\s+(?=(?:we|you|they|skolar|our|i)\b))/gi;

/** True when the word at `idx` sits inside a negated clause ("SKOLAR does not guarantee …", "is not a … guarantee of …"). */
export function negatedAt(sentence: string, idx: number): boolean {
  const before = sentence.slice(0, idx);
  let start = 0;
  for (const m of before.matchAll(CLAUSE_BREAK)) start = m.index! + m[0].length;
  const clause = before.slice(start).replace(/\bnot only\b/gi, "");
  return NEGATION.test(clause);
}

interface PromiseRule {
  code: string;
  trigger: RegExp;
  object: RegExp;
  message: string;
}

const PROMISES: PromiseRule[] = [
  { code: "guaranteed_admission", trigger: /\b(guarantee[sd]?|guaranteeing|assured|100\s?%|certain(?:ly)? (?:get|secure))\b/gi, object: /\b(admission|admit|acceptance|seat|offer|place)/i, message: "Implies guaranteed admission. SKOLAR never promises admission." },
  { code: "guaranteed_visa", trigger: /\b(guarantee[sd]?|guaranteeing|assured|100\s?%|sure-?shot)\b/gi, object: /\bvisa/i, message: "Implies guaranteed visa approval." },
  { code: "guaranteed_scholarship", trigger: /\b(guarantee[sd]?|guaranteeing|assured|will (?:definitely|surely) (?:get|receive)|100\s?%)\b/gi, object: /\b(scholarship|grant|funding|borsa)/i, message: "Promises a scholarship outcome." },
  { code: "employment_promise", trigger: /\b(guarantee[sd]?|guaranteeing|assured|will (?:definitely|surely) (?:get|find))\b/gi, object: /\b(job|employment|placement|work permit|salary)/i, message: "Misleading employment claim." },
];

/** Finds a promise that is not negated, not a question and not inside a disclaimer. */
function promiseIn(sentence: string, rule: PromiseRule): boolean {
  if (isQuestion(sentence) || /^\W*disclaimer\b/i.test(sentence)) return false;
  for (const m of sentence.matchAll(rule.trigger)) {
    const tail = sentence.slice(m.index! + m[0].length);
    let end = Math.min(tail.length, 60);
    for (const b of tail.matchAll(CLAUSE_BREAK)) {
      end = Math.min(end, b.index!);
      break;
    }
    if (!rule.object.test(tail.slice(0, end))) continue;
    if (negatedAt(sentence, m.index!)) continue;
    // "… is not guaranteed" after the object
    if (/^\s*(?:is|are|was|were)\s+(?:not|never)\b/i.test(tail.slice(0, 40)) && /guarantee/i.test(m[0])) continue;
    return true;
  }
  return false;
}

interface Rule {
  code: string;
  severity: EditorialWarning["severity"];
  pattern: RegExp;
  message: string;
  categories?: CategoryKey[];
}

const RULES: Rule[] = [
  {
    code: "skolar_partnership",
    severity: "block",
    pattern: /\bSKOLAR\b[^.]{0,80}\b(partner(?:ed|ship)?|official representative|affiliated|tie-?up|authori[sz]ed agent)\b/i,
    message: "Mentions a SKOLAR partnership. Only allowed if formally verified — remove unless confirmed.",
  },
  {
    code: "ranking_claim",
    severity: "warn",
    pattern: /\b(ranked|(?:world|global|national|university|QS|ARWU|subject|league) (?:rankings?|tables?)|QS|Times Higher Education|#\s?\d+\b|number one|no\.\s?1\b|top[- ]\d+\b|best universit(?:y|ies))/i,
    message: "Ranking or 'best' claim. Rankings must cite the ranking publisher and year.",
  },
  {
    code: "testimonial",
    severity: "warn",
    pattern: /(\b(?:said|says|recalls|told us)\b[^.]{0,40}\b(student|graduate|alumn)|["“][^"”]{10,}["”]\s*[-—–]\s*[A-Z][a-z]+)/,
    message: "Looks like a quote or testimonial. Fabricated testimonials are not allowed; real ones need consent and a source.",
  },
  {
    code: "first_person_story",
    severity: "warn",
    pattern: /\b(when I (?:arrived|moved|studied|lived)|my (?:first|own) (?:month|semester|year) in)\b/i,
    message: "Personal experience: label it clearly as a personal observation, never as a universal fact.",
  },
  {
    code: "absolute_cost",
    severity: "warn",
    pattern: /\b(every|all|any) students? (?:can|will) (?:live|manage|survive) (?:on|with)\b/i,
    message: "States that every student can live on a fixed amount.",
  },
  {
    code: "cheap_claim",
    severity: "info",
    pattern: /\b(cheapest|free education|zero fees|no fees at all)\b/i,
    message: "Strong cost claim — make sure it is sourced and qualified.",
  },
];

/** Sentences (incl. headings and table rows) for the wording rules. */
function ruleSentences(text: string): string[] {
  const out: string[] = [];
  for (const b of parseBlocks(text)) {
    if (b.type === "hr") continue;
    if (b.type === "table") out.push(...(b.rows ?? []).filter((r) => !isTableSeparator(r)));
    else if (b.type === "heading") out.push(b.text);
    else out.push(...splitProse(b.text));
  }
  return out.filter((s) => s.length > 8);
}

export interface LintInput {
  title: string;
  body: string;
  category: CategoryKey;
  academicYear?: string;
  claims: ArticleClaim[];
  sources: ArticleSource[];
  now?: Date;
}

const TECHNICAL = (w: Omit<EditorialWarning, "origin" | "category">): EditorialWarning => ({ ...w, origin: "rules", category: "technical" });

export function lintArticle(input: LintInput): EditorialWarning[] {
  const out: EditorialWarning[] = [];
  const all = ruleSentences(`${input.title}\n\n${input.body}`);

  for (const rule of PROMISES) {
    const hit = all.find((s) => promiseIn(s, rule));
    if (hit) out.push({ code: rule.code, severity: "block", message: rule.message, excerpt: hit.slice(0, 220), origin: "rules" });
  }
  for (const rule of RULES) {
    if (rule.categories && !rule.categories.includes(input.category)) continue;
    const hit = all.find((s) => rule.pattern.test(s) && !isQuestion(s));
    if (hit) out.push({ code: rule.code, severity: rule.severity, message: rule.message, excerpt: hit.slice(0, 220), origin: "rules" });
  }

  // A "# Title" inside the body duplicates the article title on the page.
  const h1 = /^\s{0,3}#\s+(.+)$/m.exec(input.body);
  if (h1) {
    out.push({ code: "body_h1", severity: "warn", message: "The body contains a top-level “# …” heading. The article title is shown separately, so this appears as a second title — remove it or put it in the Title field.", excerpt: h1[1].slice(0, 160), origin: "rules" });
  }

  // Academic years in the text that differ from the article's academic year.
  if (input.academicYear) {
    const target = Number(input.academicYear.slice(0, 4));
    const years = new Set<string>();
    for (const m of input.body.matchAll(/\b(20\d{2})\s?[/–-]\s?(?:20)?(\d{2})\b/g)) {
      const start = Number(m[1]);
      if (start < target) years.add(`${m[1]}/${m[1].slice(0, 2)}${m[2]}`);
    }
    if (years.size) {
      out.push({ code: "older_academic_year", severity: "warn", message: `Mentions earlier academic year(s) ${[...years].join(", ")} while the article targets ${input.academicYear}. Make sure old information is labelled as such.`, origin: "rules" });
    }
  } else if (["scholarship", "admissions", "university_guide", "programmes"].includes(input.category)) {
    out.push({ code: "missing_academic_year", severity: "block", message: "Time-sensitive article without an academic year.", origin: "rules" });
  }

  // Dates in the past presented as deadlines.
  const now = input.now ?? new Date();
  for (const s of all) {
    if (!/deadline|apply by|applications? (?:close|open)|scadenza|entro/i.test(s)) continue;
    const d = /\b(\d{1,2})\s(January|February|March|April|May|June|July|August|September|October|November|December)\s(20\d{2})\b/i.exec(s);
    if (d) {
      const t = Date.parse(`${d[1]} ${d[2]} ${d[3]} UTC`);
      if (Number.isFinite(t) && t < now.getTime()) {
        out.push({ code: "past_deadline", severity: "warn", message: "Mentions a deadline that has already passed.", excerpt: s.slice(0, 220), origin: "rules" });
        break;
      }
    }
  }

  // Money amounts need a source or an explicit estimate / illustration / personal-example label.
  const units = textUnits(input.body);
  if (input.category === "cost_of_living" || input.category === "student_life" || input.category === "city_guide") {
    const unlabelled = units.filter((u) => {
      if (!MONEY.test(u.text) || isQuestion(u.text) || isDisclaimer(u)) return false;
      if (u.own.length || u.inherited.length) return false;
      const c = classifyUnit(u);
      return !c.labelled;
    });
    if (unlabelled.length) {
      out.push({
        code: "unlabelled_estimate",
        severity: "block",
        message: `${unlabelled.length} money amount(s) have no source and are not labelled as an estimate, illustration or personal example.`,
        excerpt: unlabelled[0].text.slice(0, 220),
        origin: "rules",
      });
    }
    if (input.category === "cost_of_living" && !/assum/i.test(input.body)) {
      out.push({ code: "missing_assumptions", severity: "warn", message: "Cost article should state its assumptions (city, period, lifestyle, inclusions/exclusions).", origin: "rules" });
    }
  }

  // Claims summary
  const unverified = input.claims.filter((c) => c.status === "unverified" && !c.labelled);
  const labelledNoSource = input.claims.filter((c) => c.status === "unverified" && c.labelled).length;
  const review = input.claims.filter((c) => (c.status === "needs_review" && c.evidence !== false) || c.status === "conflicting").length;
  const unchecked = input.claims.filter((c) => c.status === "needs_review" && c.evidence === false).length;
  const outdated = input.claims.filter((c) => c.status === "outdated").length;
  if (unverified.length) {
    out.push({
      code: "unverified_claims",
      severity: unverified.length > 3 ? "block" : "warn",
      message: `${unverified.length} factual statement(s) have no citation. Add a source ([[n]]), label them as estimates/examples, or remove them.`,
      excerpt: unverified[0].text.slice(0, 220),
      origin: "rules",
    });
  }
  if (labelledNoSource) out.push({ code: "labelled_estimates", severity: "info", message: `${labelledNoSource} labelled estimate(s) or personal example(s) have no source. That is allowed — keep them clearly labelled.`, origin: "rules" });
  if (review) out.push({ code: "claims_need_review", severity: "warn", message: `${review} claim(s) need human review (conflicting sources or numbers not found in the evidence).`, origin: "rules" });
  if (unchecked) out.push({ code: "cited_unchecked", severity: "info", message: `${unchecked} cited statement(s) could not be checked automatically (no extracted evidence from those sources). Confirm each source supports them.`, origin: "rules" });
  if (outdated) out.push({ code: "outdated_claims", severity: "warn", message: `${outdated} claim(s) rely on older academic-year information.`, origin: "rules" });

  /* ── Technical: the page would be broken ── */
  const leftover = /\[F\d+[^\]]*\]/.exec(input.body);
  if (leftover) {
    out.push(TECHNICAL({ code: "research_marker", severity: "block", message: `Internal research marker left in the text: ${leftover[0]}. Use “Add citations from evidence” or replace it with [[n]].`, excerpt: leftover[0] }));
  }
  const bad = malformedCitations(input.body);
  if (bad.length) out.push(TECHNICAL({ code: "malformed_citation", severity: "block", message: `Citation markers must be written [[n]] (one number each, e.g. [[1]][[2]]). Fix: ${bad.slice(0, 5).join(" ")}`, excerpt: bad[0] }));
  const srcProblems = validateSources(input.sources);
  if (srcProblems.length) out.push(TECHNICAL({ code: "malformed_source", severity: "block", message: srcProblems.map((p) => p.message).join(" ") }));
  const cites = resolveCitations(input.body, input.sources);
  if (cites.missing.length) {
    const have = input.sources.map((s) => s.n);
    out.push(
      TECHNICAL({
        code: "broken_citation",
        severity: "block",
        message: `Citations ${cites.missing.map((n) => `[[${n}]]`).join(", ")} point to sources that are not in the saved source list (${have.length ? `saved: ${have.map((n) => `[[${n}]]`).join(", ")}` : "no sources saved"}). Add them under Sources & checks.`,
      }),
    );
  }
  if (cites.unused.length && input.sources.length) out.push({ code: "unused_source", severity: "info", message: `Source(s) ${cites.unused.join(", ")} are never cited in the text.`, origin: "rules" });
  if (!input.sources.length && input.claims.length && !cites.cited.length) {
    out.push({ code: "no_sources", severity: "block", message: "Article makes factual claims but lists no sources.", origin: "rules" });
  }

  const sections = splitSections(input.body).filter((s) => s.heading);
  if (sections.length < 2 && input.body.length > 1500) {
    out.push({ code: "structure", severity: "info", message: "Long article with few headings — consider adding sections for mobile readers.", origin: "rules" });
  }
  return out;
}

export function hasBlockingWarnings(warnings: EditorialWarning[]): boolean {
  return warnings.some((w) => w.severity === "block");
}

export const isTechnical = (w: EditorialWarning) => w.category === "technical";
