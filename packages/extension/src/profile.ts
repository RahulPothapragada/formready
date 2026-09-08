/**
 * The PII profile and API key, encrypted together under one passphrase.
 * Encrypted-at-rest copy lives in chrome.storage.local (disk, survives
 * restarts). The decrypted copy lives only in chrome.storage.session
 * (RAM, cleared when the browser closes) after unlockVault() — nothing
 * decrypted ever touches disk, and content.ts never sees this module at
 * all; only background.ts and popup.ts import it.
 */

import { decryptWithPassphrase, encryptWithPassphrase, type EncryptedPayload } from './crypto';

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
  apiKey?: string;
}

const LOCAL_KEY = 'formready_vault_encrypted';
const SESSION_KEY = 'formready_vault_decrypted';

export async function hasVault(): Promise<boolean> {
  const result = await chrome.storage.local.get(LOCAL_KEY);
  return result[LOCAL_KEY] !== undefined;
}

export async function saveVaultSecrets(bundle: SecretBundle, passphrase: string): Promise<void> {
  const payload = await encryptWithPassphrase(JSON.stringify(bundle), passphrase);
  await chrome.storage.local.set({ [LOCAL_KEY]: payload });
  await chrome.storage.session.set({ [SESSION_KEY]: bundle });
}

/** Throws if the passphrase is wrong. On success, caches the decrypted bundle for this browser session. */
export async function unlockVault(passphrase: string): Promise<SecretBundle> {
  const result = await chrome.storage.local.get(LOCAL_KEY);
  const payload = result[LOCAL_KEY] as EncryptedPayload | undefined;
  if (!payload) throw new Error('No vault saved yet.');
  const plaintext = await decryptWithPassphrase(payload, passphrase);
  const bundle = JSON.parse(plaintext) as SecretBundle;
  await chrome.storage.session.set({ [SESSION_KEY]: bundle });
  return bundle;
}

/** Reads the already-unlocked bundle from session storage. Null if locked (never unlocked, or browser restarted). */
export async function getUnlockedVault(): Promise<SecretBundle | null> {
  const result = await chrome.storage.session.get(SESSION_KEY);
  return (result[SESSION_KEY] as SecretBundle | undefined) ?? null;
}

export async function lockVault(): Promise<void> {
  await chrome.storage.session.remove(SESSION_KEY);
}
