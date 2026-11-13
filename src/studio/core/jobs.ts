import { COL, getStore } from "./store";
import type { CategoryKey, JobStatus, StageKey, StudioJob, StudioTopic } from "./types";
import { PIPELINE_STAGES } from "./types";
import { AiError, NoProviderAvailableError } from "./ai";
import { NetworkError } from "./fetcher";
import { nextStage, PipelineHalt, STAGES, STAGE_LABELS } from "./pipeline";
import { getSettings } from "./settings";
import { addToDay, logActivity, notify, todayKey } from "./ops";
import { emitJobEvent } from "./events";
import { errorMessage, newId, nowIso } from "./util";

type JobRow = StudioJob & Record<string, unknown>;

export const RUNNABLE: JobStatus[] = ["queued", "running", "waiting_network", "waiting_api"];
export const ACTIVE: JobStatus[] = ["queued", "running", "waiting_network", "waiting_api", "paused"];

export async function listJobs(): Promise<StudioJob[]> {
  const rows = await getStore().list<JobRow>(COL.jobs);
  return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function getJob(id: string) {
  return getStore().get<JobRow>(COL.jobs, id);
}

export interface NewJob {
  topic: string;
  category: CategoryKey;
  countryId: string;
  entityIds?: string[];
  origin: StudioJob["origin"];
  topicId?: string;
  targetArticleId?: string;
}

/**
 * Creates a job. Jobs created from a topic use a deterministic id, so a topic
 * can never produce two jobs (restart-safe, double-click-safe).
 */
export async function createJob(input: NewJob): Promise<{ job: StudioJob; created: boolean }> {
  const settings = await getSettings();
  const id = input.topicId ? `job_${input.topicId.replace(/^top_/, "")}` : input.targetArticleId ? newId("job_regen") : newId("job");
  const now = nowIso();
  const job: StudioJob = {
    id,
    topic: input.topic.trim(),
    topicId: input.topicId,
    category: input.category,
    countryId: input.countryId,
    entityIds: input.entityIds ?? [],
    origin: input.origin,
    status: "queued",
    stage: "plan",
    completedStages: [],
    progress: 0,
    retryCount: 0,
    maxRetries: settings.automation.maxRetries,
    checkpoints: {},
    targetArticleId: input.targetArticleId,
    dayKey: await todayKey(),
    log: [{ at: now, stage: "job", level: "info", message: `Queued (${input.origin})` }],
    createdAt: now,
    updatedAt: now,
  };
  const created = await getStore().create(COL.jobs, id, job as unknown as Record<string, unknown>);
  if (!created) return { job: (await getJob(id))!, created: false };
  if (input.topicId) {
    await getStore().transact<StudioTopic & Record<string, unknown>>(COL.topics, input.topicId, (t) =>
      t ? { ...t, status: "in_progress", jobId: id, updatedAt: now } : undefined,
    );
  }
  if (input.origin !== "regenerate") await addToDay("jobsStarted", id);
  await emitJobEvent(id, "job_queued", `Queued (${input.origin}): ${job.topic}`);
  await logActivity(input.origin === "auto" ? "worker" : "admin", "job.created", `Research started: ${job.topic}`, id);
  return { job, created: true };
}

/* ───────────── Manual controls ───────────── */

export async function controlJob(id: string, action: "pause" | "resume" | "retry" | "cancel"): Promise<StudioJob> {
  const out = await getStore().transact<JobRow>(COL.jobs, id, (j) => {
    if (!j) throw new Error("Job not found.");
    const now = nowIso();
    const log = (msg: string) => [...j.log, { at: now, stage: "job" as const, level: "info" as const, message: msg }].slice(-80);
    switch (action) {
      case "pause":
        if (!ACTIVE.includes(j.status)) return undefined;
        return { ...j, status: "paused", log: log("Paused by admin"), updatedAt: now };
      case "resume":
        if (j.status !== "paused") return undefined;
        return { ...j, status: "queued", nextRunAt: undefined, log: log("Resumed by admin"), updatedAt: now };
      case "retry":
        if (!["failed", "needs_review", "paused", "waiting_api", "waiting_network"].includes(j.status)) return undefined;
        return { ...j, status: "queued", retryCount: 0, nextRunAt: undefined, lastError: undefined, log: log(`Retry from stage "${STAGE_LABELS[j.stage]}"`), updatedAt: now };
      case "cancel":
        if (j.status === "completed" || j.status === "cancelled") return undefined;
        return { ...j, status: "cancelled", lease: undefined, finishedAt: now, log: log("Cancelled by admin"), updatedAt: now };
    }
  });
  if (out && action === "cancel" && out.topicId) {
    await getStore().transact<StudioTopic & Record<string, unknown>>(COL.topics, out.topicId, (t) =>
      t ? { ...t, status: "dismissed", updatedAt: nowIso() } : undefined,
    );
  }
  await logActivity("admin", `job.${action}`, `Job ${action}: ${out?.topic ?? id}`, id);
  await emitJobEvent(id, "job_control", `Admin: ${action}`);
  return out!;
}

/* ───────────── Execution ───────────── */

const LEASE_MS = 10 * 60_000;

function backoffMs(retry: number) {
  return Math.min(30 * 60_000, 30_000 * 2 ** Math.max(0, retry - 1));
}

/** Picks the next runnable job (oldest first) whose wait time has passed. */
export async function nextRunnableJob(): Promise<StudioJob | null> {
  const now = Date.now();
  const jobs = (await getStore().list<JobRow>(COL.jobs)).filter((j) => {
    if (!RUNNABLE.includes(j.status)) return false;
    if (j.status === "running") return !j.lease || Date.parse(j.lease.until) < now; // crashed run → resume
    return !j.nextRunAt || Date.parse(j.nextRunAt) <= now;
  });
  // Admin-requested work first, then by age.
  const rank = (j: StudioJob) => (j.origin === "manual" || j.origin === "regenerate" ? 0 : 1);
  jobs.sort((a, b) => rank(a) - rank(b) || a.createdAt.localeCompare(b.createdAt));
  return jobs[0] ?? null;
}

export interface StepOutcome {
  jobId: string;
  stage: StageKey;
  result: "progress" | "stage_done" | "completed" | "needs_review" | "waiting_api" | "waiting_network" | "retry" | "failed" | "skipped";
  message?: string;
  retryAt?: string;
}

/**
 * Runs one unit of work for a job (one stage, or one slice of a long stage),
 * saves the checkpoint and returns. Safe to call repeatedly; safe after a crash.
 */
export async function runJobStep(jobId: string, owner: string): Promise<StepOutcome> {
  const store = getStore();
  const leaseUntil = new Date(Date.now() + LEASE_MS).toISOString();
  let leased: StudioJob | null = null;
  await store.transact<JobRow>(COL.jobs, jobId, (j) => {
    if (!j || !RUNNABLE.includes(j.status)) return undefined;
    if (j.status === "running" && j.lease && Date.parse(j.lease.until) > Date.now() && j.lease.owner !== owner) return undefined;
    const now = nowIso();
    const st = j.stageTimes?.[j.stage];
    const stageTimes = { ...(j.stageTimes ?? {}), [j.stage]: { startedAt: st?.startedAt ?? now, completedAt: undefined, failedAt: st?.failedAt, attempts: (st?.attempts ?? 0) + 1 } };
    leased = { ...j, status: "running", lease: { owner, until: leaseUntil }, startedAt: j.startedAt ?? now, stageTimes, activity: { stage: j.stage, message: STAGE_LABELS[j.stage], at: now }, updatedAt: now };
    return leased as JobRow;
  });
  if (!leased) return { jobId, stage: "plan", result: "skipped" };
  const job = leased as StudioJob;
  const stage = job.stage;
  const settings = await getSettings();
  const audit: Array<{ stage: string; provider: string; model: string; at: string }> = [];
  if (!job.stageTimes?.[stage] || job.stageTimes[stage]!.attempts === 1) {
    await emitJobEvent(jobId, "stage_started", STAGE_LABELS[stage], { stage, worker: owner });
  }
  // Live activity: persisted (throttled) and mirrored as progress events; also renews the lease.
  let lastWrite = 0;
  const report = async (message: string) => {
    const now = Date.now();
    await emitJobEvent(jobId, "progress", message, { stage, worker: owner });
    if (now - lastWrite < 700) return;
    lastWrite = now;
    await store.transact<JobRow>(COL.jobs, jobId, (j) =>
      j && j.lease?.owner === owner ? ({ ...j, activity: { stage, message: message.slice(0, 300), at: nowIso() }, lease: { owner, until: new Date(Date.now() + LEASE_MS).toISOString() }, updatedAt: nowIso() } as JobRow) : undefined,
    );
  };

  try {
    const out = await STAGES[stage](job, { settings, call: { jobId, stage, audit }, report });
    const next = out.done ? nextStage(stage) : stage;
    let finalStatus: JobStatus = "running";
    let articleId: string | undefined;
    let passed = false;
    if (out.done && stage === "finalize") {
      const f = out.data as { articleId: string; passed: boolean; reasons: string[] };
      articleId = f.articleId;
      passed = f.passed;
      finalStatus = f.passed ? "completed" : "needs_review";
    }
    const saved = await store.transact<JobRow>(COL.jobs, jobId, (j) => {
      if (!j) return undefined;
      const now = nowIso();
      const completedStages = out.done && !j.completedStages.includes(stage) ? [...j.completedStages, stage] : j.completedStages;
      // An admin may have paused/cancelled while this step ran: keep their status, keep the checkpoint.
      const adminStatus = j.status !== "running" ? j.status : null;
      const status: JobStatus = adminStatus ?? (finalStatus === "running" ? "queued" : finalStatus);
      const st = j.stageTimes?.[stage];
      const stageTimes = out.done && st ? { ...j.stageTimes, [stage]: { ...st, completedAt: now } } : j.stageTimes;
      return {
        ...j,
        stageTimes,
        activity: { stage: next ?? stage, message: out.done ? (next && finalStatus === "running" ? `Next: ${STAGE_LABELS[next]}` : "Finished") : out.log ?? "Progress saved", at: now },
        checkpoints: { ...j.checkpoints, [stage]: out.data },
        completedStages,
        stage: next ?? stage,
        progress: Math.round((completedStages.length / PIPELINE_STAGES.length) * 100),
        status,
        retryCount: out.done ? 0 : j.retryCount,
        lease: undefined,
        lastError: undefined,
        nextRunAt: undefined,
        lastCheckpointAt: now,
        articleId: articleId ?? j.articleId,
        calls: [...(j.calls ?? []), ...audit].slice(-80),
        finishedAt: finalStatus === "completed" || finalStatus === "needs_review" ? now : j.finishedAt,
        log: [...j.log, { at: now, stage, level: "info" as const, message: out.log ?? (out.done ? "Stage complete" : "Progress saved") }].slice(-80),
        updatedAt: now,
      } as JobRow;
    });
    if (out.done) await emitJobEvent(jobId, "stage_completed", out.log ?? STAGE_LABELS[stage], { stage, worker: owner });
    if (out.done && stage === "finalize" && saved && articleId) {
      await emitJobEvent(jobId, passed ? "job_completed" : "job_needs_review", passed ? "Draft ready for review" : "Draft saved for extra review", { stage, worker: owner });
      await onJobFinished(saved, articleId, passed);
      return { jobId, stage, result: passed ? "completed" : "needs_review" };
    }
    return { jobId, stage, result: out.done ? "stage_done" : "progress", message: out.log };
  } catch (err) {
    return handleStepError(job, stage, err);
  }
}

async function onJobFinished(job: StudioJob, articleId: string, passed: boolean) {
  const store = getStore();
  if (job.topicId) {
    await store.transact<StudioTopic & Record<string, unknown>>(COL.topics, job.topicId, (t) =>
      t ? { ...t, status: "used", updatedAt: nowIso() } : undefined,
    );
  }
  const ms = job.startedAt ? Date.now() - Date.parse(job.startedAt) : 0;
  if (passed && job.origin !== "regenerate") {
    // Counted once per article id, on the day the job was created.
    await addToDay("completedDraftIds", articleId, { generationMs: ms, day: job.dayKey });
  }
  await logActivity("worker", passed ? "draft.ready" : "draft.needs_review", `${passed ? "Draft ready" : "Draft needs review"}: ${job.topic}`, articleId);
  await notify(
    {
      kind: "awaiting_approval",
      level: passed ? "info" : "warning",
      title: passed ? "New draft awaiting approval" : "Draft saved — needs extra review",
      body: job.topic,
      href: `/admin/articles/${articleId}`,
    },
    { dedupeKey: `draft-${articleId}` },
  );
}

async function handleStepError(job: StudioJob, stage: StageKey, err: unknown): Promise<StepOutcome> {
  const store = getStore();
  const message = errorMessage(err);
  let status: JobStatus;
  let nextRunAt: string | undefined;
  let countRetry = true;
  let kind = "error";

  if (err instanceof PipelineHalt) {
    status = err.outcome;
    countRetry = false;
    kind = "halt";
  } else if (err instanceof NoProviderAvailableError) {
    countRetry = false;
    kind = err.reason;
    if (err.reason === "network") {
      status = "waiting_network";
      nextRunAt = new Date(Date.now() + 60_000).toISOString();
    } else {
      status = "waiting_api";
      nextRunAt = err.retryAt ?? new Date(Date.now() + 15 * 60_000).toISOString();
    }
  } else if (err instanceof NetworkError || (err instanceof AiError && err.kind === "network")) {
    status = "waiting_network";
    countRetry = false;
    kind = "network";
    nextRunAt = new Date(Date.now() + 60_000).toISOString();
  } else {
    status = "queued";
    kind = err instanceof AiError ? err.kind : "error";
  }

  let finalStatus: JobStatus = status;
  const saved = await store.transact<JobRow>(COL.jobs, job.id, (j) => {
    if (!j) return undefined;
    const now = nowIso();
    const retryCount = countRetry ? j.retryCount + 1 : j.retryCount;
    let st: JobStatus = status;
    let nra = nextRunAt;
    if (countRetry) {
      if (retryCount > j.maxRetries) st = "failed";
      else nra = new Date(Date.now() + backoffMs(retryCount)).toISOString();
    }
    if (j.status !== "running") st = j.status; // admin paused/cancelled meanwhile
    finalStatus = st;
    const stt = j.stageTimes?.[stage];
    return {
      ...j,
      stageTimes: stt ? { ...j.stageTimes, [stage]: { ...stt, failedAt: now } } : j.stageTimes,
      activity: { stage, message: st === "failed" ? `Failed: ${message.slice(0, 200)}` : st === "waiting_api" ? "Waiting for the AI provider" : st === "waiting_network" ? "Waiting for the network" : `Retry scheduled: ${message.slice(0, 160)}`, at: now },
      status: st,
      retryCount,
      nextRunAt: nra,
      lease: undefined,
      lastError: message,
      lastErrorKind: kind,
      finishedAt: st === "failed" || st === "needs_review" ? now : j.finishedAt,
      log: [...j.log, { at: now, stage, level: st === "failed" ? ("error" as const) : ("warn" as const), message }].slice(-80),
      updatedAt: now,
    } as JobRow;
  });

  if (finalStatus === "failed" || (finalStatus === "needs_review" && err instanceof PipelineHalt)) {
    if (finalStatus === "failed") await addToDay("failedJobIds", job.id, { day: job.dayKey });
    if (job.topicId && finalStatus === "failed") {
      await store.transact<StudioTopic & Record<string, unknown>>(COL.topics, job.topicId, (t) =>
        t ? { ...t, status: "suggested", jobId: undefined, updatedAt: nowIso() } : undefined,
      );
    }
    await notify(
      {
        kind: "generation_failed",
        level: finalStatus === "failed" ? "error" : "warning",
        title: finalStatus === "failed" ? "Article generation failed" : "Research stopped — needs your decision",
        body: `${job.topic}: ${message}`,
        href: `/admin/automation?job=${job.id}`,
      },
      { dedupeKey: `job-${job.id}-${finalStatus}` },
    );
    await logActivity("worker", "job.stopped", `${job.topic}: ${message}`, job.id);
  }
  const failedNow = finalStatus === "failed";
  await emitJobEvent(
    job.id,
    failedNow ? "job_failed" : finalStatus === "needs_review" ? "job_needs_review" : finalStatus === "waiting_api" || finalStatus === "waiting_network" ? "waiting" : "retry_scheduled",
    failedNow
      ? `Failed at "${STAGE_LABELS[stage]}": ${message}`
      : finalStatus === "waiting_api" || finalStatus === "waiting_network"
        ? `${finalStatus === "waiting_api" ? "Waiting for the AI provider" : "Waiting for the network"}${saved?.nextRunAt ? ` until ${saved.nextRunAt}` : ""}: ${message}`
        : finalStatus === "needs_review"
          ? message
          : `Stage failed, retry ${saved?.retryCount ?? "?"}/${saved?.maxRetries ?? "?"} scheduled${saved?.nextRunAt ? ` for ${saved.nextRunAt}` : ""}: ${message}`,
    { stage },
  );
  const result: StepOutcome["result"] =
    finalStatus === "failed" ? "failed" : finalStatus === "needs_review" ? "needs_review" : finalStatus === "waiting_api" ? "waiting_api" : finalStatus === "waiting_network" ? "waiting_network" : "retry";
  return { jobId: job.id, stage, result, message, retryAt: saved?.nextRunAt };
}
