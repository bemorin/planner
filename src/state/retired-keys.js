/**
 * What earlier releases kept on this device for a paid add-on that no longer
 * exists (until 1.38): everything it offered is part of the planner since
 * 1.39, for everyone. app.js removes these quietly as it starts. Nothing
 * writes them any more, so after the first start there is nothing left to
 * remove and nothing is written.
 *
 * - RETIRED_KEYS: whole storage keys, outside the `daily-planner:` namespace
 *   (never synced or backed up): a verified licence, the weekly check and its
 *   revoked list, a purchase or a gift left pending, the currency of prices,
 *   a referral code and its hints, and the payment window's own code. Only
 *   these are removed as the planner starts.
 * - RETIRED_SETTINGS: fields of the planner settings that held the licence
 *   and the gift it came from. The settings are never rewritten for them as
 *   the planner starts: that would be a change to sync, and a second device
 *   would meet it as a conflict. Settings normalisation ignores them, so they
 *   go with the next real save of the settings; a backup leaves them out
 *   before it is written or imported, and sync compares and sends the
 *   settings without them (src/sync/records.js syncedValue()).
 *
 * Palettes, Horizon, misogi, quarter check-ins and every other setting are
 * kept exactly as they are.
 */

export const RETIRED_KEYS = Object.freeze([
  'daily-planner-ui:plus-verified',
  'daily-planner-ui:plus-checked',
  'daily-planner-ui:plus-pending-purchase',
  'daily-planner-ui:plus-unverified-gift',
  'daily-planner-ui:currency',
  'daily-planner-ui:ref',
  'daily-planner-ui:partner-hints',
  'creem_ref'
]);

export const RETIRED_SETTINGS = Object.freeze(['plus', 'plusGift']);

const isRecord = value => !!value && typeof value === 'object' && !Array.isArray(value);

/** True when a settings object still carries a retired field. */
export const hasRetiredSettings = settings => isRecord(settings) && RETIRED_SETTINGS.some(field => Object.prototype.hasOwnProperty.call(settings, field));

/** The settings without the retired fields: the same object when there are none, else a copy. */
export function withoutRetiredSettings(settings) {
  if (!hasRetiredSettings(settings)) return settings;
  const copy = { ...settings };
  RETIRED_SETTINGS.forEach(field => { delete copy[field]; });
  return copy;
}

/** Removes RETIRED_KEYS from `storage`, and only those. Never throws. Returns the keys it removed. */
export function forgetRetiredData(storage) {
  const removed = [];
  RETIRED_KEYS.forEach(key => {
    try {
      if (storage?.getItem(key) === null) return;
      storage.removeItem(key);
      removed.push(key);
    } catch (_) {}
  });
  return removed;
}
