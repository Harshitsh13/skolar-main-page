import { COL, getStore } from "./store";
import type { ActivityEntry, DailyStats, StudioNotification } from "./types";
import { getSettings } from "./settings";
import { dayKey } from "./time";
import { newId, nowIso, redact } from "./util";

/* ───────────── Activity log ───────────── */

export async function logActivity(
  actor: ActivityEntry["actor"],
  action: string,
  message: string,
  refId?: string,
): Promise<void> {
  const id = newId("act");
  const entry: ActivityEntry = { id, at: nowIso(), actor, action, message: redact(message).slice(0, 500), refId };
  try {
    await getStore().set(COL.activity, id, entry as unknown as Record<string, unknown>);
  } catch (err) {
    console.warn("[studio] activity log failed:", err instanceof Error ? err.message : err);
  }
}

export async function recentActivity(limit = 20): Promise<ActivityEntry[]> {
  return getStore().list<ActivityEntry & Record<string, unknown>>(COL.activity, {
    orderBy: { field: "at", direction: "desc" },
    limit,
  });
}

/* ───────────── Notifications ───────────── */

export async function notify(
  n: Omit<StudioNotification, "id" | "read" | "createdAt">,
  opts?: { dedupeKey?: string },
): Promise<void> {
  // Deduplicated notifications use a stable id so repeats overwrite instead of piling up.
  const id = opts?.dedupeKey ? `ntf_${opts.dedupeKey.replace(/[^A-Za-z0-9_.-]/g, "-").slice(0, 120)}` : newId("ntf");
  const doc: StudioNotification = {
    ...n,
    body: n.body ? redact(n.body).slice(0, 800) : undefined,
    id,
    read: false,
    createdAt: nowIso(),
  };
  try {
    await getStore().set(COL.notifications, id, doc as unknown as Record<string, unknown>);
  } catch (err) {
    console.warn("[studio] notification failed:", err instanceof Error ? err.message : err);
  }
}

/* ───────────── Daily stats ───────────── */

export async function todayKey(): Promise<string> {
  const s = await getSettings();
  return dayKey(new Date(), s.publishing.timezone);
}

function emptyDay(id: string): DailyStats {
  return {
    id,
    completedDraftIds: [],
    jobsStarted: [],
    failedJobIds: [],
    researchedTopics: 0,
    approvedIds: [],
    publishedIds: [],
    rejectedIds: [],
    generationMs: 0,
  };
}

export async function getDay(id: string): Promise<DailyStats> {
  const doc = await getStore().get<DailyStats & Record<string, unknown>>(COL.daily, id);
  return { ...emptyDay(id), ...(doc ?? {}) };
}

type ListField = "completedDraftIds" | "jobsStarted" | "failedJobIds" | "approvedIds" | "publishedIds" | "rejectedIds";

/** Idempotently adds `value` to a set field of the day's stats. Returns true if newly added. */
export async function addToDay(field: ListField, value: string, extra?: { generationMs?: number; day?: string }) {
  const id = extra?.day ?? (await todayKey());
  let added = false;
  await getStore().transact<DailyStats & Record<string, unknown>>(COL.daily, id, (cur) => {
    const day = { ...emptyDay(id), ...(cur ?? {}) } as DailyStats;
    if (day[field].includes(value)) return undefined;
    added = true;
    day[field] = [...day[field], value];
    if (field === "jobsStarted") day.researchedTopics += 1;
    if (extra?.generationMs) day.generationMs += extra.generationMs;
    return day as DailyStats & Record<string, unknown>;
  });
  return added;
}

export async function patchDay(id: string, patch: Partial<DailyStats>) {
  await getStore().transact<DailyStats & Record<string, unknown>>(COL.daily, id, (cur) => ({
    ...emptyDay(id),
    ...(cur ?? {}),
    ...patch,
  }) as DailyStats & Record<string, unknown>);
}
