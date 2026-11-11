import { addDaysKey, atNoon, dateFromKey, ymdKey } from '../lib/dates.js';
import { habitActivityStats } from './horizon-model.js';

/**
 * Progress: the year painted day by day, a forgiving streak, and trophies.
 *
 * Pure derivations over stored day records — nothing here is persisted. The
 * rewarded gesture is closing the day; rest days never break a streak, and two
 * jokers per month quietly absorb a missed planning day.
 */

export const JOKERS_PER_MONTH = 2;

export const TROPHY_GROUPS = [
  { id: 'ritual', label: 'Daily ritual' },
  { id: 'streak', label: 'Streaks' },
  { id: 'reflection', label: 'Focus & reflection' },
  { id: 'horizon', label: 'Horizon' }
];

export const TROPHIES = [
  { id: 'close-1', group: 'ritual', icon: 'sunset', metric: 'closed', target: 1, title: 'First day closed', detail: 'Close your first day.' },
  { id: 'close-10', group: 'ritual', icon: 'sunset', metric: 'closed', target: 10, title: 'Ten days closed', detail: 'Close ten days this year.' },
  { id: 'close-50', group: 'ritual', icon: 'sunset', metric: 'closed', target: 50, title: 'Fifty days closed', detail: 'Close fifty days this year.' },
  { id: 'close-100', group: 'ritual', icon: 'sunset', metric: 'closed', target: 100, title: 'A hundred days closed', detail: 'Close a hundred days this year.' },
  { id: 'close-200', group: 'ritual', icon: 'sunset', metric: 'closed', target: 200, title: 'Two hundred days closed', detail: 'Close two hundred days this year.' },
  { id: 'streak-5', group: 'streak', icon: 'flame', metric: 'bestStreak', target: 5, title: 'A full week', detail: 'Close five planning days in a row.' },
  { id: 'streak-20', group: 'streak', icon: 'flame', metric: 'bestStreak', target: 20, title: 'A month, unbroken', detail: 'Close twenty planning days in a row.' },
  { id: 'streak-60', group: 'streak', icon: 'flame', metric: 'bestStreak', target: 60, title: 'A quarter, unbroken', detail: 'Close sixty planning days in a row.' },
  { id: 'mit-30', group: 'reflection', icon: 'target', metric: 'mitDone', target: 30, title: 'Thirty outcomes delivered', detail: 'Close thirty days with the most important outcome done.' },
  { id: 'lessons-10', group: 'reflection', icon: 'bulb', metric: 'lessons', target: 10, title: 'Ten lessons learned', detail: 'Write a lesson when you close ten days.' },
  { id: 'memories-25', group: 'reflection', icon: 'heart', metric: 'memories', target: 25, title: 'Twenty-five memories', detail: 'Keep a memory from twenty-five days.' },
  { id: 'misogi-named', group: 'horizon', icon: 'mountain', metric: 'misogiNamed', target: 1, title: 'The hard thing, named', detail: 'Name your Misogi for the year.' },
  { id: 'misogi-milestones', group: 'horizon', icon: 'diamond', metric: 'milestonesDone', target: 3, title: 'Proof of progress', detail: 'Complete three Misogi milestones.' },
  { id: 'misogi-done', group: 'horizon', icon: 'mountain', metric: 'misogiDone', target: 1, title: 'Misogi accomplished', detail: 'Complete the challenge that defines your year.' },
  { id: 'adventure-1', group: 'horizon', icon: 'flag', metric: 'adventuresDone', target: 1, title: 'First adventure lived', detail: 'Live one of your mini-adventures.' },
  { id: 'adventure-planned', group: 'horizon', icon: 'calendar', metric: 'adventuresPlanned', target: 6, title: 'Six on the calendar', detail: 'Give all six mini-adventures a date.' },
  { id: 'adventure-6', group: 'horizon', icon: 'flag', metric: 'adventuresDone', target: 6, title: 'Six adventures lived', detail: 'Live all six mini-adventures.' },
  { id: 'commitments-3', group: 'horizon', icon: 'heart', metric: 'commitments', target: 3, title: 'Three commitments', detail: 'Write the three things that would make the year meaningful.' },
  { id: 'habit-30', group: 'horizon', icon: 'repeat', metric: 'bestHabitDays', target: 30, title: 'A habit that stuck', detail: 'Keep one winning habit thirty days in a quarter.' },
  { id: 'habit-4', group: 'horizon', icon: 'repeat', metric: 'habitsSet', target: 4, title: 'Four seasons', detail: 'Choose a winning habit for every quarter.' }
];

const isClosedRecord = record => !!(record && typeof record === 'object' && record.endedAt);

/** Summarise one stored day for painting and trophies. */
export function dayFacts(record) {
  if (!isClosedRecord(record)) return { closed: false, mitDone: false, lesson: false, memory: false };
  const mit = Array.isArray(record.priorities) ? record.priorities[0] : null;
  return {
    closed: true,
    mitDone: !!(mit && String(mit.text || '').trim() && mit.done),
    lesson: !!String(record.lesson || '').trim(),
    memory: !!String(record.memory || '').trim()
  };
}

/**
 * Forgiving streak over the last `windowDays` days ending today.
 * - Planning days count; a closed rest day counts as a bonus; an unclosed rest day is skipped.
 * - A missed planning day uses one of the month's jokers if a streak is running, otherwise resets it.
 * - Today never breaks the streak: until it is closed it is simply pending.
 */
export function computeStreak({ today = new Date(), planningDays = [1, 2, 3, 4, 5], isClosed, windowDays = 730, jokersPerMonth = JOKERS_PER_MONTH, year = null }) {
  const todayKey = ymdKey(atNoon(today));
  const planning = new Set((planningDays || []).map(Number));
  // Streak trophies belong to one year: only that year's days count toward
  // `yearBest`, so they never depend on when you look or on another year.
  const yearStart = year == null ? '' : `${year}-01-01`;
  const yearEnd = year == null ? '' : `${year}-12-31`;
  const windowStart = addDaysKey(todayKey, -windowDays);
  const startKey = yearStart && yearStart < windowStart ? yearStart : windowStart;
  const jokersUsed = new Map();
  const jokerDays = new Set();
  const yearReachedOn = {};
  let run = 0;
  let best = 0;
  let yearRun = 0;
  let yearBest = 0;
  let started = false;
  let firstClosedKey = '';
  let todayPending = false;
  for (let key = startKey; key <= todayKey; key = addDaysKey(key, 1)) {
    const closed = !!isClosed(key);
    const isPlanning = planning.has(dateFromKey(key).getDay());
    if (!started) {
      if (!closed) continue;
      started = true;
      firstClosedKey = key;
    }
    if (closed) {
      run += 1;
      best = Math.max(best, run);
      if (yearStart && key >= yearStart && key <= yearEnd) {
        yearRun += 1;
        if (yearRun > yearBest) { yearBest = yearRun; yearReachedOn[yearBest] = key; }
      }
      continue;
    }
    if (!isPlanning) continue;
    if (key === todayKey) { todayPending = true; continue; }
    const month = key.slice(0, 7);
    const used = jokersUsed.get(month) || 0;
    if (run > 0 && used < jokersPerMonth) {
      jokersUsed.set(month, used + 1);
      jokerDays.add(key);
    } else {
      run = 0;
      yearRun = 0;
    }
  }
  const usedThisMonth = jokersUsed.get(todayKey.slice(0, 7)) || 0;
  return {
    current: run,
    best,
    yearBest,
    yearReachedOn,
    todayPending: todayPending && started,
    started,
    firstClosedKey,
    jokerDays,
    jokersUsedThisMonth: usedThisMonth,
    jokersLeftThisMonth: Math.max(0, jokersPerMonth - usedThisMonth)
  };
}

function horizonMetrics(yearData, year, today) {
  if (!yearData) return {};
  const milestones = (yearData.misogiMilestones || []).filter(item => String(item.text || '').trim());
  const adventures = (yearData.miniAdventures || []).filter(item => String(item.text || '').trim());
  const habits = Array.isArray(yearData.habits) ? yearData.habits : [];
  let bestHabitDays = 0;
  habits.forEach((habit, index) => {
    if (!String(habit || '').trim()) return;
    bestHabitDays = Math.max(bestHabitDays, habitActivityStats(yearData, index, year, today).done);
  });
  return {
    misogiNamed: String(yearData.misogi || '').trim() ? 1 : 0,
    misogiDone: String(yearData.misogi || '').trim() && yearData.misogiDone ? 1 : 0,
    milestonesDone: milestones.filter(item => item.done).length,
    adventuresDone: adventures.filter(item => item.done || item.status === 'done').length,
    adventuresPlanned: adventures.filter(item => item.startDate || item.done || item.status === 'done').length,
    commitments: (yearData.meaningful || []).filter(text => String(text || '').trim()).length,
    habitsSet: habits.filter(habit => String(habit || '').trim()).length,
    bestHabitDays
  };
}

/**
 * Build the full progress model for one year.
 * @param {object} options
 * @param {number} options.year
 * @param {Date} [options.today]
 * @param {number[]} options.planningDays weekdays (0 = Sunday)
 * @param {(key: string) => object|null} options.getRecord stored day record
 * @param {object} [options.yearData] Horizon data for the year
 */
export function buildProgressModel({ year, today = new Date(), planningDays = [1, 2, 3, 4, 5], getRecord, yearData = null }) {
  const now = atNoon(today);
  const todayKey = ymdKey(now);
  const planning = new Set((planningDays || []).map(Number));
  const cache = new Map();
  const facts = key => {
    if (!cache.has(key)) cache.set(key, dayFacts(getRecord(key)));
    return cache.get(key);
  };
  const habitChecks = yearData?.habitChecks || {};
  const habits = Array.isArray(yearData?.habits) ? yearData.habits : [];
  const counts = { closed: 0, mitDone: 0, lessons: 0, memories: 0 };
  const reachedOn = {};
  const markReached = (metric, key) => {
    TROPHIES.filter(trophy => trophy.metric === metric && trophy.target === counts[metric]).forEach(trophy => { reachedOn[trophy.id] = key; });
  };
  const months = Array.from({ length: 12 }, (_, month) => ({ month, days: [], closed: 0, planningElapsed: 0 }));
  let planningElapsed = 0;
  // Days before the first day ever closed are "before you started", never "missed".
  const streak = computeStreak({ today: now, planningDays, isClosed: key => facts(key).closed, year });
  const startKey = streak.firstClosedKey;

  for (let day = atNoon(new Date(year, 0, 1)); day.getFullYear() === year; day.setDate(day.getDate() + 1)) {
    const key = ymdKey(day);
    const fact = facts(key);
    const weekday = day.getDay();
    const isPlanning = planning.has(weekday);
    const future = key > todayKey;
    const quarter = Math.floor(day.getMonth() / 3);
    const habitKept = fact.closed && !!String(habits[quarter] || '').trim() && Array.isArray(habitChecks[key]) && habitChecks[key].includes(quarter);
    const level = !fact.closed ? 0 : 1 + (fact.mitDone ? 1 : 0) + (habitKept ? 1 : 0);
    const before = !future && !fact.closed && (!startKey || key < startKey);
    const cell = { key, day: day.getDate(), weekday, planning: isPlanning, future, before, today: key === todayKey, closed: fact.closed, mitDone: fact.mitDone, habitKept, level };
    months[day.getMonth()].days.push(cell);
    if (!future && !before && isPlanning && key !== todayKey) { planningElapsed += 1; months[day.getMonth()].planningElapsed += 1; }
    if (fact.closed) {
      months[day.getMonth()].closed += 1;
      counts.closed += 1; markReached('closed', key);
      if (fact.mitDone) { counts.mitDone += 1; markReached('mitDone', key); }
      if (fact.lesson) { counts.lessons += 1; markReached('lessons', key); }
      if (fact.memory) { counts.memories += 1; markReached('memories', key); }
    }
  }

  const metrics = { ...counts, bestStreak: streak.yearBest, ...horizonMetrics(yearData, year, now) };
  TROPHIES.filter(trophy => trophy.metric === 'bestStreak' && streak.yearReachedOn[trophy.target]).forEach(trophy => { reachedOn[trophy.id] = streak.yearReachedOn[trophy.target]; });
  const trophies = TROPHIES.map(trophy => {
    const value = Math.max(0, Number(metrics[trophy.metric]) || 0);
    return { ...trophy, value: Math.min(value, trophy.target), progress: Math.min(1, value / trophy.target), unlocked: value >= trophy.target, unlockedOn: value >= trophy.target ? reachedOn[trophy.id] || '' : '' };
  });
  const unlocked = trophies.filter(trophy => trophy.unlocked);
  const nextUp = trophies.filter(trophy => !trophy.unlocked).sort((a, b) => b.progress - a.progress || a.target - b.target).slice(0, 3);

  months.forEach(month => month.days.forEach(cell => { cell.joker = streak.jokerDays.has(cell.key); }));

  return {
    year,
    todayKey,
    months,
    closed: counts.closed,
    planningElapsed,
    closeRate: planningElapsed ? Math.round(Math.min(counts.closed, planningElapsed) / planningElapsed * 100) : 0,
    streak,
    metrics,
    trophies,
    unlocked,
    nextUp
  };
}

/**
 * Trophies unlocked now that were not in `seenIds` — used to celebrate once.
 * With no record yet for the year (`seenIds` null: first close of the year, or
 * the first close after upgrading), trophies reached before `dayKey` count as
 * already seen, and so do Horizon trophies, which carry no date — so a long-time
 * user isn't flooded, while a first closed day still gets its trophy.
 */
export function newlyUnlocked(model, seenIds = [], dayKey = '') {
  if (seenIds == null) return model.trophies.filter(trophy => trophy.unlocked && trophy.unlockedOn && trophy.unlockedOn >= dayKey);
  const seen = new Set(seenIds);
  return model.trophies.filter(trophy => trophy.unlocked && !seen.has(trophy.id));
}
