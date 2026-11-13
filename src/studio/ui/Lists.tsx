"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { CATEGORY_KEYS, STRATEGIES } from "../core/strategies";
import type { CategoryKey } from "../core/types";
import { api, Badge, Button, Card, CardTitle, Empty, ErrorNote, Field, Input, Loading, PageHeader, Select, Status, fmtDate, fmtDateTime, timeAgo, useAction, useApi } from "./kit";

export interface ArticleRow {
  id: string;
  title: string;
  slug: string;
  excerpt: string;
  category: CategoryKey;
  countryId: string;
  universityIds: string[];
  scholarshipIds: string[];
  status: string;
  origin: "ai" | "manual";
  academicYear?: string;
  coverImage: string | null;
  readingMinutes: number;
  warnings: number;
  warningsTotal: number;
  claims: { total: number; verified: number; flagged: number };
  sources: number;
  qualityPassed: boolean | null;
  scheduleAt: string | null;
  publishedAt: string | null;
  publishState: string | null;
  createdAt: string;
  updatedAt: string;
}

function ArticleCard({ a, tz }: { a: ArticleRow; tz?: string }) {
  return (
    <Link href={`/admin/articles/${a.id}`} className="group flex gap-4 rounded-[18px] border border-navy-900/[0.07] bg-white p-3 transition-colors hover:border-navy-900/20 sm:p-4">
      <div className="hidden h-20 w-28 shrink-0 overflow-hidden rounded-xl bg-stone sm:block">
        {a.coverImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={a.coverImage} alt="" className="h-full w-full object-cover" loading="lazy" />
        ) : (
          <div className="grid h-full place-items-center text-[0.65rem] text-ink-faint">No image</div>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <Status value={a.status} />
          <Badge>{STRATEGIES[a.category]?.short ?? a.category}</Badge>
          {a.academicYear && <Badge tone="gold">{a.academicYear}</Badge>}
          {a.warnings > 0 && <Badge tone="red">{a.warnings} must-fix</Badge>}
        </div>
        <p className="mt-1.5 text-[0.95rem] font-semibold leading-snug text-navy-900 group-hover:underline">{a.title}</p>
        <p className="mt-1 text-[0.75rem] text-ink-faint">
          {a.origin === "ai" ? "AI research" : "Manual"} · {a.sources} sources
          {a.claims.total > 0 && ` · ${a.claims.verified}/${a.claims.total} claims verified`}
          {a.scheduleAt ? ` · goes live ${fmtDateTime(a.scheduleAt, tz)}` : a.publishedAt ? ` · published ${fmtDate(a.publishedAt, tz)}` : ` · updated ${timeAgo(a.updatedAt)}`}
        </p>
      </div>
    </Link>
  );
}

/* ═════════════════════════ Review queue ═════════════════════════ */

export function ReviewQueue() {
  const { data, error, reload } = useApi<{ items: ArticleRow[] }>("articles", { refreshMs: 30_000 });
  if (error && !data) return <ErrorNote error={error} onRetry={reload} />;
  if (!data) return <Loading />;
  const ready = data.items.filter((a) => a.status === "draft");
  const flagged = data.items.filter((a) => a.status === "needs_review");
  const approved = data.items.filter((a) => a.status === "approved");
  return (
    <>
      <PageHeader title="Review Queue" subtitle="Every article is reviewed here before it can be scheduled or published." actions={<Link href="/admin/write" className="btn btn-navy !min-h-11 text-[0.9rem]">Write article</Link>} />
      {ready.length + flagged.length + approved.length === 0 ? (
        <Empty title="Nothing to review">New drafts appear here as the worker finishes them.</Empty>
      ) : (
        <div className="space-y-8">
          {ready.length > 0 && (
            <section>
              <h2 className="mb-3 text-[0.85rem] font-semibold text-navy-900">Ready for review ({ready.length})</h2>
              <div className="grid gap-3">{ready.map((a) => <ArticleCard key={a.id} a={a} />)}</div>
            </section>
          )}
          {flagged.length > 0 && (
            <section>
              <h2 className="mb-1 text-[0.85rem] font-semibold text-navy-900">Needs extra review ({flagged.length})</h2>
              <p className="mb-3 text-[0.78rem] text-ink-faint">Did not pass the automatic quality check — fix the flagged issues or reject.</p>
              <div className="grid gap-3">{flagged.map((a) => <ArticleCard key={a.id} a={a} />)}</div>
            </section>
          )}
          {approved.length > 0 && (
            <section>
              <h2 className="mb-3 text-[0.85rem] font-semibold text-navy-900">Approved — not yet scheduled ({approved.length})</h2>
              <div className="grid gap-3">{approved.map((a) => <ArticleCard key={a.id} a={a} />)}</div>
            </section>
          )}
        </div>
      )}
    </>
  );
}

/* ═════════════════════════ Content library ═════════════════════════ */

const STATUSES = ["researching", "draft", "needs_review", "approved", "scheduled", "published", "rejected", "failed"];

export function Library() {
  const params = useSearchParams();
  const { data, error, reload } = useApi<{ items: ArticleRow[] }>("articles");
  const meta = useApi<{ countries: Array<{ id: string; name: string }>; universities: Array<{ id: string; name: string }>; scholarships: Array<{ id: string; name: string }> }>("meta");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState(params.get("status") ?? "");
  const [category, setCategory] = useState("");
  const [country, setCountry] = useState("");
  const [uni, setUni] = useState("");
  const [sch, setSch] = useState("");
  const [origin, setOrigin] = useState("");
  const [sort, setSort] = useState("updated");

  const items = useMemo(() => {
    const list = (data?.items ?? []).filter(
      (a) =>
        (!q || `${a.title} ${a.excerpt} ${a.slug}`.toLowerCase().includes(q.toLowerCase())) &&
        (!status || a.status === status) &&
        (!category || a.category === category) &&
        (!country || a.countryId === country) &&
        (!uni || a.universityIds.includes(uni)) &&
        (!sch || a.scholarshipIds.includes(sch)) &&
        (!origin || a.origin === origin),
    );
    return list.sort((a, b) =>
      sort === "published" ? (b.publishedAt ?? "").localeCompare(a.publishedAt ?? "") : sort === "created" ? b.createdAt.localeCompare(a.createdAt) : b.updatedAt.localeCompare(a.updatedAt),
    );
  }, [data, q, status, category, country, uni, sch, origin, sort]);

  if (error && !data) return <ErrorNote error={error} onRetry={reload} />;
  return (
    <>
      <PageHeader title="Content Library" subtitle="Every article — AI-researched and manual — in one place." actions={<Link href="/admin/write" className="btn btn-navy !min-h-11 text-[0.9rem]">Write article</Link>} />
      <Card className="mb-5">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Input placeholder="Search titles…" value={q} onChange={(e) => setQ(e.target.value)} className="sm:col-span-2" aria-label="Search" />
          <Select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} options={[{ value: "", label: "All statuses" }, ...STATUSES.map((s) => ({ value: s, label: s.replace("_", " ").replace(/^\w/, (c) => c.toUpperCase()) }))]} />
          <Select aria-label="Category" value={category} onChange={(e) => setCategory(e.target.value)} options={[{ value: "", label: "All categories" }, ...CATEGORY_KEYS.map((k) => ({ value: k, label: STRATEGIES[k].label }))]} />
          <Select aria-label="Country" value={country} onChange={(e) => setCountry(e.target.value)} options={[{ value: "", label: "All countries" }, ...(meta.data?.countries ?? []).map((c) => ({ value: c.id, label: c.name }))]} />
          <Select aria-label="University" value={uni} onChange={(e) => setUni(e.target.value)} options={[{ value: "", label: "All universities" }, ...(meta.data?.universities ?? []).map((c) => ({ value: c.id, label: c.name }))]} />
          <Select aria-label="Scholarship" value={sch} onChange={(e) => setSch(e.target.value)} options={[{ value: "", label: "All scholarships" }, ...(meta.data?.scholarships ?? []).map((c) => ({ value: c.id, label: c.name }))]} />
          <div className="grid grid-cols-2 gap-3">
            <Select aria-label="Creation method" value={origin} onChange={(e) => setOrigin(e.target.value)} options={[{ value: "", label: "AI + manual" }, { value: "ai", label: "AI research" }, { value: "manual", label: "Manual" }]} />
            <Select aria-label="Sort" value={sort} onChange={(e) => setSort(e.target.value)} options={[{ value: "updated", label: "Last updated" }, { value: "created", label: "Created" }, { value: "published", label: "Publication date" }]} />
          </div>
        </div>
      </Card>
      {!data ? <Loading /> : items.length === 0 ? <Empty title="No articles match" /> : <div className="grid gap-3">{items.map((a) => <ArticleCard key={a.id} a={a} />)}</div>}
    </>
  );
}

/* ═════════════════════════ Write article ═════════════════════════ */

export function WriteArticle() {
  const router = useRouter();
  const meta = useApi<{ countries: Array<{ id: string; name: string }>; universities: Array<{ id: string; name: string; countryId: string }>; scholarships: Array<{ id: string; name: string; countryId: string }> }>("meta");
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState<CategoryKey>("practical");
  const [countryId, setCountryId] = useState("it");
  const [universityId, setUniversityId] = useState("");
  const [scholarshipId, setScholarshipId] = useState("");
  const [dups, setDups] = useState<Array<{ title: string; similarity: number; status: string }> | null>(null);
  const { busy, run } = useAction();

  const create = (allowDuplicate = false) =>
    run("create", async () => {
      const r = await api<{ item?: { id: string }; duplicate?: Array<{ title: string; similarity: number; status: string }> }>("articles", {
        body: { title, category, countryId, universityIds: universityId ? [universityId] : [], scholarshipIds: scholarshipId ? [scholarshipId] : [], allowDuplicate },
      });
      if (r.duplicate) return setDups(r.duplicate);
      router.push(`/admin/articles/${r.item!.id}`);
    });

  return (
    <>
      <PageHeader title="Write an article" subtitle="Manual articles go through the same checks, review and publishing as AI drafts." />
      <Card className="max-w-2xl">
        <div className="space-y-4">
          <Field label="Title"><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Opening a bank account in Italy as a student" autoFocus /></Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Category" hint={STRATEGIES[category].description}>
              <Select value={category} onChange={(e) => setCategory(e.target.value as CategoryKey)} options={CATEGORY_KEYS.map((k) => ({ value: k, label: STRATEGIES[k].label }))} />
            </Field>
            <Field label="Country">
              <Select value={countryId} onChange={(e) => setCountryId(e.target.value)} options={(meta.data?.countries.length ? meta.data.countries : [{ id: "it", name: "Italy" }]).map((c) => ({ value: c.id, label: c.name }))} />
            </Field>
            <Field label="University (optional)">
              <Select value={universityId} onChange={(e) => setUniversityId(e.target.value)} options={[{ value: "", label: "—" }, ...(meta.data?.universities ?? []).filter((u) => u.countryId === countryId).map((u) => ({ value: u.id, label: u.name }))]} />
            </Field>
            <Field label="Scholarship (optional)">
              <Select value={scholarshipId} onChange={(e) => setScholarshipId(e.target.value)} options={[{ value: "", label: "—" }, ...(meta.data?.scholarships ?? []).filter((u) => u.countryId === countryId).map((u) => ({ value: u.id, label: u.name }))]} />
            </Field>
          </div>
          {dups && (
            <div className="rounded-xl bg-gold-100 p-3 text-[0.85rem] text-navy-900">
              <p className="font-semibold">Similar articles already exist:</p>
              {dups.map((d, i) => <p key={i}>• {d.title} ({d.status}, {Math.round(d.similarity * 100)}%)</p>)}
              <div className="mt-2 flex gap-2">
                <Button size="sm" variant="primary" busy={busy === "create"} onClick={() => create(true)}>Create anyway</Button>
                <Button size="sm" onClick={() => setDups(null)}>Change title</Button>
              </div>
            </div>
          )}
          <Button variant="primary" className="w-full" disabled={title.trim().length < 5} busy={busy === "create"} onClick={() => create(false)}>Create draft & open editor</Button>
        </div>
      </Card>
    </>
  );
}

/* ═════════════════════════ Calendar ═════════════════════════ */

interface CalItem extends ArticleRow {
  at: string;
  pinned?: boolean;
  publishError?: string | null;
  url?: string;
  deployment?: string;
}

export function Calendar() {
  const { data, error, reload } = useApi<{ timezone: string; publishing: { times: string[]; days: number[]; maxPerDay: number; minIntervalMinutes: number }; scheduled: CalItem[]; published: CalItem[]; approved: ArticleRow[]; nextSlot: string | null }>("calendar", { refreshMs: 60_000 });
  const { busy, run } = useAction();
  const [proposal, setProposal] = useState<Array<{ id: string; from: string; to: string }> | null>(null);
  const [view, setView] = useState<"queue" | "month">("queue");
  const [month, setMonth] = useState(() => new Date());

  if (error && !data) return <ErrorNote error={error} onRetry={reload} />;
  if (!data) return <Loading />;
  const tz = data.timezone;

  const swap = (i: number, dir: -1 | 1) =>
    run(`swap-${i}`, async () => {
      const a = data.scheduled[i];
      const b = data.scheduled[i + dir];
      if (!a || !b) return;
      await api("schedule/swap", { body: { a: a.id, b: b.id } });
      await reload();
    });
  const propose = () => run("compact", async () => setProposal((await api<{ changes: Array<{ id: string; from: string; to: string }> }>("schedule/compact")).changes));
  const applyProposal = () =>
    run("apply", async () => {
      await api("schedule/compact", { body: { changes: proposal } });
      setProposal(null);
      await reload();
    }, "Queue updated");
  const unschedule = (id: string) => run(`un-${id}`, async () => {
    await api(`articles/${id}/action`, { body: { action: "unschedule" } });
    await reload();
  });
  const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

  return (
    <>
      <PageHeader
        title="Publishing Calendar"
        subtitle={`Slots: ${data.publishing.times.join(", ")} on ${data.publishing.days.map((d) => DAYS[d]).join(", ")} · max ${data.publishing.maxPerDay}/day · ${tz}`}
        actions={
          <div className="flex gap-1 rounded-full bg-stone/60 p-1 text-[0.8rem]">
            {(["queue", "month"] as const).map((v) => (
              <button key={v} onClick={() => setView(v)} className={`min-h-9 rounded-full px-4 font-semibold ${view === v ? "bg-white text-navy-900 shadow-sm" : "text-ink-soft"}`}>{v === "queue" ? "Queue" : "Month"}</button>
            ))}
          </div>
        }
      />
      {data.nextSlot && <p className="mb-5 text-[0.85rem] text-ink-soft">Next free slot: <strong className="text-navy-900">{fmtDateTime(data.nextSlot, tz)}</strong></p>}

      {view === "queue" ? (
        <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
          <Card>
            <CardTitle action={data.scheduled.length > 1 ? <Button size="sm" busy={busy === "compact"} onClick={propose}>Recalculate queue</Button> : undefined}>Scheduled ({data.scheduled.length})</CardTitle>
            {proposal && (
              <div className="mb-4 rounded-xl bg-gold-100/70 p-3 text-[0.82rem] text-navy-900">
                {proposal.length === 0 ? (
                  <p>The queue is already as compact as possible. <button className="font-semibold underline" onClick={() => setProposal(null)}>OK</button></p>
                ) : (
                  <>
                    <p className="font-semibold">Proposed changes (only moves articles earlier; manual times stay):</p>
                    {proposal.map((c) => <p key={c.id}>• {data.scheduled.find((s) => s.id === c.id)?.title}: {fmtDateTime(c.from, tz)} → {fmtDateTime(c.to, tz)}</p>)}
                    <div className="mt-2 flex gap-2"><Button size="sm" variant="primary" busy={busy === "apply"} onClick={applyProposal}>Apply</Button><Button size="sm" onClick={() => setProposal(null)}>Cancel</Button></div>
                  </>
                )}
              </div>
            )}
            {data.scheduled.length === 0 ? (
              <Empty title="Nothing scheduled">Approve an article, then choose Schedule — it gets the next free slot.</Empty>
            ) : (
              <ol className="space-y-2">
                {data.scheduled.map((s, i) => (
                  <li key={s.id} className="flex items-center gap-3 rounded-xl bg-paper p-3 ring-1 ring-navy-900/[0.06]">
                    <div className="flex flex-col">
                      <button aria-label="Move earlier" disabled={i === 0 || busy !== null} onClick={() => swap(i, -1)} className="grid h-8 w-8 place-items-center rounded-full text-navy-900 hover:bg-stone disabled:opacity-25">↑</button>
                      <button aria-label="Move later" disabled={i === data.scheduled.length - 1 || busy !== null} onClick={() => swap(i, 1)} className="grid h-8 w-8 place-items-center rounded-full text-navy-900 hover:bg-stone disabled:opacity-25">↓</button>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-[0.78rem] font-semibold text-gold-600">{fmtDateTime(s.at, tz)}{s.pinned ? " · manual" : ""}</p>
                      <Link href={`/admin/articles/${s.id}`} className="block text-[0.9rem] leading-snug text-navy-900 hover:underline">{s.title}</Link>
                      {s.publishError && <p className="text-[0.75rem] text-red-700">Last attempt failed: {s.publishError}</p>}
                    </div>
                    <Button size="sm" variant="subtle" busy={busy === `un-${s.id}`} onClick={() => unschedule(s.id)}>Cancel</Button>
                  </li>
                ))}
              </ol>
            )}
          </Card>
          <div className="flex flex-col gap-6">
            <Card>
              <CardTitle>Approved, not scheduled</CardTitle>
              {data.approved.length === 0 ? <p className="text-sm text-ink-faint">None.</p> : (
                <ul className="space-y-2">{data.approved.map((a) => <li key={a.id}><Link href={`/admin/articles/${a.id}`} className="text-[0.88rem] text-navy-900 hover:underline">{a.title}</Link></li>)}</ul>
              )}
            </Card>
            <Card>
              <CardTitle>Recently published</CardTitle>
              {data.published.length === 0 ? <p className="text-sm text-ink-faint">None yet.</p> : (
                <ul className="space-y-2.5">
                  {data.published.slice(0, 8).map((p) => (
                    <li key={p.id} className="text-[0.85rem]">
                      <span className="block text-[0.72rem] text-ink-faint">{fmtDateTime(p.at, tz)}{p.deployment ? ` · ${p.deployment}` : ""}</span>
                      <Link href={`/admin/articles/${p.id}`} className="text-navy-900 hover:underline">{p.title}</Link>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        </div>
      ) : (
        <MonthGrid month={month} setMonth={setMonth} tz={tz} items={[...data.scheduled.map((s) => ({ ...s, kind: "scheduled" as const })), ...data.published.map((p) => ({ ...p, kind: "published" as const }))]} />
      )}
    </>
  );
}

function MonthGrid({ month, setMonth, tz, items }: { month: Date; setMonth: (d: Date) => void; tz: string; items: Array<CalItem & { kind: "scheduled" | "published" }> }) {
  const y = month.getFullYear();
  const m = month.getMonth();
  const first = new Date(Date.UTC(y, m, 1));
  const startPad = (first.getUTCDay() + 6) % 7; // Monday first
  const days = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const key = (iso: string) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
  const byDay = new Map<string, typeof items>();
  for (const it of items) byDay.set(key(it.at), [...(byDay.get(key(it.at)) ?? []), it]);
  const cells = Array.from({ length: startPad + days }, (_, i) => (i < startPad ? null : i - startPad + 1));
  return (
    <Card>
      <div className="mb-4 flex items-center justify-between">
        <Button size="sm" onClick={() => setMonth(new Date(y, m - 1, 1))} aria-label="Previous month">←</Button>
        <p className="font-semibold text-navy-900">{new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric" }).format(month)}</p>
        <Button size="sm" onClick={() => setMonth(new Date(y, m + 1, 1))} aria-label="Next month">→</Button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-[0.68rem] font-semibold uppercase text-ink-faint">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <div key={d}>{d}</div>)}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-1">
        {cells.map((d, i) => {
          if (!d) return <div key={i} />;
          const k = `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
          const list = byDay.get(k) ?? [];
          return (
            <div key={i} className="min-h-16 rounded-lg bg-paper p-1 ring-1 ring-navy-900/[0.05] sm:min-h-24 sm:p-1.5">
              <p className="text-[0.7rem] text-ink-faint">{d}</p>
              {list.map((it) => (
                <Link key={it.id} href={`/admin/articles/${it.id}`} title={it.title} className={`mt-0.5 block truncate rounded px-1 text-[0.62rem] sm:text-[0.7rem] ${it.kind === "published" ? "bg-navy-900 text-paper" : "bg-sky-100 text-sky-900"}`}>
                  {it.title}
                </Link>
              ))}
            </div>
          );
        })}
      </div>
    </Card>
  );
}
