// Cloudflare Pages Function: every /api/* request of the deployed planner.
// Bindings (Pages → Settings): D1 database as `DB` (its tables:
// migrations/schema.sql), secret `ADMIN_TOKEN`, optional secret
// `ADMIN_TOTP_SECRET` (base32) to require an authenticator code at owner
// sign-in, optional `ALLOWED_ORIGINS` (comma-separated) for cross-origin
// callers, optional `PUBLIC_BASE_URL` (the production address).
// Optional email through Resend: secret `RESEND_API_KEY`, `EMAIL_FROM`
// ("Name <address>" on a domain verified in Resend), `OWNER_EMAIL` (question
// notifications and test sends) and `EMAIL_DAILY_LIMIT` (default 100,
// Resend's free plan).
// The abuse limits count requests per connection under a salted hash of
// CF-Connecting-IP (server/rate-limit.js), never the address.
// Setup guide: docs/configuration.md. Every setting is listed in
// server/config-inventory.js and checked on /admin/configuration/ (the whole
// `env` goes to those checks, which never answer a secret's value).

import { createPlannerApi } from '../../server/planner-api.js';
import { createD1Store } from '../../server/d1-store.js';

export async function onRequest(context) {
  const { request, env } = context;
  if (!env.DB) {
    return new Response(JSON.stringify({ error: 'The D1 binding "DB" is not configured.' }), { status: 503, headers: { 'content-type': 'application/json; charset=utf-8' } });
  }
  const handle = createPlannerApi({
    store: createD1Store(env.DB),
    adminToken: env.ADMIN_TOKEN || '',
    adminTotpSecret: env.ADMIN_TOTP_SECRET || '',
    allowedOrigins: env.ALLOWED_ORIGINS || '',
    resendApiKey: env.RESEND_API_KEY || '',
    emailFrom: env.EMAIL_FROM || '',
    ownerEmail: env.OWNER_EMAIL || '',
    emailDailyLimit: env.EMAIL_DAILY_LIMIT ?? '',
    publicBaseUrl: env.PUBLIC_BASE_URL || '',
    // Owner notifications and the expired rows of the abuse limits finish after the response has been sent.
    defer: promise => context.waitUntil(promise),
    // The configuration checks (POST /api/admin/config/check) read the variables, secrets and bindings
    // themselves (DB, and ASSETS for the deployed runtime-config.js).
    configEnv: env
  });
  return handle(request);
}
