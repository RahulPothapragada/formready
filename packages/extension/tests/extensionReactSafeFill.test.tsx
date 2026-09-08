// @vitest-environment jsdom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { fillFieldSafely, fillSelectByBestMatch } from '../src/reactSafeFill';

let container: HTMLDivElement | null = null;
let root: Root | null = null;

afterEach(() => {
  if (root) act(() => root!.unmount());
  container?.remove();
  container = null;
  root = null;
});

function mount(element: React.ReactElement) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => root!.render(element));
  return container;
}

function ControlledInput({ onCommit }: { onCommit: (value: string) => void }) {
  const [value, setValue] = useState('');
  return (
    <div>
      <input
        data-testid="controlled"
        value={value}
        onChange={(event) => {
          setValue(event.target.value);
          onCommit(event.target.value);
        }}
      />
      <span data-testid="echo">{value}</span>
    </div>
  );
}

describe('fillFieldSafely against a real React-controlled input', () => {
  it('updates React state — plain .value assignment would not', () => {
    const committed: string[] = [];
    const el = mount(<ControlledInput onCommit={(v) => committed.push(v)} />);
    const input = el.querySelector('[data-testid="controlled"]') as HTMLInputElement;
    const echo = el.querySelector('[data-testid="echo"]') as HTMLSpanElement;

    // Sanity check: the naive path really does fail against React, so the
    // test below is proving something real, not a tautology.
    act(() => {
      input.value = 'naive-assignment';
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(committed).toEqual([]); // React's onChange never fired
    expect(echo.textContent).toBe(''); // state never updated

    act(() => {
      fillFieldSafely(input, 'Aadhaar Holder Name');
    });

    expect(committed).toEqual(['Aadhaar Holder Name']);
    expect(echo.textContent).toBe('Aadhaar Holder Name');
    expect(input.value).toBe('Aadhaar Holder Name');
  });
});

describe('fillSelectByBestMatch', () => {
  it('matches by visible option text when the value differs (state code vs state name)', () => {
    document.body.innerHTML = `
      <select id="state">
        <option value="">Choose...</option>
        <option value="KA">Karnataka</option>
        <option value="MH">Maharashtra</option>
      </select>
    `;
    const select = document.getElementById('state') as HTMLSelectElement;
    const matched = fillSelectByBestMatch(select, 'Karnataka');
    expect(matched).toBe(true);
    expect(select.value).toBe('KA');
  });

  it('returns false when nothing matches, without throwing', () => {
    document.body.innerHTML = `<select id="s"><option value="A">Alpha</option></select>`;
    const select = document.getElementById('s') as HTMLSelectElement;
    expect(fillSelectByBestMatch(select, 'Zulu')).toBe(false);
  });
});
