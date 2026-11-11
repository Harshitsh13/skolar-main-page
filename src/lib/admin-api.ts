import "server-only";
import { NextResponse } from "next/server";
import { isAdminAuthenticated } from "./admin-auth";
import { getAdminDb, hasFirebaseAdmin } from "./firebase-admin";
import { deleteDocumentRest, firestoreConfigured, listDocumentsRest, setDocumentRest } from "./firestore-rest";

export interface AdminStore {
  list(collection: string): Promise<Array<Record<string, unknown> & { id: string }>>;
  set(collection: string, id: string, doc: Record<string, unknown>, merge?: boolean): Promise<void>;
  remove(collection: string, id: string): Promise<void>;
}

async function getAdminStore(): Promise<AdminStore> {
  if (hasFirebaseAdmin()) {
    const db = await getAdminDb();
    return {
      async list(collection) {
        const snap = await db.collection(collection).get();
        return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      },
      async set(collection, id, doc, merge = false) {
        await db.collection(collection).doc(id).set(doc, { merge });
      },
      async remove(collection, id) {
        await db.collection(collection).doc(id).delete();
      },
    };
  }

  if (firestoreConfigured()) {
    return {
      list: listDocumentsRest,
      set: setDocumentRest,
      remove: deleteDocumentRest,
    };
  }

  throw new Error("Configure FIREBASE_PROJECT_ID and FIREBASE_WEB_API_KEY in environment variables.");
}

export async function withAdminStore<T>(fn: (store: AdminStore) => Promise<T>): Promise<NextResponse> {
  if (!(await isAdminAuthenticated())) {
    return NextResponse.json({ error: "unauthorized", message: "Please sign in first." }, { status: 401 });
  }
  try {
    const store = await getAdminStore();
    const result = await fn(store);
    return NextResponse.json(result);
  } catch (err) {
    console.error("[admin] error:", err);
    return NextResponse.json(
      { error: "admin_error", message: err instanceof Error ? err.message : "Operation failed." },
      { status: 500 },
    );
  }
}
