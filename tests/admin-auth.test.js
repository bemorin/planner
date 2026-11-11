import test from 'node:test';
import assert from 'node:assert/strict';
import { base32Decode, base32Encode, hotp, issueSession, looksLikeSession, SESSION_TTL_MS, signSession, timingSafeEqual, totp, verifySession, verifyTotp } from '../server/admin-auth.js';

// RFC 6238 appendix B: the SHA-1 seed is the ASCII string "12345678901234567890".
const RFC_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
const RFC_ASCII = '12345678901234567890';
const seconds = value => value * 1000;

test('base32 decodes the RFC seed and tolerates spaces, lowercase and padding', () => {
  assert.equal(new TextDecoder().decode(base32Decode(RFC_SECRET)), RFC_ASCII);
  assert.equal(new TextDecoder().decode(base32Decode('gezd gnbv gy3t qojq gezd gnbv gy3t qojq')), RFC_ASCII);
  assert.equal(new TextDecoder().decode(base32Decode(`${RFC_SECRET}====`)), RFC_ASCII);
  assert.equal(new TextDecoder().decode(base32Decode('MZXW6===')), 'foo');
  assert.equal(base32Decode(''), null);
  assert.equal(base32Decode('GEZD1NBV'), null, '1 is not in the base32 alphabet');
  assert.equal(base32Decode('GEZD!NBV'), null);
});

test('base32 encodes without padding and round-trips random bytes', () => {
  assert.equal(base32Encode(new TextEncoder().encode(RFC_ASCII)), RFC_SECRET);
  assert.equal(base32Encode(new TextEncoder().encode('foo')), 'MZXW6');
  for (let length = 1; length <= 25; length += 1) {
    const bytes = crypto.getRandomValues(new Uint8Array(length));
    assert.deepEqual(base32Decode(base32Encode(bytes)), bytes);
  }
});

test('TOTP matches the RFC 6238 SHA-1 test vectors', async () => {
  const vectors = [
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
    [20000000000, '65353130']
  ];
  for (const [time, code] of vectors) {
    assert.equal(await totp(RFC_SECRET, seconds(time), { digits: 8 }), code, `8 digits at T=${time}`);
    assert.equal(await totp(RFC_SECRET, seconds(time)), code.slice(-6), `6 digits at T=${time}`);
  }
  assert.equal(await totp(RFC_SECRET, seconds(59)), '287082');
  assert.equal(await totp(RFC_SECRET, seconds(1111111109)), '081804');
  assert.equal(await totp(RFC_SECRET, seconds(1234567890)), '005924');
  // RFC 4226 appendix D (HOTP, counter 0 and 9).
  assert.equal(await hotp(RFC_SECRET, 0), '755224');
  assert.equal(await hotp(RFC_SECRET, 9), '520489');
});

test('TOTP verification accepts the current step and one step either side', async () => {
  // T=1234567890 is the first second of its 30-second step.
  const code = '005924';
  assert.equal(await verifyTotp(RFC_SECRET, code, seconds(1234567890)), true);
  assert.equal(await verifyTotp(RFC_SECRET, code, seconds(1234567860)), true, 'one step early (clock behind)');
  assert.equal(await verifyTotp(RFC_SECRET, code, seconds(1234567949)), true, 'one step late (clock ahead)');
  assert.equal(await verifyTotp(RFC_SECRET, code, seconds(1234567859)), false, 'two steps early');
  assert.equal(await verifyTotp(RFC_SECRET, code, seconds(1234567950)), false, 'two steps late');
  assert.equal(await verifyTotp(RFC_SECRET, '005 924', seconds(1234567890)), true, 'spaces are ignored');
  assert.equal(await verifyTotp('gezd gnbv gy3t qojq gezd gnbv gy3t qojq', code, seconds(1234567890)), true);
  for (const bad of ['', '05924', '0059240', 'abcdef', '005925', null, undefined]) {
    assert.equal(await verifyTotp(RFC_SECRET, bad, seconds(1234567890)), false, `refuses ${bad}`);
  }
  assert.equal(await verifyTotp('not base32!', code, seconds(1234567890)), false);
});

test('sessions are signed, expire after 8 hours and resist tampering', async () => {
  const now = Date.parse('2026-10-09T08:00:00Z');
  const { session, expiresAt } = await issueSession('secret', now);
  assert.equal(expiresAt, now + SESSION_TTL_MS);
  assert.equal(SESSION_TTL_MS, 8 * 3600 * 1000);
  assert.match(session, /^v1\.\d+\.[0-9a-f]{64}$/);
  assert.equal(session, await signSession('secret', expiresAt), 'deterministic for a given expiry');
  assert.equal(looksLikeSession(session), true);
  assert.equal(looksLikeSession('secret'), false);

  assert.equal(await verifySession('secret', session, now), true);
  assert.equal(await verifySession('secret', session, expiresAt - 1), true);
  assert.equal(await verifySession('secret', session, expiresAt), false, 'expired');
  assert.equal(await verifySession('other-token', session, now), false, 'rotating ADMIN_TOKEN signs everyone out');

  const [version, expiry, mac] = session.split('.');
  const flipped = mac.slice(0, -1) + (mac.at(-1) === '0' ? '1' : '0');
  assert.equal(await verifySession('secret', `${version}.${expiry}.${flipped}`, now), false, 'altered signature');
  assert.equal(await verifySession('secret', `${version}.${Number(expiry) + 3600000}.${mac}`, now), false, 'extended expiry');
  assert.equal(await verifySession('secret', `${version}.0${expiry}.${mac}`, now), false, 'non-canonical expiry');
  assert.equal(await verifySession('secret', `v2.${expiry}.${mac}`, now), false);
  assert.equal(await verifySession('secret', `${session} `, now), false);
  assert.equal(await verifySession('secret', '', now), false);
  assert.equal(await verifySession('', session, now), false);

  // A correctly signed session that claims to outlive the 8-hour limit is refused.
  const tooLong = await signSession('secret', now + 30 * 86400000);
  assert.equal(await verifySession('secret', tooLong, now), false);
});

test('timing-safe comparison', () => {
  assert.equal(timingSafeEqual('abc', 'abc'), true);
  assert.equal(timingSafeEqual('abc', 'abd'), false);
  assert.equal(timingSafeEqual('abc', 'abcd'), false);
  assert.equal(timingSafeEqual('', ''), true);
  assert.equal(timingSafeEqual('', 'a'), false);
});
