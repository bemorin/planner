// Pure helpers of the configuration page (admin/configuration/): the
// words for each state, the order of “Fix first”, the plain-text summary to
// paste into a conversation (states and forms, never a value of any setting),
// and the values the page generates for secrets no service provides. Those are
// drawn in this browser (crypto.getRandomValues, WebCrypto), shown in the page
// and kept nowhere: not sent, not stored. Unit-tested in
// tests/admin-config.test.js.

export const STATE_LABELS = Object.freeze({
  ok: 'OK',
  problem: 'Problem',
  missing: 'Missing',
  'optional-missing': 'Optional, missing',
  untested: 'Present, not tested'
});

export const LEVEL_LABELS = Object.freeze({ required: 'Required', recommended: 'Recommended', optional: 'Optional' });

/**
 * A problem the server marks as a warning (two-factor sign-in off on the
 * production address, what the security headers blocked) is a reminder, not a
 * blocker: it reads “Warning”, in amber, and comes last in “Fix first”.
 */
export const isWarning = item => item?.state === 'problem' && item.warning === true;
/** The state an item is shown with: its own, or 'warning'. */
export const shownState = item => (isWarning(item) ? 'warning' : item?.state);
export const stateLabel = item => (isWarning(item) ? 'Warning' : STATE_LABELS[item?.state] || item?.state);

const LEVEL_ORDER = { required: 0, recommended: 1, optional: 2 };
const STATE_ORDER = { problem: 0, missing: 1 };
const TOTAL_WORDS = [['ok', 'OK', 'OK'], ['problem', 'problem', 'problems'], ['warning', 'warning', 'warnings'], ['missing', 'missing', 'missing'], ['optional-missing', 'optional and not set', 'optional and not set'], ['untested', 'present but not tested', 'present but not tested']];

/** What to fix first: problems and missing settings, required ones first, then recommended, then optional; warnings after them all. */
export function fixFirst(items = []) {
  return items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.state === 'problem' || item.state === 'missing')
    .sort((a, b) => Number(isWarning(a.item)) - Number(isWarning(b.item)) || (LEVEL_ORDER[a.item.level] ?? 3) - (LEVEL_ORDER[b.item.level] ?? 3) || STATE_ORDER[a.item.state] - STATE_ORDER[b.item.state] || a.index - b.index)
    .map(({ item }) => item);
}

/** The counts as shown: the warnings apart from the other problems (the server counts them among the problems too). */
export function shownCounts(counts = {}) {
  const warning = Math.max(0, Number(counts.warning) || 0);
  return { ...counts, problem: Math.max(0, (Number(counts.problem) || 0) - warning), warning };
}

/** “16 OK, 3 problems, 1 warning, 4 missing …”: the counts that aren't zero. */
export function totalsText(counts = {}) {
  const shown = shownCounts(counts);
  return TOTAL_WORDS.filter(([state]) => Number(shown[state]) > 0)
    .map(([state, one, many]) => `${Number(shown[state])} ${Number(shown[state]) === 1 ? one : many}`)
    .join(', ');
}

/** 2026-10-21 15:32 UTC */
export const utcStamp = iso => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? '' : `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
};

/** “in 1.4 s”, or “in under 0.1 s” for a check quicker than that. */
export const tookText = durationMs => {
  const ms = Math.max(0, Number(durationMs) || 0);
  return ms < 100 ? 'in under 0.1 s' : `in ${(ms / 1000).toFixed(1)} s`;
};

const where = deployment => (deployment?.production ? 'on the production address' : deployment?.local ? 'on a local dev server' : 'on another address than the production one (a preview deployment?)');

function line(item) {
  const facts = [item.level, item.secret ? 'secret' : '', item.type && item.type !== 'Secret' ? item.type : ''].filter(Boolean).join(', ');
  const shape = item.shape ? ` [${item.shape}]` : '';
  return `${item.name} (${facts}): ${stateLabel(item)}${shape} — ${item.summary}`;
}

/**
 * The plain-text summary of a check: when and where it ran, the totals,
 * “Fix first” with what each one blocks, then every setting by group with its
 * state, its form and the result. Never a value: the answer holds none, and
 * the copy lines of the fixes (names, addresses, SQL) are left out.
 */
export function summaryText(result) {
  const items = Array.isArray(result?.items) ? result.items : [];
  const groups = Array.isArray(result?.groups) ? result.groups : [];
  const first = fixFirst(items);
  const lines = [
    'Daily Planner — configuration check',
    `Checked ${utcStamp(result?.checkedAt)}, ${where(result?.deployment)}, ${tookText(result?.durationMs)}.`,
    `Totals: ${totalsText(result?.counts) || 'nothing checked'}.`,
    ...(Array.isArray(result?.notes) ? result.notes.map(note => `Note: ${note}`) : []),
    '',
    first.length ? 'Fix first:' : 'Fix first: nothing.',
    ...first.map((item, index) => `${index + 1}. ${line(item)} ${item.level === 'optional' ? 'If left blank' : 'Blocks'}: ${item.blocks}`)
  ];
  for (const group of groups) {
    const rows = items.filter(item => item.group === group.id);
    if (!rows.length) continue;
    lines.push('', group.title, ...rows.map(item => `- ${line(item)}`));
  }
  lines.push('', 'No value of any setting is included: only states, forms and lengths.');
  return `${lines.join('\n')}\n`;
}

// ---- Values generated in the browser ----------------------------------------------

export const ALPHANUMERIC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
export const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const TOKEN_LENGTH = 48;
/** 32 base32 characters: 160 bits, what authenticator apps expect (and npm run admin:secret makes). */
export const TOTP_LENGTH = 32;

/** `length` characters of `alphabet`, drawn with crypto.getRandomValues and no modulo bias. */
export function randomString(length, alphabet, random = globalThis.crypto) {
  const limit = 256 - (256 % alphabet.length);
  const out = [];
  while (out.length < length) {
    for (const byte of random.getRandomValues(new Uint8Array(length * 2))) {
      if (byte < limit && out.length < length) out.push(alphabet[byte % alphabet.length]);
    }
  }
  return out.join('');
}

/** A new ADMIN_TOKEN: 48 letters and digits (about 285 bits), on one line. */
export const newAdminToken = random => randomString(TOKEN_LENGTH, ALPHANUMERIC, random);

/** A new ADMIN_TOTP_SECRET: 32 base32 characters (160 bits). */
export const newTotpSecret = random => randomString(TOTP_LENGTH, BASE32_ALPHABET, random);

/** The otpauth:// link authenticator apps and password managers accept, as scripts/admin-secret.mjs prints it. */
export function otpauthUri(secret, { issuer = 'Daily Planner', account = 'owner' } = {}) {
  const name = encodeURIComponent(issuer);
  return `otpauth://totp/${name}:${encodeURIComponent(account)}?secret=${secret}&issuer=${name}&digits=6&period=30`;
}

/**
 * A document of the repository on GitHub (`path`, e.g. docs/configuration.md),
 * from the deployment's DAILY_PLANNER_GITHUB_URL (PROJECT_GITHUB_URL): the site
 * doesn't publish docs/ (1.35). '' unless that is an https address on github.com.
 */
export function repositoryDocHref(projectUrl, path) {
  let url = null;
  try { url = new URL(String(projectUrl || '').trim()); } catch (_) { return ''; }
  if (url.protocol !== 'https:' || url.hostname !== 'github.com' || !/^\/[^/]+\/[^/]+\/?$/.test(url.pathname) || url.search || url.hash) return '';
  return `${url.origin}${url.pathname.replace(/\/$/, '')}/blob/main/${String(path).split('/').map(encodeURIComponent).join('/')}`;
}
