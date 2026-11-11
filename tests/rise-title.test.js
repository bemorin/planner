import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// The rising title (1.35): on /welcome/, the hero's words rise one after the other from behind their own clip,
// by CSS alone, and a screen reader hears one sentence.

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = rel => readFile(join(root, rel), 'utf8');

const TITLES = {
  'welcome/index.html': ['hero-title', 'Plan what matters. Close the day. Keep the year in view.']
};
const STAGGER_MS = 40;
const DURATION_MS = 500;

function title(page, id) {
  const h1 = new RegExp(`<h1 id="${id}" class="rise-title" aria-label="([^"]+)">([\\s\\S]*?)</h1>`).exec(page);
  assert.ok(h1, id);
  return { label: h1[1], inner: h1[2] };
}

test('each rising title reads as one sentence: the label on the <h1>, its words hidden from the reader', async () => {
  for (const [file, [id, sentence]] of Object.entries(TITLES)) {
    const { label, inner } = title(await read(file), id);
    assert.equal(label, sentence, file);
    const lines = [...inner.matchAll(/<span aria-hidden="true">([\s\S]*?)<\/span><\/span><\/span>/g)];
    assert.ok(lines.length >= 1, `${file}: the words sit in aria-hidden lines`);
    assert.doesNotMatch(inner.replace(/<span aria-hidden="true">[\s\S]*?<\/span><\/span><\/span>/g, ''), /\w/, `${file}: nothing readable outside them`);
    const words = [...inner.matchAll(/<span class="word" style="--w:(\d+)"><span>([^<]+)<\/span><\/span>/g)];
    assert.deepEqual(words.map(word => word[2]).join(' '), sentence, `${file}: the words, in order, are the sentence`);
    assert.deepEqual(words.map(word => Number(word[1])), words.map((_, index) => index), `${file}: each word knows its place`);
    assert.ok(DURATION_MS + STAGGER_MS * (words.length - 1) <= 900, `${file}: the last word is in place by 0.9s`);
  }
});

test('the words rise by CSS alone, stay opaque, keep their place, and never move with reduced motion', async () => {
  const css = await read('welcome/landing.css');
  // `overflow: hidden` first for Safari before 16, which has no `clip`.
  assert.match(css, /\.rise-title \.word \{ display: inline-block; overflow: hidden; overflow: clip; padding: \.2em \.04em \.14em; margin: -\.2em -\.04em -\.14em; vertical-align: top; \}/, 'a padded clip that takes no room');
  assert.match(css, /@keyframes rise-word \{\n {2}from \{ transform: translateY\(calc\(100% \+ \.5em\)\); \}\n\}/, 'only a transform: the words are opaque from first paint (LCP) and nothing shifts');
  const motion = /@media screen and \(prefers-reduced-motion: no-preference\) \{\n([\s\S]*?)\n\}/.exec(css.slice(css.indexOf('.rise-title .word {')))[1];
  assert.match(motion, new RegExp(`\\.rise-title \\.word > span \\{ animation: rise-word ${DURATION_MS}ms cubic-bezier\\(\\.22, \\.8, \\.32, 1\\) calc\\(var\\(--w, 0\\) \\* ${STAGGER_MS}ms\\) both; \\}`));
  assert.match(motion, /h1\.rise-title \{ animation: none; \}/, 'the title does not also rise as a block');
  assert.equal((css.match(/rise-word \d+ms/g) || []).length, 1, 'animated in that one place, behind no-preference');
  // Then the copy fades up after the title, on the landing page.
  assert.match(motion, /\.hero__copy \.lead \{ animation-delay: 380ms; \}/);
  assert.match(motion, /\.hero__copy > :not\(h1\),/);
  // The lines of the landing title are the <h1>'s own children (its words are spans too).
  assert.match(css, /\.hero__copy h1 > span \{ display: inline; \}/);
  assert.match(css, /@media \(min-width: 560px\) \{\n {2}\.hero__copy h1 > span \{ display: block; \}\n\}/);
  assert.doesNotMatch(css, /\.hero__copy h1 span[ ,{:]/, 'no rule reaches every span of the title');
});

test('no script plays the title: the entrances in JavaScript never touch the heroes', async () => {
  for (const file of ['welcome/landing.js', 'welcome/page-motion.js', 'welcome/hero-views.js', 'contact/contact.js']) {
    assert.doesNotMatch(await read(file), /rise-title|hero__copy/, file);
  }
  for (const file of Object.keys(TITLES)) assert.doesNotMatch(/<section[^>]*class="(?:hero|tm-hero|pt-hero)"[^>]*>/.exec(await read(file))?.[0] || '', /data-reveal/, `${file}: the hero is not revealed by script`);
});
