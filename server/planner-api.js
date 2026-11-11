// Daily Planner owner API: anonymous interface counts, the account-sync
// waitlist, versioned feedback (and the reviews people allow to be quoted),
// questions from the Contact page, the security headers' reports, and the
// private owner dashboard endpoints.
//
// The same router runs on Cloudflare Pages Functions (with a D1 store) and in
// scripts/serve.mjs (with a JSON-file store), so local testing behaves like
// production. It uses only standard Request/Response objects.
//
// Privacy contract
// - Counts: an allow-listed event name + app version, aggregated per day. No
//   identifiers, no IP addresses, no cookies, no user agent.
// - Waitlist: the email someone typed, with explicit consent. Deletable.
// - Feedback: what someone chose to send; email only if they added one.
// - Reviews: feedback whose author ticked that it may be quoted, with the
//   name they chose to give (optional). Deletable.
// - Questions (POST contact, the Contact page's “Ask a question” form): the
//   email, the name and the question someone typed, kept to reply to it (no
//   consent box: replying is what it is sent for, and the form shows an
//   information notice instead). Deletable. They are kept in the D1 table
//   team_requests, a name it keeps from the releases that also took team
//   orders (see migrations/schema.sql).
// - Email (optional, Resend, see server/email.js): the owner is notified of
//   each question, and the dashboard can send the one waitlist announcement;
//   every waitlist address is deleted as soon as its email is accepted. The
//   device that joined gets a removal token so people can leave the list on
//   their own.
// - Abuse limits (server/rate-limit.js): requests are counted per connection
//   under a scrambled form of the IP address (never the address), keyed by a
//   salt that changes every UTC day, per form or route, for at most 24 hours;
//   the rows are then deleted.
// - Reports of the security headers (POST csp-report, server/csp-reports.js):
//   what the browser's Content-Security-Policy blocked, as daily counts of the
//   directive, the blocked origin and the page. No address, nothing about the
//   visitor.
//
// Owner access: POST admin/session exchanges ADMIN_TOKEN (+ an authenticator
// code when ADMIN_TOTP_SECRET is set) for an 8-hour signed session, sent as
// `Authorization: Bearer <session>`. Without ADMIN_TOTP_SECRET the raw token
// is also accepted as the Bearer value. See server/admin-auth.js. 10 wrong
// tries (sign-in or raw token) in 15 minutes lock that connection out for 15
// minutes (server/rate-limit.js): every wrong try then answers 429, and the
// right credentials still get in.
//
// Requests that change something: JSON only for the public routes and
// sign-in, and never from another site's page (Origin); the browser's CSP
// reports come as their own types. Every answer carries
// X-Content-Type-Options: nosniff.

import { base32Decode, issueSession, looksLikeSession, timingSafeEqual, TOTP_MIN_SECRET_BYTES, verifySession, verifyTotp, verifyWaitlistRemoveToken, waitlistRemoveToken } from './admin-auth.js';
import { announcementEmail, createResendMailer, EMAILS_PER_SEND, escapeHtml, htmlDocument, idempotencyKey, ownerTestEmail, parseAddress, RESEND_MIN_INTERVAL_MS, textToHtml } from './email.js';
import { createDurableLimits } from './rate-limit.js';
import { CSP_REPORT_DAYS, cspReportType, readCspReports } from './csp-reports.js';
import { createConfigCheckRoute } from './admin-config.js';
import { sharedAdminLimits, waitWords } from './admin-limits.js';
import { DEFAULT_PUBLIC_BASE_URL, normalizeBaseUrl } from './config-inventory.js';
import { scrubAnswer } from './secret-scrub.js';
// The release this API was deployed with (kept in step with package.json by scripts/check.mjs).
// The dashboard compares it with its own to spot a page served from an old cache.
import { APP_VERSION } from '../src/config.js';

export const EVENT_NAMES = new Set([
  'onboarding_completed',
  'sync_guide_opened',
  'sync_guide_step_2',
  'sync_guide_step_3',
  'drive_connect_clicked',
  'waitlist_form_opened',
  'waitlist_joined',
  'install_modal_opened',
  'install_accepted',
  'feedback_prompt_shown',
  'feedback_opened',
  'feedback_sent',
  'trophy_unlocked',
  'landing_viewed',
  'landing_cta_app',
  'year_plan_completed',
  'quarter_review_completed',
  'year_review_opened',
  'review_sent',
  'share_image_created',
  // Usage, counted at most once per day, week or month on a device
  'app_active_day',
  'app_active_week',
  'app_active_month',
  'app_installed_day',
  'day_closed',
  'week_view_opened',
  'horizon_opened',
  'progress_opened',
  'journal_opened',
  'unresolved_opened',
  'stats_opened',
  'search_opened',
  'pip_opened',
  'print_used'
]);

export const FEEDBACK_KINDS = new Set(['idea', 'problem', 'praise', 'other']);
export const DEVICE_KINDS = new Set(['iphone', 'ipad', 'android', 'mac', 'windows', 'linux', 'other']);
/**
 * Where a question was sent from: the Contact page, the planner or the welcome
 * page. Anything else (an older page) is kept as the Contact page.
 */
export const CONTACT_SOURCES = new Set(['contact', 'app', 'landing']);
export const QUESTION_NAME_MAX = 80;
export const QUESTION_MESSAGE_MAX = 1000;
/**
 * POST teams, the address the Contact page posted to until 1.38, takes
 * questions for one more release (1.39): an older cached page still sends
 * them there. Anything else it was once for is gone.
 */
export const TEAMS_ALIAS_GONE = 'Team orders are no longer offered. To ask a question, use the Contact page.';
/**
 * Routes of the paid add-on, removed in 1.39 (everything it offered is free): any request to them, whatever its
 * method, answers 410 { error: 'GONE' }, so a page or client from 1.38 (which still asks GET checkout) learns they
 * are gone for good rather than reading a wrong method. Each is matched with the paths under it.
 */
export const RETIRED_ROUTES = Object.freeze(['checkout', 'purchases', 'plus', 'gifts', 'partners', 'creem', 'health/config']);
const retiredRoute = path => RETIRED_ROUTES.some(prefix => path === prefix || path.startsWith(`${prefix}/`));
// The public routes that take a POST; health takes a GET, and admin/… and csp-report check their own methods.
const POST_ROUTES = new Set(['events', 'waitlist', 'waitlist/remove', 'feedback', 'contact', 'teams']);
// Emails sent per UTC day are counted in the events table under a name the
// public events route can never accept, and hidden from the dashboard counts.
export const EMAIL_SENDS_EVENT = 'internal:email_sent';
// The owner's question notifications among them, counted apart too: their share of the day applies to them
// alone, so an announcement never silences them.
export const NOTIFY_SENDS_EVENT = 'internal:notify_sent';
const INTERNAL_EVENT_PREFIX = 'internal:';
// Resend's free plan: 100 emails a day (3,000 a month).
export const DEFAULT_EMAIL_DAILY_LIMIT = 100;
const NOTIFY_TIMEOUT_MS = 3000;
// The request guard: state-changing requests are JSON, from this site.
const NOT_JSON = 'Send this request as JSON.';
const FOREIGN_ORIGIN = 'This request came from another site, so it was refused.';
// Owner notifications of questions use at most this share of the day's emails: the rest stays for the
// waitlist announcement and test emails.
export const NOTIFY_EMAIL_SHARE = 0.5;
/** What the owner types, and the dashboard sends, to delete the anonymous usage counts (“Start fresh”). */
export const USAGE_RESET_CONFIRM = 'RESET';
export const REVIEW_NAME_MAX = 60;
export const REVIEWS_LATEST = 50;
export const QUESTIONS_LATEST = 200;
export const SERIES_DEFAULT_DAYS = 400;
export const SERIES_MAX_DAYS = 1200;
const MISSING_TABLE = 'A database table is missing. Apply migrations/schema.sql to the D1 database (see docs/configuration.md).';
const ANNOUNCE_SUBJECT_MAX = 150;
const ANNOUNCE_TEXT_MAX = 8000;
const AUTH_FAILURE_DELAY_MS = 400;
const MAX_BODY_BYTES = 16 * 1024;
const VERSION_RE = /^\d{1,3}\.\d{1,3}\.\d{1,4}$/;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
// Domain limited to letters, digits, dots and hyphens: nothing that could add
// query fields (?bcc=…) to a mailto: link in the dashboard.
const EMAIL_RE = /^[^\s@<>()[\]\\,;:"?&=%/#]{1,64}@[a-z0-9](?:[a-z0-9.-]{0,188}[a-z0-9])?\.[a-z]{2,24}$/i;

const json = (status, body, headers = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers }
});

const clip = (value, max) => String(value ?? '').replace(/\u0000/g, '').trim().slice(0, max);
const dayKey = date => date.toISOString().slice(0, 10);

const sleep = ms => new Promise(resolveSleep => { setTimeout(resolveSleep, ms); });

/** The raw body bytes, at most `max` of them (more throws 'too-large'). */
async function readBody(request, max = MAX_BODY_BYTES) {
  const length = Number(request.headers.get('content-length') || 0);
  if (length > max) throw new Error('too-large');
  // Read with a byte cap: a missing or wrong content-length must not let a
  // client stream an unbounded body into memory.
  const chunks = [];
  let size = 0;
  if (request.body) {
    const reader = request.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) { await reader.cancel().catch(() => {}); throw new Error('too-large'); }
      chunks.push(value);
    }
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

/** Whether a request says its body is JSON (content-type application/json, with or without a charset). */
const isJsonRequest = request => /^application\/json\s*(?:;|$)/i.test(String(request.headers.get('content-type') || '').trim());

async function readJson(request) {
  const text = new TextDecoder().decode(await readBody(request));
  try { return JSON.parse(text || '{}'); } catch { throw new Error('invalid-json'); }
}

const ISO_DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const shiftDay = (day, days) => new Date(Date.parse(`${day}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
const isDay = value => ISO_DAY_RE.test(String(value ?? '')) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && shiftDay(value, 0) === value;

/**
 * The days a chart covers: `to` defaults to today, `from` to SERIES_DEFAULT_DAYS
 * before it; reversed days are swapped and the range is cut to SERIES_MAX_DAYS.
 */
export function seriesRange(from, to, todayDay) {
  let end = isDay(to) ? to : todayDay;
  let start = isDay(from) ? from : shiftDay(end, 1 - SERIES_DEFAULT_DAYS);
  if (start > end) [start, end] = [end, start];
  const earliest = shiftDay(end, 1 - SERIES_MAX_DAYS);
  if (start < earliest) start = earliest;
  return { from: start, to: end };
}

function csvCell(value) {
  const text = String(value ?? '');
  // Prefix formula-looking cells so spreadsheets do not execute them.
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function toCsv(rows, columns) {
  return [columns.join(','), ...rows.map(row => columns.map(column => csvCell(row[column])).join(','))].join('\n') + '\n';
}

/** Validate a sign-up. Returns { entry } or { error }. */
export function validateWaitlist(body, now = new Date()) {
  if (body?.website) return { spam: true };
  const email = clip(body?.email, 254).toLowerCase();
  if (!EMAIL_RE.test(email)) return { error: 'Please enter a valid email address.' };
  if (body?.consent !== true) return { error: 'Please confirm that we may email you about account sync.' };
  const devices = Array.isArray(body?.devices) ? [...new Set(body.devices.map(String).filter(device => DEVICE_KINDS.has(device)))] : [];
  const version = VERSION_RE.test(String(body?.version || '')) ? String(body.version) : '';
  return {
    entry: {
      email,
      devices: devices.join(','),
      note: clip(body?.note, 600),
      locale: clip(body?.locale, 24),
      appVersion: version,
      driveSeen: body?.driveSeen === true ? 1 : 0,
      createdAt: now.toISOString()
    }
  };
}

/**
 * Validate feedback. Returns { entry, review } or { error }. `review` is the row
 * to keep for quoting when the author ticked `quote: true` and gave both a
 * rating and a message (with an optional name, at most REVIEW_NAME_MAX characters); null otherwise.
 */
export function validateFeedback(body, now = new Date()) {
  if (body?.website) return { spam: true };
  const version = String(body?.version || '');
  if (!VERSION_RE.test(version)) return { error: 'Unknown app version.' };
  const rating = body?.rating == null || body?.rating === '' ? null : Number(body.rating);
  if (rating != null && !(Number.isInteger(rating) && rating >= 1 && rating <= 5)) return { error: 'Rating must be between 1 and 5.' };
  const message = clip(body?.message, 4000);
  if (rating == null && !message) return { error: 'Add a rating or a few words.' };
  const email = clip(body?.email, 254).toLowerCase();
  if (email && !EMAIL_RE.test(email)) return { error: 'That email address does not look right.' };
  const quote = body?.quote === true;
  const name = quote ? oneLine(clip(body?.name, 1000)) : '';
  if (name.length > REVIEW_NAME_MAX) return { error: `Please keep your name under ${REVIEW_NAME_MAX} characters.` };
  const createdAt = now.toISOString();
  return {
    entry: {
      appVersion: version,
      rating,
      kind: FEEDBACK_KINDS.has(body?.kind) ? body.kind : 'other',
      message,
      email,
      platform: clip(body?.platform, 40),
      createdAt
    },
    review: quote && rating != null && message ? { appVersion: version, rating, text: message, name, createdAt } : null
  };
}

/**
 * Validate a question (the Contact page's “Ask a question” form). Returns
 * { entry }, { error } or { spam }. It needs an email and the question; the
 * name is optional. No box to tick: `consent` is neither needed nor stored,
 * and anything else an older page sends (a kind, a company, a referral code)
 * is ignored.
 */
export function validateContact(body, now = new Date()) {
  if (body?.website) return { spam: true };
  const email = clip(body?.email, 254).toLowerCase();
  if (!EMAIL_RE.test(email)) return { error: 'Please enter a valid email address.' };
  const name = clip(body?.name, 200);
  if (name.length > QUESTION_NAME_MAX) return { error: `Please keep your name under ${QUESTION_NAME_MAX} characters.` };
  const message = clip(body?.message, 2000);
  if (message.length > QUESTION_MESSAGE_MAX) return { error: 'Please keep the message under 1,000 characters.' };
  if (!message) return { error: 'Please write your question.' };
  const version = VERSION_RE.test(String(body?.version || '')) ? String(body.version) : '';
  return {
    entry: {
      email,
      name,
      message,
      locale: clip(body?.locale, 35),
      appVersion: version,
      source: CONTACT_SOURCES.has(body?.source) ? body.source : 'contact',
      createdAt: now.toISOString()
    }
  };
}

const csvResponse = (rows, columns, filename, cors) => new Response(toCsv(rows, columns), {
  headers: { ...cors, 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${filename}"`, 'cache-control': 'no-store' }
});

const oneLine = value => String(value ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();

/** EMAIL_DAILY_LIMIT: a whole number ≥ 0; blank or invalid means the default (Resend's free plan). */
export function parseDailyLimit(value) {
  if (String(value ?? '').trim() === '') return DEFAULT_EMAIL_DAILY_LIMIT;
  const limit = Number(value);
  return Number.isFinite(limit) && limit >= 0 ? Math.floor(limit) : DEFAULT_EMAIL_DAILY_LIMIT;
}

/** The owner's notification of a stored question: who asked, and the question. Every value is escaped. */
export function contactEmail(entry, dashboardUrl = '') {
  const fields = [
    ['Name', entry.name || '—'],
    ['Email', entry.email],
    ['Source', entry.source || '—'],
    ['Locale', entry.locale || '—']
  ];
  const lead = 'Someone asked a question.';
  const cell = 'padding:4px 16px 4px 0;vertical-align:top';
  const table = `<table style="border-collapse:collapse">${fields.map(([label, value]) => `<tr><td style="${cell};color:#706a62">${escapeHtml(label)}</td><td style="${cell}"><b>${escapeHtml(value)}</b></td></tr>`).join('')}</table>`;
  const message = `<p style="color:#706a62;margin-top:20px">Question</p>\n${textToHtml(entry.message)}`;
  const reply = `<p style="margin-top:20px">Reply to this email to answer ${escapeHtml(entry.name || entry.email)}.${dashboardUrl ? ` All questions: <a href="${escapeHtml(dashboardUrl)}">${escapeHtml(dashboardUrl)}</a>` : ''}</p>`;
  return {
    subject: oneLine(`Question from ${entry.name || entry.email}`),
    html: htmlDocument(`<p>${lead}</p>\n${table}\n${message}\n${reply}`),
    text: `${lead}\n\n${fields.map(([label, value]) => `${label}: ${oneLine(value)}`).join('\n')}\n\nQuestion:\n${entry.message}\n\nReply to this email to answer ${oneLine(entry.name || entry.email)}.${dashboardUrl ? `\nAll questions: ${dashboardUrl}` : ''}\n`,
    replyTo: { email: entry.email }
  };
}

const isMissingTable = error => /no such table/i.test(String(error?.message || ''));

/**
 * @param {object} options
 * @param {object} options.store            createMemoryStore() or createD1Store()
 * @param {string} [options.adminToken]     ADMIN_TOKEN; admin routes answer 503 without it
 * @param {string} [options.adminTotpSecret] ADMIN_TOTP_SECRET (base32); turns on two-factor sign-in
 * @param {string} [options.allowedOrigins] comma-separated origins allowed to call cross-origin
 * @param {() => Date} [options.now]
 * @param {number} [options.authFailureDelayMs] pause before answering a failed sign-in
 * @param {string} [options.resendApiKey]   RESEND_API_KEY; email is off without it
 * @param {string} [options.emailFrom]      EMAIL_FROM, e.g. "Daily Planner <hello@example.com>" (a domain verified in Resend)
 * @param {string} [options.ownerEmail]     OWNER_EMAIL: question notifications and test sends
 * @param {string|number} [options.emailDailyLimit] EMAIL_DAILY_LIMIT (default 100): emails per UTC day
 * @param {typeof fetch} [options.emailFetch] fetch used for Resend (tests inject one)
 * @param {number} [options.emailIntervalMs] pause between two Resend requests of one send
 * @param {number} [options.notifyTimeoutMs] give up on an owner notification after this long
 * @param {string|(() => string)} [options.publicBaseUrl] PUBLIC_BASE_URL, the site's public address
 *   (default https://planner.bemorin.com): its pages may call the API
 * @param {(promise: Promise) => void} [options.defer] keeps background work alive after the
 *   response (Pages Functions: context.waitUntil); without it the work simply runs on
 * @param {(message: string) => void} [options.warn] where swallowed email failures are reported
 * @param {object} [options.configEnv] the deployment's variables, secrets and bindings (Pages: context.env), for
 *   the configuration checks (POST admin/config/check, server/admin-config.js); none without it
 * @param {typeof fetch} [options.configFetch] fetch used by those checks (tests and the dev server inject one)
 * @param {object} [options.adminLimits] rate limits of the configuration check, the test email and “Start
 *   fresh” (server/admin-limits.js): the worker isolate's own by default, shared by every request; tests pass theirs
 * @param {object} [options.durableLimits] the per-connection limits kept in D1 (server/rate-limit.js
 *   createDurableLimits): made from `store` by default, keyed by a hash salted with ADMIN_TOKEN; tests pass theirs
 */
export function createPlannerApi({
  store, adminToken = '', adminTotpSecret = '', allowedOrigins = '', now = () => new Date(), authFailureDelayMs = AUTH_FAILURE_DELAY_MS,
  resendApiKey = '', emailFrom = '', ownerEmail = '', emailDailyLimit = '', emailFetch, emailIntervalMs = RESEND_MIN_INTERVAL_MS, notifyTimeoutMs = NOTIFY_TIMEOUT_MS,
  publicBaseUrl = '', defer = null, warn = message => console.warn(message), configEnv = null, configFetch, adminLimits = sharedAdminLimits, durableLimits = null
}) {
  const origins = new Set(String(allowedOrigins || '').split(',').map(value => value.trim()).filter(Boolean));
  const totpEnabled = !!String(adminTotpSecret || '').trim();
  const totpKey = totpEnabled ? base32Decode(adminTotpSecret) : null;
  // Sessions are signed with a key the token alone cannot rebuild once 2FA is
  // on, so knowing ADMIN_TOKEN is never enough to mint a session; changing
  // either secret signs every session out.
  const sessionKey = totpEnabled && totpKey ? `${adminToken}\u0000totp:${[...totpKey].map(byte => byte.toString(16).padStart(2, '0')).join('')}` : adminToken;
  // A configured but unusable secret must never fall back to token-only access.
  const totpBroken = totpEnabled && !(totpKey && totpKey.length >= TOTP_MIN_SECRET_BYTES);
  const mailer = createResendMailer({ apiKey: resendApiKey, from: emailFrom, fetch: emailFetch, minIntervalMs: emailIntervalMs });
  const owner = parseAddress(ownerEmail);
  const dailyLimit = parseDailyLimit(emailDailyLimit);
  const today = () => dayKey(now());
  const publicEvents = rows => rows.filter(row => !String(row.name).startsWith(INTERNAL_EVENT_PREFIX));
  const safeWarn = message => { try { warn(message); } catch (_) {} };
  // Per connection, in D1 (server/rate-limit.js): the per-isolate limits of server/admin-limits.js stay as a first layer.
  const limits = durableLimits || createDurableLimits({ store, secret: String(adminToken || ''), now: () => now().getTime(), warn: safeWarn, defer });
  /** The 429 of a durable limit: a calm sentence, the wait in seconds and Retry-After. */
  const tooMany = (wait, cors) => json(429, { error: `You’ve sent several requests in a short time. Please try again in ${waitWords(wait)}.`, retryAfter: wait }, { ...cors, 'retry-after': String(wait) });
  const baseUrl = () => normalizeBaseUrl(typeof publicBaseUrl === 'function' ? publicBaseUrl() : publicBaseUrl) || DEFAULT_PUBLIC_BASE_URL;

  /** How many question notifications a day may send: NOTIFY_EMAIL_SHARE of EMAIL_DAILY_LIMIT (none at 0), counted apart. */
  const notifyBudget = () => (dailyLimit > 0 ? Math.max(1, Math.floor(dailyLimit * NOTIFY_EMAIL_SHARE)) : 0);

  // Fire and forget: the 201 never waits for, or fails because of, an email. So that nobody can fill the owner's
  // inbox or use up the day's emails: one connection gets its first RATE_LIMITS.notify questions of the day
  // emailed, and notifications stop once they reach notifyBudget() that day — counted on their own
  // (NOTIFY_SENDS_EVENT), so the other emails of the day never stop them. Every question is still stored and
  // listed on the dashboard.
  function notifyOwner(entry, dashboardUrl, request) {
    if (!mailer.configured || !owner) return;
    const task = (async () => {
      if (await limits.hit(request, 'notify')) return;
      if (await store.emailSendsOn(today(), NOTIFY_SENDS_EVENT) >= notifyBudget()) {
        safeWarn('Question notification not sent: notifications have used their share of today’s emails. The question is on the dashboard.');
        return;
      }
      await mailer.send({ ...contactEmail(entry, dashboardUrl), recipients: [owner] }, { timeoutMs: notifyTimeoutMs });
      await store.addEmailSends(today(), NOTIFY_SENDS_EVENT, 1);
      await store.addEmailSends(today(), EMAIL_SENDS_EVENT, 1);
    })().catch(error => safeWarn(`Question notification not sent: ${error?.message || error}`));
    try { defer?.(task); } catch (_) {}
  }

  async function announce(request, cors) {
    if (request.method !== 'POST') return json(405, { error: 'Method not allowed' }, cors);
    if (!mailer.configured) return json(503, { error: 'Email is not set up. Add RESEND_API_KEY and EMAIL_FROM to this deployment, then redeploy.' }, cors);
    const body = await readJson(request);
    const subject = oneLine(clip(body?.subject, 1000));
    const text = clip(body?.text, ANNOUNCE_TEXT_MAX + 1000).replace(/\r\n?/g, '\n');
    if (!subject) return json(400, { error: 'Add a subject.' }, cors);
    if (subject.length > ANNOUNCE_SUBJECT_MAX) return json(400, { error: `Keep the subject under ${ANNOUNCE_SUBJECT_MAX} characters.` }, cors);
    if (!text) return json(400, { error: 'Write the message first.' }, cors);
    if (text.length > ANNOUNCE_TEXT_MAX) return json(400, { error: `Keep the message under ${ANNOUNCE_TEXT_MAX.toLocaleString('en-US')} characters.` }, cors);
    const content = announcementEmail({ subject, text });
    const day = today();

    if (body?.test === true) {
      if (!owner) return json(503, { error: 'OWNER_EMAIL is not set, so there is nowhere to send a test.' }, cors);
      try {
        await mailer.send({ ...content, subject: `[Test] ${content.subject}`, recipients: [owner] });
      } catch (error) {
        return json(502, { error: `The test was not sent. ${error.message}.` }, cors);
      }
      await store.addEmailSends(day, EMAIL_SENDS_EVENT, 1);
      return json(200, { sent: 1, remaining: await store.countWaitlist(), limitReached: false, dailyLimit, test: true }, cors);
    }

    const sentBefore = await store.emailSendsOn(day, EMAIL_SENDS_EVENT);
    // At most EMAILS_PER_SEND per call (subrequest limits); the owner sends again for the rest.
    const allowance = Math.max(0, Math.min(dailyLimit - sentBefore, EMAILS_PER_SEND));
    const rows = allowance ? await store.oldestWaitlist(allowance) : [];
    let sent = 0;
    let failure = null;
    if (rows.length) {
      try {
        ({ sent } = await mailer.send({ ...content, recipients: rows.map(row => ({ email: row.email, id: row.id })) }, {
          // Resend answers a repeated request (same batch, same words, within
          // 24 hours) without sending again: a safety net if a delete failed.
          idempotency: batch => idempotencyKey('announce', subject, text, batch.map(row => row.id).join(',')),
          // Each accepted batch is counted, then deleted: people asked for exactly one email.
          onBatch: async batch => {
            await store.addEmailSends(day, EMAIL_SENDS_EVENT, batch.length);
            await store.deleteWaitlistIds(batch.map(row => row.id));
          }
        }));
      } catch (error) {
        failure = error;
        sent = Number(error?.sent) || 0;
      }
    }
    const remaining = await store.countWaitlist();
    const limitReached = remaining > 0 && sentBefore + sent >= dailyLimit;
    const result = { sent, remaining, limitReached, dailyLimit };
    if (!failure) return json(200, result, cors);
    if (failure.afterSend) return json(500, { ...result, error: `Sent to ${sent} people, but they could not all be removed from the list (${failure.message}). Check the list before sending again, or someone could get a second email.` }, cors);
    if (!sent) return json(502, { ...result, error: `Nothing was sent. ${failure.message}.` }, cors);
    return json(200, { ...result, error: `Stopped after ${sent} people. ${failure.message}.` }, cors);
  }

  function setupInfo() {
    return {
      email: {
        configured: mailer.configured,
        apiKeySet: !!String(resendApiKey || '').trim(),
        fromSet: !!String(emailFrom || '').trim(),
        from: mailer.sender ? mailer.from : '',
        ownerEmail: owner?.email || '',
        dailyLimit
      },
      publicBaseUrl: baseUrl(),
      publicBaseUrlSet: !!normalizeBaseUrl(typeof publicBaseUrl === 'function' ? publicBaseUrl() : publicBaseUrl),
      twoFactor: totpEnabled
    };
  }

  /** Daily counts between two days, for the dashboard charts: summed across app versions, internal rows excluded. */
  async function seriesAnswer(url) {
    const { from, to } = seriesRange(url.searchParams.get('from'), url.searchParams.get('to'), today());
    const rows = await store.eventsSeries(from, to);
    const events = {};
    for (const row of rows) {
      if (String(row.name).startsWith(INTERNAL_EVENT_PREFIX)) continue;
      events[row.name] ||= {};
      events[row.name][row.day] = (events[row.name][row.day] || 0) + (Number(row.count) || 0);
    }
    return { from, to, events };
  }

  /**
   * The anonymous usage counts (the events table, internal rows left out).
   * GET admin/usage-counts answers what is there: { counts: { rows, count,
   * firstDay, lastDay } }. POST admin/usage-counts/reset { confirm: 'RESET' }
   * deletes them all (“Start fresh”, once the owner typed RESET in the
   * dashboard) and answers what went: { deleted, counts }. Nothing else is
   * touched: questions, the waitlist, feedback and reviews stay, and so does
   * the day's email tally (an internal row). Rate-limited per worker isolate.
   */
  async function usageCountsRoute(request, path, cors) {
    if (path === 'admin/usage-counts') {
      if (request.method !== 'GET') return json(405, { error: 'Method not allowed' }, cors);
      return json(200, { counts: await store.eventsOverview() }, cors);
    }
    if (request.method !== 'POST') return json(405, { error: 'Method not allowed' }, cors);
    const wait = adminLimits.resetCounts();
    if (wait) return json(429, { error: `Too many tries in a short time. Try again in ${waitWords(wait)}.`, retryAfter: wait }, { ...cors, 'retry-after': String(wait) });
    const body = await readJson(request);
    if (body?.confirm !== USAGE_RESET_CONFIRM) return json(400, { error: `Type ${USAGE_RESET_CONFIRM} to confirm.` }, cors);
    const before = await store.eventsOverview();
    const rows = await store.deleteEvents();
    return json(200, { deleted: { ...before, rows }, counts: await store.eventsOverview() }, cors);
  }

  function corsHeaders(request) {
    const origin = request.headers.get('origin');
    if (!origin || !origins.has(origin)) return {};
    return { 'access-control-allow-origin': origin, 'access-control-allow-methods': 'GET,POST,PATCH,DELETE,OPTIONS', 'access-control-allow-headers': 'content-type,authorization', vary: 'origin' };
  }

  /**
   * Whether a request's Origin (when it sends one) is this site's own: the
   * address it was sent to (a preview deployment too), PUBLIC_BASE_URL, an
   * ALLOWED_ORIGINS entry, or — on a local server — any local address.
   */
  function ownOrigin(request) {
    const origin = String(request.headers.get('origin') || '').trim();
    if (!origin) return true;
    if (origins.has(origin)) return true;
    let target;
    let from;
    try { target = new URL(request.url); from = new URL(origin); } catch { return false; }
    if (from.origin !== origin) return false;
    if (origin === target.origin) return true;
    try { if (origin === new URL(baseUrl()).origin) return true; } catch (_) {}
    return LOCAL_HOSTS.has(target.hostname) && LOCAL_HOSTS.has(from.hostname);
  }

  /**
   * The request guard: a request that changes something — POST, PATCH, PUT or
   * DELETE — must come from this site (ownOrigin), and a public one (every
   * route but the owner's, whose Bearer header a cross-site form can't send;
   * sign-in included) must be JSON: a cross-site form or a text/plain post (no
   * CORS preflight) is refused before anything is read. The browser's own CSP
   * reports come as their own types. Answers the refusal, or null.
   */
  function refusedRequest(request, path, cors) {
    if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return null;
    if (path === 'csp-report') {
      if (!cspReportType(request.headers.get('content-type'))) return json(415, { error: 'Send a CSP report (application/csp-report or application/reports+json).' }, cors);
      return ownOrigin(request) ? null : json(403, { error: FOREIGN_ORIGIN }, cors);
    }
    const ownerRoute = path.startsWith('admin/') && path !== 'admin/session';
    if (!ownerRoute && !isJsonRequest(request)) return json(415, { error: NOT_JSON }, cors);
    if (!ownOrigin(request)) return json(403, { error: FOREIGN_ORIGIN }, cors);
    return null;
  }

  // Same status, body and headers whichever part was wrong, after a short pause.
  async function unauthorized(cors) {
    if (authFailureDelayMs > 0) await sleep(authFailureDelayMs);
    return json(401, { error: 'Unauthorized' }, cors);
  }

  /**
   * { ok } for the owner's Bearer credential: a session, or (without 2FA) the
   * raw token. A wrong raw token counts as a wrong sign-in; while a
   * connection is locked out of signing in (server/rate-limit.js), a wrong one
   * answers { locked } (seconds), and the right one still gets in (the lockout
   * stops guessing, never the owner). A session can't be guessed, so a stale
   * one counts for nothing.
   */
  async function adminAuth(request) {
    if (!adminToken) return { ok: false };
    const match = /^Bearer\s+(.+)$/i.exec(request.headers.get('authorization') || '');
    if (!match) return { ok: false };
    const credential = match[1].trim();
    if (looksLikeSession(credential)) return { ok: await verifySession(sessionKey, credential, now().getTime()) };
    // The raw token is a shortcut for curl and CSV scripts, only without 2FA.
    if (totpEnabled) return { ok: false };
    const locked = await limits.signIn.wait(request);
    if (!timingSafeEqual(credential, adminToken)) {
      if (locked) return { ok: false, locked };
      await limits.signIn.failed(request);
      return { ok: false };
    }
    await limits.signIn.succeeded(request);
    return { ok: true };
  }

  const signInLocked = (wait, cors) => json(429, { error: `Too many wrong sign-ins from this connection. Try again in ${waitWords(wait)}.`, retryAfter: wait }, { ...cors, 'retry-after': String(wait) });

  /**
   * POST admin/session. SIGN_IN_LIMIT (server/rate-limit.js): 10 wrong tries in
   * 15 minutes lock that connection out for 15 minutes: while it is locked
   * out, a wrong try answers 429 (Retry-After, after the same pause), and the
   * right token (and code, with two-factor sign-in) still signs in. A sign-in
   * that works forgets the wrong tries. Each failure waits AUTH_FAILURE_DELAY_MS.
   */
  async function signIn(request, cors) {
    if (request.method !== 'POST') return json(405, { error: 'Method not allowed' }, cors);
    const locked = await limits.signIn.wait(request);
    const body = await readJson(request).catch(() => null);
    const tokenOk = timingSafeEqual(typeof body?.token === 'string' ? body.token : '', adminToken);
    const codeOk = totpEnabled ? await verifyTotp(totpKey, typeof body?.code === 'string' ? body.code : '', now().getTime()) : true;
    if (!tokenOk || !codeOk) {
      if (locked) {
        if (authFailureDelayMs > 0) await sleep(authFailureDelayMs);
        return signInLocked(locked, cors);
      }
      await limits.signIn.failed(request);
      return unauthorized(cors);
    }
    await limits.signIn.succeeded(request);
    const { session, expiresAt } = await issueSession(sessionKey, now().getTime());
    return json(200, { session, expiresAt: new Date(expiresAt).toISOString() }, cors);
  }

  // Configuration checks (server/admin-config.js): POST admin/config/check runs every check, read-only, and
  // answers states and shapes, never a secret's value. The Security headers check reads what the policy blocked
  // in the last CSP_REPORT_DAYS.
  const cspReports = () => store.listCspReports({ fromDay: dayKey(new Date(now().getTime() - (CSP_REPORT_DAYS - 1) * 86400000)) });
  const configCheckRoute = createConfigCheckRoute(() => ({ env: configEnv || {}, fetch: configFetch || globalThis.fetch?.bind(globalThis), cspReports, now: () => now().getTime() }), { limiter: adminLimits.check });

  // Every secret this API holds, for the last scrub of an answer that carries a service's words (server/secret-scrub.js).
  const apiSecrets = () => [adminToken, adminTotpSecret, resendApiKey];

  /**
   * POST admin/email/test (the configuration page's “Send me a test email”): one short email to OWNER_EMAIL
   * only. Rate-limited per worker isolate (server/admin-limits.js) and counted with the day's other emails
   * (Resend counts them all); Resend's failure is scrubbed of every secret.
   */
  async function emailTest(request, cors) {
    if (request.method !== 'POST') return json(405, { error: 'Method not allowed' }, cors);
    const wait = adminLimits.testEmail();
    if (wait) return json(429, { error: `Too many test emails in a short time. Try again in ${waitWords(wait)}.`, retryAfter: wait }, { ...cors, 'retry-after': String(wait) });
    if (!mailer.configured) return json(503, { error: 'Email is not set up. Add RESEND_API_KEY and EMAIL_FROM to this deployment, then redeploy.' }, cors);
    if (!owner) return json(503, { error: 'OWNER_EMAIL is not set, so there is nowhere to send a test.' }, cors);
    try {
      await mailer.send({ ...ownerTestEmail({ sentAt: now() }), recipients: [owner] });
    } catch (error) {
      return json(502, scrubAnswer({ error: `The test email wasn’t sent. ${error?.message || 'Resend request failed'}.` }, apiSecrets()), cors);
    }
    await store.addEmailSends(today(), EMAIL_SENDS_EVENT, 1).catch(error => safeWarn(`Test email not counted: ${error?.message || error}`));
    return json(200, { sent: 1 }, cors);
  }

  async function admin(request, path, url, cors) {
    if (!adminToken) return json(503, { error: 'ADMIN_TOKEN is not configured.' }, cors);
    if (totpBroken) return json(503, { error: 'ADMIN_TOTP_SECRET is not valid base32 (A–Z and 2–7, at least 16 characters).' }, cors);
    if (path === 'admin/session') return signIn(request, cors);
    const auth = await adminAuth(request);
    if (auth.locked) return signInLocked(auth.locked, cors);
    if (!auth.ok) return request.headers.has('authorization') ? unauthorized(cors) : json(401, { error: 'Unauthorized' }, cors);
    if (path === 'admin/config/check') {
      const answer = await configCheckRoute(request, path);
      return json(answer.status, answer.body, { ...cors, ...(answer.headers || {}) });
    }
    if (path === 'admin/email/test') return emailTest(request, cors);
    const days = Math.min(366, Math.max(1, Math.round(Number(url.searchParams.get('days')) || 90)));
    const sinceDay = dayKey(new Date(now().getTime() - days * 86400000));
    if (request.method === 'GET' && path === 'admin/summary') {
      // Questions and reviews must not take the whole dashboard down when their table is missing.
      const questions = Promise.all([store.listQuestions({ limit: QUESTIONS_LATEST }), store.questionCount()]).catch(() => null);
      // What “Start fresh” would delete: the anonymous counts recorded so far.
      const usageCounts = Promise.resolve().then(() => store.eventsOverview()).catch(() => null);
      const reviewRows = store.listReviews({ limit: REVIEWS_LATEST }).catch(() => null);
      // The expired rows of the abuse limits go at the same time.
      const pruned = limits.prune(true);
      const [eventTotals, eventDaily, waitlist, feedbackByVersion, feedbackLatest, questionData, emailsSentToday, reviews, usageCountRows] = await Promise.all([
        store.eventTotals({ sinceDay }).then(publicEvents),
        store.eventDaily({ sinceDay }).then(publicEvents),
        store.listWaitlist(),
        store.feedbackByVersion(),
        store.listFeedback({ limit: 30 }),
        questions,
        store.emailSendsOn(today(), EMAIL_SENDS_EVENT),
        reviewRows,
        usageCounts,
        pruned
      ]);
      const [questionRows, questionTotal] = questionData || [[], 0];
      return json(200, {
        version: APP_VERSION, generatedAt: now().toISOString(), sinceDay, eventTotals, eventDaily, waitlist, feedbackByVersion, feedbackLatest,
        questions: questionRows, questionCount: questionTotal, questionsUnavailable: !questionData,
        emailConfigured: mailer.configured, emailTestAvailable: mailer.configured && !!owner, emailDailyLimit: dailyLimit, emailsSentToday, emailsPerSend: EMAILS_PER_SEND,
        reviews: reviews || [], reviewsUnavailable: !reviews,
        setup: setupInfo(), usageCounts: usageCountRows
      }, cors);
    }
    if (request.method === 'GET' && path === 'admin/series') return json(200, await seriesAnswer(url), cors);
    if (path === 'admin/usage-counts' || path === 'admin/usage-counts/reset') return usageCountsRoute(request, path, cors);
    if (request.method === 'GET' && path === 'admin/feedback') {
      const version = url.searchParams.get('version') || '';
      const rows = await store.listFeedback({ version: VERSION_RE.test(version) ? version : '', limit: 500 });
      if (url.searchParams.get('format') === 'csv') return csvResponse(rows, ['id', 'createdAt', 'appVersion', 'rating', 'kind', 'message', 'email', 'platform'], 'daily-planner-feedback.csv', cors);
      return json(200, { rows }, cors);
    }
    if (request.method === 'GET' && path === 'admin/waitlist') {
      const rows = await store.listWaitlist();
      if (url.searchParams.get('format') === 'csv') return csvResponse(rows, ['id', 'createdAt', 'email', 'devices', 'note', 'locale', 'appVersion', 'driveSeen'], 'daily-planner-waitlist.csv', cors);
      return json(200, { rows }, cors);
    }
    if (request.method === 'GET' && path === 'admin/questions') {
      const rows = await store.listQuestions();
      // `company` and `teamSize` are only ever set on rows from the releases that also took team orders.
      if (url.searchParams.get('format') === 'csv') return csvResponse(rows, ['id', 'createdAt', 'name', 'email', 'message', 'source', 'locale', 'appVersion', 'kind', 'company', 'teamSize'], 'daily-planner-questions.csv', cors);
      return json(200, { rows }, cors);
    }
    if (path === 'admin/waitlist/announce') return announce(request, cors);
    const removal = path.match(/^admin\/(waitlist|feedback|questions|reviews)\/(\d+)$/);
    if (request.method === 'DELETE' && removal) {
      const remove = { waitlist: store.deleteWaitlist, feedback: store.deleteFeedback, questions: store.deleteQuestion, reviews: store.deleteReview }[removal[1]];
      const removed = await remove.call(store, Number(removal[2]));
      return json(removed ? 200 : 404, { removed: !!removed }, cors);
    }
    return json(404, { error: 'Not found' }, cors);
  }

  /**
   * POST /api/csp-report: what a browser blocked under the site's
   * Content-Security-Policy, sent by the browser itself. Within the body cap
   * and RATE_LIMITS['csp-report'] per connection, each report adds one to a
   * daily count of its directive, blocked origin and page
   * (server/csp-reports.js): no address, nothing about the visitor. Always 204,
   * also while the csp_reports table is missing.
   */
  async function cspReportRoute(request, cors) {
    if (request.method !== 'POST') return json(405, { error: 'Method not allowed' }, cors);
    const type = cspReportType(request.headers.get('content-type'));
    const body = new TextDecoder().decode(await readBody(request));
    const wait = await limits.hit(request, 'csp-report');
    if (wait) return tooMany(wait, cors);
    const day = dayKey(now());
    for (const report of readCspReports(type, body)) {
      try { await store.addCspReport({ day, ...report }); } catch (error) {
        if (!isMissingTable(error)) safeWarn(`CSP report not counted: ${error?.message || error}`);
        break;
      }
    }
    return new Response(null, { status: 204, headers: cors });
  }

  /**
   * POST contact (and, for one release, POST teams with a question): a
   * question from the Contact page. Stored as it comes (a repeat too), then
   * the owner is notified by email when it is set up.
   */
  async function contactRoute(request, body, url, cors) {
    const result = validateContact(body, now());
    if (result.spam) return json(201, { ok: true }, cors);
    if (result.error) return json(400, { error: result.error }, cors);
    const wait = await limits.hit(request, 'contact');
    if (wait) return tooMany(wait, cors);
    await store.addQuestion(result.entry);
    notifyOwner(result.entry, new URL('/admin/', url).href, request);
    return json(201, { ok: true }, cors);
  }

  /** Every answer of the API says its content type is the one to use (nosniff). */
  return async function handle(request) {
    const response = await route(request);
    try { response.headers.set('x-content-type-options', 'nosniff'); return response; } catch (_) {
      const copy = new Response(response.body, response);
      copy.headers.set('x-content-type-options', 'nosniff');
      return copy;
    }
  };

  async function route(request) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/^.*?\/api\/?/, '').replace(/\/+$/, '');
    const cors = corsHeaders(request);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    // The path first: a removed route is gone (410), an unknown one not found (404), and only a known one called
    // with another method is not allowed (405).
    if (retiredRoute(path)) return json(410, { error: 'GONE' }, cors);
    const ownMethods = path.startsWith('admin/') || path === 'csp-report';
    if (!ownMethods && path !== 'health' && !POST_ROUTES.has(path)) return json(404, { error: 'Not found' }, cors);
    if (!ownMethods && request.method !== (path === 'health' ? 'GET' : 'POST')) return json(405, { error: 'Method not allowed' }, cors);
    const refused = refusedRequest(request, path, cors);
    if (refused) return refused;
    try {
      if (path === 'health') return json(200, { ok: true }, cors);
      if (path.startsWith('admin/')) return await admin(request, path, url, cors);
      if (path === 'csp-report') return await cspReportRoute(request, cors);
      const body = await readJson(request);
      if (path === 'events') {
        const name = String(body?.name || '');
        const version = String(body?.version || '');
        if (!EVENT_NAMES.has(name) || !VERSION_RE.test(version)) return json(400, { error: 'Unknown event' }, cors);
        const wait = await limits.hit(request, 'events');
        if (wait) return tooMany(wait, cors);
        await store.countEvent(dayKey(now()), name, version);
        return new Response(null, { status: 204, headers: cors });
      }
      if (path === 'waitlist') {
        const result = validateWaitlist(body, now());
        if (result.error) return json(400, { error: result.error }, cors);
        const wait = result.spam ? 0 : await limits.hit(request, 'waitlist');
        if (wait) return tooMany(wait, cors);
        // Same answer for new and existing emails (the removal token depends
        // only on the address), so the endpoint can't be used to check whether
        // someone is on the list. Honeypot hits get the same answer too.
        const removeToken = await waitlistRemoveToken(adminToken, result.entry?.email ?? clip(body?.email, 254).toLowerCase());
        if (!result.spam) await store.addWaitlist(result.entry);
        return json(201, { ok: true, removeToken }, cors);
      }
      if (path === 'waitlist/remove') {
        if (!adminToken) return json(503, { error: 'Leaving the waitlist is not available: ADMIN_TOKEN is not configured.' }, cors);
        const wait = await limits.hit(request, 'waitlist-remove');
        if (wait) return tooMany(wait, cors);
        const email = clip(body?.email, 254).toLowerCase();
        if (!EMAIL_RE.test(email) || !await verifyWaitlistRemoveToken(adminToken, email, body?.token)) return json(400, { error: 'This removal request is not valid.' }, cors);
        // Same answer whether or not the address was still listed.
        await store.deleteWaitlistByEmail(email);
        return json(200, { ok: true }, cors);
      }
      if (path === 'feedback') {
        const result = validateFeedback(body, now());
        if (result.spam) return json(201, { ok: true }, cors);
        if (result.error) return json(400, { error: result.error }, cors);
        const wait = await limits.hit(request, 'feedback');
        if (wait) return tooMany(wait, cors);
        await store.addFeedback(result.entry);
        // A quotable review is kept apart (one a day per connection: more is kept as feedback only);
        // without its table the feedback still counts.
        if (result.review && !await limits.hit(request, 'review')) await store.addReview(result.review).catch(error => safeWarn(`Review not stored: ${error?.message || error}`));
        return json(201, { ok: true }, cors);
      }
      if (path === 'contact') return await contactRoute(request, body, url, cors);
      // The former address of the Contact page's form (until 1.38): questions only, for one release.
      if (path === 'teams') {
        if (body?.kind !== undefined && body.kind !== 'question') return json(410, { error: TEAMS_ALIAS_GONE, gone: true }, cors);
        return await contactRoute(request, body, url, cors);
      }
      return json(404, { error: 'Not found' }, cors);
    } catch (error) {
      if (error?.message === 'too-large') return json(413, { error: 'Request too large' }, cors);
      if (error?.message === 'invalid-json') return json(400, { error: 'Invalid JSON' }, cors);
      if (isMissingTable(error)) return json(503, { error: MISSING_TABLE }, cors);
      return json(500, { error: 'Server error' }, cors);
    }
  }
}

/**
 * In-memory store with optional persistence hooks; used by the dev server and
 * the unit tests. Mirrors the D1 store's behaviour (unique emails, counts,
 * oldest-first announcement order, internal email-send counts, rate-limit
 * rows per hashed connection, bucket and window, and the daily salts).
 * A data file written before 1.39 calls the questions teamRequests: they are
 * read under that name too.
 */
export function createMemoryStore(initial = {}, { onChange = null } = {}) {
  const list = name => (Array.isArray(initial[name]) ? initial[name] : []);
  const data = {
    events: list('events'),
    waitlist: list('waitlist'),
    feedback: list('feedback'),
    questions: Array.isArray(initial.questions) ? initial.questions : list('teamRequests'),
    reviews: list('reviews'),
    rateLimits: list('rateLimits'),
    rateLimitSalts: list('rateLimitSalts'),
    cspReports: list('cspReports'),
    nextId: Number(initial.nextId) || 1
  };
  const changed = () => onChange?.(data);
  const byNewest = (a, b) => String(b.createdAt).localeCompare(String(a.createdAt)) || b.id - a.id;
  const questionOut = row => ({ id: row.id, email: row.email, name: row.name || '', company: row.company || '', teamSize: Number(row.teamSize) || 0, kind: row.kind || 'question', message: row.message || '', locale: row.locale || '', appVersion: row.appVersion || '', source: row.source || '', createdAt: row.createdAt });
  return {
    data,
    async rateLimitHit({ key, bucket, windowStart, expiresAt }) {
      const row = data.rateLimits.find(item => item.key === key && item.bucket === bucket && item.windowStart === windowStart);
      if (row) row.count += 1; else data.rateLimits.push({ key, bucket, windowStart, count: 1, expiresAt });
      changed();
      return row ? row.count : 1;
    },
    async rateLimitCount({ key, bucket, now }) {
      const rows = data.rateLimits.filter(item => item.key === key && item.bucket === bucket && item.expiresAt > now);
      return { count: rows.reduce((sum, item) => sum + item.count, 0), until: rows.reduce((last, item) => Math.max(last, item.expiresAt), 0) };
    },
    async rateLimitClear({ key, buckets }) {
      const before = data.rateLimits.length;
      data.rateLimits = data.rateLimits.filter(item => !(item.key === key && buckets.includes(item.bucket)));
      if (before !== data.rateLimits.length) changed();
      return before - data.rateLimits.length;
    },
    async pruneRateLimits({ now, limit = 500 }) {
      const gone = new Set(data.rateLimits.filter(item => item.expiresAt <= now).slice(0, limit));
      if (!gone.size) return 0;
      data.rateLimits = data.rateLimits.filter(item => !gone.has(item));
      changed();
      return gone.size;
    },
    async getRateLimitSalt(day) { return data.rateLimitSalts.find(item => item.day === day)?.salt || null; },
    async addRateLimitSalt({ day, salt, createdAt }) {
      if (data.rateLimitSalts.some(item => item.day === day)) return false;
      data.rateLimitSalts.push({ day, salt, createdAt });
      changed();
      return true;
    },
    async deleteRateLimitSalts({ beforeDay }) {
      const before = data.rateLimitSalts.length;
      data.rateLimitSalts = data.rateLimitSalts.filter(item => item.day >= beforeDay);
      if (before !== data.rateLimitSalts.length) changed();
      return before - data.rateLimitSalts.length;
    },
    async addCspReport({ day, directive, blocked, page }) {
      const row = data.cspReports.find(item => item.day === day && item.directive === directive && item.blocked === blocked && item.page === page);
      if (row) row.count += 1; else data.cspReports.push({ day, directive, blocked, page, count: 1 });
      changed();
      return 1;
    },
    async listCspReports({ fromDay, limit = 50 }) {
      const totals = new Map();
      data.cspReports.filter(item => item.day >= fromDay).forEach(item => {
        const key = `${item.directive}|${item.blocked}|${item.page}`;
        const total = totals.get(key) || { directive: item.directive, blocked: item.blocked, page: item.page, count: 0, lastDay: '' };
        total.count += item.count;
        if (item.day > total.lastDay) total.lastDay = item.day;
        totals.set(key, total);
      });
      return [...totals.values()].sort((a, b) => b.count - a.count || a.directive.localeCompare(b.directive) || a.blocked.localeCompare(b.blocked) || a.page.localeCompare(b.page)).slice(0, limit);
    },
    async pruneCspReports({ beforeDay, limit = 500 }) {
      const gone = new Set(data.cspReports.filter(item => item.day < beforeDay).slice(0, limit));
      if (!gone.size) return 0;
      data.cspReports = data.cspReports.filter(item => !gone.has(item));
      changed();
      return gone.size;
    },
    async addReview(entry) {
      data.reviews.push({ id: data.nextId++, appVersion: entry.appVersion, rating: entry.rating, text: entry.text, name: entry.name || '', createdAt: entry.createdAt });
      changed();
    },
    async listReviews({ limit = 50 } = {}) {
      return [...data.reviews].sort(byNewest).slice(0, limit).map(row => ({ ...row }));
    },
    async deleteReview(id) {
      const before = data.reviews.length;
      data.reviews = data.reviews.filter(item => item.id !== id);
      changed();
      return before !== data.reviews.length;
    },
    async eventsSeries(fromDay, toDay) {
      const totals = new Map();
      data.events.filter(item => item.day >= fromDay && item.day <= toDay && !String(item.name).startsWith(INTERNAL_EVENT_PREFIX)).forEach(item => {
        const key = `${item.day}|${item.name}`;
        totals.set(key, { day: item.day, name: item.name, count: (totals.get(key)?.count || 0) + item.count });
      });
      return [...totals.values()].sort((a, b) => a.day.localeCompare(b.day) || a.name.localeCompare(b.name));
    },
    async countEvent(day, name, appVersion) {
      const row = data.events.find(item => item.day === day && item.name === name && item.appVersion === appVersion);
      if (row) row.count += 1; else data.events.push({ day, name, appVersion, count: 1 });
      changed();
    },
    async eventsOverview() {
      const rows = data.events.filter(item => !String(item.name).startsWith(INTERNAL_EVENT_PREFIX));
      const days = rows.map(item => String(item.day)).sort();
      return { rows: rows.length, count: rows.reduce((sum, item) => sum + (Number(item.count) || 0), 0), firstDay: days[0] || '', lastDay: days.at(-1) || '' };
    },
    async deleteEvents() {
      const before = data.events.length;
      data.events = data.events.filter(item => String(item.name).startsWith(INTERNAL_EVENT_PREFIX));
      changed();
      return before - data.events.length;
    },
    async addWaitlist(entry) {
      if (data.waitlist.some(item => item.email === entry.email)) return { duplicate: true };
      data.waitlist.push({ id: data.nextId++, ...entry });
      changed();
      return { duplicate: false };
    },
    async addFeedback(entry) {
      data.feedback.push({ id: data.nextId++, ...entry });
      changed();
    },
    async addQuestion(entry) {
      data.questions.push({ id: data.nextId++, email: entry.email, name: entry.name || '', kind: 'question', message: entry.message, locale: entry.locale || '', appVersion: entry.appVersion || '', source: entry.source || 'contact', createdAt: entry.createdAt });
      changed();
    },
    async listQuestions({ limit = 0 } = {}) {
      const rows = [...data.questions].sort(byNewest).map(questionOut);
      return limit ? rows.slice(0, limit) : rows;
    },
    async questionCount() { return data.questions.length; },
    async deleteQuestion(id) {
      const before = data.questions.length;
      data.questions = data.questions.filter(item => item.id !== id);
      changed();
      return before !== data.questions.length;
    },
    async eventTotals({ sinceDay }) {
      const totals = new Map();
      data.events.filter(item => item.day >= sinceDay).forEach(item => {
        const key = `${item.name}|${item.appVersion}`;
        totals.set(key, { name: item.name, appVersion: item.appVersion, count: (totals.get(key)?.count || 0) + item.count });
      });
      return [...totals.values()].sort((a, b) => a.name.localeCompare(b.name) || b.appVersion.localeCompare(a.appVersion));
    },
    async eventDaily({ sinceDay }) {
      const totals = new Map();
      data.events.filter(item => item.day >= sinceDay).forEach(item => {
        const key = `${item.day}|${item.name}`;
        totals.set(key, { day: item.day, name: item.name, count: (totals.get(key)?.count || 0) + item.count });
      });
      return [...totals.values()].sort((a, b) => a.day.localeCompare(b.day) || a.name.localeCompare(b.name));
    },
    async listWaitlist() { return [...data.waitlist].sort(byNewest); },
    async deleteWaitlist(id) {
      const before = data.waitlist.length;
      data.waitlist = data.waitlist.filter(item => item.id !== id);
      changed();
      return before !== data.waitlist.length;
    },
    async deleteWaitlistByEmail(email) {
      const before = data.waitlist.length;
      data.waitlist = data.waitlist.filter(item => item.email !== email);
      changed();
      return before !== data.waitlist.length;
    },
    async oldestWaitlist(limit) {
      return [...data.waitlist].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)) || a.id - b.id).slice(0, limit);
    },
    async countWaitlist() { return data.waitlist.length; },
    async deleteWaitlistIds(ids) {
      const remove = new Set(ids);
      const before = data.waitlist.length;
      data.waitlist = data.waitlist.filter(item => !remove.has(item.id));
      changed();
      return before - data.waitlist.length;
    },
    async addEmailSends(day, name, count) {
      const row = data.events.find(item => item.day === day && item.name === name && item.appVersion === '');
      if (row) row.count += count; else data.events.push({ day, name, appVersion: '', count });
      changed();
    },
    async emailSendsOn(day, name) {
      return data.events.filter(item => item.day === day && item.name === name).reduce((sum, item) => sum + item.count, 0);
    },
    async deleteFeedback(id) {
      const before = data.feedback.length;
      data.feedback = data.feedback.filter(item => item.id !== id);
      changed();
      return before !== data.feedback.length;
    },
    async listFeedback({ version = '', limit = 100 } = {}) {
      return data.feedback.filter(item => !version || item.appVersion === version).sort(byNewest).slice(0, limit);
    },
    async feedbackByVersion() {
      const groups = new Map();
      data.feedback.forEach(item => {
        const group = groups.get(item.appVersion) || { appVersion: item.appVersion, count: 0, rated: 0, ratingSum: 0, lastAt: '' };
        group.count += 1;
        if (item.rating != null) { group.rated += 1; group.ratingSum += item.rating; }
        if (item.createdAt > group.lastAt) group.lastAt = item.createdAt;
        groups.set(item.appVersion, group);
      });
      return [...groups.values()].map(group => ({ appVersion: group.appVersion, count: group.count, rated: group.rated, avgRating: group.rated ? Math.round(group.ratingSum / group.rated * 100) / 100 : null, lastAt: group.lastAt }))
        .sort((a, b) => b.appVersion.localeCompare(a.appVersion, undefined, { numeric: true }));
    }
  };
}
