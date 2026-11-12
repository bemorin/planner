// Browser scenarios for 1.40's day archive (older days moved to IndexedDB), in Chromium, with no dependency: the
// DevTools protocol, as scripts/smoke.mjs drives it. Not part of `npm run verify` (they take a few minutes and serve
// the planner on two ports); run them before a release that touches src/state/day-*.js:
//
//   CHROME_BIN=/path/to/chrome node scripts/archive-scenarios.mjs [--only adapter,quota,interrupted,older-tab,import,performance]
//
// Safari's localStorage quota (2,621,440 characters) is simulated in Chromium by an init script that makes
// Storage.prototype.setItem refuse a write above it (QuotaExceededError), as Safari does; seeding goes around it.
//
// - adapter      the IndexedDB adapter itself: batched reads across 1,000, strict writes, keeping aside, reopening.
// - quota        as many typical days as fit (about 1,000) and a few from 2009, Safari's quota full to its last 20
//                characters: the idle pass brings localStorage to 40% or less, Search finds the 2009 day and the
//                Journal shows it, the next save lands; then, with storage filled again, a refused save says
//                “Saving…”, lands, and no “Not saved” remains.
// - interrupted  a pass stopped (a closed tab) after its verify, after its manifest, and after 37 removals: the
//                planner opened again reads every day, and its next pass completes.
// - older-tab    a 1.39.4 planner and a 1.40 one on the same address, with service workers (127.0.0.2, a loopback
//                address that isn't “localhost”): idle passes wait; a refused save in 1.40 makes room anyway; 1.39.4
//                edits a day that moved, which the open 1.40 tab then shows at once, the earlier copy kept aside, the
//                header saying so; Data on this device says the older tab is open; Restore puts it back, keeping
//                1.39.4's version aside in its place, and 1.39.4 saving over it again leaves the real day kept aside.
// - import       a 10,000-day backup through the file input: every day imported, localStorage at 40% or less.
// - performance  10,000 days (the import's): first render with and without an archive, the archive's load, Journal
//                open, a Search keystroke, year review open. Reported, never a gate.
//
// The planner is served from this tree by scripts/serve.mjs on port 8800 (ARCHIVE_SCENARIOS_PORT); the older-tab
// scenario serves two trees in turn on 127.0.0.2:8801 (ARCHIVE_SCENARIOS_SECOND_PORT; 1.39.4 from git, `main` or
// ARCHIVE_SCENARIOS_OLD_REF).

import { spawn, execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { promises as fs } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { historyDay, historyDays } from '../tests/support/history.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const port = (name, raw, fallback) => {
  const value = Number(raw || fallback);
  if (!Number.isInteger(value) || value < 1 || value > 65535) throw new Error(`${name} is not a port: ${raw}`);
  return value;
};
const PORT = port('ARCHIVE_SCENARIOS_PORT', process.env.ARCHIVE_SCENARIOS_PORT, 8800);
const SECOND_PORT = port('ARCHIVE_SCENARIOS_SECOND_PORT', process.env.ARCHIVE_SCENARIOS_SECOND_PORT, 8801);
const SAFARI = 2621440;
const onlyAt = process.argv.indexOf('--only');
const only = (process.argv.find(arg => arg.startsWith('--only=')) || (onlyAt > 1 ? process.argv[onlyAt + 1] : '') || '').replace('--only=', '').split(',').filter(Boolean);
const wanted = name => !only.length || only.includes(name);
const sleep = ms => new Promise(resolveSleep => setTimeout(resolveSleep, ms));
const pad = n => String(n).padStart(2, '0');
const localKey = date => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const TODAY = localKey(new Date());
const pct = chars => `${(chars / SAFARI * 100).toFixed(1)}%`;

async function firstExisting(paths) {
  for (const path of paths.filter(Boolean)) { try { await fs.access(path); return path; } catch {} }
  return '';
}
const chrome = await firstExisting([process.env.CHROME_BIN, '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable']);
if (!chrome) { console.error('Set CHROME_BIN to a Chromium or Chrome executable.'); process.exit(1); }

// ---------------------------------------------------------------------------
// Chromium over the DevTools protocol
// ---------------------------------------------------------------------------

/** Safari's quota for localStorage, simulated: a write above it is refused. Seeding uses Storage.prototype.__realSetItem. */
const SAFARI_QUOTA = `(() => {
  const proto = Storage.prototype;
  if (proto.__realSetItem) return;
  const real = proto.setItem;
  proto.__realSetItem = real;
  proto.setItem = function (key, value) {
    if (this === window.localStorage) {
      let used = 0;
      for (let i = 0; i < this.length; i += 1) { const k = this.key(i); used += k.length + (this.getItem(k) || '').length; }
      const before = this.getItem(String(key));
      const next = used - (before == null ? 0 : String(key).length + before.length) + String(key).length + String(value).length;
      if (next > ${SAFARI}) throw new DOMException('The quota has been exceeded.', 'QuotaExceededError');
    }
    return real.call(this, key, value);
  };
})();`;

async function launch(extra = []) {
  const profile = await mkdtemp(resolve(tmpdir(), 'daily-planner-archive-'));
  const browser = spawn(chrome, ['--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check', '--remote-debugging-port=0', '--remote-allow-origins=*', `--user-data-dir=${profile}`, ...extra, 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  const ws = await new Promise((resolveWs, reject) => {
    const timer = setTimeout(() => reject(new Error(`Chrome did not start.\n${stderr}`)), 30000);
    browser.stderr.on('data', chunk => { stderr += chunk; const match = stderr.match(/DevTools listening on (ws:\/\/\S+)/); if (match) { clearTimeout(timer); resolveWs(match[1]); } });
  });
  const host = new URL(ws).host;
  const pages = [];
  return {
    async page(url = 'about:blank', { quota = true, init = '' } = {}) {
      const info = await fetch(`http://${host}/json/new?about:blank`, { method: 'PUT' }).then(response => response.json());
      const socket = new WebSocket(info.webSocketDebuggerUrl);
      await new Promise((resolveOpen, reject) => { socket.onopen = resolveOpen; socket.onerror = reject; });
      let seq = 0;
      const pending = new Map();
      const events = [];
      const dialogs = [];
      const send = (method, params = {}) => new Promise((resolveCall, reject) => {
        const id = ++seq;
        const timer = setTimeout(() => { pending.delete(id); reject(new Error(`no answer (${method})`)); }, 120000);
        pending.set(id, { resolve: value => { clearTimeout(timer); resolveCall(value); }, reject: error => { clearTimeout(timer); reject(error); } });
        socket.send(JSON.stringify({ id, method, params }));
      });
      socket.onmessage = message => {
        const data = JSON.parse(message.data);
        if (data.id && pending.has(data.id)) { const call = pending.get(data.id); pending.delete(data.id); if (data.error) call.reject(new Error(data.error.message)); else call.resolve(data.result || {}); return; }
        events.push(data);
        if (data.method === 'Page.javascriptDialogOpening') { dialogs.push(data.params.message); send('Page.handleJavaScriptDialog', { accept: true }).catch(() => {}); }
      };
      for (const method of ['Runtime.enable', 'Page.enable']) await send(method);
      await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
      if (quota) await send('Page.addScriptToEvaluateOnNewDocument', { source: SAFARI_QUOTA });
      if (init) await send('Page.addScriptToEvaluateOnNewDocument', { source: init });
      const evaluate = async (expression, { awaitPromise = true } = {}) => {
        const result = await send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
        if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
        return result.result?.value;
      };
      const page = {
        id: info.id,
        send,
        evaluate,
        events,
        dialogs,
        async go(target) {
          const loaded = new Promise(resolveLoad => { const check = setInterval(() => { if (events.some(event => event.method === 'Page.loadEventFired' && !event.seen)) { events.forEach(event => { event.seen = true; }); clearInterval(check); resolveLoad(); } }, 20); });
          await send('Page.navigate', { url: target });
          await Promise.race([loaded, sleep(20000)]);
        },
        async waitFor(expression, { timeout = 30000, every = 100, label = expression } = {}) {
          const until = Date.now() + timeout;
          for (;;) {
            let value;
            try { value = await evaluate(expression); } catch (_) { value = false; }
            if (value) return value;
            if (Date.now() > until) throw new Error(`timed out waiting for ${label}`);
            await sleep(every);
          }
        },
        errors: () => events.filter(event => event.method === 'Runtime.exceptionThrown').map(event => event.params.exceptionDetails?.exception?.description || event.params.exceptionDetails?.text),
        async close() { socket.close(); await fetch(`http://${host}/json/close/${info.id}`).catch(() => {}); }
      };
      pages.push(page);
      if (url !== 'about:blank') await page.go(url);
      return page;
    },
    async close() {
      browser.kill('SIGTERM');
      await Promise.race([new Promise(resolveExit => browser.once('exit', resolveExit)), sleep(1500)]);
      await rm(profile, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 });
    }
  };
}

// ---------------------------------------------------------------------------
// The planner's data, from the page
// ---------------------------------------------------------------------------

const settings = (extra = {}) => ({ onboardingComplete: true, installPromptShown: true, sponsorPromptShown: true, closeDayCount: 0, weekStartsOn: 1, planningDays: [1, 2, 3, 4, 5], ...extra });

/** Writes `entries` ({ key: string }) into the page's localStorage around the simulated quota, in chunks. */
async function seed(page, entries) {
  const list = Object.entries(entries);
  for (let index = 0; index < list.length; index += 400) {
    const chunk = Object.fromEntries(list.slice(index, index + 400));
    await page.evaluate(`(() => { const set = Storage.prototype.__realSetItem || Storage.prototype.setItem; for (const [k, v] of Object.entries(${JSON.stringify(chunk)})) set.call(localStorage, k, v); return true; })()`);
  }
}

const daysOf = days => Object.fromEntries(days.map(([day, value]) => [`daily-planner:${day}`, JSON.stringify(value)]));

/** What the browser holds: localStorage's characters, its days, the manifest, the archive's days and copies kept aside. */
const HOLDINGS = `(async () => {
  let chars = 0; let hot = 0;
  for (let i = 0; i < localStorage.length; i += 1) { const k = localStorage.key(i); chars += k.length + localStorage.getItem(k).length; if (/^daily-planner:\\d{4}-\\d{2}-\\d{2}$/.test(k)) hot += 1; }
  const read = name => new Promise(resolveRead => {
    const request = indexedDB.open('daily-planner-archive');
    request.onupgradeneeded = () => { request.transaction.abort(); };
    request.onerror = () => resolveRead([]);
    request.onsuccess = () => { const db = request.result; if (!db.objectStoreNames.contains(name)) { db.close(); return resolveRead([]); } const q = db.transaction(name).objectStore(name).getAll(); q.onsuccess = () => { db.close(); resolveRead(q.result); }; q.onerror = () => { db.close(); resolveRead([]); }; };
  });
  const archived = await read('days');
  const aside = await read('displaced');
  return { chars, hot, manifest: localStorage.getItem('daily-planner-store:archive'), archived: archived.length, aside: aside.map(entry => ({ day: entry.day, json: entry.json })) };
})()`;

/** The seeded days that don't read back as the same string from either home: [] when every one does. */
async function unreadable(page, days) {
  const expected = Object.fromEntries(days.map(([day, value]) => [day, JSON.stringify(value)]));
  const missing = [];
  const keys = Object.keys(expected);
  for (let index = 0; index < keys.length; index += 500) {
    const chunk = Object.fromEntries(keys.slice(index, index + 500).map(day => [day, expected[day]]));
    missing.push(...await page.evaluate(`(async () => {
      const db = await new Promise(resolveOpen => { const r = indexedDB.open('daily-planner-archive'); r.onsuccess = () => resolveOpen(r.result); r.onerror = () => resolveOpen(null); });
      const archived = new Map();
      if (db && db.objectStoreNames.contains('days')) await new Promise(done => { const q = db.transaction('days').objectStore('days').getAll(); q.onsuccess = () => { for (const r of q.result) archived.set(r.day, r.json); done(); }; q.onerror = done; });
      db?.close();
      return Object.entries(${JSON.stringify(chunk)}).filter(([day, json]) => (localStorage.getItem('daily-planner:' + day) ?? archived.get(day)) !== json).map(([day]) => day);
    })()`));
  }
  return missing;
}

const results = [];
const numbers = {};
async function scenario(name, fn) {
  if (!wanted(name)) return;
  const started = Date.now();
  const checks = [];
  const check = (label, ok, detail = '') => { checks.push({ label, ok: !!ok, detail }); if (!ok) console.log(`    ✗ ${label}${detail ? ` (${detail})` : ''}`); };
  console.log(`\n${name}`);
  try {
    await fn(check);
  } catch (error) {
    checks.push({ label: 'ran to the end', ok: false, detail: error.message });
    console.log(`    ✗ ${error.stack || error.message}`);
  }
  const failed = checks.filter(item => !item.ok);
  for (const item of checks.filter(entry => entry.ok)) console.log(`    ✓ ${item.label}${item.detail ? ` (${item.detail})` : ''}`);
  results.push({ name, ok: !failed.length, checks, seconds: Math.round((Date.now() - started) / 1000) });
}

// ---------------------------------------------------------------------------
// Servers
// ---------------------------------------------------------------------------

async function startServe() {
  const server = spawn(process.execPath, [resolve(root, 'scripts/serve.mjs'), '--port', String(PORT)], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  await new Promise((resolveStart, reject) => {
    const timer = setTimeout(() => reject(new Error(`serve.mjs did not start: ${out}`)), 15000);
    server.stdout.on('data', chunk => { out += chunk; if (/→ http:\/\/localhost:(\d+)/.test(out)) { clearTimeout(timer); resolveStart(); } });
    server.once('exit', code => reject(new Error(`serve.mjs exited (${code}): ${out}`)));
  });
  const port = Number(out.match(/→ http:\/\/localhost:(\d+)/)[1]);
  if (port !== PORT) { server.kill(); throw new Error(`port ${PORT} is busy (serve.mjs moved to ${port})`); }
  return server;
}

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.woff2': 'font/woff2' };
/** A static server for the older-tab scenario: its root can be switched, as a deploy would switch it. */
async function startSwitchable(host, port) {
  const state = { root: '' };
  const server = createServer(async (request, response) => {
    try {
      let path = decodeURIComponent(new URL(request.url, 'http://x').pathname);
      if (path.endsWith('/')) path += 'index.html';
      const file = join(state.root, path);
      if (!file.startsWith(state.root)) throw new Error('outside');
      const body = await fs.readFile(file);
      response.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      response.end(body);
    } catch (_) {
      response.writeHead(404, { 'Content-Type': 'text/plain' });
      response.end('not found');
    }
  });
  await new Promise((resolveListen, reject) => { server.once('error', reject); server.listen(port, host, resolveListen); });
  return { server, state };
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

const ORIGIN = `http://localhost:${PORT}`;
const BLANK = `${ORIGIN}/__archive-scenario-blank`;

async function bootPlanner(page, { origin = ORIGIN } = {}) {
  await page.go(`${origin}/`);
  await page.waitFor("!!document.querySelector('[data-date]')?.textContent && !document.documentElement.hasAttribute('data-booting')", { label: 'the planner shown' });
}

async function typeInFocus(page, text) {
  await page.evaluate(`(() => { const field = document.querySelector('[data-focus]'); field.focus(); field.value = ${JSON.stringify(text)}; field.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
}

const serve = await startServe();
let failures = 0;
try {
  await scenario('adapter', async check => {
    const browser = await launch();
    try {
      const page = await browser.page(BLANK, { quota: false });
      const out = await page.evaluate(`(async () => {
        const { createDayArchive } = await import('/src/state/day-archive.js');
        const archive = createDayArchive();
        await archive.open();
        const days = [];
        const start = new Date('2015-01-01T12:00:00Z');
        for (let i = 0; i < 2500; i += 1) days.push({ day: new Date(start.getTime() + i * 86400000).toISOString().slice(0, 10), json: JSON.stringify({ i, text: 'é’'.repeat(40) }) });
        for (let i = 0; i < days.length; i += 250) await archive.put(days.slice(i, i + 250));
        const all = await archive.all();
        const back = await archive.read(days.slice(0, 250).map(d => d.day));
        const range = await archive.range('2015-02-01', '2015-03-01');
        await archive.keepAside([{ day: days[0].day, json: days[0].json }], { drop: [days[0].day] });
        const aside = await archive.displaced();
        archive.close();
        const reopened = await archive.all();
        await archive.clear({ displaced: true });
        return { all: all.length, ordered: all.every((r, i) => !i || all[i - 1].day < r.day), same: days.slice(0, 250).every(d => back.get(d.day) === d.json), range: range.length, aside: aside.length, reopened: reopened.length, empty: (await archive.all()).length + (await archive.displaced()).length };
      })()`);
      check('2,500 days written in strict batches and read back across batches of 1,000, oldest first', out.all === 2500 && out.ordered);
      check('a batch reads back string for string, non-Latin-1 characters included', out.same);
      check('a range of days, an earlier copy kept aside, a connection opened again after closing', out.range === 28 && out.aside === 1 && out.reopened === 2499);
      check('Reset’s clear empties both stores', out.empty === 0);
    } finally { await browser.close(); }
  });

  await scenario('quota', async check => {
    const browser = await launch();
    try {
      const page = await browser.page(BLANK);
      // As full as Safari lets it be: as many typical days as fit (about 1,000), three from 2009, and the last
      // characters taken, so even the manifest's few don't fit before a day moves.
      const old = ['2009-06-15', '2009-06-16', '2009-06-17'].map(day => {
        const value = historyDay(day);
        return [day, { ...value, focus: 'Paint the 2009 fence', memory: 'The fence in 2009 looked great', endedAt: `${day}T18:00:00` }];
      });
      const size = ([day, value]) => `daily-planner:${day}`.length + JSON.stringify(value).length;
      let room = SAFARI - 'daily-planner:settings'.length - JSON.stringify(settings()).length - old.reduce((total, entry) => total + size(entry), 0);
      const days = [];
      for (const entry of historyDays(1200, { today: TODAY }).reverse()) { if (size(entry) > room) break; days.unshift(entry); room -= size(entry); }
      const all = [...old, ...days];
      await seed(page, { 'daily-planner:settings': JSON.stringify(settings()), ...daysOf(all), 'daily-planner-ui:scenario-filler': 'x'.repeat(Math.max(0, room - 'daily-planner-ui:scenario-filler'.length - 20)) });
      const seeded = await page.evaluate(HOLDINGS);
      check('seeded to Safari’s quota, 20 characters left', seeded.chars > SAFARI - 100 && seeded.chars <= SAFARI, `${all.length} days, ${pct(seeded.chars)}`);
      const started = Date.now();
      await bootPlanner(page);
      await page.waitFor(`(async () => { const h = await ${HOLDINGS}; return h.manifest && h.chars <= ${SAFARI * 0.4}; })()`, { timeout: 60000, label: 'the idle pass' });
      const after = await page.evaluate(HOLDINGS);
      check('the idle pass brings localStorage to 40% or less', after.chars <= SAFARI * 0.4, `${pct(after.chars)} after ${Math.round((Date.now() - started) / 100) / 10} s, ${after.archived} days moved, ${after.hot} stay`);
      check('every day reads back, the identical string', !(await unreadable(page, all)).length);
      // Search finds a 2009 day, and its memory opens the Journal on that day.
      await page.evaluate("document.querySelector('[data-search-open]').click()");
      await page.waitFor("!document.querySelector('[data-search-modal]').hidden");
      await page.evaluate("(() => { const input = document.querySelector('[data-search-input]'); input.value = 'fence in 2009'; input.dispatchEvent(new Event('input', { bubbles: true })); return true; })()");
      const found = await page.waitFor("[...document.querySelectorAll('[data-search-date]')].filter(b => b.dataset.searchDate.startsWith('2009-')).map(b => b.dataset.searchDate + ':' + b.dataset.searchKind)", { timeout: 5000, label: 'a 2009 result' });
      check('Search finds the 2009 day', found.length > 0, found.slice(0, 3).join(', '));
      await page.evaluate("[...document.querySelectorAll('[data-search-date]')].find(b => b.dataset.searchDate.startsWith('2009-') && b.dataset.searchKind === 'memory').click()");
      const journal = await page.waitFor("!document.querySelector('[data-journal-modal]').hidden && document.querySelector('[data-journal-modal]').textContent.includes('The fence in 2009 looked great')", { timeout: 5000, label: 'the Journal at 2009' });
      check('the Journal shows it', journal);
      await page.evaluate("document.querySelector('[data-journal-modal] [data-modal-close]').click()");
      await sleep(400);
      // The next save lands: today, typed.
      await page.evaluate("document.querySelector('[data-today]')?.click()");
      await typeInFocus(page, 'Saved after the move');
      const saved = await page.waitFor(`(localStorage.getItem('daily-planner:${TODAY}') || '').includes('Saved after the move')`, { timeout: 5000, label: 'the save' });
      check('the next save lands', saved);
      // Storage filled again (by something else on this site), then a change: refused, room made, saved.
      const fill = await page.evaluate(`(() => { let used = 0; for (let i = 0; i < localStorage.length; i += 1) { const k = localStorage.key(i); used += k.length + localStorage.getItem(k).length; } const size = ${SAFARI} - used - 300; Storage.prototype.__realSetItem.call(localStorage, 'daily-planner-ui:scenario-filler', 'x'.repeat(size)); return used + size + 31; })()`);
      check('storage filled again', fill > SAFARI * 0.99, pct(fill));
      await page.evaluate("(() => { window.__pills = []; const text = document.querySelector('[data-storage-alert-text]'); new MutationObserver(() => window.__pills.push(text.textContent)).observe(text, { childList: true, characterData: true, subtree: true }); return true; })()");
      const long = `A longer plan for today: ${'carefully worded and well thought through, '.repeat(40)}`;
      await typeInFocus(page, long);
      const landed = await page.waitFor(`(localStorage.getItem('daily-planner:${TODAY}') || '').includes('carefully worded')`, { timeout: 15000, label: 'the refused save landing' });
      await sleep(500);
      const pills = await page.evaluate('window.__pills');
      check('a refused save says “Saving…” while room is made', pills.includes('Saving…'), pills.join(' → ') || 'nothing shown');
      check('then it lands', landed);
      const notice = await page.evaluate("(() => { const t = document.querySelector('[data-storage-alert]'); return t.hidden ? '' : t.dataset.kind; })()");
      check('and no “Not saved” remains', notice !== 'full', notice || 'no notice');
      check('no error in the page', !page.errors().length, page.errors().join(' | '));
      numbers.quota = { seeded: pct(seeded.chars), after: pct(after.chars), moved: after.archived };
    } finally { await browser.close(); }
  });

  await scenario('interrupted', async check => {
    for (const stopAt of ['verify', 'manifest', 37]) {
      const browser = await launch();
      try {
        const days = historyDays(900, { today: TODAY });
        const first = await browser.page(BLANK, { init: `window.__DAILY_PLANNER_ARCHIVE_HOOK__ = { stopAt: ${JSON.stringify(stopAt)} };` });
        await seed(first, { 'daily-planner:settings': JSON.stringify(settings()), ...daysOf(days) });
        await bootPlanner(first);
        const stopped = stopAt === 'verify'
          ? await first.waitFor(`(async () => { const h = await ${HOLDINGS}; return h.archived > 0 && !h.manifest && h; })()`, { timeout: 30000, label: 'the put' })
          : stopAt === 'manifest'
            ? await first.waitFor(`(async () => { const h = await ${HOLDINGS}; return h.manifest && h.hot === ${days.length} && h; })()`, { timeout: 30000, label: 'the manifest' })
            : await first.waitFor(`(async () => { const h = await ${HOLDINGS}; return h.manifest && h.hot === ${days.length - stopAt} && h; })()`, { timeout: 30000, label: 'the removals' });
        await sleep(800);
        const still = await first.evaluate(HOLDINGS);
        check(`stopped after ${stopAt === 37 ? '37 removals' : `its ${stopAt}`}`, still.hot === stopped.hot, `${still.archived} in the archive, ${still.hot} in localStorage, manifest ${still.manifest ? 'written' : 'not written'}`);
        await first.close();
        // The tab is gone; the planner opens again.
        const second = await browser.page(BLANK);
        await bootPlanner(second);
        check('  every day reads back after the reload', !(await unreadable(second, days)).length);
        await second.waitFor(`(async () => { const h = await ${HOLDINGS}; return h.chars <= ${SAFARI * 0.4}; })()`, { timeout: 30000, label: 'the next pass' });
        const done = await second.evaluate(HOLDINGS);
        check('  and the next pass completes', done.chars <= SAFARI * 0.4 && !(await unreadable(second, days)).length, pct(done.chars));
        const keys = await second.evaluate("(async () => { await new Promise(r => setTimeout(r, 300)); return document.querySelector('[data-journal-open]') ? true : false; })()");
        check('  no error in the page', keys && !second.errors().length, second.errors().join(' | '));
      } finally { await browser.close(); }
    }
  });

  await scenario('older-tab', async check => {
    const oldRef = process.env.ARCHIVE_SCENARIOS_OLD_REF || 'main';
    const work = await mkdtemp(resolve(tmpdir(), 'daily-planner-1394-'));
    const oldTree = join(work, 'old');
    await fs.mkdir(oldTree);
    execFileSync('sh', ['-c', `git -C "${root}" archive ${oldRef} | tar -x -C "${oldTree}"`]);
    const oldVersion = JSON.parse(await fs.readFile(join(oldTree, 'package.json'), 'utf8')).version;
    const { server, state } = await startSwitchable('127.0.0.2', SECOND_PORT);
    const origin = `http://127.0.0.2:${SECOND_PORT}`;
    const browser = await launch();
    try {
      // Tab A: the planner as it was (1.39.4), its service worker in control.
      state.root = oldTree;
      const a = await browser.page(`${origin}/__blank`);
      const days = historyDays(900, { today: TODAY });
      await seed(a, { 'daily-planner:settings': JSON.stringify(settings()), ...daysOf(days) });
      await bootPlanner(a, { origin });
      await a.waitFor('navigator.serviceWorker.controller ? true : false', { timeout: 20000, label: `the ${oldVersion} worker in control` });
      check(`tab A runs ${oldVersion}, its worker in control`, true, await a.evaluate("caches.keys().then(keys => keys.join(','))"));
      // A deploy: the same address now serves 1.40. Tab B opens it; its worker takes over both tabs.
      state.root = root;
      const b = await browser.page(`${origin}/`);
      await b.waitFor("!!document.querySelector('[data-date]')?.textContent && !document.documentElement.hasAttribute('data-booting')", { label: 'tab B' });
      await b.waitFor("caches.keys().then(keys => keys.includes('daily-planner-1.40.0') && !!navigator.serviceWorker.controller)", { timeout: 20000, label: 'the 1.40 worker' });
      // Opened again under the 1.40 worker: the roll call answers, and the idle pass waits for the older tab.
      await b.go(`${origin}/`);
      await b.waitFor("!!document.querySelector('[data-date]')?.textContent && !document.documentElement.hasAttribute('data-booting')");
      await sleep(6000);
      const waited = await b.evaluate(HOLDINGS);
      check('with the older tab open, the idle pass waits', !waited.manifest && waited.hot === days.length, `${pct(waited.chars)} full, nothing moved`);
      const roll = await b.evaluate("(async () => { const channel = new MessageChannel(); const answer = new Promise(r => { channel.port1.onmessage = e => r(e.data); }); navigator.serviceWorker.controller.postMessage({ type: 'planner-windows' }, [channel.port2]); const held = (await navigator.locks.query()).held.filter(l => l.name === 'daily-planner:tab').length; return { ...(await answer), held }; })()");
      check('the roll call: two planner windows, one tab lock, a 1.40 worker', roll.windows === 2 && roll.held === 1 && roll.version === '1.40.0', JSON.stringify(roll));
      // Storage full, a change in B: refused, so room is made anyway.
      await b.evaluate(`(() => { let used = 0; for (let i = 0; i < localStorage.length; i += 1) { const k = localStorage.key(i); used += k.length + localStorage.getItem(k).length; } Storage.prototype.__realSetItem.call(localStorage, 'daily-planner-ui:scenario-filler', 'x'.repeat(${SAFARI} - used - 300)); return true; })()`);
      await typeInFocus(b, `Typed in 1.40 while storage was full ${'and then some more words, '.repeat(30)}`);
      await b.waitFor(`(localStorage.getItem('daily-planner:${TODAY}') || '').includes('Typed in 1.40')`, { timeout: 15000, label: 'B’s save' });
      const moved = await b.evaluate(HOLDINGS);
      check('a refused save in B makes room anyway (an emergency pass)', !!moved.manifest && moved.archived > 0, `${moved.archived} days moved`);
      await b.evaluate("localStorage.removeItem('daily-planner-ui:scenario-filler')");
      // In A (1.39.4), a day that moved, well inside the moved range: it looks empty there, and A plans on it.
      const [targetDay] = days[Math.floor(moved.archived / 2)];
      // What the archive holds before A writes: B (1.40, open) keeps it aside as soon as it hears A's write.
      await b.evaluate(`(async () => {
        const db = await new Promise(r => { const q = indexedDB.open('daily-planner-archive'); q.onsuccess = () => r(q.result); });
        const all = await new Promise(r => { const q = db.transaction('days').objectStore('days').getAll(); q.onsuccess = () => r(q.result); q.onerror = () => r([]); });
        db.close();
        window.__scenarioArchived = Object.fromEntries(all.map(rec => [rec.day, rec.json]));
        return all.length;
      })()`);
      const weeks = Math.round((new Date(`${TODAY}T12:00:00`) - new Date(`${targetDay}T12:00:00`)) / (7 * 86400000));
      await a.send('Page.bringToFront');
      await sleep(300);
      await a.evaluate(`(() => { const key = k => document.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })); key('v'); for (let i = 0; i < ${weeks}; i += 1) key('ArrowLeft'); key('v'); return true; })()`);
      await sleep(300);
      const looked = await a.evaluate("document.querySelector('[data-focus]').value");
      await typeInFocus(a, 'Planned in the older tab');
      await sleep(1500);
      const blindKey = (await a.evaluate("Object.keys(localStorage).filter(k => /^daily-planner:\\d{4}-\\d{2}-\\d{2}$/.test(k) && (localStorage.getItem(k) || '').includes('Planned in the older tab'))"))[0] || '';
      const blindDay = blindKey.slice(14);
      const archivedThere = await b.evaluate(`window.__scenarioArchived['${blindDay}'] || null`);
      check(`tab A (${oldVersion}) saw a moved day as empty and wrote it blind`, !!blindDay && !!archivedThere && looked === '', blindDay || 'nothing written');
      // B, open all along, hears A's write at once (1.40 review M3): A's edit stands, and the archived version is kept
      // aside then, not at B's next start; the header says so, once.
      await b.send('Page.bringToFront');
      const aside = await b.waitFor(`(async () => { const h = await ${HOLDINGS}; return h.aside.find(e => e.day === '${blindDay}'); })()`, { timeout: 20000, label: 'the copy kept aside' });
      check('B keeps the earlier version aside as soon as it hears the write, without a reload', aside && aside.json === archivedThere);
      const shows = await b.evaluate(`(async () => { const { createDayStore } = await import('/src/state/day-store.js'); const store = createDayStore(localStorage); await store.ready(); return store.get('daily-planner:${blindDay}'); })()`);
      check('B shows A’s edit: the newer write wins', (shows || '').includes('Planned in the older tab'));
      const header = await b.waitFor("(() => { const pill = document.querySelector('[data-storage-alert]'); return pill && !pill.hidden && pill.dataset.kind === 'aside' ? pill.dataset.tooltip : null; })()", { timeout: 10000, label: 'the header notice' });
      check('the header says so, calmly, once', /^An earlier version of .+ was kept aside\. Review it in How it works → Data on this device\.$/.test(header || ''), header);
      await b.go(`${origin}/`);
      await b.waitFor("!!document.querySelector('[data-date]')?.textContent && !document.documentElement.hasAttribute('data-booting')");
      const said = await b.evaluate("(() => { document.querySelector('[data-help-open]').click(); return new Promise(r => setTimeout(() => r(document.querySelector('[data-storage-safety]').textContent + ' | ' + document.querySelector('[data-storage-recovery-list]').textContent), 1200)); })()");
      check('Data on this device says so, with a Download and a Restore', /kept aside/.test(said) && /Download/.test(said) && /Restore/.test(said), said.slice(0, 200));
      // The 1.39.4 tab is still open: next to Restore, a line says it may save over the day again (second review).
      const warned = await b.waitFor("(() => { const note = document.querySelector('[data-storage-recovery-note]'); return note && !note.hidden ? note.textContent : null; })()", { timeout: 10000, label: 'the older-tab line' });
      check('with the older tab open, a line next to Restore says so', warned === 'An older version of the planner is open in another tab. Close it first, or it may save over this day again.', warned);
      // Restore: the earlier version is the day again, and what A wrote is kept aside in its place (review m6).
      await b.evaluate("(() => { document.querySelector('[data-storage-recovery-restore]').click(); return true; })()");
      const back = await b.waitFor(`(async () => { const h = await ${HOLDINGS}; return h.aside.some(e => e.day === '${blindDay}' && e.json.includes('Planned in the older tab')) ? localStorage.getItem('daily-planner:${blindDay}') : null; })()`, { timeout: 10000, label: 'the restore' });
      check('Restore puts the earlier version back, and keeps the older tab’s aside in its place', back === archivedThere);
      // The older tab saves its version again: the real day is still kept aside, marked restored (second review, major).
      await a.send('Page.bringToFront');
      await typeInFocus(a, ' and again');
      await sleep(1500);
      await b.send('Page.bringToFront');
      const still = await b.waitFor(`(async () => { const db = await new Promise(r => { const q = indexedDB.open('daily-planner-archive'); q.onsuccess = () => r(q.result); }); const all = await new Promise(r => { const q = db.transaction('displaced').objectStore('displaced').getAll(); q.onsuccess = () => r(q.result); }); db.close(); return (localStorage.getItem('daily-planner:${blindDay}') || '').includes('and again') ? all.filter(e => e.day === '${blindDay}').map(e => ({ json: e.json, restoredAt: e.restoredAt || '' })) : null; })()`, { timeout: 10000, label: 'the older tab saving again' });
      check('the older tab saves over it again: the real day is still kept aside, marked restored', still.some(entry => entry.json === archivedThere && entry.restoredAt), `${still.length} copies kept aside`);
      check('no error in either tab', !a.errors().length && !b.errors().length, [...a.errors(), ...b.errors()].join(' | '));
    } finally {
      await browser.close();
      server.close();
      await rm(work, { recursive: true, force: true });
    }
  });

  let importProfile = null;
  await scenario('import', async check => {
    const browser = await launch();
    importProfile = browser;
    const page = await browser.page(BLANK);
    await seed(page, { 'daily-planner:settings': JSON.stringify(settings()) });
    await bootPlanner(page);
    const days = historyDays(10000, { kind: 'mixed', today: TODAY });
    const file = resolve(tmpdir(), `daily-planner-10000-days-${process.pid}.json`);
    await writeFile(file, JSON.stringify({ app: 'Daily Planner', version: 13, exportedAt: new Date().toISOString(), settings: settings({ startHour: 7 }), days: Object.fromEntries(days) }));
    const { root: documentRoot } = await page.send('DOM.getDocument', { depth: 1 });
    const { nodeId } = await page.send('DOM.querySelector', { nodeId: documentRoot.nodeId, selector: '[data-import-file]' });
    await page.send('DOM.setFileInputFiles', { nodeId, files: [file] });
    await page.waitFor("!document.querySelector('[data-import-modal]').hidden", { timeout: 30000, label: 'the import dialog' });
    const summary = await page.evaluate("document.querySelector('[data-import-summary]').textContent");
    check('the file read: 10,000 days', /10000 planner days/.test(summary), summary);
    const started = Date.now();
    await page.evaluate("document.querySelector('[data-import-confirm]').click()");
    await page.waitFor("document.querySelector('[data-import-modal]').hidden", { timeout: 120000, label: 'the import' });
    const seconds = (Date.now() - started) / 1000;
    await sleep(500);
    const held = await page.evaluate(HOLDINGS);
    check('nothing said: every day imported', !page.dialogs.length, page.dialogs.join(' | '));
    check('every day stored: localStorage and the archive', held.hot + held.archived >= 10000, `${held.hot} + ${held.archived}, in ${seconds.toFixed(1)} s`);
    check('localStorage at 40% or less', held.chars <= SAFARI * 0.4, pct(held.chars));
    check('every day reads back', !(await unreadable(page, days)).length);
    await page.evaluate("document.querySelector('[data-help-open]').click()");
    const usage = await page.waitFor("(t => /older/.test(t) && t)(document.querySelector('[data-storage-usage]').textContent)", { timeout: 10000 });
    check('Data on this device counts them', /10,0\d\d saved days/.test(usage), usage);
    numbers.import = { seconds: seconds.toFixed(1), localStorage: pct(held.chars), hot: held.hot, archived: held.archived };
    await rm(file, { force: true });
  });

  await scenario('performance', async check => {
    const FIRST_RENDER = "window.__firstRender = 0; new MutationObserver((_, observer) => { const d = document.querySelector('[data-date]'); if (d && d.textContent) { window.__firstRender = performance.now(); observer.disconnect(); } }).observe(document, { childList: true, subtree: true, characterData: true });";
    const measure = async page => page.evaluate('window.__firstRender');
    // Without an archive: a year and a half of typical days, all in localStorage.
    const plain = await launch();
    try {
      const page = await plain.page(BLANK, { init: FIRST_RENDER });
      await seed(page, { 'daily-planner:settings': JSON.stringify(settings()), ...daysOf(historyDays(400, { today: TODAY })) });
      await bootPlanner(page);
      numbers.firstRenderPlain = Math.round(await measure(page));
    } finally { await plain.close(); }
    // With one: the 10,000 days the import placed.
    const browser = importProfile;
    if (!browser) throw new Error('needs the import scenario first');
    try {
      const page = await browser.page(BLANK, { init: FIRST_RENDER });
      await bootPlanner(page);
      numbers.firstRenderArchive = Math.round(await measure(page));
      const load = await page.evaluate(`(async () => {
        const { createDayStore } = await import('/src/state/day-store.js');
        const store = createDayStore(localStorage);
        const t = performance.now();
        await store.ready();
        return { ms: performance.now() - t, days: store.stats().days };
      })()`);
      numbers.archiveLoad = Math.round(load.ms);
      check('the archive loads every day', load.days >= 10000, `${load.days} days in ${Math.round(load.ms)} ms`);
      await page.waitFor("document.querySelector('[data-journal-open]') && true");
      await sleep(3000);
      const frame = 'new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)))';
      numbers.journalOpen = Math.round(await page.evaluate(`(async () => { const t = performance.now(); document.querySelector('[data-journal-open]').click(); await ${frame}; const rows = document.querySelectorAll('[data-journal-modal] .journal-row').length; const ms = performance.now() - t; document.querySelector('[data-journal-modal] [data-modal-close]').click(); return rows ? ms : -1; })()`));
      await sleep(400);
      await page.evaluate("document.querySelector('[data-search-open]').click()");
      await sleep(300);
      await page.evaluate("(() => { const input = document.querySelector('[data-search-input]'); input.value = 'gar'; input.dispatchEvent(new Event('input', { bubbles: true })); return true; })()");
      await sleep(300);
      numbers.searchKeystroke = Math.round(await page.evaluate(`(async () => { const input = document.querySelector('[data-search-input]'); const t = performance.now(); input.value = 'gard'; input.dispatchEvent(new Event('input', { bubbles: true })); await ${frame}; const ms = performance.now() - t; document.querySelector('[data-search-modal] [data-modal-close]').click(); return document.querySelectorAll('[data-search-date]').length ? ms : -1; })()`));
      await sleep(400);
      numbers.yearReviewOpen = Math.round(await page.evaluate(`(async () => {
        document.querySelector('[data-view-option="horizon"]').click();
        await new Promise(r => setTimeout(r, 500));
        document.querySelector('[data-horizon-modal]').dispatchEvent(new KeyboardEvent('keydown', { key: '7', bubbles: true }));
        await new Promise(r => setTimeout(r, 300));
        const button = document.querySelector('[data-horizon-review]');
        if (!button) return -1;
        const t = performance.now();
        button.click();
        await ${frame};
        return performance.now() - t;
      })()`));
      for (const [label, value] of [['first render without an archive', numbers.firstRenderPlain], ['first render with 10,000 days, most archived', numbers.firstRenderArchive], ['the archive’s load (10,000 days)', numbers.archiveLoad], ['Journal open', numbers.journalOpen], ['a Search keystroke', numbers.searchKeystroke], ['year review open', numbers.yearReviewOpen]]) check(label, value >= 0, `${value} ms`);
      check('no error in the page', !page.errors().length, page.errors().join(' | '));
    } finally { await browser.close(); importProfile = null; }
  });
  if (importProfile) await importProfile.close();
} finally {
  serve.kill('SIGTERM');
}

console.log('\nSummary');
for (const result of results) {
  console.log(`  ${result.ok ? 'passed' : 'FAILED'}  ${result.name} (${result.seconds} s)`);
  if (!result.ok) failures += 1;
}
if (Object.keys(numbers).length) console.log(`\nNumbers\n${JSON.stringify(numbers, null, 2)}`);
process.exitCode = failures ? 1 : 0;
