/**
 * Timezone helpers built on Intl only (no dependencies, works on every OS).
 */

export interface ZonedParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  weekday: number; // 0 = Sunday
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function zonedParts(date: Date, timeZone: string): ZonedParts {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    weekday: "short",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "0";
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")) % 24,
    minute: Number(get("minute")),
    weekday: WEEKDAYS.indexOf(get("weekday")),
  };
}

/** Local calendar day key (YYYY-MM-DD) in the given zone. */
export function dayKey(date: Date, timeZone: string): string {
  const p = zonedParts(date, timeZone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}

/** Offset (ms) of `timeZone` from UTC at the given instant. */
function offsetMs(date: Date, timeZone: string): number {
  const p = zonedParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  return asUtc - Math.floor(date.getTime() / 60000) * 60000;
}

/** Converts a wall-clock time in `timeZone` to a UTC Date. */
export function zonedToUtc(
  y: number,
  m: number,
  d: number,
  hh: number,
  mm: number,
  timeZone: string,
): Date {
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  let ts = guess - offsetMs(new Date(guess), timeZone);
  // second pass handles DST transitions
  ts = guess - offsetMs(new Date(ts), timeZone);
  return new Date(ts);
}

/** Adds whole days to a Y-M-D triple (calendar arithmetic, zone-free). */
export function addDays(y: number, m: number, d: number, n: number): { y: number; m: number; d: number } {
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

export function weekdayOf(y: number, m: number, d: number): number {
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function parseHHMM(s: string): { h: number; m: number } | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(s.trim());
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h > 23 || m > 59) return null;
  return { h, m };
}

export function formatInZone(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

/**
 * Academic year label for a date, e.g. Italy (starts in September):
 * 12 Nov 2026 → "2026/2027"; 10 Mar 2027 → "2026/2027".
 */
export function academicYearFor(date: Date, startMonth = 9, format: "YYYY/YYYY" | "YYYY" = "YYYY/YYYY"): string {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + 1;
  const start = m >= startMonth ? y : y - 1;
  return format === "YYYY" ? String(start) : `${start}/${start + 1}`;
}

/**
 * The intake new applicants are preparing for: always the year after the one
 * in progress (e.g. in Nov 2026 the running year is 2026/2027 and applicants
 * prepare for 2027/2028).
 */
export function nextIntakeAcademicYear(date: Date, startMonth = 9): string {
  const start = Number(academicYearFor(date, startMonth).slice(0, 4)) + 1;
  return `${start}/${start + 1}`;
}
