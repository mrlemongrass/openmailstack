# OpenMailStack Roadmap

Last reviewed: 2026-07-01

This roadmap tracks the remaining product and release work for the modern OpenMailStack suite. The current product direction is a native React webmail, calendar, and contacts experience backed by the Node/Express sync proxy, while Roundcube and older SOGo-compatible paths remain compatibility or fallback surfaces.

## 0. Webmail UI Modernization Pass ✅ (2026-06-30 – 2026-07-01)

The monolithic 7,524-line `App.tsx` has been decomposed into a modern React architecture:

- ✅ **Phase 1 — Architecture & Foundation:** React Router v7 with URL structure (`/mail/inbox/123`, `/calendar/month`, `/contacts`, `/notes`), per-app component directories (`mail/`, `calendar/`, `contacts/`, `notes/`, `settings/`, `admin/`), mobile responsive layout with bottom tab bar, virtual scrolling via `@tanstack/react-virtual`, and skeleton loading states on all list views.
- ✅ **Phase 2 — Mail Polish:** Inline reply box, snooze with preset times + custom picker, drag-and-drop attachments into compose, quick hover actions (archive, delete, read, snooze), raw message viewer with copy-to-clipboard, and print stylesheet.
- ✅ **Phase 3 — Mail Remaining Features:** Custom scheduled send time, Send & Archive, send-as alias identity, attachment size warnings, move-to folder picker, inline image previews, mute/ignore thread, templates/canned responses, and mark-as-unread from viewer. Follow-up nudge, confidential mode, read receipts, and inbox categories are spec'd for future implementation.
- ✅ **Calendar Polish:** Invitation system with guest list and ICS ATTENDEE generation, free/busy lookup endpoint, propose-new-time via event editing, video call auto-generation (Meet/Zoom/Teams), mini-calendar in sidebar, drag-and-drop in month view, create-event-from-text natural language parsing, week numbers, event attachments, and birthdays auto-calendar from contacts. Events-from-email auto-detection spec'd for roadmap.

**Current frontend architecture:**
```
webmail-frontend/src/
├── App.tsx (65 lines — router shell)
├── shared/ (types, api client, hooks, components, layouts)
├── mail/ (12 files — useMail hook, views, compose, skeletons)
├── calendar/ (8 files — useCalendar hook, EventModal, MonthView, sidebar)
├── contacts/ (7 files — useContacts hook, grid, sidebar, skeletons)
├── notes/ (7 files — useNotes hook, grid, sidebar, skeletons)
├── settings/ (routes + existing panel files)
└── admin/ (routes + existing panel files)
```

**Build:** Frontend 380KB JS (115KB gzip), 18KB CSS. Backend TypeScript clean. Both build with zero errors.

## 1. Real Client Validation

- Validate iPhone Exchange setup for Mail, Calendar, and Contacts. ✅
- Validate macOS Mail, Calendar, and Contacts through IMAP, CalDAV, and CardDAV. ✅
- Validate Android mail and DAV clients such as K-9/Thunderbird and DAVx5. ✅
- Validate Thunderbird IMAP/SMTP, CalDAV, and CardDAV. ✅
- Record exact setup steps and failures in `docs/webmail-release-validation.md`. ✅

## 2. Contacts & Notes UI Modernization 🟡

The contacts and notes apps have been extracted into their own directories with routing, hooks, and virtualized views, but still need the full feature pass:

### Contacts (🟡 in progress)
- ✅ Per-app directory with useContacts hook, ContactSidebar, ContactGrid, ContactSkeleton.
- ✅ Virtualized contact grid via @tanstack/react-virtual.
- ✅ Labels and groups sidebar with filtering.
- ✅ Duplicate detection and merging.
- ✅ vCard and CSV import/export.
- ✅ CardDAV and ActiveSync backend.
- ❌ Quick actions from contact cards (email, call, map address).
- ❌ Contact detail inline view (read-only panel, not edit modal).
- ❌ Birthday-to-calendar integration in frontend.
- ❌ Contact restore/trash.
- ❌ Selective export (currently exports all).
- ❌ Contact activity timeline (recent emails with this contact).
- ❌ Contact sharing.

### Notes (🟡 in progress)
- ✅ Per-app directory with useNotes hook, NotesSidebar, NotesGrid, NoteSkeleton.
- ✅ Collaborative editing via Yjs/WebRTC (LiveNoteEditor).
- ✅ Pin, lock, color tags, labels, search.
- ✅ Multi-format import (HTML, PDF, Markdown, JSON) and export (PDF, Markdown, JSON).
- ✅ Apple Notes IMAP sync and ActiveSync support.
- ❌ Checklists/todo items in notes.
- ❌ Image paste and inline display.
- ❌ Table support and code blocks.
- ❌ Sort options (currently by updated date only).
- ❌ Reminders/due dates on notes.
- ❌ File attachments on notes.
- ❌ Undo/redo buttons in editor.
- ❌ Archive (third state between active and trash).

## 3. Calendar Hardening ✅ (2026-06-29)

- ✅ Replace prompt-based calendar creation with the same dialog quality used for calendar edit/delete.
- ✅ Improve event creation and editing with move, drag, resize, calendar switching, and clearer validation.
- ✅ Harden recurring events, recurrence exceptions, reminders (VALARM), attendees (ATTENDEE), free/busy fields (TRANSP), and timezone conversion (TZID).
- ✅ Add calendar search, agenda/list view, import/export, and subscribed calendars (background fetch).
- ✅ Continue hardening CalDAV and ActiveSync sync tokens, tombstones, conflicts, and real-device behavior (sync-collection REPORT, calendar_tombstones, EAS recurrence mapping, EAS Picture/CompanyName/JobTitle).

## 3. Contacts Product Work ✅ (2026-06-29)

- ✅ Build real contact create/edit/delete UI in the webapp.
- ✅ Support multiple emails, phone numbers, addresses, notes, organizations, and contact photos (including photo persistence).
- ✅ Add groups/lists (contact_groups + contact_group_members), vCard import/export, CSV import/export, duplicate detection, and merge workflows.
- ✅ Verify CardDAV and ActiveSync contact add/change/delete behavior on real clients (EAS Picture sync, CompanyName/JobTitle mapping).

## 4. Mail Product Work ✅ (2026-06-29)

- ✅ Add a background search indexing worker so search is not dependent on an active web session (mailbox_credentials for offline indexing).
- ✅ Add richer search operators such as `has:attachment`, `before:`, `after:`, `larger:`, and attachment content search (PDF/Office text extraction).
- ✅ Improve conversation threading, undo send, delayed send, and quota display.
- ✅ Add better attachment handling for inline images, previews, office documents (MIME type support), and draft reliability (beforeunload handler).

## 5. Settings ✅ (2026-06-29)

`settings_plan.md` remains the detailed milestone plan. All milestones are complete:

- ✅ M1: Settings Shell And Navigation
- ✅ M2: Server-Backed Settings Foundation
- ✅ M2A: Admin Branding Settings
- ✅ M3: Mail Settings Product Pass
- ✅ M4: Calendar Settings Product Pass
- ✅ M5: Contacts Settings Product Pass
- ✅ M6: Account, Security, And Release Hardening

## 6. Security And Enterprise Readiness 🟡

- 🟡 Replace reversible mailbox-credential storage with Dovecot master-user auth, app passwords, or another delegated credential model (master-user auth implemented as optional env vars; needs Dovecot server-side config).
- 🟡 Set and document an explicit high-entropy `OMS_SESSION_SECRET` for production.
- ❌ Add two-factor authentication or app-password support.
- ❌ Audit admin RBAC and domain scoping endpoint by endpoint.
- ✅ Harden ActiveSync contact photos, conflict handling, tombstones, and long-running incremental sync (EAS calendar tombstones, recurrence mapping, Picture sync).
- ❌ Revisit ManageSieve response parsing before treating complex filter editing as enterprise-grade.

## 7. Admin Dashboard Overhaul & Telemetry 🟡

- 🟡 **Phase 1: Admin CRUD Modernization**: Replace all `window.prompt()` calls for Domain, Mailbox, Alias, and API Key creation with polished React Modals. API key prompt replaced with clipboard copy; creation modals already exist; deletion confirmations still use `window.confirm()`.
- 🟡 **Phase 2: Live Telemetry**: Add a "Telemetry & Logs" tab. System Health Dashboard and TelemetryPanel exist. Prometheus /metrics endpoint implemented. SSE journald streaming and OpenTelemetry tracing not yet wired.
- ❌ **Phase 3: Event-Driven Webhooks**: Add a "Webhooks" configuration tab and wire the backend to fire HTTP webhooks on key lifecycle events (user created, spam detected, etc).

## 8. Installer, Release, And Operations ❌

- ❌ Validate the modern webmail installer path on a clean VM.
- ❌ Make Nginx route injection idempotent and safe on already-migrated hosts.
- ✅ Keep generated backend JavaScript in sync while systemd still runs `node src/index.js`.
- ❌ Add clearer upgrade/rollback docs that explicitly preserve live mail data.
- 🟡 Improve monitoring for Rspamd proxy health, Postfix milter timeouts, Dovecot auth, disk space, queues, and certificate expiry (Fail2ban implemented, milter timeouts configured, System Health Dashboard live).
- ❌ Remove or clearly mark deprecated scaffold directories once the migration is complete.

## 9. OpenMailStack Sync (External CardDAV Bridge) ❌

- ❌ **Rust Sync Daemon**: Build a standalone, high-performance background daemon using Rust (`tokio`, `quick-xml`) to handle XML parsing, delta syncing (`sync-collection`), and conflict resolution (Last Writer Wins).
- ❌ **Control Plane (Node.js)**: Build API endpoints to manage credentials and sync jobs, securely storing encrypted App-Specific Passwords (AES-256-GCM) in MySQL.
- ❌ **Settings UI (React)**: Create a React-based connection wizard in the settings panel to allow users to link iCloud, Google Contacts, and custom CardDAV servers.
- ❌ **Continuous Syncing**: Complete engine implementation to successfully push, pull, and merge vCards continuously in the background, serving as a native, free alternative to premium services like sync.blue.
