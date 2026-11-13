"use client";

import Link from "next/link";
import { useState } from "react";
import type { SourceChange, StudioSource } from "../core/types";
import { api, Badge, Button, Card, CardTitle, Empty, ErrorNote, Field, Input, Loading, Modal, PageHeader, Select, Toggle, timeAgo, useAction, useApi } from "./kit";

const CATS: Array<{ value: StudioSource["category"]; label: string }> = [
  { value: "university", label: "University" },
  { value: "scholarship", label: "Scholarship body" },
  { value: "government", label: "Government / ministry" },
  { value: "consulate", label: "Consulate / visa" },
  { value: "application_portal", label: "Application portal" },
  { value: "publication", label: "Publication" },
  { value: "other", label: "Other" },
];

export function Research() {
  const { data, error, reload } = useApi<{ items: StudioSource[]; changes: SourceChange[] }>("sources");
  const meta = useApi<{ universities: Array<{ id: string; name: string }>; scholarships: Array<{ id: string; name: string }>; countries: Array<{ id: string; name: string }> }>("meta");
  const { busy, run } = useAction();
  const [edit, setEdit] = useState<Partial<StudioSource> | null>(null);
  const [q, setQ] = useState("");

  const check = (s: StudioSource) =>
    run(`check-${s.id}`, async () => {
      const r = await api<{ status: string; message: string }>(`sources/${s.id}/check`, { body: {} });
      await reload();
      return r;
    }).then((r) => r && alert(`${s.name}: ${r.message}`));
  const toggle = (s: StudioSource) => run(`mon-${s.id}`, async () => {
    await api(`sources/${s.id}`, { method: "PATCH", body: { monitor: !s.monitor } });
    await reload();
  });
  const remove = (s: StudioSource) => confirm(`Remove ${s.name} from the registry?`) && run(`del-${s.id}`, async () => {
    await api(`sources/${s.id}`, { method: "DELETE" });
    await reload();
  });
  const save = () =>
    run("save", async () => {
      if (!edit) return;
      const payload = { name: edit.name, url: edit.url, countryId: edit.countryId ?? "it", category: edit.category ?? "university", monitor: edit.monitor ?? true, frequencyHours: Number(edit.frequencyHours ?? 24), universityId: edit.universityId || undefined, scholarshipId: edit.scholarshipId || undefined };
      if (edit.id) await api(`sources/${edit.id}`, { method: "PATCH", body: payload });
      else await api("sources", { body: payload });
      setEdit(null);
      await reload();
    }, "Source saved");

  if (error && !data) return <ErrorNote error={error} onRetry={reload} />;
  const items = (data?.items ?? []).filter((s) => !q || `${s.name} ${s.url}`.toLowerCase().includes(q.toLowerCase()));

  return (
    <>
      <PageHeader
        title="Research & Sources"
        subtitle="Official websites the research engine trusts first, and checks for new notices. Pages are read politely (robots.txt respected); failures are recorded, never hidden."
        actions={<Button variant="primary" onClick={() => setEdit({ category: "university", monitor: true, frequencyHours: 24, countryId: "it" })}>Add source</Button>}
      />
      <div className="grid gap-6 xl:grid-cols-[1fr_24rem]">
        <Card>
          <CardTitle action={<Input placeholder="Filter…" value={q} onChange={(e) => setQ(e.target.value)} className="!min-h-9 max-w-[12rem] !py-1.5 text-sm" aria-label="Filter sources" />}>Source registry ({data?.items.length ?? 0})</CardTitle>
          {!data ? <Loading /> : items.length === 0 ? (
            <Empty title="No sources yet">Add official URLs, or load the Italy starter set under <Link className="underline" href="/admin/data">Countries & Universities</Link>.</Empty>
          ) : (
            <ul className="divide-y divide-navy-900/[0.06]">
              {items.map((s) => (
                <li key={s.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 text-[0.9rem] font-semibold text-navy-900">
                      {s.name}
                      <Badge>{CATS.find((c) => c.value === s.category)?.label}</Badge>
                      {s.lastStatus === "changed" && <Badge tone="gold">Changed</Badge>}
                      {s.lastStatus === "error" && <Badge tone="red">Error</Badge>}
                      {s.lastStatus === "blocked" && <Badge tone="red">Not allowed</Badge>}
                    </p>
                    <a href={s.url} target="_blank" rel="noopener noreferrer" className="block truncate text-[0.78rem] text-ink-faint underline decoration-navy-900/15">{s.url}</a>
                    <p className="mt-0.5 text-[0.72rem] text-ink-faint">
                      {s.monitor ? `Checked ${timeAgo(s.lastCheckedAt)} · every ${s.frequencyHours} h` : "Monitoring off"}
                      {s.lastSuccessAt && ` · last success ${timeAgo(s.lastSuccessAt)}`}
                      {s.lastChangeAt && ` · last change ${timeAgo(s.lastChangeAt)}`}
                    </p>
                    {s.lastError && <p className="text-[0.72rem] text-red-700">{s.lastError}</p>}
                  </div>
                  <div className="flex shrink-0 gap-1.5">
                    <Button size="sm" busy={busy === `check-${s.id}`} onClick={() => check(s)}>Check now</Button>
                    <Button size="sm" variant="subtle" busy={busy === `mon-${s.id}`} onClick={() => toggle(s)}>{s.monitor ? "Pause" : "Monitor"}</Button>
                    <Button size="sm" variant="subtle" onClick={() => setEdit(s)}>Edit</Button>
                    <Button size="sm" variant="subtle" busy={busy === `del-${s.id}`} onClick={() => remove(s)} aria-label="Remove">✕</Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardTitle>Detected changes</CardTitle>
          {!data ? <Loading /> : data.changes.length === 0 ? (
            <p className="text-sm text-ink-faint">No changes yet. The first check of each source saves a baseline; later checks compare against it.</p>
          ) : (
            <ul className="space-y-4">
              {data.changes.map((c) => (
                <li key={c.id} className="text-[0.84rem]">
                  <p className="flex flex-wrap items-center gap-2">
                    <strong className="text-navy-900">{c.sourceName}</strong>
                    <Badge tone={c.meaningful ? "gold" : "grey"}>{c.action === "new_article" ? "New topic" : c.action === "update_article" ? "Update article" : c.action === "ignore" ? "Minor" : "Pending"}</Badge>
                    <span className="text-[0.72rem] text-ink-faint">{timeAgo(c.detectedAt)}</span>
                  </p>
                  <p className="mt-1 text-ink-soft">{c.summary}</p>
                  {c.newLinks.slice(0, 3).map((l) => <a key={l.url} href={l.url} target="_blank" rel="noopener noreferrer" className="block truncate text-[0.75rem] text-navy-900 underline decoration-navy-900/20">{l.text || l.url}</a>)}
                  {c.relatedArticleId && <Link href={`/admin/articles/${c.relatedArticleId}`} className="mt-1 inline-block text-[0.78rem] font-semibold text-gold-600">Open related article →</Link>}
                  {c.topicId && <Link href="/admin/automation" className="mt-1 inline-block text-[0.78rem] font-semibold text-gold-600">Topic added to queue →</Link>}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <DiscoveredPages />

      <Modal open={Boolean(edit)} onClose={() => setEdit(null)} title={edit?.id ? "Edit source" : "Add official source"}>
        {edit && (
          <div className="space-y-4">
            <Field label="Name"><Input value={edit.name ?? ""} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="e.g. ERSU Messina — scholarship notices" /></Field>
            <Field label="URL" hint="Official page to read and monitor (a notices page is better than a homepage)."><Input value={edit.url ?? ""} onChange={(e) => setEdit({ ...edit, url: e.target.value })} placeholder="https://" /></Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Type"><Select value={edit.category} onChange={(e) => setEdit({ ...edit, category: e.target.value as StudioSource["category"] })} options={CATS} /></Field>
              <Field label="Country"><Select value={edit.countryId ?? "it"} onChange={(e) => setEdit({ ...edit, countryId: e.target.value })} options={(meta.data?.countries.length ? meta.data.countries : [{ id: "it", name: "Italy" }]).map((c) => ({ value: c.id, label: c.name }))} /></Field>
              <Field label="University"><Select value={edit.universityId ?? ""} onChange={(e) => setEdit({ ...edit, universityId: e.target.value })} options={[{ value: "", label: "—" }, ...(meta.data?.universities ?? []).map((u) => ({ value: u.id, label: u.name }))]} /></Field>
              <Field label="Scholarship"><Select value={edit.scholarshipId ?? ""} onChange={(e) => setEdit({ ...edit, scholarshipId: e.target.value })} options={[{ value: "", label: "—" }, ...(meta.data?.scholarships ?? []).map((u) => ({ value: u.id, label: u.name }))]} /></Field>
              <Field label="Check every (hours)"><Input type="number" min={1} value={edit.frequencyHours ?? 24} onChange={(e) => setEdit({ ...edit, frequencyHours: Number(e.target.value) })} /></Field>
            </div>
            <Toggle checked={edit.monitor ?? true} onChange={(v) => setEdit({ ...edit, monitor: v })} label="Monitor for changes" />
            <Button variant="primary" className="w-full" busy={busy === "save"} onClick={save} disabled={!edit.name || !edit.url}>Save</Button>
          </div>
        )}
      </Modal>
    </>
  );
}

interface Discovered {
  id: string;
  url: string;
  title: string;
  category: string;
  institution: { kind: string; id: string; name: string };
  via: string;
  discoveredAt: string;
  status: "pending" | "verified" | "rejected";
}

export function DiscoveredPages() {
  const { data, error, reload } = useApi<{ items: Discovered[]; labels: Record<string, string>; lastRun: { at: string; institutions: number; found: number; added: number; errors: Array<{ institution: string; message: string }> } | null }>("discovery");
  const { busy, run } = useAction();
  const [status, setStatus] = useState<"pending" | "verified" | "rejected">("pending");
  const [cat, setCat] = useState("");
  const [inst, setInst] = useState("");
  if (error && !data) return <ErrorNote error={error} onRetry={reload} />;
  const items = (data?.items ?? []).filter((d) => d.status === status && (!cat || d.category === cat) && (!inst || d.institution.id === inst));
  const institutions = [...new Map((data?.items ?? []).map((d) => [d.institution.id, d.institution.name])).entries()];
  const act = (id: string, a: "verify" | "reject") => run(`${a}-${id}`, async () => {
    await api(`discovery/${id}/${a}`, { body: {} });
    await reload();
  }, a === "verify" ? "Added to the source registry" : undefined);

  return (
    <Card className="mt-6">
      <CardTitle
        action={
          <Button size="sm" variant="primary" busy={busy === "run"} onClick={() => run("run", async () => {
            await api("discovery/run", { body: {} });
            await reload();
          }, "Discovery finished")}>
            Discover official pages
          </Button>
        }
      >
        Official page discovery
      </CardTitle>
      <p className="mb-3 text-[0.8rem] leading-snug text-ink-soft">
        Finds admissions, fees, scholarship, programme, international-office, housing, student-services and visa pages on the websites in your registry, from their sitemaps or homepage links (robots.txt respected). Verify a page to add it to the source registry; research uses verified pages first.
      </p>
      {data?.lastRun && (
        <p className="mb-3 rounded-xl bg-stone/40 p-2.5 text-[0.75rem] text-ink-soft">
          Last run {timeAgo(data.lastRun.at)}: {data.lastRun.institutions} institution(s), {data.lastRun.found} relevant page(s), {data.lastRun.added} new.
          {data.lastRun.errors.length > 0 && <span className="block text-red-700">Errors: {data.lastRun.errors.map((e) => `${e.institution}: ${e.message}`).join(" · ")}</span>}
        </p>
      )}
      <div className="mb-3 flex flex-wrap gap-2">
        {(["pending", "verified", "rejected"] as const).map((s) => (
          <button key={s} onClick={() => setStatus(s)} className={`min-h-9 rounded-full px-3.5 text-[0.8rem] font-semibold ${status === s ? "bg-navy-900 text-paper" : "bg-stone/60 text-ink-soft"}`}>
            {s === "pending" ? "To verify" : s === "verified" ? "Verified" : "Rejected"} ({(data?.items ?? []).filter((d) => d.status === s).length})
          </button>
        ))}
        <Select aria-label="Category" value={cat} onChange={(e) => setCat(e.target.value)} className="!min-h-9 max-w-[12rem] !py-1 text-[0.8rem]" options={[{ value: "", label: "All categories" }, ...Object.entries(data?.labels ?? {}).map(([k, v]) => ({ value: k, label: v }))]} />
        <Select aria-label="Institution" value={inst} onChange={(e) => setInst(e.target.value)} className="!min-h-9 max-w-[14rem] !py-1 text-[0.8rem]" options={[{ value: "", label: "All institutions" }, ...institutions.map(([id, name]) => ({ value: id, label: name }))]} />
      </div>
      {!data ? <Loading /> : items.length === 0 ? (
        <p className="py-6 text-center text-sm text-ink-faint">{data.items.length ? "Nothing in this view." : "No pages discovered yet — run discovery."}</p>
      ) : (
        <ul className="divide-y divide-navy-900/[0.06]">
          {items.slice(0, 150).map((d) => (
            <li key={d.id} className="flex flex-col gap-2 py-2.5 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 text-[0.85rem] font-medium text-navy-900">
                  <Badge tone="blue">{data.labels[d.category] ?? d.category}</Badge>
                  <span className="truncate">{d.title}</span>
                </p>
                <a href={d.url} target="_blank" rel="noopener noreferrer" className="block truncate text-[0.75rem] text-ink-faint underline decoration-navy-900/15">{d.url}</a>
                <p className="text-[0.7rem] text-ink-faint">{d.institution.name} · via {d.via} · found {timeAgo(d.discoveredAt)}</p>
              </div>
              {d.status === "pending" && (
                <div className="flex shrink-0 gap-1.5">
                  <Button size="sm" busy={busy === `verify-${d.id}`} onClick={() => act(d.id, "verify")}>Verify</Button>
                  <Button size="sm" variant="subtle" busy={busy === `reject-${d.id}`} onClick={() => act(d.id, "reject")}>Reject</Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
