import "server-only";
import type { Article, ContentResult, Destination } from "./types";
import { firestoreConfigured, queryPublic } from "./firestore-rest";
import { defaultDestinations, sampleArticles } from "@/content/samples";
import { siteConfig } from "@/config/site";
import { insightToArticle, listFileInsights } from "./insights";
import { listPublishedCountries } from "./countries";

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const num = (v: unknown, d = 0) => (typeof v === "number" && Number.isFinite(v) ? v : d);
const isHttpUrl = (u: string) => /^https?:\/\//i.test(u) || u.startsWith("/");

function fallback<T>(samples: T[]): ContentResult<T> {
  return siteConfig.showSampleContent ? { items: samples, source: "sample" } : { items: [], source: "empty" };
}

/**
 * Country cards for the homepage, in this order of precedence per country:
 *   1. Countries published from SKOLAR Studio (content/countries/*.json)
 *   2. Firestore `siteDestinations` (Control Center / older admin)
 *   3. Built-in defaults (Italy, Mongolia)
 * A country deactivated in Studio is hidden even if 2 or 3 would show it.
 */
export async function getDestinations(): Promise<ContentResult<Destination>> {
  const studio = await listPublishedCountries().catch(() => []);
  const studioCodes = new Set(studio.map((c) => c.code.toUpperCase()));
  const fromStudio: Destination[] = studio
    .filter((c) => c.active && c.image?.url)
    .map((c) => ({
      id: `studio-${c.id}`,
      title: c.cardTitle,
      description: c.shortDescription,
      category: c.focus ?? undefined,
      countryName: c.name,
      countryCode: c.code,
      imageUrl: c.image!.url,
      imageAlt: c.image!.alt,
      url: c.platformUrl ?? `/countries/${c.slug}`,
      pageUrl: c.introContent.trim() ? `/countries/${c.slug}` : undefined,
      flag: c.flag ?? undefined,
      ctaLabel: c.ctaLabel ?? undefined,
      order: c.order,
      institutions: c.universities.map((u) => u.name),
    }));

  let remote: Destination[] = [];
  if (firestoreConfigured()) {
    try {
      const rows = await queryPublic({ collection: "siteDestinations", where: { field: "published", value: true } });
      remote = rows
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
        .filter((d) => d.title && d.url && isHttpUrl(d.url) && d.imageUrl);
    } catch (err) {
      console.warn("[content] destinations fallback:", err instanceof Error ? err.message : err);
    }
  }
  const notStudio = (d: Destination) => !d.countryCode || !studioCodes.has(d.countryCode.toUpperCase());
  const remoteKept = remote.filter((d) => notStudio(d) && !d.id.startsWith("studio-"));
  const defaults = remote.length ? [] : defaultDestinations.filter(notStudio);
  const items = [...fromStudio, ...remoteKept, ...defaults].sort((a, b) => a.order - b.order);
  const source = fromStudio.length || remoteKept.length ? "firestore" : "default";
  return { items, source };
}

function readingMinutes(r: Record<string, unknown>): number | undefined {
  if (typeof r.readingMinutes === "number") return r.readingMinutes;
  const body = str(r.content);
  return body ? Math.max(1, Math.round(body.split(/\s+/).length / 220)) : undefined;
}

/** Latest published articles, newest first (Firestore records + Studio-published Markdown files). */
export async function getArticles(limit = 6): Promise<ContentResult<Article>> {
  const fileItems = (await listFileInsights().catch(() => [])).map(insightToArticle).filter((a) => a.coverImageUrl);
  let remote: Article[] = [];
  if (firestoreConfigured()) {
    try {
      // Omit orderBy in Firestore query so no composite index is required;
      // articles are sorted in-memory by publishedAt below.
      const rows = await queryPublic({
        collection: "siteArticles",
        where: { field: "status", value: "published" },
        limit: Math.max(50, limit + fileItems.length),
      });
      remote = rows
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
    } catch (err) {
      console.warn("[content] articles fallback:", err instanceof Error ? err.message : err);
    }
  }
  // The same Studio article can exist as a file and as a Firestore record: keep one per URL.
  const byUrl = new Map<string, Article>();
  const seenTitles = new Set<string>();
  for (const a of [...fileItems, ...remote]) {
    const t = a.title.trim().toLowerCase();
    if (byUrl.has(a.url) || seenTitles.has(t)) continue;
    byUrl.set(a.url, a);
    seenTitles.add(t);
  }
  const items = [...byUrl.values()].sort((a, b) => b.publishedAt.localeCompare(a.publishedAt)).slice(0, limit);
  // A manually featured article leads; otherwise the newest does.
  const f = items.findIndex((a) => a.featured);
  if (f > 0) items.unshift(...items.splice(f, 1));
  return items.length ? { items, source: "firestore" } : fallback(sampleArticles.slice(0, limit));
}
