const assert = require('node:assert/strict');
const test = require('node:test');

process.env.OMS_DB_PASSWORD ||= 'scheduled-send-store-test';

test('scheduled send schema upgrades legacy rows additively and installs claim indexes', async () => {
  const statements = [];
  const legacyColumns = ['id', 'username', 'send_at', 'mail_options', 'draft_uid', 'created_at'];
  const db = {
    async query(sql, params = []) {
      const compact = String(sql).replace(/\s+/g, ' ').trim();
      statements.push({ sql: compact, params });
      if (compact.includes('INFORMATION_SCHEMA.COLUMNS')) {
        return [legacyColumns.map(COLUMN_NAME => ({ COLUMN_NAME })), []];
      }
      if (compact.includes('INFORMATION_SCHEMA.STATISTICS')) {
        return [[{ INDEX_NAME: 'PRIMARY' }, { INDEX_NAME: 'idx_send_at' }], []];
      }
      if (compact.startsWith('INSERT INTO scheduled_emails')) return [{ insertId: 91 }, []];
      return [[], []];
    },
  };
  const { enqueueScheduledEmail, ensureScheduledEmailsSchema } = require('../src/scheduled-send.js');
  await ensureScheduledEmailsSchema(db);

  const transportRaw = Buffer.from('Message-ID: <persist@example.test>\r\n\r\nBody');
  const sentRaw = Buffer.from('Message-ID: <persist@example.test>\r\nBcc: private@example.test\r\n\r\nBody');
  assert.equal(await enqueueScheduledEmail(db, {
    username: 'owner@example.test',
    sendAt: new Date('2026-08-15T12:00:00.000Z'),
    senderAddress: 'owner@example.test',
    messageId: '<persist@example.test>',
    envelope: { from: 'owner@example.test', to: ['recipient@example.test', 'private@example.test'] },
    raw: transportRaw,
    sentRaw,
    metadata: { subject: 'Persist both MIME variants' },
  }), 91);

  const sql = statements.map(item => item.sql).join('\n');
  for (const column of [
    'payload_version', 'status', 'available_at', 'attempts', 'lease_owner', 'lease_expires_at',
    'sender_address', 'message_id', 'envelope_json', 'rejected_recipients_json', 'raw_message',
    'sent_raw_message', 'smtp_accepted_at',
    'sent_copy_completed_at', 'last_error_code', 'last_error_at', 'updated_at',
  ]) {
    assert.match(sql, new RegExp(`ADD COLUMN ${column}\\b`));
  }
  assert.match(sql, /UPDATE scheduled_emails SET status = COALESCE/);
  assert.match(sql, /ADD KEY idx_scheduled_claim/);
  assert.match(sql, /ADD KEY idx_scheduled_owner_state/);
  assert.doesNotMatch(sql, /DROP|TRUNCATE|DELETE FROM scheduled_emails/i);
  const insert = statements.find(item => item.sql.startsWith('INSERT INTO scheduled_emails'));
  assert.match(insert.sql, /raw_message, sent_raw_message/);
  assert.deepEqual(insert.params.slice(-2), [transportRaw, sentRaw]);
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
      if (compact.startsWith('SELECT * FROM scheduled_emails')) return [rows, []];
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

test('worker cycles do not overlap in-process and use a fresh claim token on each run', async () => {
  const claimTokens = [];
  let connectionCount = 0;
  let releaseFirstSelect;
  let firstSelectStarted;
  const firstSelectReady = new Promise(resolve => { firstSelectStarted = resolve; });
  const firstSelectGate = new Promise(resolve => { releaseFirstSelect = resolve; });
  const allColumns = [
    'id', 'username', 'send_at', 'mail_options', 'draft_uid', 'payload_version', 'status', 'available_at',
    'attempts', 'lease_owner', 'lease_expires_at', 'sender_address', 'message_id', 'envelope_json',
    'rejected_recipients_json', 'raw_message', 'sent_raw_message', 'smtp_accepted_at',
    'sent_copy_completed_at', 'completed_at', 'cancelled_at',
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
          if (compact.startsWith('SELECT * FROM scheduled_emails')) {
            if (number === 1) {
              firstSelectStarted();
              await firstSelectGate;
            }
            return [[acceptedRow()], []];
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

  assert.equal(connectionCount, 2);
  assert.equal(claimTokens.length, 2);
  assert.notEqual(claimTokens[0], claimTokens[1]);
});

test('terminal scheduled removal is owner-scoped and cannot delete active delivery state', async () => {
  const statements = [];
  let outcome = 'removed';
  const db = {
    async query(sql, params = []) {
      const compact = String(sql).replace(/\s+/g, ' ').trim();
      statements.push({ sql: compact, params });
      if (compact.startsWith('DELETE FROM scheduled_emails')) {
        return [{ affectedRows: outcome === 'removed' ? 1 : 0 }, []];
      }
      if (compact.startsWith('SELECT status FROM scheduled_emails')) {
        return [outcome === 'missing' ? [] : [{ status: 'smtp_inflight' }], []];
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

  const deletion = statements.find(statement => statement.sql.startsWith('DELETE FROM scheduled_emails'));
  assert.match(deletion.sql, /username = \?/);
  assert.match(deletion.sql, /status IN \('failed', 'delivery_uncertain', 'partial_delivery'\)/);
  assert.deepEqual(deletion.params, [41, 'owner@example.test']);
});
