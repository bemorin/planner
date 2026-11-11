// The owner's configuration page (/admin/configuration/): “Check
// everything” asks the server to try every production setting with its service
// (POST admin/config/check, server/admin-config.js) and shows one row per
// setting, grouped as on Cloudflare: OK, Problem, Missing, Optional and
// missing, or Present and not tested. “Fix first” lists what to do, required
// settings first, each with what it blocks and the exact fix to copy.
//
// Never a secret: the server answers states, lengths and forms only. Values
// generated here (ADMIN_TOKEN, ADMIN_TOTP_SECRET) are drawn in this browser
// (./config-model.js) and live in this page only: never sent, never stored.
// Sign-in is the dashboard's: the signed 8-hour session kept in this tab
// (sessionStorage), never the token.

import { fixFirst, isWarning, LEVEL_LABELS, newAdminToken, newTotpSecret, otpauthUri, repositoryDocHref, shownCounts, shownState, stateLabel, summaryText, totalsText, utcStamp } from './config-model.js';

const SESSION_KEY = 'daily-planner-owner-session';
const API = (() => {
  const configured = globalThis.__DAILY_PLANNER_CONFIG__?.PLANNER_API_URL;
  return (typeof configured === 'string' && configured.trim() ? configured.trim() : '../../api').replace(/\/+$/, '');
})();
const SIGNED_OUT = 'Your session has ended. Please sign in again.';
const OFFLINE = 'The API couldn’t be reached. Check the connection, then try again.';

/** A failed answer in words: the server's own message, or plain words for a server failure without one. */
function failureText(response, body, what) {
  if (response.status >= 500 && (!body?.error || body.error === 'Server error')) return `The server had a problem with ${what} (HTTP ${response.status}). Nothing was changed: try again in a minute.`;
  return body?.error || `${what.charAt(0).toUpperCase()}${what.slice(1)} failed (HTTP ${response.status}).`;
}

const $ = (selector, root = document) => root.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
const slug = value => String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

// A shape for each state, so it never rests on colour alone.
const SVG = path => `<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" focusable="false">${path}</svg>`;
const STATE_ICONS = {
  ok: SVG('<path d="m6.5 12.5 3.6 3.6 7.4-8.2"/>'),
  problem: SVG('<path d="M12 6.5v7"/><path d="M12 17.5v.01"/>'),
  missing: SVG('<path d="M7 12h10"/>'),
  'optional-missing': SVG('<circle cx="12" cy="12" r="5.5"/>'),
  untested: SVG('<path d="M9.6 9.3a2.5 2.5 0 1 1 3.4 2.3c-.6.3-1 .8-1 1.5v.6"/><path d="M12 17.3v.01"/>')
};
// A warning (a problem that is a reminder) keeps the problem's “!”, in amber.
STATE_ICONS.warning = STATE_ICONS.problem;

let session = readSession();
let expiryTimer = 0;
// The server's answer, as it came.
let lastResult = null;
let checking = false;
// Copy texts of the rendered fixes, by index (long SQL stays out of the attributes).
let copyTexts = [];
// Values generated in this page: in memory only, gone when the page is left.
const generated = { token: '', totp: '' };

function readSession() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(SESSION_KEY) || 'null');
    if (typeof saved?.session === 'string' && Number(saved.expiresAt) > Date.now() + 5000) return { session: saved.session, expiresAt: Number(saved.expiresAt) };
  } catch (_) {}
  return null;
}

function saveSession(value) {
  session = value;
  try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(value)); } catch (_) {}
  scheduleExpiry();
}

function scheduleExpiry() {
  clearTimeout(expiryTimer);
  if (session) expiryTimer = setTimeout(() => signOut(SIGNED_OUT), Math.max(0, session.expiresAt - Date.now()));
}

/** The page's authenticated fetch: a Response (network failures throw). */
function call(path, init = {}) {
  const headers = { ...(init.headers || {}) };
  if (session) headers.authorization = `Bearer ${session.session}`;
  return fetch(`${API}/${String(path).replace(/^\/+/, '')}`, { ...init, headers, cache: 'no-store' });
}

// ---- Views ---------------------------------------------------------------------

function show(view) {
  $('[data-cfg-login]').hidden = view !== 'login';
  $('[data-cfg-body]').hidden = view !== 'body';
  $('[data-cfg-actions]').hidden = view !== 'body';
}

function setNotice(message = '') {
  const notice = $('[data-cfg-notice]');
  notice.hidden = !message;
  notice.textContent = message;
}

/** A message under the buttons; `quiet` ones are only read out (the totals are on screen already). */
function setResult(message = '', error = false, { quiet = false } = {}) {
  const target = $('[data-cfg-result]');
  target.textContent = message;
  target.classList.toggle('is-error', error);
  target.classList.toggle('sr-only', quiet);
}

function showLogin(message = '') {
  show('login');
  const error = $('[data-cfg-error]');
  error.hidden = !message;
  error.textContent = message;
  $('[data-cfg-login] input[name="token"]').focus();
}

function sessionLabel() {
  if (!session) return '';
  const date = new Date(session.expiresAt);
  const time = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return `Signed in until ${date.toDateString() === new Date().toDateString() ? time : `${date.toLocaleDateString(undefined, { weekday: 'short' })} ${time}`}`;
}

function showBody() {
  show('body');
  $('[data-cfg-session]').textContent = sessionLabel();
}

function clearRendered() {
  lastResult = null;
  copyTexts = [];
  generated.token = '';
  generated.totp = '';
  $('[data-cfg-groups]').innerHTML = '';
  $('[data-cfg-first]').hidden = true;
  $('[data-cfg-tally]').hidden = true;
  $('[data-cfg-notes]').hidden = true;
  $('[data-cfg-copy]').disabled = true;
  setResult('');
}

function signOut(message = '') {
  session = null;
  clearTimeout(expiryTimer);
  try { sessionStorage.removeItem(SESSION_KEY); } catch (_) {}
  clearRendered();
  setNotice('');
  showLogin(message);
}

// ---- Rendering -------------------------------------------------------------------

const badge = item => `<span class="cfg-badge is-${esc(item.state)}${item.state === 'missing' ? ` is-${esc(item.level)}` : ''}${isWarning(item) ? ' is-warning' : ''}">${STATE_ICONS[shownState(item)] || ''}<span>${esc(stateLabel(item))}</span></span>`;

function copyRow(label, text, kind = '') {
  const index = copyTexts.push(String(text)) - 1;
  const button = `<button class="text-button cfg-copy__button" type="button" data-cfg-copy-index="${index}" aria-label="Copy: ${esc(label)}">Copy</button>`;
  if (kind === 'sql') return `<div class="cfg-copy is-block"><span class="cfg-copy__label">${esc(label)}</span>${button}<pre class="cfg-copy__pre" tabindex="0" aria-label="${esc(label)}"><code>${esc(text)}</code></pre></div>`;
  // A long value (a key, a link) on its own line under its label, the Copy button beside the label.
  if (String(text).length > 56) return `<div class="cfg-copy is-block"><span class="cfg-copy__label">${esc(label)}</span>${button}<code class="cfg-copy__value is-long">${esc(text)}</code></div>`;
  return `<div class="cfg-copy"><span class="cfg-copy__label">${esc(label)}</span><code class="cfg-copy__value">${esc(text)}</code>${button}</div>`;
}

function fixHtml(item, { title = 'How to fix' } = {}) {
  const fix = item.fix;
  if (!fix?.steps?.length) return '';
  return `<div class="cfg-fix__how"><p class="cfg-fix__title">${esc(title)}</p><ol class="cfg-fix__steps">${fix.steps.map(step => `<li>${esc(step)}</li>`).join('')}</ol>${(fix.copy || []).map(entry => copyRow(entry.label, entry.text, entry.kind)).join('')}</div>`;
}

const GENERATE_TEXT = {
  token: 'A new token of 48 letters and digits, drawn in this browser.',
  totp: 'A new setup key for your authenticator app (32 base32 characters), drawn in this browser.'
};

function generatedHtml(kind) {
  const keep = '<p class="cfg-gen__note">Kept nowhere: not sent, not stored. Copy it now; it is gone when you leave this page.</p>';
  if (kind === 'token' && generated.token) {
    return `${copyRow('New ADMIN_TOKEN', generated.token)}<p class="cfg-gen__note">Set it as a Secret, redeploy, then sign in again with it: changing the token signs every session out, and changes every waitlist removal link.</p>${keep}`;
  }
  if (kind === 'totp' && generated.totp) {
    return `${copyRow('New ADMIN_TOTP_SECRET', generated.totp)}${copyRow('Authenticator link', otpauthUri(generated.totp))}<p class="cfg-gen__note">Add it to your authenticator app first (“Enter a setup key”, time-based, or paste the link into a password manager), then set it as a Secret and redeploy.</p>${keep}`;
  }
  return '';
}

function generateHtml(item) {
  if (!item.generate) return '';
  const kind = item.generate;
  const made = !!generated[kind];
  return `<div class="cfg-gen" data-cfg-gen="${esc(kind)}">
    <p class="cfg-gen__text">${esc(GENERATE_TEXT[kind] || '')}</p>
    <div class="cfg-gen__out" data-cfg-gen-out>${generatedHtml(kind)}</div>
    <div><button class="secondary-button cfg-gen__button" type="button" data-cfg-generate="${esc(kind)}">${made ? 'Generate another' : 'Generate a value'}</button></div>
  </div>`;
}

function itemHtml(item) {
  const needsFix = item.state === 'problem' || item.state === 'missing';
  const tags = [
    `<span class="cfg-tag is-${esc(item.level)}">${esc(LEVEL_LABELS[item.level] || item.level)}</span>`,
    item.secret ? '<span class="cfg-tag is-secret">Secret</span>' : ''
  ].join('');
  const details = [
    ['What it does', item.unlocks],
    ['Where the value comes from', item.source],
    ['Set as', item.type],
    ['How it was checked', item.test]
  ].filter(([, value]) => value);
  const optionalFix = item.state === 'optional-missing' ? fixHtml(item, { title: 'How to set it' }) : '';
  // A value to generate is offered in the open while the setting needs one; once it is fine, under Details (to replace it).
  const generateOpen = needsFix || item.state === 'optional-missing';
  return `<li class="cfg-item is-${esc(item.state)}${isWarning(item) ? ' is-warning' : ''}" id="cfg-${slug(item.id)}" tabindex="-1">
    ${badge(item)}
    <div class="cfg-item__main">
      <p class="cfg-item__title"><code class="cfg-name">${esc(item.name)}</code><span class="cfg-tags">${tags}</span></p>
      <p class="cfg-item__summary">${esc(item.summary)}</p>
      ${item.shape ? `<p class="cfg-item__shape">${esc(item.shape)}</p>` : ''}
      ${needsFix ? `<div class="cfg-fix"><p class="cfg-fix__blocks"><b>${item.level === 'optional' ? 'If left blank' : 'What it blocks'}</b> ${esc(item.blocks)}</p>${fixHtml(item)}</div>` : ''}
      ${generateOpen ? generateHtml(item) : ''}
      <details class="cfg-more"><summary>Details</summary><dl>${details.map(([label, value]) => `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>`).join('')}</dl>${optionalFix}${generateOpen ? '' : generateHtml(item)}</details>
    </div>
  </li>`;
}

function groupTally(rows) {
  const counts = {};
  for (const row of rows) counts[shownState(row)] = (counts[shownState(row)] || 0) + 1;
  const parts = [['problem', 'problem', 'problems'], ['warning', 'warning', 'warnings'], ['missing', 'missing', 'missing'], ['untested', 'not tested', 'not tested'], ['ok', 'OK', 'OK']]
    .filter(([state]) => counts[state]).map(([state, one, many]) => `${counts[state]} ${counts[state] === 1 ? one : many}`);
  return parts.join(' · ');
}

function renderGroups(result) {
  const items = result.items || [];
  $('[data-cfg-groups]').innerHTML = (result.groups || []).map(group => {
    const rows = items.filter(item => item.group === group.id);
    if (!rows.length) return '';
    return `<section class="owner-card cfg-group" aria-labelledby="cfg-group-${esc(group.id)}" data-cfg-group="${esc(group.id)}">
      <header class="cfg-group__head"><div><h2 id="cfg-group-${esc(group.id)}">${esc(group.title)}</h2><p>${esc(group.text)}</p></div><p class="cfg-group__tally">${esc(groupTally(rows))}</p></header>
      <ul class="cfg-list">${rows.map(itemHtml).join('')}</ul>
    </section>`;
  }).join('');
}

function renderFirst(result) {
  const first = fixFirst(result.items || []);
  const section = $('[data-cfg-first]');
  section.hidden = !first.length;
  if (!first.length) return;
  const required = first.filter(item => item.level === 'required' && !isWarning(item)).length;
  const warnings = first.filter(isWarning).length;
  // Only reminders: the box takes the warning's amber, not the problem's red.
  section.classList.toggle('is-warnings', warnings === first.length);
  $('[data-cfg-first-caption]').textContent = required
    ? `${required} required ${required === 1 ? 'setting needs' : 'settings need'} you first; the rest follow by importance${warnings ? ', and the warnings come last: they block nothing' : ''}. Each line opens its fix below.`
    : warnings === first.length
      ? 'Nothing is blocking. These are reminders of what to change later; each line opens its fix below.'
      : `Nothing required is wrong. These would still help, most useful first${warnings ? ', then the warnings, which block nothing' : ''}. Each line opens its fix below.`;
  $('[data-cfg-first-list]').innerHTML = first.map(item => `<li class="cfg-first__item">
      <a class="cfg-first__link" href="#cfg-${slug(item.id)}" data-cfg-jump="cfg-${slug(item.id)}">
        ${badge(item)}
        <span class="cfg-first__text"><span class="cfg-first__name"><code>${esc(item.name)}</code><span class="cfg-tag is-${esc(item.level)}">${esc(LEVEL_LABELS[item.level] || item.level)}</span></span><span class="cfg-first__summary">${esc(item.summary)}</span><span class="cfg-first__blocks">${item.level === 'optional' ? 'If left blank' : 'Blocks'}: ${esc(item.blocks)}</span></span>
        <span class="cfg-first__go">How to fix<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" focusable="false"><path d="M12 5v14"/><path d="m6 13 6 6 6-6"/></svg></span>
      </a>
    </li>`).join('');
}

// The totals, most urgent first: [state, one, many].
const CHIP_WORDS = [['problem', 'problem', 'problems'], ['warning', 'warning', 'warnings'], ['missing', 'missing', 'missing'], ['untested', 'present, not tested', 'present, not tested'], ['ok', 'OK', 'OK'], ['optional-missing', 'optional, missing', 'optional, missing']];

function renderTally(result) {
  const counts = shownCounts(result.counts || {});
  const tally = $('[data-cfg-tally]');
  tally.innerHTML = CHIP_WORDS.filter(([state]) => counts[state]).map(([state, one, many]) => `<li class="cfg-chip is-${state}">${STATE_ICONS[state]}<b>${Number(counts[state])}</b><span>${esc(Number(counts[state]) === 1 ? one : many)}</span></li>`).join('');
  tally.hidden = !tally.innerHTML;
  const notes = $('[data-cfg-notes]');
  notes.innerHTML = (result.notes || []).map(note => `<li>${esc(note)}</li>`).join('');
  notes.hidden = !notes.innerHTML;
}

function render(result) {
  copyTexts = [];
  const date = new Date(result.checkedAt);
  const local = Number.isNaN(date.getTime()) ? '' : date.toLocaleString(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const status = $('[data-cfg-status]');
  const ms = Math.max(0, Number(result.durationMs) || 0);
  const took = ms < 100 ? 'in under 0.1 seconds' : ms < 1000 ? 'in less than a second' : `in ${(ms / 1000).toFixed(1)} seconds`;
  status.textContent = `Last checked ${local} (${utcStamp(result.checkedAt)}), ${took}. Check again after each change on Cloudflare, once the new deployment is live.`;
  renderTally(result);
  renderFirst(result);
  renderGroups(result);
  $('[data-cfg-copy]').disabled = false;
}

/** Re-render the rows that show generated values (the same value on every row that shares it). */
function refreshGenerated(kind) {
  for (const box of document.querySelectorAll(`[data-cfg-gen="${kind}"]`)) {
    box.querySelector('[data-cfg-gen-out]').innerHTML = generatedHtml(kind);
    const button = box.querySelector('[data-cfg-generate]');
    button.textContent = 'Generate another';
  }
}

// ---- Actions -----------------------------------------------------------------------

async function runCheck() {
  if (checking) return;
  checking = true;
  const button = $('[data-cfg-check]');
  const groups = $('[data-cfg-groups]');
  button.disabled = true;
  button.classList.add('is-busy');
  $('[data-cfg-check-label]').textContent = 'Checking…';
  groups.setAttribute('aria-busy', 'true');
  setResult('Checking every setting…', false, { quiet: true });
  try {
    const response = await call('admin/config/check', { method: 'POST' });
    if (response.status === 401) { signOut(SIGNED_OUT); return; }
    const body = await response.json().catch(() => null);
    if (!response.ok || !Array.isArray(body?.items)) {
      const message = response.status === 404 ? 'This API has no configuration check yet: deploy 1.31 or later, then try again.' : failureText(response, body, 'the check');
      setResult(message, true);
      return;
    }
    lastResult = body;
    render(body);
    setResult(`Checked: ${totalsText(body.counts)}.`, false, { quiet: true });
  } catch (_) {
    setResult(OFFLINE, true);
  } finally {
    checking = false;
    button.disabled = false;
    button.classList.remove('is-busy');
    $('[data-cfg-check-label]').textContent = lastResult ? 'Check again' : 'Check everything';
    groups.setAttribute('aria-busy', 'false');
  }
}

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
  if (!button) return copied;
  if (!button.dataset.label) button.dataset.label = button.textContent;
  button.textContent = copied ? 'Copied' : 'Copy failed';
  clearTimeout(Number(button.dataset.timer));
  button.dataset.timer = String(setTimeout(() => { button.textContent = button.dataset.label; }, 1600));
  return copied;
}

// Its own route (POST admin/email/test): one short email to OWNER_EMAIL, rate-limited, never the waitlist's.
async function sendTestEmail(button) {
  button.disabled = true;
  setResult('Sending a test email…');
  try {
    const response = await call('admin/email/test', { method: 'POST' });
    if (response.status === 401) { signOut(SIGNED_OUT); return; }
    const body = await response.json().catch(() => null);
    if (response.ok) setResult('Test email sent to OWNER_EMAIL. If it hasn’t arrived in a few minutes, look in spam, then in Resend → Emails.');
    else if (response.status === 404) setResult('This API has no test email yet: deploy 1.31 or later, then try again.', true);
    else setResult(failureText(response, body, 'the test email'), true);
  } catch (_) {
    setResult(OFFLINE, true);
  } finally {
    button.disabled = false;
  }
}

async function generate(kind, button) {
  if (kind === 'token') generated.token = newAdminToken();
  else if (kind === 'totp') generated.totp = newTotpSecret();
  else return;
  refreshGenerated(kind);
  const box = button.closest('[data-cfg-gen]');
  box?.querySelector('[data-cfg-gen-out] .cfg-copy__button')?.focus();
}

// ---- Wiring ------------------------------------------------------------------------

$('[data-cfg-login]').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const submit = form.querySelector('[type="submit"]');
  const token = form.elements.token.value;
  const code = form.elements.code.value.replace(/\s+/g, '');
  submit.disabled = true;
  try {
    const response = await call('admin/session', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token, code }) });
    const body = await response.json().catch(() => null);
    if (response.ok && typeof body?.session === 'string') {
      form.reset();
      saveSession({ session: body.session, expiresAt: Date.parse(body.expiresAt) || Date.now() + 8 * 3600 * 1000 });
      $('[data-cfg-error]').hidden = true;
      showBody();
      $('[data-cfg-check]').focus();
      return;
    }
    showLogin(response.status === 401 ? 'Sign-in failed. Check the token and the code, then try again.' : body?.error || `Sign-in failed (HTTP ${response.status}).`);
  } catch (_) {
    showLogin(OFFLINE);
  } finally {
    submit.disabled = false;
  }
});

$('[data-cfg-signout]').addEventListener('click', () => signOut());
$('[data-cfg-check]').addEventListener('click', runCheck);
$('[data-cfg-copy]').addEventListener('click', event => { if (lastResult) copyText(summaryText(lastResult), event.currentTarget); });

$('[data-cfg-test-email]').addEventListener('click', event => sendTestEmail(event.currentTarget));

document.addEventListener('click', event => {
  const copy = event.target.closest('[data-cfg-copy-index]');
  if (copy) { copyText(copyTexts[Number(copy.dataset.cfgCopyIndex)] ?? '', copy); return; }
  const make = event.target.closest('[data-cfg-generate]');
  if (make) { generate(make.dataset.cfgGenerate, make); return; }
  const jump = event.target.closest('[data-cfg-jump]');
  if (jump) {
    const target = document.getElementById(jump.dataset.cfgJump);
    if (!target) return;
    event.preventDefault();
    target.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    target.focus({ preventScroll: true });
    history.replaceState(null, '', `#${target.id}`);
  }
});

// The guide to these checks is in the repository (the site doesn't publish docs/): a link to it on GitHub when the
// deployment sets DAILY_PLANNER_GITHUB_URL.
const docsHref = repositoryDocHref(globalThis.__DAILY_PLANNER_CONFIG__?.PROJECT_GITHUB_URL, 'docs/configuration.md');
const docsNote = $('[data-cfg-docs]');
if (docsHref && docsNote) docsNote.innerHTML = `<a href="${esc(docsHref)}" rel="noopener"><code>docs/configuration.md</code></a>, on GitHub`;

if (session) {
  scheduleExpiry();
  showBody();
} else showLogin();
