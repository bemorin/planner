// The anonymous usage counts on the owner dashboard.
//
// The owner's own browsers stay out of them. Signing in to the dashboard, and
// every load of it signed in, switches the counts off in this browser: the
// planner's and the public pages' shared choice (USAGE_COUNTS_KEY in
// src/lib/planner-api.js, same origin), so visits and planner use from here
// are never counted. The header says so, with
// a switch to count this browser again (remembered in OWNER_COUNTED_KEY, so
// the next load leaves it on).
//
// “Start fresh” (the end of Trends) deletes the counts recorded so far,
// once the owner typed RESET in a dialog that says what goes (rows, counts,
// days): POST admin/usage-counts/reset { confirm: 'RESET' }, checked by the
// server too. Questions, the waitlist, feedback and reviews are never touched.
//
// The HTML builders and the words are pure and unit-tested
// (tests/admin-usage-counts.test.js); openFreshStartDialog wires a native
// <dialog> (focus kept inside, Escape cancels) and resolves with true or false.

import { setUsageCountsEnabled, usageCountsEnabled } from '../src/lib/planner-api.js';

const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
const defaultNumber = value => new Intl.NumberFormat('en-US').format(Number(value) || 0);
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
/** This browser's localStorage, or null when site data is blocked (reading it throws then). */
const browserStorage = () => { try { return globalThis.localStorage; } catch (_) { return null; } };

/** Set (to 'on') once the owner chose to count this browser again from the dashboard. */
export const OWNER_COUNTED_KEY = 'daily-planner-owner-counted';

/** What the owner types, and what the server is sent, to delete the counts. */
export const RESET_WORD = 'RESET';

// ---- This browser ------------------------------------------------------------

/**
 * On sign-in and on every load signed in: the counts go off in this browser,
 * unless the owner chose to count it here. Answers whether it is counted.
 */
export function keepBrowserOut(storage = browserStorage()) {
  let chosen = false;
  try { chosen = storage?.getItem(OWNER_COUNTED_KEY) === 'on'; } catch (_) { chosen = false; }
  if (!chosen) setUsageCountsEnabled(false, storage);
  return usageCountsEnabled(storage);
}

/** The header's switch: count this browser again (`on`), or keep it out. Answers whether it is counted. */
export function countBrowser(on, storage = browserStorage()) {
  try {
    if (on) storage?.setItem(OWNER_COUNTED_KEY, 'on');
    else storage?.removeItem(OWNER_COUNTED_KEY);
  } catch (_) {}
  setUsageCountsEnabled(!!on, storage);
  return usageCountsEnabled(storage);
}

/** The header line's words: { title, detail }. */
export function browserLine(counted) {
  return counted
    ? { title: 'This browser is counted', detail: 'Its visits and planner use count like anyone’s.' }
    : { title: 'This browser isn’t counted', detail: 'Visits and planner use from here stay out of the figures.' };
}

// ---- Start fresh -------------------------------------------------------------------

/** Typed as the dialog asks, give or take case and spaces: “reset”, “ RESET ”. */
export const resetMatches = text => String(text ?? '').trim().toUpperCase() === RESET_WORD;

/** The counts the server answered ({ rows, count, firstDay, lastDay }), read defensively; null without them. */
export function readCounts(value) {
  if (!value || typeof value !== 'object') return null;
  const whole = number => Math.max(0, Math.floor(Number(number) || 0));
  const day = text => (DAY_RE.test(String(text ?? '')) ? String(text) : '');
  const firstDay = day(value.firstDay);
  const lastDay = day(value.lastDay) || firstDay;
  return { rows: whole(value.rows), count: whole(value.count), firstDay, lastDay: lastDay < firstDay ? firstDay : lastDay };
}

/** “3–23 Oct 2026”, “23 Oct 2026”: the days the counts cover (UTC days, as stored). */
export function dayRange(firstDay, lastDay, locale = undefined) {
  if (!DAY_RE.test(String(firstDay || ''))) return '';
  const date = day => new Date(`${day}T00:00:00Z`);
  const format = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
  if (!lastDay || lastDay === firstDay) return format.format(date(firstDay));
  try { return format.formatRange(date(firstDay), date(lastDay)); } catch (_) { return `${format.format(date(firstDay))} – ${format.format(date(lastDay))}`; }
}

/** “1,234 counts in 210 rows”. */
const countWords = (counts, number) => `${number(counts.count)} ${counts.count === 1 ? 'count' : 'counts'} in ${number(counts.rows)} ${counts.rows === 1 ? 'row' : 'rows'}`;

const KEPT = 'Questions, the waitlist, feedback and reviews stay as they are.';

/**
 * The card at the end of Trends (HTML, every value escaped): what Start fresh
 * does, what is recorded now and the button. `counts`: readCounts() of the
 * summary, null when they couldn't be read. `result`: { text, error } under it.
 */
export function freshStartHtml(counts, { number = defaultNumber, range = dayRange, result = null } = {}) {
  const days = counts?.rows ? range(counts.firstDay, counts.lastDay) : '';
  const now = !counts ? 'The counts could not be read.' : counts.rows ? countWords(counts, number) : 'Nothing counted yet';
  return `<section class="owner-card owner-fresh" aria-labelledby="owner-fresh-title">
      <header>
        <h2 id="owner-fresh-title">Start fresh</h2>
        <p>Deletes the anonymous usage counts recorded so far, test runs included, so Trends, conversion and the other signals start again from today. ${esc(KEPT)} Browsers where you signed in here are already left out.</p>
      </header>
      <div class="owner-fresh__side">
        <p class="owner-fresh__now"><span>Recorded so far</span><b data-owner-fresh-now>${esc(now)}</b>${days ? `<small>${esc(days)}</small>` : ''}</p>
        <button class="secondary-button" type="button" data-owner-fresh-start${counts?.rows ? '' : ' disabled'}>Start fresh…</button>
      </div>
      <p class="owner-result${result?.error ? ' is-error' : ''}" data-owner-fresh-result role="status" aria-live="polite" tabindex="-1"${result?.text ? '' : ' hidden'}>${esc(result?.text || '')}</p>
    </section>`;
}

/** The dialog's form: what goes (rows, counts, days), what stays, and RESET to type. */
export function freshDialogHtml(counts, { number = defaultNumber, range = dayRange } = {}) {
  const days = range(counts.firstDay, counts.lastDay);
  return `<form class="owner-subform owner-tests-dialog owner-fresh-dialog" data-owner-fresh-form novalidate>
      <div class="owner-subform__head"><h2 id="owner-fresh-dialog-title">Start fresh?</h2>
        <p>This deletes the anonymous usage counts recorded so far: <b>${esc(countWords(counts, number))}</b>${days ? `, ${esc(days)}` : ''}.</p></div>
      <ul class="owner-tests__list">
        <li>Trends, conversion, usage by section and the other signals start again from zero. Counting goes on from now.</li>
        <li>${esc(KEPT)}</li>
        <li>It can’t be undone.</li>
      </ul>
      <label class="form-field"><span>Type <b>${RESET_WORD}</b> to confirm</span><input name="confirm" autocomplete="off" autocapitalize="characters" spellcheck="false"></label>
      <p class="owner-result is-error" data-owner-fresh-error role="alert" hidden></p>
      <div class="owner-actions"><button class="primary-button owner-danger" type="submit" disabled>Delete ${esc(number(counts.rows))} ${counts.rows === 1 ? 'row' : 'rows'}</button><button class="text-button" type="button" data-owner-fresh-cancel>Cancel</button></div>
    </form>`;
}

/** What to say once it is done, from the server's answer ({ deleted, counts }). */
export function freshDoneText(answer, { number = defaultNumber, range = dayRange } = {}) {
  const deleted = readCounts(answer?.deleted);
  if (!deleted?.rows) return 'Nothing to delete: no counts were recorded. Counting goes on from now.';
  const days = range(deleted.firstDay, deleted.lastDay);
  return `Started fresh: ${countWords(deleted, number)} deleted${days ? ` (${days})` : ''}. Counting goes on from now.`;
}

let dialog = null;

/** Opens the dialog for `counts` and resolves with true once RESET was typed and confirmed, else false. */
export function openFreshStartDialog(counts, options = {}) {
  if (!dialog) {
    dialog = document.createElement('dialog');
    dialog.className = 'owner-dialog owner-dialog--fresh';
    dialog.setAttribute('aria-labelledby', 'owner-fresh-dialog-title');
    document.body.append(dialog);
  }
  dialog.innerHTML = freshDialogHtml(counts, options);
  const form = dialog.querySelector('[data-owner-fresh-form]');
  const submit = form.querySelector('button[type="submit"]');
  const input = form.elements.confirm;
  const error = dialog.querySelector('[data-owner-fresh-error]');
  return new Promise(resolve => {
    let confirmed = false;
    const finish = () => { dialog.removeEventListener('close', finish); resolve(confirmed); };
    dialog.addEventListener('close', finish);
    dialog.querySelector('[data-owner-fresh-cancel]').addEventListener('click', () => dialog.close());
    input.addEventListener('input', () => {
      submit.disabled = !resetMatches(input.value);
      error.hidden = true;
    });
    form.addEventListener('submit', event => {
      event.preventDefault();
      if (!resetMatches(input.value)) {
        error.textContent = `Type ${RESET_WORD} to confirm.`;
        error.hidden = false;
        input.focus();
        return;
      }
      confirmed = true;
      dialog.close();
    });
    dialog.showModal();
    input.focus();
  });
}
