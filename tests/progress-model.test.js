import test from 'node:test';
import assert from 'node:assert/strict';
import { buildProgressModel, computeStreak, dayFacts, newlyUnlocked } from '../src/features/progress-model.js';
import { addDaysKey, ymdKey } from '../src/lib/dates.js';

const weekdays = [1, 2, 3, 4, 5];
// Friday 9 October 2026
const today = new Date(2026, 9, 9, 12);

function closedSet(keys) {
  const set = new Set(keys);
  return key => set.has(key);
}

test('dayFacts only counts days with an endedAt as closed', () => {
  assert.equal(dayFacts(null).closed, false);
  assert.equal(dayFacts({ priorities: [{ text: 'x', done: true }] }).closed, false);
  const facts = dayFacts({ endedAt: '2026-10-08T18:00', priorities: [{ text: 'Ship', done: true }], lesson: ' Slow down ', memory: '' });
  assert.deepEqual(facts, { closed: true, mitDone: true, lesson: true, memory: false });
});

test('weekends never break a weekday streak and today stays pending', () => {
  // Mon 28 Sep → Thu 8 Oct, every weekday closed; Friday 9 Oct not yet closed.
  const keys = [];
  for (let key = '2026-09-28'; key <= '2026-10-08'; key = addDaysKey(key, 1)) {
    const day = new Date(`${key}T12:00:00`).getDay();
    if (day !== 0 && day !== 6) keys.push(key);
  }
  const streak = computeStreak({ today, planningDays: weekdays, isClosed: closedSet(keys) });
  assert.equal(streak.current, 9);
  assert.equal(streak.best, 9);
  assert.equal(streak.todayPending, true);
  assert.equal(streak.jokersUsedThisMonth, 0);
});

test('two jokers per month absorb missed planning days, the third miss resets', () => {
  // Weekdays from Thu 1 Oct to Thu 8 Oct, missing Fri 2, Mon 5 and Tue 6.
  const closed = ['2026-10-01', '2026-10-07', '2026-10-08'];
  const twoMisses = computeStreak({ today, planningDays: weekdays, isClosed: closedSet(['2026-10-01', '2026-10-06', '2026-10-07', '2026-10-08']) });
  assert.equal(twoMisses.current, 4, 'Fri 2 and Mon 5 are covered by jokers');
  assert.equal(twoMisses.jokersLeftThisMonth, 0);
  assert.ok(twoMisses.jokerDays.has('2026-10-02') && twoMisses.jokerDays.has('2026-10-05'));
  const threeMisses = computeStreak({ today, planningDays: weekdays, isClosed: closedSet(closed) });
  assert.equal(threeMisses.current, 2, 'the third miss (Tue 6) resets the run');
  assert.equal(threeMisses.best, 2);
});

test('jokers are not spent before a streak exists', () => {
  const streak = computeStreak({ today, planningDays: weekdays, isClosed: closedSet(['2026-10-08']) });
  assert.equal(streak.current, 1);
  assert.equal(streak.jokersUsedThisMonth, 0);
});

test('a closed rest day adds to the streak as a bonus', () => {
  const weekdaysOnly = computeStreak({ today, planningDays: weekdays, isClosed: closedSet(['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08']) });
  const withSaturday = computeStreak({ today, planningDays: weekdays, isClosed: closedSet(['2026-10-03', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08']) });
  assert.equal(weekdaysOnly.current, 4);
  assert.equal(withSaturday.current, 5, 'Saturday 3 counts, Sunday 4 is skipped');
});

test('the year is painted with levels and trophies report progress toward their goal', () => {
  const records = {
    '2026-10-05': { endedAt: 'x', priorities: [{ text: 'A', done: true }], lesson: 'L' },
    '2026-10-06': { endedAt: 'x', priorities: [{ text: 'B', done: false }] },
    '2026-10-07': { endedAt: 'x', priorities: [{ text: 'C', done: true }], memory: 'M' }
  };
  const yearData = {
    misogi: 'Climb', misogiDone: false, misogiMilestones: [{ text: 'One', done: true }, { text: 'Two', done: true }],
    miniAdventures: [{ text: 'Lisbon', startDate: '2026-10-17', status: 'planned' }, { text: 'Hike', done: true, status: 'done' }],
    meaningful: ['a', 'b', ''], habits: ['', '', '', 'Read'], habitStartedAt: ['', '', '', '2026-10-01'],
    habitChecks: { '2026-10-07': [3] }
  };
  const model = buildProgressModel({ year: 2026, today, planningDays: weekdays, getRecord: key => records[key] || null, yearData });
  const october = model.months[9].days;
  assert.equal(october.find(cell => cell.key === '2026-10-05').level, 2, 'closed + main outcome done');
  assert.equal(october.find(cell => cell.key === '2026-10-06').level, 1, 'closed only');
  assert.equal(october.find(cell => cell.key === '2026-10-07').level, 3, 'closed + outcome + habit kept');
  assert.equal(october.find(cell => cell.key === '2026-10-09').today, true);
  assert.equal(october.find(cell => cell.key === '2026-10-02').before, true, 'days before the first closed day are not "missed"');
  assert.equal(october.find(cell => cell.key === '2026-10-08').before, false);
  assert.equal(model.planningElapsed, 4, 'Mon 5 → Thu 8 count; today and earlier days do not');
  assert.equal(model.closed, 3);
  const byId = Object.fromEntries(model.trophies.map(trophy => [trophy.id, trophy]));
  assert.equal(byId['close-1'].unlocked, true);
  assert.equal(byId['close-1'].unlockedOn, '2026-10-05');
  assert.equal(byId['close-10'].value, 3);
  assert.ok(Math.abs(byId['close-10'].progress - 0.3) < 1e-9);
  assert.equal(byId['misogi-named'].unlocked, true);
  assert.equal(byId['misogi-milestones'].value, 2);
  assert.equal(byId['adventure-1'].unlocked, true);
  assert.equal(byId['commitments-3'].value, 2);
  assert.equal(model.nextUp.length, 3);
  assert.ok(model.nextUp.every(trophy => !trophy.unlocked));
  assert.deepEqual(newlyUnlocked(model, ['close-1']).map(trophy => trophy.id).sort(), ['adventure-1', 'misogi-named']);
});

test('the painted year has one cell per day, including leap years', () => {
  const model = buildProgressModel({ year: 2028, today, planningDays: weekdays, getRecord: () => null });
  assert.equal(model.months.reduce((sum, month) => sum + month.days.length, 0), 366);
  assert.ok(model.months.flatMap(month => month.days).every(cell => cell.future));
  assert.equal(ymdKey(new Date(2028, 1, 29)), model.months[1].days[28].key);
});

test('streak trophies count only the viewed year, so they never re-lock or leak across years', () => {
  const every = [0, 1, 2, 3, 4, 5, 6];
  // Closed every day from 20 Dec 2025 to 9 Jan 2026; today is Sat 10 Jan 2026.
  const keys = [];
  for (let key = '2025-12-20'; key <= '2026-01-09'; key = addDaysKey(key, 1)) keys.push(key);
  const records = new Set(keys);
  const getRecord = key => (records.has(key) ? { endedAt: `${key}T20:00` } : null);
  const january = new Date(2026, 0, 10, 12);
  const streak = computeStreak({ today: january, planningDays: every, isClosed: closedSet(keys), year: 2026 });
  assert.equal(streak.current, 21, 'the current streak crosses New Year');
  assert.equal(streak.yearBest, 9, 'but only 2026 days count toward 2026 trophies');
  const model2026 = buildProgressModel({ year: 2026, today: january, planningDays: every, getRecord });
  assert.equal(model2026.trophies.find(trophy => trophy.id === 'streak-5').unlockedOn, '2026-01-05');
  assert.equal(model2026.trophies.find(trophy => trophy.id === 'streak-20').unlocked, false);
  const model2025 = buildProgressModel({ year: 2025, today: january, planningDays: every, getRecord });
  assert.equal(model2025.trophies.find(trophy => trophy.id === 'streak-5').unlockedOn, '2025-12-24');
  const model2027 = buildProgressModel({ year: 2027, today: january, planningDays: every, getRecord });
  assert.equal(model2027.unlocked.length, 0, 'a year not started has nothing unlocked');
});

test('the first trophy of a year is celebrated even before anything was marked seen', () => {
  const getRecord = key => (key === '2026-10-09' ? { endedAt: '2026-10-09T20:00' } : null);
  const model = buildProgressModel({ year: 2026, today, planningDays: weekdays, getRecord });
  assert.deepEqual(newlyUnlocked(model, null, '2026-10-09').map(trophy => trophy.id), ['close-1']);
  // An existing user upgrading: older trophies count as seen, today's are new.
  const history = new Set(['2026-10-01', '2026-10-02', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09']);
  const longer = buildProgressModel({ year: 2026, today, planningDays: weekdays, getRecord: key => (history.has(key) ? { endedAt: `${key}T20:00` } : null) });
  assert.deepEqual(newlyUnlocked(longer, null, '2026-10-09').map(trophy => trophy.id), []);
  assert.deepEqual(newlyUnlocked(longer, ['close-1'], '2026-10-09').map(trophy => trophy.id), ['streak-5']);
});
