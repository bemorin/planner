import test from 'node:test';
import assert from 'node:assert/strict';
import { createWeekReviewFeature, renderWeekShareCta } from '../src/features/week-review.js';
import { atNoon, ymdKey } from '../src/lib/dates.js';

function makeFeature({ openWork = [], needsCount = 0 } = {}) {
  const currentDate = atNoon(new Date(2026, 7, 14));
  const days = [10, 11, 12, 13, 14].map(day => atNoon(new Date(2026, 7, day)));
  const dayState = {
    priorities: [{ text: 'Ship', done: true, carriedCount: 0 }, { text: '', done: false }, { text: '', done: false }],
    tasks: [],
    blocks: [{ categoryId: 'work', duration: 60 }],
    triaged: [],
    lesson: 'Keep it simple.'
  };
  return createWeekReviewFeature({
    getDate: () => currentDate,
    getState: () => dayState,
    getSettings: () => ({ openWork }),
    planningWeekDates: () => days,
    isPlanningDay: inputDate => days.some(day => ymdKey(day) === ymdKey(inputDate)),
    ymd: ymdKey,
    loadStateForDate: () => dayState,
    categoryFor: () => ({ id: 'work', name: 'Work', color: '#999' }),
    categoryFallback: () => ({ id: 'uncategorized', name: 'Uncategorized', color: '#999' }),
    getUnresolvedCounts: () => ({ needs: needsCount, later: openWork.length })
  });
}

test('weekly review recognizes the configured final planning day', () => {
  const feature = makeFeature();
  assert.equal(feature.isLastPlanningDay(new Date(2026, 7, 14)), true);
  assert.equal(feature.isLastPlanningDay(new Date(2026, 7, 13)), false);
});

test('weekly review renders unresolved work as an inline action', () => {
  const feature = makeFeature({ openWork: [{ id: 'o1', text: 'Decide later', carriedCount: 1 }] });
  const review = feature.weekReviewData(new Date(2026, 7, 14));
  const html = feature.renderWeekReviewSummary(review);
  assert.match(html, /data-review-open-work/);
  assert.match(html, /Review all/);
  assert.match(html, /Where your scheduled time went/);
  assert.match(html, /Still unresolved/);
  assert.match(html, />1<\/em>/);
});

test('weekly review renders the exact unresolved total from both queues', () => {
  const feature = makeFeature({ openWork: [{ id: 'o1', text: 'Decide later', carriedCount: 1 }], needsCount: 3 });
  const review = feature.weekReviewData(new Date(2026, 7, 14));
  const html = feature.renderWeekReviewSummary(review);
  assert.match(html, />4<\/em>/);
});

test('“Share your week” appears once a day of the week is closed', () => {
  const open = makeFeature();
  const review = open.weekReviewData(new Date(2026, 7, 14));
  assert.equal(review.share?.closed ?? 0, 0);
  assert.doesNotMatch(open.renderWeekReviewSummary(review), /data-week-share/, 'nothing closed: nothing to share');
});

test('the week share model paints closed days and offers the week’s lessons', () => {
  const currentDate = atNoon(new Date(2026, 7, 14));
  const days = [10, 11, 12, 13, 14].map(day => atNoon(new Date(2026, 7, day)));
  const closedDay = key => ({
    priorities: [{ text: 'Ship', done: key !== '2026-08-12', carriedCount: 0 }, { text: '', done: false }, { text: '', done: false }],
    tasks: [],
    blocks: [{ categoryId: 'work', duration: 90 }],
    triaged: [],
    lesson: key === '2026-08-13' ? 'Keep it simple.' : '',
    endedAt: key === '2026-08-11' ? '' : `${key}T18:00:00`
  });
  const feature = createWeekReviewFeature({
    getDate: () => currentDate,
    getState: () => closedDay(ymdKey(currentDate)),
    getSettings: () => ({ openWork: [], planningDays: [1, 2, 3, 4, 5] }),
    planningWeekDates: () => days,
    isPlanningDay: () => true,
    ymd: ymdKey,
    loadStateForDate: date => closedDay(ymdKey(date)),
    categoryFor: () => ({ id: 'work', name: 'Work', color: '#5f7084' }),
    categoryFallback: () => ({ id: 'uncategorized', name: 'Uncategorized', color: '#999999' })
  });
  const review = feature.weekReviewData(currentDate);
  assert.equal(review.share.kind, 'week');
  assert.equal(review.share.closed, 4);
  assert.deepEqual(review.share.days.map(day => day.state), ['closed', 'joker', 'closed', 'closed', 'closed'], 'a joker kept the streak, as in Progress');
  assert.equal(review.share.days[2].level, 1, 'closed without the main outcome');
  assert.equal(review.share.days[0].level, 2, 'closed with the main outcome done');
  assert.deepEqual(review.share.lines, ['Keep it simple.']);
  assert.equal(review.share.totalMinutes, 450);
  const html = feature.renderWeekReviewSummary(review);
  assert.match(html, /data-week-share/);
  assert.match(html, /Share your week/);
  assert.equal((html.match(/hz-paint__cell/g) || []).length, 5, 'one painted square per planning day');
  assert.doesNotMatch(renderWeekShareCta(review.share), /Keep it simple/, 'the entry never shows private text');
});
