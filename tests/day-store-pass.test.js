import test from 'node:test';
import assert from 'node:assert/strict';
import { addDaysKey } from '../src/lib/dates.js';
import { ARCHIVE_BUDGET, MANIFEST_KEY, decodeManifest, hotFloor } from '../src/state/day-placement.js';
import { createBlankDay } from '../src/state/day-state.js';
import { LEDGER_KEY } from '../src/state/storage-health.js';
import { HISTORY_TODAY, historyDay } from './support/history.js';
import { createBrowser } from './support/archive-tabs.js';

// Moving older days to the archive (1.40, src/state/day-store.js moveDays()): put → verify → manifest →
// compare-and-delete. Stopped anywhere, every day still reads back; a move is no change; other tabs follow.

const GOAL = Math.floor(ARCHIVE_BUDGET * 0.4);
const key = day => `daily-planner:${day}`;

test('a pass moves the oldest days, down to 40%: every day reads back, nothing marked changed, keys listed once', async () => {
  const browser = createBrowser();
  const a = browser.tab();
  const before = browser.base.used();
  assert.ok(before > ARCHIVE_BUDGET * 0.6, `seeded above the threshold: ${before}`);
  const result = await a.pass();
  assert.equal(result.stopped, null);
  assert.ok(result.moved > 200, `${result.moved} days moved`);
  assert.ok(browser.base.used() <= GOAL, `localStorage down to the goal: ${browser.base.used()} ≤ ${GOAL}`);
  assert.deepEqual(browser.differences(a.store), [], 'every day reads back, the identical string');
  assert.equal(a.events.length, 0, 'moving is not a change: no mutation');
  assert.equal(browser.base.getItem(LEDGER_KEY), null, 'no ledger mark, no tombstone');
  const keys = a.store.keys('daily-planner:');
  assert.equal(new Set(keys).size, keys.length, 'no duplicate keys');
  assert.equal(keys.length, browser.days.length + 1, 'every day and the settings');
  // The oldest days went, the recent ones stayed.
  const moved = browser.days.slice(0, result.moved).map(([day]) => day);
  assert.ok(moved.every(day => browser.base.getItem(key(day)) === null && browser.archive.data.get(day).json === a.store.get(key(day))));
  assert.ok(browser.days.slice(result.moved).every(([day]) => browser.base.getItem(key(day)) !== null));
  const manifest = decodeManifest(browser.base.getItem(MANIFEST_KEY));
  assert.deepEqual([manifest.before, manifest.days], [addDaysKey(moved.at(-1), 1), result.moved]);
  assert.equal(manifest.chars, result.chars);
  assert.equal(a.store.status(), 'ready');
  assert.equal(a.store.stats().archived, result.moved);
});

test('today, future days and the last 62 days never move, nor the days on screen', async () => {
  const browser = createBrowser();
  const a = browser.tab();
  const plan = a.plan();
  const floor = hotFloor(HISTORY_TODAY);
  assert.ok(plan.batches.flat().every(day => day < floor));
  await a.pass();
  for (const [day] of browser.days) if (day >= floor) assert.notEqual(browser.base.getItem(key(day)), null, day);
});

for (const stopAt of ['put', 'verify', 'manifest', 37]) {
  test(`a pass stopped after ${typeof stopAt === 'number' ? `${stopAt} removals` : `its ${stopAt}`}: a new tab reads every day, and the next pass completes`, async () => {
    const browser = createBrowser();
    const a = browser.tab();
    const ledgerBefore = browser.base.getItem(LEDGER_KEY);
    const stopped = await a.pass({ stopAt });
    assert.equal(stopped.stopped, typeof stopAt === 'number' ? 'remove' : stopAt);
    browser.closeTabs();
    // The tab is gone; the planner opens again over the same storage and archive.
    const b = browser.tab();
    await b.store.ready();
    assert.deepEqual(browser.differences(b.store), [], 'every day reads back');
    const keys = b.store.keys('daily-planner:');
    assert.equal(new Set(keys).size, keys.length, 'no duplicate keys');
    assert.equal(browser.base.getItem(LEDGER_KEY), ledgerBefore, 'nothing marked changed, nothing taken for deleted');
    assert.equal(b.events.length, 0);
    const next = await b.pass();
    assert.equal(next.stopped, null);
    assert.ok(browser.base.used() <= GOAL, 'the next pass completes');
    assert.deepEqual(browser.differences(b.store), []);
    assert.equal(browser.base.getItem(LEDGER_KEY), ledgerBefore);
    const c = browser.tab();
    await c.store.ready();
    assert.deepEqual(browser.differences(c.store), [], 'and once more, after another reload');
  });
}

test('a read-back that differs, or an archive that refuses the write, removes nothing', async () => {
  const browser = createBrowser();
  const a = browser.tab();
  // Every key but the lease (which stands in for Web Locks here, and is rewritten as passes run).
  const usedNow = () => browser.base.used() - (browser.base.getItem('daily-planner-store:lease') || '').length - (browser.base.getItem('daily-planner-store:lease') ? 'daily-planner-store:lease'.length : 0);
  const used = usedNow();
  browser.archive.faults.readBack = json => `${json} `;
  assert.equal((await a.pass()).stopped, 'verify');
  assert.equal(usedNow(), used, 'nothing removed');
  assert.equal(browser.base.getItem(MANIFEST_KEY), null, 'the manifest not advanced');
  browser.archive.faults.readBack = null;
  browser.archive.faults.put = Object.assign(new Error('The quota has been exceeded.'), { name: 'QuotaExceededError' });
  assert.equal((await a.pass()).stopped, 'put');
  assert.equal(usedNow(), used);
  assert.deepEqual(browser.differences(a.store), []);
  browser.archive.faults.put = null;
  assert.equal((await a.pass()).stopped, null, 'and it works once the archive does');
});

test('compare-and-delete: a day edited while it moves stays in localStorage, and wins', async () => {
  const browser = createBrowser();
  const a = browser.tab();
  const first = browser.days[0][0];
  const edited = { ...historyDay(first), focus: 'Edited while it moved' };
  // Between the put and the removals, another tab saves that day.
  browser.archive.faults.read = () => { browser.base.setItem(key(first), JSON.stringify(edited)); return null; };
  await a.pass();
  browser.archive.faults.read = null;
  assert.equal(browser.base.getItem(key(first)), JSON.stringify(edited), 'not removed: its value changed');
  assert.deepEqual(a.store.readJSON(key(first)), edited, 'localStorage wins');
  assert.equal(browser.base.getItem(key(browser.days[1][0])), null, 'the others moved');
});

test('two tabs, one storage: a removal reaches the other tab with its string; before it does, the day is read-only there', async () => {
  const browser = createBrowser();
  const a = browser.tab({ name: 'A' });
  const b = browser.tab({ name: 'B' });
  await Promise.all([a.store.ready(), b.store.ready()]);
  const result = await a.pass();
  const oldest = key(browser.days[0][0]);
  // B hasn't heard yet: the manifest says the day may be archived, localStorage no longer has it.
  assert.equal(b.store.pending(oldest), true, 'pending, never blank');
  assert.equal(b.store.get(oldest), null);
  assert.equal(b.store.set(oldest, JSON.stringify(createBlankDay())), false, 'a blank read is never saved over it');
  await browser.deliver();
  assert.equal(b.store.pending(oldest), false);
  assert.deepEqual(browser.differences(b.store), [], 'B reads every day, from the events’ oldValue');
  assert.equal(b.events.length, 0, 'no mutation in B either');
  assert.equal(b.store.stats().archived, result.moved);
  // B edits a moved day: it moves back, the archived copy goes.
  const day = b.store.readJSON(oldest);
  day.focus = 'Edited in B';
  assert.equal(b.store.writeJSON(oldest, day), true);
  await b.store.settled();
  assert.equal(browser.archive.data.has(oldest.slice(14)), false);
  await browser.deliver();
  assert.deepEqual(a.store.readJSON(oldest), day, 'A reads B’s edit: localStorage wins');
});

test('another tab’s pass that this tab only hears of through the manifest: it reads those days from the archive', async () => {
  const browser = createBrowser();
  const a = browser.tab({ name: 'A' });
  const b = browser.tab({ name: 'B' });
  await b.store.ready();
  await a.pass();
  // Only the manifest's event reaches B (its removals were lost, say): B reads what moved from the archive itself.
  b.store.storageEvent({ key: MANIFEST_KEY, oldValue: null, newValue: browser.base.getItem(MANIFEST_KEY) });
  while (b.deferred.length) b.deferred.shift()();
  await b.store.settled();
  assert.deepEqual(browser.differences(b.store), []);
});

test('a deletion in another tab (its tombstone in the ledger) is never taken for a move', async () => {
  const browser = createBrowser();
  const a = browser.tab({ name: 'A' });
  const b = browser.tab({ name: 'B' });
  await a.pass();
  await browser.deliver();
  await b.store.ready();
  const old = key(browser.days[1][0]);
  assert.equal(a.store.remove(old), true);
  await a.store.settled();
  await browser.deliver();
  assert.equal(b.store.get(old), null, 'gone in B too');
  assert.equal(browser.archive.data.has(old.slice(14)), false, 'and from the archive');
  const c = browser.tab();
  await c.store.ready();
  assert.equal(c.store.get(old), null, 'it doesn’t come back after a reload');
});

test('an older tab (1.39) writes blind over a moved day: the archived version is kept aside, its write wins', async () => {
  const browser = createBrowser();
  const a = browser.tab({ name: '1.40' });
  await a.pass();
  const older = browser.olderTab();
  const moved = browser.days[0][0];
  const archived = a.store.get(key(moved));
  // 1.39 opens the day, sees it empty, and plans on it: new items, sharing none of the archived day's ids.
  const blind = createBlankDay();
  blind.priorities[0].text = 'Planned in the older tab';
  older.store.writeJSON(key(moved), blind);
  browser.closeTabs();
  const reloaded = browser.tab();
  await reloaded.store.ready();
  await reloaded.store.settled();
  assert.deepEqual(reloaded.store.readJSON(key(moved)), blind, 'the newer write wins');
  assert.deepEqual(browser.archive.aside.map(({ day, json, reason }) => [day, json, reason]), [[moved, archived, 'older-tab']], 'the earlier version kept aside');
  assert.equal(browser.archive.data.has(moved), false);
  assert.equal(reloaded.store.stats().displaced, 1);
  assert.deepEqual((await reloaded.store.displaced()).map(entry => entry.day), [moved]);
});

test('an older tab edits a moved day it still had open (sharing its items): a plain move back', async () => {
  const browser = createBrowser();
  const older = browser.olderTab();
  const a = browser.tab({ name: '1.40' });
  const moved = browser.days[2][0];
  const open = older.store.readJSON(key(moved));
  await a.pass();
  open.focus = 'Saved by the older tab after the move';
  older.store.writeJSON(key(moved), open);
  browser.closeTabs();
  const reloaded = browser.tab();
  await reloaded.store.ready();
  await reloaded.store.settled();
  assert.deepEqual(reloaded.store.readJSON(key(moved)), open);
  assert.equal(browser.archive.aside.length, 0, 'nothing kept aside');
  assert.equal(browser.archive.data.has(moved), false, 'the archived copy went');
});

test('an older tab saves a moved day it opened as blank: the blank never hides the real day', async () => {
  const browser = createBrowser();
  const a = browser.tab({ name: '1.40' });
  await a.pass();
  const older = browser.olderTab();
  const moved = browser.days[3][0];
  const archived = a.store.get(key(moved));
  // 1.39 flushes the day on screen before Search: a blank day, its items freshly made.
  older.store.writeJSON(key(moved), createBlankDay());
  browser.closeTabs();
  const reloaded = browser.tab();
  await reloaded.store.ready();
  assert.equal(reloaded.store.get(key(moved)), archived, 'the archived day again');
  assert.equal(browser.base.getItem(key(moved)), null, 'the blank gone from localStorage');
  assert.deepEqual(reloaded.events, [{ type: 'set', key: key(moved) }], 'a change, so it syncs over the blank');
  assert.equal(browser.archive.aside.length, 0);
});

test('in the same session: a 1.40 tab writes a day an older tab wrote blind over: the archived version is kept aside then', async () => {
  const browser = createBrowser();
  const a = browser.tab({ name: '1.40' });
  await a.pass();
  const older = browser.olderTab();
  const moved = browser.days[4][0];
  const archived = a.store.get(key(moved));
  const blind = createBlankDay();
  blind.tasks[0].text = 'From the older tab';
  older.store.writeJSON(key(moved), blind);
  await browser.deliver();
  const seen = a.store.readJSON(key(moved));
  assert.deepEqual(seen, blind, 'localStorage wins');
  seen.tasks[1].text = 'And more, in 1.40';
  assert.equal(a.store.writeJSON(key(moved), seen), true);
  await a.store.settled();
  assert.deepEqual(browser.archive.aside.map(entry => [entry.day, entry.json]), [[moved, archived]]);
});

test('no manifest is no reason to clear the archive: the first pass adopts a day it holds and localStorage lacks; a Reset’s leftovers go', async () => {
  // A day the database holds without a manifest (a first move, pull or import stopped before its manifest): adopted.
  const browser = createBrowser();
  await browser.archive.put([{ day: '2001-01-01', json: '{"focus":"a day only the archive holds"}' }]);
  const a = browser.tab();
  await a.pass();
  assert.equal(browser.archive.data.has('2001-01-01'), true, 'never cleared because the manifest was missing');
  assert.equal(a.store.get(key('2001-01-01')), '{"focus":"a day only the archive holds"}', 'one of the planner’s days');
  const reloaded = browser.tab();
  await reloaded.store.ready();
  assert.equal(reloaded.store.get(key('2001-01-01')), '{"focus":"a day only the archive holds"}', 'and after a reload');
  // A day the ledger says was deleted is no day to adopt.
  const deleted = createBrowser();
  await deleted.archive.put([{ day: '2001-01-02', json: '{"focus":"deleted"}' }]);
  const b = deleted.tab();
  b.store.remove(key('2001-01-02'));
  await b.pass();
  assert.equal(b.store.get(key('2001-01-02')), null);
  // Reset asked for the database to go (RESET_KEY): it goes before anything is archived anew.
  const reset = createBrowser();
  await reset.archive.put([{ day: '2001-01-03', json: '{"focus":"from before Reset"}' }]);
  reset.base.setItem('daily-planner-store:reset', '1');
  const c = reset.tab();
  await c.pass();
  assert.equal(c.store.get(key('2001-01-03')), null);
  assert.equal(reset.archive.data.has('2001-01-03'), false);
  assert.equal(reset.base.getItem('daily-planner-store:reset'), null);
});

test('a browser too full for the manifest’s few characters: the first pass frees one verified day for it, in the same step', async () => {
  const browser = createBrowser();
  // Full to the last character: not even the manifest fits.
  browser.base.quota = browser.base.used() + 10;
  const a = browser.tab();
  const result = await a.pass();
  assert.equal(result.stopped, null);
  assert.ok(result.moved > 0);
  assert.notEqual(browser.base.getItem(MANIFEST_KEY), null, 'the manifest written');
  assert.ok(browser.base.used() <= GOAL);
  assert.deepEqual(browser.differences(a.store), [], 'every day reads back');
  browser.closeTabs();
  const b = browser.tab();
  await b.store.ready();
  assert.deepEqual(browser.differences(b.store), [], 'and after a reload');
});

test('the storage bar counts localStorage alone: a move lowers it, every saved day still counted', async () => {
  const { storageChars } = await import('../src/state/storage-health.js');
  const browser = createBrowser();
  const a = browser.tab();
  const before = { chars: storageChars(browser.base), days: a.store.stats().days };
  await a.pass();
  assert.equal(storageChars(browser.base), browser.base.used(), 'every localStorage key and value, nothing from the archive');
  assert.ok(storageChars(browser.base) < before.chars * 0.7);
  assert.equal(a.store.stats().days, before.days, 'the days: both homes');
});
