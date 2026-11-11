import { esc, escAttr } from '../lib/text.js';
import { uid } from '../lib/utils.js';
import { ymdKey } from '../lib/dates.js';
import { habitActivityStats, rangeLabel } from './horizon-model.js';
import { panelEnter } from '../ui/motion.js';

/**
 * "Plan your year": a guided session that sets up Horizon
 * for one year in eight short steps — look back, Misogi, milestones, six
 * mini-adventures, three commitments, quarterly habits, key dates (with the
 * year before's key dates offered on the same days) — and ends with a summary
 * and "Print your year".
 *
 * Every field writes straight into the year's Horizon data with the shapes
 * Horizon already uses, so leaving half-way never loses anything and the
 * session can be resumed: it always opens prefilled from what is there. The
 * pure helpers below (merge into year data, summaries) are unit-tested; the
 * controller renders inside an overlay that horizon-view.js provides.
 */

export const MAX_PLAN_MILESTONES = 3;
const MAX_MILESTONES = 5;
const MAX_ADVENTURES = 6;
const NEW_KEYDATE_ROWS = 2;
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export const PLAN_STEPS = [
  { id: 'lookback', label: 'Look back', icon: 'history', minutes: 3 },
  { id: 'misogi', label: 'Misogi', icon: 'mountain', minutes: 6 },
  { id: 'milestones', label: 'Milestones', icon: 'diamond', minutes: 3 },
  { id: 'adventures', label: 'Mini-adventures', icon: 'flag', minutes: 6 },
  { id: 'commitments', label: 'Commitments', icon: 'heart', minutes: 4 },
  { id: 'habits', label: 'Winning habits', icon: 'repeat', minutes: 4 },
  { id: 'keydates', label: 'Key dates', icon: 'pin', minutes: 4 },
  { id: 'done', label: 'Your year', icon: 'sparkle', minutes: 0 }
];

const pad = value => String(value).padStart(2, '0');
const daysIn = (year, month) => new Date(year, month + 1, 0).getDate();
const monthName = (year, month, style = 'long') => new Date(year, month, 1).toLocaleDateString(undefined, { month: style });
const text = value => String(value ?? '');
const filled = value => !!text(value).trim();

/** Grow a bordered textarea to its content (borders included, unlike Horizon's borderless fields). */
function grow(field) {
  if (!field) return;
  field.style.height = 'auto';
  field.style.height = `${field.scrollHeight + (field.offsetHeight - field.clientHeight)}px`;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** From 1 October on, the year to plan is the next one. */
export function defaultPlanYear(today = new Date()) {
  return today.getMonth() >= 9 ? today.getFullYear() + 1 : today.getFullYear();
}

/** The years a session can plan: this one and the next. */
export function planYearOptions(today = new Date()) {
  return [today.getFullYear(), today.getFullYear() + 1];
}

export function clampStep(index) {
  return Math.min(PLAN_STEPS.length - 1, Math.max(0, Number(index) || 0));
}

/** Make sure the arrays the session writes into exist, without touching anything else. */
export function ensurePlanShape(d) {
  if (!Array.isArray(d.misogiMilestones)) d.misogiMilestones = [];
  if (!Array.isArray(d.miniAdventures)) d.miniAdventures = [];
  if (!Array.isArray(d.meaningful)) d.meaningful = ['', '', ''];
  while (d.meaningful.length < 3) d.meaningful.push('');
  if (!Array.isArray(d.habits)) d.habits = ['', '', '', ''];
  while (d.habits.length < 4) d.habits.push('');
  if (!Array.isArray(d.habitStartedAt)) d.habitStartedAt = ['', '', '', ''];
  while (d.habitStartedAt.length < 4) d.habitStartedAt.push('');
  if (!d.habitChecks || typeof d.habitChecks !== 'object') d.habitChecks = {};
  if (!d.months || typeof d.months !== 'object') d.months = {};
  if (typeof d.misogi !== 'string') d.misogi = text(d.misogi);
  return d;
}

export function setReflection(d, field, value) {
  if (field !== 'proud' && field !== 'letGo') return false;
  const current = d.reflection && typeof d.reflection === 'object' ? d.reflection : {};
  d.reflection = { proud: text(current.proud), letGo: text(current.letGo), ...current, [field]: text(value) };
  return true;
}

export function setMisogi(d, value) { d.misogi = text(value).replace(/[\r\n]+/g, ' '); return true; }

export function setMisogiWhy(d, value) { d.misogiWhy = text(value).replace(/[\r\n]+/g, ' '); return true; }

export function setMisogiPeriod(d, startDate, endDate = '') {
  d.misogiStartDate = ISO_DAY.test(startDate || '') ? startDate : '';
  d.misogiEndDate = d.misogiStartDate && ISO_DAY.test(endDate || '') && endDate > d.misogiStartDate ? endDate : '';
  return true;
}

/**
 * Create or update one milestone by id. A row typed in this session is created
 * on its first character and dropped again if it is emptied (`created` holds the
 * ids this session made); milestones that existed before are only ever edited.
 */
export function setMilestone(d, id, patch = {}, created = new Set()) {
  const list = d.misogiMilestones;
  let item = list.find(entry => entry.id === id);
  if (!item) {
    if (!filled(patch.text) || list.length >= MAX_MILESTONES) return false;
    item = { id, text: '', done: false, date: '' };
    list.push(item);
    created.add(id);
  }
  if (patch.text !== undefined) item.text = text(patch.text);
  if (patch.date !== undefined) item.date = ISO_DAY.test(patch.date || '') ? patch.date : '';
  if (created.has(id) && !filled(item.text)) {
    d.misogiMilestones = list.filter(entry => entry.id !== id);
    created.delete(id);
  }
  return true;
}

/** -1: no month yet; 0–11: planned for that whole month; 'custom': precise dates to keep. */
export function adventureMonth(item, year) {
  if (!item?.startDate) return -1;
  const month = Number(item.startDate.slice(5, 7)) - 1;
  const whole = item.startDate === `${year}-${pad(month + 1)}-01` && item.endDate === `${year}-${pad(month + 1)}-${pad(daysIn(year, month))}`;
  return whole ? month : 'custom';
}

function applyAdventureMonth(item, month, year) {
  const done = !!item.done || item.status === 'done';
  if (month === -1 || month === '-1') {
    item.startDate = '';
    item.endDate = '';
    item.status = done ? 'done' : 'idea';
    return;
  }
  const index = Number(month);
  if (!Number.isInteger(index) || index < 0 || index > 11) return;
  item.startDate = `${year}-${pad(index + 1)}-01`;
  item.endDate = `${year}-${pad(index + 1)}-${pad(daysIn(year, index))}`;
  item.month = index;
  item.status = done ? 'done' : 'planned';
}

/**
 * Create or update one mini-adventure. A chosen month becomes a whole-month
 * period, so the adventure shows as planned on the ribbon and in the year map
 * and can be narrowed to exact dates later; 'custom' keeps the dates it has.
 */
export function upsertAdventure(d, id, { text: title, month } = {}, year, created = new Set()) {
  const list = d.miniAdventures;
  let item = list.find(entry => entry.id === id);
  if (!item) {
    if (!filled(title) || list.length >= MAX_ADVENTURES) return false;
    item = { id, text: '', startDate: '', endDate: '', month: 0, status: 'idea', done: false, nextStep: '' };
    list.push(item);
    created.add(id);
  }
  if (title !== undefined) item.text = text(title).replace(/[\r\n]+/g, ' ');
  if (month !== undefined && month !== 'custom' && month !== adventureMonth(item, year)) applyAdventureMonth(item, month, year);
  if (created.has(id) && !filled(item.text)) {
    d.miniAdventures = list.filter(entry => entry.id !== id);
    created.delete(id);
  }
  return true;
}

export function setCommitment(d, index, value) {
  if (!Number.isInteger(index) || index < 0 || index > 2) return false;
  d.meaningful[index] = text(value).replace(/[\r\n]+/g, ' ');
  return true;
}

function quarterStarted(year, index, today) {
  return year < today.getFullYear() || (year === today.getFullYear() && Math.floor(today.getMonth() / 3) >= index);
}

function quarterEnded(year, index, today) {
  return year < today.getFullYear() || (year === today.getFullYear() && Math.floor(today.getMonth() / 3) > index);
}

/**
 * A habit can be set in the session while its quarter is still ahead, or is
 * running and has not been tracked yet. A running, tracked habit is changed in
 * Horizon, which asks before restarting its statistics.
 */
export function habitEditable(d, index, year, today = new Date()) {
  if (quarterEnded(year, index, today)) return false;
  const previous = text(d.habits?.[index]).trim();
  if (!previous || !quarterStarted(year, index, today)) return true;
  const stats = habitActivityStats(d, index, year, today);
  const startedKey = d.habitStartedAt?.[index] || '';
  return !(stats.done > 0 || (!!startedKey && startedKey < ymdKey(today)));
}

/** Set a quarterly habit with Horizon's semantics: tracking starts with the quarter, or today. */
export function setHabit(d, index, value, year, today = new Date()) {
  if (!Number.isInteger(index) || index < 0 || index > 3 || !habitEditable(d, index, year, today)) return false;
  const previous = text(d.habits[index]);
  const next = text(value).replace(/[\r\n]+/g, ' ');
  d.habits[index] = next;
  if (next.trim() !== previous.trim()) {
    const todayKey = ymdKey(today);
    d.habitStartedAt[index] = next.trim() && quarterStarted(year, index, today) ? todayKey : '';
    if (Array.isArray(d.habitChecks?.[todayKey])) d.habitChecks[todayKey] = d.habitChecks[todayKey].filter(entry => Number(entry) !== index);
  }
  return true;
}

/** Key dates of one year, flattened from its months (same rows as Horizon's year key dates). */
export function yearKeyDates(d, year) {
  const rows = [];
  for (let month = 0; month < 12; month += 1) {
    const anchors = d.months?.[`${year}-${pad(month + 1)}`]?.anchors;
    if (Array.isArray(anchors)) anchors.forEach(anchor => { if (filled(anchor?.text)) rows.push({ ...anchor, ownerMonth: month }); });
  }
  return rows.sort((a, b) => text(a.startDate).localeCompare(text(b.startDate)));
}

/**
 * Create, move or update one key date (stored under the month it starts in).
 * It is written once it has both a title and a day in the year.
 */
export function upsertKeyDate(d, year, { id, text: title = '', startDate = '', endDate = '' }, created = new Set()) {
  let foundKey = '';
  let found = null;
  Object.entries(d.months).forEach(([key, month]) => {
    const anchor = Array.isArray(month?.anchors) ? month.anchors.find(entry => entry.id === id) : null;
    if (anchor && !found) { found = anchor; foundKey = key; }
  });
  const remove = () => { d.months[foundKey].anchors = d.months[foundKey].anchors.filter(entry => entry.id !== id); };
  const valid = filled(title) && ISO_DAY.test(startDate) && startDate.startsWith(`${year}-`);
  if (!valid) {
    if (found && created.has(id) && !filled(title)) { remove(); created.delete(id); return true; }
    if (found && filled(title)) { found.text = title.trim(); return true; }
    return false;
  }
  const key = startDate.slice(0, 7);
  const end = ISO_DAY.test(endDate) && endDate > startDate && endDate.startsWith(`${year}-`) ? endDate : '';
  if (found && foundKey !== key) { remove(); found = null; }
  if (!found) {
    if (!d.months[key] || typeof d.months[key] !== 'object') d.months[key] = { outcomes: [], anchors: [] };
    if (!Array.isArray(d.months[key].anchors)) d.months[key].anchors = [];
    d.months[key].anchors.push({ id, text: title.trim(), startDate, endDate: end });
    created.add(id);
    return true;
  }
  found.text = title.trim();
  found.startDate = startDate;
  found.endDate = end;
  return true;
}

// Key dates from the year before -------------------------------------------

const dayNumber = key => Date.UTC(Number(key.slice(0, 4)), Number(key.slice(5, 7)) - 1, Number(key.slice(8, 10))) / 86400000;
const dayKeyOf = number => new Date(number * 86400000).toISOString().slice(0, 10);
const sameTitle = value => text(value).trim().toLocaleLowerCase().replace(/[‘’]/g, '\'').replace(/\s+/g, ' ');

/** A 'YYYY-MM-DD' key moved by whole years: same day and month, 29 February → 28 February. */
export function shiftYearKey(key, years) {
  if (!ISO_DAY.test(key || '')) return '';
  const year = Number(key.slice(0, 4)) + years;
  const month = Number(key.slice(5, 7)) - 1;
  return `${year}-${pad(month + 1)}-${pad(Math.min(Number(key.slice(8, 10)), daysIn(year, month)))}`;
}

/** A key date moved by whole years. A period keeps its length in days, even across 29 February or the year end. */
export function shiftKeyDate(item, years) {
  const startDate = shiftYearKey(item?.startDate, years);
  if (!startDate) return null;
  const length = ISO_DAY.test(item.endDate || '') && item.endDate > item.startDate ? dayNumber(item.endDate) - dayNumber(item.startDate) : 0;
  return { text: text(item.text).trim(), startDate, endDate: length ? dayKeyOf(dayNumber(startDate) + length) : '' };
}

/**
 * The key dates of the year before `year` that the Key dates step offers to
 * bring into `year`, moved to the same days. Leaves out the ones an earlier
 * “Add” already handled (`carriedKeyDates` on the year’s data), exact
 * duplicates and any that would no longer touch `year`. `present` marks the
 * ones `year` already has under the same name (paired one to one, the same day
 * first): they start unticked.
 */
export function keyDatesToCarry(previous, current, year) {
  const handled = new Set(Array.isArray(current?.carriedKeyDates) ? current.carriedKeyDates : []);
  const seen = new Set();
  const offers = [];
  yearKeyDates(previous || {}, year - 1).forEach(anchor => {
    if (!anchor.id || handled.has(anchor.id)) return;
    const legacy = ISO_DAY.test(anchor.date || '') ? anchor.date : `${year - 1}-${pad(anchor.ownerMonth + 1)}-01`;
    const shifted = shiftKeyDate({ ...anchor, startDate: ISO_DAY.test(anchor.startDate || '') ? anchor.startDate : legacy }, 1);
    if (!shifted?.text || (shifted.endDate || shifted.startDate) < `${year}-01-01` || shifted.startDate > `${year}-12-31`) return;
    const key = `${sameTitle(shifted.text)}|${shifted.startDate}|${shifted.endDate}`;
    if (seen.has(key)) return;
    seen.add(key);
    offers.push({ id: anchor.id, ...shifted, present: false });
  });
  const existing = yearKeyDates(current || {}, year).map(item => ({ title: sameTitle(item.text), startDate: item.startDate, used: false }));
  [true, false].forEach(sameDay => offers.forEach(offer => {
    if (offer.present) return;
    const match = existing.find(item => !item.used && item.title === sameTitle(offer.text) && (!sameDay || item.startDate === offer.startDate));
    if (match) { match.used = true; offer.present = true; }
  }));
  return offers.sort((a, b) => a.startDate.localeCompare(b.startDate) || a.text.localeCompare(b.text));
}

/**
 * Add the chosen offers to `year` as ordinary key dates, stored under the
 * month they start in (as Horizon stores them), and remember every offer that
 * was on the card, ticked or not, so the step does not offer them again.
 */
export function carryKeyDates(d, year, offers, chosenIds, makeId = () => uid('keydate')) {
  if (!d.months || typeof d.months !== 'object') d.months = {};
  const chosen = new Set(chosenIds);
  const added = [];
  offers.forEach(offer => {
    if (!chosen.has(offer.id) || !ISO_DAY.test(offer.startDate || '') || !filled(offer.text)) return;
    const key = `${year}-${offer.startDate.slice(5, 7)}`;
    if (!d.months[key] || typeof d.months[key] !== 'object') d.months[key] = { outcomes: [], anchors: [] };
    if (!Array.isArray(d.months[key].anchors)) d.months[key].anchors = [];
    const anchor = { id: makeId(), text: offer.text.trim(), startDate: offer.startDate, endDate: offer.endDate || '' };
    d.months[key].anchors.push(anchor);
    added.push(anchor);
  });
  const handled = Array.isArray(d.carriedKeyDates) ? d.carriedKeyDates : [];
  d.carriedKeyDates = [...new Set([...handled, ...offers.map(offer => offer.id)])];
  return added;
}

/** What the session has set for a year — the Done step and the step rail ticks. */
export function planSummary(d, year) {
  const keyDates = yearKeyDates(d, year);
  const milestones = (d.misogiMilestones || []).filter(item => filled(item.text));
  const adventures = (d.miniAdventures || []).filter(item => filled(item.text));
  const commitments = (d.meaningful || []).filter(filled);
  const habits = (d.habits || []).map((habit, index) => ({ quarter: index + 1, text: text(habit).trim() })).filter(habit => habit.text);
  const reflection = d.reflection && typeof d.reflection === 'object' ? d.reflection : {};
  const summary = {
    year,
    reflection: { proud: text(reflection.proud).trim(), letGo: text(reflection.letGo).trim() },
    misogi: { text: text(d.misogi).trim(), why: text(d.misogiWhy).trim(), when: d.misogiStartDate ? rangeLabel(d.misogiStartDate, d.misogiEndDate) : '' },
    milestones: milestones.map(item => ({ text: item.text.trim(), when: item.date ? rangeLabel(item.date) : '' })),
    adventures: adventures.map(item => ({ text: item.text.trim(), when: item.startDate ? rangeLabel(item.startDate, item.endDate) : '' })),
    commitments: commitments.map(value => value.trim()),
    habits,
    keyDates: keyDates.map(item => ({ text: text(item.text).trim(), when: rangeLabel(item.startDate, item.endDate) }))
  };
  summary.steps = {
    lookback: !!(summary.reflection.proud || summary.reflection.letGo),
    misogi: !!summary.misogi.text,
    milestones: summary.milestones.length > 0,
    adventures: summary.adventures.length > 0,
    commitments: summary.commitments.length > 0,
    habits: summary.habits.length > 0,
    keydates: summary.keyDates.length > 0
  };
  summary.done = Object.values(summary.steps).filter(Boolean).length;
  return summary;
}

/** A year whose Horizon has at most one part filled in is "mostly empty". */
export function isHorizonMostlyEmpty(d, keyDateCount = 0) {
  const parts = [
    filled(d.misogi),
    (d.miniAdventures || []).some(item => filled(item.text)),
    (d.meaningful || []).some(filled),
    (d.habits || []).some(filled),
    keyDateCount > 0
  ];
  return parts.filter(Boolean).length <= 1;
}

// ---------------------------------------------------------------------------
// Controller
// ---------------------------------------------------------------------------

/**
 * @param {object} options
 * @param {object} options.ctx Horizon context (yearData, persist, keyDates, openPeriod, openCalendar, openList, confirm, printYear, getYear, shiftYear, minYear?, track?)
 * @param {(options: object) => {el: HTMLElement, close: Function}} options.overlay mounts an overlay over the Horizon dialog
 * @param {(name: string, className?: string) => string} options.icon
 * @param {(year: number, target: 'close'|'horizon'|'print', typed: boolean) => void} options.onLeave called after the session closes
 */
export function createYearPlan({ ctx, overlay, icon, onLeave }) {
  let session = null;

  const today = () => new Date();
  const data = () => ensurePlanShape(ctx.yearData(session.year));
  const persist = () => { session.typed = true; ctx.persist(); };

  function freshDrafts(year) {
    const d = ensurePlanShape(ctx.yearData(year));
    const milestones = d.misogiMilestones.map(item => ({ id: item.id, date: item.date }));
    while (milestones.length < MAX_PLAN_MILESTONES) milestones.push({ id: uid('milestone'), date: '' });
    const adventures = Array.from({ length: MAX_ADVENTURES }, (_, index) => {
      const item = d.miniAdventures[index];
      return item ? { id: item.id, month: adventureMonth(item, year) } : { id: uid('adventure'), month: -1, text: '' };
    });
    const keydates = Array.from({ length: NEW_KEYDATE_ROWS }, () => ({ id: uid('keydate'), text: '', startDate: '', endDate: '' }));
    return { milestones, adventures, keydates, existingKeyDates: new Set(yearKeyDates(d, year).map(item => item.id)) };
  }

  function open({ year = defaultPlanYear(today()), step = 0 } = {}) {
    if (session) return;
    session = { year, step: clampStep(step), typed: false, created: new Set(), completed: false, drafts: freshDrafts(year), handle: null };
    session.handle = overlay({ className: 'yp', label: `Plan your year ${year}`, onEscape: requestLeave });
    session.handle.el.innerHTML = shell();
    session.handle.el.addEventListener('click', onClick);
    session.handle.el.addEventListener('input', onInput);
    session.handle.el.addEventListener('change', onChange);
    session.handle.el.addEventListener('keydown', onKeydown);
    renderStep(0);
  }

  /** target: 'close' (× or Escape), 'horizon' (Open Horizon) or 'print' (Print your year). */
  function close(target = 'close', { silent = false } = {}) {
    if (!session) return;
    const { year, handle, typed } = session;
    session = null;
    handle.close({ restoreFocus: !silent });
    if (!silent) onLeave?.(year, target, typed);
  }

  function requestLeave() {
    if (!session) return;
    if (!session.typed) { close(); return; }
    ctx.confirm({
      eyebrow: 'Plan your year',
      title: 'Leave the planning session?',
      message: `Everything you wrote is already saved in Horizon ${session.year}. Open “Plan your year” again any time to pick up where you left off.`,
      confirmLabel: 'Leave',
      action: () => close('close')
    });
  }

  const el = selector => session?.handle.el.querySelector(selector);

  function shell() {
    return `<div class="yp-head">
        <div class="yp-head__title"><span class="yp-eyebrow">${icon('sparkle')}Plan your year</span>
          <div class="yp-year" data-plan-years></div></div>
        <div class="yp-progress" data-plan-progress></div>
        <button type="button" class="icon-button yp-close" data-plan-close aria-label="Close the planning session">${icon('close')}</button>
      </div>
      <div class="yp-main">
        <nav class="yp-rail" aria-label="Planning steps"><ol data-plan-rail></ol><p class="yp-rail__note">About 30 minutes. Everything is optional and saved as you type.</p></nav>
        <div class="yp-scroll" data-plan-scroll><div class="yp-step" data-plan-step-body></div></div>
      </div>
      <footer class="yp-foot" data-plan-foot></footer>`;
  }

  function renderYears() {
    const host = el('[data-plan-years]');
    if (!host) return;
    const options = planYearOptions(today());
    const index = options.indexOf(session.year);
    host.innerHTML = `<button type="button" class="icon-button hz-year-step" data-plan-year="-1" aria-label="Plan the previous year" ${index <= 0 ? 'disabled' : ''}>${icon('chevronLeft')}</button>
      <h2 id="yp-title"><span class="sr-only">Plan </span>${session.year}</h2>
      <button type="button" class="icon-button hz-year-step" data-plan-year="1" aria-label="Plan the next year" ${index >= options.length - 1 ? 'disabled' : ''}>${icon('chevronRight')}</button>`;
  }

  function renderChrome(summary) {
    renderYears();
    const step = PLAN_STEPS[session.step];
    const progress = el('[data-plan-progress]');
    if (progress) {
      progress.innerHTML = `<div class="yp-progress__bar" role="progressbar" aria-label="Planning progress" aria-valuemin="1" aria-valuemax="${PLAN_STEPS.length}" aria-valuenow="${session.step + 1}" aria-valuetext="${escAttr(`Step ${session.step + 1} of ${PLAN_STEPS.length}: ${step.label}`)}">${PLAN_STEPS.map((item, index) => `<i class="${index < session.step ? 'is-past' : index === session.step ? 'is-current' : ''}"></i>`).join('')}</div><small>Step ${session.step + 1} of ${PLAN_STEPS.length} · ${esc(step.label)}</small>`;
    }
    const rail = el('[data-plan-rail]');
    if (rail) {
      rail.innerHTML = PLAN_STEPS.map((item, index) => {
        const isDone = summary.steps[item.id];
        return `<li><button type="button" class="yp-rail__step yp-kind--${item.id}${index === session.step ? ' is-current' : ''}${isDone ? ' is-done' : ''}" data-plan-step="${index}" ${index === session.step ? 'aria-current="step"' : ''}>
          <span class="yp-rail__icon">${isDone && index !== session.step ? icon('check') : icon(item.icon)}</span><span class="yp-rail__label">${esc(item.label)}</span>${isDone ? '<span class="sr-only"> (set)</span>' : ''}</button></li>`;
      }).join('');
    }
    const foot = el('[data-plan-foot]');
    if (foot) {
      const last = session.step === PLAN_STEPS.length - 1;
      const beforeLast = session.step === PLAN_STEPS.length - 2;
      foot.innerHTML = `<button type="button" class="text-button yp-back" data-plan-back ${session.step === 0 ? 'hidden' : ''}>${icon('chevronLeft')}Back</button>
        <span class="yp-foot__hint">${last ? 'Saved in Horizon' : step.minutes ? `About ${step.minutes} min · optional` : ''}</span>
        ${last
          ? `<button type="button" class="secondary-button yp-next" data-plan-open-horizon>Open Horizon${icon('arrowRight')}</button>`
          : `<button type="button" class="primary-button yp-next" data-plan-next>${beforeLast ? 'See your year' : 'Next'}${icon('arrowRight')}</button>`}`;
    }
  }

  function renderStep(direction = 0, focus = true) {
    if (!session) return;
    const d = data();
    const summary = planSummary(d, session.year);
    renderChrome(summary);
    const body = el('[data-plan-step-body]');
    const step = PLAN_STEPS[session.step];
    body.className = `yp-step yp-kind--${step.id}`;
    body.innerHTML = STEP_RENDERERS[step.id](d, summary);
    const scroll = el('[data-plan-scroll]');
    if (scroll) scroll.scrollTop = 0;
    requestAnimationFrame(() => qsaIn(body, 'textarea').forEach(grow));
    if (direction) panelEnter(body, { direction });
    if (step.id === 'done' && !session.completed) {
      session.completed = true;
      ctx.track?.('year_plan_completed');
    }
    if (focus) requestAnimationFrame(() => (body.querySelector('[data-plan-autofocus]') || body.querySelector('h3'))?.focus({ preventScroll: true }));
  }

  const qsaIn = (root, selector) => [...root.querySelectorAll(selector)];

  function go(index) {
    if (!session) return;
    const next = clampStep(index);
    if (next === session.step) return;
    const direction = Math.sign(next - session.step);
    ctx.closeAllPopovers?.();
    session.step = next;
    renderStep(direction);
  }

  // -- Step markup ----------------------------------------------------------

  function stepHead(eyebrow, title, lead) {
    return `<header class="yp-step__head"><span class="hz-eyebrow">${esc(eyebrow)}</span><h3 tabindex="-1">${esc(title)}</h3>${lead ? `<p>${esc(lead)}</p>` : ''}</header>`;
  }

  // The month of a mini-adventure: the app's own list, not a native select.
  function monthLabel(month, item) {
    if (month === 'custom') return rangeLabel(item?.startDate, item?.endDate);
    return month === -1 ? 'Any month' : monthName(session.year, month);
  }

  function monthTrigger(id, index, month, item) {
    const label = monthLabel(month, item);
    return `<button type="button" class="yp-month${month === -1 ? '' : ' has-value'}" data-plan-adventure-month="${escAttr(id)}" data-plan-index="${index}" aria-haspopup="listbox" aria-expanded="false" aria-label="${escAttr(`Month for mini-adventure ${index + 1}: ${label}`)}"><span>${esc(label)}</span>${icon('chevronDown')}</button>`;
  }

  function openMonthMenu(trigger) {
    const id = trigger.dataset.planAdventureMonth;
    const draft = session.drafts.adventures.find(entry => entry.id === id);
    const item = data().miniAdventures.find(entry => entry.id === id);
    const current = item ? adventureMonth(item, session.year) : (draft?.month ?? -1);
    const items = [
      ...(current === 'custom' ? [{ value: 'custom', label: monthLabel('custom', item) }] : []),
      { value: -1, label: 'Any month' },
      ...Array.from({ length: 12 }, (_, m) => ({ value: m, label: monthName(session.year, m) }))
    ];
    ctx.openList(trigger, items, current, choice => {
      if (!session) return;
      const month = choice.value === 'custom' ? 'custom' : Number(choice.value);
      if (draft) draft.month = month;
      const d = data();
      const saved = d.miniAdventures.find(entry => entry.id === id);
      if (saved && month !== 'custom') { upsertAdventure(d, id, { month }, session.year, session.created); persist(); }
      trigger.outerHTML = monthTrigger(id, Number(trigger.dataset.planIndex), month, d.miniAdventures.find(entry => entry.id === id));
      refreshChrome();
      requestAnimationFrame(() => el(`[data-plan-adventure-month="${CSS.escape(id)}"]`)?.focus({ preventScroll: true }));
    }, { compact: true, alignSelected: true, minWidth: 168, label: `Month for mini-adventure ${Number(trigger.dataset.planIndex) + 1}` });
  }

  function chip(attr, id, startKey, endKey, empty) {
    const value = startKey ? rangeLabel(startKey, endKey) : empty;
    return `<button type="button" class="hz-date-chip${startKey ? ' has-value' : ''}" ${attr}="${escAttr(id)}" aria-label="${escAttr(`${empty}${startKey ? ` (currently ${value})` : ''}`)}">${icon('calendar')}<span>${esc(value)}</span></button>`;
  }

  // Key dates of the year before, offered once per year (read when the step first shows).
  function carryState(d) {
    const drafts = session.drafts;
    if (!drafts.carry) {
      // A year before Horizon's first one has nothing to offer: don't create it just to look.
      const before = session.year - 1;
      const previous = typeof ctx.minYear === 'function' && before < ctx.minYear() ? null : ctx.yearData(before);
      const offers = keyDatesToCarry(previous, d, session.year);
      drafts.carry = { offers, checked: new Set(offers.filter(offer => !offer.present).map(offer => offer.id)), added: null };
    }
    return drafts.carry;
  }

  const carryCount = carry => `${carry.checked.size} of ${carry.offers.length} selected`;
  const datesWord = count => (count === 1 ? '1 date' : `${count} dates`);

  function carryCard(d) {
    const carry = carryState(d);
    const from = session.year - 1;
    if (carry.added !== null) {
      return `<p class="yp-carry-done" role="status" tabindex="-1" data-plan-carry-done>${icon('check')}<span>${datesWord(carry.added)} from ${from} added to ${session.year}. Change or remove them in Horizon any time.</span></p>`;
    }
    if (!carry.offers.some(offer => !offer.present)) return '';
    const rows = carry.offers.map(offer => `<li><label class="yp-carry__item${offer.present ? ' is-present' : ''}">
        <input type="checkbox" class="check" data-plan-carry="${escAttr(offer.id)}" ${carry.checked.has(offer.id) ? 'checked' : ''}>
        <span class="yp-carry__date">${esc(rangeLabel(offer.startDate, offer.endDate))}</span><span class="yp-carry__text">${esc(offer.text)}</span>${offer.present ? `<small>Already on ${session.year}</small>` : ''}</label></li>`).join('');
    return `<section class="yp-carry" aria-labelledby="yp-carry-title">
        <header class="yp-carry__head"><span class="yp-carry__icon" aria-hidden="true">${icon('history')}</span>
          <div><h4 id="yp-carry-title">From ${from}</h4><p>Your key dates from ${from}, on the same days in ${session.year}. Untick the ones that won’t come back.</p></div></header>
        <ul class="yp-carry__list">${rows}</ul>
        <div class="yp-carry__foot"><button type="button" class="primary-button" data-plan-carry-add ${carry.checked.size ? '' : 'disabled'}>${icon('plus')}Add to ${session.year}</button><span data-plan-carry-count aria-live="polite">${carryCount(carry)}</span></div>
      </section>`;
  }

  function addCarried() {
    const carry = session.drafts.carry;
    if (!carry || carry.added !== null || !carry.checked.size) return;
    const added = carryKeyDates(data(), session.year, carry.offers, carry.checked);
    added.forEach(anchor => session.drafts.existingKeyDates.add(anchor.id));
    carry.added = added.length;
    persist();
    renderStep(0, false);
    requestAnimationFrame(() => el('[data-plan-carry-done]')?.focus({ preventScroll: true }));
  }

  const STEP_RENDERERS = {
    lookback(d) {
      const ending = session.year - 1;
      const reflection = d.reflection || {};
      return `${stepHead(`Step 1 · Look back on ${ending}`, `Close ${ending} before you open ${session.year}.`, 'Two quiet questions. A few honest words are enough, and you can skip them.')}
        <label class="yp-field"><span>What are you proud of from ${ending}?</span><textarea rows="3" data-plan-field="proud" data-plan-autofocus maxlength="400" placeholder="The moment, the habit, the decision that made a difference">${esc(reflection.proud || '')}</textarea></label>
        <label class="yp-field"><span>What will you let go of?</span><textarea rows="3" data-plan-field="letGo" maxlength="400" placeholder="A worry, a commitment, a way of working you won’t carry into ${session.year}">${esc(reflection.letGo || '')}</textarea></label>`;
    },
    misogi(d) {
      return `${stepHead('Step 2 · Misogi', `One hard thing that will define ${session.year}.`, 'Physical, creative or personal: hard enough that you might not make it, meaningful enough that you will train for it.')}
        <label class="yp-field yp-field--hero"><span>Your Misogi</span><textarea rows="2" data-plan-field="misogi" data-plan-autofocus maxlength="240" placeholder="Run a mountain ultra, write the first draft, swim across the lake…">${esc(d.misogi)}</textarea></label>
        <label class="yp-field"><span>Why it matters <em>optional</em></span><input type="text" data-plan-field="misogiWhy" maxlength="200" value="${escAttr(d.misogiWhy || '')}" placeholder="What changes for you if you do it"></label>
        <div class="yp-field yp-field--inline"><span>When <em>optional</em></span>${chip('data-plan-period', 'misogi', d.misogiStartDate, d.misogiEndDate, 'Put it on the calendar')}</div>`;
    },
    milestones(d) {
      const head = stepHead('Step 3 · Milestones', 'Proof points on the way.', 'Up to three moments that would prove you are on track. Not a project plan.');
      if (!d.misogi.trim()) return `${head}<div class="hz-empty"><p>Milestones prove progress on your Misogi. Name it first, or skip this step for now.</p><button type="button" class="hz-inline-cta" data-plan-step="1">${icon('mountain')}Name the Misogi</button></div>`;
      const rows = session.drafts.milestones.map((draft, index) => {
        const item = d.misogiMilestones.find(entry => entry.id === draft.id);
        const done = !!item?.done;
        return `<div class="yp-row${done ? ' is-done' : ''}"><span class="yp-row__index" aria-hidden="true">${index + 1}</span>
          <input type="text" class="yp-row__input" data-plan-milestone="${escAttr(draft.id)}" ${index === 0 ? 'data-plan-autofocus' : ''} value="${escAttr(item?.text || '')}" maxlength="180" placeholder="${escAttr(['First proof: a training block finished', 'Halfway: the hardest rehearsal', 'Ready: a full dress rehearsal'][index] || 'Another proof point')}" aria-label="${escAttr(`Milestone ${index + 1}`)}">
          ${chip('data-plan-milestone-date', draft.id, item?.date || draft.date, '', 'Date')}</div>`;
      }).join('');
      return `${head}<p class="yp-context">${icon('mountain')}<span>${esc(d.misogi.trim())}</span></p><div class="yp-rows">${rows}</div>`;
    },
    adventures(d) {
      const cards = session.drafts.adventures.map((draft, index) => {
        const item = d.miniAdventures.find(entry => entry.id === draft.id);
        const done = !!item && (!!item.done || item.status === 'done');
        const month = item ? adventureMonth(item, session.year) : draft.month;
        return `<div class="yp-adventure${done ? ' is-done' : ''}"><span class="yp-adventure__index" aria-hidden="true">${done ? icon('check') : index + 1}</span>
          <input type="text" data-plan-adventure="${escAttr(draft.id)}" ${index === 0 ? 'data-plan-autofocus' : ''} value="${escAttr(item?.text ?? draft.text ?? '')}" maxlength="180" placeholder="${escAttr(['A night under the stars', 'A city you have never seen', 'Learn something with your hands', 'A day completely offline', 'A trip with an old friend', 'Something that scares you a little'][index])}" aria-label="${escAttr(`Mini-adventure ${index + 1}`)}">
          ${monthTrigger(draft.id, index, month, item)}</div>`;
      }).join('');
      return `${stepHead('Step 4 · Mini-adventures', 'Six experiences that break the routine.', 'Small enough to happen, different enough to remember. Roughly one every two months keeps the year from blurring. A month is enough for now.')}
        <div class="yp-adventures">${cards}</div>`;
    },
    commitments(d) {
      const placeholders = ['Something worth making room for', 'Another thing that matters', 'One more, if it truly matters'];
      return `${stepHead('Step 5 · Commitments', `What would make ${session.year} meaningful?`, 'Three statements about results, relationships, places or experiences. Not a second task list.')}
        <div class="yp-rows">${d.meaningful.slice(0, 3).map((value, index) => `<div class="yp-row yp-row--commitment"><span class="yp-row__index" aria-hidden="true">${index + 1}</span><input type="text" class="yp-row__input" data-plan-commitment="${index}" ${index === 0 ? 'data-plan-autofocus' : ''} value="${escAttr(value)}" maxlength="180" placeholder="${escAttr(placeholders[index])}" aria-label="${escAttr(`Commitment ${index + 1}`)}"></div>`).join('')}</div>`;
    },
    habits(d) {
      const rows = d.habits.slice(0, 4).map((habit, index) => {
        const editable = habitEditable(d, index, session.year, today());
        const months = `${monthName(session.year, index * 3, 'short')}–${monthName(session.year, index * 3 + 2, 'short')}`;
        const note = editable ? (index === 0 && !quarterStarted(session.year, 0, today()) ? '<em class="yp-habit__start">Start here</em>' : '') : `<em>${quarterEnded(session.year, index, today()) ? 'Quarter complete' : 'Tracking · change it in Horizon'}</em>`;
        return `<div class="yp-row yp-row--habit${editable ? '' : ' is-locked'}"><span class="yp-habit__quarter"><b>Q${index + 1}</b><small>${esc(months)}</small></span>
          <input type="text" class="yp-row__input" data-plan-habit="${index}" value="${escAttr(habit)}" maxlength="180" placeholder="${editable ? 'One practice, checked when you close the day' : ''}" ${editable ? '' : 'disabled'} aria-label="${escAttr(`Winning habit for Q${index + 1}`)}">${note}</div>`;
      }).join('');
      const firstEditable = [0, 1, 2, 3].find(index => habitEditable(d, index, session.year, today()));
      return `${stepHead('Step 6 · Winning habits', 'One practice per quarter.', 'Choose the first quarter now; the others can wait until their quarter begins. You check it off when you close the day.')}
        <div class="yp-rows">${rows.replace(`data-plan-habit="${firstEditable}"`, `data-plan-habit="${firstEditable}" data-plan-autofocus`)}</div>`;
    },
    keydates(d) {
      const existing = ctx.keyDates(session.year).filter(item => text(item.text).trim() && session.drafts.existingKeyDates.has(item.id)).sort((a, b) => text(a.startDate).localeCompare(text(b.startDate)));
      const list = existing.length ? `<ul class="yp-keydates">${existing.map(item => `<li><span class="yp-keydates__date">${esc(rangeLabel(item.startDate, item.endDate))}</span><span>${esc(item.text)}</span></li>`).join('')}</ul>` : '';
      const carry = carryCard(d);
      const rows = session.drafts.keydates.map((draft, index) => `<div class="yp-row yp-row--keydate"><span class="yp-row__index" aria-hidden="true">${icon('pin')}</span>
          <input type="text" class="yp-row__input" data-plan-keydate-text="${escAttr(draft.id)}" ${index === 0 && !carry ? 'data-plan-autofocus' : ''} value="${escAttr(draft.text)}" maxlength="180" placeholder="${escAttr(['A birthday worth protecting', 'A trip, a launch, a school holiday'][index] || 'Another date')}" aria-label="${escAttr(`Key date ${index + 1}`)}">
          ${chip('data-plan-keydate-date', draft.id, draft.startDate, draft.endDate, 'Choose dates')}</div>`).join('');
      return `${stepHead('Step 7 · Key dates', 'The dates worth protecting.', 'Birthdays, trips, launches, school holidays: the moments the rest of the year should bend around. A key date is saved once it has a name and a date.')}
        ${carry}
        ${list ? `<div class="yp-subhead">Already on ${session.year}</div>${list}` : ''}${list || carry ? '<div class="yp-subhead">Add</div>' : ''}
        <div class="yp-rows" data-plan-keydate-rows>${rows}</div>
        <button type="button" class="hz-add-row" data-plan-add-keydate>${icon('plus')}<span>Add another date</span></button>`;
    },
    done(d, summary) {
      const row = (stepIndex, label, value, isSet) => `<li class="yp-summary__row yp-kind--${PLAN_STEPS[stepIndex].id}${isSet ? ' is-set' : ''}"><span class="yp-summary__icon">${icon(isSet ? 'check' : PLAN_STEPS[stepIndex].icon)}</span><span class="yp-summary__copy"><strong>${esc(label)}</strong><small>${value}</small></span><button type="button" class="text-button" data-plan-step="${stepIndex}" aria-label="${escAttr(`Edit ${label}`)}">${isSet ? 'Edit' : 'Add'}</button></li>`;
      const list = (items, empty) => (items.length ? items.map(esc).join(' · ') : `<span class="yp-summary__empty">${esc(empty)}</span>`);
      const rows = [
        row(1, 'Misogi', summary.misogi.text ? `${esc(summary.misogi.text)}${summary.misogi.when ? ` · ${esc(summary.misogi.when)}` : ''}` : '<span class="yp-summary__empty">Not named yet</span>', !!summary.misogi.text),
        row(2, `Milestones · ${summary.milestones.length}`, list(summary.milestones.map(item => item.text), 'None yet'), summary.milestones.length > 0),
        row(3, `Mini-adventures · ${summary.adventures.length} of ${MAX_ADVENTURES}`, list(summary.adventures.map(item => item.text), 'None yet'), summary.adventures.length > 0),
        row(4, `Commitments · ${summary.commitments.length} of 3`, list(summary.commitments, 'None yet'), summary.commitments.length > 0),
        row(5, `Winning habits · ${summary.habits.length} of 4`, list(summary.habits.map(habit => `Q${habit.quarter} ${habit.text}`), 'None yet'), summary.habits.length > 0),
        row(6, `Key dates · ${summary.keyDates.length}`, list(summary.keyDates.slice(0, 4).map(item => `${item.when} ${item.text}`), 'None yet'), summary.keyDates.length > 0),
        row(0, `Looking back on ${session.year - 1}`, summary.steps.lookback ? 'Written' : '<span class="yp-summary__empty">Skipped</span>', summary.steps.lookback)
      ].join('');
      const title = summary.done >= 5 ? `${session.year} has a shape.` : summary.done ? `${session.year} is taking shape.` : `${session.year} is still wide open.`;
      return `${stepHead('Done', title, summary.done ? 'Everything is saved in Horizon. Print it on one page to keep it in sight: on the fridge, the desk, the inside of a notebook.' : 'Nothing is set yet, and that is fine. Come back to any step when you are ready.')}
        <ul class="yp-summary">${rows}</ul>
        <div class="yp-done-actions"><button type="button" class="primary-button" data-plan-print data-plan-autofocus>${icon('printer')}Print your year</button><span>One landscape page: the Misogi, adventures, commitments, habits and twelve months.</span></div>`;
    }
  };

  // -- Interactions -----------------------------------------------------------

  function setYear(delta) {
    const options = planYearOptions(today());
    const next = options[options.indexOf(session.year) + delta];
    if (!next) return;
    ctx.closeAllPopovers?.();
    session.year = next;
    session.created = new Set();
    session.drafts = freshDrafts(next);
    session.handle.el.setAttribute('aria-label', `Plan your year ${next}`);
    renderStep(0, false);
  }

  function refreshChrome() { renderChrome(planSummary(data(), session.year)); }

  function onInput(event) {
    if (!session) return;
    const target = event.target;
    const d = data();
    const { dataset } = target;
    if (dataset.planField === 'proud' || dataset.planField === 'letGo') setReflection(d, dataset.planField, target.value);
    else if (dataset.planField === 'misogi') setMisogi(d, target.value);
    else if (dataset.planField === 'misogiWhy') setMisogiWhy(d, target.value);
    else if (dataset.planMilestone) {
      const draft = session.drafts.milestones.find(entry => entry.id === dataset.planMilestone);
      setMilestone(d, dataset.planMilestone, { text: target.value, ...(draft?.date ? { date: draft.date } : {}) }, session.created);
    } else if (dataset.planAdventure) {
      const draft = session.drafts.adventures.find(entry => entry.id === dataset.planAdventure);
      if (draft) draft.text = target.value;
      upsertAdventure(d, dataset.planAdventure, { text: target.value, month: draft?.month }, session.year, session.created);
    } else if (dataset.planCommitment) setCommitment(d, Number(dataset.planCommitment), target.value);
    else if (dataset.planHabit) setHabit(d, Number(dataset.planHabit), target.value, session.year, today());
    else if (dataset.planKeydateText) {
      const draft = session.drafts.keydates.find(entry => entry.id === dataset.planKeydateText);
      if (draft) { draft.text = target.value; upsertKeyDate(d, session.year, draft, session.created); }
    } else return;
    if (target.tagName === 'TEXTAREA') grow(target);
    persist();
    refreshChrome();
  }

  function onChange(event) {
    if (!session) return;
    const target = event.target;
    if (target.dataset.planCarry !== undefined) {
      const carry = session.drafts.carry;
      if (!carry) return;
      if (target.checked) carry.checked.add(target.dataset.planCarry);
      else carry.checked.delete(target.dataset.planCarry);
      const count = el('[data-plan-carry-count]');
      if (count) count.textContent = carryCount(carry);
      const add = el('[data-plan-carry-add]');
      if (add) add.disabled = !carry.checked.size;
      return;
    }
    if (target.dataset.planHabit) {
      const d = data();
      if (setHabit(d, Number(target.dataset.planHabit), target.value.trim(), session.year, today())) { target.value = target.value.trim(); persist(); }
    }
  }

  function onKeydown(event) {
    if (!session) return;
    const field = event.target.closest?.('input[type="text"], textarea');
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      if (session.step < PLAN_STEPS.length - 1) go(session.step + 1);
      return;
    }
    // Enter moves to the next field of the step, then to the next step; Shift+Enter adds a line to a reflection.
    if (!field || event.key !== 'Enter' || event.shiftKey) return;
    event.preventDefault();
    const fields = [...session.handle.el.querySelectorAll('[data-plan-step-body] input[type="text"]:not(:disabled), [data-plan-step-body] textarea')];
    const next = fields[fields.indexOf(field) + 1];
    if (next) next.focus();
    else if (session.step < PLAN_STEPS.length - 1) go(session.step + 1);
  }

  function pickPeriod(anchor, startKey, endKey, onSave) {
    const y = session.year;
    ctx.openPeriod(anchor, startKey, endKey, (startDate, endDate) => { if (session) onSave(startDate || '', endDate || ''); }, { minKey: `${y}-01-01`, maxKey: `${y}-12-31`, fallbackKey: startKey || `${y}-01-01`, align: 'start' });
  }

  function updateChip(button, startKey, endKey, empty) {
    if (!button) return;
    button.classList.toggle('has-value', !!startKey);
    const value = startKey ? rangeLabel(startKey, endKey) : empty;
    button.querySelector('span').textContent = value;
    button.setAttribute('aria-label', `${empty}${startKey ? ` (currently ${value})` : ''}`);
  }

  function onClick(event) {
    if (!session) return;
    const target = event.target.closest('button');
    if (!target || target.disabled) return;
    const { dataset } = target;
    if ('planClose' in dataset) { close('close'); return; }
    if ('planNext' in dataset) { go(session.step + 1); return; }
    if ('planBack' in dataset) { go(session.step - 1); return; }
    if (dataset.planStep !== undefined) { go(Number(dataset.planStep)); return; }
    if (dataset.planYear) { setYear(Number(dataset.planYear)); return; }
    if ('planOpenHorizon' in dataset) { close('horizon'); return; }
    if ('planPrint' in dataset) { close('print'); return; }
    if (dataset.planAdventureMonth) { event.stopPropagation(); openMonthMenu(target); return; }
    if ('planCarryAdd' in dataset) { addCarried(); return; }
    if ('planAddKeydate' in dataset) {
      const draft = { id: uid('keydate'), text: '', startDate: '', endDate: '' };
      session.drafts.keydates.push(draft);
      renderStep(0, false);
      requestAnimationFrame(() => el(`[data-plan-keydate-text="${CSS.escape(draft.id)}"]`)?.focus());
      return;
    }
    const d = data();
    if (dataset.planPeriod) {
      event.stopPropagation();
      pickPeriod(target, d.misogiStartDate, d.misogiEndDate, (startDate, endDate) => {
        setMisogiPeriod(data(), startDate, endDate);
        persist();
        updateChip(target, data().misogiStartDate, data().misogiEndDate, 'Put it on the calendar');
      });
      return;
    }
    if (dataset.planMilestoneDate) {
      event.stopPropagation();
      const id = dataset.planMilestoneDate;
      const draft = session.drafts.milestones.find(entry => entry.id === id);
      const item = d.misogiMilestones.find(entry => entry.id === id);
      const y = session.year;
      ctx.openCalendar(target, item?.date || draft?.date || `${y}-01-01`, value => {
        if (!session) return;
        if (draft) draft.date = value;
        const current = data().misogiMilestones.find(entry => entry.id === id);
        if (current) { current.date = value; persist(); }
        updateChip(target, value, '', 'Date');
      }, { minKey: `${y}-01-01`, maxKey: `${y}-12-31`, align: 'end' });
      return;
    }
    if (dataset.planKeydateDate) {
      event.stopPropagation();
      const draft = session.drafts.keydates.find(entry => entry.id === dataset.planKeydateDate);
      if (!draft) return;
      pickPeriod(target, draft.startDate, draft.endDate, (startDate, endDate) => {
        draft.startDate = startDate;
        draft.endDate = endDate && endDate > startDate ? endDate : '';
        if (upsertKeyDate(data(), session.year, draft, session.created)) persist();
        updateChip(target, draft.startDate, draft.endDate, 'Choose dates');
        refreshChrome();
      });
    }
  }

  return {
    open,
    close,
    isOpen: () => !!session
  };
}
