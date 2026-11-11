import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createMemoryStore, createPlannerApi, validateContact } from '../server/planner-api.js';
import { questionPayload } from '../welcome/contact-model.js';

/*
 * No box to tick on the Contact page's question form (as since 1.32). For a
 * form people send to be answered, an information notice is what is owed,
 * not consent. Under the form, one short notice says what is kept, why, for
 * how long and that it is deleted on request, and links the privacy policy's
 * section on questions. The server never asks for `consent` (and ignores it
 * from an old cached page); the privacy policy and the landing page's privacy
 * dialog name the basis: answering what was asked.
 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = file => readFile(join(root, file), 'utf8');
const text = html => html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

const NOTICE = 'What you send is kept only to reply to you and follow up, and deleted whenever you ask.';
const LINK = '<a href="../legal/privacy/#requests">How questions are handled</a>';
const formOf = page => /<form class="ask-form ct-form"[\s\S]*?<\/form>/.exec(page)?.[0] || '';

test('the question form has no box to tick, in any mode', async () => {
  const page = await read('contact/index.html');
  const form = formOf(page);
  assert.ok(form);
  assert.doesNotMatch(form, /consent|type="checkbox"|I agree/i, 'no box, no label, no error line for it');
  assert.doesNotMatch(page, /data-consent|err-consent/);
  assert.doesNotMatch(await read('welcome/contact-form.js'), /consent/i, 'nothing to tick, read or check');
  assert.doesNotMatch(await read('welcome/contact-model.js'), /consent:|\.consent|CONSENT/, 'nothing to send about a box');
});

test('under the form, one information notice: what is kept, why, for how long, deleted on request, and the policy’s section on questions', async () => {
  const form = formOf(await read('contact/index.html'));
  const notices = [...form.matchAll(/<p class="form-privacy" data-privacy-line hidden>([\s\S]*?)<\/p>/g)].map(match => match[1]);
  assert.equal(notices.length, 1, 'one notice');
  assert.equal(notices[0], `${NOTICE} ${LINK}`);
  // It reads on its own: no reference to a box, an agreement or a label above it.
  assert.doesNotMatch(text(notices[0]), /box|tick|agree|consent|above/i);
  // Shown when the form goes to the API (as an email, the visitor sends it themselves, and the mailto line says so).
  const script = await read('welcome/contact-form.js');
  assert.match(script, /if \(privacyLine\) privacyLine\.hidden = mode !== 'api';/);
  assert.match(script, /if \(mailtoLine\) mailtoLine\.hidden = mode !== 'mailto';/);
  assert.match(await read('legal/privacy/index.html'), /<section id="requests" aria-labelledby="requests-title">/);
  // The link keeps to one line.
  assert.match(await read('contact/contact.css'), /\.ct-form \.form-privacy a \{ color: var\(--ink\); white-space: nowrap; \}/);
});

test('a question never carries `consent`', () => {
  const values = { email: 'ann@example.com', name: 'Ann', message: 'Hello?', website: '' };
  assert.equal('consent' in questionPayload(values), false);
  assert.equal('consent' in questionPayload({ ...values, consent: true }), false, 'even if something set it');
});

test('the server takes a question without `consent`, ignores it from an old cached page, and never stores it', async () => {
  const now = new Date('2026-11-10T09:00:00Z');
  const body = { email: 'ann@example.com', name: 'Ann', message: 'Hello?', source: 'contact', kind: 'question' };
  const { entry, error } = validateContact(body, now);
  assert.equal(error, undefined);
  assert.equal('consent' in entry, false, 'never stored');
  for (const consent of [true, false, 'on', 1]) assert.deepEqual(validateContact({ ...body, consent }, now).entry, entry, `consent ${String(consent)} is ignored`);
  assert.equal(validateContact({ ...body, website: 'bot' }, now).spam, true, 'a bot is still dropped quietly');

  // Through the routes: the Contact page's, and the older address of the same form; listed for the owner, without a consent field.
  const api = createPlannerApi({ store: createMemoryStore(), adminToken: 'secret', now: () => now });
  const post = (route, payload) => new Request(`https://planner.test/api/${route}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
  assert.equal((await api(post('contact', body))).status, 201);
  assert.equal((await api(post('contact', { ...body, email: 'old@example.com', consent: true }))).status, 201, 'an old cached page');
  assert.equal((await api(post('teams', { ...body, email: 'older@example.com' }))).status, 201, 'the form’s older address, for one release');
  const { rows } = await (await api(new Request('https://planner.test/api/admin/questions', { headers: { authorization: 'Bearer secret' } }))).json();
  assert.equal(rows.length, 3);
  for (const row of rows) assert.equal('consent' in row, false, row.email);
});

test('no checkbox style is left for the form', async () => {
  const css = await read('welcome/landing.css');
  assert.doesNotMatch(css, /\.consent\b|field__err--consent/);
  assert.doesNotMatch(await read('contact/contact.css'), /consent/);
  assert.match(css, /\.ask-form__fine \{ display: grid; align-content: center; justify-items: start; gap: 8px; min-width: 0; \}/);
  assert.match(css, /\.form-privacy \{ max-width: 54em; color: var\(--band-muted\); font-size: \.88rem; line-height: 1\.5; text-wrap: balance; \}/);
  // The notice's link never breaks in two.
  assert.match(css, /\.form-privacy a \{ color: var\(--band-ink\); text-underline-offset: 3px; white-space: nowrap; \}/);
});

test('the privacy policy: questions are answered on the basis of what was asked, with no box, and deleted on request', async () => {
  const page = await read('legal/privacy/index.html');
  const requests = /<section id="requests"[\s\S]*?<\/section>/.exec(page)[0];
  assert.match(requests, /<h2 id="requests-title">Questions<\/h2>/);
  assert.ok(text(requests).includes('We use it only to answer you, never to send you anything else, so there is no box to tick. We receive an email notification with your question, and keep it to reply and follow up. Ask, and we delete it.'));
  assert.doesNotMatch(page, /you tick a box|box you tick|withdraw your agreement/);
  const row = /<tr><th scope="row">Questions<\/th>[\s\S]*?<\/tr>/.exec(page)[0];
  assert.match(row, /<td data-label="Why we may use it">Our legitimate interest in answering what you asked\.<\/td>/);
  assert.match(row, /<td data-label="How long">Kept to reply and follow up; deleted on request\.<\/td>/);
  assert.match(page, /<li>stop using it where you gave your consent \(the waitlist, a quoted review\), at any time\.<\/li>/);
  assert.doesNotMatch(page, /partner|Team requests/i, 'no partner links and no team requests any more');
});

test('the landing page’s privacy dialog says the same about questions', async () => {
  const part = /<section class="pv__sec" data-privacy-section="requests"[\s\S]*?<\/section>/.exec(await read('welcome/index.html'))[0];
  assert.match(part, /<p>A question asked on the Contact page sends only your email, your name and your question\./);
  assert.ok(text(part).includes('It’s stored only to reply to you and follow up, with your browser’s language, the page version and where the form was opened, and deleted whenever you ask.'));
  assert.doesNotMatch(part, /tick|agree|Teams|partner|data-privacy-sales|data-privacy-paused/);
});
