# Settings Plan

Last updated: 2026-06-21

## Goal

Turn the current Settings page into a product-grade settings hub for Mail, Calendar, and Contacts while preserving the live mail database and current working mail behavior.

This plan intentionally separates navigation cleanup from persistence and from feature expansion. The first milestone should make the Settings page feel organized without changing backend behavior. The second milestone creates the server-backed settings foundation. Only after that should we build the deeper Mail, Calendar, and Contacts settings.

## Current State

- The active settings UI lives in `webmail-frontend/src/App.tsx`.
- The settings shell now lives in `webmail-frontend/src/settings/SettingsPanel.tsx`, with `webmail-frontend/src/settings/appearance.ts` applying local appearance preferences.
- Frontend settings API calls live in `webmail-frontend/src/settings/settingsApi.ts`.
- The settings sidebar is grouped by Personalization, Mail, Apps, and Account, covering Appearance, Mail, Calendar, Contacts, Sync & Devices, Password, and Advanced.
- Appearance settings are functional and server-backed after authenticated hydration, with browser `localStorage` retained as a compatibility fallback.
- Mail filters are backed by `/api/rules` and persisted through ManageSieve.
- Mail forwarding is backed by `/api/settings/forwarding` and updates the existing `alias.goto` value.
- User identities are read from `/api/user/identities`.
- Signatures and conversation/threading preference are server-backed under `/api/settings/mail` after authenticated hydration, with `oms_signatures` and `oms_threaded` retained as migration/fallback storage.
- Backend settings persistence is additive in `webmail_user_settings`, keyed by `username` and namespace, with validated namespaces for `mail`, `calendar`, `contacts`, and `appearance`.
- Admin branding settings are global and additive in `webmail_branding_settings`, with public `/api/branding` reads and admin-only `/api/admin/branding` writes.
- Admin users have an Admin > Branding panel for app name, company name, login title/subtitle, app icon, favicon, login logo, and login background image.
- Contacts and calendars already have app APIs under `/api/apps/contacts`, `/api/apps/calendars`, and `/api/apps/events`, but their preferences are not exposed in Settings.
- User spam settings are now honest read-only/planned rows until user-level sender lists have server-backed enforcement; admin/global spam policy behavior remains separate.
- `webmail-frontend/src/App.tsx` is still large, but the Settings shell and Settings-specific filter editor are now split out.

## Product Information Architecture

Settings should be organized around user intent, not implementation details.

Primary sections:

- Mail
- Calendar
- Contacts
- Account & Security
- Admin Settings, visible only to users in the `admin` table

Mail settings:

- Identity & Send-As: display name, default From address, aliases, optional reply-to address, default Bcc/self-copy preference.
- Signatures: multiple signatures, per-identity defaults, insert on new mail, insert on replies/forwards, plain-text fallback.
- Compose: default compose mode, default rich-text/plain-text mode, default font, undo-send delay, attachment reminder, default importance, draft auto-save behavior.
- Reading: conversation view, message list density, preview pane position, snippets on/off, external image loading preference, mark-as-read timing.
- Forwarding & Delivery: current forwarding target list, keep-copy behavior, future vacation/autoreply entry point.
- Filters: current Sieve rule editor, rule ordering, enable/disable per rule, validation before save.
- Spam & Sender Lists: blocked senders, safe senders, mark-spam behavior, clear boundary from admin/global spam rules.
- Notifications: browser notifications, sound, unread badge behavior, quiet hours if we later add push-like behavior.

Calendar settings:

- Defaults: default calendar, default view, event duration, default all-day behavior, default event color.
- Time & Work Week: time zone, optional secondary time zone, week starts on, visible days, working hours.
- Reminders: default event reminders, reminder channels, reminder timing for all-day and timed events.
- Invites: default guest permissions, auto-add invites, RSVP behavior, free/busy visibility.
- Sharing & Sync: CalDAV URL/help, calendar export/import, sharing controls when backend support is ready.
- Calendar Sources: holidays, birthdays from contacts, subscribed calendars as future enhancements.

Contacts settings:

- Display: name format, sort order, list density, default contact detail fields.
- Collection: auto-create contacts from sent mail, update existing contacts from sent recipients, blocklist for auto-collection.
- Organization: groups/lists, duplicate detection, merge workflow.
- Import/Export: vCard import/export, CSV import/export, preview before import, conflict handling.
- Sync: CardDAV URL/help, sync status, default address book when multiple address books exist.
- Calendar Linkage: contact birthdays/anniversaries shown on calendar when enabled.

Account & Security settings:

- Change password, wired to a real backend endpoint before it is presented as complete.
- Active sessions and logout-other-sessions once session-management endpoints exist.
- Recovery/admin-only controls should stay out of normal user settings unless explicitly scoped.

Admin settings:

- Branding: app name, company name, favicon, header/app icon, login logo, login title/subtitle, and login background image.
- Domain defaults: default hostname, support/contact links, and future per-domain branding when multi-tenant UX requires it.
- Security policies: session lifetime, allowed auth methods, password policy display, and admin-level session controls once backend endpoints exist.
- System integrations: webmail URL, sync autodiscover status, Rspamd/admin portal links, and health surfaces.
- Admin settings should remain admin-only for writes, while branding reads stay public because the login page needs them before authentication.

## Backend Shape

Use additive changes only. Do not drop, rewrite, or truncate existing mail, alias, calendar, contacts, or session tables.

Initial persistence should be simple and namespaced:

- Add `webmail_user_settings`.
- Key by `username` and `namespace`.
- Store validated JSON in `settings_json`.
- Use namespaces: `mail`, `calendar`, `contacts`, `appearance`, and later `account`.
- Keep existing specialized systems in place: forwarding remains in `alias`, filters remain in Sieve, contacts remain in `contacts`, calendars/events remain in `calendars` and `events`.

Suggested API shape:

- `GET /api/settings/mail`
- `PUT /api/settings/mail`
- `GET /api/settings/calendar`
- `PUT /api/settings/calendar`
- `GET /api/settings/contacts`
- `PUT /api/settings/contacts`
- `GET /api/settings/appearance`
- `PUT /api/settings/appearance`
- `GET /api/branding`
- `GET /api/admin/branding`
- `PUT /api/admin/branding`

Rules:

- All settings endpoints must require the same authenticated session cookie as the rest of webmail.
- Use an allowlist of namespaces; do not accept arbitrary namespace names from clients.
- Validate setting keys and value types on the backend before writing JSON.
- Return defaults merged with saved values so frontend code does not need to guess missing keys.
- Keep using relative `/api/...` URLs in frontend code.
- Do not store passwords, raw tokens, or secrets in settings JSON.
- Do not accept SVG uploads for branding images; allow only safe raster image data URLs with backend size limits.

Technical dependency:

- Before building Calendar and Contacts settings on `/api/apps`, verify the `/api/apps` auth middleware handles the current async session implementation correctly. Do not rely on those routes for new settings work until that is confirmed or fixed.

## Milestone 1: Settings Shell And Navigation

Status: mostly complete as of 2026-06-21. Remaining work is manual QA across more screen sizes and deciding whether the read-only Calendar/Contacts rows should stay in Milestone 1 or move behind server-backed settings.

Purpose: make Settings look and behave like a real suite settings hub without changing persistence or mail behavior.

Work:

- Create a Settings component boundary under `webmail-frontend/src/` so the main `App.tsx` does not absorb every new settings panel.
- Reorganize the settings sidebar into Mail, Calendar, Contacts, and Account & Security.
- Move existing panes under the new structure:
  - General & Signature becomes Mail > Signatures.
  - Mail Forwarding becomes Mail > Forwarding & Delivery.
  - Mail Filters becomes Mail > Filters.
  - Spam Protection becomes Mail > Spam & Sender Lists.
  - Change Password becomes Account & Security > Password.
- Add Calendar and Contacts settings sections with honest placeholder states for preferences that are not implemented yet.
- Keep current `activeTab` behavior stable enough that existing app navigation still works.

Exit criteria before moving on:

- Existing forwarding UI still loads and saves through `/api/settings/forwarding`.
- Existing filter UI still loads and saves through `/api/rules`.
- Existing signatures still work exactly as before, even though they are still local-only in this milestone.
- Existing compose signature insertion still works.
- Calendar and Contacts settings are visible in the Settings UI and clearly separated from Mail.
- Frontend lint/build passes.
- No backend schema changes are made in this milestone.

Verified so far:

- `rtk npm --prefix webmail-frontend run lint` passes.
- `rtk npm --prefix webmail-frontend run build` passes.
- Browser smoke against Vite dev server confirmed Settings navigation, Appearance persistence, migrated Signatures/Forwarding/Filters panes, Sync & Devices rows, and disabled Password state.

## Milestone 2: Server-Backed Settings Foundation

Status: implemented as of 2026-06-21, with authenticated real-account cross-browser persistence still worth manually confirming.

Purpose: make user preferences survive reloads, devices, browsers, and backend restarts.

Work:

- Add the additive `webmail_user_settings` table through the backend startup/migration path used elsewhere in the project.
- Add typed backend defaults for `mail`, `calendar`, and `contacts`.
- Add authenticated GET/PUT routes for each settings namespace.
- Add a frontend settings API helper.
- Migrate `oms_signatures` from localStorage into server-backed Mail settings on first authenticated load.
- Migrate `oms_threaded` into server-backed Mail reading preferences on first authenticated load.
- Keep a short compatibility fallback so existing local settings are not lost if the first migration request fails.

Exit criteria before moving on:

- Settings survive force reload, logout/login, and a different browser session for the same user.
- Browser localStorage is no longer the source of truth for signatures or threaded view.
- Failed settings saves show a clear error and do not silently discard edits.
- API rejects unauthenticated requests with 401.
- API rejects unknown namespaces and invalid value types.
- Backend tests or targeted route checks cover read, write, defaults, invalid namespace, and unauthenticated access.
- Frontend lint/build and backend test/build pass.
- Existing mail database rows are untouched except for additive settings rows.

Verified so far:

- `webmail-backend/src/user-settings.ts` creates `webmail_user_settings`, normalizes `mail`, `calendar`, `contacts`, and `appearance`, and backs authenticated `/api/settings/:namespace` GET/PUT routes.
- `webmail-frontend/src/App.tsx` hydrates signed-in users from server settings, migrates `oms_signatures`, `oms_threaded`, and `oms_appearance` once per user, keeps local fallback writes, debounces server saves, dedupes unchanged saves, and shows a sync error banner on failure.
- `rtk npm --prefix webmail-backend test` passes.
- `rtk npm --prefix webmail-frontend run lint` passes.
- `rtk npm --prefix webmail-frontend run build` passes.
- Mocked browser smoke confirmed local settings migration, signature editing, debounced `/api/settings/mail` and `/api/settings/appearance` saves, and no sync error banner on successful saves.
- Live direct backend and Vite-proxied `/api/settings/mail` probes return `401` when unauthenticated.
- Built backend was synced to `/opt/openmailstack-backend` and `openmailstack.service` was restarted; built frontend was deployed to `/var/www/openmailstack`.
- `rtk bash ./tests/integration/staging_smoke.sh ./config.conf` passes after deployment.

## Milestone 2A: Admin Branding Settings

Status: implemented as of 2026-06-21, with real admin upload QA still worth doing from the browser.

Purpose: let admin users customize the web app identity and login surface for their organization without exposing writes to normal users.

Work:

- Add additive `webmail_branding_settings` table.
- Add public `/api/branding` for unauthenticated login/header/favicon reads.
- Add admin-only `/api/admin/branding` read/write routes.
- Add Admin > Branding UI for app name, company name, login title/subtitle, app icon, favicon, login logo, and login background.
- Apply branding to document title, favicon, login page, and authenticated header.
- Reject SVG and non-image URLs on the backend; accept only bounded raster image data URLs.
- Show recommended pixel dimensions for each branding image and resize/crop uploads in the browser before saving.

Verified so far:

- `rtk npm --prefix webmail-backend test` passes with branding normalization coverage.
- `rtk npm --prefix webmail-frontend run lint` passes.
- `rtk npm --prefix webmail-frontend run build` passes.
- Mocked browser smoke confirmed public branding changes document title/favicon/header text and Admin > Branding saves expected payloads.
- Mocked browser upload smoke confirmed image cards show recommended dimensions, uploads are resized to target dimensions, and saved payloads stay below backend size limits.
- Live `/api/branding` returns defaults when unset; unauthenticated `/api/admin/branding` writes return `401`.
- Built backend was synced to `/opt/openmailstack-backend` and `openmailstack.service` was restarted; built frontend was deployed to `/var/www/openmailstack`.
- `rtk bash ./tests/integration/staging_smoke.sh ./config.conf` passes after deployment.

## Milestone 3: Mail Settings Product Pass

Purpose: bring Mail settings close to Gmail/Outlook/Proton expectations using the new persistence foundation.

Work:

- Identity & Send-As:
  - Show current mailbox identity and aliases from `/api/user/identities`.
  - Let the user choose default From from allowed identities.
  - Add optional reply-to if backend send flow supports it safely.
- Signatures:
  - Support multiple signatures.
  - Support per-identity default signatures.
  - Separate default for new messages and replies/forwards.
  - Sanitize signature HTML before rendering/inserting.
- Compose preferences:
  - Default rich-text/plain-text mode.
  - Undo-send delay where feasible.
  - Attachment reminder.
  - Auto-save status visibility.
- Reading preferences:
  - Conversation view.
  - Message list density.
  - Preview pane position.
  - External images always ask/load for trusted senders.
  - Mark-as-read timing.
- Forwarding & Delivery:
  - Keep current forwarding behavior.
  - Add a clear keep-copy explanation and validation.
  - Vacation Auto-Responder: Sieve-backed vacation rule generation is implemented.
- Filters:
  - Preserve Sieve-backed storage.
  - Add enable/disable, ordering, and validation messaging if not already present.
- Spam & Sender Lists:
  - Add user-level blocked and safe senders.
  - Keep admin/global spam policy separate.
  - Define how blocked/safe senders are enforced, preferably through Sieve-compatible behavior or a backend-enforced mail action.

Exit criteria before moving on:

- Every visible Mail setting either persists server-side or is intentionally read-only.
- Compose uses the saved default From and signature settings.
- Reading view uses saved conversation/density/preview preferences.
- Sender list changes have real mail behavior or are not presented as active controls.
- Sieve rule saves still compile and round-trip.
- Manual smoke: login, open Settings > Mail, edit signature, compose, send draft or test mail, reload, verify values remain.
- Frontend lint/build and backend test/build pass.

## Milestone 4: Calendar Settings Product Pass

Purpose: make Calendar settings affect the actual calendar experience instead of only existing as standalone preferences.

Work:

- Add default calendar selection from the user's real calendar list.
- Add default view, week start, working hours, visible days, and time zone.
- Add default event duration and default reminder preferences.
- Apply defaults to the new event modal.
- Apply default view/week/time preferences to the calendar view.
- Add CalDAV connection information that matches the deployed hostname and current routing.
- Add import/export planning hooks, but only ship import/export once parsing and conflict handling are implemented.
- Prepare future sharing/free-busy controls without presenting unsupported functionality as active.

Exit criteria before moving on:

- New events use saved default calendar, duration, time zone, and reminders.
- Calendar view uses saved default view, week start, and working-hour preferences where the current calendar UI supports them.
- Calendar settings survive reload/login.
- CalDAV URL/help text is accurate for the live deployment.
- Existing calendar create/read/update/delete flows still work.
- CalDAV smoke checks still pass.
- Frontend lint/build and backend test/build pass.

## Milestone 5: Contacts Settings Product Pass

Purpose: make Contacts settings useful for daily address-book management and mail composition.

Work:

- Add display name format and sort order preferences.
- Apply contact display/sort preferences in Contacts and compose recipient suggestions.
- Add auto-create contacts from sent mail as a persisted preference and wire the send flow to respect it.
- Add import/export for vCard first, then CSV after mapping and preview behavior are defined.
- Add duplicate detection and merge workflow.
- Add CardDAV connection information that matches the deployed hostname and current routing.
- Prepare contact groups/lists if the data model supports them; otherwise keep it as a later milestone.

Exit criteria before moving on:

- Contacts list and compose autocomplete respect saved display/sort preferences.
- Auto-create contacts can be enabled/disabled and the send flow follows the setting.
- vCard export works for at least one contact and all contacts.
- vCard import validates input, previews changes, and does not create duplicates without user confirmation.
- Contacts settings survive reload/login.
- CardDAV URL/help text is accurate for the live deployment.
- Existing contacts CRUD still works.
- Frontend lint/build and backend test/build pass.

## Milestone 6: Account, Security, And Release Hardening

Purpose: make the Settings area trustworthy enough to ship as a normal part of the webmail suite.

Work:

- Wire Change Password to a real backend endpoint or hide/mark it unavailable until it exists.
- Add active session listing and revoke-session controls if session table support is exposed safely.
- Add consistent save states: saving, saved, dirty, failed, retry.
- Add form-level validation and per-field error messages.
- Add keyboard accessibility and focus management for settings navigation.
- Add responsive behavior for narrow screens.
- Add a manual test matrix covering Mail, Calendar, Contacts, and Account settings.
- Update deployment notes and user-facing docs once behavior is implemented.

Exit criteria before considering the settings work product-grade:

- All visible controls are either functional, read-only, or explicitly marked as coming later.
- No mock-only settings remain in production UI.
- Force reload keeps the user logged in and retains settings values.
- A non-admin user cannot access admin/global settings through the user settings UI or API.
- A user cannot read or write another user's settings.
- Frontend lint/build passes.
- Backend tests/build pass.
- Live smoke passes against the staged deployment before syncing to `/var/www/openmailstack` or restarting `openmailstack`.
- No migration step deletes or rewrites existing mail, contacts, calendar, alias, or session data.

## Implementation Guardrails

- Work in milestone order.
- Use additive database migrations only.
- Keep forwarding and Sieve behavior on their current proven backend paths unless a specific feature requires a change.
- Keep `/api` calls relative so the live deployment does not regress into hardcoded development ports.
- Do not expose admin/global spam policy as user-level spam settings.
- Do not present placeholder controls as functional.
- Prefer server-backed settings for anything users expect to follow them across devices.
- Keep localStorage only for harmless UI cache that can be discarded.
- Verify each milestone with code checks and a browser smoke test before moving to the next.

## Suggested First Implementation Slice

Start with Milestone 1 only:

1. Create the Settings component boundary.
2. Reorganize navigation into Mail, Calendar, Contacts, and Account & Security.
3. Move the existing settings panes without changing their data flow.
4. Add Calendar and Contacts placeholder panels that describe unavailable settings through disabled controls or read-only rows, not fake working toggles.
5. Run frontend lint/build.

This gives users the correct product shape quickly and lowers the risk of breaking live mail behavior before the persistence foundation is ready.
