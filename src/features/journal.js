import { dateFromKey } from '../lib/dates.js';
import { esc, escAttr } from '../lib/text.js';

/**
 * The Journal (J): every day closed with a memory or a lesson, newest first,
 * 40 to a page (styles/core.css, “Journal”).
 *
 * Opening it reads the saved days once into a light index: each day's key
 * with its memory and lesson, trimmed. Days that hold neither are passed over
 * without being parsed, and nothing is normalised. Newer and Older are slices
 * of that index, so a page change reads nothing from storage. The index is
 * built again on the next opening, or at once when the plans change while the
 * Journal is open (an edit, an import, a sync pull: changed()).
 *
 * Only one page of rows is ever in the DOM, and one listener on the list
 * opens the day of any row.
 */

export const JOURNAL_PAGE_SIZE = 40;

const DAY_KEY = /^daily-planner:(\d{4}-\d{2}-\d{2})$/;
// A saved day whose memory or lesson has text in it. Days written by the planner (JSON.stringify) without one
// never match, so they are not parsed; a match is only a hint, confirmed on the parsed day.
const HAS_ENTRY = /"(?:memory|lesson)"\s*:\s*"\s*[^"\s]/;

const trimmed = value => (typeof value === 'string' ? value.trim() : '');

/** { day, memory, lesson } for a day with a memory or a lesson (trimmed), else null. */
function journalEntry(day, value) {
  if (!value || typeof value !== 'object') return null;
  const memory = trimmed(value.memory);
  const lesson = trimmed(value.lesson);
  return memory || lesson ? { day, memory, lesson } : null;
}

/**
 * The Journal's index: { day, memory, lesson } for every saved day with a
 * memory or a lesson, newest first. `keys` are storage keys (others than
 * daily-planner:YYYY-MM-DD are ignored) and `read(key)` returns a key's raw
 * string. The day on screen (`liveDay`) is taken from `liveState`, as the
 * planner holds it before it is saved, never from storage.
 */
export function buildJournalIndex({ keys = [], read = () => null, liveDay = '', liveState = null } = {}) {
  const entries = [];
  for (const key of keys) {
    const day = DAY_KEY.exec(key)?.[1];
    if (!day || day === liveDay) continue;
    const raw = read(key);
    if (typeof raw !== 'string' || !HAS_ENTRY.test(raw)) continue;
    let value = null;
    try { value = JSON.parse(raw); } catch (_) { continue; }
    const entry = journalEntry(day, value);
    if (entry) entries.push(entry);
  }
  const live = liveDay ? journalEntry(liveDay, liveState) : null;
  if (live) entries.push(live);
  return entries.sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0));
}

/** Page `page` of `entries` (clamped to the pages there are): its rows, where it starts, the last page. */
export function journalPage(entries, page = 0, size = JOURNAL_PAGE_SIZE) {
  const lastPage = Math.max(0, Math.ceil(entries.length / size) - 1);
  const current = Math.min(Math.max(0, Math.trunc(Number(page)) || 0), lastPage);
  const start = current * size;
  return { page: current, lastPage, start, rows: entries.slice(start, start + size), total: entries.length };
}

/** “1–40 of 132”. */
export const journalPageLabel = ({ start, rows, total }) => `${start + 1}–${Math.min(total, start + rows.length)} of ${total}`;

// Two formatters, made once: “Nov 10”, and “Nov 10, 2025” outside the current year.
let formatters = null;
function dateLabel(day, currentYear) {
  formatters ||= {
    short: new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }),
    long: new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
  };
  const date = dateFromKey(day);
  return (date.getFullYear() === currentYear ? formatters.short : formatters.long).format(date);
}

/** One row: the date (with its year outside `currentYear`), the memory, the lesson (a dash for what is missing). */
export function journalRowHtml({ day, memory, lesson }, { currentYear = new Date().getFullYear() } = {}) {
  const cell = text => (text ? `<strong>${esc(text)}</strong>` : '<em>—</em>');
  return `<button class="journal-row" type="button" data-journal-date="${escAttr(day)}"><time datetime="${escAttr(day)}">${esc(dateLabel(day, currentYear))}</time><span class="journal-cell">${cell(memory)}</span><span class="journal-cell journal-cell--lesson">${cell(lesson)}</span></button>`;
}

export const JOURNAL_EMPTY = '<div class="empty-state">Close a day with a memory or lesson and it will appear here.</div>';

/**
 * The Journal dialog. `store` is the planner's local store (keys(), get());
 * `liveDay()` and `liveState()` the day on screen; `openModal(modal, focus)`,
 * `closeModal(modal)` and `openDay(key)` come from the planner.
 */
export function createJournal({ store, liveDay, liveState, openModal, closeModal, openDay, doc = globalThis.document } = {}) {
  let index = null;
  let page = 0;
  let refreshQueued = false;
  const el = selector => doc.querySelector(selector);
  const modal = () => el('[data-journal-modal]');
  const isShown = () => { const node = modal(); return !!node && !node.hidden && node.classList.contains('is-open'); };

  function rebuild() {
    index = buildJournalIndex({ keys: store.keys('daily-planner:'), read: key => store.get(key), liveDay: liveDay(), liveState: liveState() });
    return index;
  }

  /** Draws the current page from the index (built first if the plans changed since). Returns the page drawn. */
  function render() {
    const list = el('[data-journal-list]');
    if (!list) return null;
    const pagination = el('[data-journal-pagination]');
    const newer = el('[data-journal-newer]');
    const older = el('[data-journal-load-more]');
    // Where keyboard focus was (a row, by its day, or Newer/Older): it comes back there once the page is drawn anew.
    const active = doc.activeElement;
    const focusedDay = active && list.contains(active) ? active.closest?.('[data-journal-date]')?.dataset.journalDate || '' : '';
    const focusedButton = active && (active === newer || active === older) ? active : null;
    const view = journalPage(index || rebuild(), page);
    page = view.page;
    if (!view.total) {
      list.innerHTML = JOURNAL_EMPTY;
      if (pagination) pagination.hidden = true;
      if (focusedDay || focusedButton) modal()?.querySelector?.('.modal__close')?.focus({ preventScroll: true });
      return view;
    }
    const currentYear = new Date().getFullYear();
    list.innerHTML = view.rows.map(entry => journalRowHtml(entry, { currentYear })).join('');
    if (pagination) pagination.hidden = view.total <= JOURNAL_PAGE_SIZE;
    const label = el('[data-journal-page-label]');
    if (newer) newer.disabled = view.page === 0;
    if (older) older.disabled = view.page >= view.lastPage;
    if (label) label.textContent = journalPageLabel(view);
    if (focusedDay || focusedButton) {
      const usable = button => button && !button.disabled && !pagination?.hidden;
      const row = focusedDay ? [...list.querySelectorAll('[data-journal-date]')].find(node => node.dataset.journalDate === focusedDay) : null;
      // The same row; else the button that had focus, or the other one once it is disabled; else the first row.
      const target = row || [focusedButton, older, newer].find(usable) || list.querySelector('[data-journal-date]');
      if (target && target !== doc.activeElement) target.focus({ preventScroll: true });
    }
    return view;
  }

  /** Opens on the newest page, or on the page that holds `day` (from Search). */
  function open({ day = '' } = {}) {
    const entries = rebuild();
    const at = day ? entries.findIndex(entry => entry.day === day) : -1;
    page = at > 0 ? Math.floor(at / JOURNAL_PAGE_SIZE) : 0;
    render();
    const row = at >= 0 ? el('[data-journal-list]')?.querySelector(`[data-journal-date="${day}"]`) : null;
    openModal(modal(), row || null);
    if (row) globalThis.requestAnimationFrame?.(() => row.scrollIntoView?.({ block: 'center' }));
  }

  function turn(step) {
    page += step;
    render();
  }

  /**
   * The plans changed (a saved day, an import, a sync pull). The index is
   * dropped; while the Journal is open it is built again and the page redrawn,
   * once for a burst of changes.
   */
  function changed() {
    index = null;
    if (refreshQueued || !isShown()) return;
    refreshQueued = true;
    setTimeout(() => {
      refreshQueued = false;
      if (isShown()) render();
    }, 0);
  }

  /** From the store's onMutation: only planner days count. */
  function noteMutation(mutation) {
    if (DAY_KEY.test(String(mutation?.key || ''))) changed();
  }

  el('[data-journal-list]')?.addEventListener('click', event => {
    const row = event.target?.closest?.('[data-journal-date]');
    if (!row) return;
    closeModal(modal());
    openDay(row.dataset.journalDate);
  });
  el('[data-journal-load-more]')?.addEventListener('click', () => turn(1));
  el('[data-journal-newer]')?.addEventListener('click', () => turn(-1));

  return { open, render, changed, noteMutation, page: () => page, isIndexed: () => !!index };
}
