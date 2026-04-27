/**
 * Client-side crypto utilities (embedded as JS strings in pages).
 *
 * These functions run in the browser via Web Crypto API:
 * - Encrypt: derive AES-GCM key from passphrase, encrypt each chunk
 * - Decrypt: re-derive key from passphrase, decrypt each chunk
 */

export const CRYPTO_JS = `
// ── Crypto utils (AES-GCM, PBKDF2-derived key) ──

const CRYPTO_SALT_LEN = 16;
const CRYPTO_IV_LEN   = 12;
const CRYPTO_KEY_ITER = 100000;

/** Derive an AES-GCM key from a passphrase + salt */
async function deriveKey(passphrase, salt) {
  const enc = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw", enc.encode(passphrase),
    "PBKDF2", false, ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations: CRYPTO_KEY_ITER, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false, ["encrypt", "decrypt"]
  );
}

/** Encrypt a single chunk (ArrayBuffer) with a passphrase.
 *  Returns { encrypted: ArrayBuffer, iv: Uint8Array, salt: Uint8Array }
 */
async function encryptChunk(chunkBuf, passphrase) {
  const salt = crypto.getRandomValues(new Uint8Array(CRYPTO_SALT_LEN));
  const iv   = crypto.getRandomValues(new Uint8Array(CRYPTO_IV_LEN));
  const key  = await deriveKey(passphrase, salt);
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key, chunkBuf
  );
  return { encrypted, iv, salt };
}

/** Decrypt a single chunk */
async function decryptChunk(encryptedBuf, passphrase, iv, salt) {
  const key = await deriveKey(passphrase, salt);
  return crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    key, encryptedBuf
  );
}

/** Encode base64url (safe for JSON/filenames) */
function bufToB64(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\\+/g, "-").replace(/\\//g, "_").replace(/=+/g, "");
}
function b64ToBuf(b64) {
  b64 = (b64 + "===").slice(0, (b64.length + 3) & ~3)
    .replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0)).buffer;
}
`; // End CRYPTO_JS
