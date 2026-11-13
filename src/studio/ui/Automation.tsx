"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ActiveJobCard } from "./LiveJob";
import { STRATEGIES, CATEGORY_KEYS } from "../core/strategies";
import type { CategoryKey, StudioTopic } from "../core/types";
import { api, Badge, Button, Card, CardTitle, Empty, ErrorNote, Field, Input, Loading, Modal, PageHeader, Select, Status, Toggle, fmtDateTime, timeAgo, useAction, useApi } from "./kit";

interface JobRow {
  id: string;
  topic: string;
  category: CategoryKey;
  origin: string;
  status: string;
  stage: string;
  progress: number;
  retryCount: number;
  maxRetries: number;
  nextRunAt?: string;
  lastError?: string;
  articleId?: string;
  createdAt: string;
  updatedAt: string;
  lastCheckpointAt?: string;
  active: boolean;
}

const catOptions = CATEGORY_KEYS.map((k) => ({ value: k, label: STRATEGIES[k].label }));

export function Automation() {
  const params = useSearchParams();
  const settings = useApi<{ settings: { automation: { enabled: boolean; dailyTarget: number; autoPickTopics: boolean } } }>("settings");
  const overview = useApi<{ today: { generated: number; target: number; shortfallReason: string | null }; status: { label: string; detail: string } }>("overview", { refreshMs: 20_000 });
  const jobs = useApi<{ items: JobRow[]; stageLabels: Record<string, string> }>("jobs", { refreshMs: 10_000 });
  const topics = useApi<{ items: StudioTopic[]; signalLabels: Record<string, string> }>("topics");
  const { busy, run } = useAction();
  const [newOpen, setNewOpen] = useState(false);
  const router = useRouter();
  useEffect(() => {
    const j = params.get("job");
    if (j) router.replace(`/admin/automation/jobs/${j}`);
  }, [params, router]);
  const [filter, setFilter] = useState<"all" | "active" | "problems">((params.get("filter") as "problems") ?? "active");

  const a = settings.data?.settings.automation;
  const saveAutomation = (patch: Record<string, unknown>) =>
    run("auto", async () => {
      await api("settings", { method: "PUT", body: { automation: patch } });
      await settings.reload();
      await overview.reload();
    }, "Saved");

  const jobAction = (id: string, action: string) =>
    run(`${id}-${action}`, async () => {
      await api(`jobs/${id}/${action}`, { method: "POST", body: {} });
      await jobs.reload();
    });

  const topicAction = (t: StudioTopic, action: "approve" | "dismiss" | "generate") =>
    run(`${t.id}-${action}`, async () => {
      if (action === "generate") await api(`topics/${t.id}/generate`, { method: "POST", body: {} });
      else await api(`topics/${t.id}`, { method: "PATCH", body: { status: action === "approve" ? "approved" : "dismissed" } });
      await Promise.all([topics.reload(), jobs.reload()]);
    }, action === "generate" ? "Research queued — the worker will pick it up" : undefined);

  const discover = () =>
    run("discover", async () => {
      const r = await api<{ added: StudioTopic[]; notes: string[] }>("topics/discover", { method: "POST", body: {} });
      await topics.reload();
      return r;
    }).then((r) => r && alertNotes(r));

  const [notes, setNotes] = useState<string[]>([]);
  const alertNotes = (r: { added: StudioTopic[]; notes: string[] }) => setNotes([`${r.added.length} new topic suggestion(s).`, ...r.notes]);

  const jobList = (jobs.data?.items ?? []).filter((j) =>
    filter === "all" ? true : filter === "active" ? j.active || Date.now() - Date.parse(j.updatedAt) < 86400_000 : ["failed", "paused", "needs_review", "waiting_api", "waiting_network"].includes(j.status),
  );
  const openTopics = (topics.data?.items ?? []).filter((t) => t.status === "suggested" || t.status === "approved");

  return (
    <>
      <PageHeader
        title="Blog Automation"
        subtitle="Topics are researched from official sources, written with citations, checked, and saved as drafts. Nothing is published without your approval."
        actions={
          <Button variant="primary" onClick={() => setNewOpen(true)}>
            Research a topic now
          </Button>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="flex min-w-0 flex-col gap-6">
          {(() => {
            const live = (jobs.data?.items ?? []).find((j) => j.status === "running") ?? (jobs.data?.items ?? []).find((j) => ["queued", "waiting_api", "waiting_network"].includes(j.status));
            return live ? <ActiveJobCard id={live.id} /> : null;
          })()}
          {/* Jobs */}
          <Card>
            <CardTitle
              action={
                <div className="flex gap-1 rounded-full bg-stone/60 p-1 text-[0.75rem]">
                  {(["active", "problems", "all"] as const).map((f) => (
                    <button key={f} onClick={() => setFilter(f)} className={`rounded-full px-3 py-1.5 font-semibold ${filter === f ? "bg-white text-navy-900 shadow-sm" : "text-ink-soft"}`}>
                      {f === "active" ? "Current" : f === "problems" ? "Problems" : "All"}
                    </button>
                  ))}
                </div>
              }
            >
              Research jobs
            </CardTitle>
            {jobs.error && <ErrorNote error={jobs.error} onRetry={jobs.reload} />}
            {!jobs.data ? (
              <Loading />
            ) : jobList.length === 0 ? (
              <Empty title="No jobs here">Approve a topic, or click “Research a topic now”. Jobs run in the background worker.</Empty>
            ) : (
              <ul className="divide-y divide-navy-900/[0.06]">
                {jobList.map((j) => (
                  <li key={j.id} className="py-3.5">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <button onClick={() => router.push(`/admin/automation/jobs/${j.id}`)} className="min-w-0 text-left">
                        <p className="text-[0.92rem] font-semibold leading-snug text-navy-900">{j.topic}</p>
                        <p className="mt-1 flex flex-wrap items-center gap-2 text-[0.75rem] text-ink-faint">
                          <Status value={j.status} />
                          <span>{STRATEGIES[j.category]?.short}</span>
                          <span>· {jobs.data!.stageLabels[j.stage] ?? j.stage}</span>
                          {j.nextRunAt && ["waiting_api", "waiting_network", "queued"].includes(j.status) && <span>· resumes {timeAgo(j.nextRunAt)}</span>}
                          {j.retryCount > 0 && <span>· retry {j.retryCount}/{j.maxRetries}</span>}
                        </p>
                      </button>
                      <div className="flex shrink-0 flex-wrap gap-1.5">
                        {j.articleId && ["completed", "needs_review"].includes(j.status) && (
                          <Link href={`/admin/articles/${j.articleId}`} className="inline-flex min-h-9 items-center rounded-full bg-navy-900 px-3.5 text-[0.8rem] font-semibold text-paper">
                            Open draft
                          </Link>
                        )}
                        {["queued", "running", "waiting_api", "waiting_network"].includes(j.status) && (
                          <Button size="sm" busy={busy === `${j.id}-pause`} onClick={() => jobAction(j.id, "pause")}>Pause</Button>
                        )}
                        {j.status === "paused" && <Button size="sm" busy={busy === `${j.id}-resume`} onClick={() => jobAction(j.id, "resume")}>Resume</Button>}
                        {["failed", "needs_review", "waiting_api", "waiting_network"].includes(j.status) && !j.articleId && (
                          <Button size="sm" busy={busy === `${j.id}-retry`} onClick={() => jobAction(j.id, "retry")}>Retry</Button>
                        )}
                        {j.active && (
                          <Button size="sm" variant="subtle" busy={busy === `${j.id}-cancel`} onClick={() => confirm("Cancel this job? Completed stages are kept for reference.") && jobAction(j.id, "cancel")}>
                            Cancel
                          </Button>
                        )}
                      </div>
                    </div>
                    <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-stone">
                      <div className={`h-full rounded-full ${j.status === "failed" ? "bg-red-500" : "bg-gold-500"}`} style={{ width: `${j.progress}%` }} />
                    </div>
                    {j.lastError && j.status !== "completed" && <p className="mt-2 text-[0.78rem] leading-snug text-red-700">{j.lastError}</p>}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {/* Topics */}
          <Card>
            <CardTitle
              action={
                <Button size="sm" busy={busy === "discover"} onClick={discover}>
                  Find new topics
                </Button>
              }
            >
              Topic queue
            </CardTitle>
            {notes.length > 0 && (
              <ul className="mb-4 rounded-xl bg-stone/50 p-3 text-[0.8rem] text-ink-soft">
                {notes.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            )}
            {!topics.data ? (
              <Loading />
            ) : openTopics.length === 0 ? (
              <Empty title="No topics waiting">Use “Find new topics”. Ideas come from your registry, common student questions, official source changes, web search (if configured) and search suggestions (if enabled). Each idea shows its source and date. Google Trends is not connected (official API access pending).</Empty>
            ) : (
              <ul className="divide-y divide-navy-900/[0.06]">
                {openTopics.map((t) => (
                  <li key={t.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <p className="text-[0.9rem] font-medium leading-snug text-navy-900">{t.title}</p>
                      <p className="mt-1 flex flex-wrap items-center gap-2 text-[0.73rem] text-ink-faint">
                        {t.status === "approved" ? <Badge tone="green">Approved</Badge> : <Badge>Suggested</Badge>}
                        <span>{STRATEGIES[t.category]?.short}</span>

                        {t.relevance && <Badge tone={t.relevance.score >= 75 ? "green" : t.relevance.score >= 50 ? "gold" : "grey"}>Relevance {t.relevance.score}</Badge>}
                      </p>
                      {t.relevance?.reason && <p className="mt-1 text-[0.75rem] leading-snug text-ink-soft">{t.relevance.reason}</p>}
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {(t.signals ?? []).slice(0, 4).map((sg, i) => (
                          <span key={i} title={`${sg.detail}${sg.url ? ` — ${sg.url}` : ""}`} className="rounded-full bg-stone/60 px-2 py-0.5 text-[0.68rem] text-ink-soft">
                            {topics.data?.signalLabels?.[sg.kind] ?? sg.kind} · {sg.source} · {new Date(sg.collectedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                          </span>
                        ))}
                      </div>
                    </div>
                    <div className="flex shrink-0 gap-1.5">
                      {t.status === "suggested" && <Button size="sm" busy={busy === `${t.id}-approve`} onClick={() => topicAction(t, "approve")}>Approve</Button>}
                      <Button size="sm" variant="primary" busy={busy === `${t.id}-generate`} onClick={() => topicAction(t, "generate")}>Research now</Button>
                      <Button size="sm" variant="subtle" busy={busy === `${t.id}-dismiss`} onClick={() => topicAction(t, "dismiss")} aria-label="Dismiss">✕</Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        {/* Side: automation controls */}
        <div className="flex flex-col gap-6">
          <Card>
            <CardTitle>Daily automation</CardTitle>
            {!a ? (
              <Loading />
            ) : (
              <div className="space-y-4">
                <Toggle checked={a.enabled} onChange={(v) => saveAutomation({ enabled: v })} label="Automation" hint={a.enabled ? "The worker researches and drafts in the background." : "Off — no new research starts."} disabled={busy === "auto"} />
                <Toggle checked={a.autoPickTopics} onChange={(v) => saveAutomation({ autoPickTopics: v })} label="Pick topics automatically" hint="Off = only topics you approve are researched." disabled={busy === "auto"} />
                <div>
                  <p className="text-[0.9rem] font-semibold text-navy-900">Daily target</p>
                  <div className="mt-2 flex items-center gap-2">
                    <Button size="sm" onClick={() => saveAutomation({ dailyTarget: Math.max(0, a.dailyTarget - 1) })} aria-label="Decrease">−</Button>
                    <span className="display w-12 text-center text-[1.8rem] text-navy-900">{a.dailyTarget}</span>
                    <Button size="sm" onClick={() => saveAutomation({ dailyTarget: Math.min(20, a.dailyTarget + 1) })} aria-label="Increase">+</Button>
                    <span className="text-[0.8rem] text-ink-faint">quality drafts per day</span>
                  </div>
                </div>
                {overview.data && (
                  <p className="rounded-xl bg-stone/50 p-3 text-[0.8rem] text-ink-soft">
                    Today: <strong className="text-navy-900">{overview.data.today.generated}/{overview.data.today.target}</strong> drafts. {overview.data.status.label}.
                    {overview.data.today.shortfallReason && overview.data.today.generated < overview.data.today.target && <span className="mt-1 block text-gold-600">{overview.data.today.shortfallReason}</span>}
                  </p>
                )}
              </div>
            )}
          </Card>
          <Card>
            <CardTitle>How a draft is made</CardTitle>
            <ol className="space-y-2 text-[0.82rem] leading-snug text-ink-soft">
              <li><strong className="text-navy-900">1. Plan</strong> — search intent, duplicate check, academic year.</li>
              <li><strong className="text-navy-900">2. Research</strong> — official sources from your registry (and search, if set up) are opened and read.</li>
              <li><strong className="text-navy-900">3. Facts</strong> — each fact must quote the page verbatim; unverifiable ones are discarded.</li>
              <li><strong className="text-navy-900">4. Write</strong> — section by section, citing facts only.</li>
              <li><strong className="text-navy-900">5. Check</strong> — claim verification, safety rules and an editorial review.</li>
              <li><strong className="text-navy-900">6. Draft</strong> — saved for your review. Weak drafts are flagged, not counted.</li>
            </ol>
          </Card>
        </div>
      </div>

      <NewJobModal open={newOpen} onClose={() => setNewOpen(false)} onCreated={() => void jobs.reload()} />

    </>
  );
}

function NewJobModal({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const [topic, setTopic] = useState("");
  const [category, setCategory] = useState<CategoryKey>("university_guide");
  const [dup, setDup] = useState<{ title: string; similarity: number } | null>(null);
  const { busy, run } = useAction();
  const submit = (allowDuplicate = false) =>
    run(
      "create",
      async () => {
        const r = await api<{ job?: unknown; duplicate?: { title: string; similarity: number } }>("jobs", { body: { topic, category, allowDuplicate } });
        if (r.duplicate) {
          setDup(r.duplicate);
          return;
        }
        setTopic("");
        setDup(null);
        onCreated();
        onClose();
      },
    );
  return (
    <Modal open={open} onClose={onClose} title="Research a topic">
      <div className="space-y-4">
        <Field label="Topic" hint="Be specific, e.g. “University of Messina vs University of Palermo for engineering”.">
          <Input value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="What should the article answer?" />
        </Field>
        <Field label="Type of article" hint={STRATEGIES[category].description}>
          <Select value={category} onChange={(e) => setCategory(e.target.value as CategoryKey)} options={catOptions} />
        </Field>
        {dup && (
          <div className="rounded-xl bg-gold-100 p-3 text-[0.85rem] text-navy-900">
            Similar content already exists: <strong>{dup.title}</strong> ({Math.round(dup.similarity * 100)}% similar).
            <div className="mt-2 flex gap-2">
              <Button size="sm" variant="primary" busy={busy === "create"} onClick={() => submit(true)}>Research anyway</Button>
              <Button size="sm" onClick={() => setDup(null)}>Change topic</Button>
            </div>
          </div>
        )}
        <Button variant="primary" className="w-full" disabled={topic.trim().length < 5} busy={busy === "create"} onClick={() => submit(false)}>
          Queue research
        </Button>
        <p className="text-center text-[0.75rem] text-ink-faint">The background worker runs it. Progress is saved after every stage.</p>
      </div>
    </Modal>
  );
}
