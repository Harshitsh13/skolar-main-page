"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { STRATEGIES } from "../core/strategies";
import { api, Badge, Button, Card, CardTitle, ErrorNote, Loading, Status, fmtDateTime, timeAgo, useAction } from "./kit";

export interface LiveData {
  job: {
    id: string;
    topic: string;
    category: keyof typeof STRATEGIES;
    origin: string;
    status: string;
    stage: string;
    progress: number;
    completed: number;
    total: number;
    activity: { stage: string; message: string; at: string } | null;
    retryCount: number;
    maxRetries: number;
    nextRunAt: string | null;
    lastError: string | null;
    articleId: string | null;
    createdAt: string;
    startedAt: string | null;
    updatedAt: string;
    finishedAt: string | null;
    lease: { owner: string; until: string } | null;
    calls: string[];
  };
  stages: Array<{ key: string; label: string; status: string; startedAt: string | null; completedAt: string | null; failedAt: string | null; attempts: number }>;
  sources: { candidates: Array<{ url: string; title: string; type: string; why: string }>; read: Array<{ url: string; title: string; ok: boolean; error?: string }>; queued: Array<{ url: string; title: string }> };
  research: { intent: string | null; academicYear: string | null; questions: string[]; gaps: string[]; conflicts: string[] };
  image: { concept: string | null; format: string | null; url: string | null; failed: string | null };
  events: Array<{ id: string; at: string; type: string; stage?: string; message: string; worker?: string }>;
  etaMinutes: number | null;
}

/**
 * Live job state: Server-Sent Events from /api/studio/jobs/:id/stream, falling
 * back to polling if the stream is unavailable. Everything shown comes from
 * persisted job checkpoints and events, so a refresh or a worker restart shows
 * the same real state.
 */
export function useLiveJob(id: string | null) {
  const [data, setData] = useState<LiveData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [transport, setTransport] = useState<"stream" | "polling" | "connecting">("connecting");
  const failures = useRef(0);

  useEffect(() => {
    if (!id) return;
    let closed = false;
    let es: EventSource | null = null;
    let poll: ReturnType<typeof setInterval> | null = null;

    const startPolling = () => {
      setTransport("polling");
      const tick = async () => {
        try {
          setData(await api<LiveData>(`jobs/${id}/live`));
          setError(null);
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
        }
      };
      void tick();
      poll = setInterval(() => document.visibilityState === "visible" && void tick(), 3000);
    };

    const connect = () => {
      if (closed || typeof EventSource === "undefined") return startPolling();
      es = new EventSource(`/api/studio/jobs/${id}/stream`);
      es.onmessage = (ev) => {
        failures.current = 0;
        setTransport("stream");
        try {
          setData(JSON.parse(ev.data) as LiveData);
          setError(null);
        } catch {
          /* ignore malformed frame */
        }
      };
      es.onerror = () => {
        es?.close();
        failures.current += 1;
        if (closed) return;
        // The server closes streams every ~55 s; reconnect, but fall back to polling if it keeps failing.
        if (failures.current >= 3) startPolling();
        else setTimeout(connect, 1500);
      };
    };
    connect();
    return () => {
      closed = true;
      es?.close();
      if (poll) clearInterval(poll);
    };
  }, [id]);

  return { data, error, transport, setData };
}

const STAGE_ICON: Record<string, string> = { done: "✓", running: "●", waiting: "⏸", paused: "⏸", failed: "✕", retrying: "↻", next: "→", pending: "" };
const STAGE_STYLE: Record<string, string> = {
  done: "bg-emerald-50 text-emerald-800 ring-emerald-700/15",
  running: "bg-gold-100 text-navy-900 ring-gold-500/40 font-semibold",
  waiting: "bg-sky-50 text-sky-900 ring-sky-700/20",
  paused: "bg-stone text-ink-soft ring-navy-900/10",
  failed: "bg-red-50 text-red-800 ring-red-700/20 font-semibold",
  retrying: "bg-orange-50 text-orange-900 ring-orange-700/20",
  next: "bg-white text-navy-900 ring-navy-900/15",
  pending: "bg-white/60 text-ink-faint ring-navy-900/5",
};

const dur = (a: string | null, b: string | null) => {
  if (!a || !b) return null;
  const s = Math.round((Date.parse(b) - Date.parse(a)) / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
};

export function LiveJobView({ id }: { id: string }) {
  const { data, error, transport } = useLiveJob(id);
  const { busy, run } = useAction();
  const control = (action: string) => run(action, () => api(`jobs/${id}/${action}`, { body: {} }));

  if (error && !data) return <ErrorNote error={error} />;
  if (!data) return <Loading label="Connecting to the job…" />;
  const j = data.job;
  const active = ["queued", "running", "waiting_api", "waiting_network"].includes(j.status);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2 text-[0.82rem] text-ink-faint">
        <Link href="/admin/automation" className="hover:text-navy-900">← Blog Automation</Link>
        <span>·</span>
        <Status value={j.status} />
        <Badge>{STRATEGIES[j.category]?.label ?? j.category}</Badge>
        <span className="inline-flex items-center gap-1.5">
          <span className={`h-2 w-2 rounded-full ${transport === "stream" ? "bg-emerald-500" : transport === "polling" ? "bg-gold-500" : "bg-stone-dark"}`} />
          {transport === "stream" ? "Live" : transport === "polling" ? "Live (polling)" : "Connecting"}
        </span>
      </div>
      <h1 className="display text-[1.9rem] leading-tight text-navy-900 sm:text-[2.4rem]">{j.topic}</h1>

      {/* Now */}
      <section className="rounded-[22px] bg-navy-900 p-5 text-paper sm:p-6">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[0.75rem] font-semibold uppercase tracking-[0.14em] text-paper/55">
              {active ? "Now" : j.status === "completed" ? "Finished" : "Stopped"} · stage {Math.min(j.completed + 1, j.total)} of {j.total}
            </p>
            <p className="mt-2 text-[1.15rem] font-semibold leading-snug">{data.stages.find((s) => s.key === j.stage)?.label}</p>
            <p className="mt-1 break-words text-[0.9rem] text-paper/75">{j.activity?.message ?? "—"}</p>
            {j.activity?.at && <p className="mt-1 text-[0.72rem] text-paper/45">last activity {timeAgo(j.activity.at)}{j.lease ? ` · worker ${j.lease.owner}` : ""}</p>}
          </div>
          <div className="text-right">
            <p className="display text-[2.4rem] leading-none">{j.progress}%</p>
            <p className="text-[0.72rem] text-paper/50">{j.completed}/{j.total} stages complete</p>
            {data.etaMinutes !== null && <p className="mt-1 text-[0.72rem] text-gold-300">≈ {data.etaMinutes} min left (average of recent jobs)</p>}
          </div>
        </div>
        <div className="mt-4 h-2 overflow-hidden rounded-full bg-paper/10">
          <div className="h-full rounded-full bg-gold-400 transition-all duration-700" style={{ width: `${j.progress}%` }} />
        </div>
        {(j.lastError || j.nextRunAt) && j.status !== "completed" && (
          <p className="mt-3 rounded-xl bg-paper/10 p-3 text-[0.82rem] text-paper/85">
            {j.lastError && <span className="block">Last error: {j.lastError}</span>}
            {j.nextRunAt && <span className="block">Resumes {timeAgo(j.nextRunAt)} ({fmtDateTime(j.nextRunAt)}) · retry {j.retryCount}/{j.maxRetries}</span>}
          </p>
        )}
        <div className="mt-4 flex flex-wrap gap-2">
          {["queued", "running", "waiting_api", "waiting_network"].includes(j.status) && <Button size="sm" className="!bg-paper !text-navy-900" busy={busy === "pause"} onClick={() => control("pause")}>Pause</Button>}
          {j.status === "paused" && <Button size="sm" className="!bg-paper !text-navy-900" busy={busy === "resume"} onClick={() => control("resume")}>Resume</Button>}
          {["failed", "needs_review", "waiting_api", "waiting_network"].includes(j.status) && !j.articleId && <Button size="sm" className="!bg-paper !text-navy-900" busy={busy === "retry"} onClick={() => control("retry")}>Retry from failed stage</Button>}
          {j.articleId && ["completed", "needs_review"].includes(j.status) && <Link href={`/admin/articles/${j.articleId}`} className="btn btn-gold !min-h-9 !px-4 text-[0.82rem]">Open draft</Link>}
        </div>
      </section>

      <div className="grid gap-6 xl:grid-cols-[1fr_24rem]">
        <div className="space-y-6">
          <Card>
            <CardTitle>Pipeline</CardTitle>
            <ol className="grid gap-1.5 sm:grid-cols-2">
              {data.stages.map((s, i) => (
                <li key={s.key} className={`flex items-center justify-between gap-2 rounded-xl px-3 py-2 text-[0.8rem] ring-1 ${STAGE_STYLE[s.status]}`}>
                  <span className="min-w-0">
                    <span className="mr-1.5 inline-block w-4 text-center">{STAGE_ICON[s.status] || i + 1}</span>
                    {s.label}
                    {s.attempts > 1 && <span className="ml-1 text-[0.7rem] opacity-70">({s.attempts} attempts)</span>}
                  </span>
                  <span className="shrink-0 text-[0.7rem] opacity-70">{s.completedAt ? dur(s.startedAt, s.completedAt) : s.status === "running" && s.startedAt ? timeAgo(s.startedAt).replace(" ago", "") : ""}</span>
                </li>
              ))}
            </ol>
          </Card>

          <Card>
            <CardTitle>Sources being researched</CardTitle>
            {data.sources.read.length === 0 && data.sources.candidates.length === 0 ? (
              <p className="text-sm text-ink-faint">Source discovery has not run yet.</p>
            ) : (
              <ul className="space-y-1.5 text-[0.8rem]">
                {data.sources.read.map((p) => (
                  <li key={p.url} className="flex gap-2">
                    <span className={p.ok ? "text-emerald-700" : "text-red-700"}>{p.ok ? "✓" : "✕"}</span>
                    <span className="min-w-0">
                      <a href={p.url} target="_blank" rel="noopener noreferrer" className="break-all text-navy-900 underline decoration-navy-900/20">{p.title || p.url}</a>
                      {p.error && <span className="block text-ink-faint">{p.error}</span>}
                    </span>
                  </li>
                ))}
                {data.sources.queued.map((p) => (
                  <li key={p.url} className="flex gap-2 text-ink-faint">
                    <span>…</span>
                    <span className="break-all">{p.url} (queued)</span>
                  </li>
                ))}
                {data.sources.read.length === 0 &&
                  data.sources.candidates.map((p) => (
                    <li key={p.url} className="text-ink-soft">→ {p.url} <span className="text-ink-faint">({p.why})</span></li>
                  ))}
              </ul>
            )}
          </Card>

          <Card>
            <CardTitle>Activity history</CardTitle>
            <ul className="max-h-[28rem] space-y-1 overflow-y-auto font-mono text-[0.72rem]">
              {[...data.events].reverse().map((e) => (
                <li key={e.id} className={e.type === "job_failed" || e.type === "stage_failed" ? "text-red-700" : e.type === "stage_completed" || e.type === "job_completed" ? "text-emerald-800" : e.type === "waiting" || e.type === "retry_scheduled" ? "text-gold-600" : "text-ink-soft"}>
                  {fmtDateTime(e.at)} · {e.stage ? `${e.stage} · ` : ""}{e.message}
                </li>
              ))}
            </ul>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <CardTitle>Research</CardTitle>
            {data.research.intent ? <p className="text-[0.85rem] text-ink-soft"><strong className="text-navy-900">Intent:</strong> {data.research.intent}</p> : <p className="text-sm text-ink-faint">Not planned yet.</p>}
            {data.research.academicYear && <p className="mt-2"><Badge tone="gold">{data.research.academicYear}</Badge></p>}
            {data.research.conflicts.length > 0 && <div className="mt-3 rounded-xl bg-red-50 p-3 text-[0.75rem] text-red-800"><p className="font-semibold">Conflicts</p>{data.research.conflicts.map((c, i) => <p key={i}>• {c}</p>)}</div>}
            {data.research.gaps.length > 0 && <div className="mt-3 rounded-xl bg-stone/50 p-3 text-[0.75rem] text-ink-soft"><p className="font-semibold text-navy-900">Not found in sources</p>{data.research.gaps.slice(0, 6).map((c, i) => <p key={i}>• {c}</p>)}</div>}
          </Card>
          <Card>
            <CardTitle>Image</CardTitle>
            {data.image.url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={data.image.url} alt="" className="aspect-[4/3] w-full rounded-xl object-cover" />
            ) : data.image.failed ? (
              <p className="text-[0.82rem] text-red-700">{data.image.failed}</p>
            ) : (
              <p className="text-sm text-ink-faint">{data.image.concept ? "Generating…" : "Not started yet."}</p>
            )}
            {data.image.concept && <p className="mt-2 text-[0.75rem] text-ink-soft">{data.image.concept}</p>}
          </Card>
          <Card>
            <CardTitle>Timing</CardTitle>
            <dl className="space-y-1 text-[0.8rem]">
              <div className="flex justify-between"><dt className="text-ink-faint">Created</dt><dd>{fmtDateTime(j.createdAt)}</dd></div>
              <div className="flex justify-between"><dt className="text-ink-faint">Started</dt><dd>{fmtDateTime(j.startedAt)}</dd></div>
              <div className="flex justify-between"><dt className="text-ink-faint">Last activity</dt><dd>{fmtDateTime(j.updatedAt)}</dd></div>
              {j.finishedAt && <div className="flex justify-between"><dt className="text-ink-faint">Finished</dt><dd>{fmtDateTime(j.finishedAt)}</dd></div>}
            </dl>
            {j.calls.length > 0 && <p className="mt-3 text-[0.72rem] text-ink-faint">AI used: {j.calls.join(", ")}</p>}
          </Card>
        </div>
      </div>
    </div>
  );
}

/** Compact live card for the Automation page and Overview. */
export function ActiveJobCard({ id }: { id: string }) {
  const { data } = useLiveJob(id);
  if (!data) return null;
  const j = data.job;
  return (
    <Link href={`/admin/automation/jobs/${id}`} className="block rounded-[20px] bg-navy-900 p-5 text-paper transition-colors hover:bg-navy-800">
      <p className="flex items-center gap-2 text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-paper/55">
        <span className="h-2 w-2 animate-pulse rounded-full bg-gold-400" /> Live · {data.stages.find((s) => s.key === j.stage)?.label}
      </p>
      <p className="mt-2 font-semibold leading-snug">{j.topic}</p>
      <p className="mt-1 truncate text-[0.82rem] text-paper/70">{j.activity?.message}</p>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-paper/10">
        <div className="h-full rounded-full bg-gold-400 transition-all duration-700" style={{ width: `${j.progress}%` }} />
      </div>
      <p className="mt-2 text-[0.72rem] text-paper/50">{j.completed}/{j.total} stages · open live view →</p>
    </Link>
  );
}
