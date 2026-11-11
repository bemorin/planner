import { promises as fs } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cspProblems } from './csp.mjs';
import { parseHeaders } from './headers.mjs';
import { PUBLISHED_FILES, PUBLISHED_FOLDERS } from './published.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ignoredDirs = new Set(['dist', 'node_modules', '.git', '.planner-dev']);

async function walk(dir) {
  const files = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory() && ignoredDirs.has(entry.name)) continue;
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walk(full));
    else files.push(full);
  }
  return files;
}

const files = await walk(root);
const jsFiles = files.filter(file => file.endsWith('.js') || file.endsWith('.mjs'));
const textFiles = files.filter(file => /\.(?:js|mjs|css|html|md|json|webmanifest|txt)$/.test(file) || file.endsWith('LICENSE'));
const failures = [];

for (const file of jsFiles) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) failures.push(`${relative(root, file)}: ${result.stderr.trim() || 'syntax check failed'}`);
}

const forbidden = [
  new RegExp(['bike', 'shop', 'network'].join('[-_ ]*'), 'i')
];
for (const file of textFiles) {
  const rel = relative(root, file);
  const text = await fs.readFile(file, 'utf8');
  for (const pattern of forbidden) {
    if (pattern.test(text)) failures.push(`${rel}: contains forbidden legacy text matching ${pattern}`);
  }
}

const coordinator = await fs.readFile(resolve(root, 'styles.css'), 'utf8');
const cssImports = [...coordinator.matchAll(/@import\s+url\(['"](.+?)['"]\);/g)].map(match => match[1]);
if (!cssImports.length) failures.push('styles.css: expected domain stylesheet imports');
for (const spec of cssImports) {
  try { await fs.access(resolve(root, spec)); }
  catch { failures.push(`styles.css: missing imported stylesheet ${spec}`); }
}

const importRe = /(?:import\s+(?:[^'\"]+?\s+from\s+)?|import\s*)['\"]([^'\"]+)['\"]/g;
const modulePaths = new Set();
async function collectModules(relPath) {
  if (modulePaths.has(relPath)) return;
  modulePaths.add(relPath);
  const source = await fs.readFile(resolve(root, relPath), 'utf8');
  for (const match of source.matchAll(importRe)) {
    const spec = match[1];
    if (!spec.startsWith('.')) continue;
    const normalized = relative(root, resolve(root, dirname(relPath), spec)).replaceAll('\\', '/');
    await collectModules(normalized);
  }
}
await collectModules('app.js');

const packageJson = JSON.parse(await fs.readFile(resolve(root, 'package.json'), 'utf8'));
const releaseVersion = String(packageJson.version || '').trim();
if (!/^\d+\.\d+\.\d+$/.test(releaseVersion)) failures.push('package.json: version must be semantic MAJOR.MINOR.PATCH');

const changelog = await fs.readFile(resolve(root, 'CHANGELOG.md'), 'utf8');
if (!changelog.includes(`## ${releaseVersion} —`)) failures.push(`CHANGELOG.md: latest public version must include ${releaseVersion}`);
if (/^##\s+v\d+/m.test(changelog)) failures.push('CHANGELOG.md: internal v-number labels are not public release versions');

const sw = await fs.readFile(resolve(root, 'sw.js'), 'utf8');
if (!sw.includes(`const CACHE = 'daily-planner-${releaseVersion}';`)) failures.push(`sw.js: cache namespace must match package version ${releaseVersion}`);
if (/daily-planner-v\d+/i.test(sw)) failures.push('sw.js: internal build labels must not be used as public cache names');
for (const modulePath of modulePaths) {
  if (modulePath === 'app.js') continue;
  if (!sw.includes(`'./${modulePath}'`)) failures.push(`sw.js: CORE cache is missing ./${modulePath}`);
}

const appConfig = await fs.readFile(resolve(root, 'src/config.js'), 'utf8');
if (!appConfig.includes(`export const APP_VERSION = '${releaseVersion}';`)) failures.push(`src/config.js: APP_VERSION must match package version ${releaseVersion}`);

// 1.39: the code is open source, under the MIT License (the name and the logo are not: README.md says so).
const license = await fs.readFile(resolve(root, 'LICENSE'), 'utf8');
if (!/^MIT License\s*\n/.test(license)) failures.push('LICENSE: expected the MIT License, starting with “MIT License”');
if (!license.includes('Copyright (c) 2026 Ben Morin')) failures.push('LICENSE: expected “Copyright (c) 2026 Ben Morin”');
if (!/Permission is hereby granted, free of charge, to any person obtaining a copy/.test(license)) failures.push('LICENSE: expected the MIT permission notice');
if (/all rights reserved|polyform|source-available/i.test(license)) failures.push('LICENSE: the MIT License only, with no other terms');

const runtimeConfig = await fs.readFile(resolve(root, 'runtime-config.js'), 'utf8');
for (const key of ['PROJECT_GITHUB_URL', 'GITHUB_SPONSOR_URL', 'SOCIAL_X_URL', 'SOCIAL_LINKEDIN_URL', 'CLOUD_API_URL', 'GOOGLE_CLIENT_ID', 'DROPBOX_APP_KEY', 'PLANNER_API_URL', 'SUPPORT_EMAIL', 'PRIVACY_EMAIL', 'LEGAL_PHONE', 'LEGAL_ADDRESS', 'LEGAL_REGISTRATION']) {
  if (!runtimeConfig.includes(`${key}: ''`)) failures.push(`runtime-config.js: ${key} must remain blank in the public source`);
}

// The Content-Security-Policy in _headers lists the hash of every inline script the published pages run, and
// nothing else (scripts/csp.mjs): a script changed without its hash would stop running in production.
const publishedPages = [
  ...PUBLISHED_FILES.filter(file => file.endsWith('.html')),
  ...files.map(file => relative(root, file).replaceAll('\\', '/')).filter(rel => rel.endsWith('.html') && PUBLISHED_FOLDERS.some(folder => rel.startsWith(`${folder}/`)))
];
const pages = await Promise.all(publishedPages.map(async file => ({ file, html: await fs.readFile(resolve(root, file), 'utf8') })));
for (const problem of cspProblems(pages, parseHeaders(await fs.readFile(resolve(root, '_headers'), 'utf8')))) failures.push(problem);

if (failures.length) {
  console.error(`Repository checks failed (${failures.length}):`);
  failures.forEach(failure => console.error(`- ${failure}`));
  process.exit(1);
}

console.log(`Repository checks passed: ${jsFiles.length} JavaScript files, ${cssImports.length} CSS modules, ${modulePaths.size} runtime modules, ${pages.length} pages under the CSP.`);
