/**
 * The browser's half of the platform seam.
 *
 * The engine decides what a compliant file looks like; this package produces
 * one, using the canvas and the decoder. Both browser surfaces — the PWA and
 * the extension — share it, which is why it is a package rather than a folder
 * inside either of them.
 *
 * An Android adapter replaces exactly this surface and nothing else.
 */
export {
  EXTENSION_BY_FORMAT,
  MAX_INPUT_BYTES,
  MAX_INPUT_PIXELS,
  UnsupportedImageError,
  asBlob,
  decode,
  encode,
  fitWithinAspect,
  orientedSize,
  readFormat,
  render,
  sniffFormat,
} from './imaging';
export type { RenderRequest } from './imaging';

export { matchesVerifiedCandidate, measure, stillMatchesReport, verify } from './verifier';
