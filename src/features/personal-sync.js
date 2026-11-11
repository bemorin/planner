import { qs, qsa } from '../lib/dom.js';
import { esc } from '../lib/text.js';
import { SyncRemoteChangedError } from '../sync/cloud.js';
import { createGoogleDriveProvider } from '../sync/google-drive.js';
import { createDropboxProvider, readOAuthReturn } from '../sync/dropbox.js';
import { createKeyStore } from '../sync/key-store.js';
import { createScratchLedger } from '../sync/ledger.js';
import { SyncPassphraseNeededError, createSealedTransport, createSyncProtection } from '../sync/protection.js';
import { passphraseStrength } from '../sync/seal.js';
import { createRecoveryStore } from '../sync/recovery-store.js';
import { createSyncEngine } from '../sync/engine.js';
import { createSyncScheduler } from '../sync/scheduler.js';
import { whenPlannerShown } from './app-entrance.js';
import { DROPBOX_BLOCKED_LINE, MARKS, RECONNECT_ICON, cloudName, conflictSummary, panelMarkup, passphraseProblem, relativeSyncLabel, returnNote, sealLineMarkup, storageSyncLine, strengthMarkup, syncLead, syncView } from './personal-sync-view.js';

/**
 * Settings → Personal sync: the person's own Google Drive or Dropbox (1.38),
 * one sealed copy there (src/sync/protection.js), the same merge whichever
 * cloud it is (src/sync/engine.js). Automatic sync (startup, idle, focus,
 * online, hide, Close day) runs only with access already at hand: Google's
 * token (kept on this device until it runs out, src/sync/google-drive.js), or
 * Dropbox's. It never opens a sign-in.
 *
 * Google's window opens from the tap itself (Connect, Reconnect, Reconnect and
 * save in the header alert): requestAccessToken is called before anything is
 * awaited. Google's sign-in script is loaded ahead, once the person shows
 * intent: Google Drive chosen in the cards, its Connect button pointed at or
 * focused (focusin: the keyboard too), or Settings opened while connected.
 * Nothing reaches Google before that. Tapped while it still loads, the window
 * is asked for once it has (a browser may block that one: then a calm line asks
 * for one more tap). A load that failed (offline) is not tried again until the
 * browser is back online.
 *
 * Dropbox signs in on its own page: Connect leaves for it, and the planner,
 * opened again on ?code=…&state=…, takes them out of the address at once,
 * finishes the sign-in here and opens Settings on this section. It needs the
 * browser to keep site data (the sign-in waits here meanwhile): with storage
 * blocked, a line says so in its place.
 *
 * Switch to Dropbox keeps Google Drive connected until Dropbox's sign-in has
 * completed and a first Dropbox sync has run. Then, with Google's access still
 * usable, the Drive copy gets a sealed marker (`movedTo: 'dropbox'`, with what
 * this device adds to it), and the devices still on Drive offer to follow.
 *
 * getState() and subscribe() tell the header alert (./sync-status.js) what
 * waits on the person; reconnect() is its one tap.
 */

const RETURN_PARAMS = ['code', 'state', 'error', 'error_description'];
const AUTOMATIC_ERRORS = new Set(['conflict', 'auth-required', 'passphrase']);
const CHOICE_NOTE = 'Both are free and carry the same sealed copy. You can switch later.';
const MINUTE = 60_000;
// The longest a timer may wait (setTimeout's limit, about 24 days).
const LONGEST_WAIT = 2_147_000_000;

const safeLocalStorage = () => { try { return globalThis.localStorage || null; } catch { return null; } };

export function createPersonalSyncFeature({
  store,
  ledger,
  googleClientId = '',
  dropboxAppKey = '',
  buildBackup,
  flushLocal,
  reloadFromStorage,
  openSettings = () => {},
  // False when the browser keeps no site data (app.js, src/state/browser-storage.js): Dropbox is then not offered.
  storageKept = true,
  now = () => new Date(),
  idleMs = 50_000,
  maxWaitMs = 120_000,
  addEventListener = (target, type, handler, options) => target?.addEventListener?.(type, handler, options),
  documentRef = typeof document !== 'undefined' ? document : null,
  windowRef = typeof window !== 'undefined' ? window : null,
  locationRef = typeof location !== 'undefined' ? location : null,
  historyRef = typeof history !== 'undefined' ? history : null,
  providerFactories = { google: createGoogleDriveProvider, dropbox: createDropboxProvider },
  protection = null,
  recoveryStore = createRecoveryStore({ now }),
  timers = { set: (fn, ms) => setTimeout(fn, ms), clear: id => clearTimeout(id), every: (fn, ms) => setInterval(fn, ms), stop: id => clearInterval(id) },
  Observer = typeof MutationObserver === 'function' ? MutationObserver : null,
  whenShown = callback => whenPlannerShown(callback)
} = {}) {
  const root = qs('[data-personal-sync]');
  const lead = qs('[data-personal-sync-lead]');
  const choice = qs('[data-personal-sync-choice]');
  const choiceConnect = qs('[data-personal-sync-choice-connect]');
  const choiceNote = qs('[data-personal-sync-choice-note]');
  const card = qs('[data-personal-sync-card]');
  const mark = qs('[data-personal-sync-mark]');
  const dot = qs('[data-personal-sync-dot]');
  const status = qs('[data-personal-sync-status]');
  const detail = qs('[data-personal-sync-detail]');
  const primary = qs('[data-personal-sync-primary]');
  const disconnect = qs('[data-personal-sync-disconnect]');
  const access = qs('[data-personal-sync-access]');
  const accessText = qs('[data-personal-sync-access-text]');
  const meter = qs('[data-personal-sync-meter]');
  const folder = qs('[data-personal-sync-folder]');
  const folderText = qs('[data-personal-sync-folder-text]');
  const tradeOff = qs('[data-personal-sync-trade]');
  const switchBox = qs('[data-personal-sync-switch]');
  const switchOpen = qs('[data-personal-sync-switch-open]');
  const switchConfirm = qs('[data-personal-sync-switch-confirm]');
  const switchCancel = qs('[data-personal-sync-switch-cancel]');
  const switchGo = qs('[data-personal-sync-switch-go]');
  const movedBox = qs('[data-personal-sync-moved]');
  const movedGo = qs('[data-personal-sync-moved-go]');
  const blockedLine = qs('[data-personal-sync-blocked]');
  const panel = qs('[data-personal-sync-panel]');
  const sealLine = qs('[data-personal-sync-seal]');
  const recovery = qs('[data-personal-sync-recovery]');
  const conflictActions = qs('[data-personal-sync-conflict-actions]');
  const conflictCopy = qs('[data-personal-sync-conflict-copy]');
  const keepLocal = qs('[data-personal-sync-keep-local]');
  const useRemote = qs('[data-personal-sync-use-remote]');
  const helpLine = qs('[data-storage-sync-line]');

  const providers = {
    google: providerFactories.google?.({ clientId: googleClientId }) || null,
    dropbox: providerFactories.dropbox?.({ appKey: dropboxAppKey }) || null
  };
  const configured = Object.keys(providers).filter(id => providers[id]?.configured);
  // Dropbox's sign-in waits on this device while its page is open, and its access stays here: with site data blocked, it can't.
  const available = configured.filter(id => id !== 'dropbox' || storageKept);
  const dropboxBlocked = configured.includes('dropbox') && !storageKept;
  const listeners = new Set();

  // Help → Data on this device names the clouds this copy of the planner offers, or says nothing of sync.
  if (helpLine) {
    const line = storageSyncLine(configured);
    helpLine.textContent = line;
    helpLine.hidden = !line;
  }
  if (blockedLine) {
    blockedLine.textContent = DROPBOX_BLOCKED_LINE;
    blockedLine.hidden = !dropboxBlocked;
  }

  /** Dropbox's answer in the address, taken out of it at once (never kept in the history). */
  function stripOAuthReturn() {
    const href = locationRef?.href || '';
    const answer = readOAuthReturn(href);
    if (!answer) return null;
    try {
      const url = new URL(href);
      RETURN_PARAMS.forEach(name => url.searchParams.delete(name));
      historyRef?.replaceState?.(historyRef.state, '', `${url.pathname}${url.search}${url.hash}`);
    } catch {}
    return answer;
  }

  if (!root || !available.length) {
    // Dropbox alone, with site data blocked: the section says why, in one line.
    if (root) root.hidden = !dropboxBlocked;
    if (root && dropboxBlocked) {
      if (lead) lead.textContent = syncLead(configured);
      [choice, card, recovery, sealLine].forEach(element => { if (element) element.hidden = true; });
    }
    const idle = { configured: false, cloud: '', clouds: [], connected: false, busy: false, reconnect: false, accessUntil: 0, dirty: false, dirtyCount: 0, lastSyncedAt: '', conflicts: 0, need: '', error: '' };
    return { load() { if (dropboxBlocked) stripOAuthReturn(); }, syncNow() {}, noteLocalChange() {}, render() {}, destroy() {}, focus() {}, prepare() {}, reconnect: async () => null, getState: () => ({ ...idle }), subscribe: () => () => {}, clouds: [] };
  }
  root.hidden = false;

  const guard = protection || createSyncProtection({ storage: safeLocalStorage(), keyStore: createKeyStore(), now });
  const transports = Object.fromEntries(available.map(id => [id, createSealedTransport({ provider: providers[id], protection: guard })]));
  const engine = createSyncEngine({ store, ledger, recoveryStore, now });

  const ready = guard.load().catch(() => null);
  // Dropbox first, chosen unless this device already named a cloud (Google Drive, for one that synced before 1.38).
  const named = ledger.chosenCloud?.() || '';
  let selected = available.includes(named) ? named : available.includes('dropbox') ? 'dropbox' : available[0];
  let busy = false;
  let connecting = false;
  // The cloud a sign-in in progress is for (Dropbox's page, then back): the card names it, not the one still connected.
  let connectingTo = '';
  let working = false;
  let conflictCount = 0;
  let lastErrorMessage = '';
  let errorNote = '';
  let infoNote = '';
  let shownNote = '';
  let needsReconnect = false;
  // What the synced copy waits for: { reason: 'create' | 'enter' | 'changed', envelope }.
  let need = null;
  // A panel opened from the card: 'change', 'protect' (sealing a plain copy), 'forgot'.
  let mode = '';
  // What the last sync found in the cloud: 'none', 'plain' (from before 1.38) or 'sealed'.
  let copyFormat = 'none';
  let panelKind = '';
  // The inline “Switch to Dropbox” confirmation, open.
  let switching = false;
  // Switch to Dropbox under way: what was agreed on with the Drive copy, kept aside for its marker.
  let leavingBases = null;
  // destroy() ran: the DOM listeners stay attached, so they check this before acting.
  let destroyed = false;
  // Google's sign-in script couldn't load (offline): not asked for again until the browser is back online.
  let googleLoadFailed = false;
  // Focus moved by this feature itself, not by the person: not a sign of intent, so it never starts a sync.
  let quiet = false;
  // When the view must be drawn again by itself: Google's access ending, and every minute while Settings is open.
  let expiryTimer = null;
  let expiryAt = 0;
  let ticker = null;
  let settingsWatch = null;

  /** The cloud this device syncs with, or, before it does, the one chosen. */
  const active = () => {
    const stored = ledger.cloud();
    return available.includes(stored) && ledger.provider(stored).connected ? stored : selected;
  };
  const provider = () => providers[active()];
  const transport = () => transports[active()];
  const isConnected = () => !!ledger.provider(active()).connected;
  /** Switch to Dropbox under way: the cloud being left (still connected until Dropbox has synced once), or ''. */
  const leaving = () => {
    const from = ledger.provider('dropbox').switchingFrom || '';
    return from && from !== 'dropbox' && available.includes(from) && ledger.provider(from).connected ? from : '';
  };
  /** The copy in Drive says the planner moved to Dropbox, and this device is still on Drive. */
  const movedAway = () => active() === 'google' && isConnected() && ledger.provider('google').movedTo === 'dropbox' && available.includes('dropbox') && !leaving();
  const quietFocus = element => {
    quiet = true;
    try { element?.focus?.({ preventScroll: true }); } finally { quiet = false; }
  };

  const scheduler = createSyncScheduler({
    idleMs,
    maxWaitMs,
    isEnabled: () => isConnected() && !need,
    isBusy: () => busy || working,
    hasDirty: () => ledger.hasDirty(),
    sync: options => runSync({ ...options, interactive: false }),
    now: () => now().getTime()
  });

  /** Google's sign-in, loaded ahead of a tap that may need it; once at a time, and not again offline after a failure. */
  function loadGoogle() {
    if (googleLoadFailed || !providers.google?.prepare || !available.includes('google')) return;
    providers.google.prepare().catch(() => { googleLoadFailed = true; });
  }

  /** Settings opened, or the header alert drawn, while Google Drive is connected: its sign-in ready for Reconnect. */
  function prepare() {
    if (active() !== 'google' || !isConnected()) return;
    loadGoogle();
  }

  /** The person reaches for Google Drive's Connect (or Reconnect) button, by pointer or keyboard: its sign-in starts loading. */
  function prepareConnect() {
    if (quiet || active() !== 'google') return;
    loadGoogle();
  }

  async function renderRecovery() {
    if (!recovery) return;
    try {
      const [count, latest] = await Promise.all([recoveryStore.count(), recoveryStore.latest()]);
      if (!count || !latest) {
        recovery.textContent = 'Before anything from the cloud is applied, this device keeps a recovery snapshot.';
        return;
      }
      const when = new Date(latest.createdAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      recovery.textContent = `${count} local recovery ${count === 1 ? 'snapshot' : 'snapshots'} kept · latest ${when}`;
    } catch {
      recovery.textContent = 'Local recovery snapshots are unavailable in this browser context.';
    }
  }

  /** What the header alert and the card read: the state of the cloud this device syncs with. */
  function getState() {
    const id = active();
    const cloud = providers[id];
    const saved = ledger.provider(id);
    const connected = !!saved.connected;
    const dirtyCount = connected ? ledger.dirtyEntries().length : 0;
    return {
      configured: true,
      cloud: id,
      clouds: [...available],
      connected,
      busy: busy || connecting || working,
      reconnect: connected && (needsReconnect || !cloud.hasUsableToken()),
      accessUntil: connected ? cloud.accessEndsAt?.() || 0 : 0,
      dirty: dirtyCount > 0,
      dirtyCount,
      lastSyncedAt: saved.lastSyncedAt || '',
      lastError: saved.lastError || '',
      conflicts: conflictCount,
      need: need?.reason || '',
      moved: movedAway() ? 'dropbox' : '',
      error: errorNote
    };
  }

  function viewState(state, cloud = state.cloud) {
    const lastError = state.connected && state.lastError && !AUTOMATIC_ERRORS.has(state.lastError);
    return syncView({
      cloud,
      connected: state.connected,
      connecting,
      busy,
      conflicts: conflictCount,
      reconnect: state.reconnect,
      dirty: state.dirty,
      dirtyCount: state.dirtyCount,
      need,
      mode,
      copy: copyFormat,
      sealed: !!guard.current(),
      offerDismissed: guard.offerDismissed(),
      lastSyncedAt: state.lastSyncedAt,
      error: errorNote || !!lastError,
      info: infoNote,
      note: shownNote,
      accessUntil: state.accessUntil,
      available,
      now: now()
    });
  }

  /** The passphrase forms: drawn again only when their kind changes, so what is typed stays. */
  function renderPanel(kind) {
    if (!panel) return;
    const key = kind ? `${kind}:${need?.reason || ''}` : '';
    if (key !== panelKind) {
      panelKind = key;
      const focused = root.contains(documentRef?.activeElement) || documentRef?.activeElement === documentRef?.body;
      panel.innerHTML = kind ? panelMarkup(kind, { cloud: active(), reason: need?.reason }) : '';
      panel.hidden = !kind;
      const strength = qs('[data-personal-sync-strength]', panel);
      if (strength) strength.innerHTML = strengthMarkup(passphraseStrength(''));
      if (kind && focused) quietFocus(qs('[data-personal-sync-input], [data-personal-sync-offer-accept]', panel));
    }
    qsa('input, button', panel).forEach(control => { control.disabled = busy || working; });
  }

  /** Google's access runs out: drawn again then (the header alert too), Settings open or not. */
  function watchExpiry(until) {
    if (until === expiryAt) return;
    if (expiryTimer != null) timers.clear(expiryTimer);
    expiryTimer = null;
    expiryAt = until;
    if (!until) return;
    const wait = Math.min(LONGEST_WAIT, Math.max(1000, until - now().getTime() + 250));
    expiryTimer = timers.set(() => { expiryTimer = null; expiryAt = 0; render(); }, wait);
  }

  function renderPrimary(view) {
    if (!primary) return;
    primary.hidden = !view.primary;
    const key = `${view.primaryIcon}|${view.primary}`;
    if (primary.dataset.label !== key) {
      primary.dataset.label = key;
      primary.innerHTML = `${view.primaryIcon === 'reconnect' ? RECONNECT_ICON : ''}<span>${esc(view.primary || '')}</span>`;
    }
    primary.disabled = busy || connecting || working;
    primary.classList.toggle('primary-button', view.primaryStyle === 'primary');
    primary.classList.toggle('secondary-button', view.primaryStyle !== 'primary');
  }

  function renderChoice(id, showChoice) {
    if (!choice) return;
    choice.hidden = !showChoice;
    qsa('[data-personal-sync-cloud]', choice).forEach(input => {
      const offered = available.includes(input.value);
      const option = input.closest('label');
      if (option) option.hidden = !offered;
      input.checked = input.value === id;
      input.disabled = busy || connecting;
    });
    if (choiceConnect) {
      choiceConnect.textContent = `Connect ${cloudName(id)}`;
      choiceConnect.disabled = busy || connecting;
    }
    if (choiceNote) {
      choiceNote.textContent = shownNote || CHOICE_NOTE;
      choiceNote.classList.toggle('is-note', !!shownNote);
    }
  }

  function renderRows(view) {
    if (access) {
      access.hidden = !view.access;
      if (view.access) {
        const html = `Google access until <strong>${esc(view.access.until)}</strong> · then a tap reconnects`;
        if (accessText && accessText.innerHTML !== html) accessText.innerHTML = html;
        meter?.style?.setProperty('--share', String(view.access.share));
      }
    }
    if (folder) {
      folder.hidden = !view.folder;
      if (folderText) folderText.textContent = view.folder;
    }
    if (tradeOff) tradeOff.hidden = !(view.tradeOff && available.length === 1);
    const moved = movedAway() && !need && !busy && !connecting;
    if (movedBox) {
      movedBox.hidden = !moved;
      if (movedGo) movedGo.disabled = busy || connecting || working;
    }
    if (switchBox) {
      const offered = !!view.switchTo && available.includes(view.switchTo) && !busy && !moved;
      if (!offered) switching = false;
      switchBox.hidden = !offered;
      if (switchConfirm) switchConfirm.hidden = !switching;
      switchOpen?.setAttribute('aria-expanded', String(switching));
    }
    if (blockedLine) blockedLine.hidden = !dropboxBlocked;
  }

  function render() {
    const state = getState();
    const id = connecting && connectingTo ? connectingTo : state.cloud;
    const connected = state.connected;
    const view = viewState(state, id);
    const showChoice = !connected && !connecting && available.length > 1;
    root.dataset.syncState = view.state;
    root.dataset.syncCloud = id;
    if (lead) lead.textContent = syncLead(available, { cloud: id, connected, sealed: !!guard.current() && copyFormat !== 'plain' });
    renderChoice(id, showChoice);
    if (card) {
      card.hidden = showChoice;
      card.dataset.tone = view.tone;
      card.dataset.layout = view.layout;
    }
    if (mark && mark.getAttribute('src') !== MARKS[id]) mark.setAttribute('src', MARKS[id]);
    if (dot) {
      dot.hidden = !view.dot;
      dot.dataset.tone = view.dot;
    }
    if (status) status.textContent = view.status;
    if (detail) detail.textContent = view.detail;
    renderPrimary(view);
    if (disconnect) disconnect.hidden = !connected || busy || connecting;
    renderRows(view);
    if (sealLine) {
      const html = connected && !need && !busy && view.panel !== 'change'
        ? sealLineMarkup({ cloud: id, copy: copyFormat, sealed: !!guard.current(), memoryOnly: guard.keptInMemoryOnly(), offerShown: view.panel === 'offer' || view.panel === 'protect' })
        : '';
      if (sealLine.innerHTML !== html) sealLine.innerHTML = html;
      sealLine.hidden = !html;
      sealLine.classList.toggle('is-sealed', html.includes('data-personal-sync-change'));
    }
    if (conflictCopy) conflictCopy.textContent = conflictCount ? `Review ${conflictCount} ${conflictCount === 1 ? 'conflict' : 'conflicts'}` : '';
    if (useRemote) useRemote.textContent = `Use ${cloudName(id)}`;
    if (conflictActions) conflictActions.hidden = !conflictCount || busy || view.state === 'reconnect' || view.state === 'ended';
    renderPanel(view.panel);
    renderRecovery();
    watchExpiry(view.access ? state.accessUntil : 0);
    listeners.forEach(listener => { try { listener(state); } catch {} });
  }

  /**
   * The merge, once more if Dropbox refuses a stale revision (another device wrote meanwhile). The planner is
   * drawn again whenever any attempt applied records from the copy, the first one included: the engine applies
   * them before it writes, and agrees on them in the ledger, so the second attempt never takes them for changes.
   */
  async function runEngineSync(conflictResolution = null) {
    let applied = false;
    const once = async () => {
      try {
        const result = await engine.sync(transport(), { buildBackup, conflictResolution });
        if (result?.pulled?.length) applied = true;
        return result;
      } catch (error) {
        if (error?.pulled?.length) applied = true;
        throw error;
      }
    };
    try {
      try {
        return await once();
      } catch (error) {
        if (error instanceof SyncRemoteChangedError || error?.code === 'remote-changed') return await once();
        throw error;
      }
    } finally {
      if (applied) {
        try { await reloadFromStorage?.(); } catch {}
      }
    }
  }

  async function runSync({ interactive = false, conflictResolution = null, reason = 'manual' } = {}) {
    if (busy || connecting) return null;
    const id = active();
    const cloud = providers[id];
    if (!ledger.provider(id).connected) return null;
    // Only explicit UI gestures pass interactive:true. Scheduler events always pass false.
    const automatic = !interactive;
    const force = interactive || conflictResolution || ['startup', 'visible', 'focus', 'online', 'manual', 'close-day', 'hidden', 'reconnect', 'connect'].includes(reason);
    if (!force && !ledger.hasDirty()) return null;

    // Automatic paths never escalate into a sign-in.
    if (automatic && !cloud.hasUsableToken()) {
      needsReconnect = true;
      ledger.saveProvider({ lastError: 'auth-required' }, id);
      render();
      return null;
    }

    // Connect / Reconnect only: Google's window, asked for now, inside the tap, before anything is awaited
    // (a window opened later is blocked). Sync now with a usable token skips it entirely.
    const signingIn = !automatic && cloud.signIn === 'popup' && (!cloud.hasUsableToken() || reason === 'reconnect' || reason === 'connect');
    const authorizing = signingIn ? cloud.authorizeInteractive() : null;
    authorizing?.catch(() => {});

    busy = true;
    conflictCount = 0;
    lastErrorMessage = '';
    errorNote = '';
    infoNote = '';
    render();
    let finished = false;
    try {
      await ready;
      await flushLocal?.();

      if (authorizing) {
        await authorizing;
        needsReconnect = false;
        googleLoadFailed = false;
        // The account, for login_hint next time: Google's window then opens and closes by itself.
        cloud.rememberAccount?.();
      }

      const result = await runEngineSync(conflictResolution);
      copyFormat = transport().format;
      need = null;
      // The copy in Drive says where the planner went (Switch to Dropbox on another device), or nothing.
      if (id === 'google') ledger.saveProvider({ movedTo: result.movedTo || '' }, id);
      if (result.status === 'conflict') {
        conflictCount = result.conflicts.length;
        ledger.saveProvider({ connected: true, lastError: 'conflict' }, id);
      } else {
        ledger.saveProvider({ connected: true, lastSyncedAt: now().toISOString(), lastError: '' }, id);
        if (!ledger.hasDirty()) scheduler.markClean();
        finished = id === 'dropbox' && !!leaving();
      }
      needsReconnect = false;
      return result;
    } catch (error) {
      if (error instanceof SyncPassphraseNeededError || error?.code === 'passphrase') {
        need = { reason: error.reason, envelope: error.envelope || null };
        copyFormat = error.reason === 'create' ? copyFormat : 'sealed';
        ledger.saveProvider({ lastError: 'passphrase' }, id);
        needsReconnect = false;
        return null;
      }
      const authRequired = error?.code === 'auth-required';
      lastErrorMessage = String(error?.message || error || '');
      if (authRequired) {
        needsReconnect = true;
        ledger.saveProvider({ lastError: 'auth-required' }, id);
      } else {
        ledger.saveProvider({ lastError: lastErrorMessage || 'error' }, id);
        // Said in full after a gesture, and always for a copy that can't be read.
        if (!automatic || error?.code === 'sealed-copy') errorNote = lastErrorMessage || 'Sync could not be completed.';
      }
      return null;
    } finally {
      // Switch to Dropbox: its first sync has run, so the cloud left behind gets its marker, then goes.
      if (finished) await finishSwitch().catch(() => {});
      busy = false;
      render();
    }
  }

  /** Before a sync with another cloud than the last one: what was agreed on with that copy says nothing about this one. */
  function switchTo(id, { keepPrevious = false } = {}) {
    const previous = ledger.cloud();
    if (previous !== id) {
      if (ledger.provider(previous).lastSyncedAt) ledger.resetBases();
      if (ledger.provider(previous).connected && !keepPrevious) {
        providers[previous]?.clearToken?.();
        ledger.saveProvider({ connected: false, lastError: '' }, previous);
      }
      ledger.setCloud(id);
    }
    selected = id;
    copyFormat = 'none';
    need = null;
    mode = '';
  }

  async function connect(id) {
    shownNote = '';
    errorNote = '';
    const cloud = providers[id];
    if (cloud.signIn === 'redirect') {
      // Dropbox's own page, then back here (load() finishes it). Everything is saved before leaving.
      connecting = true;
      connectingTo = id;
      render();
      try {
        await flushLocal?.();
        const url = await cloud.beginAuthorization();
        locationRef?.assign?.(url);
      } catch (error) {
        connecting = false;
        connectingTo = '';
        const note = String(error?.message || 'Dropbox could not be opened. Try again.');
        if (isConnected()) infoNote = note;
        else shownNote = note;
        ledger.saveProvider({ switchingFrom: '' }, 'dropbox');
        render();
      }
      return;
    }
    switchTo(id);
    ledger.saveProvider({ connected: true }, id);
    await runSync({ interactive: true, reason: 'connect' });
    // Google's window closed or refused: not connected after all, and why.
    if (!cloud.hasUsableToken() && !need) {
      ledger.saveProvider({ connected: false, lastError: '' }, id);
      shownNote = errorNote || `${cloudName(id)} wasn’t connected. Try again when you’re ready.`;
      errorNote = '';
      needsReconnect = false;
      render();
    }
  }

  /** The main button, and the header alert's “Reconnect and save”: Connect, Reconnect, or Sync now. */
  function primaryAction() {
    const id = active();
    const cloud = providers[id];
    if (!isConnected()) return connect(id);
    if (cloud.signIn === 'redirect' && !cloud.hasUsableToken()) return connect(id);
    if (needsReconnect || !cloud.hasUsableToken()) return runSync({ interactive: true, reason: 'reconnect' });
    // Sync now with a usable token never opens a sign-in.
    return runSync({ interactive: true, reason: 'manual' });
  }

  /**
   * Switch to Dropbox (offered while Google's access ended with changes waiting, and on a device still on Drive
   * once the planner moved): Dropbox's sign-in starts, and Google Drive stays connected here until it has
   * completed and Dropbox has synced once (finishSwitch()). Come back without access: still on Google Drive,
   * with why. The key stays, so the copy in Dropbox is sealed with the same passphrase, and the other devices
   * open it without asking once they switch too.
   */
  async function switchToDropbox() {
    if (busy || connecting || !available.includes('dropbox')) return;
    const from = active();
    if (from === 'dropbox') return;
    switching = false;
    infoNote = '';
    ledger.saveProvider({ switchingFrom: isConnected() ? from : '' }, 'dropbox');
    await connect('dropbox');
  }

  /**
   * Dropbox has synced once after a Switch: if Google's access is still usable, the Drive copy is merged once more
   * with the bases agreed on with it (what this device adds goes in; what another device wrote there stays; nothing
   * comes back into the planner here), with `movedTo: 'dropbox'`. Google is then disconnected on this device.
   * Google's access ended: no marker, and the Switch's own words stand (the other devices switch by hand).
   */
  async function finishSwitch() {
    const from = leaving();
    if (!from) return;
    let marked = false;
    const left = providers[from];
    if (leavingBases && left?.hasUsableToken?.() && transports[from]) {
      try {
        const scratch = createScratchLedger(leavingBases, { now });
        const result = await createSyncEngine({ store, ledger: scratch, now }).sync(transports[from], { conflictResolution: 'remote', applyPulls: false, movedTo: 'dropbox' });
        marked = result?.status === 'ok';
      } catch {
        marked = false;
      }
    }
    leavingBases = null;
    left?.clearToken?.();
    ledger.saveProvider({ connected: false, lastError: '', movedTo: '' }, from);
    ledger.saveProvider({ switchingFrom: '' }, 'dropbox');
    infoNote = marked
      ? `Your planner moved to Dropbox. Your other devices offer to switch at their next sync with ${cloudName(from)}.`
      : `Your planner moved to Dropbox. Your other devices keep using ${cloudName(from)} until you switch them too.`;
  }

  /** Dropbox's answer in the address: taken out of it at once, and whether it belongs to the sign-in started here. */
  function takeOAuthReturn() {
    const answer = stripOAuthReturn();
    if (!answer) return null;
    const dropbox = providers.dropbox;
    if (!dropbox?.configured || !available.includes('dropbox')) return null;
    return { ...answer, owned: dropbox.ownsReturn(answer) };
  }

  async function finishDropboxReturn(answer) {
    const from = leaving();
    // Back on an answer no sign-in here waits for, with Dropbox connected already (a page opened again): nothing to say.
    if (!answer.owned && ledger.provider('dropbox').connected && !from) return;
    connecting = true;
    connectingTo = 'dropbox';
    if (!from) selected = 'dropbox';
    render();
    // An answer with no sign-in waiting here (another browser's, an old tab, a reload): said, never ignored.
    const result = answer.owned
      ? await providers.dropbox.completeAuthorization(answer).catch(() => ({ ok: false, reason: 'failed' }))
      : { ok: false, reason: 'stale' };
    connecting = false;
    connectingTo = '';
    if (result.ok) {
      if (from) leavingBases = ledger.snapshot();
      // Switching: the cloud left stays connected until Dropbox has synced once.
      switchTo('dropbox', { keepPrevious: !!from });
      ledger.saveProvider({ connected: true, lastError: '' }, 'dropbox');
    } else {
      ledger.saveProvider({ switchingFrom: '' }, 'dropbox');
      const note = returnNote(result.reason, from);
      if (isConnected()) infoNote = note;
      else shownNote = note;
    }
    render();
    whenShown(() => openSettings());
    if (result.ok) await runSync({ interactive: false, reason: 'connect' });
  }

  function showPanelError(message, target = '[data-personal-sync-input="passphrase"]') {
    const error = qs('[data-personal-sync-error]', panel);
    if (error) {
      error.textContent = message;
      error.hidden = !message;
    }
    qsa('[data-personal-sync-input]', panel).forEach(input => input.setAttribute('aria-invalid', message ? 'true' : 'false'));
    if (message) quietFocus(qs(target, panel));
  }

  function focusAfterPanel() {
    const next = panel && !panel.hidden ? qs('[data-personal-sync-input], [data-personal-sync-offer-accept]', panel) : null;
    const target = [next, qs('[data-personal-sync-change], [data-personal-sync-protect]', sealLine), primary].find(element => element && !element.hidden && element.isConnected);
    quietFocus(target);
  }

  async function submitPassphrase(kind, form) {
    const values = { passphrase: form.elements.passphrase?.value || '', confirm: form.elements.confirm?.value || '' };
    const problem = passphraseProblem(kind, values, passphraseStrength(values.passphrase));
    if (problem) {
      showPanelError(problem, problem.includes('match') ? '[data-personal-sync-input="confirm"]' : '[data-personal-sync-input="passphrase"]');
      return;
    }
    showPanelError('');
    const submit = qs('[data-personal-sync-submit]', form);
    const label = submit?.textContent || '';
    working = true;
    render();
    if (submit) submit.textContent = kind === 'enter' ? 'Unlocking…' : 'Sealing…';
    let done = false;
    try {
      await ready;
      if (kind === 'enter') {
        const envelope = need?.envelope;
        const key = envelope ? await guard.unlockEnvelope(envelope, values.passphrase) : null;
        if (!key) {
          working = false;
          render();
          showPanelError('That passphrase doesn’t open your synced copy. Check it and try again.');
          qs('[data-personal-sync-input="passphrase"]', panel)?.select?.();
          return;
        }
        await guard.adopt({ salt: envelope.salt, iterations: envelope.iterations, check: envelope.check, key });
        need = null;
        mode = '';
        working = false;
        done = true;
        await runSync({ interactive: true, reason: 'manual' });
      } else if (kind === 'create' || kind === 'protect') {
        await guard.adopt(await guard.createSeal(values.passphrase));
        need = null;
        mode = '';
        working = false;
        done = true;
        await runSync({ interactive: true, reason: 'manual' });
      } else if (kind === 'change' || kind === 'forgot') {
        const seal = await guard.createSeal(values.passphrase);
        transport().rekey(seal, { replace: kind === 'forgot' });
        working = false;
        let result = null;
        try {
          result = await runSync({ interactive: true, reason: 'manual', conflictResolution: kind === 'forgot' ? 'local' : null });
        } finally {
          transport().clearRekey();
        }
        if (result?.status === 'ok') {
          await guard.adopt(seal);
          need = null;
          mode = '';
          done = true;
          infoNote = kind === 'forgot' ? 'Your copy now holds this device’s planner, under the new passphrase. Your other devices ask which version to keep wherever they differ.' : 'Passphrase changed. Your other devices ask for the new one once.';
        } else if (!need) {
          render();
          showPanelError(errorNote || (result?.status === 'conflict' ? 'Settle the conflicts first, then change the passphrase.' : 'The passphrase wasn’t changed: sync couldn’t finish. Try again.'));
        }
      }
    } catch (error) {
      working = false;
      render();
      showPanelError(String(error?.message || 'That didn’t work. Try again.'));
    } finally {
      working = false;
      if (submit?.isConnected && !done) submit.textContent = label;
      render();
      if (done) focusAfterPanel();
    }
  }

  // ---- Events ----------------------------------------------------------------------------

  // Not awaited before Google's window: primaryAction() reaches requestAccessToken within this tap.
  primary?.addEventListener('click', () => { primaryAction(); });
  choiceConnect?.addEventListener('click', () => { if (!isConnected()) connect(active()); });
  // Reaching for Connect Google Drive (a pointer pressed, or focus from the keyboard) is intent: its sign-in starts loading.
  [primary, choiceConnect].forEach(button => {
    button?.addEventListener('pointerdown', prepareConnect);
    button?.addEventListener('focusin', prepareConnect);
  });

  disconnect?.addEventListener('click', async () => {
    const id = active();
    // Mid-switch, the cloud being left goes too: Disconnect leaves this device with no cloud.
    const from = leaving();
    [id, from].filter(Boolean).forEach(cloud => {
      providers[cloud]?.clearToken?.();
      ledger.saveProvider({ connected: false, lastError: '', movedTo: '' }, cloud);
    });
    ledger.saveProvider({ switchingFrom: '' }, 'dropbox');
    leavingBases = null;
    conflictCount = 0;
    lastErrorMessage = '';
    errorNote = '';
    infoNote = '';
    needsReconnect = false;
    need = null;
    mode = '';
    copyFormat = 'none';
    switching = false;
    scheduler.clearTimers();
    scheduler.markClean();
    // No cloud left: nothing of the seal stays (the key, its database, daily-planner-sync:protection).
    const remaining = available.filter(cloud => ledger.provider(cloud).connected);
    await guard.forget({ everything: !remaining.length });
    render();
    quietFocus(choice && !choice.hidden ? qs('[data-personal-sync-cloud]:checked', choice) : primary);
  });

  choice?.addEventListener('change', event => {
    const value = event.target?.value;
    if (!available.includes(value) || isConnected()) return;
    selected = value;
    shownNote = '';
    render();
    // Google Drive chosen: its sign-in loads now, so the Connect tap can open its window at once.
    if (value === 'google') loadGoogle();
  });

  switchOpen?.addEventListener('click', () => {
    switching = !switching;
    render();
    if (switching) quietFocus(switchGo);
  });
  switchCancel?.addEventListener('click', () => {
    switching = false;
    render();
    quietFocus(switchOpen);
  });
  // Switch is offered once Google's hour has ended: its access is renewed first, inside this tap (the window closes
  // by itself, the account remembered), so the Drive copy can carry the moved-to-Dropbox marker once Dropbox has
  // synced. A window closed or refused only means no marker: the switch goes on.
  switchGo?.addEventListener('click', () => {
    if (destroyed) return null;
    const left = providers[active()];
    const renewing = active() !== 'dropbox' && isConnected() && left?.signIn === 'popup' && !left.hasUsableToken()
      ? left.authorizeInteractive()
      : null;
    if (!renewing) return switchToDropbox();
    return renewing.catch(() => {}).then(() => switchToDropbox());
  });
  movedGo?.addEventListener('click', () => switchToDropbox());

  panel?.addEventListener('submit', event => {
    const form = event.target.closest?.('[data-personal-sync-form]');
    if (!form) return;
    event.preventDefault();
    if (!busy && !working) submitPassphrase(form.dataset.personalSyncForm, form);
  });

  panel?.addEventListener('input', event => {
    const input = event.target;
    const form = input?.form;
    if (!form || form.dataset.personalSyncForm === 'enter') return;
    if (input.dataset.personalSyncInput !== 'passphrase') return;
    const strength = qs('[data-personal-sync-strength]', form);
    if (!strength) return;
    const value = passphraseStrength(input.value);
    // Drawn again only when it says something new: the line is read out when it changes.
    if (strength.dataset.score !== String(value.score) || strength.dataset.filled !== String(!!input.value)) {
      strength.dataset.score = String(value.score);
      strength.dataset.filled = String(!!input.value);
      strength.innerHTML = strengthMarkup(value);
    }
  });

  panel?.addEventListener('click', event => {
    const target = event.target.closest?.('button');
    if (!target || target.disabled) return;
    if (target.matches('[data-personal-sync-reveal]')) {
      const show = target.getAttribute('aria-pressed') !== 'true';
      target.setAttribute('aria-pressed', String(show));
      target.textContent = show ? 'Hide' : 'Show';
      qsa('[data-personal-sync-input]', target.form || panel).forEach(input => { input.type = show ? 'text' : 'password'; });
      return;
    }
    if (target.matches('[data-personal-sync-cancel]')) {
      mode = '';
      render();
      if (need) quietFocus(qs('[data-personal-sync-input]', panel));
      else focusAfterPanel();
      return;
    }
    if (target.matches('[data-personal-sync-forgot]')) { mode = 'forgot'; render(); return; }
    if (target.matches('[data-personal-sync-offer-later]')) { guard.dismissOffer(); render(); focusAfterPanel(); return; }
    if (target.matches('[data-personal-sync-offer-accept]')) { mode = 'protect'; render(); quietFocus(qs('[data-personal-sync-input]', panel)); }
  });

  sealLine?.addEventListener('click', event => {
    const target = event.target.closest?.('button');
    if (!target || busy) return;
    if (target.matches('[data-personal-sync-change]')) mode = 'change';
    else if (target.matches('[data-personal-sync-protect]')) mode = 'protect';
    else return;
    infoNote = '';
    render();
    quietFocus(qs('[data-personal-sync-input]', panel));
  });

  keepLocal?.addEventListener('click', () => runSync({ interactive: true, conflictResolution: 'local', reason: 'manual' }));
  useRemote?.addEventListener('click', () => runSync({ interactive: true, conflictResolution: 'remote', reason: 'manual' }));

  const onVisibility = () => {
    if (!isConnected()) return;
    if (documentRef?.hidden) scheduler.attempt('hidden');
    else scheduler.attempt('visible');
  };
  const onFocus = () => { if (isConnected()) scheduler.attempt('focus'); };
  const onOnline = () => {
    // Back online: Google's sign-in may load again.
    googleLoadFailed = false;
    if (isConnected()) scheduler.attempt('online');
  };

  if (documentRef) addEventListener(documentRef, 'visibilitychange', onVisibility);
  if (windowRef) {
    addEventListener(windowRef, 'focus', onFocus);
    addEventListener(windowRef, 'online', onOnline);
  }

  // Settings open: the card drawn again every minute (Google's access meter, “2 min ago”); closed, the timer stops.
  const settingsModal = root.closest?.('.modal') || null;
  const followSettings = () => {
    const open = !!settingsModal && !settingsModal.hidden;
    if (open && ticker == null) {
      ticker = timers.every(render, MINUTE);
      render();
      // Once connected, Google's sign-in is ready for Reconnect.
      if (isConnected()) prepare();
    } else if (!open && ticker != null) {
      timers.stop(ticker);
      ticker = null;
      if (switching) { switching = false; render(); }
    }
  };
  if (settingsModal && Observer) {
    settingsWatch = new Observer(followSettings);
    settingsWatch.observe(settingsModal, { attributes: true, attributeFilter: ['hidden'] });
  }

  function noteLocalChange() {
    if (!isConnected()) return;
    scheduler.noteLocalChange();
    render();
  }

  async function load() {
    // Read before anything else runs, so the code never stays in the address.
    const answer = takeOAuthReturn();
    render();
    await ready;
    render();
    if (answer) {
      await finishDropboxReturn(answer);
      return;
    }
    if (!isConnected()) return;
    // Google's sign-in loaded ahead, so a Reconnect (here or in the header alert) opens its window at once.
    prepare();
    // Startup may sync only with access already at hand (Google's token kept from within the hour); it never opens a sign-in.
    await runSync({ interactive: false, reason: 'startup' });
  }

  /** Where focus goes when Settings opens on this section: the passphrase field while one is asked for, the cloud chosen, else the main button. */
  function focus() {
    const field = qs('[data-personal-sync-input], [data-personal-sync-offer-accept]', panel);
    const chosen = choice && !choice.hidden ? qs('[data-personal-sync-cloud]:checked', choice) : null;
    const target = field || chosen || (primary && !primary.hidden ? primary : null) || disconnect;
    quietFocus(target);
  }

  function subscribe(listener) {
    if (typeof listener !== 'function') return () => {};
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  function destroy() {
    destroyed = true;
    scheduler.clearTimers();
    if (expiryTimer != null) timers.clear(expiryTimer);
    if (ticker != null) timers.stop(ticker);
    expiryTimer = null;
    ticker = null;
    settingsWatch?.disconnect?.();
    listeners.clear();
  }

  return {
    load,
    syncNow: runSync,
    noteLocalChange,
    render,
    destroy,
    focus,
    prepare,
    getState,
    subscribe,
    /** The header alert's one tap: Google's window from within it (with nothing awaited first), then the sync. */
    reconnect: () => primaryAction(),
    scheduler,
    get needsReconnect() { return needsReconnect; },
    get need() { return need; },
    /** The clouds this copy of the planner can sync with, in the order offered. */
    get clouds() { return [...available]; },
    get cloud() { return active(); },
    get provider() { return provider(); }
  };
}

export { relativeSyncLabel, conflictSummary };
