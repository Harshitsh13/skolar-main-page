import type { ArticleClaim, ArticleFact, ArticleSource, CategoryKey, EditorialWarning, VerificationStatus } from "./types";
import { citedNumbers, splitSections } from "./markdown";
import { normForMatch, similarity } from "./util";

/**
 * Deterministic editorial safety checks. These run on every AI and manual
 * article and are the backbone of the review layer; the AI review adds to
 * them but can never remove them.
 */

interface Rule {
  code: string;
  severity: EditorialWarning["severity"];
  pattern: RegExp;
  message: string;
  categories?: CategoryKey[];
}

const RULES: Rule[] = [
  {
    code: "guaranteed_admission",
    severity: "block",
    pattern: /\b(guarantee[sd]?|assured|100\s?%|certain(?:ly)? (?:get|secure))\b[^.]{0,60}\b(admission|admit|acceptance|seat|offer|place)/i,
    message: "Implies guaranteed admission. SKOLAR never promises admission.",
  },
  {
    code: "guaranteed_visa",
    severity: "block",
    pattern: /\b(guarantee[sd]?|assured|100\s?%|sure-?shot)\b[^.]{0,60}\bvisa/i,
    message: "Implies guaranteed visa approval.",
  },
  {
    code: "guaranteed_scholarship",
    severity: "block",
    pattern: /\b(guarantee[sd]?|assured|will (?:definitely|surely) (?:get|receive)|100\s?%)\b[^.]{0,60}\b(scholarship|grant|funding|borsa)/i,
    message: "Promises a scholarship outcome.",
  },
  {
    code: "employment_promise",
    severity: "block",
    pattern: /\b(guarantee[sd]?|assured|will (?:definitely|surely) (?:get|find))\b[^.]{0,60}\b(job|employment|placement|work permit|salary)/i,
    message: "Misleading employment claim.",
  },
  {
    code: "skolar_partnership",
    severity: "block",
    pattern: /\bSKOLAR\b[^.]{0,80}\b(partner(?:ed|ship)?|official representative|affiliated|tie-?up|authori[sz]ed agent)\b/i,
    message: "Mentions a SKOLAR partnership. Only allowed if formally verified — remove unless confirmed.",
  },
  {
    code: "ranking_claim",
    severity: "warn",
    pattern: /\b(ranked|ranking|#\s?\d+|number one|no\.\s?1|top[- ]\d+|best university)\b/i,
    message: "Ranking or 'best' claim. Rankings must cite the ranking publisher and year.",
  },
  {
    code: "testimonial",
    severity: "warn",
    pattern: /(\b(?:said|says|recalls|shared)\b[^.]{0,40}\b(student|graduate|alumn)|["“][^"”]{10,}["”]\s*[-—–]\s*[A-Z][a-z]+)/,
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

const NUMBERISH = /(€|\beur\b|\binr\b|₹|\$|\d+(?:[.,]\d+)?\s?%|\b\d{1,3}(?:[.,]\d{3})+\b|\b\d+(?:[.,]\d+)?\s?(?:euro|ects|cfu|credits|years?|months?|days?|hours?)\b|\b(?:19|20)\d{2}\b|\b\d{1,2}\s(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\b)/i;
const REQUIREMENT = /\b(must|required|mandatory|deadline|eligible|eligibility|minimum|maximum|at least|no later than|by \d)/i;

function sentences(text: string): string[] {
  // Drop Markdown table header rows (a table line followed by a |---| separator): labels, not claims.
  const lines = text.split(/\r?\n/);
  const kept = lines.filter((l, i) => !(/^\s*\|/.test(l) && /^\s*\|?\s*:?-{3,}/.test(lines[i + 1] ?? "")));
  return kept
    .join("\n")
    .replace(/\n+/g, "\n")
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"“(])|\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 20 && !/^#{1,6}\s/.test(s) && !/^\|?\s*:?-{3,}/.test(s));
}

/** Academic-year labels ("2027/2028") alone do not make a sentence a factual claim. */
const AY_LABEL = /\b20\d{2}\s?[/–-]\s?(?:20)?\d{2}\b/g;
/** Advice to the reader ("check the official page…", "deadlines can change…") is not a factual claim. */
const ADVISORY = /\b(check|confirm|verify|consult|we recommend|recommended|make sure|ensure you|can change|may change|could change|may be updated|subject to change|sources differ|could not be verified)\b/i;

export function isFactualSentence(s: string): boolean {
  const plain = s.replace(/\[\[\d+]]/g, "").replace(AY_LABEL, "");
  if (NUMBERISH.test(plain)) return true;
  return REQUIREMENT.test(plain) && !ADVISORY.test(plain);
}

function numberTokens(s: string): string[] {
  return [...s.matchAll(/\d+(?:[.,]\d+)*/g)].map((m) => m[0].replace(/[.,](?=\d{3}\b)/g, "").replace(",", ".")).filter((t) => t.length > 0);
}

/** Classifies factual sentences against the cited facts. */
export function verifyClaims(body: string, facts: ArticleFact[], sources: ArticleSource[]): ArticleClaim[] {
  const claims: ArticleClaim[] = [];
  const bySource = new Map<number, ArticleFact[]>();
  for (const f of facts) bySource.set(f.sourceN, [...(bySource.get(f.sourceN) ?? []), f]);
  const knownSources = new Set(sources.map((s) => s.n));
  let i = 0;
  for (const raw of sentences(body)) {
    if (/^>\s*\*\*/.test(raw)) continue; // callouts
    const s = raw.replace(/^[-*•]\s+/, "");
    const isFactual = isFactualSentence(s);
    const cites = citedNumbers(s);
    if (!isFactual && !cites.length) continue;
    const text = s.replace(/\s*\[\[\d+]]/g, "").trim();
    const ayMatch = /\b(20\d{2})\s?[/–-]\s?(?:20)?(\d{2})\b/.exec(text);
    let status: VerificationStatus;
    let note: string | undefined;
    const unknown = cites.filter((n) => !knownSources.has(n));
    if (!cites.length) {
      status = "unverified";
      note = "Factual statement without a citation.";
    } else if (unknown.length) {
      status = "needs_review";
      note = `Cites source ${unknown.join(", ")} which does not exist.`;
    } else {
      const supporting = cites.flatMap((n) => bySource.get(n) ?? []);
      const supportText = normForMatch(supporting.map((f) => `${f.statement} ${f.quote}`).join(" "));
      const nums = numberTokens(text).filter((n) => !/^(1|2|3|4|5)$/.test(n));
      const missing = nums.filter((n) => !supportText.includes(n));
      // Conflict/outdated status comes only from the facts this sentence is actually about,
      // not from every fact on the cited page.
      const relevant = supporting
        .map((f) => ({ f, s: similarity(text, `${f.statement} ${f.quote}`) }))
        .filter((x) => x.s >= 0.2)
        .sort((a, b) => b.s - a.s)
        .slice(0, 2)
        .map((x) => x.f);
      const flagged = relevant.find((f) => f.status === "conflicting" || f.status === "outdated");
      if (!supporting.length) {
        // Manually added sources have no extracted facts: needs a human check.
        status = "needs_review";
        note = "Source cited, but no extracted evidence to compare against.";
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
        // Verified = the cited evidence matches this sentence (by its numbers or its wording).
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
    });
  }
  return claims;
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

export function lintArticle(input: LintInput): EditorialWarning[] {
  const out: EditorialWarning[] = [];
  const all = `${input.title}\n${input.body}`;
  for (const rule of RULES) {
    if (rule.categories && !rule.categories.includes(input.category)) continue;
    for (const s of sentences(all)) {
      if (rule.pattern.test(s)) {
        out.push({ code: rule.code, severity: rule.severity, message: rule.message, excerpt: s.slice(0, 220), origin: "rules" });
        break;
      }
    }
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
      out.push({
        code: "older_academic_year",
        severity: "warn",
        message: `Mentions earlier academic year(s) ${[...years].join(", ")} while the article targets ${input.academicYear}. Make sure old information is labelled as such.`,
        origin: "rules",
      });
    }
  } else if (["scholarship", "admissions", "university_guide", "programmes"].includes(input.category)) {
    out.push({ code: "missing_academic_year", severity: "block", message: "Time-sensitive article without an academic year.", origin: "rules" });
  }

  // Dates in the past presented as deadlines.
  const now = input.now ?? new Date();
  for (const s of sentences(input.body)) {
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

  // Cost estimates must be labelled.
  if (input.category === "cost_of_living" || input.category === "student_life" || input.category === "city_guide") {
    const money = sentences(input.body).filter((s) => /€|\beur(o|os)?\b|₹|\binr\b/i.test(s));
    const unlabelled = money.filter(
      (s) => !/\[\[\d+]]/.test(s) && !/estimat|illustrative|approximately|around|roughly|assum|varies|may vary|typical/i.test(s),
    );
    if (unlabelled.length) {
      out.push({
        code: "unlabelled_estimate",
        severity: "block",
        message: "Money amount without a source and not labelled as an estimate.",
        excerpt: unlabelled[0].slice(0, 220),
        origin: "rules",
      });
    }
    if (input.category === "cost_of_living" && !/assum/i.test(input.body)) {
      out.push({ code: "missing_assumptions", severity: "warn", message: "Cost article should state its assumptions (city, period, lifestyle, inclusions/exclusions).", origin: "rules" });
    }
  }

  // Claims summary
  const unverified = input.claims.filter((c) => c.status === "unverified").length;
  const review = input.claims.filter((c) => c.status === "needs_review" || c.status === "conflicting").length;
  const outdated = input.claims.filter((c) => c.status === "outdated").length;
  if (unverified) {
    out.push({
      code: "unverified_claims",
      severity: unverified > 3 ? "block" : "warn",
      message: `${unverified} factual statement(s) have no citation. Add a source or remove them.`,
      origin: "rules",
    });
  }
  if (review) out.push({ code: "claims_need_review", severity: "warn", message: `${review} claim(s) need human review (conflicting or unsupported numbers).`, origin: "rules" });
  if (outdated) out.push({ code: "outdated_claims", severity: "warn", message: `${outdated} claim(s) rely on older academic-year information.`, origin: "rules" });

  // Internal research markers must never reach readers.
  const leftover = /\[F\d+[^\]]*\]/.exec(input.body);
  if (leftover) {
    out.push({ code: "research_marker", severity: "block", message: `Internal research marker left in the text: ${leftover[0]}. Use “Add citations from evidence” or replace it with [[n]].`, excerpt: leftover[0], origin: "rules" });
  }

  // Citation integrity
  const cited = citedNumbers(input.body);
  const ns = new Set(input.sources.map((s) => s.n));
  const missing = cited.filter((n) => !ns.has(n));
  if (missing.length) {
    out.push({ code: "broken_citation", severity: "block", message: `Citations [${missing.join(", ")}] point to sources that do not exist.`, origin: "rules" });
  }
  if (!input.sources.length && input.claims.length) {
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
