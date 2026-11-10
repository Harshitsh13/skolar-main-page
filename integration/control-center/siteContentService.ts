/**
 * DROP-IN for the SKOLAR Control Center (backend/src/services/siteContentService.ts)
 *
 * Manages the public website content that the SKOLAR main website reads:
 *   • siteDestinations: SKOLAR Group destination cards
 *   • siteArticles: Insights articles (manual entries now, automation later)
 *
 * It follows the Control Center's existing patterns: firestoreUtils' synced
 * read/write helpers and the /api/blob upload proxy.
 */
import {
  cleanFirestoreData,
  fetchCollectionSynced,
  writeDocSynced,
  updateDocSynced,
  deleteDocSynced,
} from "../lib/firestoreUtils";

/* ───────────────────────────── Types (add to src/types/index.ts) ───────────────────────────── */

export interface SiteDestination {
  id: string;
  title: string; // "Explore Higher Education in Italy"
  description: string; // 1–2 sentences
  category?: string; // optional education focus, e.g. "Medicine"
  countryName?: string; // shown in the card lockup: "SKOLAR · Italy"
  countryCode?: string; // links to the `countries` record (IT, MN, …)
  imageUrl: string; // PUBLIC Vercel Blob URL
  imageAlt?: string;
  url: string; // external country website (https://…)
  ctaLabel?: string; // defaults to "Explore Platform"
  institutions?: string[]; // institutions SKOLAR has verified, used only to ground the AI finder
  order: number; // ascending display order
  published: boolean; // enabled / disabled
  createdAt: string;
  updatedAt: string;
}

export interface SiteArticle {
  id: string;
  title: string;
  excerpt: string;
  category: string;
  coverImageUrl: string; // PUBLIC Vercel Blob URL
  coverImageAlt?: string;
  publishedAt: string; // ISO date; the site sorts by this
  readingMinutes?: number; // optional; computed from `content` if absent
  url: string; // where the article is read
  content?: string; // optional body (future use / reading-time)
  featured?: boolean; // pins the article to the lead position
  status: "draft" | "published";
  createdAt: string;
  updatedAt: string;
}

const DEST = "siteDestinations";
const ART = "siteArticles";
const now = () => new Date().toISOString();
const newId = (prefix: string) => `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/* ───────────────────────────── Destinations ───────────────────────────── */

export async function getSiteDestinations(force = false): Promise<SiteDestination[]> {
  const list = await fetchCollectionSynced<SiteDestination>(DEST, { forceRemote: force });
  return list.sort((a, b) => (a.order ?? 999) - (b.order ?? 999));
}

export async function createSiteDestination(
  data: Omit<SiteDestination, "id" | "createdAt" | "updatedAt" | "order"> & { order?: number },
): Promise<SiteDestination> {
  const existing = await getSiteDestinations();
  const id = newId("dest");
  const doc: SiteDestination = {
    ...data,
    id,
    order: data.order ?? (existing.length ? Math.max(...existing.map((d) => d.order ?? 0)) + 1 : 1),
    createdAt: now(),
    updatedAt: now(),
  };
  return writeDocSynced(DEST, id, cleanFirestoreData(doc));
}

export async function updateSiteDestination(id: string, updates: Partial<SiteDestination>): Promise<void> {
  await updateDocSynced(DEST, id, cleanFirestoreData({ ...updates, updatedAt: now() }));
}

export async function setSiteDestinationPublished(id: string, published: boolean): Promise<void> {
  await updateSiteDestination(id, { published });
}

/** Persist a new order after drag-and-drop or up/down buttons. */
export async function reorderSiteDestinations(orderedIds: string[]): Promise<void> {
  await Promise.all(orderedIds.map((id, i) => updateSiteDestination(id, { order: i + 1 })));
}

export async function deleteSiteDestination(id: string): Promise<void> {
  await deleteDocSynced(DEST, id);
}

/* ───────────────────────────── Articles ───────────────────────────── */

export async function getSiteArticles(force = false): Promise<SiteArticle[]> {
  const list = await fetchCollectionSynced<SiteArticle>(ART, { forceRemote: force });
  return list.sort((a, b) => (b.publishedAt || "").localeCompare(a.publishedAt || ""));
}

export async function saveSiteArticle(
  data: Omit<SiteArticle, "id" | "createdAt" | "updatedAt"> & { id?: string },
): Promise<SiteArticle> {
  const id = data.id ?? newId("art");
  const doc = { ...data, id, updatedAt: now(), ...(data.id ? {} : { createdAt: now() }) } as SiteArticle;
  return writeDocSynced(ART, id, cleanFirestoreData(doc));
}

export async function deleteSiteArticle(id: string): Promise<void> {
  await deleteDocSynced(ART, id);
}

/* ───────────────────────────── Images (PUBLIC Vercel Blob) ───────────────────────────── */

const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/avif"];

/**
 * Uploads a website image through the Control Center's /api/blob proxy as a
 * PUBLIC blob under `site/…`. Requires the small api/blob.ts change described
 * in README.md (student documents stay private).
 */
export async function uploadSiteImage(file: File, folder: "destinations" | "articles"): Promise<string> {
  if (!IMAGE_TYPES.includes(file.type)) throw new Error("Please upload a JPG, PNG, WEBP or AVIF image.");
  if (file.size > 8 * 1024 * 1024) throw new Error("Images must be under 8 MB.");
  const safe = file.name.replace(/[^a-zA-Z0-9.-]/g, "_");
  const pathname = `site/${folder}/${Date.now()}_${safe}`;
  const res = await fetch(`/api/blob?access=public&pathname=${encodeURIComponent(pathname)}`, {
    method: "POST",
    headers: { "Content-Type": file.type },
    body: file,
  });
  if (!res.ok) throw new Error(`Image upload failed (${res.status})`);
  const data = await res.json();
  return data.url as string;
}
