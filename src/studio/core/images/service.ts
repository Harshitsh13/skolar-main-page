import fs from "node:fs";
import path from "node:path";
import { COL, getStore } from "../store";
import type { ArticleImage, CategoryKey, StudioArticle } from "../types";
import { STRATEGIES } from "../strategies";
import { splitSections } from "../markdown";
import { putBlob } from "../media";
import { assetPath } from "../env";
import { imageCredits } from "../../../content/credits";
import { PALETTES, PALETTE_KEYS, paletteProblems } from "./brand";
import { fontFiles } from "./fonts";
import { renderSvg, type FormatKey, type ImageSpec } from "./render";
import { aiProvider, ImageProviderError } from "./providers";
import { errorMessage, nowIso, sha256, truncate } from "../util";

/**
 * Article image generation:
 *   analyse article → choose visual concept/format → write prompt/brief →
 *   generate (renderer or AI base + branded overlay) → QC → retry with a
 *   different concept → upload both renditions to Vercel Blob.
 *
 * Image generation never touches the article's facts: the only text drawn
 * into an image is a short headline, a category label and up to four short
 * labels taken from the article's own section headings.
 */

export const COVER = { width: 1600, height: 1000 }; // 16:10 article cover
export const CARD = { width: 1200, height: 900 }; // 4:3 listing card

const FORMATS_BY_CATEGORY: Record<CategoryKey, FormatKey[]> = {
  comparison: ["versus", "editorial", "route"],
  university_guide: ["arcade", "editorial", "pillars", "motion"],
  programmes: ["steps", "editorial", "motion", "arcade"],
  scholarship: ["bulletin", "ledger", "motion", "editorial"],
  admissions: ["steps", "route", "motion", "editorial"],
  visa: ["route", "steps", "bulletin"],
  student_life: ["photo", "arcade", "motion", "editorial"],
  cost_of_living: ["ledger", "photo", "editorial"],
  city_guide: ["arcade", "route", "photo", "editorial"],
  trending: ["motion", "editorial", "route"],
  practical: ["steps", "photo", "editorial"],
  other: ["editorial", "pillars", "motion"],
};

export const FORMAT_LABELS: Record<FormatKey, string> = {
  editorial: "Editorial typography",
  versus: "Comparison split-screen",
  ledger: "Cost / data breakdown",
  steps: "Process steps",
  arcade: "Illustrated Italian architecture",
  bulletin: "Scholarship / notice announcement",
  route: "Map route (India → destination)",
  motion: "Motion-graphic composition",
  pillars: "Classical pillars",
  photo: "Editorial photography (licensed library)",
  ai: "AI-generated scene with SKOLAR overlay",
};

/** Licensed site photographs that are generic (no identifiable university). */
const GENERIC_PHOTOS = imageCredits.filter((c) => !/campus-courtyard|mongolia|students-campus/.test(c.image));

export interface ImageConcept {
  format: FormatKey;
  palette: string;
  spec: Omit<ImageSpec, "photo">;
  concept: string;
  prompt: string;
  photo?: { file: string; credit: string; license: string; sourceUrl: string; title: string };
}

export interface ImageAnalysis {
  title: string;
  category: CategoryKey;
  headline: string;
  labels: string[];
  pair?: [string, string];
  place?: string;
  academicYear?: string;
}

function hashInt(s: string): number {
  return parseInt(sha256(s).slice(0, 8), 16);
}

function shortHeadline(title: string, maxWords = 7): string {
  const t = title
    .split(/[:—–|(]/)[0]
    .replace(/\b(for (indian|international) students|explained( step by step)?|step by step|a complete guide|complete guide|everything you need to know)\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  const words = t.split(/\s+/);
  return words.slice(0, maxWords).join(" ") + (words.length > maxWords ? "…" : "");
}

export function analyseArticle(a: Pick<StudioArticle, "title" | "category" | "body" | "academicYear" | "tags">): ImageAnalysis {
  const headings = splitSections(a.body)
    .map((s) => s.heading)
    .filter((h): h is string => Boolean(h))
    .filter((h) => !/^(introduction|final thoughts|conclusion|faq|common questions|sources)$/i.test(h));
  const labels = headings.map((h) => shortHeadline(h.replace(/^\d+[.)]\s*/, ""), 3)).filter((h) => h.length <= 28).slice(0, 4);
  const vs = /^(.+?)\s+(?:vs\.?|versus)\s+(.+?)(?:[:?—–|(]|$)/i.exec(a.title);
  const pair = vs ? ([vs[1].trim(), vs[2].trim()] as [string, string]) : undefined;
  const places = ["Messina", "Palermo", "Catania", "Bologna", "Milan", "Rome", "Florence", "Pisa", "Siena", "Turin", "Padua", "Naples", "Venice", "Trento", "Genoa", "Sicily", "Tuscany", "Piedmont", "Emilia-Romagna", "Italy"];
  const place = places.find((p) => new RegExp(`\\b${p}\\b`, "i").test(a.title)) ?? (a.tags ?? []).find((t) => places.includes(t));
  return {
    title: a.title,
    category: a.category,
    headline: pair ? `${shortHeadline(pair[0], 4)} or ${shortHeadline(pair[1], 4)}?` : shortHeadline(a.title, 10),
    labels,
    pair,
    place,
    academicYear: a.academicYear,
  };
}

/** Picks a concept that differs from recent images (format+palette) and from this article's earlier versions. */
export function chooseConcept(an: ImageAnalysis, opts: { variant: number; recent: Array<{ format?: string; palette?: string }>; useAi: boolean; articleKey: string }): ImageConcept {
  let formats = [...FORMATS_BY_CATEGORY[an.category]];
  if (!an.pair) formats = formats.filter((f) => f !== "versus");
  if (an.pair && an.category !== "comparison") formats.unshift("versus");
  if (!an.academicYear) formats = formats.filter((f) => f !== "bulletin");
  if (opts.useAi) formats.unshift("ai");
  if (!formats.length) formats = ["editorial", "motion"];
  const seed = hashInt(`${opts.articleKey}|${opts.variant}`);
  const recentFormats = opts.recent.slice(-3).map((r) => r.format);
  const recentPalettes = opts.recent.slice(-3).map((r) => r.palette);
  const rotate = <T,>(arr: T[], n: number) => arr.map((_, i) => arr[(i + n) % arr.length]);
  const orderedFormats = rotate(formats, opts.variant % formats.length);
  const format = orderedFormats.find((f) => !recentFormats.includes(f)) ?? orderedFormats[0];
  const photoLike = format === "photo" || format === "ai";
  const palettes = rotate(PALETTE_KEYS.filter((k) => !photoLike || !PALETTES[k].light), seed % PALETTE_KEYS.length);
  const palette = palettes.find((p) => !recentPalettes.includes(p) && paletteProblems(PALETTES[p]).length === 0) ?? palettes[0];
  const textures: ImageSpec["texture"][] = ["grain", "grid", "dots", "lines", "none"];
  const styles: ImageSpec["headlineStyle"][] = ["serif", "serif-italic-accent", "sans-caps"];
  const strategy = STRATEGIES[an.category];
  const spec: Omit<ImageSpec, "photo"> = {
    format,
    palette,
    seed,
    eyebrow: (format === "versus" ? "COMPARISON" : strategy.short.toUpperCase()).slice(0, 26),
    headline: an.headline,
    labels: an.labels,
    pair: an.pair,
    place: an.place,
    academicYear: an.academicYear,
    mirror: (seed >> 3) % 2 === 1,
    texture: textures[(seed >> 5) % textures.length],
    headlineStyle: format === "versus" ? "serif" : styles[(seed >> 7) % styles.length],
  };
  const photo = format === "photo" ? GENERIC_PHOTOS[seed % GENERIC_PHOTOS.length] : undefined;
  const concept = `${FORMAT_LABELS[format]} · ${palette} palette · ${spec.texture} texture · ${spec.mirror ? "visual left" : "visual right"} · headline “${spec.headline}”`;
  const subject = an.pair
    ? `two Italian university settings side by side, contrasting atmospheres`
    : an.place
      ? `an evocative, generic street-level scene in ${an.place}, Italy, with students, warm evening light`
      : `international students in an Italian university setting, ${strategy.short.toLowerCase()} theme`;
  const prompt =
    format === "ai"
      ? `Cinematic editorial photograph: ${subject}. Muted navy and warm gold tones, soft directional light, shallow depth of field, room for a headline on the ${spec.mirror ? "right" : "left"} third. No text, no letters, no logos, no crests, no university insignia, no flags, no watermarks.`
      : `SKOLAR ${FORMAT_LABELS[format]} composition for “${an.title}”: ${spec.headline}; labels ${an.labels.join(", ") || "none"}; ${palette} palette; ${spec.texture} texture.`;
  return {
    format,
    palette,
    spec,
    concept,
    prompt,
    photo: photo ? { file: photo.image, credit: photo.author, license: photo.license, sourceUrl: photo.source, title: photo.title } : undefined,
  };
}

/* ───────────── QC ───────────── */

async function dHash(png: Buffer): Promise<string> {
  const sharp = (await import("sharp")).default;
  const px = await sharp(png).greyscale().resize(9, 8, { fit: "fill" }).raw().toBuffer();
  let bits = "";
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits += px[y * 9 + x] > px[y * 9 + x + 1] ? "1" : "0";
  return BigInt(`0b${bits}`).toString(16).padStart(16, "0");
}

export function hamming(a: string, b: string): number {
  let x = BigInt(`0x${a}`) ^ BigInt(`0x${b}`);
  let n = 0;
  while (x) {
    n += Number(x & 1n);
    x >>= 1n;
  }
  return n;
}

async function rasterise(svg: string, width: number): Promise<Buffer> {
  const { Resvg } = await import("@resvg/resvg-js");
  const r = new Resvg(svg, { fitTo: { mode: "width", value: width }, font: { fontFiles: fontFiles(), loadSystemFonts: false, defaultFontFamily: "SK Sans" } });
  return Buffer.from(r.render().asPng());
}

export interface RenderedImage {
  cover: Buffer; // webp
  card: Buffer; // webp
  hash: string;
  problems: string[];
}

async function cropPhoto(file: string, w: number, h: number, seed: number): Promise<Buffer> {
  const sharp = (await import("sharp")).default;
  const abs = assetPath("public", ...file.replace(/^\//, "").split("/"));
  const pos = ["attention", "entropy", "centre", "north", "south"][seed % 5] as "attention";
  return sharp(fs.readFileSync(abs)).resize(w, h, { fit: "cover", position: pos }).modulate({ saturation: 0.85 }).jpeg({ quality: 85 }).toBuffer();
}

export async function renderConcept(c: ImageConcept, base?: Buffer): Promise<RenderedImage> {
  const sharp = (await import("sharp")).default;
  const out: Partial<RenderedImage> = { problems: [] };
  for (const [key, size] of [
    ["cover", COVER],
    ["card", CARD],
  ] as const) {
    let photo: ImageSpec["photo"];
    if (c.format === "ai" && base) {
      photo = { jpeg: await sharp(base).resize(size.width, size.height, { fit: "cover", position: "attention" }).jpeg({ quality: 88 }).toBuffer(), position: "full" };
    } else if (c.photo) {
      const half = c.spec.mirror ? "left" : "right";
      const full = (c.spec.seed >> 9) % 2 === 0;
      photo = { jpeg: await cropPhoto(c.photo.file, full ? size.width : size.width / 2, size.height, c.spec.seed), position: full ? "full" : half };
    }
    const r = await renderSvg({ ...c.spec, photo }, size.width, size.height);
    const png = await rasterise(r.svg, size.width);
    // ── QC ──
    const problems = out.problems!;
    problems.push(...paletteProblems(PALETTES[c.palette]));
    const safe = [size.width * 0.03, size.height * 0.03, size.width * 0.97, size.height * 0.99];
    if (r.textBoxes.some(([x0, y0, x1, y1]) => x0 < safe[0] || y0 < safe[1] || x1 > safe[2] || y1 > safe[3])) problems.push(`${key}: text outside safe area`);
    if (r.words > 26) problems.push(`${key}: too much text (${r.words} words)`);
    if (!r.visualBox) problems.push(`${key}: no focal visual`);
    if (r.truncated) problems.push(`${key}: headline truncated`);
    const stats = await sharp(png).greyscale().stats();
    if (stats.channels[0].stdev < 10) problems.push(`${key}: image nearly empty`);
    const meta = await sharp(png).metadata();
    if (meta.width !== size.width || meta.height !== size.height) problems.push(`${key}: wrong size ${meta.width}x${meta.height}`);
    const webp = await sharp(png).webp({ quality: 86, effort: 5 }).toBuffer();
    if (key === "cover") {
      out.cover = webp;
      out.hash = await dHash(png);
    } else out.card = webp;
  }
  return out as RenderedImage;
}

/* ───────────── Generation (with retries over concepts) ───────────── */

export interface GeneratedImage {
  concept: ImageConcept;
  rendered: RenderedImage;
  attempts: number;
  provider: string;
  model?: string;
}

async function recentImages(limit = 12): Promise<Array<{ format?: string; palette?: string; hash?: string }>> {
  return getStore().list<{ format?: string; palette?: string; hash?: string; createdAt: string } & Record<string, unknown>>(COL.imageLog, { orderBy: { field: "createdAt", direction: "asc" } }).then((r) => r.slice(-limit));
}

export async function generateImage(
  a: Pick<StudioArticle, "id" | "title" | "category" | "body" | "academicYear" | "tags" | "images">,
  opts: { report?: (msg: string) => Promise<void> | void; allowAi?: boolean } = {},
): Promise<GeneratedImage> {
  const an = analyseArticle(a);
  const recent = await recentImages();
  const ai = opts.allowAi === false ? null : aiProvider();
  const previous = (a.images ?? []).filter((i) => i.source === "generated").length;
  let best: GeneratedImage | null = null;
  let aiError: string | null = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const concept = chooseConcept(an, { variant: previous + attempt, recent: [...recent, ...(a.images ?? [])], useAi: Boolean(ai) && !aiError, articleKey: a.id });
    await opts.report?.(`Concept ${attempt + 1}: ${concept.concept}`);
    let base: Buffer | undefined;
    if (concept.format === "ai" && ai) {
      try {
        await opts.report?.(`Generating base image with ${ai.label} (${ai.model()})`);
        base = await ai.generate(concept.prompt, COVER);
      } catch (err) {
        if (err instanceof ImageProviderError && !err.permanent && attempt < 2) throw err; // transient → job retry
        aiError = errorMessage(err);
        await opts.report?.(`AI image failed (${truncate(aiError, 120)}) — trying a rendered SKOLAR format instead`);
        continue;
      }
    }
    const rendered = await renderConcept(concept, base);
    // uniqueness against recent images
    const near = recent.find((r) => r.hash && hamming(r.hash, rendered.hash) <= 6);
    if (near) rendered.problems.push("too similar to a recent image");
    const result: GeneratedImage = { concept, rendered, attempts: attempt + 1, provider: concept.format === "ai" && ai ? ai.key : "skolar-render", model: concept.format === "ai" && ai ? ai.model() : "skolar-formats-v2" };
    if (!best || rendered.problems.length < best.rendered.problems.length) best = result;
    if (!rendered.problems.length) break;
    await opts.report?.(`QC rejected concept ${attempt + 1}: ${rendered.problems.join("; ")}`);
  }
  if (!best) throw new Error(`Image generation failed${aiError ? `: ${aiError}` : ""}`);
  if (best.rendered.problems.length) {
    throw new Error(`No concept passed image QC: ${best.rendered.problems.join("; ")}`);
  }
  return best;
}

/** Uploads both renditions and returns the gallery record. Idempotent via content-hash paths. */
export async function uploadGenerated(articleId: string, g: GeneratedImage, version: number, alt: string): Promise<ArticleImage> {
  const h = sha256(g.rendered.cover).slice(0, 12);
  const folder = `skolar/articles/${articleId.replace(/[^A-Za-z0-9_-]/g, "-")}`;
  const coverPath = `${folder}/cover-v${version}-${h}.webp`;
  const cardPath = `${folder}/card-v${version}-${h}.webp`;
  const cover = await putBlob(coverPath, g.rendered.cover, "image/webp");
  const card = await putBlob(cardPath, g.rendered.card, "image/webp");
  const img: ArticleImage = {
    id: `img_${h}`,
    version,
    url: cover.url,
    cardUrl: card.url,
    width: COVER.width,
    height: COVER.height,
    blobPaths: [cover.pathname, card.pathname],
    alt,
    source: "generated",
    provider: g.provider,
    model: g.model,
    format: g.concept.format,
    palette: g.concept.palette,
    concept: g.concept.concept,
    prompt: g.concept.prompt,
    spec: g.concept.spec as unknown as Record<string, unknown>,
    qc: { passed: g.rendered.problems.length === 0, problems: g.rendered.problems, attempts: g.attempts },
    hash: g.rendered.hash,
    credit: g.concept.photo ? `${g.concept.photo.credit} (${g.concept.photo.title})` : undefined,
    license: g.concept.photo?.license,
    sourceUrl: g.concept.photo?.sourceUrl,
    createdAt: nowIso(),
  };
  await getStore().set(COL.imageLog, img.id, { articleId, format: img.format, palette: img.palette, hash: img.hash, createdAt: img.createdAt });
  return img;
}

export function altFor(a: Pick<StudioArticle, "title">, c: ImageConcept): string {
  if (c.format === "versus" && c.spec.pair) return `SKOLAR graphic comparing ${c.spec.pair[0]} and ${c.spec.pair[1]}`;
  if (c.format === "photo" && c.photo) return `${c.photo.title} (illustrative photo) with the SKOLAR Insights headline “${c.spec.headline}”`;
  if (c.format === "ai") return `Illustrative AI-generated scene with the SKOLAR Insights headline “${c.spec.headline}”`;
  return `SKOLAR Insights graphic: ${a.title}`;
}
