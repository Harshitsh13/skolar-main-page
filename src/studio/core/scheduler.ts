import type { StudioSettings } from "./types";
import { addDays, parseHHMM, weekdayOf, zonedParts, zonedToUtc } from "./time";

/**
 * Publication slot finder.
 *
 * Given the publishing settings and the times already taken, returns the next
 * free slot: the earliest configured time on an eligible day that
 *  - is in the future (with a small buffer),
 *  - keeps that day under `maxPerDay`,
 *  - is at least `minIntervalMinutes` away from every other scheduled item.
 */

export interface SlotOptions {
  now?: Date;
  /** Scheduled/published times (UTC ISO) to avoid. */
  taken: string[];
  /** Minimum minutes from now for a slot to count as available. */
  bufferMinutes?: number;
  horizonDays?: number;
}

export function nextSlot(pub: StudioSettings["publishing"], opts: SlotOptions): Date | null {
  const now = opts.now ?? new Date();
  const buffer = (opts.bufferMinutes ?? 5) * 60_000;
  const tz = pub.timezone;
  const taken = opts.taken.map((t) => Date.parse(t)).filter(Number.isFinite);
  const times = pub.times
    .map(parseHHMM)
    .filter((t): t is { h: number; m: number } => t !== null)
    .sort((a, b) => a.h * 60 + a.m - (b.h * 60 + b.m));
  if (!times.length) return null;
  const days = new Set(pub.days.filter((d) => pub.allowWeekends || (d !== 0 && d !== 6)));
  if (!days.size) return null;

  const today = zonedParts(now, tz);
  const minGap = pub.minIntervalMinutes * 60_000;
  for (let i = 0; i < (opts.horizonDays ?? 400); i++) {
    const { y, m, d } = addDays(today.year, today.month, today.day, i);
    if (!days.has(weekdayOf(y, m, d))) continue;
    const dayStart = zonedToUtc(y, m, d, 0, 0, tz).getTime();
    const next = addDays(y, m, d, 1);
    const dayEnd = zonedToUtc(next.y, next.m, next.d, 0, 0, tz).getTime();
    const onDay = taken.filter((t) => t >= dayStart && t < dayEnd).length;
    if (onDay >= pub.maxPerDay) continue;
    for (const t of times) {
      const slot = zonedToUtc(y, m, d, t.h, t.m, tz);
      const ts = slot.getTime();
      if (ts < now.getTime() + buffer) continue;
      if (taken.some((x) => Math.abs(x - ts) < Math.max(minGap, 60_000))) continue;
      return slot;
    }
  }
  return null;
}

/**
 * Re-packs unpinned future items into the earliest free slots, preserving
 * their order. Pinned items (manual overrides) never move. Returns the
 * proposed changes; nothing is applied here.
 */
export function compactQueue(
  pub: StudioSettings["publishing"],
  items: Array<{ id: string; at: string; pinned: boolean }>,
  now = new Date(),
): Array<{ id: string; from: string; to: string }> {
  const future = items.filter((i) => Date.parse(i.at) > now.getTime()).sort((a, b) => a.at.localeCompare(b.at));
  // Every current slot starts as taken; an item releases its own slot only while it is being re-placed.
  const taken = items.map((i) => i.at);
  const changes: Array<{ id: string; from: string; to: string }> = [];
  for (const item of future.filter((i) => !i.pinned)) {
    const idx = taken.indexOf(item.at);
    if (idx >= 0) taken.splice(idx, 1);
    const slot = nextSlot(pub, { now, taken });
    const to = slot?.toISOString();
    // Only move items earlier — never push a confirmed date later.
    if (to && Date.parse(to) < Date.parse(item.at)) {
      changes.push({ id: item.id, from: item.at, to });
      taken.push(to);
    } else taken.push(item.at);
  }
  return changes;
}
