import { esc, escAttr } from '../lib/text.js';
import { addDaysKey, dateFromKey } from '../lib/dates.js';
import { OTHER, UNCATEGORIZED, percent } from './insights-model.js';

/**
 * Markup for Insights. Pure string rendering over the model (insights-model.js);
 * insights.js binds the period controls, tooltips and table toggles.
 *
 * Every chart is plain HTML (bars, cells and columns sized in %, so they stay
 * crisp from a phone to a wide dialog) with one SVG line for the four-week
 * average. Each chart is one keyboard stop (arrow keys move between marks),
 * every mark carries an aria-label and a `data-tip` payload for the shared
 * tooltip, and every chart has a table twin behind "Show table". Colours are
 * roles defined in styles/insights.css (validated categorical slots, a
 * one-hue sequential ramp); categories keep the colours people gave them.
 */

const SERIES = { closed: 'var(--ins-1)', mit: 'var(--ins-2)', carried: 'var(--ins-1)', saved: 'var(--ins-2)', forgotten: 'var(--ins-3)', now: 'var(--ins-1)', then: 'var(--ins-quiet)', avg: 'var(--ins-line)', bar: 'var(--ins-bar)' };

const ICONS = {
  prev: '<path d="m15 18-6-6 6-6"/>',
  next: '<path d="m9 18 6-6-6-6"/>',
  up: '<path d="M12 18V6M6.5 11.5 12 6l5.5 5.5"/>',
  down: '<path d="M12 6v12M6.5 12.5 12 18l5.5-5.5"/>',
  flat: '<path d="M5 12h14"/>',
  flame: '<path d="M12 21c3.6 0 6-2.4 6-5.6 0-3.9-3.1-5.7-3.9-9.4-2 1.4-2.9 3.3-2.9 5.1-1-.7-1.7-1.9-1.9-3.1C7.4 9.6 6 11.9 6 15.4 6 18.6 8.4 21 12 21Z"/>',
  device: '<rect x="6" y="3" width="12" height="18" rx="2.5"/><path d="M10.5 18h3"/>',
  chart: '<path d="M4 20h16"/><path d="M7 16.5v-5M12 16.5V6.5M17 16.5v-8"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>'
};
export const insightsIcon = name => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`;

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/** "45 min", "7.5 h", "1,240 h". */
export function hoursText(minutes) {
  const value = Math.max(0, Number(minutes) || 0);
  if (value < 60) return `${Math.round(value)} min`;
  const hours = value / 60;
  return `${(hours < 10 ? Math.round(hours * 10) / 10 : Math.round(hours)).toLocaleString('en-US')} h`;
}

const plural = (count, one, many = `${one}s`) => `${count.toLocaleString('en-US')} ${count === 1 ? one : many}`;

// toLocaleDateString builds a formatter on every call (slow across a few
// hundred marks); one Intl.DateTimeFormat per style and locale is reused.
const formatters = new Map();
function formatKey(key, locale, options, name) {
  const id = `${locale || ''}|${name}`;
  if (!formatters.has(id)) formatters.set(id, new Intl.DateTimeFormat(locale, options));
  return formatters.get(id).format(dateFromKey(key));
}
const shortDate = (key, locale) => formatKey(key, locale, { month: 'short', day: 'numeric' }, 'short');
const monthShort = (key, locale) => formatKey(key, locale, { month: 'short' }, 'month');
const monthNarrow = (key, locale) => formatKey(key, locale, { month: 'narrow' }, 'narrow');
const monthLong = (key, locale) => formatKey(key, locale, { month: 'long', year: 'numeric' }, 'month-year');
const monthOnly = (key, locale) => formatKey(key, locale, { month: 'long' }, 'month-long');
const weekdayShort = (weekday, locale) => formatKey(`2026-01-${String(4 + weekday).padStart(2, '0')}`, locale, { weekday: 'short' }, 'weekday');
const weekdayLong = (weekday, locale) => formatKey(`2026-01-${String(4 + weekday).padStart(2, '0')}`, locale, { weekday: 'long' }, 'weekday-long');

/** "Oct 5 – 11", "Sep 28 – Oct 4". */
export function spanLabel(startKey, endKey, locale) {
  if (startKey === endKey) return shortDate(startKey, locale);
  const sameMonth = startKey.slice(0, 7) === endKey.slice(0, 7);
  const end = sameMonth ? String(Number(endKey.slice(8))) : shortDate(endKey, locale);
  return `${shortDate(startKey, locale)} – ${end}`;
}

/** The stepper's label for a period. */
export function periodLabel(range, locale) {
  if (range.kind === 'year') return String(range.year);
  if (range.kind === 'quarter') return `Q${range.quarter} ${range.year}`;
  return spanLabel(range.startKey, range.endKey, locale);
}

/** The dates a period covers so far: "Jan 1 – Oct 20, 2026". */
export function datesLabel(range, locale) {
  const sameYear = range.startKey.slice(0, 4) === range.endKey.slice(0, 4);
  return `${sameYear ? spanLabel(range.startKey, range.endKey, locale) : `${shortDate(range.startKey, locale)} – ${shortDate(range.endKey, locale)}`}, ${range.endKey.slice(0, 4)}`;
}

const tip = (title, rows, note = '') => escAttr(JSON.stringify({ t: title, r: rows, n: note }));

function trendBadge(trend, binKind) {
  if (!trend) return '';
  const span = plural(trend.recentBins, binKind === 'month' ? 'month' : 'week');
  if (trend.direction === 'new') return `<span class="ins-trend">${insightsIcon('up')}New in the last ${span}</span>`;
  if (trend.direction === 'stopped') return `<span class="ins-trend">${insightsIcon('down')}None in the last ${span}</span>`;
  if (trend.direction === 'steady') return `<span class="ins-trend">${insightsIcon('flat')}Steady</span>`;
  const value = Math.min(999, percent(Math.abs(trend.change)));
  return `<span class="ins-trend ins-trend--${trend.direction}">${insightsIcon(trend.direction)}${trend.direction === 'up' ? 'Up' : 'Down'} ${value}%<span class="ins-trend__span"> · last ${span}</span></span>`;
}

function card({ id, title, sub = '', body, legend = '', table = '', wide = false, extra = '' }) {
  const tableId = `ins-table-${id}`;
  const toggle = table ? `<button class="ins-table-toggle" type="button" data-ins-table="${tableId}" aria-expanded="false" aria-controls="${tableId}">Show table</button>` : '';
  const foot = legend || toggle ? `<footer class="ins-card__foot">${legend}${toggle}</footer>` : '';
  return `<figure class="ins-card ins-card--${id}${wide ? ' ins-card--wide' : ''}" aria-labelledby="ins-${id}-title">
    <header class="ins-card__head"><div><h4 id="ins-${id}-title">${esc(title)}</h4>${sub ? `<p>${sub}</p>` : ''}</div></header>
    ${body}${extra}
    ${foot}
    ${table ? `<div class="ins-table" id="${tableId}" hidden>${table}</div>` : ''}
  </figure>`;
}

const empty = line => `<p class="ins-empty">${esc(line)}</p>`;
const legendItem = (color, label, kind = 'rect') => `<span class="ins-legend__item"><i class="ins-key ins-key--${kind}" style="--key:${color}"></i>${esc(label)}</span>`;
const legend = items => `<div class="ins-legend">${items.join('')}</div>`;
const tableOf = (caption, head, rows) => `<table><caption class="sr-only">${esc(caption)}</caption><thead><tr>${head.map((cell, index) => `<th scope="col"${index ? ' class="is-num"' : ''}>${esc(cell)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${row.map((cell, index) => (index ? `<td class="is-num">${esc(cell)}</td>` : `<th scope="row">${esc(cell)}</th>`)).join('')}</tr>`).join('')}</tbody></table>`;

// ---------------------------------------------------------------------------
// Top: period controls, findings
// ---------------------------------------------------------------------------

export function renderControls(range, { locale, closed = 0 } = {}) {
  const kinds = [['weeks', '4 weeks'], ['quarter', 'Quarter'], ['year', 'Year']];
  const unit = range.kind === 'year' ? 'year' : range.kind === 'quarter' ? 'quarter' : 'four weeks';
  return `<div class="ins-controls">
    <div class="ins-seg" role="radiogroup" aria-label="Period">${kinds.map(([kind, label]) => `<button type="button" role="radio" aria-checked="${kind === range.kind}" tabindex="${kind === range.kind ? '0' : '-1'}" class="${kind === range.kind ? 'is-active' : ''}" data-ins-kind="${kind}">${esc(label)}</button>`).join('')}</div>
    <div class="ins-step">
      <button class="icon-button" type="button" data-ins-step="-1" aria-label="Previous ${unit}"${range.prevAnchor ? '' : ' disabled'}>${insightsIcon('prev')}</button>
      <strong aria-live="polite">${esc(periodLabel(range, locale))}</strong>
      <button class="icon-button" type="button" data-ins-step="1" aria-label="Next ${unit}"${range.nextAnchor ? '' : ' disabled'}>${insightsIcon('next')}</button>
    </div>
  </div>
  <p class="ins-meta">${esc(datesLabel(range, locale))} · ${esc(plural(closed, 'day'))} closed</p>`;
}

export function renderFindings(findings) {
  const thin = findings.length === 1 && findings[0].id === 'thin';
  return `<section class="ins-findings${thin ? ' is-thin' : ''}" aria-labelledby="ins-findings-title">
    <header class="ins-findings__head"><h3 id="ins-findings-title">What stands out</h3></header>
    <ul>${findings.map(item => `<li data-finding="${escAttr(item.id)}"><span class="ins-findings__mark" aria-hidden="true"></span><p>${esc(item.text)}</p></li>`).join('')}</ul>
  </section>`;
}

// ---------------------------------------------------------------------------
// Your rhythm
// ---------------------------------------------------------------------------

export function renderWeekdays(model, { locale } = {}) {
  const { rhythm } = model;
  if (!rhythm.enough) return card({ id: 'weekdays', title: 'Days that work', sub: 'Days closed, and main outcomes done, by weekday.', body: empty('Close a few more days to see your rhythm.') });
  const rows = rhythm.order.map(weekday => rhythm.weekdays[weekday]);
  const body = `<div class="ins-week" role="group" aria-label="Days closed and main outcomes done by weekday. Use the arrow keys to move between days." data-ins-chart>${rows.map(row => {
    const name = weekdayLong(row.weekday, locale);
    const rest = !row.planning;
    const label = `${name}${rest ? ' (rest day)' : ''}: ${row.days ? `${percent(row.closeRate)}% closed, ${row.closed} of ${row.days} days` : 'no days yet'}; ${row.mitSet ? `main outcome done on ${percent(row.mitRate)}% of ${row.mitSet} days set` : 'no main outcome set'}`;
    const payload = tip(name + (rest ? ' · rest day' : ''), [
      [SERIES.closed, row.days ? `${percent(row.closeRate)}%` : '—', `closed · ${row.closed} of ${row.days} days`],
      [SERIES.mit, row.mitSet ? `${percent(row.mitRate)}%` : '—', `main outcome done · ${row.mitDone} of ${row.mitSet}`]
    ]);
    return `<div class="ins-week__row${rest ? ' is-rest' : ''}" data-tip="${payload}" tabindex="-1" role="img" aria-label="${escAttr(label)}">
      <span class="ins-week__day">${esc(weekdayShort(row.weekday, locale))}${rest ? '<small>rest</small>' : ''}</span>
      <span class="ins-week__bars"><span class="ins-hbar" style="--v:${(row.closeRate * 100).toFixed(1)}%;--c:${SERIES.closed}"></span><span class="ins-hbar" style="--v:${(row.mitRate * 100).toFixed(1)}%;--c:${SERIES.mit}"></span></span>
      <span class="ins-week__vals"><b>${row.days ? `${percent(row.closeRate)}%` : '—'}</b><span>${row.mitSet ? `${percent(row.mitRate)}%` : '—'}</span></span>
    </div>`;
  }).join('')}</div>`;
  const table = tableOf('Days closed and main outcomes by weekday', ['Weekday', 'Closed', 'Close rate', 'Main outcome done', 'Main outcome rate'], rows.map(row => [
    `${weekdayLong(row.weekday, locale)}${row.planning ? '' : ' (rest day)'}`, `${row.closed} of ${row.days}`, row.days ? `${percent(row.closeRate)}%` : '—', `${row.mitDone} of ${row.mitSet}`, row.mitSet ? `${percent(row.mitRate)}%` : '—'
  ]));
  return card({ id: 'weekdays', title: 'Days that work', sub: 'Share of days you closed, and of main outcomes you finished, by weekday.', body, legend: legend([legendItem(SERIES.closed, 'Days closed'), legendItem(SERIES.mit, 'Main outcome done')]), table });
}

export function renderHeatmap(model, { locale } = {}) {
  const { heat, order } = model.rhythm;
  const sub = 'Average minutes scheduled in each hour, by weekday.';
  if (!heat.enough) return card({ id: 'heat', title: 'When your time is scheduled', sub, body: empty('Schedule a few blocks to see when your time goes.') });
  const hours = [];
  for (let hour = heat.firstHour; hour < heat.lastHour; hour += 1) hours.push(hour);
  const cols = hours.length;
  const head = `<span class="ins-heat__corner" aria-hidden="true"></span>${hours.map(hour => `<span class="ins-heat__hour${hour % 2 ? ' is-odd' : ''}" aria-hidden="true">${hour}</span>`).join('')}`;
  const rows = order.map(weekday => {
    const name = weekdayLong(weekday, locale);
    const cells = hours.map(hour => {
      const cell = heat.cells[weekday][hour];
      const minutes = Math.round(cell.avg);
      const label = `${name}, ${hour}:00 to ${hour + 1}:00: ${minutes ? `${minutes} min on average` : 'nothing scheduled'}`;
      const payload = tip(`${name} · ${hour}:00–${hour + 1}:00`, [[`var(--ins-seq-${Math.max(1, cell.level)})`, minutes ? `${minutes} min` : 'None', minutes ? `on average · ${hoursText(cell.minutes)} in all` : 'nothing scheduled']]);
      return `<span class="ins-heat__cell is-l${cell.level}" data-tip="${payload}" tabindex="-1" role="img" aria-label="${escAttr(label)}"></span>`;
    }).join('');
    return `<span class="ins-heat__day" aria-hidden="true">${esc(weekdayShort(weekday, locale))}</span>${cells}`;
  }).join('');
  const body = `<div class="ins-heat" style="--cols:${cols}" role="group" aria-label="Scheduled time by weekday and hour. Use the arrow keys to move between hours and days." data-ins-chart data-cols="${cols}">${head}${rows}</div>`;
  const scale = `<div class="ins-scale" aria-hidden="true"><span>Less</span>${[0, 1, 2, 3, 4, 5].map(level => `<i class="ins-heat__cell is-l${level}"></i>`).join('')}<span>More</span></div>`;
  const table = tableOf('Average minutes scheduled by weekday and hour', ['Weekday', ...hours.map(hour => `${hour}:00`)], order.map(weekday => [weekdayLong(weekday, locale), ...hours.map(hour => String(Math.round(heat.cells[weekday][hour].avg)))]));
  return card({ id: 'heat', title: 'When your time is scheduled', sub, body, legend: scale, table });
}

// ---------------------------------------------------------------------------
// Where your time goes
// ---------------------------------------------------------------------------

function binLabel(bin, binKind, locale) {
  return binKind === 'month' ? monthLong(bin.startKey, locale) : `Week of ${spanLabel(bin.startKey, bin.endKey, locale)}`;
}

/** Labels under a row of bins: months as initials, weeks as dates or month starts. */
function axisLabels(bins, binKind, locale) {
  if (binKind === 'month') return bins.map(bin => `<span>${esc(monthNarrow(bin.startKey, locale))}</span>`).join('');
  if (bins.length <= 5) return bins.map(bin => `<span>${esc(shortDate(bin.startKey, locale))}</span>`).join('');
  let lastMonth = '';
  return bins.map(bin => {
    const month = bin.endKey.slice(0, 7);
    const show = month !== lastMonth;
    lastMonth = month;
    return `<span>${show ? esc(monthShort(bin.endKey, locale)) : ''}</span>`;
  }).join('');
}

export function renderTime(model, { locale } = {}) {
  const { time } = model;
  if (!time.enough) return `<div class="ins-grid">${card({ id: 'time', title: 'Hours by category', sub: 'Scheduled time, category by category.', body: empty('Schedule a few blocks to see where your time goes.'), wide: true })}</div>`;
  const unit = time.binKind === 'month' ? 'month' : 'week';
  const scaleMax = Math.max(60, ...time.categories.map(entry => entry.peak));
  const elapsed = Math.max(1, time.elapsedBins);
  const perBin = time.total / elapsed;
  const panels = time.categories.map(entry => {
    const swatch = entry.id === OTHER.id || entry.id === UNCATEGORIZED.id ? 'var(--ins-quiet)' : entry.color;
    const columns = entry.values.map((value, index) => {
      const bin = time.bins[index];
      if (bin.future) return '<span class="ins-col is-future" aria-hidden="true"></span>';
      const label = `${entry.name}, ${binLabel(bin, time.binKind, locale)}: ${hoursText(value)}${bin.current ? ' so far' : ''}`;
      return `<span class="ins-col${bin.current ? ' is-current' : ''}" style="--v:${((value / scaleMax) * 100).toFixed(2)}%" data-tip="${tip(binLabel(bin, time.binKind, locale), [[swatch, hoursText(value), `${entry.name}${bin.current ? ' · so far' : ''}`]])}" tabindex="-1" role="img" aria-label="${escAttr(label)}"><i></i></span>`;
    }).join('');
    return `<article class="ins-mini" style="--cat:${escAttr(swatch)}">
      <header class="ins-mini__head"><span class="ins-dot" aria-hidden="true"></span><strong>${esc(entry.name)}</strong><span class="ins-mini__total">${esc(hoursText(entry.minutes))}<small> · ${percent(entry.share)}%</small></span></header>
      <div class="ins-mini__trend">${trendBadge(entry.trend, time.binKind) || '<span class="ins-trend ins-trend--none">Too early for a trend</span>'}</div>
      <div class="ins-mini__plot" role="group" aria-label="${escAttr(`${entry.name}: hours per ${unit}. Use the arrow keys to move between ${unit}s.`)}" data-ins-chart style="--n:${time.bins.length}">${columns}</div>
      <div class="ins-mini__axis" aria-hidden="true" style="--n:${time.bins.length}">${axisLabels(time.bins, time.binKind, locale)}</div>
    </article>`;
  }).join('');
  const head = `<div class="ins-time-head">
      <div class="ins-figure"><span>Scheduled</span><strong>${esc(hoursText(time.total))}</strong><small>about ${esc(hoursText(perBin))} a ${unit}</small></div>
      <div class="ins-figure"><span>Overall</span><strong class="ins-figure__trend">${trendBadge(time.trend, time.binKind) || '<span class="ins-trend ins-trend--none">Too early for a trend</span>'}</strong><small>recent ${unit}s against the ones before</small></div>
    </div>`;
  const table = tableOf(`Hours by category per ${unit}`, ['Category', ...time.bins.filter(bin => !bin.future).map(bin => (time.binKind === 'month' ? monthShort(bin.startKey, locale) : shortDate(bin.startKey, locale))), 'Total'], time.categories.map(entry => [entry.name, ...entry.values.filter((_, index) => !time.bins[index].future).map(value => hoursText(value)), hoursText(entry.minutes)]));
  const body = `${head}<div class="ins-multiples">${panels}</div><p class="ins-note">All panels share one scale: the top line is ${esc(hoursText(scaleMax))} in a ${unit}.</p>`;
  return card({ id: 'time', title: 'Hours by category', sub: `Scheduled time per ${unit}, category by category, with how it’s moving.`, body, table, wide: true });
}

// ---------------------------------------------------------------------------
// Outcomes
// ---------------------------------------------------------------------------

function niceMax(value) {
  if (value <= 4) return 4;
  if (value <= 6) return 6;
  if (value <= 8) return 8;
  return Math.ceil(value / 5) * 5;
}

export function renderOutcomeTiles(model) {
  const { totals } = model;
  const tile = (label, value, small) => `<div class="ins-figure"><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(small)}</small></div>`;
  return `<div class="ins-figures">
    ${tile('Main outcomes done', totals.mitDone.toLocaleString('en-US'), totals.mitSet ? `${percent(totals.mitDone / totals.mitSet)}% of ${plural(totals.mitSet, 'day')} with one set` : 'none set yet')}
    ${tile('Other outcomes done', totals.otherDone.toLocaleString('en-US'), totals.otherSet ? `of ${totals.otherSet.toLocaleString('en-US')} set · ${percent(totals.otherDone / totals.otherSet)}%` : 'none set yet')}
    ${tile('Tasks done', totals.tasksDone.toLocaleString('en-US'), totals.tasksSet ? `of ${totals.tasksSet.toLocaleString('en-US')} written · ${percent(totals.tasksDone / totals.tasksSet)}%` : 'none written yet')}
  </div>`;
}

export function renderOutcomes(model, { locale } = {}) {
  const { outcomes } = model;
  const sub = 'Main outcomes finished each week, with the four-week average.';
  if (!outcomes.enough) return card({ id: 'outcomes', title: 'Main outcomes per week', sub, body: empty('Set a main outcome on a few days to see your pace.'), wide: true });
  const weeks = outcomes.weeks;
  const n = weeks.length;
  const top = niceMax(Math.max(1, ...weeks.map(week => Math.max(week.done, week.avg || 0))));
  const grid = [top, top / 2, 0].map(value => `<span class="ins-grid-line" style="--y:${((value / top) * 100).toFixed(2)}%"><em>${Math.round(value)}</em></span>`).join('');
  const columns = weeks.map(week => {
    if (week.future || week.before) return '<span class="ins-bars__col is-future" aria-hidden="true"></span>';
    const when = spanLabel(week.startKey, week.endKey, locale);
    const avg = Math.round((week.avg || 0) * 10) / 10;
    const label = `Week of ${when}: ${plural(week.done, 'main outcome')} done${week.current ? ' so far' : ''}; four-week average ${avg}`;
    const payload = tip(`Week of ${when}`, [[SERIES.bar, String(week.done), `main outcome${week.done === 1 ? '' : 's'} done${week.current ? ' so far' : ''} · ${week.set} set`], [SERIES.avg, String(avg), 'four-week average']]);
    return `<span class="ins-bars__col${week.current ? ' is-current' : ''}" data-tip="${payload}" tabindex="-1" role="img" aria-label="${escAttr(label)}"><i style="--v:${((week.done / top) * 100).toFixed(2)}%"></i></span>`;
  }).join('');
  const elapsed = weeks.map((week, index) => ({ week, index })).filter(item => !item.week.future && item.week.avg != null);
  const points = elapsed.map(({ week, index }) => `${(index + 0.5).toFixed(2)},${(top - week.avg).toFixed(3)}`).join(' ');
  const lastPoint = elapsed[elapsed.length - 1];
  const nearEnd = lastPoint && (lastPoint.index + 0.5) / n > 0.86;
  const endDot = lastPoint ? `<span class="ins-bars__end" style="left:${(((lastPoint.index + 0.5) / n) * 100).toFixed(2)}%;bottom:${((lastPoint.week.avg / top) * 100).toFixed(2)}%" aria-hidden="true"></span><span class="ins-bars__endlabel${nearEnd ? ' is-left' : ''}" style="left:${(((lastPoint.index + 0.5) / n) * 100).toFixed(2)}%;bottom:${((lastPoint.week.avg / top) * 100).toFixed(2)}%" aria-hidden="true">${(Math.round(lastPoint.week.avg * 10) / 10).toLocaleString('en-US')}</span>` : '';
  const axisBins = weeks.map(week => ({ ...week }));
  const body = `<div class="ins-bars" style="--n:${n}">
      <div class="ins-bars__frame">
        ${grid}
        <div class="ins-bars__plot" role="group" aria-label="Main outcomes done per week, with the four-week average. Use the arrow keys to move between weeks." data-ins-chart>${columns}</div>
        <svg class="ins-bars__avg" viewBox="0 0 ${n} ${top}" preserveAspectRatio="none" aria-hidden="true"><polyline points="${points}"/></svg>
        ${endDot}
      </div>
      <div class="ins-bars__axis" aria-hidden="true">${axisLabels(axisBins, 'week', locale)}</div>
    </div>`;
  const table = tableOf('Main outcomes done per week', ['Week', 'Done', 'Set', 'Four-week average'], weeks.filter(week => !week.future && !week.before).map(week => [`Week of ${spanLabel(week.startKey, week.endKey, locale)}`, String(week.done), String(week.set), String(Math.round((week.avg || 0) * 10) / 10)]));
  const best = outcomes.bestWeek && outcomes.bestWeek.done ? `<p class="ins-note">Best week: ${esc(plural(outcomes.bestWeek.done, 'main outcome'))}, week of ${esc(spanLabel(outcomes.bestWeek.startKey, outcomes.bestWeek.endKey, locale))}.</p>` : '';
  return card({ id: 'outcomes', title: 'Main outcomes per week', sub, body: body + best, legend: legend([legendItem(SERIES.bar, 'Done that week'), legendItem(SERIES.avg, 'Four-week average', 'line')]), table, wide: true });
}

export function renderCarry(model) {
  const { carry } = model;
  const sub = 'What happened to unfinished items when you closed the day.';
  if (!carry.enough) return card({ id: 'carry', title: 'Unfinished work', sub, body: empty('Close a day to see what happens to unfinished work.') });
  if (!carry.decided) return card({ id: 'carry', title: 'Unfinished work', sub, body: empty('Nothing was left unfinished on the days you closed.') });
  const parts = [
    ['carried', 'Carried to another day', carry.carried],
    ['saved', 'Saved in Unresolved', carry.saved],
    ['forgotten', 'Forgotten', carry.forgotten]
  ];
  const segments = parts.filter(([, , value]) => value > 0).map(([id, label, value]) => {
    const share = value / carry.decided;
    const inside = share >= 0.14 ? `<em>${percent(share)}%</em>` : '';
    return `<span class="ins-stack__seg ins-stack__seg--${id}" style="flex-grow:${value};--c:${SERIES[id]}" data-tip="${tip(label, [[SERIES[id], String(value), `${percent(share)}% of ${carry.decided} decided at close`]])}" tabindex="-1" role="img" aria-label="${escAttr(`${label}: ${value}, ${percent(share)}%`)}">${inside}</span>`;
  }).join('');
  const key = `<ul class="ins-stack__key">${parts.map(([id, label, value]) => `<li><i class="ins-key ins-key--rect" style="--key:${SERIES[id]}"></i><span>${esc(label)}</span><b>${value.toLocaleString('en-US')}</b></li>`).join('')}</ul>`;
  const moved = carry.movedAgain.length ? `<div class="ins-moved"><h5>Moved most often</h5><ul>${carry.movedAgain.map(item => `<li><span>${esc(item.text)}</span><b>${item.count}×</b>${item.done ? '<small>done</small>' : ''}</li>`).join('')}</ul></div>` : '';
  const perDay = Math.round(carry.perDay * 10) / 10;
  const body = `<div class="ins-stack" role="group" aria-label="Unfinished items at close: carried, saved or forgotten. Use the arrow keys to move between parts." data-ins-chart>${segments}</div>${key}
    <p class="ins-note">About ${esc(perDay.toLocaleString('en-US'))} item${perDay === 1 ? '' : 's'} a closed day${carry.finishedAfterMove ? ` · ${esc(plural(carry.finishedAfterMove, 'item'))} finished after being moved` : ''}.</p>${moved}`;
  const table = tableOf('Unfinished items at close', ['Decision', 'Items', 'Share'], parts.map(([, label, value]) => [label, String(value), `${percent(value / carry.decided)}%`]));
  return card({ id: 'carry', title: 'Unfinished work', sub, body, table });
}

// ---------------------------------------------------------------------------
// Streaks
// ---------------------------------------------------------------------------

export function renderStreaks(model, { locale } = {}) {
  const { streaks, range } = model;
  const sub = 'Rest days never break a run, and two jokers a month cover a missed planning day.';
  if (!streaks.enough) return card({ id: 'streaks', title: 'Runs of closed days', sub, body: empty('Close a few days in a row to start a streak.'), wide: true });
  const tile = (label, value, small, cls = '') => `<div class="ins-figure${cls}"><span>${esc(label)}</span><strong>${value}</strong><small>${esc(small)}</small></div>`;
  const longest = streaks.longest;
  const isToday = range.endKey === model.todayKey;
  const tiles = `<div class="ins-figures">
    ${isToday ? tile('Current streak', `${insightsIcon('flame')}${streaks.current}<small> ${streaks.current === 1 ? 'day' : 'days'}</small>`, streaks.current ? 'and counting' : 'close today to start one', ' ins-figure--streak') : tile('Days closed', model.totals.closed.toLocaleString('en-US'), `${percent(model.totals.closeRate)}% of planning days`)}
    ${tile('Longest', longest ? `${longest.length}<small> ${longest.length === 1 ? 'day' : 'days'}</small>` : '—', longest ? spanLabel(longest.startKey, longest.endKey, locale) : 'no run yet')}
    ${streaks.bestMonth ? tile('Best month', esc(monthOnly(`${streaks.bestMonth.month}-01`, locale)), `${percent(streaks.bestMonth.rate)}% of planning days closed`) : tile('Days closed', model.totals.closed.toLocaleString('en-US'), `${percent(model.totals.closeRate)}% of planning days`)}
  </div>`;
  const startMs = dateFromKey(range.startKey).getTime();
  const span = Math.round((dateFromKey(range.fullEndKey).getTime() - startMs) / 86400000) + 1;
  const pos = key => Math.max(0, Math.round((dateFromKey(key).getTime() - startMs) / 86400000));
  const runs = streaks.runs.filter(run => run.length >= 2 || run === longest);
  const marks = runs.map(run => {
    const from = Math.max(0, pos(run.startKey < range.startKey ? range.startKey : run.startKey));
    const to = Math.min(span, pos(run.endKey) + 1);
    const isLongest = run === longest;
    const label = `${plural(run.length, 'day')}, ${spanLabel(run.startKey, run.endKey, locale)}${run.jokers ? `, ${plural(run.jokers, 'joker')} used` : ''}${run.ongoing && isToday ? ', still going' : ''}`;
    return `<span class="ins-run${isLongest ? ' is-longest' : ''}" style="left:${((from / span) * 100).toFixed(2)}%;width:${(((to - from) / span) * 100).toFixed(2)}%" data-tip="${tip(`${plural(run.length, 'day')}${isLongest ? ' · longest' : ''}`, [[isLongest ? SERIES.now : SERIES.then, spanLabel(run.startKey, run.endKey, locale), run.jokers ? `${plural(run.jokers, 'joker')} used` : 'no joker needed']])}" tabindex="-1" role="img" aria-label="${escAttr(label)}"></span>`;
  }).join('');
  const ticks = [];
  if (range.kind === 'weeks') range.bins.forEach(bin => ticks.push([pos(bin.startKey), shortDate(bin.startKey, locale)]));
  else for (let key = range.startKey; key <= range.fullEndKey; key = `${addDaysKey(`${key.slice(0, 7)}-01`, 32).slice(0, 7)}-01`) ticks.push([pos(key), range.kind === 'year' ? monthNarrow(key, locale) : monthShort(key, locale)]);
  const todayMark = model.todayKey <= range.fullEndKey && model.todayKey >= range.startKey && range.fullEndKey > model.todayKey ? `<span class="ins-runs__today" style="left:${(((pos(model.todayKey) + 1) / span) * 100).toFixed(2)}%" aria-hidden="true"></span>` : '';
  const body = `${tiles}<div class="ins-runs">
      <div class="ins-runs__track" role="group" aria-label="Streaks over the period. Use the arrow keys to move between streaks." data-ins-chart>${marks}${todayMark}</div>
      <div class="ins-runs__axis" aria-hidden="true">${ticks.map(([at, label]) => `<span style="left:${((at / span) * 100).toFixed(2)}%">${esc(label)}</span>`).join('')}</div>
    </div>`;
  const table = tableOf('Streaks in this period', ['Streak', 'Days closed', 'Jokers used'], runs.map(run => [spanLabel(run.startKey, run.endKey, locale), String(run.length), String(run.jokers)]));
  return card({ id: 'streaks', title: 'Runs of closed days', sub, body, legend: runs.length > 1 ? legend([legendItem(SERIES.now, 'Longest'), legendItem(SERIES.then, 'Other streaks')]) : '', table, wide: true });
}

// ---------------------------------------------------------------------------
// Year over year
// ---------------------------------------------------------------------------

export function renderYoy(model, { locale } = {}) {
  const { yoy, range } = model;
  const thisYear = range.endKey.slice(0, 4);
  const lastYear = yoy.prevStart.slice(0, 4);
  const sub = `${datesLabel(range, locale)}, against the same dates in ${lastYear}.`;
  if (!yoy.available) return card({ id: 'yoy', title: 'Against last year', sub, body: empty(`${lastYear} has too little on these dates to compare with.`), wide: true });
  const rows = [
    ['Days closed', yoy.current.closed, yoy.previous.closed, value => value.toLocaleString('en-US')],
    ['Hours scheduled', yoy.current.minutes, yoy.previous.minutes, value => hoursText(value)],
    ['Main outcomes done', yoy.current.mitDone, yoy.previous.mitDone, value => value.toLocaleString('en-US')]
  ];
  const tiles = rows.map(([label, now, then, format]) => {
    const max = Math.max(1, now, then);
    const diff = now - then;
    const deltaText = diff === 0 ? 'Same as last year' : `${diff > 0 ? '+' : '−'}${format(Math.abs(diff))}${then ? ` · ${diff > 0 ? '+' : '−'}${Math.min(999, percent(Math.abs(diff) / then))}%` : ''}`;
    const delta = `<span class="ins-delta${diff > 0 ? ' is-up' : diff < 0 ? ' is-down' : ''}">${insightsIcon(diff > 0 ? 'up' : diff < 0 ? 'down' : 'flat')}${esc(deltaText)}</span>`;
    const bar = (value, year, color) => `<span class="ins-pair__row" data-tip="${tip(`${label} · ${year}`, [[color, format(value), year === thisYear ? 'this period' : 'same dates, a year earlier']])}" tabindex="-1" role="img" aria-label="${escAttr(`${label} in ${year}: ${format(value)}`)}"><em>${esc(year)}</em><span class="ins-hbar" style="--v:${((value / max) * 100).toFixed(2)}%;--c:${color}"></span><b>${esc(format(value))}</b></span>`;
    return `<div class="ins-pair"><span class="ins-pair__label">${esc(label)}</span><strong>${esc(format(now))}</strong>${delta}
      <div class="ins-pair__bars" role="group" aria-label="${escAttr(`${label}: ${thisYear} against ${lastYear}`)}" data-ins-chart>${bar(now, thisYear, SERIES.now)}${bar(then, lastYear, SERIES.then)}</div></div>`;
  }).join('');
  const table = tableOf('This period against the same dates a year earlier', ['Measure', thisYear, lastYear, 'Change'], rows.map(([label, now, then, format]) => [label, format(now), format(then), `${now - then >= 0 ? '+' : '−'}${format(Math.abs(now - then))}`]));
  return card({ id: 'yoy', title: 'Against last year', sub, body: `<div class="ins-pairs">${tiles}</div>`, legend: legend([legendItem(SERIES.now, thisYear), legendItem(SERIES.then, lastYear)]), table, wide: true });
}

// ---------------------------------------------------------------------------
// The whole page
// ---------------------------------------------------------------------------

const section = (id, title, sub, body) => `<section class="ins-section" aria-labelledby="ins-s-${id}"><header class="ins-section__head"><h3 id="ins-s-${id}">${esc(title)}</h3><p>${esc(sub)}</p></header>${body}</section>`;

/** One calm panel instead of a page of empty charts when the period has almost nothing yet. */
export function renderThin(model) {
  const past = model.range.endKey < model.todayKey;
  const longer = model.range.kind !== 'year' ? ' A longer period may already have enough.' : '';
  return `<section class="ins-thin" aria-labelledby="ins-thin-title">
    <span class="ins-thin__icon">${insightsIcon('chart')}</span>
    <h3 id="ins-thin-title">${past ? 'Too little was planned in this period to show insights.' : 'Close a few more days to see your rhythm.'}</h3>
    <p>Insights are worked out from the days you plan and close: which weekdays work best, when your time is scheduled, where it goes, your outcomes and your streaks.${esc(longer)}</p>
  </section>`;
}

export function renderInsights(model, { locale } = {}) {
  const options = { locale };
  if (model.thin) {
    return `<div class="ins is-thin" data-insights>
    ${renderControls(model.range, { locale, closed: model.totals.closed })}
    ${renderThin(model)}
  </div>`;
  }
  return `<div class="ins" data-insights>
    ${renderControls(model.range, { locale, closed: model.totals.closed })}
    ${renderFindings(model.findings, options)}
    ${section('rhythm', 'Your rhythm', 'Which days work best, and when your time is scheduled.', `<div class="ins-grid ins-grid--two">${renderWeekdays(model, options)}${renderHeatmap(model, options)}</div>`)}
    ${section('time', 'Where your time goes', 'Scheduled hours by category over the period.', renderTime(model, options))}
    ${section('outcomes', 'Outcomes', 'What you set out to do, what got done, and what was carried.', `${renderOutcomeTiles(model)}<div class="ins-grid">${renderOutcomes(model, options)}${renderCarry(model, options)}</div>`)}
    ${section('streaks', 'Streaks', 'How long your runs of closed days last, and when they happened.', renderStreaks(model, options))}
    ${section('yoy', 'Year over year', 'This period against the same dates a year earlier.', renderYoy(model, options))}
    <details class="ins-about">
      <summary>How Insights are worked out</summary>
      <div>
        <p><strong>Days closed</strong> counts planning days you closed since your first closed day; a rest day you close counts as a bonus. <strong>Main outcome done</strong> is the share of days with a most important outcome set where it was checked off.</p>
        <p><strong>When your time is scheduled</strong> averages the minutes of your blocks in each hour over every weekday in the period. <strong>Hours by category</strong> adds up block durations; the trend compares recent ${model.range.binKind === 'month' ? 'months' : 'weeks'} with the ones before.</p>
        <p><strong>Unfinished work</strong> is what you chose when closing a day: carry to a date, save in Unresolved, or forget. <strong>Streaks</strong> follow the same rules as Progress.</p>
        <p class="ins-about__private">${insightsIcon('device')}<span>Insights are worked out on this device from your own days. Nothing is sent anywhere.</span></p>
      </div>
    </details>
  </div>`;
}

/** The entry in Horizon → Progress. */
export function renderInsightsEntry(year) {
  return `<button type="button" class="hz-review-cta hz-insights-cta" data-horizon-insights="${escAttr(String(year))}">
    <span class="hz-review-cta__icon">${insightsIcon('chart')}</span>
    <span class="hz-review-cta__copy"><strong>Insights</strong><small>Which weekdays work best, when your time is scheduled, where it goes, outcomes per week and your streak history. Worked out on this device.</small></span>
    <span class="hz-review-cta__go">Open${insightsIcon('arrow')}</span>
  </button>`;
}
