import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../src/first-visit.js', import.meta.url), 'utf8');

function visit({ href = 'https://planner.bemorin.com/', keys = [], standalone = false, storageThrows = false } = {}) {
  const url = new URL(href);
  let replaced = null;
  const storage = storageThrows
    ? { get length() { throw new Error('SecurityError'); }, key() { throw new Error('SecurityError'); } }
    : { length: keys.length, key: index => keys[index] ?? null };
  const window = {
    location: { href: url.href, search: url.search, hash: url.hash, replace: target => { replaced = target; } },
    navigator: { standalone: false },
    matchMedia: query => ({ matches: standalone && query.includes('standalone') }),
    get localStorage() { return storage; }
  };
  vm.runInNewContext(source, { window, URL });
  return replaced;
}

test('a first visit with nothing to open goes to the welcome page', () => {
  assert.equal(visit(), 'https://planner.bemorin.com/welcome/');
  assert.equal(visit({ href: 'https://example.test/planner/' }), 'https://example.test/planner/welcome/', 'relative to where the planner is served');
});

test('the planner opens for anyone who used it here, for the installed app, and for any link into it (Dropbox’s sign-in answer too)', () => {
  assert.equal(visit({ keys: ['daily-planner-ui:opened'] }), null);
  assert.equal(visit({ keys: ['other-site', 'daily-planner-settings'] }), null);
  assert.equal(visit({ standalone: true }), null);
  // Back from Dropbox (1.38) on a browser that kept nothing yet: still the planner, never /welcome/.
  assert.equal(visit({ href: 'https://planner.bemorin.com/?code=abc&state=xyz' }), null);
  // Links of earlier releases (a licence or gift link in an old email) still open the planner, simply without a dialog.
  for (const query of ['?start', '?help', '?view=week', '#week', '?code=abc&state=xyz', '?error=access_denied&state=xyz', '?license=DP1.x', '?gift=ABC&key=1']) {
    assert.equal(visit({ href: `https://planner.bemorin.com/${query}` }), null, query);
  }
});

test('storage that can’t be read opens the planner', () => {
  assert.equal(visit({ storageThrows: true }), null);
});

test('the public pages’ planner links carry ?start, and the planner takes it out of the address', async () => {
  for (const page of ['welcome/index.html', 'contact/index.html', 'legal/index.html']) {
    const html = await readFile(new URL(`../${page}`, import.meta.url), 'utf8');
    assert.doesNotMatch(html, /href="\.\.\/" data-cta="app"/, page);
    assert.doesNotMatch(html, /href="\.\.\/">Open the planner/, page);
  }
  // Two levels down: the legal pages' footers.
  for (const page of ['legal/terms/index.html', 'legal/privacy/index.html', 'legal/cookies/index.html']) {
    const html = await readFile(new URL(`../${page}`, import.meta.url), 'utf8');
    assert.doesNotMatch(html, /href="\.\.\/\.\.\/"/, `${page}: no link to the planner without ?start`);
    assert.match(html, /href="\.\.\/\.\.\/\?start"/, page);
  }
  const { ONE_TIME_PARAMS } = await import('../src/ui/back-stack.js');
  assert.ok(ONE_TIME_PARAMS.includes('start'));
  const index = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.ok(index.indexOf('src="./src/first-visit.js"') < index.indexOf('<title>'), 'in the head, before the planner draws');
});
