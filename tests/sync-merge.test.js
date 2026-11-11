import test from 'node:test';
import assert from 'node:assert/strict';
import { agreedBase, decideRecordSync } from '../src/sync/merge.js';

test('first sync pushes local-only records and pulls remote-only records', () => {
  assert.equal(decideRecordSync({ localRecord: { hash: 'local' }, remoteRecord: null, lastSyncedHash: null }).action, 'push-local');
  assert.equal(decideRecordSync({ localRecord: null, remoteRecord: { hash: 'remote' }, lastSyncedHash: null }).action, 'pull-remote');
});

test('sync follows the side that changed since the last shared hash', () => {
  assert.equal(decideRecordSync({ localRecord: { hash: 'new' }, remoteRecord: { hash: 'base' }, lastSyncedHash: 'base' }).action, 'push-local');
  assert.equal(decideRecordSync({ localRecord: { hash: 'base' }, remoteRecord: { hash: 'new' }, lastSyncedHash: 'base' }).action, 'pull-remote');
});

test('sync refuses to silently overwrite concurrent changes', () => {
  assert.equal(decideRecordSync({ localRecord: { hash: 'local' }, remoteRecord: { hash: 'remote' }, lastSyncedHash: 'base' }).action, 'conflict');
});

test('identical concurrent changes can be marked synced', () => {
  assert.equal(decideRecordSync({ localRecord: { hash: 'same' }, remoteRecord: { hash: 'same' }, lastSyncedHash: 'base' }).action, 'mark-synced');
});

test('a record agreed on before and gone from the copy without a tombstone is put back (the copy was made again)', () => {
  assert.equal(decideRecordSync({ localRecord: { hash: 'base' }, remoteRecord: null, lastSyncedHash: 'base' }).action, 'push-local');
  assert.equal(decideRecordSync({ localRecord: { hash: 'changed' }, remoteRecord: null, lastSyncedHash: 'base' }).action, 'push-local');
  assert.equal(decideRecordSync({ localRecord: null, remoteRecord: null, lastSyncedHash: 'base' }).action, 'none');
  // A deletion is a tombstone, never a missing record: it still follows the usual rule.
  assert.equal(decideRecordSync({ localRecord: { hash: 'base' }, remoteRecord: { hash: 'tombstone', deletedAt: '2026-11-10T09:00:00.000Z' }, lastSyncedHash: 'base' }).action, 'pull-remote');
});

// 1.39: records compare as they sync (the settings without the fields of the paid add-on of earlier releases), and carry
// `storedHash`, the hash of the form they are kept in, when it differs. Bases agreed on before 1.39 hashed that form.
test('a base agreed on with the add-on fields stands for the hash without them on the side still kept as agreed', () => {
  const kept = { hash: 'without', storedHash: 'with' };
  assert.equal(agreedBase({ localRecord: kept, remoteRecord: { hash: 'other' }, lastSyncedHash: 'with' }), 'without', 'this device, unchanged');
  assert.equal(agreedBase({ localRecord: { hash: 'mine' }, remoteRecord: kept, lastSyncedHash: 'with' }), 'without', 'the copy, unchanged');
  assert.equal(agreedBase({ localRecord: { hash: 'mine' }, remoteRecord: { hash: 'theirs' }, lastSyncedHash: 'base' }), 'base', 'any other base is as it was');
  assert.equal(agreedBase({ localRecord: kept, remoteRecord: kept, lastSyncedHash: null }), null);

  assert.equal(decideRecordSync({ localRecord: kept, remoteRecord: { hash: 'edited' }, lastSyncedHash: 'with' }).action, 'pull-remote', 'kept with the fields, edited elsewhere without them');
  assert.equal(decideRecordSync({ localRecord: { hash: 'without' }, remoteRecord: kept, lastSyncedHash: 'with' }).action, 'none', 'dropped here by a save that changed nothing else');
  assert.equal(decideRecordSync({ localRecord: { hash: 'edited' }, remoteRecord: kept, lastSyncedHash: 'with' }).action, 'push-local', 'a real change here');
  assert.equal(decideRecordSync({ localRecord: kept, remoteRecord: kept, lastSyncedHash: 'with' }).action, 'none', 'kept on both sides');
  assert.equal(decideRecordSync({ localRecord: { hash: 'mine' }, remoteRecord: { hash: 'theirs' }, lastSyncedHash: 'with' }).action, 'conflict', 'a real change on each side still stops');
});
