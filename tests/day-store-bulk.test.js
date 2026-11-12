import test from 'node:test';
import assert from 'node:assert/strict';
import { createDayStore } from '../src/state/day-store.js';
import { createMemoryArchive } from '../src/state/day-archive.js';
import { ARCHIVE_BUDGET, MANIFEST_KEY, hotFloor } from '../src/state/day-placement.js';
import { buildPlannerBackup, backupFileName, importReport } from '../src/state/planner-backup.js';
import { createSavedDays } from '../src/state/saved-days.js';
import { LEDGER_KEY } from '../src/state/storage-health.js';
import { createSyncLedger } from '../src/sync/ledger.js';
import { HISTORY_TODAY, QuotaStorage, SAFARI_BUDGET, historyBackup, historyDays } from './support/history.js';
import { createBrowser } from './support/archive-tabs.js';

// Many days at once with two homes (1.40 step 5): Import backup, Export backup, Reset local data, and what reads every
// day, gated by counting operations, never by timing.

/** A planner in one browser: Safari's quota, the store wired to its ledger as app.js wires it, the ledger written once per bulk. */
function planner({ quota = SAFARI_BUDGET, archive = createMemoryArchive() } = {}) {
  const storage = new QuotaStorage(quota);
  const ledger = createSyncLedger(storage, { now: () => new Date('2026-11-11T10:00:00.000Z') });
  const events = [];
  const store = createDayStore(storage, { archive, onMutation: mutation => { events.push(mutation); ledger.recordMutation(mutation); }, ledgerDays: () => ledger.dayMarks(), forgetDays: days => ledger.forgetDays(days) });
  const bulk = fn => ledger.deferMarks(fn).value;
  return { storage, ledger, store, archive, events, bulk };
}

test('Import of 10,000 days at Safari’s budget: every day stored, localStorage at most half full, the report says all', async () => {
  const days = historyDays(10000, { kind: 'mixed' });
  const p = planner();
  let ledgerWrites = 0;
  const setItem = p.storage.setItem.bind(p.storage);
  p.storage.setItem = (key, value) => { if (key === LEDGER_KEY) ledgerWrites += 1; return setItem(key, value); };
  const result = await p.store.importDays(historyBackup(days), { budget: SAFARI_BUDGET, today: HISTORY_TODAY, bulk: p.bulk });
  assert.deepEqual([result.days, result.stored, result.refused, result.settings], [10000, 10000, [], 'stored']);
  assert.equal(importReport(result).complete, true, 'nothing to say: all of it imported');
  assert.ok(p.storage.used() <= SAFARI_BUDGET * 0.5, `localStorage ${Math.round(p.storage.used() / SAFARI_BUDGET * 100)}% full`);
  assert.ok(p.storage.used() <= ARCHIVE_BUDGET * 0.4 + 2000, 'about the goal, the marks counted in');
  const mismatched = days.filter(([day, value]) => p.store.get(`daily-planner:${day}`) !== JSON.stringify(value));
  assert.equal(mismatched.length, 0, 'every day reads back');
  const floor = hotFloor(HISTORY_TODAY);
  assert.ok(days.filter(([day]) => day >= floor).every(([day]) => p.storage.getItem(`daily-planner:${day}`) !== null), 'recent days in localStorage');
  assert.ok(p.archive.data.size > 9000, `${p.archive.data.size} older days in the archive`);
  // Every day imported is a change, so it syncs: one mark each, the ledger written in as few writes as the steps.
  assert.equal(Object.keys(p.ledger.read().records).filter(id => id.startsWith('day:')).length, 10000);
  assert.ok(ledgerWrites <= 2, `${ledgerWrites} ledger writes`);
  assert.equal(p.ledger.hasDirty(), true);
});

test('Import that fits: no IndexedDB at all; an archive that refuses: as 1.39.4, and the report says what wasn’t imported', async () => {
  const p = planner();
  const small = await p.store.importDays(historyBackup(historyDays(50)), { budget: SAFARI_BUDGET, today: HISTORY_TODAY, bulk: p.bulk });
  assert.equal(small.stored, 50);
  assert.equal(p.archive.ops.open, 0, 'no IndexedDB for someone who never needs a move');
  assert.equal(p.storage.getItem(MANIFEST_KEY), null);
  const failing = createMemoryArchive();
  failing.faults.open = new Error('IndexedDB unavailable');
  const q = planner({ archive: failing });
  const big = await q.store.importDays(historyBackup(historyDays(3000)), { budget: SAFARI_BUDGET, today: HISTORY_TODAY, bulk: q.bulk });
  assert.ok(big.stored > 0 && big.refused.length > 0 && big.stored + big.refused.length === 3000);
  assert.match(importReport(big).text, /weren’t/);
  assert.ok(big.refused.every(day => day < big.refused[0] || day === big.refused[0]), 'the newest kept');
});

test('Import replaces archived days of the same date, and moves nothing back it doesn’t need to', async () => {
  const browser = createBrowser();
  const a = browser.tab();
  await a.pass();
  const oldest = browser.days[0][0];
  const replaced = { ...browser.days[0][1], focus: 'From the backup' };
  const result = await a.store.importDays(historyBackup([[oldest, replaced]]), { today: HISTORY_TODAY });
  assert.equal(result.stored, 1);
  assert.deepEqual(a.store.readJSON(`daily-planner:${oldest}`), replaced);
  await a.store.settled();
  assert.equal(browser.archive.aside.length, 0, 'an import replaces: nothing kept aside');
});

test('Export backup includes the archived days: the same days before and after a move; named for recent days when they can’t be read', async () => {
  const browser = createBrowser();
  const a = browser.tab();
  const before = buildPlannerBackup(a.store, { exportedAt: 'x' });
  await a.pass();
  assert.ok(browser.base.getItem(`daily-planner:${browser.days[0][0]}`) === null, 'moved');
  const after = buildPlannerBackup(a.store, { exportedAt: 'x' });
  assert.deepEqual(after.days, before.days);
  assert.equal(after.version, 13, 'the backup format stays version 13');
  assert.equal(backupFileName('2026-11-11', 'ready'), 'daily-planner-backup-2026-11-11.json');
  assert.equal(backupFileName('2026-11-11', 'none'), 'daily-planner-backup-2026-11-11.json');
  assert.equal(backupFileName('2026-11-11', 'unavailable'), 'daily-planner-backup-2026-11-11-recent-days.json');
  assert.equal(backupFileName('2026-11-11', 'lost'), 'daily-planner-backup-2026-11-11-recent-days.json');
});

test('Reset local data: both homes, a removal event for every day, the archive and the manifest gone, nothing back after a reload', async () => {
  const browser = createBrowser();
  const a = browser.tab();
  await a.pass();
  await browser.archive.keepAside([{ day: '2001-02-03', json: '{"focus":"an earlier copy"}' }]);
  a.events.length = 0;
  const count = await a.store.clearAll('daily-planner:');
  assert.equal(browser.archive.aside.length, 0, 'the earlier copies kept aside go too: every saved day, as the Reset dialog says');
  assert.equal(count, browser.days.length + 1, 'every day and the settings');
  assert.equal(a.events.length, count, 'the same events local-store gives: each deletion syncs');
  assert.ok(a.events.every(event => event.type === 'remove'));
  assert.equal(browser.base.getItem(MANIFEST_KEY), null);
  assert.equal(browser.archive.data.size, 0);
  assert.equal(a.store.status(), 'none');
  assert.deepEqual(a.store.keys('daily-planner:'), []);
  const b = browser.tab();
  assert.equal(await b.store.ready(), 'none');
  assert.deepEqual(b.store.keys('daily-planner:'), []);
});

test('a move re-parses nothing: Search, Unresolved and the week review read the same strings', async () => {
  const browser = createBrowser();
  const a = browser.tab();
  const saved = createSavedDays(a.store);
  assert.equal(saved.read().length, browser.days.length);
  const first = saved.stats().parses;
  await a.pass();
  assert.equal(saved.read().length, browser.days.length, 'every day still read');
  assert.equal(saved.stats().parses, first, 'not one day parsed again');
  const day = browser.days[5][0];
  a.store.writeJSON(`daily-planner:${day}`, { ...browser.days[5][1], focus: 'changed' });
  saved.read();
  assert.equal(saved.stats().parses, first + 1, 'only the day that changed');
});

test('an import that can’t write the manifest (a full browser, nothing archived yet) replaces nothing it can’t place, and says so', async () => {
  const p = planner();
  for (const [day, value] of historyDays(900)) p.storage.setItem(`daily-planner:${day}`, JSON.stringify(value));
  p.storage.quota = p.storage.used() + 10;
  const backup = historyBackup(historyDays(1200, { today: '2023-01-01' }));
  const result = await p.store.importDays(backup, { budget: SAFARI_BUDGET, today: HISTORY_TODAY, bulk: p.bulk });
  assert.equal(p.storage.getItem(MANIFEST_KEY), null);
  assert.ok(result.refused.length > 0 && result.stored + result.refused.length === 1200);
  assert.equal(importReport(result).complete, false, 'never told complete');
  // What it did store reads back; what it didn't is not half-there.
  for (const day of result.refused.slice(0, 50)) assert.notDeepEqual(p.store.readJSON(`daily-planner:${day}`), backup.days[day]);
});
