import { esc, escAttr } from '../lib/text.js';
import { agendaDay, planCompact, planLine } from './day-summary.js';

/**
 * The plan side of Week view. On a phone the Plan tab shows the week as an
 * agenda — one card per planning day with its most important outcome, the
 * other outcomes, and how many tasks and blocks it holds; on a larger screen
 * each day header of the week grid carries the same plan in one line. Tapping
 * either opens that day.
 */

const CHECK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6.5 12.5 3.3 3.3 7.7-8"/></svg>';
const CHEVRON = '<svg class="week-agenda__chevron" viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>';

const mark = done => `<i class="week-plan-check${done ? ' is-done' : ''}" aria-hidden="true">${done ? CHECK : ''}</i>`;

/** The plan lines under a week day header (desktop grid). */
export function dayHeadPlan(info) {
  if (!info.mit && !info.counts.total) return '<span class="week-day-head__plan is-empty"><span class="week-day-head__meta">Nothing planned</span></span>';
  const mit = info.mit
    ? `<span class="week-day-head__mit${info.mit.done ? ' is-done' : ''}" data-tooltip="${escAttr(info.mit.text)}">${mark(info.mit.done)}<span>${esc(info.mit.text)}</span></span>`
    : '<span class="week-day-head__mit is-empty"><span>No main outcome</span></span>';
  return `<span class="week-day-head__plan">${mit}<span class="week-day-head__meta">${esc(planCompact(info.counts))}</span></span>`;
}

/** Accessible name of a day header or agenda card. */
export function dayLabel(date, info) {
  const day = date.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
  const plan = info.mit ? `Main outcome: ${info.mit.text}${info.mit.done ? ', done' : ''}. ` : '';
  return `Open ${day}${info.today ? ' (today)' : ''}. ${plan}${planLine(info.counts)}.`;
}

function agendaCard(date, info) {
  const weekday = date.toLocaleDateString(undefined, { weekday: 'short' });
  const tasks = info.counts.tasks ? `${info.counts.tasksDone}/${info.counts.tasks} ${info.counts.tasks === 1 ? 'task' : 'tasks'}` : '';
  const meta = [tasks, info.blocksLine].filter(Boolean);
  const empty = !info.mit && !info.others.length && !info.counts.tasks && !info.blocks;
  const body = empty
    ? `<span class="week-agenda__empty">${info.past ? 'Nothing was planned' : 'Nothing planned yet'}</span>`
    : `${info.mit ? `<span class="week-agenda__mit${info.mit.done ? ' is-done' : ''}">${mark(info.mit.done)}<span>${esc(info.mit.text)}</span></span>` : '<span class="week-agenda__mit is-empty"><span>No main outcome yet</span></span>'}
        ${info.others.length ? `<span class="week-agenda__others">${info.others.map(item => `<span class="${item.done ? 'is-done' : ''}">${mark(item.done)}<span>${esc(item.text)}</span></span>`).join('')}</span>` : ''}
        ${meta.length ? `<span class="week-agenda__meta">${meta.map(part => `<span>${esc(part)}</span>`).join('')}</span>` : ''}`;
  const flags = `${info.today ? ' is-today' : ''}${info.past ? ' is-past' : ''}${info.closed ? ' is-closed' : ''}${empty ? ' is-empty' : ''}`;
  return `<li><button type="button" class="week-agenda__day${flags}" data-week-agenda-day="${escAttr(info.key)}" aria-label="${escAttr(dayLabel(date, info))}">
      <span class="week-agenda__date" aria-hidden="true"><span>${esc(weekday)}</span><strong>${date.getDate()}</strong>${info.today ? '<em>Today</em>' : info.closed ? '<em class="is-closed">Closed</em>' : ''}</span>
      <span class="week-agenda__body" aria-hidden="true">${body}</span>
      ${CHEVRON}
    </button></li>`;
}

/**
 * Renders the agenda into `[data-week-agenda]`.
 * @param {object} ctx qs, qsa, ymd, loadStateForDate(date), openDay(key)
 * @param {Date[]} days the planning days of the week shown
 */
export function renderWeekAgenda(ctx, days, todayKey) {
  const wrap = ctx.qs('[data-week-agenda]');
  if (!wrap) return;
  const cards = days.map(day => {
    const key = ctx.ymd(day);
    return agendaCard(day, agendaDay(ctx.loadStateForDate(day), { key, todayKey }));
  }).join('');
  wrap.innerHTML = `<ol class="week-agenda__list">${cards}</ol>`;
  ctx.qsa('[data-week-agenda-day]', wrap).forEach(button => button.addEventListener('click', () => ctx.openDay(button.dataset.weekAgendaDay)));
}
