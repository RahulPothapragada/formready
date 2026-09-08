import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Resolve fixtures from this file, not the working directory, so the
// suite does not depend on where the runner was started.
const here = dirname(fileURLToPath(import.meta.url));

// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';

// jsdom's environment doesn't implement CSS.escape; our test ids need no escaping.
beforeAll(() => {
  if (typeof CSS === 'undefined' || !CSS.escape) {
    (globalThis as { CSS: { escape: (s: string) => string } }).CSS = { escape: (s: string) => s };
  }
});
import { classifyField, extractFieldSignals } from '../src/fieldClassifier';
import { fieldRequiresPdfConversion } from '../src/formatConvertRule';
import { fillSelectByBestMatch } from '../src/reactSafeFill';
import type { ProfileFieldKey } from '../src/profile';

/**
 * Runs the real classifier and PDF-conversion rule against a mock form
 * authored independently of fieldClassifier.test.ts's fixtures — the
 * closest thing to an end-to-end proof this sandbox can run, since loading
 * the actual unpacked extension in a live browser is blocked here (see
 * extension/README.md). This is what caught the dimension-range bug in the
 * main app earlier: real markup exercises code paths hand-picked unit
 * tests don't.
 */
function loadForm(): Document {
  const html = readFileSync(resolve(here, '../demo-portals/full-application-form.html'), 'utf-8');
  document.documentElement.innerHTML = html;
  return document;
}

describe('full application form — field classification', () => {
  const expected: Record<string, ProfileFieldKey> = {
    'applicant-name': 'fullName',
    'father-name': 'fatherName',
    dob: 'dob',
    phone: 'phone',
    email: 'email',
    aadhaar: 'aadhaar',
    pan: 'pan',
    address1: 'addressLine1',
    address2: 'addressLine2',
    city: 'city',
    district: 'district',
    state: 'state',
    pincode: 'pincode',
  };

  it('classifies every PII field on the real mock form correctly', () => {
    const document = loadForm();
    for (const [id, key] of Object.entries(expected)) {
      const element = document.getElementById(id) as HTMLInputElement | HTMLSelectElement;
      expect(element, `#${id} should exist on the mock form`).toBeTruthy();
      const signals = extractFieldSignals(element);
      const result = classifyField(signals);
      expect(result.fieldKey, `#${id} ("${signals.label || signals.name}")`).toBe(key);
    }
  });

  it('resolves the state dropdown by option text, not by profile value', () => {
    const document = loadForm();
    const select = document.getElementById('state') as HTMLSelectElement;
    expect(fillSelectByBestMatch(select, 'Karnataka')).toBe(true);
    expect(select.value).toBe('KA');
  });
});

describe('full application form — PDF conversion rule', () => {
  it('identifies the marksheet field as PDF-only and the photo field as not', () => {
    const document = loadForm();
    const photo = document.getElementById('photo') as HTMLInputElement;
    const marksheet = document.getElementById('marksheet') as HTMLInputElement;

    expect(fieldRequiresPdfConversion(photo.getAttribute('accept') ?? '')).toBe(false);
    expect(fieldRequiresPdfConversion(marksheet.getAttribute('accept') ?? '')).toBe(true);
  });
});
