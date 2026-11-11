import { esc, escAttr } from '../lib/text.js';
import { atNoon, dateFromKey, daysBetweenKeys, ymdKey } from '../lib/dates.js';
import { habitActivityStats, rangeLabel } from './horizon-model.js';
import { hoursLabel, pickJournal, trimText } from './year-review.js';
import { ensurePlanShape, habitEditable, setHabit } from './year-plan.js';

/**
 * Quarter check-ins: a guided ten minutes at the turn of
 * each quarter — look back on the quarter, two questions, set up the next one
 * — that ends with the quarter printed on one page.
 *
 * This module is pure: quarter arithmetic, the check-in window, the look-back
 * model (`buildQuarterReview`), the saved answers (`quarterReviews` in the
 * year's Horizon data, carried by sync and backups with the rest of the
 * settings record) and the small markup of its entry points. The guided
 * session lives in quarter-session.js and the printed page in quarter-print.js.
 */

export const QUARTER_MINUTES = 10;
/** The Overview offers the check-in from two weeks before a quarter ends to four weeks after. */
export const CHECKIN_BEFORE_DAYS = 14;
export const CHECKIN_AFTER_DAYS = 28;
export const MAX_ANSWER = 600;
export const MAX_FOCUS = 160;
const MAX_CATEGORIES = 6;
const JOURNAL_LIMIT = 4;
const MAX_ADVENTURES = 6;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const ANSWER_FIELDS = ['wentWell', 'change', 'focus'];
const UNCATEGORIZED = { id: '', name: 'No category', color: '#8c867f' };

const pad = value => String(value).padStart(2, '0');
const text = value => String(value ?? '');
const filled = value => !!text(value).trim();
const oneLine = value => text(value).replace(/[\r\n]+/g, ' ');
const daysIn = (year, month) => new Date(year, month + 1, 0).getDate();
const monthName = (year, month, style = 'long') => new Date(year, month, 1).toLocaleDateString(undefined, { month: style });
const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;
const isObject = value => !!value && typeof value === 'object' && !Array.isArray(value);

// ---------------------------------------------------------------------------
// Quarters
// ---------------------------------------------------------------------------

export const quarterId = quarter => `Q${Number(quarter) + 1}`;
export const quarterOf = (input = new Date()) => Math.floor(new Date(input).getMonth() / 3);
export const quarterKey = ({ year, quarter }) => `${year}-Q${quarter + 1}`;
export const quarterLabel = ({ year, quarter }) => `Q${quarter + 1} ${year}`;
export const sameQuarter = (a, b) => !!a && !!b && a.year === b.year && a.quarter === b.quarter;
export const nextQuarter = ({ year, quarter }) => (quarter >= 3 ? { year: year + 1, quarter: 0 } : { year, quarter: quarter + 1 });
export const previousQuarter = ({ year, quarter }) => (quarter <= 0 ? { year: year - 1, quarter: 3 } : { year, quarter: quarter - 1 });

/** "2026-Q3" (a data attribute) → { year: 2026, quarter: 2 }, or null. */
export function parseQuarterKey(value) {
  const match = /^(\d{4})-Q([1-4])$/.exec(String(value || '').trim());
  return match ? { year: Number(match[1]), quarter: Number(match[2]) - 1 } : null;
}

/** First and last day of a quarter (keys), its three months and its length in days. */
export function quarterBounds(year, quarter) {
  const first = quarter * 3;
  const start = `${year}-${pad(first + 1)}-01`;
  const end = `${year}-${pad(first + 3)}-${pad(daysIn(year, first + 2))}`;
  return { start, end, months: [first, first + 1, first + 2], days: daysBetweenKeys(start, end) + 1 };
}

/** "July – September" (or "Jul – Sep", or "July to September" in a sentence). */
export function quarterMonths({ year, quarter }, style = 'long', joiner = ' – ') {
  return `${monthName(year, quarter * 3, style)}${joiner}${monthName(year, quarter * 3 + 2, style)}`;
}

/**
 * Where today sits in the check-in season: the last two weeks of a quarter
 * ('closing', that quarter) or the first four weeks of the next ('closed', the
 * quarter that just ended). Null in between.
 */
export function checkInWindow(today = new Date(), { before = CHECKIN_BEFORE_DAYS, after = CHECKIN_AFTER_DAYS } = {}) {
  const now = atNoon(today);
  const key = ymdKey(now);
  const current = { year: now.getFullYear(), quarter: quarterOf(now) };
  const bounds = quarterBounds(current.year, current.quarter);
  const daysLeft = daysBetweenKeys(key, bounds.end);
  if (daysLeft < before) return { ...current, phase: 'closing', daysLeft, daysSince: 0 };
  const sinceStart = daysBetweenKeys(bounds.start, key);
  if (sinceStart < after) return { ...previousQuarter(current), phase: 'closed', daysLeft: 0, daysSince: sinceStart + 1 };
  return null;
}

/** The quarter a check-in opens on: the one in season, else the quarter under way ("so far"). */
export function defaultCheckInQuarter(today = new Date()) {
  const window = checkInWindow(today);
  return window ? { year: window.year, quarter: window.quarter } : { year: today.getFullYear(), quarter: quarterOf(today) };
}

/** Quarters a check-in can look back on: from Q1 of the first Horizon year (always the last quarter) to the current one. */
export function checkInOptions(today = new Date(), minYear = today.getFullYear()) {
  const current = { year: today.getFullYear(), quarter: quarterOf(today) };
  const first = Math.min(Number(minYear) || current.year, previousQuarter(current).year, current.year);
  const options = [];
  for (let at = { year: first, quarter: 0 }; at.year < current.year || (at.year === current.year && at.quarter <= current.quarter); at = nextQuarter(at)) options.push(at);
  return options;
}

// ---------------------------------------------------------------------------
// Calendar months, painted
// ---------------------------------------------------------------------------

/** The seven weekdays (0 = Sunday) in the order the planner's weeks start. */
export function weekdayOrder(weekStartsOn = 1) {
  const start = ((Math.trunc(Number(weekStartsOn)) || 0) % 7 + 7) % 7;
  return Array.from({ length: 7 }, (_, index) => (start + index) % 7);
}

/** Empty cells before the first of the month in a week that starts on `weekStartsOn`. */
export function monthLead(year, month, weekStartsOn = 1) {
  return weekdayOrder(weekStartsOn).indexOf(new Date(year, month, 1).getDay());
}

/** Rows a month takes in a calendar (4 to 6). */
export function monthRows(year, month, weekStartsOn = 1) {
  return Math.ceil((monthLead(year, month, weekStartsOn) + daysIn(year, month)) / 7);
}

/** One-letter weekday heads ("M T W T F S S") in the planner's order. */
export function weekdayInitials(weekStartsOn = 1) {
  return weekdayOrder(weekStartsOn).map(day => new Date(2023, 0, 1 + day).toLocaleDateString(undefined, { weekday: 'narrow' }));
}

/** The painted state of a day, in the order the app paints it (progress-view.js). */
export function paintState(cell, todayKey = '') {
  if (!cell) return 'empty';
  if (cell.closed) return `l${Math.max(1, Math.min(3, Number(cell.level) || 1))}`;
  if (cell.today || cell.key === todayKey) return 'today';
  if (cell.future) return 'future';
  if (cell.before) return 'before';
  if (cell.joker) return 'joker';
  return cell.planning ? 'missed' : 'rest';
}

/**
 * The longest run of closed days inside the quarter, counted like the streak:
 * rest days and days a joker covered neither count nor break it.
 */
export function bestRun(cells) {
  let run = 0;
  let best = 0;
  (cells || []).forEach(cell => {
    if (!cell) return;
    if (cell.closed) { run += 1; best = Math.max(best, run); return; }
    if (cell.future || cell.today || cell.joker || !cell.planning) return;
    run = 0;
  });
  return best;
}

// ---------------------------------------------------------------------------
// Saved check-ins: yearData.quarterReviews = { Q1: { done, wentWell, change, focus, completedAt, nudged?, carried? } }
// ---------------------------------------------------------------------------

/** A clean copy of one saved check-in. Unknown fields are kept, so a newer planner's additions survive. */
export function normalizeQuarterEntry(raw) {
  const value = isObject(raw) ? raw : {};
  const entry = {
    ...value,
    done: !!value.done,
    wentWell: text(value.wentWell).slice(0, MAX_ANSWER),
    change: text(value.change).slice(0, MAX_ANSWER),
    focus: oneLine(value.focus).slice(0, MAX_FOCUS),
    completedAt: ISO_DAY.test(value.completedAt || '') ? value.completedAt : ''
  };
  if (value.nudged) entry.nudged = true;
  else delete entry.nudged;
  // Q4: the ideas this check-in put on next year's list ({ adventure id: idea id }), the only ones it may take back.
  const carried = isObject(value.carried) ? Object.entries(value.carried).filter(([from, to]) => from && to && typeof to === 'string') : [];
  if (carried.length) entry.carried = Object.fromEntries(carried);
  else delete entry.carried;
  return entry;
}

/** Make `d.quarterReviews` a clean { Q1…Q4 } map (in place) and return it. */
export function ensureQuarterReviews(d) {
  const source = isObject(d.quarterReviews) ? d.quarterReviews : {};
  const reviews = {};
  Object.keys(source).forEach(key => { if (/^Q[1-4]$/.test(key)) reviews[key] = normalizeQuarterEntry(source[key]); });
  d.quarterReviews = reviews;
  return reviews;
}

/** The saved check-in of a quarter (a normalized copy; nothing is written). */
export function quarterEntry(d, quarter) {
  return normalizeQuarterEntry(isObject(d?.quarterReviews) ? d.quarterReviews[quarterId(quarter)] : null);
}

function updateEntry(d, quarter, change) {
  if (!Number.isInteger(quarter) || quarter < 0 || quarter > 3) return false;
  const reviews = ensureQuarterReviews(d);
  const id = quarterId(quarter);
  const entry = normalizeQuarterEntry(reviews[id]);
  change(entry);
  reviews[id] = entry;
  return true;
}

/** Save one answer: "What went well?", "What will you do differently?" or the next quarter's focus (one line). */
export function setQuarterAnswer(d, quarter, field, value) {
  if (!ANSWER_FIELDS.includes(field)) return false;
  return updateEntry(d, quarter, entry => { entry[field] = field === 'focus' ? oneLine(value).slice(0, MAX_FOCUS) : text(value).slice(0, MAX_ANSWER); });
}

/** Mark a check-in done; the day it was first completed is kept. */
export function completeQuarterReview(d, quarter, today = new Date()) {
  return updateEntry(d, quarter, entry => { entry.done = true; if (!entry.completedAt) entry.completedAt = ymdKey(today); });
}

/** The Close-day nudge is shown once per quarter. */
export function markQuarterNudged(d, quarter) {
  return updateEntry(d, quarter, entry => { entry.nudged = true; });
}

// ---------------------------------------------------------------------------
// Horizon within a quarter
// ---------------------------------------------------------------------------

/** The Misogi, milestones, mini-adventures and key dates that fall in [startKey, endKey]. */
export function horizonItemsInRange(d, startKey, endKey) {
  const overlaps = (start, end) => ISO_DAY.test(start || '') && start <= endKey && (ISO_DAY.test(end || '') && end >= start ? end : start) >= startKey;
  const byDate = (a, b) => a.startDate.localeCompare(b.startDate) || a.text.localeCompare(b.text);
  const misogiText = text(d?.misogi).trim();
  const misogi = misogiText && overlaps(d.misogiStartDate, d.misogiEndDate)
    ? { text: misogiText, startDate: d.misogiStartDate, endDate: d.misogiEndDate || '', done: !!d.misogiDone, when: rangeLabel(d.misogiStartDate, d.misogiEndDate) }
    : null;
  const milestones = (Array.isArray(d?.misogiMilestones) ? d.misogiMilestones : [])
    .filter(item => filled(item?.text) && ISO_DAY.test(item.date || '') && item.date >= startKey && item.date <= endKey)
    .map(item => ({ kind: 'milestone', id: text(item.id), text: item.text.trim(), startDate: item.date, endDate: '', when: rangeLabel(item.date), done: !!item.done }))
    .sort(byDate);
  const adventures = (Array.isArray(d?.miniAdventures) ? d.miniAdventures : [])
    .filter(item => filled(item?.text) && overlaps(item.startDate, item.endDate))
    .map(item => ({ kind: 'adventure', id: text(item.id), text: item.text.trim(), startDate: item.startDate, endDate: item.endDate || '', when: rangeLabel(item.startDate, item.endDate), done: !!item.done || item.status === 'done' }))
    .sort(byDate);
  const keyDates = [];
  Object.values(isObject(d?.months) ? d.months : {}).forEach(month => {
    (Array.isArray(month?.anchors) ? month.anchors : []).forEach(anchor => {
      if (filled(anchor?.text) && overlaps(anchor.startDate, anchor.endDate)) keyDates.push({ kind: 'keydate', id: text(anchor.id), text: anchor.text.trim(), startDate: anchor.startDate, endDate: anchor.endDate || '', when: rangeLabel(anchor.startDate, anchor.endDate), done: false });
    });
  });
  keyDates.sort(byDate);
  return { misogi, milestones, adventures, keyDates };
}

/** The quarter's winning habit and how often it was kept, month by month. */
export function quarterHabit(d, year, quarter, today = new Date()) {
  const habitText = text(d?.habits?.[quarter]).trim();
  if (!habitText) return { quarter, text: '', set: false, done: 0, elapsed: 0, percent: null, longest: 0, months: [] };
  const stats = habitActivityStats(d, quarter, year, today);
  const months = [0, 1, 2].map(offset => {
    const month = quarter * 3 + offset;
    const days = stats.days.filter(day => day.date.getMonth() === month);
    return { month, done: days.filter(day => day.done).length, elapsed: days.length };
  });
  return { quarter, text: habitText, set: true, done: stats.done, elapsed: stats.elapsed, percent: stats.elapsed ? stats.percent : null, longest: stats.longest, months, trackingStart: ymdKey(stats.trackingStart) };
}

// ---------------------------------------------------------------------------
// The look-back model
// ---------------------------------------------------------------------------

function timeRows(minutes, categoryFor) {
  const total = [...minutes.values()].reduce((sum, value) => sum + value, 0);
  const buckets = new Map();
  minutes.forEach((value, id) => {
    let category = null;
    try { category = id ? categoryFor(id) : null; } catch (_) { category = null; }
    const row = category ? { id: String(category.id || id), name: String(category.name || UNCATEGORIZED.name), color: category.color || UNCATEGORIZED.color } : { ...UNCATEGORIZED };
    const bucket = buckets.get(row.id) || { ...row, minutes: 0 };
    bucket.minutes += value;
    buckets.set(row.id, bucket);
  });
  const ranked = [...buckets.values()].sort((a, b) => b.minutes - a.minutes || a.name.localeCompare(b.name));
  let rows = ranked;
  if (ranked.length > MAX_CATEGORIES) {
    const rest = ranked.slice(MAX_CATEGORIES - 1);
    rows = [...ranked.slice(0, MAX_CATEGORIES - 1), { id: '__other', name: `${rest.length} other categories`, color: UNCATEGORIZED.color, minutes: rest.reduce((sum, row) => sum + row.minutes, 0) }];
  }
  return { total, rows: rows.map(row => ({ ...row, share: total ? row.minutes / total : 0 })) };
}

/**
 * Everything a check-in looks back on, for one quarter (pure).
 * @param {object} options
 * @param {number} options.year
 * @param {number} options.quarter 0–3
 * @param {object} [options.progress] progress model of the year (progress-model.js)
 * @param {object} [options.yearData] Horizon data of the year
 * @param {object} [options.nextYearData] Horizon data of the next year (Q4: the next quarter's habit lives there)
 * @param {object} [options.previousEntry] the previous quarter's saved check-in (its focus is recalled)
 * @param {(key: string) => object|null} [options.readDay]
 * @param {(id: string) => object|null} [options.categoryFor]
 * @param {number} [options.weekStartsOn] 0 = Sunday
 */
export function buildQuarterReview({ year, quarter, progress = null, yearData = {}, nextYearData = null, previousEntry = null, readDay = () => null, categoryFor = () => null, weekStartsOn = 1, today = new Date() }) {
  const now = atNoon(today);
  const todayKey = ymdKey(now);
  const bounds = quarterBounds(year, quarter);
  const status = todayKey > bounds.end ? 'past' : todayKey < bounds.start ? 'future' : 'current';
  const last = status === 'current' ? todayKey : bounds.end;
  const d = isObject(yearData) ? yearData : {};

  const minutes = new Map();
  const entries = [];
  let scheduledDays = 0;
  if (status !== 'future') {
    for (let day = dateFromKey(bounds.start); ymdKey(day) <= last; day.setDate(day.getDate() + 1)) {
      const key = ymdKey(day);
      let record = null;
      try { record = readDay(key); } catch (_) { record = null; }
      if (!isObject(record)) continue;
      let any = false;
      (Array.isArray(record.blocks) ? record.blocks : []).forEach(block => {
        const duration = Math.min(24 * 60, Math.max(0, Number(block?.duration) || 0));
        if (!duration) return;
        any = true;
        const id = String(block.categoryId || '');
        minutes.set(id, (minutes.get(id) || 0) + duration);
      });
      if (any) scheduledDays += 1;
      if (record.endedAt) ['memory', 'lesson'].forEach(field => { const value = trimText(record[field]); if (value) entries.push({ field, key, text: value }); });
    }
  }
  const time = timeRows(minutes, categoryFor);

  // Most recent first; the same words on several days are kept once.
  const memories = [];
  const lessons = [];
  const seen = new Set();
  entries.reverse().forEach(entry => {
    const id = `${entry.field}:${entry.text.toLocaleLowerCase()}`;
    if (seen.has(id)) return;
    seen.add(id);
    (entry.field === 'memory' ? memories : lessons).push({ key: entry.key, text: entry.text });
  });
  const journal = pickJournal(memories, lessons, JOURNAL_LIMIT);

  // The painted days come from the progress model; only days up to today count.
  const cells = [];
  const months = bounds.months.map(month => {
    const source = progress?.months?.[month] || null;
    let closedInMonth = 0;
    const days = Array.from({ length: daysIn(year, month) }, (_, index) => {
      const key = `${year}-${pad(month + 1)}-${pad(index + 1)}`;
      const cell = source?.days?.[index]?.key === key && key <= todayKey ? source.days[index] : null;
      if (cell) { cells.push(cell); if (cell.closed) closedInMonth += 1; }
      return { key, day: index + 1, state: cell ? paintState(cell, todayKey) : key > todayKey ? 'future' : 'empty' };
    });
    return { month, name: monthName(year, month), short: monthName(year, month, 'short'), closed: closedInMonth, planningElapsed: source?.planningElapsed || 0, lead: monthLead(year, month, weekStartsOn), days };
  });
  const closed = months.reduce((sum, month) => sum + month.closed, 0);
  const planningElapsed = months.reduce((sum, month) => sum + month.planningElapsed, 0);
  const mitDone = cells.filter(cell => cell.closed && cell.mitDone).length;

  const horizon = horizonItemsInRange(d, bounds.start, bounds.end);
  const habit = quarterHabit(d, year, quarter, today);
  const next = nextQuarter({ year, quarter });
  const nextBounds = quarterBounds(next.year, next.quarter);
  const nextData = next.year === year ? d : nextYearData;
  const entry = quarterEntry(d, quarter);

  return {
    year,
    quarter,
    id: quarterId(quarter),
    label: quarterLabel({ year, quarter }),
    period: quarterMonths({ year, quarter }),
    start: bounds.start,
    end: bounds.end,
    status,
    isCurrent: status === 'current',
    asOf: status === 'current' ? todayKey : '',
    daysLeft: status === 'current' ? daysBetweenKeys(todayKey, bounds.end) : 0,
    weekdays: weekdayInitials(weekStartsOn),
    days: { closed, planningElapsed, closeRate: planningElapsed ? Math.round(Math.min(closed, planningElapsed) / planningElapsed * 100) : 0, bestRun: bestRun(cells) },
    months,
    outcomes: { done: mitDone, share: closed ? Math.round(mitDone / closed * 100) : 0 },
    time: { total: time.total, days: scheduledDays, rows: time.rows },
    habit,
    horizon: {
      ...horizon,
      milestonesDone: horizon.milestones.filter(item => item.done).length,
      lived: horizon.adventures.filter(item => item.done).length
    },
    journal,
    entry,
    previousFocus: text(previousEntry?.focus).trim(),
    // A late check-in can come after the next quarter is over ('past').
    next: { ...next, id: quarterId(next.quarter), label: quarterLabel(next), period: quarterMonths(next), end: nextBounds.end, status: todayKey > nextBounds.end ? 'past' : todayKey < nextBounds.start ? 'future' : 'current', habit: text(nextData?.habits?.[next.quarter]).trim() },
    isEmpty: !closed && !time.total && !horizon.milestones.length && !horizon.adventures.length && !horizon.misogi && !habit.set && !memories.length && !lessons.length
  };
}

/** The quarter in one line: "58 days closed, the Misogi accomplished, 2 of 3 mini-adventures lived and 212 h scheduled." */
export function quarterLead(review) {
  if (review.isEmpty) return review.isCurrent ? `Nothing to look back on in ${review.id} yet. Close a day and the quarter starts painting itself.` : `A quiet quarter: nothing was closed or planned in ${review.id}.`;
  const { misogi, adventures, lived } = review.horizon;
  const parts = [];
  if (review.days.closed) parts.push(plural(review.days.closed, 'day') + ' closed');
  if (misogi?.done) parts.push('the Misogi accomplished');
  // A non-breaking hyphen: "mini-" never ends a line.
  if (lived) parts.push(adventures.length === 1 ? 'a mini‑adventure lived' : lived === adventures.length ? `all ${adventures.length} mini‑adventures lived` : `${lived} of ${adventures.length} mini‑adventures lived`);
  if (review.time.total) parts.push(`${hoursLabel(review.time.total)} scheduled`);
  if (!parts.length) return review.isCurrent ? 'The quarter so far, on one page.' : 'The quarter, on one page.';
  const line = `${parts.length < 2 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`}.`;
  return review.isCurrent ? `So far, ${line}` : `${line[0].toUpperCase()}${line.slice(1)}`;
}

/** A light preview for the Overview card (no day records read): days closed, the habit, adventures lived. */
export function quarterPreview({ year, quarter, progress = null, yearData = {}, today = new Date() }) {
  const bounds = quarterBounds(year, quarter);
  const closed = bounds.months.reduce((sum, month) => sum + (progress?.months?.[month]?.closed || 0), 0);
  const planningElapsed = bounds.months.reduce((sum, month) => sum + (progress?.months?.[month]?.planningElapsed || 0), 0);
  const habit = quarterHabit(yearData, year, quarter, today);
  const { adventures } = horizonItemsInRange(yearData, bounds.start, bounds.end);
  return { closed, closeRate: planningElapsed ? Math.round(Math.min(closed, planningElapsed) / planningElapsed * 100) : 0, habit: habit.set && habit.percent != null ? habit.percent : null, lived: adventures.filter(item => item.done).length, adventures: adventures.length };
}

// ---------------------------------------------------------------------------
// The next quarter: its habit, and what is left over
// ---------------------------------------------------------------------------

/** Can the next quarter's habit be set from the check-in? (A running, tracked habit is changed in Horizon.) */
export function nextHabitEditable(d, next, today = new Date()) {
  return habitEditable(ensurePlanShape(d), next.quarter, next.year, today);
}

/** Set the next quarter's winning habit with Horizon's semantics (year-plan.js). */
export function setNextHabit(d, next, value, today = new Date()) {
  return setHabit(ensurePlanShape(d), next.quarter, oneLine(value).slice(0, 180), next.year, today);
}

/** `key` moved by whole months, its day kept where the month allows ("31 Jan" + 1 → "28 Feb"). */
export function shiftKeyByMonths(key, months) {
  const [year, month, day] = String(key).split('-').map(Number);
  const target = new Date(year, month - 1 + months, 1);
  return ymdKey(new Date(target.getFullYear(), target.getMonth(), Math.min(day, daysIn(target.getFullYear(), target.getMonth()))));
}

const wholeMonth = (start, end) => !!start && start.endsWith('-01') && !!end && start.slice(0, 7) === end.slice(0, 7) && Number(end.slice(8)) === daysIn(Number(start.slice(0, 4)), Number(start.slice(5, 7)) - 1);

/**
 * Milestones and mini-adventures of the quarter that are not done (an
 * adventure still under way after the quarter is not left over). A snapshot:
 * the session keeps it while the items are moved.
 */
export function leftovers(d, year, quarter) {
  const { start, end } = quarterBounds(year, quarter);
  const { milestones, adventures } = horizonItemsInRange(d, start, end);
  return [...milestones, ...adventures.filter(item => (item.endDate || item.startDate) <= end)]
    .filter(item => !item.done)
    .map(item => ({ kind: item.kind, id: item.id, text: item.text, startDate: item.startDate, endDate: item.endDate, when: item.when }));
}

/**
 * Quick dates for a left-over item: the same day in each month of the next
 * quarter (a whole-month adventure takes the whole month; a period keeps its
 * length), never before `today`: a date already past moves to today, a month
 * already over is left out. Once the next quarter is over (a late check-in),
 * the months ahead in the same year are offered instead, three at most. Q4's
 * items stay with their year, so they get none.
 */
export function moveOptions(item, { year, quarter }, today = new Date()) {
  if (quarter >= 3 || !item?.startDate) return [];
  const now = atNoon(today);
  const todayKey = ymdKey(now);
  const next = quarterBounds(year, quarter + 1);
  const months = next.end >= todayKey ? next.months
    : now.getFullYear() === year ? [0, 1, 2].map(step => now.getMonth() + step).filter(month => month <= 11) : [];
  const length = item.endDate && item.endDate > item.startDate ? daysBetweenKeys(item.startDate, item.endDate) : 0;
  const after = (key, days) => (days ? ymdKey(new Date(dateFromKey(key).getTime() + days * 86400000)) : '');
  const options = [];
  months.forEach(month => {
    const monthEnd = `${year}-${pad(month + 1)}-${pad(daysIn(year, month))}`;
    if (monthEnd < todayKey) return;
    let option;
    if (item.kind === 'adventure' && wholeMonth(item.startDate, item.endDate)) {
      const startDate = `${year}-${pad(month + 1)}-01`;
      // The rest of the month when it has begun.
      option = startDate < todayKey ? { startDate: todayKey, endDate: todayKey < monthEnd ? monthEnd : '' } : { startDate, endDate: monthEnd, label: monthName(year, month, 'short') };
    } else {
      const offset = month - (Number(item.startDate.slice(5, 7)) - 1) + (year - Number(item.startDate.slice(0, 4))) * 12;
      const shifted = shiftKeyByMonths(item.startDate, offset);
      const startDate = shifted < todayKey ? todayKey : shifted;
      option = { startDate, endDate: after(startDate, length) };
    }
    option.label = option.label || rangeLabel(option.startDate, option.endDate);
    if (!options.some(known => known.startDate === option.startDate && known.endDate === option.endDate)) options.push(option);
  });
  return options;
}

/** Give a milestone or a mini-adventure new dates (a move, or back to where it was). */
export function applyDates(d, kind, id, { startDate = '', endDate = '' } = {}) {
  if (!ISO_DAY.test(startDate)) return false;
  if (kind === 'milestone') {
    const item = (d.misogiMilestones || []).find(entry => entry.id === id);
    if (!item) return false;
    item.date = startDate;
    return true;
  }
  const item = (d.miniAdventures || []).find(entry => entry.id === id);
  if (!item) return false;
  item.startDate = startDate;
  item.endDate = ISO_DAY.test(endDate) && endDate > startDate ? endDate : '';
  item.month = Number(startDate.slice(5, 7)) - 1;
  item.status = item.done ? 'done' : 'planned';
  return true;
}

/** Tick (or untick) a milestone or a mini-adventure as done from the check-in. */
export function setItemDone(d, kind, id, done) {
  const list = kind === 'milestone' ? d.misogiMilestones : d.miniAdventures;
  const item = (Array.isArray(list) ? list : []).find(entry => entry.id === id);
  if (!item) return false;
  item.done = !!done;
  if (kind === 'adventure') item.status = item.done ? 'done' : item.startDate ? 'planned' : 'idea';
  return true;
}

/** Q4: a mini-adventure not lived goes on next year's list as an idea (once; six at most). Returns its id, or ''. */
export function carryAdventure(nextData, title, makeId) {
  if (!Array.isArray(nextData.miniAdventures)) nextData.miniAdventures = [];
  const wanted = text(title).trim();
  if (!wanted) return '';
  const existing = nextData.miniAdventures.find(entry => text(entry.text).trim().toLocaleLowerCase() === wanted.toLocaleLowerCase());
  if (existing) return existing.id;
  if (nextData.miniAdventures.length >= MAX_ADVENTURES) return '';
  const id = makeId();
  nextData.miniAdventures.push({ id, text: wanted, startDate: '', endDate: '', month: 0, status: 'idea', done: false, nextStep: '' });
  return id;
}

/** Whether `title` is already on next year's list. */
export function carriedId(nextData, title) {
  const wanted = text(title).trim().toLocaleLowerCase();
  return (Array.isArray(nextData?.miniAdventures) ? nextData.miniAdventures : []).find(entry => wanted && text(entry.text).trim().toLocaleLowerCase() === wanted)?.id || '';
}

const untouchedIdea = entry => !entry.startDate && !entry.done && entry.status !== 'done' && !filled(entry.nextStep);

/** Take a carried adventure back off next year's list (only while it is still an untouched idea: no dates, not lived, no next step). */
export function uncarryAdventure(nextData, id) {
  const before = (nextData.miniAdventures || []).length;
  nextData.miniAdventures = (nextData.miniAdventures || []).filter(entry => !(entry.id === id && untouchedIdea(entry)));
  return nextData.miniAdventures.length !== before;
}

/**
 * Q4: where a mini-adventure not lived stands with next year's list.
 * 'carried': this check-in put it there and it is still an untouched idea (pressing again takes it back);
 * 'kept': this check-in put it there and it has since been planned or given a next step (it stays);
 * 'listed': next year already had an idea of that name (never removed from here);
 * 'full': next year already has six; 'open': it can be carried.
 */
export function carryState(d, nextData, quarter, item) {
  const list = Array.isArray(nextData?.miniAdventures) ? nextData.miniAdventures : [];
  const ownId = quarterEntry(d, quarter).carried?.[item?.id] || '';
  const own = ownId ? list.find(entry => entry.id === ownId) : null;
  if (own) return untouchedIdea(own) ? 'carried' : 'kept';
  if (carriedId(nextData, item?.text)) return 'listed';
  return list.length >= MAX_ADVENTURES ? 'full' : 'open';
}

/**
 * Q4: carry a mini-adventure into next year as an idea, remembering its id in
 * the check-in, or take back one this check-in carried. An idea the person
 * already had is never touched. Returns whether anything changed.
 */
export function toggleCarry(d, nextData, quarter, item, makeId) {
  const state = carryState(d, nextData, quarter, item);
  if (state === 'carried') {
    const id = quarterEntry(d, quarter).carried[item.id];
    if (!uncarryAdventure(nextData, id)) return false;
    return updateEntry(d, quarter, entry => { delete entry.carried[item.id]; if (!Object.keys(entry.carried).length) delete entry.carried; });
  }
  if (state !== 'open') return false;
  const id = carryAdventure(nextData, item.text, makeId);
  return !!id && updateEntry(d, quarter, entry => { entry.carried = { ...entry.carried, [item.id]: id }; });
}

// ---------------------------------------------------------------------------
// The Close-day nudge
// ---------------------------------------------------------------------------

/** The last planning day of a quarter ('' when the week has none). */
export function lastPlanningDayOfQuarter(year, quarter, planningDays = [1, 2, 3, 4, 5]) {
  const days = new Set((planningDays || []).map(Number));
  if (!days.size) return '';
  const { start, end } = quarterBounds(year, quarter);
  for (let day = dateFromKey(end); ymdKey(day) >= start; day.setDate(day.getDate() - 1)) if (days.has(day.getDay())) return ymdKey(day);
  return '';
}

/** Closing the last planning day of a quarter offers its check-in once (unless it is already done). */
export function quarterNudgeFor({ dayKey, planningDays, yearData }) {
  if (!ISO_DAY.test(dayKey || '')) return null;
  const date = dateFromKey(dayKey);
  const at = { year: date.getFullYear(), quarter: quarterOf(date) };
  if (lastPlanningDayOfQuarter(at.year, at.quarter, planningDays) !== dayKey) return null;
  const entry = quarterEntry(yearData, at.quarter);
  return entry.done || entry.nudged ? null : at;
}

export function renderQuarterNudge(at) {
  return `<p class="qr-nudge"><span>${esc(`That was the last planning day of ${quarterId(at.quarter)}. Your check-in takes about ${QUARTER_MINUTES} minutes.`)}</span><button type="button" class="text-button" data-quarter-nudge="${escAttr(quarterKey(at))}">Check in<span class="sr-only"> on ${esc(quarterLabel(at))}</span></button></p>`;
}

// ---------------------------------------------------------------------------
// Entry points in Horizon
// ---------------------------------------------------------------------------

export const QUARTER_ICONS = {
  quarter: '<circle cx="12" cy="12" r="8.5"/><path d="M12 3.5V12h8.5"/><path class="qr-icon-fill" d="M12 3.5A8.5 8.5 0 0 1 20.5 12H12Z"/>',
  pen: '<path d="M4.5 19.5h4l10-10a2.1 2.1 0 0 0-4-4l-10 10v4Z"/><path d="m13.5 6.5 4 4"/>',
  next: '<path d="M4 12h11"/><path d="m11 7 5 5-5 5"/><path d="M20 5v14"/>',
  move: '<path d="M4 12h14"/><path d="m14 8 4 4-4 4"/>'
};

/**
 * The Overview card during the check-in season: what the quarter holds (a
 * preview) and the way in. Once done it turns quiet: the day it was checked
 * in, and the page to print again.
 */
export function renderQuarterCard({ window, preview = null, entry = null, icon }) {
  if (!window) return '';
  const at = { year: window.year, quarter: window.quarter };
  const id = quarterId(at.quarter);
  const nextId = quarterId(nextQuarter(at).quarter);
  const glyph = `<svg viewBox="0 0 24 24" aria-hidden="true">${QUARTER_ICONS.quarter}</svg>`;
  if (entry?.done) {
    const when = entry.completedAt ? rangeLabel(entry.completedAt) : '';
    return `<button type="button" class="hz-card hz-season-card hz-season-card--quarter is-done" data-horizon-quarter="${escAttr(quarterKey(at))}">
        <span class="hz-season-card__icon">${glyph}</span>
        <span class="hz-season-card__copy"><span class="hz-eyebrow">Quarter check-in</span><strong>${esc(`${id} checked in${when ? ` on ${when}` : ''}`)}</strong><small>Read your answers again, or print the quarter on one page.</small></span>
        ${icon('arrowRight', 'hz-tile__arrow')}
      </button>`;
  }
  const lead = window.phase === 'closing'
    ? `${id} ends ${window.daysLeft === 0 ? 'today' : window.daysLeft === 1 ? 'tomorrow' : `in ${window.daysLeft} days`}. Look back, choose the habit for ${nextId} and print the quarter on one page.`
    : `Look back on ${quarterMonths(at, 'long', ' to ')}, choose the habit for ${nextId} and print the quarter on one page.`;
  const pills = [];
  if (preview?.closed) pills.push(`<li><b>${preview.closed}</b> day${preview.closed === 1 ? '' : 's'} closed</li>`);
  if (preview?.habit != null) pills.push(`<li>Habit kept <b>${preview.habit}%</b></li>`);
  if (preview?.adventures) pills.push(`<li><b>${preview.lived}</b> of ${preview.adventures} adventure${preview.adventures === 1 ? '' : 's'} lived</li>`);
  return `<button type="button" class="hz-card hz-season-card hz-season-card--quarter" data-horizon-quarter="${escAttr(quarterKey(at))}" aria-label="${escAttr(`Your ${id} check-in, about ${QUARTER_MINUTES} minutes`)}">
      <span class="hz-season-card__icon">${glyph}</span>
      <span class="hz-season-card__copy"><span class="hz-eyebrow">Quarter check-in</span><strong>Your ${esc(id)} check-in<span class="hz-season-card__minutes"> · ${QUARTER_MINUTES} minutes</span></strong><small>${esc(lead)}</small></span>
      ${pills.length ? `<ul class="hz-quarter-pills" aria-hidden="true">${pills.join('')}</ul>` : ''}
      ${icon('arrowRight', 'hz-tile__arrow')}
    </button>`;
}

/**
 * The Overview card for Horizon: shown in the check-in season, on the year of
 * the quarter it looks back on and on the current year (Q4's check-in in
 * January shows on the new year too).
 */
export function quarterSeasonCard({ today = new Date(), shownYear, yearData, progress, icon }) {
  const window = checkInWindow(today);
  if (!window || (shownYear !== window.year && shownYear !== today.getFullYear())) return '';
  const d = yearData(window.year);
  const entry = quarterEntry(d, window.quarter);
  const preview = entry.done ? null : quarterPreview({ year: window.year, quarter: window.quarter, progress: progress(window.year), yearData: d, today });
  return renderQuarterCard({ window, preview, entry, icon });
}

/** The check-in in Horizon's Add menu, under its own heading. */
export function renderQuarterMenuItem({ at }) {
  return `<div class="hz-add-menu__head hz-add-menu__head--quarter">Check in</div>
    <button type="button" role="menuitem" class="hz-add-option hz-kind--quarter" data-horizon-quarter="${escAttr(quarterKey(at))}">
      <span class="hz-add-option__icon"><svg viewBox="0 0 24 24" aria-hidden="true">${QUARTER_ICONS.quarter}</svg></span>
      <span class="hz-add-option__copy"><strong>Quarter check-in</strong><small>${esc(`Look back on ${quarterId(at.quarter)}, set up ${quarterId(nextQuarter(at).quarter)}`)}</small></span>
      <em>${QUARTER_MINUTES} min</em>
    </button>`;
}
