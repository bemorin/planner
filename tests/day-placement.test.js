import test from 'node:test';
import assert from 'node:assert/strict';
import { addDaysKey } from '../src/lib/dates.js';
import { ARCHIVE_BUDGET, BATCH_CHARS, BATCH_DAYS, HOT_DAYS, MANIFEST_KEY, batchesOf, dayOfKey, decodeManifest, encodeManifest, hotFloor, isBlankDay, keyOfDay, needsRoom, planMoves, sharesItems } from '../src/state/day-placement.js';
import { createBlankDay } from '../src/state/day-state.js';
import { HISTORY_TODAY, historyDay, historyDays } from './support/history.js';

// Which days move to the archive, and the manifest that says how far they moved (1.40, src/state/day-placement.js).

const TODAY = HISTORY_TODAY;
const sized = days => days.map(([day, value]) => ({ day, chars: keyOfDay(day).length + JSON.stringify(value).length }));
const sum = list => list.reduce((total, entry) => total + entry.chars, 0);

test('day keys: only daily-planner:YYYY-MM-DD is a day', () => {
  assert.equal(dayOfKey('daily-planner:2026-11-11'), '2026-11-11');
  for (const key of ['daily-planner:settings', 'daily-planner:workspace', 'daily-planner-sync:ledger', 'daily-planner:2026-11-11x', null, undefined]) assert.equal(dayOfKey(key), '');
  assert.equal(keyOfDay('2026-11-11'), 'daily-planner:2026-11-11');
  assert.equal(MANIFEST_KEY, 'daily-planner-store:archive', 'outside daily-planner:, never backed up, synced or reset by 1.39');
});

test('moves start at half of Safari’s budget', () => {
  assert.equal(ARCHIVE_BUDGET, 2621440);
  assert.equal(needsRoom(ARCHIVE_BUDGET / 2 - 1), false);
  assert.equal(needsRoom(ARCHIVE_BUDGET / 2), true);
  assert.equal(needsRoom(100, { budget: 150 }), true);
});

test('the plan takes the oldest days first and stops at the goal', () => {
  const days = sized(historyDays(900));
  const used = sum(days) + 30000;
  const plan = planMoves({ days, used, today: TODAY });
  const moved = plan.batches.flat();
  const target = Math.floor(ARCHIVE_BUDGET * 0.4);
  assert.ok(plan.reaches && plan.after <= target, `down to the goal: ${plan.after} ≤ ${target}`);
  // Oldest first, without a gap.
  assert.deepEqual(moved, days.slice(0, moved.length).map(entry => entry.day));
  // It stops as soon as the goal is reached: one day fewer and it isn't.
  const lastChars = days[moved.length - 1].chars;
  assert.ok(plan.after + lastChars > target, 'no day more than needed');
  assert.equal(plan.days, moved.length);
  assert.equal(plan.chars, used - plan.after);
});

test('today, future days and the last 62 days never move', () => {
  const recent = Array.from({ length: 80 }, (_, index) => ({ day: addDaysKey(TODAY, index - 70), chars: 50000 }));
  const plan = planMoves({ days: recent, used: 80 * 50000, today: TODAY });
  const floor = hotFloor(TODAY);
  assert.equal(floor, addDaysKey(TODAY, -HOT_DAYS));
  const moved = plan.batches.flat();
  assert.ok(moved.length > 0);
  assert.ok(moved.every(day => day < floor), 'only days before the floor');
  assert.equal(moved.length, recent.filter(entry => entry.day < floor).length, 'every one of them, still short of the goal');
  assert.equal(plan.reaches, false, 'the goal can’t be reached: the plan says so');
  // A day on screen stays this time.
  const excluded = planMoves({ days: recent, used: 80 * 50000, today: TODAY, exclude: [moved[0]] });
  assert.ok(!excluded.batches.flat().includes(moved[0]));
});

test('batches hold at most 250 days or 600,000 characters', () => {
  const small = Array.from({ length: 700 }, (_, index) => ({ day: addDaysKey('2020-01-01', index), chars: 100 }));
  const plan = planMoves({ days: small, used: 10 ** 7, today: TODAY });
  assert.deepEqual(plan.batches.map(batch => batch.length), [BATCH_DAYS, BATCH_DAYS, 200]);
  const big = Array.from({ length: 10 }, (_, index) => ({ day: addDaysKey('2020-01-01', index), chars: 250000 }));
  const heavy = planMoves({ days: big, used: 10 ** 7, today: TODAY });
  for (const batch of heavy.batches) assert.ok(batch.length * 250000 <= BATCH_CHARS || batch.length === 1);
  assert.deepEqual(heavy.batches.map(batch => batch.length), [2, 2, 2, 2, 2]);
  assert.deepEqual(batchesOf(big.slice(0, 5)).map(batch => batch.length), [2, 2, 1]);
});

test('nothing to plan below the goal', () => {
  const days = sized(historyDays(50));
  assert.deepEqual(planMoves({ days, used: sum(days), today: TODAY }).batches, []);
});

test('the manifest is fixed-width JSON: rewritten in place, it never grows', () => {
  const small = encodeManifest({ before: '2025-03-01', days: 1, chars: 12 });
  const large = encodeManifest({ before: '2031-12-31', days: 1234567, chars: 2950000000 });
  assert.equal(small.length, large.length, 'always the same length');
  assert.equal(small, '{"v":1,"before":"2025-03-01","days":      1,"chars":        12,"gen":         0}');
  const counted = encodeManifest({ before: '2031-12-31', days: 1234567, chars: 2950000000, gen: 42 });
  assert.equal(counted.length, small.length);
  assert.deepEqual(JSON.parse(counted), { v: 1, before: '2031-12-31', days: 1234567, chars: 2950000000, gen: 42 }, 'plain JSON');
  assert.deepEqual(decodeManifest(counted), { before: '2031-12-31', days: 1234567, chars: 2950000000, gen: 42 });
  // Beyond its width it says the most it can, still at the same length.
  assert.equal(encodeManifest({ before: '2025-03-01', days: 10 ** 9, chars: 10 ** 12 }).length, small.length);
  for (const raw of [null, '', 'nope', '{"v":2,"before":"2025-03-01"}', '{"v":1,"before":"soon"}']) assert.equal(decodeManifest(raw), null, String(raw));
  assert.throws(() => encodeManifest({ before: '' }));
});

test('sharesItems: an edit shares ids with its day; a blind write shares none', () => {
  const day = historyDay('2024-05-06');
  const edited = { ...day, focus: 'edited', tasks: [...day.tasks, { id: 'new-task', text: 'More', done: false, carriedCount: 0, originDay: '' }] };
  assert.equal(sharesItems(JSON.stringify(day), JSON.stringify(edited)), true);
  assert.equal(sharesItems(day, { blocks: [{ id: day.blocks[0].id }] }), true, 'a block is enough');
  const blind = createBlankDay();
  blind.priorities[0].text = 'Written by an older tab';
  assert.equal(sharesItems(day, blind), false);
  assert.equal(sharesItems('not json', day), false);
  assert.equal(sharesItems({}, day), false);
});

test('isBlankDay: what a tab saves for a day it can’t see', () => {
  assert.equal(isBlankDay(createBlankDay()), true);
  assert.equal(isBlankDay(JSON.stringify(createBlankDay())), true);
  assert.equal(isBlankDay(null), true);
  assert.equal(isBlankDay(historyDay('2024-05-06')), false);
  const one = createBlankDay();
  one.tasks[2].text = 'Something';
  assert.equal(isBlankDay(one), false);
  assert.equal(isBlankDay({ ...createBlankDay(), blocks: [{ id: 'b', title: '' }] }), false, 'a block counts');
  assert.equal(isBlankDay('not json'), false, 'a string that isn’t a day is kept, never taken for blank');
});
