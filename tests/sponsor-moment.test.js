import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  createSponsorMoment, DAY_MARKS, recapFigures, recapFromStore, recapTitle, renderSponsorMoment, renderSponsorThanks,
  shareOrCopy, SHARE_TEXT, shouldOfferSponsor, siteUrl, SPONSOR_AFTER_CLOSED_DAYS, sponsorPage, sponsorRecap
} from '../src/features/sponsor-moment.js';

/* The sponsor moment (1.38.1): once, after ten closed days, when this copy has a sponsor page. */

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const SPONSOR = 'https://github.com/sponsors/example';

/** A stored day: outcomes [text, done], tasks [text, done], block minutes, closed or not. */
function day({ closed = true, outcomes = [], tasks = [], blocks = [] } = {}) {
  return {
    focus: '',
    priorities: [0, 1, 2].map(index => ({ id: `p${index}`, text: outcomes[index]?.[0] || '', done: !!outcomes[index]?.[1], carriedCount: 0 })),
    tasks: tasks.map(([text, done], index) => ({ id: `t${index}`, text, done, carriedCount: 0 })),
    blocks: blocks.map((duration, index) => ({ id: `b${index}`, title: 'Block', start: 540 + index * 120, duration })),
    endedAt: closed ? '2026-11-09T17:30:00.000Z' : ''
  };
}

test('the recap of a new or empty planner: nothing to count, no figure, a title without a number', () => {
  const empty = sponsorRecap([]);
  assert.deepEqual(empty, { days: 0, outcomes: 0, tasks: 0, minutes: 0, blocks: 0 });
  assert.deepEqual(recapFigures(empty), []);
  assert.equal(recapTitle(empty.days), 'Day after day, planned and closed.');
  // A day still open counts for nothing, however much is done; partial or broken records are skipped.
  const open = sponsorRecap([day({ closed: false, outcomes: [['Ship', true]], tasks: [['Call', true]], blocks: [120] }), null, 'x', {}, { endedAt: '' }]);
  assert.deepEqual(open, { days: 0, outcomes: 0, tasks: 0, minutes: 0, blocks: 0 });
  // Rendered: the title and the ask, but no row of figures to read as zeros.
  const html = renderSponsorMoment({ recap: empty, url: SPONSOR });
  assert.doesNotMatch(html, /sm-recap/);
  assert.match(html, /<h2 class="sm-title" id="sponsor-title">Day after day, planned and closed\.<\/h2>/);
});

test('the recap of ten typical closed days: outcomes done, hours on the schedule and tasks done', () => {
  const days = Array.from({ length: 10 }, (_, index) => day({
    outcomes: [['Main', true], ['Other', index % 2 === 0], ['Third', false]],
    tasks: [['Inbox', true], ['', true], ['Plants', index < 4]],
    blocks: [120, 90, 45]
  }));
  const recap = sponsorRecap([...days, day({ closed: false, outcomes: [['Tomorrow', true]] })]);
  assert.deepEqual(recap, { days: 10, outcomes: 15, tasks: 14, minutes: 2550, blocks: 30 });
  assert.equal(recapTitle(recap.days), 'Ten days, planned and closed.');
  assert.deepEqual(recapFigures(recap), [
    { id: 'outcomes', value: 15, label: 'outcomes done' },
    { id: 'hours', value: 43, label: 'hours planned' },
    { id: 'tasks', value: 14, label: 'tasks done' }
  ]);
  const html = renderSponsorMoment({ recap, url: SPONSOR });
  assert.match(html, /<ul class="sm-recap" data-count="3">/);
  // The number counts up for the eye; screen readers get the final figure with its words.
  assert.match(html, /<strong class="sm-recap__value" data-count-to="43" aria-hidden="true">43<\/strong><span class="sm-recap__label" aria-hidden="true">hours planned<\/span><span class="sr-only">43 hours planned<\/span>/);
});

test('a figure that would read as zero or odd is left out; words agree with their number', () => {
  assert.deepEqual(recapFigures({ days: 10, outcomes: 1, tasks: 0, minutes: 59 }), [{ id: 'outcomes', value: 1, label: 'outcome done' }]);
  assert.deepEqual(recapFigures({ days: 10, outcomes: 0, tasks: 1, minutes: 60 }), [{ id: 'hours', value: 1, label: 'hour planned' }, { id: 'tasks', value: 1, label: 'task done' }]);
  assert.deepEqual(recapFigures({ outcomes: -3, tasks: Number.NaN, minutes: 'x' }), []);
  assert.equal(renderSponsorMoment({ recap: { days: 10, outcomes: 4 } }).match(/<li><strong/g).length, 1);
  // The closed days are in the title, in words for ten, in figures beyond; fewer kept (a reopened day): no number.
  assert.equal(recapTitle(10), 'Ten days, planned and closed.');
  assert.equal(recapTitle(42), '42 days, planned and closed.');
  assert.equal(recapTitle(1204), '1,204 days, planned and closed.');
  assert.equal(recapTitle(8), 'Day after day, planned and closed.');
});

test('the recap reads each stored day once, and only days (never settings or other keys)', () => {
  const reads = [];
  const recap = recapFromStore({
    dayKeys: () => ['daily-planner:settings', 'daily-planner:2026-11-09', 'daily-planner:2026-11-10', 'daily-planner:2026-11-10', 'daily-planner:storage-probe-1', 'daily-planner-ui:tour'],
    readDay: key => { reads.push(key); return day({ outcomes: [['Main', true]], blocks: [60] }); }
  });
  assert.deepEqual(reads, ['2026-11-09', '2026-11-10']);
  assert.deepEqual(recap, { days: 2, outcomes: 2, tasks: 0, minutes: 120, blocks: 2 });
});

test('the sponsor page gates the moment: an https address only', () => {
  assert.equal(sponsorPage(SPONSOR), SPONSOR);
  assert.equal(sponsorPage(`  ${SPONSOR}  `), SPONSOR);
  for (const value of ['', '   ', null, undefined, 'http://github.com/sponsors/example', 'javascript:alert(1)', 'github.com/sponsors/example', 'https://']) assert.equal(sponsorPage(value), '', String(value));
  const due = { shown: false, closeDayCount: 10, busy: false };
  assert.equal(shouldOfferSponsor({ ...due, url: SPONSOR }), true);
  assert.equal(shouldOfferSponsor({ ...due, url: '' }), false, 'no sponsor page: never');
  assert.equal(shouldOfferSponsor({ ...due, url: 'http://example.com' }), false);
  assert.equal(SPONSOR_AFTER_CLOSED_DAYS, 10);
  assert.equal(shouldOfferSponsor({ ...due, closeDayCount: 9, url: SPONSOR }), false, 'before ten closed days');
  assert.equal(shouldOfferSponsor({ ...due, closeDayCount: 47, url: SPONSOR }), true, 'someone past ten when the page is set sees it at the next close');
  assert.equal(shouldOfferSponsor({ ...due, busy: true, url: SPONSOR }), false, 'never on top of another dialog');
  // Its link is the page, escaped, opened in a new tab.
  assert.match(renderSponsorMoment({ url: 'https://github.com/sponsors/a?b=1&c="2"' }), /href="https:\/\/github\.com\/sponsors\/a\?b=1&amp;c=&quot;2&quot;" target="_blank" rel="noopener">/);
});

/** A dialog without a browser: enough of the DOM for maybeOpen to render, bind and open. */
function fakePlanner({ elsewhere = false } = {}) {
  const calls = [];
  const bound = {};
  const host = { innerHTML: '', querySelector: selector => ({ addEventListener: (type, fn) => { bound[selector] = fn; } }) };
  const modal = { hidden: true, classList: { contains: name => name === 'is-open' && !modal.hidden }, querySelector: selector => (selector === '[data-sponsor-moment]' ? host : null), querySelectorAll: () => [] };
  globalThis.document = { querySelector: selector => (elsewhere && selector.includes('.modal.is-open') ? {} : null) };
  const settings = { sponsorPromptShown: false };
  const moment = createSponsorMoment({
    openModal: target => { calls.push('open'); target.hidden = false; },
    closeModal: target => { calls.push('close'); target.hidden = true; },
    url: SPONSOR,
    dayKeys: () => ['daily-planner:2026-11-10'],
    readDay: () => day({ outcomes: [['Main', true]], blocks: [90] }),
    shown: () => settings.sponsorPromptShown,
    markShown: () => { calls.push('mark'); settings.sponsorPromptShown = true; },
    modal: () => modal
  });
  return { moment, calls, bound, host, modal, settings };
}

test('shown once: the flag is set before it opens, and a later close never opens it again', () => {
  const planner = fakePlanner();
  assert.equal(planner.moment.maybeOpen({ closeDayCount: 9 }), false);
  assert.deepEqual(planner.calls, []);
  assert.equal(planner.moment.maybeOpen({ closeDayCount: 10 }), true);
  assert.deepEqual(planner.calls, ['mark', 'open'], 'remembered first, so a reload mid-way never shows it twice');
  assert.match(planner.host.innerHTML, /id="sponsor-title"/);
  assert.deepEqual(Object.keys(planner.bound).sort(), ['[data-sponsor-confirm]', '[data-sponsor-later]', '[data-sponsor-share]']);
  // Not now closes it through the planner's closeModal (the back stack).
  planner.bound['[data-sponsor-later]']();
  assert.deepEqual(planner.calls, ['mark', 'open', 'close']);
  assert.equal(planner.moment.maybeOpen({ closeDayCount: 11 }), false);
  assert.equal(planner.moment.maybeOpen({ closeDayCount: 30 }), false);
  assert.deepEqual(planner.calls, ['mark', 'open', 'close']);
  delete globalThis.document;
});

test('never on top of another dialog: busy, or any open dialog, waits for the next close', () => {
  const busy = fakePlanner();
  assert.equal(busy.moment.maybeOpen({ closeDayCount: 10, busy: true }), false);
  assert.equal(busy.settings.sponsorPromptShown, false, 'not used up');
  const covered = fakePlanner({ elsewhere: true });
  assert.equal(covered.moment.maybeOpen({ closeDayCount: 10 }), false);
  assert.deepEqual(covered.calls, []);
  delete globalThis.document;
});

test('share: the Web Share API with the site’s address; the link copied when it isn’t there or fails', async () => {
  const url = 'https://planner.bemorin.com/';
  const shared = [];
  const copied = [];
  const clipboard = { writeText: async value => { copied.push(value); } };
  assert.equal(await shareOrCopy({ url }, { nav: { share: async data => { shared.push(data); }, clipboard } }), 'shared');
  assert.deepEqual(shared, [{ title: SHARE_TEXT.title, text: SHARE_TEXT.text, url }]);
  assert.deepEqual(copied, []);
  // Cancelled by the person: nothing else happens.
  const abort = Object.assign(new Error('cancelled'), { name: 'AbortError' });
  assert.equal(await shareOrCopy({ url }, { nav: { share: async () => { throw abort; }, clipboard } }), 'cancelled');
  assert.deepEqual(copied, []);
  // Refused for another reason, or not shareable, or no Web Share at all: the link is copied.
  assert.equal(await shareOrCopy({ url }, { nav: { share: async () => { throw Object.assign(new Error('no'), { name: 'NotAllowedError' }); }, clipboard } }), 'copied');
  assert.equal(await shareOrCopy({ url }, { nav: { share: async () => {}, canShare: () => false, clipboard } }), 'copied');
  assert.equal(await shareOrCopy({ url }, { nav: { clipboard } }), 'copied');
  assert.deepEqual(copied, [url, url, url]);
  // No clipboard either: the old way, then a failure the dialog shows as the link itself.
  const blocked = { clipboard: { writeText: async () => { throw new Error('denied'); } } };
  assert.equal(await shareOrCopy({ url }, { nav: blocked, copyText: value => value === url }), 'copied');
  assert.equal(await shareOrCopy({ url }, { nav: blocked, copyText: () => false }), 'failed');
  assert.equal(await shareOrCopy({ url }, { nav: undefined }), 'failed');
});

test('the address shared: this site’s own on https, the public planner from a computer or a preview', () => {
  assert.equal(siteUrl({ protocol: 'https:', hostname: 'planner.bemorin.com', origin: 'https://planner.bemorin.com' }), 'https://planner.bemorin.com/');
  assert.equal(siteUrl({ protocol: 'https:', hostname: 'planner.example.org', origin: 'https://planner.example.org' }), 'https://planner.example.org/');
  assert.equal(siteUrl({ protocol: 'http:', hostname: 'localhost', origin: 'http://localhost:8695' }), 'https://planner.bemorin.com/');
  assert.equal(siteUrl({ protocol: 'https:', hostname: 'localhost', origin: 'https://localhost' }), 'https://planner.bemorin.com/');
  assert.equal(siteUrl(undefined), 'https://planner.bemorin.com/');
});

test('the words: celebrate, then an honest ask signed by Ben; thanks never says they sponsored', () => {
  const html = renderSponsorMoment({ recap: { days: 10, outcomes: 3 }, url: SPONSOR });
  assert.match(html, /<p>Daily Planner is free and made by one person\. It keeps your plans on your device\. If it’s become part of your day, you can help keep it going\.<\/p>\s*<p class="sm-sign">— Ben<\/p>/);
  assert.match(html, /data-sponsor-confirm[^>]*><svg[^>]*><path class="icon-fill" d="[^"]+"\/><\/svg><span>Sponsor on GitHub<\/span><\/a>/);
  assert.match(html, /<button class="secondary-button icon-text-button sm-share" type="button" data-sponsor-share>/);
  assert.match(html, /<button class="text-button sm-later" type="button" data-sponsor-later>Not now<\/button>/);
  assert.match(html, /role="status" data-sponsor-status/);
  // The same GitHub mark as How it works.
  const mark = /data-github-sponsor[^>]*><svg[^>]*><path class="icon-fill" d="([^"]+)"/.exec(read('index.html'))[1];
  assert.ok(html.includes(mark));
  const thanks = renderSponsorThanks();
  assert.match(thanks, /<h2 class="sm-title" id="sponsor-title" tabindex="-1">Thank you\.<\/h2>/);
  assert.doesNotMatch(thanks, /for (?:sponsoring|your support)|you sponsored|sponsorship/i);
  const words = html + thanks + read('src/features/sponsor-moment.js');
  assert.doesNotMatch(words, /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u, 'no emoji');
  assert.doesNotMatch(html + thanks, /(?<![=\w-])'(?=\w)|\w'\w/, 'curly apostrophes in the copy');
  // Ten day marks, the last one the day just closed; the Horizon mark drawn stroke by stroke.
  assert.equal(DAY_MARKS, 10);
  assert.equal((html.match(/<li(?: class="is-today")?><\/li>/g) || []).length, 10);
  assert.match(html, /<li class="is-today"><\/li><\/ol>/);
  for (const part of ['sm-horizon', 'sm-ground', 'sm-ray sm-ray--1', 'sm-ray sm-ray--2', 'sm-ray sm-ray--3']) assert.match(html, new RegExp(`class="${part}" pathLength="1"`));
  assert.match(html, /<g clip-path="url\(#sm-sky\)"><path class="sm-sun" d="M20 38a12 12 0 0 1 24 0"\/><\/g>/);
  assert.match(html, /<div class="sm-stage" aria-hidden="true">/);
});

test('the planner wires it: after the day-closed confirmation, once, through the back stack', () => {
  const app = read('app.js');
  assert.match(app, /import \{ createSponsorMoment \} from '\.\/src\/features\/sponsor-moment\.js';/);
  const prompt = /function maybePromptInstallOrSupport\(\) \{([\s\S]*?)\n {2}\}/.exec(app)[1];
  assert.match(prompt, /^\s*if \(activeModal\) return;/);
  assert.ok(prompt.indexOf('installFeature.maybePrompt()') < prompt.indexOf('sponsorMoment.maybeOpen(') && prompt.indexOf('sponsorMoment.maybeOpen(') < prompt.indexOf('feedbackFeature.maybePrompt('));
  assert.match(prompt, /sponsorMoment\.maybeOpen\(\{ closeDayCount: settings\.closeDayCount, busy: tour\.isActive\(\) \|\| tour\.offerVisible\(\) \}\)/);
  assert.match(app, /createSponsorMoment\(\{ openModal, closeModal, url: GITHUB_SPONSOR_URL,[^\n]*shown: \(\) => !!settings\.sponsorPromptShown, markShown: \(\) => \{ settings\.sponsorPromptShown = true; persistSettings\(\); \} \}\);/);
  assert.doesNotMatch(app, /data-sponsor-(?:later|confirm)/, 'the module binds its own actions');
  // Done for today and Open the next day both lead there.
  assert.equal((app.match(/setTimeout\(maybePromptInstallOrSupport, 220\)/g) || []).length, 2);
  const html = read('index.html');
  assert.match(html, /<div class="modal modal--sponsor" data-sponsor-modal hidden>\n {4}<button class="modal__backdrop" type="button" data-modal-close aria-label="Not now"><\/button>\n {4}<section class="modal__panel" role="dialog" aria-modal="true" aria-labelledby="sponsor-title">\n {6}<button class="modal__close icon-button" type="button" data-modal-close aria-label="Close">/);
  assert.match(html, /<div class="modal__scroll" data-sponsor-moment><\/div>/);
  assert.match(read('sw.js'), /'\.\/src\/features\/sponsor-moment\.js'/);
  assert.match(read('styles.css'), /@import url\('\.\/styles\/sponsor\.css'\);/);
  assert.match(read('scripts/quality.mjs'), /'sponsor\.css'/);
});

test('motion only where it is welcome: every animation waits for no-preference, the resting state is the end', () => {
  const css = read('styles/sponsor.css').replace(/\/\*[\s\S]*?\*\//g, '');
  const start = css.indexOf('@media (prefers-reduced-motion: no-preference) {');
  assert.ok(start > 0);
  let depth = 0;
  let end = css.indexOf('{', start);
  do { if (css[end] === '{') depth += 1; if (css[end] === '}') depth -= 1; end += 1; } while (depth);
  const outside = css.slice(0, start) + css.slice(end);
  assert.doesNotMatch(outside, /\banimation(?:-name)?\s*:/, 'no animation outside the no-preference block');
  assert.doesNotMatch(outside, /\btransition\s*:/);
  // The sequence fits in about two seconds, eased, never bouncy (no overshooting curve).
  const block = css.slice(start, end);
  const ends = [...block.matchAll(/animation: [\w-]+ (\d+)ms [^;]*? (\d+)ms both/g)].map(match => Number(match[1]) + Number(match[2]));
  assert.ok(Math.max(...ends) <= 2000, `ends by 2 s (${Math.max(...ends)} ms)`);
  assert.doesNotMatch(block, /cubic-bezier\([^)]*,\s*1\.\d/, 'no overshoot');
  assert.doesNotMatch(css, /!important/);
  // Phones: the actions full width in one column, comfortable at 360px.
  const phone = /@media \(max-width: 560px\) \{([\s\S]*?)\n\}/.exec(css)[1];
  assert.match(phone, /\.sm-actions \{ grid-template-columns: minmax\(0, 1fr\);/);
  assert.match(phone, /\.sm-actions \.primary-button,\n {2}\.sm-actions \.secondary-button \{ width: 100%; min-width: 0; min-height: 46px; \}/);
  // Both themes: the tile of the dark theme is the opening seal's disc, set for the system and the chosen theme.
  assert.equal((css.match(/--sm-tile: #23211e;/g) || []).length, 2);
  assert.match(css, /:root:not\(\[data-theme="light"\]\) \.sponsor-moment \{/);
  assert.match(css, /:root\[data-theme="dark"\] \.sponsor-moment \{/);
});
