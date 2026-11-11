// Configuration checks for the owner. POST /api/admin/config/check, behind
// the owner's sign-in, answers one row per production setting of
// server/config-inventory.js with its state, checked for real and read-only:
//   - D1: a simple read (SELECT 1), then every table, column and index that
//     migrations/schema.sql creates, from sqlite_master (D1 has no extensions or
//     scheduled jobs, and this app keeps no private settings there);
//   - Resend: GET /domains (a sending-only key answers 401 restricted_api_key,
//     which still proves the key) and whether EMAIL_FROM's domain is verified;
//   - the security headers: what browsers reported as blocked;
//   - everything else by its shape (token strength, base32, addresses, links,
//     numbers) and the legal pages' own rules; build variables are compared
//     with what the deployed runtime-config.js was built with.
// Every call has a 5-second timeout and they run side by side (two at most
// one after the other: the tables after SELECT 1), so the whole check takes
// 10 seconds at most; none changes anything. No value of a secret goes into
// the answer — only whether it is set, its length and the shape recognised
// (“looks like a Resend API key (re_…)”). A service's own words are dropped
// after a 401 or a 403 and scrubbed otherwise, and the whole answer is
// scrubbed again before it leaves (server/secret-scrub.js). Nothing is
// stored. `fetch` is injectable, so tests never reach the network.

import { base32Decode, TOTP_MIN_SECRET_BYTES } from './admin-auth.js';
import { ADMIN_LIMITS, sharedAdminLimits, waitWords } from './admin-limits.js';
import { CLOUDFLARE, CONFIG_CHECKS, CONFIG_GROUPS, CONFIG_VARIABLES, DEFAULT_PUBLIC_BASE_URL, MIGRATIONS, normalizeBaseUrl } from './config-inventory.js';
import { blockedWords, CSP_REPORT_DAYS } from './csp-reports.js';
import { parseAddress } from './email.js';
import { emailAddress, legalEmail, legalValueProblem } from '../legal/legal-details.js';
import { scrubAnswer, scrubUpstream, upstreamText } from './secret-scrub.js';

export const CHECK_TIMEOUT_MS = 5000;
/** Checks per 10 minutes and worker isolate (server/admin-limits.js): Cloudflare's rate limiting rule on /api/ is the real guard. */
export const CHECK_LIMIT = ADMIN_LIMITS.check;
export const RESEND_API_URL = 'https://api.resend.com';
export const STATES = Object.freeze(['ok', 'problem', 'missing', 'optional-missing', 'untested']);
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
const GOOGLE_CLIENT_RE = /^\d{6,}-[a-z0-9]{8,}\.apps\.googleusercontent\.com$/;
// A Dropbox app key: lowercase letters and digits (15 today), as src/config.js reads it. The App secret has the
// same form, so it can't be told apart here: the check says so softly (the planner never uses the secret).
const DROPBOX_APP_KEY_RE = /^[a-z0-9]{10,32}$/;
const ORIGIN_RE = /^https?:\/\/[A-Za-z0-9.-]+(?::\d{1,5})?$/;
const ADMIN_TOKEN_MIN = 32;
const ADMIN_TOKEN_MIN_BITS = 128;
const TOTP_GOOD_BYTES = 20;
const REDEPLOY = `Save, then redeploy: ${CLOUDFLARE.redeploy}.`;

const plural = (count, word, many = `${word}s`) => `${count} ${count === 1 ? word : many}`;
const chars = count => plural(count, 'character');
const listed = items => (items.length > 1 ? `${items.slice(0, -1).join(', ')} and ${items.at(-1)}` : items[0] || '');
const lowerFirst = text => text.charAt(0).toLowerCase() + text.slice(1);
const clip = (value, max = 160) => String(value ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, max);
const originOf = value => { try { return new URL(value).origin; } catch { return ''; } };
const hostOf = value => { try { return new URL(value).hostname; } catch { return ''; } };
const timeoutSeconds = ctx => Math.max(1, Math.round(ctx.timeoutMs / 1000));

/** { length, bits, kinds }: a rough strength from the kinds of characters used (letters, digits, symbols). */
export function tokenStrength(value) {
  const text = String(value ?? '');
  const pools = [['letters', /[a-z]/, 26], ['letters', /[A-Z]/, 26], ['digits', /\d/, 10], ['symbols', /[^A-Za-z0-9]/, 33]].filter(([, pattern]) => pattern.test(text));
  const size = pools.reduce((sum, [, , count]) => sum + count, 0);
  return { length: text.length, bits: size > 1 ? Math.floor(text.length * Math.log2(size)) : 0, kinds: listed([...new Set(pools.map(([kind]) => kind))]) };
}

function urlShape(text) {
  if (text.startsWith('/') && !text.startsWith('//')) return 'a path on this site';
  try {
    const { protocol } = new URL(text);
    if (protocol === 'https:') return 'an https address';
    return protocol === 'http:' ? 'an http address (not https)' : 'not a web address';
  } catch { return 'not a web address'; }
}

/** Long and varied enough: at least ADMIN_TOKEN_MIN characters and about ADMIN_TOKEN_MIN_BITS bits. */
const strongToken = text => {
  const strength = tokenStrength(text);
  return strength.length >= ADMIN_TOKEN_MIN && strength.bits >= ADMIN_TOKEN_MIN_BITS;
};

/** How a value looks, in words: its length and the form recognised. Never the value, nor any part of it. */
export function describeShape(def, raw) {
  const text = String(raw ?? '').trim();
  if (!text) return '';
  const length = chars(text.length);
  switch (def?.format) {
    case 'admin-token':
      // Its length and a verdict only: which kinds of characters a secret uses is a part of it.
      return `${length}, ${strongToken(text) ? 'strong' : 'weak'}`;
    case 'totp': {
      const bytes = base32Decode(text);
      return bytes ? `base32, ${length} (${bytes.length * 8} bits)` : `${length}, not base32 (A–Z and 2–7 only)`;
    }
    case 'resend-key':
      return text.startsWith('re_') ? `looks like a Resend API key (re_…), ${length}` : `${length}, not the re_… form of a Resend key`;
    case 'sender':
    case 'email': {
      const address = parseAddress(text);
      if (!address) return 'not an email address';
      return address.name ? 'an address with a name (Name <address>)' : 'a plain email address';
    }
    case 'count':
      return /^\d+$/.test(text) ? 'a whole number' : 'not a whole number';
    case 'api-url':
    case 'url':
    case 'url-or-path':
    case 'base-url':
      return urlShape(text);
    case 'origins':
      return plural(text.split(',').map(part => part.trim()).filter(Boolean).length, 'origin');
    case 'google-client-id':
      return GOOGLE_CLIENT_RE.test(text) ? 'looks like a Google OAuth client ID (….apps.googleusercontent.com)' : 'not the ….apps.googleusercontent.com form of a Google client ID';
    case 'dropbox-app-key':
      return DROPBOX_APP_KEY_RE.test(text) ? `looks like a Dropbox app key (${length}, lowercase letters and digits)` : `${length}, not the form of a Dropbox app key (lowercase letters and digits)`;
    case 'legal-email':
      if (!legalEmail(text)) return 'not a plain email address';
      return emailAddress(text) === text ? 'a plain email address' : 'an address with a name or brackets, read as the plain address';
    case 'phone':
      return text.startsWith('+') ? 'a phone number in international form (+…)' : 'a phone number in national form (no +)';
    case 'd1':
      return 'a D1 database binding';
    default:
      return length;
  }
}

/** The values the deployed runtime-config.js holds ({ KEY: 'value' }), or null when it isn't one. Read as text, never run. */
export function parseRuntimeConfig(text) {
  const body = /Object\.freeze\(\{([\s\S]*)\}\)/.exec(String(text ?? ''))?.[1];
  if (body == null) return null;
  const values = {};
  for (const match of body.matchAll(/["']?([A-Z][A-Z0-9_]*)["']?\s*:\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')/g)) {
    const literal = match[2];
    let value = '';
    if (literal.startsWith('"')) { try { value = JSON.parse(literal); } catch { value = ''; } } else value = literal.slice(1, -1).replace(/\\(.)/g, '$1');
    values[match[1]] = String(value).trim();
  }
  return values;
}

const TABLE_CONSTRAINT_RE = /^(?:PRIMARY\s+KEY|UNIQUE|FOREIGN\s+KEY|CHECK|CONSTRAINT)\b/i;

/** Tables (with their columns and their own statement) and indexes (with theirs) a migration creates. */
export function migrationSchema(sql) {
  const tables = [];
  const indexes = [];
  for (const match of String(sql).matchAll(/CREATE TABLE IF NOT EXISTS (\w+) \(([\s\S]*?)\n\);/g)) {
    const columns = match[2].split('\n').map(line => line.trim().replace(/,$/, ''))
      .filter(line => line && !TABLE_CONSTRAINT_RE.test(line))
      .map(line => ({ name: line.split(/\s+/)[0], definition: line }));
    tables.push({ name: match[1], columns, body: match[2], sql: match[0] });
  }
  for (const match of String(sql).matchAll(/CREATE INDEX IF NOT EXISTS (\w+) ON (\w+)[^;]*;/g)) indexes.push({ name: match[1], table: match[2], sql: match[0] });
  return { tables, indexes };
}

/**
 * The column names of a CREATE TABLE statement as sqlite_master keeps it: the
 * first word of each column definition (quotes removed), never a type or a
 * constraint, so a column `text` isn't found in `name TEXT`.
 */
export function tableColumns(createSql) {
  const sql = String(createSql ?? '').replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');
  const open = sql.indexOf('(');
  const close = sql.lastIndexOf(')');
  if (open < 0 || close <= open) return [];
  const parts = [];
  let depth = 0;
  let quote = '';
  let current = '';
  for (const character of sql.slice(open + 1, close)) {
    if (quote) {
      if (character === quote) quote = '';
    } else if (`'"\``.includes(character)) quote = character;
    else if (character === '[') quote = ']';
    else if (character === '(') depth += 1;
    else if (character === ')') depth -= 1;
    else if (character === ',' && depth === 0) { parts.push(current); current = ''; continue; }
    current += character;
  }
  parts.push(current);
  return parts.map(part => part.trim()).filter(part => part && !TABLE_CONSTRAINT_RE.test(part)).map(part => {
    const match = /^(?:"((?:[^"]|"")+)"|`((?:[^`]|``)+)`|\[([^\]]+)\]|'((?:[^']|'')+)'|([^\s(]+))/.exec(part);
    return match ? (match[1]?.replace(/""/g, '"') ?? match[2]?.replace(/``/g, '`') ?? match[3] ?? match[4]?.replace(/''/g, "'") ?? match[5]) : '';
  }).filter(Boolean);
}

// Names compare as SQLite compares them (ASCII case-insensitive): `Mode` is the column `mode`.
const hasColumn = (createSql, column) => tableColumns(createSql).some(name => name.toLowerCase() === String(column).toLowerCase());

/**
 * Whether SQLite's ALTER TABLE … ADD COLUMN accepts this column definition. It
 * refuses a PRIMARY KEY or UNIQUE column, NOT NULL without a default (other
 * than NULL), a default that isn't a constant (CURRENT_TIME…, an expression in
 * parentheses) and a stored generated column.
 */
export function canAddColumn(definition) {
  const text = String(definition ?? '').replace(/'(?:[^']|'')*'/g, "''");
  if (/\bPRIMARY\s+KEY\b|\bUNIQUE\b/i.test(text)) return false;
  if (/\bSTORED\b/i.test(text) && /\b(?:GENERATED|AS)\b/i.test(text)) return false;
  const fallback = /\bDEFAULT\s+(\(|[^\s,]+)/i.exec(text)?.[1] || '';
  if (fallback === '(' || /^CURRENT_(?:TIME|DATE|TIMESTAMP)$/i.test(fallback)) return false;
  return !(/\bNOT\s+NULL\b/i.test(text) && (!fallback || /^NULL$/i.test(fallback)));
}

// ---- Fixes -----------------------------------------------------------------------

/** Steps to set (or edit) a variable on Cloudflare, then redeploy. `copy`: lines the page offers to copy. */
function variableFix(def, { edit = false, value = '', before = [], after = [], copy = [] } = {}) {
  if (def.where === 'binding') {
    return {
      steps: [`${CLOUDFLARE.bindings} → Add → D1 database.`, `Variable name: ${def.name}. D1 database: ${CLOUDFLARE.d1Name} (create it first in Storage & Databases → D1 SQLite Database if it doesn’t exist).`, REDEPLOY],
      copy: [{ label: 'Variable name', text: def.name }]
    };
  }
  return {
    steps: [
      ...before,
      `${CLOUDFLARE.variables} → Production → ${edit ? `edit ${def.name}` : 'Add'}.`,
      `Type: ${def.type}. Variable name: ${def.name}. Value: ${value || def.source}`,
      ...after,
      def.where === 'build' ? `${REDEPLOY} The site is built with it only then.` : `${REDEPLOY} The API reads it from the next deployment on.`
    ],
    copy: [{ label: 'Variable name', text: def.name }, ...copy]
  };
}

const redeployFix = () => ({ steps: [`Redeploy: ${CLOUDFLARE.redeploy}. Nothing else to change.`], copy: [] });

/**
 * Why a column can't be added in place, in words: “a PRIMARY KEY”, “UNIQUE”,
 * “NOT NULL without a default”, “a default that isn't a constant”.
 */
function notAddableWhy(definition) {
  const text = String(definition).replace(/'(?:[^']|'')*'/g, "''");
  const reasons = [
    ...(/\bPRIMARY\s+KEY\b/i.test(text) ? ['a PRIMARY KEY'] : []),
    ...(/\bUNIQUE\b/i.test(text) ? ['UNIQUE'] : []),
    ...(/\bNOT\s+NULL\b/i.test(text) && !/\bDEFAULT\s+(?!NULL\b)\S/i.test(text) && !/\bINTEGER\s+PRIMARY\s+KEY\b/i.test(text) ? ['NOT NULL without a default'] : [])
  ];
  return reasons.length ? listed(reasons) : 'a default that isn’t a constant';
}

/**
 * The fix of a migration not fully applied: the SQL to run in the D1 console,
 * in the order to run it. A missing column SQLite can add in place gets its
 * ALTER TABLE line, run first (the file skips a table that exists, and its
 * indexes may need the column). A table missing a column SQLite can't add in
 * place (canAddColumn) is rebuilt in two steps that never lose a row: copy
 * every row into a complete new table (this fails, changing nothing, when rows
 * exist and a NOT NULL column has no value for them), then, only if the copy
 * worked, switch the tables, keeping the old one under another name. Then the
 * whole file, safe to run again.
 */
function migrationFix(migration, missing = [], tableSql = new Map(), day = '') {
  const schema = migrationSchema(migration.sql);
  const rebuilt = [...new Set(missing.filter(entry => !canAddColumn(entry.column.definition)).map(entry => entry.table))];
  const alters = missing.filter(entry => !rebuilt.includes(entry.table))
    .map(({ table, column }) => `ALTER TABLE ${table} ADD COLUMN ${column.definition};`);
  const steps = [`${CLOUDFLARE.d1Console}.`];
  const copy = [];
  if (alters.length) {
    steps.push(`First run the ALTER TABLE ${alters.length === 1 ? 'line' : 'lines'} below (Missing column): running the file doesn’t add a column to a table that exists, and its indexes may need ${alters.length === 1 ? 'it' : 'them'}.`);
    copy.push({ label: 'Missing column', text: alters.join('\n'), kind: 'sql' });
  }
  for (const name of rebuilt) {
    const table = schema.tables.find(entry => entry.name === name);
    const lacking = missing.filter(entry => entry.table === name).map(entry => entry.column);
    const old = `${name}_before_${day || 'fix'}`;
    const scratch = `${name}_rebuild`;
    const have = new Set(tableColumns(tableSql.get(name)).map(column => column.toLowerCase()));
    const common = table.columns.map(column => column.name).filter(column => have.has(column.toLowerCase())).join(', ');
    const hard = lacking.filter(column => !canAddColumn(column.definition));
    // Columns existing rows can't be given a value for: NOT NULL without a default (an INTEGER PRIMARY KEY numbers itself).
    const noValue = lacking.filter(column => /\bNOT\s+NULL\b/i.test(column.definition) && !/\bDEFAULT\s+(?!NULL\b)\S/i.test(column.definition) && !/\bINTEGER\s+PRIMARY\s+KEY\b/i.test(column.definition));
    steps.push(`${alters.length || rebuilt.indexOf(name) > 0 ? 'Then r' : 'First r'}ebuild ${name}, keeping its rows: SQLite can’t add ${listed(hard.map(column => `${column.name} (${notAddableWhy(column.definition)})`))} to a table that exists. Run “Rebuild ${name}, 1 of 2”: it copies every row into a complete new table, ${scratch}, and changes nothing else.`);
    if (noValue.length) steps.push(`If ${name} has rows, that copy fails (“NOT NULL constraint failed”): its rows have no value for ${listed(noValue.map(column => column.name))}. Nothing has changed then: stop there and ask for help (Copy summary), and don’t run 2 of 2.`);
    steps.push(`Only if 1 of 2 ran without an error, run “Rebuild ${name}, 2 of 2”: ${name} becomes the complete table, and the old one is kept as ${old} (delete it later with DROP TABLE ${old}; once this page says OK).`);
    copy.push({
      label: `Rebuild ${name}, 1 of 2`,
      text: [`DROP TABLE IF EXISTS ${scratch};`, `CREATE TABLE ${scratch} (${table.body.replace(/\s*\n\s*/g, ' ').trim()});`, ...(common ? [`INSERT INTO ${scratch} (${common}) SELECT ${common} FROM ${name};`] : [])].join('\n'),
      kind: 'sql'
    });
    copy.push({
      label: `Rebuild ${name}, 2 of 2`,
      text: [...schema.indexes.filter(index => index.table === name).map(index => `DROP INDEX IF EXISTS ${index.name};`), `ALTER TABLE ${name} RENAME TO ${old};`, `ALTER TABLE ${scratch} RENAME TO ${name};`].join('\n'),
      kind: 'sql'
    });
  }
  steps.push(`${copy.length ? 'Then paste' : 'Paste'} the SQL of migrations/${migration.file} (below: the whole file, safe to run again) and select Run.`, 'Then check again here.');
  const terminal = [...alters.map(line => `npx wrangler d1 execute ${CLOUDFLARE.d1Name} --remote --command="${line}"`), `npx wrangler d1 execute ${CLOUDFLARE.d1Name} --remote --file=migrations/${migration.file}`];
  copy.push({ label: `SQL of ${migration.file}`, text: migration.sql, kind: 'sql' });
  if (!rebuilt.length) copy.push({ label: 'Or from a terminal', text: terminal.join('\n') });
  return { steps, copy };
}

// ---- HTTP --------------------------------------------------------------------

/** One read-only call: { status, data } (status 0 with `error` 'timeout' or 'network'). Never longer than the timeout. */
async function request(ctx, url, headers) {
  const controller = new AbortController();
  let timer = 0;
  const timeout = new Promise(resolveTimeout => {
    timer = setTimeout(() => { controller.abort(); resolveTimeout({ status: 0, error: 'timeout' }); }, ctx.timeoutMs);
  });
  const call = (async () => {
    try {
      const response = await ctx.fetch(url, { method: 'GET', headers, signal: controller.signal });
      const data = await response.json().catch(() => null);
      return { status: response.status, data };
    } catch {
      return { status: 0, error: controller.signal.aborted ? 'timeout' : 'network' };
    }
  })();
  try { return await Promise.race([call, timeout]); } finally { clearTimeout(timer); }
}

function withTimeout(promise, ms) {
  let timer = 0;
  return Promise.race([
    Promise.resolve(promise),
    new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error('timeout'), { timeout: true })), ms); })
  ]).finally(() => clearTimeout(timer));
}

/** A service's own words, only when they can't hold a secret (server/secret-scrub.js): none after a 401 or a 403. */
const upstreamMessage = (ctx, answer) => {
  const message = Array.isArray(answer.data?.message) ? answer.data.message.join(', ') : answer.data?.message ?? answer.data?.error ?? '';
  return typeof message === 'string' ? upstreamText(answer.status, message, ctx.secrets, 160) : '';
};

/** Why a service gave no usable answer, in words. */
function noAnswer(service, answer, seconds) {
  if (answer.error === 'timeout') return `${service} didn’t answer within ${plural(seconds, 'second')}. Check again in a minute.`;
  if (answer.error) return `${service} couldn’t be reached. Check again in a minute.`;
  if (answer.status === 429) return `${service} is limiting requests (HTTP 429). Check again in a minute.`;
  if (answer.status >= 500) return `${service} had a problem (HTTP ${answer.status}). Check again in a few minutes.`;
  return `${service} gave an unexpected answer (HTTP ${answer.status}).`;
}

// ---- The checks --------------------------------------------------------------

function patch(item, fields) {
  if (item) Object.assign(item, fields);
}

function checkSignIn(ctx, items) {
  const token = ctx.value('ADMIN_TOKEN');
  const tokenItem = items.get('ADMIN_TOKEN');
  tokenItem.test = 'Its length and how hard it is to guess (its value is never shown, nor what it is made of).';
  if (token) {
    if (!strongToken(token)) {
      patch(tokenItem, {
        state: 'problem',
        summary: `Weak: easy to guess. Use at least ${ADMIN_TOKEN_MIN} random letters and digits (Generate a value below).`,
        fix: variableFix(configVariableOf('ADMIN_TOKEN'), { edit: true, value: 'a new token: Generate a value below.', after: ['Changing it signs every session out: sign in again with the new token.', 'It also changes every waitlist removal link: the links people were given to leave the list stop working, and the dashboard can still delete them.'] })
      });
    } else patch(tokenItem, { summary: 'Long and varied enough to resist guessing.' });
  }
  const secret = ctx.value('ADMIN_TOTP_SECRET');
  const totpItem = items.get('ADMIN_TOTP_SECRET');
  totpItem.test = 'Decoded the way sign-in decodes it.';
  if (!secret) {
    // On the production address: a warning, saying why. Elsewhere (a preview, this computer) a note.
    if (ctx.production) {
      patch(totpItem, {
        state: 'problem',
        warning: true,
        summary: 'Not set: on the production site, ADMIN_TOKEN alone opens the dashboard and this page, from anywhere, and scripts may send it as it is. Whoever learns it can read every question, sign-up and piece of feedback. Turn on two-factor sign-in.',
        fix: variableFix(configVariableOf('ADMIN_TOTP_SECRET'), { value: 'a new setup key: Generate a value below, and add it to your authenticator app first (“Enter a setup key”).', after: ['Sign in again with the token and a code from the app: the old sessions stop working.'] })
      });
    } else patch(totpItem, { summary: 'Not set: the token alone opens the dashboard and this page.' });
    return;
  }
  const bytes = base32Decode(secret);
  if (!bytes || bytes.length < TOTP_MIN_SECRET_BYTES) {
    patch(totpItem, { state: 'problem', summary: 'Not usable base32 (A–Z and 2–7, at least 16 characters): every admin route answers 503.', fix: variableFix(configVariableOf('ADMIN_TOTP_SECRET'), { edit: true, value: 'a new setup key: Generate a value below, and add it to your authenticator app first.' }) });
  } else if (bytes.length < TOTP_GOOD_BYTES) {
    patch(totpItem, { summary: `Two-factor sign-in is on. ${bytes.length * 8} bits is accepted; 160 bits (32 characters) is the usual size.` });
  } else patch(totpItem, { summary: 'Two-factor sign-in is on.' });
}

function checkAddresses(ctx, items) {
  const baseItem = items.get('PUBLIC_BASE_URL');
  const raw = ctx.value('PUBLIC_BASE_URL');
  baseItem.test = 'Read the way the API reads it, then compared with the address of this page.';
  if (!raw) patch(baseItem, { summary: `Not set: ${DEFAULT_PUBLIC_BASE_URL} is taken as the production address.` });
  else {
    const base = normalizeBaseUrl(raw);
    if (!base) patch(baseItem, { state: 'problem', summary: `Not an http(s) address: ${DEFAULT_PUBLIC_BASE_URL} is used instead.`, fix: variableFix(configVariableOf('PUBLIC_BASE_URL'), { edit: true }) });
    else if (new URL(base).protocol !== 'https:' && !LOCAL_HOSTS.has(new URL(base).hostname)) patch(baseItem, { state: 'problem', summary: 'Not https: the production address would be plain http.', fix: variableFix(configVariableOf('PUBLIC_BASE_URL'), { edit: true }) });
    else if (ctx.production) patch(baseItem, { summary: 'An https address, and this page is open on it.' });
    else patch(baseItem, { summary: ctx.local ? 'An address; this local server isn’t it, as expected.' : 'An https address. This page is open on another one (a preview or the .pages.dev address), which is fine.' });
  }

  const originsItem = items.get('ALLOWED_ORIGINS');
  const origins = ctx.value('ALLOWED_ORIGINS');
  originsItem.test = 'Each entry compared with the form browsers send (scheme and host, no path).';
  if (origins) {
    const parts = origins.split(',').map(part => part.trim()).filter(Boolean);
    const bad = parts.filter(part => !ORIGIN_RE.test(part));
    if (bad.length) patch(originsItem, { state: 'problem', summary: `${plural(bad.length, 'entry', 'entries')} of ${parts.length} ${bad.length === 1 ? 'isn’t an origin' : 'aren’t origins'} (scheme and host only, no path or trailing slash): browsers there are refused.`, fix: variableFix(configVariableOf('ALLOWED_ORIGINS'), { edit: true }) });
    else patch(originsItem, { summary: `${plural(parts.length, 'other site')} may call the API from a browser.` });
  }
}

function checkEmailSettings(ctx, items) {
  const fromItem = items.get('EMAIL_FROM');
  const from = ctx.value('EMAIL_FROM');
  if (from && !parseAddress(from)) patch(fromItem, { state: 'problem', summary: 'Not an email address: nothing can be sent until it is one.', fix: variableFix(configVariableOf('EMAIL_FROM'), { edit: true }) });
  const ownerItem = items.get('OWNER_EMAIL');
  const owner = ctx.value('OWNER_EMAIL');
  ownerItem.test = 'Read the way the API reads it. Send me a test email tries the whole path.';
  if (owner) {
    if (!parseAddress(owner)) patch(ownerItem, { state: 'problem', summary: 'Not an email address: notifications and test emails have nowhere to go.', fix: variableFix(configVariableOf('OWNER_EMAIL'), { edit: true }) });
    else patch(ownerItem, { summary: 'An email address: notifications and test emails go there.' });
  }
  const limitItem = items.get('EMAIL_DAILY_LIMIT');
  const limit = ctx.value('EMAIL_DAILY_LIMIT');
  if (limit) {
    if (!/^\d+$/.test(limit)) patch(limitItem, { state: 'problem', summary: 'Not a whole number: the default, 100 a day, is used instead.', fix: variableFix(configVariableOf('EMAIL_DAILY_LIMIT'), { edit: true }) });
    else if (Number(limit) === 0) patch(limitItem, { state: 'problem', summary: '0 stops every email, question notifications and test emails included.', fix: variableFix(configVariableOf('EMAIL_DAILY_LIMIT'), { edit: true }) });
    else patch(limitItem, { summary: 'A whole number: the most emails sent per UTC day.' });
  }
}

/** The value of a build variable as the site serves it (the built runtime-config.js), else as set now. */
const builtValue = (ctx, def) => (ctx.built ? String(ctx.built[def.runtimeKey] ?? '').trim() : ctx.value(def.name));

/** Link and form checks of the build variables, then each one compared with the value the site was built with. */
function checkBuildVariables(ctx, items) {
  for (const def of CONFIG_VARIABLES.filter(entry => entry.where === 'build')) {
    const item = items.get(def.name);
    const value = builtValue(ctx, def);
    item.shape = describeShape(def, value);
    if (!value) {
      item.state = def.level === 'optional' ? 'optional-missing' : 'missing';
      item.summary = def.level === 'optional' ? `Not set. ${def.blocks}` : 'Not set.';
      item.fix = variableFix(def);
    } else {
      item.state = 'ok';
      item.fix = null;
      buildFormat(ctx, def, item, value);
    }
    if (!ctx.built) continue;
    const set = ctx.value(def.name);
    if (set === value) continue;
    const said = !value ? 'Set, but the deployed site was built without it.' : !set ? 'The deployed site was built with a value this deployment’s variables don’t have any more: the next deployment drops it.' : 'The deployed site was built with another value than the one set now.';
    item.state = 'problem';
    item.summary = `${said} ${!set ? 'Set it again, or leave it blank on purpose.' : 'Retry the deployment so the site uses it.'}`;
    item.fix = set ? redeployFix() : variableFix(def);
  }
}

function buildFormat(ctx, def, item, value) {
  const problem = (summary, extra = {}) => Object.assign(item, { state: 'problem', summary, fix: variableFix(def, { edit: true, ...extra }) });
  switch (def.format) {
    case 'api-url': {
      item.test = 'Resolved from this page’s address, as the planner resolves it.';
      let target = null;
      try { target = new URL(value, `${ctx.origin || ctx.base}/`); } catch { target = null; }
      if (!target || !/^https?:$/.test(target.protocol)) return problem('Not an address the planner can call: it never reaches the API.', { value: '/api' });
      if (target.pathname.replace(/\/+$/, '') !== '/api') return problem('Doesn’t end in /api: the planner calls an address where no API answers.', { value: '/api' });
      if (ctx.origin && target.origin !== ctx.origin) return problem('Points to the API of another site: this deployment’s API isn’t the one the planner uses.', { value: '/api' });
      item.summary = 'Points to this site’s own API, which is answering now.';
      return;
    }
    case 'url':
      item.test = 'Its form only: the link itself isn’t opened from here.';
      if (!/^https:\/\/[^\s"'<>]+$/.test(value)) return problem('Not an https link: the pages leave it out.');
      item.summary = 'An https link.';
      return;
    case 'url-or-path':
      if (!/^https:\/\/[^\s"'<>]+$/.test(value) && !(value.startsWith('/') && !value.startsWith('//'))) return problem('Neither an https address nor a path on this site.');
      item.summary = 'An address the planner can call.';
      return;
    case 'google-client-id':
      item.test = 'Its form only: Google has no read-only check for a client ID.';
      if (!GOOGLE_CLIENT_RE.test(value)) return problem('Doesn’t look like a Google OAuth client ID (….apps.googleusercontent.com): Personal sync can’t sign in.');
      Object.assign(item, { state: 'untested', summary: 'Looks right. Google has no read-only check for a client ID: connect Google Drive in the planner (Settings → Personal sync) to try it.' });
      return;
    case 'dropbox-app-key':
      item.test = 'Its form only: Dropbox has no read-only check for an app key.';
      if (!DROPBOX_APP_KEY_RE.test(value)) return problem('Doesn’t look like a Dropbox app key (lowercase letters and digits, from the App Console’s Settings): the planner hides Dropbox. Check it isn’t the App secret.');
      Object.assign(item, { state: 'untested', summary: 'Looks right. Dropbox has no read-only check for an app key: connect Dropbox in the planner (Settings → Personal sync) to try it. Its Redirect URIs must list this site’s address with a final slash. The App secret has the same form: make sure this is the App key, since the planner never uses the secret (with the secret, Dropbox refuses the sign-in).' });
      return;
    case 'legal-email':
    case 'phone': {
      item.test = 'The legal pages’ own rules (legal/legal-details.js).';
      const why = legalValueProblem(def.runtimeKey, value);
      if (why) return problem(`Set, but the legal pages leave it out: ${why}.`);
      item.summary = def.format === 'phone' ? 'A phone number the legal notice shows, with a link that dials it.' : 'A plain address, shown as a mailto: link.';
      return;
    }
    case 'text':
      item.summary = 'Shown on the legal pages as it is, on one line.';
      return;
    default:
      item.summary = 'Set.';
  }
}

async function checkResend(ctx, items) {
  const key = ctx.value('RESEND_API_KEY');
  const keyItem = items.get('RESEND_API_KEY');
  const fromItem = items.get('EMAIL_FROM');
  const sender = parseAddress(ctx.value('EMAIL_FROM'));
  keyItem.test = 'Resend: GET /domains, read-only (a sending-only key answers “restricted”, which still proves it).';
  fromItem.test = 'Its domain looked up in Resend → Domains.';
  if (!key) {
    if (sender) patch(fromItem, { state: 'untested', summary: 'Not checked: RESEND_API_KEY is missing.' });
    return;
  }
  const answer = await request(ctx, `${RESEND_API_URL}/domains`, { authorization: `Bearer ${key}`, accept: 'application/json' });
  const seconds = timeoutSeconds(ctx);
  const name = String(answer.data?.name ?? '');
  if (answer.status === 200 && Array.isArray(answer.data?.data)) {
    patch(keyItem, { summary: 'Valid: Resend accepted it (full access).' });
    if (!sender) return;
    const domain = sender.email.split('@').pop().toLowerCase();
    const found = answer.data.data.find(entry => String(entry?.name ?? '').trim().toLowerCase() === domain);
    const domainFix = { steps: ['Resend → Domains → Add domain: the domain of EMAIL_FROM (or open it if it is listed).', 'Add each DNS record Resend shows in Cloudflare → your domain → DNS, as “DNS only”.', 'Wait until Resend shows Verified, then check again here.'], copy: [] };
    if (!found) patch(fromItem, { state: 'problem', summary: 'Its domain isn’t in this Resend account: Resend refuses to send from it.', fix: domainFix });
    else if (String(found.status ?? '').toLowerCase() !== 'verified') patch(fromItem, { state: 'problem', summary: `Its domain is “${clip(found.status, 30) || 'unknown'}” in Resend, not verified: Resend refuses to send from it until it is.`, fix: domainFix });
    else if (String(found.capabilities?.sending ?? '').toLowerCase() === 'disabled') patch(fromItem, { state: 'problem', summary: 'Its domain is verified, but sending is disabled for it in Resend.', fix: { steps: ['Resend → Domains → the domain of EMAIL_FROM → turn sending on.'], copy: [] } });
    else patch(fromItem, { summary: 'Its domain is verified in Resend.' });
  } else if (answer.status === 401 && name === 'restricted_api_key') {
    patch(keyItem, { summary: 'Valid, with sending access only: Resend answered that this key may only send emails, which is all the API needs.' });
    if (sender) patch(fromItem, { state: 'untested', summary: 'A sending-only key can’t read domains, so its domain wasn’t looked up: Send me a test email checks the whole path.' });
  } else if ([400, 401, 403].includes(answer.status)) {
    // After a 401 or a 403 only our own words: Resend's may repeat a part of the key.
    const said = upstreamMessage(ctx, answer);
    const why = answer.status === 400 ? (said ? `: “${said}”` : '') : answer.status === 401 ? ': the key is unknown or was deleted' : ': the key is not allowed to read this account, or is not active';
    patch(keyItem, { state: 'problem', summary: `Resend refused it (HTTP ${answer.status}${why}).`, fix: variableFix(configVariableOf('RESEND_API_KEY'), { edit: true, value: 'a new key from Resend → API Keys → Create API key (Sending access).' }) });
    if (sender) patch(fromItem, { state: 'untested', summary: 'Not checked: Resend refused RESEND_API_KEY.' });
  } else {
    patch(keyItem, { state: 'untested', summary: noAnswer('Resend', answer, seconds) });
    if (sender) patch(fromItem, { state: 'untested', summary: 'Not checked: Resend gave no usable answer.' });
  }
}

async function checkDatabase(ctx, items) {
  const dbItem = items.get('DB');
  const db = ctx.env?.DB;
  const migrationItems = MIGRATIONS.map(migration => items.get(`migration:${migration.file}`));
  dbItem.test = 'A simple read (SELECT 1), then the tables, columns and indexes listed in sqlite_master.';
  const untested = summary => migrationItems.forEach(item => patch(item, { state: 'untested', summary }));
  if (!db || typeof db.prepare !== 'function') {
    if (ctx.local) {
      patch(dbItem, { state: 'untested', summary: 'This local server keeps its data in a JSON file, not in D1: the database is checked on Cloudflare.', fix: null });
      untested('Checked on Cloudflare: there is no D1 database on this local server.');
    } else untested('Not checked: no database is bound as DB.');
    return;
  }
  dbItem.shape = describeShape(configVariableOf('DB'), 'DB');
  try {
    await withTimeout(db.prepare('SELECT 1 AS one').first(), ctx.timeoutMs);
  } catch (error) {
    // No answer in time says nothing about the binding: not tested. An error does: it is bound to no usable database.
    if (error?.timeout) patch(dbItem, { state: 'untested', summary: `Not tested: the database didn’t answer within ${plural(timeoutSeconds(ctx), 'second')}. Check again in a minute.`, fix: null });
    else patch(dbItem, { state: 'problem', summary: `The database answered with an error: ${scrubUpstream(error?.message, ctx.secrets, 160) || 'unknown error'}.`, fix: variableFix(configVariableOf('DB')) });
    untested(error?.timeout ? 'Not checked: the database didn’t answer in time.' : 'Not checked: the database didn’t answer.');
    return;
  }
  patch(dbItem, { state: 'ok', summary: 'Answers: a simple read (SELECT 1) worked.', fix: null });
  let rows;
  try {
    rows = (await withTimeout(db.prepare("SELECT type, name, tbl_name AS tableName, sql FROM sqlite_master WHERE type IN ('table', 'index')").all(), ctx.timeoutMs))?.results || [];
  } catch (error) {
    untested(`Not checked: the list of tables couldn’t be read (${error?.timeout ? 'no answer in time' : scrubUpstream(error?.message, ctx.secrets, 80) || 'error'}).`);
    return;
  }
  const tables = new Map(rows.filter(row => row?.type === 'table').map(row => [String(row.name), String(row.sql ?? '')]));
  const indexes = new Set(rows.filter(row => row?.type === 'index').map(row => String(row.name)));
  MIGRATIONS.forEach((migration, index) => {
    const item = migrationItems[index];
    const schema = migrationSchema(migration.sql);
    const missingTables = schema.tables.filter(table => !tables.has(table.name)).map(table => table.name);
    const missingColumns = schema.tables.filter(table => tables.has(table.name))
      .flatMap(table => table.columns.filter(column => !hasColumn(tables.get(table.name), column.name)).map(column => ({ table: table.name, column })));
    const missingIndexes = schema.indexes.filter(entry => !indexes.has(entry.name)).map(entry => entry.name);
    const parts = [
      ...(missingTables.length ? [`${missingTables.length === 1 ? 'table' : 'tables'} ${listed(missingTables)}`] : []),
      ...(missingColumns.length ? [`${missingColumns.length === 1 ? 'column' : 'columns'} ${listed(missingColumns.map(entry => `${entry.table}.${entry.column.name}`))}`] : []),
      ...(missingIndexes.length ? [`${missingIndexes.length === 1 ? 'index' : 'indexes'} ${listed(missingIndexes)}`] : [])
    ];
    if (parts.length) patch(item, { state: 'problem', summary: `Not fully applied. Missing: ${parts.join('; ')}.`, fix: migrationFix(migration, missingColumns, tables, ctx.day) });
    else patch(item, { state: 'ok', summary: `Applied: ${plural(schema.tables.length, 'table')} and ${plural(schema.indexes.length, 'index', 'indexes')}, every column in place.` });
  });
}

// ---- Security headers -------------------------------------------------------------

/**
 * What the Content-Security-Policy blocked in the last CSP_REPORT_DAYS, from
 * the counts the API keeps (`ctx.cspReports`, server/csp-reports.js): OK when
 * nothing was, a warning that lists it otherwise.
 */
async function checkSecurityReports(ctx, items) {
  const item = items.get('csp-reports');
  if (typeof ctx.cspReports !== 'function') {
    patch(item, { state: 'untested', summary: 'Not checked: this server keeps no reports.' });
    return;
  }
  let rows;
  try {
    rows = await withTimeout(Promise.resolve().then(() => ctx.cspReports()), ctx.timeoutMs);
  } catch (error) {
    if (/no such table/i.test(String(error?.message || ''))) patch(item, { state: 'untested', summary: 'Not counted yet: apply migrations/schema.sql, then browsers’ reports are counted here.' });
    else patch(item, { state: 'untested', summary: `Not checked: the reports couldn’t be read (${error?.timeout ? 'no answer in time' : scrubUpstream(error?.message, ctx.secrets, 80) || 'error'}).` });
    return;
  }
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) {
    patch(item, { state: 'ok', summary: `Nothing was blocked in the last ${CSP_REPORT_DAYS} days.`, fix: null });
    return;
  }
  const total = list.reduce((sum, row) => sum + (Number(row.count) || 0), 0);
  const shown = blockedWords(list.slice(0, 8));
  patch(item, {
    state: 'problem',
    warning: true,
    summary: `Browsers blocked something ${plural(total, 'time')} in the last ${CSP_REPORT_DAYS} days: ${shown.join('; ')}${list.length > shown.length ? `; and ${list.length - shown.length} more` : ''}.`,
    fix: {
      steps: [
        'Rocket Loader, Bot Fight Mode or JavaScript detections on in Cloudflare? Their inline scripts are blocked: turn them off (Speed → Optimization, Security → Bots).',
        'A service the site now uses (an API on another site, a font)? Add its address to that directive in the security block of _headers, then redeploy; npm run check says which hash an inline script needs.',
        'Neither? Then the policy blocked what it should, nothing to do. The list clears itself after 7 days.'
      ]
    }
  });
}

// ---- The whole check ---------------------------------------------------------

const configVariableOf = name => CONFIG_VARIABLES.find(entry => entry.name === name);

function inventoryItem(def, value) {
  const present = value !== '';
  return {
    id: def.name,
    name: def.name,
    group: def.group,
    level: def.level,
    secret: def.secret,
    where: def.where,
    type: def.type,
    state: present ? 'ok' : def.level === 'optional' ? 'optional-missing' : 'missing',
    shape: present ? describeShape(def, value) : '',
    summary: present ? 'Set.' : def.level === 'optional' ? `Not set. ${def.blocks}` : 'Not set.',
    source: def.source,
    unlocks: def.unlocks,
    blocks: def.blocks,
    test: 'Whether it is set.',
    fix: present ? null : variableFix(def),
    ...(def.generate ? { generate: def.generate } : {})
  };
}

function checkItem(def) {
  return {
    id: def.id, name: def.name, group: def.group, level: def.level, secret: false, where: def.where, type: def.type,
    state: 'untested', shape: '', summary: 'Not checked.', source: def.source, unlocks: def.unlocks, blocks: def.blocks, test: def.test, fix: null
  };
}

function migrationItem(migration) {
  const schema = migrationSchema(migration.sql);
  return {
    id: `migration:${migration.file}`,
    name: `migrations/${migration.file}`,
    group: 'database',
    level: 'required',
    secret: false,
    where: 'database',
    type: 'D1 migration',
    state: 'untested',
    shape: `${plural(schema.tables.length, 'table')}, ${plural(schema.indexes.length, 'index', 'indexes')}`,
    summary: 'Not checked.',
    source: `migrations/${migration.file} in the repository.`,
    unlocks: migration.unlocks,
    blocks: `Needed for ${lowerFirst(migration.unlocks)}`,
    test: 'Its tables, columns and indexes looked up in sqlite_master.',
    fix: null
  };
}

async function readBuiltConfig(ctx) {
  const url = `${ctx.origin || ctx.base}/runtime-config.js`;
  const assets = ctx.env?.ASSETS;
  try {
    const response = await withTimeout(assets && typeof assets.fetch === 'function' ? assets.fetch(url) : ctx.fetch(url, { headers: { accept: 'text/javascript' } }), ctx.timeoutMs);
    if (!response?.ok) return { error: `HTTP ${response?.status ?? 0}` };
    const values = parseRuntimeConfig(await response.text());
    return values ? { values } : { error: 'not the expected format' };
  } catch (error) {
    return { error: error?.timeout ? `no answer within ${plural(timeoutSeconds(ctx), 'second')}` : 'it could not be fetched' };
  }
}

/**
 * Run every check. `env`: the deployment's variables, secrets and bindings
 * (Pages: context.env; DB and ASSETS included). `origin`: the address the
 * page was opened on. Resolves with { checkedAt, durationMs, deployment,
 * groups, items, counts, notes }: no value of a secret anywhere.
 */
export async function runConfigChecks({ env = {}, fetch: fetchImpl = globalThis.fetch?.bind(globalThis), origin = '', now = () => Date.now(), timeoutMs = CHECK_TIMEOUT_MS, cspReports = null } = {}) {
  const started = now();
  const value = name => {
    const raw = env?.[name];
    return typeof raw === 'string' ? raw.trim() : typeof raw === 'number' ? String(raw) : '';
  };
  const pageOrigin = originOf(origin);
  const base = normalizeBaseUrl(value('PUBLIC_BASE_URL')) || DEFAULT_PUBLIC_BASE_URL;
  const ctx = {
    env, value, fetch: fetchImpl, timeoutMs, base, cspReports,
    origin: pageOrigin,
    local: LOCAL_HOSTS.has(hostOf(pageOrigin)),
    production: !!pageOrigin && pageOrigin === originOf(base),
    built: null,
    // Every configured secret: what upstream text is scrubbed of.
    secrets: CONFIG_VARIABLES.filter(def => def.secret).map(def => value(def.name)),
    day: new Date(now()).toISOString().slice(0, 10).replaceAll('-', '')
  };

  const items = new Map();
  for (const def of CONFIG_VARIABLES) {
    const present = def.where === 'binding' ? !!env?.[def.name] : value(def.name) !== '';
    items.set(def.name, inventoryItem(def, present ? (def.where === 'binding' ? def.name : value(def.name)) : ''));
    // A check about a setting comes right after its row (CONFIG_CHECKS `after`).
    for (const check of CONFIG_CHECKS.filter(entry => entry.after === def.name)) items.set(check.id, checkItem(check));
  }
  for (const migration of MIGRATIONS) items.set(`migration:${migration.file}`, migrationItem(migration));
  for (const def of CONFIG_CHECKS.filter(entry => !items.has(entry.id))) items.set(def.id, checkItem(def));

  checkSignIn(ctx, items);
  checkAddresses(ctx, items);
  checkEmailSettings(ctx, items);
  const built = readBuiltConfig(ctx).then(answer => {
    ctx.built = answer.values || null;
    ctx.builtError = answer.error || '';
    checkBuildVariables(ctx, items);
  });
  // A check that throws leaves its rows as they are: “not checked”, never a crash of the page.
  await Promise.all([built, checkResend(ctx, items), checkDatabase(ctx, items), checkSecurityReports(ctx, items)].map(task => task.catch(() => {})));

  const order = new Map(CONFIG_GROUPS.map((group, index) => [group.id, index]));
  const list = [...items.values()].sort((a, b) => order.get(a.group) - order.get(b.group));
  // `warning`: the problems that are reminders, not blockers (counted among the problems too).
  const counts = { ...Object.fromEntries(STATES.map(state => [state, list.filter(item => item.state === state).length])), warning: list.filter(item => item.state === 'problem' && item.warning).length };
  const notes = [];
  if (!ctx.production) {
    notes.push(ctx.local
      ? 'This is a local server: it checks this computer’s settings, not Cloudflare’s.'
      : 'This page is open on another address than the production one: it checks the deployment that answers here (a preview deployment uses the Preview variables).');
  }
  if (ctx.builtError) notes.push(`The deployed runtime-config.js couldn’t be read (${ctx.builtError}): build variables are judged from this deployment’s settings.`);
  const answer = {
    checkedAt: new Date(now()).toISOString(),
    durationMs: Math.max(0, now() - started),
    deployment: { origin: pageOrigin, baseUrl: base, production: ctx.production, local: ctx.local, single: true },
    groups: CONFIG_GROUPS,
    items: list,
    counts,
    notes
  };
  return scrubAnswer(answer, ctx.secrets);
}

/**
 * POST admin/config/check, behind the owner's sign-in (checked by the caller).
 * `getOptions()` gives runConfigChecks' options; the page's origin comes from
 * the request. `limiter`: the worker isolate's own (server/admin-limits.js),
 * shared by every request it answers. Answers { status, body, headers? }, or
 * null for another path.
 */
export function createConfigCheckRoute(getOptions, { limiter = sharedAdminLimits.check } = {}) {
  return async function configCheckRoute(request, path) {
    if (path !== 'admin/config/check') return null;
    if (request.method !== 'POST') return { status: 405, body: { error: 'Method not allowed' } };
    const wait = limiter();
    if (wait) return { status: 429, body: { error: `Too many checks in a short time. Check again in ${waitWords(wait)}.`, retryAfter: wait }, headers: { 'retry-after': String(wait) } };
    return { status: 200, body: await runConfigChecks({ ...getOptions(), origin: new URL(request.url).origin }) };
  };
}
