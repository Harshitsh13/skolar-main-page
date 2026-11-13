import { studioEnv } from "../env";
import { FirestoreStore, parseServiceAccount } from "./firestore";
import { FirestoreRestStore } from "./rest";
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

function hasFirestoreRest(): boolean {
  return Boolean(process.env.FIREBASE_PROJECT_ID?.trim() && process.env.FIREBASE_WEB_API_KEY?.trim());
}

export function storeInfo(): StoreInfo {
  const override = studioEnv.storeOverride();
  const hasSa = parseServiceAccount() !== null;
  const hasRest = hasFirestoreRest();

  if (override === "local") {
    if (studioEnv.isVercel()) return { kind: "none", reason: "STUDIO_STORE=local cannot be used on Vercel (read-only, ephemeral disk)." };
    return { kind: "local", reason: `Local data folder (${studioEnv.dataDir()})` };
  }
  if (override === "firestore" || hasSa || hasRest) {
    if (hasSa) return { kind: "firestore", reason: `Firestore Admin (${process.env.FIREBASE_PROJECT_ID ?? "from service account"})` };
    if (hasRest) return { kind: "firestore", reason: `Firestore REST (${process.env.FIREBASE_PROJECT_ID})` };
    return { kind: "none", reason: "Firestore requested but neither FIREBASE_SERVICE_ACCOUNT_JSON nor FIREBASE_WEB_API_KEY is configured." };
  }
  if (studioEnv.isVercel()) {
    return {
      kind: "none",
      reason: "Studio needs Firebase in production: set FIREBASE_PROJECT_ID and FIREBASE_WEB_API_KEY in Vercel.",
    };
  }
  return { kind: "local", reason: `Local data folder (${studioEnv.dataDir()}). Add Firebase to use cloud storage.` };
}

export function getStore(): StudioStore {
  if (cached) return cached;
  const info = storeInfo();
  if (info.kind === "none") throw new StoreNotConfiguredError(info.reason);
  if (info.kind === "firestore") {
    cached = parseServiceAccount() !== null ? new FirestoreStore() : new FirestoreRestStore();
  } else {
    cached = new LocalStore(studioEnv.dataDir());
  }
  return cached;
}

/** Test hook. */
export function setStoreForTests(store: StudioStore | null) {
  cached = store;
}
