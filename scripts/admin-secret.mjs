// Generate owner-dashboard secrets, or show the current authenticator code.
//
//   node scripts/admin-secret.mjs                 new ADMIN_TOKEN + ADMIN_TOTP_SECRET
//   node scripts/admin-secret.mjs --code <base32> current 6-digit code for a secret
//   node scripts/admin-secret.mjs --code          same, using $ADMIN_TOTP_SECRET
//
// No dependencies: Node's crypto plus server/admin-auth.js (the code the API
// itself uses to check codes).

import { randomBytes } from 'node:crypto';
import { base32Decode, base32Encode, totp, totpSecondsLeft, TOTP_MIN_SECRET_BYTES } from '../server/admin-auth.js';

const args = process.argv.slice(2);

if (args.includes('--help') || args.includes('-h')) {
  console.log('Usage: node scripts/admin-secret.mjs [--code [base32-secret]]');
  process.exit(0);
}

const codeIndex = args.indexOf('--code');
if (codeIndex >= 0) {
  const next = args[codeIndex + 1];
  const secret = next && !next.startsWith('--') ? next : process.env.ADMIN_TOTP_SECRET || '';
  const bytes = base32Decode(secret);
  if (!bytes || bytes.length < TOTP_MIN_SECRET_BYTES) {
    console.error('Give a base32 secret (A–Z, 2–7, at least 16 characters): --code <secret>, or set ADMIN_TOTP_SECRET.');
    process.exit(1);
  }
  const now = Date.now();
  console.log(`${await totp(bytes, now)}   (changes in ${totpSecondsLeft(now)} s)`);
  process.exit(0);
}

const adminToken = randomBytes(32).toString('base64url');
const totpSecret = base32Encode(randomBytes(20));
const issuer = encodeURIComponent('Daily Planner');
const otpauth = `otpauth://totp/${issuer}:owner?secret=${totpSecret}&issuer=${issuer}&digits=6&period=30`;
const grouped = totpSecret.match(/.{1,4}/g).join(' ');

console.log(`
Daily Planner owner dashboard: new secrets
==========================================

ADMIN_TOKEN=${adminToken}
ADMIN_TOTP_SECRET=${totpSecret}

Authenticator URI (some apps and password managers accept it directly):
${otpauth}

1. Save both values in your password manager now. They are not stored
   anywhere else and are not shown again.
2. In your authenticator app, add an account with "Enter a setup key"
   (time-based): account "Daily Planner owner", key
   ${grouped}
3. Cloudflare Pages → your project → Settings → Variables and secrets: add
   ADMIN_TOKEN and ADMIN_TOTP_SECRET as encrypted secrets (Production), then
   redeploy.
4. Sign in at /admin/ with the token and the 6-digit code from the app.

Compare with the app:  node scripts/admin-secret.mjs --code <setup key>
Try it locally:        ADMIN_TOKEN=... ADMIN_TOTP_SECRET=... npm run start:api
`);
