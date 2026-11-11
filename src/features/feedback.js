import { qs, qsa } from '../lib/dom.js';
import { esc, escAttr } from '../lib/text.js';
import { APP_VERSION, PROJECT_GITHUB_URL } from '../config.js';
import { platformLabel, plannerApiEnabled, sendFeedback, trackEvent } from '../lib/planner-api.js';
import { WHATS_NEW } from './whats-new.js';

/**
 * Feedback, once per feature release. People can always open it from Help or
 * the menu; once per feature release (1.21 covers 1.21.0, 1.21.1…) — after
 * the planner has really been used — it opens by itself with what changed in
 * that release, a rating, a few words, and an opt-in to be quoted on the
 * Daily Planner website. Sending it, or "Not now", means that release is never
 * asked about again on this device.
 */

const STATE_KEY = 'daily-planner-ui:feedback';
const DAY = 86400000;
const KINDS = [['idea', 'Idea'], ['problem', 'Problem'], ['praise', 'Praise'], ['other', 'Other']];
const STAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3.6 2.6 5.3 5.8.8-4.2 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8-4.2-4.1 5.8-.8Z"/></svg>';
const RATING_LABELS = ['', 'Not working for me', 'Needs work', 'It’s fine', 'Really useful', 'Love it'];
export const QUOTE_NAME_MAX = 60;
export const PROMPT_RULES = Object.freeze({ closedDays: 3, daysOnRelease: 2, daysBetweenPrompts: 14 });

/** The feature release a version belongs to: '1.21' for 1.21.0 and 1.21.3. */
export function featureVersion(version = APP_VERSION) {
  const match = /^(\d+)\.(\d+)/.exec(String(version || ''));
  return match ? `${Number(match[1])}.${Number(match[2])}` : String(version || '');
}

const earliest = (a, b) => (!a ? b || '' : !b ? a : a < b ? a : b);
const latest = (a, b) => (!a ? b || '' : !b ? a : a > b ? a : b);

/**
 * Normalises the stored state to `{ releases: { '1.21': entry }, lastPromptAt }`.
 * Older copies kept one entry per full version (`versions['1.20.0']`): those are
 * folded into their release, so a release already asked about is not asked again.
 */
export function migrateFeedbackState(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const releases = {};
  const merge = (key, entry) => {
    if (!key || !entry || typeof entry !== 'object') return;
    const current = releases[key] || {};
    const next = { firstSeen: earliest(current.firstSeen, entry.firstSeen) };
    ['prompted', 'sent', 'dismissed'].forEach(field => { const value = latest(current[field], entry[field]); if (value) next[field] = value; });
    releases[key] = next;
  };
  if (source.versions && typeof source.versions === 'object') Object.entries(source.versions).forEach(([version, entry]) => merge(featureVersion(version), entry));
  if (source.releases && typeof source.releases === 'object') Object.entries(source.releases).forEach(([release, entry]) => merge(featureVersion(release), entry));
  return { releases, lastPromptAt: typeof source.lastPromptAt === 'string' ? source.lastPromptAt : '' };
}

export function readFeedbackState(storage = globalThis.localStorage) {
  try {
    return migrateFeedbackState(JSON.parse(storage?.getItem(STATE_KEY) || '{}'));
  } catch (_) {
    return { releases: {}, lastPromptAt: '' };
  }
}

function writeFeedbackState(state, storage = globalThis.localStorage) {
  try { storage?.setItem(STATE_KEY, JSON.stringify({ releases: state.releases, lastPromptAt: state.lastPromptAt })); } catch (_) {}
}

/**
 * Pure prompt rule (unit-tested): ask about a feature release at most once,
 * only with the owner API on, after three closed days in total and two days on
 * this release, never within two weeks of the last prompt, and never over
 * another dialog or during first-run setup.
 */
export function shouldPromptFeedback(state, { version = APP_VERSION, now = new Date(), closeDayCount = 0, enabled = true, busy = false }) {
  if (!enabled || busy || closeDayCount < PROMPT_RULES.closedDays) return false;
  const entry = state.releases?.[featureVersion(version)];
  // Once shown, a release is never asked about again — even if it was ignored
  // or the page reloaded before it was answered.
  if (!entry?.firstSeen || entry.sent || entry.dismissed || entry.prompted) return false;
  if (now - new Date(entry.firstSeen) < PROMPT_RULES.daysOnRelease * DAY) return false;
  if (state.lastPromptAt && now - new Date(state.lastPromptAt) < PROMPT_RULES.daysBetweenPrompts * DAY) return false;
  return true;
}

export function createFeedbackFeature({ openModal, closeModal, openPrivacy = null }) {
  const modal = () => qs('[data-feedback-modal]');
  const root = () => qs('[data-feedback]');
  const release = featureVersion(APP_VERSION);
  const blankDraft = () => ({ rating: null, kind: 'idea', message: '', email: '', quote: false, name: '' });
  let draft = blankDraft();
  // 'prompt' when it opened by itself (its quiet button is "Not now"), 'manual' from Help or the menu.
  let mode = 'manual';

  const available = () => plannerApiEnabled() || !!PROJECT_GITHUB_URL;

  function update(mutator) {
    const state = readFeedbackState();
    mutator(state);
    writeFeedbackState(state);
  }

  const mark = (field, now = new Date()) => update(state => { state.releases[release] = { ...(state.releases[release] || { firstSeen: now.toISOString() }), [field]: now.toISOString() }; });

  /** Remember when this release was first used, so the prompt waits a few days. */
  function noteVersionSeen(now = new Date()) {
    update(state => { state.releases[release] ||= { firstSeen: now.toISOString() }; });
  }

  function whatsNew() {
    const items = WHATS_NEW.version === release ? WHATS_NEW.items : [];
    if (!items.length) return '';
    return `<section class="whats-new" aria-labelledby="whats-new-title">
        <h3 id="whats-new-title" class="sr-only">What’s new</h3>
        <ul>${items.map(item => `<li><span class="whats-new__mark" aria-hidden="true"></span><span>${esc(item)}</span></li>`).join('')}</ul>
      </section>`;
  }

  // People see the feature release (1.33); the exact version (1.33.1) is what is sent, and the form says so.
  function header() {
    const items = WHATS_NEW.version === release && WHATS_NEW.items.length;
    return `<header class="modal__header feedback-head">
        <p class="modal__eyebrow">Daily Planner ${esc(release)}</p>
        <h2 id="feedback-title" tabindex="-1">${items ? `What’s new in ${esc(release)}` : 'How is Daily Planner working for you?'}</h2>
      </header>`;
  }

  function render(error = '') {
    const el = root();
    if (!plannerApiEnabled()) {
      el.innerHTML = `${header()}${whatsNew()}
        <p class="feedback-lede">Feedback for this copy of the planner goes through the project page.</p>
        <div class="modal__actions"><button class="text-button" type="button" data-feedback-close>Close</button><div class="modal__actions-right"><a class="primary-button" href="${escAttr(PROJECT_GITHUB_URL)}/issues/new" target="_blank" rel="noopener">Open the project page</a></div></div>`;
      bind();
      return;
    }
    const sentBefore = !!readFeedbackState().releases[release]?.sent;
    el.innerHTML = `${header()}${whatsNew()}
      <form class="feedback-form" data-feedback-form novalidate>
        <div class="feedback-ask">
          <h3>${sentBefore ? `Anything else about ${esc(release)}?` : 'How is it working for you?'}</h3>
          <div class="feedback-rating" role="radiogroup" aria-label="Rating">${[1, 2, 3, 4, 5].map(value => `<button type="button" role="radio" aria-checked="${draft.rating === value}" tabindex="${(draft.rating || 1) === value ? '0' : '-1'}" class="${draft.rating >= value ? 'is-on' : ''}" data-feedback-rate="${value}" aria-label="${escAttr(`${value} — ${RATING_LABELS[value]}`)}">${STAR}</button>`).join('')}<span class="feedback-rating__label" data-feedback-rating-label aria-hidden="true">${draft.rating ? esc(RATING_LABELS[draft.rating]) : 'Tap a star'}</span></div>
        </div>
        <label class="form-field"><span>What should we keep, change or fix?</span><textarea name="message" rows="4" maxlength="4000" placeholder="The more concrete, the better.">${esc(draft.message)}</textarea></label>
        <div class="feedback-kinds" role="radiogroup" aria-label="It’s mostly">${KINDS.map(([value, label]) => `<button type="button" role="radio" aria-checked="${draft.kind === value}" class="${draft.kind === value ? 'is-active' : ''}" data-feedback-kind="${value}">${label}</button>`).join('')}</div>
        <label class="form-field"><span>Email <em>optional — only if you’d like a reply</em></span><input type="email" name="email" maxlength="254" autocomplete="email" value="${escAttr(draft.email)}"></label>
        <div class="feedback-quote">
          <label class="feedback-quote__opt"><input type="checkbox" name="quote" data-feedback-quote${draft.quote ? ' checked' : ''}><span><strong>You can quote this on the Daily Planner website</strong><small>With your rating and the name below. Your email is never shown.</small></span></label>
          <label class="form-field feedback-quote__name" data-feedback-quote-name${draft.quote ? '' : ' hidden'}><span>Name to show <em>optional</em></span><input type="text" name="name" maxlength="${QUOTE_NAME_MAX}" autocomplete="off" placeholder="e.g. Claire, product designer" value="${escAttr(draft.name)}"></label>
        </div>
        <input type="text" name="website" tabindex="-1" autocomplete="off" class="sg-honeypot" aria-hidden="true">
        <p class="feedback-meta">Sent with: Daily Planner ${esc(APP_VERSION)} · ${esc(platformLabel())}. Your plans are never included.</p>
        ${error ? `<p class="sg-error" role="alert">${esc(error)}</p>` : ''}
        <div class="modal__actions"><button class="text-button" type="button" data-feedback-later>${mode === 'prompt' ? 'Not now' : 'Cancel'}</button><div class="modal__actions-right"><button class="primary-button" type="submit" data-feedback-submit>Send feedback</button></div></div>
        ${openPrivacy ? '<p class="privacy-footnote">Only what you send is stored. <button class="privacy-link" type="button" data-feedback-privacy>How this is handled</button></p>' : ''}
      </form>`;
    bind();
  }

  function setRating(value, el = root()) {
    draft.rating = value;
    qsa('[data-feedback-rate]', el).forEach(star => {
      const n = Number(star.dataset.feedbackRate);
      star.classList.toggle('is-on', n <= value);
      star.setAttribute('aria-checked', String(n === value));
      star.tabIndex = n === value ? 0 : -1;
    });
    const label = qs('[data-feedback-rating-label]', el);
    if (label) label.textContent = RATING_LABELS[value];
  }

  function bind() {
    const el = root();
    qsa('[data-feedback-close]', el).forEach(button => button.addEventListener('click', () => closeModal(modal())));
    qs('[data-feedback-later]', el)?.addEventListener('click', () => { if (mode === 'prompt') mark('dismissed'); closeModal(modal()); });
    qs('[data-feedback-privacy]', el)?.addEventListener('click', () => openPrivacy?.());
    const form = qs('[data-feedback-form]', el);
    if (!form) return;
    const capture = () => {
      draft.message = form.elements.message.value;
      draft.email = form.elements.email.value;
      draft.quote = form.elements.quote.checked;
      draft.name = form.elements.name.value;
    };
    qsa('[data-feedback-rate]', el).forEach(button => {
      button.addEventListener('click', () => setRating(Number(button.dataset.feedbackRate), el));
      button.addEventListener('keydown', event => {
        const step = { ArrowRight: 1, ArrowUp: 1, ArrowLeft: -1, ArrowDown: -1 }[event.key];
        if (!step) return;
        event.preventDefault();
        const next = Math.min(5, Math.max(1, (draft.rating || Number(button.dataset.feedbackRate)) + (draft.rating ? step : 0)));
        setRating(next, el);
        qs(`[data-feedback-rate="${next}"]`, el)?.focus();
      });
    });
    qsa('[data-feedback-kind]', el).forEach(button => button.addEventListener('click', () => {
      draft.kind = button.dataset.feedbackKind;
      qsa('[data-feedback-kind]', el).forEach(chip => { const on = chip === button; chip.classList.toggle('is-active', on); chip.setAttribute('aria-checked', String(on)); });
    }));
    qs('[data-feedback-quote]', el)?.addEventListener('change', event => {
      draft.quote = event.currentTarget.checked;
      const field = qs('[data-feedback-quote-name]', el);
      if (field) field.hidden = !draft.quote;
    });
    form.addEventListener('submit', async event => {
      event.preventDefault();
      capture();
      if (!draft.rating && !draft.message.trim()) { render('Add a rating or a few words.'); qs('[data-feedback-rate]', root())?.focus(); return; }
      const submit = qs('[data-feedback-submit]', form);
      submit.disabled = true;
      submit.textContent = 'Sending…';
      const quote = draft.quote;
      const result = await sendFeedback({ rating: draft.rating, kind: draft.kind, message: draft.message, email: draft.email, quote, name: quote ? draft.name.trim().slice(0, QUOTE_NAME_MAX) : '', website: form.elements.website.value });
      if (!result.ok) { render(result.error); return; }
      mark('sent');
      trackEvent('feedback_sent');
      if (quote && draft.rating && draft.message.trim()) trackEvent('review_sent');
      draft = blankDraft();
      root().innerHTML = `<div class="sg-success"><span class="sg-success__mark"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6.5 12.5 3.3 3.3 7.7-8"/></svg></span><h2 id="feedback-title">Thank you.</h2><p>Your note on Daily Planner ${esc(release)} has been sent${quote ? ', and may be quoted on the website' : ''}. You won’t be asked about this release again.</p><button class="primary-button" type="button" data-feedback-close>Done</button></div>`;
      qs('[data-feedback-close]', root())?.addEventListener('click', () => closeModal(modal()));
    });
  }

  function show(nextMode) {
    mode = nextMode;
    render();
    // Opened by itself, the dialog starts at its title; from Help or the menu, at the stars.
    openModal(modal(), qs(nextMode === 'prompt' ? '#feedback-title' : plannerApiEnabled() ? '[data-feedback-rate]' : '.primary-button', root()));
  }

  /** From Help or the menu: the same dialog, with what's new. */
  function open() {
    show('manual');
    trackEvent('feedback_opened');
  }

  /**
   * Opens the release prompt when the rule allows it. `busy` is true while a
   * dialog is open or first-run setup isn't finished.
   */
  function maybePrompt({ closeDayCount = 0, now = new Date(), busy = false } = {}) {
    const state = readFeedbackState();
    const blocked = busy || !!document.querySelector('.modal.is-open');
    if (!shouldPromptFeedback(state, { version: APP_VERSION, now, closeDayCount, enabled: plannerApiEnabled(), busy: blocked })) return false;
    update(next => {
      next.lastPromptAt = now.toISOString();
      next.releases[release] = { ...(next.releases[release] || { firstSeen: now.toISOString() }), prompted: now.toISOString() };
    });
    show('prompt');
    trackEvent('feedback_prompt_shown');
    return true;
  }

  return { open, available, maybePrompt, noteVersionSeen };
}
