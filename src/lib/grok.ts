import "server-only";

/**
 * Minimal xAI (Grok) client. Uses the OpenAI-compatible Chat Completions endpoint
 * with strict JSON-schema structured output. The API key never leaves the server.
 */

const XAI_URL = "https://api.x.ai/v1/chat/completions";

export class GrokNotConfiguredError extends Error {}

export async function grokStructured<T = unknown>(opts: {
  system: string;
  user: string;
  schemaName: string;
  schema: object;
  timeoutMs?: number;
}): Promise<T> {
  const key = process.env.XAI_API_KEY;
  if (!key) throw new GrokNotConfiguredError("XAI_API_KEY is not set");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 55_000);

  try {
    const res = await fetch(XAI_URL, {
      method: "POST",
      signal: controller.signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: process.env.XAI_MODEL || "grok-4.7",
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

    if (!res.ok) {
      throw new Error(`xAI ${res.status}: ${(await res.text()).slice(0, 500)}`);
    }
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error("xAI returned an empty response");
    return JSON.parse(content) as T;
  } finally {
    clearTimeout(timer);
  }
}
