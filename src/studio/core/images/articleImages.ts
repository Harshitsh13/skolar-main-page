import { COL, getStore } from "../store";
import type { ArticleImage, StudioArticle } from "../types";
import { deleteBlob, referencedUrls, storeUpload } from "../media";
import { altFor, generateImage, uploadGenerated } from "./service";
import { logActivity } from "../ops";
import { nowIso } from "../util";

type Row = StudioArticle & Record<string, unknown>;

/**
 * Gallery operations on an article. Replacement is always
 * upload → reference → (optionally) delete old, never the other way round.
 */

async function save(id: string, fn: (a: Row) => Partial<StudioArticle>): Promise<StudioArticle> {
  const out = await getStore().transact<Row>(COL.articles, id, (a) => {
    if (!a) throw new Error("Article not found.");
    return { ...a, ...fn(a), version: a.version + 1, updatedAt: nowIso() } as Row;
  });
  return out!;
}

function asCover(img: ArticleImage, caption?: string): StudioArticle["coverImage"] {
  return { url: img.url, cardUrl: img.cardUrl, imageId: img.id, alt: img.alt, credit: img.credit, license: img.license, sourceUrl: img.sourceUrl, caption };
}

/** Generates a new, different image for the article and makes it the cover. */
export async function regenerateImage(articleId: string, opts: { allowAi?: boolean } = {}): Promise<StudioArticle> {
  const a = await getStore().get<Row>(COL.articles, articleId);
  if (!a) throw new Error("Article not found.");
  await save(articleId, () => ({ imageState: { status: "generating", at: nowIso() } }));
  try {
    const g = await generateImage(a, { allowAi: opts.allowAi });
    const img = await uploadGenerated(articleId, g, (a.images ?? []).length + 1, altFor(a, g.concept));
    const saved = await save(articleId, (cur) => ({ images: [...(cur.images ?? []), img], coverImage: asCover(img, cur.coverImage?.caption), imageState: { status: "ready", at: nowIso() } }));
    await logActivity("admin", "image.generated", `New ${img.format} image for “${a.title}”`, articleId);
    return saved;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await save(articleId, () => ({ imageState: { status: "failed", error: msg, at: nowIso() } }));
    throw err;
  }
}

/** Manual upload: stored in Blob under the article, added to the gallery and used as cover. */
export async function uploadArticleImage(articleId: string, file: { bytes: Buffer; name: string }, meta: { alt: string; credit?: string; license?: string; sourceUrl?: string; makeCover: boolean }): Promise<StudioArticle> {
  const a = await getStore().get<Row>(COL.articles, articleId);
  if (!a) throw new Error("Article not found.");
  const rec = await storeUpload(file, { ...meta, articleId });
  const img: ArticleImage = {
    id: `img_${rec.id.slice(0, 12)}`,
    version: (a.images ?? []).length + 1,
    url: rec.url,
    width: rec.width,
    height: rec.height,
    blobPaths: [rec.path],
    alt: meta.alt,
    source: "upload",
    credit: meta.credit,
    license: meta.license,
    sourceUrl: meta.sourceUrl,
    createdAt: nowIso(),
  };
  return save(articleId, (cur) => ({
    images: [...(cur.images ?? []).filter((i) => i.id !== img.id), img],
    coverImage: meta.makeCover ? asCover(img, cur.coverImage?.caption) : cur.coverImage,
    imageState: { status: "ready", at: nowIso() },
  }));
}

/** Uses a credited website photo (library) as the cover. */
export async function useLibraryImage(articleId: string, lib: { url: string; title: string; credit: string; license: string; sourceUrl: string }, alt: string): Promise<StudioArticle> {
  const img: ArticleImage = { id: `img_lib_${lib.url.replace(/[^a-z0-9]+/gi, "-")}`, version: 0, url: lib.url, width: 0, height: 0, blobPaths: [], alt, source: "library", credit: `${lib.credit} (${lib.title})`, license: lib.license, sourceUrl: lib.sourceUrl, createdAt: nowIso() };
  return save(articleId, (cur) => ({ images: [...(cur.images ?? []).filter((i) => i.id !== img.id), img], coverImage: asCover(img, cur.coverImage?.caption) }));
}

export async function selectImage(articleId: string, imageId: string): Promise<StudioArticle> {
  return save(articleId, (cur) => {
    const img = (cur.images ?? []).find((i) => i.id === imageId);
    if (!img) throw new Error("Image not found in this article's gallery.");
    return { coverImage: asCover(img, cur.coverImage?.caption) };
  });
}

/**
 * Removes a gallery image. Refuses if it is the current cover or used in the
 * body; deletes its Blob files only after the article no longer references it.
 * Published articles keep every image the live page may still show.
 */
export async function deleteImage(articleId: string, imageId: string): Promise<StudioArticle> {
  const a = await getStore().get<Row>(COL.articles, articleId);
  if (!a) throw new Error("Article not found.");
  const img = (a.images ?? []).find((i) => i.id === imageId);
  if (!img) throw new Error("Image not found.");
  const refs = referencedUrls(a);
  if (refs.has(img.url) || (img.cardUrl && refs.has(img.cardUrl))) throw new Error("This image is in use (cover or article body). Choose another cover first.");
  if (a.status === "published" || a.status === "publishing") {
    if (a.coverImage?.imageId === img.id) throw new Error("This image is live on the published article.");
  }
  const saved = await save(articleId, (cur) => ({ images: (cur.images ?? []).filter((i) => i.id !== imageId) }));
  if (img.source !== "library") {
    // Only delete files stored under this article's own folder (uploads are de-duplicated by
    // content hash, so an identical upload could belong to another article's folder).
    const own = `/skolar/articles/${articleId.replace(/[^A-Za-z0-9_-]/g, "-")}/`;
    const urls = [img.url, img.cardUrl].filter((u): u is string => Boolean(u) && u!.includes(own));
    await deleteBlob(urls).catch(() => undefined);
  }
  await logActivity("admin", "image.deleted", `Removed an image from “${a.title}”`, articleId);
  return saved;
}
