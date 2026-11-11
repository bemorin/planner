import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

import { CONTACT_SOURCES, QUESTION_MESSAGE_MAX, validateContact } from '../server/planner-api.js';
import { CONTACT_COPY, CONTACT_ROUTE, CONTACT_SOURCE, EMAIL_FIELD, MESSAGE_MAX, cardFollows, contactAddress, movedAddress, questionEmail, questionPayload, sameSiteHref } from '../welcome/contact-model.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = file => readFile(join(root, file), 'utf8');

/**
 * Runs the inline <head> script of a page against an address: where it sent
 * the page ('' when it stayed) and the classes it put on <html>.
 */
async function runHead(file, address, { reduce = false } = {}) {
  const page = await read(file);
  const code = /<script>\s*([\s\S]*?)<\/script>/.exec(page)[1];
  const url = new URL(address, 'https://planner.bemorin.com');
  let target = '';
  // The scripts go only to a full address on the site's own origin (1.35): shown here from the path on.
  const location = { href: url.href, origin: url.origin, pathname: url.pathname, search: url.search, hash: url.hash, replace: to => { target = to.startsWith(`${url.origin}/`) ? to.slice(url.origin.length) : to; } };
  const classes = new Set();
  const documentElement = { classList: { add: (...names) => names.forEach(name => classes.add(name)), remove: (...names) => names.forEach(name => classes.delete(name)), contains: name => classes.has(name) } };
  vm.runInNewContext(code, {
    window: { location, matchMedia: () => ({ matches: reduce }), IntersectionObserver: class {}, setTimeout: () => 0 },
    document: { documentElement },
    URL,
    URLSearchParams
  });
  return { target, classes: [...classes].sort() };
}

test('the Contact page: its own address, the welcome pages’ head, header and footer', async () => {
  const page = await read('contact/index.html');
  assert.match(page, /<title>Contact — Daily Planner<\/title>/);
  assert.match(page, /<link rel="canonical" href="https:\/\/planner\.bemorin\.com\/contact\/">/);
  assert.match(page, /<meta property="og:url" content="https:\/\/planner\.bemorin\.com\/contact\/">/);
  for (const meta of ['description', 'og:title', 'og:description', 'og:image', 'twitter:card', 'twitter:title', 'twitter:image']) assert.match(page, new RegExp(`(?:property|name)="${meta}" content="[^"]+"`), meta);
  assert.match(page, /<meta name="color-scheme" content="light dark">/);
  assert.match(page, /<link rel="stylesheet" href="\.\.\/welcome\/landing\.css">\n {2}<link rel="stylesheet" href="\.\/contact\.css">/, 'its own styles, after the landing page’s');
  assert.ok(page.indexOf("classList.add('js-anim')") < page.indexOf('../welcome/landing.css'), 'motion armed before the styles');
  assert.ok(page.indexOf('<script src="../runtime-config.js">') > 0 && page.indexOf('../runtime-config.js') < page.indexOf('./contact.js'), 'the runtime config first');
  assert.match(page, /<script type="module" src="\.\/contact\.js"><\/script>/);
  assert.match(page, /<body class="contact-page">/);
  const data = JSON.parse(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/.exec(page)[1]);
  assert.equal(data['@type'], 'ContactPage');
  assert.equal(data.url, 'https://planner.bemorin.com/contact/');
  assert.equal(data.isPartOf.url, 'https://planner.bemorin.com/');
  const nav = /<nav class="top__nav"[\s\S]*?<\/nav>/.exec(page)[0];
  // The landing page's sections: no Teams, Pricing, Partners or Plus.
  assert.deepEqual([...nav.matchAll(/<a href="([^"]+)"/g)].map(match => match[1]), ['../welcome/#how', '../welcome/#year', '../welcome/#open', '../welcome/#faq']);
  assert.match(page, /<a class="brand" href="\.\.\/welcome\/"/);
  assert.match(page, /<a class="btn btn--primary btn--sm" href="\.\.\/\?start" data-cta="app">Open the planner<\/a>/);
  // The footer repeats nothing from the top bar (1.32): the brand, the social links once set, the legal pages and Contact (this page).
  const foot = /<footer class="foot">[\s\S]*?<\/footer>/.exec(page)[0];
  assert.match(foot, /<nav class="foot__links" aria-label="Social links" hidden>\s*<span class="foot__social" data-social hidden><\/span>\s*<\/nav>/);
  assert.deepEqual([...foot.matchAll(/<a [^>]*>([^<]+)<\/a>/g)].map(match => match[1]), ['Ben Morin', 'Privacy', 'Terms', 'Cookies', 'Legal notice', 'Contact']);
  assert.match(foot, /<\/nav>\n {8}<a href="\.\/" aria-current="page">Contact<\/a>\n {6}<\/div>/, 'Contact after the legal pages, marked as this page');
  assert.doesNotMatch(foot, /data-support|Open the planner|Ask a question/);
  const legal = /<nav class="foot__legal"[\s\S]*?<\/nav>/.exec(page)[0];
  assert.deepEqual([...legal.matchAll(/<a href="([^"]+)">([^<]+)<\/a>/g)].map(match => [match[1], match[2]]), [['../legal/privacy/', 'Privacy'], ['../legal/terms/', 'Terms'], ['../legal/cookies/', 'Cookies'], ['../legal/', 'Legal notice']]);
  assert.match(page, /<a class="foot__counts" href="\.\.\/welcome\/#privacy" data-counts-link hidden>/);
  // Every icon it uses is in its sprite, every in-page link has its target.
  const ids = new Set([...page.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]));
  for (const [, target] of page.matchAll(/<use href="#([^"]+)"/g)) assert.ok(ids.has(target), `icon ${target}`);
  for (const [, target] of page.matchAll(/<a [^>]*href="#([^"]+)"/g)) assert.ok(ids.has(target), `#${target}`);
});

test('the Contact page’s form is the question form: an email, a name and the question', async () => {
  const page = await read('contact/index.html');
  const form = /<form class="ask-form ct-form"[\s\S]*?<\/form>/.exec(page)?.[0] || '';
  assert.ok(form, 'the question form’s markup, on a light card');
  assert.match(form, /data-contact-form novalidate aria-labelledby="contact-title" aria-describedby="contact-intro"/);
  assert.doesNotMatch(form, /data-kind|data-team-field|data-listbox|team-form|name="(?:kind|company|plan|teamSize|timing)"/);
  assert.deepEqual([...form.matchAll(/\sname="([a-zA-Z]+)"/g)].map(match => match[1]), ['email', 'name', 'message', 'website'], 'no consent box: replying is what the form is for');
  assert.match(form, new RegExp(`<textarea name="message" rows="6" maxlength="${MESSAGE_MAX}" required`));
  assert.equal(MESSAGE_MAX, QUESTION_MESSAGE_MAX, 'the server takes as long a question as the form');
  assert.match(form, new RegExp(`<span>${EMAIL_FIELD.label}</span><input type="email" name="email" autocomplete="email" required maxlength="254" placeholder="${EMAIL_FIELD.placeholder.replace('.', '\\.')}"`));
  assert.doesNotMatch(form, /consent|type="checkbox"/);
  // Instead, one short information notice: what is kept, why, for how long, deleted on request, and where to read more (tests/request-notice.test.js).
  assert.match(form, /<p class="form-privacy" data-privacy-line hidden>What you send is kept only to reply to you and follow up, and deleted whenever you ask\. <a href="\.\.\/legal\/privacy\/#requests">How questions are handled<\/a><\/p>/);
  assert.match(form, /data-mailto-line hidden>/);
  assert.match(form, new RegExp(`<button class="btn btn--light btn--send" type="submit" data-form-submit disabled>${CONTACT_COPY.submit}</button>`));
  assert.match(page, /<div class="wrap ct__grid" data-form-panel>/);
  assert.match(page, new RegExp(`data-form-done hidden tabindex="-1"[\\s\\S]*?data-form-again>${CONTACT_COPY.again}<`));
  // The page's head, written in, so it reads the same without JavaScript.
  assert.match(page, new RegExp(`<span>${CONTACT_COPY.kicker}</span></p>`));
  assert.match(page, new RegExp(`<h1 id="contact-title">${CONTACT_COPY.title}</h1>`));
  assert.ok(page.includes(`<p class="lead" id="contact-intro">${CONTACT_COPY.intro}</p>`));
  assert.doesNotMatch(page, /Plus|purchase|partner|team gift|pricing|data-form-(?:kicker|title|intro)/i, 'nothing about buying, partners or teams');
});

test('the Contact page points to Help; the addresses only when they are set', async () => {
  const page = await read('contact/index.html');
  const more = /<section class="ct__more"[\s\S]*?<\/section>/.exec(page)[0];
  assert.match(more, /<h2 id="ct-more-title">Before you write<\/h2>/);
  assert.deepEqual([...more.matchAll(/<a class="ct-link"([^>]*)>[\s\S]*?<b>([^<]+)<\/b>/g)].map(match => [/href="([^"]*)"/.exec(match[1])?.[1] || '', match[2]]), [
    ['../?help', 'Help in the planner'],
    ['', 'Your data']
  ]);
  assert.match(more, /<li data-privacy-contact hidden>/, 'the privacy address waits for PRIVACY_EMAIL');
  assert.match(page, /<p class="ct__alt" data-support-alt hidden>[\s\S]*?Prefer email\? Write to <a data-support-link><\/a>\.<\/span><\/p>/, 'the plain address waits for SUPPORT_EMAIL');
  assert.doesNotMatch(page.replace('placeholder="you@example.com"', ''), /mailto:|@[a-z0-9-]+\.[a-z]/i, 'no address written into the page');
  const script = await read('contact/contact.js');
  assert.match(script, /configEmail\(LANDING\.supportEmail, configText\('SUPPORT_EMAIL'\)\)/, 'the setting first, then the build variable');
  assert.match(script, /configEmail\(configText\('PRIVACY_EMAIL'\)\)/);
  assert.match(script, /return EMAIL_RE\.test\(email\) \? email : '';/, 'a plain address, or nothing');
  assert.match(script, /link\.textContent = support;/);
  assert.match(script, /textContent = privacy;/);
  assert.doesNotMatch(script, /innerHTML/);
});

test('the Contact page’s script: the question form, the addresses, motion; no partner code', async () => {
  const script = await read('contact/contact.js');
  assert.match(script, /createContactForm\(\{ settings: LANDING, source: CONTACT_SOURCE \}\);/);
  for (const call of ['followCard();', 'setupTopBar();', 'renderFooter();', 'setupReveal({ motionOn: motionWanted(), motionHooks });', 'followMotion(motionHooks);', "html.classList.add('js-ready');", "track('landing_cta_app')"]) assert.ok(script.includes(call), call);
  assert.doesNotMatch(script, /rememberReferral|referralCode|contactTopic|topic/, 'no partner link, no topic');
  const form = await read('welcome/contact-form.js');
  assert.match(form, /export function createContactForm\(\{ settings, source = CONTACT_SOURCE \}\)/);
  assert.match(form, /fetch\(`\$\{PLANNER_API_URL\}\/\$\{CONTACT_ROUTE\}`/, 'posted to the API’s contact route');
  assert.doesNotMatch(form, /referralCode|createListbox|createStepper|currency|\bplan\b|teamSize|company/, 'nothing but the question');
  assert.equal(CONTACT_COPY.submit, 'Send the question');
});

test('its questions go to POST /api/contact, as a source the server keeps', async () => {
  assert.equal(CONTACT_ROUTE, 'contact');
  assert.match(await read('server/planner-api.js'), /if \(path === 'contact'\) return await contactRoute\(request, body, url, cors\);/, 'the server has the route');
  assert.equal(CONTACT_SOURCE, 'contact');
  assert.ok(CONTACT_SOURCES.has(CONTACT_SOURCE));
  const values = { email: 'ann@example.com', name: 'Ann', message: 'How do I print my year?', website: '' };
  const body = questionPayload(values, { version: '1.39.0', locale: 'fr-FR' });
  assert.deepEqual(body, { email: 'ann@example.com', name: 'Ann', message: 'How do I print my year?', website: '', version: '1.39.0', locale: 'fr-FR', source: 'contact', kind: 'question' });
  const stored = validateContact(body, new Date('2026-11-10T09:00:00Z')).entry;
  assert.deepEqual([stored.email, stored.name, stored.message, stored.source, stored.appVersion], ['ann@example.com', 'Ann', 'How do I print my year?', 'contact', '1.39.0']);
  assert.equal(validateContact({ ...body, website: 'https://spam.example' }).spam, true, 'the hidden field only robots fill in');
  // Without the API: the same question as an email.
  assert.deepEqual(questionEmail(values), { subject: 'Daily Planner — Question from Ann', lines: ['Name: Ann', 'Email: ann@example.com', '', 'How do I print my year?'] });
  assert.deepEqual(questionEmail({ ...values, message: '' }).lines, ['Name: Ann', 'Email: ann@example.com']);
});

test('an old address asking for the question form leads to the Contact page, before first paint', async () => {
  const cases = [
    ['/welcome/?ask=question', '/contact/'],
    ['/welcome/?ask=question#request', '/contact/'],
    ['/welcome/index.html?ref=REFEXAMPLE&ask=question&plan=up-to-50#request', '/contact/?ref=REFEXAMPLE'],
    ['/welcome/?ask=invoice#request', ''],
    ['/welcome/?ask=quote&plan=over-1000', ''],
    ['/welcome/', ''],
    ['/welcome/#faq', '']
  ];
  for (const [from, to] of cases) {
    const url = new URL(from, 'https://planner.bemorin.com');
    assert.equal(contactAddress({ path: url.pathname, search: url.search }), to, from);
    assert.equal(movedAddress({ path: url.pathname, search: url.search }), to, from);
    const head = await runHead('welcome/index.html', from);
    assert.equal(head.target, to, `welcome head script: ${from}`);
    assert.deepEqual(head.classes, to ? [] : ['js-anim'], `the entrances are armed only when the page stays: ${from}`);
  }
  // A planner served from a folder keeps it.
  assert.equal(contactAddress({ path: '/planner/welcome/', search: '?ask=question' }), '/planner/contact/');
  assert.equal(contactAddress(), '');
  // Only ever to this site.
  assert.equal(sameSiteHref('/contact/', 'https://planner.bemorin.com/welcome/'), 'https://planner.bemorin.com/contact/');
  assert.equal(sameSiteHref('//other.example/contact/', 'https://planner.bemorin.com/welcome/'), '');
  assert.equal(sameSiteHref('', 'https://planner.bemorin.com/welcome/'), '');
});

test('the Contact page’s head script: motion as on the other pages, nothing else', async () => {
  assert.deepEqual((await runHead('contact/index.html', '/contact/')).classes, ['js-anim']);
  assert.deepEqual((await runHead('contact/index.html', '/contact/', { reduce: true })).classes, []);
  assert.deepEqual((await runHead('contact/index.html', '/contact/?topic=partners')).classes, ['js-anim'], 'an old ?topic= changes nothing');
  assert.equal((await runHead('contact/index.html', '/contact/?topic=partners')).target, '', 'the page stays');
  const page = await read('contact/index.html');
  assert.match(page, /window\.setTimeout\(function \(\) \{ if \(!root\.classList\.contains\('js-ready'\)\) root\.classList\.remove\('js-anim'\); \}, 4000\);/, 'without the script, everything shows after 4 s');
  assert.doesNotMatch(page, /js-topic|partners/);
  assert.doesNotMatch(await read('contact/contact.css'), /js-topic/);
});

test('the Contact page’s styles: the landing page’s parts, light and dark, no motion when it is not wanted', async () => {
  const css = await read('contact/contact.css');
  assert.doesNotMatch(css, /!important/);
  // The form sits on a light card: the band's tokens take the page's colours, in both themes.
  for (const token of ['--band-bg: var(--surface-strong);', '--band-ink: var(--ink);', '--band-muted: var(--muted);', '--band-field: var(--paper);', '--band-accent: var(--focus);', '--band-error: var(--danger);']) assert.ok(css.includes(token), token);
  assert.match(css, /@media \(prefers-color-scheme: dark\)/);
  assert.doesNotMatch(css, /#[0-9a-f]{3,8}\b/i, 'colours come from the tokens');
  // Every animation and transition waits for prefers-reduced-motion: no-preference.
  const outside = css.replace(/@media (?:screen and )?\(prefers-reduced-motion: no-preference\) \{[\s\S]*?\n\}/g, '');
  assert.doesNotMatch(outside, /\b(?:animation|transition):/);
  assert.match(css, /\.ct__intro > \*,\n {2}\.ct__card \{ animation: rise-in 820ms/);
  assert.match(await read('welcome/landing.css'), /@keyframes rise-in \{/);
  assert.match(css, /grid-template-areas: "intro card" "more card";/, 'side by side from 960px');
});

test('the Contact page is published and revalidated like the other pages', async () => {
  const { PUBLISHED_FOLDERS } = await import('../scripts/published.mjs');
  assert.ok(PUBLISHED_FOLDERS.includes('contact'));
  assert.match(await read('scripts/build.mjs'), /for \(const folder of PUBLISHED_FOLDERS\.filter\(name => name !== 'src'\)\) await copyTree\(folder\);/);
  assert.match(await read('_headers'), /\n\/contact\/\n {2}Cache-Control: no-cache\n/);
  const lines = (await read('_redirects')).split('\n').map(line => line.trim());
  assert.ok(!lines.some(line => /^\/contact/.test(line)), '/contact/ is a page, not a redirect');
});

test('from 960px the card keeps to the window as the page scrolls, only when all of it fits', async () => {
  // 64px top bar, 24px from it and from the bottom of the window.
  assert.equal(cardFollows({ card: 555, viewport: 900, topBar: 64 }), true);
  assert.equal(cardFollows({ card: 555, viewport: 667, topBar: 64 }), true, 'exactly enough room');
  assert.equal(cardFollows({ card: 555, viewport: 666, topBar: 64 }), false, 'a taller card would hide its own button');
  assert.equal(cardFollows({ card: 0, viewport: 900, topBar: 64 }), false, 'nothing measured, nothing to follow');
  assert.equal(cardFollows(), false);
  const css = await read('contact/contact.css');
  const wide = css.slice(css.indexOf('/* From 960px the card keeps to the window'));
  assert.match(wide, /@media \(min-width: 960px\) \{\n {2}\.ct \{ padding-bottom: 40px; \}/, 'the card stops 40px above the footer, never on its hairline…');
  assert.match(wide, /grid-template-rows: auto 1fr max\(0px, clamp\(64px, 8vw, 112px\) - 88px\);\n {4}grid-template-areas: "intro card" "more card" "\. \.";/, '…after sliding through the row gap and a last, empty row (48px + that row + 40px: the space as before)');
  assert.match(wide, /\.ct__card\.is-following \{ position: sticky; top: calc\(var\(--top-h\) \+ 24px\); \}\n\}/, 'below the top bar, at desktop widths only');
  assert.match(css, /padding: clamp\(32px, 6vw, 88px\) 0 clamp\(64px, 8vw, 112px\);/, 'the same space as before, on phones too');
  assert.match(css, /body\.contact-page \{ padding-bottom: 0; \}/, 'no room kept under the footer for a dock this page doesn’t have');
  const script = await read('contact/contact.js');
  assert.match(script, /card\.classList\.toggle\('is-following', cardFollows\(\{ card: card\.offsetHeight, viewport: window\.innerHeight, topBar: top\?\.offsetHeight \|\| 0 \}\)\)/);
  assert.match(script, /new ResizeObserver\(check\)\.observe\(card\);\n {2}window\.addEventListener\('resize', check, \{ passive: true \}\);/, 'checked on resize, never on scroll');
  assert.doesNotMatch(script, /addEventListener\('scroll'/);
});

test('the card has no rule above its fine print and button: they follow the question, a little apart (1.33.2)', async () => {
  const css = await read('contact/contact.css');
  assert.match(css, /^\.ct-form \.ask-form__foot \{ margin-top: 6px; padding-top: 0; border-top: 0; \}$/m);
  // Nothing else draws a line across the card's form.
  assert.doesNotMatch(css.replace(/^\.ct-form \.ask-form__foot \{[^}]*\}$/m, ''), /\.ct-form[^{]*\{[^}]*border-(?:top|bottom)(?!-color)[^}]*\}/);
});
