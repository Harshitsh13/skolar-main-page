import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";
import type { Article } from "./types";
import { firestoreConfigured } from "./firestore-rest";

/**
 * Published SKOLAR Insights article bodies.
 *
 * Source of truth: Markdown files in content/insights (committed to the
 * repository by SKOLAR Studio and shipped by the normal deployment). Until a
 * new commit is deployed, the same file content is also read from the public
 * `siteArticles` record in Firestore, so an article is live immediately.
 */

export interface InsightSource {
  n: number;
  title: string;
  url: string;
  type: string;
  publisher?: string;
  accessedAt?: string;
  pageDate?: string;
  academicYear?: string;
}

export interface Insight {
  id: string;
  contentKey: string | null;
  slug: string;
  title: string;
  excerpt: string;
  category: string;
  categoryLabel: string;
  academicYear: string | null;
  seoTitle: string;
  metaDescription: string;
  tags: string[];
  publishedAt: string;
  updatedAt: string;
  lastVerified: string | null;
  readingMinutes: number;
  coverImage: { url: string; cardUrl?: string | null; alt: string; caption?: string | null; credit?: string | null; license?: string | null; sourceUrl?: string | null } | null;
  cta: { text: string; label: string } | null;
  sources: InsightSource[];
  relatedSlugs: string[];
  body: string;
}

const DIR = () => path.join(process.cwd(), "content", "insights");
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const s = (v: unknown, d = "") => (typeof v === "string" ? v : v instanceof Date ? v.toISOString() : d);

export function parseInsight(raw: string, fallbackSlug: string): Insight | null {
  try {
    const { data, content } = matter(raw);
    const slug = s(data.slug, fallbackSlug);
    if (!SLUG.test(slug) || !s(data.title)) return null;
    const cover = data.coverImage && typeof data.coverImage === "object" && s((data.coverImage as { url?: unknown }).url) ? (data.coverImage as Insight["coverImage"]) : null;
    return {
      id: s(data.id, slug),
      contentKey: s(data.contentKey) || null,
      slug,
      title: s(data.title),
      excerpt: s(data.excerpt),
      category: s(data.category, "other"),
      categoryLabel: s(data.categoryLabel, "Insights"),
      academicYear: s(data.academicYear) || null,
      seoTitle: s(data.seoTitle) || s(data.title),
      metaDescription: s(data.metaDescription) || s(data.excerpt),
      tags: Array.isArray(data.tags) ? data.tags.filter((t): t is string => typeof t === "string") : [],
      publishedAt: s(data.publishedAt),
      updatedAt: s(data.updatedAt) || s(data.publishedAt),
      lastVerified: s(data.lastVerified) || null,
      readingMinutes: typeof data.readingMinutes === "number" ? data.readingMinutes : Math.max(1, Math.round(content.split(/\s+/).length / 220)),
      coverImage: cover,
      cta: data.cta && typeof data.cta === "object" ? (data.cta as Insight["cta"]) : null,
      sources: Array.isArray(data.sources) ? (data.sources as InsightSource[]).filter((x) => x && typeof x.url === "string" && /^https?:\/\//.test(x.url)) : [],
      relatedSlugs: Array.isArray(data.relatedSlugs) ? data.relatedSlugs.filter((t): t is string => typeof t === "string") : [],
      body: content,
    };
  } catch {
    return null;
  }
}

export async function listFileInsights(): Promise<Insight[]> {
  let names: string[];
  try {
    names = await fs.readdir(DIR());
  } catch {
    return [];
  }
  const out: Insight[] = [];
  for (const n of names) {
    if (!n.endsWith(".md")) continue;
    const slug = n.slice(0, -3);
    if (!SLUG.test(slug)) continue;
    const raw = await fs.readFile(path.join(DIR(), n), "utf8").catch(() => null);
    const parsed = raw ? parseInsight(raw, slug) : null;
    if (parsed) out.push(parsed);
  }
  return out.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt));
}

async function firestoreInsight(slug: string): Promise<Insight | null> {
  if (!firestoreConfigured()) return null;
  const project = process.env.FIREBASE_PROJECT_ID;
  const key = process.env.FIREBASE_WEB_API_KEY;
  const str = (v: string) => ({ stringValue: v });
  try {
    const res = await fetch(`https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents:runQuery?key=${key}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        structuredQuery: {
          from: [{ collectionId: "siteArticles" }],
          where: {
            compositeFilter: {
              op: "AND",
              filters: [
                { fieldFilter: { field: { fieldPath: "status" }, op: "EQUAL", value: str("published") } },
                { fieldFilter: { field: { fieldPath: "slug" }, op: "EQUAL", value: str(slug) } },
              ],
            },
          },
          limit: 1,
        },
      }),
      next: { revalidate: 300, tags: ["siteArticles"] },
    });
    if (!res.ok) return null;
    const rows = (await res.json()) as Array<{ document?: { fields?: { content?: { stringValue?: string } } } }>;
    const content = rows[0]?.document?.fields?.content?.stringValue;
    return content ? parseInsight(content, slug) : null;
  } catch {
    return null;
  }
}

export async function getInsight(slug: string): Promise<Insight | null> {
  if (!SLUG.test(slug)) return null;
  const raw = await fs.readFile(path.join(DIR(), `${slug}.md`), "utf8").catch(() => null);
  if (raw) {
    const parsed = parseInsight(raw, slug);
    if (parsed) return parsed;
  }
  return firestoreInsight(slug);
}

export function insightToArticle(i: Insight): Article {
  return {
    id: `file-${i.slug}`,
    title: i.title,
    excerpt: i.excerpt,
    category: i.categoryLabel,
    coverImageUrl: i.coverImage?.cardUrl || i.coverImage?.url || "",
    coverImageAlt: i.coverImage?.alt,
    publishedAt: i.publishedAt,
    readingMinutes: i.readingMinutes,
    url: `/insights/${i.slug}`,
  };
}
