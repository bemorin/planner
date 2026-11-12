import { decideRecordSync } from './merge.js';
import { createSyncDocument, documentRecord, localSyncRecords, normalizeSyncDocument, syncedRecords } from './document.js';
import { sameCopy } from './ledger.js';
import { recordIdToPlannerKey } from './records.js';

function allRecordIds(localRecords, remoteRecords, ledger) {
  return [...new Set([
    ...Object.keys(localRecords || {}),
    ...Object.keys(remoteRecords || {}),
    ...Object.keys(ledger.read().records || {})
  ])].sort();
}

/**
 * One sync: read the copy, merge record by record (./merge.js), apply what comes from the copy, write what goes to it.
 *
 * - Another copy than the one the bases were agreed on with (1.38: its `copyId`, ./protection.js and ./ledger.js
 *   sameCopy()): the bases are reset first, as for a switch of cloud, so everything that differs stops as a
 *   conflict the person settles, and what is the same on both sides is simply agreed on. A copy started over
 *   elsewhere (“Forgot it?”) can then never overwrite this device's days silently.
 * - What is pulled is applied, and agreed on in the ledger, before the write: when the write is refused (another
 *   device wrote meanwhile) and the sync runs again, those records are not taken for local changes. The error
 *   then carries `pulled`, so the planner can draw them.
 * - A pulled record this browser refuses to store (storage full) stays un-applied and is pulled again next time;
 *   the result (or the error) lists it in `refused`.
 * - `movedTo` (1.38, “Switch to Dropbox”): kept from the copy unless given ('' clears it); `applyPulls: false`
 *   writes the copy without changing this device's planner (the marker written into the cloud left behind).
 * - The ledger is read once per sync, as it starts (ledger.session(), 1.39.4), and what the sync agrees on is
 *   written in one go: the pulls applied, before the copy is written; what was sent, once it is. With years of
 *   history that is the difference between a fraction of a second and minutes.
 */
export function createSyncEngine({ store, ledger, recoveryStore = null, now = () => new Date() } = {}) {
  if (!store || !ledger) throw new Error('Sync engine requires store and ledger.');

  async function snapshot(reason, buildBackup) {
    if (!recoveryStore || typeof buildBackup !== 'function') return null;
    try { return await recoveryStore.save(buildBackup(), reason); } catch { return null; }
  }

  async function sync(provider, { buildBackup, beforeApply, afterApply, conflictResolution = null, movedTo, applyPulls = true } = {}) {
    if (!provider?.read || !provider?.write) throw new Error('Sync provider is not configured.');
    const remotePayload = await provider.read();
    const marks = ledger.session();
    // Which copy this is (sealed transports say; a bare provider doesn't, and is taken as the same copy).
    const copy = remotePayload?.copy || null;
    let copyChanged = false;
    if (copy && copy.format !== 'none' && !sameCopy(marks.copy(), copy)) {
      marks.resetBases({ cloud: copy.cloud, id: copy.id });
      copyChanged = true;
    }
    const localRecords = await localSyncRecords(store, marks);
    const remoteDocument = normalizeSyncDocument(remotePayload?.document);
    // What the copy holds stays as it is unless this device sends a record; what is compared and applied is the
    // record as it syncs (the settings without the fields of the paid add-on of earlier releases: ./records.js).
    const remoteKept = remoteDocument.records || {};
    const remoteRecords = await syncedRecords(remoteKept);
    const remoteMovedTo = typeof remoteDocument.movedTo === 'string' ? remoteDocument.movedTo : '';
    const nextMovedTo = movedTo === undefined ? remoteMovedTo : String(movedTo || '');
    const nextRemote = { ...remoteKept };
    const conflicts = [];
    const pulled = [];
    const pushed = [];
    const marked = [];

    for (const recordId of allRecordIds(localRecords, remoteRecords, marks)) {
      const localRecord = localRecords[recordId] || null;
      const remoteRecord = remoteRecords[recordId] || null;
      const entry = marks.entry(recordId);
      const lastSyncedHash = entry?.lastSyncedHash || null;
      let decision = decideRecordSync({ localRecord, remoteRecord, lastSyncedHash });

      if (decision.action === 'conflict' && conflictResolution === 'local') decision = { action: 'push-local' };
      if (decision.action === 'conflict' && conflictResolution === 'remote') decision = { action: 'pull-remote' };
      if (decision.action === 'conflict') {
        conflicts.push(recordId);
        continue;
      }

      if (decision.action === 'push-local') {
        if (localRecord) nextRemote[recordId] = documentRecord(localRecord);
        else delete nextRemote[recordId];
        pushed.push(recordId);
        continue;
      }

      if (decision.action === 'pull-remote') {
        pulled.push(recordId);
        continue;
      }

      // The same on both sides already, but noted as changed here (saved again unchanged): settled, nothing to send.
      if (decision.action === 'mark-synced' || (decision.action === 'none' && entry?.dirtyAt)) marked.push(recordId);
    }

    if (conflicts.length) {
      marks.commit();
      await snapshot('sync-conflict', buildBackup);
      return { status: 'conflict', conflicts, pulled: [], pushed: [], copyChanged, movedTo: remoteMovedTo };
    }

    const toApply = applyPulls ? pulled : [];
    if (toApply.length) await snapshot('before-remote-sync', buildBackup);
    if (typeof beforeApply === 'function') await beforeApply({ pulled: toApply, pushed });

    // A record the browser refuses to store (its storage full, 1.39.3) is not applied: its base stays as it was, so
    // this device's older version is never taken for the newer one (and sent over it), and the next sync pulls it
    // again. The result names it in `refused`.
    const refused = [];
    if (toApply.length) {
      store.withoutMutationTracking(() => {
        for (const recordId of toApply) {
          const remoteRecord = remoteRecords[recordId];
          const key = recordIdToPlannerKey(recordId);
          if (!key || !remoteRecord) continue;
          const stored = remoteRecord.deletedAt ? store.remove(key) : store.writeJSON(key, remoteRecord.value);
          if (stored === false) refused.push(recordId);
        }
      });
    }
    const refusedIds = new Set(refused);
    const applied = toApply.filter(recordId => !refusedIds.has(recordId));
    // Agreed on now: this device holds what the copy held. A refused write of the copy below leaves that true, and
    // so does a tab closed while the copy is written: it is stored first.
    for (const recordId of applied) {
      const record = remoteRecords[recordId];
      if (record) marks.markRemoteApplied(recordId, { hash: record.hash, deletedAt: record.deletedAt });
    }
    if (applied.length) marks.commit();

    // `rewrite`: the copy is sealed for the first time or under a new passphrase (./protection.js), so it is written whole.
    const remoteChanged = pushed.length > 0 || !remotePayload?.exists || !!remotePayload?.rewrite || nextMovedTo !== remoteMovedTo;
    if (remoteChanged) {
      const nextDocument = createSyncDocument(nextRemote, { now, movedTo: nextMovedTo });
      try {
        await provider.write(nextDocument, { fileId: remotePayload?.fileId || '' });
      } catch (error) {
        // The bases reset for another copy stand, as they did when they were written at once.
        try { marks.commit(); } catch (_) {}
        if (error && typeof error === 'object' && applied.length) error.pulled = [...applied];
        if (error && typeof error === 'object' && refused.length) error.refused = [...refused];
        throw error;
      }
    }

    for (const recordId of pushed) {
      const record = localRecords[recordId];
      if (record) marks.markSynced(recordId, { hash: record.hash, deletedAt: record.deletedAt });
    }
    for (const recordId of marked) {
      const record = localRecords[recordId] || remoteRecords[recordId];
      if (record) marks.markSynced(recordId, { hash: record.hash, deletedAt: record.deletedAt });
    }
    // The copy these bases now belong to: the one read, or the one just written (a new id when it was first sealed or started over).
    if (copy) {
      const id = remoteChanged ? remotePayload?.nextCopy?.id || '' : copy.id;
      marks.setCopy({ cloud: copy.cloud, id });
    }
    marks.commit();

    if (typeof afterApply === 'function') await afterApply({ pulled: applied, pushed });
    return { status: 'ok', conflicts: [], pulled: applied, pushed, refused, copyChanged, movedTo: nextMovedTo };
  }

  return { sync };
}
