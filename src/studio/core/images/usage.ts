import { COL, getStore } from "../store";
import type { UsageDay } from "../types";
import { getSettings } from "../settings";
import { dayKey } from "../time";

/** Image requests are counted in the same daily usage table as text requests. */
export async function recordImageUsage(provider: string, model: string, ok: boolean, durationMs: number) {
  try {
    const day = dayKey(new Date(), (await getSettings()).publishing.timezone);
    const id = `${day}__image-${provider}__${model}`.replace(/[^A-Za-z0-9_.-]/g, "-");
    await getStore().transact<UsageDay & Record<string, unknown>>(COL.usage, id, (cur) => {
      const u: UsageDay = cur ?? { id, day, providerId: `image-${provider}`, providerName: `${provider} (images)`, model, requests: 0, failures: 0, rateLimits: 0, inputTokens: 0, outputTokens: 0, estimatedCost: null, currency: null, durationMs: 0 };
      u.requests += 1;
      if (!ok) u.failures += 1;
      u.durationMs += durationMs;
      return u as UsageDay & Record<string, unknown>;
    });
  } catch {
    /* usage is best effort */
  }
}
