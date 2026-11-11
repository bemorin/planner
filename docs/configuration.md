# Configuration page

**Admin → Configuration** (`/admin/configuration/`, linked from the dashboard's header and its **Setup** card) checks every production setting for real, so you don't have to reread the setup guide ([FEEDBACK_AND_WAITLIST.md](FEEDBACK_AND_WAITLIST.md)). It uses the dashboard's sign-in: the signed 8-hour session of that tab.

**Check everything** asks the server to try each setting with its own service, read-only. Each call times out after 5 seconds and the calls run side by side (the tables are read after `SELECT 1`), so the whole check takes 10 seconds at most and usually one or two. Nothing is changed anywhere and nothing is stored. A secret's value is never shown, not even in part: only whether it is set, its length and the form recognised (“looks like a Resend key (re_…), 36 characters”; for `ADMIN_TOKEN`, its length and “strong” or “weak”, never what it is made of).

What a service says never brings a secret back (`server/secret-scrub.js`, the one scrubber of every owner route): after a 401 or a 403 none of its words are kept and the page says what happened in its own; otherwise any 4 characters of a secret, any key-shaped token (`re_…`, whatever its length) and masked forms (`re_ab****cd`, `re_…`) are hidden, and a text that would still show one once decoded (URL-encoded, JSON or HTML escapes) is dropped whole. The whole answer is scrubbed again before it leaves the server. Tests (`tests/secret-scrub.test.js`, `tests/admin-config.test.js`, `tests/planner-email.test.js`) try partial echoes — the last 4 characters, a masked key, the prefix alone, a fragment from the middle, URL-encoded and JSON-escaped — and check that no 4 characters of a secret come back.

## Reading it

One row per setting, grouped as on Cloudflare:

| State | Meaning |
| --- | --- |
| **OK** | Set, and its service accepted it (or its form is right, when there's nothing more to test). |
| **Problem** | Set, but wrong: the row says what it blocks and the exact fix. |
| **Warning** | Something to look at that blocks nothing, such as what the security headers blocked lately; the row says what to check. |
| **Missing** | Required or recommended, and not set. |
| **Optional, missing** | Not set, and blank is a sound default (the row says what blank means). |
| **Present, not tested** | Set, but the service gave no usable answer, or offers no read-only test (see below). |

**Fix first**, at the top, lists the problems and missing settings: required ones first, then recommended, then optional, and the warnings last. Each line jumps to its row, where the fix is written out: the exact path in Cloudflare (**Workers & Pages → your Pages project → Settings → Variables and Secrets → Production**), the variable's name and type (*Secret* or *Text*), then **Retry deployment**; for the database, the SQL to paste in the D1 console (or the `wrangler` commands). Copy buttons sit next to every name, address and SQL. The time of the check is shown; check again once a new deployment is live.

**A schema not fully applied.** Running `migrations/schema.sql` again creates what is missing (it is safe to run again) but skips a table that exists. So a missing column comes first:

- A column SQLite can add in place gets its `ALTER TABLE … ADD COLUMN` line (**Missing column**), run *before* the file (whose indexes may need the column).
- A column it can't add to a table that exists — a `PRIMARY KEY`, `UNIQUE`, `NOT NULL` without a default — means rebuilding the table, in two steps that never lose a row: **Rebuild …, 1 of 2** copies every row into a complete new table (`<table>_rebuild`) and changes nothing else; **2 of 2**, run only if step 1 worked, puts the complete table in place and keeps the old one as `<table>_before_<date>` (delete it once the page says OK). If the table has rows and the column is `NOT NULL` without a default, step 1 fails (“NOT NULL constraint failed”) without changing anything: those rows need a value first, so stop and ask for help.
- Then the whole file, for the tables and indexes still missing.

`tests/admin-config-d1.test.js` runs these fixes on a real SQLite for every column of the schema, in an empty table and in one with rows.

**Generate a value** draws, in your browser (`crypto.getRandomValues`, WebCrypto), the secrets no service gives you: `ADMIN_TOKEN` (48 letters and digits) and `ADMIN_TOTP_SECRET` (32 base32 characters, with its `otpauth://` link for an authenticator app). Values are kept nowhere — not sent, not stored — and are gone when you leave the page.

**Copy summary** copies the state of every setting as plain text — states, forms and lengths, never a value — to paste into a conversation with an assistant or an issue. **Send me a test email** sends one short email, “Daily Planner: test email”, to `OWNER_EMAIL` only, through Resend (`POST /api/admin/email/test`, 5 per 10 minutes per worker isolate; it counts toward `EMAIL_DAILY_LIMIT` like every email, as Resend counts it). It has nothing to do with the waitlist: the dashboard's own test of an announcement stays where it is.

## The database

**A fresh install** creates its tables from one file, [`migrations/schema.sql`](../migrations/schema.sql): paste it into the D1 console (Cloudflare → Storage & Databases → D1 SQLite Database → your database → Console) and run it, or from a terminal:

```bash
npx wrangler d1 execute daily-planner --remote --file=migrations/schema.sql
```

It creates only what the code uses — the anonymous counts, the waitlist, feedback and reviews, the Contact page's questions, the abuse limits and the security reports — with `CREATE TABLE IF NOT EXISTS` and `CREATE INDEX IF NOT EXISTS`, so running it again changes nothing.

**A database made by an earlier release** stays compatible as it is: every table the code reads is already there, with its columns (the questions table keeps the columns it had when it also took team orders, empty for a question). Running the schema on it changes nothing. Tables earlier releases used and this one no longer reads are never dropped or altered: they stay where they are, unused.

The page checks the tables, columns and indexes of the schema against the database (see below), and gives the SQL for anything missing.

## What each check does

| Service | Read-only check |
| --- | --- |
| D1 (`DB`) | `SELECT 1`, then every table, column and index of `migrations/schema.sql` in `sqlite_master` (columns by their names, read from each table's `CREATE TABLE`). No answer in time is “not tested”; an error is a problem with the binding. D1 has no extensions, and this app has no scheduled jobs (no cron trigger) and no private settings in the database: there is nothing else to check. |
| Security headers | What browsers reported as blocked by the Content-Security-Policy of `_headers` in the last 7 days, from the daily counts the API keeps (`POST /api/csp-report`; nothing about visitors). Nothing blocked is OK; anything is a warning that lists the directive, what was blocked (an origin, `inline` or `eval`) and the page, with what to check: Rocket Loader, Bot Fight Mode or JavaScript detections turned on in Cloudflare, or a new outside service whose address the policy needs. Before the schema is applied: not counted. |
| Resend | `GET /domains`: a full-access key lists the domains, and the domain of `EMAIL_FROM` must be verified; a sending-only key answers 401 `restricted_api_key`, which still proves the key. |
| Build variables | Compared with the values the deployed `runtime-config.js` holds (read through the `ASSETS` binding): a variable changed since the last deployment says “retry the deployment”. Their form is checked as the pages check it (the legal pages' rules for addresses and phone numbers). |
| The rest | By form: token strength, base32, https addresses, email addresses, whole numbers. |

## Not testable from here, and why

- `DAILY_PLANNER_GOOGLE_CLIENT_ID`: Google has no read-only check for a client ID. Connect Google Drive in the planner (Settings → Personal sync) to try it.
- `DAILY_PLANNER_DROPBOX_APP_KEY` (1.38): Dropbox has no read-only check for an app key; only its form (lowercase letters and digits). Connect Dropbox in the planner (Settings → Personal sync) to try it; the App Console must list the Redirect URI below.
- `EMAIL_FROM` with a sending-only Resend key: such a key can't read domains. **Send me a test email** tries the whole path.
- Links (`DAILY_PLANNER_GITHUB_URL`, `DAILY_PLANNER_SPONSOR_URL`, the social links): only their form; they aren't opened from the server.
- On the local dev server there is no D1: the database rows say “checked on Cloudflare”.

## One deployment

There is one deployment, production. A preview deployment uses the project's **Preview** variables: open the page on its address (`https://<hash>.<project>.pages.dev/admin/configuration/`) to check them there.

## Every setting

Classified from the code (`server/config-inventory.js`; `tests/config-inventory.test.js` fails when the code reads a variable that isn't listed, or the other way round).

| Name | Level | Secret | Where |
| --- | --- | --- | --- |
| `DAILY_PLANNER_API_URL` | required | no | build (`runtime-config.js`) |
| `DAILY_PLANNER_SUPPORT_EMAIL` | recommended | no | build (legal pages) |
| `DAILY_PLANNER_LEGAL_PHONE` | recommended | no | build (legal pages) |
| `DAILY_PLANNER_LEGAL_ADDRESS` | recommended | no | build (legal pages) |
| `DAILY_PLANNER_PRIVACY_EMAIL` | optional | no | build (legal pages) |
| `DAILY_PLANNER_LEGAL_REGISTRATION` | optional | no | build (legal pages) |
| `DAILY_PLANNER_GOOGLE_CLIENT_ID` | optional | no | build |
| `DAILY_PLANNER_DROPBOX_APP_KEY` | optional | no | build |
| `DAILY_PLANNER_CLOUD_API_URL` | optional | no | build |
| `DAILY_PLANNER_GITHUB_URL`, `DAILY_PLANNER_SPONSOR_URL`, `DAILY_PLANNER_X_URL`, `DAILY_PLANNER_LINKEDIN_URL` | optional | no | build |
| `DB` | required | — | Functions: D1 binding |
| `ADMIN_TOKEN` | required | yes | Functions |
| `ADMIN_TOTP_SECRET` | recommended | yes | Functions |
| `RESEND_API_KEY` | recommended | yes | Functions |
| `EMAIL_FROM`, `OWNER_EMAIL` | recommended | no | Functions |
| `PUBLIC_BASE_URL`, `ALLOWED_ORIGINS`, `EMAIL_DAILY_LIMIT` | optional | no | Functions |

Required means a core promise breaks without it (the API and its dashboard). Cloudflare also gives every Function the `ASSETS` binding by itself (the site's files); nothing to set.

`DAILY_PLANNER_GITHUB_URL` and `DAILY_PLANNER_SPONSOR_URL` show, when set, the source code link and **Sponsor on GitHub** in the planner and on the public pages (and the sponsor moment, once ten days are closed); for example `https://github.com/bemorin/planner` and `https://github.com/sponsors/bemorin`. Blank, nothing of them is shown.

**Addresses on another site (1.35).** `_headers` gives every page a Content-Security-Policy: the browser only calls this site, Google (Drive sync: `accounts.google.com`, `www.googleapis.com`), Dropbox's API and Cloudflare Web Analytics. A `DAILY_PLANNER_API_URL` or `DAILY_PLANNER_CLOUD_API_URL` on another site is refused until its origin is added to `connect-src` in `_headers`. The policy is part of the security block at the top of `_headers` (the `/*` rule, with HSTS, `X-Frame-Options`, `nosniff`, `Referrer-Policy`, `Permissions-Policy` and `Cross-Origin-Opener-Policy`); its `script-src` lists the SHA-256 hash of each inline script in the pages, and `npm run check` fails, naming the hash, until those hashes match the published pages exactly (`scripts/csp.mjs`). This guide isn't published on the site (the build leaves `docs/` out): with `DAILY_PLANNER_GITHUB_URL` set, the Configuration page links to it on GitHub.

Read on a computer only, never set on Cloudflare: `PORT` (the dev server's port), `CHROME_BIN`, `PROGRAMFILES` and `PROGRAMFILES(X86)` (where the smoke test finds Chrome). The dev server also reads the production variables above, so the API behaves locally as in production; `npm run admin:secret` reads `ADMIN_TOTP_SECRET`.

**For developers.** `server/config-inventory.js` (the list), `server/admin-config.js` (the checks, `fetch` injectable), `server/secret-scrub.js` (the scrubber), `server/admin-limits.js` (the rate limits), `POST /api/admin/config/check` (owner sign-in), `POST /api/admin/email/test` (owner sign-in), `admin/configuration/` (the page). The rate limits — 10 checks, 5 test emails and 5 “Start fresh” resets per 10 minutes — live at module scope: the Pages Function builds a new API for each request, and every request a worker isolate answers shares them. They are per isolate (Cloudflare runs several), so Cloudflare's rate limiting rule on `/api/` is the real guard. Locally, `node scripts/serve.mjs --api --fake-email` answers the checks with its pretend Resend.

## Dropbox for Personal sync (1.38)

Personal sync offers Dropbox beside Google Drive once `DAILY_PLANNER_DROPBOX_APP_KEY` is set; blank, the choice isn't shown and no Dropbox request is made. The browser talks to Dropbox directly (OAuth 2 with PKCE, no secret, nothing through the API). Free, and nothing to pay Dropbox. In the **Dropbox App Console**, exactly:

1. [dropbox.com/developers/apps](https://www.dropbox.com/developers/apps) → **Create app**.
   - **Choose an API:** *Scoped access*.
   - **Choose the type of access you need:** **App folder** (not *Full Dropbox*): the planner sees only its own folder, in the Apps folder of the person's Dropbox.
   - **Name your app:** your copy's name. Dropbox names the folder after it (Settings → *App folder name*); the planner never spells that name out, so any name works.
2. **Permissions** tab: tick `files.metadata.read`, `files.content.read` and `files.content.write`, then **Submit**. Dropbox keeps `account_info.read` ticked on its own; leave it: the planner's sign-in asks for the three file permissions only (`DROPBOX_SCOPES` in `src/sync/dropbox.js`) and never reads the account.
3. **Settings** tab:
   - **OAuth 2 → Redirect URIs**, each added exactly, final slash included: your production address (for the hosted planner, `https://planner.bemorin.com/`). For a local try, `http://localhost:8080/` (the dev server's port; add one line per port you use, e.g. `http://localhost:8600/`). The planner sends Dropbox back to its own root on the address it was opened at (`location.origin + '/'`), so open the dev server at `localhost`, not `127.0.0.1`, or add that address too.
   - **OAuth 2 → Allow public clients (Implicit Grant & PKCE):** **Allow**.
   - **Development users → Enable additional users**: without it only your own account can connect (then up to 500; see *Production* below).
   - Leave as they are: **Generated access token** (nothing to generate), **Chooser / Saver / Embedder domains** (empty), and the **App secret**, which never goes anywhere: PKCE doesn't need it.
   - Copy the **App key** (the field above the App secret).
4. **Branding** tab, for the production review: your name as publisher; a description such as `A calm daily planner. It keeps one copy of your planner in its own folder of your Dropbox, sealed on your device with a passphrase only you know, so it stays the same on your phone and computer.`; your app website, privacy policy (`/legal/privacy/`) and terms (`/legal/terms/`) on your address; icons 64 × 64 and 128 × 128 px, of your own copy.
5. Cloudflare → Workers & Pages → the project → Settings → Variables and Secrets → Production: `DAILY_PLANNER_DROPBOX_APP_KEY` = the App key, as **Text** (it is public, written into `runtime-config.js`, like the Google client ID). **Retry deployment.** Configuration then says “looks like a Dropbox app key”, not tested.
6. Try it: planner → Settings → Personal sync → **Dropbox** → **Connect Dropbox** → Dropbox's page (while in development it warns “This app only has a small number of users”) → **Allow** → back in the planner, Settings opens on Personal sync: choose a passphrase. On a second device, connect the same Dropbox account and type the passphrase once.

Locally: `DAILY_PLANNER_DROPBOX_APP_KEY=<app key> node scripts/serve.mjs` (with `http://localhost:8080/` in the Redirect URIs).

**Production.** In development Dropbox accepts up to 500 accounts, but once 50 are linked it gives two weeks to apply (Settings → **Apply for production**) before refusing new ones; the review is free and checks the branding, privacy policy and terms. Dropbox asks for at least one linked account first (connect yours once). The planner can't count linked accounts (each browser talks to Dropbox directly); the App Console does (Settings → *Development users*).
