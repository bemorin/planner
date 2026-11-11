import { qs, qsa } from '../lib/dom.js';
import { trackEvent } from '../lib/planner-api.js';

/**
 * Install Daily Planner as an app (PWA), explained for the browser in hand.
 *
 * Chromium offers a real install prompt; Safari (iPhone, iPad, Mac) and other
 * browsers need a few taps, which the modal shows as a looping replica of the
 * browser's own UI. Each browser keeps its own planner data, so the modal also
 * says so when installing elsewhere would start empty.
 */

/** Pure platform → install-mode mapping (unit-tested). */
export function installMode({ ua = '', platform = '', maxTouchPoints = 0, standalone = false, hasPrompt = false } = {}) {
  if (standalone) return 'installed';
  if (hasPrompt) return 'prompt';
  const iOS = /iPad|iPhone|iPod/i.test(ua) || (platform === 'MacIntel' && maxTouchPoints > 1);
  const android = /Android/i.test(ua);
  const firefox = /Firefox|FxiOS/i.test(ua);
  const chromium = /Chrome|Chromium|CriOS|Edg|OPR|SamsungBrowser/i.test(ua);
  const safari = /Safari/i.test(ua) && !chromium && !firefox;
  if (iOS) return 'ios';
  // Android has no address-bar install icon: without a prompt, use the menu.
  if (android) return 'android-menu';
  if (safari && /Macintosh/i.test(ua)) return 'mac-safari';
  if (firefox) return 'firefox';
  if (chromium) return 'chromium';
  return 'other';
}

const ICON_SHARE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V3.5M8 7.5l4-4 4 4"/><path d="M7 11H5.5v9.5h13V11H17"/></svg>';
const ICON_PLUS_SQUARE = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="3.5"/><path d="M12 8v8M8 12h8"/></svg>';
const ICON_INSTALL = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="12.5" rx="2"/><path d="M12 8.5v5.5M9.5 11.5 12 14l2.5-2.5M8.5 20h7"/></svg>';
const ICON_DOTS = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="5.5" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="12" cy="18.5" r="1.3"/></svg>';

const BENEFITS = `<ul class="install-benefits">
  <li><strong>Its own window</strong><span>Opens like an app, without browser tabs.</span></li>
  <li><strong>Works offline</strong><span>Plan on a train or a plane.</span></li>
  <li><strong>Same plans</strong><span>Uses the data already in this browser. No account.</span></li>
</ul>`;

const host = () => (location.host && !/^(localhost|127\.0\.0\.1)(:|$)/.test(location.host) ? location.host : 'planner.bemorin.com');

const APP_TILE = '<span class="install-app-tile"><img src="./pwa-192.png" alt="" width="40" height="40" decoding="async"></span>';

function iosReplica() {
  return `<div class="install-replica install-replica--ios" data-install-replica aria-hidden="true">
    <div class="install-phone">
      <div class="install-phone__screen">
        <div class="install-ios-page"><span></span><span></span><span></span></div>
        <div class="install-ios-sheet">
          <div class="install-ios-sheet__head">${APP_TILE}<span><b>Daily Planner</b><small>${host()}</small></span></div>
          <div class="install-ios-sheet__row">Copy</div>
          <div class="install-ios-sheet__row install-ios-sheet__row--target">Add to Home Screen ${ICON_PLUS_SQUARE}</div>
          <div class="install-ios-sheet__row">Add Bookmark</div>
        </div>
        <div class="install-ios-confirm"><span>Cancel</span><b>Add to Home Screen</b><strong>Add</strong></div>
        <div class="install-ios-home"><span></span><span></span><span></span>${APP_TILE}</div>
        <div class="install-ios-bar"><span></span><span></span><span class="install-ios-bar__share">${ICON_SHARE}</span><span></span><span></span></div>
        <span class="install-finger"></span>
      </div>
    </div>
  </div>`;
}

function desktopReplica(kind) {
  const bar = kind === 'chromium'
    ? `<div class="install-browser__bar"><span class="install-browser__url">${host()}</span><span class="install-browser__action">${ICON_INSTALL}</span><span class="install-browser__menu">${ICON_DOTS}</span></div>
       <div class="install-browser__popup"><b>Install app?</b><span>${APP_TILE}Daily Planner</span><em>Install</em></div>`
    : `<div class="install-browser__bar install-browser__bar--safari"><span class="install-browser__menu-title">File</span><span class="install-browser__url">${host()}</span></div>
       <div class="install-browser__dropdown"><span>New Window</span><span>New Tab</span><span class="is-target">Add to Dock…</span><span>Close Window</span></div>`;
  return `<div class="install-replica install-replica--${kind}" data-install-replica aria-hidden="true">
    <div class="install-browser">${bar}<div class="install-browser__page"><span></span><span></span><span></span></div><span class="install-cursor"></span></div>
    <div class="install-dock"><span></span><span></span>${APP_TILE}<span></span></div>
  </div>`;
}

const STEPS = {
  ios: ['Tap the <b>Share</b> button in Safari’s toolbar.', 'Scroll and choose <b>Add to Home Screen</b>.', 'Tap <b>Add</b>. Daily Planner is now on your home screen.'],
  'mac-safari': ['In Safari’s menu bar, open <b>File</b> (or tap the Share button).', 'Choose <b>Add to Dock…</b>', 'Click <b>Add</b>. Daily Planner opens from your Dock in its own window.'],
  chromium: ['Click the <b>install icon</b> at the right of the address bar — or open the browser menu.', 'Choose <b>Install Daily Planner</b>.', 'Confirm. It opens in its own window and from your apps.'],
  'android-menu': ['Open the browser menu <b>⋮</b>.', 'Choose <b>Install app</b> or <b>Add to Home screen</b>.', 'Confirm. Daily Planner appears with your other apps.']
};

export function createInstallFeature({ openModal, closeModal, getCloseDayCount = () => 0, wasPrompted = () => true, markPrompted = () => {} }) {
  let deferredPrompt = null;
  const modal = () => qs('[data-install-modal]');
  const body = () => qs('[data-install-body]');

  const isInstalled = () => window.matchMedia?.('(display-mode: standalone)')?.matches || navigator.standalone === true;
  const currentMode = () => installMode({ ua: navigator.userAgent || '', platform: navigator.platform || '', maxTouchPoints: navigator.maxTouchPoints || 0, standalone: isInstalled(), hasPrompt: !!deferredPrompt });

  function stepsHtml(mode) {
    const steps = STEPS[mode];
    if (!steps) return '';
    return `<ol class="install-steps" data-install-steps>${steps.map((step, index) => `<li data-install-step="${index}"><span>${index + 1}</span><p>${step}</p></li>`).join('')}</ol>`;
  }

  function render() {
    const mode = currentMode();
    const root = modal();
    if (!root) return;
    root.dataset.installMode = mode;
    let html = '';
    if (mode === 'installed') {
      html = `<header class="modal__header"><p class="modal__eyebrow">Installed</p><h2 id="install-title">Daily Planner is already an app here.</h2><p>Open it from your Dock, Start menu or home screen. It shares its plans with this browser.</p></header>
        <div class="modal__actions"><span></span><div class="modal__actions-right"><button class="primary-button" type="button" data-install-later>Done</button></div></div>`;
    } else if (mode === 'prompt') {
      html = `<header class="modal__header"><p class="modal__eyebrow">Install app</p><h2 id="install-title">Keep your planner one click away.</h2><p>Install Daily Planner on this device. It takes a second and you can remove it like any app.</p></header>
        ${desktopReplica('chromium')}${BENEFITS}
        <div class="modal__actions"><button class="text-button" type="button" data-install-later>Not now</button><div class="modal__actions-right"><button class="primary-button" type="button" data-install-confirm>Install Daily Planner</button></div></div>`;
    } else if (mode === 'firefox' || mode === 'other') {
      html = `<header class="modal__header"><p class="modal__eyebrow">Install app</p><h2 id="install-title">This browser can’t install web apps.</h2><p>Open <b>${host()}</b> in Chrome, Edge or Safari and install it from there.</p></header>
        <p class="install-note"><b>Your plans stay in this browser.</b> Each browser keeps its own data, so before switching, use <b>Export → Backup all data</b> here and <b>Import backup</b> in the new browser — or connect Google Drive sync on both.</p>
        ${BENEFITS}
        <div class="modal__actions"><span></span><div class="modal__actions-right"><button class="primary-button" type="button" data-install-later>Got it</button></div></div>`;
    } else {
      const replica = mode === 'ios' ? iosReplica() : desktopReplica(mode === 'mac-safari' ? 'safari' : 'chromium');
      const lead = mode === 'ios' ? 'Three taps in Safari put Daily Planner on your home screen.' : mode === 'mac-safari' ? 'Safari can add Daily Planner to your Dock as its own app.' : 'Your browser can install Daily Planner as its own app.';
      html = `<header class="modal__header"><p class="modal__eyebrow">Install app</p><h2 id="install-title">Keep your planner one tap away.</h2><p>${lead}</p></header>
        <div class="install-guide">${replica}${stepsHtml(mode)}</div>
        ${BENEFITS}
        <div class="modal__actions"><span></span><div class="modal__actions-right"><button class="primary-button" type="button" data-install-later>Got it</button></div></div>`;
    }
    body().innerHTML = html;
    qsa('[data-install-later]', body()).forEach(button => button.addEventListener('click', () => closeModal(root)));
    qs('[data-install-confirm]', body())?.addEventListener('click', async () => {
      const accepted = await promptInstall();
      if (accepted) { trackEvent('install_accepted'); closeModal(root); } else render();
    });
    syncStepHighlight();
  }

  // The replica animation loops through three phases; highlight the matching step.
  let stepTimer = null;
  function syncStepHighlight() {
    clearInterval(stepTimer);
    const steps = qsa('[data-install-step]', body());
    if (!steps.length) return;
    let index = 0;
    const show = () => steps.forEach((step, stepIndex) => step.classList.toggle('is-active', stepIndex === index));
    show();
    stepTimer = setInterval(() => {
      if (!modal() || modal().hidden) { clearInterval(stepTimer); return; }
      index = (index + 1) % steps.length;
      show();
    }, 2200);
  }

  async function promptInstall() {
    if (!deferredPrompt) return false;
    const prompt = deferredPrompt;
    deferredPrompt = null;
    try {
      await prompt.prompt();
      const choice = await prompt.userChoice;
      return choice?.outcome === 'accepted';
    } catch (_) {
      return false;
    }
  }

  function open() {
    render();
    openModal(modal(), qs('.modal__actions .primary-button', modal()) || qs('.modal__close', modal()));
    trackEvent('install_modal_opened');
  }

  /** Offer installation once, after the planner has proved useful. */
  function maybePrompt() {
    if (wasPrompted() || getCloseDayCount() < 5 || !deferredPrompt || isInstalled()) return false;
    markPrompted();
    open();
    return true;
  }

  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    deferredPrompt = event;
    if (modal() && !modal().hidden) render();
  });
  window.addEventListener('appinstalled', () => { deferredPrompt = null; if (modal() && !modal().hidden) render(); });

  return { open, maybePrompt, isInstalled, canPrompt: () => !!deferredPrompt, mode: currentMode };
}
