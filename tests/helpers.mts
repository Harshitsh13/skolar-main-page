import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** Isolated temp Studio environment (local store + temp project root). Call before importing Studio modules' functions. */
export function setupEnv(name: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `skolar-studio-${name}-`));
  process.env.STUDIO_STORE = "local";
  process.env.STUDIO_DATA_DIR = path.join(dir, "data");
  process.env.STUDIO_PROJECT_ROOT = dir;
  delete process.env.GROQ_API_KEY;
  delete process.env.GITHUB_TOKEN;
  delete process.env.GITHUB_REPO;
  delete process.env.SERPER_API_KEY;
  delete process.env.BRAVE_SEARCH_API_KEY;
  delete process.env.GOOGLE_CSE_API_KEY;
  delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  delete process.env.REVALIDATE_SECRET;
  delete process.env.VERCEL;
  return dir;
}

type Route = (url: string, init?: RequestInit) => Response | Promise<Response> | null;

/** Replaces global fetch with a router; unmatched requests throw like a network failure. */
export function mockFetch(routes: Route[]) {
  const original = globalThis.fetch;
  const calls: Array<{ url: string; method: string; body?: string }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    calls.push({ url, method: init?.method ?? "GET", body: typeof init?.body === "string" ? init.body : undefined });
    for (const r of routes) {
      const res = await r(url, init);
      if (res) return res;
    }
    throw new TypeError(`fetch failed (no mock for ${url})`);
  }) as typeof fetch;
  return { calls, restore: () => (globalThis.fetch = original) };
}

export const html = (body: string, title = "Page") =>
  new Response(`<!doctype html><html><head><title>${title}</title></head><body><main>${body}</main></body></html>`, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
