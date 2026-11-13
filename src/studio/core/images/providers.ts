import { recordImageUsage } from "./usage";
import { errorMessage } from "../util";

/**
 * Image provider adapters. The text provider (Groq) cannot generate images,
 * so image generation has its own providers:
 *
 *  skolar-render  Always available. Renders the SKOLAR formats from code
 *                 (port of the TrendScout/skolarci thumbnail engine).
 *  openai         OpenAI Images API (gpt-image models). Needs OPENAI_API_KEY.
 *  gemini         Google Gemini image model. Needs GEMINI_API_KEY.
 *
 * AI providers produce only a background picture; SKOLAR branding, headline
 * and logo are always composited by the renderer, and QC runs on the result.
 */

export interface AiImageProvider {
  key: "openai" | "gemini";
  label: string;
  model(): string;
  configured(): boolean;
  missing(): string;
  test(): Promise<{ ok: boolean; message: string }>;
  generate(prompt: string, size: { width: number; height: number }): Promise<Buffer>;
}

export class ImageProviderError extends Error {
  constructor(
    message: string,
    readonly permanent: boolean,
  ) {
    super(message);
  }
}

const env = (k: string) => process.env[k]?.trim() || "";

async function call(url: string, init: RequestInit, label: string): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(180_000), cache: "no-store" });
  } catch (err) {
    throw new ImageProviderError(`${label}: network error (${errorMessage(err)})`, false);
  }
  if (!res.ok) {
    const text = (await res.text().catch(() => "")).slice(0, 300);
    const permanent = [400, 401, 403, 404].includes(res.status);
    throw new ImageProviderError(`${label} HTTP ${res.status}: ${text}`, permanent);
  }
  return res;
}

export const openaiImages: AiImageProvider = {
  key: "openai",
  label: "OpenAI Images",
  model: () => env("OPENAI_IMAGE_MODEL") || "gpt-image-1",
  configured: () => Boolean(env("OPENAI_API_KEY")),
  missing: () => "Set OPENAI_API_KEY (and optionally OPENAI_IMAGE_MODEL, default gpt-image-1).",
  async test() {
    if (!this.configured()) return { ok: false, message: this.missing() };
    try {
      await call(`https://api.openai.com/v1/models/${encodeURIComponent(this.model())}`, { headers: { Authorization: `Bearer ${env("OPENAI_API_KEY")}` } }, "OpenAI");
      return { ok: true, message: `Key valid; model ${this.model()} available` };
    } catch (err) {
      return { ok: false, message: errorMessage(err) };
    }
  },
  async generate(prompt, size) {
    const started = Date.now();
    const landscape = size.width >= size.height;
    try {
      const res = await call(
        "https://api.openai.com/v1/images/generations",
        {
          method: "POST",
          headers: { Authorization: `Bearer ${env("OPENAI_API_KEY")}`, "Content-Type": "application/json" },
          body: JSON.stringify({ model: this.model(), prompt, n: 1, size: landscape ? "1536x1024" : "1024x1536", quality: "medium" }),
        },
        "OpenAI",
      );
      const data = (await res.json()) as { data?: Array<{ b64_json?: string }> };
      const b64 = data.data?.[0]?.b64_json;
      if (!b64) throw new ImageProviderError("OpenAI returned no image data", false);
      await recordImageUsage("openai", this.model(), true, Date.now() - started);
      return Buffer.from(b64, "base64");
    } catch (err) {
      await recordImageUsage("openai", this.model(), false, Date.now() - started);
      throw err;
    }
  },
};

export const geminiImages: AiImageProvider = {
  key: "gemini",
  label: "Google Gemini image",
  model: () => env("GEMINI_IMAGE_MODEL") || "gemini-2.5-flash-image",
  configured: () => Boolean(env("GEMINI_API_KEY")),
  missing: () => "Set GEMINI_API_KEY (and optionally GEMINI_IMAGE_MODEL, default gemini-2.5-flash-image).",
  async test() {
    if (!this.configured()) return { ok: false, message: this.missing() };
    try {
      await call(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model())}`, { headers: { "x-goog-api-key": env("GEMINI_API_KEY") } }, "Gemini");
      return { ok: true, message: `Key valid; model ${this.model()} available` };
    } catch (err) {
      return { ok: false, message: errorMessage(err) };
    }
  },
  async generate(prompt) {
    const started = Date.now();
    try {
      const res = await call(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(this.model())}:generateContent`,
        {
          method: "POST",
          headers: { "x-goog-api-key": env("GEMINI_API_KEY"), "Content-Type": "application/json" },
          body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { responseModalities: ["IMAGE"] } }),
        },
        "Gemini",
      );
      const data = (await res.json()) as { candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { data?: string } }> } }> };
      const b64 = data.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)?.inlineData?.data;
      if (!b64) throw new ImageProviderError("Gemini returned no image data", false);
      await recordImageUsage("gemini", this.model(), true, Date.now() - started);
      return Buffer.from(b64, "base64");
    } catch (err) {
      await recordImageUsage("gemini", this.model(), false, Date.now() - started);
      throw err;
    }
  },
};

export const AI_IMAGE_PROVIDERS: AiImageProvider[] = [openaiImages, geminiImages];

/** First configured AI image provider, or null (SKOLAR renderer only). */
export function activeAiImageProvider(): AiImageProvider | null {
  const preferred = env("IMAGE_PROVIDER");
  const list = preferred ? [...AI_IMAGE_PROVIDERS].sort((a) => (a.key === preferred ? -1 : 1)) : AI_IMAGE_PROVIDERS;
  return list.find((p) => p.configured()) ?? null;
}

/** Test hook. */
export function setAiImageProviderForTests(p: AiImageProvider | null) {
  testOverride = p;
}
let testOverride: AiImageProvider | null | undefined;
export function aiProvider(): AiImageProvider | null {
  return testOverride !== undefined ? testOverride : activeAiImageProvider();
}
