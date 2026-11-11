import test from 'node:test';
import assert from 'node:assert/strict';
import { searchPlannerDays, searchSnippet } from '../src/features/search.js';

const dayState = {
  focus: 'Protect deep work',
  priorities: [{ id: 'p1', text: 'Ship planner', done: false }],
  tasks: [{ id: 't1', text: 'Run regression tests', done: true }],
  blocks: [{ id: 'b1', title: 'Deep work', categoryId: 'cat1', start: 540, duration: 60 }],
  notes: 'Remember the customer interview',
  memory: '',
  lesson: ''
};

test('searchPlannerDays searches authored content and includes useful metadata', () => {
  const results = searchPlannerDays({
    query: 'deep',
    days: [['2026-08-14', dayState]],
    categories: [{ id: 'cat1', name: 'Work' }],
    blockTimeRange: () => '09:00–10:00'
  });
  assert.equal(results.length, 2);
  assert.deepEqual(results.map(item => item.kind).sort(), ['block', 'focus']);
  const block = results.find(item => item.kind === 'block');
  assert.equal(block.meta, '09:00–10:00 · Work');
});

test('searchPlannerDays does not match presentation-only labels', () => {
  const results = searchPlannerDays({
    query: 'schedule',
    days: [['2026-08-14', dayState]],
    blockTimeRange: () => '09:00–10:00'
  });
  assert.equal(results.length, 0);
});

test('searchSnippet normalizes whitespace and truncates predictably', () => {
  assert.equal(searchSnippet('  one\n  two   three  '), 'one two three');
  assert.equal(searchSnippet('abcdefghij', 6), 'abcde…');
});
