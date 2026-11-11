import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHorizonModel } from '../src/features/horizon-view.js';

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

test('an empty year has no events, no next item and zero section progress', () => {
  const model = buildHorizonModel(yearData(), 2026, [], today);
  assert.equal(model.events.length, 0);
  assert.equal(model.next, null);
  assert.equal(model.misogi.progress, 0);
  assert.equal(model.adventures.slots, 6);
  assert.equal(model.commitments, 0);
  assert.equal(model.currentQuarter, 3);
  assert.equal(model.isCurrentYear, true);
  assert.ok(model.yearProgress > 0.75 && model.yearProgress < 0.8);
});

test('events are merged across element kinds and sorted by start date then kind', () => {
  const data = yearData({
    misogi: 'Ride the Pyrenees',
    misogiStartDate: '2026-08-24',
    misogiEndDate: '2026-08-30',
    misogiMilestones: [
      { id: 'm1', text: 'First 150 km', done: true, date: '2026-04-12' },
      { id: 'm2', text: 'Undated proof point', done: false, date: '' },
      { id: 'm3', text: '   ', done: false, date: '2026-05-01' }
    ],
    miniAdventures: [
      { id: 'a1', text: 'Lisbon weekend', startDate: '2026-10-17', endDate: '2026-10-19', status: 'planned', done: false },
      { id: 'a2', text: 'Learn to surf', startDate: '', endDate: '', status: 'idea', done: false }
    ]
  });
  const keyDates = [{ id: 'k1', text: 'Birthday', startDate: '2026-08-24', endDate: '', ownerMonth: 7 }];
  const model = buildHorizonModel(data, 2026, keyDates, today);
  assert.deepEqual(model.events.map(event => event.kind), ['milestone', 'misogi', 'keydate', 'adventure']);
  assert.equal(model.next?.id, 'a1', 'past and done events are not upcoming');
  assert.equal(model.adventures.named, 2);
  assert.equal(model.adventures.planned, 1);
  assert.equal(model.misogi.milestones, 2, 'named milestones count even without a date; blank ones do not');
  assert.equal(model.events.filter(event => event.kind === 'milestone').length, 1, 'only dated, named milestones reach the calendar');
  assert.equal(model.misogi.milestoneDone, 1);
  assert.ok(model.misogi.progress > 0.15 && model.misogi.progress < 1);
});

test('a completed Misogi reports full progress and done adventures count as planned', () => {
  const data = yearData({
    misogi: 'Climb', misogiDone: true,
    miniAdventures: [{ id: 'a1', text: 'Night hike', startDate: '', endDate: '', status: 'done', done: true }]
  });
  const model = buildHorizonModel(data, 2026, [], today);
  assert.equal(model.misogi.progress, 1);
  assert.equal(model.adventures.planned, 1);
  assert.equal(model.adventures.done, 1);
});

test('past and future years describe their position relative to today', () => {
  const past = buildHorizonModel(yearData(), 2025, [], today);
  assert.equal(past.isPastYear, true);
  assert.equal(past.yearProgress, 1);
  assert.equal(past.upcoming.length, 0);
  const future = buildHorizonModel(yearData(), 2027, [], today);
  assert.equal(future.isCurrentYear, false);
  assert.equal(future.isPastYear, false);
  assert.equal(future.yearProgress, 0);
});
