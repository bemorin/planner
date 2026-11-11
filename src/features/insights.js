import { atNoon, ymdKey } from '../lib/dates.js';
import { TOOLTIP_MARGIN, insetRect, intersectRects, placeTooltipWithin, scrollPortRect, visibleViewportRect } from '../ui/tooltip.js';
import { RANGE_KINDS, buildInsights, insightsRange } from './insights-model.js';
import { renderInsights } from './insights-view.js';
import { toggleHeight } from '../ui/motion.js';

/**
 * Insights, the third view of the Stats dialog.
 *
 * Owns the period (4 weeks, a quarter or a year, stepped back and forth), a
 * per-period cache of the model (and of each past day's facts, so switching
 * periods reads nothing twice), the shared chart tooltip, roving keyboard focus
 * inside each chart and the table toggles.
 *
 * The Stats dialog re-renders on a timer: render() is a no-op unless the
 * period or the data changed (invalidate() runs when the dialog opens),
 * so a reader never loses their place.
 *
 * @param {object} ctx
 * @param {(key: string) => object|null} ctx.readDay stored day record (today: the live state)
 * @param {(id: string) => object|null} ctx.categoryFor
 * @param {() => number[]} ctx.planningDays
 * @param {() => number} ctx.weekStartsOn
 * @param {() => {startHour: number, endHour: number}} ctx.hours visible schedule hours
 * @param {() => string[]} ctx.dayKeys stored keys, to find the first year with data
 * @param {() => HTMLElement|null} ctx.modal the Stats dialog
 */
// A reading keeps this far inside its card's edge and the scroll area's.
const TIP_INSET = 4;

export function createInsightsFeature(ctx) {
  let kind = 'year';
  let anchor = '';
  let facts = new Map();
  const models = new Map();
  let stale = true;
  let signature = '';
  let firstYear = null;
  let currentRange = null;
  let tipEl = null;
  let hot = null;
  const bound = new WeakSet();

  const todayKey = () => ymdKey(atNoon(new Date()));

  function earliestYear() {
    if (firstYear !== null) return firstYear;
    let year = new Date().getFullYear();
    try {
      (ctx.dayKeys?.() || []).forEach(key => {
        const match = /^daily-planner:(\d{4})-\d{2}-\d{2}$/.exec(key);
        if (match) year = Math.min(year, Number(match[1]));
      });
    } catch (_) {}
    firstYear = year;
    return year;
  }

  function modelFor(today) {
    const minYear = earliestYear();
    const weekStartsOn = Number(ctx.weekStartsOn?.() ?? 1);
    const range = insightsRange(kind, anchor || today, today, { weekStartsOn, minYear });
    const key = `${range.kind}|${range.anchorKey}|${today}|${weekStartsOn}`;
    if (models.has(key)) return models.get(key);
    const { startHour = 7, endHour = 20 } = ctx.hours?.() || {};
    const started = globalThis.performance?.now?.() ?? Date.now();
    const model = buildInsights({
      range,
      readDay: ctx.readDay,
      categoryFor: ctx.categoryFor,
      planningDays: ctx.planningDays?.() || [1, 2, 3, 4, 5],
      todayKey: today,
      weekStartsOn,
      startHour,
      endHour,
      cache: facts
    });
    model.buildMs = Math.round(((globalThis.performance?.now?.() ?? Date.now()) - started) * 10) / 10;
    models.set(key, model);
    return model;
  }

  // -------------------------------------------------------------------------
  // Tooltip: one floating element for every chart, filled with textContent.
  // -------------------------------------------------------------------------

  function tooltip() {
    if (tipEl?.isConnected) return tipEl;
    tipEl = document.createElement('div');
    tipEl.className = 'ins-tip';
    tipEl.setAttribute('aria-hidden', 'true');
    tipEl.hidden = true;
    document.body.append(tipEl);
    return tipEl;
  }

  function showTip(target) {
    let data = null;
    try { data = JSON.parse(target.dataset.tip || 'null'); } catch (_) { data = null; }
    if (!data) return;
    if (hot && hot !== target) hot.classList.remove('is-hot');
    hot = target;
    target.classList.add('is-hot');
    const el = tooltip();
    el.replaceChildren();
    const title = document.createElement('span');
    title.className = 'ins-tip__title';
    title.textContent = String(data.t || '');
    el.append(title);
    (Array.isArray(data.r) ? data.r : []).forEach(([color, value, label]) => {
      const row = document.createElement('span');
      row.className = 'ins-tip__row';
      const key = document.createElement('i');
      key.style.background = String(color || '');
      const strong = document.createElement('strong');
      strong.textContent = String(value ?? '');
      const small = document.createElement('small');
      small.textContent = String(label ?? '');
      row.append(key, strong, small);
      el.append(row);
    });
    el.hidden = false;
    // Measured at the left edge, so its width isn't squeezed by where the last reading stood,
    // and never wider than what shows (a phone zoomed in).
    const areas = tipAreas(target);
    const limit = areas[areas.length - 1];
    el.style.left = '0px';
    el.style.top = '0px';
    el.style.setProperty('--ins-tip-room', limit ? `${Math.floor(limit.right - limit.left)}px` : '100vw');
    const size = el.getBoundingClientRect();
    const place = placeTooltipWithin(target.getBoundingClientRect(), { width: size.width, height: size.height }, areas);
    el.style.left = `${place.left}px`;
    el.style.top = `${place.top}px`;
    el.dataset.placement = place.placement;
  }

  /**
   * Where a mark's reading may go: inside its chart's card, as much of it as
   * shows in the dialog's scroll area and on screen (the visual viewport on a
   * phone); failing that, anywhere in that visible scroll area — never over
   * the dialog's edges.
   */
  function tipAreas(target) {
    const screen = insetRect(visibleViewportRect(), TOOLTIP_MARGIN);
    const scroller = target.closest('.modal__scroll');
    const port = scroller ? intersectRects(insetRect(scrollPortRect(scroller), TIP_INSET), screen) : screen;
    const card = target.closest('.ins-card');
    return [card && port ? intersectRects(insetRect(card.getBoundingClientRect(), TIP_INSET), port) : null, port || screen];
  }

  function hideTip() {
    if (hot) hot.classList.remove('is-hot');
    hot = null;
    if (tipEl) tipEl.hidden = true;
  }

  // -------------------------------------------------------------------------
  // Rendering and bindings
  // -------------------------------------------------------------------------

  function prepareCharts(root) {
    root.querySelectorAll('[data-ins-chart]').forEach(chart => {
      chart.querySelectorAll('[data-tip]').forEach((mark, index) => mark.setAttribute('tabindex', index ? '-1' : '0'));
    });
  }

  function moveInChart(chart, from, key) {
    const marks = [...chart.querySelectorAll('[data-tip]')];
    const index = marks.indexOf(from);
    if (index < 0) return false;
    const cols = Number(chart.dataset.cols) || 0;
    const step = { ArrowRight: 1, ArrowLeft: -1, ArrowDown: cols || 1, ArrowUp: -(cols || 1), Home: -index, End: marks.length - 1 - index }[key];
    if (step === undefined) return false;
    const next = marks[Math.max(0, Math.min(marks.length - 1, index + step))];
    if (next && next !== from) {
      from.setAttribute('tabindex', '-1');
      next.setAttribute('tabindex', '0');
      next.focus({ preventScroll: false });
    }
    return true;
  }

  function setPeriod(nextKind, nextAnchor, focusSelector = '') {
    if (RANGE_KINDS.includes(nextKind)) kind = nextKind;
    anchor = nextAnchor || anchor;
    signature = '';
    const wrap = ctx.modal?.()?.querySelector('[data-stats-content]');
    if (!wrap) return;
    const scroller = wrap.closest('.modal__scroll');
    const top = scroller?.scrollTop || 0;
    render(wrap);
    if (scroller) scroller.scrollTop = top;
    if (focusSelector) wrap.querySelector(focusSelector)?.focus({ preventScroll: true });
  }

  function bind(wrap) {
    if (bound.has(wrap)) return;
    bound.add(wrap);
    wrap.addEventListener('click', event => {
      const choice = event.target.closest('[data-ins-kind]');
      if (choice && wrap.contains(choice)) { setPeriod(choice.dataset.insKind, currentRange?.endKey || '', `[data-ins-kind="${choice.dataset.insKind}"]`); return; }
      const step = event.target.closest('[data-ins-step]');
      if (step && !step.disabled) {
        const forward = step.dataset.insStep === '1';
        const target = forward ? currentRange?.nextAnchor : currentRange?.prevAnchor;
        if (target) setPeriod(kind, target, `[data-ins-step="${step.dataset.insStep}"]:not([disabled])`);
        return;
      }
      const toggle = event.target.closest('[data-ins-table]');
      if (toggle) {
        const table = wrap.querySelector(`#${CSS.escape(toggle.dataset.insTable)}`);
        if (!table || table.dataset.folding) return;
        // The table unfolds and folds back by its height (1.38), instead of appearing at once.
        const opening = table.hidden;
        toggle.setAttribute('aria-expanded', String(opening));
        toggle.textContent = opening ? 'Hide table' : 'Show table';
        if (opening) {
          table.hidden = false;
          toggleHeight(table, true);
        } else {
          table.dataset.folding = 'true';
          toggleHeight(table, false, () => { table.hidden = true; delete table.dataset.folding; });
        }
      }
    });
    wrap.addEventListener('keydown', event => {
      const radio = event.target.closest?.('[data-ins-kind]');
      if (radio && ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) {
        event.preventDefault();
        const index = RANGE_KINDS.indexOf(radio.dataset.insKind);
        const next = RANGE_KINDS[(index + (event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? 2 : 1)) % 3];
        setPeriod(next, currentRange?.endKey || '', `[data-ins-kind="${next}"]`);
        return;
      }
      const mark = event.target.closest?.('[data-tip]');
      const chart = mark?.closest('[data-ins-chart]');
      if (chart && moveInChart(chart, mark, event.key)) { event.preventDefault(); return; }
      if (event.key === 'Escape' && hot) { hideTip(); event.stopPropagation(); }
    });
    wrap.addEventListener('pointerover', event => {
      if (event.pointerType === 'touch') return;
      const mark = event.target.closest?.('[data-tip]');
      if (mark && wrap.contains(mark)) showTip(mark);
    });
    wrap.addEventListener('pointerout', event => {
      const mark = event.target.closest?.('[data-tip]');
      if (mark && !mark.contains(event.relatedTarget)) hideTip();
    });
    // A tap shows the reading (phones have no hover); a tap elsewhere hides it.
    wrap.addEventListener('pointerup', event => {
      if (event.pointerType !== 'touch') return;
      const mark = event.target.closest?.('[data-tip]');
      if (mark && wrap.contains(mark)) showTip(mark); else hideTip();
    });
    wrap.addEventListener('focusin', event => {
      const mark = event.target.closest?.('[data-tip]');
      if (mark) showTip(mark);
    });
    wrap.addEventListener('focusout', event => {
      if (event.target.closest?.('[data-tip]')) hideTip();
    });
    // Scrolling (the dialog, or a phone's zoomed view) moves a focused mark's reading with it; a pointer reading simply goes.
    const follow = () => { if (hot && hot === document.activeElement && hot.isConnected) showTip(hot); else hideTip(); };
    wrap.closest('.modal__scroll')?.addEventListener('scroll', follow, { passive: true });
    globalThis.visualViewport?.addEventListener('scroll', () => { if (hot) follow(); }, { passive: true });
    globalThis.visualViewport?.addEventListener('resize', () => { if (hot) follow(); }, { passive: true });
  }

  /** Render into the Stats dialog's content area. */
  function render(wrap) {
    if (!wrap) return;
    const modal = ctx.modal?.();
    const visible = !!modal && !modal.hidden;
    if (!visible && !stale) return;
    const today = todayKey();
    const nextSignature = `${kind}|${anchor}|${today}`;
    if (!stale && nextSignature === signature && wrap.querySelector('[data-insights]')) return;
    stale = false;
    signature = nextSignature;
    hideTip();
    const model = modelFor(today);
    currentRange = model.range;
    anchor = model.range.anchorKey;
    signature = `${kind}|${anchor}|${today}`;
    wrap.innerHTML = renderInsights(model);
    const root = wrap.querySelector('[data-insights]');
    if (root) root.dataset.buildMs = String(model.buildMs);
    prepareCharts(wrap);
    bind(wrap);
  }

  return {
    render,
    /** The data may have changed (the dialog is opening): rebuild on the next render. */
    invalidate() {
      facts = new Map();
      models.clear();
      firstYear = null;
      stale = true;
      signature = '';
    },
    /** Open on a year (from Horizon → Progress) or on the current period. */
    focusYear(year) {
      const value = Number(year);
      if (Number.isFinite(value) && value > 1999) {
        kind = 'year';
        anchor = value >= new Date().getFullYear() ? '' : `${value}-12-31`;
      }
    },
    /** Header for the Stats dialog while Insights shows. */
    header: () => ({ eyebrow: 'Insights', title: 'What your days add up to' }),
    hideTip
  };
}

export { renderInsightsEntry } from './insights-view.js';
