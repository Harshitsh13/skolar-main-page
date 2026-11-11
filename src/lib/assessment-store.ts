import "server-only";
import type { FinderAnswers, FinderResult } from "./finder-schema";
import { getAdminDb, hasFirebaseAdmin } from "./firebase-admin";

/**
 * Optional persistence of University Finder assessments to Firestore
 * (`finderAssessments`) using the Admin SDK. Enabled only when
 * FINDER_STORE_ASSESSMENTS=true and a service account is configured.
 *
 * No names, emails or phone numbers are collected by the finder. The free-text
 * answer may still contain personal details, so describe this in the Privacy Policy.
 */

function enabled() {
  return process.env.FINDER_STORE_ASSESSMENTS === "true" && hasFirebaseAdmin();
}

/** Human-friendly reference, e.g. "SK-7KQ2MD". Avoids look-alike characters. */
function makeRef() {
  const chars = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  return "SK-" + Array.from(bytes, (b) => chars[b % chars.length]).join("");
}

export async function storeAssessment(answers: FinderAnswers, result: FinderResult, model: string): Promise<string | null> {
  if (!enabled()) return null;
  try {
    const db = await getAdminDb();
    const ref = makeRef();
    await db.collection("finderAssessments").doc(ref).set({
      ref,
      answers,
      result,
      model,
      source: "skolar-main-website",
      status: "new",
      createdAt: new Date().toISOString(),
    });
    return ref;
  } catch (err) {
    console.error("[finder] could not store assessment:", err);
    return null;
  }
}
