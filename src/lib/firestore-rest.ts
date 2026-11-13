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

function encodeValue(v: unknown): FsValue {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === "string") return { stringValue: v };
  if (typeof v === "boolean") return { booleanValue: v };
  if (typeof v === "number") return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(encodeValue) } };
  if (typeof v === "object") return { mapValue: { fields: encodeFields(v as Record<string, unknown>) } };
  return { stringValue: String(v) };
}

function encodeFields(obj: Record<string, unknown>): Record<string, FsValue> {
  const entries = Object.entries(obj)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => [k, encodeValue(v)] as const);
  return Object.fromEntries(entries);
}

function restConfig(): { project: string; key: string; base: string } {
  const project = process.env.FIREBASE_PROJECT_ID?.trim();
  const key = process.env.FIREBASE_WEB_API_KEY?.trim();
  if (!project || !key) throw new Error("FIREBASE_PROJECT_ID and FIREBASE_WEB_API_KEY are not configured");
  return {
    project,
    key,
    base: `https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents`,
  };
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

export async function getDocumentRest(
  collection: string,
  id: string,
): Promise<(Record<string, unknown> & { id: string }) | null> {
  const { key, base } = restConfig();
  const res = await fetch(`${base}/${encodeURIComponent(collection)}/${encodeURIComponent(id)}?key=${key}`, {
    cache: "no-store",
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Firestore get ${collection}/${id} failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { fields?: Record<string, FsValue> };
  if (!data?.fields) return null;
  return { id, ...decodeFields(data.fields) };
}

export async function createDocumentRest(
  collection: string,
  id: string,
  doc: Record<string, unknown>,
): Promise<boolean> {
  const { key, base } = restConfig();
  const res = await fetch(
    `${base}/${encodeURIComponent(collection)}?documentId=${encodeURIComponent(id)}&key=${key}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fields: encodeFields(doc) }),
      cache: "no-store",
    },
  );
  if (res.status === 409) return false;
  if (!res.ok) {
    const text = await res.text();
    if (text.includes("ALREADY_EXISTS") || text.includes("already exists")) return false;
    throw new Error(`Firestore create ${collection}/${id} failed: ${res.status} ${text}`);
  }
  return true;
}

export async function listDocumentsRest(
  collection: string,
): Promise<Array<Record<string, unknown> & { id: string }>> {
  const { key, base } = restConfig();
  const res = await fetch(`${base}/${encodeURIComponent(collection)}?pageSize=200&key=${key}`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Firestore list ${collection} failed: ${res.status} ${await res.text()}`);
  const data = (await res.json()) as { documents?: Array<{ name: string; fields?: Record<string, FsValue> }> };
  return (data.documents ?? []).map((doc) => ({
    id: doc.name.split("/").pop()!,
    ...decodeFields(doc.fields ?? {}),
  }));
}

export async function setDocumentRest(
  collection: string,
  id: string,
  doc: Record<string, unknown>,
  merge = false,
): Promise<void> {
  const { key, base } = restConfig();
  const keys = Object.keys(doc).filter((k) => doc[k] !== undefined);
  const mask = merge
    ? keys.map((k) => `updateMask.fieldPaths=${encodeURIComponent(k)}`).join("&") + "&"
    : "";
  const res = await fetch(`${base}/${encodeURIComponent(collection)}/${encodeURIComponent(id)}?${mask}key=${key}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ fields: encodeFields(doc) }),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Firestore write ${collection}/${id} failed: ${res.status} ${await res.text()}`);
}

export async function deleteDocumentRest(collection: string, id: string): Promise<void> {
  const { key, base } = restConfig();
  const res = await fetch(`${base}/${encodeURIComponent(collection)}/${encodeURIComponent(id)}?key=${key}`, {
    method: "DELETE",
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Firestore delete ${collection}/${id} failed: ${res.status} ${await res.text()}`);
}
