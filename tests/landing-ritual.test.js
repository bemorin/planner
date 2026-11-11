import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { LANDING_EVENTS } from '../src/lib/planner-api.js';
import { LANDING_COUNTED, countedMoments, landingMoments, monthWeeks, ritualYear } from '../welcome/landing-model.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = file => readFile(join(root, file), 'utf8');

test('the ritual is about next year from 1 October on, else this year', () => {
  assert.equal(ritualYear(new Date(2026, 8, 30, 23, 59)), 2026, '30 September: this year');
  assert.equal(ritualYear(new Date(2026, 9, 1, 0, 0)), 2027, '1 October: the next one');
  assert.equal(ritualYear(new Date(2026, 11, 31)), 2027);
  assert.equal(ritualYear(new Date(2027, 0, 1)), 2027, 'January: the year that just started');
  assert.equal(ritualYear(new Date(2027, 5, 15)), 2027);
  assert.equal(typeof ritualYear(new Date('nope')), 'number', 'an invalid date falls back to today');
});

test('a printed month: weeks of seven from Monday, blanks around the days', () => {
  const march = monthWeeks(2027, 2);
  assert.ok(march.every(week => week.length === 7));
  assert.deepEqual(march[0], [1, 2, 3, 4, 5, 6, 7], 'March 2027 starts on a Monday');
  assert.deepEqual(march.flat().filter(Boolean).length, 31);
  const february = monthWeeks(2027, 1);
  assert.deepEqual(february.flat().filter(Boolean).length, 28);
  assert.deepEqual(monthWeeks(2028, 1).flat().filter(Boolean).length, 29, 'a leap year');
  const may = monthWeeks(2027, 4);
  assert.deepEqual(may[0], [null, null, null, null, null, 1, 2], 'May 2027 starts on a Saturday');
  assert.equal(may.flat().at(-1), null, 'the last week is padded');
  assert.deepEqual(monthWeeks(2027, 4, 0)[0], [null, null, null, null, null, null, 1], 'Sunday first');
});

test('the privacy dialog lists every moment the landing page counts, once each, and nothing it doesn’t send', () => {
  const sent = landingMoments(LANDING_EVENTS);
  assert.deepEqual(sent.map(([name]) => name), LANDING_COUNTED, 'every moment the page sends is one the API client counts, in order');
  const moments = countedMoments(sent);
  assert.equal(moments.length, LANDING_COUNTED.length);
  sent.forEach(([, words]) => assert.ok(moments.includes(words), words));
  assert.deepEqual(landingMoments([['landing_viewed', 'visited'], ['team_request_sent', 'sent a request'], ['plus_viewed', 'scrolled'], null]), [['landing_viewed', 'visited']], 'a moment the page never sends is left out');
  assert.deepEqual(landingMoments(undefined), []);
  assert.deepEqual(countedMoments([['a', 'one'], ['b', 'one'], ['c', ' '], null]), ['one']);
  assert.deepEqual(countedMoments(undefined), []);
});

test('legal pages are linked on this site, in order, in the same tab', async () => {
  const pages = [['welcome/index.html', '../legal/'], ['contact/index.html', '../legal/']];
  for (const [file, base] of pages) {
    const page = await read(file);
    assert.doesNotMatch(page, /bemorin\.com\/(?:privacy|terms|cookies)/, `${file}: no legal link to the old site`);
    const legal = page.slice(page.indexOf('class="foot__legal"'), page.indexOf('</nav>', page.indexOf('class="foot__legal"')));
    const links = [...legal.matchAll(/<a href="([^"]+)"[^>]*>([^<]+)<\/a>/g)].map(match => [match[1], match[2]]);
    assert.deepEqual(links, [[`${base}privacy/`, 'Privacy'], [`${base}terms/`, 'Terms'], [`${base}cookies/`, 'Cookies'], [base, 'Legal notice']], file);
    assert.doesNotMatch(legal, /target=/, `${file}: same tab`);
  }
});

test('the landing page: privacy in a dialog, devices up front, the year computed', async () => {
  const page = await read('welcome/index.html');
  assert.doesNotMatch(page, /class="wrap foot__privacy"/, 'no always-visible privacy paragraph');
  assert.match(page, /<dialog class="pv"[^>]*id="privacy"[^>]*aria-labelledby="privacy-title"/);
  assert.match(page, /href="\.\.\/legal\/privacy\/"[^>]*>Read the full privacy policy</);
  assert.match(page, /data-privacy-open[^>]*hidden/, 'the footer entry waits for the owner API');
  assert.match(page, /data-privacy-section="requests"[\s\S]*?<h3 id="pv-requests" tabindex="-1">Questions<\/h3>/, 'the dialog has its part on questions');
  assert.doesNotMatch(page, /data-privacy-section="(?:prices|purchases)"|data-privacy-sales|data-privacy-paused|data-partner-days/, 'nothing about prices, purchases or partner links');
  assert.match(page, /On your computer, tablet and phone/);
  assert.match(page, /Installs like an app, on your computer, tablet and phone/);
  assert.match(page, /Make <span data-plan-year>2027<\/span> count\./);
  // Every year written into the page for the ritual is filled in by landing.js.
  const plain = page.replace(/<span data-plan-year(?: data-year-offset="-?\d")?>20\d\d<\/span>/g, '').replace(/<b[^>]*data-plan-year[^>]*>20\d\d<\/b>/g, '');
  assert.doesNotMatch(plain, /Plan 2027|Make 2027|2027, one step|Print 2027/);
});

test('the landing and the planner agree on the year to plan, every day of two years', async () => {
  const { defaultPlanYear } = await import('../src/features/year-plan.js');
  for (let day = new Date(2026, 0, 1); day < new Date(2028, 0, 1); day = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1)) {
    assert.equal(ritualYear(day), defaultPlanYear(day), day.toDateString());
  }
});
