import test from 'node:test';
import assert from 'node:assert/strict';
import { navigationDirection, swipeDirection } from '../src/features/day-swipe.js';

test('navigation direction: forward to a later day or week, back to an earlier one, still when equal', () => {
  assert.equal(navigationDirection('2026-10-20', '2026-10-21'), 1);
  assert.equal(navigationDirection('2026-10-22', '2026-10-20'), -1);
  assert.equal(navigationDirection('2026-12-31', '2027-01-01'), 1);
  assert.equal(navigationDirection('2026-10-20', '2026-10-20'), 0);
  assert.equal(navigationDirection('', '2026-10-20'), 0);
});

test('horizontal swipe direction maps left to next and right to previous', () => {
  assert.equal(swipeDirection(-90, 8), 1);
  assert.equal(swipeDirection(90, -8), -1);
});

test('short or mostly vertical gestures are not day swipes', () => {
  assert.equal(swipeDirection(40, 2), 0);
  assert.equal(swipeDirection(90, 80), 0);
});
