import { qs, qsa } from '../lib/dom.js';
import { prefersReducedMotion } from '../ui/motion.js';
import { anyTipSeen, buildGuideSteps, canShowGuide, coveredBy, GUIDE_DIALOGS, markSeen, pickGuide, readTipsFlags, switchTips, TIPS_FLAG_KEY, tipsOn } from './first-use-model.js';
import { tourEnvironment } from './tour-model.js';

/**
 * Contextual first-use guides: the first time someone opens one of the main
 * dialogs (src/features/first-use-model.js lists them and their steps), a
 * short guide runs inside it on the tour's spotlight and card
 * (src/features/tour.js), then never again on this device.
 *
 * It watches the dialogs themselves (a dialog is open once it has
 * `is-open`; the weekly review is the day-closed dialog's `review` stage)
 * and waits a moment after one opens, so the dialog has arrived and its
 * first field has focus. Anything the person does meanwhile — a key, a click,
 * typing — puts the guide off to another time: it never interrupts. It only
 * answers a person (navigator.userActivation: not a dialog the planner or a
 * script opened by itself), never runs during the tour, over another guide,
 * over a menu or picker, or while the floating window is open.
 *
 * How it works → Tips is a switch: off, no guide shows; back on, every guide
 * shows again, each the next time its dialog opens (tipsOn, switchTips).
 */

const isVisible = el => !!el && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden';

/** What How it works → Tips says once the switch is turned on or off. */
export const TIPS_NOTES = Object.freeze({
  on: 'Back on: each dialog shows its tips again the next time you open it.',
  off: 'Off: dialogs open without tips.'
});
const isOpen = modal => !!modal && !modal.hidden && modal.classList.contains('is-open');

export function createFirstUse({ tour, isReady = () => true, isFloating = () => false, getActiveModal = () => null, storage = globalThis.localStorage } = {}) {
  let timer = 0;
  let waiting = null;

  function readFlags() {
    try { return readTipsFlags(storage?.getItem(TIPS_FLAG_KEY)); } catch (_) { return readTipsFlags(null); }
  }

  function writeFlags(flags) {
    try {
      if (anyTipSeen(flags)) storage?.setItem(TIPS_FLAG_KEY, JSON.stringify(flags));
      else storage?.removeItem(TIPS_FLAG_KEY);
    } catch (_) {}
  }

  /** What the dialog shows now, for the guide that fits it. */
  function contextOf(dialog, modal) {
    if (dialog === 'block') return { mode: qs('[data-block-done]', modal)?.hidden === false ? 'edit' : 'add' };
    if (dialog === 'dayClosed') return { stage: modal.dataset.stage || '' };
    if (dialog === 'stats') {
      const view = qs('[data-stats-view].is-active', modal)?.dataset.statsView || 'day';
      const insights = qs('[data-insights]', modal);
      const state = !insights ? '' : insights.classList.contains('is-thin') ? 'thin' : 'ready';
      return { view, insights: state };
    }
    return {};
  }

  const matches = query => !!globalThis.matchMedia?.(query)?.matches;

  function stepsFor(id, modal, context, env) {
    const visible = selector => qsa(selector, modal).some(isVisible);
    return buildGuideSteps(id, { ...env, visible, context });
  }

  // Anything the person does while a guide waits (a key, a press, typing) puts it off.
  const INTERACTIONS = ['keydown', 'pointerdown', 'input'];

  function cancel() {
    clearTimeout(timer);
    timer = 0;
    if (!waiting) return;
    INTERACTIONS.forEach(type => document.removeEventListener(type, cancel, true));
    waiting = null;
  }

  function attempt() {
    const { dialog, modal, person } = waiting || {};
    cancel();
    if (!modal) return;
    // The top dialog only (a confirmation above it, or Horizon's own overlays, take over).
    const top = getActiveModal() === modal && !qs('.hz-overlay', modal);
    if (!canShowGuide({ ready: isReady(), person, busy: tour.isActive(), floating: isFloating(), open: isOpen(modal) && top, popover: !!qs('.app-popover') })) return;
    const context = contextOf(dialog, modal);
    const flags = readFlags();
    const id = pickGuide(dialog, context, flags.seen);
    if (!id) return;
    const steps = stepsFor(id, modal, context, tourEnvironment(matches));
    if (!steps.length) return;
    const shown = tour.guide({ steps, scope: modal, rebuild: env => stepsFor(id, modal, contextOf(dialog, modal), env) });
    if (shown) writeFlags(markSeen(flags, coveredBy(id, context), new Date().toISOString()));
  }

  /** A dialog just opened (or changed to a view with its own guide): try in a moment. */
  function schedule(dialog, modal) {
    if (tour.isActive()) return;
    cancel();
    // Opened by a person (a click or a key just now), not by the planner on its own.
    const person = navigator.userActivation ? navigator.userActivation.isActive : true;
    if (!person) return;
    waiting = { dialog, modal, person };
    INTERACTIONS.forEach(type => document.addEventListener(type, cancel, true));
    timer = setTimeout(attempt, prefersReducedMotion() ? 220 : 460);
  }

  Object.entries(GUIDE_DIALOGS).forEach(([dialog, selector]) => {
    const modal = qs(selector);
    if (!modal) return;
    new MutationObserver(records => records.forEach(record => {
      if (record.attributeName === 'data-stage') {
        if (dialog === 'dayClosed' && isOpen(modal) && modal.dataset.stage === 'review' && record.oldValue !== 'review') schedule(dialog, modal);
        return;
      }
      const was = /(^|\s)is-open(\s|$)/.test(record.oldValue || '');
      const now = modal.classList.contains('is-open');
      if (!was && now) schedule(dialog, modal);
      if (was && !now) { if (waiting?.modal === modal) cancel(); tour.endGuide(modal); }
    })).observe(modal, { attributes: true, attributeFilter: ['class', 'data-stage'], attributeOldValue: true });
  });

  // Switching Time stats to Insights, or Unresolved to its other list, can bring its guide.
  document.addEventListener('click', event => {
    const tab = event.target.closest?.('[data-stats-view], [data-open-work-view]');
    const modal = tab?.closest('.modal');
    const dialog = Object.keys(GUIDE_DIALOGS).find(key => modal?.matches(GUIDE_DIALOGS[key]));
    if (dialog && isOpen(modal)) requestAnimationFrame(() => schedule(dialog, modal));
  });

  // How it works → Tips: a switch, on while a guide is still to come; its line says what a change does.
  const row = qs('[data-tips-row]');
  const toggle = qs('[data-tips-switch]', row || document);
  const copy = qs('[data-tips-copy]', row || document);
  const sync = () => {
    if (!toggle) return;
    toggle.checked = tipsOn(readFlags());
    if (copy) copy.textContent = copy.dataset.tipsCopy || copy.textContent;
  };
  if (copy && !copy.dataset.tipsCopy) copy.dataset.tipsCopy = copy.textContent;
  toggle?.addEventListener('change', () => {
    writeFlags(switchTips(readFlags(), toggle.checked, new Date().toISOString()));
    if (copy) copy.textContent = toggle.checked ? TIPS_NOTES.on : TIPS_NOTES.off;
  });
  const help = qs('[data-help-modal]');
  if (help) new MutationObserver(() => { if (!help.hidden) sync(); }).observe(help, { attributes: true, attributeFilter: ['hidden'] });
  sync();

  return {
    /** Every guide shows again (How it works → Show tips again). */
    reset: () => writeFlags({ seen: {} }),
    seen: () => readFlags().seen
  };
}
