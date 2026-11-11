import { randomToken } from './cloud.js';
import { createSeal, openEnvelope, readEnvelope, sealText, unlockEnvelope } from './seal.js';

/**
 * The seal around Personal sync (1.38), between the engine (./engine.js) and
 * the cloud (./cloud.js): the engine reads and writes a sync document, the
 * cloud holds a file, and this turns one into the other.
 *
 * - A new copy is always sealed: connecting where there is none asks for a
 *   passphrase first (SyncPassphraseNeededError 'create').
 * - A sealed copy opens with the key this device keeps (./key-store.js), or
 *   asks for its passphrase ('enter'; 'changed' when this device held the
 *   key of an earlier one).
 * - A plain copy, from before 1.38, keeps syncing as it is on a device that
 *   holds no key, and is offered a seal (src/features/personal-sync.js). Once
 *   a device seals or opens a sealed copy, it never writes a plain one again.
 *
 * On this device: localStorage `daily-planner-sync:protection` holds what is
 * not secret (the salt and count of the current seal, when this device first
 * sealed, whether the offer was set aside); the key is in IndexedDB.
 */

export const PROTECTION_KEY = 'daily-planner-sync:protection';

const safeParse = raw => { try { return raw ? JSON.parse(raw) : null; } catch { return null; } };

/** The synced copy is sealed and this device can't open it yet, or there is none and it needs a passphrase first. */
export class SyncPassphraseNeededError extends Error {
  constructor(reason, envelope = null) {
    super(reason === 'create' ? 'Choose a passphrase to seal your synced copy.' : 'Enter the passphrase of your synced copy.');
    this.name = 'SyncPassphraseNeededError';
    this.code = 'passphrase';
    this.reason = reason;
    this.envelope = envelope;
  }
}

/** The synced copy can't be read: 'damaged', 'unsupported' (made by a newer planner) or 'unreadable'. Nothing is written over it. */
export class SyncCopyError extends Error {
  constructor(reason) {
    super(reason === 'unsupported'
      ? 'Your synced copy was made by a newer version of the planner. Reload the planner to update it, then sync again.'
      : reason === 'damaged'
        ? 'Your synced copy is damaged or was changed outside the planner, so it was left as it is.'
        : 'The sync file in your cloud isn’t one the planner can read, so it was left as it is.');
    this.name = 'SyncCopyError';
    this.code = 'sealed-copy';
    this.reason = reason;
  }
}

/** This device's seal: the key it keeps, and what it remembers about the copy. */
export function createSyncProtection({ storage = globalThis.localStorage, keyStore, now = () => new Date() } = {}) {
  let current = null;
  let memory = {};

  const readMeta = () => {
    if (!storage) return memory;
    try { return safeParse(storage.getItem(PROTECTION_KEY)) || {}; } catch { return memory; }
  };
  const writeMeta = patch => {
    const next = Object.fromEntries(Object.entries({ ...readMeta(), ...patch }).filter(([, value]) => value != null));
    memory = next;
    try {
      if (Object.keys(next).length) storage?.setItem(PROTECTION_KEY, JSON.stringify(next));
      else storage?.removeItem(PROTECTION_KEY);
    } catch {}
    return next;
  };

  return {
    /** Reads the key kept on this device; null when there is none, or it belongs to another seal. */
    async load() {
      const meta = readMeta();
      const record = await keyStore?.load?.().catch(() => null);
      current = record?.key && meta.salt && record.salt === meta.salt
        ? { salt: record.salt, iterations: record.iterations, check: record.check, key: record.key }
        : null;
      return current;
    },
    current: () => current,
    /** Keeps this seal's key here: chosen on this device, or opened with the passphrase of another's. */
    async adopt(seal) {
      current = { salt: seal.salt, iterations: seal.iterations, check: seal.check, key: seal.key };
      const kept = await keyStore?.save?.({ ...current, savedAt: now().toISOString() }).catch(() => false);
      const meta = readMeta();
      writeMeta({ salt: seal.salt, iterations: seal.iterations, sealedSince: meta.sealedSince || now().toISOString(), kept: !!kept, offerDismissedAt: null });
      return !!kept;
    },
    /**
     * Disconnect: the key goes. With another cloud still connected (a switch under way), nothing is forgotten:
     * that one still needs it. With no cloud left (`everything`), nothing of the seal stays on this device:
     * `daily-planner-sync:protection` is removed and the IndexedDB database `daily-planner-sync` deleted, so a
     * later Connect starts as on a new device (asked for the passphrase of a sealed copy, offered to seal a plain one).
     */
    async forget({ everything = false } = {}) {
      current = null;
      await keyStore?.clear?.().catch(() => {});
      if (!everything) {
        writeMeta({ salt: null, iterations: null, kept: null, offerDismissedAt: null });
        return;
      }
      memory = {};
      try { storage?.removeItem(PROTECTION_KEY); } catch {}
      await keyStore?.destroy?.().catch(() => {});
    },
    wasSealed: () => !!readMeta().sealedSince,
    /** The key lives in memory only (no IndexedDB): the passphrase is asked again next time. */
    keptInMemoryOnly: () => !!current && readMeta().kept === false,
    offerDismissed: () => !!readMeta().offerDismissedAt,
    dismissOffer: () => { writeMeta({ offerDismissedAt: now().toISOString() }); },
    createSeal,
    unlockEnvelope
  };
}

/**
 * The provider as the engine sees it (read → { exists, fileId, document, rewrite, copy, nextCopy },
 * write(document)), with the seal in between. `rewrite` asks the engine to write even when no record
 * changed: a copy sealed for the first time, or under a new passphrase.
 *
 * Which copy (1.38): a sealed document carries a random `copyId`, made anew when a copy is first sealed
 * (`copyFrom: 'new'` where there was none, 'continued' when a plain copy from before 1.38 is sealed with
 * its records) and when it is started over ('replaced', the passphrase forgotten); a change of passphrase
 * keeps it. `copy` says what was found ({ cloud, format, id, from }), `nextCopy` what the write carries.
 * The engine compares `copy` with the one its bases were agreed on with (src/sync/ledger.js sameCopy()).
 */
export function createSealedTransport({ provider, protection, newCopyId = () => randomToken(16) }) {
  let last = { format: 'none', version: '', exists: false, fileId: '' };
  let next = null;
  let pending = null;
  let replacing = false;

  async function read() {
    const remote = await provider.readText();
    last = { format: 'none', version: remote?.version || '', exists: !!remote?.exists, fileId: remote?.fileId || '' };
    next = null;
    const current = protection.current();
    const sealing = !!(current || pending);
    const cloud = String(provider.id || '');
    const base = { exists: last.exists, fileId: last.fileId };
    const nothing = { cloud, format: 'none', id: '', from: '' };
    // Starting over (the passphrase forgotten): what is there is never opened, and is written over, as another copy.
    if (replacing) {
      next = { id: newCopyId(), from: 'replaced' };
      return { ...base, document: null, rewrite: true, copy: nothing, nextCopy: next };
    }
    const found = last.exists ? readEnvelope(remote.text) : { format: 'none' };
    if (found.format === 'none') {
      if (!sealing) throw new SyncPassphraseNeededError('create');
      next = { id: newCopyId(), from: 'new' };
      return { ...base, document: null, rewrite: true, copy: nothing, nextCopy: next };
    }
    if (found.format === 'plain') {
      last.format = 'plain';
      if (!sealing && protection.wasSealed()) throw new SyncPassphraseNeededError('create');
      next = sealing ? { id: newCopyId(), from: 'continued' } : null;
      return { ...base, document: found.document, rewrite: sealing, format: 'plain', copy: { cloud, format: 'plain', id: '', from: '' }, nextCopy: next };
    }
    if (found.format === 'sealed') {
      if (found.problem) throw new SyncCopyError(found.problem);
      const envelope = found.envelope;
      if (!current || current.salt !== envelope.salt) throw new SyncPassphraseNeededError(current ? 'changed' : 'enter', envelope);
      let document = null;
      try { document = JSON.parse(await openEnvelope(envelope, current.key)); } catch { throw new SyncCopyError('damaged'); }
      last.format = 'sealed';
      const id = typeof document?.copyId === 'string' ? document.copyId : '';
      const from = typeof document?.copyFrom === 'string' ? document.copyFrom : '';
      // A sealed copy without an id (made before copies had one) gets one at this write, carried on.
      next = id ? { id, from: from || 'new' } : { id: newCopyId(), from: 'continued' };
      return { ...base, document, rewrite: !!pending || !id, format: 'sealed', copy: { cloud, format: 'sealed', id, from }, nextCopy: next };
    }
    throw new SyncCopyError('unreadable');
  }

  async function write(document, { fileId = '' } = {}) {
    const seal = pending || protection.current();
    const options = { fileId: fileId || last.fileId, version: last.version, exists: last.exists };
    let result;
    if (!seal) {
      // Plain only over a plain copy, by a device that never sealed one.
      if (last.format !== 'plain' || protection.wasSealed()) throw new SyncPassphraseNeededError('create');
      result = await provider.writeText(JSON.stringify(document), { ...options, contentType: 'application/json; charset=UTF-8' });
    } else {
      next ||= { id: newCopyId(), from: 'new' };
      const body = { ...document, copyId: next.id, copyFrom: next.from };
      // A plain copy sealed for the first time goes into a file of its own, and the plain one is then deleted, so
      // no earlier revision of it stays in the cloud's history (./google-drive.js).
      const supersede = last.format === 'plain';
      result = await provider.writeText(await sealText(JSON.stringify(body), seal), { ...options, contentType: 'text/plain; charset=UTF-8', supersede });
      last.format = 'sealed';
    }
    last = { ...last, version: result?.version || '', exists: true, fileId: result?.id || options.fileId };
    return result;
  }

  return {
    read,
    write,
    /** What the last read found: 'none', 'plain' or 'sealed'. */
    get format() { return last.format; },
    /** The next sync writes under this seal (a new passphrase); `replace`: without opening what is there. */
    rekey(seal, { replace = false } = {}) { pending = seal; replacing = replace; },
    clearRekey() { pending = null; replacing = false; }
  };
}
