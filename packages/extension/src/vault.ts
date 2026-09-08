/**
 * The document vault: photos and signatures saved once, reused for every
 * form. Lives in chrome.storage.local, which is per-profile and never
 * touches a server — that's the whole point of doing this in an extension
 * instead of a web upload.
 */

export interface VaultItem {
  id: string;
  label: string;
  /** 'photo' | 'signature' | 'other' — used to match the right instructions. */
  kind: 'photo' | 'signature' | 'other';
  dataUrl: string;
  savedAt: number;
}

const STORAGE_KEY = 'formready_vault';

export async function listVaultItems(): Promise<VaultItem[]> {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  return (result[STORAGE_KEY] as VaultItem[] | undefined) ?? [];
}

export async function saveVaultItem(item: Omit<VaultItem, 'id' | 'savedAt'>): Promise<VaultItem> {
  const items = await listVaultItems();
  const full: VaultItem = { ...item, id: `vault-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, savedAt: Date.now() };
  await chrome.storage.local.set({ [STORAGE_KEY]: [...items, full] });
  return full;
}

export async function deleteVaultItem(id: string): Promise<void> {
  const items = await listVaultItems();
  await chrome.storage.local.set({ [STORAGE_KEY]: items.filter((item) => item.id !== id) });
}

export async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const response = await fetch(dataUrl);
  return response.blob();
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
