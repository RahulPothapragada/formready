/**
 * Maps a form field's DOM signals to one of the PII profile keys, the same
 * "read real signals, don't guess" spirit as the web app's extractRules.ts.
 *
 * Confidence matters more than coverage here: a field scored below
 * CONFIDENCE_THRESHOLD is left for the vision fallback (or left unfilled)
 * rather than silently guessed — filling the wrong value into a government
 * form is worse than not filling it.
 */

import type { ProfileFieldKey } from './profile';

export interface FieldSignals {
  label: string;
  name: string;
  id: string;
  placeholder: string;
  autocomplete: string;
  nearbyText: string;
}

export interface ClassificationResult {
  fieldKey: ProfileFieldKey | null;
  confidence: number;
}

export const CONFIDENCE_THRESHOLD = 0.6;

/** HTML autocomplete tokens (the one standardized, highest-trust signal) mapped to our keys. */
const AUTOCOMPLETE_MAP: Record<string, { key: ProfileFieldKey; confidence: number }> = {
  name: { key: 'fullName', confidence: 0.95 },
  'given-name': { key: 'fullName', confidence: 0.7 },
  'honorific-prefix': { key: 'fullName', confidence: 0.5 },
  tel: { key: 'phone', confidence: 0.95 },
  'tel-national': { key: 'phone', confidence: 0.95 },
  email: { key: 'email', confidence: 0.95 },
  bday: { key: 'dob', confidence: 0.95 },
  'address-line1': { key: 'addressLine1', confidence: 0.95 },
  'address-line2': { key: 'addressLine2', confidence: 0.95 },
  'address-level2': { key: 'city', confidence: 0.9 },
  'address-level1': { key: 'state', confidence: 0.9 },
  'postal-code': { key: 'pincode', confidence: 0.95 },
};

/**
 * Keyword patterns, most specific first. Order inside the array matters:
 * "father's name" must be checked before the bare "name" pattern for
 * fullName, or every father-name field would be misread as the user's own.
 */
const KEYWORD_RULES: Array<{ key: ProfileFieldKey; pattern: RegExp; confidence: number }> = [
  { key: 'fatherName', pattern: /\b(father'?s?|guardian|husband'?s?)\s*name\b/i, confidence: 0.85 },
  { key: 'dob', pattern: /\b(date\s*of\s*birth|d\.?\s*o\.?\s*b\.?|birth\s*date)\b/i, confidence: 0.85 },
  { key: 'aadhaar', pattern: /\baadh?a?ar\b/i, confidence: 0.9 },
  { key: 'pan', pattern: /\bpan\b/i, confidence: 0.75 },
  { key: 'phone', pattern: /\b(phone|mobile|contact\s*number|cell)\b/i, confidence: 0.8 },
  { key: 'email', pattern: /\be-?mail\b/i, confidence: 0.85 },
  { key: 'addressLine2', pattern: /\baddress\s*(line\s*)?2\b|\bstreet\s*2\b/i, confidence: 0.85 },
  { key: 'addressLine1', pattern: /\baddress(\s*line\s*1|\s*1)?\b/i, confidence: 0.75 },
  { key: 'district', pattern: /\bdistrict\b/i, confidence: 0.85 },
  { key: 'city', pattern: /\bcity\b|\btown\b/i, confidence: 0.8 },
  { key: 'state', pattern: /\bstate\b|\bprovince\b/i, confidence: 0.75 },
  { key: 'pincode', pattern: /\b(pin\s*code|pincode|postal\s*code|zip\s*code|\bzip\b)\b/i, confidence: 0.85 },
  { key: 'fullName', pattern: /\b(full\s*name|your\s*name|applicant\s*name|candidate\s*name|^name$)\b/i, confidence: 0.75 },
];

export function classifyField(signals: FieldSignals): ClassificationResult {
  const autocompleteMatch = AUTOCOMPLETE_MAP[signals.autocomplete.trim().toLowerCase()];
  if (autocompleteMatch) {
    return { fieldKey: autocompleteMatch.key, confidence: autocompleteMatch.confidence };
  }

  // Nearby text is weighted lower than the field's own attributes — a
  // neighbouring field's label can leak into "nearby text" and shouldn't
  // outrank what the field itself says about itself.
  const primary = [signals.label, signals.name, signals.id, signals.placeholder].join(' ');
  const secondary = signals.nearbyText;

  for (const rule of KEYWORD_RULES) {
    if (rule.pattern.test(primary)) return { fieldKey: rule.key, confidence: rule.confidence };
  }
  for (const rule of KEYWORD_RULES) {
    if (rule.pattern.test(secondary)) return { fieldKey: rule.key, confidence: rule.confidence * 0.7 };
  }

  return { fieldKey: null, confidence: 0 };
}

/** Extracts signals from a real DOM field, using the same label/nearby-text conventions as content.ts's file-input scanner. */
export function extractFieldSignals(field: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement): FieldSignals {
  let label = '';
  if (field.id) {
    const labelEl = document.querySelector(`label[for="${CSS.escape(field.id)}"]`);
    if (labelEl?.textContent) label = labelEl.textContent;
  }
  const wrappingLabel = field.closest('label');
  if (!label && wrappingLabel?.textContent) label = wrappingLabel.textContent;

  const container =
    field.closest('.form-group, .field, .form-row, fieldset, li, td') ?? field.parentElement;
  const nearbyText = (container?.textContent ?? '').replace(/\s+/g, ' ').trim();

  return {
    label: label.replace(/\s+/g, ' ').trim(),
    name: field.getAttribute('name') ?? '',
    id: field.id ?? '',
    placeholder: field.getAttribute('placeholder') ?? '',
    autocomplete: field.getAttribute('autocomplete') ?? '',
    nearbyText,
  };
}
