import test from 'node:test';
import assert from 'node:assert/strict';
import { featureVersion, migrateFeedbackState, PROMPT_RULES, QUOTE_NAME_MAX, shouldPromptFeedback } from '../src/features/feedback.js';
import { WHATS_NEW, whatsNewItems } from '../src/features/whats-new.js';
import { installMode } from '../src/features/install.js';
import { APP_VERSION } from '../src/config.js';

const now = new Date('2026-10-20T10:00:00Z');
const seen = days => new Date(now.getTime() - days * 86400000).toISOString();

test('feedback is keyed by feature release, not by small fixes', () => {
  assert.equal(featureVersion('1.21.0'), '1.21');
  assert.equal(featureVersion('1.21.3'), '1.21');
  assert.equal(featureVersion('2.0.11'), '2.0');
  assert.equal(featureVersion('1.21'), '1.21');
  assert.deepEqual(PROMPT_RULES, { closedDays: 3, daysOnRelease: 2, daysBetweenPrompts: 14 });
  assert.equal(QUOTE_NAME_MAX, 60, 'the server keeps names to 60 characters');
});

test('the old per-version state folds into its release without asking again', () => {
  const migrated = migrateFeedbackState({
    versions: {
      '1.20.0': { firstSeen: seen(30), prompted: seen(20) },
      '1.20.2': { firstSeen: seen(10) },
      '1.19.0': { firstSeen: seen(60), sent: seen(50) }
    },
    lastPromptAt: seen(20)
  });
  assert.deepEqual(migrated.releases['1.20'], { firstSeen: seen(30), prompted: seen(20) }, 'earliest first use, prompt kept');
  assert.deepEqual(migrated.releases['1.19'], { firstSeen: seen(60), sent: seen(50) });
  assert.equal(migrated.lastPromptAt, seen(20));
  assert.equal(shouldPromptFeedback(migrated, { version: '1.20.2', now, closeDayCount: 9 }), false, '1.20 was already asked about');
  assert.deepEqual(migrateFeedbackState(null), { releases: {}, lastPromptAt: '' });
  assert.deepEqual(migrateFeedbackState({ releases: { '1.21': { firstSeen: seen(3) } } }).releases, { '1.21': { firstSeen: seen(3) } }, 'new state reads back as is');
});

test('feedback is asked once per feature release, after real use, at most every two weeks', () => {
  const base = { releases: { '1.21': { firstSeen: seen(3) } }, lastPromptAt: '' };
  assert.equal(shouldPromptFeedback(base, { version: '1.21.0', now, closeDayCount: 3 }), true);
  assert.equal(shouldPromptFeedback(base, { version: '1.21.4', now, closeDayCount: 3 }), true, 'a fix release is the same release');
  assert.equal(shouldPromptFeedback(base, { version: '1.21.0', now, closeDayCount: 2 }), false, 'needs three closed days');
  assert.equal(shouldPromptFeedback({ releases: { '1.21': { firstSeen: seen(1) } } }, { version: '1.21.0', now, closeDayCount: 9 }), false, 'needs two days on this release');
  assert.equal(shouldPromptFeedback({ releases: { '1.21': { firstSeen: seen(2) } } }, { version: '1.21.0', now, closeDayCount: 9 }), true, 'two days is enough');
  assert.equal(shouldPromptFeedback({ releases: { '1.21': { firstSeen: seen(9), sent: seen(2) } } }, { version: '1.21.0', now, closeDayCount: 9 }), false, 'already sent');
  assert.equal(shouldPromptFeedback({ releases: { '1.21': { firstSeen: seen(9), dismissed: seen(2) } } }, { version: '1.21.0', now, closeDayCount: 9 }), false, '“Not now” for this release');
  assert.equal(shouldPromptFeedback({ releases: { '1.21': { firstSeen: seen(40), prompted: seen(20) } } }, { version: '1.21.0', now, closeDayCount: 9 }), false, 'shown once already, even if never answered');
  assert.equal(shouldPromptFeedback({ ...base, lastPromptAt: seen(10) }, { version: '1.21.0', now, closeDayCount: 9 }), false, 'asked recently about another release');
  assert.equal(shouldPromptFeedback({ ...base, lastPromptAt: seen(15) }, { version: '1.21.0', now, closeDayCount: 9 }), true, 'two weeks later is fine');
  assert.equal(shouldPromptFeedback(base, { version: '1.21.0', now, closeDayCount: 9, enabled: false }), false, 'no endpoint, no prompt');
  assert.equal(shouldPromptFeedback(base, { version: '1.21.0', now, closeDayCount: 9, busy: true }), false, 'never over another dialog or during setup');
  assert.equal(shouldPromptFeedback(base, { version: '1.22.0', now, closeDayCount: 9 }), false, 'a release never seen is not asked about');
});

test('what’s new is short and belongs to a feature release', () => {
  assert.match(WHATS_NEW.version, /^\d+\.\d+$/);
  assert.ok(WHATS_NEW.items.length >= 3 && WHATS_NEW.items.length <= 5, '3–5 lines');
  for (const item of WHATS_NEW.items) {
    assert.ok(item.length <= 220, `short enough: ${item}`);
    assert.doesNotMatch(item, /['"]/, 'typographic quotes and apostrophes');
  }
  // feedback.js shows the lines only when they belong to the app's own feature release: a version set in one place
  // and not the other would hide them, or show an older release's lines on a newer one.
  assert.equal(WHATS_NEW.version, featureVersion(APP_VERSION), 'What’s new is the note of this feature release (APP_VERSION major.minor)');
});

test('what’s new in 1.39: everything free, open source, and GitHub Sponsors only where this copy has a sponsor page', () => {
  assert.equal(WHATS_NEW.version, '1.39');
  const bare = whatsNewItems({ repo: '', sponsor: '' });
  assert.equal(bare[0], 'Everything is free now: Plan your year, the quarterly check-ins, your year in review, Insights and the palettes are part of the planner for everyone.');
  assert.equal(bare[1], 'Daily Planner is open source (MIT).', 'no repository link set: said without one');
  assert.equal(bare.length, 3);
  assert.ok(!bare.some(item => /Sponsors|GitHub/.test(item)), 'no sponsor page, no repository: neither is mentioned');
  const full = whatsNewItems({ repo: 'https://github.com/example/planner', sponsor: 'https://github.com/sponsors/example' });
  assert.equal(full[1], 'Daily Planner is open source (MIT), with its code on GitHub.');
  assert.equal(full.at(-1), 'You can support it on GitHub Sponsors.');
  assert.equal(full.length, 4);
  assert.equal(whatsNewItems({ repo: 'not a link', sponsor: 'http://insecure.example' }).length, 3, 'only https links count');
  for (const items of [bare, full]) {
    assert.ok(items.length >= 3 && items.length <= 4);
    for (const item of items) assert.doesNotMatch(item, /\bPlus\b|upgrade|unlock|premium|licen[cs]e|gift|partner|price|€|\$/i, item);
  }
});

test('install guidance follows the browser in hand', () => {
  const iPhone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';
  const macSafari = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15';
  const chrome = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';
  const firefox = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0';
  const samsung = 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/26.0 Chrome/122.0 Mobile Safari/537.36';
  assert.equal(installMode({ ua: chrome, standalone: true }), 'installed');
  assert.equal(installMode({ ua: chrome, hasPrompt: true }), 'prompt');
  assert.equal(installMode({ ua: iPhone }), 'ios');
  assert.equal(installMode({ ua: macSafari, platform: 'MacIntel', maxTouchPoints: 5 }), 'ios', 'iPadOS reports a Mac with touch');
  assert.equal(installMode({ ua: macSafari, platform: 'MacIntel', maxTouchPoints: 0 }), 'mac-safari');
  assert.equal(installMode({ ua: chrome }), 'chromium');
  assert.equal(installMode({ ua: firefox }), 'firefox');
  assert.equal(installMode({ ua: samsung }), 'android-menu');
  const androidChrome = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36';
  assert.equal(installMode({ ua: androidChrome }), 'android-menu', 'Android Chrome without a prompt uses the menu');
  assert.equal(installMode({ ua: androidChrome, hasPrompt: true }), 'prompt');
});
