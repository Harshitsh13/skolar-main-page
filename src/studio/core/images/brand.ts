/**
 * SKOLAR visual identity for generated images, taken from the website's design
 * tokens (src/app/globals.css) and the earlier TrendScout/skolarci thumbnail
 * engine palettes. Every palette is contrast-checked at render time.
 */

export interface Palette {
  key: string;
  bg: [string, string]; // gradient start/end
  fg: string;
  muted: string;
  accent: string;
  panel: string;
  line: string;
  light: boolean;
}

export const PALETTES: Record<string, Palette> = {
  "navy-gold": { key: "navy-gold", bg: ["#1c1b2f", "#0e0d1a"], fg: "#f7f6f2", muted: "#b9b8c6", accent: "#cf9a42", panel: "#242338", line: "#3a394f", light: false },
  "midnight-champagne": { key: "midnight-champagne", bg: ["#171627", "#0b0a14"], fg: "#f7f6f2", muted: "#c3c2cc", accent: "#e2bf7f", panel: "#1f1e33", line: "#35344a", light: false },
  "slate-gold": { key: "slate-gold", bg: ["#343442", "#242338"], fg: "#f7f6f2", muted: "#d0cfd8", accent: "#e2bf7f", panel: "#3d3d4d", line: "#4f4f60", light: false },
  "paper-navy": { key: "paper-navy", bg: ["#f7f6f2", "#ecebe6"], fg: "#171627", muted: "#4a4a5a", accent: "#a26e17", panel: "#efeee9", line: "#d6d4cc", light: true },
  "stone-ink": { key: "stone-ink", bg: ["#ecebe6", "#e0dfd9"], fg: "#0e0d1a", muted: "#3f3f4e", accent: "#7d530f", panel: "#e4e3dd", line: "#cfcdc4", light: true },
  "gold-navy": { key: "gold-navy", bg: ["#e2bf7f", "#cf9a42"], fg: "#0e0d1a", muted: "#2b2a3d", accent: "#171627", panel: "#e8c98f", line: "#b98a3b", light: true },
};

export const PALETTE_KEYS = Object.keys(PALETTES);

function hexRgb(h: string): [number, number, number] {
  const x = h.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(x.slice(i, i + 2), 16)) as [number, number, number];
}

function luminance(h: string): number {
  const ch = (c: number) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const [r, g, b] = hexRgb(h);
  return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b);
}

export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** WCAG checks used by image QC (headline ≥ 7:1, secondary ≥ 4.5:1, accent ≥ 3:1). */
export function paletteProblems(p: Palette): string[] {
  const out: string[] = [];
  for (const bg of p.bg) {
    if (contrast(p.fg, bg) < 7) out.push(`${p.key}: headline contrast ${contrast(p.fg, bg).toFixed(1)} < 7`);
    if (contrast(p.muted, bg) < 4.5) out.push(`${p.key}: secondary contrast ${contrast(p.muted, bg).toFixed(1)} < 4.5`);
    if (contrast(p.accent, bg) < 3) out.push(`${p.key}: accent contrast ${contrast(p.accent, bg).toFixed(1)} < 3`);
  }
  return out;
}
