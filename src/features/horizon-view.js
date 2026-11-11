import { qs, qsa } from '../lib/dom.js';
import { esc, escAttr } from '../lib/text.js';
import { clamp, uid } from '../lib/utils.js';
import { atNoon, dateFromKey, ymdKey } from '../lib/dates.js';
import { rangeLabel, horizonCountdown, habitActivityStats } from './horizon-model.js';
import { itemEnter, itemExit, modalExit, panelEnter, popoverEnter, pulse, slideIndicator, toggleHeight } from '../ui/motion.js';
import { markTrophiesSeen, progressIcon, renderPaintedYear, renderPaintLegend, renderStreakStats, renderTrophyRoom } from './progress-view.js';
import { createYearPlan, defaultPlanYear, isHorizonMostlyEmpty, planYearOptions } from './year-plan.js';
import { createYearReview, defaultReviewYear, inReviewSeason } from './year-review.js';
import { defaultCheckInQuarter, parseQuarterKey, quarterSeasonCard, renderQuarterMenuItem } from './quarter-review.js';
import { createQuarterReview } from './quarter-session.js';
import { choosePaint, readPaint, renderPaintChooser, syncPaint } from './paint-palettes.js';
import { buildYearShareModel, canShare } from './share-image.js';
import { openShareDialog } from './share-dialog.js';
import { backLayers } from '../ui/back-stack.js';

/**
 * Horizon view: the strategic layer rendered as six sections behind a section
 * rail (Overview, Misogi, Mini-adventures, Commitments, Winning habits, Year
 * map) plus one "Add" chooser for every kind of Horizon element.
 *
 * Data ownership is unchanged: app.js normalizes and persists the year data,
 * owns the shared popovers, and passes them in through `ctx`. This module only
 * renders the active section and binds its interactions.
 */

const SECTIONS = [
  { id: 'overview', label: 'Overview', icon: 'compass' },
  { id: 'misogi', label: 'Misogi', icon: 'mountain' },
  { id: 'adventures', label: 'Mini-adventures', icon: 'flag' },
  { id: 'commitments', label: 'Commitments', icon: 'heart' },
  { id: 'habits', label: 'Winning habits', icon: 'repeat' },
  { id: 'yearmap', label: 'Year map', icon: 'calendar' },
  { id: 'progress', label: 'Progress', icon: 'trophy' }
];
const CREDIT_URL = 'https://jesseitzler.com/';
const SECTION_IDS = SECTIONS.map(item => item.id);
const KIND_LABELS = { misogi: 'Misogi', milestone: 'Milestone', adventure: 'Mini-adventure', keydate: 'Key date' };
const KIND_ORDER = { misogi: 0, milestone: 1, adventure: 2, keydate: 3 };
const MAX_ADVENTURES = 6;
const MAX_MILESTONES = 5;
const COMMITMENT_PLACEHOLDERS = ['Something worth making room for', 'Another thing that matters', 'One more, if it truly matters'];

const ICONS = {
  compass: '<circle cx="12" cy="12" r="8.5"/><path d="m14.8 9.2-1.7 3.9-3.9 1.7 1.7-3.9 3.9-1.7Z"/>',
  mountain: '<path d="M2.5 19.5h19"/><path d="m4.5 19.5 6-10.5 4.2 7.2"/><path d="m12.8 13.2 2.6-4.2 5.1 10.5"/>',
  flag: '<path d="M5.5 21V3.5"/><path d="M5.5 4.5h12l-2.3 4 2.3 4h-12"/>',
  heart: '<path d="M12 20s-7.5-4.4-7.5-10.1A4.4 4.4 0 0 1 12 7.2a4.4 4.4 0 0 1 7.5 2.7C19.5 15.6 12 20 12 20Z"/>',
  repeat: '<path d="M16.5 3 20 6.5 16.5 10"/><path d="M4 11.5V10a3.5 3.5 0 0 1 3.5-3.5H20"/><path d="M7.5 21 4 17.5 7.5 14"/><path d="M20 12.5V14a3.5 3.5 0 0 1-3.5 3.5H4"/>',
  calendar: '<path d="M7 3v3M17 3v3M4 9h16M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z"/><path d="M8 13h.01M12 13h.01M16 13h.01M8 16.5h.01M12 16.5h.01"/>',
  pin: '<path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11Z"/><circle cx="12" cy="10" r="2.3"/>',
  diamond: '<path d="m12 3.5 8.5 8.5-8.5 8.5L3.5 12Z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  close: '<path d="m7 7 10 10M17 7 7 17"/>',
  chevronLeft: '<path d="m15 18-6-6 6-6"/>',
  chevronRight: '<path d="m9 18 6-6-6-6"/>',
  chevronDown: '<path d="m8 10 4 4 4-4"/>',
  arrowRight: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  check: '<path d="m6.5 12.5 3.3 3.3 7.7-8"/>',
  trophy: '<path d="M8 4h8v5a4 4 0 0 1-8 0V4Z"/><path d="M8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8.5 20.5h7M9.5 17h5v3.5h-5z"/>',
  printer: '<path d="M7 8V4h10v4M7 17H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2h-2M7 14h10v6H7z"/>',
  sparkle: '<path d="M12 3.5c.5 3.9 2.6 6 6.5 6.5-3.9.5-6 2.6-6.5 6.5-.5-3.9-2.6-6-6.5-6.5 3.9-.5 6-2.6 6.5-6.5Z"/><path d="M18.5 15.5c.2 1.5 1 2.3 2.5 2.5-1.5.2-2.3 1-2.5 2.5-.2-1.5-1-2.3-2.5-2.5 1.5-.2 2.3-1 2.5-2.5Z"/>',
  history: '<path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1"/><path d="M3.5 4.5v4h4"/><path d="M12 7.5V12l3 2"/>',
  review: '<path d="M5 4.5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-13a1 1 0 0 1 1-1Z"/><path d="M8 9h3M8 12.5h3M8 16h3"/><path d="M14 9h2M14 12.5h2M14 16h2"/>',
  share: '<path d="M12 3.8v10.7"/><path d="m8.2 7.4 3.8-3.6 3.8 3.6"/><path d="M8.6 10.6H7.2a2 2 0 0 0-2 2v5.6a2 2 0 0 0 2 2h9.6a2 2 0 0 0 2-2v-5.6a2 2 0 0 0-2-2h-1.4"/>'
};

const icon = (name, className = '') => `<svg${className ? ` class="${className}"` : ''} viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`;

function ring(progress, size = 18) {
  const value = clamp(Number(progress) || 0, 0, 1);
  const radius = (size - 3) / 2;
  const length = 2 * Math.PI * radius;
  const center = size / 2;
  return `<svg class="hz-ring${value >= 1 ? ' is-complete' : ''}" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" aria-hidden="true"><circle class="hz-ring__track" cx="${center}" cy="${center}" r="${radius}"/><circle class="hz-ring__value" cx="${center}" cy="${center}" r="${radius}" stroke-dasharray="${length.toFixed(2)}" stroke-dashoffset="${(length * (1 - value)).toFixed(2)}" transform="rotate(-90 ${center} ${center})"/></svg>`;
}

const pad = value => String(value).padStart(2, '0');
const monthKey = (year, month) => `${year}-${pad(month + 1)}`;
const daysIn = (year, month) => new Date(year, month + 1, 0).getDate();
const monthName = (year, month, style = 'short') => new Date(year, month, 1).toLocaleDateString(undefined, { month: style });

/** Pure derivation of everything the sections display for one year. */
export function buildHorizonModel(data, year, keyDates, todayInput = new Date()) {
  const today = atNoon(todayInput);
  const todayKey = ymdKey(today);
  const currentYear = today.getFullYear();
  const events = [];
  if (data.misogi.trim() && data.misogiStartDate) events.push({ kind: 'misogi', id: 'misogi', text: data.misogi.trim(), startDate: data.misogiStartDate, endDate: data.misogiEndDate || data.misogiStartDate, done: !!data.misogiDone });
  data.misogiMilestones.filter(item => item.text?.trim() && item.date).forEach(item => events.push({ kind: 'milestone', id: item.id, text: item.text.trim(), startDate: item.date, endDate: item.date, done: !!item.done }));
  data.miniAdventures.filter(item => item.text?.trim() && item.startDate).forEach(item => events.push({ kind: 'adventure', id: item.id, text: item.text.trim(), startDate: item.startDate, endDate: item.endDate || item.startDate, done: !!item.done || item.status === 'done' }));
  keyDates.filter(item => item.text?.trim()).forEach(item => events.push({ kind: 'keydate', id: item.id, ownerMonth: item.ownerMonth, text: item.text.trim(), startDate: item.startDate, endDate: item.endDate || item.startDate, done: false }));
  events.sort((a, b) => a.startDate.localeCompare(b.startDate) || (KIND_ORDER[a.kind] ?? 9) - (KIND_ORDER[b.kind] ?? 9));

  const yearStart = atNoon(new Date(year, 0, 1));
  const daysInYear = Math.round((atNoon(new Date(year, 11, 31)) - yearStart) / 86400000) + 1;
  const isCurrentYear = year === currentYear;
  const isPastYear = year < currentYear;
  const dayOfYear = isCurrentYear ? Math.round((today - yearStart) / 86400000) + 1 : isPastYear ? daysInYear : 0;
  const cutoff = isCurrentYear ? todayKey : `${year}-01-01`;
  const upcoming = isPastYear ? [] : events.filter(event => !event.done && event.endDate >= cutoff);

  const milestones = data.misogiMilestones.filter(item => item.text.trim());
  const milestoneDone = milestones.filter(item => item.done).length;
  const adventuresNamed = data.miniAdventures.filter(item => item.text.trim());
  const adventuresPlanned = adventuresNamed.filter(item => item.startDate || item.done || item.status === 'done');
  const adventuresDone = adventuresNamed.filter(item => item.done || item.status === 'done');
  const commitments = data.meaningful.filter(text => text.trim()).length;
  const currentQuarter = isCurrentYear ? Math.floor(today.getMonth() / 3) : isPastYear ? 3 : 0;
  const habitsSet = data.habits.filter(habit => habit.trim()).length;
  const misogiNamed = !!data.misogi.trim();

  return {
    year,
    today,
    todayKey,
    isCurrentYear,
    isPastYear,
    daysInYear,
    dayOfYear,
    yearProgress: daysInYear ? dayOfYear / daysInYear : 0,
    events,
    upcoming,
    next: upcoming[0] || null,
    misogi: {
      named: misogiNamed,
      done: !!data.misogiDone,
      milestones: milestones.length,
      milestoneDone,
      progress: !misogiNamed ? 0 : data.misogiDone ? 1 : milestones.length ? 0.15 + 0.8 * (milestoneDone / milestones.length) : 0.15
    },
    adventures: { named: adventuresNamed.length, planned: adventuresPlanned.length, done: adventuresDone.length, slots: MAX_ADVENTURES - data.miniAdventures.length },
    commitments,
    currentQuarter,
    habitsSet,
    keyDateCount: keyDates.filter(item => item.text?.trim()).length
  };
}

export function createHorizonView(ctx) {
  let section = 'overview';
  let expandedHabit = null;
  let lastYear = null;
  let resizeObserver = null;

  const modal = () => qs('[data-horizon-modal]');
  const els = () => ({ head: qs('[data-horizon-nav]'), tabs: qs('[data-horizon-tabs]'), content: qs('[data-horizon-content]'), scroll: qs('[data-horizon-scroll]') });
  const year = () => ctx.getYear();
  const data = () => ctx.yearData(year());
  const persist = () => ctx.persist();
  const isNarrow = () => innerWidth <= 790;
  let activeOverlay = null;

  // ---------------------------------------------------------------------------
  // Header and section rail
  // ---------------------------------------------------------------------------

  function renderHead(model) {
    const { head } = els();
    if (!head) return;
    const minYear = ctx.minYear();
    const progress = model.isCurrentYear
      ? `<div class="hz-head__progress" role="img" aria-label="${escAttr(`Day ${model.dayOfYear} of ${model.daysInYear}`)}"><div class="hz-meter"><span style="width:${(model.yearProgress * 100).toFixed(1)}%"></span></div><small>Day ${model.dayOfYear} · ${model.daysInYear - model.dayOfYear} days left</small></div>`
      : `<div class="hz-head__progress"><small>${model.isPastYear ? 'Looking back' : 'Planning ahead'}</small></div>`;
    head.innerHTML = `<div class="hz-head__identity">
        <span class="hz-head__eyebrow">${icon('compass')}Horizon</span>
        <div class="hz-head__year">
          <button class="icon-button hz-year-step" type="button" data-horizon-prev aria-label="Previous year" ${year() <= minYear ? 'disabled' : ''}>${icon('chevronLeft')}</button>
          <h2 id="horizon-title"><span class="sr-only">Horizon </span>${year()}</h2>
          <button class="icon-button hz-year-step" type="button" data-horizon-next aria-label="Next year">${icon('chevronRight')}</button>
        </div>
      </div>
      ${progress}
      <div class="hz-head__actions">
        <button class="hz-plan-button" type="button" data-horizon-plan aria-label="Plan your year" data-tooltip="A guided session, about 30 minutes">${icon('sparkle')}<span>Plan your year</span></button>
        <button class="icon-button hz-print-button" type="button" data-horizon-print aria-label="${escAttr(`Print ${year()} on one page`)}" data-tooltip="Print the year" data-tooltip-key="P">${icon('printer')}</button>
        <button class="hz-add-button" type="button" data-horizon-add aria-haspopup="menu" aria-expanded="false">${icon('plus')}<span>Add</span></button>
      </div>`;
  }

  function sectionMeta(model, id) {
    const d = data();
    if (id === 'overview') return { meta: model.isCurrentYear ? `${Math.round(model.yearProgress * 100)}% of the year` : model.isPastYear ? 'Year in review' : 'Year ahead', progress: model.yearProgress };
    if (id === 'misogi') return { meta: !model.misogi.named ? 'Not named yet' : model.misogi.done ? 'Completed' : model.misogi.milestones ? `${model.misogi.milestoneDone}/${model.misogi.milestones} milestones` : 'Named', progress: model.misogi.progress };
    if (id === 'adventures') return { meta: `${model.adventures.planned} of ${MAX_ADVENTURES} planned`, progress: model.adventures.planned / MAX_ADVENTURES };
    if (id === 'commitments') return { meta: `${model.commitments} of 3 written`, progress: model.commitments / 3 };
    if (id === 'habits') {
      if (!model.isCurrentYear) return { meta: `${model.habitsSet} of 4 quarters`, progress: model.habitsSet / 4 };
      const habit = d.habits[model.currentQuarter]?.trim();
      const stats = habit ? habitActivityStats(d, model.currentQuarter, year()) : null;
      const kept = stats && (stats.done > 0 || stats.elapsed > 1) ? `${stats.percent}% kept` : 'just started';
      return { meta: habit ? `Q${model.currentQuarter + 1} · ${kept}` : `Q${model.currentQuarter + 1} · not chosen`, progress: model.habitsSet / 4 };
    }
    if (id === 'progress') {
      const progress = ctx.progress(year());
      return { meta: progress.streak.current > 1 ? `${progress.streak.current}-day streak` : `${progress.closed} day${progress.closed === 1 ? '' : 's'} closed`, progress: progress.unlocked.length / progress.trophies.length };
    }
    return { meta: model.events.length === 1 ? '1 date' : `${model.events.length} dates`, progress: null };
  }

  function renderTabs(model, { animate = false } = {}) {
    const { tabs } = els();
    if (!tabs) return;
    if (tabs.dataset.built !== 'true') {
      tabs.innerHTML = `<div class="hz-tabs__list" role="tablist" aria-label="Horizon sections"><span class="hz-tabs__indicator" aria-hidden="true"></span>${SECTIONS.map((item, index) => `<button class="hz-tab" type="button" role="tab" id="horizon-tab-${item.id}" aria-controls="horizon-panel" data-horizon-section="${item.id}" data-shortcut="${index + 1}">
          <span class="hz-tab__icon">${icon(item.icon)}</span>
          <span class="hz-tab__text"><strong>${esc(item.label)}</strong><small data-horizon-tab-meta></small></span>
          <span class="hz-tab__ring" data-horizon-tab-ring></span>
        </button>`).join('')}</div><p class="hz-tabs__hint">Press <kbd>1</kbd>–<kbd>7</kbd> to switch sections, <kbd>+</kbd> to add and <kbd>P</kbd> to print the year.</p><p class="hz-tabs__credit">Misogi, mini-adventures and winning habits: a yearly rhythm we owe to <a href="${CREDIT_URL}" target="_blank" rel="noopener">Jesse Itzler</a>.</p>`;
      tabs.dataset.built = 'true';
      resizeObserver?.disconnect?.();
      if (typeof ResizeObserver === 'function') {
        resizeObserver = new ResizeObserver(() => positionIndicator(false));
        resizeObserver.observe(qs('.hz-tabs__list', tabs));
      }
    }
    qs('.hz-tabs__list', tabs)?.setAttribute('aria-orientation', isNarrow() ? 'horizontal' : 'vertical');
    SECTIONS.forEach(item => {
      const tab = qs(`[data-horizon-section="${item.id}"]`, tabs);
      if (!tab) return;
      const active = item.id === section;
      const { meta, progress } = sectionMeta(model, item.id);
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
      tab.classList.toggle('is-active', active);
      qs('[data-horizon-tab-meta]', tab).textContent = meta;
      qs('[data-horizon-tab-ring]', tab).innerHTML = progress == null ? '' : ring(progress);
      tab.dataset.shortcut = String(SECTION_IDS.indexOf(item.id) + 1);
    });
    positionIndicator(animate);
  }

  function positionIndicator(animate) {
    const tabs = els().tabs;
    const indicator = qs('.hz-tabs__indicator', tabs);
    const active = qs('.hz-tab.is-active', tabs);
    if (!indicator || !active || !active.offsetWidth) return;
    slideIndicator(indicator, active, { animateMove: animate });
    if (isNarrow()) {
      const list = active.parentElement;
      const left = active.offsetLeft - 16;
      const right = active.offsetLeft + active.offsetWidth + 16;
      if (left < list.scrollLeft) list.scrollTo({ left, behavior: animate ? 'smooth' : 'auto' });
      else if (right > list.scrollLeft + list.clientWidth) list.scrollTo({ left: right - list.clientWidth, behavior: animate ? 'smooth' : 'auto' });
    }
  }

  // ---------------------------------------------------------------------------
  // Shared fragments
  // ---------------------------------------------------------------------------

  function sectionHead(eyebrow, title, description, aside = '') {
    return `<header class="hz-section-head"><div><span class="hz-eyebrow">${esc(eyebrow)}</span><h3>${esc(title)}</h3>${description ? `<p>${esc(description)}</p>` : ''}</div>${aside}</header>`;
  }

  function dateChip(attr, id, startKey, endKey, emptyLabel = 'Choose dates', label = 'Choose dates') {
    const value = startKey ? rangeLabel(startKey, endKey) : emptyLabel;
    return `<button class="hz-date-chip${startKey ? ' has-value' : ''}" type="button" ${attr}="${escAttr(id)}" aria-label="${escAttr(`${label}${startKey ? ` (currently ${value})` : ''}`)}">${icon('calendar')}<span>${esc(value)}</span></button>`;
  }

  function eventButton(event, variant = 'row') {
    const countdown = horizonCountdown(event.startDate, event.endDate === event.startDate ? '' : event.endDate, event.done);
    const attrs = `data-horizon-year-event="${escAttr(event.kind)}" data-event-id="${escAttr(event.id)}" data-owner-month="${Number.isInteger(event.ownerMonth) ? event.ownerMonth : ''}"`;
    if (variant === 'next') {
      const start = dateFromKey(event.startDate);
      return `<button type="button" class="hz-next-item hz-kind--${event.kind}" ${attrs}>
        <span class="hz-next-item__date"><strong>${start.getDate()}</strong><small>${esc(start.toLocaleDateString(undefined, { month: 'short' }))}</small></span>
        <span class="hz-next-item__copy"><strong>${esc(event.text)}</strong><small><i class="hz-dot"></i>${esc(KIND_LABELS[event.kind])} · ${esc(rangeLabel(event.startDate, event.endDate === event.startDate ? '' : event.endDate))}</small></span>
        <em>${esc(countdown)}</em>
      </button>`;
    }
    return `<button type="button" class="hz-event hz-kind--${event.kind}${event.done ? ' is-done' : ''}" ${attrs}><i class="hz-dot"></i><strong>${esc(event.text)}</strong><small><time>${esc(rangeLabel(event.startDate, event.endDate === event.startDate ? '' : event.endDate))}</time> · ${esc(KIND_LABELS[event.kind])}${event.done ? ' · Done' : ''}</small></button>`;
  }

  // ---------------------------------------------------------------------------
  // Overview
  // ---------------------------------------------------------------------------

  function renderRibbon(model) {
    const y = year();
    const d = data();
    const position = key => {
      const index = Math.round((dateFromKey(key) - atNoon(new Date(y, 0, 1))) / 86400000);
      return clamp(index / model.daysInYear * 100, 0, 100);
    };
    const span = event => {
      const left = position(event.startDate);
      const right = clamp(position(event.endDate) + 100 / model.daysInYear, 0, 100);
      return { left, width: Math.max(right - left, 0) };
    };
    const marker = (event, shape) => {
      const { left, width } = span(event);
      const isRange = event.endDate !== event.startDate && shape !== 'diamond';
      const tip = `${event.text} · ${rangeLabel(event.startDate, event.endDate === event.startDate ? '' : event.endDate)}${event.done ? ' · Done' : ''}`;
      const style = isRange ? `left:${left.toFixed(3)}%;width:${width.toFixed(3)}%` : `left:${(left + width / 2).toFixed(3)}%`;
      return `<button type="button" class="hz-marker hz-marker--${shape} hz-kind--${event.kind}${isRange ? ' is-range' : ''}${event.done ? ' is-done' : ''}" style="${style}" data-horizon-year-event="${escAttr(event.kind)}" data-event-id="${escAttr(event.id)}" data-owner-month="${Number.isInteger(event.ownerMonth) ? event.ownerMonth : ''}" data-tooltip="${escAttr(tip)}" aria-label="${escAttr(`${KIND_LABELS[event.kind]}: ${tip}`)}"></button>`;
    };
    const lane = (label, kinds, empty) => {
      const items = model.events.filter(event => kinds.includes(event.kind));
      return `<div class="hz-ribbon__lane"><span class="hz-ribbon__label">${esc(label)}</span><div class="hz-ribbon__track">${items.map(event => marker(event, event.kind === 'milestone' ? 'diamond' : event.kind === 'keydate' ? 'dot' : 'band')).join('') || `<span class="hz-ribbon__empty">${esc(empty)}</span>`}</div></div>`;
    };
    const months = Array.from({ length: 12 }, (_, month) => `<span class="${model.isCurrentYear && month === model.today.getMonth() ? 'is-current' : ''}">${esc(monthName(y, month))}</span>`).join('');
    const quarterDays = [0, 1, 2, 3].map(q => [0, 1, 2].reduce((sum, offset) => sum + daysIn(y, q * 3 + offset), 0));
    const quarters = quarterDays.map((_, q) => {
      const habit = d.habits[q]?.trim();
      return `<span class="${model.isCurrentYear && q === model.currentQuarter ? 'is-current' : ''}"><b>Q${q + 1}</b>${habit ? esc(habit) : '<em>No habit</em>'}</span>`;
    }).join('');
    const columns = Array.from({ length: 12 }, (_, month) => `${daysIn(y, month)}fr`).join(' ');
    const today = model.isCurrentYear ? `<span class="hz-ribbon__today" style="left:${position(model.todayKey).toFixed(3)}%"><span>Today</span></span>` : '';
    return `<section class="hz-card hz-ribbon" aria-label="${escAttr(`${y} at a glance`)}">
      <header class="hz-card__head"><div><span class="hz-eyebrow">Year at a glance</span><h3>${model.events.length ? 'Everything that gives the year its shape.' : 'An open year — give it something to look forward to.'}</h3></div>
        <ul class="hz-legend" aria-hidden="true"><li class="hz-kind--misogi">Misogi</li><li class="hz-kind--milestone">Milestone</li><li class="hz-kind--adventure">Adventure</li><li class="hz-kind--keydate">Key date</li></ul></header>
      <div class="hz-ribbon__scroller"><div class="hz-ribbon__body">
        <div class="hz-ribbon__lane hz-ribbon__lane--axis"><span class="hz-ribbon__label"></span><div class="hz-ribbon__months" style="grid-template-columns:${columns}">${months}</div></div>
        <div class="hz-ribbon__plot">
          ${lane('Misogi', ['misogi', 'milestone'], 'Not on the calendar yet')}
          ${lane('Adventures', ['adventure'], 'No adventures planned')}
          ${lane('Key dates', ['keydate'], 'No key dates yet')}
          <div class="hz-ribbon__lane hz-ribbon__lane--quarters"><span class="hz-ribbon__label">Habits</span><div class="hz-ribbon__quarters" style="grid-template-columns:${quarterDays.map(days => `${days}fr`).join(' ')}">${quarters}</div></div>
          <div class="hz-ribbon__overlay" aria-hidden="true"><span class="hz-ribbon__label"></span><div class="hz-ribbon__grid" style="grid-template-columns:${columns}">${'<i></i>'.repeat(12)}</div></div>
          <div class="hz-ribbon__today-wrap"><span class="hz-ribbon__label"></span><div>${today}</div></div>
        </div>
      </div></div>
    </section>`;
  }

  /** Timely prompts on the Overview: plan a mostly empty year, review the year in December–January. */
  function renderSeasonCards(model) {
    const today = new Date();
    const y = year();
    const cards = [];
    let planYear = null;
    if (!model.isPastYear && planYearOptions(today).includes(y) && isHorizonMostlyEmpty(data(), model.keyDateCount)) planYear = y;
    else if (y === today.getFullYear() && defaultPlanYear(today) > y) {
      const next = defaultPlanYear(today);
      if (isHorizonMostlyEmpty(ctx.yearData(next), ctx.keyDates(next).filter(item => item.text?.trim()).length)) planYear = next;
    }
    if (planYear) {
      cards.push(`<button type="button" class="hz-card hz-season-card hz-season-card--plan" data-horizon-plan="${planYear}">
        <span class="hz-season-card__icon">${icon('sparkle')}</span>
        <span class="hz-season-card__copy"><span class="hz-eyebrow">Plan your year</span><strong>Give ${planYear} a shape in about 30 minutes.</strong><small>One hard thing, six adventures, three commitments, a habit per quarter and the dates that matter, then your year on one page.</small></span>
        ${icon('arrowRight', 'hz-tile__arrow')}
      </button>`);
    }
    if (inReviewSeason(today) && (y === today.getFullYear() || y === defaultReviewYear(today))) {
      const reviewYear = defaultReviewYear(today);
      cards.push(`<button type="button" class="hz-card hz-season-card hz-season-card--review" data-horizon-review="${reviewYear}">
        <span class="hz-season-card__icon">${icon('review')}</span>
        <span class="hz-season-card__copy"><span class="hz-eyebrow">Year in review</span><strong>Your ${reviewYear} in review</strong><small>Days closed, the painted year, where the time went, adventures lived and a few memories, on one page.</small></span>
        ${icon('arrowRight', 'hz-tile__arrow')}
      </button>`);
    }
    // Quarter check-in (quarter-review.js): from two weeks before a quarter ends to four weeks after, on its own row.
    const quarter = quarterSeasonCard({ today, shownYear: y, yearData: ctx.yearData, progress: ctx.progress, icon });
    return cards.length || quarter ? `<div class="hz-season${cards.length > 1 ? ' hz-season--pair' : ''}">${cards.join('')}${quarter}</div>` : '';
  }

  function renderOverview(model) {
    const d = data();
    const y = year();
    const nextList = model.isPastYear
      ? model.events.slice(0, 4)
      : model.upcoming.slice(0, 4);
    const nextTitle = model.isPastYear ? `What shaped ${y}` : 'Next on the horizon';
    const next = `<section class="hz-card hz-next">
      <header class="hz-card__head"><div><span class="hz-eyebrow">${esc(nextTitle)}</span></div></header>
      ${nextList.length ? `<div class="hz-next__list">${nextList.map(event => eventButton(event, 'next')).join('')}</div>` : `<div class="hz-empty"><p>${model.isPastYear ? 'Nothing was placed on this year.' : 'Nothing dated yet. A key date or an adventure gives the year something to anticipate.'}</p><button type="button" class="hz-inline-cta" data-horizon-add-kind="keydate">${icon('plus')}Add a key date</button></div>`}
    </section>`;

    const misogiTile = model.misogi.named
      ? `<strong class="hz-tile__title">${esc(d.misogi.trim())}</strong>
         <span class="hz-tile__meta">${esc(d.misogiStartDate ? `${rangeLabel(d.misogiStartDate, d.misogiEndDate)} · ${horizonCountdown(d.misogiStartDate, d.misogiEndDate, d.misogiDone)}` : 'No dates yet')}</span>
         ${model.misogi.milestones ? `<span class="hz-tile__progress"><span class="hz-meter"><span style="width:${(model.misogi.milestoneDone / model.misogi.milestones * 100).toFixed(0)}%"></span></span><small>${model.misogi.milestoneDone}/${model.misogi.milestones} milestones</small></span>` : '<span class="hz-tile__hint">Add 3–5 milestones that prove progress</span>'}`
      : '<strong class="hz-tile__title is-empty">Name the one hard thing that will define this year.</strong><span class="hz-tile__hint">Start here</span>';

    const slots = Array.from({ length: MAX_ADVENTURES }, (_, index) => {
      const item = d.miniAdventures[index];
      const state = !item || !item.text.trim() ? 'empty' : (item.done || item.status === 'done') ? 'done' : item.startDate ? 'planned' : 'idea';
      return `<i class="hz-slot-dot is-${state}" title="${escAttr(item?.text || 'Open slot')}"></i>`;
    }).join('');
    const nextAdventure = model.upcoming.find(event => event.kind === 'adventure');
    const adventuresTile = `<span class="hz-slot-dots" aria-hidden="true">${slots}</span>
      <strong class="hz-tile__title${model.adventures.named ? '' : ' is-empty'}">${model.adventures.named ? `${model.adventures.planned} of ${MAX_ADVENTURES} on the calendar` : 'Six experiences that break the routine.'}</strong>
      <span class="hz-tile__meta">${nextAdventure ? esc(`Next: ${nextAdventure.text} · ${horizonCountdown(nextAdventure.startDate, nextAdventure.endDate, false)}`) : model.adventures.named > model.adventures.planned ? `${model.adventures.named - model.adventures.planned} still waiting for dates` : model.adventures.done ? `${model.adventures.done} lived so far` : 'Small enough to happen, different enough to remember.'}</span>`;

    const commitmentsTile = `<span class="hz-tile__list">${d.meaningful.map((text, index) => `<span class="${text.trim() ? '' : 'is-empty'}"><b>${index + 1}</b>${text.trim() ? esc(text.trim()) : 'Not written yet'}</span>`).join('')}</span>`;

    let habitsTile;
    if (model.isCurrentYear) {
      const quarter = model.currentQuarter;
      const habit = d.habits[quarter]?.trim();
      const stats = habit ? habitActivityStats(d, quarter, y) : null;
      const recent = stats ? stats.days.slice(-14) : [];
      const started = stats && (stats.done > 0 || stats.elapsed > 1);
      habitsTile = habit
        ? `<strong class="hz-tile__title">${esc(habit)}</strong>
           ${started ? `<span class="hz-tile__stats"><b>${stats.percent}%</b><small>kept · ${stats.longest}d best streak</small></span>` : '<span class="hz-tile__meta">Tracking started — check it off when you close the day.</span>'}
           <span class="hz-spark" aria-hidden="true">${recent.map(day => `<i class="${day.done ? 'is-done' : ''}"></i>`).join('')}</span>`
        : `<strong class="hz-tile__title is-empty">Choose one practice for Q${quarter + 1}.</strong><span class="hz-tile__hint">One habit, checked when you close the day</span>`;
    } else {
      habitsTile = `<span class="hz-tile__list hz-tile__list--quarters">${d.habits.map((habit, index) => `<span class="${habit.trim() ? '' : 'is-empty'}"><b>Q${index + 1}</b>${habit.trim() ? esc(habit.trim()) : 'Not chosen'}</span>`).join('')}</span>`;
    }

    const tile = (id, label, body, iconName) => `<button type="button" class="hz-tile hz-tile--${id}" data-horizon-goto="${id}">
        <span class="hz-tile__head"><span class="hz-tile__icon">${icon(iconName)}</span><span class="hz-eyebrow">${esc(label)}</span>${icon('arrowRight', 'hz-tile__arrow')}</span>
        ${body}
      </button>`;

    const progress = ctx.progress(y);
    const nextTrophy = progress.nextUp[0];
    const progressCard = `<button type="button" class="hz-card hz-progress-card" data-horizon-goto="progress">
        <span class="hz-progress-card__copy">
          <span class="hz-eyebrow">Your year, day by day</span>
          <strong>${progress.closed ? `${progress.closed} day${progress.closed === 1 ? '' : 's'} painted` : 'Close a day to paint your first square'}</strong>
          <span class="hz-progress-card__meta"><span class="hz-progress-card__streak">${progressIcon('flame')}${progress.streak.current}-day streak</span>${progress.planningElapsed ? `<span>${progress.closeRate}% of planning days closed</span>` : ''}</span>
          <span class="hz-progress-card__trophies">${progressIcon('trophy')}<span><b>${progress.unlocked.length}</b>/${progress.trophies.length} trophies</span><span class="hz-meter"><span style="width:${Math.round((progress.unlocked.length / Math.max(1, progress.trophies.length)) * 100)}%"></span></span></span>
          ${nextTrophy ? `<span class="hz-progress-card__next">Next · ${esc(nextTrophy.title)} <em>${nextTrophy.value}/${nextTrophy.target}</em></span>` : ''}
        </span>
        ${renderPaintedYear(progress, { compact: true })}
        ${icon('arrowRight', 'hz-tile__arrow')}
      </button>`;
    return `<div class="hz-overview">
      ${renderSeasonCards(model)}
      ${renderRibbon(model)}
      ${progressCard}
      <div class="hz-overview__grid">
        ${next}
        <div class="hz-tiles">
          ${tile('misogi', 'Misogi', misogiTile, 'mountain')}
          ${tile('adventures', 'Mini-adventures', adventuresTile, 'flag')}
          ${tile('commitments', 'Commitments', commitmentsTile, 'heart')}
          ${tile('habits', model.isCurrentYear ? `Winning habit · Q${model.currentQuarter + 1}` : 'Winning habits', habitsTile, 'repeat')}
        </div>
      </div>
    </div>`;
  }

  // ---------------------------------------------------------------------------
  // Misogi
  // ---------------------------------------------------------------------------

  function renderMisogi(model) {
    const d = data();
    const countdown = horizonCountdown(d.misogiStartDate, d.misogiEndDate, d.misogiDone);
    const rows = d.misogiMilestones.map((item, index) => `<div class="hz-milestone${item.done ? ' is-done' : ''}" data-milestone-id="${escAttr(item.id)}">
        <span class="hz-milestone__index" aria-hidden="true">${index + 1}</span>
        <input class="check" type="checkbox" data-milestone-done="${escAttr(item.id)}" ${item.done ? 'checked' : ''} aria-label="Mark milestone complete">
        <input class="hz-milestone__input" type="text" data-milestone-text="${escAttr(item.id)}" value="${escAttr(item.text)}" placeholder="A proof point that shows real progress" maxlength="180">
        ${dateChip('data-milestone-date', item.id, item.date, '', 'Date', 'Choose milestone date')}
        <button type="button" class="task-action hz-row-remove" data-milestone-remove="${escAttr(item.id)}" aria-label="Remove milestone" data-tooltip="Remove">${icon('close')}</button>
      </div>`).join('');
    const remaining = MAX_MILESTONES - d.misogiMilestones.length;
    const progress = model.misogi.milestones ? `<div class="hz-progress"><span>${model.misogi.milestoneDone} of ${model.misogi.milestones} done</span><span class="hz-meter"><span style="width:${(model.misogi.milestoneDone / model.misogi.milestones * 100).toFixed(0)}%"></span></span></div>` : '';
    return `${sectionHead('Misogi', 'Your year-defining challenge.', 'One hard thing — physical, creative or personal — that makes the year unmistakably yours.')}
      <p class="hz-credit">The Misogi as a yearly challenge, the mini-adventures and the winning habits come from <a href="${CREDIT_URL}" target="_blank" rel="noopener">Jesse Itzler</a>’s way of designing a year. All credit to him — Daily Planner is an independent tool and is not affiliated with him.</p>
      <article class="hz-card hz-misogi${d.misogiDone ? ' is-done' : ''}">
        <div class="hz-misogi__entry">
          <input class="check" type="checkbox" data-misogi-done ${d.misogiDone ? 'checked' : ''} aria-label="Mark Misogi complete">
          <textarea rows="1" data-horizon-misogi placeholder="What will stretch you beyond your usual limits?" maxlength="240">${esc(d.misogi)}</textarea>
          <button class="task-action" type="button" data-misogi-clear aria-label="Clear Misogi" data-tooltip="Clear" ${d.misogi.trim() || d.misogiStartDate ? '' : 'hidden'}>${icon('close')}</button>
        </div>
        ${String(d.misogiWhy || '').trim() ? `<label class="hz-misogi__why"><span>Why it matters</span><input type="text" data-horizon-misogi-why value="${escAttr(d.misogiWhy)}" maxlength="200"></label>` : ''}
        <div class="hz-misogi__meta">
          ${dateChip('data-misogi-period', 'misogi', d.misogiStartDate, d.misogiEndDate, 'Put it on the calendar', 'Choose Misogi dates')}
          ${d.misogiStartDate || d.misogiDone ? `<span class="hz-badge${d.misogiDone ? ' is-done' : ''}">${d.misogiDone ? icon('check') : ''}${esc(countdown)}</span>` : ''}
        </div>
      </article>
      <section class="hz-card hz-milestones">
        <header class="hz-card__head"><div><span class="hz-eyebrow">Milestones</span><h4>Proof points, not a project plan.</h4></div>${progress}</header>
        ${d.misogi.trim()
          ? `<div class="hz-milestone-list">${rows}</div>${remaining > 0 ? `<button type="button" class="hz-add-row" data-add-misogi-milestone>${icon('plus')}<span>Add milestone</span><small>${remaining} left</small></button>` : ''}`
          : '<div class="hz-empty"><p>Name the challenge first. Then add 3–5 moments that would prove you are on track.</p></div>'}
      </section>`;
  }

  // ---------------------------------------------------------------------------
  // Mini-adventures
  // ---------------------------------------------------------------------------

  function renderAdventures(model) {
    const d = data();
    const cards = d.miniAdventures.map(item => {
      const done = !!item.done || item.status === 'done';
      const state = done ? 'done' : item.startDate ? 'planned' : 'idea';
      const countdown = item.startDate ? horizonCountdown(item.startDate, item.endDate, done) : '';
      return `<article class="hz-card hz-adventure is-${state}" data-mini-adventure-card="${escAttr(item.id)}">
        <div class="hz-adventure__top"><span class="hz-status hz-status--${state}">${state === 'done' ? `${icon('check')}Lived` : state === 'planned' ? 'Planned' : 'Idea'}</span>${countdown && !done ? `<span class="hz-adventure__countdown">${esc(countdown)}</span>` : ''}
          <button class="task-action hz-row-remove" type="button" data-remove-adventure="${escAttr(item.id)}" aria-label="Remove mini-adventure" data-tooltip="Remove">${icon('close')}</button></div>
        <div class="hz-adventure__title"><input class="check" type="checkbox" data-adventure-done="${escAttr(item.id)}" ${done ? 'checked' : ''} aria-label="Mark mini-adventure complete"><textarea rows="2" class="hz-adventure__input" data-adventure-text="${escAttr(item.id)}" placeholder="An experience worth protecting" maxlength="180">${esc(item.text)}</textarea></div>
        ${dateChip('data-adventure-period', item.id, item.startDate, item.endDate, 'Put it on the calendar', 'Choose mini-adventure dates')}
      </article>`;
    });
    const slots = Array.from({ length: MAX_ADVENTURES - d.miniAdventures.length }, (_, index) => `<button type="button" class="hz-slot${index === 0 ? ' is-next' : ''}" data-add-mini-adventure aria-label="Add mini-adventure">${icon('plus')}<span>${index === 0 ? 'Add mini-adventure' : `Slot ${d.miniAdventures.length + index + 1}`}</span></button>`);
    const aside = `<div class="hz-section-stat"><strong>${model.adventures.planned}<small>/${MAX_ADVENTURES}</small></strong><span>on the calendar${model.adventures.named > model.adventures.planned ? ` · ${model.adventures.named - model.adventures.planned} idea${model.adventures.named - model.adventures.planned > 1 ? 's' : ''}` : ''}</span></div>`;
    return `${sectionHead('Mini-adventures', 'Six memorable experiences, on the calendar.', 'Small enough to happen. Different enough to break the routine.', aside)}
      <div class="hz-adventures">${cards.join('')}${slots.join('')}</div>`;
  }

  // ---------------------------------------------------------------------------
  // Commitments
  // ---------------------------------------------------------------------------

  function renderCommitments() {
    const d = data();
    return `${sectionHead('Commitments', 'What would make this year meaningful?', 'Three statements worth making real — results, relationships, places or experiences. Not a second task list.')}
      <ol class="hz-commitments">${d.meaningful.map((text, index) => `<li class="hz-card hz-commitment${text.trim() ? ' is-set' : ''}" data-meaningful-row="${index}">
        <span class="hz-commitment__index" aria-hidden="true">${index + 1}</span>
        <textarea rows="1" class="hz-commitment__input" data-meaningful-text="${index}" placeholder="${escAttr(COMMITMENT_PLACEHOLDERS[index])}" maxlength="180" aria-label="${escAttr(`Commitment ${index + 1}`)}">${esc(text)}</textarea>
        <button class="task-action" type="button" data-meaningful-clear="${index}" aria-label="Clear commitment" data-tooltip="Clear" ${text.trim() ? '' : 'hidden'}>${icon('close')}</button>
      </li>`).join('')}</ol>`;
  }

  // ---------------------------------------------------------------------------
  // Winning habits
  // ---------------------------------------------------------------------------

  function renderHabitHeatmap(stats) {
    const dayMap = new Map(stats.days.map(day => [day.key, day.done]));
    const gridStart = atNoon(stats.start);
    gridStart.setDate(gridStart.getDate() - gridStart.getDay());
    const gridEnd = atNoon(stats.end);
    gridEnd.setDate(gridEnd.getDate() + (6 - gridEnd.getDay()));
    const todayKey = ymdKey(new Date());
    const cells = [];
    for (let day = atNoon(gridStart); day <= gridEnd; day.setDate(day.getDate() + 1)) {
      const key = ymdKey(day);
      const inQuarter = day >= stats.start && day <= stats.end;
      const isFuture = key > todayKey;
      const isUntracked = inQuarter && day < stats.trackingStart;
      const done = dayMap.get(key) === true;
      const cls = !inQuarter ? ' is-outside' : isFuture ? ' is-future' : isUntracked ? ' is-untracked' : done ? ' is-done' : ' is-missed';
      const label = `${day.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}${!inQuarter ? '' : isFuture ? ' · Future' : isUntracked ? ' · Not tracked' : done ? ' · Done' : ' · Not done'}`;
      cells.push(`<span class="habit-heat-cell${cls}" data-tooltip="${escAttr(label)}" aria-label="${escAttr(label)}"></span>`);
    }
    return `<div class="habit-heatmap" style="--heat-weeks:${Math.ceil(cells.length / 7)}">${cells.join('')}</div>`;
  }

  function renderHabits(model) {
    const d = data();
    const y = year();
    const todayKey = model.todayKey;
    const cards = d.habits.map((habit, index) => {
      const stats = habitActivityStats(d, index, y);
      const quarterEnded = model.isPastYear || (model.isCurrentYear && index < model.currentQuarter);
      const isCurrent = model.isCurrentYear && index === model.currentQuarter;
      const locked = quarterEnded && !habit.trim();
      const startedKey = d.habitStartedAt?.[index] || '';
      const tracked = !!habit.trim() && (stats.done > 0 || (!!startedKey && startedKey < todayKey));
      const expanded = expandedHabit === index && !!habit.trim();
      const months = `${monthName(y, index * 3)} – ${monthName(y, index * 3 + 2)}`;
      const hasStats = !!habit.trim() && (stats.done > 0 || stats.elapsed > 1 || quarterEnded);
      const body = habit.trim()
        ? (hasStats
          ? `<div class="hz-habit__stats"><span class="hz-habit__score">${ring(stats.percent / 100, 44)}<b>${stats.percent}%</b></span><dl><div><dt>Kept</dt><dd>${stats.done}/${stats.elapsed} days</dd></div><div><dt>Best streak</dt><dd>${stats.longest}d</dd></div></dl></div>
             <button type="button" class="hz-habit__toggle" data-habit-stats="${index}" aria-expanded="${expanded}"><span>${expanded ? 'Hide activity' : 'See activity'}</span>${icon('chevronDown')}</button>
             <div class="hz-habit__details" data-habit-details aria-hidden="${expanded ? 'false' : 'true'}"><div class="hz-habit__details-inner">${renderHabitHeatmap(stats)}<div class="hz-habit__metrics"><span>${stats.done} done</span><span>${stats.missed} not done</span><span>Day ${stats.quarterDay}/${stats.quarterDays}</span></div></div></div>`
          : `<p class="hz-habit__hint">${stats.elapsed ? 'Tracking started today' : 'Tracking starts when the quarter does'} — check it off when you close each day.</p>`)
        : `<p class="hz-habit__hint">${locked ? 'This quarter has passed without a habit.' : isCurrent ? 'Pick the one practice that would make this quarter a win.' : 'Choose it now or when the quarter begins.'}</p>`;
      return `<article class="hz-card hz-habit${isCurrent ? ' is-current' : ''}${quarterEnded ? ' is-past' : ''}${locked ? ' is-locked' : ''}${habit.trim() ? ' has-value' : ''}${tracked ? ' is-tracked' : ''}${expanded ? ' is-expanded' : ''}" data-habit-row="${index}">
        <header class="hz-habit__head"><span class="hz-habit__quarter">Q${index + 1}</span><span class="hz-habit__months">${esc(months)}</span>${isCurrent ? '<span class="hz-now">Now</span>' : ''}</header>
        <input type="text" class="hz-habit__input" data-habit-direct="${index}" data-habit-tracked="${tracked ? 'true' : 'false'}" value="${escAttr(habit)}" placeholder="${locked ? 'Quarter complete' : 'Choose one habit'}" maxlength="180" ${locked ? 'disabled' : ''} aria-label="${escAttr(`Winning habit for Q${index + 1}`)}">
        ${body}
      </article>`;
    }).join('');
    return `${sectionHead('Winning habits', 'One practice per quarter.', 'Keep the habit visible. Open the activity only when you need the evidence.')}
      <div class="hz-habits">${cards}</div>`;
  }

  // ---------------------------------------------------------------------------
  // Year map
  // ---------------------------------------------------------------------------

  function renderYearMap(model) {
    const y = year();
    const months = Array.from({ length: 12 }, (_, month) => {
      const start = `${monthKey(y, month)}-01`;
      const end = `${monthKey(y, month)}-${pad(daysIn(y, month))}`;
      const events = model.events.filter(event => event.startDate <= end && event.endDate >= start);
      const isCurrent = model.isCurrentYear && month === model.today.getMonth();
      const isPast = model.isPastYear || (model.isCurrentYear && month < model.today.getMonth());
      const name = monthName(y, month, 'long');
      const addLabel = `Add a key date to ${name}`;
      return `<article class="hz-month${isCurrent ? ' is-current' : ''}${isPast ? ' is-past' : ''}${events.length ? '' : ' is-empty'}" data-year-map-month="${month}">
        <header class="hz-month__head"><span class="hz-month__name">${esc(name)}</span>${events.length ? `<span class="hz-month__count">${events.length}</span>` : ''}${isCurrent ? '<span class="hz-now">Now</span>' : ''}</header>
        ${events.length ? `<div class="hz-month__events">${events.map(event => eventButton(event)).join('')}</div>` : ''}
        <button type="button" class="hz-month__add-area" data-horizon-month-add="${month}" aria-label="${escAttr(addLabel)}">${icon('plus')}<span>${events.length ? 'Add' : 'Add a key date'}</span></button>
      </article>`;
    }).join('');
    const aside = `<div class="hz-section-actions"><button type="button" class="secondary-button hz-section-action hz-section-action--quiet" data-horizon-print aria-label="${escAttr(`Print ${y} on one page`)}">${icon('printer')}<span>Print the year</span></button><button type="button" class="secondary-button hz-section-action" data-horizon-add-kind="keydate">${icon('plus')}<span>Add key date</span></button></div>`;
    return `${sectionHead('Year map', 'The moments shaping the year.', 'Misogi, milestones, adventures and key dates, month by month.', aside)}
      <div class="hz-yearmap">${months}</div>`;
  }

  // ---------------------------------------------------------------------------
  // Progress
  // ---------------------------------------------------------------------------

  function renderProgress() {
    const progress = ctx.progress(year());
    markTrophiesSeen(year(), progress.unlocked.map(trophy => trophy.id));
    const y = year();
    const reviewable = y <= new Date().getFullYear();
    const review = reviewable ? `<button type="button" class="hz-review-cta" data-horizon-review="${y}">
        <span class="hz-review-cta__icon">${icon('review')}</span>
        <span class="hz-review-cta__copy"><strong>Your ${y} in review</strong><small>One page for the year: days closed, time by category, adventures lived, memories and lessons. Printable.</small></span>
        <span class="hz-review-cta__go">Open${icon('arrowRight')}</span>
      </button>` : '';
    // “Share your year” appears once the year has a painted square.
    const share = reviewable && progress.closed ? `<div class="hz-section-actions"><button type="button" class="secondary-button hz-section-action" data-progress-share="${y}">${icon('share')}<span>Share your year</span></button></div>` : '';
    return `${sectionHead('Progress', 'Your year, painted day by day.', 'Every day you close paints a square. Rest days stay quiet, and two jokers a month protect your streak when life happens. Open any past square to revisit that day.', share)}
      ${renderStreakStats(progress)}
      <section class="hz-card hz-paint-card">
        <header class="hz-card__head"><div><span class="hz-eyebrow">${y}</span><h4>${progress.closed ? `${progress.closed} day${progress.closed === 1 ? '' : 's'} closed so far` : 'Your first square appears when you close a day.'}</h4></div>${renderPaintLegend()}</header>
        <div class="hz-paint-scroller">${renderPaintedYear(progress, { interactive: true })}</div>
      </section>
      ${review}
      ${reviewable ? ctx.insightsEntry?.(y) || '' : ''}
      ${renderPaintChooser({ current: readPaint() })}
      <section class="hz-trophies">
        <header class="hz-trophies__head"><div><span class="hz-eyebrow">Trophies</span><h3>${progress.unlocked.length} of ${progress.trophies.length} unlocked</h3><p>Earned by what you do in your life, not by time spent in the app.</p></div></header>
        ${renderTrophyRoom(progress)}
      </section>`;
  }

  // ---------------------------------------------------------------------------
  // Render + bindings
  // ---------------------------------------------------------------------------

  function render({ transition = 0 } = {}) {
    const { content } = els();
    if (!content) return;
    syncPaint();
    const model = buildHorizonModel(data(), year(), ctx.keyDates(year()));
    const yearChanged = lastYear !== null && lastYear !== year();
    lastYear = year();
    renderHead(model);
    renderTabs(model, { animate: !!transition });
    const renderers = { overview: renderOverview, misogi: renderMisogi, adventures: renderAdventures, commitments: renderCommitments, habits: renderHabits, yearmap: renderYearMap, progress: renderProgress };
    content.innerHTML = `<section class="hz-panel hz-panel--${section}" id="horizon-panel" role="tabpanel" aria-labelledby="horizon-tab-${section}" data-horizon-panel="${section}">${renderers[section](model)}</section>`;
    const panel = qs('[data-horizon-panel]', content);
    bindPanel(panel);
    revealToday(panel);
    if (transition || yearChanged) panelEnter(panel, { direction: isNarrow() && typeof transition === 'number' ? transition : 0 });
  }

  /** On narrow screens the ribbon scrolls; keep today in view rather than January. */
  function revealToday(panel = qs('[data-horizon-panel]', els().content)) {
    const scroller = qs('.hz-ribbon__scroller', panel || document.createElement('div'));
    const marker = qs('.hz-ribbon__today', scroller || document.createElement('div'));
    if (!scroller || !marker || scroller.scrollWidth <= scroller.clientWidth) return;
    const markerLeft = marker.getBoundingClientRect().left - scroller.getBoundingClientRect().left + scroller.scrollLeft;
    scroller.scrollLeft = Math.max(0, markerLeft - scroller.clientWidth * 0.6);
  }

  function setSection(next, { focus = '' } = {}) {
    const target = SECTION_IDS.includes(next) ? next : 'overview';
    const delta = Math.sign(SECTION_IDS.indexOf(target) - SECTION_IDS.indexOf(section));
    const changed = target !== section;
    section = target;
    if (changed && target === 'progress') ctx.trackOncePer?.('day', 'progress_opened');
    ctx.closeAllPopovers();
    render({ transition: changed ? delta || 1 : 0 });
    if (changed) { const scroll = els().scroll; if (scroll) scroll.scrollTop = 0; }
    if (focus) requestAnimationFrame(() => qs(focus, els().content)?.focus({ preventScroll: false }));
  }

  function addMiniAdventure() {
    const d = data();
    if (d.miniAdventures.length >= MAX_ADVENTURES) return;
    const id = uid('adventure');
    d.miniAdventures.push({ id, text: '', startDate: '', endDate: '', month: ctx.getMonth(), status: 'idea', done: false, nextStep: '' });
    persist();
    if (section !== 'adventures') setSection('adventures'); else render();
    const card = qs(`[data-mini-adventure-card="${CSS.escape(id)}"]`, els().content);
    itemEnter(card);
    requestAnimationFrame(() => qs('[data-adventure-text]', card)?.focus());
  }

  function addMilestone() {
    const d = data();
    if (!d.misogi.trim() || d.misogiMilestones.length >= MAX_MILESTONES) return;
    const id = uid('milestone');
    d.misogiMilestones.push({ id, text: '', done: false, date: '' });
    persist();
    if (section !== 'misogi') setSection('misogi'); else render();
    const row = qs(`[data-milestone-id="${CSS.escape(id)}"]`, els().content);
    itemEnter(row);
    requestAnimationFrame(() => qs('[data-milestone-text]', row)?.focus());
  }

  function defaultKeyDateStart() {
    const today = new Date();
    return year() === today.getFullYear() ? `${monthKey(year(), today.getMonth())}-01` : `${year()}-01-01`;
  }

  function addElement(kind, anchor) {
    const d = data();
    if (kind === 'keydate') { ctx.openNewKeyDate(anchor, defaultKeyDateStart(), { preselect: false }); return; }
    if (kind === 'adventure') { addMiniAdventure(); return; }
    if (kind === 'milestone') { addMilestone(); return; }
    if (kind === 'misogi') { setSection('misogi', { focus: '[data-horizon-misogi]' }); return; }
    if (kind === 'commitment') {
      const index = d.meaningful.findIndex(text => !text.trim());
      setSection('commitments', { focus: `[data-meaningful-text="${index < 0 ? 0 : index}"]` });
      return;
    }
    if (kind === 'habit') {
      const model = buildHorizonModel(d, year(), []);
      const start = model.isCurrentYear ? model.currentQuarter : 0;
      const index = d.habits.findIndex((habit, i) => i >= start && !habit.trim());
      setSection('habits', { focus: `[data-habit-direct="${index < 0 ? start : index}"]` });
    }
  }

  function openAddMenu(anchor) {
    const d = data();
    const model = buildHorizonModel(d, year(), ctx.keyDates(year()));
    const habitIndex = model.isPastYear ? -1 : d.habits.findIndex((habit, i) => i >= (model.isCurrentYear ? model.currentQuarter : 0) && !habit.trim());
    const commitmentsLeft = 3 - model.commitments;
    const options = [
      { kind: 'keydate', icon: 'pin', title: 'Key date', note: 'Birthdays, trips, dates to protect', meta: model.keyDateCount ? `${model.keyDateCount} so far` : '' },
      { kind: 'adventure', icon: 'flag', title: 'Mini-adventure', note: 'An experience that breaks routine', meta: `${model.adventures.slots} of ${MAX_ADVENTURES} left`, disabled: model.adventures.slots <= 0 && 'All six slots are used' },
      model.misogi.named
        ? { kind: 'milestone', icon: 'diamond', title: 'Milestone', note: 'Proof your Misogi is on track', meta: `${MAX_MILESTONES - d.misogiMilestones.length} left`, disabled: d.misogiMilestones.length >= MAX_MILESTONES && 'Five milestones is the limit' }
        : { kind: 'misogi', icon: 'mountain', title: 'Misogi', note: 'The challenge that defines the year', meta: 'Start here' },
      { kind: 'commitment', icon: 'heart', title: 'Commitment', note: 'What would make the year count', meta: `${commitmentsLeft} of 3 left`, disabled: commitmentsLeft <= 0 && 'All three are written' },
      { kind: 'habit', icon: 'repeat', title: 'Winning habit', note: habitIndex >= 0 ? `One practice for Q${habitIndex + 1}` : 'One practice per quarter', meta: habitIndex >= 0 ? `Q${habitIndex + 1}` : '', disabled: habitIndex < 0 && (model.isPastYear ? 'This year has ended' : 'Every remaining quarter has a habit') }
    ];
    ctx.closeAllPopovers();
    const popover = document.createElement('div');
    popover.className = 'app-popover hz-add-menu';
    popover.setAttribute('role', 'menu');
    popover.innerHTML = `<div class="hz-add-menu__head">Add to ${year()}</div>${options.map(option => `<button type="button" role="menuitem" class="hz-add-option hz-kind--${option.kind}" data-horizon-add-kind="${option.kind}" ${option.disabled ? 'disabled' : ''}>
        <span class="hz-add-option__icon">${icon(option.icon)}</span>
        <span class="hz-add-option__copy"><strong>${esc(option.title)}</strong><small>${esc(option.disabled || option.note)}</small></span>
        ${option.meta ? `<em>${esc(option.meta)}</em>` : ''}
      </button>`).join('')}${renderQuarterMenuItem({ at: defaultCheckInQuarter(new Date()) })}`;
    popover.addEventListener('keydown', event => {
      const items = qsa('.hz-add-option:not(:disabled)', popover);
      const index = items.indexOf(document.activeElement);
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const next = items[(index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length];
        next?.focus();
      }
    });
    popover.addEventListener('click', event => {
      const quarter = event.target.closest('[data-horizon-quarter]');
      if (quarter) { event.stopPropagation(); ctx.closeAllPopovers(); openQuarter(quarter.dataset.horizonQuarter); return; }
      const option = event.target.closest('[data-horizon-add-kind]');
      if (!option || option.disabled) return;
      event.stopPropagation();
      ctx.closeAllPopovers();
      addElement(option.dataset.horizonAddKind, anchor);
    });
    ctx.showPopover(anchor, popover, { width: 330, align: 'end' });
    popoverEnter(popover);
    requestAnimationFrame(() => qs('.hz-add-option:not(:disabled)', popover)?.focus({ preventScroll: true }));
  }

  function directDate(button, currentValue, fallback, onSelect) {
    if (!button) return;
    button.addEventListener('click', () => ctx.openCalendar(button, currentValue || fallback, value => { onSelect(value); persist(); render(); }, { minKey: `${year()}-01-01`, maxKey: `${year()}-12-31`, align: 'end' }));
  }

  function periodOptions() {
    return { minKey: `${year()}-01-01`, maxKey: `${year()}-12-31`, fallbackKey: `${monthKey(year(), ctx.getMonth())}-01`, align: 'end' };
  }

  function toggleHabitDetails(button, panel) {
    const card = button.closest('[data-habit-row]');
    const details = qs('[data-habit-details]', card);
    const index = Number(button.dataset.habitStats);
    const opening = !card.classList.contains('is-expanded');
    qsa('[data-habit-row].is-expanded', panel).forEach(other => {
      if (other === card) return;
      const otherDetails = qs('[data-habit-details]', other);
      toggleHeight(otherDetails, false, () => { other.classList.remove('is-expanded'); otherDetails?.setAttribute('aria-hidden', 'true'); });
      const otherButton = qs('[data-habit-stats]', other);
      otherButton?.setAttribute('aria-expanded', 'false');
      if (otherButton) qs('span', otherButton).textContent = 'See activity';
    });
    button.setAttribute('aria-expanded', String(opening));
    qs('span', button).textContent = opening ? 'Hide activity' : 'See activity';
    expandedHabit = opening ? index : null;
    if (opening) {
      card.classList.add('is-expanded');
      details?.setAttribute('aria-hidden', 'false');
      toggleHeight(details, true);
    } else {
      toggleHeight(details, false, () => { card.classList.remove('is-expanded'); details?.setAttribute('aria-hidden', 'true'); });
    }
  }

  /** Adventure titles and commitments wrap visually but are stored as one line. */
  function singleLine(field) {
    if (!/[\r\n]/.test(field.value)) return;
    const caret = field.selectionStart;
    field.value = field.value.replace(/\s*[\r\n]+\s*/g, ' ');
    field.setSelectionRange?.(Math.min(caret, field.value.length), Math.min(caret, field.value.length));
  }

  /** Arrow keys inside the painted year: ←/→ one day, ↑/↓ one month, Home/End a month's ends. */
  function moveInPaintedYear(event) {
    const current = event.target.closest('[data-progress-day]');
    if (!current || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    const grid = event.currentTarget;
    const rows = qsa('.hz-paint__row', grid).map(row => qsa('[data-progress-day]', row)).filter(row => row.length);
    const all = rows.flat();
    const rowIndex = rows.findIndex(row => row.includes(current));
    const column = rows[rowIndex].indexOf(current);
    let next = null;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') next = all[all.indexOf(current) + (event.key === 'ArrowRight' ? 1 : -1)];
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      const row = rows[rowIndex + (event.key === 'ArrowDown' ? 1 : -1)];
      next = row?.[Math.min(column, row.length - 1)];
    }
    if (event.key === 'Home') next = rows[rowIndex][0];
    if (event.key === 'End') next = rows[rowIndex][rows[rowIndex].length - 1];
    event.preventDefault();
    if (!next) return;
    current.tabIndex = -1;
    next.tabIndex = 0;
    next.focus();
  }

  function bindPanel(panel) {
    const d = data();
    const y = year();

    // Misogi
    const misogi = qs('[data-horizon-misogi]', panel);
    if (misogi) {
      ctx.autoGrow(misogi);
      misogi.addEventListener('input', () => {
        d.misogi = misogi.value;
        ctx.autoGrow(misogi);
        const clear = qs('[data-misogi-clear]', panel);
        if (clear) clear.hidden = !misogi.value.trim() && !d.misogiStartDate;
        persist();
      });
      misogi.addEventListener('change', () => render());
      misogi.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); misogi.blur(); } });
    }
    qs('[data-misogi-period]', panel)?.addEventListener('click', event => ctx.openPeriod(event.currentTarget, d.misogiStartDate, d.misogiEndDate, (startDate, endDate) => { d.misogiStartDate = startDate; d.misogiEndDate = endDate || ''; persist(); render(); }, periodOptions()));
    qs('[data-misogi-done]', panel)?.addEventListener('change', event => { d.misogiDone = event.currentTarget.checked; persist(); render(); });
    qs('[data-misogi-clear]', panel)?.addEventListener('click', () => ctx.confirm({ eyebrow: 'Clear Misogi', title: 'Clear this Misogi?', message: 'The challenge, its dates and its milestones will be removed from Horizon. Your historical daily plans are not changed.', confirmLabel: 'Clear', action: () => { d.misogi = ''; d.misogiStartDate = ''; d.misogiEndDate = ''; d.misogiDone = false; d.misogiMilestones = []; if (d.misogiWhy) d.misogiWhy = ''; persist(); render(); } }));
    qs('[data-horizon-misogi-why]', panel)?.addEventListener('input', event => { d.misogiWhy = event.currentTarget.value.replace(/[\r\n]+/g, ' '); persist(); });

    // Milestones
    qs('[data-add-misogi-milestone]', panel)?.addEventListener('click', addMilestone);
    qsa('[data-milestone-text]', panel).forEach(input => {
      input.addEventListener('input', () => { const item = d.misogiMilestones.find(x => x.id === input.dataset.milestoneText); if (item) { item.text = input.value; persist(); } });
      input.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); if (input.value.trim() && !input.closest('.hz-milestone')?.nextElementSibling) addMilestone(); else input.blur(); } });
    });
    qsa('[data-milestone-done]', panel).forEach(input => input.addEventListener('change', () => { const item = d.misogiMilestones.find(x => x.id === input.dataset.milestoneDone); if (item) { item.done = input.checked; persist(); render(); } }));
    qsa('[data-milestone-date]', panel).forEach(button => { const item = d.misogiMilestones.find(x => x.id === button.dataset.milestoneDate); if (item) directDate(button, item.date, `${monthKey(y, ctx.getMonth())}-01`, value => { item.date = value; }); });
    qsa('[data-milestone-remove]', panel).forEach(button => button.addEventListener('click', () => {
      const id = button.dataset.milestoneRemove;
      itemExit(button.closest('.hz-milestone')).then(() => { d.misogiMilestones = d.misogiMilestones.filter(x => x.id !== id); persist(); render(); });
    }));

    // Mini-adventures
    qsa('[data-add-mini-adventure]', panel).forEach(button => button.addEventListener('click', addMiniAdventure));
    qsa('[data-adventure-text]', panel).forEach(input => {
      ctx.autoGrow(input);
      input.addEventListener('input', () => { singleLine(input); const item = d.miniAdventures.find(x => x.id === input.dataset.adventureText); if (item) { item.text = input.value; ctx.autoGrow(input); persist(); } });
      input.addEventListener('change', () => render());
      input.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); input.blur(); } });
    });
    qsa('[data-adventure-done]', panel).forEach(input => input.addEventListener('change', () => { const item = d.miniAdventures.find(x => x.id === input.dataset.adventureDone); if (item) { item.done = input.checked; item.status = input.checked ? 'done' : (item.startDate ? 'planned' : 'idea'); persist(); render(); } }));
    qsa('[data-remove-adventure]', panel).forEach(button => button.addEventListener('click', () => {
      const id = button.dataset.removeAdventure;
      const item = d.miniAdventures.find(x => x.id === id);
      if (!item) return;
      const card = button.closest('[data-mini-adventure-card]');
      const remove = () => itemExit(card).then(() => { d.miniAdventures = d.miniAdventures.filter(x => x.id !== id); persist(); render(); });
      if (!item.text.trim() && !item.startDate) { remove(); return; }
      ctx.confirm({ eyebrow: 'Remove mini-adventure', title: 'Remove this mini-adventure?', message: 'It will disappear from Horizon. Existing daily plans are not changed.', confirmLabel: 'Remove', action: remove });
    }));
    qsa('[data-adventure-period]', panel).forEach(button => button.addEventListener('click', () => {
      const item = d.miniAdventures.find(x => x.id === button.dataset.adventurePeriod);
      if (!item) return;
      ctx.openPeriod(button, item.startDate, item.endDate, (startDate, endDate) => { item.startDate = startDate; item.endDate = endDate || ''; item.month = dateFromKey(startDate).getMonth(); item.status = item.done ? 'done' : 'planned'; persist(); render(); }, periodOptions());
    }));

    // Commitments
    qsa('[data-meaningful-text]', panel).forEach(input => {
      ctx.autoGrow(input);
      input.addEventListener('input', () => {
        singleLine(input);
        const index = Number(input.dataset.meaningfulText);
        d.meaningful[index] = input.value;
        ctx.autoGrow(input);
        const clear = qs(`[data-meaningful-clear="${index}"]`, panel);
        if (clear) clear.hidden = !input.value.trim();
        input.closest('.hz-commitment')?.classList.toggle('is-set', !!input.value.trim());
        persist();
      });
      input.addEventListener('change', () => renderTabs(buildHorizonModel(d, y, ctx.keyDates(y))));
      input.addEventListener('keydown', event => {
        if (event.key !== 'Enter' || event.shiftKey) return;
        event.preventDefault();
        const next = qs(`[data-meaningful-text="${Number(input.dataset.meaningfulText) + 1}"]`, panel);
        if (next) next.focus(); else input.blur();
      });
    });
    qsa('[data-meaningful-clear]', panel).forEach(button => button.addEventListener('click', () => {
      const index = Number(button.dataset.meaningfulClear);
      if (!d.meaningful[index]?.trim()) return;
      ctx.confirm({ eyebrow: 'Year commitment', title: 'Clear this commitment?', message: 'This removes the commitment from Horizon. Your daily plans are not changed.', confirmLabel: 'Clear', action: () => { d.meaningful[index] = ''; persist(); render(); } });
    }));

    // Winning habits
    qsa('[data-habit-direct]', panel).forEach(input => {
      input.addEventListener('keydown', event => { if (event.key === 'Enter') { event.preventDefault(); input.blur(); } });
      input.addEventListener('change', () => {
        const index = Number(input.dataset.habitDirect);
        const previous = d.habits[index] || '';
        const next = input.value.trim();
        if (next === previous.trim()) { input.value = previous; return; }
        const stats = habitActivityStats(d, index, y);
        const tracked = !!previous.trim() && (stats.done > 0 || stats.elapsed > 0);
        const applyReplacement = () => {
          d.habits[index] = next;
          d.habitStartedAt[index] = next ? ymdKey(new Date()) : '';
          const todayKey = ymdKey(new Date());
          if (Array.isArray(d.habitChecks?.[todayKey])) d.habitChecks[todayKey] = d.habitChecks[todayKey].filter(value => Number(value) !== index);
          persist();
          render();
        };
        if (tracked) {
          input.value = previous;
          ctx.confirm({ eyebrow: `Winning habit · Q${index + 1}`, title: 'Start tracking a different habit?', message: 'Previous check-ins stay in your saved history, but they will not count toward the new habit. Tracking for the new habit starts today.', confirmLabel: 'Start new habit', action: applyReplacement });
        } else applyReplacement();
      });
    });
    qsa('[data-habit-stats]', panel).forEach(button => button.addEventListener('click', () => toggleHabitDetails(button, panel)));

    // Year map, ribbon and next-up events
    qsa('[data-horizon-month-add]', panel).forEach(button => button.addEventListener('click', event => {
      event.stopPropagation();
      const month = clamp(Number(button.dataset.horizonMonthAdd), 0, 11);
      ctx.openNewKeyDate(button, `${monthKey(y, month)}-01`, { preselect: false });
    }));
    qsa('[data-year-map-month]', panel).forEach(card => card.addEventListener('click', event => {
      // The whole month is a target: clicking its empty space adds a key date.
      if (event.target.closest('button, a')) return;
      // Stop here, or the document's outside-click handler would close the
      // popover this click has just opened (its anchor is the inner button).
      event.stopPropagation();
      qs('[data-horizon-month-add]', card)?.click();
    }));
    qsa('[data-progress-day]', panel).forEach(button => button.addEventListener('click', () => ctx.openDay(button.dataset.progressDay)));
    qs('[data-progress-grid]', panel)?.addEventListener('keydown', moveInPaintedYear);
    qsa('[data-horizon-year-event]', panel).forEach(button => button.addEventListener('click', event => {
      event.stopPropagation();
      const kind = button.dataset.horizonYearEvent;
      if (kind === 'milestone') { setSection('misogi', { focus: `[data-milestone-text="${CSS.escape(button.dataset.eventId)}"]` }); return; }
      ctx.openEvent(button, kind, button.dataset.eventId, button.dataset.ownerMonth);
    }));

    // Overview tiles and in-panel add shortcuts
    qsa('[data-horizon-goto]', panel).forEach(button => button.addEventListener('click', () => setSection(button.dataset.horizonGoto)));
    qsa('[data-horizon-add-kind]', panel).forEach(button => button.addEventListener('click', event => { event.stopPropagation(); addElement(button.dataset.horizonAddKind, button); }));
  }

  // ---------------------------------------------------------------------------
  // The guided sessions and the review: overlays over the dialog; palettes
  // ---------------------------------------------------------------------------

  /**
   * Mount a panel over the whole Horizon dialog (the guided plan, the review).
   * Everything underneath is inert while it is open; Escape goes to `onEscape`
   * (after any open popover has closed), and single-key shortcuts go to `onKey`
   * instead of Horizon's sections.
   */
  function openOverlay({ className = '', label = '', onEscape = null, onKey = null } = {}) {
    const shell = qs('.modal__panel', modal());
    activeOverlay?.close();
    ctx.closeAllPopovers();
    const el = document.createElement('section');
    el.className = `hz-overlay${className ? ` ${className}` : ''}`;
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.setAttribute('aria-label', label);
    const siblings = [...(shell?.children || [])];
    siblings.forEach(child => child.setAttribute('inert', ''));
    shell?.append(el);
    const opener = document.activeElement;
    // The entry point is usually re-rendered while the overlay is open: focus its twin, else the active section.
    const twin = ['horizonPlan', 'horizonReview', 'horizonQuarter'].find(key => opener?.dataset?.[key] !== undefined);
    const handle = {
      el,
      onEscape,
      onKey,
      close({ restoreFocus = true } = {}) {
        if (activeOverlay !== handle) return;
        activeOverlay = null;
        backLayers.closed(handle);
        siblings.forEach(child => child.removeAttribute('inert'));
        el.removeAttribute('role');
        el.setAttribute('inert', '');
        modalExit(el).then(() => el.remove());
        if (restoreFocus) {
          requestAnimationFrame(() => {
            const root = modal();
            const again = twin ? qs(`[data-${twin.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`)}]`, root) : null;
            const original = opener && opener !== document.body && opener.isConnected && !opener.closest('.hz-overlay') ? opener : null;
            (original || again || qs('.hz-tab.is-active', root))?.focus?.({ preventScroll: true });
          });
        }
      }
    };
    activeOverlay = handle;
    // Back does what Escape does (src/ui/back-stack.js): the review closes; a session with something typed asks first.
    // It is on screen while Horizon is (opening, `is-horizon` from src/features/view-switch.js, or open), not once Horizon closes under it.
    const shown = () => { const root = modal(); return !!root && !root.hidden && (root.classList.contains('is-open') || document.body.classList.contains('is-horizon')); };
    backLayers.open(handle, { back: () => (onEscape ? onEscape() : handle.close()), alive: () => activeOverlay === handle && shown() });
    panelEnter(el, { distance: 14 });
    return handle;
  }

  function backToHorizon(targetYear, { overview = false } = {}) {
    const delta = targetYear - year();
    if (delta) ctx.shiftYear(delta);
    if (overview) section = 'overview';
    render({ transition: 0 });
    if (overview) { const scroll = els().scroll; if (scroll) scroll.scrollTop = 0; }
  }

  const yearPlan = createYearPlan({
    ctx,
    overlay: openOverlay,
    icon,
    onLeave: (planYear, target, typed) => {
      if (target === 'close' && !typed) { render(); return; }
      backToHorizon(planYear, { overview: true });
      if (target === 'print') ctx.printYear?.(planYear);
    }
  });
  const yearReview = createYearReview({ ctx, overlay: openOverlay, icon, onLeave: () => render() });
  const quarterReview = createQuarterReview({
    ctx,
    overlay: openOverlay,
    icon,
    onLeave: (at, target) => { if (target === 'horizon') backToHorizon(at.quarter === 3 ? at.year + 1 : at.year, { overview: true }); else render(); }
  });

  /** "2026-Q3" from a card or the Add menu. */
  function openQuarter(requested) {
    quarterReview.open(parseQuarterKey(requested));
  }

  function openPlan(requested) {
    const today = new Date();
    const options = planYearOptions(today);
    const wanted = Number(requested) || Math.max(year(), defaultPlanYear(today));
    yearPlan.open({ year: options.includes(wanted) ? wanted : defaultPlanYear(today) });
  }

  function openReview(requested) {
    yearReview.open({ year: Number(requested) || defaultReviewYear(new Date()) });
  }

  function openYearShare(button) {
    const targetYear = Number(button.dataset.progressShare) || year();
    const yearData = ctx.yearData(targetYear) || {};
    const model = buildYearShareModel(ctx.progress(targetYear), { misogi: yearData.misogi || '', misogiDone: !!yearData.misogiDone });
    if (!canShare(model)) return;
    ctx.closeAllPopovers();
    openShareDialog({ model, title: `Share your ${targetYear}`, eyebrow: 'Progress', opener: button });
  }

  function pickPaint(button) {
    const applied = choosePaint(button.dataset.paintChoice);
    const card = button.closest('.hz-paint-palettes');
    if (!card) return;
    card.outerHTML = renderPaintChooser({ current: applied });
    const chosen = qs(`[data-paint-choice="${applied}"]`, els().content);
    chosen?.focus({ preventScroll: true });
    pulse(qs('.hz-swatch__ramp', chosen));
  }

  // The palette stored on this device (checked again on every render).
  syncPaint();

  // While an overlay is open it owns Escape and the single-key shortcuts.
  window.addEventListener('keydown', event => {
    const overlay = activeOverlay;
    const root = modal();
    if (!overlay || !overlay.el.isConnected || !root || root.hidden) return;
    // A confirmation stacked above Horizon handles its own keys.
    if ([...document.querySelectorAll('.modal')].filter(modalEl => !modalEl.hidden).length !== 1) return;
    if (event.key === 'Escape') {
      if (document.querySelector('.app-popover')) return;
      event.preventDefault();
      event.stopPropagation();
      overlay.onEscape?.();
      return;
    }
    if (event.metaKey || event.ctrlKey || event.altKey || event.key.length !== 1) return;
    // Typing in a field or in an open list (its letters find an option) is not a shortcut.
    if (event.target.closest?.('input, textarea, select, [contenteditable="true"], .app-popover')) return;
    event.stopPropagation();
    if (overlay.onKey?.(event.key)) event.preventDefault();
  }, true);

  // Header + rail use delegation so they survive panel re-renders.
  const root = modal();
  root?.addEventListener('click', event => {
    if (event.target.closest('.hz-overlay')) return;
    const plan = event.target.closest('[data-horizon-plan]');
    if (plan) { event.stopPropagation(); openPlan(plan.dataset.horizonPlan); return; }
    const review = event.target.closest('[data-horizon-review]');
    if (review) { event.stopPropagation(); openReview(review.dataset.horizonReview); return; }
    const insights = event.target.closest('[data-horizon-insights]');
    if (insights) { event.stopPropagation(); ctx.closeAllPopovers(); ctx.openInsights?.(Number(insights.dataset.horizonInsights)); return; }
    const quarter = event.target.closest('[data-horizon-quarter]');
    if (quarter) { event.stopPropagation(); openQuarter(quarter.dataset.horizonQuarter); return; }
    const paint = event.target.closest('[data-paint-choice]');
    if (paint) { pickPaint(paint); return; }
    const share = event.target.closest('[data-progress-share]');
    if (share) { openYearShare(share); return; }
    const tab = event.target.closest('[data-horizon-section]');
    if (tab) { setSection(tab.dataset.horizonSection); return; }
    if (event.target.closest('[data-horizon-prev]')) { ctx.shiftYear(-1); render({ transition: 0 }); return; }
    if (event.target.closest('[data-horizon-next]')) { ctx.shiftYear(1); render({ transition: 0 }); return; }
    if (event.target.closest('[data-horizon-print]')) { ctx.closeAllPopovers(); ctx.printYear?.(); return; }
    const add = event.target.closest('[data-horizon-add]');
    if (add) {
      event.stopPropagation();
      if (document.querySelector('.hz-add-menu')) ctx.closeAllPopovers(); else openAddMenu(add);
    }
  });
  // Listen on the document so shortcuts still work after a click on a
  // non-focusable part of Horizon moved focus back to <body>.
  document.addEventListener('keydown', event => {
    // Only while Horizon is the single visible dialog (a confirmation stacked on top takes over).
    if (!root || root.hidden || [...document.querySelectorAll('.modal')].filter(modalEl => !modalEl.hidden).length !== 1) return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const editable = event.target.closest?.('input, textarea, [contenteditable="true"]');
    const tab = event.target.closest?.('[data-horizon-section]');
    if (tab && ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const index = SECTION_IDS.indexOf(tab.dataset.horizonSection);
      const step = event.key === 'ArrowDown' || event.key === 'ArrowRight' ? 1 : -1;
      const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? SECTION_IDS.length - 1 : (index + step + SECTION_IDS.length) % SECTION_IDS.length;
      setSection(SECTION_IDS[nextIndex]);
      qs(`[data-horizon-section="${SECTION_IDS[nextIndex]}"]`, root)?.focus();
      return;
    }
    if (editable || document.querySelector('.app-popover')) return;
    if (/^[1-7]$/.test(event.key)) { event.preventDefault(); setSection(SECTION_IDS[Number(event.key) - 1]); }
    else if (event.key === '+' || event.key === '=') { const add = qs('[data-horizon-add]', root); if (add) { event.preventDefault(); openAddMenu(add); } }
    else if (event.key === 'p' || event.key === 'P') { event.preventDefault(); ctx.printYear?.(); }
  });

  return {
    render,
    setSection,
    section: () => section,
    /** The guided sessions and the review, for entry points outside Horizon. */
    openPlan,
    openReview,
    openQuarter,
    /** Called after the modal becomes visible so geometry-dependent UI can settle. */
    onOpen() {
      // A session left open when Horizon closed does not come back on its own.
      if (activeOverlay) { yearPlan.close('close', { silent: true }); yearReview.close({ silent: true }); quarterReview.close('close', { silent: true }); activeOverlay?.close({ restoreFocus: false }); render(); }
      positionIndicator(false);
      revealToday();
      // Rendering happens while the dialog is still hidden, so textareas could not be measured yet.
      qsa('textarea', els().content).forEach(field => ctx.autoGrow(field));
    }
  };
}
