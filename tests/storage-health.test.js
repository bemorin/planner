import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createLocalStore } from '../src/state/local-store.js';
import { createSyncLedger } from '../src/sync/ledger.js';
import { CHROMIUM_BUDGET_CHARS, SAFARI_BUDGET_CHARS, createSaveHealth, LEDGER_KEY, STORAGE_WARN_SHARE, measureStorage, storageBudget, storageLevel } from '../src/state/storage-health.js';
import { buildPlannerBackup } from '../src/state/planner-backup.js';
import { ARCHIVE_IN_USE, ARCHIVE_LOST, ARCHIVE_SETTLE, ARCHIVE_UNAVAILABLE, ASIDE_LEAD, ASIDE_SEEN_KEY, FULL_LEAD, FULL_TITLE, RESET_LEFT_LEAD, RESET_LEFT_TITLE, SYNC_LEAD, WARNED_KEY, asideDayLabel, asideTitle, createStorageAlert, keptAsideLine, storageAlertView, storageSafetyLine } from '../src/features/storage-alert.js';
import { fakeDocument } from './support/fake-dom.js';

// A save the browser refuses (its storage full) is told, and lasts until a later save lands (1.39.3); storage 80%
// full is told too, once a day.

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

/** localStorage with a quota in characters (keys and values, as browsers count them). */
class QuotaStorage {
  constructor(quota = Infinity) { this.quota = quota; this.data = new Map(); }
  get length() { return this.data.size; }
  key(index) { return [...this.data.keys()][index] ?? null; }
  getItem(key) { return this.data.has(String(key)) ? this.data.get(String(key)) : null; }
  used() { let chars = 0; for (const [key, value] of this.data) chars += key.length + value.length; return chars; }
  setItem(key, value) {
    const name = String(key);
    const before = this.data.has(name) ? name.length + this.data.get(name).length : 0;
    if (this.used() - before + name.length + String(value).length > this.quota) {
      const error = new Error('The quota has been exceeded.');
      error.name = 'QuotaExceededError';
      throw error;
    }
    this.data.set(name, String(value));
  }
  removeItem(key) { this.data.delete(String(key)); }
}

const DAY = 'daily-planner:2026-11-11';
const OTHER_DAY = 'daily-planner:2026-11-12';

test('the store reports a refused write instead of swallowing it, and never throws', () => {
  const storage = new QuotaStorage(200);
  const writes = [];
  const store = createLocalStore(storage, { onWrite: result => writes.push(result) });
  assert.equal(store.set(DAY, 'x'.repeat(40)), true);
  let result;
  assert.doesNotThrow(() => { result = store.set(OTHER_DAY, 'y'.repeat(400)); });
  assert.equal(result, false);
  assert.equal(store.writeJSON(OTHER_DAY, { notes: 'z'.repeat(400) }), false);
  assert.deepEqual(writes.map(({ key, ok, tracked }) => [key, ok, tracked]), [[DAY, true, true], [OTHER_DAY, false, true], [OTHER_DAY, false, true]]);
  // A sync pull's writes say so: Personal sync tells those itself.
  store.withoutMutationTracking(() => store.set(OTHER_DAY, 'z'.repeat(400)));
  assert.deepEqual([writes.at(-1).ok, writes.at(-1).tracked], [false, false]);
  assert.equal(writes[1].error.name, 'QuotaExceededError');
  assert.equal(store.get(OTHER_DAY), null, 'nothing half-written');
  // A reporter that throws doesn't reach the planner either.
  const noisy = createLocalStore(new QuotaStorage(10), { onWrite: () => { throw new Error('boom'); } });
  assert.doesNotThrow(() => noisy.set(DAY, 'too long for ten'));
});

test('a refused write sets the notice once; a later save of that day clears it', () => {
  const changes = [];
  const health = createSaveHealth({ onChange: change => changes.push(change.failing) });
  assert.deepEqual([health.failing, health.saved], [false, false]);
  health.note({ key: DAY, ok: false });
  health.note({ key: DAY, ok: false });
  health.note({ key: DAY, ok: false });
  assert.equal(health.failing, true);
  assert.deepEqual(changes, [true], 'told once, not at each refused keystroke');
  // Settings still fit (written in place, by a few characters): the day is still not saved.
  health.note({ key: 'daily-planner:settings', ok: true });
  assert.equal(health.failing, true);
  assert.equal(health.saved, true, 'saving works in this browser');
  // Keys that aren't the planner's, and a sync pull's writes, don't count.
  health.note({ key: 'daily-planner-ui:tips', ok: true });
  health.note({ key: 'zz-other-app', ok: false });
  health.note({ key: OTHER_DAY, ok: false, tracked: false });
  assert.deepEqual(health.keys(), [DAY]);
  health.note({ key: DAY, ok: true });
  assert.equal(health.failing, false);
  assert.deepEqual(changes, [true, false], 'and once as it clears');
});

test('a refused change no longer on screen stays told until the next save lands', () => {
  const changes = [];
  const health = createSaveHealth({ onChange: change => changes.push(change.failing) });
  health.note({ key: DAY, ok: false });
  health.reloaded();
  assert.deepEqual([health.failing, health.lost, health.keys()], [true, true, []], 'another day opened: that change is gone, the notice stays');
  assert.deepEqual(changes, [true]);
  health.note({ key: OTHER_DAY, ok: true });
  assert.equal(health.failing, false, 'a later save landed');
  assert.deepEqual(changes, [true, false]);
});

test('only the sync mark refused, the change itself saved: sync’s words, not “wasn’t saved”', () => {
  const changes = [];
  const health = createSaveHealth({ onChange: change => changes.push(change) });
  health.note({ key: DAY, ok: true });
  health.note({ key: LEDGER_KEY, ok: false });
  assert.deepEqual([health.failing, health.syncMarkRefused], [false, true]);
  assert.deepEqual(changes, [{ failing: false, syncMarkRefused: true }]);
  // A refused change outranks it…
  health.note({ key: OTHER_DAY, ok: false });
  assert.deepEqual([health.failing, health.syncMarkRefused], [true, false]);
  health.note({ key: OTHER_DAY, ok: true });
  // …and a landed mark ends it; a landed mark never ends a refused change.
  health.note({ key: LEDGER_KEY, ok: true });
  assert.deepEqual([health.failing, health.syncMarkRefused], [false, false]);
  health.note({ key: DAY, ok: false });
  health.note({ key: LEDGER_KEY, ok: true });
  assert.equal(health.failing, true);
  const view = storageAlertView({ syncMarkRefused: true, syncInUse: true });
  assert.deepEqual([view.kind, view.title, view.lead], ['sync', FULL_TITLE, SYNC_LEAD]);
  assert.equal(storageAlertView({ syncMarkRefused: true, syncInUse: false }), null, 'nothing for people who don’t use sync');
  assert.doesNotMatch(view.label, /wasn’t saved/);
});

test('Personal sync’s “changed” mark: a refusal is reported, held, seen as waiting, and written with the next one', () => {
  const storage = new QuotaStorage(Infinity);
  const ledger = createSyncLedger(storage, { now: () => new Date('2026-11-11T10:00:00Z') });
  assert.equal(ledger.recordMutation({ type: 'set', key: 'daily-planner-ui:tips' }), null, 'not a key sync carries');
  assert.equal(ledger.recordMutation({ type: 'set', key: DAY }), true);
  ledger.markSynced('day:2026-11-11', { hash: 'h1' });
  storage.quota = storage.used();
  let marked;
  assert.doesNotThrow(() => { marked = ledger.recordMutation({ type: 'set', key: OTHER_DAY }); });
  assert.equal(marked, false);
  assert.equal(JSON.parse(storage.getItem(LEDGER_KEY)).records['day:2026-11-12'], undefined, 'not stored yet');
  // Held, it counts as a change waiting: the automatic sync sees it.
  assert.ok(ledger.entry('day:2026-11-12')?.dirtyAt);
  assert.equal(ledger.hasDirty(), true);
  assert.deepEqual(ledger.dirtyEntries().map(([id]) => id), ['day:2026-11-12']);
  storage.quota = Infinity;
  assert.equal(ledger.recordMutation({ type: 'set', key: DAY }), true);
  assert.ok(JSON.parse(storage.getItem(LEDGER_KEY)).records['day:2026-11-12']?.dirtyAt, 'the refused mark is written with the next one');
});

test('a held mark whose record is synced or forgotten meanwhile is dropped, never written over it later', () => {
  const storage = new QuotaStorage(Infinity);
  const ledger = createSyncLedger(storage, { now: () => new Date('2026-11-11T10:00:00Z') });
  ledger.recordMutation({ type: 'set', key: DAY });
  ledger.markSynced('day:2026-11-11', { hash: 'h1' });
  ledger.recordMutation({ type: 'set', key: 'daily-planner:2026-11-09' });
  storage.quota = storage.used();
  // A deletion mark refused…
  assert.equal(ledger.recordMutation({ type: 'remove', key: DAY }), false);
  assert.ok(ledger.entry('day:2026-11-11').deletedAt);
  // …then a sync restores the day and agrees on it, with room again.
  storage.quota = Infinity;
  ledger.markRemoteApplied('day:2026-11-11', { hash: 'h2' });
  assert.equal(ledger.entry('day:2026-11-11').deletedAt, null);
  // Another change later: the stale deletion is not written over the restored day.
  ledger.recordMutation({ type: 'set', key: 'daily-planner:2026-11-09' });
  const stored = JSON.parse(storage.getItem(LEDGER_KEY)).records['day:2026-11-11'];
  // Kept compact (1.39.4): no deletion, nothing waiting, only the base (tests/sync-ledger.test.js).
  assert.deepEqual(stored, { lastSyncedHash: 'h2' });
  // Forgotten, the same.
  storage.quota = storage.used();
  assert.equal(ledger.recordMutation({ type: 'set', key: OTHER_DAY }), false);
  ledger.forgetRecord('day:2026-11-12');
  assert.equal(ledger.entry('day:2026-11-12'), null);
});

test('the 80% threshold: whole percents rounded down, against the browser’s quota in characters', () => {
  assert.equal(SAFARI_BUDGET_CHARS, 2621440);
  assert.equal(CHROMIUM_BUDGET_CHARS, 5242880);
  assert.equal(storageBudget({ vendor: 'Google Inc.' }), CHROMIUM_BUDGET_CHARS, 'Chromium (measured: 10 MiB)');
  assert.equal(storageBudget({ vendor: 'Apple Computer, Inc.' }), SAFARI_BUDGET_CHARS, 'Safari, and every browser on iPhone and iPad');
  assert.equal(storageBudget({ vendor: '' }), SAFARI_BUDGET_CHARS, 'anything else: the smaller');
  assert.equal(storageBudget(undefined), SAFARI_BUDGET_CHARS);
  assert.equal(STORAGE_WARN_SHARE, 0.8);
  const at = share => storageLevel(Math.round(SAFARI_BUDGET_CHARS * share));
  assert.deepEqual([at(0).percent, at(0).warn], [0, false]);
  assert.deepEqual([at(0.5).percent, at(0.5).warn], [50, false]);
  assert.deepEqual([at(0.7999).percent, at(0.7999).warn], [79, false], 'never “80% full” without the warning');
  assert.deepEqual([at(0.8).percent, at(0.8).warn], [80, true]);
  assert.deepEqual([at(0.934).percent, at(0.934).warn], [93, true]);
  assert.deepEqual([at(1.6).percent, at(1.6).warn], [100, true], 'never above 100');
  const chrome = storageLevel(Math.round(SAFARI_BUDGET_CHARS * 1.01), CHROMIUM_BUDGET_CHARS);
  assert.deepEqual([chrome.percent, chrome.warn], [50, false], 'Chrome with half its room free: about half full');
  assert.deepEqual([storageLevel(-5).percent, storageLevel('x').chars], [0, 0]);
  const storage = new QuotaStorage();
  storage.setItem('ab', 'cdef');
  storage.setItem('daily-planner:settings', '{}');
  storage.setItem('daily-planner:2026-11-11', '{"memory":"été"}');
  const usage = measureStorage(storage, { bytes: true });
  assert.equal(usage.chars, 6 + 24 + 24 + 16, 'every key, keys and values');
  assert.equal(usage.days, 1);
  assert.equal(usage.bytes, 24 + 24 + 16 + 2, 'UTF-8 bytes of the planner’s own keys (é is two)');
  assert.equal(measureStorage(storage).bytes, 0, 'bytes only when asked');
  assert.deepEqual(measureStorage({ get length() { throw new Error('blocked'); } }), { chars: 0, bytes: 0, days: 0 });
});

test('Export backup lays the day on screen and the settings in memory over what storage holds', () => {
  const storage = new QuotaStorage();
  const store = createLocalStore(storage);
  store.writeJSON(DAY, { focus: 'Saved before storage filled up' });
  store.writeJSON('daily-planner:settings', { startHour: 7 });
  const backup = buildPlannerBackup(store, { exportedAt: '2026-11-11T12:00:00.000Z', live: { day: '2026-11-11', state: { focus: 'REFUSED marker, still on screen' }, settings: { startHour: 6 } } });
  assert.equal(backup.days['2026-11-11'].focus, 'REFUSED marker, still on screen');
  assert.equal(backup.settings.startHour, 6);
  assert.equal(buildPlannerBackup(store).days['2026-11-11'].focus, 'Saved before storage filled up', 'without `live`: what storage holds (sync snapshots)');
});

test('what the header and Data on this device say', () => {
  const warn = storageLevel(Math.ceil(SAFARI_BUDGET_CHARS * 0.86));
  const calm = storageLevel(SAFARI_BUDGET_CHARS * 0.4);
  const full = storageAlertView({ failing: true, level: warn });
  assert.deepEqual([full.kind, full.pill, full.title, full.lead], ['full', 'Not saved', 'This browser is out of space for your planner.', 'Your latest change wasn’t saved.']);
  assert.equal(full.label, `${FULL_TITLE} ${FULL_LEAD}`);
  // 1.40: older days moved first; a change still refused means even that couldn't make room.
  assert.equal(full.body, 'This browser can’t make more room for your planner here. Export a backup now, so nothing is lost.');
  const warning = storageAlertView({ failing: false, level: warn });
  assert.deepEqual([warning.kind, warning.pill, warning.title, warning.lead], ['warn', 'Storage about 86% full', 'Storage on this device is about 86% full.', 'Export a backup to keep everything safe.']);
  assert.equal(storageAlertView({ failing: false, level: warn, warnedToday: true }), null, 'once a day');
  assert.equal(storageAlertView({ failing: false, level: calm }), null);
  assert.equal(storageAlertView({ failing: true, level: calm, warnedToday: true }).kind, 'full', 'a refused save is always told');
  assert.equal(storageAlertView({ failing: true, level: warn, unavailable: true }), null, 'blocked or no room from the start: the startup dialog has said it');

  assert.deepEqual(storageSafetyLine({ failing: true, level: calm }), { text: 'This browser is out of space for your planner. Your latest change wasn’t saved. This browser can’t make more room for your planner here. Export a backup now, so nothing is lost.', warning: true });
  assert.deepEqual(storageSafetyLine({ syncMarkRefused: true, syncInUse: true }), { text: `${FULL_TITLE} ${SYNC_LEAD} Export a backup so nothing is lost.`, warning: true });
  assert.deepEqual(storageSafetyLine({ syncMarkRefused: true, syncInUse: false }).warning, false);
  assert.match(storageSafetyLine({ available: false, failing: true }).text, /^Local saving is unavailable/, 'unavailable from the start: its own words, not “out of space”');
  assert.deepEqual(storageSafetyLine({ level: warn }), { text: 'Storage on this device is about 86% full. Export a backup to keep everything safe.', warning: true });
  assert.deepEqual(storageSafetyLine({ level: calm }).warning, false);
  assert.match(storageSafetyLine({ level: calm }).text, /^Local saving is available\./);
  assert.equal(warning.body, 'Your planner is kept in this browser, which gives each site a limited space, and it can’t make more room here.');
  // 1.40: while a refused change makes room, “Saving…”, in neutral words; never for the warning alone.
  const saving = storageAlertView({ failing: true, saving: true, level: warn });
  assert.deepEqual([saving.kind, saving.pill, saving.title, saving.lead], ['saving', 'Saving…', 'Making room for your planner.', 'Your latest change is being saved.']);
  assert.equal(storageAlertView({ syncMarkRefused: true, syncInUse: true, saving: true }).kind, 'saving');
  assert.equal(storageAlertView({ saving: true, level: warn }).kind, 'warn', 'nothing refused: nothing to save');
  assert.equal(storageAlertView({ failing: true, saving: true, unavailable: true }), null);
  // Data on this device, with older days in this browser's database.
  const archive = { status: 'ready', archived: 980, displaced: 0 };
  assert.deepEqual(storageSafetyLine({ level: calm, archive }), { text: `${ARCHIVE_IN_USE} Local saving is available. Private windows or clearing site data may still remove it — export a backup if you want to keep your planner history.`, warning: false });
  assert.equal(ARCHIVE_IN_USE, 'Older days move to this browser’s database by themselves, so there is always room for new plans.');
  assert.deepEqual(storageSafetyLine({ level: calm, archive: { status: 'unavailable', archived: 980 } }), { text: ARCHIVE_UNAVAILABLE, warning: true });
  assert.match(ARCHIVE_UNAVAILABLE, /they can’t be opened, sync waits, and Export backup has your recent days only\. Reload the planner to try again\.$/);
  assert.deepEqual(storageSafetyLine({ level: calm, archive: { status: 'lost', archived: 980 } }), { text: ARCHIVE_LOST, warning: true });
  // 1.40 review M2: an import is no proof that nothing is missing, so the line never says it brings back “the rest”.
  assert.match(ARCHIVE_LOST, /^Some of your older days can’t be found in this browser’s database now\. Nothing is taken for deleted: Sync now brings back what your synced copy has, and Import backup the days a backup holds\. Once you have brought back what you can, carry on without the others\.$/);
  assert.doesNotMatch(ARCHIVE_LOST, /the rest/);
  assert.match(ARCHIVE_SETTLE.message, /Your synced copy and your backups keep theirs: a sync or an import still brings them back\.$/);
  const aside = storageSafetyLine({ level: calm, archive: { ...archive, displaced: 2 } });
  assert.equal(aside.warning, true);
  assert.match(aside.text, /Earlier versions of 2 days were kept aside when another tab saved over them without seeing them\. Below, Download keeps one in a file, and Restore puts it back \(the version there now is kept aside in its place\)\.$/);
  assert.equal(keptAsideLine(1), 'An earlier version of a day was kept aside when another tab saved over it without seeing it. Below, Download keeps one in a file, and Restore puts it back (the version there now is kept aside in its place).');
  assert.equal(storageSafetyLine({ failing: true, archive: { status: 'unavailable' } }).text.startsWith(FULL_TITLE), true, 'a refused change first');
  // No promise of a future version anywhere it speaks.
  const sync = storageAlertView({ syncMarkRefused: true, syncInUse: true });
  const words = [full, warning, sync, saving].flatMap(view => [view.pill, view.label, view.body])
    .concat([storageSafetyLine({ failing: true }).text, ARCHIVE_IN_USE, ARCHIVE_UNAVAILABLE, ARCHIVE_LOST, keptAsideLine(1), keptAsideLine(3)]).join(' ');
  assert.doesNotMatch(words, /update|future|(new|next|later) version|soon|coming|release/i);
});

test('1.40 (review m6, m3): an earlier version kept aside, and a Reset not finished: calm words, with the way to Data on this device', () => {
  const now = new Date(2026, 10, 12, 9);
  assert.equal(asideDayLabel('2026-03-03', { locale: 'en-GB', now }), 'Tue 3 March');
  assert.equal(asideDayLabel('2024-03-05', { locale: 'en-GB', now }), 'Tue, 5 March 2024', 'another year: said');
  assert.equal(asideTitle('2026-03-03', { locale: 'en-GB', now }), 'An earlier version of Tue 3 March was kept aside.');
  assert.equal(ASIDE_LEAD, 'Review it in How it works → Data on this device.');
  const aside = storageAlertView({ aside: { day: '2026-03-03', at: '2026-11-12T08:00:00.000Z' }, locale: 'en-GB', now });
  assert.deepEqual([aside.kind, aside.pill, aside.action, aside.label], ['aside', 'Earlier version kept', 'data', 'An earlier version of Tue 3 March was kept aside. Review it in How it works → Data on this device.']);
  assert.equal(storageAlertView({ failing: true, aside: { day: '2026-03-03', at: 'x' } }).kind, 'full', 'a refused change first');
  assert.equal(storageAlertView({ aside: { day: '2026-03-03', at: 'x' }, level: storageLevel(Math.ceil(SAFARI_BUDGET_CHARS * 0.86)) }).kind, 'aside', 'before the 80% warning');
  const reset = storageAlertView({ resetLeft: true, aside: { day: '2026-03-03', at: 'x' } });
  assert.deepEqual([reset.kind, reset.pill, reset.title, reset.lead], ['reset', 'Reset not finished', RESET_LEFT_TITLE, RESET_LEFT_LEAD]);
  assert.equal(RESET_LEFT_TITLE, 'Your older days are still in this browser’s database.');
  assert.equal(RESET_LEFT_LEAD, 'Reset couldn’t remove them yet. The planner tries again each time it opens.');
  assert.deepEqual(storageSafetyLine({ resetLeft: true }).warning, true);
  assert.match(storageSafetyLine({ resetLeft: true }).text, /^Your older days are still in this browser’s database\. Reset couldn’t remove them yet\./);
  const css = read('styles/sync.css');
  assert.match(css, /\.storage-alert\[data-kind="aside"\],\n\.storage-popover\[data-kind="aside"\],\n\.storage-alert\[data-kind="reset"\],\n\.storage-popover\[data-kind="reset"\] \{ --sync-wait: var\(--muted\); --sync-wait-ink: var\(--muted\); \}/, 'neutral, never the danger colour');
});

function alertHarness({ failing = false, level = null, today = new Date(2026, 10, 11, 9) } = {}) {
  const doc = fakeDocument();
  const trigger = doc.make('[data-storage-alert]', { tag: 'button' });
  trigger.hidden = true;
  const text = doc.make('[data-storage-alert-text]');
  const live = doc.make('[data-storage-alert-live]');
  doc.make('[data-search-open]', { tag: 'button' });
  const health = { failing, syncMarkRefused: false };
  const state = { level, now: today, sync: false, unavailable: false, saving: false, resetLeft: false, aside: null };
  const storage = new QuotaStorage();
  const calls = [];
  const stack = { open() {}, closed() {} };
  const alert = createStorageAlert({ health, level: () => state.level, saving: () => state.saving, syncInUse: () => state.sync, unavailable: () => state.unavailable, resetLeft: () => state.resetLeft, aside: () => state.aside, exportBackup: () => calls.push('export'), openData: () => calls.push('data'), doc, win: null, storage, now: () => state.now, layers: stack });
  const popover = () => doc.body.children.find(child => child.className.includes('storage-popover')) || null;
  return { doc, trigger, text, live, health, state, storage, calls, alert, popover };
}

test('the header notice: shown while saves are refused, announced once, gone by itself once one lands', async () => {
  const h = alertHarness();
  assert.equal(h.trigger.hidden, true);
  h.health.failing = true;
  h.alert.render();
  assert.equal(h.trigger.hidden, false);
  assert.equal(h.trigger.dataset.kind, 'full');
  assert.equal(h.text.textContent, 'Not saved');
  assert.equal(h.trigger.dataset.tooltip, 'This browser is out of space for your planner. Your latest change wasn’t saved.');
  assert.equal(h.live.textContent, h.trigger.dataset.tooltip);
  h.live.textContent = '';
  h.alert.render();
  h.alert.render();
  assert.equal(h.live.textContent, '', 'not announced again while it lasts');
  // Its popover: Export backup, Data on this device.
  await h.trigger.click();
  assert.ok(h.popover());
  assert.match(h.popover().innerHTML, /data-storage-alert-action="export"><span>Export backup<\/span>/);
  await h.popover().dispatch('click', { target: h.popover().querySelector('.primary-button'), detail: 0 });
  assert.deepEqual(h.calls, ['export']);
  assert.equal(h.popover(), null, 'closed by its action');
  assert.equal(h.trigger.hidden, false, 'the notice itself stays');
  assert.equal(h.doc.activeElement, h.trigger, 'from the keyboard, focus comes back to the pill');
  h.doc.activeElement = null;
  await h.trigger.click();
  await h.popover().dispatch('click', { target: h.popover().querySelector('.primary-button'), detail: 1 });
  assert.notEqual(h.doc.activeElement, h.trigger, 'a tap leaves no ring behind');
  h.health.failing = false;
  h.alert.render();
  assert.equal(h.trigger.hidden, true);
  assert.equal(h.live.textContent, 'Your changes are being saved again.');
  // Only the sync mark refused: sync's words, for people who use sync, announced once.
  h.health.syncMarkRefused = true;
  h.alert.render();
  assert.equal(h.trigger.hidden, true, 'not using sync: nothing');
  h.state.sync = true;
  h.alert.render();
  assert.deepEqual([h.trigger.hidden, h.trigger.dataset.kind, h.text.textContent], [false, 'sync', 'Storage full']);
  assert.equal(h.live.textContent, `${FULL_TITLE} ${SYNC_LEAD}`);
  // Saving unavailable from the start (blocked, or a private window with no room): nothing in the header.
  h.health.failing = true;
  h.state.unavailable = true;
  h.alert.render();
  assert.equal(h.trigger.hidden, true);
});

test('the 80% warning: in the header once a day, until it is opened; again the next day while storage is that full', async () => {
  const warn = storageLevel(Math.ceil(SAFARI_BUDGET_CHARS * 0.83));
  const h = alertHarness({ level: warn });
  assert.equal(h.trigger.hidden, false);
  assert.equal(h.text.textContent, 'Storage about 83% full');
  assert.equal(h.live.textContent, '', 'a warning is not announced');
  await h.trigger.click();
  assert.equal(h.storage.getItem(WARNED_KEY), '2026-11-11', 'seen today');
  assert.equal(h.trigger.hidden, false, 'it stays while its popover is open');
  await h.popover().dispatch('click', { target: h.popover().children.find(child => child.dataset.storageAlertAction === 'data') });
  assert.deepEqual(h.calls, ['data']);
  assert.equal(h.trigger.hidden, true, 'then it goes for the day');
  h.alert.render();
  assert.equal(h.trigger.hidden, true);
  h.state.now = new Date(2026, 10, 12, 9);
  h.alert.render();
  assert.equal(h.trigger.hidden, false, 'the next day, again');
  h.state.level = storageLevel(SAFARI_BUDGET_CHARS * 0.5);
  h.alert.render();
  assert.equal(h.trigger.hidden, true, 'below 80%: nothing');
});

test('1.40 (review m6): an earlier version kept aside is said once in the header, unannounced, until it is opened; a newer one, again', async () => {
  const h = alertHarness();
  h.state.aside = { day: '2026-03-03', at: '2026-11-11T08:00:00.000Z' };
  h.alert.render();
  assert.deepEqual([h.trigger.hidden, h.trigger.dataset.kind, h.text.textContent], [false, 'aside', 'Earlier version kept']);
  assert.match(h.trigger.dataset.tooltip, /^An earlier version of .+ was kept aside\. Review it in How it works → Data on this device\.$/);
  assert.equal(h.live.textContent, '', 'calm: not announced');
  await h.trigger.click();
  assert.equal(h.storage.getItem(ASIDE_SEEN_KEY), '2026-11-11T08:00:00.000Z', 'seen');
  assert.doesNotMatch(h.popover().innerHTML, /data-storage-alert-action="export"/, 'one way on: to where it can be reviewed');
  assert.match(h.popover().innerHTML, /<button class="primary-button" type="button" data-storage-alert-action="data"><span>Data on this device<\/span><\/button>/);
  assert.equal(h.trigger.hidden, false, 'it stays while its popover is open');
  await h.popover().dispatch('click', { target: h.popover().querySelector('.primary-button') });
  assert.deepEqual(h.calls, ['data']);
  assert.equal(h.trigger.hidden, true, 'then it goes');
  h.alert.render();
  assert.equal(h.trigger.hidden, true, 'once');
  h.state.aside = { day: '2026-03-04', at: '2026-11-11T09:00:00.000Z' };
  h.alert.render();
  assert.equal(h.trigger.hidden, false, 'a newer one is said too');
  // Reset not finished: said while it lasts.
  h.state.resetLeft = true;
  h.alert.render();
  assert.equal(h.trigger.dataset.kind, 'reset');
  h.state.resetLeft = false;
  h.state.aside = null;
  h.alert.render();
  assert.equal(h.trigger.hidden, true);
  const app = read('app.js');
  assert.match(app, /resetLeft: \(\) => store\.databaseLeft\(\), aside: \(\) => store\.lastAside\(\),/);
  assert.match(app, /onChange: \(\) => renderStorageState\(\),/, 'drawn again as the store changes (a copy kept aside, a Reset)');
  assert.match(read('legal/cookies/index.html'), /<code>daily-planner-ui:aside-seen<\/code>/);
});

test('1.40: older days missing: Data on this device offers to carry on without them, after a confirmation', () => {
  const app = read('app.js');
  assert.match(app, /if \(settle\) settle\.hidden = store\.status\(\) !== 'lost';/);
  assert.match(app, /qs\('\[data-archive-settle\]'\)\?\.addEventListener\('click', \(\) => requestConfirmation\(\{ eyebrow: 'Older days', \.\.\.ARCHIVE_SETTLE, confirmLabel: 'Carry on', action: async \(\) => \{ await store\.settle\(\); updateStorageUsage\(\); \} \}\)\);/);
  assert.match(read('index.html'), /<button class="text-button storage-settle" type="button" data-archive-settle hidden>Carry on without them<\/button>/);
});

test('the planner wires it: every write reported, Data on this device shows the real state and how full storage is', () => {
  const app = read('app.js');
  assert.match(app, /onWrite: result => \{ if \(result\.ok \|\| !bulkWrites\) saveHealth\.note\(result\); if \(result\.ok && result\.tracked\) retryRefused\(\); \}/);
  assert.match(app, /const marked = syncLedger\.recordMutation\(mutation\);\n\s*if \(marked !== null\) saveHealth\.note\(\{ key: LEDGER_KEY, ok: marked \}\);/);
  assert.match(app, /function load\(\) \{\n[^\n]*\n\s*saveHealth\.reloaded\(\);/);
  assert.match(app, /storageSafetyLine\(\{ failing: saveHealth\.failing, syncMarkRefused: saveHealth\.syncMarkRefused, syncInUse: syncInUse\(\), available: !unavailable, level: storageNow, archive: store\.stats\(\), resetLeft: store\.databaseLeft\(\) \}\)/);
  assert.match(app, /const savingUnavailable = \(\) => storageBlocked \|\| \(!localSavingAvailable && !saveHealth\.saved\);/);
  assert.match(app, /meter\.hidden = unavailable \|\| !storageNow;/, 'no meter for blocked storage');
  assert.match(app, /unavailable: savingUnavailable, resetLeft: \(\) => store\.databaseLeft\(\), aside: \(\) => store\.lastAside\(\), exportBackup: exportPlannerBackup, openData: openStorageCard/);
  // Export backup: what waits is saved once more, and the day on screen and the settings in memory go in the file.
  assert.match(app, /const exportPlannerBackup = afterHistory\(\(\) => \{\n\s*flushPlannerForSync\(\);\n\s*const backup = buildPlannerBackup\(store, \{ live: \{ day: ymd\(\), state, settings \} \}\);/);
  // Storage is measured as How it works opens, and for the header at most once a minute when idle: never per save.
  assert.doesNotMatch(app, /new Blob\(\[key/, 'no Blob per key');
  assert.match(app, /saveTimer = setTimeout\(\(\) => \{\n\s*try \{ store\.writeJSON\(storageKey\(\), state\); \} catch \(_\) \{\}\n\s*checkStorageSoon\(\);/);
  assert.match(app, /Math\.max\(0, storageCheckAt \+ 60000 - Date\.now\(\)\)/);
  assert.match(app, /window\.requestIdleCallback\(run/);
  const callers = [...app.matchAll(/updateStorageUsage\(\)/g)].length;
  assert.equal(callers, 8, 'the definition, How it works (button, More, H, from an address), Data on this device from the notice, and after Restore and Carry on without them (1.40)');
  const html = read('index.html');
  assert.match(html, /<button class="sync-alert storage-alert" type="button" data-storage-alert hidden aria-haspopup="dialog" aria-expanded="false">/);
  assert.match(html, /<span class="sr-only" role="status" data-storage-alert-live><\/span>/);
  assert.match(html, /<div class="storage-meter" data-storage-meter>/);
  const sw = read('sw.js');
  assert.ok(sw.includes("'./src/state/storage-health.js'") && sw.includes("'./src/features/storage-alert.js'"), 'cached for offline use');
});

test('typing doesn’t rewrite the sync ledger at each keystroke: a day marked moments ago keeps its mark', () => {
  const storage = new QuotaStorage(Infinity);
  let writes = 0;
  const setItem = storage.setItem.bind(storage);
  storage.setItem = (key, value) => { if (key === LEDGER_KEY) writes += 1; return setItem(key, value); };
  let clock = new Date('2026-11-11T10:00:00Z').getTime();
  const ledger = createSyncLedger(storage, { now: () => new Date(clock) });
  assert.equal(ledger.recordMutation({ type: 'set', key: DAY }), true);
  assert.equal(writes, 1);
  for (let i = 0; i < 20; i += 1) { clock += 400; assert.equal(ledger.recordMutation({ type: 'set', key: DAY }), true); }
  assert.equal(writes, 1, 'twenty keystrokes in eight seconds: one write');
  ledger.recordMutation({ type: 'set', key: OTHER_DAY });
  assert.equal(writes, 2, 'another day is marked at once');
  clock += 31 * 1000;
  ledger.recordMutation({ type: 'set', key: DAY });
  assert.equal(writes, 3, 'after half a minute, the mark is refreshed');
  assert.equal(ledger.entry('day:2026-11-11').dirtyAt, new Date(clock).toISOString());
  // Synced meanwhile (the ledger written by someone else): the next change marks it again at once.
  ledger.markSynced('day:2026-11-11', { hash: 'h' });
  ledger.recordMutation({ type: 'set', key: DAY });
  assert.ok(ledger.entry('day:2026-11-11').dirtyAt, 'changed again after its sync');
  // A deletion is always written.
  const before = writes;
  ledger.recordMutation({ type: 'remove', key: DAY });
  assert.equal(writes, before + 1);
  assert.ok(ledger.entry('day:2026-11-11').deletedAt);
});

test('a refused change making room (1.40): “Saving…”, neutral and unannounced, then gone once saved, or “Not saved” if it couldn’t be', () => {
  const h = alertHarness();
  h.health.failing = true;
  h.state.saving = true;
  h.alert.render();
  assert.deepEqual([h.trigger.hidden, h.trigger.dataset.kind, h.text.textContent], [false, 'saving', 'Saving…']);
  assert.equal(h.trigger.dataset.tooltip, 'Making room for your planner. Your latest change is being saved.');
  assert.equal(h.live.textContent, '', 'a moment: not announced');
  // Saved: nothing left, nothing said.
  h.health.failing = false;
  h.state.saving = false;
  h.alert.render();
  assert.deepEqual([h.trigger.hidden, h.live.textContent], [true, '']);
  // Not saved after all: said once, as before.
  h.health.failing = true;
  h.state.saving = true;
  h.alert.render();
  h.state.saving = false;
  h.alert.render();
  assert.deepEqual([h.trigger.dataset.kind, h.text.textContent], ['full', 'Not saved']);
  assert.equal(h.live.textContent, 'This browser is out of space for your planner. Your latest change wasn’t saved.');
  const css = read('styles/sync.css');
  assert.match(css, /\.storage-alert\[data-kind="saving"\],\n\.storage-popover\[data-kind="saving"\] \{ --sync-wait: var\(--muted\); --sync-wait-ink: var\(--muted\); \}/, 'neutral, never the danger colour');
});
