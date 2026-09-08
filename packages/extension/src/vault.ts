/**
 * The document vault: photos and signatures saved once, reused for every
 * form.
 *
 * These are the most sensitive thing FormReady holds. An Aadhaar *photo* is
 * worse to lose than an Aadhaar *number* — it carries the number, a face,
 * and a forgeable document image in one file. So documents get the same
 * treatment as the PII text: AES-256-GCM at rest under the vault's document
 * key (profile.ts), with the decrypted bytes never written back to disk.
 *
 * Each document is encrypted separately rather than as one array, so saving
 * a new one never rewrites the others, and reading one never decrypts the
 * rest. Only `id` stays in the clear — enough to address a record, and it
 * carries nothing about the person. The label is inside the ciphertext,
 * because "Ravi's Aadhaar" is itself a disclosure.
 *
 * Privileged module: background.ts and popup.ts only. The content script
 * asks the background for documents by message and never holds the key.
 */

import { decryptWithKey, encryptWithKey, type EncryptedPayload } from './crypto';
import { getDocumentKey } from './profile';

export interface VaultItem {
  id: string;
  label: string;
  /** 'photo' | 'signature' | 'other' — used to match the right instructions. */
  kind: 'photo' | 'signature' | 'other';
  dataUrl: string;
  savedAt: number;
}

/** What the content script is allowed to see: everything except the bytes. */
export type VaultItemMeta = Omit<VaultItem, 'dataUrl'>;

interface EncryptedRecord {
  id: string;
  payload: EncryptedPayload;
}

/** Records written by the pre-encryption build, still plaintext on disk. */
type StoredRecord = EncryptedRecord | VaultItem;

const STORAGE_KEY = 'formready_vault';

export class VaultLockedError extends Error {
  constructor() {
    super('Vault is locked. Open the FormReady Autopilot icon to unlock it.');
    this.name = 'VaultLockedError';
  }
}

function isEncrypted(record: StoredRecord): record is EncryptedRecord {
  return (record as EncryptedRecord).payload !== undefined;
}

async function readRecords(): Promise<StoredRecord[]> {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  return (result[STORAGE_KEY] as StoredRecord[] | undefined) ?? [];
}

async function requireKey(): Promise<string> {
  const key = await getDocumentKey();
  if (!key) throw new VaultLockedError();
  return key;
}

/**
 * Documents saved by the pre-encryption build sit on disk in the clear.
 * They are encrypted in place at the first unlock rather than deleted —
 * silently destroying someone's saved Aadhaar photo to improve their
 * security is not an improvement they asked for.
 */
async function migratePlaintext(records: StoredRecord[], key: string): Promise<EncryptedRecord[]> {
  if (records.every(isEncrypted)) return records;

  const migrated: EncryptedRecord[] = [];
  for (const record of records) {
    migrated.push(
      isEncrypted(record) ? record : { id: record.id, payload: await encryptWithKey(JSON.stringify(record), key) },
    );
  }
  await chrome.storage.local.set({ [STORAGE_KEY]: migrated });
  return migrated;
}

async function readDecrypted(): Promise<VaultItem[]> {
  const key = await requireKey();
  const records = await migratePlaintext(await readRecords(), key);
  const items: VaultItem[] = [];
  for (const record of records) {
    items.push(JSON.parse(await decryptWithKey(record.payload, key)) as VaultItem);
  }
  return items;
}

/** Throws VaultLockedError when locked. Returns metadata only — never the bytes. */
export async function listVaultItems(): Promise<VaultItemMeta[]> {
  return (await readDecrypted()).map(({ dataUrl: _dataUrl, ...meta }) => meta);
}

/** The bytes for one document, fetched only once the user has chosen it. */
export async function readVaultDocument(id: string): Promise<string> {
  const key = await requireKey();
  const records = await migratePlaintext(await readRecords(), key);
  const record = records.find((entry) => entry.id === id);
  if (!record) throw new Error(`No saved document with id ${id}.`);
  return (JSON.parse(await decryptWithKey(record.payload, key)) as VaultItem).dataUrl;
}

export async function saveVaultItem(item: Omit<VaultItem, 'id' | 'savedAt'>): Promise<VaultItemMeta> {
  const key = await requireKey();
  const records = await migratePlaintext(await readRecords(), key);
  const full: VaultItem = {
    ...item,
    id: `vault-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    savedAt: Date.now(),
  };
  const payload = await encryptWithKey(JSON.stringify(full), key);
  await chrome.storage.local.set({ [STORAGE_KEY]: [...records, { id: full.id, payload }] });
  const { dataUrl: _dataUrl, ...meta } = full;
  return meta;
}

export async function deleteVaultItem(id: string): Promise<void> {
  const records = await readRecords();
  await chrome.storage.local.set({ [STORAGE_KEY]: records.filter((record) => record.id !== id) });
}

/** True when documents are saved but unreadable because the vault is locked. */
export async function hasLockedDocuments(): Promise<boolean> {
  return (await readRecords()).length > 0 && (await getDocumentKey()) === null;
}
