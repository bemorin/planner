/**
 * The older days' home (1.40): IndexedDB `daily-planner-archive`, version 1.
 *
 * - Store `days`, keyPath `day`: { day, json, chars, movedAt }. `json` is the exact string localStorage held.
 * - Store `displaced`, auto-increment: { day, json, displacedAt, reason }: an earlier version of a day kept aside
 *   (a day written blind by an older tab over one that had moved). Never pruned by the planner.
 *
 * One connection per page, opened on demand with a time limit (Safari 14.6 could lose IndexedDB requests), closed when
 * another page upgrades the database, and opened again when next needed. Reads go in batches of READ_BATCH; each
 * write is one transaction, committed with `durability: 'strict'`, because the next step of a move deletes the only
 * other copy. Every call returns a promise that rejects on failure: ./day-store.js catches, the planner never sees it.
 *
 * createMemoryArchive() has the same calls, in memory, for tests and for checking a pass step by step.
 */

export const ARCHIVE_DB = 'daily-planner-archive';
const DB_VERSION = 1;
const DAYS = 'days';
const DISPLACED = 'displaced';
export const OPEN_TIMEOUT_MS = 4000;
const CALL_TIMEOUT_MS = 20000;
export const READ_BATCH = 1000;

const within = (promise, ms, label) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(Object.assign(new Error(`${label}: no answer in time`), { name: 'TimeoutError' })), ms);
  promise.then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
});

const done = transaction => new Promise((resolve, reject) => {
  transaction.oncomplete = () => resolve();
  transaction.onerror = () => reject(transaction.error || new Error('Archive transaction failed'));
  transaction.onabort = () => reject(transaction.error || new Error('Archive transaction aborted'));
});

const answer = request => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error || new Error('Archive request failed'));
});

const record = ({ day, json }, movedAt) => ({ day, json, chars: day.length + 14 + json.length, movedAt });

/** The archive in this browser's IndexedDB. */
export function createDayArchive({ indexedDB = globalThis.indexedDB, now = () => new Date(), openTimeoutMs = OPEN_TIMEOUT_MS, callTimeoutMs = CALL_TIMEOUT_MS } = {}) {
  let db = null;
  let opening = null;

  function open() {
    if (db) return Promise.resolve(db);
    if (opening) return opening;
    const attempt = new Promise((resolve, reject) => {
      if (!indexedDB?.open) return reject(new Error('IndexedDB unavailable'));
      let request;
      try { request = indexedDB.open(ARCHIVE_DB, DB_VERSION); } catch (error) { return reject(error); }
      request.onupgradeneeded = () => {
        const upgrade = request.result;
        if (!upgrade.objectStoreNames.contains(DAYS)) upgrade.createObjectStore(DAYS, { keyPath: 'day' });
        if (!upgrade.objectStoreNames.contains(DISPLACED)) upgrade.createObjectStore(DISPLACED, { keyPath: 'id', autoIncrement: true });
      };
      request.onblocked = () => reject(new Error('Archive blocked by another tab'));
      request.onerror = () => reject(request.error || new Error('Unable to open the archive'));
      request.onsuccess = () => {
        const opened = request.result;
        // Another page upgrades or deletes the database: let go, and open it again when next needed.
        opened.onversionchange = () => { try { opened.close(); } catch (_) {} if (db === opened) db = null; };
        opened.onclose = () => { if (db === opened) db = null; };
        resolve(opened);
      };
    });
    opening = within(attempt, openTimeoutMs, 'open').then(opened => { db = opened; opening = null; return opened; }, error => { opening = null; throw error; });
    return opening;
  }

  async function run(stores, mode, action, label) {
    const connection = await open();
    const work = (async () => {
      let transaction;
      try { transaction = connection.transaction(stores, mode, mode === 'readwrite' ? { durability: 'strict' } : undefined); }
      catch (error) {
        // A connection closed under us (another tab upgraded): opened again next time.
        if (error?.name === 'InvalidStateError' && db === connection) db = null;
        throw error;
      }
      const finished = done(transaction);
      finished.catch(() => {});
      let result;
      try { result = action(transaction); } catch (error) { try { transaction.abort(); } catch (_) {} throw error; }
      if (result instanceof Promise) result.catch(() => {});
      await finished;
      return result instanceof Promise ? await result : result;
    })();
    return within(work, callTimeoutMs, label);
  }

  /** Every archived day, oldest first: [{ day, json, chars, movedAt }], read READ_BATCH at a time. */
  async function all() {
    const records = [];
    let after = null;
    for (;;) {
      const batch = await run(DAYS, 'readonly', transaction => {
        const range = after == null ? null : IDBKeyRange.lowerBound(after, true);
        return answer(transaction.objectStore(DAYS).getAll(range, READ_BATCH));
      }, 'read');
      records.push(...batch);
      if (batch.length < READ_BATCH) return records;
      after = batch[batch.length - 1].day;
    }
  }

  /** The strings archived for `days`, as a Map day → json (a day not archived is absent): one transaction. */
  async function read(days) {
    return run(DAYS, 'readonly', transaction => {
      const store = transaction.objectStore(DAYS);
      const found = new Map();
      return Promise.all(days.map(day => answer(store.get(day)).then(value => { if (value && typeof value.json === 'string') found.set(day, value.json); }))).then(() => found);
    }, 'read');
  }

  /** Days within [from, to), oldest first, [{ day, json }…]: what another tab moved since this one last read. */
  async function range(from, to) {
    if (!(from < to)) return [];
    return run(DAYS, 'readonly', transaction => answer(transaction.objectStore(DAYS).getAll(IDBKeyRange.bound(from, to, false, true))), 'read');
  }

  /** Stores `entries` ([{ day, json }]) in one strict transaction: all of them, or none. */
  async function put(entries) {
    const movedAt = now().toISOString();
    return run(DAYS, 'readwrite', transaction => {
      const store = transaction.objectStore(DAYS);
      for (const entry of entries) store.put(record(entry, movedAt));
    }, 'write');
  }

  async function remove(days) {
    if (!days.length) return;
    return run(DAYS, 'readwrite', transaction => {
      const store = transaction.objectStore(DAYS);
      for (const day of days) store.delete(day);
    }, 'write');
  }

  /** Every archived day gone; with `displaced`, the copies kept aside too (Reset local data). */
  async function clear({ displaced: aside = false } = {}) {
    return run(aside ? [DAYS, DISPLACED] : DAYS, 'readwrite', transaction => {
      transaction.objectStore(DAYS).clear();
      if (aside) transaction.objectStore(DISPLACED).clear();
    }, 'write');
  }

  /** Keeps earlier versions aside ([{ day, json, reason }]) and, in the same transaction, removes `drop` from `days`. Resolves to their ids. */
  async function keepAside(entries, { drop = [] } = {}) {
    const displacedAt = now().toISOString();
    return run([DAYS, DISPLACED], 'readwrite', transaction => {
      const kept = transaction.objectStore(DISPLACED);
      const ids = Promise.all(entries.map(({ day, json, reason = 'older-tab' }) => answer(kept.add({ day, json, displacedAt, reason }))));
      const store = transaction.objectStore(DAYS);
      for (const day of drop) store.delete(day);
      return ids;
    }, 'write');
  }

  /** Forgets copies kept aside, by id: only one just kept by a Restore that then couldn't be saved. */
  async function forget(ids) {
    return run(DISPLACED, 'readwrite', transaction => { const kept = transaction.objectStore(DISPLACED); for (const id of ids) kept.delete(id); }, 'write');
  }

  /** Writes copies kept aside back as given, their ids kept ([{ id, day, json, displacedAt, reason, restoredAt }]): never removes one. */
  async function rewrite(entries) {
    return run(DISPLACED, 'readwrite', transaction => { const kept = transaction.objectStore(DISPLACED); for (const entry of entries) kept.put(entry); }, 'write');
  }

  /** How many days are archived: what the manifest counts (1.40), read after each change. */
  async function count() {
    return run(DAYS, 'readonly', transaction => answer(transaction.objectStore(DAYS).count()), 'read');
  }

  /**
   * Whether this browser has the archive's database at all, without creating it: indexedDB.databases() where the
   * browser has it (Chrome 71, Safari 14, Firefox 126); elsewhere, or when it fails, unknown (null). Nothing is ever
   * opened, so created, just to find out.
   */
  async function exists() {
    if (typeof indexedDB?.databases !== 'function') return null;
    try { return (await within(indexedDB.databases(), openTimeoutMs, 'databases')).some(entry => entry?.name === ARCHIVE_DB); } catch (_) { return null; }
  }

  /** Deletes the database (Reset local data, when clearing it failed). Rejects if it is blocked or doesn't answer in time. */
  function destroy({ timeoutMs = openTimeoutMs } = {}) {
    close();
    return within(new Promise((resolve, reject) => {
      if (!indexedDB?.deleteDatabase) return reject(new Error('IndexedDB unavailable'));
      let request;
      try { request = indexedDB.deleteDatabase(ARCHIVE_DB); } catch (error) { return reject(error); }
      request.onsuccess = () => resolve(true);
      request.onerror = () => reject(request.error || new Error('Unable to delete the archive'));
    }), timeoutMs, 'delete');
  }

  /** The versions kept aside, newest first. */
  async function displaced() {
    const list = await run(DISPLACED, 'readonly', transaction => answer(transaction.objectStore(DISPLACED).getAll()), 'read');
    return list.sort((a, b) => String(b.displacedAt).localeCompare(String(a.displacedAt)) || b.id - a.id);
  }

  function close() {
    try { db?.close(); } catch (_) {}
    db = null;
  }

  return { kind: 'indexeddb', open: () => open().then(() => true), all, read, range, put, remove, clear, keepAside, forget, rewrite, displaced, count, exists, destroy, close };
}

/**
 * The same calls in memory: what tests use, and what a pass can be checked against step by step.
 *
 * `faults` makes the next calls of a kind fail: { open, read, put, remove, clear, keepAside } set to an Error (or a
 * function of the call's argument returning one) rejects that call; `faults.readBack` (a function of a json string)
 * changes what a read returns, as a disk that lost a write would. `ops` counts the calls of each kind.
 */
export function createMemoryArchive({ days = [], displaced: kept = [], now = () => new Date() } = {}) {
  const data = new Map(days.map(entry => [entry.day, record(entry, entry.movedAt || now().toISOString())]));
  const aside = kept.map((entry, index) => ({ id: index + 1, ...entry }));
  let nextId = aside.length + 1;
  const faults = {};
  const ops = { open: 0, all: 0, read: 0, range: 0, put: 0, remove: 0, clear: 0, keepAside: 0, displaced: 0, count: 0, forget: 0, rewrite: 0, destroy: 0 };
  // Whether the database exists (indexedDB.databases()): from the first call that opens it, or its first record.
  let created = days.length > 0 || kept.length > 0;
  const fail = (kind, arg) => {
    ops[kind] += 1;
    const fault = faults[kind];
    const error = typeof fault === 'function' ? fault(arg) : fault;
    if (error) throw error;
  };
  const tick = () => Promise.resolve();
  const sorted = () => [...data.values()].sort((a, b) => (a.day < b.day ? -1 : 1));
  const readBack = json => (typeof faults.readBack === 'function' ? faults.readBack(json) : json);
  return {
    kind: 'memory',
    data,
    aside,
    faults,
    ops,
    async open() { await tick(); fail('open'); created = true; return true; },
    async all() { await tick(); fail('all'); return sorted().map(entry => ({ ...entry, json: readBack(entry.json) })); },
    async read(list) {
      await tick();
      fail('read', list);
      const found = new Map();
      for (const day of list) if (data.has(day)) found.set(day, readBack(data.get(day).json));
      return found;
    },
    async range(from, to) { await tick(); fail('range'); return sorted().filter(entry => entry.day >= from && entry.day < to).map(entry => ({ ...entry })); },
    async put(entries) {
      await tick();
      fail('put', entries);
      const movedAt = now().toISOString();
      for (const entry of entries) data.set(entry.day, record(entry, movedAt));
    },
    async remove(list) { await tick(); fail('remove', list); for (const day of list) data.delete(day); },
    async clear({ displaced: kept = false } = {}) { await tick(); fail('clear'); data.clear(); if (kept) aside.length = 0; },
    async keepAside(entries, { drop = [] } = {}) {
      await tick();
      fail('keepAside', entries);
      const displacedAt = now().toISOString();
      const ids = [];
      for (const { day, json, reason = 'older-tab' } of entries) { ids.push(nextId); aside.push({ id: nextId++, day, json, displacedAt, reason }); }
      for (const day of drop) data.delete(day);
      return ids;
    },
    async forget(ids) { await tick(); fail('forget', ids); for (const id of ids) { const at = aside.findIndex(entry => entry.id === id); if (at >= 0) aside.splice(at, 1); } },
    async rewrite(entries) { await tick(); fail('rewrite', entries); for (const entry of entries) { const at = aside.findIndex(item => item.id === entry.id); if (at >= 0) aside[at] = { ...entry }; } },
    async count() { await tick(); fail('count'); return data.size; },
    async exists() { await tick(); return created || data.size > 0 || aside.length > 0; },
    async destroy() { await tick(); fail('destroy'); data.clear(); aside.length = 0; created = false; return true; },
    async displaced() { await tick(); fail('displaced'); return [...aside].sort((a, b) => String(b.displacedAt).localeCompare(String(a.displacedAt)) || b.id - a.id); },
    close() {}
  };
}
