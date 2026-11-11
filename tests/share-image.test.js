import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  SHARE_FORMATS, SHARE_PAINTS, balanceText, buildWeekShareModel, buildYearShareModel, canShare, describeShare, drawShareImage,
  fitText, mixHex, normalizeShareOptions, shareCellState, shareColors, shareFileName, weekRangeLabel, wrapText, yearSubline
} from '../src/features/share-image.js';
import { buildProgressModel } from '../src/features/progress-model.js';

// A width per character, like a monospace face: easy to reason about.
const measure = value => Array.from(String(value)).length * 10;

const weekCells = (states = ['closed', 'closed', 'missed', 'closed', 'closed']) => states.map((state, index) => {
  const key = `2026-10-${String(19 + index).padStart(2, '0')}`;
  if (state === 'closed') return { key, closed: true, level: index % 3 + 1, planning: true };
  return { key, planning: true, [state]: true };
});

/** A 2D context that records the text it is asked to draw. */
function recordingContext() {
  const drawn = [];
  const ctx = {
    font: '10px sans-serif', fillStyle: '', strokeStyle: '', lineWidth: 1, lineCap: '', lineJoin: '', textAlign: '', textBaseline: '',
    drawn,
    measureText(value) { const size = Number(/([\d.]+)px/.exec(this.font)?.[1]) || 10; return { width: Array.from(String(value)).length * size * 0.55 }; },
    fillText(value) { drawn.push(String(value)); },
    createRadialGradient: () => ({ addColorStop() {} })
  };
  for (const name of ['save', 'restore', 'setTransform', 'clearRect', 'fillRect', 'beginPath', 'moveTo', 'arcTo', 'arc', 'closePath', 'fill', 'stroke', 'clip', 'translate', 'scale']) ctx[name] = () => {};
  return ctx;
}

test('fitText keeps what fits and ends what does not with an ellipsis, on a word when it can', () => {
  assert.equal(fitText('Deep work', 200, measure), 'Deep work');
  assert.equal(fitText('  Deep\n  work  ', 200, measure), 'Deep work', 'whitespace is tidied');
  const cut = fitText('Learning and an extremely long category name', 160, measure);
  assert.ok(measure(cut) <= 160, cut);
  assert.match(cut, /…$/);
  assert.equal(cut, 'Learning and an…', 'ends on a whole word near the cut');
  assert.equal(fitText('Supercalifragilistic', 80, measure), 'Superca…', 'one long word is cut where it must be');
  assert.equal(fitText('Anything', 5, measure), '', 'nothing fits: nothing is drawn');
  assert.equal(fitText('', 100, measure), '');
});

test('wrapText respects the line limit and says when text was left out', () => {
  assert.deepEqual(wrapText('The week is closed.', 1000, measure, 2), ['The week is closed.']);
  assert.deepEqual(wrapText('The week is closed.', 120, measure, 2), ['The week is', 'closed.']);
  const long = wrapText('Protect the first two hours because that is where the real work happens every single day', 200, measure, 2);
  assert.equal(long.length, 2);
  assert.ok(long.every(line => measure(line) <= 200), long.join(' | '));
  assert.match(long[1], /…$/);
  const word = wrapText('Antidisestablishmentarianism', 100, measure, 3);
  assert.ok(word.length > 1 && word.every(line => measure(line) <= 100), 'a single long word breaks instead of overflowing');
});

test('balanceText evens out lines without changing the words', () => {
  const text = 'Ride the Haute Route Pyrenees in seven days';
  const greedy = wrapText(text, 380, measure, 2);
  const balanced = balanceText(text, 380, measure, 2);
  assert.equal(balanced.join(' '), text);
  assert.equal(balanced.length, greedy.length);
  const spread = lines => Math.abs(measure(lines[0]) - measure(lines[1]));
  assert.ok(spread(balanced) < spread(greedy), `${balanced.join(' | ')} vs ${greedy.join(' | ')}`);
  assert.deepEqual(balanceText('Short', 380, measure, 2), ['Short']);
});

test('the week model counts the days that could be closed and folds small categories into Other', () => {
  const model = buildWeekShareModel({
    cells: weekCells(['before', 'before', 'missed', 'closed', 'closed']),
    mainDone: 1,
    mainTotal: 2,
    categories: [
      { name: 'Deep work', color: '#5f7084', minutes: 300 }, { name: 'Admin', color: 'red', minutes: 120 }, { name: ' ', color: '#746e67', minutes: 60 },
      { name: 'Health', color: '#5f755b', minutes: 45 }, { name: 'Learning', color: '#716786', minutes: 30 }, { name: 'Personal', color: '#9a704e', minutes: 15 }, { name: 'Empty', color: '#9a704e', minutes: 0 }
    ],
    scheduledMinutes: 600,
    streak: 12.7,
    lines: ['  Say no earlier. ', 'say no earlier.', '', 'Protect the mornings.']
  });
  assert.equal(model.kind, 'week');
  assert.equal(model.closed, 2);
  assert.equal(model.possible, 3, 'days before the first closed day are not counted as missed');
  assert.deepEqual(model.days.map(day => day.state), ['before', 'before', 'missed', 'closed', 'closed']);
  assert.equal(model.firstKey, '2026-10-19');
  assert.equal(model.lastKey, '2026-10-23');
  assert.equal(model.streak, 12);
  assert.deepEqual(model.categories.map(item => item.name), ['Deep work', 'Admin', 'Uncategorized', 'Health', 'Learning', 'Other']);
  assert.equal(model.categories[1].color, '', 'only #rrggbb colours are drawn');
  assert.equal(model.categories.at(-1).minutes, 600 - 555);
  assert.equal(model.totalMinutes, 600);
  assert.deepEqual(model.lines, ['Say no earlier.', 'Protect the mornings.'], 'trimmed, de-duplicated, empty lines dropped');
  assert.equal(canShare(model), true);
});

test('a week or a year with nothing closed has nothing to share', () => {
  const week = buildWeekShareModel({ cells: weekCells(['missed', 'missed', 'missed', 'future', 'future']) });
  assert.equal(week.empty, true);
  assert.equal(canShare(week), false);
  assert.equal(week.possible, 3);
  assert.equal(canShare(buildWeekShareModel()), false);
  const year = buildYearShareModel(buildProgressModel({ year: 2026, today: new Date(2026, 9, 23, 12), getRecord: () => null }));
  assert.equal(year.closed, 0);
  assert.equal(canShare(year), false);
  assert.equal(canShare(null), false);
});

test('one closed day is enough, and reads naturally', () => {
  const records = { '2026-10-23': { endedAt: '2026-10-23T18:00:00', priorities: [{ text: 'Ship', done: true }] } };
  const progress = buildProgressModel({ year: 2026, today: new Date(2026, 9, 23, 12), getRecord: key => records[key] || null });
  const year = buildYearShareModel(progress, { misogi: '  Run a marathon ', misogiDone: true });
  assert.equal(canShare(year), true);
  assert.equal(year.closed, 1);
  assert.equal(year.bestStreak, 1);
  assert.equal(year.currentStreak, 1);
  assert.equal(year.mitDone, 1);
  assert.equal(year.misogi, 'Run a marathon');
  assert.equal(year.misogiDone, true);
  assert.equal(year.months.length, 12);
  assert.equal(year.months[9].days.find(day => day.key === '2026-10-23').state, 'closed');
  assert.equal(year.months[9].days.find(day => day.key === '2026-10-22').state, 'before', 'not missed before the first closed day');
  assert.equal(year.months[11].days[0].state, 'future');
  assert.equal(yearSubline(year, 'en-US'), 'Through October 23');
  assert.match(describeShare(year), /1 day closed in 2026/);
  assert.doesNotMatch(describeShare(year), /marathon/, 'the Misogi stays out unless chosen');
  assert.match(describeShare(year, { includeMisogi: true }), /Misogi: Run a marathon/);
});

test('a past year has no current streak and an unnamed Misogi is never “accomplished”', () => {
  const records = { '2025-03-03': { endedAt: 'x' }, '2025-03-04': { endedAt: 'x' } };
  const progress = buildProgressModel({ year: 2025, today: new Date(2026, 9, 23, 12), getRecord: key => records[key] || null });
  const year = buildYearShareModel(progress, { misogi: '   ', misogiDone: true });
  assert.equal(year.isCurrentYear, false);
  assert.equal(year.currentStreak, 0);
  assert.equal(year.bestStreak, 2);
  assert.equal(year.misogi, '');
  assert.equal(year.misogiDone, false);
  assert.doesNotMatch(yearSubline(year, 'en-US'), /through/i);
});

test('progress cells map onto the painted squares of the image', () => {
  assert.equal(shareCellState({ closed: true, today: true }), 'closed');
  assert.equal(shareCellState({ today: true }), 'today');
  assert.equal(shareCellState({ future: true, planning: true }), 'future');
  assert.equal(shareCellState({ before: true, planning: true }), 'before');
  assert.equal(shareCellState({ joker: true, planning: true }), 'joker');
  assert.equal(shareCellState({ planning: true }), 'missed');
  assert.equal(shareCellState({}), 'rest');
});

test('private text is off unless a literal true turns it on', () => {
  assert.equal(normalizeShareOptions({}).includeLine, false);
  assert.equal(normalizeShareOptions({ includeLine: 'yes', line: 'Secret' }).includeLine, false);
  assert.equal(normalizeShareOptions({ includeLine: 1, line: 'Secret' }).line, '');
  assert.equal(normalizeShareOptions({ includeLine: true, line: '   ' }).includeLine, false, 'an empty line is nothing to include');
  assert.deepEqual([normalizeShareOptions({ includeLine: true, line: ' Secret ' }).includeLine, normalizeShareOptions({ includeLine: true, line: ' Secret ' }).line], [true, 'Secret']);
  assert.equal(normalizeShareOptions({ includeMisogi: 'true' }).includeMisogi, false);
  assert.equal(normalizeShareOptions({ includeMisogi: true }).includeMisogi, true);
  const defaults = normalizeShareOptions({ format: 'poster', look: 'neon', paint: 'gold' });
  assert.deepEqual([defaults.format, defaults.look, defaults.paint], ['square', 'paper', 'terracotta']);
});

test('the drawn image contains a lesson or the Misogi only when chosen', () => {
  const week = buildWeekShareModel({ cells: weekCells(), mainDone: 3, mainTotal: 4, categories: [{ name: 'Deep work', color: '#5f7084', minutes: 300 }], scheduledMinutes: 300, streak: 4, lines: ['Guard the quiet hours'] });
  for (const format of SHARE_FORMATS) {
    for (const look of ['paper', 'ink']) {
      const plain = recordingContext();
      drawShareImage(plain, week, { format: format.id, look, line: 'Guard the quiet hours' });
      const text = plain.drawn.join(' ');
      assert.match(text, /The/, `${format.id}: the headline is drawn`);
      assert.match(text, /planner\.bemorin\.com/, `${format.id}: the address is drawn`);
      assert.match(text, /Daily Planner/);
      assert.doesNotMatch(text, /quiet hours/, `${format.id}/${look}: no lesson by default`);
      const chosen = recordingContext();
      drawShareImage(chosen, week, { format: format.id, look, includeLine: true, line: 'Guard the quiet hours' });
      assert.match(chosen.drawn.join(' '), /quiet hours/, `${format.id}: the chosen line is drawn`);
    }
  }
  const progress = buildProgressModel({ year: 2026, today: new Date(2026, 9, 23, 12), getRecord: key => (key === '2026-10-22' ? { endedAt: 'x' } : null) });
  const year = buildYearShareModel(progress, { misogi: 'Cross the Alps on foot' });
  for (const format of SHARE_FORMATS) {
    const plain = recordingContext();
    drawShareImage(plain, year, { format: format.id });
    assert.doesNotMatch(plain.drawn.join(' '), /Alps/, `${format.id}: no Misogi by default`);
    assert.match(plain.drawn.join(' '), /closed\./);
    const chosen = recordingContext();
    drawShareImage(chosen, year, { format: format.id, includeMisogi: true });
    assert.match(chosen.drawn.join(' '), /Alps/, `${format.id}: the chosen Misogi is drawn`);
  }
});

test('long names and lines are cut to fit instead of running off the image', () => {
  const name = 'An extraordinarily long category name that nobody would ever expect to fit anywhere';
  const line = 'word '.repeat(200).trim();
  const week = buildWeekShareModel({ cells: weekCells(), categories: [{ name, color: '#5f7084', minutes: 300 }], scheduledMinutes: 300, lines: [line] });
  const ctx = recordingContext();
  drawShareImage(ctx, week, { format: 'square', includeLine: true, line });
  assert.ok(!ctx.drawn.includes(name), 'the long name is shortened');
  assert.ok(ctx.drawn.some(value => value.startsWith('An extraordinarily') && value.endsWith('…')));
  assert.ok(ctx.drawn.some(value => value.endsWith('…”')), 'a shortened quote still closes its quotation mark');
  assert.ok(ctx.drawn.filter(value => value.includes('word')).length <= 3, 'the quote keeps to its lines');
});

test('describeShare and file names', () => {
  const week = buildWeekShareModel({ cells: weekCells(), mainDone: 3, mainTotal: 4, categories: [{ name: 'Deep work', color: '#5f7084', minutes: 90 }], scheduledMinutes: 90, streak: 9, lines: ['Keep it light'] });
  const words = describeShare(week, { locale: 'en-GB' });
  // ICU versions differ on the spaces around a range dash ("19–23" or "19 – 23"): compare without them.
  const plain = text => text.replace(/\s/g, ' ').replace(/ ?– ?/g, '–');
  assert.match(plain(words), /^Your week of 19–23 October 2026: 4 of 5 days closed, 3 of 4 main outcomes, a 9-day streak, 1h 30m scheduled\.$/);
  assert.doesNotMatch(words, /Keep it light/);
  assert.match(describeShare(week, { includeLine: true, line: 'Keep it light', locale: 'en-GB' }), /“Keep it light”/);
  assert.equal(shareFileName(week, 'square'), 'daily-planner-week-2026-10-19.png');
  assert.equal(shareFileName(week, 'story'), 'daily-planner-week-2026-10-19-story.png');
  assert.equal(shareFileName({ kind: 'year', year: 2026 }, 'landscape'), 'daily-planner-2026-landscape.png');
  assert.equal(plain(weekRangeLabel('2026-12-28', '2027-01-01', 'en-GB')), '28 December 2026–1 January 2027');
  assert.equal(weekRangeLabel('2026-10-23', '2026-10-23', 'en-GB'), '23 October 2026');
});

test('formats are drawn at full size: feed, story and link', () => {
  assert.deepEqual(SHARE_FORMATS.map(format => [format.id, format.width, format.height]), [['square', 1080, 1080], ['story', 1080, 1920], ['landscape', 1200, 630]]);
});

test('image palettes match the painted-year palettes of the app', async () => {
  const year = await readFile(new URL('../styles/year.css', import.meta.url), 'utf8');
  const horizon = await readFile(new URL('../styles/horizon.css', import.meta.url), 'utf8');
  const theme = await readFile(new URL('../styles/theme.css', import.meta.url), 'utf8');
  const { PAINT_PALETTES } = await import('../src/features/paint-palettes.js');
  assert.deepEqual(Object.keys(SHARE_PAINTS).sort(), PAINT_PALETTES.map(palette => palette.id).sort(), 'one image palette per painted-year palette');
  assert.match(horizon, new RegExp(`--hz-misogi: ${SHARE_PAINTS.terracotta.paper.paint};`));
  assert.match(theme, new RegExp(`--hz-misogi: ${SHARE_PAINTS.terracotta.ink.paint};`));
  for (const [id, looks] of Object.entries(SHARE_PAINTS)) {
    if (id === 'terracotta') continue;
    assert.match(year, new RegExp(`\\.hz-palette--${id} \\{ --hz-paint: ${looks.paper.paint};`), `${id} light`);
    assert.match(year, new RegExp(`:root\\[data-theme="dark"\\] \\.hz-palette--${id} \\{ --hz-paint: ${looks.ink.paint};`), `${id} dark`);
  }
});

test('colours: full paint on the top level, a lighter ramp below, a little lift on ink', () => {
  assert.equal(mixHex('#000000', '#ffffff', 0.5), '#808080');
  assert.equal(mixHex('#a5522e', '#ffffff', 1), '#a5522e');
  const paper = shareColors('ocean', 'paper');
  assert.equal(paper.levels[3], '#2b6a99');
  assert.equal(paper.bg, '#f6f3ed');
  const ink = shareColors('ocean', 'ink');
  assert.equal(ink.levels[3], '#6db0de');
  assert.equal(ink.bg, '#151412');
  assert.notEqual(ink.levels[1], mixHex('#6db0de', ink.card, 0.34), 'ink lifts the lightest level so one day still shows');
  assert.equal(shareColors('sunset', 'paper').levels[2], '#e2704c', 'a palette may give its own ramp');
  assert.equal(shareColors('nope', 'nope').paint, '#a5522e');
});
