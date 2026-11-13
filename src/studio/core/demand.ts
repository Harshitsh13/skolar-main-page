import { searchProviderName, webSearch } from "./search";
import { getSettings } from "./settings";
import { errorMessage, nowIso } from "./util";

/**
 * Demand research signals. Every signal says exactly where it came from and
 * when it was collected; nothing here is presented as Google Trends data
 * unless it comes from the official Google Trends API (not yet available —
 * alpha by application only).
 */

export type SignalKind =
  | "google_trends" // official Google Trends API only
  | "search_result" // a page observed in web search results
  | "related_query" // "People also ask" / related searches from a search API
  | "search_suggestion" // autocomplete phrasing (no volumes)
  | "official_update" // change detected on an official source
  | "manual" // added by an administrator
  | "editorial"; // registry gap or editorial/AI idea

export interface DemandSignal {
  kind: SignalKind;
  source: string;
  detail: string;
  url?: string;
  collectedAt: string;
}

export const SIGNAL_LABEL: Record<SignalKind, string> = {
  google_trends: "Google Trends",
  search_result: "Search result observation",
  related_query: "Related search query",
  search_suggestion: "Search suggestion",
  official_update: "Official university update",
  manual: "Added manually",
  editorial: "Editorial idea",
};

export interface DemandCandidate {
  title: string;
  signal: DemandSignal;
}

/** Placeholder for the official API: honest "not available" until access is granted. */
export class GoogleTrendsNotAvailable extends Error {
  constructor() {
    super("Google Trends API access has not been granted (alpha, by application only).");
  }
}
export async function googleTrends(): Promise<never> {
  throw new GoogleTrendsNotAvailable();
}

/**
 * Google's public autocomplete endpoint. Unofficial: provides phrasing only,
 * no volumes, may be blocked. Only used when enabled in Settings.
 */
export async function googleSuggest(query: string): Promise<string[]> {
  const url = `https://suggestqueries.google.com/complete/search?client=firefox&hl=en&gl=in&q=${encodeURIComponent(query)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000), headers: { "User-Agent": "SKOLAR-Studio-Research/1.0" }, cache: "no-store" });
  if (!res.ok) throw new Error(`Suggestions HTTP ${res.status}`);
  const data = (await res.json()) as [string, string[]];
  return Array.isArray(data?.[1]) ? data[1].filter((s) => typeof s === "string") : [];
}

const SEEDS = ["study in italy for indian students", "italy scholarship for indian students", "english taught courses in italy", "italy student visa from india", "cost of living in italy for students"];
const MODIFIERS = ["", " requirements", " fees", " deadline", " without ielts"];

/** Collects demand candidates from every enabled, permitted source. */
export async function collectDemand(): Promise<{ candidates: DemandCandidate[]; notes: string[] }> {
  const settings = await getSettings();
  const notes: string[] = ["Google Trends: waiting for official API access — not used."];
  const out: DemandCandidate[] = [];

  const provider = searchProviderName();
  if (provider) {
    for (const seed of SEEDS.slice(0, 3)) {
      try {
        const r = await webSearch(seed, { num: 8 });
        const at = nowIso();
        for (const q of r.related) out.push({ title: q, signal: { kind: "related_query", source: provider, detail: `Related to “${seed}”`, collectedAt: at } });
        for (const hit of r.results.slice(0, 3)) {
          out.push({ title: hit.title, signal: { kind: "search_result", source: provider, detail: `Ranking for “${seed}”: ${hit.title}`, url: hit.url, collectedAt: at } });
        }
      } catch (err) {
        notes.push(`Search (${provider}): ${errorMessage(err)}`);
        break;
      }
    }
  } else notes.push("Web search: not configured — no search observations or related queries.");

  if (settings.demand.suggestEnabled) {
    try {
      for (const seed of SEEDS.slice(0, 3)) {
        for (const mod of MODIFIERS) {
          const at = nowIso();
          for (const s of (await googleSuggest(seed + mod)).slice(0, 4)) {
            out.push({ title: s, signal: { kind: "search_suggestion", source: "Google autocomplete (unofficial, phrasing only)", detail: `Suggested for “${seed + mod}”`, collectedAt: at } });
          }
        }
      }
    } catch (err) {
      notes.push(`Search suggestions: ${errorMessage(err)}`);
    }
  } else notes.push("Search suggestions: disabled in Settings.");
  return { candidates: out, notes };
}

/** Turns raw search phrasing into a readable article question (keeps meaning, no new facts). */
export function phraseAsTopic(q: string): string {
  const t = q.trim().replace(/\s+/g, " ");
  const cap = t.charAt(0).toUpperCase() + t.slice(1);
  return /^(how|what|can|is|are|do|does|which|when|where|why|should)\b/i.test(t) && !t.endsWith("?") ? `${cap}?` : cap;
}
