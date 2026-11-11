import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { canAddColumn, createConfigCheckRoute, describeShape, migrationSchema, parseRuntimeConfig, runConfigChecks, STATES, tableColumns, tokenStrength } from '../server/admin-config.js';
import { createRateLimiter } from '../server/admin-limits.js';
import { CONFIG_CHECKS, CONFIG_VARIABLES, configVariable, MIGRATIONS } from '../server/config-inventory.js';
import { createMemoryStore, createPlannerApi } from '../server/planner-api.js';
import { BASE32_ALPHABET, fixFirst, newAdminToken, newTotpSecret, otpauthUri, summaryText, totalsText } from '../admin/configuration/config-model.js';

// The configuration checks (server/admin-config.js) against simulated services:
// every service answer that matters, the database, the absence of any secret
// in the answer, the owner's sign-in and the rate limit, and the page's pure
// helpers (admin/configuration/config-model.js).

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const ORIGIN = 'https://planner.bemorin.com';
// Secret-looking values from a fixed sequence, not crypto randomness: a random secret now and then shares 4
// characters with a service's words (“…alid…”, “RROR”), which the scrubber then hides, as it should, and an
// exact summary would fail once in a while. The same values every run keep the tests steady.
let draws = 0x2f6b1c3d;
const nextByte = () => { draws = (Math.imul(draws, 1664525) + 1013904223) >>> 0; return draws >>> 24; };
const random = (length, alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789') => Array.from({ length }, () => alphabet[nextByte() % alphabet.length]).join('');
// Fake secrets with their public prefix: only the part after it is secret.
const SECRETS = {
  ADMIN_TOKEN: random(48),
  ADMIN_TOTP_SECRET: random(32, BASE32_ALPHABET),
  RESEND_API_KEY: `re_${random(32)}`
};
const PREFIXES = { RESEND_API_KEY: 're_' };

const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

function migrationRows(skip = [], { dropColumn = null } = {}) {
  const rows = [];
  for (const migration of MIGRATIONS) {
    const schema = migrationSchema(migration.sql);
    for (const table of schema.tables) {
      if (skip.includes(table.name)) continue;
      const columns = table.columns.filter(column => !(dropColumn && dropColumn[0] === table.name && dropColumn[1] === column.name));
      rows.push({ type: 'table', name: table.name, tableName: table.name, sql: `CREATE TABLE ${table.name} (\n  ${columns.map(column => column.definition).join(',\n  ')}\n)` });
    }
    for (const index of schema.indexes) if (!skip.includes(index.name) && !skip.includes(index.table)) rows.push({ type: 'index', name: index.name, tableName: index.table, sql: '' });
  }
  return rows;
}

function fakeDb({ rows = migrationRows(), fail = false } = {}) {
  return {
    prepare(sql) {
      return {
        first: async () => { if (fail) throw new Error('D1_ERROR: no such database'); return { one: 1 }; },
        all: async () => { assert.match(sql, /sqlite_master/); return { results: rows }; }
      };
    }
  };
}

const builtConfig = values => `globalThis.__DAILY_PLANNER_CONFIG__ = Object.freeze(${JSON.stringify(values, null, 2)});\n`;
const assets = values => ({ fetch: async () => new Response(builtConfig(values), { headers: { 'content-type': 'text/javascript' } }) });

/** A production environment where everything is right. */
function goodEnv(overrides = {}) {
  const built = { PLANNER_API_URL: '/api', SUPPORT_EMAIL: 'support@example.com', LEGAL_PHONE: '+33199001234', LEGAL_ADDRESS: '1 rue de la Paix, Paris' };
  return {
    ...SECRETS,
    EMAIL_FROM: 'Daily Planner <hello@example.com>', OWNER_EMAIL: 'owner@example.com', PUBLIC_BASE_URL: ORIGIN,
    DAILY_PLANNER_API_URL: '/api', DAILY_PLANNER_SUPPORT_EMAIL: built.SUPPORT_EMAIL,
    DAILY_PLANNER_LEGAL_PHONE: built.LEGAL_PHONE, DAILY_PLANNER_LEGAL_ADDRESS: built.LEGAL_ADDRESS,
    DB: fakeDb(),
    ASSETS: assets(built),
    ...overrides
  };
}

/**
 * A fetch standing in for Resend. `routes` overrides an answer by key:
 * 'domains'; a function receives the URL and init. Calls are recorded.
 */
function services(routes = {}) {
  const calls = [];
  const fetch = async (url, init = {}) => {
    const target = new URL(url);
    calls.push({ url: target.href, method: init.method || 'GET', headers: init.headers || {} });
    const answer = key => (typeof routes[key] === 'function' ? routes[key](target, init) : routes[key]);
    if (target.hostname === 'api.resend.com' && target.pathname === '/domains') return answer('domains') ?? json(200, { object: 'list', has_more: false, data: [{ id: 'd1', name: 'example.com', status: 'verified', capabilities: { sending: 'enabled', receiving: 'disabled' } }] });
    return json(404, { message: 'unexpected call in the test' });
  };
  return { fetch, calls };
}

async function check({ env = goodEnv(), routes = {}, origin = ORIGIN, timeoutMs = 5000, cspReports = async () => [] } = {}) {
  const { fetch, calls } = services(routes);
  const result = await runConfigChecks({ env, fetch, origin, timeoutMs, cspReports });
  const items = Object.fromEntries(result.items.map(item => [item.id, item]));
  return { result, items, calls };
}

test('everything right: every setting is OK or optional, nothing to fix', async () => {
  const { result, items, calls } = await check();
  const notOk = result.items.filter(item => !['ok', 'optional-missing'].includes(item.state)).map(item => `${item.id}: ${item.state}${item.warning ? ' (warning)' : ''}`);
  assert.deepEqual(notOk, []);
  assert.deepEqual(fixFirst(result.items), []);
  assert.deepEqual([result.counts.problem, result.counts.missing, result.counts.warning], [0, 0, 0]);
  assert.equal(result.deployment.production, true);
  assert.deepEqual(result.notes, []);
  assert.deepEqual(STATES, ['ok', 'problem', 'missing', 'optional-missing', 'untested']);
  assert.deepEqual(Object.keys(result), ['checkedAt', 'durationMs', 'deployment', 'groups', 'items', 'counts', 'notes']);
  assert.equal(items.EMAIL_FROM.summary, 'Its domain is verified in Resend.');
  assert.equal(items.RESEND_API_KEY.summary, 'Valid: Resend accepted it (full access).');
  assert.equal(items.ADMIN_TOTP_SECRET.summary, 'Two-factor sign-in is on.');
  assert.match(items['migration:schema.sql'].summary, /^Applied: 8 tables and 4 indexes, every column in place\.$/);
  // Every call is a read: GET only, to Resend (the one service the server talks to).
  assert.equal(calls.length, 1);
  assert.deepEqual([calls[0].method, calls[0].url], ['GET', 'https://api.resend.com/domains']);
  assert.equal(calls[0].headers.authorization, `Bearer ${SECRETS.RESEND_API_KEY}`);
  // One row per setting, for the schema and per check, in the order of the groups.
  assert.equal(result.items.length, CONFIG_VARIABLES.length + MIGRATIONS.length + CONFIG_CHECKS.length);
  assert.deepEqual(result.groups.map(group => group.id), ['build', 'functions', 'database', 'security', 'resend', 'legal']);
  assert.deepEqual([...new Set(result.items.map(item => item.group))], result.groups.map(group => group.id));
});

test('settings an earlier release used, still set on Cloudflare, are neither listed, read nor sent anywhere', async () => {
  // The owner may not have deleted them yet (the release notes list them): the check ignores them.
  const leftovers = { CREEM_API_KEY: `creem_${random(32)}`, CREEM_WEBHOOK_SECRET: `whsec_${random(32)}`, PLUS_SIGNING_KEY: random(120), DAILY_PLANNER_AFFILIATE_URL: 'https://affiliates.example.com/x' };
  const { result, calls } = await check({ env: goodEnv(leftovers) });
  assert.deepEqual(result.items.filter(item => Object.keys(leftovers).some(name => item.id.includes(name))), []);
  assert.deepEqual(result.items.filter(item => !['ok', 'optional-missing'].includes(item.state)), [], 'nothing to fix because of them');
  assert.deepEqual(calls.map(call => call.url), ['https://api.resend.com/domains']);
  const text = JSON.stringify(result);
  for (const value of Object.values(leftovers)) assert.ok(!text.includes(value.slice(-12)), 'their values never appear');
  for (const name of Object.keys(leftovers)) assert.equal(configVariable(name), null, name);
});

test('a service that doesn’t answer in time leaves its rows “present, not tested”, within the timeout', async () => {
  const hang = () => new Promise(() => {});
  const started = Date.now();
  const { items } = await check({ timeoutMs: 60, routes: { domains: hang } });
  assert.ok(Date.now() - started < 1500, 'every call gives up after the timeout');
  assert.equal(items.RESEND_API_KEY.state, 'untested');
  assert.equal(items.EMAIL_FROM.state, 'untested');
  const busy = await check({ routes: { domains: json(429, { name: 'rate_limit_exceeded' }) } });
  assert.match(busy.items.RESEND_API_KEY.summary, /limiting requests \(HTTP 429\)/);
});

test('Resend: a sending-only key is valid; an invalid or inactive key is a problem; the sender’s domain must be verified', async () => {
  const restricted = await check({ routes: { domains: json(401, { statusCode: 401, name: 'restricted_api_key', message: 'This API key is restricted to only send emails' }) } });
  assert.equal(restricted.items.RESEND_API_KEY.state, 'ok');
  assert.match(restricted.items.RESEND_API_KEY.summary, /^Valid, with sending access only/);
  assert.equal(restricted.items.EMAIL_FROM.state, 'untested');
  assert.match(restricted.items.EMAIL_FROM.summary, /Send me a test email/);

  // Resend's own words only after a 400: after a 401 or a 403 they may repeat the key, so the summary uses ours.
  for (const [status, name, message, said] of [[400, 'validation_error', 'API key is invalid', ': “API key is invalid”'], [401, 'validation_error', 'API key is invalid', ': the key is unknown or was deleted'], [403, 'restricted_api_key', 'API key is not active', ': the key is not allowed to read this account, or is not active']]) {
    const { items } = await check({ routes: { domains: json(status, { name, message }) } });
    assert.equal(items.RESEND_API_KEY.state, 'problem', `${status} ${name}`);
    assert.equal(items.RESEND_API_KEY.summary, `Resend refused it (HTTP ${status}${said}).`);
    assert.equal(items.EMAIL_FROM.state, 'untested');
  }
  const pending = await check({ routes: { domains: json(200, { data: [{ name: 'example.com', status: 'pending' }] }) } });
  assert.equal(pending.items.EMAIL_FROM.state, 'problem');
  assert.match(pending.items.EMAIL_FROM.summary, /“pending” in Resend, not verified/);
  const absent = await check({ routes: { domains: json(200, { data: [{ name: 'other.example', status: 'verified' }] }) } });
  assert.match(absent.items.EMAIL_FROM.summary, /isn’t in this Resend account/);
  assert.match(absent.items.EMAIL_FROM.fix.steps[0], /Resend → Domains → Add domain/);
  const bad = await check({ env: goodEnv({ EMAIL_FROM: 'Daily Planner', OWNER_EMAIL: 'me at home', EMAIL_DAILY_LIMIT: '0' }) });
  assert.equal(bad.items.EMAIL_FROM.state, 'problem');
  assert.equal(bad.items.OWNER_EMAIL.state, 'problem');
  assert.equal(bad.items.EMAIL_DAILY_LIMIT.state, 'problem');
  assert.match(bad.items.EMAIL_DAILY_LIMIT.summary, /^0 stops every email/);
});

test('build variables: compared with the value the deployed runtime-config.js was built with', async () => {
  const stale = await check({ env: goodEnv({ DAILY_PLANNER_LEGAL_ADDRESS: '2 avenue Foch, Paris' }) });
  assert.equal(stale.items.DAILY_PLANNER_LEGAL_ADDRESS.state, 'problem');
  assert.match(stale.items.DAILY_PLANNER_LEGAL_ADDRESS.summary, /^The deployed site was built with another value than the one set now\. Retry the deployment/);
  assert.match(stale.items.DAILY_PLANNER_LEGAL_ADDRESS.fix.steps[0], /^Redeploy: .*Retry deployment/);
  const notBuilt = await check({ env: goodEnv({ DAILY_PLANNER_GITHUB_URL: 'https://github.com/example/planner' }) });
  assert.equal(notBuilt.items.DAILY_PLANNER_GITHUB_URL.state, 'problem');
  assert.match(notBuilt.items.DAILY_PLANNER_GITHUB_URL.summary, /^Set, but the deployed site was built without it/);

  const unreadable = await check({ env: goodEnv({ ASSETS: { fetch: async () => new Response('nope', { status: 500 }) } }) });
  assert.match(unreadable.result.notes.join(' '), /runtime-config\.js couldn’t be read \(HTTP 500\)/);
  assert.equal(unreadable.items.DAILY_PLANNER_API_URL.state, 'ok', 'judged from the settings instead');

  const wrong = await check({ env: goodEnv({ DAILY_PLANNER_API_URL: 'https://other.example/api', DAILY_PLANNER_SUPPORT_EMAIL: 'support at example', DAILY_PLANNER_LEGAL_PHONE: '+3301990012', DAILY_PLANNER_SPONSOR_URL: 'http://example.com/sponsor', DAILY_PLANNER_GOOGLE_CLIENT_ID: '123456789-abcdefghij.apps.googleusercontent.com', ASSETS: { fetch: async () => new Response('', { status: 404 }) } }) });
  assert.match(wrong.items.DAILY_PLANNER_API_URL.summary, /another site/);
  assert.match(wrong.items.DAILY_PLANNER_SUPPORT_EMAIL.summary, /^Set, but the legal pages leave it out: not a plain email address\.$/);
  assert.match(wrong.items.DAILY_PLANNER_LEGAL_PHONE.summary, /after \+33, the 9 digits of the number, without its leading 0/);
  assert.equal(wrong.items.DAILY_PLANNER_SPONSOR_URL.state, 'problem');
  assert.equal(wrong.items.DAILY_PLANNER_GOOGLE_CLIENT_ID.state, 'untested', 'Google has no read-only check');
});

test('the Dropbox app key (1.38): by its form only; never the App secret', async () => {
  const assets = { fetch: async () => new Response('', { status: 404 }) };
  const good = await check({ env: goodEnv({ DAILY_PLANNER_DROPBOX_APP_KEY: 'abcd1234efgh567', ASSETS: assets }) });
  assert.equal(good.items.DAILY_PLANNER_DROPBOX_APP_KEY.state, 'untested', 'Dropbox has no read-only check');
  assert.match(good.items.DAILY_PLANNER_DROPBOX_APP_KEY.summary, /Redirect URIs must list this site’s address with a final slash/);
  assert.match(good.items.DAILY_PLANNER_DROPBOX_APP_KEY.summary, /The App secret has the same form: make sure this is the App key, since the planner never uses the secret/, 'a soft warning: the two can’t be told apart');
  const bad = await check({ env: goodEnv({ DAILY_PLANNER_DROPBOX_APP_KEY: 'Ab9-Secret_Value', ASSETS: assets }) });
  assert.equal(bad.items.DAILY_PLANNER_DROPBOX_APP_KEY.state, 'problem');
  assert.match(bad.items.DAILY_PLANNER_DROPBOX_APP_KEY.summary, /the planner hides Dropbox\. Check it isn’t the App secret\./);
  const blank = await check({ env: goodEnv({ ASSETS: assets }) });
  assert.equal(blank.items.DAILY_PLANNER_DROPBOX_APP_KEY.state, 'optional-missing');
  const { CONFIG_VARIABLES } = await import('../server/config-inventory.js');
  const def = CONFIG_VARIABLES.find(item => item.name === 'DAILY_PLANNER_DROPBOX_APP_KEY');
  assert.match(def.source, /the App key, not the App secret: the planner never uses the secret/, 'the configuration page says it where the value comes from');
});

test('sign-in settings and addresses: by their shape', async () => {
  const { items } = await check({ env: goodEnv({ ADMIN_TOKEN: 'dev', ADMIN_TOTP_SECRET: 'not base32!', PUBLIC_BASE_URL: 'http://planner.example', ALLOWED_ORIGINS: 'https://ok.example, https://bad.example/' }) });
  assert.equal(items.ADMIN_TOKEN.state, 'problem');
  assert.equal(items.ADMIN_TOKEN.shape, '3 characters, weak', 'its length and a verdict, never what it is made of');
  assert.match(items.ADMIN_TOKEN.summary, /^Weak: easy to guess\./);
  assert.equal(describeShape(configVariable('ADMIN_TOKEN'), SECRETS.ADMIN_TOKEN), '48 characters, strong');
  assert.equal(describeShape(configVariable('ADMIN_TOKEN'), '1'.repeat(36)), '36 characters, weak', 'long but predictable');
  assert.equal(items.ADMIN_TOKEN.generate, 'token');
  assert.equal(items.ADMIN_TOTP_SECRET.state, 'problem');
  assert.equal(items.PUBLIC_BASE_URL.state, 'problem');
  assert.equal(items.ALLOWED_ORIGINS.state, 'problem');
  assert.match(items.ALLOWED_ORIGINS.summary, /^1 entry of 2 isn’t an origin/);
  assert.deepEqual(tokenStrength('Ab3'), { length: 3, bits: 17, kinds: 'letters and digits' });
  assert.equal(describeShape(configVariable('ADMIN_TOTP_SECRET'), 'JBSWY3DPEHPK3PXP'), 'base32, 16 characters (80 bits)');
});

test('two-factor sign-in off on the production site: a warning that says why; on a preview or this computer, a note (1.35)', async () => {
  const { result, items } = await check({ env: goodEnv({ ADMIN_TOTP_SECRET: '' }) });
  const totp = items.ADMIN_TOTP_SECRET;
  assert.deepEqual([totp.state, totp.warning], ['problem', true]);
  assert.match(totp.summary, /^Not set: on the production site, ADMIN_TOKEN alone opens the dashboard and this page, from anywhere/);
  assert.match(totp.summary, /Whoever learns it can read every question, sign-up and piece of feedback\./);
  assert.match(totp.fix.steps.join(' '), /Variable name: ADMIN_TOTP_SECRET/);
  assert.match(totp.fix.steps.join(' '), /authenticator app/);
  assert.equal(totp.generate, 'totp', 'a setup key can be generated on the page');
  assert.equal(result.counts.warning, 1, 'counted as a warning, a reminder that blocks nothing');
  for (const origin of ['https://abc123.daily-planner.pages.dev', 'http://localhost:8080']) {
    const elsewhere = (await check({ env: goodEnv({ ADMIN_TOTP_SECRET: '' }), origin })).items.ADMIN_TOTP_SECRET;
    assert.deepEqual([elsewhere.state, elsewhere.warning, elsewhere.summary], ['missing', undefined, 'Not set: the token alone opens the dashboard and this page.'], origin);
  }
  assert.equal(items.ADMIN_TOKEN.state, 'ok');
});

test('D1: the schema is one file, migrations/schema.sql, and the check lists what is missing with the SQL to run', async () => {
  assert.deepEqual(MIGRATIONS.map(migration => migration.file), ['schema.sql']);
  const { items } = await check({ env: goodEnv({ DB: fakeDb({ rows: migrationRows(['team_requests', 'csp_reports']) }) }) });
  const schema = items['migration:schema.sql'];
  assert.deepEqual([schema.name, schema.group, schema.level, schema.state], ['migrations/schema.sql', 'database', 'required', 'problem']);
  assert.equal(schema.summary, 'Not fully applied. Missing: tables team_requests and csp_reports; index team_requests_created.');
  assert.equal(schema.fix.copy.find(entry => entry.label === 'SQL of schema.sql').text, MIGRATIONS[0].sql);
  assert.equal(schema.fix.copy.at(-1).text, 'npx wrangler d1 execute daily-planner --remote --file=migrations/schema.sql');
  assert.match(schema.fix.steps[0], /Storage & Databases → D1 SQLite Database → daily-planner → Console/);
  // The SQL the page gives is the file's, comment aside: it only creates what is missing.
  assert.equal(MIGRATIONS[0].sql, read('migrations/schema.sql').replace(/^\/\*[\s\S]*?\*\/\n/, '').trim());
  assert.doesNotMatch(MIGRATIONS[0].sql, /\b(DROP|ALTER|DELETE|UPDATE|INSERT)\b/i);
});

test('D1: a missing column comes first, then the whole file', async () => {
  const missing = await check({ env: goodEnv({ DB: fakeDb({ rows: migrationRows(['reviews_created'], { dropColumn: ['waitlist', 'note'] }) }) }) });
  const schema = missing.items['migration:schema.sql'];
  assert.equal(schema.state, 'problem');
  assert.equal(schema.summary, 'Not fully applied. Missing: column waitlist.note; index reviews_created.');
  // In the order to run them: the column first (the file skips a table that exists), then the whole file.
  assert.deepEqual(schema.fix.copy.map(entry => entry.label), ['Missing column', 'SQL of schema.sql', 'Or from a terminal']);
  assert.equal(schema.fix.copy[0].text, 'ALTER TABLE waitlist ADD COLUMN note TEXT NOT NULL DEFAULT \'\';');
  assert.equal(schema.fix.copy[2].text, 'npx wrangler d1 execute daily-planner --remote --command="ALTER TABLE waitlist ADD COLUMN note TEXT NOT NULL DEFAULT \'\';"\nnpx wrangler d1 execute daily-planner --remote --file=migrations/schema.sql');
  assert.match(schema.fix.steps[1], /^First run the ALTER TABLE line below/);
  assert.match(schema.fix.steps[2], /^Then paste the SQL of migrations\/schema\.sql/);
  assert.equal(canAddColumn("note TEXT NOT NULL DEFAULT ''"), true);
  assert.equal(canAddColumn('id INTEGER PRIMARY KEY AUTOINCREMENT'), false);
  assert.deepEqual(tableColumns('CREATE TABLE x (\n  name TEXT,\n  "text" TEXT NOT NULL\n)'), ['name', 'text']);
});

test('D1: a database made before 1.39 is OK as it is: its other tables and columns are left alone', async () => {
  // Production went through the numbered migrations: the questions table has two more columns, and tables of the
  // sales stay in the database, unused. The check reads only what the schema needs.
  const rows = migrationRows().map(row => (row.name === 'team_requests' ? { ...row, sql: row.sql.replace('\n)', ",\n  plan TEXT NOT NULL DEFAULT '',\n  currency TEXT NOT NULL DEFAULT ''\n)") } : row));
  rows.push({ type: 'table', name: 'purchases', tableName: 'purchases', sql: 'CREATE TABLE purchases (id INTEGER PRIMARY KEY)' }, { type: 'index', name: 'purchases_kind', tableName: 'purchases', sql: '' });
  const { items } = await check({ env: goodEnv({ DB: fakeDb({ rows }) }) });
  assert.equal(items['migration:schema.sql'].state, 'ok');
  assert.match(items['migration:schema.sql'].summary, /^Applied: 8 tables and 4 indexes/);
});

test('D1: the database answers, or says why not', async () => {
  const failing = await check({ env: goodEnv({ DB: fakeDb({ fail: true }) }) });
  assert.equal(failing.items.DB.state, 'problem');
  assert.match(failing.items.DB.summary, /^The database answered with an error: D1_ERROR/);
  assert.equal(failing.items['migration:schema.sql'].state, 'untested');
  // No answer in time says nothing about the binding: not tested, and no “add the binding” fix.
  const slow = await check({ timeoutMs: 40, env: goodEnv({ DB: { prepare: () => ({ first: () => new Promise(() => {}), all: () => new Promise(() => {}) }) } }) });
  assert.equal(slow.items.DB.state, 'untested');
  assert.equal(slow.items.DB.summary, 'Not tested: the database didn’t answer within 1 second. Check again in a minute.');
  assert.equal(slow.items.DB.fix, null);

  const local = await check({ env: goodEnv({ DB: undefined }), origin: 'http://localhost:8080' });
  assert.equal(local.items.DB.state, 'untested', 'the dev server has no D1');
  assert.match(local.result.notes[0], /local server/);
  const unbound = await check({ env: goodEnv({ DB: undefined }) });
  assert.equal(unbound.items.DB.state, 'missing');
  assert.match(unbound.items.DB.fix.steps[0], /Settings → Bindings → Add → D1 database/);
});

test('no secret, nor any part of one, is ever in the answer — even when a service echoes it', async () => {
  const runs = [
    await check(),
    await check({ routes: { domains: json(400, { name: 'validation_error', message: `API key is invalid: ${SECRETS.RESEND_API_KEY}` }) } }),
    await check({ env: goodEnv({ DB: fakeDb({ fail: true }), ADMIN_TOKEN: `${SECRETS.ADMIN_TOKEN}` }), routes: { domains: json(403, { name: 'restricted_api_key', message: `not active ${SECRETS.RESEND_API_KEY}` }) } }),
    await check({ routes: { domains: json(422, { name: 'validation_error', message: `Invalid key ${SECRETS.RESEND_API_KEY.slice(0, 8)}****${SECRETS.RESEND_API_KEY.slice(-4)} (${SECRETS.ADMIN_TOTP_SECRET.slice(5, 15)})` }) } })
  ];
  for (const { result } of runs) {
    const text = JSON.stringify(result);
    for (const [name, value] of Object.entries(SECRETS)) {
      assert.ok(!text.includes(value), `${name} appears in the answer`);
      const secretPart = value.slice((PREFIXES[name] || '').length);
      for (let start = 0; start + 6 <= secretPart.length; start += 1) {
        const piece = secretPart.slice(start, start + 6);
        assert.ok(!text.includes(piece), `${name}: “${piece}” (6 characters of it) appears in the answer`);
      }
    }
  }
  const page = summaryText(runs[1].result);
  for (const value of [...Object.values(SECRETS), 'hello@example.com', 'owner@example.com', ORIGIN]) assert.ok(!page.includes(value), `the copied summary holds no value: ${value.slice(0, 12)}`);
});

test('the route: owner sign-in required, POST only, rate-limited, and wired into the API with the deployment’s environment', async () => {
  const { fetch } = services();
  const api = createPlannerApi({ store: createMemoryStore(), adminToken: SECRETS.ADMIN_TOKEN, authFailureDelayMs: 0, configEnv: goodEnv(), configFetch: fetch });
  const post = token => new Request(`${ORIGIN}/api/admin/config/check`, { method: 'POST', headers: token ? { authorization: `Bearer ${token}` } : {} });
  assert.equal((await api(post())).status, 401);
  assert.equal((await api(post('wrong'))).status, 401);
  assert.equal((await api(new Request(`${ORIGIN}/api/admin/config/check`, { headers: { authorization: `Bearer ${SECRETS.ADMIN_TOKEN}` } }))).status, 405);
  const response = await api(post(SECRETS.ADMIN_TOKEN));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const body = await response.json();
  assert.equal(body.items.length, CONFIG_VARIABLES.length + MIGRATIONS.length + CONFIG_CHECKS.length);
  assert.equal(body.deployment.origin, ORIGIN, 'the page’s own address');
  assert.ok(!JSON.stringify(body).includes(SECRETS.ADMIN_TOKEN));

  let time = 0;
  const route = createConfigCheckRoute(() => ({ env: {}, fetch }), { limiter: createRateLimiter({ limit: 2, windowMs: 60000, now: () => time }) });
  const request = new Request(`${ORIGIN}/api/admin/config/check`, { method: 'POST' });
  assert.equal((await route(request, 'admin/config/check')).status, 200);
  assert.equal((await route(request, 'admin/config/check')).status, 200);
  const limited = await route(request, 'admin/config/check');
  assert.equal(limited.status, 429);
  assert.equal(limited.headers['retry-after'], '60');
  assert.match(limited.body.error, /^Too many checks in a short time\. Check again in 1 minute\.$/);
  time = 60001;
  assert.equal((await route(request, 'admin/config/check')).status, 200, 'allowed again after the window');
  assert.equal(await route(request, 'admin/other'), null);
  // The health route answers for uptime checks, and nothing else: the former configuration route of 1.38 is gone.
  assert.deepEqual([(await api(new Request(`${ORIGIN}/api/health`))).status, await (await api(new Request(`${ORIGIN}/api/health`))).json()], [200, { ok: true }]);
  const gone = await api(new Request(`${ORIGIN}/api/health/config`));
  assert.deepEqual([gone.status, await gone.json()], [410, { error: 'GONE' }], 'gone for good, not a wrong method');
});

test('the deployed runtime-config.js is read as text, in the build’s form and the source’s', () => {
  assert.deepEqual(parseRuntimeConfig(builtConfig({ PLANNER_API_URL: '/api', SUPPORT_EMAIL: 'a "quoted" <b@example.com>' })), { PLANNER_API_URL: '/api', SUPPORT_EMAIL: 'a "quoted" <b@example.com>' });
  const source = parseRuntimeConfig(read('runtime-config.js'));
  assert.equal(source.PLANNER_API_URL, '');
  assert.equal(Object.keys(source).length, CONFIG_VARIABLES.filter(entry => entry.where === 'build').length);
  assert.equal(parseRuntimeConfig('alert(1)'), null);
});

test('the page: “Fix first” puts required settings first; the summary has the totals, the states and no value', async () => {
  const { result } = await check({ env: goodEnv({ ADMIN_TOKEN: 'dev', OWNER_EMAIL: '', EMAIL_DAILY_LIMIT: 'x' }) });
  const first = fixFirst(result.items).map(item => `${item.level}:${item.state}:${item.name}`);
  assert.deepEqual(first, ['required:problem:ADMIN_TOKEN', 'recommended:missing:OWNER_EMAIL', 'optional:problem:EMAIL_DAILY_LIMIT']);
  const text = summaryText(result);
  assert.match(text, /^Daily Planner — configuration check\nChecked \d{4}-\d{2}-\d{2} \d{2}:\d{2} UTC, on the production address/);
  assert.match(text, /\nFix first:\n1\. ADMIN_TOKEN \(required, secret\): Problem \[3 characters, weak\] — Weak: easy to guess/);
  assert.match(text, /\n3\. EMAIL_DAILY_LIMIT \(optional, Text\): Problem \[not a whole number\] — .* If left blank: Blank: 100 a day/);
  assert.match(text, /\nCloudflare Pages — build variables\n- DAILY_PLANNER_API_URL \(required, Text\): OK/);
  assert.match(text, /- RESEND_API_KEY \(recommended, secret\): OK \[looks like a Resend API key \(re_…\), 35 characters\]/);
  assert.match(text, /No value of any setting is included/);
  assert.ok(!text.includes('CREATE TABLE'), 'the copy lines of the fixes are left out');
  assert.equal(totalsText({ ok: 1, problem: 2, untested: 0 }), '1 OK, 2 problems');
  assert.match(summaryText({ ...result, durationMs: 40 }), /, in under 0\.1 s\.\n/, 'never “in 0.0 s”');
  assert.match(summaryText({ ...result, durationMs: 1430 }), /, in 1\.4 s\.\n/);
});

test('the page generates values in the browser: letters and digits, and base32', () => {
  const tokens = new Set(Array.from({ length: 20 }, () => newAdminToken()));
  assert.equal(tokens.size, 20);
  for (const token of tokens) assert.match(token, /^[A-Za-z0-9]{48}$/);
  const totp = newTotpSecret();
  assert.match(totp, /^[A-Z2-7]{32}$/);
  assert.equal(describeShape(configVariable('ADMIN_TOTP_SECRET'), totp), 'base32, 32 characters (160 bits)');
  assert.equal(otpauthUri('ABC'), 'otpauth://totp/Daily%20Planner:owner?secret=ABC&issuer=Daily%20Planner&digits=6&period=30');
  // No modulo bias: with bytes always 255, a 62-letter alphabet skips them rather than favouring a letter.
  let calls = 0;
  const skewed = { getRandomValues: array => { calls += 1; array.fill(calls === 1 ? 255 : 1); return array; } };
  assert.equal(newAdminToken(skewed), 'B'.repeat(48));
  const generated = CONFIG_VARIABLES.filter(entry => entry.generate).map(entry => `${entry.name}:${entry.generate}`);
  assert.deepEqual(generated, ['ADMIN_TOKEN:token', 'ADMIN_TOTP_SECRET:totp'], 'the only values the page makes');
});

test('the page keeps nothing: no storage but the dashboard’s session, and no assistant to load', () => {
  const script = read('admin/configuration/configuration.js');
  const model = read('admin/configuration/config-model.js');
  const code = source => source.replace(/^\s*\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  for (const source of [script, model]) {
    assert.doesNotMatch(source, /indexedDB/);
    assert.doesNotMatch(code(source), /localStorage/, 'nothing is ticked or kept in the browser');
    assert.doesNotMatch(source.replace(/sessionStorage\.(?:getItem|setItem|removeItem)\(SESSION_KEY/g, ''), /sessionStorage\./, 'only the signed session, as the dashboard keeps it');
  }
  assert.match(script, /const SESSION_KEY = 'daily-planner-owner-session';/, 'the dashboard’s own session');
  assert.match(read('admin/admin.js'), /const SESSION_KEY = 'daily-planner-owner-session';/);
  assert.doesNotMatch(script, /await import\(/, 'nothing loaded on demand');
  assert.match(script, /crypto|newAdminToken/);
  const html = read('admin/configuration/index.html');
  for (const hook of ['data-cfg-check', 'data-cfg-copy', 'data-cfg-test-email', 'data-cfg-first', 'data-cfg-groups', 'data-cfg-login']) assert.ok(html.includes(hook), hook);
  assert.match(html, /<link rel="stylesheet" href="\.\.\/\.\.\/styles\.css">/);
  assert.match(html, /<meta name="robots" content="noindex,nofollow">/);
  // Reached from the dashboard: its header and its Setup card.
  const admin = read('admin/index.html');
  assert.equal((admin.match(/href="\.\/configuration\/"/g) || []).length, 2);
});

test('the setup guides create the database from migrations/schema.sql, and name no numbered migration', () => {
  for (const doc of ['docs/configuration.md', 'docs/FEEDBACK_AND_WAITLIST.md', 'README.md']) {
    const words = read(doc);
    assert.match(words, /migrations\/schema\.sql/, doc);
    assert.match(words, /npx wrangler d1 execute [^\n]*--remote --file=migrations\/schema\.sql/, doc);
    assert.doesNotMatch(words, /\b00(?:0[1-9]|10)_[a-z_]+\.sql|0001…/, `${doc}: no numbered migration`);
  }
  assert.match(read('docs/configuration.md'), /never dropped or altered/, 'production keeps its tables');
});

test('Security headers (1.35): OK when nothing was blocked in 7 days, a warning that lists it otherwise', async () => {
  assert.deepEqual([(await check()).items['csp-reports'].state, (await check()).items['csp-reports'].summary], ['ok', 'Nothing was blocked in the last 7 days.']);
  const rows = [
    { directive: 'script-src-elem', blocked: 'https://ajax.cloudflare.com', page: '/welcome/', count: 12, lastDay: '2026-10-27' },
    { directive: 'script-src-elem', blocked: 'inline', page: '/', count: 1, lastDay: '2026-10-26' }
  ];
  const { items, result } = await check({ cspReports: async () => rows });
  const item = items['csp-reports'];
  assert.deepEqual([item.state, item.warning, item.group, item.level], ['problem', true, 'security', 'recommended']);
  assert.equal(item.summary, 'Browsers blocked something 13 times in the last 7 days: script-src-elem: https://ajax.cloudflare.com on /welcome/ (12 times); script-src-elem: inline on / (once).');
  assert.match(item.fix.steps[0], /Rocket Loader, Bot Fight Mode or JavaScript detections/);
  assert.equal(result.counts.warning, 1, 'a reminder, not a blocker');
  // Before the schema is applied, or without a store: not checked, and said why.
  const missing = (await check({ cspReports: async () => { throw new Error('D1_ERROR: no such table: csp_reports'); } })).items['csp-reports'];
  assert.deepEqual([missing.state, missing.summary], ['untested', 'Not counted yet: apply migrations/schema.sql, then browsers’ reports are counted here.']);
  assert.equal((await check({ cspReports: null })).items['csp-reports'].state, 'untested');
});
