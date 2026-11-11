import test from 'node:test';
import assert from 'node:assert/strict';
import { buildYearPrintModel, renderYearPrint } from '../src/features/year-print.js';

function yearData(overrides = {}) {
  return {
    misogi: '',
    misogiStartDate: '',
    misogiEndDate: '',
    misogiDone: false,
    misogiMilestones: [],
    meaningful: ['', '', ''],
    miniAdventures: [],
    habits: ['', '', '', ''],
    habitStartedAt: ['', '', '', ''],
    habitChecks: {},
    ...overrides
  };
}

const today = new Date(2026, 9, 9, 12);

test('a blank year prints as a map to fill in by hand', () => {
  const model = buildYearPrintModel({ year: 2027, data: yearData(), today });
  assert.equal(model.isBlank, true);
  assert.equal(model.months.length, 12);
  assert.deepEqual(model.months.filter(month => month.quarter).map(month => month.quarter), ['Q1', 'Q2', 'Q3', 'Q4']);
  assert.equal(model.misogi.milestones.length, 5, 'five milestone rows, empty');
  assert.ok(model.misogi.milestones.every(row => row === null));
  assert.equal(model.adventures.length, 6);
  assert.ok(model.adventures.every(row => row === null));
  assert.equal(model.painted, null, 'no painted year before the first closed day');
  const html = renderYearPrint(model);
  assert.match(html, /pyr-body is-blank/);
  assert.equal((html.match(/class="pyr-month"/g) || []).length, 12);
  assert.ok((html.match(/pyr-blank/g) || []).length >= 11, 'empty rows keep their ruled blanks');
});

test('months start on the configured weekday and keep whole weeks', () => {
  const monday = buildYearPrintModel({ year: 2026, data: yearData(), weekStartsOn: 1, today });
  const january = monday.months[0];
  assert.equal(january.weeks[0].filter(cell => cell === null).length, 3, '1 January 2026 is a Thursday');
  assert.ok(january.weeks.every(week => week.length === 7));
  const sunday = buildYearPrintModel({ year: 2026, data: yearData(), weekStartsOn: 0, today });
  assert.equal(sunday.months[0].weeks[0].filter(cell => cell === null).length, 4);
});

test('dated parts of the year mark their days and list in their month', () => {
  const data = yearData({
    misogi: 'Ride 800 km in 7 days',
    misogiStartDate: '2026-08-24',
    misogiEndDate: '2026-08-30',
    misogiMilestones: [{ id: 'm1', text: 'First 150 km ride', done: true, date: '2026-04-12' }],
    miniAdventures: [{ id: 'a1', text: 'Lisbon <weekend>', startDate: '2026-10-17', endDate: '2026-10-19', status: 'planned', done: false }],
    meaningful: ['Be present', '', ''],
    habits: ['Read 20 pages', '', '', '']
  });
  const model = buildYearPrintModel({ year: 2026, data, keyDates: [{ id: 'k1', text: 'Mum’s 70th', startDate: '2026-11-14', endDate: '' }], today });
  assert.equal(model.isBlank, false);
  const august = model.months[7].weeks.flat().filter(Boolean);
  assert.ok(august.filter(cell => cell.kind === 'misogi').length === 7);
  assert.ok(model.months[3].weeks.flat().some(cell => cell?.milestone), 'milestone day is marked in April');
  assert.equal(model.months[10].events[0].text, 'Mum’s 70th');
  assert.equal(model.misogi.milestones[0].done, true);
  assert.equal(model.adventures[0].status, 'Planned');
  const html = renderYearPrint(model);
  assert.match(html, /Lisbon &lt;weekend&gt;/, 'text is escaped');
  assert.doesNotMatch(html, /Lisbon <weekend>/);
});

test('the painted year labels only the first month of each quarter', () => {
  const progress = { closed: 3, months: Array.from({ length: 12 }, (_, month) => ({ month, days: [{ closed: month === 0, level: 2, future: month > 9 }] })) };
  const model = buildYearPrintModel({ year: 2026, data: yearData(), progress, today });
  assert.equal(model.painted.closed, 3);
  const html = renderYearPrint(model);
  const labels = [...html.matchAll(/<div class="pyr-paint__row"><span>([^<]*)<\/span>/g)].map(match => match[1]);
  assert.equal(labels.length, 12);
  assert.deepEqual(labels.map(label => !!label), labels.map((_, index) => index % 3 === 0));
  assert.match(html, /<b>3<\/b> days painted/);
});
