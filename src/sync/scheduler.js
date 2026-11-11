/**
 * Batches dirty local changes into opportunistic Drive sync attempts.
 * Does not write to Drive itself — callers supply `sync`.
 */
export function createSyncScheduler({
  idleMs = 50_000,
  maxWaitMs = 120_000,
  isEnabled = () => false,
  isBusy = () => false,
  hasDirty = () => false,
  sync = async () => null,
  now = () => Date.now(),
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout
} = {}) {
  let idleTimer = null;
  let maxTimer = null;
  let dirtySince = null;
  let running = null;

  const clearIdle = () => {
    if (idleTimer != null) clearTimeoutFn(idleTimer);
    idleTimer = null;
  };

  const clearMax = () => {
    if (maxTimer != null) clearTimeoutFn(maxTimer);
    maxTimer = null;
  };

  const clearTimers = () => {
    clearIdle();
    clearMax();
  };

  const markClean = () => {
    dirtySince = null;
    clearTimers();
  };

  async function attempt(reason = 'manual') {
    if (!isEnabled() || isBusy()) return null;
    if (!hasDirty() && reason !== 'startup' && reason !== 'visible' && reason !== 'focus' && reason !== 'online') {
      markClean();
      return null;
    }
    if (running) return running;
    clearTimers();
    running = (async () => {
      try {
        const result = await sync({ interactive: false, reason });
        if (!hasDirty()) markClean();
        else {
          // Still dirty (conflict, auth failure, offline): keep max-wait pressure.
          dirtySince = dirtySince ?? now();
          const elapsed = Math.max(0, now() - dirtySince);
          const remaining = Math.max(5_000, maxWaitMs - elapsed);
          maxTimer = setTimeoutFn(() => { maxTimer = null; attempt('max-wait'); }, remaining);
        }
        return result;
      } catch (error) {
        dirtySince = dirtySince ?? now();
        if (maxTimer == null) {
          const elapsed = Math.max(0, now() - dirtySince);
          const remaining = Math.max(5_000, maxWaitMs - elapsed);
          maxTimer = setTimeoutFn(() => { maxTimer = null; attempt('max-wait'); }, remaining);
        }
        return null;
      } finally {
        running = null;
      }
    })();
    return running;
  }

  function noteLocalChange() {
    if (!isEnabled()) return;
    if (dirtySince == null) dirtySince = now();
    clearIdle();
    idleTimer = setTimeoutFn(() => { idleTimer = null; attempt('idle'); }, idleMs);
    if (maxTimer == null) {
      const elapsed = Math.max(0, now() - dirtySince);
      const remaining = Math.max(0, maxWaitMs - elapsed);
      maxTimer = setTimeoutFn(() => { maxTimer = null; attempt('max-wait'); }, remaining);
    }
  }

  return {
    noteLocalChange,
    attempt,
    markClean,
    clearTimers,
    get dirtySince() { return dirtySince; },
    get idleTimerArmed() { return idleTimer != null; },
    get maxTimerArmed() { return maxTimer != null; }
  };
}
