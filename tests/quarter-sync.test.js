import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalStore } from '../src/state/local-store.js';
import { normalizePlannerSettings } from '../src/state/settings-state.js';
import { buildPlannerBackup } from '../src/state/planner-backup.js';
import { createSyncLedger } from '../src/sync/ledger.js';
import { createSyncEngine } from '../src/sync/engine.js';
import { localSyncRecords } from '../src/sync/document.js';
import { completeQuarterReview, ensureQuarterReviews, quarterEntry, setQuarterAnswer } from '../src/features/quarter-review.js';

/**
 * Quarter check-ins live in the year's Horizon data (settings.horizon.years[year].quarterReviews),
 * so they travel with the settings record: backups, restores and personal sync carry them like
 * every other Horizon field, and a change on one device reaches the others.
 */

class MemoryStorage {
  #data = new Map();
  get length() { return this.#data.size; }
  key(index) { return [...this.#data.keys()][index] ?? null; }
  getItem(key) { return this.#data.has(String(key)) ? this.#data.get(String(key)) : null; }
  setItem(key, value) { this.#data.set(String(key), String(value)); }
  removeItem(key) { this.#data.delete(String(key)); }
}

function device() {
  const storage = new MemoryStorage();
  const ledger = createSyncLedger(storage);
  const store = createLocalStore(storage, { onMutation: mutation => ledger.recordMutation(mutation) });
  return { storage, ledger, store, engine: createSyncEngine({ store, ledger, now: () => new Date('2026-10-20T10:00:00.000Z') }) };
}

/** One shared sync file, like the Google Drive document. */
function driveFile() {
  let document = null;
  return {
    async read() { return { exists: !!document, document, fileId: document ? 'file-1' : '' }; },
    async write(next) { document = JSON.parse(JSON.stringify(next)); return { fileId: 'file-1' }; }
  };
}

function settingsWithCheckIn() {
  const year = { misogi: 'Ride the Pyrenees', habits: ['', '', 'Mobility', ''], months: {} };
  setQuarterAnswer(year, 2, 'wentWell', 'The ride, finally.');
  setQuarterAnswer(year, 2, 'change', 'Fewer evening meetings.');
  setQuarterAnswer(year, 2, 'focus', 'Finish the draft');
  completeQuarterReview(year, 2, new Date(2026, 9, 14, 12));
  return { startHour: 8, endHour: 18, horizon: { years: { 2026: year } }, horizonStartYear: 2026 };
}

const checkIn = settings => quarterEntry(settings.horizon.years[2026], 2);

test('loading the settings keeps the quarter check-ins', () => {
  const settings = normalizePlannerSettings(JSON.parse(JSON.stringify(settingsWithCheckIn())), { currentYear: 2026 });
  assert.deepEqual(checkIn(settings), { done: true, wentWell: 'The ride, finally.', change: 'Fewer evening meetings.', focus: 'Finish the draft', completedAt: '2026-10-14' });
});

test('a backup carries the quarter check-ins, and restoring it brings them back', () => {
  const { store } = device();
  store.writeJSON('daily-planner:settings', settingsWithCheckIn());
  const backup = JSON.parse(JSON.stringify(buildPlannerBackup(store)));
  assert.equal(backup.settings.horizon.years[2026].quarterReviews.Q3.focus, 'Finish the draft');
  const restored = normalizePlannerSettings(backup.settings, { currentYear: 2026 });
  assert.equal(checkIn(restored).wentWell, 'The ride, finally.');
});

test('personal sync takes a check-in from one device to another, and later edits follow', async () => {
  const file = driveFile();
  const laptop = device();
  const phone = device();
  laptop.store.writeJSON('daily-planner:settings', settingsWithCheckIn());

  assert.equal((await laptop.engine.sync(file)).status, 'ok');
  const first = await phone.engine.sync(file);
  assert.deepEqual(first.pulled, ['settings']);
  assert.equal(checkIn(normalizePlannerSettings(phone.store.readJSON('daily-planner:settings'), { currentYear: 2026 })).focus, 'Finish the draft');

  // The phone edits its answer: the settings record changes hash and is pushed, then pulled back on the laptop.
  const before = (await localSyncRecords(phone.store, phone.ledger)).settings.hash;
  const settings = phone.store.readJSON('daily-planner:settings');
  setQuarterAnswer(settings.horizon.years[2026], 2, 'focus', 'Finish the draft by December');
  phone.store.writeJSON('daily-planner:settings', settings);
  assert.notEqual((await localSyncRecords(phone.store, phone.ledger)).settings.hash, before, 'an edited check-in is a change to sync');
  assert.deepEqual((await phone.engine.sync(file)).pushed, ['settings']);
  assert.deepEqual((await laptop.engine.sync(file)).pulled, ['settings']);
  assert.equal(checkIn(laptop.store.readJSON('daily-planner:settings')).focus, 'Finish the draft by December');
});

test('two devices editing a check-in at once ask before either is overwritten', async () => {
  const file = driveFile();
  const laptop = device();
  const phone = device();
  laptop.store.writeJSON('daily-planner:settings', settingsWithCheckIn());
  await laptop.engine.sync(file);
  await phone.engine.sync(file);
  for (const [who, words] of [[laptop, 'Laptop words'], [phone, 'Phone words']]) {
    const settings = who.store.readJSON('daily-planner:settings');
    setQuarterAnswer(settings.horizon.years[2026], 2, 'change', words);
    who.store.writeJSON('daily-planner:settings', settings);
  }
  assert.equal((await laptop.engine.sync(file)).status, 'ok');
  const result = await phone.engine.sync(file);
  assert.equal(result.status, 'conflict');
  assert.deepEqual(result.conflicts, ['settings']);
  assert.equal(checkIn(phone.store.readJSON('daily-planner:settings')).change, 'Phone words', 'nothing is overwritten silently');
  // "Use the other device's copy" resolves it with the laptop's words.
  assert.equal((await phone.engine.sync(file, { conflictResolution: 'remote' })).status, 'ok');
  assert.equal(checkIn(phone.store.readJSON('daily-planner:settings')).change, 'Laptop words');
});

test('a synced check-in from a newer planner keeps the fields this one does not know', () => {
  const year = { quarterReviews: { Q3: { done: true, wentWell: 'x', mood: 'calm', photos: 2 } } };
  ensureQuarterReviews(year);
  assert.equal(year.quarterReviews.Q3.mood, 'calm');
  assert.equal(year.quarterReviews.Q3.photos, 2);
});
