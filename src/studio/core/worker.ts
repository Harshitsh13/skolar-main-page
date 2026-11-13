import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { COL, getStore } from "./store";
import type { StudioJob, StudioSource, WorkerInstance, WorkerState, WorkerStatus } from "./types";
import { studioEnv } from "./env";
import { getSettings } from "./settings";
import { networkAvailable, NetworkError } from "./fetcher";
import { listProviders } from "./ai";
import { createJob, nextRunnableJob, runJobStep, RUNNABLE } from "./jobs";
import { discoverTopics, pickTopicForAutomation } from "./topics";
import { checkSource, sourcesDue } from "./monitor";
import { publishDue } from "./schedule";
import { httpRevalidate, refreshDeployments } from "./publish";
import { advanceCountries } from "./countries";
import { discoverOfficialPages } from "./discovery";
import { getDay, logActivity, notify, patchDay, todayKey } from "./ops";
import { errorMessage, nowIso, sleep } from "./util";
import { randomUUID } from "node:crypto";

/**
 * The SKOLAR Studio background worker (platform-independent core).
 * Started by Windows Task Scheduler / macOS LaunchAgent via scripts/studio-worker.ts.
 *
 * Guarantees:
 *  - one worker at a time (PID lock file + a lease in the shared store)
 *  - all state is persisted; a restart resumes jobs from their last checkpoint
 *  - daily draft count is stored per local calendar day and counted once per article
 */

const LEASE_ID = "lease";
const LEASE_MS = 3 * 60_000;
const HEARTBEAT_MS = 30_000;

export interface WorkerOptions {
  /** Stop after the daily target is reached and the queue is idle (useful for testing). */
  once?: boolean;
  log?: (msg: string) => void;
  idleSleepMs?: number;
  /** Pause between job steps (default 1.5 s). */
  stepSleepMs?: number;
  /** Override the persistent instance id (tests run several instances in one process). */
  instanceId?: string;
  heartbeatMs?: number;
  /** Skip the per-folder PID lock (tests only). */
  skipPidLock?: boolean;
}

/* ───────────── Single-instance protection ───────────── */

function pidLockPath() {
  return path.join(studioEnv.dataDir(), "worker.pid");
}

function processAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

export function acquirePidLock(): boolean {
  fs.mkdirSync(studioEnv.dataDir(), { recursive: true });
  const file = pidLockPath();
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = fs.openSync(file, "wx");
      fs.writeSync(fd, String(process.pid));
      fs.closeSync(fd);
      return true;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      const pid = Number(fs.readFileSync(file, "utf8").trim());
      if (pid && pid !== process.pid && processAlive(pid)) return false;
      fs.rmSync(file, { force: true }); // stale lock from a crashed worker
    }
  }
  return false;
}

export function releasePidLock() {
  try {
    const file = pidLockPath();
    if (Number(fs.readFileSync(file, "utf8").trim()) === process.pid) fs.rmSync(file, { force: true });
  } catch {
    /* already gone */
  }
}

/**
 * Persistent identity of this worker installation (one per data folder).
 * Survives restarts, so a crashed instance is recognised when it comes back.
 */
export function workerInstanceId(): string {
  const file = path.join(studioEnv.dataDir(), "worker-instance-id");
  try {
    const id = fs.readFileSync(file, "utf8").trim();
    if (/^wk-[a-z0-9-]{8,}$/.test(id)) return id;
  } catch {
    /* first run */
  }
  fs.mkdirSync(studioEnv.dataDir(), { recursive: true });
  const id = `wk-${os.hostname().toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 20)}-${randomUUID().slice(0, 8)}`;
  fs.writeFileSync(file, id);
  return id;
}

/**
 * Leader lease (atomic read-modify-write in the shared store, expiring).
 * Only the leader schedules, publishes, monitors sources and creates
 * automatic jobs; any number of followers may process queued jobs, each
 * protected by its own per-job lease.
 */
export async function acquireLease(owner: string): Promise<boolean> {
  let ok = false;
  await getStore().transact<{ owner: string; until: string } & Record<string, unknown>>(COL.worker, LEASE_ID, (cur) => {
    if (cur && cur.owner !== owner && Date.parse(cur.until) > Date.now()) return undefined;
    ok = true;
    return { owner, until: new Date(Date.now() + LEASE_MS).toISOString() };
  });
  return ok;
}

async function releaseLease(owner: string) {
  await getStore().transact<{ owner: string; until: string } & Record<string, unknown>>(COL.worker, LEASE_ID, (cur) =>
    cur && cur.owner === owner ? { owner, until: new Date(0).toISOString() } : undefined,
  );
}

export async function releaseLeaseForTests(owner: string) {
  await releaseLease(owner);
}

/* ───────────── Status ───────────── */

const ONLINE_MS = 3 * 60_000;

export async function listWorkers(): Promise<Array<WorkerInstance & { online: boolean; leader: boolean }>> {
  const store = getStore();
  const lease = await store.get<{ owner: string; until: string } & Record<string, unknown>>(COL.worker, LEASE_ID);
  const rows = await store.list<WorkerInstance & Record<string, unknown>>(COL.workers);
  return rows
    .map((w) => ({
      ...w,
      online: !w.stoppedAt && Date.now() - Date.parse(w.heartbeatAt) < ONLINE_MS,
      leader: Boolean(lease && lease.owner === w.id && Date.parse(lease.until) > Date.now()),
    }))
    .sort((a, b) => b.heartbeatAt.localeCompare(a.heartbeatAt));
}

/** Summary for the dashboard: the leader (or most recent) instance plus all instances. */
export async function readWorkerStatus(): Promise<(WorkerStatus & { online: boolean; instances: Awaited<ReturnType<typeof listWorkers>> }) | null> {
  const instances = await listWorkers();
  const main = instances.find((w) => w.leader && w.online) ?? instances.find((w) => w.online) ?? instances[0];
  if (!main) return null;
  return {
    id: "status",
    state: main.online ? main.state : "stopped",
    message: main.message,
    heartbeatAt: main.heartbeatAt,
    startedAt: main.startedAt,
    pid: main.pid,
    platform: `${main.platform} · ${main.id}${main.leader ? " (leader)" : ""}`,
    currentJobId: main.currentJobId,
    cleanShutdown: main.cleanShutdown,
    online: main.online,
    instances,
  };
}

/* ───────────── Main loop ───────────── */

export async function runWorker(opts: WorkerOptions = {}): Promise<void> {
  const log = opts.log ?? ((m: string) => console.log(`[${new Date().toISOString()}] ${m}`));
  if (!opts.skipPidLock && !acquirePidLock()) {
    log("Another SKOLAR Studio worker is already running from this data folder. Exiting.");
    return;
  }
  const owner = opts.instanceId ?? workerInstanceId();
  const store = getStore();
  let isLeader = await acquireLease(owner);
  log(`Instance ${owner} started as ${isLeader ? "leader" : "follower (another instance holds the leader lease)"}`);

  const previous = await store.get<WorkerInstance & Record<string, unknown>>(COL.workers, owner);
  if (previous && !previous.cleanShutdown && !previous.stoppedAt) {
    await notify({
      kind: "worker_stopped",
      level: "warning",
      title: "Worker stopped unexpectedly",
      body: `Instance ${owner} last reported ${previous.heartbeatAt}. Unfinished jobs resume from their last checkpoint.`,
      href: "/admin",
    });
  }

  const startedAt = nowIso();
  let state: WorkerState = "idle";
  let message = "Starting";
  let currentJobId: string | null = null;
  let stopping = false;

  const writeStatus = async (clean = false) => {
    if (stopping && !clean) return;
    const doc: WorkerInstance = {
      id: owner,
      host: os.hostname().slice(0, 60),
      platform: `${process.platform} ${os.release()}`,
      pid: process.pid,
      role: isLeader ? "leader" : "follower",
      state,
      message,
      startedAt,
      heartbeatAt: nowIso(),
      currentJobId,
      cleanShutdown: clean,
      stoppedAt: clean ? nowIso() : undefined,
    };
    await store.set(COL.workers, owner, doc as unknown as Record<string, unknown>).catch(() => undefined);
  };
  const setState = async (s: WorkerState, m: string) => {
    if (s !== state || m !== message) log(`${s}: ${m}`);
    state = s;
    message = m;
    await writeStatus();
  };

  const heartbeat = setInterval(() => {
    void acquireLease(owner).then((ok) => {
      if (ok !== isLeader) log(ok ? "Took over the leader lease (previous leader stopped or expired)." : "Leader lease now held by another instance — continuing as follower.");
      isLeader = ok;
      void writeStatus();
    });
  }, opts.heartbeatMs ?? HEARTBEAT_MS);

  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    log(`Received ${signal}, finishing the current step and stopping…`);
  };
  process.once("SIGINT", () => void shutdown("SIGINT"));
  process.once("SIGTERM", () => void shutdown("SIGTERM"));

  await logActivity("worker", "worker.started", `Worker started on ${process.platform}`);
  await setState("running", "Checking configuration");

  let lastMonitor = 0;
  let lastDiscovery = 0;
  let lastDeployCheck = 0;
  let lastPageDiscovery = opts.once ? Date.now() : 0;
  let offlineSince: number | null = null;

  try {
    while (!stopping) {
      const settings = await getSettings();
      const idle = opts.idleSleepMs ?? 60_000;

      // 1. Network
      if (!(await networkAvailable())) {
        if (!offlineSince) {
          offlineSince = Date.now();
          await notify({ kind: "network", level: "warning", title: "Network unavailable", body: "The worker paused and will resume automatically when the connection returns." }, { dedupeKey: `network-${new Date().toISOString().slice(0, 10)}` });
        }
        await markRunningJobs("waiting_network");
        await setState("offline", "Network unavailable — waiting to reconnect");
        await sleep(30_000);
        continue;
      }
      if (offlineSince) {
        log(`Network back after ${Math.round((Date.now() - offlineSince) / 1000)} s`);
        offlineSince = null;
        await requeueWaiting("waiting_network");
      }

      // 2. Scheduled publications (leader only — never depends on a browser)
      if (isLeader) try {
        const res = await publishDue({ actor: "worker", revalidate: httpRevalidate });
        for (const r of res) log(`Scheduled publish ${r.id}: ${r.ok ? "ok" : r.message}`);
      } catch (err) {
        log(`Publishing check failed: ${errorMessage(err)}`);
      }
      if (isLeader && Date.now() - lastDeployCheck > 60_000) {
        lastDeployCheck = Date.now();
        await refreshDeployments().catch(() => 0);
        await advanceCountries().catch(() => undefined);
      }
      // Weekly official page discovery (leader only).
      if (isLeader && Date.now() - lastPageDiscovery > 60 * 60_000) {
        lastPageDiscovery = Date.now();
        const last = await store.get<{ at: string } & Record<string, unknown>>(COL.integrations, "discovery-last-run");
        if (!last || Date.now() - Date.parse(last.at) > 7 * 86400_000) {
          await setState("running", "Discovering official pages");
          await discoverOfficialPages({ report: log }).catch((err) => log(`Page discovery failed: ${errorMessage(err)}`));
        }
      }

      // 3. Source monitoring (a few sources per pass)
      if (isLeader && settings.monitoring.enabled && Date.now() - lastMonitor > 10 * 60_000) {
        lastMonitor = Date.now();
        const due = sourcesDue(await store.list<StudioSource & Record<string, unknown>>(COL.sources)).slice(0, 3);
        for (const s of due) {
          try {
            const r = await checkSource(s.id);
            log(`Checked ${s.name}: ${r.status} — ${r.message}`);
          } catch (err) {
            log(`Source check ${s.name} failed: ${errorMessage(err)}`);
            if (err instanceof NetworkError) break;
          }
        }
      }

      // 4. Automation (automatic topic → job creation). Jobs an admin queued run even when it is off.
      const autoOn = settings.automation.enabled && isLeader;
      const providers = await listProviders();
      if (!providers.some((p) => p.enabled && !p.state.needsAttention)) {
        await setState("attention", "No working AI provider — check Integrations");
        if (opts.once) break;
        await sleep(idle);
        continue;
      }

      const day = await getDay(await todayKey());
      const target = settings.automation.dailyTarget;
      const done = day.completedDraftIds.length;
      const jobs = await store.list<StudioJob & Record<string, unknown>>(COL.jobs);
      const inflightAuto = jobs.filter((j) => j.origin !== "manual" && j.origin !== "regenerate" && RUNNABLE.includes(j.status)).length;

      // Start new automatic jobs only while below target (in-flight jobs count toward it).
      if (autoOn && done + inflightAuto < target) {
        if (day.jobsStarted.length >= settings.automation.maxJobsPerDay) {
          await reportShortfall(day.id, `Daily job limit (${settings.automation.maxJobsPerDay}) reached after failures; ${done}/${target} drafts completed.`);
        } else {
          let topic = await pickTopicForAutomation(settings.automation.autoPickTopics);
          if (!topic && settings.automation.autoPickTopics && Date.now() - lastDiscovery > 30 * 60_000) {
            lastDiscovery = Date.now();
            await setState("running", "Discovering new topics");
            const r = await discoverTopics({ max: 10 }).catch((err) => ({ added: [], notes: [errorMessage(err)] }));
            for (const n of r.notes) log(`Discovery: ${n}`);
            topic = await pickTopicForAutomation(true);
          }
          if (topic) {
            const r = await createJob({ topic: topic.title, category: topic.category, countryId: topic.countryId, entityIds: topic.entityIds, origin: topic.origin === "source_change" ? "source_change" : "auto", topicId: topic.id });
            if (r.created) log(`Queued: ${topic.title}`);
          } else if (!inflightAuto) {
            await reportShortfall(day.id, settings.automation.autoPickTopics ? "No new topics available — add topics or registry entries." : "No approved topics in the queue (automatic topic picking is off).");
          }
        }
      } else if (autoOn && done >= target && !day.targetNotified) {
        await patchDay(day.id, { targetNotified: true });
        await notify({ kind: "daily_target", level: "success", title: `${done} daily drafts completed`, body: "Today's drafts are waiting in the Review Queue.", href: "/admin/review" });
      }

      // 5. Run one step of the next job
      const job = await nextRunnableJob();
      if (!job) {
        if (!autoOn) await setState("paused", "Automation is switched off — only jobs you start are processed");
        else if (done >= target) await setState("idle", `Daily target reached (${done}/${target}) — waiting for tomorrow`);
        else await setState("idle", "Waiting for the next task");
        // In once-mode, keep waiting while jobs are only paused for a retry / rate-limit window.
        const pendingJobs = (await store.list<StudioJob & Record<string, unknown>>(COL.jobs)).filter((j) => RUNNABLE.includes(j.status)).length;
        if (opts.once && !pendingJobs && (!autoOn || done >= target || !inflightAuto)) break;
        await sleep(Math.min(idle, await msUntilNextWake()));
        continue;
      }
      currentJobId = job.id;
      await setState("running", `Working on: ${job.topic}`);
      const out = await runJobStep(job.id, owner);
      currentJobId = null;
      log(`${job.id} · ${out.stage} → ${out.result}${out.message ? ` (${out.message})` : ""}`);
      if (out.result === "waiting_api") {
        await setState("api_limited", `AI provider limit reached — resuming ${out.retryAt ? `after ${out.retryAt}` : "later"}`);
      }
      await sleep(opts.stepSleepMs ?? 1500);
    }
  } catch (err) {
    log(`Worker crashed: ${errorMessage(err)}`);
    await notify({ kind: "worker_stopped", level: "error", title: "Worker stopped with an error", body: errorMessage(err), href: "/admin" });
    throw err;
  } finally {
    stopping = true;
    clearInterval(heartbeat);
    state = "stopped";
    message = "Worker stopped";
    await writeStatus(true);
    if (isLeader) await releaseLease(owner).catch(() => undefined);
    if (!opts.skipPidLock) releasePidLock();
    await logActivity("worker", "worker.stopped", `Worker ${owner} stopped`);
  }
}

async function markRunningJobs(status: "waiting_network") {
  const jobs = await getStore().list<StudioJob & Record<string, unknown>>(COL.jobs, { where: [["status", "queued"]] });
  for (const j of jobs) {
    await getStore().transact<StudioJob & Record<string, unknown>>(COL.jobs, j.id, (cur) => (cur && cur.status === "queued" ? { ...cur, status, updatedAt: nowIso() } : undefined));
  }
}

async function requeueWaiting(status: "waiting_network") {
  const jobs = await getStore().list<StudioJob & Record<string, unknown>>(COL.jobs, { where: [["status", status]] });
  for (const j of jobs) {
    await getStore().transact<StudioJob & Record<string, unknown>>(COL.jobs, j.id, (cur) => (cur && cur.status === status ? { ...cur, status: "queued", nextRunAt: undefined, updatedAt: nowIso() } : undefined));
  }
}

async function msUntilNextWake(): Promise<number> {
  const jobs = await getStore().list<StudioJob & Record<string, unknown>>(COL.jobs);
  const next = jobs
    .filter((j) => RUNNABLE.includes(j.status) && j.nextRunAt)
    .map((j) => Date.parse(j.nextRunAt!))
    .sort((a, b) => a - b)[0];
  return next ? Math.max(5_000, next - Date.now()) : 60_000;
}

async function reportShortfall(dayId: string, reason: string) {
  const day = await getDay(dayId);
  if (day.shortfallReason === reason) return;
  await patchDay(dayId, { shortfallReason: reason });
  await notify({ kind: "info", level: "warning", title: "Daily target may not be reached", body: reason, href: "/admin/automation" }, { dedupeKey: `shortfall-${dayId}` });
}
