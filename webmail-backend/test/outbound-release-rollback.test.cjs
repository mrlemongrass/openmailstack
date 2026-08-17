const assert = require('node:assert/strict');
const test = require('node:test');

process.env.OMS_DB_PASSWORD ||= 'outbound-release-rollback-test';
process.env.OMS_OUTBOUND_RELEASE_MODE = 'active';

const allColumns = [
  'id', 'username', 'send_at', 'mail_options', 'display_metadata_json', 'draft_uid', 'payload_version',
  'submission_kind', 'submission_origin', 'idempotency_key', 'request_fingerprint',
  'save_in_sent_items', 'status', 'available_at',
  'attempts', 'lease_owner', 'lease_expires_at', 'sender_address', 'message_id', 'envelope_json',
  'rejected_recipients_json', 'raw_message', 'sent_raw_message', 'smtp_accepted_at',
  'sent_copy_completed_at', 'completed_at', 'cancelled_at', 'removed_at', 'last_error_code', 'last_error_at',
  'created_at', 'updated_at',
];

const runtimePaths = [require.resolve('../src/scheduled-send.js'), require.resolve('../src/config.js')];
const loadRuntime = mode => {
  process.env.OMS_OUTBOUND_RELEASE_MODE = mode;
  for (const modulePath of runtimePaths) delete require.cache[modulePath];
  return require('../src/scheduled-send.js');
};

const digestRow = row => ({
  ...row,
  send_at: row.send_at.toISOString(),
  available_at: row.available_at.toISOString(),
  raw_message: row.raw_message.toString('hex'),
  sent_raw_message: row.sent_raw_message.toString('hex'),
});

test('active durable immediate row survives bridge retry and worker rollback quarantine byte-for-byte', async () => {
  let row = null;
  let phase = 'active';
  let bridgeDatabaseCalls = 0;
  let bridgeClaimMutations = 0;
  let sideEffects = 0;
  const connection = {
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    release() {},
    async query(sql, params = []) {
      if (phase === 'bridge') bridgeDatabaseCalls += 1;
      const compact = String(sql).replace(/\s+/g, ' ').trim();
      if (compact.startsWith('INSERT INTO scheduled_emails')
        || compact.startsWith('INSERT INTO outbound_submission_registry')) {
        return db.query(sql, params);
      }
      if (compact.includes('FROM scheduled_emails')) return [[], []];
      if (compact.startsWith('UPDATE scheduled_emails')) {
        if (phase === 'bridge') bridgeClaimMutations += 1;
        return [{ affectedRows: 0 }, []];
      }
      throw new Error(`Unexpected connection query: ${compact}`);
    },
  };
  const db = {
    async getConnection() {
      if (phase === 'bridge') bridgeDatabaseCalls += 1;
      return connection;
    },
    async query(sql, params = []) {
      if (phase === 'bridge') bridgeDatabaseCalls += 1;
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
      if (compact.startsWith('INSERT INTO scheduled_emails')) {
        row = {
          id: 901,
          username: params[0],
          send_at: new Date(`${params[1]}Z`),
          mail_options: params[2],
          display_metadata_json: params[3],
          draft_uid: params[4],
          payload_version: 2,
          submission_kind: params[5],
          submission_origin: params[6],
          idempotency_key: params[7],
          request_fingerprint: params[8],
          save_in_sent_items: params[9],
          status: 'scheduled',
          available_at: new Date(`${params[10]}Z`),
          attempts: 0,
          lease_owner: null,
          lease_expires_at: null,
          sender_address: params[11],
          message_id: params[12],
          envelope_json: params[13],
          rejected_recipients_json: null,
          raw_message: Buffer.from(params[14]),
          sent_raw_message: Buffer.from(params[15]),
          smtp_accepted_at: null,
          sent_copy_completed_at: null,
          completed_at: null,
          cancelled_at: null,
          removed_at: null,
          last_error_code: null,
          last_error_at: null,
        };
        return [{ insertId: row.id }, []];
      }
      if (compact.startsWith('INSERT INTO outbound_submission_registry')) {
        return [{ affectedRows: 1 }, []];
      }
      if (compact.includes('FROM scheduled_emails WHERE id = ? AND username = ?')) {
        return [[{ ...row, send_at_utc: row.send_at.toISOString() }], []];
      }
      throw new Error(`Unexpected database query: ${compact}`);
    },
  };
  const dependencies = {
    async getCredential() { sideEffects += 1; throw new Error('unexpected credential'); },
    createTransport() { sideEffects += 1; throw new Error('unexpected SMTP'); },
    async createImap() { sideEffects += 1; throw new Error('unexpected IMAP'); },
    async authorizeSender() { sideEffects += 1; throw new Error('unexpected authorization'); },
    async onAccepted() { sideEffects += 1; throw new Error('unexpected acceptance'); },
  };
  const input = {
    submissionKind: 'immediate',
    idempotencyKey: 'durable-before-bridge-key',
    fingerprintSource: { channel: 'web', subject: 'Durable before bridge' },
    message: {
      username: 'owner@example.test',
      sendAt: new Date('2026-08-16T12:00:00.000Z'),
      senderAddress: 'owner@example.test',
      messageId: '<durable-before-bridge@example.test>',
      envelope: { from: 'owner@example.test', to: ['recipient@example.net'] },
      raw: Buffer.from('Message-ID: <durable-before-bridge@example.test>\r\n\r\nTransport body'),
      sentRaw: Buffer.from('Message-ID: <durable-before-bridge@example.test>\r\nBcc: audit@example.net\r\n\r\nSent body'),
      metadata: { subject: 'Durable before bridge' },
    },
  };

  const activeRuntime = loadRuntime('active');
  const reserved = await activeRuntime.submitOutbound(db, input, { dependencies, workerId: 'active-request' });
  assert.equal(reserved.id, row.id);
  assert.equal(row.submission_kind, 'immediate');
  assert.equal(row.idempotency_key, input.idempotencyKey);
  assert.equal(sideEffects, 0);
  const beforeBridge = digestRow(row);

  phase = 'bridge';
  const bridgeRuntime = loadRuntime('bridge');
  await assert.rejects(
    bridgeRuntime.submitOutbound(db, input, { dependencies, workerId: 'bridge-retry' }),
    error => error instanceof bridgeRuntime.OutboundReleaseBridgeError,
  );
  assert.equal(await bridgeRuntime.runScheduledSender(dependencies, db, 'bridge-worker'), 0);

  assert.deepEqual(digestRow(row), beforeBridge);
  assert.equal(bridgeDatabaseCalls, 0);
  assert.equal(bridgeClaimMutations, 0);
  assert.equal(sideEffects, 0);
});
