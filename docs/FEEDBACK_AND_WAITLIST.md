# Owner API: feedback, questions, the waitlist and anonymous counts

Daily Planner can talk to a small owner API (Cloudflare Pages Functions + D1) for:

1. **Anonymous daily counts** of a few named moments in the planner and on the landing page (the exact lists are `COUNTED_EVENTS` and `LANDING_EVENTS` in `src/lib/planner-api.js`; the server accepts exactly the same names, and a test checks both lists match). Some are counted at most once per day, week or month on a device, so the dashboard can show how many devices use the planner without any identifier.
2. **The account-sync waitlist** — an email, the devices someone would use, an optional note and their consent to be emailed once, when account sync is ready.
3. **Feedback by app version** — a rating, a kind, a message, an optional reply email and the platform family. When someone ticks that their words may be quoted, a copy is kept as a **review**, with the name they chose to give (optional).
4. **Questions** from the Contact page's “Ask a question” form at `/contact/` (`POST /api/contact`): an email, a name and the question, nothing else.
5. **Security reports** — daily counts of what the site's Content-Security-Policy blocked (`POST /api/csp-report`), with nothing about visitors.
6. **Email through Resend** — a notification to you for each question, the one waitlist announcement, and test emails.
7. **The owner dashboard** at `/admin/`, behind a token and an optional authenticator code.

The API is **off by default**. With `PLANNER_API_URL` blank — the checked-in value — the planner and the public pages make no requests at all.

## What is never sent

- Nothing from the planner itself: no tasks, notes, schedules, Horizon content, year plans, check-ins, reviews, journal entries, Insights or statistics. All of it is worked out and kept on the device.
- Counts carry no identifier: no user ID, device ID, cookie, IP address or user agent is stored. Each count is only `(day, event name, app version) → number`.
- To stop abuse, the API limits how often one connection may send it something. For that alone it keeps a scrambled form of the IP address (an HMAC keyed by a random salt of the day, the earlier salts deleted), never the address itself, and each row for at most 24 hours.
- Local, never-synced flags: `daily-planner-ui:feedback`, `daily-planner-ui:waitlist-joined`, `daily-planner-ui:trophies-seen`, `daily-planner-ui:usage-counts`, `daily-planner-ui:counted` (which day, week or month a count was last sent) and the palette choice `daily-planner-ui:paint`. The cookies page (`/legal/cookies/`) lists every key the browser keeps.

## Privacy notice — shown automatically

When `PLANNER_API_URL` is set, the planner shows a **Privacy** entry in Settings and Help, a one-line note on the first setup step and a link under the waitlist and feedback forms. They open one Privacy dialog generated from the configuration (owner API, Personal sync, local storage), with a per-device switch **Send anonymous usage counts**. The landing page has its own notice (“What this page counts”), which lists only the moments the page sends. With the API off, none of it appears, because nothing is sent.

Waitlist emails, questions and feedback with a reply address are personal data under the GDPR. The waitlist is emailed once and each address is then deleted automatically; people can also leave from the sync guide at any time. Delete questions, feedback and reviews on request (every row has a delete button).

## How the waitlist measures real demand

The waitlist form only appears after the three-step sync guide, and the dashboard shows the funnel (guide opened → step 2 → step 3 → form opened → joined). Each step is counted once per opening.

When account sync is ready, write the announcement in the dashboard and press **Send** (send a test to `OWNER_EMAIL` first). The API sends oldest first, at most `EMAIL_DAILY_LIMIT` emails per UTC day and 1,000 per press, and deletes each address right after its email goes out. Press Send again the next day for the rest.

## How feedback avoids asking twice

The planner asks at most once per feature release (1.21 covers 1.21.0, 1.21.1 …), in a dialog that shows what's new: the API is configured, at least three days closed, two days on this release, never asked about this release on this device, no prompt in the last fourteen days, and never during first-run setup or over another dialog. Feedback is always possible from **More → Send feedback** or **Help**. Ticking “You can quote this on the Daily Planner website” also keeps the rating, the message and the chosen name as a review (dashboard → Reviews).

## Local development

```text
npm run start:api        planner + API + dashboard on http://localhost:8080 (token: dev)
npm run start:api:fake   the same, printing emails instead of sending them
```

- Data is kept in `.planner-dev/api.json` (ignored by Git); `--data <file>` keeps it elsewhere.
- `ADMIN_TOKEN=… ADMIN_TOTP_SECRET=… npm run start:api` tries two-factor sign-in locally.
- The build variables of the legal pages work locally too: `DAILY_PLANNER_SUPPORT_EMAIL=support@example.com DAILY_PLANNER_LEGAL_PHONE=+33199001234 npm run start:api` shows them in the legal pages, the Contact page and the dashboard's **Setup** card (also `DAILY_PLANNER_PRIVACY_EMAIL`, `DAILY_PLANNER_LEGAL_ADDRESS` and `DAILY_PLANNER_LEGAL_REGISTRATION`). Unset, they stay blank.

## Production on Cloudflare Pages + D1

| Path | Purpose |
| --- | --- |
| `functions/api/[[path]].js` | Pages Function answering every `/api/*` request |
| `server/planner-api.js` | Router shared with the dev server |
| `server/d1-store.js`, `migrations/schema.sql` | Storage, and the schema of a fresh install |
| `server/email.js`, `server/admin-auth.js`, `server/rate-limit.js`, `server/csp-reports.js` | Resend, dashboard sign-in, abuse limits, security reports |
| `admin/` | Dashboard at `/admin/`, and its Configuration page at `/admin/configuration/` |
| `welcome/`, `contact/`, `legal/` | The landing page at `/welcome/`, the Contact page at `/contact/` and the legal pages |

The steps below are in the order to follow. Every variable is described in [configuration.md](configuration.md).

### 1. Database

1. In Cloudflare: **Storage & Databases → D1 SQLite Database → Create**. Name it `daily-planner`. Under **Specify jurisdiction**, choose where the data should stay (for example **European Union**; this can't be changed later).
2. Open the new database, then its **Console** tab, paste the whole content of [`migrations/schema.sql`](../migrations/schema.sql) and run it. From a terminal instead: `npx wrangler d1 execute daily-planner --remote --file=migrations/schema.sql`.

The schema only creates what is missing, so running it again does no harm. A database made by an earlier release needs nothing new: running the schema on it changes nothing, and tables it no longer uses are left as they are. If the dashboard ever says *"A database table is missing"*, run the schema again.

### 2. Secrets you make on your computer

`npm run admin:secret` → `ADMIN_TOKEN` and `ADMIN_TOTP_SECRET` (add the second to your authenticator app with "Enter a setup key"). Keep both in your password manager.

### 3. Email (Resend)

Optional. Resend → **Domains → Add** (e.g. `yourdomain.com`), copy the DNS records it shows (DKIM, SPF/MX) into your DNS (in Cloudflare, as *DNS only*), wait for *Verified*, then **API Keys → Create** with sending access. Free plan: 100 emails a day, 3,000 a month.

### 4. Cloudflare Pages settings

All of this is in the Cloudflare dashboard, under **Workers & Pages → your Pages project → Settings**.

**The database binding** — **Settings → Bindings → Add → D1 database**. Variable name: `DB`. D1 database: `daily-planner`. Save.

**Variables and secrets** — **Settings → Variables and Secrets → Add**. For each line of the table: choose the **Type** shown (*Secret* for anything private, *Text* for plain values), type the name exactly as written, paste the value, and save it for the **Production** environment. A secret can't be read back after saving; to change one, edit it and paste the new value.

| Name | Type | What to paste | Where it comes from |
| --- | --- | --- | --- |
| `DAILY_PLANNER_API_URL` | Text | `/api` (switches the API and the privacy notices on) | always `/api` |
| `ADMIN_TOKEN` | Secret | the long token | `npm run admin:secret` |
| `ADMIN_TOTP_SECRET` | Secret | the setup key (recommended) | `npm run admin:secret` |
| `RESEND_API_KEY` | Secret | the key, `re_…` | Resend → API Keys |
| `EMAIL_FROM` | Text | the sender, e.g. `Daily Planner <hello@yourdomain.com>`, on the verified domain | your choice |
| `OWNER_EMAIL` | Text | the inbox for question notifications and test sends | your choice |
| `EMAIL_DAILY_LIMIT` | Text | optional, default `100` | Resend plan |
| `PUBLIC_BASE_URL` | Text | your copy's address, e.g. `https://planner.example.com` | your address |
| `ALLOWED_ORIGINS` | Text | optional: other origins allowed to call the API | — |
| `DAILY_PLANNER_GOOGLE_CLIENT_ID`, `DAILY_PLANNER_DROPBOX_APP_KEY` | Text | optional: Personal sync (see [PERSONAL_SYNC.md](PERSONAL_SYNC.md#deployment-setup)) | Google Cloud, Dropbox App Console |
| `DAILY_PLANNER_GITHUB_URL`, `DAILY_PLANNER_SPONSOR_URL` | Text | optional: your repository and your GitHub Sponsors page, e.g. `https://github.com/sponsors/bemorin` | GitHub |
| `DAILY_PLANNER_X_URL`, `DAILY_PLANNER_LINKEDIN_URL` | Text | optional: links in the footers | your profiles |
| `DAILY_PLANNER_SUPPORT_EMAIL` | Text | the contact address shown on the legal pages and the Contact page, e.g. `support@yourdomain.com`; `<support@yourdomain.com>` or `Support <support@yourdomain.com>` are read as the address | your choice (see [Legal pages](#legal-pages)) |
| `DAILY_PLANNER_PRIVACY_EMAIL` | Text | optional: the address for privacy questions (blank: the support address) | your choice |
| `DAILY_PLANNER_LEGAL_PHONE` | Text | recommended (French law asks an individual publisher for one): in international form, `+33` then the number without its leading 0, e.g. `+33199001234`. Text, not a secret: it is shown on the page | your phone |
| `DAILY_PLANNER_LEGAL_ADDRESS` | Text | the postal address shown in the legal notice | your address |
| `DAILY_PLANNER_LEGAL_REGISTRATION` | Text | optional: a registration or VAT number, e.g. `SIRET 123 456 789 00012` | your registration |

**Redeploy after every change** — **Deployments → the latest production deployment → ⋯ → Retry deployment**. Saved values are not used until the next deployment, and the `DAILY_PLANNER_…` ones are read while the site is built.

Then open `/admin/` on your address: the **Setup** card lists anything still missing, and never shows a secret. **Admin → Configuration** (`/admin/configuration/`) goes further: it tries every setting with its service (Resend, the database, the legal details) and gives the exact fix for each problem; see [configuration.md](configuration.md).

### Legal pages

The site carries its own legal pages, linked from the planner's footer, the landing page and the Contact page. They describe the hosted planner and name its publisher (`legal/legal-details.js`): a public copy needs its own.

| Page | Address |
| --- | --- |
| Legal notice | `/legal/` |
| Privacy policy | `/legal/privacy/` (short link `/privacy`) |
| Terms of use | `/legal/terms/` (short link `/terms`) |
| Cookies and storage | `/legal/cookies/` (short link `/cookies`) |

The short links come from `_redirects` (Cloudflare Pages reads it from the build output; the dev server applies it too).

Five build variables fill in the publisher's details. Add them in **Settings → Variables and Secrets** as *Text* for **Production** (table above), then **redeploy**: they are read while the site is built.

| Variable | What it fills | When blank |
| --- | --- | --- |
| `DAILY_PLANNER_SUPPORT_EMAIL` | The **Email** row of the legal notice; **Contact** in the terms; "Prefer email? Write to …" on the Contact page (no footer shows it). Also privacy questions when `DAILY_PLANNER_PRIVACY_EMAIL` is blank. | Those places point to the "Ask a question" form on the Contact page (`/contact/`). |
| `DAILY_PLANNER_PRIVACY_EMAIL` | Optional. In the privacy policy, the data controller's **Email** row and "To use any of these rights, email …"; on the cookies page, **Questions**. | The support address, else the form. |
| `DAILY_PLANNER_LEGAL_PHONE` | Recommended. A **Phone** row in the legal notice (a `tel:` link). French law (LCEN, article 6 III) asks an individual publisher for an address and a phone number. Write it in international form, `+33` then the number without its leading 0 and no spaces (`+33199001234`); the page shows it as people of that country write it (below). | No phone row. |
| `DAILY_PLANNER_LEGAL_ADDRESS` | The **Address** row of the legal notice and of the privacy policy. | No address row. |
| `DAILY_PLANNER_LEGAL_REGISTRATION` | Optional. A **Registration** row (SIRET and/or VAT number) in the legal notice and the privacy policy. | No registration row. |

Each address must be a plain address (shown as a `mailto:` link). Typed the way an email “From” is written, `<support@yourdomain.com>` or `Support <support@yourdomain.com>`, only the address is used, and the dashboard's **Setup** card says “set, read as support@yourdomain.com”. A value that isn't one address, or a phone number with other characters, is left out like a blank one.

**How the phone number is shown.** The legal notice writes an international number the way that country does, after its code, and the `tel:` link always dials the digits (`tel:+33199001234`):

| Typed | Shown |
| --- | --- |
| `+33199001234` (France: one digit, then pairs) | `+33 1 99 00 12 34` |
| `+15145550123` (the US and Canada: 3, 3 and 4 digits) | `+1 514 555 0123` |
| `+442079460000` (the United Kingdom) | `+44 20 7946 0000` |
| `+3220000000` (Belgium) | `+32 2 000 00 00` |
| `+41440000000` (Switzerland) | `+41 44 000 00 00` |
| `+493023125000` (Germany: the area code, then the number) | `+49 30 23125000` |
| another country, e.g. `+351210000000` | `+351 210 000 000` (groups of three and two), or as typed when you typed spaces |
| a number without `+`, e.g. `01 99 00 12 34` | as typed |

Spaces, dots, dashes and a national `(0)` (`+33 (0)1 99 00 12 34`) are accepted too: the digits decide. For France, the United States and Canada, the United Kingdom, Belgium, Switzerland and Germany the number must have the right digits after the code (9 after `+33`, without the 0); otherwise the **Setup** card says it is not used, and why (“not a phone number: after +33, the 9 digits of the number, without its leading 0”). When it is used, Setup shows how it reads (“set, shown as +33 1 99 00 12 34”). The legal notice's table reads: Publisher, Address, Registration, Email (or Contact: the form), Phone, Director of publication. The build writes the configured details into the pages it publishes, so they show without JavaScript too (the pages in the repository keep the form). A blank value is simply left out; nothing personal is ever written in the repository.

The pages render the counted moments (`COUNTED_EVENTS`, and the landing page's own moments) from the code itself, so they can't drift. Edit the wording in `legal/*/index.html`, change the "Last updated" date at the top of the page, and have the text checked by a lawyer before relying on it.

### Protecting the API

- **Built-in limits** — the API counts requests per connection (under a scrambled form of the IP address, see [What is never sent](#what-is-never-sent)) and answers 429 when a form, a count or the sign-in is used too often.
- **A Cloudflare rate limiting rule** — the Free plan includes one rule per domain. If your zone has none yet, add one for paths starting with `/api/`, counting requests per IP address. Keep its rate at least about **30** requests per **10 seconds**, since a busy dashboard session sends about 10 in 10 seconds.
- **Optional extra layer**: Cloudflare Zero Trust → Access for `/admin/*` and `/api/admin/*` on your address, allowing only your email.

### Caches and the deployed version

The dashboard shows its own version in its header, and the **Setup** card starts with the version the API was deployed with. When they differ, your browser or Cloudflare served old files, and a banner at the top says so: “A newer dashboard is deployed. Reload to get it.” **Reload** fetches the page's files again past the browser cache, then opens the page at a new address (`/admin/?v=…`) that no cached copy can answer.

Since 1.25, `_headers` (copied to the build output, like `_redirects`) asks browsers and Cloudflare to check pages, scripts and styles with the server on every visit (`Cache-Control: no-cache`): an unchanged file costs a quick “304 Not Modified”, and a new deploy shows up on the next load. `/api/*` is not affected (the Functions set their own headers), and the installed planner still opens offline: its service worker keeps its own copy.

Since 1.35, its security block (the `/*` rule at the top) gives every page, file and redirect the same security headers: a Content-Security-Policy (scripts only from this site, Google's sign-in for Drive sync and Cloudflare Web Analytics, plus the few inline scripts in the pages' `<head>`, each by its SHA-256 hash), `Strict-Transport-Security`, `X-Frame-Options: SAMEORIGIN`, `X-Content-Type-Options: nosniff`, a `Referrer-Policy`, a `Permissions-Policy` and `Cross-Origin-Opener-Policy: same-origin-allow-popups` (the Google sign-in window still reports back). Change an inline script and its hash changes: `npm run check` fails (`scripts/check.mjs`, with `scripts/csp.mjs`) and names the hash to put in `script-src`, until the policy lists exactly the hashes of the published pages' inline scripts; `tests/csp.test.js` checks the same. A new outside service (an API on another site, a font) needs its address in the policy first. What the policy blocks, browsers report to `POST /api/csp-report` (`report-uri`, and `report-to` with the `Reporting-Endpoints` header): the API keeps daily counts only (`server/csp-reports.js`), and the Configuration page's **Security headers** row lists the last 7 days. Rocket Loader, Bot Fight Mode and JavaScript detections must stay off in Cloudflare: their inline scripts are blocked.

**If the banner stays after Reload**, purge Cloudflare's cache once: open your domain in Cloudflare → **Caching → Configuration → Purge Everything**. Nothing is lost: plans stay in each person's browser, the API's data in D1, and every deployment in Pages; the next visits simply fetch fresh files. If it keeps happening, look in **Caching → Cache Rules** for a rule that caches everything on your address: Pages doesn't need one.

### Dashboard sign-in

The dashboard sends the token and the 6-digit code to `POST /api/admin/session` and keeps only a signed 8-hour session in that tab. With two-factor on, the session key is derived from both secrets, so the token alone can never produce one; changing either secret signs every session out. Changing `ADMIN_TOKEN` also changes every waitlist removal link (they are derived from it). Without `ADMIN_TOTP_SECRET`, scripts can still call admin routes with `Authorization: Bearer <ADMIN_TOKEN>`. Ten wrong tries (sign-in or raw token) in 15 minutes from one connection lock it out for 15 minutes: every wrong try then answers “Too many wrong sign-ins” (429), and your right token (and code) still signs in, which ends the lockout.

## Dashboard

`/admin/` opens on what needs your attention (questions waiting for a reply, Setup items to fix, new reviews), each with a link to the exact row, and reads “All clear” when nothing is due. Then it shows: key numbers; **Trends**, the anonymous counts over time (`GET /api/admin/series`), with **Start fresh** at the end to delete the counts once, before a launch; the sync demand funnel; **Questions** from the Contact page, with CSV and delete; the **Waitlist** with the announcement composer; **Reviews** and **Feedback by version**, with delete; other signals; and **Setup** (the deployed version, what's configured, never the secret values). Signing in switches the anonymous counts off in that browser, so your own visits stay out of them; the header says “This browser isn’t counted”, with a switch to count it again. A banner at the top offers a reload when the page is older than the deployment (see [Caches and the deployed version](#caches-and-the-deployed-version)).
