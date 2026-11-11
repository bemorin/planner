// Owner dashboard for the planner API (server/planner-api.js).
// Sign-in exchanges the admin token (plus an authenticator code when two-factor
// is on) for a signed 8-hour session (POST admin/session). Only that session is
// kept, in sessionStorage for this tab, and sent as a Bearer header; the token
// itself is never stored. Every value rendered here is escaped. Secret values
// (the admin token, Resend's key) never reach this page: the Setup card only
// says whether they are set. Trends (./trends-view.js) read the daily series
// once per sign-in and again on Refresh. The page carries its own version
// (APP_VERSION) and compares it with the one the API was deployed with: when
// they differ, a banner offers a reload past the caches (./version.js).
// “Needs your attention”, at the top, lists what to act on (./attention.js)
// and marks the cards and rows it points to.

import { ATTENTION_SECTIONS, attentionBySection, attentionNote, attentionWhen, buildAttention, setupChecks } from './attention.js';
// The questions table: who asked, the question, and Delete.
import { questionsTableHtml } from './requests-view.js';
// The owner's own browsers kept out of the anonymous counts, and “Start fresh”.
import { browserLine, countBrowser, freshDoneText, freshStartHtml, keepBrowserOut, openFreshStartDialog, readCounts, RESET_WORD } from './usage-counts.js';
import { createTrendsView } from './trends-view.js';
import { dayOf, normalizeSeries, seriesWindow } from './trends.js';
import { compareVersions, readReloadMark, reloadUrl, versionNotice } from './version.js';
// The legal pages' checks (a plain email address, a phone number): Setup says what the pages will leave out.
import { legalDetails, legalEmail, legalValueProblem } from '../legal/legal-details.js';
// Wide tables scroll by keyboard too, while they overflow.
import { overflows, syncScrollRegion } from '../src/lib/dom.js';

const SESSION_KEY = 'daily-planner-owner-session';
const LEGACY_TOKEN_KEY = 'daily-planner-owner-token';
const API = (() => {
  const configured = globalThis.__DAILY_PLANNER_CONFIG__?.PLANNER_API_URL;
  return (typeof configured === 'string' && configured.trim() ? configured.trim() : '../api').replace(/\/+$/, '');
})();

const $ = (selector, root = document) => root.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
// A reply link only for plain addresses: nothing that could add ?bcc= or a body to the draft.
const mailLink = email => (/^[^\s?&=%/#@]+@[a-z0-9.-]+$/i.test(String(email || '')) ? `<a href="mailto:${esc(email)}">${esc(email)}</a>` : `<span>${esc(email)}</span>`);
const number = value => new Intl.NumberFormat().format(Number(value) || 0);
const percent = (part, whole) => (whole ? `${Math.round(part / whole * 100)}%` : '—');
const plural = (count, word) => `${word}${Number(count) === 1 ? '' : 's'}`;
const when = iso => (iso ? new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');
const stars = rating => (rating ? `<span class="owner-stars" aria-label="${rating} out of 5">${'★'.repeat(rating)}<span>${'★'.repeat(5 - rating)}</span></span>` : '<span class="owner-stars"><span>No rating</span></span>');

const APP_CONFIG = globalThis.__DAILY_PLANNER_CONFIG__ || {};
const day = iso => (iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const PERIODS = [{ value: '7', label: '7 days' }, { value: '30', label: '30 days' }, { value: '90', label: '90 days' }, { value: '365', label: '12 months' }];
const CHECK_SVG = '<svg class="option-check" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="m6.5 12.5 3.3 3.3 7.7-8"/></svg>';
const people = count => `${number(count)} ${Number(count) === 1 ? 'person' : 'people'}`;
const SIGNED_OUT_MESSAGE = 'Your session has ended. Please sign in again.';
const SIGN_IN_FAILED_MESSAGE = 'Sign-in failed. Check the token and the code, then try again.';
const UPDATE_API_MESSAGE = 'Update the API to see trends: this one does not answer admin/series yet (added in 1.21).';
// This page's own release, kept in step with package.json and src/config.js
// (tests/admin-version.test.js). Not imported: it must come from this very
// file, so an old cached admin.js shows its old number.
const APP_VERSION = '1.39.0';
// What Reload fetches again past the browser cache before opening the page anew.
const DASHBOARD_FILES = ['./', './admin.js', './admin.css', './version.js', './attention.js', './requests-view.js', './usage-counts.js', './trends-view.js', './trends.js', './charts.js', '../styles.css', '../runtime-config.js', '../src/vendor/motion.js', '../src/lib/planner-api.js', '../src/config.js', '../legal/legal-details.js', '../src/lib/text.js', '../src/lib/dom.js'];
const RELOAD_SVG = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.34-5.66"/><path d="M20 4.5v4h-4"/></svg>';

class ApiError extends Error {
  constructor(kind, message = '') {
    super(message || kind);
    this.kind = kind;
  }
}

// App-style dropdown (the planner's .select-trigger + .app-popover list):
// a button with aria-haspopup="listbox" opens a list of options. Arrow keys,
// Home/End, Enter/Space, Escape, Tab and a click outside all behave like a
// native select. Only one list is open at a time.
let openDropdown = null;

function createDropdown(trigger, { items = [], value = '', onChange = () => {} } = {}) {
  const valueLabel = $('.select-trigger__value', trigger);
  const listId = `${trigger.id}-list`;
  let options = items;
  let current = String(value);
  let popover = null;

  const render = () => {
    const item = options.find(option => option.value === current);
    valueLabel.textContent = item ? item.label : '';
  };

  function place() {
    const rect = trigger.getBoundingClientRect();
    popover.style.minWidth = `${Math.round(rect.width)}px`;
    const box = popover.getBoundingClientRect();
    const left = Math.min(rect.left, innerWidth - box.width - 8);
    const below = rect.bottom + 6;
    const top = below + box.height > innerHeight - 8 && rect.top - box.height - 6 > 8 ? rect.top - box.height - 6 : below;
    popover.style.left = `${Math.max(8, left)}px`;
    popover.style.top = `${Math.max(8, top)}px`;
  }

  const optionButtons = () => [...popover.querySelectorAll('[role="option"]')];

  function focusOption(index) {
    const buttons = optionButtons();
    if (!buttons.length) return;
    buttons[Math.max(0, Math.min(buttons.length - 1, index))].focus();
  }

  function close({ restoreFocus = false } = {}) {
    if (!popover) return;
    popover.remove();
    popover = null;
    openDropdown = null;
    trigger.setAttribute('aria-expanded', 'false');
    document.removeEventListener('pointerdown', onOutside, true);
    removeEventListener('resize', onViewportChange);
    removeEventListener('scroll', onViewportChange, true);
    if (restoreFocus) trigger.focus();
  }

  function choose(next) {
    const changed = next !== current;
    current = next;
    render();
    close({ restoreFocus: true });
    if (changed) onChange(current);
  }

  function onOutside(event) {
    if (!popover?.contains(event.target) && !trigger.contains(event.target)) close();
  }

  function onViewportChange(event) {
    if (event.type === 'scroll' && popover?.contains(event.target)) return;
    close();
  }

  function onListKey(event) {
    const buttons = optionButtons();
    const index = buttons.indexOf(document.activeElement);
    if (event.key === 'ArrowDown') { event.preventDefault(); focusOption(index + 1); }
    else if (event.key === 'ArrowUp') { event.preventDefault(); focusOption(index - 1); }
    else if (event.key === 'Home' || event.key === 'PageUp') { event.preventDefault(); focusOption(0); }
    else if (event.key === 'End' || event.key === 'PageDown') { event.preventDefault(); focusOption(buttons.length - 1); }
    else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (index >= 0) choose(options[index].value);
    } else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close({ restoreFocus: true }); }
    // Tab leaves from the trigger, so focus moves on as it would from a select.
    else if (event.key === 'Tab') close({ restoreFocus: true });
  }

  function open(focus = 'selected') {
    if (popover) return;
    openDropdown?.close();
    popover = document.createElement('div');
    popover.className = 'app-popover app-popover--list is-compact owner-popover';
    popover.id = listId;
    popover.setAttribute('role', 'listbox');
    popover.setAttribute('aria-labelledby', trigger.getAttribute('aria-labelledby') || trigger.id);
    popover.innerHTML = options.map((option, index) => {
      const selected = option.value === current;
      return `<button class="popover-option${selected ? ' is-selected' : ''}" type="button" role="option" tabindex="-1" aria-selected="${selected}" data-index="${index}"><span>${esc(option.label)}</span>${selected ? CHECK_SVG : ''}</button>`;
    }).join('');
    popover.addEventListener('click', event => {
      const button = event.target.closest('[role="option"]');
      if (button) choose(options[Number(button.dataset.index)].value);
    });
    popover.addEventListener('keydown', onListKey);
    document.body.append(popover);
    trigger.setAttribute('aria-expanded', 'true');
    trigger.setAttribute('aria-controls', listId);
    openDropdown = api;
    place();
    document.addEventListener('pointerdown', onOutside, true);
    addEventListener('resize', onViewportChange);
    addEventListener('scroll', onViewportChange, true);
    const selectedIndex = Math.max(0, options.findIndex(option => option.value === current));
    focusOption(focus === 'first' ? 0 : focus === 'last' ? options.length - 1 : selectedIndex);
    requestAnimationFrame(() => popover?.classList.add('is-open'));
  }

  trigger.addEventListener('click', () => { if (popover) close({ restoreFocus: true }); else open(); });
  trigger.addEventListener('keydown', event => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      open();
    } else if (event.key === 'Escape' && popover) {
      event.preventDefault();
      close({ restoreFocus: true });
    }
  });

  const api = {
    get value() { return current; },
    setItems(next, fallback = '') {
      options = next;
      if (!options.some(option => option.value === current)) current = fallback;
      render();
      if (popover) close();
    },
    close
  };
  render();
  return api;
}

function readSession() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');
    if (typeof saved?.session === 'string' && Number(saved.expiresAt) > Date.now() + 5000) return { session: saved.session, expiresAt: Number(saved.expiresAt) };
  } catch (_) {}
  return null;
}

// An earlier dashboard kept the raw token in this tab; never leave it behind.
try { sessionStorage.removeItem(LEGACY_TOKEN_KEY); } catch (_) {}

let session = readSession();
let expiryTimer = 0;
// The session the trends series was last read for: once per sign-in, and on Refresh.
let seriesSession = null;
const trends = createTrendsView($('[data-owner-trends]'));

function scheduleExpiry() {
  clearTimeout(expiryTimer);
  if (session) expiryTimer = setTimeout(() => signOut(SIGNED_OUT_MESSAGE), Math.max(0, session.expiresAt - Date.now()));
}

function saveSession(value) {
  session = value;
  try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(value)); } catch (_) {}
  scheduleExpiry();
}

function clearSession() {
  session = null;
  clearTimeout(expiryTimer);
  try { sessionStorage.removeItem(SESSION_KEY); } catch (_) {}
}

async function call(path, { auth = true, ...options } = {}) {
  const headers = { ...(options.headers || {}) };
  if (auth && session) headers.authorization = `Bearer ${session.session}`;
  let response;
  try {
    response = await fetch(`${API}/${path}`, { ...options, headers, cache: 'no-store' });
  } catch (_) {
    throw new ApiError('offline');
  }
  if (response.ok) return response;
  const body = await response.json().catch(() => null);
  if (response.status === 401) throw new ApiError('unauthorized');
  if (response.status === 503 && body?.error) throw new ApiError('setup', body.error);
  // A static server (or a host without the Functions) has no JSON answer.
  if (!body && [404, 405, 501].includes(response.status)) throw new ApiError('offline', `HTTP ${response.status}`);
  throw new ApiError('failed', `${body?.error || 'Request failed'} (HTTP ${response.status}).`);
}

async function jsonOf(response) {
  try { return await response.json(); } catch (_) { throw new ApiError('offline', 'the answer was not JSON'); }
}

// Unauthenticated call: a running, configured API answers 401; a missing
// binding or secret answers 503; anything else means there is no API here.
async function probe() {
  try {
    await jsonOf(await call('admin/summary?days=1', { auth: false }));
  } catch (error) {
    if (error.kind === 'unauthorized') return;
    throw error;
  }
  throw new ApiError('offline', 'unexpected answer');
}

function setNotice(message = '') {
  const notice = $('[data-owner-notice]');
  notice.hidden = !message;
  notice.textContent = message;
}

function show(view) {
  $('[data-owner-checking]').hidden = view !== 'checking';
  $('[data-owner-unavailable]').hidden = view !== 'unavailable';
  $('[data-owner-login]').hidden = view !== 'login';
  $('[data-owner-body]').hidden = view !== 'dashboard';
  $('[data-owner-actions]').hidden = view !== 'dashboard';
  $('[data-owner-browser]').hidden = view !== 'dashboard';
}

function showLogin(message = '') {
  show('login');
  const error = $('[data-owner-error]');
  error.hidden = !message;
  error.textContent = message;
  $('[data-owner-login] input[name="token"]').focus();
}

function showUnavailable(error) {
  const target = new URL(`${API}/`, location.href).href;
  const setup = error.kind === 'setup';
  $('[data-owner-unavailable-title]').textContent = setup ? 'The owner API isn’t set up yet.' : 'The owner API isn’t running here.';
  $('[data-owner-unavailable-detail]').textContent = setup
    ? `The API at ${target} answered: “${error.message}”`
    : `Nothing answered at ${target}${error.message && error.message !== 'offline' ? ` (${error.message})` : ''}, so this page is being served without the API.`;
  show('unavailable');
}

function clearRendered() {
  ['[data-owner-kpis]', '[data-owner-funnel]', '[data-owner-questions]', '[data-owner-waitlist]', '[data-owner-versions]', '[data-owner-feedback]', '[data-owner-signals]',
    '[data-owner-setup]', '[data-owner-reviews]', '[data-owner-fresh]']
    .forEach(selector => { $(selector).innerHTML = ''; });
  trends.clear();
  seriesSession = null;
  $('[data-owner-session]').textContent = '';
  openDropdown?.close();
  hideAnnounceConfirm();
  showAnnounceResult('');
  freshCounts = null;
  freshResult = null;
  clearAttention();
}

function signOut(message = '') {
  clearSession();
  clearRendered();
  setNotice('');
  showLogin(message);
}

function handleError(error) {
  if (error?.kind === 'unauthorized') { signOut(SIGNED_OUT_MESSAGE); return; }
  if (error?.kind === 'offline' || error?.kind === 'setup') { showUnavailable(error); return; }
  $('[data-owner-checking]').hidden = true;
  setNotice(error?.message || 'Something went wrong.');
}

function untilLabel(ms) {
  const date = new Date(ms);
  const time = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return date.toDateString() === new Date().toDateString() ? time : `${date.toLocaleDateString(undefined, { weekday: 'short' })} ${time}`;
}

const totalOf = (rows, name) => rows.filter(row => row.name === name).reduce((sum, row) => sum + Number(row.count || 0), 0);

function renderKpis(summary, days) {
  const rows = summary.eventTotals;
  const sinceWeek = new Date(Date.now() - 7 * 86400000).toISOString();
  const lastWeek = summary.waitlist.filter(row => row.createdAt >= sinceWeek).length;
  const reachedEnd = totalOf(rows, 'sync_guide_step_3');
  const joined = totalOf(rows, 'waitlist_joined');
  const questions = Number(summary.questionCount) || 0;
  const latest = summary.feedbackByVersion[0];
  const feedbackTotal = summary.feedbackByVersion.reduce((sum, row) => sum + Number(row.count || 0), 0);
  $('[data-owner-kpis]').innerHTML = [
    ['Waitlist sign-ups', number(summary.waitlist.length), `${number(lastWeek)} in the last 7 days`],
    ['Still joined after seeing Drive', percent(joined, reachedEnd), `${number(joined)} of ${number(reachedEnd)} who finished the Drive guide · ${days} days`],
    ['Questions', number(questions), summary.questionsUnavailable ? 'Table missing — apply migrations/schema.sql' : 'From the Contact page, all time'],
    ['Feedback received', number(feedbackTotal), latest ? `Latest version ${esc(latest.appVersion)}: ${number(latest.count)} ${plural(latest.count, 'response')}` : 'None yet'],
    ['Average rating, latest version', latest?.avgRating != null ? Number(latest.avgRating).toFixed(1) : '—', latest ? `${number(latest.rated)} ${plural(latest.rated, 'rating')} on ${esc(latest.appVersion)}` : 'No ratings yet']
  ].map(([label, value, note]) => `<div class="owner-kpi"><span>${label}</span><strong>${value}</strong><small>${note}</small></div>`).join('');
}

// Stages take one hue, lighter to darker in order (the same ramp as the
// Trends funnels); a side branch stays grey. Values and shares are text.
function funnelHtml(steps, baseLabel, insight) {
  const base = steps[0].value;
  const max = Math.max(1, ...steps.map(step => step.value));
  const stages = steps.filter(step => !step.branch).length;
  let stage = -1;
  const row = step => {
    if (!step.branch) stage += 1;
    const tone = step.branch ? 'owner-funnel__bar--branch' : `trend-tone-${stages > 1 ? Math.round(stage * 4 / (stages - 1)) + 1 : 5}`;
    return `<div class="owner-funnel__row${step.branch ? ' owner-funnel__row--branch' : ''}" title="${esc(`${step.label}: ${step.value} (${percent(step.value, base)} of ${baseLabel})`)}">
      <span class="owner-funnel__label">${esc(step.label)}</span>
      <span class="owner-funnel__value">${number(step.value)}<small>${percent(step.value, base)}</small></span>
      <span class="owner-funnel__track"><span class="owner-funnel__bar ${tone}" style="width:${Math.min(100, Math.round(step.value / max * 100))}%"></span></span>
    </div>`;
  };
  return `${steps.map(row).join('')}${insight}`;
}

function renderFunnel(summary, days) {
  const rows = summary.eventTotals;
  const value = name => totalOf(rows, name);
  const opened = value('sync_guide_opened');
  const reached = value('sync_guide_step_3');
  const driveChosen = value('drive_connect_clicked');
  const joined = value('waitlist_joined');
  const steps = [
    { label: 'Opened “Sync on all my devices”', value: opened },
    { label: 'Reached step 2 (other device)', value: value('sync_guide_step_2') },
    { label: 'Finished the Google Drive guide', value: reached },
    { label: '↳ Chose “Set up Google Drive sync”', value: driveChosen, branch: true },
    { label: 'Opened the waitlist form', value: value('waitlist_form_opened') },
    { label: 'Joined the waitlist', value: joined }
  ];
  const insight = opened
    ? `<p class="owner-insight">Over the last ${days} days, <strong>${number(reached)}</strong> people saw the whole free Google Drive route. <strong>${number(driveChosen)}</strong> went on to set it up and <strong>${number(joined)}</strong> still joined the waitlist (${percent(joined, reached)}).</p>`
    : '<p class="owner-insight">No one has opened the sync guide in this period yet.</p>';
  $('[data-owner-funnel]').innerHTML = funnelHtml(steps, 'openings', insight);
}

function renderQuestions(summary) {
  const target = $('[data-owner-questions]');
  const caption = $('[data-owner-questions-caption]');
  const intro = 'Questions from the Contact page’s “Ask a question” form. Reply by email; delete on request.';
  if (summary.questionsUnavailable) {
    caption.textContent = intro;
    target.innerHTML = '<p class="owner-empty">The <code>team_requests</code> table, where questions are kept, does not exist yet. Apply <code>migrations/schema.sql</code> to the D1 database (see <code>docs/configuration.md</code>).</p>';
    return;
  }
  const rows = Array.isArray(summary.questions) ? summary.questions : [];
  const total = Number(summary.questionCount) || rows.length;
  caption.textContent = total > rows.length ? `Latest ${number(rows.length)} of ${number(total)} questions (export CSV for all). Reply by email; delete on request.` : intro;
  target.innerHTML = rows.length ? questionsTableHtml(rows, { when, number }) : '<p class="owner-empty">No questions yet.</p>';
}

function renderVersions(summary) {
  const rows = summary.feedbackByVersion;
  $('[data-owner-versions]').innerHTML = rows.length
    ? `<div class="owner-scroll"><table class="owner-table"><thead><tr><th>Version</th><th class="num">Responses</th><th class="num">Ratings</th><th>Average</th><th>Last</th></tr></thead><tbody>${rows.map(row => `<tr><td><b>${esc(row.appVersion)}</b></td><td class="num">${number(row.count)}</td><td class="num">${number(row.rated)}</td><td>${row.avgRating != null ? `${stars(Math.round(row.avgRating))} ${Number(row.avgRating).toFixed(1)}` : '—'}</td><td>${esc(when(row.lastAt))}</td></tr>`).join('')}</tbody></table></div>`
    : '<p class="owner-empty">No feedback yet.</p>';
  versionFilter.setItems([{ value: '', label: 'All versions' }, ...rows.map(row => ({ value: String(row.appVersion), label: String(row.appVersion) }))]);
}

async function renderFeedback() {
  const version = versionFilter.value;
  const { rows } = await jsonOf(await call(`admin/feedback${version ? `?version=${encodeURIComponent(version)}` : ''}`));
  $('[data-owner-feedback-caption]').textContent = `${rows.length} ${plural(rows.length, 'item')}${version ? ` for ${version}` : ''}`;
  $('[data-owner-feedback]').innerHTML = rows.length
    ? `<div class="owner-feedback-list">${rows.map(row => `<article class="owner-feedback"><div class="owner-feedback__meta"><b>${esc(row.appVersion)}</b>${stars(row.rating)}<span>${esc(row.kind)}</span><span>${esc(row.platform)}</span><span>${esc(when(row.createdAt))}</span>${row.email ? mailLink(row.email) : ''}<button class="text-button text-button--danger owner-feedback__delete" type="button" data-owner-delete-feedback="${Number(row.id)}">Delete</button></div>${row.message ? `<p>${esc(row.message)}</p>` : ''}</article>`).join('')}</div>`
    : '<p class="owner-empty">Nothing here yet.</p>';
}

function renderWaitlist(summary) {
  const rows = summary.waitlist;
  $('[data-owner-waitlist]').innerHTML = rows.length
    ? `<div class="owner-scroll"><table class="owner-table"><thead><tr><th>Email</th><th>Devices</th><th>Note</th><th>Version</th><th>Joined</th><th><span class="sr-only">Actions</span></th></tr></thead><tbody>${rows.map(row => `<tr><td>${esc(row.email)}</td><td>${esc(String(row.devices || '').split(',').filter(Boolean).join(', ') || '—')}</td><td>${esc(row.note || '')}</td><td>${esc(row.appVersion || '')}</td><td>${esc(when(row.createdAt))}</td><td><button class="text-button text-button--danger" type="button" data-owner-delete="${Number(row.id)}">Delete</button></td></tr>`).join('')}</tbody></table></div>`
    : '<p class="owner-empty">No sign-ups yet.</p>';
}

// Waitlist announcement (POST admin/waitlist/announce). The server sends
// oldest sign-ups first, up to the daily limit, and deletes each address it
// sent; this panel only explains, confirms and reports.
let announceState = { configured: false, testAvailable: false, count: 0, allowance: 0, limit: 100, perSend: 1000 };
let announceBusy = false;
const announceForm = $('[data-owner-announce]');

function prefillAnnouncement() {
  const planner = new URL('../', location.href).href;
  announceForm.elements.subject.value = 'Account sync is ready in Daily Planner';
  announceForm.elements.text.value = `Hi,\n\nYou asked us to email you once when Daily Planner could keep your plans in sync across your devices with an account. It is ready.\n\nOpen the planner and choose “Sync on all my devices” to turn it on:\n${planner}\n\nThank you for waiting,\nBen`;
}

function showAnnounceResult(message, isError = false) {
  const result = $('[data-owner-announce-result]');
  result.hidden = !message;
  result.textContent = message;
  result.classList.toggle('is-error', !!isError);
}

function hideAnnounceConfirm() {
  $('[data-owner-announce-confirm]').hidden = true;
  $('[data-owner-announce-actions]').hidden = false;
}

// One press sends at most this many (oldest first), within the daily limit.
const announceBatch = () => Math.min(announceState.count, announceState.allowance, announceState.perSend);

function renderAnnounce(summary) {
  const limit = Number(summary.emailDailyLimit ?? 100);
  const sentToday = Number(summary.emailsSentToday) || 0;
  const count = summary.waitlist.length;
  const allowance = Math.max(0, limit - sentToday);
  const perSend = Number(summary.emailsPerSend) || 1000;
  announceState = { configured: !!summary.emailConfigured, testAvailable: !!summary.emailTestAvailable, count, allowance, limit, perSend };
  const status = $('[data-owner-announce-status]');
  const send = $('[data-owner-announce-send]');
  const testButton = $('[data-owner-announce-test]');
  const batch = announceBatch();
  if (!announceState.configured) {
    status.innerHTML = 'Email isn’t set up yet. In Cloudflare Pages → Settings → Variables and secrets, add the secret <code>RESEND_API_KEY</code> and <code>EMAIL_FROM</code> (an address on a domain verified in Resend, see Setup), plus <code>OWNER_EMAIL</code> for test sends, then redeploy. Until then, export the CSV, email everyone yourself and delete the rows.';
  } else {
    const parts = [`Sent through Resend, oldest sign-ups first, at most ${number(limit)} emails per day (UTC; every email counts: tests and question notifications included).`];
    if (sentToday) parts.push(`${number(sentToday)} sent today.`);
    if (count > batch && batch > 0) parts.push(allowance > batch && count > perSend ? `Up to ${number(perSend)} per send: press Send again for the next ones.` : `${people(count - batch)} will have to wait until tomorrow.`);
    if (!announceState.testAvailable) parts.push('Set OWNER_EMAIL to send yourself a test.');
    status.textContent = parts.join(' ');
  }
  testButton.disabled = announceBusy || !announceState.testAvailable;
  send.disabled = announceBusy || !announceState.configured || !batch;
  send.textContent = !announceState.configured || count === 0 ? (count === 0 ? 'No one to email yet' : 'Send to everyone')
    : allowance === 0 ? 'Daily limit reached — send tomorrow'
      : `Send to ${people(batch)}`;
  if (send.disabled) hideAnnounceConfirm();
}

function readAnnouncement() {
  const subject = announceForm.elements.subject.value.trim();
  const text = announceForm.elements.text.value.trim();
  if (!subject || !text) {
    showAnnounceResult('Add a subject and a message first.', true);
    (subject ? announceForm.elements.text : announceForm.elements.subject).focus();
    return null;
  }
  return { subject, text };
}

function setAnnounceBusy(busy) {
  announceBusy = busy;
  announceForm.setAttribute('aria-busy', String(busy));
  [...announceForm.querySelectorAll('button')].forEach(button => { button.disabled = busy; });
  if (!busy) {
    $('[data-owner-announce-test]').disabled = !announceState.testAvailable;
    $('[data-owner-announce-send]').disabled = !announceState.configured || !announceBatch();
  }
}

function announceResultText(result) {
  const limit = number(result.dailyLimit ?? announceState.limit);
  if (!result.sent && result.limitReached) return `Nothing sent: today’s limit of ${limit} emails is used up. Send the rest tomorrow.`;
  if (!result.sent && !result.remaining) return 'No one is on the waitlist.';
  const head = `Sent to ${people(result.sent)}`;
  if (!result.remaining) return `${head} · the waitlist is now empty.`;
  return result.limitReached
    ? `${head} · ${number(result.remaining)} left — send the rest tomorrow (daily limit ${limit}).`
    : `${head} · ${number(result.remaining)} left — press Send again to continue.`;
}

async function sendAnnouncement(test) {
  const message = readAnnouncement();
  if (!message || announceBusy) return;
  hideAnnounceConfirm();
  setAnnounceBusy(true);
  showAnnounceResult(test ? 'Sending a test…' : 'Sending…');
  let reload = false;
  try {
    const result = await jsonOf(await call('admin/waitlist/announce', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...message, test }) }));
    if (test) showAnnounceResult('Test sent to your OWNER_EMAIL address. Check the inbox (and the spam folder).');
    else showAnnounceResult(`${announceResultText(result)}${result.error ? ` ${result.error}` : ''}`, !!result.error);
    reload = true;
  } catch (error) {
    if (error.kind === 'unauthorized') { setAnnounceBusy(false); handleError(error); return; }
    showAnnounceResult(error.kind === 'offline' ? 'The API could not be reached. Nothing was confirmed as sent; refresh before trying again.' : error.message, true);
    reload = !test;
  }
  setAnnounceBusy(false);
  if (reload) await load();
}

// ---- Shared bits ----------------------------------------------------------------

/** Copy text; the button says "Copied" for a moment. Falls back to a hidden textarea. */
async function copyText(text, button) {
  let copied = false;
  try {
    await navigator.clipboard.writeText(text);
    copied = true;
  } catch (_) {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.className = 'owner-offscreen';
    document.body.append(area);
    area.select();
    try { copied = document.execCommand('copy'); } catch (_) {}
    area.remove();
  }
  if (!button) return;
  if (!button.dataset.label) button.dataset.label = button.textContent;
  button.textContent = copied ? 'Copied' : 'Copy failed';
  clearTimeout(Number(button.dataset.timer));
  button.dataset.timer = String(setTimeout(() => { button.textContent = button.dataset.label; }, 1600));
}

async function sendJson(path, method, body) {
  return jsonOf(await call(path, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) }));
}

function failureText(error) {
  return error?.kind === 'offline' ? 'The API could not be reached. Check your connection and try again.' : (error?.message || 'Something went wrong.');
}

// ---- Anonymous usage counts (./usage-counts.js) -----------------------------------

// The header line: this browser is kept out of the counts (on sign-in and on every load), unless the owner counts it again.
function renderBrowser(counted) {
  const line = browserLine(counted);
  $('[data-owner-browser-title]').textContent = line.title;
  $('[data-owner-browser-detail]').textContent = line.detail;
  $('[data-owner-browser-count]').checked = counted;
  $('[data-owner-browser]').classList.toggle('is-counted', counted);
}

$('[data-owner-browser-count]').addEventListener('change', event => renderBrowser(countBrowser(event.target.checked)));

// Start fresh (the last card of Trends): the counts of the last summary, and what it said after the last action.
let freshCounts = null;
let freshResult = null;

function renderFresh() {
  $('[data-owner-fresh]').innerHTML = freshStartHtml(freshCounts, { number, result: freshResult });
}

/** Reads what is recorded now, says it in the dialog, and deletes it once RESET is typed (sent to the server too). */
async function startFresh(button) {
  button.disabled = true;
  let counts = null;
  try {
    counts = readCounts((await jsonOf(await call('admin/usage-counts'))).counts);
  } catch (error) {
    button.disabled = false;
    if (error.kind === 'unauthorized') { handleError(error); return; }
    freshResult = { text: failureText(error), error: true };
    renderFresh();
    $('[data-owner-fresh-result]')?.focus?.();
    return;
  }
  freshCounts = counts;
  if (!counts?.rows) { freshResult = null; renderFresh(); return; }
  button.disabled = false;
  if (!await openFreshStartDialog(counts, { number })) { button.focus(); return; }
  button.disabled = true;
  freshResult = { text: 'Deleting the counts…' };
  renderFresh();
  try {
    const answer = await sendJson('admin/usage-counts/reset', 'POST', { confirm: RESET_WORD });
    freshResult = { text: freshDoneText(answer, { number }) };
    await load({ series: true });
  } catch (error) {
    freshResult = { text: failureText(error), error: true };
    if (error.kind === 'unauthorized') { handleError(error); return; }
    renderFresh();
  }
  $('[data-owner-fresh-result]')?.focus?.();
}

$('[data-owner-fresh]').addEventListener('click', event => {
  const button = event.target.closest('[data-owner-fresh-start]');
  if (button && !button.disabled) startFresh(button);
});

// ---- Setup --------------------------------------------------------------------

const SETUP_STATES = { ok: 'Ready', warn: 'Check', missing: 'Not set' };

// Legal pages (legal/): their contact details and address come from build
// variables (LEGAL_VARIABLES: what each one fills). A value the pages can't
// use (legal/legal-details.js: not a plain email address, not a phone
// number) is left out of them, and said so here.
const LEGAL_VARIABLES = [
  ['SUPPORT_EMAIL', 'the contact address, in the legal notice, the terms and on the Contact page (“Prefer email? Write to …”), and for privacy questions unless <code>DAILY_PLANNER_PRIVACY_EMAIL</code> is set. Blank: the “Ask a question” form only.'],
  ['PRIVACY_EMAIL', 'optional, the address for privacy questions, in the privacy policy (data controller, your rights) and the cookies page.'],
  ['LEGAL_PHONE', 'recommended (French law asks an individual publisher for one): your phone number in international form, <code>+33</code> then the number without its 0, with no spaces (e.g. <code>+33199001234</code>). The legal notice shows it as people of that country write it (<code>+33 1 99 00 12 34</code>) in a Phone row, as a link that dials it.'],
  ['LEGAL_ADDRESS', 'the postal address, in the legal notice and the privacy policy.'],
  ['LEGAL_REGISTRATION', 'optional, a registration or VAT number, in the legal notice and the privacy policy.']
];

/**
 * A legal build variable's state in the Setup card: “set” (the phone: “set,
 * shown as …”; an address typed “<…>” or “Name <…>”: “set, read as …”),
 * “blank”, or “set, but not used: …”.
 */
function legalVariableState(key) {
  const problem = legalValueProblem(key, APP_CONFIG[key]);
  if (problem) return `set, but not used: ${problem}`;
  const value = String(APP_CONFIG[key] || '').trim();
  if (!value) return 'blank';
  if (key === 'LEGAL_PHONE') return `set, shown as ${esc(legalDetails(APP_CONFIG).phone)}`;
  const email = key.endsWith('_EMAIL') ? legalEmail(value) : '';
  return email && email !== value ? `set, read as ${esc(email)}` : 'set';
}

function legalItem() {
  const details = legalDetails(APP_CONFIG);
  const unusable = key => !!legalValueProblem(key, APP_CONFIG[key]);
  const missing = [['email', 'SUPPORT_EMAIL', 'contact address'], ['address', 'LEGAL_ADDRESS', 'postal address']].filter(([field]) => !details[field]);
  const variables = LEGAL_VARIABLES.map(([key, what]) => `<p><code>DAILY_PLANNER_${key}</code> (${legalVariableState(key)}): ${what}</p>`).join('');
  const fix = LEGAL_VARIABLES.some(([key]) => unusable(key)) ? ' A value marked “not used” is left out of the pages until you correct it.' : '';
  if (!missing.length) {
    const privacy = details.privacyEmail ? `, privacy questions to ${esc(details.privacyEmail)}` : '';
    return { key: 'legal', title: 'Legal pages', html: `<p>The legal notice shows your contact (${esc(details.email)}${privacy}) and postal address.${fix} Build variables (type Text; redeploy after a change):</p>${variables}` };
  }
  const names = missing.map(([, key]) => `<code>DAILY_PLANNER_${key}</code>${unusable(key) ? ' to a plain email address' : ''}`).join(' and ');
  const what = missing.map(([, , label]) => label).join(' or ');
  return {
    key: 'legal',
    title: 'Legal pages',
    html: `<p>Set the build variable${missing.length > 1 ? 's' : ''} ${names} (Settings → Variables and Secrets, type Text), then redeploy. Until then the legal pages show no ${what}${details.email ? '' : ' and point to the “Ask a question” form'}.${fix} What each variable fills:</p>${variables}`
  };
}

// The release the API was deployed with, and whether this page is the same one.
function versionItem(summary) {
  const server = String(summary.version || '').trim();
  const page = esc(APP_VERSION);
  const order = compareVersions(server, APP_VERSION);
  if (Number.isNaN(order)) return { key: 'version', title: 'Deployed version', label: 'Unknown', html: `<p>This API does not report its version yet (it is older than 1.25.0): redeploy it. This page is version ${page}.</p>` };
  if (order === 0) return { key: 'version', title: `Deployed version ${server}`, label: 'Up to date', html: '<p>This page is the deployed dashboard.</p>' };
  return {
    key: 'version',
    title: `Deployed version ${server}`,
    label: 'Reload needed',
    html: `<p>This page is version ${page}, from ${order > 0 ? 'an older' : 'a different'} deployment kept in a cache. Use Reload at the top of the page. If it stays, purge Cloudflare’s cache: your domain → Caching → Configuration → Purge Everything.</p>`
  };
}

// Each item's state comes from setupChecks() (./attention.js), which also
// feeds “Needs your attention”, so the two always agree.
function setupItems(summary) {
  const setup = summary.setup;
  const base = setup.publicBaseUrl || 'https://planner.bemorin.com';
  const states = new Map(setupChecks(summary, { config: APP_CONFIG, pageVersion: APP_VERSION }).map(check => [check.key, check.state]));
  const items = [versionItem(summary)];
  const email = setup.email || {};
  items.push(email.configured
    ? { key: 'email', title: 'Email (Resend)', html: `<p>Sending as ${esc(email.from)}, at most ${number(email.dailyLimit)} emails a day (<code>EMAIL_DAILY_LIMIT</code>; Resend’s free plan allows 100 a day, 3,000 a month).</p>` }
    : {
      key: 'email',
      title: 'Email (Resend)',
      html: `<p>Set the secret <code>RESEND_API_KEY</code>${email.apiKeySet ? ' (set)' : ''} and <code>EMAIL_FROM</code>${email.fromSet ? ' (set, but not a valid address)' : ''}, e.g. <code>Daily Planner &lt;hello@example.com&gt;</code>, then redeploy.</p>
        <p>In Resend → Domains, add your domain. Resend lists DNS records (DKIM and SPF, plus MX for bounces): add each one in Cloudflare → your domain → DNS as “DNS only”, then wait until Resend shows “Verified”. Create the API key with “Sending access” only.</p>`
    });
  items.push(email.ownerEmail
    ? { key: 'owner-email', title: 'Owner email', html: `<p>Question notifications and test sends go to ${esc(email.ownerEmail)}.</p>` }
    : { key: 'owner-email', title: 'Owner email', html: '<p>Set <code>OWNER_EMAIL</code> to get question notifications and test sends.</p>' });
  items.push({ key: 'links', title: 'Production address', html: `<p>${esc(base)}${setup.publicBaseUrlSet ? ' (<code>PUBLIC_BASE_URL</code>)' : ', the default. Set <code>PUBLIC_BASE_URL</code> on any other deployment'}.</p>` });
  items.push(legalItem());
  const missingTables = [summary.questionsUnavailable && 'questions', summary.reviewsUnavailable && 'reviews'].filter(Boolean);
  items.push(missingTables.length
    ? { key: 'database', title: 'Database', html: `<p>Apply <code>migrations/schema.sql</code> to the D1 database: ${missingTables.join(' and ')} can’t be read until then.</p>` }
    : { key: 'database', title: 'Database', html: '<p>All tables are in place.</p>' });
  items.push(setup.twoFactor
    ? { key: 'sign-in', title: 'Owner sign-in', html: '<p>Two-factor sign-in is on.</p>' }
    : { key: 'sign-in', title: 'Owner sign-in', html: '<p>Only the admin token protects this page. Run <code>npm run admin:secret</code> and set <code>ADMIN_TOTP_SECRET</code> to also require an authenticator code.</p>' });
  return items.map(item => ({ ...item, state: states.get(item.key) || 'ok' }));
}

// ---- Reviews -------------------------------------------------------------------

const quoteOf = row => `“${String(row.text || '').trim()}” — ${String(row.name || '').trim() || 'Anonymous'}`;

function reviewHtml(row) {
  const name = String(row.name || '').trim();
  return `<article class="owner-review" data-owner-attn="review:${Number(row.id)}">
    <div class="owner-review__meta">${stars(row.rating)}<span>${esc(row.appVersion)}</span><span>${esc(day(row.createdAt))}</span></div>
    <blockquote class="owner-review__text">${esc(row.text)}</blockquote>
    <p class="owner-review__name">${name ? `— ${esc(name)}` : '<span>Anonymous</span>'}</p>
    <div class="owner-review__actions"><button class="text-button" type="button" data-owner-copy="${esc(quoteOf(row))}">Copy as quote</button><button class="text-button text-button--danger" type="button" data-owner-delete-review="${Number(row.id)}" data-owner-review-name="${esc(name || 'Anonymous')}">Delete</button></div>
  </article>`;
}

function renderReviews(summary) {
  const target = $('[data-owner-reviews]');
  const caption = $('[data-owner-reviews-caption]');
  if (summary.reviewsUnavailable) {
    caption.textContent = 'Reviews people agreed to have quoted.';
    target.innerHTML = '<p class="owner-empty">The <code>reviews</code> table does not exist yet. Apply <code>migrations/schema.sql</code> to the D1 database.</p>';
    return;
  }
  const rows = Array.isArray(summary.reviews) ? summary.reviews : [];
  caption.textContent = rows.length
    ? `${rows.length === 50 ? 'The newest 50' : `${number(rows.length)} ${plural(rows.length, 'review')}`}, sent from the planner with permission to quote them. Delete any you would not quote.`
    : 'Reviews people agreed to have quoted.';
  target.innerHTML = rows.length ? `<div class="owner-reviews">${rows.map(reviewHtml).join('')}</div>` : '<p class="owner-empty">No reviews yet.</p>';
}

// ---- Needs your attention -------------------------------------------------------

// Lines shown before “Show N more”.
const ATTENTION_SHOWN = 6;
const ATTENTION_ICONS = {
  question: '<rect x="3.5" y="5.5" width="17" height="13" rx="2.5"/><path d="m4.5 7.5 7.5 5.5 7.5-5.5"/>',
  setup: '<path d="M4 7h9"/><path d="M17 7h3"/><path d="M4 17h3"/><path d="M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  version: '<path d="M20 12a8 8 0 1 1-2.34-5.66"/><path d="M20 4.5v4h-4"/>',
  review: '<path d="m12 4.5 2.3 4.7 5.2.8-3.8 3.6.9 5.1-4.6-2.4-4.6 2.4.9-5.1-3.8-3.6 5.2-.8z"/>',
  clear: '<circle cx="12" cy="12" r="8.5"/><path d="m8.4 12.3 2.5 2.5 4.7-5"/>'
};
const ATTENTION_ARROW = '<svg class="owner-attention__arrow" viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" focusable="false"><path d="M5 12h14"/><path d="m13 6 6 6-6 6"/></svg>';
// The mark on a row: “!” to act on, “i” worth a look. A shape and words, not only a colour.
const ATTENTION_FLAGS = {
  act: '<svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true" focusable="false"><path d="M12 6.5v7"/><path d="M12 17.5v.01"/></svg>',
  look: '<svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true" focusable="false"><path d="M12 10.5v7"/><path d="M12 6.5v.01"/></svg>'
};
const ATTENTION_TONE_WORDS = { urgent: 'Urgent', warn: 'To do', info: 'Worth a look' };
// The card each section points to, found from the container it renders into.
const ATTENTION_CARDS = { questions: '[data-owner-questions]', setup: '[data-owner-setup]', reviews: '[data-owner-reviews]' };
const ATTENTION_TONE_CLASSES = ['is-attention', 'is-attn-urgent', 'is-attn-warn', 'is-attn-info'];
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
let attentionExpanded = false;

const attentionIcon = name => `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" focusable="false">${ATTENTION_ICONS[name] || ATTENTION_ICONS.setup}</svg>`;
const exactTime = iso => (iso ? new Date(iso).toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
const clockTime = iso => new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });

function attentionCard(section) {
  const card = $(ATTENTION_CARDS[section])?.closest('.owner-card');
  if (card && !card.id) card.id = `owner-${section}-card`;
  return card;
}

function attentionFlag(tone) {
  const act = tone !== 'info';
  const words = act ? 'Needs your attention' : 'Worth a look';
  return `<span class="owner-attn-flag" data-owner-attn-flag title="${words}">${ATTENTION_FLAGS[act ? 'act' : 'look']}<span class="sr-only">${words}. </span></span>`;
}

/** Cards get an alert style and a count; their rows a tint, a left bar and a “!” (or “i”) mark. */
function markAttention(items) {
  const { sections, rows } = attentionBySection(items);
  Object.keys(ATTENTION_CARDS).forEach(section => {
    const card = attentionCard(section);
    if (!card) return;
    card.classList.remove(...ATTENTION_TONE_CLASSES);
    $('[data-owner-attn-count]', card)?.remove();
    const found = sections[section];
    if (!found) return;
    card.classList.add('is-attention', `is-attn-${found.tone}`);
    const label = `${found.count} ${found.count === 1 ? 'needs' : 'need'} your attention`;
    $('h2', card)?.insertAdjacentHTML('beforeend', `<span class="owner-attn-count" data-owner-attn-count title="${label}">${number(found.count)}<span class="sr-only"> ${label}</span></span>`);
  });
  document.querySelectorAll('[data-owner-attn]').forEach(element => {
    element.classList.remove(...ATTENTION_TONE_CLASSES);
    element.querySelectorAll('[data-owner-attn-flag]').forEach(flag => flag.remove());
    const tone = rows.get(element.dataset.ownerAttn);
    if (!tone) return;
    element.classList.add('is-attention', `is-attn-${tone}`);
    // Setup items already say “Check” or “Not set” in words.
    const place = element.matches('tr') ? element.cells[0] : element.matches('.owner-review') ? $('.owner-review__meta', element) : null;
    place?.insertAdjacentHTML('afterbegin', attentionFlag(tone));
  });
  // A table with marks keeps its first column aligned on the rows without one.
  document.querySelectorAll('.owner-table').forEach(table => table.classList.toggle('has-attention', !!$('tr.is-attention', table)));
}

function attentionLine(item, index, summary, now) {
  const setup = item.when === 'setup';
  const label = attentionWhen(item, now);
  const title = setup ? `A setting of this deployment: it has no date. Checked ${exactTime(summary.generatedAt)}.` : `Since ${exactTime(item.at)}`;
  const time = setup || !label ? `<span class="owner-attention__when" title="${esc(title)}">${esc(label)}</span>`
    : `<time class="owner-attention__when" datetime="${esc(item.at)}" title="${esc(title)}">${esc(label)}</time>`;
  const card = attentionCard(item.section);
  return `<li class="owner-attention__item is-attn-${item.tone}"${index >= ATTENTION_SHOWN && !attentionExpanded ? ' hidden' : ''}>
    <a class="owner-attention__link" href="#${esc(card?.id || '')}" data-owner-attn-go="${esc(item.rows[0])}" data-owner-attn-section="${esc(item.section)}">
      <span class="owner-attention__icon" aria-hidden="true">${attentionIcon(item.icon)}</span>
      <span class="owner-attention__text"><span class="owner-attention__title"><span class="sr-only">${ATTENTION_TONE_WORDS[item.tone]}: </span>${esc(item.text)}</span>${item.detail ? `<span class="owner-attention__detail">${esc(item.detail)}</span>` : ''}</span>
      ${time}
      <span class="owner-attention__go">Go to ${esc(ATTENTION_SECTIONS[item.section])}${ATTENTION_ARROW}</span>
    </a>
  </li>`;
}

function renderAttention(summary) {
  const items = buildAttention(summary, { config: APP_CONFIG, pageVersion: APP_VERSION });
  markAttention(items);
  const panel = $('[data-owner-attention]');
  if (!panel) return;
  const now = Date.parse(summary.generatedAt) || Date.now();
  const checked = `<p class="owner-attention__checked">Checked <time datetime="${esc(summary.generatedAt)}" title="${esc(exactTime(summary.generatedAt))}">${esc(clockTime(now))}</time></p>`;
  panel.classList.remove('is-clear', ...ATTENTION_TONE_CLASSES);
  // Sorted most urgent first: the first line sets the panel's tone.
  panel.classList.add(items.length ? `is-attn-${items[0].tone}` : 'is-clear');
  if (!items.length) {
    panel.innerHTML = `<div class="owner-attention__clear">
      <span class="owner-attention__icon" aria-hidden="true">${attentionIcon('clear')}</span>
      <div class="owner-attention__text"><h2 id="owner-attention-title">All clear</h2><p>Nothing needs your attention. Questions, Setup and reviews were checked.</p></div>
      ${checked}
    </div>`;
    return;
  }
  const hidden = Math.max(0, items.length - ATTENTION_SHOWN);
  const note = attentionNote(items);
  panel.innerHTML = `<div class="owner-attention__head">
      <h2 id="owner-attention-title">Needs your attention <span class="owner-attn-count">${number(items.length)}</span></h2>
      ${checked}
    </div>
    <ol class="owner-attention__list" id="owner-attention-list">${items.map((item, index) => attentionLine(item, index, summary, now)).join('')}</ol>
    ${hidden || note ? `<div class="owner-attention__foot">${hidden ? `<button class="text-button owner-attention__more" type="button" data-owner-attention-more aria-controls="owner-attention-list" aria-expanded="${attentionExpanded}">${attentionExpanded ? 'Show fewer' : `Show ${number(hidden)} more`}</button>` : ''}${note ? `<p class="owner-attention__note">${esc(note)}</p>` : ''}</div>` : ''}`;
}

function clearAttention() {
  markAttention([]);
  const panel = $('[data-owner-attention]');
  if (!panel) return;
  panel.innerHTML = '';
  panel.classList.remove('is-clear', ...ATTENTION_TONE_CLASSES);
}

/** Scroll to the row (or else the card), focus it and outline it until it loses focus. */
function locateAttention(rowKey, section) {
  const card = attentionCard(section);
  const target = [...document.querySelectorAll('[data-owner-attn]')].find(element => element.dataset.ownerAttn === rowKey && !element.closest('[hidden]')) || (card && $('h2', card));
  if (!target) return;
  document.querySelectorAll('.is-located').forEach(element => element.classList.remove('is-located'));
  if (!target.hasAttribute('tabindex')) target.setAttribute('tabindex', '-1');
  target.classList.add('is-located');
  // A row taller than most of the screen (a narrow phone) shows from its top.
  const tall = target.getBoundingClientRect().height > innerHeight * 0.6;
  target.scrollIntoView({ block: tall ? 'start' : 'center', behavior: reduceMotion.matches ? 'auto' : 'smooth' });
  target.focus({ preventScroll: true });
  target.addEventListener('blur', () => target.classList.remove('is-located'), { once: true });
}

$('[data-owner-attention]')?.addEventListener('click', event => {
  const more = event.target.closest('[data-owner-attention-more]');
  if (more) {
    attentionExpanded = !attentionExpanded;
    const items = [...document.querySelectorAll('.owner-attention__item')];
    items.forEach((item, index) => { item.hidden = index >= ATTENTION_SHOWN && !attentionExpanded; });
    more.setAttribute('aria-expanded', String(attentionExpanded));
    more.textContent = attentionExpanded ? 'Show fewer' : `Show ${number(items.length - ATTENTION_SHOWN)} more`;
    if (attentionExpanded) $('a', items[ATTENTION_SHOWN])?.focus();
    return;
  }
  const link = event.target.closest('[data-owner-attn-go]');
  if (!link) return;
  event.preventDefault();
  locateAttention(link.dataset.ownerAttnGo, link.dataset.ownerAttnSection);
});

// ---- Wide tables -----------------------------------------------------------------

// A table wider than its card (a phone) scrolls sideways: while it does, its
// scroll area takes keyboard focus as a region named after its card and the
// list above it in that card (“Questions table”, src/lib/dom.js). Checked again whenever the page draws something new
// or the window changes size.
const headingText = heading => {
  if (!heading) return '';
  const copy = heading.cloneNode(true);
  copy.querySelectorAll('[data-owner-attn-count], .sr-only').forEach(node => node.remove());
  return copy.textContent.replace(/\s+/g, ' ').trim();
};

function scrollRegionName(element) {
  const card = element.closest('.owner-card');
  const title = headingText(card && $('h2', card));
  // A list's own heading, when one comes before the table in its card.
  const before = card ? [...card.querySelectorAll('.owner-list > h3')].filter(heading => heading.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING).at(-1) : null;
  const list = headingText(before);
  // “… table”: never the same name as the card, itself a region named after its heading.
  return `${[title, list].filter(Boolean).join(': ') || 'Wide'} table`;
}

let scrollRegionsFrame = 0;
function syncScrollRegions() {
  cancelAnimationFrame(scrollRegionsFrame);
  scrollRegionsFrame = requestAnimationFrame(() => {
    const names = new Map();
    document.querySelectorAll('.owner-scroll').forEach(element => {
      const name = overflows(element) ? scrollRegionName(element) : '';
      const count = name ? (names.get(name) || 0) + 1 : 0;
      if (name) names.set(name, count);
      syncScrollRegion(element, count > 1 ? `${name} (${count})` : name);
    });
  });
}
new MutationObserver(syncScrollRegions).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
addEventListener('resize', syncScrollRegions);

// ---- Version -------------------------------------------------------------------

// A reload for another version arrives as ?v=<version>: read it, then put the
// plain address back.
const reloadMark = readReloadMark(location.href);
if (reloadMark.cleanUrl !== location.href) {
  try { history.replaceState(history.state, '', reloadMark.cleanUrl); } catch (_) {}
}

// “Version X” in the header and the banner's live region, made here so they
// also appear when an older index.html comes from a cache.
function mountVersion() {
  const eyebrow = $('.owner-head .modal__eyebrow');
  if (eyebrow && !$('[data-owner-version]')) eyebrow.insertAdjacentHTML('beforeend', `<span class="owner-version" data-owner-version> · Version ${esc(APP_VERSION)}</span>`);
  if ($('[data-owner-update]')) return;
  const banner = document.createElement('div');
  banner.className = 'owner-update';
  banner.dataset.ownerUpdate = '';
  banner.setAttribute('role', 'status');
  banner.hidden = true;
  banner.addEventListener('click', event => {
    const button = event.target.closest('[data-owner-update-reload]');
    if (button) reloadDashboard(button);
  });
  $('.owner-shell').prepend(banner);
}

function renderVersion(summary) {
  const banner = $('[data-owner-update]');
  if (!banner) return;
  const server = String(summary.version || '').trim();
  const notice = versionNotice(APP_VERSION, server, { retried: !!reloadMark.version && reloadMark.version === server });
  banner.hidden = !notice;
  banner.dataset.version = notice ? notice.server : '';
  banner.innerHTML = notice
    ? `<span class="owner-update__icon" aria-hidden="true">${RELOAD_SVG}</span>
      <div class="owner-update__body"><p class="owner-update__title"><b>${esc(notice.title)}</b> ${esc(notice.action)}</p><p>${esc(notice.detail)}</p>${notice.hint ? `<p class="owner-update__hint">${esc(notice.hint)}</p>` : ''}</div>
      <button class="primary-button" type="button" data-owner-update-reload>Reload</button>`
    : '';
}

// Fetch every file of the page again past the browser cache, then open the
// page at a new address (?v=), which no cached copy can answer.
async function reloadDashboard(button) {
  const version = $('[data-owner-update]')?.dataset.version;
  if (!version) return;
  button.disabled = true;
  button.textContent = 'Reloading…';
  await Promise.allSettled(DASHBOARD_FILES.map(path => fetch(new URL(path, import.meta.url), { cache: 'reload' })));
  location.replace(reloadUrl(location.href, version));
}

function renderSetup(summary) {
  const target = $('[data-owner-setup]');
  if (!summary.setup) {
    target.innerHTML = '<li class="owner-empty">This API does not report its setup yet. Redeploy it.</li>';
    return;
  }
  target.innerHTML = setupItems(summary).map(item => `<li class="owner-setup__item is-${item.state}" data-owner-attn="setup:${esc(item.key)}"><span class="owner-setup__mark" aria-hidden="true"></span><div class="owner-setup__body"><p class="owner-setup__title"><b>${esc(item.title)}</b><span>${esc(item.label || SETUP_STATES[item.state])}</span></p>${item.html}</div></li>`).join('');
}

document.addEventListener('click', event => {
  const button = event.target.closest('[data-owner-copy]');
  if (button) copyText(button.dataset.ownerCopy, button);
});

function renderSignals(summary) {
  const labels = {
    onboarding_completed: 'Finished onboarding',
    install_modal_opened: 'Opened “Install the app”',
    install_accepted: 'Installed from the prompt',
    feedback_prompt_shown: 'Saw the “rate this version” card',
    feedback_opened: 'Opened feedback',
    feedback_sent: 'Sent feedback',
    trophy_unlocked: 'Days with a trophy unlocked',
    landing_viewed: 'Landing page visits',
    landing_cta_app: 'Landing → opened the planner',
    year_plan_completed: 'Finished planning a year',
    quarter_review_completed: 'Finished a quarter check-in',
    year_review_opened: 'Opened a year in review',
    share_image_created: 'Made a share image (week or year)',
    review_sent: 'Left a review that may be quoted'
  };
  const versions = [...new Set(summary.eventTotals.map(row => row.appVersion))].sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  const body = Object.entries(labels).map(([name, label]) => `<tr><td>${esc(label)}</td><td class="num"><b>${number(totalOf(summary.eventTotals, name))}</b></td>${versions.map(version => `<td class="num">${number(summary.eventTotals.filter(row => row.name === name && row.appVersion === version).reduce((sum, row) => sum + row.count, 0))}</td>`).join('')}</tr>`).join('');
  $('[data-owner-signals]').innerHTML = `<div class="owner-scroll"><table class="owner-table"><thead><tr><th>Signal</th><th class="num">Total</th>${versions.map(version => `<th class="num">${esc(version)}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table></div>`;
}

// The daily series behind Trends: { series } or { message } (an older API has no
// admin/series), or { error } when the session has ended.
async function fetchSeries() {
  const { from, to } = seriesWindow(dayOf(new Date()));
  try {
    const series = normalizeSeries(await jsonOf(await call(`admin/series?from=${from}&to=${to}`)));
    return series ? { series } : { message: UPDATE_API_MESSAGE };
  } catch (error) {
    if (error.kind === 'unauthorized') return { error };
    if (error.kind === 'offline' || /HTTP 40[45]\)/.test(error.message)) return { message: UPDATE_API_MESSAGE };
    return { message: `Trends could not be loaded. ${failureText(error)}` };
  }
}

async function showSeries(pending, forSession) {
  const result = await pending;
  if (!session || session.session !== forSession) return;
  if (result.error) { handleError(result.error); return; }
  if (result.series) {
    seriesSession = forSession;
    trends.show(result.series);
  } else {
    trends.unavailable(result.message);
  }
}

async function load({ series: refreshSeries = false } = {}) {
  if (!session) { await start(); return; }
  const days = Number(periodPicker.value) || 90;
  const forSession = session.session;
  const pending = refreshSeries === true || seriesSession !== forSession ? fetchSeries() : null;
  if (pending) trends.refreshing();
  try {
    const summary = await jsonOf(await call(`admin/summary?days=${days}`));
    if (!session) return;
    setNotice('');
    show('dashboard');
    $('[data-owner-session]').textContent = `Signed in until ${untilLabel(session.expiresAt)}`;
    $('[data-owner-sub]').textContent = `Private. Updated ${when(summary.generatedAt)} · counts since ${summary.sinceDay}.`;
    // Signed in: this browser stays out of the anonymous counts (unless the owner counts it again).
    renderBrowser(keepBrowserOut());
    renderVersion(summary);
    renderKpis(summary, days);
    renderFunnel(summary, days);
    renderQuestions(summary);
    renderSetup(summary);
    freshCounts = readCounts(summary.usageCounts);
    renderFresh();
    renderWaitlist(summary);
    renderAnnounce(summary);
    renderVersions(summary);
    renderSignals(summary);
    renderReviews(summary);
    // Last: it marks the rows the cards above have just rendered.
    renderAttention(summary);
    if (pending) await showSeries(pending, forSession);
    await renderFeedback();
  } catch (error) {
    handleError(error);
    if (pending && session) await showSeries(pending, forSession);
  }
}

async function start() {
  setNotice('');
  show('checking');
  if (session) { scheduleExpiry(); await load(); return; }
  try {
    await probe();
    showLogin();
  } catch (error) {
    handleError(error);
  }
}

async function download(path, filename) {
  try {
    const response = await call(path);
    const url = URL.createObjectURL(await response.blob());
    Object.assign(document.createElement('a'), { href: url, download: filename }).click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error) {
    handleError(error);
  }
}

async function remove(path) {
  try {
    await call(path, { method: 'DELETE' });
  } catch (error) {
    // "failed" here is usually a 404: already removed. Just refresh.
    if (error.kind !== 'failed') { handleError(error); return; }
  }
  await load();
}

const loginForm = $('[data-owner-login]');
const codeInput = $('input[name="code"]', loginForm);
codeInput.addEventListener('input', () => {
  const digits = codeInput.value.replace(/\D/g, '').slice(0, 6);
  if (digits !== codeInput.value) codeInput.value = digits;
});

loginForm.addEventListener('submit', async event => {
  event.preventDefault();
  const data = new FormData(loginForm);
  const token = String(data.get('token') || '').trim();
  const code = String(data.get('code') || '').replace(/\D/g, '');
  const error = $('[data-owner-error]');
  if (!token) { showLogin('Enter the admin token.'); return; }
  if (code && code.length !== 6) { showLogin('The authenticator code has 6 digits.'); return; }
  const submit = $('[data-owner-submit]');
  submit.disabled = true;
  submit.textContent = 'Signing in…';
  error.hidden = true;
  try {
    const body = await jsonOf(await call('admin/session', { auth: false, method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token, code }) }));
    const expiresAt = Date.parse(body?.expiresAt);
    if (typeof body?.session !== 'string' || !Number.isFinite(expiresAt)) throw new ApiError('failed', 'The API answered without a session.');
    loginForm.reset();
    saveSession({ session: body.session, expiresAt });
    // The owner's browser is kept out of the anonymous counts from the moment they sign in.
    keepBrowserOut();
    await load();
  } catch (failure) {
    if (failure.kind === 'unauthorized') showLogin(SIGN_IN_FAILED_MESSAGE);
    else if (failure.kind === 'failed') showLogin(failure.message);
    else handleError(failure);
  } finally {
    submit.disabled = false;
    submit.textContent = 'Open dashboard';
  }
});

const periodPicker = createDropdown($('[data-owner-days]'), { items: PERIODS, value: '90', onChange: () => load() });
const versionFilter = createDropdown($('[data-owner-version-filter]'), { items: [{ value: '', label: 'All versions' }], value: '', onChange: () => renderFeedback().catch(handleError) });

$('[data-owner-refresh]').addEventListener('click', () => load({ series: true }));
$('[data-owner-retry]').addEventListener('click', start);
$('[data-owner-signout]').addEventListener('click', () => signOut());
$('[data-owner-waitlist-csv]').addEventListener('click', event => { event.preventDefault(); download('admin/waitlist?format=csv', 'daily-planner-waitlist.csv'); });
$('[data-owner-questions-csv]').addEventListener('click', event => { event.preventDefault(); download('admin/questions?format=csv', 'daily-planner-questions.csv'); });
$('[data-owner-feedback-csv]').addEventListener('click', event => {
  event.preventDefault();
  const version = versionFilter.value;
  download(`admin/feedback?format=csv${version ? `&version=${encodeURIComponent(version)}` : ''}`, 'daily-planner-feedback.csv');
});
$('[data-owner-waitlist]').addEventListener('click', event => {
  const button = event.target.closest('[data-owner-delete]');
  if (!button) return;
  const row = button.closest('tr');
  if (!window.confirm(`Delete ${row?.cells[0]?.textContent || 'this sign-up'} from the waitlist? This cannot be undone.`)) return;
  remove(`admin/waitlist/${button.dataset.ownerDelete}`);
});
$('[data-owner-questions]').addEventListener('click', event => {
  const button = event.target.closest('[data-owner-delete-question]');
  if (!button) return;
  const row = button.closest('tr');
  if (!window.confirm(`Delete the question from ${row?.cells[1]?.textContent || 'this person'}? This cannot be undone.`)) return;
  remove(`admin/questions/${button.dataset.ownerDeleteQuestion}`);
});
$('[data-owner-reviews]').addEventListener('click', event => {
  const button = event.target.closest('[data-owner-delete-review]');
  if (!button) return;
  if (!window.confirm(`Delete the review from ${button.dataset.ownerReviewName || 'this person'}? It can no longer be quoted. This cannot be undone.`)) return;
  remove(`admin/reviews/${button.dataset.ownerDeleteReview}`);
});
$('[data-owner-feedback]').addEventListener('click', event => {
  const button = event.target.closest('[data-owner-delete-feedback]');
  if (!button) return;
  if (!window.confirm('Delete this feedback? This cannot be undone.')) return;
  remove(`admin/feedback/${button.dataset.ownerDeleteFeedback}`);
});

announceForm.addEventListener('submit', event => event.preventDefault());
announceForm.addEventListener('input', () => { if (!$('[data-owner-announce-confirm]').hidden) hideAnnounceConfirm(); });
$('[data-owner-announce-test]').addEventListener('click', () => sendAnnouncement(true));
$('[data-owner-announce-send]').addEventListener('click', () => {
  const message = readAnnouncement();
  if (!message) return;
  const batch = announceBatch();
  const rest = announceState.count - batch;
  $('[data-owner-announce-confirm-text]').textContent = `Send “${message.subject}” to ${people(batch)} now? Each address is deleted as soon as Resend accepts its email, so this can’t be undone.${rest > 0 ? ` The other ${people(rest)} stay on the list for ${announceState.allowance > batch ? 'the next send' : 'tomorrow'}.` : ''}`;
  $('[data-owner-announce-confirm-send]').textContent = `Yes, send to ${people(batch)}`;
  showAnnounceResult('');
  $('[data-owner-announce-actions]').hidden = true;
  $('[data-owner-announce-confirm]').hidden = false;
  $('[data-owner-announce-cancel]').focus();
});
$('[data-owner-announce-cancel]').addEventListener('click', () => { hideAnnounceConfirm(); $('[data-owner-announce-send]').focus(); });
$('[data-owner-announce-confirm-send]').addEventListener('click', () => sendAnnouncement(false));
prefillAnnouncement();
mountVersion();

start();
