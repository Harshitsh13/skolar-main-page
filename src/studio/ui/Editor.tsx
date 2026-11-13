"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { renderArticleMarkdown, splitSections } from "../core/markdown";
import { CATEGORY_KEYS, STRATEGIES, VERIFICATION_LABEL } from "../core/strategies";
import type { ArticleSource, StudioArticle } from "../core/types";
import { api, ApiError, Badge, Button, Card, CardTitle, ErrorNote, Field, Input, Loading, Modal, Select, Status, Textarea, fmtDateTime, timeAgo, useAction, useApi, useToast } from "./kit";

interface Meta {
  categories: Array<{ key: string; label: string }>;
  countries: Array<{ id: string; name: string }>;
  universities: Array<{ id: string; name: string; countryId: string }>;
  scholarships: Array<{ id: string; name: string; countryId: string }>;
  ctas: Array<{ key: string; label: string; text: string }>;
}
interface Loaded {
  item: StudioArticle;
  blockers: string[];
  duplicates: Array<{ kind: string; id: string; title: string; similarity: number; status: string }>;
  nextSlot: string | null;
  targets: { github: string | null; localFiles: boolean; siteRecord: boolean };
  job: { id: string; status: string; gaps: string[] } | null;
  timezone: string;
}

type Tab = "write" | "details" | "image" | "checks" | "cta";

export function Editor({ id }: { id: string }) {
  const toast = useToast();
  const { data, error, reload, setData } = useApi<Loaded>(`articles/${id}`);
  const meta = useApi<Meta>("meta");
  const [draft, setDraft] = useState<StudioArticle | null>(null);
  const [dirty, setDirty] = useState(false);
  const [tab, setTab] = useState<Tab>("write");
  const [preview, setPreview] = useState(false);
  const { busy, run } = useAction();
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);

  const versionRef = useRef(0);
  useEffect(() => {
    // Only adopt server state while the editor has no unsaved edits (prevents silent overwrites).
    if (data?.item && !dirty) {
      versionRef.current = data.item.version;
      setDraft(data.item);
    }
  }, [data, dirty]);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  const set = useCallback(<K extends keyof StudioArticle>(k: K, v: StudioArticle[K]) => {
    setDraft((d) => (d ? { ...d, [k]: v } : d));
    setDirty(true);
  }, []);

  const applyServer = (out: { item: StudioArticle; blockers?: string[] }) => {
    versionRef.current = out.item.version;
    setDraft(out.item);
    setDirty(false);
    setData((d) => (d ? { ...d, item: out.item, blockers: out.blockers ?? d.blockers } : d));
  };

  const save = async (): Promise<boolean> => {
    if (!draft || !data) return false;
    const out = await run("save", async () => {
      const o = await api<{ item: StudioArticle; blockers: string[] }>(`articles/${id}`, {
        method: "PATCH",
        body: {
          expectedVersion: versionRef.current,
          title: draft.title,
          slug: draft.slug,
          excerpt: draft.excerpt,
          body: draft.body,
          category: draft.category,
          countryId: draft.countryId,
          universityIds: draft.universityIds,
          scholarshipIds: draft.scholarshipIds,
          audience: draft.audience,
          academicYear: draft.academicYear ?? "",
          seoTitle: draft.seoTitle,
          metaDescription: draft.metaDescription,
          tags: draft.tags,
          cta: draft.cta ?? null,
          sources: draft.sources,
          coverImage: draft.coverImage ?? null,
        },
      });
      applyServer(o);
      return o;
    }, "Saved");
    return Boolean(out);
  };

  const action = async (a: string, extra?: Record<string, unknown>, success?: string) => {
    if (dirty && !(await save())) return;
    await run(a, async () => {
      const o = await api<{ item: StudioArticle; blockers?: string[]; nextSlot?: string }>(`articles/${id}/action`, { body: { action: a, expectedVersion: versionRef.current, ...extra } });
      applyServer(o);
      await reload();
      if (a === "approve" && o.nextSlot) setScheduleOpen(true);
    }, success);
  };

  const regenerateAll = () =>
    run("regen", async () => {
      if (!confirm("Re-run research and writing for this article? Your current text will be replaced by the new draft when it is ready.")) return;
      await api(`articles/${id}/regenerate`, { body: {} });
      await reload();
      toast("ok", "Regeneration queued — the worker will rebuild this draft.");
    });

  if (error && !data) return <ErrorNote error={error} onRetry={reload} />;
  if (!data || !draft) return <Loading />;

  const a = draft;
  const locked = a.status === "researching";
  const blocks = a.warnings.filter((w) => w.severity === "block").length;
  const flaggedClaims = a.claims.filter((c) => !["verified", "partially_verified"].includes(c.status)).length;

  return (
    <div className="pb-28">
      <div className="mb-5 flex flex-wrap items-center gap-2 text-[0.82rem] text-ink-faint">
        <Link href="/admin/review" className="hover:text-navy-900">← Review queue</Link>
        <span>·</span>
        <Status value={a.status} />
        <Badge>{a.origin === "ai" ? "AI research" : "Written manually"}</Badge>
        {a.academicYear && <Badge tone="gold">{a.academicYear}</Badge>}
        <span>· updated {timeAgo(a.updatedAt)}</span>
        {dirty && <Badge tone="red">Unsaved changes</Badge>}
      </div>

      {locked && <p className="mb-4 rounded-2xl bg-sky-50 p-4 text-sm text-sky-900">This article is being regenerated by the worker. It will return to the review queue when ready.</p>}
      {(a.warnings.some((w) => w.severity === "block") || (a.status === "needs_review" && a.qualityGate && !a.qualityGate.passed)) && (
        <div className="mb-4 rounded-2xl border border-red-700/15 bg-red-50 p-4 text-sm text-red-900">
          <p className="font-semibold">Must be fixed before approval:</p>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {a.warnings.filter((w) => w.severity === "block").map((w, i) => (
              <li key={i}>
                {w.message}
                {w.excerpt && <span className="block text-[0.8rem] italic opacity-80">“{w.excerpt}”</span>}
              </li>
            ))}
            {(a.qualityGate?.reasons ?? []).filter((r) => !/blocking editorial warnings/i.test(r)).map((r, i) => <li key={`q${i}`}>{r}</li>)}
          </ul>
          {flaggedClaims > 0 && (
            <div className="mt-3">
              <p className="mb-1 font-semibold">Statements without a citation ({a.claims.filter((c) => c.status === "unverified").length}):</p>
              <ul className="space-y-1 text-[0.8rem]">
                {a.claims.filter((c) => c.status === "unverified").slice(0, 12).map((c) => (
                  <li key={c.id}>• {c.text}</li>
                ))}
              </ul>
              <p className="mt-2 text-[0.78rem]">For each one: add a source citation (<code>[[n]]</code>), rephrase it as general advice, or remove it.</p>
            </div>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            {a.facts.length > 0 && !["published", "publishing"].includes(a.status) && (
              <Button size="sm" variant="primary" busy={busy === "autocite"} disabled={dirty} onClick={() => action("autocite", undefined)}>
                Add citations from research evidence
              </Button>
            )}
            <Button size="sm" onClick={() => setTab("checks")}>Open sources & checks</Button>
            <Button size="sm" variant="subtle" busy={busy === "check"} onClick={() => action("check", undefined, "Checks updated")}>Re-run checks</Button>
          </div>
        </div>
      )}
      {data.duplicates.length > 0 && (
        <p className="mb-4 rounded-2xl bg-gold-100/70 p-4 text-[0.85rem] text-navy-900">
          Possible duplicate: {data.duplicates.map((d) => `“${d.title}” (${d.status}, ${Math.round(d.similarity * 100)}%)`).join("; ")}
        </p>
      )}

      <textarea
        aria-label="Title"
        value={a.title}
        onChange={(e) => set("title", e.target.value.replace(/\n/g, " "))}
        rows={2}
        disabled={locked}
        className="display w-full resize-none border-0 bg-transparent p-0 text-[2rem] leading-[1.08] text-navy-900 focus:outline-none sm:text-[2.6rem]"
      />

      {/* Tabs */}
      <div className="scrollbar-none sticky top-16 z-20 -mx-4 mb-5 mt-3 flex gap-1 overflow-x-auto bg-paper/95 px-4 py-2 backdrop-blur sm:mx-0 sm:px-0">
        {(
          [
            ["write", "Write"],
            ["details", "Details & SEO"],
            ["image", "Image"],
            ["checks", `Sources & checks${blocks || flaggedClaims ? ` (${blocks + flaggedClaims})` : ""}`],
            ["cta", "Call to action"],
          ] as Array<[Tab, string]>
        ).map(([k, label]) => (
          <button key={k} onClick={() => setTab(k)} className={`min-h-10 shrink-0 rounded-full px-4 text-[0.85rem] font-semibold ${tab === k ? "bg-navy-900 text-paper" : "text-ink-soft hover:bg-stone/70"}`}>
            {label}
          </button>
        ))}
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0">
          {tab === "write" && <WriteTab a={a} set={set} preview={preview} setPreview={setPreview} locked={locked} articleId={id} version={versionRef.current} dirty={dirty} onRegenerated={applyServer} onRegenerateAll={regenerateAll} busyAll={busy === "regen"} />}
          {tab === "details" && meta.data && <DetailsTab a={a} set={set} meta={meta.data} published={data.item.status === "published"} />}
          {tab === "image" && <ImageTab a={a} set={set} articleId={id} dirty={dirty} onServer={applyServer} />}
          {tab === "checks" && <ChecksTab a={a} set={set} gaps={data.job?.gaps ?? []} onRecheck={() => action("check", undefined, "Checks updated")} busy={busy === "check"} />}
          {tab === "cta" && meta.data && <CtaTab a={a} set={set} ctas={meta.data.ctas} />}
        </div>

        <aside className="flex flex-col gap-4">
          <PublishPanel data={data} a={a} onSchedule={() => setScheduleOpen(true)} onAction={action} busy={busy} onReject={() => setRejectOpen(true)} dirty={dirty} />
        </aside>
      </div>

      {/* Sticky action bar */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-navy-900/10 bg-paper/95 px-4 py-3 backdrop-blur lg:left-[17rem]">
        <div className="mx-auto flex max-w-[84rem] items-center justify-end gap-2 lg:px-6">
          <span className="mr-auto hidden text-[0.78rem] text-ink-faint sm:block">
            {a.readingMinutes} min read · {a.sources.length} sources · {blocks} blocking warning{blocks === 1 ? "" : "s"}
          </span>
          <Button variant="primary" busy={busy === "save"} disabled={!dirty || locked} onClick={() => void save()}>
            Save
          </Button>
          {["draft", "needs_review", "rejected"].includes(a.status) && (
            <Button variant="gold" busy={busy === "approve"} disabled={locked} onClick={() => action("approve", undefined, "Approved")}>
              Approve
            </Button>
          )}
          {["approved", "scheduled"].includes(a.status) && (
            <Button variant="gold" busy={busy === "publish"} onClick={() => confirm("Publish this article now? It is committed, deployed and then verified on the live site.") && action("publish", undefined, "Committed — waiting for deployment & verification")}>
              Publish now
            </Button>
          )}
        </div>
      </div>

      <ScheduleModal open={scheduleOpen} onClose={() => setScheduleOpen(false)} nextSlot={data.nextSlot} tz={data.timezone} busy={busy === "schedule"} onConfirm={(at, expectedSlot) => action("schedule", at ? { at } : { expectedSlot }, "Scheduled").then(() => setScheduleOpen(false))} />
      <RejectModal open={rejectOpen} onClose={() => setRejectOpen(false)} onConfirm={(reason) => action("reject", { reason }, "Rejected").then(() => setRejectOpen(false))} busy={busy === "reject"} />
    </div>
  );
}

/* ═════════════════════════ Write tab ═════════════════════════ */

function WriteTab({
  a, set, preview, setPreview, locked, articleId, version, dirty, onRegenerated, onRegenerateAll, busyAll,
}: {
  a: StudioArticle;
  set: <K extends keyof StudioArticle>(k: K, v: StudioArticle[K]) => void;
  preview: boolean;
  setPreview: (v: boolean) => void;
  locked: boolean;
  articleId: string;
  version: number;
  dirty: boolean;
  onRegenerated: (o: { item: StudioArticle; blockers?: string[] }) => void;
  onRegenerateAll: () => void;
  busyAll: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const rendered = useMemo(() => (preview ? renderArticleMarkdown(a.body).html : ""), [preview, a.body]);
  const sections = useMemo(() => splitSections(a.body).filter((s) => s.heading), [a.body]);
  const [regen, setRegen] = useState<{ heading: string; instruction: string } | null>(null);
  const { busy, run } = useAction();

  const wrap = (before: string, after = "", placeholder = "") => {
    const el = ref.current;
    if (!el) return;
    const { selectionStart: s, selectionEnd: e, value } = el;
    const sel = value.slice(s, e) || placeholder;
    const next = value.slice(0, s) + before + sel + after + value.slice(e);
    set("body", next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(s + before.length, s + before.length + sel.length);
    });
  };
  const line = (prefix: string) => {
    const el = ref.current;
    if (!el) return;
    const { selectionStart: s, value } = el;
    const start = value.lastIndexOf("\n", s - 1) + 1;
    set("body", value.slice(0, start) + prefix + value.slice(start));
    requestAnimationFrame(() => el.focus());
  };

  const tools: Array<[string, string, () => void]> = [
    ["H2", "Section heading", () => line("## ")],
    ["H3", "Sub-heading", () => line("### ")],
    ["B", "Bold", () => wrap("**", "**", "bold text")],
    ["I", "Italic", () => wrap("_", "_", "italic text")],
    ["Link", "Link", () => wrap("[", "](https://)", "link text")],
    ["• List", "Bulleted list", () => line("- ")],
    ["1. List", "Numbered list", () => line("1. ")],
    ["Quote", "Callout", () => line("> ")],
    ["Table", "Table", () => wrap("\n| Item | Option A | Option B |\n|---|---|---|\n| Row | Not verified | Not verified |\n", "")],
    ["[1]", "Citation to source #1", () => wrap("[[", "]]", "1")],
  ];

  const regenerate = () =>
    regen &&
    run("section", async () => {
      if (dirty) throw new Error("Save your changes before regenerating a section.");
      const o = await api<{ item: StudioArticle; blockers: string[] }>(`articles/${articleId}/regenerate-section`, { body: { heading: regen.heading, instruction: regen.instruction || undefined, expectedVersion: version } });
      onRegenerated(o);
      setRegen(null);
    }, "Section rewritten from the verified facts");

  return (
    <div className="space-y-4">
      <Card padded={false}>
        <div className="scrollbar-none flex items-center gap-1 overflow-x-auto border-b border-navy-900/[0.06] px-2 py-2">
          {!preview &&
            tools.map(([label, title, fn]) => (
              <button key={label} type="button" title={title} onClick={fn} disabled={locked} className="min-h-9 shrink-0 rounded-lg px-2.5 text-[0.8rem] font-semibold text-navy-900 hover:bg-stone/70">
                {label}
              </button>
            ))}
          <button onClick={() => setPreview(!preview)} className="ml-auto min-h-9 shrink-0 rounded-full bg-stone/70 px-3.5 text-[0.8rem] font-semibold text-navy-900">
            {preview ? "Edit" : "Preview"}
          </button>
        </div>
        {preview ? (
          <div className="mx-auto max-w-[44rem] px-5 py-8">
            <div className="article-body" dangerouslySetInnerHTML={{ __html: rendered }} />
          </div>
        ) : (
          <textarea
            ref={ref}
            value={a.body}
            onChange={(e) => set("body", e.target.value)}
            disabled={locked}
            spellCheck
            placeholder={"Write in Markdown.\n\n## Section heading\n\nParagraph text. Cite sources with [[1]] after a sentence."}
            className="min-h-[60vh] w-full resize-y rounded-b-[20px] border-0 bg-white px-5 py-5 font-mono text-[0.88rem] leading-relaxed text-navy-900 focus:outline-none"
          />
        )}
      </Card>
      <p className="text-[0.75rem] text-ink-faint">Use <code>## Heading</code> for sections (shown in the table of contents) and <code>[[n]]</code> to cite source n from the Sources tab. Raw HTML is not allowed.</p>

      {a.origin === "ai" && sections.length > 0 && (
        <Card>
          <CardTitle action={<Button size="sm" busy={busyAll} onClick={onRegenerateAll} disabled={locked}>Regenerate whole article</Button>}>Sections</CardTitle>
          <ul className="divide-y divide-navy-900/[0.06]">
            {sections.map((s) => (
              <li key={s.heading} className="flex items-center justify-between gap-3 py-2.5">
                <span className="min-w-0 text-[0.88rem] text-navy-900">{s.heading}</span>
                <Button size="sm" variant="subtle" disabled={locked} onClick={() => setRegen({ heading: s.heading!, instruction: "" })}>Regenerate</Button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Modal open={Boolean(regen)} onClose={() => setRegen(null)} title={`Rewrite “${regen?.heading ?? ""}”`}>
        <div className="space-y-4">
          <Field label="Instruction (optional)" hint="E.g. “shorter”, “add a comparison table”, “explain the ISEE equivalent more simply”. Only the verified facts can be used.">
            <Textarea rows={3} value={regen?.instruction ?? ""} onChange={(e) => setRegen((r) => (r ? { ...r, instruction: e.target.value } : r))} />
          </Field>
          <Button variant="primary" className="w-full" busy={busy === "section"} onClick={regenerate}>Rewrite section</Button>
        </div>
      </Modal>
    </div>
  );
}

/* ═════════════════════════ Details tab ═════════════════════════ */

function DetailsTab({ a, set, meta, published }: { a: StudioArticle; set: <K extends keyof StudioArticle>(k: K, v: StudioArticle[K]) => void; meta: Meta; published: boolean }) {
  const unis = meta.universities.filter((u) => u.countryId === a.countryId);
  const schs = meta.scholarships.filter((s) => s.countryId === a.countryId);
  const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  return (
    <div className="space-y-6">
      <Card>
        <CardTitle>Article</CardTitle>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Slug (URL)" hint={published ? "Locked: the article is published." : `/insights/${a.slug || "…"}`} className="sm:col-span-2">
            <Input value={a.slug} disabled={published} onChange={(e) => set("slug", e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, "-"))} />
          </Field>
          <Field label="Excerpt" hint={`${a.excerpt.length}/220 · shown on article cards`} className="sm:col-span-2">
            <Textarea rows={2} value={a.excerpt} onChange={(e) => set("excerpt", e.target.value)} />
          </Field>
          <Field label="Category">
            <Select value={a.category} onChange={(e) => set("category", e.target.value as StudioArticle["category"])} options={CATEGORY_KEYS.map((k) => ({ value: k, label: STRATEGIES[k].label }))} />
          </Field>
          <Field label="Country">
            <Select value={a.countryId} onChange={(e) => set("countryId", e.target.value)} options={(meta.countries.length ? meta.countries : [{ id: "it", name: "Italy" }]).map((c) => ({ value: c.id, label: c.name }))} />
          </Field>
          <Field label="Academic year" hint="Required for time-sensitive articles, e.g. 2026/2027">
            <Input value={a.academicYear ?? ""} placeholder="2026/2027" onChange={(e) => set("academicYear", e.target.value || undefined)} />
          </Field>
          <Field label="Target audience">
            <Input value={a.audience} onChange={(e) => set("audience", e.target.value)} />
          </Field>
        </div>
        {(unis.length > 0 || schs.length > 0) && (
          <div className="mt-5 space-y-3">
            {unis.length > 0 && (
              <ChipPicker label="Universities" items={unis} selected={a.universityIds} onToggle={(id) => set("universityIds", toggle(a.universityIds, id))} />
            )}
            {schs.length > 0 && (
              <ChipPicker label="Scholarships" items={schs} selected={a.scholarshipIds} onToggle={(id) => set("scholarshipIds", toggle(a.scholarshipIds, id))} />
            )}
          </div>
        )}
      </Card>
      <Card>
        <CardTitle>Search appearance</CardTitle>
        <div className="space-y-4">
          <Field label="SEO title" hint={`${a.seoTitle.length}/60`}>
            <Input value={a.seoTitle} onChange={(e) => set("seoTitle", e.target.value)} />
          </Field>
          <Field label="Meta description" hint={`${a.metaDescription.length}/155`}>
            <Textarea rows={2} value={a.metaDescription} onChange={(e) => set("metaDescription", e.target.value)} />
          </Field>
          <Field label="Tags" hint="Comma separated">
            <Input value={a.tags.join(", ")} onChange={(e) => set("tags", e.target.value.split(",").map((t) => t.trim()).filter(Boolean).slice(0, 8))} />
          </Field>
          <div className="rounded-xl bg-white p-4 ring-1 ring-navy-900/[0.07]">
            <p className="text-[0.75rem] text-emerald-800">skolar · /insights/{a.slug}</p>
            <p className="mt-0.5 text-[1.05rem] text-[#1a0dab]">{a.seoTitle || a.title}</p>
            <p className="mt-0.5 text-[0.82rem] text-ink-soft">{a.metaDescription || a.excerpt}</p>
          </div>
        </div>
      </Card>
    </div>
  );
}

function ChipPicker({ label, items, selected, onToggle }: { label: string; items: Array<{ id: string; name: string }>; selected: string[]; onToggle: (id: string) => void }) {
  return (
    <div>
      <p className="mb-1.5 text-[0.8rem] font-semibold text-navy-900">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {items.map((i) => (
          <button key={i.id} type="button" onClick={() => onToggle(i.id)} className={`min-h-9 rounded-full px-3 text-[0.8rem] ${selected.includes(i.id) ? "bg-navy-900 text-paper" : "bg-stone/60 text-navy-900"}`}>
            {i.name}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ═════════════════════════ Image tab ═════════════════════════ */

function ImageTab({
  a,
  set,
  articleId,
  dirty,
  onServer,
}: {
  a: StudioArticle;
  set: <K extends keyof StudioArticle>(k: K, v: StudioArticle[K]) => void;
  articleId: string;
  dirty: boolean;
  onServer: (o: { item: StudioArticle; blockers?: string[] }) => void;
}) {
  const media = useApi<{ backend: string | null; library: Array<{ url: string; title: string; credit: string; license: string; sourceUrl: string }>; formats: Record<string, string> }>("media");
  const [file, setFile] = useState<File | null>(null);
  const [form, setForm] = useState({ alt: "", credit: "", license: "", sourceUrl: "", rights: false });
  const [libAlt, setLibAlt] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const { busy, run } = useAction();
  const cover = a.coverImage;
  const gallery = [...(a.images ?? [])].reverse();
  const needSave = () => {
    if (dirty) throw new Error("Save your other changes first.");
  };

  const call = (key: string, path: string, init: { method?: string; body?: unknown; form?: FormData }, ok?: string) =>
    run(key, async () => {
      needSave();
      onServer(await api<{ item: StudioArticle; blockers: string[] }>(`articles/${articleId}/${path}`, init));
    }, ok);

  const upload = () => {
    if (!file) return;
    const fd = new FormData();
    fd.set("file", file);
    fd.set("alt", form.alt);
    fd.set("credit", form.credit);
    fd.set("license", form.license);
    fd.set("sourceUrl", form.sourceUrl);
    fd.set("rightsConfirmed", String(form.rights));
    void call("upload", "images/upload", { form: fd }, "Uploaded to Vercel Blob and set as cover").then(() => setFile(null));
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardTitle
          action={
            <Button size="sm" variant="primary" busy={busy === "gen"} onClick={() => call("gen", "images/generate", { body: {} }, "New image generated")}>
              {cover ? "Generate a different image" : "Generate image"}
            </Button>
          }
        >
          Cover image
        </CardTitle>
        {a.imageState?.status === "failed" && (
          <p className="mb-4 rounded-xl bg-red-50 p-3 text-[0.82rem] text-red-800">
            Image generation failed: {a.imageState.error} — try again, upload an image, or pick a library photo.
          </p>
        )}
        {cover ? (
          <div className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-[1.6fr_1fr]">
              <figure>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={cover.url} alt={cover.alt} className="aspect-[16/10] w-full rounded-2xl bg-stone object-cover" />
                <figcaption className="mt-1 text-[0.7rem] text-ink-faint">Article cover (16:10)</figcaption>
              </figure>
              <figure>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={cover.cardUrl ?? cover.url} alt="" className="aspect-[4/3] w-full rounded-2xl bg-stone object-cover" />
                <figcaption className="mt-1 text-[0.7rem] text-ink-faint">Listing card (4:3){cover.cardUrl ? "" : " — cropped from the cover"}</figcaption>
              </figure>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Alt text (required)" hint="Describe the image for screen readers." className="sm:col-span-2">
                <Input value={cover.alt} onChange={(e) => set("coverImage", { ...cover, alt: e.target.value })} />
              </Field>
              <Field label="Caption (optional)">
                <Input value={cover.caption ?? ""} onChange={(e) => set("coverImage", { ...cover, caption: e.target.value || undefined })} />
              </Field>
              <Field label="Credit / licence">
                <Input value={[cover.credit, cover.license].filter(Boolean).join(" · ") || "SKOLAR"} disabled />
              </Field>
            </div>
            <p className="text-[0.72rem] text-ink-faint">Editing the article never regenerates its image; only the buttons here do.</p>
          </div>
        ) : (
          <p className="rounded-xl bg-gold-100/60 p-4 text-[0.85rem] text-navy-900">No cover yet — publishing needs one. Generate a SKOLAR image, upload one SKOLAR may use, or choose a credited website photo.</p>
        )}
      </Card>

      {gallery.length > 0 && (
        <Card>
          <CardTitle>Gallery ({gallery.length})</CardTitle>
          <ul className="grid gap-4 sm:grid-cols-2">
            {gallery.map((img) => {
              const isCover = cover?.imageId === img.id || cover?.url === img.url;
              return (
                <li key={img.id} className={`overflow-hidden rounded-2xl bg-white ring-2 ${isCover ? "ring-gold-500" : "ring-navy-900/[0.06]"}`}>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={img.cardUrl ?? img.url} alt="" loading="lazy" className="aspect-[4/3] w-full bg-stone object-cover" />
                  <div className="space-y-2 p-3">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {isCover && <Badge tone="gold">Cover</Badge>}
                      <Badge>{img.source === "generated" ? media.data?.formats?.[img.format ?? ""] ?? img.format : img.source === "upload" ? "Upload" : "Library photo"}</Badge>
                      {img.qc && <Badge tone={img.qc.passed ? "green" : "red"}>{img.qc.passed ? `QC passed${img.qc.attempts > 1 ? ` (${img.qc.attempts} tries)` : ""}` : "QC issues"}</Badge>}
                    </div>
                    <p className="text-[0.72rem] text-ink-faint">
                      v{img.version} · {img.provider ?? img.source}
                      {img.model ? ` · ${img.model}` : ""} · {timeAgo(img.createdAt)}
                    </p>
                    {img.credit && <p className="text-[0.72rem] text-ink-faint">Credit: {img.credit}{img.license ? ` (${img.license})` : ""}</p>}
                    {(img.concept || img.prompt) && (
                      <button className="text-[0.75rem] font-semibold text-gold-600" onClick={() => setOpen(open === img.id ? null : img.id)}>
                        {open === img.id ? "Hide" : "Show"} concept & prompt
                      </button>
                    )}
                    {open === img.id && (
                      <div className="rounded-xl bg-stone/40 p-2.5 text-[0.72rem] leading-snug text-ink-soft">
                        {img.concept && <p><strong className="text-navy-900">Concept:</strong> {img.concept}</p>}
                        {img.prompt && <p className="mt-1"><strong className="text-navy-900">Prompt/brief:</strong> {img.prompt}</p>}
                        {img.qc?.problems.length ? <p className="mt-1 text-red-700">{img.qc.problems.join("; ")}</p> : null}
                      </div>
                    )}
                    <div className="flex gap-1.5 pt-1">
                      {!isCover && <Button size="sm" busy={busy === `sel-${img.id}`} onClick={() => call(`sel-${img.id}`, "images/select", { body: { imageId: img.id } }, "Cover changed")}>Use as cover</Button>}
                      {!isCover && (
                        <Button size="sm" variant="subtle" busy={busy === `del-${img.id}`} onClick={() => confirm("Delete this image? Its file is removed from Vercel Blob.") && call(`del-${img.id}`, `images/${img.id}`, { method: "DELETE" }, "Image deleted")}>
                          Delete
                        </Button>
                      )}
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      <Card>
        <CardTitle>Upload or replace</CardTitle>
        {media.data && !media.data.backend ? (
          <p className="text-sm text-red-700">Vercel Blob is not configured (BLOB_READ_WRITE_TOKEN) — see Integrations.</p>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Image file" hint="JPEG, PNG, WebP or AVIF, up to 8 MB. Optimised to WebP and stored in Vercel Blob." className="sm:col-span-2">
              <input type="file" accept="image/jpeg,image/png,image/webp,image/avif" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="block w-full text-sm" />
            </Field>
            <Field label="Alt text" className="sm:col-span-2"><Input value={form.alt} onChange={(e) => setForm({ ...form, alt: e.target.value })} /></Field>
            <Field label="Credit (author / owner)"><Input value={form.credit} onChange={(e) => setForm({ ...form, credit: e.target.value })} /></Field>
            <Field label="Licence"><Input value={form.license} placeholder="e.g. Owned by SKOLAR, CC BY 4.0" onChange={(e) => setForm({ ...form, license: e.target.value })} /></Field>
            <Field label="Source URL (optional)" className="sm:col-span-2"><Input value={form.sourceUrl} onChange={(e) => setForm({ ...form, sourceUrl: e.target.value })} /></Field>
            <label className="flex items-start gap-3 text-[0.85rem] text-navy-900 sm:col-span-2">
              <input type="checkbox" checked={form.rights} onChange={(e) => setForm({ ...form, rights: e.target.checked })} className="mt-1 h-4 w-4" />
              SKOLAR owns this image or has a licence that allows using it here. No university logos, crests or official seals.
            </label>
            <Button variant="primary" busy={busy === "upload"} disabled={!file || !form.alt || !form.rights} onClick={upload} className="sm:col-span-2">Upload & use as cover</Button>
          </div>
        )}
      </Card>

      {media.data && (
        <Card>
          <CardTitle>Credited website photos</CardTitle>
          <Field label="Alt text for the chosen photo">
            <Input value={libAlt} onChange={(e) => setLibAlt(e.target.value)} placeholder="Describe what the photo shows" />
          </Field>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {media.data.library.map((m) => (
              <button
                key={m.url}
                type="button"
                disabled={libAlt.trim().length < 3 || busy !== null}
                title={libAlt.trim().length < 3 ? "Write alt text first" : `${m.title} — ${m.credit} (${m.license})`}
                onClick={() => call(`lib-${m.url}`, "images/library", { body: { url: m.url, alt: libAlt } }, "Photo set as cover")}
                className={`group overflow-hidden rounded-xl text-left ring-2 disabled:opacity-60 ${cover?.url === m.url ? "ring-gold-500" : "ring-transparent"}`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={m.url} alt="" loading="lazy" className="aspect-[4/3] w-full bg-stone object-cover" />
                <span className="block truncate px-1 py-1 text-[0.7rem] text-ink-faint">{m.title}</span>
              </button>
            ))}
          </div>
          <p className="mt-2 text-[0.72rem] text-ink-faint">These photos are not of Italian universities — use them as illustrative images only.</p>
        </Card>
      )}
    </div>
  );
}

/* ═════════════════════════ Checks tab ═════════════════════════ */

function ChecksTab({ a, set, gaps, onRecheck, busy }: { a: StudioArticle; set: <K extends keyof StudioArticle>(k: K, v: StudioArticle[K]) => void; gaps: string[]; onRecheck: () => void; busy: boolean }) {
  const [showFacts, setShowFacts] = useState(false);
  const counts = a.claims.reduce<Record<string, number>>((m, c) => ({ ...m, [c.status]: (m[c.status] ?? 0) + 1 }), {});
  const updateSource = (i: number, patch: Partial<ArticleSource>) => set("sources", a.sources.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const addSource = () => set("sources", [...a.sources, { n: Math.max(0, ...a.sources.map((s) => s.n)) + 1, title: "", url: "https://", type: "official_university", accessedAt: new Date().toISOString().slice(0, 10) }]);

  return (
    <div className="space-y-6">
      <Card>
        <CardTitle action={<Button size="sm" busy={busy} onClick={onRecheck}>Re-run checks</Button>}>Editorial warnings</CardTitle>
        {a.warnings.length === 0 ? (
          <p className="text-sm text-emerald-800">No warnings.</p>
        ) : (
          <ul className="space-y-2.5">
            {a.warnings.map((w, i) => (
              <li key={i} className={`rounded-xl p-3 text-[0.85rem] ${w.severity === "block" ? "bg-red-50 text-red-900" : w.severity === "warn" ? "bg-gold-100/70 text-navy-900" : "bg-stone/50 text-ink-soft"}`}>
                <p className="flex flex-wrap items-center gap-2">
                  <Badge tone={w.severity === "block" ? "red" : w.severity === "warn" ? "gold" : "grey"}>{w.severity === "block" ? "Must fix" : w.severity === "warn" ? "Check" : "Note"}</Badge>
                  <span className="font-medium">{w.message}</span>
                  {w.origin === "ai" && <span className="text-[0.7rem] text-ink-faint">AI reviewer</span>}
                </p>
                {w.excerpt && <p className="mt-1.5 border-l-2 border-current/20 pl-2.5 text-[0.8rem] italic opacity-80">“{w.excerpt}”</p>}
              </li>
            ))}
          </ul>
        )}
        {gaps.length > 0 && (
          <div className="mt-4 rounded-xl bg-stone/40 p-3 text-[0.8rem] text-ink-soft">
            <p className="font-semibold text-navy-900">Research could not verify</p>
            {gaps.map((g, i) => <p key={i}>• {g}</p>)}
          </div>
        )}
      </Card>

      <Card>
        <CardTitle>Claims ({a.claims.length})</CardTitle>
        <div className="mb-3 flex flex-wrap gap-1.5">
          {Object.entries(counts).map(([k, n]) => <Badge key={k} tone={k === "verified" ? "green" : k === "partially_verified" || k === "outdated" ? "gold" : "red"}>{VERIFICATION_LABEL[k]}: {n}</Badge>)}
        </div>
        <ul className="divide-y divide-navy-900/[0.06]">
          {a.claims.map((c) => (
            <li key={c.id} className="py-2.5 text-[0.84rem]">
              <div className="flex items-start gap-2">
                <Status value={c.status} />
                <span className="min-w-0 flex-1 text-navy-900">{c.text}</span>
              </div>
              <p className="mt-1 pl-1 text-[0.73rem] text-ink-faint">
                {c.sourceNs.length ? `Sources ${c.sourceNs.join(", ")}` : "No citation"}
                {c.note ? ` · ${c.note}` : ""}
              </p>
            </li>
          ))}
        </ul>
      </Card>

      <Card>
        <CardTitle action={<Button size="sm" onClick={addSource}>Add source</Button>}>Sources</CardTitle>
        <ul className="space-y-4">
          {a.sources.map((s, i) => (
            <li key={i} className="rounded-xl bg-paper p-3 ring-1 ring-navy-900/[0.06]">
              <div className="grid gap-2 sm:grid-cols-[3rem_1fr_11rem]">
                <Input aria-label="Number" type="number" value={s.n} onChange={(e) => updateSource(i, { n: Number(e.target.value) })} />
                <Input aria-label="Title" value={s.title} placeholder="Page title" onChange={(e) => updateSource(i, { title: e.target.value })} />
                <Select aria-label="Type" value={s.type} onChange={(e) => updateSource(i, { type: e.target.value as ArticleSource["type"] })} options={[
                  { value: "official_university", label: "University" },
                  { value: "government", label: "Government" },
                  { value: "scholarship_authority", label: "Scholarship body" },
                  { value: "application_portal", label: "Official portal" },
                  { value: "publication", label: "Publication" },
                  { value: "other", label: "Other" },
                ]} />
              </div>
              <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_8rem_8rem_auto]">
                <Input aria-label="URL" value={s.url} onChange={(e) => updateSource(i, { url: e.target.value })} />
                <Input aria-label="Academic year" value={s.academicYear ?? ""} placeholder="2026/2027" onChange={(e) => updateSource(i, { academicYear: e.target.value || undefined })} />
                <Input aria-label="Accessed" type="date" value={s.accessedAt ?? ""} onChange={(e) => updateSource(i, { accessedAt: e.target.value || undefined })} />
                <Button size="sm" variant="subtle" onClick={() => set("sources", a.sources.filter((_, j) => j !== i))}>Remove</Button>
              </div>
            </li>
          ))}
        </ul>
      </Card>

      {a.facts.length > 0 && (
        <Card>
          <CardTitle action={<Button size="sm" variant="subtle" onClick={() => setShowFacts(!showFacts)}>{showFacts ? "Hide" : "Show"}</Button>}>Research evidence ({a.facts.length} facts)</CardTitle>
          {showFacts && (
            <ul className="space-y-3">
              {a.facts.map((f) => (
                <li key={f.id} className="text-[0.82rem]">
                  <p className="flex items-start gap-2 text-navy-900"><Status value={f.status} /> <span>{f.statement} <span className="text-ink-faint">[source {f.sourceN}{f.academicYear ? ` · ${f.academicYear}` : ""}]</span></span></p>
                  <p className="mt-1 border-l-2 border-gold-300 pl-2.5 text-[0.78rem] italic text-ink-soft">“{f.quote}”</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
    </div>
  );
}

/* ═════════════════════════ CTA tab ═════════════════════════ */

function CtaTab({ a, set, ctas }: { a: StudioArticle; set: <K extends keyof StudioArticle>(k: K, v: StudioArticle[K]) => void; ctas: Meta["ctas"] }) {
  return (
    <Card>
      <CardTitle>Call to action</CardTitle>
      <p className="mb-4 text-[0.82rem] text-ink-soft">Shown after the article. Keep it relevant and honest — never promise admission, scholarships or visas, never claim partnerships.</p>
      <div className="space-y-2">
        {ctas.map((c) => (
          <button key={c.key} type="button" onClick={() => set("cta", { key: c.key, text: c.text, label: c.label })} className={`block w-full rounded-xl p-3 text-left text-[0.85rem] ring-1 ${a.cta?.key === c.key ? "bg-navy-900 text-paper ring-navy-900" : "bg-white text-navy-900 ring-navy-900/10"}`}>
            {c.text}
            <span className="mt-1 block text-[0.72rem] opacity-70">Button: {c.label}</span>
          </button>
        ))}
        <button type="button" onClick={() => set("cta", undefined)} className={`block w-full rounded-xl p-3 text-left text-[0.85rem] ring-1 ${!a.cta ? "bg-navy-900 text-paper" : "bg-white text-ink-soft ring-navy-900/10"}`}>No call to action</button>
      </div>
      {a.cta && (
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <Field label="Text" className="sm:col-span-2"><Textarea rows={2} value={a.cta.text} onChange={(e) => set("cta", { ...a.cta!, key: "custom", text: e.target.value })} /></Field>
          <Field label="Button label"><Input value={a.cta.label} onChange={(e) => set("cta", { ...a.cta!, key: "custom", label: e.target.value })} /></Field>
        </div>
      )}
    </Card>
  );
}

/* ═════════════════════════ Publish panel & modals ═════════════════════════ */

const PUBLISH_STATE_TEXT: Record<string, { label: string; tone: "green" | "gold" | "red" | "blue" | "grey"; help: string }> = {
  deploying: { label: "Committed — deploying", tone: "blue", help: "The commit is in GitHub; waiting for the production deployment to finish." },
  verifying: { label: "Deployed — verifying", tone: "blue", help: "Checking that the live page shows exactly this version." },
  awaiting_push: { label: "Written locally — not live", tone: "gold", help: "GitHub is not configured, so the file was written to content/insights on this computer. Commit and push it; Studio will mark it published once the live page is verified." },
  published: { label: "Live and verified", tone: "green", help: "The production page shows this version." },
  failed: { label: "Failed", tone: "red", help: "See the error below. Retrying never creates a duplicate commit." },
};

function PublishPanel({ data, a, onSchedule, onAction, busy, onReject, dirty }: { data: Loaded; a: StudioArticle; onSchedule: () => void; onAction: (a: string, extra?: Record<string, unknown>, success?: string) => Promise<void>; busy: string | null; onReject: () => void; dirty: boolean }) {
  const p = a.publish;
  const st = p ? PUBLISH_STATE_TEXT[p.state] : null;
  const inFlight = p && ["deploying", "verifying", "awaiting_push"].includes(p.state);
  return (
    <>
      <Card>
        <CardTitle>Publishing</CardTitle>
        {data.blockers.length > 0 && a.status !== "published" && (
          <div className="mb-4 rounded-xl bg-stone/50 p-3 text-[0.8rem] text-ink-soft">
            <p className="mb-1 font-semibold text-navy-900">Before publishing</p>
            <ul className="space-y-0.5">{data.blockers.map((b, i) => <li key={i}>• {b}</li>)}</ul>
          </div>
        )}
        {a.status === "scheduled" && a.schedule?.at && (
          <p className="mb-3 rounded-xl bg-sky-50 p-3 text-[0.85rem] text-sky-900">
            Scheduled for <strong>{fmtDateTime(a.schedule.at, data.timezone)}</strong>{a.schedule.pinned ? " (manual time)" : ""}
          </p>
        )}
        {st && (
          <div className="mb-3 rounded-xl bg-white p-3 ring-1 ring-navy-900/[0.07]">
            <Badge tone={st.tone}>{p?.isUpdate && p.state !== "published" ? `Update: ${st.label}` : st.label}</Badge>
            <p className="mt-1.5 text-[0.75rem] leading-snug text-ink-soft">{st.help}</p>
            {p?.lastError && p.state !== "published" && <p className="mt-1.5 text-[0.75rem] leading-snug text-red-700">{p.failedStep ? `${p.failedStep}: ` : ""}{p.lastError}</p>}
          </div>
        )}
        <div className="flex flex-col gap-2">
          {a.status === "approved" && <Button variant="primary" onClick={onSchedule} disabled={dirty}>Schedule…</Button>}
          {a.status === "scheduled" && (
            <>
              <Button onClick={onSchedule}>Change time…</Button>
              <Button variant="subtle" busy={busy === "unschedule"} onClick={() => onAction("unschedule", undefined, "Schedule cancelled")}>Cancel schedule</Button>
            </>
          )}
          {inFlight && <Button busy={busy === "check_publish"} onClick={() => onAction("check_publish", undefined, "Checked")}>Check deployment now</Button>}
          {p?.state === "failed" && <Button variant="gold" busy={busy === "retry_publish"} onClick={() => onAction("retry_publish", undefined, "Retry started")}>Retry {p.failedStep === "deployment" ? "deployment" : "publishing"}</Button>}
          {["draft", "needs_review"].includes(a.status) && <Button variant="danger" onClick={onReject}>Reject</Button>}
          {["rejected", "approved"].includes(a.status) && <Button variant="subtle" busy={busy === "reopen"} onClick={() => onAction("reopen")}>Back to draft</Button>}
          {a.status === "published" && !inFlight && <Button busy={busy === "publish"} onClick={() => onAction("publish", undefined, "Update committed")}>Re-publish changes</Button>}
        </div>
        {p && (
          <dl className="mt-4 space-y-1.5 border-t border-navy-900/[0.06] pt-3 text-[0.75rem] text-ink-soft">
            {p.url && <div className="flex justify-between gap-2"><dt>URL</dt><dd>{p.state === "published" ? <a href={p.url} target="_blank" rel="noopener noreferrer" className="underline">{p.url}</a> : p.url}</dd></div>}
            {p.path && <div className="flex justify-between gap-2"><dt>File</dt><dd className="truncate">{p.path}</dd></div>}
            {p.commitSha && <div className="flex justify-between gap-2"><dt>Commit</dt><dd>{p.repo ? <a className="underline" href={`https://github.com/${p.repo}/commit/${p.commitSha}`} target="_blank" rel="noopener noreferrer">{p.commitSha.slice(0, 7)}</a> : p.commitSha.slice(0, 7)}</dd></div>}
            {p.deploymentId && <div className="flex justify-between gap-2"><dt>Deployment</dt><dd className="truncate">{p.deploymentProvider} {p.deploymentId}</dd></div>}
            {p.verifiedAt && <div className="flex justify-between gap-2"><dt>Verified</dt><dd>{fmtDateTime(p.verifiedAt, data.timezone)}</dd></div>}
          </dl>
        )}
        <p className="mt-4 text-[0.72rem] leading-snug text-ink-faint">
          Publishes to {data.targets.github ? `GitHub ${data.targets.github}` : data.targets.localFiles ? "content/insights in this folder (commit & push to deploy)" : "— not configured"}
          {data.targets.siteRecord ? " + homepage listing (Firestore)" : ""}. An article is marked published only after the live page is verified.
        </p>
      </Card>
      {(a.publishHistory?.length ?? 0) > 0 && (
        <Card>
          <CardTitle>Publishing history</CardTitle>
          <ul className="space-y-1.5 text-[0.75rem] text-ink-soft">
            {[...(a.publishHistory ?? [])].reverse().slice(0, 12).map((h, i) => (
              <li key={i} className={h.action === "failed" ? "text-red-700" : h.action === "verified" ? "text-emerald-800" : ""}>
                {fmtDateTime(h.at, data.timezone)} · {h.message}
              </li>
            ))}
          </ul>
        </Card>
      )}
      {a.schedule?.history && a.schedule.history.length > 0 && (
        <Card>
          <CardTitle>Schedule history</CardTitle>
          <ul className="space-y-1.5 text-[0.75rem] text-ink-soft">
            {[...a.schedule.history].reverse().slice(0, 8).map((h, i) => (
              <li key={i}>{fmtDateTime(h.at, data.timezone)} · {h.reason}{h.to ? ` → ${fmtDateTime(h.to, data.timezone)}` : ""}</li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}

function ScheduleModal({ open, onClose, nextSlot, tz, busy, onConfirm }: { open: boolean; onClose: () => void; nextSlot: string | null; tz: string; busy: boolean; onConfirm: (at: string | null, expectedSlot?: string) => void }) {
  const [custom, setCustom] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const toUtc = (local: string) => {
    // local is "YYYY-MM-DDTHH:mm" in the publishing timezone
    const [d, t] = local.split("T");
    if (!d || !t) return null;
    const [y, m, day] = d.split("-").map(Number);
    const [hh, mm] = t.split(":").map(Number);
    const guess = Date.UTC(y, m - 1, day, hh, mm);
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(guess));
    const g = (k: string) => Number(parts.find((p) => p.type === k)?.value);
    const asTz = Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute"));
    return new Date(guess - (asTz - guess)).toISOString();
  };
  return (
    <Modal open={open} onClose={onClose} title="Schedule publication">
      <div className="space-y-5">
        {nextSlot ? (
          <div className="rounded-2xl bg-navy-900 p-5 text-paper">
            <p className="text-[0.78rem] text-paper/60">Next free slot in the queue</p>
            <p className="display mt-1 text-[1.6rem]">{fmtDateTime(nextSlot, tz)}</p>
            <p className="text-[0.75rem] text-paper/50">{tz}</p>
            <Button variant="gold" className="mt-4 w-full" busy={busy} onClick={() => onConfirm(null, nextSlot)}>Confirm this slot</Button>
          </div>
        ) : (
          <p className="text-sm text-red-700">No free slot found — check publishing days and times in Settings.</p>
        )}
        <div>
          <Field label={`Or pick a specific time (${tz})`} hint="A manual time is kept fixed when the queue is recalculated.">
            <Input type="datetime-local" value={custom} onChange={(e) => setCustom(e.target.value)} />
          </Field>
          {err && <p className="mt-2 text-sm text-red-700">{err}</p>}
          <Button className="mt-3 w-full" disabled={!custom} busy={busy} onClick={() => {
            const at = toUtc(custom);
            if (!at) return setErr("Invalid date");
            setErr(null);
            onConfirm(at);
          }}>Schedule at this time</Button>
        </div>
      </div>
    </Modal>
  );
}

function RejectModal({ open, onClose, onConfirm, busy }: { open: boolean; onClose: () => void; onConfirm: (reason: string) => void; busy: boolean }) {
  const [reason, setReason] = useState("");
  return (
    <Modal open={open} onClose={onClose} title="Reject draft">
      <Field label="Reason (helps improve future drafts)">
        <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
      </Field>
      <Button variant="danger" className="mt-4 w-full" busy={busy} onClick={() => onConfirm(reason)}>Reject</Button>
    </Modal>
  );
}

export { ApiError };
