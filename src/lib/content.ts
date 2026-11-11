import "server-only";
import type { Article, ContentResult, Destination } from "./types";
import { firestoreConfigured, queryPublic } from "./firestore-rest";
import { defaultDestinations, sampleArticles } from "@/content/samples";
import { siteConfig } from "@/config/site";

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const num = (v: unknown, d = 0) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const isHttpUrl = (u: string) => /^https?:\/\//i.test(u) || u.startsWith("/");

function fallback<T>(samples: T[]): ContentResult<T> {
  return siteConfig.showSampleContent ? { items: samples, source: "sample" } : { items: [], source: "empty" };
}

const defaultDestinationsResult = (): ContentResult<Destination> => ({
  items: defaultDestinations,
  source: "default",
});

/** Published destination cards, ordered as set in the admin. */
export async function getDestinations(): Promise<ContentResult<Destination>> {
  if (!firestoreConfigured()) return defaultDestinationsResult();
  try {
    const rows = await queryPublic({ collection: "siteDestinations", where: { field: "published", value: true } });
    const items = rows
      .map<Destination>((r) => ({
        id: r.id,
        title: str(r.title),
        description: str(r.description),
        category: str(r.category) || undefined,
        countryName: str(r.countryName) || undefined,
        countryCode: str(r.countryCode) || undefined,
        imageUrl: str(r.imageUrl),
        imageAlt: str(r.imageAlt) || undefined,
        url: str(r.url),
        ctaLabel: str(r.ctaLabel) || undefined,
        order: num(r.order, 999),
        institutions: Array.isArray(r.institutions)
          ? r.institutions.filter((x): x is string => typeof x === "string" && x.trim() !== "")
          : undefined,
      }))
      .filter((d) => d.title && d.url && isHttpUrl(d.url) && d.imageUrl)
      .sort((a, b) => a.order - b.order);
    return items.length ? { items, source: "firestore" } : defaultDestinationsResult();
  } catch (err) {
    console.warn("[content] destinations fallback:", err instanceof Error ? err.message : err);
    return defaultDestinationsResult();
  }
}

function readingMinutes(r: Record<string, unknown>): number | undefined {
  if (typeof r.readingMinutes === "number") return r.readingMinutes;
  const body = str(r.content);
  return body ? Math.max(1, Math.round(body.split(/\s+/).length / 220)) : undefined;
}

/** Latest published articles, newest first. */
export async function getArticles(limit = 6): Promise<ContentResult<Article>> {
  if (!firestoreConfigured()) return fallback(sampleArticles.slice(0, limit));
  try {
    const rows = await queryPublic({
      collection: "siteArticles",
      where: { field: "status", value: "published" },
      orderBy: { field: "publishedAt", direction: "DESCENDING" },
      limit,
    });
    const items = rows
      .map<Article>((r) => ({
        id: r.id,
        title: str(r.title),
        excerpt: str(r.excerpt),
        category: str(r.category) || "Insights",
        coverImageUrl: str(r.coverImageUrl),
        coverImageAlt: str(r.coverImageAlt) || undefined,
        publishedAt: str(r.publishedAt),
        readingMinutes: readingMinutes(r),
        url: str(r.url),
        featured: r.featured === true,
      }))
      .filter((a) => a.title && a.url && a.coverImageUrl);
    // A manually featured article leads; otherwise the newest does.
    const f = items.findIndex((a) => a.featured);
    if (f > 0) items.unshift(...items.splice(f, 1));
    return items.length ? { items, source: "firestore" } : fallback(sampleArticles.slice(0, limit));
  } catch (err) {
    console.warn("[content] articles fallback:", err instanceof Error ? err.message : err);
    return fallback(sampleArticles.slice(0, limit));
  }
}
