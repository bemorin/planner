/**
 * Appearance preference (System / Light / Dark; setup asks only Light or Dark).
 *
 * The preference belongs to the device, not to the planner: it is stored under
 * a key outside the `daily-planner:` namespace so it is never exported in
 * backups, reset with planner data, or carried to another device by sync.
 * `index.html` applies a stored choice before first paint; this module keeps the
 * document, the browser chrome colour, and the Settings control in step.
 */

export const THEME_STORAGE_KEY = 'daily-planner-ui:theme';
export const THEME_OPTIONS = ['system', 'light', 'dark'];
const CHROME_COLORS = { light: '#f6f3ed', dark: '#141311' };

export function normalizeThemePreference(value) {
  return THEME_OPTIONS.includes(value) ? value : 'system';
}

export function readThemePreference(storage = globalThis.localStorage) {
  try { return normalizeThemePreference(storage?.getItem(THEME_STORAGE_KEY)); } catch (_) { return 'system'; }
}

export function writeThemePreference(value, storage = globalThis.localStorage) {
  const next = normalizeThemePreference(value);
  try {
    if (next === 'system') storage?.removeItem(THEME_STORAGE_KEY);
    else storage?.setItem(THEME_STORAGE_KEY, next);
  } catch (_) {}
  return next;
}

/** Resolve a preference to the theme actually painted. */
export function resolveTheme(preference, systemPrefersDark = false) {
  const value = normalizeThemePreference(preference);
  if (value === 'system') return systemPrefersDark ? 'dark' : 'light';
  return value;
}

/**
 * The option a control shows as chosen. Settings offers System, Light and
 * Dark; setup offers only Light and Dark, so while the device follows the
 * system it shows the theme the system paints (`options` lists a control's
 * choices).
 */
export function pressedThemeOption(preference, systemPrefersDark = false, options = THEME_OPTIONS) {
  const value = normalizeThemePreference(preference);
  return options.includes(value) ? value : resolveTheme(value, systemPrefersDark);
}

export function createThemeController({ doc = document, storage = globalThis.localStorage, onChange = null } = {}) {
  const query = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
  let preference = readThemePreference(storage);

  const resolved = () => resolveTheme(preference, !!query?.matches);

  function apply() {
    const root = doc.documentElement;
    if (preference === 'system') delete root.dataset.theme;
    else root.dataset.theme = preference;
    const color = CHROME_COLORS[resolved()];
    doc.querySelectorAll('meta[name="theme-color"]').forEach(meta => meta.setAttribute('content', color));
    doc.querySelectorAll('[data-theme-option]').forEach(button => {
      const group = button.parentElement ? [...button.parentElement.querySelectorAll('[data-theme-option]')].map(option => option.dataset.themeOption) : THEME_OPTIONS;
      const active = button.dataset.themeOption === pressedThemeOption(preference, !!query?.matches, group);
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    });
    onChange?.(resolved(), preference);
  }

  function set(value) {
    preference = writeThemePreference(value, storage);
    apply();
  }

  /** Mirror the theme into another document, e.g. the Picture-in-Picture window. */
  function mirrorTo(otherDoc) {
    if (!otherDoc?.documentElement) return;
    otherDoc.documentElement.dataset.theme = resolved();
  }

  doc.addEventListener('click', event => {
    const button = event.target.closest?.('[data-theme-option]');
    if (button) set(button.dataset.themeOption);
  });
  query?.addEventListener?.('change', () => { if (preference === 'system') apply(); });
  apply();

  return { get: () => preference, resolved, set, apply, mirrorTo };
}
