import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { posix } from 'node:path';

import { repositoryDocHref } from '../admin/configuration/config-model.js';
import { PUBLISHED_FILES, PUBLISHED_FOLDERS, RETIRED_FOLDERS, retiredReferences, UNPUBLISHED } from '../scripts/published.mjs';
import { parseRedirects, redirectFor } from '../scripts/redirects.mjs';

const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');
function walk(dir) {
  return readdirSync(new URL(dir, root), { withFileTypes: true }).flatMap(entry => (entry.isDirectory() ? walk(`${dir}${entry.name}/`) : [`${dir}${entry.name}`]));
}
const publishedFiles = [...PUBLISHED_FILES, ...PUBLISHED_FOLDERS.flatMap(folder => walk(`${folder}/`))];
// What the build writes itself, next to what it copies.
const written = ['runtime-config.js', 'styles.css', '_headers', '_redirects'];
const isPublished = path => publishedFiles.includes(path) || written.includes(path);

test('the build publishes the site, not the repository’s documents', () => {
  const build = read('scripts/build.mjs');
  assert.match(build, /import \{ PUBLISHED_FILES, PUBLISHED_FOLDERS \} from '\.\/published\.mjs';/);
  assert.match(build, /for \(const file of PUBLISHED_FILES\) await copyFile\(file\);/);
  // Every published folder, src/ last (after the legal pages get their details): never another one.
  assert.match(build, /for \(const folder of PUBLISHED_FOLDERS\.filter\(name => name !== 'src'\)\) await copyTree\(folder\);/);
  assert.deepEqual([...build.matchAll(/await copyTree\('([^']+)'\);/g)].map(match => match[1]), ['src'], 'no folder named by hand');
  assert.equal(PUBLISHED_FOLDERS.at(-1), 'src');
  for (const name of UNPUBLISHED) {
    assert.ok(!PUBLISHED_FILES.includes(name) && !PUBLISHED_FOLDERS.includes(name), `${name} is not published`);
    assert.doesNotMatch(build, new RegExp(`['"]${name.replace('.', '\\.')}['"]`), `the build never names ${name}`);
  }
  assert.deepEqual(UNPUBLISHED, ['docs', 'migrations', '.github', 'README.md', 'ARCHITECTURE.md', 'CONTRIBUTING.md', 'SECURITY.md', 'TRADEMARKS.md', 'CHANGELOG.md', 'LICENSE', 'OWNER_NOTES.md']);
  // The repository's workflows never reach the site: no published folder holds a .github/, and the dist check looks for one.
  assert.ok(!publishedFiles.some(file => file.split('/').includes('.github')), 'nothing under .github/ is published');
  assert.match(read('scripts/smoke.mjs'), /for \(const name of UNPUBLISHED\)/);
  // Every root file it copies exists (a typo would fail the deploy), and THIRD_PARTY_NOTICES.md stays: the legal notice links to it.
  for (const file of PUBLISHED_FILES) assert.ok(existsSync(new URL(file, root)), file);
  assert.ok(PUBLISHED_FILES.includes('THIRD_PARTY_NOTICES.md'));
  assert.match(read('legal/index.html'), /<a href="\.\.\/THIRD_PARTY_NOTICES\.md">third-party notices<\/a>/);
});

test('no published page links to a file the site doesn’t publish', () => {
  const pages = publishedFiles.filter(file => file.endsWith('.html'));
  assert.ok(pages.length >= 9);
  for (const file of pages) {
    const html = read(file);
    for (const [, link] of html.matchAll(/(?:href|src)="([^"#?]+)[^"]*"/g)) {
      if (/^(?:[a-z]+:|\/\/|\$\{)/i.test(link)) continue;
      const target = posix.normalize(posix.join(posix.dirname(file), link));
      // Pages are folders (…/), served as their index.html.
      const path = link.endsWith('/') || /(?:^|\/)\.\.?$/.test(link) ? posix.join(target, 'index.html') : target;
      assert.ok(isPublished(path), `${file} links to ${link}, which dist/ doesn’t have`);
    }
    assert.doesNotMatch(html, /href="[^"]*(?:docs\/|README|ARCHITECTURE|CONTRIBUTING|CHANGELOG|LICENSE|TRADEMARKS)[^"]*"/, `${file} links to a repository document`);
  }
});

test('the configuration page names its guide, and links to it on GitHub when the deployment sets the repository', () => {
  const html = read('admin/configuration/index.html');
  assert.match(html, /<span data-cfg-docs><code>docs\/configuration\.md<\/code>, in the project’s repository<\/span>/);
  const script = read('admin/configuration/configuration.js');
  assert.match(script, /repositoryDocHref\(globalThis\.__DAILY_PLANNER_CONFIG__\?\.PROJECT_GITHUB_URL, 'docs\/configuration\.md'\)/);
  assert.equal(repositoryDocHref('https://github.com/example/daily-planner', 'docs/configuration.md'), 'https://github.com/example/daily-planner/blob/main/docs/configuration.md');
  assert.equal(repositoryDocHref(' https://github.com/example/daily-planner/ ', 'docs/configuration.md'), 'https://github.com/example/daily-planner/blob/main/docs/configuration.md');
  for (const bad of ['', 'github.com/example/x', 'http://github.com/example/x', 'https://evil.example/example/x', 'https://github.com/example', 'https://github.com/example/x/tree/main', 'https://github.com/example/x?a=1', 'javascript:alert(1)']) {
    assert.equal(repositoryDocHref(bad, 'docs/configuration.md'), '', bad);
  }
});

test('the workflow’s actions are pinned to a commit, with the tag beside it', () => {
  const workflows = readdirSync(new URL('.github/workflows/', root)).filter(name => /\.ya?ml$/.test(name));
  assert.ok(workflows.includes('verify.yml'));
  for (const name of workflows) {
    const uses = [...read(`.github/workflows/${name}`).matchAll(/^\s*(?:-\s*)?uses:\s*(.+)$/gm)].map(match => match[1].trim());
    assert.ok(uses.length > 0, name);
    for (const use of uses) assert.match(use, /^[\w.-]+\/[\w.-]+@[0-9a-f]{40} # v\d+(?:\.\d+)*$/, `${name}: ${use}`);
  }
  const verify = read('.github/workflows/verify.yml');
  assert.match(verify, /uses: actions\/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4/);
  assert.match(verify, /uses: actions\/setup-node@49933ea5288caeca8642d1e84afbd3f7d6820020 # v4/);
});

// ---- Free since 1.39: the Teams and partners pages are gone ------------------------------------------------------

test('teams/ and partners/ (the statement with them) are gone: neither in the repository nor published', () => {
  assert.deepEqual(RETIRED_FOLDERS, ['teams', 'partners']);
  for (const folder of [...RETIRED_FOLDERS, 'welcome/thanks']) {
    assert.ok(!existsSync(new URL(`${folder}/`, root)), `${folder}/ is deleted`);
    assert.ok(!PUBLISHED_FOLDERS.includes(folder), `${folder}/ is not published`);
    assert.ok(!publishedFiles.some(file => file.startsWith(`${folder}/`)), `nothing under ${folder}/ goes to dist/`);
  }
  // The service worker never precaches them either.
  assert.doesNotMatch(read('sw.js'), /teams|partners/);
});

test('no published file links to the Teams or partners pages, nor names their addresses', () => {
  const texts = publishedFiles.filter(file => /\.(?:html|m?js|css|json|webmanifest|md|txt|svg)$/.test(file));
  assert.ok(texts.length > 100, `${texts.length} files`);
  for (const file of texts) assert.deepEqual(retiredReferences(read(file)), [], file);
  // The scanner sees what a link to them looks like, and lets the API route and module names be.
  for (const link of ['href="./teams/"', 'href="../partners/"', '../../partners/statement/', "'/teams'", 'https://planner.bemorin.com/teams/', '/welcome/partners/', '(teams/)']) assert.ok(retiredReferences(link).length, link);
  for (const other of ['/api/teams', '`${PLANNER_API_URL}/teams`', 'teams-model.js', '#teams', 'partners_viewed', 'the Teams page']) assert.deepEqual(retiredReferences(other), [], other);
  assert.deepEqual(retiredReferences('href="./teams/"', []), [], 'nothing to look for without folders');
});

test('their addresses, the old ones under /welcome/ and the former gift page go to the landing page for good, query kept', () => {
  const redirects = parseRedirects(read('_redirects'));
  for (const path of ['/teams', '/teams/', '/teams/index.html', '/teams/teams.js', '/partners', '/partners/', '/partners/statement/', '/partners/statement/index.html', '/welcome/teams', '/welcome/teams/', '/welcome/teams/thanks/', '/welcome/partners', '/welcome/partners/', '/welcome/thanks', '/welcome/thanks/', '/welcome/thanks/index.html']) {
    assert.deepEqual(redirectFor(redirects, path, ''), { status: 301, location: '/welcome/' }, path);
  }
  // A question asked through an old address still reaches the Contact page (the landing page sends it on).
  assert.deepEqual(redirectFor(redirects, '/teams/', '?ask=question'), { status: 301, location: '/welcome/?ask=question' });
  // The landing page, the Contact page and the rest of the site are pages, not redirects.
  for (const path of ['/welcome/', '/contact/', '/', '/legal/terms/', '/welcome/thanksgiving/']) assert.equal(redirectFor(redirects, path, ''), null, path);
  const lines = read('_redirects').split('\n').filter(line => /^\/(?:welcome\/)?(?:teams|partners|thanks)\b/.test(line));
  assert.ok(lines.length === 10 && lines.every(line => / \/welcome\/ 301$/.test(line)), lines.join('\n'));
});

test('the dist check: scripts/smoke.mjs fails when dist/ has the retired folders or a link to them', () => {
  const smoke = read('scripts/smoke.mjs');
  assert.match(smoke, /retiredReferences/);
  assert.match(smoke, /RETIRED_FOLDERS/);
  assert.doesNotMatch(smoke, /\/(?:teams|partners)\//, 'and never opens them');
});
