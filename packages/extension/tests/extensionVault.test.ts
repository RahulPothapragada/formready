import { beforeEach, describe, expect, it } from 'vitest';

/**
 * The document vault holds the highest-value thing in this product: a photo
 * of someone's identity document. The promise attached to it is that it
 * stays on the device *and* stays unreadable to anything with disk access.
 *
 * The load-bearing test here is the one that scans everything written to
 * chrome.storage.local for the plaintext bytes. Encryption that is applied
 * on one code path and skipped on another still passes a round-trip test;
 * it does not pass this one.
 */

interface Area {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
}

function area(store: Map<string, unknown>): Area {
  return {
    get: async (key) => (store.has(key) ? { [key]: store.get(key) } : {}),
    set: async (items) => {
      for (const [key, value] of Object.entries(items)) store.set(key, value);
    },
    remove: async (keys) => {
      for (const key of Array.isArray(keys) ? keys : [keys]) store.delete(key);
    },
  };
}

const local = new Map<string, unknown>();
const session = new Map<string, unknown>();

(globalThis as unknown as { chrome: unknown }).chrome = {
  storage: { local: area(local), session: area(session) },
};

const { lockVault, saveVaultSecrets, unlockVault } = await import('../src/profile');
const { deleteVaultItem, listVaultItems, readVaultDocument, saveVaultItem, VaultLockedError } = await import(
  '../src/vault'
);

const PASSPHRASE = 'correct horse battery staple';
// Stands in for image bytes: a string that cannot occur by chance.
const SECRET_BYTES = 'data:image/png;base64,QUFEQUFSX1BIT1RPX1NFQ1JFVF9CWVRFUw==';

const diskContents = () => JSON.stringify([...local.entries()]);

beforeEach(async () => {
  local.clear();
  session.clear();
  await saveVaultSecrets({ profile: {} }, PASSPHRASE);
});

describe('the document vault', () => {
  it('round-trips a document through encryption at rest', async () => {
    const meta = await saveVaultItem({ label: 'Aadhaar front', kind: 'photo', dataUrl: SECRET_BYTES });
    expect(await readVaultDocument(meta.id)).toBe(SECRET_BYTES);
    expect(await listVaultItems()).toEqual([
      expect.objectContaining({ label: 'Aadhaar front', kind: 'photo' }),
    ]);
  });

  it('never writes the document bytes or its label to disk in the clear', async () => {
    await saveVaultItem({ label: 'Ravi Aadhaar', kind: 'photo', dataUrl: SECRET_BYTES });
    const disk = diskContents();
    expect(disk).not.toContain(SECRET_BYTES);
    expect(disk).not.toContain('QUFEQUFSX1BIT1RP');
    // The label is a disclosure in itself, so it is inside the ciphertext too.
    expect(disk).not.toContain('Ravi Aadhaar');
  });

  it('keeps the listing free of document bytes', async () => {
    await saveVaultItem({ label: 'Signature', kind: 'signature', dataUrl: SECRET_BYTES });
    const listed = await listVaultItems();
    expect(JSON.stringify(listed)).not.toContain(SECRET_BYTES);
    expect(listed[0]).not.toHaveProperty('dataUrl');
  });

  it('refuses to read documents once the vault is locked', async () => {
    const meta = await saveVaultItem({ label: 'Aadhaar front', kind: 'photo', dataUrl: SECRET_BYTES });
    await lockVault();

    await expect(listVaultItems()).rejects.toThrow(VaultLockedError);
    await expect(readVaultDocument(meta.id)).rejects.toThrow(VaultLockedError);
    await expect(saveVaultItem({ label: 'x', kind: 'other', dataUrl: SECRET_BYTES })).rejects.toThrow(
      VaultLockedError,
    );
  });

  it('reads documents again after unlocking with the right passphrase, and never with the wrong one', async () => {
    const meta = await saveVaultItem({ label: 'Aadhaar front', kind: 'photo', dataUrl: SECRET_BYTES });
    await lockVault();

    await expect(unlockVault('wrong-passphrase')).rejects.toThrow();
    await expect(readVaultDocument(meta.id)).rejects.toThrow(VaultLockedError);

    await unlockVault(PASSPHRASE);
    expect(await readVaultDocument(meta.id)).toBe(SECRET_BYTES);
  });

  it('encrypts documents left in the clear by the previous build instead of discarding them', async () => {
    // Exactly the shape the pre-encryption vault wrote.
    local.set('formready_vault', [
      { id: 'vault-legacy', label: 'Old photo', kind: 'photo', dataUrl: SECRET_BYTES, savedAt: 1 },
    ]);

    expect(diskContents()).toContain(SECRET_BYTES);

    const listed = await listVaultItems();
    expect(listed).toEqual([expect.objectContaining({ id: 'vault-legacy', label: 'Old photo' })]);
    expect(await readVaultDocument('vault-legacy')).toBe(SECRET_BYTES);
    expect(diskContents()).not.toContain(SECRET_BYTES);
  });

  it('deletes a document without needing the key, and stops serving it', async () => {
    const meta = await saveVaultItem({ label: 'Aadhaar front', kind: 'photo', dataUrl: SECRET_BYTES });
    await deleteVaultItem(meta.id);
    expect(await listVaultItems()).toEqual([]);
    await expect(readVaultDocument(meta.id)).rejects.toThrow(/No saved document/);
  });

  it('gives each document its own IV, so identical documents do not look identical on disk', async () => {
    await saveVaultItem({ label: 'A', kind: 'photo', dataUrl: SECRET_BYTES });
    await saveVaultItem({ label: 'B', kind: 'photo', dataUrl: SECRET_BYTES });
    const records = local.get('formready_vault') as Array<{ payload: { iv: string; ciphertext: string } }>;
    expect(records[0].payload.iv).not.toBe(records[1].payload.iv);
    expect(records[0].payload.ciphertext).not.toBe(records[1].payload.ciphertext);
  });
});
