import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildProgressModel } from '../src/features/progress-model.js';
import { PAINT_PALETTES } from '../src/features/paint-palettes.js';
import { buildYearReview, capList, PRINT_CAPS, printPeriod, renderYearReviewPrint, reviewLead } from '../src/features/year-review.js';

// The printed year in review (one landscape page, styles/year.css `.print-sheet--review`).

const today = new Date(2026, 9, 9, 12); // 9 October 2026
const icon = name => `<svg data-icon="${name}"></svg>`;
const categories = { deep: { id: 'deep', name: 'Deep work', color: '#5f7084' }, health: { id: 'health', name: 'Health', color: '#5f755b' } };
const closedDay = (extra = {}) => ({ endedAt: 'x', priorities: [{ text: 'Ship', done: true }], blocks: [], memory: '', lesson: '', ...extra });

const fullYear = {
  misogi: 'Ride the Pyrenees',
  misogiWhy: 'To prove it to myself',
  misogiStartDate: '2026-08-24',
  misogiEndDate: '2026-08-30',
  misogiDone: true,
  misogiMilestones: [{ id: 'm1', text: 'First 150 km', done: true, date: '' }, { id: 'm2', text: 'Tourmalet', done: false, date: '' }],
  meaningful: ['Dinner with the kids', 'Ship v2'],
  miniAdventures: [
    { id: 'a1', text: 'Night hike', startDate: '2026-06-21', endDate: '', status: 'done', done: true },
    { id: 'a2', text: 'Lisbon', startDate: '2026-10-17', endDate: '2026-10-19', status: 'planned', done: false }
  ],
  habits: ['Read', '', '', ''],
  habitStartedAt: ['', '', '', ''],
  habitChecks: { '2026-01-05': [0] }
};

function richDays() {
  return {
    '2026-01-05': closedDay({ memory: 'Snow walk with Claire', lesson: 'Start earlier', blocks: [{ duration: 120, categoryId: 'deep' }, { duration: 60, categoryId: 'health' }] }),
    '2026-01-06': closedDay({ memory: 'First swim', blocks: [{ duration: 90, categoryId: 'deep' }] }),
    '2026-03-03': closedDay({ lesson: 'Say the hard thing early', blocks: [{ duration: 30, categoryId: 'health' }] }),
    '2026-06-22': closedDay({ memory: 'Night hike under a full moon', lesson: 'Short runs count' })
  };
}

function build({ year = 2026, days = richDays(), yearData = fullYear, now = today } = {}) {
  const readDay = key => days[key] || null;
  const progress = buildProgressModel({ year, today: now, planningDays: [1, 2, 3, 4, 5], getRecord: readDay, yearData });
  const review = buildYearReview({ year, progress, yearData, readDay, categoryFor: id => categories[id] || null, today: now });
  return { review, progress };
}

const count = (html, pattern) => (html.match(pattern) || []).length;

test('the page: a title band, five figures beside the painted year, time, Horizon, the journal and the trophies', () => {
  const { review, progress } = build();
  const html = renderYearReviewPrint(review, progress, { icon });
  assert.match(html, /^<div class="rv">/, 'no palette, no quiet layout');
  assert.match(html, /<h1>2026, in review<\/h1>/);
  assert.match(html, /class="rv-period">1 January – 9 October 2026<span> · so far<\/span>/);
  assert.match(html, /class="rv-lead">So far, 4 days closed, the Misogi accomplished, 1 of 2 mini‑adventures lived and 5 h scheduled\.</);
  assert.equal(count(html, /class="rv-fig[ "]/g), 5);
  ['Days closed', 'Close rate', 'Best streak', 'Trophies', 'Main outcomes done'].forEach(label => assert.match(html, new RegExp(`<span>${label}</span>`)));
  assert.equal(count(html, /<li><span>[^<]+<\/span><span class="rv-paint__cells">/g), 12, 'a row a month');
  assert.equal(count(html, /<i class="is-l[123]"><\/i>/g) - 3, progress.closed, 'a painted square per closed day (and three in the legend)');
  assert.equal(count(html, /<i class="is-(l[123]|future|before|joker|missed|rest)"><\/i>/g) - 6, 365, 'every day of the year, plus the legend');
  assert.match(html, /class="rv-sec rv-time"/);
  assert.equal(count(html, /<li style="--bar:/g), review.time.rows.length);
  ['rv-kind--misogi', 'rv-kind--adventure', 'rv-kind--habit', 'rv-kind--commitment', 'rv-journal'].forEach(part => assert.match(html, new RegExp(`class="rv-sec ${part}`)));
  assert.match(html, /class="rv-misogi">Ride the Pyrenees</);
  assert.match(html, /Accomplished · 24–30 Aug/);
  assert.match(html, /1 of 2 milestones/);
  assert.match(html, /<b>Q1<\/b><span>Read<\/span>/);
  assert.doesNotMatch(html, /Q2|No habit/, 'quarters without a habit are left out');
  assert.match(html, /class="rv-sec rv-trophies">/, 'trophies along the foot when time is shown');
  assert.match(html, /class="print-sheet-domain" href="https:\/\/planner\.bemorin\.com">.*planner\.bemorin\.com<\/a>/);
});

test('dates on the page read day first, like the Horizon ranges', () => {
  const { review, progress } = build();
  const html = renderYearReviewPrint(review, progress, { icon });
  assert.match(html, /<time>22 Jun<\/time><p>Night hike under a full moon<\/p>/);
  assert.match(html, /<small>5 Jan<\/small>/, 'the day a trophy was unlocked');
});

test('a finished year never says “so far”', () => {
  const { review, progress } = build({ now: new Date(2027, 0, 12, 12) });
  assert.equal(review.isCurrentYear, false);
  const html = renderYearReviewPrint(review, progress, { icon });
  assert.doesNotMatch(html, /so far|So far/i);
  assert.match(html, /class="rv-period">1 January – 31 December 2026</);
  assert.match(html, /class="rv-lead">4 days closed, the Misogi/);
  assert.equal(printPeriod(review), '1 January – 31 December 2026');
});

test('a sparse year: no empty boxes, larger squares and one closing line', () => {
  const days = Object.fromEntries(['2026-09-21', '2026-09-22', '2026-09-24', '2026-10-01'].map(key => [key, closedDay({ priorities: [{ text: '', done: false }] })]));
  const { review, progress } = build({ days, yearData: {} });
  const html = renderYearReviewPrint(review, progress, { icon });
  assert.match(html, /^<div class="rv rv--quiet">/);
  assert.doesNotMatch(html, /rv-band--story|rv-time|rv-kind--|rv-journal/, 'parts with nothing in them are left out');
  assert.doesNotMatch(html, /No Misogi|No habit|were written down|Time appears|will appear here/, 'no placeholder copy on the keepsake');
  assert.match(html, /class="rv-lead">So far, 4 days closed\.</);
  assert.match(html, /<p class="rv-coda">The rest of 2026 is still to paint\.<\/p>/);
  assert.match(html, /rv-trophies--aside/, 'a trophy or two sits beside the squares');
  assert.match(html, /The one result that makes a day/, 'no outcome yet reads as a description, not 0%');
  const finished = build({ days, yearData: {}, now: new Date(2027, 0, 5, 12) });
  assert.match(renderYearReviewPrint(finished.review, finished.progress, { icon }), /<p class="rv-coda">The next year starts with a single closed day\.<\/p>/);
});

test('an empty year says so once and paints nothing', () => {
  const { review, progress } = build({ days: {}, yearData: {} });
  assert.equal(review.isEmpty, true);
  const html = renderYearReviewPrint(review, progress, { icon });
  assert.match(html, /Nothing to look back on in 2026 yet/);
  assert.doesNotMatch(html, /rv-coda|rv-trophies/);
  assert.match(html, /rv-band--paint rv-band--solo/);
  assert.equal(count(html, /<i class="is-l[123]"><\/i>/g), 3, 'only the legend');
});

test('trophies sit beside the squares only when they fit there', () => {
  const { review, progress } = build();
  const noTime = { ...review, time: { total: 0, days: 0, rows: [] } };
  assert.match(renderYearReviewPrint(noTime, progress, { icon }), /rv-trophies--aside/);
  const many = { ...noTime, trophies: { ...review.trophies, unlocked: Array.from({ length: 8 }, (_, index) => ({ id: `t${index}`, title: `Trophy ${index}`, icon: 'flame', group: 'streak', unlockedOn: '' })) } };
  const html = renderYearReviewPrint(many, progress, { icon });
  assert.doesNotMatch(html, /rv-trophies--aside/);
  assert.match(html, /class="rv-sec rv-trophies">/);
  assert.match(html, /rv-band--solo/);
});

test('a long journal is set tighter', () => {
  const { review, progress } = build();
  assert.equal(review.journal.memories.length + review.journal.lessons.length, 5);
  assert.match(renderYearReviewPrint(review, progress, { icon }), /rv-journal rv-journal--full/);
  const short = { ...review, journal: { memories: review.journal.memories.slice(0, 1), lessons: [] } };
  assert.doesNotMatch(renderYearReviewPrint(short, progress, { icon }), /rv-journal--full/);
});

test('the palette chosen on this device prints in its light colours', () => {
  const { review, progress } = build();
  assert.match(renderYearReviewPrint(review, progress, { icon, palette: 'ocean' }), /^<div class="rv rv--paint-ocean">/);
  assert.match(renderYearReviewPrint(review, progress, { icon, palette: 'terracotta' }), /^<div class="rv rv--paint-terracotta">/);
  assert.match(renderYearReviewPrint(review, progress, { icon, palette: 'neon"><x' }), /^<div class="rv">/, 'an unknown palette is ignored');
  const css = readFileSync(new URL('../styles/year.css', import.meta.url), 'utf8');
  for (const palette of PAINT_PALETTES) {
    const page = css.match(new RegExp(`\\.rv\\.rv--paint-${palette.id} \\{ --hz-paint: (#[0-9a-f]{6})`));
    assert.ok(page, palette.id);
    if (palette.id === 'terracotta') assert.equal(page[1], '#a5522e');
    else assert.equal(page[1], css.match(new RegExp(`html\\[data-paint="${palette.id}"\\],\\s*\\.hz-palette--${palette.id} \\{ --hz-paint: (#[0-9a-f]{6})`))[1], palette.id);
  }
});

test('the print styles: one sheet that fits A4 and Letter, exact colours, nothing under 6pt', () => {
  const css = readFileSync(new URL('../styles/year.css', import.meta.url), 'utf8');
  const sheet = css.slice(css.indexOf('/* Year in review, printed on one landscape page'));
  const height = Number(sheet.match(/\.print-sheet--review \{[^}]*--print-sheet-height: ([\d.]+)mm/)[1]);
  assert.ok(height <= 198 - 4, 'inside A4 landscape (210mm less the 6mm margins) with room to spare');
  assert.match(sheet, /\.print-sheet--review \{[^}]*print-color-adjust: exact/);
  const sizes = [...sheet.matchAll(/font-size: ([\d.]+)(pt|px|rem|em)/g)];
  assert.ok(sizes.length > 20);
  sizes.forEach(([, value, unit]) => { assert.equal(unit, 'pt'); assert.ok(Number(value) >= 6, `${value}${unit}`); });
  assert.doesNotMatch(sheet, /var\(--(ink|muted|faint|line|surface|paper|soft)\b/, 'paper colours only, never the app theme’s');
});

test('the line about the year', () => {
  const { review } = build({ now: new Date(2027, 0, 12, 12) });
  const all = { ...review, horizon: { ...review.horizon, adventures: { items: review.horizon.adventures.items.map(item => ({ ...item, done: true })), lived: 2 } } };
  assert.match(reviewLead(all), /all 2 mini‑adventures lived/);
  const one = { ...review, horizon: { ...review.horizon, adventures: { items: [{ text: 'Sail', done: true, when: '' }], lived: 1 } } };
  assert.match(reviewLead(one), /a mini‑adventure lived/);
  const undone = { ...review, horizon: { ...review.horizon, misogi: { ...review.horizon.misogi, done: false } } };
  assert.doesNotMatch(reviewLead(undone), /Misogi/);
  const quiet = { ...review, days: { ...review.days, closed: 0 }, horizon: { ...undone.horizon, adventures: { items: [], lived: 0 } }, time: { total: 0, days: 0, rows: [] } };
  assert.equal(reviewLead(quiet), 'The year, on one page.');
});

test('list caps: everything that fits, otherwise a “+N more” line in the last place', () => {
  assert.deepEqual(capList(['a', 'b', 'c'], 3), { shown: ['a', 'b', 'c'], more: 0 });
  assert.deepEqual(capList(['a', 'b', 'c', 'd'], 3), { shown: ['a', 'b'], more: 2 }, 'never “+1 more”: the line takes the place of an entry');
  assert.deepEqual(capList([], 3), { shown: [], more: 0 });
  assert.deepEqual(capList(undefined, 3), { shown: [], more: 0 });
  for (let length = 0; length <= 30; length += 1) {
    for (const max of [1, 3, 4, 5, 6, 21]) {
      const { shown, more } = capList(Array.from({ length }, (_, index) => index), max);
      assert.ok(shown.length + (more ? 1 : 0) <= max, `${length} in ${max} lines`);
      assert.equal(shown.length + more, length, 'every entry is shown or counted');
      assert.ok(more === 0 || more >= 2);
    }
  }
});

test('the caps hold what the Horizon allows, so an ordinary year prints whole', () => {
  const view = readFileSync(new URL('../src/features/horizon-view.js', import.meta.url), 'utf8');
  assert.equal(PRINT_CAPS.milestones, Number(view.match(/const MAX_MILESTONES = (\d+);/)[1]));
  assert.equal(PRINT_CAPS.adventures, Number(view.match(/const MAX_ADVENTURES = (\d+);/)[1]));
  assert.equal(PRINT_CAPS.commitments, 3, 'three commitments in Horizon');
  assert.equal(PRINT_CAPS.habits, 4, 'a habit a quarter');
  assert.equal(PRINT_CAPS.trophies, 21, 'three rows of seven');
  const { review, progress } = build();
  const full = {
    ...review,
    horizon: {
      ...review.horizon,
      misogi: { ...review.horizon.misogi, milestones: Array.from({ length: 5 }, (_, index) => ({ text: `Milestone ${index + 1}`, done: index < 2 })), milestonesDone: 2 },
      adventures: { items: Array.from({ length: 6 }, (_, index) => ({ text: `Adventure ${index + 1}`, done: index < 4, when: '' })), lived: 4 },
      commitments: ['Be fully present at dinner with the kids', 'Ship v2 of the planner', 'One long walk with Mum each month'],
      habits: ['Read 20 pages', 'No phone before 9am', 'Mobility 10 min', 'Write three lines'].map((text, index) => ({ quarter: index + 1, text, percent: 30 + index, done: 0, elapsed: 1 }))
    }
  };
  const html = renderYearReviewPrint(full, progress, { icon });
  assert.doesNotMatch(html, /rv-more/);
  ['Milestone 5', 'Adventure 6', 'One long walk with Mum each month', 'Write three lines'].forEach(text => assert.match(html, new RegExp(text)));
});

test('a year past the caps prints the first entries and a quiet “+N more”, never a cut line', () => {
  const { review, progress } = build();
  const many = (length, make) => Array.from({ length }, (_, index) => make(index + 1));
  const big = {
    ...review,
    horizon: {
      ...review.horizon,
      misogi: { ...review.horizon.misogi, milestones: many(8, n => ({ text: `Milestone ${n}`, done: n < 4 })), milestonesDone: 3 },
      adventures: { items: many(9, n => ({ text: `Adventure ${n}`, done: n < 3, when: '' })), lived: 2 },
      commitments: ['One', 'Two', 'Three', 'Four']
    },
    journal: { memories: many(6, n => ({ key: `2026-01-0${n}`, text: `Memory ${n}` })), lessons: many(6, n => ({ key: `2026-02-0${n}`, text: `Lesson ${n}` })) },
    time: { ...review.time, rows: many(9, n => ({ id: `c${n}`, name: `Category ${n}`, color: '#5f7084', minutes: 1000 - n, share: 0.1 })) },
    trophies: { total: 25, unlocked: many(25, n => ({ id: `t${n}`, title: `Trophy ${n}`, icon: 'flame', group: 'streak', unlockedOn: '' })) }
  };
  const html = renderYearReviewPrint(big, progress, { icon });
  const part = name => html.match(new RegExp(`<section class="rv-sec ${name}[^>]*>[\\s\\S]*?</section>`))[0];
  const items = section => count(section, /<li[ >]/g);

  const misogi = part('rv-kind--misogi');
  assert.equal(items(misogi), PRINT_CAPS.milestones);
  assert.match(misogi, /Milestone 4<\/span>/);
  assert.doesNotMatch(misogi, /Milestone 5/);
  assert.match(misogi, /<li class="rv-more">\+4 more<\/li><\/ul>/);
  assert.match(misogi, /3 of 8 milestones/, 'the head still counts them all');

  const adventures = part('rv-kind--adventure');
  assert.equal(items(adventures), PRINT_CAPS.adventures);
  assert.match(adventures, /<li class="rv-more">\+4 more<\/li><\/ul>/);
  assert.match(adventures, /2 of 9 lived/);

  const commitments = part('rv-kind--commitment');
  assert.equal(items(commitments), PRINT_CAPS.commitments);
  assert.match(commitments, /<span>Two<\/span><\/li><li class="rv-more">\+2 more<\/li>/);
  assert.doesNotMatch(commitments, /Three/);

  const journal = part('rv-journal');
  assert.equal(count(journal, /<time>/g), 5, 'five entries, balanced like the review on screen');
  assert.equal(count(journal, /Memory \d/g), 3);

  const time = part('rv-time');
  assert.equal(items(time), PRINT_CAPS.time);
  assert.match(time, /<li class="rv-more">\+4 more<\/li><\/ol>/);

  const trophies = part('rv-trophies');
  assert.match(trophies, /^<section class="rv-sec rv-trophies rv-trophies--many">/);
  assert.equal(items(trophies), PRINT_CAPS.trophies);
  assert.match(trophies, /Trophy 20<\/span>/);
  assert.doesNotMatch(trophies, /Trophy 21/);
  assert.match(trophies, /<li class="rv-more">\+5 more<\/li><\/ul>/);
  assert.match(trophies, /<span>25 of 25<\/span>/, 'the head counts them all');
});

test('trophies along the foot are set smaller only when they take three rows', () => {
  const { review, progress } = build();
  const withTrophies = length => renderYearReviewPrint({ ...review, trophies: { total: 20, unlocked: Array.from({ length }, (_, index) => ({ id: `t${index}`, title: `Trophy ${index}`, icon: 'flame', group: 'streak', unlockedOn: '' })) } }, progress, { icon });
  assert.match(withTrophies(7), /class="rv-sec rv-trophies">/);
  assert.match(withTrophies(14), /class="rv-sec rv-trophies">/);
  assert.match(withTrophies(15), /class="rv-sec rv-trophies rv-trophies--many">/);
  assert.match(withTrophies(20), /class="rv-sec rv-trophies rv-trophies--many">/);
  assert.doesNotMatch(withTrophies(20), /rv-more/, 'all twenty fit in three rows');
});

test('the story band is never masked or clipped: every entry has a bounded height instead', () => {
  const css = readFileSync(new URL('../styles/year.css', import.meta.url), 'utf8');
  const sheet = css.slice(css.indexOf('/* Year in review, printed on one landscape page'));
  const rule = selector => {
    const found = sheet.match(new RegExp(`(?:^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{([^}]*)\\}`));
    assert.ok(found, selector);
    return found[1];
  };
  assert.doesNotMatch(rule('.rv-band--story'), /overflow|mask/);
  assert.doesNotMatch(sheet, /mask-image/, 'no fade anywhere on the page');
  // Each entry is clamped to a few lines (ending on an ellipsis) or kept to one line.
  [['.rv-misogi', 3], ['.rv-why', 2], ['.rv-checks span', 2], ['.rv-commitments span', 2], ['.rv-notes p', 3], ['.rv-journal--full .rv-notes p', 2], ['.rv-marks span', 2]].forEach(([selector, lines]) => assert.match(rule(selector), new RegExp(`-webkit-line-clamp: ${lines};`), selector));
  ['.rv-milestones span', '.rv-habits span', '.rv-trophies--many .rv-marks span', '.rv-h'].forEach(selector => assert.match(rule(selector), /white-space: nowrap/, selector));
  assert.match(rule('.rv .rv-more'), /color: var\(--rv-faint\)/, 'the “+N more” line is quiet');
});
