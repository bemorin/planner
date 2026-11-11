/**
 * _headers as Cloudflare Pages applies it, for the dev server
 * (scripts/serve.mjs), the repository check (scripts/check.mjs) and the tests
 * (tests/cache-headers.test.js, tests/csp.test.js), so the site's own file
 * behaves the same locally as in production:
 *   - a rule is a path pattern on its own line, then its headers on indented
 *     `Name: value` lines; `#` starts a comment;
 *   - a pattern is an exact path, or has a splat (*) that matches anything,
 *     slashes included, and :placeholders for one path segment each; it is
 *     matched against the path only, never the query;
 *   - every matching rule applies; when two set the same header, Pages joins
 *     their values with a comma;
 *   - Pages Functions (/api/*) set their own headers: _headers never applies
 *     to them.
 * Pure: no file or network access.
 */

const ESCAPE = /[-/\\^$+?.()|[\]{}]/g;

/** A rule's pattern as Pages compiles it: a splat matches anything, a :placeholder one segment. */
function patternRegExp(pattern) {
  const source = pattern.split('*').map(part => part.replace(ESCAPE, '\\$&').replace(/:[A-Za-z]\w*/g, '[^/]+')).join('.*');
  return new RegExp(`^${source}$`);
}

/** The rules of a _headers file: [{ pattern, headers: [[lower-case name, value]], match }], in their order. */
export function parseHeaders(text) {
  const rules = [];
  for (const line of String(text ?? '').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    if (/^\s/.test(line)) {
      const found = /^([^:]+):\s*(.*)$/.exec(trimmed);
      if (!found || !rules.length) throw new Error(`_headers: a header line outside a rule, or without a colon: ${trimmed}`);
      rules.at(-1).headers.push([found[1].trim().toLowerCase(), found[2].trim()]);
    } else {
      rules.push({ pattern: trimmed, headers: [], match: patternRegExp(trimmed) });
    }
  }
  return rules;
}

/** The headers a path receives: { matched: the matching rules, headers: { name: value } }, a repeated header's values joined. */
export function headersFor(rules, pathname) {
  const matched = rules.filter(rule => rule.match.test(pathname));
  const headers = {};
  for (const rule of matched) {
    for (const [name, value] of rule.headers) headers[name] = headers[name] ? `${headers[name]}, ${value}` : value;
  }
  return { matched, headers };
}

/** A Content-Security-Policy value as a Map: directive → its sources, in order. */
export function parseCsp(value) {
  const directives = new Map();
  for (const part of String(value ?? '').split(';')) {
    const [name, ...sources] = part.trim().split(/\s+/);
    if (name && !directives.has(name.toLowerCase())) directives.set(name.toLowerCase(), sources);
  }
  return directives;
}
