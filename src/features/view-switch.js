import { slideIndicator } from '../ui/motion.js';

/**
 * Where you are in the planner — Day, Week or Horizon — and the controls that
 * move between them.
 *
 * - Tablets and desktops: the header's segmented control "Day · Week ·
 *   Horizon" (V switches Day and Week, Y opens Horizon).
 * - Phones: the bottom bar "Plan · Schedule · Horizon", each tab with a
 *   one-line summary of what it holds. Every `[data-view-summary="plan"]`,
 *   `"schedule"` or `"horizon"` on the page shows the same words, so the Day
 *   view's "Plan" heading stays in step with the bar. The Day / Week toggle
 *   stays in the phone header.
 *
 * Horizon is still a dialog. While it is open both controls show it as the
 * current place and stay usable (the header control above the dialog, the
 * phone bar above it and below anything opened on top of it); the rest of the
 * planner is inert; choosing Day, Week, Plan or Schedule closes it. The
 * indicators slide to the active choice (no movement with reduced motion).
 *
 * Back (src/ui/back-stack.js, `backStack`): Week, away from the Day the
 * planner opened on, holds an entry in the history, so Back goes back to Day
 * (Horizon, a dialog, holds its own). The phone's Plan and Schedule are the
 * two halves of one view, not views: switching them adds nothing to Back.
 */
export function createViewSwitch({ qs, qsa, summary, range = () => 'day', setRange = () => {}, openHorizon = () => {}, closeHorizon = () => {}, setPane = () => {}, backStack = null }) {
  let timer = 0;
  let pane = 'plan';
  let horizonOpen = false;
  const firstView = range() === 'week' ? 'week' : 'day';

  const horizonModal = () => qs('[data-horizon-modal]');

  function place(animate) {
    [['[data-view-switch-indicator]', '[data-view-option].is-active'], ['[data-mobile-view-indicator]', '[data-mobile-view].is-active']].forEach(([indicatorSelector, activeSelector]) => {
      const indicator = qs(indicatorSelector);
      const active = qs(activeSelector);
      if (indicator && active?.offsetWidth) slideIndicator(indicator, active, { animateMove: animate });
    });
  }

  /** Shows the current place on every control: the header, the phone bar and the phone's Day / Week toggle. */
  function sync({ animate = true } = {}) {
    const view = range() === 'week' ? 'week' : 'day';
    const current = horizonOpen ? 'horizon' : view;
    backStack?.view(view, { back: () => setRange(firstView) });
    qsa('[data-view-option]').forEach(button => {
      const on = button.dataset.viewOption === current;
      button.classList.toggle('is-active', on);
      button.setAttribute('aria-pressed', String(on));
    });
    const tab = horizonOpen ? 'horizon' : pane;
    qsa('[data-mobile-view]').forEach(button => {
      const on = button.dataset.mobileView === tab;
      button.classList.toggle('is-active', on);
      button.setAttribute('aria-selected', String(on));
    });
    const toggle = qs('[data-week-view]');
    if (toggle) {
      const week = view === 'week';
      toggle.classList.toggle('is-active', week);
      toggle.setAttribute('aria-pressed', String(week));
      toggle.setAttribute('aria-label', week ? 'Show day' : 'Show week');
      toggle.dataset.tooltip = week ? 'Day view' : 'Week view';
      const label = qs('[data-week-view-label]', toggle);
      if (label) label.textContent = week ? 'Day' : 'Week';
    }
    place(animate);
  }

  /** The phone's Plan / Schedule pane (called by the planner when it shows one). */
  function setActive(view, { animate = true } = {}) {
    pane = view === 'schedule' ? 'schedule' : 'plan';
    sync({ animate });
  }

  // Horizon open: the header keeps only its view control live and Horizon
  // starts below the header; on phones the bar stays above the dialog.
  function measure() {
    const top = qs('.topbar')?.getBoundingClientRect().bottom || 0;
    document.documentElement.style.setProperty('--horizon-top', `${Math.max(0, Math.round(top))}px`);
  }

  function setHorizonOpen(open) {
    if (open === horizonOpen) return;
    horizonOpen = open;
    if (open) measure();
    document.body.classList.toggle('is-horizon', open);
    qsa('.topbar > :not(.date-identity), .date-identity > :not([data-view-switch]), [data-app] > :not(.topbar):not([data-mobile-view-switch])').forEach(element => element.toggleAttribute('inert', open));
    sync();
  }

  const modal = horizonModal();
  if (modal && globalThis.MutationObserver) {
    // Opening unhides the dialog; closing removes .is-open at once and hides it 180 ms later.
    new MutationObserver(records => {
      records.forEach(record => {
        if (record.attributeName === 'hidden') setHorizonOpen(!modal.hidden);
        else if (modal.classList.contains('is-open')) setHorizonOpen(true);
        else if (/\bis-open\b/.test(record.oldValue || '')) setHorizonOpen(false);
      });
    }).observe(modal, { attributes: true, attributeFilter: ['hidden', 'class'], attributeOldValue: true });
  }

  function choose(option) {
    if (option === 'horizon') {
      if (!horizonOpen) openHorizon();
      return;
    }
    if (horizonOpen) closeHorizon();
    if (option === 'plan' || option === 'schedule') { setPane(option); return; }
    if (range() !== option) setRange(option);
    sync();
  }

  qsa('[data-view-option]').forEach(button => button.addEventListener('click', () => choose(button.dataset.viewOption)));
  qsa('[data-mobile-view]').forEach(button => button.addEventListener('click', () => choose(button.dataset.mobileView)));

  function write() {
    clearTimeout(timer);
    let text = {};
    try { text = summary() || {}; } catch (_) { text = {}; }
    qsa('[data-view-summary]').forEach(node => {
      const value = text[node.dataset.viewSummary] || '';
      if (node.textContent !== value) node.textContent = value;
    });
    const counts = text.counts;
    qsa('[data-view-progress]').forEach(node => {
      node.hidden = !counts?.total;
      node.style.setProperty('--progress', counts?.total ? (counts.done / counts.total).toFixed(3) : '0');
    });
  }

  /** Coalesces the many small edits of typing into one update. */
  function refresh() {
    clearTimeout(timer);
    timer = setTimeout(write, 90);
  }

  globalThis.addEventListener?.('resize', () => { place(false); if (horizonOpen) measure(); });
  return { setActive, sync, refresh, write, place, isHorizonOpen: () => horizonOpen };
}
