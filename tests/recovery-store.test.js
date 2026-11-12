import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { KEPT_REASON, MAX_SNAPSHOTS, snapshotsToPrune } from '../src/sync/recovery-store.js';

// Newest first, as list() returns them.
const snapshots = reasons => reasons.map((reason, index) => ({ id: `s${index}`, reason, createdAt: `2026-11-${String(30 - index).padStart(2, '0')}T09:00:00.000Z` }));
const ids = list => list.map(item => item.id);

test('five snapshots are kept, the oldest go', () => {
  const list = snapshots(Array(8).fill('before-remote-sync'));
  assert.deepEqual(ids(snapshotsToPrune(list)), ['s5', 's6', 's7']);
  assert.deepEqual(snapshotsToPrune(snapshots(Array(MAX_SNAPSHOTS).fill('sync-conflict'))), []);
});

test('1.40 (review m5): the latest snapshot from before older days first moved is kept outside the limit, however many syncs follow', () => {
  const list = snapshots([...Array(9).fill('before-remote-sync'), KEPT_REASON, 'before-archive', 'sync-conflict']);
  const pruned = ids(snapshotsToPrune(list));
  assert.ok(!pruned.includes('s9'), 'the newest before-archive snapshot stays');
  assert.deepEqual(ids(list).filter(id => !pruned.includes(id)), ['s0', 's1', 's2', 's3', 's4', 's9'], 'five newest, and it');
  assert.ok(pruned.includes('s10'), 'an older one of the same kind goes as any other');
});

test('the before-archive snapshot among the five newest counts as one of them', () => {
  const list = snapshots(['before-remote-sync', KEPT_REASON, 'before-remote-sync', 'before-remote-sync', 'before-remote-sync', 'before-remote-sync', 'before-remote-sync']);
  assert.deepEqual(ids(snapshotsToPrune(list)), ['s5', 's6']);
});

test('save() prunes with it', async () => {
  const source = await readFile(new URL('../src/sync/recovery-store.js', import.meta.url), 'utf8');
  assert.match(source, /const prune = snapshotsToPrune\(await list\(\)\);/);
});
