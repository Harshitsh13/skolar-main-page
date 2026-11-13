import { COL, getStore } from "./store";
import type { ProviderConfig, UsageDay } from "./types";
import { resolveSecret } from "./secrets";
import { notify } from "./ops";
import { errorMessage, nowIso, redact } from "./util";
import { dayKey } from "./time";
import { getSettings } from "./settings";

/* ───────────────────────── Errors ───────────────────────── */

export type AiErrorKind =
  | "rate_limit" // 429 / quota exhausted — temporary
  | "unavailable" // 5xx, overloaded
  | "timeout"
  | "network" // DNS / connection failure
  | "auth" // invalid key — permanent until fixed
  | "config" // unknown model / bad endpoint — permanent until fixed
  | "bad_request" // our request was rejected (e.g. too long)
  | "bad_output"; // response did not parse / validate

export class AiError extends Error {
  constructor(
    message: string,
    readonly kind: AiErrorKind,
    readonly retryAfterSec?: number,
  ) {
    super(message);
  }
  get transient() {
    return this.kind === "rate_limit" || this.kind === "unavailable" || this.kind === "timeout" || this.kind === "network";
  }
}

/** No eligible provider right now. `retryAt` is when the earliest one frees up. */
export class NoProviderAvailableError extends Error {
  constructor(
    message: string,
    readonly reason: "none_configured" | "all_limited" | "all_failing" | "network",
    readonly retryAt?: string,
  ) {
    super(message);
  }
}

/* ───────────────────────── Adapter ───────────────────────── */

export interface ChatRequest {
  system: string;
  user: string;
  /** JSON schema for structured output; omit for free text. */
  json?: { name: string; schema: object };
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  /** Only sent to providers with the "reasoning_effort" capability (e.g. gpt-oss on Groq). */
  reasoning?: "low" | "medium" | "high";
}

export interface ChatResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
  providerId: string;
  providerName: string;
}

export interface ProviderAdapter {
  chat(cfg: ProviderConfig, apiKey: string, req: ChatRequest): Promise<Omit<ChatResult, "providerId" | "providerName">>;
}

function parseRetryAfter(h: string | null): number | undefined {
  if (!h) return undefined;
  const n = Number(h);
  if (Number.isFinite(n) && n >= 0) return Math.ceil(n);
  const t = Date.parse(h);
  return Number.isFinite(t) ? Math.max(1, Math.ceil((t - Date.now()) / 1000)) : undefined;
}

/** OpenAI-compatible chat completions (Groq, xAI, OpenRouter, Together, OpenAI …). */
export const openAiCompatibleAdapter: ProviderAdapter = {
  async chat(cfg, apiKey, req) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), req.timeoutMs ?? 120_000);
    const body: Record<string, unknown> = {
      model: cfg.model,
      temperature: req.temperature ?? 0.3,
      messages: [
        { role: "system", content: req.system },
        { role: "user", content: req.user },
      ],
    };
    if (req.maxTokens) body.max_tokens = req.maxTokens;
    if (req.reasoning && cfg.capabilities.includes("reasoning_effort")) body.reasoning_effort = req.reasoning;
    if (req.json) {
      body.response_format =
        cfg.structuredOutput === "json_schema"
          ? { type: "json_schema", json_schema: { name: req.json.name, schema: req.json.schema, strict: true } }
          : { type: "json_object" };
    }
    let res: Response;
    try {
      res = await fetch(`${cfg.baseUrl.replace(/\/+$/, "")}/chat/completions`, {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify(body),
        cache: "no-store",
      });
    } catch (err) {
      if ((err as Error).name === "AbortError") throw new AiError(`${cfg.name}: request timed out`, "timeout");
      throw new AiError(`${cfg.name}: network error (${errorMessage(err)})`, "network");
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      const text = redact((await res.text().catch(() => "")).slice(0, 400));
      const msg = `${cfg.name} ${res.status}: ${text}`;
      if (res.status === 429) throw new AiError(msg, "rate_limit", parseRetryAfter(res.headers.get("retry-after")) ?? 30);
      if (res.status === 401 || res.status === 403) throw new AiError(msg, "auth");
      if (res.status === 404) throw new AiError(msg, "config");
      if (res.status === 413) throw new AiError(msg, "bad_request");
      if (res.status === 400 && /model|does not exist|decommission|not found/i.test(text)) throw new AiError(msg, "config");
      if (res.status === 400 && /json_validate_failed|failed to generate|validation/i.test(text)) throw new AiError(msg, "bad_output");
      if (res.status >= 500) throw new AiError(msg, "unavailable", parseRetryAfter(res.headers.get("retry-after")));
      throw new AiError(msg, "bad_request");
    }
    const data = (await res.json().catch(() => null)) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
      model?: string;
    } | null;
    const text = data?.choices?.[0]?.message?.content ?? "";
    if (!text.trim()) throw new AiError(`${cfg.name} returned an empty response`, "bad_output");
    return {
      text,
      inputTokens: data?.usage?.prompt_tokens ?? 0,
      outputTokens: data?.usage?.completion_tokens ?? 0,
      model: data?.model ?? cfg.model,
    };
  },
};

const ADAPTERS: Record<ProviderConfig["kind"], ProviderAdapter> = {
  groq: openAiCompatibleAdapter,
  openai_compatible: openAiCompatibleAdapter,
};

/** Tests can swap in a mock adapter. */
export function setAdapterForTests(kind: ProviderConfig["kind"], adapter: ProviderAdapter) {
  ADAPTERS[kind] = adapter;
}

/* ───────────────────────── Provider registry ───────────────────────── */

export const PROVIDER_PRESETS = {
  groq: { baseUrl: "https://api.groq.com/openai/v1", model: "openai/gpt-oss-120b", structuredOutput: "json_schema" as const },
  xai: { baseUrl: "https://api.x.ai/v1", model: "grok-4.7", structuredOutput: "json_schema" as const },
  openrouter: { baseUrl: "https://openrouter.ai/api/v1", model: "", structuredOutput: "json_object" as const },
};

/**
 * Providers sorted by priority. If none are configured but GROQ_API_KEY is
 * set (the key the website already uses), a default Groq provider is created
 * that references the environment variable.
 */
export async function listProviders(): Promise<ProviderConfig[]> {
  const store = getStore();
  let rows = await store.list<ProviderConfig & Record<string, unknown>>(COL.providers);
  if (!rows.length && process.env.GROQ_API_KEY?.trim()) {
    const now = nowIso();
    const def: ProviderConfig = {
      id: "groq-env",
      name: "Groq",
      kind: "groq",
      baseUrl: PROVIDER_PRESETS.groq.baseUrl,
      model: process.env.GROQ_MODEL?.trim() || PROVIDER_PRESETS.groq.model,
      keyRef: "env:GROQ_API_KEY",
      keyHint: "from GROQ_API_KEY",
      enabled: true,
      priority: 1,
      structuredOutput: "json_schema",
      capabilities: ["json", "long_context", ...((process.env.GROQ_MODEL?.trim() || PROVIDER_PRESETS.groq.model).includes("gpt-oss") ? ["reasoning_effort"] : [])],
      pricing: null,
      state: {},
      createdAt: now,
      updatedAt: now,
    };
    await store.create(COL.providers, def.id, def as unknown as Record<string, unknown>);
    rows = [def as ProviderConfig & Record<string, unknown>];
  }
  return rows.sort((a, b) => a.priority - b.priority);
}

async function patchProviderState(id: string, patch: Partial<ProviderConfig["state"]>) {
  await getStore().transact<ProviderConfig & Record<string, unknown>>(COL.providers, id, (cur) => {
    if (!cur) return undefined;
    return { ...cur, state: { ...cur.state, ...patch } };
  });
}

/* ───────────────────────── Usage ───────────────────────── */

async function recordUsage(
  cfg: ProviderConfig,
  model: string,
  outcome: { ok: boolean; rateLimited?: boolean; inputTokens?: number; outputTokens?: number; durationMs: number },
) {
  try {
    const tz = (await getSettings()).publishing.timezone;
    const day = dayKey(new Date(), tz);
    const id = `${day}__${cfg.id}__${model}`.replace(/[^A-Za-z0-9_.-]/g, "-");
    await getStore().transact<UsageDay & Record<string, unknown>>(COL.usage, id, (cur) => {
      const u: UsageDay = cur ?? {
        id,
        day,
        providerId: cfg.id,
        providerName: cfg.name,
        model,
        requests: 0,
        failures: 0,
        rateLimits: 0,
        inputTokens: 0,
        outputTokens: 0,
        estimatedCost: null,
        currency: null,
        durationMs: 0,
      };
      u.requests += 1;
      if (!outcome.ok) u.failures += 1;
      if (outcome.rateLimited) u.rateLimits += 1;
      u.inputTokens += outcome.inputTokens ?? 0;
      u.outputTokens += outcome.outputTokens ?? 0;
      u.durationMs += outcome.durationMs;
      if (cfg.pricing) {
        u.estimatedCost =
          (u.inputTokens / 1e6) * cfg.pricing.inputPerMTok + (u.outputTokens / 1e6) * cfg.pricing.outputPerMTok;
        u.currency = cfg.pricing.currency;
      }
      return u as UsageDay & Record<string, unknown>;
    });
  } catch (err) {
    console.warn("[studio] usage record failed:", errorMessage(err));
  }
}

/* ───────────────────────── Router with fallback ───────────────────────── */

export interface CallContext {
  stage?: string;
  jobId?: string;
  /** Collected audit trail (provider/model per call). */
  audit?: Array<{ stage: string; provider: string; model: string; at: string }>;
}

function eligible(p: ProviderConfig, now: number): boolean {
  if (!p.enabled || p.state.needsAttention) return false;
  if (p.state.rateLimitedUntil && Date.parse(p.state.rateLimitedUntil) > now) return false;
  return true;
}

export async function chat(req: ChatRequest, ctx: CallContext = {}): Promise<ChatResult> {
  const providers = await listProviders();
  if (!providers.some((p) => p.enabled)) {
    throw new NoProviderAvailableError("No AI provider is configured. Add one under Integrations.", "none_configured");
  }
  const now = Date.now();
  const candidates = providers.filter((p) => eligible(p, now));
  if (!candidates.length) {
    const limited = providers
      .filter((p) => p.enabled && !p.state.needsAttention && p.state.rateLimitedUntil)
      .map((p) => p.state.rateLimitedUntil!)
      .sort();
    if (limited.length) {
      throw new NoProviderAvailableError("All AI providers are rate-limited.", "all_limited", limited[0]);
    }
    throw new NoProviderAvailableError("All AI providers need attention (invalid key or model).", "all_failing");
  }

  let lastErr: AiError | null = null;
  let networkFailures = 0;
  let rateLimited = 0;
  for (const cfg of candidates) {
    const apiKey = resolveSecret(cfg.keyRef);
    if (!apiKey) {
      await patchProviderState(cfg.id, { needsAttention: "API key is missing (environment variable empty or secret unreadable).", lastErrorAt: nowIso() });
      continue;
    }
    const started = Date.now();
    try {
      const out = await ADAPTERS[cfg.kind].chat(cfg, apiKey, req);
      await recordUsage(cfg, cfg.model, {
        ok: true,
        inputTokens: out.inputTokens,
        outputTokens: out.outputTokens,
        durationMs: Date.now() - started,
      });
      await patchProviderState(cfg.id, { lastSuccessAt: nowIso(), rateLimitedUntil: undefined });
      ctx.audit?.push({ stage: ctx.stage ?? "", provider: cfg.name, model: out.model, at: nowIso() });
      return { ...out, providerId: cfg.id, providerName: cfg.name };
    } catch (err) {
      const e = err instanceof AiError ? err : new AiError(errorMessage(err), "unavailable");
      lastErr = e;
      await recordUsage(cfg, cfg.model, { ok: false, rateLimited: e.kind === "rate_limit", durationMs: Date.now() - started });
      const statePatch: Partial<ProviderConfig["state"]> = {
        lastErrorAt: nowIso(),
        lastError: e.message.slice(0, 300),
        lastErrorKind: e.kind,
      };
      if (e.kind === "rate_limit") {
        statePatch.rateLimitedUntil = new Date(Date.now() + (e.retryAfterSec ?? 30) * 1000).toISOString();
        await notify(
          { kind: "rate_limit", level: "warning", title: `${cfg.name} rate limit reached`, body: "Requests will move to the next eligible provider or resume automatically.", href: "/admin/integrations" },
          { dedupeKey: `rate-${cfg.id}-${new Date().toISOString().slice(0, 13)}` },
        );
      }
      if (e.kind === "auth" || e.kind === "config") {
        // Permanent: do not keep retrying this provider; an admin must fix it.
        statePatch.needsAttention = e.kind === "auth" ? "The API key was rejected." : "The model or endpoint is not valid.";
        await notify(
          { kind: "provider_down", level: "error", title: `${cfg.name} needs attention`, body: statePatch.needsAttention, href: "/admin/integrations" },
          { dedupeKey: `attention-${cfg.id}` },
        );
      }
      await patchProviderState(cfg.id, statePatch);
      if (e.kind === "network") networkFailures++;
      if (e.kind === "rate_limit") rateLimited++;
      // Our own request was invalid or the output was bad: another provider would not help reliably.
      if (e.kind === "bad_request" || e.kind === "bad_output") throw e;
    }
  }
  if (lastErr && networkFailures === candidates.length) {
    throw new NoProviderAvailableError("The network appears to be unavailable.", "network");
  }
  // Every eligible provider is temporarily limited: wait for the earliest one instead of burning retries.
  if (lastErr && rateLimited === candidates.length) {
    const again = await listProviders();
    const until = again
      .filter((p) => p.enabled && !p.state.needsAttention && p.state.rateLimitedUntil)
      .map((p) => p.state.rateLimitedUntil!)
      .sort()[0];
    throw new NoProviderAvailableError(`All AI providers are rate-limited (${lastErr.message.slice(0, 160)})`, "all_limited", until);
  }
  throw lastErr ?? new NoProviderAvailableError("No AI provider could be used.", "all_failing");
}

/** Structured JSON call with schema validation via a caller-supplied parser. */
export async function chatJson<T>(
  req: ChatRequest & { json: { name: string; schema: object } },
  parse: (value: unknown) => T,
  ctx: CallContext = {},
): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    const out = await chat(attempt === 0 ? req : { ...req, temperature: 0.1 }, ctx);
    try {
      const cleaned = out.text.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "");
      return parse(JSON.parse(cleaned));
    } catch (err) {
      lastErr = err;
    }
  }
  throw new AiError(`AI output did not match the expected format: ${errorMessage(lastErr)}`, "bad_output");
}

/** Lightweight connection test used by the Integrations page. */
export async function testProvider(cfg: ProviderConfig): Promise<{ ok: boolean; message: string; ms: number }> {
  const apiKey = resolveSecret(cfg.keyRef);
  if (!apiKey) return { ok: false, message: "API key is missing.", ms: 0 };
  const started = Date.now();
  try {
    const out = await ADAPTERS[cfg.kind].chat(cfg, apiKey, {
      system: "You are a connection test.",
      user: 'Reply with the JSON object {"ok": true}.',
      json: {
        name: "ping",
        schema: { type: "object", properties: { ok: { type: "boolean" } }, required: ["ok"], additionalProperties: false },
      },
      maxTokens: 400,
      timeoutMs: 30_000,
    });
    await recordUsage(cfg, cfg.model, { ok: true, inputTokens: out.inputTokens, outputTokens: out.outputTokens, durationMs: Date.now() - started });
    await patchProviderState(cfg.id, { lastSuccessAt: nowIso(), needsAttention: undefined, rateLimitedUntil: undefined });
    return { ok: true, message: `Connected (${out.model})`, ms: Date.now() - started };
  } catch (err) {
    const e = err instanceof AiError ? err : new AiError(errorMessage(err), "unavailable");
    await patchProviderState(cfg.id, {
      lastErrorAt: nowIso(),
      lastError: e.message.slice(0, 300),
      lastErrorKind: e.kind,
      // A failed test with a rejected key/model takes the provider out of fallback until fixed.
      ...(e.kind === "auth" || e.kind === "config" ? { needsAttention: e.kind === "auth" ? "The API key was rejected." : "The model or endpoint is not valid." } : {}),
    });
    return { ok: false, message: e.message, ms: Date.now() - started };
  }
}
