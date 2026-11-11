import test from 'node:test';
import assert from 'node:assert/strict';
import { parseVisibleHour, visibleHourChoices } from '../src/features/settings-schedule.js';
import { parseTimeValue } from '../src/domain/schedule-time.js';

test('visible hour input accepts typed whole hours and 24:00 for the end boundary', () => {
  assert.equal(parseVisibleHour('8', { parseTimeValue }), 8);
  assert.equal(parseVisibleHour('08:00', { parseTimeValue }), 8);
  assert.equal(parseVisibleHour('24:00', { allow24: true, parseTimeValue }), 24);
  assert.equal(parseVisibleHour('08:30', { parseTimeValue }), null);
});

test('visible hour menus respect the opposite boundary', () => {
  assert.deepEqual(visibleHourChoices('start', 8, 18).slice(-2), [16, 17]);
  assert.deepEqual(visibleHourChoices('end', 8, 18).slice(0, 2), [9, 10]);
  assert.equal(visibleHourChoices('end', 8, 18).at(-1), 24);
});
