import { esc } from '../lib/text.js';
import { atNoon, ymdKey } from '../lib/dates.js';
import { habitActivityStats, rangeLabel } from './horizon-model.js';
import { buildHorizonModel } from './horizon-view.js';

/**
 * "Print the year": one landscape page with the year's shape — the Misogi and
 * its milestones, six mini-adventures, three commitments, four quarterly
 * habits, twelve small month calendars with their periods and key dates, and
 * the painted year when there is one.
 *
 * Empty parts print as ruled lines and empty boxes, so a blank year is a year
 * map to fill in by hand. Pure: a model, then markup (both unit-tested); the
 * print feature puts the markup in its print sheet.
 */

const MILESTONE_ROWS = 5;
const ADVENTURE_ROWS = 6;
const MONTH_EVENT_ROWS = 4;
const DAY_KINDS = ['misogi', 'adventure', 'keydate'];
const KIND_LABELS = { misogi: 'Misogi', milestone: 'Milestone', adventure: 'Mini-adventure', keydate: 'Key date' };

const monthName = (year, month, style = 'long') => new Date(year, month, 1).toLocaleDateString(undefined, { month: style });
const shortRange = event => rangeLabel(event.startDate, event.endDate === event.startDate ? '' : event.endDate);

/** Pure model for the printed year map. */
export function buildYearPrintModel({ year, data, keyDates = [], weekStartsOn = 1, progress = null, today = new Date() }) {
  const horizon = buildHorizonModel(data, year, keyDates, today);
  const events = horizon.events;
  const start = Number(weekStartsOn) || 0;
  const weekdays = Array.from({ length: 7 }, (_, index) => new Date(2023, 0, 1 + ((start + index) % 7)).toLocaleDateString(undefined, { weekday: 'narrow' }));

  const months = Array.from({ length: 12 }, (_, month) => {
    const first = `${year}-${String(month + 1).padStart(2, '0')}-01`;
    const days = new Date(year, month + 1, 0).getDate();
    const last = `${year}-${String(month + 1).padStart(2, '0')}-${String(days).padStart(2, '0')}`;
    const inMonth = events.filter(event => event.startDate <= last && event.endDate >= first);
    const lead = (new Date(year, month, 1).getDay() - start + 7) % 7;
    const cells = Array.from({ length: lead }, () => null);
    for (let day = 1; day <= days; day += 1) {
      const key = ymdKey(atNoon(new Date(year, month, day)));
      const touching = inMonth.filter(event => event.startDate <= key && event.endDate >= key);
      const kind = DAY_KINDS.find(name => touching.some(event => event.kind === name)) || '';
      const weekday = new Date(year, month, day).getDay();
      cells.push({ day, key, kind, milestone: touching.some(event => event.kind === 'milestone'), weekend: weekday === 0 || weekday === 6 });
    }
    while (cells.length % 7) cells.push(null);
    const weeks = [];
    for (let index = 0; index < cells.length; index += 7) weeks.push(cells.slice(index, index + 7));
    return {
      month,
      name: monthName(year, month),
      quarter: month % 3 === 0 ? `Q${month / 3 + 1}` : '',
      weeks,
      events: inMonth.slice(0, MONTH_EVENT_ROWS).map(event => ({ kind: event.kind, text: event.text, when: shortRange(event), done: event.done })),
      more: Math.max(0, inMonth.length - MONTH_EVENT_ROWS)
    };
  });

  const milestones = data.misogiMilestones.filter(item => item.text.trim()).slice(0, MILESTONE_ROWS);
  const adventures = data.miniAdventures.filter(item => item.text.trim()).slice(0, ADVENTURE_ROWS).map(item => {
    const done = !!item.done || item.status === 'done';
    return { text: item.text.trim(), when: item.startDate ? rangeLabel(item.startDate, item.endDate) : '', status: done ? 'Lived' : item.startDate ? 'Planned' : 'Idea', done };
  });
  const habits = data.habits.map((habit, index) => {
    const text = habit.trim();
    const stats = text ? habitActivityStats(data, index, year, today) : null;
    return { quarter: `Q${index + 1}`, months: `${monthName(year, index * 3, 'short')}–${monthName(year, index * 3 + 2, 'short')}`, text, kept: stats && stats.elapsed ? `${stats.percent}% kept` : '' };
  });
  const painted = progress && progress.closed
    ? { closed: progress.closed, rows: progress.months.map(month => ({ name: monthName(year, month.month, 'narrow'), levels: month.days.map(cell => (cell.closed ? cell.level : cell.future ? -1 : 0)) })) }
    : null;

  return {
    year,
    weekdays,
    misogi: {
      text: data.misogi.trim(),
      when: data.misogiStartDate ? rangeLabel(data.misogiStartDate, data.misogiEndDate) : '',
      done: !!data.misogiDone,
      milestones: Array.from({ length: MILESTONE_ROWS }, (_, index) => {
        const item = milestones[index];
        return item ? { text: item.text.trim(), when: item.date ? rangeLabel(item.date) : '', done: !!item.done } : null;
      })
    },
    adventures: Array.from({ length: ADVENTURE_ROWS }, (_, index) => adventures[index] || null),
    commitments: data.meaningful.map(text => text.trim()),
    habits,
    months,
    painted,
    isBlank: !events.length && !data.misogi.trim() && !adventures.length && !data.meaningful.some(text => text.trim()) && !data.habits.some(habit => habit.trim())
  };
}

const box = done => `<span class="pyr-box${done ? ' is-checked' : ''}" aria-hidden="true"></span>`;
const blank = (className = '') => `<span class="pyr-blank${className ? ` ${className}` : ''}"></span>`;

function renderMisogi(misogi) {
  const milestones = misogi.milestones.map((item, index) => `<li class="pyr-row${item?.done ? ' is-done' : ''}">${box(item?.done)}<span class="pyr-row__index">${index + 1}</span>${item ? `<span class="pyr-row__text">${esc(item.text)}</span>` : blank()}<span class="pyr-row__when">${item?.when ? esc(item.when) : blank('pyr-blank--date')}</span></li>`).join('');
  return `<section class="pyr-card pyr-card--misogi">
    <header><h2>Misogi</h2><small>The one hard thing that defines the year</small></header>
    <div class="pyr-misogi${misogi.done ? ' is-done' : ''}">${box(misogi.done)}${misogi.text ? `<strong>${esc(misogi.text)}</strong>` : `<span class="pyr-lines pyr-lines--2"></span>`}</div>
    <p class="pyr-when"><span>When</span>${misogi.when ? esc(misogi.when) : blank()}</p>
    <h3>Milestones</h3>
    <ol class="pyr-list">${milestones}</ol>
  </section>`;
}

function renderAdventures(adventures) {
  const rows = adventures.map((item, index) => `<li class="pyr-row${item?.done ? ' is-done' : ''}">${box(item?.done)}<span class="pyr-row__index">${index + 1}</span>${item ? `<span class="pyr-row__text">${esc(item.text)}</span>` : blank()}<span class="pyr-row__when">${item ? esc(item.when || item.status) : blank('pyr-blank--date')}</span></li>`).join('');
  return `<section class="pyr-card pyr-card--adventures">
    <header><h2>Mini-adventures</h2><small>Six experiences that break the routine</small></header>
    <ol class="pyr-list">${rows}</ol>
  </section>`;
}

function renderCommitments(commitments) {
  return `<section class="pyr-card pyr-card--commitments">
    <header><h2>Commitments</h2><small>What would make this year meaningful</small></header>
    <ol class="pyr-list">${commitments.map((text, index) => `<li class="pyr-row pyr-row--tall"><span class="pyr-row__index">${index + 1}</span>${text ? `<span class="pyr-row__text pyr-row__text--wrap">${esc(text)}</span>` : blank()}</li>`).join('')}</ol>
  </section>`;
}

function renderHabits(habits) {
  return `<section class="pyr-card pyr-card--habits">
    <header><h2>Winning habits</h2><small>One practice per quarter</small></header>
    <ol class="pyr-list">${habits.map(habit => `<li class="pyr-row pyr-row--habit"><span class="pyr-row__quarter"><b>${esc(habit.quarter)}</b>${esc(habit.months)}</span>${habit.text ? `<span class="pyr-row__text">${esc(habit.text)}</span>` : blank()}<span class="pyr-row__when">${esc(habit.kept)}</span></li>`).join('')}</ol>
  </section>`;
}

function renderMonth(month, weekdays) {
  const head = weekdays.map(day => `<span>${esc(day)}</span>`).join('');
  const days = month.weeks.flat().map(cell => (cell
    ? `<span class="pyr-day${cell.kind ? ` is-${cell.kind}` : ''}${cell.milestone ? ' is-milestone' : ''}${cell.weekend ? ' is-weekend' : ''}">${cell.day}</span>`
    : '<span class="pyr-day is-outside"></span>')).join('');
  const events = month.events.map(event => `<li class="pyr-event pyr-kind--${event.kind}${event.done ? ' is-done' : ''}"><i aria-hidden="true"></i><b>${esc(event.when)}</b><span>${esc(event.text)}</span></li>`).join('');
  return `<article class="pyr-month">
    <header><h3>${esc(month.name)}</h3>${month.quarter ? `<small>${esc(month.quarter)}</small>` : ''}</header>
    <div class="pyr-cal" style="--weeks:${month.weeks.length}"><div class="pyr-cal__head">${head}</div><div class="pyr-cal__days">${days}</div></div>
    <ul class="pyr-events">${events}${month.more ? `<li class="pyr-event pyr-event--more">+${month.more} more</li>` : ''}</ul>
  </article>`;
}

function renderPainted(painted, year) {
  if (!painted) return '';
  // Only the quarters are labelled: twelve letters would crowd rows a millimetre tall.
  const rows = painted.rows.map((row, index) => `<div class="pyr-paint__row"><span>${index % 3 === 0 ? esc(row.name) : ''}</span>${row.levels.map(level => `<i class="${level < 0 ? 'is-future' : `is-level-${level}`}"></i>`).join('')}</div>`).join('');
  return `<figure class="pyr-paint" aria-label="${esc(`${painted.closed} days closed in ${year}`)}"><div class="pyr-paint__grid">${rows}</div><figcaption><b>${painted.closed}</b> day${painted.closed === 1 ? '' : 's'} painted</figcaption></figure>`;
}

/** Markup for the print sheet (header, the year's parts, twelve months, footer). */
export function renderYearPrint(model) {
  const legend = Object.entries(KIND_LABELS).map(([kind, label]) => `<li class="pyr-kind--${kind}"><i aria-hidden="true"></i>${esc(label)}</li>`).join('');
  return `<header class="print-sheet-head pyr-head">
      <div><span>Horizon · Year map</span><h1>${model.year}</h1></div>
      <ul class="pyr-legend">${legend}</ul>
      ${renderPainted(model.painted, model.year)}
    </header>
    <div class="pyr-body${model.isBlank ? ' is-blank' : ''}">
      <div class="pyr-side">
        ${renderMisogi(model.misogi)}
        ${renderAdventures(model.adventures)}
        ${renderCommitments(model.commitments)}
        ${renderHabits(model.habits)}
      </div>
      <div class="pyr-months">${model.months.map(month => renderMonth(month, model.weekdays)).join('')}</div>
    </div>
    <footer class="pyr-foot"><span>Misogi, mini-adventures and winning habits: a yearly rhythm from Jesse Itzler.</span></footer>
    <a class="print-sheet-domain" href="https://planner.bemorin.com">planner.bemorin.com</a>`;
}
