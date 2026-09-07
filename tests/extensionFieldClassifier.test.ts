import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import {
  CONFIDENCE_THRESHOLD,
  classifyField,
  extractFieldSignals,
  type FieldSignals,
} from '../extension/src/fieldClassifier';

function signals(overrides: Partial<FieldSignals>): FieldSignals {
  return { label: '', name: '', id: '', placeholder: '', autocomplete: '', nearbyText: '', ...overrides };
}

describe('classifyField — keyword rules', () => {
  it("distinguishes the applicant's name from the father's name", () => {
    expect(classifyField(signals({ label: "Father's Name" })).fieldKey).toBe('fatherName');
    expect(classifyField(signals({ label: 'Full Name' })).fieldKey).toBe('fullName');
  });

  it('does not mistake "japan" or other embedded substrings for PAN', () => {
    expect(classifyField(signals({ label: 'Country', placeholder: 'e.g. Japan' })).fieldKey).toBeNull();
  });

  it('reads Aadhaar despite common spelling variants', () => {
    expect(classifyField(signals({ label: 'Aadhar Number' })).fieldKey).toBe('aadhaar');
    expect(classifyField(signals({ label: 'Aadhaar Card' })).fieldKey).toBe('aadhaar');
  });

  it('prefers address line 2 over the generic address pattern when both could match', () => {
    expect(classifyField(signals({ label: 'Address Line 2' })).fieldKey).toBe('addressLine2');
  });

  it('returns null with zero confidence for unrecognized fields', () => {
    const result = classifyField(signals({ label: 'Favourite colour' }));
    expect(result.fieldKey).toBeNull();
    expect(result.confidence).toBe(0);
  });

  it('weights nearby-text matches lower than the field-owned signals', () => {
    const ownField = classifyField(signals({ label: 'Aadhaar Number' }));
    const fromNeighbour = classifyField(signals({ nearbyText: 'Aadhaar Number' }));
    expect(fromNeighbour.confidence).toBeLessThan(ownField.confidence);
  });
});

describe('classifyField — autocomplete precedence', () => {
  it('trusts the standardized autocomplete token over a misleading label', () => {
    const result = classifyField(signals({ autocomplete: 'email', label: 'Username' }));
    expect(result.fieldKey).toBe('email');
    expect(result.confidence).toBeGreaterThanOrEqual(CONFIDENCE_THRESHOLD);
  });

  it('maps address-level1/2 autocomplete tokens to state/city', () => {
    expect(classifyField(signals({ autocomplete: 'address-level1' })).fieldKey).toBe('state');
    expect(classifyField(signals({ autocomplete: 'address-level2' })).fieldKey).toBe('city');
  });
});

describe('extractFieldSignals — real DOM', () => {
  it('reads label, name, id, placeholder, autocomplete, and nearby text from a real form field', () => {
    const dom = new JSDOM(`
      <form>
        <div class="field">
          <label for="aadhaar-input">Aadhaar Number</label>
          <input id="aadhaar-input" name="aadhaar" placeholder="12-digit number" autocomplete="off" />
        </div>
      </form>
    `);
    (globalThis as { document?: Document }).document = dom.window.document;
    (globalThis as { CSS?: typeof CSS }).CSS = dom.window.CSS ?? { escape: (s: string) => s };

    const input = dom.window.document.getElementById('aadhaar-input') as HTMLInputElement;
    const extracted = extractFieldSignals(input);

    expect(extracted.label).toBe('Aadhaar Number');
    expect(extracted.name).toBe('aadhaar');
    expect(extracted.placeholder).toBe('12-digit number');
    expect(extracted.nearbyText).toContain('Aadhaar Number');

    const classified = classifyField(extracted);
    expect(classified.fieldKey).toBe('aadhaar');
  });
});
