// Never a secret in an answer (the owner's rule): the one scrubber of every
// owner route — the configuration checks (server/admin-config.js) and the test
// email (server/planner-api.js) — and of the failures of Resend
// (server/email.js).
//
// Two levels:
//   - upstreamText(status, message, secrets): what a service said, before any
//     of it goes into an answer. After a 401 or a 403 nothing of it is kept:
//     the caller says what happened in its own words (a service refusing a key
//     is the answer most likely to repeat it). Otherwise any run of 4 or more
//     characters of a secret's non-public part is hidden, with every
//     key-shaped token (re_…, whatever its length) and masked forms
//     (re_ab****cd, re_…, ab••••cd); if a decoded
//     form of what is left (URL-encoded, JSON or HTML escapes) would still
//     show one, the whole text is dropped.
//   - scrubAnswer(value, secrets, keep): the last pass over a whole answer
//     before it leaves the server. Each secret (as written, URL-encoded or
//     JSON-escaped), any 8 characters of its non-public part and any key-shaped
//     token with 8 characters or more after its prefix become “[hidden]”.
//     Shorter runs stay: the server's own words (“re_…”) and public values
//     (an address, SQL) must not be mangled, and an echo
//     can only come from upstream text, scrubbed above.
// A secret's public part is its well-known prefix (re_, Resend's): saying it
// is not saying anything about the secret.

export const HIDDEN = '[hidden]';
/** Upstream text: a run this long of a secret's non-public part is hidden. */
export const UPSTREAM_RUN = 4;
/** A whole answer: a run this long (no word of ours, no public value repeats 8 characters of a random secret). */
export const ANSWER_RUN = 8;
/** Shorter secrets (a dev token such as “dev”) are not looked for: they would hide ordinary words. */
const MIN_SECRET = 6;
const UPSTREAM_MAX = 200;
const PUBLIC_PREFIXES = Object.freeze(['re_']);
const TOKEN_CHARS = '[^\\s"\'`<>()[\\]{},;]';
// Any length after the prefix, in upstream text.
const ANY_KEY_RE = new RegExp(`\\bre_${TOKEN_CHARS}*`, 'g');
// At least 8 characters after the prefix, in a whole answer (“re_…” is our own word).
const LONG_KEY_RE = /\bre_[A-Za-z0-9_\-*•…]{8,}/g;
const MASKED_RE = new RegExp(`${TOKEN_CHARS}*(?:\\*{2,}|•+|…|\\.{3,})${TOKEN_CHARS}*`, 'g');
const REPEATED_RE = /(?:\[hidden\]){2,}/g;

/** The part of a secret that is secret: without its well-known prefix. */
export function secretPart(secret) {
  const text = String(secret ?? '').trim();
  const prefix = PUBLIC_PREFIXES.find(entry => text.startsWith(entry)) || '';
  return text.slice(prefix.length);
}

const secretList = secrets => [...new Set((Array.isArray(secrets) ? secrets : [secrets]).map(secret => String(secret ?? '').trim()).filter(secret => secret.length >= MIN_SECRET))]
  .sort((a, b) => b.length - a.length);

const gramCache = new Map();
function gramsOf(body, size) {
  const key = `${size}:${body}`;
  let grams = gramCache.get(key);
  if (!grams) {
    grams = new Set();
    for (let index = 0; index + size <= body.length; index += 1) grams.add(body.slice(index, index + size));
    if (gramCache.size > 64) gramCache.clear();
    gramCache.set(key, grams);
  }
  return grams;
}

/** [start, end) ranges of `text` that repeat `size` or more characters of one of `bodies` (lower case), merged. */
function runRanges(text, bodies, size) {
  const lower = text.toLowerCase();
  const ranges = [];
  for (const body of bodies) {
    if (body.length < size) continue;
    const grams = gramsOf(body, size);
    for (let start = 0; start + size <= lower.length; start += 1) {
      if (!grams.has(lower.slice(start, start + size))) continue;
      let end = start + size;
      while (end < lower.length && body.includes(lower.slice(start, end + 1))) end += 1;
      ranges.push([start, end]);
    }
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const range of ranges) {
    const last = merged.at(-1);
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else merged.push([...range]);
  }
  return merged;
}

function hideRuns(text, bodies, size) {
  const ranges = runRanges(text, bodies, size);
  if (!ranges.length) return text;
  let out = '';
  let at = 0;
  for (const [start, end] of ranges) {
    out += text.slice(at, start) + HIDDEN;
    at = end;
  }
  return out + text.slice(at);
}

const bodiesOf = (list, size) => [...new Set(list.map(secret => secretPart(secret).toLowerCase()).filter(body => body.length >= size))];

/** The text as a reader of URLs, JSON or HTML would see it, decoded up to three times. */
function decodedViews(text) {
  const percent = value => value.replace(/%([0-9a-f]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16))).replace(/\+/g, ' ');
  const escapes = value => value.replace(/\\u\{?([0-9a-f]{1,6})\}?|\\x([0-9a-f]{2})/gi, (match, unicode, byte) => {
    const code = parseInt(unicode || byte, 16);
    return code <= 0x10ffff ? String.fromCodePoint(code) : match;
  }).replace(/\\(.)/g, '$1');
  const entities = value => value.replace(/&#x([0-9a-f]{1,6});?|&#(\d{1,7});?/gi, (match, hex, decimal) => {
    const code = hex ? parseInt(hex, 16) : Number(decimal);
    return code <= 0x10ffff ? String.fromCodePoint(code) : match;
  });
  const views = new Set([percent(text), escapes(text), entities(text)]);
  let all = text;
  for (let round = 0; round < 3; round += 1) all = entities(escapes(percent(all)));
  views.add(all);
  views.delete(text);
  return [...views];
}

function scrubUpstreamOnce(text, list) {
  const out = text.replace(ANY_KEY_RE, HIDDEN).replace(MASKED_RE, HIDDEN);
  return hideRuns(out, bodiesOf(list, UPSTREAM_RUN), UPSTREAM_RUN).replace(REPEATED_RE, HIDDEN);
}

/**
 * What a service said, safe to put in an answer: '' after a 401 or a 403
 * (say it in your own words), else the text without any trace of `secrets`
 * (see the top of this file), at most `max` characters. '' when nothing is left.
 */
export function upstreamText(status, message, secrets = [], max = UPSTREAM_MAX) {
  if (Number(status) === 401 || Number(status) === 403) return '';
  return scrubUpstream(message, secrets, max);
}

/** upstreamText without the status rule: any text that came from outside. */
export function scrubUpstream(message, secrets = [], max = UPSTREAM_MAX) {
  const raw = String(message ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').trim().slice(0, Math.max(max, 1) * 4);
  if (!raw) return '';
  const list = secretList(secrets);
  const out = scrubUpstreamOnce(raw, list);
  // Encoded so that the patterns can't see it: drop it all rather than guess.
  if (decodedViews(out).some(view => scrubUpstreamOnce(view, list) !== view)) return '';
  if (out.length <= max) return out;
  return `${out.slice(0, max).replace(/\[[a-z]*$/, '').trimEnd()}…`;
}

/**
 * A deep copy of an answer with every string scrubbed of `secrets` (see the
 * top of this file), except under the keys listed in `keep` (the one secret an
 * answer may carry on purpose, such as a webhook's new signing secret).
 */
export function scrubAnswer(value, secrets = [], keep = new Set()) {
  const list = secretList(secrets);
  const forms = [...new Set(list.flatMap(secret => [secret, encodeURIComponent(secret), JSON.stringify(secret).slice(1, -1)]))].sort((a, b) => b.length - a.length);
  const bodies = bodiesOf(list, ANSWER_RUN);
  const clean = text => {
    const whole = forms.reduce((out, form) => (out.includes(form) ? out.split(form).join(HIDDEN) : out), text);
    return hideRuns(whole.replace(LONG_KEY_RE, HIDDEN), bodies, ANSWER_RUN).replace(REPEATED_RE, HIDDEN);
  };
  const walk = entry => {
    if (typeof entry === 'string') return clean(entry);
    if (Array.isArray(entry)) return entry.map(walk);
    if (entry && typeof entry === 'object') return Object.fromEntries(Object.entries(entry).map(([key, inner]) => [key, keep.has(key) ? inner : walk(inner)]));
    return entry;
  };
  return walk(value);
}
