const assert = require('node:assert/strict');
const test = require('node:test');

process.env.OMS_DB_PASSWORD ||= 'scheduled-send-store-test';

const transactionCapable = db => {
  db.getConnection = async () => ({
    async beginTransaction() {},
    async commit() {},
    async rollback() {},
    release() {},
    query: db.query.bind(db),
  });
  return db;
};

test('scheduled send schema upgrades legacy rows additively and installs claim indexes', async () => {
  const statements = [];
  const legacyColumns = ['id', 'username', 'send_at', 'mail_options', 'draft_uid', 'created_at'];
  const db = transactionCapable({
    async query(sql, params = []) {
      const compact = String(sql).replace(/\s+/g, ' ').trim();
      if (compact.startsWith('CREATE TABLE IF NOT EXISTS scheduled_emails')) return [[], []];
      if (compact.startsWith('CREATE TABLE IF NOT EXISTS outbound_submission_registry')) return [[], []];
      statements.push({ sql: compact, params });
      if (compact.includes('INFORMATION_SCHEMA.COLUMNS')) {
        return [legacyColumns.map(COLUMN_NAME => ({ COLUMN_NAME })), []];
      }
      if (compact.includes('INFORMATION_SCHEMA.STATISTICS')) {
        return [[{ INDEX_NAME: 'PRIMARY' }, { INDEX_NAME: 'idx_send_at' }], []];
      }
      if (compact.startsWith('INSERT INTO scheduled_emails')) return [{ insertId: 91 }, []];
      if (compact.includes('WHERE id = ? AND username = ?')) {
        return [[{
          id: 91,
          submission_kind: 'scheduled',
          status: 'scheduled',
          message_id: '<persist@example.test>',
          send_at: new Date('2026-08-15T12:00:00.000Z'),
          smtp_accepted_at: null,
          save_in_sent_items: 1,
          rejected_recipients_json: '[]',
          last_error_code: null,
        }], []];
      }
      return [[], []];
    },
  });
  const { submitOutbound } = require('../src/scheduled-send.js');

  const transportRaw = Buffer.from('Message-ID: <persist@example.test>\r\n\r\nBody');
  const sentRaw = Buffer.from('Message-ID: <persist@example.test>\r\nBcc: private@example.test\r\n\r\nBody');
  const sendAt = new Date('2026-08-15T12:00:00.000Z');
  const submission = await submitOutbound(db, {
    submissionKind: 'scheduled',
    idempotencyKey: 'scheduled-persistence-key',
    fingerprintSource: { subject: 'Persist both MIME variants' },
    message: {
      username: 'owner@example.test',
      sendAt,
      senderAddress: 'owner@example.test',
      messageId: '<persist@example.test>',
      envelope: { from: 'owner@example.test', to: ['recipient@example.test', 'private@example.test'] },
      raw: transportRaw,
      sentRaw,
      metadata: { subject: 'Persist both MIME variants' },
    },
  });
  assert.equal(submission.id, 91);
  assert.equal(submission.replayed, false);

  const sql = statements.map(item => item.sql).join('\n');
  for (const column of [
    'display_metadata_json', 'payload_version', 'submission_kind', 'submission_origin',
    'idempotency_key', 'request_fingerprint', 'save_in_sent_items',
    'status', 'available_at', 'attempts', 'lease_owner', 'lease_expires_at',
    'sender_address', 'message_id', 'envelope_json', 'rejected_recipients_json', 'raw_message',
    'sent_raw_message', 'smtp_accepted_at',
    'sent_copy_completed_at', 'removed_at', 'last_error_code', 'last_error_at', 'updated_at',
  ]) {
    assert.match(sql, new RegExp(`ADD COLUMN ${column}\\b`));
  }
  assert.match(sql, /UPDATE scheduled_emails SET status = COALESCE/);
  assert.match(sql, /ADD KEY idx_scheduled_claim/);
  assert.match(sql, /ADD KEY idx_scheduled_owner_state/);
  assert.match(sql, /ADD UNIQUE KEY uq_scheduled_owner_idempotency \(username, idempotency_key\)/);
  assert.doesNotMatch(sql, /DROP|TRUNCATE|DELETE FROM scheduled_emails/i);
  assert.equal(
    statements.filter(item => item.sql.startsWith('ALTER TABLE scheduled_emails')).length,
    2,
    'the additive bridge should need one column DDL and one index DDL',
  );
  const insert = statements.find(item => item.sql.startsWith('INSERT INTO scheduled_emails'));
  assert.match(insert.sql, /submission_kind, submission_origin, idempotency_key, request_fingerprint/);
  assert.match(insert.sql, /raw_message, sent_raw_message/);
  assert.equal(insert.params[5], 'scheduled');
  assert.equal(insert.params[6], 'web');
  assert.equal(insert.params[7], 'scheduled-persistence-key');
  assert.equal(insert.params[1], '2026-08-15 12:00:00');
  assert.equal(insert.params[10], '2026-08-15 12:00:00');
  assert.deepEqual(insert.params.slice(-2), [transportRaw, sentRaw]);
});

test('outbound request fingerprints are canonical and attachment-byte sensitive', () => {
  const { computeOutboundRequestFingerprint } = require('../src/scheduled-send.js');
  const first = computeOutboundRequestFingerprint({
    submissionKind: 'immediate',
    sendAt: new Date('2026-08-15T12:00:00.000Z'),
    username: 'OWNER@example.test',
    senderAddress: 'Owner@example.test',
    recipients: ['Second@example.net', 'first@example.net'],
    fingerprintSource: {
      subject: 'Stable',
      nested: { b: true, a: 7 },
      attachment: Buffer.from('same bytes'),
    },
  });
  const reordered = computeOutboundRequestFingerprint({
    submissionKind: 'immediate',
    sendAt: new Date('2026-08-16T12:00:00.000Z'),
    username: 'owner@example.test',
    senderAddress: 'owner@example.test',
    recipients: ['second@example.net', 'FIRST@example.net'],
    fingerprintSource: {
      attachment: Buffer.from('same bytes'),
      nested: { a: 7, b: true },
      subject: 'Stable',
    },
  });
  const changedAttachment = computeOutboundRequestFingerprint({
    submissionKind: 'immediate',
    sendAt: new Date('2026-08-15T12:00:00.000Z'),
    username: 'owner@example.test',
    senderAddress: 'owner@example.test',
    recipients: ['second@example.net', 'first@example.net'],
    fingerprintSource: {
      subject: 'Stable',
      nested: { b: true, a: 7 },
      attachment: Buffer.from('different bytes'),
    },
  });

  assert.match(first, /^[0-9a-f]{64}$/);
  assert.equal(reordered, first, 'immediate time, object key order, and mailbox case are not logical changes');
  assert.notEqual(changedAttachment, first);
});

test('same-key replay is a no-send projection and changed content conflicts', async () => {
  const allColumns = [
    'id', 'username', 'send_at', 'mail_options', 'display_metadata_json', 'draft_uid', 'payload_version', 'submission_kind',
    'submission_origin',
    'idempotency_key', 'request_fingerprint', 'save_in_sent_items', 'status', 'available_at',
    'attempts', 'lease_owner', 'lease_expires_at', 'sender_address', 'message_id', 'envelope_json',
    'rejected_recipients_json', 'raw_message', 'sent_raw_message', 'smtp_accepted_at',
    'sent_copy_completed_at', 'completed_at', 'cancelled_at', 'removed_at', 'last_error_code', 'last_error_at',
    'created_at', 'updated_at',
  ];
  let persistedFingerprint = '';
  let insertAttempts = 0;
  let firstInsertParams;
  const db = transactionCapable({
    async query(sql, params = []) {
      const compact = String(sql).replace(/\s+/g, ' ').trim();
      if (compact.startsWith('CREATE TABLE IF NOT EXISTS scheduled_emails')) return [[], []];
      if (compact.startsWith('CREATE TABLE IF NOT EXISTS outbound_submission_registry')) return [[], []];
      if (compact.includes('INFORMATION_SCHEMA.COLUMNS')) {
        return [allColumns.map(COLUMN_NAME => ({
          COLUMN_NAME,
          COLUMN_TYPE: COLUMN_NAME === 'attempts' ? 'int unsigned' : '',
        })), []];
      }
      if (compact.includes('INFORMATION_SCHEMA.STATISTICS')) {
        return [[
          { INDEX_NAME: 'idx_scheduled_claim' },
          { INDEX_NAME: 'idx_scheduled_owner_state' },
          { INDEX_NAME: 'uq_scheduled_owner_idempotency' },
        ], []];
      }
      if (compact.startsWith('UPDATE scheduled_emails')) return [{ affectedRows: 0 }, []];
      if (compact.startsWith('INSERT INTO scheduled_emails')) {
        insertAttempts += 1;
        firstInsertParams ||= params;
        persistedFingerprint ||= params[8];
        const error = new Error('duplicate');
        error.code = 'ER_DUP_ENTRY';
        throw error;
      }
      if (compact.includes('WHERE username = ? AND idempotency_key = ?')) {
        return [[{
          id: 81,
          submission_kind: 'immediate',
          status: 'completed',
          message_id: '<same@example.test>',
          send_at: new Date('2026-08-15T12:00:00.000Z'),
          smtp_accepted_at: new Date('2026-08-15T12:00:01.000Z'),
          save_in_sent_items: 1,
          rejected_recipients_json: '[]',
          last_error_code: null,
          request_fingerprint: persistedFingerprint,
        }], []];
      }
      throw new Error(`Unexpected query: ${compact}`);
    },
  });
  const message = {
    username: 'owner@example.test',
    sendAt: new Date('2026-08-15T12:00:00.000Z'),
    senderAddress: 'owner@example.test',
    messageId: '<same@example.test>',
    envelope: { from: 'owner@example.test', to: ['recipient@example.net'] },
    raw: Buffer.from('Message-ID: <same@example.test>\r\n\r\nBody'),
    metadata: { subject: 'Same' },
  };
  const dependencies = {
    async getCredential() { throw new Error('replay must not load credentials'); },
    createTransport() { throw new Error('replay must not use SMTP'); },
    async createImap() { throw new Error('replay must not use IMAP'); },
    async authorizeSender() { throw new Error('replay must not authorize again'); },
    async onAccepted() { throw new Error('replay must not run acceptance side effects'); },
  };
  const {
    OutboundIdempotencyConflictError,
    submitOutbound,
  } = require('../src/scheduled-send.js');

  const replay = await submitOutbound(db, {
    submissionKind: 'immediate',
    idempotencyKey: 'same-key',
    fingerprintSource: { subject: 'Same', attachment: Buffer.from('same') },
    message,
    requestCredential: 'must-not-be-read',
  }, { dependencies });
  assert.equal(replay.replayed, true);
  assert.equal(replay.status, 'completed');
  assert.equal(firstInsertParams[5], 'immediate');
  assert.equal(firstInsertParams[6], 'web');
  assert.equal(firstInsertParams[7], 'same-key');
  assert.match(firstInsertParams[8], /^[0-9a-f]{64}$/);
  assert.equal(firstInsertParams[9], 1);
  assert.match(firstInsertParams[10], /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  assert.equal(firstInsertParams[11], 'owner@example.test');
  assert.equal(firstInsertParams[12], '<same@example.test>');
  assert.deepEqual(JSON.parse(firstInsertParams[13]), message.envelope);
  assert.equal(firstInsertParams[14], message.raw);
  assert.equal(firstInsertParams[15], message.raw);

  await assert.rejects(
    submitOutbound(db, {
      submissionKind: 'immediate',
      idempotencyKey: 'same-key',
      fingerprintSource: { subject: 'Changed', attachment: Buffer.from('same') },
      message,
      requestCredential: 'must-not-be-read',
    }, { dependencies }),
    error => error instanceof OutboundIdempotencyConflictError
      && error.code === 'OUTBOUND_IDEMPOTENCY_CONFLICT'
      && error.status === 409,
  );
  assert.equal(insertAttempts, 2);
});

test('scheduled same-key replay survives a soft hide and changed content conflicts', async () => {
  const allColumns = [
    'id', 'username', 'send_at', 'mail_options', 'display_metadata_json', 'draft_uid', 'payload_version', 'submission_kind',
    'submission_origin',
    'idempotency_key', 'request_fingerprint', 'save_in_sent_items', 'status', 'available_at',
    'attempts', 'lease_owner', 'lease_expires_at', 'sender_address', 'message_id', 'envelope_json',
    'rejected_recipients_json', 'raw_message', 'sent_raw_message', 'smtp_accepted_at',
    'sent_copy_completed_at', 'completed_at', 'cancelled_at', 'removed_at', 'last_error_code', 'last_error_at',
    'created_at', 'updated_at',
  ];
  let persistedFingerprint = '';
  let insertAttempts = 0;
  const db = transactionCapable({
    async query(sql, params = []) {
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
        insertAttempts += 1;
        persistedFingerprint ||= params[8];
        const error = new Error('duplicate');
        error.code = 'ER_DUP_ENTRY';
        throw error;
      }
      if (compact.includes('WHERE username = ? AND idempotency_key = ?')) {
        return [[{
          id: 82,
          submission_kind: 'scheduled',
          status: 'delivery_uncertain',
          message_id: '<scheduled-same@example.test>',
          send_at: new Date('2026-08-16T12:00:00.000Z'),
          smtp_accepted_at: null,
          save_in_sent_items: 1,
          rejected_recipients_json: '[]',
          last_error_code: null,
          removed_at: new Date('2026-08-16T12:05:00.000Z'),
          request_fingerprint: persistedFingerprint,
        }], []];
      }
      throw new Error(`Unexpected query: ${compact}`);
    },
  });
  const message = {
    username: 'owner@example.test',
    sendAt: new Date('2026-08-16T12:00:00.000Z'),
    senderAddress: 'owner@example.test',
    messageId: '<scheduled-same@example.test>',
    envelope: { from: 'owner@example.test', to: ['recipient@example.net'] },
    raw: Buffer.from('Message-ID: <scheduled-same@example.test>\r\n\r\nBody'),
    metadata: { subject: 'Scheduled same' },
  };
  const {
    OutboundIdempotencyConflictError,
    submitOutbound,
  } = require('../src/scheduled-send.js');

  const replay = await submitOutbound(db, {
    submissionKind: 'scheduled',
    idempotencyKey: 'scheduled-same-key',
    fingerprintSource: { subject: 'Scheduled same' },
    message,
  });
  assert.equal(replay.replayed, true);
  assert.equal(replay.submissionKind, 'scheduled');
  assert.equal(replay.status, 'delivery_uncertain');

  await assert.rejects(
    submitOutbound(db, {
      submissionKind: 'scheduled',
      idempotencyKey: 'scheduled-same-key',
      fingerprintSource: { subject: 'Scheduled changed' },
      message,
    }),
    error => error instanceof OutboundIdempotencyConflictError
      && error.code === 'OUTBOUND_IDEMPOTENCY_CONFLICT'
      && error.status === 409,
  );
  assert.equal(insertAttempts, 2);
});

test('immediate and scheduled submission keys fail closed before persistence or delivery', async () => {
  const allColumns = [
    'id', 'username', 'send_at', 'mail_options', 'display_metadata_json', 'draft_uid', 'payload_version', 'submission_kind',
    'submission_origin',
    'idempotency_key', 'request_fingerprint', 'save_in_sent_items', 'status', 'available_at',
    'attempts', 'lease_owner', 'lease_expires_at', 'sender_address', 'message_id', 'envelope_json',
    'rejected_recipients_json', 'raw_message', 'sent_raw_message', 'smtp_accepted_at',
    'sent_copy_completed_at', 'completed_at', 'cancelled_at', 'removed_at', 'last_error_code', 'last_error_at',
    'created_at', 'updated_at',
  ];
  let writes = 0;
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
      writes += 1;
      throw new Error(`Unexpected write: ${compact}`);
    },
  };
  const { OutboundIdempotencyKeyError, submitOutbound } = require('../src/scheduled-send.js');
  const message = {
    username: 'owner@example.test',
    sendAt: new Date(),
    senderAddress: 'owner@example.test',
    messageId: '<never@example.test>',
    envelope: { from: 'owner@example.test', to: ['recipient@example.net'] },
    raw: Buffer.from('never'),
    metadata: {},
  };
  for (const submissionKind of ['immediate', 'scheduled']) {
    for (const idempotencyKey of [null, '', 'not ascii \u2603']) {
      await assert.rejects(submitOutbound(db, {
        submissionKind,
        idempotencyKey,
        fingerprintSource: { subject: 'Never sent' },
        message,
      }), error => error instanceof OutboundIdempotencyKeyError
        && error.code === 'OUTBOUND_IDEMPOTENCY_KEY_INVALID'
        && error.status === 400, `${submissionKind}: ${String(idempotencyKey)}`);
    }
  }
  assert.equal(writes, 0);
});

test('scheduled send claims are transactional and owner cancellation cannot race a claim', async () => {
  const statements = [];
  const rows = [{
    id: 7,
    username: 'owner@example.test',
    status: 'scheduled',
    attempts: 0,
    send_at: new Date(),
    mail_options: '{}',
    draft_uid: null,
  }];
  const connection = {
    async beginTransaction() { statements.push({ sql: 'BEGIN', params: [] }); },
    async commit() { statements.push({ sql: 'COMMIT', params: [] }); },
    async rollback() { statements.push({ sql: 'ROLLBACK', params: [] }); },
    release() { statements.push({ sql: 'RELEASE', params: [] }); },
    async query(sql, params = []) {
      const compact = String(sql).replace(/\s+/g, ' ').trim();
      statements.push({ sql: compact, params });
      if (compact.includes("WHERE idempotency_key IS NULL AND status = 'scheduled'")) return [rows, []];
      if (compact.includes("WHERE (idempotency_key IS NOT NULL OR status <> 'scheduled')")) return [[], []];
      return [{ affectedRows: 1 }, []];
    },
  };
  const db = {
    async getConnection() { return connection; },
    async query(sql, params = []) {
      const compact = String(sql).replace(/\s+/g, ' ').trim();
      statements.push({ sql: compact, params });
      if (compact.startsWith("UPDATE scheduled_emails SET status = 'cancel_restore_pending'")) {
        return [{ affectedRows: 0 }, []];
      }
      if (compact.startsWith('SELECT status FROM scheduled_emails')) return [[{ status: 'claimed' }], []];
      throw new Error(`Unexpected query: ${compact}`);
    },
  };
  const { MySqlScheduledEmailStore, claimScheduledCancellation } = require('../src/scheduled-send.js');
  const store = new MySqlScheduledEmailStore(db);
  const claimed = await store.claimBatch('worker-7', 25);

  assert.equal(claimed.length, 1);
  assert.equal(claimed[0].status, 'claimed');
  assert.equal(claimed[0].attempts, 1);
  const claimSql = statements.map(item => item.sql).join('\n');
  assert.match(claimSql, /FOR UPDATE SKIP LOCKED/);
  assert.match(claimSql, /status = 'delivery_uncertain'.*status = 'smtp_inflight'/s);
  assert.match(claimSql, /status = 'retry_wait'.*status = 'claimed'/s);
  assert.ok(statements.findIndex(item => item.sql === 'BEGIN') < statements.findIndex(item => item.sql.includes('FOR UPDATE SKIP LOCKED')));
  assert.ok(statements.findIndex(item => item.sql.includes('FOR UPDATE SKIP LOCKED')) < statements.findIndex(item => item.sql === 'COMMIT'));

  const cancellation = await claimScheduledCancellation(db, 7, 'owner@example.test', 'cancel-7');
  assert.equal(cancellation.outcome, 'conflict');
  const cancelUpdate = statements.find(item => item.sql.startsWith("UPDATE scheduled_emails SET status = 'cancel_restore_pending'"));
  assert.match(cancelUpdate.sql, /username = \?/);
  assert.match(cancelUpdate.sql, /submission_kind = 'scheduled'/);
  assert.match(cancelUpdate.sql, /status IN \('scheduled', 'retry_wait'\)/);
  assert.doesNotMatch(claimSql, /DELETE FROM scheduled_emails/i);
});

test('cancellation retains the queued payload until its Draft restore is durable', async () => {
  const statements = [];
  const queuedRow = {
    id: 44,
    username: 'owner@example.test',
    status: 'cancel_restore_pending',
    draft_uid: 19,
    message_id: '<undo@example.test>',
    raw_message: Buffer.from('Message-ID: <undo@example.test>\r\n\r\nExact body'),
  };
  const db = {
    async query(sql, params = []) {
      const compact = String(sql).replace(/\s+/g, ' ').trim();
      statements.push({ sql: compact, params });
      if (compact.startsWith("UPDATE scheduled_emails SET status = 'cancel_restore_pending'")) {
        return [{ affectedRows: 1 }, []];
      }
      if (compact.startsWith('SELECT * FROM scheduled_emails')) return [[queuedRow], []];
      if (compact.startsWith("UPDATE scheduled_emails SET status = 'cancelled'")) {
        return [{ affectedRows: 1 }, []];
      }
      throw new Error(`Unexpected query: ${compact}`);
    },
  };
  const {
    claimScheduledCancellation,
    completeScheduledCancellation,
  } = require('../src/scheduled-send.js');

  const claim = await claimScheduledCancellation(db, 44, 'owner@example.test', 'cancel-44');
  assert.equal(claim.outcome, 'ready');
  assert.equal(claim.row.raw_message.toString(), queuedRow.raw_message.toString());
  const claimUpdate = statements.find(item => item.sql.startsWith("UPDATE scheduled_emails SET status = 'cancel_restore_pending'"));
  assert.doesNotMatch(claimUpdate.sql, /raw_message\s*=\s*NULL|mail_options\s*=\s*'\{\}'/i);

  await completeScheduledCancellation(db, 44, 'owner@example.test', 'cancel-44', 27);
  const completeUpdate = statements.find(item => item.sql.startsWith("UPDATE scheduled_emails SET status = 'cancelled'"));
  assert.match(completeUpdate.sql, /raw_message = NULL/);
  assert.match(completeUpdate.sql, /sent_raw_message = NULL/);
  assert.match(completeUpdate.sql, /draft_uid = \?/);
  assert.deepEqual(completeUpdate.params.slice(-4), [27, 44, 'owner@example.test', 'cancel-44']);
});

test('terminal immediate outcomes scrub mail content while scheduled recovery payload stays available', async () => {
  const statements = [];
  const db = {
    async query(sql, params = []) {
      const compact = String(sql).replace(/\s+/g, ' ').trim();
      statements.push({ sql: compact, params });
      return [{ affectedRows: 1 }, []];
    },
  };
  const { MySqlScheduledEmailStore } = require('../src/scheduled-send.js');
  const store = new MySqlScheduledEmailStore(db);
  const baseRow = { id: 51, attempts: 1 };

  await store.failed(baseRow, 'worker-51', 'smtp_550');
  await store.uncertain({ ...baseRow, id: 52 }, 'worker-52', 'smtp_timeout');
  await store.complete({
    ...baseRow,
    id: 53,
    rejected_recipients_json: '["rejected@example.test"]',
  }, 'worker-53');

  const failed = statements.find(statement => statement.sql.includes("SET status = 'failed'"));
  const uncertain = statements.find(statement => statement.sql.includes("SET status = 'delivery_uncertain'"));
  const partial = statements.find(statement => statement.sql.includes("SET status = 'partial_delivery'"));
  for (const statement of [failed, uncertain]) {
    assert.match(statement.sql, /raw_message = CASE WHEN submission_kind = 'immediate' THEN NULL ELSE raw_message END/);
    assert.match(statement.sql, /sent_raw_message = CASE WHEN submission_kind = 'immediate' THEN NULL ELSE sent_raw_message END/);
    assert.match(statement.sql, /envelope_json = CASE WHEN submission_kind = 'immediate' THEN NULL ELSE envelope_json END/);
    assert.match(statement.sql, /mail_options = CASE WHEN submission_kind = 'immediate' THEN '\{\}' ELSE mail_options END/);
  }
  assert.match(partial.sql, /mail_options = CASE WHEN submission_kind = 'immediate' THEN '\{\}' ELSE mail_options END/);
  assert.doesNotMatch(partial.sql, /mail_options = '\{\}'/);
});

test('worker cycles do not overlap in-process and use a fresh claim token on each run', async () => {
  const claimTokens = [];
  let connectionCount = 0;
  let releaseFirstSelect;
  let firstSelectStarted;
  const firstSelectReady = new Promise(resolve => { firstSelectStarted = resolve; });
  const firstSelectGate = new Promise(resolve => { releaseFirstSelect = resolve; });
  const allColumns = [
    'id', 'username', 'send_at', 'mail_options', 'display_metadata_json', 'draft_uid', 'payload_version',
    'submission_kind', 'submission_origin', 'idempotency_key', 'request_fingerprint',
    'save_in_sent_items', 'status', 'available_at',
    'attempts', 'lease_owner', 'lease_expires_at', 'sender_address', 'message_id', 'envelope_json',
    'rejected_recipients_json', 'raw_message', 'sent_raw_message', 'smtp_accepted_at',
    'sent_copy_completed_at', 'completed_at', 'cancelled_at', 'removed_at',
    'last_error_code', 'last_error_at', 'created_at', 'updated_at',
  ];
  const acceptedRow = () => ({
    id: 9,
    username: 'owner@example.test',
    send_at: new Date(),
    mail_options: '{}',
    draft_uid: null,
    payload_version: 2,
    status: 'sent_copy_pending',
    attempts: 1,
    sender_address: 'owner@example.test',
    message_id: '<cycle@example.test>',
    envelope_json: JSON.stringify({ from: 'owner@example.test', to: ['recipient@example.net'] }),
    raw_message: Buffer.from('Message-ID: <cycle@example.test>\r\n\r\nBody'),
    smtp_accepted_at: new Date(),
  });
  const db = {
    async query(sql) {
      const compact = String(sql).replace(/\s+/g, ' ').trim();
      if (compact.includes('INFORMATION_SCHEMA.COLUMNS')) return [allColumns.map(COLUMN_NAME => ({ COLUMN_NAME })), []];
      if (compact.includes('INFORMATION_SCHEMA.STATISTICS')) {
        return [[{ INDEX_NAME: 'idx_scheduled_claim' }, { INDEX_NAME: 'idx_scheduled_owner_state' }], []];
      }
      if (compact.startsWith('UPDATE scheduled_emails')) return [{ affectedRows: 1 }, []];
      return [[], []];
    },
    async getConnection() {
      connectionCount += 1;
      const number = connectionCount;
      return {
        async beginTransaction() {}, async commit() {}, async rollback() {}, release() {},
        async query(sql, params = []) {
          const compact = String(sql).replace(/\s+/g, ' ').trim();
          if (compact.includes("WHERE idempotency_key IS NULL AND status = 'scheduled'")) {
            return [[], []];
          }
          if (compact.includes("WHERE (idempotency_key IS NOT NULL OR status <> 'scheduled')")) {
            if (number === 1) {
              firstSelectStarted();
              await firstSelectGate;
            }
            return [number % 2 === 1 ? [acceptedRow()] : [], []];
          }
          if (compact.includes('lease_owner = ?')) claimTokens.push(params[0]);
          return [{ affectedRows: 1 }, []];
        },
      };
    },
  };
  const dependencies = {
    async getCredential() { return ''; },
    createTransport() { throw new Error('accepted rows must not use SMTP'); },
    async createImap() {
      return {
        client: { async mailboxOpen() {}, async search() { return [1]; }, close() {} },
        async getFolders() { return [{ path: 'Sent' }]; }, async appendMessage() {}, async logout() {},
      };
    },
    async authorizeSender() { throw new Error('accepted rows must not reauthorize'); },
  };
  const { runScheduledSender } = require('../src/scheduled-send.js');
  const first = runScheduledSender(dependencies, db);
  await firstSelectReady;
  assert.equal(await runScheduledSender(dependencies, db), 0);
  releaseFirstSelect();
  assert.equal(await first, 1);
  assert.equal(await runScheduledSender(dependencies, db), 1);

  assert.equal(connectionCount, 4);
  assert.equal(claimTokens.length, 2);
  assert.notEqual(claimTokens[0], claimTokens[1]);
});

test('worker claims each queued row only after the previous row finishes', async () => {
  const claimedIds = [];
  let selectCount = 0;
  let releaseFirstProcess;
  let firstProcessStarted;
  const firstProcessReady = new Promise(resolve => { firstProcessStarted = resolve; });
  const firstProcessGate = new Promise(resolve => { releaseFirstProcess = resolve; });
  const allColumns = [
    'id', 'username', 'send_at', 'mail_options', 'display_metadata_json', 'draft_uid', 'payload_version',
    'submission_kind', 'submission_origin', 'idempotency_key', 'request_fingerprint',
    'save_in_sent_items', 'status', 'available_at',
    'attempts', 'lease_owner', 'lease_expires_at', 'sender_address', 'message_id', 'envelope_json',
    'rejected_recipients_json', 'raw_message', 'sent_raw_message', 'smtp_accepted_at',
    'sent_copy_completed_at', 'completed_at', 'cancelled_at', 'removed_at',
    'last_error_code', 'last_error_at', 'created_at', 'updated_at',
  ];
  const acceptedRow = id => ({
    id,
    username: 'owner@example.test',
    send_at: new Date(),
    mail_options: '{}',
    draft_uid: null,
    payload_version: 2,
    submission_kind: 'scheduled',
    save_in_sent_items: 1,
    status: 'sent_copy_pending',
    attempts: 1,
    sender_address: 'owner@example.test',
    message_id: `<claim-${id}@example.test>`,
    envelope_json: JSON.stringify({ from: 'owner@example.test', to: ['recipient@example.net'] }),
    raw_message: Buffer.from(`Message-ID: <claim-${id}@example.test>\r\n\r\nBody`),
    smtp_accepted_at: new Date(),
  });
  const db = {
    async query(sql) {
      const compact = String(sql).replace(/\s+/g, ' ').trim();
      if (compact.includes('INFORMATION_SCHEMA.COLUMNS')) return [allColumns.map(COLUMN_NAME => ({ COLUMN_NAME })), []];
      if (compact.includes('INFORMATION_SCHEMA.STATISTICS')) {
        return [[
          { INDEX_NAME: 'idx_scheduled_claim' },
          { INDEX_NAME: 'idx_scheduled_owner_state' },
          { INDEX_NAME: 'uq_scheduled_owner_idempotency' },
        ], []];
      }
      if (compact.startsWith('UPDATE scheduled_emails')) return [{ affectedRows: 1 }, []];
      return [[], []];
    },
    async getConnection() {
      return {
        async beginTransaction() {}, async commit() {}, async rollback() {}, release() {},
        async query(sql, params = []) {
          const compact = String(sql).replace(/\s+/g, ' ').trim();
          if (compact.includes("WHERE idempotency_key IS NULL AND status = 'scheduled'")) {
            return [[], []];
          }
          if (compact.includes("WHERE (idempotency_key IS NOT NULL OR status <> 'scheduled')")) {
            selectCount += 1;
            assert.equal(params[0], 1, 'each UTC-basis claim must be bounded to one row');
            return [selectCount <= 2 ? [acceptedRow(selectCount)] : [], []];
          }
          if (compact.includes('SET attempts = attempts + 1')) claimedIds.push(Number(params[1]));
          return [{ affectedRows: 1 }, []];
        },
      };
    },
  };
  let imapCalls = 0;
  const dependencies = {
    async getCredential() { return ''; },
    createTransport() { throw new Error('accepted rows must not use SMTP'); },
    async createImap() {
      imapCalls += 1;
      if (imapCalls === 1) {
        firstProcessStarted();
        await firstProcessGate;
      }
      return {
        client: { async mailboxOpen() {}, async search() { return [1]; }, close() {} },
        async getFolders() { return [{ path: 'Sent' }]; }, async appendMessage() {}, async logout() {},
      };
    },
    async authorizeSender() { throw new Error('accepted rows must not reauthorize'); },
  };
  const { runScheduledSender } = require('../src/scheduled-send.js');
  const run = runScheduledSender(dependencies, db, 'claim-on-demand-worker');
  await firstProcessReady;
  assert.deepEqual(claimedIds, [1]);
  assert.equal(selectCount, 1);
  releaseFirstProcess();
  assert.equal(await run, 2);
  assert.deepEqual(claimedIds, [1, 2]);
  assert.equal(selectCount, 3);
});

test('terminal scheduled removal soft-hides and scrubs without erasing its replay tombstone', async () => {
  const statements = [];
  let outcome = 'removed';
  const db = {
    async query(sql, params = []) {
      const compact = String(sql).replace(/\s+/g, ' ').trim();
      statements.push({ sql: compact, params });
      if (compact.startsWith('UPDATE scheduled_emails SET removed_at')) {
        return [{ affectedRows: outcome === 'removed' ? 1 : 0 }, []];
      }
      if (compact.startsWith('SELECT status, removed_at FROM scheduled_emails')) {
        if (outcome === 'missing') return [[], []];
        return [[{
          status: 'smtp_inflight',
          removed_at: outcome === 'already_removed' ? new Date() : null,
        }], []];
      }
      throw new Error(`Unexpected query: ${compact}`);
    },
  };
  const { removeTerminalScheduledEmail } = require('../src/scheduled-send.js');

  assert.equal(await removeTerminalScheduledEmail(db, 41, 'owner@example.test'), 'removed');
  outcome = 'conflict';
  assert.equal(await removeTerminalScheduledEmail(db, 42, 'owner@example.test'), 'conflict');
  outcome = 'missing';
  assert.equal(await removeTerminalScheduledEmail(db, 43, 'owner@example.test'), 'not_found');
  outcome = 'already_removed';
  assert.equal(await removeTerminalScheduledEmail(db, 44, 'owner@example.test'), 'not_found');

  const removal = statements.find(statement => statement.sql.startsWith('UPDATE scheduled_emails SET removed_at'));
  assert.match(removal.sql, /username = \?/);
  assert.match(removal.sql, /status IN \('failed', 'delivery_uncertain', 'partial_delivery'\)/);
  assert.match(removal.sql, /removed_at IS NULL/);
  assert.match(removal.sql, /raw_message = NULL/);
  assert.match(removal.sql, /sent_raw_message = NULL/);
  assert.match(removal.sql, /envelope_json = NULL/);
  assert.match(removal.sql, /mail_options = '\{\}'/);
  const changedFields = removal.sql.slice(0, removal.sql.indexOf(' WHERE '));
  assert.doesNotMatch(changedFields, /idempotency_key|request_fingerprint|status\s*=/);
  assert.deepEqual(removal.params, [41, 'owner@example.test']);
});
