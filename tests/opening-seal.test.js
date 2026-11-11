import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { GREETINGS, GUARD_GRACE_MS, HOLD_MS, HOLD_REDUCED_MS, LEAVE_FALLBACK_MS, LEAVE_MS, LEAVE_REDUCED_MS, LOST_EVENTS, MAX_HOLD_MS, MIN_VISIBLE_MS, OPENED_KEY, PLANNER_FAILSAFE_MS, SESSION_KEY, SEAL_FAILSAFE_MS, SKIP_EVENTS, SKIP_TAIL_MS, TRUST_LINES, browserKey, dayKey, driveConnected, fillOpening, firstOpening, greetingFor, guardOpening, holdFor, holdOpening, leaveOpening, openingHold, readOpening, skipOnInput, skipOpening } from '../src/features/opening-seal.js';
import { FAILSAFE_MS, showPlanner, whenPlannerShown } from '../src/features/app-entrance.js';

const read = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return { getItem: key => (data.has(key) ? data.get(key) : null), setItem: (key, value) => data.set(key, String(value)), removeItem: key => data.delete(key), data };
}

const DRIVE = 'daily-planner-sync:google';
const SETTINGS = 'daily-planner:settings';
const day = (y, m, d, h = 12) => new Date(y, m - 1, d, h);

/** A page with the seal: its failsafe animation has run `shown` ms; `opacity` as computed. */
function sealPage({ shown = 0, visible = true, greeting = true, booting = false } = {}) {
  const attributes = new Map();
  const texts = {};
  const part = name => ({ set textContent(value) { texts[name] = value; }, get textContent() { return texts[name]; } });
  const seal = {
    dataset: {},
    removed: false,
    getAnimations: () => [{ animationName: 'opening-failsafe', currentTime: shown }],
    listeners: [],
    addEventListener(type, listener) { this.listeners.push([type, listener]); },
    dispatch(type, event) { this.listeners.filter(([name]) => name === type).forEach(([, listener]) => listener({ target: this, ...event })); },
    querySelector: selector => (selector === '[data-opening-greeting]' && greeting ? part('greeting') : selector === '[data-opening-trust]' ? part('trust') : null),
    setAttribute: (name, value) => attributes.set(name, String(value)),
    hasAttribute: name => attributes.has(name),
    remove() { this.removed = true; doc.sealGone = true; }
  };
  const root = new Set(booting ? ['data-booting'] : []);
  const doc = {
    visibilityState: visible ? 'visible' : 'hidden',
    sealGone: false,
    documentElement: { hasAttribute: name => root.has(name), removeAttribute: name => root.delete(name) },
    listeners: [],
    addEventListener(type, listener) { this.listeners.push([type, listener]); },
    removeEventListener(type, listener) { this.listeners = this.listeners.filter(([name, fn]) => name !== type || fn !== listener); },
    querySelector: selector => (selector === '[data-opening]' && !doc.sealGone ? seal : null)
  };
  return { doc, seal, texts, attributes, root };
}

/** A window that records its capture listeners and timers, and a person's input on it. */
function inputWindow() {
  const listeners = new Map();
  const timers = [];
  const win = {
    listeners,
    timers,
    addEventListener(type, listener, options) { assert.equal(options?.capture, true, `${type}: seen first, on the way down`); assert.equal(options?.passive, false, `${type}: can be prevented`); listeners.set(type, listener); },
    removeEventListener(type) { listeners.delete(type); },
    setTimeout: (callback, ms) => { timers.push({ callback, ms, cleared: false }); return timers.length; },
    clearTimeout: id => { if (timers[id - 1]) timers[id - 1].cleared = true; }
  };
  /** Dispatches `type` as a person's input (or a script's); returns what happened to it. */
  win.fire = (type, init = {}) => {
    const event = { type, isTrusted: true, cancelable: true, prevented: false, stopped: false, ...init };
    event.preventDefault = () => { event.prevented = true; };
    event.stopImmediatePropagation = () => { event.stopped = true; };
    listeners.get(type)?.(event);
    return { prevented: event.prevented, stopped: event.stopped };
  };
  win.runTimers = () => timers.filter(timer => !timer.cleared).forEach(timer => { timer.cleared = true; timer.callback(); });
  return win;
}

function withTimers(run) {
  const original = globalThis.setTimeout;
  const timers = [];
  globalThis.setTimeout = (callback, ms) => { timers.push({ callback, ms }); return timers.length; };
  try { return run(timers); } finally { globalThis.setTimeout = original; }
}

test('the greeting: welcome the first time, “opening your day” later the same day, “welcome back” after', () => {
  assert.equal(greetingFor({ last: null, today: '2026-10-27' }), 'first');
  assert.equal(greetingFor({ last: '2026-10-27', today: '2026-10-27' }), 'today');
  assert.equal(greetingFor({ last: '2026-10-26', today: '2026-10-27' }), 'back');
  assert.equal(greetingFor({ last: '2027-01-02', today: '2026-10-27' }), 'back', 'a clock set back still says welcome back');
  assert.equal(greetingFor({ last: null, today: '2026-10-27', known: true }), 'back', 'a planner from before 1.35.1 is not new');
  assert.equal(greetingFor({ last: 'yesterday', today: '2026-10-27' }), 'first', 'a stored value that is not a day counts as none');
  assert.equal(greetingFor({ last: '2026-10-27T08:00', today: '2026-10-27', known: true }), 'back');
});

test('the words are the planner’s, exactly', () => {
  assert.deepEqual({ ...GREETINGS }, { first: 'Welcome to Daily Planner', today: 'Opening your day…', back: 'Welcome back to Daily Planner' });
  assert.deepEqual({ ...TRUST_LINES }, { device: 'Private · your plans stay on this device', drive: 'Private · your plans stay on your devices and your Google Drive', dropbox: 'Private · your plans stay on your devices and your Dropbox' });
  assert.ok(Object.isFrozen(GREETINGS) && Object.isFrozen(TRUST_LINES));
});

test('the day is the local calendar day', () => {
  assert.equal(dayKey(day(2026, 10, 27, 0)), '2026-10-27');
  assert.equal(dayKey(day(2026, 10, 27, 23)), '2026-10-27');
  assert.equal(dayKey(day(2027, 1, 5)), '2027-01-05');
});

test('it keeps one date, written once a day, under its UI key', () => {
  const storage = memoryStorage();
  assert.deepEqual(readOpening(storage, { now: day(2026, 10, 27, 8), configured: true }), { greeting: 'first', trust: 'device' });
  assert.deepEqual([...storage.data.entries()], [[OPENED_KEY, '2026-10-27']], 'only a date, nothing else');
  assert.equal(OPENED_KEY, 'daily-planner-ui:opened');
  const writes = [];
  const counting = { ...storage, setItem: (key, value) => { writes.push(key); storage.setItem(key, value); } };
  assert.equal(readOpening(counting, { now: day(2026, 10, 27, 21) }).greeting, 'today');
  assert.deepEqual(writes, [], 'the same day: nothing written');
  assert.equal(readOpening(counting, { now: day(2026, 10, 28, 7) }).greeting, 'back');
  assert.deepEqual(writes, [OPENED_KEY]);
  assert.equal(storage.data.get(OPENED_KEY), '2026-10-28');
});

test('someone who used the planner before this release is welcomed back, not as new', () => {
  assert.equal(readOpening(memoryStorage({ [SETTINGS]: '{"onboardingComplete":true}' }), { now: day(2026, 10, 27) }).greeting, 'back');
});

test('the privacy line names Google Drive only when Drive sync is connected and this copy can sync', () => {
  const connected = JSON.stringify({ connected: true, fileId: 'f', lastSyncedAt: '2026-10-27T08:00:00.000Z', lastError: '' });
  const signInPending = JSON.stringify({ connected: true, fileId: '', lastSyncedAt: '', lastError: '' });
  assert.equal(readOpening(memoryStorage({ [DRIVE]: signInPending }), { configured: true }).trust, 'device', 'Connect noted, but Google sign-in not done (or cancelled): not yet');
  assert.equal(readOpening(memoryStorage({ [DRIVE]: connected }), { configured: true }).trust, 'drive');
  assert.equal(readOpening(memoryStorage({ [DRIVE]: connected }), { configured: false }).trust, 'device', 'no Google client in this copy: no sync');
  assert.equal(readOpening(memoryStorage({ [DRIVE]: JSON.stringify({ connected: false }) }), { configured: true }).trust, 'device');
  assert.equal(readOpening(memoryStorage({ [DRIVE]: '{broken' }), { configured: true }).trust, 'device');
  assert.equal(driveConnected(null), false);
  assert.equal(driveConnected('{"connected":"yes"}'), false);
  // In the page, “can sync” is the Google client id of runtime-config.js.
  const before = globalThis.__DAILY_PLANNER_CONFIG__;
  try {
    globalThis.__DAILY_PLANNER_CONFIG__ = { GOOGLE_CLIENT_ID: ' ' };
    assert.equal(readOpening(memoryStorage({ [DRIVE]: connected })).trust, 'device');
    globalThis.__DAILY_PLANNER_CONFIG__ = { GOOGLE_CLIENT_ID: 'client.apps.example' };
    assert.equal(readOpening(memoryStorage({ [DRIVE]: connected })).trust, 'drive');
  } finally {
    globalThis.__DAILY_PLANNER_CONFIG__ = before;
  }
});

test('the privacy line names Dropbox when Dropbox sync is connected and this copy has its app key (1.38)', () => {
  const DROPBOX = 'daily-planner-sync:dropbox';
  const connected = JSON.stringify({ connected: true, lastSyncedAt: '2026-11-10T08:00:00.000Z', lastError: '' });
  assert.equal(readOpening(memoryStorage({ [DROPBOX]: connected }), { configured: true, dropbox: true }).trust, 'dropbox');
  assert.equal(readOpening(memoryStorage({ [DROPBOX]: connected }), { configured: true, dropbox: false }).trust, 'device', 'no app key in this copy: no Dropbox sync');
  assert.equal(readOpening(memoryStorage({ [DROPBOX]: JSON.stringify({ connected: true, lastSyncedAt: '' }) }), { dropbox: true }).trust, 'device', 'back from Dropbox, never synced yet');
  // One cloud at a time: Dropbox, once connected, is the one named.
  assert.equal(readOpening(memoryStorage({ [DROPBOX]: connected, [DRIVE]: JSON.stringify({ connected: false, lastSyncedAt: '2026-10-01T08:00:00.000Z' }) }), { configured: true, dropbox: true }).trust, 'dropbox');
  const before = globalThis.__DAILY_PLANNER_CONFIG__;
  try {
    globalThis.__DAILY_PLANNER_CONFIG__ = { DROPBOX_APP_KEY: 'abcdefghij12345' };
    assert.equal(readOpening(memoryStorage({ [DROPBOX]: connected })).trust, 'dropbox');
    globalThis.__DAILY_PLANNER_CONFIG__ = { DROPBOX_APP_KEY: 'not a key' };
    assert.equal(readOpening(memoryStorage({ [DROPBOX]: connected })).trust, 'device');
  } finally {
    globalThis.__DAILY_PLANNER_CONFIG__ = before;
  }
});

test('blocked storage greets as the first time, says nothing about where plans stay, and never throws', () => {
  const blocked = { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('SecurityError'); } };
  assert.deepEqual(readOpening(blocked, { now: day(2026, 10, 27), configured: true }), { greeting: 'first', trust: 'none' });
  assert.deepEqual(readOpening(null, { now: day(2026, 10, 27) }), { greeting: 'first', trust: 'none' });
  const full = { getItem: () => null, setItem() { throw new Error('QuotaExceededError'); } };
  assert.equal(readOpening(full, { now: day(2026, 10, 27) }).trust, 'device', 'readable but full storage still keeps the plans');
});

test('the seal guards itself: unstyled (an older stylesheet) it goes at once; after the failsafe fade it goes; it leaves if an older app.js shows the planner', () => {
  const unstyled = sealPage();
  assert.equal(guardOpening({ doc: unstyled.doc, win: { getComputedStyle: () => ({ position: 'static' }) } }), 'unstyled');
  assert.equal(unstyled.seal.removed, true);

  const faded = sealPage();
  assert.equal(guardOpening({ doc: faded.doc, win: { getComputedStyle: () => ({ position: 'fixed' }) } }), 'guarded');
  faded.seal.dispatch('animationend', { animationName: 'opening-grow' });
  assert.equal(faded.seal.removed, false, 'another animation ending changes nothing');
  faded.seal.dispatch('animationend', { animationName: 'opening-failsafe' });
  assert.equal(faded.seal.removed, true);

  // An older app.js shows the planner (data-booting goes) without taking the seal away.
  const olderApp = ({ shown, dialog = false }) => {
    const page = sealPage({ shown });
    const attributes = new Set(['data-booting']);
    page.doc.documentElement = { hasAttribute: name => attributes.has(name) };
    const query = page.doc.querySelector;
    page.doc.querySelector = selector => (selector === '.modal:not([hidden])' ? (dialog ? {} : null) : query(selector));
    let watch = null;
    const timers = [];
    const win = {
      getComputedStyle: () => ({ position: 'fixed', opacity: '1' }),
      MutationObserver: class { constructor(callback) { watch = callback; } observe() {} disconnect() { watch = null; } },
      setTimeout: (callback, ms) => timers.push({ callback, ms })
    };
    guardOpening({ doc: page.doc, win });
    watch();
    assert.equal(timers.length, 0, 'still booting: nothing to do');
    attributes.delete('data-booting');
    watch();
    return { page, timers };
  };
  const early = olderApp({ shown: 600 });
  assert.deepEqual(early.timers.map(timer => timer.ms), [HOLD_MS - 600], 'it keeps its hold: the guard never cuts it short');
  withTimers(() => early.timers[0].callback());
  assert.equal(early.page.attributes.has('data-leaving'), true, 'then it leaves');
  assert.deepEqual(olderApp({ shown: HOLD_MS + 200 }).timers.map(timer => timer.ms), [GUARD_GRACE_MS], 'after its hold: soon after, so the planner’s own way out comes first');
  assert.deepEqual(olderApp({ shown: 600, dialog: true }).timers.map(timer => timer.ms), [GUARD_GRACE_MS], 'over a dialog: no hold');
});

test('the stylesheet’s failsafe never cuts the hold short: a planner still held for the seal shows as it goes', () => {
  const page = sealPage({ shown: 900, booting: true });
  guardOpening({ doc: page.doc, win: { getComputedStyle: () => ({ position: 'fixed' }) } });
  let shown = 0;
  withTimers(timers => {
    assert.equal(holdOpening(HOLD_MS - 900, () => { shown += 1; }, { doc: page.doc, win: globalThis }), HOLD_MS - 900);
    assert.deepEqual(timers.map(timer => timer.ms), [HOLD_MS - 900]);
    // A stylesheet from 1.35.1 fades it at 2.4 s: gone, and the planner is not kept behind nothing.
    page.seal.dispatch('animationend', { animationName: 'opening-failsafe' });
    assert.equal(page.seal.removed, true);
    assert.equal(shown, 1);
    timers[0].callback();
    assert.equal(shown, 1, 'once');
  });
});

test('blocked storage hides the privacy line in the seal', () => {
  const page = sealPage();
  const line = { hidden: false };
  const query = page.seal.querySelector;
  page.seal.querySelector = selector => (selector === '.opening__trust' ? line : query(selector));
  fillOpening({ doc: page.doc, storage: null, now: day(2026, 10, 27) });
  assert.equal(line.hidden, true);
  assert.equal(page.texts.trust, '');
});

test('the words are written into the seal once, and data-greeting lets them fade in', () => {
  const page = sealPage();
  const storage = memoryStorage({ [OPENED_KEY]: '2026-10-27' });
  assert.deepEqual(fillOpening({ doc: page.doc, storage, now: day(2026, 10, 27), configured: false }), { greeting: 'today', trust: 'device' });
  assert.deepEqual(page.texts, { greeting: 'Opening your day…', trust: 'Private · your plans stay on this device' });
  assert.equal(page.seal.dataset.greeting, 'today');
  assert.equal(fillOpening({ doc: page.doc, storage, now: day(2026, 10, 29) }), null, 'once per page');
  assert.equal(page.texts.greeting, 'Opening your day…');
  assert.equal(fillOpening({ doc: { querySelector: () => null }, storage }), null, 'no seal: nothing to do');
});

test('the seal holds about 3 s from its first paint, however soon the planner is ready; 1.2 s with reduced motion', () => {
  assert.equal(HOLD_MS, 3000);
  assert.equal(HOLD_REDUCED_MS, 1200);
  assert.equal(holdFor({ shownMs: 0 }), HOLD_MS);
  assert.equal(holdFor({ shownMs: 450 }), HOLD_MS - 450, 'a planner ready at 0.45 s waits for the seal');
  assert.equal(holdFor({ shownMs: HOLD_MS }), 0);
  assert.equal(holdFor({ shownMs: 5000 }), 0, 'a slow planner never waits more');
  assert.equal(holdFor({ shownMs: NaN }), 0, 'unknown: no wait');
  for (let shown = 0; shown <= 4000; shown += 25) assert.ok(holdFor({ shownMs: shown }) + shown >= HOLD_MS || holdFor({ shownMs: shown }) === 0);
  assert.equal(holdFor({ shownMs: 300, reducedMotion: true }), HOLD_REDUCED_MS - 300, 'reduced motion: a still seal, held a moment');
  assert.equal(holdFor({ shownMs: 1500, reducedMotion: true }), 0);
  assert.equal(holdFor({ shownMs: 0, dialog: true }), 0, 'a dialog arriving on launch comes on top at once');
  assert.equal(holdFor({ shownMs: 0, visible: false }), 0, 'a page opened in the background');
  assert.ok(LEAVE_REDUCED_MS < LEAVE_MS);
});

test('the full hold is for the first opening of a browser session; a reload or Back/Forward holds as 1.35.1 did', () => {
  // sessionStorage: a new tab, a new launch of the installed app or a new day is a new session.
  const session = memoryStorage();
  assert.equal(firstOpening(session, { now: day(2026, 10, 27, 8) }), true, 'a new tab');
  assert.deepEqual([...session.data.entries()], [[SESSION_KEY, '2026-10-27']], 'one date, under its UI key');
  assert.equal(SESSION_KEY, 'daily-planner-ui:sealed');
  assert.equal(firstOpening(session, { now: day(2026, 10, 27, 9) }), false, 'a reload, or Back/Forward');
  assert.equal(firstOpening(session, { now: day(2026, 10, 27, 23) }), false);
  assert.equal(firstOpening(session, { now: day(2026, 10, 28, 7) }), true, 'a new day');
  assert.equal(firstOpening(session, { now: day(2026, 10, 28, 8) }), false);
  // Storage that fails counts as first, every time, and never throws.
  const blocked = { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('SecurityError'); } };
  const full = { getItem: () => null, setItem() { throw new Error('QuotaExceededError'); } };
  for (const storage of [blocked, full, null]) for (let index = 0; index < 2; index += 1) assert.equal(firstOpening(storage), true);

  // The seal notes it once per page (data-session), with the greeting.
  const page = sealPage();
  const tab = memoryStorage();
  fillOpening({ doc: page.doc, storage: memoryStorage(), session: tab, now: day(2026, 10, 27), configured: false });
  assert.equal(page.seal.dataset.session, 'first');
  assert.equal(fillOpening({ doc: page.doc, storage: memoryStorage(), session: tab, now: day(2026, 10, 27) }), null, 'once per page');
  assert.equal(page.seal.dataset.session, 'first');
  const reloaded = sealPage();
  fillOpening({ doc: reloaded.doc, storage: memoryStorage(), session: tab, now: day(2026, 10, 27), configured: false });
  assert.equal(reloaded.seal.dataset.session, 'again');

  // After the first opening: seen for MIN_VISIBLE_MS, a ready planner kept back MAX_HOLD_MS at most (1.35.1).
  assert.deepEqual([MIN_VISIBLE_MS, MAX_HOLD_MS], [450, 140]);
  assert.equal(holdFor({ shownMs: 0, first: false }), MAX_HOLD_MS);
  assert.equal(holdFor({ shownMs: 400, first: false }), 50);
  assert.equal(holdFor({ shownMs: 450, first: false }), 0);
  assert.equal(holdFor({ shownMs: 2000, first: false }), 0);
  for (let shown = 0; shown <= 1000; shown += 10) assert.ok(holdFor({ shownMs: shown, first: false }) <= MAX_HOLD_MS);
  assert.equal(holdFor({ shownMs: 0, first: false, reducedMotion: true }), MAX_HOLD_MS, 'reduced motion: brief after the first opening too');
  assert.equal(holdFor({ shownMs: 0, first: false, dialog: true }), 0);
  assert.equal(holdFor({ shownMs: 0, first: false, visible: false }), 0);
  assert.equal(holdFor({ shownMs: 0 }), HOLD_MS, 'first unless told otherwise');
  // openingHold reads the seal's note: anything but 'again' is a first opening.
  const again = sealPage({ shown: 100 });
  again.seal.dataset.session = 'again';
  assert.equal(openingHold({ doc: again.doc, reducedMotion: false }), MAX_HOLD_MS);
  assert.equal(openingHold({ doc: again.doc, reducedMotion: true }), MAX_HOLD_MS);
  const first = sealPage({ shown: 100 });
  first.seal.dataset.session = 'first';
  assert.equal(openingHold({ doc: first.doc, reducedMotion: false }), HOLD_MS - 100);
  assert.equal(openingHold({ doc: first.doc, reducedMotion: true }), HOLD_REDUCED_MS - 100);
});

test('the hold is counted from the seal’s first frame (its failsafe animation), and ends once it is skipped', () => {
  assert.equal(openingHold({ doc: sealPage({ shown: 100 }).doc, reducedMotion: false }), HOLD_MS - 100);
  assert.equal(openingHold({ doc: sealPage({ shown: 900 }).doc, reducedMotion: true }), HOLD_REDUCED_MS - 900);
  assert.equal(openingHold({ doc: sealPage({ shown: 3100 }).doc, reducedMotion: false }), 0);
  assert.equal(openingHold({ doc: sealPage({ shown: 100, visible: false }).doc }), 0);
  assert.equal(openingHold({ doc: sealPage({ shown: 100 }).doc, dialog: true }), 0);
  assert.equal(openingHold({ doc: { querySelector: () => null } }), 0, 'no seal, no wait');
  // From when the animation started, not its clock, which stands still while the planner's first render keeps the page busy.
  const busy = sealPage();
  busy.seal.getAnimations = () => [{ animationName: 'opening-failsafe', startTime: performance.now() - 1000, currentTime: 400 }];
  const hold = openingHold({ doc: busy.doc, reducedMotion: false });
  assert.ok(hold <= HOLD_MS - 1000 && hold > HOLD_MS - 1100, `${hold}`);
  const skipped = sealPage({ shown: 100, booting: true });
  assert.equal(skipOpening({ doc: skipped.doc }), 'waiting', 'skipped before the planner is ready: it shows the moment it is');
  assert.equal(openingHold({ doc: skipped.doc, reducedMotion: false }), 0);
  assert.equal(skipped.seal.removed, false, 'nothing under it yet: the seal stays until then');
});

test('the planner waits for the seal, and shows at once on a skip, a hidden page, or when the seal goes', () => {
  withTimers(timers => {
    const calls = [];
    const page = sealPage({ shown: 500, booting: true });
    assert.equal(holdOpening(HOLD_MS - 500, () => calls.push('shown'), { doc: page.doc }), HOLD_MS - 500);
    assert.deepEqual(timers.map(timer => timer.ms), [HOLD_MS - 500]);
    assert.deepEqual(calls, [], 'held');
    assert.equal(skipOpening({ doc: page.doc }), 'shown', 'a click or a key: at once');
    assert.deepEqual(calls, ['shown']);
    timers[0].callback();
    assert.deepEqual(calls, ['shown'], 'never twice');
    assert.equal(page.doc.listeners.length, 0, 'it stops listening for the page being hidden');
    assert.equal(holdOpening(400, () => calls.push('again'), { doc: page.doc }), 0, 'skipped: no hold any more');
    assert.deepEqual(calls, ['shown', 'again']);

    const hidden = sealPage({ shown: 500, booting: true });
    holdOpening(2500, () => calls.push('hidden'), { doc: hidden.doc });
    hidden.doc.visibilityState = 'hidden';
    hidden.doc.listeners.filter(([type]) => type === 'visibilitychange').forEach(([, listener]) => listener());
    assert.equal(calls.at(-1), 'hidden', 'the page went to the background: no hold');

    assert.equal(holdOpening(500, () => calls.push('no seal'), { doc: { querySelector: () => null } }), 0);
    assert.equal(calls.at(-1), 'no seal');
  });
});

test('a skip uncovers a planner already shown (an older app.js), or shown by the stylesheet’s failsafe', () => {
  withTimers(() => {
    const shown = sealPage({ shown: 800, booting: false });
    assert.equal(skipOpening({ doc: shown.doc }), 'left');
    assert.equal(shown.attributes.has('data-leaving'), true);
    assert.equal(skipOpening({ doc: shown.doc }), 'none', 'already leaving');
    const failsafe = sealPage({ shown: PLANNER_FAILSAFE_MS + 100, booting: true });
    assert.equal(skipOpening({ doc: failsafe.doc }), 'left', 'app.js never came: the stylesheet shows the planner from 2.4 s');
    assert.equal(skipOpening({ doc: { querySelector: () => null } }), 'none');
  });
});

test('any click, tap or key skips the seal, and none of that input reaches the planner', () => {
  const page = sealPage({ shown: 700, booting: true });
  const win = inputWindow();
  let released = 0;
  withTimers(() => holdOpening(HOLD_MS - 700, () => { released += 1; page.root.delete('data-booting'); leaveOpening({ doc: page.doc, reducedMotion: false }); }, { doc: page.doc, win }));
  skipOnInput({ doc: page.doc, win });
  assert.deepEqual([...win.listeners.keys()].sort(), [...SKIP_EVENTS, ...LOST_EVENTS].sort(), 'clicks, taps and keys, with all they bring, and what ends a gesture the page can’t see end');
  // A script's own events pass (the smoke test clicks with element.click()).
  assert.deepEqual(win.fire('click', { isTrusted: false }), { prevented: false, stopped: false });
  assert.equal(released, 0);
  // “H” (How it works) while the seal is up: the seal goes, and the planner never sees the key.
  withTimers(() => assert.deepEqual(win.fire('keydown', { key: 'h' }), { prevented: true, stopped: true }));
  assert.equal(released, 1, 'the planner shows at once');
  assert.equal(page.attributes.has('data-leaving'), true, 'as the seal fades');
  assert.deepEqual(win.fire('keydown', { key: 'h', repeat: true }), { prevented: true, stopped: true }, 'held down: still the same key');
  assert.deepEqual(win.fire('keypress', { key: 'h' }), { prevented: true, stopped: true });
  assert.deepEqual(win.fire('keyup', { key: 'h' }), { prevented: true, stopped: true });
  // The next key is the planner's, even during the fade.
  assert.deepEqual(win.fire('keydown', { key: 'h' }), { prevented: false, stopped: false });
  assert.deepEqual(win.timers.filter(timer => !timer.cleared).map(timer => timer.ms), [LEAVE_MS], 'presses are still the skip’s while the seal fades');
  win.runTimers();
  assert.equal(win.listeners.size, 0, 'and the watch is over once it has faded');
});

test('a click or a tap that skips the seal never clicks what is under it', () => {
  for (const sequence of [
    ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click'],
    ['pointerdown', 'touchstart', 'pointerup', 'touchend', 'mousedown', 'mouseup', 'click'],
    ['pointerdown', 'pointerup', 'contextmenu']
  ]) {
    const page = sealPage({ shown: 1200, booting: true });
    const win = inputWindow();
    withTimers(() => holdOpening(HOLD_MS - 1200, () => { page.root.delete('data-booting'); leaveOpening({ doc: page.doc, reducedMotion: false }); }, { doc: page.doc, win }));
    skipOnInput({ doc: page.doc, win });
    withTimers(() => sequence.forEach(type => assert.deepEqual(win.fire(type), { prevented: true, stopped: true }, `${sequence.join(' ')}: ${type}`)));
    assert.equal(page.attributes.has('data-leaving'), true, 'the seal goes on the press');
    const tail = win.timers.filter(timer => !timer.cleared && timer.ms === SKIP_TAIL_MS);
    assert.equal(tail.length, 1, 'its click may come a moment after it is let go');
    win.runTimers();
    assert.equal(win.listeners.size, 0, 'then the planner has its clicks back');
  }
  // A double click or a double tap that skips the seal: its second press comes during the fade, and is the skip's too (1.35.2).
  for (const second of [
    ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click', 'dblclick'],
    ['pointerdown', 'touchstart', 'pointerup', 'touchend', 'mousedown', 'mouseup', 'click']
  ]) {
    const page = sealPage({ shown: 1200 });
    const win = inputWindow();
    skipOnInput({ doc: page.doc, win });
    withTimers(() => ['pointerdown', 'pointerup', 'click'].forEach(type => win.fire(type)));
    assert.equal(page.attributes.has('data-leaving'), true, 'fading');
    second.forEach(type => assert.deepEqual(win.fire(type), { prevented: true, stopped: true }, `${second[1]}: the second ${type}`));
    // Keys stay immediate.
    assert.deepEqual(win.fire('keydown', { key: 'n' }), { prevented: false, stopped: false }, 'a key during the fade is the planner’s');
    win.runTimers();
    assert.equal(win.listeners.size, 0, 'LEAVE_MS after the skip, and its gesture over: the planner has its clicks back');
    assert.deepEqual(win.fire('pointerdown'), { prevented: false, stopped: false });
  }
  // The fade window is LEAVE_MS long, from the start of the fade.
  const page = sealPage({ shown: 1200 });
  const win = inputWindow();
  skipOnInput({ doc: page.doc, win });
  withTimers(() => ['pointerdown', 'pointerup', 'click'].forEach(type => win.fire(type)));
  assert.deepEqual(win.timers.filter(timer => !timer.cleared).map(timer => timer.ms).sort((a, b) => a - b), [LEAVE_MS, SKIP_TAIL_MS]);
  win.timers.find(timer => timer.ms === LEAVE_MS).callback();
  assert.deepEqual(win.fire('pointerdown'), { prevented: false, stopped: false }, 'after the fade: the planner’s at once');
  assert.equal(win.listeners.size, 0);
  // A press during a fade that no skip started (the hold simply ended) is the planner's: usable from the first frame.
  const plain = sealPage({ shown: 1200 });
  const quiet = inputWindow();
  skipOnInput({ doc: plain.doc, win: quiet });
  withTimers(() => leaveOpening({ doc: plain.doc, reducedMotion: false }));
  assert.deepEqual(quiet.fire('pointerdown'), { prevented: false, stopped: false });
  assert.equal(quiet.listeners.size, 0);
});

test('a key or a press let go where the page can’t see it never traps the next input', () => {
  // Alt+Tab, Ctrl+L, Ctrl+F or Alt+Left during the seal: the key goes down here, its keyup elsewhere.
  for (const [label, lose] of [
    ['the window loses focus', win => win.fire('blur', { target: win })],
    ['the page is left (Back)', win => win.fire('pagehide')],
    ['the page is hidden', (win, page) => { page.doc.visibilityState = 'hidden'; win.fire('visibilitychange', { target: page.doc }); }]
  ]) {
    const page = sealPage({ shown: 900 });
    const win = inputWindow();
    skipOnInput({ doc: page.doc, win });
    withTimers(() => assert.deepEqual(win.fire('keydown', { key: 'Alt', altKey: true }), { prevented: false, stopped: true }, label));
    lose(win, page);
    win.runTimers();
    assert.equal(win.listeners.size, 0, `${label}: the gesture is over, and the seal is fading: nothing more to stop`);
    assert.deepEqual(win.fire('pointerdown'), { prevented: false, stopped: false }, `${label}: the next click is the planner’s`);
  }
  // An element losing focus is not the window.
  const page = sealPage({ shown: 900, booting: true });
  const win = inputWindow();
  skipOnInput({ doc: page.doc, win });
  withTimers(() => win.fire('keydown', { key: 'Alt', altKey: true }));
  win.fire('blur', { target: {} });
  assert.deepEqual(win.fire('keyup', { key: 'Alt' }), { prevented: true, stopped: true }, 'still the same key');
  // A hidden page that comes back is not lost either.
  page.doc.visibilityState = 'visible';
  win.fire('visibilitychange', { target: page.doc });
  assert.ok(win.listeners.size > 0, 'the seal is still up (the planner is loading): still watched');
});

test('once the seal is gone, nothing is stopped but the skipping gesture’s own release, for SKIP_TAIL_MS at most', () => {
  // The key's release never comes, and nothing tells the page (a lost keyup, as in a remote session).
  const page = sealPage({ shown: 900 });
  const win = inputWindow();
  skipOnInput({ doc: page.doc, win });
  withTimers(timers => {
    win.fire('keydown', { key: 'Alt', altKey: true });
    win.timers.find(timer => timer.ms === LEAVE_MS).callback();
    assert.ok(win.listeners.size > 0, 'the key is still down');
    page.seal.dispatch('animationend', { animationName: 'opening-leave' });
    assert.equal(page.seal.removed, true, 'the seal is gone');
    assert.equal(timers.length, 1, 'its fallback only');
  });
  assert.deepEqual(win.fire('keydown', { key: 'Alt', altKey: true, repeat: true }), { prevented: false, stopped: true }, 'the held key’s repeats are still its own');
  assert.deepEqual(win.fire('keyup', { key: 'Alt' }), { prevented: true, stopped: true }, 'its release, a moment later, too');
  win.runTimers();
  assert.equal(win.listeners.size, 0, 'then the watch is over, whatever was let go');
  // A new press while the gesture's grace runs is the planner's at once.
  const again = sealPage({ shown: 900 });
  const other = inputWindow();
  skipOnInput({ doc: again.doc, win: other });
  withTimers(() => {
    other.fire('pointerdown');
    again.seal.dispatch('animationend', { animationName: 'opening-leave' });
  });
  assert.deepEqual(other.timers.filter(timer => !timer.cleared).map(timer => timer.ms), [SKIP_TAIL_MS], 'the grace, and the fade’s window closed with the seal');
  assert.deepEqual(other.fire('pointerdown'), { prevented: false, stopped: false });
  assert.deepEqual(other.fire('click'), { prevented: false, stopped: false });
  assert.equal(other.listeners.size, 0);
});

test('browser shortcuts still work: a skipping key with Ctrl, Cmd or Alt, or a function key, is stopped from the page but never prevented', () => {
  assert.equal(browserKey({ key: 'r', metaKey: true }), true);
  assert.equal(browserKey({ key: 'Tab', ctrlKey: true }), true);
  assert.equal(browserKey({ key: 'F5' }), true);
  assert.equal(browserKey({ key: 'Tab' }), false, 'Tab never moves focus into the planner under the seal');
  assert.equal(browserKey({ key: 'f' }), false);
  const page = sealPage({ shown: 600 });
  const win = inputWindow();
  skipOnInput({ doc: page.doc, win });
  withTimers(() => assert.deepEqual(win.fire('keydown', { key: 'Meta', metaKey: true }), { prevented: false, stopped: true }));
  assert.deepEqual(win.fire('keydown', { key: 'r', metaKey: true }), { prevented: false, stopped: true }, 'Cmd+R reloads');
  assert.equal(skipOnInput({ doc: { querySelector: () => null }, win: inputWindow() }), null, 'no seal: nothing to watch');
});

test('once the seal has gone by itself, input is the planner’s', () => {
  const page = sealPage({ shown: 600 });
  const win = inputWindow();
  skipOnInput({ doc: page.doc, win });
  withTimers(() => leaveOpening({ doc: page.doc, reducedMotion: false }));
  assert.deepEqual(win.fire('keydown', { key: 'n' }), { prevented: false, stopped: false }, 'usable from the first frame of the fade');
  assert.equal(win.listeners.size, 0);
  const removed = sealPage({ shown: 600 });
  const quiet = inputWindow();
  skipOnInput({ doc: removed.doc, win: quiet });
  guardOpening({ doc: removed.doc, win: { getComputedStyle: () => ({ position: 'fixed' }) } });
  removed.seal.dispatch('animationend', { animationName: 'opening-failsafe' });
  assert.equal(quiet.listeners.size, 0, 'the watch ends with the seal');
});

test('the seal leaves with a short fade, then goes from the page; at once when hidden or already fading', () => {
  withTimers(timers => {
    const page = sealPage();
    assert.equal(leaveOpening({ doc: page.doc, reducedMotion: false }), LEAVE_MS);
    assert.equal(page.attributes.has('data-leaving'), true);
    assert.equal(page.seal.removed, false, 'still fading');
    page.seal.dispatch('animationend', { animationName: 'opening-text' });
    assert.equal(page.seal.removed, false, 'another animation ending changes nothing');
    page.seal.dispatch('animationend', { animationName: 'opening-leave' });
    assert.equal(page.seal.removed, true, 'out of the page once its fade has ended, however late it started');
    assert.equal(leaveOpening({ doc: page.doc }), 0, 'gone: nothing more to do');
    // Should the fade never run, a fallback removes it.
    assert.equal(timers.length, 1);
    assert.equal(timers[0].ms, LEAVE_MS + LEAVE_FALLBACK_MS);
    assert.doesNotThrow(() => timers[0].callback());
    const stuck = sealPage();
    leaveOpening({ doc: stuck.doc, reducedMotion: false });
    timers[1].callback();
    assert.equal(stuck.seal.removed, true);

    const still = sealPage();
    assert.equal(leaveOpening({ doc: still.doc, reducedMotion: true }), LEAVE_REDUCED_MS, 'reduced motion: a quick fade only');

    const hidden = sealPage({ visible: false });
    assert.equal(leaveOpening({ doc: hidden.doc }), 0);
    assert.equal(hidden.seal.removed, true);

    const faded = sealPage();
    const computed = globalThis.getComputedStyle;
    globalThis.getComputedStyle = () => ({ opacity: '0.4' });
    try {
      assert.equal(leaveOpening({ doc: faded.doc }), 0, 'the stylesheet’s failsafe got there first: no second fade');
      assert.equal(faded.seal.removed, true);
    } finally {
      if (computed) globalThis.getComputedStyle = computed;
      else delete globalThis.getComputedStyle;
    }
  });
});

test('showPlanner: the planner shows at once with no seal or a dialog on launch, after the hold otherwise', () => {
  const storage = memoryStorage({ 'daily-planner-ui:entrance-seen': '1' });
  const planner = page => {
    const attributes = new Map([['data-booting', '']]);
    page.doc.documentElement = { dataset: {}, removeAttribute: name => attributes.delete(name), hasAttribute: name => attributes.has(name) };
    page.doc.querySelectorAll = () => [];
    return page;
  };
  withTimers(timers => {
    const quick = planner(sealPage({ shown: 120 }));
    assert.equal(showPlanner({ doc: quick.doc, storage, search: '' }), 'held');
    assert.equal(quick.doc.documentElement.hasAttribute('data-booting'), true, 'held: still out of sight, still inert');
    assert.deepEqual(timers.map(timer => timer.ms), [HOLD_MS - 120], 'about 3 s from the seal’s first paint');
    timers.shift().callback();
    assert.equal(quick.doc.documentElement.hasAttribute('data-booting'), false, 'shown…');
    assert.equal(quick.attributes.has('data-leaving'), true, '…as the seal leaves, on the same frame');
    timers.length = 0;

    const skipped = planner(sealPage({ shown: 600 }));
    assert.equal(showPlanner({ doc: skipped.doc, storage, search: '' }), 'held');
    assert.equal(skipOpening({ doc: skipped.doc }), 'shown', 'a click, a tap or a key');
    assert.equal(skipped.doc.documentElement.hasAttribute('data-booting'), false, 'shown at once');
    assert.equal(skipped.attributes.has('data-leaving'), true);
    timers.length = 0;

    for (const [label, options] of [['first-run setup', { dialog: true, search: '' }], ['?help', { search: '?help' }]]) {
      const page = planner(sealPage({ shown: 50 }));
      assert.equal(showPlanner({ doc: page.doc, storage, ...options }), 'none', label);
      assert.equal(page.doc.documentElement.hasAttribute('data-booting'), false, `${label}: shown at once`);
      assert.equal(page.attributes.has('data-leaving'), true, `${label}: the seal leaves under the dialog`);
    }
    // 1.39: an old licence or gift link opens no dialog any more, so the planner opens as usual.
    for (const search of ['?license=abc', '?gift=ABCD', '?checkout_id=ch_1']) {
      const page = planner(sealPage({ shown: 50 }));
      assert.equal(showPlanner({ doc: page.doc, storage, search }), 'held', search);
      timers.length = 0;
    }

    const late = planner(sealPage({ shown: HOLD_MS + 400 }));
    assert.equal(showPlanner({ doc: late.doc, storage, search: '' }), 'none', 'seen long enough: no wait');
    assert.equal(late.attributes.has('data-leaving'), true);
    timers.length = 0;

    // A reload in the same session: a moment only.
    const reload = planner(sealPage({ shown: 120 }));
    reload.seal.dataset.session = 'again';
    assert.equal(showPlanner({ doc: reload.doc, storage, search: '' }), 'held');
    assert.deepEqual(timers.map(timer => timer.ms), [MAX_HOLD_MS]);
    timers.shift().callback();
    assert.equal(reload.doc.documentElement.hasAttribute('data-booting'), false);
    const seen = planner(sealPage({ shown: 600 }));
    seen.seal.dataset.session = 'again';
    assert.equal(showPlanner({ doc: seen.doc, storage, search: '' }), 'none', 'seen long enough on a reload: no wait');
    timers.length = 0;
  });
});

// ---------------------------------------------------------------------------
// The page: in the HTML from the first paint, CSS only, and in step with the planner's boot.
// ---------------------------------------------------------------------------

const html = read('index.html');
const head = html.slice(0, html.indexOf('</head>'));
const body = html.slice(html.indexOf('<body>'));
const seal = /<div class="opening" data-opening>[\s\S]*?\n {2}<\/div>\n/.exec(body)?.[0] || '';
const css = read('styles/opening.css');

test('the seal is in the HTML, before the planner, so it shows on the first paint', () => {
  assert.ok(seal, 'index.html carries the seal');
  assert.ok(body.indexOf(seal) < body.indexOf('<main class="planner" data-app>'), 'before the planner');
  assert.doesNotMatch(seal, /<script|\son[a-z]+=/i, 'no script of its own: the CSP is unchanged');
  assert.match(read('styles.css'), /@import url\('\.\/styles\/opening\.css'\);\n@import url\('\.\/styles\/entrance\.css'\);/);
  // Its words come from a module the head loads early (no imports, so nothing else waits for it); app.js imports the same one.
  assert.match(head, /<script type="module" src="\.\/src\/features\/opening-seal\.js"><\/script>/);
  assert.doesNotMatch(read('src/features/opening-seal.js'), /^import /m);
  assert.match(read('src/features/app-entrance.js'), /from '\.\/opening-seal\.js'/);
  assert.match(read('sw.js'), /'\.\/src\/features\/opening-seal\.js'/, 'kept for offline use');
  assert.match(read('scripts/smoke.mjs'), /\.replace\('<script type="module" src="\.\/src\/features\/opening-seal\.js"><\/script>', ''\)/, 'the smoke test bundles it with app.js instead');
});

test('screen readers: the seal is hidden, a polite status says the planner is loading', () => {
  for (const part of ['opening__seal', 'opening__greeting', 'opening__trust']) assert.match(seal, new RegExp(`class="${part}" aria-hidden="true"`), part);
  assert.match(seal, /<p class="sr-only" role="status">Loading your planner…<\/p>/);
  assert.doesNotMatch(seal, /tabindex|<button|<a /, 'nothing to focus');
});

test('the mark is the logo, stroke for stroke: the horizon, the sun, its rays, then the line below', () => {
  const favicon = read('favicon.svg');
  const logo = / d="([^"]+)"/.exec(favicon.slice(favicon.indexOf('<path')))[1];
  // Each stroke as its two ends (an arc by its ends and radius): drawn either way, it is the same line.
  const ends = d => {
    const [, x, y, rest] = /^M([\d.]+) ([\d.]+)(.*)$/.exec(d.trim());
    const start = [Number(x), Number(y)];
    let m;
    if ((m = /^h(-?[\d.]+)$/.exec(rest))) return [start, [start[0] + Number(m[1]), start[1]]];
    if ((m = /^v(-?[\d.]+)$/.exec(rest))) return [start, [start[0], start[1] + Number(m[1])]];
    if ((m = /^l(-?[\d.]+)\s*(-?[\d.]+)$/.exec(rest))) return [start, [start[0] + Number(m[1]), start[1] + Number(m[2])]];
    if ((m = /^a[\d.]+ [\d.]+ 0 0 1 (-?[\d.]+) (-?[\d.]+)$/.exec(rest))) return [start, [start[0] + Number(m[1]), start[1] + Number(m[2])]];
    throw new Error(`unexpected path ${d}`);
  };
  const key = d => ends(d).map(point => point.map(value => value.toFixed(1)).join(',')).sort().join(' ');
  const logoStrokes = logo.split(/(?=M)/).map(key);
  const sealStrokes = [...seal.matchAll(/<path pathLength="1" d="([^"]+)"\/>/g)].map(match => match[1]);
  assert.equal(sealStrokes.length, 6);
  assert.deepEqual(sealStrokes.map(key).sort(), [...logoStrokes].sort(), 'the same six strokes as favicon.svg');
  assert.deepEqual(sealStrokes.map(key), [0, 1, 3, 2, 4, 5].map(index => logoStrokes[index]), 'horizon, sun, the rays left to right, the line below');
  // The sun's arc is drawn from the left, as the logo's; the rays outward, from the sun.
  assert.equal(sealStrokes[1], 'M20 38a12 12 0 0 1 24 0');
  assert.deepEqual(ends(sealStrokes[3])[0], [32, 22]);
});

test('the stylesheet: a failsafe after the hold, the module’s fade lengths, still with reduced motion, never printed', () => {
  const failsafe = /\.opening \{[^}]*animation: opening-failsafe (\d+)ms ease (\d+)ms forwards;/.exec(css);
  assert.ok(failsafe, 'the seal fades by itself');
  assert.equal(Number(failsafe[2]), SEAL_FAILSAFE_MS);
  // It never cuts the 3 s hold or its fade short, and a planner whose app.js never loads is uncovered at about 3.5–4 s.
  assert.ok(SEAL_FAILSAFE_MS >= HOLD_MS + LEAVE_MS + 200, `${SEAL_FAILSAFE_MS} ms`);
  assert.ok(SEAL_FAILSAFE_MS + Number(failsafe[1]) <= 4000, 'gone by 4 s');
  // The planner itself shows under it at 2.4 s (styles/entrance.css, index.html's inert), as before.
  assert.equal(PLANNER_FAILSAFE_MS, FAILSAFE_MS);
  assert.ok(PLANNER_FAILSAFE_MS < SEAL_FAILSAFE_MS);
  assert.match(css, /@keyframes opening-failsafe \{ from \{ pointer-events: none; \} to \{ opacity: 0; visibility: hidden; pointer-events: none; \} \}/);
  assert.match(css, new RegExp(`\\.opening\\[data-leaving\\] \\{[^}]*animation: opening-leave ${LEAVE_MS}ms`));
  const reduced = css.slice(css.indexOf('@media screen and (prefers-reduced-motion: reduce)'));
  assert.match(reduced, new RegExp(`\\.opening\\[data-leaving\\] \\{ animation: opening-leave ${LEAVE_REDUCED_MS}ms ease forwards; \\}`));
  const still = reduced.slice(reduced.indexOf('{') + 1, reduced.indexOf('{', reduced.indexOf('{') + 1));
  for (const part of ['.opening__seal', '.opening__glow', '.opening__orbit', '.opening__turn', '.opening__ring', '.opening__arc', '.opening__disc', '.opening__mark path']) assert.ok(still.includes(`${part},`), `${part} is still`);
  assert.match(css, /\.opening__turn \{[^}]*animation: opening-turn 1300ms [^;]* infinite both;/, 'the warm arc turns about every 1.3 s');
  assert.match(css, /@media print \{\n {2}\.opening \{ display: none; \}\n\}/);
  assert.match(css, /--seal-accent: var\(--hz-milestone\);/, 'the planner’s own amber');
  // Dark has its own seal, whether the system or the planner's setting asks for it.
  assert.match(css, /prefers-color-scheme: dark\) \{\n {2}:root:not\(\[data-theme="light"\]\) \.opening \{/);
  assert.match(css, /:root\[data-theme="dark"\] \.opening \{/);
  assert.doesNotMatch(css, /!important/);
});

test('app.js shows the planner through showPlanner, which lets the seal leave on the frame the planner shows', () => {
  const app = read('app.js');
  assert.match(app, /showPlanner\(\{ dialog: !settings\.onboardingComplete, shown: \(\) => \{\n {4}setTimeout\(\(\) => tour\.maybeOffer\(\), 1600\);\n {4}setTimeout\(\(\) => feedbackFeature\.maybePrompt\(/, 'the tour’s offer and what’s new count from when the planner shows, the seal gone');
  assert.equal((app.match(/setTimeout\(\(\) => tour\.maybeOffer\(\)/g) || []).length, 1, 'never timed from boot');
  assert.equal((app.match(/setTimeout\(\(\) => feedbackFeature\.maybePrompt\(/g) || []).length, 1);
  // A named import app-entrance.js from 1.35.1 also has: a cached older copy never stops app.js from loading.
  assert.match(app, /^import \{ showPlanner \} from '\.\/src\/features\/app-entrance\.js';$/m);
  assert.doesNotMatch(app, /startAppEntrance\(/);
  const entrance = read('src/features/app-entrance.js');
  assert.match(entrance, /root\.removeAttribute\('data-booting'\);\n\s+try \{ doc\.querySelector\('\[data-app\]'\)\?\.removeAttribute\('inert'\); \} catch \(_\) \{\}\n\s+try \{ seal\.leaveOpening\(\{ doc \}\); \} catch \(_\) \{\}/);
  // A namespace import: an opening-seal.js from 1.35.1 left in a cache (no holdOpening) never stops the planner from loading.
  assert.match(entrance, /^import \* as seal from '\.\/opening-seal\.js';$/m);
  assert.match(entrance, /if \(typeof seal\.holdOpening === 'function'\) seal\.holdOpening\(hold, start, \{ doc \}\);\n\s+else setTimeout\(start, hold\);/);
  // The module loaded early by the head watches for a skip once it has a seal to guard.
  assert.match(read('src/features/opening-seal.js'), /if \(typeof document !== 'undefined'\) \{\n {2}fillOpening\(\);\n {2}if \(guardOpening\(\) === 'guarded'\) skipOnInput\(\);\n\}/);
});

test('what comes a little after opening (the tour’s offer, what’s new) waits until the planner shows and the seal is gone', () => {
  // A page whose planner and seal change as they would; MutationObserver called on each change.
  const make = ({ booting = true, seal = true } = {}) => {
    const root = new Set(booting ? ['data-booting'] : []);
    let present = seal;
    const watchers = [];
    const observed = [];
    const body = { name: 'body' };
    const doc = {
      documentElement: { hasAttribute: name => root.has(name) },
      querySelector: selector => (selector === '[data-opening]' && present ? { parentNode: body } : null)
    };
    const win = { MutationObserver: class { constructor(callback) { this.callback = callback; watchers.push(this); } observe(target, options) { observed.push([target === doc.documentElement ? 'root' : target.name, options]); } disconnect() { this.off = true; } } };
    const change = () => watchers.filter(watcher => !watcher.off).forEach(watcher => watcher.callback());
    return { doc, win, observed, watchers, show: () => { root.delete('data-booting'); change(); }, sealGone: () => { present = false; change(); } };
  };
  const calls = [];
  const page = make();
  assert.equal(whenPlannerShown(() => calls.push('offer'), { doc: page.doc, win: page.win }), 'waiting');
  assert.deepEqual(page.observed, [['root', { attributes: true, attributeFilter: ['data-booting'] }], ['body', { childList: true }]], 'the planner’s data-booting and the seal’s parent, nothing deeper');
  page.show();
  assert.deepEqual(calls, [], 'shown, but the seal is still fading over it');
  page.sealGone();
  assert.deepEqual(calls, ['offer']);
  page.sealGone();
  assert.deepEqual(calls, ['offer'], 'once');
  assert.equal(page.watchers[0].off, true, 'and it stops watching');
  // The seal goes first (its failsafe) while the planner still loads: not yet.
  const slow = make();
  whenPlannerShown(() => calls.push('slow'), { doc: slow.doc, win: slow.win });
  slow.sealGone();
  assert.equal(calls.at(-1), 'offer');
  slow.show();
  assert.equal(calls.at(-1), 'slow');
  // Shown already, no seal: at once. No way to watch: at once.
  assert.equal(whenPlannerShown(() => calls.push('now'), make({ booting: false, seal: false })), 'now');
  assert.equal(calls.at(-1), 'now');
  assert.equal(whenPlannerShown(() => calls.push('no observer'), { doc: make().doc, win: {} }), 'now');
  assert.equal(calls.at(-1), 'no observer');
  // Through showPlanner, before the planner is started, so the change that shows it is seen.
  const storage = memoryStorage({ 'daily-planner-ui:entrance-seen': '1' });
  const held = sealPage({ shown: 120 });
  const attributes = new Map([['data-booting', '']]);
  held.doc.documentElement = { dataset: {}, removeAttribute: name => attributes.delete(name), hasAttribute: name => attributes.has(name) };
  held.doc.querySelectorAll = () => [];
  let offered = 0;
  const watchers = [];
  const before = globalThis.MutationObserver;
  globalThis.MutationObserver = class { constructor(callback) { this.callback = callback; watchers.push(this); } observe() {} disconnect() { this.off = true; } };
  try {
    withTimers(timers => {
      assert.equal(showPlanner({ doc: held.doc, storage, search: '', shown: () => { offered += 1; } }), 'held');
      assert.equal(offered, 0, 'not during the hold');
      timers.shift().callback();
      watchers.forEach(watcher => watcher.callback());
      assert.deepEqual([attributes.has('data-booting'), held.attributes.has('data-leaving'), offered], [false, true, 0], 'shown, the seal fading over it');
      held.seal.dispatch('animationend', { animationName: 'opening-leave' });
      watchers.forEach(watcher => watcher.callback());
      assert.equal(offered, 1, 'the seal gone: now');
    });
  } finally {
    if (before) globalThis.MutationObserver = before;
    else delete globalThis.MutationObserver;
  }
});

test('the floating window builds its own page: no seal there', () => {
  assert.doesNotMatch(read('src/features/pip-window.js'), /opening/);
  assert.doesNotMatch(read('src/features/pip-styles.js'), /opening/);
});
