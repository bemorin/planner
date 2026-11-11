import { APP_VERSION, PLANNER_API_URL } from '../config.js';

/**
 * Client for the optional owner API: feedback, the account-sync waitlist and
 * anonymous counts.
 *
 * When PLANNER_API_URL is blank — the default in public source — nothing here
 * makes a network request. Counts carry only an allow-listed event name and the
 * app version: no identifiers, no planner content — and none at all on a
 * device where the person switched them off in the Privacy notice.
 */

export const plannerApiEnabled = () => !!PLANNER_API_URL;

/** Per-device choice ('off' stops counts on this browser). Waitlist and feedback are unaffected. */
export const USAGE_COUNTS_KEY = 'daily-planner-ui:usage-counts';

/**
 * Every moment this copy may count, in the plain words the Privacy notice
 * shows. trackEvent() sends nothing else, so the notice cannot drift from the
 * code (a unit test checks every trackEvent call is listed here).
 */
export const COUNTED_EVENTS = Object.freeze([
  ['onboarding_completed', 'finished setup'],
  ['install_modal_opened', 'opened the install instructions'],
  ['install_accepted', 'installed the app'],
  ['sync_guide_opened', 'opened the sync guide'],
  ['sync_guide_step_2', 'reached step 2 of the sync guide'],
  ['sync_guide_step_3', 'reached step 3 of the sync guide'],
  ['drive_connect_clicked', 'chose to set up personal sync from the sync guide'],
  ['waitlist_form_opened', 'opened the account-sync waitlist'],
  ['waitlist_joined', 'joined that waitlist'],
  ['feedback_prompt_shown', 'was asked how a version is working'],
  ['feedback_opened', 'opened the feedback form'],
  ['feedback_sent', 'sent feedback'],
  ['trophy_unlocked', 'unlocked a trophy'],
  ['year_plan_completed', 'finished planning a year'],
  ['quarter_review_completed', 'finished a quarter check-in'],
  ['year_review_opened', 'opened a year in review'],
  ['review_sent', 'left a review that may be quoted'],
  ['share_image_created', 'made an image of their week or year to share'],
  // Usage, counted at most once per day, week or month on a device (see
  // trackOncePer): how many devices use the planner, and which parts of it.
  ['app_active_day', 'opened the planner on a day'],
  ['app_active_week', 'opened the planner during a week'],
  ['app_active_month', 'opened the planner during a month'],
  ['app_installed_day', 'opened the installed app on a day'],
  ['day_closed', 'closed a day'],
  ['week_view_opened', 'opened the week view on a day'],
  ['horizon_opened', 'opened Horizon on a day'],
  ['progress_opened', 'opened Progress on a day'],
  ['journal_opened', 'opened the journal on a day'],
  ['unresolved_opened', 'opened Unresolved on a day'],
  ['stats_opened', 'opened statistics on a day'],
  ['search_opened', 'searched on a day'],
  ['pip_opened', 'used the floating window on a day'],
  ['print_used', 'printed on a day']
]);
/**
 * Moments the public pages (the landing page, welcome/, and the Contact page)
 * count; their own notice lists them. Until 1.39 this list also held the
 * moments of pages and forms the site no longer has.
 */
export const LANDING_EVENTS = Object.freeze([
  ['landing_viewed', 'visited the landing page'],
  ['landing_cta_app', 'clicked “Open the planner”']
]);
const COUNTED = new Set([...COUNTED_EVENTS, ...LANDING_EVENTS].map(([name]) => name));

export function usageCountsEnabled(storage = globalThis.localStorage) {
  try { return storage?.getItem(USAGE_COUNTS_KEY) !== 'off'; } catch (_) { return true; }
}

export function setUsageCountsEnabled(enabled, storage = globalThis.localStorage) {
  try { storage?.setItem(USAGE_COUNTS_KEY, enabled ? 'on' : 'off'); } catch (_) {}
}

export function platformLabel() {
  const ua = navigator.userAgent || '';
  const installed = window.matchMedia?.('(display-mode: standalone)')?.matches || navigator.standalone === true;
  const os = /iPhone|iPod/i.test(ua) ? 'iPhone' : /iPad/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) ? 'iPad' : /Android/i.test(ua) ? 'Android' : /Mac/i.test(ua) ? 'Mac' : /Win/i.test(ua) ? 'Windows' : /Linux/i.test(ua) ? 'Linux' : 'Other';
  return `${os} · ${installed ? 'installed app' : 'browser'}`;
}

/** Fire-and-forget anonymous count. Never throws, never blocks the UI. */
export function trackEvent(name) {
  if (!plannerApiEnabled() || !COUNTED.has(name) || !usageCountsEnabled() || globalThis.navigator?.onLine === false) return;
  try {
    fetch(`${PLANNER_API_URL}/events`, {
      method: 'POST',
      keepalive: true,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name, version: APP_VERSION })
    }).catch(() => {});
  } catch (_) {}
}

const ONCE_KEY = 'daily-planner-ui:counted';
const pad2 = value => String(value).padStart(2, '0');

/** Local period keys: 2026-10-11 (day), 2026-W41 (ISO week), 2026-10 (month). */
export function periodKey(period, date = new Date()) {
  if (period === 'month') return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`;
  if (period === 'week') {
    const day = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    day.setUTCDate(day.getUTCDate() + 4 - (day.getUTCDay() || 7));
    const yearStart = Date.UTC(day.getUTCFullYear(), 0, 1);
    const week = Math.ceil(((day - yearStart) / 86400000 + 1) / 7);
    return `${day.getUTCFullYear()}-W${pad2(week)}`;
  }
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/**
 * Counts `name` at most once per local day, ISO week or month on this device,
 * so the dashboard can tell devices apart from repeated clicks without any
 * identifier ever leaving the device. Returns true when a count was sent.
 */
export function trackOncePer(period, name, { date = new Date(), storage = globalThis.localStorage } = {}) {
  // Offline, nothing is sent — so the period is not marked as counted either.
  if (!plannerApiEnabled() || !COUNTED.has(name) || !usageCountsEnabled(storage) || globalThis.navigator?.onLine === false) return false;
  const key = periodKey(period, date);
  let seen = {};
  try { seen = JSON.parse(storage?.getItem(ONCE_KEY) || '{}') || {}; } catch (_) { seen = {}; }
  if (seen[name] === key) return false;
  seen[name] = key;
  try { storage?.setItem(ONCE_KEY, JSON.stringify(seen)); } catch (_) { return false; }
  trackEvent(name);
  return true;
}

/** Planner opened: daily, weekly and monthly active counts, and installed-app days. */
export function trackAppActive({ installed = false, date = new Date() } = {}) {
  trackOncePer('day', 'app_active_day', { date });
  trackOncePer('week', 'app_active_week', { date });
  trackOncePer('month', 'app_active_month', { date });
  if (installed) trackOncePer('day', 'app_installed_day', { date });
}

async function postJson(path, body) {
  if (!plannerApiEnabled()) return { ok: false, error: 'Not available in this version of the planner.' };
  try {
    const response = await fetch(`${PLANNER_API_URL}/${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...body, version: APP_VERSION })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return { ok: false, error: data.error || 'Something went wrong. Please try again.' };
    return { ok: true, ...data };
  } catch (_) {
    return { ok: false, error: navigator.onLine === false ? 'You are offline. Try again once you are connected.' : 'Could not reach the server. Please try again.' };
  }
}

/**
 * JSON request for the waitlist-removal route. The body is sent exactly as
 * given. The answer carries the HTTP `status` (0 when the server couldn't be
 * reached) so the caller can explain what happened.
 */
async function request(path, { body } = {}) {
  if (!plannerApiEnabled()) return { ok: false, status: 0, unavailable: true, error: 'Not available in this version of the planner.' };
  try {
    const response = await fetch(`${PLANNER_API_URL}/${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) return { ...data, ok: false, status: response.status, error: data.error || 'Something went wrong. Please try again.' };
    return { ...data, ok: true, status: response.status };
  } catch (_) {
    const offline = globalThis.navigator?.onLine === false;
    return { ok: false, status: 0, offline, error: offline ? 'You are offline. Try again once you are connected.' : 'Could not reach the server. Please try again.' };
  }
}

export const joinWaitlist = payload => postJson('waitlist', payload);
/** Removes an address with the token the server returned when it joined. */
export const leaveWaitlist = ({ email, token }) => request('waitlist/remove', { body: { email, token } });
export const sendFeedback = payload => postJson('feedback', { platform: platformLabel(), ...payload });
