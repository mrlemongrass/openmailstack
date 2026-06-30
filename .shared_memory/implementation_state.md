# Implementation State

Last reviewed: 2026-06-29. All 6 settings milestones complete. Major feature passes delivered across calendar, contacts, mail, security, admin, and ActiveSync.

## 2026-06-29 Additions

**Settings**: All 6 milestones (M1–M6) plus M2A (Admin Branding) complete. Server-backed settings for mail/calendar/contacts/appearance with debounced auto-save, save-state indicators, real session listing/revocation, and allowUserPasswordChange enforcement.

**Calendar**: Modal-based calendar creation/edit, event drag-and-drop and resize with 15-min snap, recurrence exceptions (EXDATE/RECURRENCE-ID), VALARM/ATTENDEE/TRANSP/TZID iCal properties, subscribed calendar background fetch worker (15min), CalDAV sync-collection REPORT with tombstone tracking (calendar_tombstones table), agenda/list view, .ics import/export with in-app feedback.

**Contacts**: Full contact CRUD modal with photo persistence, enriched vCard/CSV import (ORG/TITLE/NOTE/ADR), contact groups/lists (contact_groups + group_members tables, sidebar UI, inline CRUD, click-to-filter), list density presets (cozy/compact/comfortable), nameFormat/sortBy in compose autocomplete.

**Mail**: Session-independent background indexing (mailbox_credentials for offline access), PDF/Office attachment text extraction (pdf-parse + XML stripping), draft beforeunload warning, office document MIME types in isPreviewableAttachment.

**Security**: Optional Dovecot master-user auth (OMS_IMAP/SMTP/SIEVE_MASTER_USER/_PASS env vars, {user}*{master} format in ImapService/ManageSieveClient). Credentials remain AES-256-GCM encrypted.

**Admin**: API key prompt replaced with clipboard copy. Creation modals fully functional. window.confirm() still used for deletion safety (acceptable pattern).

**ActiveSync**: Calendar tombstone tracking in EAS path, outgoing tombstone Delete commands, recurrence RRULE↔EAS mapping, contact Picture↔photo_url sync, CompanyName/JobTitle mapping, fixed shouldSendEvents bug.

Product direction:

- Build a fast modern webmail, calendar, and contacts suite comparable in ambition to Gmail, Outlook 365, and Proton Mail.
- Reverse engineering SOGo is a means to preserve compatibility, especially ActiveSync/autodiscover behavior, not the product destination.
- iOS onboarding target: user selects "Exchange" and autodiscover adds mail/calendar/contacts.
- macOS/desktop sync target: IMAP for mail, CalDAV for calendar, CardDAV for contacts.
- React web UI should be treated as the primary product surface.

Installer and platform scripts:

- `install.sh` uses strict bash mode, detects OS through `functions/lib_os.sh`, supports `--dry-run`, checks root/config/default passwords/domain, detects existing components, offers missing-component install, reinstall, rollback, or exit, and reports soft errors on exit.
- Supported platforms in code: Debian 11/12/13, Ubuntu 22/24/25, Alma/Rocky/RHEL 8/9, CentOS Stream 9.
- `functions/lib_os.sh` centralizes package manager, web user/group, package translation, PHP-FPM detection, and Rspamd repo codename mapping.
- `functions/backup_restore.sh` provides backup/restore for existing installs.
- Several module scripts still `source ./config.conf`, so direct module execution assumes the repo root as current working directory even though `install.sh` itself is path-aware.
- `tests/lint/run.sh` runs `bash -n` and optional `shellcheck`. `tests/integration/run.sh` checks installer/config guard patterns and a local `install.sh --dry-run`.
- `functions/10_webmail.sh` deploys the modern webmail: installs Node/npm/rsync, enforces Node.js >= 20.19.0, builds frontend/backend, installs `/opt/openmailstack-backend`, renders `/etc/openmailstack/webmail-backend.env`, installs `openmailstack.service`, deploys static frontend files to `/var/www/openmailstack`, and injects Nginx routes for `/`, `/api`, `/caldav`, autodiscover, well-known CalDAV/CardDAV, and ActiveSync.

PHP admin portal:

- `admin_portal_src/public/index.php` creates a session CSRF token and exposes it as a meta tag.
- `admin_portal_src/public/api.php` validates CSRF on POST, uses PDO prepared statements for most DB work, supports admin and self-service user roles, domain verification tokens, DNS/DKIM display, mailbox/domain/alias/admin/API key management, spam policies, quarantine actions, system health, and upgrade triggering.
- `admin_portal_src/public/js/app.js` sends `X-CSRF-Token` through `apiCall()` and has an `escapeHTML()` helper applied across many rendered values.
- `admin_portal_src/public/api_v1.php` is separate from the session API. It validates `Authorization: Bearer sk_...`, checks hashes from `api_keys`, and supports domain/mailbox CRUD for external automation.
- `functions/09_admin_portal.sh` deploys the portal, preserves existing deployed `config.php`, hardens deployed file ownership to `root:${WEB_GROUP}`, injects Nginx `/SOGo/admin` routes, creates portal tables, installs the sudo upgrade bridge, and copies the quarantine filter.

Node backend:

- `webmail-backend/src/index.ts` mounts `/api`, `/api/apps`, `/caldav`, `/carddav`, autodiscover, well-known CalDAV/CardDAV redirects, and `/Microsoft-Server-ActiveSync`.
- The code listens on `127.0.0.1:20000` by default through `OMS_WEBMAIL_HOST` and `OMS_WEBMAIL_PORT`; `webmail-frontend/vite.config.ts` proxies local dev API traffic to that default.
- Runtime config now comes from `webmail-backend/src/config.ts`. `OMS_DB_PASSWORD` is required; `packaging/systemd/openmailstack.service` loads `/etc/openmailstack/webmail-backend.env`, with `packaging/webmail-backend.env.example` documenting expected values.
- `functions/10_webmail.sh` renders `/etc/openmailstack/webmail-backend.env` from `config.conf`, defaulting `OMS_DB_*` values from PostfixAdmin DB settings and `OMS_PUBLIC_BASE_URL` from `MAIL_HOSTNAME`.
- `/api/auth/login` now creates an opaque HttpOnly cookie session instead of returning a password-bearing JWT. Sessions are persisted in the additive `webmail_sessions` table using SHA-256 token hashes and AES-256-GCM-encrypted mailbox passwords so reloads/backend restarts can preserve login until TTL expiry. Replacing reversible mailbox-password storage with Dovecot master-user auth or another delegated credential remains future work.
- `/api/events` SSE now authenticates from the session cookie instead of accepting a token in the query string.
- `webmail-backend/src/caldav.ts` now verifies Basic auth credentials through IMAP before serving calendar data, caches successful verification briefly by credential hash, and checks calendar ownership on REPORT/PUT/DELETE.
- `webmail-backend/src/sieve-compiler.ts` compiles UI filter rules into escaped Sieve scripts, stores UI state as base64 JSON in the script comment, and preserves legacy `JSON_DATA` extraction. `webmail-backend/test/sieve-compiler.test.cjs` covers escaping and round-trip behavior.
- ActiveSync support includes `OPTIONS`, `FolderSync`, `Provision`, `GetItemEstimate`, `Sync`, `Ping`, `Settings`, `SendMail`/`SmartForward`/`SmartReply`, `MoveItems`, and `ItemOperations`.
- ActiveSync `FolderSync` now computes a hierarchy key from IMAP folders plus visible calendars and the real contacts collection, returning Status `9` for stale keys so clients such as iOS can refresh folder hierarchy without removing the account. ActiveSync calendar `Sync` can return stored calendar events for `cal-*` collections and handles basic client Add/Change/Delete commands against the shared `events` table. Calendar client-write responses acknowledge the client command without echoing duplicate server `Commands` in the same response, outbound calendar dates use compact UTC ActiveSync timestamps, and unchanged client updates do not advance the sync token. ActiveSync contacts `Sync` now advertises a stable `contacts` collection, returns contacts from the shared `contacts`/CardDAV table, supports `GetItemEstimate`, and handles basic client Add/Change/Delete commands. Tasks/notes remain prototype/mock folders.
- Webmail send now creates the `Sent` IMAP folder before appending the sent copy, so first-send works for new mailboxes that do not already have a Sent folder.
- `webmail-backend/src/api.ts` implements auth, Sieve rules, IMAP folders/messages/search, indexed search status/update, SSE events, message send/draft/action/read-unread/star-unstar, identities, contacts, forwarding, admin CRUD, API keys, updates, and spam policies. Message send/draft passes `cc`, `bcc`, and `replyTo` through to Nodemailer.
- Node admin CRUD includes live domain DNS record display, domain create/delete cleanup, mailbox create/edit/password/suspend/delete with Dovecot-compatible bcrypt hashes, alias create/edit/delete, and cross-domain routing list/create/delete.
- Node admin mutations write sanitized audit metadata to the additive `webmail_admin_audit` table; `/api/admin/logs` reads that table for Admin > Audit Logs. Audit entries intentionally omit passwords, raw API keys, and uploaded branding image payloads.
- Message move/delete/archive/spam actions return destination folder and UID-map metadata when IMAP UIDPLUS provides it, allowing the frontend to offer reliable undo for move-like actions.
- `/api/contacts` now returns and accepts `phone`, and uses additive/upsert behavior to let directory entries be saved into personal contacts without duplicating by unique key when the schema supports it.
- `webmail-backend/src/user-settings.ts` maintains the additive `webmail_user_settings` table and validated defaults for `mail`, `calendar`, `contacts`, and `appearance`; `/api/settings/:namespace` GET/PUT routes require the normal webmail session cookie and reject unsupported namespaces.
- User mail settings include signatures, identity defaults, compose defaults, and reading preferences. User calendar settings include default calendar, default view, event duration, reminder, week start, and time zone. User contacts settings include name format, sort field, density, and sent-mail collection preference.
- `webmail-backend/src/admin-settings.ts` maintains the additive global `webmail_admin_settings` table and admin-only `/api/admin/settings/:namespace` routes for `organization`, `publicUrls`, `security`, `mailPolicy`, and `system` settings.
- `webmail-backend/src/branding.ts` maintains the additive global `webmail_branding_settings` table for app name/company/login/favicon/icon/logo/background customization. `/api/branding` is public for pre-login rendering; `/api/admin/branding` requires an admin session for writes and rejects SVG/non-raster image payloads.
- `webmail-backend/src/search-index.ts` maintains additive `mail_search_index` and `mail_saved_searches` tables for persistent per-user search over message subject, sender, recipients, body text, attachment names, dates, read/star flags, and saved search chips. It is populated lazily from parsed IMAP results, by a bounded manual index-refresh endpoint, and by session-bound incremental sync that fetches only UIDs newer than the indexed max UID.
- `webmail-backend/src/apps-api.ts` implements app CRUD for contacts, tasks, notes, calendars, and events. Calendar creation uses the shared calendar helper so web-created calendars receive DAV slugs and participate in ActiveSync hierarchy changes.
- `webmail-backend/src/caldav.ts` supports `OPTIONS`, `PROPFIND`, `REPORT`, `PROPPATCH`, `MKCOL`/`MKCALENDAR`, `PUT`, and `DELETE`, with legacy SOGo-style path handling, idempotent default-calendar creation, user-owned calendar collection creation/deletion, DAV slug resolution, and event ownership checks.
- `webmail-backend/src/calendar-format.ts` parses webapp/ActiveSync calendar event summaries from direct `VEVENT` properties so Apple `VTIMEZONE` and nested `VALARM` fields do not replace the actual event date/description. It also parses simple `RRULE` recurrence for daily/weekly/monthly/yearly series and exposes bounded occurrence expansion for the web calendar API.
- `webmail-backend/src/carddav.ts` supports CardDAV discovery and the default personal address book at `/carddav/addressbooks/<user>/personal/`, with `OPTIONS`, `PROPFIND`, `REPORT`, `GET`/`HEAD`, `PUT`, `DELETE`, and `PROPPATCH`. It stores vCards in the existing `contacts` table through additive metadata columns managed by `webmail-backend/src/contact-utils.ts`.
- `webmail-backend/src/imap.ts` wraps ImapFlow for folders, message fetching/pagination, bounded recent-message indexing fetches, native IMAP search, read/unread/star flag mutations, append, move, and common mail actions.
- `webmail-backend/src/managesieve.ts` is a small raw TCP ManageSieve client.
- `webmail-backend/src/wbxml/` contains the WBXML parser/writer and EAS codepages.

React frontend:

- `webmail-frontend/src/App.tsx` is the main app and is large/monolithic. It includes login, webmail, compose, signatures, rules, forwarding, admin screens, calendar, contacts, and settings.
- Settings now has a component boundary in `webmail-frontend/src/settings/SettingsPanel.tsx`, with settings tab normalization in `webmail-frontend/src/settings/tabs.ts` and local appearance preference application in `webmail-frontend/src/settings/appearance.ts`.
- It uses React 19, Vite, lucide-react, DOMPurify, ReactQuill, react-resizable-panels, and date-fns.
- Message HTML rendering is sanitized with DOMPurify before `dangerouslySetInnerHTML`.
- UI state uses server-backed settings for signatures, threaded mode, and appearance after authenticated hydration, with `localStorage` retained for migration/fallback and for active app section/tab. Auth now bootstraps through `/api/auth/me` and the session cookie; old `oms_token`, `oms_isAdmin`, and `oms_username` keys are removed during login/logout cleanup.
- `webmail-frontend/src/App.tsx` now has typed domain models for mail folders, messages, signatures, contacts, calendars, admin records, and app refresh responses. `npm --prefix webmail-frontend run lint` passes as of Phase 2.
- `webmail-frontend/src/App.tsx` includes mail search controls with field filters including attachment-name search, current-folder/all-folder scope, loading/clear states, update-index action, save-search action, saved-search chips, background current-folder incremental index sync, indexed/mailbox search status text, cross-folder result folder labels, and bulk-action safeguards for all-folder results. Folder message lists now use backend pagination metadata and a `Load older` control to append older IMAP batches beyond the initial newest batch.
- `webmail-frontend/src/App.tsx` marks messages read when opened, updates unread folder counts immediately, refreshes folder counts for server reconciliation, exposes toolbar/row actions for read/unread and starring, and displays opened-message attachments with preview/download actions.
- Mail move-like actions now show an undo snackbar when the backend returns destination UID mapping; keyboard shortcuts are active only in Mail outside editable fields for delete/backspace, archive, mark unread, and star.
- The top-level frontend nav is `Mail | Calendar | Contacts | Sync Info`. Saved app-mode state keeps browser reloads in the current app instead of defaulting back to Mail, and the global header refresh action refreshes the active section.
- Calendar event chips open a details dialog with edit/delete actions and recurrence labels. Editing reuses the same event UID, so saving changes updates the existing event through `/api/apps/events`; the advanced event recurrence selector now writes simple daily/weekly/monthly/yearly `RRULE` values.
- Calendar sidebar editing uses authenticated calendar APIs to persist calendar name/color changes and calendar deletion. Event chips inherit updated calendar colors; deletion removes that calendar's events, refreshes from the server, and refuses to delete the last visible calendar.
- Sync Info generates copyable CalDAV, CardDAV, IMAP/SMTP, ActiveSync, iOS/Android, and desktop setup settings from the current web origin and signed-in mailbox address. Calendar/Contacts shortcut buttons route to the full Sync Info page.
- Settings navigation is grouped into Personalization, Mail, Apps, and Account. Appearance controls are functional server-backed preferences for theme, accent, density, type size, corner shape, reduced motion, and named profiles. Mail settings include functional identity/compose defaults, signature defaults, and threaded-mode persistence; forwarding remains alias-backed and filters remain Sieve-backed. Calendar settings drive new event default calendar/duration/time zone/reminder and default view. Contacts settings drive address-book sort, name format, and list density. Spam & Senders, Password, and Advanced still expose honest read-only/planned states where product behavior is not implemented yet.
- Admin users have an Admin > Branding panel for global app branding. Branding is loaded before login, applied to the document title/favicon, login page logo/text/background, and authenticated header. Image uploads show recommended pixel dimensions and are resized/cropped client-side before saving so admins do not need to prepare exact asset sizes manually.
- Admin users also have an Admin > Settings hub backed by `/api/admin/settings/:namespace` for organization metadata, public URL hints, security defaults, mail policy defaults, update channel, telemetry mode, maintenance window, and admin notice. These settings are currently stored and editable; enforcement remains separate follow-up work.
- Admin users can use Admin > Domains, Cross-Domain Routing, Mailboxes, and Aliases against live Node API routes. DNS Settings opens a copyable records overlay; create/edit/delete/suspend/reset actions refresh admin data and show success/error banners. Aliases have a modal group-member editor with bulk/member removal and mailbox/manual address adds. Mailboxes have a profile editor for display name, quota, phone, alternate email, company/title/address metadata, notes, and Global Directory visibility backed by additive `webmail_mailbox_profiles`.
- Admin users can also promote/demote admins, generate/revoke API keys, save spam policies, save Admin Settings, and save Branding through the shared admin action path so refresh/error banners and audit-log writes are consistent.
- Contacts has a selectable Global Directory view populated from active mailboxes and admin-managed mailbox profile metadata via authenticated `/api/directory`. Compose recipient autocomplete merges personal contacts and Global Directory entries, and directory cards can be saved into Personal Contacts.
- Admin > Rspamd WebUI embeds the live Rspamd controller through the modern `/rspamd/` Nginx proxy and also offers an open-in-new-tab fallback.
- Resizable panels now use the typed `useDefaultLayout` API with unique panel IDs instead of unsupported casted `autoSaveId` props.
- The compose rich-text editor is lazy-loaded, producing a separate frontend chunk and removing the previous Vite >500 kB main-bundle warning.
- `webmail-frontend/src/index.css` contains the actual app styling. `webmail-frontend/src/App.css` looks like leftover Vite starter CSS and is not imported by `App.tsx`.
- `webmail/src/App.tsx` is still the default Vite starter page and is not the active product app; `webmail/README.md` marks it as a deprecated scaffold.

Validation:

- `docs/webmail-release-validation.md` defines local gates, clean-VM checks, and the mail/calendar/contacts/mobile/security client matrix for modern webmail releases.
- `tests/integration/run.sh` includes guards for the modern webmail deployment module, env rendering, Nginx proxy routes, and systemd EnvironmentFile wiring.
- `tests/integration/staging_smoke.sh` checks `openmailstack.service`, the backend listen port, modern `/`, legacy `/webmail`, and unauthenticated `/api/auth/me` returning 401.
- `tests/integration/calendar_sync_smoke.sh` is an authenticated optional smoke for CalDAV MKCALENDAR, event PUT/REPORT, ActiveSync FolderSync full listing, initial ActiveSync calendar Sync, compact calendar date output, ActiveSync calendar client Add persistence without same-response server echo, CalDAV visibility of ActiveSync-created events, current-key no-duplicate follow-up Sync, stale-key reset, and cleanup. It skips unless `OMS_SMOKE_USER` and `OMS_SMOKE_PASSWORD` are set.
- `tests/integration/carddav_sync_smoke.sh` is an authenticated optional smoke for CardDAV contact PUT, PROPFIND, REPORT, GET, and DELETE. It skips unless `OMS_SMOKE_USER` and `OMS_SMOKE_PASSWORD` are set.
- `tests/integration/mail_sync_smoke.sh` is an authenticated optional smoke for direct SMTP submission, IMAP receipt, webmail API send/read, and attachment download. It skips unless `OMS_SMOKE_USER` and `OMS_SMOKE_PASSWORD` are set.
- `tests/integration/activesync_contacts_smoke.sh` is an authenticated optional smoke that seeds a contact through CardDAV, verifies ActiveSync FolderSync exposes Contacts, checks GetItemEstimate, verifies Contacts Sync returns the seeded contact, and cleans up. It skips unless `OMS_SMOKE_USER` and `OMS_SMOKE_PASSWORD` are set.
