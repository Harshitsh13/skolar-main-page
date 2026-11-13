import { createCipheriv, createDecipheriv, createHash, randomBytes, scryptSync } from "node:crypto";
import { studioEnv } from "./env";

/**
 * Credentials entered in Studio are encrypted at rest with AES-256-GCM
 * (authenticated encryption). The 256-bit key is derived (scrypt) from
 * STUDIO_ENCRYPTION_KEY, which lives only in the server environment.
 *
 * Ciphertext format: enc:v2:<keyId>:<iv>:<tag>:<data> (base64 parts).
 * keyId identifies which environment key encrypted the value, so the key can
 * be rotated: set the new key as STUDIO_ENCRYPTION_KEY, the old one as
 * STUDIO_ENCRYPTION_KEY_PREVIOUS, run "Re-encrypt stored keys", then remove
 * the previous key. Legacy enc:v1 values are still readable.
 *
 * Keys can also be referenced from environment variables ("env:GROQ_API_KEY").
 * Plaintext secrets are never stored, logged or returned to the browser.
 */

export class SecretsNotConfiguredError extends Error {}
export class SecretDecryptError extends Error {}

const MIN_LEN = 32;

function derive(raw: string): Buffer {
  return scryptSync(raw, "skolar-studio-v1", 32);
}
function keyId(k: Buffer): string {
  return createHash("sha256").update(k).digest("hex").slice(0, 8);
}

function keys(): { current: { k: Buffer; id: string } | null; previous: { k: Buffer; id: string } | null } {
  const cur = studioEnv.encryptionKey();
  const prev = process.env.STUDIO_ENCRYPTION_KEY_PREVIOUS?.trim() || null;
  const mk = (raw: string | null) => (raw && raw.length >= 16 ? (() => { const k = derive(raw); return { k, id: keyId(k) }; })() : null);
  return { current: mk(cur), previous: mk(prev) };
}

export function encryptionStatus(): { configured: boolean; strong: boolean; keyId: string | null; previousKeyId: string | null; problem: string | null } {
  const raw = studioEnv.encryptionKey();
  const { current, previous } = keys();
  if (!raw) return { configured: false, strong: false, keyId: null, previousKeyId: previous?.id ?? null, problem: "STUDIO_ENCRYPTION_KEY is not set." };
  if (raw.length < 16) return { configured: false, strong: false, keyId: null, previousKeyId: null, problem: "STUDIO_ENCRYPTION_KEY is too short (minimum 32 characters recommended)." };
  return { configured: true, strong: raw.length >= MIN_LEN, keyId: current!.id, previousKeyId: previous?.id ?? null, problem: raw.length < MIN_LEN ? "Key works but is shorter than 32 characters." : null };
}

export function canEncrypt(): boolean {
  return keys().current !== null;
}

export function encryptSecret(plain: string): string {
  const cur = keys().current;
  if (!cur) {
    throw new SecretsNotConfiguredError("Encryption is not configured: set STUDIO_ENCRYPTION_KEY (32+ random characters) on the server. Nothing was saved.");
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", cur.k, iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `enc:v2:${cur.id}:${iv.toString("base64")}:${cipher.getAuthTag().toString("base64")}:${enc.toString("base64")}`;
}

function tryDecrypt(k: Buffer, ivB: string, tagB: string, dataB: string): string | null {
  try {
    const d = createDecipheriv("aes-256-gcm", k, Buffer.from(ivB, "base64"));
    d.setAuthTag(Buffer.from(tagB, "base64"));
    return Buffer.concat([d.update(Buffer.from(dataB, "base64")), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/** Decrypts an "enc:" value; throws SecretDecryptError (never returns garbage). */
export function decryptSecret(ref: string): string {
  const { current, previous } = keys();
  const parts = ref.split(":");
  if (parts[0] !== "enc") throw new SecretDecryptError("Not an encrypted value.");
  if (!current && !previous) throw new SecretsNotConfiguredError("STUDIO_ENCRYPTION_KEY is not set, so stored keys cannot be decrypted.");
  const candidates = [current, previous].filter((x): x is { k: Buffer; id: string } => x !== null);
  if (parts[1] === "v2") {
    const [, , kid, iv, tag, data] = parts;
    const k = candidates.find((c) => c.id === kid);
    if (!k) throw new SecretDecryptError(`Encrypted with key ${kid}, which is not configured (rotate with STUDIO_ENCRYPTION_KEY_PREVIOUS).`);
    const out = tryDecrypt(k.k, iv, tag, data);
    if (out === null) throw new SecretDecryptError("Stored key failed authentication (tampered or wrong key).");
    return out;
  }
  if (parts[1] === "v1") {
    const [, , iv, tag, data] = parts;
    for (const c of candidates) {
      const out = tryDecrypt(c.k, iv, tag, data);
      if (out !== null) return out;
    }
    throw new SecretDecryptError("Legacy stored key could not be decrypted with the configured keys.");
  }
  throw new SecretDecryptError("Unknown secret format.");
}

/** Resolves a key reference to its plaintext (server-side only). Returns null if unavailable. */
export function resolveSecret(ref: string): string | null {
  if (ref.startsWith("env:")) {
    const name = ref.slice(4);
    if (!/^[A-Z][A-Z0-9_]{1,80}$/.test(name)) return null;
    return process.env[name]?.trim() || null;
  }
  if (ref.startsWith("enc:")) {
    try {
      return decryptSecret(ref);
    } catch {
      return null;
    }
  }
  return null;
}

export function needsReencryption(ref: string): boolean {
  if (!ref.startsWith("enc:")) return false;
  const cur = keys().current;
  return !cur || !ref.startsWith(`enc:v2:${cur.id}:`);
}

export function keyHint(plain: string): string {
  return plain.length > 8 ? `…${plain.slice(-4)}` : "set";
}

/** Round-trip + tamper detection self-test. */
export function encryptionSelfTest(): { ok: boolean; message: string } {
  const st = encryptionStatus();
  if (!st.configured) return { ok: false, message: st.problem ?? "Not configured." };
  const sample = `self-test-${randomBytes(8).toString("hex")}`;
  const enc = encryptSecret(sample);
  if (enc.includes(sample)) return { ok: false, message: "Ciphertext contains plaintext." };
  if (decryptSecret(enc) !== sample) return { ok: false, message: "Round trip failed." };
  const parts = enc.split(":");
  const data = Buffer.from(parts[5], "base64");
  data[0] ^= 0xff;
  parts[5] = data.toString("base64");
  try {
    decryptSecret(parts.join(":"));
    return { ok: false, message: "Tampered ciphertext was accepted." };
  } catch {
    /* expected */
  }
  return { ok: true, message: `AES-256-GCM round trip and tamper detection passed (key ${st.keyId}${st.strong ? "" : ", short key"}).` };
}
