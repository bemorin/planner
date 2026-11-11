import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalStore } from '../src/state/local-store.js';
import { normalizePlannerSettings } from '../src/state/settings-state.js';
import { forgetRetiredData } from '../src/state/retired-keys.js';
import { createSyncLedger } from '../src/sync/ledger.js';
import { createSyncEngine } from '../src/sync/engine.js';
import { createSyncDocument, restateRetiredBase } from '../src/sync/document.js';
import { contentHash } from '../src/sync/hash.js';
import { createMemoryKeyStore } from '../src/sync/key-store.js';
import { createSealedTransport, createSyncProtection } from '../src/sync/protection.js';
import { MIN_ITERATIONS, createSeal, readEnvelope } from '../src/sync/seal.js';

/**
 * 1.39 and Personal sync: two devices that synced on 1.38 kept the licence of the paid add-on in their settings
 * (settings.plus, settings.plusGift), and the copy and the bases were hashed with it. The start-up cleanup leaves
 * the settings as they are, and sync compares them without those fields, so whichever device upgrades first, and
 * whatever either one changes then, the other one follows without a conflict. Plain and sealed copies alike.
 */

class MemoryStorage {
  #data = new Map();
  get length() { return this.#data.size; }
  key(index) { return [...this.#data.keys()][index] ?? null; }
  getItem(key) { return this.#data.has(String(key)) ? this.#data.get(String(key)) : null; }
  setItem(key, value) { this.#data.set(String(key), String(value)); }
  removeItem(key) { this.#data.delete(String(key)); }
}

const PASSPHRASE = 'quiet harbour lantern';
const SETTINGS_KEY = 'daily-planner:settings';
const DAY_KEY = 'daily-planner:2026-11-10';

/** Settings as 1.38 kept them: normalised, with the licence and its gift beside Horizon, a misogi and a check-in. */
const settings138 = () => ({
  ...normalizePlannerSettings({
    startHour: 7,
    endHour: 19,
    closeDayCount: 41,
    categories: [{ id: 'deep-work', name: 'Deep work', color: '#3e5f96' }],
    horizon: { years: { 2026: { misogi: 'Walk the Camino', quarterReviews: { Q3: { done: true, wentWell: 'Long walks', completedAt: '2026-10-02' } } } } },
    horizonStartYear: 2025
  }, { currentYear: 2026 }),
  plus: { token: 'example-licence-token', activatedAt: '2026-10-01T09:00:00.000Z' },
  plusGift: { code: 'ABCD-EFGH-JKMN', org: 'Example Studio' }
});
const day = { focus: 'Ship the draft', endedAt: '2026-11-10T18:00:00' };

/** A plain cloud file, as Google Drive presents it to the sealed transport. */
function cloudFile(text = null) {
  const file = { text, writes: 0 };
  return {
    file,
    id: 'google',
    configured: true,
    signIn: 'popup',
    hasUsableToken: () => true,
    clearToken() {},
    async readText() { return file.text == null ? { exists: false, fileId: '', version: '', text: '' } : { exists: true, fileId: 'file_1', version: `v${file.writes}`, text: file.text }; },
    async writeText(next) { file.text = next; file.writes += 1; return { id: 'file_1', version: `v${file.writes}` }; }
  };
}

function device(cloud, { sealed }) {
  const storage = new MemoryStorage();
  const now = () => new Date('2026-11-11T09:00:00.000Z');
  const ledger = createSyncLedger(storage, { now });
  const store = createLocalStore(storage, { onMutation: ledger.recordMutation });
  const protection = createSyncProtection({ storage, keyStore: createMemoryKeyStore(), now });
  // Plain: the copy as a JSON document the engine reads and writes directly, as before 1.38.
  const plain = {
    async read() { return cloud.file.text == null ? { exists: false, fileId: '' } : { exists: true, fileId: 'file_1', document: JSON.parse(cloud.file.text) }; },
    async write(document) { cloud.file.text = JSON.stringify(document); cloud.file.writes += 1; return { id: 'file_1' }; }
  };
  const transport = sealed ? createSealedTransport({ provider: cloud, protection }) : plain;
  const engine = createSyncEngine({ store, ledger, now });
  return {
    storage,
    ledger,
    store,
    protection,
    sync: options => engine.sync(transport, options),
    settings: () => store.readJSON(SETTINGS_KEY),
    /** What 1.39 does as it starts (app.js). */
    async upgrade() { forgetRetiredData(storage); await restateRetiredBase(store, ledger); },
    /** A save of the settings in 1.39: normalised (the add-on fields go), then written. */
    save(change) { const next = normalizePlannerSettings(store.readJSON(SETTINGS_KEY), { currentYear: 2026 }); change(next); store.writeJSON(SETTINGS_KEY, next); }
  };
}

/**
 * Two devices in step on 1.38: the same settings and day on each, the copy and both ledgers' bases hashed with
 * the add-on fields in. Sealed: the laptop then sealed the copy, and the phone entered the passphrase.
 */
async function syncedOn138({ sealed }) {
  const settings = settings138();
  const record = async value => ({ updatedAt: '2026-11-01T08:00:00.000Z', deletedAt: null, hash: await contentHash(value), value });
  const records = { settings: await record(settings), 'day:2026-11-10': await record(day) };
  const cloud = cloudFile(JSON.stringify(createSyncDocument(records, { now: () => new Date('2026-11-01T08:00:00.000Z') })));
  const laptop = device(cloud, { sealed });
  const phone = device(cloud, { sealed });
  for (const d of [laptop, phone]) {
    d.store.writeJSON(SETTINGS_KEY, settings);
    d.store.writeJSON(DAY_KEY, day);
    for (const [recordId, { hash }] of Object.entries(records)) d.ledger.markSynced(recordId, { hash });
    d.ledger.setCopy({ cloud: 'google', id: '' });
    d.storage.setItem('daily-planner-ui:plus-verified', 'example-licence-token');
  }
  if (sealed) {
    await laptop.protection.adopt(await createSeal(PASSPHRASE, { iterations: MIN_ITERATIONS }));
    assert.equal((await laptop.sync()).status, 'ok');
    const { envelope } = readEnvelope(cloud.file.text);
    await phone.protection.adopt({ ...envelope, key: await phone.protection.unlockEnvelope(envelope, PASSPHRASE) });
    const joined = await phone.sync();
    assert.equal(joined.status, 'ok');
    assert.deepEqual(joined.pulled, [], 'the phone already holds what the copy holds');
  }
  return { cloud, laptop, phone };
}

/** The settings without the add-on fields, as they should be everywhere once a device has changed them. */
const carriedOver = () => { const { plus, plusGift, ...rest } = settings138(); return rest; };

for (const sealed of [false, true]) {
  const kind = sealed ? 'sealed' : 'plain';

  test(`${kind}: the phone upgrades first and changes its settings, then the laptop upgrades and pulls with no conflict`, async () => {
    const { laptop, phone } = await syncedOn138({ sealed });
    await phone.upgrade();
    assert.deepEqual((await phone.sync()).pushed, [], 'starting 1.39 changes nothing to sync');
    phone.save(settings => { settings.closeDayCount += 1; settings.horizon.years[2026].misogi = 'Walk the Camino, all of it'; });
    phone.store.writeJSON('daily-planner:2026-11-11', { focus: 'A new day on the phone' });
    assert.deepEqual((await phone.sync()).pushed, ['day:2026-11-11', 'settings']);

    await laptop.upgrade();
    assert.ok('plus' in laptop.settings(), 'the laptop’s settings are left as they are as it starts');
    const pulled = await laptop.sync();
    assert.equal(pulled.status, 'ok');
    assert.deepEqual(pulled.pulled, ['day:2026-11-11', 'settings']);
    assert.deepEqual(laptop.settings(), { ...carriedOver(), closeDayCount: 42, horizon: { years: { 2026: { ...carriedOver().horizon.years[2026], misogi: 'Walk the Camino, all of it' } } } });
    assert.equal(laptop.store.readJSON('daily-planner:2026-11-11').focus, 'A new day on the phone');

    // And back: a real change on the laptop reaches the phone.
    laptop.save(settings => { settings.startHour = 6; });
    assert.deepEqual((await laptop.sync()).pushed, ['settings']);
    const back = await phone.sync();
    assert.equal(back.status, 'ok');
    assert.equal(phone.settings().startHour, 6);
    assert.equal(phone.settings().closeDayCount, 42);
  });

  test(`${kind}: the laptop upgrades first and changes its settings, then the phone upgrades and pulls with no conflict`, async () => {
    const { laptop, phone } = await syncedOn138({ sealed });
    await laptop.upgrade();
    laptop.save(settings => { settings.closeDayCount += 1; });
    assert.equal((await laptop.sync()).status, 'ok');
    await phone.upgrade();
    const pulled = await phone.sync();
    assert.equal(pulled.status, 'ok');
    assert.deepEqual(pulled.pulled, ['settings']);
    assert.equal(phone.settings().closeDayCount, 42);
    phone.save(settings => { settings.endHour = 20; });
    assert.equal((await phone.sync()).status, 'ok');
    const back = await laptop.sync();
    assert.equal(back.status, 'ok');
    assert.equal(laptop.settings().endHour, 20);
  });

  test(`${kind}: both devices upgrade first: no conflict and nothing to send, then each one’s changes reach the other`, async () => {
    const { cloud, laptop, phone } = await syncedOn138({ sealed });
    await laptop.upgrade();
    await phone.upgrade();
    const writes = cloud.file.writes;
    for (const d of [laptop, phone]) {
      const result = await d.sync();
      assert.equal(result.status, 'ok');
      assert.deepEqual([result.pulled, result.pushed], [[], []]);
    }
    assert.equal(cloud.file.writes, writes, 'nothing written to the copy');
    assert.deepEqual(laptop.settings(), settings138(), 'the settings carry over as they are');

    phone.save(settings => { settings.closeDayCount += 1; });
    assert.equal((await phone.sync()).status, 'ok');
    assert.equal((await laptop.sync()).status, 'ok');
    laptop.save(settings => { settings.horizon.years[2026].misogi = 'Walk the Camino, all of it'; });
    assert.equal((await laptop.sync()).status, 'ok');
    assert.equal((await phone.sync()).status, 'ok');
    for (const d of [laptop, phone]) {
      assert.equal(d.settings().closeDayCount, 42);
      assert.equal(d.settings().horizon.years[2026].misogi, 'Walk the Camino, all of it');
      assert.equal('plus' in d.settings() || 'plusGift' in d.settings(), false);
    }
  });

  test(`${kind}: a save that only drops the add-on fields is no change, even offline while the other device changed the settings`, async () => {
    const { laptop, phone } = await syncedOn138({ sealed });
    await phone.upgrade();
    phone.save(settings => { settings.closeDayCount += 1; });
    assert.equal((await phone.sync()).status, 'ok');
    await laptop.upgrade();
    laptop.save(() => {});
    const result = await laptop.sync();
    assert.equal(result.status, 'ok');
    assert.deepEqual(result.pulled, ['settings']);
    assert.equal(laptop.settings().closeDayCount, 42);
  });
}

test('the copy never receives the add-on fields from 1.39, and keeps a record from 1.38 as it is until one is sent', async () => {
  const { cloud, laptop, phone } = await syncedOn138({ sealed: false });
  const held = () => JSON.parse(cloud.file.text).records.settings;
  await laptop.upgrade();
  laptop.store.writeJSON('daily-planner:2026-11-11', { focus: 'Only a day' });
  assert.deepEqual((await laptop.sync()).pushed, ['day:2026-11-11']);
  assert.ok(held().value.plus, 'the settings record of the copy is untouched by a sync that sends a day');
  laptop.save(settings => { settings.startHour = 6; });
  await laptop.sync();
  assert.equal('plus' in held().value || 'plusGift' in held().value, false);
  assert.equal(held().hash, await contentHash(held().value));
  // A device still on 1.38 puts its licence back: the 1.39 phone sees no change in that alone, and keeps none of it.
  await phone.upgrade();
  await phone.sync();
  const document = JSON.parse(cloud.file.text);
  const relicensed = { ...document.records.settings.value, plus: settings138().plus };
  document.records.settings = { ...document.records.settings, value: relicensed, hash: await contentHash(relicensed) };
  cloud.file.text = JSON.stringify(document);
  const result = await phone.sync();
  assert.deepEqual([result.status, result.pulled, result.pushed], ['ok', [], []]);
  assert.equal('plus' in phone.settings(), false);
});

test('a settings change made on 1.38 and not yet sent is sent after the upgrade, not taken for a conflict', async () => {
  const { laptop, phone } = await syncedOn138({ sealed: false });
  laptop.store.writeJSON(SETTINGS_KEY, { ...settings138(), startHour: 5 });
  await laptop.upgrade();
  const sent = await laptop.sync();
  assert.deepEqual([sent.status, sent.pushed], ['ok', ['settings']]);
  await phone.upgrade();
  const pulled = await phone.sync();
  assert.deepEqual([pulled.status, pulled.pulled], ['ok', ['settings']]);
  assert.equal(phone.settings().startHour, 5);
  assert.equal('plus' in phone.settings(), false);
});

test('a device that keeps the add-on fields and a copy that has none agree at a first sync (a new copy, or one started over)', async () => {
  const { laptop, phone } = await syncedOn138({ sealed: false });
  await phone.upgrade();
  phone.save(() => {});
  await phone.sync();
  laptop.ledger.resetBases({ cloud: '', id: '' });
  const result = await laptop.sync();
  assert.equal(result.status, 'ok', 'the same settings, with and without the fields: no conflict');
  assert.deepEqual(result.pushed, []);
});

test('the start-up restatement of the base writes only this device’s ledger, once, and only while the settings are as agreed', async () => {
  const { laptop } = await syncedOn138({ sealed: false });
  const settingsBefore = laptop.storage.getItem(SETTINGS_KEY);
  const base = laptop.ledger.entry('settings').lastSyncedHash;
  assert.equal(await restateRetiredBase(laptop.store, laptop.ledger), true);
  assert.equal(laptop.storage.getItem(SETTINGS_KEY), settingsBefore, 'the settings are not touched');
  const entry = laptop.ledger.entry('settings');
  assert.equal(entry.lastSyncedHash, await contentHash(carriedOver()));
  assert.equal(entry.dirtyAt, null, 'nothing to send');
  assert.notEqual(entry.lastSyncedHash, base);
  assert.equal(await restateRetiredBase(laptop.store, laptop.ledger), false, 'once');

  const { phone } = await syncedOn138({ sealed: false });
  phone.store.writeJSON(SETTINGS_KEY, { ...settings138(), startHour: 5 });
  const pending = phone.ledger.entry('settings').lastSyncedHash;
  assert.equal(await restateRetiredBase(phone.store, phone.ledger), false, 'a change not yet sent keeps its base');
  assert.equal(phone.ledger.entry('settings').lastSyncedHash, pending);

  const fresh = device(cloudFile(), { sealed: false });
  fresh.store.writeJSON(SETTINGS_KEY, settings138());
  assert.equal(await restateRetiredBase(fresh.store, fresh.ledger), false, 'a device that never synced has no base');
  const plain = device(cloudFile(), { sealed: false });
  plain.store.writeJSON(SETTINGS_KEY, carriedOver());
  plain.ledger.markSynced('settings', { hash: await contentHash(carriedOver()) });
  assert.equal(await restateRetiredBase(plain.store, plain.ledger), false, 'settings without the fields have nothing to restate');
});
