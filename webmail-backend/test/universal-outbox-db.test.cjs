const assert = require('node:assert/strict');
const test = require('node:test');

process.env.OMS_DB_PASSWORD ||= 'universal-outbox-db-test';

test('universal outbox registry, retention, and mixed-basis ordering on disposable MariaDB', {
  skip: process.env.OMS_OUTBOX_REGISTRY_DB_TEST !== '1',
  timeout: 60_000,
}, async t => {
  const originalTimeZone = process.env.TZ;
  process.env.TZ = 'Pacific/Kiritimati';
  const databaseName = String(process.env.OMS_DB_NAME || 'postfixadmin');
  assert.match(databaseName, /(^|[_-])(test|ci|tmp|disposable)([_-]|$)/i,
    'OMS_OUTBOX_REGISTRY_DB_TEST requires an isolated disposable database');

  const { pool } = require('../src/db.js');
  const {
    MySqlScheduledEmailStore,
    OutboundIdempotencyConflictError,
    abortScheduledEmailBeforeDelivery,
    ensureScheduledEmailsSchema,
    getOutboundSubmission,
    listScheduledOutboundRows,
    submitOutbound,
  } = require('../src/scheduled-send.js');
  const {
    OUTBOUND_COMPACTION_VERIFIED_MODE,
    backfillOutboundRegistry,
    compactUniversalOutbox,
    ensureOutboundRegistrySchema,
  } = require('../src/universal-outbox.js');

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
  await ensureScheduledEmailsSchema(pool);
  await ensureOutboundRegistrySchema(pool);
  await ensureOutboundRegistrySchema({ query: pool.query.bind(pool) });

  const [registryColumns] = await pool.query(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'outbound_submission_registry'
     ORDER BY ORDINAL_POSITION`,
  );
  const columnNames = registryColumns.map(row => row.COLUMN_NAME);
  assert.deepEqual(columnNames, [
    'username', 'idempotency_key', 'request_fingerprint', 'submission_id',
    'submission_origin', 'submission_kind', 'terminal_status', 'last_error_code', 'send_at',
    'smtp_accepted', 'save_in_sent_items', 'terminal_at', 'hot_row_removed_at',
    'replay_expires_at', 'created_at', 'updated_at',
  ]);
  assert.equal(columnNames.some(name => /mime|raw|body|subject|recipient|envelope|attachment|credential|password/i.test(name)), false);

  const futureMessage = (username, key, sendAt, origin = 'web') => ({
    submissionKind: 'scheduled',
    origin,
    idempotencyKey: key,
    fingerprintSource: {
      subject: 'private subject must not enter registry',
      text: 'private body must not enter registry',
      attachments: [{ filename: 'private.txt', content: Buffer.from('private attachment') }],
    },
    message: {
      username,
      sendAt,
      senderAddress: username,
      messageId: `<${key}@example.test>`,
      envelope: { from: username, to: ['private-recipient@example.net'] },
      raw: Buffer.from(`Message-ID: <${key}@example.test>\r\n\r\nprivate MIME body`),
      metadata: { subject: 'private subject must not enter registry' },
    },
  });

  const raceInput = futureMessage(
    'owner@example.test',
    'registry-race',
    new Date(Date.now() + 86_400_000),
  );
  const [first, second] = await Promise.all([
    submitOutbound(pool, raceInput),
    submitOutbound(pool, raceInput),
  ]);
  assert.deepEqual([first.replayed, second.replayed].sort(), [false, true]);
  assert.equal(first.id, second.id);
  const [[raceCounts]] = await pool.query(
    `SELECT
       (SELECT COUNT(*) FROM scheduled_emails WHERE username = ? AND idempotency_key = ?) AS hot_count,
       (SELECT COUNT(*) FROM outbound_submission_registry WHERE username = ? AND idempotency_key = ?) AS registry_count`,
    ['owner@example.test', 'registry-race', 'owner@example.test', 'registry-race'],
  );
  assert.equal(Number(raceCounts.hot_count), 1);
  assert.equal(Number(raceCounts.registry_count), 1);
  await assert.rejects(
    submitOutbound(pool, { ...raceInput, origin: 'activesync' }),
    error => error instanceof OutboundIdempotencyConflictError,
    'a key cannot cross the web and ActiveSync retention namespaces',
  );
  const [[registryValue]] = await pool.query(
    `SELECT * FROM outbound_submission_registry
     WHERE username = 'owner@example.test' AND idempotency_key = 'registry-race'`,
  );
  const registryText = JSON.stringify(registryValue);
  assert.doesNotMatch(registryText, /private subject|private body|private attachment|private-recipient|private MIME/i);

  const abortedInput = futureMessage(
    'owner@example.test', 'abort-before-delivery', new Date(Date.now() + 86_400_000),
  );
  const aborted = await submitOutbound(pool, abortedInput);
  assert.equal(await abortScheduledEmailBeforeDelivery(
    pool, aborted.id, 'owner@example.test',
  ), true);
  assert.equal(Number((await pool.query(
    'SELECT COUNT(*) AS total FROM scheduled_emails WHERE id = ?', [aborted.id],
  ))[0][0].total), 0);
  const abortedReplay = await submitOutbound(pool, abortedInput);
  assert.equal(abortedReplay.replayed, true);
  assert.equal(abortedReplay.status, 'cancelled');
  await assert.rejects(
    submitOutbound(pool, {
      ...abortedInput,
      fingerprintSource: { subject: 'changed aborted request' },
    }),
    error => error instanceof OutboundIdempotencyConflictError,
  );

  await pool.query(`
    CREATE TRIGGER reject_registry_crash BEFORE INSERT ON outbound_submission_registry
    FOR EACH ROW
    BEGIN
      IF NEW.idempotency_key = 'forced-registry-crash' THEN
        SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'forced registry crash';
      END IF;
    END
  `);
  await assert.rejects(
    submitOutbound(pool, futureMessage(
      'owner@example.test',
      'forced-registry-crash',
      new Date(Date.now() + 86_400_000),
    )),
    /durable outbound submission service is unavailable/i,
  );
  const [[crashCounts]] = await pool.query(
    `SELECT
       (SELECT COUNT(*) FROM scheduled_emails WHERE idempotency_key = 'forced-registry-crash') AS hot_count,
       (SELECT COUNT(*) FROM outbound_submission_registry WHERE idempotency_key = 'forced-registry-crash') AS registry_count`,
  );
  assert.deepEqual([Number(crashCounts.hot_count), Number(crashCounts.registry_count)], [0, 0],
    'the hot reservation and compact registry identity must commit or roll back together');
  await pool.query('DROP TRIGGER reject_registry_crash');

  const legacyRealInstant = new Date(Date.now() - 120_000);
  const keyedRealInstant = new Date(Date.now() - 60_000);
  const [legacyOrdering] = await pool.query(
    `INSERT INTO scheduled_emails
       (username, send_at, available_at, mail_options, draft_uid, submission_kind,
        idempotency_key, status, sender_address)
     VALUES (?, ?, ?, '{}', NULL, 'scheduled', NULL, 'scheduled', ?)`,
    ['order@example.test', legacyRealInstant, legacyRealInstant, 'order@example.test'],
  );
  const keyedOrdering = await submitOutbound(
    pool,
    futureMessage('order@example.test', 'keyed-order', keyedRealInstant),
  );
  const [rawLiteralOrder] = await pool.query(
    `SELECT id FROM scheduled_emails WHERE id IN (?, ?) ORDER BY send_at, id`,
    [legacyOrdering.insertId, keyedOrdering.id],
  );
  assert.deepEqual(rawLiteralOrder.map(row => Number(row.id)), [
    Number(keyedOrdering.id), Number(legacyOrdering.insertId),
  ], 'the fixture must reproduce the old raw-DATETIME ordering defect');
  const orderedRows = await listScheduledOutboundRows(pool, 'order@example.test');
  assert.deepEqual(orderedRows.map(row => Number(row.id)), [
    Number(legacyOrdering.insertId),
    Number(keyedOrdering.id),
  ], 'Scheduled list must use real instants instead of incomparable DATETIME literals');
  assert.equal(orderedRows[0].projected_send_at.toISOString(), legacyRealInstant.toISOString().replace(/\.\d{3}Z$/, '.000Z'));
  assert.equal(orderedRows[1].projected_send_at.toISOString(), keyedRealInstant.toISOString().replace(/\.\d{3}Z$/, '.000Z'));

  const orderingStore = new MySqlScheduledEmailStore(pool);
  const [firstOrderedClaim] = await orderingStore.claimBatch('mixed-basis-worker', 1);
  assert.equal(Number(firstOrderedClaim.id), Number(legacyOrdering.insertId),
    'worker claim limit must select the globally earliest real instant');
  await pool.query("UPDATE scheduled_emails SET status = 'failed', last_error_at = UTC_TIMESTAMP() WHERE id = ?", [legacyOrdering.insertId]);
  const [secondOrderedClaim] = await orderingStore.claimBatch('mixed-basis-worker-2', 1);
  assert.equal(Number(secondOrderedClaim.id), Number(keyedOrdering.id));
  await pool.query("UPDATE scheduled_emails SET status = 'failed', last_error_at = UTC_TIMESTAMP() WHERE id = ?", [keyedOrdering.id]);
  const secondaryLegacyInstant = new Date(Date.now() - 120_000);
  const [secondaryLegacyOrdering] = await pool.query(
    `INSERT INTO scheduled_emails
       (username, send_at, available_at, mail_options, draft_uid, submission_kind,
        idempotency_key, status, sender_address)
     VALUES (?, ?, ?, '{}', NULL, 'scheduled', NULL, 'scheduled', ?)`,
    ['second-legacy-order@example.test', secondaryLegacyInstant, secondaryLegacyInstant,
      'second-legacy-order@example.test'],
  );
  const [legacyRetryOrdering] = await pool.query(
    `INSERT INTO scheduled_emails
       (username, send_at, available_at, mail_options, draft_uid, submission_kind,
        idempotency_key, status, sender_address)
     VALUES (?, ?, DATE_SUB(UTC_TIMESTAMP(), INTERVAL 30 SECOND), '{}', NULL,
             'scheduled', NULL, 'retry_wait', ?)`,
    ['retry-order@example.test', new Date(Date.now() - 300_000), 'retry-order@example.test'],
  );
  const [thirdOrderedClaim] = await orderingStore.claimBatch('mixed-basis-worker-3', 1);
  assert.equal(Number(thirdOrderedClaim.id), Number(secondaryLegacyOrdering.insertId),
    'a fresh local-wall legacy schedule must outrank a later UTC retry deadline');
  await pool.query("UPDATE scheduled_emails SET status = 'failed', last_error_at = UTC_TIMESTAMP() WHERE id = ?", [secondaryLegacyOrdering.insertId]);
  const [fourthOrderedClaim] = await orderingStore.claimBatch('mixed-basis-worker-4', 1);
  assert.equal(Number(fourthOrderedClaim.id), Number(legacyRetryOrdering.insertId),
    'a null-key legacy retry uses its UTC retry deadline, not the local-wall schedule basis');
  await pool.query("UPDATE scheduled_emails SET status = 'failed', last_error_at = UTC_TIMESTAMP() WHERE id = ?", [legacyRetryOrdering.insertId]);

  await pool.query('DELETE FROM outbound_submission_registry');
  await assert.rejects(
    compactUniversalOutbox(pool, {
      mode: OUTBOUND_COMPACTION_VERIFIED_MODE,
      batchSize: 100,
    }),
    /complete verified replay registry/i,
    'compaction must fail closed before bounded backfill reaches full verified coverage',
  );
  const backfillBefore = await backfillOutboundRegistry(pool, 1);
  assert.equal(backfillBefore.inserted, 1);
  let backfilled = backfillBefore.inserted;
  let backfillRemaining = backfillBefore.remaining;
  for (let batch = 0; batch < 20 && backfillRemaining; batch += 1) {
    const result = await backfillOutboundRegistry(pool, 1);
    backfilled += result.inserted;
    backfillRemaining = result.remaining;
  }
  assert.ok(backfilled >= 2, 'bounded backfill must make progress one row at a time');
  const backfillDone = await backfillOutboundRegistry(pool, 100);
  assert.equal(backfillDone.remaining, 0);
  assert.equal((await backfillOutboundRegistry(pool, 100)).inserted, 0,
    'registry backfill must be idempotent when applied again');

  const terminalInput = futureMessage(
    'retention@example.test',
    'web-terminal',
    new Date(Date.now() - 130 * 86_400_000),
  );
  const terminal = await submitOutbound(pool, terminalInput);
  await pool.query(
    `UPDATE scheduled_emails
     SET status = 'completed',
         completed_at = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 100 DAY),
         smtp_accepted_at = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 100 DAY)
     WHERE id = ?`,
    [terminal.id],
  );

  const disabled = await compactUniversalOutbox(pool, { mode: 'disabled', batchSize: 100 });
  assert.deepEqual(disabled, { payloadsPurged: 0, hotRowsRemoved: 0, tombstonesRemoved: 0 });
  assert.equal(Number((await pool.query(
    'SELECT COUNT(*) AS total FROM scheduled_emails WHERE id = ?', [terminal.id],
  ))[0][0].total), 1, 'disabled mode must perform zero deletion');

  const compacted = await compactUniversalOutbox(pool, {
    mode: OUTBOUND_COMPACTION_VERIFIED_MODE,
    batchSize: 1,
  });
  assert.equal(compacted.hotRowsRemoved, 1);
  assert.equal(Number((await pool.query(
    'SELECT COUNT(*) AS total FROM scheduled_emails WHERE id = ?', [terminal.id],
  ))[0][0].total), 0);
  const replayAfterHotDeletion = await submitOutbound(pool, terminalInput);
  assert.equal(replayAfterHotDeletion.replayed, true);
  assert.equal(replayAfterHotDeletion.id, terminal.id);
  assert.equal(replayAfterHotDeletion.status, 'completed');
  assert.equal(await getOutboundSubmission(
    pool, 'other-owner@example.test', { idempotencyKey: 'web-terminal' },
  ), null);
  await assert.rejects(
    submitOutbound(pool, {
      ...terminalInput,
      fingerprintSource: { subject: 'changed request' },
    }),
    error => error instanceof OutboundIdempotencyConflictError && error.status === 409,
  );
  assert.equal(Number((await pool.query(
    "SELECT COUNT(*) AS total FROM scheduled_emails WHERE idempotency_key = 'web-terminal'",
  ))[0][0].total), 0, 'replay and conflict must not recreate a hot delivery row');
  const isolatedOwner = await submitOutbound(pool, {
    ...terminalInput,
    fingerprintSource: { subject: 'same visible key, isolated owner' },
    message: {
      ...terminalInput.message,
      username: 'other-owner@example.test',
      senderAddress: 'other-owner@example.test',
      envelope: {
        ...terminalInput.message.envelope,
        from: 'other-owner@example.test',
      },
    },
  });
  assert.equal(isolatedOwner.replayed, false,
    'the compact registry key space must remain owner-scoped');

  let immediateSmtpCalls = 0;
  const immediateDependencies = {
    async getCredential() { return 'disposable-request-credential'; },
    createTransport() {
      return {
        async sendMail() {
          immediateSmtpCalls += 1;
          return { accepted: ['recipient@example.net'], rejected: [] };
        },
        close() {},
      };
    },
    async createImap() { throw new Error('SaveInSentItems=false must skip IMAP'); },
    async authorizeSender(_username, sender) { return { address: sender }; },
  };
  const immediateInput = (origin, key) => ({
    ...futureMessage('retention@example.test', key, new Date(), origin),
    submissionKind: 'immediate',
    message: {
      ...futureMessage('retention@example.test', key, new Date(), origin).message,
      saveSentCopy: false,
    },
  });
  const webImmediateInput = immediateInput('web', 'web-immediate-retention');
  const easImmediateInput = immediateInput('activesync', 'eas-immediate-retention');
  const webImmediate = await submitOutbound(pool, webImmediateInput, {
    workerId: 'web-immediate-retention', dependencies: immediateDependencies,
  });
  const easImmediate = await submitOutbound(pool, easImmediateInput, {
    workerId: 'eas-immediate-retention', dependencies: immediateDependencies,
  });
  assert.equal(immediateSmtpCalls, 2);
  await pool.query(
    `UPDATE scheduled_emails SET completed_at = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 8 DAY),
       smtp_accepted_at = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 8 DAY)
     WHERE id IN (?, ?)`, [webImmediate.id, easImmediate.id],
  );
  const immediateCompaction = await compactUniversalOutbox(pool, {
    mode: OUTBOUND_COMPACTION_VERIFIED_MODE,
    batchSize: 100,
  });
  assert.ok(immediateCompaction.hotRowsRemoved >= 2,
    'terminal immediate hot rows must leave the payload table after seven days');
  const [immediateRegistry] = await pool.query(
    `SELECT idempotency_key, submission_origin, terminal_status,
            DATEDIFF(replay_expires_at, terminal_at) AS replay_days
     FROM outbound_submission_registry
     WHERE submission_id IN (?, ?) ORDER BY idempotency_key`,
    [webImmediate.id, easImmediate.id],
  );
  assert.deepEqual(immediateRegistry.map(row => [
    row.idempotency_key, row.submission_origin, row.terminal_status, Number(row.replay_days),
  ]), [
    ['eas-immediate-retention', 'activesync', 'completed', 400],
    ['web-immediate-retention', 'web', 'completed', 120],
  ]);
  await pool.query(
    `UPDATE outbound_submission_registry
     SET terminal_at = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 121 DAY),
         replay_expires_at = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 DAY)
     WHERE submission_id = ?`, [webImmediate.id],
  );
  await pool.query(
    `UPDATE outbound_submission_registry
     SET terminal_at = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 121 DAY),
         replay_expires_at = DATE_ADD(UTC_TIMESTAMP(), INTERVAL 279 DAY)
     WHERE submission_id = ?`, [easImmediate.id],
  );
  const replayExpiry = await compactUniversalOutbox(pool, {
    mode: OUTBOUND_COMPACTION_VERIFIED_MODE,
    batchSize: 100,
  });
  assert.ok(replayExpiry.tombstonesRemoved >= 1);
  const [horizonRows] = await pool.query(
    `SELECT submission_id FROM outbound_submission_registry WHERE submission_id IN (?, ?)`,
    [webImmediate.id, easImmediate.id],
  );
  assert.deepEqual(horizonRows.map(row => Number(row.submission_id)), [Number(easImmediate.id)],
    'web replay tombstones expire at 120 days while ActiveSync remains protected for 400 days');

  const uncertain = await submitOutbound(pool, futureMessage(
    'retention@example.test', 'uncertain-forever', new Date(Date.now() - 500 * 86_400_000),
  ));
  await pool.query(
    `UPDATE scheduled_emails SET status = 'delivery_uncertain',
       last_error_at = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 500 DAY)
     WHERE id = ?`, [uncertain.id],
  );
  const futureActive = await submitOutbound(pool, futureMessage(
    'retention@example.test', 'future-active', new Date(Date.now() + 86_400_000),
  ));
  const scheduledRecent = await submitOutbound(pool, futureMessage(
    'retention@example.test', 'scheduled-recent', new Date(Date.now() - 8 * 86_400_000),
  ));
  await pool.query(
    `UPDATE scheduled_emails SET status = 'completed',
       completed_at = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 8 DAY)
     WHERE id = ?`, [scheduledRecent.id],
  );
  const maintenance = await compactUniversalOutbox(pool, {
    mode: OUTBOUND_COMPACTION_VERIFIED_MODE,
    batchSize: 100,
  });
  assert.ok(maintenance.payloadsPurged >= 1);
  const [retained] = await pool.query(
    `SELECT id, status, raw_message, mail_options, display_metadata_json FROM scheduled_emails
     WHERE id IN (?, ?, ?) ORDER BY id`,
    [uncertain.id, futureActive.id, scheduledRecent.id],
  );
  assert.equal(retained.length, 3);
  assert.equal(retained.find(row => Number(row.id) === Number(uncertain.id)).status, 'delivery_uncertain');
  assert.ok(retained.find(row => Number(row.id) === Number(uncertain.id)).raw_message,
    'delivery_uncertain payload must never auto-expire');
  assert.equal(retained.find(row => Number(row.id) === Number(futureActive.id)).status, 'scheduled');
  const recentRow = retained.find(row => Number(row.id) === Number(scheduledRecent.id));
  assert.equal(recentRow.mail_options, '{}');
  assert.equal(recentRow.raw_message, null);
  assert.equal(JSON.parse(recentRow.display_metadata_json).subject,
    'private subject must not enter registry',
    'Scheduled display metadata remains available through its 90-day display window');
  assert.equal(Number((await pool.query(
    'SELECT COUNT(*) AS total FROM scheduled_emails WHERE id = ?', [legacyOrdering.insertId],
  ))[0][0].total), 1, 'null-key legacy rows must never be compacted automatically');

  const compactInputs = [
    futureMessage('batch@example.test', 'batch-one', new Date(Date.now() - 100 * 86_400_000)),
    futureMessage('batch@example.test', 'batch-two', new Date(Date.now() - 100 * 86_400_000)),
  ];
  const compactRows = await Promise.all(compactInputs.map(input => submitOutbound(pool, input)));
  await pool.query(
    `UPDATE scheduled_emails SET status = 'completed', completed_at = DATE_SUB(UTC_TIMESTAMP(), INTERVAL 100 DAY)
     WHERE id IN (?, ?)`, compactRows.map(row => row.id),
  );
  const concurrent = await Promise.all([
    compactUniversalOutbox(pool, { mode: OUTBOUND_COMPACTION_VERIFIED_MODE, batchSize: 1 }),
    compactUniversalOutbox(pool, { mode: OUTBOUND_COMPACTION_VERIFIED_MODE, batchSize: 1 }),
  ]);
  const concurrentlyRemoved = concurrent.reduce((sum, result) => sum + result.hotRowsRemoved, 0);
  const [[remainingBatchRows]] = await pool.query(
    'SELECT COUNT(*) AS total FROM scheduled_emails WHERE id IN (?, ?)',
    compactRows.map(row => row.id),
  );
  assert.equal(concurrentlyRemoved + Number(remainingBatchRows.total), 2,
    'concurrent compactors must never count or delete the same hot row twice');
  assert.ok(concurrentlyRemoved >= 1, 'at least one concurrent bounded batch must make progress');
  const finalBatch = await compactUniversalOutbox(pool, {
    mode: OUTBOUND_COMPACTION_VERIFIED_MODE, batchSize: 1,
  });
  assert.equal(concurrentlyRemoved + finalBatch.hotRowsRemoved, 2,
    'a subsequent bounded batch must finish any row skipped by a concurrent snapshot');
});
