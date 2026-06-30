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

Future entry template:

```markdown
## YYYY-MM-DD

- Changed:
- Verified:
- Memory updates:
- Follow-up:
```
