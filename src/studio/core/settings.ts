import { COL, getStore } from "./store";
import { DEFAULT_CTAS } from "./strategies";
import type { StudioSettings } from "./types";
import { isValidTimeZone, parseHHMM } from "./time";
import { nowIso } from "./util";

export const DEFAULT_SETTINGS: StudioSettings = {
  automation: {
    enabled: false,
    dailyTarget: 5,
    autoPickTopics: true,
    maxRetries: 5,
    maxJobsPerDay: 12,
    minSourcesForDraft: 2,
    minWords: 700,
  },
  publishing: {
    timezone: "Asia/Kolkata",
    times: ["18:00"],
    days: [1, 2, 3, 4, 5],
    maxPerDay: 1,
    minIntervalMinutes: 120,
    allowWeekends: false,
    autoQueue: true,
  },
  monitoring: { enabled: true, defaultFrequencyHours: 24 },
  demand: { suggestEnabled: false },
  ctas: DEFAULT_CTAS,
};

function merge(stored: Partial<StudioSettings> | null): StudioSettings {
  const s = stored ?? {};
  return {
    automation: { ...DEFAULT_SETTINGS.automation, ...(s.automation ?? {}) },
    publishing: { ...DEFAULT_SETTINGS.publishing, ...(s.publishing ?? {}) },
    monitoring: { ...DEFAULT_SETTINGS.monitoring, ...(s.monitoring ?? {}) },
    demand: { ...DEFAULT_SETTINGS.demand, ...(s.demand ?? {}) },
    ctas: s.ctas?.length ? s.ctas : DEFAULT_SETTINGS.ctas,
    updatedAt: s.updatedAt,
  };
}

export async function getSettings(): Promise<StudioSettings> {
  const doc = await getStore().get<Partial<StudioSettings> & Record<string, unknown>>(COL.settings, "main");
  return merge(doc);
}

export function validateSettings(s: StudioSettings): string | null {
  const p = s.publishing;
  if (!isValidTimeZone(p.timezone)) return `Unknown timezone "${p.timezone}".`;
  if (!p.times.length || p.times.some((t) => !parseHHMM(t))) return "Publishing times must look like 18:00.";
  if (!p.days.length) return "Choose at least one publishing day.";
  if (p.maxPerDay < 1 || p.maxPerDay > 10) return "Maximum posts per day must be between 1 and 10.";
  if (p.minIntervalMinutes < 0 || p.minIntervalMinutes > 24 * 60) return "Minimum interval must be 0–1440 minutes.";
  const a = s.automation;
  if (a.dailyTarget < 0 || a.dailyTarget > 20) return "Daily target must be between 0 and 20.";
  if (a.maxRetries < 0 || a.maxRetries > 10) return "Max retries must be 0–10.";
  if (a.maxJobsPerDay < a.dailyTarget) return "Max jobs per day must be at least the daily target.";
  return null;
}

export async function saveSettings(patch: Partial<StudioSettings>): Promise<StudioSettings> {
  const current = await getSettings();
  const next = merge({
    ...current,
    ...patch,
    automation: { ...current.automation, ...(patch.automation ?? {}) },
    publishing: { ...current.publishing, ...(patch.publishing ?? {}) },
    monitoring: { ...current.monitoring, ...(patch.monitoring ?? {}) },
    demand: { ...current.demand, ...(patch.demand ?? {}) },
  });
  // weekends flag and day list stay consistent
  if (!next.publishing.allowWeekends) next.publishing.days = next.publishing.days.filter((d) => d !== 0 && d !== 6);
  next.publishing.times = [...new Set(next.publishing.times)].sort();
  const err = validateSettings(next);
  if (err) throw new ValidationError(err);
  next.updatedAt = nowIso();
  await getStore().set(COL.settings, "main", next as unknown as Record<string, unknown>);
  return next;
}

export class ValidationError extends Error {}
