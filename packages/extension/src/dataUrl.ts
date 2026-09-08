/**
 * Data-URL conversions, in their own module because both privileged code
 * (the popup, which reads files the user picks) and the content script
 * (which attaches bytes to a page's file input) need them — and the content
 * script must not import `vault.ts`, which reaches for the decryption key.
 */

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
