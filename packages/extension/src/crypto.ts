/**
 * AES-256-GCM encryption for on-device secrets. chrome.storage.local is
 * plaintext on disk — this is the difference between "on this device" and
 * "on this device, readable by anything with disk access."
 *
 * Two layers, for one reason: PBKDF2 at 250k iterations costs a few hundred
 * milliseconds, which is right for a once-per-unlock operation and wrong for
 * a per-document one. So the passphrase protects a single random document
 * key (`encryptWithPassphrase`), and that key protects each document
 * (`encryptWithKey`). Listing a ten-document vault costs one derivation
 * instead of ten.
 */

const PBKDF2_ITERATIONS = 250_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;

export interface EncryptedPayload {
  salt: string;
  iv: string;
  ciphertext: string;
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function newBytes(length: number): Uint8Array<ArrayBuffer> {
  return new Uint8Array(new ArrayBuffer(length));
}

function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = newBytes(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function deriveKey(passphrase: string, salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function encryptWithPassphrase(plaintext: string, passphrase: string): Promise<EncryptedPayload> {
  const salt = crypto.getRandomValues(newBytes(SALT_BYTES));
  const iv = crypto.getRandomValues(newBytes(IV_BYTES));
  const key = await deriveKey(passphrase, salt);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext));
  return {
    salt: toBase64(salt),
    iv: toBase64(iv),
    ciphertext: toBase64(new Uint8Array(ciphertext)),
  };
}

/** Throws (AES-GCM auth tag mismatch) if the passphrase is wrong or the payload was tampered with. */
export async function decryptWithPassphrase(payload: EncryptedPayload, passphrase: string): Promise<string> {
  const salt = fromBase64(payload.salt);
  const iv = fromBase64(payload.iv);
  const key = await deriveKey(passphrase, salt);
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, fromBase64(payload.ciphertext));
  return new TextDecoder().decode(plaintext);
}

const DOCUMENT_KEY_BYTES = 32;

/** A fresh random AES-256 key, base64-encoded so it can be stored and wrapped as text. */
export function generateDocumentKey(): string {
  return toBase64(crypto.getRandomValues(newBytes(DOCUMENT_KEY_BYTES)));
}

async function importDocumentKey(rawKeyBase64: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', fromBase64(rawKeyBase64), { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ]);
}

export async function encryptWithKey(plaintext: string, rawKeyBase64: string): Promise<EncryptedPayload> {
  const iv = crypto.getRandomValues(newBytes(IV_BYTES));
  const key = await importDocumentKey(rawKeyBase64);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext));
  // No salt: the key is already random, so there is nothing to stretch. The
  // field stays in the shape for one payload type across both layers.
  return { salt: '', iv: toBase64(iv), ciphertext: toBase64(new Uint8Array(ciphertext)) };
}

/** Throws (AES-GCM auth tag mismatch) if the key is wrong or the payload was tampered with. */
export async function decryptWithKey(payload: EncryptedPayload, rawKeyBase64: string): Promise<string> {
  const key = await importDocumentKey(rawKeyBase64);
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: fromBase64(payload.iv) },
    key,
    fromBase64(payload.ciphertext),
  );
  return new TextDecoder().decode(plaintext);
}
