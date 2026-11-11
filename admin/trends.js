// Pure aggregation behind the owner dashboard's Trends, funnels and section
// usage. No DOM, no clock: every function takes the day it should treat as
// today. Days are 'YYYY-MM-DD' strings in UTC, as the API stores its counts.
//
// Periods are ISO weeks (Monday to Sunday), calendar months and calendar
// years. "To date" comparisons are like for like: this week Monday → today is
// compared with last week Monday → the same weekday, this month 1 → today with
// last month 1 → the same date (cut at the month's end), and this year
// 1 January → today with last year 1 January → the same date.

export const PERIODS = Object.freeze(['week', 'month', 'year']);

const DAY_MS = 86400000;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const pad = value => String(value).padStart(2, '0');
const ymd = (year, month, date) => `${String(year).padStart(4, '0')}-${pad(month)}-${pad(date)}`;
const toMs = day => Date.parse(`${day}T00:00:00Z`);
const fromMs = ms => new Date(ms).toISOString().slice(0, 10);

export const addDays = (day, count) => fromMs(toMs(day) + count * DAY_MS);
export const isDay = value => DAY_RE.test(String(value ?? '')) && Number.isFinite(toMs(value)) && addDays(value, 0) === value;
export const daysInMonth = (year, month) => new Date(Date.UTC(year, month, 0)).getUTCDate();
export const dayOf = date => fromMs(date.getTime());

/** 0 for Monday … 6 for Sunday. */
export const weekday = day => (new Date(toMs(day)).getUTCDay() + 6) % 7;

export const isoWeekStart = day => addDays(day, -weekday(day));

/** ISO 8601 week: the week belongs to the year of its Thursday. */
export function isoWeek(day) {
  const thursday = addDays(isoWeekStart(day), 3);
  const year = Number(thursday.slice(0, 4));
  return { year, week: Math.floor((toMs(thursday) - toMs(`${year}-01-01`)) / DAY_MS / 7) + 1 };
}

export function periodStart(period, day) {
  if (period === 'week') return isoWeekStart(day);
  if (period === 'month') return `${day.slice(0, 7)}-01`;
  return `${day.slice(0, 4)}-01-01`;
}

/** First day of the period `count` periods after (or before, when negative) the one starting at `start`. */
export function shiftPeriod(period, start, count) {
  if (period === 'week') return addDays(start, count * 7);
  const year = Number(start.slice(0, 4));
  if (period === 'month') {
    const index = year * 12 + Number(start.slice(5, 7)) - 1 + count;
    return ymd(Math.floor(index / 12), (index % 12 + 12) % 12 + 1, 1);
  }
  return ymd(year + count, 1, 1);
}

export const periodEnd = (period, start) => addDays(shiftPeriod(period, start, 1), -1);

export function periodKey(period, day) {
  if (period === 'week') {
    const { year, week } = isoWeek(day);
    return `${year}-W${pad(week)}`;
  }
  return period === 'month' ? day.slice(0, 7) : day.slice(0, 4);
}

/** The day of the period starting at `start` that sits where `day` sits in its own period, cut at that period's end. */
export function sameOffset(period, start, day) {
  if (period === 'week') return addDays(start, weekday(day));
  const year = Number(start.slice(0, 4));
  const month = period === 'month' ? Number(start.slice(5, 7)) : Number(day.slice(5, 7));
  return ymd(year, month, Math.min(Number(day.slice(8, 10)), daysInMonth(year, month)));
}

/**
 * The current period to date, the same days of the previous period and, for
 * weeks and months, the same days a year earlier (52 weeks earlier for a week,
 * so the weekdays match). A year's previous period already is last year.
 */
export function comparisonRanges(period, today) {
  const start = periodStart(period, today);
  const previousStart = shiftPeriod(period, start, -1);
  let lastYear = null;
  if (period === 'week') lastYear = { from: addDays(start, -364), to: addDays(today, -364) };
  else if (period === 'month') {
    const lastYearStart = shiftPeriod('month', start, -12);
    lastYear = { from: lastYearStart, to: sameOffset('month', lastYearStart, today) };
  }
  return {
    current: { from: start, to: today },
    previous: { from: previousStart, to: sameOffset(period, previousStart, today) },
    lastYear
  };
}

/** `count` whole periods, oldest first; the last one is the current period, cut at today. */
export function periodHistory(period, today, count) {
  const start = periodStart(period, today);
  const rows = [];
  for (let back = Math.max(1, count) - 1; back >= 0; back -= 1) {
    const from = shiftPeriod(period, start, -back);
    rows.push({ key: periodKey(period, from), from, to: back ? periodEnd(period, from) : today, current: !back });
  }
  return rows;
}

const inRange = (day, range) => day >= range.from && day <= range.to;

export function sumEvents(events, names, range) {
  let total = 0;
  for (const name of names) {
    for (const [day, count] of Object.entries(events?.[name] || {})) {
      if (inRange(day, range)) total += Number(count) || 0;
    }
  }
  return total;
}

/** Earliest day with a count for any of `names`, or '' when there is none. */
export function firstEventDay(events, names) {
  let first = '';
  for (const name of names) {
    for (const [day, count] of Object.entries(events?.[name] || {})) {
      if (Number(count) > 0 && (!first || day < first)) first = day;
    }
  }
  return first;
}

/**
 * What each Trends tile counts. Active devices: a device counts once per week
 * (app_active_week) or month (app_active_month); a year adds the months up, so
 * it reads in device-months rather than people.
 */
export const TREND_METRICS = Object.freeze([
  { id: 'landing', events: ['landing_viewed'] },
  { id: 'devices', events: { week: ['app_active_week'], month: ['app_active_month'], year: ['app_active_month'] } },
  { id: 'active-days', events: ['app_active_day'] },
  { id: 'installed-days', events: ['app_installed_day'] },
  { id: 'days-closed', events: ['day_closed'] },
  { id: 'years-planned', events: ['year_plan_completed'] },
  { id: 'quarter-check-ins', events: ['quarter_review_completed'] },
  { id: 'year-reviews', events: ['year_review_opened'] }
]);

export const metricById = id => TREND_METRICS.find(metric => metric.id === id) || null;

const eventNames = (metric, period) => (Array.isArray(metric.events) ? metric.events : metric.events?.[period] || []);

/** The metric's count over a range. */
export function metricValue(series, metric, period, range) {
  return sumEvents(series?.events, eventNames(metric, period), range);
}

/** The day counting started for a metric, or '': its own first count (an event appears with the version that sends it). */
export const metricFirstDay = (series, metric, period) => firstEventDay(series?.events, eventNames(metric, period));

/** Direction and size of a change; "new" when there was nothing before. */
export function change(current, previous) {
  const now = Number(current) || 0;
  const before = Number(previous) || 0;
  if (!before) return now ? { kind: 'new', pct: null } : { kind: 'flat', pct: 0 };
  const pct = (now - before) / before * 100;
  return { kind: pct > 0 ? 'up' : pct < 0 ? 'down' : 'flat', pct };
}

/** A part of a whole, or null when the whole is zero. */
export const ratio = (part, whole) => (Number(whole) > 0 ? (Number(part) || 0) / Number(whole) : null);

/**
 * Everything one tile needs: the current value, the previous one and the same
 * days a year earlier (null unless counting had started by then), plus the
 * last `count` periods for the sparkline (the last one to date).
 * previousPartial: counting started part-way through the previous period, so
 * the change overstates growth.
 */
export function metricTrend(series, metric, period, today, { count = 12 } = {}) {
  const ranges = comparisonRanges(period, today);
  const firstDay = metricFirstDay(series, metric, period);
  const value = range => metricValue(series, metric, period, range);
  const hasLastYear = !!(ranges.lastYear && firstDay && firstDay <= ranges.lastYear.from);
  return {
    id: metric.id,
    firstDay,
    ranges,
    previousPartial: !!(firstDay && firstDay > ranges.previous.from && firstDay <= ranges.previous.to),
    current: value(ranges.current),
    previous: value(ranges.previous),
    lastYear: hasLastYear ? value(ranges.lastYear) : null,
    history: periodHistory(period, today, count).map(row => ({ ...row, value: value(row) }))
  };
}

/** How many years "all years" covers: from the first year with data (at most `fromDay`'s year) to today's. */
export function yearsToShow(series, today) {
  const days = [];
  for (const counts of Object.values(series?.events || {})) {
    for (const [day, count] of Object.entries(counts || {})) if (Number(count) > 0) days.push(day);
  }
  const first = days.filter(isDay).sort()[0] || today;
  const floor = isDay(series?.from) ? series.from : first;
  const startYear = Math.max(Number(first.slice(0, 4)), Number(floor.slice(0, 4)));
  return Math.max(1, Number(today.slice(0, 4)) - startYear + 1);
}

// ---- Funnels -----------------------------------------------------------------

/**
 * Steps are anonymous counts taken independently of each other, not people
 * followed through: a rate is indicative and can pass 100%. `outcome` is the
 * step the overall rate is read at (default: the last one); closed days come
 * from every planner, not only new ones, so the planner funnel stops at onboarding.
 */
export const FUNNELS = Object.freeze([
  { id: 'planner', outcome: 2, steps: [{ events: ['landing_viewed'] }, { events: ['landing_cta_app'] }, { events: ['onboarding_completed'] }, { events: ['day_closed'] }] }
]);

const stepValue = (series, step, range) => sumEvents(series?.events, step.events, range);

/** Each step's count with its rate from the step before and from the first step. */
export function funnelSteps(series, funnel, range) {
  const values = funnel.steps.map(step => stepValue(series, step, range));
  return values.map((value, index) => ({
    value,
    fromPrevious: index ? ratio(value, values[index - 1]) : null,
    fromFirst: ratio(value, values[0])
  }));
}

/** The outcome step over the first step, for the current and the previous period. */
export function funnelOverall(series, funnel, ranges) {
  const outcome = funnel.outcome ?? funnel.steps.length - 1;
  const overall = range => {
    const steps = funnelSteps(series, funnel, range);
    return ratio(steps[outcome].value, steps[0].value);
  };
  return { current: overall(ranges.current), previous: overall(ranges.previous) };
}

// ---- Usage by section ----------------------------------------------------------

export const SECTION_EVENTS = Object.freeze(['week_view_opened', 'horizon_opened', 'progress_opened', 'journal_opened', 'unresolved_opened', 'stats_opened', 'search_opened', 'pip_opened', 'print_used']);

/**
 * Share of active days (app_active_day) on which each section was opened, now
 * and on the same days of the previous period, most used first. A change is
 * in percentage points.
 */
export function sectionUsage(series, ranges) {
  const events = series?.events;
  const active = sumEvents(events, ['app_active_day'], ranges.current);
  const activeBefore = sumEvents(events, ['app_active_day'], ranges.previous);
  return SECTION_EVENTS.map((name, order) => {
    const count = sumEvents(events, [name], ranges.current);
    const previousCount = sumEvents(events, [name], ranges.previous);
    const share = ratio(count, active);
    const previousShare = ratio(previousCount, activeBefore);
    return { name, order, count, previousCount, share, previousShare, changePts: share != null && previousShare != null ? (share - previousShare) * 100 : null };
  }).sort((a, b) => (b.share ?? -1) - (a.share ?? -1) || b.count - a.count || a.order - b.order);
}

/** Installs from the prompt and the share of active days spent in the installed app. */
export function installUsage(series, ranges) {
  const events = series?.events;
  const value = (names, range) => sumEvents(events, names, range);
  return {
    accepted: { current: value(['install_accepted'], ranges.current), previous: value(['install_accepted'], ranges.previous) },
    installedShare: {
      current: ratio(value(['app_installed_day'], ranges.current), value(['app_active_day'], ranges.current)),
      previous: ratio(value(['app_installed_day'], ranges.previous), value(['app_active_day'], ranges.previous))
    }
  };
}

/** The series request for a sign-in: 1 January of last year to today (UTC). */
export function seriesWindow(today) {
  return { from: `${Number(today.slice(0, 4)) - 1}-01-01`, to: today };
}

/** A usable series answer ({ from, to, events }), or null. */
export function normalizeSeries(body) {
  if (!body || typeof body !== 'object' || !body.events || typeof body.events !== 'object' || !isDay(body.to)) return null;
  return { from: isDay(body.from) ? body.from : body.to, to: body.to, events: body.events };
}
