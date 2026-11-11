import test from 'node:test';
import assert from 'node:assert/strict';
import { monthGridCellCount } from '../src/ui/calendar-popover.js';

test('October 2026 (Monday-first) needs five weeks, not a trailing November week', () => {
  // 1 Oct 2026 is a Thursday: 3 leading days + 31 days = 34 cells → 5 rows.
  assert.equal(monthGridCellCount(2026, 9, 1), 35);
});

test('a month starting late in the week needs six rows', () => {
  // 1 Aug 2026 is a Saturday: 5 leading days + 31 days = 36 cells → 6 rows.
  assert.equal(monthGridCellCount(2026, 7, 1), 42);
});

test('a February that starts on the first weekday fits exactly in four rows', () => {
  // 1 Feb 2027 is a Monday and February 2027 has 28 days.
  assert.equal(monthGridCellCount(2027, 1, 1), 28);
  // The same month in a Sunday-first week needs five rows.
  assert.equal(monthGridCellCount(2027, 1, 0), 35);
});
