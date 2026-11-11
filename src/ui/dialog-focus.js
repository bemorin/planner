/**
 * Keyboard focus for modal dialogs: in when one opens, kept in while it is
 * open, back to what opened it when it closes (WCAG 2.4.3, the APG dialog
 * pattern). One module for the planner's `.modal` dialogs (app.js
 * openModal / closeModal), its native <dialog> sheets (share-dialog.js) and
 * the public pages' dialogs.
 *
 * - focusDialog(panel, preferred): the control the caller names, else the
 *   dialog's title (the element its aria-labelledby names, made focusable
 *   with tabindex="-1" and no ring), else the panel itself.
 * - keepTab(event, panel): Tab on the last stop goes to the first, Shift+Tab
 *   on the first to the last, and a Tab from outside lands on the first (or
 *   last). Between the edges the browser keeps its own order, so radio
 *   groups and text fields behave as usual. Inert parts (an overlay's
 *   background) are skipped.
 * - createDialogReturns(): remembers what opened each dialog and gives focus
 *   back to it, or to its twin when the planner drew it again meanwhile.
 *
 * The decisions are pure (edgeStep, tabStopsOf, twinSelector) and
 * unit-tested in tests/dialog-focus.test.js.
 */

const CANDIDATES = 'a[href], area[href], button, input:not([type="hidden"]), select, textarea, iframe, summary, [contenteditable=""], [contenteditable="true"], [tabindex]';

/**
 * Where Tab goes among `count` stops from `index` (-1: focus is not on a stop):
 * the index to focus, or null to let the browser move (between the edges).
 * With no stop at all it returns -1: hold focus on the dialog itself.
 */
export function edgeStep(count, index, backwards = false) {
  if (count <= 0) return -1;
  if (index < 0 || index >= count) return backwards ? count - 1 : 0;
  if (!backwards && index === count - 1) return 0;
  if (backwards && index === 0) return count - 1;
  return null;
}

/**
 * The stops Tab visits, in order, from candidates that report how they look
 * ({ el, tabIndex, disabled, inert, rendered, radio: { name, checked } | null }):
 * a radio group counts once, at its checked radio (else its first), as the
 * browser does.
 */
export function tabStopsOf(items) {
  const usable = items.filter(item => item.tabIndex >= 0 && !item.disabled && !item.inert && item.rendered);
  const groups = new Map();
  usable.forEach(item => {
    if (!item.radio?.name) return;
    const group = groups.get(item.radio.name) || [];
    group.push(item);
    groups.set(item.radio.name, group);
  });
  return usable.filter(item => {
    const group = item.radio?.name ? groups.get(item.radio.name) : null;
    if (!group || group.length < 2) return true;
    const pick = group.find(other => other.radio.checked) || group[0];
    return pick === item;
  }).map(item => item.el);
}

function describe(el) {
  const style = el.ownerDocument.defaultView?.getComputedStyle?.(el);
  const radio = el.matches('input[type="radio"]') ? { name: el.name || '', checked: !!el.checked } : null;
  return {
    el,
    tabIndex: el.tabIndex,
    disabled: el.matches(':disabled'),
    inert: !!el.closest('[inert]'),
    rendered: el.getClientRects().length > 0 && style?.visibility !== 'hidden',
    radio
  };
}

/** The elements Tab visits inside `root`, in document order. */
export function tabStops(root) {
  if (!root) return [];
  return tabStopsOf([...root.querySelectorAll(CANDIDATES)].map(describe));
}

/** Keeps Tab and Shift+Tab inside `root`. Returns true when it moved focus itself. */
export function keepTab(event, root) {
  if (!root || event.key !== 'Tab' || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return false;
  const stops = tabStops(root);
  const active = root.ownerDocument.activeElement;
  const index = stops.indexOf(active);
  if (index === -1 && active && active !== root && root.contains(active)) {
    // On something inside that is no stop of its own (the title): the browser goes on from there while a stop lies
    // that way (compareDocumentPosition: 4 = that stop follows, 2 = it precedes).
    const ahead = stops.some(stop => active.compareDocumentPosition(stop) & (event.shiftKey ? 2 : 4));
    if (ahead) return false;
  }
  const step = edgeStep(stops.length, index, event.shiftKey);
  if (step === null) return false;
  event.preventDefault();
  const target = step === -1 ? root : stops[step];
  if (target === root && !root.hasAttribute('tabindex')) root.tabIndex = -1;
  target.focus({ preventScroll: step === -1 });
  return true;
}

/** True when `el` can take focus now: still in the page, shown, not inert, not disabled. */
export function canFocus(el) {
  if (!el || typeof el.focus !== 'function' || !el.isConnected) return false;
  const doc = el.ownerDocument;
  if (el === doc.body || el === doc.documentElement) return false;
  if (el.disabled || el.closest('[inert], [hidden]')) return false;
  return el.getClientRects().length > 0;
}

/** The dialog's title: what its aria-labelledby names, else its first heading. */
export function titleOf(panel) {
  if (!panel) return null;
  const doc = panel.ownerDocument;
  const named = String(panel.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean)
    .map(id => doc.getElementById(id)).find(el => el && panel.contains(el) && canFocus(el));
  return named || [...panel.querySelectorAll('h1, h2, h3')].find(canFocus) || null;
}

/**
 * Moves focus into a dialog that just opened: `preferred` when it can take
 * it, else focus already inside stays, else the title, else the panel.
 */
export function focusDialog(panel, preferred = null) {
  if (!panel) return null;
  const active = panel.ownerDocument.activeElement;
  let target = canFocus(preferred) && panel.contains(preferred) ? preferred : null;
  if (!target && active && active !== panel && panel.contains(active)) return active;
  if (!target) {
    target = titleOf(panel);
    if (target && !target.hasAttribute('tabindex')) {
      target.tabIndex = -1;
      target.dataset.dialogTitle = '';
    }
  }
  if (!target) {
    target = panel;
    if (!panel.hasAttribute('tabindex')) panel.tabIndex = -1;
  }
  target.focus({ preventScroll: true });
  return target;
}

const ROW_KEYS = ['data-item-id', 'data-block-id', 'data-week-block-id', 'data-event-id'];

/**
 * A selector that finds the same control again once the planner has drawn it
 * anew (from `attrs`, its attributes as [name, value] pairs, and those of the
 * row it sits in), or '' when it has nothing stable to go by.
 */
export function twinSelector(tag, attrs, rowAttrs = []) {
  const quote = value => String(value).replace(/["\\]/g, '\\$&');
  const pick = list => list.find(([name]) => name === 'id') || list.find(([name]) => ROW_KEYS.includes(name)) || list.find(([name]) => name.startsWith('data-') && !name.startsWith('data-tooltip'));
  const own = pick(attrs);
  if (!own) return '';
  const part = ([name, value]) => `[${name}${value ? `="${quote(value)}"` : ''}]`;
  const self = `${tag}${part(own)}`;
  const row = rowAttrs.find(([name]) => ROW_KEYS.includes(name));
  return own[0] === 'id' || !row ? self : `${part(row)} ${self}`;
}

function twinOf(el) {
  const attrs = node => [...node.attributes].map(attr => [attr.name, attr.value]);
  const row = el.parentElement?.closest(ROW_KEYS.map(name => `[${name}]`).join(', '));
  try { return twinSelector(el.localName, attrs(el), row ? attrs(row) : []); } catch (_) { return ''; }
}

/** What to give focus back to later: { el, selector } (selector finds its twin once drawn again), or null. */
export function openerOf(el) {
  if (!el || !el.attributes || el === el.ownerDocument?.body) return null;
  return { el, selector: twinOf(el) };
}

/**
 * The one element matching `selector` inside `root` that can take focus now, or null. With
 * { now: false }, the one match whether or not it is shown yet (a dialog about to open again).
 */
export function twinIn(selector, root = typeof document === 'undefined' ? null : document, { now = true } = {}) {
  if (!selector || !root) return null;
  let found = [];
  try { found = [...root.querySelectorAll(selector)]; } catch (_) { return null; }
  if (now) found = found.filter(canFocus);
  return found.length === 1 ? found[0] : null;
}

/** Gives focus back to `el`, else to its twin `selector` (the one that can take it); true when it could. */
export function focusBack(el, selector = '') {
  const target = canFocus(el) ? el : twinIn(selector);
  if (!target) return false;
  target.focus({ preventScroll: true });
  return true;
}

/** Focus back along an opener chain: what opened the dialog, else what opened the one it replaced, and so on. */
export function focusOpener(entry) {
  for (let step = entry, guard = 0; step && guard < 8; step = step.outer, guard += 1) {
    if (focusBack(step.el, step.selector)) return true;
  }
  return false;
}

/**
 * Remembers, per dialog, what opened it. A dialog that replaced another
 * keeps that one's opener behind its own (`outer`), so focus can go back to
 * the first that still stands.
 */
export function createDialogReturns() {
  const openers = new WeakMap();
  return {
    /** `el` opened `dialog` (in place of a dialog that `outer` had opened). */
    remember(dialog, el, outer = null) {
      if (!dialog) return;
      const own = el && !dialog.contains(el) ? openerOf(el) : null;
      const entry = own ? { ...own, outer: outer || null } : outer || null;
      if (entry) openers.set(dialog, entry); else openers.delete(dialog);
    },
    /** What opened `dialog` (and forgets it): { el, selector, outer } or null. */
    take(dialog) {
      const entry = dialog ? openers.get(dialog) || null : null;
      if (dialog) openers.delete(dialog);
      return entry;
    },
    adopt(dialog, entry) { if (dialog && entry) openers.set(dialog, entry); },
    /** Focus back to what opened `dialog`, along the chain; true when it could. */
    restore(dialog) { return focusOpener(this.take(dialog)); }
  };
}
