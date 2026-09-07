/**
 * Writes a value into a form field the way a real user typing would,
 * not the way `element.value = x` does.
 *
 * React (and to a lesser extent Vue) installs its own `value` setter on
 * the *instance*, shadowing the platform's setter on the prototype, so it
 * can intercept assignment and keep its virtual DOM in sync. Setting
 * `.value` directly writes through React's shadowing setter, which updates
 * the visible text but never touches React's internal state — the next
 * re-render silently reverts it. Calling the *prototype's* setter instead
 * bypasses that shadow, then dispatching a real `input` event is what
 * actually notifies React's change handler. `change` is dispatched too
 * because some frameworks and plain forms only listen for that.
 */

type Fillable = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

function prototypeFor(element: Fillable): object {
  if (element instanceof HTMLTextAreaElement) return HTMLTextAreaElement.prototype;
  if (element instanceof HTMLSelectElement) return HTMLSelectElement.prototype;
  return HTMLInputElement.prototype;
}

export function fillFieldSafely(element: Fillable, value: string): void {
  const descriptor = Object.getOwnPropertyDescriptor(prototypeFor(element), 'value');
  const setter = descriptor?.set;
  if (!setter) throw new Error('No native value setter found for this element.');
  setter.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
  element.dispatchEvent(new Event('change', { bubbles: true }));
}

/**
 * Selects the option whose visible text (or underlying value) best matches
 * the given profile value — dropdowns are usually keyed by option value
 * ("KA"), not the display text ("Karnataka"), so a straight value
 * assignment from a profile string mismatches more often than it matches.
 */
export function fillSelectByBestMatch(select: HTMLSelectElement, value: string): boolean {
  const target = value.trim().toLowerCase();
  if (!target) return false;
  const options = Array.from(select.options);
  const match =
    options.find((option) => option.textContent?.trim().toLowerCase() === target || option.value.trim().toLowerCase() === target) ??
    options.find((option) => option.textContent?.trim().toLowerCase().includes(target));
  if (!match) return false;
  fillFieldSafely(select, match.value);
  return true;
}
