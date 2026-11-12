import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createBrowser } from './support/archive-tabs.js';
import { QuotaStorage, SAFARI_BUDGET, historyDays } from './support/history.js';
import { createDayStore } from '../src/state/day-store.js';
import { createMemoryArchive } from '../src/state/day-archive.js';
import { MANIFEST_KEY } from '../src/state/day-placement.js';
import { createSyncLedger } from '../src/sync/ledger.js';
import { createSyncEngine } from '../src/sync/engine.js';
import { createMemoryKeyStore } from '../src/sync/key-store.js';
import { PROTECTION_KEY, createSealedTransport, createSyncProtection } from '../src/sync/protection.js';
import { MIN_ITERATIONS, createSeal } from '../src/sync/seal.js';
import { OTHER_TABS_LINE, refreshResetDialog, resetLocalData, resetSyncLine, resetSyncNote } from '../src/features/reset-local.js';
import { createBlankDay, normalizeDayState } from '../src/state/day-state.js';
import { normalizePlannerSettings } from '../src/state/settings-state.js';
import { firstPlanningSlotAfter } from '../src/domain/planning-calendar.js';
import { FIRST_BLOCK_TITLE, firstBlock, isUntouchedFirstBlock } from '../src/state/first-block.js';
import { nothingDay } from '../src/sync/fresh.js';
import { ymdKey } from '../src/lib/dates.js';
import { createArchiveKeeper } from '../src/features/archive-keeper.js';

// Reset local data (1.40.1) touches only this browser: no tombstone, the ledger cleared, Personal sync turned off
// here, the copy never written. Two devices over a plain copy and over a sealed one.

const DAYS = historyDays(90);
const OLD = DAYS.slice(0, 30).map(([day]) => day);
const key = day => `daily-planner:${day}`;
const LEDGER_KEY = 'daily-planner-sync:ledger';
const NOW = () => new Date('2026-11-12T09:00:00.000Z');
const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

/** A device: its localStorage and archive, its day store, ledger and engine (open() again: a reload). */
function device(name, { seed = true } = {}) {
  const storage = new QuotaStorage(SAFARI_BUDGET);
  const archive = createMemoryArchive({ now: NOW });
  if (seed) for (const [day, value] of DAYS) storage.setItem(key(day), JSON.stringify(value));
  const d = { name, storage, archive, events: [] };
  d.open = () => {
    d.ledger = createSyncLedger(storage, { now: NOW });
    d.store = createDayStore(storage, { archive, onMutation: mutation => { d.events.push(mutation); d.ledger.recordMutation(mutation); }, ledgerDays: () => d.ledger.dayMarks(), forgetDays: days => d.ledger.forgetDays(days) });
    d.engine = createSyncEngine({ store: d.store, ledger: d.ledger, now: NOW });
    return d;
  };
  return d.open();
}

/** A plain copy (an object) or a sealed one (text, opened through each device's seal); `writes` counts provider writes. */
async function makeCloud(kind) {
  const plain = { document: null, writes: 0 };
  const plainProvider = { read: async () => (plain.document ? { exists: true, document: plain.document } : { exists: false }), write: async document => { plain.writes += 1; plain.document = JSON.parse(JSON.stringify(document)); } };
  const file = { text: null, writes: 0 };
  const raw = { id: 'dropbox', configured: true, signIn: 'redirect', hasUsableToken: () => true, clearToken() {}, async readText() { return file.text == null ? { exists: false, fileId: '', version: '', text: '' } : { exists: true, fileId: '/f', version: `v${file.writes}`, text: file.text }; }, async writeText(text) { file.text = text; file.writes += 1; return { id: '/f', version: `v${file.writes}` }; } };
  const seal = await createSeal('quiet harbour lantern', { iterations: MIN_ITERATIONS });
  const sealed = async d => {
    // A device with no key (a new one, or one Reset turned sync off on): the passphrase entered, the seal adopted.
    if (!d.protection) {
      d.protection = createSyncProtection({ storage: d.storage, keyStore: createMemoryKeyStore(), now: NOW });
      await d.protection.adopt(seal);
    }
    return createSealedTransport({ provider: raw, protection: d.protection });
  };
  const cloud = kind === 'plain' ? { kind, transport: async () => plainProvider, writes: () => plain.writes } : { kind, transport: sealed, writes: () => file.writes };
  /** The copy's records as a device that can open it reads them. */
  cloud.records = async reader => (await (await cloud.transport(reader)).read()).document?.records || {};
  return cloud;
}

const sync = async (cloud, d, options) => d.engine.sync(await cloud.transport(d), options);

/** Personal sync as Reset turns it off here (src/features/personal-sync.js forgetHere(), tested there): the seal's key and the ledger. */
const syncOf = d => ({ forgetHere: async () => { if (d.protection) { await d.protection.forget({ everything: true }); d.protection = null; } d.ledger.reset(); return 'Dropbox'; } });

const tombstones = records => Object.entries(records).filter(([, record]) => record?.deletedAt).map(([id]) => id);

for (const kind of ['plain', 'sealed']) {
  test(`${kind}: A resets while connected, B syncs: nothing deleted, the copy unchanged, and A writes nothing; A connects again: every day back, no tombstone anywhere`, async () => {
    const cloud = await makeCloud(kind);
    const a = device('A');
    assert.ok((await a.store.moveDays([OLD])).moved > 0, 'older days in the archive: both homes');
    assert.equal((await sync(cloud, a)).status, 'ok');
    const b = device('B', { seed: false });
    assert.equal((await sync(cloud, b)).status, 'ok');
    const before = JSON.stringify(await cloud.records(b));
    const writes = cloud.writes();
    a.events.length = 0;

    const reset = await resetLocalData({ store: a.store, ledger: a.ledger, sync: syncOf(a) });
    assert.equal(reset.cloud, 'Dropbox');
    assert.deepEqual(a.events, [], 'no mutation: nothing for any sync to send');
    assert.deepEqual(a.store.keys('daily-planner:'), [], 'nothing left here');
    assert.equal(a.archive.data.size, 0, 'nor in the archive');
    assert.equal(a.storage.getItem(LEDGER_KEY), null, 'the ledger cleared');
    assert.equal(a.storage.getItem('daily-planner-sync:dropbox'), null, 'the connection forgotten');
    if (kind === 'sealed') assert.equal(a.storage.getItem(PROTECTION_KEY), null, 'the seal’s key material gone here');
    assert.equal(cloud.writes(), writes, 'A never wrote the copy');

    const synced = await sync(cloud, b);
    assert.equal(synced.status, 'ok');
    assert.deepEqual([synced.pushed, synced.pulled], [[], []]);
    assert.equal(JSON.stringify(await cloud.records(b)), before, 'the copy unchanged');
    assert.equal(cloud.writes(), writes);
    for (const [day, value] of DAYS) assert.equal(b.store.get(key(day)), JSON.stringify(value), `B keeps ${day}`);

    // A connects again (a reload, then the first connection: for a sealed copy, its passphrase entered).
    a.open();
    assert.deepEqual(Object.keys(a.ledger.read().records || {}), [], 'no base: the rule that pulls back a vanished day never applies');
    const back = await sync(cloud, a);
    assert.equal(back.status, 'ok');
    assert.deepEqual(back.pushed, []);
    assert.equal(back.pulled.length, DAYS.length, 'every day');
    for (const [day, value] of DAYS) assert.equal(a.store.get(key(day)), JSON.stringify(value), `A has ${day} again`);
    assert.deepEqual(tombstones(await cloud.records(b)), [], 'no tombstone in the copy');
    assert.equal(a.ledger.deletedDays().size + b.ledger.deletedDays().size, 0, 'nor on either device');
    assert.equal((await sync(cloud, b)).pulled.length, 0, 'B sees nothing new');
  });

  test(`${kind}: Reset while disconnected, then connecting to the existing copy: nothing deleted, every day back`, async () => {
    const cloud = await makeCloud(kind);
    const a = device('A');
    assert.equal((await sync(cloud, a)).status, 'ok');
    // Disconnect: the ledger keeps its bases (as Disconnect does), the seal's key goes.
    if (a.protection) { await a.protection.forget({ everything: true }); a.protection = null; }
    const b = device('B', { seed: false });
    assert.equal((await sync(cloud, b)).status, 'ok');
    const before = JSON.stringify(await cloud.records(b));
    // Reset with Personal sync off: no sync to turn off, the ledger cleared all the same.
    await resetLocalData({ store: a.store, ledger: a.ledger, sync: { forgetHere: async () => '' } });
    assert.equal(a.storage.getItem(LEDGER_KEY), null);
    a.open();
    const connected = await sync(cloud, a);
    assert.equal(connected.status, 'ok');
    assert.deepEqual(connected.pushed, [], 'nothing deleted from the copy');
    assert.equal(JSON.stringify(await cloud.records(b)), before);
    for (const [day, value] of DAYS) assert.equal(a.store.get(key(day)), JSON.stringify(value));
  });
}

test('Reset with an archive (days in both homes): no tombstone, nothing left in either home, the copies kept aside gone too', async () => {
  const browser = createBrowser();
  const a = browser.tab();
  await a.pass();
  await browser.archive.keepAside([{ day: '2001-02-03', json: '{"focus":"an earlier copy"}' }]);
  assert.ok(browser.archive.data.size > 0);
  // The ledger knows every day (as after a first sync).
  a.ledger.deferMarks(() => browser.days.forEach(([day]) => a.ledger.recordMutation({ type: 'set', key: key(day) })));
  a.events.length = 0;
  const { removed } = await resetLocalData({ store: a.store, ledger: a.ledger, keys: ['daily-planner-ui:trophies-seen'] });
  assert.equal(removed, browser.days.length + 1, 'every day, and the settings');
  assert.deepEqual(a.events, [], 'no mutation');
  assert.equal(a.ledger.deletedDays().size, 0, 'no tombstone');
  for (let i = 0; i < browser.base.length; i += 1) assert.ok(!browser.base.key(i).startsWith('daily-planner:'), `nothing in localStorage: ${browser.base.key(i)}`);
  assert.equal(browser.base.getItem(MANIFEST_KEY), null);
  assert.equal(browser.archive.data.size, 0, 'nothing in the archive');
  assert.equal(browser.archive.aside.length, 0);
  browser.closeTabs();
  const c = browser.tab();
  assert.equal(await c.store.ready(), 'none');
  assert.deepEqual(c.store.keys('daily-planner:'), []);
});

test('the ledger after Reset: empty, with no deletedAt entry, the clouds’ states and the cloud chosen gone too', async () => {
  const storage = new QuotaStorage(SAFARI_BUDGET);
  const ledger = createSyncLedger(storage, { now: NOW });
  const store = createDayStore(storage, { archive: createMemoryArchive({ now: NOW }), onMutation: ledger.recordMutation, ledgerDays: () => ledger.dayMarks(), forgetDays: days => ledger.forgetDays(days) });
  store.writeJSON(key('2026-11-10'), { focus: 'one' });
  store.writeJSON(key('2026-11-11'), { focus: 'two' });
  store.remove(key('2026-11-10'));
  ledger.saveProvider({ connected: true, lastSyncedAt: '2026-11-11T08:00:00.000Z' }, 'google');
  ledger.setCloud('google');
  assert.equal(ledger.deletedDays().size, 1, 'a deletion made before the Reset');
  await resetLocalData({ store, ledger });
  assert.equal(storage.getItem(LEDGER_KEY), null);
  assert.deepEqual(ledger.read().records || {}, {});
  assert.deepEqual(ledger.dirtyEntries(), []);
  assert.equal(ledger.deletedDays().size, 0, 'no deletedAt left, not even one made before');
  assert.equal(ledger.provider('google').connected, false);
  assert.equal(storage.getItem('daily-planner-sync:cloud'), null);
  assert.equal(store.get(key('2026-11-11')), null);
});

test('Reset turns Personal sync off first, then removes the days: a sync can never run between', async () => {
  const order = [];
  const store = { clearAll: async () => { order.push('days'); return 0; }, withoutMutationTracking: fn => fn(), remove() {} };
  await resetLocalData({ store, ledger: { reset: () => order.push('ledger') }, sync: { forgetHere: async () => { order.push('sync off'); return 'Google Drive'; } }, forgetSnapshots: async () => { order.push('snapshots'); return 2; } });
  assert.deepEqual(order, ['sync off', 'days', 'ledger', 'snapshots']);
});

test('the dialog says it when Personal sync is connected, with the cloud’s name; otherwise nothing more', () => {
  assert.equal(resetSyncLine('Dropbox'), 'Personal sync is turned off in this browser. Your copy in Dropbox and your other devices keep everything; connect again to bring your plans back.');
  assert.equal(resetSyncNote({ connected: true, name: 'Google Drive' }), 'Personal sync is turned off in this browser. Your copy in Google Drive and your other devices keep everything; connect again to bring your plans back.');
  assert.equal(resetSyncNote({ connected: false, name: 'Dropbox' }), '');
  assert.equal(resetSyncNote({}), '');
  const html = read('index.html');
  assert.match(html, /<p>This permanently removes every saved day, category and planner setting stored by this app in this browser\. This cannot be undone after deletion\.<\/p>\n\s*<p class="reset-sync-note" data-reset-sync-note hidden><\/p>/);
  assert.match(html, /<strong>Export first if you may want this data later\.<\/strong>/, 'Export first stays');
  const app = read('app.js');
  assert.match(app, /const resetDialog = \(\) => refreshResetDialog\(\{ modal: qs\('\[data-reset-modal\]'\), sync: personalSyncFeature, otherTabs: \(\) => archiveKeeper\.otherTabsOpen\(\) \}\);/);
  assert.match(app, /qs\('\[data-reset-open\]'\)\.addEventListener\('click', \(\) => \{ resetDialog\(\); openModal\(qs\('\[data-reset-modal\]'\)\); \}\);/);
  assert.match(app, /await resetLocalData\(\{ store, ledger: syncLedger, sync: personalSyncFeature, keys: \['daily-planner-ui:trophies-seen', IMPORT_ROOM_KEY\], forgetSnapshots: \(\) => archiveKeeper\.forget\(\), otherTabs: \(\) => archiveKeeper\.otherTabsOpen\(\) \}\);/);
  assert.doesNotMatch(app, /clearAll\('daily-planner:', \{ bulk/, 'no removal tracked for sync');
  assert.ok(read('sw.js').includes("'./src/features/reset-local.js'"), 'offline too');
});

test('deleting one day still syncs as a deletion: only Reset leaves no tombstone', async () => {
  const d = device('A');
  d.store.remove(key(DAYS[60][0]));
  assert.equal(d.ledger.deletedDays().has(DAYS[60][0]), true);
  void createBlankDay;
});

// --- The 1.40.1 review (scratchpad review-1.40.1: plain-late, after-reset), ported: these failed on d1d70f9 ----------

const SHAPED = { startHour: 7, onboardingComplete: true, closeDayCount: 12, categories: [{ id: 'deep-work', name: 'Deep work', color: '#5f7084' }, { id: 'garden', name: 'Garden', color: '#5f755b' }], horizon: { years: { 2026: { goals: ['Write the book'] } } } };
const ONBOARDED = { startHour: 9, endHour: 17, onboardingComplete: true, planningDays: [1, 2, 3, 4, 5], openWork: [], horizon: { years: {} } };

test('F1, plain copy: an upload finishing after the Reset leaves no base, so the reconnect after onboarding never sends the new settings over the copy’s', async () => {
  const browser = createBrowser();
  const a = browser.tab();
  a.store.writeJSON('daily-planner:settings', SHAPED);
  const copy = { document: null, gate: null };
  const provider = {
    read: async () => (copy.document ? { exists: true, document: copy.document } : { exists: false }),
    write: async document => { if (copy.gate) await copy.gate; copy.document = JSON.parse(JSON.stringify(document)); }
  };
  const engine = createSyncEngine({ store: a.store, ledger: a.ledger, now: NOW });
  await engine.sync(provider);
  a.store.writeJSON('daily-planner:settings', { ...SHAPED, startHour: 8 });
  let release;
  copy.gate = new Promise(resolve => { release = resolve; });
  const syncing = engine.sync(provider);
  await new Promise(resolve => setTimeout(resolve, 200)); // uploading
  await resetLocalData({ store: a.store, ledger: a.ledger, sync: { forgetHere: async () => { a.ledger.reset(); return 'Dropbox'; } } });
  copy.gate = null;
  release();
  await assert.rejects(syncing, error => error.code === 'reset', 'the late sync stops');
  assert.equal(browser.base.getItem(LEDGER_KEY), null, 'no base left for the settings');
  a.store.writeJSON('daily-planner:settings', ONBOARDED); // onboarding again
  const reconnect = await engine.sync(provider);
  assert.equal(reconnect.status, 'ok');
  assert.ok(!reconnect.pushed.includes('settings'));
  assert.deepEqual(copy.document.records.settings.value.horizon, SHAPED.horizon, 'the copy keeps its settings');
  assert.deepEqual(JSON.parse(a.store.get('daily-planner:settings')).horizon, SHAPED.horizon, 'and this browser gets them back');
});

for (const kind of ['plain', 'sealed']) {
  test(`F2, ${kind}: Reset, onboarding, then connect again: the copy’s settings and every day come back with no conflict, and device B keeps its settings`, async () => {
    const cloud = await makeCloud(kind);
    const a = device('A');
    a.store.writeJSON('daily-planner:settings', SHAPED);
    assert.equal((await sync(cloud, a)).status, 'ok');
    const b = device('B', { seed: false });
    assert.equal((await sync(cloud, b)).status, 'ok');
    await resetLocalData({ store: a.store, ledger: a.ledger, sync: syncOf(a) });
    // The planner opens as new: onboarding runs as the planner runs it (pass 2: its settings and its sample block),
    // and today is opened (a blank day saved, say).
    finishOnboarding(a.store, { now: new Date('2026-11-12T07:00:00') });
    a.store.writeJSON(key('2026-11-13'), createBlankDay());
    a.open();
    const first = await sync(cloud, a);
    assert.equal(first.status, 'ok', 'no conflict over the settings onboarding saved');
    assert.ok(!first.pushed.includes('settings'));
    assert.deepEqual(JSON.parse(a.store.get('daily-planner:settings')), SHAPED, 'the copy’s settings here again');
    for (const [day, value] of DAYS) assert.equal(a.store.get(key(day)), JSON.stringify(value));
    await sync(cloud, b);
    assert.deepEqual(JSON.parse(b.store.get('daily-planner:settings')), SHAPED, 'device B keeps its settings');
  });
}

test('F2: a browser with plans of its own still gets the normal flow on a first connection: a conflict, never the copy taken over them', async () => {
  const cloud = await makeCloud('plain');
  const b = device('B');
  b.store.writeJSON('daily-planner:settings', SHAPED);
  assert.equal((await sync(cloud, b)).status, 'ok');
  const c = device('C', { seed: false });
  c.store.writeJSON('daily-planner:settings', ONBOARDED);
  c.store.writeJSON(key(DAYS[5][0]), { ...DAYS[5][1], focus: 'Planned on this device first' });
  const first = await sync(cloud, c);
  assert.equal(first.status, 'conflict');
  assert.deepEqual(first.conflicts.sort(), [`day:${DAYS[5][0]}`, 'settings'].sort());
  // Settings shaped here (a category of its own), with no day: the normal flow too.
  const d = device('D', { seed: false });
  d.store.writeJSON('daily-planner:settings', { ...ONBOARDED, categories: [{ id: 'deep-work', name: 'Deep work', color: '#5f7084' }] });
  assert.equal((await sync(cloud, d)).status, 'conflict');
});

test('F2: what counts as fresh (src/sync/fresh.js): the defaults and onboarding’s choices, never anything the person built', async () => {
  const { freshSettings, freshRecords } = await import('../src/sync/fresh.js');
  const { createDefaultSettings } = await import('../src/state/settings-state.js');
  assert.equal(freshSettings(null), true, 'none saved yet');
  assert.equal(freshSettings(createDefaultSettings()), true, 'the defaults');
  assert.equal(freshSettings({ ...createDefaultSettings(), startHour: 6, endHour: 20, planningDays: [0, 1, 2, 3, 4, 5, 6], weekStartsOn: 0, weekStartsOnExplicit: true, onboardingComplete: true }), true, 'onboarding’s choices');
  assert.equal(freshSettings({ ...createDefaultSettings(), closeDayCount: 1 }), false, 'a day closed');
  assert.equal(freshSettings({ ...createDefaultSettings(), openWork: [{ id: 'o', text: 'Later' }] }), false, 'something in Later');
  assert.equal(freshSettings({ ...createDefaultSettings(), horizon: { years: { 2026: { goals: ['A goal'] } } } }), false, 'a plan for the year');
  assert.equal(freshSettings({ ...createDefaultSettings(), horizon: { years: { 2026: { goals: [''] } } } }), true, 'an empty one');
  const renamed = createDefaultSettings();
  renamed.categories[0] = { ...renamed.categories[0], name: 'Focus' };
  assert.equal(freshSettings(renamed), false, 'a category renamed');
  const archived = createDefaultSettings();
  archived.categories[1] = { ...archived.categories[1], archived: true };
  assert.equal(freshSettings(archived), false, 'a category archived');
  assert.equal(freshSettings('{not json'), false);
  assert.equal(freshRecords({ settings: { value: createDefaultSettings() }, 'day:2026-11-12': { value: createBlankDay() } }), true, 'a blank day is nothing');
  assert.equal(freshRecords({ 'day:2026-11-12': { value: { ...createBlankDay(), focus: 'x' } } }), false);
});

test('F1: a settings record missing here that still has a base, and is in the copy, is pulled back, never deleted from the copy', async () => {
  const cloud = await makeCloud('plain');
  const a = device('A');
  a.store.writeJSON('daily-planner:settings', SHAPED);
  assert.equal((await sync(cloud, a)).status, 'ok');
  a.storage.removeItem('daily-planner:settings'); // gone without a tracked removal (as the late base after a Reset left it)
  const synced = await sync(cloud, a);
  assert.ok(!synced.pushed.includes('settings'));
  assert.ok(synced.pulled.includes('settings'));
  assert.deepEqual(JSON.parse(a.store.get('daily-planner:settings')), SHAPED);
  assert.ok((await cloud.records(a)).settings && !(await cloud.records(a)).settings.deletedAt);
});

test('F3: a Reset interrupted while the database is emptied leaves its flag, so nothing it removed is ever adopted back', async () => {
  const { HISTORY_TODAY, historyBackup } = await import('./support/history.js');
  const { RESET_KEY } = await import('../src/state/day-store.js');
  const browser = createBrowser();
  const a = browser.tab();
  const pass = await a.pass();
  const moved = browser.days.slice(0, pass.moved).map(([day]) => day);
  // The tab closes while the database is being emptied: clearDatabase() never answers.
  const realExists = browser.archive.exists;
  browser.archive.exists = () => new Promise(() => {});
  a.store.clearAll('daily-planner:');
  await new Promise(resolve => setTimeout(resolve, 50));
  browser.archive.exists = realExists;
  assert.ok(browser.base.getItem(RESET_KEY) != null, 'the flag, written before anything went');
  browser.closeTabs();
  const b = browser.tab();
  await b.store.finishReset();
  await b.store.ready();
  await b.store.importDays(historyBackup(historyDays(5, { today: '2018-06-01' })), { today: HISTORY_TODAY, goal: 0 });
  assert.deepEqual(moved.filter(day => b.store.get(key(day)) != null), [], 'days removed by Reset never come back');
  assert.equal(browser.base.getItem(RESET_KEY), null, 'finished, and the flag gone');
});

test('F2, engine (the review’s proof): Reset, onboarding, the first connection, then “Keep this device”: device B never loses its settings', async () => {
  const browser = createBrowser();
  const a = browser.tab();
  a.store.writeJSON('daily-planner:settings', SHAPED);
  const copy = { document: null };
  const provider = { read: async () => (copy.document ? { exists: true, document: copy.document } : { exists: false }), write: async document => { copy.document = JSON.parse(JSON.stringify(document)); } };
  assert.equal((await createSyncEngine({ store: a.store, ledger: a.ledger, now: NOW }).sync(provider)).status, 'ok');
  const b = device('B', { seed: false });
  await b.engine.sync(provider);
  await resetLocalData({ store: a.store, ledger: a.ledger, sync: { forgetHere: async () => { a.ledger.reset(); return 'Dropbox'; } } });
  a.store.writeJSON('daily-planner:settings', { startHour: 8, onboardingComplete: true });
  const engineA = createSyncEngine({ store: a.store, ledger: a.ledger, now: NOW });
  const first = await engineA.sync(provider);
  assert.equal(first.status, 'ok', 'no conflict over the settings onboarding saved');
  await engineA.sync(provider, { conflictResolution: 'local' });
  await b.engine.sync(provider);
  assert.deepEqual(JSON.parse(b.store.get('daily-planner:settings')).horizon, SHAPED.horizon, 'connecting again after Reset never costs the other devices their settings');
});

// --- The 1.40.1 second review (scratchpad review-1.40.1/pass2: attack.test.js 1 and 3), ported: failed on 1152b15 ---


/**
 * Onboarding's finish() as the planner runs it (src/features/onboarding.js finish(): the planning days and
 * onboardingComplete, then app.js seedFirstBlockAfterOnboarding(): the sample block at the first planning slot, on
 * that day as the planner loads it, then the settings saved). Returns the sample's day.
 */
function finishOnboarding(store, { now, planningDays = [1, 2, 3, 4, 5] } = {}) {
  const settings = normalizePlannerSettings(store.readJSON('daily-planner:settings'));
  settings.planningDays = [...planningDays].sort((x, y) => x - y);
  settings.onboardingComplete = true;
  const { date, startMinutes } = firstPlanningSlotAfter(now, settings, { startMinutes: settings.startHour * 60, endMinutes: settings.endHour * 60 });
  const day = ymdKey(date);
  const state = normalizeDayState(store.readJSON(key(day)), day);
  if (!state.blocks.length) {
    state.blocks.push(firstBlock({ day, startMinutes }));
    store.writeJSON(key(day), state);
  }
  store.writeJSON('daily-planner:settings', settings);
  return day;
}

test('N1: the helper above is the planner’s own onboarding finish', () => {
  const app = read('app.js');
  assert.match(app, /const \{ date: targetDate, startMinutes \} = firstPlanningSlotAfter\(new Date\(\), settings, \{ startMinutes: visibleStartMinutes\(\), endMinutes: visibleEndMinutes\(\) \}\);/);
  assert.match(app, /const targetState = targetKey === ymd\(date\) \? state : loadStateForDate\(targetDate\);\n\s*if \(!\(targetState\.blocks \|\| \[\]\)\.length\) \{\n[^\n]*\n\s*targetState\.blocks\.push\(firstBlock\(\{ day: targetKey, startMinutes \}\)\);\n\s*persistStateForDate\(targetDate, targetState\);/);
  assert.match(read('src/features/onboarding.js'), /s\.planningDays = \[\.\.\.draftDays\]\.sort\(\(a, b\) => a - b\);\n\s*s\.onboardingComplete = true;\n[^\n]*\n\s*keepTheme\(\);\n\s*seedFirstBlock\(\);\n\s*persistSettings\(\);/);
});

const weekday = day => new Date(`${day}T12:00:00`).getDay();
const SAMPLE_DAY = DAYS.map(([day]) => day).find(day => weekday(day) >= 1 && weekday(day) <= 5);

for (const kind of ['plain', 'sealed']) {
  test(`N1, ${kind}: Reset, the real onboarding finish (its sample block), then connect again: the copy’s settings and every day come back, the copy’s real day on the sample’s date wins, no conflict, and device B is unchanged`, async () => {
    const cloud = await makeCloud(kind);
    const a = device('A');
    a.store.writeJSON('daily-planner:settings', SHAPED);
    assert.equal((await sync(cloud, a)).status, 'ok');
    const b = device('B', { seed: false });
    assert.equal((await sync(cloud, b)).status, 'ok');
    const before = JSON.stringify(await cloud.records(b));
    await resetLocalData({ store: a.store, ledger: a.ledger, sync: syncOf(a) });
    const day = finishOnboarding(a.store, { now: new Date(`${SAMPLE_DAY}T07:00:00`) });
    assert.equal(day, SAMPLE_DAY, 'the sample lands on a day the copy holds');
    assert.ok(JSON.parse(a.store.get(key(day))).blocks.some(block => block.title === FIRST_BLOCK_TITLE));
    a.open();
    const first = await sync(cloud, a);
    assert.equal(first.status, 'ok', 'no conflict card');
    assert.deepEqual(first.pushed, [], 'nothing of the reset browser’s reaches the copy');
    assert.deepEqual(JSON.parse(a.store.get('daily-planner:settings')), SHAPED, 'the copy’s settings');
    for (const [d, value] of DAYS) assert.equal(a.store.get(key(d)), JSON.stringify(value), `the copy’s ${d}`);
    assert.equal(JSON.stringify(await cloud.records(b)), before, 'the copy unchanged');
    const synced = await sync(cloud, b);
    assert.deepEqual([synced.pushed, synced.pulled], [[], []], 'device B unchanged');
  });
}

test('N1: the sample on a day the copy doesn’t hold is removed here, never sent: device B never gets it', async () => {
  const cloud = await makeCloud('plain');
  const a = device('A');
  a.store.writeJSON('daily-planner:settings', SHAPED);
  await sync(cloud, a);
  const b = device('B', { seed: false });
  await sync(cloud, b);
  await resetLocalData({ store: a.store, ledger: a.ledger, sync: syncOf(a) });
  const day = finishOnboarding(a.store, { now: new Date('2026-11-12T07:00:00') });
  assert.ok(!DAYS.some(([d]) => d === day));
  a.open();
  const first = await sync(cloud, a);
  assert.equal(first.status, 'ok');
  assert.deepEqual(first.pushed, []);
  assert.deepEqual(first.dropped, [`day:${day}`]);
  assert.equal(a.store.get(key(day)), null, 'the sample gone with the planner as it was');
  assert.equal(a.ledger.dirtyEntries().length, 0, 'nothing waits to be sent');
  assert.deepEqual((await sync(cloud, b)).pulled, []);
});

test('N1: onboarding’s sample on a brand new copy is kept and sent, as before: there is no copy to take', async () => {
  const cloud = await makeCloud('plain');
  const a = device('A', { seed: false });
  const day = finishOnboarding(a.store, { now: new Date('2026-11-12T07:00:00') });
  const first = await sync(cloud, a);
  assert.ok(first.pushed.includes(`day:${day}`));
  assert.ok(a.store.get(key(day)));
});

test('N1: an edited, moved, resized or ticked sample is the person’s: not fresh, and a first connection gets the normal conflict', async () => {
  const day = '2026-11-12';
  const seeded = firstBlock({ day, startMinutes: 600 });
  const dayWith = block => JSON.stringify({ ...normalizeDayState(null, day), blocks: [block] });
  assert.equal(isUntouchedFirstBlock(seeded, day), true);
  assert.equal(nothingDay(dayWith(seeded), day), true);
  const cases = [
    ['edited', { ...seeded, title: 'Write the plan' }, day],
    ['moved', { ...seeded, start: 660 }, day],
    ['moved to another day', { ...seeded, startDate: '2026-11-13', endDate: '2026-11-13' }, '2026-11-13'],
    ['resized', { ...seeded, duration: 90 }, day],
    ['ticked', { ...seeded, done: true, completedAt: '2026-11-12T10:30:00.000Z' }, day],
    ['given a category', { ...seeded, categoryId: 'admin' }, day],
    ['given notes', { ...seeded, notes: 'Bring the slides' }, day]
  ];
  for (const [why, block, on] of cases) assert.equal(nothingDay(dayWith(block), on), false, why);
  assert.equal(nothingDay(JSON.stringify({ ...normalizeDayState(null, day), focus: 'Ship it', blocks: [seeded] }), day), false, 'anything else on that day');
  assert.equal(nothingDay(JSON.stringify({ ...normalizeDayState(null, day), blocks: [seeded, firstBlock({ day, startMinutes: 720 })] }), day), false, 'two blocks');
  // Engine: Reset, onboarding, the sample edited, then connect again: both sides hold something real.
  const cloud = await makeCloud('plain');
  const a = device('A');
  a.store.writeJSON('daily-planner:settings', SHAPED);
  await sync(cloud, a);
  await resetLocalData({ store: a.store, ledger: a.ledger, sync: syncOf(a) });
  const sample = finishOnboarding(a.store, { now: new Date(`${SAMPLE_DAY}T07:00:00`) });
  const edited = JSON.parse(a.store.get(key(sample)));
  edited.blocks[0].title = 'Draft the chapter';
  a.store.writeJSON(key(sample), edited);
  a.open();
  const first = await sync(cloud, a);
  assert.equal(first.status, 'conflict');
  assert.equal(first.first, true, 'a first connection: the card weighs both choices the same (tests/reset-in-flight.test.js)');
  assert.deepEqual(first.conflicts.sort(), [`day:${sample}`, 'settings'].sort());
});

// --- N3: no Reset while another planner tab is open (any release) -----------------------------------------------

/** The archive keeper's roll call over fake Web Locks (`holders` tab locks) and a service worker counting `windows`. */
function keeperSeeing({ holders, windows = null, localDev = false }) {
  const locks = { request: async (name, options, callback) => (callback || options)({ name }), query: async () => ({ held: Array.from({ length: holders }, () => ({ name: 'daily-planner:tab', mode: 'shared' })) }) };
  const controller = windows == null ? null : { postMessage(message, [port]) { setTimeout(() => port.postMessage({ type: 'planner-windows', windows, version: '1.40.1' }), 1); } };
  return createArchiveKeeper({ store: {}, nav: { locks, serviceWorker: { controller } }, win: null, doc: null, localDev, askMs: 40 });
}

test('N3: another planner tab, of any release, is seen: two 1.40.1 tabs (two tab locks), a 1.40.0 or 1.39.4 window (the worker counts it), not this tab alone', async () => {
  assert.equal(await keeperSeeing({ holders: 2 }).otherTabsOpen(), true, 'two tabs of 1.40 or later');
  assert.equal(await keeperSeeing({ holders: 1, windows: 2 }).otherTabsOpen(), true, 'a window that holds no tab lock: an older release');
  assert.equal(await keeperSeeing({ holders: 1, windows: 1 }).otherTabsOpen(), false, 'this tab alone (its floating window is no planner window)');
  assert.equal(await keeperSeeing({ holders: 1 }).otherTabsOpen(), false, 'no worker answering: the locks alone');
  assert.equal(await keeperSeeing({ holders: 2, localDev: true }).otherTabsOpen(), true, 'on localhost, the locks');
});

test('N3 (the review’s 1.40.0 tab, its sync in flight): Reset is refused while it is open, so nothing it pulls back can undo one', async () => {
  const browser = createBrowser();
  const a = browser.tab();
  const keeper = keeperSeeing({ holders: 1, windows: 2 });
  const before = browser.base.length;
  const reset = await resetLocalData({ store: a.store, ledger: a.ledger, sync: syncOf(a), otherTabs: () => keeper.otherTabsOpen() });
  assert.equal(reset.refused, true);
  assert.equal(browser.base.length, before, 'nothing removed, nothing turned off');
  assert.equal(browser.base.getItem('daily-planner-sync:generation'), null);
  for (const [day, value] of browser.days.slice(0, 20)) assert.equal(a.store.get(key(day)), JSON.stringify(value));
  // Alone again: it runs.
  assert.equal((await resetLocalData({ store: a.store, ledger: a.ledger, otherTabs: () => keeperSeeing({ holders: 1, windows: 1 }).otherTabsOpen() })).refused, undefined);
  assert.deepEqual(a.store.keys('daily-planner:'), []);
});

test('N3: the Reset dialog says so in plain words, and Export stays', async () => {
  const elements = { '[data-reset-sync-note]': { textContent: '', hidden: true }, '[data-reset-blocked]': { textContent: '', hidden: true } };
  const modal = { querySelector: selector => elements[selector] || null };
  assert.equal(await refreshResetDialog({ modal, sync: { getState: () => ({ configured: true, connected: true }), provider: { name: 'Dropbox' } }, otherTabs: async () => true }), false);
  assert.equal(OTHER_TABS_LINE, 'The planner is open in another tab. Close it there first, then reset.');
  assert.deepEqual([elements['[data-reset-blocked]'].textContent, elements['[data-reset-blocked]'].hidden], [OTHER_TABS_LINE, false]);
  assert.equal(elements['[data-reset-sync-note]'].hidden, false, 'and the sync line, as before');
  assert.equal(await refreshResetDialog({ modal, otherTabs: async () => false }), true);
  assert.deepEqual([elements['[data-reset-blocked]'].textContent, elements['[data-reset-blocked]'].hidden], ['', true]);
  const html = read('index.html');
  assert.match(html, /<p class="reset-sync-note" data-reset-sync-note hidden><\/p>\n\s*<p class="reset-blocked" data-reset-blocked role="status" hidden><\/p>/);
  assert.match(html, /<button class="secondary-button icon-text-button" type="button" data-reset-export>/, 'Export first, always there');
  const app = read('app.js');
  assert.match(app, /async function resetPlannerData\(\) \{\n[^\n]*\n\s*if \(!\(await resetDialog\(\)\)\) return;\n\s*clearTimeout\(saveTimer\);/, 'checked first, before anything changes');
});
