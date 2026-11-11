import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PLAN_STEPS,
  adventureMonth,
  carryKeyDates,
  clampStep,
  defaultPlanYear,
  ensurePlanShape,
  habitEditable,
  isHorizonMostlyEmpty,
  keyDatesToCarry,
  planSummary,
  planYearOptions,
  setCommitment,
  setHabit,
  setMilestone,
  setMisogi,
  setMisogiPeriod,
  setMisogiWhy,
  setReflection,
  shiftKeyDate,
  shiftYearKey,
  upsertAdventure,
  upsertKeyDate,
  yearKeyDates
} from '../src/features/year-plan.js';

const today = new Date(2026, 9, 9, 12); // Friday 9 October 2026, Q4

function emptyYear() {
  return ensurePlanShape({ misogi: '', misogiStartDate: '', misogiEndDate: '', misogiDone: false, misogiMilestones: [], meaningful: ['', '', ''], meaningfulMeta: [], miniAdventures: [], habits: ['', '', '', ''], habitStartedAt: ['', '', '', ''], habitChecks: {}, months: {} });
}

function richYear() {
  return {
    misogi: 'Ride the Pyrenees',
    misogiStartDate: '2026-08-24',
    misogiEndDate: '2026-08-30',
    misogiDone: false,
    misogiMilestones: [
      { id: 'm1', text: 'First 150 km', done: true, date: '2026-04-12' },
      { id: 'm2', text: 'Tourmalet', done: false, date: '' }
    ],
    meaningful: ['Dinner with the kids', '', ''],
    meaningfulMeta: [{ legacy: true }, {}, {}],
    miniAdventures: [
      { id: 'a1', text: 'Night hike', startDate: '2026-06-21', endDate: '', month: 5, status: 'done', done: true, nextStep: 'Buy a headlamp' },
      { id: 'a2', text: 'Lisbon', startDate: '2026-10-17', endDate: '2026-10-19', month: 9, status: 'planned', done: false, nextStep: '' }
    ],
    habits: ['Read 20 pages', 'No phone before 9', 'Mobility', ''],
    habitStartedAt: ['2026-01-01', '2026-04-01', '2026-07-01', ''],
    habitChecks: { '2026-10-08': [3], '2026-09-30': [2] },
    months: { '2026-11': { outcomes: ['legacy outcome'], anchors: [{ id: 'k1', text: 'Mum turns 70', startDate: '2026-11-14', endDate: '' }] } },
    reflection: { proud: 'Shipped v1', letGo: '' },
    customField: { keep: 'me' }
  };
}

test('the year to plan is this one until September, the next one from 1 October', () => {
  assert.equal(defaultPlanYear(new Date(2026, 0, 3)), 2026);
  assert.equal(defaultPlanYear(new Date(2026, 8, 30, 23, 59)), 2026);
  assert.equal(defaultPlanYear(new Date(2026, 9, 1)), 2027);
  assert.equal(defaultPlanYear(new Date(2026, 9, 31)), 2027);
  assert.equal(defaultPlanYear(new Date(2026, 10, 1)), 2027);
  assert.equal(defaultPlanYear(new Date(2026, 11, 31)), 2027);
  assert.deepEqual(planYearOptions(today), [2026, 2027]);
});

test('eight steps from looking back to the summary; step indexes are clamped', () => {
  assert.deepEqual(PLAN_STEPS.map(step => step.id), ['lookback', 'misogi', 'milestones', 'adventures', 'commitments', 'habits', 'keydates', 'done']);
  assert.equal(clampStep(-3), 0);
  assert.equal(clampStep(99), PLAN_STEPS.length - 1);
  assert.equal(clampStep('2'), 2);
});

test('ensurePlanShape fills missing arrays without touching what is there', () => {
  const d = ensurePlanShape({ misogi: 'Climb', customField: 1, meaningful: ['One'] });
  assert.deepEqual(d.meaningful, ['One', '', '']);
  assert.deepEqual(d.habits, ['', '', '', '']);
  assert.deepEqual(d.misogiMilestones, []);
  assert.deepEqual(d.months, {});
  assert.equal(d.customField, 1);
  assert.equal(d.misogi, 'Climb');
});

test('the reflection is saved on the planned year, one field at a time', () => {
  const d = emptyYear();
  setReflection(d, 'proud', 'Ran a marathon');
  setReflection(d, 'letGo', 'Late nights');
  setReflection(d, 'proud', 'Ran two marathons');
  assert.deepEqual(d.reflection, { proud: 'Ran two marathons', letGo: 'Late nights' });
  assert.equal(setReflection(d, 'other', 'x'), false);
  assert.equal('other' in d.reflection, false);
});

test('Misogi text, why and period keep Horizon shapes', () => {
  const d = emptyYear();
  setMisogi(d, 'Swim across\nthe lake');
  setMisogiWhy(d, 'Because water scares me');
  setMisogiPeriod(d, '2027-07-10', '2027-07-10');
  assert.equal(d.misogi, 'Swim across the lake');
  assert.equal(d.misogiWhy, 'Because water scares me');
  assert.equal(d.misogiStartDate, '2027-07-10');
  assert.equal(d.misogiEndDate, '', 'a one-day period has no end date, like Horizon');
  setMisogiPeriod(d, '2027-07-10', '2027-07-12');
  assert.equal(d.misogiEndDate, '2027-07-12');
  setMisogiPeriod(d, 'not a date', '');
  assert.equal(d.misogiStartDate, '');
});

test('milestones: new rows are created on the first character and dropped when emptied; existing ones are only edited', () => {
  const d = ensurePlanShape(richYear());
  const created = new Set();
  assert.equal(setMilestone(d, 'new-1', { text: '' }, created), false, 'an empty draft writes nothing');
  setMilestone(d, 'new-1', { text: 'H', date: '2026-07-01' }, created);
  setMilestone(d, 'new-1', { text: 'Half distance' }, created);
  assert.deepEqual(d.misogiMilestones.at(-1), { id: 'new-1', text: 'Half distance', done: false, date: '2026-07-01' });
  setMilestone(d, 'm1', { text: 'First 160 km' }, created);
  assert.deepEqual(d.misogiMilestones[0], { id: 'm1', text: 'First 160 km', done: true, date: '2026-04-12' }, 'done and date survive an edit');
  setMilestone(d, 'new-1', { text: '' }, created);
  assert.equal(d.misogiMilestones.some(item => item.id === 'new-1'), false);
  setMilestone(d, 'm2', { text: '' }, created);
  assert.ok(d.misogiMilestones.some(item => item.id === 'm2'), 'clearing an existing milestone never deletes it');
  ['x1', 'x2', 'x3', 'x4'].forEach(id => setMilestone(d, id, { text: id }, created));
  assert.equal(d.misogiMilestones.length, 5, 'Horizon keeps at most five');
});

test('adventure months: a whole month, precise dates, or none', () => {
  assert.equal(adventureMonth({ startDate: '' }, 2027), -1);
  assert.equal(adventureMonth({ startDate: '2027-02-01', endDate: '2027-02-28' }, 2027), 1);
  assert.equal(adventureMonth({ startDate: '2028-02-01', endDate: '2028-02-29' }, 2028), 1, 'leap years');
  assert.equal(adventureMonth({ startDate: '2027-02-01', endDate: '' }, 2027), 'custom');
  assert.equal(adventureMonth({ startDate: '2027-10-17', endDate: '2027-10-19' }, 2027), 'custom');
});

test('adventures: ideas, whole-month plans and kept dates, without touching the other slots', () => {
  const d = ensurePlanShape(richYear());
  const before = JSON.parse(JSON.stringify(d.miniAdventures));
  const created = new Set();
  upsertAdventure(d, 'new-a', { text: 'Learn to surf', month: -1 }, 2026, created);
  assert.deepEqual(d.miniAdventures[2], { id: 'new-a', text: 'Learn to surf', startDate: '', endDate: '', month: 0, status: 'idea', done: false, nextStep: '' });
  upsertAdventure(d, 'new-a', { month: 4 }, 2026, created);
  assert.equal(d.miniAdventures[2].startDate, '2026-05-01');
  assert.equal(d.miniAdventures[2].endDate, '2026-05-31');
  assert.equal(d.miniAdventures[2].status, 'planned');
  assert.equal(d.miniAdventures[2].month, 4);
  upsertAdventure(d, 'a2', { text: 'Lisbon with Claire', month: 'custom' }, 2026, created);
  assert.deepEqual(d.miniAdventures[1], { ...before[1], text: 'Lisbon with Claire' }, 'custom keeps the precise dates');
  upsertAdventure(d, 'a1', { month: 7 }, 2026, created);
  assert.equal(d.miniAdventures[0].status, 'done', 'a lived adventure stays lived');
  assert.equal(d.miniAdventures[0].nextStep, 'Buy a headlamp');
  upsertAdventure(d, 'new-a', { text: '  ' }, 2026, created);
  assert.equal(d.miniAdventures.length, 2, 'an emptied new adventure is removed');
  assert.equal(upsertAdventure(d, 'nameless', { month: 3 }, 2026, created), false, 'a month alone does not create an adventure');
  ['b1', 'b2', 'b3', 'b4', 'b5'].forEach(id => upsertAdventure(d, id, { text: id }, 2026, created));
  assert.equal(d.miniAdventures.length, 6, 'six slots at most');
});

test('commitments are three single-line statements', () => {
  const d = ensurePlanShape(richYear());
  setCommitment(d, 1, 'Visit\nJapan');
  assert.deepEqual(d.meaningful, ['Dinner with the kids', 'Visit Japan', '']);
  assert.equal(setCommitment(d, 3, 'Too many'), false);
  assert.deepEqual(d.meaningfulMeta, [{ legacy: true }, {}, {}]);
});

test('habits: future quarters start tracking with the quarter, the running one today; tracked and past ones are left to Horizon', () => {
  const next = emptyYear();
  setHabit(next, 0, 'Morning pages', 2027, today);
  assert.equal(next.habits[0], 'Morning pages');
  assert.equal(next.habitStartedAt[0], '', 'tracking starts on 1 January');
  assert.equal(habitEditable(next, 0, 2027, new Date(2026, 9, 20, 12)), true, 'still editable on a later day before the quarter starts');

  const current = ensurePlanShape(richYear());
  assert.equal(habitEditable(current, 0, 2026, today), false, 'Q1 has ended');
  assert.equal(habitEditable(current, 3, 2026, today), true, 'Q4 is running and empty');
  current.habitChecks['2026-10-09'] = [3, 2];
  setHabit(current, 3, 'Walk after lunch', 2026, today);
  assert.equal(current.habitStartedAt[3], '2026-10-09');
  assert.deepEqual(current.habitChecks['2026-10-09'], [2], "today's check for the changed quarter is cleared, like Horizon");
  assert.deepEqual(current.habitChecks['2026-10-08'], [3], 'history is kept');
  assert.equal(setHabit(current, 0, 'Something else', 2026, today), false);
  assert.equal(current.habits[0], 'Read 20 pages');

  const tracked = ensurePlanShape(richYear());
  tracked.habits[3] = 'Stretch';
  tracked.habitStartedAt[3] = '2026-10-01';
  assert.equal(habitEditable(tracked, 3, 2026, today), false, 'a running habit tracked since an earlier day is changed in Horizon');
});

test('key dates are written once named and dated, under the month they start in', () => {
  const d = ensurePlanShape(richYear());
  const created = new Set();
  const draft = { id: 'kd-new', text: 'Lisbon marathon', startDate: '', endDate: '' };
  assert.equal(upsertKeyDate(d, 2026, draft, created), false);
  assert.equal(yearKeyDates(d, 2026).length, 1);
  draft.startDate = '2026-12-06';
  upsertKeyDate(d, 2026, draft, created);
  assert.deepEqual(d.months['2026-12'], { outcomes: [], anchors: [{ id: 'kd-new', text: 'Lisbon marathon', startDate: '2026-12-06', endDate: '' }] });
  draft.startDate = '2026-11-20';
  draft.endDate = '2026-11-22';
  upsertKeyDate(d, 2026, draft, created);
  assert.deepEqual(d.months['2026-12'].anchors, [], 'moved out of December');
  assert.deepEqual(d.months['2026-11'].outcomes, ['legacy outcome']);
  assert.deepEqual(d.months['2026-11'].anchors.map(anchor => anchor.id), ['k1', 'kd-new']);
  assert.deepEqual(yearKeyDates(d, 2026).map(anchor => anchor.text), ['Mum turns 70', 'Lisbon marathon']);
  assert.equal(upsertKeyDate(d, 2026, { id: 'other-year', text: 'x', startDate: '2027-01-02' }, created), false, 'a date outside the year is not written');
  draft.text = '';
  upsertKeyDate(d, 2026, draft, created);
  assert.deepEqual(d.months['2026-11'].anchors.map(anchor => anchor.id), ['k1'], 'an emptied new key date is removed');
});

test('a whole session merges into existing data without losing anything it did not edit', () => {
  const d = ensurePlanShape(richYear());
  const before = JSON.parse(JSON.stringify(d));
  const created = new Set();
  setReflection(d, 'letGo', 'Doom scrolling');
  setMisogiWhy(d, 'To prove it to myself');
  setMilestone(d, 'n1', { text: 'Century ride' }, created);
  upsertAdventure(d, 'n2', { text: 'Sleep in a treehouse', month: 11 }, 2026, created);
  setCommitment(d, 2, 'Learn Italian');
  setHabit(d, 3, 'Ten push-ups', 2026, today);
  upsertKeyDate(d, 2026, { id: 'n3', text: 'Launch', startDate: '2026-12-01', endDate: '' }, created);

  assert.equal(d.misogi, before.misogi);
  assert.equal(d.misogiStartDate, before.misogiStartDate);
  assert.equal(d.misogiDone, before.misogiDone);
  assert.deepEqual(d.misogiMilestones.slice(0, 2), before.misogiMilestones);
  assert.deepEqual(d.miniAdventures.slice(0, 2), before.miniAdventures);
  assert.deepEqual(d.meaningful.slice(0, 2), before.meaningful.slice(0, 2));
  assert.deepEqual(d.meaningfulMeta, before.meaningfulMeta);
  assert.deepEqual(d.habits.slice(0, 3), before.habits.slice(0, 3));
  assert.deepEqual(d.habitStartedAt.slice(0, 3), before.habitStartedAt.slice(0, 3));
  assert.deepEqual(d.habitChecks['2026-09-30'], before.habitChecks['2026-09-30']);
  assert.deepEqual(d.months['2026-11'], before.months['2026-11']);
  assert.equal(d.reflection.proud, 'Shipped v1');
  assert.deepEqual(d.customField, { keep: 'me' });

  const summary = planSummary(d, 2026);
  assert.equal(summary.misogi.why, 'To prove it to myself');
  assert.equal(summary.milestones.length, 3);
  assert.equal(summary.adventures.length, 3);
  assert.equal(summary.commitments.length, 2);
  assert.equal(summary.habits.length, 4);
  assert.equal(summary.keyDates.length, 2);
  assert.equal(summary.done, 7);
});

test('a year is mostly empty while at most one part of Horizon is filled in', () => {
  const d = emptyYear();
  assert.equal(isHorizonMostlyEmpty(d, 0), true);
  d.misogi = 'Climb';
  assert.equal(isHorizonMostlyEmpty(d, 0), true);
  assert.equal(isHorizonMostlyEmpty(d, 1), false);
  assert.equal(isHorizonMostlyEmpty(richYear(), 1), false);
  const summary = planSummary(emptyYear(), 2027);
  assert.equal(summary.done, 0);
  assert.equal(Object.values(summary.steps).some(Boolean), false);
});

// Key dates from the year before ----------------------------------------------

const keyYear = anchorsByMonth => ({ ...emptyYear(), months: Object.fromEntries(Object.entries(anchorsByMonth).map(([key, anchors]) => [key, { outcomes: [], anchors }])) });

test('a key date moves to the same day and month; 29 February becomes 28 February', () => {
  assert.equal(shiftYearKey('2026-03-12', 1), '2027-03-12');
  assert.equal(shiftYearKey('2026-12-31', 1), '2027-12-31');
  assert.equal(shiftYearKey('2028-02-29', 1), '2029-02-28');
  assert.equal(shiftYearKey('2027-02-28', 1), '2028-02-28', 'into a leap year the day stays the 28th');
  assert.equal(shiftYearKey('2028-02-29', 4), '2032-02-29');
  assert.equal(shiftYearKey('', 1), '');
  assert.equal(shiftYearKey('12 March', 1), '');
  assert.deepEqual(shiftKeyDate({ text: ' Mum turns 71 ', startDate: '2026-11-14', endDate: '' }, 1), { text: 'Mum turns 71', startDate: '2027-11-14', endDate: '' });
  assert.equal(shiftKeyDate({ text: 'No day', startDate: '' }, 1), null);
});

test('a period keeps its length, across 29 February and across the year end', () => {
  assert.deepEqual(shiftKeyDate({ text: 'Summer in Brittany', startDate: '2026-08-01', endDate: '2026-08-21' }, 1), { text: 'Summer in Brittany', startDate: '2027-08-01', endDate: '2027-08-21' });
  // 27 Feb → 1 Mar 2028 is three days (through the 29th); in 2029 it ends on 2 March.
  assert.deepEqual(shiftKeyDate({ text: 'Ski week', startDate: '2028-02-27', endDate: '2028-03-01' }, 1), { text: 'Ski week', startDate: '2029-02-27', endDate: '2029-03-02' });
  assert.deepEqual(shiftKeyDate({ text: 'Ski week', startDate: '2027-02-26', endDate: '2027-03-01' }, 1), { text: 'Ski week', startDate: '2028-02-26', endDate: '2028-02-29' }, 'three days stay three days in a leap year');
  assert.deepEqual(shiftKeyDate({ text: 'Leap stay', startDate: '2028-02-29', endDate: '2028-03-02' }, 1), { text: 'Leap stay', startDate: '2029-02-28', endDate: '2029-03-02' });
  assert.deepEqual(shiftKeyDate({ text: 'Christmas holidays', startDate: '2026-12-19', endDate: '2027-01-03' }, 1), { text: 'Christmas holidays', startDate: '2027-12-19', endDate: '2028-01-03' });
  assert.deepEqual(shiftKeyDate({ text: 'Winter break', startDate: '2025-12-22', endDate: '2026-01-04' }, 1), { text: 'Winter break', startDate: '2026-12-22', endDate: '2027-01-04' });
  assert.equal(shiftKeyDate({ text: 'Backwards', startDate: '2026-05-10', endDate: '2026-05-02' }, 1).endDate, '', 'an end before the start is dropped');
});

test('only the key dates of the year just before are offered, moved into the planned year', () => {
  const y2025 = keyYear({ '2025-06': [{ id: 'old', text: 'Two years ago', startDate: '2025-06-01', endDate: '' }] });
  const y2026 = keyYear({
    '2026-11': [{ id: 'k1', text: 'Mum turns 70', startDate: '2026-11-14', endDate: '' }],
    '2026-08': [{ id: 'k2', text: 'Summer in Brittany', startDate: '2026-08-01', endDate: '2026-08-21' }, { id: 'blank', text: '  ', startDate: '2026-08-05', endDate: '' }],
    '2026-12': [{ id: 'k3', text: 'Christmas in Annecy', startDate: '2026-12-23', endDate: '2026-12-27' }, { id: 'k4', text: 'Winter break', startDate: '2025-12-22', endDate: '2026-01-04' }],
    '2026-03': [{ id: 'k5', text: 'Old-style anchor', date: '2026-03-08' }, { id: 'k6', text: 'Month only' }]
  });
  const y2027 = emptyYear();
  const offers = keyDatesToCarry(y2026, y2027, 2027);
  assert.deepEqual(offers.map(offer => [offer.id, offer.startDate, offer.endDate, offer.present]), [
    ['k6', '2027-03-01', '', false],
    ['k5', '2027-03-08', '', false],
    ['k2', '2027-08-01', '2027-08-21', false],
    ['k1', '2027-11-14', '', false],
    ['k4', '2026-12-22', '2027-01-04', false],
    ['k3', '2027-12-23', '2027-12-27', false]
  ].sort((a, b) => a[1].localeCompare(b[1])));
  assert.equal(offers.find(offer => offer.id === 'k4').startDate, '2026-12-22', 'a break that runs into the year is still offered');
  assert.deepEqual(keyDatesToCarry(y2025, y2027, 2027), [], 'nothing from two years before');
  assert.deepEqual(keyDatesToCarry(emptyYear(), y2027, 2027), [], 'nothing when the year before has no key dates');
  assert.deepEqual(keyDatesToCarry(undefined, y2027, 2027), []);
  assert.deepEqual(y2026.months['2026-11'].anchors[0], { id: 'k1', text: 'Mum turns 70', startDate: '2026-11-14', endDate: '' }, 'the year before is not changed');
});

test('dates the planned year already has start unticked; exact duplicates are offered once', () => {
  const y2026 = keyYear({
    '2026-02': [{ id: 's1', text: 'School holidays', startDate: '2026-02-14', endDate: '2026-03-01' }],
    '2026-04': [{ id: 's2', text: 'School holidays', startDate: '2026-04-11', endDate: '2026-04-26' }],
    '2026-11': [{ id: 'k1', text: 'Mum’s birthday', startDate: '2026-11-14', endDate: '' }, { id: 'k1b', text: 'mum’s  birthday', startDate: '2026-11-14', endDate: '' }],
    '2026-07': [{ id: 'k2', text: 'Launch day', startDate: '2026-07-01', endDate: '' }]
  });
  const y2027 = keyYear({
    '2027-04': [{ id: 'n1', text: 'School holidays', startDate: '2027-04-11', endDate: '2027-04-26' }],
    '2027-11': [{ id: 'n2', text: "Mum's birthday", startDate: '2027-11-13', endDate: '' }]
  });
  const offers = keyDatesToCarry(y2026, y2027, 2027);
  assert.deepEqual(offers.map(offer => [offer.id, offer.present]), [['s1', false], ['s2', true], ['k2', false], ['k1', true]]);
});

test('adding writes ordinary key dates and the step never offers them again', () => {
  const y2026 = keyYear({
    '2026-11': [{ id: 'k1', text: 'Mum turns 70', startDate: '2026-11-14', endDate: '' }],
    '2026-08': [{ id: 'k2', text: 'Summer in Brittany', startDate: '2026-08-01', endDate: '2026-08-21' }],
    '2026-07': [{ id: 'k3', text: 'Launch day', startDate: '2026-07-01', endDate: '' }],
    '2026-12': [{ id: 'k4', text: 'Winter break', startDate: '2025-12-22', endDate: '2026-01-04' }]
  });
  const y2027 = keyYear({ '2027-08': [{ id: 'mine', text: 'Wedding', startDate: '2027-08-28', endDate: '' }] });
  const offers = keyDatesToCarry(y2026, y2027, 2027);
  let n = 0;
  const added = carryKeyDates(y2027, 2027, offers, new Set(['k1', 'k2', 'k4']), () => `new-${++n}`);
  assert.deepEqual(added.map(anchor => anchor.text), ['Winter break', 'Summer in Brittany', 'Mum turns 70']);
  assert.deepEqual(y2027.months['2027-08'].anchors, [
    { id: 'mine', text: 'Wedding', startDate: '2027-08-28', endDate: '' },
    { id: 'new-2', text: 'Summer in Brittany', startDate: '2027-08-01', endDate: '2027-08-21' }
  ]);
  assert.deepEqual(y2027.months['2027-11'], { outcomes: [], anchors: [{ id: 'new-3', text: 'Mum turns 70', startDate: '2027-11-14', endDate: '' }] });
  assert.deepEqual(y2027.months['2027-12'].anchors, [{ id: 'new-1', text: 'Winter break', startDate: '2026-12-22', endDate: '2027-01-04' }], 'stored under the month it starts in, as Horizon does');
  assert.deepEqual(y2027.carriedKeyDates.sort(), ['k1', 'k2', 'k3', 'k4'], 'the unticked one counts as handled too');
  assert.deepEqual(yearKeyDates(y2027, 2027).map(item => item.text), ['Winter break', 'Summer in Brittany', 'Wedding', 'Mum turns 70']);
  assert.equal(planSummary(y2027, 2027).keyDates.length, 4);

  // Reopening the session: nothing left to offer, nothing added twice.
  assert.deepEqual(keyDatesToCarry(y2026, y2027, 2027), []);
  assert.deepEqual(carryKeyDates(y2027, 2027, keyDatesToCarry(y2026, y2027, 2027), new Set(['k1'])), []);
  assert.equal(yearKeyDates(y2027, 2027).length, 4);

  // A date added to the year before later is still offered, alone.
  y2026.months['2026-05'] = { outcomes: [], anchors: [{ id: 'k5', text: 'Anniversary', startDate: '2026-05-30', endDate: '' }] };
  assert.deepEqual(keyDatesToCarry(y2026, y2027, 2027).map(offer => offer.id), ['k5']);

  // Removing an added date in Horizon does not bring the offer back.
  y2027.months['2027-11'].anchors = [];
  assert.deepEqual(keyDatesToCarry(y2026, y2027, 2027).map(offer => offer.id), ['k5']);
});
