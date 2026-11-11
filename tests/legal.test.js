import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { dirname, join, posix, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// config.js reads the runtime configuration when it loads: give it sample
// legal details (with stray spaces) before anything imports it.
globalThis.__DAILY_PLANNER_CONFIG__ = { SUPPORT_EMAIL: '  hello@example.com ', PRIVACY_EMAIL: ' privacy@example.com ', LEGAL_PHONE: ' +33 1 99 00 12 34 ', LEGAL_ADDRESS: ' 1 rue Exemple, 75000 Paris ', LEGAL_REGISTRATION: 'SIRET 000 000 000 00000' };

const config = await import('../src/config.js');
const api = await import('../src/lib/planner-api.js');
const legal = await import('../legal/legal.js');
const { landingMoments } = await import('../welcome/landing-model.js');
const { RETIRED_KEYS } = await import('../src/state/retired-keys.js');

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = rel => readFile(join(root, rel), 'utf8');
const PAGES = { 'legal/': 'legal/index.html', 'legal/privacy/': 'legal/privacy/index.html', 'legal/terms/': 'legal/terms/index.html', 'legal/cookies/': 'legal/cookies/index.html' };
const hrefs = html => [...html.matchAll(/href="([^"]+)"/g)].map(match => match[1].replace(/&amp;/g, '&'));
/** A relative href from a page folder ('legal/privacy/') to a site path ('legal/terms/'). */
const resolveHref = (folder, href) => posix.normalize(posix.join(folder, href.split(/[?#]/)[0])).replace(/^\.\//, '');
const footerOf = html => /<footer class="lg-foot">([\s\S]*?)<\/footer>/.exec(html)?.[1] || '';
const text = html => html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

async function walk(rel) {
  const files = [];
  for (const entry of await readdir(join(root, rel), { withFileTypes: true })) {
    const child = `${rel}/${entry.name}`;
    if (entry.isDirectory()) files.push(...await walk(child));
    else files.push(child);
  }
  return files;
}

test('the four legal pages exist, and each footer links all four in order', async () => {
  for (const [folder, file] of Object.entries(PAGES)) {
    const html = await read(file);
    assert.match(html, /^<!doctype html>/i, file);
    // All four were last changed on 10 November 2026 (1.39: the planner is free and open source, under the MIT licence,
    // and nothing is sold; 1.38 that same day: Dropbox, the sealed copy, Google's access kept until it runs out).
    const dates = { 'legal/': ['2026-11-10', '10 November 2026'], 'legal/terms/': ['2026-11-10', '10 November 2026'], 'legal/privacy/': ['2026-11-10', '10 November 2026'], 'legal/cookies/': ['2026-11-10', '10 November 2026'] };
    const [iso, day] = dates[folder];
    const updated = new RegExp(`Last updated: <time datetime="${iso}">${day}</time>`);
    assert.match(html, updated, `${file} shows the date`);
    const legalLinks = hrefs(footerOf(html)).map(href => resolveHref(folder, href)).filter(path => path.startsWith('legal'));
    assert.deepEqual(legalLinks, ['legal/privacy/', 'legal/terms/', 'legal/cookies/', 'legal/'], `${file} footer: Privacy · Terms · Cookies · Legal notice`);
    assert.match(footerOf(html), /aria-current="page"/, `${file} marks itself in the footer`);
    const self = /<a href="([^"]+)" aria-current="page"/.exec(footerOf(html))[1];
    assert.equal(resolveHref(folder, self), folder, `${file} marks the right page as current`);
  }
});

test('each page loads its runtime config, then the shared module and stylesheet, at the right depth', async () => {
  for (const [folder, file] of Object.entries(PAGES)) {
    const html = await read(file);
    const up = folder === 'legal/' ? '../' : '../../';
    const own = folder === 'legal/' ? './' : '../';
    const config = html.indexOf(`<script src="${up}runtime-config.js"></script>`);
    const module = html.indexOf(`<script type="module" src="${own}legal.js"></script>`);
    assert.ok(config > 0 && module > config, `${file}: runtime-config.js before legal.js`);
    assert.ok(html.includes(`<link rel="stylesheet" href="${own}legal.css">`), file);
    assert.ok(html.includes(`<body data-root="${up}">`), `${file}: data-root points at the site root`);
    assert.ok(html.includes(`<img src="${up}favicon.svg"`), `${file}: the Daily Planner mark`);
    assert.ok(html.includes(`<a class="lg-btn" href="${up}?start">Open the planner</a>`), file);
    assert.doesNotMatch(html, /https?:\/\/[^"]*\.(?:js|css)"|fonts\.googleapis|landing\.css/, `${file}: no external scripts, fonts or the landing stylesheet`);
  }
});

test('the privacy page renders every counted moment from the code, in both lists', async () => {
  const html = await read('legal/privacy/index.html');
  assert.match(html, /data-legal-events="planner"/);
  assert.match(html, /data-legal-events="landing"/);
  const planner = legal.eventsHtml(api.COUNTED_EVENTS);
  // The landing page's list: only the moments it sends (welcome/landing-model.js).
  const sent = landingMoments(api.LANDING_EVENTS);
  const landing = legal.eventsHtml(sent);
  for (const [, words] of api.COUNTED_EVENTS) assert.ok(planner.includes(`<li>${legal.esc(words)}</li>`), words);
  for (const [, words] of sent) assert.ok(landing.includes(`<li>${legal.esc(words)}</li>`), words);
  assert.equal((planner.match(/<li>/g) || []).length, api.COUNTED_EVENTS.length);
  assert.equal((landing.match(/<li>/g) || []).length, sent.length);
  assert.ok(sent.length >= 2, 'the visit and “Open the planner”');
  assert.equal(legal.eventsHtml([['x', 'clicked <b>“Go”</b> & left']]), '<li>clicked &lt;b&gt;“Go”&lt;/b&gt; &amp; left</li>', 'descriptions are escaped');
});

// The ranges kept for fiction (ARCEP 01 99 00, NANP 555-01xx, Ofcom 020 7946 0xxx): the only phone numbers examples may use.
const FICTION = /^(?:3319900\d{4}|1\d{3}55501\d{2}|442079460\d{3})$/;
const FORM_PHRASE = root => `use the <a href="${root}contact/">“Ask a question” form</a>`;
const labels = (details, page) => legal.detailRows(details, '../', page).map(([label]) => label);

test('blank details are left out and every contact falls back to the “Ask a question” form', () => {
  const blank = legal.legalDetails({});
  assert.deepEqual(blank, { email: '', privacyEmail: '', phone: '', address: '', registration: '' });
  assert.deepEqual(labels(blank, 'notice'), ['Publisher', 'Contact', 'Director of publication'], 'the director of publication is a row of the table');
  assert.deepEqual(labels(blank, 'privacy'), ['Data controller', 'Contact']);
  const html = legal.detailsHtml(legal.detailRows(blank, '../../'));
  assert.match(html, /href="\.\.\/\.\.\/contact\/"/);
  assert.doesNotMatch(html, /on the welcome page|teams\/\?ask=/, 'the form lives on the Contact page now');
  assert.doesNotMatch(html, /Address|Registration|Phone|mailto:|tel:/);
  assert.match(html, /<dt>Director of publication<\/dt><dd>Ben Morin<\/dd>/);
  for (const topic of ['support', 'privacy']) {
    assert.equal(legal.contactEmail(blank, topic), '');
    assert.equal(legal.contactPhrase(blank, '../', topic), FORM_PHRASE('../'), topic);
  }
  assert.equal(legal.askHref('../'), '../contact/');
  assert.equal(legal.askHref('../../'), '../../contact/');
  for (const bad of ['not-an-email', 'a@b', 'me@example.com?bcc=x@example.net', 'a b@example.com']) {
    assert.equal(legal.legalDetails({ SUPPORT_EMAIL: bad }).email, '', `${bad} is not used in a mailto: link`);
    assert.equal(legal.legalDetails({ PRIVACY_EMAIL: bad }).privacyEmail, '', `${bad} is not used as the privacy address`);
  }
});

test('set details appear, trimmed and escaped, with the support address as the email', () => {
  const details = legal.legalDetails({ SUPPORT_EMAIL: ' hello@example.com ', LEGAL_ADDRESS: '1 rue <Exemple>\n75000 Paris', LEGAL_REGISTRATION: ' SIRET 000 000 000 00000 ' });
  assert.deepEqual(details, { email: 'hello@example.com', privacyEmail: '', phone: '', address: '1 rue <Exemple> 75000 Paris', registration: 'SIRET 000 000 000 00000' });
  assert.deepEqual(labels(details, 'notice'), ['Publisher', 'Address', 'Registration', 'Email', 'Director of publication']);
  assert.deepEqual(labels(details, 'privacy'), ['Data controller', 'Address', 'Registration', 'Email']);
  const html = legal.detailsHtml(legal.detailRows(details));
  assert.match(html, /1 rue &lt;Exemple&gt; 75000 Paris/);
  assert.match(html, /<dt>Email<\/dt><dd><a href="mailto:hello@example\.com">hello@example\.com<\/a><\/dd>/);
  assert.equal(legal.contactPhrase(details), 'email <a href="mailto:hello@example.com">hello@example.com</a>');
});

test('support address only: the terms, the legal notice and privacy questions all use it', () => {
  const details = legal.legalDetails({ SUPPORT_EMAIL: 'support@example.com' });
  const mail = 'email <a href="mailto:support@example.com">support@example.com</a>';
  assert.equal(legal.contactPhrase(details, '../', 'support'), mail);
  assert.equal(legal.contactPhrase(details, '../', 'privacy'), mail, 'no privacy address: the support one');
  assert.match(legal.detailsHtml(legal.detailRows(details, '../', 'privacy')), /<dt>Email<\/dt><dd><a href="mailto:support@example\.com">/);
});

test('support and privacy addresses: privacy questions go to the privacy one, the rest to support', () => {
  const details = legal.legalDetails({ SUPPORT_EMAIL: 'support@example.com', PRIVACY_EMAIL: ' privacy@example.com ' });
  assert.equal(details.privacyEmail, 'privacy@example.com');
  assert.equal(legal.contactEmail(details, 'support'), 'support@example.com');
  assert.equal(legal.contactEmail(details, 'privacy'), 'privacy@example.com');
  assert.equal(legal.contactPhrase(details, '../', 'privacy'), 'email <a href="mailto:privacy@example.com">privacy@example.com</a>');
  const notice = legal.detailsHtml(legal.detailRows(details, '../', 'notice'));
  const privacy = legal.detailsHtml(legal.detailRows(details, '../', 'privacy'));
  assert.match(notice, /mailto:support@example\.com/);
  assert.doesNotMatch(notice, /privacy@/, 'the legal notice shows the support address');
  assert.match(privacy, /mailto:privacy@example\.com/);
  assert.doesNotMatch(privacy, /support@/, 'the controller’s contact is the privacy address');
  // A privacy address alone: privacy questions go to it, everything else to the form.
  const only = legal.legalDetails({ PRIVACY_EMAIL: 'privacy@example.com' });
  assert.equal(legal.contactPhrase(only, '../', 'support'), FORM_PHRASE('../'));
  assert.deepEqual(labels(only, 'notice'), ['Publisher', 'Contact', 'Director of publication']);
  assert.equal(legal.contactEmail(only, 'privacy'), 'privacy@example.com');
});

// Phone numbers in tests are from the ranges kept for fiction (ARCEP: 01 99 00 xx xx;
// the US and Canada: 555-0100 to 555-0199; Ofcom: 020 7946 0xxx, 0121 496 0xxx, 07700 900xxx …),
// or made of zeros, never a real line.
test('a phone number becomes a Phone row of the legal notice, as a tel: link; anything else is left out', () => {
  const details = legal.legalDetails({ SUPPORT_EMAIL: 'support@example.com', LEGAL_PHONE: ' +33 (0)1 99-00.12.34 ', LEGAL_ADDRESS: '1 rue Exemple', LEGAL_REGISTRATION: 'SIRET 1' });
  assert.equal(details.phone, '+33 1 99 00 12 34', 'written the French way, whatever the typing');
  assert.deepEqual(labels(details, 'notice'), ['Publisher', 'Address', 'Registration', 'Email', 'Phone', 'Director of publication'], 'the order the legal notice reads');
  assert.deepEqual(labels(details, 'privacy'), ['Data controller', 'Address', 'Registration', 'Email'], 'the privacy policy shows no phone');
  assert.match(legal.detailsHtml(legal.detailRows(details)), /<dt>Phone<\/dt><dd><a href="tel:\+33199001234">\+33 1 99 00 12 34<\/a><\/dd>/);
  assert.equal(legal.telHref('01 99 00 12 34'), 'tel:0199001234');
  assert.equal(legal.telHref('+1 (650) 319-8930'), 'tel:+16503198930');
  for (const bad of ['12345', 'call me', '+33 1 99 00 12 34 ext. 2', '+33 1 99 00 12 34 (office)', '01 99 00 12 34<script>', '+33 1+99 00 12 34', '1'.repeat(21), '01 99 00\n12 34 <b>']) {
    assert.equal(legal.legalPhone(bad), '', JSON.stringify(bad));
  }
  assert.equal(legal.legalPhone('01 99 00\n12 34'), '01 99 00 12 34', 'one line');
  assert.deepEqual(labels(legal.legalDetails({ LEGAL_PHONE: 'call me' }), 'notice'), ['Publisher', 'Contact', 'Director of publication']);
});

test('the national “(0)” is dropped only from an international number', () => {
  assert.equal(legal.telHref('+33 (0)1 99 00 12 34'), 'tel:+33199001234', 'after +33 the 0 is not dialled');
  assert.equal(legal.telHref('(0)1 99 00 12 34'), 'tel:0199001234', 'a national number keeps its 0');
  assert.equal(legal.telHref('(01) 99 00 12 34'), 'tel:0199001234');
  assert.equal(legal.telHref(' +44 (0)20 7946 0000 '), 'tel:+442079460000');
  assert.equal(legal.phoneHtml('(0)1 99 00 12 34'), '<a href="tel:0199001234">(0)1 99 00 12 34</a>');
});

test('an international number is shown the way its country writes it, after the country code; the tel: link is its digits', () => {
  const shown = value => legal.legalPhone(value);
  // France, as the owner types it (E.164: +33, then the number without its 0) or with spaces, dots, dashes and “(0)”.
  for (const typed of ['+33199001234', '+33 1 99 00 12 34', '+33 (0)1 99 00 12 34', '+33.1.99.00.12.34', '+33-199-001-234', ' +33 1 9900 1234 ']) {
    assert.equal(shown(typed), '+33 1 99 00 12 34', typed);
    assert.equal(legal.telHref(shown(typed)), 'tel:+33199001234', typed);
  }
  const cases = [
    // The US and Canada: area code, exchange, line.
    ['+15145550123', '+1 514 555 0123'],
    ['+1 (514) 555-0123', '+1 514 555 0123'],
    // The United Kingdom: London, a mobile, a 01x1 city, another 01 area, a freephone number.
    ['+442079460000', '+44 20 7946 0000'],
    ['+44 (0)20 7946 0000', '+44 20 7946 0000'],
    ['+447700900123', '+44 7700 900123'],
    ['+441214960000', '+44 121 496 0000'],
    ['+441632960000', '+44 1632 960000'],
    ['+448081570000', '+44 808 157 0000'],
    // Belgium: Brussels, another area, a mobile, a freephone number.
    ['+3220000000', '+32 2 000 00 00'],
    ['+3210000000', '+32 10 00 00 00'],
    ['+32470000000', '+32 470 00 00 00'],
    ['+3280000000', '+32 800 00 000'],
    // Switzerland: Zurich, a freephone number.
    ['+41440000000', '+41 44 000 00 00'],
    ['+41800000000', '+41 800 000 000'],
    // Germany: the area code, then the number in one block (Berlin, Cologne, a mobile, Heidelberg).
    ['+493023125000', '+49 30 23125000'],
    ['+492214710000', '+49 221 4710000'],
    ['+4915100000000', '+49 151 00000000'],
    ['+49 (0)6221 000000', '+49 6221 000000']
  ];
  for (const [typed, expected] of cases) {
    assert.equal(shown(typed), expected, typed);
    assert.equal(legal.telHref(shown(typed)), `tel:+${typed.replace(/\(0\)/g, '').replace(/\D/g, '')}`, `${typed}: the tel: link`);
  }
});

test('another country: groups of three and two digits, or the spaces it was typed with; a national number as typed', () => {
  assert.equal(legal.formatPhone('+351210000000'), '+351 210 000 000', 'Portugal, 9 digits');
  assert.equal(legal.formatPhone('+351 210000000'), '+351 210 000 000', 'a space after the code only');
  assert.equal(legal.formatPhone('+351 21 000 0000'), '+351 21 000 0000', 'typed with its own spaces: kept');
  assert.equal(legal.formatPhone('+3906000000000'), '+39 060 000 000 00', 'Italy keeps its 0; 11 digits: 3 3 3 2');
  assert.equal(legal.formatPhone('+31200000000'), '+31 200 000 000');
  assert.equal(legal.formatPhone('+3520000000'), '+352 000 00 00', 'never a group of one: 7 digits are 3 2 2');
  assert.equal(legal.legalPhone('+7 495 000 00 00'), '+7 495 000 00 00', 'Russia (+7): as typed');
  assert.equal(legal.telHref(legal.legalPhone('+7 495 000 00 00')), 'tel:+74950000000');
  // Without +: as typed, on one line, and dialled with its 0.
  assert.equal(legal.legalPhone('01 99 00 12 34'), '01 99 00 12 34');
  assert.equal(legal.legalPhone('0199001234'), '0199001234');
  assert.equal(legal.telHref(legal.legalPhone('01 99 00 12 34')), 'tel:0199001234');
  // The country code an international number starts with (ITU-T E.164).
  assert.deepEqual(['15145550123', '74950000000', '33199001234', '442079460000', '351210000000', '3520000000', '8613800000000', '85200000000'].map(legal.callingCode), ['1', '7', '33', '44', '351', '352', '86', '852']);
});

test('a number for a country the pages know must have its digits after the code; others are checked loosely', () => {
  const problem = value => legal.legalValueProblem('LEGAL_PHONE', value);
  for (const [typed, words] of [
    ['+330199001234', 'not a phone number: after +33, the 9 digits of the number, without its leading 0'],
    ['+33 01 99 00 12 34', 'not a phone number: after +33, the 9 digits of the number, without its leading 0'],
    ['+3319900123', 'not a phone number: after +33, the 9 digits of the number, without its leading 0'],
    ['+331990012345', 'not a phone number: after +33, the 9 digits of the number, without its leading 0'],
    ['+1514555012', 'not a phone number: after +1, the 10 digits of the number'],
    ['+1 1514 555 0123', 'not a phone number: after +1, the 10 digits of the number'],
    ['+4420794600', 'not a phone number: after +44, the 9 or 10 digits of the number, without its leading 0'],
    ['+44 020 7946 0000', 'not a phone number: after +44, the 9 or 10 digits of the number, without its leading 0'],
    ['+321000000', 'not a phone number: after +32, the 8 or 9 digits of the number, without its leading 0'],
    ['+4144000000', 'not a phone number: after +41, the 9 digits of the number, without its leading 0'],
    ['+49 030 23125000', 'not a phone number: after +49, the 5 to 13 digits of the number, without its leading 0'],
    ['+3512100000000000', 'not a phone number: at most 15 digits after the +'],
    ['+352 12', 'not a phone number'],
    ['+33 1 99 00 12 34 (office)', 'not a phone number']
  ]) {
    assert.equal(problem(typed), words, typed);
    assert.equal(legal.legalPhone(typed), '', `${typed} is left out`);
  }
  // Whatever it accepts, the pages show; a national number is checked as before.
  for (const typed of ['+33199001234', '+15145550123', '+442079460000', '+3220000000', '+41440000000', '+493023125000', '+351210000000', '01 99 00 12 34', '(0)1 99 00 12 34']) {
    assert.equal(problem(typed), '', typed);
    assert.notEqual(legal.legalPhone(typed), '', typed);
  }
});

test('legal.js and the build show the same formatted number', async () => {
  const config = { LEGAL_PHONE: '+33199001234' };
  const node = () => ({ innerHTML: '', textContent: '', hidden: undefined, dataset: {} });
  const notice = node();
  const doc = { body: { dataset: { root: '../' } }, querySelectorAll: selector => (selector === '[data-legal-details="notice"]' ? [notice] : []), querySelector: () => null };
  legal.applyLegal(doc, { config });
  const row = '<div class="lg-dl__row"><dt>Phone</dt><dd><a href="tel:+33199001234">+33 1 99 00 12 34</a></dd></div>';
  assert.ok(notice.innerHTML.includes(row), notice.innerHTML);
  assert.ok(legal.staticLegalHtml(await read('legal/index.html'), config).includes(row), 'the no-JavaScript page');
  assert.match(await read('legal/legal.css'), /\.lg-dl a\[href\^="tel:"\] \{ white-space: nowrap; \}/, 'never cut across two lines');
});

test('legalValueProblem says why a set value is left out, with the same checks as the pages', () => {
  assert.equal(legal.legalValueProblem('SUPPORT_EMAIL', 'ben at example dot com'), 'not a plain email address');
  assert.equal(legal.legalValueProblem('PRIVACY_EMAIL', 'privacy@example'), 'not a plain email address');
  assert.equal(legal.legalValueProblem('SUPPORT_EMAIL', 'me@example.com?bcc=x@example.com'), 'not a plain email address');
  assert.equal(legal.legalValueProblem('LEGAL_PHONE', '+33 1 99 00 12 34 (office)'), 'not a phone number');
  assert.equal(legal.legalValueProblem('LEGAL_PHONE', 'call me'), 'not a phone number');
  for (const [key, value] of [['SUPPORT_EMAIL', ' support@example.com '], ['PRIVACY_EMAIL', 'privacy@example.com'], ['LEGAL_PHONE', '+33 1 99 00 12 34'], ['LEGAL_ADDRESS', 'anything'], ['LEGAL_REGISTRATION', 'SIRET 1'], ['SUPPORT_EMAIL', '   '], ['LEGAL_PHONE', ''], ['LEGAL_PHONE', undefined]]) {
    assert.equal(legal.legalValueProblem(key, value), '', `${key}=${JSON.stringify(value)}`);
  }
  // Whatever it reports as usable, the pages show; whatever it rejects, they leave out.
  for (const value of ['ben at example dot com', 'privacy@example', 'support@example.com']) {
    assert.equal(legal.legalDetails({ SUPPORT_EMAIL: value }).email === '', legal.legalValueProblem('SUPPORT_EMAIL', value) !== '', value);
  }
  for (const value of ['+33 1 99 00 12 34 (office)', '+33 1 99 00 12 34']) {
    assert.equal(legal.legalDetails({ LEGAL_PHONE: value }).phone === '', legal.legalValueProblem('LEGAL_PHONE', value) !== '', value);
  }
});

test('applyLegal fills every placeholder from the configuration', () => {
  const nodes = {};
  const node = () => ({ innerHTML: '', textContent: '', hidden: undefined, dataset: {} });
  const selectors = ['[data-legal-details="notice"]', '[data-legal-details="privacy"]', '[data-legal-contact="support"]', '[data-legal-contact="privacy"]', '[data-legal-events="planner"]', '[data-legal-events="landing"]', '[data-legal-js]', '[data-legal-nojs]'];
  selectors.forEach(selector => { nodes[selector] = [node()]; });
  const doc = { body: { dataset: { root: '../../' } }, querySelectorAll: selector => nodes[selector] || [], querySelector: () => null };
  legal.applyLegal(doc, { config: {} });
  assert.match(nodes['[data-legal-details="notice"]'][0].innerHTML, /\.\.\/\.\.\/contact\//);
  assert.match(nodes['[data-legal-details="notice"]'][0].innerHTML, /Director of publication/);
  assert.doesNotMatch(nodes['[data-legal-details="notice"]'][0].innerHTML, /Address/);
  assert.match(nodes['[data-legal-details="privacy"]'][0].innerHTML, /Data controller/);
  assert.match(nodes['[data-legal-contact="support"]'][0].innerHTML, /^use the /);
  assert.match(nodes['[data-legal-contact="privacy"]'][0].innerHTML, /^use the /);
  assert.equal(nodes['[data-legal-events="planner"]'][0].innerHTML, legal.eventsHtml(api.COUNTED_EVENTS));
  assert.equal(nodes['[data-legal-events="landing"]'][0].innerHTML, legal.eventsHtml(landingMoments(api.LANDING_EVENTS)));
  assert.equal(nodes['[data-legal-js]'][0].hidden, false);
  assert.equal(nodes['[data-legal-nojs]'][0].hidden, true);
  // The default configuration is the runtime one, read through src/config.js.
  legal.applyLegal(doc);
  assert.match(nodes['[data-legal-details="notice"]'][0].innerHTML, /1 rue Exemple, 75000 Paris/);
  assert.match(nodes['[data-legal-details="notice"]'][0].innerHTML, /mailto:hello@example\.com/);
  assert.match(nodes['[data-legal-details="notice"]'][0].innerHTML, /tel:\+33199001234/);
  assert.match(nodes['[data-legal-details="privacy"]'][0].innerHTML, /mailto:privacy@example\.com/);
  assert.match(nodes['[data-legal-contact="support"]'][0].innerHTML, /mailto:hello@example\.com/);
  assert.match(nodes['[data-legal-contact="privacy"]'][0].innerHTML, /mailto:privacy@example\.com/);
});

test('src/config.js exports the legal details, trimmed, and runtime-config.js and check.mjs keep them blank', async () => {
  assert.equal(config.SUPPORT_EMAIL, 'hello@example.com');
  assert.equal(config.PRIVACY_EMAIL, 'privacy@example.com');
  assert.equal(config.LEGAL_PHONE, '+33 1 99 00 12 34');
  assert.equal(config.LEGAL_ADDRESS, '1 rue Exemple, 75000 Paris');
  assert.equal(config.LEGAL_REGISTRATION, 'SIRET 000 000 000 00000');
  const runtime = await read('runtime-config.js');
  const check = await read('scripts/check.mjs');
  for (const key of ['SUPPORT_EMAIL', 'PRIVACY_EMAIL', 'LEGAL_PHONE', 'LEGAL_ADDRESS', 'LEGAL_REGISTRATION']) {
    assert.match(runtime, new RegExp(`\\n  ${key}: ''[,\\n]`), `${key} stays blank in the public source`);
    assert.match(check, new RegExp(`'${key}'`), `scripts/check.mjs checks ${key} stays blank`);
  }
});

test('the static pages say what the script writes with nothing configured (no JavaScript: the form)', async () => {
  const blank = legal.legalDetails({});
  const squeeze = html => html.replace(/>\s+</g, '><').trim();
  const found = { notice: 0, privacy: 0, support: 0, privacyContact: 0 };
  for (const [folder, file] of Object.entries(PAGES)) {
    const html = await read(file);
    const root = folder === 'legal/' ? '../' : '../../';
    for (const match of html.matchAll(/<dl class="lg-dl" data-legal-details="([a-z]+)">([\s\S]*?)<\/dl>/g)) {
      assert.ok(['notice', 'privacy'].includes(match[1]), `${file}: ${match[1]}`);
      assert.equal(squeeze(match[2]), legal.detailsHtml(legal.detailRows(blank, root, match[1])), `${file}: the ${match[1]} table`);
      found[match[1]] += 1;
    }
    for (const match of html.matchAll(/<span data-legal-contact="([a-z]+)">([\s\S]*?)<\/span>/g)) {
      assert.ok(['support', 'privacy'].includes(match[1]), `${file}: ${match[1]}`);
      assert.equal(match[2], legal.contactPhrase(blank, root, match[1]), `${file}: a ${match[1]} contact`);
      found[match[1] === 'privacy' ? 'privacyContact' : 'support'] += 1;
    }
    assert.doesNotMatch(html, /data-legal-(?:details|contact)(?!=")/, `${file}: every hook says which contact it is`);
  }
  assert.deepEqual(found, { notice: 1, privacy: 1, support: 1, privacyContact: 2 });
  const notice = await read('legal/index.html');
  assert.doesNotMatch(notice, /<p>Director of publication/, 'no loose paragraph under the table');
  assert.match(await read('legal/privacy/index.html'), /To use any of these rights, <span data-legal-contact="privacy">/);
  assert.match(await read('legal/cookies/index.html'), /<section id="questions"[\s\S]*data-legal-contact="privacy"/);
  assert.equal((await read('legal/terms/index.html')).match(/data-legal-contact="support"/g).length, 1);
});

test('the build writes the configured details into the static pages, as legal.js would, escaped', async () => {
  const sample = { SUPPORT_EMAIL: ' support@example.com ', PRIVACY_EMAIL: 'privacy@example.com', LEGAL_PHONE: '+33 (0)1 99 00 12 34', LEGAL_ADDRESS: '12 rue de l’Exemple <b>\n75011 Paris', LEGAL_REGISTRATION: 'SIRET 123 & co' };
  const details = legal.legalDetails(sample);
  const squeeze = html => html.replace(/>\s+</g, '><').trim();
  for (const [folder, file] of Object.entries(PAGES)) {
    const source = await read(file);
    const root = folder === 'legal/' ? '../' : '../../';
    const built = legal.staticLegalHtml(source, sample);
    // Outside the hooks, the page is unchanged.
    const strip = html => html.replace(/(data-legal-details="[a-z]+">)[\s\S]*?<\/dl>/g, '$1</dl>').replace(/(data-legal-contact="[a-z]+">)[\s\S]*?<\/span>/g, '$1</span>');
    assert.equal(strip(built), strip(source), `${file}: only the hooks change`);
    for (const match of built.matchAll(/<dl class="lg-dl" data-legal-details="([a-z]+)">([\s\S]*?)<\/dl>/g)) {
      assert.equal(match[2], legal.detailsHtml(legal.detailRows(details, root, match[1])), `${file}: the ${match[1]} table`);
    }
    for (const match of built.matchAll(/<span data-legal-contact="([a-z]+)">([\s\S]*?)<\/span>/g)) {
      assert.equal(match[2], legal.contactPhrase(details, root, match[1]), `${file}: a ${match[1]} contact`);
    }
    // With nothing configured, the build writes what the source already says.
    assert.equal(squeeze(legal.staticLegalHtml(source, {})), squeeze(source), `${file}: blank config, blank fallback`);
  }
  const notice = legal.staticLegalHtml(await read('legal/index.html'), sample);
  assert.match(notice, /<dt>Address<\/dt><dd>12 rue de l’Exemple &lt;b&gt; 75011 Paris<\/dd>/, 'escaped, on one line');
  assert.match(notice, /<dt>Registration<\/dt><dd>SIRET 123 &amp; co<\/dd>/);
  assert.match(notice, /<dt>Email<\/dt><dd><a href="mailto:support@example\.com">support@example\.com<\/a><\/dd>/);
  assert.match(notice, /<dt>Phone<\/dt><dd><a href="tel:\+33199001234">\+33 1 99 00 12 34<\/a><\/dd>/);
  assert.doesNotMatch(notice, /<b>/, 'nothing from the configuration is read as markup');
  const privacy = legal.staticLegalHtml(await read('legal/privacy/index.html'), sample);
  assert.match(privacy, /To use any of these rights, <span data-legal-contact="privacy">email <a href="mailto:privacy@example\.com">/);
  // An invalid value is left out, as in the browser.
  const invalid = legal.staticLegalHtml(await read('legal/index.html'), { SUPPORT_EMAIL: 'ben at example dot com', LEGAL_PHONE: 'call me' });
  assert.match(invalid, /<dt>Contact<\/dt><dd>the <a href="\.\.\/contact\/">/);
  assert.doesNotMatch(invalid, /mailto:|ben at example|call me/);
  // The build applies it to every legal page, from the deployment's configuration, after copying legal/.
  const build = await read('scripts/build.mjs');
  assert.match(build, /import \{ staticLegalHtml \} from '\.\.\/legal\/legal-details\.js';/);
  const listed = JSON.parse(/const LEGAL_PAGES = (\[[^\]]+\]);/.exec(build)[1].replace(/'/g, '"'));
  assert.deepEqual(listed.sort(), Object.values(PAGES).sort());
  assert.match(build, /staticLegalHtml\(await fs\.readFile\(file, 'utf8'\), deploymentConfig\)/);
  assert.ok(build.indexOf("await copyTree('legal');") < build.indexOf('staticLegalHtml(await'), 'after the copy');
  assert.ok(build.indexOf('const deploymentConfig') < build.indexOf('staticLegalHtml(await'), 'with the deployment’s values');
});

test('no personal email address or phone number is written in legal/', async () => {
  for (const file of await walk('legal')) {
    const source = await read(file);
    assert.doesNotMatch(source, /[A-Za-z0-9._%+-]+@(?!example\.com)[A-Za-z0-9-]+\.[A-Za-z.]{2,}/, `${file} contains an email address`);
    assert.doesNotMatch(source, /@gmail\.com|@bemorin\.com/i, file);
    // The only phone number is Cloudflare’s, the host’s public switchboard; examples in comments are kept for fiction.
    const phones = [...source.matchAll(/\+\d[\d ()-]{7,}\d/g)].map(match => match[0].replace(/\D/g, ''));
    assert.ok(phones.every(phone => phone === '16503198930' || FICTION.test(phone)), `${file}: ${phones}`);
  }
});

test('the build copies legal/ and _redirects, and reads the five legal build variables, documented and listed in Setup', async () => {
  const build = await read('scripts/build.mjs');
  assert.match(build, /for \(const folder of PUBLISHED_FOLDERS\.filter\(name => name !== 'src'\)\) await copyTree\(folder\);/);
  assert.ok((await import('../scripts/published.mjs')).PUBLISHED_FOLDERS.includes('legal'));
  assert.match(build, /await copyFile\('_redirects'\);/);
  const docs = await read('docs/FEEDBACK_AND_WAITLIST.md');
  const admin = await read('admin/admin.js');
  for (const [key, variable] of [['SUPPORT_EMAIL', 'SUPPORT_EMAIL'], ['PRIVACY_EMAIL', 'PRIVACY_EMAIL'], ['LEGAL_PHONE', 'LEGAL_PHONE'], ['LEGAL_ADDRESS', 'LEGAL_ADDRESS'], ['LEGAL_REGISTRATION', 'LEGAL_REGISTRATION']]) {
    assert.match(build, new RegExp(`${key}: process\\.env\\.DAILY_PLANNER_${variable} \\|\\| ''`), key);
    assert.match(docs, new RegExp(`\\| \`DAILY_PLANNER_${variable}\` \\| Text \\|`), `docs: ${variable} in the variables table`);
    assert.match(admin, new RegExp(`\\['${key}', '`), `admin Setup: ${key} in the Legal pages line`);
  }
});

test('the dev server takes the legal and social-link build variables from the environment, as the build does', async () => {
  const build = await read('scripts/build.mjs');
  const serve = await read('scripts/serve.mjs');
  const fromBuild = new Map([...build.matchAll(/^ {2}([A-Z_]+): process\.env\.(DAILY_PLANNER_[A-Z_]+) \|\| ''/gm)].map(match => [match[1], match[2]]));
  const fromServe = [...(/const ENV_CONFIG = \[([\s\S]*?)\n\];/.exec(serve)?.[1] || '').matchAll(/\['([A-Z_]+)', '(DAILY_PLANNER_[A-Z_]+)'\]/g)].map(match => [match[1], match[2]]);
  assert.deepEqual(fromServe.map(([key]) => key), ['SUPPORT_EMAIL', 'PRIVACY_EMAIL', 'LEGAL_PHONE', 'LEGAL_ADDRESS', 'LEGAL_REGISTRATION', 'PROJECT_GITHUB_URL', 'GITHUB_SPONSOR_URL', 'SOCIAL_X_URL', 'SOCIAL_LINKEDIN_URL', 'GOOGLE_CLIENT_ID', 'DROPBOX_APP_KEY']);
  for (const [key, variable] of fromServe) {
    assert.equal(variable, fromBuild.get(key), `${key}: the same variable as the build`);
    assert.ok(serve.slice(0, serve.indexOf('import ')).includes(variable), `${variable} is in the header`);
  }
});

test('_redirects sends the short links to the legal pages', async () => {
  const lines = (await read('_redirects')).split('\n').map(line => line.trim());
  for (const line of ['/privacy /legal/privacy/ 301', '/terms /legal/terms/ 301', '/cookies /legal/cookies/ 301']) assert.ok(lines.includes(line), line);
  // Only the legal short links are checked here (the file also sends the old /teams and /partners addresses to the landing page).
  const legalLines = lines.filter(entry => /^\/(?:privacy|terms|cookies)\/?\s/.test(entry));
  assert.equal(legalLines.length, 6);
  for (const line of legalLines) {
    const [, to] = line.split(/\s+/);
    assert.ok(Object.keys(PAGES).includes(to.replace(/^\//, '')), `${line} points at a legal page`);
  }
});

test('the planner footer links the legal pages and Contact in a new tab, in the agreed order', async () => {
  const html = await read('index.html');
  const block = /<div class="bemorin-footer__links">([\s\S]*?)<\/div>/.exec(html)?.[1] || '';
  const links = [...block.matchAll(/<a href="([^"]+)" target="_blank" rel="noopener">([^<]+)<\/a>/g)].map(match => [match[1], match[2]]);
  assert.deepEqual(links, [['legal/privacy/', 'Privacy'], ['legal/terms/', 'Terms'], ['legal/cookies/', 'Cookies'], ['legal/', 'Legal notice'], ['contact/', 'Contact']]);
  assert.doesNotMatch(html, /bemorin\.com\/(?:privacy|terms|cookies)/);
});

const DATED = '<p class="lg-updated">Last updated: <time datetime="2026-11-10">10 November 2026</time></p>';
// What the legal pages no longer say anything about, since the planner is free and open source (1.39).
const COMMERCIAL = /creem|checkout|purchase|\bprices?\b|refund|withdrawal|plus licen|licence check|licence link|gift|partner|team (?:gift|request|order)|member price|merchant of record|\bPlus\b/i;

test('the terms: the free planner, its open-source licence and what it leaves out, the site, Personal sync, liability and changes', async () => {
  const html = await read('legal/terms/index.html');
  assert.match(html, /<title>Terms of use — Daily Planner<\/title>/);
  assert.match(html, /<h1>Terms of use<\/h1>/);
  assert.ok(html.includes(DATED), 'dated with the change');
  const toc = /<nav class="lg-toc"[\s\S]*?<\/nav>/.exec(html)[0];
  assert.deepEqual([...toc.matchAll(/<a href="#([a-z]+)">([^<]+)<\/a>/g)].map(match => match[1]), ['about', 'planner', 'licence', 'site', 'sync', 'use', 'liability', 'changes', 'law', 'contact']);
  for (const id of ['about', 'planner', 'licence', 'site', 'sync', 'use', 'liability', 'changes', 'law', 'contact']) assert.match(html, new RegExp(`<section id="${id}" aria-labelledby="${id}-title">`), id);
  assert.doesNotMatch(html, /id="(?:plus|family|gifts|payment|partners|refunds)"/, 'no sale, Plus, gift, team, refund or partner section');
  assert.doesNotMatch(text(html), COMMERCIAL);
  const licence = text(/<section id="licence"[\s\S]*?<\/section>/.exec(html)[0]);
  assert.match(licence, /Daily Planner’s source code is open source, under the MIT licence\./);
  assert.match(licence, /The licence covers the code, not the name or the logo\. “Daily Planner”, “Daily Planner by Ben Morin” and the Daily Planner logo are not licensed for reuse/);
  const site = text(/<section id="site"[\s\S]*?<\/section>/.exec(html)[0]);
  assert.match(site, /feedback from the planner, a question from the Contact page/);
  assert.match(site, /GitHub Sponsors[\s\S]*?doesn’t buy any feature or service: the planner is the same for everyone\./);
  const sync = text(/<section id="sync"[\s\S]*?<\/section>/.exec(html)[0]);
  assert.match(sync, /your own Google Drive or your own Dropbox/);
  assert.match(sync, /sealed on your device with a passphrase you choose[\s\S]*?We never receive that passphrase and can’t recover it/);
  assert.match(text(html), /French law/, 'the governing law stays');
});

test('the privacy policy: what the app still does, and nothing about payments, licences, gifts or partners', async () => {
  const html = await read('legal/privacy/index.html');
  assert.ok(html.includes(DATED));
  // Resend's company name (Plus Five Five, Inc.) is a name, not the former Plus.
  const words = text(html.replace('<small>Plus Five Five, Inc.</small>', ''));
  assert.doesNotMatch(words, COMMERCIAL);
  assert.doesNotMatch(html, /id="plus"|data-partner-days|creem\.io/i);
  const toc = /<nav class="lg-toc"[\s\S]*?<\/nav>/.exec(html)[0];
  assert.deepEqual([...toc.matchAll(/<a href="#([a-z]+)">/g)].map(match => match[1]), ['controller', 'device', 'counts', 'visits', 'waitlist', 'feedback', 'requests', 'drive', 'emails', 'providers', 'bases', 'rights', 'changes']);
  for (const fact of [
    'Your plans, journal and settings stay in your browser.',
    'Personal sync keeps your planner the same on your devices through your own Google Drive or your own Dropbox',
    'It is sealed on your device before it leaves, with a passphrase you choose: encrypted with AES-256-GCM',
    'A question asked on the Contact page stores your email address, your name and your question',
    'When you send feedback from the planner, we store your rating',
    'We keep only daily counts of those reports, with nothing about you, for about 90 days.',
    'The site sends emails through Resend, our email provider, and only for one reason to you: the one waitlist email. We also get an email ourselves when a question arrives.',
    'Hosts the site, its server code and its database'
  ]) assert.ok(words.includes(fact), fact);
  const providers = /<section id="providers"[\s\S]*?<\/section>/.exec(html)[0];
  assert.deepEqual([...providers.matchAll(/<tr><th scope="row">([^<]+)/g)].map(match => match[1].trim()), ['Cloudflare, Inc.', 'Resend', 'Google', 'Dropbox']);
});

test('the cookies page: no partner code, referral, currency or licence key any more', async () => {
  const html = await read('legal/cookies/index.html');
  assert.ok(html.includes(DATED));
  assert.doesNotMatch(html, /creem_ref|daily-planner-ui:(?:ref|partner-hints|currency|plus-[a-z-]+)|data-partner-days/);
  assert.doesNotMatch(text(html), COMMERCIAL);
  for (const key of RETIRED_KEYS) assert.ok(!html.includes(`<code>${key}</code>`), `${key}: removed by the planner, no longer listed`);
  assert.match(text(html), /Keys that earlier versions kept and this one no longer uses are removed the first time it opens\./);
  assert.match(html, /<li><a href="#others">Google and Dropbox<\/a><\/li>/);
});

test('the legal notice: no payments section, and the code’s licence beside the name and logo it leaves out', async () => {
  const html = await read('legal/index.html');
  assert.ok(html.includes(DATED));
  assert.doesNotMatch(html, /id="payments"|takes payments|payment provider/);
  assert.doesNotMatch(text(html), COMMERCIAL, 'no seller, payment provider or sale of any kind');
  assert.match(html, /<p class="lg-lead">Who publishes Daily Planner and who hosts it\.<\/p>/);
  const ip = text(/<section id="ip"[\s\S]*?<\/section>/.exec(html)[0]);
  assert.match(ip, /Its source code is open source, under the MIT licence; the name “Daily Planner”, “Daily Planner by Ben Morin” and the logo are not covered by that licence\./);
  assert.doesNotMatch(ip, /all rights reserved/i);
  assert.match(html, /Animations use <a href="https:\/\/motion\.dev" rel="noopener">Motion<\/a>, under its own open-source licence, reproduced in the <a href="\.\.\/THIRD_PARTY_NOTICES\.md">third-party notices<\/a>\./);
});

test('every “Ask a question” link in legal/ goes to the Contact page', async () => {
  for (const [folder, file] of Object.entries(PAGES)) {
    const html = await read(file);
    const asks = [...html.matchAll(/<a href="([^"]+)">“Ask a question” form<\/a>/g)].map(match => match[1]);
    assert.ok(asks.length > 0, file);
    for (const href of asks) assert.equal(resolveHref(folder, href), 'contact/', `${file}: ${href}`);
    assert.doesNotMatch(html, /ask=question|teams\/\?ask|#request"/, `${file}: nothing left pointing at the Teams page’s form`);
  }
  assert.doesNotMatch(await read('legal/legal.js'), /'welcome\/\?ask=/);
  assert.match(await read('legal/legal-details.js'), /const ASK_PATH = 'contact\/';/);
});

test('the cookies page lists every storage key the code uses', async () => {
  const cookies = await read('legal/cookies/index.html');
  // Every script of the planner, the welcome and Contact pages and the admin, so a new key can't be missed; but the
  // list of keys the planner removes once (src/state/retired-keys.js), which nothing writes any more.
  const sources = ['app.js', 'index.html', ...(await walk('src')), ...(await walk('welcome')), ...(await walk('contact')), ...(await walk('admin'))].filter(file => /\.(?:js|mjs|html)$/.test(file) && file !== 'src/state/retired-keys.js');
  assert.ok(sources.includes('src/features/tour-model.js') && sources.includes('src/features/first-use-model.js') && sources.includes('src/features/pip-window.js'), 'nested modules are read');
  const keys = new Set();
  for (const file of sources) for (const match of (await read(file)).matchAll(/['"`](daily-planner-(?:ui|sync):[a-z0-9-]+)['"`]/g)) keys.add(match[1]);
  assert.ok(keys.size >= 21, `found ${keys.size} keys`);
  for (const key of ['daily-planner-ui:tips', 'daily-planner-ui:tour', 'daily-planner-ui:share', 'daily-planner-ui:pip-view', 'daily-planner-ui:pip-size', 'daily-planner-ui:pip-unresolved']) assert.ok(keys.has(key), `${key} found in the code`);
  for (const key of RETIRED_KEYS) assert.ok(!keys.has(key), `${key}: retired, never written any more`);
  for (const key of keys) assert.ok(cookies.includes(`<code>${key}</code>`), `${key} is listed`);
  assert.match(cookies, /<code>daily-planner-recovery<\/code>/, 'the recovery snapshots (IndexedDB)');
  assert.match(cookies, /<code>daily-planner:<\/code>/, 'the planner itself');
});

test('Google’s access and account, kept on the device (1.38): listed, said what they hold, and that they stay there', async () => {
  const cookies = await read('legal/cookies/index.html');
  const privacy = await read('legal/privacy/index.html');
  const row = cookies.slice(cookies.indexOf('<th scope="row">Sync access and seal</th>'), cookies.indexOf('</tr>', cookies.indexOf('<th scope="row">Sync access and seal</th>')));
  for (const key of ['daily-planner-sync:google-access', 'daily-planner-sync:google-account']) assert.ok(row.includes(`<code>${key}</code>`), `${key} is listed with the sync access`);
  assert.match(row, /the access Google gives, kept until it runs out an hour later/);
  assert.match(row, /the address of your Google account, so that Google’s window chooses it by itself when you reconnect/);
  assert.match(row, /These stay on this device: never in a backup, never in the synced copy, never sent to us\./);
  assert.match(row, /Google’s access also goes when it runs out, after an hour\./);
  assert.doesNotMatch(cookies + privacy, /Google’s access stays in the open page|access Google grants is kept only in the open page/, 'the old words are gone');
  assert.match(privacy, /The access Google grants lasts an hour: your browser keeps it until then[^<]*<b>Reconnect<\/b>[^<]*Your browser also keeps the address of your Google account[^<]*Both stay on your device: they are never sent to us, never go into a backup or the synced copy, and disconnecting removes them\./);
});

test('the repository is open source: an MIT LICENSE, the README and CONTRIBUTING say so, and the name and logo are not licensed', async () => {
  const license = await read('LICENSE');
  assert.match(license, /^MIT License\n\nCopyright \(c\) 2026 Ben Morin\n\nPermission is hereby granted, free of charge, to any person obtaining a copy/);
  assert.match(license, /THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND/);
  assert.doesNotMatch(license, /all rights reserved|planner\.bemorin\.com/i, 'the standard licence, nothing added');
  const readme = await read('README.md');
  assert.match(readme, /\[MIT licence\]\(\.\/LICENSE\)/);
  // TRADEMARKS.md: the code is MIT; the name and the Horizon logo, and the files that carry it, are not.
  const trademarks = await read('TRADEMARKS.md');
  assert.match(trademarks, /Daily Planner's code is open source under the \[MIT licence\]\(\.\/LICENSE\)/);
  assert.match(trademarks, /The name “Daily Planner by Ben Morin” and the Horizon logo [^\n]* are not licensed for use in forks or derived products\./);
  for (const file of ['favicon.svg', 'favicon.ico', 'apple-touch-icon.png', 'pwa-192.png', 'pwa-512.png', 'welcome/og.png', 'index.html', 'src/features/quarter-print.js', 'src/features/year-review.js', 'src/features/share-image.js', 'src/features/sponsor-moment.js']) {
    assert.ok(trademarks.includes(`- \`${file}\``), `TRADEMARKS.md lists ${file}`);
    await readFile(join(root, file));
  }
  assert.match(trademarks, /give it a name of its own[^\n]*\n- give it an icon of its own/);
  assert.match(readme, /## Licence\n\nThe code is released under the \[MIT licence\]\(\.\/LICENSE\)[^\n]*\[`TRADEMARKS\.md`\]\(\.\/TRADEMARKS\.md\)/, 'linked from the licence section');
  assert.match(await read('legal/terms/index.html'), /The TRADEMARKS\.md file, which comes with the code beside LICENSE, lists the files that carry the logo\./);
  assert.match(readme, /The name “Daily Planner by Ben Morin” and the Daily Planner logo \(`favicon\.svg`, the app icons and `welcome\/og\.png`\) are not licensed for reuse/);
  assert.match(readme, /https:\/\/github\.com\/sponsors\/bemorin/, 'the sponsor link, documented');
  assert.match(readme, /node scripts\/serve\.mjs/);
  assert.match(readme, /migrations\/schema\.sql/);
  assert.match(await read('CONTRIBUTING.md'), /released under the project's \[MIT licence\]\(\.\/LICENSE\)/);
  assert.match(await read('SECURITY.md'), /GitHub's private vulnerability reporting/);
  for (const file of ['README.md', 'CONTRIBUTING.md', 'ARCHITECTURE.md', 'docs/CLOUD_BOUNDARY.md']) {
    assert.doesNotMatch(await read(file), /all rights reserved|source code is private|repository is private|polyform|source-available/i, `${file} still says the code is private`);
  }
  const notices = await read('THIRD_PARTY_NOTICES.md');
  assert.match(notices, /^Daily Planner itself is by Ben Morin, released under the MIT licence/m);
  assert.match(notices, /## Motion[\s\S]*Permission is hereby granted/, 'Motion’s licence, reproduced');
  assert.doesNotMatch(notices, /creem/i, 'the payment window’s embed is gone');
});
