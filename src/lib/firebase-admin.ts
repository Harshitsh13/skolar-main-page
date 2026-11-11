import "server-only";

let dbPromise: Promise<import("firebase-admin/firestore").Firestore> | null = null;

function parseServiceAccount(): Record<string, unknown> | null {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  if (!raw) return null;
  try {
    const decoded = raw.startsWith("{") ? raw : Buffer.from(raw, "base64").toString("utf8");
    return JSON.parse(decoded) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function hasFirebaseAdmin(): boolean {
  return parseServiceAccount() !== null;
}

export class FirebaseAdminNotConfiguredError extends Error {}

export async function getAdminDb(): Promise<import("firebase-admin/firestore").Firestore> {
  const serviceAccount = parseServiceAccount();
  if (!serviceAccount) {
    throw new FirebaseAdminNotConfiguredError(
      "FIREBASE_SERVICE_ACCOUNT_JSON is missing or invalid. Add your Firebase service account JSON to enable admin writes.",
    );
  }
  if (!dbPromise) {
    dbPromise = (async () => {
      const { initializeApp, getApps, cert } = await import("firebase-admin/app");
      const { getFirestore } = await import("firebase-admin/firestore");
      const app =
        getApps().find((a) => a.name === "skolar-site") ??
        initializeApp({ credential: cert(serviceAccount as import("firebase-admin").ServiceAccount) }, "skolar-site");
      return getFirestore(app);
    })();
  }
  return dbPromise;
}

