import type { Firestore, Query } from "firebase-admin/firestore";
import type { DocData, ListOptions, StudioStore, WithId } from "./types";
import { sortAndLimit } from "./types";

/**
 * Firestore store via the Admin SDK (service account). Studio collections are
 * private: Firestore security rules deny all client access to `studio*`
 * collections, and only this server-side SDK (which bypasses rules) can reach
 * them.
 */

let dbPromise: Promise<Firestore> | null = null;

export function parseServiceAccount(): Record<string, unknown> | null {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  if (!raw) return null;
  try {
    const decoded = raw.startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
    const parsed = JSON.parse(decoded) as Record<string, unknown>;
    return typeof parsed.private_key === "string" && typeof parsed.client_email === "string" ? parsed : null;
  } catch {
    return null;
  }
}

export async function getFirebaseApp() {
  const sa = parseServiceAccount();
  if (!sa) throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON is missing or invalid.");
  const { initializeApp, getApps, cert } = await import("firebase-admin/app");
  return (
    getApps().find((a) => a.name === "skolar-studio") ??
    initializeApp(
      {
        credential: cert(sa as import("firebase-admin").ServiceAccount),
        storageBucket: process.env.FIREBASE_STORAGE_BUCKET?.trim() || undefined,
      },
      "skolar-studio",
    )
  );
}

async function db(): Promise<Firestore> {
  if (!dbPromise) {
    dbPromise = (async () => {
      const { getFirestore } = await import("firebase-admin/firestore");
      const fsdb = getFirestore(await getFirebaseApp());
      try {
        fsdb.settings({ ignoreUndefinedProperties: true });
      } catch {
        /* settings already applied */
      }
      return fsdb;
    })();
  }
  return dbPromise;
}

const clean = (d: DocData): DocData => JSON.parse(JSON.stringify(d)) as DocData;

export class FirestoreStore implements StudioStore {
  readonly kind = "firestore" as const;

  async get<T extends DocData>(collection: string, id: string): Promise<WithId<T> | null> {
    const snap = await (await db()).collection(collection).doc(id).get();
    return snap.exists ? ({ ...(snap.data() as T), id: snap.id } as WithId<T>) : null;
  }

  async list<T extends DocData>(collection: string, opts?: ListOptions): Promise<Array<WithId<T>>> {
    let q: Query = (await db()).collection(collection);
    const where = opts?.where ?? [];
    for (const [f, v] of where) q = q.where(f, "==", v);
    // Equality filters + orderBy on another field would need a composite index;
    // in that case sort/limit in memory instead.
    const serverSort = opts?.orderBy && where.length === 0;
    if (serverSort) q = q.orderBy(opts!.orderBy!.field, opts!.orderBy!.direction ?? "asc");
    if (serverSort && opts?.limit) q = q.limit(opts.limit);
    const snap = await q.get();
    const rows = snap.docs.map((d) => ({ ...(d.data() as T), id: d.id }) as WithId<T>);
    return serverSort ? rows : sortAndLimit(rows, { orderBy: opts?.orderBy, limit: opts?.limit });
  }

  async set(collection: string, id: string, data: DocData, opts?: { merge?: boolean }): Promise<void> {
    await (await db())
      .collection(collection)
      .doc(id)
      .set(clean({ ...data, id }), { merge: Boolean(opts?.merge) });
  }

  async create(collection: string, id: string, data: DocData): Promise<boolean> {
    try {
      await (await db()).collection(collection).doc(id).create(clean({ ...data, id }));
      return true;
    } catch (err) {
      const code = (err as { code?: number | string }).code;
      if (code === 6 || code === "already-exists" || code === "ALREADY_EXISTS") return false;
      throw err;
    }
  }

  async remove(collection: string, id: string): Promise<void> {
    await (await db()).collection(collection).doc(id).delete();
  }

  async transact<T extends DocData>(
    collection: string,
    id: string,
    fn: (current: WithId<T> | null) => T | undefined,
  ): Promise<WithId<T> | null> {
    const d = await db();
    const ref = d.collection(collection).doc(id);
    return d.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const current = snap.exists ? ({ ...(snap.data() as T), id } as WithId<T>) : null;
      const next = fn(current);
      if (next === undefined) return current;
      const stored = clean({ ...next, id }) as WithId<T>;
      tx.set(ref, stored);
      return stored;
    });
  }
}
