import { addDaysKey } from '../lib/dates.js';

/**
 * Where saved days live (1.40): recent days in localStorage, as always; older days, once room is needed, in this
 * browser's IndexedDB (./day-archive.js), as the very same JSON string. This module is the pure part of it: which
 * days move, the manifest that says how far they have moved, and how two versions of one day relate.
 *
 * - Moves start once localStorage is at MOVE_START_SHARE of Safari's budget (the smallest a browser gives), and take
 *   the oldest days first until it is down to MOVE_GOAL_SHARE. Today, future days and the last HOT_DAYS days never
 *   move: they are what an older tab, the day arrows, Close day and reopen touch.
 * - One batch holds at most BATCH_DAYS days or BATCH_CHARS characters: one IndexedDB transaction each.
 * - The manifest (MANIFEST_KEY) says “every day before `before` that isn't in localStorage is in the archive”. It is
 *   fixed-width JSON, so it is rewritten in place and never needs more room, even when storage is full.
 */

export const DAY_KEY = /^daily-planner:(\d{4}-\d{2}-\d{2})$/;
/** The date of a day key (daily-planner:YYYY-MM-DD), or ''. */
export const dayOfKey = key => DAY_KEY.exec(String(key ?? ''))?.[1] || '';
export const keyOfDay = day => `daily-planner:${day}`;

/** Safari's localStorage quota (5 MiB, in characters): the budget moves are measured against, in every browser. */
export const ARCHIVE_BUDGET = 2621440;
export const MOVE_START_SHARE = 0.5;
export const MOVE_GOAL_SHARE = 0.4;
export const HOT_DAYS = 62;
export const BATCH_DAYS = 250;
export const BATCH_CHARS = 600000;

/** The manifest's key: outside daily-planner:, so it is never backed up, never synced, never removed by a 1.39 Reset. */
export const MANIFEST_KEY = 'daily-planner-store:archive';
const DAYS_WIDTH = 7;
const CHARS_WIDTH = 10;
const GEN_WIDTH = 10;

/** The first day that stays in localStorage whatever happens: days before it may move. */
export const hotFloor = (today, hotDays = HOT_DAYS) => addDaysKey(today, -hotDays);

/** Whether localStorage, at `used` characters, is full enough for days to move. */
export const needsRoom = (used, { budget = ARCHIVE_BUDGET, share = MOVE_START_SHARE } = {}) => Number(used) >= budget * share;

/**
 * Which days move, oldest first, so that localStorage at `used` characters comes down to `goal` of `budget`.
 *
 * `days`: the days in localStorage, [{ day, chars }] (chars: key and value, as quotas count them); `today`: YYYY-MM-DD;
 * `exclude`: days that stay this time (the ones on screen). Returns { batches: [[day…]…], days, chars (moved),
 * after (what localStorage would hold), reaches (whether that is at or below the goal) }. Pure.
 */
export function planMoves({ days = [], used = 0, today, budget = ARCHIVE_BUDGET, goal = MOVE_GOAL_SHARE, hotDays = HOT_DAYS, exclude = [], maxDays = BATCH_DAYS, maxChars = BATCH_CHARS } = {}) {
  const target = Math.floor(budget * goal);
  const floor = hotFloor(today, hotDays);
  const skip = new Set(exclude);
  const movable = days.filter(entry => entry && entry.day < floor && !skip.has(entry.day)).sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));
  let left = Number(used) || 0;
  let count = 0;
  const batches = [];
  let batch = [];
  let batchChars = 0;
  for (const { day, chars } of movable) {
    if (left <= target) break;
    const size = Math.max(0, Number(chars) || 0);
    if (batch.length && (batch.length >= maxDays || batchChars + size > maxChars)) {
      batches.push(batch);
      batch = [];
      batchChars = 0;
    }
    batch.push(day);
    batchChars += size;
    left -= size;
    count += 1;
  }
  if (batch.length) batches.push(batch);
  return { batches, days: count, chars: (Number(used) || 0) - left, after: left, reaches: left <= target };
}

/** Splits `days` ([{ day, chars }], in the order given) into batches of at most `maxDays` days or `maxChars` characters. */
export function batchesOf(days, { maxDays = BATCH_DAYS, maxChars = BATCH_CHARS } = {}) {
  const batches = [];
  let batch = [];
  let chars = 0;
  for (const entry of days) {
    const size = Math.max(0, Number(entry.chars) || 0);
    if (batch.length && (batch.length >= maxDays || chars + size > maxChars)) {
      batches.push(batch);
      batch = [];
      chars = 0;
    }
    batch.push(entry);
    chars += size;
  }
  if (batch.length) batches.push(batch);
  return batches;
}

const pad = (value, width) => String(Math.min(Math.max(0, Math.round(Number(value) || 0)), 10 ** width - 1)).padStart(width, ' ');

/**
 * The manifest as stored: always the same length, e.g.
 * {"v":1,"before":"2025-03-01","days":   1234,"chars":   2950000,"gen":         7} (the spaces are JSON whitespace).
 * `before`: the day after the last day moved; `days`: how many days the archive holds (counted in it after each
 * change, never added up, so two passes at once count each day once; never more than it holds); `chars`, about
 * how much; `gen`: one more each time days are added to the archive, so a tab knows another tab moved days.
 */
export function encodeManifest({ before, days = 0, chars = 0, gen = 0 } = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(before || ''))) throw new Error('A manifest needs a day.');
  return `{"v":1,"before":"${before}","days":${pad(days, DAYS_WIDTH)},"chars":${pad(chars, CHARS_WIDTH)},"gen":${pad(gen % 10 ** GEN_WIDTH, GEN_WIDTH)}}`;
}

/** The manifest read back, { before, days, chars, gen }, or null (absent, or not one this release wrote). */
export function decodeManifest(raw) {
  if (typeof raw !== 'string' || !raw) return null;
  try {
    const value = JSON.parse(raw);
    if (!value || value.v !== 1 || !/^\d{4}-\d{2}-\d{2}$/.test(String(value.before || ''))) return null;
    return { before: value.before, days: Math.max(0, Number(value.days) || 0), chars: Math.max(0, Number(value.chars) || 0), gen: Math.max(0, Number(value.gen) || 0) };
  } catch (_) {
    return null;
  }
}

/**
 * The lease that stands in for Web Locks (1.40): which tab runs a step on the archive, until when. Fixed width too,
 * {"o":"k3j9x0aa","u": 1731390000000}: once written, it is rewritten in place (released with `u` 0, never removed),
 * so it never needs room again, even when storage is full.
 */
export function encodeLease({ owner = '', until = 0 } = {}) {
  return `{"o":"${String(owner).replace(/[^a-z0-9]/g, '').padEnd(8, '0').slice(0, 8)}","u":${pad(until, 14)}}`;
}

export function decodeLease(raw) {
  if (typeof raw !== 'string' || !raw) return null;
  try {
    const value = JSON.parse(raw);
    return value && typeof value.o === 'string' ? { owner: value.o, until: Math.max(0, Number(value.u) || 0) } : null;
  } catch (_) {
    return null;
  }
}

const parsed = day => {
  if (typeof day !== 'string') return day && typeof day === 'object' ? day : null;
  try { return JSON.parse(day); } catch (_) { return null; }
};
const itemIds = day => {
  const ids = new Set();
  for (const list of [day?.priorities, day?.tasks, day?.blocks]) {
    if (!Array.isArray(list)) continue;
    for (const item of list) if (item && typeof item.id === 'string' && item.id) ids.add(item.id);
  }
  return ids;
};

/**
 * Whether two versions of a day (strings as stored, or parsed) share a priority, task or block id: one was made from
 * the other, as an edit is. Two versions that share none were written apart: one blind, by a tab that saw the day as
 * empty (a release before 1.40 after the day moved).
 */
export function sharesItems(a, b) {
  const left = itemIds(parsed(a));
  if (!left.size) return false;
  for (const id of itemIds(parsed(b))) if (left.has(id)) return true;
  return false;
}

const blankText = value => !String(value || '').trim();
const noItems = list => !Array.isArray(list) || list.every(item => !item || blankText(item.text ?? item.title));

/**
 * Whether a day (a string as stored, or parsed) holds nothing anyone wrote: what a tab saves when it opens a day it
 * can't see. A string that isn't a day counts as not blank: it is kept, never thrown away.
 */
export function isBlankDay(day) {
  const value = parsed(day);
  if (!value || typeof value !== 'object') return day == null;
  return ['focus', 'notes', 'memory', 'lesson', 'endedAt'].every(field => blankText(value[field]))
    && noItems(value.priorities) && noItems(value.tasks)
    && (!Array.isArray(value.blocks) || !value.blocks.length)
    && ['carriedForward', 'triaged', 'closeTransfers'].every(field => !Array.isArray(value[field]) || !value[field].length);
}
