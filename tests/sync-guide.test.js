import test from 'node:test';
import assert from 'node:assert/strict';
import { readWaitlistJoined } from '../src/features/sync-guide.js';

const storageWith = value => ({ getItem: () => value });

test('a sign-up keeps the address and the removal token so it can be left later', () => {
  const entry = readWaitlistJoined(storageWith(JSON.stringify({ at: '2026-10-09T10:00:00.000Z', email: 'someone@example.com', token: 'abc123' })));
  assert.deepEqual(entry, { at: '2026-10-09T10:00:00.000Z', email: 'someone@example.com', token: 'abc123' });
});

test('an older sign-up stored as a plain date still counts as joined, without a way to leave from here', () => {
  assert.deepEqual(readWaitlistJoined(storageWith('2026-09-01T08:00:00.000Z')), { at: '2026-09-01T08:00:00.000Z', email: '', token: '' });
});

test('nothing stored, or storage that cannot be read, means not joined', () => {
  assert.equal(readWaitlistJoined(storageWith(null)), null);
  assert.equal(readWaitlistJoined({ getItem() { throw new Error('denied'); } }), null);
  assert.deepEqual(readWaitlistJoined(storageWith('{broken')), { at: '{broken', email: '', token: '' }, 'still joined');
});

test('the guide says the difference between the clouds in one line (1.38)', async () => {
  const { cloudDifference } = await import('../src/features/sync-guide.js');
  assert.equal(cloudDifference(['google', 'dropbox']), ' Dropbox stays connected and saves on its own; Google Drive asks for a tap every hour.');
  assert.equal(cloudDifference(['google']), ' Google Drive asks for a tap every hour; changes wait on this device until then.');
  assert.equal(cloudDifference(['dropbox']), '');
  assert.equal(cloudDifference([]), '');
});

test('Help → Data on this device names only the clouds this deployment offers, set at runtime; none, no line', async () => {
  const { storageSyncLine } = await import('../src/features/personal-sync-view.js');
  assert.equal(storageSyncLine(['google', 'dropbox']), 'Optional Personal sync keeps a sealed copy in your own Dropbox or Google Drive; local recovery snapshots stay on this device. Dropbox stays connected and saves on its own; Google Drive asks for a tap every hour.');
  assert.equal(storageSyncLine(['google']), 'Optional Personal sync keeps a sealed copy in your own Google Drive; local recovery snapshots stay on this device. Google Drive asks for a tap every hour.');
  assert.equal(storageSyncLine(['dropbox']), 'Optional Personal sync keeps a sealed copy in your own Dropbox; local recovery snapshots stay on this device. Dropbox stays connected and saves on its own.');
  assert.equal(storageSyncLine([]), '');
  const { readFile } = await import('node:fs/promises');
  const index = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(index, /<h3>Data on this device<\/h3><p>[^<]*Clearing site data can remove them\.<\/p><p data-storage-sync-line hidden><\/p>/, 'the static page names no cloud');
  const help = index.slice(index.indexOf('<h3>Data on this device</h3>'), index.indexOf('data-storage-safety'));
  assert.doesNotMatch(help, /Dropbox|Google Drive/);
});
