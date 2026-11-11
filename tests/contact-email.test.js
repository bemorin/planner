import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// The build variables as the owner may type them: in angle brackets, after a name, with spaces.
// config.js reads them when it loads, so they are set before anything imports it.
globalThis.__DAILY_PLANNER_CONFIG__ = { SUPPORT_EMAIL: ' <support@example.com> ', PRIVACY_EMAIL: 'Daily Planner privacy < privacy@example.com >' };

const config = await import('../src/config.js');
const legal = await import('../legal/legal.js');
const kit = await import('../welcome/page-kit.js');
const text = await import('../src/lib/text.js');

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

const ACCEPTED = [
  ['support@example.com', 'support@example.com'],
  ['  support@example.com ', 'support@example.com'],
  ['<support@example.com>', 'support@example.com'],
  ['  <support@example.com>  ', 'support@example.com'],
  ['< support@example.com >', 'support@example.com'],
  ['Support <support@example.com>', 'support@example.com'],
  ['Support Team<support+planner@mail.example.org>', 'support+planner@mail.example.org'],
  ['"Daily Planner, support" <support@example.com>', 'support@example.com']
];
// Still refused: anything that isn't one plain address, with or without brackets.
const REFUSED = [
  '<>', 'Support', '<support@example>', '<support@example.com', 'support@example.com>', 'Support support@example.com',
  '<support@example.com>?bcc=x@example.org', '<support@example.com?bcc=x@example.org>', 'support@example.com?subject=Hi',
  '<a@example.com> <b@example.com>', 'a@example.com, b@example.com', 'Support <<support@example.com>>',
  'mailto:support@example.com', '<mailto:support@example.com>', '<a b@example.com>', 'ben at example dot com',
  // Two addresses, the second in brackets: never read as the second one alone.
  'support@example.com, <other@example.org>', 'support@example.com <other@example.org>', 'Support; <other@example.org>', '"Support" x <other@example.org>'
];

test('an email build variable may be typed “<address>” or “Name <address>”: the address is used', () => {
  for (const [typed, address] of ACCEPTED) {
    assert.equal(legal.legalEmail(typed), address, typed);
    assert.equal(legal.legalDetails({ SUPPORT_EMAIL: typed }).email, address, `SUPPORT_EMAIL ${typed}`);
    assert.equal(legal.legalDetails({ PRIVACY_EMAIL: typed }).privacyEmail, address, `PRIVACY_EMAIL ${typed}`);
    assert.equal(legal.legalValueProblem('SUPPORT_EMAIL', typed), '', typed);
    assert.equal(legal.legalValueProblem('PRIVACY_EMAIL', typed), '', typed);
  }
});

test('anything else that isn’t a plain address is still left out, and said so', () => {
  for (const typed of REFUSED) {
    assert.equal(legal.legalEmail(typed), '', typed);
    assert.equal(legal.legalDetails({ SUPPORT_EMAIL: typed }).email, '', typed);
    assert.equal(legal.legalValueProblem('SUPPORT_EMAIL', typed), 'not a plain email address', typed);
    assert.ok(!kit.EMAIL_RE.test(kit.emailAddress(typed)), `the welcome pages refuse it too: ${typed}`);
  }
  assert.equal(legal.legalValueProblem('SUPPORT_EMAIL', '   '), '', 'blank is not a problem');
});

test('the planner, the welcome pages and the legal pages read an address the same way', () => {
  // One function: src/lib/text.js, re-exported by src/config.js and legal/legal-details.js.
  assert.equal(config.emailAddress, text.emailAddress);
  assert.equal(legal.emailAddress, text.emailAddress);
  assert.match(read('legal/legal-details.js'), /\nimport \{ emailAddress \} from '\.\.\/src\/lib\/text\.js';\n/);
  assert.doesNotMatch(read('legal/legal-details.js'), /<\\s\*\(/, 'no second copy of the rule');
  assert.doesNotMatch(read('src/config.js'), /<\\s\*\(/, 'no second copy of the rule');
  for (const typed of [...ACCEPTED.map(([value]) => value), ...REFUSED, '', '  ', undefined, null, 42]) {
    const expected = legal.emailAddress(typed);
    assert.equal(config.emailAddress(typed), expected, `src/config.js: ${typed}`);
    assert.equal(kit.emailAddress(typed), expected, `welcome/page-kit.js: ${typed}`);
  }
  // config.js exports the addresses themselves: the legal pages (legal.js) and the Contact page read these.
  assert.equal(config.SUPPORT_EMAIL, 'support@example.com');
  assert.equal(config.PRIVACY_EMAIL, 'privacy@example.com');
  assert.equal(kit.configText('SUPPORT_EMAIL'), 'support@example.com');
});

test('the legal pages, built or in the browser, link the address, never the brackets', () => {
  const sample = { SUPPORT_EMAIL: '<support@example.com>', PRIVACY_EMAIL: 'Privacy <privacy@example.com>' };
  const notice = legal.staticLegalHtml(read('legal/index.html'), sample);
  assert.match(notice, /<dt>Email<\/dt><dd><a href="mailto:support@example\.com">support@example\.com<\/a><\/dd>/);
  const privacy = legal.staticLegalHtml(read('legal/privacy/index.html'), sample);
  assert.match(privacy, /email <a href="mailto:privacy@example\.com">privacy@example\.com<\/a>/);
  for (const html of [notice, privacy]) assert.doesNotMatch(html, /mailto:[^"]*(?:&lt;|<|%3C)/i);
  // In the browser, legal.js reads src/config.js (already unwrapped here) and checks it again.
  const nodes = new Map();
  const doc = { body: { dataset: { root: '../' } }, querySelectorAll: selector => { if (!nodes.has(selector)) nodes.set(selector, [{ innerHTML: '', textContent: '', dataset: {} }]); return nodes.get(selector); }, querySelector: () => null };
  legal.applyLegal(doc);
  assert.match(nodes.get('[data-legal-details="notice"]')[0].innerHTML, /mailto:support@example\.com/);
  assert.match(nodes.get('[data-legal-contact="privacy"]')[0].innerHTML, /mailto:privacy@example\.com/);
});

test('the Contact page and its question form read the address; no footer shows it (1.32)', () => {
  const kitSource = read('welcome/page-kit.js');
  assert.doesNotMatch(kitSource, /Support: |data-support|SUPPORT_EMAIL'\)/, 'no Support line in the footers');
  for (const page of ['welcome/index.html', 'contact/index.html']) {
    assert.doesNotMatch(/<footer class="foot">[\s\S]*?<\/footer>/.exec(read(page))[0], /data-support|foot__support|mailto:/, page);
  }
  // The Contact page shows the address under its intro (“Prefer email? Write to …”), when it is set.
  assert.match(read('contact/contact.js'), /const support = configEmail\(LANDING\.supportEmail, configText\('SUPPORT_EMAIL'\)\);/);
  const form = read('welcome/contact-form.js');
  assert.match(form, /const contactEmail = emailAddress\(settings\.contactEmail \|\| configText\('SUPPORT_EMAIL'\)\);/);
  assert.match(form, /const mode = plannerApiEnabled\(\) \? 'api' : \(EMAIL_RE\.test\(contactEmail\) \? 'mailto' : 'off'\);/);
  assert.match(form, /location\.href = `mailto:\$\{contactEmail\}\?subject=/);
  assert.doesNotMatch(form, /mailto:\$\{settings\.contactEmail\}/);
});

test('the dashboard’s Setup says how it read an address typed with brackets', () => {
  const source = read('admin/admin.js');
  const code = /function legalVariableState\(key\) \{[\s\S]*?\n\}/.exec(source)?.[0];
  assert.ok(code, 'legalVariableState');
  const state = (appConfig, key) => vm.runInNewContext(`${code}\nlegalVariableState(${JSON.stringify(key)});`, {
    APP_CONFIG: appConfig, legalValueProblem: legal.legalValueProblem, legalDetails: legal.legalDetails, legalEmail: legal.legalEmail, esc: legal.esc
  });
  assert.equal(state({ SUPPORT_EMAIL: '<support@example.com>' }, 'SUPPORT_EMAIL'), 'set, read as support@example.com');
  assert.equal(state({ SUPPORT_EMAIL: 'Support <support@example.com>' }, 'SUPPORT_EMAIL'), 'set, read as support@example.com');
  assert.equal(state({ PRIVACY_EMAIL: ' <privacy@example.com> ' }, 'PRIVACY_EMAIL'), 'set, read as privacy@example.com');
  assert.equal(state({ SUPPORT_EMAIL: ' support@example.com ' }, 'SUPPORT_EMAIL'), 'set', 'spaces alone are nothing to mention');
  assert.equal(state({ SUPPORT_EMAIL: '<support@example.com>?bcc=x@example.org' }, 'SUPPORT_EMAIL'), 'set, but not used: not a plain email address');
  assert.equal(state({ SUPPORT_EMAIL: 'support@example.com, <other@example.org>' }, 'SUPPORT_EMAIL'), 'set, but not used: not a plain email address');
  assert.equal(state({ PRIVACY_EMAIL: 'support@example.com <other@example.org>' }, 'PRIVACY_EMAIL'), 'set, but not used: not a plain email address');
  assert.equal(state({}, 'SUPPORT_EMAIL'), 'blank');
  assert.equal(state({ LEGAL_PHONE: '+33199001234' }, 'LEGAL_PHONE'), 'set, shown as +33 1 99 00 12 34');
  assert.match(source, /import \{ legalDetails, legalEmail, legalValueProblem \} from '\.\.\/legal\/legal-details\.js';/);
});
