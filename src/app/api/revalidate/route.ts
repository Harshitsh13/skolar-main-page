import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";

/**
 * Called by the SKOLAR Control Center after publishing, editing, reordering
 * or removing a destination card or article, so the homepage updates immediately.
 *
 *   POST /api/revalidate
 *   Header: x-revalidate-secret: <REVALIDATE_SECRET>
 */
export async function POST(req: Request) {
  const secret = process.env.REVALIDATE_SECRET;
  if (!secret || req.headers.get("x-revalidate-secret") !== secret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  revalidatePath("/", "layout");
  return NextResponse.json({ revalidated: true, at: new Date().toISOString() });
}
