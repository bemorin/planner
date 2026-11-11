# Optional cloud service boundary

> Status: a client boundary only. No such service exists; the planner is complete and local-first without one.

Daily Planner should remain a complete local-first planner. Cloud functionality, if offered, is an optional service around that local product rather than a requirement for using Day, Week, Horizon, Journal, Unresolved, or local backups.

## Repository boundary

```text
planner/                       this repository, open source (MIT)
├─ local planner runtime
├─ local persistence
├─ offline/PWA behavior
├─ import/export
├─ optional workspace client boundary
├─ personal sync protocol
├─ Google Drive and Dropbox personal sync adapters
└─ UI for an optional account / organization workspace

an organization service        separate, if it is ever built
├─ authentication
├─ organization sync API
├─ shared conflict resolution
├─ organization backups
├─ email / account operations
├─ calendar integrations
└─ deployment / monitoring
```

Such a service should not be implemented as hidden JavaScript injected into the client: code shipped to a browser is inspectable, and this client is open source anyway. The durable boundary is an API: the client knows how to request organization data, while the service owns accounts, organization persistence and operations. Personal sync is a different path: the client synchronizes directly with the user's own cloud storage without sending Personal planner data through any Daily Planner server.


## Workspace boundary

The public client may be built with a `CLOUD_API_URL`. When that value is blank, no workspace request is made and the application behaves exactly like the local-only planner. When an authenticated cloud profile eventually returns organizations, the client can expose **Personal** plus those organization workspaces.

Selecting an organization must never reinterpret the Personal planner as company data. Personal Day, Journal, Horizon, habits, and local notes stay private. Shared calendars, mentions, categories, and future booking surfaces belong to the organization workspace and are loaded through explicit organization-scoped API calls.

## Product principles

1. **Local first.** Creating an account must never be required to use the core planner.
2. **Offline capable.** Losing a network connection must not stop planning or editing local data.
3. **Explicit sync state.** The UI should distinguish local state, pending changes, and confirmed remote state.
4. **Stable identifiers.** Synced entities need durable IDs rather than relying only on dates or array positions.
5. **Deletion is data.** A sync protocol needs tombstones/version metadata so deletions do not silently reappear on another device.
6. **Conflicts are expected.** Concurrent edits across devices must have a defined merge or conflict policy.
7. **The server is not the UI.** Business-critical server behavior stays behind the API; presentation stays in the public client.
8. **Export remains available.** No service may make user data hostage to it.

## What a service could add

An organization service could eventually provide:

- organization and shared synchronization;
- centrally managed backups;
- restore/history;
- account recovery;
- calendar integrations;
- operational monitoring and reliability.

Those are service and infrastructure benefits. The local planner is never degraded to make room for them: everything in it stays free and complete.

## Before implementation

The Personal sync path starts with a sync-safe local data model and protocol:

- stable entity IDs;
- revision/version metadata;
- mutation timestamps or logical clocks;
- deletion/tombstone semantics;
- an API payload format;
- conflict resolution rules;
- migration/versioning strategy.

Only after that contract is tested should a cloud backend be built.
