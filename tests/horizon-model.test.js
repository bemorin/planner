import test from 'node:test';
import assert from 'node:assert/strict';
import {
  rangeLabel,
  horizonCountdown,
  rangeOverlapsMonth,
  dayInRange,
  habitQuarterForMonth,
  habitQuarterBounds,
  habitActivityStats,
  horizonTabLine
} from '../src/features/horizon-model.js';
import { ymdKey } from '../src/lib/dates.js';

test('rangeLabel formats a single date and a same-month period', () => {
  assert.match(rangeLabel('2026-08-14'), /^14\s/);
  assert.match(rangeLabel('2026-08-14', '2026-08-18'), /^14–18\s/);
});

test('horizonCountdown handles future, current, active and past ranges', () => {
  const today = new Date(2026, 7, 14, 12);
  assert.equal(horizonCountdown('2026-08-15', '', false, today), 'tomorrow');
  assert.equal(horizonCountdown('2026-08-14', '', false, today), 'today');
  assert.equal(horizonCountdown('2026-08-10', '2026-08-20', false, today), 'under way');
  assert.equal(horizonCountdown('2026-08-10', '2026-08-13', false, today), '1 day ago');
  assert.equal(horizonCountdown('2026-08-10', '', true, today), 'Done');
});

test('month and day range helpers preserve inclusive boundaries', () => {
  assert.equal(rangeOverlapsMonth('2026-07-30', '2026-08-02', 2026, 7), true);
  assert.equal(rangeOverlapsMonth('2026-09-01', '', 2026, 7), false);
  assert.equal(dayInRange('2026-08-14', '2026-08-14', '2026-08-16'), true);
  assert.equal(dayInRange('2026-08-17', '2026-08-14', '2026-08-16'), false);
});

test('quarter helpers keep Q3 anchored to the full Jul-Sep quarter', () => {
  assert.equal(habitQuarterForMonth(7), 2);
  const { start, end } = habitQuarterBounds(2026, 2);
  assert.equal(ymdKey(start), '2026-07-01');
  assert.equal(ymdKey(end), '2026-09-30');
});

test('habit tracking may start mid-quarter without changing quarter bounds', () => {
  const data = {
    habitStartedAt: ['', '', '2026-08-13', ''],
    habitChecks: {
      '2026-08-13': [2],
      '2026-08-14': [2]
    }
  };
  const stats = habitActivityStats(data, 2, 2026, new Date(2026, 7, 14, 12));
  assert.equal(ymdKey(stats.start), '2026-07-01');
  assert.equal(ymdKey(stats.end), '2026-09-30');
  assert.equal(ymdKey(stats.trackingStart), '2026-08-13');
  assert.equal(stats.quarterDays, 92);
  assert.equal(stats.elapsed, 2);
  assert.equal(stats.done, 2);
  assert.equal(stats.longest, 2);
});

test('the Horizon tab says what comes next on the year, else the days left', () => {
  const model = (upcoming, extra = {}) => ({ isCurrentYear: true, todayKey: '2026-10-21', daysInYear: 365, dayOfYear: 294, upcoming, ...extra });
  const keyDate = { kind: 'keydate', startDate: '2026-11-14', endDate: '2026-11-14' };
  const october = { kind: 'adventure', startDate: '2026-10-01', endDate: '2026-10-31' };
  assert.match(horizonTabLine(model([keyDate])), /^Next 14\s/);
  assert.match(horizonTabLine(model([october, keyDate])), /^Next 14\s/, 'a period under way does not hide what comes next');
  assert.equal(horizonTabLine(model([october, { kind: 'keydate', startDate: '2026-10-21', endDate: '' }, keyDate])), 'Today');
  assert.equal(horizonTabLine(model([october])), '71 days left');
  assert.equal(horizonTabLine(model([], { dayOfYear: 364 })), '1 day left');
  assert.equal(horizonTabLine(model([], { dayOfYear: 365 })), 'Last day of the year');
  assert.equal(horizonTabLine(model([keyDate], { isCurrentYear: false })), '');
  assert.equal(horizonTabLine(null), '');
});
