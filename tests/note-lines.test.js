import test from 'node:test';
import assert from 'node:assert/strict';
import {
  blockNoteLineHtml,
  dayNoteLineHtml,
  parseChecklistLine,
  renderBlockNotesPreview
} from '../src/domain/note-lines.js';

test('parseChecklistLine supports slash syntax and legacy checkbox characters', () => {
  assert.deepEqual(parseChecklistLine('// buy milk'), { checked: false, text: 'buy milk' });
  assert.deepEqual(parseChecklistLine('//x done'), { checked: true, text: 'done' });
  assert.deepEqual(parseChecklistLine('☑ legacy'), { checked: true, text: 'legacy' });
  assert.equal(parseChecklistLine('plain note'), null);
});

test('note line renderers escape authored HTML without changing checklist state', () => {
  assert.match(blockNoteLineHtml('// <b>x</b>'), /&lt;b&gt;x&lt;\/b&gt;/);
  assert.match(dayNoteLineHtml('//x done'), /is-checked/);
  assert.match(renderBlockNotesPreview('//x <script>'), /&lt;script&gt;/);
});
