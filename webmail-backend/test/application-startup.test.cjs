const test = require('node:test');
const assert = require('node:assert/strict');

const { startApplicationAfterRequiredMigrations } = require('../src/application-startup.js');

const migrationNames = [
  'calendar', 'subscriptions', 'notes', 'reminders', 'attachments', 'contacts',
  'eas-mail', 'eas-pim', 'birthdays',
];

function startupDependencies(failingMigration = null) {
  const calls = [];
  let workerStarts = 0;
  let listenerStarts = 0;
  const migration = name => async () => {
    calls.push(name);
    if (name === failingMigration) throw new Error(`${name} migration failed`);
  };
  return {
    dependencies: {
      ensureCalendarSchema: migration('calendar'),
      ensureCalendarSubscriptionSchema: migration('subscriptions'),
      ensureNotesSchema: migration('notes'),
      ensureRemindersSchema: migration('reminders'),
      ensureAttachmentsSchema: migration('attachments'),
      ensureContactsSchema: migration('contacts'),
      ensureEasMailSyncSchema: migration('eas-mail'),
      ensureEasPimSyncSchema: migration('eas-pim'),
      repairBirthdayCalendarProjections: migration('birthdays'),
      startCalendarSubscriptionWorker: () => { workerStarts += 1; },
      listen: () => { listenerStarts += 1; },
    },
    calls,
    counters: () => ({ workerStarts, listenerStarts }),
  };
}

test('required application migrations complete in dependency order before writers or traffic start', async () => {
  const harness = startupDependencies();
  await startApplicationAfterRequiredMigrations(harness.dependencies);
  assert.deepEqual(harness.calls, migrationNames);
  assert.deepEqual(harness.counters(), { workerStarts: 1, listenerStarts: 1 });
});

for (const [index, migrationName] of migrationNames.entries()) {
  test(`a rejected ${migrationName} migration keeps the worker and listener stopped`, async () => {
    const harness = startupDependencies(migrationName);
    await assert.rejects(
      startApplicationAfterRequiredMigrations(harness.dependencies),
      new RegExp(`${migrationName} migration failed`),
    );
    assert.deepEqual(harness.calls, migrationNames.slice(0, index + 1));
    assert.deepEqual(harness.counters(), { workerStarts: 0, listenerStarts: 0 });
  });
}
