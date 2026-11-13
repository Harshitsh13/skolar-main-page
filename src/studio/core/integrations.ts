import { COL, getStore, storeInfo } from "./store";
import { studioEnv } from "./env";
import { listProviders, testProvider } from "./ai";
import { aiProvider } from "./images/providers";
import { blobConfigured, testBlob } from "./media";
import { searchProviderName, webSearch } from "./search";
import { encryptionSelfTest, encryptionStatus, needsReencryption, resolveSecret } from "./secrets";
import { productionProbe, vercelConfigured } from "./deploy";
import { getSettings } from "./settings";
import { errorMessage, nowIso, sha256 } from "./util";

/**
 * Integration centre. A status is "connected" only when a real test of the
 * *current* configuration succeeded (each result is stored with a fingerprint
 * of the configuration it tested). Credentials are never returned.
 */

export type IntegrationState = "connected" | "configured_untested" | "not_configured" | "waiting_access" | "unavailable" | "failing" | "disabled";

export interface IntegrationStatus {
  key: string;
  name: string;
  group: "AI" | "Media" | "Data" | "Research" | "Publishing" | "Security" | "Operations";
  state: IntegrationState;
  detail: string;
  requirement: string | null;
  guidance: string;
  testable: boolean;
  lastCheckAt: string | null;
  lastOkAt: string | null;
  lastError: string | null;
}

interface CheckRecord {
  key: string;
  fingerprint: string;
  ok: boolean;
  transient?: boolean;
  message: string;
  error?: string;
  at: string;
  lastOkAt?: string;
}

interface Def {
  key: string;
  name: string;
  group: IntegrationStatus["group"];
  guidance: string;
  configured: () => Promise<{ ok: boolean; detail: string; requirement?: string }>;
  fingerprint: () => Promise<string>;
  fixedState?: () => Promise<{ state: IntegrationState; detail: string } | null>;
  test?: () => Promise<{ ok: boolean; message: string; transient?: boolean }>;
}

const fp = (...parts: unknown[]) => sha256(JSON.stringify(parts)).slice(0, 16);
const env = (k: string) => process.env[k]?.trim() || "";

const DEFS: Def[] = [
  {
    key: "text-ai",
    name: "Text AI provider",
    group: "AI",
    guidance: "Groq is created automatically from GROQ_API_KEY. Add more providers under AI providers; fallback only uses providers that are enabled and tested.",
    async configured() {
      const ps = (await listProviders()).filter((p) => p.enabled);
      return ps.length ? { ok: true, detail: ps.map((p) => `${p.name} · ${p.model}`).join(", ") } : { ok: false, detail: "No provider", requirement: "Set GROQ_API_KEY or add a provider." };
    },
    fingerprint: async () => fp((await listProviders()).filter((p) => p.enabled).map((p) => [p.id, p.model, p.baseUrl, p.keyRef.slice(0, 40), resolveSecret(p.keyRef) ? sha256(resolveSecret(p.keyRef)!).slice(0, 8) : null])),
    async test() {
      const ps = (await listProviders()).filter((p) => p.enabled);
      const results = [];
      for (const p of ps) results.push({ p, r: await testProvider(p) });
      const ok = results.filter((x) => x.r.ok);
      return {
        ok: ok.length > 0,
        message: `${results.map((x) => `${x.p.name}: ${x.r.ok ? "OK" : x.r.message}`).join(" · ")}. Fallback ${ok.length > 1 ? `available (${ok.length} working providers)` : "not available (only one working provider)"}.`,
      };
    },
  },
  {
    key: "image-ai",
    name: "AI image generation",
    group: "AI",
    guidance: "Optional. Adds AI-generated scenes (always with the SKOLAR overlay). Set OPENAI_API_KEY (OpenAI Images) or GEMINI_API_KEY. Without it, images use the SKOLAR renderer formats.",
    async configured() {
      const p = aiProvider();
      return p ? { ok: true, detail: `${p.label} · ${p.model()}` } : { ok: false, detail: "No image API key", requirement: "OPENAI_API_KEY or GEMINI_API_KEY" };
    },
    fingerprint: async () => fp(env("OPENAI_API_KEY") && sha256(env("OPENAI_API_KEY")).slice(0, 8), env("GEMINI_API_KEY") && sha256(env("GEMINI_API_KEY")).slice(0, 8), env("OPENAI_IMAGE_MODEL"), env("GEMINI_IMAGE_MODEL"), env("IMAGE_PROVIDER")),
    async test() {
      const p = aiProvider();
      return p ? p.test() : { ok: false, message: "Not configured" };
    },
  },
  {
    key: "image-render",
    name: "SKOLAR image renderer",
    group: "Media",
    guidance: "Renders branded covers in 10 formats from the article itself (port of the TrendScout thumbnail engine). Uses the brand fonts in assets/fonts.",
    configured: async () => ({ ok: true, detail: "Built in (resvg + sharp, brand fonts)" }),
    fingerprint: async () => fp("render-v2"),
    async test() {
      const { generateImage } = await import("./images/service");
      const g = await generateImage({ id: "integration-test", title: "Integration test: SKOLAR renderer", category: "practical", body: "## Step one\n\nx\n\n## Step two\n\nx", tags: [], images: [] }, { allowAi: false });
      return { ok: g.rendered.problems.length === 0, message: `Rendered ${g.concept.format} cover + card (${Math.round(g.rendered.cover.length / 1024)} KB), QC ${g.rendered.problems.length ? g.rendered.problems.join("; ") : "passed"}` };
    },
  },
  {
    key: "blob",
    name: "Vercel Blob (media)",
    group: "Media",
    guidance: "All Studio images are stored in Vercel Blob. BLOB_READ_WRITE_TOKEN stays server-side (set it in .env.local and in Vercel).",
    configured: async () => (blobConfigured() ? { ok: true, detail: "BLOB_READ_WRITE_TOKEN set (server only)" } : { ok: false, detail: "Not configured", requirement: "BLOB_READ_WRITE_TOKEN" }),
    fingerprint: async () => fp(studioEnv.blobToken() ? sha256(studioEnv.blobToken()!).slice(0, 8) : null),
    test: () => testBlob(),
  },
  {
    key: "database",
    name: "Studio database",
    group: "Data",
    guidance: "Firestore (FIREBASE_SERVICE_ACCOUNT_JSON) is required on Vercel and for several machines. Without it, data is stored locally in .studio-data on this computer.",
    async configured() {
      const s = storeInfo();
      return s.kind === "none" ? { ok: false, detail: s.reason, requirement: "FIREBASE_SERVICE_ACCOUNT_JSON" } : { ok: true, detail: s.reason };
    },
    fingerprint: async () => fp(storeInfo().kind, env("FIREBASE_SERVICE_ACCOUNT_JSON") ? sha256(env("FIREBASE_SERVICE_ACCOUNT_JSON")).slice(0, 8) : null),
    async test() {
      const store = getStore();
      const id = `probe-${Date.now()}`;
      await store.set(COL.integrations, id, { at: nowIso() });
      const back = await store.get(COL.integrations, id);
      await store.remove(COL.integrations, id);
      return back ? { ok: true, message: `Write, read and delete succeeded (${store.kind}).` } : { ok: false, message: "Read-back failed." };
    },
  },
  {
    key: "google-trends",
    name: "Google Trends",
    group: "Research",
    guidance: "Google's official Trends API is in alpha and only available to approved applicants (developers.google.com/search/apis/trends). Scraping Google Trends is not used. When access is granted, the adapter can be added in src/studio/core/demand.ts.",
    configured: async () => ({ ok: false, detail: "Official API access not granted", requirement: "Approved Google Trends API (alpha) access" }),
    fingerprint: async () => fp("trends"),
    fixedState: async () => ({ state: "waiting_access", detail: "Official Google Trends API is alpha, by application only. Demand research uses the clearly labelled sources below instead." }),
  },
  {
    key: "search",
    name: "Web search (Serper / Brave / Google CSE)",
    group: "Research",
    guidance: "Optional. Adds search-result observations and related questions to topic discovery, and official-domain results to page discovery. Set SERPER_API_KEY or BRAVE_SEARCH_API_KEY (or GOOGLE_CSE_API_KEY + GOOGLE_CSE_ID).",
    configured: async () => (searchProviderName() ? { ok: true, detail: searchProviderName()! } : { ok: false, detail: "No search API key", requirement: "SERPER_API_KEY or BRAVE_SEARCH_API_KEY" }),
    fingerprint: async () => fp(studioEnv.search()?.kind, studioEnv.search()?.key ? sha256(studioEnv.search()!.key).slice(0, 8) : null),
    async test() {
      const r = await webSearch("study in Italy for international students", { num: 3 });
      return { ok: r.results.length > 0, message: `${r.provider}: ${r.results.length} result(s), ${r.related.length} related question(s)` };
    },
  },
  {
    key: "suggest",
    name: "Google search suggestions (unofficial)",
    group: "Research",
    guidance: "Off by default. Uses Google's public autocomplete endpoint for phrasing only — no search volumes, unofficial, may be rate-limited. Enable it in Settings → Demand research if you accept that.",
    configured: async () => ((await getSettings()).demand.suggestEnabled ? { ok: true, detail: "Enabled in Settings" } : { ok: false, detail: "Disabled in Settings" }),
    fingerprint: async () => fp((await getSettings()).demand.suggestEnabled),
    fixedState: async () => ((await getSettings()).demand.suggestEnabled ? null : { state: "disabled", detail: "Disabled (opt-in in Settings)." }),
    async test() {
      const { googleSuggest } = await import("./demand");
      const s = await googleSuggest("study in italy");
      return { ok: s.length > 0, message: `${s.length} suggestion(s), e.g. “${s[0] ?? ""}”` };
    },
  },
  {
    key: "discovery",
    name: "Official page discovery",
    group: "Research",
    guidance: "Finds admissions, fees, scholarship, programme, international-office, housing, services and visa pages on registry websites via their sitemaps or homepage links (robots.txt respected). No API key needed.",
    async configured() {
      const { listUniversities, listScholarships } = await import("./entities");
      const n = (await listUniversities()).length + (await listScholarships()).length;
      return n ? { ok: true, detail: `${n} institution(s) in the registry` } : { ok: false, detail: "Registry is empty", requirement: "Add universities or scholarship bodies under Countries & Universities" };
    },
    fingerprint: async () => fp("discovery"),
    async test() {
      const { listUniversities, listScholarships } = await import("./entities");
      const { sitemapsFor, fetchText, hostOf } = await import("./fetcher");
      const first = (await listUniversities())[0] ?? (await listScholarships())[0];
      if (!first) return { ok: false, message: "No institutions to test." };
      const origin = new URL(first.website).origin;
      const sms = await sitemapsFor(origin);
      try {
        const xml = await fetchText(sms[0]);
        return { ok: true, message: `${hostOf(origin)}: sitemap readable (${(xml.match(/<loc>/g) ?? []).length} entries)` };
      } catch (err) {
        return { ok: true, message: `${hostOf(origin)}: no readable sitemap (${errorMessage(err)}); homepage links will be used.` };
      }
    },
  },
  {
    key: "github",
    name: "GitHub publishing",
    group: "Publishing",
    guidance: "Fine-grained token with Contents: read & write on this repository only. Set GITHUB_TOKEN, GITHUB_REPO=owner/name, GITHUB_BRANCH.",
    configured: async () => {
      const g = studioEnv.github();
      return g ? { ok: true, detail: `${g.repo} · ${g.branch} · ${g.dir}` } : { ok: false, detail: "Not configured — articles are written to content/insights locally", requirement: "GITHUB_TOKEN + GITHUB_REPO" };
    },
    fingerprint: async () => fp(studioEnv.github()?.repo, studioEnv.github()?.branch, studioEnv.github()?.token ? sha256(studioEnv.github()!.token).slice(0, 8) : null),
    async test() {
      const { githubCheck } = await import("./publish");
      return githubCheck();
    },
  },
  {
    key: "deployment",
    name: "Deployment tracking",
    group: "Publishing",
    guidance: "Confirms the production deployment for each commit. Uses the Vercel API (VERCEL_TOKEN + VERCEL_PROJECT_ID, optional VERCEL_TEAM_ID) or GitHub deployments (via GITHUB_TOKEN). VERCEL_DEPLOY_HOOK_URL enables “retry deployment” without a new commit.",
    configured: async () =>
      vercelConfigured() ? { ok: true, detail: "Vercel API" } : studioEnv.github() ? { ok: true, detail: "GitHub deployments (Vercel GitHub app)" } : { ok: false, detail: "No deployment tracking", requirement: "VERCEL_TOKEN + VERCEL_PROJECT_ID, or GITHUB_TOKEN" },
    fingerprint: async () => fp(vercelConfigured(), env("VERCEL_PROJECT_ID"), env("VERCEL_TOKEN") ? sha256(env("VERCEL_TOKEN")).slice(0, 8) : null, studioEnv.github()?.repo),
    async test() {
      if (vercelConfigured()) {
        const team = env("VERCEL_TEAM_ID") ? `?teamId=${env("VERCEL_TEAM_ID")}` : "";
        const res = await fetch(`https://api.vercel.com/v9/projects/${encodeURIComponent(env("VERCEL_PROJECT_ID"))}${team}`, { headers: { Authorization: `Bearer ${env("VERCEL_TOKEN")}` }, signal: AbortSignal.timeout(20_000) });
        return res.ok ? { ok: true, message: `Vercel project ${(await res.json()).name} reachable` } : { ok: false, message: `Vercel API HTTP ${res.status}` };
      }
      const g = studioEnv.github()!;
      const res = await fetch(`https://api.github.com/repos/${g.repo}/deployments?per_page=1`, { headers: { Authorization: `Bearer ${g.token}`, Accept: "application/vnd.github+json", "User-Agent": "skolar-studio" }, signal: AbortSignal.timeout(20_000) });
      return res.ok ? { ok: true, message: `GitHub deployments readable (${((await res.json()) as unknown[]).length ? "deployments found" : "no deployments recorded yet"})` } : { ok: false, message: `GitHub deployments HTTP ${res.status}` };
    },
  },
  {
    key: "production",
    name: "Production website",
    group: "Publishing",
    guidance: "NEXT_PUBLIC_SITE_URL must be the production domain. The test checks the site is up and that the deployed build includes SKOLAR Studio (needed for /insights/<slug> pages).",
    configured: async () => ({ ok: true, detail: studioEnv.siteUrl() }),
    fingerprint: async () => fp(studioEnv.siteUrl()),
    async test() {
      const r = await productionProbe();
      return { ok: r.ok, message: r.message, transient: false };
    },
  },
  {
    key: "encryption",
    name: "Credential encryption",
    group: "Security",
    guidance: "AES-256-GCM with STUDIO_ENCRYPTION_KEY (32+ random characters, server-only; set the same value in Vercel). Rotate with STUDIO_ENCRYPTION_KEY_PREVIOUS + “Re-encrypt stored keys”.",
    configured: async () => {
      const st = encryptionStatus();
      return st.configured ? { ok: true, detail: `Key ${st.keyId}${st.previousKeyId ? `, previous ${st.previousKeyId}` : ""}${st.problem ? ` — ${st.problem}` : ""}` } : { ok: false, detail: st.problem ?? "Not configured", requirement: "STUDIO_ENCRYPTION_KEY" };
    },
    fingerprint: async () => fp(encryptionStatus().keyId, encryptionStatus().previousKeyId),
    async test() {
      const self = encryptionSelfTest();
      if (!self.ok) return self;
      const stored = (await listProviders()).filter((p) => p.keyRef.startsWith("enc:"));
      const unreadable = stored.filter((p) => !resolveSecret(p.keyRef));
      const stale = stored.filter((p) => needsReencryption(p.keyRef));
      if (unreadable.length) return { ok: false, message: `${self.message} But ${unreadable.length} stored key(s) cannot be decrypted: ${unreadable.map((p) => p.name).join(", ")}.` };
      return { ok: true, message: `${self.message} ${stored.length} stored key(s) decrypt correctly${stale.length ? `; ${stale.length} use an older key — run “Re-encrypt stored keys”` : ""}.` };
    },
  },
  {
    key: "worker",
    name: "Background worker",
    group: "Operations",
    guidance: "Runs research, monitoring and scheduled publishing. Start with npm run studio:worker or the startup task. Several instances may run; only the leader schedules and publishes.",
    configured: async () => ({ ok: true, detail: "See instances below" }),
    fingerprint: async () => fp("worker", Math.floor(Date.now() / 60_000)),
    async test() {
      const { listWorkers } = await import("./worker");
      const ws = await listWorkers();
      const online = ws.filter((w) => w.online);
      const leader = online.find((w) => w.leader);
      if (!online.length) return { ok: false, message: ws.length ? `No instance online (last heartbeat ${ws[0].heartbeatAt}).` : "No worker has ever started." };
      return { ok: true, message: `${online.length} instance(s) online; leader ${leader ? leader.id : "none yet"}.` };
    },
  },
];

export async function recordIntegrationCheck(key: string, ok: boolean, message: string, error?: string, transient?: boolean) {
  const def = DEFS.find((d) => d.key === key);
  const fingerprint = def ? await def.fingerprint().catch(() => "") : "";
  const store = getStore();
  const prev = await store.get<CheckRecord & Record<string, unknown>>(COL.integrations, `check-${key}`);
  const rec: CheckRecord = { key, fingerprint, ok, transient, message: message.slice(0, 600), error: error?.slice(0, 600), at: nowIso(), lastOkAt: ok ? nowIso() : prev?.lastOkAt };
  await store.set(COL.integrations, `check-${key}`, rec as unknown as Record<string, unknown>);
}

export async function testIntegration(key: string): Promise<{ ok: boolean; message: string }> {
  const def = DEFS.find((d) => d.key === key);
  if (!def?.test) throw new Error("This integration has no test.");
  const fixed = await def.fixedState?.();
  if (fixed && fixed.state !== "connected") return { ok: false, message: fixed.detail };
  const conf = await def.configured();
  if (!conf.ok && key !== "production") {
    await recordIntegrationCheck(key, false, conf.detail, conf.requirement ? `Missing: ${conf.requirement}` : undefined);
    return { ok: false, message: `Not configured: ${conf.requirement ?? conf.detail}` };
  }
  try {
    const r = await def.test();
    await recordIntegrationCheck(key, r.ok, r.message, r.ok ? undefined : r.message, r.transient);
    return r;
  } catch (err) {
    const msg = errorMessage(err);
    const transient = /network|timeout|reach|ECONN|fetch failed|429|503/i.test(msg);
    await recordIntegrationCheck(key, false, msg, msg, transient);
    return { ok: false, message: msg };
  }
}

export async function listIntegrations(): Promise<IntegrationStatus[]> {
  const store = getStore();
  const out: IntegrationStatus[] = [];
  for (const d of DEFS) {
    const [conf, fixed, rec, fingerprint] = await Promise.all([
      d.configured().catch((e) => ({ ok: false, detail: errorMessage(e), requirement: undefined as string | undefined })),
      d.fixedState?.() ?? Promise.resolve(null),
      store.get<CheckRecord & Record<string, unknown>>(COL.integrations, `check-${d.key}`),
      d.fingerprint().catch(() => ""),
    ]);
    let state: IntegrationState;
    let detail = conf.detail;
    if (fixed) {
      state = fixed.state;
      detail = fixed.detail;
    } else if (!conf.ok) state = "not_configured";
    else if (rec && rec.fingerprint === fingerprint) state = rec.ok ? "connected" : rec.transient ? "unavailable" : "failing";
    else state = "configured_untested";
    out.push({
      key: d.key,
      name: d.name,
      group: d.group,
      state,
      detail: rec && rec.fingerprint === fingerprint && !fixed ? `${detail} — ${rec.message}` : detail,
      requirement: conf.ok ? null : (conf as { requirement?: string }).requirement ?? null,
      guidance: d.guidance,
      testable: Boolean(d.test) && !(fixed && fixed.state === "waiting_access"),
      lastCheckAt: rec?.at ?? null,
      lastOkAt: rec?.lastOkAt ?? null,
      lastError: rec && !rec.ok ? rec.error ?? rec.message : null,
    });
  }
  return out;
}
