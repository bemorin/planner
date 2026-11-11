/** Escape user-authored text before inserting it into HTML templates. */
export function esc(value = '') {
  return String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[character]));
}

export function escAttr(value = '') {
  return esc(value);
}

/** Normalize a user-entered link to an explicit HTTP(S) URL. */
export function normalizeUrl(raw) {
  try {
    const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
    const url = new URL(candidate);
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    return url.href;
  } catch (_) {
    return '';
  }
}

export function safeUrl(raw) {
  return raw ? normalizeUrl(raw) : '';
}

export function linkLabel(raw) {
  try {
    const url = new URL(raw);
    return url.hostname.replace(/^www\./, '');
  } catch (_) {
    return 'Open link';
  }
}

// An address typed in angle brackets, alone or after a name, as an email “From”
// is written: “<support@example.com>”, “Support <support@example.com>”,
// “"Daily Planner, support" <support@example.com>”. The name is quoted, or
// plain words without < > @ , ; " in them, so “a@example.com, <b@example.com>”
// or “a@example.com <b@example.com>” (two addresses) is never read as one.
const BRACKETED_EMAIL_RE = /^(?:"[^"]*"|[^<>@,;"]*)\s*<\s*([^<>]*?)\s*>$/;

/**
 * The address in an email setting as it may be typed: “support@example.com”,
 * “<support@example.com>” or “Support <support@example.com>” (spaces around it
 * allowed) all give support@example.com. Anything else comes back trimmed, and
 * whoever shows it checks it is a plain address. The one rule for the planner
 * (src/config.js), the welcome pages (welcome/page-kit.js), the legal pages,
 * the build and the owner dashboard (legal/legal-details.js).
 */
export function emailAddress(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  return BRACKETED_EMAIL_RE.exec(text)?.[1] ?? text;
}
