import { addDaysKey, dateFromKey, ymdKey, atNoon } from '../../src/lib/dates.js';
import { defaultCategories } from '../../src/config.js';

/**
 * A sample planner, a test fixture for Insights (until 1.39 it was also a
 * preview in the planner): someone who started closing days in March last
 * year and got steadier this year. Deterministic (the same day always looks
 * the same) and dated relative to today. Pure.
 */

export const SAMPLE_PLANNING_DAYS = Object.freeze([1, 2, 3, 4, 5]);
export const SAMPLE_CATEGORIES = Object.freeze(defaultCategories.map(category => Object.freeze({ ...category })));

/** A small seeded generator (mulberry32) keyed by the day, so each day is stable. */
function random(seedText) {
  let seed = 2166136261;
  for (const char of seedText) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619);
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

const CLOSE_RATE = { 0: 0.05, 1: 0.86, 2: 0.93, 3: 0.89, 4: 0.84, 5: 0.66, 6: 0.08 };
const MOVED = ['Renew passport', 'Draft the Q4 plan', 'Call the insurer'];

/** The sample record for `key`, or null for a day the sample person didn't use. */
export function sampleDay(key, todayKey) {
  if (key > todayKey) return null;
  const today = dateFromKey(todayKey);
  const firstKey = ymdKey(atNoon(new Date(today.getFullYear() - 1, 2, 2)));
  if (key < firstKey) return null;
  const rand = random(`insights-sample:${key}`);
  const date = dateFromKey(key);
  const weekday = date.getDay();
  const thisYear = date.getFullYear() === today.getFullYear();
  const planning = SAMPLE_PLANNING_DAYS.includes(weekday);
  // Steadier this year than last: the same weekday shape, a higher level.
  const closeChance = Math.min(0.98, CLOSE_RATE[weekday] * (thisYear ? 1 : 0.8));
  const closed = key < todayKey && rand() < closeChance;
  if (!planning && !closed) return null;
  const monthIndex = (date.getFullYear() - today.getFullYear() + 1) * 12 + date.getMonth();
  const blocks = [];
  const add = (start, duration, categoryId) => blocks.push({ id: `s-${key}-${blocks.length}`, title: '', start, duration, categoryId });
  if (planning) {
    if (rand() < (weekday === 5 ? 0.35 : 0.86)) add(9 * 60, rand() < 0.3 ? 150 : 120, 'deep-work');
    if ((weekday === 2 || weekday === 4) && rand() < 0.45) add(14 * 60, 90, 'deep-work');
    if (rand() < 0.75) add(rand() < 0.5 ? 11 * 60 + 30 : 16 * 60, 60, 'admin');
    if (weekday === 5 && rand() < 0.7) add(11 * 60, 90, 'admin');
    if (rand() < 0.55) add(rand() < 0.6 ? 12 * 60 + 30 : 18 * 60, 45, 'health');
    // Learning grows through the year: evenings, more often lately.
    if ((weekday === 2 || weekday === 4 || weekday === 1) && rand() < 0.2 + monthIndex * 0.03) add(19 * 60, 60, 'learning');
    if (rand() < 0.3) add(17 * 60 + 30, 60, 'personal');
  } else if (rand() < 0.5) add(10 * 60, 90, 'personal');
  const mitDone = rand() < (weekday === 2 ? 0.86 : weekday === 5 ? 0.58 : 0.74) * (thisYear ? 1 : 0.9);
  const carried = closed ? Math.floor(rand() * 3.2) : 0;
  const transfers = Array.from({ length: carried }, () => {
    const roll = rand();
    return { mode: roll < 0.64 ? 'date' : roll < 0.84 ? 'later' : 'drop' };
  });
  const tasks = [
    { id: 't1', text: 'Reply to the newsletter', done: rand() < 0.7, carriedCount: 0 },
    { id: 't2', text: 'Book the train', done: rand() < 0.6, carriedCount: 0 }
  ];
  const daysAgo = Math.round((today - date) / 86400000);
  if (daysAgo < 40) tasks.push({ id: 't3', text: MOVED[daysAgo % 3], done: false, carriedCount: 5 - (daysAgo % 3), originDay: addDaysKey(todayKey, -60 - (daysAgo % 3)) });
  return {
    focus: '',
    priorities: [
      { id: 'p1', text: 'The one thing', done: mitDone, carriedCount: 0 },
      { id: 'p2', text: rand() < 0.8 ? 'Second outcome' : '', done: rand() < 0.6, carriedCount: 0 },
      { id: 'p3', text: rand() < 0.4 ? 'Third outcome' : '', done: rand() < 0.5, carriedCount: 0 }
    ],
    tasks,
    notes: '',
    blocks,
    endedAt: closed ? `${key}T18:30:00.000Z` : '',
    closeTransfers: transfers
  };
}

export const sampleCategoryFor = id => SAMPLE_CATEGORIES.find(category => category.id === id) || null;
