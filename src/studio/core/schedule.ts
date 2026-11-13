import { COL, getStore } from "./store";
import type { ScheduleChange, StudioArticle } from "./types";
import { compactQueue, nextSlot } from "./scheduler";
import { getSettings } from "./settings";
import { publishArticle, type Revalidator } from "./publish";
import { publishBlockers } from "./articles";
import { logActivity, notify } from "./ops";
import { nowIso } from "./util";

type Row = StudioArticle & Record<string, unknown>;

export class ScheduleError extends Error {}

async function scheduledTimes(excludeId?: string): Promise<string[]> {
  const rows = await getStore().list<Row>(COL.articles);
  const out: string[] = [];
  for (const a of rows) {
    if (a.id === excludeId) continue;
    if (a.status === "scheduled" && a.schedule?.at) out.push(a.schedule.at);
    // Articles already published today count toward the daily maximum.
    if (a.status === "published" && a.publish?.publishedAt && Date.now() - Date.parse(a.publish.publishedAt) < 3 * 86400_000) out.push(a.publish.publishedAt);
  }
  return out;
}

/** Preview of the next free slot (shown to the admin before confirming). */
export async function previewSlot(articleId?: string): Promise<string | null> {
  const s = await getSettings();
  const slot = nextSlot(s.publishing, { taken: await scheduledTimes(articleId) });
  return slot?.toISOString() ?? null;
}

export async function scheduleArticle(id: string, opts: { at?: string; expectedSlot?: string }): Promise<StudioArticle> {
  const settings = await getSettings();
  const taken = await scheduledTimes(id);
  let at: string;
  let pinned: boolean;
  if (opts.at) {
    const t = Date.parse(opts.at);
    if (!Number.isFinite(t)) throw new ScheduleError("Invalid date/time.");
    if (t < Date.now() + 60_000) throw new ScheduleError("Choose a time in the future.");
    at = new Date(t).toISOString();
    pinned = true;
  } else {
    const slot = nextSlot(settings.publishing, { taken });
    if (!slot) throw new ScheduleError("No free publishing slot found. Check the publishing days and times in Settings.");
    at = slot.toISOString();
    // The admin confirmed a preview; if the queue changed meanwhile, ask again rather than silently picking another time.
    if (opts.expectedSlot && opts.expectedSlot !== at) {
      throw new ScheduleError(`The queue changed — the next free slot is now ${at}. Please confirm again.`);
    }
    pinned = false;
  }
  const saved = await getStore().transact<Row>(COL.articles, id, (a) => {
    if (!a) throw new ScheduleError("Article not found.");
    if (!["approved", "scheduled"].includes(a.status)) throw new ScheduleError("Only approved articles can be scheduled.");
    const blockers = publishBlockers(a);
    if (blockers.length) throw new ScheduleError(blockers.join(" "));
    const change: ScheduleChange = { at: nowIso(), from: a.schedule?.at ?? null, to: at, reason: opts.at ? "Manual date/time" : "Next free slot" };
    return {
      ...a,
      status: "scheduled",
      schedule: { at, pinned, history: [...(a.schedule?.history ?? []), change] },
      version: a.version + 1,
      updatedAt: nowIso(),
    } as Row;
  });
  await logActivity("admin", "article.scheduled", `Scheduled "${saved!.title}" for ${at}`, id);
  return saved!;
}

export async function cancelSchedule(id: string): Promise<StudioArticle> {
  const saved = await getStore().transact<Row>(COL.articles, id, (a) => {
    if (!a || a.status !== "scheduled") throw new ScheduleError("Article is not scheduled.");
    const change: ScheduleChange = { at: nowIso(), from: a.schedule?.at ?? null, to: null, reason: "Schedule cancelled" };
    return { ...a, status: "approved", schedule: { at: "", pinned: false, history: [...(a.schedule?.history ?? []), change] }, version: a.version + 1, updatedAt: nowIso() } as Row;
  });
  await logActivity("admin", "article.unscheduled", `Schedule cancelled: ${saved!.title}`, id);
  return saved!;
}

/** Swaps the slots of two scheduled articles (reordering the queue). */
export async function swapSlots(idA: string, idB: string): Promise<void> {
  const store = getStore();
  const a = await store.get<Row>(COL.articles, idA);
  const b = await store.get<Row>(COL.articles, idB);
  if (!a?.schedule?.at || !b?.schedule?.at || a.status !== "scheduled" || b.status !== "scheduled") throw new ScheduleError("Both articles must be scheduled.");
  const now = nowIso();
  const apply = (id: string, from: string, to: string) =>
    store.transact<Row>(COL.articles, id, (x) =>
      x && x.schedule
        ? ({ ...x, schedule: { ...x.schedule, at: to, pinned: true, history: [...x.schedule.history, { at: now, from, to, reason: "Reordered" }] }, version: x.version + 1, updatedAt: now } as Row)
        : undefined,
    );
  await apply(idA, a.schedule.at, b.schedule.at);
  await apply(idB, b.schedule.at, a.schedule.at);
  await logActivity("admin", "schedule.reordered", `Swapped "${a.title}" and "${b.title}"`);
}

/** Proposed compaction of the queue (nothing applied). */
export async function proposeCompaction() {
  const s = await getSettings();
  const rows = (await getStore().list<Row>(COL.articles)).filter((a) => a.status === "scheduled" && a.schedule?.at);
  return compactQueue(s.publishing, rows.map((a) => ({ id: a.id, at: a.schedule!.at, pinned: a.schedule!.pinned })));
}

export async function applyCompaction(changes: Array<{ id: string; from: string; to: string }>) {
  const now = nowIso();
  for (const c of changes) {
    await getStore().transact<Row>(COL.articles, c.id, (a) => {
      // Only apply if the article is still where the proposal saw it.
      if (!a || a.status !== "scheduled" || a.schedule?.at !== c.from) return undefined;
      return { ...a, schedule: { ...a.schedule, at: c.to, history: [...a.schedule.history, { at: now, from: c.from, to: c.to, reason: "Queue recalculated (moved earlier)" }] }, version: a.version + 1, updatedAt: now } as Row;
    });
  }
  if (changes.length) await logActivity("admin", "schedule.compacted", `${changes.length} scheduled article(s) moved earlier`);
}

/** Publishes every scheduled article whose time has come. Used by the worker and the cron endpoint. */
export async function publishDue(opts: { actor: "worker" | "admin"; revalidate?: Revalidator }): Promise<Array<{ id: string; ok: boolean; message: string }>> {
  const rows = (await getStore().list<Row>(COL.articles, { where: [["status", "scheduled"]] })).filter(
    (a) => a.schedule?.at && Date.parse(a.schedule.at) <= Date.now(),
  );
  const out: Array<{ id: string; ok: boolean; message: string }> = [];
  for (const a of rows) {
    // Back off after failures: 5, 10, 20 … minutes, max 6 attempts before needing an admin.
    const p = a.publish;
    if (p?.state === "failed" && p.lastAttemptAt) {
      if ((p.attempts ?? 0) >= 6) continue;
      const wait = 5 * 60_000 * 2 ** Math.max(0, (p.attempts ?? 1) - 1);
      if (Date.now() - Date.parse(p.lastAttemptAt) < wait) continue;
    }
    try {
      await publishArticle(a.id, { actor: opts.actor, revalidate: opts.revalidate, reason: "Published on schedule" });
      out.push({ id: a.id, ok: true, message: "Published" });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      out.push({ id: a.id, ok: false, message });
      if ((a.publish?.attempts ?? 0) + 1 >= 6) {
        await notify({ kind: "publish_failed", level: "error", title: "Scheduled publication stopped retrying", body: `${a.title}: ${message}`, href: `/admin/articles/${a.id}` }, { dedupeKey: `sched-giveup-${a.id}` });
      }
    }
  }
  return out;
}
