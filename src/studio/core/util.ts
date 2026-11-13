import { createHash, randomBytes } from "node:crypto";

export const nowIso = () => new Date().toISOString();

/** Time-sortable id: prefix_<13-digit ms><6 random hex>. */
export function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString().padStart(13, "0")}${randomBytes(3).toString("hex")}`;
}

export function sha256(input: string | Buffer): string {
  return createHash("sha256").update(input).digest("hex");
}

export function slugify(input: string, max = 80): string {
  const s = input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (s.length <= max) return s;
  return s.slice(0, max).replace(/-[^-]*$/, "") || s.slice(0, max);
}

export function wordCount(text: string): number {
  return text.replace(/[#>*_`|[\]()-]/g, " ").split(/\s+/).filter(Boolean).length;
}

export function readingMinutes(text: string): number {
  return Math.max(1, Math.round(wordCount(text) / 220));
}

export function truncate(s: string, n: number): string {
  return s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`;
}

/** Remove secrets from strings before they are logged or stored. */
export function redact(input: string): string {
  return input
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi, "$1[redacted]")
    .replace(/([?&](?:key|api_key|token|access_token)=)[^&\s"]+/gi, "$1[redacted]")
    .replace(/\b(gsk|sk|xai|ghp|github_pat|gho|AIza)[_-]?[A-Za-z0-9_-]{12,}/g, "[redacted]")
    .replace(/vercel_blob_rw_[A-Za-z0-9_]+/g, "[redacted]");
}

export function errorMessage(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  return redact(msg).slice(0, 600);
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export function uniq<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

/* ───────────── Similarity (duplicate detection) ───────────── */

const STOP = new Set(
  (
    "a an the and or of in on at to for with from by vs versus is are be how what which who why when where " +
    "your you guide complete students student indian italy italian study studying university universities " +
    "2024 2025 2026 2027 2028 academic year about into do does can best top tips"
  ).split(" "),
);

const SYNONYMS: Record<string, string> = {
  uni: "university",
  unime: "messina",
  unibo: "bologna",
  unipa: "palermo",
  programmes: "programme",
  programs: "programme",
  program: "programme",
  courses: "course",
  scholarships: "scholarship",
  fees: "fee",
  costs: "cost",
  bachelors: "bachelor",
  masters: "master",
  visas: "visa",
};

export function topicTokens(text: string): string[] {
  return slugify(text, 400)
    .split("-")
    .map((t) => SYNONYMS[t] ?? t.replace(/s$/, ""))
    .filter((t) => t.length > 1 && !STOP.has(t));
}

/** Jaccard similarity on content tokens, 0..1. */
export function similarity(a: string, b: string): number {
  const A = new Set(topicTokens(a));
  const B = new Set(topicTokens(b));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return inter / (A.size + B.size - inter);
}

/** Normalise text for quote matching. */
export function normForMatch(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[’‘`´]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}
