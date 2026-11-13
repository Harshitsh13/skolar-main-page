import "server-only";
import { createHmac, timingSafeEqual } from "crypto";
import { cookies } from "next/headers";

export const ADMIN_COOKIE_NAME = "skolar_admin_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 12; // 12 hours
const DEFAULT_ADMIN_PASSWORD = "skolar@2026";

/**
 * The built-in default password only works in local development. In
 * production (e.g. Vercel) ADMIN_PASSWORD must be set, otherwise sign-in is
 * disabled — a password published in the repository is not a password.
 */
function getPassword(): string {
  const configured = process.env.ADMIN_PASSWORD?.trim();
  if (configured) return configured;
  return process.env.NODE_ENV === "production" ? "" : DEFAULT_ADMIN_PASSWORD;
}

/* Best-effort brute-force protection (per server instance). */
const attempts = new Map<string, { count: number; until: number }>();

export function loginThrottled(key: string): boolean {
  const a = attempts.get(key);
  return Boolean(a && a.count >= 8 && a.until > Date.now());
}

export function recordLoginAttempt(key: string, ok: boolean) {
  if (ok) {
    attempts.delete(key);
    return;
  }
  const a = attempts.get(key) ?? { count: 0, until: 0 };
  a.count += 1;
  a.until = Date.now() + 15 * 60_000;
  attempts.set(key, a);
  if (attempts.size > 5000) attempts.clear();
}

function getSigningSecret(): string {
  const pw = getPassword();
  const extra = process.env.ADMIN_SESSION_SECRET?.trim() || process.env.FIREBASE_WEB_API_KEY?.trim() || "skolar-admin";
  return createHmac("sha256", extra).update(pw).digest("hex");
}

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export function isAdminConfigured(): boolean {
  return Boolean(getPassword());
}

export function verifyAdminPassword(candidate: string): boolean {
  return safeEqual(candidate, getPassword());
}

export function createAdminSessionToken(): string {
  const secret = getSigningSecret();
  const exp = String(Date.now() + SESSION_TTL_MS);
  const sig = createHmac("sha256", secret).update(exp).digest("hex");
  return `${exp}.${sig}`;
}

export function verifyAdminSessionToken(token: string | undefined): boolean {
  if (!token) return false;
  const secret = getSigningSecret();
  const [exp, sig] = token.split(".");
  if (!exp || !sig) return false;
  const expNum = Number(exp);
  if (!Number.isFinite(expNum) || expNum < Date.now()) return false;
  const expectedSig = createHmac("sha256", secret).update(exp).digest("hex");
  return safeEqual(sig, expectedSig);
}

export async function isAdminAuthenticated(): Promise<boolean> {
  const store = await cookies();
  return verifyAdminSessionToken(store.get(ADMIN_COOKIE_NAME)?.value);
}

