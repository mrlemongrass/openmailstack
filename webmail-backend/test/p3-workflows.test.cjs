const test = require('node:test');
const assert = require('node:assert/strict');
process.env.OMS_DB_PASSWORD ||= 'p3-unit-fixture';
const { retentionOptions } = require('../src/mail-retention.js');
const { activityDescriptor, activityOutcome, userSyncObservation } = require('../src/user-activity.js');

test('retention settings reject implicit activation and invalid periods', () => {
  for (const value of [undefined, {}, { junk: 0, trash: 0 }, { junk: -1, trash: 1 }, { junk: '7', trash: 1 }, { junk: 7, trash: 3651 }]) assert.throws(() => retentionOptions(value));
  assert.deepEqual(retentionOptions({ junk: 7, trash: 0, extra: 'ignored' }), { junk: 7, trash: 0 });
});
test('activity excludes authentication, admin, previews, queries and uncontrolled paths', () => {
  for (const path of ['/auth/login', '/admin/mailboxes', '/retention/preview', '/mail-import/secret/unknown', '/notes/private-title/unknown']) assert.equal(activityDescriptor('POST', path), null);
  assert.equal(activityDescriptor('GET', '/notes'), null);
  const first = activityDescriptor('DELETE', '/notes/secret-title');
  const second = activityDescriptor('DELETE', '/notes/another-title');
  assert.deepEqual(first, second); assert.equal(JSON.stringify(first).includes('secret'), false);
  assert.equal(activityDescriptor('POST', '/scheduler/v1/bookings/abc/cancel').recoveryPath, '/scheduler-app');
  assert.equal(activityDescriptor('POST', '/messages/send').action, 'Send request');
  assert.equal(activityDescriptor('POST', '/apps/calendars/1/subscription/refresh').area, 'Calendar');
  assert.equal(activityDescriptor('POST', '/apps/events/1/event-id/respond').area, 'Calendar');
});

test('activity reports response workflow outcomes instead of treating HTTP 200 as completion', () => {
  assert.equal(activityOutcome({ success: true, state: 'uncertain' }, 200, 'Message action'), 'uncertain');
  assert.equal(activityOutcome({ success: true, job: { state: 'uncertain' } }, 202, 'Mail import'), 'uncertain');
  assert.equal(activityOutcome({ success: false }, 200, 'Message action'), 'failed');
  assert.equal(activityOutcome({ success: true, job: { state: 'running' } }, 200, 'Mail import'), 'accepted');
  assert.equal(activityOutcome({ success: true }, 200, 'Send request'), 'accepted');
  assert.equal(activityOutcome({ success: true, deliveryStatus: 'uncertain' }, 200, 'Send request'), 'uncertain');
  assert.equal(activityOutcome({ success: true, deliveryStatus: 'partial' }, 200, 'Send request'), 'uncertain');
  assert.equal(activityOutcome({ success: true, deliveryStatus: 'failed' }, 200, 'Send request'), 'failed');
  assert.equal(activityOutcome({ success: true }, 200, 'Note change'), 'completed');
  assert.equal(activityOutcome(undefined, 200, 'Note change', true), 'uncertain');
});
test('sync observations distinguish unknown, stale subscriptions and queued work', async () => {
  const { pool } = require('../src/db.js');
  const original = pool.query;
  try {
    pool.query = async () => [[{ last_at: null }]];
    assert.equal((await userSyncObservation('fixture@example.test', 'Mail')).syncState, 'unknown');
    assert.equal((await userSyncObservation('fixture@example.test', 'Notes')).syncState, 'unknown');
    pool.query = async () => [[{ total: 1, oldest: '2020-01-01', latest: '2020-01-01', failed: 0, waiting: 0 }]];
    assert.equal((await userSyncObservation('fixture@example.test', 'Calendar')).syncState, 'attention');
    pool.query = async () => [[{ total: 1, oldest: null, latest: null, failed: 0, waiting: 1 }]];
    assert.equal((await userSyncObservation('fixture@example.test', 'Calendar')).syncState, 'pending');
    pool.query = async () => { throw new Error('Unavailable'); };
    assert.equal((await userSyncObservation('fixture@example.test', 'Contacts')).syncState, 'unknown');
  } finally { pool.query = original; }
});
