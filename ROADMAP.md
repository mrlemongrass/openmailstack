# OpenMailStack Roadmap

Last reviewed: 2026-06-21

This roadmap tracks the remaining product and release work for the modern OpenMailStack suite. The current product direction is a native React webmail, calendar, and contacts experience backed by the Node/Express sync proxy, while Roundcube and older SOGo-compatible paths remain compatibility or fallback surfaces.

## 1. Real Client Validation

- Validate iPhone Exchange setup for Mail, Calendar, and Contacts.
- Validate macOS Mail, Calendar, and Contacts through IMAP, CalDAV, and CardDAV.
- Validate Android mail and DAV clients such as K-9/Thunderbird and DAVx5.
- Validate Thunderbird IMAP/SMTP, CalDAV, and CardDAV.
- Record exact setup steps and failures in `docs/webmail-release-validation.md`.

## 2. Calendar Hardening

- Replace prompt-based calendar creation with the same dialog quality used for calendar edit/delete.
- Improve event creation and editing with move, drag, resize, calendar switching, and clearer validation.
- Harden recurring events, recurrence exceptions, reminders, attendees, free/busy fields, and timezone conversion.
- Add calendar search, agenda/list view, import/export, and subscribed calendars.
- Continue hardening CalDAV and ActiveSync sync tokens, tombstones, conflicts, and real-device behavior.

## 3. Contacts Product Work

- Build real contact create/edit/delete UI in the webapp.
- Support multiple emails, phone numbers, addresses, notes, organizations, and contact photos.
- Add groups/lists, vCard import/export, CSV import/export, duplicate detection, and merge workflows.
- Verify CardDAV and ActiveSync contact add/change/delete behavior on real clients.

## 4. Mail Product Work

- Add a background search indexing worker so search is not dependent on an active web session.
- Add richer search operators such as `has:attachment`, `before:`, `after:`, `larger:`, and attachment content search.
- Improve conversation threading, undo send, delayed send, and quota display. (Completed: draft reliability, vacation responses, keyboard shortcuts, and mail accessibility).
- Add better attachment handling for inline images, previews, office documents, and large attachments.

## 5. Settings

`settings_plan.md` remains the detailed milestone plan. The short version:

- Create a proper Settings shell for Mail, Calendar, Contacts, and Account & Security.
- Add server-backed user settings so preferences roam across browsers and devices.
- Move signatures, threaded view, calendar defaults, contact display preferences, and other product preferences out of local-only storage.
- Wire password changes, active sessions, and security controls only when real backend support exists.

## 6. Security And Enterprise Readiness

- Replace reversible mailbox-credential storage with Dovecot master-user auth, app passwords, or another delegated credential model.
- Set and document an explicit high-entropy `OMS_SESSION_SECRET` for production.
- Add two-factor authentication or app-password support.
- Audit admin RBAC and domain scoping endpoint by endpoint.
- Harden ActiveSync contact photos, conflict handling, tombstones, and long-running incremental sync.
- Revisit ManageSieve response parsing before treating complex filter editing as enterprise-grade.

## 7. Admin Dashboard Overhaul & Telemetry

- **Phase 1: Admin CRUD Modernization**: Replace all `window.prompt()` calls for Domain, Mailbox, Alias, and API Key creation with polished React Modals. Add form-level validation.
- **Phase 2: Live Telemetry**: Add a "Telemetry & Logs" tab. Implement a backend SSE endpoint to stream live `journald` logs to a terminal UI. Add a Prometheus `/metrics` endpoint and OpenTelemetry tracing to the Node server.
- **Phase 3: Event-Driven Webhooks**: Add a "Webhooks" configuration tab and wire the backend to fire HTTP webhooks on key lifecycle events (user created, spam detected, etc).

## 8. Installer, Release, And Operations

- Validate the modern webmail installer path on a clean VM.
- Make Nginx route injection idempotent and safe on already-migrated hosts.
- Keep generated backend JavaScript in sync while systemd still runs `node src/index.js`.
- Add clearer upgrade/rollback docs that explicitly preserve live mail data.
- Improve monitoring for Rspamd proxy health, Postfix milter timeouts, Dovecot auth, disk space, queues, and certificate expiry.
- Remove or clearly mark deprecated scaffold directories once the migration is complete.
