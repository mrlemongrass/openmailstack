# Risk Register

Do not treat this as a complete audit. It is a working memory of risks observed during the initial repo review.

Last updated: 2026-07-12

## Resolved Risks

- ✅ Master-user auth: optional OMS_IMAP_MASTER_USER/OMS_SMTP_MASTER_USER/OMS_SIEVE_MASTER_USER env vars implemented. ImapService and ManageSieveClient support Dovecot `{user}*{master}` format when configured. `mailbox_credentials` table stores AES-256-GCM encrypted credentials for offline background indexing.
- ✅ Earlier real client validation: iPhone, macOS, Android, and Thunderbird were previously confirmed by the user; rerun the physical matrix after the July 10 ActiveSync fixes before treating the current release as device-validated.
- ✅ ActiveSync calendar tombstones: `calendar_tombstones` table created, EAS Delete inserts tombstones, outgoing sync emits Delete commands for deleted UIDs.
- ✅ ActiveSync recurrence mapping: EAS Recurrence (Type/Interval/Until/Occurrences) parsed in incoming sync (→ RRULE) and mapped in outgoing sync.
- ✅ ActiveSync contact photos: Picture ↔ photo_url mapped in both directions.
- ✅ ActiveSync contact fields: CompanyName, JobTitle mapped in both directions.
- ✅ Calendar iCal properties: VALARM, ATTENDEE, TRANSP, TZID generated in saveEventToBackend and parsed in parseIcalEvent.
- ✅ Background indexing daemon: `mailbox_credentials` table provides offline credentials for search-worker when no active web session exists.
- ✅ Attachment content extraction: pdf-parse for PDF text, XML tag stripping for DOCX/XLSX/ODT/RTF in search-worker indexing loop.
- ✅ Draft reliability: beforeunload handler warns user when leaving page with unsaved compose content.
- ✅ Admin API key prompt: replaced window.prompt() with navigator.clipboard.writeText() + in-app status banner.
- ✅ Contact groups/lists: contact_groups + contact_group_members tables with full CRUD API and frontend sidebar UI.
- ✅ Modern Node Admin global-access boundary: React/Node Admin is now superadmin-only until explicit domain-admin scoping is implemented. Active non-superadmin `admin` rows no longer get modern Admin API access.
- ✅ Modern Admin superadmin controls: React/Node Admin now exposes explicit superadmin grant/removal actions, and the backend prevents self-superadmin removal and last-superadmin removal.
- ✅ Modern webmail Nginx injection rollback: `functions/10_webmail.sh` validates a generated candidate config and restores the previous site file when `nginx -t` fails.
- ✅ Admin protocol health breadth: Admin System Health now checks ActiveSync, IMAP, SMTP submission, CalDAV, and CardDAV readiness rather than only daemon status plus ActiveSync.
- ✅ SMTP submission false degraded row: Live Postfix submission returned a valid greeting after roughly 5s, but the Admin health probe timed out at 4s. The probe now waits 8s and the dashboard refreshes every 15s.
- ✅ ActiveSync SendMail MIME extraction: iOS was observed sending ActiveSync `SendMail` with a UUID-like value in decoded `Mime` and the real RFC822 bytes in another payload node. The backend now scans for MIME-like payloads, derives an SMTP envelope from the raw MIME, and avoids logging raw send content.
- ✅ CalDAV namespace-prefixed sync tombstones: macOS/Apple-style REPORT bodies can prefix `sync-collection` and `sync-token`. The CalDAV parser now detects prefixed and unprefixed forms, so stale-token incremental sync can include tombstone 404 responses.
- ✅ Physical iPhone Exchange calendar create/edit/delete: `thang@housevo.us` calendar create, edit, and delete all reached iOS, web, server storage, and macOS Calendar after the CalDAV ETag, namespace-prefixed sync parser, and one-time token bump fixes.
- ✅ Contacts list long-book UX: Contacts now receives a server-reported total, shows actual total count instead of loaded count, exposes first-name/last-name/email sorting, select/deselect all, and visible duplicate scan/merge actions.
- ✅ Contacts server-side search: Web Contacts search now queries `/api/apps/contacts?q=...` across the full address book instead of filtering only the first loaded page.
- ✅ CardDAV contact edit compatibility groundwork: CardDAV contact REPORT handling now understands namespace-prefixed `sync-collection`, and future server-written contacts include vCard `REV` plus parsed organization/title/notes/structured fields.
- ✅ ActiveSync multi-phone contact mapping: iOS sent both `BusinessPhoneNumber` and `HomePhoneNumber`; the backend now preserves multiple phone/email fields instead of collapsing to the first non-empty phone.
- ✅ Contacts realtime refresh: ActiveSync, CardDAV, and web-app contact mutations emit `contacts_updated`, and the web Contacts hook refreshes and reconciles the selected contact detail.
- ✅ ActiveSync/CardDAV contact tombstones and delta deletes: contact deletes now write `contact_tombstones`, CardDAV stale-token `sync-collection` returns 404 tombstone responses, ActiveSync Contacts returns Delete commands, and local/public smokes assert both paths.
- ✅ CardDAV contact depth-1 tombstone compatibility: macOS Contacts was observed listing the address book with depth-1 `PROPFIND` after an iPhone delete, so CardDAV now includes recent 404 tombstones in address-book PROPFIND results and the smoke script asserts that path.
- ✅ CardDAV legacy href tombstone compatibility: deleted contact tombstones now also emit a legacy `contact-<id>` href alias when available, covering macOS caches that may have stored an older resource href for an ActiveSync-created card.
- ✅ Physical iPhone Exchange contact create/edit/delete: `thang@housevo.us` contact create and edit reached iPhone, web Contacts, macOS Contacts, and server storage. Delete reached iPhone, web Contacts, and server tombstone state immediately; macOS Contacts cleared stale local cache state after the CardDAV account was removed, Contacts was closed/reopened, and the account was re-added.
- ✅ Frontend lint and main bundle stabilization: Frontend lint exits 0 with zero warnings, and the main production chunk remains below the documented 500 kB target after top-level route code splitting.
- ✅ OMS Scheduler Phase 0 foundation: availability and host/booker timezone behavior, slot-hold concurrency, versioned migration conventions, booking/provider/outbox/audit contracts, tenant authorization, threat model, and the automated capability register are complete. A disposable MariaDB 11 capacity-one race passed without touching production.
- ✅ OMS Scheduler Phase 1 deployment foundation: optional installation, global handles, Admin-only entitlements, public/owner/Admin APIs, native calendar projection, transactional booking lifecycle, outbox email/ICS, responsive management/public UI, and configured Nginx/TLS aliases are live. `thang@housevo.us` is enabled and published as `/scheduler/thang`; both public APIs and SPA paths pass on the configured host aliases.
- ✅ Scheduler entitlement navigation refresh: Admin enable/disable changes now notify the authenticated shell immediately, while focus and visibility refresh cover changes made in another tab. Playwright proved the disabled-to-enabled transition and desktop/mobile placement after Notes.
- ✅ Frontend dependency and Node compatibility: removed unused vulnerable `pdfjs-dist`, pinned React Router to Node-20-compatible `7.18.1`, and locked Quill to non-vulnerable `2.0.2`. Frontend and backend registry audits report zero vulnerabilities on live Node `20.19.2`.
- ✅ Webmail deployment umask isolation: secret environment rendering confines `umask 077` to a subshell, while dependency installs use `umask 022`, preventing deployment from leaving repository dependencies unreadable.

## Remaining High-Priority Risks

- OMS Scheduler Phase 1 now has a live create/reschedule/cancel cycle with completed owned-sender outbox delivery, Google SMTP acceptance, local LMTP delivery, Calendar UID preservation, tombstone creation, capacity release, and public-slot restoration. Inbox-versus-spam placement, received ICS/management-link inspection, and physical CalDAV/ActiveSync observation still require the owner/devices. Clean-VM disabled/enabled validation is intentionally deferred until a second development Linux server is available.
- Scheduler Phase 2 unlisted and private event types are live and tested. Private links use hash-only 256-bit tokens, fragment-to-header browser transport, tab-only storage, rotation, bounded optional expiry, revocation, generic failures, and automatic revocation when leaving Private visibility. Transactional single-use consumption and one-off customized availability remain security/concurrency work.
- Scheduler advanced workflow automation, provider secret vault, OAuth, payments, webhooks, routing, external calendar reconciliation, guest verification, and complete abuse controls remain Phase 2+ security and reliability boundaries. Keep the capability register honest where those capabilities remain `in_progress` or planned.
- Full Calendly/Cal.com functional parity is a moving, multi-release target. Track capabilities and acceptance tests rather than claiming blanket parity, recheck official sources each parity release, and distinguish OMS-owned features from third-party services that still charge usage fees.
- Public Scheduler handle collisions and reserved routes are enforced by normalized validation plus a database-wide unique key. The Admin UI supports alternate handles. Recheck normalization before adding Unicode/IDN handles or organization-level aliases.
- Scheduler public requests enforce a configured hostname allowlist, generated links use the preferred base URL, and installer scripts add configured aliases to Nginx and certificate SANs. Clean-VM and certificate-renewal testing remain required before treating multi-host routing as release-validated.
- The Node backend stores mailbox credentials with AES-256-GCM encryption. Master-user auth is implemented as optional env vars but requires manual Dovecot server-side config (`auth_master_user_separator = *` and a master passdb). Without server-side setup, per-user passwords are still stored reversibly.
- Tasks/notes remain prototype/mock folders in ActiveSync.
- Physical iPhone Exchange, macOS Mail/Calendar/Contacts, Android plus DAVx5, and Thunderbird rows in `docs/webmail-release-validation.md` need a post-July-10 rerun. The iPhone Exchange receive/send/Sent copy/picture attachment, calendar create/edit/delete, and contact create/edit/delete paths passed for `thang@housevo.us` after the ActiveSync SendMail, CalDAV, and Contacts UX/multi-phone/tombstone fixes. The final contact edit retry changed company to `OpenMailStack Test 2`; web Contacts and macOS Contacts reflected it, and live storage preserved both phone numbers. Scripted smokes pass, but they are not a substitute for the remaining standalone macOS/Android/Thunderbird client rows.
## Security and Authorization Areas to Re-check

- `admin_portal_src/public/api.php` has CSRF and many prepared statements, but RBAC/domain scoping should be reviewed endpoint by endpoint. Some admin actions do not obviously re-check domain ownership.
- `admin_portal_src/public/api_v1.php` is thinner than `api.php`: it has bearer auth and prepared statements but lacks the same strict input validation/domain scoping style. It constructs mailbox `maildir` values from input email parts.
- Quarantine view/release/delete should verify domain-admin authorization for the selected UUID, not just for list retrieval.
- The modern React Admin app currently has no domain-admin mode. Keep it superadmin-only until list/mutation endpoints are intentionally scoped by `domain_admins`.

Security and authorization areas to re-check:

- `admin_portal_src/public/api.php` has CSRF and many prepared statements, but RBAC/domain scoping should be reviewed endpoint by endpoint. Some admin actions do not obviously re-check domain ownership.
- `admin_portal_src/public/api_v1.php` is thinner than `api.php`: it has bearer auth and prepared statements but lacks the same strict input validation/domain scoping style. It constructs mailbox `maildir` values from input email parts.
- Quarantine view/release/delete should verify domain-admin authorization for the selected UUID, not just for list retrieval.

Operational/release risks:

- `functions/10_webmail.sh` now renders `/etc/openmailstack/webmail-backend.env`, installs `openmailstack.service`, deploys the React app, and injects Nginx proxy routes with candidate validation/rollback. It has still not been exercised on a clean VM in this cycle; validate on a clean VM before release.
- On the live server, Nginx already had root, `/api`, `/caldav`, and ActiveSync routes before migration. Do not blindly run the `functions/10_webmail.sh` Nginx injection against an already-migrated live config without checking for duplicate locations first.
- The backend's global raw body parser must not consume `/api/` or `multipart/form-data` requests; otherwise webmail send/draft uploads fail with Busboy `Unexpected end of form`.
- `webmail-backend/src/managesieve.ts` still uses a small raw TCP ManageSieve client. Before relying on complex filter round-tripping at scale, revisit response parsing so script content cannot be confused with protocol status lines or chunk boundaries.
- Live SMTP submission should use the certificate hostname (`mail.housevo.us`) while TLS verification is enabled; using `127.0.0.1` with `OMS_SMTP_REJECT_UNAUTHORIZED=true` risks hostname verification failures.
- Rspamd proxy health affects SMTP greeting availability because Postfix queries the milter before greeting; keep `milter_connect_timeout` and `milter_command_timeout` low, and investigate any `lost heartbeat from worker type rspamd_proxy` log entries.
- Admin ActiveSync health counts recent backend send/sync errors over a rolling window. Immediately after a fixed ActiveSync failure, the endpoint can still be reachable while the Admin row reports recent errors until the window ages out; correlate with fresh journal entries before restarting services.
- ActiveSync debug logging still prints decoded non-mail-sync payloads, including calendar event summaries. SendMail payloads are sanitized, but broader ActiveSync log redaction remains a privacy hardening follow-up.
- CalDAV event ETags are now content-derived, but clients that already consumed a sync token while UID-only ETags were active may not refetch the stale event until another event edit or sync-token bump forces a fresh incremental change.
- If a future macOS Calendar delete again requires a manual sync-token bump, do not keep bumping tokens as normal operations. Inspect macOS CalDAV request/response logs and fix the delta-sync behavior instead.
- If macOS Contacts already consumed the Action 8 contact sync token before the CardDAV/`REV` fix, do not assume the existing stale display proves the new code failed. Have the user perform one additional edit to the test contact, or request explicit permission for a one-time contact token/data touch before mutating live contact data.
- If macOS Contacts still retains the deleted Action 7 contact after the depth-1 PROPFIND tombstone fix and a Contacts refresh/reopen, inspect fresh CardDAV logs before touching live state. Do not bump contact tokens or mutate the deleted contact row without explicit user approval.
- If macOS Contacts shows duplicates that web Contacts and iOS do not show, first have the user select only the OpenMailStack/CardDAV account in the macOS Contacts sidebar instead of All Contacts. Focused live checks on 2026-07-11 found no duplicate active DAV UID rows for `thang@housevo.us`; do not assume macOS All Contacts duplicates are server duplicates.
- If macOS Contacts remains stale after protocol fixes, remove and re-add the macOS CardDAV account before applying server-side remediation. On 2026-07-11 this cleared the stale deleted contact and macOS-only duplicates without mutating server contact data.
- If ActiveSync contact edits appear to drop fields, inspect the decoded `ApplicationData` payload before changing storage. iOS can send multiple phone tags such as `BusinessPhoneNumber` and `HomePhoneNumber`; do not reduce them to a single primary phone.
- Web calendar realtime refresh now covers ActiveSync and CalDAV writes through authenticated Socket.IO room joins, but shared-calendar fanout is still scoped to the authenticated user's room. If shared calendar editing becomes a release target, emit refresh notifications to the owner and affected share recipients after auditing permissions.
- If iPhone-to-Gmail validation messages appear back in `thang@housevo.us` Inbox, check Gmail forwarding/filters before debugging OpenMailStack duplication. The 2026-07-11 attachment test outbound queue had one recipient to Gmail, then Gmail submitted a separate inbound copy to `thang@housevo.us`.
- `node_modules`, `dist`, and generated JS/d.ts/map files are present in the workspace. `.gitignore` now ignores dependency/build output, but avoid editing generated/vendor files unless deployment actually consumes them.
- `webmail-backend/package.json` now has a focused `npm test` target for pure backend helpers, and optional authenticated mail, CalDAV, CardDAV, calendar, ActiveSync mail, ActiveSync calendar-write, and ActiveSync contacts smoke coverage exists. Real Apple/iOS/macOS/Android/Outlook client testing is still needed because script-level WBXML and DAV checks do not fully model device behavior.
- Webmail search now has additive persistent indexing, lazy/manual indexing, session-bound incremental sync, ranked indexed results, saved-search chips, and attachment-name search. Gmail/Outlook-scale behavior still needs true daemon/background indexing for logged-out users, richer operators, attachment content extraction, typo tolerance, and broader authenticated integration tests.
- Admin Settings values are stored and editable, but security defaults, mail policy defaults, update channel, telemetry mode, maintenance window, and admin notice are not yet enforced by runtime session, Postfix/Rspamd, update, or notification workflows.
- Mail Reading settings for preview pane placement, external-image behavior, snippets, density, and mark-read delay are persisted, but only threaded mode currently affects the mail workflow. Wire the remaining viewer/list behavior before calling Mail Settings complete.
- The backend source mixes TypeScript source and generated JavaScript in `src/`. `packaging/systemd/openmailstack.service` runs `node src/index.js`, so generated artifacts must be kept in sync until deployment changes.
- Old standalone audit/status docs were removed during documentation cleanup after their useful context was merged into the current roadmap and shared-memory files. If older logs mention removed documentation, treat those names as historical only.

Previously documented audit fixes:

- Earlier installer review actions covered destructive admin portal deployment, admin overwrite, unattended backup prompts, SQL escaping, webroot permissions, package update handling, Dovecot version parsing, hardcoded paths, PHP hash fallback, Roundcube DSN encoding, and PostfixAdmin PHP escaping.
- Earlier admin portal review actions covered directory traversal, CSRF, and stored XSS fixes.
- The old standalone audit/review markdown files were consolidated into this risk register and the project roadmap during the 2026-06-21 documentation cleanup.
- When touching affected areas, verify the code directly rather than relying only on action logs.
