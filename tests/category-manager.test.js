import test from 'node:test';
import assert from 'node:assert/strict';
import { focusFallback } from '../src/features/category-manager.js';

const rows = ['a', 'b', 'c'];

test('archiving or restoring keeps focus on the same category, on its counterpart control', () => {
  assert.deepEqual(focusFallback({ control: 'archive', index: 1 }, rows)[0], { row: 'same', control: 'restore' });
  assert.deepEqual(focusFallback({ control: 'restore', index: 0 }, rows)[0], { row: 'same', control: 'archive' });
});

test('a deleted category hands focus to the row that took its place, then to Add', () => {
  const steps = focusFallback({ control: 'remove', index: 2 }, rows);
  assert.deepEqual(steps.map(step => step.row), ['same', 2, 'add']);
  assert.equal(focusFallback({ control: 'remove', index: 5 }, rows)[1].row, 2, 'the last row when the deleted one was last');
  assert.deepEqual(focusFallback({ control: 'remove', index: 0 }, []).map(step => step.row), ['same', 'add'], 'Add when no category is left');
});
