import test from 'node:test';
import assert from 'node:assert/strict';
import { THEME_STORAGE_KEY, normalizeThemePreference, pressedThemeOption, readThemePreference, resolveTheme, writeThemePreference } from '../src/ui/theme.js';

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: key => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: key => data.delete(key),
    data
  };
}

test('theme preference is stored outside the planner data namespace', () => {
  assert.ok(!THEME_STORAGE_KEY.startsWith('daily-planner:'));
});

test('unknown or missing preferences fall back to system', () => {
  assert.equal(normalizeThemePreference('sepia'), 'system');
  assert.equal(readThemePreference(memoryStorage()), 'system');
  assert.equal(readThemePreference({ getItem: () => { throw new Error('blocked'); } }), 'system');
});

test('explicit preferences persist and system clears the stored key', () => {
  const storage = memoryStorage();
  assert.equal(writeThemePreference('dark', storage), 'dark');
  assert.equal(readThemePreference(storage), 'dark');
  writeThemePreference('system', storage);
  assert.equal(storage.data.has(THEME_STORAGE_KEY), false);
});

test('system preference resolves from the device setting', () => {
  assert.equal(resolveTheme('system', true), 'dark');
  assert.equal(resolveTheme('system', false), 'light');
  assert.equal(resolveTheme('light', true), 'light');
  assert.equal(resolveTheme('dark', false), 'dark');
});

test('setup offers Light and Dark: while following the system it shows the theme the system paints', () => {
  const pair = ['light', 'dark'];
  assert.equal(pressedThemeOption('system', true, pair), 'dark');
  assert.equal(pressedThemeOption('system', false, pair), 'light');
  assert.equal(pressedThemeOption('light', true, pair), 'light', 'an explicit choice wins over the system');
  assert.equal(pressedThemeOption('dark', false, pair), 'dark');
  assert.equal(pressedThemeOption('sepia', true, pair), 'dark', 'an unknown value follows the system');
});

test('Settings keeps System as its own choice', () => {
  assert.equal(pressedThemeOption('system', true), 'system');
  assert.equal(pressedThemeOption('dark', true), 'dark');
});
