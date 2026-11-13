import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { randomBytes } from "node:crypto";
import type { DocData, ListOptions, StudioStore, WithId } from "./types";
import { sortAndLimit } from "./types";

/**
 * File-backed store: one JSON file per document under STUDIO_DATA_DIR.
 * Safe for the Next.js server and the background worker running side by side
 * on the same machine: writes are atomic (temp file + rename) and
 * read-modify-write operations take a per-document lock file.
 *
 * Intended for local use (development, or Studio + worker on one laptop).
 * Production deployments use Firestore.
 */

const SAFE = /^[A-Za-z0-9_.-]{1,200}$/;

function assertSafe(part: string, what: string) {
  if (!SAFE.test(part) || part.startsWith(".")) throw new Error(`Invalid ${what}: ${part}`);
}

export class LocalStore implements StudioStore {
  readonly kind = "local" as const;
  constructor(private readonly root: string) {}

  private dir(collection: string) {
    assertSafe(collection, "collection");
    return path.join(this.root, collection);
  }

  private file(collection: string, id: string) {
    assertSafe(id, "document id");
    return path.join(this.dir(collection), `${id}.json`);
  }

  private async readFile<T extends DocData>(file: string): Promise<T | null> {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        return JSON.parse(await fsp.readFile(file, "utf8")) as T;
      } catch (err) {
        const code = (err as NodeJS.ErrnoException).code;
        if (code === "ENOENT") return null;
        // A concurrent rename on Windows can briefly make the file unreadable.
        if (attempt === 2) throw err;
        await new Promise((r) => setTimeout(r, 25));
      }
    }
    return null;
  }

  private async writeFile(file: string, data: DocData) {
    await fsp.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
    await fsp.writeFile(tmp, JSON.stringify(data, null, 1), "utf8");
    for (let attempt = 0; ; attempt++) {
      try {
        await fsp.rename(tmp, file);
        return;
      } catch (err) {
        // Windows: EPERM/EBUSY while another process reads the target.
        if (attempt >= 8) {
          await fsp.rm(tmp, { force: true });
          throw err;
        }
        await new Promise((r) => setTimeout(r, 20 * (attempt + 1)));
      }
    }
  }

  private async withLock<T>(file: string, fn: () => Promise<T>): Promise<T> {
    const lock = `${file}.lock`;
    await fsp.mkdir(path.dirname(file), { recursive: true });
    const started = Date.now();
    for (;;) {
      try {
        const fd = fs.openSync(lock, "wx");
        fs.writeSync(fd, String(process.pid));
        fs.closeSync(fd);
        break;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
        // Stale lock (crashed process): break it after 15 s.
        try {
          const st = fs.statSync(lock);
          if (Date.now() - st.mtimeMs > 15_000) fs.rmSync(lock, { force: true });
        } catch {
          /* lock vanished */
        }
        if (Date.now() - started > 20_000) throw new Error(`Timed out waiting for lock on ${path.basename(file)}`);
        await new Promise((r) => setTimeout(r, 15 + Math.random() * 30));
      }
    }
    try {
      return await fn();
    } finally {
      fs.rmSync(lock, { force: true });
    }
  }

  async get<T extends DocData>(collection: string, id: string): Promise<WithId<T> | null> {
    const doc = await this.readFile<T>(this.file(collection, id));
    return doc ? ({ ...doc, id } as WithId<T>) : null;
  }

  async list<T extends DocData>(collection: string, opts?: ListOptions): Promise<Array<WithId<T>>> {
    const dir = this.dir(collection);
    let names: string[];
    try {
      names = await fsp.readdir(dir);
    } catch {
      return [];
    }
    const rows = await Promise.all(
      names
        .filter((n) => n.endsWith(".json"))
        .map(async (n) => {
          const id = n.slice(0, -5);
          const doc = await this.readFile<T>(path.join(dir, n));
          return doc ? ({ ...doc, id } as WithId<T>) : null;
        }),
    );
    const present = rows.filter((r) => r !== null) as Array<WithId<T>>;
    return sortAndLimit<T>(present, opts);
  }

  async set(collection: string, id: string, data: DocData, opts?: { merge?: boolean }): Promise<void> {
    const file = this.file(collection, id);
    if (!opts?.merge) {
      await this.writeFile(file, { ...data, id });
      return;
    }
    await this.withLock(file, async () => {
      const current = (await this.readFile<DocData>(file)) ?? {};
      await this.writeFile(file, { ...current, ...stripUndefined(data), id });
    });
  }

  async create(collection: string, id: string, data: DocData): Promise<boolean> {
    const file = this.file(collection, id);
    return this.withLock(file, async () => {
      if (fs.existsSync(file)) return false;
      await this.writeFile(file, { ...data, id });
      return true;
    });
  }

  async remove(collection: string, id: string): Promise<void> {
    await fsp.rm(this.file(collection, id), { force: true });
  }

  async transact<T extends DocData>(
    collection: string,
    id: string,
    fn: (current: WithId<T> | null) => T | undefined,
  ): Promise<WithId<T> | null> {
    const file = this.file(collection, id);
    return this.withLock(file, async () => {
      const raw = await this.readFile<T>(file);
      const current = raw ? ({ ...raw, id } as WithId<T>) : null;
      const next = fn(current);
      if (next === undefined) return current;
      const stored = { ...next, id } as WithId<T>;
      await this.writeFile(file, stored);
      return stored;
    });
  }
}

function stripUndefined(obj: DocData): DocData {
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined));
}
