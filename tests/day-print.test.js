import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fitDayPlan } from '../src/features/print.js';

// The printed Day (1.39.3): its plan column always ends on its page, whatever the day holds. Checked as real PDFs
// on A4 and Letter landscape; here, the steps it takes and the rules that make the sheet measurable.

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

function classes() {
  const set = new Set();
  return { set, add: (...names) => names.forEach(name => set.add(name)), remove: (...names) => names.forEach(name => set.delete(name)), contains: name => set.has(name) };
}

/**
 * A Day sheet whose plan column measures like the real one: 100 units of outcomes and headings (90 with the
 * smaller notes box), each task row 8 units (6 compact, two to a row in two columns), the “more” line 1, 150 units of
 * room. `blanks`: the empty rows printed after the tasks (room to write), `extra`: more units above the tasks.
 */
function daySheet(taskCount, { noteLines = 0, blanks = 0, extra = 0 } = {}) {
  const doc = { createElement: () => ({ className: '', textContent: '', remove() { tasks.extra = null; } }) };
  const column = { classList: classes() };
  const tasks = { classList: classes(), rows: [], extra: null };
  tasks.rows = Array.from({ length: taskCount + blanks }, (_, index) => ({ blank: index >= taskCount, remove() { tasks.rows = tasks.rows.filter(row => row !== this); } }));
  tasks.querySelectorAll = selector => tasks.rows.filter(row => (selector.endsWith('.is-blank') ? row.blank : selector.includes(':not(.is-blank)') ? !row.blank : true));
  tasks.append = node => { tasks.extra = node; };
  const noteText = { classList: classes(), style: { props: {}, setProperty(key, value) { this.props[key] = value; } } };
  const notes = { clientHeight: 40, get scrollHeight() { return noteLines * 10 + 4; }, querySelector: () => noteText };
  Object.defineProperties(column, {
    clientHeight: { value: 150 },
    scrollHeight: {
      get() {
        const compact = column.classList.contains('is-compact');
        const two = tasks.classList.contains('is-two');
        const rowCount = two ? Math.ceil(tasks.rows.length / 2) : tasks.rows.length;
        return extra + (column.classList.contains('is-tight') ? 90 : 100) + rowCount * (compact ? 6 : 8) + (tasks.extra ? 1 : 0);
      }
    }
  });
  column.querySelector = selector => (selector === '.print-tasks' ? tasks : selector === '.print-notes p' ? notes : null);
  const sheet = { ownerDocument: { ...doc, defaultView: { getComputedStyle: node => (node === notes ? { paddingTop: '2', paddingBottom: '2', fontSize: '9' } : { lineHeight: '10' }) } }, offsetHeight: 0, classList: classes(), measured: [] };
  sheet.classList.add = name => { sheet.measured.push(`+${name}`); };
  sheet.classList.remove = name => { sheet.measured.push(`-${name}`); };
  sheet.querySelector = selector => (selector === '.print-plan-column' ? column : null);
  return { sheet, column, tasks, noteText };
}

const state = ({ column, tasks }) => ({ column: [...column.classList.set].sort(), tasks: [...tasks.classList.set], rows: tasks.rows.length, more: tasks.extra?.textContent || '' });

test('blank rows go before anything else, and are never counted as tasks', () => {
  // A long Keep in mind and one task with its two blank rows: the blanks give way, nothing says “more”.
  const day = daySheet(1, { blanks: 2, extra: 52 });
  fitDayPlan(day.sheet);
  assert.deepEqual(state(day), { column: ['is-compact', 'is-tight'], tasks: [], rows: 1, more: '' });
  assert.equal(day.tasks.rows.every(row => !row.blank), true);
  // Too long even then: only real tasks are counted in “+n more”.
  const long = daySheet(30, { blanks: 0, extra: 20 });
  fitDayPlan(long.sheet);
  const left = Number(/^\+(\d+) more tasks?$/.exec(state(long).more)?.[1] || 0);
  assert.equal(state(long).rows + left, 30);
});

test('a plan that fits prints as it is, measured off-screen and put back', () => {
  const day = daySheet(5);
  fitDayPlan(day.sheet);
  assert.deepEqual(state(day), { column: [], tasks: [], rows: 5, more: '' });
  assert.deepEqual(day.sheet.measured, ['+is-measuring', '-is-measuring']);
});

test('a longer plan steps down only as far as it needs: smaller notes box, tighter rows, two columns', () => {
  const tight = daySheet(7);
  fitDayPlan(tight.sheet);
  assert.deepEqual(state(tight), { column: ['is-tight'], tasks: [], rows: 7, more: '' });
  const compact = daySheet(9);
  fitDayPlan(compact.sheet);
  assert.deepEqual(state(compact), { column: ['is-compact', 'is-tight'], tasks: [], rows: 9, more: '' });
  const two = daySheet(16);
  fitDayPlan(two.sheet);
  assert.deepEqual(state(two), { column: ['is-compact', 'is-tight'], tasks: ['is-two'], rows: 16, more: '' });
});

test('past two columns, the last tasks give way to “+n more tasks”; never a task cut in half', () => {
  const day = daySheet(60);
  fitDayPlan(day.sheet);
  const after = state(day);
  assert.deepEqual(after.tasks, ['is-two']);
  assert.ok(day.column.scrollHeight <= day.column.clientHeight + 1, 'it fits');
  assert.equal(after.rows + Number(/^\+(\d+) more tasks$/.exec(after.more)?.[1]), 60, 'what is left out is counted');
  const one = daySheet(21);
  fitDayPlan(one.sheet);
  assert.equal(state(one).more, '+1 more task');
});

test('a note longer than its box ends with an ellipsis inside it, on the lines it has', () => {
  const day = daySheet(3, { noteLines: 12 });
  fitDayPlan(day.sheet);
  assert.ok(day.noteText.classList.contains('is-clamped'));
  assert.equal(day.noteText.style.props['-webkit-line-clamp'], '3', '(40 − 2 − 2) / 10 lines');
  const short = daySheet(3, { noteLines: 2 });
  fitDayPlan(short.sheet);
  assert.equal(short.noteText.classList.contains('is-clamped'), false);
});

test('the Day sheet can be measured on screen: its rules sit outside @media print, at Letter’s printable size', () => {
  const css = read('styles/print.css');
  const daily = css.indexOf('.print-daily-layout {');
  const firstPrint = css.indexOf('@media print {', css.indexOf('/* Sheet-only classes'));
  assert.ok(daily > 0 && daily < firstPrint, 'the Daily rules come before the next @media print block');
  assert.match(css, /\.print-sheet--day\.is-measuring \{[^}]*width: 267\.4mm; height: var\(--print-sheet-height\);[^}]*visibility: hidden;/);
  assert.match(css, /\.print-plan-column\.is-tight \{ grid-template-rows: auto auto auto auto minmax\(22mm, 1fr\); \}/);
  assert.match(css, /\.print-tasks\.is-two \{ display: grid; grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
  assert.match(css, /\.print-notes p \{[^}]*overflow: hidden;/, 'a note stays in its box');
  assert.match(css, /\.print-plan-column \{\n {2}min-height: 0;\n[^}]*overflow: hidden;/, 'the column itself clips, never the page');
  assert.match(css, /\.print-plan-column\.is-compact \.print-check-row p \{[^}]*-webkit-line-clamp: 3;/, 'a long row: three lines when compact');
  assert.match(css, /@page \{ size: landscape; margin: 6mm; \}/, 'the page: landscape, 6mm all round');
  const print = read('src/features/print.js');
  assert.match(print, /<section class="print-tasks"><h2>Tasks<\/h2>/);
  assert.match(print, /\$\{text \? '' : ' is-blank'\}/, 'blank rows are marked');
  assert.match(print, /<p><span class="print-notes__text">/);
  assert.match(print, /document\.body\.append\(sheet\);\n {4}if \(rangeView !== 'week'\) fitDayPlan\(sheet\);/);
});

test('year in review: a streak of 100 days or more widens the figures’ first column, every row alike', () => {
  const css = read('styles/year.css');
  assert.match(css, /\.rv-figures--wide \.rv-fig \{ grid-template-columns: 27mm minmax\(0, 1fr\); \}/);
  assert.ok(css.indexOf('.rv-figures--wide .rv-fig') < css.indexOf('.rv--quiet .rv-fig {'), 'a quiet year keeps its own columns');
  assert.match(read('src/features/year-review.js'), /<div class="rv-figures\$\{review\.bestStreak >= 100 \? ' rv-figures--wide' : ''\}">/);
});

test('every sheet is 190mm, as the year, quarter and review sheets shipped, and Day and Week grow with it', () => {
  const print = read('styles/print.css');
  assert.match(print, /\.print-sheet \{ --print-sheet-height: 190mm; \}/, 'the one height');
  assert.match(print, /height: var\(--print-sheet-height\) !important;\n\s*min-height: 0 !important;\n\s*max-height: var\(--print-sheet-height\) !important;/);
  assert.ok(190 <= 210 - 2 * 6 - 8, 'inside A4 landscape (210mm less the 6mm margins), 8mm to spare for a browser that ignores @page; Letter is taller');
  // Day: the plan column and the schedule's hours take the extra height (the notes box is the column's 1fr row).
  assert.match(print, /\.print-daily-layout \{\n {2}height: calc\(var\(--print-sheet-height\) - 20mm\);/);
  assert.match(print, /\.print-schedule-grid \{\n {2}height: calc\(var\(--print-sheet-height\) - 31mm\);/);
  assert.match(print, /\.print-plan-column \{[^}]*grid-template-rows: auto auto auto auto minmax\(34mm, 1fr\);/);
  // Week: its hours.
  assert.match(print, /\.print-week-body \{\n {4}position: relative;\n {4}height: calc\(var\(--print-sheet-height\) - 36mm\);/);
  // Year, quarter and review: the same full page.
  assert.match(print, /\.print-sheet--year \{ --print-sheet-height: 190mm;/);
  assert.match(read('styles/quarter.css'), /\.print-sheet--quarter \{\n {2}--print-sheet-height: 190mm;/);
  assert.match(read('styles/year.css'), /\.print-sheet--review \{\n {2}--print-sheet-height: 190mm;/);
  assert.doesNotMatch(print + read('styles/quarter.css') + read('styles/year.css'), /--print-sheet-height: (?!190mm)|(?:height|max-height): 178mm/, 'no sheet at another height');
});
