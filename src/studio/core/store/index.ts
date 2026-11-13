import { studioEnv } from "../env";
import { FirestoreStore, parseServiceAccount } from "./firestore";
import { LocalStore } from "./local";
import type { StudioStore } from "./types";

export type { StudioStore, DocData, WithId, ListOptions } from "./types";

export const COL = {
  settings: "studioSettings",
  providers: "studioProviders",
  usage: "studioUsage",
  articles: "studioArticles",
  jobs: "studioJobs",
  topics: "studioTopics",
  sources: "studioSources",
  sourceChanges: "studioSourceChanges",
  pages: "studioPages",
  countries: "studioCountries",
  regions: "studioRegions",
  universities: "studioUniversities",
  scholarships: "studioScholarships",
  daily: "studioDaily",
  worker: "studioWorker",
  notifications: "studioNotifications",
  activity: "studioActivity",
  media: "studioMedia",
  imageLog: "studioImageLog",
  jobEvents: "studioJobEvents",
  workers: "studioWorkers",
  integrations: "studioIntegrations",
  discovered: "studioDiscoveredPages",
  siteDestinations: "siteDestinations",
  siteArticles: "siteArticles",
} as const;

export class StoreNotConfiguredError extends Error {}

let cached: StudioStore | null = null;

export interface StoreInfo {
  kind: "firestore" | "local" | "none";
  reason: string;
}

export function storeInfo(): StoreInfo {
  const override = studioEnv.storeOverride();
  const hasSa = parseServiceAccount() !== null;
  if (override === "local") {
    if (studioEnv.isVercel()) return { kind: "none", reason: "STUDIO_STORE=local cannot be used on Vercel (read-only, ephemeral disk)." };
    return { kind: "local", reason: `Local data folder (${studioEnv.dataDir()})` };
  }
  if (override === "firestore" || hasSa) {
    if (!hasSa) return { kind: "none", reason: "STUDIO_STORE=firestore but FIREBASE_SERVICE_ACCOUNT_JSON is missing or invalid." };
    return { kind: "firestore", reason: `Firestore project ${process.env.FIREBASE_PROJECT_ID ?? "(from service account)"}` };
  }
  if (studioEnv.isVercel()) {
    return {
      kind: "none",
      reason: "Studio needs Firestore in production: set FIREBASE_SERVICE_ACCOUNT_JSON in the Vercel project.",
    };
  }
  return { kind: "local", reason: `Local data folder (${studioEnv.dataDir()}). Add FIREBASE_SERVICE_ACCOUNT_JSON to use Firestore.` };
}

export function getStore(): StudioStore {
  if (cached) return cached;
  const info = storeInfo();
  if (info.kind === "none") throw new StoreNotConfiguredError(info.reason);
  cached = info.kind === "firestore" ? new FirestoreStore() : new LocalStore(studioEnv.dataDir());
  return cached;
}

/** Test hook. */
export function setStoreForTests(store: StudioStore | null) {
  cached = store;
}
