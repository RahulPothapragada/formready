/**
 * The PII profile, encrypted under one passphrase.
 * Encrypted-at-rest copy lives in chrome.storage.local (disk, survives
 * restarts). The decrypted copy lives only in chrome.storage.session
 * (RAM, cleared when the browser closes) after unlockVault() — nothing
 * decrypted ever touches disk, and content.ts never sees this module at
 * all; only background.ts and popup.ts import it.
 *
 * This module also owns the document key that vault.ts uses, because both
 * are unlocked by the same passphrase at the same moment.
 */

import {
  decryptWithPassphrase,
  encryptWithPassphrase,
  generateDocumentKey,
  type EncryptedPayload,
} from './crypto';

export type ProfileFieldKey =
  | 'fullName'
  | 'fatherName'
  | 'dob'
  | 'phone'
  | 'email'
  | 'aadhaar'
  | 'pan'
  | 'addressLine1'
  | 'addressLine2'
  | 'city'
  | 'district'
  | 'state'
  | 'pincode';

export type Profile = Partial<Record<ProfileFieldKey, string>>;

export const PROFILE_FIELD_KEYS: ProfileFieldKey[] = [
  'fullName',
  'fatherName',
  'dob',
  'phone',
  'email',
  'aadhaar',
  'pan',
  'addressLine1',
  'addressLine2',
  'city',
  'district',
  'state',
  'pincode',
];

export interface SecretBundle {
  profile: Profile;
}

const LOCAL_KEY = 'formready_vault_encrypted';
const SESSION_KEY = 'formready_vault_decrypted';
const DOCUMENT_KEY_LOCAL = 'formready_document_key_wrapped';
const DOCUMENT_KEY_SESSION = 'formready_document_key';

/**
 * The document key encrypts saved photos and signatures (see vault.ts). It
 * is created once, wrapped under the passphrase, and only ever unwrapped
 * into session storage — so locking the vault, or closing the browser,
 * leaves the documents on disk as ciphertext nobody can open.
 */
async function unlockDocumentKey(passphrase: string): Promise<void> {
  const stored = (await chrome.storage.local.get(DOCUMENT_KEY_LOCAL))[DOCUMENT_KEY_LOCAL] as
    | EncryptedPayload
    | undefined;

  let rawKey: string;
  if (stored) {
    rawKey = await decryptWithPassphrase(stored, passphrase);
  } else {
    rawKey = generateDocumentKey();
    await chrome.storage.local.set({
      [DOCUMENT_KEY_LOCAL]: await encryptWithPassphrase(rawKey, passphrase),
    });
  }
  await chrome.storage.session.set({ [DOCUMENT_KEY_SESSION]: rawKey });
}

/** The raw document key, or null when the vault is locked. Never written to disk. */
export async function getDocumentKey(): Promise<string | null> {
  const result = await chrome.storage.session.get(DOCUMENT_KEY_SESSION);
  return (result[DOCUMENT_KEY_SESSION] as string | undefined) ?? null;
}

export async function hasVault(): Promise<boolean> {
  const result = await chrome.storage.local.get(LOCAL_KEY);
  return result[LOCAL_KEY] !== undefined;
}

export async function saveVaultSecrets(bundle: SecretBundle, passphrase: string): Promise<void> {
  const payload = await encryptWithPassphrase(JSON.stringify(bundle), passphrase);
  await chrome.storage.local.set({ [LOCAL_KEY]: payload });
  await chrome.storage.session.set({ [SESSION_KEY]: bundle });
  await unlockDocumentKey(passphrase);
}

/** Throws if the passphrase is wrong. On success, caches the decrypted bundle for this browser session. */
export async function unlockVault(passphrase: string): Promise<SecretBundle> {
  const result = await chrome.storage.local.get(LOCAL_KEY);
  const payload = result[LOCAL_KEY] as EncryptedPayload | undefined;
  if (!payload) throw new Error('No vault saved yet.');
  const plaintext = await decryptWithPassphrase(payload, passphrase);
  const bundle = JSON.parse(plaintext) as SecretBundle;
  await chrome.storage.session.set({ [SESSION_KEY]: bundle });
  await unlockDocumentKey(passphrase);
  return bundle;
}

/** Reads the already-unlocked bundle from session storage. Null if locked (never unlocked, or browser restarted). */
export async function getUnlockedVault(): Promise<SecretBundle | null> {
  const result = await chrome.storage.session.get(SESSION_KEY);
  return (result[SESSION_KEY] as SecretBundle | undefined) ?? null;
}

export async function lockVault(): Promise<void> {
  await chrome.storage.session.remove([SESSION_KEY, DOCUMENT_KEY_SESSION]);
}
