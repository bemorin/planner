import { esc } from '../lib/text.js';

/**
 * The planner's own dropdown list — what a native <select> would be, in the
 * app's menu style: a listbox popover of options under its trigger.
 *
 * Keyboard: the selected option takes focus when the list opens; ↑ ↓ move,
 * Home / End jump, typing a few letters finds an option, Enter or Space
 * chooses, Escape or Tab closes it and gives focus back to the trigger. Any
 * button with aria-haspopup="listbox" also opens its list with ↓ or ↑.
 *
 * Positioning, outside clicks and stacking stay with the app's popover
 * primitives: `ctx.showPopover(anchor, popover, options)` and `ctx.closePopover()`.
 */

const TYPEAHEAD_MS = 650;
const PAGE = 8;
const CHECK = '<svg class="option-check" viewBox="0 0 24 24" aria-hidden="true"><path d="m6.5 12.5 3.3 3.3 7.7-8"/></svg>';
let count = 0;

/** The option a navigation key moves to, or -1 for keys that don't move (pure). */
export function listboxStep(key, index, length) {
  if (!length) return -1;
  const last = length - 1;
  const from = Math.min(Math.max(Number.isInteger(index) ? index : -1, -1), last);
  if (key === 'Home') return 0;
  if (key === 'End') return last;
  if (key === 'ArrowDown') return Math.min(last, from + 1);
  if (key === 'ArrowUp') return from < 0 ? last : Math.max(0, from - 1);
  if (key === 'PageDown') return Math.min(last, Math.max(from, 0) + PAGE);
  if (key === 'PageUp') return from < 0 ? 0 : Math.max(0, from - PAGE);
  return -1;
}

/**
 * The option typed letters land on (pure): the first label starting with the
 * query, searched from the focused option onwards and wrapping. Typing the same
 * letter again cycles through the labels that start with it.
 */
export function typeaheadMatch(labels, query, from = -1) {
  const typed = String(query || '').toLocaleLowerCase().replace(/^\s+/, '');
  const list = Array.isArray(labels) ? labels : [];
  if (!typed || !list.length) return -1;
  const single = [...typed].every(character => character === typed[0]);
  const needle = single ? typed[0] : typed;
  const start = single ? from + 1 : Math.max(from, 0);
  for (let step = 0; step < list.length; step += 1) {
    const index = (((start + step) % list.length) + list.length) % list.length;
    if (String(list[index] ?? '').toLocaleLowerCase().startsWith(needle)) return index;
  }
  return -1;
}

const openDialogs = () => document.querySelectorAll('.modal:not([hidden])').length;

/**
 * Opens the list under `anchor`. `items` are { value, label, color?, className? };
 * `onSelect(item)` runs when one is chosen. Options: compact, timeMenu,
 * className, minWidth, label (the list's accessible name) and the placement
 * options showPopover() understands (matchWidth, alignSelected, align, width).
 */
export function openListbox(ctx, anchor, items, selected, onSelect, options = {}) {
  ctx.closePopover();
  const opener = document.activeElement && document.activeElement !== document.body ? document.activeElement : null;
  const trigger = anchor?.matches?.('button') ? anchor : opener && anchor?.contains?.(opener) ? opener : anchor?.querySelector?.('button') || anchor;
  const popover = document.createElement('div');
  popover.className = `app-popover app-popover--list${options.compact ? ' is-compact' : ''}${options.timeMenu ? ' is-time-menu' : ''}${options.className ? ` ${options.className}` : ''}`;
  popover.id = `app-listbox-${(count += 1)}`;
  popover.setAttribute('role', 'listbox');
  const name = options.label || trigger?.getAttribute?.('aria-label') || '';
  if (name) popover.setAttribute('aria-label', name);
  if (options.minWidth) popover.style.minWidth = `${options.minWidth}px`;

  let query = '';
  let queryTimer = 0;
  const restore = () => { if (trigger?.isConnected) trigger.focus?.({ preventScroll: true }); };
  const close = () => { clearTimeout(queryTimer); if (popover.isConnected) ctx.closePopover(); };

  const buttons = items.map(item => {
    const isSelected = String(item.value) === String(selected);
    const button = document.createElement('button');
    button.type = 'button';
    button.tabIndex = -1;
    button.className = `popover-option${isSelected ? ' is-selected' : ''}${item.className ? ` ${item.className}` : ''}`;
    button.setAttribute('role', 'option');
    button.setAttribute('aria-selected', String(isSelected));
    if (isSelected) button.dataset.selectedOption = 'true';
    button.innerHTML = `${item.color ? `<span class="category-dot" style="background:${esc(item.color)}"></span>` : ''}<span>${esc(item.label)}</span>${isSelected ? CHECK : ''}`;
    button.addEventListener('click', event => {
      event.stopPropagation();
      const dialogs = openDialogs();
      onSelect(item);
      close();
      // Back to the trigger, unless choosing opened another dialog.
      if (openDialogs() <= dialogs) restore();
    });
    popover.append(button);
    return button;
  });
  const labels = items.map(item => String(item.label ?? ''));

  const focusAt = index => {
    const button = buttons[index];
    if (!button) return;
    buttons.forEach(other => { other.tabIndex = other === button ? 0 : -1; });
    button.focus({ preventScroll: true });
    button.scrollIntoView?.({ block: 'nearest' });
  };

  popover.addEventListener('keydown', event => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const index = buttons.indexOf(document.activeElement);
    if (event.key === 'Escape' || event.key === 'Tab') {
      event.preventDefault();
      event.stopPropagation();
      close();
      restore();
      return;
    }
    const step = listboxStep(event.key, index, buttons.length);
    if (step >= 0) { event.preventDefault(); event.stopPropagation(); focusAt(step); return; }
    const typing = event.key.length === 1 && (event.key !== ' ' || query);
    if (!typing) return;
    event.preventDefault();
    event.stopPropagation();
    query += event.key;
    clearTimeout(queryTimer);
    queryTimer = setTimeout(() => { query = ''; }, TYPEAHEAD_MS);
    const match = typeaheadMatch(labels, query, index);
    if (match >= 0) focusAt(match);
  });

  ctx.showPopover(anchor, popover, options);
  const start = Math.max(0, buttons.findIndex(button => button.dataset.selectedOption));
  buttons.forEach((button, index) => { button.tabIndex = index === start ? 0 : -1; });
  buttons[start]?.focus({ preventScroll: true });
  return popover;
}

// ↓ or ↑ on any listbox trigger opens its list, as with a native select.
globalThis.document?.addEventListener('keydown', event => {
  if ((event.key !== 'ArrowDown' && event.key !== 'ArrowUp') || event.altKey || event.metaKey || event.ctrlKey) return;
  const trigger = event.target?.closest?.('button[aria-haspopup="listbox"]');
  if (!trigger || trigger.disabled || trigger.getAttribute('aria-expanded') === 'true') return;
  event.preventDefault();
  trigger.click();
});
