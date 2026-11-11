import test from 'node:test';
import assert from 'node:assert/strict';
import { atNoon, ymdKey, dateFromKey, addDaysKey, daysBetweenKeys } from '../src/lib/dates.js';

test('atNoon normalizes a date without changing its calendar day', () => {
  const value = atNoon(new Date(2026, 7, 14, 23, 48));
  assert.equal(value.getFullYear(), 2026);
  assert.equal(value.getMonth(), 7);
  assert.equal(value.getDate(), 14);
  assert.equal(value.getHours(), 12);
  assert.equal(value.getMinutes(), 0);
});

test('ymdKey and dateFromKey round-trip local calendar dates', () => {
  const key = '2026-08-14';
  assert.equal(ymdKey(dateFromKey(key)), key);
});

test('addDaysKey crosses month and year boundaries', () => {
  assert.equal(addDaysKey('2026-08-31', 1), '2026-09-01');
  assert.equal(addDaysKey('2026-12-31', 1), '2027-01-01');
  assert.equal(addDaysKey('2026-01-01', -1), '2025-12-31');
});

test('daysBetweenKeys returns signed day distance', () => {
  assert.equal(daysBetweenKeys('2026-08-14', '2026-08-20'), 6);
  assert.equal(daysBetweenKeys('2026-08-20', '2026-08-14'), -6);
});
