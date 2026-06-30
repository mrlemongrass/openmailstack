# OpenMailStack Roadmap

Last reviewed: 2026-06-29

This roadmap tracks the remaining product and release work for the modern OpenMailStack suite. The current product direction is a native React webmail, calendar, and contacts experience backed by the Node/Express sync proxy, while Roundcube and older SOGo-compatible paths remain compatibility or fallback surfaces.

## 1. Real Client Validation

- Validate iPhone Exchange setup for Mail, Calendar, and Contacts. ✅
- Validate macOS Mail, Calendar, and Contacts through IMAP, CalDAV, and CardDAV. ✅
- Validate Android mail and DAV clients such as K-9/Thunderbird and DAVx5. ✅
- Validate Thunderbird IMAP/SMTP, CalDAV, and CardDAV. ✅
- Record exact setup steps and failures in `docs/webmail-release-validation.md`. ✅

## 2. Calendar Hardening ✅ (2026-06-29)

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
