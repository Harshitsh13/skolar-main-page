import { z } from "zod";
import { chatJson, NoProviderAvailableError, type CallContext } from "./ai";
import { joinSections, splitSections } from "./markdown";
import { citationNumbers } from "./sources";
import type { ArticleImprovement, StudioArticle } from "./types";
import { errorMessage, newId, normForMatch, nowIso } from "./util";

/**
 * "Improve with AI": proposes revised sections for the issues the editor picked.
 * The proposal is stored next to the article and NEVER replaces the text until
 * the editor applies it (all or selected sections). Hard guards:
 *   - a proposal that cites a source number not in the source list is rejected;
 *   - new numbers and added/removed citations are flagged for the editor;
 *   - nothing is ever marked verified.
 */

export interface ImproveIssue {
  code: string;
  message: string;
  excerpt?: string;
}

export class ImproveError extends Error {}

const schema = {
  type: "object",
  additionalProperties: false,
  required: ["markdown", "notes"],
  properties: { markdown: { type: "string" }, notes: { type: "array", items: { type: "string" } } },
};
const parse = (v: unknown) => z.object({ markdown: z.string(), notes: z.array(z.string()).default([]) }).parse(v);

const numbersOf = (s: string) =>
  new Set(
    (s.replace(/\[\[\d+]]/g, "").match(/\d+(?:[.,]\d+)*/g) ?? [])
      .map((n) => n.replace(/[.,](?=\d{3}\b)/g, ""))
      .filter((n) => n.length > 0),
  );

const SYSTEM = [
  "You are a careful copy editor for SKOLAR Insights (study-abroad guides for Indian students). The human editor makes the final decision; you only PROPOSE a revised version of ONE section.",
  "Hard rules:",
  "1) Do NOT add new facts, numbers, amounts, dates, names, organisations, sources, quotes, testimonials or rankings. Every number in your output must already appear in the section.",
  "2) Citations are written [[n]]. Keep each existing [[n]] attached to the statement it supports. Never invent a citation number and never add [[n]] to a statement that did not have one.",
  "3) If a statement lacks a source and you cannot support it from the section itself, do not invent one: either soften it into general guidance, label it clearly (estimate / illustrative example / personal example), or leave it and say in notes that it needs a source.",
  "4) Never promise admission, scholarships, visas or jobs. Keep legitimate warnings and disclaimers.",
  "5) Keep the Markdown structure (tables, lists, sub-headings). Do NOT include the section's own heading line. No HTML.",
  "6) British English, clear and friendly, short paragraphs for phone readers.",
  'Return JSON {"markdown": "<revised section>", "notes": ["<one short note per change>"]}.',
].join("\n");

function sectionMatches(text: string, excerpt: string): boolean {
  const e = normForMatch(excerpt).slice(0, 70).trim();
  return e.length >= 12 && normForMatch(text).includes(e);
}

/** Builds a proposal. Does not save anything. */
export async function proposeImprovement(
  a: StudioArticle,
  opts: { issues: ImproveIssue[]; instruction?: string; maxSections?: number },
  ctx: CallContext = {},
): Promise<ArticleImprovement> {
  const sections = splitSections(a.body);
  if (!sections.length) throw new ImproveError("The article has no text to improve.");
  const validNs = new Set(a.sources.map((s) => s.n));
  const max = opts.maxSections ?? 4;

  // Which sections the selected issues point at (by their quoted excerpt).
  const targeted = new Map<number, ImproveIssue[]>();
  const global: ImproveIssue[] = [];
  for (const issue of opts.issues) {
    const idx = issue.excerpt ? sections.findIndex((s) => sectionMatches(`${s.heading ?? ""}\n${s.body}`, issue.excerpt!)) : -1;
    if (idx >= 0) targeted.set(idx, [...(targeted.get(idx) ?? []), issue]);
    else global.push(issue);
  }
  let order = [...targeted.keys()].sort((x, y) => x - y);
  if (!order.length) order = sections.map((_, i) => i).filter((i) => sections[i].body.trim().length > 0);
  const todo = order.slice(0, max);
  const skipped = order.slice(max);

  const out: ArticleImprovement = {
    id: newId("imp"),
    createdAt: nowIso(),
    baseVersion: a.version,
    issues: opts.issues.slice(0, 40),
    sections: [],
    instruction: opts.instruction,
    providers: [],
  };
  const audit: NonNullable<CallContext["audit"]> = [];
  for (let k = 0; k < todo.length; k++) {
    const idx = todo[k];
    const sec = sections[idx];
    const issues = [...(targeted.get(idx) ?? []), ...global];
    let proposal: { markdown: string; notes: string[] };
    try {
      proposal = await chatJson(
        {
          system: SYSTEM,
          user: [
            `Article title: ${a.title}`,
            `Section heading: ${sec.heading ?? "(introduction, before the first heading)"}`,
            `Sources that exist (cite only these numbers): ${[...validNs].sort((x, y) => x - y).join(", ") || "none"}`,
            issues.length ? `Issues the editor wants fixed:\n${issues.map((i) => `- ${i.message}${i.excerpt ? ` — “${i.excerpt.slice(0, 200)}”` : ""}`).join("\n")}` : "Improve clarity and readability only.",
            opts.instruction ? `Editor's instruction: ${opts.instruction}` : "",
            `SECTION MARKDOWN:\n${sec.body}`,
          ]
            .filter(Boolean)
            .join("\n\n"),
          json: { name: "section_improvement", schema },
          maxTokens: 3000,
          temperature: 0.3,
          reasoning: "low",
        },
        parse,
        { ...ctx, stage: "improve", audit },
      );
    } catch (err) {
      if (err instanceof NoProviderAvailableError) {
        if (k === 0) throw err;
        out.incomplete = `${err.message} — ${todo.length - k + skipped.length} section(s) not processed. Run “Improve” again later for the rest.`;
        break;
      }
      out.sections.push({ index: idx, heading: sec.heading, original: sec.body, proposed: sec.body, changed: false, notes: [], newNumbers: [], addedCitations: [], removedCitations: [], rejected: `AI error: ${errorMessage(err).slice(0, 200)}` });
      continue;
    }
    const proposed = proposal.markdown
      .trim()
      .replace(/^#{1,2}\s+.*\n+/, (m) => (sec.heading && normForMatch(m).includes(normForMatch(sec.heading)) ? "" : m))
      .trim();
    const before = new Set(citationNumbers(sec.body));
    const after = citationNumbers(proposed);
    const invalid = after.filter((n) => !validNs.has(n));
    const origNums = numbersOf(sec.body);
    out.sections.push({
      index: idx,
      heading: sec.heading,
      original: sec.body,
      proposed,
      changed: proposed.trim() !== sec.body.trim(),
      notes: proposal.notes.slice(0, 12).map((n) => n.slice(0, 300)),
      newNumbers: [...numbersOf(proposed)].filter((n) => !origNums.has(n)),
      addedCitations: after.filter((n) => !before.has(n)),
      removedCitations: [...before].filter((n) => !after.includes(n)),
      rejected: invalid.length ? `Cites ${invalid.map((n) => `[[${n}]]`).join(", ")}, which is not in the source list — this suggestion cannot be applied.` : undefined,
    });
  }
  if (!out.incomplete && skipped.length) out.incomplete = `Only the first ${max} section(s) were revised in this run; ${skipped.length} more have issues — run “Improve” again after applying or discarding.`;
  out.providers = [...new Set(audit.map((c) => `${c.provider} · ${c.model}`))];
  return out;
}

/**
 * Applies the chosen sections of a proposal to the article body (pure).
 * Throws if the article changed since the proposal was made or a chosen section was rejected.
 */
export function applyImprovement(a: StudioArticle, proposalId: string, sectionIndexes?: number[]): { body: string; applied: number[] } {
  const p = a.improvement;
  if (!p || p.id !== proposalId) throw new ImproveError("This suggestion no longer exists. Generate a new one.");
  if (a.version !== p.baseVersion) throw new ImproveError("The article changed after this suggestion was made, so applying it could overwrite your edits. Discard it and generate a new one.");
  const chosen = p.sections.filter((s) => s.changed && (!sectionIndexes || sectionIndexes.includes(s.index)));
  const bad = chosen.find((s) => s.rejected);
  if (bad) throw new ImproveError(`Cannot apply “${bad.heading ?? "Introduction"}”: ${bad.rejected}`);
  if (!chosen.length) throw new ImproveError("Nothing to apply — choose at least one changed section.");
  const sections = splitSections(a.body);
  for (const s of chosen) {
    if (!sections[s.index] || sections[s.index].heading !== s.heading || sections[s.index].body.trim() !== s.original.trim()) {
      throw new ImproveError("The article's sections no longer match the suggestion. Discard it and generate a new one.");
    }
    sections[s.index] = { heading: s.heading, body: s.proposed };
  }
  return { body: joinSections(sections), applied: chosen.map((s) => s.index) };
}
