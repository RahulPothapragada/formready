import { describe, expect, it } from 'vitest';
import { withExifOrientation } from '../src/features/feasibility/probes';

/**
 * The orientation probe is only meaningful if the test image it builds really
 * carries the EXIF tag it claims to. These tests check the bytes directly, so a
 * malformed segment fails here rather than silently turning the probe into one
 * that always reports "orientation not applied".
 */

const SOI = [0xff, 0xd8];
const EOI = [0xff, 0xd9];

/** A JPEG-shaped byte string: SOI, an optional APP0, a quantisation table, EOI. */
function fakeJpeg({ withApp0 }: { withApp0: boolean }): Uint8Array {
  const app0 = withApp0
    ? [0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 1, 1, 0, 0, 1, 0, 1, 0, 0]
    : [];
  return new Uint8Array([...SOI, ...app0, 0xff, 0xdb, 0x00, 0x04, 0x00, 0x00, ...EOI]);
}

function findApp1(bytes: Uint8Array): number {
  for (let i = 0; i < bytes.length - 1; i += 1) {
    if (bytes[i] === 0xff && bytes[i + 1] === 0xe1) return i;
  }
  return -1;
}

describe('EXIF segment construction', () => {
  it('writes a well-formed APP1 segment', () => {
    const out = withExifOrientation(fakeJpeg({ withApp0: false }), 6);
    const at = findApp1(out);
    expect(at).toBeGreaterThan(-1);

    // Declared length must cover the payload plus the two length bytes.
    const declared = (out[at + 2] << 8) | out[at + 3];
    expect(declared).toBe(34);

    const identifier = new TextDecoder().decode(out.subarray(at + 4, at + 10));
    expect(identifier).toBe('Exif\0\0');
  });

  it('writes a big-endian TIFF header and one orientation entry', () => {
    const out = withExifOrientation(fakeJpeg({ withApp0: false }), 6);
    const tiff = out.subarray(findApp1(out) + 10);
    const view = new DataView(tiff.buffer, tiff.byteOffset, 26);

    expect(view.getUint16(0)).toBe(0x4d4d); // "MM"
    expect(view.getUint16(2)).toBe(0x002a); // TIFF magic
    expect(view.getUint32(4)).toBe(8); // IFD0 offset
    expect(view.getUint16(8)).toBe(1); // entry count
    expect(view.getUint16(10)).toBe(0x0112); // Orientation tag
    expect(view.getUint16(12)).toBe(3); // SHORT
    expect(view.getUint32(14)).toBe(1); // count
    expect(view.getUint16(18)).toBe(6); // the value we asked for
    expect(view.getUint32(22)).toBe(0); // no next IFD
  });

  it('round-trips whichever orientation is requested', () => {
    for (const orientation of [1, 3, 6, 8]) {
      const out = withExifOrientation(fakeJpeg({ withApp0: false }), orientation);
      const tiff = out.subarray(findApp1(out) + 10);
      const view = new DataView(tiff.buffer, tiff.byteOffset, 26);
      expect(view.getUint16(18)).toBe(orientation);
    }
  });
});

describe('placement', () => {
  it('inserts immediately after SOI when there is no APP0', () => {
    const out = withExifOrientation(fakeJpeg({ withApp0: false }), 6);
    expect(findApp1(out)).toBe(2);
  });

  it('inserts after an existing JFIF APP0 rather than splitting it', () => {
    const out = withExifOrientation(fakeJpeg({ withApp0: true }), 6);
    // APP0 declares length 0x0010, so it occupies bytes 2..19.
    expect(findApp1(out)).toBe(20);
    expect(out[2]).toBe(0xff);
    expect(out[3]).toBe(0xe0);
  });

  it('leaves the original bytes intact around the insertion', () => {
    const source = fakeJpeg({ withApp0: true });
    const out = withExifOrientation(source, 6);
    const at = findApp1(out);
    const segmentLength = 2 + ((out[at + 2] << 8) | out[at + 3]);

    expect(out.length).toBe(source.length + segmentLength);
    expect([...out.subarray(0, at)]).toEqual([...source.subarray(0, at)]);
    expect([...out.subarray(at + segmentLength)]).toEqual([...source.subarray(at)]);
  });
});

describe('input validation', () => {
  it('refuses anything that is not a JPEG', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(() => withExifOrientation(png, 6)).toThrow(/not a jpeg/i);
  });
});
