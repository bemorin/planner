// What needs the owner's attention, read from the admin summary the dashboard
// already loads: questions to answer, Setup items that are missing or need a
// check, and new reviews to read. Most urgent first, each with when it started
// and the card (and row) it points to. The Setup card takes its states from
// setupChecks() too, so the two always agree. Pure helpers, unit-tested
// (tests/admin-attention.test.js).

import { compareVersions } from './version.js';
// The legal pages' own checks, so Setup never calls ready a value the pages leave out.
import { legalDetails, legalValueProblem } from '../legal/legal-details.js';

/** Nothing records a reply, so a question stays listed for a while after it arrives. */
export const QUESTION_REPLY_DAYS = 14;
export const NEW_REVIEW_DAYS = 14;

const MINUTE = 60000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** The cards an item can point to, with the name its “Go to” link uses. */
export const ATTENTION_SECTIONS = Object.freeze({
  questions: 'Questions',
  setup: 'Setup',
  reviews: 'Reviews'
});

export const TONES = ['urgent', 'warn', 'info'];

// Order of the kinds of item, most urgent first; within a kind, the oldest first, and Setup in the card's own order.
const KINDS = {
  'setup-missing': { order: 0, tone: 'urgent' },
  question: { order: 1, tone: 'warn' },
  'setup-warn': { order: 2, tone: 'warn' },
  reviews: { order: 3, tone: 'info' }
};

const timeOf = iso => {
  const time = Date.parse(String(iso || ''));
  return Number.isFinite(time) ? time : Number.NaN;
};

// "3 min", "2 h", "5 days", "3 weeks", "4 months", "1 year".
function span(ms) {
  if (ms < HOUR) return `${Math.max(1, Math.floor(ms / MINUTE))} min`;
  if (ms < DAY) return `${Math.floor(ms / HOUR)} h`;
  const days = Math.floor(ms / DAY);
  if (days < 14) return `${days} ${days === 1 ? 'day' : 'days'}`;
  if (days < 61) return `${Math.floor(days / 7)} weeks`;
  const months = Math.floor(days / 30.4375);
  if (months < 12) return `${months} months`;
  const years = Math.floor(days / 365.25);
  return `${years} ${years === 1 ? 'year' : 'years'}`;
}

/** How long ago `iso` was, at `now` (ms): “just now”, “5 min ago”, “2 h ago”, “3 days ago”… '' when unknown. */
export function timeAgo(iso, now) {
  const at = timeOf(iso);
  if (Number.isNaN(at)) return '';
  const ms = now - at;
  return ms < MINUTE ? 'just now' : `${span(ms)} ago`;
}

/** The time shown on an item's line. */
export function attentionWhen(item, now) {
  if (item.when === 'setup') return 'this deployment';
  return timeAgo(item.at, now);
}

const within = (iso, now, days) => {
  const at = timeOf(iso);
  return !Number.isNaN(at) && now - at <= days * DAY;
};

// ---- Setup ----------------------------------------------------------------

// What the legal pages need (a usable value: legal-details.js), and the values they leave out when they aren't usable.
const LEGAL_FIELDS = [['email', 'SUPPORT_EMAIL', 'contact address'], ['address', 'LEGAL_ADDRESS', 'postal address']];
const LEGAL_CHECKED = ['SUPPORT_EMAIL', 'PRIVACY_EMAIL', 'LEGAL_PHONE'];
/** The parts of the database the summary may find missing, and what each one stops. */
const TABLES = [['questionsUnavailable', 'questions'], ['reviewsUnavailable', 'reviews']];
const listed = words => (words.length > 1 ? `${words.slice(0, -1).join(', ')} and ${words.at(-1)}` : words[0] || '');

/**
 * The state of each Setup item ('ok', 'warn' or 'missing') and, when it is
 * not ok, one short sentence per problem. `config` is the page's runtime
 * config (the legal details); `pageVersion` this dashboard's own version. []
 * when the API does not report its setup.
 */
export function setupChecks(summary, { config = {}, pageVersion = '' } = {}) {
  const setup = summary?.setup;
  if (!setup) return [];
  const checks = [];
  const add = (key, state, problems = []) => checks.push({ key, state, problems: state === 'ok' ? [] : problems });

  const server = String(summary.version || '').trim();
  const order = compareVersions(server, pageVersion);
  if (Number.isNaN(order)) add('version', 'warn', ['The API doesn’t report its version: redeploy it']);
  else if (order === 0) add('version', 'ok');
  else add('version', 'warn', [order > 0 ? `This dashboard is ${pageVersion}, ${server} is deployed: reload it` : `This dashboard is ${pageVersion}, the deployed one is ${server}: reload it`]);

  const email = setup.email || {};
  add('email', email.configured ? 'ok' : 'missing', ['Email isn’t set up: nothing can be sent']);
  add('owner-email', email.ownerEmail ? 'ok' : 'missing', ['Owner email isn’t set: no question notifications']);

  add('links', 'ok');
  // Legal pages: a blank contact or postal address is missing; a value set but not usable (“ben at example dot com”) is left out of the pages.
  const legal = legalDetails(config);
  const legalMissing = LEGAL_FIELDS.filter(([field, key]) => !legal[field] && !legalValueProblem(key, config[key])).map(([, , label]) => label);
  const legalUnused = LEGAL_CHECKED.map(key => [key, legalValueProblem(key, config[key])]).filter(([, problem]) => problem);
  const legalProblems = [
    ...(legalMissing.length ? [`Legal pages: ${listed(legalMissing)} missing`] : []),
    ...legalUnused.map(([key, problem]) => `Legal pages: DAILY_PLANNER_${key} is set, but not used (${problem})`)
  ];
  add('legal', legalProblems.length ? 'warn' : 'ok', legalProblems);

  const missing = TABLES.filter(([flag]) => summary[flag]).map(([, what]) => what);
  add('database', missing.length ? 'missing' : 'ok', [`Database: apply migrations/schema.sql (${listed(missing)} can’t be read)`]);
  add('sign-in', setup.twoFactor ? 'ok' : 'warn', ['Two-factor sign-in is off']);
  return checks;
}

// ---- Questions and reviews ---------------------------------------------------

// The start of a question, on one line, for the item's detail.
const QUESTION_EXCERPT = 80;
const excerpt = text => {
  const line = String(text || '').replace(/\s+/g, ' ').trim();
  return line.length > QUESTION_EXCERPT ? `${line.slice(0, QUESTION_EXCERPT - 1).trimEnd()}…` : line;
};

function questionItems(summary, now) {
  if (summary.questionsUnavailable) return [];
  const rows = Array.isArray(summary.questions) ? summary.questions : [];
  return rows.filter(row => within(row.createdAt, now, QUESTION_REPLY_DAYS)).map(row => {
    const who = String(row.name || '').trim() || String(row.email || '').trim();
    const words = excerpt(row.message);
    return {
      kind: 'question', key: `question:${row.id}`, section: 'questions', rows: [`question:${row.id}`], icon: 'question', at: row.createdAt, when: 'since',
      text: `Question from ${who || 'someone'} waiting for a reply`, detail: words ? `“${words}”` : ''
    };
  });
}

function reviewItems(summary, now) {
  if (summary.reviewsUnavailable) return [];
  const fresh = (Array.isArray(summary.reviews) ? summary.reviews : []).filter(row => within(row.createdAt, now, NEW_REVIEW_DAYS));
  if (!fresh.length) return [];
  const newestFirst = [...fresh].sort((a, b) => timeOf(b.createdAt) - timeOf(a.createdAt));
  const oldest = newestFirst.at(-1);
  const name = String(newestFirst[0].name || '').trim();
  return [{
    kind: 'reviews', key: 'reviews', section: 'reviews', rows: newestFirst.map(row => `review:${row.id}`), icon: 'review', at: oldest.createdAt, when: 'since',
    text: fresh.length === 1 ? `New review${name ? ` from ${name}` : ''} to read` : `${fresh.length} new reviews to read`,
    detail: 'Delete any you would not quote.'
  }];
}

// ---- The list -------------------------------------------------------------------

/**
 * Everything that needs the owner's attention, most urgent first. Each item:
 * { key, kind, tone, section, rows (the elements to highlight, the first one
 * focused), icon, text, detail, at (ISO), when ('since' | 'setup') }. `now`
 * defaults to the summary's own time.
 */
export function buildAttention(summary, { now, config = {}, pageVersion = '' } = {}) {
  if (!summary) return [];
  const at = Number.isFinite(now) ? now : Number.isFinite(timeOf(summary.generatedAt)) ? timeOf(summary.generatedAt) : Date.now();
  const setup = setupChecks(summary, { config, pageVersion }).flatMap((check, index) => check.problems.map((text, part) => ({
    kind: check.state === 'missing' ? 'setup-missing' : 'setup-warn',
    key: `setup:${check.key}:${part}`, section: 'setup', rows: [`setup:${check.key}`], icon: check.key === 'version' ? 'version' : 'setup',
    text, detail: '', at: '', when: 'setup', position: index * 10 + part
  })));
  const items = [...questionItems(summary, at), ...setup, ...reviewItems(summary, at)];
  const sortKey = item => (item.when === 'setup' ? item.position : timeOf(item.at) || 0);
  return items
    .map(item => ({ ...item, tone: KINDS[item.kind].tone }))
    .sort((a, b) => KINDS[a.kind].order - KINDS[b.kind].order || sortKey(a) - sortKey(b) || a.key.localeCompare(b.key))
    .map(({ position, ...item }) => item);
}

const rank = tone => Math.max(0, TONES.indexOf(tone));
const higher = (a, b) => (!a || rank(b) < rank(a) ? b : a);

/**
 * Per card: how many of its rows need attention and the most urgent tone;
 * per row: its tone. { sections: { questions: { count, tone } }, rows: Map(row → tone) }.
 */
export function attentionBySection(items) {
  const rows = new Map();
  const sectionRows = new Map();
  items.forEach(item => item.rows.forEach(row => {
    rows.set(row, higher(rows.get(row), item.tone));
    if (!sectionRows.has(item.section)) sectionRows.set(item.section, new Set());
    sectionRows.get(item.section).add(row);
  }));
  const sections = {};
  sectionRows.forEach((set, section) => {
    sections[section] = { count: set.size, tone: [...set].reduce((tone, row) => higher(tone, rows.get(row)), '') };
  });
  return { sections, rows };
}

/** Why questions stay for a set time: replies aren't recorded. '' when none is listed. */
export function attentionNote(items) {
  if (!items.some(item => item.kind === 'question')) return '';
  return `Replies aren’t recorded here, so questions stay listed for ${QUESTION_REPLY_DAYS} days.`;
}
