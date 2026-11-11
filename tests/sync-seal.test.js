import test from 'node:test';
import assert from 'node:assert/strict';
import { MAX_ITERATIONS, MIN_ITERATIONS, PASSPHRASE_MIN_LENGTH, SEAL_ITERATIONS, SEAL_MAGIC, SealError, createSeal, deriveSealKey, keyOpensCheck, openEnvelope, passphraseStrength, readEnvelope, sealText, unlockEnvelope } from '../src/sync/seal.js';

// The real count is 600,000; the tests use the lowest a copy may ask for, to stay quick.
const FAST = { iterations: MIN_ITERATIONS };
const PASS = 'quiet harbour lantern';

/** The sealed file's envelope line, changed by `edit`, put back together. */
function tamper(text, edit) {
  const [first, body] = text.split('\n');
  const envelope = JSON.parse(body);
  edit(envelope);
  return `${first}\n${JSON.stringify(envelope)}\n`;
}

const flip = base64 => {
  const bytes = Buffer.from(base64, 'base64');
  bytes[bytes.length - 1] ^= 1;
  return bytes.toString('base64');
};

test('seal and open: the text comes back, under a versioned envelope that keeps the salt and parameters', async () => {
  const seal = await createSeal(PASS, FAST);
  const document = JSON.stringify({ app: 'Daily Planner', records: { 'day:2026-11-10': { value: { focus: 'Write the quarterly letter' } } } });
  const text = await sealText(document, seal);
  assert.ok(text.startsWith(`${SEAL_MAGIC}/1\n`));
  assert.ok(!text.includes('quarterly letter'), 'nothing readable in the cloud');
  const found = readEnvelope(text);
  assert.equal(found.format, 'sealed');
  assert.equal(found.envelope.salt, seal.salt);
  assert.equal(found.envelope.iterations, MIN_ITERATIONS);
  const body = JSON.parse(text.split('\n')[1]);
  assert.deepEqual(Object.keys(body), ['v', 'cipher', 'kdf', 'check', 'iv', 'data']);
  assert.deepEqual(body.kdf, { name: 'PBKDF2', hash: 'SHA-256', iterations: MIN_ITERATIONS, salt: seal.salt });
  assert.equal(body.cipher, 'AES-256-GCM');
  assert.equal(Buffer.from(seal.salt, 'base64').length, 16);
  assert.equal(Buffer.from(body.iv, 'base64').length, 12);
  // Another device: the passphrase makes the key again from the envelope.
  const key = await unlockEnvelope(found.envelope, PASS);
  assert.ok(key);
  assert.equal(await openEnvelope(found.envelope, key), document);
});

test('the default count is 600,000 rounds, and the key never leaves WebCrypto', async () => {
  assert.equal(SEAL_ITERATIONS, 600_000);
  assert.equal(PASSPHRASE_MIN_LENGTH, 10);
  const seal = await createSeal(PASS, FAST);
  assert.equal(seal.key.extractable, false);
  assert.deepEqual(seal.key.algorithm, { name: 'AES-GCM', length: 256 });
  await assert.rejects(() => crypto.subtle.exportKey('raw', seal.key));
  assert.ok(!('passphrase' in seal), 'only the key, salt, count and check are kept');
});

test('every write has its own IV: the same text never seals the same way twice', async () => {
  const seal = await createSeal(PASS, FAST);
  const first = readEnvelope(await sealText('same', seal)).envelope;
  const second = readEnvelope(await sealText('same', seal)).envelope;
  assert.notEqual(first.iv, second.iv);
  assert.notEqual(first.data, second.data);
  assert.equal(first.check.iv, second.check.iv, 'the check is sealed once, with its own IV');
});

test('a wrong passphrase opens nothing, and says so', async () => {
  const seal = await createSeal(PASS, FAST);
  const { envelope } = readEnvelope(await sealText('secret', seal));
  assert.equal(await unlockEnvelope(envelope, 'quiet harbour lanterns'), null);
  assert.equal(await unlockEnvelope(envelope, ''), null);
  const wrongKey = await deriveSealKey('another passphrase', envelope);
  assert.equal(await keyOpensCheck(envelope, wrongKey), false);
  await assert.rejects(() => openEnvelope(envelope, wrongKey), error => error instanceof SealError && error.code === 'wrong-passphrase');
});

test('tampering is an error, never a wrong text: data, IV, check and header are all bound', async () => {
  const seal = await createSeal(PASS, FAST);
  const text = await sealText('{"app":"Daily Planner"}', seal);
  const open = async changed => {
    const found = readEnvelope(changed);
    if (found.problem) throw new SealError(found.problem, 'damaged');
    return openEnvelope(found.envelope, seal.key);
  };
  // The data changed: the check still opens, so it is damage, not a wrong passphrase.
  await assert.rejects(() => open(tamper(text, envelope => { envelope.data = flip(envelope.data); })), error => error.code === 'damaged');
  await assert.rejects(() => open(tamper(text, envelope => { envelope.iv = flip(envelope.iv); })), error => error.code === 'damaged');
  // The header is additional data: a changed count (still in range) or check no longer opens with the key.
  await assert.rejects(() => open(tamper(text, envelope => { envelope.kdf.iterations = MIN_ITERATIONS + 1; })), error => error instanceof SealError);
  await assert.rejects(() => open(tamper(text, envelope => { envelope.check.data = flip(envelope.check.data); })), error => error instanceof SealError);
  // Out of bounds or not ours: refused before any work.
  for (const edit of [
    envelope => { envelope.kdf.iterations = MAX_ITERATIONS + 1; },
    envelope => { envelope.kdf.iterations = 1000; },
    envelope => { envelope.kdf.hash = 'SHA-1'; },
    envelope => { envelope.cipher = 'AES-128-CBC'; },
    envelope => { envelope.v = 2; },
    envelope => { envelope.iv = 'AAAA'; },
    envelope => { envelope.kdf.salt = 'c2hvcnQ='; },
    envelope => { delete envelope.check; }
  ]) assert.deepEqual(readEnvelope(tamper(text, edit)), { format: 'sealed', problem: 'damaged' });
  assert.deepEqual(readEnvelope(`${text.split('\n')[0]}\n{cut short`), { format: 'sealed', problem: 'damaged' });
  // Unchanged, it opens.
  assert.equal(await open(text), '{"app":"Daily Planner"}');
});

test('the version: a newer format is “unsupported” (update the planner), an unreadable one “damaged”', () => {
  assert.deepEqual(readEnvelope(`${SEAL_MAGIC}/2\n{}`), { format: 'sealed', problem: 'unsupported' });
  assert.deepEqual(readEnvelope(`${SEAL_MAGIC}/x\n{}`), { format: 'sealed', problem: 'damaged' });
  assert.deepEqual(readEnvelope(`${SEAL_MAGIC}/0\n{}`), { format: 'sealed', problem: 'damaged' });
});

test('what else the file may hold: nothing, a plain copy from before 1.38, or something else', () => {
  assert.deepEqual(readEnvelope(''), { format: 'none' });
  assert.deepEqual(readEnvelope('  \n'), { format: 'none' });
  const plain = { app: 'Daily Planner', kind: 'personal-sync', version: 1, records: {} };
  assert.deepEqual(readEnvelope(JSON.stringify(plain)), { format: 'plain', document: plain });
  assert.deepEqual(readEnvelope('{"app":"Something else"}'), { format: 'unknown' });
  assert.deepEqual(readEnvelope('<html>'), { format: 'unknown' });
});

test('a planner before 1.38 reads the file as JSON: a sealed copy stops it before it can write', async () => {
  const text = await sealText('{}', await createSeal(PASS, FAST));
  assert.throws(() => JSON.parse(text), SyntaxError);
});

test('the same passphrase typed on any device: Unicode is normalised', async () => {
  const composed = 'café au lait, s’il vous plaît';
  const decomposed = composed.normalize('NFD');
  assert.notEqual(composed, decomposed);
  const seal = await createSeal(composed, FAST);
  const { envelope } = readEnvelope(await sealText('ok', seal));
  const key = await unlockEnvelope(envelope, decomposed);
  assert.ok(key);
  assert.equal(await openEnvelope(envelope, key), 'ok');
});

test('the strength hint: long enough first, then not an obvious one; a few words are best', () => {
  assert.deepEqual(passphraseStrength(''), { score: 0, ok: false, label: '', hint: 'At least 10 characters. A few unrelated words work well.' });
  assert.deepEqual(passphraseStrength('short'), { score: 0, ok: false, label: 'Too short', hint: 'At least 10 characters.' });
  assert.equal(passphraseStrength('short1').hint, passphraseStrength('short12').hint, 'the same words until it is long enough: read out once');
  for (const weak of ['aaaaaaaaaaaa', 'password123', '1234567890', 'qwertyuiop', 'dailyplanner']) assert.equal(passphraseStrength(weak).ok, false, weak);
  assert.equal(passphraseStrength('sunflowers').ok, true);
  assert.equal(passphraseStrength('sunflowers').label, 'Fair');
  assert.equal(passphraseStrength('quiet harbour lantern').label, 'Strong');
  assert.ok(passphraseStrength('Tr0mb0ne-Kettle').score >= 3);
});
