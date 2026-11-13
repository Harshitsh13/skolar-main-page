"use client";

import Link from "next/link";
import { ActiveJobCard } from "./LiveJob";
import { Badge, Card, CardTitle, ErrorNote, Loading, PageHeader, fmtDateTime, nf, timeAgo, useApi } from "./kit";

interface OverviewData {
  status: { tone: "ok" | "idle" | "warn" | "error"; label: string; detail: string };
  worker: { online: boolean; state: string; message: string; heartbeatAt: string; platform: string } | null;
  store: { kind: string; reason: string };
  automation: { enabled: boolean; dailyTarget: number };
  today: { key: string; generated: number; target: number; shortfallReason: string | null };
  counts: { awaiting: number; needsReview: number; approved: number; scheduled: number; published: number; publishing: number; failedJobs: number; pausedJobs: number; waitingApi: number; waitingNet: number; runningJobs: number };
  activeJob: { id: string } | null;
  usage: { requests: number; inputTokens: number; outputTokens: number; failures: number; rateLimits: number; cost: number | null; currency: string | null };
  unreadNotifications: number;
  activity: Array<{ id: string; at: string; actor: string; message: string; refId?: string }>;
  nextScheduled: Array<{ id: string; title: string; at: string }>;
  timezone: string;
}

const TONE = {
  ok: { dot: "bg-emerald-400", ring: "ring-emerald-400/30" },
  idle: { dot: "bg-paper/50", ring: "ring-paper/20" },
  warn: { dot: "bg-gold-400", ring: "ring-gold-400/30" },
  error: { dot: "bg-red-400", ring: "ring-red-400/30" },
};

export function Overview() {
  const { data, error, loading, reload } = useApi<OverviewData>("overview", { refreshMs: 20_000 });
  if (loading && !data) return <Loading />;
  if (error && !data) return <ErrorNote error={error} onRetry={reload} />;
  if (!data) return null;
  const pct = data.today.target ? Math.min(100, Math.round((data.today.generated / data.today.target) * 100)) : 0;
  const tone = TONE[data.status.tone];

  return (
    <>
      <PageHeader title="Overview" subtitle="What's running, what needs you, and what's going live." />

      {/* Status hero */}
      <section className="grain relative overflow-hidden rounded-[24px] bg-navy-900 p-5 text-paper sm:p-8">
        <div className="relative grid gap-6 md:grid-cols-[1fr_auto] md:items-center">
          <div>
            <p className="flex items-center gap-2.5 text-[0.8rem] font-semibold uppercase tracking-[0.14em] text-paper/60">
              <span className={`h-2.5 w-2.5 rounded-full ${tone.dot} ring-4 ${tone.ring}`} />
              Automation
            </p>
            <p className="display mt-3 text-[2rem] leading-tight sm:text-[2.6rem]">{data.status.label}</p>
            <p className="mt-2 max-w-xl text-[0.92rem] text-paper/70">{data.status.detail}</p>
            {data.worker && <p className="mt-3 text-[0.75rem] text-paper/45">Worker heartbeat {timeAgo(data.worker.heartbeatAt)} · {data.worker.platform}</p>}
          </div>
          <div className="min-w-[13rem] rounded-2xl bg-paper/[0.06] p-5 ring-1 ring-paper/10">
            <p className="text-[0.78rem] text-paper/60">Drafts generated today</p>
            <p className="display mt-1 text-[2.6rem] leading-none">
              {data.today.generated}
              <span className="text-[1.3rem] text-paper/50"> / {data.today.target}</span>
            </p>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-paper/10">
              <div className="h-full rounded-full bg-gold-400 transition-all" style={{ width: `${pct}%` }} />
            </div>
            {data.today.shortfallReason && data.today.generated < data.today.target && <p className="mt-3 text-[0.75rem] leading-snug text-gold-300">{data.today.shortfallReason}</p>}
          </div>
        </div>
      </section>

      {data.activeJob && (
        <div className="mt-4">
          <ActiveJobCard id={data.activeJob.id} />
        </div>
      )}

      {data.store.kind === "local" && (
        <p className="mt-4 rounded-2xl bg-gold-100/70 px-4 py-3 text-[0.82rem] text-navy-900">
          <strong>Local mode.</strong> {data.store.reason}
        </p>
      )}

      {/* KPI tiles */}
      <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Tile href="/admin/review" label="Waiting for review" value={data.counts.awaiting} accent={data.counts.awaiting > 0} sub={data.counts.needsReview ? `${data.counts.needsReview} flagged` : undefined} />
        <Tile href="/admin/library?status=approved" label="Approved" value={data.counts.approved} sub="ready to schedule" />
        <Tile href="/admin/calendar" label="Scheduled" value={data.counts.scheduled} sub={data.counts.publishing ? `${data.counts.publishing} publishing now` : undefined} />
        <Tile href="/admin/library?status=published" label="Published" value={data.counts.published} />
        <Tile href="/admin/automation" label="In progress" value={data.counts.runningJobs} sub={data.counts.waitingApi || data.counts.waitingNet ? `${data.counts.waitingApi + data.counts.waitingNet} waiting` : undefined} />
        <Tile href="/admin/automation?filter=problems" label="Failed / paused" value={data.counts.failedJobs + data.counts.pausedJobs} warn={data.counts.failedJobs > 0} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <Card>
          <CardTitle action={<Link href="/admin/reports" className="text-[0.8rem] font-semibold text-gold-600">Reports →</Link>}>Recent activity</CardTitle>
          {data.activity.length === 0 ? (
            <p className="text-sm text-ink-faint">Nothing yet. Start by loading the Italy starter set under Countries & Universities, then switch automation on in Settings.</p>
          ) : (
            <ul className="divide-y divide-navy-900/[0.06]">
              {data.activity.map((a) => (
                <li key={a.id} className="flex items-start gap-3 py-2.5 text-[0.88rem]">
                  <Badge tone={a.actor === "worker" ? "blue" : a.actor === "admin" ? "gold" : "grey"}>{a.actor}</Badge>
                  <span className="min-w-0 flex-1 text-navy-900">{a.message}</span>
                  <span className="shrink-0 text-[0.75rem] text-ink-faint">{timeAgo(a.at)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <div className="flex flex-col gap-6">
          <Card>
            <CardTitle action={<Link href="/admin/calendar" className="text-[0.8rem] font-semibold text-gold-600">Calendar →</Link>}>Next up</CardTitle>
            {data.nextScheduled.length === 0 ? (
              <p className="text-sm text-ink-faint">Nothing scheduled.</p>
            ) : (
              <ul className="space-y-3">
                {data.nextScheduled.map((s) => (
                  <li key={s.id}>
                    <Link href={`/admin/articles/${s.id}`} className="block rounded-xl p-2 -m-2 hover:bg-stone/50">
                      <span className="block text-[0.75rem] font-semibold text-gold-600">{fmtDateTime(s.at, data.timezone)}</span>
                      <span className="block text-[0.9rem] text-navy-900">{s.title}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Card>
          <Card>
            <CardTitle action={<Link href="/admin/integrations" className="text-[0.8rem] font-semibold text-gold-600">Details →</Link>}>AI usage today</CardTitle>
            <dl className="grid grid-cols-2 gap-4 text-[0.85rem]">
              <Stat label="Requests" value={nf(data.usage.requests)} />
              <Stat label="Tokens (in / out)" value={`${nf(data.usage.inputTokens)} / ${nf(data.usage.outputTokens)}`} />
              <Stat label="Failed / rate-limited" value={`${data.usage.failures} / ${data.usage.rateLimits}`} />
              <Stat label="Estimated cost" value={data.usage.cost === null ? "Add pricing" : `${data.usage.cost.toFixed(2)} ${data.usage.currency ?? ""}`} />
            </dl>
          </Card>
        </div>
      </div>
    </>
  );
}

function Tile({ href, label, value, sub, accent, warn }: { href: string; label: string; value: number; sub?: string; accent?: boolean; warn?: boolean }) {
  return (
    <Link href={href} className={`group rounded-[18px] border p-4 transition-colors ${accent ? "border-gold-400 bg-gold-100/60" : warn ? "border-red-700/20 bg-red-50" : "border-navy-900/[0.07] bg-white hover:border-navy-900/20"}`}>
      <p className="text-[0.75rem] leading-tight text-ink-soft">{label}</p>
      <p className="display mt-2 text-[2rem] leading-none text-navy-900">{value}</p>
      {sub && <p className="mt-1.5 text-[0.72rem] text-ink-faint">{sub}</p>}
    </Link>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[0.72rem] text-ink-faint">{label}</dt>
      <dd className="mt-0.5 font-semibold text-navy-900">{value}</dd>
    </div>
  );
}
