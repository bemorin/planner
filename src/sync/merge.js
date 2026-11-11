function hashOf(record) {
  return record?.hash || null;
}

/**
 * The base to compare with. Bases agreed on before 1.39 were made from the settings with the fields of the paid add-on
 * still in them; records now compare without them (./document.js), and carry `storedHash`, the hash of the form they
 * are kept in, when it differs. A side still kept exactly as agreed is unchanged, so the base stands for its hash
 * without those fields: a device that keeps them and one that has dropped them agree, and only a real change counts.
 */
export function agreedBase({ localRecord, remoteRecord, lastSyncedHash }) {
  const base = lastSyncedHash || null;
  if (!base) return null;
  if (localRecord?.storedHash === base) return hashOf(localRecord);
  if (remoteRecord?.storedHash === base) return hashOf(remoteRecord);
  return base;
}

export function decideRecordSync({ localRecord, remoteRecord, lastSyncedHash }) {
  const localHash = hashOf(localRecord);
  const remoteHash = hashOf(remoteRecord);
  const base = agreedBase({ localRecord, remoteRecord, lastSyncedHash });

  if (!localRecord && !remoteRecord) return { action: 'none' };

  if (!base) {
    if (localRecord && !remoteRecord) return { action: 'push-local' };
    if (!localRecord && remoteRecord) return { action: 'pull-remote' };
    if (localHash === remoteHash) return { action: 'mark-synced' };
    return { action: 'conflict' };
  }

  // Agreed on before, and gone from the same copy without a tombstone (a copy made again carries a new
  // copyId, and the engine resets the bases first: ./engine.js). Deletions always leave a tombstone, so
  // this device puts the record back.
  if (localRecord && !remoteRecord) return { action: 'push-local' };

  const localChanged = localHash !== base;
  const remoteChanged = remoteHash !== base;

  if (!localChanged && !remoteChanged) return { action: 'none' };
  if (localChanged && !remoteChanged) return { action: 'push-local' };
  if (!localChanged && remoteChanged) return { action: 'pull-remote' };
  if (localHash === remoteHash) return { action: 'mark-synced' };
  return { action: 'conflict' };
}
