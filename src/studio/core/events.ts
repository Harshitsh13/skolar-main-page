import { COL, getStore } from "./store";
import type { JobEvent, JobEventType, StageKey } from "./types";
import { newId, nowIso, redact } from "./util";

/**
 * Persistent job events (stage started / progress / completed / failed …).
 * Stored as one capped document per job so the live view reads a single
 * record. They survive page refreshes and worker restarts.
 */

const MAX_EVENTS = 400;

export async function emitJobEvent(jobId: string, type: JobEventType, message: string, opts: { stage?: StageKey; worker?: string } = {}): Promise<void> {
  const ev: JobEvent = { id: newId("ev"), jobId, at: nowIso(), type, stage: opts.stage, message: redact(message).slice(0, 400), worker: opts.worker };
  try {
    await getStore().transact<{ events: JobEvent[] } & Record<string, unknown>>(COL.jobEvents, jobId, (cur) => {
      const events = [...(cur?.events ?? []), ev];
      // keep every non-progress event; trim oldest progress events first
      while (events.length > MAX_EVENTS) {
        const i = events.findIndex((e) => e.type === "progress");
        events.splice(i >= 0 ? i : 0, 1);
      }
      return { jobId, events };
    });
  } catch (err) {
    console.warn("[studio] job event not saved:", err instanceof Error ? err.message : err);
  }
}

export async function jobEvents(jobId: string): Promise<JobEvent[]> {
  const doc = await getStore().get<{ events: JobEvent[] } & Record<string, unknown>>(COL.jobEvents, jobId);
  return doc?.events ?? [];
}
