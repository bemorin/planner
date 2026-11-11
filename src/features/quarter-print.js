import { esc, escAttr } from '../lib/text.js';
import { dateFromKey } from '../lib/dates.js';
import { progressIcon } from './progress-view.js';
import { PAINT_PALETTES } from './paint-palettes.js';
import { capList, hoursLabel } from './year-review.js';
import { quarterLead } from './quarter-review.js';

/**
 * A quarter check-in printed on one landscape page (styles/quarter.css,
 * `.print-sheet--quarter`), in the style of the year in review: the quarter as
 * a title, a line about it, five figures beside its three months painted and
 * where the time went; then the winning habit, what Horizon held and a few
 * lines from the journal; and the check-in itself — the two answers and the
 * next quarter's habit and focus, with ruled lines to write on where nothing
 * was typed. Parts with nothing in them are left out. Pure markup, except
 * fitQuarterAnswers(), which sizes the answers on the laid-out sheet.
 */

const PRINT_PALETTES = new Set(PAINT_PALETTES.map(palette => palette.id));
/** The most lines each list prints; every list entry is also clamped in CSS, so the page always fits A4 and Letter. */
export const QUARTER_PRINT_CAPS = Object.freeze({ time: 5, horizon: 6, journal: 4 });
const monthName = (year, month, style = 'long') => new Date(year, month, 1).toLocaleDateString(undefined, { month: style });
const printDay = key => { const date = dateFromKey(key); return `${date.getDate()} ${monthName(date.getFullYear(), date.getMonth(), 'short')}`; };
const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;
const moreLine = more => (more ? `<li class="qv-more">+${more} more</li>` : '');
const MARK = '<svg class="qv-mark-logo" viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="15" fill="#171611"/><path fill="none" stroke="#f4f0e7" stroke-width="3.9" stroke-linecap="round" stroke-linejoin="round" d="M12 38h40M20 38a12 12 0 0 1 24 0M32 17.5v4.5M17.5 23.5l3.2 3.2M46.5 23.5l-3.2 3.2M22.5 46h19"/></svg>';

/** "1 July – 30 September 2026", or up to today for the quarter under way. */
export function quarterPrintPeriod(review) {
  const from = dateFromKey(review.start);
  const to = dateFromKey(review.isCurrent && review.asOf ? review.asOf : review.end);
  return `${from.getDate()} ${monthName(review.year, from.getMonth())} – ${to.getDate()} ${monthName(review.year, to.getMonth())} ${review.year}`;
}

function figures(review) {
  const { closed, closeRate, planningElapsed, bestRun } = review.days;
  const habit = review.habit;
  const list = [
    { label: 'Days closed', value: closed, note: planningElapsed ? `of ${plural(planningElapsed, 'planning day')}${review.isCurrent ? ' so far' : ''}` : 'Close a day to paint its square' },
    { label: 'Close rate', value: `${closeRate}<small>%</small>`, note: planningElapsed ? 'of planning days closed' : '' },
    { label: 'Best streak', value: `${bestRun}<small>${bestRun === 1 ? 'day' : 'days'}</small>`, note: 'Planning days in a row', mod: 'streak' },
    { label: 'Main outcomes done', value: review.outcomes.done, note: review.outcomes.done ? `On ${review.outcomes.share}% of closed days` : 'The one result that makes a day' },
    habit.set ? { label: 'Habit kept', value: habit.percent == null ? '–' : `${habit.percent}<small>%</small>`, note: habit.elapsed ? `${habit.done} of ${plural(habit.elapsed, 'day')}` : 'Tracking not started' } : null
  ].filter(Boolean);
  return `<div class="qv-figures">${list.map(figure => `<div class="qv-fig${figure.mod ? ` qv-fig--${figure.mod}` : ''}"><b>${figure.mod === 'streak' ? progressIcon('flame') : ''}${figure.value}</b><span>${esc(figure.label)}</span>${figure.note ? `<small>${esc(figure.note)}</small>` : ''}</div>`).join('')}</div>`;
}

function painted(review) {
  const months = review.months.map(month => {
    const lead = '<i class="is-pad"></i>'.repeat(month.lead);
    const cells = month.days.map(day => `<i class="is-${day.state}"></i>`).join('');
    return `<div class="qv-month"><h3>${esc(month.name)}<span>${month.closed || ''}</span></h3><div class="qv-cal">${review.weekdays.map(day => `<b>${esc(day)}</b>`).join('')}${lead}${cells}</div></div>`;
  }).join('');
  const legend = [['l1', 'Closed'], ['l2', '+ main outcome'], ['l3', '+ winning habit'], ['joker', 'Joker used'], ['missed', 'Not closed'], ['rest', 'Rest day']];
  const closed = review.days.closed;
  return `<section class="qv-sec qv-paint">
      <h2 class="qv-h">The quarter, painted<span>${closed ? `${plural(closed, 'square')}, one per closed day` : 'A square for every day you close'}</span></h2>
      <div class="qv-months">${months}</div>
      <ul class="qv-legend">${legend.map(([state, label]) => `<li><i class="is-${state}"></i>${esc(label)}</li>`).join('')}</ul>
    </section>`;
}

function time(review) {
  const { total, days, rows } = review.time;
  if (!total) return '';
  const max = Math.max(...rows.map(row => row.minutes));
  const { shown, more } = capList(rows, QUARTER_PRINT_CAPS.time);
  return `<section class="qv-sec qv-time">
      <h2 class="qv-h">Where the time went<span>${esc(hoursLabel(total))} over ${plural(days, 'day')}</span></h2>
      <ol class="qv-bars">${shown.map(row => `<li style="--bar:${escAttr(row.color)}"><span>${esc(row.name)}</span><i aria-hidden="true"><i style="width:${(row.minutes / max * 100).toFixed(1)}%"></i></i><b>${esc(hoursLabel(row.minutes))}</b><small>${Math.round(row.share * 100)}%</small></li>`).join('')}${moreLine(more)}</ol>
    </section>`;
}

function habit(review, iconFn) {
  const { habit: h } = review;
  if (!h.set) return '';
  const months = h.months.map(month => {
    const percent = month.elapsed ? Math.round(month.done / month.elapsed * 100) : null;
    return `<li><span>${esc(monthName(review.year, month.month, 'short'))}</span><i aria-hidden="true"><i style="width:${percent || 0}%"></i></i><b>${percent == null ? '–' : `${percent}%`}</b></li>`;
  }).join('');
  const note = h.elapsed ? `Best streak ${plural(h.longest, 'day')} · tracked from ${printDay(h.trackingStart)}` : 'Tracking starts with the quarter';
  return `<section class="qv-sec qv-kind--habit">
      <h2 class="qv-h">${iconFn('repeat')}Winning habit<span>${esc(review.id)}</span></h2>
      <p class="qv-habit">${esc(h.text)}</p>
      <p class="qv-habit-note">${esc(note)}</p>
      <ol class="qv-habit-months">${months}</ol>
    </section>`;
}

/**
 * Up to `slots` items taken in turn from each group (so a long list of
 * milestones never hides every adventure), each group keeping its order.
 */
export function takeInTurn(groups, slots) {
  const taken = groups.map(() => 0);
  let left = Math.max(0, slots);
  let moved = true;
  while (left > 0 && moved) {
    moved = false;
    groups.forEach((group, index) => { if (left > 0 && taken[index] < group.length) { taken[index] += 1; left -= 1; moved = true; } });
  }
  return groups.flatMap((group, index) => group.slice(0, taken[index]));
}

function horizon(review, iconFn) {
  const { misogi, milestones, adventures, milestonesDone, lived } = review.horizon;
  const groups = [
    misogi ? [{ kind: 'misogi', text: misogi.text, when: misogi.when, done: misogi.done }] : [],
    milestones.map(item => ({ ...item, kind: 'milestone' })),
    adventures.map(item => ({ ...item, kind: 'adventure' }))
  ];
  const total = groups.reduce((sum, group) => sum + group.length, 0);
  if (!total) return '';
  const cap = QUARTER_PRINT_CAPS.horizon;
  const shown = total <= cap ? groups.flat() : takeInTurn(groups, cap - 1);
  const more = total - shown.length;
  const counts = [milestones.length ? `${milestonesDone} of ${plural(milestones.length, 'milestone')}` : '', adventures.length ? `${lived} of ${adventures.length} lived` : ''].filter(Boolean).join(' · ');
  return `<section class="qv-sec qv-kind--horizon">
      <h2 class="qv-h">${iconFn('flag')}In Horizon this quarter${counts ? `<span>${esc(counts)}</span>` : ''}</h2>
      <ul class="qv-checks">${shown.map(item => `<li class="qv-check--${item.kind}${item.done ? ' is-done' : ''}"><i aria-hidden="true">${item.done && item.kind !== 'milestone' ? iconFn('check') : ''}</i><span>${esc(item.text)}</span><small>${esc(item.when)}</small></li>`).join('')}${moreLine(more)}</ul>
    </section>`;
}

function journal(review) {
  const { memories, lessons } = review.journal;
  const entries = [...memories.map(entry => ({ ...entry, kind: 'memory' })), ...lessons.map(entry => ({ ...entry, kind: 'lesson' }))].slice(0, QUARTER_PRINT_CAPS.journal);
  if (!entries.length) return '';
  return `<section class="qv-sec qv-journal">
      <h2 class="qv-h">From the journal<span>${[memories.length ? `${memories.length} ${memories.length === 1 ? 'memory' : 'memories'}` : '', lessons.length ? plural(lessons.length, 'lesson') : ''].filter(Boolean).join(' · ')}</span></h2>
      <ul class="qv-notes">${entries.map(entry => `<li class="qv-note--${entry.kind}"><time>${esc(printDay(entry.key))}</time><p>${esc(entry.text)}</p></li>`).join('')}</ul>
    </section>`;
}

/** An answer as written, in full, then ruled lines down to the foot of the page to add to it by hand. */
function answer(title, value) {
  const body = String(value || '').trim();
  return `<section class="qv-sec qv-answer${body ? '' : ' is-blank'}">
      <h2 class="qv-h">${esc(title)}</h2>
      ${body ? `<p>${esc(body)}</p>` : ''}<div class="qv-lines" aria-hidden="true">${'<i></i>'.repeat(14)}</div>
    </section>`;
}

/** Past this many characters, the next quarter's habit or focus prints a size smaller. */
export const NEXT_LONG = 72;

function nextPart(review, iconFn) {
  const { next, entry } = review;
  const row = (label, value) => `<div><dt>${esc(label)}</dt>${value ? `<dd${value.length > NEXT_LONG ? ' class="is-long"' : ''}>${esc(value)}</dd>` : '<dd class="is-blank" aria-hidden="true"><i></i></dd>'}</div>`;
  return `<section class="qv-sec qv-next">
      <h2 class="qv-h">${iconFn('arrowRight')}Next · ${esc(next.id)}<span>${esc(next.period)}</span></h2>
      <dl>${row('Winning habit', next.habit)}${row('Focus', entry.focus)}</dl>
    </section>`;
}

/** The answers' type sizes, largest first (styles/quarter.css). */
export const ANSWER_SIZES = Object.freeze(['', 'qv-answer--s', 'qv-answer--xs']);

/**
 * Fit the check-in answers to the page (DOM): an answer is never cut while it
 * can fit. The two answers step down a type size together while one would run
 * past the foot of the page, and the ruled lines under each take whatever room
 * is left. Before the smallest size, the lists above (Horizon, the journal)
 * keep one line per entry (`qv--compact`) to give the answers more room; only
 * an answer still too long after that ends in an ellipsis. A sheet that is not
 * laid out (on screen, before printing) is measured on Letter's printable
 * width, the narrower of A4 and Letter.
 */
export function fitQuarterAnswers(sheet) {
  const page = sheet?.querySelector?.('.qv');
  if (!page) return;
  const hidden = !sheet.offsetHeight;
  if (hidden) sheet.classList.add('is-measuring');
  const sizes = ANSWER_SIZES.filter(Boolean);
  const answers = [...page.querySelectorAll('.qv-answer')].map(section => ({ section, text: section.querySelector(':scope > p') })).filter(item => item.text);
  const fits = ({ text }) => text.scrollHeight <= text.clientHeight + 1;
  const story = !!page.querySelector('.qv-band--story');
  // Both answers share one size: the largest at which both fit, trying the full lists above first, then
  // one line per entry (before the smallest size).
  const steps = [[false, ''], [false, 'qv-answer--s'], ...(story ? [[true, ''], [true, 'qv-answer--s']] : []), [story, 'qv-answer--xs']];
  try {
    answers.forEach(({ section, text }) => { section.classList.remove('is-clamped'); text.style.removeProperty('-webkit-line-clamp'); });
    const fitted = steps.some(([compact, name]) => {
      page.classList.toggle('qv--compact', compact);
      answers.forEach(({ section }) => { section.classList.remove(...sizes); if (name) section.classList.add(name); });
      return answers.every(fits);
    });
    if (fitted) return;
    answers.filter(answer => !fits(answer)).forEach(({ section, text }) => {
      const lines = Math.max(1, Math.floor((text.clientHeight + 1) / (parseFloat(getComputedStyle(text).lineHeight) || 1)));
      section.classList.add('is-clamped');
      text.style.setProperty('-webkit-line-clamp', String(lines));
    });
  } finally {
    if (hidden) sheet.classList.remove('is-measuring');
  }
}

/**
 * One landscape page for the print sheet. `palette` (a painted-year palette
 * id) prints its light colours; without it the page inherits them.
 */
export function renderQuarterPrint(review, { icon: iconFn, palette = '' } = {}) {
  const story = [habit(review, iconFn), horizon(review, iconFn), journal(review)].filter(Boolean);
  const side = time(review);
  const classes = ['qv', PRINT_PALETTES.has(palette) ? `qv--paint-${palette}` : '', story.length ? '' : 'qv--quiet', side ? '' : 'qv--notime'].filter(Boolean).join(' ');
  return `<div class="${classes}">
      <header class="qv-mast">
        <div class="qv-mast__title"><p class="qv-period">${esc(quarterPrintPeriod(review))}${review.isCurrent ? '<span> · so far</span>' : ''}</p><h1>${esc(review.id)} ${review.year}<span>, in review</span></h1></div>
        <p class="qv-lead">${esc(quarterLead(review))}</p>
      </header>
      <div class="qv-band qv-band--paint">${figures(review)}${painted(review)}${side}</div>
      ${story.length ? `<div class="qv-band qv-band--story qv-band--${story.length}">${story.join('')}</div>` : ''}
      <div class="qv-band qv-band--checkin">
        ${answer('What went well', review.entry.wentWell)}
        ${answer(`What I’ll do differently in ${review.next.id}`, review.entry.change)}
        ${nextPart(review, iconFn)}
      </div>
    </div>
    <a class="print-sheet-domain" href="https://planner.bemorin.com">${MARK}planner.bemorin.com</a>`;
}
