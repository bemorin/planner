import { esc } from '../lib/text.js';
import { ymdKey } from '../lib/dates.js';
import { backLayers } from '../ui/back-stack.js';
import { keepTab } from '../ui/dialog-focus.js';
import { popoverEnter } from '../ui/motion.js';

/**
 * Local storage, in the header and in How it works → Data on this device (1.39.3). It wears Personal sync's
 * header alert (src/features/sync-status.js, styles/sync.css): a pill before Search (an icon where the header
 * is compact) and a popover with two actions, Export backup and Data on this device.
 *
 * - A change the browser refused (src/state/storage-health.js): “Not saved”, in the danger colour, until a later
 *   change lands; then it goes by itself. Announced once, never at each refused keystroke.
 * - Only Personal sync's “changed” mark refused, the change itself saved: “Storage full”, with sync's words, and
 *   only for people who use Personal sync.
 * - Storage about 80% full or more (storageBudget()): once a day, until the person opens it; it comes back the
 *   next day while storage stays that full.
 * - Storage blocked, or no room at all from the start (a private window): nothing here; the planner's startup
 *   dialog has said so.
 */

/** The day the person last opened the storage warning: one header alert a day. */
export const WARNED_KEY = 'daily-planner-ui:storage-warned';
const COMPACT_QUERY = '(max-width: 1080px)';
const PHONE_QUERY = '(max-width: 560px)';
const GUTTER = 12;
const POPOVER_WIDTH = 320;

export const FULL_TITLE = 'This browser is out of space for your planner.';
export const FULL_LEAD = 'Your latest change wasn’t saved.';
export const SYNC_LEAD = 'Your latest change is saved here, but may not reach your other devices.';
export const warnSentence = percent => `Storage on this device is about ${percent}% full.`;
export const WARN_LEAD = 'Export a backup to keep everything safe.';
const NOTHING_LOST = 'Export a backup so nothing is lost.';
const NO_ROOM = 'Older days can’t be moved out of this browser yet';
const AVAILABLE = 'Local saving is available. Private windows or clearing site data may still remove it — export a backup if you want to keep your planner history.';
const UNAVAILABLE = 'Local saving is unavailable in this browser context. Export anything important before leaving this page.';

/**
 * What the header says: null, or { kind: 'full' | 'sync' | 'warn', pill, label (the full sentence), title, lead,
 * body }. `failing`: a change was refused and none has landed since; `syncMarkRefused`: only the sync mark was;
 * `syncInUse`: Personal sync is connected; `level`: storageLevel(); `warnedToday`: today's warning was opened;
 * `unavailable`: saving never worked in this browser (blocked, or no room at all), which the startup dialog says.
 */
export function storageAlertView({ failing = false, syncMarkRefused = false, syncInUse = false, level = null, warnedToday = false, unavailable = false } = {}) {
  if (unavailable) return null;
  if (failing) {
    return {
      kind: 'full',
      pill: 'Not saved',
      label: `${FULL_TITLE} ${FULL_LEAD}`,
      title: FULL_TITLE,
      lead: FULL_LEAD,
      body: `${NOTHING_LOST} ${NO_ROOM}; Data on this device has the only way to make room.`
    };
  }
  if (syncMarkRefused && syncInUse) {
    return {
      kind: 'sync',
      pill: 'Storage full',
      label: `${FULL_TITLE} ${SYNC_LEAD}`,
      title: FULL_TITLE,
      lead: SYNC_LEAD,
      body: NOTHING_LOST
    };
  }
  if (level?.warn && !warnedToday) {
    return {
      kind: 'warn',
      pill: `Storage about ${level.percent}% full`,
      label: `${warnSentence(level.percent)} ${WARN_LEAD}`,
      title: warnSentence(level.percent),
      lead: WARN_LEAD,
      body: `Your planner is kept in this browser, which gives each site a limited space. ${NO_ROOM}.`
    };
  }
  return null;
}

/**
 * How it works → Data on this device, the line under its text: { text, warning }. The real state: saving
 * unavailable from the start (blocked, or no room at all) until a change lands, a refused change (with the only
 * way to make room), a refused sync mark (for people who use sync), the warning from 80%, else saving available.
 */
export function storageSafetyLine({ failing = false, syncMarkRefused = false, syncInUse = false, available = true, level = null } = {}) {
  if (!available) return { text: UNAVAILABLE, warning: true };
  if (failing) return { text: `${FULL_TITLE} ${FULL_LEAD} ${NOTHING_LOST} ${NO_ROOM}: the only way to make room is Reset local data, which deletes everything on this device.`, warning: true };
  if (syncMarkRefused && syncInUse) return { text: `${FULL_TITLE} ${SYNC_LEAD} ${NOTHING_LOST}`, warning: true };
  if (level?.warn) return { text: `${warnSentence(level.percent)} ${WARN_LEAD}`, warning: true };
  return { text: AVAILABLE, warning: false };
}

const ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><ellipse cx="12" cy="6" rx="7" ry="2.8"/><path d="M5 6v12c0 1.55 3.13 2.8 7 2.8s7-1.25 7-2.8V6"/><path d="M5 12c0 1.55 3.13 2.8 7 2.8s7-1.25 7-2.8"/></svg>';

/** The popover's content (its title and lead name and describe the dialog). */
export function storagePopoverMarkup(view) {
  return `<div class="sync-popover__head">
      <span class="storage-popover__icon" aria-hidden="true">${ICON}</span>
      <div><strong id="storage-alert-title">${esc(view.title)}</strong><span id="storage-alert-lead">${esc(view.lead)}</span></div>
    </div>
    <p id="storage-alert-body">${esc(view.body)}</p>
    <div class="sync-popover__actions"><button class="text-button" type="button" data-storage-alert-action="data">Data on this device</button><button class="primary-button" type="button" data-storage-alert-action="export"><span>Export backup</span></button></div>`;
}

export function createStorageAlert({
  health,
  level = () => null,
  syncInUse = () => false,
  unavailable = () => false,
  exportBackup = () => {},
  openData = () => {},
  onLayout = () => {},
  doc = typeof document !== 'undefined' ? document : null,
  win = typeof window !== 'undefined' ? window : null,
  storage = typeof localStorage !== 'undefined' ? localStorage : null,
  now = () => new Date(),
  layers = backLayers
} = {}) {
  const trigger = doc?.querySelector('[data-storage-alert]');
  const text = doc?.querySelector('[data-storage-alert-text]');
  const live = doc?.querySelector('[data-storage-alert-live]');
  if (!trigger || !health) return { render() {}, close() {}, get view() { return null; }, get open() { return false; } };

  const compact = win?.matchMedia?.(COMPACT_QUERY) || null;
  const phone = win?.matchMedia?.(PHONE_QUERY) || null;
  const handle = { storageAlert: true };
  let view = null;
  let popover = null;
  let shown = '';
  let told = '';
  // Kept here too: with storage full, the day it was opened may not be writable.
  let warnedOn = '';

  const today = () => ymdKey(now());
  const warnedToday = () => {
    if (warnedOn === today()) return true;
    try { return storage?.getItem(WARNED_KEY) === today(); } catch (_) { return false; }
  };
  const markWarned = () => {
    warnedOn = today();
    try { storage?.setItem(WARNED_KEY, warnedOn); } catch (_) {}
  };
  const focusedInside = () => !!popover && popover.contains(doc.activeElement);

  function place() {
    if (!popover) return;
    const rect = trigger.getBoundingClientRect();
    const viewport = win?.innerWidth || doc.documentElement.clientWidth || 0;
    const width = phone?.matches ? viewport - GUTTER * 2 : Math.min(POPOVER_WIDTH, viewport - GUTTER * 2);
    const centre = rect.left + rect.width / 2;
    const left = phone?.matches ? GUTTER : Math.max(GUTTER, Math.min(centre - width / 2, viewport - GUTTER - width));
    popover.style.width = `${Math.round(width)}px`;
    popover.style.left = `${Math.round(left)}px`;
    popover.style.top = `${Math.round(rect.bottom + 10)}px`;
    popover.style.setProperty('--arrow-x', `${Math.round(Math.max(18, Math.min(centre - left, width - 18)))}px`);
  }

  function onKeydown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close({ focus: true });
      return;
    }
    if (event.key === 'Tab') { keepTab(event, popover); return; }
    // The planner's single-key shortcuts stay out of the popover.
    event.stopPropagation();
  }

  function onOutside(event) {
    if (!popover || popover.contains(event.target) || trigger.contains(event.target)) return;
    close({ focus: false });
  }

  function onAction(event) {
    const button = event.target.closest?.('[data-storage-alert-action]');
    if (!button) return;
    const action = button.dataset.storageAlertAction;
    // From the keyboard (or a screen reader: detail 0), focus comes back to the pill; a tap leaves no ring behind.
    close({ focus: !event.detail });
    if (action === 'export') exportBackup();
    else openData();
  }

  function open() {
    if (popover || !view) return;
    // The warning has been seen: once a day.
    if (view.kind === 'warn') markWarned();
    popover = doc.createElement('div');
    popover.className = 'app-popover sync-popover storage-popover';
    popover.id = 'storage-alert-popover';
    popover.setAttribute('role', 'dialog');
    popover.setAttribute('aria-labelledby', 'storage-alert-title');
    popover.setAttribute('aria-describedby', 'storage-alert-lead storage-alert-body');
    popover.dataset.kind = view.kind;
    popover.innerHTML = storagePopoverMarkup(view);
    doc.body.append(popover);
    trigger.setAttribute('aria-expanded', 'true');
    trigger.setAttribute('aria-controls', popover.id);
    place();
    popover.addEventListener('keydown', onKeydown);
    popover.addEventListener('click', onAction);
    doc.addEventListener('pointerdown', onOutside, true);
    win?.addEventListener?.('resize', place);
    layers.open(handle, { back: () => close({ focus: focusedInside() }), alive: () => !!popover });
    const el = popover;
    (win?.requestAnimationFrame || (fn => fn()))(() => { el.classList.add('is-open'); popoverEnter(el); });
    popover.querySelector('.primary-button')?.focus({ preventScroll: true });
  }

  function close({ focus = false } = {}) {
    if (!popover) return;
    const el = popover;
    popover = null;
    el.removeEventListener('keydown', onKeydown);
    el.removeEventListener('click', onAction);
    doc.removeEventListener('pointerdown', onOutside, true);
    win?.removeEventListener?.('resize', place);
    el.remove();
    trigger.setAttribute('aria-expanded', 'false');
    trigger.removeAttribute('aria-controls');
    layers.closed(handle);
    render();
    if (focus && !trigger.hidden) trigger.focus({ preventScroll: true });
  }

  /** Drawn from the save health and the storage level as they are now. */
  function render() {
    const next = storageAlertView({ failing: health.failing, syncMarkRefused: health.syncMarkRefused, syncInUse: syncInUse(), level: level(), warnedToday: warnedToday(), unavailable: unavailable() });
    // An open warning stays put until it is closed (it was marked seen as it opened).
    if (popover && next?.kind !== view?.kind && !(view?.kind === 'warn' && !next)) close({ focus: focusedInside() });
    if (!popover) view = next;
    // A refused change (or sync mark) is told once as it starts, and once as it ends: never at each keystroke.
    const urgent = view && view.kind !== 'warn' ? view.kind : '';
    if (live && urgent !== told) live.textContent = urgent ? view.label : told ? 'Your changes are being saved again.' : '';
    told = urgent;
    const hadFocus = doc.activeElement === trigger;
    const key = `${view?.kind || ''}|${view?.pill || ''}|${compact?.matches ? 'c' : 'w'}`;
    if (key === shown) return;
    const wasHidden = trigger.hidden;
    shown = key;
    trigger.hidden = !view;
    trigger.dataset.kind = view?.kind || '';
    if (text) text.textContent = view?.pill || '';
    if (view) trigger.dataset.tooltip = view.label;
    else delete trigger.dataset.tooltip;
    // The icon alone (compact header) is named by the full sentence; the pill, by its own words and the sentence.
    if (view) trigger.setAttribute('aria-label', compact?.matches ? view.label : `${view.pill}: ${view.label}`);
    else trigger.removeAttribute('aria-label');
    if (wasHidden !== trigger.hidden) onLayout();
    if (trigger.hidden && hadFocus) doc.querySelector('[data-search-open]')?.focus({ preventScroll: true });
  }

  trigger.addEventListener('click', () => {
    if (popover) close({ focus: true });
    else open();
  });
  compact?.addEventListener?.('change', () => { shown = ''; render(); });
  render();

  return {
    render,
    close,
    get view() { return view; },
    get open() { return !!popover; }
  };
}
