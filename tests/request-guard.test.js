import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// The pages' client module reads the runtime config once, when src/config.js loads (the server imports it too):
// the API is switched on for it before anything is imported.
globalThis.__DAILY_PLANNER_CONFIG__ = { PLANNER_API_URL: '/api' };
const { createMemoryStore, createPlannerApi } = await import('../server/planner-api.js');

/* Cross-site requests (1.35): every public request that changes
   something must be JSON (a cross-site form or text/plain post needs no CORS
   preflight) and must not come from another site's page (Origin). Every
   answer says nosniff. */

const SITE = 'https://planner.example';

function setup(options = {}) {
  const store = createMemoryStore();
  const api = createPlannerApi({
    store, adminToken: 'guard-owner-token', authFailureDelayMs: 0, publicBaseUrl: SITE, allowedOrigins: 'https://friend-site.example',
    warn: () => {}, ...options
  });
  return { api, store };
}

// Every public route that changes something, with a body it accepts.
const ROUTES = [
  ['POST', 'events', { name: 'landing_viewed', version: '1.35.0' }],
  ['POST', 'waitlist', { email: 'someone@example.com', consent: true }],
  ['POST', 'waitlist/remove', { email: 'someone@example.com', token: '0'.repeat(64) }],
  ['POST', 'feedback', { version: '1.35.0', rating: 5, message: 'Calm' }],
  ['POST', 'contact', { email: 'ann@example.com', message: 'A question' }],
  ['POST', 'teams', { kind: 'question', email: 'ann@example.com', message: 'A question' }],
  ['POST', 'admin/session', { token: 'wrong' }]
];
const send = (api, method, path, body, headers = {}, host = SITE) => api(new Request(`${host}/api/${path}`, { method, headers, body: JSON.stringify(body) }));

test('a cross-site form or a text/plain post is refused with 415 on every public route that changes something, and nothing is stored', async () => {
  const { api, store } = setup();
  for (const [method, path, body] of ROUTES) {
    for (const type of [undefined, 'text/plain;charset=UTF-8', 'application/x-www-form-urlencoded', 'multipart/form-data; boundary=x', 'application/jsonp', 'text/json']) {
      const answer = await send(api, method, path, body, type ? { 'content-type': type, origin: 'https://evil.example' } : {});
      assert.equal(answer.status, 415, `${method} ${path} as ${type}`);
      assert.deepEqual(await answer.json(), { error: 'Send this request as JSON.' });
    }
  }
  for (const table of ['events', 'waitlist', 'feedback', 'questions']) assert.deepEqual(store.data[table], [], table);
});

test('JSON from another site’s page is refused with 403; from this site, a preview, an allowed origin, a local page or a script, it goes through', async () => {
  const { api, store } = setup();
  const json = { 'content-type': 'application/json; charset=utf-8' };
  for (const [method, path, body] of ROUTES) {
    for (const origin of ['https://evil.example', 'null', 'https://planner.example.evil.example', 'http://planner.example', 'https://planner.example:8443', 'http://localhost:8080']) {
      const answer = await send(api, method, path, body, { ...json, origin });
      assert.equal(answer.status, 403, `${method} ${path} from ${origin}`);
      assert.equal(answer.headers.get('access-control-allow-origin'), null);
    }
  }
  assert.deepEqual([store.data.questions, store.data.waitlist, store.data.feedback], [[], [], []]);
  const passes = async (headers, host = SITE) => (await send(api, 'POST', 'feedback', { version: '1.35.0', rating: 4, message: 'Fine' }, headers, host)).status;
  assert.equal(await passes({ ...json, origin: SITE }), 201, 'PUBLIC_BASE_URL');
  assert.equal(await passes({ ...json, origin: 'https://abc123.daily-planner.pages.dev' }, 'https://abc123.daily-planner.pages.dev'), 201, 'the address it was sent to (a preview)');
  assert.equal(await passes({ ...json, origin: 'https://friend-site.example' }), 201, 'ALLOWED_ORIGINS');
  assert.equal(await passes({ ...json, origin: 'http://localhost:8080' }, 'http://127.0.0.1:8482'), 201, 'a local page on a local server');
  assert.equal(await passes(json), 201, 'no Origin: a script, or a browser that sends none');
  assert.equal(store.data.feedback.length, 5);
});

test('reads are never refused, and the owner’s routes keep their Bearer', async () => {
  const { api } = setup();
  const read = await api(new Request(`${SITE}/api/health`, { headers: { origin: 'https://evil.example' } }));
  assert.equal(read.status, 200, 'GET: nothing changes');
  assert.equal(read.headers.get('access-control-allow-origin'), null, 'and no CORS for another site');
  // The routes of the sales are gone (1.39): whatever their body or origin, they answer 410 Gone and do nothing.
  for (const path of ['checkout', 'purchases/claim', 'plus/check', 'gifts/ABCD-EFGH-JKMN/redeem', 'partners/statement', 'partners/visit', 'creem/webhook']) {
    for (const headers of [{ 'content-type': 'application/json' }, { 'content-type': 'text/plain', origin: 'https://evil.example' }]) {
      const response = await send(api, 'POST', path, {}, headers);
      assert.deepEqual([response.status, await response.json()], [410, { error: 'GONE' }], path);
    }
  }
  // The dashboard deletes and checks without a body: a Bearer header, which no cross-site form can send.
  const owner = { authorization: 'Bearer guard-owner-token' };
  assert.equal((await api(new Request(`${SITE}/api/admin/reviews/1`, { method: 'DELETE', headers: owner }))).status, 404);
  assert.equal((await api(new Request(`${SITE}/api/admin/reviews/1`, { method: 'DELETE', headers: { ...owner, origin: 'https://evil.example' } }))).status, 403, 'never from another site');
  assert.equal((await api(new Request(`${SITE}/api/admin/reviews/1`, { method: 'DELETE', headers: { ...owner, origin: SITE } }))).status, 404);
});

test('every answer of the API says nosniff: JSON, empty, CSV, refusals, preflights and errors', async () => {
  const { api } = setup();
  const answers = [
    await api(new Request(`${SITE}/api/health`)),
    await api(new Request(`${SITE}/api/events`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'landing_viewed', version: '1.35.0' }) })),
    await api(new Request(`${SITE}/api/admin/feedback?format=csv`, { headers: { authorization: 'Bearer guard-owner-token' } })),
    await api(new Request(`${SITE}/api/contact`, { method: 'POST', body: '{}' })),
    await api(new Request(`${SITE}/api/contact`, { method: 'OPTIONS', headers: { origin: 'https://friend-site.example' } })),
    await api(new Request(`${SITE}/api/nowhere`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })),
    await api(new Request(`${SITE}/api/feedback`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{nope' })),
    await api(new Request(`${SITE}/api/admin/summary`))
  ];
  assert.deepEqual(answers.map(answer => answer.status), [200, 204, 200, 415, 204, 404, 400, 401]);
  for (const answer of answers) assert.equal(answer.headers.get('x-content-type-options'), 'nosniff', String(answer.status));
});

test('the planner, the landing and Contact pages send JSON: their requests pass the guard, end to end', async () => {
  // The client module the pages share, with the API on and its fetch piped into the real router.
  const { api, store } = setup();
  const sent = [];
  const stored = new Map();
  Object.defineProperty(globalThis, 'localStorage', { value: { getItem: key => (stored.has(key) ? stored.get(key) : null), setItem: (key, value) => stored.set(key, String(value)), removeItem: key => stored.delete(key) }, configurable: true, writable: true });
  if (!globalThis.window) Object.defineProperty(globalThis, 'window', { value: globalThis, configurable: true, writable: true });
  globalThis.fetch = async (url, init = {}) => {
    const request = new Request(new URL(url, SITE), { ...init, headers: { ...(init.headers || {}), origin: SITE } });
    const response = await api(request);
    sent.push({ path: new URL(url, SITE).pathname, method: init.method || 'GET', type: new Headers(init.headers || {}).get('content-type'), status: response.status });
    return response;
  };
  const client = await import('../src/lib/planner-api.js');
  client.trackEvent('landing_viewed');
  await client.joinWaitlist({ email: 'joiner@example.com', consent: true });
  await client.sendFeedback({ rating: 5, message: 'Lovely' });
  await client.leaveWaitlist({ email: 'joiner@example.com', token: '0'.repeat(64) });
  await new Promise(resolve => { setTimeout(resolve, 20); });
  const changing = sent.filter(entry => entry.method !== 'GET');
  assert.ok(changing.length >= 4, JSON.stringify(sent));
  for (const entry of changing) {
    assert.match(String(entry.type), /^application\/json/, `${entry.method} ${entry.path} says JSON`);
    assert.ok(![403, 415].includes(entry.status), `${entry.method} ${entry.path}: ${entry.status}`);
  }
  assert.deepEqual([store.data.waitlist.length, store.data.feedback.length, store.data.events.length], [1, 1, 1], 'each one was taken in');
  // The pages' own requests (the contact form, the owner's sign-in) set the same header.
  const source = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
  assert.match(source('welcome/contact-form.js'), /fetch\(`\$\{PLANNER_API_URL\}\/\$\{CONTACT_ROUTE\}`, \{\s*method: 'POST',\s*headers: \{ 'content-type': 'application\/json' \}/);
  assert.match(source('welcome/contact-model.js'), /export const CONTACT_ROUTE = 'contact';/);
  assert.match(source('admin/admin.js'), /call\('admin\/session', \{ auth: false, method: 'POST', headers: \{ 'content-type': 'application\/json' \}/);
  assert.match(source('admin/configuration/configuration.js'), /call\('admin\/session', \{ method: 'POST', headers: \{ 'content-type': 'application\/json' \}/);
});
