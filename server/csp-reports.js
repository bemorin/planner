// Reports of the security headers (1.35): what browsers blocked
// under the site's Content-Security-Policy (_headers), sent by the browser
// itself to POST /api/csp-report — `report-uri` (application/csp-report, one
// report) or `report-to` (application/reports+json, a list) — and kept as
// daily counts only (table csp_reports, migrations/schema.sql): the directive, the
// blocked origin (or inline, eval…: never a full address) and the page's path
// (never its query). No IP address and nothing about the visitor; reports of
// browser extensions (their own scripts, not the site's) are left out. The
// Configuration page lists what was blocked in the last 7 days.
// Pure: no store or network access (unit-tested in tests/csp-reports.test.js).

/** At most this many reports are read from one request (a browser sends one, or a few at a time). */
export const CSP_REPORTS_PER_REQUEST = 10;
/** The Configuration page's window. */
export const CSP_REPORT_DAYS = 7;
export const CSP_REPORT_TYPES = Object.freeze(['application/csp-report', 'application/reports+json']);

const KEYWORDS = new Set(['inline', 'eval', 'wasm-eval', 'trusted-types-policy', 'trusted-types-sink', 'data', 'blob', 'self']);
const EXTENSION_RE = /^(?:chrome|moz|safari|safari-web|ms-browser|edge)-extension:/i;
const text = value => (typeof value === 'string' ? value.trim() : '');

/** The content type of a report request, when it is one of CSP_REPORT_TYPES; '' otherwise. */
export function cspReportType(contentType) {
  const type = String(contentType || '').split(';')[0].trim().toLowerCase();
  return CSP_REPORT_TYPES.includes(type) ? type : '';
}

/** The directive a report names: its first word, lower case ('script-src-elem'); '' when it isn't one. */
export function reportDirective(value) {
  const word = text(value).split(/\s+/)[0].toLowerCase();
  return /^[a-z][a-z-]{1,39}$/.test(word) ? word : '';
}

/**
 * What was blocked, without the address itself: the origin of a URL
 * ('https://example.com'), or the browser's keyword ('inline', 'eval',
 * 'data', 'blob' …); 'other' for anything else; null for a browser extension.
 */
export function blockedSource(value) {
  const raw = text(value);
  if (!raw) return 'inline';
  if (EXTENSION_RE.test(raw)) return null;
  const word = raw.toLowerCase().replace(/:$/, '');
  if (KEYWORDS.has(word)) return word;
  try {
    const url = new URL(raw);
    if (url.protocol === 'http:' || url.protocol === 'https:') return url.origin;
    if (url.protocol === 'data:' || url.protocol === 'blob:') return url.protocol.slice(0, -1);
  } catch (_) { /* not a URL */ }
  return 'other';
}

/** The page's path ('/welcome/'), without its query or fragment; '' when the address can't be read. */
export function reportPage(value) {
  try {
    const url = new URL(text(value));
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    const path = url.pathname.replace(/[^A-Za-z0-9/._~-]/g, '');
    return path.slice(0, 100) || '/';
  } catch (_) {
    return '';
  }
}

/** One report's counted fields, or null when it isn't a usable CSP violation (or comes from an extension). */
function countedFields({ directive, blocked, page, source }) {
  const name = reportDirective(directive);
  const where = reportPage(page);
  if (!name || !where) return null;
  if (EXTENSION_RE.test(text(source))) return null;
  const what = blockedSource(blocked);
  return what ? { directive: name, blocked: what, page: where } : null;
}

/**
 * The reports of one request's body (`type` from cspReportType): up to
 * CSP_REPORTS_PER_REQUEST of { directive, blocked, page }, [] when none is usable.
 */
export function readCspReports(type, body) {
  let data;
  try { data = JSON.parse(String(body || '')); } catch (_) { return []; }
  if (type === 'application/csp-report') {
    const report = data && typeof data === 'object' ? data['csp-report'] : null;
    if (!report || typeof report !== 'object') return [];
    const fields = countedFields({ directive: report['effective-directive'] || report['violated-directive'], blocked: report['blocked-uri'], page: report['document-uri'], source: report['source-file'] });
    return fields ? [fields] : [];
  }
  if (type === 'application/reports+json') {
    if (!Array.isArray(data)) return [];
    return data.filter(entry => entry && typeof entry === 'object' && entry.type === 'csp-violation' && entry.body && typeof entry.body === 'object')
      .slice(0, CSP_REPORTS_PER_REQUEST)
      .map(entry => countedFields({ directive: entry.body.effectiveDirective || entry.body.violatedDirective, blocked: entry.body.blockedURL, page: entry.body.documentURL || entry.url, source: entry.body.sourceFile }))
      .filter(Boolean);
  }
  return [];
}

/** The Configuration page's words for what was blocked: "script-src: https://x.example on /welcome/ (3 times)". */
export function blockedWords(rows) {
  return rows.map(row => `${row.directive}: ${row.blocked} on ${row.page} (${row.count === 1 ? 'once' : `${row.count} times`})`);
}
