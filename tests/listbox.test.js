import test from 'node:test';
import assert from 'node:assert/strict';
import { listboxStep, typeaheadMatch } from '../src/ui/listbox.js';

test('arrow, Home, End and Page keys move through a list without wrapping', () => {
  assert.equal(listboxStep('ArrowDown', 0, 5), 1);
  assert.equal(listboxStep('ArrowDown', 4, 5), 4, 'the last option stays');
  assert.equal(listboxStep('ArrowUp', 0, 5), 0, 'the first option stays');
  assert.equal(listboxStep('ArrowUp', -1, 5), 4, 'nothing focused: ↑ starts from the end');
  assert.equal(listboxStep('ArrowDown', -1, 5), 0, 'nothing focused: ↓ starts from the top');
  assert.equal(listboxStep('Home', 3, 5), 0);
  assert.equal(listboxStep('End', 1, 5), 4);
  assert.equal(listboxStep('PageDown', 2, 20), 10);
  assert.equal(listboxStep('PageUp', 3, 20), 0);
  assert.equal(listboxStep('Enter', 2, 5), -1, 'other keys do not move');
  assert.equal(listboxStep('ArrowDown', 0, 0), -1, 'an empty list has nowhere to go');
});

test('typing finds an option by its first letters, after the focused one', () => {
  const months = ['Any month', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  assert.equal(typeaheadMatch(months, 'o', 0), 10);
  assert.equal(typeaheadMatch(months, 'ju', 0), 6, 'June before July');
  assert.equal(typeaheadMatch(months, 'jul', 6), 7);
  assert.equal(typeaheadMatch(months, 'j', 6), 7, 'the same letter again moves on');
  assert.equal(typeaheadMatch(months, 'jj', 7), 1, 'and wraps around');
  assert.equal(typeaheadMatch(months, 'MAR', -1), 3, 'case does not matter');
  assert.equal(typeaheadMatch(months, 'x', 0), -1);
  assert.equal(typeaheadMatch([], 'a'), -1);
  assert.equal(typeaheadMatch(months, ''), -1);
});
