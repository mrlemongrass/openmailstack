const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { startApplicationAfterRequiredMigrations } = require('../src/application-startup.js');

const prerequisiteNames = [
  'mail-search', 'session', 'user-settings', 'admin-settings', 'branding',
  'account-security', 'calendar', 'subscriptions', 'scheduled-send', 'notes',
  'reminders', 'attachments', 'contacts', 'eas-mail', 'eas-pim', 'birthdays',
];

const activationNames = [
  'search-worker', 'scheduled-sender', 'subscription-worker', 'listener',
];

function startupDependencies(failingPrerequisite = null) {
  const calls = [];
  const starts = Object.fromEntries(activationNames.map(name => [name, 0]));
  const prerequisite = name => async () => {
    calls.push(name);
    if (name === failingPrerequisite) throw new Error(`${name} prerequisite failed`);
  };
  const activate = name => () => {
    calls.push(name);
    starts[name] += 1;
  };
  return {
    dependencies: {
      ensureMailSearchSchema: prerequisite('mail-search'),
      initializeSessionStore: prerequisite('session'),
      ensureUserSettingsSchema: prerequisite('user-settings'),
      ensureAdminSettingsSchema: prerequisite('admin-settings'),
      ensureBrandingSchema: prerequisite('branding'),
      ensureAccountSecuritySchema: prerequisite('account-security'),
      ensureCalendarSchema: prerequisite('calendar'),
      ensureCalendarSubscriptionSchema: prerequisite('subscriptions'),
      ensureScheduledEmailsSchema: prerequisite('scheduled-send'),
      ensureNotesSchema: prerequisite('notes'),
      ensureRemindersSchema: prerequisite('reminders'),
      ensureAttachmentsSchema: prerequisite('attachments'),
      ensureContactsSchema: prerequisite('contacts'),
      ensureEasMailSyncSchema: prerequisite('eas-mail'),
      ensureEasPimSyncSchema: prerequisite('eas-pim'),
      repairBirthdayCalendarProjections: prerequisite('birthdays'),
      startSearchWorker: activate('search-worker'),
      startScheduledSender: activate('scheduled-sender'),
      startCalendarSubscriptionWorker: activate('subscription-worker'),
      listen: activate('listener'),
    },
    calls,
    starts,
  };
}

test('all prerequisites complete in order before each application worker and the listener start exactly once', async () => {
  const harness = startupDependencies();
  await startApplicationAfterRequiredMigrations(harness.dependencies);
  assert.deepEqual(harness.calls, [...prerequisiteNames, ...activationNames]);
  assert.deepEqual(
    harness.starts,
    Object.fromEntries(activationNames.map(name => [name, 1])),
  );
});

for (const prerequisiteName of ['mail-search', 'subscriptions', 'birthdays']) {
  test(`a rejected ${prerequisiteName} prerequisite keeps application workers and the listener stopped`, async () => {
    const harness = startupDependencies(prerequisiteName);
    await assert.rejects(
      startApplicationAfterRequiredMigrations(harness.dependencies),
      new RegExp(`${prerequisiteName} prerequisite failed`),
    );
    const failureIndex = prerequisiteNames.indexOf(prerequisiteName);
    assert.deepEqual(harness.calls, prerequisiteNames.slice(0, failureIndex + 1));
    assert.deepEqual(
      harness.starts,
      Object.fromEntries(activationNames.map(name => [name, 0])),
    );
  });
}

test('the entrypoint does not start prerequisites or application workers outside the startup barrier', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.ts'), 'utf8');
  const moduleSetup = source.slice(0, source.indexOf('async function startServer()'));
  assert.doesNotMatch(
    moduleSetup,
    /^(?:ensureMailSearchSchema|initializeSessionStore|ensureUserSettingsSchema|ensureAdminSettingsSchema|ensureBrandingSchema|ensureAccountSecuritySchema|startSearchWorker|startScheduledSender|startCalendarSubscriptionWorker)\(/m,
  );
});
