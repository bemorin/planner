import { promises as fs } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync, brotliCompressSync, constants } from 'node:zlib';
import { staticLegalHtml } from '../legal/legal-details.js';
import { PUBLISHED_FILES, PUBLISHED_FOLDERS } from './published.mjs';

// The legal pages whose publisher details the build writes in (see below).
const LEGAL_PAGES = ['legal/index.html', 'legal/privacy/index.html', 'legal/terms/index.html', 'legal/cookies/index.html'];

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, 'dist');
const kb = value => `${(value / 1024).toFixed(1)} KB`;

await fs.rm(dist, { recursive: true, force: true });
await fs.mkdir(dist, { recursive: true });

async function copyFile(rel) {
  const source = resolve(root, rel);
  const target = resolve(dist, rel);
  await fs.mkdir(dirname(target), { recursive: true });
  await fs.copyFile(source, target);
}

async function copyTree(rel) {
  const source = resolve(root, rel);
  const entries = await fs.readdir(source, { withFileTypes: true });
  for (const entry of entries) {
    const child = `${rel}/${entry.name}`;
    if (entry.isDirectory()) await copyTree(child);
    else await copyFile(child);
  }
}

// What the site publishes, and only that (scripts/published.mjs): never docs/, the README, ARCHITECTURE,
// CONTRIBUTING, the CHANGELOG or LICENSE, which are the repository's (1.35).
// The folders too (scripts/published.mjs): the planner's src/ and assets/, the owner dashboard, the landing page,
// the Contact page (it loads ../welcome/ modules and styles) and the legal pages.
for (const file of PUBLISHED_FILES) await copyFile(file);
for (const folder of PUBLISHED_FOLDERS.filter(name => name !== 'src')) await copyTree(folder);
// Cloudflare Pages reads _redirects from the root of the output (short /privacy, /terms, /cookies links;
// the addresses of the pages the site no longer has).
await copyFile('_redirects');
// …and _headers: the security headers and Content-Security-Policy of every response, and pages, scripts and
// styles revalidate on every visit, so a deploy is never hidden by a cache.
await copyFile('_headers');

const deploymentConfig = {
  PROJECT_GITHUB_URL: process.env.DAILY_PLANNER_GITHUB_URL || '',
  GITHUB_SPONSOR_URL: process.env.DAILY_PLANNER_SPONSOR_URL || '',
  SOCIAL_X_URL: process.env.DAILY_PLANNER_X_URL || '',
  SOCIAL_LINKEDIN_URL: process.env.DAILY_PLANNER_LINKEDIN_URL || '',
  CLOUD_API_URL: process.env.DAILY_PLANNER_CLOUD_API_URL || '',
  GOOGLE_CLIENT_ID: process.env.DAILY_PLANNER_GOOGLE_CLIENT_ID || '',
  // Personal sync through Dropbox (1.38): the App Console's app key; blank hides Dropbox.
  DROPBOX_APP_KEY: process.env.DAILY_PLANNER_DROPBOX_APP_KEY || '',
  PLANNER_API_URL: process.env.DAILY_PLANNER_API_URL || '',
  // Legal pages: blank details are left out (see legal/legal.js).
  SUPPORT_EMAIL: process.env.DAILY_PLANNER_SUPPORT_EMAIL || '',
  PRIVACY_EMAIL: process.env.DAILY_PLANNER_PRIVACY_EMAIL || '',
  LEGAL_PHONE: process.env.DAILY_PLANNER_LEGAL_PHONE || '',
  LEGAL_ADDRESS: process.env.DAILY_PLANNER_LEGAL_ADDRESS || '',
  LEGAL_REGISTRATION: process.env.DAILY_PLANNER_LEGAL_REGISTRATION || ''
};
await fs.writeFile(resolve(dist, 'runtime-config.js'), `globalThis.__DAILY_PLANNER_CONFIG__ = Object.freeze(${JSON.stringify(deploymentConfig, null, 2)});\n`);

// The legal pages show the publisher's details without JavaScript too: their
// copies in dist/ get the rows and links legal.js writes (escaped, invalid
// values left out: legal/legal-details.js). The source pages keep the blank
// fallback, the “Ask a question” form.
for (const page of LEGAL_PAGES) {
  const file = resolve(dist, page);
  await fs.writeFile(file, staticLegalHtml(await fs.readFile(file, 'utf8'), deploymentConfig));
}
await copyTree('src');

// Source uses domain CSS imports for maintainability; production gets one CSS file.
const coordinator = await fs.readFile(resolve(root, 'styles.css'), 'utf8');
const imports = [...coordinator.matchAll(/@import\s+url\(['"](.+?)['"]\);/g)].map(match => match[1]);
const cssParts = [];
for (const importPath of imports) {
  const clean = importPath.replace(/^\.\//, '');
  cssParts.push(`/* ${clean} */\n${await fs.readFile(resolve(root, clean), 'utf8')}`);
}
await fs.writeFile(resolve(dist, 'styles.css'), cssParts.join('\n\n'));

const compressible = [];
async function collect(dir) {
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) await collect(full);
    else if (/\.(?:html|css|js|svg)$/.test(entry.name)) compressible.push(full);
  }
}
await collect(dist);

let sourceBytes = 0;
let gzipBytes = 0;
let brotliBytes = 0;
for (const file of compressible) {
  const data = await fs.readFile(file);
  sourceBytes += data.byteLength;
  const gz = gzipSync(data, { level: 9 });
  const br = brotliCompressSync(data, {
    params: {
      [constants.BROTLI_PARAM_QUALITY]: 11,
      [constants.BROTLI_PARAM_MODE]: constants.BROTLI_MODE_TEXT
    }
  });
  await fs.writeFile(`${file}.gz`, gz);
  await fs.writeFile(`${file}.br`, br);
  gzipBytes += gz.byteLength;
  brotliBytes += br.byteLength;
}

console.log('Built dist/');
console.log(`Deployable text source: ${kb(sourceBytes)}`);
console.log(`Pre-compressed total (gzip): ${kb(gzipBytes)}`);
console.log(`Pre-compressed total (Brotli): ${kb(brotliBytes)}`);
console.log(`CSS source modules: ${imports.length}`);
console.log('No npm install or runtime framework is required.');
