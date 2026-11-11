import test from 'node:test';
import assert from 'node:assert/strict';
import { buildProgressModel } from '../src/features/progress-model.js';
import {
  buildYearReview,
  defaultReviewYear,
  hoursLabel,
  inReviewSeason,
  pickJournal,
  renderYearReview,
  renderYearReviewPrint,
  reviewYearOptions,
  trimText
} from '../src/features/year-review.js';

const today = new Date(2026, 9, 9, 12); // 9 October 2026

const categories = {
  deep: { id: 'deep', name: 'Deep work', color: '#5f7084' },
  admin: { id: 'admin', name: 'Admin', color: '#746e67' },
  health: { id: 'health', name: 'Health', color: '#5f755b' }
};

const closedDay = (extra = {}) => ({ endedAt: 'x', priorities: [{ text: 'Ship', done: true }], blocks: [], memory: '', lesson: '', ...extra });

function records() {
  return {
    '2025-12-31': closedDay({ memory: 'Last year — never counted', blocks: [{ duration: 600, categoryId: 'deep' }] }),
    '2026-01-05': closedDay({ memory: 'Snow walk with Claire', lesson: 'Start earlier', blocks: [{ duration: 120, categoryId: 'deep' }, { duration: 60, categoryId: 'admin' }] }),
    '2026-01-06': closedDay({ memory: '  Snow   walk with Claire ', blocks: [{ duration: 90, categoryId: 'deep' }, { duration: 30, categoryId: 'gone' }] }),
    '2026-02-10': { priorities: [{ text: 'Plan', done: false }], blocks: [{ duration: 45, categoryId: 'health' }], memory: 'An unclosed day is not in the journal' },
    '2026-03-03': closedDay({ priorities: [{ text: 'Plan', done: false }], lesson: 'Say the hard thing early', blocks: [{ duration: 30 }] }),
    '2026-06-21': closedDay({ memory: 'Night hike under a full moon', lesson: 'Start earlier' }),
    '2026-09-30': closedDay({ memory: 'x'.repeat(400) }),
    '2026-11-02': closedDay({ memory: 'In the future, ignored', blocks: [{ duration: 999, categoryId: 'deep' }] })
  };
}

const yearData = {
  misogi: 'Ride the Pyrenees',
  misogiWhy: 'To prove it to myself',
  misogiStartDate: '2026-08-24',
  misogiEndDate: '2026-08-30',
  misogiDone: true,
  misogiMilestones: [{ id: 'm1', text: 'First 150 km', done: true, date: '' }, { id: 'm2', text: 'Tourmalet', done: false, date: '' }, { id: 'm3', text: ' ', done: true, date: '' }],
  meaningful: ['Dinner with the kids', '', 'Ship v2'],
  miniAdventures: [
    { id: 'a1', text: 'Night hike', startDate: '2026-06-21', endDate: '', status: 'done', done: true },
    { id: 'a2', text: 'Lisbon', startDate: '2026-10-17', endDate: '2026-10-19', status: 'planned', done: false },
    { id: 'a3', text: '', startDate: '', endDate: '', status: 'idea', done: false }
  ],
  habits: ['Read', '', '', 'Walk'],
  habitStartedAt: ['', '', '', ''],
  habitChecks: { '2026-01-05': [0], '2026-01-06': [0] }
};

function build(overrides = {}) {
  const data = records();
  const readDay = key => data[key] || null;
  const progress = buildProgressModel({ year: 2026, today, planningDays: [1, 2, 3, 4, 5], getRecord: readDay, yearData });
  return { progress, review: buildYearReview({ year: 2026, progress, yearData, readDay, categoryFor: id => categories[id] || null, today, ...overrides }) };
}

test('the year to review: the current one, or last year in January; offered on the Overview from December 1 to January 31', () => {
  assert.equal(defaultReviewYear(new Date(2027, 0, 20)), 2026);
  assert.equal(defaultReviewYear(new Date(2026, 11, 1)), 2026);
  assert.equal(defaultReviewYear(today), 2026);
  assert.equal(inReviewSeason(new Date(2026, 11, 1)), true);
  assert.equal(inReviewSeason(new Date(2027, 0, 31)), true);
  assert.equal(inReviewSeason(new Date(2027, 1, 1)), false);
  assert.equal(inReviewSeason(new Date(2026, 10, 30)), false);
  assert.deepEqual(reviewYearOptions(today, 2026), [2025, 2026], 'last year is always reviewable');
  assert.deepEqual(reviewYearOptions(today, 2023), [2023, 2024, 2025, 2026]);
});

test('helpers: trimming, hours and a balanced journal', () => {
  assert.equal(trimText('  a   b \n c '), 'a b c');
  const long = trimText('word '.repeat(60), 40);
  assert.ok(long.length <= 40 && long.endsWith('…'));
  assert.equal(hoursLabel(45), '45\u00a0min');
  assert.equal(hoursLabel(450), '7.5\u00a0h');
  assert.equal(hoursLabel(7560), '126\u00a0h', 'the unit never wraps away from its number');
  const m = [1, 2, 3, 4, 5, 6].map(n => ({ text: `m${n}` }));
  const l = [1, 2, 3].map(n => ({ text: `l${n}` }));
  assert.deepEqual(Object.values(pickJournal(m, l)).map(list => list.length), [3, 2]);
  assert.deepEqual(Object.values(pickJournal(m, [])).map(list => list.length), [5, 0]);
  assert.deepEqual(Object.values(pickJournal(m.slice(0, 1), l)).map(list => list.length), [1, 3]);
  assert.deepEqual(Object.values(pickJournal([], [])).map(list => list.length), [0, 0]);
});

test('days closed, streak, trophies and main outcomes come from the progress model', () => {
  const { review, progress } = build();
  assert.equal(review.days.closed, progress.closed);
  assert.equal(review.days.closeRate, progress.closeRate);
  assert.equal(review.bestStreak, progress.streak.yearBest);
  assert.equal(review.bestStreak, 2, 'Monday 5 and Tuesday 6 January');
  assert.equal(review.outcomes.done, progress.metrics.mitDone);
  assert.equal(review.outcomes.share, Math.round(progress.metrics.mitDone / progress.closed * 100));
  assert.equal(review.trophies.total, progress.trophies.length);
  assert.ok(review.trophies.unlocked.some(trophy => trophy.id === 'close-1'));
  assert.equal(review.isCurrentYear, true);
  assert.equal(review.asOf, '2026-10-09');
});

test('time by category sums scheduled blocks of the year up to today, with unknown categories grouped', () => {
  const { review } = build();
  const byName = Object.fromEntries(review.time.rows.map(row => [row.name, row.minutes]));
  assert.deepEqual(byName, { 'Deep work': 210, Admin: 60, Health: 45, 'No category': 60 });
  assert.equal(review.time.total, 375);
  assert.equal(review.time.days, 4);
  assert.equal(review.time.rows[0].name, 'Deep work');
  assert.ok(Math.abs(review.time.rows.reduce((sum, row) => sum + row.share, 0) - 1) < 1e-9);
});

test('more than six categories fold the smallest into one row', () => {
  const many = {};
  const days = {};
  ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].forEach((id, index) => {
    many[id] = { id, name: `Cat ${id}`, color: '#000' };
    days[`2026-01-${String(index + 10).padStart(2, '0')}`] = { blocks: [{ duration: (index + 1) * 10, categoryId: id }] };
  });
  const review = buildYearReview({ year: 2026, progress: null, yearData: {}, readDay: key => days[key] || null, categoryFor: id => many[id] || null, today });
  assert.equal(review.time.rows.length, 6);
  assert.equal(review.time.rows.at(-1).name, '3 other categories');
  assert.equal(review.time.rows.at(-1).minutes, 10 + 20 + 30);
});

test('memories and lessons: closed days only, most recent first, trimmed, a repeated one kept once at its latest day', () => {
  const { review } = build();
  assert.deepEqual(review.journal.memories.map(entry => entry.key), ['2026-09-30', '2026-06-21', '2026-01-06']);
  assert.ok(review.journal.memories[0].text.length <= 150 && review.journal.memories[0].text.endsWith('…'));
  assert.equal(review.journal.memories[2].text, 'Snow walk with Claire');
  assert.deepEqual(review.journal.lessons.map(entry => [entry.key, entry.text]), [['2026-06-21', 'Start earlier'], ['2026-03-03', 'Say the hard thing early']]);
  const all = [...review.journal.memories, ...review.journal.lessons].map(entry => entry.text).join(' ');
  assert.doesNotMatch(all, /unclosed|future|Last year/);
});

test('Horizon outcomes: Misogi, milestones, adventures lived, commitments and habits', () => {
  const { review } = build();
  assert.deepEqual(review.horizon.misogi, { text: 'Ride the Pyrenees', why: 'To prove it to myself', when: review.horizon.misogi.when, done: true, milestones: [{ text: 'First 150 km', done: true }, { text: 'Tourmalet', done: false }], milestonesDone: 1 });
  assert.equal(review.horizon.adventures.items.length, 2);
  assert.equal(review.horizon.adventures.lived, 1);
  assert.deepEqual(review.horizon.commitments, ['Dinner with the kids', 'Ship v2']);
  assert.equal(review.horizon.habits[0].text, 'Read');
  assert.equal(review.horizon.habits[0].done, 2);
  assert.equal(review.horizon.habits[1].percent, null);
  assert.equal(review.isEmpty, false);
});

test('a past year reads every day; a future or empty year is empty', () => {
  const data = records();
  const past = buildYearReview({ year: 2025, progress: null, yearData: {}, readDay: key => data[key] || null, today });
  assert.equal(past.isCurrentYear, false);
  assert.equal(past.time.total, 600);
  assert.equal(past.journal.memories[0].text, 'Last year — never counted');
  const future = buildYearReview({ year: 2027, progress: null, yearData: {}, readDay: () => { throw new Error('never read'); }, today });
  assert.equal(future.isFutureYear, true);
  assert.equal(future.isEmpty, true);
  const broken = buildYearReview({ year: 2026, progress: null, yearData: {}, readDay: () => { throw new Error('corrupt'); }, today });
  assert.equal(broken.time.total, 0, 'an unreadable day is skipped');
});

test('markup escapes what people wrote, on screen and in print', () => {
  const data = { '2026-03-02': closedDay({ memory: '<img src=x onerror=alert(1)>', blocks: [{ duration: 30, categoryId: 'evil' }] }) };
  const readDay = key => data[key] || null;
  const progress = buildProgressModel({ year: 2026, today, getRecord: readDay, yearData: {} });
  const review = buildYearReview({ year: 2026, progress, yearData: { misogi: '<b>Climb</b>' }, readDay, categoryFor: () => ({ id: 'evil', name: '<script>', color: '#000"><x' }), today });
  const icon = name => `<svg data-icon="${name}"></svg>`;
  [renderYearReview(review, progress, { icon }), renderYearReviewPrint(review, progress, { icon })].forEach(html => {
    assert.doesNotMatch(html, /<img|<script|<b>Climb/);
    assert.match(html, /&lt;img/);
    assert.doesNotMatch(html, /#000"><x/);
  });
  assert.match(renderYearReviewPrint(review, progress, { icon }), /planner\.bemorin\.com/);
});
