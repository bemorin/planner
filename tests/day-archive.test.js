import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ARCHIVE_DB, OPEN_TIMEOUT_MS, READ_BATCH, createDayArchive, createMemoryArchive } from '../src/state/day-archive.js';

// The older days' home (1.40, src/state/day-archive.js). The IndexedDB adapter runs in the browser scenarios
// (scripts/archive-scenarios.mjs); here, its memory twin, and what the adapter promises in its source.

test('the memory archive keeps days as the exact strings, and days aside', async () => {
  const archive = createMemoryArchive({ now: () => new Date('2026-11-12T09:00:00.000Z') });
  assert.equal(await archive.open(), true);
  await archive.put([{ day: '2024-01-02', json: '{"focus":"b"}' }, { day: '2024-01-01', json: '{"focus":"a"}' }]);
  assert.deepEqual((await archive.all()).map(entry => [entry.day, entry.json, entry.chars, entry.movedAt]), [
    ['2024-01-01', '{"focus":"a"}', 'daily-planner:2024-01-01'.length + 13, '2026-11-12T09:00:00.000Z'],
    ['2024-01-02', '{"focus":"b"}', 'daily-planner:2024-01-02'.length + 13, '2026-11-12T09:00:00.000Z']
  ], 'oldest first, with what localStorage counted for them');
  assert.deepEqual([...(await archive.read(['2024-01-02', '2023-01-01']))], [['2024-01-02', '{"focus":"b"}']]);
  assert.deepEqual((await archive.range('2024-01-02', '2024-02-01')).map(entry => entry.day), ['2024-01-02']);
  await archive.keepAside([{ day: '2024-01-01', json: '{"focus":"a"}', reason: 'older-tab' }], { drop: ['2024-01-01'] });
  assert.deepEqual((await archive.all()).map(entry => entry.day), ['2024-01-02']);
  assert.deepEqual((await archive.displaced()).map(({ day, json, reason }) => [day, json, reason]), [['2024-01-01', '{"focus":"a"}', 'older-tab']]);
  await archive.remove(['2024-01-02']);
  assert.deepEqual(await archive.all(), []);
  assert.equal((await archive.displaced()).length, 1, 'clearing days never touches what was kept aside');
});

test('the memory archive fails on demand, as a full disk or a lost write would', async () => {
  const archive = createMemoryArchive();
  archive.faults.put = Object.assign(new Error('quota'), { name: 'QuotaExceededError' });
  await assert.rejects(archive.put([{ day: '2024-01-01', json: '{}' }]), /quota/);
  assert.equal(archive.data.size, 0, 'nothing half-written');
  archive.faults.put = null;
  await archive.put([{ day: '2024-01-01', json: '{"a":1}' }]);
  archive.faults.readBack = json => json.replace('1', '2');
  assert.equal((await archive.read(['2024-01-01'])).get('2024-01-01'), '{"a":2}');
  assert.equal(archive.ops.put, 2);
});

test('the IndexedDB adapter: its database, batched reads, strict writes, a time limit, and no IndexedDB at all', async () => {
  const source = readFileSync(new URL('../src/state/day-archive.js', import.meta.url), 'utf8');
  assert.equal(ARCHIVE_DB, 'daily-planner-archive');
  assert.equal(READ_BATCH, 1000);
  assert.equal(OPEN_TIMEOUT_MS, 4000);
  assert.match(source, /durability: 'strict'/);
  assert.match(source, /getAll\(range, READ_BATCH\)/);
  assert.match(source, /createObjectStore\(DAYS, \{ keyPath: 'day' \}\)/);
  assert.match(source, /createObjectStore\(DISPLACED, \{ keyPath: 'id', autoIncrement: true \}\)/);
  assert.match(source, /onversionchange/);
  // Without IndexedDB (storage blocked, an old browser): every call rejects, nothing throws.
  const none = createDayArchive({ indexedDB: null });
  await assert.rejects(none.open(), /IndexedDB unavailable/);
  await assert.rejects(none.all(), /IndexedDB unavailable/);
  // An open that never answers (Safari 14.6) gives up in time.
  const hung = createDayArchive({ indexedDB: { open: () => ({}) }, openTimeoutMs: 20 });
  await assert.rejects(hung.open(), error => error.name === 'TimeoutError');
});
