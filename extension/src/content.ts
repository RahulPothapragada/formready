/**
 * FormReady Autopilot content script.
 *
 * Finds file inputs on the page, reads the instruction text sitting next to
 * them (real portals put this in plain DOM text, not a screenshot), and
 * offers to prepare a vault document against those rules and attach it
 * directly — reusing the exact same extraction, constraint, and encoding
 * pipeline as the FormReady web app, not a reimplementation of it.
 */

import { buildValidationReport, isUsableRule } from '../../src/domain/constraints';
import type { ConfirmedRequirements, DocumentKind, ImageFormat, Rule } from '../../src/domain/types';
import { extractRules } from '../../src/features/requirements/extractRules';
import { searchCandidates, type EncodeFn } from '../../src/features/preparation/generateCandidates';
import { decode, encode, readFormat, render } from '../../src/services/imageCodec';
import { dataUrlToBlob, listVaultItems, type VaultItem } from './vault';
import { fieldRequiresPdfConversion } from './formatConvertRule';
import type {
  ConvertToPdfMessage,
  ConvertToPdfResponse,
  ResolveProfileMessage,
  ResolveProfileResponse,
  VisionClassifyMessage,
  VisionClassifyResponse,
} from './background';
import { CONFIDENCE_THRESHOLD, classifyField, extractFieldSignals } from './fieldClassifier';
import type { VisionCandidate } from './visionFallback';
import { fillFieldSafely, fillSelectByBestMatch } from './reactSafeFill';
import { showDraftOverlay, type DraftRow } from './draftOverlay';
import type { Profile, ProfileFieldKey } from './profile';

/**
 * PDF conversion runs in the background service worker, not here: pdf-lib
 * is ~1MB, and this content script is injected into every page the
 * browser visits — that library has no business loading on pages that
 * never touch a PDF field.
 */
async function convertToPdfViaBackground(imageBlob: Blob, format: ImageFormat): Promise<Blob> {
  const message: ConvertToPdfMessage = { type: 'formready-convert-to-pdf', imageBlob, format };
  const response: ConvertToPdfResponse = await chrome.runtime.sendMessage(message);
  if (!response.ok) throw new Error(response.error);
  return response.pdfBlob;
}

const processed = new WeakSet<HTMLInputElement>();
const processedForms = new WeakSet<Element>();

interface FileMount {
  kind: DocumentKind;
  text: string;
  ui: Mounted;
}
const fileInputMounts = new Map<HTMLInputElement, FileMount>();

function isImageFileInput(input: HTMLInputElement): boolean {
  if (input.type !== 'file') return false;
  const accept = (input.getAttribute('accept') ?? '').toLowerCase();
  const acceptsImage = accept.includes('image') || accept.includes('.jpg') || accept.includes('.jpeg') || accept.includes('.png');
  const acceptsPdf = accept.includes('pdf');
  // A PDF-only field is still one we can serve: the vault holds an image,
  // and formatConvert.ts turns it into a single-page PDF automatically.
  if (accept && !acceptsImage && !acceptsPdf) return false;
  return true;
}

function collectNearbyText(input: HTMLInputElement): string {
  const explicit =
    input.getAttribute('data-formready-instructions') ??
    input.closest('[data-formready-instructions]')?.getAttribute('data-formready-instructions');
  if (explicit) return explicit;

  const parts: string[] = [];
  if (input.id) {
    const label = document.querySelector(`label[for="${CSS.escape(input.id)}"]`);
    if (label?.textContent) parts.push(label.textContent);
  }
  const wrappingLabel = input.closest('label');
  if (wrappingLabel?.textContent) parts.push(wrappingLabel.textContent);

  const container =
    input.closest('.form-group, .field, .form-row, fieldset, li') ?? input.parentElement;
  if (container?.textContent) parts.push(container.textContent);

  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

function guessKind(input: HTMLInputElement, text: string): DocumentKind {
  const haystack = `${text} ${input.name} ${input.id} ${input.getAttribute('accept') ?? ''}`.toLowerCase();
  if (/signature/.test(haystack)) return 'signature';
  if (/photo|photograph|picture/.test(haystack)) return 'photo';
  return 'other';
}

const STYLE = `
  :host { all: initial; }
  .fr-btn {
    font: 600 12px system-ui, sans-serif;
    padding: 6px 10px;
    border-radius: 999px;
    border: none;
    background: linear-gradient(135deg, #1d4ed8, #2563eb);
    color: white;
    cursor: pointer;
    box-shadow: 0 1px 3px rgba(0,0,0,0.25);
  }
  .fr-btn:disabled { opacity: 0.6; cursor: default; }
  .fr-panel {
    margin-top: 6px;
    max-width: 320px;
    font: 12px/1.4 system-ui, sans-serif;
    background: white;
    border: 1px solid #d8dee8;
    border-radius: 10px;
    padding: 10px 12px;
    box-shadow: 0 4px 14px rgba(0,0,0,0.12);
    color: #1a1a1a;
  }
  .fr-panel h4 { margin: 0 0 6px; font-size: 12px; }
  .fr-panel .fr-ok { color: #0a7c33; font-weight: 600; }
  .fr-panel .fr-fail { color: #b3261e; font-weight: 600; }
  .fr-panel ul { margin: 6px 0 0; padding-left: 16px; }
  .fr-panel li { margin-bottom: 2px; }
  .fr-pick {
    display: block;
    width: 100%;
    text-align: left;
    padding: 6px 8px;
    margin-bottom: 4px;
    border: 1px solid #d8dee8;
    border-radius: 6px;
    background: #f7f9fc;
    cursor: pointer;
    font: 12px system-ui, sans-serif;
  }
  .fr-pick:hover { background: #eef2ff; }
  .fr-note { color: #666; margin-top: 6px; }
`;

interface Mounted {
  panel: HTMLDivElement;
  button: HTMLButtonElement;
}

function mountUI(input: HTMLInputElement): Mounted {
  const host = document.createElement('span');
  host.style.display = 'inline-block';
  host.style.marginLeft = '8px';
  host.style.verticalAlign = 'middle';
  input.insertAdjacentElement('afterend', host);

  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = STYLE;
  shadow.appendChild(style);

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'fr-btn';
  button.textContent = '⚡ Prepare & Attach';
  shadow.appendChild(button);

  const panel = document.createElement('div');
  panel.className = 'fr-panel';
  panel.hidden = true;
  shadow.appendChild(panel);

  return { panel, button };
}

function renderPicker(panel: HTMLDivElement, items: VaultItem[], onPick: (item: VaultItem) => void) {
  panel.hidden = false;
  panel.innerHTML = '';
  const heading = document.createElement('h4');
  heading.textContent = 'Choose a saved document';
  panel.appendChild(heading);
  for (const item of items) {
    const pick = document.createElement('button');
    pick.className = 'fr-pick';
    pick.textContent = `${item.label} (${item.kind})`;
    pick.addEventListener('click', () => onPick(item));
    panel.appendChild(pick);
  }
}

function attachFileToInput(input: HTMLInputElement, blob: Blob, filename: string, mime: string) {
  const file = new File([blob], filename, { type: mime });
  const transfer = new DataTransfer();
  transfer.items.add(file);
  input.files = transfer.files;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

const encodeFactory = (bitmap: ImageBitmap): EncodeFn => async ({ width, height, format, quality }) => {
  const canvas = render({ bitmap, crop: null, rotation: 0, targetWidth: width, targetHeight: height });
  const blob = await encode(canvas, format, quality);
  return { blob, metadata: { format, byteLength: blob.size, width, height } };
};

async function runPipeline(
  input: HTMLInputElement,
  kind: DocumentKind,
  text: string,
  item: VaultItem,
  panel: HTMLDivElement,
  button: HTMLButtonElement,
) {
  panel.hidden = false;
  panel.innerHTML = '<h4>Reading requirements from this page…</h4>';

  const extraction = extractRules(text, { sourceId: 'dom-scrape', documentKind: kind });
  const confirmedRules: Rule[] = extraction.rules
    .filter(isUsableRule)
    .map((rule) => ({ ...rule, reviewState: 'confirmed' as const }));

  if (confirmedRules.length === 0) {
    const needsPdf = fieldRequiresPdfConversion(input.getAttribute('accept') ?? '');
    const baseName = item.label.replace(/\s+/g, '_');
    if (needsPdf) {
      const sourceBlob = await dataUrlToBlob(item.dataUrl);
      const sourceFormat = (await readFormat(sourceBlob)) ?? 'jpeg';
      const pdfBlob = await convertToPdfViaBackground(sourceBlob, sourceFormat);
      panel.innerHTML = `
        <h4 class="fr-fail">No explicit requirements found nearby</h4>
        <div class="fr-note">Found none it could parse confidently near this field. Converted "${item.label}" to PDF (this field only accepts PDF) and attached it unmodified otherwise.</div>
      `;
      attachFileToInput(input, pdfBlob, `${baseName}.pdf`, 'application/pdf');
    } else {
      panel.innerHTML = `
        <h4 class="fr-fail">No explicit requirements found nearby</h4>
        <div class="fr-note">FormReady looks for size, format, and pixel-dimension rules in the text next to this field and found none it could parse confidently. Attaching "${item.label}" as saved, unmodified.</div>
      `;
      attachFileToInput(input, await dataUrlToBlob(item.dataUrl), baseName, 'image/jpeg');
    }
    button.disabled = false;
    return;
  }

  const requirements: ConfirmedRequirements = {
    rules: confirmedRules,
    byteConvention: 'decimal',
    manualChecks: extraction.manualChecks,
    documentKind: kind,
    confirmedAt: Date.now(),
  };

  try {
    const sourceBlob = await dataUrlToBlob(item.dataUrl);
    const bitmap = await decode(sourceBlob);
    panel.innerHTML = '<h4>Preparing a compliant file…</h4>';

    const outcome = await searchCandidates({
      sourceWidth: bitmap.width,
      sourceHeight: bitmap.height,
      requirements,
      encode: encodeFactory(bitmap),
    });

    if (!outcome.ok) {
      panel.innerHTML = `
        <h4 class="fr-fail">Couldn't find a compliant version</h4>
        <div>${outcome.failure.message}</div>
        <div class="fr-note">Tried ${outcome.attempts} encodings. Save a higher-resolution source in the vault, or check the requirements above by hand.</div>
      `;
      button.disabled = false;
      return;
    }

    const { blob, metadata } = outcome.result;
    const baseName = item.label.replace(/\s+/g, '_');
    const needsPdf = fieldRequiresPdfConversion(input.getAttribute('accept') ?? '');

    const report = buildValidationReport(
      { id: 'autopilot', blob, sourceId: 'autopilot', jobRevision: 0, metadata, attempts: outcome.attempts },
      requirements,
      Date.now(),
    );
    const rows = report.results
      .map((result) => `<li>${result.field}: ${result.expected} — measured ${result.actual} (${result.outcome})</li>`)
      .join('');

    if (needsPdf) {
      const pdfBlob = await convertToPdfViaBackground(blob, metadata.format);
      attachFileToInput(input, pdfBlob, `${baseName}.pdf`, 'application/pdf');
      panel.innerHTML = `
        <h4 class="fr-ok">Attached ✓ converted to PDF (${metadata.width}×${metadata.height} source, ${(metadata.byteLength / 1024).toFixed(1)} KB before conversion)</h4>
        <ul>${rows}</ul>
        <div class="fr-note">This field only accepts PDF — the prepared image was embedded as a single-page PDF. ${outcome.attempts} encode attempts, entirely on this device.</div>
      `;
    } else {
      const ext = metadata.format === 'jpeg' ? 'jpg' : 'png';
      attachFileToInput(input, blob, `${baseName}.${ext}`, `image/${metadata.format}`);
      panel.innerHTML = `
        <h4 class="fr-ok">Attached ✓ ${metadata.width}×${metadata.height}, ${(metadata.byteLength / 1024).toFixed(1)} KB, ${metadata.format.toUpperCase()}</h4>
        <ul>${rows}</ul>
        <div class="fr-note">${outcome.attempts} encode attempts, entirely on this device.</div>
      `;
    }
  } catch (error) {
    panel.innerHTML = `<h4 class="fr-fail">Something went wrong</h4><div>${error instanceof Error ? error.message : String(error)}</div>`;
  } finally {
    button.disabled = false;
  }
}

async function handleClick(input: HTMLInputElement, kind: DocumentKind, text: string, ui: Mounted) {
  ui.button.disabled = true;
  ui.panel.hidden = false;
  ui.panel.innerHTML = '<h4>Checking your vault…</h4>';

  const items = await listVaultItems();
  if (items.length === 0) {
    ui.panel.innerHTML = `
      <h4 class="fr-fail">Vault is empty</h4>
      <div>Open the FormReady Autopilot icon in the toolbar and save a photo or signature once — then this button works everywhere.</div>
    `;
    ui.button.disabled = false;
    return;
  }

  const preferred = items.filter((item) => item.kind === kind);
  const candidates = preferred.length > 0 ? preferred : items;

  if (candidates.length === 1) {
    await runPipeline(input, kind, text, candidates[0], ui.panel, ui.button);
    return;
  }

  renderPicker(ui.panel, candidates, (item) => {
    void runPipeline(input, kind, text, item, ui.panel, ui.button);
  });
  ui.button.disabled = false;
}

function scan(root: ParentNode) {
  const inputs = root.querySelectorAll<HTMLInputElement>('input[type="file"]');
  for (const input of inputs) {
    if (processed.has(input)) continue;
    if (!isImageFileInput(input)) continue;
    processed.add(input);

    const text = collectNearbyText(input);
    const kind = guessKind(input, text);
    const ui = mountUI(input);
    fileInputMounts.set(input, { kind, text, ui });
    ui.button.addEventListener('click', () => {
      void handleClick(input, kind, text, ui);
    });
  }

  scanForms(root);
}

// --- Whole-form scan, classify, draft-review, and fill ---

const FILLABLE_TEXT_SELECTOR =
  'input[type="text"], input[type="tel"], input[type="email"], input[type="date"], input:not([type]), textarea, select';

interface PlannedTextField {
  id: string;
  element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
  fieldLabel: string;
  profileKey: ProfileFieldKey;
}

interface PlannedFileField {
  id: string;
  input: HTMLInputElement;
}

function mountFormButton(form: Element): { button: HTMLButtonElement; status: HTMLDivElement } {
  const host = document.createElement('span');
  host.style.display = 'inline-block';
  host.style.margin = '6px 0';
  form.prepend(host);

  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  style.textContent = STYLE;
  shadow.appendChild(style);

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'fr-btn';
  button.textContent = '⚡ Fill this form';
  shadow.appendChild(button);

  const status = document.createElement('div');
  status.className = 'fr-panel';
  status.hidden = true;
  shadow.appendChild(status);

  return { button, status };
}

async function classifyFormFields(form: Element): Promise<PlannedTextField[]> {
  const fields = Array.from(form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(FILLABLE_TEXT_SELECTOR));
  const confident: PlannedTextField[] = [];
  const lowConfidence: Array<{ id: string; field: (typeof fields)[number]; domGuess: ProfileFieldKey | null; label: string }> = [];

  fields.forEach((field, index) => {
    const id = `field-${index}`;
    const signals = extractFieldSignals(field);
    const classification = classifyField(signals);
    const label = signals.label || signals.placeholder || signals.name || signals.id || '(unlabeled field)';
    if (classification.fieldKey && classification.confidence >= CONFIDENCE_THRESHOLD) {
      confident.push({ id, element: field, fieldLabel: label, profileKey: classification.fieldKey });
    } else {
      lowConfidence.push({ id, field, domGuess: classification.fieldKey, label });
    }
  });

  if (lowConfidence.length > 0) {
    try {
      const candidates: VisionCandidate[] = lowConfidence.map((entry) => ({
        fieldId: entry.id,
        domGuess: entry.domGuess,
        label: entry.label,
      }));
      const message: VisionClassifyMessage = { type: 'formready-vision-classify', candidates };
      const response: VisionClassifyResponse = await chrome.runtime.sendMessage(message);
      if (response.ok) {
        const byId = new Map(response.results.map((result) => [result.fieldId, result]));
        for (const entry of lowConfidence) {
          const result = byId.get(entry.id);
          if (result?.confirmedType && result.confidence >= CONFIDENCE_THRESHOLD) {
            confident.push({ id: entry.id, element: entry.field, fieldLabel: entry.label, profileKey: result.confirmedType });
          }
        }
      }
    } catch {
      // No API key, offline, or the call failed — those fields are simply left unfilled.
    }
  }

  return confident;
}

async function resolveProfileValues(keys: ProfileFieldKey[]): Promise<Profile> {
  const message: ResolveProfileMessage = { type: 'formready-resolve-profile-values', keys };
  const response: ResolveProfileResponse = await chrome.runtime.sendMessage(message);
  return response.ok ? response.values : {};
}

async function handleFillForm(form: Element, status: HTMLDivElement, button: HTMLButtonElement) {
  button.disabled = true;
  status.hidden = false;
  status.innerHTML = '<h4>Reading this form…</h4>';

  try {
    const plannedText = await classifyFormFields(form);
    const uniqueKeys = [...new Set(plannedText.map((field) => field.profileKey))];
    const values = await resolveProfileValues(uniqueKeys);

    const fileInputs = Array.from(form.querySelectorAll<HTMLInputElement>('input[type="file"]')).filter((input) =>
      fileInputMounts.has(input),
    );
    const vaultItems = fileInputs.length > 0 ? await listVaultItems() : [];

    const rows: DraftRow[] = [];
    const textFieldById = new Map<string, PlannedTextField>();
    for (const field of plannedText) {
      const value = values[field.profileKey];
      if (!value) continue;
      textFieldById.set(field.id, field);
      rows.push({
        id: field.id,
        fieldLabel: field.fieldLabel,
        kind: field.element instanceof HTMLSelectElement ? 'select' : 'text',
        profileKey: field.profileKey,
        previewValue: value,
        sensitive: field.profileKey === 'aadhaar' || field.profileKey === 'pan',
      });
    }

    const fileFieldById = new Map<string, PlannedFileField>();
    fileInputs.forEach((input, index) => {
      const mount = fileInputMounts.get(input);
      if (!mount) return;
      const preferred = vaultItems.filter((item) => item.kind === mount.kind);
      const candidate = (preferred.length > 0 ? preferred : vaultItems)[0];
      if (!candidate) return;
      const id = `file-${index}`;
      fileFieldById.set(id, { id, input });
      rows.push({
        id,
        fieldLabel: `${mount.kind === 'other' ? 'File' : mount.kind} field`,
        kind: 'file',
        profileKey: null,
        previewValue: candidate.label,
        sensitive: false,
      });
    });

    status.hidden = true;
    const result = await showDraftOverlay(rows);
    if (!result.confirmed) {
      status.hidden = false;
      status.innerHTML = '<div class="fr-note">Cancelled — nothing was filled.</div>';
      return;
    }

    let filledCount = 0;
    for (const row of rows) {
      if (result.excludedIds.has(row.id)) continue;
      const textField = textFieldById.get(row.id);
      if (textField) {
        if (textField.element instanceof HTMLSelectElement) {
          if (fillSelectByBestMatch(textField.element, row.previewValue)) filledCount += 1;
        } else {
          fillFieldSafely(textField.element, row.previewValue);
          filledCount += 1;
        }
        continue;
      }
      const fileField = fileFieldById.get(row.id);
      if (fileField) {
        const mount = fileInputMounts.get(fileField.input);
        const preferred = vaultItems.filter((item) => item.kind === mount?.kind);
        const candidate = (preferred.length > 0 ? preferred : vaultItems)[0];
        if (mount && candidate) {
          await runPipeline(fileField.input, mount.kind, mount.text, candidate, mount.ui.panel, mount.ui.button);
          filledCount += 1;
        }
      }
    }

    status.hidden = false;
    status.innerHTML = `<div class="fr-note fr-ok">Filled ${filledCount} of ${rows.length} field${rows.length === 1 ? '' : 's'}.</div>`;
  } catch (error) {
    status.hidden = false;
    status.innerHTML = `<h4 class="fr-fail">Something went wrong</h4><div>${error instanceof Error ? error.message : String(error)}</div>`;
  } finally {
    button.disabled = false;
  }
}

function scanForms(root: ParentNode) {
  const forms = root instanceof Element && root.matches('form') ? [root] : Array.from(root.querySelectorAll('form'));
  for (const form of forms) {
    if (processedForms.has(form)) continue;
    const hasFillable = form.querySelector(`${FILLABLE_TEXT_SELECTOR}, input[type="file"]`);
    if (!hasFillable) continue;
    processedForms.add(form);

    const { button, status } = mountFormButton(form);
    button.addEventListener('click', () => {
      void handleFillForm(form, status, button);
    });
  }
}

scan(document);

const observer = new MutationObserver((mutations) => {
  for (const mutation of mutations) {
    for (const node of mutation.addedNodes) {
      if (node instanceof HTMLElement) scan(node);
    }
  }
});
observer.observe(document.documentElement, { childList: true, subtree: true });
