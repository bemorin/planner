import { esc } from '../lib/text.js';
import { prefersReducedMotion } from '../ui/motion.js';
import { dayInsight } from './insights-model.js';

/**
 * The sponsor moment (1.38.1): once, after ten closed days, when this copy has
 * a sponsor page (GITHUB_SPONSOR_URL, the build variable
 * DAILY_PLANNER_SPONSOR_URL). It celebrates first, then asks.
 *
 * - The stage: ten day marks fill one after another; the tenth, the day just
 *   closed, lifts into the planner's mark (the Horizon: the sun on its
 *   horizon, as in favicon.svg), whose horizon line draws, whose half sun
 *   rises and whose rays draw, inside the opening seal's dotted orbit
 *   (src/features/opening-seal.js, styles/opening.css). About 1.9 s, eased,
 *   never bouncy; styles/sponsor.css runs it. The resting state is the end
 *   state, so with reduced motion everything is simply there.
 * - Their own recap, counted on this device from the days it keeps (nothing
 *   leaves it): closed days in the title, then outcomes done, hours on the
 *   schedule and tasks done, each only when it reads well (never a zero).
 *   The numbers count up gently; screen readers get the final figures.
 * - The ask, signed by the owner, and three actions usable from the first
 *   frame: Sponsor on GitHub (a new tab; the moment then says thank you,
 *   never that they sponsored, and closes once it has been seen), Share
 *   Daily Planner (the Web Share API with the site's address, or the link
 *   copied, with “Link copied”), and Not now.
 *
 * app.js decides when (maybePromptInstallOrSupport, after the day-closed
 * confirmation) and owns the dialog: openModal puts it on the back stack, so
 * Back and Escape close it, and focus lands on its title. The decisions are
 * pure and unit-tested (tests/sponsor-moment.test.js).
 */

/** Closed days before the moment is offered (settings.closeDayCount). */
export const SPONSOR_AFTER_CLOSED_DAYS = 10;
/** Day marks on the stage. */
export const DAY_MARKS = 10;
/** After Sponsor on GitHub, the thank-you stays this long once the page is in view, then the moment closes. */
export const THANKS_MS = 2600;
/** “Link copied” stays on the Share button this long. */
export const COPIED_MS = 2400;
/** The numbers count up from this point (the stage's marks are filling), for this long. */
export const COUNT_DELAY_MS = 620;
export const COUNT_MS = 1100;

const SITE_URL = 'https://planner.bemorin.com/';
export const SHARE_TEXT = Object.freeze({
  title: 'Daily Planner',
  text: 'Plan what matters, protect the time, close the day. Free, and your plans stay on your device.'
});

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;
const PREFIX = 'daily-planner:';
const NUMBER = new Intl.NumberFormat('en-US');

const GITHUB_MARK = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path class="icon-fill" d="M12 2.5a9.7 9.7 0 0 0-3.07 18.9c.49.1.67-.22.67-.48v-1.87c-2.73.6-3.3-1.18-3.3-1.18-.45-1.15-1.09-1.46-1.09-1.46-.9-.62.07-.6.07-.6.98.06 1.5 1.01 1.5 1.01.88 1.5 2.29 1.07 2.85.82.09-.63.34-1.07.62-1.32-2.18-.25-4.48-1.09-4.48-4.86 0-1.07.38-1.95 1-2.64-.1-.25-.43-1.25.1-2.6 0 0 .82-.26 2.68 1.01A9.25 9.25 0 0 1 12 6.9a9.2 9.2 0 0 1 2.44.33c1.86-1.27 2.67-1 2.67-1 .54 1.34.2 2.34.1 2.59.63.69 1.01 1.57 1.01 2.64 0 3.78-2.3 4.6-4.49 4.85.35.3.66.9.66 1.8v2.8c0 .27.18.59.68.49A9.7 9.7 0 0 0 12 2.5Z"/></svg>';
const SHARE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M12 3.8v10.7"/><path d="m8.2 7.4 3.8-3.6 3.8 3.6"/><path d="M8.6 10.6H7.2a2 2 0 0 0-2 2v5.6a2 2 0 0 0 2 2h9.6a2 2 0 0 0 2-2v-5.6a2 2 0 0 0-2-2h-1.4"/></svg>';
const CHECK_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m5.5 12.5 4.2 4.2 8.8-9.2"/></svg>';

/** The sponsor page when this copy has one: an https address, else ''. */
export function sponsorPage(raw) {
  const value = String(raw ?? '').trim();
  if (!value) return '';
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname ? value : '';
  } catch (_) {
    return '';
  }
}

/**
 * Whether the moment opens now: never shown before (settings.sponsorPromptShown),
 * ten days closed or more, a sponsor page, and nothing else on screen.
 */
export function shouldOfferSponsor({ shown = false, closeDayCount = 0, url = '', busy = false } = {}) {
  return !shown && !busy && (Number(closeDayCount) || 0) >= SPONSOR_AFTER_CLOSED_DAYS && !!sponsorPage(url);
}

/**
 * What the person did, from the day records kept on this device: the closed
 * days, the outcomes and tasks done on them, and their scheduled time.
 * Tolerates partial and older records (insights-model.js reads them the same way).
 */
export function sponsorRecap(records) {
  const recap = { days: 0, outcomes: 0, tasks: 0, minutes: 0, blocks: 0 };
  for (const record of records || []) {
    const day = dayInsight(record);
    if (!day?.closed) continue;
    recap.days += 1;
    recap.outcomes += (day.mitDone ? 1 : 0) + day.otherDone;
    recap.tasks += day.tasksDone;
    recap.minutes += day.minutes;
    recap.blocks += day.blocks.length;
  }
  return recap;
}

/** The days kept on this device (`daily-planner:YYYY-MM-DD`), read once each. */
export function recapFromStore({ dayKeys = () => [], readDay = () => null } = {}) {
  const keys = new Set();
  for (const key of dayKeys() || []) {
    const day = String(key || '').startsWith(PREFIX) ? String(key).slice(PREFIX.length) : String(key || '');
    if (DAY_KEY.test(day)) keys.add(day);
  }
  return sponsorRecap([...keys].map(key => readDay(key)));
}

const plural = (count, one, many) => (count === 1 ? one : many);

/**
 * The figures worth showing, at most three: outcomes done, hours on the
 * schedule (from one hour) and tasks done. A figure that would read as zero
 * is left out; the closed days are in the title.
 */
export function recapFigures(recap = {}) {
  const outcomes = Math.max(0, Math.floor(Number(recap.outcomes) || 0));
  const minutes = Math.max(0, Number(recap.minutes) || 0);
  const tasks = Math.max(0, Math.floor(Number(recap.tasks) || 0));
  const hours = minutes >= 60 ? Math.round(minutes / 60) : 0;
  return [
    outcomes ? { id: 'outcomes', value: outcomes, label: plural(outcomes, 'outcome done', 'outcomes done') } : null,
    hours ? { id: 'hours', value: hours, label: plural(hours, 'hour planned', 'hours planned') } : null,
    tasks ? { id: 'tasks', value: tasks, label: plural(tasks, 'task done', 'tasks done') } : null
  ].filter(Boolean).slice(0, 3);
}

/** “Ten days, planned and closed.”, “42 days, …”, or a title without a number when fewer days are kept. */
export function recapTitle(days) {
  const count = Math.floor(Number(days) || 0);
  if (count === SPONSOR_AFTER_CLOSED_DAYS) return 'Ten days, planned and closed.';
  if (count > SPONSOR_AFTER_CLOSED_DAYS) return `${NUMBER.format(count)} days, planned and closed.`;
  return 'Day after day, planned and closed.';
}

/** The address to share: this site's own, or the planner's public address from a computer or a preview. */
export function siteUrl(loc = globalThis.location) {
  try {
    if (loc?.protocol === 'https:' && loc.hostname && !/^(?:localhost|127\.0\.0\.1|\[::1\])$/.test(loc.hostname)) return `${loc.origin}/`;
  } catch (_) {}
  return SITE_URL;
}

/**
 * Shares the site with the Web Share API, or copies its address when sharing
 * isn't there (or fails for another reason than the person cancelling).
 * Answers 'shared', 'cancelled', 'copied' or 'failed'.
 */
export async function shareOrCopy({ url, title = SHARE_TEXT.title, text = SHARE_TEXT.text } = {}, { nav = globalThis.navigator, copyText = null } = {}) {
  const data = { title, text, url };
  let canShare = typeof nav?.share === 'function';
  try { if (canShare && typeof nav.canShare === 'function') canShare = nav.canShare(data); } catch (_) { canShare = false; }
  if (canShare) {
    try {
      await nav.share(data);
      return 'shared';
    } catch (error) {
      if (error?.name === 'AbortError') return 'cancelled';
    }
  }
  try {
    if (typeof nav?.clipboard?.writeText === 'function') {
      await nav.clipboard.writeText(url);
      return 'copied';
    }
  } catch (_) {}
  try { if (typeof copyText === 'function' && copyText(url)) return 'copied'; } catch (_) {}
  return 'failed';
}

/** The last resort: the address selected in a hidden field and copied the old way. */
function copyWithSelection(value) {
  const field = document.createElement('textarea');
  field.value = value;
  field.setAttribute('readonly', '');
  field.className = 'sm-copy-field';
  document.body.append(field);
  field.select();
  let copied = false;
  try { copied = document.execCommand('copy'); } catch (_) { copied = false; }
  field.remove();
  return copied;
}

function stage() {
  const days = Array.from({ length: DAY_MARKS }, (_, index) => `<li${index === DAY_MARKS - 1 ? ' class="is-today"' : ''}></li>`).join('');
  return `<div class="sm-stage" aria-hidden="true">
    <div class="sm-scene">
      <span class="sm-glow"></span>
      <svg class="sm-orbit" viewBox="0 0 128 128" focusable="false"><circle cx="64" cy="64" r="61"/></svg>
      <span class="sm-tile">
        <svg class="sm-mark" viewBox="0 0 64 64" focusable="false">
          <defs><clipPath id="sm-sky"><rect width="64" height="39.95"/></clipPath></defs>
          <g clip-path="url(#sm-sky)"><path class="sm-sun" d="M20 38a12 12 0 0 1 24 0"/></g>
          <path class="sm-horizon" pathLength="1" d="M12 38h40"/>
          <path class="sm-ground" pathLength="1" d="M22.5 46h19"/>
          <path class="sm-ray sm-ray--1" pathLength="1" d="M20.7 26.7l-3.2-3.2"/>
          <path class="sm-ray sm-ray--2" pathLength="1" d="M32 22v-4.5"/>
          <path class="sm-ray sm-ray--3" pathLength="1" d="M43.3 26.7l3.2-3.2"/>
        </svg>
      </span>
    </div>
    <ol class="sm-days">${days}</ol>
  </div>`;
}

/** The moment's content (the dialog's shell is in index.html): the stage, the recap, the ask and the actions. */
export function renderSponsorMoment({ recap = {}, url = '' } = {}) {
  const figures = recapFigures(recap);
  const list = figures.length
    ? `<ul class="sm-recap" data-count="${figures.length}">${figures.map(figure => `<li><strong class="sm-recap__value" data-count-to="${figure.value}" aria-hidden="true">${NUMBER.format(figure.value)}</strong><span class="sm-recap__label" aria-hidden="true">${esc(figure.label)}</span><span class="sr-only">${NUMBER.format(figure.value)} ${esc(figure.label)}</span></li>`).join('')}</ul>`
    : '';
  return `<div class="sponsor-moment" data-sponsor-state="ask">
    ${stage()}
    <div class="sm-body" data-sponsor-body>
      <h2 class="sm-title" id="sponsor-title">${esc(recapTitle(recap.days))}</h2>
      ${list}
      <div class="sm-ask">
        <p>Daily Planner is free and made by one person. It keeps your plans on your device. If it’s become part of your day, you can help keep it going.</p>
        <p class="sm-sign">— Ben</p>
      </div>
      <div class="sm-actions">
        <a class="primary-button icon-text-button sm-sponsor" data-sponsor-confirm href="${esc(sponsorPage(url))}" target="_blank" rel="noopener">${GITHUB_MARK}<span>Sponsor on GitHub</span></a>
        <button class="secondary-button icon-text-button sm-share" type="button" data-sponsor-share>${SHARE_ICON}<span data-sponsor-share-label>Share Daily Planner</span></button>
        <button class="text-button sm-later" type="button" data-sponsor-later>Not now</button>
      </div>
      <p class="sr-only" role="status" data-sponsor-status></p>
    </div>
  </div>`;
}

/** After Sponsor on GitHub: thanks, without saying they sponsored. */
export function renderSponsorThanks() {
  return `<div class="sm-thanks" data-sponsor-thanks>
    <h2 class="sm-title" id="sponsor-title" tabindex="-1">Thank you.</h2>
    <p>GitHub is open in a new tab. Whatever you decide there, thank you for making Daily Planner part of your days.</p>
  </div>`;
}

const easeOut = progress => 1 - (1 - progress) ** 3;

/** The numbers count up from zero, eased; with reduced motion they are simply there. */
function countUp(root) {
  const nodes = [...root.querySelectorAll('[data-count-to]')];
  if (!nodes.length || prefersReducedMotion() || typeof requestAnimationFrame !== 'function') return () => {};
  const targets = nodes.map(node => Number(node.dataset.countTo) || 0);
  nodes.forEach(node => { node.textContent = '0'; });
  let frame = 0;
  let start = 0;
  const tick = now => {
    if (!start) start = now + COUNT_DELAY_MS;
    const progress = Math.min(1, Math.max(0, (now - start) / COUNT_MS));
    nodes.forEach((node, index) => { node.textContent = NUMBER.format(Math.round(targets[index] * easeOut(progress))); });
    if (progress < 1) frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);
  return () => {
    cancelAnimationFrame(frame);
    nodes.forEach((node, index) => { node.textContent = NUMBER.format(targets[index]); });
  };
}

/**
 * The moment in the planner. `url`: GITHUB_SPONSOR_URL. `dayKeys`/`readDay`:
 * the stored days (readDay gets YYYY-MM-DD). `shown`/`markShown`: the
 * settings flag, set before the dialog opens, so it is shown once.
 */
export function createSponsorMoment({ openModal, closeModal, url = '', dayKeys = () => [], readDay = () => null, shown = () => false, markShown = () => {}, modal = () => document.querySelector('[data-sponsor-modal]') }) {
  let stopCount = () => {};
  let timers = [];
  const later = (fn, ms) => { timers.push(setTimeout(fn, ms)); };
  const isOpen = () => !!modal()?.classList.contains('is-open') && !modal()?.hidden;

  function reset() {
    stopCount();
    stopCount = () => {};
    timers.forEach(clearTimeout);
    timers = [];
  }

  function close() {
    reset();
    if (isOpen()) closeModal(modal());
  }

  async function share(button) {
    const status = modal()?.querySelector('[data-sponsor-status]');
    const label = button.querySelector('[data-sponsor-share-label]');
    const address = siteUrl();
    const result = await shareOrCopy({ url: address }, { copyText: copyWithSelection });
    const icon = markup => { const svg = button.querySelector('svg'); if (svg) svg.outerHTML = markup; };
    if (result === 'copied') {
      button.classList.add('is-copied');
      icon(CHECK_ICON);
      if (label) label.textContent = 'Link copied';
      if (status) status.textContent = 'Link copied.';
      later(() => {
        button.classList.remove('is-copied');
        icon(SHARE_ICON);
        if (label) label.textContent = 'Share Daily Planner';
        if (status) status.textContent = '';
      }, COPIED_MS);
    } else if (result === 'failed' && status) {
      status.textContent = `The link: ${address}`;
      if (label) label.textContent = address.replace(/^https:\/\//, '').replace(/\/$/, '');
    }
  }

  // Thanks once it can be seen: at once when the page is in view, else when the person comes back from GitHub.
  function thank() {
    const root = modal()?.querySelector('.sponsor-moment');
    const body = root?.querySelector('[data-sponsor-body]');
    if (!root || !body) return;
    stopCount();
    root.dataset.sponsorState = 'thanks';
    body.outerHTML = renderSponsorThanks();
    root.querySelector('#sponsor-title')?.focus({ preventScroll: true });
    const leave = () => later(() => { if (root.isConnected) close(); }, THANKS_MS);
    if (document.visibilityState === 'hidden') {
      const back = () => { if (document.visibilityState !== 'visible') return; document.removeEventListener('visibilitychange', back); if (isOpen()) leave(); };
      document.addEventListener('visibilitychange', back);
    } else leave();
  }

  function render() {
    const host = modal()?.querySelector('[data-sponsor-moment]');
    if (!host) return false;
    host.innerHTML = renderSponsorMoment({ recap: recapFromStore({ dayKeys, readDay }), url });
    host.querySelector('[data-sponsor-confirm]')?.addEventListener('click', () => later(thank, 60));
    host.querySelector('[data-sponsor-share]')?.addEventListener('click', event => share(event.currentTarget));
    host.querySelector('[data-sponsor-later]')?.addEventListener('click', close);
    return true;
  }

  /** Opens the moment when it is due (shouldOfferSponsor). True when it opened. */
  function maybeOpen({ closeDayCount = 0, busy = false } = {}) {
    const elsewhere = !!document.querySelector('.modal.is-open, dialog[open]');
    if (!shouldOfferSponsor({ shown: shown(), closeDayCount, url, busy: busy || elsewhere })) return false;
    reset();
    if (!render()) return false;
    markShown();
    openModal(modal());
    stopCount = countUp(modal());
    return true;
  }

  return { maybeOpen, close };
}
