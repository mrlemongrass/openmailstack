# OpenMailStack Roadmap

Last reviewed: 2026-08-04

This roadmap tracks the remaining product and release work for the modern OpenMailStack suite. The current product direction is a native React webmail, calendar, and contacts experience backed by the Node/Express sync proxy, while Roundcube and older SOGo-compatible paths remain compatibility or fallback surfaces.

## 0. Webmail UI Modernization Pass ✅ (2026-06-30 – 2026-07-01)

The monolithic 7,524-line `App.tsx` has been decomposed into a modern React architecture:

- ✅ **Phase 1 — Architecture & Foundation:** React Router v7 with URL structure (`/mail/inbox/123`, `/calendar/month`, `/contacts`, `/notes`), per-app component directories (`mail/`, `calendar/`, `contacts/`, `notes/`, `settings/`, `admin/`), mobile responsive layout with bottom tab bar, virtual scrolling via `@tanstack/react-virtual`, and skeleton loading states on all list views.
- ✅ **Phase 2 — Mail Polish:** Inline reply box, snooze with preset times + custom picker, drag-and-drop attachments into compose, quick hover actions (archive, delete, read, snooze), raw message viewer with copy-to-clipboard, and print stylesheet.
- ✅ **Phase 3 — Mail Remaining Features:** Custom scheduled send time, Send & Archive, send-as alias identity, attachment size warnings, move-to folder picker, inline image previews, mute/ignore thread, templates/canned responses, mark-as-unread from viewer, and deployed cursor-based endless message loading that preserves loaded depth across refreshes and actions. Follow-up nudge, confidential mode, read receipts, and inbox categories are spec'd for future implementation.
- ✅ **Calendar Polish:** Invitation system with guest list and ICS ATTENDEE generation, free/busy lookup endpoint, propose-new-time via event editing, video call auto-generation (Meet/Zoom/Teams), mini-calendar in sidebar, drag-and-drop in month view, create-event-from-text natural language parsing, week numbers, event attachments, and birthdays auto-calendar from contacts. Events-from-email auto-detection spec'd for roadmap.

**Current frontend architecture:**
```
webmail-frontend/src/
├── App.tsx (270 lines — router shell)
├── shared/ (17 files — types, API client, hooks, components, layouts)
├── mail/ (19 files — useMail hook, views, compose, skeletons)
├── calendar/ (9 files — useCalendar hook, EventModal, MonthView, sidebar)
├── contacts/ (11 files — useContacts hook, grid, sidebar, skeletons)
├── notes/ (12 files — useNotes hook, grid, sidebar, skeletons)
├── settings/ (routes + existing panel files)
└── admin/ (routes + existing panel files)
```

**Build:** The July 20 production frontend build totals 1,676,189 bytes of JS (476,967 bytes gzip) and 88,219 bytes of CSS (16,112 bytes gzip). Frontend and backend build with zero errors.

## 1. Real Client Validation

- Validate iPhone Exchange setup for Mail, Calendar, and Contacts. ✅
- Validate macOS Mail, Calendar, and Contacts through IMAP, CalDAV, and CardDAV. ✅ (Protocol lifecycles pass; the Contacts Default Account picker omission remains a documented macOS UI issue.)
- Validate Android mail and DAV clients such as K-9/Thunderbird and DAVx5. ✅ (Android 11 emulator)
- Validate Thunderbird IMAP/SMTP, CalDAV, and CardDAV. ✅
- Record exact setup steps and failures in `docs/webmail-release-validation.md`. ✅

Current note: iOS 26.5.2 Exchange Mail/Calendar/Contacts pass on the live server after the July 2026 protocol fixes. The iOS partnership exhausted and exactly reconciled its Inbox, reached stable no-change polling, and now holds 6,243 saved Inbox identities with a nonzero checkpoint/MODSEQ, zero pending commands, and `MoreAvailable=false`. The July 31 blank-body defect was caused by inheriting a 500-byte list-preview limit for a full MIME request; the bounded fix is deployed and the owner confirmed physical iOS Exchange rendering works normally. macOS 26.5.2 Mail, Calendar CalDAV, and the targeted CardDAV create/delete lifecycle pass. HouseVo nevertheless remains absent from Contacts' Default Account menu, isolating that issue to the macOS picker rather than server writability. The ineffective aggregate `DAV:write` experiment was removed at `35d29345`; do not add ACL/home-management claims or mutate private Apple account databases. Thunderbird 140.12.0esr on Debian 13.6 and Thunderbird Android 21.0 plus DAVx5 4.5.18-ose on Android 11 passed their mail/DAV lifecycles, with exact disposable state removed. Mozilla Autoconfiguration at `63683df8` is now publicly closed: DNS and the active certificate cover `autoconfig.housevo.us`, and fresh Thunderbird 140.12.0esr and Thunderbird Android 21.1 runs automatically selected full-address usernames, IMAP 993 SSL/TLS, and SMTP 587 STARTTLS and authenticated without manual correction.

## 2. Contacts & Notes UI Modernization 🟡

The contacts and notes apps have been extracted into their own directories with routing, hooks, and virtualized views, but still need the full feature pass:

### Contacts (✅ shipped)
- ✅ Per-app directory with useContacts hook, ContactSidebar, ContactGrid, ContactSkeleton.
- ✅ Virtualized contact grid via @tanstack/react-virtual.
- ✅ Labels and groups sidebar with filtering.
- ✅ Duplicate detection and merging.
- ✅ vCard and CSV import/export.
- ✅ CardDAV and ActiveSync backend.
- ✅ Quick actions from contact cards (email, call, map address).
- ✅ Contact detail inline view with explicit edit, share, and delete actions.
- ✅ Birthday-to-calendar integration through the generated Birthdays calendar.
- ✅ Contact restore/trash with permanent-delete confirmation.
- ✅ Selective vCard and CSV export for chosen contacts.
- ✅ Contact activity timeline for recent email and owner-scoped Calendar activity.
- ✅ Contact sharing through an owned, generated vCard handoff.
- 🟡 UUID-backed CardDAV/vCard identity is implemented for web/API/CSV/vCard
  contact creation, and duplicate repair keeps the UUID row as primary without
  rewriting legacy rows. Deployment and one physical macOS edit/merge retry
  remain before this compatibility fix is closed.

### Notes (🟡 in progress)
- ✅ Per-app directory with useNotes hook, NotesSidebar, NotesGrid, NoteSkeleton.
- ✅ Opt-in, self-hosted WebRTC collaboration is live through same-origin signaling and short-lived, session-bound owner capabilities. Same-account sessions can collaborate without exposing note IDs as room credentials.
- 🟡 Cross-account invitations, sharing permissions, and collaborative-room membership remain future work.
- 🔴 Notes IMAP persistence can duplicate a message during rapid save/close/delete synchronization; the exact live probe was cleaned from SQL and IMAP, but the write/delete lifecycle needs a data-integrity fix before further collaboration scope.
- ✅ Pin, lock, color tags, labels, search.
- ✅ Multi-format import (HTML, PDF, Markdown, JSON) and export (PDF, Markdown, JSON).
- ✅ Apple Notes IMAP sync and ActiveSync support.
- ✅ Checklists/todo items in notes.
- ✅ Image upload, inline display, and direct clipboard-image paste are implemented. Image-only clipboard HTML is routed through the authenticated upload path instead of becoming a base64 document embed; mixed text/image clipboard content retains native rich-paste behavior.
- ✅ Table support and code blocks.
- ✅ Sort options.
- ✅ Reminders/due dates on notes.
- ✅ File attachments on notes.
- ✅ Undo/redo buttons in editor.
- ✅ Archive (third state between active and trash).

## 3. Calendar Hardening ✅ (Revalidated 2026-07-20)

The reopened-timezone work now distinguishes UTC, `TZID`, floating, and all-day values; applies System/Home display zones across the current Calendar views/editor; and adds the optional desktop clock. EAS recurring-event `TimeZone` blobs now encode/decode the 172-byte `TIME_ZONE_INFORMATION` structure, validate Windows/IANA names against the binary rule, and preserve wall time across DST. Recurrence exceptions, display reminders, and conservative custom/invalid `VTIMEZONE` handling pass automated iCalendar, OMS Web, EAS, real-WBXML, guarded live deployment, and physical Apple-client gates. Physical macOS 26.5.2 CalDAV and iOS 26.5.2 ActiveSync passed fixed-zone CRUD, New York weekly DST projection, edit-one/delete-one recurrence exceptions, inherited/overridden reminders, and deliberate whole-series cleanup.

- ✅ Replace prompt-based calendar creation with the same dialog quality used for calendar edit/delete.
- ✅ Improve event creation and editing with move, drag, resize, calendar switching, and clearer validation.
- ✅ Harden recurring events, recurrence exceptions, reminders (VALARM), attendees (ATTENDEE), free/busy fields (TRANSP), and timezone conversion. Core UTC/`TZID`/floating/all-day parsing, deterministic DST gap/overlap handling, display projection, EAS origin-timezone recurrence, recurrence exceptions/reminders, conservative custom/invalid `VTIMEZONE` behavior, disposable protocol/browser checks, guarded deployment, and physical macOS CalDAV plus iOS ActiveSync CRUD/DST/exception/reminder projection pass.
- ✅ Add calendar search, agenda/list view, import/export, and subscribed calendars (background fetch).
- ✅ Continue hardening CalDAV and ActiveSync sync tokens, tombstones, conflicts, and real-device behavior (sync-collection REPORT, calendar_tombstones, EAS recurrence mapping, EAS Picture/CompanyName/JobTitle).

## 3. Contacts Product Work ✅ (2026-06-29)

- ✅ Build real contact create/edit/delete UI in the webapp.
- ✅ Support multiple emails, phone numbers, addresses, notes, organizations, and contact photos (including photo persistence).
- ✅ Add groups/lists (contact_groups + contact_group_members), vCard import/export, CSV import/export, duplicate detection, and merge workflows.
- ✅ Verify CardDAV and ActiveSync contact add/change/delete behavior on real clients (EAS Picture sync, CompanyName/JobTitle mapping).

## 4. Mail Product Work ✅ (2026-06-29)

- ✅ ActiveSync Mail has user/device/folder-scoped delta state, source-folder deletes for web moves, destination-folder adds, bounded FilterType/WindowSize/body retrieval, complete FilterType-0 paging, and efficient no-change polls. The physical iOS 26.5.2 partnership exhausted its Inbox catch-up and reconciled exact saved identities. A 2026-08-03 read-only checkpoint shows 6,243 saved Inbox identities, a nonzero key/MODSEQ, `MoreAvailable=false`, and zero pending commands; the owner confirmed iOS Exchange, iOS IMAP, and macOS Mail all look correct.
- ✅ The July 31 MIME-body hotfix stops an explicit iOS `BodyPreference Type=4` request with no `TruncationSize` from inheriting the earlier 500-byte Type-1 preview limit. Unit, authenticated-smoke, mandatory release-gate, and physical iPhone validation now pass: after the fix the owner reported iOS Exchange working normally and identified Sieve—not empty message bodies—as the only remaining mail issue. Rollback remains `/var/backups/openmailstack/20260731T203319Z-eas-mime-body/`.
- 🟡 Webmail search interaction, correctness, and the first production performance pass are deployed (2026-07-21): 300 ms debounce plus immediate Enter submission, explicit field/current-folder/all-mail controls, folder-safe Move actions, and bounded partial-result handling remain intact. Commit `4b0eb69d` uses Boolean FULLTEXT for ordinary terms, preserves LIKE semantics for short/quoted/default-stopword terms, aborts superseded requests, consolidates folder status through LIST-STATUS where supported, and serves recent worker-certified complete indexes without synchronous IMAP. Incomplete or failed cycles invalidate older snapshots; certification requires same-cycle move/delete reconciliation. Live Boolean ranking returned 50 bounded rows in about 85 ms, while the removed dual-MATCH shape took about 6.3 seconds on the same production data.
- ✅ Add a background search indexing worker so search is not dependent on an active web session (mailbox_credentials for offline indexing).
- ✅ Add richer search operators such as `has:attachment`, `before:`, `after:`, `larger:`, and attachment content search (PDF/Office text extraction).
- ✅ Improve conversation threading, undo send, delayed send, and quota display.
- ✅ Add better attachment handling for inline images, previews, office documents (MIME type support), and draft reliability (beforeunload handler).

## 5. Settings ✅ (Calendar Time Revalidated 2026-07-20)

`settings_plan.md` remains the detailed milestone plan. The persistence and settings-shell milestones shipped, and Calendar time behavior has now passed its reopened validation:

- ✅ M1: Settings Shell And Navigation
- ✅ M2: Server-Backed Settings Foundation
- ✅ M2A: Admin Branding Settings (site-wide persistence and automatic image fitting hardened and deployed 2026-07-12)
- ✅ M3: Mail Settings Product Pass
- ✅ M3A: Ordered Mail Rules And Existing-Mail Runner — saved rules have explicit top-down priority, per-rule stop/continue behavior, and a preview-first runner for any existing folder. Apply is bound to the previewed rule revision, UIDVALIDITY, and UID snapshot; continued multi-destination actions use durable exact-action recovery.
- ✅ M4: Calendar Settings Product Pass — System/Home timezone projection and the optional clock are deployed; physical macOS CalDAV and iOS ActiveSync CRUD/DST projection pass.
- ✅ M5: Contacts Settings Product Pass
- ✅ M6: Account, Security, And Release Hardening

## 6. Security And Enterprise Readiness 🟡

- ✅ Resolve the production dependency advisories surfaced on 2026-08-03.
  DOMPurify, Socket.IO parser, `ip-address`, MailParser/linkify, PostCSS, and
  brace-expansion are patched on Node 20.19. The backend audit is clean; the
  frontend audit reports only React Router GHSA-qwww-vcr4-c8h2, whose official
  advisory applies only to unstable RSC APIs. OpenMailStack is a Vite browser
  SPA with no RSC API, package, server entrypoint, or action header, enforced
  by `dependency_security_guard.cjs`. React Router 8.3.0 is deferred because
  it requires Node 22.22 and React 19.2.7 rather than the supported Node 20
  baseline. Commit `0236f008` is deployed behind passing public protocol and
  staging gates.
- ✅ Replace reversible mailbox-credential storage with delegated Dovecot master-user auth. The installer now creates the root-only raw secret and Dovecot-readable hash, IMAP/SMTP/ManageSieve use the delegated identity, DAV and ActiveSync still validate supplied user credentials directly, and session/offline-index rows retain encrypted empty values rather than mailbox passwords.
- ✅ Set and document an explicit high-entropy `OMS_SESSION_SECRET` for production. Production startup rejects missing/short values and upgrades generate and preserve a 64-character secret.
- ✅ Add two-factor authentication and app-password support. TOTP with one-time recovery codes, purpose-separated encrypted secrets, protocol-capable per-device app passwords, session/app-password revocation, and primary-password blocking while 2FA is enabled are deployed and live-validated.
- ✅ Audit admin RBAC and domain scoping endpoint by endpoint. All 47 modern Admin routes require a fresh active-superadmin check; the legacy session API now applies explicit global, domain, self-service, and quarantine policies. The completed inventory and boundary decisions are recorded in `docs/engineering/ADMIN_RBAC_AUDIT.md`.
- ✅ Harden ActiveSync contact photos, conflict handling, tombstones, and long-running incremental sync (EAS calendar tombstones, recurrence mapping, Picture sync).
- ✅ Harden ManageSieve response parsing for complex filter editing. The client
  now frames responses as bytes, skips exact UTF-8 literal lengths before
  recognizing terminal status lines, requires a complete CRLF status, rejects
  incomplete peer closes, and caps literals at 10 MiB with bounded response
  overhead. Focused chunk/EOF/limit regressions, the full test suite, guarded
  deployment, and three consistent read-only live script retrievals pass.

## 7. Admin Dashboard Overhaul & Telemetry 🟡

- 🟡 **Phase 1: Admin CRUD Modernization**: Replace all `window.prompt()` calls for Domain, Mailbox, Alias, and API Key creation with polished React Modals. API key prompt replaced with clipboard copy; creation modals already exist; deletion confirmations still use `window.confirm()`.
- 🟡 **Phase 2: Live Telemetry**: Add a "Telemetry & Logs" tab. System Health Dashboard and TelemetryPanel exist. Prometheus /metrics endpoint implemented. SSE journald streaming and OpenTelemetry tracing not yet wired.
- ❌ **Phase 3: Event-Driven Webhooks**: Add a "Webhooks" configuration tab and wire the backend to fire HTTP webhooks on key lifecycle events (user created, spam detected, etc).

## 8. Installer, Release, And Operations ❌

- ✅ Add a fail-closed installed-host release gate that authenticates through
  strict public IMAPS 993 and ActiveSync against one disposable canary message.
  Webmail and Dovecot deployment modules now require the guarded pre/post gate
  and automatic rollback workflow once the host sentinel is provisioned.
- ❌ Validate the modern webmail installer path on a clean VM.
- ❌ Make Nginx route injection idempotent and safe on already-migrated hosts.
- ✅ Keep generated backend JavaScript in sync while systemd still runs `node src/index.js`.
- ❌ Add clearer upgrade/rollback docs that explicitly preserve live mail data.
- 🟡 Improve monitoring for Rspamd proxy health, Postfix milter timeouts, Dovecot auth, disk space, queues, and certificate expiry (Rspamd normal-scan plus real Milter health, cross-probe crash detection, rate-limited Rspamd-only recovery, Fail2ban, milter timeouts, and System Health Dashboard are live; broader certificate/disk/auth alerting remains).
- ❌ Remove or clearly mark deprecated scaffold directories once the migration is complete.

## 9. OpenMailStack Sync (External CardDAV Bridge) ❌

One-time, reviewed imports now precede continuous synchronization. The Migration Center roadmap in `docs/product/time-drive-migration.md` reuses existing vCard/CSV work, adds ICS after the timezone repair, then adds Google/Microsoft OAuth and guided iCloud imports. The daemon below remains later two-way-sync scope, not a prerequisite for migration.

- ❌ **Rust Sync Daemon**: Build a standalone, high-performance background daemon using Rust (`tokio`, `quick-xml`) to handle XML parsing, delta syncing (`sync-collection`), and conflict resolution (Last Writer Wins).
- ❌ **Control Plane (Node.js)**: Build API endpoints to manage credentials and sync jobs, securely storing encrypted App-Specific Passwords (AES-256-GCM) in MySQL.
- ❌ **Settings UI (React)**: Create a React-based connection wizard in the settings panel to allow users to link iCloud, Google Contacts, and custom CardDAV servers.
- ❌ **Continuous Syncing**: Complete engine implementation to successfully push, pull, and merge vCards continuously in the background, serving as a native, free alternative to premium services like sync.blue.

## 10. OMS Scheduler 🟡

`docs/product/scheduler.md` is the detailed product, parity, architecture, and delivery roadmap.

- ✅ **Phase 0 foundation complete and deployed with Phase 1**: DST-safe availability and host/booker timezone projection, versioned slot inventory/hold migration, transactional MariaDB repository, booking/provider/outbox/audit contracts, tenant authorization, threat model, and automated parity register are implemented. Unit/contract tests and a disposable MariaDB 11 two-connection capacity-one race pass; migration `001` is now recorded live.
- ✅ **Phases 1 and 2 complete and live**: installation/entitlements, event types, availability, native booking, private/one-off links, booking integrity, policy-preserving waitlists, DST-safe recurring series, meeting polls, delegation/outcomes, public embeds/customization/attribution, and guided import/export are live through migration `023`. Hardening commit `60864417` revalidated migrations `001`-`023` twice and all 90 backend tests without skips, including verification and attendee-policy changes after waitlist admission; the changed runtime artifacts are deployed and byte-for-byte equal. A real create/reschedule/cancel cycle passed SMTP, outbox, Calendar projection, tombstone, capacity-release, and public-slot restoration checks. Physical CalDAV/ActiveSync observation remains pending; clean-VM validation is deferred until a second development Linux server is available.
- ✅ **Phase 3 complete and live**: migrations `024`-`025` and the deployed application bundle provide owner/Admin APIs, the native builder, immutable cloning/publishing, safe template variables, conditions, preview/test sends, request/start/end/confirmation/rejection/reschedule/cancellation/completion/no-show triggers, email/in-app/mandatory-signed webhook actions, observable recovery, provider health/queue metrics, and administrator-supplied SMS/WhatsApp/voice/translation adapters with credential/cost disclosure. Booking-scoped consent plus stable confirm-before-mutate unsubscribe, versioned encryption keys, DNS-pinned SSRF protection, and delivery-uncertainty reconciliation are covered. Disposable MariaDB and real Express authorization gates pass 114 backend tests without skips; deployed artifacts are exact, the API/worker/Rspamd/staging gates pass, and the rollback snapshot is `/var/backups/openmailstack/20260716T151429Z-scheduler-phase3`. External channels remain provider-dependent and clean-VM validation remains deferred.
- ✅ Add **Scheduler** immediately after **Notes** in the desktop and mobile web-app navigation.
- ✅ Add an optional installer choice persisted as `ENABLE_OMS_SCHEDULER`, and install no Scheduler components when it is disabled.
- ✅ Let only authorized admins enable/disable Scheduler per mailbox; installation alone must not publish or entitle users.
- ✅ Publish enabled users at `/scheduler/<local-part>` without the mail domain, with admin-assigned alternate handles for reserved/invalid names or cross-domain collisions.
- ✅ Serve the same Scheduler path on every configured OMS webmail hostname; use a configured preferred base URL for generated links and provision configured aliases into Nginx and TLS SANs.
- ✅ Deliver native individual event types, availability, public booking, secure reschedule/cancel, OMS Calendar projection, and OMS email notifications.
- ✅ Reach Phase 2 personal parity with advanced limits, overrides, holidays/out-of-office, private/single-use/one-off links, seats and waitlists, recurring bookings, meeting polls, no-show/delegation, embed variants, prefill/UTM, customization/locale/timezone lock, and guarded migration/import.
- ✅ Complete the guarded live rollout of migration `025` and the tested Phase 3 workflow/Admin/public UI bundle. External messaging, voice, and automatic translation are live as administrator-configured provider capabilities; no provider is bundled or enabled by default.
- ❌ Add teams, collective/group/round-robin/managed events, delegated scheduling, routing forms, attributes, fairness, and explainable assignment.
- ❌ Add payments, external calendars/conferencing, CRM/automation adapters, analytics, public APIs, OAuth, CLI, embeds, and MCP/agent support. Phase 3 workflow webhooks are implemented; broader public integration webhooks remain in this later scope.
- ❌ Add enterprise organization controls, SSO/SCIM reuse, audit/export/deletion/retention, operational recovery, and continuous competitor-parity review.

## 11. Time, OMS Drive, And Migration Center 🟡

`docs/product/time-drive-migration.md` is the implementation roadmap and decision record for the new suite expansion.

- ✅ **Track T — Time correctness and clock:** core semantics, System/Home projection, active-zone labeling, the optional desktop clock, EAS recurrence origin-timezone blobs, exception/reminder conversion, conservative custom/invalid `VTIMEZONE` handling, disposable CalDAV/ActiveSync/Scheduler/DST checks, real Chromium/WebKit checks, guarded production rollout, and physical macOS 26.5.2 CalDAV plus iOS 26.5.2 ActiveSync CRUD/DST/exception/reminder projection pass.
- ❌ **Track F — OMS Drive and connected files:** add an optional, Admin-entitled native file service; a shared, resizable file tray; safe attach-copy flows into Mail, Notes, Calendar, and Scheduler; and capability-aware Nextcloud/OpenCloud, Google Drive, and OneDrive connectors.
- ❌ **Track M — Migration Center:** unify reviewed vCard/CSV/ICS import, then add resumable read-only Google and Microsoft migration plus guided iCloud export/import. Continuous two-way sync remains a separate later phase.
- ⚠️ **iCloud Drive constraint:** keep browser/Apple Files upload available, but do not promise persistent server-side iCloud Drive browsing until a supported Apple integration path is proven.
