# Shared Memory Change Log

## 2026-06-30 Nested Mail Folder Routing Fix

- Observed: Clicking nested Inbox folders rendered main Inbox messages instead of the selected subfolder.
- Root cause: The frontend folder tree split paths on both `.` and `/` and rebuilt nested paths with `/`, which corrupted Dovecot dot-delimited folders such as `INBOX.Child`. Initial Inbox fetches could also race the selected-folder fetch and overwrite rows.
- Changed: `/api/folders` now returns each IMAP folder delimiter; the sidebar preserves exact server folder paths; folder message/raw/attachment API routes accept wildcard folder params; route-to-folder state sync moved into an effect; `useMail` ignores stale folder fetch responses after the active folder changes.
- Deployed: Rebuilt and synced the backend to `/opt/openmailstack-backend`, restarted `openmailstack.service`, and deployed the frontend with `functions/deploy_webmail_frontend.sh`.
- Verified: Live browser/API smoke created a temporary dot-delimited nested folder, appended one message, opened `/mail/INBOX.<temp-folder>`, and confirmed the UI showed that nested message only with the API reporting the exact nested folder path. The temporary Maildir and subscription entry were removed afterward.
- Known gap: `rtk npm --prefix webmail-backend test` still fails in `calendar-format` and `user-settings` suites, and `rtk npm --prefix webmail-frontend run lint` still fails on broad existing frontend lint debt.

## 2026-06-30 Resizable Panel Sizing Fix

- Observed: Mail, Calendar, Contacts, and Notes pane resize handles appeared broken after the frontend was migrated to `react-resizable-panels` v4.
- Root cause: v4 treats numeric `Panel` sizes as pixels, not percentages. Existing props such as `defaultSize={20}`, `minSize={10}`, and `maxSize={35}` constrained sidebars to roughly 10-35px and persisted tiny percentage layouts in localStorage.
- Changed: Updated all active app layouts to pass percentage strings for `defaultSize`, `minSize`, and `maxSize`; bumped layout IDs from `v10` to `v11` so users discard bad pixel-derived saved layouts; changed Mail's two-pane default to `20% / 80%`; updated global CSS selectors for v4 `[data-group]` and `[data-separator]` attributes.
- Deployed: Ran `rtk ./functions/deploy_webmail_frontend.sh` to rebuild and sync the frontend to `/var/www/openmailstack`.
- Verified: Playwright against local Vite confirmed resize dragging changes panel widths in Mail list view, Mail three-pane reader view, Calendar, Contacts, and Notes; Playwright against deployed `https://mail.housevo.us/mail/inbox` confirmed the live Mail handle moves from `20/80` to roughly `33/67`.
- Verified: `rtk npm --prefix webmail-frontend run build` passed; deploy script build passed; deployed `index.html` matches `webmail-frontend/dist/index.html`; host-header HTTPS probe for `mail.housevo.us` returned `200`.
- Known gap: `rtk npm --prefix webmail-frontend run lint` still fails on pre-existing repo-wide lint debt unrelated to this patch.

## 2026-06-21

- Created `.shared_memory/`.
- Reviewed root docs, installer scripts, tests, PHP admin portal, Node backend, React frontend, and app manifests.
- Added architecture overview, current implementation state, command notes, and risk register.
- Noted stale docs around ActiveSync/CalDAV implementation status.
- Noted secret-bearing files without copying secret values.
- Added product north star: fast Gmail/Outlook/Proton-style webmail/calendar/contacts, using SOGo reverse engineering for compatibility while targeting Exchange-style iOS autodiscover and IMAP/CalDAV/CardDAV for desktop clients.

## 2026-06-21 Real Device Validation Prep

- Changed: Expanded `docs/webmail-release-validation.md` with a live server preflight table, exact account settings under test, a real-device matrix for iPhone Exchange, macOS IMAP/CalDAV/CardDAV, Android IMAP/SMTP plus DAVx5, and Thunderbird IMAP/SMTP/CalDAV/CardDAV.
- Verified: `rtk bash tests/integration/staging_smoke.sh ./config.conf` passed on the live host.
- Verified: Public TLS SANs cover `mail.housevo.us`, `autodiscover.housevo.us`, and `webmail.housevo.us`; public DNS points MX/autodiscover/webmail at the live server; ActiveSync OPTIONS advertises EAS 14.0/14.1; autodiscover returns the MobileSync URL; DAV unauthenticated probes return Basic-auth challenges.
- Verified: Authenticated `mail_sync_smoke.sh`, `calendar_sync_smoke.sh`, `carddav_sync_smoke.sh`, and `activesync_contacts_smoke.sh` passed with the local test mailbox. Do not store the mailbox password in repo files or memory.
- Note: `mail_sync_smoke.sh` is configured for non-implicit-TLS IMAP and passed with local `127.0.0.1:143`; real clients should still use public IMAPS `mail.housevo.us:993` with SSL/TLS.
- Not run: No real iPhone/macOS/Android/Thunderbird client rows have been completed yet.
- Follow-up: Execute and record the physical iPhone/macOS/Android/Thunderbird matrix in `docs/webmail-release-validation.md`.

## 2026-06-21 Settings Shell And Appearance

- Changed: Added `webmail-frontend/src/settings/SettingsPanel.tsx`, `settings/tabs.ts`, and `settings/appearance.ts` so Settings has a component boundary and grouped navigation instead of flat inline tabs in `App.tsx`.
- Changed: Added functional local Appearance preferences for theme mode, accent, density, type size, corner shape, reduced motion, and Starship/Fish/Ghostty-style profiles. Preferences are stored in localStorage as `oms_appearance` until the server-backed settings foundation exists.
- Changed: Moved Mail Signatures, Forwarding, and Filters into the new Settings shell while preserving existing local signature storage, `/api/settings/forwarding`, and `/api/rules` behavior.
- Changed: Replaced fake-looking user spam/password controls with honest read-only/planned states where backend support is not implemented yet.
- Verified: `rtk npm --prefix webmail-frontend run lint` passed.
- Verified: `rtk npm --prefix webmail-frontend run build` passed.
- Verified: Browser smoke against Vite confirmed Settings navigation, Appearance persistence after reload, migrated Signatures/Forwarding/Filters panes, Sync & Devices rows, and disabled Password state.
- Follow-up: Build the server-backed `webmail_user_settings` foundation and migrate `oms_signatures`, `oms_threaded`, and `oms_appearance` out of browser-local storage.

## 2026-06-21 Settings Server-Backed Foundation

- Changed: Added `webmail-backend/src/user-settings.ts` with additive `webmail_user_settings` schema initialization, per-namespace defaults, normalization, and allowlisted namespaces for `mail`, `calendar`, `contacts`, and `appearance`.
- Changed: Added authenticated `/api/settings/:namespace` GET/PUT routes while leaving forwarding in `alias`, filters in Sieve, contacts in `contacts`, and calendars/events in their existing tables.
- Changed: Added `webmail-frontend/src/settings/settingsApi.ts` and wired Settings to hydrate signatures, threaded reading mode, and appearance from the server after login.
- Changed: Migrates existing `oms_signatures`, `oms_threaded`, and `oms_appearance` into server-backed settings once per user; keeps localStorage as compatibility fallback; debounces server saves; dedupes unchanged saves; surfaces a sync error banner when server settings writes fail.
- Deployed: Synced the built backend to `/opt/openmailstack-backend`, restarted `openmailstack.service`, and deployed the built frontend to `/var/www/openmailstack` with `functions/deploy_webmail_frontend.sh`.
- Verified: `rtk npm --prefix webmail-backend test` passed with settings normalization coverage.
- Verified: `rtk npm --prefix webmail-frontend run lint` passed.
- Verified: `rtk npm --prefix webmail-frontend run build` passed.
- Verified: Mocked Playwright smoke confirmed local settings migration, signature editing, debounced `/api/settings/mail` and `/api/settings/appearance` saves, and no sync error banner on successful writes.
- Verified: Live direct-backend and Vite-proxied unauthenticated `/api/settings/mail` probes return `401`; `openmailstack.service` is active after restart.
- Verified: `rtk bash ./tests/integration/staging_smoke.sh ./config.conf` passed after deployment.
- Follow-up: Authenticated real-account browser testing should confirm settings survive force reload, logout/login, and a second browser session for the same mailbox.

## 2026-06-21 Admin Branding Settings

- Changed: Added `webmail-backend/src/branding.ts` with additive `webmail_branding_settings` schema initialization, defaults, normalization, and raster-image data URL validation for app icon, favicon, login logo, and login background.
- Changed: Added public `/api/branding` reads for pre-login rendering and admin-only `/api/admin/branding` writes guarded by the existing admin session middleware.
- Changed: Added `webmail-frontend/src/branding.ts` and `webmail-frontend/src/admin/BrandingPanel.tsx`; Admin > Branding can edit app/company/login text and upload/clear favicon, app icon, login logo, and login background images.
- Changed: The frontend now applies branding to document title, favicon, the unauthenticated login page, and the authenticated header.
- Changed: Branding image cards now show recommended pixel dimensions and automatically resize/crop uploaded images in the browser before saving: app icon 512x512, favicon 64x64, login logo 512x160, and login background 2400x1600.
- Deployed: Synced the built backend to `/opt/openmailstack-backend`, restarted `openmailstack.service`, and deployed the built frontend to `/var/www/openmailstack` with `functions/deploy_webmail_frontend.sh`.
- Verified: `rtk npm --prefix webmail-backend test` passed with branding normalization coverage.
- Verified: `rtk npm --prefix webmail-frontend run lint` and `rtk npm --prefix webmail-frontend run build` passed.
- Verified: Mocked Playwright smoke confirmed public branding changes document title/favicon/header text and Admin > Branding saves expected payloads.
- Verified: Mocked Playwright upload smoke confirmed App Icon shows 512x512 guidance, resizes a test upload to 512x512, and saves a payload below the backend size limit.
- Verified: Live `/api/branding` returns defaults when unset; unauthenticated `/api/admin/branding` writes return `401`.
- Verified: `rtk bash ./tests/integration/staging_smoke.sh ./config.conf` passed after deployment.
- Follow-up: Real admin browser QA should upload PNG/WebP assets, save, reload before login, and verify favicon/header/login branding persist.

## 2026-06-21 Admin Panel Action Wiring

- Observed: React Admin panel buttons for Domains/DNS, Cross-Domain Routing, Mailboxes, and Aliases rendered but several had no handlers or matching Node API routes.
- Changed: Added Node admin routes for domain DNS records, mailbox create/edit/password/suspend/delete, alias create/edit/delete, and cross-domain routing list/create/delete; mailbox password creation now writes bcrypt/BLF-CRYPT-compatible `$2y$` hashes instead of mock hashes.
- Changed: Moved new multi-step domain/mailbox mutations onto a single MySQL connection transaction helper so `BEGIN`/`COMMIT` cannot hop pooled connections.
- Changed: Wired Admin > Domains, Routing, Mailboxes, and Aliases buttons in `webmail-frontend/src/App.tsx`; DNS Settings opens a copyable records overlay, rows refresh after mutations, and admin action errors surface in the UI.
- Deployed: Synced rebuilt backend to `/opt/openmailstack-backend`, restarted `openmailstack.service`, and synced rebuilt frontend to `/var/www/openmailstack`.
- Verified: `rtk npm --prefix webmail-backend test`, `rtk npm --prefix webmail-frontend run lint`, and `rtk npm --prefix webmail-frontend run build` passed.
- Verified: Live disposable admin API smoke created and cleaned up a temporary domain, mailbox, alias, and cross-domain routing rule through the new endpoints.
- Verified: Browser smoke on `https://mail.housevo.us/` confirmed Admin > Domains DNS overlay, Cross-Domain Routing controls, Mailbox row actions, and Alias row actions render with no new console errors beyond the expected pre-login `/api/auth/me` 401.
- Note: The local test account still had admin rights during verification; sessions for that account were cleared after the smoke so demotion will not leave a stale admin session.

## 2026-06-21 Admin Profile, Group Editor, And Rspamd UI

- Changed: Replaced prompt-only alias target editing with an Admin > Aliases modal that shows group members by mailbox display name, supports Select All, Select None, per-member checkboxes, individual removal, remove selected, and adding mailbox/manual addresses before saving the alias `goto` list.
- Changed: Replaced Mailbox Management `Edit Quota` with a broader mailbox editor modal for display name, quota, phone, alternate email, company, title, address, city, region, postal code, country, notes, and Global Directory visibility.
- Changed: Added additive `webmail_mailbox_profiles` schema for directory-facing mailbox profile metadata without altering PostfixAdmin's core mailbox schema beyond using existing `phone` and `email_other` fields.
- Changed: Added authenticated `/api/directory` for the Contacts app Global Directory view, backed by active mailboxes plus mailbox profile metadata.
- Changed: Made Contacts > Global Directory selectable and populated, while Personal Contacts remains the user's own address book.
- Changed: Replaced the Admin > Rspamd WebUI placeholder with a real `/rspamd/` iframe and new-tab fallback; added a modern `/rspamd/` Nginx proxy to the live vhost and `functions/10_webmail.sh`.
- Deployed: Synced rebuilt backend/frontend to `/opt/openmailstack-backend` and `/var/www/openmailstack`, restarted `openmailstack.service`, and reloaded Nginx.
- Verified: `rtk npm --prefix webmail-backend test`, `rtk npm --prefix webmail-frontend run lint`, `rtk npm --prefix webmail-frontend run build`, `rtk bash -n functions/10_webmail.sh`, and `rtk nginx -t` passed.
- Verified: Live disposable admin API smoke created and cleaned up a temporary domain, two mailboxes, a mailbox profile edit, an alias group membership edit, and confirmed `/api/directory` contained the profile data.
- Verified: Browser smoke confirmed alias member editor, mailbox profile editor, live Rspamd iframe, and Contacts Global Directory render with no new console errors beyond the expected pre-login `/api/auth/me` 401.
- Note: The local test account still had admin rights during verification; sessions for that account were cleared after the smoke.

## 2026-06-21 Calendar Sync Hardening

- Changed: Added shared calendar helpers in `webmail-backend/src/calendar-utils.ts` and pure calendar parsing/key utilities in `webmail-backend/src/calendar-format.ts`.
- Changed: Added additive calendar schema handling for `calendars.dav_slug`, backfilled existing calendars with stable DAV slugs, and reused the existing unique event key on `(calendar_id, uid)` instead of creating a duplicate index.
- Changed: Webapp calendar creation, CalDAV `MKCOL`/`MKCALENDAR`, CalDAV slug/id resolution, calendar collection deletion, and ActiveSync calendar folder listing now share the same calendar model.
- Changed: ActiveSync `FolderSync` computes a real hierarchy key and returns Status `9` for stale keys, allowing iOS-style clients to refresh newly added calendar folders without removing the account.
- Changed: Added authenticated optional `tests/integration/calendar_sync_smoke.sh` for CalDAV calendar creation, event PUT/REPORT, ActiveSync full FolderSync, stale-key reset, and cleanup.
- Backup: Saved focused `calendars`/`events` dump under `live_migration_backups/calendar-sync-20260621-063450/calendars_events.sql` before live deployment.
- Deployed: Synced built backend files to `/opt/openmailstack-backend/src` and restarted `openmailstack.service`.
- Verified: `rtk npm --prefix webmail-backend test` passed with 9 tests.
- Verified: `rtk npm --prefix webmail-backend run build` passed.
- Verified: Live `calendars` table has `dav_slug`, the remaining `Personal` calendar has slug `personal`, and `events` retains the existing unique `cal_uid` key.
- Verified: Live ActiveSync `OPTIONS` returns `200`; CalDAV unauthenticated probe returns Basic-auth challenge; post-restart logs show authenticated CalDAV activity and no duplicate Personal calendar rows.
- Follow-up: Run `OMS_SMOKE_USER=<mailbox> OMS_SMOKE_PASSWORD=<password> rtk bash tests/integration/calendar_sync_smoke.sh` with a real mailbox password to complete authenticated end-to-end validation. CardDAV/contact sync is still not implemented.

## 2026-06-21 Webmail Phase 0-1

- Changed: Declared `webmail-frontend/` plus `webmail-backend/` as the canonical modern webmail surface; marked `webmail/` as a deprecated scaffold.
- Changed: Added backend env config, HttpOnly cookie sessions, login rate limiting, baseline security headers, Vite API proxying, CalDAV IMAP credential verification, and systemd env-file wiring.
- Changed: Removed password-bearing JWT issuance from `/api/auth/login`; `/api/apps` and `/api/events` now use the same session cookie.
- Verified: `rtk npm --prefix webmail-backend run build` passed.
- Verified: `rtk npm --prefix webmail-frontend run build` passed; Vite still warns that the app bundle is larger than 500 kB.
- Known gap: `rtk npm --prefix webmail-frontend run lint` still fails on the pre-existing monolithic `App.tsx` issues, mostly `any` usage plus hook dependency cleanup. Treat this as Phase 2 foundation work.
- Follow-up: Installer/deployment scripts still need to render `/etc/openmailstack/webmail-backend.env` from `config.conf` before enabling `openmailstack.service`.

## 2026-06-21 Webmail Phase 2

- Changed: Added typed frontend domain models for mail folders, messages, signatures, contacts, calendars, admin data, and API refresh responses.
- Changed: Removed broad `any` state/casts from `webmail-frontend/src/App.tsx`, fixed hook dependency cleanup, moved folder-reset state changes out of the message subscription effect, and switched resizable panels to the typed `useDefaultLayout` API.
- Verified: `rtk npm --prefix webmail-frontend run lint` now passes.
- Verified: `rtk npm --prefix webmail-frontend run build` passes; Vite still warns that the app bundle is larger than 500 kB.
- Follow-up: The frontend is still a monolithic `App.tsx`; later enterprise UX/performance phases should split features into modules and code-split heavy surfaces.

## 2026-06-21 Webmail Phase 3

- Changed: Added `functions/10_webmail.sh` to deploy the React frontend, build/install the Node backend, render `/etc/openmailstack/webmail-backend.env`, install/start `openmailstack.service`, and inject Nginx routes for modern webmail/API/sync endpoints.
- Changed: Wired modern webmail into `install.sh` as a first-class component and added default `OMS_*` config knobs to `config.default`.
- Changed: Removed unused `jsonwebtoken` and `@types/jsonwebtoken` from `webmail-backend` dependencies.
- Changed: Added standard dependency/build output ignores for `node_modules/`, `dist/`, `.vite/`, and `*.tsbuildinfo`.
- Verified: `rtk bash -n functions/10_webmail.sh` passed.
- Verified: `rtk bash -n install.sh` passed.
- Verified: `rtk ./install.sh --dry-run` passed.
- Verified: `rtk npm --prefix webmail-backend run build` passed.
- Verified: `rtk npm --prefix webmail-frontend run lint` and `rtk npm --prefix webmail-frontend run build` passed; Vite still warns that the app bundle is larger than 500 kB.
- Follow-up: Validate the new webmail deployment module on a clean VM with real Nginx/systemd before release.

## 2026-06-21 Webmail Phase 4

- Changed: Moved Sieve filter compilation into `webmail-backend/src/sieve-compiler.ts`, added Sieve string escaping, base64-encoded embedded UI JSON, legacy JSON extraction support, and focused unit tests.
- Changed: Added a real `webmail-backend` `npm test` script for the Sieve compiler.
- Changed: Added CalDAV Basic-auth verification caching keyed by credential hash and calendar ownership checks for REPORT, PUT, and DELETE.
- Verified: `rtk npm --prefix webmail-backend test` passed.
- Verified: `rtk npm --prefix webmail-backend run build` passed.
- Follow-up: Add broader integration tests for IMAP/SMTP, CalDAV/CardDAV clients, and ActiveSync device flows.

## 2026-06-21 Webmail Phase 5

- Changed: Lazy-loaded `react-quill-new` behind the compose editor so the rich editor is split into its own frontend chunk.
- Verified: `rtk npm --prefix webmail-frontend run lint` passed.
- Verified: `rtk npm --prefix webmail-frontend run build` passed and no longer emits the previous >500 kB main-bundle warning; output includes a separate `lib-*.js` editor chunk and a smaller `index-*.js`.
- Follow-up: The app is still mostly one React component; future UX work should split mail, calendar, contacts, settings, and admin into feature modules.

## 2026-06-21 Webmail Phase 6

- Changed: Added `docs/webmail-release-validation.md` with local gates, clean-VM gates, and mail/calendar/contacts/mobile/security release checks.
- Changed: Extended `tests/integration/run.sh` with modern webmail deployment guards.
- Changed: Updated `tests/integration/staging_smoke.sh` to check `openmailstack.service`, backend port, modern root webmail, Roundcube fallback, and unauthenticated API 401.
- Changed: Removed the `tests/` ignore from `.gitignore` so release validation guards can be tracked.
- Changed: Restored stdin-based Rspamd password hashing in `functions/05_rspamd_clamav.sh` after integration exposed an argv-secret regression.
- Verified: `rtk bash ./tests/lint/run.sh` passed; shellcheck was not installed and was skipped.
- Verified: `rtk bash ./tests/integration/run.sh` passed.
- Verified: `rtk npm --prefix webmail-backend test`, `rtk npm --prefix webmail-backend run build`, `rtk npm --prefix webmail-frontend run lint`, and `rtk npm --prefix webmail-frontend run build` passed.
- Follow-up: Clean-VM install and real client/device matrix validation still need to be executed outside this workspace.

## 2026-06-21 Live Webmail Migration

- Changed: Migrated the live server to the updated modern webmail frontend/backend without running the full installer or touching MariaDB schemas.
- Backup: Saved rollback artifacts under `/root/openmailstack/live_migration_backups/20260621T103416Z`, including Nginx/systemd config, prior webroot/backend tarballs, and a read-only mail metadata database dump.
- Changed: Deployed backend through a staged `/opt/openmailstack-backend.release.*` directory, swapped it into `/opt/openmailstack-backend`, rendered `/etc/openmailstack/webmail-backend.env`, and installed the updated `openmailstack.service` with `EnvironmentFile`.
- Changed: Deployed frontend through a staged `/var/www/openmailstack.release.*` directory and swapped it into `/var/www/openmailstack`.
- Changed: Patched live Nginx directly to add autodiscover proxying and harden the existing `/api/` proxy. Did not run `functions/10_webmail.sh` wholesale because the live Nginx config already had root/API/CalDAV/ActiveSync routes and would have received duplicate locations.
- Preserved: Previous backend directory at `/opt/openmailstack-backend.previous.20260621T103524Z` and previous webroot at `/var/www/openmailstack.previous.20260621T103546Z`.
- Verified: `nginx -t` passed and Nginx reloaded successfully.
- Verified: `openmailstack.service` active and listening on `127.0.0.1:20000`.
- Verified: Live endpoint smoke checks returned `/` 200, `/webmail/` 200, `/api/auth/me` 401, `/autodiscover/autodiscover.xml` 200, `/.well-known/caldav` 301, and ActiveSync `OPTIONS` 200.
- Verified: Read-only PostfixAdmin DB counts after migration: 2 domains, 2 mailboxes, 9 aliases.
- Verified: `rtk bash ./tests/integration/staging_smoke.sh ./config.conf` passed.

## 2026-06-21 Live Webmail Send Fix

- Observed: Live webmail login worked, but sending from the browser showed `Error sending email`; `openmailstack.service` logs showed Multer/Busboy `Unexpected end of form` for `/api/messages/send`.
- Changed: Updated `webmail-backend/src/index.ts` so the global raw body parser skips `/api/` routes and multipart requests, preserving normal JSON/multipart parsing for the API while keeping raw request bodies for ActiveSync, autodiscover, and CalDAV.
- Changed: Deployed the backend through staged replacement, preserving previous backend at `/opt/openmailstack-backend.previous.20260621T104657Z`.
- Changed: Backed up `/etc/openmailstack/webmail-backend.env` to `/etc/openmailstack/webmail-backend.env.backup.20260621T104952Z` and changed `OMS_SMTP_HOST` from `127.0.0.1` to `mail.housevo.us` so SMTP STARTTLS uses the certificate hostname while staying local via host resolution.
- Verified: PostfixAdmin domains currently present are `ALL` and `housevo.us`; `ALL` is the PostfixAdmin global/special row, and `housevo.us` is the real mail domain.
- Verified: `rtk npm --prefix webmail-backend test` passed.
- Verified: `openmailstack.service` restarted and stayed active.
- Verified: Multipart unauthenticated send probe returns `401` without new Busboy parser errors.
- Verified: `rtk bash ./tests/integration/staging_smoke.sh ./config.conf` passed after the backend deploy and after the SMTP env change.

## 2026-06-21 Live SMTP Greeting Fix

- Observed: Browser send progressed past multipart parsing but failed with `Failed to send: Greeting never received`.
- Root cause: Rspamd's `rspamd_proxy` worker on `127.0.0.1:11332` had lost heartbeat for hours and its listener accept queue was backed up; Postfix waited on the milter handshake before sending SMTP greetings, so Nodemailer timed out.
- Changed: Restarted `rspamd.service`; Postfix on ports 25 and 587 immediately resumed sending `220 mail.housevo.us ESMTP Postfix (Debian/GNU)` greetings.
- Changed: Backed up `/etc/postfix/main.cf` to `/etc/postfix/main.cf.backup.20260621T105832Z`, set live `milter_connect_timeout = 5s` and `milter_command_timeout = 5s`, and reloaded Postfix so future milter hangs degrade to accepted mail instead of blocking SMTP greetings for the default timeout.
- Changed: Added the same milter timeout settings to `functions/05_rspamd_clamav.sh` and added an integration guard in `tests/integration/run.sh`.
- Verified: `rtk rspamadm configtest` passed before restart.
- Verified: Rspamd listener queue for `127.0.0.1:11332` returned to `Recv-Q 0`.
- Verified: SMTP greeting probes for `127.0.0.1:587` and `mail.housevo.us:587` returned `220`; STARTTLS on `127.0.0.1:587` with SNI `mail.housevo.us` passed.
- Verified: `rtk node` Nodemailer connectivity check returned `nodemailer_smtp_ready`.
- Verified: `rtk bash -n functions/05_rspamd_clamav.sh`, `rtk bash ./tests/integration/run.sh`, and `rtk bash ./tests/integration/staging_smoke.sh ./config.conf` passed.
- Verified: Read-only mail metadata counts remained 2 domains and 2 mailboxes.

## 2026-06-21 Webmail Phase 7 Search

- Direction: User confirmed the next priority is Gmail/Outlook/Proton-style product features such as search, while deprioritizing Proton-style anonymity/zero-knowledge claims.
- Changed: Added authenticated `/api/messages/search` for native IMAP search with `all`, `from`, `to`, `subject`, and `body` fields, current-folder or all-folder scope, result limits, and folder metadata on results.
- Changed: Added `ImapService.searchMessages()` to search selected folders through ImapFlow and return lightweight message summaries.
- Changed: Added webmail search UI in `webmail-frontend/src/App.tsx` with query, field, scope, loading, clear, result count, all-folder labels, and bulk-action safeguards for cross-folder results.
- Deployed: Backend staged through `/opt/openmailstack-backend.previous.20260621T111551Z`; frontend staged through `/var/www/openmailstack.previous.20260621T111604Z`.
- Verified: `rtk npm --prefix webmail-backend test` passed.
- Verified: `rtk npm --prefix webmail-backend run build` passed and generated `src/*.js` search output.
- Verified: `rtk npm --prefix webmail-frontend run lint` and `rtk npm --prefix webmail-frontend run build` passed.
- Verified: Live `openmailstack`, Nginx, Postfix, and Rspamd services active; unauthenticated search probe returns `401`.
- Verified: `rtk bash ./tests/integration/staging_smoke.sh ./config.conf` passed after deployment.
- Follow-up: This is live IMAP search, not a persistent indexed search system with operators, attachments, ranking, and saved searches.

## 2026-06-21 Webmail Phase 8 Read State And Stars

- Observed: Opening unread mail did not decrement the unread folder badge.
- Changed: Added IMAP `read`, `unread`, `star`, and `unstar` actions using ImapFlow flag mutations.
- Changed: Message summaries, search results, and detail responses now expose `isRead` and `isStarred`.
- Changed: Opening a message marks unread messages read explicitly, updates the local message list/thread, decrements the folder unread badge immediately, and refreshes folder counts for server reconciliation.
- Changed: Added toolbar actions for mark read, mark unread, and star selected messages, plus row-level star/unstar controls.
- Changed: Extended search with `Unread` and `Starred` filters plus lightweight operators such as `is:unread`, `is:read`, `is:starred`, `from:`, `to:`, and `subject:`.
- Deployed: Backend staged through `/opt/openmailstack-backend.previous.20260621T112619Z`; frontend staged through `/var/www/openmailstack.previous.20260621T112634Z`.
- Verified: `rtk npm --prefix webmail-backend test` passed.
- Verified: `rtk npm --prefix webmail-frontend run lint` and `rtk npm --prefix webmail-frontend run build` passed.
- Verified: Live `openmailstack`, Nginx, Postfix, and Rspamd services active; unauthenticated search/action probes return `401`.
- Verified: `rtk bash ./tests/integration/staging_smoke.sh ./config.conf` passed after deployment.

## 2026-06-21 Webmail Phase 9 Indexed Search

- Changed: Added additive `mail_search_index` table initialization with per-user/folder/UID uniqueness, flag/date indexes, and FULLTEXT indexing over subject, sender, recipients, body text, and attachment names. This does not delete or modify existing mail tables.
- Changed: Added backend search-index helpers for lazy upsert, flag synchronization, row deletion after moves/deletes, index status, and indexed search with fallback LIKE matching for short terms.
- Changed: Message listing and IMAP search fallback now index parsed messages opportunistically; message read/unread/star/unstar actions update indexed flags; move/archive/spam/delete actions prune source-folder index rows.
- Changed: Added authenticated `/api/messages/search/index/status` and `/api/messages/search/index` for status and bounded manual indexing of recent messages.
- Changed: Added frontend attachment-name search, an update-index icon action, and concise indexed/mailbox search status text.
- Backup: Saved rollback artifacts under `/root/openmailstack/live_migration_backups/20260621T113800Z-search-index`, including backend/frontend tarballs, live service config, Nginx config when present, and a schema-only pre-migration database dump.
- Deployed: Backend staged through `/opt/openmailstack-backend.previous.20260621T113847Z`; frontend staged through `/var/www/openmailstack.previous.20260621T113847Z`.
- Verified: `rtk npm --prefix webmail-backend test` passed.
- Verified: `rtk npm --prefix webmail-frontend run lint` and `rtk npm --prefix webmail-frontend run build` passed.
- Verified: `mail_search_index` exists live with expected BTREE and FULLTEXT indexes.
- Verified: Unauthenticated direct-backend and hostname probes for search status, index update, and search return `401`.
- Verified: `rtk bash ./tests/integration/staging_smoke.sh ./config.conf` passed after deployment.
- Follow-up: Authenticated end-to-end index refresh/search should be exercised from the browser with a real mailbox session; longer-term enterprise search still needs incremental/background workers, saved searches, advanced operators, and attachment content extraction.

## 2026-06-21 Webmail Phase 10 Saved Search And Incremental Sync

- Changed: Added additive `mail_saved_searches` table initialization for user-scoped saved searches with name, query, field, scope, folder, and timestamps.
- Changed: Added session-bound incremental indexing via authenticated `/api/messages/search/index/sync`; it uses current session IMAP credentials, fetches only UIDs newer than each folder's indexed max UID, and falls back to a bounded recent-message index on empty folders/indexes.
- Changed: Added authenticated saved-search list/create/delete endpoints under `/api/messages/search/saved`.
- Changed: Frontend now quietly triggers a bounded current-folder index sync after login/folder changes, and shows saved-search chips with apply/delete controls plus a save-search icon in the search toolbar.
- Backup: Saved rollback artifacts under `/root/openmailstack/live_migration_backups/20260621T115201Z-saved-search-sync`, including backend/frontend tarballs, service config, Nginx config when present, and a schema-only pre-migration database dump.
- Deployed: Backend staged through `/opt/openmailstack-backend.previous.20260621T115214Z`; frontend staged through `/var/www/openmailstack.previous.20260621T115214Z`.
- Verified: `rtk npm --prefix webmail-backend test` passed.
- Verified: `rtk npm --prefix webmail-frontend run lint` and `rtk npm --prefix webmail-frontend run build` passed.
- Verified: `mail_saved_searches` exists live with expected primary and user-updated indexes.
- Verified: Unauthenticated direct-backend and hostname probes for saved-search and index-sync endpoints return `401`.
- Verified: `rtk bash ./tests/integration/staging_smoke.sh ./config.conf` passed after deployment.
- Follow-up: Authenticated browser testing should create/apply/delete a saved search and observe the background sync with a real mailbox session. This is session-bound indexing, not a daemon that can index mailboxes when users are logged out.

## 2026-06-21 Webmail Phase 11 Folder Pagination

- Observed: Folder views only showed the newest roughly 25 messages because `ImapService.getMessages()` intentionally fetched bounded batches and the frontend had no older-page UI.
- Changed: `/api/folders/:folder/messages` now accepts `olderThan=<uid>` and returns `uidNext`, `lowestUid`, and `moreAvailable` metadata from IMAP.
- Changed: The frontend tracks folder pagination state, appends older pages with duplicate UID protection, and shows a `Load older` control at the bottom of non-search folder results when more messages are available.
- Changed: Older-page IMAP searches now explicitly request UID-mode results.
- Backup: Saved rollback artifacts under `/root/openmailstack/live_migration_backups/20260621T120511Z-mail-pagination`.
- Deployed: Backend staged through `/opt/openmailstack-backend.previous.20260621T120527Z`; frontend staged through `/var/www/openmailstack.previous.20260621T120527Z`.
- Verified: `rtk npm --prefix webmail-backend test` passed.
- Verified: `rtk npm --prefix webmail-frontend run lint` and `rtk npm --prefix webmail-frontend run build` passed.
- Verified: Unauthenticated direct-backend and hostname probes for folder listing and older-page endpoints return `401`.
- Verified: `rtk bash ./tests/integration/staging_smoke.sh ./config.conf` passed after deployment.
- Follow-up: Authenticated browser testing should click `Load older` in a folder with more than 25 messages and confirm the next batch appends in date order.

## 2026-06-21 Webmail Phase 12 Attachments

- Observed: Opened mail did not expose parsed attachments, so users could not see, preview, or download PDFs/images/documents attached to messages.
- Changed: Message summaries now include `hasAttachments` and opened message detail responses include attachment metadata with filename, MIME type, size, disposition, and previewability.
- Changed: Added authenticated `/api/folders/:folder/messages/:uid/attachments/:attachmentId` to stream attachment bytes inline for browser-previewable types or as downloads with `?download=1`.
- Changed: Search-index results also expose `hasAttachments` when attachment names are indexed.
- Changed: The frontend shows paperclip markers in message rows and attachment rows under opened messages with browser-native Preview actions for images/PDF/text and Download actions for every attachment.
- Backup: Saved rollback artifacts under `/root/openmailstack/live_migration_backups/20260621T123046Z-mail-attachments`.
- Deployed: Backend staged through `/opt/openmailstack-backend.previous.20260621T123059Z`; frontend staged through `/var/www/openmailstack.previous.20260621T123059Z`.
- Verified: `rtk npm --prefix webmail-backend test` passed.
- Verified: `rtk npm --prefix webmail-frontend run lint` and `rtk npm --prefix webmail-frontend run build` passed.
- Verified: Unauthenticated direct-backend and hostname probes for message detail and attachment endpoints return `401`.
- Verified: `rtk bash ./tests/integration/staging_smoke.sh ./config.conf` passed after deployment.
- Follow-up: Authenticated browser testing should open a real message with PDF/image/doc attachments and confirm metadata, preview, and download behavior. Office/docx files are downloadable; inline preview depends on browser-native support.

## 2026-06-21 Webmail Phase 13 Persistent Sessions

- Observed: Force reloads and backend restarts caused the browser to return to the login screen because webmail sessions were stored only in an in-memory `Map`.
- Changed: Replaced in-memory sessions with additive `webmail_sessions` table storage keyed by SHA-256 session-token hashes.
- Changed: Session mailbox passwords are stored encrypted with AES-256-GCM using `OMS_SESSION_SECRET` when set, falling back to the existing `OMS_DB_PASSWORD` as a stable live key. Raw session tokens are not stored in the database.
- Changed: Login/logout/auth middleware now use async database-backed session create/read/delete paths and sliding TTL refresh.
- Backup: Saved rollback artifacts under `/root/openmailstack/live_migration_backups/20260621T123605Z-persistent-sessions`, including backend/frontend tarballs, service config, Nginx config when present, and a schema-only pre-migration database dump.
- Deployed: Backend staged through `/opt/openmailstack-backend.previous.20260621T123618Z`; frontend staged through `/var/www/openmailstack.previous.20260621T123618Z`.
- Verified: `rtk npm --prefix webmail-backend test` passed.
- Verified: `rtk npm --prefix webmail-frontend run lint` and `rtk npm --prefix webmail-frontend run build` passed.
- Verified: `webmail_sessions` exists live with primary, expires-at, and username indexes.
- Verified: Unauthenticated direct-backend and hostname probes for `/api/auth/me` return `401`; unauthenticated logout returns `200` and clears any cookie.
- Verified: `rtk bash ./tests/integration/staging_smoke.sh ./config.conf` passed after deployment.
- Follow-up: Authenticated browser testing should log in, force reload, and confirm the session survives. A future hardening pass should set an explicit high-entropy `OMS_SESSION_SECRET` instead of relying on the DB password fallback.

## 2026-06-21 Webmail Phase 14 Sync Setup Guide

- Changed: Added `Sync Setup` buttons to the Calendar and Contacts webapp headers.
- Changed: Added a shared setup modal with copyable CalDAV discovery/home URLs, IMAP/SMTP host and port guidance, ActiveSync endpoint details, and iOS/Android/Desktop setup notes derived from the live page origin and authenticated mailbox address.
- Changed: Contacts setup now clearly marks CardDAV as reserved/not enabled instead of presenting the current `/.well-known/carddav` redirect as working contact sync.
- Deployed: Frontend deployed to `/var/www/openmailstack` with `functions/deploy_webmail_frontend.sh`.
- Verified: `rtk npm --prefix webmail-frontend run lint` passed.
- Verified: `rtk npm --prefix webmail-frontend run build` passed.
- Verified: Live `https://mail.housevo.us/` returned `200 OK` and the deployed bundle contains the new setup guide strings.
- Verified: `rtk bash ./tests/integration/staging_smoke.sh ./config.conf` passed after deployment.
- Follow-up: Authenticated browser testing should open Calendar and Contacts, click `Sync Setup`, copy each value, and test the CalDAV discovery URL in macOS Calendar or another CalDAV client.

## 2026-06-21 Webmail Phase 15 CardDAV Enablement

- Changed: Added shared DAV Basic-auth middleware backed by IMAP credential verification and switched CalDAV to use it.
- Changed: Added additive contacts schema support for CardDAV metadata: `dav_uid`, `sync_token`, `phone`, `vcard_data`, timestamps, and `idx_contacts_user_dav_uid`; existing contacts are backfilled with stable `contact-<id>` DAV IDs.
- Changed: Added `/carddav` backend support for `OPTIONS`, `PROPFIND`, `REPORT`, `GET`/`HEAD`, `PUT`, `DELETE`, and `PROPPATCH` against `/carddav/addressbooks/<user>/personal/`.
- Changed: `/.well-known/carddav` now redirects to `/carddav/`, and live Nginx proxies `/carddav` to the Node backend.
- Changed: Contacts `Sync Setup` now shows working CardDAV discovery and address book URLs instead of the previous reserved/not-enabled note.
- Changed: Added optional authenticated `tests/integration/carddav_sync_smoke.sh` for PUT, PROPFIND, REPORT, GET, and DELETE round trips.
- Backup: Saved backend, frontend, Nginx, and `contacts` table rollback artifacts under `/root/openmailstack/live_migration_backups/20260621T140726Z-carddav`.
- Deployed: Backend rsynced to `/opt/openmailstack-backend`, `openmailstack.service` restarted, live Nginx reloaded, and frontend deployed to `/var/www/openmailstack`.
- Verified: `rtk npm --prefix webmail-backend test`, `rtk npm --prefix webmail-frontend run lint`, `rtk npm --prefix webmail-frontend run build`, and `rtk bash tests/integration/run.sh` passed.
- Verified: Live `/.well-known/carddav` returns a `301` to `/carddav/`, live `/carddav/` returns a CardDAV Basic-auth challenge, the `contacts` table has the CardDAV columns and index, and no CardDAV/contact schema errors appeared in `openmailstack.service` logs after restart.
- Verified: `rtk bash ./tests/integration/staging_smoke.sh ./config.conf` passed after deployment; unauthenticated `tests/integration/carddav_sync_smoke.sh` skips safely without credentials.
- Follow-up: Run `OMS_SMOKE_USER=<mailbox> OMS_SMOKE_PASSWORD=<password> rtk bash tests/integration/carddav_sync_smoke.sh` with a real mailbox password, then test Apple Contacts/Thunderbird/DAVx5. ActiveSync contacts remain separate from CardDAV and still need real contact folder sync.

## 2026-06-21 Webmail Phase 16 Protocol Smokes And ActiveSync Contacts

- Changed: Added `tests/integration/mail_sync_smoke.sh` for direct SMTP submission, IMAP receipt, webmail API send/read, and attachment download validation with an authenticated mailbox.
- Changed: Fixed first-send behavior for new mailboxes by creating the `Sent` IMAP folder before webmail appends the sent copy.
- Changed: Replaced the advertised `mock-contacts` ActiveSync folder with a stable real `contacts` collection while accepting the legacy mock ID as an alias.
- Changed: ActiveSync contacts now support FolderSync discovery, GetItemEstimate, Sync from the shared contacts/CardDAV table, and basic client Add/Change/Delete commands.
- Changed: Added `tests/integration/activesync_contacts_smoke.sh` to seed through CardDAV, validate ActiveSync Contacts discovery, validate GetItemEstimate, validate Contacts Sync payloads, and clean up.
- Backup: Saved the previous live backend under `/root/openmailstack/live_migration_backups/20260621T151525Z-protocol-smokes-and-eas-contacts/backend` before deployment.
- Deployed: Rebuilt the backend, rsynced it to `/opt/openmailstack-backend`, fixed ownership, and restarted `openmailstack.service`.
- Verified: `rtk npm --prefix webmail-backend test`, `rtk npm --prefix webmail-frontend run lint`, and `rtk bash tests/integration/run.sh` passed.
- Verified: Authenticated local smokes passed for `mail_sync_smoke.sh`, `carddav_sync_smoke.sh`, `calendar_sync_smoke.sh`, and `activesync_contacts_smoke.sh` using the local test mailbox.
- Verified: Live autodiscover for `localtest@housevo.us` returns `MobileSync` with `https://mail.housevo.us/Microsoft-Server-ActiveSync`.
- Verified: `openmailstack.service` stayed active after restart; live `/api/auth/me` returned unauthenticated `401`; post-restart backend logs had no focused error matches.
- Follow-up: Run the same account through real iPhone Exchange setup, Apple Contacts CardDAV, Apple Calendar CalDAV, Apple Mail IMAP/SMTP, and Android DAVx5/K-9 or equivalent. ActiveSync contact tombstones/photos/conflict handling still need product hardening.

## 2026-06-21 Webmail Phase 17 Calendar Client Write Sync

- Observed: A Mac Calendar-created event was stored through CalDAV, but the webapp did not show it because Apple emitted a `VTIMEZONE` block before `VEVENT`; the backend parser picked the timezone `DTSTART:19911001T040000` instead of the event `DTSTART`.
- Observed: iPhone-created calendar events reached the ActiveSync Calendar `Sync` endpoint with `ApplicationData`, but the backend calendar branch only returned server events and did not persist client `Add`/`Change`/`Delete` commands.
- Changed: `parseIcalEvent()` now isolates direct `VEVENT` properties before reading UID, summary, start/end, description, and dtstamp, so timezone/VALARM fields do not override the event.
- Changed: ActiveSync Calendar `Sync` for `cal-*` collections now persists basic client `Add`, `Change`, and `Delete` commands into the shared `events` table and increments the calendar sync token.
- Changed: `tests/integration/calendar_sync_smoke.sh` now validates ActiveSync calendar client writes by creating an event through WBXML `Sync/Add` and verifying the same event is visible through CalDAV `REPORT`.
- Backup: Saved deployed backend and a focused `calendars`/`events` dump under `/root/openmailstack/live_migration_backups/20260621T154605Z-calendar-client-sync` before live deployment/validation.
- Deployed: Rebuilt the backend, rsynced it to `/opt/openmailstack-backend`, fixed ownership, and restarted `openmailstack.service`; no frontend deployment was needed.
- Verified: `rtk npm --prefix webmail-backend test`, `rtk bash -n tests/integration/calendar_sync_smoke.sh`, and `rtk bash tests/integration/run.sh` passed before deployment.
- Verified: Authenticated local `calendar_sync_smoke.sh` passed after deployment, covering CalDAV create/report, ActiveSync FolderSync, ActiveSync client-created calendar event persistence, CalDAV visibility of the ActiveSync event, stale hierarchy reset, and cleanup.
- Verified: Deployed `src/index.js` and `src/calendar-format.js` match the tested build, `openmailstack.service` stayed active, and `rtk bash ./tests/integration/staging_smoke.sh ./config.conf` passed.
- Follow-up: Real Mac Calendar/iPhone validation should create a fresh event and refresh the webapp calendar. Timezone fidelity is still basic; named `TZID` values are parsed onto the correct date but not fully converted through a timezone database.

## 2026-06-21 Webmail Phase 18 ActiveSync Calendar No-Echo

- Observed: iPhone-created events were persisted and appeared in the webapp, but then disappeared from iPhone Calendar. Live ActiveSync logs showed the server acknowledged the client `Add` while also returning server `Commands` for the same calendar immediately afterward; iOS then sent repeated `Change` commands with placeholder fields such as `EndTime:20010101T000000Z`.
- Changed: ActiveSync calendar responses now suppress server-side `Commands` in the same `Sync` response that accepts a client-side calendar write, so iOS receives only the `Responses/Add|Change|Delete` acknowledgement and the next sync key.
- Changed: ActiveSync calendar outbound dates now use compact UTC timestamps like `20260704T190000Z`, matching the iOS Calendar request shape.
- Changed: ActiveSync calendar save now skips database updates and sync-token increments when the generated iCalendar payload is unchanged, reducing retry loops from no-op client `Change` commands.
- Changed: `tests/integration/calendar_sync_smoke.sh` now performs an initial ActiveSync calendar sync, verifies compact server date output, sends a client `Add` with a current sync key, fails if the server echoes duplicate `Commands` in that response, and verifies a follow-up Sync with the returned key has no duplicate changes.
- Backup: Saved deployed backend and a focused `calendars`/`events` dump under `/root/openmailstack/live_migration_backups/20260621T160433Z-eas-calendar-no-echo`.
- Deployed: Rebuilt the backend, rsynced it to `/opt/openmailstack-backend`, fixed ownership, and restarted `openmailstack.service`; no frontend deployment was needed.
- Verified: `rtk npm --prefix webmail-backend test`, `rtk bash -n tests/integration/calendar_sync_smoke.sh`, and `rtk bash tests/integration/run.sh` passed before deployment.
- Verified: Authenticated local `calendar_sync_smoke.sh` passed after deployment with the new no-echo checks; `rtk bash ./tests/integration/staging_smoke.sh ./config.conf` passed; deployed `src/index.js` and `src/calendar-format.js` match the tested build.
- Follow-up: Ask the user to create a fresh iPhone event after deployment and watch whether the phone keeps it. Real-device recurring-event and timezone behavior still needs separate hardening.

## 2026-06-21 Webmail Phase 19 Frontend Navigation And Calendar Event Details

- Changed: Renamed the top-level webapp nav label from `Webmail` to `Mail` and added `Sync Info`, leaving the main product links as `Mail | Calendar | Contacts | Sync Info`.
- Changed: Added explicit app-mode state with localStorage persistence and saved-tab validation so browser reloads preserve the current app section instead of falling back to Mail.
- Changed: Added a global header refresh icon that refreshes the current section: folders/messages for Mail, calendars for Calendar, contacts for Contacts, and setup data for Sync Info.
- Changed: Added a full Sync Info page that reuses the existing copyable CalDAV, CardDAV, IMAP/SMTP, ActiveSync, iOS/Android, and desktop setup sections; Calendar/Contacts shortcut buttons now route there.
- Changed: Calendar event chips now open a details dialog with event title, time range, calendar, location, description, edit, and delete actions. Editing reuses the same UID so saving changes updates the event rather than creating a duplicate.
- Backup: Saved the previous live frontend webroot under `/root/openmailstack/live_migration_backups/20260621T162624Z-frontend-ui-sync/webroot`.
- Deployed: Rebuilt and deployed only static frontend assets to `/var/www/openmailstack` with `functions/deploy_webmail_frontend.sh`; backend services and mail/database state were not modified.
- Verified: `rtk npm --prefix webmail-frontend run lint` and `rtk npm --prefix webmail-frontend run build` passed.
- Verified: Deployed `/var/www/openmailstack/index.html` matches the fresh build and live HTTPS `https://mail.housevo.us/` returns the new bundle.
- Verified: Playwright browser smoke logged into the local test mailbox, confirmed the live nav labels, confirmed Calendar survives a forced browser reload, confirmed Sync Info renders, and confirmed the global refresh stays on Sync Info.
- Follow-up: The local test mailbox had no calendar collections/events, so event-click behavior was verified by build/type checks rather than a live click against existing event data. Test against a real calendar with events after the user's next device-created event appears in the webapp.

## 2026-06-21 Webmail Phase 20 Calendar Color Editor

- Observed: The Calendar sidebar edit button only allowed renaming a calendar and did not expose the color that controls event-chip display.
- Changed: Added authenticated `PUT /api/apps/calendars/:id` to update calendar name and `#RRGGBB` color with ownership checks and `sync_token` increment.
- Changed: Replaced the sidebar rename prompt with an Edit Calendar dialog containing name editing, color swatches, and a native custom color picker. Calendar edit/delete icon buttons now have tooltips and ARIA labels.
- Backup: Saved the previous live `apps-api.js`, `apps-api.ts`, and frontend webroot under `/root/openmailstack/live_migration_backups/20260621T164136Z-calendar-color-editor`.
- Deployed: Copied the updated backend API files to `/opt/openmailstack-backend/src`, restored backend ownership, restarted `openmailstack.service`, and deployed the rebuilt frontend to `/var/www/openmailstack`.
- Verified: `rtk npm --prefix webmail-backend test`, `rtk npm --prefix webmail-backend run build`, `rtk npm --prefix webmail-frontend run lint`, and `rtk npm --prefix webmail-frontend run build` passed.
- Verified: Authenticated local API smoke created a temporary calendar, updated its color through the new route, verified the stored color, and deleted the temporary calendar.
- Verified: Playwright browser smoke loaded the live bundle, created a temporary calendar, opened the sidebar Edit Calendar dialog, selected a color swatch, saved it, verified the updated color via API, and deleted the temporary calendar. The test mailbox was left with only its original Personal calendar.
- Follow-up: Calendar deletion in the sidebar still updates local state only; wire it to a persisted backend/CalDAV delete flow before treating calendar management as complete.

## 2026-06-21 Webmail Phase 21 Persisted Calendar Deletion

- Observed: The Calendar sidebar delete button removed calendars from React state only; it did not persist deletion to the server, so refresh/sync could bring the calendar back.
- Changed: Added authenticated `DELETE /api/apps/calendars/:id` with ownership checks, invalid-id handling, a guard that keeps at least one visible calendar, transactional event cleanup, and calendar row deletion.
- Changed: Updated the Calendar sidebar delete button to call the persisted API route, warn when deleting calendars with events, clear selected deleted events, and refresh calendars from the server after success.
- Backup: Saved the previous live `apps-api.js`, `apps-api.ts`, and frontend webroot under `/root/openmailstack/live_migration_backups/20260621T165149Z-calendar-delete-management`.
- Deployed: Copied updated backend API files to `/opt/openmailstack-backend/src`, restored backend ownership, restarted `openmailstack.service`, and deployed the rebuilt frontend to `/var/www/openmailstack`.
- Verified: `rtk npm --prefix webmail-backend test`, `rtk npm --prefix webmail-backend run build`, `rtk npm --prefix webmail-frontend run lint`, and `rtk npm --prefix webmail-frontend run build` passed.
- Verified: Authenticated local API smoke created a temporary calendar, deleted it through the new webapp API route, and verified it was gone with only `Personal` remaining.
- Verified: Playwright browser smoke loaded the live bundle, created a temporary calendar, refreshed the Calendar view, clicked the sidebar delete button, verified the calendar was removed via API, and verified the single-calendar guard leaves `Personal` intact.
- Verified: `rtk bash ./tests/integration/staging_smoke.sh ./config.conf` passed after deployment.
- Follow-up: Calendar creation still uses a prompt; future calendar-management UX should move create/edit/delete into a consistent dialog flow with clearer destructive-action copy and event counts.

## 2026-06-21 Documentation Cleanup

- Changed: Added `ROADMAP.md` as the single current roadmap for remaining product, sync, settings, security, installer, and operations work.
- Changed: Updated `README.md`, `INSTALLATION.md`, and `TECHNICAL.md` so modern React webmail is described as the primary product surface and Roundcube is described as a fallback.
- Changed: Consolidated useful stale review context into `.shared_memory/risk_register.md`, including the remaining ManageSieve parser hardening risk.
- Removed: Deleted duplicate or stale audit/review/status markdown files that were superseded by `.shared_memory`, `ROADMAP.md`, and current docs.
- Kept: `settings_plan.md`, `docs/webmail-release-validation.md`, package READMEs, and `.shared_memory/*.md` because they remain current and operationally useful.
- Follow-up: As the release path stabilizes, consider moving long-form planning docs under `docs/` and keeping the repository root limited to user-facing docs.

## 2026-06-21 Webmail Phase 22 Settings Expansion And Admin Settings

- Changed: Expanded user settings persistence for mail identity/compose/reading, calendar defaults, and contacts display in `webmail-backend/src/user-settings.ts` and `webmail-frontend/src/settings/settingsApi.ts`.
- Changed: Added `webmail-backend/src/admin-settings.ts` plus admin-only `/api/admin/settings/:namespace` GET/PUT routes for organization, public URL, security, mail policy, and system settings.
- Changed: Added the Admin > Settings hub in the React app, alongside the existing Admin > Branding panel.
- Changed: Mail settings UI now includes Identity & Compose, Signatures, and Reading panes; Calendar and Contacts settings now expose editable defaults instead of read-only placeholders.
- Changed: Compose now honors default From, self-Bcc, Reply-To, default new-message signature, and default reply signature. Backend send/draft now passes `cc`, `bcc`, and `replyTo` through Nodemailer.
- Changed: Calendar event creation now uses saved default calendar, duration, time zone, and reminder settings. Contacts view applies saved name format, sort mode, and list density.
- Changed: Fixed the Node Admin > Domains preload query to read verification tokens from the existing `domain_verification` table instead of assuming a non-existent `domain.verify_token` column.
- Deployed: Rebuilt and deployed frontend assets to `/var/www/openmailstack`, synced the built backend to `/opt/openmailstack-backend`, restored backend ownership, and restarted `openmailstack.service`.
- Verified: `rtk npm --prefix webmail-frontend run lint`, `rtk npm --prefix webmail-frontend run build`, and `rtk npm --prefix webmail-backend test` passed.
- Verified: Live API smoke confirmed branding, local test login, user settings hydration for `mail`, `calendar`, `contacts`, and `appearance`, non-admin rejection for admin settings, and a contacts settings PUT/restore round trip.
- Verified: Playwright smoke on `http://127.0.0.1:5173` confirmed the branded app session, Settings navigation, and the new Identity, Reading, Calendar, and Contacts settings tabs render without console warnings.
- Verified: After temporary admin promotion, authenticated API smoke confirmed `localtest@housevo.us` was admin, all five admin settings namespaces loaded, a temporary System notice saved and restored, `/api/admin/domains` loaded without 500, and Playwright confirmed Admin > Settings rendered without console errors.
- Follow-up: Admin security/mail-policy/system values are stored but not yet enforced by session, Postfix/Rspamd, or update workflows.

## 2026-06-22 Admin V1, GAL, Mail Undo, And Calendar Recurrence

- Changed: Added additive `webmail_admin_audit` storage plus sanitized audit writes for Branding, Admin Settings, domains, admins, mailboxes, aliases, routing, API keys, and spam policy mutations. `/api/admin/logs` now reads the modern audit table.
- Changed: Routed remaining React admin actions for admin promotion/demotion, API key create/revoke, and spam policy save through the shared admin action wrapper for consistent refreshes and error/status banners.
- Changed: Extended `/api/contacts` with phone support and save-from-directory behavior; compose autocomplete now merges personal contacts and Global Directory entries; Contacts > Global Directory entries can be saved into Personal Contacts.
- Changed: IMAP move/delete/archive/spam actions now return destination folder and UID map metadata when available; the Mail UI shows an undo snackbar for move-like actions and supports conservative keyboard shortcuts outside editable fields.
- Changed: Added simple daily/weekly/monthly/yearly `RRULE` parsing, bounded recurrence expansion in the web calendar API, recurrence labels in event details, and recurrence writing from the advanced event editor.
- Backup: Saved deployed backend and frontend webroot under `/root/openmailstack/live_migration_backups/20260622T002157Z-admin-gal-mail-calendar`.
- Deployed: Rebuilt backend/frontend, synced backend to `/opt/openmailstack-backend`, synced frontend to `/var/www/openmailstack`, restarted `openmailstack.service`, normalized deployed webroot permissions, and reloaded Nginx.
- Verified: `rtk npm --prefix webmail-backend test`, `rtk npm --prefix webmail-backend run build`, `rtk npm --prefix webmail-frontend run lint`, and `rtk npm --prefix webmail-frontend run build` passed.
- Verified: `rtk bash ./tests/integration/staging_smoke.sh ./config.conf` passed after deployment; live probes returned `/` 200, `/api/auth/me` 401, `/api/directory` 401, and `/rspamd/` 200.
- Verified: Authenticated live smoke with the local test admin account confirmed Admin Settings audit-log writes, `/api/directory`, recurring calendar event expansion to three occurrences, and cleanup deletion of the temporary calendar; web sessions for the test account were cleared afterward.
- Note: Manual frontend rsync preserved restrictive local `dist/` permissions until normalized on the deployed webroot; the repo deploy helpers already run directory/file chmod after rsync.
- Follow-up: Admin settings still need enforcement, mailbox primary email rename remains intentionally blocked, recurring events need exception/series-edit UX, and real-device client validation remains the next release gate.

## 2026-06-29 Settings Milestones 3–6

- Changed: Completed Settings Milestone 3 (Mail Settings Product Pass): filter enable/disable, forwarding keep-copy, compose preferences (defaultMode, defaultFont, attachmentReminder), reading preferences (density, snippets, externalImages, markReadDelay), spam/senders honesty.
- Changed: Completed Settings Milestone 4 (Calendar Settings Product Pass): added 'agenda' to defaultView type, wired view toggle persistence, applied clockFormat to day/week time labels and multi-day event display, applied defaultReminderMinutes to event editing and drag-and-drop.
- Changed: Completed Settings Milestone 5 (Contacts Settings Product Pass): fixed backend sortBy type mismatch (name/email → firstName/lastName/email), wired listDensity to contact card grid (cozy/compact/comfortable presets), applied nameFormat/sortBy to compose autocomplete.
- Changed: Completed Settings Milestone 6 (Account, Security, and Release Hardening): implemented real session listing (DB-backed), DELETE session revocation endpoint, auto-save indicator (Saving.../Saved states), enforced allowUserPasswordChange admin setting, bumped version to 0.1.5.
- Changed: Added Fail2ban intrusion detection, System Health Dashboard, live telemetry charts, account security endpoints, event drag-and-drop, mail search indexing worker, admin telemetry, settings shell.
- Verified: All backend tests, frontend lint, frontend build pass for each milestone.

## 2026-06-29 Phase 1 – Calendar/Contacts/Mail Quick Wins

- Changed: Calendar: fixed create vs edit dialog title, replaced window.alert() with in-app status banners for .ics import.
- Changed: Contacts: added photo_url persistence (send in handleSaveContact, add to ContactRow interface, patchVCardData PHOTO output, schema migration).
- Changed: Enriched parseVCard to extract ORG, TITLE, NOTE, ADR; vCard import saves to structured columns. CSV import now extracts job_title, organization, notes matching export.
- Verified: Backend/frontend builds and tests pass.

## 2026-06-29 Phase 2 – Calendar Resize, Recurrence, Draft, Office Preview

- Changed: Calendar event resize: bottom-edge drag handle in day/week view, live height preview, 15-min snap, saves via saveEventToBackend.
- Changed: Recurrence exceptions: "This occurrence"/"All events" prompts on edit/delete, RECURRENCE-ID in iCal output, EXDATE generation on single-occurrence delete, EXDATE parsing/filtering in expandRecurringEvent.
- Changed: Draft beforeunload: browser warning when leaving page with unsaved compose content.
- Changed: Office document preview: MIME types for .doc/.docx/.xlsx/.pptx/.odt/.ods/.rtf added to isPreviewableAttachment.
- Verified: Backend/frontend builds and tests pass.

## 2026-06-29 Phase 3 – CalDAV, Subscribed Calendars, Contact Groups, Indexing, Attachments

- Changed: CalDAV incremental sync: parse REPORT XML body for sync-collection vs calendar-query, sync-token comparison, empty 207 on match. Added calendar_tombstones table; track deletions in CalDAV and EAS paths.
- Changed: Subscribed calendars: new calendar-subscription.ts worker (15min interval), fetches .ics, parses VEVENT, upserts events. Added last_fetched_at/last_fetch_error tracking.
- Changed: Contact groups: added contact_groups + contact_group_members tables. Full CRUD API (GET/POST/PUT/DELETE groups, GET/POST members, DELETE member). Frontend: Groups sidebar section with color dots, member counts, inline create/edit/delete, click-to-filter.
- Changed: Background indexing daemon: added mailbox_credentials table for AES-256-GCM encrypted offline credentials. Upsert on every login. search-worker UNIONs sessions + mailbox_credentials for persistent coverage.
- Changed: Attachment content extraction: added pdf-parse for PDF text extraction. XML tag stripping for DOCX/XLSX/ODT/RTF. Async extraction in indexing loop. 100KB cap per attachment.
- Verified: Backend/frontend builds and tests pass (23/25, 2 pre-existing failures).

## 2026-06-29 Priority Hardening – Security, iCal, Admin, ActiveSync

- Changed: Dovecot master-user auth: optional OMS_IMAP_MASTER_USER/_PASS (and SMTP/Sieve equivalents) env vars. ImapService formats {user}*{master}. ManageSieveClient accepts master params for SASL PLAIN.
- Changed: Calendar iCal properties: generate VALARM (TRIGGER:-PT{n}M), ATTENDEE (mailto URIs), TRANSP (busy→OPAQUE, free→TRANSPARENT), TZID param on DTSTART/DTEND. Parse all in parseIcalEvent.
- Changed: Admin API key: replaced window.prompt() with navigator.clipboard.writeText() + in-app adminActionStatus banner.
- Changed: ActiveSync hardening: fixed shouldSendEvents bug (removed !calendarChanged guard), added EAS calendar tombstone writes, outgoing Delete commands, recurrence RRULE↔EAS mapping, contact Picture↔photo_url sync, CompanyName/JobTitle mapping.
- Verified: Backend/frontend builds pass, tests 23/25. ROADMAP.md, settings_plan.md, risk_register.md, and change_log.md updated.

## 2026-07-10 ActiveSync Mail Read-Flag WBXML Fix

- Observed: iOS Mail stopped receiving new messages after July 4, 2026, while macOS Mail and the webmail app continued to receive mail. Live `openmailstack` logs showed authenticated ActiveSync `Sync` requests for `INBOX` fetching messages through IMAP, then failing while writing the WBXML response with `Error: Unknown tag Read for page 17`.
- Changed: Fixed the ActiveSync mail flag-change response in `webmail-backend/src/index.ts` so Email `Read` is encoded on code page `2` instead of AirSyncBase page `17`; rebuilt tracked `src/index.js` and source map.
- Changed: Added `webmail-backend/test/eas-wbxml.test.cjs` to exercise a Sync/Responses/Change/ApplicationData/Read response through `WbxmlWriter`.
- Deployed: Copied only `index.ts`, `index.js`, and `index.js.map` to `/opt/openmailstack-backend/src/`, restored backend ownership, and restarted `openmailstack.service`. Postfix, Dovecot, Nginx, databases, and mail storage were not modified.
- Verified: `rtk npm --prefix webmail-backend test` passed. Local and public `OPTIONS /Microsoft-Server-ActiveSync` returned `200` with ActiveSync 14.1 headers after restart. Deployed `/opt/openmailstack-backend/src/index.js` matches the tested build and contains `Read` page `2`. No `Unknown tag Read for page 17` entries appeared after the restart window.
- Follow-up: Ask the user to open iOS Mail or toggle the account to force a fresh ActiveSync `Sync`; if it still does not retrieve mail, collect the next post-fix Sync log segment and inspect client sync-key recovery behavior.

## 2026-07-10 Admin Health ActiveSync Monitoring And Remediation

- Changed: Extended the modern Admin System Health dashboard to show `openmailstack` and `nginx` service health, ActiveSync/Exchange readiness, recent ActiveSync server-error count, and a guarded `Restart Backend` recovery action.
- Changed: Extended `webmail-backend/src/api.ts` system health with backend/proxy service checks, ActiveSync `OPTIONS` protocol probing, Prometheus gauges for backend/Nginx/ActiveSync readiness, and an admin-only `/api/admin/telemetry/remediate` endpoint with sanitized audit-log writes.
- Changed: Added `functions/openmailstack-remediate.sh` plus `functions/10_webmail.sh` installer provisioning for an exact sudoers bridge: `openmailstack` may only run `/usr/local/sbin/openmailstack-remediate restart-openmailstack`.
- Deployed: Installed the live remediation bridge and sudoers file, deployed tested backend API files to `/opt/openmailstack-backend/src/`, deployed the rebuilt frontend to `/var/www/openmailstack`, restored backend ownership, and restarted only `openmailstack.service`.
- Verified: `rtk npm --prefix webmail-backend test` passed, `rtk npm --prefix webmail-frontend run build` passed with the existing Vite chunk-size advisory, `rtk visudo -cf /etc/sudoers.d/openmailstack-remediate` parsed OK, all core services reported active, local and public ActiveSync `OPTIONS` returned `200`, unauthenticated Admin health returned `401`, deployed backend/frontend files match the tested build, and no targeted ActiveSync server-error entries appeared after restart.
- Follow-up: Add an authenticated ActiveSync mail Sync smoke that exercises real mailbox delta responses; the dashboard now catches endpoint readiness and recent server errors, but it does not perform an authenticated mailbox Sync by itself.

## 2026-07-10 Authenticated ActiveSync Mail Sync Smoke

- Changed: Added `tests/integration/activesync_mail_smoke.sh`, an optional authenticated smoke that sends a unique message to the test mailbox, discovers INBOX through ActiveSync `FolderSync`, verifies mail `Sync` returns the seeded message with body/read metadata, sends ActiveSync `Change` commands for read/unread, verifies IMAP `\Seen` state after each change, and deletes the seeded message from INBOX.
- Verified: The unauthenticated path skips cleanly when smoke credentials are not set. Authenticated runs passed against `http://127.0.0.1:20000` and `https://mail.housevo.us`. `rtk npm --prefix webmail-backend test` passed. Targeted `openmailstack` logs had no `Unknown tag`, `Error handling ActiveSync`, `ReferenceError`, `TypeError`, or `SyntaxError` entries after the smoke runs.
- Memory updates: Added the new smoke command to `.shared_memory/commands.md`, the validation inventory to `.shared_memory/implementation_state.md`, and the updated smoke coverage note to `.shared_memory/risk_register.md`.
- Follow-up: Run and record the full release/client validation matrix, especially physical iPhone Exchange mail/calendar/contacts behavior after the July 10 ActiveSync mail fix.

## 2026-07-10 Scripted Release Validation And ActiveSync Calendar No-Echo Fix

- Changed: Added `activesync_mail_smoke.sh` to `tests/integration/run.sh` guard checks so the new authenticated smoke stays visible in local integration validation.
- Changed: Added `webmail-backend/src/eas-sync.ts` with `shouldSendActiveSyncServerChanges()` and switched the calendar Sync branch to avoid sending server `Commands` in command-only ActiveSync acknowledgements.
- Changed: Added `webmail-backend/test/eas-sync.test.cjs` for command-only, explicit `GetChanges`, and current-key Sync decisions.
- Deployed: Rebuilt backend artifacts, copied the minimal updated backend files to `/opt/openmailstack-backend/src/`, restored ownership, and restarted only `openmailstack.service`.
- Verified: Backend tests passed 8/8. Local lint/integration gates passed except frontend lint, which fails on the existing backlog. Frontend build passed with the existing chunk-size advisory and a main chunk above the 500 kB target. Live `staging_smoke.sh`, ActiveSync OPTIONS, autodiscover, CalDAV/CardDAV preflights, DNS/TLS checks, and all authenticated public smokes passed.
- Memory updates: Updated `docs/webmail-release-validation.md`, `.shared_memory/implementation_state.md`, `.shared_memory/risk_register.md`, and the engineering worklog with the 2026-07-10 scripted validation state.
- Follow-up: Operations hardening for `functions/10_webmail.sh` idempotency, Nginx route injection, rollback notes, and clean-VM validation readiness.

## 2026-07-10 Operations Hardening, Admin RBAC, And Protocol Health

- Changed: `functions/10_webmail.sh` now loads `config.conf` through `REPO_DIR`, generates a candidate Nginx config before replacing the live file, refuses missing insertion points, and restores the previous site config if `nginx -t` fails.
- Changed: `tests/integration/run.sh` now guards the modern webmail module for path-aware config loading, Nginx insertion failure handling, and restore-on-invalid-config.
- Changed: The modern Node Admin API now treats only active `admin.superadmin=1` accounts as modern admins. `webmail-backend/src/auth.ts` derives session admin state from the live admin row and rechecks superadmin status on each Admin API request.
- Changed: Admin system health now probes ActiveSync, IMAP, SMTP submission, CalDAV, and CardDAV readiness and exposes Prometheus readiness/latency gauges for those client paths. The React System Health dashboard renders all protocol rows and keeps refresh/restart controls visible.
- Deployed: Updated backend auth/API files and frontend assets on the live host; restarted only `openmailstack.service`.
- Verified: Bash syntax, integration guard, backend tests 9/9, frontend build, local test mailbox login with `isAdmin:false`, admin route `403` for the non-superadmin test mailbox, protected health endpoint `401` without auth, live frontend bundle served, and clean post-restart backend log scan.
- Follow-up: Smoke the modern Admin dashboard with a real superadmin session/password, then complete physical iPhone Exchange mail/calendar/contacts validation.

## 2026-07-10 Superadmin Controls And SMTP Health Timeout

- Changed: Admin promotion now supports a `Grant superadmin access` option, existing admin rows expose `Make Super` / `Remove Super`, and the Node API has explicit superadmin grant/removal routes with guards against self-removal and last-superadmin removal.
- Changed: Regular admin demotion now refuses accounts that still have `superadmin=1`; remove the superadmin role first so the action is deliberate.
- Changed: Admin SMTP submission health now waits 8s for the greeting, and the dashboard refreshes protocol health every 15s. Live Postfix was returning a valid `220 mail.housevo.us ESMTP Postfix (Debian/GNU)` greeting after roughly 5s, so the previous 4s probe produced a false degraded state.
- Deployed: Synced backend API/auth artifacts, deployed the rebuilt frontend, restored backend ownership, and restarted only `openmailstack.service`.
- Verified: Backend tests 9/9 passed, frontend build passed with the existing chunk-size advisory, integration and bash syntax checks passed, core services stayed active, public webmail served the new bundle, live SMTP submission returned a `220` greeting within the new timeout, and the non-superadmin test mailbox remained blocked from superadmin mutations.
- Known gap: Superadmin UI still needs a browser smoke with a real superadmin session, and physical iPhone Exchange mail/calendar/contacts validation is still pending.
- Follow-up: Run the real iPhone Exchange validation while watching ActiveSync logs, then record the client row in `docs/webmail-release-validation.md`.

## 2026-07-10 Superadmin Live Smoke

- Verified: After the local test mailbox was promoted, backend login returned `isAdmin:true`; `/api/auth/me`, `/api/admin/telemetry/system-health`, `/api/admin/admins`, and `/api/admin/domains` were accessible with the superadmin session.
- Verified: Admin System Health reported ActiveSync, IMAP, SMTP submission, CalDAV, and CardDAV all healthy. SMTP submission returned the expected Postfix `220` greeting inside the new 8s timeout.
- Verified: Browser smoke against `https://mail.housevo.us/admin` showed the Admin dashboard, Admins table, `Remove Super` actions, and the `Grant superadmin access` checkbox in the Promote Admin modal with no new Admin-flow console errors.
- Verified: The self-demotion guard rejected removal of the current session's own superadmin role and a follow-up admin list confirmed the account remained `superadmin=1`.
- Follow-up: Start the physical iPhone Exchange validation and record the Mail, Calendar, and Contacts result in `docs/webmail-release-validation.md`.

## 2026-07-11 iPhone ActiveSync SendMail MIME Extraction Fix

- Observed: Physical iPhone Exchange receive passed for `thang@housevo.us`, but sending from the iPhone returned "Cannot Send Mail - The message was rejected by the server." Live logs showed ActiveSync `SendMail` reached the backend and failed before SMTP delivery because the backend selected a UUID-like decoded `Mime` value instead of the raw RFC822 payload.
- Changed: Added `webmail-backend/src/eas-send.ts` helpers to detect MIME-like payloads, extract the correct SendMail raw MIME from any payload-bearing decoded node, derive the SMTP envelope from parsed recipients, and summarize send-command logs without message content.
- Changed: `webmail-backend/src/index.ts` now uses the SendMail MIME extractor and sanitized log summary for `SendMail`, `SmartForward`, and `SmartReply`.
- Changed: `webmail-backend/test/eas-send.test.cjs` covers envelope extraction, missing recipients, normal `Mime` payloads, the observed iOS fallback shape, missing MIME, and privacy-safe log summaries.
- Deployed: Synced rebuilt backend artifacts for `eas-send` and `index` to `/opt/openmailstack-backend/src`, restored ownership, and restarted only `openmailstack.service`.
- Verified: `rtk npm --prefix webmail-backend test` passed 10/10. ActiveSync `OPTIONS` returned 200 after restart. Synthetic normal and iOS-shaped ActiveSync `SendMail` POSTs returned 200, sent through SMTP, and saved Sent copies. Recent send-command logs show only tag names and content byte counts, not message bodies.
- Verified: Physical iPhone retry from `thang@housevo.us` to Gmail passed at 04:33 Baghdad time. Backend logs show `SendMail` at 18:33:45 Phoenix time, SMTP send success and Sent append at 18:33:51, and Postfix delivery to Gmail at 18:33:53.
- Verified: Physical iPhone picture attachment send passed at 04:41 Baghdad time. OpenMailStack sent outbound queue `78E7F1FD6` only to Gmail with one recipient, and Gmail later submitted separate inbound queue `91C521FD6` back to `thang@housevo.us`; the Inbox copy was not a local duplicate of the SendMail path.
- Verified: Physical iPhone calendar create passed. `OMS iPhone Calendar Test` was created for 2026-07-11 18:00 Baghdad time, appeared in iOS, macOS Calendar, and the web calendar, and was stored on `cal-1` with `DTSTART:20260711T150000Z`.
- Changed: Fixed CalDAV event ETags after iPhone calendar edit reached the server/web calendar but macOS Calendar stayed stale. `webmail-backend/src/dav-etag.ts` now emits content-derived event ETags, and `webmail-backend/src/caldav.ts` uses them for `PROPFIND`, `REPORT`, `GET`, and `PUT` responses.
- Verified: Backend tests passed 11/11, the live backend was restarted, core services stayed active, CalDAV `OPTIONS` returned 200, and the deployed ETag helper returns different ETags for the original and edited event content.
- Verified: Physical iPhone calendar edit retry passed. After the ETag fix, the user edited the event again on iPhone to 18:45 Baghdad time; macOS Calendar updated after Command-R, and live storage shows `DTSTART:20260711T154500Z`.
- Changed: ActiveSync and CalDAV calendar writes now emit `calendar_updated` Socket.IO notifications, the web calendar subscribes and refreshes with a short debounce, Socket.IO room joins are authenticated against the web session cookie, and the webmail Nginx installer snippet includes `/socket.io/` proxying so clean installs preserve realtime updates.
- Deployed: Synced rebuilt backend artifacts to `/opt/openmailstack-backend/src`, restarted only `openmailstack.service`, and deployed the rebuilt frontend bundle to `/var/www/openmailstack`.
- Verified: `rtk npm --prefix webmail-backend test` passed 11/11; `rtk npm --prefix webmail-frontend run build` passed with the existing chunk-size advisory; `rtk nginx -t` and `rtk bash -n functions/10_webmail.sh` passed; `https://mail.housevo.us/socket.io/?EIO=4&transport=polling` returned 200; a localtest CalDAV PUT emitted `calendar_updated` to an authenticated session socket; an unauthenticated socket did not receive the event; temporary smoke events were deleted afterward.
- Observed: Physical iPhone calendar delete removed `OMS iPhone Calendar Test Edited` from iOS and the web calendar, but macOS Calendar kept showing the event. Live storage showed UID `F8F01D2981384B189CB457103D993862` absent from `events` and present in `calendar_tombstones` for calendar `1` at sync token `1363`.
- Changed: Added `webmail-backend/src/dav-report.ts` so CalDAV REPORT parsing detects prefixed or unprefixed `sync-collection` and `sync-token` elements. `webmail-backend/src/caldav.ts` now uses that parser for incremental sync detection instead of matching only unprefixed `<sync-collection>` and hardcoded `<D:sync-token>`.
- Deployed: Synced the rebuilt backend source and generated artifacts to `/opt/openmailstack-backend/src`, restored ownership, restarted only `openmailstack.service`, and removed temporary localtest tombstones created by the smoke.
- Verified: `rtk npm --prefix webmail-backend test` passed 12/12. A live localtest Apple-style namespace-prefixed CalDAV REPORT returned a 207 Multi-Status with the deleted event href and `HTTP/1.1 404 Not Found`, proving tombstones are emitted for the prefixed REPORT shape. Core services stayed active and CalDAV `OPTIONS` returned 200.
- Note: If macOS Calendar already stored token `1363` during the broken response window, Command-R may still not remove the event until the affected calendar sync token is bumped once. Do not bump live sync state without explicit user approval.
- Verified: The user retried macOS Calendar after the parser fix and the event remained visible. With explicit user approval, a guarded transaction updated only calendar `1` / `thang@housevo.us` / `Personal` from `sync_token=1363` to `1364`; `ROW_COUNT()` returned `1`.
- Verified: The user refreshed macOS Calendar after the one-time token bump and confirmed the stale `OMS iPhone Calendar Test Edited` event disappeared. Action 6 calendar delete is now passed across iOS, web, server storage/tombstone, and macOS Calendar.
- Note: Admin health may show recent ActiveSync errors until the rolling error window ages out from the pre-fix physical attempts. SMTP submission remains reachable but can take about 5s to greet.
- Verified: Physical iPhone contact create passed. The user created `OMS iPhone Contact Test` on iPhone; it appeared in the OpenMailStack web Contacts app and macOS Contacts, and live storage has the expected active contact row for `thang@housevo.us`.
- Changed: Fixed Contacts long-list and duplicate-management UX found during Action 7. `/api/apps/contacts` now returns `total` and accepts allowlisted `sortBy`; the web Contacts app tracks server total vs loaded contacts, shows total count in the sidebar, exposes first-name/last-name/email sorting and name format controls, has select/deselect all for loaded contacts, normalizes the duplicate endpoint response, and displays duplicate scan/merge actions in the sidebar.
- Deployed: Synced rebuilt `apps-api` artifacts to `/opt/openmailstack-backend/src`, restarted only `openmailstack.service`, and deployed the rebuilt frontend bundle with `functions/deploy_webmail_frontend.sh`.
- Verified: `rtk npm --prefix webmail-backend test` passed 12/12, `rtk npm --prefix webmail-frontend run build` passed with the existing chunk-size advisory, touched-file `git diff --check` passed, deployed `apps-api.js` matches the tested build, deployed `index.html` matches `webmail-frontend/dist/index.html`, the Contacts route returns 200, and core services stayed active. The saved localtest credential no longer authenticated, so an authenticated curl smoke for the new Contacts API shape was skipped.
- Follow-up: Continue iPhone Exchange contacts edit/delete validation. Optionally check Gmail forwarding/filter behavior or repeat external mail validation with a non-forwarding mailbox.

Future entry template:

```markdown
## YYYY-MM-DD

- Changed:
- Verified:
- Memory updates:
- Follow-up:
```

## 2026-07-10 OMS Scheduler Product And Engineering Roadmap

- Changed: Added `scheduler_plan.md`, a current official-source review of Calendly and Cal.com plus a complete OMS Scheduler capability contract, native suite integration architecture, data and API boundaries, quality gates, owner decisions, and ten-phase delivery roadmap.
- Changed: Added the planned OMS Scheduler program to the canonical `ROADMAP.md`, including the required `Scheduler` navigation position after `Notes`.
- Verified: Cross-checked the plan against current `AppShell` navigation, React routes, Node/Express/MariaDB backend, OMS auth, native calendar store, CalDAV/ActiveSync projection paths, SMTP, branding, admin audit, and deployment documentation. No application or production changes were made.
- Follow-up: Confirm the recommended product decisions in `scheduler_plan.md` section 8, then implement the bounded Phase 0 availability and concurrent slot-hold foundation.

## 2026-07-10 OMS Scheduler Installation, Entitlement, And Public URL Decisions

- Confirmed: The installer must ask whether to install OMS Scheduler and persist the choice so reruns and upgrades are deterministic.
- Confirmed: Installing Scheduler does not enable or publish users. Only authorized admins can enable or disable Scheduler per mailbox, and those actions are audited.
- Confirmed: An enabled `user@example.com` mailbox publishes at `/scheduler/user`; direct event links use `/scheduler/user/<event-slug>`.
- Planned safeguard: Because local parts can collide across domains or with static application routes, handles are globally unique per installation and admins must assign an alternate before enabling a conflicting mailbox.
- Follow-up: Implement the Phase 0 availability/slot-hold foundation, then the installer/configuration and entitlement schema slice before public booking UI.

## 2026-07-10 OMS Scheduler Public Host Alias Clarification

- Confirmed: `/scheduler/<local-part>` is independent of the hostname. For `thang@housevo.us`, both `https://webmail.housevo.us/scheduler/thang` and `https://mail.housevo.us/scheduler/thang` must work when those names are configured OMS aliases.
- Planned: Admins choose one preferred Scheduler public base URL for links generated in email, embeds, and metadata; every allowlisted webmail alias serves the same route.
- Security: Absolute URLs must come from configuration rather than an arbitrary request `Host` header, and installer/Admin validation must check DNS, Nginx `server_name`, and TLS coverage for advertised aliases.

## 2026-07-11 iPhone Contacts Action 8 Search And CardDAV Sync Follow-up

- Observed: The iPhone edit of `OMS iPhone Contact Test` reached live storage and the web Contacts app, but web Contacts search for `OMS` only worked after all contacts were loaded, and macOS Contacts did not show the edit even after refresh/reopen.
- Changed: `/api/apps/contacts` now accepts a parameterized `q` filter and applies it to both total count and paginated results across visible columns, structured contact fields, JSON fields, and stored vCard data. The Contacts frontend now sends a debounced backend search query and reports server matching totals instead of searching only loaded contacts.
- Changed: CardDAV REPORT handling now detects namespace-prefixed `sync-collection` bodies and compares the client sync token with the current address-book token, returning no resources for a current token and contact resources for stale/missing tokens.
- Changed: Future server-side contact writes stamp vCard `REV`, persist parsed organization/title/notes/structured-name fields, and preserve inbound ActiveSync `JobTitle`.
- Verified: Backend tests passed 13/13; frontend build passed with the existing chunk-size advisory; full frontend lint remains red from the known broad backlog. The live backend and frontend were deployed, ownership was restored after a transient `600` permission issue, `openmailstack.service` recovered, and `https://mail.housevo.us/contacts` returns 200.
- Follow-up: Superseded by the later multi-phone and contact tombstone entries. Contact edit passed after the company-change retry; physical contact delete validation remains pending.

## 2026-07-11 iPhone Contacts Multi-Phone Mapping And Realtime Refresh

- Observed: The iPhone retry added `602-555-1212` as a second phone number. Live ActiveSync logs showed iOS sent both `BusinessPhoneNumber=(602) 555-1212` and `HomePhoneNumber=(602) 987-6543`, but the backend stored only one `TEL` value because the old ActiveSync converter selected the first non-empty phone field.
- Changed: Added `webmail-backend/src/eas-contacts.ts` and tests so inbound ActiveSync contact add/change preserves multiple email/phone fields as multiple vCard lines, and outbound ActiveSync contact sync maps stored `phones_json` back to distinct phone fields.
- Changed: ActiveSync, CardDAV, and web-app contact mutations now emit `contacts_updated`. The Contacts frontend subscribes to that event, refreshes with a debounce, and updates the selected contact detail object after list refresh.
- Deployed: Synced rebuilt backend artifacts including `eas-contacts`, restored backend ownership, restarted only `openmailstack.service`, and deployed the rebuilt frontend bundle.
- Verified: `rtk node --test webmail-backend/test/eas-contacts.test.cjs` passed 2/2, `rtk npm --prefix webmail-backend test` passed 14/14, frontend build passed with the existing chunk-size advisory, deployed files match the tested build, `openmailstack.service` is active, and `/contacts` returns 200.
- Follow-up: The existing live test row still has only `(602) 555-1212` because it was written before this fix. Ask the user to re-save or slightly edit the iPhone contact with both phone numbers present, then verify web Contacts and macOS Contacts show both.
- Verified: The user then changed the iPhone contact company to `OpenMailStack Test 2`; web Contacts and macOS Contacts both reflected the change. Live storage has `organization=OpenMailStack Test 2`, `sync_token=5`, both phone numbers in `phones_json`, and vCard `TEL;TYPE=WORK:(602) 555-1212` plus `TEL;TYPE=HOME:(602) 987-6543`.
- Follow-up: Contact edit is passed; run iPhone Exchange contact delete validation next.

## 2026-07-11 CardDAV And ActiveSync Contact Tombstones

- Changed: Added `contact_tombstones`, monotonic per-user contact sync-token allocation, updated-contact delta listing, tombstone delta listing, and token parsing for CardDAV/ActiveSync contact tokens.
- Changed: Contact deletes now soft-delete active rows and record tombstones. Restores clear tombstones. Web Contacts delete/bulk-delete/permanent-delete/import/merge paths now keep DAV-visible changes on the shared contact sync-token contract.
- Changed: CardDAV stale-token `sync-collection` REPORTs return changed contacts plus `HTTP/1.1 404 Not Found` responses for deleted contact hrefs.
- Changed: ActiveSync Contacts delta Sync sends changed contacts as `Change` and deleted contacts as `Delete`.
- Changed: `carddav_sync_smoke.sh` now asserts post-delete CardDAV tombstones, and `activesync_contacts_smoke.sh` now asserts post-delete ActiveSync Delete commands.
- Deployed: Synced rebuilt backend artifacts to `/opt/openmailstack-backend/src`, fixed deployed artifact ownership after an initial restrictive-mode restart failure, and restarted only `openmailstack.service`.
- Verified: `rtk npm --prefix webmail-backend test` passed 14/14. Local and public CardDAV/ActiveSync contact smokes passed with delete-delta assertions. `contact_tombstones` exists and contains localtest smoke tombstones. `openmailstack.service` is active and deployed JS matches the tested build.
- Follow-up: Run physical iPhone Exchange contact delete validation for `OMS iPhone Contact Test`.

## 2026-07-11 CardDAV Depth-1 Contact Tombstones For macOS Contacts

- Observed: Physical iPhone contact delete removed `OMS iPhone Contact Test` from iPhone and the web Contacts app. Live storage for `thang@housevo.us` shows `dav_uid=eas-13623` soft-deleted with a matching `contact_tombstones` row at sync token `6`, but macOS Contacts still displayed the deleted contact.
- Observed: Recent macOS CardDAV traffic showed repeated depth-1 `PROPFIND` collection listings and active-card `GET` requests, with no sampled `sync-collection` REPORT that would consume the existing tombstone path.
- Changed: CardDAV depth-1 address-book `PROPFIND` now includes recent contact tombstones as `HTTP/1.1 404 Not Found` responses, matching the existing stale `sync-collection` tombstone behavior.
- Changed: `carddav_sync_smoke.sh` now asserts both stale REPORT and depth-1 PROPFIND tombstones after DELETE.
- Deployed: Synced rebuilt `carddav` and `contact-utils` artifacts to `/opt/openmailstack-backend/src`, restored backend ownership, and restarted only `openmailstack.service`.
- Verified: `rtk npm --prefix webmail-backend test` passed 14/14. Local and public CardDAV smokes passed with both delete assertions. Local and public ActiveSync contacts smokes still passed. `openmailstack.service` is active and deployed `carddav.js`/`contact-utils.js` match the tested build.
- Follow-up: Ask the user to refresh/reopen macOS Contacts and search for `OMS iPhone Contact Test`. If it remains, inspect fresh CardDAV logs before requesting explicit approval for any one-time contact sync-token/data remediation.

## 2026-07-11 CardDAV Legacy Href Tombstone Alias For macOS Contacts

- Observed: After the depth-1 PROPFIND tombstone fix, macOS Contacts still showed the deleted `OMS iPhone Contact Test` and also showed duplicates for some contacts, while the web Contacts app and iOS Contacts did not.
- Verified: Focused live storage checks still show `eas-13623` only as a soft-deleted contact row plus tombstone at sync token `6`; there are 485 active contacts with 485 distinct DAV UIDs for `thang@housevo.us`, so the macOS-only duplicates are not mirrored as duplicate active DAV UID rows.
- Changed: CardDAV tombstone responses now expand each tombstone to both its current DAV UID and the legacy `contact-<id>` href alias when the deleted row can be resolved. This covers macOS caches that may have learned an older href before the ActiveSync/CardDAV UID settled.
- Changed: CardDAV `addressbook-multiget`/requested-href REPORTs now return 404 tombstones when the requested href matches a recent deleted contact tombstone or alias.
- Fixed: The first alias lookup used a cross-table string comparison and hit a live MariaDB collation mismatch. The lookup now scopes by the current user parameter and explicitly collates the DAV UID comparison.
- Deployed: Synced rebuilt `carddav` and `contact-utils` artifacts to `/opt/openmailstack-backend/src`, restored backend ownership, and restarted only `openmailstack.service`.
- Verified: `rtk npm --prefix webmail-backend test` passed 14/14. Local and public CardDAV smokes passed. Local and public ActiveSync contacts smokes passed. Deployed JS matches the tested build, `openmailstack.service` is active, and post-fix log scan after the corrected restart showed no collation/CardDAV/ActiveSync contact errors.
- Follow-up: Ask the user to show the macOS Contacts Groups/sidebar, select only the OpenMailStack/CardDAV address book instead of All Contacts, refresh/reopen, and report whether the stale test contact and duplicates still appear inside that one account.

## 2026-07-11 macOS Contacts Account Re-add Cleared Stale Cache

- Verified: The user removed the macOS CardDAV/Contacts account, closed Contacts, reopened it, and re-added the account. The stale deleted `OMS iPhone Contact Test` and macOS-only duplicate display cleared.
- Conclusion: The iPhone/web/server delete path is validated. The remaining macOS issue was stale local account cache state after earlier protocol fixes, not a duplicate active server contact row.
- Follow-up: Continue the remaining real-client matrix for standalone macOS IMAP/CalDAV/CardDAV, Android plus DAVx5, and Thunderbird with exact client versions recorded.

## 2026-07-11 Repository Stabilization, Frontend Lint Gate, And Docs Cleanup

- Changed: Normalized ownership of tracked `live_migration_backups/` files so Git can hash the tree again; file contents were unchanged.
- Changed: Moved the planned OMS Scheduler contract from root `scheduler_plan.md` to `docs/product/scheduler.md`, updated current docs/memory references, and ignored generated `graphify-out/` plus future live migration backup output.
- Changed: Replaced the stale root `README.md` with a current project entry point covering the modern React/Node suite, live validation status, repository map, current docs, install flow, access URLs, and development checks.
- Changed: Frontend lint now exits 0. The lint policy keeps correctness issues as errors, allows underscore-prefixed intentionally unused variables, allows empty catch blocks, treats broad `any` typing as a staged warning, and treats React compiler-style mount-fetch warnings as a staged warning.
- Fixed: Removed a render-time ref write in `LiveNoteEditor`, avoided mutating note props in `NotesGrid`, and corrected `CalendarInviteCard` memo dependencies.
- Verified: `rtk bash ./tests/lint/run.sh`, `rtk bash ./tests/integration/run.sh`, `rtk npm --prefix webmail-backend test`, `rtk npm --prefix webmail-backend run build`, `rtk npm --prefix webmail-frontend run lint`, `rtk npm --prefix webmail-frontend run build`, and `rtk git diff --check` passed. Frontend lint still reports 145 warnings, and frontend build still reports the expected chunk-size advisory.
- Follow-up: Reduce the remaining frontend warning debt by typing shared API/admin/settings responses, then split the largest frontend chunks.

## 2026-07-11 Frontend Warning Reduction And Route Code Splitting

- Changed: Added shared JSON/contact/calendar/settings response types and applied them through shared API helpers, admin mailbox/alias/settings flows, and settings namespace saves.
- Changed: Lazy-loaded the Mail, Calendar, Contacts, and Settings routes from `webmail-frontend/src/App.tsx`, keeping the authenticated shell smaller and preserving the existing skeleton fallback.
- Verified: `rtk npm --prefix webmail-frontend run lint` passed with 112 warnings, down from 145. `rtk npm --prefix webmail-frontend run build` passed with no Vite chunk-size advisory; the main chunk is `223.98 kB` and the largest route chunk is `481.12 kB`.
- Follow-up: Continue warning cleanup in the mail feature modules, starting with `src/mail/hooks/useMail.ts` and `src/mail/ComposeModal.tsx`, then handle React hook warning classes in focused passes.

## 2026-07-11 Frontend Lint Backlog Cleared

- Changed: Removed the remaining frontend lint warnings across Mail, Admin, Calendar, Contacts, Notes, Settings, App, and shared hooks without loosening the lint policy.
- Changed: Replaced broad `any` casts with local response/editor/domain types, deferred mount-time state-setting loaders where React hooks lint required it, and documented the two intentional TanStack virtualizer compatibility exceptions inline.
- Verified: `rtk npm --prefix webmail-frontend run lint` exits 0 with zero warnings. `rtk npm --prefix webmail-frontend run build` passes with no Vite chunk-size advisory; the main chunk is `224.12 kB` and the largest route chunk is `481.41 kB`.
- Follow-up: Frontend lint and bundle-size stabilization are no longer blockers before Scheduler. Remaining pre-Scheduler risk is the clean-VM installer validation and any additional real-client matrix rows the user wants to run before feature work.

## 2026-07-11 OMS Scheduler Phase 0 Availability And Slot Holds

- Changed: Added `webmail-backend/src/scheduler/availability.ts`, a pure host-timezone availability engine covering weekly windows, date overrides, busy intervals, buffers, minimum notice, DST gaps/overlaps, and local-midnight boundaries.
- Changed: Added `webmail-backend/src/scheduler/slot-holds.ts`, a tenant-scoped MariaDB repository using an inventory-row `FOR UPDATE` lock, capacity counters, expiring holds, idempotency keys, and transaction commit/rollback.
- Changed: Added the unapplied versioned migration `webmail-backend/migrations/001_scheduler_phase0.sql` plus migration conventions. No live schema, routes, installer, service, or production data changed.
- Verified: Baseline backend 14/14, frontend lint, frontend production build, and static integration checks passed before edits. After edits, backend 16/16 test files pass and focused Scheduler assertions pass.
- Verified: The migration applies to disposable MariaDB 11. A real two-connection capacity-one race exposed an initial insert deadlock; bounded transaction retry was added, and the rerun produced exactly one hold plus one `SlotUnavailableError` without touching production.
- Follow-up: Complete the Phase 0 threat/contracts work, then implement installer flag and admin mailbox entitlements before any public booking routes.

## 2026-07-11 OMS Scheduler Phase 0 Completion

- Changed: Added booking/provider and calendar-projection contracts, reliable outbox/audit contracts, and explicit tenant-aware authorization for public, owner, scoped-admin, superadmin, and capability-token actions.
- Changed: Added the Phase 0 Scheduler threat model and a machine-readable 43-capability parity register across 10 product categories. The integration suite now rejects incomplete capability metadata, non-official sources, missing implemented tests, or missing security/roadmap references.
- Verified: Backend compilation and all 18 test files pass, including DST gap/overlap, host/booker timezone projection, booking transitions, authorization isolation, transaction retry, and slot capacity behavior. Static integration checks pass with the Scheduler documentation guard.
- Confirmed: Phase 0 is complete but unmounted and not deployed. No public route, installer flag, Admin entitlement UI, worker, frontend, or production schema change was introduced.
- Follow-up: Begin Phase 1 with persisted installer state and administrator-controlled per-mailbox entitlements before exposing navigation or public booking routes.

## 2026-07-11 OMS Scheduler Phase 1 MVP Implementation

- Changed: Added opt-in installer persistence, Scheduler component detection, ordered schema installation, disabled-install omission, backend environment rendering, explicit SPA routing, configured Nginx aliases, and multi-host TLS certificate coverage.
- Changed: Added Admin-only mailbox entitlements with globally unique normalized handles, audit events, immediate unpublishing on disable, entitlement-aware navigation, and a configurable Admin mailbox control.
- Changed: Added personal event/profile/availability CRUD, recurring native-calendar conflict checks, timezone-aware public slots, transactional booking/capacity confirmation, stable Calendar UID projection, expiring hashed cancel/reschedule tokens, and retrying outbox email/ICS delivery.
- Changed: Added lazy-loaded Scheduler management after Notes, mobile five-app-plus-More navigation, booking list/detail filters, and responsive public profile, event, booking, confirmation, cancellation, and rescheduling views.
- Verified: Backend 20/20, frontend lint and production build, full static integration suite, and memory hygiene pass. A disposable MariaDB 11 lifecycle enabled a mailbox, published a 30-minute event, booked it, projected one calendar event, rescheduled the same UID, cancelled it, wrote a tombstone, and released capacity.
- Verified: Playwright inspected the public booking flow at 1440x900 and 390x844 plus management at desktop/mobile sizes; primary actions remained reachable and no horizontal overflow was detected.
- Not deployed: No production database, Nginx configuration, service, mailbox entitlement, or mail/calendar data was modified. Clean-VM disabled/enabled installer execution, SMTP delivery, certificate renewal, and physical CalDAV/ActiveSync propagation remain release gates.

## 2026-07-11 OMS Scheduler Phase 1 Live Deployment

- Backed up: Created `/var/backups/openmailstack/20260711_141833` containing all databases, live mail-stack configuration, repository config, deployed backend, deployed frontend, and backend environment; restricted snapshot contents to root.
- Deployed: Enabled Scheduler with preferred base `https://webmail.housevo.us` and aliases `mail.housevo.us,webmail.housevo.us`, applied migrations `001` and `002`, deployed the tested backend/frontend, restarted `openmailstack.service`, and added the explicit Scheduler SPA route without changing existing mail/DAV/Admin routes.
- Fixed: Escaped Nginx `$request_method` in the deployment heredoc and added an upgrade-safe path that preserves older unmarked modern-webmail vhosts instead of injecting duplicate `/api`, socket, DAV, and root locations. Both failed Nginx candidates were rejected and the prior live file was automatically restored.
- Verified: Service is active/enabled, Nginx syntax passes, migrations are recorded, entitlement count is zero, deployed artifacts match the tested build, both public hostnames return the SPA and identical generic API 404s for unpublished `thang`, unauthenticated Admin returns 401, and the full staging smoke suite passes. Live Chromium loaded both mobile SPA routes without page errors or horizontal overflow.
- Installed: The deployment package refresh upgraded Debian `rsync` from `3.4.1+ds1-5+deb13u3` to `3.4.1+ds1-5+deb13u4`.
- Follow-up: Enable one dedicated mailbox through modern Admin, then exercise public booking, SMTP/ICS, reschedule, cancellation, Calendar, CalDAV, and ActiveSync before marking Phase 1 release-validated.

## 2026-07-11 Scheduler Entitlement Navigation And Release-Risk Fixes

- Fixed: Scheduler Admin changes emit an entitlement-change event; the authenticated shell refreshes immediately and also refreshes on focus/visibility for cross-tab changes.
- Fixed: Removed unused vulnerable `pdfjs-dist`, pinned `react-router` to Node-20-compatible `7.18.1`, pinned `react-quill-new` to `3.7.0`, and overrode Quill to non-vulnerable `2.0.2`. Frontend and backend audits now report zero vulnerabilities.
- Fixed: Confined backend environment `umask 077` to a subshell and set dependency installs to `umask 022`, preventing live deployments from leaving repository `node_modules` unreadable.
- Deployed: Rebuilt and redeployed the frontend/backend. `thang@housevo.us` remains enabled and published at `/scheduler/thang`; the public profile API returns 200 through both `webmail.housevo.us` and `mail.housevo.us`.
- Verified: Backend 20/20, frontend lint/build, integration suite, shell syntax, diff checks, zero-vulnerability audits, live service/Nginx health, artifact equality, and Playwright desktop/mobile navigation checks passed.
- Follow-up: Create the first event type and complete a real booking/reschedule/cancel cycle through SMTP/ICS, OMS Calendar, CalDAV, and ActiveSync.

## 2026-07-11 Scheduler First-Run And Booking-Link UX

- Changed: Added a persistent owner-facing booking-site bar with labeled open and copy actions plus success/error clipboard feedback.
- Changed: Replaced the empty Event Types screen with a three-step setup guide and added an actionable Availability empty state that opens the existing event editor.
- Changed: Added explicit calendar-conflict guidance, a warning when a published profile has no active event types, and a calm public empty state instead of a blank profile page.
- Changed: Added Scheduler Phase 1 guard assertions for the public-link actions and all first-run/empty-state affordances.
- Verified: Frontend lint and production build pass. The Phase 1 guard passes. Playwright at 1440x1000 and 390x844 found no console/page errors or horizontal overflow, and proved both Event Types and Availability open the event editor.
- Not deployed: No production service, frontend artifact, mailbox setting, event type, booking, or calendar data changed.
- Follow-up: Deploy the verified frontend when approved, then create the first event type and validate the real booking/SMTP/ICS/Calendar/DAV lifecycle.

## 2026-07-11 Scheduler Custom Duration And First-Run Deployment

- Changed: Replaced the fixed 15/30/45/60-minute event dropdown with Hours and Minutes inputs supporting every integer duration from 5 minutes through 24 hours without coupling duration to the slot interval.
- Changed: Added client-side invalid-duration protection, human-readable duration summaries, backend 180-minute/upper-bound assertions, Phase 1 UI guards, and the explicit duration contract in `docs/product/scheduler.md`.
- Verified: Backend 20/20, frontend lint/build, the full integration suite, and desktop/mobile Playwright checks passed. Playwright rejected a zero-length event and submitted Hair Coloring as `durationMinutes: 180` with `intervalMinutes: 30` and zero overflow/errors.
- Backed up: Copied the pre-deploy static webroot to `/tmp/openmailstack-webroot-before-scheduler-duration` for immediate rollback.
- Deployed: Rebuilt and deployed only the static frontend with `functions/deploy_webmail_frontend.sh`; no backend service, database, mailbox entitlement, calendar, or booking data changed.
- Live proof: Deployed `index.html` matches the tested build; both configured profile APIs return 200; live Chromium renders the new public empty state without errors; deployed owner/public chunks contain the custom-duration and onboarding contracts.
- Follow-up: Create the first intentionally configured event type, then validate booking/reschedule/cancel through SMTP/ICS, OMS Calendar, CalDAV, and ActiveSync.

## 2026-07-11 Scheduler Reusable Availability And Default Booking

- Changed: Added migration `003_scheduler_availability_schedules.sql` with reusable schedules, multiple daily windows, date overrides, override windows, event schedule inheritance, and hidden system-managed fallback event types.
- Changed: Added authenticated default-availability save/preview APIs and public fallback-event responses. Default availability can be edited without creating an event; publishing it activates a 30-minute root-profile booking flow until the owner creates a custom event type.
- Changed: Added Week/Month/Day availability views, split shifts, day toggles, date-specific custom hours, all-day and range blackouts, IANA timezone selection, calendar-aware slot diagnostics, and default-schedule publishing.
- Changed: Reorganized event editing into Setup, Availability, Limits, and Advanced. Events inherit default availability or use custom hours; duration, interval, buffers, notice, capacity, calendars, and active state are independently configurable.
- Fixed: Replaced undefined `--bg-primary` Scheduler tokens with the real opaque app surface tokens, so modal, sticky footer, details panel, and canvas no longer show distracting background text.
- Changed: Public booking offers the complete browser IANA timezone list and confirmations include a downloadable ICS fallback.
- Verified: Backend 20/20, frontend lint/build, Scheduler guard, full integration suite, and migration idempotence passed. A disposable MariaDB lifecycle covered the hidden default event, inherited schedules, a blocked date, booking, reschedule, and cancellation.
- Deployed: Safety snapshot `/var/backups/openmailstack/20260711_230435_scheduler_availability`; migration `003` and tested backend/frontend are live. Service, Nginx, four new tables, artifact equality, public profile API, visual desktop/mobile checks, and staging smoke pass.
- Follow-up: The owner should publish the desired live default schedule or create an intentional event type, then complete the SMTP/ICS/Calendar/CalDAV/ActiveSync booking lifecycle.

## 2026-07-11 Scheduler Enable-Booking Persistence Fix

- Fixed: The Availability empty-state `Enable booking` action previously changed only local form state and required a second, easy-to-miss Save click. It now publishes the current schedule immediately through the normal availability API.
- Diagnosed: The live owner schedule retained six saved windows but `published=0`; the system-managed 30-minute event consequently remained inactive and the public API correctly returned no default event.

## 2026-07-11 Scheduler First Live Booking Reliability Fixes

- Diagnosed: The owner completed a confirmed 30-minute booking. Capacity, hold, native calendar projection, and audit data were correct, but notification delivery retried with `ESOCKET` before reaching Postfix because the worker connected to `127.0.0.1` while verifying the certificate against the IP address.
- Fixed: Added `OMS_SCHEDULER_SMTP_SERVER_NAME` and strict TLS configuration; the local connection now verifies the `mail.housevo.us` certificate. Transport verification passes and the pending outbox job completed.
- Verified: Postfix recorded Gmail `250 2.0.0` acceptance for the guest and successful LMTP delivery to the host mailbox.
- Fixed: Public booking pages refresh slots on focus/visibility and after conflicts; the backend also filters full inventory capacity independently of calendar parsing.
- Fixed: Scheduler booking reads, cancellations, rescheduling inventory, idempotent responses, and hold release now cast MySQL `DATETIME` values to text and parse them explicitly as UTC, matching the proven slot-hold boundary.
- Verified: Backend 20/20, frontend lint/build, full integration suite, and disposable MariaDB lifecycle passed. The lifecycle deliberately malformed the projected calendar event and still hid confirmed capacity. Live Chromium confirmed the booked 8:00 AM time is absent and 8:30 AM is the first Discovery Call.

## 2026-07-12 Scheduler Owned Notification Sender

- Changed: Added migration `004_scheduler_notification_identity.sql` and a Scheduler Profile sender selector.
- Changed: New confirmations, cancellations, and reschedules default to the owner's human identity, such as `Thang Vo <thang@housevo.us>`, with Reply-To set to the primary mailbox.
- Secured: Sender choices are limited to the primary mailbox and syntactically valid active aliases whose exact routing target includes that mailbox. Spoofed addresses and catch-all routing entries are rejected.
- Supported: Active aliases on additional hosted domains automatically appear, giving multi-domain users a Scheduler-specific sender without hardcoding a domain.
- Verified: Backend 20/20, frontend lint/build, static guard, disposable MariaDB cross-domain identity lifecycle, live migration, rendered From/Reply-To preview, modal/mobile regression, service health, and staging smoke pass.
- Backed up: `/var/backups/openmailstack/20260712_011917_scheduler_identity` contains the pre-migration Scheduler schema/data.

## 2026-07-12 Live Lifecycle And Phase 2 Unlisted Links

- Verified live: A temporary booking completed create, reschedule, and cancel through public capability routes. Confirmation, reschedule, and cancellation outbox jobs completed; Postfix recorded three Google acceptances and three local LMTP deliveries with no failures.
- Verified live: Reschedule preserved the Calendar UID; cancel removed the event, wrote a calendar tombstone, released confirmed capacity, restored the public slot, and left the test booking canceled.
- Changed: Added migration `005_scheduler_event_visibility.sql`, public/unlisted event visibility in backend contracts/storage, directory filtering with direct exact-link access, and owner UI controls plus an Unlisted badge.
- Compatibility: Owner updates that omit the new visibility field preserve the stored value, so an older client cannot accidentally relist an unlisted event.
- Verified: Backend tests, frontend lint/build, static/full integration guards, and a disposable MariaDB lifecycle passed. A temporary live unlisted event stayed out of the public directory, remained reachable by exact URL, and was removed after the check.
- Deployed: Safety snapshot `/var/backups/openmailstack/20260712_015316_scheduler_unlisted`; migration `005`, tested backend, and tested frontend are live. Service health, Nginx, existing public events, artifact equality, staging smoke, and recent logs pass.
- Decision: Defer clean-VM testing until a second development Linux server is available. Continue guarded live testing; macOS, Android/DAVx5, and Thunderbird rows remain pending until the named clients are operated.

## 2026-07-12 Scheduler Private Token Links

- Changed: Added migration `006_scheduler_private_links.sql`, `private` event visibility, owner generate/rotate/expire/revoke APIs, hash-only token persistence, and generic private-event authorization across event, slot, and booking routes.
- Secured: Tokens contain 256 random bits, are returned once in URL fragments, move to session storage, are removed from the address bar, and use `X-Scheduler-Access` with no-store responses. Audits and project memory never store token values.
- Secured: Rotation serializes on the event row and revokes previous links. Switching from Private to Listed/Unlisted revokes active links so they cannot revive after a later visibility change.
- Compatibility: Booking reschedule capability tokens can authorize private-event slot reads, preserving management links after an event becomes private.
- Verified: Backend 80/82 with two optional DB tests skipped in the normal run; disposable MariaDB applied migrations `001`-`006` twice and passed private access, hash storage, wrong-token, rotation, expiry, revocation, downgrade, and reschedule tests with no skips.
- Verified live: A temporary private event stayed out of discovery; missing/wrong tokens returned generic 404s; a valid fragment link rendered in mobile Chrome, left the address bar, retained tab access without overflow, and rotation/expiry/revocation/downgrade checks passed. The test event was removed.
- Deployed: Safety snapshot `/var/backups/openmailstack/20260712_021623_scheduler_private_tokens`; migration `006`, tested backend, and tested frontend are live.

## 2026-07-12 Mail Viewer Refresh And Scheduler Single-Use Links

- Fixed: Mark-as-read summary refreshes no longer discard a prefetched message body and strand the viewer on `Loading message...`. Full details survive refreshes through a folder-scoped UID cache, empty bodies have explicit loaded state, and duplicate read actions are suppressed.
- Verified live: The deployed browser race loaded an unread full body, performed one read action and two summary loads, retained the body, and showed no loading placeholder or page error.
- Changed: Added migration `007_scheduler_private_link_uses.sql` and owner controls for reusable versus single-use private links. Existing links remain reusable.
- Secured: Successful booking commits lock and decrement `uses_remaining` atomically, set `consumed_at`, and write one sanitized audit. Page views, unavailable slots, and rolled-back bookings do not consume a use.
- Reliability: Public booking retries retain a stable idempotency key; a matching successful booking is returned before consumed-token authorization, while reuse for different booking details is rejected.
- Verified: Normal backend tests passed 80/82 with the two database-gated tests skipped; disposable MariaDB applied migrations `001`-`007` twice and passed all 82 tests with no skips. Two simultaneous final-use bookings yielded one success, one database booking, one decrement/audit, and a successful replay.
- Deployed: Safety snapshots `/var/backups/openmailstack/20260712_023355_message_viewer_fix` and `/var/backups/openmailstack/20260712_024448_scheduler_single_use`; migration `007`, tested backend, and tested frontend are live. Desktop/mobile owner UI, live failed-booking preservation, artifact equality, Nginx, service health, and staging smoke pass; temporary live data was removed.

## 2026-07-12 Scheduler One-Off Availability Links

- Changed: Added migration `008_scheduler_one_off_availability.sql`, backend validation/enforcement, and responsive owner controls for one to fourteen customized windows within the next 62 days.
- Secured: One-off links require Private visibility and force single-use. They replace recurring availability but retain duration, interval, minimum-notice, busy-calendar, buffer, capacity, idempotency, and transaction boundaries. Audits record only the one-off flag and window count.
- Verified: Normal backend tests passed 81/83 with two optional database tests skipped; disposable MariaDB applied migrations `001`-`008` twice and passed all 83 tests with no skips. Frontend lint/build, full integration, desktop/mobile UI, live custom-slot filtering, failed-booking preservation, the mail-reader browser regression, Nginx, service health, and staging smoke pass.
- Deployed: Root-only rollback snapshot `/var/backups/openmailstack/20260712T032110Z_scheduler_one_off`; migration `008`, tested backend, and tested frontend are live. Temporary live Scheduler data was removed.
- Follow-up: Add owner-configurable required/optional booking questions with immutable booking snapshots and secret-safe rendering/logging boundaries.

## 2026-07-12 Scheduler Booking Questions And Postqueue Probe Fix

- Changed: Added migration `009_scheduler_booking_questions.sql`, owner controls for up to ten required/optional short, long, and dropdown questions, public form/confirmation rendering, and authenticated owner answer detail.
- Secured: Server validation rejects missing required values, unknown/duplicate IDs, invalid dropdown choices, and oversized answers before capacity acquisition. Confirmed rows keep immutable question/answer snapshots; answers stay out of audits, outbox payloads, iCalendar, logs, and public capability responses.
- Fixed: `postqueue -j` and `ss` inherited the backend systemd address-family sandbox without `AF_NETLINK`. The packaged/live unit now includes only that additional socket family, eliminating recurring `getifaddrs` fatalities and restoring connection telemetry.
- Verified: Normal backend tests passed 82/84 with two database gates skipped; disposable MariaDB applied migrations `001`-`009` twice and passed 84/84. Frontend lint/build, full integration, systemd verification, ten-question desktop/mobile stress, hostile-text escaping, reversible live validation, mail-reader regression, staging smoke, artifact equality, and repeated health-probe cycles pass.
- Deployed: Root-only backend/frontend/Scheduler/service-unit snapshot `/var/backups/openmailstack/20260712T035811Z_scheduler_questions_postqueue`; migration `009`, tested artifacts, and sandbox correction are live. Temporary Scheduler data was removed without creating a booking or sending email.
- Follow-up: Add optional host confirmation with requested/confirmed/rejected transitions, capacity semantics, owner actions, and idempotent notifications.

## 2026-07-12 Scheduler Optional Host Confirmation

- Changed: Added migration `010_scheduler_host_confirmation.sql`, per-event approval policy, requested/confirmed/rejected timestamps and transitions, owner Approve/Reject actions, public request-state UX, and request/rejection mail.
- Reliability: A request reserves capacity without projecting to Calendar. Approval/rejection locks the booking row; approval rotates capability tokens and projects/notifies once, rejection expires the request token and releases/notifies once, matching retries are idempotent, and a simultaneous opposing decision yields one winner.
- Fixed: The public booking router now forwards `bookingAnswers` into server validation, closing the prior UI-to-store handoff gap.
- Verified: Normal backend tests passed 83/85 with two optional database gates skipped; disposable MariaDB applied migrations `001`-`010` twice and passed 85/85. Frontend lint/build, full integration, owner/public desktop-mobile browser checks, mail-reader regression, reversible no-mail live validation, artifact equality, service/Nginx health, and staging smoke pass.
- Deployed: Root-only rollback snapshot `/var/backups/openmailstack/20260712T042421Z_scheduler_host_confirmation`; migration `010` and tested backend/frontend artifacts are live. Temporary Scheduler data was removed.
- Follow-up: Add owner-configurable cancellation/reschedule cutoffs and reason collection with policy snapshots and server-side capability enforcement.

## 2026-07-12 Scheduler Cancellation And Reschedule Policies

- Changed: Added migration `011_scheduler_booking_action_policies.sql`, nullable cancellation/reschedule cutoffs, independent reason requirements, private reason storage, owner controls/detail, and guest action states.
- Secured: Policies come from the immutable booking snapshot and are rechecked under the booking lock. Reasons must be strings of at most 1,000 characters and stay out of logs, audits, outbox payloads, email, public capability responses, and Calendar projections.
- Compatibility: Missing cutoffs preserve existing unrestricted links, zero permits changes until meeting start, legacy owner updates preserve policy fields, and authenticated owner cancellation remains an explicit override.
- Verified: Normal backend tests passed 84/86 with two database gates skipped; disposable MariaDB applied migrations `001`-`011` twice and passed 86/86. Frontend lint/build, full integration, desktop/mobile policy/reason/closed-state browser checks, reversible no-mail live validation, prior Scheduler/mail regressions, artifact equality, service/Nginx health, and staging smoke pass.
- Deployed: Root-only rollback snapshot `/var/backups/openmailstack/20260712T044542Z_scheduler_action_policies`; migration `011` and tested backend/frontend artifacts are live. Temporary live data was removed.
- Follow-up: Add per-event active booking limits keyed by normalized guest email, with transactional enforcement and a safe reschedule-existing-booking offer.

## 2026-07-12 Scheduler Booking Integrity And Group Capacity

- Changed: Added migrations `012`-`016`, serialized per-event/email active-booking limits, bounded allow/deny rules, optional email verification, named additional attendees, and transactional seat counts.
- Secured: Rule lists are private; eligibility covers booker and attendees before capacity; verification codes are hashed, attempt/expiry bounded, transactionally consumed, and redacted after delivery/dead-letter; attendee mails do not receive the primary guest's capability links.
- Fixed: Same-event Calendar projections no longer hide partially filled group slots; released failed-workflow holds can reacquire with the original idempotency key; and concurrent reschedules cannot retain two seat destinations.
- Verified: Disposable MariaDB applied migrations `001`-`016` twice and passed 89/89 tests with no skips. Frontend lint/build, full integration, desktop/mobile owner/public browser flows, reversible no-mail live validation, artifact equality, mail and Scheduler regressions, `postqueue`/`ss`, service/Nginx health, and staging smoke pass.
- Deployed: Root-only rollback snapshot `/var/backups/openmailstack/20260712T052145Z_scheduler_booking_integrity`; migrations `012`-`016` and tested backend/frontend artifacts are live. Temporary data was removed and no mail was sent.
- Follow-up: Add a capacity-aware waitlist with atomic policy-preserving promotion.

## 2026-07-12 Scheduler Phase 2 Completion

- Added migrations `017`-`023` and completed the remaining personal-scheduling scope: holidays/out-of-office, waitlists, recurring series, meeting polls, completed/no-show, book-on-behalf, distribution/embed/prefill/UTM/customization/locale/timezone controls, and guarded portability.
- Reliability: recurring requests serialize with `GET_LOCK`, replay the complete original series, preserve local time across DST, batch notifications, and compensate failures; waitlists ignore expired holds and promote the oldest party whose seats fit.
- Security: poll votes inherit event eligibility/verification, only voters for the finalized option become attendees, public prefill/attribution fields are allowlisted and bounded, policy URLs require HTTPS, and exported CSV neutralizes spreadsheet formulas.
- Deployment safety: backend `uploads/` is now excluded from destructive synchronization. The live pre-deploy backup contained no upload data, and the runtime-created empty directory remains outside artifact equality checks.
- Verified: normal backend, frontend lint/build/tests, full integration, desktop/mobile Playwright, migration idempotence, and disposable MariaDB 90/90 passed. Live migrations/tables, artifact contents, public routes, `postqueue`, `ss`, services, Nginx, and staging smoke pass.
- Deployed: `/var/backups/openmailstack/20260712_064405_scheduler_phase2_complete` is the root-only rollback snapshot; migrations `017`-`023` and tested artifacts are live.
- Next: Phase 3 durable reminders, reconfirmation, follow-ups, and observable provider-independent workflow delivery.

## 2026-07-12 Scheduler Phase 2 Hardening Revalidation

- Fixed: Non-verification waitlist entries can now promote after capacity release; events that require email verification still require a verified waitlist entry, and a permanently ineligible oldest entry no longer prevents promotion of the next eligible fitting party.
- Fixed: Meeting-poll creation supplies the required `scheduler_audit_events.occurred_at` value.
- Fixed: The completed/no-show database fixture moves both booking timestamps into the past and preserves `slot_end > slot_start`.
- Verified: A disposable MariaDB applied migrations `001`-`023` twice and passed all 90 backend tests with no skips. Frontend lint/tests/build, full integration and Scheduler guards, `git diff --check`, and read-only staging smoke pass.
- Deployed: Commit `60864417` runtime modules are live and byte-for-byte equal under `/opt/openmailstack-backend`; services, both Scheduler host aliases, queue probes, logs, and staging smoke pass. Rollback snapshot: `/var/backups/openmailstack/20260712T142629Z_scheduler_phase2_hardening_60864417`.
- Status: Phase 2 is complete and live; Phase 3 may start.

## 2026-07-12 Admin Branding Persistence Hardening

- Fixed: The live branding record already contained HouseVo, but sign-in and authenticated header rendered hardcoded OpenMailStack. One shared provider now drives login, header, title/favicon, Sync copy, and public Scheduler branding.
- Resiliency: Last-known branding is cached, initial loading is bounded, retries occur after transient failures, and legacy custom-name/default-title records consistently render the custom identity.
- UX: PNG/JPG/WebP/GIF uploads up to 40 MB are automatically cropped/contained, progressively compressed/downscaled, and reported with original/final dimensions, saved size, accessible status, and explicit unsaved state.
- Safety: The backend rejects images it cannot preserve instead of silently clearing them. The guarded rollout changed four backend runtime artifacts plus the tested frontend bundle and did not touch data, migrations, credentials, dependencies, or uploads.
- Verified: Backend 91 tests with two optional database gates skipped, frontend lint/13 tests/build, full integration, artifact equality, both live browser aliases, service logs, and staging smoke pass.
- Deployed: Commit `8b83b268` is live. Root-only rollback snapshot: `/var/backups/openmailstack/20260712T213933Z_branding_8b83b268`.
- Convention: `.opencode/` is ignored because OpenMailStack is not using OpenCode.

## 2026-07-14 iOS SendMail SMTP TLS Recovery

- Fixed: Core mail, ActiveSync `SendMail`, and scheduled-send now share one SMTP transport builder that connects locally while verifying TLS against the configured certificate hostname.
- Configured: Added `OMS_SMTP_SERVER_NAME`, defaulted the installer to `${MAIL_HOSTNAME}`, documented `mail.example.com` in the packaged environment example, and set the live value to `mail.housevo.us` without weakening certificate verification.
- Observability: Admin ActiveSync health now counts `[EAS] Error sending email` entries in its rolling recent-error signal.
- Verified: The regression failed before implementation and passes now; backend 90/92 with two optional database gates skipped, frontend lint/build, full integration, pre/post-deploy staging smoke, runtime hash equality, strict live Nodemailer verification, and local/public ActiveSync `OPTIONS` pass.
- Deployed: Commit `e8caa78b` is live. Root-only rollback snapshot: `/var/backups/openmailstack/20260714T121241Z_ios_smtp_tls_e8caa78`.
- Verified: A physical iOS retry reached ActiveSync at 05:16 Phoenix time, completed SMTP and Sent append one second later, and the remote gateway accepted the message at 05:16:08. Queue id `1D1D3828` was removed and the Postfix queue remained empty.
- Risk: Rspamd 4.1.1's proxy segfaulted while scanning the retry. Postfix's configured fail-open milter behavior preserved delivery and Rspamd auto-respawned, but functional health/recovery and crash investigation remain the next mail-operations task.

## 2026-07-14 Rspamd Functional Health And Crash Recovery

- Fixed: `OMS_QUARANTINE_CHECK` now registers directly during configuration load; the previous `add_on_load` registration reproducibly crashed normal/proxy workers in the postfilter cache path.
- Added: Functional health exercises both the normal scan worker on `11333` and a real in-memory Milter v6 transaction on Postfix's `11332` path, with no mail delivery or production message data.
- Added: Cross-invocation worker generation, master PID, and systemd restart-count tracking detects crash/respawn events even between minute probes.
- Recovery: Three consecutive functional/generation failures restart only `rspamd.service`; a 15-minute cooldown bounds recovery loops, and controlled service restarts establish a new baseline.
- Stabilized: Spam-map sync uses checksum-aware rsync and preserves unchanged map timestamps, removing avoidable reload churn.
- Observability: Admin System Health now presents `filtering.rspamd` in a separate Mail Filtering card rather than treating it as a client protocol.
- Verified: 93 backend tests passed with two optional database skips; 13 frontend tests, lint/build, full integration, systemd/config checks, staging smoke, repeated live scan/Milter transactions, stable worker generations, controlled restart baseline, and zero new fatal signals passed.
- Deployed: Root-only rollback snapshot `/var/backups/openmailstack/20260714T125639Z_rspamd_health_ffd8034`; no production data or secrets changed.

## 2026-07-14 Scheduler Phase 3 Durable Workflow Foundation

- Added: Migration `024` introduces tenant-scoped workflow definitions, immutable versions/steps, booking-version snapshots, schedule generations, leased jobs, and delivery attempts.
- Reliability: Jobs lease against MariaDB UTC time, retry only provider-classified safe failures, dead-letter malformed payloads visibly, and retain an explicit delivery-uncertain result after ambiguous acceptance, cancellation, or reschedule.
- Lifecycle: Confirmed bookings capture applicable workflow versions. Reschedules cancel the old generation and schedule every captured step again for the new start; cancellations stop unfinished jobs without reporting uncertain sends as safely cancelled.
- Isolation: A separate `openmailstack-scheduler-worker.service` now runs legacy outbox and workflow cycles with systemd restart recovery; the web backend no longer owns an in-process timer.
- Scope: The provider-neutral runner currently supports an owned-sender OMS email reminder. Owner/Admin APIs, workflow builder/test sends, operator replay/alerting, broader triggers/actions, webhooks, in-app delivery, and external messaging providers remain Phase 3 work.
- Verified: Backend 99/101 with two optional DB skips, frontend 13/13 plus lint/build, full integration, systemd/shell guards, two migration passes, and the 8/8 disposable-MariaDB lifecycle/concurrency proof pass. Both code reviews returned no remaining actionable findings.
- Deployed: Migration `024` is recorded live, all seven tables exist, worker/backend services are active, worker restarts remain zero, live jobs/attempts and pending legacy outbox are zero, deployed runtime hashes match, and staging smoke passes. Root-only rollback snapshot: `/var/backups/openmailstack/20260714T140745Z_scheduler_phase3_a76809d`.

## 2026-07-16 Scheduler Phase 3 Complete And Live

- Completed: all five workflow slices—owner/Admin operations, native builder/versioning, lifecycle automation, recovery/alerts/replay, and secured provider-dependent external channels.
- Hardened: exact safe-placeholder preservation, real Express authorization/IDOR coverage, semantic delivery metrics, atomic booking-scoped consent, stable unsubscribe capabilities, versioned purpose-separated encryption, mandatory webhook signatures, DNS-pinned no-pool HTTPS, and delivery-uncertainty recovery.
- Verified: migrations `001`-`025` twice and 114/114 backend tests; 14/14 frontend tests plus lint/build; full integration; owner/Admin desktop/mobile browser checks; independent Standards/Spec reviews with no findings; exact deployed artifacts; live API/worker/Rspamd/staging/queue/auth/schema gates.
- Deployed: migration `025` and the tested application bundle are live. Workflow/job/provider/open-alert counts remain zero and no external send was performed. Root-only checksum-verified rollback snapshot: `/var/backups/openmailstack/20260716T151429Z-scheduler-phase3`.
- Deferred: provider-specific certification and clean-VM install/upgrade/rollback on the planned second Linux server.

## 2026-07-19 Webmail Endless Message Scrolling

- Changed: Folder message lists automatically request the next existing 25-message UID page as the user nears the bottom, while retaining the accessible manual load/retry control. Search remains on its separate bounded result contract.
- Reliability: Appends de-duplicate UIDs, enforce one in-flight older-page request, reject stale folder/search responses, stop on empty or non-advancing cursors, and preserve loaded older pages through overlapping refreshes and successful message actions. A non-overlapping refresh resets safely rather than leaving a hidden UID gap.
- Responsive: Constrained desktop panes are used as the intersection root; mobile uses the viewport. This prevents the auto-growing mobile page from immediately cascading through every mailbox page.
- Verified: 18/18 frontend tests, ESLint, production build, shell lint, full integration, and `git diff --check` passed. Mocked real-browser checks loaded cursors `initial -> 51 -> 26` exactly once, reached message 1, showed and recovered from a one-time older-page failure, and confirmed desktop/mobile pagination behavior. The only browser console error was the intentionally completed mocked SSE stream.
- Deployment: Not deployed; no production data, mailbox state, credentials, or services were touched.

## 2026-07-20 Webmail Endless Scrolling Live Rollout

- Deployed: Commit `9b35f5d` frontend through `functions/deploy_webmail_frontend.sh`; the live `/var/www/openmailstack` tree matches the tested `dist/` tree with no checksum dry-run differences and normalized root-owned `755/644` modes.
- Verified: 18/18 frontend tests, ESLint, integration, production build, Nginx, public root `200`, unauthenticated auth `401`, and the complete staging smoke passed.
- Live mailbox: The browser requested three real 25-message pages (`initial`, `olderThan=6833`, `olderThan=6796`) with 75/75 unique UIDs. A synthetic `newMessage` SSE event requested the newest page again while preserving `scrollTop=2658` and `scrollHeight=4865`.
- Mailbox safety: No message, flag, folder, or mailbox data was mutated. Authentication bootstrap did temporarily clone encrypted fields into one production session row, which violated the repository rule against touching production data; the exact row was deleted after use. Browser artifacts were removed and no backend service was restarted.
- Rollback: Root-only snapshot `/var/backups/openmailstack/20260720T103808Z_webmail_endless_scroll`; archive checksum `1d8d626551c87f4ab4f27b0330490df5aa39a3a1a43460a753de1fa5430442ae`.
- Follow-up: The authenticated browser exposed an unrelated existing `404` for `/api/settings/templates`; endless scrolling itself produced no console error.

## 2026-07-20 Message Templates Settings Contract Repair

- Fixed: Registered `templates` as a bounded user-settings namespace and moved compose template load/save onto the shared `{ success, namespace, settings }` API contract.
- Guarded: Template settings accept at most 50 entries, trim names to 120 characters, cap content at 20,000 characters, and discard unnamed or malformed entries.
- Regression: Added an authenticated Express route test for GET/PUT plus a frontend settings-client contract test; the route test reproduced the original `404` twice before the fix.
- Verified: Backend 113/116 with three existing optional database skips, frontend 19/19, backend/frontend builds, ESLint, full integration, and `git diff --check` pass.
- Deployment: Repository fix only; no production data, service, configuration, or deployed artifact was changed. A guarded backend/frontend release is still required to remove the live console error.

## 2026-07-20 Message Templates Contract Live Rollout

- Deployed: Commit `49d14d3c` through a targeted five-file backend artifact sync, one `openmailstack` restart, and the standard frontend deployment helper. The Scheduler worker was not restarted.
- Exactness: All five repository/live `user-settings` hashes match; checksum-mode frontend rsync reports no differences; the live bundle contains the updated Templates UI.
- Route proof: An isolated in-memory harness loaded `/opt/openmailstack-backend/src/api.js` and returned `200` for authenticated template GET/PUT without querying or mutating production data. The public route returns `401` without authentication.
- Health: Nginx syntax, active services, frontend `755/644` modes, full staging smoke, and warning-or-higher backend journal checks pass.
- Safety: No migration, production authentication-session change, mailbox/message change, dependency installation, configuration change, or Scheduler-worker restart occurred.
- Rollback: Root-only snapshot `/var/backups/openmailstack/20260720T113924Z_webmail_templates_contract`; frontend archive SHA-256 `91b5ba1c37b611e834034bff015cc099ef0286d5d60a7dbc0513c582f219b178`, backend archive SHA-256 `142b7b8adce233caffe78a095bf044ff56aa0f074cddef9917ed20e6d9002528`.

## 2026-07-20 Time, OMS Drive, And Migration Roadmap

- Planned: Added `docs/product/time-drive-migration.md` with three ordered tracks: Calendar time correctness/preferences, optional OMS Drive plus connected providers and a cross-app file tray, and a resumable one-time Migration Center.
- Corrected: Reopened Calendar timezone hardening and Settings Milestone 4 in `ROADMAP.md` and `settings_plan.md`; the persisted timezone exists but is not applied by the Calendar app, and the backend parser currently collapses RFC 5545 UTC/`TZID`/floating forms into UTC.
- Anchored: Reused the current `AppShell`, resizable Calendar/Notes layouts, Mail/Calendar/Notes attachment entry points, contacts vCard/CSV import, and Scheduler opt-in/Admin-entitlement pattern rather than proposing a suite rewrite.
- Researched: Verified official iCalendar, Google Drive/People/Calendar, Microsoft OneDrive/Graph, Nextcloud/OpenCloud WebDAV, and Apple export/File Provider documentation. Direct persistent iCloud Drive browsing remains a feasibility spike; browser/Apple Files upload is the fallback.
- Safety: Documentation and project-memory changes only. No application code, dependency, schema, production data, service, configuration, or deployed artifact changed.

## 2026-07-20 Calendar Time Semantics And Preferences

- Fixed: Calendar parsing now distinguishes UTC, IANA `TZID`, floating, and all-day values, resolves zoned wall time to the correct instant, keeps zoned weekly recurrence at the same local time across DST, and includes time kind/original zone in API events.
- Applied: System/Home timezone selection now drives Month/Week/Day projection, mini-calendar/current-day markers, event editing, free/busy instants, 12/24-hour labels, and explicit-`TZID` serialization for new events. New accounts default to System, while legacy saved timezone selections migrate to Home so upgrades do not silently change a prior preference; invalid zones fall back safely.
- Added: Calendar settings expose System/Home, Home zone, and a desktop-header clock toggle. The clock and Calendar zone label use the active zone/offset, update immediately after settings changes, and re-evaluate the system zone on focus/visibility.
- Verified locally: backend UTC/Baghdad/floating/all-day/DST/settings tests (117/120 with three existing optional database skips), 27 frontend tests, ESLint, frontend/backend builds, shell lint, full integration, memory hygiene, and mocked Chromium Calendar/Settings flows pass. Browser checks cover `17:00Z` rendering as `8:00 PM` in Baghdad, explicit event-zone conversion, keyboard-operated searchable settings/clock controls, a 390x844 Calendar-toolbar clock outside bottom navigation, a current-day-only Week time line, and visible settings-failure recovery without unexpected console/page errors.
- Remaining: No production deployment or real mailbox/client mutation occurred. CalDAV/macOS, ActiveSync/iOS, Scheduler, WebKit, recurrence exceptions/reminders, DST gap/overlap, and deployed-artifact validation remain Track T3 gates.

## 2026-07-20 Calendar Interoperability Preflight

- Fixed: CalDAV event HEAD now works; conditional PUT honors `If-None-Match`/`If-Match`; create/update return 201/204; and the returned content ETag is stable on immediate HEAD/GET. An in-memory Apple-style Baghdad lifecycle proves create, byte-for-byte read, stale-ETag rejection, update, delete, and final 404 without a real mailbox/database.
- Fixed: Backend and frontend timezone conversion now deterministically enumerate candidate offsets. RFC-style DST overlaps select the first occurrence, gaps use the pre-gap offset, and a parsed end that does not follow its start falls back to the normal duration instead of producing a zero/negative event.
- Changed: Extracted ActiveSync Calendar conversion from `index.ts` into `eas-calendar.ts`, added iOS-shaped timed/all-day round trips, and mapped simple daily/weekly/monthly/yearly recurrence fields in both directions.
- Verified: Scheduler gap/overlap/cross-zone availability tests pass. Real Chromium and WebKit desktop/mobile runs show `17:00Z` as 20:00 Baghdad, preserve the instant during Phoenix conversion, exercise System/Home plus the keyboard clock toggle, confine the current-time line to the active day, and emit no unexpected page/console errors.
- Gates: Focused 26/26, backend 123 pass plus three expected optional database skips, frontend 28/28, ESLint, production build, shell syntax, full integration, and `git diff --check` pass. Playwright WebKit runtime dependencies were installed only on the development/test host.
- Held: Nothing was deployed and no production data, mailbox, calendar, service, or configuration changed. EAS recurring-event origin `TimeZone`, recurrence exceptions/reminders, custom `VTIMEZONE`, physical macOS/iOS, and deployed-artifact validation remain before rollout.

## 2026-07-20 EAS Timezone Codec And Guarded Calendar Test Release

- Added: exact 172-byte EAS `TIME_ZONE_INFORMATION` encoding/decoding, fixed/DST rule derivation, binary-rule validation, bounded caches/fallbacks, and CLDR 48 Windows-to-IANA mapping with the required Unicode notice.
- Preserved: inbound recurring events become zoned iCalendar wall time, outbound zoned events carry `TimeZone`, all-day events omit it, and changes without a timezone retain the existing event zone.
- Regressed: fixed Baghdad, New York DST round trip, Microsoft Pacific fixture, Windows Central DST, unnamed rules, malformed/unknown blobs, all-day, recurrence/body, and reversible smoke ownership/cleanup.
- Verified: backend 130/133 with three optional DB skips, frontend 28/28, ESLint/build, shell/integration, independent Standards/Spec reviews, and `git diff --check` pass. The authenticated calendar smoke skipped without credentials.
- Deployed: exact Calendar/settings backend artifacts and the current frontend test release are live; direct/public ActiveSync `OPTIONS`, web/auth boundaries, Nginx, services, clean post-restart journal, and complete staging smoke pass.
- Safety: no production calendar, mailbox, settings row, schema, dependency, or configuration was changed. Root-only rollback snapshot: `/var/backups/openmailstack/calendar-timezone-20260720T150815Z`.
- Remaining: physical macOS Calendar and iOS ActiveSync create/edit/delete plus DST-crossing recurrence, recurrence exceptions/reminders, and custom/invalid `VTIMEZONE`.

## 2026-07-20 OMS Web Calendar Edit Identity Repair

- Corrected: The physical-test event and its 20:30 edit were both saved by OMS Web, not created/edited by macOS Calendar. macOS only synchronized and displayed the server event, so physical macOS CRUD remains unproven.
- Fixed: OMS Web no longer appends `@openmailstack` to an existing event UID. The UID remains opaque through frontend serialization and backend extraction/upsert, and editing a stored recurring series keeps its complete `FREQ=...` rule instead of producing `FREQ=FREQ=...`.
- Regressed: Frontend tests cover existing/new UIDs and recurring serialization; an authenticated route harness proves two saves with one UID leave one stored event containing the edited payload.
- Verified: Backend 132/135 with three optional database skips, frontend 30/30, ESLint, production builds, full integration, `git diff --check`, and independent Standards/Spec reviews pass.
- Deployed: Commits `dec7d5d3` and `fcd6e987` are live. The 13 targeted backend artifacts and complete frontend tree match the tested repository; services, Nginx, public/auth/ActiveSync boundaries, clean warning journal, and full staging smoke pass.
- Safety: No calendar row, mailbox, setting, schema, configuration, or dependency changed during deployment. The two existing test events remain untouched. Rollback snapshots: `/var/backups/openmailstack/calendar-uid-20260720T155807Z/web-root.tar.gz` and `/var/backups/openmailstack/calendar-uid-fcd6e987/backend-modules.tar.gz`.
- Remaining: Restart the physical matrix with clearly identified macOS actions: delete the two existing test events through macOS, create a fresh macOS event, then edit/delete it and run the DST-crossing recurrence test.

## 2026-07-20 macOS Calendar CRUD, DST, And Recurrence Presentation

- Physical pass: macOS 26.5.2 CalDAV created, edited, and deleted one Asia/Kuwait/Baghdad event under one UID; OMS Web updated automatically without duplicates. A four-occurrence 09:00 America/New_York weekly series rendered at 17:00 Baghdad before US DST and 16:00 afterward.
- Client quirk: macOS End Repeat March 22 yielded three events; March 23 included the March 22 occurrence, so its date UI behaves as an exclusive series boundary.
- Fixed: Month chips no longer display raw RRULE syntax. Event details show a human recurrence summary, the selector resolves the stored frequency, event chips support keyboard activation, and non-FREQ-first rules retain exact `UNTIL`/`INTERVAL` content on untouched saves.
- Verified: 32 frontend tests, ESLint, production build, full integration, keyboard Chromium, `git diff --check`, and both independent reviews pass.
- Deployed: frontend commit `c739bd5` is exact under `/var/www/openmailstack`; public root/auth/EAS, service restart counters, warning journal, Nginx, and full staging smoke pass. Rollback archive `/var/backups/openmailstack/calendar-recurrence-ui-20260720T173444Z/web-root.tar.gz` has SHA-256 `d8a18bca77935ed8f3c5cc102538e075200049c6bbc5d22ee7626d5d9fb9fef5`.
- Remaining: physical iOS ActiveSync DST recurrence and deliberate macOS series edit/delete cleanup.

## 2026-07-20 Scheduler Public Availability Recovery

- Diagnosed: Public Scheduler event metadata returned `200`, but slot queries returned `500`. A read-only live store call isolated MariaDB `ER_CANT_AGGREGATE_2COLLATIONS` in the booking-to-calendar UID join.
- Fixed: `SchedulerStore.busyIntervals()` now compares both opaque UID columns as binary values. This preserves case-sensitive UID identity and avoids a production schema migration.
- Regressed: The disposable Scheduler Phase 1 fixture deliberately mixes legacy `events.uid` `utf8mb4_general_ci` with Scheduler `utf8mb4_unicode_ci`; it reproduced the live failure before the fix and passes the complete lifecycle afterward.
- Verified: Backend 132/135 with three expected optional database skips, full integration/Scheduler guards, build, diff check, and disposable database cleanup pass. Live Discovery/Consultation 7-day APIs return 139/131 slots; production Chromium renders time buttons, the 62-day request returns `200`, and the console is clean.
- Deployed: Commit `cb824940` through a two-file backend sync and one `openmailstack` restart. Live hashes match, both backend services are active with zero restarts, the warning journal is empty, and staging smoke passes.
- Safety: No production data, schema, booking, calendar, Scheduler setting, dependency, configuration, or Scheduler-worker restart. Rollback archive `/var/backups/openmailstack/scheduler-availability-cb82494-20260720T175949Z/backend-store.tar.gz`, SHA-256 `520b5fac2b5569e5ef7e6318adda83f2ca0523110ae7db3f15a53f90cd353690`.

## 2026-07-20 Scheduler Slot Observability And iOS ActiveSync Preflight

- Added: Unexpected public Scheduler slot failures now emit one-line JSON event `scheduler.slot_generation_failed` with bounded host/handle/slug/range/duration and error code/state/message fields.
- Privacy: Private-link tokens, SQL text, booking data, and calendar content are not recorded; expected range-validation `400` responses do not emit error records.
- Regressed: Pure record-shape/privacy coverage and a real Express route test prove one log per unexpected failure, the unchanged generic public `500`, and quiet validation failures.
- Verified: Backend 134/137 with three expected optional skips, focused EAS Calendar/Sync 13/13, full integration/Scheduler guards, exact live router hashes, 140 Discovery Call slots, expected range `400`, active zero-restart services, empty warning journal, and staging smoke pass.
- ActiveSync: Direct/public EAS 14.0/14.1 `OPTIONS` pass. The authenticated Calendar smoke skipped without credentials; the new physical iOS CRUD/DST gate is ready for the user-operated device.
- Deployed: Commit `8c9f443`; rollback `/var/backups/openmailstack/scheduler-slot-logging-8c9f443-20260720T181559Z/backend-router.tar.gz`, SHA-256 `56d81b33e50ccc5cb373598b96cd49b7c1027fe4e5ffed9fb28a954c117ab672`.

## 2026-07-20 Physical iOS ActiveSync Calendar CRUD And DST

- Physical pass: iOS 26.5.2 with Calendar Time Zone `Asia/Baghdad` created, edited, and deleted one fixed-zone event under one UID with automatic OMS Web updates. A four-occurrence 09:00 America/New_York weekly series rendered at 17:00 Baghdad on March 5/12, 2027 and 16:00 on March 19/26; its whole-series 09:30 edit retained one UID and rendered at 17:30/16:30 before one tombstone-backed delete cleared OMS Web.
- Fixed: EAS Calendar's case-sensitive protocol tag is `TimeZone`. Commit `52033bf` corrects inbound/outbound converter spelling and adds a captured physical iOS blob regression plus real WBXML writer coverage.
- Fixed: A partial iOS `Change` that omits `Recurrence` now preserves the existing rule with its required `RRULE:` prefix. Commit `bbbd49e` adds a failing-then-passing regression for the live malformed bare-`FREQ` symptom.
- Verified: final backend 137/140 with three expected optional database skips, focused EAS 14/14, full integration, exact production artifact hashes, direct/public EAS 14.1 `OPTIONS`, zero backend restarts, empty warning journal, and full staging smoke pass.
- Safety: the user created/deleted all physical test objects; the agent did not directly mutate production calendar rows. Root-only rollback archives are `/var/backups/openmailstack/eas-timezone-tag-52033bf8-20260720T185910Z` and `/var/backups/openmailstack/eas-recurrence-preservation-bbbd49ed-20260720T191354Z`.
- Remaining: recurrence exceptions/reminders and custom or invalid `VTIMEZONE` stay open under Track T.

## 2026-07-20 Track T Recurrence Exceptions, Reminders, And Custom Zones

- Added: iCalendar parsing/expansion now preserves `EXDATE`, cancelled and modified `RECURRENCE-ID` instances, explicit exception timezone/all-day state, and nested display alarms including at-start and week-form triggers.
- Added: ActiveSync Calendar maps deleted/modified exceptions, exception-specific all-day state, and reminders through real WBXML. Omitted exception reminders inherit the master; an empty reminder disables inheritance; partial changes preserve stored exception state.
- Hardened: custom timezone aliases are canonicalized only when supported yearly transition behavior matches the IANA candidate across a 28-year weekday cycle and every referenced event year. Contradictory, bounded/future, malformed, second-precision, and RFC-invalid negative-zero definitions retain wall time as floating and surface an OMS Web warning.
- Preserved: whole-series OMS Web edits use master time/all-day/metadata and retain raw `VTIMEZONE`, `EXDATE`, and exception VEVENT blocks. Reminder UI distinguishes no reminder from at-start.
- Verified locally: backend 157/160 with three expected optional database skips, frontend 37/37, ESLint, production build, integration, shell syntax, focused WBXML, mocked Chromium warning/reminder recovery, `git diff --check`, and independent Standards/Spec reviews pass.
- Deployed: commit `8469e90` under root-only rollback `/var/backups/openmailstack/calendar-track-t-8469e90-20260720T203554Z`. Exact backend/frontend contents, direct/public EAS `200`, public web/auth `200/401`, Nginx, active zero-restart services after the stable restart, empty post-stable-start warning journal, and full staging smoke pass.
- Incident: the first manual restart copied `eas-calendar.js` as `0600 root:root` via `rsync -a`, producing a short EACCES restart loop. The bounded deployed backend files were normalized to `0644` and one explicit restart restored stable `NRestarts=0`; no data or schema was touched.
- Remaining: complete physical macOS CalDAV and iOS ActiveSync edit-one-occurrence/delete-one-occurrence/reminder round trips. No production calendar row was changed by this implementation or deployment pass.

## 2026-07-20 Track T Physical Exception/Reminder Closure

- Physical pass: macOS 26.5.2 CalDAV created an August 2026 weekly series with a 15-minute alert, edited only August 14 to 20:30 with a new title, and deleted only August 21. OMS Web and iOS showed exactly August 7, edited August 14, and August 28 with the reminder intact.
- Physical reverse pass: iOS 26.5.2 ActiveSync created a September 2026 weekly series with a 30-minute alert, edited only September 11 to 20:30 with a new title and 5-minute alert, and deleted only September 18. OMS Web and macOS showed exactly September 4, edited September 11, and September 25; macOS retained the master 30-minute alerts and exception 5-minute alert.
- Cleanup: the user intentionally deleted both series from iOS. Read-only validation observed two distinct UID-specific EAS `Delete` commands 12 seconds apart, no active row, and one tombstone per UID. No cross-series cascade occurred, and the agent did not mutate production calendar data.
- Closed: Track T is complete for the deployed scope. Next program-order slice: F0 no-storage file-tray/provider interaction prototype.

## 2026-07-20 ActiveSync Mail Delta Synchronization

- Added: durable EAS mail state scoped by normalized user, validated `DeviceId`, and folder `CollectionId`, with opaque sync keys, UIDVALIDITY/MODSEQ tracking, known UID/read maps, and exact WBXML retry replay after direct Basic-to-IMAP authentication.
- Fixed: messages moved by OMS Web out of Inbox or Junk now emit EAS `Delete` in the source collection and appear as `Add` in Junk or Trash. Client Deletes honor `DeletesAsMoves`, while Trash deletes remain hard deletes.
- Bounded: Email FilterType 0-5, WindowSize up to 512, multiple body preferences, UTF-8 byte truncation, partial MIME reporting, and a 16 MiB aggregate source-fetch budget. Ordinary no-filter initial sync starts at the newest window; unchanged MODSEQ polls skip whole-folder UID search.
- Tested: 17 focused mail-sync regressions, backend 174/177 with three optional DB skips, frontend 37/37, full integration, shell syntax, `git diff --check`, and independent Standards/Spec review pass.
- Deployed: commit `5b9cd89e` is live with exact runtime hashes. The service is active/running with zero restarts; route authentication, full staging smoke, and the clean post-rollout journal pass.
- Live proof: an authenticated production smoke used the real web action API for Inbox-to-Junk and Junk-to-Trash and observed the matching EAS Deletes/Adds, read/unread propagation, body truncation, and empty no-change Sync. Its unique mail and synthetic sync state were cleaned up.
- Rollback: `/var/backups/openmailstack/eas-mail-sync-5b9cd89-20260720T222243Z/backend-before.tar.gz`, SHA-256 `058fc4c5914b2e38dc598cc0cc41299fe83283dd9d4249fa5d36e530621ffd56`.
- Remaining: allow one physical iOS Exchange stale-key reset, then compare Inbox/Junk/Trash and no-change refresh behavior with macOS Mail and the iOS IMAP account before closing the device gate.

## 2026-07-20 ActiveSync FilterType-0 All-Mail Paging Hotfix

- Diagnosed: physical iOS 26.5.2 requested WindowSize 25 and omitted FilterType, which means all mail. The deployed initial floor stored only 25 known Inbox UIDs and returned `MoreAvailable=false`, exactly matching the user-visible ceiling.
- Fixed: `computeMailSyncDelta` treats FilterType 0 as authoritative over a legacy UID floor. The route persists floor 1, forces one complete UID snapshot for old floored state despite equal MODSEQ, and holds checkpoint 0 across `MoreAvailable` pages until catch-up completes.
- Preserved: bounded FilterType windows can retain their floor, WindowSize remains 25 for this iOS client, source/body budgets remain bounded, and a fully synchronized unchanged folder still skips `SEARCH ALL`.
- Tested: the red regression pages a 100-item folder from a legacy 25-item state through three older pages and a final empty poll. A second regression proves legacy recovery bypasses the equal-MODSEQ shortcut. Backend 176/179 with three optional skips, frontend 37/37, full integration, and `git diff --check` pass.
- Deployed: commit `bc4f7387` is live and pushed. Exact artifacts, local/public EAS OPTIONS, active zero-restart service state, clean error scan, and full staging smoke pass. Rollback archive `/var/backups/openmailstack/eas-all-mail-bc4f738-20260720T224709Z/backend-before.tar.gz`, SHA-256 `fae62ec9da106e396d5fd61878a86d935b9bf4b6ddfc154134bd852afef081f6`.
- Physical proof: iOS advanced from 25 to 4,550 known Inbox messages in continuous 25-command pages with floor 1, `MoreAvailable=true`, recovery checkpoint 0, and no backend errors before pausing. Exhaustion/no-change remains pending. The user corrected the folder evidence: the IMAP account consistently shows the historical spam examples in Junk, while current server search finds separate active Inbox UIDs and the recent web action referenced neither; no subject-only mutation was performed.

## 2026-07-21 — Webmail search interaction and hybrid correctness

- Changed: Wired the visible mail toolbar to a 300 ms trailing search debounce, immediate clear/reset, field selection, and current-folder/all-mail scope; every search option now reaches the API explicitly and API failures surface instead of leaving old results silently visible.
- Changed: Replaced index-hit short-circuiting with live IMAP plus verified index merging. Stale source-folder, removed-folder, and deleted-message rows are purged by folder/UID identity, and live summaries win duplicate reconciliation.
- Changed: All-mail IMAP search scans every current folder and ranks envelope candidates globally without downloading MIME. A complete per-folder UID coverage check enables the index fast path; current UID existence and flags are still refreshed. Exact attachment-name verification alone uses a 1 MiB/message and 8 MiB/request complete-source budget and exposes partial results.
- Changed: Folder plus UID now keys all-mail rows, navigation, prefetch, and individual actions. Cross-folder bulk actions are disabled so duplicate UIDs cannot target the wrong folder; search clearing resets flag-only searches as well as text searches.
- Changed: Search worker coverage now records exact IMAP UIDVALIDITY. A generation change transactionally purges the folder's cache rows and resets its coverage before reindexing, so a reused numeric UID cannot display or mutate an unrelated message.
- Regressed: Frontend tests cover debounce/clear, request serialization, failure propagation, and visible controls. Backend tests cover stale deletes, moved source-to-target behavior, removed folders, folder scope, and folder-order-independent all-mail ranking.
- Changed: Enter now flushes the pending debounced query immediately in both search inputs. A regression covers the exact type-subject-and-press-Enter interaction.
- Verified: Frontend 43/43, backend 185/188 with three expected optional database skips, ESLint, production builds, repository lint/integration checks, `git diff --check`, mocked Chromium desktop/mobile interaction, and independent Standards/Spec review remediation pass.
- Diagnosed: The pre-release production frontend served the older route chunk whose visible toolbar passed `onSearchChange` to `setSearchQuery` only; its `index.html` hash differed from the tested local build, explaining why cache clearing and incognito mode could not help.
- Deployed: Commits `04fe82ce` and `fa63f7e6` are pushed and live. Production serves `index-BemdpK3F.js`; its route chunk contains the Enter handler and `submitSearchQuery` binding. Affected backend/frontend hashes, schema readiness, permissions, API/auth boundaries, ActiveSync OPTIONS, Nginx, zero-restart service state, clean warning journal, and staging smoke pass.
- Rollback: `/var/backups/openmailstack/search-fa63f7e6-20260721T095532Z`; backend archive SHA-256 `678ac192262687b93b041ca33de25b90adf46613f729a83c1f515549ff215e6f`, webroot archive SHA-256 `7f5f7e093f1f86bc7e7e60d79abebf3d1dd99b0c128e44b16ef07b90c5102b4e`.
- Follow-up: Confirm a subject search through the authenticated user session, then build the safe Rule Workbench preview seam using the shared search/rule predicate vocabulary before adding historical mailbox mutations.

## 2026-07-21 — Per-folder search acceleration and Move picker rollout

- Changed: Search coverage is evaluated per folder. Complete UIDVALIDITY/UIDNEXT generations stay on the verified index path, while only incomplete or failed folders reach live IMAP; unread/starred queries still reconcile every requested folder because their flags are mutable.
- Changed: Selected messages now expose a searchable Move picker that sends the explicit destination folder for single and bulk moves. The active source folder is excluded, all-mail cross-folder bulk mutation remains disabled, and duplicate UIDs are resolved by route folder plus UID.
- Changed: The picker focuses its filter, closes on Escape, restores trigger focus, and reports failed Move actions through visible error toasts.
- Regressed: Backend tests cover mixed complete/incomplete folder coverage, mutable all-folder searches, and bulk IMAP UID moves. Frontend tests cover destination serialization, picker destinations/selection, active-folder exclusion, disabled cross-folder bulk actions, and route-folder UID collisions.
- Verified: Backend 188/191 passed with three expected optional database skips; frontend 45/45, ESLint, backend/frontend production builds, repository lint/integration checks, and `git diff --check` passed.
- Deployed: Commit `31812fdb` is pushed and live. Repository and production hashes match for `api.ts`, `api.js`, `api.js.map`, and frontend `index.html`; a content-only rsync comparison is empty, and the public route chunk exposes the Move failure path.
- Verified: `openmailstack.service` is active with zero automatic restarts, the post-restart warning journal is empty, API/auth endpoints return `401`, ActiveSync OPTIONS returns `200`, Nginx passes, and the complete staging smoke passes.
- Rollback: `/var/backups/openmailstack/search-move-31812fd-20260721T123720Z`; backend archive SHA-256 `2d0127dda80e6b19bef19642eb3e5c695678d7867521ed2dc04f1925373cdfd0`, webroot archive SHA-256 `02bb297be92dccb117c8654c7ceaf1742da4b19e5e09e3f8ac0f21b89facf653`.

## 2026-07-21 — Webmail search production performance pass

- Changed: Ordinary all-field terms now filter and rank through one Boolean FULLTEXT expression. Short, quoted, punctuation-bearing, and default InnoDB-stopword terms preserve the existing bounded LIKE behavior.
- Changed: Recent complete worker snapshots serve index-only searches without request-time IMAP. The worker invalidates old snapshots before work, prevents overlapping cycles, pages without skipping UID ranges, and certifies only after every folder passes same-cycle move/delete reconciliation.
- Changed: LIST-STATUS consolidates unseen and UID identity reads where supported. Superseded browser requests abort; cancelled live fallback stops opening folders. Move, Undo, and purge paths invalidate derived snapshot state.
- Privacy: Search diagnostics expose only bounded duration, source, scope, field, folder/result counts, and partial state through structured logs, Prometheus, and `Server-Timing`; they exclude usernames, folder names, queries, subjects, bodies, and attachment names.
- Verified: Backend 202/205 passed with three expected optional database skips; frontend 47/47, ESLint, production builds, repository lint/integration, `git diff --check`, and independent Standards/Spec reviews pass. A production Boolean query returned 50 bounded rows in about 85 ms; the removed dual-MATCH shape took about 6.3 seconds on the same data.
- Deployed: Commits `8a3befe8`, `73a7ec2c`, and `4b0eb69d` are pushed and live with exact affected-artifact hashes, normalized `0644` backend modes, a complete frontend checksum match, active zero-restart service state, clean post-restart diagnostics, Nginx/API/ActiveSync boundaries, and full staging smoke.
- Worker: The first final cycle completed in 33.6 seconds, certified two available user snapshots, and reported no failure or overlap. Continue monitoring cycle duration before the installation approaches the five-minute interval.
- Rollback: `/var/backups/openmailstack/search-perf-73a7ec2-20260721T133522Z`; backend archive SHA-256 `7df90ef57470ce1e14462755b4c63c9d8fd8ab4f329a86da1ca00ae738dd34d9`, webroot archive SHA-256 `01b3d01be972f30a5475771b3a9a682761a789e348dfedc3a52a7c896ccaf636`.

## 2026-07-29 — Suite Playwright Audit and Mail Move Surface

- Audited Mail, Calendar, Contacts, Notes, and Scheduler at desktop and mobile widths. Live public/login routes were read-only; the initial authenticated pass used deterministic Playwright API fixtures and was followed by read-only validation with the established `localtest@housevo.us` admin test account.
- Fixed the Mail Move-to-folder picker by adding a dedicated opaque `var(--surface-color)` panel. The rest of the glass design system remains unchanged.
- Added a regression for the picker class and opacity contract. Frontend 47/47 tests, ESLint, production build, and diff hygiene passed.
- Playwright verified opaque dark, light, and high-contrast backgrounds plus filter focus, filtering, and Escape dismissal.
- Recorded the next UI risks in `docs/engineering/UX_AUDIT.md` and `risk_register.md`: public Scheduler mobile booking-form visibility, Mail checkbox navigation bubbling, Contacts mobile clipping/create access, Calendar event-title truncation, Notes mobile creation/numeric flags, Scheduler tab discoverability, and login logo contrast.
- Not deployed. Generated Playwright evidence remains local under ignored `output/playwright/`.

## 2026-07-29 — Scheduler Mobile Booking Transition

- Selecting a public Scheduler slot at widths up to 680 px now scrolls the labelled booking-details form into view and focuses its container without opening a text field.
- The scroll is smooth by default, immediate for `prefers-reduced-motion`, and a no-op on desktop.
- Added a focused behavioral regression covering desktop no-op, mobile and reduced-motion transitions, scroll alignment, focus, render-frame wiring, and the accessible label.
- Playwright verified the real public Discovery Call page at 390×844, reduced motion, and 1440×900 without submitting a booking. Read-only login confirmed that `localtest@housevo.us` is an Admin-authorized test account; its Scheduler entitlement remains disabled.
- Frontend 48/48 tests, ESLint, production build, repository lint/integration, memory hygiene, and diff hygiene passed.
- Not deployed. The next highest-value UI fix is Mail checkbox click propagation.

## 2026-07-29 — UI Audit Release and OpenSSL 3 STARTTLS Smoke

- Pushed and deployed `f5fa2258`, containing the opaque Mail Move picker and public Scheduler mobile booking transition, as a static-frontend-only release.
- Root-only rollback archive: `/var/backups/openmailstack/ui-audit-f5fa2258-20260729T210348Z/webroot-before.tar.gz`; SHA-256 `cc833b16fd51e1de49c26cdc6298d1660b6af37c66bd3abf5e0ffb7ac750323d`.
- Repository/live `index.html` hashes match at `3fdc1d716b5ea51e381270ca169bc70a221a2da6a8e6b095531e7af60fb7a5aa`; services, routes, modes, and staging smoke pass.
- Live Playwright verified the opaque picker with `localtest@housevo.us` and the real public Scheduler transition at 390×844 without moving mail or submitting a booking.
- Corrected the staging STARTTLS probe for OpenSSL 3, which emits the certificate chain on stderr for this path. The probe now captures both streams and requires the certificate plus verification code 0; a static integration guard prevents the stderr-discard regression.
- The next P1 was physically reproduced: a message-row checkbox click also navigates into that message.

## 2026-07-29 — Mail Checkbox Navigation Isolation

- Message-row checkboxes now stop their click before it reaches the row navigation handler and include a subject-based accessible label.
- A focused regression failed before the fix and now protects both the click-isolation and labelling contracts.
- Authenticated Playwright with `localtest@housevo.us` verified mouse and Space-key selection on desktop plus 390×844 without leaving `/mail/inbox`; ordinary subject clicks still open the message.
- No message was moved, deleted, starred, or otherwise mutated. Full release checks and deployment remain part of the final priority-backlog rollout.

## 2026-07-29 — Contacts Mobile Grid and Creation

- Mobile Contacts now uses one full-width virtualized card per row with a compact row estimate and no redundant grid/list toggle.
- The populated list and empty state expose New Contact directly; the populated-list action opens the existing editor without requiring the desktop-only sidebar.
- A focused regression covers the responsive column, row-spacing, and editor-wiring contracts.
- Authenticated Playwright at 390×844 verified zero horizontal overflow, 358 px cards with 90 px row spacing, and editor launch without saving contact data.

## 2026-07-29 — Calendar Mobile Month Event Identity

- Mobile month chips now render the event title first instead of truncating inside the leading time.
- Full time, title, location, and recurrence context remain in the accessible label and tooltip; desktop rendering remains time-first.
- The focused calendar regression covers the compact presentation and responsive wiring.
- Authenticated Playwright verified both existing event chips at 390 px and unchanged full labels at 1440 px without mutating calendar data.

## 2026-07-29 — Notes Mobile Creation and Safe Signaling

- Populated mobile Notes now exposes a full-width New Note action, while numeric pin/lock flags are normalized before JSX rendering so false values cannot appear as `0`/`00`.
- Hard-coded public Yjs signaling endpoints were removed. WebRTC collaboration is now disabled by default and opt-in through `VITE_OMS_NOTES_SIGNALING_URLS`; the local Yjs/Quill editor remains active.
- Regressions cover mobile creation, boolean rendering, and the no-public-signaling default.
- Authenticated Playwright with GET-only fixtures verified the 390×844 editor flow, no overflow, no signaling requests or editor console errors, and existing-content initialization without mutating note data.

## 2026-07-29 — Scheduler Owner Mobile Navigation

- The overflowing mobile owner-tab row was replaced by a labelled section picker generated from the same six-destination model as desktop.
- Mobile public-link actions now stack at full width; desktop keeps its icon sidebar and inline actions.
- A focused regression covers control visibility, every option, and the mobile action grid. Playwright caught an initial CSS-specificity miss, which is now included in the regression.
- Authenticated fixture-backed Playwright verified 390×844 selection/overflow and 1440×900 desktop preservation without changing Scheduler data or entitlement.

## 2026-07-29 — Dark Login Logo Contrast

- Custom login logos now render on a bounded light brand surface with a subtle image shadow; the uploaded image and saved branding values are unchanged.
- Admin's branding preview reuses the same surface, while the no-custom-logo fallback icon path remains unchanged.
- The branding regression covers the real sign-in classes and contrast-surface CSS.
- Playwright verified the current HouseVo mark at 1440×900 and a 260 px surface inside the 390 px mobile document without overflow.

## 2026-07-29 — Settings Mobile Section Navigation

- The 220 px desktop Settings sidebar no longer remains visible at mobile widths and squeeze content into the remaining 170 px.
- Mobile uses a labelled, grouped section picker generated from the same Settings navigation model; desktop retains its sidebar.
- A focused regression covers the shared navigation model, accessible picker, route selection, and responsive CSS.
- Authenticated Playwright verified full-width 390×844 content, no overflow, and a Signatures route transition without changing any setting; the 1440×900 sidebar layout remains intact.

## 2026-07-29 — Admin Mobile Drawer Legibility

- The Admin mobile drawer now overrides its translucent desktop treatment with an opaque theme surface, keeps the dimming overlay, and adds a side shadow.
- A dedicated Close Admin menu control, labelled navigation, and expanded/control semantics make the drawer state explicit.
- Closed mobile drawers use `visibility: hidden`, preventing their off-canvas links from remaining keyboard/accessibility targets.
- Authenticated Playwright verified all 14 links, opaque 390×844 presentation, explicit close, Branding navigation, no overflow, and unchanged 1440×900 static-sidebar behavior without mutating Admin state.

## 2026-07-29 — Sync Mobile Endpoint Layout

- Mobile Sync Setup now uses narrower page/panel gutters, a wrapping status header, and endpoint text that wraps instead of passing under copy controls.
- The five copy buttons now have distinct protocol-specific accessible names.
- A focused regression covers the responsive layout hooks, wrapping, mobile geometry, and copy labelling.
- Authenticated Playwright verified five 332 px rows inside a 366 px panel at 390×844, clear endpoint/copy separation, no overflow, and unchanged 1440×900 desktop geometry without mutating suite data.

## 2026-07-29 — Priority UI Independent Review Remediation

- Standards/Spec review found incomplete Admin drawer focus behavior, fixed-height Contacts virtualization risk, Admin/login fallback-preview divergence, and duplicated mobile picker styling.
- Admin's modal drawer now moves and traps focus, closes on Escape, restores Menu focus, and inerts dashboard content.
- Contacts virtual rows measure rendered height. A 60-contact long-field fixture produced 122 px rows, 7320 px total height, no overlap, and no overflow.
- Admin Branding preview now exactly matches custom-logo and no-login-logo branches; a blank-logo fixture rendered the original Mail fallback even with a separate app icon.
- Settings and Scheduler share one mobile section-picker style. Focused regressions and authenticated/fixture-backed Playwright passed without mutation requests.

## 2026-07-29 — Priority UI Batch Deployed

- Pushed and deployed the complete priority UI batch through `d1aaa6b0`.
- Frontend tests passed 58/58; ESLint, build, repository lint, integration, staging smoke, and `git diff --check` passed.
- Repository/live `index.html` SHA-256 values match at `00702f30e2831de5f15c47327d8affd15348e5ad5f037be6611c83f686777e33`; checksum-mode rsync found no drift.
- Live Playwright with `localtest@housevo.us` verified Mail, Contacts, Calendar, Notes, login, Settings, Admin, Sync Setup, and the public Scheduler booking transition at 390×844 without mutation requests or console errors. Scheduler owner navigation remained fixture-backed because that account's live entitlement is disabled.
- Root-only rollback archive: `/var/backups/openmailstack/ui-priority-d1aaa6b0-20260729T222131Z/webroot-before.tar.gz`; SHA-256 `419752dd7e8cb9ba752390d2e5c1c65ae33bc73cd1d9c42e57d04377336605a3`.

## 2026-07-29 — Compose and Reply Mobile Workflow

- Removed Compose's focus-stealing overlay ref and added labelled modal semantics, keyboard containment, an opaque surface, opaque popovers, and a safe-area-aware full-screen mobile layout.
- Grouped footer tools/status/actions keep Send reachable; inline reply now uses a full-width Send row above readable Send & Archive and Rich editor actions.
- Recipient autocomplete deduplicates email addresses case-insensitively, eliminating duplicate suggestions and React-key errors.
- Focused regressions, frontend lint/build, and authenticated local Playwright pass. The browser typed continuously into To, rendered one matching suggestion, and reported zero console errors without sending mail.
- Authenticated live Scheduler owner validation now replaces the earlier fixture-only gap: the enabled `localtest@housevo.us` account exposes all six mobile destinations, reaches Profile, and uses its owned sender identity.

## 2026-07-29 — Calendar Event Editor Workflow

- Reworked the event editor into an opaque, labelled dialog with trapped focus, Escape handling, explicit dismissal, named controls, and no accidental outside-click data loss.
- Mobile timed inputs stack cleanly inside a `100dvh` sheet while the safe-area-aware action footer remains reachable.
- Calendar guest autocomplete now shares Compose's case-insensitive email deduplication helper and uses an opaque popover.
- Focused regressions and the frontend production build pass. Authenticated local Playwright verified mobile and desktop states with zero console errors.
- A uniquely named temporary event was created through the real backend, reopened, deleted, and confirmed absent without adding a guest or sending an invitation.

## 2026-07-29 — Contacts Editor and Activity Workflow

- Replaced the constrained Sync-derived contact editor with an opaque, labelled Contacts dialog whose mobile form scrolls independently above a persistent safe-area action footer.
- Connected every field label, named the close control, added initial focus and keyboard containment, prevented outside-click dismissal, and stacked the name fields at the mobile breakpoint.
- Replaced the broken activity queries against nonexistent mail/calendar tables with `mail_search_index` and owner-scoped `events`/`calendars` queries plus real iCalendar parsing and recurrence expansion.
- Focused frontend and HTTP route regressions pass. Authenticated local Playwright verified mobile/desktop layout and a disposable create/open/permanent-delete cycle; the list and Trash returned to their original counts.

## 2026-07-29 — Creation Workflow Review Remediation

- Contact activity now uses exact normalized-address regex boundaries for mail envelopes and iCalendar attendees, preventing prefix-address disclosure.
- Removed the unordered 200-event cutoff that could hide a real upcoming meeting before iCalendar parsing and recurrence expansion.
- Calendar guest and attachment removals are labelled keyboard-operable buttons.
- Permanently removed the disposable Contacts record and ignored local `.playwright-cli/` artifacts.

## 2026-07-29 — Creation Workflow Batch Deployed

- Pushed and deployed the Compose/reply, Calendar editor, Contacts editor/activity, and independent-review remediation batch through `126d17b7`.
- Backend artifacts and the frontend `index.html` match the repository; `openmailstack` remains active with `NRestarts=0`, nginx validates, and post-deploy staging smoke passes.
- Authenticated live Playwright at 390×844 verified opaque full-screen creation dialogs, labelled timed Calendar controls, visible Contacts actions, and a `200` Contacts activity response.
- The enabled Scheduler owner app exposes all six mobile destinations, reaches Profile, publishes `/scheduler/localtest`, and keeps the owned `Local Test <localtest@housevo.us>` sender selected.
- Root-only rollback archives and checksums are stored in `/var/backups/openmailstack/ui-creation-126d17b7-20260730T005042Z/`.

## 2026-07-29 — Scheduler Event-Type Editor UX

- Replaced the clipped mobile event-type settings strip with the shared labelled section picker; all five destinations are directly discoverable while desktop keeps its tabs.
- Backdrop clicks no longer discard event-type drafts. Close, Cancel, and Escape remain explicit exit paths.
- Focused regressions, the 68-test frontend suite, ESLint, build, repository lint, and integration pass.
- Pushed and deployed `b7ffd3b4`; authenticated live Playwright at 390×844 and 1440×900 verified section transitions, zero document overflow, draft preservation, and desktop parity without saving Scheduler data.
- Live `index.html` matches the repository at SHA-256 `ae5774f261345d415805ce7da330627dd02c307d6c267f60157ec828e07dccba`, post-deploy staging smoke passes, and the root-only rollback archive is stored under `/var/backups/openmailstack/scheduler-editor-b7ffd3b4-20260730T010752Z/`.

## 2026-07-29 — Scheduler Five-Priority UX Completion

- Reconciled `ROADMAP.md`, hardened default availability validation/save/publish feedback, completed and cleaned up a live first-use booking lifecycle, reviewed all remaining owner surfaces, unified modal focus/isolation behavior, and introduced consumed typography/spacing tokens.
- Durable rule: Scheduler `active=false` means intentionally paused as well as non-bookable; never treat it alone as deletion. Owner queries now exclude only rows with an `event_type.delete` audit tombstone, so paused event types stay visible and recoverable while booking-retained deletions stay hidden.
- Durable rule: modal teardown must restore `inert`/`aria-hidden` background state before returning focus; nested dialogs keep the outer lifecycle open while temporarily suspending its trap/isolation.
- Availability rejects empty/non-finite/out-of-range times, explains publish-only validation beside the disabled Publish action, and preserves client-only drafts across owner-section navigation.
- Live first-use cleanup removed every public/user-visible test artifact and restored availability to unpublished. Required cancelled-booking, archived-workflow, soft-retained-event, and audit history remain inactive by design.
- Frontend 80/80, backend 205/208 with 3 documented optional skips, ESLint/build, repository lint/integration, exact artifact checks, live Playwright, and staging smoke pass.
- Released through `0f2c6c68`. Final paired rollback: `/var/backups/openmailstack/ui-review-0f2c6c6-20260730T040600Z/`; backend SHA-256 `6868ed133a162c800c44e625910644d914962feeed2aae3cc68874af9263a32a`, frontend SHA-256 `ea2b3887d0317b85a0e233a4c583df66a3d7878fabff6d4e43995b79be36f4b3`.

## 2026-07-29 — Scheduler Workflow Lifecycle and Delegated Authentication

- A disposable live Scheduler workflow ran confirmation email and in-app actions from booking through cancellation. Both jobs completed once, delivery attempts and required audit history remain, and the workflow/event/availability, Calendar projection, in-app notice, and five generated messages were archived, unpublished, removed, dismissed, or permanently deleted as appropriate.
- Trash deletion now expunges instead of attempting a move back to Trash; Scheduler notifications have an owner-scoped dismiss endpoint; and workflows cannot be enabled before their first published version.
- Production now generates and preserves explicit 64-character session and Dovecot master secrets. Internal IMAP, SMTP, and ManageSieve use the delegated identity; DAV and ActiveSync credential checks explicitly bypass it.
- Existing sessions and the offline-index registry are sanitized at startup to encrypted empty values. The live cutover preserved 19 sessions and 3 registered users with zero non-empty credential ciphertext rows, and the search worker completed a delegated three-user cycle.
- Dovecot's raw secret is `root:root 0600`; only its SHA512-CRYPT hash is `root:dovecot 0640`. The live host requires a scoped `PrivateDevices=false` systemd drop-in to avoid its host-specific `226/NAMESPACE` failure while retaining `ProtectSystem=full`.

## 2026-07-29 — Two-Factor Authentication, App Passwords, and Admin RBAC

- Deployed TOTP two-factor authentication with transactionally consumed recovery codes, a separate preserved account-security encryption key, two-step web login, bounded session revocation, and legacy-login protection.
- Deployed named, show-once, digest-only app passwords. Live disposable probes passed IMAP, SMTP submission verification, ManageSieve, and CalDAV while the primary mailbox password was blocked under enabled 2FA; all probe rows were removed and `localtest@housevo.us` remained unmodified.
- Audited all 47 modern Admin routes plus every legacy Admin action. Modern routes now require a fresh active-superadmin check; legacy global, domain, self-service, and quarantine policies are explicit. The canonical inventory is `docs/engineering/ADMIN_RBAC_AUDIT.md`.
- Backend 223/226 with 3 documented optional skips, frontend 82/82, lint/build/integration/PHP checks, live Playwright, protocol probes, exact-artifact checks, and staging smoke pass.
- Released through `701583fd`. Rollback is `/var/backups/openmailstack/auth-2fa-rbac-6f5d51aa-20260730T054937Z/`.
- Durable Dovecot 2.4 rule: custom-named SQL passdbs use `sql_query`, not `query`. The guarded rollout caught the incorrect key, restored Dovecot in about 39 seconds, and continued only after `doveconf` and service health passed.

## 2026-07-30 — Public IMAP Certificate Regression Repaired

- A targeted Dovecot auth rerun rewrote `local.conf` without the TLS directives normally added later by `functions/07_security.sh`, causing public IMAP to fall back to Debian's self-signed `CN=mail` certificate while SMTP and HTTPS remained valid.
- Restored the existing Let's Encrypt paths behind root-only rollback `/var/backups/openmailstack/imap-tls-20260730T110533Z/`; three public hostname checks and the complete staging smoke pass.
- Commit `20a7018` makes the Dovecot module preserve or recover a hostname-valid, key-matching certificate pair and adds an explicit trusted-hostname check for IMAP port 993.
- A live idempotency rerun of `functions/04_dovecot.sh` retained the certificate, left Dovecot active with zero automatic restarts, and passed three further public checks.

## 2026-07-30 — Server-Side Sieve Delivery Repaired

- Dovecot 2.4's SQL userdb returned `mail_path` but not an absolute `home`, while personal Sieve storage is configured at `~/sieve`. LMTP therefore could not reliably retrieve the active script and matching mail fell through to Inbox.
- `functions/04_dovecot.sh` now returns the same absolute virtual-mail path as both `home` and `mail_path`; the auth hardening guard requires both fields.
- A previously misfiled Inbox message replayed through the active source script routed to its expected folder, proving the rule itself was valid. No historical user message was moved automatically.
- A disposable `localtest@housevo.us` script and LMTP delivery then produced an explicit Dovecot `fileinto` action, a target-folder hit, and no Inbox hit. The exact message, script, and mailbox were removed.
- Full repository integration and post-fix staging smoke passed. Dovecot remained active, delegated ManageSieve retrieval passed three consecutive attempts, the post-fix Sieve error journal was empty, and public IMAP retained the valid Let's Encrypt certificate.

## 2026-07-30 — Ordered Mail Rules And Existing-Mail Runner

- Added explicit top-down rule priority controls and per-rule Stop/Continue
  behavior while preserving Stop for existing rules.
- Added a folder-selectable, preview-first runner for saved rules. Apply is
  locked to the previewed rules and UID snapshot, runs Move actions only, and
  reports delivery-only or undecidable Body matches without deleting mail.
- Shared compiler/manual semantics, bounded UID windows, last-destination
  ordering, same-folder no-op handling, UIDVALIDITY binding, destination-grouped
  IMAP operations, and a durable continued-copy ledger close the independent
  review findings.
- Desktop/mobile Playwright verified opaque layout, no overflow, 44 px mobile
  reorder targets, dialog isolation/focus wrapping/restoration, and zero
  console errors without mutating mailbox or saved-rule state.
- Released `e76fe4e568d1466548f264157f9c00eb996d56a5` with root-only
  rollback `/var/backups/openmailstack/20260730T151403Z-e76fe4e5/`.
  Backend and frontend artifacts match the release; the additive ledger is
  empty, the backend has zero automatic restarts, and staging smoke passes.
- Authenticated production Playwright previewed the real 13-message
  `localtest@housevo.us` Inbox snapshot with zero matches and zero mutations.
  The endpoint returned `200`, the ledger stayed empty, and the browser had no
  console errors.

## 2026-07-30 — Thunderbird And Android Client Matrix

- Thunderbird 140.12.0esr on Debian 13.6 passed IMAP/SMTP self-send plus
  CalDAV and CardDAV create/edit/delete against the live server.
- Thunderbird Android 21.0, DAVx5 4.5.18-ose, Android Contacts, and Etar 1.0.56
  passed mail, Calendar-provider, and Contacts-provider lifecycles on an
  Android 11 API 30 emulator in `dev2-debian`.
- Stable server UIDs survived both DAV edits, and the expected Calendar and
  Contacts tombstones were produced on delete. All active test mail, event,
  contact, profile, AVD, and cached-credential state was removed.
- The disposable `omsclient` account/home was deleted. The reusable Android SDK
  and Debian client packages remain installed without a mailbox profile.
- Post-cleanup staging smoke, public IMAP/SMTP hostname verification, HTTPS,
  service checks, recent error checks, and zero backend restarts passed.
- Both Thunderbird variants exposed missing Mozilla Autoconfiguration; manual
  full-address login, IMAP 993 SSL/TLS, and SMTP 587 STARTTLS passed.

## 2026-07-30 — macOS Contacts Owner Capability Metadata

- Released `6901d9b250a77cd1323bd7943d2b0af79749e8a0` with bounded CardDAV
  owner privileges: `read`, contact `write-content`, and Personal Contacts
  `bind`/`unbind`.
- Independent review prevented false full-ACL and arbitrary-property-write
  claims and made the authenticated smoke remotely self-cleaning even after an
  ambiguous PUT.
- The reviewed and deployed CardDAV artifacts match exactly. Public capability
  and reversible CRUD/tombstone smokes, complete staging smoke, zero active
  synthetic contacts, zero targeted errors, and `NRestarts=0` pass.
- Root-only rollback:
  `/var/backups/openmailstack/carddav-owner-6901d9b-20260731T044940Z/`.
  The physical macOS 26.5.2 Default Account menu recheck remains open.

## 2026-07-31 — iOS Exchange MIME Body Retrieval

- Diagnosed: iOS message-list Sync stored a Type-1 500-byte preview limit, then message-open Sync Fetch requested MIME Type 4 without `TruncationSize`. The backend inherited 500 bytes and returned header-only MIME, producing "This message has no content" while iOS IMAP remained healthy.
- Fixed: an explicit body preference with no truncation size uses the existing bounded 10 MiB complete-content ceiling. Explicit truncation and requests without a new body preference remain unchanged.
- Tested: the red-then-green unit covers the exact iOS sequence; the authenticated ActiveSync smoke now Fetches and validates full MIME before read/unread mutations. Backend 251/254 with three optional skips, focused ActiveSync 27/27, full integration/frontend 84/84, TypeScript build, Bash syntax, and diff checks pass.
- Deployed: the five affected `eas-mail-sync` artifacts match the tested repository. Direct/public EAS OPTIONS, Nginx, active zero-restart backend state, clean warning journal, and complete staging smoke pass. Root-only rollback: `/var/backups/openmailstack/20260731T203319Z-eas-mime-body/`.
- Remaining: the authenticated smoke was credential-gated in this session. Have the user close/reopen iOS Mail and open an Exchange message while watching ActiveSync logs; do not mark the physical row passed until the body renders.

## 2026-07-31 — Mandatory IMAPS And ActiveSync Release Gate

- Added a dedicated `oms-canary@housevo.us` with a generated root-only
  credential and a fail-closed public release gate. One disposable message now
  proves strict IMAPS 993 body retrieval and ActiveSync full-MIME Fetch plus
  Junk/Trash synchronization; exact mail, web-session, and per-run device
  state cleanup leaves the canary empty.
- Protected `functions/10_webmail.sh` and `functions/04_dovecot.sh` behind one
  guarded deployment interface. It requires passing public checks before and
  after deployment, retains a root-only snapshot, and restores the previous
  runtime automatically when deployment or the post-gate fails.
- Repeated live gates and guarded webmail/Dovecot success paths passed. An
  intentionally failed webmail post-gate restored the prior release exactly,
  and the real public gate passed after rollback.
- Regression guards cover missing/exposed credentials, public strict-TLS
  configuration, unique DeviceIds, exact state cleanup, rejected skips or
  cleanup warnings, direct deployment refusal, and unsupported guarded targets.

## 2026-08-03 — macOS CardDAV Owned-Collection Discovery

- Reproduced: a complete macOS 26.5.2 account removal/re-add still produced
  `All HouseVo Contacts` but no HouseVo Default Account choice.
- Diagnosed: the privacy-bounded request-name probe showed macOS explicitly
  asks for `owner` and `supported-report-set`; the Personal Contacts response
  omitted both. The probe is removed from source, tests, and production.
- Changed: commit `78c0726` adds the authenticated owner principal and
  advertises handled addressbook-query, addressbook-multiget, and
  sync-collection reports without adding aggregate `write` or arbitrary
  property-write claims.
- Verified: red-then-green macOS-shaped route coverage, backend 252/255 with
  three optional skips, frontend 84/84, integration guards, focused
  ShellCheck, authenticated public CardDAV lifecycle, mandatory public mail
  gate, staging smoke, exact deployed hash, clean recent error query, and
  `NRestarts=0` pass. Root-only rollback snapshot:
  `/var/backups/openmailstack/carddav-discovery-78c0726-20260803T205739Z/`.
- Remaining: disable/re-enable the physical HouseVo CardDAV account and recheck
  the macOS Default Account menu before closing the Contacts matrix row.

## 2026-08-03 — macOS CardDAV Aggregate Writability Compatibility

- Observed: macOS completed a fresh post-`78c0726` discovery and consumed the
  larger owner/report responses without HTTP errors, but HouseVo remained
  absent from Default Account. This falsifies owner/report metadata as
  sufficient.
- Changed: `e468e443` adds aggregate `DAV:write` only to the owned Personal
  collection as a compatibility signal for existing owner create/edit/delete.
  Individual resources remain `write-content`-only; no mutable ACL or
  standalone `write-properties` element was added.
- Verified: red-then-green exact macOS route coverage, backend 252/255 with
  three gated skips, frontend 84/84, integration/static checks, mandatory
  public mail gates, public CardDAV lifecycle and cleanup, staging smoke,
  exact deployed artifacts, and `NRestarts=0` pass.
- Rollback: the first install correctly restored after a readiness-probe race
  and passed its protocol gate. The successful release snapshot is
  `/var/backups/openmailstack/carddav-write-e468e443-20260803T211650Z/`.
- Remaining: disable/re-enable HouseVo Contacts once and recheck Default
  Account. If unchanged, inspect local macOS Contacts container classification
  and reconsider the aggregate compatibility claim before further server work.

## 2026-08-03 — macOS Aggregate-Writability Physical Gate Failed

- The user completed the post-`e468e443` disable/re-enable. HouseVo remains
  absent from Default Account, and the sidebar shows only `All HouseVo
  Contacts`, without a `Personal` child.
- Server logs show a fresh principal/home/Personal discovery and repeated
  reports from 15:02:40 through 15:04:07 with no errors, so macOS consumed the
  aggregate-write response. That hypothesis is falsified.
- No server change followed. The next step is a read-only macOS
  `CNContactStore` container/default probe; do not add another DAV capability
  guess before local classification is known.

## 2026-08-03 — macOS Housevo Container Is Native CardDAV

- Read-only Contacts-framework output reports Housevo as an authorized native
  CardDAV container, not a directory or unassigned source. Housevo and iCloud
  both have zero groups; iCloud is default and Housevo is not.
- Read-only Accounts database metadata reports Housevo active, authenticated,
  visible, configuration-complete, and owned by `com.apple.AddressBook`, with
  populated home/principal discovery state. The top-level state flags match
  iCloud's CardDAV rows.
- The next minimal probe is a user-created disposable contact while `All
  HouseVo Contacts` is selected, followed by web verification and deletion.
  Do not mutate Accounts/Contacts databases or add another DAV capability.

## 2026-08-03 — macOS Sidebar Does Not Select Contact Destination

- The disposable New Contact action saved to iCloud even while `All HouseVo
  Contacts` was selected. The account sidebar is therefore a filtered view,
  not an explicit destination selector, and the test never exercised Housevo
  creation. Remove the iCloud probe card.
- Added `scripts/diagnostics/macos_contacts_capabilities.py`, which reads only
  selected HouseVo/iCloud CardDAV properties from the Accounts database in
  strict read-only mode and redacts every string/binary value. Synthetic
  decoding/redaction and syntax/help checks pass.

## 2026-08-03 — macOS Cached CardDAV Capabilities Are Writable

- The sanitized Accounts archive proves Housevo's Personal address book is
  cached with aggregate `write`, `bind`, `unbind`, the CardDAV address-book
  resource type, and all three implemented reports. The absence from Default
  Account is not caused by a stale pre-write capability cache.
- iCloud additionally has `read-acl` and writable home-set collection
  management. OpenMailStack does not implement those capabilities and must not
  advertise them as a picker workaround.
- No server or contact data changed. The next test needs explicit approval: a
  Contacts-framework create targeted to Housevo, immediately deleted, with
  CardDAV logs correlated to the result.

## 2026-08-03 — macOS Targeted Housevo Write Probe

- Added `scripts/diagnostics/macos_contacts_targeted_write.swift` after the
  user approved a transient contact mutation. It explicitly targets the one
  Housevo CardDAV container, verifies the random marker's destination, and
  deletes only that marker after a bounded sync wait.
- Failure handling retries exact-marker cleanup once and prints the unique
  manual-removal name if anything remains. Errors omit raw Contacts userInfo.
- Static diff validation passes. The physical macOS 26.5.2 run and correlated
  live CardDAV PUT/DELETE logs remain pending; no server or contact data was
  changed while preparing the probe.

## 2026-08-03 — macOS Housevo Write Passed And Aggregate Claim Removed

- Physical macOS 26.5.2 explicitly created one random contact in Housevo and
  deleted it. Live logs recorded the matching CardDAV PUT/DELETE; storage has
  zero active rows plus one tombstone for the exact UID, with no warnings or
  backend restarts.
- Commit `35d29345` removes the falsified aggregate `DAV:write` compatibility
  claim while retaining `bind`/`unbind`, contact `write-content`, owner, and
  implemented reports. The public smoke now rejects aggregate write.
- Backend 252/255 with three skips, frontend 84/84 plus lint/build, integration
  and shell checks, guarded public mail gates, public CardDAV lifecycle,
  staging smoke, exact live artifact hash, readiness, and service health pass.
  Rollback is
  `/var/backups/openmailstack/protocol-guarded-webmail-20260803T230149Z/`.
- The remaining Default Account omission is isolated to the macOS picker; do
  not broaden DAV rights or edit private Apple account databases.

## 2026-08-03 — Production Dependency Audit Drift Detected

- Post-release production-only npm audits report one low/two high frontend and
  four high backend findings across DOMPurify, React Router, Socket.IO parser,
  `ip-address`, and MailParser/linkify. The older zero-vulnerability audit is
  no longer current.
- No dependency file changed in the CardDAV release. Remediation is the next
  security task and must preserve Node 20 compatibility, assess React Router
  RSC reachability, and pass clean production audits plus full release gates.

## 2026-08-03 — Compatible Dependency Advisories Patched

- Raised DOMPurify to 3.4.13, React Router to the latest Node-20-compatible
  7.18.2, MailParser to 3.9.14, and resolved patched Socket.IO parser,
  `ip-address`, linkify, PostCSS, and brace-expansion transitive releases.
- Backend production/full audits are clean. Frontend production/full audits
  report only React Router GHSA-qwww-vcr4-c8h2; upstream says the issue affects
  only unstable RSC APIs, and 8.3.0 requires Node 22.22 plus React 19.2.7.
- `dependency_security_guard.cjs` enforces patched floors, exact React Router
  pinning, strict release versions, absence of RSC dependencies/server build
  inputs/APIs/action headers, and is wired into the full integration suite.
- Node 20.19.2 backend tests (252 pass, 3 gated skips), frontend tests (84
  pass), lint, build, and integration checks pass. Commit `0236f008` is live;
  public IMAPS/ActiveSync passed before and after deployment, staging and the
  Socket.IO handshake pass, the live backend audit is clean, repository/live
  dependency and frontend artifacts match, and `NRestarts=0`. Rollback is
  `/var/backups/openmailstack/protocol-guarded-webmail-20260803T232855Z/`.

## 2026-08-03 — Physical ActiveSync Mail Gate Closed

- Reconciled the older partial-catch-up status with the later July 29
  exhaustion, stable no-change polling, and exact saved-UID reconciliation
  proof already recorded in the engineering worklog.
- A fresh read-only assertion against the newest iOS partnership reports 6,243
  saved Inbox identities, `minimum_uid=1`, nonzero SyncKey and MODSEQ, zero
  pending commands, and `MoreAvailable=false`. Public EAS `OPTIONS` returns
  200; the backend is active with `NRestarts=0`.
- The owner confirmed macOS Mail, iOS IMAP, and iOS Exchange all render and
  synchronize correctly; the only later mail issue was Sieve filtering. This
  closes both the catch-up/no-change and MIME body-display gates without any
  mailbox mutation. Exact identity reconciliation remains the regression
  rule.

## 2026-08-03 — Mozilla Mail Autoconfiguration Deployed

- Added the Thunderbird provider and domain well-known discovery routes with
  full-address usernames, IMAP 993 SSL, and SMTP 587 STARTTLS. The query email
  address is not reflected into the public XML.
- Fresh and legacy Nginx paths proxy both endpoints, certificate-host
  enumeration includes `autoconfig.<FIRST_DOMAIN>` even without Scheduler, and
  staging smoke validates the secure settings.
- Commit `63683df8` passed backend 254/257 with three environment skips,
  frontend 84/84, full integration, installer dry-run, and guarded public
  IMAPS/ActiveSync checks before and after deployment. Live artifacts match,
  the service has `NRestarts=0`, and rollback is
  `/var/backups/openmailstack/protocol-guarded-webmail-20260803T235205Z/`.
- Public completion remains blocked on an external prerequisite:
  `autoconfig.housevo.us` has no DNS record and is absent from the active
  certificate. Add both, then repeat Thunderbird desktop and Android automatic
  account setup before closing one-step discovery.

## 2026-08-03 — Mozilla Autoconfiguration Public Client Gate Closed

- Added public `autoconfig.housevo.us` DNS by CNAME to `mail.housevo.us` and
  expanded the existing Let's Encrypt certificate to cover `autoconfig`,
  `autodiscover`, `mail`, and `webmail`; strict hostname verification passes and
  the certificate expires 2026-11-01. The pre-change certificate and Nginx
  vhost are preserved at
  `/var/backups/openmailstack/autoconfig-cert-20260803T2359Z/`.
- Thunderbird 140.12.0esr on Debian 13 found the provider configuration,
  selected full-address usernames with IMAP 993 SSL/TLS and SMTP 587 STARTTLS,
  authenticated, and displayed `Account successfully created` in an isolated
  profile.
- Official stable Thunderbird Android 21.1 matched its published SHA-256,
  displayed the same expanded discovered settings on Android 11, authenticated,
  and reached Inbox. Optional Contacts access was skipped and no mail was sent
  or changed.
- Public Nginx access evidence records successful provider requests from the
  desktop Thunderbird user agent and Android `okhttp/5.3.2`. The mandatory
  protocol release gate and full staging smoke pass after certificate reload.
- The disposable Linux user/home, desktop profile, Android AVD, APK,
  screenshots, and cached canary credential were removed. The reusable Android
  SDK remains without account state. Next: harden the bounded raw ManageSieve
  response parser.

## 2026-08-03 — ManageSieve Response Framing Hardened

- Commits `b3494c08` and `9b421e5` replace string/chunk response heuristics
  with byte-framed parsing that consumes exact UTF-8 literal lengths before
  recognizing complete CRLF terminal status lines.
- Pending commands now reject on mid-response EOF/close. Inbound literals are
  capped at 10 MiB and response overhead is bounded; focused regressions cover
  chunked literals, status-like script lines, split status lines, lifecycle,
  EOF, and oversized declarations.
- Backend tests pass 258/261 with three documented gated skips, frontend tests
  pass 84/84 through the integration suite, and both final review axes pass.
- The guarded deployment passed public IMAPS and ActiveSync before and after
  installation. Staging smoke, exact repository/live artifact hash, readiness,
  service health, zero restarts, and a clean warning journal pass. Rollback is
  `/var/backups/openmailstack/protocol-guarded-webmail-20260804T014236Z/`.
- Three delegated read-only live `GETSCRIPT webmail` calls each returned 84,349
  bytes without printing content or changing filter/mailbox state. Next:
  implement direct clipboard-image paste in Notes through the existing image
  upload path.

## 2026-08-04 — Notes Clipboard Image Paste

- Added image-only clipboard interception to the live Notes editor, reusing
  `/api/notes/upload` and the existing PNG/JPEG/GIF/WebP 5 MiB boundary instead
  of allowing Quill to persist base64 image data.
- Preserved native rich paste for real text/caption content, including the
  common browser case where a copied image provides both a file and an
  image-only `text/html` representation.
- Anchored asynchronous insertion with Yjs relative positions, preserved a
  user-moved caret, aborted stale work on editor teardown, and added polite or
  assertive status feedback for upload, success, partial failure, and error.
- Reflowed the mobile note header so reminder/save/close controls remain
  visible and bounded the reminder popover to 16 px viewport insets at 320 px.
- Focused tests pass 6/6; frontend tests pass 90/90; lint, production build,
  integration, `git diff --check`, and final Spec/Standards reviews pass.
  Fixture-only Playwright passed desktop, standard mobile, and 320 px geometry
  checks without production persistence.
- Commit `0a85b4d` was deployed through the mandatory guarded webmail path.
  Public IMAPS and ActiveSync passed before/after, exact live frontend content,
  readiness, zero restarts, clean warnings, Nginx, and staging smoke pass.
  Rollback is
  `/var/backups/openmailstack/protocol-guarded-webmail-20260804T022450Z/`.

## 2026-08-04 — Notes Authenticated Live Collaboration

- Commits `7dcfae3`, `ef69a53`, and `2b3a68b` add an operator-controlled,
  self-hosted Notes collaboration foundation: same-origin WebSocket signaling,
  five-minute capabilities bound to owner/session/opaque room, bounded traffic,
  bootstrap leadership, credential refresh, and atomic durable persistence.
- Upgrade installs now inject `/notes-signal` into both marked and legacy Nginx
  vhosts. Unsaved notes do not request a fake collaboration room, and both Notes
  routers return an explicit empty reminder result instead of a normal-flow 404.
- Backend tests pass 266/269 with three documented skips; frontend tests pass
  98/98; lint, build, integration, and final Spec/Standards review pass.
- Live Playwright with two isolated authenticated sessions proved seeded and
  empty-note bootstrap, bidirectional editing, exact reload persistence, status
  feedback, and a clean final browser console. Exact disposable data was removed
  from SQL and IMAP.
- Guarded public IMAPS/ActiveSync checks passed before and after deployment.
  Rollback is
  `/var/backups/openmailstack/protocol-guarded-webmail-20260804T125823Z/`.
- Repository/live runtime content matches by checksum; staging smoke, Nginx,
  readiness, zero restarts, and the warning journal pass.
- Cleanup exposed a separate Notes IMAP race: rapid save/close/delete produced
  duplicate messages and a SQL re-import. The stores verify clean; fixing this
  data-integrity defect is the next priority, ahead of cross-account sharing.

## 2026-08-06 — Contact CardDAV Identity Hardening

- Reproduced the primary writer defect with an API-level red test: web-created
  contacts used timestamp/synthetic CardDAV identity, CSV imports stored no
  vCard, and vCard imports could leave `UID` absent in persistent storage.
- Added one UUID identity generator seam. Web, compatibility API, and CSV
  creation persist that UUID in both `dav_uid` and vCard `UID`; vCard imports
  preserve a supplied `UID` while using an independent UUID href, or persist a
  generated UID when absent.
- Kept CardDAV href semantics strict: the same href updates one row; a new href
  remains a create. No name/email auto-merge and no automatic legacy re-key were
  added.
- Duplicate scans now rank UUID-backed contacts first so the existing merge
  operation preserves the durable identity, combines legacy fields, and
  tombstones the old href.
- Focused red-to-green route/storage coverage passes 7/7. The complete backend
  suite passes 273/276 with three documented environment-gated skips, and the
  repository integration run including 98/98 frontend tests passes. Production
  data was not changed during local validation; physical macOS confirmation
  remained after that phase.
- Commit `b575a57` was deployed on 2026-08-07 through the guarded webmail path.
  Public IMAPS/ActiveSync passed before and after installation. Repository and
  live backend artifacts match; local/public auth return `401`; the service is
  active with zero restarts; Nginx, the warning journal, and complete staging
  smoke pass. Rollback is
  `/var/backups/openmailstack/protocol-guarded-webmail-20260807T224814Z/`.
  No real contact was merged or edited during the release.

## 2026-08-15 — Notes IMAP Idempotency And Race Hardening

- Used the explicitly approved fake SQL/IMAP regression seam to reproduce
  concurrent double append, delete/reconcile resurrection, false deletion past
  the newest 25 messages, stale import acknowledgement, duplicate OMS
  Message-IDs, failed replacement deletion, and accepted-but-uncertain append.
- Added complete Notes mailbox identity enumeration, deterministic OMS
  Message-ID convergence, exact revision acknowledgements, and no-op handling
  for unchanged saves.
- Serialized each owner across requests and backend processes with a dedicated
  MySQL named lock while retaining independent progress for different owners.
- Missing-IMAP deletion now conditionally matches owner, SQL/IMAP revisions,
  UID, and live state before soft deletion or dependent cleanup. Delete and
  export acknowledgements cannot mark a concurrently restored or edited
  revision as synchronized.
- Added 12 deterministic Notes synchronization regressions plus an exact
  generated-runtime parity check. Focused tests pass 21/21; backend passes
  287/290 with three documented skips; frontend 98/98 and integration pass;
  independent Spec and Standards reviews report no findings.
- Deployed commit `bfbe1d7` through the mandatory guarded path. Public IMAPS
  and ActiveSync passed before and after installation; repository/live Notes
  artifacts, staging, readiness, Nginx, and zero-restart checks pass. Rollback:
  `/var/backups/openmailstack/protocol-guarded-webmail-20260815T085248Z/`.
  No real Notes data was used; physical macOS confirmation remains.

## 2026-08-15 — Truthful Updates And Paired Web Release Recovery

- Disabled browser/root automatic upgrades and replaced fabricated remote
  update status with strict deployed-`VERSION` reporting plus a manual policy
  in both Admin surfaces. Missing or malformed installed version returns an
  error instead of suggesting an update.
- Permanently retired the passwordless web-to-root bridge. Installer/Admin
  paths remove it before fallible setup, while the compatibility upgrade script
  exits without changing files, packages, repositories, or services.
- Made guarded webmail release one globally locked, reversible transaction for
  both the modern app and full legacy Admin Portal. Restore validates snapshot
  identity/content, captures the current pair first, and uses explicit
  `20`/`30`/`31` recovery states for failure and interruption.
- Added path/ownership/symlink/lock/version/state-machine regressions, including
  malicious nested parents, dangling lock symlinks, concurrent locks, partial
  apply, failed recovery, HUP/INT/TERM, invalid versions, and paired content.
- A first live attempt exposed a real systemd-active/listener-not-ready race.
  Recovery restored the old pair and a subsequent public gate passed. Added a
  proxy-disabled bounded readiness retry shared by deploy and recovery, with
  success/exhaustion behavior tests; both review axes then passed again.
- Commits `a808b8d` and `8e8e864` deployed successfully. Backend passes
  289/292 with three gated skips; frontend 99/99; lint, build, integration,
  ShellCheck, PHP lint, and diff checks pass. Public IMAPS/ActiveSync passed
  around deployment and both legs of a live previous-pair/new-pair restore.
  Current rollback:
  `/var/backups/openmailstack/protocol-guarded-webmail-20260815T103128Z/`.
  Verified new-pair restore point:
  `/var/backups/openmailstack/protocol-guarded-webmail-20260815T103335Z/`.

## 2026-08-15 — Runtime Mail Privacy And Honest Controls

- Mail now hydrates user Mail settings and send-as identities at runtime with
  independent safe fallback and normalization for typed or legacy aliases.
- Compose From is always derived from an authorized current identity and falls
  back to the configured valid default or primary address after revocation.
- Message HTML remains DOMPurify-sanitized and now strips external image,
  srcset, and CSS URL fetch targets for Ask. Per-message consent loads them;
  Trusted loads only for an exact mailbox in safe senders; embedded/local
  content remains.
- Mark-read honors the stored delay and cancels pending work on navigation.
- Removed unimplemented conversation, forwarding/auto-responder, mute-thread,
  and new-compose Send and Archive controls. Inline reply Send and Archive is
  retained.
- The final focused privacy/Undo/scheduled-state file passes 11/11. The complete
  frontend suite passes 143/143; lint, production build, and the 176/176
  Chromium/WebKit desktop/mobile fixture matrix pass.

## 2026-08-15 — Five-Cycle Suite Hardening Closeout

- Commit `869bb27b` hardens web Notes/Draft save serialization, complete Draft
  resume, scheduled Cancel/Undo restoration, Bcc-preserving Sent copies,
  partial-recipient truth, private uploads, same-origin browser boundaries,
  free/busy authorization/cancellation, mail privacy, mobile cache identity,
  keyboard behavior, honest feature surfaces, and accessibility/focus.
- Commit `e33c6df6` replaces the minimal backup helper with a fail-closed,
  root-only, checksummed, explicitly inventoried restore transaction. Restore
  stays quiesced through validation and uses a verified safety snapshot to
  recover files, logical database state, and exact prior service activity.
- Final permitted validation is green: backend 690/694 with four documented
  skips and zero failures; frontend 143/143; browser 176/176; builds, lint,
  audits, full integration, ShellCheck, generated-runtime parity, and diff
  checks pass. The destructive opt-in scheduled-send database test was not run.
- The latest guarded rollout remains rolled back because production contains an
  exact duplicate calendar tombstone pair. No production row was changed;
  separate approval is required for the narrow repair.
- Release remains NO-GO: immediate web and ActiveSync send accept SMTP before a
  durable replay record exists. Next work is a universal idempotent outbox with
  disposable MariaDB migration/concurrency proof, then guarded live and physical
  client validation. See `docs/engineering/RELEASE_READINESS_2026-08-15.md`.

## 2026-08-15 — Cycles 6-8 Universal Outbox And Qualification

- Replaced direct web and ActiveSync SMTP ownership with one durable outbox on
  `scheduled_emails`. Complete transport/Sent MIME, envelope, stable Message-ID,
  owner-scoped idempotency key, request fingerprint, and crash state are
  committed before SMTP; same-key replay cannot resend.
- Added strict scheduled and immediate key contracts, owner-scoped status by ID
  or key, partial/uncertain truth, safe SMTP response classification,
  claim-on-demand workers, UTC-safe outbox timestamps, terminal immediate
  payload scrubbing, and soft scheduled removal that preserves dedupe state.
- Added browser IndexedDB coordination for concurrent tabs and reload recovery,
  privacy-safe digests, cross-mode replay protection, no-store status polling,
  and explicit verified-non-delivery resolution before a new attempt can exist.
- Corrected and enabled strict ActiveSync SendMail with official ComposeMail
  tokens, owner/DeviceId/ClientId scope, owned From authorization,
  SaveInSentItems semantics, and transport-only Bcc/Resent-Bcc stripping.
  SmartReply/SmartForward remain fail-closed.
- Verified backend 724/729 with five documented skips, frontend 175/175 plus
  lint/build, complete integration, generated-runtime parity, independent
  focused review, a 240/240 Chromium/WebKit desktop/mobile matrix, and an
  isolated MariaDB 11.8.6 migration/concurrency/crash/
  UTC/privacy matrix. No production data was mutated and the disposable
  schema/user were removed.
- Release remains NO-GO because the installed automatic rollback target is not
  compatible with rows and keyed retries created by the new runtime. The
  duplicate production calendar tombstone, physical iOS SendMail retry,
  physical macOS Notes lifecycle, clean-host recovery drill, and bounded
  outbox-metadata retention policy remain open.

## 2026-08-16 — Cycle 9 Rollback-Compatible Outbound Bridge

- Added strict bridge/active modes and made bridge a total outbound quarantine:
  zero new submission persistence/delivery, zero worker DB claim/lease work,
  and no scheduled cancellation/removal mutation; status reads remain.
- Guarded webmail deployment is now bridge-first. Active requires an exact
  attested bridge; first-legacy recovery is bound to one recorded snapshot;
  later recovery validates the exact compatible mode.
- Root-owned/non-writable runtime and ancestry, root-only environment and
  marker, safe internal-only symlinks, read-only schema/row preflight, and
  bridge-first operator documentation close the rollback substitution paths.
- Proved active durable-row reservation followed by same-key bridge retry and
  worker cycle leaves the row byte-for-byte unchanged with zero delivery side
  effects. Backend is 732/737 with five skips and zero failures; focused,
  disposable MariaDB, integration, restore/release, ShellCheck, and independent
  Spec/Standards fixed-point reviews are green.
- No live deploy or database mutation occurred. Exact approved calendar repair,
  guarded bridge/active/rollback, physical Apple clients, EAS HTTP integration,
  clean-host recovery, ordering, and bounded retention remain open.

## 2026-08-16 — Cycles 10-12 Release Blocker Closure

- Created and verified root-only backup
  `/var/backups/openmailstack/oms-backup-20260816T181350Z`, then executed only
  the approval-pinned calendar repair: archive 22/23, retain 23, remove 22,
  preserve token 1440, and leave zero duplicate groups/live-event matches.
- Guarded-deployed total-quarantine `webmail-bridge`, activated only from that
  attested bridge, and repeated bridge/active for the Ping hotfix. Runtime and
  environment trust, readiness, zero restarts, empty outbox, approval absence,
  and public protocol cleanup passed.
- Fixed Sync-to-ItemOperations opaque identity resolution and made CardDAV/
  CalDAV release assertions semantic, exact-resource-bound, and alias-safe.
- Added a privacy-minimal replay registry, bounded 7/90/120/400-day policy,
  fail-closed compaction opt-in, global mixed-time-basis ordering, and a real
  ActiveSync SendMail HTTP/MariaDB/SMTP/Sent-copy integration. These integrated
  `main` additions are locally verified and newer than the active runtime;
  compaction remains disabled.
- Completed a fresh Debian 13.6 backup/verify/restore/injected-rollback drill.
  Full mutating install, production-scale off-host restore, DNS/TLS, and mail
  flow remain separate recovery evidence.
- Implemented bounded ActiveSync Ping for Email/Contacts/Calendar. A poll-at-
  deadline race and the smoke client's independent 300-second Undici header
  timeout were reproduced and fixed. The final public gate returned Status 1
  after 900.080 seconds with zero canary residue.
- Integrated at `e5b25f74`; backend passes 779/786 with seven opt-in skips,
  frontend 175/175 plus lint/build, four disposable MariaDB proofs, and the
  complete integration suite. Final Spec review found no code blocker.
- Remaining release gates require separate user/device/operator evidence:
  authorized production durable-row rollback, physical iOS SendMail and Direct
  Push matrix, physical macOS CardDAV identity edit/merge and Notes lifecycle,
  and full off-host recovery. Do not infer those from scripted success.

## 2026-08-17 — Cycle 13 Production Rollback Canary

- Fixed the backup/restore post-start listener race with a bounded 15-check
  readiness loop. TDD reproduced the `.incomplete` non-promotion after three
  transient failures, then proved promotion; sustained failure still triggers
  verified safety rollback.
- Promoted fully validated root-only backup
  `/var/backups/openmailstack/oms-backup-20260817T215021Z` after its first
  creation correctly failed closed on the six-second backend listener delay.
- With exact user approval, inserted inert immediate row ID 2, proved its
  canonical 30-column digest unchanged through active-to-bridge and zero exact
  delivery evidence, deleted exactly one fully matched row under bridge, and
  restored the captured active preimage.
- Final active runtime/environment attestation, readiness, six zero-restart
  services, zero outbox/canary/log/queue residue, and the explicit
  Ping-required public IMAPS/ActiveSync suite passed. Root-only evidence is at
  `/var/backups/openmailstack/outbound-rollback-canary-20260817T213124Z-1fc49e9b2c64`.
- Newly exposed operator blocker: production-size full backup holds services
  quiesced while copying and repeatedly hashing the mail tree. Preserve the
  fail-closed snapshot contract but move immutable finalization/verification
  after service resume and measure the reduced outage.

## 2026-08-17 — Cycle 14 Physical iPad Settings Repair

- Correlated one physical iPad Exchange send across ActiveSync, the durable
  outbox, Postfix, Gmail acceptance, server Sent, device Sync state, and the
  follow-up account error. Delivery and the single Sent copy were complete;
  the iPad Sent checkpoint was stale.
- Reproduced the account-error boundary as six 20-byte
  `Settings/Oof/Get/BodyType` requests receiving HTTP 501. Added a strict,
  read-only Settings response that truthfully reports OOF disabled and rejects
  every unsupported write/shape with protocol status 2.
- Integrated commit `a172be8` passes 789 backend tests with seven skips and the
  complete integration suite. Surgical release `c9d5606a`, based on the exact
  535-file installed baseline, passes 777 backend tests with five skips,
  frontend 175/175, generated parity, and full integration.
- Guarded bridge then active deployment passed all public protocol gates and
  cleanup. The live runtime matches all 541 release files, has zero restarts or
  warning entries, and an exact public Settings canary returns status 1/1 with
  `OofState=0`.
- Physical closure is limited to refreshing the already delivered item in iPad
  Sent and confirming the account error stays gone. Do not resend; ClientId
  retry remains a separate physical test.

## 2026-08-17 — Cycle 14 Dependency Advisory Hotfix

- Fixed: Pinned transitive `deepmerge-ts` to patched `8.0.0` after the Settings
  rollout exposed newly published `GHSA-ggr8-5vv4-36mx`; added an exact
  dependency-security floor so a future lockfile cannot silently regress.
- Verified: Integrated main passed 789 total / 782 pass / 7 skips / 0 fail and
  complete integration. The surgical release passed 113 focused parser tests,
  777 total / 772 pass / 5 skips / 0 fail, frontend 175/175, lint/build,
  complete integration, and backend/frontend production audits with zero
  findings.
- Deployed: Surgical commit `df88cc8c` passed guarded bridge then active public
  IMAPS and ActiveSync Mail/Ping/Contacts/Calendar gates. Live mode is active,
  541/541 tracked files match, readiness is `401`, `NRestarts=0`, the warning
  journal is empty, and the installed dependency audit is zero.

## 2026-08-18 — Cycle 15 Physical iPad Body Fetch Repair

- Diagnosed the endless iPad message spinner as two different read-only Sync
  Fetches using the immediately previous key. The generic stale-key path
  returned status 3 and restarted full Inbox catch-up after the first body had
  already advanced the key.
- Added a bounded non-mutating previous-key Fetch compatibility seam in main
  `885099fd` and surgical release `4417f3d0`; stale mutations, older keys,
  paging, malformed prior state, and unknown UIDs remain fail-closed.
- Verified focused backend 49/49, complete bounded-concurrency backend, frontend
  175/175, lint/build, zero production audit findings, generated parity, and
  complete repository integration.
- Guarded bridge and active deployments passed all public protocol pre/post
  gates. Live service/worker are active, readiness is `401`, `NRestarts=0`, and
  changed deployed artifacts match the release byte-for-byte. A real iPad
  Exchange message body then rendered normally.

## 2026-08-22 — Webmail Folder And Message Context Menus

- Added one shared accessible context-menu primitive for mail folders and
  messages, opened by right click, `Shift+F10`/Context Menu key, and a visible
  folder actions button without changing normal left-click navigation.
- Added top-level New folder plus New subfolder beneath existing selectable
  folders. Added Move and confirmation-gated Delete for custom folders while
  hiding both commands for INBOX and special-use/system folders. Moves preserve
  the leaf name, support return to Top level, and reject self/descendant moves;
  delete rejects folders that still contain children.
- Reused existing folder-qualified message operations for Open, read/unread,
  star/unstar, archive, snooze, and delete, and added Move to and Mark as spam;
  Draft, Junk, and virtual Scheduled rows expose only operations their backing
  models actually support. Move destinations exclude the active folder with
  case-insensitive INBOX identity.
- Added authenticated create/move/delete folder routes and delimiter-aware IMAP
  operations with bounded errors and protected-folder checks. Verified 804
  backend passes / 7 documented skips (811 total), frontend 184/184, focused
  backend 39/39, focused frontend 20/20, ESLint, production build, diff checks,
  and the complete repository integration suite.
- Guarded bridge and active webmail deployments passed their public IMAPS and
  ActiveSync mail/Ping/contacts/calendar gates. A dedicated API/public-IMAPS
  canary created a top-level folder and child, moved the child to Top level,
  proved each hierarchy state, and deleted both exactly. Deployed Chromium
  created two top-level folders, moved one below the other and back to Top
  level, displayed the permanent-delete warning, and deleted both. A disposable
  message's right-click menu moved it to Archive and then marked it as spam into
  Junk; an exact Message-ID cleanup removed it. A final deployed regression
  proved lowercase `/mail/inbox` does not offer INBOX as its own move target.
- The cleanup first reproduced a pre-existing Dovecot 2.4 migration failure:
  the retained empty 2.3 `dict quota {}` sample was parsed as an unsupported
  dictionary driver named `quota`, causing mailbox DELETE to return an internal
  error. Added a narrow idempotent migration helper and regression that remove
  only empty/comment-only blocks and preserve configured dictionaries.
- Guarded Dovecot deployment passed pre/post public protocol gates. Effective
  quota dictionary blocks and post-deploy dictionary errors are zero; services
  are active with zero restart counters, web/backend artifacts have zero drift,
  and the exact empty canary deletion probe is green. The final webmail rollback
  snapshots are `protocol-guarded-webmail-20260823T001723Z` and
  `protocol-guarded-webmail-20260823T002451Z`.
- Review hardening now reserves top-level `SCHEDULED`, protects every mailbox
  carrying an RFC special-use flag, uses the designated Junk mailbox, rejects
  malformed parents/message moves, preserves LSUB state, blocks rule/snooze
  references, and atomically resets the folder-keyed search index. The folder
  tree preserves flat namespaces and prototype-like names; dialogs are portaled
  and viewport-bounded; touch actions stay visible; internal context-menu scroll
  no longer dismisses the menu; and message rows no longer nest controls inside
  an interactive row.
- Final live proof used only the dedicated protocol canary. API/public IMAPS
  create/move/delete preserved the new subscription and removed old/deleted LSUB
  entries with zero exact residue. Deployed Chromium proved the sibling-control
  accessibility tree, scrollable 900x220 menu, folder Move/Delete warning and
  viewport-wide portal, then moved one exact message to Archive and marked it as
  spam into the server-designated Junk folder. Exact folder, subscription,
  message, auth-state, and browser-session cleanup passed.
- Residual, pre-existing and not changed here: `/api/account/sessions` derives
  current-session identity from `req.cookies`, but this backend authenticates by
  parsing the raw Cookie header and does not initialize `req.cookies`. A fresh
  canary session therefore appeared non-current and could revoke itself. Exact
  transaction-bounded canary-session cleanup reached zero rows; repairing that
  account-security route is the recommended next task.
- Browser form-fill tooling echoed the dedicated protocol-canary password in
  local command output. It was rotated immediately, the root-only credential
  file was updated atomically, and HTTPS login, public IMAPS, and canary
  provisioning verification passed. Subsequent browser authentication used an
  ephemeral mode-0600 storage state, deleted immediately after loading; no
  human credential was involved.

## 2026-08-22 — Context Menu Live Reverification And Publication

- The public HTML, deployed web root, and current build already matched before
  redeployment, and the served mail chunk already contained every new folder and
  message command. HTML and assets were `no-store`, with no frontend service
  worker. Treat an already-open SPA tab or a protected system folder as the
  first distinction to test when these commands appear missing: Move/Delete are
  intentionally available only on custom folders.
- Repeated guarded bridge and active deployments passed authenticated public
  IMAPS and ActiveSync Mail/Ping/Contacts/Calendar pre/post gates. The current
  rollbacks are `protocol-guarded-webmail-20260823T022129Z` and
  `protocol-guarded-webmail-20260823T022910Z`.
- Fresh public Chromium created a top-level custom folder, exposed and opened
  its Move flow, showed and accepted its permanent Delete warning, and exposed
  Move to/Mark as spam on an exact disposable Inbox message. Authenticated
  browser console output was clean. LIST/LSUB, Message-ID, search-index, session,
  auth-state, browser, and pending-gate residue all ended at zero.

## 2026-08-22 — Account Session Identity And Safe Revocation

- Reproduced the residual live with one canary session: the sessions API marked
  zero rows current, accepted deletion of that session, and the same cookie then
  returned `401`. Root cause was account routes reading unpopulated
  `req.cookies` while `requireSession` already carried the authenticated opaque
  token in `req.user.sessionId`; the same mismatch affected 2FA session retention.
- Exported the canonical auth hash helper and used it for session listing,
  revocation, and 2FA confirmation. Session deletion now accepts exactly eight
  hexadecimal digest-prefix characters before the owner-scoped SQL prefix
  match, preventing wildcard or malformed selectors from reaching the query.
- Added a real Express/authentication regression using an actual Cookie header.
  It locks current-session marking, non-disclosure of the raw token, continued
  authentication after rejected self-revoke, other-session revocation, bounded
  selector validation, and current-session retention during 2FA confirmation.
- Complete backend verification passed 809/816 with seven documented skips;
  the complete integration suite, production builds, dependency audits, and
  fixed-point Spec/Standards review are green.
- Guarded bridge and active deployment passed public IMAPS and ActiveSync
  Mail/Ping/Contacts/Calendar gates. Rollbacks are
  `protocol-guarded-webmail-20260823T033609Z` and
  `protocol-guarded-webmail-20260823T034320Z`. A live two-session canary marked
  exactly one current, revoked only the other, rejected self/wildcard deletion
  while preserving current authentication, logged out both, and left zero
  canary session rows. Active service health, readiness, journals, and exact
  source/deployed artifact hashes are clean.

## 2026-08-23 — Production Backup Availability Split

- Changed managed full backups to keep services quiesced only through the
  logical database dump and immutable inventory copy, then restore the exact
  prior service state and pass bounded health before metadata, checksums, final
  validation, and atomic promotion. Continuously quiesced restore safety
  snapshots retain their original contract.
- Added strict capture provenance plus command-level and health-inclusive timing
  metadata. Legacy format-1 snapshots with all timing fields absent still
  verify; blank, duplicate, partial, non-numeric, extra-field, and contradictory
  new metadata fails closed.
- Added public-CLI regression coverage for capture/resume/health/hash ordering,
  post-recovery finalization failure, delayed health timing, legacy
  compatibility, malformed metadata, exact service recovery, and externally
  managed restore safety snapshots.
- Verified the focused backup/restore fixture, Bash syntax, ShellCheck,
  whitespace, and the complete repository integration suite; frontend remained
  184/184. Fixed-point Standards and Spec re-reviews found no remaining code or
  scope issue.
- Promoted and independently verified root-only 13 GB production snapshot
  `/var/backups/openmailstack/oms-backup-20260823T072524Z`. It records
  1,073,924 ms through service resume and 1,076,910 ms through bounded health.
  Systemd journals show the comparable Cycle 13 stop/start window was about
  55m 15s, so availability improved by about 37m 18s, or 67.5%. All seven
  primary services recovered active/running with `NRestarts=0`; local/public
  readiness is `401` and the Postfix queue is empty.
- Remaining risk: the consistency-critical full database/mail-tree copy still
  causes a 17m 56.910s outage. A storage-native snapshot or carefully bounded
  pre-copy design is the next backup-availability task.

## 2026-08-23 — Production Backup Live Pre-copy

- Seeded `/var/vmail` while services remain active, then limited quiescence to
  watcher drain, logical database/inventory capture, and stopped mail-store
  convergence. Changed ctimes, mutable Maildir paths, directory moves,
  path/inode mismatches, and hardlink expansion are forced through the stopped
  pass; vanished files are tolerated only by the mutable live seed.
- Added a raw recursive inotify watcher with a protected control directory and
  content-authenticated sentinel barrier. Queue overflow, watch loss, unmount,
  malformed/error output, or loss of process identity fails closed. Launch and
  readiness both bind PID plus Linux start time; production uses exact pidfd
  signaling and the older Python/kernel fallback rechecks `/proc` immediately
  before signaling.
- Added Python 3 installation coverage plus focused watcher and backup
  regressions for real queue overflow, drain ordering, SIGSTOP-before-ready
  cleanup, stale identity, pre-pidfd fallback, concurrent mutation, directory
  swaps, hardlinks, same-size/same-mtime changes, special objects, and live-only
  `rsync` status 24.
- Bash syntax, ShellCheck, whitespace, Python 3.6 grammar, the focused watcher
  and backup suites, real-watcher integration, and the complete repository
  integration suite passed; frontend remained 184/184. Independent Standards
  and Spec reviews reported no Blocker or High finding. Their only residual is
  the narrow process-identity race on pre-pidfd runtimes.
- Promoted root-owned mode-0700 13 GB production snapshot
  `/var/backups/openmailstack/oms-backup-20260823T192653Z`, then independently
  verified it through the public CLI. The roughly 12.5-minute live seed ran
  online; quiescence was 217,564 ms and health-inclusive outage was 220,406 ms,
  856,504 ms or 79.5% below the 1,076,910 ms Cycle 16 baseline. All seven
  services recovered active/running with `NRestarts=0`, readiness is `401`, the
  queue is empty, the lock is free, and no watcher/control residue remains.
- Two safely aborted 2026-08-23 staging candidates were retained along with all
  prior snapshots; nothing was deleted. Remaining risk is the planned
  3m 40.406s outage plus no encryption, point-in-time recovery, or realistically
  sized off-host restore proof.

## 2026-08-23 — Selective Existing-mail Rule Runs

- Added a current 39-source first-party Outlook migration contract across Mail,
  Calendar, People, Notes-adjacent workflows, and Bookings/Scheduler, with
  explicit P0/P1/P2 tranches and no blanket parity claim.
- Added selected-rule execution to the existing Preview/Apply runner. Batch Run
  rules defaults to all enabled saved rules, each saved row has a one-rule Run
  now path, disabled rules remain visible, and selected rules execute in saved
  order through pagination and retry.
- Bound Apply to the full saved document plus canonical selected-rule snapshot;
  rejected malformed, empty, duplicate, unknown, disabled, and changed
  selections before mailbox mutation. Preserved omitted-ID compatibility,
  ID-less legacy rules, independently selectable duplicate-name legacy rules,
  201-rule selection, UIDVALIDITY/UID-ceiling binding, and the durable Move copy
  ledger.
- Verified 13/13 focused backend routes, 3/3 focused frontend contracts, 823
  complete backend tests (816 pass, seven optional skips), 185/185 frontend
  tests, lint/build, desktop/mobile Playwright, and the complete repository
  integration gate. Standards and Spec re-review found no residual issue after
  legacy collision and large-selection hardening.
- Guarded bridge and active deployments passed public IMAPS and ActiveSync
  Mail/Ping/Contacts/Calendar gates. Rollbacks are
  `protocol-guarded-webmail-20260823T225629Z` and
  `protocol-guarded-webmail-20260823T230408Z`. Active mode is healthy with zero
  restarts, empty warning journal, expected local/public `401`, exact backend
  and frontend artifacts, and a zero-console-error public-browser fixture.
- Remaining rules gaps are explicit: Include subfolders, All/Unread/Read scope,
  and the broader existing-mail action vocabulary are not shipped in this
  tranche.

## 2026-08-24 — Mail Filter Duplicate Hygiene

- Added current-draft duplicate analysis without mailbox or ManageSieve access.
  Later exact same-rule conditions/actions are safe cleanup; cross-rule repeats
  and nested `contains` patterns remain advisory.
- Added inline duplicate hints, a focus-managed responsive review dialog,
  conservative client-side revalidation, unsaved cleanup, and Undo.
- Preserved Sieve ASCII comparison semantics and exact folder paths. Analysis is
  limited to 1,000 rules/10,000 items, 4,096 characters per value, and
  1,000,000 analyzed characters; occurrence output and overlap count/character
  work are bounded without omitting verified exact removals. Nested `contains`
  review covers patterns within and across rules.
- Locally verified 7/7 focused backend tests, 5/5 focused frontend tests, 830
  complete backend tests (823 pass, seven optional skips), 187/187 frontend
  tests, lint/build, complete integration, and zero-error desktop/mobile/light
  Chromium. A 180-rule, 900-item, 360-finding browser stress case kept the
  footer visible, had no horizontal overflow, and cleanup/Undo sent zero Save
  requests. Light feedback contrast measured 7.09:1 warning and 5.48:1 success.
- Fixed-point Standards and Spec review found no residual issue. Commit
  `5598534c` then passed guarded bridge and active public IMAPS plus ActiveSync
  Mail/Ping/Contacts/Calendar pre/post gates. Rollbacks are
  `protocol-guarded-webmail-20260824T170058Z` and
  `protocol-guarded-webmail-20260824T170835Z`.
- Active service health, readiness, Nginx, warning journals, and exact
  repository/live backend-version/content plus frontend artifacts are clean. A
  fresh public-browser fixture loaded the released assets, rendered the review
  flow without overflow or console errors, removed two exact draft copies, and
  restored both with Undo while issuing zero Save requests.
