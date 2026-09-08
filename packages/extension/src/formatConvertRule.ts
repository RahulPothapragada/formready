/**
 * Split out from formatConvert.ts on purpose: this file must stay free of
 * the pdf-lib import so content.ts (injected into every page matching
 * <all_urls>) doesn't pull a ~1MB PDF library into its bundle just to ask
 * "does this field want PDF?". The actual conversion runs in the
 * background service worker instead — see formatConvert.ts.
 */

export function fieldRequiresPdfConversion(acceptAttr: string): boolean {
  const accept = acceptAttr.toLowerCase();
  if (!accept) return false;
  const acceptsPdf = accept.includes('pdf');
  const acceptsImage = accept.includes('image') || accept.includes('.jpg') || accept.includes('.jpeg') || accept.includes('.png');
  return acceptsPdf && !acceptsImage;
}
