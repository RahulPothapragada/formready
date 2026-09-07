/**
 * On-device storage for the working job.
 *
 * IndexedDB rather than localStorage because a job holds Blobs — the original
 * document, the prepared candidate, the instruction screenshot — and
 * localStorage only takes strings. IndexedDB stores them by structured clone,
 * so no encoding step is needed and nothing is copied through a data URL.
 *
 * Nothing here leaves the device. This is the same guarantee as the rest of the
 * app (NFR-04); persistence changes how long the bytes live locally, not where
 * they go.
 *
 * Every function fails soft. Storage can be unavailable in private browsing, or
 * full, or blocked by settings — none of which should stop someone preparing a
 * file. A failed save means the work is not saved, not that the app is broken.
 */

import { fromSnapshot, toSnapshot } from '../domain/jobSnapshot';
import type { Job } from '../domain/types';

const DB_NAME = 'formready';
const DB_VERSION = 1;
const STORE = 'jobs';
const CURRENT_KEY = 'current';

let database: IDBDatabase | null = null;

function open(): Promise<IDBDatabase> {
  if (database) return Promise.resolve(database);

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE);
      }
    };
    request.onsuccess = () => {
      database = request.result;
      resolve(database);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('Storage is blocked by another tab.'));
  });
}

function run<T>(
  mode: IDBTransactionMode,
  action: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const transaction = db.transaction(STORE, mode);
        const request = action(transaction.objectStore(STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        transaction.onabort = () => reject(transaction.error);
      }),
  );
}

export function isSupported(): boolean {
  return typeof indexedDB !== 'undefined';
}

export interface SaveOutcome {
  saved: boolean;
  /** Set when saving failed, for the indicator to explain itself. */
  reason?: string;
}

export async function saveJob(job: Job, savedAt: number): Promise<SaveOutcome> {
  if (!isSupported()) return { saved: false, reason: 'This browser cannot save work locally.' };

  try {
    await run('readwrite', (store) => store.put(toSnapshot(job, savedAt), CURRENT_KEY));
    return { saved: true };
  } catch (error) {
    // Quota is the likely cause on a phone holding a large original.
    const quotaExceeded = error instanceof DOMException && error.name === 'QuotaExceededError';
    return {
      saved: false,
      reason: quotaExceeded
        ? 'There is not enough space on this device to save your work.'
        : 'Your work could not be saved on this device.',
    };
  }
}

/** Returns `null` when there is nothing to restore, for any reason. */
export async function loadJob(): Promise<Job | null> {
  if (!isSupported()) return null;
  try {
    return fromSnapshot(await run('readonly', (store) => store.get(CURRENT_KEY)));
  } catch {
    return null;
  }
}

export async function clearJob(): Promise<void> {
  if (!isSupported()) return;
  try {
    await run('readwrite', (store) => store.delete(CURRENT_KEY));
  } catch {
    // Nothing useful to do: the caller is discarding the job either way.
  }
}
