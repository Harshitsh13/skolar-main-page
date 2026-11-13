import fs from "node:fs";
import path from "node:path";
import opentype from "opentype.js";
import { assetPath } from "../env";

/**
 * Brand fonts for rendered images: static instances of the website's own
 * typefaces (Newsreader, Instrument Sans — SIL OFL, licences in assets/fonts),
 * so text renders identically on Windows, macOS and Vercel.
 */

export const FONT = {
  serif: { family: "SK Serif", file: "Newsreader-Display-Regular.ttf" },
  serifStrong: { family: "SK Serif Strong", file: "Newsreader-Display-SemiBold.ttf" },
  sans: { family: "SK Sans", file: "InstrumentSans-Medium.ttf" },
  sansBold: { family: "SK Sans Bold", file: "InstrumentSans-Bold.ttf" },
} as const;
export type FontKey = keyof typeof FONT;

function fontDir(): string {
  const dir = path.dirname(assetPath("assets", "fonts", FONT.serif.file));
  if (!fs.existsSync(path.join(/*turbopackIgnore: true*/ dir, FONT.serif.file))) throw new Error("Brand fonts not found in assets/fonts.");
  return dir;
}

export function fontFiles(): string[] {
  const dir = fontDir();
  return Object.values(FONT).map((f) => path.join(/*turbopackIgnore: true*/ dir, f.file));
}

const loaded = new Map<FontKey, opentype.Font>();
function font(key: FontKey): opentype.Font {
  let f = loaded.get(key);
  if (!f) {
    f = opentype.loadSync(path.join(/*turbopackIgnore: true*/ fontDir(), FONT[key].file));
    loaded.set(key, f);
  }
  return f;
}

/** Rendered width of a string in pixels (letter-spacing included). */
export function textWidth(text: string, key: FontKey, size: number, tracking = 0): number {
  return font(key).getAdvanceWidth(text, size) + tracking * Math.max(0, text.length - 1);
}

export function wrapText(text: string, key: FontKey, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const trial = cur ? `${cur} ${w}` : w;
    if (!cur || textWidth(trial, key, size) <= maxWidth) cur = trial;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

/** Largest size (stepping down) at which `text` fits within maxLines × maxWidth. */
export function fitText(text: string, key: FontKey, maxWidth: number, maxLines: number, hi: number, lo: number): { size: number; lines: string[]; truncated: boolean } {
  for (let size = hi; size >= lo; size -= 2) {
    const lines = wrapText(text, key, size, maxWidth);
    if (lines.length <= maxLines && lines.every((l) => textWidth(l, key, size) <= maxWidth)) return { size, lines, truncated: false };
  }
  let lines = wrapText(text, key, lo, maxWidth);
  let truncated = false;
  if (lines.length > maxLines) {
    lines = lines.slice(0, maxLines);
    lines[maxLines - 1] = `${lines[maxLines - 1].replace(/[.,;:]+$/, "")}…`;
    truncated = true;
  }
  return { size: lo, lines, truncated };
}
