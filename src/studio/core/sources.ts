import type { ArticleSource, SourceType } from "./types";

/**
 * Article source list: validation, bulk import and citation resolution.
 * Client- and server-safe (the editor and the API use the same rules).
 *
 * Citations in the text are written [[n]] and resolve against the article's
 * saved `sources` by their number `n`. Every source also carries a stable `id`
 * so editing, reordering or renumbering never mixes two sources up.
 */

export const SOURCE_TYPES: SourceType[] = ["official_university", "government", "scholarship_authority", "application_portal", "publication", "other"];

export interface SourceProblem {
  /** Index in the list (0-based) or -1 for list-level problems. */
  index: number;
  n?: number;
  field: "n" | "title" | "url" | "list";
  message: string;
}

/** A URL a reader can open: http(s) with a real host. */
export function isValidSourceUrl(raw: string): boolean {
  const u = raw.trim();
  if (!/^https?:\/\//i.test(u)) return false;
  try {
    const url = new URL(u);
    return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(url.hostname) && !/\s/.test(u);
  } catch {
    return false;
  }
}

export function validateSources(sources: ArticleSource[]): SourceProblem[] {
  const out: SourceProblem[] = [];
  const seen = new Map<number, number>();
  sources.forEach((s, i) => {
    const label = `Source ${Number.isInteger(s.n) && s.n > 0 ? `[[${s.n}]]` : `in row ${i + 1}`}`;
    if (!Number.isInteger(s.n) || s.n < 1 || s.n > 99) out.push({ index: i, n: s.n, field: "n", message: `${label}: the citation number must be a whole number from 1 to 99.` });
    else if (seen.has(s.n)) out.push({ index: i, n: s.n, field: "n", message: `${label}: number ${s.n} is used twice (rows ${seen.get(s.n)! + 1} and ${i + 1}).` });
    else seen.set(s.n, i);
    if (!s.title?.trim()) out.push({ index: i, n: s.n, field: "title", message: `${label}: title is empty — enter the page or document title.` });
    if (!isValidSourceUrl(s.url ?? "")) out.push({ index: i, n: s.n, field: "url", message: `${label}: “${(s.url ?? "").slice(0, 80) || "(empty)"}” is not a valid http(s) URL.` });
  });
  return out;
}

/** Guesses the source type from its domain (editable afterwards). Never invents anything else. */
export function inferSourceType(url: string): SourceType {
  let host = "";
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return "other";
  }
  if (/universitaly\.it$|studyinitaly\.esteri\.it$|vistoperitalia\.esteri\.it$/.test(host)) return "application_portal";
  if (/(^|\.)(ersu|edisu|dsu|disco|er-go|ergo|adisu|esu|ardsu)[a-z.-]*\.it$|dsu\.toscana\.it$|diritto.?allo.?studio/.test(host)) return "scholarship_authority";
  if (/\.gov(\.[a-z]{2})?$|\.gov\.it$|esteri\.it$|europa\.eu$|ecb\.europa\.eu$|interno\.gov\.it$|mur\.gov\.it$|\.gouv\.|\.nic\.in$|\.gov\.in$/.test(host)) return "government";
  if (/(^|\.)uni[a-z]*\.it$|(^|\.)poli[a-z]*\.it$|\.edu$|\.ac\.[a-z]{2}$|sapienza|unibo|polimi|unimi|unipd|unito/.test(host)) return "official_university";
  return "publication";
}

const URL_RE = /https?:\/\/[^\s<>()\]]+[^\s<>()\].,;:!?'"]/i;

/**
 * Parses a pasted source list, one source per line. Accepted forms:
 *   [1] Title — https://…        1. Title. https://…        [[1]] Title https://…
 *   - [Title](https://…)         Title | https://…           Title (https://…)
 * Lines without a URL are reported, never guessed.
 */
export function parseSourceList(text: string, opts: { startAt?: number; today?: string } = {}): { sources: ArticleSource[]; problems: string[] } {
  const sources: ArticleSource[] = [];
  const problems: string[] = [];
  let next = opts.startAt ?? 1;
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !/^#{1,6}\s*(sources|references|bibliography)\b/i.test(l) && !/^(sources|references)\s*:?$/i.test(l));
  for (const raw of lines) {
    let line = raw.replace(/^[-*•]\s+/, "");
    let n: number | undefined;
    const num = /^(?:\[\[?\s*(\d{1,2})\s*\]?\]|\(?(\d{1,2})[.)]|(\d{1,2})\s*[-–—:])\s*/.exec(line);
    if (num) {
      n = Number(num[1] ?? num[2] ?? num[3]);
      line = line.slice(num[0].length);
    }
    let url = "";
    let title = "";
    const md = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/.exec(line);
    if (md) {
      title = md[1];
      url = md[2];
      const rest = line.replace(md[0], " ").replace(/\s+/g, " ").trim().replace(/^[-–—|:,.\s]+|[-–—|:,\s]+$/g, "");
      if (rest) title = `${title}${/[.:]$/.test(title) ? "" : "."} ${rest}`.trim();
    } else {
      const m = URL_RE.exec(line);
      if (m) {
        url = m[0];
        title = line.replace(m[0], " ").replace(/\(\s*\)|<\s*>/g, " ").replace(/\b(available at|retrieved from|url|link)\s*:?\s*$/i, "").replace(/\s+/g, " ").trim();
        title = title.replace(/^[-–—|:,\s]+|[-–—|:,(\s]+$/g, "").replace(/\.$/, "").trim();
      }
    }
    if (!url) {
      problems.push(`No URL found in: “${raw.slice(0, 120)}”`);
      continue;
    }
    if (!title) {
      problems.push(`No title found for ${url} — add the page title before the link.`);
      continue;
    }
    const num2 = n ?? next;
    next = Math.max(next, num2) + 1;
    sources.push({ n: num2, title: title.slice(0, 200), url, type: inferSourceType(url), accessedAt: today });
  }
  return { sources, problems };
}

/** Citation numbers written in the editor's format [[n]] (one number per marker: [[1]][[2]]). */
export function citationNumbers(body: string): number[] {
  return [...new Set([...body.matchAll(/\[\[(\d{1,3})]]/g)].map((m) => Number(m[1])))].sort((a, b) => a - b);
}

/** [[…]] markers that are not the exact [[n]] format, e.g. "[[ 1 ]]", "[[1, 2]]", "[[a]]" — they would show as raw text. */
export function malformedCitations(body: string): string[] {
  return [...new Set([...body.matchAll(/\[\[([^\]\n]{0,20})]]/g)].filter((m) => !/^\d{1,3}$/.test(m[1])).map((m) => m[0]))];
}

export interface CitationReport {
  cited: number[];
  /** Cited in the text but missing from the source list. */
  missing: number[];
  /** In the source list but never cited. */
  unused: number[];
}

export function resolveCitations(body: string, sources: Pick<ArticleSource, "n">[]): CitationReport {
  const cited = citationNumbers(body);
  const have = new Set(sources.map((s) => s.n));
  const used = new Set(cited);
  return { cited, missing: cited.filter((n) => !have.has(n)), unused: [...have].filter((n) => !used.has(n)).sort((a, b) => a - b) };
}

let counter = 0;
const randomId = () => {
  const c = globalThis.crypto as Crypto | undefined;
  if (c?.randomUUID) return c.randomUUID().replace(/-/g, "").slice(0, 12);
  return `${Date.now().toString(36)}${(counter++).toString(36)}${Math.random().toString(36).slice(2, 8)}`;
};
export const newSourceId = () => `src_${randomId()}`;

/**
 * What the save endpoint stores: normalised sources that keep the stable ids of
 * sources that already existed (matched by id, else by URL). Nothing is saved
 * when any source is invalid — the caller reports `problems` instead.
 */
export function prepareSourcesForSave(incoming: ArticleSource[], current: ArticleSource[]): { sources: ArticleSource[]; problems: SourceProblem[] } {
  const sources = normalizeSources(incoming).map((s) => ({ ...s, id: current.find((c) => c.id && c.id === s.id)?.id ?? current.find((c) => c.id && c.url === s.url)?.id ?? s.id }));
  return { sources, problems: validateSources(sources) };
}

/** Trims fields, assigns missing stable ids, sorts by citation number. Does not validate. */
export function normalizeSources(sources: ArticleSource[]): ArticleSource[] {
  return sources
    .map((s) => {
      const clean: ArticleSource = { ...s, id: s.id || newSourceId(), n: Number(s.n), title: (s.title ?? "").trim(), url: (s.url ?? "").trim(), type: SOURCE_TYPES.includes(s.type) ? s.type : "other" };
      for (const k of ["publisher", "accessedAt", "pageDate", "academicYear"] as const) {
        const v = clean[k]?.trim();
        if (v) clean[k] = v;
        else delete clean[k];
      }
      return clean;
    })
    .sort((a, b) => a.n - b.n);
}
