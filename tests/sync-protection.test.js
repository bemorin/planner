import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalStore } from '../src/state/local-store.js';
import { createSyncLedger } from '../src/sync/ledger.js';
import { createSyncEngine } from '../src/sync/engine.js';
import { createSyncDocument } from '../src/sync/document.js';
import { createMemoryKeyStore } from '../src/sync/key-store.js';
import { PROTECTION_KEY, SyncCopyError, SyncPassphraseNeededError, createSealedTransport, createSyncProtection } from '../src/sync/protection.js';
import { MIN_ITERATIONS, SEAL_MAGIC, createSeal, readEnvelope } from '../src/sync/seal.js';
import { DROPBOX_TOKEN_URL, createDropboxProvider } from '../src/sync/dropbox.js';

class MemoryStorage {
  #data = new Map();
  get length() { return this.#data.size; }
  key(index) { return [...this.#data.keys()][index] ?? null; }
  getItem(key) { return this.#data.has(String(key)) ? this.#data.get(String(key)) : null; }
  setItem(key, value) { this.#data.set(String(key), String(value)); }
  removeItem(key) { this.#data.delete(String(key)); }
}

const FAST = { iterations: MIN_ITERATIONS };

/** One cloud file, as Google Drive and Dropbox both present it (readText / writeText). */
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
    async writeText(text) { file.text = text; file.writes += 1; return { id: 'file_1', version: `v${file.writes}` }; }
  };
}

/** A device: its planner, its ledger, its seal, and the cloud seen through it. */
function device(cloud, { clock = '2026-11-10T09:00:00.000Z', keyStore = createMemoryKeyStore() } = {}) {
  const storage = new MemoryStorage();
  const now = () => new Date(clock);
  const ledger = createSyncLedger(storage, { now });
  const store = createLocalStore(storage, { onMutation: ledger.recordMutation });
  const engine = createSyncEngine({ store, ledger, now });
  const protection = createSyncProtection({ storage, keyStore, now });
  const transport = createSealedTransport({ provider: cloud, protection });
  return { storage, ledger, store, engine, protection, transport, keyStore, sync: options => engine.sync(transport, options) };
}

const plainCopy = records => JSON.stringify(createSyncDocument(records, { now: () => new Date('2026-10-01T08:00:00.000Z') }));

test('a new copy needs a passphrase first: nothing is written before it, and then only sealed', async () => {
  const cloud = cloudFile();
  const laptop = device(cloud);
  laptop.store.writeJSON('daily-planner:2026-11-10', { focus: 'Plan the launch' });
  await assert.rejects(() => laptop.sync(), error => error instanceof SyncPassphraseNeededError && error.reason === 'create');
  assert.equal(cloud.file.text, null, 'nothing sent');

  await laptop.protection.adopt(await createSeal('quiet harbour lantern', FAST));
  const result = await laptop.sync();
  assert.equal(result.status, 'ok');
  assert.ok(cloud.file.text.startsWith(`${SEAL_MAGIC}/1\n`));
  assert.ok(!cloud.file.text.includes('Plan the launch'));
  assert.equal(laptop.transport.format, 'sealed');
  const meta = JSON.parse(laptop.storage.getItem(PROTECTION_KEY));
  assert.equal(meta.salt, readEnvelope(cloud.file.text).envelope.salt, 'what isn’t secret, beside the key');
  assert.ok(meta.sealedSince);
  assert.ok(!JSON.stringify(meta).includes('quiet harbour'), 'never the passphrase');
});

test('another device: the sealed copy asks for its passphrase once; a wrong one opens nothing; the key is then kept', async () => {
  const cloud = cloudFile();
  const laptop = device(cloud);
  laptop.store.writeJSON('daily-planner:2026-11-10', { focus: 'Plan the launch' });
  await laptop.protection.adopt(await createSeal('quiet harbour lantern', FAST));
  await laptop.sync();

  const keyStore = createMemoryKeyStore();
  const phone = device(cloud, { keyStore });
  let needed = null;
  await assert.rejects(() => phone.sync(), error => { needed = error; return error.reason === 'enter'; });
  assert.equal(needed.envelope.salt, readEnvelope(cloud.file.text).envelope.salt);
  assert.equal(await phone.protection.unlockEnvelope(needed.envelope, 'quiet harbor lantern'), null, 'wrong passphrase');
  const writes = cloud.file.writes;
  const key = await phone.protection.unlockEnvelope(needed.envelope, 'quiet harbour lantern');
  await phone.protection.adopt({ salt: needed.envelope.salt, iterations: needed.envelope.iterations, check: needed.envelope.check, key });
  const result = await phone.sync();
  assert.deepEqual(result.pulled, ['day:2026-11-10']);
  assert.equal(phone.store.readJSON('daily-planner:2026-11-10').focus, 'Plan the launch');
  assert.equal(cloud.file.writes, writes, 'nothing to write back');

  // The next opening of the planner: the key comes back from the device, no passphrase asked.
  const again = createSyncProtection({ storage: phone.storage, keyStore, now: () => new Date() });
  assert.ok(await again.load());
  assert.equal(again.current().salt, needed.envelope.salt);
});

test('migration: a plain copy from before 1.38 keeps syncing as it is, until a device seals it; then never plain again', async () => {
  const cloud = cloudFile(plainCopy({}));
  const laptop = device(cloud);
  const phone = device(cloud, { clock: '2026-11-10T09:05:00.000Z' });
  laptop.store.writeJSON('daily-planner:2026-11-10', { focus: 'Old habits' });

  // After updating: sync keeps working, plain, and says so (the offer to seal).
  const first = await laptop.sync();
  assert.equal(first.status, 'ok');
  assert.equal(laptop.transport.format, 'plain');
  assert.equal(JSON.parse(cloud.file.text).records['day:2026-11-10'].value.focus, 'Old habits', 'written plain, as before');
  await phone.sync();
  assert.equal(phone.store.readJSON('daily-planner:2026-11-10').focus, 'Old habits');

  // The laptop accepts the offer: the next sync writes the whole copy sealed, though no record changed.
  await laptop.protection.adopt(await createSeal('quiet harbour lantern', FAST));
  const sealed = await laptop.sync();
  assert.equal(sealed.status, 'ok');
  assert.deepEqual(sealed.pushed, []);
  assert.ok(cloud.file.text.startsWith(`${SEAL_MAGIC}/`));
  assert.ok(!cloud.file.text.includes('Old habits'));

  // The phone, without the key: asked for the passphrase, and it never writes the plain copy back.
  phone.store.writeJSON('daily-planner:2026-11-10', { focus: 'Edited on the phone' });
  const before = cloud.file.text;
  await assert.rejects(() => phone.sync(), error => error instanceof SyncPassphraseNeededError && error.reason === 'enter');
  assert.equal(cloud.file.text, before);
});

test('a device that sealed a copy once never writes a plain one, even without its key', async () => {
  const cloud = cloudFile(plainCopy({}));
  const laptop = device(cloud);
  await laptop.protection.adopt(await createSeal('quiet harbour lantern', FAST));
  await laptop.protection.forget(); // Disconnect: the key goes, what it did stays
  assert.equal(laptop.protection.wasSealed(), true);
  laptop.store.writeJSON('daily-planner:2026-11-10', { focus: 'x' });
  await assert.rejects(() => laptop.sync(), error => error.reason === 'create');
  assert.equal(cloud.file.writes, 0);
});

test('changing the passphrase seals the copy again; other devices then ask for the new one', async () => {
  const cloud = cloudFile();
  const laptop = device(cloud);
  const phone = device(cloud, { clock: '2026-11-10T09:05:00.000Z' });
  laptop.store.writeJSON('daily-planner:2026-11-10', { focus: 'Before' });
  const seal = await createSeal('quiet harbour lantern', FAST);
  await laptop.protection.adopt(seal);
  await laptop.sync();
  await phone.protection.adopt(seal);
  await phone.sync();
  const oldSalt = readEnvelope(cloud.file.text).envelope.salt;

  const next = await createSeal('a brand new passphrase', FAST);
  laptop.transport.rekey(next);
  const result = await laptop.sync();
  laptop.transport.clearRekey();
  assert.equal(result.status, 'ok');
  await laptop.protection.adopt(next);
  const { envelope } = readEnvelope(cloud.file.text);
  assert.notEqual(envelope.salt, oldSalt);
  assert.equal(envelope.salt, next.salt);

  await assert.rejects(() => phone.sync(), error => error.reason === 'changed' && error.envelope.salt === next.salt);
  assert.equal(await phone.protection.unlockEnvelope(envelope, 'quiet harbour lantern'), null, 'the old one no longer opens it');
});

test('forgotten everywhere: start over replaces the copy without opening it; what only other devices had comes back', async () => {
  const cloud = cloudFile();
  const laptop = device(cloud);
  const phone = device(cloud, { clock: '2026-11-10T09:05:00.000Z' });
  laptop.store.writeJSON('daily-planner:2026-11-10', { focus: 'Laptop day' });
  const seal = await createSeal('forgotten passphrase', FAST);
  await laptop.protection.adopt(seal);
  await laptop.sync();
  await phone.protection.adopt(seal);
  await phone.sync();
  phone.store.writeJSON('daily-planner:2026-11-11', { focus: 'Only on the phone' });
  await phone.sync();

  // A new browser, the passphrase forgotten: it starts over from its own (empty) planner.
  const fresh = device(cloud, { clock: '2026-11-12T09:00:00.000Z' });
  fresh.store.writeJSON('daily-planner:2026-11-12', { focus: 'New browser' });
  const next = await createSeal('remembered this time', FAST);
  fresh.transport.rekey(next, { replace: true });
  const result = await fresh.sync({ conflictResolution: 'local' });
  fresh.transport.clearRekey();
  assert.equal(result.status, 'ok');
  await fresh.protection.adopt(next);
  assert.equal(readEnvelope(cloud.file.text).envelope.salt, next.salt);

  // The phone types the new passphrase: its days go back into the copy.
  const { envelope } = readEnvelope(cloud.file.text);
  await phone.protection.adopt({ salt: envelope.salt, iterations: envelope.iterations, check: envelope.check, key: await phone.protection.unlockEnvelope(envelope, 'remembered this time') });
  const back = await phone.sync();
  assert.deepEqual(back.pulled, ['day:2026-11-12']);
  assert.deepEqual(back.pushed, ['day:2026-11-10', 'day:2026-11-11']);
  const after = await fresh.sync();
  assert.deepEqual(after.pulled, ['day:2026-11-10', 'day:2026-11-11']);
  assert.equal(fresh.store.readJSON('daily-planner:2026-11-11').focus, 'Only on the phone');
});

test('a damaged copy, or one from a newer planner, is left as it is', async () => {
  const cloud = cloudFile();
  const laptop = device(cloud);
  laptop.store.writeJSON('daily-planner:2026-11-10', { focus: 'x' });
  await laptop.protection.adopt(await createSeal('quiet harbour lantern', FAST));
  await laptop.sync();
  const [first, body] = cloud.file.text.split('\n');
  const envelope = JSON.parse(body);
  const data = Buffer.from(envelope.data, 'base64');
  data[3] ^= 1;
  cloud.file.text = `${first}\n${JSON.stringify({ ...envelope, data: data.toString('base64') })}\n`;
  const damaged = cloud.file.text;
  laptop.store.writeJSON('daily-planner:2026-11-10', { focus: 'y' });
  await assert.rejects(() => laptop.sync(), error => error instanceof SyncCopyError && error.reason === 'damaged');
  assert.equal(cloud.file.text, damaged);
  cloud.file.text = `${SEAL_MAGIC}/2\n{}`;
  await assert.rejects(() => laptop.sync(), error => error.reason === 'unsupported' && /newer version/.test(error.message));
  cloud.file.text = 'not ours';
  await assert.rejects(() => laptop.sync(), error => error.reason === 'unreadable');
  assert.equal(cloud.file.text, 'not ours');
});

test('the settings travel inside the sealed copy, never readable in the cloud', async () => {
  const cloud = cloudFile();
  const laptop = device(cloud);
  laptop.store.writeJSON('daily-planner:settings', { startHour: 8, horizon: { years: { 2026: { misogi: 'Cross the fjord by kayak' } } } });
  await laptop.protection.adopt(await createSeal('quiet harbour lantern', FAST));
  await laptop.sync();
  assert.ok(!cloud.file.text.includes('fjord'));
  const phone = device(cloud);
  await phone.protection.adopt(await (async () => { const { envelope } = readEnvelope(cloud.file.text); return { ...envelope, key: await phone.protection.unlockEnvelope(envelope, 'quiet harbour lantern') }; })());
  await phone.sync();
  assert.equal(phone.store.readJSON('daily-planner:settings').horizon.years[2026].misogi, 'Cross the fjord by kayak');
});

test('end to end with a pretend Dropbox: connect, seal, a second device joins with the passphrase', async () => {
  const server = { file: null, rev: 0, valid: new Set(), tokens: 0 };
  const requests = [];
  const fetchImpl = async (url, init = {}) => {
    requests.push(url);
    const reply = (body, status = 200, headers = {}) => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers });
    if (url === DROPBOX_TOKEN_URL) {
      server.tokens += 1;
      server.valid.add(`t${server.tokens}`);
      return reply({ access_token: `t${server.tokens}`, expires_in: 14400, refresh_token: 'r1' });
    }
    if (!server.valid.has(String(init.headers?.Authorization).slice(7))) return reply({ error_summary: 'invalid_access_token/' }, 401);
    const arg = JSON.parse(init.headers['Dropbox-API-Arg']);
    assert.equal(arg.path, '/daily-planner-sync.json', 'one file, in the app folder');
    if (url.endsWith('/files/download')) return server.file == null ? reply({ error_summary: 'path/not_found/' }, 409) : reply(server.file, 200, { 'Dropbox-API-Result': JSON.stringify({ rev: `r${server.rev}` }) });
    if (url.endsWith('/files/upload')) {
      if (arg.mode['.tag'] === 'update' && arg.mode.update !== `r${server.rev}`) return reply({ error_summary: 'path/conflict/' }, 409);
      server.file = String(init.body);
      server.rev += 1;
      return reply({ rev: `r${server.rev}` });
    }
    return reply({}, 404);
  };
  async function dropboxDevice(clock) {
    const storage = new MemoryStorage();
    const dropbox = createDropboxProvider({ appKey: 'abcd1234efgh567', fetchImpl, storage, href: () => 'https://planner.bemorin.com/' });
    const state = new URL(await dropbox.beginAuthorization()).searchParams.get('state');
    assert.deepEqual(await dropbox.completeAuthorization({ code: 'code', state }), { ok: true });
    const now = () => new Date(clock);
    const ledger = createSyncLedger(storage, { now });
    const store = createLocalStore(storage, { onMutation: ledger.recordMutation });
    const protection = createSyncProtection({ storage, keyStore: createMemoryKeyStore(), now });
    const transport = createSealedTransport({ provider: dropbox, protection });
    return { store, protection, sync: () => createSyncEngine({ store, ledger, now }).sync(transport) };
  }

  const laptop = await dropboxDevice('2026-11-10T09:00:00.000Z');
  laptop.store.writeJSON('daily-planner:2026-11-10', { focus: 'Synced through Dropbox' });
  await assert.rejects(() => laptop.sync(), error => error.reason === 'create');
  await laptop.protection.adopt(await createSeal('quiet harbour lantern', FAST));
  assert.equal((await laptop.sync()).status, 'ok');
  assert.ok(server.file.startsWith(`${SEAL_MAGIC}/1\n`) && !server.file.includes('Synced through Dropbox'));

  const phone = await dropboxDevice('2026-11-10T09:05:00.000Z');
  let envelope = null;
  await assert.rejects(() => phone.sync(), error => { envelope = error.envelope; return error.reason === 'enter'; });
  await phone.protection.adopt({ ...envelope, key: await phone.protection.unlockEnvelope(envelope, 'quiet harbour lantern') });
  const pulled = await phone.sync();
  assert.deepEqual(pulled.pulled, ['day:2026-11-10']);
  assert.equal(phone.store.readJSON('daily-planner:2026-11-10').focus, 'Synced through Dropbox');

  phone.store.writeJSON('daily-planner:2026-11-10', { focus: 'Edited on the phone' });
  assert.deepEqual((await phone.sync()).pushed, ['day:2026-11-10']);
  assert.deepEqual((await laptop.sync()).pulled, ['day:2026-11-10']);
  assert.equal(laptop.store.readJSON('daily-planner:2026-11-10').focus, 'Edited on the phone');
  assert.ok(requests.every(url => /^https:\/\/(?:api|content)\.dropboxapi\.com\//.test(url)), 'only the two origins the CSP allows');
});

// ---- Which copy (1.38): a copy started over elsewhere never overwrites this device's days silently ----

/** Opens the sealed copy now in the cloud with its passphrase, as “Enter the new passphrase” does. */
async function enterPassphrase(d, cloud, passphrase) {
  const { envelope } = readEnvelope(cloud.file.text);
  await d.protection.adopt({ ...envelope, key: await d.protection.unlockEnvelope(envelope, passphrase) });
}

/** What the sealed copy holds, opened with a passphrase. */
async function copyHolds(cloud, passphrase) {
  const { envelope } = readEnvelope(cloud.file.text);
  const { openEnvelope, unlockEnvelope } = await import('../src/sync/seal.js');
  return JSON.parse(await openEnvelope(envelope, await unlockEnvelope(envelope, passphrase)));
}

test('the copy carries a copyId: made with the copy, kept by a change of passphrase, made anew by Forgot it?', async () => {
  const cloud = cloudFile();
  const laptop = device(cloud);
  laptop.store.writeJSON('daily-planner:2026-11-10', { focus: 'x' });
  await laptop.protection.adopt(await createSeal('first passphrase one', FAST));
  await laptop.sync();
  const first = await copyHolds(cloud, 'first passphrase one');
  assert.match(first.copyId, /^[A-Za-z0-9_-]{20,}$/);
  assert.equal(first.copyFrom, 'new');
  assert.deepEqual(laptop.ledger.copy(), { cloud: 'google', id: first.copyId }, 'kept with the ledger');

  const next = await createSeal('second passphrase two', FAST);
  laptop.transport.rekey(next);
  await laptop.sync();
  laptop.transport.clearRekey();
  await laptop.protection.adopt(next);
  assert.equal((await copyHolds(cloud, 'second passphrase two')).copyId, first.copyId, 'the same copy under a new passphrase');

  const fresh = device(cloud);
  const over = await createSeal('third passphrase three', FAST);
  fresh.transport.rekey(over, { replace: true });
  await fresh.sync({ conflictResolution: 'local' });
  fresh.transport.clearRekey();
  const replaced = await copyHolds(cloud, 'third passphrase three');
  assert.notEqual(replaced.copyId, first.copyId);
  assert.equal(replaced.copyFrom, 'replaced');
});

test('Forgot it? on a device that missed a change: the laptop’s newer edit is never overwritten; it stops as a conflict', async () => {
  const cloud = cloudFile();
  const laptop = device(cloud);
  const tablet = device(cloud, { clock: '2026-11-10T09:05:00.000Z' });
  laptop.store.writeJSON('daily-planner:2026-11-02', { focus: 'v1' });
  laptop.store.writeJSON('daily-planner:settings', { categories: ['Deep work', 'Clients'] });
  await laptop.protection.adopt(await createSeal('first passphrase one', FAST));
  await laptop.sync();
  await enterPassphrase(tablet, cloud, 'first passphrase one');
  await tablet.sync();

  // The laptop edits, and changes the passphrase; the tablet missed both.
  laptop.store.writeJSON('daily-planner:2026-11-02', { focus: 'v2 written on the laptop' });
  const second = await createSeal('second passphrase two', FAST);
  laptop.transport.rekey(second);
  assert.equal((await laptop.sync()).status, 'ok');
  laptop.transport.clearRekey();
  await laptop.protection.adopt(second);

  // The tablet is asked for the new passphrase, and uses Forgot it?: the copy becomes the tablet's planner.
  await assert.rejects(() => tablet.sync(), error => error.reason === 'changed');
  const third = await createSeal('third passphrase three', FAST);
  tablet.transport.rekey(third, { replace: true });
  assert.equal((await tablet.sync({ conflictResolution: 'local' })).status, 'ok');
  tablet.transport.clearRekey();
  await tablet.protection.adopt(third);

  // The laptop types the new passphrase: another copy, so the bases go; what differs stops, what is the same is agreed on.
  await assert.rejects(() => laptop.sync(), error => error.reason === 'changed');
  await enterPassphrase(laptop, cloud, 'third passphrase three');
  const result = await laptop.sync();
  assert.equal(result.status, 'conflict');
  assert.equal(result.copyChanged, true);
  assert.deepEqual(result.conflicts, ['day:2026-11-02'], 'the settings are the same on both: no conflict for them');
  assert.deepEqual(laptop.store.readJSON('daily-planner:2026-11-02'), { focus: 'v2 written on the laptop' }, 'untouched');
  assert.equal((await copyHolds(cloud, 'third passphrase three')).records['day:2026-11-02'].value.focus, 'v1', 'nothing written meanwhile');

  // Settled by the person (“Keep this device”): the laptop's edit goes to the copy, and the tablet takes it.
  assert.equal((await laptop.sync({ conflictResolution: 'local' })).status, 'ok');
  const back = await tablet.sync();
  assert.deepEqual(back.pulled, ['day:2026-11-02']);
  assert.equal(tablet.store.readJSON('daily-planner:2026-11-02').focus, 'v2 written on the laptop');
  assert.equal((await laptop.sync()).status, 'ok', 'the same copy from then on');
});

test('Forgot it? on a brand-new phone: its first-run defaults never replace the laptop’s settings or today’s plan silently', async () => {
  const cloud = cloudFile();
  const laptop = device(cloud);
  laptop.store.writeJSON('daily-planner:settings', { categories: ['Deep work', 'Clients'], horizon: { years: { 2026: { misogi: 'Ride a mountain stage' } } } });
  laptop.store.writeJSON('daily-planner:2026-11-10', { focus: 'Laptop plan for today' });
  laptop.store.writeJSON('daily-planner:2026-11-09', { focus: 'Only on the laptop' });
  await laptop.protection.adopt(await createSeal('laptop passphrase one', FAST));
  await laptop.sync();

  const phone = device(cloud, { clock: '2026-11-10T09:30:00.000Z' });
  phone.store.writeJSON('daily-planner:settings', { categories: ['Default'], horizon: { years: {} } });
  phone.store.writeJSON('daily-planner:2026-11-10', { focus: '' });
  await assert.rejects(() => phone.sync(), error => error.reason === 'enter');
  const fresh = await createSeal('phone new passphrase', FAST);
  phone.transport.rekey(fresh, { replace: true });
  assert.equal((await phone.sync({ conflictResolution: 'local' })).status, 'ok');
  phone.transport.clearRekey();
  await phone.protection.adopt(fresh);

  await assert.rejects(() => laptop.sync(), error => error.reason === 'changed');
  await enterPassphrase(laptop, cloud, 'phone new passphrase');
  const result = await laptop.sync();
  assert.equal(result.status, 'conflict');
  assert.deepEqual(result.conflicts, ['day:2026-11-10', 'settings']);
  assert.deepEqual(laptop.store.readJSON('daily-planner:settings').categories, ['Deep work', 'Clients']);
  assert.equal(laptop.store.readJSON('daily-planner:settings').horizon.years[2026].misogi, 'Ride a mountain stage');
  assert.equal(laptop.store.readJSON('daily-planner:2026-11-10').focus, 'Laptop plan for today');

  // “Keep this device”: the laptop's planner goes back into the copy, its own day included; the phone then takes it.
  const kept = await laptop.sync({ conflictResolution: 'local' });
  assert.deepEqual(kept.pushed, ['day:2026-11-09', 'day:2026-11-10', 'settings']);
  const phoneAfter = await phone.sync();
  assert.deepEqual(phoneAfter.pulled, ['day:2026-11-09', 'day:2026-11-10', 'settings']);
  assert.deepEqual(phone.store.readJSON('daily-planner:settings').categories, ['Deep work', 'Clients']);
});

test('a copy deleted in the cloud and made again by another device is another copy: compared as at a first sync', async () => {
  const cloud = cloudFile();
  const seal = await createSeal('quiet harbour lantern', FAST);
  const laptop = device(cloud);
  const phone = device(cloud, { clock: '2026-11-10T09:05:00.000Z' });
  laptop.store.writeJSON('daily-planner:2026-11-10', { focus: 'Newer, on the laptop' });
  await laptop.protection.adopt(seal);
  await phone.protection.adopt(seal);
  await laptop.sync();
  await phone.sync();
  laptop.store.writeJSON('daily-planner:2026-11-10', { focus: 'Newer still, on the laptop' });
  await laptop.sync();
  cloud.file.text = null; // the folder emptied in the cloud
  // The phone, which never saw the laptop's last edit, makes the copy again from what it has.
  phone.store.writeJSON('daily-planner:2026-11-11', { focus: 'Phone' });
  await phone.sync();
  const result = await laptop.sync();
  assert.equal(result.status, 'conflict', 'the phone’s older version never replaces the laptop’s silently');
  assert.deepEqual(result.conflicts, ['day:2026-11-10']);
  assert.equal(laptop.store.readJSON('daily-planner:2026-11-10').focus, 'Newer still, on the laptop');
});

test('a 1.37 plain copy: sealed by another device, it is the same copy (no conflict); started over instead, it is another', async () => {
  // Two devices synced the plain Google Drive copy with 1.37: their ledgers know no copyId, only that Drive was synced.
  const legacy = d => {
    const state = JSON.parse(d.storage.getItem('daily-planner-sync:ledger'));
    delete state.copy;
    d.storage.setItem('daily-planner-sync:ledger', JSON.stringify(state));
    d.storage.setItem('daily-planner-sync:google', JSON.stringify({ connected: true, fileId: 'file_1', lastSyncedAt: '2026-10-01T08:00:00.000Z', lastError: '' }));
  };
  for (const ending of ['sealed', 'replaced']) {
    const cloud = cloudFile(plainCopy({}));
    const laptop = device(cloud);
    const phone = device(cloud, { clock: '2026-11-10T09:05:00.000Z' });
    laptop.store.writeJSON('daily-planner:2026-11-10', { focus: 'Plain days' });
    phone.store.writeJSON('daily-planner:2026-11-11', { focus: 'Only on the phone' });
    await laptop.sync();
    await phone.sync();
    await laptop.sync();
    legacy(laptop);
    legacy(phone);
    assert.deepEqual(phone.ledger.copy(), { cloud: 'google', id: '' }, 'a 1.37 ledger: the plain Drive copy');
    // The laptop edits a day the phone has as it was.
    laptop.store.writeJSON('daily-planner:2026-11-10', { focus: 'Edited before sealing' });
    if (ending === 'sealed') {
      await laptop.protection.adopt(await createSeal('quiet harbour lantern', FAST));
      await laptop.sync();
      assert.equal((await copyHolds(cloud, 'quiet harbour lantern')).copyFrom, 'continued');
    } else {
      const fresh = device(cloud, { clock: '2026-11-12T09:00:00.000Z' });
      fresh.store.writeJSON('daily-planner:2026-11-10', { focus: 'A new browser' });
      fresh.transport.rekey(await createSeal('quiet harbour lantern', FAST), { replace: true });
      await fresh.sync({ conflictResolution: 'local' });
      fresh.transport.clearRekey();
    }
    await assert.rejects(() => phone.sync(), error => error.reason === 'enter');
    await enterPassphrase(phone, cloud, 'quiet harbour lantern');
    const result = await phone.sync();
    if (ending === 'sealed') {
      assert.equal(result.status, 'ok', 'the first sight of the id, minted by sealing the plain copy this phone synced: the same copy');
      assert.equal(result.copyChanged, false);
      assert.deepEqual(result.pulled, ['day:2026-11-10']);
      assert.equal(phone.store.readJSON('daily-planner:2026-11-10').focus, 'Edited before sealing');
    } else {
      assert.equal(result.status, 'conflict', 'minted by starting over: another copy');
      assert.deepEqual(result.conflicts, ['day:2026-11-10']);
      assert.equal(phone.store.readJSON('daily-planner:2026-11-10').focus, 'Plain days');
    }
  }
});

test('sameCopy(): the rule, case by case', async () => {
  const { sameCopy } = await import('../src/sync/ledger.js');
  const sealed = (id, from = 'new', cloud = 'google') => ({ cloud, format: 'sealed', id, from });
  assert.equal(sameCopy({ cloud: 'google', id: 'a' }, sealed('a')), true, 'the same id');
  assert.equal(sameCopy({ cloud: 'google', id: 'a' }, sealed('b', 'replaced')), false, 'another id');
  assert.equal(sameCopy({ cloud: 'google', id: 'a' }, sealed('a', 'new', 'dropbox')), false, 'another cloud');
  assert.equal(sameCopy({ cloud: 'google', id: 'a' }, { cloud: 'google', format: 'plain', id: '' }), false, 'a plain copy where a sealed one was: made again by an older planner');
  assert.equal(sameCopy({ cloud: 'google', id: '' }, { cloud: 'google', format: 'plain', id: '' }), true, 'plain, as before');
  assert.equal(sameCopy({ cloud: 'google', id: '' }, sealed('c', 'continued')), true, 'the plain copy, sealed');
  assert.equal(sameCopy({ cloud: 'google', id: '' }, sealed('c', 'replaced')), false);
  assert.equal(sameCopy({ cloud: 'google', id: '' }, sealed('c', 'new')), false);
  assert.equal(sameCopy({ cloud: 'dropbox', id: '' }, sealed('c', 'continued')), false, 'the plain copy of another cloud');
  assert.equal(sameCopy(null, sealed('a')), false, 'never synced: nothing to keep');
});

test('Disconnect with no cloud left forgets everything of the seal; with another still connected, nothing', async () => {
  const keyStore = createMemoryKeyStore();
  const storage = new MemoryStorage();
  const protection = createSyncProtection({ storage, keyStore });
  await protection.adopt(await createSeal('quiet harbour lantern', FAST));
  await protection.forget();
  assert.ok(JSON.parse(storage.getItem(PROTECTION_KEY)).sealedSince, 'the key goes; that it sealed once stays');
  await protection.adopt(await createSeal('quiet harbour lantern', FAST));
  await protection.forget({ everything: true });
  assert.equal(storage.getItem(PROTECTION_KEY), null);
  assert.equal(keyStore.destroyed, true);
  assert.equal(protection.wasSealed(), false);
});
