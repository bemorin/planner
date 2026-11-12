import { addDaysKey, dateFromKey } from '../../src/lib/dates.js';
import { defaultCategories } from '../../src/config.js';

/**
 * Years of history, for tests and scripts/perf-history.mjs (1.39.4): synthetic saved days in three sizes, as the 1.40
 * design measured them, and a localStorage with Safari's quota.
 *
 * - light: about 1.4 KB, one outcome, a few tasks and a block, five days a week;
 * - typical: about 2.5 KB, five days a week;
 * - rich: about 6.5 KB, every day, many blocks with notes.
 *
 * Each day is deterministic (the same key always gives the same day) and has the shape normalizeDayState() gives a
 * day, so it reads back unchanged. Most days are closed, their leftovers carried to a later day (triaged with `@`,
 * the copy holding `originDay` and `carriedCount`); about one day in a hundred was left open with work unfinished,
 * which is what Unresolved lists. Pure.
 */

export const HISTORY_TODAY = '2026-11-11';
export const SAFARI_BUDGET = 2621440;
const CATEGORIES = defaultCategories.map(category => category.id);
const WORDS = ['plan', 'draft', 'review', 'call', 'write', 'ship', 'read', 'fix', 'sort', 'book', 'send', 'clean', 'design', 'test', 'meet', 'walk', 'print', 'order', 'study', 'pay'];
const THINGS = ['the quarterly report', 'the garden shed', 'invoices', 'the onboarding notes', 'the release', 'a birthday gift', 'the insurer', 'chapter four', 'the roadmap', 'the kitchen tap', 'the budget', 'tickets to Lyon', 'the slide deck', 'the newsletter', 'the dentist', 'the backlog'];
const SIZES = { light: { priorities: 1, tasks: 3, blocks: 1, notes: 0, note: 40 }, typical: { priorities: 3, tasks: 4, blocks: 3, notes: 1, note: 110 }, rich: { priorities: 3, tasks: 8, blocks: 8, notes: 1, note: 260 } };

/** A small seeded generator (mulberry32) keyed by text, so each day is stable. */
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

const pick = (rand, list) => list[Math.floor(rand() * list.length)];
const sentence = (rand, length) => {
  let text = '';
  while (text.length < length) text += `${text ? ' ' : ''}${pick(rand, WORDS)} ${pick(rand, THINGS)}${rand() < 0.3 ? ',' : ''}`;
  return text.slice(0, length).trim();
};
const id = (kind, key, index) => `${kind}-${key.replaceAll('-', '')}-${index}`;
const title = (rand, key, index) => `${pick(rand, WORDS)} ${pick(rand, THINGS)} #${key.slice(2).replaceAll('-', '')}${index}`.replace(/^./, char => char.toUpperCase());

/** What a day of `kind` says on its own, before anything is carried in: its items, and whether it was closed. */
function ownDay(key, kind) {
  const size = SIZES[kind] || SIZES.typical;
  const rand = random(`history:${kind}:${key}`);
  const closed = rand() >= 0.012;
  const item = (type, index) => ({ id: id(type, key, index), text: title(rand, key, index), done: rand() < 0.72, carriedCount: 0, originDay: '' });
  const priorities = Array.from({ length: 3 }, (_, index) => (index < size.priorities ? item('priority', index) : { id: id('priority', key, index), text: '', done: false, carriedCount: 0, originDay: '' }));
  const tasks = Array.from({ length: size.tasks }, (_, index) => item('task', index + 3));
  return { rand, closed, priorities, tasks, size };
}

/** The saved day `key` of the given kind ('light', 'typical' or 'rich'), as storage holds it once parsed. */
export function historyDay(key, kind = 'typical') {
  const { rand, closed, priorities, tasks, size } = ownDay(key, kind);
  // What the day before left unfinished and carried here: its close day moved it, or (a day left open) a copy by hand.
  const before = ownDay(addDaysKey(key, -1), kind);
  if (before.closed || before.rand() < 0.5) {
    const left = [...before.priorities, ...before.tasks].filter(entry => entry.text && !entry.done).slice(0, 2);
    left.forEach((entry, index) => tasks.push({ id: id('carried', key, index), text: entry.text, done: rand() < 0.6, carriedCount: 1 + Math.floor(rand() * 2), originDay: addDaysKey(key, -1) }));
  }
  const blocks = Array.from({ length: size.blocks }, (_, index) => {
    const linked = index < priorities.length && priorities[index].text ? priorities[index] : null;
    const start = 8 * 60 + index * 75;
    return {
      id: id('block', key, index),
      title: linked ? linked.text : title(rand, key, 20 + index),
      link: rand() < 0.15 ? `https://example.com/${key}/${index}` : '',
      notes: rand() < (kind === 'rich' ? 0.8 : 0.25) ? sentence(rand, size.note) : '',
      start,
      duration: 60,
      startDate: key,
      endDate: key,
      categoryId: pick(rand, CATEGORIES),
      linkedType: linked ? 'priority' : '',
      linkedId: linked ? linked.id : '',
      done: linked ? linked.done : rand() < 0.8,
      completedAt: '',
      actualDuration: null,
      carriedCount: 0,
      originDay: ''
    };
  });
  blocks.forEach(block => { if (block.done) block.completedAt = `${key}T${String(Math.floor(block.start / 60) + 1).padStart(2, '0')}:00:00.000Z`; });
  const open = [...priorities.filter(entry => entry.text), ...tasks].filter(entry => entry.text && !entry.done);
  const next = addDaysKey(key, 1);
  return {
    focus: rand() < 0.6 ? sentence(rand, 40) : '',
    priorities,
    tasks,
    notes: size.notes ? sentence(rand, size.note) : '',
    blocks,
    endedAt: closed ? `${key}T18:30:00` : '',
    carriedForward: closed ? open.map(entry => entry.text) : [],
    memory: closed && rand() < 0.5 ? sentence(rand, { light: 40, typical: 80, rich: 160 }[kind] || 80) : '',
    lesson: closed && rand() < 0.4 ? sentence(rand, { light: 30, typical: 70, rich: 140 }[kind] || 70) : '',
    triaged: closed ? open.map(entry => `${priorities.includes(entry) ? 'priority' : 'task'}:${entry.id}@${next}`) : [],
    closeTransfers: []
  };
}

/** Whether someone of `kind` plans on `key`: typical and light five days a week, rich every day. */
const plansOn = (key, kind) => kind === 'rich' || ![0, 6].includes(dateFromKey(key).getDay());

/**
 * `count` saved days of `kind` ending the day before `today` (or `kind: 'mixed'`: light, typical and rich in turn,
 * every day), as [key, day] pairs, oldest first.
 */
export function historyDays(count, { kind = 'typical', today = HISTORY_TODAY } = {}) {
  const days = [];
  const kinds = ['light', 'typical', 'rich'];
  let key = addDaysKey(today, -1);
  while (days.length < count) {
    const dayKind = kind === 'mixed' ? kinds[days.length % 3] : kind;
    if (kind === 'mixed' || plansOn(key, dayKind)) days.push([key, historyDay(key, dayKind)]);
    key = addDaysKey(key, -1);
  }
  return days.reverse();
}

/** Writes `days` ([key, day] pairs) into `storage` as the planner keeps them. Returns the characters written. */
export function seedHistory(storage, days) {
  let chars = 0;
  for (const [key, day] of days) {
    const raw = JSON.stringify(day);
    storage.setItem(`daily-planner:${key}`, raw);
    chars += `daily-planner:${key}`.length + raw.length;
  }
  return chars;
}

/** A backup file of `days` (version 13, as Export backup writes it). */
export function historyBackup(days, { settings = { startHour: 7, endHour: 20 }, exportedAt = `${HISTORY_TODAY}T09:00:00.000Z` } = {}) {
  return { app: 'Daily Planner', version: 13, exportedAt, settings, days: Object.fromEntries(days) };
}

/**
 * localStorage with a quota in characters, keys and values, as browsers count them (Safari's 5 MiB is
 * SAFARI_BUDGET): a write above it throws QuotaExceededError and stores nothing. `reads` counts getItem per key.
 */
export class QuotaStorage {
  constructor(quota = Infinity) { this.quota = quota; this.data = new Map(); this.reads = new Map(); this.chars = 0; this.names = null; }
  get length() { return this.data.size; }
  // As fast as a browser's: the list of keys is kept until a key comes or goes.
  key(index) { this.names ||= [...this.data.keys()]; return this.names[index] ?? null; }
  getItem(key) {
    const name = String(key);
    this.reads.set(name, (this.reads.get(name) || 0) + 1);
    return this.data.has(name) ? this.data.get(name) : null;
  }
  used() { return this.chars; }
  setItem(key, value) {
    const name = String(key);
    const text = String(value);
    const before = this.data.has(name) ? name.length + this.data.get(name).length : 0;
    if (this.chars - before + name.length + text.length > this.quota) {
      const error = new Error('The quota has been exceeded.');
      error.name = 'QuotaExceededError';
      throw error;
    }
    if (!this.data.has(name)) this.names = null;
    this.data.set(name, text);
    this.chars += name.length + text.length - before;
  }
  removeItem(key) {
    const name = String(key);
    if (!this.data.has(name)) return;
    this.chars -= name.length + this.data.get(name).length;
    this.data.delete(name);
    this.names = null;
  }
  clear() { this.data.clear(); this.chars = 0; this.names = null; }
  /** How many times `key` was read since the last call (or since the start). */
  readsOf(key) { const count = this.reads.get(String(key)) || 0; this.reads.delete(String(key)); return count; }
}
