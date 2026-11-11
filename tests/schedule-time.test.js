import test from 'node:test';
import assert from 'node:assert/strict';
import {
  blockEndDateKey,
  blockTimeRange,
  clockTime,
  durationLabel,
  elapsedMinutesForDate,
  padHour,
  parseTimeValue,
  time
} from '../src/domain/schedule-time.js';

test('time formatting preserves planner 24:00 behavior and wrapped clock labels', () => {
  assert.equal(time(0), '00:00');
  assert.equal(time(24 * 60), '24:00');
  assert.equal(clockTime(24 * 60 + 15), '00:15');
  assert.equal(padHour(24), '24');
});

test('durationLabel keeps compact hour/minute labels', () => {
  assert.equal(durationLabel(45), '45m');
  assert.equal(durationLabel(60), '1h');
  assert.equal(durationLabel(95), '1h 35m');
});

test('block time helpers preserve cross-midnight ranges', () => {
  const block = { startDate: '2026-08-14', start: 23 * 60 + 30, duration: 90 };
  assert.equal(blockEndDateKey(block, '2026-08-14'), '2026-08-15');
  assert.equal(blockTimeRange(block, '2026-08-14'), '23:30–01:00 +1d');
});

test('elapsedMinutesForDate distinguishes past, current and future days', () => {
  const block = { start: 12 * 60, duration: 90 };
  const now = new Date(2026, 7, 14, 12, 30);
  assert.equal(elapsedMinutesForDate(block, new Date(2026, 7, 13), now), 90);
  assert.equal(elapsedMinutesForDate(block, new Date(2026, 7, 14), now), 30);
  assert.equal(elapsedMinutesForDate(block, new Date(2026, 7, 15), now), 0);
});


test('parseTimeValue accepts compact and colon time input', () => {
  assert.equal(parseTimeValue('8'), 8 * 60);
  assert.equal(parseTimeValue('830'), 8 * 60 + 30);
  assert.equal(parseTimeValue('08:45'), 8 * 60 + 45);
  assert.equal(parseTimeValue('24:00'), null);
  assert.equal(parseTimeValue('8:75'), null);
});
