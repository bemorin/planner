import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createPlannerApi, createMemoryStore } from '../server/planner-api.js';
import { APP_VERSION } from '../src/config.js';
import { compareVersions, readReloadMark, reloadUrl, versionNotice } from '../admin/version.js';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const get = (path, token) => new Request(`https://planner.test/api/${path}`, { headers: token ? { authorization: `Bearer ${token}` } : {} });

test('the admin summary reports the version the API was deployed with', async () => {
  const api = createPlannerApi({ store: createMemoryStore(), adminToken: 'secret', now: () => new Date('2026-10-20T08:00:00Z') });
  const response = await api(get('admin/summary', 'secret'));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).version, APP_VERSION);
  assert.equal((await api(get('admin/summary'))).status, 401, 'only to the owner');
});

test('the dashboard carries its own version, in step with the release', () => {
  const packageVersion = JSON.parse(read('package.json')).version;
  const own = /^const APP_VERSION = '(\d+\.\d+\.\d+)';$/m.exec(read('admin/admin.js'));
  assert.ok(own, 'admin/admin.js declares const APP_VERSION = \'X.Y.Z\'; (its own, not imported)');
  assert.equal(own[1], APP_VERSION, 'bump APP_VERSION in admin/admin.js with src/config.js and package.json');
  assert.equal(own[1], packageVersion);
  assert.doesNotMatch(read('admin/admin.js'), /import\s*\{[^}]*APP_VERSION[^}]*\}\s*from/, 'an imported version could be fresher than the cached admin.js');
});

test('versions compare numerically, part by part', () => {
  assert.equal(compareVersions('1.25.0', '1.24.0'), 1);
  assert.equal(compareVersions('1.9.0', '1.10.0'), -1);
  assert.equal(compareVersions('2.0.0', '1.99.99'), 1);
  assert.equal(compareVersions(' 1.25.0 ', '1.25.0'), 0);
  assert.ok(Number.isNaN(compareVersions('', '1.25.0')));
  assert.ok(Number.isNaN(compareVersions('1.25', '1.25.0')));
  assert.ok(Number.isNaN(compareVersions(undefined, '1.25.0')));
});

test('a page older than the deployment is told to reload; the same version says nothing', () => {
  assert.equal(versionNotice('1.25.0', '1.25.0'), null);
  assert.equal(versionNotice('1.25.0', ''), null, 'an API from before 1.25.0 reports no version');
  assert.equal(versionNotice('1.25.0', undefined), null);
  assert.equal(versionNotice('1.25.0', 'nonsense'), null);
  const newer = versionNotice('1.23.0', '1.25.0');
  assert.equal(newer.kind, 'newer');
  assert.equal(`${newer.title} ${newer.action}`, 'A newer dashboard (1.25.0) is deployed. Reload to get it.');
  assert.equal(newer.detail, 'This page is version 1.23.0.');
  assert.equal(newer.hint, '');
  const older = versionNotice('1.25.0', '1.24.0');
  assert.equal(older.kind, 'older', 'a rolled-back deployment');
  assert.match(older.title, /1\.24\.0/);
  assert.equal(older.action, 'Reload to match it.');
});

test('after a reload that did not help, the notice points to Cloudflare’s purge', () => {
  const notice = versionNotice('1.23.0', '1.25.0', { retried: true });
  assert.match(notice.hint, /Caching → Configuration/);
  assert.match(notice.hint, /Purge Everything/);
});

test('Reload opens the page at ?v=<version>, which is put back to the plain address once read', () => {
  assert.equal(reloadUrl('https://planner.test/admin/', '1.25.0'), 'https://planner.test/admin/?v=1.25.0');
  assert.equal(reloadUrl('https://planner.test/admin/?v=1.24.0#trends', '1.25.0'), 'https://planner.test/admin/?v=1.25.0#trends');
  assert.deepEqual(readReloadMark('https://planner.test/admin/?v=1.25.0#trends'), { version: '1.25.0', cleanUrl: 'https://planner.test/admin/#trends' });
  assert.deepEqual(readReloadMark('https://planner.test/admin/?days=30&v=1.25.0'), { version: '1.25.0', cleanUrl: 'https://planner.test/admin/?days=30' });
  assert.deepEqual(readReloadMark('https://planner.test/admin/'), { version: '', cleanUrl: 'https://planner.test/admin/' });
  assert.equal(readReloadMark('https://planner.test/admin/?v=<script>').version, '', 'only a version is read back');
});

test('Reload fetches every file the dashboard loads', () => {
  const admin = read('admin/admin.js');
  const html = read('admin/index.html');
  const files = JSON.parse(/const DASHBOARD_FILES = (\[[^\]]+\]);/.exec(admin)[1].replace(/'/g, '"'));
  // Imports are relative to admin/, where every dashboard module lives.
  const imports = file => [...read(`admin/${file}`).matchAll(/\bfrom '(\.{1,2}\/[^']+)';/g)].map(match => match[1]);
  const loaded = [
    ...[...html.matchAll(/(?:src|href)="(\.{1,2}\/[^"]+\.(?:js|css))"/g)].map(match => match[1]),
    ...['admin.js', 'attention.js', 'requests-view.js', 'usage-counts.js', 'trends-view.js', 'trends.js', 'charts.js', 'version.js'].flatMap(imports)
  ];
  assert.ok(loaded.includes('./charts.js') && loaded.includes('../src/vendor/motion.js') && loaded.includes('../src/lib/dom.js'), 'the scan sees the imports');
  assert.ok(loaded.includes('../legal/legal-details.js'), 'and the legal pages’ checks Setup uses');
  // …and what those import in turn (legal/ is next to admin/, so the same relative paths).
  const legalImports = [...read('legal/legal-details.js').matchAll(/\bfrom '(\.{1,2}\/[^']+)';/g)].map(match => match[1]);
  assert.ok(legalImports.includes('../src/lib/text.js'), 'the email rule it shares with the planner');
  loaded.push(...legalImports);
  for (const file of loaded) assert.ok(files.includes(file), `${file} is fetched again by Reload`);
  assert.ok(files.includes('./'), 'and the page itself');
});
