"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { CATEGORY_KEYS, STRATEGIES } from "../core/strategies";
import type { CategoryKey, CtaTemplate, StudioSettings, UsageDay } from "../core/types";
import { api, Badge, Button, Card, CardTitle, Empty, ErrorNote, Field, Input, Loading, Modal, PageHeader, Select, Textarea, Toggle, fmtDateTime, nf, timeAgo, useAction, useApi } from "./kit";

/* ═════════════════════════ Integrations ═════════════════════════ */

interface ProviderRow {
  id: string;
  name: string;
  kind: "groq" | "openai_compatible";
  baseUrl: string;
  model: string;
  keyHint: string;
  keySource: string;
  enabled: boolean;
  priority: number;
  structuredOutput: "json_schema" | "json_object";
  capabilities: string[];
  pricing?: { inputPerMTok: number; outputPerMTok: number; currency: string } | null;
  state: { lastSuccessAt?: string; lastErrorAt?: string; lastError?: string; rateLimitedUntil?: string; needsAttention?: string };
}

const STATE_BADGE: Record<string, { label: string; tone: "green" | "gold" | "red" | "grey" | "blue" }> = {
  connected: { label: "Connected", tone: "green" },
  configured_untested: { label: "Configured — not tested", tone: "gold" },
  not_configured: { label: "Not configured", tone: "grey" },
  waiting_access: { label: "Waiting for access", tone: "blue" },
  unavailable: { label: "Temporarily unavailable", tone: "gold" },
  failing: { label: "Failing", tone: "red" },
  disabled: { label: "Disabled", tone: "grey" },
};

interface IntegrationRow {
  key: string;
  name: string;
  group: string;
  state: string;
  detail: string;
  requirement: string | null;
  guidance: string;
  testable: boolean;
  lastCheckAt: string | null;
  lastOkAt: string | null;
  lastError: string | null;
}

function IntegrationCentre() {
  const { data, error, reload } = useApi<{
    items: IntegrationRow[];
    workers: Array<{ id: string; host: string; platform: string; role: string; state: string; message: string; heartbeatAt: string; startedAt: string; online: boolean; leader: boolean; currentJobId?: string | null }>;
    encryption: { configured: boolean; strong: boolean; keyId: string | null; previousKeyId: string | null; problem: string | null };
  }>("integrations/status", { refreshMs: 30_000 });
  const { busy, run } = useAction();
  const [open, setOpen] = useState<string | null>(null);
  const test = (key: string) => run(`t-${key}`, async () => {
    await api(`integrations/${key}/test`, { body: {} });
    await reload();
  });
  const testAll = () => run("all", async () => {
    for (const i of data?.items ?? []) if (i.testable && i.state !== "not_configured") await api(`integrations/${i.key}/test`, { body: {} }).catch(() => undefined);
    await reload();
  }, "All configured integrations tested");
  const reencrypt = () => run("reenc", async () => {
    const r = await api<{ migrated: number; failed: string[] }>("security/reencrypt", { body: {} });
    await reload();
    return r;
  }).then((r) => r && alert(`Re-encrypted ${r.migrated} key(s).${r.failed.length ? ` Could not decrypt: ${r.failed.join(", ")}` : ""}`));

  if (error && !data) return <ErrorNote error={error} onRetry={reload} />;
  if (!data) return <Loading />;
  const groups = [...new Set(data.items.map((i) => i.group))];

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-[0.85rem] text-ink-soft">“Connected” only appears after a real test of the current configuration succeeds.</p>
        <Button busy={busy === "all"} onClick={testAll}>Test all configured</Button>
      </div>
      <div className="space-y-6">
        {groups.map((g) => (
          <section key={g}>
            <h2 className="mb-2 text-[0.78rem] font-semibold uppercase tracking-[0.12em] text-ink-faint">{g}</h2>
            <ul className="space-y-2">
              {data.items.filter((i) => i.group === g).map((i) => {
                const b = STATE_BADGE[i.state] ?? STATE_BADGE.not_configured;
                return (
                  <li key={i.key} className="rounded-[18px] border border-navy-900/[0.07] bg-white p-4">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <p className="flex flex-wrap items-center gap-2 text-[0.92rem] font-semibold text-navy-900">
                          {i.name} <Badge tone={b.tone}>{b.label}</Badge>
                        </p>
                        <p className="mt-1 break-words text-[0.8rem] leading-snug text-ink-soft">{i.detail}</p>
                        {i.requirement && <p className="mt-1 text-[0.75rem] text-gold-600">Needs: {i.requirement}</p>}
                        <p className="mt-1 text-[0.72rem] text-ink-faint">
                          Last check {i.lastCheckAt ? timeAgo(i.lastCheckAt) : "never"} · last success {i.lastOkAt ? timeAgo(i.lastOkAt) : "never"}
                        </p>
                        {i.lastError && i.state !== "connected" && <p className="mt-1 break-words text-[0.75rem] text-red-700">{i.lastError}</p>}
                        {open === i.key && <p className="mt-2 rounded-xl bg-stone/40 p-2.5 text-[0.75rem] leading-snug text-ink-soft">{i.guidance}</p>}
                      </div>
                      <div className="flex shrink-0 gap-1.5">
                        <Button size="sm" variant="subtle" onClick={() => setOpen(open === i.key ? null : i.key)}>{open === i.key ? "Hide setup" : "Setup"}</Button>
                        {i.testable && <Button size="sm" busy={busy === `t-${i.key}`} onClick={() => test(i.key)}>Test</Button>}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>

      <Card className="mt-8">
        <CardTitle>Worker instances</CardTitle>
        {data.workers.length === 0 ? (
          <p className="text-sm text-ink-faint">No worker has started yet. Run <code className="rounded bg-stone px-1.5">npm run studio:worker</code> on the automation computer.</p>
        ) : (
          <ul className="divide-y divide-navy-900/[0.06]">
            {data.workers.map((w) => (
              <li key={w.id} className="py-2.5 text-[0.82rem]">
                <p className="flex flex-wrap items-center gap-2 font-semibold text-navy-900">
                  <span className={`h-2 w-2 rounded-full ${w.online ? "bg-emerald-500" : "bg-stone-dark"}`} />
                  {w.id}
                  {w.leader && w.online && <Badge tone="navy">Leader</Badge>}
                  {!w.leader && w.online && <Badge>Follower</Badge>}
                  {!w.online && <Badge>Offline</Badge>}
                </p>
                <p className="text-ink-soft">{w.platform} · {w.message}</p>
                <p className="text-[0.72rem] text-ink-faint">Heartbeat {timeAgo(w.heartbeatAt)} · started {fmtDateTime(w.startedAt)}{w.currentJobId ? ` · working on ${w.currentJobId}` : ""}</p>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-[0.72rem] text-ink-faint">Only the leader schedules, publishes, monitors sources and starts automatic jobs; any instance can process queued jobs. Each job has its own lease, so no two instances work on the same job.</p>
      </Card>

      <Card className="mt-6">
        <CardTitle action={data.encryption.configured ? <Button size="sm" busy={busy === "reenc"} onClick={reencrypt}>Re-encrypt stored keys</Button> : undefined}>Credential encryption</CardTitle>
        <p className="text-[0.82rem] text-ink-soft">
          {data.encryption.configured
            ? `AES-256-GCM, key ${data.encryption.keyId}${data.encryption.previousKeyId ? ` (previous key ${data.encryption.previousKeyId} available for rotation)` : ""}.`
            : `Not configured: ${data.encryption.problem} Pasted API keys cannot be saved until STUDIO_ENCRYPTION_KEY is set — nothing is ever stored unencrypted.`}
        </p>
      </Card>
    </>
  );
}

export function Integrations() {
  const prov = useApi<{ items: ProviderRow[]; usage: UsageDay[]; presets: Record<string, { baseUrl: string; model: string; structuredOutput: string }>; canEncrypt: boolean }>("providers");
  const { busy, run } = useAction();
  const [edit, setEdit] = useState<(Partial<ProviderRow> & { apiKey?: string; envVar?: string; keyMode?: "env" | "key" }) | null>(null);
  const [tests, setTests] = useState<Record<string, { ok: boolean; message: string }>>({});

  const test = (id: string) =>
    run(`test-${id}`, async () => {
      const r = await api<{ ok: boolean; message: string }>(`providers/${id}/test`, { body: {} });
      setTests((t) => ({ ...t, [id]: r }));
      await prov.reload();
    });
  const save = () =>
    run("save", async () => {
      if (!edit) return;
      const body: Record<string, unknown> = {
        name: edit.name,
        kind: edit.kind ?? "openai_compatible",
        baseUrl: edit.baseUrl,
        model: edit.model,
        enabled: edit.enabled ?? true,
        priority: Number(edit.priority ?? 10),
        structuredOutput: edit.structuredOutput ?? "json_schema",
        capabilities: edit.capabilities ?? ["json"],
        pricing: edit.pricing ?? null,
      };
      if (edit.keyMode === "env" && edit.envVar) body.envVar = edit.envVar;
      if (edit.keyMode !== "env" && edit.apiKey) body.apiKey = edit.apiKey;
      if (edit.id) await api(`providers/${edit.id}`, { method: "PATCH", body });
      else await api("providers", { body });
      setEdit(null);
      await prov.reload();
    }, "Provider saved");
  const remove = (p: ProviderRow) => confirm(`Remove ${p.name}?`) && run(`del-${p.id}`, async () => {
    await api(`providers/${p.id}`, { method: "DELETE" });
    await prov.reload();
  });
  const toggle = (p: ProviderRow) => run(`tog-${p.id}`, async () => {
    await api(`providers/${p.id}`, { method: "PATCH", body: { enabled: !p.enabled } });
    await prov.reload();
  });

  const usageByProvider = new Map<string, { req: number; inT: number; outT: number; fail: number; rl: number; cost: number | null; cur: string | null }>();
  for (const u of prov.data?.usage ?? []) {
    const k = `${u.providerName} · ${u.model}`;
    const c = usageByProvider.get(k) ?? { req: 0, inT: 0, outT: 0, fail: 0, rl: 0, cost: null, cur: null };
    c.req += u.requests;
    c.inT += u.inputTokens;
    c.outT += u.outputTokens;
    c.fail += u.failures;
    c.rl += u.rateLimits;
    if (u.estimatedCost !== null) {
      c.cost = (c.cost ?? 0) + u.estimatedCost;
      c.cur = u.currency;
    }
    usageByProvider.set(k, c);
  }

  return (
    <>
      <PageHeader title="Integrations" subtitle="Every connection Studio depends on, its real tested status, and what is still missing." />
      <IntegrationCentre />

      <Card className="mt-8">
        <CardTitle action={<Button size="sm" variant="primary" onClick={() => setEdit({ kind: "groq", ...(prov.data?.presets.groq ?? {}), name: "Groq", priority: 2, enabled: true, keyMode: "env", capabilities: ["json"] } as never)}>Add provider</Button>}>Text AI providers</CardTitle>
        <p className="mb-4 text-[0.78rem] text-ink-faint">
          Tried in priority order. On a rate limit, timeout or outage the next eligible provider is used; an invalid key or model marks the provider “needs attention” instead of retrying it.
          Only add keys for accounts you are entitled to use and respect each provider&apos;s terms — fallback is for reliability, not for bypassing limits.
        </p>
        {!prov.data ? <Loading /> : prov.data.items.length === 0 ? (
          <Empty title="No AI provider">Set GROQ_API_KEY in the environment, or add a provider.</Empty>
        ) : (
          <ul className="divide-y divide-navy-900/[0.06]">
            {prov.data.items.map((p) => (
              <li key={p.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-[0.9rem] font-semibold text-navy-900">
                    <span className="grid h-6 w-6 place-items-center rounded-full bg-stone text-[0.7rem]">{p.priority}</span>
                    {p.name}
                    <span className="font-normal text-ink-faint">{p.model}</span>
                    {!p.enabled ? <Badge>Disabled</Badge> : p.state.needsAttention ? <Badge tone="red">Needs attention</Badge> : p.state.rateLimitedUntil && Date.parse(p.state.rateLimitedUntil) > Date.now() ? <Badge tone="gold">Rate-limited</Badge> : <Badge tone="green">Active</Badge>}
                  </p>
                  <p className="text-[0.73rem] text-ink-faint">
                    Key: {p.keySource} ({p.keyHint}) · last success {timeAgo(p.state.lastSuccessAt)}
                    {p.state.rateLimitedUntil && Date.parse(p.state.rateLimitedUntil) > Date.now() ? ` · available again ${timeAgo(p.state.rateLimitedUntil)}` : ""}
                  </p>
                  {(p.state.needsAttention || p.state.lastError) && <p className="text-[0.73rem] text-red-700">{p.state.needsAttention ?? ""} {p.state.lastError ? `Last error ${timeAgo(p.state.lastErrorAt)}: ${p.state.lastError}` : ""}</p>}
                  {tests[p.id] && <p className={`text-[0.75rem] ${tests[p.id].ok ? "text-emerald-700" : "text-red-700"}`}>Test: {tests[p.id].message}</p>}
                </div>
                <div className="flex shrink-0 gap-1.5">
                  <Button size="sm" busy={busy === `test-${p.id}`} onClick={() => test(p.id)}>Test</Button>
                  <Button size="sm" variant="subtle" busy={busy === `tog-${p.id}`} onClick={() => toggle(p)}>{p.enabled ? "Disable" : "Enable"}</Button>
                  <Button size="sm" variant="subtle" onClick={() => setEdit({ ...p, keyMode: p.keySource.startsWith("Environment") ? "env" : "key" })}>Edit</Button>
                  <Button size="sm" variant="subtle" busy={busy === `del-${p.id}`} onClick={() => remove(p)} aria-label="Remove">✕</Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card className="mt-6">
        <CardTitle>API usage — last 30 days</CardTitle>
        {usageByProvider.size === 0 ? <p className="text-sm text-ink-faint">No requests yet.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] text-left text-[0.82rem]">
              <thead className="text-[0.72rem] text-ink-faint"><tr><th className="py-2">Provider · model</th><th>Requests</th><th>Input tokens</th><th>Output tokens</th><th>Failed</th><th>Rate limits</th><th>Est. cost</th></tr></thead>
              <tbody className="divide-y divide-navy-900/[0.06] text-navy-900">
                {[...usageByProvider.entries()].map(([k, u]) => (
                  <tr key={k}><td className="py-2 pr-3">{k}</td><td>{nf(u.req)}</td><td>{nf(u.inT)}</td><td>{nf(u.outT)}</td><td>{u.fail}</td><td>{u.rl}</td><td>{u.cost === null ? "—" : `${u.cost.toFixed(2)} ${u.cur}`}</td></tr>
                ))}
              </tbody>
            </table>
            <p className="mt-3 text-[0.72rem] text-ink-faint">Remaining quota is not shown: providers do not report it reliably. Cost appears once you enter the provider&apos;s pricing.</p>
          </div>
        )}
      </Card>

      <Modal open={Boolean(edit)} onClose={() => setEdit(null)} title={edit?.id ? `Edit ${edit.name}` : "Add AI provider"}>
        {edit && (
          <div className="space-y-4">
            {!edit.id && (
              <Field label="Preset">
                <Select value="" onChange={(e) => { const pr = prov.data?.presets[e.target.value]; if (pr) setEdit({ ...edit, ...pr, kind: e.target.value === "groq" ? "groq" : "openai_compatible", name: e.target.value === "groq" ? "Groq" : e.target.value === "xai" ? "xAI" : "OpenRouter" } as never); }} options={[{ value: "", label: "Choose…" }, { value: "groq", label: "Groq" }, { value: "xai", label: "xAI (Grok)" }, { value: "openrouter", label: "OpenRouter" }]} />
              </Field>
            )}
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Name"><Input value={edit.name ?? ""} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
              <Field label="Priority" hint="1 = tried first"><Input type="number" min={1} value={edit.priority ?? 10} onChange={(e) => setEdit({ ...edit, priority: Number(e.target.value) })} /></Field>
              <Field label="API base URL" className="sm:col-span-2" hint="OpenAI-compatible endpoint (…/v1)"><Input value={edit.baseUrl ?? ""} onChange={(e) => setEdit({ ...edit, baseUrl: e.target.value })} /></Field>
              <Field label="Model"><Input value={edit.model ?? ""} onChange={(e) => setEdit({ ...edit, model: e.target.value })} /></Field>
              <Field label="Structured output"><Select value={edit.structuredOutput ?? "json_schema"} onChange={(e) => setEdit({ ...edit, structuredOutput: e.target.value as "json_schema" })} options={[{ value: "json_schema", label: "JSON schema (strict)" }, { value: "json_object", label: "JSON object" }]} /></Field>
            </div>
            <div className="rounded-xl bg-white p-3 ring-1 ring-navy-900/[0.07]">
              <div className="mb-3 flex gap-1 text-[0.8rem]">
                <button onClick={() => setEdit({ ...edit, keyMode: "env" })} className={`rounded-full px-3 py-1.5 font-semibold ${edit.keyMode === "env" ? "bg-navy-900 text-paper" : "text-ink-soft"}`}>Environment variable</button>
                <button onClick={() => setEdit({ ...edit, keyMode: "key" })} className={`rounded-full px-3 py-1.5 font-semibold ${edit.keyMode !== "env" ? "bg-navy-900 text-paper" : "text-ink-soft"}`}>Paste key</button>
              </div>
              {edit.keyMode === "env" ? (
                <Field label="Variable name" hint="Recommended. The key stays in .env.local / Vercel settings."><Input value={edit.envVar ?? ""} placeholder="GROQ_API_KEY_2" onChange={(e) => setEdit({ ...edit, envVar: e.target.value.toUpperCase() })} /></Field>
              ) : (
                <Field label={edit.id ? "New API key (leave empty to keep current)" : "API key"} hint={prov.data?.canEncrypt ? "Encrypted at rest; never shown again." : "Requires STUDIO_ENCRYPTION_KEY on the server."}>
                  <Input type="password" autoComplete="off" value={edit.apiKey ?? ""} onChange={(e) => setEdit({ ...edit, apiKey: e.target.value })} />
                </Field>
              )}
            </div>
            <Toggle checked={(edit.capabilities ?? []).includes("reasoning_effort")} onChange={(x) => setEdit({ ...edit, capabilities: x ? [...(edit.capabilities ?? []), "reasoning_effort"] : (edit.capabilities ?? []).filter((c) => c !== "reasoning_effort") })} label="Supports reasoning effort" hint="e.g. gpt-oss models on Groq — lowers token use." />
            <div className="grid grid-cols-3 gap-3">
              <Field label="Input $/1M tok"><Input type="number" step="0.01" min={0} value={edit.pricing?.inputPerMTok ?? ""} onChange={(e) => setEdit({ ...edit, pricing: e.target.value === "" ? null : { inputPerMTok: Number(e.target.value), outputPerMTok: edit.pricing?.outputPerMTok ?? 0, currency: edit.pricing?.currency ?? "USD" } })} /></Field>
              <Field label="Output $/1M tok"><Input type="number" step="0.01" min={0} value={edit.pricing?.outputPerMTok ?? ""} onChange={(e) => setEdit({ ...edit, pricing: { inputPerMTok: edit.pricing?.inputPerMTok ?? 0, outputPerMTok: Number(e.target.value), currency: edit.pricing?.currency ?? "USD" } })} /></Field>
              <Field label="Currency"><Input maxLength={3} value={edit.pricing?.currency ?? "USD"} onChange={(e) => setEdit({ ...edit, pricing: { inputPerMTok: edit.pricing?.inputPerMTok ?? 0, outputPerMTok: edit.pricing?.outputPerMTok ?? 0, currency: e.target.value.toUpperCase() } })} /></Field>
            </div>
            <p className="text-[0.72rem] text-ink-faint">Pricing is optional and entered by you from the provider&apos;s price list; it is only used for cost estimates.</p>
            <Button variant="primary" className="w-full" busy={busy === "save"} onClick={save} disabled={!edit.name || !edit.baseUrl || !edit.model}>Save provider</Button>
          </div>
        )}
      </Modal>
    </>
  );
}

/* ═════════════════════════ Settings ═════════════════════════ */

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function Settings() {
  const { data, error, reload } = useApi<{ settings: StudioSettings }>("settings");
  const [s, setS] = useState<StudioSettings | null>(null);
  const { busy, run } = useAction();
  const [advanced, setAdvanced] = useState(false);
  useEffect(() => {
    if (data) setS(data.settings);
  }, [data]);
  if (error && !data) return <ErrorNote error={error} onRetry={reload} />;
  if (!s) return <Loading />;
  const save = () => run("save", async () => {
    const r = await api<{ settings: StudioSettings }>("settings", { method: "PUT", body: { automation: s.automation, publishing: s.publishing, monitoring: s.monitoring, demand: s.demand, ctas: s.ctas } });
    setS(r.settings);
  }, "Settings saved");
  const pub = s.publishing;
  const setPub = (p: Partial<StudioSettings["publishing"]>) => setS({ ...s, publishing: { ...pub, ...p } });
  const setAuto = (p: Partial<StudioSettings["automation"]>) => setS({ ...s, automation: { ...s.automation, ...p } });

  return (
    <>
      <PageHeader title="Settings" actions={<Button variant="primary" busy={busy === "save"} onClick={save}>Save settings</Button>} />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardTitle>Daily automation</CardTitle>
          <div className="space-y-4">
            <Toggle checked={s.automation.enabled} onChange={(v) => setAuto({ enabled: v })} label="Automation on" hint="The worker researches and drafts in the background." />
            <Field label="Drafts per day" hint="Counted per local calendar day (publishing timezone). Only drafts that pass the quality check count.">
              <Input type="number" min={0} max={20} value={s.automation.dailyTarget} onChange={(e) => setAuto({ dailyTarget: Number(e.target.value) })} />
            </Field>
            <Toggle checked={s.automation.autoPickTopics} onChange={(v) => setAuto({ autoPickTopics: v })} label="Pick topics automatically" hint="Off = only topics you approve are researched." />
            <button onClick={() => setAdvanced(!advanced)} className="text-[0.8rem] font-semibold text-gold-600">{advanced ? "Hide" : "Show"} advanced</button>
            {advanced && (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Max jobs started per day" hint="Stops a failing pipeline from burning API quota."><Input type="number" min={1} value={s.automation.maxJobsPerDay} onChange={(e) => setAuto({ maxJobsPerDay: Number(e.target.value) })} /></Field>
                <Field label="Max retries per stage"><Input type="number" min={0} max={10} value={s.automation.maxRetries} onChange={(e) => setAuto({ maxRetries: Number(e.target.value) })} /></Field>
                <Field label="Minimum sources per draft"><Input type="number" min={1} value={s.automation.minSourcesForDraft} onChange={(e) => setAuto({ minSourcesForDraft: Number(e.target.value) })} /></Field>
                <Field label="Minimum words"><Input type="number" min={200} value={s.automation.minWords} onChange={(e) => setAuto({ minWords: Number(e.target.value) })} /></Field>
              </div>
            )}
          </div>
        </Card>

        <Card>
          <CardTitle>Publishing schedule</CardTitle>
          <div className="space-y-4">
            <Field label="Timezone" hint="IANA name, e.g. Asia/Kolkata, Europe/Rome"><Input value={pub.timezone} onChange={(e) => setPub({ timezone: e.target.value })} /></Field>
            <Field label="Publishing times" hint="Comma separated, 24h, e.g. 18:00 or 10:00, 18:00">
              <Input value={pub.times.join(", ")} onChange={(e) => setPub({ times: e.target.value.split(",").map((t) => t.trim()).filter(Boolean) })} />
            </Field>
            <Toggle checked={pub.allowWeekends} onChange={(v) => setPub({ allowWeekends: v })} label="Allow weekends" />
            <div>
              <p className="mb-1.5 text-[0.8rem] font-semibold text-navy-900">Publishing days</p>
              <div className="flex flex-wrap gap-1.5">
                {DAYS.map((d, i) => {
                  const weekend = i === 0 || i === 6;
                  const on = pub.days.includes(i);
                  return (
                    <button key={d} type="button" disabled={weekend && !pub.allowWeekends} onClick={() => setPub({ days: on ? pub.days.filter((x) => x !== i) : [...pub.days, i].sort() })} className={`min-h-10 w-12 rounded-full text-[0.8rem] font-semibold disabled:opacity-30 ${on ? "bg-navy-900 text-paper" : "bg-stone/60 text-navy-900"}`}>{d}</button>
                  );
                })}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Max posts per day"><Input type="number" min={1} max={10} value={pub.maxPerDay} onChange={(e) => setPub({ maxPerDay: Number(e.target.value) })} /></Field>
              <Field label="Min. gap (minutes)"><Input type="number" min={0} value={pub.minIntervalMinutes} onChange={(e) => setPub({ minIntervalMinutes: Number(e.target.value) })} /></Field>
            </div>
            <Toggle checked={pub.autoQueue} onChange={(v) => setPub({ autoQueue: v })} label="Suggest the next slot after approval" />
          </div>
        </Card>

        <Card>
          <CardTitle>Source monitoring</CardTitle>
          <div className="space-y-4">
            <Toggle checked={s.monitoring.enabled} onChange={(v) => setS({ ...s, monitoring: { ...s.monitoring, enabled: v } })} label="Monitor official sources" />
            <Field label="Default frequency (hours)"><Input type="number" min={1} value={s.monitoring.defaultFrequencyHours} onChange={(e) => setS({ ...s, monitoring: { ...s.monitoring, defaultFrequencyHours: Number(e.target.value) } })} /></Field>
          </div>
        </Card>

        <Card>
          <CardTitle>Demand research</CardTitle>
          <div className="space-y-3">
            <Toggle
              checked={s.demand.suggestEnabled}
              onChange={(v) => setS({ ...s, demand: { ...s.demand, suggestEnabled: v } })}
              label="Use Google search suggestions"
              hint="Unofficial autocomplete endpoint: phrasing only, no search volumes, may be blocked. Off by default."
            />
            <p className="text-[0.75rem] leading-snug text-ink-faint">Google Trends is not connected: the official API is alpha, by application only. Web search observations need a search API key (Integrations).</p>
          </div>
        </Card>

        <CtaEditor ctas={s.ctas} onChange={(ctas) => setS({ ...s, ctas })} />

        <Card className="lg:col-span-2">
          <CardTitle>Background worker</CardTitle>
          <p className="text-[0.85rem] leading-relaxed text-ink-soft">
            The worker runs on the automation computer (Windows now, MacBook later). Start it with <code className="rounded bg-stone px-1.5">npm run studio:worker</code>, or install it to start at login:
            Windows <code className="rounded bg-stone px-1.5">powershell -ExecutionPolicy Bypass -File scripts\worker\install-windows.ps1</code>, macOS <code className="rounded bg-stone px-1.5">bash scripts/worker/install-macos.sh</code>.
            See <code className="rounded bg-stone px-1.5">docs/STUDIO.md</code> for details.
          </p>
          <Link href="/admin/site" className="mt-3 inline-block text-[0.82rem] font-semibold text-gold-600">Manage homepage destination cards →</Link>
        </Card>
      </div>
    </>
  );
}

function CtaEditor({ ctas, onChange }: { ctas: CtaTemplate[]; onChange: (c: CtaTemplate[]) => void }) {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <Card>
      <CardTitle action={<Button size="sm" onClick={() => { onChange([...ctas, { key: `cta-${ctas.length + 1}`, label: "Talk to SKOLAR", text: "", categories: [] }]); setOpen(ctas.length); }}>Add</Button>}>Calls to action</CardTitle>
      <p className="mb-3 text-[0.75rem] text-ink-faint">Relevant, honest invitations — never promises, never partnership claims.</p>
      <ul className="space-y-2">
        {ctas.map((c, i) => (
          <li key={i} className="rounded-xl bg-paper p-3 ring-1 ring-navy-900/[0.06]">
            <button className="w-full text-left text-[0.84rem] text-navy-900" onClick={() => setOpen(open === i ? null : i)}>
              {c.text || <em className="text-ink-faint">Empty</em>}
              <span className="mt-1 block text-[0.7rem] text-ink-faint">{c.categories.map((k) => STRATEGIES[k]?.short).join(", ") || "No default categories"}</span>
            </button>
            {open === i && (
              <div className="mt-3 space-y-3">
                <Field label="Text"><Textarea rows={2} value={c.text} onChange={(e) => onChange(ctas.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} /></Field>
                <Field label="Button label"><Input value={c.label} onChange={(e) => onChange(ctas.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} /></Field>
                <div className="flex flex-wrap gap-1.5">
                  {CATEGORY_KEYS.map((k) => {
                    const on = c.categories.includes(k);
                    return <button key={k} type="button" onClick={() => onChange(ctas.map((x, j) => (j === i ? { ...x, categories: on ? x.categories.filter((y) => y !== k) : [...x.categories, k as CategoryKey] } : x)))} className={`min-h-8 rounded-full px-2.5 text-[0.72rem] ${on ? "bg-navy-900 text-paper" : "bg-stone/60"}`}>{STRATEGIES[k].short}</button>;
                  })}
                </div>
                <Button size="sm" variant="danger" onClick={() => { onChange(ctas.filter((_, j) => j !== i)); setOpen(null); }} disabled={ctas.length <= 1}>Remove</Button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

/* ═════════════════════════ Notifications ═════════════════════════ */

export function Notifications() {
  const { data, reload } = useApi<{ items: Array<{ id: string; level: string; title: string; body?: string; href?: string; read: boolean; createdAt: string }> }>("notifications");
  const { busy, run } = useAction();
  const markAll = () => run("all", async () => {
    await api("notifications/read", { body: { all: true } });
    await reload();
  });
  return (
    <>
      <PageHeader title="Notifications" actions={<Button busy={busy === "all"} onClick={markAll}>Mark all read</Button>} />
      {!data ? <Loading /> : data.items.length === 0 ? <Empty title="All quiet" /> : (
        <ul className="space-y-2">
          {data.items.map((n) => (
            <li key={n.id} className={`rounded-[18px] border p-4 ${n.read ? "border-navy-900/[0.06] bg-white/60" : "border-navy-900/10 bg-white"}`}>
              <p className="flex flex-wrap items-center gap-2 text-[0.9rem] font-semibold text-navy-900">
                {!n.read && <span className="h-2 w-2 rounded-full bg-gold-500" />}
                <Badge tone={n.level === "error" ? "red" : n.level === "warning" ? "gold" : n.level === "success" ? "green" : "grey"}>{n.level}</Badge>
                {n.title}
                <span className="text-[0.72rem] font-normal text-ink-faint">{fmtDateTime(n.createdAt)}</span>
              </p>
              {n.body && <p className="mt-1 text-[0.84rem] text-ink-soft">{n.body}</p>}
              {n.href && <Link href={n.href} onClick={() => void api("notifications/read", { body: { ids: [n.id] } })} className="mt-1 inline-block text-[0.8rem] font-semibold text-gold-600">Open →</Link>}
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

/* ═════════════════════════ Reports ═════════════════════════ */

export function Reports() {
  const [period, setPeriod] = useState<"day" | "month">("day");
  const { data } = useApi<{
    label: string;
    researched: number;
    generated: number;
    approved: number;
    published: number;
    rejected: number;
    failedJobs: number;
    avgGenerationMinutes: number | null;
    shortfalls: Array<{ day: string; reason: string }>;
    providers: Array<{ name: string; requests: number; inputTokens: number; outputTokens: number; failures: number; rateLimits: number; cost: number | null; currency: string | null }>;
    days: Array<{ day: string; generated: number; published: number; failed: number }>;
  }>(`reports?period=${period}`);
  return (
    <>
      <PageHeader
        title="Reports"
        actions={
          <div className="flex gap-1 rounded-full bg-stone/60 p-1 text-[0.8rem]">
            {(["day", "month"] as const).map((p) => <button key={p} onClick={() => setPeriod(p)} className={`min-h-9 rounded-full px-4 font-semibold ${period === p ? "bg-white text-navy-900 shadow-sm" : "text-ink-soft"}`}>{p === "day" ? "Today" : "This month"}</button>)}
          </div>
        }
      />
      {!data ? <Loading /> : (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-7">
            {[
              ["Topics researched", data.researched],
              ["Drafts generated", data.generated],
              ["Approved", data.approved],
              ["Published", data.published],
              ["Rejected", data.rejected],
              ["Failed jobs", data.failedJobs],
              ["Avg. minutes / draft", data.avgGenerationMinutes ?? "—"],
            ].map(([l, v]) => (
              <Card key={String(l)}><p className="text-[0.72rem] text-ink-faint">{l}</p><p className="display mt-1 text-[1.8rem] text-navy-900">{v}</p></Card>
            ))}
          </div>
          <Card className="mt-6">
            <CardTitle>Provider distribution & spending</CardTitle>
            {data.providers.length === 0 ? <p className="text-sm text-ink-faint">No AI usage in this period.</p> : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[34rem] text-left text-[0.82rem]">
                  <thead className="text-[0.72rem] text-ink-faint"><tr><th className="py-2">Provider · model</th><th>Requests</th><th>Tokens in / out</th><th>Failed</th><th>Rate limits</th><th>Est. cost</th></tr></thead>
                  <tbody className="divide-y divide-navy-900/[0.06]">
                    {data.providers.map((p) => <tr key={p.name}><td className="py-2">{p.name}</td><td>{nf(p.requests)}</td><td>{nf(p.inputTokens)} / {nf(p.outputTokens)}</td><td>{p.failures}</td><td>{p.rateLimits}</td><td>{p.cost === null ? "—" : `${p.cost.toFixed(2)} ${p.currency}`}</td></tr>)}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
          {period === "month" && data.days.length > 0 && (
            <Card className="mt-6">
              <CardTitle>By day</CardTitle>
              <ul className="space-y-1 text-[0.82rem]">
                {data.days.map((d) => <li key={d.day} className="flex justify-between border-b border-navy-900/[0.05] py-1.5"><span>{d.day}</span><span className="text-ink-soft">{d.generated} drafts · {d.published} published · {d.failed} failed</span></li>)}
              </ul>
            </Card>
          )}
          {data.shortfalls.length > 0 && (
            <Card className="mt-6">
              <CardTitle>Why targets were missed</CardTitle>
              <ul className="space-y-1 text-[0.82rem] text-ink-soft">{data.shortfalls.map((s) => <li key={s.day}><strong className="text-navy-900">{s.day}:</strong> {s.reason}</li>)}</ul>
            </Card>
          )}
        </>
      )}
    </>
  );
}

/* ═════════════════════════ Coming soon ═════════════════════════ */

const MODULES: Record<string, { title: string; description: string; note?: string }> = {
  carousel: { title: "Carousel Studio", description: "AI-powered carousel research, writing, slide design and export." },
  reels: { title: "Reel Studio", description: "Script creation, OpusCut integration and Reel production management.", note: "Reel production currently runs in a separate workflow. Nothing here replaces it, and no OpusCut integration exists yet." },
  crawler: { title: "Crawler & Monitoring", description: "Advanced automated crawling and source monitoring.", note: "The basic official-source registry and scheduled monitoring are already available under Research & Sources." },
  "website-builder": { title: "Website Builder", description: "Future website and landing-page creation tools." },
};

export function ComingSoon({ slug }: { slug: string }) {
  const m = MODULES[slug];
  if (!m) return <Empty title="Unknown module" />;
  return (
    <div className="mx-auto max-w-xl py-10 text-center">
      <Badge tone="gold">Coming soon</Badge>
      <h1 className="display mt-4 text-[2.4rem] text-navy-900">{m.title}</h1>
      <p className="mt-3 text-ink-soft">{m.description}</p>
      {m.note && <p className="mt-4 rounded-2xl bg-stone/50 p-4 text-[0.85rem] text-ink-soft">{m.note}</p>}
      <p className="mt-6 text-[0.8rem] text-ink-faint">This module is not available yet. Blog automation is the first live module of SKOLAR Studio.</p>
    </div>
  );
}
