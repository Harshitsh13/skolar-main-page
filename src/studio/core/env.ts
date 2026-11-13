import fs from "node:fs";
import path from "node:path";

/**
 * Environment-driven Studio configuration. No platform-specific paths:
 * everything is relative to the project root or set through env vars, so the
 * same code runs on the Windows laptop, a MacBook, or Vercel.
 */

const v = (name: string) => {
  const raw = process.env[name];
  return raw && raw.trim() ? raw.trim() : null;
};

/** Resolves a bundled asset (fonts, brand logos, site photos) from the project root, else the app directory. */
export function assetPath(...parts: string[]): string {
  const roots = [process.env.STUDIO_PROJECT_ROOT?.trim(), process.cwd()].filter((r): r is string => Boolean(r));
  for (const r of roots) {
    const p = path.join(/*turbopackIgnore: true*/ r, ...parts);
    if (fs.existsSync(p)) return p;
  }
  return path.join(/*turbopackIgnore: true*/ process.cwd(), ...parts);
}

export const studioEnv = {
  projectRoot: () => v("STUDIO_PROJECT_ROOT") ?? process.cwd(),
  dataDir: () => v("STUDIO_DATA_DIR") ?? path.join(studioEnv.projectRoot(), ".studio-data"),
  contentDir: () => path.join(studioEnv.projectRoot(), "content", "insights"),
  /** "firestore" | "local" | null (auto) */
  storeOverride: () => v("STUDIO_STORE") as "firestore" | "local" | null,
  isProduction: () => process.env.NODE_ENV === "production",
  isVercel: () => Boolean(process.env.VERCEL),
  siteUrl: () => (v("NEXT_PUBLIC_SITE_URL") ?? "http://localhost:3000").replace(/\/+$/, ""),
  revalidateSecret: () => v("REVALIDATE_SECRET"),
  cronSecret: () => v("CRON_SECRET"),
  encryptionKey: () => v("STUDIO_ENCRYPTION_KEY"),

  github: () => {
    const token = v("GITHUB_TOKEN");
    const repo = v("GITHUB_REPO"); // "owner/name"
    if (!token || !repo || !/^[\w.-]+\/[\w.-]+$/.test(repo)) return null;
    return { token, repo, branch: v("GITHUB_BRANCH") ?? "main", dir: v("GITHUB_CONTENT_DIR") ?? "content/insights" };
  },

  firebaseBucket: () => v("FIREBASE_STORAGE_BUCKET"),
  blobToken: () => v("BLOB_READ_WRITE_TOKEN"),

  search: () => {
    if (v("SERPER_API_KEY")) return { kind: "serper" as const, key: v("SERPER_API_KEY")! };
    if (v("BRAVE_SEARCH_API_KEY")) return { kind: "brave" as const, key: v("BRAVE_SEARCH_API_KEY")! };
    if (v("GOOGLE_CSE_API_KEY") && v("GOOGLE_CSE_ID"))
      return { kind: "google_cse" as const, key: v("GOOGLE_CSE_API_KEY")!, cx: v("GOOGLE_CSE_ID")! };
    return null;
  },
};
