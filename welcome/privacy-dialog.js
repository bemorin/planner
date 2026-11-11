/**
 * The landing page's privacy notice, in a dialog that looks like the
 * planner's own: what this page counts (with the switch to stop it), and
 * what a question sent from the Contact page keeps. Its facts are written in
 * the page; the counted moments come from LANDING_EVENTS, only those the
 * page sends (landing-model.js landingMoments, passed in as plain words), so
 * the list cannot drift from what the page sends.
 *
 * A native modal <dialog>: the page behind is inert and Escape closes it. It
 * opens and closes with a short animation when motion is welcome, gives focus
 * back to whatever opened it, keeps Tab inside (the planner's dialog helper,
 * src/ui/dialog-focus.js: a native dialog would let it reach the browser's own
 * bar), and opens on its own when the address ends in #privacy. Its one import
 * is that helper; the page hands it the rest.
 */

import { keepTab } from '../src/ui/dialog-focus.js';

const NOTE_ON = 'On in this browser, here and in the planner.';
const NOTE_OFF = 'Off in this browser: nothing is counted from here or from the planner.';
const HASH = '#privacy';

/**
 * @param {object} options
 * @param {HTMLDialogElement} options.dialog
 * @param {boolean} options.enabled       False when the page counts and stores nothing (no owner API).
 * @param {string[]} options.moments      The counted moments, in plain words.
 * @param {() => boolean} options.countsEnabled
 * @param {(on: boolean) => void} options.setCountsEnabled
 * @param {() => boolean} options.reduceMotion
 */
export function createPrivacyDialog({ dialog, enabled, moments = [], countsEnabled = () => true, setCountsEnabled = () => {}, reduceMotion = () => false }) {
  if (!dialog || typeof dialog.showModal !== 'function') return { open() {}, close() {} };
  const root = document.documentElement;
  const find = selector => dialog.querySelector(selector);
  const scroller = find('[data-privacy-scroll]');
  const toggle = find('[data-privacy-switch]');
  const note = find('[data-privacy-note]');
  const list = find('[data-privacy-moments]');
  let opener = null;
  let fromHash = false;
  let closing = false;
  let settle = null;
  let settleTimer = 0;
  let flashTimer = 0;

  if (list) list.replaceChildren(...moments.map(text => Object.assign(document.createElement('li'), { textContent: text })));

  const syncSwitch = () => {
    const on = countsEnabled();
    if (toggle) toggle.checked = on;
    if (note) note.textContent = on ? NOTE_ON : NOTE_OFF;
  };

  toggle?.addEventListener('change', () => {
    setCountsEnabled(toggle.checked);
    syncSwitch();
  });

  function open({ section = '', from = document.activeElement, hash = false } = {}) {
    if (!enabled) return;
    if (closing) finish();
    if (dialog.open) return;
    opener = from instanceof HTMLElement && from !== document.body ? from : null;
    fromHash = hash;
    syncSwitch();
    // The page stops scrolling behind; its scrollbar's room is kept, so nothing shifts.
    root.style.setProperty('--scrollbar-gap', `${Math.max(0, window.innerWidth - root.clientWidth)}px`);
    root.classList.add('has-dialog');
    dialog.showModal();
    if (scroller) scroller.scrollTop = 0;
    const part = section ? find(`[data-privacy-section="${section}"]`) : null;
    const heading = part ? part.querySelector('h3') : find('#privacy-title');
    if (part && scroller) {
      scroller.scrollTop = Math.max(0, part.offsetTop - scroller.offsetTop - 12);
      part.classList.remove('is-flash');
      window.clearTimeout(flashTimer);
      void part.offsetWidth;
      part.classList.add('is-flash');
      flashTimer = window.setTimeout(() => part.classList.remove('is-flash'), 1800);
    }
    heading?.focus({ preventScroll: true });
  }

  function finish() {
    closing = false;
    if (settle) dialog.removeEventListener('animationend', settle);
    window.clearTimeout(settleTimer);
    settle = null;
    dialog.classList.remove('is-closing');
    if (dialog.open) dialog.close();
  }

  function close() {
    if (!dialog.open || closing) return;
    if (reduceMotion()) {
      finish();
      return;
    }
    closing = true;
    dialog.classList.add('is-closing');
    // The panel's own fade-out ends it (not the backdrop's, nor a child's).
    settle = event => { if (event.target === dialog && event.animationName === 'pv-out') finish(); };
    settleTimer = window.setTimeout(finish, 320);
    dialog.addEventListener('animationend', settle);
  }

  dialog.addEventListener('close', () => {
    closing = false;
    dialog.classList.remove('is-closing');
    root.classList.remove('has-dialog');
    root.style.removeProperty('--scrollbar-gap');
    if (fromHash && location.hash === HASH) history.replaceState(history.state, '', `${location.pathname}${location.search}`);
    fromHash = false;
    const back = opener;
    opener = null;
    if (back?.isConnected) back.focus({ preventScroll: true });
  });

  // Escape: animate out instead of vanishing.
  dialog.addEventListener('cancel', event => {
    event.preventDefault();
    close();
  });

  // A click on the backdrop closes; a drag that starts inside the panel doesn't.
  let downOutside = false;
  dialog.addEventListener('pointerdown', event => { downOutside = event.target === dialog; });
  dialog.addEventListener('click', event => {
    if (event.target === dialog && downOutside) close();
    downOutside = false;
  });

  dialog.querySelectorAll('[data-privacy-close]').forEach(button => button.addEventListener('click', close));
  dialog.addEventListener('keydown', event => keepTab(event, dialog));

  document.addEventListener('click', event => {
    const trigger = event.target.closest('[data-privacy-open], a[href="#privacy"]');
    if (!trigger || dialog.contains(trigger) || !enabled) return;
    event.preventDefault();
    open({ section: trigger.dataset.privacyOpen || '', from: trigger });
  });

  const fromAddress = () => { if (location.hash === HASH) open({ hash: true, from: null }); };
  window.addEventListener('hashchange', fromAddress);

  document.querySelectorAll('[data-privacy-open]').forEach(button => { if (!dialog.contains(button)) button.hidden = !enabled; });
  fromAddress();

  return { open, close };
}
