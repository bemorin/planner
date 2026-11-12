import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createLocalStore } from '../src/state/local-store.js';
import { normalizeDayState } from '../src/state/day-state.js';
import { createSaveHealth, storageLevel } from '../src/state/storage-health.js';
import { createPlannerWrites, moveBetweenDays, writeInOrder } from '../src/state/day-move.js';
import { createSyncLedger } from '../src/sync/ledger.js';
import { storageAlertView } from '../src/features/storage-alert.js';
import { candidatesForSavedDay } from '../src/features/unresolved.js';
import { QuotaStorage, historyDay } from './support/history.js';

// What moves from one day to another when this browser is out of space (1.39.4): a block (Week drag, the block
// editor), Close day's carried items, Unresolved's Plan and Save. Targets are written first and it is all or nothing:
// refused, what was written gets its previous string back, the item stays where it was (never on no day, never on
// two), and the 1.39.3 notice says the change wasn't saved.

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const FROM = '2026-11-09';
const TO = '2026-11-10';
const key = day => `daily-planner:${day}`;

/** Two saved days in a browser whose storage is about to be full, the store wired to the save health. */
function fullBrowser() {
  const storage = new QuotaStorage();
  const health = createSaveHealth();
  const store = createLocalStore(storage, { onWrite: result => health.note(result) });
  store.writeJSON(key(FROM), historyDay(FROM));
  store.writeJSON(key(TO), historyDay(TO));
  storage.quota = storage.used() + 20;
  const load = day => normalizeDayState(store.readJSON(key(day)), day);
  const writes = [];
  const days = {
    saved: day => store.get(key(day)),
    write: (day, value) => { writes.push(day); return store.writeJSON(key(day), value); },
    put: (day, raw) => (raw == null ? store.remove(key(day)) : store.set(key(day), raw))
  };
  // The Week drag's change: the block leaves its day, a longer one arrives with it on the other.
  const change = blockId => (source, target) => {
    const block = source.blocks.find(item => item.id === blockId);
    if (!block) return false;
    source.blocks = source.blocks.filter(item => item.id !== blockId);
    target.blocks.push({ ...block, startDate: TO, endDate: TO, notes: `${block.notes} Moved from the ninth.` });
  };
  const raw = () => ({ from: storage.getItem(key(FROM)), to: storage.getItem(key(TO)) });
  return { storage, health, store, load, days, writes, change, raw };
}

test('the target is written first: refused, nothing else is written, and the block stays where it was', () => {
  const b = fullBrowser();
  const blockId = b.load(FROM).blocks[0].id;
  const before = b.raw();
  assert.equal(moveBetweenDays({ sourceKey: FROM, targetKey: TO, read: b.load, change: b.change(blockId), ...b.days }), 'refused');
  assert.deepEqual(b.writes, [TO], 'the source is never written');
  assert.deepEqual(b.raw(), before, 'both days as they were');
  assert.ok(b.load(FROM).blocks.some(block => block.id === blockId));
  // The 1.39.3 notice: this browser is out of space, the latest change wasn't saved.
  assert.equal(b.health.failing, true);
  const view = storageAlertView({ failing: b.health.failing, level: storageLevel(b.storage.used()) });
  assert.deepEqual([view.kind, view.pill], ['full', 'Not saved']);
  // With room again, the move lands: target, then source.
  b.storage.quota = Infinity;
  b.writes.length = 0;
  assert.equal(moveBetweenDays({ sourceKey: FROM, targetKey: TO, read: b.load, change: b.change(blockId), ...b.days }), 'moved');
  assert.deepEqual(b.writes, [TO, FROM]);
  assert.ok(!b.load(FROM).blocks.some(block => block.id === blockId));
  assert.ok(b.load(TO).blocks.some(block => block.id === blockId));
  assert.equal(b.health.failing, false, 'and the notice goes by itself');
});

test('the source refused after its target landed: the target gets its previous string back, no duplicate', () => {
  const b = fullBrowser();
  b.storage.quota = Infinity;
  const blockId = b.load(FROM).blocks[0].id;
  const before = b.raw();
  // A refusal on the source only (the day on screen, longer in memory than in storage, at the edge of the quota).
  const setItem = b.storage.setItem.bind(b.storage);
  b.storage.setItem = (name, value) => { if (name === key(FROM)) { const error = new Error('full'); error.name = 'QuotaExceededError'; throw error; } return setItem(name, value); };
  assert.equal(moveBetweenDays({ sourceKey: FROM, targetKey: TO, read: b.load, change: b.change(blockId), ...b.days }), 'refused');
  assert.deepEqual(b.writes, [TO, FROM]);
  assert.deepEqual(b.raw(), before, 'the target as it was, byte for byte');
  const everywhere = [...b.load(FROM).blocks, ...b.load(TO).blocks].filter(block => block.id === blockId);
  assert.equal(everywhere.length, 1, 'on one day, its own');
  assert.equal(b.health.failing, true, 'told');
  // A target that didn't exist before is removed again.
  const fresh = fullBrowser();
  fresh.storage.quota = Infinity;
  fresh.store.remove(key(TO));
  fresh.storage.setItem = (name, value) => { if (name === key(FROM)) throw Object.assign(new Error('full'), { name: 'QuotaExceededError' }); return QuotaStorage.prototype.setItem.call(fresh.storage, name, value); };
  assert.equal(moveBetweenDays({ sourceKey: FROM, targetKey: TO, read: fresh.load, change: fresh.change(fresh.load(FROM).blocks[0].id), ...fresh.days }), 'refused');
  assert.equal(fresh.storage.getItem(key(TO)), null);
});

test('1.39.3’s order lost the block: the source written, the target refused', () => {
  const b = fullBrowser();
  const blockId = b.load(FROM).blocks[0].id;
  const source = b.load(FROM);
  const target = b.load(TO);
  b.change(blockId)(source, target);
  assert.equal(b.store.writeJSON(key(FROM), source), true, 'shorter: it fits');
  assert.equal(b.store.writeJSON(key(TO), target), false);
  assert.ok(![...b.load(FROM).blocks, ...b.load(TO).blocks].some(block => block.id === blockId), 'gone from both days');
});

test('the same day, nothing to do; writeInOrder puts back everything written before a refusal, newest first', () => {
  const log = [];
  const memory = new Map([['a', 'A0'], ['b', 'B0']]);
  const writes = {
    saved: name => (memory.has(name) ? memory.get(name) : null),
    write: (name, value) => { log.push(`write ${name}`); if (value === 'REFUSE') return false; memory.set(name, value); return true; },
    put: (name, raw) => { log.push(`put ${name}`); if (raw == null) memory.delete(name); else memory.set(name, raw); return true; }
  };
  const day = { blocks: [{ id: 'b1' }] };
  assert.equal(moveBetweenDays({ sourceKey: 'a', targetKey: 'a', read: () => day, change: (source, target) => { assert.equal(source, target, 'one day, one object'); }, ...writes }), 'moved');
  assert.deepEqual(log.splice(0), ['write a'], 'written once');
  assert.equal(moveBetweenDays({ sourceKey: 'a', targetKey: 'b', read: () => ({ blocks: [] }), change: () => false, ...writes }), 'none');
  assert.deepEqual(log.splice(0), []);
  assert.equal(writeInOrder([['b', 'B1'], ['c', 'C1'], ['settings', 'S1'], ['a', 'REFUSE']], writes), false);
  assert.deepEqual(log.splice(0), ['write b', 'write c', 'write settings', 'write a', 'put settings', 'put c', 'put b']);
  assert.deepEqual(Object.fromEntries(memory), { a: { blocks: [{ id: 'b1' }] }, b: 'B0' }, 'as before: c removed, settings removed, b back');
  assert.equal(writeInOrder([['b', 'B2'], ['a', 'A2']], writes), true);
  assert.deepEqual([memory.get('b'), memory.get('a')], ['B2', 'A2']);
});

/**
 * Close day as app.js writes it (completeEndDay): the days items are carried to, the settings (Later), the closed day
 * last, through writeInOrder and the planner's store. `refuse`: the key the browser refuses.
 */
function closeDay({ refuse }) {
  const storage = new QuotaStorage();
  const store = createLocalStore(storage);
  const today = historyDay(FROM);
  today.endedAt = '';
  today.triaged = [];
  today.tasks.push({ id: 'unfinished', text: 'Call the insurer back', done: false, carriedCount: 0, originDay: '' });
  store.writeJSON(key(FROM), today);
  store.writeJSON(key(TO), historyDay(TO));
  store.writeJSON('daily-planner:settings', { openWork: [] });
  const before = { from: storage.getItem(key(FROM)), to: storage.getItem(key(TO)), settings: storage.getItem('daily-planner:settings') };
  const setItem = storage.setItem.bind(storage);
  storage.setItem = (name, value) => { if (name === refuse) throw Object.assign(new Error('full'), { name: 'QuotaExceededError' }); return setItem(name, value); };
  // Carry one item to the next day, save another for Later, close the day.
  const target = normalizeDayState(store.readJSON(key(TO)), TO);
  target.tasks.push({ id: 'carried', text: 'Call the insurer back', done: false, carriedCount: 1, originDay: FROM });
  const closed = { ...today, endedAt: `${FROM}T18:00:00`, triaged: ['task:unfinished@2026-11-10', `task:${today.tasks[0].id}:later`] };
  const settings = { openWork: [{ id: 'o1', text: today.tasks[0].text, originDay: FROM, carriedCount: 1 }] };
  const writes = { saved: name => store.get(name), write: (name, value) => store.writeJSON(name, value), put: (name, raw) => (raw == null ? store.remove(name) : store.set(name, raw)) };
  const ok = writeInOrder([[key(TO), target], ['daily-planner:settings', settings], [key(FROM), closed]], writes);
  return { ok, storage, store, before };
}

test('Close day when the browser refuses a write: nothing carried, nothing closed, every item where it was', () => {
  for (const refuse of [key(TO), 'daily-planner:settings', key(FROM)]) {
    const { ok, storage, store, before } = closeDay({ refuse });
    assert.equal(ok, false, refuse);
    assert.deepEqual({ from: storage.getItem(key(FROM)), to: storage.getItem(key(TO)), settings: storage.getItem('daily-planner:settings') }, before, `${refuse} refused: all as before`);
    const open = candidatesForSavedDay(FROM, normalizeDayState(store.readJSON(key(FROM)), FROM)).map(candidate => candidate.key);
    assert.ok(open.includes('task:unfinished'), `${refuse} refused: still unresolved on its day, not lost`);
  }
  const done = closeDay({ refuse: 'nothing' });
  assert.equal(done.ok, true);
  assert.ok(done.store.readJSON(key(TO)).tasks.some(task => task.id === 'carried'));
  assert.equal(done.store.readJSON('daily-planner:settings').openWork.length, 1);
  assert.ok(done.store.readJSON(key(FROM)).endedAt);
});

test('the planner writes this way: block moves, Close day, Unresolved’s Plan and Save; refused writes stay false', () => {
  const app = read('app.js');
  assert.match(app, /const dayToEdit = key => \(key === ymd\(\) \? JSON\.parse\(JSON\.stringify\(state\)\) : loadStateForDate\(dateFromKey\(key\)\)\);/, 'the day on screen as a copy');
  // Every such change goes through createPlannerWrites(): the retry of refused saves held off meanwhile, marks held.
  assert.match(app, /const plannerWrites = createPlannerWrites\(\{\n\s*store, ledger: syncLedger,\n\s*hold: fn => \{ const was = retrying; retrying = true; try \{ return fn\(\); \} finally \{ retrying = was; \} \},\n\s*retry: \(\) => retryRefused\(\),/);
  assert.doesNotMatch(app, /writeInOrder\(/, 'never unguarded');
  assert.match(app, /const moved = plannerWrites\.guarded\(\(\) => moveBetweenDays\(\{ sourceKey, targetKey, read, change, \.\.\.days \}\)\);\n\s*if \(moved === 'moved'\) \{ if \(edited\.has\(ymd\(\)\)\) Object\.assign\(state, edited\.get\(ymd\(\)\)\); plannerWrites\.retry\(\); \}/, 'shown only once both landed, then the retry');
  assert.match(app, /\} else moveBlock\(dayKey, targetKey, \(sourceState, targetState\) => \{/, 'the Week drag');
  assert.match(app, /const moved = moveBlock\(sourceKey, targetKey, \(from, to\) => \{/, 'the block editor');
  assert.match(app, /if \(moved === 'refused'\) return showFormError\(`\$\{FULL_TITLE\} The block stays where it was\.`\);/);
  // Close day: built on copies; carried-to days, the settings, the closed day; shown only once all are stored.
  assert.match(app, /const closed = \{ state: JSON\.parse\(JSON\.stringify\(state\)\), settings: JSON\.parse\(JSON\.stringify\(settings\)\) \};/);
  assert.match(app, /state = closed\.state;\n\s*settings = closed\.settings;\n\s*try \{/);
  assert.match(app, /\} finally \{\n\s*state = live\.state;\n\s*settings = live\.settings;\n\s*\}/);
  assert.match(app, /const apply = \(\) => \{ Object\.assign\(state, closed\.state\); Object\.assign\(settings, closed\.settings\); \};\n\s*if \(!commitInOrder\(\[\.\.\.days, \['daily-planner:settings', closed\.settings\], \[storageKey\(\), closed\.state\]\], apply\)\) \{/);
  assert.match(app, /error\.textContent = `\$\{FULL_TITLE\} The day stays open, and every item where it was\.`/);
  assert.match(read('index.html'), /<p class="form-error" data-end-day-error role="alert" hidden><\/p>/);
  assert.doesNotMatch(app, /store\.writeJSON\(storageKey\(\), state\);\n\s*targetStates\.forEach/, 'never the closed day first');
  // Unresolved: Plan onto its day first, then off Later or off its own day; Save into Later first.
  assert.match(app, /const writes = \[\[`daily-planner:\$\{targetKey\}`, targetState\]\];/);
  assert.match(app, /writes\.push\(\['daily-planner:settings', \{ \.\.\.settings, openWork: later \}\]\);/);
  assert.match(app, /writes\.push\(\[`daily-planner:\$\{plan\.origin\}`, dayState\]\);/);
  assert.match(app, /return commitInOrder\(writes, apply\) \? 'planned' : 'refused';/);
  assert.match(app, /refused\.forEach\(plan => openWorkPendingPlans\.set\(pendingPlanKey\(plan\), plan\)\);/, 'a refused plan stays ready');
  assert.match(app, /commitInOrder\(\[\['daily-planner:settings', settings\], \[`daily-planner:\$\{dayKey\}`, dayState\]\], \(\) => \{ if \(dayKey === ymd\(\)\) state = dayState; \}\)/, 'Save');
  // False for refused writes everywhere.
  assert.match(app, /function persistStateForDate\(targetDate, targetState\) \{\n\s*return store\.writeJSON\(/);
  assert.match(app, /function persistSettings\(\) \{\n\s*try \{ return store\.writeJSON\('daily-planner:settings', settings\); \} catch \(_\) \{ return false; \}/);
});

// ---------------------------------------------------------------------------------------------------------------
// As app.js wires them (1.39.4, second pass): the store reports to the save health and to Personal sync's ledger,
// a landed write runs the retry of refused saves (which stores what memory holds), and the multi-key changes go
// through createPlannerWrites(). Scanned across the room left, storage must never hold a half-done change.
// ---------------------------------------------------------------------------------------------------------------

const TODAY = '2026-11-10';
const NEXT = '2026-11-11';
const LEDGER = 'daily-planner-sync:ledger';

/** The planner's wiring (app.js: the store, retryRefused, createPlannerWrites), over a storage that can refuse `refuse(key)`. */
function plannerApp({ quota = Infinity } = {}) {
  const storage = new QuotaStorage(quota);
  const refusing = new Set();
  const setItem = storage.setItem.bind(storage);
  storage.setItem = (name, value) => { if (refusing.has(name)) throw Object.assign(new Error('full'), { name: 'QuotaExceededError' }); return setItem(name, value); };
  const ledger = createSyncLedger(storage, { now: () => new Date(`${TODAY}T18:00:00.000Z`) });
  const health = createSaveHealth();
  const app = { state: null, settings: null };
  let retrying = false;
  const retried = [];
  const store = createLocalStore(storage, {
    onMutation: mutation => { const marked = ledger.recordMutation(mutation); if (marked !== null) health.note({ key: LEDGER, ok: marked }); },
    onWrite: result => { health.note(result); if (result.ok && result.tracked) retryRefused(); }
  });
  function retryRefused() {
    if (retrying || !health.failing) return;
    retrying = true;
    try {
      const keys = health.keys();
      if (keys.includes(key(TODAY))) retried.push(store.writeJSON(key(TODAY), app.state));
      if (keys.includes('daily-planner:settings')) retried.push(store.writeJSON('daily-planner:settings', app.settings));
    } finally { retrying = false; }
  }
  const writes = createPlannerWrites({
    store, ledger,
    hold: fn => { const was = retrying; retrying = true; try { return fn(); } finally { retrying = was; } },
    retry: () => retryRefused(),
    onMarks: marked => health.note({ key: LEDGER, ok: marked })
  });
  const load = day => normalizeDayState(store.readJSON(key(day)), day);
  const raw = () => ({ today: storage.data.get(key(TODAY)) ?? null, next: storage.data.get(key(NEXT)) ?? null, settings: storage.data.get('daily-planner:settings') ?? null });
  const ledgerEntry = id => JSON.parse(storage.data.get(LEDGER) || '{"records":{}}').records[id] ?? null;
  return { storage, refusing, ledger, health, app, store, writes, load, raw, ledgerEntry, retried };
}

/** Today with three unfinished tasks (one already planned for tomorrow when `tomorrow`), synced; the app showing it. */
function seedDay(p, { tomorrow = false } = {}) {
  const today = historyDay(TODAY);
  Object.assign(today, { endedAt: '', triaged: [], carriedForward: [], closeTransfers: [] });
  today.tasks = today.tasks.map((task, index) => ({ ...task, done: index > 2 }));
  p.store.writeJSON(key(TODAY), today);
  if (tomorrow) p.store.writeJSON(key(NEXT), { ...normalizeDayState(null, NEXT), focus: 'Tomorrow, planned already' });
  p.store.writeJSON('daily-planner:settings', { closeDayCount: 3, openWork: [] });
  p.ledger.markSynced(`day:${TODAY}`, { hash: 'base-today' });
  if (tomorrow) p.ledger.markSynced(`day:${NEXT}`, { hash: 'base-next' });
  p.ledger.markSynced('settings', { hash: 'base-settings' });
  p.app.state = p.load(TODAY);
  p.app.settings = p.store.readJSON('daily-planner:settings');
}

/** Close day as app.js completeEndDay() does it: built on copies, written all or nothing, shown once stored. */
function closeDayAsApp(p) {
  const closed = { state: JSON.parse(JSON.stringify(p.app.state)), settings: JSON.parse(JSON.stringify(p.app.settings)) };
  const target = p.load(NEXT);
  const open = closed.state.tasks.filter(task => task.text && !task.done);
  open.forEach(task => target.tasks.push({ id: `carried-${task.id}`, text: task.text, done: false, carriedCount: 1, originDay: TODAY }));
  Object.assign(closed.state, { endedAt: `${TODAY}T18:00:00.000Z`, triaged: open.map(task => `task:${task.id}@${NEXT}`), carriedForward: open.map(task => `task:${task.id}@${NEXT}`) });
  closed.settings.closeDayCount += 1;
  return p.writes.commit([[key(NEXT), target], ['daily-planner:settings', closed.settings], [key(TODAY), closed.state]], () => { Object.assign(p.app.state, closed.state); Object.assign(p.app.settings, closed.settings); });
}

const carriedOn = (p, day) => (p.store.readJSON(key(day))?.tasks || []).filter(task => task.id.startsWith('carried-')).length;

for (const { tomorrow, unsaved } of [{ tomorrow: false, unsaved: false }, { tomorrow: true, unsaved: false }, { tomorrow: true, unsaved: true }, { tomorrow: false, unsaved: true }]) {
  test(`Close day across the room left (tomorrow ${tomorrow ? 'saved already' : 'new'}${unsaved ? ', a save of today refused before': ''}): closed with its items, or nothing at all, and said`, () => {
    const probe = plannerApp();
    seedDay(probe, { tomorrow });
    const used = probe.storage.used();
    closeDayAsApp(probe);
    const growth = probe.storage.used() - used;
    const seen = new Set();
    for (let free = 0; free <= growth + 400; free += 25) {
      const p = plannerApp();
      seedDay(p, { tomorrow });
      if (unsaved) {
        // An edit of today the browser refused just before: on screen, waiting to be saved, told.
        p.storage.quota = p.storage.used();
        p.app.state.focus = `${p.app.state.focus} — an edit that didn’t fit`;
        assert.equal(p.store.writeJSON(key(TODAY), p.app.state), false);
        assert.equal(p.health.failing, true);
      }
      p.storage.quota = p.storage.used() + free;
      const before = { raw: p.raw(), state: JSON.parse(JSON.stringify(p.app.state)), today: p.ledgerEntry(`day:${TODAY}`), next: p.ledgerEntry(`day:${NEXT}`), settings: p.ledgerEntry('settings') };
      const ok = closeDayAsApp(p);
      const stored = p.store.readJSON(key(TODAY));
      assert.ok(!(stored.endedAt && carriedOn(p, NEXT) < 3), `free ${free}: a closed day stored without its items on tomorrow`);
      if (ok) {
        seen.add('closed');
        assert.ok(stored.endedAt && carriedOn(p, NEXT) === 3 && p.app.state.endedAt, `free ${free}: closed, its three items on tomorrow`);
        if (unsaved) assert.match(stored.focus, /an edit that didn’t fit/, 'the edit waiting is saved with it');
        assert.equal(p.health.failing, false, `free ${free}: nothing left unsaved, nothing told`);
        assert.ok(p.ledger.entry(`day:${NEXT}`)?.dirtyAt && p.ledger.entry(`day:${TODAY}`)?.dirtyAt, 'both marked for sync');
      } else {
        seen.add('refused');
        assert.deepEqual(p.raw(), before.raw, `free ${free}: storage as before, every key`);
        assert.deepEqual(p.app.state, before.state, `free ${free}: the screen as before (open, the edit waiting kept)`);
        assert.equal(p.health.failing, true, `free ${free}: “Not saved” told, and it stays`);
        assert.deepEqual([p.ledgerEntry(`day:${TODAY}`), p.ledgerEntry(`day:${NEXT}`), p.ledgerEntry('settings')], [before.today, before.next, before.settings], `free ${free}: no mark, no tombstone`);
        assert.equal(p.ledger.entry(`day:${NEXT}`)?.deletedAt ?? null, null, 'never a deletion of tomorrow');
        if (!tomorrow) assert.equal(p.ledger.entry(`day:${NEXT}`), null, 'a day that didn’t exist leaves no entry at all');
        assert.deepEqual(p.retried, [], 'no retry in the middle or after a refusal');
      }
    }
    assert.deepEqual([...seen].sort(), ['closed', 'refused'], 'both outcomes met in the scan');
  });
}

test('a refused block move or Save, the source on screen: storage and screen as before, the notice stays, no mark, no tombstone', () => {
  // The Week drag onto an empty day, the day on screen the source; its write refused after the target landed.
  const p = plannerApp();
  seedDay(p);
  const blockId = p.app.state.blocks[0].id;
  const before = { raw: p.raw(), state: JSON.parse(JSON.stringify(p.app.state)), today: p.ledgerEntry(`day:${TODAY}`) };
  p.refusing.add(key(TODAY));
  const days = { saved: day => p.store.get(key(day)), write: (day, value) => p.store.writeJSON(key(day), value), put: (day, raw) => p.writes.put(key(day), raw) };
  const read = day => (day === TODAY ? JSON.parse(JSON.stringify(p.app.state)) : p.load(day));
  const change = (source, target) => { const block = source.blocks.find(item => item.id === blockId); source.blocks = source.blocks.filter(item => item.id !== blockId); target.blocks.push(block); };
  assert.equal(p.writes.guarded(() => moveBetweenDays({ sourceKey: TODAY, targetKey: NEXT, read, change, ...days })), 'refused');
  assert.deepEqual(p.raw(), before.raw, 'tomorrow removed again, today as it was');
  assert.deepEqual(p.app.state, before.state);
  assert.equal(p.health.failing, true, 'told, and still told');
  assert.deepEqual([p.ledgerEntry(`day:${TODAY}`), p.ledgerEntry(`day:${NEXT}`), p.ledger.entry(`day:${NEXT}`)], [before.today, null, null], 'no mark, no tombstone for tomorrow');
  // Save into Later, the day on screen the source: Later first, then the day, refused.
  const later = p.app.settings.openWork;
  p.app.settings.openWork = [...later, { id: 'o1', text: p.app.state.tasks[0].text, originDay: TODAY, carriedCount: 1 }];
  const triaged = { ...JSON.parse(JSON.stringify(p.app.state)), triaged: [`task:${p.app.state.tasks[0].id}:later`] };
  const settingsBefore = p.ledgerEntry('settings');
  assert.equal(p.writes.commit([['daily-planner:settings', p.app.settings], [key(TODAY), triaged]]), false);
  p.app.settings.openWork = later;
  assert.deepEqual(p.raw(), before.raw, 'Later as before');
  assert.deepEqual(p.ledgerEntry('settings'), settingsBefore, 'the settings’ entry unchanged');
  assert.equal(p.health.failing, true);
  assert.deepEqual(p.retried, []);
});

test('Plan onto a day not saved yet, its own day refused: the new day is removed again, with no entry in the ledger', () => {
  const p = plannerApp();
  seedDay(p);
  const YESTERDAY = '2026-11-09';
  p.store.writeJSON(key(YESTERDAY), historyDay(YESTERDAY));
  p.ledger.markSynced(`day:${YESTERDAY}`, { hash: 'base-yesterday' });
  const before = { yesterday: p.ledgerEntry(`day:${YESTERDAY}`), raw: p.storage.data.get(key(YESTERDAY)) };
  p.refusing.add(key(YESTERDAY));
  const target = p.load(NEXT);
  target.tasks.push({ id: 'planned', text: 'Planned from Unresolved', done: false, carriedCount: 1, originDay: YESTERDAY });
  const source = { ...p.load(YESTERDAY), triaged: [`task:x@${NEXT}`] };
  assert.equal(p.writes.commit([[key(NEXT), target], [key(YESTERDAY), source]]), false);
  assert.equal(p.storage.data.get(key(NEXT)), undefined, 'the new day removed again');
  assert.equal(p.storage.data.get(key(YESTERDAY)), before.raw);
  assert.deepEqual([p.ledgerEntry(`day:${NEXT}`), p.ledger.entry(`day:${NEXT}`), p.ledgerEntry(`day:${YESTERDAY}`)], [null, null, before.yesterday]);
  // With room: both, and both marked, in one write of the ledger.
  p.refusing.clear();
  let ledgerWrites = 0;
  const setItem = p.storage.setItem;
  p.storage.setItem = (name, value) => { if (name === LEDGER) ledgerWrites += 1; return setItem(name, value); };
  assert.equal(p.writes.commit([[key(NEXT), target], [key(YESTERDAY), source]]), true);
  assert.equal(ledgerWrites, 1, 'the marks of the whole change, written once');
  assert.ok(p.ledger.entry(`day:${NEXT}`).dirtyAt && p.ledger.entry(`day:${YESTERDAY}`).dirtyAt);
});

test('undoMark forgets only the mark a key got inside deferMarks; one held from before stays', () => {
  const p = plannerApp();
  seedDay(p);
  // A mark refused earlier, held.
  p.storage.quota = p.storage.used();
  assert.equal(p.ledger.recordMutation({ type: 'set', key: key('2026-11-08') }), false);
  p.storage.quota = Infinity;
  assert.equal(p.ledger.undoMark(key('2026-11-08')), false, 'outside deferMarks: nothing to forget');
  p.ledger.deferMarks(() => {
    p.ledger.recordMutation({ type: 'set', key: key('2026-11-08') });
    p.ledger.recordMutation({ type: 'set', key: key('2026-11-07') });
    assert.equal(p.ledger.undoMark(key('2026-11-08')), true);
    assert.equal(p.ledger.undoMark(key('2026-11-07')), true);
  });
  assert.ok(p.ledgerEntry('day:2026-11-08')?.dirtyAt, 'the earlier held mark is written');
  assert.equal(p.ledgerEntry('day:2026-11-07'), null);
});
