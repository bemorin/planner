# Security policy

Thank you for helping keep Daily Planner and the people who use it safe.

## Reporting a vulnerability

Please report security problems **privately**, through GitHub's private vulnerability reporting, and not in a public issue, pull request or discussion:

1. Open the repository's **Security** tab.
2. Choose **Report a vulnerability** (under “Advisories”).
3. Describe the problem: what an attacker could do, the steps to reproduce it, the affected pages, files or API routes, and the browser when it matters.

Only the maintainer sees the report. You'll get an acknowledgement within a few days, and we'll keep you informed while it is fixed. Once a fix is released, the advisory can be published, with credit to you if you wish.

Please don't access or change data that isn't yours, don't degrade the hosted service, and give us a reasonable time to fix the problem before you disclose it.

## Scope

In scope:

- the planner, its service worker and Personal sync (the seal, and the Google Drive and Dropbox transports);
- the public pages (`welcome/`, `contact/`, `legal/`);
- the owner API (`server/`, `functions/`) and the owner dashboard (`admin/`);
- the security headers and Content-Security-Policy (`_headers`).

Out of scope: problems in Google Drive, Dropbox, Cloudflare, Resend or GitHub themselves (report them to those services), and copies of the planner run by someone else.

## Supported versions

Only the latest release, on the `main` branch and the hosted planner, receives security fixes.
