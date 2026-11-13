import { studioEnv } from "./env";
import { errorMessage } from "./util";

/**
 * Polite page fetcher for research and monitoring:
 * - identifies itself, honours robots.txt, never bypasses access controls
 * - HTML only (PDFs are recorded as documents to review manually)
 * - extracts readable text, title, dates and links
 */

export const USER_AGENT = "SKOLAR-Studio-Research/1.0 (editorial research; respects robots.txt)";
const ROBOTS_TOKEN = "skolar-studio-research";

export class FetchBlockedError extends Error {}

export interface FetchedPage {
  url: string;
  finalUrl: string;
  status: number;
  contentType: string;
  title: string;
  description: string;
  text: string;
  pageDate?: string;
  lastModified?: string;
  links: Array<{ text: string; url: string }>;
  isPdf: boolean;
  fetchedAt: string;
}

/* ───────────── robots.txt ───────────── */

const robotsCache = new Map<string, { at: number; rules: Array<{ allow: boolean; path: string }> | null }>();

function parseRobots(txt: string): Array<{ allow: boolean; path: string }> {
  // Groups that apply to us: our token, else "*".
  const lines = txt.split(/\r?\n/).map((l) => l.replace(/#.*$/, "").trim());
  const groups: Array<{ agents: string[]; rules: Array<{ allow: boolean; path: string }> }> = [];
  let cur: { agents: string[]; rules: Array<{ allow: boolean; path: string }> } | null = null;
  let lastWasAgent = false;
  for (const line of lines) {
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const field = m[1].toLowerCase();
    const value = m[2].trim();
    if (field === "user-agent") {
      if (!cur || !lastWasAgent) {
        cur = { agents: [], rules: [] };
        groups.push(cur);
      }
      cur.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else if ((field === "allow" || field === "disallow") && cur) {
      lastWasAgent = false;
      if (field === "disallow" && value === "") continue;
      cur.rules.push({ allow: field === "allow", path: value });
    } else {
      lastWasAgent = false;
    }
  }
  const mine = groups.filter((g) => g.agents.some((a) => a !== "*" && ROBOTS_TOKEN.includes(a)));
  const chosen = mine.length ? mine : groups.filter((g) => g.agents.includes("*"));
  return chosen.flatMap((g) => g.rules);
}

function pathMatches(rulePath: string, path: string): number {
  // Supports "*" wildcards and "$" anchor. Returns match length or -1.
  const anchored = rulePath.endsWith("$");
  const pattern = (anchored ? rulePath.slice(0, -1) : rulePath)
    .split("*")
    .map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  const re = new RegExp(`^${pattern}${anchored ? "$" : ""}`);
  return re.test(path) ? rulePath.length : -1;
}

export function robotsAllows(rules: Array<{ allow: boolean; path: string }> | null, path: string): boolean {
  if (!rules) return true;
  let best = -1;
  let allowed = true;
  for (const r of rules) {
    const len = pathMatches(r.path, path);
    if (len > best || (len === best && r.allow)) {
      if (len >= 0) {
        best = len;
        allowed = r.allow;
      }
    }
  }
  return allowed;
}

async function robotsFor(origin: string): Promise<Array<{ allow: boolean; path: string }> | null> {
  const cached = robotsCache.get(origin);
  if (cached && Date.now() - cached.at < 6 * 3600_000) return cached.rules;
  let rules: Array<{ allow: boolean; path: string }> | null = null;
  try {
    const res = await fetch(`${origin}/robots.txt`, {
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(10_000),
      redirect: "follow",
      cache: "no-store",
    });
    if (res.ok) rules = parseRobots(await res.text());
    else if (res.status === 401 || res.status === 403) rules = [{ allow: false, path: "/" }];
  } catch {
    rules = null; // unreachable robots.txt: treated as no restrictions, page fetch will surface network errors
  }
  robotsCache.set(origin, { at: Date.now(), rules });
  return rules;
}

/* ───────────── HTML → text ───────────── */

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", ndash: "–", mdash: "—", hellip: "…",
  rsquo: "’", lsquo: "‘", rdquo: "”", ldquo: "“", euro: "€", agrave: "à", egrave: "è", eacute: "é",
  igrave: "ì", ograve: "ò", ugrave: "ù", Agrave: "À", Egrave: "È", Eacute: "É", deg: "°", middot: "·",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (m, code: string) => {
    if (code[0] === "#") {
      const n = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[code] ?? m;
  });
}

function attr(tag: string, name: string): string | null {
  const m = new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
  return m ? decodeEntities(m[2] ?? m[3] ?? m[4] ?? "") : null;
}

export function htmlToPage(html: string, baseUrl: string) {
  const title = decodeEntities(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "").replace(/\s+/g, " ").trim();
  let description = "";
  let pageDate: string | undefined;
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const name = (attr(tag, "name") ?? attr(tag, "property") ?? "").toLowerCase();
    const content = attr(tag, "content") ?? "";
    if (!description && (name === "description" || name === "og:description")) description = content.trim();
    if (!pageDate && /(article:modified_time|article:published_time|last-modified|dcterms\.modified|date)$/.test(name)) {
      if (!Number.isNaN(Date.parse(content))) pageDate = new Date(content).toISOString();
    }
  }
  if (!pageDate) {
    const t = /<time[^>]*datetime=["']([^"']+)["']/i.exec(html)?.[1];
    if (t && !Number.isNaN(Date.parse(t))) pageDate = new Date(t).toISOString();
  }

  let body = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|svg|iframe|template|form)\b[\s\S]*?<\/\1>/gi, " ");
  const main = /<main\b[\s\S]*?<\/main>/i.exec(body)?.[0] ?? /<article\b[\s\S]*?<\/article>/i.exec(body)?.[0];
  const linksSource = body;
  if (main && main.length > 800) body = main;
  else body = body.replace(/<(nav|header|footer)\b[\s\S]*?<\/\1>/gi, " ");

  const links: Array<{ text: string; url: string }> = [];
  const seen = new Set<string>();
  for (const m of linksSource.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)) {
    const href = attr(m[1], "href");
    if (!href || href.startsWith("#") || /^(mailto|tel|javascript):/i.test(href)) continue;
    let abs: string;
    try {
      abs = new URL(href, baseUrl).toString().replace(/#.*$/, "");
    } catch {
      continue;
    }
    if (!/^https?:/i.test(abs) || seen.has(abs)) continue;
    seen.add(abs);
    const text = decodeEntities(m[2].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
    links.push({ text: text.slice(0, 200), url: abs });
    if (links.length >= 400) break;
  }

  const text = decodeEntities(
    body
      .replace(/<(br|hr)\b[^>]*>/gi, "\n")
      .replace(/<\/(p|div|section|article|li|tr|h[1-6]|table|ul|ol|dd|dt|blockquote)>/gi, "\n")
      .replace(/<(td|th)\b[^>]*>/gi, " | ")
      .replace(/<li\b[^>]*>/gi, "\n• ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[ \t\f\v ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { title, description, text, pageDate, links };
}

/* ───────────── fetch ───────────── */

export class NetworkError extends Error {}

export async function fetchPage(url: string, opts?: { timeoutMs?: number; maxBytes?: number }): Promise<FetchedPage> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    throw new Error(`Invalid URL: ${url}`);
  }
  if (!/^https?:$/.test(u.protocol)) throw new Error("Only http(s) URLs can be fetched.");
  if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.)/.test(u.hostname) || u.hostname.endsWith(".local")) {
    throw new Error("Private network addresses cannot be fetched.");
  }
  const rules = await robotsFor(u.origin);
  if (!robotsAllows(rules, u.pathname + u.search)) {
    throw new FetchBlockedError(`robots.txt of ${u.hostname} does not allow automated access to this page.`);
  }

  let res: Response;
  try {
    res = await fetch(u.toString(), {
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "text/html,application/xhtml+xml,application/pdf;q=0.8,*/*;q=0.5",
        "Accept-Language": "en,it;q=0.8",
      },
      redirect: "follow",
      signal: AbortSignal.timeout(opts?.timeoutMs ?? 25_000),
      cache: "no-store",
    });
  } catch (err) {
    const msg = errorMessage(err);
    throw new NetworkError(`Could not reach ${u.hostname}: ${msg}`);
  }
  const contentType = res.headers.get("content-type") ?? "";
  const base = {
    url,
    finalUrl: res.url || url,
    status: res.status,
    contentType,
    lastModified: res.headers.get("last-modified") ?? undefined,
    fetchedAt: new Date().toISOString(),
  };
  if (res.status === 401 || res.status === 403 || res.status === 451) {
    throw new FetchBlockedError(`${u.hostname} refused access (HTTP ${res.status}).`);
  }
  if (!res.ok) throw new Error(`${u.hostname} returned HTTP ${res.status}.`);

  if (/application\/pdf/i.test(contentType) || /\.pdf($|\?)/i.test(base.finalUrl)) {
    await res.body?.cancel().catch(() => undefined);
    return { ...base, title: decodeURIComponent(base.finalUrl.split("/").pop() ?? "PDF document"), description: "", text: "", links: [], isPdf: true };
  }
  if (!/html|xml|text\/plain/i.test(contentType)) {
    await res.body?.cancel().catch(() => undefined);
    throw new Error(`Unsupported content type: ${contentType || "unknown"}`);
  }
  const max = opts?.maxBytes ?? 3_000_000;
  const buf = Buffer.from(await res.arrayBuffer());
  const charset = /charset=([\w-]+)/i.exec(contentType)?.[1]?.toLowerCase();
  const html = new TextDecoder(charset === "iso-8859-1" || charset === "windows-1252" ? "windows-1252" : "utf-8").decode(
    buf.subarray(0, max),
  );
  const parsed = /text\/plain/i.test(contentType)
    ? { title: u.pathname, description: "", text: html, pageDate: undefined, links: [] }
    : htmlToPage(html, base.finalUrl);
  return { ...base, ...parsed, isPdf: false };
}

/** Quick connectivity probe used by the worker. */
export async function networkAvailable(): Promise<boolean> {
  const probes = ["https://www.gstatic.com/generate_204", "https://cloudflare.com/cdn-cgi/trace"];
  for (const p of probes) {
    try {
      const res = await fetch(p, { method: "GET", signal: AbortSignal.timeout(8000), cache: "no-store" });
      if (res.status < 500) return true;
    } catch {
      /* try next */
    }
  }
  return false;
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function siteLabel(): string {
  return studioEnv.siteUrl();
}

/* ───────────── robots.txt sitemaps + raw text (for official page discovery) ───────────── */

/** Sitemap URLs declared in robots.txt (falls back to /sitemap.xml). */
export async function sitemapsFor(origin: string): Promise<string[]> {
  try {
    const res = await fetch(`${origin}/robots.txt`, { headers: { "User-Agent": USER_AGENT }, signal: AbortSignal.timeout(10_000), cache: "no-store" });
    if (res.ok) {
      const list = [...(await res.text()).matchAll(/^\s*sitemap\s*:\s*(\S+)/gim)].map((m) => m[1]);
      if (list.length) return list.slice(0, 5);
    }
  } catch {
    /* fall through */
  }
  return [`${origin}/sitemap.xml`];
}

/** Fetches a text/XML resource, honouring robots.txt like fetchPage. */
export async function fetchText(url: string, maxBytes = 5_000_000): Promise<string> {
  const u = new URL(url);
  const rules = await robotsFor(u.origin);
  if (!robotsAllows(rules, u.pathname + u.search)) throw new FetchBlockedError(`robots.txt of ${u.hostname} disallows ${u.pathname}`);
  let res: Response;
  try {
    res = await fetch(url, { headers: { "User-Agent": USER_AGENT }, redirect: "follow", signal: AbortSignal.timeout(25_000), cache: "no-store" });
  } catch (err) {
    throw new NetworkError(`Could not reach ${u.hostname}: ${errorMessage(err)}`);
  }
  if (!res.ok) throw new Error(`${u.hostname} returned HTTP ${res.status} for ${u.pathname}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (/gzip/.test(res.headers.get("content-type") ?? "") || url.endsWith(".gz")) {
    const { gunzipSync } = await import("node:zlib");
    return gunzipSync(buf).subarray(0, maxBytes).toString("utf8");
  }
  return buf.subarray(0, maxBytes).toString("utf8");
}
