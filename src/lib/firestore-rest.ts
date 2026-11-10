import "server-only";

/**
 * Minimal Firestore REST reader for PUBLISHED public content.
 * Runs on the server only, so the browser never loads the Firebase SDK.
 * Security comes from Firestore rules: only documents with
 * `published == true` / `status == "published"` are publicly readable.
 */

type FsValue = {
  stringValue?: string;
  integerValue?: string;
  doubleValue?: number;
  booleanValue?: boolean;
  timestampValue?: string;
  nullValue?: null;
  mapValue?: { fields?: Record<string, FsValue> };
  arrayValue?: { values?: FsValue[] };
};

function decode(v: FsValue): unknown {
  if (v.stringValue !== undefined) return v.stringValue;
  if (v.integerValue !== undefined) return Number(v.integerValue);
  if (v.doubleValue !== undefined) return v.doubleValue;
  if (v.booleanValue !== undefined) return v.booleanValue;
  if (v.timestampValue !== undefined) return v.timestampValue;
  if (v.mapValue) return decodeFields(v.mapValue.fields ?? {});
  if (v.arrayValue) return (v.arrayValue.values ?? []).map(decode);
  return null;
}

function decodeFields(fields: Record<string, FsValue>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, decode(v)]));
}

export function firestoreConfigured(): boolean {
  return Boolean(process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_WEB_API_KEY);
}

export interface PublicQuery {
  collection: string;
  /** Equality filter that must match the public-read rule for the collection. */
  where: { field: string; value: string | boolean };
  orderBy?: { field: string; direction: "ASCENDING" | "DESCENDING" };
  limit?: number;
  /** Seconds before Next.js refetches (ISR). */
  revalidate?: number;
}

export async function queryPublic(q: PublicQuery): Promise<Array<Record<string, unknown> & { id: string }>> {
  const project = process.env.FIREBASE_PROJECT_ID;
  const key = process.env.FIREBASE_WEB_API_KEY;
  if (!project || !key) throw new Error("Firestore is not configured");

  const value =
    typeof q.where.value === "boolean" ? { booleanValue: q.where.value } : { stringValue: q.where.value };

  const body = {
    structuredQuery: {
      from: [{ collectionId: q.collection }],
      where: { fieldFilter: { field: { fieldPath: q.where.field }, op: "EQUAL", value } },
      ...(q.orderBy && {
        orderBy: [{ field: { fieldPath: q.orderBy.field }, direction: q.orderBy.direction }],
      }),
      ...(q.limit && { limit: q.limit }),
    },
  };

  const res = await fetch(
    `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents:runQuery?key=${key}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      next: { revalidate: q.revalidate ?? 300, tags: [q.collection] },
    },
  );
  if (!res.ok) throw new Error(`Firestore query ${q.collection} failed: ${res.status} ${await res.text()}`);

  const rows = (await res.json()) as Array<{ document?: { name: string; fields?: Record<string, FsValue> } }>;
  return rows
    .filter((r) => r.document)
    .map((r) => ({
      id: r.document!.name.split("/").pop()!,
      ...decodeFields(r.document!.fields ?? {}),
    }));
}
