import { NextResponse } from "next/server";
import { answersSchema, resultJsonSchema, resultSchema, type FinderResponse, type FinderResult } from "@/lib/finder-schema";
import { SYSTEM_PROMPT, buildUserPrompt } from "@/lib/finder-prompt";
import { grokStructured, GrokNotConfiguredError, AiRateLimitError, getConfiguredAiModel } from "@/lib/grok";
import { getDestinations } from "@/lib/content";
import { storeAssessment } from "@/lib/assessment-store";
import type { Destination } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

/* Best-effort, per-instance rate limit. For stronger protection on Vercel,
   add a Firewall rate-limit rule on /api/finder. */
const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = 6;
const hits = new Map<string, number[]>();

function rateLimited(ip: string) {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) hits.clear();
  return recent.length > MAX_PER_WINDOW;
}

const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

/** Never trust the model's "verified" labels: re-check them against published data. */
function enforceVerification(result: FinderResult, platforms: Destination[]): FinderResult {
  const platformIds = new Set(platforms.map((p) => p.id));
  const listed = new Set(platforms.flatMap((p) => p.institutions ?? []).map(norm));
  return {
    ...result,
    universityRecommendations: result.universityRecommendations.map((u) => ({
      ...u,
      status: u.status === "skolar_listed" && listed.has(norm(u.universityName)) ? "skolar_listed" : "to_verify",
    })),
    relatedPlatformIds: [...new Set(result.relatedPlatformIds)].filter((id) => platformIds.has(id)),
    counsellorBrief: result.counsellorBrief.slice(0, 400),
  };
}

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (rateLimited(ip)) {
    return NextResponse.json(
      {
        error: "rate_limited",
        retryAfterSeconds: 90,
        message: "You've run several searches in a short time. Please wait a couple of minutes and try again, or send your answers directly to a SKOLAR counsellor.",
      },
      { status: 429, headers: { "Retry-After": "90" } },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_request", message: "Invalid request." }, { status: 400 });
  }

  const parsed = answersSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_answers", message: "Some answers look incomplete. Please review them and try again." },
      { status: 400 },
    );
  }
  const answers = parsed.data;

  const { items, source } = await getDestinations();
  // Sample cards are illustrative only and must never ground the AI.
  const platforms = source === "firestore" || source === "default" ? items : [];

  try {
    const raw = await grokStructured({
      system: SYSTEM_PROMPT,
      user: buildUserPrompt(answers, platforms),
      schemaName: "skolar_finder_report",
      schema: resultJsonSchema,
    });

    const checked = resultSchema.safeParse(raw);
    if (!checked.success) {
      console.error("[finder] model output failed validation", checked.error.issues.slice(0, 5));
      throw new Error("Model output failed validation");
    }

    const result = enforceVerification(checked.data, platforms);
    const ref = await storeAssessment(answers, result, getConfiguredAiModel());

    const response: FinderResponse = { result, ref, generatedAt: new Date().toISOString() };
    return NextResponse.json(response, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof GrokNotConfiguredError) {
      return NextResponse.json(
        {
          error: "not_configured",
          message: "The University Finder isn't connected yet. A SKOLAR counsellor can review your answers with you instead.",
        },
        { status: 503 },
      );
    }
    if (err instanceof AiRateLimitError) {
      return NextResponse.json(
        {
          error: "queued",
          retryAfterSeconds: err.retryAfterSeconds,
          message:
            "A lot of students are using the University Finder right now. Please wait a few minutes while we free up a spot, or message a SKOLAR counsellor directly.",
        },
        { status: 429, headers: { "Retry-After": String(err.retryAfterSeconds) } },
      );
    }
    console.error("[finder] analysis failed:", err);
    return NextResponse.json(
      {
        error: "analysis_failed",
        message: "We couldn't complete your analysis just now. Your answers are saved, so please try again.",
      },
      { status: 502 },
    );
  }
}
