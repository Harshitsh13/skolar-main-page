import { studioEnv } from "./env";
import { errorMessage } from "./util";

/**
 * Search discovery adapters. Search results are leads, never proof: the
 * pipeline always opens the page and extracts facts from its actual text.
 * Supported: Serper (Google results + "People also ask"), Brave Search,
 * Google Programmable Search (Custom Search JSON API).
 * Google Trends is NOT integrated — there is no official public API.
 */

export interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

export interface SearchResponse {
  provider: string;
  results: SearchResult[];
  /** Related questions/searches, when the provider exposes them. */
  related: string[];
}

export class SearchNotConfiguredError extends Error {}

export function searchProviderName(): string | null {
  const s = studioEnv.search();
  return s ? { serper: "Serper (Google results)", brave: "Brave Search", google_cse: "Google Programmable Search" }[s.kind] : null;
}

export async function webSearch(query: string, opts?: { num?: number; country?: string }): Promise<SearchResponse> {
  const cfg = studioEnv.search();
  if (!cfg) throw new SearchNotConfiguredError("No search provider configured.");
  const num = opts?.num ?? 8;
  try {
    if (cfg.kind === "serper") {
      const res = await fetch("https://google.serper.dev/search", {
        method: "POST",
        headers: { "X-API-KEY": cfg.key, "Content-Type": "application/json" },
        body: JSON.stringify({ q: query, num, gl: opts?.country ?? "in", hl: "en" }),
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) throw new Error(`Serper HTTP ${res.status}`);
      const data = (await res.json()) as {
        organic?: Array<{ title: string; link: string; snippet?: string }>;
        peopleAlsoAsk?: Array<{ question: string }>;
        relatedSearches?: Array<{ query: string }>;
      };
      return {
        provider: "serper",
        results: (data.organic ?? []).map((r) => ({ title: r.title, url: r.link, snippet: r.snippet ?? "" })),
        related: [...(data.peopleAlsoAsk ?? []).map((p) => p.question), ...(data.relatedSearches ?? []).map((r) => r.query)],
      };
    }
    if (cfg.kind === "brave") {
      const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${num}`;
      const res = await fetch(url, {
        headers: { "X-Subscription-Token": cfg.key, Accept: "application/json" },
        signal: AbortSignal.timeout(20_000),
      });
      if (!res.ok) throw new Error(`Brave HTTP ${res.status}`);
      const data = (await res.json()) as {
        web?: { results?: Array<{ title: string; url: string; description?: string }> };
        query?: { related?: string[] };
        faq?: { results?: Array<{ question: string }> };
      };
      return {
        provider: "brave",
        results: (data.web?.results ?? []).map((r) => ({
          title: r.title,
          url: r.url,
          snippet: (r.description ?? "").replace(/<[^>]+>/g, ""),
        })),
        related: (data.faq?.results ?? []).map((f) => f.question),
      };
    }
    const url = `https://www.googleapis.com/customsearch/v1?key=${encodeURIComponent(cfg.key)}&cx=${encodeURIComponent(cfg.cx)}&q=${encodeURIComponent(query)}&num=${Math.min(10, num)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (!res.ok) throw new Error(`Google CSE HTTP ${res.status}`);
    const data = (await res.json()) as { items?: Array<{ title: string; link: string; snippet?: string }> };
    return {
      provider: "google_cse",
      results: (data.items ?? []).map((r) => ({ title: r.title, url: r.link, snippet: r.snippet ?? "" })),
      related: [],
    };
  } catch (err) {
    throw new Error(`Search failed: ${errorMessage(err)}`);
  }
}
