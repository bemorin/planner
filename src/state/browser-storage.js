/**
 * Browser storage the browser may refuse (1.30).
 *
 * With cookies and site data blocked for this site (a browser setting, some
 * locked-down or embedded contexts), merely reading window.localStorage
 * throws, and the planner used to stop before drawing anything. At boot,
 * app.js calls ensureStorage(): each storage the browser refuses is replaced,
 * for this page only, by one kept in memory. The planner then works as usual
 * for the session, nothing is kept once the tab is closed or reloaded, and
 * app.js says so once, with the “Local saving” dialog (BLOCKED_NOTICE).
 * A storage that can be read but not written (full, or a private window that
 * allows no space) is left alone: the same dialog keeps its usual words.
 */

/** The “Local saving” dialog when the browser blocks storage. */
export const BLOCKED_NOTICE = Object.freeze({
  title: 'This browser won’t keep your plans.',
  text: 'Cookies and site data are blocked for this site, so the planner works as usual but forgets everything once this tab is closed or reloaded. To keep your plans, allow them in the browser’s settings, or export a backup before you leave.'
});

/** A Storage kept in memory: the methods of localStorage, forgotten with the page. */
export function createMemoryStorage() {
  const data = new Map();
  return {
    get length() { return data.size; },
    key: index => [...data.keys()][Number(index)] ?? null,
    getItem: key => (data.has(String(key)) ? data.get(String(key)) : null),
    setItem: (key, value) => { data.set(String(key), String(value)); },
    removeItem: key => { data.delete(String(key)); },
    clear: () => { data.clear(); }
  };
}

/**
 * The storage `win[name]` ('localStorage', 'sessionStorage') when it can be
 * read, else null: where storage is blocked, reading the property itself
 * throws (Chrome, Safari), or it is null (Firefox with storage switched off).
 */
export function readableStorage(win, name) {
  try {
    const storage = win?.[name];
    if (!storage || typeof storage.getItem !== 'function') return null;
    storage.getItem('daily-planner:storage-check');
    return storage;
  } catch (_) {
    return null;
  }
}

/**
 * Makes `win.localStorage` and `win.sessionStorage` usable: each one the
 * browser refuses becomes a createMemoryStorage() for this page, so every
 * module reading globalThis.localStorage keeps working. Returns the
 * localStorage to use (the browser's, or the memory one) and `blocked`: true
 * when the browser refused it, so nothing the planner saves will be kept.
 */
export function ensureStorage(win = globalThis) {
  const usable = name => {
    const storage = readableStorage(win, name);
    if (storage) return { storage, blocked: false };
    const memory = createMemoryStorage();
    try { Object.defineProperty(win, name, { configurable: true, enumerable: true, value: memory }); } catch (_) {}
    return { storage: memory, blocked: true };
  };
  const local = usable('localStorage');
  usable('sessionStorage');
  return { localStorage: local.storage, blocked: local.blocked };
}
