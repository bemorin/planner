import { esc, escAttr } from '../lib/text.js';
import { dateFromKey } from '../lib/dates.js';
import { JOKERS_PER_MONTH, TROPHIES, TROPHY_GROUPS } from './progress-model.js';

/**
 * Markup for Progress: the painted year, streak stats and the trophy room.
 * Shared by the Horizon "Progress" section, the Overview card and the
 * Close-day summary. Pure string rendering; callers bind interactions.
 */

const SEEN_KEY = 'daily-planner-ui:trophies-seen';

const ICONS = {
  sunset: '<path d="M4 16.5h16"/><path d="M6.5 16.5a5.5 5.5 0 0 1 11 0"/><path d="M12 5v2.2M5.8 7.6l1.5 1.5M18.2 7.6l-1.5 1.5M8 20h8"/>',
  flame: '<path d="M12 21c3.6 0 6-2.4 6-5.6 0-3.9-3.1-5.7-3.9-9.4-2 1.4-2.9 3.3-2.9 5.1-1-.7-1.7-1.9-1.9-3.1C7.4 9.6 6 11.9 6 15.4 6 18.6 8.4 21 12 21Z"/>',
  target: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4.5"/><circle cx="12" cy="12" r="1"/>',
  bulb: '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.6 10.8c.7.5 1.1 1.3 1.1 2.2h5c0-.9.4-1.7 1.1-2.2A6 6 0 0 0 12 3Z"/>',
  heart: '<path d="M12 20s-7.5-4.4-7.5-10.1A4.4 4.4 0 0 1 12 7.2a4.4 4.4 0 0 1 7.5 2.7C19.5 15.6 12 20 12 20Z"/>',
  mountain: '<path d="M2.5 19.5h19"/><path d="m4.5 19.5 6-10.5 4.2 7.2"/><path d="m12.8 13.2 2.6-4.2 5.1 10.5"/>',
  diamond: '<path d="m12 3.5 8.5 8.5-8.5 8.5L3.5 12Z"/>',
  flag: '<path d="M5.5 21V3.5"/><path d="M5.5 4.5h12l-2.3 4 2.3 4h-12"/>',
  calendar: '<path d="M7 3v3M17 3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z"/>',
  repeat: '<path d="M16.5 3 20 6.5 16.5 10"/><path d="M4 11.5V10a3.5 3.5 0 0 1 3.5-3.5H20"/><path d="M7.5 21 4 17.5 7.5 14"/><path d="M20 12.5V14a3.5 3.5 0 0 1-3.5 3.5H4"/>',
  lock: '<rect x="5" y="10.5" width="14" height="10" rx="2"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/>',
  trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0V4Z"/><path d="M8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8.5 20.5h7M9.5 17h5v3.5h-5z"/>',
  joker: '<path d="m12 4 2.2 4.6 5 .7-3.6 3.5.9 5-4.5-2.4-4.5 2.4.9-5L4.8 9.3l5-.7Z"/>'
};

export const progressIcon = (name, className = '') => `<svg${className ? ` class="${className}"` : ''} viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ICONS.trophy}</svg>`;

const dayLabel = key => dateFromKey(key).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });

function cellState(cell) {
  if (cell.closed) return { cls: `is-closed is-level-${cell.level}`, label: `Closed${cell.mitDone ? ' · main outcome done' : ''}${cell.habitKept ? ' · habit kept' : ''}` };
  if (cell.today) return { cls: 'is-today', label: 'Today · close the day to paint it' };
  if (cell.future) return { cls: 'is-future', label: '' };
  if (cell.before) return { cls: 'is-before', label: 'Before your first closed day' };
  if (cell.joker) return { cls: 'is-joker', label: 'Missed · a joker kept the streak' };
  if (cell.planning) return { cls: 'is-missed', label: 'Not closed' };
  return { cls: 'is-rest', label: 'Rest day' };
}

/** Twelve rows (months) of up to 31 day cells. */
export function renderPaintedYear(model, { interactive = false, compact = false, highlightKey = '' } = {}) {
  // Interactive grids are one tab stop (roving tabindex, arrow keys move):
  // today when it is in this year, otherwise the last day that has passed.
  const past = model.months.flatMap(month => month.days).filter(cell => !cell.future);
  const focusKey = interactive ? (past.find(cell => cell.today) || past[past.length - 1])?.key : '';
  const rows = model.months.map(month => {
    const name = new Date(model.year, month.month, 1).toLocaleDateString(undefined, { month: 'short' });
    const cells = month.days.map(cell => {
      const state = cellState(cell);
      const label = `${dayLabel(cell.key)}${state.label ? ` · ${state.label}` : ''}`;
      const cls = `hz-paint__cell ${state.cls}${cell.today ? ' is-today' : ''}${cell.key === highlightKey ? ' is-just-painted' : ''}`;
      if (interactive && !cell.future) return `<button type="button" class="${cls}" data-progress-day="${escAttr(cell.key)}" data-tooltip="${escAttr(label)}" aria-label="${escAttr(label)}" tabindex="${cell.key === focusKey ? '0' : '-1'}"></button>`;
      return `<span class="${cls}"${compact ? '' : ` data-tooltip="${escAttr(label)}"`} aria-hidden="true"></span>`;
    }).join('');
    return `<div class="hz-paint__row"><span class="hz-paint__month">${esc(name)}</span><div class="hz-paint__cells">${cells}</div><span class="hz-paint__count">${month.closed || ''}</span></div>`;
  }).join('');
  const summary = escAttr(`${model.closed} days closed in ${model.year}`);
  return interactive
    ? `<div class="hz-paint" role="group" aria-label="${summary}. Use the arrow keys to move between days; Enter opens a day." data-progress-grid>${rows}</div>`
    : `<div class="hz-paint${compact ? ' hz-paint--compact' : ''}" role="img" aria-label="${summary}">${rows}</div>`;
}

export function renderPaintLegend() {
  return `<ul class="hz-paint-legend" aria-hidden="true">
    <li><i class="hz-paint__cell is-closed is-level-1"></i>Closed</li>
    <li><i class="hz-paint__cell is-closed is-level-2"></i>+ main outcome</li>
    <li><i class="hz-paint__cell is-closed is-level-3"></i>+ winning habit</li>
    <li><i class="hz-paint__cell is-joker"></i>Joker used</li>
    <li><i class="hz-paint__cell is-missed"></i>Not closed</li>
    <li><i class="hz-paint__cell is-rest"></i>Rest day</li>
  </ul>`;
}

export function renderStreakStats(model) {
  const { streak } = model;
  const jokerDots = Array.from({ length: JOKERS_PER_MONTH }, (_, index) => `<i class="${index < streak.jokersLeftThisMonth ? 'is-left' : ''}"></i>`).join('');
  return `<div class="hz-progress-stats">
    <div class="hz-stat"><span>Days closed</span><strong>${model.closed}</strong><small>${!model.closed ? 'Close a day to paint your first square' : model.planningElapsed ? `${model.closeRate}% of planning days so far` : 'Your first square is painted'}</small></div>
    <div class="hz-stat hz-stat--streak"><span>Current streak</span><strong>${progressIcon('flame')}${streak.current}<small> day${streak.current === 1 ? '' : 's'}</small></strong><small>${streak.todayPending ? (streak.current ? 'Close today to keep it going' : 'Close today to start one') : `Best in ${model.year}: ${streak.yearBest}`}</small></div>
    <div class="hz-stat"><span>Jokers this month</span><strong class="hz-jokers" aria-label="${streak.jokersLeftThisMonth} of ${JOKERS_PER_MONTH} left">${jokerDots}</strong><small>${streak.jokersLeftThisMonth} of ${JOKERS_PER_MONTH} left · a missed day won’t break your streak</small></div>
    <div class="hz-stat"><span>Trophies</span><strong>${model.unlocked.length}<small>/${model.trophies.length}</small></strong><small>${model.nextUp[0] ? `Next: ${esc(model.nextUp[0].title)}` : 'All unlocked — remarkable'}</small></div>
  </div>`;
}

export function renderTrophy(trophy, { compact = false } = {}) {
  const percent = Math.round(trophy.progress * 100);
  const when = trophy.unlockedOn ? dateFromKey(trophy.unlockedOn).toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) : '';
  return `<article class="hz-trophy hz-trophy--${trophy.group}${trophy.unlocked ? ' is-unlocked' : ''}${compact ? ' is-compact' : ''}" data-trophy="${escAttr(trophy.id)}">
    <span class="hz-trophy__badge">${progressIcon(trophy.unlocked ? trophy.icon : trophy.icon)}${trophy.unlocked ? '' : `<span class="hz-trophy__lock">${progressIcon('lock')}</span>`}</span>
    <span class="hz-trophy__copy"><strong>${esc(trophy.title)}</strong><small>${esc(trophy.unlocked ? (when ? `Unlocked ${when}` : 'Unlocked') : trophy.detail)}</small>
      ${trophy.unlocked ? '' : `<span class="hz-trophy__progress"><span class="hz-meter"><span style="width:${percent}%"></span></span><em>${trophy.value}/${trophy.target}</em></span>`}
    </span>
  </article>`;
}

export function renderTrophyRoom(model) {
  const next = model.nextUp.length ? `<section class="hz-trophy-next"><h4>Closest to unlocking</h4><div class="hz-trophy-grid hz-trophy-grid--next">${model.nextUp.map(trophy => renderTrophy(trophy)).join('')}</div></section>` : '';
  const groups = TROPHY_GROUPS.map(group => {
    const items = model.trophies.filter(trophy => trophy.group === group.id);
    const done = items.filter(trophy => trophy.unlocked).length;
    return `<section class="hz-trophy-group"><h4>${esc(group.label)} <span>${done}/${items.length}</span></h4><div class="hz-trophy-grid">${items.map(trophy => renderTrophy(trophy, { compact: true })).join('')}</div></section>`;
  }).join('');
  return `${next}${groups}`;
}

/** Compact strip for the Close-day summary: this month painted, streak, unlocks. */
export function renderDayClosedProgress(model, dayKey, newTrophies = []) {
  const month = model.months[dateFromKey(dayKey).getMonth()];
  const cells = month.days.map(cell => {
    const state = cellState(cell);
    return `<span class="hz-paint__cell ${state.cls}${cell.key === dayKey ? ' is-just-painted' : ''}" aria-hidden="true"></span>`;
  }).join('');
  const monthName = new Date(model.year, month.month, 1).toLocaleDateString(undefined, { month: 'long' });
  const unlocks = newTrophies.length ? `<div class="day-closed-progress__unlocks">${newTrophies.map(trophy => `<span class="day-closed-progress__trophy">${progressIcon(trophy.icon)}<span><small>Trophy unlocked</small><strong>${esc(trophy.title)}</strong></span></span>`).join('')}</div>` : '';
  const next = model.nextUp[0];
  return `<div class="day-closed-progress__head"><span>${esc(monthName)}, painted</span><strong>${progressIcon('flame')}${model.streak.current}-day streak</strong></div>
    <div class="day-closed-progress__month">${cells}</div>
    <p class="day-closed-progress__next">${model.closed} day${model.closed === 1 ? '' : 's'} closed this year${next ? ` · next trophy: <strong>${esc(next.title)}</strong> (${next.value}/${next.target})` : ''}</p>
    ${unlocks}`;
}

export function readSeenTrophies(year) {
  try {
    const raw = JSON.parse(localStorage.getItem(SEEN_KEY) || '{}');
    return Array.isArray(raw[year]) ? raw[year] : null;
  } catch (_) {
    return null;
  }
}

export function markTrophiesSeen(year, ids) {
  try {
    const raw = JSON.parse(localStorage.getItem(SEEN_KEY) || '{}');
    raw[year] = [...new Set([...(Array.isArray(raw[year]) ? raw[year] : []), ...ids])];
    localStorage.setItem(SEEN_KEY, JSON.stringify(raw));
  } catch (_) {}
}

export const TROPHY_COUNT = TROPHIES.length;
