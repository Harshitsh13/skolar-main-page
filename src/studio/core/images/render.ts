import fs from "node:fs";
import path from "node:path";
import { PALETTES, type Palette } from "./brand";
import { FONT, fitText, textWidth, type FontKey } from "./fonts";
import { assetPath } from "../env";

/**
 * SKOLAR image formats, rendered as SVG and rasterised with resvg.
 * Ported and extended from the skolarci/TrendScout thumbnail engine
 * (blog automation/skolarci/thumbs): same palettes, safe areas and QC
 * signals, plus new compositions. Layouts are parametric (any aspect ratio)
 * and seeded, so two articles never get the same picture with a new title.
 *
 * No format draws university logos, crests or official seals.
 */

export type FormatKey =
  | "editorial"
  | "versus"
  | "ledger"
  | "steps"
  | "arcade"
  | "bulletin"
  | "route"
  | "motion"
  | "pillars"
  | "photo"
  | "ai";

export interface ImageSpec {
  format: FormatKey;
  palette: string;
  seed: number;
  eyebrow: string;
  headline: string;
  labels: string[];
  pair?: [string, string];
  place?: string; // e.g. "Messina" or "Italy" (route/arcade)
  academicYear?: string;
  mirror: boolean;
  texture: "grain" | "grid" | "dots" | "lines" | "none";
  headlineStyle: "serif" | "serif-italic-accent" | "sans-caps";
  /** Background photograph (licensed site image or AI-generated base), already cropped to size. */
  photo?: { jpeg: Buffer; position: "left" | "right" | "full" };
}

export interface RenderOutput {
  svg: string;
  textBoxes: Array<[number, number, number, number]>;
  visualBox: [number, number, number, number] | null;
  words: number;
  truncated: boolean;
}

/* ───────────── seeded randomness ───────────── */

export function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

let logoCache: { dark: string; light: string; ratio: number } | null = null;
function logos() {
  if (logoCache) return logoCache;
  const read = (f: string) => `data:image/png;base64,${fs.readFileSync(assetPath("public", "brand", f)).toString("base64")}`;
  logoCache = { dark: read("skolar-logo-on-dark.png"), light: read("skolar-logo-on-light.png"), ratio: 475 / 404 };
  return logoCache;
}

/* ───────────── SVG canvas ───────────── */

class Canvas {
  parts: string[] = [];
  defs: string[] = [];
  textBoxes: Array<[number, number, number, number]> = [];
  visualBox: [number, number, number, number] | null = null;
  words = 0;
  truncated = false;
  constructor(
    readonly W: number,
    readonly H: number,
    readonly p: Palette,
    readonly r: () => number,
  ) {}
  add(s: string) {
    this.parts.push(s);
  }
  text(x: number, y: number, s: string, font: FontKey, size: number, fill: string, opts: { anchor?: "start" | "middle" | "end"; tracking?: number; opacity?: number; italic?: boolean } = {}) {
    const anchor = opts.anchor ?? "start";
    const tracking = opts.tracking ?? 0;
    const w = textWidth(s, font, size, tracking);
    const x0 = anchor === "middle" ? x - w / 2 : anchor === "end" ? x - w : x;
    this.add(
      `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-family="${FONT[font].family}" font-size="${size}" fill="${fill}"${tracking ? ` letter-spacing="${tracking}"` : ""} text-anchor="${anchor}"${opts.opacity !== undefined ? ` fill-opacity="${opts.opacity}"` : ""}${opts.italic ? ` font-style="italic"` : ""}>${esc(s)}</text>`,
    );
    this.textBoxes.push([x0, y - size * 0.8, x0 + w, y + size * 0.25]);
    this.words += s.split(/\s+/).filter(Boolean).length;
  }
}

function background(c: Canvas, glow: [number, number], texture: ImageSpec["texture"]) {
  const { W, H, p } = c;
  c.defs.push(`<linearGradient id="bg" x1="0" y1="0" x2="${c.r() > 0.5 ? 1 : 0.3}" y2="1"><stop offset="0" stop-color="${p.bg[0]}"/><stop offset="1" stop-color="${p.bg[1]}"/></linearGradient>`);
  c.defs.push(`<radialGradient id="glow" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="${p.accent}" stop-opacity="${p.light ? 0.16 : 0.24}"/><stop offset="1" stop-color="${p.accent}" stop-opacity="0"/></radialGradient>`);
  c.add(`<rect width="${W}" height="${H}" fill="url(#bg)"/>`);
  const gr = Math.max(W, H) * 0.55;
  c.add(`<circle cx="${glow[0]}" cy="${glow[1]}" r="${gr}" fill="url(#glow)"/>`);
  const tex = p.light ? "#171627" : "#f7f6f2";
  if (texture === "grid") {
    const step = Math.round(W / 22);
    let d = "";
    for (let x = step; x < W; x += step) d += `M${x} 0V${H}`;
    for (let y = step; y < H; y += step) d += `M0 ${y}H${W}`;
    c.add(`<path d="${d}" stroke="${tex}" stroke-opacity="0.045" stroke-width="1"/>`);
  } else if (texture === "dots") {
    const step = Math.round(W / 40);
    c.defs.push(`<pattern id="dots" width="${step}" height="${step}" patternUnits="userSpaceOnUse"><circle cx="${step / 2}" cy="${step / 2}" r="1.6" fill="${tex}" fill-opacity="0.08"/></pattern>`);
    c.add(`<rect width="${W}" height="${H}" fill="url(#dots)"/>`);
  } else if (texture === "lines") {
    let d = "";
    for (let i = -H; i < W; i += 46) d += `M${i} ${H}L${i + H} 0`;
    c.add(`<path d="${d}" stroke="${tex}" stroke-opacity="0.04" stroke-width="2"/>`);
  } else if (texture === "grain") {
    c.defs.push(`<filter id="grain"><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="2" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 ${p.light ? 0 : 1} 0 0 0 0 ${p.light ? 0 : 1} 0 0 0 0 ${p.light ? 0 : 1} 0 0 0 0.06 0"/></filter>`);
    c.add(`<rect width="${W}" height="${H}" filter="url(#grain)"/>`);
  }
}

function brandFooter(c: Canvas, x: number, yBottom: number, align: "start" | "end" = "start") {
  const { p, W } = c;
  const h = Math.round(c.H * 0.072);
  const l = logos();
  const lw = h * l.ratio;
  const label = "SKOLAR INSIGHTS";
  const size = Math.round(c.H * 0.023);
  const lx = align === "start" ? x : W - x - lw - 18 - textWidth(label, "sansBold", size, 5);
  c.add(`<image href="${p.light ? l.light : l.dark}" x="${lx}" y="${yBottom - h}" width="${lw}" height="${h}" preserveAspectRatio="xMidYMid meet"/>`);
  c.textBoxes.push([lx, yBottom - h, lx + lw, yBottom]);
  c.text(lx + lw + 18, yBottom - h / 2 + size * 0.35, label, "sansBold", size, p.fg, { tracking: 5 });
  c.add(`<rect x="0" y="${c.H - 8}" width="${W}" height="8" fill="${p.accent}" fill-opacity="0.9"/>`);
}

function eyebrow(c: Canvas, x: number, y: number, label: string, anchor: "start" | "middle" = "start") {
  const size = Math.round(c.H * 0.026);
  if (anchor === "start") {
    c.add(`<rect x="${x}" y="${y - size * 0.62}" width="${size * 0.55}" height="${size * 0.55}" fill="${c.p.accent}"/>`);
    c.text(x + size * 1.15, y, label, "sansBold", size, c.p.accent, { tracking: 4 });
  } else c.text(x, y, label, "sansBold", size, c.p.accent, { tracking: 4, anchor: "middle" });
}

/** Headline block; returns its bottom y. */
function headline(c: Canvas, spec: ImageSpec, x: number, yTop: number, maxW: number, opts: { maxLines?: number; hi?: number; lo?: number; anchor?: "start" | "middle" } = {}) {
  const { p } = c;
  const caps = spec.headlineStyle === "sans-caps";
  const key: FontKey = caps ? "sansBold" : "serifStrong";
  const text = caps ? spec.headline.toUpperCase() : spec.headline;
  const fit = fitText(text, key, maxW, opts.maxLines ?? 3, opts.hi ?? Math.round(c.H * 0.115), opts.lo ?? Math.round(c.H * 0.06));
  if (fit.truncated) c.truncated = true;
  const lh = fit.size * (caps ? 1.12 : 1.04);
  let y = yTop + fit.size * 0.85;
  fit.lines.forEach((ln, i) => {
    const accentLine = spec.headlineStyle === "serif-italic-accent" && i === fit.lines.length - 1 && fit.lines.length > 1;
    c.text(x, y, ln, accentLine ? "serif" : key, fit.size, accentLine ? p.accent : p.fg, { anchor: opts.anchor, italic: accentLine, tracking: caps ? 2 : 0 });
    y += lh;
  });
  return y - lh + fit.size * 0.3;
}

/* ═════════════════════════ Formats ═════════════════════════ */

type Box = [number, number, number, number];

function vLedger(c: Canvas, b: Box, labels: string[]) {
  const [x0, y0, x1, y1] = b;
  const { p, r } = c;
  c.add(`<rect x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}" rx="24" fill="${p.panel}" fill-opacity="0.92" stroke="${p.line}" stroke-width="2"/>`);
  const rows = (labels.length ? labels : ["Tuition", "Housing", "Food", "Transport"]).slice(0, 5);
  const top = y0 + (y1 - y0) * 0.16;
  c.add(`<rect x="${x0 + 40}" y="${top - 26}" width="${(x1 - x0) * 0.32}" height="12" rx="6" fill="${p.accent}"/>`);
  const step = (y1 - top - 40) / rows.length;
  const size = Math.round(Math.min(30, step * 0.32));
  rows.forEach((label, i) => {
    const y = top + 40 + i * step;
    const f = fitText(label, "sansBold", (x1 - x0) * 0.4, 1, size, 16);
    c.text(x0 + 40, y, f.lines[0], "sansBold", f.size, p.fg);
    const bx = x0 + (x1 - x0) * 0.5;
    const bw = (x1 - bx - 50) * (0.35 + 0.6 * r());
    c.add(`<rect x="${bx}" y="${y - size * 0.7}" width="${bw}" height="${size * 0.7}" rx="${size * 0.35}" fill="${i % 2 ? p.muted : p.accent}" fill-opacity="${i % 2 ? 0.45 : 0.85}"/>`);
    c.add(`<path d="M${x0 + 40} ${y + step * 0.32}H${x1 - 40}" stroke="${p.line}" stroke-width="1.5"/>`);
  });
  c.visualBox = b;
}

function vSteps(c: Canvas, b: Box, labels: string[], horizontal: boolean) {
  const [x0, y0, x1, y1] = b;
  const { p } = c;
  const steps = (labels.length ? labels : ["Research", "Prepare", "Apply", "Arrive"]).slice(0, 4);
  const n = steps.length;
  const rad = Math.min(46, c.H * 0.045);
  if (horizontal) {
    const gap = (x1 - x0 - 2 * rad) / Math.max(1, n - 1);
    const cy = (y0 + y1) / 2 - rad;
    c.add(`<path d="M${x0 + rad} ${cy}H${x1 - rad}" stroke="${p.accent}" stroke-width="3" stroke-dasharray="2 12" stroke-linecap="round"/>`);
    steps.forEach((s, i) => {
      const cx = x0 + rad + i * gap;
      const last = i === n - 1;
      c.add(`<circle cx="${cx}" cy="${cy}" r="${rad}" fill="${last ? p.accent : p.panel}" stroke="${p.accent}" stroke-width="3"/>`);
      c.text(cx, cy + rad * 0.36, String(i + 1), "serifStrong", Math.round(rad * 1.05), last ? p.bg[1] : p.fg, { anchor: "middle" });
      const f = fitText(s, "sansBold", gap * 0.9, 2, Math.round(c.H * 0.03), 15);
      f.lines.forEach((ln, k) => c.text(cx, cy + rad + 44 + k * f.size * 1.15, ln, "sansBold", f.size, p.fg, { anchor: "middle" }));
    });
  } else {
    const gap = (y1 - y0 - 2 * rad) / Math.max(1, n - 1);
    const cx = x0 + rad;
    c.add(`<path d="M${cx} ${y0 + rad}V${y1 - rad}" stroke="${p.line}" stroke-width="4"/>`);
    steps.forEach((s, i) => {
      const cy = y0 + rad + i * gap;
      const last = i === n - 1;
      c.add(`<circle cx="${cx}" cy="${cy}" r="${rad}" fill="${last ? p.accent : p.panel}" stroke="${p.accent}" stroke-width="3"/>`);
      c.text(cx, cy + rad * 0.36, String(i + 1), "serifStrong", Math.round(rad * 1.05), last ? p.bg[1] : p.fg, { anchor: "middle" });
      const f = fitText(s, "sansBold", x1 - cx - rad - 40, 1, Math.round(c.H * 0.034), 16);
      c.text(cx + rad + 32, cy + f.size * 0.35, f.lines[0], "sansBold", f.size, p.fg);
    });
  }
  c.visualBox = b;
}

/** Illustrated Italian portico / arcade (generic architecture, not a real building). */
function vArcade(c: Canvas, b: Box) {
  const [x0, y0, x1, y1] = b;
  const { p, r } = c;
  const n = 3 + Math.floor(r() * 3);
  const w = (x1 - x0) / n;
  const base = y1;
  const spring = y0 + (y1 - y0) * (0.35 + r() * 0.1);
  c.add(`<rect x="${x0 - 12}" y="${y0 + (y1 - y0) * 0.12}" width="${x1 - x0 + 24}" height="14" fill="${p.accent}" fill-opacity="0.85"/>`);
  for (let i = 0; i < n; i++) {
    const ax = x0 + i * w;
    const inner = w * 0.72;
    const ix = ax + (w - inner) / 2;
    const rad = inner / 2;
    c.add(`<path d="M${ax} ${y0 + (y1 - y0) * 0.16}H${ax + w}V${base}H${ix + inner}V${spring}A${rad} ${rad} 0 0 0 ${ix} ${spring}V${base}H${ax}Z" fill="${p.panel}" stroke="${p.line}" stroke-width="2"/>`);
    c.add(`<path d="M${ix + rad} ${spring - rad}V${spring - rad + 18}" stroke="${p.accent}" stroke-width="3"/>`);
    if (r() > 0.45) c.add(`<circle cx="${ix + rad}" cy="${spring + (base - spring) * 0.15}" r="${rad * 0.18}" fill="${p.accent}" fill-opacity="0.25"/>`);
  }
  c.add(`<rect x="${x0 - 20}" y="${base - 6}" width="${x1 - x0 + 40}" height="14" fill="${p.accent}" fill-opacity="0.7"/>`);
  c.visualBox = b;
}

function vPillars(c: Canvas, b: Box) {
  const [x0, y0, x1, y1] = b;
  const { p } = c;
  const n = 4;
  const colW = (x1 - x0) / (n * 1.6);
  const gap = (x1 - x0 - n * colW) / (n - 1);
  const top = y0 + 70;
  const base = y1 - 30;
  c.add(`<path d="M${x0 - 10} ${top - 40}L${(x0 + x1) / 2} ${y0 - 10}L${x1 + 10} ${top - 40}Z" fill="none" stroke="${p.accent}" stroke-width="4"/>`);
  c.add(`<rect x="${x0 - 10}" y="${top - 40}" width="${x1 - x0 + 20}" height="24" rx="4" fill="${p.accent}"/>`);
  for (let i = 0; i < n; i++) {
    const x = x0 + i * (colW + gap);
    c.add(`<rect x="${x}" y="${top}" width="${colW}" height="${base - top}" rx="4" fill="${p.panel}" stroke="${p.line}" stroke-width="2"/>`);
    for (let k = 1; k < 3; k++) c.add(`<path d="M${x + (colW * k) / 3} ${top + 16}V${base - 16}" stroke="${p.line}" stroke-width="2"/>`);
  }
  c.add(`<rect x="${x0 - 20}" y="${base}" width="${x1 - x0 + 40}" height="22" rx="4" fill="${p.accent}" fill-opacity="0.8"/>`);
  c.visualBox = b;
}

function vBulletin(c: Canvas, b: Box, spec: ImageSpec) {
  const [x0, y0, x1, y1] = b;
  const { p } = c;
  const cx = (x0 + x1) / 2;
  c.add(`<rect x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}" rx="26" fill="none" stroke="${p.accent}" stroke-width="4"/>`);
  c.add(`<rect x="${x0 + 18}" y="${y0 + 18}" width="${x1 - x0 - 36}" height="${y1 - y0 - 36}" rx="18" fill="${p.panel}" fill-opacity="0.6"/>`);
  c.text(cx, y0 + (y1 - y0) * 0.24, "ACADEMIC YEAR", "sansBold", Math.round(c.H * 0.028), p.accent, { anchor: "middle", tracking: 7 });
  const ay = spec.academicYear ?? "Official update";
  const f = fitText(ay, "serifStrong", x1 - x0 - 90, 1, Math.round(c.H * 0.11), 30);
  c.text(cx, (y0 + y1) / 2 + f.size * 0.3, f.lines[0], "serifStrong", f.size, p.fg, { anchor: "middle" });
  c.add(`<path d="M${x0 + 60} ${y1 - (y1 - y0) * 0.24}H${x1 - 60}" stroke="${p.line}" stroke-width="2"/>`);
  c.text(cx, y1 - (y1 - y0) * 0.12, "CHECK THE OFFICIAL NOTICE", "sansBold", Math.round(c.H * 0.02), p.muted, { anchor: "middle", tracking: 4 });
  c.visualBox = b;
}

/** Dotted route from India to the destination — the flight-path motif from the SKOLAR logo/website. */
function vRoute(c: Canvas, b: Box, spec: ImageSpec) {
  const [x0, y0, x1, y1] = b;
  const { p, r } = c;
  const from: [number, number] = [x0 + 30, y1 - 40];
  const to: [number, number] = [x1 - 40, y0 + 50 + r() * 40];
  const mx = (from[0] + to[0]) / 2 + (r() - 0.5) * 120;
  const my = y0 + (y1 - y0) * (0.1 + r() * 0.2);
  const d = `M${from[0]} ${from[1]} Q ${mx} ${my} ${to[0]} ${to[1]}`;
  c.add(`<path d="${d}" fill="none" stroke="${p.fg}" stroke-opacity="0.15" stroke-width="2"/>`);
  c.add(`<path d="${d}" fill="none" stroke="${p.accent}" stroke-width="5" stroke-linecap="round" stroke-dasharray="0.1 18"/>`);
  for (const [pt, label] of [
    [from, "India"],
    [to, spec.place || "Italy"],
  ] as Array<[[number, number], string]>) {
    c.add(`<circle cx="${pt[0]}" cy="${pt[1]}" r="20" fill="${p.accent}"/><circle cx="${pt[0]}" cy="${pt[1]}" r="38" fill="none" stroke="${p.accent}" stroke-opacity="0.45" stroke-width="3"/>`);
    const f = fitText(label, "sansBold", (x1 - x0) * 0.45, 1, Math.round(c.H * 0.032), 16);
    const anchor = pt[0] > (x0 + x1) / 2 ? "end" : "start";
    c.text(pt[0] + (anchor === "end" ? 20 : -10), pt[1] + 74, f.lines[0].toUpperCase(), "sansBold", f.size, p.fg, { tracking: 3, anchor });
  }
  // graticule
  for (let i = 1; i < 4; i++) c.add(`<path d="M${x0} ${y0 + ((y1 - y0) * i) / 4}H${x1}" stroke="${p.line}" stroke-width="1" stroke-dasharray="4 10"/>`);
  c.visualBox = b;
}

/** Motion-graphic look: concentric rings, speed streaks and an outlined kinetic word. */
function vMotion(c: Canvas, b: Box, word: string) {
  const [x0, y0, x1, y1] = b;
  const { p, r } = c;
  const cx = (x0 + x1) / 2 + (r() - 0.5) * 60;
  const cy = (y0 + y1) / 2;
  for (let i = 0; i < 6; i++) {
    const rad = 40 + i * ((Math.min(x1 - x0, y1 - y0) / 2 - 40) / 6) * 1.1;
    const dash = i % 2 ? `stroke-dasharray="${8 + i * 4} ${10 + i * 6}"` : "";
    c.add(`<circle cx="${cx}" cy="${cy}" r="${rad}" fill="none" stroke="${i === 2 ? p.accent : p.fg}" stroke-opacity="${i === 2 ? 0.9 : 0.12 + i * 0.02}" stroke-width="${i === 2 ? 5 : 2}" ${dash}/>`);
  }
  for (let i = 0; i < 7; i++) {
    const y = y0 + (y1 - y0) * r();
    const len = (x1 - x0) * (0.2 + r() * 0.5);
    const sx = x0 + r() * (x1 - x0 - len);
    c.add(`<path d="M${sx} ${y}H${sx + len}" stroke="${i % 3 === 0 ? p.accent : p.fg}" stroke-opacity="${i % 3 === 0 ? 0.7 : 0.18}" stroke-width="${2 + r() * 4}" stroke-linecap="round"/>`);
  }
  const size = Math.round(c.H * 0.2);
  const w = word.toUpperCase().slice(0, 10);
  for (let k = 0; k < 3; k++) {
    c.add(`<text x="${cx}" y="${cy + size * 0.35 + (k - 1) * size * 0.95}" font-family="${FONT.sansBold.family}" font-size="${size}" text-anchor="middle" fill="none" stroke="${p.fg}" stroke-opacity="${k === 1 ? 0.35 : 0.1}" stroke-width="2" letter-spacing="6">${esc(w)}</text>`);
  }
  c.add(`<circle cx="${cx}" cy="${cy}" r="14" fill="${p.accent}"/>`);
  c.visualBox = b;
}

function versus(c: Canvas, spec: ImageSpec) {
  const { W, H, p } = c;
  const cx = W / 2;
  const top0 = H * 0.13;
  eyebrow(c, cx, top0, spec.eyebrow, "middle");
  const f = fitText(spec.headline, "serifStrong", W * 0.82, 1, Math.round(H * 0.085), Math.round(H * 0.05));
  c.text(cx, top0 + H * 0.05 + f.size * 0.85, f.lines[0], "serifStrong", f.size, p.fg, { anchor: "middle" });
  const top = top0 + H * 0.05 + f.size * 1.4;
  const bottom = H - H * 0.17;
  const pw = W * 0.37;
  const diagonal = c.r() > 0.5;
  (spec.pair ?? ["Option A", "Option B"]).forEach((name, k) => {
    const px = k === 0 ? cx - W * 0.045 - pw : cx + W * 0.045;
    if (diagonal) {
      const sk = 40;
      const pts = k === 0 ? `${px},${top} ${px + pw + sk},${top} ${px + pw - sk},${bottom} ${px},${bottom}` : `${px + sk},${top} ${px + pw},${top} ${px + pw},${bottom} ${px - sk},${bottom}`;
      c.add(`<polygon points="${pts}" fill="${p.panel}" fill-opacity="0.94" stroke="${p.line}" stroke-width="2"/>`);
    } else c.add(`<rect x="${px}" y="${top}" width="${pw}" height="${bottom - top}" rx="24" fill="${p.panel}" fill-opacity="0.94" stroke="${p.line}" stroke-width="2"/>`);
    const nf = fitText(name, "serifStrong", pw - 90, 2, Math.round(H * 0.065), 28);
    const ny = (top + bottom) / 2 - ((nf.lines.length - 1) * nf.size * 0.55);
    nf.lines.forEach((ln, i) => c.text(px + pw / 2, ny + i * nf.size * 1.08 + nf.size * 0.3, ln, "serifStrong", nf.size, p.fg, { anchor: "middle" }));
  });
  const mid = (top + bottom) / 2;
  c.add(`<circle cx="${cx}" cy="${mid}" r="${H * 0.058}" fill="${p.bg[1]}" stroke="${p.accent}" stroke-width="4"/>`);
  c.text(cx, mid + H * 0.016, "vs", "serif", Math.round(H * 0.05), p.accent, { anchor: "middle" });
  c.visualBox = [cx - W * 0.045 - pw, top, cx + W * 0.045 + pw, bottom];
  brandFooter(c, W * 0.06, H - H * 0.04);
}

function editorial(c: Canvas, spec: ImageSpec) {
  const { W, H, p, r } = c;
  const m = W * 0.07;
  // big decorative glyph / rule system
  const glyph = (spec.place || spec.headline).replace(/[^A-Za-z]/g, "").charAt(0).toUpperCase() || "S";
  const gx = spec.mirror ? m * 0.6 : W - m * 0.6;
  c.add(`<text x="${gx}" y="${H * 0.86}" font-family="${FONT.serif.family}" font-size="${H * 0.95}" text-anchor="${spec.mirror ? "start" : "end"}" fill="none" stroke="${p.accent}" stroke-opacity="0.35" stroke-width="2">${esc(glyph)}</text>`);
  c.add(`<path d="M${m} ${H * 0.2}H${W - m}" stroke="${p.fg}" stroke-opacity="0.3" stroke-width="1.5"/>`);
  eyebrow(c, m, H * 0.16, spec.eyebrow);
  if (spec.academicYear) c.text(W - m, H * 0.16, spec.academicYear, "sansBold", Math.round(H * 0.024), p.muted, { anchor: "end", tracking: 3 });
  const bottom = headline(c, spec, m, H * 0.27, W * (0.66 + r() * 0.1), { maxLines: 3, hi: Math.round(H * 0.13) });
  c.add(`<rect x="${m}" y="${bottom + H * 0.03}" width="${W * 0.06}" height="5" fill="${p.accent}"/>`);
  if (spec.labels.length) {
    const lbl = spec.labels.slice(0, 3).join("  ·  ");
    const f = fitText(lbl, "sans", W * 0.7, 1, Math.round(H * 0.03), 16);
    c.text(m, bottom + H * 0.1, f.lines[0], "sans", f.size, p.muted);
  }
  c.visualBox = [m, H * 0.2, W - m, bottom];
  brandFooter(c, m, H - H * 0.05);
}

/** Split layouts: headline on one side, a visual on the other (mirrored by seed). */
function split(c: Canvas, spec: ImageSpec, visual: (b: Box) => void) {
  const { W, H } = c;
  const m = W * 0.06;
  const textW = W * 0.44;
  const vis: Box = spec.mirror ? [m, H * 0.17, W * 0.46, H * 0.83] : [W * 0.54, H * 0.17, W - m, H * 0.83];
  const tx = spec.mirror ? W * 0.52 : m;
  eyebrow(c, tx, H * 0.27, spec.eyebrow);
  const bottom = headline(c, spec, tx, H * 0.31, textW - m * 0.3, { maxLines: W / H < 1.5 ? 4 : 3, lo: Math.round(H * 0.052) });
  c.add(`<rect x="${tx}" y="${bottom + H * 0.035}" width="${W * 0.05}" height="5" fill="${c.p.accent}"/>`);
  visual(vis);
  brandFooter(c, tx, H - H * 0.05);
}

async function photoLayer(c: Canvas, spec: ImageSpec) {
  if (!spec.photo) return;
  const { W, H, p } = c;
  const img = `data:image/jpeg;base64,${spec.photo.jpeg.toString("base64")}`;
  if (spec.photo.position === "full") {
    c.add(`<image href="${img}" x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="xMidYMid slice"/>`);
    c.defs.push(`<linearGradient id="shade" x1="0" y1="0" x2="${spec.mirror ? -1 : 1}" y2="0.2"><stop offset="0" stop-color="${p.bg[1]}" stop-opacity="0.96"/><stop offset="0.55" stop-color="${p.bg[1]}" stop-opacity="0.75"/><stop offset="1" stop-color="${p.bg[1]}" stop-opacity="0.15"/></linearGradient>`);
    c.add(`<rect width="${W}" height="${H}" fill="url(#shade)"/>`);
  } else {
    const x = spec.photo.position === "right" ? W * 0.5 : 0;
    c.defs.push(`<clipPath id="ph"><rect x="${x}" y="0" width="${W * 0.5}" height="${H}"/></clipPath>`);
    c.add(`<image href="${img}" x="${x}" y="0" width="${W * 0.5}" height="${H}" preserveAspectRatio="xMidYMid slice" clip-path="url(#ph)"/>`);
    c.add(`<rect x="${x}" y="0" width="${W * 0.5}" height="${H}" fill="${p.bg[1]}" fill-opacity="0.18"/>`);
  }
}

export async function renderSvg(spec: ImageSpec, W: number, H: number): Promise<RenderOutput> {
  // photo/AI layouts need a dark palette so text sits on a navy shade
  const palette = PALETTES[spec.palette] ?? PALETTES["navy-gold"];
  const c = new Canvas(W, H, palette, rng(spec.seed));
  const glow: [number, number] = spec.mirror ? [W * 0.28, H * 0.5] : [W * 0.72, H * 0.5];
  background(c, glow, spec.photo ? "none" : spec.texture);
  await photoLayer(c, spec);

  switch (spec.format) {
    case "versus":
      versus(c, spec);
      break;
    case "editorial":
      editorial(c, spec);
      break;
    case "ledger":
      split(c, spec, (b) => vLedger(c, b, spec.labels));
      break;
    case "steps":
      split(c, spec, (b) => vSteps(c, b, spec.labels, W / H > 1.5 && c.r() > 0.5 ? false : c.r() > 0.6));
      break;
    case "arcade":
      split(c, spec, (b) => vArcade(c, b));
      break;
    case "pillars":
      split(c, spec, (b) => vPillars(c, b));
      break;
    case "bulletin":
      split(c, spec, (b) => vBulletin(c, b, spec));
      break;
    case "route":
      split(c, spec, (b) => vRoute(c, b, spec));
      break;
    case "motion":
      split(c, spec, (b) => vMotion(c, b, spec.place || spec.labels[0] || "Italy"));
      break;
    case "photo":
    case "ai": {
      const m = W * 0.06;
      const tx = spec.photo?.position === "left" ? W * 0.54 : m;
      const maxW = spec.photo?.position === "full" ? W * 0.58 : W * 0.4;
      eyebrow(c, tx, H * 0.3, spec.eyebrow);
      const bottom = headline(c, spec, tx, H * 0.34, maxW, { maxLines: 3 });
      c.add(`<rect x="${tx}" y="${bottom + H * 0.035}" width="${W * 0.05}" height="5" fill="${palette.accent}"/>`);
      c.visualBox = spec.photo?.position === "left" ? [0, 0, W * 0.5, H] : spec.photo?.position === "right" ? [W * 0.5, 0, W, H] : [0, 0, W, H];
      brandFooter(c, tx, H - H * 0.05);
      break;
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><defs>${c.defs.join("")}</defs>${c.parts.join("")}</svg>`;
  return { svg, textBoxes: c.textBoxes, visualBox: c.visualBox, words: c.words, truncated: c.truncated };
}
