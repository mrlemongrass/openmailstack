const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const requireText = (file, pattern, message) => {
    if (!pattern.test(read(file))) throw new Error(`${message} (${file})`);
};

const migration = read('webmail-backend/migrations/024_scheduler_workflow_foundation.sql');
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

requireText('webmail-backend/src/scheduler/workflows.ts', /FOR UPDATE SKIP LOCKED/, 'Job claims must use database leases');
requireText('webmail-backend/src/scheduler/workflows.ts', /dead_lettered_at/, 'Job failures must have a dead-letter transition');
requireText('webmail-backend/src/scheduler/store.ts', /captureForBooking\(connection/, 'Confirmed bookings must snapshot workflow versions transactionally');
requireText('packaging/systemd/openmailstack-scheduler-worker.service', /ExecStart=\/usr\/bin\/node src\/scheduler\/worker-entry\.js/, 'Scheduler needs a separate worker process');
requireText('packaging/systemd/openmailstack-scheduler-worker.service', /Restart=on-failure/, 'Scheduler worker must recover from crashes');
requireText('functions/12_scheduler.sh', /systemctl enable openmailstack-scheduler-worker\.service/, 'Scheduler installer must enable the worker');
requireText('functions/10_webmail.sh', /restart openmailstack-scheduler-worker\.service/, 'Backend upgrades must restart the Scheduler worker');
requireText('install.sh', /functions\/10_webmail\.sh[\s\S]*functions\/12_scheduler\.sh/, 'Webmail must deploy before the Scheduler worker is installed');
if (/startSchedulerWorker/.test(read('webmail-backend/src/index.ts'))) {
    throw new Error('Web request process must not host the Scheduler worker loop');
}

console.log('[pass] Scheduler Phase 3 workflow, lease, dead-letter, and worker guards');
