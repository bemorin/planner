// How the planner keeps up with years of history (1.39.4, step 0 of the 1.40 design): the history-wide readers of
// design §1b, Personal sync and Import, timed in memory over synthetic saved days (tests/support/history.js), at
// 1,000, 3,000 and 10,000 days. Each row is timed as 1.39.3 did it (its code frozen in tests/support/) and as this
// tree does it. A report, not a gate: timings depend on the machine.
//
//   node scripts/perf-history.mjs [--days=1000,3000,10000] [--sync-days=1000,3000] [--kind=typical|light|rich|mixed]
//                                 [--sync-before=no]   (sync: this tree only; 1.39.3 takes minutes per sync at 10,000)
import { performance } from 'node:perf_hooks';
import { HISTORY_TODAY, QuotaStorage, SAFARI_BUDGET, historyBackup, historyDays, seedHistory } from '../tests/support/history.js';
import { createPlanner139 } from '../tests/support/app-1.39.3.js';
import * as ledger139 from '../tests/support/sync-1.39.3/ledger.js';
import * as engine139 from '../tests/support/sync-1.39.3/engine.js';
import { createLocalStore } from '../src/state/local-store.js';
import { normalizeDayState } from '../src/state/day-state.js';
import { createSyncLedger } from '../src/sync/ledger.js';
import { createSyncEngine } from '../src/sync/engine.js';
import { searchPlannerDays } from '../src/features/search.js';
import { pipUnresolved } from '../src/features/pip-window.js';
import { buildJournalIndex } from '../src/features/journal.js';
import { buildProgressModel } from '../src/features/progress-model.js';
import * as backupModule from '../src/state/planner-backup.js';
import { createSaveHealth } from '../src/state/storage-health.js';

const LEDGER_KEY = 'daily-planner-sync:ledger';
const arg = (name, fallback) => {
  const found = process.argv.find(value => value.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : fallback;
};
const sizes = arg('days', '1000,3000,10000').split(',').map(Number).filter(Boolean);
const syncSizes = arg('sync-days', '1000,3000').split(',').map(Number).filter(Boolean);
const kind = arg('kind', 'typical');
const syncBefore = arg('sync-before', 'yes') !== 'no';

// This tree's modules, where it has them (1.39.4): without them, only 1.39.3's column is filled.
const optional = async path => { try { return await import(path); } catch { return null; } };
const savedDaysModule = await optional('../src/state/saved-days.js');
const unresolvedModule = await optional('../src/features/unresolved.js');

const time = fn => {
  const start = performance.now();
  const value = fn();
  return { ms: performance.now() - start, value };
};
const timeAsync = async fn => {
  const start = performance.now();
  const value = await fn();
  return { ms: performance.now() - start, value };
};
const ms = value => (value == null ? '—' : value >= 1000 ? `${(value / 1000).toFixed(1)} s` : `${value.toFixed(value < 10 ? 1 : 0)} ms`);
const rows = [];
const row = (size, what, before, after, note = '') => rows.push({ size, what, before, after, note });

/** The planner over a storage seeded with `count` days, as both versions read it. */
function plannerOver(count) {
  const storage = new QuotaStorage();
  const days = historyDays(count, { kind });
  const chars = seedHistory(storage, days);
  const store = createLocalStore(storage);
  const settings = { categories: [], openWork: [] };
  const old = createPlanner139({ store, today: HISTORY_TODAY, settings });
  return { storage, store, days, chars, settings, old, state: old.state };
}

for (const size of sizes) {
  const p = plannerOver(size);
  const live = { liveDay: HISTORY_TODAY, liveState: p.state };
  const savedDays = savedDaysModule ? savedDaysModule.createSavedDays(p.store) : null;
  const readDays = () => savedDays.read(live);
  console.error(`${size} days (${kind}, ${(p.chars / 1e6).toFixed(1)}M characters)…`);

  // savedPlannerDays(): every day parsed and normalised. 1.39.4 parses only what changed since the last read.
  const allBefore = time(() => p.old.savedPlannerDays());
  const allCold = savedDays ? time(readDays) : null;
  const allWarm = savedDays ? time(readDays) : null;
  row(size, 'All saved days, parsed (first / again)', allBefore.ms, savedDays ? `${ms(allCold.ms)} / ${ms(allWarm.ms)}` : null);

  // A Search keystroke, after a day changed (1.39.3 re-reads everything at each one).
  const query = 'lyon';
  const searchBefore = time(() => p.old.searchPlanner(query));
  const changedKey = p.days[Math.floor(p.days.length / 2)][0];
  const changed = { ...p.days[Math.floor(p.days.length / 2)][1], focus: 'Tickets to Lyon, changed' };
  p.store.writeJSON(`daily-planner:${changedKey}`, changed);
  const searchAfter = savedDays ? time(() => searchPlannerDays({ query, days: readDays(), categories: [], blockTimeRange: () => '' })) : null;
  row(size, 'Search keystroke', searchBefore.ms, searchAfter?.ms, searchAfter ? `${searchAfter.value.length} results, ${savedDays.stats().parses} days parsed in all` : '');

  // Unresolved, then the floating window and the week review, which count it too.
  const needsNow = () => unresolvedModule.needsAttention(readDays(), { todayKey: HISTORY_TODAY, openWork: p.settings.openWork });
  const unresolvedBefore = time(() => p.old.needsAttentionEntries());
  const fresh = savedDaysModule ? savedDaysModule.createSavedDays(p.store) : null;
  const unresolvedCold = unresolvedModule && fresh ? time(() => unresolvedModule.needsAttention(fresh.read(live), { todayKey: HISTORY_TODAY, openWork: [] })) : null;
  const unresolvedWarm = unresolvedModule && savedDays ? time(needsNow) : null;
  row(size, 'Unresolved list (first / again)', unresolvedBefore.ms, unresolvedCold ? `${ms(unresolvedCold.ms)} / ${ms(unresolvedWarm.ms)}` : null, `${unresolvedBefore.value.length} entries`);
  // First: nothing parsed yet in this tab (the cost of the first of them to open); again: the days already parsed.
  const coldNeeds = () => unresolvedModule.needsAttention(savedDaysModule.createSavedDays(p.store).read(live), { todayKey: HISTORY_TODAY, openWork: p.settings.openWork });
  const pipBefore = time(() => pipUnresolved({ needs: p.old.needsAttentionEntries(), later: [] }));
  const pipCold = unresolvedWarm ? time(() => pipUnresolved({ needs: coldNeeds(), later: [] })) : null;
  const pipAfter = unresolvedWarm ? time(() => pipUnresolved({ needs: needsNow(), later: [] })) : null;
  row(size, 'Floating window opens (first / again)', pipBefore.ms, pipAfter ? `${ms(pipCold.ms)} / ${ms(pipAfter.ms)}` : null);
  const year = Number(HISTORY_TODAY.slice(0, 4));
  const getRecord = key => (key === HISTORY_TODAY ? p.state : normalizeDayState(p.store.readJSON(`daily-planner:${key}`), key));
  const progress = () => buildProgressModel({ year, today: new Date(`${HISTORY_TODAY}T12:00:00`), planningDays: [1, 2, 3, 4, 5], getRecord });
  const reviewBefore = time(() => ({ needs: p.old.needsAttentionEntries().length, progress: progress() }));
  const reviewCold = unresolvedWarm ? time(() => ({ needs: coldNeeds().length, progress: progress() })) : null;
  const reviewAfter = unresolvedWarm ? time(() => ({ needs: needsNow().length, progress: progress() })) : null;
  row(size, 'Week review, first / again (Unresolved count, painted week)', reviewBefore.ms, reviewAfter ? `${ms(reviewCold.ms)} / ${ms(reviewAfter.ms)}` : null);
  if (unresolvedWarm) {
    const same = JSON.stringify(unresolvedWarm.value.map(entry => [entry.originDay, entry.key])) === JSON.stringify(p.old.needsAttentionEntries().map(entry => [entry.originDay, entry.key]));
    if (!same) console.error('  ! Unresolved differs between 1.39.3 and this tree');
  }

  // Unchanged readers, for scale (design §1b).
  const journal = time(() => buildJournalIndex({ keys: p.store.keys('daily-planner:'), read: key => p.store.get(key), liveDay: HISTORY_TODAY, liveState: p.state }));
  row(size, 'Journal index (unchanged)', journal.ms, journal.ms, `${journal.value.length} entries`);
  const progressOnly = time(progress);
  row(size, 'Progress: painted year and streak (unchanged)', progressOnly.ms, progressOnly.ms);

  // Import of a backup of these days, into an empty browser, with the sync ledger marking each day and the save
  // health hearing of each write, as app.js wires them.
  const backup = historyBackup(p.days);
  const wired = (storage, ledger) => {
    const health = createSaveHealth();
    return createLocalStore(storage, { onMutation: mutation => ledger.recordMutation(mutation), onWrite: result => health.note(result) });
  };
  const importOld = (quota = Infinity) => {
    const storage = new QuotaStorage(quota);
    const store = wired(storage, ledger139.createSyncLedger(storage));
    return time(() => createPlanner139({ store, today: HISTORY_TODAY }).importBackup(backup));
  };
  const importNew = (quota = Infinity) => {
    const storage = new QuotaStorage(quota);
    const ledger = createSyncLedger(storage);
    const store = wired(storage, ledger);
    return time(() => ledger.deferMarks(() => backupModule.importPlannerBackup(store, backup, { budget: quota === Infinity ? SAFARI_BUDGET : quota })));
  };
  const hasImport = typeof backupModule.importPlannerBackup === 'function' && typeof createSyncLedger(new QuotaStorage()).deferMarks === 'function';
  const imported = hasImport ? importNew() : null;
  row(size, `Import a ${size.toLocaleString('en')}-day backup`, importOld().ms, imported?.ms);
  if (hasImport) {
    const full = importNew(SAFARI_BUDGET);
    const result = full.value.value;
    const report = backupModule.importReport(result);
    row(size, '  …at Safari’s 5 MiB quota', importOld(SAFARI_BUDGET).ms, full.ms, `${result.stored} days stored, ${result.refused.length} refused${report.complete ? '' : `; 1.39.3 said nothing, 1.39.4 says: “${report.text}”`}`);
  }
}

/** A plain copy in memory, as the engine's bare providers present it; `writes` counts what was written. */
function plainCloud() {
  const cloud = { document: null, writes: 0 };
  cloud.provider = {
    read: async () => (cloud.document ? { exists: true, document: cloud.document } : { exists: false }),
    write: async document => { cloud.document = JSON.parse(JSON.stringify(document)); cloud.writes += 1; }
  };
  return cloud;
}

for (const size of syncSizes) {
  console.error(`Personal sync, ${size} records…`);
  const days = historyDays(size, { kind });
  const versions = [['1.39.3', { createSyncLedger: ledger139.createSyncLedger, createSyncEngine: engine139.createSyncEngine }], ['now', { createSyncLedger, createSyncEngine }]];
  for (const [label, sync] of versions.filter(([name]) => syncBefore || name === 'now')) {
    const now = () => new Date(`${HISTORY_TODAY}T09:00:00.000Z`);
    const device = () => {
      const storage = new QuotaStorage();
      const ledger = sync.createSyncLedger(storage, { now });
      const store = createLocalStore(storage, { onMutation: mutation => ledger.recordMutation(mutation) });
      return { storage, ledger, store, engine: sync.createSyncEngine({ store, ledger, now }) };
    };
    const cloud = plainCloud();
    const a = device();
    seedHistory(a.storage, days);
    const timed = async (what, d) => {
      d.storage.readsOf(LEDGER_KEY);
      const { ms: spent, value } = await timeAsync(() => d.engine.sync(cloud.provider));
      const reads = d.storage.readsOf(LEDGER_KEY);
      const entry = rows.find(item => item.size === `${size} sync` && item.what === what) || (row(`${size} sync`, what, null, null), rows.at(-1));
      entry[label === 'now' ? 'after' : 'before'] = spent;
      entry[label === 'now' ? 'afterReads' : 'beforeReads'] = reads;
      entry.note = `pushed ${value.pushed.length}, pulled ${value.pulled.length}`;
    };
    await timed('First sync: send everything, then mark it', a);
    const b = device();
    await timed('First sync of another device: fetch everything', b);
    await timed('Sync, no changes', a);
    a.store.writeJSON(`daily-planner:${days.at(-1)[0]}`, { ...days.at(-1)[1], focus: 'One change' });
    await timed('Sync, one change', a);
    await timed('The other device fetches that change', b);
  }
}

const width = Math.max(...rows.map(item => item.what.length));
console.log(`Daily Planner: history at scale (${kind} days; in memory, Node ${process.version}; not a gate)\n`);
let current = null;
for (const item of rows) {
  if (item.size !== current) {
    current = item.size;
    console.log(`\n${typeof current === 'number' ? `${current.toLocaleString('en')} days` : `${current.replace(' sync', '').replace(/\B(?=(\d{3})+$)/, ',')} records, Personal sync`}`);
    console.log(`  ${'What'.padEnd(width)}  ${'1.39.3'.padStart(16)}  ${'1.39.4'.padStart(18)}`);
  }
  const format = (value, reads) => (typeof value === 'string' ? value : `${ms(value)}${reads != null ? ` (${reads}×)` : ''}`);
  console.log(`  ${item.what.padEnd(width)}  ${format(item.before, item.beforeReads).padStart(16)}  ${format(item.after, item.afterReads).padStart(18)}${item.note ? `  ${item.note}` : ''}`);
}
console.log('\n(n×): how many times the sync read the ledger key (getItem).');
