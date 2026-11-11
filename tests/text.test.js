import test from 'node:test';
import assert from 'node:assert/strict';
import { esc, escAttr, linkLabel, normalizeUrl, safeUrl } from '../src/lib/text.js';

test('esc protects HTML template insertion', () => {
  assert.equal(esc(`<script>alert("x")</script> & 'quoted'`), '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;quoted&#39;');
  assert.equal(escAttr('A&B'), 'A&amp;B');
});

test('normalizeUrl accepts only HTTP(S) links and supplies https when omitted', () => {
  assert.equal(normalizeUrl('example.com/path'), 'https://example.com/path');
  assert.equal(normalizeUrl('http://example.com'), 'http://example.com/');
  assert.equal(normalizeUrl('javascript:alert(1)'), '');
});

test('safeUrl and linkLabel handle empty or invalid values', () => {
  assert.equal(safeUrl(''), '');
  assert.equal(linkLabel('https://www.example.com/a'), 'example.com');
  assert.equal(linkLabel('not a url'), 'Open link');
});
