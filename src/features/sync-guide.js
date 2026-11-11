import { qs, qsa } from '../lib/dom.js';
import { esc, escAttr } from '../lib/text.js';
import { joinWaitlist, leaveWaitlist, plannerApiEnabled, trackEvent } from '../lib/planner-api.js';
import { panelEnter } from '../ui/motion.js';

/**
 * "Sync on all my devices": the free route through the person's own cloud
 * first (Google Drive or Dropbox, whichever this copy can use, 1.38), shown
 * as an animated replica of the planner, then — only for people who still
 * want it — a waitlist for account-based sync. Anonymous counts at each step tell the
 * owner how many people saw the free option and joined anyway. Someone on the
 * list can leave it again from here: the address and the removal token the
 * server returned are kept on this device for that.
 */

const JOINED_KEY = 'daily-planner-ui:waitlist-joined';
const DEVICES = [['iphone', 'iPhone'], ['ipad', 'iPad'], ['android', 'Android'], ['mac', 'Mac'], ['windows', 'Windows'], ['linux', 'Linux']];

const MARK_FILES = { google: './assets/google-drive.svg', dropbox: './assets/dropbox.svg' };
const CLOUD_NAMES = { google: 'Google Drive', dropbox: 'Dropbox' };
/** The clouds' marks, as small as the replica: Google Drive's when this copy offers none yet. */
const cloudMarks = clouds => (clouds.length ? clouds : ['google']).map(id => `<img src="${MARK_FILES[id]}" alt="" width="14" height="14" decoding="async">`).join('');
/** "Google Drive", "Dropbox", or "Google Drive or Dropbox". */
const cloudWords = clouds => (clouds.length ? clouds : ['google']).map(id => CLOUD_NAMES[id]).join(' or ');
const connectLabel = clouds => (clouds.length === 1 ? `Connect ${CLOUD_NAMES[clouds[0]]}` : clouds.length ? 'Connect' : 'Connect Google Drive');
/** The difference between the clouds in one line (1.38): Dropbox saves on its own, Google Drive asks for a tap every hour. */
export const cloudDifference = clouds => (clouds.includes('google') && clouds.includes('dropbox')
  ? ' Dropbox stays connected and saves on its own; Google Drive asks for a tap every hour.'
  : clouds.includes('google') ? ' Google Drive asks for a tap every hour; changes wait on this device until then.' : '');
const CHECK = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6.5 12.5 3.3 3.3 7.7-8"/></svg>';
const SYNC = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 0 0-14.6-4.5M4 13a8 8 0 0 0 14.6 4.5"/><path d="M5 3v4h4M19 21v-4h-4"/></svg>';

/**
 * The waitlist sign-up kept on this device: `{ at, email, token }`, or an older
 * plain date (still joined, but it can't be removed from here). Null when not joined.
 */
export function readWaitlistJoined(storage = globalThis.localStorage) {
  let raw = null;
  try { raw = storage?.getItem(JOINED_KEY) || null; } catch (_) { return null; }
  if (!raw) return null;
  try {
    const value = raw.trim().startsWith('{') ? JSON.parse(raw) : null;
    if (value && typeof value === 'object') return { at: String(value.at || ''), email: String(value.email || ''), token: String(value.token || '') };
  } catch (_) {}
  return { at: raw, email: '', token: '' };
}

const host = () => (location.host && !/^(localhost|127\.0\.0\.1)(:|$)/.test(location.host) ? location.host : 'planner.bemorin.com');

function laptop({ settings = false, connected = false, synced = false, clouds = [] } = {}) {
  return `<div class="sg-laptop">
    <div class="sg-window">
      <div class="sg-window__bar"><i></i><i></i><i></i><span>${esc(host())}</span></div>
      <div class="sg-app">
        <div class="sg-app__plan">
          <b>Most important outcome</b>
          <div class="sg-row${synced ? ' sg-row--sync-done' : ''}"><span class="sg-check">${CHECK}</span>Finish the Horizon spec</div>
          <b>Tasks</b>
          <div class="sg-row"><span class="sg-check"></span>Call the bank</div>
          <div class="sg-row"><span class="sg-check"></span>Book physio</div>
        </div>
        <div class="sg-app__schedule"><span style="--top:8%;--h:30%"></span><span style="--top:46%;--h:16%"></span><span style="--top:70%;--h:20%"></span></div>
      </div>
      ${settings ? `<div class="sg-settings${connected ? ' is-connecting' : ''}">
        <small>Settings · Personal sync</small>
        <div class="sg-settings__card"><span class="sg-marks">${cloudMarks(clouds)}</span><span class="sg-settings__status"><b class="sg-before">Not connected</b><b class="sg-after">Sealed and synced</b></span><span class="sg-button"><span class="sg-before">${esc(connectLabel(clouds))}</span><span class="sg-after">Sync now</span></span></div>
      </div><span class="sg-cursor"></span>` : ''}
    </div>
  </div>`;
}

function phone({ connect = false, synced = false, clouds = [] } = {}) {
  return `<div class="sg-phone">
    <div class="sg-phone__screen">
      <span class="sg-phone__url">${esc(host())}</span>
      ${connect ? `<div class="sg-phone__connect"><span class="sg-marks">${cloudMarks(clouds)}</span><span class="sg-button"><span class="sg-before">${esc(connectLabel(clouds))}</span><span class="sg-after">Connected</span></span></div><span class="sg-finger"></span>` : `
      <b>Most important outcome</b>
      <div class="sg-row${synced ? ' sg-row--tap' : ''}"><span class="sg-check">${CHECK}</span>Finish the Horizon spec</div>
      <div class="sg-row"><span class="sg-check"></span>Call the bank</div>
      ${synced ? '<span class="sg-finger sg-finger--tick"></span>' : ''}`}
    </div>
  </div>`;
}

const STEPS = [
  {
    title: clouds => (clouds.length === 1 ? `Connect ${CLOUD_NAMES[clouds[0]]} here` : 'Connect your cloud here'),
    text: clouds => `Open <b>Settings → Personal sync</b>${clouds.length > 1 ? `, choose <b>Dropbox</b> or <b>Google Drive</b>,` : ''} and connect. Then choose a passphrase: it seals your plans on this device before they leave, and the planner only gets its own folder.${cloudDifference(clouds)}`,
    stage: clouds => `<div class="sg-stage sg-stage--1">${laptop({ settings: true, connected: true, clouds })}</div>`
  },
  {
    title: () => 'Do the same on your other device',
    text: () => `Open <b>${esc(host())}</b> on your phone or another computer — install it as an app if you like — connect the <b>same account</b> and type your passphrase once.`,
    stage: clouds => `<div class="sg-stage sg-stage--2">${laptop({ settings: true, clouds })}${phone({ connect: true, clouds })}</div>`
  },
  {
    title: () => 'That’s it — the same plans everywhere',
    text: () => 'Changes travel when you open the planner, when you close the day, and every couple of minutes while you work. Everything still works offline.',
    stage: () => `<div class="sg-stage sg-stage--3">${laptop({ synced: true })}<span class="sg-sync">${SYNC}</span>${phone({ synced: true })}</div>`
  }
];

export function createSyncGuide({ openModal, closeModal, openPrivacy = null, clouds = () => [], openSyncSettings = () => {} }) {
  let step = 0;
  let stage = 'guide';
  let reached = new Set();
  const modal = () => qs('[data-sync-guide-modal]');
  const root = () => qs('[data-sync-guide]');
  // Leaving the waitlist: '' → 'confirm' → 'busy' → 'left', or an error message.
  let leave = '';
  const joined = () => !!readWaitlistJoined();
  const canLeave = () => { const entry = readWaitlistJoined(); return plannerApiEnabled() && !!entry?.email && !!entry.token; };

  function leaveArea() {
    if (leave === 'left') return '<span role="status">You’ve left the waitlist and your address has been deleted.</span>';
    const entry = readWaitlistJoined();
    if (leave && leave !== 'confirm' && leave !== 'busy') return `<span class="sg-leave__error" role="alert">${esc(leave)}</span><button class="text-button" type="button" data-sync-leave-confirm>Try again</button><button class="text-button" type="button" data-sync-leave-cancel>Keep me on it</button>`;
    if (leave) return `<span>Remove <b>${esc(entry?.email || '')}</b> from the waitlist?</span><span class="sg-leave__actions"><button class="text-button" type="button" data-sync-leave-cancel${leave === 'busy' ? ' disabled' : ''}>Keep me on it</button><button class="secondary-button" type="button" data-sync-leave-confirm${leave === 'busy' ? ' disabled' : ''}>${leave === 'busy' ? 'Leaving…' : 'Leave'}</button></span>`;
    return canLeave() ? '<button class="text-button" type="button" data-sync-leave>Leave the waitlist</button>' : '';
  }

  /** Inline confirmation: only the small leave area changes, the rest of the dialog stays put. */
  function renderLeave(focus = '', animate = true) {
    const area = qs('[data-sync-leave-area]', root());
    if (!area) return;
    area.innerHTML = leaveArea();
    area.classList.toggle('is-confirming', !!leave && leave !== 'left');
    qs('[data-sync-leave]', area)?.addEventListener('click', () => { leave = 'confirm'; renderLeave('[data-sync-leave-cancel]'); });
    qs('[data-sync-leave-cancel]', area)?.addEventListener('click', () => { leave = ''; renderLeave('[data-sync-leave]'); });
    qs('[data-sync-leave-confirm]', area)?.addEventListener('click', confirmLeave);
    if (leave === 'left') qs('[data-sync-waitlist-status]', root())?.replaceChildren();
    if (animate) panelEnter(area, { distance: 4 });
    if (focus) (qs(focus, area) || area).focus?.({ preventScroll: true });
  }

  async function confirmLeave() {
    const entry = readWaitlistJoined();
    if (!entry?.email || !entry.token) return;
    leave = 'busy';
    renderLeave();
    const result = await leaveWaitlist({ email: entry.email, token: entry.token });
    if (!result.ok) { leave = result.error || 'Something went wrong. Please try again.'; renderLeave('[data-sync-leave-confirm]'); return; }
    try { localStorage.removeItem(JOINED_KEY); } catch (_) {}
    leave = 'left';
    if (stage === 'joined') { renderJoined(); bind(); panelEnter(qs('.sg-success', root())); qs('[data-sync-done]', root())?.focus({ preventScroll: true }); return; }
    renderLeave();
    qs('[data-sync-leave-area]', root())?.focus({ preventScroll: true });
  }

  function renderGuide() {
    const offered = clouds();
    const current = STEPS[step];
    const last = step === STEPS.length - 1;
    const waitlist = plannerApiEnabled();
    const note = offered.length ? '' : '<p class="sg-note">Personal sync isn’t switched on for this copy of the planner yet.</p>';
    const heading = offered.length === 1 ? `Your plans on every device — free, with your ${CLOUD_NAMES[offered[0]]}.` : 'Your plans on every device — free, with your own cloud.';
    root().innerHTML = `<header class="modal__header sg-header"><p class="modal__eyebrow">On all your devices</p><h2 id="sync-guide-title">${esc(heading)}</h2><p>Daily Planner keeps your plans in this browser. ${esc(cloudWords(offered))} can carry them to your other devices: one copy in <b>your own</b> cloud, sealed with a passphrase only you know. Nothing is stored on our servers.</p></header>
      <div class="sg-body" data-sync-step="${step}">
        <div class="sg-visual" aria-hidden="true">${current.stage(offered)}</div>
        <div class="sg-copy">
          <ol class="sg-dots">${STEPS.map((item, index) => `<li><button type="button" class="${index === step ? 'is-active' : index < step ? 'is-done' : ''}" data-sync-go="${index}" aria-label="${escAttr(`Step ${index + 1}: ${item.title(offered)}`)}"${index === step ? ' aria-current="step"' : ''}>${index + 1}</button></li>`).join('')}</ol>
          <h3>${esc(current.title(offered))}</h3>
          <p>${current.text(offered)}</p>
          ${last ? note : ''}
        </div>
      </div>
      <div class="modal__actions sg-actions">
        ${step > 0 ? '<button class="text-button" type="button" data-sync-back>Back</button>' : '<span></span>'}
        <div class="modal__actions-right">
          ${last
            ? (offered.length ? '<button class="primary-button" type="button" data-sync-open-settings>Set up sync</button>' : '<button class="primary-button" type="button" data-sync-done>Got it</button>')
            : '<button class="primary-button" type="button" data-sync-next>Next</button>'}
        </div>
      </div>
      ${waitlist ? `<div class="sg-waitlist-teaser${last ? '' : ' is-pending'}"${last ? '' : ' aria-hidden="true" inert'}>${joined() ? `<span data-sync-waitlist-status>You’re on the waitlist for account sync. We’ll write once when it’s ready.</span><span class="sg-leave" data-sync-leave-area tabindex="-1">${leaveArea()}</span>` : `<span>Rather not use ${esc(cloudWords(offered))}?</span><button class="text-button" type="button" data-sync-waitlist>Get notified about account sync</button>`}</div>` : ''}`;
  }

  function renderWaitlist(error = '', values = {}) {
    root().innerHTML = `<header class="modal__header sg-header"><p class="modal__eyebrow">Account sync · waitlist</p><h2 id="sync-guide-title">Sync with a Daily Planner account, without ${esc(cloudWords(clouds()))}.</h2><p>It isn’t built yet — your interest decides whether it will be. We’ll email you <b>once</b>, when it’s ready. No newsletter.</p></header>
      <form class="sg-form" data-sync-waitlist-form novalidate>
        <label class="form-field"><span>Email</span><input type="email" name="email" autocomplete="email" required maxlength="254" placeholder="you@example.com" value="${escAttr(values.email || '')}"></label>
        <fieldset class="sg-devices"><legend>Which devices would you use?</legend>${DEVICES.map(([value, label]) => `<label><input type="checkbox" name="devices" value="${value}" ${values.devices?.includes(value) ? 'checked' : ''}><span>${label}</span></label>`).join('')}</fieldset>
        <label class="form-field"><span>What would make it worth it? <em>optional</em></span><textarea name="note" rows="2" maxlength="600" placeholder="e.g. my work laptop can’t use Google">${esc(values.note || '')}</textarea></label>
        <label class="sg-consent"><input class="check" type="checkbox" name="consent" ${values.consent ? 'checked' : ''}><span>Email me once when account sync is ready. I can leave the list at any time, here in this guide.</span></label>
        <input type="text" name="website" tabindex="-1" autocomplete="off" class="sg-honeypot" aria-hidden="true">
        ${error ? `<p class="sg-error" role="alert">${esc(error)}</p>` : ''}
        <div class="modal__actions"><button class="text-button" type="button" data-sync-back-guide>Back to the guide</button><div class="modal__actions-right"><button class="primary-button" type="submit" data-sync-submit>Join the waitlist</button></div></div>
        ${openPrivacy ? '<p class="privacy-footnote">Only what you submit is stored. <button class="privacy-link" type="button" data-sync-privacy>How this is handled</button></p>' : ''}
      </form>`;
  }

  function renderJoined() {
    if (leave === 'left') {
      root().innerHTML = '<div class="sg-success"><h2 id="sync-guide-title">You’ve left the waitlist.</h2><p>Your address has been deleted. Sync through ${esc(cloudWords(clouds()))} works today, whenever you want it.</p><button class="primary-button" type="button" data-sync-done>Done</button></div>';
      return;
    }
    root().innerHTML = `<div class="sg-success"><span class="sg-success__mark">${CHECK}</span><h2 id="sync-guide-title">You’re on the list.</h2><p>Thank you — we’ll write once, when account sync is ready. In the meantime, sync through ${esc(cloudWords(clouds()))} works today.</p><button class="primary-button" type="button" data-sync-done>Done</button>${canLeave() ? `<p class="sg-leave sg-leave--joined" data-sync-leave-area tabindex="-1">${leaveArea()}</p>` : ''}</div>`;
  }

  function render({ animate = false, direction = 0 } = {}) {
    if (stage === 'waitlist') renderWaitlist(); else if (stage === 'joined') renderJoined(); else renderGuide();
    bind();
    if (animate) panelEnter(qs('.sg-body, .sg-form, .sg-success', root()) || root(), { direction });
  }

  function go(next) {
    const target = Math.max(0, Math.min(STEPS.length - 1, next));
    const direction = Math.sign(target - step);
    step = target;
    // Count each step once per opening, however people move back and forth.
    if (step >= 1 && !reached.has(1)) { reached.add(1); trackEvent('sync_guide_step_2'); }
    if (step === 2 && !reached.has(2)) { reached.add(2); trackEvent('sync_guide_step_3'); }
    render({ animate: true, direction });
    qs('[data-sync-next], .sg-actions .primary-button', root())?.focus({ preventScroll: true });
  }

  function bind() {
    const el = root();
    qsa('[data-sync-go]', el).forEach(button => button.addEventListener('click', () => go(Number(button.dataset.syncGo))));
    qs('[data-sync-next]', el)?.addEventListener('click', () => go(step + 1));
    qs('[data-sync-back]', el)?.addEventListener('click', () => go(step - 1));
    qs('[data-sync-open-settings]', el)?.addEventListener('click', () => { trackEvent('drive_connect_clicked'); closeModal(modal()); setTimeout(openSyncSettings, 200); });
    qs('[data-sync-waitlist]', el)?.addEventListener('click', () => { stage = 'waitlist'; trackEvent('waitlist_form_opened'); render({ animate: true, direction: 1 }); qs('input[name="email"]', root())?.focus(); });
    qs('[data-sync-back-guide]', el)?.addEventListener('click', () => { stage = 'guide'; render({ animate: true, direction: -1 }); qs('.sg-actions .primary-button', root())?.focus({ preventScroll: true }); });
    qs('[data-sync-done]', el)?.addEventListener('click', () => closeModal(modal()));
    qs('[data-sync-privacy]', el)?.addEventListener('click', () => openPrivacy?.());
    if (qs('[data-sync-leave-area]', el)) renderLeave('', false);
    const form = qs('[data-sync-waitlist-form]', el);
    form?.addEventListener('submit', async event => {
      event.preventDefault();
      const data = new FormData(form);
      const values = { email: String(data.get('email') || '').trim(), devices: data.getAll('devices').map(String), note: String(data.get('note') || ''), consent: data.get('consent') === 'on', website: String(data.get('website') || '') };
      if (!values.consent) { renderWaitlist('Please tick the box so we may email you once.', values); bind(); return; }
      const submit = qs('[data-sync-submit]', form);
      submit.disabled = true;
      submit.textContent = 'Joining…';
      const result = await joinWaitlist({ ...values, driveSeen: true, locale: navigator.language || '' });
      if (!result.ok) { renderWaitlist(result.error, values); bind(); return; }
      try { localStorage.setItem(JOINED_KEY, JSON.stringify({ at: new Date().toISOString(), email: values.email, token: String(result.removeToken || '') })); } catch (_) {}
      leave = '';
      trackEvent('waitlist_joined');
      stage = 'joined';
      renderJoined();
      bind();
      panelEnter(qs('.sg-success', root()));
      qs('[data-sync-done]', root())?.focus({ preventScroll: true });
    });
  }

  function open() {
    step = 0;
    stage = 'guide';
    leave = '';
    reached = new Set();
    render();
    openModal(modal(), qs('[data-sync-next]', root()));
    trackEvent('sync_guide_opened');
  }

  return { open };
}
