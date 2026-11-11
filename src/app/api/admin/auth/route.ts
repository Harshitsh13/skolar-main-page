import { NextResponse } from "next/server";
import {
  ADMIN_COOKIE_NAME,
  createAdminSessionToken,
  isAdminAuthenticated,
  isAdminConfigured,
  verifyAdminPassword,
} from "@/lib/admin-auth";
import { hasFirebaseAdmin } from "@/lib/firebase-admin";
import { firestoreConfigured } from "@/lib/firestore-rest";

export const runtime = "nodejs";

export async function GET() {
  const authenticated = await isAdminAuthenticated();
  return NextResponse.json({
    authenticated,
    configured: {
      adminPassword: isAdminConfigured(),
      blob: Boolean(process.env.BLOB_READ_WRITE_TOKEN?.trim()),
      firestoreReady: hasFirebaseAdmin() || firestoreConfigured(),
      firestoreProjectId: process.env.FIREBASE_PROJECT_ID?.trim() || null,
    },
  });
}

export async function POST(req: Request) {
  if (!isAdminConfigured()) {
    return NextResponse.json(
      { error: "not_configured", message: "ADMIN_PASSWORD is not set in environment variables." },
      { status: 503 },
    );
  }
  const body = (await req.json().catch(() => ({}))) as { password?: string };
  if (typeof body.password !== "string" || !verifyAdminPassword(body.password.trim())) {
    return NextResponse.json({ error: "invalid_password", message: "Incorrect password." }, { status: 401 });
  }

  const isHttps = req.headers.get("x-forwarded-proto") === "https" || new URL(req.url).protocol === "https:";
  const token = createAdminSessionToken();
  const res = NextResponse.json({ ok: true });
  res.cookies.set(ADMIN_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: isHttps,
    path: "/",
    maxAge: 60 * 60 * 12,
  });
  return res;
}

export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.delete(ADMIN_COOKIE_NAME);
  return res;
}

