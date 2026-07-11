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

console.log('[pass] Scheduler Phase 1 installer, schema, API, routing, and UI guards');
