import "server-only";

/**
 * Minimal OpenAI-compatible AI client supporting Groq and xAI (Grok) with
 * strict JSON-schema structured output. API keys never leave the server.
 */

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const XAI_URL = "https://api.x.ai/v1/chat/completions";

const DEFAULT_GROQ_MODEL = "openai/gpt-oss-120b";
const DEFAULT_XAI_MODEL = "grok-4.7";

export class GrokNotConfiguredError extends Error {}

export class AiRateLimitError extends Error {
  readonly retryAfterSeconds: number;
  constructor(message: string, retryAfterSeconds = 25) {
    super(message);
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

function parseRetryAfter(header: string | null): number {
  if (!header) return 25;
  const secs = Number(header);
  if (Number.isFinite(secs) && secs > 0) return Math.min(180, Math.max(5, Math.ceil(secs)));
  const dateMs = Date.parse(header);
  if (Number.isFinite(dateMs)) {
    const diff = Math.ceil((dateMs - Date.now()) / 1000);
    if (diff > 0) return Math.min(180, Math.max(5, diff));
  }
  return 25;
}

interface AiProviderConfig {
  label: string;
  url: string;
  apiKey: string;
  model: string;
}

function resolveProvider(): AiProviderConfig | null {
  const groqKey = process.env.GROQ_API_KEY?.trim();
  if (groqKey) {
    return {
      label: "Groq",
      url: GROQ_URL,
      apiKey: groqKey,
      model: process.env.GROQ_MODEL?.trim() || DEFAULT_GROQ_MODEL,
    };
  }

  const xaiKey = process.env.XAI_API_KEY?.trim();
  if (xaiKey) {
    return {
      label: "xAI",
      url: XAI_URL,
      apiKey: xaiKey,
      model: process.env.XAI_MODEL?.trim() || DEFAULT_XAI_MODEL,
    };
  }

  return null;
}

export function getConfiguredAiModel(): string {
  return resolveProvider()?.model ?? DEFAULT_GROQ_MODEL;
}

export async function grokStructured<T = unknown>(opts: {
  system: string;
  user: string;
  schemaName: string;
  schema: object;
  timeoutMs?: number;
}): Promise<T> {
  const provider = resolveProvider();
  if (!provider) throw new GrokNotConfiguredError("GROQ_API_KEY or XAI_API_KEY is not set");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 55_000);

  try {
    const res = await fetch(provider.url, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${provider.apiKey}` },
      body: JSON.stringify({
        model: provider.model,
        temperature: 0.3,
        messages: [
          { role: "system", content: opts.system },
          { role: "user", content: opts.user },
        ],
        response_format: {
          type: "json_schema",
          json_schema: { name: opts.schemaName, schema: opts.schema, strict: true },
        },
      }),
      cache: "no-store",
    });

    if (res.status === 429) {
      const retryAfter = parseRetryAfter(res.headers.get("retry-after"));
      throw new AiRateLimitError(`${provider.label} rate limit reached: ${(await res.text()).slice(0, 300)}`, retryAfter);
    }

    if (!res.ok) {
      throw new Error(`${provider.label} ${res.status}: ${(await res.text()).slice(0, 500)}`);
    }
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error(`${provider.label} returned an empty response`);
    return JSON.parse(content) as T;
  } finally {
    clearTimeout(timer);
  }
}
