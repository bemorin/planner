import { addDaysKey, dateFromKey, weekdayNames } from '../lib/dates.js';
import { JOKERS_PER_MONTH } from './progress-model.js';

/**
 * Insights: what the days you plan and close add up to.
 *
 * Pure derivations over stored day records, worked out on this device and
 * never persisted or sent anywhere: the rhythm of the week (close rate and
 * main-outcome rate by weekday, scheduled hours by weekday and hour), where the
 * time goes (hours by category per week or month, with a trend), outcomes per
 * week with a four-week average, what happens to unfinished work at close,
 * streak history, and this period against the same dates a year earlier. A
 * few plain-language findings sit on top; each one needs enough data first.
 */

export const RANGE_KINDS = Object.freeze(['weeks', 'quarter', 'year']);

/** Below these, a section says what it needs instead of drawing a thin chart. */
export const ENOUGH = Object.freeze({
  rhythmClosed: 5, // closed days in the range before weekday rates mean anything
  weekdayDays: 4, // days of a weekday before it can be "your strongest day"
  heatMinutes: 120,
  timeMinutes: 60,
  outcomeDays: 3, // days with a main outcome set
  focusMinutes: 300, // hours of one category before naming when it happens
  trendMinutes: 300,
  yoyClosed: 3,
  yoyMinutes: 180
});

const DAY = 24 * 60;
const MAX_PANELS = 6;
export const UNCATEGORIZED = Object.freeze({ id: '__none', name: 'No category', color: '#8c867f' });
export const OTHER = Object.freeze({ id: '__other', name: 'Other', color: '#8c867f' });

const pad = value => String(value).padStart(2, '0');
const keyOf = (year, month, day) => `${year}-${pad(month + 1)}-${pad(day)}`;
const isKey = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
const minKey = (a, b) => (a < b ? a : b);
const maxKey = (a, b) => (a > b ? a : b);
const clampNumber = (value, min, max) => Math.min(max, Math.max(min, value));
const text = item => String(item?.text || '').trim();

/** The same calendar date `delta` years away (29 February becomes the 28th). */
export function shiftYearKey(key, delta) {
  const [year, month, day] = String(key).split('-').map(Number);
  const last = new Date(year + delta, month, 0).getDate();
  return keyOf(year + delta, month - 1, Math.min(day, last));
}

export function weekStartKey(key, weekStartsOn = 1) {
  const day = dateFromKey(key).getDay();
  return addDaysKey(key, -((day - Number(weekStartsOn || 0) + 7) % 7));
}

const monthEndKey = (year, month) => keyOf(year, month, new Date(year, month + 1, 0).getDate());

/** Calendar weeks touching [startKey, endKey], each clipped to it. */
function calendarWeeks(startKey, endKey, weekStartsOn) {
  const weeks = [];
  for (let week = weekStartKey(startKey, weekStartsOn); week <= endKey; week = addDaysKey(week, 7)) {
    weeks.push({ startKey: maxKey(week, startKey), endKey: minKey(addDaysKey(week, 6), endKey), weekKey: week });
  }
  return weeks;
}

function markBins(bins, todayKey) {
  return bins.map(bin => ({ ...bin, future: bin.startKey > todayKey, current: bin.startKey <= todayKey && todayKey < bin.endKey }));
}

/**
 * The period Insights describes.
 * - weeks: the 28 days ending on the anchor (four rolling weeks);
 * - quarter: the calendar quarter holding the anchor;
 * - year: the calendar year holding the anchor.
 * Days after today never count (`endKey` stops at today); `bins` are the
 * columns of "where your time goes" (weeks, or months for a year) and `weeks`
 * the columns of the outcomes chart.
 */
export function insightsRange(kind, anchorKey, todayKey, { weekStartsOn = 1, minYear = null } = {}) {
  const safeKind = RANGE_KINDS.includes(kind) ? kind : 'year';
  let anchor = isKey(anchorKey) ? anchorKey : todayKey;
  if (anchor > todayKey) anchor = todayKey;
  const earliest = Number.isFinite(Number(minYear)) && minYear !== null ? `${Number(minYear)}-01-01` : '';
  if (earliest && anchor < earliest) anchor = safeKind === 'weeks' ? minKey(addDaysKey(earliest, 27), todayKey) : earliest;
  const [year, month] = anchor.split('-').map(Number);

  if (safeKind === 'weeks') {
    const endKey = anchor;
    const startKey = addDaysKey(endKey, -27);
    const bins = markBins([0, 1, 2, 3].map(index => {
      const start = addDaysKey(startKey, index * 7);
      return { startKey: start, endKey: addDaysKey(start, 6) };
    }), todayKey);
    const prev = addDaysKey(endKey, -28);
    return {
      kind: safeKind, anchorKey: endKey, startKey, endKey, fullEndKey: endKey, binKind: 'week', bins, weeks: bins,
      prevAnchor: earliest && prev < earliest ? '' : prev,
      nextAnchor: endKey < todayKey ? minKey(addDaysKey(endKey, 28), todayKey) : ''
    };
  }

  if (safeKind === 'quarter') {
    const quarter = Math.floor((month - 1) / 3);
    const startKey = keyOf(year, quarter * 3, 1);
    const fullEndKey = monthEndKey(year, quarter * 3 + 2);
    const weeks = markBins(calendarWeeks(startKey, fullEndKey, weekStartsOn), todayKey);
    const prevStart = quarter ? keyOf(year, (quarter - 1) * 3, 1) : keyOf(year - 1, 9, 1);
    const nextStart = quarter < 3 ? keyOf(year, (quarter + 1) * 3, 1) : keyOf(year + 1, 0, 1);
    return {
      kind: safeKind, anchorKey: startKey, quarter: quarter + 1, year, startKey, endKey: minKey(fullEndKey, todayKey), fullEndKey, binKind: 'week', bins: weeks, weeks,
      prevAnchor: earliest && prevStart < earliest ? '' : prevStart,
      nextAnchor: nextStart <= todayKey ? nextStart : ''
    };
  }

  const startKey = keyOf(year, 0, 1);
  const fullEndKey = keyOf(year, 11, 31);
  const months = markBins(Array.from({ length: 12 }, (_, index) => ({ startKey: keyOf(year, index, 1), endKey: monthEndKey(year, index), month: index })), todayKey);
  const prevStart = keyOf(year - 1, 0, 1);
  const nextStart = keyOf(year + 1, 0, 1);
  return {
    kind: safeKind, anchorKey: startKey, year, startKey, endKey: minKey(fullEndKey, todayKey), fullEndKey, binKind: 'month', bins: months,
    weeks: markBins(calendarWeeks(startKey, fullEndKey, weekStartsOn), todayKey),
    prevAnchor: earliest && prevStart < earliest ? '' : prevStart,
    nextAnchor: nextStart <= todayKey ? nextStart : ''
  };
}

/** Where unfinished work went when a day was closed. */
function transfersOf(record) {
  const counts = { carried: 0, saved: 0, forgotten: 0 };
  const list = Array.isArray(record.closeTransfers) ? record.closeTransfers.filter(item => item && typeof item === 'object') : [];
  if (list.length) {
    list.forEach(item => {
      if (item.mode === 'later') counts.saved += 1;
      else if (item.mode === 'drop') counts.forgotten += 1;
      else if (item.mode === 'date') counts.carried += 1;
    });
    return counts;
  }
  // Older closed days kept only the triage strings: "key:later", "key:drop", "key@2026-10-21".
  (Array.isArray(record.triaged) ? record.triaged : []).forEach(value => {
    const entry = String(value || '');
    if (entry.endsWith(':later')) counts.saved += 1;
    else if (entry.endsWith(':drop')) counts.forgotten += 1;
    else if (/@\d{4}-\d{2}-\d{2}$/.test(entry)) counts.carried += 1;
  });
  return counts;
}

/** One stored day, reduced to what Insights counts. Tolerates partial and older records. */
export function dayInsight(record) {
  if (!record || typeof record !== 'object') return null;
  const priorities = Array.isArray(record.priorities) ? record.priorities : [];
  const tasks = Array.isArray(record.tasks) ? record.tasks : [];
  const mit = priorities[0];
  const others = priorities.slice(1, 3).filter(item => text(item));
  const listed = tasks.filter(item => text(item));
  const blocks = [];
  let minutes = 0;
  (Array.isArray(record.blocks) ? record.blocks : []).forEach(block => {
    if (!block || typeof block !== 'object') return;
    const duration = clampNumber(Math.round(Number(block.duration) || 0), 0, DAY);
    if (!duration) return;
    const start = clampNumber(Math.round(Number(block.start) || 0), 0, DAY - 1);
    blocks.push({ start, duration, categoryId: String(block.categoryId || '') });
    minutes += duration;
  });
  // Items that arrived carried from an earlier day; linked blocks mirror their item.
  const moved = [];
  [...priorities, ...tasks].forEach(item => {
    const count = Math.max(0, Number(item?.carriedCount) || 0);
    if (count && text(item)) moved.push({ text: text(item), origin: isKey(item.originDay) ? item.originDay : '', count, done: !!item.done });
  });
  (Array.isArray(record.blocks) ? record.blocks : []).forEach(block => {
    const count = Math.max(0, Number(block?.carriedCount) || 0);
    if (count && !block.linkedType && String(block.title || '').trim()) moved.push({ text: String(block.title).trim(), origin: isKey(block.originDay) ? block.originDay : '', count, done: !!block.done });
  });
  const closed = !!record.endedAt;
  return {
    closed,
    mitSet: !!text(mit),
    mitDone: !!(text(mit) && mit.done),
    otherSet: others.length,
    otherDone: others.filter(item => item.done).length,
    tasksSet: listed.length,
    tasksDone: listed.filter(item => item.done).length,
    blocks,
    minutes,
    transfers: closed ? transfersOf(record) : { carried: 0, saved: 0, forgotten: 0 },
    moved
  };
}

const sum = values => values.reduce((total, value) => total + value, 0);
const mean = values => (values.length ? sum(values) / values.length : 0);

/**
 * Recent bins against the ones before: the last third (at least two bins)
 * against everything earlier, from the first bin with any time and leaving out
 * a bin still in progress. Null with fewer than six bins to compare.
 */
export function binTrend(values, bins, { minMinutes = ENOUGH.trendMinutes } = {}) {
  const usable = [];
  let started = false;
  values.forEach((value, index) => {
    const bin = bins[index];
    if (!bin || bin.future || bin.current) return;
    if (!started && !value) return;
    started = true;
    usable.push(value);
  });
  if (usable.length < 6) return null;
  const recentCount = Math.max(2, Math.round(usable.length / 3));
  const recent = usable.slice(-recentCount);
  const earlier = usable.slice(0, -recentCount);
  if (sum(recent) + sum(earlier) < minMinutes) return null;
  const before = mean(earlier);
  const after = mean(recent);
  if (!before) return after ? { direction: 'new', change: 1, recentBins: recentCount } : null;
  if (!after) return { direction: 'stopped', change: -1, recentBins: recentCount };
  const change = (after - before) / before;
  return { direction: Math.abs(change) < 0.15 ? 'steady' : change > 0 ? 'up' : 'down', change, recentBins: recentCount };
}

/** Index of the bin holding `key`, or -1 (bins are sorted and do not overlap). */
function binIndexer(bins) {
  let cursor = 0;
  return key => {
    if (!bins.length || key < bins[0].startKey || key > bins[bins.length - 1].endKey) return -1;
    if (key < bins[cursor].startKey) cursor = 0;
    while (cursor < bins.length && key > bins[cursor].endKey) cursor += 1;
    return cursor < bins.length && key >= bins[cursor].startKey ? cursor : -1;
  };
}

function resolveCategory(id, categoryFor) {
  let category = null;
  try { category = id ? categoryFor(id) : null; } catch (_) { category = null; }
  if (!category) return UNCATEGORIZED;
  return { id: String(category.id || id), name: String(category.name || UNCATEGORIZED.name), color: /^#[0-9a-f]{3,8}$/i.test(String(category.color || '')) ? category.color : UNCATEGORIZED.color };
}

/**
 * Build everything Insights shows for one range.
 * @param {object} options
 * @param {object} options.range insightsRange()
 * @param {(key: string) => object|null} options.readDay stored day record
 * @param {(id: string) => object|null} [options.categoryFor]
 * @param {number[]} [options.planningDays] weekdays (0 = Sunday)
 * @param {string} options.todayKey
 * @param {number} [options.weekStartsOn]
 * @param {number} [options.startHour] first hour of the heatmap at least
 * @param {number} [options.endHour] last hour of the heatmap at least
 * @param {Map} [options.cache] key → dayInsight, reused across ranges (today is never cached)
 */
export function buildInsights({ range, readDay, categoryFor = () => null, planningDays = [1, 2, 3, 4, 5], todayKey, weekStartsOn = 1, startHour = 7, endHour = 20, cache = null, jokersPerMonth = JOKERS_PER_MONTH }) {
  const planning = new Set((planningDays || []).map(Number));
  // Each day is read once per build; `cache` keeps past days across ranges (today can still change).
  const local = new Map();
  const facts = key => {
    if (local.has(key)) return local.get(key);
    let value;
    if (cache && key !== todayKey && cache.has(key)) value = cache.get(key);
    else {
      let record = null;
      try { record = readDay(key); } catch (_) { record = null; }
      value = dayInsight(record);
      if (cache && key !== todayKey) cache.set(key, value);
    }
    local.set(key, value);
    return value;
  };

  const { startKey, endKey } = range;
  const prevStart = shiftYearKey(startKey, -1);
  const prevEnd = shiftYearKey(endKey, -1);
  const firstWeek = (range.weeks[0] || { startKey }).startKey;
  const lookbackKey = range.kind === 'weeks' ? addDaysKey(firstWeek, -21) : addDaysKey(weekStartKey(firstWeek, weekStartsOn), -21);
  const scanStart = minKey(minKey(addDaysKey(prevStart, -7), lookbackKey), addDaysKey(startKey, -372));

  // Range accumulators.
  const totals = { closed: 0, eligible: 0, minutes: 0, scheduledDays: 0, mitSet: 0, mitDone: 0, otherSet: 0, otherDone: 0, tasksSet: 0, tasksDone: 0, days: 0 };
  const weekdays = Array.from({ length: 7 }, (_, weekday) => ({ weekday, planning: planning.has(weekday), days: 0, closed: 0, mitSet: 0, mitDone: 0 }));
  const heat = Array.from({ length: 7 }, () => new Array(24).fill(0));
  const occurrences = new Array(7).fill(0);
  const binOf = binIndexer(range.bins);
  const catMinutes = new Map();
  const hourByCategory = new Map();
  const carry = { carried: 0, saved: 0, forgotten: 0, closedDays: 0 };
  const movedItems = new Map();
  const prev = { closed: 0, minutes: 0, mitDone: 0, active: false };
  const months = new Map();

  // Streak walker (same rules as Progress: rest days never break it, jokers absorb missed planning days, today is pending).
  const runs = [];
  const jokersUsed = new Map();
  let run = null;
  let started = false;
  let firstClosedKey = '';
  let firstActiveKey = '';

  for (let key = scanStart; key <= endKey; key = addDaysKey(key, 1)) {
    const fact = facts(key);
    const weekday = dateFromKey(key).getDay();
    const closed = !!fact?.closed;
    if (fact && !firstActiveKey && (fact.closed || fact.minutes || fact.mitSet)) firstActiveKey = key;
    if (closed && !firstClosedKey) firstClosedKey = key;

    if (closed || started) {
      started = true;
      // `inside` counts the run's days within the range, as Progress counts a year's best streak.
      const inside = key >= startKey;
      if (closed) {
        if (!run) run = { startKey: key, endKey: key, length: 0, jokers: 0, inside: null };
        run.length += 1;
        run.endKey = key;
        if (inside) {
          if (!run.inside) run.inside = { startKey: key, endKey: key, length: 0, jokers: 0 };
          run.inside.length += 1;
          run.inside.endKey = key;
        }
      } else if (planning.has(weekday) && key !== todayKey) {
        const month = key.slice(0, 7);
        const used = jokersUsed.get(month) || 0;
        if (run && used < jokersPerMonth) {
          jokersUsed.set(month, used + 1);
          run.jokers += 1;
          if (run.inside) run.inside.jokers += 1;
        } else if (run) { runs.push(run); run = null; }
      }
    }

    if (key >= prevStart && key <= prevEnd && fact) {
      if (fact.closed) prev.closed += 1;
      prev.minutes += fact.minutes;
      if (fact.mitDone) prev.mitDone += 1;
    }

    if (key < startKey) continue;
    // ---- inside the range ----
    totals.days += 1;
    // The close rate follows Progress: today is never a planning day yet, closed or not (its close
    // still counts); the weekday rhythm and the outcomes take a closed today in.
    const elapsed = key < todayKey;
    const counted = elapsed || closed;
    const sinceStart = firstClosedKey && key >= firstClosedKey;
    if (counted && sinceStart) {
      const row = weekdays[weekday];
      row.days += 1;
      if (closed) row.closed += 1;
      if (row.planning && elapsed) totals.eligible += 1;
      const month = key.slice(0, 7);
      const entry = months.get(month) || { month, eligible: 0, closed: 0 };
      if (row.planning && elapsed) entry.eligible += 1;
      if (closed) entry.closed += 1;
      months.set(month, entry);
    }
    if (firstActiveKey && key >= firstActiveKey) occurrences[weekday] += 1;
    if (!fact) continue;
    if (closed) {
      totals.closed += 1;
      carry.closedDays += 1;
      carry.carried += fact.transfers.carried;
      carry.saved += fact.transfers.saved;
      carry.forgotten += fact.transfers.forgotten;
    }
    if (counted) {
      if (fact.mitSet) { totals.mitSet += 1; weekdays[weekday].mitSet += 1; }
      if (fact.mitDone) { totals.mitDone += 1; weekdays[weekday].mitDone += 1; }
      totals.otherSet += fact.otherSet;
      totals.otherDone += fact.otherDone;
      totals.tasksSet += fact.tasksSet;
      totals.tasksDone += fact.tasksDone;
    }
    fact.moved.forEach(item => {
      const id = `${item.origin}|${item.text.toLocaleLowerCase()}`;
      const known = movedItems.get(id);
      if (!known) movedItems.set(id, { text: item.text, count: item.count, done: item.done, lastKey: key });
      else { known.count = Math.max(known.count, item.count); known.done = known.done || item.done; known.lastKey = key; }
    });
    if (!fact.blocks.length) continue;
    totals.minutes += fact.minutes;
    totals.scheduledDays += 1;
    const bin = binOf(key);
    fact.blocks.forEach(block => {
      const id = block.categoryId;
      if (!catMinutes.has(id)) catMinutes.set(id, new Array(range.bins.length).fill(0));
      if (bin >= 0) catMinutes.get(id)[bin] += block.duration;
      if (!hourByCategory.has(id)) hourByCategory.set(id, new Array(24).fill(0));
      const hours = hourByCategory.get(id);
      // Spread the block over the hours it covers; past midnight it belongs to the next weekday.
      let at = block.start;
      const end = block.start + block.duration;
      while (at < end) {
        const next = Math.min(end, (Math.floor(at / 60) + 1) * 60);
        const hour = Math.floor(at / 60) % 24;
        const day = (weekday + Math.floor(at / DAY)) % 7;
        heat[day][hour] += next - at;
        hours[hour] += next - at;
        at = next;
      }
    });
  }
  if (run) runs.push({ ...run, ongoing: true });

  // ---- rhythm ----
  const order = Array.from({ length: 7 }, (_, index) => (Number(weekStartsOn || 0) + index) % 7);
  weekdays.forEach(row => {
    row.closeRate = row.days ? row.closed / row.days : 0;
    row.mitRate = row.mitSet ? row.mitDone / row.mitSet : 0;
    row.name = weekdayNames[row.weekday];
  });
  const rhythmEnough = totals.closed >= ENOUGH.rhythmClosed && weekdays.filter(row => row.days >= 2).length >= 2;

  let firstHour = clampNumber(Math.floor(Number(startHour) || 0), 0, 23);
  let lastHour = clampNumber(Math.ceil(Number(endHour) || 24), firstHour + 1, 24);
  heat.forEach(row => row.forEach((value, hour) => {
    if (!value) return;
    firstHour = Math.min(firstHour, hour);
    lastHour = Math.max(lastHour, hour + 1);
  }));
  let heatMax = 0;
  const cells = heat.map((row, weekday) => row.map((minutes, hour) => {
    const avg = occurrences[weekday] ? minutes / occurrences[weekday] : 0;
    if (hour >= firstHour && hour < lastHour) heatMax = Math.max(heatMax, avg);
    return { minutes, avg };
  }));
  const heatTotal = sum(heat.map(row => sum(row)));
  const levelOf = avg => (!avg || !heatMax ? 0 : clampNumber(Math.ceil((avg / heatMax) * 5), 1, 5));
  cells.forEach(row => row.forEach(cell => { cell.level = levelOf(cell.avg); }));

  // ---- where the time goes ----
  const merged = new Map();
  const hourProfiles = new Map();
  catMinutes.forEach((values, id) => {
    const category = resolveCategory(id, categoryFor);
    const entry = merged.get(category.id) || { ...category, values: new Array(range.bins.length).fill(0) };
    values.forEach((value, index) => { entry.values[index] += value; });
    merged.set(category.id, entry);
    const profile = hourProfiles.get(category.id) || new Array(24).fill(0);
    (hourByCategory.get(id) || []).forEach((value, hour) => { profile[hour] += value; });
    hourProfiles.set(category.id, profile);
  });
  let categories = [...merged.values()].map(entry => ({ ...entry, minutes: sum(entry.values) })).filter(entry => entry.minutes > 0)
    .sort((a, b) => b.minutes - a.minutes || a.name.localeCompare(b.name));
  if (categories.length > MAX_PANELS) {
    const rest = categories.slice(MAX_PANELS - 1);
    const values = new Array(range.bins.length).fill(0);
    rest.forEach(entry => entry.values.forEach((value, index) => { values[index] += value; }));
    categories = [...categories.slice(0, MAX_PANELS - 1), { ...OTHER, name: `${rest.length} other categories`, values, minutes: sum(values), folded: rest.length }];
  }
  const binTotal = sum(categories.map(entry => entry.minutes));
  categories = categories.map(entry => ({ ...entry, share: binTotal ? entry.minutes / binTotal : 0, trend: binTrend(entry.values, range.bins), peak: Math.max(0, ...entry.values) }));
  const totalValues = range.bins.map((_, index) => sum(categories.map(entry => entry.values[index])));
  const elapsedBins = range.bins.filter(bin => !bin.future).length;

  // ---- outcomes per week (four-week trailing average, reaching before the range when needed) ----
  const doneBetween = (from, to) => {
    let done = 0;
    let set = 0;
    for (let key = from; key <= to; key = addDaysKey(key, 1)) {
      const fact = facts(key);
      if (!fact || (key === todayKey && !fact.closed && !fact.mitDone)) continue;
      if (fact.mitSet) set += 1;
      if (fact.mitDone) done += 1;
    }
    return { done, set };
  };
  const lookback = [3, 2, 1].map(back => {
    const from = range.kind === 'weeks' ? addDaysKey(range.weeks[0].startKey, -7 * back) : addDaysKey(weekStartKey(range.weeks[0].startKey, weekStartsOn), -7 * back);
    return doneBetween(from, addDaysKey(from, 6)).done;
  });
  const weekRows = range.weeks.map(week => ({ ...week, ...(week.future ? { done: 0, set: 0 } : doneBetween(week.startKey, minKey(week.endKey, todayKey))) }));
  const series = [...lookback, ...weekRows.map(week => week.done)];
  weekRows.forEach((week, index) => {
    // Weeks that ended before the first day with anything stored are "before you started", not zeros.
    week.before = !week.future && (!firstActiveKey || week.endKey < firstActiveKey);
    week.avg = week.future || week.before ? null : mean(series.slice(index, index + 4));
  });
  const elapsedWeeks = weekRows.filter(week => !week.future && !week.before);
  const bestWeek = elapsedWeeks.reduce((best, week) => (!best || week.done > best.done ? week : best), null);

  // ---- unfinished work ----
  const decided = carry.carried + carry.saved + carry.forgotten;
  const moved = [...movedItems.values()];
  const movedAgain = moved.filter(item => item.count >= 3).sort((a, b) => b.count - a.count || a.text.localeCompare(b.text)).slice(0, 3);
  const finishedAfterMove = moved.filter(item => item.done).length;

  // ---- streaks ----
  // Each run as the period holds it: only its days inside the period count, as in Progress, where a
  // run from November into January gives January's year only its January days. The current streak
  // stays whole, like Progress's.
  const inRange = runs.filter(item => item.inside).map(item => ({ ...item.inside, ongoing: !!item.ongoing }));
  const longest = inRange.reduce((best, item) => (!best || item.length > best.length ? item : best), null);
  const last = runs[runs.length - 1];
  const current = endKey === todayKey && last?.ongoing ? last.length : 0;
  const monthRows = [...months.values()].map(entry => ({ ...entry, rate: entry.eligible ? Math.min(entry.closed, entry.eligible) / entry.eligible : 0 }));
  const bestMonth = range.kind === 'weeks' ? null : monthRows.filter(entry => entry.eligible >= 8 && entry.closed > 0)
    .reduce((best, entry) => (!best || entry.rate > best.rate || (entry.rate === best.rate && entry.closed > best.closed) ? entry : best), null);

  // ---- year over year ----
  prev.active = prev.closed >= ENOUGH.yoyClosed || prev.minutes >= ENOUGH.yoyMinutes;

  const model = {
    range,
    todayKey,
    totals: { ...totals, closeRate: totals.eligible ? Math.min(totals.closed, totals.eligible) / totals.eligible : 0 },
    thin: totals.closed < 3 && totals.minutes < ENOUGH.heatMinutes,
    rhythm: {
      order,
      weekdays,
      enough: rhythmEnough,
      heat: { firstHour, lastHour, cells, max: heatMax, total: heatTotal, occurrences, enough: heatTotal >= ENOUGH.heatMinutes }
    },
    time: { binKind: range.binKind, bins: range.bins, categories, totalValues, total: binTotal, elapsedBins, trend: binTrend(totalValues, range.bins), hourProfiles, enough: binTotal >= ENOUGH.timeMinutes },
    outcomes: { weeks: weekRows, bestWeek, enough: totals.mitSet >= ENOUGH.outcomeDays },
    carry: { ...carry, decided, movedAgain, finishedAfterMove, movedCount: moved.length, perDay: carry.closedDays ? decided / carry.closedDays : 0, enough: carry.closedDays >= 1 },
    streaks: { runs: inRange, longest, current, bestMonth, months: monthRows, enough: totals.closed >= 2 },
    yoy: {
      available: prev.active,
      current: { closed: totals.closed, minutes: totals.minutes, mitDone: totals.mitDone },
      previous: { closed: prev.closed, minutes: prev.minutes, mitDone: prev.mitDone },
      prevStart,
      prevEnd
    }
  };
  model.findings = buildFindings(model);
  return model;
}

// ---------------------------------------------------------------------------
// Findings: a few plain sentences, each behind its own threshold.
// ---------------------------------------------------------------------------

export const percent = value => Math.round((Number(value) || 0) * 100);
const plural = (count, one, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
const hourSpan = (from, to) => `${from}–${to}`;
const monthName = (key, locale) => dateFromKey(`${key.slice(0, 7)}-01`).toLocaleDateString(locale, { month: 'long' });

// The planner's own category names are common nouns and read lower case mid-sentence;
// names people type keep their spelling ("Spanish", "MBA prep").
const COMMON_NAMES = new Set(['deep work', 'admin', 'health', 'learning', 'personal', 'no category']);

/** A category name as it reads inside a sentence: "Most of your deep work happens 9–11." */
export function inSentence(name) {
  const value = String(name || '').trim();
  const lower = value.toLocaleLowerCase();
  return COMMON_NAMES.has(lower) && value.slice(1) === lower.slice(1) ? lower : value;
}

/** Strongest (and weakest) planning weekday by close rate; null when the days are too few. */
export function weekdayFinding(weekdays, { closed = 0 } = {}) {
  const candidates = weekdays.filter(row => row.planning && row.days >= ENOUGH.weekdayDays);
  if (candidates.length < 2 || closed < ENOUGH.rhythmClosed + 3) return null;
  const ranked = [...candidates].sort((a, b) => b.closeRate - a.closeRate || b.closed - a.closed || ((a.weekday + 6) % 7) - ((b.weekday + 6) % 7));
  const [best, second] = ranked;
  const worst = ranked[ranked.length - 1];
  const spread = best.closeRate - worst.closeRate;
  if (spread < 0.06) return { id: 'weekday-even', text: `You close your days evenly across the week: about ${percent(mean(candidates.map(row => row.closeRate)))}%.` };
  // Every weekday sharing the top rate is named, in week order.
  const top = ranked.filter(row => percent(row.closeRate) === percent(best.closeRate)).sort((a, b) => ((a.weekday + 6) % 7) - ((b.weekday + 6) % 7));
  const names = top.map(row => `${row.name}s`);
  const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0];
  const strong = { id: 'weekday-best', text: `${list} ${top.length > 1 ? 'are your strongest days' : 'are your strongest day'}: ${percent(best.closeRate)}% closed.` };
  const weak = spread >= 0.2 && !top.includes(worst) && worst !== second ? { id: 'weekday-worst', text: `${worst.name}s slip most often: ${percent(worst.closeRate)}% closed.` } : null;
  return { ...strong, weak };
}

/** When one category's hours cluster: "Most of your deep work happens 9–11." */
export function focusFinding(categories, profiles) {
  const named = categories.find(entry => /deep|focus/i.test(entry.name) && entry.minutes >= ENOUGH.focusMinutes);
  const pick = named || categories.find(entry => entry.id !== OTHER.id && entry.id !== UNCATEGORIZED.id && entry.minutes >= ENOUGH.focusMinutes);
  const profile = pick && profiles.get(pick.id);
  if (!profile) return null;
  const total = sum(profile);
  if (!total) return null;
  const windowOf = width => {
    let best = { start: 0, share: 0 };
    for (let hour = 0; hour + width <= 24; hour += 1) {
      const share = sum(profile.slice(hour, hour + width)) / total;
      if (share > best.share + 1e-9) best = { start: hour, share };
    }
    return best;
  };
  const two = windowOf(2);
  const name = inSentence(pick.name);
  if (two.share >= 0.5) return { id: 'focus', text: `Most of your ${name} happens ${hourSpan(two.start, two.start + 2)}.` };
  const three = windowOf(3);
  if (three.share >= 0.5) return { id: 'focus', text: `Most of your ${name} happens ${hourSpan(three.start, three.start + 3)}.` };
  if (two.share >= 0.3) return { id: 'focus', text: `Your ${name} peaks ${hourSpan(two.start, two.start + 2)}: ${percent(two.share)}% of its hours.` };
  return null;
}

/** Main outcomes: the recent pace against the weeks before, or the overall rate. */
export function outcomeFinding(outcomes, totals) {
  const complete = outcomes.weeks.filter(week => !week.future && !week.current && !week.before);
  if (complete.length >= 8) {
    const recent = complete.slice(-4);
    const before = complete.slice(-8, -4);
    const now = Math.round(mean(recent.map(week => week.done)));
    const then = Math.round(mean(before.map(week => week.done)));
    if (sum(recent.map(week => week.set)) >= 4 && sum(before.map(week => week.set)) >= 4 && now !== then) {
      return { id: 'outcomes-pace', text: `Lately you finish ${plural(now, 'main outcome')} a week, ${now > then ? 'up' : 'down'} from ${then}.` };
    }
  }
  if (totals.mitSet >= 8) return { id: 'outcomes-rate', text: `You finish your main outcome on ${percent(totals.mitDone / totals.mitSet)}% of the days you set one.` };
  return null;
}

/** The category whose share of time moved most, when it moved a lot. */
export function trendFinding(categories, binKind) {
  const moving = categories.filter(entry => entry.id !== OTHER.id && entry.id !== UNCATEGORIZED.id && entry.trend && (entry.trend.direction === 'up' || entry.trend.direction === 'down') && Math.abs(entry.trend.change) >= 0.25 && entry.minutes >= ENOUGH.trendMinutes);
  if (!moving.length) return null;
  const top = moving.sort((a, b) => Math.abs(b.trend.change) - Math.abs(a.trend.change))[0];
  const span = plural(top.trend.recentBins, binKind === 'month' ? 'month' : 'week');
  const change = Math.min(999, percent(Math.abs(top.trend.change)));
  return { id: 'trend', text: `${top.name} is ${top.trend.direction} ${change}% over the last ${span}.` };
}

export function yoyFinding(yoy, range, todayKey) {
  if (!yoy.available) return null;
  const diff = yoy.current.closed - yoy.previous.closed;
  if (Math.abs(diff) < 3) return null;
  const when = range.endKey === todayKey && range.kind === 'year' ? 'than by this time last year' : `than on the same dates in ${Number(yoy.prevStart.slice(0, 4))}`;
  const count = Math.abs(diff);
  return { id: 'yoy', text: `${count} ${diff > 0 ? 'more' : 'fewer'} ${count === 1 ? 'day' : 'days'} closed ${when}.` };
}

export function streakFinding(streaks, { locale } = {}) {
  const { longest, current } = streaks;
  if (!longest || longest.length < 5) return null;
  // The run under way, counted inside the period like the longest one.
  const now = (streaks.runs || []).find(run => run.ongoing)?.length ?? current;
  if (current && now >= longest.length) return { id: 'streak', text: `You’re on your longest streak in this period: ${plural(now, 'day')}.` };
  return { id: 'streak', text: `Your longest streak: ${plural(longest.length, 'day')}, ending in ${monthName(longest.endKey, locale)}.` };
}

export function carryFinding(carry) {
  const item = carry.movedAgain[0];
  if (item && item.count >= 4 && !item.done) return { id: 'carry-item', text: `“${item.text.length > 48 ? `${item.text.slice(0, 47).trimEnd()}…` : item.text}” has moved ${item.count} times.` };
  if (carry.decided >= 10) {
    const share = carry.carried / carry.decided;
    if (share >= 0.6) return { id: 'carry-share', text: `At close, you carry ${percent(share)}% of unfinished work to another day.` };
    const letGo = carry.forgotten / carry.decided;
    if (letGo >= 0.25) return { id: 'carry-share', text: `At close, you let go of ${percent(letGo)}% of what’s unfinished.` };
  }
  return null;
}

export const THIN_FINDING = Object.freeze({ id: 'thin', text: 'Close a few more days to see your rhythm.' });

/** Up to four findings, most telling first; one calm line when the data is thin. */
export function buildFindings(model, { limit = 4, locale } = {}) {
  if (model.thin) return [THIN_FINDING];
  const weekday = weekdayFinding(model.rhythm.weekdays, { closed: model.totals.closed });
  const list = [
    weekday,
    focusFinding(model.time.categories, model.time.hourProfiles),
    outcomeFinding(model.outcomes, model.totals),
    yoyFinding(model.yoy, model.range, model.todayKey),
    trendFinding(model.time.categories, model.time.binKind),
    streakFinding(model.streaks, { locale }),
    carryFinding(model.carry),
    weekday?.weak || null
  ].filter(Boolean).map(({ id, text: line }) => ({ id, text: line }));
  if (!list.length) return [model.totals.closed < ENOUGH.rhythmClosed + 3 ? THIN_FINDING : { id: 'steady', text: 'Nothing stands out yet: your weeks look much alike.' }];
  return list.slice(0, limit);
}
