/**
 * Where this device keeps the key that opens the sealed copy (1.38), so the
 * passphrase is typed once per device: IndexedDB `daily-planner-sync`, store
 * `keys`, one record { id: 'seal', salt, iterations, check, key, savedAt }.
 * `key` is a WebCrypto AES-GCM key made non-extractable: scripts of this site
 * can use it to seal and open the copy, but nothing can read its bytes out,
 * and the passphrase itself is never stored. Disconnect forgets it.
 *
 * Without IndexedDB (some private windows), the key lives in memory for the
 * open page only, and the passphrase is asked again next time.
 */

const DB_NAME = 'daily-planner-sync';
const STORE_NAME = 'keys';
const RECORD_ID = 'seal';

function openDatabase(indexedDB) {
  return new Promise((resolve, reject) => {
    if (!indexedDB) return reject(new Error('IndexedDB unavailable'));
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) request.result.createObjectStore(STORE_NAME, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Unable to open the sync key database'));
  });
}

async function run(indexedDB, mode, action) {
  const db = await openDatabase(indexedDB);
  try {
    return await new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_NAME, mode);
      const request = action(transaction.objectStore(STORE_NAME));
      let result;
      if (request) request.onsuccess = () => { result = request.result; };
      transaction.oncomplete = () => resolve(result);
      transaction.onerror = () => reject(transaction.error || new Error('Sync key transaction failed'));
      transaction.onabort = () => reject(transaction.error || new Error('Sync key transaction aborted'));
    });
  } finally { db.close(); }
}

/** The key store: load(), save(record) (true when kept beyond this page), clear(). */
export function createKeyStore({ indexedDB = globalThis.indexedDB } = {}) {
  let memory = null;
  return {
    async load() {
      try {
        const record = await run(indexedDB, 'readonly', store => store.get(RECORD_ID));
        return record || memory;
      } catch {
        return memory;
      }
    },
    async save(record) {
      memory = { ...record, id: RECORD_ID };
      try {
        await run(indexedDB, 'readwrite', store => store.put(memory));
        return true;
      } catch {
        return false;
      }
    },
    async clear() {
      memory = null;
      try { await run(indexedDB, 'readwrite', store => store.delete(RECORD_ID)); } catch {}
    },
    /** Disconnect with no cloud left: the database itself goes (best effort; another open tab may hold it a moment). */
    async destroy() {
      memory = null;
      await new Promise(resolve => {
        try {
          const request = indexedDB?.deleteDatabase?.(DB_NAME);
          if (!request) return resolve();
          request.onsuccess = request.onerror = request.onblocked = () => resolve();
        } catch { resolve(); }
      });
    }
  };
}

/** The same calls, in memory only (tests, and browsers without IndexedDB). */
export function createMemoryKeyStore(initial = null) {
  let memory = initial;
  return {
    destroyed: false,
    async load() { return memory; },
    async save(record) { memory = { ...record, id: RECORD_ID }; return false; },
    async clear() { memory = null; },
    async destroy() { memory = null; this.destroyed = true; }
  };
}
