import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fakeDocument } from './support/fake-dom.js';
import { LOST_DAY, OPENING, UNAVAILABLE_DAY, createArchiveKeeper, pendingText } from '../src/features/archive-keeper.js';

// The planner's side of the archive (1.40, src/features/archive-keeper.js): a day in view that isn't loaded yet is
// read-only, with a line saying why, and the planner draws it again once it is.

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

function view() {
  const doc = fakeDocument();
  const workspace = doc.make('[data-workspace]');
  const note = doc.make('[data-day-opening]');
  note.hidden = true;
  return { doc, workspace, note };
}

test('a day in view that may be archived and isn’t loaded: inert, “Opening this day…”, the archive asked for; drawn again once loaded', () => {
  const { doc, workspace, note } = view();
  let status = 'loading';
  const pending = new Set(['daily-planner:2024-03-04']);
  let asked = 0;
  const reloads = [];
  const refreshes = [];
  const store = { pending: key => pending.has(key), status: () => status, ready: () => { asked += 1; return Promise.resolve(status); } };
  const keeper = createArchiveKeeper({ store, doc, reload: () => reloads.push('load'), refresh: () => refreshes.push('refresh') });
  assert.equal(keeper.guard(['daily-planner:2026-11-12']), false);
  assert.deepEqual([workspace.inert, note.hidden], [false, true]);
  assert.equal(keeper.guard(['daily-planner:2026-11-12', 'daily-planner:2024-03-04']), true, 'one day of the week is enough');
  assert.deepEqual([workspace.inert, note.hidden, note.textContent, asked], [true, false, OPENING, 1]);
  assert.equal(keeper.viewPending, true, 'Close day waits too (app.js handleEndDayButton)');
  pending.clear();
  status = 'ready';
  keeper.loaded();
  assert.deepEqual([reloads, refreshes], [['load'], ['refresh']], 'what reads history starts again, the day is drawn');
  assert.equal(keeper.guard(['daily-planner:2024-03-04']), false);
  assert.deepEqual([workspace.inert, note.hidden], [false, true]);
  keeper.loaded();
  assert.deepEqual(reloads, ['load'], 'drawn again only when it waited');
});

test('what the view says while a day can’t be read', () => {
  assert.equal(pendingText('loading'), 'Opening this day…');
  assert.equal(pendingText('unavailable'), UNAVAILABLE_DAY);
  assert.equal(pendingText('lost'), LOST_DAY);
  assert.match(UNAVAILABLE_DAY, /Reload the planner to try again\.$/);
  assert.match(LOST_DAY, /which doesn’t have it now\. Sync now, or import a backup, to bring it back\.$/);
});

test('the archive loads once the planner shows, at idle, and only if anything was archived', async () => {
  const idle = [];
  const win = { requestIdleCallback: fn => idle.push(fn) };
  let asked = 0;
  let ready = false;
  const store = { isReady: () => ready, ready: () => { asked += 1; return Promise.resolve('ready'); } };
  let shown;
  createArchiveKeeper({ store, doc: view().doc, win }).start({ whenShown: callback => { shown = callback; } });
  assert.equal(idle.length, 0, 'not before the planner shows');
  shown();
  assert.equal(asked, 0, 'not before the browser is idle');
  idle.shift()();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(asked, 1);
  ready = true;
  createArchiveKeeper({ store, doc: view().doc, win }).start({ whenShown: callback => callback() });
  idle.shift()();
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(asked, 1, 'nothing to load: nothing asked');
});

test('app.js: history waits for the archive once, and the days in view are guarded on every render', () => {
  const app = read('app.js');
  assert.match(app, /const store = createDayStore\(browserStorage, \{/);
  assert.match(app, /const afterHistory = fn => \(\.\.\.args\) => \(store\.isReady\(\) \? fn\(\.\.\.args\) : void store\.ready\(\)\.then\(\(\) => fn\(\.\.\.args\)\)\);/);
  for (const opener of ['openSearchModal', 'exportPlannerBackup', 'openHorizon', 'openUnresolvedModal', 'openJournal', 'openStats', 'openQuarterCheckIn']) assert.match(app, new RegExp(`const ${opener} = afterHistory\\(`), opener);
  assert.match(app, /function renderClosedDayProgress\(\) \{\n\s*if \(!store\.isReady\(\)\) return void store\.ready\(\)\.then\(renderClosedDayProgress\);/);
  assert.match(app, /if \(store\.isReady\(\) && sponsorMoment\.maybeOpen\(/);
  assert.match(app, /function render\(\) \{\n\s*archiveKeeper\.guard\(archiveKeeper\.inView\(\)\.map\(day => `daily-planner:\$\{day\}`\)\);/);
  assert.match(app, /inView: \(\) => \[ymd\(\), \.\.\.\(plannerRangeView === 'week' \? planningWeekDates\(date\)\.map\(day => ymd\(day\)\) : \[\]\)\]/, 'the Day, or the planning week');
  assert.match(app, /refresh: \(\) => \{ journal\?\.changed\(\); insightsFeature\.invalidate\(\); progressCache\.model = null; renderStorageState\(\); \}/);
  assert.match(app, /if \(ymd\(date\) > ymd\(new Date\(\)\) \|\| archiveKeeper\.viewPending\) return;/);
  const html = read('index.html');
  assert.match(html, /<p class="day-opening" data-day-opening role="status" hidden>Opening this day…<\/p>\n\s*<section class="workspace" data-workspace>/);
  const sw = read('sw.js');
  for (const module of ['src/state/day-store.js', 'src/state/day-archive.js', 'src/state/day-placement.js', 'src/features/archive-keeper.js']) assert.ok(sw.includes(`'./${module}'`), `${module} cached for offline use`);
});

// ---------------------------------------------------------------------------
// Passes (1.40 step 4): when room is made, alone across tabs, never under an older tab, and what is said meanwhile.
// ---------------------------------------------------------------------------

const { ARCHIVE_LOCK, LEASE_KEY, TAB_LOCK, atLeast } = await import('../src/features/archive-keeper.js');
const { createBrowser } = await import('./support/archive-tabs.js');
const { HISTORY_TODAY, historyDays } = await import('./support/history.js');
const { ARCHIVE_BUDGET } = await import('../src/state/day-placement.js');

/** Web Locks as browsers have them, for one origin: exclusive and shared, ifAvailable, and a signal to stop waiting. */
function fakeLocks() {
  const held = [];
  const free = (name, mode) => !held.some(lock => lock.name === name && (lock.mode === 'exclusive' || mode === 'exclusive'));
  return {
    held,
    async request(name, options, callback) {
      if (!free(name, options.mode)) {
        if (options.ifAvailable) return callback(null);
        while (!free(name, options.mode)) {
          if (options.signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
          await new Promise(resolve => setTimeout(resolve, 5));
        }
      }
      const lock = { name, mode: options.mode || 'exclusive' };
      held.push(lock);
      try { return await callback(lock); } finally { held.splice(held.indexOf(lock), 1); }
    },
    async query() { return { held: held.map(({ name, mode }) => ({ name, mode })) }; }
  };
}

/** A service worker that answers the roll call with `windows` and `version`, or not at all (a worker before 1.40). */
const worker = ({ windows = 1, version = '1.40.0', answers = true } = {}) => ({
  postMessage(message, [port]) {
    if (!answers || message?.type !== 'planner-windows') return;
    setTimeout(() => port.postMessage({ type: 'planner-windows', windows, version }), 1);
  }
});

function keeperFor({ days = historyDays(700), nav = {}, localDev = false, ...options } = {}) {
  const browser = createBrowser({ days });
  const locks = nav.locks === null ? undefined : nav.locks || fakeLocks();
  // The archive lock is the store's (src/state/day-store.js exclusive()); the keeper's roll call reads the same locks.
  const t = browser.tab(locks ? { locks } : {});
  const calls = { room: 0, saving: [], snapshots: [], persisted: 0 };
  const navigator = {
    locks,
    serviceWorker: { controller: 'controller' in nav ? nav.controller : worker() },
    storage: { persisted: async () => false, persist: async () => { calls.persisted += 1; return true; } },
    standalone: !!nav.standalone
  };
  let keeper;
  keeper = createArchiveKeeper({
    store: t.store,
    storage: t.storage,
    doc: null,
    win: { matchMedia: () => ({ matches: false }) },
    nav: navigator,
    today: () => new Date(`${HISTORY_TODAY}T12:00:00`),
    onRoom: () => { calls.room += 1; },
    onSaving: () => calls.saving.push(keeper.saving),
    recoveryStore: { save: async (data, reason) => { calls.snapshots.push({ reason, days: Object.keys(data.days).length }); } },
    localDev,
    askMs: 40,
    waitMs: 60,
    ...options
  });
  return { browser, t, keeper, calls, locks };
}

test('an idle pass at half of Safari’s budget: a snapshot first, the oldest days moved, down to 40%', async () => {
  const { browser, keeper, calls, t } = keeperFor({ localDev: true });
  const result = await keeper.pass();
  assert.ok(result.moved > 0 && result.stopped === null);
  assert.ok(browser.base.used() <= ARCHIVE_BUDGET * 0.4);
  assert.deepEqual(calls.snapshots, [{ reason: 'before-archive', days: browser.days.length }], 'the whole planner, before the first pass');
  assert.equal(calls.room, 1, 'the planner hears there is room');
  assert.deepEqual(browser.differences(t.store), []);
  // More days later: another pass, without a snapshot this time.
  const more = historyDays(160, { today: '2027-11-11' }).filter(([day]) => day > HISTORY_TODAY);
  for (const [day, value] of more) browser.base.setItem(`daily-planner:${day}`, JSON.stringify(value));
  browser.base.setItem('daily-planner-ui:filler', 'x'.repeat(Math.max(0, Math.ceil(ARCHIVE_BUDGET * 0.5) - browser.base.used())));
  await keeper.pass();
  assert.equal(calls.snapshots.length, 1);
});

test('below half of the budget, nothing runs and IndexedDB is never opened', async () => {
  const { browser, keeper } = keeperFor({ days: historyDays(100), localDev: true });
  assert.equal(await keeper.pass(), null);
  assert.equal(browser.archive.ops.open, 0);
  assert.equal(await keeper.idle(), null, 'after Close day too');
});

test('an older tab open: idle passes wait; a refused save makes room anyway, saying “Saving…” meanwhile', async () => {
  const { browser, keeper, calls } = keeperFor({ nav: { controller: worker({ windows: 2 }) } });
  // This tab holds the tab lock; the second window doesn't: a planner before 1.40.
  keeper.start({ whenShown: () => {} });
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(await keeper.clear(), false, 'two planner windows, one tab lock');
  assert.equal(await keeper.pass(), null);
  assert.equal(browser.archive.ops.put, 0);
  const emergency = keeper.refused();
  assert.equal(keeper.saving, true, '“Saving…” while it runs');
  const result = await emergency;
  assert.ok(result.moved > 0);
  assert.equal(keeper.saving, false);
  assert.deepEqual(calls.saving, [true, false]);
  assert.equal(calls.room, 1, 'then what was refused is saved again');
});

test('second review, major: Data on this device asks the roll call whether a tab of an older release is open (more windows than tab locks)', async () => {
  const older = keeperFor({ nav: { controller: worker({ windows: 2 }) } });
  older.keeper.start({ whenShown: () => {} });
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(await older.keeper.olderTabOpen(), true);
  const alone = keeperFor({ nav: { controller: worker({ windows: 1 }) } });
  alone.keeper.start({ whenShown: () => {} });
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(await alone.keeper.olderTabOpen(), false);
  // Can't be told: no worker of 1.40 answering, no Web Locks, or on localhost.
  assert.equal(await keeperFor({ nav: { controller: worker({ answers: false }) } }).keeper.olderTabOpen(), false);
  assert.equal(await keeperFor({ nav: { controller: worker({ windows: 2 }), locks: null } }).keeper.olderTabOpen(), false);
  assert.equal(await keeperFor({ localDev: true, nav: { controller: worker({ windows: 2 }) } }).keeper.olderTabOpen(), false);
});

test('one window per tab lock: idle passes run; the roll call counts only planner windows', async () => {
  const { keeper, locks } = keeperFor({ nav: { controller: worker({ windows: 1 }) } });
  keeper.start({ whenShown: () => {} });
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(locks.held.filter(lock => lock.name === TAB_LOCK && lock.mode === 'shared').length, 1, 'the tab answers the roll call for its lifetime');
  assert.equal(await keeper.clear(), true);
  assert.ok((await keeper.pass()).moved > 0);
});

test('no service worker of 1.40 or later in control: idle passes wait (the offline copy could bring back older code)', async () => {
  for (const controller of [null, worker({ answers: false }), worker({ version: '1.39.9' })]) {
    const { keeper, browser } = keeperFor({ nav: { controller } });
    assert.equal(await keeper.clear(), false);
    assert.equal(await keeper.pass(), null);
    assert.equal(browser.archive.ops.put, 0);
  }
  assert.equal(atLeast('1.40.0'), true);
  assert.equal(atLeast('1.41.2'), true);
  assert.equal(atLeast('2.0.0'), true);
  assert.equal(atLeast('1.39.12'), false);
  assert.equal(atLeast(''), false);
  // On localhost there is no service worker to ask.
  assert.equal(await keeperFor({ localDev: true, nav: { controller: null } }).keeper.clear(), true);
});

test('one pass at a time across tabs: an idle pass skips while another holds the lock; an emergency one waits a little, then on in the background', async () => {
  const locks = fakeLocks();
  const { keeper, browser, calls } = keeperFor({ localDev: true, nav: { locks } });
  let release;
  const other = locks.request(ARCHIVE_LOCK, { mode: 'exclusive' }, () => new Promise(resolve => { release = resolve; }));
  assert.equal(await keeper.pass(), null, 'not now');
  assert.equal(await keeper.refused(), null, 'waited a little: “Not saved” meanwhile');
  assert.ok(keeper.followingUp, 'and it waits on for the lock');
  release();
  await other;
  const later = await keeper.followingUp;
  assert.ok(later.moved > 0, 'room made once the other pass is done');
  assert.ok(browser.base.used() <= ARCHIVE_BUDGET * 0.4);
  assert.ok(calls.room >= 2, 'and the refused change saved again then');
});

test('without Web Locks, the store’s lease stands in: respected, taken over once expired, given back in place', async () => {
  const { encodeLease, decodeLease } = await import('../src/state/day-placement.js');
  const { keeper, browser } = keeperFor({ localDev: true, nav: { locks: null } });
  browser.base.setItem(LEASE_KEY, encodeLease({ owner: 'othertab', until: Date.now() + 60000 }));
  assert.equal(await keeper.pass(), null, 'another tab’s lease: an idle pass doesn’t wait');
  browser.base.setItem(LEASE_KEY, encodeLease({ owner: 'othertab', until: Date.now() - 1 }));
  assert.ok((await keeper.pass()).moved > 0, 'an expired lease is taken over');
  assert.equal(decodeLease(browser.base.getItem(LEASE_KEY)).until, 0, 'and given back, rewritten in place (never needing room again)');
  assert.equal(encodeLease({ owner: 'a', until: 0 }).length, encodeLease({ owner: 'abcdefgh', until: Date.now() + 60000 }).length);
});

test('installed, the planner asks the browser to keep its storage at the first pass; in a tab, never', async () => {
  const tab = keeperFor({ localDev: true });
  await tab.keeper.pass();
  assert.equal(tab.calls.persisted, 0, 'never in a tab (Firefox would ask)');
  const installed = keeperFor({ localDev: true, nav: { standalone: true } });
  await installed.keeper.pass();
  assert.equal(installed.calls.persisted, 1);
});

test('ARCHIVE_MOVES off (a hotfix): no new moves, reading goes on', async () => {
  const { keeper, browser } = keeperFor({ localDev: true, moves: false });
  assert.equal(await keeper.refused(), null);
  assert.equal(browser.archive.ops.put, 0);
});

test('app.js: a refused save makes room at once, Close day at idle, the header hears “Saving…”', () => {
  const app = read('app.js');
  // Room is asked for before the notice is drawn: “Saving…” first, never a flash of “Not saved”.
  assert.match(app, /createSaveHealth\(\{ onChange: change => \{ if \(change\.failing \|\| change\.syncMarkRefused\) archiveKeeper\.refused\(\); renderStorageState\(\); if \(!change\.failing\) checkStorageSoon\(\{ soon: true \}\); \} \}\)/);
  assert.match(app, /onRoom: \(\) => \{ retryRefused\(\); checkStorageSoon\(\{ soon: true \}\); \}/, 'then what was refused is saved again');
  assert.match(app, /checkStorageSoon\(\); archiveKeeper\.idle\(\);/);
  assert.match(app, /saving: \(\) => archiveKeeper\.saving/);
  assert.match(app, /ledgerDays: \(\) => syncLedger\.dayMarks\(\),\n\s*forgetDays: days => syncLedger\.forgetDays\(days\),/);
});

test('Reset local data: the snapshot taken before the first pass goes with the planner; sync’s own snapshots stay', async () => {
  const kept = [{ id: 'a', reason: 'before-archive' }, { id: 'b', reason: 'before-remote-sync' }, { id: 'c', reason: 'sync-conflict' }];
  const recoveryStore = { remove: async match => { const doomed = kept.filter(match); doomed.forEach(item => kept.splice(kept.indexOf(item), 1)); return doomed.length; } };
  const keeper = createArchiveKeeper({ store: {}, recoveryStore });
  assert.equal(await keeper.forget(), 1);
  assert.deepEqual(kept.map(item => item.reason), ['before-remote-sync', 'sync-conflict']);
  assert.match(read('app.js'), /await store\.clearAll\('daily-planner:', \{ bulk: inBulk \}\); archiveKeeper\.forget\(\);/);
});
