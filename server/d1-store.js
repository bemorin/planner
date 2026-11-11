// Cloudflare D1 implementation of the planner API store.
// Schema: migrations/schema.sql (a fresh install). A database made by the
// numbered migrations of earlier releases holds these tables too, with the same
// columns or more, and some this code no longer reads: it never touches them.
// The rate-limit tables answer "no such table" until the schema is applied:
// then no durable limit counts (server/rate-limit.js lets every request
// through), and so do the others (the router answers 503, or the dashboard
// says which part is missing).
// Questions from the Contact page are kept in team_requests, the name the
// table keeps from the releases that also took team orders: company, team_size
// and timing stay empty for a question ('', 0, ''), as those columns can't be
// NULL in a database made before 1.39.
// Every value goes through bound parameters (D1 allows at most 100 per query,
// so id lists are deleted in chunks).

const waitlistColumns = 'id, email, devices, note, locale, app_version AS appVersion, drive_seen AS driveSeen, created_at AS createdAt';
const feedbackColumns = 'id, app_version AS appVersion, rating, kind, message, email, platform, created_at AS createdAt';
const questionColumns = 'id, email, name, company, team_size AS teamSize, kind, message, locale, app_version AS appVersion, source, created_at AS createdAt';
const reviewColumns = 'id, app_version AS appVersion, rating, text, name, created_at AS createdAt';
const ID_CHUNK = 90;

export function createD1Store(db) {
  const all = async (sql, ...params) => (await db.prepare(sql).bind(...params).all()).results || [];
  const run = async (sql, ...params) => Number((await db.prepare(sql).bind(...params).run()).meta?.changes) || 0;
  const questionRow = row => ({ ...row, name: row.name || '', company: row.company || '', teamSize: Number(row.teamSize) || 0, kind: row.kind || 'question' });
  return {
    // Rate limits (server/rate-limit.js): requests per hashed connection, bucket and window.
    /** One more request in a bucket's window: answers the window's count, this one included. */
    rateLimitHit: ({ key, bucket, windowStart, expiresAt }) => all('INSERT INTO rate_limits (client_key, bucket, window_start, count, expires_at) VALUES (?, ?, ?, 1, ?) ON CONFLICT(client_key, bucket, window_start) DO UPDATE SET count = count + 1 RETURNING count',
      key, bucket, windowStart, expiresAt).then(([row]) => Number(row?.count) || 0),
    /** The requests of a bucket that still count at `now`, and when the last of them stops counting (ms). */
    rateLimitCount: ({ key, bucket, now }) => all('SELECT COALESCE(SUM(count), 0) AS count, COALESCE(MAX(expires_at), 0) AS until FROM rate_limits WHERE client_key = ? AND bucket = ? AND expires_at > ?', key, bucket, now)
      .then(([row]) => ({ count: Number(row?.count) || 0, until: Number(row?.until) || 0 })),
    rateLimitClear: ({ key, buckets }) => (buckets.length ? run(`DELETE FROM rate_limits WHERE client_key = ? AND bucket IN (${buckets.map(() => '?').join(', ')})`, key, ...buckets) : 0),
    /** Deletes up to `limit` rows that stopped counting. Answers how many went. */
    pruneRateLimits: ({ now, limit = 500 }) => run('DELETE FROM rate_limits WHERE rowid IN (SELECT rowid FROM rate_limits WHERE expires_at <= ? LIMIT ?)', now, limit),
    /** The salt of a UTC day (server/rate-limit.js), or null. */
    getRateLimitSalt: day => all('SELECT salt FROM rate_limit_salts WHERE day = ?', day).then(([row]) => (row?.salt ? String(row.salt) : null)),
    /** False when the day has one already (another isolate wrote it first). */
    addRateLimitSalt: async ({ day, salt, createdAt }) => await run('INSERT INTO rate_limit_salts (day, salt, created_at) VALUES (?, ?, ?) ON CONFLICT(day) DO NOTHING', day, salt, createdAt) > 0,
    deleteRateLimitSalts: ({ beforeDay }) => run('DELETE FROM rate_limit_salts WHERE day < ?', beforeDay),
    // Reports of the security headers: counts per day, directive, blocked origin and page.
    addCspReport: ({ day, directive, blocked, page }) => run('INSERT INTO csp_reports (day, directive, blocked, page, count) VALUES (?, ?, ?, ?, 1) ON CONFLICT(day, directive, blocked, page) DO UPDATE SET count = count + 1', day, directive, blocked, page),
    /** The counts from `fromDay` on, summed over the days: [{ directive, blocked, page, count, lastDay }], most first. */
    listCspReports: ({ fromDay, limit = 50 }) => all('SELECT directive, blocked, page, SUM(count) AS count, MAX(day) AS lastDay FROM csp_reports WHERE day >= ? GROUP BY directive, blocked, page ORDER BY count DESC, directive, blocked, page LIMIT ?', fromDay, limit)
      .then(rows => rows.map(row => ({ directive: String(row.directive), blocked: String(row.blocked), page: String(row.page), count: Number(row.count) || 0, lastDay: String(row.lastDay) }))),
    pruneCspReports: ({ beforeDay, limit = 500 }) => run('DELETE FROM csp_reports WHERE rowid IN (SELECT rowid FROM csp_reports WHERE day < ? LIMIT ?)', beforeDay, limit),
    // Reviews: feedback its author agreed may be quoted.
    async addReview(entry) {
      await run('INSERT INTO reviews (app_version, rating, text, name, created_at) VALUES (?, ?, ?, ?, ?)', entry.appVersion, entry.rating, entry.text, entry.name || '', entry.createdAt);
    },
    listReviews: ({ limit = 50 } = {}) => all(`SELECT ${reviewColumns} FROM reviews ORDER BY created_at DESC, id DESC LIMIT ?`, limit),
    deleteReview: async id => await run('DELETE FROM reviews WHERE id = ?', id) > 0,
    /** Counts per day and name between two UTC days (both included), summed across app versions; internal rows left out. */
    eventsSeries: (fromDay, toDay) => all("SELECT day, name, SUM(count) AS count FROM events WHERE day >= ? AND day <= ? AND name NOT LIKE 'internal:%' GROUP BY day, name ORDER BY day, name", fromDay, toDay)
      .then(rows => rows.map(row => ({ day: row.day, name: row.name, count: Number(row.count) || 0 }))),
    async countEvent(day, name, appVersion) {
      await db.prepare('INSERT INTO events (day, name, app_version, count) VALUES (?, ?, ?, 1) ON CONFLICT(day, name, app_version) DO UPDATE SET count = count + 1')
        .bind(day, name, appVersion).run();
    },
    /** The anonymous counts recorded so far, internal rows left out: { rows, count, firstDay, lastDay } ('' without any). */
    eventsOverview: () => all("SELECT COUNT(*) AS rowCount, COALESCE(SUM(count), 0) AS total, MIN(day) AS firstDay, MAX(day) AS lastDay FROM events WHERE name NOT LIKE 'internal:%'")
      .then(([row]) => ({ rows: Number(row?.rowCount) || 0, count: Number(row?.total) || 0, firstDay: String(row?.firstDay || ''), lastDay: String(row?.lastDay || '') })),
    /** Deletes every anonymous count; internal rows (the day's email tally) stay. Answers how many rows went. */
    deleteEvents: () => run("DELETE FROM events WHERE name NOT LIKE 'internal:%'"),
    async addWaitlist(entry) {
      const result = await db.prepare('INSERT INTO waitlist (email, devices, note, locale, app_version, drive_seen, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(email) DO NOTHING')
        .bind(entry.email, entry.devices, entry.note, entry.locale, entry.appVersion, entry.driveSeen, entry.createdAt).run();
      return { duplicate: !(result.meta?.changes > 0) };
    },
    async addFeedback(entry) {
      await db.prepare('INSERT INTO feedback (app_version, rating, kind, message, email, platform, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind(entry.appVersion, entry.rating, entry.kind, entry.message, entry.email, entry.platform, entry.createdAt).run();
    },
    // Questions (team_requests, see above): the company, team size and timing of a question are empty.
    async addQuestion(entry) {
      await run("INSERT INTO team_requests (email, name, company, team_size, timing, kind, message, locale, app_version, source, created_at) VALUES (?, ?, '', 0, '', 'question', ?, ?, ?, ?, ?)",
        entry.email, entry.name || '', entry.message, entry.locale || '', entry.appVersion || '', entry.source || 'contact', entry.createdAt);
    },
    listQuestions: ({ limit = 0 } = {}) => all(`SELECT ${questionColumns} FROM team_requests ORDER BY created_at DESC, id DESC${limit ? ' LIMIT ?' : ''}`, ...(limit ? [limit] : [])).then(rows => rows.map(questionRow)),
    questionCount: () => all('SELECT COUNT(*) AS count FROM team_requests').then(([row]) => Number(row?.count) || 0),
    deleteQuestion: async id => await run('DELETE FROM team_requests WHERE id = ?', id) > 0,
    eventTotals: ({ sinceDay }) => all('SELECT name, app_version AS appVersion, SUM(count) AS count FROM events WHERE day >= ? GROUP BY name, app_version ORDER BY name, app_version DESC', sinceDay),
    eventDaily: ({ sinceDay }) => all('SELECT day, name, SUM(count) AS count FROM events WHERE day >= ? GROUP BY day, name ORDER BY day, name', sinceDay),
    listWaitlist: () => all(`SELECT ${waitlistColumns} FROM waitlist ORDER BY created_at DESC, id DESC`),
    async deleteWaitlist(id) {
      const result = await db.prepare('DELETE FROM waitlist WHERE id = ?').bind(id).run();
      return result.meta?.changes > 0;
    },
    async deleteWaitlistByEmail(email) {
      const result = await db.prepare('DELETE FROM waitlist WHERE email = ?').bind(email).run();
      return result.meta?.changes > 0;
    },
    /** Oldest sign-ups first: the order a capped announcement goes out in. */
    oldestWaitlist: limit => all(`SELECT ${waitlistColumns} FROM waitlist ORDER BY created_at ASC, id ASC LIMIT ?`, limit),
    countWaitlist: () => all('SELECT COUNT(*) AS count FROM waitlist').then(([row]) => Number(row?.count) || 0),
    async deleteWaitlistIds(ids) {
      let removed = 0;
      for (let start = 0; start < ids.length; start += ID_CHUNK) {
        const chunk = ids.slice(start, start + ID_CHUNK);
        const result = await db.prepare(`DELETE FROM waitlist WHERE id IN (${chunk.map(() => '?').join(', ')})`).bind(...chunk).run();
        removed += Number(result.meta?.changes) || 0;
      }
      return removed;
    },
    /** Emails sent on a UTC day, kept as an internal row of the counts table. */
    async addEmailSends(day, name, count) {
      await db.prepare('INSERT INTO events (day, name, app_version, count) VALUES (?, ?, ?, ?) ON CONFLICT(day, name, app_version) DO UPDATE SET count = count + excluded.count')
        .bind(day, name, '', count).run();
    },
    emailSendsOn: (day, name) => all('SELECT COALESCE(SUM(count), 0) AS count FROM events WHERE day = ? AND name = ?', day, name).then(([row]) => Number(row?.count) || 0),
    async deleteFeedback(id) {
      const result = await db.prepare('DELETE FROM feedback WHERE id = ?').bind(id).run();
      return result.meta?.changes > 0;
    },
    listFeedback: ({ version = '', limit = 100 } = {}) => version
      ? all(`SELECT ${feedbackColumns} FROM feedback WHERE app_version = ? ORDER BY created_at DESC, id DESC LIMIT ?`, version, limit)
      : all(`SELECT ${feedbackColumns} FROM feedback ORDER BY created_at DESC, id DESC LIMIT ?`, limit),
    feedbackByVersion: () => all('SELECT app_version AS appVersion, COUNT(*) AS count, COUNT(rating) AS rated, ROUND(AVG(rating), 2) AS avgRating, MAX(created_at) AS lastAt FROM feedback GROUP BY app_version')
      .then(rows => rows.sort((a, b) => String(b.appVersion).localeCompare(String(a.appVersion), undefined, { numeric: true })))
  };
}
