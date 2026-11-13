import type { ArticleFact } from "./types";
import { isFactualSentence } from "./safety";
import { normForMatch, similarity } from "./util";

/**
 * Citation helpers shared by the pipeline and the editor.
 * Nothing here invents a source: a citation is only added when an extracted
 * fact (with a verbatim quote from the official page) supports the sentence.
 */

const uniq = <T,>(a: T[]) => [...new Set(a)];

/** Converts research markers ([F4], [F4, F7], [F5, CONFLICTING]) into [[n]] source citations. */
export function convertFactMarkers(md: string, facts: ArticleFact[]): { md: string; unknown: number } {
  let unknown = 0;
  const byId = new Map(facts.map((f) => [f.id, f]));
  const out = md.replace(/\[(F\d+(?:[\s,;:–-]+(?:F\d+|[A-Z][A-Z_ ]{2,}))*)\]/g, (_m, group: string) => {
    const ns = uniq(
      (group.match(/F\d+/g) ?? [])
        .map((id) => {
          const f = byId.get(id);
          if (!f) unknown++;
          return f?.sourceN;
        })
        .filter((n): n is number => typeof n === "number"),
    );
    return ns.map((n) => `[[${n}]]`).join("");
  });
  return { md: out, unknown };
}

const numbersIn = (s: string) =>
  (s.replace(/\b20\d{2}\s?[/–-]\s?(?:20)?\d{2}\b/g, "").replace(/^\s*\d+\.\s/, "").match(/\d+(?:[.,]\d+)*/g) ?? []).map((n) => n.replace(/[.,](?=\d{3}\b)/g, ""));

export interface AutoCiteResult {
  body: string;
  repairedMarkers: number;
  added: Array<{ sentence: string; source: number; fact: string }>;
  unresolved: string[];
}

/** Adds [[n]] to uncited factual sentences when a fact clearly supports them. */
export function addCitationsFromEvidence(body: string, facts: ArticleFact[]): AutoCiteResult {
  const repaired = convertFactMarkers(body, facts);
  const repairedMarkers = (body.match(/\[F\d+[^\]]*\]/g) ?? []).length;
  const added: AutoCiteResult["added"] = [];
  const unresolved: string[] = [];
  const usable = facts.filter((f) => f.status !== "outdated");

  const lines = repaired.md.split("\n").map((line) => {
    if (/^\s*(\||#|>|```)/.test(line) || !line.trim()) return line; // tables, headings, callouts: leave to the editor
    // Protect abbreviations so "e.g." / "i.e." never end a sentence.
    const guarded = line.replace(/\b(e\.g|i\.e|etc|approx)\./gi, (m) => m.replace(/\./g, "\u0000"));
    return guarded.replace(/[^.!?]+[.!?]*\s*/g, (seg) => {
      if (/\[\[\d+]]/.test(seg) || !isFactualSentence(seg)) return seg;
      const nums = numbersIn(seg);
      let best: { f: ArticleFact; score: number } | null = null;
      for (const f of usable) {
        const evidence = normForMatch(`${f.statement} ${f.quote}`);
        if (nums.length && !nums.every((n) => evidence.includes(n))) continue;
        const score = similarity(seg, `${f.statement} ${f.quote}`);
        if (score >= (nums.length ? 0.15 : 0.3) && (!best || score > best.score)) best = { f, score };
      }
      if (!best) {
        unresolved.push(seg.trim().slice(0, 200));
        return seg;
      }
      added.push({ sentence: seg.trim().slice(0, 200), source: best.f.sourceN, fact: best.f.statement.slice(0, 160) });
      const m = /^([\s\S]*?)([.!?]*)(\s*)$/.exec(seg)!;
      return `${m[1].replace(/\s+$/, "")} [[${best.f.sourceN}]]${m[2]}${m[3]}`;
    });
  });
  const restore = (x: string) => x.replace(/\u0000/g, ".");
  return { body: restore(lines.join("\n")), repairedMarkers, added: added.map((x) => ({ ...x, sentence: restore(x.sentence) })), unresolved: unresolved.map(restore) };
}
