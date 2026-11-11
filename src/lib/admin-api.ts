import "server-only";
import { NextResponse } from "next/server";
import { isAdminAuthenticated } from "./admin-auth";
import { FirebaseAdminNotConfiguredError, getAdminDb } from "./firebase-admin";

export async function withAdminDb<T>(
  fn: (db: import("firebase-admin/firestore").Firestore) => Promise<T>,
): Promise<NextResponse> {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "unauthorized", message: "Please sign in first." }, { status: 401 });
  }
  try {
    const db = await getAdminDb();
    const result = await fn(db);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof FirebaseAdminNotConfiguredError) {
      return NextResponse.json({ error: "firebase_admin_missing", message: err.message }, { status: 503 });
    }
    console.error("[admin] error:", err);
    return NextResponse.json(
      { error: "admin_error", message: err instanceof Error ? err.message : "Operation failed." },
      { status: 500 },
    );
  }
}

