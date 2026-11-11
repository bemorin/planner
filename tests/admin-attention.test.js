import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createPlannerApi, createMemoryStore } from '../server/planner-api.js';
import {
  ATTENTION_SECTIONS, attentionBySection, attentionNote, attentionWhen, buildAttention, NEW_REVIEW_DAYS, QUESTION_REPLY_DAYS, setupChecks, timeAgo
} from '../admin/attention.js';

const NOW = Date.parse('2026-10-20T12:00:00Z');
const MINUTE = 60000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const ago = ms => new Date(NOW - ms).toISOString();
const later = ms => new Date(NOW + ms).toISOString();
const CONFIG = { SUPPORT_EMAIL: 'hello@example.com', LEGAL_ADDRESS: '1 rue de la Paix, Paris' };

/** A deployment with nothing to do; each test adds its own trouble. */
function calm(extra = {}) {
  return {
    version: '1.39.0',
    generatedAt: new Date(NOW).toISOString(),
    setup: { email: { configured: true, ownerEmail: 'owner@example.com' }, twoFactor: true },
    questions: [], reviews: [],
    ...extra
  };
}
const build = (summary, options = {}) => buildAttention(summary, { now: NOW, config: CONFIG, pageVersion: '1.39.0', ...options });
const texts = items => items.map(item => item.text);

test('relative times read as plain English', () => {
  assert.equal(timeAgo(ago(20 * 1000), NOW), 'just now');
  assert.equal(timeAgo(ago(5 * MINUTE), NOW), '5 min ago');
  assert.equal(timeAgo(ago(2 * HOUR + 10 * MINUTE), NOW), '2 h ago');
  assert.equal(timeAgo(ago(DAY + HOUR), NOW), '1 day ago');
  assert.equal(timeAgo(ago(3 * DAY), NOW), '3 days ago');
  assert.equal(timeAgo(ago(15 * DAY), NOW), '2 weeks ago');
  assert.equal(timeAgo(ago(75 * DAY), NOW), '2 months ago');
  assert.equal(timeAgo(ago(400 * DAY), NOW), '1 year ago');
  assert.equal(timeAgo(later(HOUR), NOW), 'just now', 'a clock a little ahead never says “in the future”');
  assert.equal(timeAgo('', NOW), '');
  assert.equal(timeAgo('not a date', NOW), '');
});

test('each line says when it started; Setup has no date', () => {
  assert.equal(attentionWhen({ when: 'since', at: ago(3 * DAY) }, NOW), '3 days ago');
  assert.equal(attentionWhen({ when: 'setup', at: '' }, NOW), 'this deployment');
});

test('a calm deployment has nothing to list', () => {
  assert.deepEqual(build(calm()), []);
  assert.deepEqual(buildAttention(null), []);
  assert.equal(attentionNote([]), '');
  assert.deepEqual(attentionBySection([]), { sections: {}, rows: new Map() });
});

test('questions from the last 14 days wait for a reply, oldest first: who asked and the start of the question', () => {
  const long = `Can I ${'really '.repeat(20)}move my plans?`;
  const items = build(calm({
    questions: [
      { id: 5, kind: 'question', name: 'Ann', email: 'ann@example.com', message: 'Can I move\nmy plans?', createdAt: ago(HOUR) },
      { id: 4, kind: 'question', name: '', email: 'bo@example.com', message: long, createdAt: ago(2 * HOUR) },
      { id: 1, kind: 'question', name: 'Old', email: 'old@example.com', message: 'Hello', createdAt: ago((QUESTION_REPLY_DAYS + 1) * DAY) }
    ]
  }));
  assert.deepEqual(texts(items), ['Question from bo@example.com waiting for a reply', 'Question from Ann waiting for a reply']);
  assert.equal(items[1].detail, '“Can I move my plans?”');
  assert.ok(items[0].detail.length <= 82 && items[0].detail.endsWith('…”'), items[0].detail);
  assert.deepEqual(items.map(item => item.rows[0]), ['question:4', 'question:5']);
  assert.ok(items.every(item => item.section === 'questions' && item.tone === 'warn' && item.when === 'since' && item.icon === 'question'));
  assert.equal(attentionNote(items), `Replies aren’t recorded here, so questions stay listed for ${QUESTION_REPLY_DAYS} days.`);
  // A row from the releases that took team orders reads as a question too, never as “a team” or “0 people”.
  const earlier = build(calm({ questions: [{ id: 9, kind: 'invoice', company: 'Acme', teamSize: 25, name: 'Lea', email: 'lea@example.com', message: '', createdAt: ago(HOUR) }] }));
  assert.deepEqual(texts(earlier), ['Question from Lea waiting for a reply']);
  assert.equal(earlier[0].detail, '');
  assert.deepEqual(build(calm({ questionsUnavailable: true, questions: [{ id: 9, email: 'x@example.com', createdAt: ago(HOUR) }] })).map(item => item.text), ['Database: apply migrations/schema.sql (questions can’t be read)']);
});

test('Setup: legal pages, two-factor and a stale page each get a line, in the card’s order', () => {
  const summary = calm({ version: '1.40.0' });
  summary.setup.twoFactor = false;
  const items = build(summary, { config: { SUPPORT_EMAIL: 'hello@example.com' } });
  assert.deepEqual(texts(items), [
    'This dashboard is 1.39.0, 1.40.0 is deployed: reload it',
    'Legal pages: postal address missing',
    'Two-factor sign-in is off'
  ]);
  assert.ok(items.every(item => item.tone === 'warn' && item.section === 'setup' && item.when === 'setup'));
  assert.deepEqual(items.map(item => item.rows[0]), ['setup:version', 'setup:legal', 'setup:sign-in']);
  assert.equal(items[0].icon, 'version');
  assert.deepEqual(texts(build(calm(), { config: {} })), ['Legal pages: contact address and postal address missing']);
  assert.deepEqual(texts(build(calm({ version: '1.38.1' }))), ['This dashboard is 1.39.0, the deployed one is 1.38.1: reload it']);
});

test('Setup: a legal value the pages can’t use is not ready, with the same checks as legal/legal-details.js', () => {
  const legal = config => Object.fromEntries(setupChecks(calm(), { config: { ...CONFIG, ...config }, pageVersion: '1.39.0' }).map(check => [check.key, check])).legal;
  assert.equal(legal({ PRIVACY_EMAIL: 'privacy@example.com', LEGAL_PHONE: '+33 1 99 00 12 34', LEGAL_REGISTRATION: 'SIRET 1' }).state, 'ok');
  assert.equal(legal({ LEGAL_PHONE: '' }).state, 'ok', 'no phone number: recommended, not required');
  const bad = legal({ SUPPORT_EMAIL: 'ben at example dot com', PRIVACY_EMAIL: 'privacy@example', LEGAL_PHONE: '+33 1 99 00 12 34 (office)' });
  assert.equal(bad.state, 'warn');
  assert.deepEqual(bad.problems, [
    'Legal pages: DAILY_PLANNER_SUPPORT_EMAIL is set, but not used (not a plain email address)',
    'Legal pages: DAILY_PLANNER_PRIVACY_EMAIL is set, but not used (not a plain email address)',
    'Legal pages: DAILY_PLANNER_LEGAL_PHONE is set, but not used (not a phone number)'
  ]);
  assert.equal(legal({ LEGAL_PHONE: '+33199001234' }).state, 'ok', 'the phone as the owner types it: E.164');
  assert.deepEqual(legal({ LEGAL_PHONE: '+330199001234' }).problems, [
    'Legal pages: DAILY_PLANNER_LEGAL_PHONE is set, but not used (not a phone number: after +33, the 9 digits of the number, without its leading 0)'
  ], 'a French number with its 0 says what to change');
  assert.deepEqual(legal({ SUPPORT_EMAIL: 'me@example.com?bcc=x@example.com', LEGAL_ADDRESS: '  ' }).problems, [
    'Legal pages: postal address missing',
    'Legal pages: DAILY_PLANNER_SUPPORT_EMAIL is set, but not used (not a plain email address)'
  ], 'an unusable address is said once, not also as missing');
});

test('the Setup card says “set, but not used” with the legal pages’ own checks, and calls the phone number recommended', () => {
  const source = readFileSync(new URL('../admin/admin.js', import.meta.url), 'utf8');
  assert.match(source, /import \{ legalDetails, legalEmail, legalValueProblem \} from '\.\.\/legal\/legal-details\.js';/);
  assert.match(source, /`set, but not used: \$\{problem\}`/);
  const variables = /const LEGAL_VARIABLES = \[([\s\S]*?)\n\];/.exec(source)?.[1] || '';
  assert.match(variables, /\['LEGAL_PHONE', 'recommended \(French law asks an individual publisher for one\)/);
  assert.doesNotMatch(variables, /\['LEGAL_PHONE', 'optional/);
  // How to write the phone number (E.164, no spaces), and how the page shows it.
  assert.match(variables, /\['LEGAL_PHONE', '[^']*international form, <code>\+33<\/code> then the number without its 0, with no spaces \(e\.g\. <code>\+33199001234<\/code>\)[^']*<code>\+33 1 99 00 12 34<\/code>/);
  assert.match(source, /if \(key === 'LEGAL_PHONE'\) return `set, shown as \$\{esc\(legalDetails\(APP_CONFIG\)\.phone\)\}`;/, 'Setup shows how the number reads');
  assert.match(variables, /\['SUPPORT_EMAIL', '[^']*on the Contact page \(“Prefer email\? Write to …”\)/);
  assert.doesNotMatch(variables, /Support” line|Support line/, 'no footer shows it any more (1.32)');
});

test('Setup: missing pieces are urgent and come before every to-do', () => {
  const summary = calm({ questionsUnavailable: true, reviewsUnavailable: true });
  summary.setup.email = { configured: false, ownerEmail: '' };
  const items = build(summary);
  assert.deepEqual(texts(items), [
    'Email isn’t set up: nothing can be sent',
    'Owner email isn’t set: no question notifications',
    'Database: apply migrations/schema.sql (questions and reviews can’t be read)'
  ]);
  assert.deepEqual(items.map(item => item.tone), ['urgent', 'urgent', 'urgent']);
  const withQuestion = build(calm({ questions: [{ id: 1, name: 'Ann', email: 'ann@example.com', message: 'Hi', createdAt: ago(HOUR) }], setup: { email: { configured: false }, twoFactor: false } }));
  assert.deepEqual(withQuestion.map(item => [item.kind, item.tone]), [
    ['setup-missing', 'urgent'], ['setup-missing', 'urgent'], ['question', 'warn'], ['setup-warn', 'warn']
  ]);
});

test('setupChecks gives the Setup card its states, and nothing about sales', () => {
  const checks = Object.fromEntries(setupChecks(calm(), { config: CONFIG, pageVersion: '1.39.0' }).map(check => [check.key, check]));
  assert.deepEqual(Object.keys(checks), ['version', 'email', 'owner-email', 'links', 'legal', 'database', 'sign-in']);
  assert.ok(Object.values(checks).every(check => check.state === 'ok' && !check.problems.length));
  assert.equal(setupChecks(calm({ version: '' }), { config: CONFIG, pageVersion: '1.39.0' })[0].state, 'warn', 'an API that reports no version');
  assert.deepEqual(setupChecks({ version: '1.39.0' }), [], 'an API that does not report its setup');
});

test('new reviews are one line, from the oldest, pointing at every new review', () => {
  const items = build(calm({
    reviews: [
      { id: 7, name: 'Marie', rating: 5, createdAt: ago(HOUR) },
      { id: 6, name: '', rating: 4, createdAt: ago(5 * DAY) },
      { id: 2, name: 'Old', rating: 5, createdAt: ago((NEW_REVIEW_DAYS + 1) * DAY) }
    ]
  }));
  assert.equal(items.length, 1);
  assert.equal(items[0].text, '2 new reviews to read');
  assert.deepEqual(items[0].rows, ['review:7', 'review:6']);
  assert.equal(attentionWhen(items[0], NOW), '5 days ago');
  assert.equal(build(calm({ reviews: [{ id: 7, name: 'Marie', createdAt: ago(HOUR) }] }))[0].text, 'New review from Marie to read');
  assert.equal(build(calm({ reviews: [{ id: 7, name: ' ', createdAt: ago(HOUR) }] }))[0].text, 'New review to read');
  assert.deepEqual(build(calm({ reviewsUnavailable: true, reviews: [{ id: 7, createdAt: ago(HOUR) }] })).filter(item => item.section === 'reviews'), []);
});

test('cards count their rows and take their most urgent tone', () => {
  const summary = calm({
    questions: [{ id: 1, name: 'A', email: 'a@example.com', createdAt: ago(HOUR) }, { id: 2, name: 'B', email: 'b@example.com', createdAt: ago(2 * HOUR) }],
    reviews: [{ id: 1, name: 'A', createdAt: ago(HOUR) }, { id: 2, name: 'B', createdAt: ago(2 * HOUR) }]
  });
  summary.setup.email = { configured: true, ownerEmail: '' };
  summary.setup.twoFactor = false;
  const { sections, rows } = attentionBySection(build(summary));
  assert.deepEqual(sections, {
    setup: { count: 2, tone: 'urgent' },
    questions: { count: 2, tone: 'warn' },
    reviews: { count: 2, tone: 'info' }
  });
  assert.equal(rows.get('setup:owner-email'), 'urgent');
  assert.equal(rows.get('setup:sign-in'), 'warn');
  assert.equal(rows.get('question:2'), 'warn');
  assert.equal(rows.get('review:2'), 'info');
  assert.deepEqual(ATTENTION_SECTIONS, { questions: 'Questions', setup: 'Setup', reviews: 'Reviews' });
});

test('the summary’s own time is “now” when none is given', () => {
  const summary = calm({ questions: [{ id: 1, name: 'Ann', email: 'ann@example.com', createdAt: ago((QUESTION_REPLY_DAYS - 1) * DAY) }] });
  assert.equal(buildAttention(summary, { config: CONFIG, pageVersion: '1.39.0' }).length, 1);
  assert.equal(buildAttention({ ...summary, generatedAt: later(2 * DAY) }, { config: CONFIG, pageVersion: '1.39.0' }).length, 0);
});

test('the admin summary carries the dates the list reads', async () => {
  const store = createMemoryStore({
    questions: [{ id: 1, email: 'jane@example.com', name: 'Jane', kind: 'question', message: 'Does it work offline?', locale: 'en', appVersion: '1.39.0', source: 'contact', createdAt: ago(DAY) }],
    reviews: [{ id: 2, appVersion: '1.39.0', rating: 5, text: 'Calm and clear.', name: 'Marie', createdAt: ago(2 * HOUR) }]
  });
  const api = createPlannerApi({ store, adminToken: 'secret', now: () => new Date(NOW) });
  const summary = await (await api(new Request('https://planner.test/api/admin/summary', { headers: { authorization: 'Bearer secret' } }))).json();
  assert.equal(summary.generatedAt, new Date(NOW).toISOString());
  assert.equal(summary.questions[0].createdAt, ago(DAY));
  assert.equal(summary.reviews[0].createdAt, ago(2 * HOUR));
  const items = buildAttention(summary, { config: CONFIG, pageVersion: summary.version });
  assert.deepEqual(texts(items.filter(item => item.section !== 'setup')), [
    'Question from Jane waiting for a reply',
    'New review from Marie to read'
  ]);
  // A data file of the dev server written before 1.39 calls the questions teamRequests: they still read.
  const older = createMemoryStore({ teamRequests: [{ id: 3, email: 'lea@example.com', name: 'Lea', company: 'Acme', teamSize: 25, kind: 'invoice', message: '', createdAt: ago(HOUR) }] });
  const fromOlder = await (await createPlannerApi({ store: older, adminToken: 'secret', now: () => new Date(NOW) })(new Request('https://planner.test/api/admin/summary', { headers: { authorization: 'Bearer secret' } }))).json();
  assert.deepEqual(fromOlder.questions.map(row => [row.kind, row.company, row.teamSize]), [['invoice', 'Acme', 25]]);
});

test('the dashboard loads the helpers, reloads them with its other files, and points each line at its card', () => {
  const source = readFileSync(new URL('../admin/admin.js', import.meta.url), 'utf8');
  assert.match(source, /from '\.\/attention\.js'/);
  assert.match(source, /DASHBOARD_FILES = \[[^\]]*'\.\/attention\.js'/);
  assert.match(source, /DASHBOARD_FILES = \[[^\]]*'\.\/requests-view\.js'/);
  assert.match(source, /const ATTENTION_CARDS = \{ questions: '\[data-owner-questions\]', setup: '\[data-owner-setup\]', reviews: '\[data-owner-reviews\]' \};/);
  assert.doesNotMatch(source, /partners-view|pricing\.js|creem-setup|test-purchases|payout-dialog/);
  const page = readFileSync(new URL('../admin/index.html', import.meta.url), 'utf8');
  assert.ok(page.indexOf('data-owner-attention') < page.indexOf('data-owner-kpis'), 'the panel comes first in the dashboard');
  for (const selector of ['data-owner-questions', 'data-owner-setup', 'data-owner-reviews']) assert.ok(page.includes(`${selector}>`) || page.includes(`${selector} `), selector);
});
