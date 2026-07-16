const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const requireText = (file, pattern, message) => {
    if (!pattern.test(read(file))) throw new Error(`${message} (${file})`);
};

const migration = read('webmail-backend/migrations/024_scheduler_workflow_foundation.sql');
const completionMigration = read('webmail-backend/migrations/025_scheduler_phase3_completion.sql');
for (const table of [
    'scheduler_workflows',
    'scheduler_workflow_versions',
    'scheduler_workflow_steps',
    'scheduler_booking_workflow_versions',
    'scheduler_jobs',
    'scheduler_delivery_attempts',
]) {
    if (!migration.includes(`CREATE TABLE IF NOT EXISTS ${table}`)) {
        throw new Error(`Phase 3 workflow migration missing ${table}`);
    }
}
for (const table of [
    'scheduler_delivery_providers',
    'scheduler_contact_preferences',
    'scheduler_in_app_notifications',
    'scheduler_delivery_alerts',
]) {
    if (!completionMigration.includes(`CREATE TABLE IF NOT EXISTS ${table}`)) {
        throw new Error(`Phase 3 completion migration missing ${table}`);
    }
}

requireText('webmail-backend/src/scheduler/workflows.ts', /FOR UPDATE SKIP LOCKED/, 'Job claims must use database leases');
requireText('webmail-backend/src/scheduler/workflows.ts', /dead_lettered_at/, 'Job failures must have a dead-letter transition');
requireText('webmail-backend/src/scheduler/workflows.ts', /SchedulerSecretBox/, 'Provider and unsubscribe secrets must use domain-separated encryption');
requireText('webmail-backend/src/scheduler/provider-http.ts', /createPinnedLookup/, 'External adapters must pin the validated DNS address');
requireText('webmail-backend/src/scheduler/provider-http.ts', /agent: false/, 'Pinned adapter requests must not reuse an address from the global socket pool');
requireText('webmail-backend/src/scheduler/provider-http.ts', /::ffff:/, 'External adapters must block IPv4-mapped private addresses');
requireText('webmail-backend/src/scheduler/workflows.ts', /x-oms-scheduler-signature/, 'Scheduler webhooks must be signed');
requireText('webmail-backend/src/scheduler/workflows.ts', /Signed webhook providers require a secret/, 'Signed webhooks must require a credential');
requireText('webmail-backend/src/scheduler/workflows.ts', /bookingConsentAllows/, 'External messages must enforce booking-scoped consent');
requireText('webmail-backend/src/scheduler/workflows.ts', /must preserve the original workflow variables/, 'Published translations must preserve safe placeholders');
requireText('webmail-backend/src/scheduler/workflows.ts', /secret_key_version/, 'Encrypted provider credentials must record a key version');
requireText('webmail-backend/src/scheduler/store.ts', /captureForBooking\(connection/, 'All bookings must snapshot workflow versions transactionally');
requireText('webmail-backend/src/scheduler/store.ts', /activateCapturedForBooking/, 'Requested bookings must activate their captured version on approval');
requireText('webmail-backend/src/scheduler/store.ts', /triggerForBooking\(connection/, 'Booking outcomes must enqueue captured lifecycle workflows');
requireText('webmail-backend/src/scheduler/router.ts', /\/scheduler\/v1\/workflows\/:id\/publish/, 'Owners need a workflow publish API');
requireText('webmail-backend/src/scheduler/router.ts', /\/scheduler\/v1\/workflows\/:id\/clone/, 'Owners need workflow cloning');
requireText('webmail-backend/src/scheduler/router.ts', /\/scheduler\/v1\/workflows\/translate/, 'Owners need pluggable translation generation');
requireText('webmail-backend/src/scheduler/router.ts', /\/admin\/scheduler\/v1\/providers/, 'Administrators need provider management APIs');
requireText('webmail-backend/src/scheduler/router.ts', /\/admin\/scheduler\/v1\/workflow-operations/, 'Administrators need delivery recovery APIs');
requireText('webmail-backend/src/scheduler/router.ts', /schedulerRouter\.get\('\/public\/scheduler\/v1\/unsubscribe\/:token'[\s\S]*schedulerRouter\.post\('\/public\/scheduler\/v1\/unsubscribe\/:token'/, 'Unsubscribe links must confirm before mutating state');
requireText('webmail-backend/src/scheduler/router.ts', /requireAdminSession[\s\S]*\/admin\/scheduler\/v1\/providers/, 'Provider APIs must remain behind Admin authorization');
requireText('webmail-frontend/src/scheduler/routes.tsx', /WorkflowsPanel/, 'Scheduler needs a native workflow builder route');
requireText('webmail-frontend/src/scheduler/WorkflowsPanel.tsx', /In-app notifications[\s\S]*Mark read/, 'Owners need a visible in-app notification surface');
requireText('webmail-frontend/src/admin/routes.tsx', /SchedulerDeliveryPanel/, 'Admin needs a Scheduler delivery surface');
requireText('webmail-frontend/src/admin/SchedulerDeliveryPanel.tsx', /const disableProvider = async[\s\S]*catch \(disableError\)/, 'Provider disable failures must remain visible and recoverable');
requireText('webmail-frontend/src/admin/SchedulerDeliveryPanel.tsx', /Scheduler delivery metrics[\s\S]*Before you enable this provider/, 'Admin must see provider disclosure and queue observability');
requireText('webmail-backend/test/scheduler-phase3-routes.test.cjs', /tenant scope, admin scope, notification IDOR, and unsubscribe confirmation/, 'Phase 3 needs real Express authorization coverage');
requireText('webmail-frontend/src/scheduler/PublicScheduler.tsx', /I agree to receive/, 'Public bookings must collect explicit external-channel consent');
requireText('packaging/systemd/openmailstack-scheduler-worker.service', /ExecStart=\/usr\/bin\/node src\/scheduler\/worker-entry\.js/, 'Scheduler needs a separate worker process');
requireText('packaging/systemd/openmailstack-scheduler-worker.service', /Restart=on-failure/, 'Scheduler worker must recover from crashes');
requireText('functions/12_scheduler.sh', /systemctl enable openmailstack-scheduler-worker\.service/, 'Scheduler installer must enable the worker');
requireText('functions/10_webmail.sh', /restart openmailstack-scheduler-worker\.service/, 'Backend upgrades must restart the Scheduler worker');
requireText('functions/10_webmail.sh', /OMS_SCHEDULER_SECRET_KEYRING/, 'Installer upgrades must preserve Scheduler encryption keys');
requireText('install.sh', /functions\/10_webmail\.sh[\s\S]*functions\/12_scheduler\.sh/, 'Webmail must deploy before the Scheduler worker is installed');
if (/startSchedulerWorker/.test(read('webmail-backend/src/index.ts'))) {
    throw new Error('Web request process must not host the Scheduler worker loop');
}

console.log('[pass] Scheduler Phase 3 workflow, lease, dead-letter, and worker guards');
