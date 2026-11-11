import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JOURNAL_EMPTY, JOURNAL_PAGE_SIZE, buildJournalIndex, createJournal, journalPage, journalPageLabel, journalRowHtml } from '../src/features/journal.js';
import { fakeDocument } from './support/fake-dom.js';

// The Journal (1.39.3): a light index built once per opening, pages sliced from it, one page of rows in the DOM.

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const key = day => `daily-planner:${day}`;

/** A store over a plain object that counts what it reads. */
function countingStore(entries) {
  const data = new Map(Object.entries(entries));
  const reads = { keys: 0, get: 0 };
  return {
    reads,
    data,
    keys(prefix = '') { reads.keys += 1; return [...data.keys()].filter(item => item.startsWith(prefix)); },
    get(name) { reads.get += 1; return data.has(name) ? data.get(name) : null; }
  };
}

test('the index: newest first, memory and lesson trimmed, days with neither left out', () => {
  const days = {
    [key('2026-03-02')]: JSON.stringify({ memory: '  Walk by the river \n', lesson: '' }),
    [key('2026-03-05')]: JSON.stringify({ memory: '', lesson: '\tSay no earlier ' }),
    [key('2025-12-31')]: JSON.stringify({ memory: 'Last of the year', lesson: 'Rest' }),
    [key('2026-03-04')]: JSON.stringify({ memory: '   ', lesson: '\n\n' }),
    [key('2026-03-03')]: JSON.stringify({ focus: 'no journal here', priorities: [], tasks: [] }),
    [key('2026-03-06')]: JSON.stringify({ memory: 42, lesson: null }),
    [key('2026-03-07')]: '{not json',
    [key('2026-03-08')]: JSON.stringify({ notes: 'I wrote "memory":"x" in my notes', memory: '', lesson: '' }),
    [key('2026-03-09')]: JSON.stringify({ reflection: { memory: 'nested, not the day’s' }, memory: '', lesson: '' }),
    'daily-planner:settings': JSON.stringify({ memory: 'not a day' }),
    'daily-planner:2026-3-1': JSON.stringify({ memory: 'not a day key' }),
    'daily-planner-ui:tips': JSON.stringify({ memory: 'not the planner' })
  };
  const store = countingStore(days);
  const index = buildJournalIndex({ keys: store.keys(''), read: name => store.get(name) });
  assert.deepEqual(index, [
    { day: '2026-03-05', memory: '', lesson: 'Say no earlier' },
    { day: '2026-03-02', memory: 'Walk by the river', lesson: '' },
    { day: '2025-12-31', memory: 'Last of the year', lesson: 'Rest' }
  ]);
});

test('the index: the day on screen is taken as the planner holds it, saved or not', () => {
  const days = {
    [key('2026-03-01')]: JSON.stringify({ memory: 'Older', lesson: '' }),
    [key('2026-03-02')]: JSON.stringify({ memory: 'Saved earlier', lesson: 'Saved lesson' })
  };
  const keys = Object.keys(days);
  const readDay = name => days[name] ?? null;
  // Live state with a memory not saved yet, on a day storage doesn't hold.
  assert.deepEqual(buildJournalIndex({ keys, read: readDay, liveDay: '2026-03-03', liveState: { memory: ' Not saved yet ', lesson: '' } })[0], { day: '2026-03-03', memory: 'Not saved yet', lesson: '' });
  // Live state replaces what storage holds for that day…
  assert.deepEqual(buildJournalIndex({ keys, read: readDay, liveDay: '2026-03-02', liveState: { memory: 'Edited', lesson: '' } }).map(entry => [entry.day, entry.memory, entry.lesson]), [['2026-03-02', 'Edited', ''], ['2026-03-01', 'Older', '']]);
  // …even when it has emptied it.
  assert.deepEqual(buildJournalIndex({ keys, read: readDay, liveDay: '2026-03-02', liveState: { memory: '', lesson: ' ' } }).map(entry => entry.day), ['2026-03-01']);
  assert.deepEqual(buildJournalIndex({ keys, read: readDay, liveDay: '2026-03-02', liveState: null }).map(entry => entry.day), ['2026-03-01']);
});

test('the index: a day without a memory or a lesson is not even parsed', () => {
  const days = {};
  for (let i = 1; i <= 28; i += 1) {
    const day = `2026-02-${String(i).padStart(2, '0')}`;
    // As the planner saves a day: "memory":"" and "lesson":"" are always there.
    days[key(day)] = JSON.stringify({ focus: 'x', priorities: [], tasks: [], notes: '', blocks: [], endedAt: '', memory: i % 7 === 0 ? 'Week done' : '', lesson: i === 3 ? '  Ask sooner' : '' });
  }
  const parse = JSON.parse;
  let parsed = 0;
  JSON.parse = (...args) => { parsed += 1; return parse(...args); };
  let index;
  try { index = buildJournalIndex({ keys: Object.keys(days), read: name => days[name] }); } finally { JSON.parse = parse; }
  assert.equal(index.length, 5);
  assert.equal(parsed, 5, 'only the five days with an entry');
});

test('pages: 40 rows at most, clamped to the pages there are, with “1–40 of N”', () => {
  const entries = Array.from({ length: 95 }, (_, i) => ({ day: `day-${i}`, memory: 'm', lesson: '' }));
  assert.equal(JOURNAL_PAGE_SIZE, 40);
  const first = journalPage(entries, 0);
  assert.deepEqual([first.page, first.lastPage, first.start, first.rows.length, first.total], [0, 2, 0, 40, 95]);
  assert.equal(journalPageLabel(first), '1–40 of 95');
  const last = journalPage(entries, 2);
  assert.deepEqual([last.start, last.rows.length, last.rows[0].day], [80, 15, 'day-80']);
  assert.equal(journalPageLabel(last), '81–95 of 95');
  assert.equal(journalPage(entries, 9).page, 2, 'past the end: the last page');
  assert.equal(journalPage(entries, -3).page, 0);
  assert.deepEqual(journalPage([], 4), { page: 0, lastPage: 0, start: 0, rows: [], total: 0 });
});

test('a row: the date with its year outside the current one, the entries escaped, a dash for what is missing', () => {
  const row = journalRowHtml({ day: '2026-03-05', memory: 'Fish & <chips>', lesson: '' }, { currentYear: 2026 });
  assert.match(row, /^<button class="journal-row" type="button" data-journal-date="2026-03-05"><time datetime="2026-03-05">[^<]+<\/time>/);
  assert.doesNotMatch(row.match(/<time[^>]*>([^<]+)<\/time>/)[1], /2026/, 'this year: no year');
  assert.match(row, /<span class="journal-cell"><strong>Fish &amp; &lt;chips&gt;<\/strong><\/span>/);
  assert.match(row, /<span class="journal-cell journal-cell--lesson"><em>—<\/em><\/span><\/button>$/);
  const past = journalRowHtml({ day: '2024-12-31', memory: '', lesson: 'Rest' }, { currentYear: 2026 });
  assert.match(past.match(/<time[^>]*>([^<]+)<\/time>/)[1], /2024/, 'another year: shown');
  assert.match(past, /<span class="journal-cell"><em>—<\/em><\/span>/);
});

/** The Journal dialog on a stand-in DOM, over `days` (key → saved day). */
function journalOn(days, { liveDay = '2099-01-01', liveState = null } = {}) {
  const doc = fakeDocument();
  const modal = doc.make('[data-journal-modal]');
  modal.hidden = true;
  const list = doc.make('[data-journal-list]');
  const pagination = doc.make('[data-journal-pagination]');
  const newer = doc.make('[data-journal-newer]');
  const older = doc.make('[data-journal-load-more]');
  const label = doc.make('[data-journal-page-label]');
  const store = countingStore(days);
  const calls = { open: 0, close: 0, days: [] };
  const live = { day: liveDay, state: liveState };
  const journal = createJournal({
    store,
    doc,
    liveDay: () => live.day,
    liveState: () => live.state,
    openModal: node => { calls.open += 1; node.hidden = false; node.classList.add('is-open'); },
    closeModal: node => { calls.close += 1; node.classList.remove('is-open'); node.hidden = true; },
    openDay: day => calls.days.push(day)
  });
  return { journal, doc, modal, list, pagination, newer, older, label, store, calls, live };
}

const manyDays = count => Object.fromEntries(Array.from({ length: count }, (_, i) => {
  const date = new Date(2026, 0, 1 + i, 12);
  const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  return [key(day), JSON.stringify({ memory: `Memory ${i}`, lesson: i % 2 ? '' : `Lesson ${i}` })];
}));
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

test('opening reads storage once; a page change reads nothing and keeps one page of rows in the DOM', async () => {
  const days = manyDays(130);
  const { journal, list, pagination, newer, older, label, store, calls, modal } = journalOn(days);
  journal.open();
  assert.equal(calls.open, 1);
  assert.equal(modal.hidden, false);
  assert.equal(store.reads.keys, 1, 'the keys, once');
  assert.equal(store.reads.get, 130, 'each day, once');
  assert.equal(list.children.length, 40);
  assert.equal(list.children[0].dataset.journalDate, '2026-05-10', 'newest first');
  assert.equal(label.textContent, '1–40 of 130');
  assert.equal(pagination.hidden, false);
  assert.deepEqual([newer.disabled, older.disabled], [true, false]);

  const before = { ...store.reads };
  await older.click();
  assert.deepEqual(store.reads, before, 'Older reads nothing from storage');
  assert.equal(label.textContent, '41–80 of 130');
  assert.equal(list.children.length, 40);
  await older.click();
  await older.click();
  assert.equal(label.textContent, '121–130 of 130');
  assert.equal(list.children.length, 10);
  assert.deepEqual([newer.disabled, older.disabled], [false, true]);
  await older.click();
  assert.equal(label.textContent, '121–130 of 130', 'no page past the last');
  await newer.click();
  assert.equal(label.textContent, '81–120 of 130');
  assert.deepEqual(store.reads, before, 'Newer reads nothing either');

  // Opened again: read afresh, on the newest page.
  journal.open();
  assert.equal(store.reads.keys, 2);
  assert.equal(label.textContent, '1–40 of 130');
});

test('one listener on the list opens the day of any row', async () => {
  const { journal, list, calls } = journalOn(manyDays(3));
  journal.open();
  const row = list.children[1];
  await list.dispatch('click', { target: row });
  assert.equal(calls.close, 1);
  assert.deepEqual(calls.days, [row.dataset.journalDate]);
  await list.dispatch('click', { target: list });
  assert.deepEqual(calls.days, [row.dataset.journalDate], 'a click beside the rows does nothing');
});

test('plans that change while the Journal is open rebuild it once, on the page it shows; closed, nothing is read', async () => {
  const days = manyDays(50);
  const { journal, list, label, store, calls, modal, older, newer } = journalOn(days);
  journal.open();
  await older.click();
  assert.equal(label.textContent, '41–50 of 50');
  const opened = { ...store.reads };
  // An import or a sync pull writes many days at once: one rebuild.
  store.data.set(key('2026-06-01'), JSON.stringify({ memory: 'Imported', lesson: '' }));
  store.data.set(key('2026-06-02'), JSON.stringify({ memory: '', lesson: 'Synced' }));
  journal.noteMutation({ type: 'set', key: key('2026-06-01') });
  journal.noteMutation({ type: 'set', key: key('2026-06-02') });
  journal.changed();
  assert.deepEqual(store.reads, opened, 'not read in the middle of the burst');
  await tick();
  assert.equal(store.reads.keys, opened.keys + 1, 'read once after it');
  assert.equal(label.textContent, '41–52 of 52', 'still on the second page');
  await newer.click();
  assert.equal(list.children[0].dataset.journalDate, '2026-06-02');

  // Settings and other keys are not plans.
  journal.noteMutation({ type: 'set', key: 'daily-planner:settings' });
  journal.noteMutation({ type: 'set', key: 'daily-planner-ui:tips' });
  await tick();
  assert.equal(store.reads.keys, opened.keys + 1);

  // Closed: the index is dropped, nothing is read until the next opening.
  await list.dispatch('click', { target: list.children[0] });
  assert.equal(calls.close, 1);
  assert.equal(modal.hidden, true);
  const closed = { ...store.reads };
  journal.noteMutation({ type: 'remove', key: key('2026-06-01') });
  journal.changed();
  await tick();
  assert.deepEqual(store.reads, closed);
  assert.equal(journal.isIndexed(), false);
});

test('the day on screen leads when it has an entry; with no entry at all the Journal says how to start one', () => {
  const live = journalOn({ [key('2026-01-01')]: JSON.stringify({ memory: 'Saved', lesson: '' }) }, { liveDay: '2026-01-02', liveState: { memory: 'Today, not saved yet', lesson: '' } });
  live.journal.open();
  assert.equal(live.list.children[0].dataset.journalDate, '2026-01-02');
  assert.equal(live.pagination.hidden, true, 'one page: no pagination');

  const empty = journalOn({ [key('2026-01-01')]: JSON.stringify({ memory: '', lesson: '' }) });
  empty.journal.open();
  assert.equal(empty.list.innerHTML, JOURNAL_EMPTY);
  assert.equal(empty.pagination.hidden, true);
});

test('the planner opens the Journal through the index, and never reads every day for it', () => {
  const app = read('app.js');
  assert.match(app, /import \{ createJournal \} from '\.\/src\/features\/journal\.js';/);
  assert.doesNotMatch(app, /function (?:journalDays|renderJournal)\b/);
  assert.match(app, /onMutation: mutation => \{[\s\S]{0,300}?journal\?\.noteMutation\(mutation\);/, 'a saved day reaches the Journal');
  assert.match(app, /function reloadPlannerAfterSync\(\) \{\s*reloadSettings\(\); load\(\); journal\?\.changed\(\);/, 'so does a sync pull');
  assert.match(app, /j: \(\) => toggleModalShortcut\('\[data-journal-modal\]', openJournal\)/, 'J');
  assert.match(read('sw.js'), /'\.\/src\/features\/journal\.js'/);
});

test('the Journal is wider on a desktop screen, between the default dialog and Insights; phones stack each day, labels alike', () => {
  const html = read('index.html');
  const css = read('styles/core.css');
  assert.match(html, /<div class="modal modal--journal" data-journal-modal hidden>/);
  const wide = css.slice(css.lastIndexOf('@media (min-width: 621px) {'));
  const width = Number(/\.modal--journal \.modal__panel \{ width: min\(100%, ([\d.]+)rem\); \}/.exec(wide)?.[1]);
  assert.ok(width >= 52 && width <= 58, `52–58rem, not ${width}`);
  assert.match(wide, /\.journal-cell strong \{[^}]*-webkit-line-clamp: 3;/, 'long entries: three lines');
  assert.match(css, /\.journal-columns-head \{\n {2}position: sticky;\n {2}top: 0;/, 'sticky column labels');
  // Phones: each day's memory above its lesson beside the date, and the labels over that one column (no empty third).
  assert.match(css, /@media \(max-width: 620px\) \{\n {2}\.journal-columns-head,\n {2}\.journal-row \{ grid-template-columns: 64px minmax\(0,1fr\); gap: 8px; \}/);
  assert.match(css, /\.journal-columns-head strong \+ strong::before \{ content: "\\00b7";/, '“Best memory · Lesson learned”');
});

test('a redraw while the Journal is open gives keyboard focus back: the same row, else Newer or Older', async () => {
  const days = manyDays(60);
  const { journal, doc, list, older, newer, store } = journalOn(days);
  journal.open();
  // Focus on a row; a sync pull adds a newer day: the same day keeps focus, though it moved down a place.
  const row = list.children[3];
  row.focus();
  store.data.set(key('2026-07-01'), JSON.stringify({ memory: 'Pulled', lesson: '' }));
  journal.changed();
  await tick();
  assert.equal(doc.activeElement?.dataset?.journalDate, row.dataset.journalDate);
  assert.notEqual(doc.activeElement, row, 'a new element: the list was drawn anew');
  // That day removed meanwhile: Older, which can still be pressed.
  const focusedDay = doc.activeElement.dataset.journalDate;
  store.data.delete(key(focusedDay));
  journal.changed();
  await tick();
  assert.equal(doc.activeElement, older);
  // Older to the last page: it can't be pressed any more, so Newer takes focus.
  older.focus();
  await older.click();
  assert.equal(older.disabled, true);
  assert.equal(doc.activeElement, newer);
});
