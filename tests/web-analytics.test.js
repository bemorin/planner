import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { sitePolicy } from '../scripts/csp.mjs';
import { parseHeaders } from '../scripts/headers.mjs';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const text = html => html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

// 1.35: the owner turns on Cloudflare Web Analytics (cookieless, totals only); the server keeps a hashed IP against abuse.
test('the cookies page says what Cloudflare Web Analytics does, and no longer that no analytics script loads', () => {
  const cookies = read('legal/cookies/index.html');
  const words = text(cookies);
  assert.doesNotMatch(words, /analytics or tracking scripts from other companies/);
  assert.match(words, /load no advertising or tracking scripts/);
  assert.match(words, /the pages load Cloudflare Web Analytics, which our host, Cloudflare, runs for us\. It sets no cookies and keeps nothing in your browser, doesn’t fingerprint your device and doesn’t follow you to other sites: we only see totals/);
  assert.match(words, /No consent is needed for it: it only measures this site’s audience, without cookies, anonymously and in totals, within the CNIL’s rules for audience measurement/);
  assert.match(cookies, /<a href="\.\.\/privacy\/#visits">privacy policy<\/a>/);
  assert.match(cookies, /<p class="lg-updated">Last updated: <time datetime="2026-11-10">10 November 2026<\/time><\/p>/);
});

test('the privacy policy: visits measured by Cloudflare as our host, the hashed IP kept at most 24 hours', () => {
  const privacy = read('legal/privacy/index.html');
  const section = /<section id="visits"[\s\S]*?<\/section>/.exec(privacy)?.[0] || '';
  assert.ok(section, 'its own section');
  assert.match(privacy, /<li><a href="#visits">Visits and your IP address<\/a><\/li>/);
  const words = text(section);
  assert.match(words, /Cloudflare Web Analytics/);
  assert.match(words, /It uses no cookies and keeps nothing in your browser, doesn’t fingerprint your device and doesn’t follow you across sites\. Cloudflare runs it on our behalf, as our host, and we see only totals\./);
  assert.match(words, /It needs no consent: it only measures this site’s audience, without cookies, anonymously and in totals, within the CNIL’s rules for audience measurement\./);
  // Every write to the server counts toward the per-connection limit (server/rate-limit.js), usage counts included.
  // The scrambling key changes every UTC day and the old one is deleted (server/rate-limit.js).
  assert.match(words, /To stop abuse, our server also limits how often one connection can send it something: a form, a count or a sign-in\. For that alone, it keeps a scrambled \(hashed\) form of your IP address, never the address itself, apart from the counts and from what you send\. The scrambling key changes every day and the old one is deleted, so once the day changes it can’t be linked back to your address\. The scrambled form itself is deleted within 24 hours\./);
  assert.match(words, /We keep only daily counts of those reports, with nothing about you, for about 90 days\./, 'the security headers’ reports');
  const counts = text(/<section id="counts"[\s\S]*?<\/section>/.exec(privacy)?.[0] || '');
  assert.match(counts, /There is no identifier, no cookie and no IP address in it, and nothing you write is included\. Like everything sent to our server, counts are limited per connection to stop abuse: see Visits and your IP address ?\./);
  assert.doesNotMatch(text(privacy), /IP address is not stored|forms and sign-in/, 'the hashed address is kept for a day, for the counts too');
  assert.doesNotMatch(text(privacy), /Our code does not store it/, 'the abuse limits keep a hashed form for a day');
  assert.match(privacy, /delivers the pages, protects the site and measures visits to its pages \(Cloudflare Web Analytics, without cookies, in totals\)/, 'Cloudflare’s row of the providers');
  const bases = /<section id="bases"[\s\S]*?<\/section>/.exec(privacy)[0];
  assert.match(bases, /<th scope="row">Visits to the site’s pages<\/th>/);
  assert.match(bases, /<th scope="row">Abuse protection<\/th>[\s\S]*?can’t be linked back to it once the day changes, deleted within 24 hours/);
  assert.match(bases, /<th scope="row">Security reports<\/th>/);
  assert.doesNotMatch(text(privacy), /partner/i, 'no partner links, no visits counted for them (1.39)');
  assert.match(privacy, /<li>Our host, Cloudflare, counts visits to the site’s pages for us, without cookies and in totals only\.<\/li>/);
  // Updated since (1.39, 10 November 2026: the planner is free and open source); 1.35's text above stays.
  assert.match(privacy, /<p class="lg-updated">Last updated: <time datetime="2026-11-10">10 November 2026<\/time><\/p>/);
});

test('the CSP lets Cloudflare’s beacon load and report, and nothing else of Cloudflare’s', () => {
  const { directives } = sitePolicy(parseHeaders(read('_headers')));
  assert.ok(directives.get('script-src').includes('https://static.cloudflareinsights.com'));
  assert.ok(directives.get('connect-src').includes('https://cloudflareinsights.com'));
  assert.equal([...directives.values()].flat().filter(source => /cloudflare/.test(source)).length, 2);
});

test('the welcome page’s “What this page counts” says the counts hold no IP address, and the abuse limit keeps a hashed one for a day', () => {
  for (const file of ['welcome/index.html']) {
    const counts = /<section class="pv__sec" data-privacy-section="counts"[\s\S]*?<\/section>/.exec(read(file))?.[0] || '';
    assert.ok(counts, `${file}: its counts section`);
    assert.match(text(counts), /No identifiers, no cookies, no IP address in the counts\. To stop abuse, the server limits how often one connection can send it something, counts and forms included\. For that alone, it keeps a scrambled form of your IP address, apart from the counts: it can’t be linked back to you once the day changes, and it is deleted within 24 hours\./, file);
    // Cloudflare Web Analytics is named, and what the switch covers.
    assert.match(text(counts), /Our host, Cloudflare, also measures visits to the site’s pages for us \(Cloudflare Web Analytics\): without cookies, in totals only\. The switch below covers the counts above, not Cloudflare’s measure; a content blocker in your browser stops that one\./, file);
    assert.doesNotMatch(text(read(file)), /IP address is not stored/, file);
  }
});
