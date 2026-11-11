import test from 'node:test';
import assert from 'node:assert/strict';
import {
  activeWeekdays,
  isPlanningDay,
  nextPlanningDateFrom,
  previousPlanningDateFrom,
  firstPlanningSlotAfter,
  planningWeekDates,
  planningWeekStart
} from '../src/domain/planning-calendar.js';
import { ymdKey } from '../src/lib/dates.js';

test('activeWeekdays honors explicit planning days and removes duplicates', () => {
  assert.deepEqual(activeWeekdays({ planningDays: [1, 2, 2, 5, 9] }), [1, 2, 5]);
});

test('activeWeekdays preserves legacy start/end behavior', () => {
  assert.deepEqual(activeWeekdays({ weekStartDay: 5, weekEndDay: 1 }), [5, 6, 0, 1]);
});

test('planning-day helpers find the next configured day without mutating the input', () => {
  const settings = { planningDays: [1, 3, 5], weekStartsOn: 1 };
  const tuesday = new Date(2026, 7, 11, 9, 30);
  const next = nextPlanningDateFrom(tuesday, settings);
  assert.equal(ymdKey(next), '2026-08-12');
  assert.equal(ymdKey(tuesday), '2026-08-11');
  assert.equal(isPlanningDay(next, settings), true);
});

test('planning-day helpers find the previous configured day without mutating the input', () => {
  const settings = { planningDays: [1, 3, 5], weekStartsOn: 1 };
  const monday = new Date(2026, 7, 17, 9, 30);
  const previous = previousPlanningDateFrom(monday, settings);
  assert.equal(ymdKey(previous), '2026-08-14');
  assert.equal(ymdKey(monday), '2026-08-17');
  assert.equal(isPlanningDay(previous, settings), true);
});

test('planningWeekStart and planningWeekDates share one configured week definition', () => {
  const settings = { planningDays: [1, 3, 5], weekStartsOn: 1 };
  const friday = new Date(2026, 7, 14);
  assert.equal(ymdKey(planningWeekStart(friday, settings)), '2026-08-10');
  assert.deepEqual(planningWeekDates(friday, settings).map(ymdKey), [
    '2026-08-10',
    '2026-08-12',
    '2026-08-14'
  ]);
});


test('first planning slot stays on the current planning day when the next full hour fits', () => {
  const settings = { planningDays: [1, 2, 3, 4, 5] };
  const friday = new Date(2026, 7, 14, 16, 23);
  const slot = firstPlanningSlotAfter(friday, settings, { startMinutes: 8 * 60, endMinutes: 18 * 60 });
  assert.equal(ymdKey(slot.date), '2026-08-14');
  assert.equal(slot.startMinutes, 17 * 60);
});

test('first planning slot skips the weekend when onboarding finishes after visible hours', () => {
  const settings = { planningDays: [1, 2, 3, 4, 5] };
  const fridayEvening = new Date(2026, 7, 14, 18, 56);
  const slot = firstPlanningSlotAfter(fridayEvening, settings, { startMinutes: 8 * 60, endMinutes: 18 * 60 });
  assert.equal(ymdKey(slot.date), '2026-08-17');
  assert.equal(slot.startMinutes, 8 * 60);
});

test('first planning slot skips non-planning days even when the time is visible', () => {
  const settings = { planningDays: [1, 2, 3, 4, 5] };
  const saturday = new Date(2026, 7, 15, 10, 15);
  const slot = firstPlanningSlotAfter(saturday, settings, { startMinutes: 8 * 60, endMinutes: 18 * 60 });
  assert.equal(ymdKey(slot.date), '2026-08-17');
  assert.equal(slot.startMinutes, 8 * 60);
});
