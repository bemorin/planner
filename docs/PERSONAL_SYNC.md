# Personal sync

> Status: implemented behind deployment configuration. Personal use still works without an account, a cloud, or a network connection. Clouds: Google Drive (since 1.20) and Dropbox (1.38). The copy in the cloud is sealed with the person's passphrase (1.38).

Daily Planner treats Personal sync as an optional transport around the local planner rather than as the source of truth for using the app.

## What is synchronized

The first protocol deliberately uses stable top-level records instead of one opaque browser dump:

```text
settings
day:2026-08-16
day:2026-08-17
...
```

A day remains the first merge boundary. Tasks, outcomes, notes, and schedule blocks already have stable IDs inside that day, which leaves room for finer-grained merges later without requiring the first transport to understand every UI feature.

Each synced record carries a content hash plus deletion metadata. Local sync metadata keeps the hash that was last confirmed on both sides.

## Conflict rule

For each record the client compares:

```text
last confirmed hash
current local hash
current remote hash
```

That gives four useful cases:

```text
only local changed     → push local
only remote changed    → pull remote
both changed identically → mark synced
both changed differently → stop and ask
```

The last case is intentionally conservative. The app does not silently choose a winner when the same record changed independently on two devices.

## Deletions are tombstones

Removing a planner record is also a state change. The local sync ledger records a tombstone instead of forgetting that the record existed. The tombstone can then propagate to another device so deleted data does not reappear simply because the other device still had an older copy.

**Reset local data is not a deletion** (1.40.1). It touches only this browser (`src/features/reset-local.js`): every day in both homes, the settings and the planner's other keys go without a mutation, so no tombstone, and the ledger is cleared (`ledger.reset()`: its bases, each cloud's state, the cloud chosen), connected or not. When sync is connected it is turned off here first (`forgetHere()` in `src/features/personal-sync.js`: a sync under way finishes, none starts, both clouds' access and the seal's key material go, and the copy is never read or written). The copy and the other devices keep everything. Connecting again is a first connection: with no base here, every record in the copy is pulled, and the rule that pulls back a day missing here that still has a base never applies. A Reset while disconnected, then a connection to an existing copy, deletes nothing either. The recovery snapshots go too (they hold days).

**A Reset generation** (`daily-planner-sync:generation`, `src/sync/ledger.js`). Reset writes a new random value first. From then on the ledger and each cloud's state count only when written under it (`gen` in each): a sync, a connection or a sign-in begun before the Reset stops at its next step (the engine throws code `'reset'`, each flow in `personal-sync.js` checks it after every wait, a ledger session begun before never commits), in this tab or another, and other 1.40.1 tabs stand down as they hear the key change (a `storage` event: their access, the seal's key and the card's state forgotten). What a tab of an earlier release writes afterwards (its ledger, its `connected`) is read as nothing, never turns sync on, and is discarded at the next start, with that access and seal. No key before the first Reset: nothing changes for anyone who never reset.

**A first connection from a browser with nothing of its own** (`src/sync/fresh.js`: no day that holds anything but onboarding's sample block left exactly as seeded, `src/state/first-block.js`, its id naming its day and start so a moved one never matches; settings as the defaults and onboarding leave them: no day closed, nothing in Later, no year planned, the default categories), to a copy that holds something, takes the copy: every record that would conflict is pulled instead, and this browser's days of nothing that the copy lacks (blank, or the sample alone) are removed here rather than sent, so onboarding never stops it nor reaches the copy. Freshness is judged from what the browser holds at that moment, never from a marker. A browser with plans of its own gets the usual conflicts. The conflict card names what conflicts (“Your settings differ between this device and your copy.”, or days). When this browser holds no day of its own, **Use {cloud}** is its main button; on a first connection where it does, both choices weigh the same, each saying what it keeps and what it replaces; otherwise **Keep this device** comes first, as before.

**Reset waits for the other tabs.** While another planner tab is open, of any release (more than one holder of the tab lock, or more than one planner window as the service worker counts them: `otherTabsOpen()` in `src/features/archive-keeper.js`), Reset is refused, and the dialog says “The planner is open in another tab. Close it there first, then reset.”: a tab of 1.40.0 or earlier knows no generation, and its sync under way would bring the planner back. In a browser full to its last character, Reset still forgets the connection: the ledger's keys go before the generation is written, the connection is forgotten whatever happens, and the generation is written again once the days are gone.

**Vanished records** are pulled back whatever their kind (days since 1.40.0, the settings since 1.40.1): a record missing here that still has a base, and is in the copy without a tombstone, is never deleted from the copy.

## Older days in this browser's database (1.40)

Once a planner needs more room than localStorage gives, its older days move to IndexedDB (`ARCHITECTURE.md`, “Older days in IndexedDB”). Sync doesn't see the difference:

- **A move is no change.** The days keep the same keys and the very same strings, so the same parsed values and the same canonical hashes (`hash.js`), and a move marks nothing in the ledger. After a move, a sync pushes nothing, pulls nothing and calls no `provider.write`, over a plain copy and a sealed one alike (`tests/sync-archive.test.js`).
- **Every day is read first.** `personal-sync.js` and the engine itself wait for `store.ready()` before anything is compared: an older day not loaded yet would look deleted here while it still has a base, and `push-local` would remove it from the copy. While the archive is `unavailable` (IndexedDB failing this session), no sync runs, and the card says why. While it is `lost` (days missing from its database: fewer records than the manifest counts, or a day the ledger knows absent from both homes), no automatic sync runs, and those days are read-only here; **Sync now** runs with `restoreMissing`: a record missing here that still has a base and is in the copy is pulled back, never removed from the copy. Only once such a sync has run and stored all it pulled (or the person chooses Carry on without them in Data on this device) is the rest let go: `settle()` forgets the ledger entries of what is still missing, so the next sync sees no base for those days and pulls them from the copy should it have them, rather than taking them for deletions. An import alone never settles it, unless nothing is missing after it: a backup older than the last days written would otherwise leave the newer ones to be removed from the copy.
- **The local side of a sync runs alone.** From reading this device's records to applying the pulls, the engine holds the archive's lock (`store.exclusive()`: the Web Lock, or the lease), so no pass, pull or import in any tab moves days meanwhile, and days another tab has just moved are read first (`store.ready({ lock })`, the manifest's `gen`): a move never looks like a deletion here. The copy itself is read before and written after, outside the lock.
- **Pulls are placed.** The engine applies through `store.placeMany()`: recent days, and older ones while localStorage stays within 40% of Safari's budget (each pulled record's base counted in), go to localStorage; the rest go straight to the archive, put and verified. An archived day changed on another device moves back to localStorage, as any edit does. Anything not stored lands in `refused`, so its base stays and it is pulled again next time.
- **A day never leaves the copy without a tombstone from this browser.** A day record missing here that still has a base, and is in the copy without a tombstone, is always pulled back, with or without `restoreMissing` (`engine.js`): only a tracked removal (a tombstone in the ledger) deletes a day from the copy. So a day that vanished from this browser some other way (a freed day whose manifest write never landed, storage cleared by hand) comes back instead of being deleted everywhere.
- **Edits and deletions of archived days sync as any other.** Editing one writes it to localStorage (a change, marked); a tombstone pulled for one removes it from both homes, and the ledger's tombstone removes it again at the next start should the database delete have been lost.
- **A tab of 1.39** on the same device sees moved days as missing: its sync removes them from the copy (`push-local`, no tombstone). No device deletes them, and the next 1.40 sync on that device puts them back. Idle moves wait while such a tab is open.
- **Recovery snapshots are awaited** (`recoveryStore.save(await buildBackup(), reason)`), and the first move in a browser takes one of its own (`before-archive`), which is kept outside the five-snapshot limit. Data on this device offers a **Download** for each, as a backup file Import reads.

## Clouds: one small interface

Google Drive (`src/sync/google-drive.js`) and Dropbox (`src/sync/dropbox.js`) answer the same few calls (`src/sync/cloud.js`): `readText()` and `writeText()` of the one sync file, `hasUsableToken()`, `clearToken()`, and their sign-in (`popup` for Google, `redirect` for Dropbox). The seal (`src/sync/protection.js`) turns the file into the sync document and back, and the engine (`src/sync/engine.js`) merges records without knowing which cloud it is. The person picks one in Settings → Personal sync; a device syncs with one cloud at a time (`daily-planner-sync:cloud`). Moving to the other compares every record as at a first sync, so an older copy there can never overwrite newer days silently: what differs stops as a conflict.

**Switch to Dropbox** (offered on a Google Drive card whose hour ended with changes waiting) first renews Google's access inside the Switch tap (the window closes by itself, the account remembered; closed or refused, the switch goes on without a marker), then keeps Google Drive connected until Dropbox's sign-in has completed and a first Dropbox sync has run; back without access, the device is still on Google Drive and says why. Then, if Google's access is still usable, the Drive copy is merged once more with the bases agreed on with it (kept aside before the switch: what this device adds goes in, what another device wrote there stays, nothing is applied here) and sealed with `movedTo: 'dropbox'`; Google is then disconnected on the device. Google's access ended: no marker, and the switch's own words stand (the other devices keep using Drive until they switch too). A device still on Drive that finds the marker syncs as usual first (its own changes go to Drive), then shows a calm note under its card, “Your planner moved to Dropbox. Switch this device too.”, with **Switch**, which keeps the passphrase. Disconnect in the middle of a switch disconnects both.

## Google Drive transport

Google Drive sync uses the non-sensitive `drive.appdata` OAuth scope and one hidden file in the user's `appDataFolder`:

```text
Google Drive appDataFolder
└── daily-planner-sync.json
```

The file represents the current Personal sync state. It is not used as a remote version-history or backup archive.

The browser calls the Drive API directly. Personal planner data therefore does not need to pass through Daily Planner Cloud.

Google gives a browser app a token for an hour and no way to renew it without a tap. Since 1.38 the token stays on the device until it runs out: `daily-planner-sync:google-access` holds `{ value, expiresAt }`, restored when the planner opens if more than a minute remains, so the planner opened again within the hour syncs by itself. It goes as soon as it is no use: run out, refused by Drive (401), or **Disconnect** (and a switch to Dropbox). After a Connect or Reconnect, the planner reads the account's address once (`GET /drive/v3/about?fields=user(emailAddress)`, allowed with `drive.appdata`; refused, it is skipped) and keeps it as `daily-planner-sync:google-account`; Reconnect passes it as `login_hint`, so Google's window opens and closes by itself. Disconnect forgets it. Neither key starts with `daily-planner:`, so neither goes into a backup, an export or the synced copy, and neither is sent anywhere but to Google. A browser that refuses storage keeps them in memory, for the open page.

Google's window opens from the tap itself: Connect, Reconnect and the header alert's **Reconnect and save** call `requestAccessToken` before anything is awaited, with Google's sign-in loaded ahead. It loads once the person shows intent: Google Drive chosen in the cards, its Connect button pressed (`pointerdown`) or focused (`focusin`, the keyboard; focus the planner moves itself doesn't count), or Settings opened (or the header alert shown) while Google Drive is connected. Nothing reaches Google before that. A tap that comes while it still loads asks for the window once it has loaded; a browser may block that one, and the card then says “Google’s window didn’t open this time. Tap again: it opens straight away now.” A load that failed (offline) is not asked for again until the browser's `online` event.

A copy from before 1.38 (plain JSON) is sealed into a new file: written, read back and compared, and only then is the plain file deleted, since Drive keeps a file's earlier revisions and writing over it would leave the plain text in its history. A new file that doesn't read back as written is deleted and the plain one stays. Two files found under the name (a device stopped between the steps): the sealed one is used and the plain (or empty) one deleted; two plain or two sealed copies are left as they are.

## Dropbox transport (1.38)

Dropbox uses an **App folder** app: the planner sees only its own folder, in the Apps folder of the person's Dropbox (named after the App Console's app), and keeps the same file there, `/daily-planner-sync.json`, which the person can see. Permissions: `files.metadata.read`, `files.content.read`, `files.content.write`, requested explicitly at sign-in; no account details.

Sign-in is OAuth 2 with PKCE (S256), no client secret, as a top-level visit: **Connect Dropbox** saves the planner, keeps a random `state` and the PKCE verifier on the device (`daily-planner-sync:dropbox-auth`, `pending`, 15 minutes), and goes to `https://www.dropbox.com/oauth2/authorize` with `token_access_type=offline`. Dropbox sends the browser back to the planner's root, `location.origin + '/'` (`https://planner.bemorin.com/` in production), with `?code=…&state=…`. The planner takes them out of the address before anything else runs (and `src/ui/back-stack.js` lists them as one-time parameters, so they never come back), checks the state, trades the code at `https://api.dropboxapi.com/oauth2/token` with the verifier, and opens Settings on Personal sync. The first-visit redirect never applies: it skips any address with a query.

Dropbox gives a short-lived token (about four hours) and a refresh token. Both stay on the device (`daily-planner-sync:dropbox-auth`) until **Disconnect**, which also revokes them at Dropbox. A token that ran out is renewed with the refresh token, once at a time; a refused refresh token (access removed in Dropbox) asks for **Reconnect Dropbox**, and so does a token refused again (401) right after it was renewed: the refresh token is then dropped too, so Reconnect goes to Dropbox's page instead of renewing a token Dropbox refuses. Only the tokens are kept, not the account id Dropbox sends with them. So with Dropbox, automatic sync runs without a tap for as long as the person stays connected.

The sign-in waits on the device while Dropbox's page is open, and its access stays there: with cookies and site data blocked, Dropbox isn't offered, and one line says “Dropbox needs this browser to keep site data.” An answer in the address with no sign-in waiting for it (another browser's, an old tab) is taken out of the address and said: “That Dropbox sign-in had expired. Connect again to finish.”

Writes carry the revision read: if another device wrote meanwhile, Dropbox refuses, and the sync runs once more from what is there now. What the first attempt applied from the copy is agreed on in the ledger before its write, so the second attempt never takes it for a change made here (no false conflict), and the planner is drawn again whenever any attempt applied something. The CSP allows `https://api.dropboxapi.com` and `https://content.dropboxapi.com` in `connect-src`; the sign-in page is a navigation, which the policy doesn't restrict. Setup: [configuration.md](configuration.md#dropbox-for-personal-sync-138).

## The sealed copy (1.38)

The file in the cloud is sealed on the device before it leaves (`src/sync/seal.js`):

- **Key:** PBKDF2 with SHA-256, 600,000 rounds, a random 16-byte salt, to a 256-bit AES-GCM key. WebCrypto makes it non-extractable. The passphrase is normalised (NFC), so it is the same typed on any device, and never stored or sent anywhere.
- **Cipher:** AES-256-GCM, a fresh random 12-byte IV for every write. The header (format version, cipher, KDF, rounds, salt) is bound to the ciphertext as additional data: change any of it and the copy no longer opens.
- **Check:** a fixed text sealed once with the same key, kept in the header. It tells a wrong passphrase (the check fails) from a damaged or altered copy (the check opens, the data doesn't). A copy asking for fewer than 100,000 or more than 5,000,000 rounds is refused as damaged.
- **File:** a first line `daily-planner-sealed/1`, then the envelope as JSON: `{ v, cipher, kdf: { name, hash, iterations, salt }, check: { iv, data }, iv, data }`. Planners before 1.38 read the sync file as JSON, so a sealed copy stops them with an error before they write anything: an older device can never replace a sealed copy with a plain one.
- **Inside:** the sync document, with `copyId` (random, made anew when a copy is first sealed, `copyFrom: 'new'` where there was none and `'continued'` for a plain copy sealed with its records, and when it is started over, `'replaced'`; kept by a change of passphrase) and, after a Switch to Dropbox, `movedTo: 'dropbox'`.

What is where:

| Where | What |
| --- | --- |
| The person's cloud | The sealed copy only. Google or Dropbox see one file, its size and when it changes. |
| This device, IndexedDB `daily-planner-sync` | The key (non-extractable `CryptoKey`), with its salt, rounds and check, so the passphrase is typed once per device. Without IndexedDB (some private windows) it lives in memory for the open page, and the card says the passphrase will be asked again. **Disconnect** forgets it, and deletes the database once no cloud is left connected on the device. |
| This device, `daily-planner-sync:protection` | Nothing secret: the salt and rounds of the current seal, when this device first sealed a copy, and whether the offer to seal an older copy was set aside. Removed by **Disconnect** once no cloud is left connected, so a later Connect starts as on a new device. |
| This device, `daily-planner-sync:ledger` | What changed since the last sync, the hashes agreed on with the copy, and that copy's `copyId`. Removed by Reset local data (1.40.1, with `daily-planner-sync:cloud`, `:google`, `:dropbox`). Kept by Disconnect (with `daily-planner-sync:cloud`, `:google`, `:dropbox`), so connecting again compares instead of overwriting; clearing the site data removes them. |
| This device, `daily-planner-sync:google-access`, `daily-planner-sync:google-account` | Google's access token until it runs out (an hour), and the account's address for `login_hint`. Never in a backup, an export or the synced copy. **Disconnect** forgets both. |
| Our server | Nothing. |

The flows (Settings → Personal sync, `src/features/personal-sync.js`):

- **First device:** connecting finds no copy, so a passphrase is asked first (twice, with a strength hint: at least 10 characters, and not an obvious one). The card says it can't be recovered and that the planner on the device and its backups don't depend on it. Nothing is sent before it is chosen.
- **Another device:** connecting finds a sealed copy and asks for its passphrase once. A wrong one says so and lets the person try again; nothing is written.
- **Changed elsewhere:** a device whose key no longer matches the copy's salt asks for the new passphrase.
- **Change passphrase:** a new salt and key; the copy is opened with the current key and written whole under the new one; the device keeps the new key only once that write succeeded. Other devices ask for the new passphrase once.
- **Forgotten:** a device that still syncs can set a new one (Change passphrase does not ask for the old one: that device already holds the key, and the planner is in the clear on it anyway). With no device left that holds it, **Forgot it?** starts over: the copy is replaced by this device's planner, sealed under a new passphrase, without opening the old one, with a new `copyId`. The other devices then ask for the new passphrase once; seeing another copy, each resets its bases first (`src/sync/engine.js`), so what only they have goes back, what is the same on both sides is agreed on, and wherever they differ from the replacing device the sync stops as a conflict the person settles (**Keep this device** or **Use …**). A device that started over, even a brand-new one with first-run defaults, can never overwrite another device's days or settings silently.
- **A 1.37 plain copy, sealed elsewhere:** a device whose ledger knows no `copyId` but last synced a copy without one on the same cloud (every 1.37 device: the plain Google Drive copy) takes the first id it sees as the same copy when that id was minted by sealing the plain copy with its records (`copyFrom: 'continued'`), and keeps its bases; minted by starting over (`'replaced'`) or for a new file (`'new'`), it is another copy. A plain copy where the ledger knew a sealed one (made again by an older planner) is another copy too.

**Required for new copies, offered for older ones.** Every copy created from 1.38 is sealed: there is no way to connect without a passphrase where no copy exists yet. The passphrase only seals the cloud copy: the planner opens without it, and it is asked once per device, so it costs one field and makes the privacy promise simple: what is in your cloud is sealed. Google Drive copies made before 1.38 keep syncing as they are, on every device, including a new one that joins them: the card offers once to seal it (**Seal your synced copy** · *Not now* · *Choose a passphrase*); set aside, a quiet line stays (“Not sealed … Seal it”). Once a device holds a key, it seals whatever it writes, and a device that has sealed a copy once never writes a plain one again.

Backups (export and import) are unchanged: plain JSON files the person keeps.

## Startup sync

After a user explicitly connects Google Drive, the app remembers that sync is enabled on that device.

Automatic sync — including startup, idle batching, focus/visibility, online, hide, and Close day — runs **only while usable access already exists**: with Google Drive, the access token kept on the device until it runs out; with Dropbox, the token or refresh token kept on the device (renewing it is not a sign-in: it opens nothing). Those paths never call Google Identity Services `requestAccessToken()`, so they cannot open OAuth popups, account choosers, or consent windows in the background.

If the access token is missing or expired, the planner stays fully local and keeps dirty state. With changes waiting, the card turns ochre (“Not saved to Google Drive since 14:58”, how many changes are safe on the device, **Reconnect and save**, and, where Dropbox is offered, **Switch to Dropbox** with an inline confirmation, see above); with nothing waiting, it stays neutral (“Up to date as of 14:58”, **Reconnect**). Only those explicit gestures (or the first **Connect Google Drive**) may invoke interactive Google authorization.

## The choice and the header alert (1.38)

With both clouds offered and none connected, Settings shows two radio cards, Dropbox first and chosen unless the device already named a cloud: Dropbox “Saves on its own”, Google Drive “A tap every hour”. Connected, the card says where the copy was last saved; Google's shows until when its access lasts, with a meter of the hour that remains (drawn again every minute while Settings is open), Dropbox's where its folder is.

Outside Settings, `src/features/sync-status.js` shows an alert before Search only while something waits on the person: Google's (or Dropbox's) access ended with changes waiting, a conflict, or a passphrase the copy waits for. It reads Personal sync through `getState()` and `subscribe()`, and its **Reconnect and save** calls `reconnect()`, which reaches Google's window within the tap. Everything saved, it shows nothing; after a reconnect that saved everything, it says “Saved” for a moment and goes.

## Opportunistic sync

Local edits always write to `localStorage` immediately. Google Drive is not updated on every keystroke.

When sync is connected and local records are dirty, the client batches uploads **when a usable access token is already available**:

- idle wait of about 50 seconds after the latest change;
- maximum wait of about 2 minutes from the first dirty change, even if editing continues;
- checks when the app starts, becomes visible/focused again, or regains network;
- a best-effort attempt when the app becomes hidden;
- a sync attempt after Close day.

If no usable token is available, those triggers do nothing interactive: local edits continue, dirty state remains, and the UI asks the user to reconnect.

**Sync now** uses the current token only. **Reconnect** (and **Reconnect and save**) is the explicit control that may open Google authorization. There is no continuous polling and no backend.

## Recovery snapshots

Before remote changes are applied, Daily Planner attempts to write a local recovery snapshot to IndexedDB. At most five snapshots are retained, and since 1.40 the latest snapshot taken before older days first moved besides (`snapshotsToPrune()` in `src/sync/recovery-store.js`).

These snapshots are a guard against a bad merge or accidental remote change. They are not a substitute for the explicit portable JSON backup, and they stay on the device. Since 1.40, How it works → Data on this device lists them, each with a **Download** that saves it as a backup file Import backup reads.

## Deployment setup

### Google Drive

1. Create or select a Google Cloud project.
2. Enable the Google Drive API.
3. Configure the OAuth consent screen.
4. Create an OAuth 2.0 Web client.
5. Add the planner's production origin as an authorized JavaScript origin. Add the localhost origin used for development if you want to test OAuth locally.
6. Build the planner with the public client ID:

```bash
DAILY_PLANNER_GOOGLE_CLIENT_ID="...apps.googleusercontent.com" npm run build
```

The client ID is public configuration, not a secret. Do not add client secrets to the browser application.

When `DAILY_PLANNER_GOOGLE_CLIENT_ID` is blank, Google Drive isn't offered and no Google request is made.

### Dropbox

Set `DAILY_PLANNER_DROPBOX_APP_KEY` to the App Console's app key (public, never the App secret): the steps are in [configuration.md](configuration.md#dropbox-for-personal-sync-138). Blank, or not the form of an app key, Dropbox isn't offered and no Dropbox request is made. With neither key, the Personal sync section is not rendered.

## What this does not do yet

- field-level merge inside one day;
- continuous background sync after the browser is closed;
- Google Calendar event integration;
- OneDrive or iCloud adapters (the interface in `src/sync/cloud.js` is ready for them);
- remote backup history in Google Drive.

Those are separate concerns and should not be added by weakening the local-first boundary or the conflict policy.
