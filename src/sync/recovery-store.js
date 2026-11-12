const DB_NAME = 'daily-planner-recovery';
const STORE_NAME = 'snapshots';
const DB_VERSION = 1;
export const MAX_SNAPSHOTS = 5;
/** 1.40: the snapshot taken before older days first moved, kept outside the limit (the latest one). */
export const KEPT_REASON = 'before-archive';

/**
 * The snapshots to delete, from a list newest first: all but the `max` newest, except the newest one taken before
 * older days first moved, which stays however many syncs come after it (it is the planner as it was before 1.40 moved
 * anything, and a few busy days of syncing would otherwise push it out).
 */
export function snapshotsToPrune(snapshots = [], max = MAX_SNAPSHOTS) {
  const kept = snapshots.find(item => item?.reason === KEPT_REASON) || null;
  const others = snapshots.filter(item => item !== kept);
  return others.slice(kept && snapshots.indexOf(kept) < max ? max - 1 : max);
}

function openDatabase() {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) return reject(new Error('IndexedDB unavailable'));
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Unable to open recovery database'));
  });
}

function complete(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error || new Error('Recovery transaction failed'));
    transaction.onabort = () => reject(transaction.error || new Error('Recovery transaction aborted'));
  });
}

export function createRecoveryStore({ now = () => new Date() } = {}) {
  async function list() {
    const db = await openDatabase();
    try {
      const transaction = db.transaction(STORE_NAME, 'readonly');
      const store = transaction.objectStore(STORE_NAME);
      const snapshots = await new Promise((resolve, reject) => {
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result || []);
        request.onerror = () => reject(request.error || new Error('Unable to read recovery snapshots'));
      });
      await complete(transaction);
      return snapshots.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    } finally { db.close(); }
  }

  async function save(data, reason = 'sync') {
    const createdAt = now().toISOString();
    const snapshot = { id: `snapshot:${createdAt}:${Math.random().toString(36).slice(2, 8)}`, createdAt, reason, data };
    const db = await openDatabase();
    try {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      transaction.objectStore(STORE_NAME).put(snapshot);
      await complete(transaction);
    } finally { db.close(); }

    const prune = snapshotsToPrune(await list());
    if (prune.length) {
      const pruneDb = await openDatabase();
      try {
        const transaction = pruneDb.transaction(STORE_NAME, 'readwrite');
        const store = transaction.objectStore(STORE_NAME);
        prune.forEach(item => store.delete(item.id));
        await complete(transaction);
      } finally { pruneDb.close(); }
    }
    return snapshot;
  }

  async function latest() { return (await list())[0] || null; }
  async function count() { return (await list()).length; }

  /** Removes the snapshots `match(snapshot)` picks (1.40: Reset removes the one taken before older days first moved). */
  async function remove(match) {
    const doomed = (await list()).filter(match);
    if (!doomed.length) return 0;
    const db = await openDatabase();
    try {
      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);
      doomed.forEach(item => store.delete(item.id));
      await complete(transaction);
    } finally { db.close(); }
    return doomed.length;
  }

  return { save, list, latest, count, remove };
}
