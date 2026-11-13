import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { timingSafeEqual } from "node:crypto";
import { publishDue } from "@/studio/core/schedule";
import { advancePublishing } from "@/studio/core/publish";
import { advanceCountries } from "@/studio/core/countries";
import { storeInfo } from "@/studio/core/store";

/**
 * Production publishing without a browser or the laptop worker:
 * Vercel Cron (or any scheduler) calls GET /api/studio/cron with
 * "Authorization: Bearer <CRON_SECRET>". Publishes every scheduled article
 * that is due. Idempotent — safe to call as often as you like.
 */
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return false;
  const got = Buffer.from(req.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  return got.length === want.length && timingSafeEqual(got, want);
}

export async function GET(req: Request) {
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (storeInfo().kind === "none") return NextResponse.json({ error: "studio_store_not_configured" }, { status: 503 });
  const revalidate = async (paths: string[]) => {
    for (const p of paths) revalidatePath(p);
    revalidatePath("/", "layout");
  };
  const results = await publishDue({ actor: "worker", revalidate });
  // Confirms deployments and verifies live pages for articles/countries in progress.
  const inProgress = await advancePublishing(revalidate).catch(() => 0);
  await advanceCountries().catch(() => undefined);
  return NextResponse.json({ results, inProgress, at: new Date().toISOString() });
}
