/**
 * _redirects as Cloudflare Pages applies them, for the dev server
 * (scripts/serve.mjs) and the tests (tests/redirects.test.js), so the site's
 * own file behaves the same locally as in production:
 *   - one rule per line, `from to [status]`; `#` starts a comment; the status
 *     is 301, 302, 303, 307 or 308 (302 when left out); only destinations on
 *     this site (/…) are read here;
 *   - `from` is an exact path, or has a splat (*) that `:splat` repeats in
 *     `to`, and :placeholders for one path segment each;
 *   - the first matching line wins;
 *   - the address's query string is kept when the destination has none of its
 *     own. Cloudflare's asset server builds the Location header as
 *     `destination.pathname + (destination.search || search) + destination.hash`
 *     (@cloudflare/pages-shared, asset-server/handler.ts). The #hash never
 *     reaches the server; the browser keeps it across a redirect whose
 *     Location has none (RFC 9110, 10.2.2).
 * Pure: no file or network access.
 */

const STATUSES = [301, 302, 303, 307, 308];
const ESCAPE = /[-/\\^$*+?.()|[\]{}]/g;

/** A rule's `from` as Cloudflare compiles it: a splat matches anything, a :placeholder one segment. */
function ruleRegExp(from) {
  const pattern = from.split('*').map(part => part.replace(ESCAPE, '\\$&')).join('(?<splat>.*)')
    .replace(/:([A-Za-z]\w*)/g, '(?<$1>[^/]+)');
  return new RegExp(`^${pattern}$`);
}

/** The rules of a _redirects file: [{ from, to, status, match }], in their order. */
export function parseRedirects(text) {
  return String(text ?? '').split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'))
    .map(line => line.split(/\s+/))
    .filter(([from, to]) => /^\//.test(from || '') && /^\/(?![/\\])/.test(to || ''))
    .map(([from, to, status]) => {
      let match = null;
      try { match = ruleRegExp(from); } catch (_) { match = null; }
      return { from, to, status: STATUSES.includes(Number(status)) ? Number(status) : 302, match };
    })
    .filter(rule => rule.match);
}

/**
 * Where a request for `pathname` (as the address has it, still encoded) with
 * `search` ('' or '?…') is sent: { status, location }, or null when no rule matches.
 */
export function redirectFor(rules, pathname, search = '') {
  for (const rule of rules) {
    const found = rule.match.exec(pathname);
    if (!found) continue;
    let to = rule.to;
    for (const [name, value] of Object.entries(found.groups || {})) to = to.replaceAll(`:${name}`, value ?? '');
    const destination = new URL(to, 'http://site.invalid');
    // One leading slash only: "//host/" would be read as another site.
    const path = `/${destination.pathname.replace(/^\/+/, '')}`;
    return { status: rule.status, location: `${path}${destination.search || search}${destination.hash}` };
  }
  return null;
}
