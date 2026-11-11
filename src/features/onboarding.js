import { qs, qsa } from '../lib/dom.js';
import { trackEvent } from '../lib/planner-api.js';
import { morph, panelEnter } from '../ui/motion.js';

/**
 * First-run setup: welcome, planning days and hours, the daily loop, and the
 * year (Horizon, appearance, install). Four short steps; each one has its own
 * illustration on the left that mirrors the planner itself. Finishing hands
 * over to the planner tour (src/features/tour.js).
 *
 * It can't be dismissed (no close button; 1.36: index.html marks it
 * data-modal-keep, so Escape no longer closes it either): it ends with
 * Finish. Back (the phone's, the browser's) goes one step back, and on the
 * first step does nothing (src/ui/back-stack.js).
 */

const STEP_COUNT = 4;
const PREVIEW_DAYS = [[1, 'Mon'], [2, 'Tue'], [3, 'Wed'], [4, 'Thu'], [5, 'Fri'], [6, 'Sat'], [0, 'Sun']];

/** Sample blocks at real times, so the week preview shows what "Show my day from" does. */
export const PREVIEW_BLOCKS = [
  { kind: 'deep', start: 9 * 60, end: 11 * 60, days: [1, 2, 3, 4, 5] },
  { kind: 'short', start: 13 * 60, end: 13 * 60 + 30, days: [1, 3, 5, 6] },
  { kind: 'late', start: 17 * 60 + 30, end: 18 * 60, days: [1, 2, 4, 0] }
];

/**
 * Hour ruler for a visible range: both edges plus a few round hours between
 * them (every 1, 2, 3, 4, 6… hours so there are never more than five gaps),
 * skipping any that would crowd an edge. `at` is a percentage of the range.
 */
export function rulerTicks(startHour, endHour) {
  const span = Math.max(1, endHour - startHour);
  const step = [1, 2, 3, 4, 6, 8, 12].find(value => span / value <= 5) || 12;
  const at = hour => ((hour - startHour) / span) * 100;
  const ticks = [{ hour: startHour, at: 0, edge: true }];
  for (let hour = (Math.floor(startHour / step) + 1) * step; hour < endHour; hour += step) {
    if (hour - startHour >= step / 2 && endHour - hour >= step / 2) ticks.push({ hour, at: at(hour), edge: false });
  }
  ticks.push({ hour: endHour, at: 100, edge: true });
  return ticks;
}

/** Where each sample block sits in the visible range (pure, unit-tested). */
export function weekPreviewLayout(startHour, endHour) {
  const from = startHour * 60;
  const span = Math.max(1, endHour - startHour) * 60;
  const at = minutes => ((minutes - from) / span) * 100;
  return {
    ticks: rulerTicks(startHour, endHour),
    blocks: PREVIEW_BLOCKS.map(block => {
      const top = at(block.start);
      const bottom = at(block.end);
      return { kind: block.kind, top, height: bottom - top, outside: bottom <= 0 || top >= 100, clipped: top < 0 || bottom > 100 };
    })
  };
}

export function createOnboarding({ settings, persistSettings, startHour, endHour, time, chevronSvg, openListPopover, openModal, closeModal, seedFirstBlock, afterFinish, openInstall, keepTheme = () => {}, startTour = () => {} }) {
  let step = 1;
  let draftDays = new Set([1, 2, 3, 4, 5]);
  let shownRange = null;
  const modal = () => qs('[data-onboarding-modal]');
  const panel = () => qs('[data-onboarding-panel]');

  function buildWeekPreview(root) {
    const blocks = day => PREVIEW_BLOCKS.map((block, index) => (block.days.includes(day) ? `<i class="ob-week__block ob-week__block--${block.kind}" data-ob-block="${index}"></i>` : '')).join('');
    root.innerHTML = `<span class="ob-week__ruler"><b></b><span class="ob-week__track" data-ob-ruler></span></span>${PREVIEW_DAYS.map(([day, label]) => `<span class="ob-week__col" data-ob-day="${day}"><b>${label}</b><span class="ob-week__track">${blocks(day)}</span></span>`).join('')}`;
  }

  /**
   * Keyed hour marks (ruler labels or grid lines). When the range changes they
   * slide with the scale: kept hours glide to their new place, new hours come
   * in from where they were, and hours that left fade out where they now fall.
   */
  function syncMarks(container, ticks, range, previous, make) {
    const place = (hour, r) => `${((hour - r.start) / Math.max(1, r.end - r.start)) * 100}%`;
    const current = new Map([...container.children].filter(el => el.dataset.hour && !el.dataset.leaving).map(el => [Number(el.dataset.hour), el]));
    ticks.forEach(tick => {
      let el = current.get(tick.hour);
      const isNew = !el;
      const before = el?.style.top;
      if (isNew) { el = make(tick); el.dataset.hour = String(tick.hour); container.prepend(el); } else current.delete(tick.hour);
      el.classList.toggle('is-edge', tick.edge);
      el.style.top = place(tick.hour, range);
      if (previous) morph(el, isNew ? { top: place(tick.hour, previous), opacity: 0 } : { top: before }, { top: el.style.top, opacity: 1 });
    });
    current.forEach((el, hour) => {
      if (!previous) { el.remove(); return; }
      el.dataset.leaving = 'true';
      const before = el.style.top;
      el.style.top = place(hour, range);
      morph(el, { top: before, opacity: 1 }, { top: el.style.top, opacity: 0 }).then(() => el.remove());
    });
  }

  function renderWeekPreview() {
    const root = qs('[data-ob-week]');
    if (!root) return;
    if (!root.childElementCount) buildWeekPreview(root);
    qsa('[data-ob-day]', root).forEach(column => column.classList.toggle('is-on', draftDays.has(Number(column.dataset.obDay))));
    const range = { start: startHour(), end: endHour() };
    const changed = shownRange && (shownRange.start !== range.start || shownRange.end !== range.end);
    // Only a visible change is animated; reduced motion lands on the final layout.
    const previous = changed && step === 2 && !modal()?.hidden ? shownRange : null;
    shownRange = range;
    const layout = weekPreviewLayout(range.start, range.end);
    syncMarks(qs('[data-ob-ruler]', root), layout.ticks, range, previous, tick => {
      const mark = document.createElement('span');
      mark.className = 'ob-week__mark';
      mark.innerHTML = `<em>${time(tick.hour * 60)}</em>`;
      return mark;
    });
    const lines = layout.ticks.filter(tick => !tick.edge);
    qsa('.ob-week__col .ob-week__track', root).forEach(track => syncMarks(track, lines, range, previous, () => {
      const line = document.createElement('i');
      line.className = 'ob-week__line';
      return line;
    }));
    qsa('[data-ob-block]', root).forEach(el => {
      const block = layout.blocks[Number(el.dataset.obBlock)];
      const before = { top: el.style.top, height: el.style.height, opacity: el.classList.contains('is-outside') ? 0 : 1 };
      el.style.top = `${block.top}%`;
      el.style.height = `${block.height}%`;
      el.classList.toggle('is-outside', block.outside);
      if (previous) morph(el, before, { top: el.style.top, height: el.style.height, opacity: block.outside ? 0 : 1 });
    });
  }

  function render({ direction = 0 } = {}) {
    panel()?.setAttribute('data-step', String(step));
    qsa('[data-onboarding-step]').forEach(element => { element.hidden = Number(element.dataset.onboardingStep) !== step; });
    qsa('[data-onboarding-progress]').forEach(segment => {
      const index = Number(segment.dataset.onboardingProgress);
      segment.classList.toggle('is-complete', index < step);
      segment.classList.toggle('is-active', index === step);
    });
    qsa('[data-onboarding-day]').forEach(button => {
      const selected = draftDays.has(Number(button.dataset.onboardingDay));
      button.classList.toggle('is-selected', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
    renderWeekPreview();
    const start = qs('[data-onboarding-start-hour]');
    const end = qs('[data-onboarding-end-hour]');
    if (start) start.innerHTML = `<span class="select-trigger__value">${time(startHour() * 60)}</span>${chevronSvg()}`;
    if (end) end.innerHTML = `<span class="select-trigger__value">${time(endHour() * 60)}</span>${chevronSvg()}`;
    if (direction) {
      panelEnter(qs(`[data-onboarding-step="${step}"]`), { direction, distance: 16 });
      panelEnter(qs(`.ob-scene--${step}`));
    }
  }

  function go(next) {
    const target = Math.max(1, Math.min(STEP_COUNT, next));
    const direction = Math.sign(target - step) || 0;
    step = target;
    render({ direction });
    requestAnimationFrame(() => qs(`[data-onboarding-step="${step}"] .onboarding-primary`)?.focus({ preventScroll: true }));
  }

  function openHourMenu(kind) {
    const isStart = kind === 'start';
    const button = qs(isStart ? '[data-onboarding-start-hour]' : '[data-onboarding-end-hour]');
    const currentStart = startHour();
    const currentEnd = endHour();
    const values = isStart
      ? Array.from({ length: currentEnd }, (_, i) => i)
      : Array.from({ length: 24 - currentStart }, (_, i) => currentStart + 1 + i);
    openListPopover(button, values.map(v => ({ value: v, label: time(v * 60) })), isStart ? currentStart : currentEnd, item => {
      const s = settings();
      if (isStart) s.startHour = Number(item.value);
      else s.endHour = Number(item.value);
      if (s.endHour <= s.startHour) s.endHour = Math.min(24, s.startHour + 1);
      render();
    }, { compact: true, matchWidth: true, alignSelected: true, timeMenu: true, label: isStart ? 'Show my day from' : 'Show my day until' });
  }

  function finish({ thenInstall = false } = {}) {
    const s = settings();
    s.planningDays = [...draftDays].sort((a, b) => a - b);
    s.onboardingComplete = true;
    // Setup offers Light and Dark only: the one shown (the system's, unless clicked) is kept as the choice.
    keepTheme();
    seedFirstBlock();
    persistSettings();
    closeModal(modal());
    trackEvent('onboarding_completed');
    afterFinish();
    if (thenInstall) setTimeout(openInstall, 260);
    // Then a short tour of the planner itself, once it is on screen (after the Install dialog when chosen).
    startTour();
  }

  function maybeOpen() {
    const s = settings();
    if (s.onboardingComplete) return false;
    step = 1;
    draftDays = new Set(Array.isArray(s.planningDays) && s.planningDays.length ? s.planningDays : [1, 2, 3, 4, 5]);
    render();
    openModal(modal(), qs('[data-onboarding-step="1"] .onboarding-primary'), { back: () => { if (step > 1) go(step - 1); return true; } });
    return true;
  }

  qsa('[data-onboarding-go]').forEach(button => button.addEventListener('click', () => go(Number(button.dataset.onboardingGo) || 1)));
  qsa('[data-onboarding-day]').forEach(button => button.addEventListener('click', () => {
    const day = Number(button.dataset.onboardingDay);
    if (draftDays.has(day)) { if (draftDays.size > 1) draftDays.delete(day); } else draftDays.add(day);
    render();
  }));
  qs('[data-onboarding-start-hour]')?.addEventListener('click', () => openHourMenu('start'));
  qs('[data-onboarding-end-hour]')?.addEventListener('click', () => openHourMenu('end'));
  qs('[data-onboarding-finish]')?.addEventListener('click', () => finish());
  qs('[data-onboarding-install]')?.addEventListener('click', () => finish({ thenInstall: true }));
  modal()?.addEventListener('keydown', event => {
    if (event.key !== 'Enter' || event.target.closest('button, a, input, textarea, .app-popover')) return;
    event.preventDefault();
    if (step < STEP_COUNT) go(step + 1); else finish();
  });

  return { maybeOpen, go };
}
