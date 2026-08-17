const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const test = require('node:test');

process.env.OMS_DB_PASSWORD ||= 'outbound-release-bridge-test';
process.env.OMS_OUTBOUND_RELEASE_MODE = 'bridge';

const {
  MySqlScheduledEmailStore,
  OutboundReleaseBridgeError,
  abortScheduledEmailBeforeDelivery,
  claimScheduledCancellation,
  completeScheduledCancellation,
  getOutboundSubmission,
  releaseScheduledCancellation,
  removeTerminalScheduledEmail,
  runScheduledSender,
  submitOutbound,
} = require('../src/scheduled-send.js');
const { activeSyncSendMailIdempotencyKey } = require('../src/eas-send.js');

const message = {
  username: 'owner@example.test',
  sendAt: new Date('2026-08-16T12:00:00.000Z'),
  senderAddress: 'owner@example.test',
  messageId: '<bridge@example.test>',
  envelope: { from: 'owner@example.test', to: ['recipient@example.net'] },
  raw: Buffer.from('Message-ID: <bridge@example.test>\r\n\r\nBridge body'),
  metadata: { subject: 'Bridge body' },
};

test('bridge mode rejects web, scheduled, and ActiveSync submissions before persistence or delivery', async () => {
  let databaseCalls = 0;
  let deliveryCalls = 0;
  const db = {
    async query() {
      databaseCalls += 1;
      throw new Error('bridge mode must not touch persistence');
    },
  };
  const dependencies = {
    async getCredential() { deliveryCalls += 1; throw new Error('unexpected credential'); },
    createTransport() { deliveryCalls += 1; throw new Error('unexpected SMTP'); },
    async createImap() { deliveryCalls += 1; throw new Error('unexpected IMAP'); },
    async authorizeSender() { deliveryCalls += 1; throw new Error('unexpected authorization'); },
    async onAccepted() { deliveryCalls += 1; throw new Error('unexpected acceptance'); },
  };
  const submissions = [
    { submissionKind: 'immediate', idempotencyKey: 'web-immediate-key' },
    { submissionKind: 'scheduled', idempotencyKey: 'web-scheduled-key' },
    {
      submissionKind: 'immediate',
      idempotencyKey: activeSyncSendMailIdempotencyKey(
        'owner@example.test',
        '0123456789ABCDEF',
        'physical-client-id',
      ),
    },
  ];

  for (const submission of submissions) {
    await assert.rejects(
      submitOutbound(db, {
        ...submission,
        fingerprintSource: { channel: submission.idempotencyKey.startsWith('eas:') ? 'eas' : 'web' },
        message,
      }, { dependencies }),
      error => error instanceof OutboundReleaseBridgeError
        && error.code === 'OUTBOUND_RELEASE_BRIDGE'
        && error.status === 503,
      submission.idempotencyKey,
    );
  }

  assert.equal(databaseCalls, 0);
  assert.equal(deliveryCalls, 0);
});

test('bridge worker quarantines every scheduled and immediate state before any database or delivery work', async () => {
  let databaseCalls = 0;
  let deliveryCalls = 0;
  const db = {
    async query() { databaseCalls += 1; throw new Error('bridge worker must not query'); },
    async getConnection() { databaseCalls += 1; throw new Error('bridge worker must not claim'); },
  };
  const dependencies = {
    async getCredential() { deliveryCalls += 1; throw new Error('unexpected credential'); },
    createTransport() { deliveryCalls += 1; throw new Error('unexpected SMTP'); },
    async createImap() { deliveryCalls += 1; throw new Error('unexpected IMAP'); },
    async authorizeSender() { deliveryCalls += 1; throw new Error('unexpected authorization'); },
    async onAccepted() { deliveryCalls += 1; throw new Error('unexpected acceptance'); },
  };
  const store = new MySqlScheduledEmailStore(db);

  assert.equal(await store.claimById(71, 'owner@example.test', 'bridge-request'), null);
  assert.deepEqual(await store.claimBatch('bridge-worker', 100), []);
  assert.equal(await runScheduledSender(dependencies, db, 'bridge-loop'), 0);
  assert.equal(databaseCalls, 0);
  assert.equal(deliveryCalls, 0);
});

test('bridge mode blocks every scheduled cancellation and removal mutation at the deep seam', async () => {
  let databaseCalls = 0;
  const db = {
    async query() { databaseCalls += 1; throw new Error('bridge mutation must not query'); },
  };
  const operations = [
    () => claimScheduledCancellation(db, 71, 'owner@example.test', 'cancel-71'),
    () => completeScheduledCancellation(db, 71, 'owner@example.test', 'cancel-71', 9),
    () => releaseScheduledCancellation(db, 71, 'owner@example.test', 'cancel-71', 'retry'),
    () => removeTerminalScheduledEmail(db, 71, 'owner@example.test'),
    () => abortScheduledEmailBeforeDelivery(db, 71, 'owner@example.test'),
  ];
  for (const operation of operations) {
    await assert.rejects(operation, error => error instanceof OutboundReleaseBridgeError
      && error.code === 'OUTBOUND_RELEASE_BRIDGE'
      && error.status === 503);
  }
  assert.equal(databaseCalls, 0);
});

test('bridge mode keeps owner-scoped status reads available', async () => {
  const allColumns = [
    'id', 'username', 'send_at', 'mail_options', 'display_metadata_json', 'draft_uid', 'payload_version',
    'submission_kind', 'submission_origin', 'idempotency_key', 'request_fingerprint',
    'save_in_sent_items', 'status', 'available_at',
    'attempts', 'lease_owner', 'lease_expires_at', 'sender_address', 'message_id', 'envelope_json',
    'rejected_recipients_json', 'raw_message', 'sent_raw_message', 'smtp_accepted_at',
    'sent_copy_completed_at', 'completed_at', 'cancelled_at', 'removed_at', 'last_error_code', 'last_error_at',
    'created_at', 'updated_at',
  ];
  const db = {
    async query(sql) {
      const compact = String(sql).replace(/\s+/g, ' ').trim();
      if (compact.startsWith('CREATE TABLE IF NOT EXISTS scheduled_emails')) return [[], []];
      if (compact.startsWith('CREATE TABLE IF NOT EXISTS outbound_submission_registry')) return [[], []];
      if (compact.includes('INFORMATION_SCHEMA.COLUMNS')) return [allColumns.map(COLUMN_NAME => ({
        COLUMN_NAME,
        COLUMN_TYPE: COLUMN_NAME === 'attempts' ? 'int unsigned' : '',
      })), []];
      if (compact.includes('INFORMATION_SCHEMA.STATISTICS')) return [[
        { INDEX_NAME: 'idx_scheduled_claim' },
        { INDEX_NAME: 'idx_scheduled_owner_state' },
        { INDEX_NAME: 'uq_scheduled_owner_idempotency' },
      ], []];
      if (compact.startsWith('UPDATE scheduled_emails')) return [{ affectedRows: 0 }, []];
      if (compact.includes('WHERE username = ? AND idempotency_key = ?')) return [[{
        id: 73,
        submission_kind: 'immediate',
        idempotency_key: 'existing-key',
        status: 'claimed',
        message_id: '<existing@example.test>',
        send_at: new Date('2026-08-16T12:00:00.000Z'),
        smtp_accepted_at: null,
        save_in_sent_items: 1,
        rejected_recipients_json: '[]',
        last_error_code: null,
      }], []];
      throw new Error(`Unexpected query: ${compact}`);
    },
  };

  const result = await getOutboundSubmission(
    db,
    'owner@example.test',
    { idempotencyKey: 'existing-key' },
  );

  assert.equal(result.id, 73);
  assert.equal(result.status, 'claimed');
  assert.equal(result.submissionKind, 'immediate');
});

test('outbound release mode rejects invalid configuration instead of guessing', () => {
  const configPath = path.join(__dirname, '..', 'src', 'config.js');
  const result = spawnSync(process.execPath, ['-e', `require(${JSON.stringify(configPath)})`], {
    encoding: 'utf8',
    env: {
      ...process.env,
      OMS_DB_PASSWORD: 'outbound-release-invalid-test',
      OMS_OUTBOUND_RELEASE_MODE: 'almost-active',
    },
  });

  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}${result.stderr}`, /OMS_OUTBOUND_RELEASE_MODE must be bridge or active/);
});
