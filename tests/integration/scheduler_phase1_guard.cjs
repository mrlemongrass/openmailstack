const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const requireText = (file, pattern, message) => {
  if (!pattern.test(read(file))) throw new Error(`${message} (${file})`);
};

requireText('config.default', /ENABLE_OMS_SCHEDULER="false"/, 'Scheduler must default to disabled');
requireText('setup_config.sh', /Install OMS Scheduler\? \(y\/N\)/, 'Configuration wizard must ask before installing Scheduler');
requireText('install.sh', /functions\/12_scheduler\.sh/, 'Installer must include the Scheduler module');
requireText('install.sh', /scheduler\.enabled/, 'Installer component detection must track Scheduler state');
requireText('functions/12_scheduler.sh', /ENABLE_OMS_SCHEDULER:-false/, 'Scheduler module must no-op while disabled');
requireText('functions/12_scheduler.sh', /migrations.*\[0-9\]\[0-9\]\[0-9\]_\*\.sql/s, 'Scheduler module must apply ordered migrations');
requireText('functions/10_webmail.sh', /OMS_SCHEDULER_HOST_ALIASES/, 'Backend environment must render the Scheduler host allowlist');
requireText('functions/10_webmail.sh', /location \^~ \/scheduler\//, 'Nginx must serve public Scheduler SPA paths');
requireText('functions/02_postfixadmin.sh', /openmailstack_scheduler_server_names/, 'Fresh Nginx configuration must include Scheduler hostname aliases');
requireText('functions/07_security.sh', /certificate_covers_hosts/, 'TLS provisioning must verify every configured Scheduler hostname');
requireText('functions/07_security.sh', /subjectAltName=/, 'Self-signed certificates must include Scheduler hostname SANs');

const migration = read('webmail-backend/migrations/002_scheduler_phase1.sql');
for (const table of ['scheduler_mailbox_entitlements', 'scheduler_event_types', 'scheduler_availability_windows', 'scheduler_bookings', 'scheduler_outbox', 'scheduler_audit_events']) {
  if (!migration.includes(`CREATE TABLE IF NOT EXISTS ${table}`)) throw new Error(`Phase 1 migration missing ${table}`);
}
const availabilityMigration = read('webmail-backend/migrations/003_scheduler_availability_schedules.sql');
for (const table of ['scheduler_availability_schedules', 'scheduler_schedule_windows', 'scheduler_schedule_overrides', 'scheduler_override_windows']) {
  if (!availabilityMigration.includes(`CREATE TABLE IF NOT EXISTS ${table}`)) throw new Error(`Availability migration missing ${table}`);
}
if (!availabilityMigration.includes('system_managed')) throw new Error('Availability migration must distinguish the hidden default booking type');
requireText('webmail-backend/migrations/004_scheduler_notification_identity.sql', /notification_from/, 'Scheduler notification identity migration is missing');
requireText('webmail-backend/migrations/005_scheduler_event_visibility.sql', /visibility ENUM\('public', 'unlisted'\)/, 'Scheduler event visibility migration is missing');
requireText('webmail-backend/migrations/006_scheduler_private_links.sql', /scheduler_private_links/, 'Scheduler private-link migration is missing');
requireText('webmail-backend/migrations/006_scheduler_private_links.sql', /UNIQUE KEY uniq_scheduler_private_token \(token_hash\)/, 'Private-link token hashes must be unique');
requireText('webmail-backend/migrations/007_scheduler_private_link_uses.sql', /uses_remaining/, 'Single-use private-link migration is missing its remaining-use counter');
requireText('webmail-backend/migrations/007_scheduler_private_link_uses.sql', /consumed_at/, 'Single-use private-link migration is missing consumption state');
requireText('webmail-backend/src/index.ts', /app\.use\('\/api'.*schedulerRouter/, 'Backend must mount Scheduler APIs');
requireText('webmail-backend/src/scheduler/router.ts', /\/public\/scheduler\/v1/, 'Public Scheduler API boundary is missing');
requireText('webmail-backend/src/scheduler/router.ts', /\/admin\/scheduler\/v1/, 'Admin Scheduler API boundary is missing');
requireText('webmail-backend/src/scheduler/router.ts', /schedulerHostAllowed\(requestHost\(req\)\)/, 'Public APIs must enforce the host allowlist');
requireText('webmail-backend/src/api.ts', /scheduler_mailbox_entitlements SET enabled = 0, published = 0/, 'Inactive or deleted mailboxes must be unpublished');
requireText('webmail-frontend/src/App.tsx', /scheduler\/:handle\/:slug\?/, 'Public Scheduler frontend route is missing');
requireText('webmail-frontend/src/App.tsx', /scheduler-app/, 'Authenticated Scheduler route is missing');
requireText('webmail-frontend/src/shared/layouts/AppShell.tsx', /label: 'Scheduler'.*CalendarClock/s, 'Scheduler navigation is missing');
requireText('webmail-frontend/src/shared/layouts/AppShell.tsx', /SCHEDULER_ENTITLEMENT_CHANGED/, 'Scheduler navigation does not refresh after entitlement changes');
requireText('webmail-frontend/src/admin/MailboxesPanel.tsx', /notifySchedulerEntitlementChanged/, 'Scheduler admin changes do not notify the application shell');
requireText('webmail-frontend/src/admin/MailboxesPanel.tsx', /Scheduler access/, 'Admin mailbox entitlement control is missing');
requireText('webmail-frontend/src/scheduler/routes.tsx', /Open booking site/, 'Scheduler owner UI must expose the public booking site');
requireText('webmail-frontend/src/scheduler/routes.tsx', /Copy booking link/, 'Scheduler owner UI must expose a labeled copy action');
requireText('webmail-frontend/src/scheduler/routes.tsx', /Create your first booking type/, 'Scheduler first-run guidance is missing');
requireText('webmail-frontend/src/scheduler/AvailabilityPanel.tsx', /Default week/, 'Scheduler default availability editor is missing');
requireText('webmail-frontend/src/scheduler/AvailabilityPanel.tsx', /\['week', 'month', 'day'\]/, 'Scheduler week, month, and day availability views are missing');
requireText('webmail-frontend/src/scheduler/AvailabilityPanel.tsx', /Block a date range/, 'Scheduler date-range blocking control is missing');
requireText('webmail-frontend/src/scheduler/AvailabilityPanel.tsx', /30-minute default booking preview/, 'Scheduler default booking preview is missing');
requireText('webmail-frontend/src/scheduler/AvailabilityPanel.tsx', /enableBooking[\s\S]*save\(nextDraft\)/, 'Enable booking must publish immediately instead of leaving an unsaved draft');
requireText('webmail-frontend/src/scheduler/routes.tsx', /no bookable availability/, 'Scheduler empty-profile warning is missing');
requireText('webmail-frontend/src/scheduler/routes.tsx', /aria-label="Duration hours"/, 'Scheduler duration hours control is missing');
requireText('webmail-frontend/src/scheduler/routes.tsx', /aria-label="Duration minutes"/, 'Scheduler duration minutes control is missing');
requireText('webmail-frontend/src/scheduler/routes.tsx', /between 5 minutes and 24 hours/, 'Scheduler custom duration validation is missing');
requireText('webmail-frontend/src/scheduler/routes.tsx', /Use default availability/, 'Event types must inherit the default schedule');
requireText('webmail-frontend/src/scheduler/routes.tsx', /Start-time increments/, 'Event type limits UI is missing');
requireText('webmail-frontend/src/scheduler/routes.tsx', /Anyone with its exact link can still book/, 'Unlisted event guidance is missing');
requireText('webmail-frontend/src/scheduler/routes.tsx', /scheduler-event-badge[^\n]+Unlisted/, 'Unlisted event status is missing from owner management');
requireText('webmail-backend/src/scheduler/store.ts', /event\.active && event\.visibility === 'public'/, 'Unlisted events must not leak through the public profile directory');
requireText('webmail-frontend/src/scheduler/routes.tsx', /Require a random access token that you can rotate, expire, or revoke/, 'Private-link owner controls are missing');
requireText('webmail-frontend/src/scheduler/PublicScheduler.tsx', /sessionStorage\.setItem[\s\S]*history\.replaceState/, 'Private tokens must leave the address bar after being stored for the tab');
requireText('webmail-frontend/src/scheduler/api.ts', /X-Scheduler-Access/, 'Private tokens must use the dedicated request header');
requireText('webmail-backend/src/scheduler/store.ts', /token_hash = \?[\s\S]*revoked_at IS NULL[\s\S]*expires_at > UTC_TIMESTAMP/, 'Private-link access must enforce hash, revocation, and expiry');
requireText('webmail-backend/src/scheduler/store.ts', /uses_remaining[\s\S]*FOR UPDATE[\s\S]*private_link\.consume/, 'Single-use consumption must lock and audit the remaining-use counter');
requireText('webmail-backend/src/scheduler/router.ts', /Cache-Control', 'no-store'/, 'Private-link responses must disable caching');
requireText('webmail-frontend/src/scheduler/routes.tsx', /Single-use link: disable it after the first successful booking/, 'Owner UI must explain single-use consumption');
requireText('webmail-frontend/src/scheduler/PublicScheduler.tsx', /bookingAttemptKeyRef[\s\S]*createPublicBooking/, 'Public booking retries must keep a stable idempotency key');
requireText('webmail-frontend/src/scheduler/routes.tsx', /Scheduler email sender/, 'Scheduler profile must expose the owned notification sender');
requireText('webmail-backend/src/scheduler/store.ts', /Scheduler sender must be your mailbox or an active alias/, 'Scheduler notification sender must reject spoofed addresses');
requireText('webmail-frontend/src/scheduler/scheduler.css', /scheduler-modal[^}]+background: var\(--surface-color\)/s, 'Scheduler modal must use an opaque surface token');
requireText('webmail-frontend/src/scheduler/PublicScheduler.tsx', /data\.defaultEvent/, 'Public Scheduler must support the hidden default event');
requireText('webmail-frontend/src/scheduler/PublicScheduler.tsx', /visibilitychange[\s\S]*loadSlots/, 'Public Scheduler must refresh stale slots when the page becomes visible');
requireText('webmail-backend/src/scheduler/store.ts', /fullCapacitySlotStarts/, 'Public slots must independently exclude full database capacity');
requireText('functions/10_webmail.sh', /OMS_SCHEDULER_SMTP_SERVER_NAME/, 'Scheduler SMTP must render the certificate server name');
requireText('webmail-frontend/src/scheduler/PublicScheduler.tsx', /No meetings available right now/, 'Public Scheduler empty state is missing');

console.log('[pass] Scheduler Phase 1 installer, schema, API, routing, and UI guards');
