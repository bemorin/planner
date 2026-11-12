import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fakeDocument } from './support/fake-dom.js';
import { OLDER_TAB_NOTE, SNAPSHOT_REASONS, createStorageRecovery, keptAsideBackup, recoveryRows } from '../src/features/storage-recovery.js';
import { storageUsageText } from '../src/features/storage-alert.js';

// Data on this device (1.40): the figures with older days in this browser's database, and a Download for each recovery
// snapshot and each earlier copy kept aside, as a backup file Import backup reads.

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('the figures: every saved day, and the older ones kept in this browser’s database', () => {
  assert.equal(storageUsageText({ bytes: 2048, days: 1, archived: 0 }), '2.0 KB · 1 saved day');
  assert.equal(storageUsageText({ bytes: 2.1 * 1024 * 1024, days: 1240, archived: 980 }), '2.1 MB · 1,240 saved days · 980 older ones kept in this browser’s database');
  assert.equal(storageUsageText({ bytes: 900, days: 2, archived: 1 }), '900 B · 2 saved days · 1 older one kept in this browser’s database');
});

test('each snapshot and each earlier copy: a row, and a backup file that Import backup reads', () => {
  const snapshot = { id: 'snapshot:2026-11-12T08:00:00.000Z:abc', createdAt: '2026-11-12T08:00:00.000Z', reason: 'before-archive', data: { app: 'Daily Planner', version: 13, settings: {}, days: { '2024-01-02': { focus: 'a' } } } };
  const aside = { id: 4, day: '2024-03-04', json: '{"focus":"the earlier copy"}', displacedAt: '2026-11-12T09:00:00.000Z', reason: 'older-tab' };
  const rows = recoveryRows({ snapshots: [snapshot, { id: 'broken' }], displaced: [aside] });
  assert.deepEqual(rows.map(row => [row.label, row.file]), [
    [SNAPSHOT_REASONS['before-archive'], 'daily-planner-snapshot-2026-11-12-before-archive.json'],
    [`${new Date('2024-03-04T12:00:00').toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric', weekday: 'short' })}, an earlier version`, 'daily-planner-earlier-2024-03-04.json']
  ]);
  assert.equal(rows[1].restore, 4, 'an earlier version can be put back');
  assert.equal(rows[0].restore, undefined, 'a snapshot is imported, never restored over the planner');
  assert.equal(rows[0].data, snapshot.data, 'a snapshot is a backup already');
  const backup = keptAsideBackup(aside);
  assert.deepEqual(backup, { app: 'Daily Planner', version: 13, exportedAt: '2026-11-12T09:00:00.000Z', settings: null, days: { '2024-03-04': { focus: 'the earlier copy' } } });
  // What app.js's Import accepts: a full backup (app and days).
  assert.ok(backup.app === 'Daily Planner' && backup.days && typeof backup.days === 'object');
  assert.match(SNAPSHOT_REASONS['before-remote-sync'], /before changes from your other devices/);
});

test('Data on this device draws them, with the site’s size once older days are kept; Download saves the file', async () => {
  const doc = fakeDocument();
  const usage = doc.make('[data-storage-usage]');
  const wrap = doc.make('[data-storage-recovery]');
  wrap.hidden = true;
  const list = doc.make('[data-storage-recovery-list]');
  const downloads = [];
  const store = { stats: () => ({ days: 1240, archived: 980, archivedChars: 0, displaced: 1, status: 'ready' }), displaced: async () => [{ id: 1, day: '2024-03-04', json: '{"focus":"x"}', displacedAt: '2026-11-12T09:00:00.000Z' }] };
  const recovery = createStorageRecovery({
    store,
    doc,
    download: (...args) => downloads.push(args),
    nav: { storage: { estimate: async () => ({ usage: 18.4 * 1024 * 1024 }), persisted: async () => true } },
    recoveryStore: { list: async () => [{ id: 's', createdAt: '2026-11-12T08:00:00.000Z', reason: 'before-archive', data: { app: 'Daily Planner', days: {} } }] }
  });
  const drawing = recovery.render(2.1 * 1024 * 1024);
  assert.equal(usage.textContent, '2.1 MB · 1,240 saved days · 980 older ones kept in this browser’s database', 'at once');
  const rows = await drawing;
  assert.equal(usage.textContent, '2.1 MB · 1,240 saved days · 980 older ones kept in this browser’s database (this site about 18.4 MB, kept by this browser until you clear it)');
  assert.equal(rows.length, 2);
  assert.equal(wrap.hidden, false);
  assert.equal(list.children.length, 3, 'a Download button each, and a Restore for the earlier version');
  await list.dispatch('click', { target: { closest: () => ({ dataset: { storageRecoveryDownload: rows[1].id } }) } });
  assert.deepEqual(downloads.map(([file, , type]) => [file, type]), [['daily-planner-earlier-2024-03-04.json', 'application/json']]);
  assert.deepEqual(JSON.parse(downloads[0][1]).days, { '2024-03-04': { focus: 'x' } });
  // Nothing kept: the list stays hidden.
  const none = createStorageRecovery({ store: { stats: () => ({ days: 3, archived: 0 }), displaced: async () => [] }, doc, recoveryStore: { list: async () => [] } });
  await none.render(10);
  assert.equal(wrap.hidden, true);
});

test('1.40 (review m6): Restore puts an earlier version back, says the version there now is kept aside, and draws the planner again', async () => {
  const doc = fakeDocument();
  doc.make('[data-storage-usage]');
  doc.make('[data-storage-recovery]');
  const list = doc.make('[data-storage-recovery-list]');
  const restored = [];
  let answer = true;
  const store = { stats: () => ({ days: 3, archived: 1, displaced: 1 }), displaced: async () => [{ id: 7, day: '2024-03-04', json: '{"focus":"x"}', displacedAt: '2026-11-12T09:00:00.000Z' }], restoreAside: async id => { restored.push(id); return answer; } };
  const redrawn = [];
  const recovery = createStorageRecovery({ store, doc, onRestore: row => redrawn.push(row.restore), recoveryStore: { list: async () => [] } });
  const rows = await recovery.render(10);
  assert.match(list.innerHTML, /data-storage-recovery-restore="aside:7" aria-label="Restore [^"]+, an earlier version: the version there now is kept aside in its place">Restore<\/button>/);
  const button = { dataset: { storageRecoveryRestore: rows[0].id }, disabled: false, textContent: 'Restore' };
  const target = { closest: selector => (selector === '[data-storage-recovery-restore]' ? button : null) };
  await list.dispatch('click', { target });
  assert.deepEqual(restored, [7]);
  assert.deepEqual(redrawn, [7], 'the planner draws the day again');
  answer = false;
  button.disabled = false;
  await list.dispatch('click', { target });
  assert.equal(button.textContent, 'Couldn’t restore');
  assert.equal(button.disabled, false);
});

test('1.40 (second review, major): while an older planner tab is open, a line next to Restore says so; a copy restored stays, marked', async () => {
  const doc = fakeDocument();
  doc.make('[data-storage-usage]');
  doc.make('[data-storage-recovery]');
  const note = doc.make('[data-storage-recovery-note]');
  note.hidden = true;
  const list = doc.make('[data-storage-recovery-list]');
  let older = true;
  const kept = [
    { id: 8, day: '2024-03-04', json: '{"focus":"older tab"}', displacedAt: '2026-11-12T10:00:00.000Z', reason: 'restored-over' },
    { id: 7, day: '2024-03-04', json: '{"focus":"x"}', displacedAt: '2026-11-12T09:00:00.000Z', reason: 'older-tab', restoredAt: '2026-11-12T10:00:00.000Z' }
  ];
  const store = { stats: () => ({ days: 3, archived: 1, displaced: 2 }), displaced: async () => kept, restoreAside: async () => true };
  const recovery = createStorageRecovery({ store, doc, olderTabOpen: async () => older, recoveryStore: { list: async () => [] } });
  const rows = await recovery.render(10);
  assert.equal(note.hidden, false);
  assert.equal(note.textContent, OLDER_TAB_NOTE);
  assert.equal(OLDER_TAB_NOTE, 'An older version of the planner is open in another tab. Close it first, or it may save over this day again.');
  assert.match(rows[0].label, /, the version Restore replaced$/);
  assert.match(rows[1].label, /, an earlier version$/);
  assert.match(rows[1].detail, /^kept aside .+, put back .+$/, 'restored, and still there');
  assert.equal(rows.every(row => row.restore), true, 'each can be put back, again if need be');
  assert.match(list.innerHTML, /data-storage-recovery-restore="aside:7"/);
  older = false;
  await recovery.render(10);
  assert.equal(note.hidden, true);
  assert.equal(note.textContent, '');
});

test('wired: How it works → Data on this device, the list in its card', () => {
  const app = read('app.js');
  assert.match(app, /const storageRecovery = createStorageRecovery\(\{ store, download, onRestore: \(\) => \{ load\(\); updateStorageUsage\(\); \}, olderTabOpen: \(\) => archiveKeeper\.olderTabOpen\(\) \}\);/);
  assert.match(app, /storageRecovery\.render\(usage\.bytes\);/);
  const html = read('index.html');
  assert.match(html, /<div class="storage-recovery" data-storage-recovery hidden><h4>Kept on this device, just in case<\/h4><p class="storage-recovery__note" data-storage-recovery-note role="status" hidden><\/p><ul class="storage-recovery__list" data-storage-recovery-list><\/ul><\/div>/);
  assert.ok(read('sw.js').includes("'./src/features/storage-recovery.js'"));
});
