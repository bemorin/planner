import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { EARLIER_KINDS, earlierLine, isPlainQuestion, questionRowHtml, questionsTableHtml, REQUEST_SOURCES } from '../admin/requests-view.js';

const cells = html => [...html.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(match => match[1].replace(/<[^>]+>/g, ''));
const when = iso => `on ${iso.slice(0, 10)}`;
const question = { id: 7, createdAt: '2026-10-21T09:00:00Z', company: '', teamSize: 0, kind: 'question', name: 'Ann', email: 'ann@example.com', message: 'Can I move my plans to a new laptop?', source: 'contact' };
// A row from the releases that also took team orders (until 1.38).
const invoice = { id: 8, createdAt: '2026-10-21T10:00:00Z', company: 'Acme <b>', teamSize: 40, kind: 'invoice', name: 'Jane', email: 'jane@acme.example', message: 'For January', source: 'teams' };

test('a question reads as one: when, who asked, their address, the question and where it was sent from', () => {
  assert.equal(isPlainQuestion(question), true);
  assert.deepEqual(cells(questionRowHtml(question, { when })), ['on 2026-10-21', 'Ann', 'ann@example.com', 'Can I move my plans to a new laptop?', 'Contact page', 'Delete']);
  const html = questionRowHtml(question, { when });
  assert.doesNotMatch(html, />0</, 'never “0 people”');
  assert.doesNotMatch(html, /owner-small/, 'no line about a team');
  assert.match(html, /<a href="mailto:ann@example\.com">ann@example\.com<\/a>/);
  assert.match(html, /data-owner-attn="question:7"/);
  assert.match(html, /data-owner-delete-question="7"/);
  assert.deepEqual(cells(questionRowHtml({ ...question, name: '' }, { when }))[1], '—');
  assert.deepEqual(Object.keys(REQUEST_SOURCES), ['contact', 'app', 'landing', 'teams']);
});

test('an earlier team request still reads, escaped, with a short line that says what it was', () => {
  const row = questionRowHtml(invoice, { when, number: value => `n${value}` });
  assert.equal(isPlainQuestion(invoice), false);
  assert.match(row, /<small class="owner-small">Invoice request · Acme &lt;b&gt; · n40 people<\/small>For January/);
  assert.equal(cells(row)[4], 'Teams page');
  assert.equal(earlierLine(question), '');
  assert.equal(earlierLine({ ...question, company: 'Globex', teamSize: 1 }), 'Earlier request · Globex · 1 person', 'a question from before 1.29.1 that named a team');
  assert.equal(earlierLine({ ...invoice, kind: 'talk', company: '', teamSize: 0 }), 'Talk request');
  assert.deepEqual(EARLIER_KINDS, { invoice: 'Invoice request', quote: 'Quote request', talk: 'Talk request' });
  // An address that could add fields to a reply is shown, never linked.
  assert.doesNotMatch(questionRowHtml({ ...question, email: 'a@example.com?bcc=x@example.org' }), /mailto:/);
});

test('the table has one header and a row per question; nothing to list is empty', () => {
  const html = questionsTableHtml([question, invoice], { when });
  assert.equal((html.match(/<tr data-owner-attn=/g) || []).length, 2);
  const heads = [...html.matchAll(/<th[^>]*>(.*?)<\/th>/g)].map(match => match[1]);
  assert.deepEqual(heads.map(head => head.replace(/<[^>]+>/g, '')), ['Date', 'Name', 'Email', 'Question', 'Source', 'Actions']);
  assert.equal(heads.at(-1), '<span class="sr-only">Actions</span>', 'the Delete column is named for screen readers, never an empty header');
  assert.equal(questionsTableHtml([]), '');
  assert.equal(questionsTableHtml(undefined), '');
  // The dashboard renders it, reloads it with the other files, and names the card for both.
  const admin = readFileSync(new URL('../admin/admin.js', import.meta.url), 'utf8');
  assert.match(admin, /import \{ questionsTableHtml \} from '\.\/requests-view\.js';/);
  assert.match(admin, /DASHBOARD_FILES = \[[^\]]*'\.\/requests-view\.js'/);
  const index = readFileSync(new URL('../admin/index.html', import.meta.url), 'utf8');
  assert.match(index, /<h2 id="owner-questions-title">Questions<\/h2>/);
  assert.doesNotMatch(index, /Requests and questions|Team gifts|Refunds and disputes|data-owner-partners/);
});
