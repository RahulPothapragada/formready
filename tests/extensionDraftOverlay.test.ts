import { describe, expect, it } from 'vitest';
import { isSensitiveKey, maskValue } from '../extension/src/draftOverlay';

describe('maskValue', () => {
  it('shows only the last 4 digits of an Aadhaar number', () => {
    expect(maskValue('aadhaar', '1234 5678 9012')).toBe('•••• •••• 9012');
  });

  it('shows only the first two and last two characters of a PAN', () => {
    expect(maskValue('pan', 'ABCDE1234F')).toBe('AB••••4F');
  });

  it('does not mask non-sensitive fields', () => {
    expect(maskValue('city', 'Bengaluru')).toBe('Bengaluru');
    expect(maskValue(null, 'anything')).toBe('anything');
  });
});

describe('isSensitiveKey', () => {
  it('flags aadhaar and pan as sensitive', () => {
    expect(isSensitiveKey('aadhaar')).toBe(true);
    expect(isSensitiveKey('pan')).toBe(true);
  });

  it('does not flag ordinary fields as sensitive', () => {
    expect(isSensitiveKey('city')).toBe(false);
    expect(isSensitiveKey(null)).toBe(false);
  });
});
