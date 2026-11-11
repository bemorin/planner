import { qs, qsa } from '../lib/dom.js';
import { esc } from '../lib/text.js';
import { DROPBOX_APP_KEY, GOOGLE_CLIENT_ID } from '../config.js';
import { COUNTED_EVENTS, plannerApiEnabled, setUsageCountsEnabled, usageCountsEnabled } from '../lib/planner-api.js';

/**
 * Privacy notice. It is written from how this copy of the planner is
 * configured — owner API, Personal sync (Google Drive, Dropbox), or nothing — so it can only
 * describe what the code actually does. Its entry points (Settings, Help,
 * setup, the waitlist and feedback forms) appear only when the owner API is
 * switched on; it also holds the per-device switch for anonymous counts.
 */

/** Pure: the notice's sections for a configuration (unit-tested). */
export function privacyNoticeSections({ plannerApi = false, googleDrive = false, dropbox = false, events = COUNTED_EVENTS } = {}) {
  const clouds = [googleDrive && 'Google Drive', dropbox && 'Dropbox'].filter(Boolean);
  const cloudWords = clouds.join(' or ');
  const local = [
    'Your plans, journal, Horizon and settings are saved in this browser, on this device. They are never sent to us — not even with feedback.',
    'Backups and exports are files you download and keep yourself.'
  ];
  if (!plannerApi) {
    local.push(clouds.length
      ? `Apart from Personal sync with ${cloudWords}, which only starts when you connect it, this copy of the planner makes no network requests after it has loaded.`
      : 'This copy of the planner makes no network requests after it has loaded.');
  }
  const sections = [{ id: 'local', title: 'Your plans stay in this browser', paragraphs: local }];
  if (plannerApi) {
    sections.push({
      id: 'counts',
      title: 'Anonymous usage counts',
      paragraphs: ['To learn which parts of the planner are used, this copy adds one to a daily count when someone:'],
      list: events.map(([, words]) => words),
      // 1.35: every write to the server counts toward a per-connection limit (server/rate-limit.js), keyed by a hash
      // of the IP address whose salt changes every UTC day; Cloudflare Web Analytics measures the pages apart.
      after: [
        'Each count holds only the name of the moment and the app version: no identifiers, no cookies, no IP address, and nothing you write in the planner. To stop abuse, our server limits how often one connection can send it something, counts and forms included. For that alone, it keeps a scrambled form of your IP address, apart from the counts: it can’t be linked back to you once the day changes, and it is deleted within 24 hours.',
        'Our host, Cloudflare, also measures visits to the site’s pages for us (Cloudflare Web Analytics): without cookies, in totals only. The switch below covers the counts above, not Cloudflare’s measure; a content blocker in your browser stops that one.'
      ],
      toggle: true
    });
    sections.push({
      id: 'submissions',
      title: 'Waitlist and feedback',
      paragraphs: [
        'Sent only when you submit them, and they keep working when usage counts are off.',
        'The waitlist stores the email you enter, the devices you tick, your optional note, your browser language, the app version, the date, and that you came from the sync guide.',
        'Waitlist addresses are emailed once, through our email provider, when account sync is ready — and then deleted automatically. You can remove yours at any time from the sync guide (Leave the waitlist).',
        'Feedback stores your rating, the kind of note, your message, the app version, the kind of device (for example “Mac · browser”) and the date — and your email only if you add one.',
        'If you tick “You can quote this on the Daily Planner website”, your rating, your message and the name you chose are also kept as a review that may be published there. Ask and it is deleted.',
        'Either can be deleted on request.'
      ]
    });
  }
  if (clouds.length) {
    sections.push({
      id: 'drive',
      title: 'Personal sync',
      paragraphs: [
        `Optional. When you connect ${cloudWords}, the planner keeps one file there, in its own folder of your account, written directly from this browser. It never passes through or stays on our servers.`,
        'That copy is sealed on this device with a passphrase you choose: encrypted before it leaves, so the cloud holds a file it can’t read. The passphrase never leaves this device and we can’t recover it; this device keeps only a key made from it.',
        googleDrive
          ? 'Nothing of your planner reaches the cloud until you choose Connect, and you can disconnect in Settings. Choosing Google Drive in Settings, or reaching for its Connect button, loads Google’s sign-in, so that its window can open from your tap.'
          : 'Nothing reaches the cloud until you choose Connect, and you can disconnect in Settings.'
      ]
    });
  }
  return sections;
}

const toggleNote = on => (on
  ? 'On for this browser. Turn it off and nothing is counted from here.'
  : 'Off for this browser — nothing is counted from here.');

export function createPrivacyNotice({ openModal, closeModal, googleDrive = () => !!GOOGLE_CLIENT_ID, dropbox = () => !!DROPBOX_APP_KEY }) {
  const modal = () => qs('[data-privacy-modal]');
  const root = () => qs('[data-privacy]');
  const available = () => plannerApiEnabled();

  function refreshEntryPoints() {
    const on = usageCountsEnabled();
    qsa('[data-privacy-entry]').forEach(element => { element.hidden = !available(); });
    qsa('[data-privacy-status]').forEach(element => { element.textContent = on ? 'Anonymous usage counts are on' : 'Anonymous usage counts are off'; });
  }

  function render() {
    const on = usageCountsEnabled();
    const toggle = `<label class="privacy-toggle"><span><strong>Send anonymous usage counts</strong><small data-privacy-toggle-note>${esc(toggleNote(on))}</small></span><input class="privacy-switch" type="checkbox" role="switch" data-usage-counts-toggle${on ? ' checked' : ''}></label>`;
    const sections = privacyNoticeSections({ plannerApi: plannerApiEnabled(), googleDrive: googleDrive(), dropbox: dropbox() }).map(section => `<section class="privacy-section privacy-section--${section.id}">
        <h3>${esc(section.title)}</h3>
        ${section.paragraphs.map(text => `<p>${esc(text)}</p>`).join('')}
        ${section.list ? `<ul class="privacy-moments">${section.list.map(item => `<li>${esc(item)}</li>`).join('')}</ul>` : ''}
        ${(section.after || []).map(text => `<p>${esc(text)}</p>`).join('')}
        ${section.toggle ? toggle : ''}
      </section>`).join('');
    root().innerHTML = `<header class="modal__header"><p class="modal__eyebrow">Privacy</p><h2 id="privacy-title">What this copy of the planner shares</h2><p>Written from how this copy is set up, so it says exactly what it does.</p></header>
      <div class="privacy-sections">${sections}</div>
      <div class="modal__actions"><span></span><div class="modal__actions-right"><button class="primary-button" type="button" data-privacy-done>Done</button></div></div>`;
    qs('[data-usage-counts-toggle]', root())?.addEventListener('change', event => {
      setUsageCountsEnabled(event.target.checked);
      const note = qs('[data-privacy-toggle-note]', root());
      if (note) note.textContent = toggleNote(usageCountsEnabled());
      refreshEntryPoints();
    });
    qs('[data-privacy-done]', root())?.addEventListener('click', () => closeModal(modal()));
  }

  /** Opens above whatever dialog is showing and returns to it when closed. */
  function open() {
    if (!available()) return;
    render();
    openModal(modal(), qs('[data-privacy-done]', root()), { stack: true });
  }

  qsa('[data-privacy-open]').forEach(button => button.addEventListener('click', open));
  refreshEntryPoints();

  return { open, available };
}
