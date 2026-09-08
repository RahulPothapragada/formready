/**
 * The "final draft" review — every planned fill/attach shown before a
 * single value is written into the real form. Matches FormReady's own
 * rule that nothing is confirmed automatically: the user sees exactly
 * what's about to happen and can uncheck anything before committing.
 */

import type { ProfileFieldKey } from './profile';

export interface DraftRow {
  id: string;
  fieldLabel: string;
  kind: 'text' | 'select' | 'file';
  profileKey: ProfileFieldKey | null;
  previewValue: string;
  sensitive: boolean;
}

export interface DraftResult {
  confirmed: boolean;
  excludedIds: Set<string>;
}

const SENSITIVE_KEYS: ProfileFieldKey[] = ['aadhaar', 'pan'];

export function isSensitiveKey(key: ProfileFieldKey | null): boolean {
  return key !== null && SENSITIVE_KEYS.includes(key);
}

export function maskValue(key: ProfileFieldKey | null, value: string): string {
  if (key === 'aadhaar') {
    const digits = value.replace(/\D/g, '');
    return digits.length >= 4 ? `•••• •••• ${digits.slice(-4)}` : '••••';
  }
  if (key === 'pan') {
    return value.length > 4 ? `${value.slice(0, 2)}••••${value.slice(-2)}` : '••••';
  }
  return value;
}

const STYLE = `
  .fr-backdrop {
    position: fixed; inset: 0; background: rgba(15, 18, 25, 0.55);
    display: flex; align-items: center; justify-content: center;
    font: 13px/1.4 system-ui, sans-serif; z-index: 1;
  }
  .fr-draft {
    background: white; color: #1a1a1a; width: min(480px, 92vw); max-height: 82vh;
    border-radius: 12px; box-shadow: 0 20px 60px rgba(0,0,0,0.35);
    display: flex; flex-direction: column; overflow: hidden;
  }
  .fr-draft header { padding: 16px 18px 8px; }
  .fr-draft h2 { margin: 0 0 4px; font-size: 16px; }
  .fr-draft p { margin: 0; color: #666; font-size: 12px; }
  .fr-rows { overflow-y: auto; padding: 4px 18px; flex: 1; }
  .fr-row {
    display: flex; align-items: flex-start; gap: 10px;
    padding: 10px 0; border-bottom: 1px solid #eee;
  }
  .fr-row:last-child { border-bottom: none; }
  .fr-row input[type="checkbox"] { margin-top: 3px; }
  .fr-row .fr-label { font-weight: 600; }
  .fr-row .fr-value { color: #333; word-break: break-word; }
  .fr-row .fr-kind { font-size: 10.5px; color: #999; text-transform: uppercase; letter-spacing: 0.03em; }
  .fr-actions { display: flex; gap: 8px; padding: 14px 18px; border-top: 1px solid #eee; }
  .fr-actions button {
    flex: 1; padding: 10px; border-radius: 8px; border: none; font-size: 13px; font-weight: 600; cursor: pointer;
  }
  .fr-confirm { background: #1d4ed8; color: white; }
  .fr-cancel { background: #f0f0f0; color: #333; }
  .fr-empty { padding: 24px 18px; color: #777; text-align: center; }
`;

export function showDraftOverlay(rows: DraftRow[]): Promise<DraftResult> {
  return new Promise((resolve) => {
    const host = document.createElement('div');
    host.style.position = 'fixed';
    host.style.inset = '0';
    host.style.zIndex = '2147483647';
    document.body.appendChild(host);

    const shadow = host.attachShadow({ mode: 'open' });
    const style = document.createElement('style');
    style.textContent = STYLE;
    shadow.appendChild(style);

    const backdrop = document.createElement('div');
    backdrop.className = 'fr-backdrop';
    shadow.appendChild(backdrop);

    const panel = document.createElement('div');
    panel.className = 'fr-draft';
    backdrop.appendChild(panel);

    const header = document.createElement('header');
    header.innerHTML = `
      <h2>Review before filling</h2>
      <p>Nothing is written into the form until you confirm. Uncheck anything you don't want filled.</p>
    `;
    panel.appendChild(header);

    const rowsEl = document.createElement('div');
    rowsEl.className = 'fr-rows';
    panel.appendChild(rowsEl);

    const checkboxes = new Map<string, HTMLInputElement>();

    if (rows.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'fr-empty';
      empty.textContent = "Didn't confidently recognize any fields on this form to fill.";
      rowsEl.appendChild(empty);
    }

    for (const row of rows) {
      const rowEl = document.createElement('div');
      rowEl.className = 'fr-row';

      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.checked = true;
      checkboxes.set(row.id, checkbox);
      rowEl.appendChild(checkbox);

      const meta = document.createElement('div');
      const label = document.createElement('div');
      label.className = 'fr-label';
      label.textContent = row.fieldLabel;
      const kind = document.createElement('div');
      kind.className = 'fr-kind';
      kind.textContent = row.kind;
      const value = document.createElement('div');
      value.className = 'fr-value';
      value.textContent = row.sensitive ? maskValue(row.profileKey, row.previewValue) : row.previewValue;
      meta.appendChild(label);
      meta.appendChild(kind);
      meta.appendChild(value);
      rowEl.appendChild(meta);

      rowsEl.appendChild(rowEl);
    }

    const actions = document.createElement('div');
    actions.className = 'fr-actions';
    const cancel = document.createElement('button');
    cancel.className = 'fr-cancel';
    cancel.textContent = 'Cancel';
    const confirm = document.createElement('button');
    confirm.className = 'fr-confirm';
    confirm.textContent = rows.length > 0 ? 'Confirm & Fill' : 'Close';
    actions.appendChild(cancel);
    actions.appendChild(confirm);
    panel.appendChild(actions);

    const finish = (result: DraftResult) => {
      host.remove();
      resolve(result);
    };

    cancel.addEventListener('click', () => finish({ confirmed: false, excludedIds: new Set() }));
    confirm.addEventListener('click', () => {
      const excludedIds = new Set(
        rows.filter((row) => !(checkboxes.get(row.id)?.checked ?? true)).map((row) => row.id),
      );
      finish({ confirmed: rows.length > 0, excludedIds });
    });
  });
}
