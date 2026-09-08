/**
 * EXIF orientation, written rather than read.
 *
 * Pure byte manipulation with no imaging API involved, which is why it lives
 * in the engine: the feasibility harness uses it to build a test image whose
 * orientation is known, and any platform can do the same.
 */

/**
 * Splices a minimal EXIF APP1 segment carrying an Orientation tag into a JPEG.
 *
 * Written by hand rather than pulled from a fixture so the test image is
 * generated on the device under test, and so this stays verifiable in Node:
 * it is pure byte manipulation with no canvas involved.
 *
 * Layout: APP1 marker, length, "Exif\0\0", then a big-endian TIFF block holding
 * exactly one IFD entry — tag 0x0112 (Orientation), type 3 (SHORT), count 1.
 */
export function withExifOrientation(jpeg: Uint8Array, orientation: number): Uint8Array {
  if (jpeg[0] !== 0xff || jpeg[1] !== 0xd8) {
    throw new Error('Not a JPEG: missing start-of-image marker.');
  }

  // Insert after any leading JFIF APP0 segment, which is where an encoder that
  // wrote EXIF itself would have put it.
  let insertAt = 2;
  if (jpeg[2] === 0xff && jpeg[3] === 0xe0) {
    insertAt = 4 + ((jpeg[4] << 8) | jpeg[5]);
  }

  const tiff = new Uint8Array(26);
  const view = new DataView(tiff.buffer);
  view.setUint16(0, 0x4d4d); // "MM" — big-endian byte order
  view.setUint16(2, 0x002a); // TIFF magic
  view.setUint32(4, 0x00000008); // offset to IFD0
  view.setUint16(8, 1); // one directory entry
  view.setUint16(10, 0x0112); // Orientation
  view.setUint16(12, 3); // SHORT
  view.setUint32(14, 1); // count
  view.setUint16(18, orientation); // value, left-aligned in the 4-byte field
  view.setUint32(22, 0); // no next IFD

  // 'Exif\0\0' as bytes. Written literally rather than via TextEncoder, which
  // is a platform global the engine must not depend on.
  const header = new Uint8Array([0x45, 0x78, 0x69, 0x66, 0x00, 0x00]);
  const payloadLength = header.length + tiff.length + 2; // + the length field
  const segment = new Uint8Array(2 + payloadLength);
  segment[0] = 0xff;
  segment[1] = 0xe1;
  segment[2] = (payloadLength >> 8) & 0xff;
  segment[3] = payloadLength & 0xff;
  segment.set(header, 4);
  segment.set(tiff, 4 + header.length);

  const out = new Uint8Array(jpeg.length + segment.length);
  out.set(jpeg.subarray(0, insertAt), 0);
  out.set(segment, insertAt);
  out.set(jpeg.subarray(insertAt), insertAt + segment.length);
  return out;
}
