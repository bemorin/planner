/**
 * The Content-Security-Policy in _headers allows exactly the inline scripts
 * the site's pages carry, by their SHA-256 hash ('sha256-…' in script-src),
 * and no other inline code. This module finds those scripts and compares
 * them with the policy, for scripts/check.mjs and tests/csp.test.js:
 *   - an inline script is a <script> without src whose type runs as code (no
 *     type, a JavaScript type, module or importmap); a data block, such as
 *     application/ld+json, is never run and needs no hash;
 *   - the hash is the browser's: SHA-256 of the exact text between <script …>
 *     and </script>, as UTF-8, in base64;
 *   - an event-handler attribute (onclick="…") or a javascript: address would
 *     need 'unsafe-hashes' or 'unsafe-inline', which the policy never gives:
 *     both are reported.
 * Pure apart from hashing: no file or network access.
 */

import { createHash } from 'node:crypto';
import { headersFor, parseCsp } from './headers.mjs';

const RUNS = /^(?:module|importmap|(?:text|application)\/(?:x-)?(?:java|ecma|j|live)script(?:1\.[0-5])?)$/i;
const TOKENS = /<!--[\s\S]*?-->|<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;

/** The browser's hash of an inline script: 'sha256-<base64>' (without the quotes). */
export function scriptHash(text) {
  return `sha256-${createHash('sha256').update(text, 'utf8').digest('base64')}`;
}

/** The value of an attribute in a tag's attribute text, or null when it is absent. */
function attribute(attributes, name) {
  const found = new RegExp(`(?:^|\\s)${name}(?:\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+)))?(?=\\s|$)`, 'i').exec(attributes);
  return found ? (found[1] ?? found[2] ?? found[3] ?? '') : null;
}

/** The inline scripts of a page that run: [{ line, hash, length }], comments skipped. */
export function inlineScripts(html) {
  const scripts = [];
  for (const match of String(html).matchAll(TOKENS)) {
    if (match[0].startsWith('<!--')) continue;
    const attributes = match[1] || '';
    if (attribute(attributes, 'src') !== null) continue;
    const type = (attribute(attributes, 'type') || '').trim();
    if (type && !RUNS.test(type)) continue;
    const line = html.slice(0, match.index).split('\n').length;
    scripts.push({ line, hash: scriptHash(match[2]), length: match[2].length });
  }
  return scripts;
}

/** Inline code the policy can never allow: event-handler attributes and javascript: addresses, by line. */
export function inlineHandlers(html) {
  const found = [];
  const markup = String(html).replace(TOKENS, whole => whole.replace(/[^\n]/g, ' '));
  for (const match of markup.matchAll(/<[A-Za-z][^>]*?(?:\son[a-z]+\s*=|=\s*["']?\s*javascript:)[^>]*>/g)) {
    found.push({ line: markup.slice(0, match.index).split('\n').length, tag: match[0].slice(0, 80) });
  }
  return found;
}

/** The site-wide Content-Security-Policy of _headers (the /* rule) and the script hashes its script-src lists. */
export function sitePolicy(rules) {
  const policy = headersFor(rules, '/').headers['content-security-policy'] || '';
  const directives = parseCsp(policy);
  const hashes = (directives.get('script-src') || []).filter(source => /^'sha256-[A-Za-z0-9+/]+=*'$/.test(source)).map(source => source.slice(1, -1));
  return { policy, directives, hashes };
}

/** The address a page file is served at: 'welcome/index.html' → '/welcome/'. */
export const pageAddress = file => `/${file.replace(/\\/g, '/').replace(/(^|\/)index\.html$/, '$1')}`;

/**
 * Compares the pages' inline scripts with the policy's hashes: one sentence
 * per problem ([] when they match exactly). `pages` is [{ file, html }], file
 * relative to the site root ('welcome/index.html').
 */
export function cspProblems(pages, rules) {
  const problems = [];
  const { policy, hashes } = sitePolicy(rules);
  if (!policy) return ['_headers: no Content-Security-Policy on the /* rule'];
  const needed = new Map();
  for (const { file, html } of pages) {
    // One policy for every page: a second rule setting the header would add a second policy.
    if (headersFor(rules, pageAddress(file)).headers['content-security-policy'] !== policy) problems.push(`_headers: ${pageAddress(file)} gets another Content-Security-Policy than the /* rule's`);
    for (const script of inlineScripts(html)) {
      if (!needed.has(script.hash)) needed.set(script.hash, []);
      needed.get(script.hash).push(`${file}:${script.line}`);
    }
    for (const handler of inlineHandlers(html)) problems.push(`${file}:${handler.line}: inline event handler or javascript: address (${handler.tag}); the CSP blocks it, use addEventListener in a module`);
  }
  for (const [hash, where] of needed) {
    if (!hashes.includes(hash)) problems.push(`_headers: script-src is missing '${hash}' for the inline script at ${where.join(', ')}`);
  }
  for (const hash of hashes) {
    if (!needed.has(hash)) problems.push(`_headers: script-src lists '${hash}', which no inline script of the site has any more; remove it`);
  }
  if (new Set(hashes).size !== hashes.length) problems.push('_headers: script-src lists a hash twice');
  return problems;
}
