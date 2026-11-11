// Zero-dependency local server for Daily Planner.
//
//   node scripts/serve.mjs            serve the source tree on http://localhost:8080
//   node scripts/serve.mjs --dist     serve the production build in dist/
//   node scripts/serve.mjs --open     also open the default browser
//   node scripts/serve.mjs --port 9000 --lan
//   node scripts/serve.mjs --api      also run the owner API (waitlist, feedback, questions, counts)
//   node scripts/serve.mjs --api --data /tmp/api.json   keep the API data in another file
//   node scripts/serve.mjs --api --fake-email            print emails instead of sending them
//
// The local API is off by default, so everyday local use never collects
// anything. With --api it mirrors the production Cloudflare Function
// (server/planner-api.js), stores data in .planner-dev/api.json, and the owner
// dashboard is at /admin/ with the token printed below (set ADMIN_TOKEN to
// choose your own; on --lan a random token is generated instead of "dev").
// Set ADMIN_TOTP_SECRET (base32, see scripts/admin-secret.mjs) to also require
// an authenticator code at sign-in, exactly as in production.
// Email is off unless RESEND_API_KEY and EMAIL_FROM are set (with OWNER_EMAIL,
// EMAIL_DAILY_LIMIT and PUBLIC_BASE_URL, as in production). With --fake-email,
// nothing is sent: each email is printed here instead, so the dashboard's
// announcement can be tried safely (it still deletes the local waitlist
// entries it "sent").
//
// Build variables: the served runtime-config.js takes the legal pages' from
// this environment, as scripts/build.mjs does, so their states can be
// previewed (legal pages, welcome footer, dashboard Setup):
// DAILY_PLANNER_SUPPORT_EMAIL, DAILY_PLANNER_PRIVACY_EMAIL,
// DAILY_PLANNER_LEGAL_PHONE, DAILY_PLANNER_LEGAL_ADDRESS and
// DAILY_PLANNER_LEGAL_REGISTRATION; the source code link
// DAILY_PLANNER_GITHUB_URL and the footer's social links DAILY_PLANNER_X_URL
// and DAILY_PLANNER_LINKEDIN_URL; the sponsor page DAILY_PLANNER_SPONSOR_URL
// (Sponsor on GitHub in How it works, and the moment after ten closed days);
// and Personal sync's DAILY_PLANNER_GOOGLE_CLIENT_ID and
// DAILY_PLANNER_DROPBOX_APP_KEY (Dropbox then sends the sign-in back to
// http://localhost:<port>/, which its App Console must list), e.g.
//   DAILY_PLANNER_SUPPORT_EMAIL=support@example.com DAILY_PLANNER_LEGAL_PHONE=+33199001234 node scripts/serve.mjs --api
// Unset, they stay blank. (PLANNER_API_URL comes from --api, above.) With
// --dist, runtime-config.js is served as the build wrote it.
//
// Redirects: _redirects is applied as Cloudflare Pages applies it
// (scripts/redirects.mjs): /privacy → /legal/privacy/, /teams → /welcome/…,
// the query string kept and the #hash left to the browser.
//
// Headers: so are the rules of _headers (scripts/headers.mjs), on every page,
// file and redirect: the Content-Security-Policy and the other security
// headers, so the pages run here under the policy they get in production (an
// inline script whose hash isn't listed is refused here too). Two
// differences: every file is served with Cache-Control: no-store (always read
// fresh), and without Strict-Transport-Security (this server speaks http,
// where browsers ignore it; behind a local https proxy it would pin https on
// that host name for two years).
//
// Browsers keep planner data per address (host + port), so the server always
// prefers the same port. If that port already runs Daily Planner, it simply
// opens the existing instance instead of starting a second copy elsewhere.

import { createServer } from 'node:http';
import { promises as fs } from 'node:fs';
import { spawn } from 'node:child_process';
import { networkInterfaces } from 'node:os';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { randomBytes } from 'node:crypto';
import { createMemoryStore, createPlannerApi } from '../server/planner-api.js';
import { CONFIG_VARIABLES } from '../server/config-inventory.js';
import { headersFor, parseHeaders } from './headers.mjs';
import { parseRedirects, redirectFor } from './redirects.mjs';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = name => args.includes(`--${name}`);
const option = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};

const useDist = flag('dist');
const shouldOpen = flag('open');
const lan = flag('lan');
const preferredPort = Number(option('port', process.env.PORT || 8080)) || 8080;
const host = lan ? '0.0.0.0' : '127.0.0.1';
const root = useDist ? resolve(projectRoot, 'dist') : projectRoot;
const MARKER = 'x-daily-planner';
const withApi = flag('api');
// Never expose the well-known "dev" token to other devices on the network.
const adminToken = process.env.ADMIN_TOKEN || (lan ? randomBytes(12).toString('base64url') : 'dev');
const adminTotpSecret = process.env.ADMIN_TOTP_SECRET || '';
const devDataFile = option('data', '') ? resolve(option('data', '')) : resolve(projectRoot, '.planner-dev', 'api.json');
const fakeEmail = flag('fake-email');
let plannerApi = null;
let emailMode = 'off';

// Stands in for Resend: prints what would be sent and accepts it.
async function printEmail(url, init) {
  const body = JSON.parse(init.body);
  const messages = Array.isArray(body) ? body : [body];
  const recipients = messages.flatMap(message => message.to);
  console.log(`  [fake email] "${messages[0]?.subject}" → ${recipients.length} ${recipients.length === 1 ? 'recipient' : 'recipients'}: ${recipients.slice(0, 3).join(', ')}${recipients.length > 3 ? ', …' : ''}`);
  // A single email (a notification, a test) is printed in full.
  if (!Array.isArray(body)) console.log(String(body.text || '').trimEnd().split('\n').map(line => (line ? `      ${line}` : '')).join('\n'));
  const answer = String(url).endsWith('/batch') ? { data: messages.map((_, index) => ({ id: `fake-${index}` })) } : { id: 'fake-0' };
  return new Response(JSON.stringify(answer), { status: 200, headers: { 'content-type': 'application/json' } });
}

function emailOptions() {
  const env = process.env;
  const options = {
    resendApiKey: env.RESEND_API_KEY || '',
    emailFrom: env.EMAIL_FROM || '',
    ownerEmail: env.OWNER_EMAIL || '',
    emailDailyLimit: env.EMAIL_DAILY_LIMIT || ''
  };
  if (fakeEmail) {
    emailMode = 'fake, printed here';
    return { ...options, resendApiKey: 'fake', emailFrom: options.emailFrom || 'Daily Planner <planner@example.com>', ownerEmail: options.ownerEmail || 'owner@example.com', emailFetch: printEmail, emailIntervalMs: 0 };
  }
  if (options.resendApiKey && options.emailFrom) emailMode = 'Resend';
  return options;
}

// This server's own address, the production one unless PUBLIC_BASE_URL says otherwise (the port is known once it listens).
const devBaseUrl = () => (process.env.PUBLIC_BASE_URL || `http://localhost:${port}`).replace(/\/+$/, '');
const fakeJson = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

// Build variables the served runtime-config.js takes from this environment,
// as scripts/build.mjs does (see the header).
const ENV_CONFIG = [
  ['SUPPORT_EMAIL', 'DAILY_PLANNER_SUPPORT_EMAIL'],
  ['PRIVACY_EMAIL', 'DAILY_PLANNER_PRIVACY_EMAIL'],
  ['LEGAL_PHONE', 'DAILY_PLANNER_LEGAL_PHONE'],
  ['LEGAL_ADDRESS', 'DAILY_PLANNER_LEGAL_ADDRESS'],
  ['LEGAL_REGISTRATION', 'DAILY_PLANNER_LEGAL_REGISTRATION'],
  ['PROJECT_GITHUB_URL', 'DAILY_PLANNER_GITHUB_URL'],
  ['GITHUB_SPONSOR_URL', 'DAILY_PLANNER_SPONSOR_URL'],
  ['SOCIAL_X_URL', 'DAILY_PLANNER_X_URL'],
  ['SOCIAL_LINKEDIN_URL', 'DAILY_PLANNER_LINKEDIN_URL'],
  // Personal sync, to try it locally (docs/configuration.md lists the Redirect URI Dropbox needs for this port).
  ['GOOGLE_CLIENT_ID', 'DAILY_PLANNER_GOOGLE_CLIENT_ID'],
  ['DROPBOX_APP_KEY', 'DAILY_PLANNER_DROPBOX_APP_KEY']
];

// Served runtime-config.js: the build variables set in this environment; with
// --api, the local API.
function devRuntimeConfig(source) {
  let text = source;
  for (const [key, variable] of ENV_CONFIG) {
    const value = String(process.env[variable] || '').trim();
    // A function, so a “$” in the value is written as it is.
    if (value) text = text.replace(`${key}: ''`, () => `${key}: ${JSON.stringify(value)}`);
  }
  if (!plannerApi) return text;
  return text.replace("PLANNER_API_URL: ''", "PLANNER_API_URL: '/api'");
}

if (withApi) {
  const saved = await fs.readFile(devDataFile, 'utf8').then(JSON.parse).catch(() => ({}));
  let writeTimer = null;
  const store = createMemoryStore(saved, {
    onChange: data => {
      clearTimeout(writeTimer);
      writeTimer = setTimeout(async () => {
        await fs.mkdir(dirname(devDataFile), { recursive: true });
        await fs.writeFile(devDataFile, JSON.stringify(data, null, 2));
      }, 120);
    }
  });
  const options = emailOptions();
  plannerApi = createPlannerApi({ store, adminToken, adminTotpSecret, ...options, publicBaseUrl: devBaseUrl, ...configCheckOptions(options) });
}

// The configuration page (/admin/configuration/, POST /api/admin/config/check) checks what this server really
// uses, under the production names: the secrets in effect (the pretend ones with --fake-email, whose stand-in
// answers its read-only call), the build variables of the served runtime-config.js, and that file itself
// (ASSETS, as on Cloudflare). There is no D1 here: the page says so.
function configCheckOptions(options) {
  const env = {
    ...Object.fromEntries(CONFIG_VARIABLES.map(def => [def.name, process.env[def.name] || ''])),
    ADMIN_TOKEN: adminToken, ADMIN_TOTP_SECRET: adminTotpSecret,
    RESEND_API_KEY: options.resendApiKey, EMAIL_FROM: options.emailFrom, OWNER_EMAIL: options.ownerEmail, EMAIL_DAILY_LIMIT: options.emailDailyLimit,
    DAILY_PLANNER_API_URL: '/api',
    ASSETS: { fetch: async () => new Response(devRuntimeConfig(await fs.readFile(join(root, 'runtime-config.js'), 'utf8')), { headers: { 'content-type': 'text/javascript; charset=utf-8' } }) }
  };
  const senderDomain = (/@([A-Za-z0-9.-]+)>?\s*$/.exec(options.emailFrom || '')?.[1] || '').toLowerCase();
  async function configFetch(url, init = {}) {
    const target = new URL(url);
    // The pretend Resend has one domain, verified: the sender's.
    if (fakeEmail && target.hostname === 'api.resend.com' && target.pathname === '/domains') {
      return fakeJson(200, { object: 'list', has_more: false, data: [{ id: 'fake-domain', name: senderDomain, status: 'verified', region: 'eu-west-1', capabilities: { sending: 'enabled', receiving: 'disabled' } }] });
    }
    return fetch(url, init);
  }
  return { configEnv: env, configFetch };
}

async function handleApi(request, response) {
  const headers = new Headers();
  Object.entries(request.headers).forEach(([key, value]) => { if (value != null) headers.set(key, Array.isArray(value) ? value.join(', ') : value); });
  const hasBody = !['GET', 'HEAD', 'OPTIONS'].includes(request.method);
  const webRequest = new Request(new URL(request.url, `http://${/^[A-Za-z0-9.-]+(?::\d{1,5})?$/.test(request.headers.host || '') ? request.headers.host : `localhost:${port}`}`), { method: request.method, headers, body: hasBody ? Readable.toWeb(request) : undefined, duplex: 'half' });
  const result = await plannerApi(webRequest);
  response.writeHead(result.status, Object.fromEntries([...result.headers.entries(), [MARKER, '1']]));
  response.end(Buffer.from(await result.arrayBuffer()));
}

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2'
};

try {
  await fs.access(join(root, 'index.html'));
} catch {
  console.error(useDist
    ? 'No production build found. Run "npm run build" first, or start without --dist.'
    : `index.html not found in ${root}.`);
  process.exit(1);
}

// Redirects from _redirects (“/privacy /legal/privacy/ 301”, “/teams/* /welcome/ 301”), as
// Cloudflare Pages applies them: the first matching line, the query string kept (scripts/redirects.mjs).
const redirects = parseRedirects(await fs.readFile(join(root, '_redirects'), 'utf8').catch(() => ''));
// …and _headers' rules (see the header): what Pages adds to a response for this path, minus the two differences.
const headerRules = parseHeaders(await fs.readFile(join(root, '_headers'), 'utf8').catch(() => ''));
function siteHeaders(pathname) {
  const { headers } = headersFor(headerRules, pathname);
  delete headers['cache-control'];
  delete headers['strict-transport-security'];
  return headers;
}

async function handle(request, response) {
  try {
    const url = new URL(request.url, 'http://localhost');
    const redirect = redirectFor(redirects, url.pathname, url.search);
    if (redirect) { response.writeHead(redirect.status, { ...siteHeaders(url.pathname), location: redirect.location, 'cache-control': 'no-store', [MARKER]: '1' }).end(); return; }
    if (plannerApi && url.pathname.startsWith('/api/')) { await handleApi(request, response); return; }
    let pathname = decodeURIComponent(url.pathname);
    if (pathname.endsWith('/')) pathname += 'index.html';
    const file = resolve(root, `.${pathname}`);
    // Never serve paths outside the root, dotfiles (.git, .github) or dependencies.
    // Segments come from the resolved path so "\" separators on Windows are covered too.
    const segments = relative(root, file).split(sep);
    if ((file !== root && !file.startsWith(root + sep)) || segments.some(part => part.startsWith('.') || part === 'node_modules')) {
      response.writeHead(403).end('Forbidden');
      return;
    }
    let target = file;
    const stat = await fs.stat(target).catch(() => null);
    if (stat?.isDirectory()) {
      target = join(target, 'index.html');
      // "/admin" must become "/admin/" so the page's relative links
      // (./admin.css, ./admin.js) resolve inside the folder.
      if (!url.pathname.endsWith('/') && await fs.stat(target).then(found => found.isFile(), () => false)) {
        // One leading slash only: "//host/" would be read as another site.
        response.writeHead(301, { ...siteHeaders(url.pathname), location: `/${url.pathname.replace(/^\/+/, '')}/${url.search}`, 'cache-control': 'no-store', [MARKER]: '1' }).end();
        return;
      }
    }
    let body = await fs.readFile(target);
    // The served runtime config: the build variables of this environment, and with --api the local API, unless a
    // build already set them (dist/ writes its values another way, so it is left as built).
    if (relative(root, target) === 'runtime-config.js') body = Buffer.from(devRuntimeConfig(body.toString('utf8')));
    response.writeHead(200, {
      ...siteHeaders(url.pathname),
      'content-type': types[extname(target).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-store',
      [MARKER]: '1'
    });
    response.end(request.method === 'HEAD' ? undefined : body);
  } catch {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8', [MARKER]: '1' }).end('Not found');
  }
}

async function isPlannerRunning(port) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1200);
    const result = await fetch(`http://127.0.0.1:${port}/manifest.webmanifest`, { signal: controller.signal });
    clearTimeout(timer);
    if (result.headers.get(MARKER)) return true;
    return (await result.text()).includes('Daily Planner');
  } catch {
    return false;
  }
}

function openBrowser(url) {
  const command = process.platform === 'win32' ? 'cmd' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const commandArgs = process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
  try {
    spawn(command, commandArgs, { stdio: 'ignore', detached: true, windowsHide: true }).unref();
  } catch {
    console.log(`Open ${url} in your browser.`);
  }
}

function listen(port) {
  return new Promise((resolveListen, rejectListen) => {
    const server = createServer(handle);
    server.once('error', rejectListen);
    server.listen(port, host, () => resolveListen(server));
  });
}

function lanAddresses(port) {
  return Object.values(networkInterfaces()).flat()
    .filter(address => address && address.family === 'IPv4' && !address.internal)
    .map(address => `http://${address.address}:${port}`);
}

let port = preferredPort;
let server = null;
for (let attempt = 0; attempt < 15 && !server; attempt += 1) {
  try {
    server = await listen(port);
  } catch (error) {
    if (error.code !== 'EADDRINUSE') throw error;
    if (port === preferredPort && await isPlannerRunning(port)) {
      const url = `http://localhost:${port}`;
      console.log(`Daily Planner is already running at ${url}`);
      if (shouldOpen) openBrowser(url);
      process.exit(0);
    }
    if (port === preferredPort) {
      console.warn(`Port ${preferredPort} is used by another program.`);
      console.warn('Heads-up: browsers keep planner data per address, so plans saved on');
      console.warn(`http://localhost:${preferredPort} will not appear on a different port. Free port ${preferredPort} to keep the same data.`);
    }
    port += 1;
  }
}

if (!server) {
  console.error('Could not find a free port. Try: node scripts/serve.mjs --port 9000');
  process.exit(1);
}

const url = `http://localhost:${port}`;
console.log('');
console.log(`  Daily Planner ${useDist ? '(production build)' : '(source)'} is running`);
console.log(`  → ${url}`);
if (lan) lanAddresses(port).forEach(address => console.log(`  → ${address}  (other devices on this network)`));
console.log('');
if (plannerApi) {
  console.log(`  Owner dashboard → ${url}/admin/   (token: ${process.env.ADMIN_TOKEN ? 'from ADMIN_TOKEN' : `${adminToken} — set ADMIN_TOKEN to choose your own`}${adminTotpSecret ? ' · 2FA on' : ''})`);
  console.log(`  Email: ${emailMode}`);
}
console.log('  Your plans stay in this browser. Press Ctrl+C to stop the server.');
console.log('');
if (shouldOpen) openBrowser(url);

const stop = () => server.close(() => process.exit(0));
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
