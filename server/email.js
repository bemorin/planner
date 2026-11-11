// Transactional email through Resend for the owner API.
//
// One message: POST https://api.resend.com/emails
// Several:     POST https://api.resend.com/emails/batch (a JSON array of up to 100 messages)
// Header `Authorization: Bearer <RESEND_API_KEY>`; each message is
// { from, to: [email], subject, text, html?, reply_to? }.
//
// Limits that shape this module
// - Resend allows 2 requests per second by default: requests within one send
//   are spaced out, and a 429 is retried once after the pause Resend asks for.
//   The free plan sends 100 emails a day and 3,000 a month (EMAIL_DAILY_LIMIT).
// - Cloudflare Pages Functions allow 50 subrequests per invocation on the free
//   plan: one call sends at most MAX_BATCHES_PER_SEND batch requests
//   (EMAILS_PER_SEND emails); the dashboard simply sends again for the rest.
// `fetch` and the pause are injectable so tests never reach the network.
// Resend's own words in a failure never carry the key (server/secret-scrub.js):
// none after a 401 or a 403, scrubbed otherwise.

import { upstreamText } from './secret-scrub.js';

export const RESEND_EMAILS_URL = 'https://api.resend.com/emails';
export const RESEND_BATCH_URL = 'https://api.resend.com/emails/batch';
export const RESEND_MAX_BATCH = 100;
export const MAX_BATCHES_PER_SEND = 10;
export const EMAILS_PER_SEND = RESEND_MAX_BATCH * MAX_BATCHES_PER_SEND;
export const RESEND_MIN_INTERVAL_MS = 600;
export const DEFAULT_EMAIL_TIMEOUT_MS = 15000;
const RETRY_AFTER_MAX_MS = 5000;
export const ONE_EMAIL_FOOTER = 'This is the one email you asked for. Your address has now been deleted from our list.';

const ADDRESS_RE = /^[^\s@<>()[\]\\,;:"]{1,64}@[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?\.[a-z]{2,24}$/i;

/**
 * Escape text for HTML. Braces become entities too, so text such as
 * "{{ name }}" typed by a person is never read as template syntax.
 */
export const escapeHtml = value => String(value ?? '').replace(/[&<>"'{}]/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '{': '&#123;', '}': '&#125;' }[character]));

/** Parse "Ben Morin <hello@example.com>" or "hello@example.com". Returns { email, name? } or null. */
export function parseAddress(value) {
  const text = String(value ?? '').trim();
  const match = /^(.*?)\s*<([^<>]+)>$/.exec(text);
  const email = (match ? match[2] : text).trim();
  if (!ADDRESS_RE.test(email)) return null;
  const name = match ? match[1].trim().replace(/^"(.*)"$/, '$1').replace(/[\u0000-\u001f\u007f]+/g, ' ').trim() : '';
  return name ? { email, name } : { email };
}

/** { email, name? } → "Name <email>" (quoted when the name has special characters) or "email". */
export function formatAddress(address) {
  if (!address?.email) return '';
  const name = String(address.name ?? '').replace(/["\\]/g, '').trim();
  if (!name) return address.email;
  return /[(),.:;<>@[\]]/.test(name) ? `"${name}" <${address.email}>` : `${name} <${address.email}>`;
}

/** Plain text → HTML paragraphs: blank lines separate paragraphs, single line breaks become <br>. */
export function textToHtml(text) {
  return String(text ?? '').replace(/\r\n?/g, '\n').split(/\n[ \t]*\n+/)
    .map(paragraph => paragraph.trim())
    .filter(Boolean)
    .map(paragraph => `<p>${escapeHtml(paragraph).replace(/\n/g, '<br>\n')}</p>`)
    .join('\n');
}

/** Wrap body HTML in a minimal, client-safe document. */
export function htmlDocument(bodyHtml, footer = '') {
  const foot = footer ? `\n<hr style="border:0;border-top:1px solid #ddd8d0;margin:24px 0 12px">\n<p style="color:#706a62;font-size:13px">${escapeHtml(footer)}</p>` : '';
  return `<!doctype html>\n<html><body style="margin:0;padding:24px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.55;color:#1c1a17">\n<div style="max-width:560px">\n${bodyHtml}${foot}\n</div>\n</body></html>`;
}

/** The waitlist announcement: the owner's plain text plus the one-email footer. */
export function announcementEmail({ subject, text }) {
  const body = String(text ?? '').replace(/\r\n?/g, '\n').trim();
  return {
    subject: String(subject ?? '').trim(),
    html: htmlDocument(textToHtml(body), ONE_EMAIL_FOOTER),
    text: `${body}\n\n---\n${ONE_EMAIL_FOOTER}\n`
  };
}

/**
 * The configuration page's test email (POST /api/admin/email/test), to
 * OWNER_EMAIL only: short, and nothing in it about any list.
 */
export function ownerTestEmail({ sentAt = new Date() } = {}) {
  const date = new Date(sentAt);
  const when = Number.isNaN(date.getTime()) ? '' : `${date.toISOString().slice(0, 16).replace('T', ' ')} UTC`;
  const lines = [
    `This test email was sent from the configuration page of Daily Planner${when ? ` at ${when}` : ''}.`,
    'If you can read it, Resend, EMAIL_FROM and OWNER_EMAIL work together: question notifications and announcements can be sent.',
    'Nothing else was sent.'
  ];
  return { subject: 'Daily Planner: test email', html: htmlDocument(lines.map(line => `<p>${escapeHtml(line)}</p>`).join('\n')), text: `${lines.join('\n\n')}\n` };
}

/**
 * One Resend message per recipient (nobody sees anyone else's address).
 * recipients: [{ email }]; replyTo: { email, name? } or null.
 */
export function buildResendMessages({ from, subject, html = '', text = '', replyTo = null, recipients }) {
  const sender = typeof from === 'string' ? from : formatAddress(from);
  const reply = replyTo?.email ? replyTo.email : '';
  return recipients.map(recipient => ({
    from: sender,
    to: [recipient.email],
    subject,
    text,
    ...(html ? { html } : {}),
    ...(reply ? { reply_to: reply } : {})
  }));
}

/** Hex SHA-256 of the parts, for Idempotency-Key headers. */
export async function idempotencyKey(...parts) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(parts.map(String).join('\n')));
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

/** A failed answer of Resend, in words. After a 401 or a 403 nothing of Resend's own text is kept (it may repeat the key). */
async function describeFailure(response, secrets) {
  const body = await response.json().catch(() => null);
  if (response.status === 401) return 'Resend refused RESEND_API_KEY (HTTP 401)';
  if (response.status === 403) return 'Resend refused to send (HTTP 403): check that the domain of EMAIL_FROM is verified in Resend → Domains and that the key may send from it';
  const detail = upstreamText(response.status, typeof body?.message === 'string' ? body.message : '', secrets, 300);
  return `Resend answered HTTP ${response.status}${detail ? `: ${detail}` : ''}`;
}

const defaultSleep = ms => new Promise(resolveSleep => { setTimeout(resolveSleep, ms); });

/**
 * @param {object} options
 * @param {string} [options.apiKey]  RESEND_API_KEY
 * @param {string} [options.from]    EMAIL_FROM, "Name <address>" or an address on a domain verified in Resend
 * @param {typeof fetch} [options.fetch]
 * @param {number} [options.minIntervalMs] pause between two requests of one send (Resend: 2 per second)
 * @param {(ms: number) => Promise<void>} [options.sleep]
 */
export function createResendMailer({ apiKey = '', from = '', fetch: fetchImpl = globalThis.fetch?.bind(globalThis), minIntervalMs = RESEND_MIN_INTERVAL_MS, sleep = defaultSleep } = {}) {
  const key = String(apiKey || '').trim();
  const sender = parseAddress(from);
  const configured = !!(key && sender && fetchImpl);

  /** POST once. Resolves with the response; rejects on network failure or after `timeoutMs`. */
  async function postOnce(url, body, headers, timeoutMs) {
    const controller = new AbortController();
    let timer = 0;
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new Error(`Resend did not answer within ${Math.round(timeoutMs / 100) / 10} s`)); }, timeoutMs);
    });
    try {
      const request = fetchImpl(url, { method: 'POST', headers, body: JSON.stringify(body), signal: controller.signal });
      return await Promise.race([request, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  /** POST one request; a 429 is retried once after the pause Resend asks for. */
  async function post(url, body, { timeoutMs, idempotency }) {
    const headers = { authorization: `Bearer ${key}`, 'content-type': 'application/json', accept: 'application/json', ...(idempotency ? { 'idempotency-key': idempotency } : {}) };
    let response = await postOnce(url, body, headers, timeoutMs);
    if (response.status === 429) {
      const seconds = Number(response.headers?.get?.('retry-after'));
      await sleep(Math.min(RETRY_AFTER_MAX_MS, Math.max(minIntervalMs, Number.isFinite(seconds) ? seconds * 1000 : 1000)));
      response = await postOnce(url, body, headers, timeoutMs);
    }
    if (!response.ok) throw new Error(await describeFailure(response, [key]));
    return response.json().catch(() => ({}));
  }

  return {
    configured,
    sender,
    from: formatAddress(sender),
    /**
     * Send one message to every recipient: POST /emails for one recipient,
     * /emails/batch (≤ 100 messages) otherwise. Calls `onBatch(recipients)`
     * after each accepted request and stops at the first failure, which is
     * thrown with `sent` (recipients accepted before it) attached.
     * `idempotency` (string or async (batch) => string) becomes the
     * Idempotency-Key header, so a repeated request is not sent twice.
     */
    async send({ subject, html = '', text = '', replyTo = null, recipients }, { timeoutMs = DEFAULT_EMAIL_TIMEOUT_MS, onBatch = null, idempotency = null } = {}) {
      if (!configured) throw new Error('Email is not configured.');
      let sent = 0;
      let lastRequestAt = 0;
      for (let start = 0; start < recipients.length; start += RESEND_MAX_BATCH) {
        const batch = recipients.slice(start, start + RESEND_MAX_BATCH);
        const messages = buildResendMessages({ from: sender, subject, html, text, replyTo, recipients: batch });
        const wait = lastRequestAt ? minIntervalMs - (Date.now() - lastRequestAt) : 0;
        if (wait > 0) await sleep(wait);
        lastRequestAt = Date.now();
        try {
          const requestKey = typeof idempotency === 'function' ? await idempotency(batch) : idempotency;
          await post(messages.length === 1 ? RESEND_EMAILS_URL : RESEND_BATCH_URL, messages.length === 1 ? messages[0] : messages, { timeoutMs, idempotency: requestKey });
        } catch (error) {
          // A network failure (fetch's TypeError) in plain words; our own messages as they are.
          const failure = new Error(error?.name === 'AbortError' ? 'Resend did not answer in time' : error instanceof TypeError ? 'Resend couldn’t be reached' : String(error?.message || 'Resend request failed'));
          failure.sent = sent;
          throw failure;
        }
        sent += batch.length;
        if (!onBatch) continue;
        try {
          await onBatch(batch);
        } catch (error) {
          const failure = new Error(String(error?.message || 'Could not record the batch'));
          failure.sent = sent;
          failure.afterSend = true;
          throw failure;
        }
      }
      return { sent };
    }
  };
}
