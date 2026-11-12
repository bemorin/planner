import { esc } from '../lib/text.js';
import { formatStorageBytes } from '../state/planner-backup.js';
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
 * - 1.40: a refused change first makes room (older days move to this browser's database, src/features/archive-keeper.js):
 *   “Saving…”, neutral, meanwhile (up to three seconds), then nothing once it is saved, or “Not saved” when even that
 *   couldn't make room. Data on this device says when older days are kept in the database, and when they can't be read.
 * - 1.40: an earlier version of a day kept aside (a tab that couldn't see the day saved over it): said once, calmly,
 *   until the person opens it, with the way to it (Data on this device, where it can be downloaded or put back).
 * - 1.40: a Reset that couldn't remove the older days from this browser's database yet (another tab holds it open):
 *   said, until the next start removes them.
 */

/** The day the person last opened the storage warning: one header alert a day. */
export const WARNED_KEY = 'daily-planner-ui:storage-warned';
/** When the latest earlier version kept aside that the person has opened was kept (1.40): each is said once. */
export const ASIDE_SEEN_KEY = 'daily-planner-ui:aside-seen';
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
/** 1.40: a refused change that moving older days couldn't make room for. */
export const NO_MORE_ROOM = 'This browser can’t make more room for your planner here. Export a backup now, so nothing is lost.';
export const SAVING_TITLE = 'Making room for your planner.';
export const SAVING_LEAD = 'Your latest change is being saved.';
const SAVING_BODY = 'Older days are moving to this browser’s own database. It takes a moment.';
const LIMITED = 'Your planner is kept in this browser, which gives each site a limited space, and it can’t make more room here.';
const AVAILABLE = 'Local saving is available. Private windows or clearing site data may still remove it — export a backup if you want to keep your planner history.';
/** Data on this device, once older days are kept in this browser's database (1.40). */
export const ARCHIVE_IN_USE = 'Older days move to this browser’s database by themselves, so there is always room for new plans.';
export const ARCHIVE_UNAVAILABLE = 'Your older days are kept in this browser’s database, which isn’t answering right now: until it does, they can’t be opened, sync waits, and Export backup has your recent days only. Reload the planner to try again.';
export const ARCHIVE_LOST = 'Some of your older days can’t be found in this browser’s database now. Nothing is taken for deleted: Sync now brings back what your synced copy has, and Import backup the days a backup holds. Once you have brought back what you can, carry on without the others.';
/** Data on this device's “Carry on without them” (1.40), once older days are missing: its confirmation. */
export const ARCHIVE_SETTLE = Object.freeze({
  title: 'Carry on without the missing older days?',
  message: 'The older days this browser’s database no longer has are let go on this device, so it can make room for new plans again. Your synced copy and your backups keep theirs: a sync or an import still brings them back.'
});
export const keptAsideLine = count => `${count === 1 ? 'An earlier version of a day was' : `Earlier versions of ${count.toLocaleString('en')} days were`} kept aside when another tab saved over ${count === 1 ? 'it' : 'them'} without seeing ${count === 1 ? 'it' : 'them'}. Below, Download keeps one in a file, and Restore puts it back (the version there now is kept aside in its place).`;
/** The day of an earlier version kept aside, as the header names it: “Tue, March 3”, with the year when it isn't this one. */
export function asideDayLabel(day, { locale, now = new Date() } = {}) {
  const date = new Date(`${day}T12:00:00`);
  if (Number.isNaN(date.getTime())) return 'a day';
  return date.toLocaleDateString(locale, { weekday: 'short', day: 'numeric', month: 'long', year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined });
}
export const asideTitle = (day, options) => `An earlier version of ${asideDayLabel(day, options)} was kept aside.`;
export const ASIDE_LEAD = 'Review it in How it works → Data on this device.';
const ASIDE_BODY = 'Another tab saved over this day without seeing it, so the version that was there is kept on this device. You can download it, or put it back.';
export const RESET_LEFT_TITLE = 'Your older days are still in this browser’s database.';
export const RESET_LEFT_LEAD = 'Reset couldn’t remove them yet. The planner tries again each time it opens.';
const RESET_LEFT_BODY = 'They are never opened again. Close the planner’s other tabs, then reload it, to finish now.';
const UNAVAILABLE = 'Local saving is unavailable in this browser context. Export anything important before leaving this page.';

/**
 * What the header says: null, or { kind: 'saving' | 'full' | 'sync' | 'reset' | 'aside' | 'warn', pill, label (the
 * full sentence), title, lead, body, action ('data': the popover's one button is Data on this device) }. `failing`: a
 * change was refused and none has landed since; `syncMarkRefused`: only the sync mark was; `syncInUse`: Personal sync
 * is connected; `level`: storageLevel(); `warnedToday`: today's warning was opened; `unavailable`: saving never worked
 * in this browser (blocked, or no room at all), which the startup dialog says. 1.40: `saving`, a refused change making
 * room; `resetLeft`, a Reset that left the database for the next start; `aside`, the latest earlier version kept
 * aside ({ day, at }) not opened yet.
 */
export function storageAlertView({ failing = false, syncMarkRefused = false, syncInUse = false, level = null, warnedToday = false, unavailable = false, saving = false, resetLeft = false, aside = null, locale, now = new Date() } = {}) {
  if (unavailable) return null;
  // 1.40: a refused change makes room first; meanwhile, neutral words, never the danger colour.
  if (saving && (failing || syncMarkRefused)) {
    return { kind: 'saving', pill: 'Saving…', label: `${SAVING_TITLE} ${SAVING_LEAD}`, title: SAVING_TITLE, lead: SAVING_LEAD, body: SAVING_BODY };
  }
  if (failing) {
    return {
      kind: 'full',
      pill: 'Not saved',
      label: `${FULL_TITLE} ${FULL_LEAD}`,
      title: FULL_TITLE,
      lead: FULL_LEAD,
      body: NO_MORE_ROOM
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
  if (resetLeft) return { kind: 'reset', pill: 'Reset not finished', label: `${RESET_LEFT_TITLE} ${RESET_LEFT_LEAD}`, title: RESET_LEFT_TITLE, lead: RESET_LEFT_LEAD, body: RESET_LEFT_BODY, action: 'data' };
  if (aside?.day) {
    const title = asideTitle(aside.day, { locale, now });
    return { kind: 'aside', pill: 'Earlier version kept', label: `${title} ${ASIDE_LEAD}`, title, lead: ASIDE_LEAD, body: ASIDE_BODY, action: 'data', at: aside.at || '' };
  }
  if (level?.warn && !warnedToday) {
    return {
      kind: 'warn',
      pill: `Storage about ${level.percent}% full`,
      label: `${warnSentence(level.percent)} ${WARN_LEAD}`,
      title: warnSentence(level.percent),
      lead: WARN_LEAD,
      body: LIMITED
    };
  }
  return null;
}

/**
 * How it works → Data on this device, the line under its text: { text, warning }. The real state: saving
 * unavailable from the start (blocked, or no room at all) until a change lands, a refused change, a refused sync
 * mark (for people who use sync), the warning from 80%, else saving available. 1.40, `archive` (the day store's
 * stats()): older days that can't be read ('unavailable', 'lost') come first after those; older days kept in the
 * database are said with saving available; earlier copies kept aside are said after it all.
 */
export function storageSafetyLine({ failing = false, syncMarkRefused = false, syncInUse = false, available = true, level = null, archive = null, resetLeft = false } = {}) {
  const aside = archive?.displaced ? ` ${keptAsideLine(archive.displaced)}` : '';
  if (!available) return { text: UNAVAILABLE, warning: true };
  if (failing) return { text: `${FULL_TITLE} ${FULL_LEAD} ${NO_MORE_ROOM}${aside}`, warning: true };
  if (syncMarkRefused && syncInUse) return { text: `${FULL_TITLE} ${SYNC_LEAD} ${NOTHING_LOST}${aside}`, warning: true };
  if (resetLeft) return { text: `${RESET_LEFT_TITLE} ${RESET_LEFT_LEAD} ${RESET_LEFT_BODY}`, warning: true };
  if (archive?.status === 'unavailable') return { text: `${ARCHIVE_UNAVAILABLE}${aside}`, warning: true };
  if (archive?.status === 'lost') return { text: `${ARCHIVE_LOST}${aside}`, warning: true };
  if (level?.warn) return { text: `${warnSentence(level.percent)} ${WARN_LEAD}${aside}`, warning: true };
  if (archive?.archived) return { text: `${ARCHIVE_IN_USE} ${AVAILABLE}${aside}`, warning: !!aside };
  return { text: `${AVAILABLE}${aside}`, warning: !!aside };
}

const count = n => Number(n || 0).toLocaleString('en');

/**
 * Data on this device, its figures (1.40): the planner's own data in localStorage, then every saved day, both homes,
 * and how many of them are older days kept in this browser's database (src/state/day-store.js stats()).
 */
export function storageUsageText({ bytes = 0, days = 0, archived = 0 } = {}) {
  const line = `${formatStorageBytes(bytes)} · ${count(days)} saved ${days === 1 ? 'day' : 'days'}`;
  return archived ? `${line} · ${count(archived)} older ${archived === 1 ? 'one' : 'ones'} kept in this browser’s database` : line;
}

const ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><ellipse cx="12" cy="6" rx="7" ry="2.8"/><path d="M5 6v12c0 1.55 3.13 2.8 7 2.8s7-1.25 7-2.8V6"/><path d="M5 12c0 1.55 3.13 2.8 7 2.8s7-1.25 7-2.8"/></svg>';

/** The popover's content (its title and lead name and describe the dialog). */
export function storagePopoverMarkup(view) {
  const actions = view.action === 'data'
    ? '<button class="primary-button" type="button" data-storage-alert-action="data"><span>Data on this device</span></button>'
    : '<button class="text-button" type="button" data-storage-alert-action="data">Data on this device</button><button class="primary-button" type="button" data-storage-alert-action="export"><span>Export backup</span></button>';
  return `<div class="sync-popover__head">
      <span class="storage-popover__icon" aria-hidden="true">${ICON}</span>
      <div><strong id="storage-alert-title">${esc(view.title)}</strong><span id="storage-alert-lead">${esc(view.lead)}</span></div>
    </div>
    <p id="storage-alert-body">${esc(view.body)}</p>
    <div class="sync-popover__actions">${actions}</div>`;
}

export function createStorageAlert({
  health,
  level = () => null,
  saving = () => false,
  syncInUse = () => false,
  unavailable = () => false,
  resetLeft = () => false,
  aside = () => null,
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
  // The latest earlier version kept aside, until it is opened (kept here too, as the warning's day is).
  let asideSeen = '';
  const seenAside = () => {
    let stored = '';
    try { stored = storage?.getItem(ASIDE_SEEN_KEY) || ''; } catch (_) {}
    return stored > asideSeen ? stored : asideSeen;
  };
  const unseenAside = () => {
    let last = null;
    try { last = aside(); } catch (_) {}
    return last?.day && String(last.at || '') > seenAside() ? last : null;
  };
  const markAsideSeen = at => {
    asideSeen = at;
    try { storage?.setItem(ASIDE_SEEN_KEY, at); } catch (_) {}
  };

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
    if (view.kind === 'aside') markAsideSeen(view.at);
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
    const next = storageAlertView({ failing: health.failing, syncMarkRefused: health.syncMarkRefused, syncInUse: syncInUse(), level: level(), warnedToday: warnedToday(), unavailable: unavailable(), saving: saving(), resetLeft: !!resetLeft(), aside: unseenAside(), now: now() });
    // An open warning, or earlier version kept aside, stays put until it is closed (it was marked seen as it opened),
    // unless something more pressing comes.
    const seen = kind => kind === 'warn' || kind === 'aside';
    if (popover && next?.kind !== view?.kind && !(seen(view?.kind) && (!next || seen(next.kind)))) close({ focus: focusedInside() });
    if (!popover) view = next;
    // A refused change (or sync mark) is told once as it starts, and once as it ends: never at each keystroke. Making
    // room (“Saving…”, a moment) is said only if it doesn't end saved; the calm notices, never.
    const urgent = view && (view.kind === 'full' || view.kind === 'sync') ? view.kind : '';
    if (live && urgent !== told) live.textContent = urgent ? view.label : told ? 'Your changes are being saved again.' : '';
    told = urgent;
    const hadFocus = doc.activeElement === trigger;
    const key = `${view?.kind || ''}|${view?.pill || ''}|${view?.label || ''}|${compact?.matches ? 'c' : 'w'}`;
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
