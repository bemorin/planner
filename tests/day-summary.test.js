import test from 'node:test';
import assert from 'node:assert/strict';
import { agendaDay, blocksLine, planCompact, planCounts, planLine, scheduleLine, sumCounts, viewSummaries } from '../src/features/day-summary.js';

const day = {
  priorities: [{ text: 'Ship the print layout', done: false }, { text: 'Review the budget', done: true }, { text: '  ', done: true }],
  tasks: [{ text: 'Book physio', done: false }, { text: 'Call the bank', done: true }, { text: '', done: false }],
  blocks: [{ start: 14 * 60, duration: 60 }, { start: 9 * 60, duration: 120 }, { start: 17 * 60 + 30, duration: 60 }]
};

test('the plan is counted from outcomes and tasks that have words', () => {
  assert.deepEqual(planCounts(day), { outcomes: 2, outcomesDone: 1, tasks: 2, tasksDone: 1, total: 4, done: 2 });
  assert.equal(planLine(planCounts(day)), '2 of 4 done');
  assert.equal(planLine(planCounts({ priorities: [{ text: 'A', done: true }], tasks: [{ text: 'B', done: true }] })), 'All 2 done');
  assert.equal(planLine(planCounts({ priorities: [{ text: 'A', done: true }] })), 'Done');
  assert.equal(planLine(planCounts({ priorities: [{ text: '' }], tasks: [] })), 'Nothing planned');
  assert.equal(planLine(planCounts(null)), 'Nothing planned');
  assert.equal(planCompact(planCounts(day)), '1/2 outcomes · 2 tasks');
  assert.equal(planCompact(planCounts({ priorities: [{ text: 'A', done: false }], tasks: [{ text: 'B' }] })), '0/1 outcome · 1 task');
  assert.equal(planCompact(planCounts({})), 'Nothing planned');
  assert.deepEqual(sumCounts([planCounts(day), planCounts(day)]), { outcomes: 4, outcomesDone: 2, tasks: 4, tasksDone: 2, total: 8, done: 4 });
});

test('the schedule says what is on now or next today, and how many blocks otherwise', () => {
  assert.equal(scheduleLine(day.blocks, { today: true, nowMinutes: 10 * 60 + 40 }), 'Now until 11:00');
  assert.equal(scheduleLine(day.blocks, { today: true, nowMinutes: 15 * 60 }), 'Next 17:30');
  assert.equal(scheduleLine(day.blocks, { today: true, nowMinutes: 20 * 60 }), '3 blocks', 'nothing left today');
  assert.equal(scheduleLine(day.blocks, { today: false, nowMinutes: 10 * 60 }), '3 blocks');
  assert.equal(scheduleLine([{ start: 60, duration: 30 }]), '1 block');
  assert.equal(scheduleLine([]), 'Empty');
  assert.equal(blocksLine(day.blocks), '3 blocks · 4h');
  assert.equal(blocksLine([]), '');
});

test('the switch summarises one day or a whole week', () => {
  const week = [{ key: '2026-10-05', state: day }, { key: '2026-10-07', state: day }, { key: '2026-10-08', state: {} }];
  assert.deepEqual(viewSummaries(week, { todayKey: '2026-10-07', nowMinutes: 15 * 60 }).plan, '4 of 8 done');
  assert.equal(viewSummaries(week, { todayKey: '2026-10-07', nowMinutes: 15 * 60 }).schedule, 'Next 17:30');
  assert.equal(viewSummaries(week, { todayKey: '2026-10-07', nowMinutes: 20 * 60 }).schedule, '6 blocks', 'after today’s last block: the week’s blocks');
  assert.equal(viewSummaries(week, { todayKey: '2026-11-01' }).schedule, '6 blocks');
  assert.deepEqual(viewSummaries([{ key: 'x', state: {} }], { todayKey: 'x' }), { plan: 'Nothing planned', schedule: 'Empty', counts: planCounts({}) });
});

test('an agenda day carries its main outcome, the others and its counts', () => {
  const info = agendaDay({ ...day, endedAt: '2026-10-05T18:00:00Z' }, { key: '2026-10-05', todayKey: '2026-10-07' });
  assert.deepEqual(info.mit, { text: 'Ship the print layout', done: false });
  assert.deepEqual(info.others, [{ text: 'Review the budget', done: true }]);
  assert.equal(info.closed, true);
  assert.equal(info.past, true);
  assert.equal(info.today, false);
  assert.equal(info.blocks, 3);
  const empty = agendaDay({ priorities: [{ text: '' }, { text: 'Only a second outcome' }] }, { key: '2026-10-07', todayKey: '2026-10-07' });
  assert.equal(empty.mit, null, 'no main outcome');
  assert.equal(empty.today, true);
  assert.deepEqual(empty.others, [{ text: 'Only a second outcome', done: false }]);
});
