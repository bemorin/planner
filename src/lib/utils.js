/** Small runtime primitives shared by application and state modules. */
export function uid(prefix = 'id') {
  if (globalThis.crypto?.randomUUID) return `${prefix}-${globalThis.crypto.randomUUID()}`;
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
