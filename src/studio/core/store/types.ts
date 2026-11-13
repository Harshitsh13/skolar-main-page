export type DocData = Record<string, unknown>;
export type WithId<T> = T & { id: string };

export interface ListOptions {
  /** Equality filters only (no composite indexes needed in Firestore). */
  where?: Array<[field: string, value: string | number | boolean]>;
  orderBy?: { field: string; direction?: "asc" | "desc" };
  limit?: number;
}

export interface StudioStore {
  readonly kind: "firestore" | "local";
  get<T extends DocData>(collection: string, id: string): Promise<WithId<T> | null>;
  list<T extends DocData>(collection: string, opts?: ListOptions): Promise<Array<WithId<T>>>;
  /** Replace (or merge into) a document. */
  set(collection: string, id: string, data: DocData, opts?: { merge?: boolean }): Promise<void>;
  /** Atomically create; returns false if the document already exists. */
  create(collection: string, id: string, data: DocData): Promise<boolean>;
  remove(collection: string, id: string): Promise<void>;
  /**
   * Atomic read-modify-write. `fn` receives the current document (or null)
   * and returns the new document, or `undefined` to leave it untouched.
   * Returns the stored result.
   */
  transact<T extends DocData>(
    collection: string,
    id: string,
    fn: (current: WithId<T> | null) => T | undefined,
  ): Promise<WithId<T> | null>;
}

export function sortAndLimit<T extends DocData>(rows: Array<WithId<T>>, opts?: ListOptions): Array<WithId<T>> {
  let out = rows;
  if (opts?.where?.length) {
    out = out.filter((r) => opts.where!.every(([f, v]) => r[f] === v));
  }
  if (opts?.orderBy) {
    const { field, direction = "asc" } = opts.orderBy;
    const dir = direction === "asc" ? 1 : -1;
    out = [...out].sort((a, b) => {
      const av = a[field] as string | number | undefined;
      const bv = b[field] as string | number | undefined;
      if (av === bv) return 0;
      if (av === undefined || av === null) return 1;
      if (bv === undefined || bv === null) return -1;
      return av < bv ? -dir : dir;
    });
  }
  if (opts?.limit) out = out.slice(0, opts.limit);
  return out;
}
