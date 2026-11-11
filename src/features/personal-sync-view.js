import { esc, escAttr } from '../lib/text.js';
import { clockTime } from '../domain/schedule-time.js';
import { CLOUDS } from '../sync/cloud.js';
import { PASSPHRASE_MIN_LENGTH } from '../sync/seal.js';

/**
 * What Settings → Personal sync says and shows (1.38), as pure functions of
 * its state, so each state can be tested and the feature
 * (./personal-sync.js) only wires them. Copy: calm, short, sentence case.
 */

export const LOCK_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10.5" width="14" height="9.5" rx="2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/></svg>';
const OPEN_LOCK_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10.5" width="14" height="9.5" rx="2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 6.6-1.6"/></svg>';
const KEY_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="8" cy="14" r="3.6"/><path d="m10.6 11.4 7.9-7.9M15.5 6.5l2.2 2.2M13.4 8.6l1.8 1.8"/></svg>';
/** Reconnect (two arrows round), on “Reconnect and save” here and in the header alert (./sync-status.js). */
export const RECONNECT_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12a8 8 0 0 1-13.7 5.6M4 12a8 8 0 0 1 13.7-5.6"/><path d="M18 3v4h-4M6 21v-4h4"/></svg>';

export const MARKS = Object.freeze({ google: './assets/google-drive.svg', dropbox: './assets/dropbox.svg' });

export function cloudName(id) { return CLOUDS[id]?.name || 'your cloud'; }
/** Its short name, as in “Not in Drive since 14:58”. */
export function cloudShort(id) { return id === 'google' ? 'Drive' : cloudName(id); }

/**
 * The section's lead. Not connected: from the clouds this copy of the planner can use (“your own cloud” when
 * the choice cards name them). Connected: the one it syncs with, and the seal when there is one.
 */
export function syncLead(available, { cloud = '', connected = false, sealed = true } = {}) {
  if (connected) return `Your devices stay in step through your ${cloudName(cloud)}.${sealed ? ' The copy there is sealed with your passphrase.' : ''}`;
  const where = available.length === 1 ? cloudName(available[0]) : 'cloud';
  return `Keep your devices in step through your own ${where}. Your planner stays on this device; the cloud carries one copy, sealed with a passphrase only you know.`;
}

/** Google's trade-off in one line, under its card when it is the only cloud offered (the choice cards say it otherwise). */
export const GOOGLE_TRADE_OFF = 'Google ends access after an hour; changes wait here until you tap Reconnect.';

/** In place of Dropbox, when this browser keeps no site data: its sign-in and its access can't wait on this device. */
export const DROPBOX_BLOCKED_LINE = 'Dropbox needs this browser to keep site data.';

/**
 * Help → Data on this device: the clouds this copy of the planner offers, by name ('' when it offers none,
 * and the line is hidden).
 */
export function storageSyncLine(clouds = []) {
  const offered = ['dropbox', 'google'].filter(id => clouds.includes(id));
  if (!offered.length) return '';
  const where = offered.map(cloudName).join(' or ');
  const how = offered.map(id => (id === 'dropbox' ? 'Dropbox stays connected and saves on its own' : 'Google Drive asks for a tap every hour')).join('; ');
  return `Optional Personal sync keeps a sealed copy in your own ${where}; local recovery snapshots stay on this device. ${how}.`;
}

/**
 * The card's line after a sync whose changes from the copy this browser refused to store (its storage full,
 * 1.39.3): they stay in the copy, and the next sync fetches them again.
 */
export function refusedNote(count) {
  const n = Math.max(1, Number(count) || 1);
  return `This browser is out of space for your planner: ${n} ${n === 1 ? 'change' : 'changes'} from your other devices couldn’t be stored here. ${n === 1 ? 'It stays' : 'They stay'} in your synced copy, and the next sync fetches ${n === 1 ? 'it' : 'them'} again.`;
}

/** The planner's own time format (the schedule's: 14:58). */
const plannerClock = date => clockTime(date.getHours() * 60 + date.getMinutes());

/** When the copy was last saved, for “since …”: “14:58” today, “yesterday, 14:58”, else a short date. '' when never. */
export function sinceLabel(iso, now = new Date(), { clock = plannerClock, locale } = {}) {
  const then = iso ? new Date(iso) : null;
  if (!then || Number.isNaN(then.getTime())) return '';
  const day = date => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  const days = Math.round((day(now) - day(then)) / 86_400_000);
  if (days <= 0) return clock(then);
  if (days === 1) return `yesterday, ${clock(then)}`;
  return then.toLocaleDateString(locale, then.getFullYear() === now.getFullYear() ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' });
}

/** “Last saved just now”, “… 2 min ago”, “… at 14:58”, “… yesterday, 14:58”, “… Nov 8”. */
export function savedLabel(iso, now = new Date(), options = {}) {
  const since = sinceLabel(iso, now, options);
  if (!since) return 'Not saved yet';
  const minutes = Math.floor(Math.max(0, now - new Date(iso)) / 60_000);
  if (minutes < 1) return 'Last saved just now';
  if (minutes < 60) return `Last saved ${minutes} min ago`;
  return /^\d/.test(since) ? `Last saved at ${since}` : `Last saved ${since}`;
}

/** “1 change”, “3 changes”; '' when the count isn't known. */
const changes = count => (Number.isInteger(count) && count > 0 ? `${count} ${count === 1 ? 'change' : 'changes'}` : '');

/** Why a tap is needed again, and that it sends what waits. */
const ENDED = Object.freeze({
  google: 'Google ended access after an hour; one tap sends them.',
  dropbox: 'Dropbox asked to be connected again; one tap sends them.'
});

/** “3 changes made since then are safe on this device.” (singular, plural, or without a number). */
export function waitingLine(count, { since = true } = {}) {
  const what = changes(count);
  const verb = count === 1 ? 'is' : 'are';
  if (!what) return since ? 'Changes made since then are safe on this device.' : 'Your changes are safe on this device.';
  return since ? `${what[0].toUpperCase()}${what.slice(1)} made since then ${verb} safe on this device.` : `${what[0].toUpperCase()}${what.slice(1)} ${verb} safe on this device.`;
}

const relativeTime = (iso, now) => {
  if (!iso) return 'Not synced yet';
  const then = new Date(iso);
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 10) return 'Last synced just now';
  if (seconds < 60) return `Last synced ${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `Last synced ${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `Last synced ${hours}h ago`;
  return `Last synced ${then.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
};
export { relativeTime as relativeSyncLabel };

export function conflictSummary(count) {
  if (count <= 0) return '';
  if (count === 1) return 'Some days were edited on both devices.';
  return `${count} items were edited on both devices.`;
}

/**
 * The card's state:
 *
 *   state         'disconnected', 'syncing', 'passphrase', 'attention' (conflicts), 'reconnect' (access ended,
 *                 changes waiting), 'ended' (access ended, nothing waiting), 'pending', 'synced'
 *   tone          'wait' (ochre: something waits on the person) or 'neutral'
 *   dot           on the cloud's mark: 'ok' (green: saved), 'wait' (ochre) or '' (none)
 *   layout        'row' (the actions beside the text) or 'stacked' (under it: a longer title)
 *   status, detail, primary (label, or '' when hidden), primaryStyle ('primary' | 'secondary'), primaryIcon
 *   panel         the passphrase form or offer open in the card ('' for none)
 *   access        Google's access while it lasts: { until: '16:12', share } (share: of the hour, 0 to 1), or null
 *   folder        where the copy is, when the person can see it (Dropbox)
 *   switchTo      the cloud offered instead ('dropbox' when Google's access ended with changes waiting), or ''
 *   tradeOff      the cloud's trade-off in one line, for its card alone ('' when none)
 *
 * `need`: the passphrase the copy waits for ({ reason: 'create' | 'enter' | 'changed' }), `copy`: what the last
 * sync found ('none', 'plain', 'sealed'), `sealed`: this device holds the key, `accessUntil`: when Google's
 * token runs out (ms), `dirtyCount`: the records changed since the last sync (null: not known), `available`:
 * the clouds this planner offers, `clock`: the planner's time format.
 */
export function syncView({
  cloud = 'google', connected = false, busy = false, conflicts = 0, reconnect = false, dirty = false, dirtyCount = null,
  need = null, mode = '', copy = 'none', sealed = false, offerDismissed = false, lastSyncedAt = '', error = '', info = '', note = '', connecting = false,
  accessUntil = 0, available = [], now = new Date(), clock = plannerClock
} = {}) {
  const name = cloudName(cloud);
  const base = { tone: 'neutral', dot: '', layout: 'row', primaryIcon: '', panel: '', access: null, folder: '', switchTo: '', tradeOff: '' };
  if (connecting) return { ...base, state: 'syncing', status: 'Connecting…', detail: `Finishing the connection to ${name}…`, primary: 'Connecting…', primaryStyle: 'primary' };
  if (!connected) {
    return { ...base, state: 'disconnected', status: 'Not connected', detail: note || 'Your planner stays on this device until you connect it.', primary: `Connect ${name}`, primaryStyle: 'primary', tradeOff: cloud === 'google' ? GOOGLE_TRADE_OFF : '' };
  }
  const live = cloud === 'google' && !reconnect && accessUntil > now.getTime();
  const access = live ? { until: clock(new Date(accessUntil)), share: Math.round(Math.min(1, Math.max(0, (accessUntil - now.getTime()) / 3_600_000)) * 1000) / 1000 } : null;
  const folder = cloud === 'dropbox' && CLOUDS.dropbox.folder ? `In ${CLOUDS.dropbox.folder}` : '';
  if (busy) {
    return { ...base, state: 'syncing', dot: 'wait', status: mode === 'change' ? 'Sealing your copy…' : `Saving to ${name}…`, detail: mode === 'change' ? 'Sealing your copy under the new passphrase…' : 'Your planner keeps working meanwhile.', primary: 'Saving…', primaryStyle: 'secondary', panel: mode && mode !== 'offer' ? mode : need ? (need.reason === 'create' ? 'create' : mode === 'forgot' ? 'forgot' : 'enter') : '', access, folder };
  }
  if (need?.reason === 'create') {
    return { ...base, state: 'passphrase', dot: 'wait', status: 'Choose a passphrase', detail: `Connected to ${name}. One step left: a passphrase seals your copy before anything is sent.`, primary: '', primaryStyle: 'primary', panel: 'create' };
  }
  if (need && mode === 'forgot') {
    return { ...base, state: 'passphrase', dot: 'wait', status: 'Start over from this device', detail: 'For when no device remembers the passphrase: the copy can’t be opened without it, so it is replaced.', primary: '', primaryStyle: 'primary', panel: 'forgot' };
  }
  if (need) {
    const changed = need.reason === 'changed';
    return {
      ...base,
      state: 'passphrase',
      dot: 'wait',
      status: changed ? 'The passphrase was changed' : 'Your synced copy is sealed',
      detail: changed ? 'It was changed on another device. Enter the new one to keep syncing here.' : 'Enter the passphrase you chose on your other device. This device remembers it.',
      primary: '',
      primaryStyle: 'primary',
      panel: 'enter'
    };
  }
  const offer = copy === 'plain' && !sealed;
  const panel = mode === 'change' && sealed ? 'change' : offer && mode === 'protect' ? 'protect' : offer && !offerDismissed ? 'offer' : '';
  // A passphrase form open below: its submit is the one main button.
  const formOpen = panel === 'change' || panel === 'protect';
  const since = sinceLabel(lastSyncedAt, now, { clock });
  if (conflicts) {
    return { ...base, state: 'attention', tone: 'wait', dot: 'wait', layout: 'stacked', status: 'Sync needs attention', detail: conflictSummary(conflicts), primary: formOpen ? '' : reconnect ? `Reconnect ${name}` : 'Sync now', primaryStyle: 'secondary', panel, folder };
  }
  if (reconnect && dirty) {
    // Access ended with changes waiting: what isn't saved, since when, and the one tap that sends it.
    return {
      ...base,
      state: 'reconnect',
      tone: 'wait',
      dot: 'wait',
      layout: 'stacked',
      status: since ? `Not saved to ${name} since ${since}` : `Not saved to ${name} yet`,
      // After a tap that didn't finish (Google's window closed or blocked), why, in place of the hour's reason.
      detail: `${waitingLine(dirtyCount, { since: !!since })} ${(typeof error === 'string' && error) || info || ENDED[cloud] || ENDED.google}`,
      primary: formOpen ? '' : 'Reconnect and save',
      primaryStyle: 'primary',
      primaryIcon: 'reconnect',
      panel,
      folder,
      switchTo: cloud === 'google' && available.includes('dropbox') ? 'dropbox' : ''
    };
  }
  if (reconnect) {
    return {
      ...base,
      state: 'ended',
      dot: since ? 'ok' : '',
      status: since ? `Up to date as of ${since}` : `Connected to ${name}`,
      detail: (typeof error === 'string' && error) || info || `${CLOUDS[cloud]?.company || 'Cloud'} access ended. Reconnect to check for changes from your other devices.`,
      primary: formOpen ? '' : 'Reconnect',
      primaryStyle: 'secondary',
      panel,
      folder
    };
  }
  let detail;
  if (error) detail = typeof error === 'string' ? error : `${savedLabel(lastSyncedAt, now, { clock })}. The last sync didn’t finish; your planner keeps working here.`;
  else if (info) detail = info;
  else if (dirty) detail = 'Changes waiting to sync';
  else if (lastSyncedAt) detail = `${savedLabel(lastSyncedAt, now, { clock })} · ${cloud === 'dropbox' ? 'stays connected on this device' : 'nothing waiting'}`;
  else detail = 'Not saved yet';
  return {
    ...base,
    state: dirty ? 'pending' : 'synced',
    dot: error || dirty || !lastSyncedAt ? 'wait' : 'ok',
    status: error ? `Not saved to ${name}` : lastSyncedAt ? `Saved to ${name}` : `Connected to ${name}`,
    detail,
    primary: formOpen ? '' : 'Sync now',
    primaryStyle: 'secondary',
    panel,
    access,
    folder
  };
}

/** The line under the card when connected: sealed (with Change passphrase), or not sealed yet (with Seal it). '' when there is nothing to say. */
export function sealLineMarkup({ cloud = 'google', copy = 'none', sealed = false, memoryOnly = false, offerShown = false } = {}) {
  if (sealed && copy !== 'plain') {
    const memory = memoryOnly ? ' This browser can’t keep the key, so you’ll be asked again next time.' : '';
    return `<span class="personal-sync-seal__icon">${LOCK_ICON}</span><span><strong>Sealed with your passphrase.</strong> ${esc(CLOUDS[cloud]?.company || 'Your cloud')} sees one file it can’t read.${esc(memory)}</span><button class="text-button" type="button" data-personal-sync-change>Change passphrase</button>`;
  }
  if (copy === 'plain' && !offerShown) {
    return `<span class="personal-sync-seal__icon personal-sync-seal__icon--open">${OPEN_LOCK_ICON}</span><span><strong>Not sealed.</strong> Your copy in ${esc(cloudName(cloud))} can be read by anyone with access to it.</span><button class="text-button" type="button" data-personal-sync-protect>Seal it</button>`;
  }
  return '';
}

/** The strength line under a new passphrase. */
export function strengthMarkup(strength) {
  const label = strength.label ? `<strong>${esc(strength.label)}</strong> ` : '';
  return `<span class="personal-sync-strength__bar" aria-hidden="true"><i></i><i></i><i></i><i></i></span><small>${label}${esc(strength.hint)}</small>`;
}

const field = ({ name, label, autocomplete, describedBy = '' }) => `<label class="form-field personal-sync-field"><span>${esc(label)}</span><input type="password" name="${name}" autocomplete="${autocomplete}" autocapitalize="off" autocorrect="off" spellcheck="false" required${describedBy ? ` aria-describedby="${escAttr(describedBy)}"` : ''} data-personal-sync-input="${name}"></label>`;

/**
 * The panel inside the card, by kind: 'create' (a new copy), 'protect' (sealing a plain copy),
 * 'change', 'forgot' (start over under a new passphrase), 'enter' (another device's copy),
 * 'offer' (the one-time offer to seal a plain copy). Values typed are kept by the feature, which
 * draws a panel again only when its kind changes.
 */
export function panelMarkup(kind, { cloud = 'google', reason = 'enter' } = {}) {
  const name = cloudName(cloud);
  const company = CLOUDS[cloud]?.company || 'Your cloud';
  if (kind === 'offer') {
    return `<div class="personal-sync-offer" data-personal-sync-offer>
      <span class="personal-sync-offer__icon">${LOCK_ICON}</span>
      <div><strong>Seal your synced copy</strong><p>Your copy in ${esc(name)} was made before sealing existed, so it can be read by anyone with access to your ${esc(name)}. Choose a passphrase and it’s sealed on this device before it leaves. Nothing else changes.</p></div>
      <div class="personal-sync-form__actions"><button class="text-button" type="button" data-personal-sync-offer-later>Not now</button><button class="secondary-button" type="button" data-personal-sync-offer-accept>Choose a passphrase</button></div>
    </div>`;
  }
  if (kind === 'enter') {
    const changed = reason === 'changed';
    return `<form class="personal-sync-form" data-personal-sync-form="enter" novalidate>
      <p class="personal-sync-form__lead">${changed ? 'Type the new passphrase once. It opens your copy here from now on.' : `Type it once. It opens your copy here from now on, and never leaves this device.`}</p>
      <div class="personal-sync-form__row">${field({ name: 'passphrase', label: 'Passphrase', autocomplete: 'current-password', describedBy: 'personal-sync-error' })}<button class="text-button personal-sync-reveal" type="button" data-personal-sync-reveal aria-pressed="false">Show</button></div>
      <p class="personal-sync-error" id="personal-sync-error" data-personal-sync-error role="alert" hidden></p>
      <div class="personal-sync-form__actions"><button class="text-button" type="button" data-personal-sync-forgot>Forgot it?</button><button class="primary-button" type="submit" data-personal-sync-submit>Unlock and sync</button></div>
    </form>`;
  }
  const copy = {
    create: { lead: `It seals your copy on this device before it goes to ${esc(name)}. On your other devices, you type it once.`, submit: 'Seal and sync', cancel: '' },
    protect: { lead: `It seals your copy on this device. Your other devices ask for it once, at their next sync.`, submit: 'Seal my copy', cancel: 'Cancel' },
    change: { lead: 'Your copy is sealed again under the new one. Your other devices ask for it once.', submit: 'Change passphrase', cancel: 'Cancel' },
    forgot: { lead: `Start over from this device: the copy in ${esc(name)} is replaced by this device’s planner, sealed with a new passphrase. Your other devices ask for the new one once. Then what only they have comes back, and wherever they differ from this device, they ask which version to keep.`, submit: 'Replace the synced copy', cancel: 'Back' }
  }[kind] || {};
  return `<form class="personal-sync-form" data-personal-sync-form="${escAttr(kind)}" novalidate>
      <p class="personal-sync-form__lead">${copy.lead}</p>
      <div class="personal-sync-form__row">${field({ name: 'passphrase', label: kind === 'change' || kind === 'forgot' ? 'New passphrase' : 'Passphrase', autocomplete: 'new-password', describedBy: 'personal-sync-strength' })}<button class="text-button personal-sync-reveal" type="button" data-personal-sync-reveal aria-pressed="false">Show</button></div>
      <div class="personal-sync-strength" id="personal-sync-strength" data-personal-sync-strength data-score="0" aria-live="polite"></div>
      ${field({ name: 'confirm', label: 'Type it again', autocomplete: 'new-password', describedBy: 'personal-sync-error' })}
      <p class="personal-sync-note">${KEY_ICON}<span>Only you know it: it never leaves this device, and ${esc(company === 'Your cloud' ? 'nobody' : `neither we nor ${company}`)} can recover it. Your planner here and your backups don’t depend on it.</span></p>
      <p class="personal-sync-error" id="personal-sync-error" data-personal-sync-error role="alert" hidden></p>
      <div class="personal-sync-form__actions">${copy.cancel ? `<button class="text-button" type="button" data-personal-sync-cancel>${esc(copy.cancel)}</button>` : ''}<button class="${kind === 'forgot' ? 'primary-button primary-button--danger' : 'primary-button'}" type="submit" data-personal-sync-submit>${esc(copy.submit)}</button></div>
    </form>`;
}

/** What a passphrase form says before anything runs: '' when it may go ahead. */
export function passphraseProblem(kind, { passphrase = '', confirm = '' } = {}, strength) {
  if (kind === 'enter') return passphrase ? '' : 'Type the passphrase of your synced copy.';
  if (!passphrase) return `Choose a passphrase of at least ${PASSPHRASE_MIN_LENGTH} characters.`;
  if (!strength.ok) return strength.score === 0 ? `Use at least ${PASSPHRASE_MIN_LENGTH} characters.` : 'That one is easy to guess. Try a few unrelated words.';
  if (passphrase !== confirm) return 'The two passphrases don’t match.';
  return '';
}

/**
 * What the planner says when the browser comes back from Dropbox without access. `staying`: the cloud this
 * device keeps syncing with (a Switch to Dropbox that didn't finish), else none.
 */
export function returnNote(reason, staying = '') {
  const still = staying ? `You’re still syncing with ${cloudName(staying)}.` : '';
  if (reason === 'denied') return `Dropbox wasn’t connected: access wasn’t allowed. ${still || 'Your planner stays on this device.'}`;
  if (reason === 'stale') return `That Dropbox sign-in had expired. ${staying ? `${still} Switch again to finish.` : 'Connect again to finish.'}`;
  return `Dropbox didn’t finish connecting. ${still ? `${still} ` : ''}Try again in a moment.`;
}
