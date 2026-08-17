const assert = require('node:assert/strict');
const test = require('node:test');

process.env.OMS_DB_PASSWORD ||= 'scheduled-send-db-test';

test('universal outbox migration, reservation, and claim races on disposable MariaDB', {
  skip: process.env.OMS_SCHEDULED_SEND_DB_TEST !== '1',
  timeout: 30_000,
}, async t => {
  const originalTimeZone = process.env.TZ;
  process.env.TZ = 'Pacific/Kiritimati';
  const databaseName = String(process.env.OMS_DB_NAME || 'postfixadmin');
  assert.match(databaseName, /(^|[_-])(test|ci|tmp|disposable)([_-]|$)/i,
    'OMS_SCHEDULED_SEND_DB_TEST requires OMS_DB_NAME to identify an isolated disposable database');

  const { pool } = require('../src/db.js');
  const {
    MySqlScheduledEmailStore,
    OutboundIdempotencyConflictError,
    claimScheduledCancellation,
    ensureScheduledEmailsSchema,
    getOutboundSubmission,
    removeTerminalScheduledEmail,
    submitOutbound,
  } = require('../src/scheduled-send.js');
  t.after(async () => {
    try {
      await pool.query('DROP TABLE IF EXISTS outbound_submission_registry');
      await pool.query('DROP TABLE IF EXISTS scheduled_emails');
      await pool.end();
    } finally {
      if (originalTimeZone === undefined) delete process.env.TZ;
      else process.env.TZ = originalTimeZone;
    }
  });

  await pool.query('DROP TABLE IF EXISTS outbound_submission_registry');
  await pool.query('DROP TABLE IF EXISTS scheduled_emails');
  await pool.query(`
    CREATE TABLE scheduled_emails (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      username VARCHAR(255) NOT NULL,
      send_at DATETIME NOT NULL,
      mail_options MEDIUMTEXT NOT NULL,
      draft_uid BIGINT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      KEY idx_send_at (send_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  const [preflightColumns] = await pool.query(
    `SELECT COLUMN_NAME, COLUMN_TYPE, IS_NULLABLE
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'scheduled_emails'
     ORDER BY ORDINAL_POSITION`,
  );
  assert.deepEqual(preflightColumns.map(row => [row.COLUMN_NAME, row.COLUMN_TYPE, row.IS_NULLABLE]), [
    ['id', 'bigint(20)', 'NO'],
    ['username', 'varchar(255)', 'NO'],
    ['send_at', 'datetime', 'NO'],
    ['mail_options', 'mediumtext', 'NO'],
    ['draft_uid', 'bigint(20)', 'YES'],
    ['created_at', 'timestamp', 'YES'],
  ]);
  const [preflightTable] = await pool.query(
    `SELECT ENGINE, TABLE_COLLATION
     FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'scheduled_emails'`,
  );
  assert.deepEqual([preflightTable[0].ENGINE, preflightTable[0].TABLE_COLLATION], [
    'InnoDB',
    'utf8mb4_unicode_ci',
  ]);
  const [preflightIndexes] = await pool.query(
    `SELECT DISTINCT INDEX_NAME
     FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'scheduled_emails'
     ORDER BY INDEX_NAME`,
  );
  assert.deepEqual(preflightIndexes.map(row => row.INDEX_NAME), ['idx_send_at', 'PRIMARY']);
  const [legacyInsert] = await pool.query(
    `INSERT INTO scheduled_emails (username, send_at, mail_options, draft_uid)
     VALUES ('owner@example.test', DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 SECOND),
             '{"from":"owner@example.test","to":"recipient@example.net","text":"legacy"}', 417)`,
  );
  const [[legacyBeforeMigration]] = await pool.query(
    `SELECT username, send_at, mail_options, draft_uid, created_at
     FROM scheduled_emails WHERE id = ?`,
    [legacyInsert.insertId],
  );
  const legacyProjectionInstant = new Date('2037-01-01T12:04:05.000Z');
  const [legacyProjectionInsert] = await pool.query(
    `INSERT INTO scheduled_emails (username, send_at, mail_options, draft_uid)
     VALUES (?, ?, '{}', NULL)`,
    ['legacy-projection@example.test', legacyProjectionInstant],
  );
  const localWallNotDueInstant = new Date(Date.now() + 120_000);
  const [legacyLocalClaimInsert] = await pool.query(
    `INSERT INTO scheduled_emails (username, send_at, mail_options, draft_uid)
     VALUES (?, ?, '{}', NULL)`,
    ['legacy-local-claim@example.test', localWallNotDueInstant],
  );
  const [legacyRetryInsert] = await pool.query(
    `INSERT INTO scheduled_emails (username, send_at, mail_options, draft_uid)
     VALUES (?, ?, '{}', NULL)`,
    ['legacy-retry@example.test', new Date(Date.now() + 180_000)],
  );
  await ensureScheduledEmailsSchema(pool);
  await ensureScheduledEmailsSchema({ query: pool.query.bind(pool) });

  const [[legacyProjectionStored]] = await pool.query(
    `SELECT DATE_FORMAT(send_at, '%Y-%m-%d %H:%i:%s') AS send_at_literal
     FROM scheduled_emails WHERE id = ?`,
    [legacyProjectionInsert.insertId],
  );
  assert.equal(legacyProjectionStored.send_at_literal, '2037-01-02 02:04:05',
    'the fixture must exercise mysql2 historical local-wall Date serialization');
  const legacyProjection = await getOutboundSubmission(
    pool,
    'legacy-projection@example.test',
    { id: Number(legacyProjectionInsert.insertId) },
  );
  assert.equal(legacyProjection.sendAt.toISOString(), '2037-01-01T12:04:05.000Z');
  await pool.query("UPDATE scheduled_emails SET status = 'failed' WHERE id = ?", [legacyProjectionInsert.insertId]);
  await pool.query(
    `UPDATE scheduled_emails
     SET status = 'retry_wait', attempts = 1,
         available_at = DATE_ADD(UTC_TIMESTAMP(), INTERVAL 120 SECOND)
     WHERE id = ?`,
    [legacyRetryInsert.insertId],
  );

  const [migrated] = await pool.query(
    `SELECT username, send_at, mail_options, draft_uid, created_at,
            payload_version, submission_kind, idempotency_key, request_fingerprint,
            save_in_sent_items, status, available_at, sender_address, raw_message, smtp_accepted_at,
            removed_at
     FROM scheduled_emails WHERE id = ?`,
    [legacyInsert.insertId],
  );
  assert.equal(migrated[0].username, legacyBeforeMigration.username);
  assert.equal(migrated[0].send_at.getTime(), legacyBeforeMigration.send_at.getTime());
  assert.equal(migrated[0].mail_options, legacyBeforeMigration.mail_options);
  assert.equal(Number(migrated[0].draft_uid), Number(legacyBeforeMigration.draft_uid));
  assert.equal(migrated[0].created_at.getTime(), legacyBeforeMigration.created_at.getTime());
  assert.equal(Number(migrated[0].payload_version), 1);
  assert.equal(migrated[0].submission_kind, 'scheduled');
  assert.equal(migrated[0].idempotency_key, null);
  assert.equal(migrated[0].request_fingerprint, null);
  assert.equal(Number(migrated[0].save_in_sent_items), 1);
  assert.equal(migrated[0].status, 'scheduled');
  assert.equal(migrated[0].sender_address, 'owner@example.test');
  assert.ok(migrated[0].available_at);
  assert.equal(migrated[0].raw_message, null);
  assert.equal(migrated[0].smtp_accepted_at, null);
  assert.equal(migrated[0].removed_at, null);

  const [indexes] = await pool.query(
    `SELECT INDEX_NAME, NON_UNIQUE, SEQ_IN_INDEX, COLUMN_NAME
     FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'scheduled_emails'
     ORDER BY INDEX_NAME, SEQ_IN_INDEX`,
  );
  const ownerKeyIndex = indexes.filter(row => row.INDEX_NAME === 'uq_scheduled_owner_idempotency');
  assert.deepEqual(ownerKeyIndex.map(row => row.COLUMN_NAME), ['username', 'idempotency_key']);
  assert.ok(ownerKeyIndex.every(row => Number(row.NON_UNIQUE) === 0));

  const firstStore = new MySqlScheduledEmailStore(pool);
  const secondStore = new MySqlScheduledEmailStore(pool);
  const [firstClaims, secondClaims] = await Promise.all([
    firstStore.claimBatch('legacy-worker-one', 1),
    secondStore.claimBatch('legacy-worker-two', 1),
  ]);
  assert.equal(firstClaims.length + secondClaims.length, 1);
  assert.equal((firstClaims[0] || secondClaims[0]).status, 'claimed');
  assert.equal((await claimScheduledCancellation(
    pool,
    legacyInsert.insertId,
    'owner@example.test',
    'legacy-cancel',
  )).outcome, 'conflict');

  const noEarlyLegacyClaims = await firstStore.claimBatch('legacy-basis-not-due', 10);
  assert.deepEqual(noEarlyLegacyClaims, [],
    'local-wall scheduled and UTC retry rows must both remain queued before their own due instant');

  const legacyLocalDueInstant = new Date(Date.now() - 1_000);
  await pool.query(
    `UPDATE scheduled_emails
     SET status = 'scheduled', available_at = ?, send_at = ?,
         attempts = 0, lease_owner = NULL, lease_expires_at = NULL
     WHERE id = ?`,
    [legacyLocalDueInstant, legacyLocalDueInstant, legacyLocalClaimInsert.insertId],
  );
  const legacyLocalClaims = await firstStore.claimBatch('legacy-local-due', 1);
  assert.deepEqual(legacyLocalClaims.map(row => Number(row.id)), [Number(legacyLocalClaimInsert.insertId)]);
  await pool.query("UPDATE scheduled_emails SET status = 'failed' WHERE id = ?", [legacyLocalClaimInsert.insertId]);

  assert.deepEqual(await firstStore.claimBatch('legacy-retry-still-not-due', 1), [],
    'legacy retry_wait availability must remain on the database UTC basis');
  await pool.query(
    `UPDATE scheduled_emails
     SET available_at = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 SECOND),
         lease_owner = NULL, lease_expires_at = NULL
     WHERE id = ?`,
    [legacyRetryInsert.insertId],
  );
  const legacyRetryClaims = await firstStore.claimBatch('legacy-retry-due', 1);
  assert.deepEqual(legacyRetryClaims.map(row => Number(row.id)), [Number(legacyRetryInsert.insertId)]);

  await pool.query('DELETE FROM scheduled_emails');
  let smtpCalls = 0;
  let imapCalls = 0;
  let acceptedSideEffects = 0;
  const dependencies = {
    async getCredential() { throw new Error('the injected request credential must be used'); },
    createTransport() {
      return {
        async sendMail() {
          smtpCalls += 1;
          const [durable] = await pool.query(
            `SELECT status, idempotency_key, request_fingerprint, raw_message, sent_raw_message,
                    envelope_json, save_in_sent_items,
                    ABS(TIMESTAMPDIFF(SECOND, send_at, UTC_TIMESTAMP())) AS send_at_skew_seconds
             FROM scheduled_emails WHERE username = 'owner@example.test' AND idempotency_key = 'race-key'`,
          );
          assert.equal(durable.length, 1);
          assert.equal(durable[0].status, 'smtp_inflight');
          assert.match(durable[0].request_fingerprint, /^[0-9a-f]{64}$/);
          assert.ok(Buffer.isBuffer(durable[0].raw_message));
          assert.ok(Buffer.isBuffer(durable[0].sent_raw_message));
          assert.deepEqual(JSON.parse(durable[0].envelope_json).to, ['recipient@example.net']);
          assert.equal(Number(durable[0].save_in_sent_items), 0);
          assert.ok(Number(durable[0].send_at_skew_seconds) <= 5,
            `immediate send_at drifted ${durable[0].send_at_skew_seconds}s from database UTC`);
          return { accepted: ['recipient@example.net'], rejected: [] };
        },
        close() {},
      };
    },
    async createImap() { imapCalls += 1; throw new Error('SaveInSentItems=false must skip IMAP'); },
    async authorizeSender(username, sender) { return { address: sender, name: username }; },
    async onAccepted(_row, recipients) {
      acceptedSideEffects += 1;
      assert.deepEqual(recipients, ['recipient@example.net']);
    },
  };
  const message = {
    username: 'owner@example.test',
    sendAt: new Date('2026-08-15T12:00:00.000Z'),
    senderAddress: 'owner@example.test',
    messageId: '<outbox-race@example.test>',
    envelope: { from: 'owner@example.test', to: ['recipient@example.net'] },
    raw: Buffer.from('Message-ID: <outbox-race@example.test>\r\n\r\nDelivery'),
    sentRaw: Buffer.from('Message-ID: <outbox-race@example.test>\r\nBcc: hidden@example.net\r\n\r\nDelivery'),
    metadata: { subject: 'Race' },
    saveSentCopy: false,
  };
  const input = {
    submissionKind: 'immediate',
    idempotencyKey: 'race-key',
    fingerprintSource: {
      subject: 'Race',
      text: 'Delivery',
      inReplyTo: '',
      references: [],
      attachments: [{ filename: 'proof.txt', contentType: 'text/plain', content: Buffer.from('proof') }],
      saveSentCopy: false,
    },
    message,
    requestCredential: 'request-only-secret',
  };
  const [first, second] = await Promise.all([
    submitOutbound(pool, input, { workerId: 'request-one', dependencies }),
    submitOutbound(pool, input, { workerId: 'request-two', dependencies }),
  ]);
  assert.deepEqual([first.replayed, second.replayed].sort(), [false, true]);
  assert.equal(smtpCalls, 1);
  assert.equal(imapCalls, 0);
  assert.equal(acceptedSideEffects, 1);
  const [reserved] = await pool.query(
    `SELECT status, submission_kind, idempotency_key, request_fingerprint,
            raw_message, sent_raw_message, smtp_accepted_at, save_in_sent_items
     FROM scheduled_emails WHERE username = ? AND idempotency_key = ?`,
    ['owner@example.test', 'race-key'],
  );
  assert.equal(reserved.length, 1);
  assert.equal(reserved[0].status, 'completed');
  assert.equal(reserved[0].submission_kind, 'immediate');
  assert.match(reserved[0].request_fingerprint, /^[0-9a-f]{64}$/);
  assert.equal(reserved[0].raw_message, null);
  assert.equal(reserved[0].sent_raw_message, null);
  assert.ok(reserved[0].smtp_accepted_at);
  assert.equal(Number(reserved[0].save_in_sent_items), 0);

  const projection = await getOutboundSubmission(pool, 'owner@example.test', { idempotencyKey: 'race-key' });
  assert.equal(projection.status, 'completed');
  assert.equal(projection.saveSentCopy, false);
  assert.equal(await getOutboundSubmission(pool, 'other@example.test', { idempotencyKey: 'race-key' }), null);
  await assert.rejects(
    submitOutbound(pool, {
      ...input,
      fingerprintSource: { ...input.fingerprintSource, text: 'Changed' },
    }, { workerId: 'request-conflict', dependencies }),
    error => error instanceof OutboundIdempotencyConflictError && error.status === 409,
  );
  assert.equal(smtpCalls, 1);
  assert.equal(acceptedSideEffects, 1);

  const scheduledMessage = {
    username: 'owner@example.test',
    sendAt: new Date('2026-08-16T12:00:00.000Z'),
    senderAddress: 'owner@example.test',
    messageId: '<scheduled-race@example.test>',
    envelope: { from: 'owner@example.test', to: ['recipient@example.net'] },
    raw: Buffer.from('Message-ID: <scheduled-race@example.test>\r\n\r\nScheduled'),
    metadata: { subject: 'Scheduled race' },
  };
  const scheduledInput = {
    submissionKind: 'scheduled',
    idempotencyKey: 'scheduled-race-key',
    fingerprintSource: { subject: 'Scheduled race', text: 'Scheduled' },
    message: scheduledMessage,
  };
  let scheduledFirst;
  let scheduledSecond;
  [scheduledFirst, scheduledSecond] = await Promise.all([
    submitOutbound(pool, scheduledInput),
    submitOutbound(pool, scheduledInput),
  ]);
  assert.deepEqual([scheduledFirst.replayed, scheduledSecond.replayed].sort(), [false, true]);
  assert.equal(scheduledFirst.id, scheduledSecond.id);
  assert.equal(scheduledFirst.status, 'scheduled');
  assert.equal(scheduledSecond.status, 'scheduled');
  assert.equal(scheduledFirst.sendAt.toISOString(), '2026-08-16T12:00:00.000Z');
  assert.equal(scheduledSecond.sendAt.toISOString(), '2026-08-16T12:00:00.000Z');
  const [scheduledReservations] = await pool.query(
    `SELECT submission_kind, status, idempotency_key, request_fingerprint, raw_message,
            DATE_FORMAT(send_at, '%Y-%m-%d %H:%i:%s') AS send_at_utc,
            DATE_FORMAT(available_at, '%Y-%m-%d %H:%i:%s') AS available_at_utc
     FROM scheduled_emails WHERE username = ? AND idempotency_key = ?`,
    ['owner@example.test', 'scheduled-race-key'],
  );
  assert.equal(scheduledReservations.length, 1);
  assert.equal(scheduledReservations[0].submission_kind, 'scheduled');
  assert.equal(scheduledReservations[0].status, 'scheduled');
  assert.equal(scheduledReservations[0].send_at_utc, '2026-08-16 12:00:00');
  assert.equal(scheduledReservations[0].available_at_utc, '2026-08-16 12:00:00');
  assert.match(scheduledReservations[0].request_fingerprint, /^[0-9a-f]{64}$/);
  assert.ok(Buffer.isBuffer(scheduledReservations[0].raw_message));
  await assert.rejects(
    submitOutbound(pool, {
      ...scheduledInput,
      fingerprintSource: { ...scheduledInput.fingerprintSource, text: 'Changed' },
    }),
    error => error instanceof OutboundIdempotencyConflictError && error.status === 409,
  );
  assert.equal(Number((await pool.query(
    'SELECT COUNT(*) AS total FROM scheduled_emails WHERE username = ? AND idempotency_key = ?',
    ['owner@example.test', 'scheduled-race-key'],
  ))[0][0].total), 1);

  await pool.query(
    `UPDATE scheduled_emails
     SET status = 'delivery_uncertain', smtp_accepted_at = UTC_TIMESTAMP(),
         last_error_code = 'lease_expired_during_smtp', last_error_at = UTC_TIMESTAMP()
     WHERE id = ?`,
    [scheduledFirst.id],
  );
  assert.equal(await removeTerminalScheduledEmail(
    pool,
    scheduledFirst.id,
    'owner@example.test',
  ), 'removed');
  const [[hiddenScheduled]] = await pool.query(
    `SELECT id, username, submission_kind, idempotency_key, request_fingerprint, status,
            smtp_accepted_at, last_error_code, removed_at, mail_options, envelope_json,
            raw_message, sent_raw_message
     FROM scheduled_emails WHERE id = ?`,
    [scheduledFirst.id],
  );
  assert.equal(hiddenScheduled.id, scheduledFirst.id);
  assert.equal(hiddenScheduled.username, 'owner@example.test');
  assert.equal(hiddenScheduled.submission_kind, 'scheduled');
  assert.equal(hiddenScheduled.idempotency_key, 'scheduled-race-key');
  assert.match(hiddenScheduled.request_fingerprint, /^[0-9a-f]{64}$/);
  assert.equal(hiddenScheduled.status, 'delivery_uncertain');
  assert.ok(hiddenScheduled.smtp_accepted_at);
  assert.equal(hiddenScheduled.last_error_code, 'lease_expired_during_smtp');
  assert.ok(hiddenScheduled.removed_at);
  assert.equal(hiddenScheduled.mail_options, '{}');
  assert.equal(hiddenScheduled.envelope_json, null);
  assert.equal(hiddenScheduled.raw_message, null);
  assert.equal(hiddenScheduled.sent_raw_message, null);

  const hiddenReplay = await submitOutbound(pool, scheduledInput);
  assert.equal(hiddenReplay.replayed, true);
  assert.equal(hiddenReplay.id, scheduledFirst.id);
  assert.equal(hiddenReplay.status, 'delivery_uncertain');
  assert.equal((await getOutboundSubmission(
    pool,
    'owner@example.test',
    { idempotencyKey: 'scheduled-race-key' },
  )).status, 'delivery_uncertain');
  await assert.rejects(
    submitOutbound(pool, {
      ...scheduledInput,
      fingerprintSource: { ...scheduledInput.fingerprintSource, text: 'Changed after hide' },
    }),
    error => error instanceof OutboundIdempotencyConflictError && error.status === 409,
  );

  const otherOwner = await submitOutbound(pool, {
    submissionKind: 'scheduled',
    idempotencyKey: 'race-key',
    fingerprintSource: { subject: 'Other owner', text: 'Independent' },
    message: {
      username: 'other@example.test',
      sendAt: new Date(Date.now() + 60_000),
      senderAddress: 'other@example.test',
      messageId: '<other-owner@example.test>',
      envelope: { from: 'other@example.test', to: ['recipient@example.net'] },
      raw: Buffer.from('Message-ID: <other-owner@example.test>\r\n\r\nIndependent'),
      metadata: { subject: 'Other owner' },
    },
  });
  assert.equal(otherOwner.replayed, false);
  assert.equal(otherOwner.submissionKind, 'scheduled');
  assert.equal(otherOwner.status, 'scheduled');
  assert.equal((await getOutboundSubmission(
    pool,
    'other@example.test',
    { idempotencyKey: 'race-key' },
  )).id, otherOwner.id);
  const [ownerScopedKeys] = await pool.query(
    "SELECT username FROM scheduled_emails WHERE idempotency_key = 'race-key' ORDER BY username",
  );
  assert.deepEqual(ownerScopedKeys.map(row => row.username), ['other@example.test', 'owner@example.test']);

  const [pendingImmediate] = await pool.query(
    `INSERT INTO scheduled_emails
        (username, send_at, mail_options, draft_uid, payload_version, submission_kind,
         idempotency_key, request_fingerprint, save_in_sent_items, status, available_at, attempts,
         sender_address, message_id, envelope_json, raw_message, sent_raw_message)
     VALUES ('owner@example.test', UTC_TIMESTAMP(), '{}', NULL, 2, 'immediate',
             'cannot-cancel', REPEAT('a', 64), 1, 'scheduled', UTC_TIMESTAMP(), 0,
             'owner@example.test', '<cannot-cancel@example.test>',
             '{"from":"owner@example.test","to":["recipient@example.net"]}', 'raw', 'raw')`,
  );
  assert.equal((await claimScheduledCancellation(
    pool,
    pendingImmediate.insertId,
    'owner@example.test',
    'cancel-immediate',
  )).outcome, 'conflict');
  const [stillPending] = await pool.query('SELECT status FROM scheduled_emails WHERE id = ?', [pendingImmediate.insertId]);
  assert.equal(stillPending[0].status, 'scheduled');

  await pool.query("UPDATE scheduled_emails SET status = 'failed' WHERE id = ?", [pendingImmediate.insertId]);
  const insertCrashRow = async (key, status) => {
    const [result] = await pool.query(
      `INSERT INTO scheduled_emails
          (username, send_at, mail_options, draft_uid, payload_version, submission_kind,
           idempotency_key, request_fingerprint, save_in_sent_items, status, available_at, attempts,
           lease_owner, lease_expires_at, sender_address, message_id, envelope_json,
           raw_message, sent_raw_message)
       VALUES ('owner@example.test', UTC_TIMESTAMP(), '{"subject":"private crash payload"}', NULL, 2, 'immediate', ?, REPEAT('b', 64),
               1, ?, UTC_TIMESTAMP(), 1, 'dead-worker', DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 SECOND),
               'owner@example.test', ?,
               '{"from":"owner@example.test","to":["recipient@example.net"]}', 'raw', 'raw')`,
      [key, status, `<${key}@example.test>`],
    );
    return result.insertId;
  };
  const expiredClaimedId = await insertCrashRow('expired-claim', 'claimed');
  const expiredInflightId = await insertCrashRow('expired-inflight', 'smtp_inflight');
  const recoveryStore = new MySqlScheduledEmailStore(pool);
  const reclaimed = await recoveryStore.claimById(
    expiredClaimedId,
    'owner@example.test',
    'recovery-worker',
  );
  assert.equal(reclaimed.status, 'claimed');
  assert.equal(reclaimed.lease_owner, 'recovery-worker');
  assert.equal(await recoveryStore.claimById(
    expiredInflightId,
    'owner@example.test',
    'must-not-retry',
  ), null);
  const [crashStates] = await pool.query(
    `SELECT id, status, last_error_code, mail_options, envelope_json,
            raw_message, sent_raw_message
     FROM scheduled_emails WHERE id IN (?, ?) ORDER BY id`,
    [expiredClaimedId, expiredInflightId],
  );
  assert.equal(crashStates[0].status, 'claimed');
  assert.equal(crashStates[0].last_error_code, 'lease_expired_before_smtp');
  assert.equal(crashStates[1].status, 'delivery_uncertain');
  assert.equal(crashStates[1].last_error_code, 'lease_expired_during_smtp');
  assert.equal(crashStates[1].mail_options, '{}');
  assert.equal(crashStates[1].envelope_json, null);
  assert.equal(crashStates[1].raw_message, null);
  assert.equal(crashStates[1].sent_raw_message, null);

  await pool.query("UPDATE scheduled_emails SET status = 'failed' WHERE id = ?", [expiredClaimedId]);
  const raceId = await insertCrashRow('worker-request-race', 'retry_wait');
  await pool.query(
    'UPDATE scheduled_emails SET lease_owner = NULL, lease_expires_at = NULL WHERE id = ?',
    [raceId],
  );
  const requestStore = new MySqlScheduledEmailStore(pool);
  const workerStore = new MySqlScheduledEmailStore(pool);
  const [requestClaim, workerClaims] = await Promise.all([
    requestStore.claimById(raceId, 'owner@example.test', 'request-racer'),
    workerStore.claimBatch('worker-racer', 1),
  ]);
  assert.equal((requestClaim ? 1 : 0) + workerClaims.filter(row => Number(row.id) === Number(raceId)).length, 1);
  const [raceState] = await pool.query('SELECT status, attempts FROM scheduled_emails WHERE id = ?', [raceId]);
  assert.equal(raceState[0].status, 'claimed');
  assert.equal(Number(raceState[0].attempts), 2);
});
