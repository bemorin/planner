import { esc, escAttr } from '../lib/text.js';
import { uid } from '../lib/utils.js';
import { rangeLabel } from './horizon-model.js';
import { panelEnter } from '../ui/motion.js';
import { syncScrollRegion, watchScrollRegion } from '../lib/dom.js';
import { progressIcon, renderPaintLegend } from './progress-view.js';
import { hoursLabel } from './year-review.js';
import {
  QUARTER_ICONS, QUARTER_MINUTES, MAX_ANSWER, MAX_FOCUS, applyDates, buildQuarterReview, carryState, checkInOptions,
  completeQuarterReview, defaultCheckInQuarter, leftovers, moveOptions, nextHabitEditable, nextQuarter, previousQuarter, quarterEntry,
  quarterId, quarterLabel, quarterLead, quarterMonths, sameQuarter, setItemDone, setNextHabit, setQuarterAnswer, toggleCarry
} from './quarter-review.js';
import { fitQuarterAnswers, renderQuarterPrint } from './quarter-print.js';

/**
 * The guided quarter check-in, in the visual language of
 * "Plan your year": a rail of four steps — look back, reflect, the next
 * quarter, done — rendered in the overlay horizon-view.js provides. Every
 * answer and choice is written to Horizon as it is made, so leaving half-way
 * never loses anything; "Print this quarter" puts it on one landscape page.
 */

export const QUARTER_STEPS = [
  { id: 'lookback', label: 'Look back', icon: 'history', minutes: 3 },
  { id: 'reflect', label: 'Reflect', icon: 'pen', minutes: 3 },
  { id: 'next', label: 'Next quarter', icon: 'next', minutes: 4 },
  { id: 'done', label: 'Your quarter', icon: 'sparkle', minutes: 0 }
];

const clampStep = index => Math.min(QUARTER_STEPS.length - 1, Math.max(0, Number(index) || 0));
const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;
const itemRef = item => `${item.kind}:${item.id}`;
const KIND_LABELS = { milestone: 'Milestone', adventure: 'Mini-adventure' };
const PAINT_CLASSES = { l1: 'is-closed is-level-1', l2: 'is-closed is-level-2', l3: 'is-closed is-level-3', today: 'is-today', future: 'is-future', before: 'is-before', empty: 'is-before', joker: 'is-joker', missed: 'is-missed', rest: 'is-rest' };

/** Grow a bordered textarea to its content. */
function grow(field) {
  if (!field) return;
  field.style.height = 'auto';
  field.style.height = `${field.scrollHeight + (field.offsetHeight - field.clientHeight)}px`;
}

function ring(value, size = 52) {
  const progress = Math.max(0, Math.min(1, Number(value) || 0));
  const radius = (size - 5) / 2;
  const length = 2 * Math.PI * radius;
  const center = size / 2;
  return `<svg class="qr-ring" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" aria-hidden="true"><circle class="qr-ring__track" cx="${center}" cy="${center}" r="${radius}"/><circle class="qr-ring__value" cx="${center}" cy="${center}" r="${radius}" stroke-dasharray="${length.toFixed(2)}" stroke-dashoffset="${(length * (1 - progress)).toFixed(2)}" transform="rotate(-90 ${center} ${center})"/></svg>`;
}

/**
 * @param {object} options
 * @param {object} options.ctx Horizon context (yearData, persist, progress, readDay, categoryFor, weekStartsOn?, minYear, confirm, closeAllPopovers)
 * @param {Function} options.overlay mounts an overlay over the Horizon dialog
 * @param {(name: string, className?: string) => string} options.icon
 * @param {(at: {year: number, quarter: number}, target: 'close'|'horizon', typed: boolean) => void} [options.onLeave]
 */
export function createQuarterReview({ ctx, overlay, icon, onLeave }) {
  let session = null;

  const glyph = (name, className = '') => (QUARTER_ICONS[name] ? `<svg${className ? ` class="${className}"` : ''} viewBox="0 0 24 24" aria-hidden="true">${QUARTER_ICONS[name]}</svg>` : icon(name, className));
  const today = () => new Date();
  const at = () => ({ year: session.year, quarter: session.quarter });
  const nextAt = () => nextQuarter(at());
  const data = () => ctx.yearData(session.year);
  const nextData = () => ctx.yearData(nextAt().year);
  const persist = () => { session.typed = true; ctx.persist(); };
  const el = selector => session?.handle.el.querySelector(selector);

  /** The previous quarter's check-in (its focus is recalled), unless that year was never in Horizon. */
  function previousEntry() {
    const previous = previousQuarter(at());
    if (previous.year !== session.year && previous.year < (Number(ctx.minYear?.()) || previous.year)) return null;
    return quarterEntry(ctx.yearData(previous.year), previous.quarter);
  }

  function model() {
    const { year, quarter } = session;
    const next = nextAt();
    return buildQuarterReview({
      year,
      quarter,
      progress: ctx.progress(year),
      yearData: data(),
      nextYearData: next.year === year ? null : nextData(),
      previousEntry: previousEntry(),
      readDay: key => ctx.readDay?.(key) ?? null,
      categoryFor: id => ctx.categoryFor?.(id) ?? null,
      weekStartsOn: ctx.weekStartsOn?.() ?? 1,
      today: today()
    });
  }

  function snapshot() {
    session.leftovers = leftovers(data(), session.year, session.quarter);
  }

  /** A check-in already done opens on its summary (answers, print); another starts with the look back. */
  function landOn() {
    const done = quarterEntry(data(), session.quarter).done;
    session.step = done ? QUARTER_STEPS.length - 1 : 0;
    session.completed = done;
  }

  function open(requested = null) {
    if (session) return;
    const options = checkInOptions(today(), ctx.minYear?.());
    const wanted = requested && options.find(option => sameQuarter(option, requested)) ? requested : defaultCheckInQuarter(today());
    session = { year: wanted.year, quarter: wanted.quarter, step: 0, typed: false, completed: false, handle: null, leftovers: [] };
    landOn();
    snapshot();
    session.handle = overlay({
      className: 'yp qr',
      label: `${quarterLabel(at())} check-in`,
      onEscape: requestLeave,
      onKey: key => { if (key === 'p' || key === 'P') { print(); return true; } return false; }
    });
    const root = session.handle.el;
    root.innerHTML = shell();
    // Each step scrolls inside the overlay: by keyboard too, as a region named after the step, while it overflows.
    session.unwatchScroll = watchScrollRegion(root.querySelector('[data-quarter-scroll]'), stepRegionName);
    root.addEventListener('click', onClick);
    root.addEventListener('input', onInput);
    root.addEventListener('change', onChange);
    root.addEventListener('keydown', onKeydown);
    renderStep(0);
  }

  /** target: 'close' (× or Escape) or 'horizon' (Open Horizon). */
  function close(target = 'close', { silent = false } = {}) {
    if (!session) return;
    const { handle, typed, unwatchScroll } = session;
    const where = at();
    session = null;
    unwatchScroll?.();
    handle.close({ restoreFocus: !silent });
    if (!silent) onLeave?.(where, target, typed);
  }

  function requestLeave() {
    if (!session) return;
    if (!session.typed || session.step === QUARTER_STEPS.length - 1) { close(); return; }
    ctx.confirm({
      eyebrow: 'Quarter check-in',
      title: 'Leave the check-in?',
      message: 'Everything you wrote is already saved in Horizon. Open the check-in again any time to pick up where you left off.',
      confirmLabel: 'Leave',
      action: () => close('close')
    });
  }

  // -- Chrome -------------------------------------------------------------------

  function shell() {
    return `<div class="yp-head">
        <div class="yp-head__title"><span class="yp-eyebrow">${glyph('quarter', 'qr-eyebrow-icon')}Quarter check-in</span>
          <div class="yp-year qr-quarter" data-quarter-nav></div></div>
        <div class="yp-progress" data-quarter-progress></div>
        <button type="button" class="icon-button yp-close" data-quarter-close aria-label="Close the check-in">${icon('close')}</button>
      </div>
      <div class="yp-main">
        <nav class="yp-rail" aria-label="Check-in steps"><ol data-quarter-rail></ol><p class="yp-rail__note">About ${QUARTER_MINUTES} minutes. Everything is optional and saved as you type.</p></nav>
        <div class="yp-scroll" data-quarter-scroll><div class="yp-step" data-quarter-step-body></div></div>
      </div>
      <footer class="yp-foot" data-quarter-foot></footer>`;
  }

  function stepStatus(review) {
    const { entry, next } = review;
    return {
      lookback: session.step > 0 || entry.done,
      reflect: !!(entry.wentWell.trim() || entry.change.trim()),
      next: !!(next.habit || entry.focus.trim()),
      done: entry.done
    };
  }

  function renderNav() {
    const host = el('[data-quarter-nav]');
    if (!host) return;
    const options = checkInOptions(today(), ctx.minYear?.());
    const index = options.findIndex(option => sameQuarter(option, at()));
    host.innerHTML = `<button type="button" class="icon-button hz-year-step" data-quarter-shift="-1" aria-label="Previous quarter" ${index <= 0 ? 'disabled' : ''}>${icon('chevronLeft')}</button>
      <h2 id="qr-title"><span class="sr-only">Check-in for </span>${esc(quarterId(session.quarter))}<small>${session.year}</small></h2>
      <button type="button" class="icon-button hz-year-step" data-quarter-shift="1" aria-label="Next quarter" ${index < 0 || index >= options.length - 1 ? 'disabled' : ''}>${icon('chevronRight')}</button>`;
  }

  function renderChrome(review) {
    renderNav();
    const step = QUARTER_STEPS[session.step];
    const status = stepStatus(review);
    const progress = el('[data-quarter-progress]');
    if (progress) {
      progress.innerHTML = `<div class="yp-progress__bar" role="progressbar" aria-label="Check-in progress" aria-valuemin="1" aria-valuemax="${QUARTER_STEPS.length}" aria-valuenow="${session.step + 1}" aria-valuetext="${escAttr(`Step ${session.step + 1} of ${QUARTER_STEPS.length}: ${step.label}`)}">${QUARTER_STEPS.map((item, index) => `<i class="${index < session.step ? 'is-past' : index === session.step ? 'is-current' : ''}"></i>`).join('')}</div><small>Step ${session.step + 1} of ${QUARTER_STEPS.length} · ${esc(step.label)}</small>`;
    }
    const rail = el('[data-quarter-rail]');
    if (rail) {
      rail.innerHTML = QUARTER_STEPS.map((item, index) => {
        const isDone = status[item.id] && index !== session.step;
        return `<li><button type="button" class="yp-rail__step qr-kind--${item.id}${index === session.step ? ' is-current' : ''}${status[item.id] ? ' is-done' : ''}" data-quarter-step="${index}" ${index === session.step ? 'aria-current="step"' : ''}>
          <span class="yp-rail__icon">${isDone ? icon('check') : glyph(item.icon)}</span><span class="yp-rail__label">${esc(item.label)}</span>${status[item.id] ? '<span class="sr-only"> (done)</span>' : ''}</button></li>`;
      }).join('');
    }
    const foot = el('[data-quarter-foot]');
    if (foot) {
      const last = session.step === QUARTER_STEPS.length - 1;
      const beforeLast = session.step === QUARTER_STEPS.length - 2;
      foot.innerHTML = `<button type="button" class="text-button yp-back" data-quarter-back ${session.step === 0 ? 'hidden' : ''}>${icon('chevronLeft')}Back</button>
        <span class="yp-foot__hint">${last ? 'Saved in Horizon' : step.minutes ? `About ${step.minutes} min · optional` : ''}</span>
        ${last
          ? `<button type="button" class="secondary-button yp-next" data-quarter-open-horizon>Open Horizon${icon('arrowRight')}</button>`
          : `<button type="button" class="primary-button yp-next" data-quarter-next>${beforeLast ? 'Finish the check-in' : 'Next'}${icon('arrowRight')}</button>`}`;
    }
  }

  /** While typing, the rail only needs the saved answers and the next habit (no day records are read). */
  function refreshChrome() {
    if (!session) return;
    const next = nextAt();
    renderChrome({ entry: quarterEntry(data(), session.quarter), next: { habit: String(nextData().habits?.[next.quarter] || '').trim() } });
  }

  const stepRegionName = () => (session ? `Step ${session.step + 1} of ${QUARTER_STEPS.length}: ${QUARTER_STEPS[session.step].label}` : 'Check-in step');

  function renderStep(direction = 0, focus = true) {
    if (!session) return;
    const step = QUARTER_STEPS[session.step];
    if (step.id === 'done' && !session.completed) {
      // Once per quarter: a check-in already done opens on its summary with `completed` set.
      session.completed = true;
      completeQuarterReview(data(), session.quarter, today());
      ctx.persist();
      ctx.track?.('quarter_review_completed');
    }
    const review = model();
    renderChrome(review);
    const body = el('[data-quarter-step-body]');
    body.className = `yp-step qr-step qr-step--${step.id} qr-kind--${step.id}`;
    body.innerHTML = STEP_RENDERERS[step.id](review);
    const scroll = el('[data-quarter-scroll]');
    if (scroll && (focus || direction)) scroll.scrollTop = 0;
    syncScrollRegion(scroll, stepRegionName);
    requestAnimationFrame(() => body.querySelectorAll('textarea').forEach(grow));
    if (direction) panelEnter(body, { direction });
    if (focus) requestAnimationFrame(() => (body.querySelector('[data-quarter-autofocus]') || body.querySelector('h3'))?.focus({ preventScroll: true }));
  }

  /** Re-render the step in place and put focus back on the control that changed it. */
  function rerender(selector) {
    const scroll = el('[data-quarter-scroll]');
    const top = scroll?.scrollTop || 0;
    renderStep(0, false);
    if (scroll) scroll.scrollTop = top;
    if (selector) el(selector)?.focus({ preventScroll: true });
  }

  function go(index) {
    if (!session) return;
    const next = clampStep(index);
    if (next === session.step) return;
    const direction = Math.sign(next - session.step);
    ctx.closeAllPopovers?.();
    session.step = next;
    renderStep(direction);
  }

  function shift(delta) {
    const options = checkInOptions(today(), ctx.minYear?.());
    const next = options[options.findIndex(option => sameQuarter(option, at())) + delta];
    if (!next) return;
    session.year = next.year;
    session.quarter = next.quarter;
    landOn();
    snapshot();
    session.handle.el.setAttribute('aria-label', `${quarterLabel(at())} check-in`);
    renderStep(delta, false);
    requestAnimationFrame(() => (el(`[data-quarter-shift="${delta}"]:not(:disabled)`) || el('[data-quarter-shift]:not(:disabled)'))?.focus({ preventScroll: true }));
  }

  // -- Step markup --------------------------------------------------------------

  function stepHead(eyebrow, title, lead) {
    return `<header class="yp-step__head"><span class="hz-eyebrow">${esc(eyebrow)}</span><h3 tabindex="-1">${esc(title)}</h3>${lead ? `<p>${esc(lead)}</p>` : ''}</header>`;
  }

  function stats(review) {
    const { closed, closeRate, planningElapsed, bestRun } = review.days;
    const tiles = [
      { label: 'Days closed', value: closed, note: planningElapsed ? `of ${plural(planningElapsed, 'planning day')}${review.isCurrent ? ' so far' : ''}` : 'Close a day to paint it' },
      { label: 'Close rate', value: `${closeRate}<small>%</small>`, note: planningElapsed ? 'of planning days' : 'No planning days yet' },
      { label: 'Main outcomes', value: review.outcomes.done, note: review.days.closed ? `done on ${review.outcomes.share}% of closed days` : 'The one result that makes a day', icon: 'target' },
      { label: 'Best streak', value: `${bestRun}<small> d</small>`, note: 'Planning days in a row', icon: 'flame' }
    ];
    return `<div class="qr-stats">${tiles.map(tile => `<div class="qr-stat"><span>${esc(tile.label)}</span><strong>${tile.icon ? progressIcon(tile.icon) : ''}${tile.value}</strong><small>${esc(tile.note)}</small></div>`).join('')}</div>`;
  }

  function months(review) {
    const heads = review.weekdays.map(day => `<b>${esc(day)}</b>`).join('');
    return review.months.map(month => {
      const cells = month.days.map(day => `<i class="hz-paint__cell ${PAINT_CLASSES[day.state] || 'is-before'}"></i>`).join('');
      return `<div class="qr-month" role="img" aria-label="${escAttr(`${month.name}: ${plural(month.closed, 'day')} closed`)}"><div class="qr-month__head"><strong>${esc(month.name)}</strong><span>${month.closed || ''}</span></div><div class="qr-cal" aria-hidden="true">${heads}${'<i class="qr-pad"></i>'.repeat(month.lead)}${cells}</div></div>`;
    }).join('');
  }

  function habitCard(review) {
    const { habit } = review;
    if (!habit.set) {
      return `<section class="hz-card qr-card qr-kind--habit"><header class="qr-card__head"><span class="hz-eyebrow">Winning habit · ${esc(review.id)}</span><h4>No habit was chosen</h4></header><p class="qr-empty">Choose one for ${esc(review.next.id)} in the next step: one practice you check when you close the day.</p></section>`;
    }
    const monthsList = habit.months.map(month => {
      const percent = month.elapsed ? Math.round(month.done / month.elapsed * 100) : null;
      return `<li><span>${esc(new Date(review.year, month.month, 1).toLocaleDateString(undefined, { month: 'short' }))}</span><i aria-hidden="true"><i style="width:${percent || 0}%"></i></i><b>${percent == null ? '–' : `${percent}%`}</b></li>`;
    }).join('');
    return `<section class="hz-card qr-card qr-kind--habit"><header class="qr-card__head"><span class="hz-eyebrow">Winning habit · ${esc(review.id)}</span><h4>${esc(habit.text)}</h4></header>
      <div class="qr-habit">${habit.percent == null ? '' : `<span class="qr-habit__score">${ring(habit.percent / 100)}<b>${habit.percent}<small>%</small></b></span>`}
        <p>${habit.elapsed ? `Kept on ${habit.done} of ${plural(habit.elapsed, 'day')}<br><small>Best streak: ${plural(habit.longest, 'day')}</small>` : 'Tracking starts with the quarter.'}</p></div>
      <ol class="qr-habit__months">${monthsList}</ol></section>`;
  }

  function timeCard(review) {
    const { total, days, rows } = review.time;
    const body = total
      ? `<ol class="qr-bars">${rows.map(row => `<li style="--bar-color:${escAttr(row.color)}"><span class="qr-bar__name"><i aria-hidden="true"></i>${esc(row.name)}</span><span class="qr-bar__value">${esc(hoursLabel(row.minutes))}<small> · ${Math.round(row.share * 100)}%</small></span><span class="qr-bar__track" aria-hidden="true"><span style="width:${(row.minutes / rows[0].minutes * 100).toFixed(1)}%"></span></span></li>`).join('')}</ol>`
      : '<p class="qr-empty">Time appears here once your days have scheduled blocks.</p>';
    return `<section class="hz-card qr-card"><header class="qr-card__head"><span class="hz-eyebrow">Where the time went</span><h4>${total ? `${esc(hoursLabel(total))} over ${plural(days, 'day')}` : 'No scheduled time'}</h4></header>${body}</section>`;
  }

  function horizonCard(review) {
    const { misogi, milestones, adventures, milestonesDone, lived } = review.horizon;
    const row = (kind, item, label) => `<li class="qr-item qr-item--${kind}${item.done ? ' is-done' : ''}"><span class="qr-item__mark" aria-hidden="true">${item.done && kind !== 'milestone' ? icon('check') : ''}</span><span class="qr-item__text">${esc(item.text)}<span class="sr-only"> (${item.done ? 'done' : 'not done'})</span></span><small>${esc(label || item.when)}</small></li>`;
    const parts = [];
    if (misogi) parts.push(`<div class="qr-sub qr-sub--wide qr-kind--misogi"><h5>${icon('mountain')}Misogi</h5><ul class="qr-items">${row('misogi', misogi, `${misogi.when}${misogi.done ? ' · Accomplished' : ''}`)}</ul></div>`);
    if (milestones.length) parts.push(`<div class="qr-sub qr-kind--milestone"><h5>${icon('diamond')}Milestones due<span>${milestonesDone} of ${milestones.length} done</span></h5><ul class="qr-items">${milestones.map(item => row('milestone', item)).join('')}</ul></div>`);
    if (adventures.length) parts.push(`<div class="qr-sub qr-kind--adventure"><h5>${icon('flag')}Mini-adventures<span>${lived} of ${adventures.length} lived</span></h5><ul class="qr-items">${adventures.map(item => row('adventure', item)).join('')}</ul></div>`);
    const body = parts.length ? `<div class="qr-subs">${parts.join('')}</div>` : `<p class="qr-empty">No milestone was due and no mini-adventure was planned in ${esc(review.id)}.</p>`;
    return `<section class="hz-card qr-card"><header class="qr-card__head"><span class="hz-eyebrow">In Horizon this quarter</span><h4>${parts.length ? 'What the quarter held' : 'A quarter without dates'}</h4></header>${body}</section>`;
  }

  function journalCard(review) {
    const { memories, lessons } = review.journal;
    if (!memories.length && !lessons.length) return '';
    const quote = (entry, kind) => `<li class="qr-quote qr-quote--${kind}"><blockquote>${esc(entry.text)}</blockquote><small>${esc(kind === 'memory' ? 'Memory' : 'Lesson')} · ${esc(rangeLabel(entry.key))}</small></li>`;
    return `<section class="hz-card qr-card"><header class="qr-card__head"><span class="hz-eyebrow">From your journal</span><h4>A few memories and lessons</h4></header>
      <ul class="qr-quotes">${memories.map(entry => quote(entry, 'memory')).join('')}${lessons.map(entry => quote(entry, 'lesson')).join('')}</ul></section>`;
  }

  function moveRow(item, review) {
    const d = data();
    const ref = itemRef(item);
    const source = item.kind === 'milestone' ? (d.misogiMilestones || []).find(entry => entry.id === item.id) : (d.miniAdventures || []).find(entry => entry.id === item.id);
    if (!source) return '';
    const done = !!source.done || source.status === 'done';
    const current = item.kind === 'milestone' ? { startDate: source.date || '', endDate: '' } : { startDate: source.startDate || '', endDate: source.endDate || '' };
    const moved = current.startDate !== item.startDate || (current.endDate || '') !== (item.endDate || '');
    let chips = '';
    if (session.quarter < 3) {
      // Never a date before today (a late check-in offers the weeks ahead).
      chips = moveOptions(item, at(), today()).map(option => {
        const pressed = current.startDate === option.startDate && (current.endDate || '') === (option.endDate || '');
        return `<button type="button" class="qr-chip" data-quarter-move="${escAttr(ref)}" data-start="${escAttr(option.startDate)}" data-end="${escAttr(option.endDate)}" aria-pressed="${pressed}" ${done ? 'disabled' : ''}>${esc(option.label)}</button>`;
      }).join('');
    } else if (item.kind === 'adventure') {
      const nextYear = nextAt().year;
      // Only an idea this check-in added can be taken back; one already on next year's list stays.
      const state = carryState(data(), nextData(), session.quarter, item);
      const labels = { carried: `Carried into ${nextYear}`, kept: `Planned in ${nextYear}`, listed: `Already in ${nextYear}`, full: `${nextYear} already has six`, open: `Carry into ${nextYear}` };
      const on = state === 'carried' || state === 'kept' || state === 'listed';
      chips = `<button type="button" class="qr-chip qr-chip--carry" data-quarter-carry="${escAttr(item.id)}" aria-pressed="${on}" ${done || (state !== 'carried' && state !== 'open') ? 'disabled' : ''}>${on ? icon('check') : ''}${esc(labels[state])}</button>`;
    }
    const label = session.quarter < 3 ? `Move “${item.text}” to` : `Carry “${item.text}” into ${nextAt().year}`;
    const note = `${KIND_LABELS[item.kind]} · ${moved && !done ? `moved to ${current.startDate ? rangeLabel(current.startDate) : 'no date'}` : `was ${item.when}`}`;
    return `<li class="qr-move${done ? ' is-done' : ''}${moved ? ' is-moved' : ''} qr-kind--${item.kind}">
        <input class="check" type="checkbox" data-quarter-done="${escAttr(ref)}" ${done ? 'checked' : ''} aria-label="${escAttr(`${item.kind === 'adventure' ? 'Lived' : 'Done'}: ${item.text}`)}">
        <span class="qr-move__copy"><strong>${esc(item.text)}</strong><small>${esc(done ? `${KIND_LABELS[item.kind]} · ${item.kind === 'adventure' ? 'lived' : 'done'}` : note)}</small></span>
        ${chips ? `<span class="qr-chips" role="group" aria-label="${escAttr(label)}">${chips}</span>` : ''}
      </li>`;
  }

  const STEP_RENDERERS = {
    lookback(review) {
      const title = review.isEmpty ? `${review.id} is still blank.` : review.isCurrent ? `${review.id} so far.` : `How ${review.id} went.`;
      const lead = `${quarterLead(review)}${review.isCurrent && review.daysLeft ? ` ${plural(review.daysLeft, 'day')} to go.` : ''}`;
      const recall = review.previousFocus ? `<p class="qr-recall">${progressIcon('target')}<span><small>The focus you chose for ${esc(review.id)}</small>${esc(review.previousFocus)}</span></p>` : '';
      return `${stepHead(`Step 1 · Look back on ${review.id} · ${review.period}`, title, lead)}
        ${recall}
        ${stats(review)}
        <section class="hz-card qr-card qr-card--paint"><header class="qr-card__head qr-card__head--row"><div><span class="hz-eyebrow">The quarter, painted</span><h4>${review.days.closed ? `${plural(review.days.closed, 'square')}, one per closed day` : 'No squares yet'}</h4></div>${renderPaintLegend()}</header>
          <div class="qr-months">${months(review)}</div></section>
        <div class="qr-grid">${habitCard(review)}${timeCard(review)}</div>
        ${horizonCard(review)}
        ${journalCard(review)}`;
    },
    reflect(review) {
      const { entry, journal } = review;
      const prompts = [...journal.memories.slice(0, 2), ...journal.lessons.slice(0, 1)];
      return `${stepHead(`Step 2 · Reflect on ${review.id}`, 'Two questions, then on to the next quarter.', 'A few honest words are enough. They are saved with this check-in and printed with the quarter.')}
        <label class="yp-field"><span>What went well in ${esc(review.id)}?</span><textarea rows="3" data-quarter-field="wentWell" data-quarter-autofocus maxlength="${MAX_ANSWER}" placeholder="A win, a habit that held, a moment worth keeping">${esc(entry.wentWell)}</textarea></label>
        <label class="yp-field"><span>What will you do differently in ${esc(review.next.id)}?</span><textarea rows="3" data-quarter-field="change" maxlength="${MAX_ANSWER}" placeholder="One change you can actually make">${esc(entry.change)}</textarea></label>
        ${prompts.length ? `<aside class="qr-prompts" aria-label="From your journal this quarter"><span class="yp-subhead">From your journal this quarter</span><ul>${prompts.map(item => `<li><blockquote>${esc(item.text)}</blockquote><small>${esc(rangeLabel(item.key))}</small></li>`).join('')}</ul></aside>` : ''}`;
    },
    next(review) {
      const { next, entry, habit } = review;
      const d = nextData();
      // A late check-in can come after the next quarter is over: then its habit is what it was, and
      // what is left over moves to the weeks ahead (in the same year) instead.
      const over = next.status === 'past';
      const editable = !over && nextHabitEditable(d, next, today());
      const span = quarterMonths(next, 'short').replace(' – ', '–');
      const keep = habit.set && editable && habit.text !== next.habit ? `<button type="button" class="qr-chip qr-chip--keep" data-quarter-keep-habit>${icon('repeat')}Keep “${esc(habit.text)}”</button>` : '';
      const note = editable ? '' : `<em>${esc(over ? `${next.id} ended ${rangeLabel(next.end)}` : 'Tracking · change it in Horizon')}</em>`;
      const items = session.leftovers.map(item => moveRow(item, review)).filter(Boolean);
      const movable = session.quarter < 3 && session.leftovers.some(item => moveOptions(item, at(), today()).length);
      const leftLead = session.quarter === 3
        ? `Tick what you did, or carry a mini-adventure into ${next.year} as an idea. Milestones stay with the ${review.year} Misogi.`
        : !over ? `Move what still matters to ${next.id}, or tick what you did.`
          : movable ? 'Move what still matters to the weeks ahead, or tick what you did.'
            : `Tick what you did. ${review.year} is over, so the rest stays where it was.`;
      const head = over
        ? stepHead('Step 3 · After the quarter', `${next.id} is already over.`, `${quarterMonths(next, 'long', ' to ')} has passed, so its habit stays as it was.${movable ? ` What is left from ${review.id} can still get a date in the weeks ahead.` : ''}`)
        : stepHead('Step 3 · Next quarter', `Set up ${next.id}: ${quarterMonths(next)}.`, 'One habit for the quarter, what moves forward, and a focus if you want one.');
      return `${head}
        <section class="qr-block qr-kind--habit" aria-labelledby="qr-habit-title">
          <h4 class="qr-block__title" id="qr-habit-title">${icon('repeat')}Winning habit for ${esc(next.id)}</h4>
          <div class="yp-row yp-row--habit${editable ? '' : ' is-locked'}"><span class="yp-habit__quarter"><b>${esc(next.id)}</b><small>${esc(span)}</small></span>
            <input type="text" class="yp-row__input" data-quarter-habit data-quarter-autofocus value="${escAttr(next.habit)}" maxlength="180" placeholder="${editable ? 'One practice, checked when you close the day' : over ? 'No habit was chosen' : ''}" ${editable ? '' : 'disabled'} aria-label="${escAttr(`Winning habit for ${next.id}`)}">${note}</div>
          ${keep ? `<div class="qr-keep">${keep}</div>` : ''}
        </section>
        <section class="qr-block" aria-labelledby="qr-left-title">
          <h4 class="qr-block__title" id="qr-left-title">${glyph('move')}Left from ${esc(review.id)}${items.length ? `<span>${items.length}</span>` : ''}</h4>
          ${items.length ? `<p class="qr-block__lead">${esc(leftLead)}</p><ul class="qr-moves">${items.join('')}</ul>` : `<p class="qr-clear">${icon('check')}<span>Nothing left over: every milestone and mini-adventure due in ${esc(review.id)} was done.</span></p>`}
        </section>
        <label class="yp-field qr-focus"><span>${over ? `Your focus in ${esc(next.id)}` : `One focus for ${esc(next.id)}`} <em>optional</em></span><input type="text" data-quarter-field="focus" maxlength="${MAX_FOCUS}" value="${escAttr(entry.focus)}" placeholder="${over ? 'The one thing that mattered most' : `The one thing that would make ${escAttr(next.id)} a win`}"></label>`;
    },
    done(review) {
      const { entry, next, days, habit } = review;
      const d = data();
      const moves = session.leftovers.map(item => {
        const source = item.kind === 'milestone' ? (d.misogiMilestones || []).find(saved => saved.id === item.id) : (d.miniAdventures || []).find(saved => saved.id === item.id);
        if (!source) return 'gone';
        if (source.done || source.status === 'done') return 'done';
        if (item.kind === 'adventure' && session.quarter === 3) return ['carried', 'kept'].includes(carryState(d, nextData(), 3, item)) ? 'moved' : 'left';
        const start = item.kind === 'milestone' ? source.date : source.startDate;
        return start !== item.startDate ? 'moved' : 'left';
      });
      const count = state => moves.filter(value => value === state).length;
      const left = [count('moved') ? `${count('moved')} ${session.quarter === 3 ? `carried into ${next.year}` : next.status === 'past' ? 'moved' : `moved to ${next.id}`}` : '', count('done') ? `${count('done')} marked done` : '', count('left') ? `${count('left')} left as they were` : ''].filter(Boolean).join(' · ');
      const row = (stepIndex, kind, label, value, isSet) => `<li class="yp-summary__row qr-kind--${kind}${isSet ? ' is-set' : ''}"><span class="yp-summary__icon">${isSet ? icon('check') : glyph(QUARTER_STEPS[stepIndex].icon)}</span><span class="yp-summary__copy"><strong>${esc(label)}</strong><small>${value}</small></span><button type="button" class="text-button" data-quarter-step="${stepIndex}" aria-label="${escAttr(`Edit ${label}`)}">${isSet ? 'Edit' : 'Add'}</button></li>`;
      const empty = value => `<span class="yp-summary__empty">${esc(value)}</span>`;
      const excerpt = value => esc(value.trim().replace(/\s+/g, ' '));
      const rows = [
        row(0, 'lookback', `Looking back on ${review.id}`, esc([plural(days.closed, 'day') + ' closed', days.planningElapsed ? `${days.closeRate}% close rate` : '', habit.percent != null ? `habit kept ${habit.percent}%` : ''].filter(Boolean).join(' · ')), true),
        row(1, 'reflect', 'What went well', entry.wentWell.trim() ? excerpt(entry.wentWell) : empty('Not written'), !!entry.wentWell.trim()),
        row(1, 'reflect', `What you’ll do differently in ${next.id}`, entry.change.trim() ? excerpt(entry.change) : empty('Not written'), !!entry.change.trim()),
        row(2, 'next', `Winning habit for ${next.id}`, next.habit ? esc(next.habit) : empty('Not chosen yet'), !!next.habit),
        ...(session.leftovers.length ? [row(2, 'next', `Left from ${review.id}`, esc(left || 'Nothing changed'), count('left') < session.leftovers.length)] : []),
        row(2, 'next', `Focus for ${next.id}`, entry.focus.trim() ? esc(entry.focus.trim()) : empty('None'), !!entry.focus.trim())
      ].join('');
      return `${stepHead('Done', `${review.id} is checked in.`, `Saved in Horizon. Print the quarter on one page to keep ${next.id} in sight: on the fridge, the desk, the inside of a notebook.`)}
        <ul class="yp-summary">${rows}</ul>
        <div class="yp-done-actions"><button type="button" class="primary-button" data-quarter-print data-quarter-autofocus>${icon('printer')}Print this quarter</button><span>One landscape page: the quarter painted, your habit, what you lived and your answers.</span></div>`;
    }
  };

  // -- Interactions -------------------------------------------------------------

  function findItem(ref) {
    return session.leftovers.find(item => itemRef(item) === ref) || null;
  }

  function onInput(event) {
    if (!session) return;
    const target = event.target;
    const { dataset } = target;
    if (dataset.quarterField) setQuarterAnswer(data(), session.quarter, dataset.quarterField, target.value);
    else if ('quarterHabit' in dataset) setNextHabit(nextData(), nextAt(), target.value, today());
    else return;
    if (target.tagName === 'TEXTAREA') grow(target);
    persist();
    refreshChrome();
  }

  function onChange(event) {
    if (!session) return;
    const target = event.target;
    if ('quarterHabit' in target.dataset) {
      if (setNextHabit(nextData(), nextAt(), target.value.trim(), today())) { target.value = target.value.trim(); persist(); }
      return;
    }
    if (target.dataset.quarterDone) {
      const item = findItem(target.dataset.quarterDone);
      if (item && setItemDone(data(), item.kind, item.id, target.checked)) { persist(); rerender(`[data-quarter-done="${CSS.escape(target.dataset.quarterDone)}"]`); }
    }
  }

  function onKeydown(event) {
    // Enter that confirms an input method's composition (Japanese, Chinese…) belongs to the field.
    if (!session || event.isComposing || event.keyCode === 229) return;
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      if (session.step < QUARTER_STEPS.length - 1) go(session.step + 1);
      return;
    }
    // Enter moves to the next field of the step, then to the next step; Shift+Enter adds a line to an answer.
    const field = event.target.closest?.('input[type="text"], textarea');
    if (!field || event.key !== 'Enter' || event.shiftKey) return;
    event.preventDefault();
    const fields = [...session.handle.el.querySelectorAll('[data-quarter-step-body] input[type="text"]:not(:disabled), [data-quarter-step-body] textarea')];
    const next = fields[fields.indexOf(field) + 1];
    if (next) next.focus();
    else if (session.step < QUARTER_STEPS.length - 1) go(session.step + 1);
  }

  function onClick(event) {
    if (!session) return;
    const target = event.target.closest('button');
    if (!target || target.disabled) return;
    const { dataset } = target;
    if ('quarterClose' in dataset) { close('close'); return; }
    if ('quarterNext' in dataset) { go(session.step + 1); return; }
    if ('quarterBack' in dataset) { go(session.step - 1); return; }
    if (dataset.quarterStep !== undefined) { go(Number(dataset.quarterStep)); return; }
    if (dataset.quarterShift) { shift(Number(dataset.quarterShift)); return; }
    if ('quarterOpenHorizon' in dataset) { close('horizon'); return; }
    if ('quarterPrint' in dataset) { print(); return; }
    if ('quarterKeepHabit' in dataset) {
      const habit = String(data().habits?.[session.quarter] || '').trim();
      if (habit && setNextHabit(nextData(), nextAt(), habit, today())) { persist(); rerender('[data-quarter-habit]'); }
      return;
    }
    if (dataset.quarterMove) {
      const item = findItem(dataset.quarterMove);
      if (!item) return;
      const d = data();
      const source = item.kind === 'milestone' ? (d.misogiMilestones || []).find(entry => entry.id === item.id) : (d.miniAdventures || []).find(entry => entry.id === item.id);
      const current = item.kind === 'milestone' ? { startDate: source?.date || '', endDate: '' } : { startDate: source?.startDate || '', endDate: source?.endDate || '' };
      const chosen = { startDate: dataset.start || '', endDate: dataset.end || '' };
      const pressed = current.startDate === chosen.startDate && current.endDate === chosen.endDate;
      // A second press puts it back where it was.
      if (applyDates(d, item.kind, item.id, pressed ? { startDate: item.startDate, endDate: item.endDate } : chosen)) persist();
      rerender(`[data-quarter-move="${CSS.escape(dataset.quarterMove)}"][data-start="${CSS.escape(chosen.startDate)}"]`);
      return;
    }
    if (dataset.quarterCarry) {
      const item = findItem(`adventure:${dataset.quarterCarry}`);
      if (!item) return;
      // The check-in remembers the ideas it adds (quarterReviews.Q4.carried) and only ever takes those back.
      if (toggleCarry(data(), nextData(), session.quarter, item, () => uid('adventure'))) persist();
      rerender(`[data-quarter-carry="${CSS.escape(dataset.quarterCarry)}"]`);
    }
  }

  // -- Print ----------------------------------------------------------------------

  function buildSheet() {
    if (!session) return null;
    document.querySelectorAll('[data-print-sheet]').forEach(sheet => sheet.remove());
    const sheet = document.createElement('section');
    sheet.className = 'print-sheet print-sheet--quarter';
    sheet.dataset.printSheet = 'true';
    sheet.innerHTML = renderQuarterPrint(model(), { icon: glyph, palette: document.documentElement.dataset.paint || 'terracotta' });
    document.body.append(sheet);
    // Long answers print in full: they step down a size rather than lose their last lines.
    fitQuarterAnswers(sheet);
    document.body.classList.add('is-printing');
    return sheet;
  }

  function print() {
    if (!session) return;
    ctx.closeAllPopovers?.();
    const titleBefore = document.title;
    document.title = `Daily Planner - ${quarterId(session.quarter).toLowerCase()}-${session.year}`;
    buildSheet();
    const cleanup = () => {
      document.querySelectorAll('[data-print-sheet].print-sheet--quarter').forEach(sheet => sheet.remove());
      if (!document.querySelector('[data-print-sheet]')) document.body.classList.remove('is-printing');
      document.title = titleBefore;
    };
    window.addEventListener('afterprint', cleanup, { once: true });
    requestAnimationFrame(() => requestAnimationFrame(() => window.print()));
  }

  // The browser's own Print command while the check-in is open prints the quarter
  // (registered before the app's handler, which leaves an existing sheet alone).
  if (typeof window !== 'undefined') {
    window.addEventListener('beforeprint', () => {
      if (session && !document.body.classList.contains('is-printing')) {
        buildSheet();
        window.addEventListener('afterprint', () => { document.querySelectorAll('[data-print-sheet].print-sheet--quarter').forEach(sheet => sheet.remove()); }, { once: true });
      }
    });
  }

  return { open, close, isOpen: () => !!session, print };
}
