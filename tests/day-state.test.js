import test from 'node:test';
import assert from 'node:assert/strict';
import { createBlankDay, normalizeDayState } from '../src/state/day-state.js';

test('createBlankDay provides the planner minimum shape', () => {
  const day = createBlankDay();
  assert.equal(day.priorities.length, 3);
  assert.ok(day.tasks.length >= 1);
  assert.deepEqual(day.blocks, []);
  assert.equal(day.focus, '');
  assert.equal(day.notes, '');
});

test('normalizeDayState repairs partial persisted data', () => {
  const day = normalizeDayState({
    focus: 42,
    priorities: [{ id: 'p1', text: 'Keep', carriedCount: -3 }],
    tasks: [{ id: 't1', text: 'Task', done: true }]
  }, '2026-08-14');
  assert.equal(day.focus, '');
  assert.equal(day.priorities[0].id, 'p1');
  assert.equal(day.priorities[0].carriedCount, 0);
  assert.equal(day.tasks[0].done, true);
  assert.equal(day.priorities.length, 3);
});

test('normalizeDayState derives an end date for blocks crossing midnight', () => {
  const day = normalizeDayState({
    blocks: [{ id: 'b1', title: 'Late work', start: 23 * 60 + 30, duration: 90, startDate: '2026-08-14' }]
  }, '2026-08-14');
  assert.equal(day.blocks[0].startDate, '2026-08-14');
  assert.equal(day.blocks[0].endDate, '2026-08-15');
});

test('linked block completion mirrors its source item', () => {
  const day = normalizeDayState({
    priorities: [{ id: 'p1', text: 'Outcome', done: true }],
    blocks: [{ id: 'b1', title: 'Outcome block', start: 540, duration: 60, linkedType: 'priority', linkedId: 'p1', done: false }]
  }, '2026-08-14');
  assert.equal(day.blocks[0].done, true);
});

test('normalizeDayState is idempotent: a day loaded and saved again is the same, so sync sees no change (1.38)', () => {
  for (const raw of [{}, { focus: 'x', tasks: [] }, createBlankDay(), { tasks: [{ id: 'task-1', text: 'One' }], priorities: [{ id: 'p1', text: 'A' }] }]) {
    const once = normalizeDayState(raw);
    assert.deepEqual(normalizeDayState(JSON.parse(JSON.stringify(once))), once);
  }
  const blank = createBlankDay();
  assert.deepEqual(normalizeDayState(JSON.parse(JSON.stringify(blank))).tasks, blank.tasks, 'a blank day is already in the normalised shape');
  assert.deepEqual(normalizeDayState(JSON.parse(JSON.stringify(blank))).priorities, blank.priorities);
});
