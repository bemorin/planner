import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { GOOGLE_TRADE_OFF, panelMarkup, passphraseProblem, returnNote, savedLabel, sealLineMarkup, sinceLabel, strengthMarkup, syncLead, syncView, waitingLine } from '../src/features/personal-sync-view.js';
import { passphraseStrength } from '../src/sync/seal.js';
import { createSyncLedger } from '../src/sync/ledger.js';
import { DROPBOX_APP_KEY_RE } from '../src/sync/dropbox.js';
import { CONFIG_VARIABLES } from '../server/config-inventory.js';
import { describeShape } from '../server/admin-config.js';

class MemoryStorage {
  #data = new Map();
  get length() { return this.#data.size; }
  key(index) { return [...this.#data.keys()][index] ?? null; }
  getItem(key) { return this.#data.has(String(key)) ? this.#data.get(String(key)) : null; }
  setItem(key, value) { this.#data.set(String(key), String(value)); }
  removeItem(key) { this.#data.delete(String(key)); }
}

const now = new Date('2026-11-10T09:00:00.000Z');
const read = path => readFile(new URL(`../${path}`, import.meta.url), 'utf8');

test('the card’s states, each with what it says and the one action it offers', () => {
  const off = syncView({ cloud: 'dropbox', now });
  assert.deepEqual([off.state, off.status, off.detail, off.primary, off.primaryStyle, off.panel, off.tone, off.dot], ['disconnected', 'Not connected', 'Your planner stays on this device until you connect it.', 'Connect Dropbox', 'primary', '', 'neutral', '']);
  assert.equal(off.tradeOff, '', 'Dropbox has no trade-off to say');
  const google = syncView({ cloud: 'google', now });
  assert.deepEqual([google.primary, google.tradeOff], ['Connect Google Drive', GOOGLE_TRADE_OFF], 'Google alone: its card says the hour, in one line');
  assert.equal(syncView({ cloud: 'dropbox', connecting: true, now }).status, 'Connecting…');
  const create = syncView({ cloud: 'dropbox', connected: true, need: { reason: 'create' }, now });
  assert.deepEqual([create.state, create.status, create.primary, create.panel, create.dot], ['passphrase', 'Choose a passphrase', '', 'create', 'wait']);
  assert.match(create.detail, /^Connected to Dropbox\. One step left: a passphrase seals your copy before anything is sent\.$/);
  const enter = syncView({ cloud: 'google', connected: true, need: { reason: 'enter' }, now });
  assert.deepEqual([enter.status, enter.panel], ['Your synced copy is sealed', 'enter']);
  assert.equal(syncView({ connected: true, need: { reason: 'changed' }, now }).status, 'The passphrase was changed');
  const forgot = syncView({ connected: true, need: { reason: 'enter' }, mode: 'forgot', now });
  assert.deepEqual([forgot.status, forgot.panel], ['Start over from this device', 'forgot']);
  const change = syncView({ connected: true, sealed: true, copy: 'sealed', mode: 'change', now });
  assert.deepEqual([change.panel, change.primary], ['change', ''], 'the form’s submit is the one main button');
  assert.equal(syncView({ connected: true, sealed: true, info: 'Passphrase changed.', lastSyncedAt: '2026-11-10T08:00:00.000Z', now }).detail, 'Passphrase changed.');
  const full = syncView({ cloud: 'dropbox', connected: true, error: 'Your Dropbox is full.', lastSyncedAt: '2026-11-10T08:00:00.000Z', now });
  assert.deepEqual([full.status, full.detail, full.dot], ['Not saved to Dropbox', 'Your Dropbox is full.', 'wait']);
  const conflict = syncView({ cloud: 'google', connected: true, conflicts: 2, accessUntil: now.getTime() + 1_800_000, now });
  assert.deepEqual([conflict.state, conflict.status, conflict.tone, conflict.dot], ['attention', 'Sync needs attention', 'wait', 'wait'], 'conflicts keep their logic, in the waiting card');
});

test('connected states: saved to Google Drive while its access lasts, with the hour that remains', () => {
  const at = new Date(2026, 10, 10, 15, 0, 0);
  const live = syncView({ cloud: 'google', connected: true, sealed: true, copy: 'sealed', lastSyncedAt: new Date(2026, 10, 10, 14, 58, 0).toISOString(), accessUntil: new Date(2026, 10, 10, 15, 35, 0).getTime(), available: ['google', 'dropbox'], now: at });
  assert.deepEqual([live.state, live.status, live.detail, live.primary, live.primaryStyle, live.tone, live.dot], ['synced', 'Saved to Google Drive', 'Last saved 2 min ago · nothing waiting', 'Sync now', 'secondary', 'neutral', 'ok']);
  assert.deepEqual(live.access, { until: '15:35', share: 0.583 }, 'until when, and the share of the hour left');
  assert.equal(live.switchTo, '', 'nothing waits: no switch offered');
  const waiting = syncView({ cloud: 'google', connected: true, dirty: true, dirtyCount: 2, lastSyncedAt: at.toISOString(), accessUntil: at.getTime() + 600_000, now: at });
  assert.deepEqual([waiting.state, waiting.status, waiting.detail, waiting.dot], ['pending', 'Saved to Google Drive', 'Changes waiting to sync', 'wait']);
  const dropbox = syncView({ cloud: 'dropbox', connected: true, sealed: true, copy: 'sealed', lastSyncedAt: new Date(at.getTime() - 4000).toISOString(), now: at });
  assert.deepEqual([dropbox.status, dropbox.detail, dropbox.folder, dropbox.access, dropbox.dot], ['Saved to Dropbox', 'Last saved just now · stays connected on this device', 'In your Dropbox’s Apps folder', null, 'ok']);
  assert.doesNotMatch(dropbox.folder, /Apps ›/, 'the App Console’s folder name is never spelled out');
});

test('Google’s access ended: ochre with changes waiting (since when, how many), neutral with nothing waiting', () => {
  const at = new Date(2026, 10, 10, 16, 20, 0);
  const lastSyncedAt = new Date(2026, 10, 10, 14, 58, 0).toISOString();
  const wait = syncView({ cloud: 'google', connected: true, reconnect: true, dirty: true, dirtyCount: 3, lastSyncedAt, available: ['google', 'dropbox'], now: at });
  assert.deepEqual([wait.state, wait.tone, wait.dot, wait.layout], ['reconnect', 'wait', 'wait', 'stacked']);
  assert.equal(wait.status, 'Not saved to Google Drive since 14:58');
  assert.equal(wait.detail, '3 changes made since then are safe on this device. Google ended access after an hour; one tap sends them.');
  assert.deepEqual([wait.primary, wait.primaryStyle, wait.primaryIcon, wait.switchTo, wait.access], ['Reconnect and save', 'primary', 'reconnect', 'dropbox', null]);
  const one = syncView({ cloud: 'google', connected: true, reconnect: true, dirty: true, dirtyCount: 1, lastSyncedAt, now: at });
  assert.match(one.detail, /^1 change made since then is safe on this device\./, 'singular');
  assert.equal(one.switchTo, '', 'Dropbox not offered here: no switch');
  const unknown = syncView({ cloud: 'google', connected: true, reconnect: true, dirty: true, dirtyCount: null, lastSyncedAt, now: at });
  assert.match(unknown.detail, /^Changes made since then are safe on this device\./, 'no count: no number');
  const never = syncView({ cloud: 'google', connected: true, reconnect: true, dirty: true, dirtyCount: 4, now: at });
  assert.deepEqual([never.status, never.detail.split('.')[0]], ['Not saved to Google Drive yet', '4 changes are safe on this device']);
  const yesterday = syncView({ cloud: 'google', connected: true, reconnect: true, dirty: true, dirtyCount: 2, lastSyncedAt: new Date(2026, 10, 9, 21, 5, 0).toISOString(), now: at });
  assert.equal(yesterday.status, 'Not saved to Google Drive since yesterday, 21:05');
  const older = syncView({ cloud: 'google', connected: true, reconnect: true, dirty: true, dirtyCount: 2, lastSyncedAt: new Date(2026, 10, 3, 9, 0, 0).toISOString(), now: at });
  assert.equal(older.status, `Not saved to Google Drive since ${new Date(2026, 10, 3).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`);
  const ended = syncView({ cloud: 'google', connected: true, reconnect: true, dirty: false, lastSyncedAt, available: ['google', 'dropbox'], now: at });
  assert.deepEqual([ended.state, ended.tone, ended.dot, ended.status, ended.primary, ended.primaryStyle, ended.switchTo], ['ended', 'neutral', 'ok', 'Up to date as of 14:58', 'Reconnect', 'secondary', '']);
  assert.equal(ended.detail, 'Google access ended. Reconnect to check for changes from your other devices.');
  const blocked = syncView({ cloud: 'google', connected: true, reconnect: true, dirty: true, dirtyCount: 2, lastSyncedAt, error: 'Your browser blocked Google’s window.', now: at });
  assert.equal(blocked.detail, '2 changes made since then are safe on this device. Your browser blocked Google’s window.', 'a tap that didn’t finish says why; the count stays first');
  const dropbox = syncView({ cloud: 'dropbox', connected: true, reconnect: true, dirty: true, dirtyCount: 2, lastSyncedAt, available: ['google', 'dropbox'], now: at });
  assert.deepEqual([dropbox.status, dropbox.switchTo], ['Not saved to Dropbox since 14:58', ''], 'Dropbox asking again: its own words, no switch');
});

test('when and how many, in the planner’s time format', () => {
  const at = new Date(2026, 10, 10, 9, 0, 0);
  assert.equal(sinceLabel(new Date(2026, 10, 10, 8, 5).toISOString(), at), '08:05');
  assert.equal(sinceLabel(new Date(2026, 10, 9, 23, 59).toISOString(), at), 'yesterday, 23:59');
  assert.equal(sinceLabel(new Date(2025, 11, 30, 10, 0).toISOString(), at), new Date(2025, 11, 30).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }), 'another year: with it');
  assert.equal(sinceLabel('', at), '');
  assert.equal(sinceLabel(new Date(2026, 10, 10, 8, 5).toISOString(), at, { clock: date => `${date.getHours() % 12 || 12}:${String(date.getMinutes()).padStart(2, '0')} AM` }), '8:05 AM', 'any clock the planner gives');
  assert.equal(savedLabel(new Date(at.getTime() - 30_000).toISOString(), at), 'Last saved just now');
  assert.equal(savedLabel(new Date(at.getTime() - 120_000).toISOString(), at), 'Last saved 2 min ago');
  assert.equal(savedLabel(new Date(2026, 10, 10, 7, 15).toISOString(), at), 'Last saved at 07:15');
  assert.equal(savedLabel(new Date(2026, 10, 9, 18, 0).toISOString(), at), 'Last saved yesterday, 18:00');
  assert.equal(savedLabel('', at), 'Not saved yet');
  assert.equal(waitingLine(1), '1 change made since then is safe on this device.');
  assert.equal(waitingLine(5, { since: false }), '5 changes are safe on this device.');
  assert.equal(waitingLine(0), 'Changes made since then are safe on this device.');
});

test('a plain copy from before 1.38: offered once, then a quiet line', () => {
  assert.equal(syncView({ connected: true, copy: 'plain', now }).panel, 'offer');
  assert.equal(syncView({ connected: true, copy: 'plain', offerDismissed: true, now }).panel, '', 'set aside: not again');
  assert.equal(syncView({ connected: true, copy: 'plain', offerDismissed: true, mode: 'protect', now }).panel, 'protect');
  assert.equal(syncView({ connected: true, copy: 'plain', sealed: true, now }).panel, '', 'a key here: the next write seals it');
  assert.match(sealLineMarkup({ cloud: 'google', copy: 'plain' }), /Not sealed\..*data-personal-sync-protect/);
  assert.equal(sealLineMarkup({ cloud: 'google', copy: 'plain', offerShown: true }), '', 'the offer says it already');
  assert.match(sealLineMarkup({ cloud: 'dropbox', copy: 'sealed', sealed: true }), /Sealed with your passphrase\..*Dropbox sees one file it can’t read\..*Change passphrase/);
  assert.match(sealLineMarkup({ cloud: 'dropbox', copy: 'sealed', sealed: true, memoryOnly: true }), /asked again next time/);
  assert.equal(sealLineMarkup({ copy: 'none' }), '');
});

test('the passphrase panels: labelled fields, the strength line, and the words about recovery', () => {
  const create = panelMarkup('create', { cloud: 'dropbox' });
  assert.match(create, /data-personal-sync-form="create"/);
  assert.equal((create.match(/type="password"/g) || []).length, 2, 'the passphrase and its confirmation');
  assert.match(create, /autocomplete="new-password"/);
  assert.match(create, /<span>Passphrase<\/span>/);
  assert.match(create, /<span>Type it again<\/span>/);
  assert.match(create, /aria-describedby="personal-sync-strength"/);
  assert.match(create, /neither we nor Dropbox can recover it\. Your planner here and your backups don’t depend on it\./);
  assert.match(create, />Seal and sync</);
  const enter = panelMarkup('enter', { cloud: 'google', reason: 'enter' });
  assert.equal((enter.match(/type="password"/g) || []).length, 1);
  assert.match(enter, /autocomplete="current-password"/);
  assert.match(enter, /role="alert"/);
  assert.match(enter, /Forgot it\?/);
  assert.match(panelMarkup('forgot', { cloud: 'google' }), /primary-button--danger[^>]*>Replace the synced copy</);
  assert.match(panelMarkup('change'), />Change passphrase</);
  assert.match(panelMarkup('offer', { cloud: 'google' }), /Seal your synced copy[\s\S]*Not now[\s\S]*Choose a passphrase/);
  for (const html of [create, enter, panelMarkup('offer'), panelMarkup('forgot')]) assert.doesNotMatch(html, /'|\bon[a-z]+=/, 'curly quotes, no inline handlers');
});

test('what a form says before anything runs', () => {
  const ok = passphraseStrength('quiet harbour lantern');
  assert.equal(passphraseProblem('create', { passphrase: 'quiet harbour lantern', confirm: 'quiet harbour lantern' }, ok), '');
  assert.equal(passphraseProblem('create', { passphrase: 'quiet harbour lantern', confirm: 'quiet harbour' }, ok), 'The two passphrases don’t match.');
  assert.equal(passphraseProblem('create', { passphrase: 'short', confirm: 'short' }, passphraseStrength('short')), 'Use at least 10 characters.');
  assert.equal(passphraseProblem('change', { passphrase: 'password123', confirm: 'password123' }, passphraseStrength('password123')), 'That one is easy to guess. Try a few unrelated words.');
  assert.equal(passphraseProblem('enter', { passphrase: '' }), 'Type the passphrase of your synced copy.');
  assert.equal(passphraseProblem('enter', { passphrase: 'anything' }), '', 'any passphrase may be tried');
  assert.match(strengthMarkup(passphraseStrength('sunflowers')), /<strong>Fair<\/strong> Another word makes it much stronger\./);
});

test('the copy names the clouds this planner offers, and never the App Console’s folder name', async () => {
  assert.match(syncLead(['google', 'dropbox']), /^Keep your devices in step through your own cloud\./, 'the cards name them');
  assert.match(syncLead(['dropbox']), /your own Dropbox\./);
  assert.equal(syncLead(['google', 'dropbox'], { cloud: 'google', connected: true }), 'Your devices stay in step through your Google Drive. The copy there is sealed with your passphrase.');
  assert.equal(syncLead(['google'], { cloud: 'google', connected: true, sealed: false }), 'Your devices stay in step through your Google Drive.', 'a plain copy: no word of a seal');
  assert.match(returnNote('denied'), /access wasn’t allowed/);
  assert.match(returnNote('stale'), /expired/);
  const index = await read('index.html');
  const section = index.slice(index.indexOf('data-personal-sync hidden'), index.indexOf('data-personal-sync-recovery'));
  for (const hook of ['data-personal-sync-lead', 'data-personal-sync-choice', 'value="google"', 'value="dropbox"', 'data-personal-sync-mark', 'data-personal-sync-dot', 'data-personal-sync-access', 'data-personal-sync-folder', 'data-personal-sync-switch', 'data-personal-sync-panel', 'data-personal-sync-seal']) assert.ok(section.includes(hook), hook);
  for (const source of [section, await read('src/features/personal-sync-view.js'), await read('src/features/sync-guide.js')]) assert.doesNotMatch(source, /Apps ›|Apps\/Daily Planner|Apps › Daily Planner/);
});

test('the choice cards are real radios: Dropbox first, named by the cloud, described by their points', async () => {
  const index = await read('index.html');
  const choice = index.slice(index.indexOf('data-personal-sync-choice hidden'), index.indexOf('data-personal-sync-card'));
  assert.match(choice, /<fieldset class="personal-sync-choice">\s*<legend class="personal-sync-choice__legend">Where your copy lives<\/legend>/);
  const radios = [...choice.matchAll(/<input type="radio" name="personal-sync-cloud" value="(\w+)" data-personal-sync-cloud aria-labelledby="([\w-]+)" aria-describedby="([\w-]+)">/g)];
  assert.deepEqual(radios.map(match => match[1]), ['dropbox', 'google'], 'two native radios of one group (arrow keys move between them), Dropbox first');
  for (const [, cloud, name, points] of radios) {
    assert.match(choice, new RegExp(`<strong id="${name}">${cloud === 'google' ? 'Google Drive' : 'Dropbox'}</strong>`));
    assert.ok(choice.includes(`id="${points}"`), `${cloud}: its points describe it`);
  }
  assert.match(choice, /personal-sync-tag--auto">[\s\S]*?Saves on its own<\/span>/);
  assert.match(choice, /personal-sync-tag--tap">[\s\S]*?A tap every hour<\/span>/);
  for (const point of ['Stays connected on this device', 'Every change is saved in the background, all day', 'A hidden folder in your Drive', 'Google ends access after an hour; changes wait here until you tap Reconnect']) assert.ok(choice.includes(`<span>${point}</span>`), point);
  assert.match(choice, /Both are free and carry the same sealed copy\. You can switch later\./);
  assert.match(choice, /<button class="primary-button" type="button" data-personal-sync-choice-connect>/);
  assert.ok(index.includes(GOOGLE_TRADE_OFF), 'Google’s trade-off line, for its card alone');
  const css = await read('styles/sync.css');
  assert.match(css, /\.personal-sync-option:has\(input:focus-visible\) \{ outline: 2px solid/, 'the focus shows on the card');
  assert.match(css, /\.personal-sync-option input \{ position: absolute;[^}]*opacity: 0;/, 'the radio stays in the page, for keyboards and screen readers');
  assert.match(css, /@media \(max-width: 560px\) \{\n {2}\.personal-sync-choice__options \{ grid-template-columns: minmax\(0, 1fr\); \}/, 'stacked on phones');
});

test('the switch to Dropbox: offered under a dashed rule, confirmed inline', async () => {
  const index = await read('index.html');
  const box = index.slice(index.indexOf('data-personal-sync-switch hidden'), index.indexOf('data-personal-sync-seal'));
  assert.match(box, /Google asks again every hour\. <button class="personal-sync-link" type="button" data-personal-sync-switch-open aria-expanded="false" aria-controls="personal-sync-switch-confirm">Switch to Dropbox<\/button>: it stays connected and saves on its own\./);
  assert.match(box, /id="personal-sync-switch-confirm" data-personal-sync-switch-confirm hidden>\s*<p>Your other devices keep using Google Drive until you switch them too\.<\/p>/);
  assert.match(box, /data-personal-sync-switch-cancel>Cancel<\/button>\s*<button class="secondary-button" type="button" data-personal-sync-switch-go>Switch<\/button>/);
  assert.match(await read('styles/sync.css'), /\.personal-sync-switch \{[^}]*border-top: 1px dashed/);
});

test('the ledger keeps each cloud’s state apart; before 1.38 it was Google Drive', () => {
  const storage = new MemoryStorage();
  storage.setItem('daily-planner-sync:google', JSON.stringify({ connected: true, fileId: 'f', lastSyncedAt: '2026-10-01T08:00:00.000Z', lastError: '' }));
  const ledger = createSyncLedger(storage);
  assert.equal(ledger.cloud(), 'google', 'no choice saved: the Drive of earlier versions');
  assert.equal(ledger.provider().connected, true);
  ledger.setCloud('dropbox');
  assert.equal(ledger.cloud(), 'dropbox');
  assert.equal(ledger.provider().connected, false);
  ledger.saveProvider({ connected: true });
  assert.equal(JSON.parse(storage.getItem('daily-planner-sync:dropbox')).connected, true);
  assert.equal(ledger.provider('google').lastSyncedAt, '2026-10-01T08:00:00.000Z');
  ledger.setCloud('onedrive');
  assert.equal(ledger.cloud(), 'dropbox', 'only the clouds the planner knows');
  // Another cloud's copy: what was agreed on with the previous one is set aside, changes waiting stay.
  ledger.recordMutation({ key: 'daily-planner:2026-11-10', type: 'set' });
  ledger.markSynced('day:2026-11-09', { hash: 'h1' });
  ledger.resetBases();
  assert.equal(ledger.entry('day:2026-11-09').lastSyncedHash, undefined);
  assert.ok(ledger.entry('day:2026-11-10').dirtyAt);
  ledger.reset();
  assert.equal(storage.getItem('daily-planner-sync:dropbox'), null);
  assert.equal(storage.getItem('daily-planner-sync:cloud'), null);
});

test('DAILY_PLANNER_DROPBOX_APP_KEY: public, optional, blank in the source, one form everywhere', async () => {
  const entry = CONFIG_VARIABLES.find(item => item.name === 'DAILY_PLANNER_DROPBOX_APP_KEY');
  assert.deepEqual([entry.where, entry.runtimeKey, entry.level, entry.secret, entry.type, entry.format], ['build', 'DROPBOX_APP_KEY', 'optional', false, 'Text', 'dropbox-app-key']);
  assert.match(await read('runtime-config.js'), /^ {2}DROPBOX_APP_KEY: '',$/m);
  assert.match(await read('scripts/build.mjs'), /^ {2}DROPBOX_APP_KEY: process\.env\.DAILY_PLANNER_DROPBOX_APP_KEY \|\| '',$/m);
  const forms = [await read('src/config.js'), await read('server/admin-config.js'), await read('src/features/opening-seal.js')].map(source => /\/\^\[a-z0-9\]\{10,32\}\$\//.test(source));
  assert.deepEqual(forms, [true, true, true], 'the same form as DROPBOX_APP_KEY_RE');
  assert.equal(String(DROPBOX_APP_KEY_RE), '/^[a-z0-9]{10,32}$/');
  assert.match(describeShape(entry, 'abcd1234efgh567'), /^looks like a Dropbox app key \(15 characters/);
  assert.match(describeShape(entry, 'Secret-Value-123'), /not the form of a Dropbox app key/);
  const before = globalThis.__DAILY_PLANNER_CONFIG__;
  try {
    globalThis.__DAILY_PLANNER_CONFIG__ = { DROPBOX_APP_KEY: ' abcd1234efgh567 ' };
    assert.equal((await import(`../src/config.js?key=${Date.now()}`)).DROPBOX_APP_KEY, 'abcd1234efgh567');
    globalThis.__DAILY_PLANNER_CONFIG__ = { DROPBOX_APP_KEY: 'the app secret?' };
    assert.equal((await import(`../src/config.js?bad=${Date.now()}`)).DROPBOX_APP_KEY, '', 'not an app key: Dropbox hidden');
  } finally {
    globalThis.__DAILY_PLANNER_CONFIG__ = before;
  }
});
