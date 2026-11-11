import test from 'node:test';
import assert from 'node:assert/strict';
import { buildProgressModel } from '../src/features/progress-model.js';
import {
  CHECKIN_AFTER_DAYS,
  CHECKIN_BEFORE_DAYS,
  applyDates,
  bestRun,
  buildQuarterReview,
  carriedId,
  carryAdventure,
  carryState,
  checkInOptions,
  checkInWindow,
  completeQuarterReview,
  defaultCheckInQuarter,
  ensureQuarterReviews,
  horizonItemsInRange,
  lastPlanningDayOfQuarter,
  leftovers,
  markQuarterNudged,
  monthLead,
  monthRows,
  moveOptions,
  nextHabitEditable,
  nextQuarter,
  normalizeQuarterEntry,
  parseQuarterKey,
  previousQuarter,
  quarterBounds,
  quarterEntry,
  quarterHabit,
  quarterKey,
  quarterLead,
  quarterNudgeFor,
  quarterOf,
  quarterPreview,
  quarterSeasonCard,
  renderQuarterCard,
  renderQuarterMenuItem,
  renderQuarterNudge,
  setItemDone,
  setNextHabit,
  setQuarterAnswer,
  shiftKeyByMonths,
  toggleCarry,
  uncarryAdventure,
  weekdayOrder
} from '../src/features/quarter-review.js';
import { readFile } from 'node:fs/promises';
import { ANSWER_SIZES, NEXT_LONG, QUARTER_PRINT_CAPS, fitQuarterAnswers, quarterPrintPeriod, renderQuarterPrint, takeInTurn } from '../src/features/quarter-print.js';

const at = (y, m, d) => new Date(y, m - 1, d, 12);
const icon = (name, className = '') => `<svg data-icon="${name}"${className ? ` class="${className}"` : ''}></svg>`;
const closedDay = (extra = {}) => ({ endedAt: 'x', priorities: [{ text: 'Ship', done: true }], blocks: [], memory: '', lesson: '', ...extra });

// ---------------------------------------------------------------------------
// Quarters and the check-in season
// ---------------------------------------------------------------------------

test('quarter boundaries cover the year without gaps, leap years included', () => {
  assert.deepEqual(quarterBounds(2026, 0), { start: '2026-01-01', end: '2026-03-31', months: [0, 1, 2], days: 90 });
  assert.equal(quarterBounds(2028, 0).days, 91, 'Q1 of a leap year');
  assert.deepEqual(quarterBounds(2026, 1), { start: '2026-04-01', end: '2026-06-30', months: [3, 4, 5], days: 91 });
  assert.equal(quarterBounds(2026, 2).end, '2026-09-30');
  assert.deepEqual(quarterBounds(2026, 3), { start: '2026-10-01', end: '2026-12-31', months: [9, 10, 11], days: 92 });
  assert.equal([0, 1, 2, 3].reduce((sum, quarter) => sum + quarterBounds(2026, quarter).days, 0), 365);
  assert.equal(quarterOf(at(2026, 3, 31)), 0);
  assert.equal(quarterOf(at(2026, 4, 1)), 1);
  assert.equal(quarterOf(at(2026, 12, 31)), 3);
});

test('quarters step across years, and keys round-trip', () => {
  assert.deepEqual(nextQuarter({ year: 2026, quarter: 3 }), { year: 2027, quarter: 0 });
  assert.deepEqual(nextQuarter({ year: 2026, quarter: 1 }), { year: 2026, quarter: 2 });
  assert.deepEqual(previousQuarter({ year: 2027, quarter: 0 }), { year: 2026, quarter: 3 });
  assert.equal(quarterKey({ year: 2026, quarter: 2 }), '2026-Q3');
  assert.deepEqual(parseQuarterKey('2026-Q3'), { year: 2026, quarter: 2 });
  assert.equal(parseQuarterKey('2026-Q5'), null);
  assert.equal(parseQuarterKey(''), null);
  assert.equal(parseQuarterKey(undefined), null);
});

test('the check-in is in season from two weeks before a quarter ends to four weeks after', () => {
  assert.equal(CHECKIN_BEFORE_DAYS, 14);
  assert.equal(CHECKIN_AFTER_DAYS, 28);
  assert.equal(checkInWindow(at(2026, 9, 16)), null, 'fifteen days before the end');
  assert.deepEqual(checkInWindow(at(2026, 9, 17)), { year: 2026, quarter: 2, phase: 'closing', daysLeft: 13, daysSince: 0 });
  assert.deepEqual(checkInWindow(at(2026, 9, 30)), { year: 2026, quarter: 2, phase: 'closing', daysLeft: 0, daysSince: 0 });
  assert.deepEqual(checkInWindow(at(2026, 10, 1)), { year: 2026, quarter: 2, phase: 'closed', daysLeft: 0, daysSince: 1 });
  assert.equal(checkInWindow(at(2026, 10, 28)).quarter, 2, 'the 28th day after');
  assert.equal(checkInWindow(at(2026, 10, 29)), null);
  assert.equal(checkInWindow(at(2026, 8, 12)), null, 'mid-quarter');
  // Q4's check-in reaches into January of the next year.
  assert.deepEqual(checkInWindow(at(2027, 1, 10)), { year: 2026, quarter: 3, phase: 'closed', daysLeft: 0, daysSince: 10 });
  assert.equal(checkInWindow(at(2026, 12, 20)).phase, 'closing');
});

test('the check-in opens on the quarter in season, else on the quarter under way', () => {
  assert.deepEqual(defaultCheckInQuarter(at(2026, 10, 20)), { year: 2026, quarter: 2 });
  assert.deepEqual(defaultCheckInQuarter(at(2026, 8, 12)), { year: 2026, quarter: 2 });
  assert.deepEqual(defaultCheckInQuarter(at(2026, 11, 15)), { year: 2026, quarter: 3 });
  assert.deepEqual(defaultCheckInQuarter(at(2027, 1, 5)), { year: 2026, quarter: 3 });
});

test('the quarters a check-in can look back on run from the first Horizon year to now', () => {
  assert.deepEqual(checkInOptions(at(2026, 10, 20), 2026).map(quarterKey), ['2026-Q1', '2026-Q2', '2026-Q3', '2026-Q4']);
  // In January, last year's Q4 is always there even when Horizon started this year.
  assert.deepEqual(checkInOptions(at(2027, 1, 10), 2027).map(quarterKey), ['2026-Q1', '2026-Q2', '2026-Q3', '2026-Q4', '2027-Q1']);
  assert.equal(checkInOptions(at(2026, 5, 1), 2025).length, 6);
});

// ---------------------------------------------------------------------------
// Week starts
// ---------------------------------------------------------------------------

test('calendar months follow the planner’s first day of the week', () => {
  assert.deepEqual(weekdayOrder(1), [1, 2, 3, 4, 5, 6, 0]);
  assert.deepEqual(weekdayOrder(0), [0, 1, 2, 3, 4, 5, 6]);
  assert.deepEqual(weekdayOrder(6), [6, 0, 1, 2, 3, 4, 5]);
  assert.deepEqual(weekdayOrder('junk'), [0, 1, 2, 3, 4, 5, 6]);
  // 1 September 2026 is a Tuesday.
  assert.equal(monthLead(2026, 8, 1), 1);
  assert.equal(monthLead(2026, 8, 0), 2);
  assert.equal(monthLead(2026, 8, 6), 3);
  // 1 February 2026 is a Sunday: the last column of a Monday week.
  assert.equal(monthLead(2026, 1, 1), 6);
  assert.equal(monthRows(2026, 1, 1), 5);
  assert.equal(monthRows(2026, 1, 0), 4, 'February 2026 fills four Sunday weeks exactly');
  assert.equal(monthRows(2026, 7, 1), 6, 'August 2026 starts on a Saturday');
});

// ---------------------------------------------------------------------------
// The look-back model
// ---------------------------------------------------------------------------

const categories = { deep: { id: 'deep', name: 'Deep work', color: '#5f7084' }, admin: { id: 'admin', name: 'Admin', color: '#746e67' } };

function quarterData(extra = {}) {
  return {
    misogi: 'Ride the Pyrenees',
    misogiStartDate: '2026-08-24',
    misogiEndDate: '2026-08-30',
    misogiDone: true,
    misogiMilestones: [
      { id: 'm0', text: 'Before the quarter', done: true, date: '2026-06-30' },
      { id: 'm1', text: 'First day of the quarter', done: true, date: '2026-07-01' },
      { id: 'm2', text: 'Last day of the quarter', done: false, date: '2026-09-30' },
      { id: 'm3', text: 'After it', done: false, date: '2026-10-01' },
      { id: 'm4', text: '  ', done: false, date: '2026-08-01' },
      { id: 'm5', text: 'Undated', done: false, date: '' }
    ],
    miniAdventures: [
      { id: 'a1', text: 'Starts in June, ends in July', startDate: '2026-06-28', endDate: '2026-07-02', status: 'done', done: true },
      { id: 'a2', text: 'Wild camping', startDate: '2026-08-01', endDate: '2026-08-31', status: 'planned', done: false },
      { id: 'a3', text: 'Runs into October', startDate: '2026-09-28', endDate: '2026-10-03', status: 'planned', done: false },
      { id: 'a4', text: 'An idea', startDate: '', endDate: '', status: 'idea', done: false },
      { id: 'a5', text: 'November', startDate: '2026-11-13', endDate: '', status: 'planned', done: false }
    ],
    meaningful: ['', '', ''],
    habits: ['', '', 'Mobility', ''],
    habitStartedAt: ['', '', '2026-07-01', ''],
    habitChecks: { '2026-07-01': [2], '2026-07-02': [2], '2026-07-03': [2], '2026-08-03': [2], '2026-09-30': [2], '2026-10-01': [3] },
    months: { '2026-08': { outcomes: [], anchors: [{ id: 'k1', text: 'Holidays', startDate: '2026-08-10', endDate: '2026-08-21' }] }, '2026-11': { outcomes: [], anchors: [{ id: 'k2', text: 'Birthday', startDate: '2026-11-14', endDate: '' }] } },
    ...extra
  };
}

function records() {
  return {
    '2026-06-30': closedDay({ memory: 'June, never counted', blocks: [{ duration: 600, categoryId: 'deep' }] }),
    '2026-07-01': closedDay({ memory: 'Kayak at dawn', blocks: [{ duration: 120, categoryId: 'deep' }, { duration: 60, categoryId: 'admin' }] }),
    '2026-07-02': closedDay({ lesson: 'Start earlier', blocks: [{ duration: 90, categoryId: 'deep' }, { duration: 30, categoryId: 'gone' }] }),
    '2026-07-03': closedDay({ priorities: [{ text: 'Plan', done: false }], memory: '  Kayak   at dawn ' }),
    '2026-07-06': { priorities: [{ text: 'Not closed', done: true }], blocks: [{ duration: 45, categoryId: 'admin' }], memory: 'An open day is not in the journal' },
    '2026-09-30': closedDay({ lesson: 'Say the hard thing early', blocks: [{ duration: 30 }] }),
    '2026-10-01': closedDay({ memory: 'Next quarter, ignored', blocks: [{ duration: 999, categoryId: 'deep' }] })
  };
}

function build({ today = at(2026, 10, 20), data = quarterData(), nextYearData = null, previousEntry = null, weekStartsOn = 1, quarter = 2, year = 2026 } = {}) {
  const store = records();
  const readDay = key => store[key] || null;
  const progress = buildProgressModel({ year, today, planningDays: [1, 2, 3, 4, 5], getRecord: readDay, yearData: data });
  return buildQuarterReview({ year, quarter, progress, yearData: data, nextYearData, previousEntry, readDay, categoryFor: id => categories[id] || null, weekStartsOn, today });
}

test('the look back counts the quarter’s closed days, outcomes, time and journal only', () => {
  const review = build();
  assert.equal(review.id, 'Q3');
  assert.equal(review.label, 'Q3 2026');
  assert.equal(review.status, 'past');
  assert.equal(review.days.closed, 4, '1, 2, 3 July and 30 September');
  assert.equal(review.outcomes.done, 3);
  assert.equal(review.outcomes.share, 75);
  assert.ok(review.days.planningElapsed >= 60);
  assert.equal(review.days.closeRate, Math.round(4 / review.days.planningElapsed * 100));
  assert.equal(review.time.total, 120 + 60 + 90 + 30 + 45 + 30, 'blocks of open days count as scheduled time');
  assert.equal(review.time.days, 4);
  assert.deepEqual(review.time.rows.map(row => row.name), ['Deep work', 'Admin', 'No category']);
  assert.equal(review.time.rows[2].minutes, 60, 'unknown and missing categories share one row');
  assert.deepEqual(review.journal.memories.map(entry => entry.text), ['Kayak at dawn'], 'the same words on two days are kept once');
  assert.equal(review.journal.memories[0].key, '2026-07-03', 'at the latest day');
  assert.deepEqual(review.journal.lessons.map(entry => entry.text), ['Say the hard thing early', 'Start earlier']);
  assert.equal(review.months.length, 3);
  assert.deepEqual(review.months.map(month => month.days.length), [31, 31, 30]);
  assert.equal(review.months[0].lead, 2, '1 July 2026 is a Wednesday');
  assert.equal(review.months[0].days[0].state, 'l3', 'closed, outcome done, habit kept');
  assert.equal(review.months[0].days[2].state, 'l2', '3 July: habit kept, outcome not done');
  assert.equal(review.months[0].days[3].state, 'rest', 'a Saturday');
  assert.equal(review.weekdays.length, 7);
  assert.equal(review.isEmpty, false);
});

test('the best run inside a quarter ignores rest days and jokers, and breaks on a missed day', () => {
  const cell = (closed, planning = true, extra = {}) => ({ closed, planning, ...extra });
  assert.equal(bestRun([cell(true), cell(true), cell(false, false), cell(true), cell(false), cell(true)]), 3);
  assert.equal(bestRun([cell(true), cell(false, true, { joker: true }), cell(true), cell(true)]), 3);
  assert.equal(bestRun([cell(true), cell(false, true, { future: true }), cell(true)]), 2);
  assert.equal(bestRun([]), 0);
  assert.equal(bestRun([null, cell(true)]), 1);
});

test('Horizon items in range include the quarter’s first and last days and periods that overlap it', () => {
  const items = horizonItemsInRange(quarterData(), '2026-07-01', '2026-09-30');
  assert.deepEqual(items.milestones.map(item => item.id), ['m1', 'm2']);
  assert.deepEqual(items.adventures.map(item => item.id), ['a1', 'a2', 'a3']);
  assert.equal(items.misogi.text, 'Ride the Pyrenees');
  assert.deepEqual(items.keyDates.map(item => item.id), ['k1']);
  assert.equal(horizonItemsInRange(quarterData(), '2026-01-01', '2026-03-31').misogi, null);
  assert.deepEqual(horizonItemsInRange({}, '2026-01-01', '2026-03-31'), { misogi: null, milestones: [], adventures: [], keyDates: [] });
  const review = build();
  assert.equal(review.horizon.lived, 1);
  assert.equal(review.horizon.milestonesDone, 1);
});

test('the quarter’s winning habit is measured from its first tracked day, month by month', () => {
  const habit = quarterHabit(quarterData(), 2026, 2, at(2026, 10, 20));
  assert.equal(habit.text, 'Mobility');
  assert.equal(habit.elapsed, 92);
  assert.equal(habit.done, 5, 'the 1 October check belongs to Q4');
  assert.equal(habit.longest, 3);
  assert.equal(habit.percent, 5);
  assert.deepEqual(habit.months.map(month => [month.done, month.elapsed]), [[3, 31], [1, 31], [1, 30]]);
  // While the quarter runs, only the days so far count.
  const running = quarterHabit(quarterData(), 2026, 2, at(2026, 7, 10));
  assert.equal(running.elapsed, 10);
  assert.equal(running.done, 3);
  assert.equal(running.percent, 30);
  assert.deepEqual(quarterHabit(quarterData(), 2026, 0, at(2026, 10, 20)), { quarter: 0, text: '', set: false, done: 0, elapsed: 0, percent: null, longest: 0, months: [] });
});

test('an empty quarter is calm, not broken', () => {
  const review = buildQuarterReview({ year: 2026, quarter: 0, today: at(2026, 10, 20) });
  assert.equal(review.isEmpty, true);
  assert.equal(review.days.closed, 0);
  assert.equal(review.days.closeRate, 0);
  assert.equal(review.days.bestRun, 0);
  assert.equal(review.time.total, 0);
  assert.deepEqual(review.time.rows, []);
  assert.deepEqual(review.journal, { memories: [], lessons: [] });
  assert.equal(review.habit.set, false);
  assert.equal(review.next.id, 'Q2');
  assert.equal(review.next.habit, '');
  assert.ok(review.months.every(month => month.days.every(day => day.state === 'empty')));
  assert.match(quarterLead(review), /^A quiet quarter/);
  // A quarter still ahead reads no day records at all.
  let reads = 0;
  const future = buildQuarterReview({ year: 2026, quarter: 3, today: at(2026, 8, 1), readDay: () => { reads += 1; return null; } });
  assert.equal(future.status, 'future');
  assert.equal(reads, 0);
  assert.ok(future.months.every(month => month.days.every(day => day.state === 'future')));
});

test('a quarter under way counts up to today and says so', () => {
  const review = build({ today: at(2026, 9, 20) });
  assert.equal(review.status, 'current');
  assert.equal(review.isCurrent, true);
  assert.equal(review.asOf, '2026-09-20');
  assert.equal(review.daysLeft, 10);
  assert.equal(review.days.closed, 3, '30 September has not happened yet');
  assert.match(quarterLead(review), /^So far, 3 days closed/);
  assert.equal(quarterPrintPeriod(review), '1 July – 20 September 2026');
  assert.equal(quarterPrintPeriod(build()), '1 July – 30 September 2026');
});

test('the lead line names what the quarter held', () => {
  assert.equal(quarterLead(build()), '4 days closed, the Misogi accomplished, 1 of 3 mini‑adventures lived and 6.3 h scheduled.');
  const data = quarterData({ misogiDone: false, miniAdventures: [] });
  assert.equal(quarterLead(build({ data })), '4 days closed and 6.3 h scheduled.');
});

test('the next quarter’s habit comes from the same year, or from the next one after Q4', () => {
  const data = quarterData();
  data.habits[3] = 'Write three lines';
  assert.equal(build({ data }).next.habit, 'Write three lines');
  const q4 = build({ data, quarter: 3, today: at(2027, 1, 10), nextYearData: { habits: ['Read before bed', '', '', ''] } });
  assert.deepEqual([q4.next.year, q4.next.id, q4.next.habit], [2027, 'Q1', 'Read before bed']);
  assert.equal(build({ previousEntry: { focus: '  Finish the draft ' } }).previousFocus, 'Finish the draft');
});

// ---------------------------------------------------------------------------
// Saving: answers, completion, the next habit, moves
// ---------------------------------------------------------------------------

test('answers are saved per quarter with clean values', () => {
  const d = {};
  assert.equal(setQuarterAnswer(d, 2, 'wentWell', 'The ride.\nAnd the mornings.'), true);
  assert.equal(setQuarterAnswer(d, 2, 'change', 'x'.repeat(900)), true);
  assert.equal(setQuarterAnswer(d, 2, 'focus', 'One\nline'), true);
  assert.equal(setQuarterAnswer(d, 2, 'other', 'nope'), false);
  assert.equal(setQuarterAnswer(d, 7, 'focus', 'nope'), false);
  assert.deepEqual(Object.keys(d.quarterReviews), ['Q3']);
  const entry = quarterEntry(d, 2);
  assert.equal(entry.wentWell, 'The ride.\nAnd the mornings.', 'answers keep their lines');
  assert.equal(entry.change.length, 600);
  assert.equal(entry.focus, 'One line');
  assert.equal(entry.done, false);
  assert.equal(completeQuarterReview(d, 2, at(2026, 10, 14)), true);
  assert.equal(completeQuarterReview(d, 2, at(2026, 10, 20)), true);
  assert.deepEqual([quarterEntry(d, 2).done, quarterEntry(d, 2).completedAt], [true, '2026-10-14'], 'the first completion day is kept');
  assert.equal(quarterEntry(d, 1).done, false, 'other quarters are untouched');
  markQuarterNudged(d, 3);
  assert.equal(quarterEntry(d, 3).nudged, true);
});

test('saved check-ins from an edited backup or another device are cleaned, and newer fields survive', () => {
  const d = { quarterReviews: { Q1: { done: 'yes', wentWell: 42, focus: 'a\nb', completedAt: 'soon', mood: 'calm' }, Q9: { done: true }, junk: 1, Q2: null } };
  const reviews = ensureQuarterReviews(d);
  assert.deepEqual(Object.keys(reviews), ['Q1', 'Q2']);
  assert.deepEqual(reviews.Q1, { done: true, wentWell: '42', change: '', focus: 'a b', completedAt: '', mood: 'calm' });
  assert.deepEqual(normalizeQuarterEntry(null), { done: false, wentWell: '', change: '', focus: '', completedAt: '' });
  assert.deepEqual(ensureQuarterReviews({ quarterReviews: ['Q1'] }), {});
});

test('the next quarter’s habit is set with Horizon’s semantics', () => {
  const d = quarterData();
  // In October, Q4 is under way but nothing has been tracked yet: it can be chosen here.
  assert.equal(nextHabitEditable(d, { year: 2026, quarter: 3 }, at(2026, 10, 20)), true);
  assert.equal(setNextHabit(d, { year: 2026, quarter: 3 }, 'Write\nthree lines', at(2026, 10, 20)), true);
  assert.equal(d.habits[3], 'Write three lines');
  assert.equal(d.habitStartedAt[3], '2026-10-20', 'tracking starts today');
  // Once tracked, it is changed in Horizon (which asks first).
  d.habitChecks['2026-10-21'] = [3];
  assert.equal(nextHabitEditable(d, { year: 2026, quarter: 3 }, at(2026, 10, 22)), false);
  assert.equal(setNextHabit(d, { year: 2026, quarter: 3 }, 'Something else', at(2026, 10, 22)), false);
  // Before its quarter starts, the habit waits for it.
  const next = {};
  assert.equal(setNextHabit(next, { year: 2027, quarter: 0 }, 'Read before bed', at(2026, 12, 20)), true);
  assert.deepEqual([next.habits[0], next.habitStartedAt[0]], ['Read before bed', '']);
});

test('left-over milestones and adventures are the quarter’s unfinished ones', () => {
  const left = leftovers(quarterData(), 2026, 2);
  assert.deepEqual(left.map(item => `${item.kind}:${item.id}`), ['milestone:m2', 'adventure:a2'], 'an adventure still under way after the quarter is not left over');
});

test('quick dates keep the day in each month of the next quarter', () => {
  assert.equal(shiftKeyByMonths('2026-01-31', 1), '2026-02-28');
  assert.equal(shiftKeyByMonths('2026-11-30', 3), '2027-02-28');
  assert.equal(shiftKeyByMonths('2028-01-31', 1), '2028-02-29');
  const milestone = { kind: 'milestone', id: 'm2', startDate: '2026-09-30', endDate: '' };
  const september = at(2026, 9, 20);
  assert.deepEqual(moveOptions(milestone, { year: 2026, quarter: 2 }, september).map(option => option.startDate), ['2026-10-30', '2026-11-30', '2026-12-30']);
  const month = { kind: 'adventure', id: 'a2', startDate: '2026-08-01', endDate: '2026-08-31' };
  assert.deepEqual(moveOptions(month, { year: 2026, quarter: 2 }, september).map(option => [option.startDate, option.endDate, option.label]), [['2026-10-01', '2026-10-31', 'Oct'], ['2026-11-01', '2026-11-30', 'Nov'], ['2026-12-01', '2026-12-31', 'Dec']], 'a whole month moves as a whole month');
  const weekend = { kind: 'adventure', id: 'x', startDate: '2026-03-28', endDate: '2026-03-30' };
  assert.deepEqual(moveOptions(weekend, { year: 2026, quarter: 0 }, at(2026, 3, 20)).map(option => [option.startDate, option.endDate]), [['2026-04-28', '2026-04-30'], ['2026-05-28', '2026-05-30'], ['2026-06-28', '2026-06-30']], 'a period keeps its length');
  assert.deepEqual(moveOptions(milestone, { year: 2026, quarter: 3 }, september), [], 'Q4 items stay with their year');
});

test('quick dates are never in the past: today at the earliest, and the weeks ahead after a late check-in', () => {
  const today = at(2026, 10, 20);
  const milestone = { kind: 'milestone', id: 'm3', startDate: '2026-07-19', endDate: '' };
  // In the check-in season, Q4 has begun: 19 October has passed, so the October chip is today.
  assert.deepEqual(moveOptions(milestone, { year: 2026, quarter: 2 }, today).map(option => [option.startDate, option.label]), [['2026-10-20', '20 Oct'], ['2026-11-19', '19 Nov'], ['2026-12-19', '19 Dec']]);
  const month = { kind: 'adventure', id: 'a2', startDate: '2026-08-01', endDate: '2026-08-31' };
  assert.deepEqual(moveOptions(month, { year: 2026, quarter: 2 }, today).map(option => [option.startDate, option.endDate, option.label]), [['2026-10-20', '2026-10-31', '20–31 Oct'], ['2026-11-01', '2026-11-30', 'Nov'], ['2026-12-01', '2026-12-31', 'Dec']], 'the rest of a month already begun');
  const weekend = { kind: 'adventure', id: 'x', startDate: '2026-09-12', endDate: '2026-09-14' };
  assert.deepEqual(moveOptions(weekend, { year: 2026, quarter: 2 }, today)[0], { startDate: '2026-10-20', endDate: '2026-10-22', label: '20–22 Oct' }, 'a period moved to today keeps its length');
  assert.deepEqual(moveOptions(milestone, { year: 2026, quarter: 2 }, at(2026, 11, 20)).map(option => option.startDate), ['2026-11-20', '2026-12-19'], 'a month already over is left out');
  // A late check-in on Q1 in October: Q2 is over, so the chips are the months ahead in the same year.
  const spring = { kind: 'milestone', id: 'm1', startDate: '2026-02-26', endDate: '' };
  assert.deepEqual(moveOptions(spring, { year: 2026, quarter: 0 }, today).map(option => option.startDate), ['2026-10-26', '2026-11-26', '2026-12-26']);
  assert.deepEqual(moveOptions(spring, { year: 2026, quarter: 0 }, at(2026, 12, 28)).map(option => option.startDate), ['2026-12-28'], 'never past December');
  assert.deepEqual(moveOptions(spring, { year: 2025, quarter: 0 }, today), [], 'a year that is over keeps its dates');
  for (const day of [at(2026, 7, 1), at(2026, 10, 1), at(2026, 10, 20), at(2026, 12, 31)]) {
    for (const quarter of [0, 1, 2]) {
      moveOptions(milestone, { year: 2026, quarter }, day).forEach(option => assert.ok(option.startDate >= '2026-' + String(day.getMonth() + 1).padStart(2, '0') + '-' + String(day.getDate()).padStart(2, '0'), `${option.startDate} on ${day.toDateString()}`));
    }
  }
});

test('the model says when the next quarter is under way or already over', () => {
  assert.equal(buildQuarterReview({ year: 2026, quarter: 2, today: at(2026, 9, 20) }).next.status, 'future');
  assert.equal(buildQuarterReview({ year: 2026, quarter: 2, today: at(2026, 10, 20) }).next.status, 'current');
  const late = buildQuarterReview({ year: 2026, quarter: 0, today: at(2026, 10, 20) });
  assert.deepEqual([late.next.status, late.next.end], ['past', '2026-06-30']);
});

test('a move rewrites the item, ticking marks it done, and both can be undone', () => {
  const d = quarterData();
  assert.equal(applyDates(d, 'milestone', 'm2', { startDate: '2026-11-30' }), true);
  assert.equal(d.misogiMilestones.find(item => item.id === 'm2').date, '2026-11-30');
  assert.equal(applyDates(d, 'adventure', 'a2', { startDate: '2026-11-01', endDate: '2026-11-30' }), true);
  assert.deepEqual((({ startDate, endDate, month, status }) => ({ startDate, endDate, month, status }))(d.miniAdventures.find(item => item.id === 'a2')), { startDate: '2026-11-01', endDate: '2026-11-30', month: 10, status: 'planned' });
  assert.equal(applyDates(d, 'adventure', 'missing', { startDate: '2026-11-01' }), false);
  assert.equal(applyDates(d, 'milestone', 'm2', { startDate: 'soon' }), false);
  assert.equal(setItemDone(d, 'adventure', 'a2', true), true);
  assert.equal(d.miniAdventures.find(item => item.id === 'a2').status, 'done');
  assert.equal(setItemDone(d, 'adventure', 'a2', false), true);
  assert.equal(d.miniAdventures.find(item => item.id === 'a2').status, 'planned');
  assert.equal(setItemDone(d, 'milestone', 'm2', true), true);
  assert.equal(d.misogiMilestones.find(item => item.id === 'm2').done, true);
});

test('Q4 carries a mini-adventure into next year once, as an idea, and can take it back', () => {
  const next = { miniAdventures: [{ id: 'n1', text: 'Already there', startDate: '', endDate: '', status: 'idea', done: false }] };
  let n = 0;
  const id = carryAdventure(next, 'Wild camping', () => `new-${++n}`);
  assert.equal(id, 'new-1');
  assert.equal(carryAdventure(next, '  wild CAMPING ', () => `new-${++n}`), 'new-1', 'never twice');
  assert.equal(carriedId(next, 'Wild camping'), 'new-1');
  assert.deepEqual(next.miniAdventures[1], { id: 'new-1', text: 'Wild camping', startDate: '', endDate: '', month: 0, status: 'idea', done: false, nextStep: '' });
  assert.equal(uncarryAdventure(next, 'new-1'), true);
  assert.equal(carriedId(next, 'Wild camping'), '');
  const full = { miniAdventures: Array.from({ length: 6 }, (_, index) => ({ id: `f${index}`, text: `A${index}` })) };
  assert.equal(carryAdventure(full, 'One more', () => 'x'), '', 'six at most');
  const planned = { miniAdventures: [{ id: 'p', text: 'Planned since', startDate: '2027-03-01', done: false }] };
  assert.equal(uncarryAdventure(planned, 'p'), false, 'an adventure given dates since stays');
  const stepped = { miniAdventures: [{ id: 's', text: 'With a next step', startDate: '', done: false, nextStep: 'Book the hut' }] };
  assert.equal(uncarryAdventure(stepped, 's'), false, 'an idea given a next step stays');
});

test('Q4 only takes back the ideas its own check-in carried, remembered with the check-in', () => {
  const d = { miniAdventures: [{ id: 'a1', text: 'Wild camping' }, { id: 'a2', text: 'Learn to surf' }], quarterReviews: {} };
  const next = { miniAdventures: [{ id: 'mine', text: 'Learn to surf', startDate: '', endDate: '', status: 'idea', done: false, nextStep: 'Find a school in Hossegor' }] };
  const camping = { kind: 'adventure', id: 'a1', text: 'Wild camping' };
  const surf = { kind: 'adventure', id: 'a2', text: 'Learn to surf' };
  let n = 0;
  const makeId = () => `new-${++n}`;
  // An idea of the same name already on next year's list is shown as there and never removed from here.
  assert.equal(carryState(d, next, 3, surf), 'listed');
  assert.equal(toggleCarry(d, next, 3, surf, makeId), false);
  assert.deepEqual(next.miniAdventures.map(item => [item.id, item.nextStep]), [['mine', 'Find a school in Hossegor']]);
  // One the check-in carries is remembered by id, and a second press takes back only that one.
  assert.equal(carryState(d, next, 3, camping), 'open');
  assert.equal(toggleCarry(d, next, 3, camping, makeId), true);
  assert.deepEqual(quarterEntry(d, 3).carried, { a1: 'new-1' });
  assert.equal(carryState(d, next, 3, camping), 'carried');
  assert.equal(toggleCarry(d, next, 3, camping, makeId), true);
  assert.equal(quarterEntry(d, 3).carried, undefined);
  assert.deepEqual(next.miniAdventures.map(item => item.id), ['mine']);
  // Carried again, then planned in Horizon: it stays.
  toggleCarry(d, next, 3, camping, makeId);
  next.miniAdventures.find(item => item.id === 'new-2').startDate = '2027-05-01';
  assert.equal(carryState(d, next, 3, camping), 'kept');
  assert.equal(toggleCarry(d, next, 3, camping, makeId), false);
  assert.equal(next.miniAdventures.length, 2);
  // The memory travels with the saved check-in, cleaned like the rest of it.
  const saved = JSON.parse(JSON.stringify(d));
  ensureQuarterReviews(saved);
  assert.deepEqual(saved.quarterReviews.Q4.carried, { a1: 'new-2' });
  assert.equal(normalizeQuarterEntry({ carried: { a1: 3, '': 'x', a2: 'ok' } }).carried.a2, 'ok');
  assert.deepEqual(Object.keys(normalizeQuarterEntry({ carried: { a1: 3, '': 'x', a2: 'ok' } }).carried), ['a2']);
  assert.equal('carried' in normalizeQuarterEntry({ carried: ['a1'] }), false);
  const full = { miniAdventures: Array.from({ length: 6 }, (_, index) => ({ id: `f${index}`, text: `A${index}` })) };
  assert.equal(carryState({}, full, 3, { id: 'x', text: 'One more' }), 'full');
});

// ---------------------------------------------------------------------------
// The Close-day nudge
// ---------------------------------------------------------------------------

test('the nudge comes on the last planning day of a quarter, once, and not after a check-in', () => {
  assert.equal(lastPlanningDayOfQuarter(2026, 2, [1, 2, 3, 4, 5]), '2026-09-30', 'a Wednesday');
  assert.equal(lastPlanningDayOfQuarter(2026, 3, [1, 2, 3, 4, 5]), '2026-12-31');
  assert.equal(lastPlanningDayOfQuarter(2026, 1, [1, 2, 3, 4, 5]), '2026-06-30');
  assert.equal(lastPlanningDayOfQuarter(2026, 0, [1, 2, 3, 4, 5]), '2026-03-31');
  assert.equal(lastPlanningDayOfQuarter(2027, 2, [1, 2, 3, 4, 5]), '2027-09-30');
  assert.equal(lastPlanningDayOfQuarter(2026, 3, [6]), '2026-12-26', 'Saturdays only');
  assert.equal(lastPlanningDayOfQuarter(2026, 3, []), '');
  const d = {};
  assert.deepEqual(quarterNudgeFor({ dayKey: '2026-09-30', planningDays: [1, 2, 3, 4, 5], yearData: d }), { year: 2026, quarter: 2 });
  assert.equal(quarterNudgeFor({ dayKey: '2026-09-29', planningDays: [1, 2, 3, 4, 5], yearData: d }), null);
  markQuarterNudged(d, 2);
  assert.equal(quarterNudgeFor({ dayKey: '2026-09-30', planningDays: [1, 2, 3, 4, 5], yearData: d }), null, 'once');
  const done = {};
  completeQuarterReview(done, 3, at(2026, 12, 20));
  assert.equal(quarterNudgeFor({ dayKey: '2026-12-31', planningDays: [1, 2, 3, 4, 5], yearData: done }), null);
  assert.equal(quarterNudgeFor({ dayKey: 'nope', planningDays: [1], yearData: {} }), null);
  const html = renderQuarterNudge({ year: 2026, quarter: 2 });
  assert.match(html, /last planning day of Q3/);
  assert.match(html, /data-quarter-nudge="2026-Q3"/);
});

// ---------------------------------------------------------------------------
// Entry points and the printed page
// ---------------------------------------------------------------------------

test('the Overview card shows in season, previews the quarter and opens for everyone, with no badge (1.39)', () => {
  const data = quarterData();
  const store = records();
  const progress = buildProgressModel({ year: 2026, today: at(2026, 10, 20), planningDays: [1, 2, 3, 4, 5], getRecord: key => store[key] || null, yearData: data });
  const preview = quarterPreview({ year: 2026, quarter: 2, progress, yearData: data, today: at(2026, 10, 20) });
  assert.deepEqual(preview, { closed: 4, closeRate: preview.closeRate, habit: 5, lived: 1, adventures: 3 });
  const card = (options = {}) => quarterSeasonCard({ today: at(2026, 10, 20), shownYear: 2026, yearData: () => data, progress: () => progress, icon, ...options });
  const free = card();
  assert.match(free, /data-horizon-quarter="2026-Q3"/);
  assert.match(free, /Your Q3 check-in/);
  assert.match(free, /<b>4<\/b> days closed/);
  assert.match(free, /Habit kept <b>5%<\/b>/);
  assert.match(free, /aria-label="Your Q3 check-in, about 10 minutes"/);
  assert.doesNotMatch(free, /hz-plus-badge|Plus/);
  assert.equal(card({ today: at(2026, 8, 12) }), '', 'out of season');
  assert.equal(card({ shownYear: 2027 }), '', 'another year');
  assert.match(quarterSeasonCard({ today: at(2027, 1, 10), shownYear: 2027, yearData: () => data, progress: () => progress, icon }), /Your Q4 check-in/, 'Q4 shows on the new year in January');
  assert.match(renderQuarterCard({ window: { year: 2026, quarter: 2, phase: 'closing', daysLeft: 1 }, icon }), /Q3 ends tomorrow/);
  completeQuarterReview(data, 2, at(2026, 10, 14));
  const done = card();
  assert.match(done, /is-done/);
  assert.match(done, /Q3 checked in on/);
  assert.doesNotMatch(done, /hz-quarter-pills/);
  const item = renderQuarterMenuItem({ at: { year: 2026, quarter: 2 } });
  assert.match(item, /role="menuitem"/);
  assert.match(item, /Look back on Q3, set up Q4/);
  assert.match(item, /<em>10 min<\/em>/);
  assert.doesNotMatch(item, /hz-plus-badge|Plus/);
});

test('the printed quarter escapes what was written and leaves out what is empty', () => {
  const data = quarterData();
  setQuarterAnswer(data, 2, 'wentWell', '<b>bold</b> & "quoted"');
  setQuarterAnswer(data, 2, 'focus', 'Finish the draft');
  const html = renderQuarterPrint(build({ data }), { icon, palette: 'ocean' });
  assert.match(html, /class="qv qv--paint-ocean"/);
  assert.match(html, /&lt;b&gt;bold&lt;\/b&gt; &amp; &quot;quoted&quot;/);
  assert.doesNotMatch(html, /<b>bold<\/b>/);
  assert.match(html, /Q3 2026<span>, in review<\/span>/);
  assert.match(html, /Finish the draft/);
  assert.match(html, /Winning habit/);
  assert.match(html, /In Horizon this quarter/);
  assert.match(html, /From the journal/);
  assert.match(html, /What I’ll do differently in Q4/);
  assert.equal((html.match(/class="qv-month"/g) || []).length, 3);
  assert.equal(QUARTER_PRINT_CAPS.horizon, 6);
  // Nothing at all: no story, the page grows quiet, lines to write on stay.
  const empty = renderQuarterPrint(buildQuarterReview({ year: 2026, quarter: 0, today: at(2026, 10, 20) }), { icon, palette: 'unknown' });
  assert.match(empty, /class="qv qv--quiet qv--notime"/);
  assert.doesNotMatch(empty, /qv-band--story/);
  assert.doesNotMatch(empty, /Where the time went/);
  assert.match(empty, /qv-lines/);
});

test('the printed page caps long lists with a “more” line, taking milestones and adventures in turn', () => {
  const data = quarterData({ miniAdventures: Array.from({ length: 6 }, (_, index) => ({ id: `a${index}`, text: `Adventure ${index}`, startDate: `2026-07-1${index}`, endDate: '', status: 'planned', done: false })) });
  const html = renderQuarterPrint(build({ data }), { icon });
  // Misogi + 2 milestones + 6 adventures = 9 lines → 5 shown and "+4 more".
  assert.match(html, /\+4 more/);
  assert.equal((html.match(/qv-check--milestone/g) || []).length, 2);
  assert.equal((html.match(/qv-check--adventure/g) || []).length, 2);
  assert.deepEqual(takeInTurn([[1], [2, 3, 4, 5], [6, 7, 8]], 5), [1, 2, 3, 6, 7]);
  assert.deepEqual(takeInTurn([[], [2, 3], [6]], 9), [2, 3, 6]);
  assert.deepEqual(takeInTurn([[1, 2]], 0), []);
});

test('the printed answers keep every word: sized to fit, never clamped by CSS, long words wrapped', async () => {
  const data = quarterData();
  const long = `${'We shipped the redesign early and kept the mornings for deep work. '.repeat(9)}`.slice(0, 600);
  setQuarterAnswer(data, 2, 'wentWell', long);
  setQuarterAnswer(data, 2, 'change', Array.from({ length: 12 }, (_, index) => `Change ${index + 1}`).join('\n'));
  setQuarterAnswer(data, 2, 'focus', `Ship it: ${'x'.repeat(140)}`);
  const html = renderQuarterPrint(build({ data }), { icon });
  assert.ok(html.includes(`<p>${long.trim()}</p>`), 'the whole answer is on the page');
  assert.match(html, /Change 1\nChange 2[\s\S]*Change 12<\/p>/, 'line breaks kept');
  assert.match(html, /<dd class="is-long">Ship it: x+<\/dd>/, `a habit or focus over ${NEXT_LONG} characters prints a size smaller`);
  const css = await readFile(new URL('../styles/quarter.css', import.meta.url), 'utf8');
  const rule = selector => new RegExp(`(?:^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{([^}]*)\\}`).exec(css)?.[1] || '';
  assert.ok(rule('.qv-answer p'), 'the answer rule exists');
  assert.doesNotMatch(rule('.qv-answer p'), /line-clamp/, 'no fixed clamp hides an answer');
  assert.match(rule('.qv-answer p'), /flex: 0 1 auto/, 'an answer takes the room it needs and the ruled lines the rest');
  assert.match(rule('.qv-next dd'), /overflow-wrap: anywhere/, 'a long word wraps inside the Next card');
  assert.deepEqual(ANSWER_SIZES, ['', 'qv-answer--s', 'qv-answer--xs']);
  ANSWER_SIZES.filter(Boolean).forEach(size => assert.match(css, new RegExp(`\\.${size} p \\{`), size));
  assert.match(css, /\.print-sheet--quarter\.is-measuring \{[^}]*width: 267\.4mm/, 'measured on Letter, the narrower page');
  assert.doesNotThrow(() => fitQuarterAnswers(null));
  assert.doesNotThrow(() => fitQuarterAnswers({ querySelector: () => null }));
});

test('Enter that confirms an input method’s composition stays in the answer', async () => {
  const source = await readFile(new URL('../src/features/quarter-session.js', import.meta.url), 'utf8');
  const handler = /function onKeydown\(event\) \{([\s\S]*?)\n  \}/.exec(source)?.[1] || '';
  assert.match(handler.split('\n')[2] || '', /if \(!session \|\| event\.isComposing \|\| event\.keyCode === 229\) return;/, 'checked before Enter moves on');
});
