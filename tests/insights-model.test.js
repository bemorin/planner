import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ENOUGH, OTHER, THIN_FINDING, UNCATEGORIZED, binTrend, buildFindings, buildInsights, carryFinding, dayInsight, focusFinding,
  inSentence, insightsRange, outcomeFinding, shiftYearKey, streakFinding, trendFinding, weekStartKey, weekdayFinding, yoyFinding
} from '../src/features/insights-model.js';
import { buildProgressModel, computeStreak } from '../src/features/progress-model.js';
import { addDaysKey, dateFromKey } from '../src/lib/dates.js';
import { sampleCategoryFor, sampleDay, SAMPLE_PLANNING_DAYS } from './support/insights-sample.js';
import { renderInsights, renderInsightsEntry, hoursText, spanLabel } from '../src/features/insights-view.js';

// Tuesday 20 October 2026
const TODAY = '2026-10-20';
const weekdayOf = key => dateFromKey(key).getDay();
const closedDay = (extra = {}) => ({ endedAt: '2026-01-01T18:00:00Z', priorities: [{ text: 'Ship', done: true }, { text: '' }, { text: '' }], tasks: [], blocks: [], ...extra });
const categories = { deep: { id: 'deep', name: 'Deep work', color: '#5f7084' }, admin: { id: 'admin', name: 'Admin', color: '#746e67' } };
const categoryFor = id => categories[id] || null;

function build(records, { kind = 'year', anchor = TODAY, today = TODAY, planningDays = [1, 2, 3, 4, 5], cache, startHour = 7, endHour = 20 } = {}) {
  const range = insightsRange(kind, anchor, today, { weekStartsOn: 1 });
  return buildInsights({ range, readDay: key => records[key] || null, categoryFor, planningDays, todayKey: today, weekStartsOn: 1, cache, startHour, endHour });
}

// ---------------------------------------------------------------------------
// Ranges
// ---------------------------------------------------------------------------

test('a year range runs from January 1 to today, with twelve month bins and calendar weeks', () => {
  const range = insightsRange('year', TODAY, TODAY, { weekStartsOn: 1 });
  assert.equal(range.startKey, '2026-01-01');
  assert.equal(range.endKey, TODAY);
  assert.equal(range.fullEndKey, '2026-12-31');
  assert.equal(range.bins.length, 12);
  assert.equal(range.binKind, 'month');
  assert.equal(range.bins[9].current, true, 'October is in progress');
  assert.equal(range.bins[10].future, true);
  assert.equal(range.weeks[0].startKey, '2026-01-01', 'the first week is clipped to the year');
  assert.equal(range.weeks[1].startKey, '2026-01-05', 'then Monday weeks');
  assert.equal(range.prevAnchor, '2025-01-01');
  assert.equal(range.nextAnchor, '', 'no future year');
  const past = insightsRange('year', '2025-03-04', TODAY);
  assert.equal(past.endKey, '2025-12-31');
  assert.equal(past.nextAnchor, '2026-01-01');
  assert.equal(insightsRange('year', TODAY, TODAY, { minYear: 2026 }).prevAnchor, '', 'nothing before the first year with data');
});

test('a quarter is the calendar quarter; four weeks are the 28 days ending on the anchor', () => {
  const quarter = insightsRange('quarter', TODAY, TODAY, { weekStartsOn: 1 });
  assert.deepEqual([quarter.startKey, quarter.endKey, quarter.fullEndKey, quarter.quarter], ['2026-10-01', TODAY, '2026-12-31', 4]);
  assert.equal(quarter.prevAnchor, '2026-07-01');
  assert.equal(quarter.nextAnchor, '');
  assert.equal(quarter.bins.length, 14, 'Sep 28 – Jan 3 touches fourteen Monday weeks');
  const q1 = insightsRange('quarter', '2026-02-10', TODAY);
  assert.equal(q1.prevAnchor, '2025-10-01');
  assert.equal(q1.nextAnchor, '2026-04-01');
  const weeks = insightsRange('weeks', TODAY, TODAY);
  assert.deepEqual([weeks.startKey, weeks.endKey, weeks.bins.length], ['2026-09-23', TODAY, 4]);
  assert.equal(weeks.bins[3].endKey, TODAY, 'rolling weeks end today, so none is partial');
  assert.equal(weeks.prevAnchor, '2026-09-22');
  assert.equal(insightsRange('weeks', '2026-09-22', TODAY).nextAnchor, TODAY);
  assert.equal(insightsRange('nonsense', '', TODAY).kind, 'year');
  assert.equal(insightsRange('year', '2027-05-01', TODAY).endKey, TODAY, 'an anchor in the future falls back to today');
});

test('dates shift by a year safely and weeks start on the chosen day', () => {
  assert.equal(shiftYearKey('2024-02-29', 1), '2025-02-28');
  assert.equal(shiftYearKey('2026-10-20', -1), '2025-10-20');
  assert.equal(weekStartKey('2026-10-20', 1), '2026-10-19');
  assert.equal(weekStartKey('2026-10-20', 0), '2026-10-18');
});

// ---------------------------------------------------------------------------
// Day facts
// ---------------------------------------------------------------------------

test('dayInsight reads outcomes, blocks and what happened at close', () => {
  assert.equal(dayInsight(null), null);
  const fact = dayInsight({
    endedAt: '2026-10-19T18:00:00Z',
    priorities: [{ text: 'Ship it', done: true }, { text: 'Call Anna', done: false }, { text: '  ' }],
    tasks: [{ text: 'Mail', done: true }, { text: '' }, { text: 'Renew passport', done: false, carriedCount: 4, originDay: '2026-09-01' }],
    blocks: [{ start: 540, duration: 90, categoryId: 'deep' }, { start: 700, duration: 0 }, { start: -5, duration: 5000, categoryId: 'admin', carriedCount: 2, title: 'Inbox' }, null],
    closeTransfers: [{ mode: 'date' }, { mode: 'later' }, { mode: 'drop' }, { mode: 'date' }]
  });
  assert.equal(fact.closed, true);
  assert.equal(fact.mitSet, true);
  assert.equal(fact.mitDone, true);
  assert.deepEqual([fact.otherSet, fact.otherDone, fact.tasksSet, fact.tasksDone], [1, 0, 2, 1]);
  assert.equal(fact.blocks.length, 2, 'empty and broken blocks are skipped');
  assert.deepEqual(fact.blocks[1], { start: 0, duration: 1440, categoryId: 'admin' }, 'start and duration are clamped to one day');
  assert.equal(fact.minutes, 90 + 1440);
  assert.deepEqual(fact.transfers, { carried: 2, saved: 1, forgotten: 1 });
  assert.deepEqual(fact.moved.map(item => [item.text, item.count]), [['Renew passport', 4], ['Inbox', 2]]);
  const legacy = dayInsight({ endedAt: 'x', triaged: ['task:t1@2026-10-21', 'priority:p2:later', 'task:t9:drop', 'block:b1@2026-10-22'] });
  assert.deepEqual(legacy.transfers, { carried: 2, saved: 1, forgotten: 1 }, 'older days fall back to the triage strings');
  assert.deepEqual(dayInsight({ triaged: ['task:t1@2026-10-21'] }).transfers, { carried: 0, saved: 0, forgotten: 0 }, 'an open day has no transfers');
});

// ---------------------------------------------------------------------------
// Rhythm
// ---------------------------------------------------------------------------

test('weekday rates count planning days since the first closed day, and today only once closed', () => {
  const records = {};
  // Four weeks: every Monday and Tuesday closed, Wednesdays closed half the time, Fridays never.
  for (let key = '2026-09-21'; key < TODAY; key = addDaysKey(key, 1)) {
    const day = weekdayOf(key);
    if (day === 1 || day === 2 || (day === 3 && key < '2026-10-05')) records[key] = closedDay({ priorities: [{ text: 'Main', done: day === 1 }] });
    if (day === 5) records[key] = { priorities: [{ text: 'Main', done: false }], blocks: [] };
  }
  records[TODAY] = { priorities: [{ text: 'Main', done: false }] };
  const model = build(records, { kind: 'weeks' });
  const row = weekday => model.rhythm.weekdays[weekday];
  // The range starts Wed 23 Sep; the first closed day in the scan is Mon 21 Sep.
  assert.deepEqual([row(1).closed, row(1).days], [4, 4]);
  assert.deepEqual([row(2).closed, row(2).days], [3, 3], 'today (a Tuesday, not closed yet) is not counted');
  assert.deepEqual([row(3).closed, row(3).days], [2, 4]);
  assert.equal(row(3).closeRate, 0.5);
  assert.deepEqual([row(5).closed, row(5).days, row(5).mitSet, row(5).mitDone], [0, 4, 4, 0]);
  assert.equal(row(1).mitRate, 1);
  assert.equal(row(6).planning, false);
  assert.deepEqual(model.rhythm.order, [1, 2, 3, 4, 5, 6, 0]);
  assert.equal(model.totals.closed, 9);
  assert.equal(model.totals.eligible, 19, 'planning days only');
});

test('the heatmap spreads blocks over the hours they cover, past midnight onto the next weekday', () => {
  const records = {
    '2026-10-12': { blocks: [{ start: 9 * 60 + 30, duration: 105, categoryId: 'deep' }] }, // Mon 9:30–11:15
    '2026-10-13': { blocks: [{ start: 23 * 60, duration: 120, categoryId: 'admin' }] }, // Tue 23:00–01:00
    '2026-10-19': { endedAt: 'x', blocks: [{ start: 9 * 60, duration: 60, categoryId: 'deep' }] } // Mon 9:00–10:00
  };
  const model = build(records, { kind: 'weeks', startHour: 8, endHour: 18 });
  const { cells, firstHour, lastHour, occurrences } = model.rhythm.heat;
  assert.equal(cells[1][9].minutes, 30 + 60);
  assert.equal(cells[1][10].minutes, 60);
  assert.equal(cells[1][11].minutes, 15);
  assert.equal(cells[2][23].minutes, 60);
  assert.equal(cells[3][0].minutes, 60, 'the hour after midnight belongs to Wednesday');
  assert.equal(firstHour, 0, 'the grid widens to hours that have time');
  assert.equal(lastHour, 24);
  assert.equal(occurrences[1], 2, 'Mondays since the first active day');
  assert.equal(cells[1][9].avg, 45);
  assert.equal(cells[3][0].avg, 60, 'one Wednesday so far, fully scheduled after midnight');
  assert.equal(cells[3][0].level, 5, 'the busiest cell is the darkest step');
  assert.equal(cells[1][9].level, 4, 'levels are fifths of the busiest cell');
  assert.equal(cells[4][9].level, 0, 'nothing scheduled is the empty step');
});

// ---------------------------------------------------------------------------
// Where the time goes
// ---------------------------------------------------------------------------

test('hours add up by category and month; deleted categories share "No category"; many fold into one panel', () => {
  const records = {
    '2026-01-05': { blocks: [{ start: 540, duration: 120, categoryId: 'deep' }, { start: 700, duration: 30, categoryId: 'gone' }] },
    '2026-03-02': { blocks: [{ start: 540, duration: 60, categoryId: 'deep' }, { start: 600, duration: 45, categoryId: 'admin' }, { start: 700, duration: 15 }] }
  };
  const model = build(records);
  const deep = model.time.categories.find(entry => entry.id === 'deep');
  assert.equal(deep.values[0], 120);
  assert.equal(deep.values[2], 60);
  assert.equal(deep.minutes, 180);
  const none = model.time.categories.find(entry => entry.id === UNCATEGORIZED.id);
  assert.equal(none.minutes, 45, 'a deleted category and no category share one row');
  assert.equal(model.time.total, 270);
  assert.ok(Math.abs(model.time.categories.reduce((sum, entry) => sum + entry.share, 0) - 1) < 1e-9);

  const many = {};
  const lots = {};
  for (let index = 0; index < 8; index += 1) lots[`c${index}`] = { id: `c${index}`, name: `Cat ${index}`, color: '#336699' };
  many['2026-02-02'] = { blocks: Object.keys(lots).map((id, index) => ({ start: 300 + index * 60, duration: 60 + index, categoryId: id })) };
  const folded = buildInsights({ range: insightsRange('year', TODAY, TODAY), readDay: key => many[key] || null, categoryFor: id => lots[id] || null, todayKey: TODAY });
  assert.equal(folded.time.categories.length, 6);
  assert.equal(folded.time.categories[5].id, OTHER.id);
  assert.equal(folded.time.categories[5].name, '3 other categories');
});

test('a trend compares recent finished bins with the earlier ones and needs six of them', () => {
  const bins = Array.from({ length: 12 }, (_, index) => ({ future: index > 9, current: index === 9 }));
  assert.equal(binTrend([0, 0, 0, 0, 600, 600, 600, 600, 600, 999, 0, 0], bins), null, 'five finished bins since the first with time are too few');
  const rising = binTrend([600, 600, 600, 600, 600, 600, 900, 900, 900, 50, 0, 0], bins);
  assert.equal(rising.direction, 'up');
  assert.equal(rising.recentBins, 3);
  assert.ok(Math.abs(rising.change - 0.5) < 1e-9, 'the bin in progress is left out');
  assert.equal(binTrend([600, 600, 600, 600, 600, 600, 620, 640, 600, 0, 0, 0], bins).direction, 'steady');
  assert.equal(binTrend([10, 10, 0, 0, 0, 10, 0, 0, 0, 0, 0, 0], bins), null, 'too few minutes to say');
  assert.equal(binTrend([300, 300, 300, 300, 300, 300, 0, 0, 0, 0, 0, 0], bins).direction, 'stopped', 'nothing lately is not "down 100%"');
  assert.equal(binTrend([600, 600, 600], bins.slice(0, 3)), null);
});

// ---------------------------------------------------------------------------
// Outcomes, carry-over, streaks, year over year
// ---------------------------------------------------------------------------

test('main outcomes per week carry a four-week average that reaches back before the period', () => {
  const records = {};
  // Every weekday from 7 Sep: main outcome done on Mondays, Wednesdays and Fridays.
  for (let key = '2026-09-07'; key < TODAY; key = addDaysKey(key, 1)) {
    const day = weekdayOf(key);
    if (day >= 1 && day <= 5) records[key] = closedDay({ priorities: [{ text: 'Main', done: day % 2 === 1 }] });
  }
  const model = build(records, { kind: 'weeks' });
  const weeks = model.outcomes.weeks;
  assert.equal(weeks.length, 4);
  // Rolling weeks: 23–29 Sep (Wed, Fri, Mon 28 → 3), 30 Sep–6 Oct (Wed, Fri, Mon 5 → 3), 7–13 Oct (3), 14–20 Oct (Wed, Fri, Mon 19 → 3).
  assert.deepEqual(weeks.map(week => week.done), [3, 3, 3, 3]);
  assert.equal(weeks[0].avg, (1 + 3 + 3 + 3) / 4, 'the three weeks before count (2–8 Sep has only Monday 7)');
  assert.equal(model.outcomes.enough, true);
  assert.equal(model.totals.mitDone, 12);
});

test('unfinished work counts carried, saved and forgotten items, and items moved again and again', () => {
  const records = {
    '2026-10-12': closedDay({ closeTransfers: [{ mode: 'date' }, { mode: 'date' }, { mode: 'later' }], tasks: [{ text: 'Renew passport', carriedCount: 3, originDay: '2026-09-01' }] }),
    '2026-10-13': closedDay({ closeTransfers: [{ mode: 'drop' }], tasks: [{ text: 'Renew passport', carriedCount: 4, originDay: '2026-09-01' }, { text: 'Call the bank', carriedCount: 1, done: true }] }),
    '2026-10-14': { tasks: [{ text: 'renew passport ', carriedCount: 5, originDay: '2026-09-01' }] }
  };
  const model = build(records, { kind: 'weeks' });
  assert.deepEqual([model.carry.carried, model.carry.saved, model.carry.forgotten, model.carry.decided, model.carry.closedDays], [2, 1, 1, 4, 2]);
  assert.equal(model.carry.perDay, 2);
  assert.deepEqual(model.carry.movedAgain.map(item => [item.text, item.count]), [['Renew passport', 5]], 'one item, at its highest count');
  assert.equal(model.carry.finishedAfterMove, 1);
});

test('streak runs follow Progress: rest days never break them, jokers bridge, and the longest matches computeStreak', () => {
  const closed = new Set();
  for (let key = '2026-08-03'; key < TODAY; key = addDaysKey(key, 1)) {
    const day = weekdayOf(key);
    if (day === 0 || day === 6) continue;
    if (['2026-08-19', '2026-09-08', '2026-09-09', '2026-09-10'].includes(key)) continue; // one joker; then three misses break it
    closed.add(key);
  }
  const records = Object.fromEntries([...closed].map(key => [key, closedDay()]));
  const model = build(records, { kind: 'quarter', anchor: '2026-08-15' });
  const reference = computeStreak({ today: dateFromKey('2026-09-30'), planningDays: [1, 2, 3, 4, 5], isClosed: key => closed.has(key) });
  assert.equal(model.streaks.longest.length, reference.best);
  assert.equal(model.streaks.longest.jokers >= 1, true);
  assert.equal(model.streaks.current, 0, 'a past period has no current streak');
  const now = build(records, { kind: 'year' });
  const today = computeStreak({ today: dateFromKey(TODAY), planningDays: [1, 2, 3, 4, 5], isClosed: key => closed.has(key) });
  assert.equal(now.streaks.current, today.current, 'the current streak agrees with Progress');
  assert.ok(now.streaks.bestMonth, 'a best month once a month has eight planning days');
  assert.equal(build(records, { kind: 'weeks' }).streaks.bestMonth, null, 'no best month for four weeks');
});

test('the close rate matches Progress for the year and each month, with today closed or not', () => {
  let seed = 7;
  const random = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (const todayClosed of [true, false]) {
    const records = {};
    for (let key = '2026-03-02'; key <= TODAY; key = addDaysKey(key, 1)) {
      const day = weekdayOf(key);
      const close = key === TODAY ? todayClosed : day >= 1 && day <= 5 ? random() < 0.75 : random() < 0.1;
      if (close) records[key] = closedDay();
    }
    const progress = buildProgressModel({ year: 2026, today: dateFromKey(TODAY), planningDays: [1, 2, 3, 4, 5], getRecord: key => records[key] || null });
    const model = build(records);
    const label = todayClosed ? 'today closed' : 'today open';
    assert.equal(model.totals.closed, progress.closed, label);
    assert.equal(model.totals.eligible, progress.planningElapsed, `${label}: today is never an elapsed planning day`);
    assert.equal(Math.round(model.totals.closeRate * 100), progress.closeRate, label);
    model.streaks.months.forEach(entry => {
      const month = progress.months[Number(entry.month.slice(5, 7)) - 1];
      assert.deepEqual([entry.closed, entry.eligible], [month.closed, month.planningElapsed], `${label}: ${entry.month}`);
    });
  }
});

test('the longest streak counts only the days inside the period, as Progress does', () => {
  const records = {};
  // Every weekday closed from November 2025 to the end of January 2026, then one week in June.
  for (let key = '2025-11-03'; key <= '2026-01-30'; key = addDaysKey(key, 1)) if (weekdayOf(key) >= 1 && weekdayOf(key) <= 5) records[key] = closedDay();
  for (let key = '2026-06-01'; key <= '2026-06-05'; key = addDaysKey(key, 1)) records[key] = closedDay();
  const progress = buildProgressModel({ year: 2026, today: dateFromKey(TODAY), planningDays: [1, 2, 3, 4, 5], getRecord: key => records[key] || null });
  const year = build(records);
  assert.equal(year.streaks.longest.length, progress.streak.yearBest);
  assert.equal(year.streaks.longest.length, 22, 'the 22 closed weekdays of January 2026');
  assert.deepEqual([year.streaks.longest.startKey, year.streaks.longest.endKey], ['2026-01-01', '2026-01-30']);
  assert.match(buildFindings(year).map(item => item.text).join(' '), /Your longest streak: 22 days, ending in January/);
  const last = build(records, { anchor: '2025-06-01' });
  const lastProgress = buildProgressModel({ year: 2025, today: dateFromKey(TODAY), planningDays: [1, 2, 3, 4, 5], getRecord: key => records[key] || null });
  assert.equal(last.streaks.longest.length, lastProgress.streak.yearBest);
  assert.equal(last.streaks.longest.length, 43, '2025 keeps its November and December weekdays');
  assert.equal(last.streaks.longest.endKey, '2025-12-31');
});

test('year over year compares the same dates and only when last year has something', () => {
  const records = {};
  for (let key = '2025-03-02'; key <= '2025-03-20'; key = addDaysKey(key, 1)) records[key] = closedDay({ blocks: [{ start: 540, duration: 60, categoryId: 'deep' }] });
  for (let key = '2026-03-02'; key <= '2026-03-31'; key = addDaysKey(key, 1)) records[key] = closedDay({ blocks: [{ start: 540, duration: 30, categoryId: 'deep' }] });
  records['2025-11-02'] = closedDay(); // after today's date last year: outside the comparison
  const model = build(records);
  assert.equal(model.yoy.available, true);
  assert.deepEqual([model.yoy.prevStart, model.yoy.prevEnd], ['2025-01-01', '2025-10-20']);
  assert.equal(model.yoy.previous.closed, 19);
  assert.equal(model.yoy.current.closed, 30);
  assert.equal(model.yoy.previous.minutes, 19 * 60);
  assert.equal(yoyFinding(model.yoy, model.range, TODAY).text, '11 more days closed than by this time last year.');
  const quiet = build({ '2026-03-02': closedDay() });
  assert.equal(quiet.yoy.available, false);
  assert.equal(yoyFinding(quiet.yoy, quiet.range, TODAY), null);
});

// ---------------------------------------------------------------------------
// Findings
// ---------------------------------------------------------------------------

const row = (weekday, closed, days, planning = true) => ({ weekday, planning, days, closed, closeRate: days ? closed / days : 0, name: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][weekday] });

test('weekday findings need enough days and name the strongest, a tie, an even week or the weakest', () => {
  const week = [row(0, 0, 10, false), row(1, 8, 10), row(2, 10, 10), row(3, 8, 10), row(4, 8, 10), row(5, 5, 10), row(6, 1, 10, false)];
  const found = weekdayFinding(week, { closed: 40 });
  assert.equal(found.text, 'Tuesdays are your strongest day: 100% closed.');
  assert.equal(found.weak.text, 'Fridays slip most often: 50% closed.');
  assert.equal(weekdayFinding(week, { closed: 4 }), null, 'too few closed days');
  assert.equal(weekdayFinding([row(1, 2, 3), row(2, 3, 3)], { closed: 40 }), null, 'too few days of each weekday');
  const tie = weekdayFinding([row(4, 9, 10), row(2, 9, 10), row(1, 5, 10)], { closed: 40 });
  assert.equal(tie.text, 'Tuesdays and Thursdays are your strongest days: 90% closed.', 'ties read in week order');
  const three = weekdayFinding([row(4, 4, 4), row(2, 4, 4), row(3, 4, 4), row(1, 3, 4), row(5, 2, 4)], { closed: 40 });
  assert.equal(three.text, 'Tuesdays, Wednesdays and Thursdays are your strongest days: 100% closed.');
  const even = weekdayFinding([row(1, 8, 10), row(2, 8, 10), row(3, 8, 10)], { closed: 40 });
  assert.equal(even.text, 'You close your days evenly across the week: about 80%.');
});

test('the focus finding needs hours in one category and a clear window', () => {
  const profile = new Array(24).fill(0);
  profile[9] = 200; profile[10] = 180; profile[14] = 100; profile[16] = 40;
  const deep = { id: 'deep', name: 'Deep work', minutes: 520 };
  assert.equal(focusFinding([deep], new Map([['deep', profile]])).text, 'Most of your deep work happens 9–11.');
  const spread = new Array(24).fill(0);
  [8, 9, 12, 13, 15, 16, 17].forEach(hour => { spread[hour] = 60; });
  spread[9] = 120; spread[10] = 30;
  const peaks = focusFinding([{ id: 'x', name: 'Spanish', minutes: 600 }], new Map([['x', spread]]));
  assert.match(peaks.text, /^Your Spanish peaks 8–10: \d+% of its hours\.$/);
  assert.equal(focusFinding([{ ...deep, minutes: ENOUGH.focusMinutes - 1 }], new Map([['deep', profile]])), null, 'too few hours');
  assert.equal(focusFinding([], new Map()), null);
  assert.equal(inSentence('Deep work'), 'deep work');
  assert.equal(inSentence('Spanish'), 'Spanish');
  assert.equal(inSentence('MBA prep'), 'MBA prep');
});

test('outcome, trend, carry and streak findings each have a floor', () => {
  const weeks = Array.from({ length: 10 }, (_, index) => ({ startKey: `w${index}`, endKey: `e${index}`, done: index < 6 ? 2 : 4, set: 5, future: false, current: false }));
  assert.equal(outcomeFinding({ weeks }, { mitSet: 50, mitDone: 30 }).text, 'Lately you finish 4 main outcomes a week, up from 2.');
  assert.equal(outcomeFinding({ weeks: weeks.slice(0, 5) }, { mitSet: 10, mitDone: 7 }).text, 'You finish your main outcome on 70% of the days you set one.');
  assert.equal(outcomeFinding({ weeks: [] }, { mitSet: 3, mitDone: 3 }), null);

  const learning = { id: 'learning', name: 'Learning', minutes: 900, trend: { direction: 'up', change: 0.4, recentBins: 3 } };
  assert.equal(trendFinding([learning], 'month').text, 'Learning is up 40% over the last 3 months.');
  assert.equal(trendFinding([{ ...learning, trend: { direction: 'up', change: 0.2, recentBins: 3 } }], 'month'), null, 'small moves are not news');
  assert.equal(trendFinding([{ ...learning, id: OTHER.id }], 'month'), null);

  assert.equal(carryFinding({ movedAgain: [{ text: 'Renew passport', count: 5, done: false }], decided: 3 }).text, '“Renew passport” has moved 5 times.');
  assert.equal(carryFinding({ movedAgain: [], decided: 20, carried: 14, forgotten: 2 }).text, 'At close, you carry 70% of unfinished work to another day.');
  assert.equal(carryFinding({ movedAgain: [], decided: 20, carried: 8, forgotten: 6 }).text, 'At close, you let go of 30% of what’s unfinished.');
  assert.equal(carryFinding({ movedAgain: [], decided: 4, carried: 4, forgotten: 0 }), null);

  assert.equal(streakFinding({ longest: { length: 4, endKey: '2026-03-10' }, current: 4 }), null);
  assert.equal(streakFinding({ longest: { length: 12, endKey: '2026-03-10' }, current: 12 }).text, 'You’re on your longest streak in this period: 12 days.');
  assert.equal(streakFinding({ longest: { length: 12, endKey: '2026-03-10' }, current: 2 }, { locale: 'en-US' }).text, 'Your longest streak: 12 days, ending in March.');
});

test('with nothing stored, Insights says what it needs instead of inventing anything', () => {
  const model = build({});
  assert.equal(model.thin, true);
  assert.deepEqual(model.findings, [THIN_FINDING]);
  assert.equal(THIN_FINDING.text, 'Close a few more days to see your rhythm.');
  assert.equal(model.rhythm.enough, false);
  assert.equal(model.rhythm.heat.enough, false);
  assert.equal(model.time.enough, false);
  assert.equal(model.outcomes.enough, false);
  assert.equal(model.streaks.longest, null);
  assert.equal(model.yoy.available, false);
  assert.ok(model.rhythm.weekdays.every(entry => entry.closeRate === 0 && entry.mitRate === 0), 'no NaN rates');
  assert.ok(model.outcomes.weeks.every(week => week.future || (week.before && week.avg === null)), 'weeks before any record are not zeros');
  const thin = build({ '2026-10-19': closedDay(), '2026-10-16': closedDay() });
  assert.deepEqual(buildFindings(thin), [THIN_FINDING], 'two closed days are still too few');
});

// ---------------------------------------------------------------------------
// Sample, speed, markup
// ---------------------------------------------------------------------------

test('the sample planner is stable, never in the future, and reads like a real year', () => {
  assert.deepEqual(sampleDay('2026-05-12', TODAY), sampleDay('2026-05-12', TODAY));
  assert.equal(sampleDay('2026-10-21', TODAY), null);
  assert.equal(sampleDay('2024-12-01', TODAY), null, 'the sample starts in March last year');
  const range = insightsRange('year', TODAY, TODAY);
  const model = buildInsights({ range, readDay: key => sampleDay(key, TODAY), categoryFor: sampleCategoryFor, planningDays: SAMPLE_PLANNING_DAYS, todayKey: TODAY });
  assert.equal(model.thin, false);
  assert.equal(model.findings.length, 4);
  assert.ok(model.findings.some(item => item.id === 'focus'));
  assert.equal(model.yoy.available, true);
  assert.ok(model.yoy.current.closed > model.yoy.previous.closed, 'steadier this year');
});

test('a full year of days builds quickly, and switching periods reads each past day once', () => {
  const records = {};
  for (let key = '2025-01-01'; key < TODAY; key = addDaysKey(key, 1)) {
    const day = weekdayOf(key);
    if (day === 0 || day === 6) continue;
    records[key] = JSON.stringify(closedDay({
      priorities: [{ text: 'Main', done: day !== 5 }, { text: 'Second', done: true }, { text: '' }],
      tasks: [{ text: 'Mail', done: true }, { text: 'Bank', done: false, carriedCount: 1 }],
      blocks: [{ start: 540, duration: 120, categoryId: 'deep' }, { start: 690, duration: 60, categoryId: 'admin' }, { start: 840, duration: 90, categoryId: 'deep' }, { start: 1110, duration: 45 }],
      closeTransfers: [{ mode: 'date' }, { mode: 'later' }]
    }));
  }
  let reads = 0;
  const readDay = key => { reads += 1; return records[key] ? JSON.parse(records[key]) : null; };
  const cache = new Map();
  const started = performance.now();
  const year = buildInsights({ range: insightsRange('year', TODAY, TODAY), readDay, categoryFor, todayKey: TODAY, cache });
  const elapsed = performance.now() - started;
  assert.ok(elapsed < 400, `a year built in ${elapsed.toFixed(1)} ms`);
  assert.equal(year.thin, false);
  const firstReads = reads;
  buildInsights({ range: insightsRange('quarter', TODAY, TODAY), readDay, categoryFor, todayKey: TODAY, cache });
  assert.ok(reads - firstReads <= 1, `the quarter re-read ${reads - firstReads} day(s): only today, which can still change`);
});

test('the markup escapes what people typed and every tooltip payload is valid JSON', () => {
  const evil = { id: 'evil', name: '<img src=x onerror=alert(1)>', color: 'red;background:url(x)' };
  const records = {};
  for (let key = '2026-06-01'; key < TODAY; key = addDaysKey(key, 1)) {
    const day = weekdayOf(key);
    if (day === 0 || day === 6) continue;
    records[key] = closedDay({ blocks: [{ start: 540, duration: 120, categoryId: 'evil' }], tasks: [{ text: '<b>moved</b>', carriedCount: 6, originDay: '2026-05-01' }], closeTransfers: [{ mode: 'date' }] });
  }
  const range = insightsRange('year', TODAY, TODAY);
  const model = buildInsights({ range, readDay: key => records[key] || null, categoryFor: id => (id === 'evil' ? evil : null), todayKey: TODAY });
  const html = renderInsights(model, { locale: 'en-US' });
  assert.ok(!html.includes('<img src=x'), 'category names are escaped');
  assert.ok(!html.includes('<b>moved</b>'), 'item text is escaped');
  assert.ok(!html.includes('url(x)'), 'a colour that is not a hex never reaches a style');
  const payloads = [...html.matchAll(/data-tip="([^"]*)"/g)].map(match => match[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'"));
  assert.ok(payloads.length > 50);
  payloads.forEach(payload => assert.doesNotThrow(() => JSON.parse(payload)));
  ['What stands out', 'Your rhythm', 'Where your time goes', 'Outcomes', 'Streaks', 'Year over year'].forEach(title => assert.ok(html.includes(title), title));
  // 1.39: Insights are for everyone: no locked preview, no sample, nothing to unlock.
  assert.doesNotMatch(html, /Plus|data-ins-unlock|ins-lock|is-sample|Sample/);
  const empty = renderInsights(build({}), {});
  assert.ok(empty.includes('Close a few more days to see your rhythm.') && !empty.includes('Your rhythm</h3>'), 'a thin period shows one calm panel');
  assert.match(renderInsightsEntry(2026), /data-horizon-insights="2026"[\s\S]*<strong>Insights<\/strong>/);
  assert.doesNotMatch(renderInsightsEntry(2026), /hz-plus-badge|Plus/);
  assert.equal(hoursText(45), '45 min');
  assert.equal(hoursText(450), '7.5 h');
  assert.equal(hoursText(74400), '1,240 h');
  assert.equal(spanLabel('2026-10-05', '2026-10-11', 'en-US'), 'Oct 5 – 11');
  assert.equal(spanLabel('2026-09-28', '2026-10-04', 'en-US'), 'Sep 28 – Oct 4');
});
