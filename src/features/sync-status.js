import { esc } from '../lib/text.js';
import { backLayers } from '../ui/back-stack.js';
import { keepTab } from '../ui/dialog-focus.js';
import { popoverEnter } from '../ui/motion.js';
import { MARKS, RECONNECT_ICON, cloudName, cloudShort, conflictSummary, sinceLabel } from './personal-sync-view.js';

/**
 * Personal sync's header alert (1.38), outside Settings: shown only while
 * something waits on the person (styles/sync.css, “Header alert”).
 *
 * - Access ended with changes waiting (Google's hour, or Dropbox asking to be
 *   connected again): “Not in Drive since 14:58”, and a popover with the one
 *   tap that reconnects and sends them. Google's window opens from that tap
 *   itself: reconnect() reaches requestAccessToken before anything is
 *   awaited, with Google's sign-in loaded as soon as the alert can show.
 * - A conflict, or a passphrase the synced copy waits for: their own words,
 *   and a way to Settings → Personal sync, where they are settled.
 * - Everything saved: nothing.
 *
 * Desktop: a pill before Search. Where the header hides its secondary
 * buttons (≤1080px): a 40px icon with a dot, whose name and tooltip are the
 * full sentence. The popover follows the app's: Escape, a click outside and
 * Back close it (src/ui/back-stack.js), focus goes in and comes back to the
 * pill. After a reconnect that saved everything, the pill says “Saved” for a
 * moment, then goes.
 *
 * It reads Personal sync through its small API (src/features/personal-sync.js):
 * getState(), subscribe(), reconnect(), prepare().
 */

/** How long “Saved” stays on the pill after a reconnect sent everything. */
export const SAVED_MS = 1500;
/** Where the header hides its secondary buttons (styles/core.css): the alert is an icon. */
const COMPACT_QUERY = '(max-width: 1080px)';
/** Phones: the popover spans the screen, 12px from each edge. */
const PHONE_QUERY = '(max-width: 560px)';
const GUTTER = 12;
const POPOVER_WIDTH = 320;

/**
 * What the alert says, from Personal sync's state (getState()): null when nothing waits on the person.
 * { kind: 'reconnect' | 'conflict' | 'passphrase', pill, label (the full sentence), title, lead, body,
 *   primary, icon, action ('reconnect' | 'settings'), secondary ('' for none) }.
 */
export function alertView(state, { now = new Date(), clock } = {}) {
  if (!state?.configured || !state.connected) return null;
  const name = cloudName(state.cloud);
  if (state.need) {
    const create = state.need === 'create';
    const changed = state.need === 'changed';
    return {
      kind: 'passphrase',
      pill: 'Passphrase needed',
      label: create ? 'Sync is waiting for a passphrase' : 'Sync is waiting for your passphrase',
      title: create ? 'Choose a passphrase to start syncing' : changed ? 'The passphrase was changed' : 'Sync is waiting for your passphrase',
      lead: create ? `Connected to ${name}. A passphrase seals your copy before anything is sent.` : changed ? 'It was changed on another device. Type the new one once on this device.' : 'Your synced copy is sealed. Type its passphrase once on this device.',
      body: 'Your changes are safe here meanwhile.',
      primary: create ? 'Choose a passphrase' : 'Enter passphrase',
      icon: '',
      action: 'settings',
      secondary: ''
    };
  }
  if (state.conflicts > 0) {
    return {
      kind: 'conflict',
      pill: 'Sync needs a choice',
      label: 'Sync needs a choice: some changes were made on two devices',
      title: 'Changes on two devices',
      lead: conflictSummary(state.conflicts),
      body: 'Both versions are kept until you choose which one stays. Your planner keeps working meanwhile.',
      primary: 'Review in Settings',
      icon: '',
      action: 'settings',
      secondary: ''
    };
  }
  if (state.reconnect && state.dirty) {
    const since = sinceLabel(state.lastSyncedAt, now, clock ? { clock } : {});
    const count = Number.isInteger(state.dirtyCount) && state.dirtyCount > 0 ? state.dirtyCount : 0;
    const sentence = since ? `Not saved to ${name} since ${since}` : `Not saved to ${name} yet`;
    return {
      kind: 'reconnect',
      pill: since ? `Not in ${cloudShort(state.cloud)} since ${since}` : `Not in ${cloudShort(state.cloud)} yet`,
      label: sentence,
      title: sentence,
      lead: count ? `${count} ${count === 1 ? 'change is' : 'changes are'} safe on this device.` : 'Your changes are safe on this device.',
      body: state.error || (state.cloud === 'google'
        ? 'Google ends access after an hour. One tap reconnects and sends them; nothing is lost meanwhile.'
        : `${name} asked to be connected again. One tap reconnects and sends them; nothing is lost meanwhile.`),
      primary: 'Reconnect and save',
      icon: 'reconnect',
      action: 'reconnect',
      secondary: 'Sync settings'
    };
  }
  return null;
}

/** The popover's content (its title and lead name and describe the dialog). */
export function popoverMarkup(view, cloud) {
  const mark = MARKS[cloud] || MARKS.google;
  const secondary = view.secondary ? `<button class="text-button" type="button" data-sync-alert-action="settings">${esc(view.secondary)}</button>` : '';
  const icon = view.icon === 'reconnect' ? RECONNECT_ICON : '';
  return `<div class="sync-popover__head">
      <span class="personal-sync-mark personal-sync-mark--lg" aria-hidden="true"><img src="${mark}" alt="" width="22" height="22" decoding="async"><i class="personal-sync-dot" data-tone="wait"></i></span>
      <div><strong id="sync-alert-title">${esc(view.title)}</strong><span id="sync-alert-lead">${esc(view.lead)}</span></div>
    </div>
    <p id="sync-alert-body">${esc(view.body)}</p>
    <div class="sync-popover__actions">${secondary}<button class="primary-button" type="button" data-sync-alert-action="${view.action}">${icon}<span>${esc(view.primary)}</span></button></div>`;
}

export function createSyncStatus({
  sync,
  openSettings = () => {},
  onLayout = () => {},
  doc = typeof document !== 'undefined' ? document : null,
  win = typeof window !== 'undefined' ? window : null,
  now = () => new Date(),
  timers = { set: (fn, ms) => setTimeout(fn, ms), clear: id => clearTimeout(id) },
  layers = backLayers
} = {}) {
  const trigger = doc?.querySelector('[data-sync-alert]');
  const text = doc?.querySelector('[data-sync-alert-text]');
  const live = doc?.querySelector('[data-sync-alert-live]');
  if (!trigger || typeof sync?.subscribe !== 'function') return { render() {}, close() {}, destroy() {}, get mode() { return 'none'; } };

  const compact = win?.matchMedia?.(COMPACT_QUERY) || null;
  const phone = win?.matchMedia?.(PHONE_QUERY) || null;
  const handle = { syncAlert: true };
  let state = null;
  let view = null;
  let mode = 'none';
  let popover = null;
  // After “Reconnect and save”: “Saving…” until the sync ends, then “Saved” for a moment.
  let saving = false;
  let savedTimer = null;
  let savedCloud = '';
  let shown = '';

  const focusedInside = () => !!popover && popover.contains(doc.activeElement);

  function place() {
    if (!popover) return;
    const rect = trigger.getBoundingClientRect();
    const viewport = win?.innerWidth || doc.documentElement.clientWidth || 0;
    const width = phone?.matches ? viewport - GUTTER * 2 : Math.min(POPOVER_WIDTH, viewport - GUTTER * 2);
    const centre = rect.left + rect.width / 2;
    const left = phone?.matches ? GUTTER : Math.max(GUTTER, Math.min(centre - width / 2, viewport - GUTTER - width));
    popover.style.width = `${Math.round(width)}px`;
    popover.style.left = `${Math.round(left)}px`;
    popover.style.top = `${Math.round(rect.bottom + 10)}px`;
    popover.style.setProperty('--arrow-x', `${Math.round(Math.max(18, Math.min(centre - left, width - 18)))}px`);
  }

  function onKeydown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close({ focus: true });
      return;
    }
    if (event.key === 'Tab') { keepTab(event, popover); return; }
    // The planner's single-key shortcuts stay out of the popover.
    event.stopPropagation();
  }

  function onOutside(event) {
    if (!popover || popover.contains(event.target) || trigger.contains(event.target)) return;
    close({ focus: false });
  }

  function onAction(event) {
    const button = event.target.closest?.('[data-sync-alert-action]');
    if (!button) return;
    if (button.dataset.syncAlertAction === 'reconnect') {
      // Google's window, from this tap: reconnect() reaches requestAccessToken before anything is awaited.
      saving = true;
      savedCloud = state?.cloud || '';
      // From the keyboard (or a screen reader: detail 0), focus comes back to the pill; a tap leaves no ring behind.
      close({ focus: !event.detail });
      // Still within the click, nothing awaited: reconnect() reaches requestAccessToken now.
      const running = Promise.resolve(sync.reconnect());
      render();
      running.then(result => {
        saving = false;
        if (result?.status === 'ok' && !alertView(sync.getState(), { now: now() })) {
          if (live) live.textContent = `Saved to ${cloudName(savedCloud)}.`;
          timers.clear(savedTimer);
          savedTimer = timers.set(() => { savedTimer = null; render(); }, SAVED_MS);
        }
        render();
      }, () => { saving = false; render(); });
      return;
    }
    close({ focus: false });
    openSettings();
  }

  function open() {
    if (popover || !view) return;
    popover = doc.createElement('div');
    popover.className = 'app-popover sync-popover';
    popover.id = 'sync-alert-popover';
    popover.setAttribute('role', 'dialog');
    popover.setAttribute('aria-labelledby', 'sync-alert-title');
    popover.setAttribute('aria-describedby', 'sync-alert-lead sync-alert-body');
    popover.dataset.kind = view.kind;
    popover.innerHTML = popoverMarkup(view, state.cloud);
    doc.body.append(popover);
    trigger.setAttribute('aria-expanded', 'true');
    trigger.setAttribute('aria-controls', popover.id);
    place();
    popover.addEventListener('keydown', onKeydown);
    popover.addEventListener('click', onAction);
    doc.addEventListener('pointerdown', onOutside, true);
    win?.addEventListener?.('resize', place);
    layers.open(handle, { back: () => close({ focus: focusedInside() }), alive: () => !!popover });
    const el = popover;
    (win?.requestAnimationFrame || (fn => fn()))(() => { el.classList.add('is-open'); popoverEnter(el); });
    popover.querySelector('.primary-button')?.focus({ preventScroll: true });
  }

  function close({ focus = false } = {}) {
    if (!popover) return;
    const el = popover;
    popover = null;
    el.removeEventListener('keydown', onKeydown);
    el.removeEventListener('click', onAction);
    doc.removeEventListener('pointerdown', onOutside, true);
    win?.removeEventListener?.('resize', place);
    el.remove();
    trigger.setAttribute('aria-expanded', 'false');
    trigger.removeAttribute('aria-controls');
    layers.closed(handle);
    if (focus && !trigger.hidden) trigger.focus({ preventScroll: true });
  }

  /** Drawn from the state Personal sync just told (subscribe), or read now. */
  function render(next = null) {
    state = next || sync.getState();
    view = alertView(state, { now: now() });
    // Google's sign-in loaded as soon as the alert can show, so its tap opens the window at once. A load that
    // failed (offline) is remembered by Personal sync until the browser is back online: not asked for at each render.
    if (view?.action === 'reconnect') sync.prepare?.();
    mode = savedTimer != null ? 'saved' : saving ? 'saving' : view ? 'alert' : 'none';
    if (mode !== 'alert' && popover) close({ focus: focusedInside() });
    const hadFocus = doc.activeElement === trigger;
    const label = mode === 'saved' ? `Saved to ${cloudName(savedCloud)}` : mode === 'saving' ? `Saving to ${cloudName(savedCloud)}…` : view?.label || '';
    const words = mode === 'saved' ? 'Saved' : mode === 'saving' ? 'Saving…' : view?.pill || '';
    const key = `${mode}|${words}|${label}|${compact?.matches ? 'c' : 'w'}`;
    if (key === shown) return;
    const wasHidden = trigger.hidden;
    shown = key;
    trigger.hidden = mode === 'none';
    trigger.dataset.mode = mode;
    trigger.dataset.kind = view?.kind || '';
    if (text) text.textContent = words;
    if (label) trigger.dataset.tooltip = label;
    else delete trigger.dataset.tooltip;
    // The icon alone (compact header) is named by the full sentence; the pill, by its own words.
    if (compact?.matches && label) trigger.setAttribute('aria-label', label);
    else trigger.removeAttribute('aria-label');
    trigger.setAttribute('aria-disabled', String(mode !== 'alert'));
    if (mode !== 'saved' && live && live.textContent) live.textContent = '';
    if (wasHidden !== trigger.hidden || mode !== 'none') onLayout();
    // Gone while it had focus: focus moves on to Search, beside it.
    if (trigger.hidden && hadFocus) doc.querySelector('[data-search-open]')?.focus({ preventScroll: true });
  }

  trigger.addEventListener('click', () => {
    if (mode !== 'alert') return;
    if (popover) close({ focus: true });
    else open();
  });
  compact?.addEventListener?.('change', () => { shown = ''; render(); });
  const unsubscribe = sync.subscribe(next => render(next));
  render();

  return {
    render,
    close,
    destroy() {
      close();
      unsubscribe();
      timers.clear(savedTimer);
    },
    get mode() { return mode; },
    get open() { return !!popover; }
  };
}
