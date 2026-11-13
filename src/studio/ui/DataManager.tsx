"use client";

import { useState } from "react";
import type { CourseRecord, StudioCountry, StudioRegion, StudioScholarship, StudioUniversity } from "../core/types";
import { api, Badge, Button, Card, Empty, ErrorNote, Field, Input, Loading, Modal, PageHeader, Select, Textarea, Toggle, useAction, useApi } from "./kit";

interface Data {
  countries: StudioCountry[];
  regions: StudioRegion[];
  universities: StudioUniversity[];
  scholarships: StudioScholarship[];
}
type Kind = "countries" | "regions" | "universities" | "scholarships";

const list = (s: string) => s.split(/\n|,/).map((x) => x.trim()).filter(Boolean);

export function DataManager() {
  const { data, error, reload } = useApi<Data>("data");
  const { busy, run } = useAction();
  const [tab, setTab] = useState<Kind>("universities");
  const [edit, setEdit] = useState<{ kind: Kind; id?: string; value: Record<string, unknown> } | null>(null);

  if (error && !data) return <ErrorNote error={error} onRetry={reload} />;
  if (!data) return <Loading />;

  const seed = () => run("seed", async () => {
    const r = await api<{ created: number }>("data/seed-italy", { body: {} });
    await reload();
    return r;
  }, "Italy starter set loaded");

  const save = () =>
    run("save", async () => {
      if (!edit) return;
      if (edit.id) await api(`data/${edit.kind}/${edit.id}`, { method: "PATCH", body: edit.value });
      else await api(`data/${edit.kind}`, { body: edit.value });
      setEdit(null);
      await reload();
    }, "Saved");

  const remove = (kind: Kind, id: string, name: string) =>
    confirm(`Delete ${name}?`) &&
    run(`del-${id}`, async () => {
      await api(`data/${kind}/${id}`, { method: "DELETE" });
      await reload();
    });

  const country = (id?: string) => data.countries.find((c) => c.id === id)?.name ?? id ?? "—";
  const region = (id?: string) => data.regions.find((c) => c.id === id)?.name ?? "—";
  const empty = data.countries.length === 0;

  const newValue: Record<Kind, Record<string, unknown>> = {
    countries: { name: "", code: "", active: true, currency: "EUR", academicYearStartMonth: 9, academicYearFormat: "YYYY/YYYY", extraCategories: [] },
    regions: { countryId: data.countries[0]?.id ?? "it", name: "", cities: [], resources: [] },
    universities: { countryId: data.countries[0]?.id ?? "it", name: "", website: "https://", officialDomains: [], campuses: [], departments: [], courses: [], scholarshipIds: [], researchEnabled: true },
    scholarships: { countryId: data.countries[0]?.id ?? "it", name: "", organisation: "", website: "https://", universityIds: [], monitor: true },
  };

  return (
    <>
      <PageHeader
        title="Countries & Universities"
        subtitle="Structured records the research engine reuses: official websites, regions, programmes and scholarship bodies. Italy is the first active country."
        actions={<Button variant="primary" onClick={() => setEdit({ kind: tab, value: newValue[tab] })}>Add {tab === "countries" ? "country" : tab.slice(0, -1).replace("ie", "y")}</Button>}
      />
      {empty && (
        <Card className="mb-6 border-gold-400 bg-gold-100/40">
          <p className="text-[0.92rem] text-navy-900">
            <strong>Start with Italy.</strong> Load a starter set: Italy, 4 regions, the universities of Messina, Bologna and Palermo, 4 regional scholarship bodies (ERSU Messina, DSU Toscana, EDISU Piemonte, ER.GO) and official sources (Universitaly, MUR, Visa for Italy). Only names and official homepages — no facts. Review and complete them afterwards.
          </p>
          <Button variant="primary" className="mt-4" busy={busy === "seed"} onClick={seed}>Load Italy starter set</Button>
        </Card>
      )}
      {tab === "countries" && (
        <Card className="mb-5">
          <p className="text-[0.85rem] text-ink-soft">
            Countries here are the single source for the website&apos;s country cards (SKOLAR Group) and the public /countries pages. Edit, then <strong>Publish to website</strong>; a country is shown as live only after the deployed page is verified.
          </p>
          <Button size="sm" className="mt-3" busy={busy === "import"} onClick={() => run("import", async () => {
            const r = await api<{ created: number; updated: number }>("data/import-countries", { body: {} });
            await reload();
            return r;
          }, "Homepage countries imported")}>
            Import the homepage&apos;s current countries
          </Button>
        </Card>
      )}
      <div className="scrollbar-none mb-5 flex gap-1 overflow-x-auto">
        {(["universities", "scholarships", "regions", "countries"] as Kind[]).map((k) => (
          <button key={k} onClick={() => setTab(k)} className={`min-h-10 shrink-0 rounded-full px-4 text-[0.85rem] font-semibold capitalize ${tab === k ? "bg-navy-900 text-paper" : "text-ink-soft hover:bg-stone/70"}`}>
            {k} ({data[k].length})
          </button>
        ))}
      </div>

      <Card padded={false}>
        {data[tab].length === 0 ? (
          <div className="p-6"><Empty title={`No ${tab} yet`} /></div>
        ) : (
          <ul className="divide-y divide-navy-900/[0.06]">
            {tab === "countries" && data.countries.map((c) => (
              <CountryRow key={c.id} c={c} onEdit={() => setEdit({ kind: "countries", id: c.id, value: c as unknown as Record<string, unknown> })} onChanged={reload} />
            ))}
            {tab === "regions" && data.regions.map((r) => (
              <Row key={r.id} title={r.name} meta={`${country(r.countryId)} · ${r.cities.join(", ") || "no cities"}`} onEdit={() => setEdit({ kind: "regions", id: r.id, value: r as unknown as Record<string, unknown> })} onDelete={() => remove("regions", r.id, r.name)} />
            ))}
            {tab === "universities" && data.universities.map((u) => (
              <Row key={u.id} title={u.name} meta={`${u.city ?? ""}${u.city ? " · " : ""}${region(u.regionId)} · ${u.courses.length} programmes · ${u.website}`} badge={u.researchEnabled ? <Badge tone="green">Research on</Badge> : <Badge>Research off</Badge>} onEdit={() => setEdit({ kind: "universities", id: u.id, value: u as unknown as Record<string, unknown> })} onDelete={() => remove("universities", u.id, u.name)} note={u.notes} />
            ))}
            {tab === "scholarships" && data.scholarships.map((s) => (
              <Row key={s.id} title={s.name} meta={`${s.organisation} · ${region(s.regionId)}${s.academicYear ? ` · ${s.academicYear}` : ""}`} badge={s.monitor ? <Badge tone="blue">Monitored</Badge> : undefined} onEdit={() => setEdit({ kind: "scholarships", id: s.id, value: s as unknown as Record<string, unknown> })} onDelete={() => remove("scholarships", s.id, s.name)} note={s.notes} />
            ))}
          </ul>
        )}
      </Card>

      <Modal open={Boolean(edit)} onClose={() => setEdit(null)} title={`${edit?.id ? "Edit" : "Add"} ${edit?.kind.slice(0, -1).replace("ie", "y") ?? ""}`} wide>
        {edit && <EditForm kind={edit.kind} value={edit.value} onChange={(value) => setEdit({ ...edit, value })} data={data} />}
        <Button variant="primary" className="mt-6 w-full" busy={busy === "save"} onClick={save}>Save</Button>
      </Modal>
    </>
  );
}

function Row({ title, meta, badge, onEdit, onDelete, note }: { title: string; meta: string; badge?: React.ReactNode; onEdit: () => void; onDelete: () => void; note?: string }) {
  return (
    <li className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-2 text-[0.92rem] font-semibold text-navy-900">{title} {badge}</p>
        <p className="truncate text-[0.78rem] text-ink-faint">{meta}</p>
        {note && <p className="text-[0.72rem] text-gold-600">{note}</p>}
      </div>
      <div className="flex shrink-0 gap-1.5">
        <Button size="sm" onClick={onEdit}>Edit</Button>
        <Button size="sm" variant="subtle" onClick={onDelete} aria-label="Delete">✕</Button>
      </div>
    </li>
  );
}

function EditForm({ kind, value, onChange, data }: { kind: Kind; value: Record<string, unknown>; onChange: (v: Record<string, unknown>) => void; data: Data }) {
  const v = value as Record<string, never>;
  const set = (k: string, val: unknown) => onChange({ ...value, [k]: val });
  const countryOpts = (data.countries.length ? data.countries : [{ id: "it", name: "Italy" }]).map((c) => ({ value: c.id, label: c.name }));
  const regionOpts = [{ value: "", label: "—" }, ...data.regions.filter((r) => r.countryId === (value.countryId as string)).map((r) => ({ value: r.id, label: r.name }))];

  if (kind === "countries") {
    const img = v.image as { url: string; alt: string; credit?: string; license?: string } | undefined;
    const links = (v.links ?? []) as Array<{ label: string; url: string }>;
    return (
      <div className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name"><Input value={v.name ?? ""} onChange={(e) => set("name", e.target.value)} /></Field>
          <Field label="ISO code" hint="e.g. IT — used as the record id"><Input value={v.code ?? ""} maxLength={3} disabled={Boolean(value.createdAt)} onChange={(e) => set("code", e.target.value)} /></Field>
          <Field label="Slug (URL)" hint={`/countries/${(v.slug as string) || "…"}`}><Input value={v.slug ?? ""} onChange={(e) => set("slug", e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))} /></Field>
          <Field label="Flag" hint="An emoji (e.g. 🇮🇹) — optional"><Input value={v.flag ?? ""} maxLength={8} onChange={(e) => set("flag", e.target.value || undefined)} /></Field>
          <Field label="Card title" className="sm:col-span-2"><Input value={v.cardTitle ?? ""} placeholder="Explore Higher Education in Italy" onChange={(e) => set("cardTitle", e.target.value)} /></Field>
          <Field label="Short description" hint={`${((v.shortDescription as string) ?? "").length}/400`} className="sm:col-span-2"><Textarea rows={2} value={v.shortDescription ?? ""} onChange={(e) => set("shortDescription", e.target.value)} /></Field>
          <Field label="Focus label" hint="e.g. Undergraduate · Postgraduate · Medicine"><Input value={v.focus ?? ""} onChange={(e) => set("focus", e.target.value || undefined)} /></Field>
          <Field label="Display order"><Input type="number" min={0} value={v.order ?? 99} onChange={(e) => set("order", Number(e.target.value))} /></Field>
          <Field label="Country platform URL" hint="Optional external SKOLAR site (https://…)"><Input value={v.platformUrl ?? ""} onChange={(e) => set("platformUrl", e.target.value || undefined)} /></Field>
          <Field label="Button label"><Input value={v.ctaLabel ?? ""} placeholder="Explore Platform" onChange={(e) => set("ctaLabel", e.target.value || undefined)} /></Field>
        </div>
        <CountryImage value={img} countryId={value.id as string | undefined} onChange={(im) => set("image", im)} />
        <Field label="Introductory content (Markdown)" hint="Shown on /countries/<slug>. When present, the homepage card opens this page.">
          <Textarea rows={6} value={v.introContent ?? ""} onChange={(e) => set("introContent", e.target.value)} className="font-mono text-[0.85rem]" />
        </Field>
        <Field label="Useful links" hint="One per line: Label | https://…">
          <Textarea rows={3} value={links.map((l) => `${l.label} | ${l.url}`).join("\n")} onChange={(e) => set("links", e.target.value.split("\n").map((l) => l.split("|").map((x) => x.trim())).filter((p) => p[0] && p[1]).map(([label, url]) => ({ label, url })))} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Currency"><Input value={v.currency ?? "EUR"} maxLength={3} onChange={(e) => set("currency", e.target.value)} /></Field>
          <Field label="Academic year starts (month)"><Input type="number" min={1} max={12} value={v.academicYearStartMonth ?? 9} onChange={(e) => set("academicYearStartMonth", Number(e.target.value))} /></Field>
          <Field label="Extra categories" hint="Comma separated"><Input value={((v.extraCategories ?? []) as string[]).join(", ")} onChange={(e) => set("extraCategories", list(e.target.value))} /></Field>
        </div>
        <Toggle checked={Boolean(v.active ?? true)} onChange={(x) => set("active", x)} label="Active on the website" hint="Deactivating hides the country card after you publish the change." />
        <div>
          <p className="mb-2 text-[0.8rem] font-semibold text-navy-900">Card preview</p>
          <div className="max-w-sm overflow-hidden rounded-[20px] bg-navy-800 text-paper">
            {img?.url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={img.url} alt="" className="aspect-[4/3] w-full object-cover opacity-90" />
            ) : (
              <div className="grid aspect-[4/3] place-items-center text-[0.8rem] text-paper/50">No display image</div>
            )}
            <div className="p-5">
              <p className="text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-gold-300">{(v.flag as string) || ""} SKOLAR · {(v.name as string) || "Country"}</p>
              {v.focus ? <p className="mt-2 text-[0.72rem] uppercase tracking-[0.12em] text-gold-300">{v.focus as string}</p> : null}
              <p className="display mt-2 text-[1.5rem] leading-tight">{(v.cardTitle as string) || "Card title"}</p>
              <p className="mt-2 text-[0.85rem] text-paper/65">{(v.shortDescription as string) || "Short description"}</p>
              <p className="mt-4 border-t border-white/10 pt-3 text-[0.85rem] font-semibold">{(v.ctaLabel as string) || "Explore Platform"} → {v.introContent ? `/countries/${(v.slug as string) || "…"}` : (v.platformUrl as string) || "(no link)"}</p>
            </div>
          </div>
        </div>
      </div>
    );
  }
  if (kind === "regions") {
    return (
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Country"><Select value={v.countryId} onChange={(e) => set("countryId", e.target.value)} options={countryOpts} /></Field>
        <Field label="Region name"><Input value={v.name ?? ""} onChange={(e) => set("name", e.target.value)} /></Field>
        <Field label="Cities" hint="Comma separated" className="sm:col-span-2"><Input value={((v.cities ?? []) as string[]).join(", ")} onChange={(e) => set("cities", list(e.target.value))} /></Field>
        <Field label="Student resources" hint="One per line: Label | https://…" className="sm:col-span-2">
          <Textarea rows={3} value={((v.resources ?? []) as Array<{ label: string; url: string }>).map((r) => `${r.label} | ${r.url}`).join("\n")} onChange={(e) => set("resources", e.target.value.split("\n").map((l) => l.split("|").map((x) => x.trim())).filter((p) => p[0] && p[1]).map(([label, url]) => ({ label, url })))} />
        </Field>
      </div>
    );
  }
  if (kind === "scholarships") {
    return (
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Programme name"><Input value={v.name ?? ""} onChange={(e) => set("name", e.target.value)} /></Field>
        <Field label="Responsible organisation"><Input value={v.organisation ?? ""} onChange={(e) => set("organisation", e.target.value)} /></Field>
        <Field label="Country"><Select value={v.countryId} onChange={(e) => set("countryId", e.target.value)} options={countryOpts} /></Field>
        <Field label="Region"><Select value={v.regionId ?? ""} onChange={(e) => set("regionId", e.target.value || undefined)} options={regionOpts} /></Field>
        <Field label="Official website"><Input value={v.website ?? ""} onChange={(e) => set("website", e.target.value)} /></Field>
        <Field label="Application portal"><Input value={v.portalUrl ?? ""} onChange={(e) => set("portalUrl", e.target.value || undefined)} /></Field>
        <Field label="Academic year of current call" hint="e.g. 2026/2027"><Input value={v.academicYear ?? ""} onChange={(e) => set("academicYear", e.target.value || undefined)} /></Field>
        <div className="flex items-end"><Toggle checked={Boolean(v.monitor ?? true)} onChange={(x) => set("monitor", x)} label="Monitor for new notices" /></div>
        <Field label="Eligible universities" className="sm:col-span-2">
          <div className="flex flex-wrap gap-1.5">
            {data.universities.map((u) => {
              const sel = ((v.universityIds ?? []) as string[]).includes(u.id);
              return <button type="button" key={u.id} onClick={() => set("universityIds", sel ? (v.universityIds as string[]).filter((x) => x !== u.id) : [...((v.universityIds ?? []) as string[]), u.id])} className={`min-h-9 rounded-full px-3 text-[0.8rem] ${sel ? "bg-navy-900 text-paper" : "bg-stone/60 text-navy-900"}`}>{u.name}</button>;
            })}
          </div>
        </Field>
        <Field label="Eligibility (verified notes)" hint="Only information confirmed on official sources." className="sm:col-span-2"><Textarea rows={3} value={v.eligibility ?? ""} onChange={(e) => set("eligibility", e.target.value || undefined)} /></Field>
        <Field label="Benefits (verified notes)" className="sm:col-span-2"><Textarea rows={3} value={v.benefits ?? ""} onChange={(e) => set("benefits", e.target.value || undefined)} /></Field>
        <Field label="Notes" className="sm:col-span-2"><Input value={v.notes ?? ""} onChange={(e) => set("notes", e.target.value || undefined)} /></Field>
      </div>
    );
  }
  const courses = (v.courses ?? []) as CourseRecord[];
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Official name"><Input value={v.name ?? ""} onChange={(e) => set("name", e.target.value)} /></Field>
      <Field label="Short name"><Input value={v.shortName ?? ""} onChange={(e) => set("shortName", e.target.value || undefined)} /></Field>
      <Field label="Country"><Select value={v.countryId} onChange={(e) => set("countryId", e.target.value)} options={countryOpts} /></Field>
      <Field label="Region"><Select value={v.regionId ?? ""} onChange={(e) => set("regionId", e.target.value || undefined)} options={regionOpts} /></Field>
      <Field label="City"><Input value={v.city ?? ""} onChange={(e) => set("city", e.target.value || undefined)} /></Field>
      <Field label="Official website"><Input value={v.website ?? ""} onChange={(e) => set("website", e.target.value)} /></Field>
      <Field label="Other official domains" hint="Comma separated, e.g. international.unime.it"><Input value={((v.officialDomains ?? []) as string[]).join(", ")} onChange={(e) => set("officialDomains", list(e.target.value))} /></Field>
      <Field label="Campuses" hint="Comma separated"><Input value={((v.campuses ?? []) as string[]).join(", ")} onChange={(e) => set("campuses", list(e.target.value))} /></Field>
      <Field label="Faculties / departments" hint="One per line" className="sm:col-span-2"><Textarea rows={3} value={((v.departments ?? []) as string[]).join("\n")} onChange={(e) => set("departments", list(e.target.value))} /></Field>
      <div className="sm:col-span-2">
        <p className="mb-2 text-[0.8rem] font-semibold text-navy-900">Programmes (each tied to an academic year)</p>
        <ul className="space-y-2">
          {courses.map((c, i) => (
            <li key={i} className="grid gap-2 rounded-xl bg-paper p-2 ring-1 ring-navy-900/[0.06] sm:grid-cols-[1fr_8rem_7rem_7rem_auto]">
              <Input aria-label="Programme" value={c.name} onChange={(e) => set("courses", courses.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
              <Select aria-label="Level" value={c.level} onChange={(e) => set("courses", courses.map((x, j) => (j === i ? { ...x, level: e.target.value as CourseRecord["level"] } : x)))} options={[{ value: "bachelor", label: "Bachelor" }, { value: "master", label: "Master" }, { value: "single_cycle", label: "Single cycle" }, { value: "phd", label: "PhD" }, { value: "other", label: "Other" }]} />
              <Select aria-label="Language" value={c.language} onChange={(e) => set("courses", courses.map((x, j) => (j === i ? { ...x, language: e.target.value as CourseRecord["language"] } : x)))} options={[{ value: "english", label: "English" }, { value: "italian", label: "Italian" }, { value: "mixed", label: "Mixed" }, { value: "unknown", label: "Unknown" }]} />
              <Input aria-label="Academic year" value={c.academicYear} placeholder="2026/2027" onChange={(e) => set("courses", courses.map((x, j) => (j === i ? { ...x, academicYear: e.target.value } : x)))} />
              <Button size="sm" variant="subtle" onClick={() => set("courses", courses.filter((_, j) => j !== i))}>✕</Button>
            </li>
          ))}
        </ul>
        <Button size="sm" className="mt-2" onClick={() => set("courses", [...courses, { name: "", level: "bachelor", language: "english", academicYear: "", verified: false }])}>Add programme</Button>
      </div>
      <Field label="Language notes" className="sm:col-span-2"><Input value={v.languageNotes ?? ""} onChange={(e) => set("languageNotes", e.target.value || undefined)} /></Field>
      <Field label="Notes" className="sm:col-span-2"><Input value={v.notes ?? ""} onChange={(e) => set("notes", e.target.value || undefined)} /></Field>
      <div className="sm:col-span-2"><Toggle checked={Boolean(v.researchEnabled ?? true)} onChange={(x) => set("researchEnabled", x)} label="Use in automatic research" /></div>
    </div>
  );
}

const PUB_BADGE: Record<string, { label: string; tone: "green" | "gold" | "red" | "blue" | "grey" }> = {
  draft: { label: "Not published", tone: "grey" },
  deploying: { label: "Deploying", tone: "blue" },
  verifying: { label: "Verifying", tone: "blue" },
  awaiting_push: { label: "Written locally — push to deploy", tone: "gold" },
  published: { label: "Live", tone: "green" },
  failed: { label: "Publish failed", tone: "red" },
};

function CountryRow({ c, onEdit, onChanged }: { c: StudioCountry; onEdit: () => void; onChanged: () => Promise<void> }) {
  const { busy, run } = useAction();
  const st = PUB_BADGE[c.publish?.state ?? "draft"];
  const changed = c.publish?.state === "published" && c.updatedAt > (c.publish.verifiedAt ?? "");
  return (
    <li className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-2 text-[0.92rem] font-semibold text-navy-900">
          {c.flag ? <span aria-hidden>{c.flag}</span> : null}
          {c.name}
          {c.active ? <Badge tone="green">Active</Badge> : <Badge>Inactive</Badge>}
          <Badge tone={st.tone}>{st.label}</Badge>
          {changed && <Badge tone="gold">Unpublished changes</Badge>}
        </p>
        <p className="truncate text-[0.78rem] text-ink-faint">/{c.slug ? `countries/${c.slug}` : "(no slug)"} · {c.cardTitle ?? "no card title"} · order {c.order ?? "—"}</p>
        {c.publish?.lastError && c.publish.state !== "published" && <p className="text-[0.72rem] text-red-700">{c.publish.lastError}</p>}
      </div>
      <div className="flex shrink-0 gap-1.5">
        <Button size="sm" onClick={onEdit}>Edit</Button>
        <Button size="sm" variant="primary" busy={busy === "pub"} onClick={() => run("pub", async () => {
          await api(`countries/${c.id}/publish`, { body: {} });
          await onChanged();
        }, c.active ? "Published — waiting for deployment & verification" : "Deactivation published")}>
          {c.active ? "Publish to website" : "Publish deactivation"}
        </Button>
        {c.publish && ["deploying", "verifying", "awaiting_push"].includes(c.publish.state) && (
          <Button size="sm" variant="subtle" busy={busy === "chk"} onClick={() => run("chk", async () => {
            await api(`countries/${c.id}/check`, { body: {} });
            await onChanged();
          })}>Check</Button>
        )}
      </div>
    </li>
  );
}

function CountryImage({ value, countryId, onChange }: { value?: { url: string; alt: string; credit?: string; license?: string }; countryId?: string; onChange: (v: { url: string; alt: string; credit?: string; license?: string }) => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [meta, setMeta] = useState({ alt: value?.alt ?? "", credit: value?.credit ?? "", license: value?.license ?? "", rights: false });
  const { busy, run } = useAction();
  return (
    <div className="rounded-xl bg-white p-4 ring-1 ring-navy-900/[0.07]">
      <p className="mb-2 text-[0.8rem] font-semibold text-navy-900">Display image</p>
      {value?.url && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={value.url} alt={value.alt} className="mb-3 aspect-[16/9] w-full max-w-sm rounded-xl object-cover" />
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Alt text" className="sm:col-span-2"><Input value={meta.alt} onChange={(e) => { setMeta({ ...meta, alt: e.target.value }); if (value?.url) onChange({ ...value, alt: e.target.value }); }} /></Field>
        {countryId ? (
          <>
            <input type="file" accept="image/jpeg,image/png,image/webp,image/avif" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-sm sm:col-span-2" />
            <Field label="Credit"><Input value={meta.credit} onChange={(e) => setMeta({ ...meta, credit: e.target.value })} /></Field>
            <Field label="Licence"><Input value={meta.license} onChange={(e) => setMeta({ ...meta, license: e.target.value })} /></Field>
            <label className="flex items-start gap-2 text-[0.8rem] sm:col-span-2"><input type="checkbox" checked={meta.rights} onChange={(e) => setMeta({ ...meta, rights: e.target.checked })} className="mt-1" /> SKOLAR may use this image (no university logos or seals).</label>
            <Button size="sm" disabled={!file || !meta.alt || !meta.rights} busy={busy === "up"} onClick={() => run("up", async () => {
              const fd = new FormData();
              fd.set("file", file!);
              fd.set("alt", meta.alt);
              fd.set("credit", meta.credit);
              fd.set("license", meta.license);
              fd.set("rightsConfirmed", String(meta.rights));
              const r = await api<{ image: { url: string; alt: string; credit?: string; license?: string } }>(`countries/${countryId}/image`, { form: fd });
              onChange(r.image);
            }, "Image uploaded to Vercel Blob")}>Upload image</Button>
          </>
        ) : (
          <p className="text-[0.75rem] text-ink-faint sm:col-span-2">Save the country first, then upload its image.</p>
        )}
      </div>
    </div>
  );
}
