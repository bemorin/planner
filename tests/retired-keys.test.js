import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { RETIRED_KEYS, RETIRED_SETTINGS, forgetRetiredData, hasRetiredSettings, withoutRetiredSettings } from '../src/state/retired-keys.js';
import { createLocalStore } from '../src/state/local-store.js';
import { normalizePlannerSettings } from '../src/state/settings-state.js';
import { createSyncLedger } from '../src/sync/ledger.js';

// 1.39: the device-only keys earlier releases kept for the paid add-on go, once, as the planner starts; nothing else
// is touched, the settings included (a rewrite of them would be a change to sync, met as a conflict elsewhere).

const SETTINGS_KEY = 'daily-planner:settings';

class MemoryStorage {
  #data = new Map();
  writes = 0;
  removes = 0;
  constructor(initial = {}) { Object.entries(initial).forEach(([key, value]) => this.#data.set(key, String(value))); }
  get length() { return this.#data.size; }
  key(index) { return [...this.#data.keys()][index] ?? null; }
  getItem(key) { return this.#data.has(String(key)) ? this.#data.get(String(key)) : null; }
  setItem(key, value) { this.writes += 1; this.#data.set(String(key), String(value)); }
  removeItem(key) { this.removes += 1; this.#data.delete(String(key)); }
  keys() { return [...this.#data.keys()].sort(); }
}

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

/** Settings as 1.38 kept them: a licence and its gift beside Horizon, a misogi, a quarter check-in and the rest. */
const settings138 = () => ({
  startHour: 7,
  endHour: 19,
  weekStartsOn: 1,
  weekStartsOnExplicit: true,
  closeDayCount: 42,
  sponsorPromptShown: true,
  categories: [{ id: 'deep-work', name: 'Deep work', color: '#3e5f96' }],
  horizon: { years: { 2026: { misogi: 'Walk the Camino', misogiMilestones: [{ id: 'm1', text: 'Book the flights', date: '2026-02-02', done: true }], quarterReviews: { Q3: { done: true, wentWell: 'Long walks', completedAt: '2026-10-02' } }, habits: ['Walk after lunch', '', '', ''] } } },
  horizonStartYear: 2025,
  plus: { token: 'DP1.eyJ2IjoxfQ.c2lnbmF0dXJl', activatedAt: '2026-10-01T09:00:00.000Z' },
  plusGift: { code: 'ABCD-EFGH-JKMN', org: 'Example Studio' }
});

const device138 = () => ({
  [SETTINGS_KEY]: JSON.stringify(settings138()),
  'daily-planner:2026-10-14': JSON.stringify({ focus: 'Ship', endedAt: '2026-10-14T18:00:00' }),
  'daily-planner-ui:plus-verified': 'DP1.eyJ2IjoxfQ.c2lnbmF0dXJl',
  'daily-planner-ui:plus-checked': JSON.stringify({ at: 1, revoked: [], held: null, notice: '' }),
  'daily-planner-ui:plus-pending-purchase': 'ch_example0001',
  'daily-planner-ui:plus-unverified-gift': JSON.stringify({ license: 'DP1.x.y', code: 'ABCD-EFGH-JKMN', org: '' }),
  'daily-planner-ui:currency': JSON.stringify({ currency: 'EUR', at: 1, zone: 'Europe/Paris' }),
  'daily-planner-ui:ref': JSON.stringify({ code: 'EXAMPLE', at: 1 }),
  'daily-planner-ui:partner-hints': JSON.stringify(['share']),
  creem_ref: 'EXAMPLE',
  // Kept: the palette, the theme, the trophies seen, the tour and the counts switch.
  'daily-planner-ui:paint': 'plum',
  'daily-planner-ui:theme': 'dark',
  'daily-planner-ui:trophies-seen': JSON.stringify({ 2026: ['close-1'] }),
  'daily-planner-ui:tour': JSON.stringify({ done: true }),
  'daily-planner-ui:usage-counts': 'off'
});

test('the old licence, gift, purchase, currency and referral keys go quietly; nothing else is touched', () => {
  const storage = new MemoryStorage(device138());
  const removed = forgetRetiredData(storage);
  assert.deepEqual(removed.sort(), [...RETIRED_KEYS].sort());
  assert.deepEqual(storage.keys(), ['daily-planner-ui:paint', 'daily-planner-ui:theme', 'daily-planner-ui:tour', 'daily-planner-ui:trophies-seen', 'daily-planner-ui:usage-counts', 'daily-planner:2026-10-14', 'daily-planner:settings']);
  assert.equal(storage.writes, 0, 'nothing written');
  assert.equal(storage.getItem('daily-planner-ui:paint'), 'plum', 'the palette stays, and now paints for everyone');
  assert.equal(storage.getItem('daily-planner:2026-10-14'), device138()['daily-planner:2026-10-14'], 'days are untouched');
  assert.equal(storage.getItem(SETTINGS_KEY), device138()[SETTINGS_KEY], 'the settings are left exactly as they were');
});

test('the settings are never rewritten as the planner starts, so there is nothing for sync to send', () => {
  const storage = new MemoryStorage(device138());
  const ledger = createSyncLedger(storage);
  ledger.markSynced('settings', { hash: 'agreed-on-1.38' });
  const store = createLocalStore(storage, { onMutation: ledger.recordMutation });
  const writes = storage.writes;
  forgetRetiredData(storage);
  assert.equal(storage.writes, writes);
  assert.equal(ledger.hasDirty(), false, 'no change waiting to sync');
  assert.equal(ledger.entry('settings').lastSyncedHash, 'agreed-on-1.38');
  // They go with the next real save: the settings as the planner reads them have every field but the two.
  const loaded = normalizePlannerSettings(store.readJSON(SETTINGS_KEY), { currentYear: 2026 });
  assert.equal(hasRetiredSettings(loaded), false);
  const expected = settings138();
  delete expected.plus;
  delete expected.plusGift;
  assert.deepEqual(loaded.horizon, expected.horizon, 'Horizon, misogi and quarter check-ins carry over as they are');
  assert.deepEqual(loaded.categories.map(({ id, name, color }) => ({ id, name, color })), expected.categories, 'and the colours');
  assert.deepEqual([loaded.startHour, loaded.endHour, loaded.weekStartsOn, loaded.closeDayCount, loaded.sponsorPromptShown, loaded.horizonStartYear], [7, 19, 1, 42, true, 2025]);
});

test('it is one-time: a second start finds nothing and writes nothing', () => {
  const storage = new MemoryStorage(device138());
  forgetRetiredData(storage);
  const removes = storage.removes;
  assert.deepEqual(forgetRetiredData(storage), []);
  assert.equal(storage.writes, 0, 'no write');
  assert.equal(storage.removes, removes, 'no remove');
  const fresh = new MemoryStorage({ [SETTINGS_KEY]: JSON.stringify({ startHour: 8 }) });
  assert.deepEqual(forgetRetiredData(fresh), []);
  assert.equal(fresh.writes + fresh.removes, 0, 'a planner that never had any of it is left alone');
});

test('blocked, broken or odd storage never stops the planner', () => {
  const blocked = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } };
  assert.deepEqual(forgetRetiredData(blocked), []);
  assert.deepEqual(forgetRetiredData(null), []);
  const garbled = new MemoryStorage({ [SETTINGS_KEY]: '{not json', creem_ref: 'EXAMPLE' });
  assert.deepEqual(forgetRetiredData(garbled), ['creem_ref']);
  assert.equal(garbled.getItem(SETTINGS_KEY), '{not json', 'unreadable settings are left for the planner to handle as before');
});

test('the settings helpers: the same object without retired fields, a copy without them otherwise', () => {
  assert.deepEqual([...RETIRED_SETTINGS], ['plus', 'plusGift']);
  const plain = { startHour: 8 };
  assert.equal(withoutRetiredSettings(plain), plain);
  assert.equal(withoutRetiredSettings(null), null);
  const old = settings138();
  const clean = withoutRetiredSettings(old);
  assert.notEqual(clean, old);
  assert.ok(old.plus, 'the input is not changed');
  assert.equal('plus' in clean || 'plusGift' in clean, false);
  assert.equal(hasRetiredSettings({ plus: null }), true, 'even an empty field from 1.38 goes');
  assert.equal(hasRetiredSettings({ plusMinus: 1 }), false);
});

test('app.js runs the cleanup and restates the sync base before it reads the settings, and the service worker caches the modules', () => {
  const app = read('app.js');
  const cleanup = app.indexOf('forgetRetiredData(browserStorage);');
  const restate = app.indexOf('restateRetiredBase(store, syncLedger);');
  assert.ok(cleanup > 0 && restate > cleanup, 'device keys only, then the base, through the planner store and ledger');
  assert.ok(restate < app.indexOf('let settings = loadSettings();'), 'before the first read of the settings, so before any save');
  assert.doesNotMatch(app, /forgetRetiredData\([^)]*writeSettings/, 'the settings are never written for it');
  assert.match(read('sw.js'), /'\.\/src\/state\/retired-keys\.js'/);
  assert.match(read('sw.js'), /'\.\/src\/sync\/document\.js'/);
});
