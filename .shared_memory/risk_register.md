# Risk Register

Do not treat this as a complete audit. It is a working memory of risks observed during the initial repo review.

High-priority risks:

- The webmail browser no longer receives a password-bearing JWT, and server sessions are now DB-backed with SHA-256 token hashes plus AES-256-GCM-encrypted mailbox passwords. The Node backend still needs reversible mailbox credentials to authenticate to IMAP/SMTP/ManageSieve; replace this with Dovecot master-user auth, app passwords, or another delegated credential model before calling this enterprise-grade.
- `webmail-backend/src/caldav.ts` and `webmail-backend/src/carddav.ts` use Basic auth verified through IMAP, but broader CalDAV/CardDAV protocol tests against real Apple Contacts/Calendar, Thunderbird, and DAVx5 clients are still needed before release. Scripted CalDAV plus ActiveSync calendar-write smoke coverage exists, including Apple-style VTIMEZONE parser regression coverage.
- ActiveSync calendar and contacts now use shared webapp/DAV tables for FolderSync, GetItemEstimate where applicable, Sync, and basic Add/Change/Delete commands. Calendar client-write no-echo behavior is covered by smoke tests because iOS drops locally created events when servers acknowledge an Add while echoing the same item as a server Command. Full iOS/macOS client validation is still required. Tasks/notes remain prototype/mock folders, and broader ActiveSync semantics such as tombstones, conflict handling, recurring event exceptions, contact photos, and long-running incremental sync still need hardening.

Security and authorization areas to re-check:

- `admin_portal_src/public/api.php` has CSRF and many prepared statements, but RBAC/domain scoping should be reviewed endpoint by endpoint. Some admin actions do not obviously re-check domain ownership.
- `admin_portal_src/public/api_v1.php` is thinner than `api.php`: it has bearer auth and prepared statements but lacks the same strict input validation/domain scoping style. It constructs mailbox `maildir` values from input email parts.
- Quarantine view/release/delete should verify domain-admin authorization for the selected UUID, not just for list retrieval.

Operational/release risks:

- `functions/10_webmail.sh` now renders `/etc/openmailstack/webmail-backend.env`, installs `openmailstack.service`, deploys the React app, and injects Nginx proxy routes. It has only been syntax/dry-run checked in this workspace; validate on a clean VM before release.
- On the live server, Nginx already had root, `/api`, `/caldav`, and ActiveSync routes before migration. Do not blindly run the `functions/10_webmail.sh` Nginx injection against an already-migrated live config without checking for duplicate locations first.
- The backend's global raw body parser must not consume `/api/` or `multipart/form-data` requests; otherwise webmail send/draft uploads fail with Busboy `Unexpected end of form`.
- `webmail-backend/src/managesieve.ts` still uses a small raw TCP ManageSieve client. Before relying on complex filter round-tripping at scale, revisit response parsing so script content cannot be confused with protocol status lines or chunk boundaries.
- Live SMTP submission should use the certificate hostname (`mail.housevo.us`) while TLS verification is enabled; using `127.0.0.1` with `OMS_SMTP_REJECT_UNAUTHORIZED=true` risks hostname verification failures.
- Rspamd proxy health affects SMTP greeting availability because Postfix queries the milter before greeting; keep `milter_connect_timeout` and `milter_command_timeout` low, and investigate any `lost heartbeat from worker type rspamd_proxy` log entries.
- `node_modules`, `dist`, and generated JS/d.ts/map files are present in the workspace. `.gitignore` now ignores dependency/build output, but avoid editing generated/vendor files unless deployment actually consumes them.
- `webmail-backend/package.json` now has a focused `npm test` target for pure backend helpers, and optional authenticated mail, CalDAV, CardDAV, calendar, ActiveSync calendar-write, and ActiveSync contacts smoke coverage exists. Real Apple/iOS/macOS/Android/Outlook client testing is still needed because script-level WBXML and DAV checks do not fully model device behavior.
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
