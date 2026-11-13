import { COL, getStore } from "./store";
import type { MediaRecord, StudioArticle } from "./types";
import { studioEnv } from "./env";
import { errorMessage, nowIso, sha256, sleep } from "./util";

/**
 * Studio media lives in Vercel Blob (public store), uploaded server-side with
 * BLOB_READ_WRITE_TOKEN — the token never reaches the browser.
 *
 * Paths are organised and versioned so the CDN never serves a stale file:
 *   skolar/articles/{articleId}/cover-v{n}-{hash}.webp
 *   skolar/articles/{articleId}/card-v{n}-{hash}.webp
 *   skolar/articles/{articleId}/upload-{hash}.webp
 *   skolar/countries/{slug}/image-{hash}.webp
 */

export const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/avif"]);
/**
 * Vercel Functions reject request bodies over 4.5 MB before our code runs, so the
 * editor shrinks larger images in the browser first; the server limit matches.
 */
export const MAX_UPLOAD_BYTES = 4.4 * 1024 * 1024;

/** Detects the real image format from its first bytes (browsers sometimes send an empty or wrong MIME type). */
export function sniffImageType(b: Buffer): string | null {
  if (b.length < 12) return null;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b[0] === 0x89 && b.toString("ascii", 1, 4) === "PNG") return "image/png";
  if (b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  if (b.toString("ascii", 4, 8) === "ftyp" && /^avi[fs]/.test(b.toString("ascii", 8, 12))) return "image/avif";
  return null;
}

/** Turns Vercel Blob SDK errors into messages an editor can act on. */
export function explainBlobError(msg: string): string {
  if (/private store|access must be "private"|private access/i.test(msg)) return "The Vercel Blob store is private, but article images must be public. Create a public Blob store (or change the store's access) and update BLOB_READ_WRITE_TOKEN.";
  if (/access denied|valid token|unauthori[sz]ed|forbidden|401|403/i.test(msg)) return "Vercel Blob rejected the token: BLOB_READ_WRITE_TOKEN is invalid, revoked or belongs to another store. Copy a fresh read-write token from the Blob store in Vercel.";
  if (/suspended/i.test(msg)) return "The Vercel Blob store is suspended (check the Vercel account / billing).";
  if (/store.*(not found|does not exist)/i.test(msg)) return "The Vercel Blob store for BLOB_READ_WRITE_TOKEN no longer exists.";
  if (/too.?large|size/i.test(msg)) return "Vercel Blob refused the file because it is too large.";
  if (/fetch failed|network|ECONN|ETIMEDOUT|ENOTFOUND|timeout/i.test(msg)) return "Could not reach Vercel Blob (network problem). Try again.";
  return msg;
}

const BLOB_URL = /^https:\/\/[a-z0-9-]+\.public\.blob\.vercel-storage\.com\//i;

export class MediaNotConfiguredError extends Error {}
export class MediaUploadError extends Error {}

export function blobConfigured(): boolean {
  return Boolean(studioEnv.blobToken());
}

function token(): string {
  const t = studioEnv.blobToken();
  if (!t) throw new MediaNotConfiguredError("Image storage is not configured: set BLOB_READ_WRITE_TOKEN (Vercel Blob, server-side only).");
  return t;
}

type BlobApi = typeof import("@vercel/blob");
let blobApi: BlobApi | null = null;
async function blob(): Promise<BlobApi> {
  return (blobApi ??= await import("@vercel/blob"));
}
/** Test hook. */
export function setBlobApiForTests(api: Partial<BlobApi> | null) {
  blobApi = api as BlobApi | null;
}

/**
 * Uploads (idempotently): versioned paths never overwrite, and an upload that
 * already exists (e.g. a retry after a crash) resolves to the existing blob.
 */
export async function putBlob(pathname: string, data: Buffer, contentType: string): Promise<{ url: string; pathname: string }> {
  const api = await blob();
  let lastErr: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const out = await api.put(pathname, data, {
        access: "public",
        token: token(),
        contentType,
        addRandomSuffix: false,
        allowOverwrite: false,
        cacheControlMaxAge: 60 * 60 * 24 * 365,
      });
      if (!BLOB_URL.test(out.url)) throw new MediaNotConfiguredError(`Vercel Blob returned an unexpected URL (${out.url.slice(0, 80)}); the store must be public.`);
      return { url: out.url, pathname: out.pathname };
    } catch (err) {
      lastErr = err;
      const msg = errorMessage(err);
      if (/already exists/i.test(msg)) {
        const existing = await api.head(pathname, { token: token() });
        return { url: existing.url, pathname: existing.pathname };
      }
      if (err instanceof MediaNotConfiguredError || /access|token|not.?found|does not exist|suspended|content.?type|too.?large/i.test(msg)) break;
      await sleep(600 * 2 ** attempt);
    }
  }
  throw new MediaUploadError(`Vercel Blob upload failed: ${explainBlobError(errorMessage(lastErr))}`);
}

async function blobStillExists(url: string): Promise<boolean> {
  try {
    await (await blob()).head(url, { token: token() });
    return true;
  } catch (err) {
    return !/not.?found|does not exist/i.test(errorMessage(err));
  }
}

export async function deleteBlob(urls: string[]): Promise<void> {
  const own = urls.filter((u) => /\.public\.blob\.vercel-storage\.com\//.test(u));
  if (!own.length) return;
  const api = await blob();
  await api.del(own, { token: token() });
}

/** Real connectivity check: upload a tiny object, read it back, delete it. */
export async function testBlob(): Promise<{ ok: boolean; message: string }> {
  if (!blobConfigured()) return { ok: false, message: "BLOB_READ_WRITE_TOKEN is not set." };
  try {
    const path = `skolar/healthcheck/${Date.now()}.txt`;
    const { url } = await putBlob(path, Buffer.from("ok"), "text/plain");
    const res = await fetch(url, { cache: "no-store" });
    const body = await res.text();
    await deleteBlob([url]);
    if (!res.ok || body !== "ok") return { ok: false, message: `Uploaded, but public read returned HTTP ${res.status}.` };
    return { ok: true, message: `Upload, public read and delete succeeded (${new URL(url).host}).` };
  } catch (err) {
    return { ok: false, message: errorMessage(err) };
  }
}

export async function optimiseImage(input: Buffer, maxWidth = 1600): Promise<{ data: Buffer; width: number; height: number }> {
  const sharp = (await import("sharp")).default;
  const out = await sharp(input, { failOn: "error" })
    .rotate()
    .resize({ width: maxWidth, height: maxWidth, fit: "inside", withoutEnlargement: true })
    .webp({ quality: 82, effort: 4 })
    .toBuffer({ resolveWithObject: true });
  return { data: out.data, width: out.info.width, height: out.info.height };
}

/** Editorial upload (cover replacement or body image), de-duplicated by content hash. */
export async function storeUpload(
  file: { bytes: Buffer; name: string },
  meta: { alt: string; credit?: string; license?: string; sourceUrl?: string; articleId?: string },
): Promise<MediaRecord> {
  let optimised: Awaited<ReturnType<typeof optimiseImage>>;
  try {
    optimised = await optimiseImage(file.bytes);
  } catch (err) {
    throw new MediaUploadError(`The image could not be read (corrupt or unsupported file): ${errorMessage(err)}`);
  }
  const { data, width, height } = optimised;
  const hash = sha256(data);
  const store = getStore();
  const existing = await store.get<MediaRecord & Record<string, unknown>>(COL.media, hash);
  // The same bytes were uploaded before — reuse that file unless it has since been deleted from Blob.
  if (existing && (await blobStillExists(existing.url))) return existing;
  const folder = meta.articleId ? `skolar/articles/${meta.articleId.replace(/[^A-Za-z0-9_-]/g, "-")}` : "skolar/media";
  const path = `${folder}/upload-${hash.slice(0, 16)}.webp`;
  const { url } = await putBlob(path, data, "image/webp");
  const rec: MediaRecord = { id: hash, url, path, storage: "blob", width, height, bytes: data.length, alt: meta.alt, credit: meta.credit, license: meta.license, sourceUrl: meta.sourceUrl, createdAt: nowIso() };
  await store.set(COL.media, hash, rec as unknown as Record<string, unknown>);
  return rec;
}

export async function listMedia(): Promise<MediaRecord[]> {
  return getStore().list<MediaRecord & Record<string, unknown>>(COL.media, { orderBy: { field: "createdAt", direction: "desc" }, limit: 60 });
}

/** Every Blob URL an article still references (cover, card, gallery, body). */
export function referencedUrls(a: Pick<StudioArticle, "coverImage" | "images" | "body">): Set<string> {
  const s = new Set<string>();
  if (a.coverImage?.url) s.add(a.coverImage.url);
  if (a.coverImage?.cardUrl) s.add(a.coverImage.cardUrl);
  for (const m of a.body.matchAll(/\]\((https:\/\/[^)\s]+)\)/g)) s.add(m[1]);
  return s;
}
