/* Daily Planner owner API (Cloudflare D1): the whole schema of a fresh install.
   Paste into the D1 console as is, or apply it with wrangler d1 execute and this file (the exact command is in
   docs/configuration.md). Safe to run again: it only creates what is missing, and never changes or deletes
   a table that exists, so running it on a database made by an earlier release changes nothing there.
   Block comments only: the D1 console joins all lines into one.
   events: the anonymous counts, (day, event name, app version) to a number, nothing else; also an internal row
   per day for the emails sent (its name starts with internal:, never accepted from a browser).
   waitlist: people who asked to be emailed once when account sync is ready (the email, the devices ticked, an
   optional note); each address is deleted once that email goes out, or when they leave the list.
   feedback: the rating, kind and message someone sent from the planner, with an optional reply email.
   reviews: feedback whose author agreed it may be quoted, with an optional name.
   team_requests: questions from the Contact page (the email, the name and the question). The table keeps the name
   and the company, team_size and timing columns it had when it also took team orders, so a database made before
   1.39 needs nothing new; a question leaves them empty.
   rate_limits: requests counted per connection, to stop abuse of every form, count and the owner's sign-in.
   client_key is a scrambled form of the IP address, never the address itself: an HMAC-SHA256 keyed by the day's
   salt (rate_limit_salts) and a secret of this server; bucket is what is counted and over how long; window_start
   and expires_at bound the counting period, in milliseconds since 1970, at most 24 hours apart. Rows past
   expires_at count for nothing and are deleted a batch at a time as requests come in.
   rate_limit_salts: one random salt per UTC day, made by the first request of the day, which deletes the earlier
   ones: from then on no key of an earlier day can be linked back to an address.
   csp_reports: what the browsers' Content-Security-Policy blocked, as daily counts only: day, directive, blocked
   (the origin, inline or eval: never a full address) and page (its path, without its query). No IP address,
   nothing about the visitor. Kept about 90 days. */
CREATE TABLE IF NOT EXISTS events (
  day TEXT NOT NULL,
  name TEXT NOT NULL,
  app_version TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, name, app_version)
);
CREATE TABLE IF NOT EXISTS waitlist (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL UNIQUE,
  devices TEXT NOT NULL DEFAULT '',
  note TEXT NOT NULL DEFAULT '',
  locale TEXT NOT NULL DEFAULT '',
  app_version TEXT NOT NULL DEFAULT '',
  drive_seen INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  app_version TEXT NOT NULL,
  rating INTEGER,
  kind TEXT NOT NULL DEFAULT 'other',
  message TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  platform TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS feedback_version ON feedback (app_version, created_at);
CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  app_version TEXT NOT NULL,
  rating INTEGER,
  text TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS reviews_created ON reviews (created_at);
CREATE TABLE IF NOT EXISTS team_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '',
  company TEXT NOT NULL DEFAULT '',
  team_size INTEGER NOT NULL DEFAULT 0,
  timing TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL DEFAULT 'question',
  message TEXT NOT NULL DEFAULT '',
  locale TEXT NOT NULL DEFAULT '',
  app_version TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'contact',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS team_requests_created ON team_requests (created_at);
CREATE TABLE IF NOT EXISTS rate_limits (
  client_key TEXT NOT NULL,
  bucket TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (client_key, bucket, window_start)
);
CREATE INDEX IF NOT EXISTS rate_limits_expires ON rate_limits (expires_at);
CREATE TABLE IF NOT EXISTS rate_limit_salts (
  day TEXT PRIMARY KEY,
  salt TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS csp_reports (
  day TEXT NOT NULL,
  directive TEXT NOT NULL,
  blocked TEXT NOT NULL,
  page TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, directive, blocked, page)
);
