import { LEGAL_ADDRESS, LEGAL_PHONE, LEGAL_REGISTRATION, PRIVACY_EMAIL, SUPPORT_EMAIL } from '../src/config.js';
import { COUNTED_EVENTS, LANDING_EVENTS, plannerApiEnabled, setUsageCountsEnabled, usageCountsEnabled } from '../src/lib/planner-api.js';
import { landingMoments } from '../welcome/landing-model.js';
import { contactPhrase, detailRows, detailsHtml, esc, legalDetails } from './legal-details.js';

/**
 * Legal pages (legal/, legal/privacy/, legal/terms/, legal/cookies/).
 *
 * The pages are plain HTML that reads well without JavaScript. This module
 * fills in what depends on the deployment or on the code, so it can never
 * drift: the publisher's details (SUPPORT_EMAIL, PRIVACY_EMAIL, LEGAL_PHONE,
 * LEGAL_ADDRESS, LEGAL_REGISTRATION from runtime-config.js, each left out
 * when blank or invalid, see legal-details.js; the build writes them into
 * the pages of dist/ too, for readers without JavaScript), who answers what
 * (contactEmail) and the moments the site counts (COUNTED_EVENTS, and of
 * LANDING_EVENTS those the landing page sends: welcome/landing-model.js).
 * It makes no network request. It also marks, in “On this page”, the
 * section being read.
 *
 * The pure helpers below are unit-tested (tests/legal.test.js).
 */

// The publisher's details (checked, then written as rows and links) are
// shared with the build and the owner dashboard: legal-details.js.
export { DIRECTOR, PUBLISHER, askHref, callingCode, contactEmail, contactHtml, contactPhrase, detailRows, detailsHtml, emailAddress, esc, formatPhone, legalDetails, legalEmail, legalPhone, legalValueProblem, phoneHtml, staticLegalHtml, telHref } from './legal-details.js';

/** One list item per counted moment, in the words the planner’s Privacy notice uses. */
export const eventsHtml = (events = COUNTED_EVENTS) => events.map(([, words]) => `<li>${esc(words)}</li>`).join('');

/**
 * Which section “On this page” marks: the last one whose top has reached
 * `line` (pixels from the top of the window), or the last one when the page
 * is scrolled to its end. -1 above the first section.
 */
export function activeSectionIndex(tops, line, atEnd = false) {
  if (!Array.isArray(tops) || !tops.length) return -1;
  if (atEnd) return tops.length - 1;
  let active = -1;
  tops.forEach((top, index) => { if (Number.isFinite(top) && top <= line) active = index; });
  return active;
}

/** Where a section counts as being read: a quarter of the way down, under the sticky header. */
export const readingLine = (headerHeight, windowHeight) => {
  const header = Number.isFinite(headerHeight) && headerHeight > 0 ? headerHeight : 0;
  const view = Number.isFinite(windowHeight) && windowHeight > header ? windowHeight - header : 0;
  return Math.round(header + Math.max(48, view * 0.25));
};

const countsNote = on => (on
  ? 'On for this browser, for the planner and the welcome page.'
  : 'Off for this browser: nothing is counted from here.');

/* Page ---------------------------------------------------------------------- */

function fill(doc, selector, html) {
  doc.querySelectorAll(selector).forEach(node => { node.innerHTML = html; });
}

function setupCountsSwitch(doc) {
  const box = doc.querySelector('[data-legal-counts]');
  const toggle = box?.querySelector('[data-legal-counts-toggle]');
  if (!box || !toggle || !plannerApiEnabled()) return;
  const note = box.querySelector('[data-legal-counts-note]');
  const show = () => {
    const on = usageCountsEnabled();
    toggle.checked = on;
    if (note) note.textContent = countsNote(on);
  };
  toggle.addEventListener('change', () => {
    setUsageCountsEnabled(toggle.checked);
    show();
  });
  show();
  box.hidden = false;
}

/*
 * “On this page” follows the reading: the link of the section in view gets
 * aria-current="true" and the links' hover colour (legal.css). The sections
 * are watched with an IntersectionObserver on a one-pixel line, so nothing
 * runs while scrolling inside a section. A link that was just clicked stays
 * marked until the jump has settled, even when the section is too short to
 * reach the line.
 */
function setupContents(doc) {
  const win = doc.defaultView;
  const toc = doc.querySelector('.lg-toc');
  if (!toc || !win || typeof win.IntersectionObserver !== 'function') return;
  const items = [...toc.querySelectorAll('a[href^="#"]')]
    .map(link => ({ link, section: doc.getElementById(decodeURIComponent(link.hash.slice(1))) }))
    .filter(item => item.section);
  if (!items.length) return;
  const root = doc.documentElement;
  let current = -2;
  let pinned = false;
  let release = 0;
  let observer = null;
  let footSeen = false;

  const header = () => doc.querySelector('.lg-top')?.getBoundingClientRect().height || 0;
  // The end of the page: scrolled to the bottom (within a pixel or two: zoom rounds), and there was something to scroll.
  const atEnd = () => root.scrollHeight > win.innerHeight + 4 && (footSeen || win.scrollY + win.innerHeight >= root.scrollHeight - 2);

  // Keeps the marked link in view when the contents scroll on their own (sticky, wide screens).
  function reveal(link) {
    if (!link || toc.scrollHeight <= toc.clientHeight + 1) return;
    const box = toc.getBoundingClientRect();
    const rect = link.getBoundingClientRect();
    if (rect.top < box.top + 40) toc.scrollTop -= box.top + 40 - rect.top;
    else if (rect.bottom > box.bottom - 16) toc.scrollTop += rect.bottom - box.bottom + 16;
  }

  function mark(index) {
    if (index === current) return;
    current = index;
    items.forEach((item, position) => {
      if (position === index) item.link.setAttribute('aria-current', 'true');
      else item.link.removeAttribute('aria-current');
    });
    reveal(items[index]?.link);
  }

  function update() {
    if (pinned) return;
    const line = readingLine(header(), win.innerHeight);
    mark(activeSectionIndex(items.map(item => item.section.getBoundingClientRect().top), line, atEnd()));
  }

  function watch() {
    observer?.disconnect();
    const line = readingLine(header(), win.innerHeight);
    observer = new win.IntersectionObserver(update, { rootMargin: `-${line}px 0px -${Math.max(0, win.innerHeight - line - 1)}px 0px` });
    items.forEach(item => observer.observe(item.section));
  }

  // At the end of the page the last section is marked, even when it is too short to reach the line.
  const foot = doc.querySelector('.lg-foot');
  if (foot) {
    new win.IntersectionObserver(entries => {
      footSeen = entries[entries.length - 1].intersectionRatio > .97;
      update();
    }, { threshold: [0, .5, .97, 1] }).observe(foot);
  }

  function settle() {
    win.clearTimeout(release);
    release = win.setTimeout(() => { pinned = false; }, 120);
  }

  toc.addEventListener('click', event => {
    const link = event.target.closest('a[href^="#"]');
    const index = items.findIndex(item => item.link === link);
    if (index < 0) return;
    mark(index);
    pinned = true;
    // Released once the jump stops moving (or at once if there was nothing to scroll).
    win.clearTimeout(release);
    release = win.setTimeout(() => { pinned = false; }, 1200);
  });
  let ticking = 0;
  win.addEventListener('scroll', () => {
    if (pinned) { settle(); return; }
    // Reaching the very bottom moves no section across the reading line: check it here too.
    win.cancelAnimationFrame(ticking);
    ticking = win.requestAnimationFrame(() => { if (atEnd()) update(); });
  }, { passive: true });

  let resizing = 0;
  win.addEventListener('resize', () => {
    win.cancelAnimationFrame(resizing);
    resizing = win.requestAnimationFrame(() => { watch(); update(); });
  });
  watch();
}

/** Fills the page from the configuration. `root` is the site root, relative to the page. */
export function applyLegal(doc, { config = { SUPPORT_EMAIL, PRIVACY_EMAIL, LEGAL_PHONE, LEGAL_ADDRESS, LEGAL_REGISTRATION }, root = doc.body?.dataset.root || '../' } = {}) {
  const details = legalDetails(config);
  // data-legal-details="notice" | "privacy"; data-legal-contact="support" | "privacy" (see detailRows and contactEmail).
  ['notice', 'privacy'].forEach(page => fill(doc, `[data-legal-details="${page}"]`, detailsHtml(detailRows(details, root, page))));
  ['support', 'privacy'].forEach(topic => fill(doc, `[data-legal-contact="${topic}"]`, contactPhrase(details, root, topic)));
  fill(doc, '[data-legal-events="planner"]', eventsHtml(COUNTED_EVENTS));
  fill(doc, '[data-legal-events="landing"]', eventsHtml(landingMoments(LANDING_EVENTS)));
  doc.querySelectorAll('[data-legal-js]').forEach(node => { node.hidden = false; });
  doc.querySelectorAll('[data-legal-nojs]').forEach(node => { node.hidden = true; });
  setupCountsSwitch(doc);
  setupContents(doc);
}

if (typeof document !== 'undefined') applyLegal(document);
