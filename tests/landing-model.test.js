import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { LANDING_EVENTS } from '../src/lib/planner-api.js';
import { LANDING_COUNTED } from '../welcome/landing-model.js';
import { projectLinks } from '../welcome/page-kit.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = rel => readFile(join(root, rel), 'utf8');

// The public pages and every module they load from welcome/.
const PUBLIC_FILES = ['welcome/index.html', 'welcome/landing.js', 'welcome/landing.css', 'welcome/landing-model.js', 'welcome/landing-settings.js', 'welcome/page-kit.js',
  'welcome/privacy-dialog.js', 'welcome/palette-card.js', 'welcome/contact-form.js', 'welcome/contact-model.js', 'contact/index.html', 'contact/contact.js', 'contact/contact.css'];

const section = (page, id) => {
  const start = page.indexOf(`id="${id}"`);
  return page.slice(start, page.indexOf('</section>\n\n    <section', start));
};

test('every count the public pages send is one the landing page lists, and every one it lists is sent', async () => {
  const sources = await Promise.all(['welcome/landing.js', 'contact/contact.js', 'welcome/contact-form.js'].map(read));
  const used = new Set();
  for (const source of sources) {
    for (const match of source.matchAll(/\b(?:trackEvent|track)\(\s*'([a-z0-9_]+)'\s*\)/g)) used.add(match[1]);
  }
  assert.deepEqual([...used].sort(), [...LANDING_COUNTED].sort(), 'LANDING_COUNTED is exactly what the pages send');
  const known = new Set(LANDING_EVENTS.map(([name]) => name));
  LANDING_COUNTED.forEach(name => assert.ok(known.has(name), `${name} is counted by the API client (LANDING_EVENTS)`));
});

test('the landing page is about a free, open-source planner: no price, no buying, no Plus', async () => {
  const page = await read('welcome/index.html');
  assert.doesNotMatch(page, /€|\$\d|\bprices?\b|\bpricing\b|\bbuy (?:it|plus|now)\b|\bpurchase|checkout|on sale|\bsales\b|\blicen[cs]e (?:or|key)|gift|partner|team plan|for life|upgrade|premium/i,
    'no price, purchase, gift or partner wording');
  assert.doesNotMatch(page, /\bPlus\b/, 'the word Plus is gone');
  assert.doesNotMatch(page, /id="(?:plus|pricing|teams|request|team-prices|seats|gifts)"|data-compare|data-plus-|data-gift-|data-launch|data-buy/, 'no Plus, pricing, comparison or buying parts');
  assert.doesNotMatch(page, /href="[^"]*(?:teams|partners|thanks)\/|href="#(?:plus|pricing)"/, 'no link to a removed page or section');
  assert.match(page, /<h2 id="open-title">Yours to use, to read and to keep\.<\/h2>/);
  assert.match(page, /open source under the MIT licence/);
  for (const promise of ['All of it, for everyone', 'No account', 'Plans that stay on your device', 'Personal sync, sealed', 'Open source, MIT']) {
    assert.ok(section(page, 'open').includes(`<b>${promise}</b>`), promise);
  }
  assert.match(section(page, 'open'), /Plan your year with the misogi, quarterly check-ins, your year in review, Insights and every palette/);
});

test('what used to be Plus is part of the planner: the yearly ritual, with its previews', async () => {
  const page = await read('welcome/index.html');
  const ritual = section(page, 'ritual');
  assert.match(ritual, /<p class="kicker">[\s\S]*?The yearly ritual<\/p>/);
  assert.match(ritual, /A ritual for every year, built into the planner/);
  for (const title of ['Plan your year', 'Print it, fill it in by hand', 'Check in every quarter', 'Your year in review', 'Insights']) {
    assert.ok(ritual.includes(`<h3 class="h3-lg">${title}</h3>`), title);
  }
  for (const scene of ['yearplan', 'print', 'quarter', 'review', 'insights']) assert.ok(ritual.includes(`data-scene="${scene}"`), `the ${scene} replica stays`);
  assert.ok(ritual.includes('data-palette-card'), 'the palettes stay, all of them');
  assert.match(ritual, /<span class="rp-eyebrow rp-eyebrow--year">Plan your year<\/span>/);
  assert.match(ritual, /<p class="ritual-tag">All year long<\/p>/);
  assert.match(page, /<a class="hero__news" href="#ritual">/, 'the hero’s news leads to the ritual');
});

test('the sections alternate, and the top bar leads to them', async () => {
  const page = await read('welcome/index.html');
  const order = [...page.matchAll(/<section class="(?:hero|section)[^"]*" id="([a-z]+)"/g)].map(match => match[1]);
  assert.deepEqual(order, ['top', 'how', 'progress', 'week', 'tools', 'year', 'yours', 'ritual', 'open', 'faq']);
  const tinted = [...page.matchAll(/<section class="((?:hero|section)[^"]*)" id="([a-z]+)"/g)].map(match => match[1].includes('section--tint'));
  tinted.forEach((tint, index) => assert.ok(!(tint && tinted[index + 1]), `two tinted sections touch at ${order[index]}`));
  const nav = page.slice(page.indexOf('<nav class="top__nav"'), page.indexOf('</nav>', page.indexOf('<nav class="top__nav"')));
  assert.deepEqual([...nav.matchAll(/<a href="#([a-z]+)">([^<]+)<\/a>/g)].map(match => [match[1], match[2]]), [['how', 'How it works'], ['year', 'Your year'], ['open', 'Open source'], ['faq', 'FAQ']]);
  const contactNav = await read('contact/index.html');
  assert.match(contactNav, /<a href="\.\.\/welcome\/#open">Open source<\/a>/, 'the Contact page’s top bar leads to the same sections');
});

test('the FAQ: free and open source, with no buying questions', async () => {
  const page = await read('welcome/index.html');
  const faq = section(page, 'faq');
  const groups = [...faq.matchAll(/<h3 class="faq__label">([^<]+)<\/h3>/g)].map(match => match[1]);
  assert.deepEqual(groups, ['The planner', 'Open source']);
  const questions = [...faq.matchAll(/<summary>([^<]+)<\/summary>/g)].map(match => match[1]);
  for (const question of ['Is it really free?', 'Is Personal sync safe?', 'Which clouds can I sync with?', 'Is Daily Planner open source?', 'Why is it free?', 'Can I run my own copy?']) {
    assert.ok(questions.includes(question), question);
  }
  assert.doesNotMatch(faq, /Plus|gift|licence or|for life|team plans|on sale/i);
  assert.match(faq, /The name “Daily Planner by Ben Morin” and its logo aren’t covered by that licence/);
});

test('the JSON-LD says the app is free, with no offer', async () => {
  const page = await read('welcome/index.html');
  const block = page.slice(page.indexOf('<script type="application/ld+json">') + 35, page.indexOf('</script>', page.indexOf('<script type="application/ld+json">')));
  const data = JSON.parse(block);
  assert.equal(data['@type'], 'SoftwareApplication');
  assert.equal(data.isAccessibleForFree, true);
  assert.equal(data.offers, undefined, 'no Offer');
  assert.doesNotMatch(block, /Offer|price/i);
  assert.equal(data.license, 'https://opensource.org/license/mit');
});

test('the source code and GitHub Sponsors show only when the configuration sets them, https only', async () => {
  const config = values => key => values[key] || '';
  assert.deepEqual(projectLinks(config({})), { github: '', sponsor: '' }, 'blank in the repository: neither shows');
  assert.deepEqual(projectLinks(config({ PROJECT_GITHUB_URL: 'https://github.com/bemorin/planner', GITHUB_SPONSOR_URL: 'https://github.com/sponsors/bemorin' })),
    { github: 'https://github.com/bemorin/planner', sponsor: 'https://github.com/sponsors/bemorin' });
  assert.deepEqual(projectLinks(config({ PROJECT_GITHUB_URL: 'http://github.com/x', GITHUB_SPONSOR_URL: 'javascript:alert(1)' })), { github: '', sponsor: '' }, 'never anything but https');
  assert.deepEqual(projectLinks(config({ GITHUB_SPONSOR_URL: '  https://github.com/sponsors/bemorin  ' })).sponsor, 'https://github.com/sponsors/bemorin', 'trimmed');

  const page = await read('welcome/index.html');
  const links = [...page.matchAll(/<a [^>]*data-config-link="(github|sponsor)"[^>]*>/g)];
  assert.ok(links.some(match => match[1] === 'github') && links.some(match => match[1] === 'sponsor'));
  links.forEach(([tag]) => {
    assert.doesNotMatch(tag, /href=/, 'no address in the page: it comes from the configuration');
    assert.match(tag, /target="_blank" rel="noopener"/);
  });
  // A link on its own waits hidden; a link inside a sentence waits with its sentence.
  assert.match(page, /<a class="btn btn--ghost" data-config-link="github" target="_blank" rel="noopener" hidden>[\s\S]*?Source code on GitHub<\/a>/);
  assert.match(page, /<a class="btn btn--ghost" data-config-link="sponsor" target="_blank" rel="noopener" hidden>[\s\S]*?Sponsor on GitHub<\/a>/);
  for (const match of page.matchAll(/<span data-config-show="(github|sponsor)"([^>]*)>/g)) assert.match(match[2], /hidden/, `${match[1]}: its sentence waits hidden`);
  const script = await read('welcome/landing.js');
  assert.match(script, /renderProjectLinks\(\);/, 'landing.js fills them in');
  const kit = await read('welcome/page-kit.js');
  assert.match(kit, /PROJECT_LINKS = Object\.freeze\(\{ github: 'PROJECT_GITHUB_URL', sponsor: 'GITHUB_SPONSOR_URL' \}\)/, 'read as the other pages read runtime config');
});

test('no payment provider, currency or partner code is left on the public pages', async () => {
  for (const file of PUBLIC_FILES) {
    const source = await read(file);
    assert.doesNotMatch(source, /stripe|creem|checkout|pricing\.js|plus\.js|currency|rememberReferral|referralCode|SALES_OPEN|PARTNER_PROGRAM|\?ref=/i, file);
  }
});

test('the welcome pages have no native dropdowns', async () => {
  for (const file of ['welcome/index.html', 'contact/index.html']) {
    const page = await read(file);
    assert.doesNotMatch(page, /<select\b/i, `${file}: no native dropdown`);
    assert.doesNotMatch(page, /data-cur(?:rency)?[\s>=]/, `${file}: no currency switch`);
  }
  assert.match(await read('welcome/landing-settings.js'), /supportEmail: ''/, 'the support address stays blank in the source');
});
