// Rate limits of the owner's routes: the configuration check, the test email
// and “Start fresh”, which deletes the anonymous usage counts. The Pages
// Function builds a new API for every request, so the limits live here, at
// module scope: one set per worker isolate, shared by every request it
// answers. Per isolate and best effort — Cloudflare runs several isolates, and
// its rate limiting rule on /api/ is the real guard. Tests pass their own set
// (createAdminLimits) to createPlannerApi.

const TEN_MINUTES = 10 * 60 * 1000;

export const ADMIN_LIMITS = Object.freeze({
  check: Object.freeze({ limit: 10, windowMs: TEN_MINUTES }),
  testEmail: Object.freeze({ limit: 5, windowMs: TEN_MINUTES }),
  resetCounts: Object.freeze({ limit: 5, windowMs: TEN_MINUTES })
});

/** At most `limit` calls per `windowMs`: answers 0 when allowed, else the seconds to wait. */
export function createRateLimiter({ limit, windowMs, now = () => Date.now() }) {
  let hits = [];
  return () => {
    const time = now();
    hits = hits.filter(hit => time - hit < windowMs);
    if (hits.length >= limit) return Math.max(1, Math.ceil((windowMs - (time - hits[0])) / 1000));
    hits.push(time);
    return 0;
  };
}

/** A set of limiters: { check, testEmail, resetCounts }. */
export function createAdminLimits({ now = () => Date.now(), limits = ADMIN_LIMITS } = {}) {
  return Object.fromEntries(Object.entries(limits).map(([name, value]) => [name, createRateLimiter({ ...value, now })]));
}

/** The isolate's own set: what every request of this worker shares. */
export const sharedAdminLimits = createAdminLimits();

/** “2 minutes”, “40 seconds”: how long to wait, for a message. */
export const waitWords = seconds => (seconds < 60 ? `${seconds} ${seconds === 1 ? 'second' : 'seconds'}` : `${Math.ceil(seconds / 60)} ${Math.ceil(seconds / 60) === 1 ? 'minute' : 'minutes'}`);
