import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createLocalStore } from '../src/state/local-store.js';
import { buildPlannerBackup, formatStorageBytes, importPlannerBackup } from '../src/state/planner-backup.js';
import { withoutRetiredSettings } from '../src/state/retired-keys.js';
import { normalizePlannerSettings } from '../src/state/settings-state.js';

class MemoryStorage {
  #data = new Map();
  get length() { return this.#data.size; }
  key(index) { return [...this.#data.keys()][index] ?? null; }
  getItem(key) { return this.#data.has(String(key)) ? this.#data.get(String(key)) : null; }
  setItem(key, value) { this.#data.set(String(key), String(value)); }
  removeItem(key) { this.#data.delete(String(key)); }
}

test('planner backup keeps settings and dated planner records only', () => {
  const store = createLocalStore(new MemoryStorage());
  store.writeJSON('daily-planner:settings', { startHour: 8 });
  store.writeJSON('daily-planner:2026-08-16', { focus: 'Ship' });
  const backup = buildPlannerBackup(store, { exportedAt: '2026-08-16T12:00:00.000Z' });
  assert.equal(backup.exportedAt, '2026-08-16T12:00:00.000Z');
  assert.deepEqual(backup.settings, { startHour: 8 });
  assert.deepEqual(backup.days, { '2026-08-16': { focus: 'Ship' } });
});

test('storage byte labels stay compact', () => {
  assert.equal(formatStorageBytes(800), '800 B');
  assert.equal(formatStorageBytes(2048), '2.0 KB');
  assert.equal(formatStorageBytes(1024 * 1024), '1.0 MB');
});

// ---------------------------------------------------------------------------
// 1.39: backups stay compatible both ways with 1.38
// ---------------------------------------------------------------------------

/** A backup as 1.38 wrote it: version 13, the settings with a licence and its gift, Horizon and a day. */
const backup138 = () => ({
  app: 'Daily Planner',
  version: 13,
  exportedAt: '2026-11-01T09:00:00.000Z',
  settings: {
    startHour: 7,
    endHour: 19,
    closeDayCount: 42,
    sponsorPromptShown: true,
    horizon: { years: { 2026: { misogi: 'Walk the Camino', misogiMilestones: [{ id: 'm1', text: 'Book the flights', date: '2026-02-02', done: true }], quarterReviews: { Q3: { done: true, wentWell: 'Long walks', completedAt: '2026-10-02' } }, habits: ['Walk after lunch', '', '', ''] } } },
    horizonStartYear: 2025,
    plus: { token: 'DP1.eyJ2IjoxfQ.c2lnbmF0dXJl', activatedAt: '2026-10-01T09:00:00.000Z' },
    plusGift: { code: 'ABCD-EFGH-JKMN', org: 'Example Studio' }
  },
  days: { '2026-10-14': { focus: 'Ship', endedAt: '2026-10-14T18:00:00' } }
});

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

/** What app.js does with a backup on Import (confirmImport), then reads (loadSettings). */
function import139(store, backup) {
  Object.entries(backup.days || {}).forEach(([day, value]) => { if (/^\d{4}-\d{2}-\d{2}$/.test(day)) store.writeJSON(`daily-planner:${day}`, value); });
  if (backup.settings && typeof backup.settings === 'object') store.writeJSON('daily-planner:settings', withoutRetiredSettings(backup.settings));
  return normalizePlannerSettings(store.readJSON('daily-planner:settings'), { currentYear: 2026 });
}

test('a 1.38 backup imports into 1.39: Horizon, misogi and quarter check-ins come back as they were; the licence is left behind', () => {
  const store = createLocalStore(new MemoryStorage());
  const settings = import139(store, backup138());
  assert.equal(settings.startHour, 7);
  assert.equal(settings.closeDayCount, 42);
  assert.equal(settings.sponsorPromptShown, true);
  assert.deepEqual(settings.horizon, backup138().settings.horizon, 'the year data, unchanged');
  assert.equal('plus' in settings || 'plusGift' in settings, false);
  const stored = store.readJSON('daily-planner:settings');
  assert.equal('plus' in stored || 'plusGift' in stored, false, 'not kept in storage either');
  assert.deepEqual(store.readJSON('daily-planner:2026-10-14'), backup138().days['2026-10-14']);
  // The planner's own Import does the same (importPlannerBackup(), 1.39.4), and accepts a 1.38 file as it is.
  const app = read('app.js');
  assert.match(app, /if \(parsed && parsed\.app === 'Daily Planner' && parsed\.days && typeof parsed\.days === 'object'\) \{/);
  assert.match(app, /importReport\(inBulk\(\(\) => importPlannerBackup\(store, pendingImport, \{ budget: storageBudget\(\) \}\)\)\)/);
  assert.match(read('src/state/planner-backup.js'), /store\.writeJSON\('daily-planner:settings', withoutRetiredSettings\(backup\.settings\)\)/);
  const planner = createLocalStore(new MemoryStorage());
  assert.deepEqual(importPlannerBackup(planner, backup138()), { days: 1, stored: 1, refused: [], settings: 'stored' });
  assert.deepEqual(planner.readJSON('daily-planner:settings'), store.readJSON('daily-planner:settings'), 'the same settings as above');
  assert.deepEqual(planner.readJSON('daily-planner:2026-10-14'), backup138().days['2026-10-14']);
});

test('a 1.39 backup imports into 1.38: the same format and version, the settings it knows, nothing it would trip on', () => {
  const store = createLocalStore(new MemoryStorage());
  import139(store, backup138());
  store.writeJSON('daily-planner:settings', { ...store.readJSON('daily-planner:settings'), plus: { token: 'DP1.synced.back' } });
  const backup = buildPlannerBackup(store, { exportedAt: '2026-11-10T12:00:00.000Z' });
  assert.equal(backup.app, 'Daily Planner', 'what 1.38 checks before it imports');
  assert.equal(backup.version, 13, 'the version 1.38 writes');
  assert.ok(backup.days && typeof backup.days === 'object');
  assert.equal('plus' in backup.settings || 'plusGift' in backup.settings, false, 'a licence synced back from a 1.38 device is never written into a 1.39 backup');
  assert.deepEqual(backup.settings.horizon, backup138().settings.horizon);
  // 1.38 reads settings with normalizePlannerSettings, unchanged in 1.39, which keeps what it knows and drops the rest…
  const future = normalizePlannerSettings({ ...backup.settings, somethingNew: { a: 1 } }, { currentYear: 2026 });
  assert.equal('somethingNew' in future, false, 'unknown fields are ignored');
  assert.deepEqual(future.horizon, backup138().settings.horizon);
  // …and keeps the licence already on the 1.38 device when the backup has none (its keepPlus, 1.38's src/lib/plus.js).
  const keepPlus138 = (next, previous) => { if (!next || next.plus?.token || !previous?.plus?.token) return false; next.plus = previous.plus; return true; };
  const onDevice = { plus: { token: 'DP1.device.licence', activatedAt: '' } };
  const after = { ...future };
  assert.equal(keepPlus138(after, onDevice), true);
  assert.equal(after.plus.token, 'DP1.device.licence');
});
