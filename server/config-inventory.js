// Every setting the production deployment reads, as data: the configuration
// page (admin/configuration/, POST /api/admin/config/check in
// server/admin-config.js) checks each one, and docs/configuration.md lists
// them. tests/config-inventory.test.js reads the code and fails when a
// variable is read that isn't listed here, or when one listed here is never read:
//   - build variables: what scripts/build.mjs reads from its environment,
//     baked into the public runtime-config.js (`runtimeKey`);
//   - Functions variables and secrets: what functions/api/[[path]].js reads;
//   - the D1 binding `DB`.
// One Cloudflare Pages project, one production deployment: preview
// deployments use the project's Preview variables (open the page there to
// check them). Nothing here is a value: names, where they are set, what they
// unlock and how they look.
//
// level: required (a core promise breaks without it: the API and its
// dashboard), recommended (works without it, but something people see or you
// need is missing), optional (blank is a sound default).
// format: how server/admin-config.js recognises a value (never shown).
// generate: a value no service provides, made in the browser on the page.

export const CLOUDFLARE = Object.freeze({
  variables: 'Cloudflare → Workers & Pages → your Pages project → Settings → Variables and Secrets',
  bindings: 'Cloudflare → Workers & Pages → your Pages project → Settings → Bindings',
  redeploy: 'Cloudflare → Workers & Pages → your Pages project → Deployments → the latest production deployment → ⋯ → Retry deployment',
  d1Console: 'Cloudflare → Storage & Databases → D1 SQLite Database → daily-planner → Console',
  d1Name: 'daily-planner'
});

/**
 * PUBLIC_BASE_URL's default: the address of the deployment this project
 * started on. A copy of the planner on another address sets PUBLIC_BASE_URL.
 */
export const DEFAULT_PUBLIC_BASE_URL = 'https://planner.bemorin.com';

/** An http(s) address as PUBLIC_BASE_URL is read: its origin and path, no trailing slash; '' when it isn't one. */
export function normalizeBaseUrl(value) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  try {
    const url = new URL(text);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return '';
    return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
  } catch {
    return '';
  }
}

/** The groups of the page, in its order. */
export const CONFIG_GROUPS = Object.freeze([
  Object.freeze({ id: 'build', title: 'Cloudflare Pages — build variables', text: 'Read by scripts/build.mjs while the site is built, and written into the public runtime-config.js: plain text, never a secret. A change counts only after a new deployment.' }),
  Object.freeze({ id: 'functions', title: 'Functions — secrets and variables', text: 'Read by the API (functions/api/[[path]].js) on each request, from the same Variables and Secrets of the Pages project.' }),
  Object.freeze({ id: 'database', title: 'D1 database', text: 'The API’s data, bound as DB. D1 has no extensions and this app has no scheduled jobs (no cron trigger) or private settings in the database, so there is nothing else to check there.' }),
  Object.freeze({ id: 'security', title: 'Security headers', text: 'What browsers blocked under the site’s Content-Security-Policy (the security block at the top of _headers), as they report it to /api/csp-report: daily counts of the directive, what was blocked and the page, nothing about visitors.' }),
  Object.freeze({ id: 'resend', title: 'Resend', text: 'Email: the API key, the sender’s domain and where notifications go.' }),
  Object.freeze({ id: 'legal', title: 'Legal pages', text: 'Build variables shown on the legal pages and the Contact page.' })
]);

const v = fields => Object.freeze(fields);

/** Every production setting. `where`: build (scripts/build.mjs), runtime (the Functions) or binding. */
export const CONFIG_VARIABLES = Object.freeze([
  // ---- Build variables -------------------------------------------------------
  v({ name: 'DAILY_PLANNER_API_URL', where: 'build', runtimeKey: 'PLANNER_API_URL', group: 'build', level: 'required', secret: false, type: 'Text', format: 'api-url',
    source: 'Always /api.', unlocks: 'The planner and the public pages talk to this API: feedback, questions, the waitlist, counts and the privacy notices.', blocks: 'Without it the planner never calls the API: no feedback, question or count is sent, and the dashboard has nothing to show.' }),
  v({ name: 'DAILY_PLANNER_GOOGLE_CLIENT_ID', where: 'build', runtimeKey: 'GOOGLE_CLIENT_ID', group: 'build', level: 'optional', secret: false, type: 'Text', format: 'google-client-id',
    source: 'Google Cloud → APIs & Services → Credentials → OAuth client ID (Web application).', unlocks: 'Personal sync through the person’s own Google Drive.', blocks: 'Blank: Personal sync offers no Google Drive and no Google request is made (with no Dropbox key either, it shows nothing).' }),
  v({ name: 'DAILY_PLANNER_DROPBOX_APP_KEY', where: 'build', runtimeKey: 'DROPBOX_APP_KEY', group: 'build', level: 'optional', secret: false, type: 'Text', format: 'dropbox-app-key',
    source: 'Dropbox App Console (dropbox.com/developers/apps) → your app → Settings → App key: the App key, not the App secret: the planner never uses the secret. Public, like the Google client ID.', unlocks: 'Personal sync through the person’s own Dropbox, in its Apps folder.', blocks: 'Blank: Personal sync offers no Dropbox and no Dropbox request is made.' }),
  v({ name: 'DAILY_PLANNER_CLOUD_API_URL', where: 'build', runtimeKey: 'CLOUD_API_URL', group: 'build', level: 'optional', secret: false, type: 'Text', format: 'url-or-path',
    source: 'The address of a private workspace service (none exists yet).', unlocks: 'Company workspaces in the planner.', blocks: 'Blank: the planner stays local-first; nothing is missing.' }),
  v({ name: 'DAILY_PLANNER_GITHUB_URL', where: 'build', runtimeKey: 'PROJECT_GITHUB_URL', group: 'build', level: 'optional', secret: false, type: 'Text', format: 'url',
    source: 'The project’s public repository (https://github.com/…).', unlocks: 'The source code link in the planner and the public pages; while the API is off, the feedback dialog links there too (its /issues/new). This page links to its guide there.', blocks: 'Blank: the link is hidden.' }),
  v({ name: 'DAILY_PLANNER_SPONSOR_URL', where: 'build', runtimeKey: 'GITHUB_SPONSOR_URL', group: 'build', level: 'optional', secret: false, type: 'Text', format: 'url',
    source: 'Your GitHub Sponsors page (https://github.com/sponsors/…).', unlocks: 'Sponsor on GitHub in How it works and on the public pages, and the sponsor moment once ten days are closed.', blocks: 'Blank: none of them is shown.' }),
  v({ name: 'DAILY_PLANNER_X_URL', where: 'build', runtimeKey: 'SOCIAL_X_URL', group: 'build', level: 'optional', secret: false, type: 'Text', format: 'url',
    source: 'Your X profile (https://…).', unlocks: 'The X link in the footers.', blocks: 'Blank: the link is hidden.' }),
  v({ name: 'DAILY_PLANNER_LINKEDIN_URL', where: 'build', runtimeKey: 'SOCIAL_LINKEDIN_URL', group: 'build', level: 'optional', secret: false, type: 'Text', format: 'url',
    source: 'Your LinkedIn page (https://…).', unlocks: 'The LinkedIn link in the footers.', blocks: 'Blank: the link is hidden.' }),

  // ---- Functions ---------------------------------------------------------------
  v({ name: 'ADMIN_TOKEN', where: 'runtime', group: 'functions', level: 'required', secret: true, type: 'Secret', format: 'admin-token', generate: 'token',
    source: 'Generate a value here, or run npm run admin:secret.', unlocks: 'Signing in to the dashboard and this page; people leaving the waitlist on their own; the key of the abuse limits’ scrambled addresses.', blocks: 'Without it every admin route answers 503 and nobody can leave the waitlist from the app. A short token can be guessed. Changing it signs every session out and changes every waitlist removal link.' }),
  v({ name: 'ADMIN_TOTP_SECRET', where: 'runtime', group: 'functions', level: 'recommended', secret: true, type: 'Secret', format: 'totp', generate: 'totp',
    source: 'Generate a value here (or npm run admin:secret), then add it to your authenticator app with “Enter a setup key”.', unlocks: 'An authenticator code at sign-in, on top of the token.', blocks: 'Without it the token alone opens the dashboard. A value that isn’t base32 locks every admin route (503).' }),
  v({ name: 'PUBLIC_BASE_URL', where: 'runtime', group: 'functions', level: 'optional', secret: false, type: 'Text', format: 'base-url',
    source: 'The production address, e.g. https://planner.example.com.', unlocks: 'The site’s own address: pages opened there may call the API, and this page tells production from a preview by it.', blocks: `Blank: ${DEFAULT_PUBLIC_BASE_URL} is taken as the production address. Set it on any other deployment.` }),
  v({ name: 'ALLOWED_ORIGINS', where: 'runtime', group: 'functions', level: 'optional', secret: false, type: 'Text', format: 'origins',
    source: 'Comma-separated origins, e.g. https://example.com (no path, no trailing slash).', unlocks: 'Other sites calling the API from a browser (CORS).', blocks: 'Blank: only this site calls the API, which is all the planner needs.' }),

  // ---- D1 ------------------------------------------------------------------------
  v({ name: 'DB', where: 'binding', group: 'database', level: 'required', secret: false, type: 'D1 database binding', format: 'd1',
    source: 'The D1 database daily-planner, bound with the variable name DB.', unlocks: 'Every /api request: counts, forms, the dashboard.', blocks: 'Without it every /api request answers 503.' }),

  // ---- Resend ------------------------------------------------------------------
  v({ name: 'RESEND_API_KEY', where: 'runtime', group: 'resend', level: 'recommended', secret: true, type: 'Secret', format: 'resend-key',
    source: 'Resend → API Keys → Create API key (Sending access is enough).', unlocks: 'Every email: question notifications, the waitlist announcement and test emails.', blocks: 'Without a valid key nothing is emailed.' }),
  v({ name: 'EMAIL_FROM', where: 'runtime', group: 'resend', level: 'recommended', secret: false, type: 'Text', format: 'sender',
    source: 'The sender, e.g. Daily Planner <hello@yourdomain.com>, on a domain verified in Resend.', unlocks: 'The sender of every email.', blocks: 'Without a valid address on a verified domain nothing is emailed.' }),
  v({ name: 'OWNER_EMAIL', where: 'runtime', group: 'resend', level: 'recommended', secret: false, type: 'Text', format: 'email',
    source: 'Your own inbox.', unlocks: 'Question notifications and test sends.', blocks: 'Without it you aren’t notified of questions, and no test email can be sent.' }),
  v({ name: 'EMAIL_DAILY_LIMIT', where: 'runtime', group: 'resend', level: 'optional', secret: false, type: 'Text', format: 'count',
    source: 'Your Resend plan’s daily limit, a whole number.', unlocks: 'Caps the emails sent per UTC day.', blocks: 'Blank: 100 a day (Resend’s free plan).' }),

  // ---- Legal pages -------------------------------------------------------------
  v({ name: 'DAILY_PLANNER_SUPPORT_EMAIL', where: 'build', runtimeKey: 'SUPPORT_EMAIL', group: 'legal', level: 'recommended', secret: false, type: 'Text', format: 'legal-email',
    source: 'An address on your own domain, e.g. support@yourdomain.com.', unlocks: 'The contact address of the legal notice, the terms and the Contact page (and privacy questions, without a privacy address).', blocks: 'Without a plain address, the legal pages and the Contact page point to the question form instead of an email address.' }),
  v({ name: 'DAILY_PLANNER_PRIVACY_EMAIL', where: 'build', runtimeKey: 'PRIVACY_EMAIL', group: 'legal', level: 'optional', secret: false, type: 'Text', format: 'legal-email',
    source: 'An address for privacy questions, e.g. privacy@yourdomain.com.', unlocks: 'The privacy policy’s and the cookies page’s contact.', blocks: 'Blank: the support address is used.' }),
  v({ name: 'DAILY_PLANNER_LEGAL_PHONE', where: 'build', runtimeKey: 'LEGAL_PHONE', group: 'legal', level: 'recommended', secret: false, type: 'Text', format: 'phone',
    source: 'Your number in international form: + and the country code, then the number without its leading 0, e.g. +33199001234.', unlocks: 'The Phone row of the legal notice (French law asks an individual publisher for one).', blocks: 'Without it the legal notice has no Phone row, which French law asks an individual publisher for.' }),
  v({ name: 'DAILY_PLANNER_LEGAL_ADDRESS', where: 'build', runtimeKey: 'LEGAL_ADDRESS', group: 'legal', level: 'recommended', secret: false, type: 'Text', format: 'text',
    source: 'Your postal address, on one line.', unlocks: 'The Address row of the legal notice and the privacy policy (French law asks for it).', blocks: 'Without it the legal notice and the privacy policy have no Address row, which French law asks for.' }),
  v({ name: 'DAILY_PLANNER_LEGAL_REGISTRATION', where: 'build', runtimeKey: 'LEGAL_REGISTRATION', group: 'legal', level: 'optional', secret: false, type: 'Text', format: 'text',
    source: 'A registration or VAT number, e.g. SIRET 123 456 789 00012.', unlocks: 'A Registration row in the legal notice and the privacy policy.', blocks: 'Blank: no Registration row.' })
]);

/** Bindings Cloudflare Pages gives every Function by itself: never set by hand, never shown as a setting. */
export const PLATFORM_BINDINGS = Object.freeze([
  Object.freeze({ name: 'ASSETS', use: 'The site’s own static files: the checks read the deployed runtime-config.js through it.' })
]);

/**
 * Read on a computer only, by the local tools: never set on Cloudflare.
 * (The dev server, scripts/serve.mjs, also reads the production variables
 * above, so the API behaves locally as in production; scripts/admin-secret.mjs
 * reads ADMIN_TOTP_SECRET.)
 */
export const LOCAL_VARIABLES = Object.freeze([
  Object.freeze({ name: 'PORT', readBy: 'scripts/serve.mjs', use: 'The dev server’s port (8080 by default; --port wins).' }),
  Object.freeze({ name: 'CHROME_BIN', readBy: 'scripts/smoke.mjs', use: 'The Chrome or Chromium the smoke test drives.' }),
  Object.freeze({ name: 'ARCHIVE_SCENARIOS_OLD_REF', readBy: 'scripts/archive-scenarios.mjs', use: 'The git ref of the older planner the archive scenarios open beside this one (655bcc8, 1.39.4, by default).' }),
  Object.freeze({ name: 'ARCHIVE_SCENARIOS_PORT', readBy: 'scripts/archive-scenarios.mjs', use: 'The port the archive scenarios serve this planner on (8800 by default).' }),
  Object.freeze({ name: 'ARCHIVE_SCENARIOS_SECOND_PORT', readBy: 'scripts/archive-scenarios.mjs', use: 'The port of the archive scenarios’ second address, 127.0.0.2 (8801 by default).' }),
  Object.freeze({ name: 'PROGRAMFILES', readBy: 'scripts/smoke.mjs', use: 'Windows: where the smoke test looks for Chrome.' }),
  Object.freeze({ name: 'PROGRAMFILES(X86)', readBy: 'scripts/smoke.mjs', use: 'Windows: where the smoke test looks for Chrome.' })
]);

export const configVariable = name => CONFIG_VARIABLES.find(entry => entry.name === name) || null;

/**
 * A check that is no setting: the Security headers group's reports of the
 * Content-Security-Policy (server/csp-reports.js, table csp_reports).
 */
export const CONFIG_CHECKS = Object.freeze([
  Object.freeze({
    id: 'csp-reports',
    name: '_headers · Content-Security-Policy',
    group: 'security',
    level: 'recommended',
    where: 'site',
    type: 'Reports from browsers',
    source: 'The security block at the top of _headers; browsers send what it blocked to /api/csp-report (report-uri and report-to).',
    unlocks: 'Pages that run only this site’s scripts, Google’s sign-in and Cloudflare Web Analytics: anything else is blocked, and reported here.',
    blocks: 'Something on the site was blocked: a script, a style, a request or a frame from an address the policy doesn’t list.',
    test: 'What browsers reported as blocked in the last 7 days (table csp_reports).'
  })
]);

/**
 * The database schema, as migrations/schema.sql holds it without its comment
 * (the D1 console takes it as it is). tests/config-inventory.test.js checks
 * it matches the file; the configuration page checks the database has every
 * table, column and index it creates, and offers its SQL to paste. A database
 * made by the numbered migrations of earlier releases has them all.
 */
export const MIGRATIONS = Object.freeze([
  Object.freeze({
    file: 'schema.sql',
    unlocks: 'Anonymous counts, the waitlist, feedback and reviews, questions from the Contact page, the limits that stop abuse of the forms, counts and sign-in, and the counts of what the security headers blocked: the dashboard and every form need it.',
    sql: `CREATE TABLE IF NOT EXISTS events (
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
);`
  })
]);
