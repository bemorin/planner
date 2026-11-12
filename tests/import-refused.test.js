import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createLocalStore } from '../src/state/local-store.js';
import { IMPORT_ROOM_KEY, IMPORT_ROOM_SHARE, importPlannerBackup, importReport } from '../src/state/planner-backup.js';
import { createSaveHealth } from '../src/state/storage-health.js';
import { createSyncLedger } from '../src/sync/ledger.js';
import { createPlanner139 } from './support/app-1.39.3.js';
import { HISTORY_TODAY, QuotaStorage, SAFARI_BUDGET, historyBackup, historyDay, historyDays } from './support/history.js';

// Import backup when this browser runs out of space (1.39.4): what was stored and what was refused is counted and
// said in plain words; an import that couldn't keep everything is never told complete.

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const LEDGER_KEY = 'daily-planner-sync:ledger';

/**
 * The planner's store over a storage with `quota`, wired as app.js wires it: the sync ledger, and the save health,
 * which hears of what an import (`bulk`) couldn't store from the import's own message, not as “Not saved”.
 */
function planner(quota) {
  const storage = new QuotaStorage(quota);
  const ledger = createSyncLedger(storage, { now: () => new Date(`${HISTORY_TODAY}T09:00:00.000Z`) });
  const health = createSaveHealth();
  let bulk = false;
  const store = createLocalStore(storage, { onMutation: mutation => ledger.recordMutation(mutation), onWrite: result => { if (result.ok || !bulk) health.note(result); } });
  const inBulk = fn => { bulk = true; try { const { value, marked } = ledger.deferMarks(fn); if (marked !== null) health.note({ key: LEDGER_KEY, ok: marked }); return { value, marked }; } finally { bulk = false; } };
  return { storage, ledger, health, store, inBulk };
}

test('a 10,000-day backup at Safari’s quota: settings and the newest days kept, room left, every day not stored counted and said', () => {
  const days = historyDays(10000);
  const backup = historyBackup(days, { settings: { startHour: 6, endHour: 21, categories: [] } });
  const p = planner(SAFARI_BUDGET);
  const { value: result, marked } = p.inBulk(() => importPlannerBackup(p.store, backup, { budget: SAFARI_BUDGET }));
  assert.equal(result.days, 10000);
  assert.equal(result.settings, 'stored', 'the settings first');
  assert.ok(result.stored > 500 && result.refused.length > 8000, `${result.stored} stored, ${result.refused.length} refused`);
  assert.equal(result.stored + result.refused.length, 10000);
  // Room kept: the sync marks of every day stored landed, and 5% of the budget is still free for what comes next.
  assert.equal(marked, true, 'the ledger write landed');
  const free = SAFARI_BUDGET - p.storage.used();
  assert.ok(free >= SAFARI_BUDGET * IMPORT_ROOM_SHARE, `${free} characters free`);
  assert.equal(p.storage.getItem(IMPORT_ROOM_KEY), null, 'the room given back');
  // What it says is what storage holds: each day counted as stored is there, as the backup has it; none refused is.
  const held = p.store.keys('daily-planner:').filter(key => /^daily-planner:\d{4}-/.test(key));
  assert.equal(held.length, result.stored);
  for (const day of result.refused.slice(0, 200)) assert.equal(p.storage.getItem(`daily-planner:${day}`), null);
  const newest = days.slice(-400);
  for (const [key, day] of newest) assert.deepEqual(p.store.readJSON(`daily-planner:${key}`), day, `${key}: the most recent days are kept`);
  assert.deepEqual(result.refused, [...result.refused].sort().reverse(), 'refused dates, newest first');
  // Said in plain words, never as a success.
  const report = importReport(result);
  assert.equal(report.complete, false);
  assert.equal(report.text, `This browser is out of space for your planner, so only part of this backup was imported: ${result.stored.toLocaleString('en')} of its 10,000 days were imported, and ${result.refused.length.toLocaleString('en')} weren’t. Your backup file still has everything.`);
  // The ledger marked every stored day and the settings.
  assert.equal(Object.keys(JSON.parse(p.storage.getItem(LEDGER_KEY)).records).length, result.stored + 1, 'every stored day and the settings wait to be synced');
  // No “Not saved” after the import (it said what it couldn't store), and the planner can still save.
  assert.equal(p.health.failing, false);
  assert.equal(p.store.writeJSON(`daily-planner:${HISTORY_TODAY}`, historyDay(HISTORY_TODAY, 'rich')), true, 'today can be saved, a rich day');
  assert.equal(p.store.writeJSON('daily-planner:settings', { ...backup.settings, notes: 'x'.repeat(20000) }), true, 'and the settings grow');

  // 1.39.3 wrote the same way and said nothing (its result was ignored).
  const old = planner(SAFARI_BUDGET);
  assert.equal(createPlanner139({ store: old.store, today: HISTORY_TODAY }).importBackup(backup), undefined);
});

test('the room kept grows with the days stored, and storage already that full gets no day at all', () => {
  // Small days, many of them: the room for their marks grows as they land (every 200 days).
  const days = historyDays(3000, { kind: 'light' });
  const p = planner(SAFARI_BUDGET);
  const { value: result, marked } = p.inBulk(() => importPlannerBackup(p.store, historyBackup(days), { budget: SAFARI_BUDGET }));
  assert.ok(result.stored > 1000 && result.refused.length, `${result.stored} light days stored`);
  assert.equal(marked, true);
  assert.ok(SAFARI_BUDGET - p.storage.used() >= SAFARI_BUDGET * IMPORT_ROOM_SHARE);
  // Nearly full already: not one day, the settings still written, and said.
  const full = planner(SAFARI_BUDGET);
  full.storage.setItem('daily-planner:2020-01-01', 'x'.repeat(SAFARI_BUDGET - 100000));
  const none = full.inBulk(() => importPlannerBackup(full.store, historyBackup(days.slice(-20), { settings: { startHour: 8 } }), { budget: SAFARI_BUDGET })).value;
  assert.deepEqual([none.stored, none.refused.length, none.settings], [0, 20, 'stored']);
  assert.equal(importReport(none).text, 'This browser is out of space for your planner, so only part of this backup was imported: none of its 20 days could be imported; its settings were imported. Your backup file still has everything.');
  assert.equal(full.storage.getItem(IMPORT_ROOM_KEY), null);
  // A leftover of an import that never finished is taken back too.
  const left = planner(Infinity);
  left.storage.setItem(IMPORT_ROOM_KEY, 'x'.repeat(5000));
  importPlannerBackup(left.store, historyBackup(days.slice(-3)));
  assert.equal(left.storage.getItem(IMPORT_ROOM_KEY), null);
  // Given back however the import ends, even when something throws half-way.
  const broken = planner(Infinity);
  const writeJSON = broken.store.writeJSON;
  let count = 0;
  broken.store.writeJSON = (name, value) => { if (name.startsWith('daily-planner:2') && ++count === 2) throw new Error('boom'); return writeJSON(name, value); };
  assert.throws(() => importPlannerBackup(broken.store, historyBackup(days.slice(-5))), /boom/);
  assert.equal(broken.storage.getItem(IMPORT_ROOM_KEY), null);
  // And the planner takes one left by a closed tab back as it starts, and with Reset local data.
  const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  assert.match(app, /restateRetiredBase\(store, syncLedger\);\n[^\n]*\n\s*store\.withoutMutationTracking\(\(\) => store\.remove\(IMPORT_ROOM_KEY\)\);/);
  assert.match(app, /store\.withoutMutationTracking\(\(\) => \{ store\.remove\('daily-planner-ui:trophies-seen'\); store\.remove\(IMPORT_ROOM_KEY\); \}\);/);
  // Chromium's budget: 5% of it.
  const chromium = planner(5242880);
  const big = chromium.inBulk(() => importPlannerBackup(chromium.store, historyBackup(historyDays(3000)), { budget: 5242880 }));
  assert.equal(big.marked, true);
  assert.ok(5242880 - chromium.storage.used() >= 5242880 * IMPORT_ROOM_SHARE);
});

test('what Import says: nothing when all was stored, plain words otherwise', () => {
  assert.deepEqual(importReport({ days: 12, stored: 12, refused: [], settings: 'stored' }), { complete: true, text: '' });
  assert.deepEqual(importReport({ days: 0, stored: 0, refused: [], settings: 'stored' }), { complete: true, text: '' });
  const lead = 'This browser is out of space for your planner, so';
  const tail = 'Your backup file still has everything.';
  assert.equal(importReport({ days: 3, stored: 2, refused: ['2020-01-01'], settings: 'none' }).text, `${lead} only part of this backup was imported: 2 of its 3 days were imported, and 1 wasn’t. ${tail}`);
  assert.equal(importReport({ days: 1200, stored: 1, refused: Array(1199).fill('d'), settings: 'stored' }).text, `${lead} only part of this backup was imported: 1 of its 1,200 days was imported, and 1,199 weren’t. ${tail}`);
  assert.equal(importReport({ days: 40, stored: 40, refused: [], settings: 'refused' }).text, `${lead} only part of this backup was imported: all its 40 days were imported; its settings weren’t imported. ${tail}`);
  assert.equal(importReport({ days: 40, stored: 30, refused: Array(10).fill('d'), settings: 'refused' }).text, `${lead} only part of this backup was imported: 30 of its 40 days were imported, and 10 weren’t; its settings weren’t imported. ${tail}`);
  assert.equal(importReport({ days: 40, stored: 0, refused: Array(40).fill('d'), settings: 'stored' }).text, `${lead} only part of this backup was imported: none of its 40 days could be imported; its settings were imported. ${tail}`);
  assert.equal(importReport({ days: 40, stored: 0, refused: Array(40).fill('d'), settings: 'refused' }).text, `${lead} nothing from this backup could be imported. ${tail}`);
  assert.equal(importReport({ days: 0, stored: 0, refused: [], settings: 'refused' }).text, `${lead} nothing from this backup could be imported. ${tail}`);
  assert.doesNotMatch(importReport({ days: 3, stored: 2, refused: ['x'] }).text, /success|complete|update|version|soon/i);
});

test('an import that fits: everything stored, each day replacing the one of its date, the others kept', () => {
  const p = planner(Infinity);
  p.store.writeJSON('daily-planner:2026-01-05', { focus: 'Kept: not in the backup' });
  p.store.writeJSON('daily-planner:2026-01-06', { focus: 'Replaced' });
  const result = importPlannerBackup(p.store, { app: 'Daily Planner', version: 13, settings: { startHour: 8, plus: { token: 'retired' } }, days: { '2026-01-06': { focus: 'From the backup' }, '2026-01-07': { focus: 'New' }, workspace: { ignored: true } } });
  assert.deepEqual(result, { days: 2, stored: 2, refused: [], settings: 'stored' });
  assert.equal(importReport(result).complete, true);
  assert.deepEqual(['2026-01-05', '2026-01-06', '2026-01-07'].map(day => p.store.readJSON(`daily-planner:${day}`).focus), ['Kept: not in the backup', 'From the backup', 'New']);
  assert.deepEqual(p.store.readJSON('daily-planner:settings'), { startHour: 8 }, 'without the retired fields');
  assert.equal(p.store.get('daily-planner:workspace'), null, 'only dated days');
  assert.deepEqual(importPlannerBackup(p.store, { days: {} }), { days: 0, stored: 0, refused: [], settings: 'none' });
});

test('the planner says it: in the import’s alert, its marks written once, Personal sync told once', () => {
  const app = read('app.js');
  // 1.40: through the day store, which places older days in this browser's database (src/state/day-store.js importDays()).
  assert.match(app, /const report = importReport\(await store\.importDays\(backup, \{ budget: storageBudget\(\), bulk: inBulk \}\)\);/);
  assert.match(app, /onWrite: result => \{ if \(result\.ok \|\| !bulkWrites\) saveHealth\.note\(result\);/, 'what it couldn’t store, Import says itself');
  assert.match(app, /if \(!report\.complete\) alert\(report\.text\);/);
  assert.match(app, /try \{ const \{ value, marked \} = syncLedger\.deferMarks\(fn\); if \(marked !== null\) saveHealth\.note\(\{ key: LEDGER_KEY, ok: marked \}\); return value; \} finally \{ bulkWrites = false; personalSyncFeature\?\.noteLocalChange\?\.\(\); \}/);
  assert.match(app, /if \(!bulkWrites\) personalSyncFeature\?\.noteLocalChange\?\.\(\);/);
  assert.match(app, /await store\.clearAll\('daily-planner:', \{ bulk: inBulk \}\);/, 'Reset local data: one ledger write too (1.40: both homes)');
  // One write of the ledger for the whole import.
  const p = planner(Infinity);
  let writes = 0;
  const setItem = p.storage.setItem.bind(p.storage);
  p.storage.setItem = (key, value) => { if (key === LEDGER_KEY) writes += 1; return setItem(key, value); };
  p.ledger.deferMarks(() => importPlannerBackup(p.store, historyBackup(historyDays(300))));
  assert.equal(writes, 1);
});
