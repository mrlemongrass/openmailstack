const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

process.env.OMS_DB_PASSWORD ||= 'calendar-tombstone-repair-db-test';

const enabled = process.env.OMS_CALENDAR_TOMBSTONE_REPAIR_DB_TEST === '1';

function freshCalendarUtils() {
  const modulePath = require.resolve('../src/calendar-utils.js');
  delete require.cache[modulePath];
  return require(modulePath);
}

test('exact tombstone repair is recoverable and ambiguity stays fail-closed on MariaDB', {
  skip: !enabled,
}, async (t) => {
  assert.match(
    process.env.OMS_DB_NAME || '',
    /^oms_tombstone_repair_[a-z0-9_]+$/,
    'the opted-in database test requires a dedicated disposable database name',
  );

  const { pool } = require('../src/db.js');
  const originalApproval = process.env.OMS_CALENDAR_TOMBSTONE_REPAIR_APPROVAL;
  const originalReleaseMode = process.env.OMS_OUTBOUND_RELEASE_MODE;
  t.after(async () => {
    if (originalApproval === undefined) delete process.env.OMS_CALENDAR_TOMBSTONE_REPAIR_APPROVAL;
    else process.env.OMS_CALENDAR_TOMBSTONE_REPAIR_APPROVAL = originalApproval;
    if (originalReleaseMode === undefined) delete process.env.OMS_OUTBOUND_RELEASE_MODE;
    else process.env.OMS_OUTBOUND_RELEASE_MODE = originalReleaseMode;
    await pool.query('DROP TABLE IF EXISTS calendar_tombstone_repair_archive');
    await pool.query('DROP TABLE IF EXISTS calendar_shares');
    await pool.query('DROP TABLE IF EXISTS calendar_tombstones');
    await pool.query('DROP TABLE IF EXISTS events');
    await pool.query('DROP TABLE IF EXISTS calendars');
    await pool.end();
  });

  const [[sessionMode]] = await pool.query('SELECT @@SESSION.sql_mode AS sql_mode');
  assert.match(String(sessionMode.sql_mode), /(?:^|,)ONLY_FULL_GROUP_BY(?:,|$)/);

  await pool.query(`CREATE TABLE calendars (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    dav_slug VARCHAR(255) NULL,
    components VARCHAR(255) NOT NULL DEFAULT 'VEVENT,VTODO',
    subscribed_url TEXT NULL,
    sync_token BIGINT UNSIGNED NOT NULL DEFAULT 1,
    UNIQUE KEY uniq_calendars_user_dav_slug (user_id, dav_slug)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  await pool.query(`CREATE TABLE events (
    id INT AUTO_INCREMENT PRIMARY KEY,
    calendar_id INT NOT NULL,
    uid VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    resource_name VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    ical_data LONGTEXT NOT NULL,
    sync_token BIGINT UNSIGNED NOT NULL DEFAULT 1,
    UNIQUE KEY uniq_events_calendar_uid (calendar_id, uid),
    UNIQUE KEY uniq_events_calendar_resource_name (calendar_id, resource_name),
    KEY idx_events_calendar_sync (calendar_id, sync_token)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);
  await pool.query(`CREATE TABLE calendar_tombstones (
    id INT AUTO_INCREMENT PRIMARY KEY,
    calendar_id INT NOT NULL,
    uid VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
    resource_name VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL,
    sync_token BIGINT UNSIGNED NOT NULL DEFAULT 1,
    deleted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_tombstones_calendar (calendar_id),
    KEY idx_tombstones_calendar_sync (calendar_id, sync_token)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`);

  await pool.query("INSERT INTO calendars (id, user_id, name, dav_slug, sync_token) VALUES (1, 'owner@example.test', 'Personal', 'personal', 314)");
  await pool.query(`INSERT INTO events (id, calendar_id, uid, resource_name, ical_data, sync_token)
                    VALUES (91, 1, 'live-event', 'live.ics', 'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n', 314)`);
  await pool.query(`INSERT INTO calendar_tombstones
      (id, calendar_id, uid, resource_name, sync_token, deleted_at) VALUES
      (10, 1, 'UID-É', 'résumé.ics', 314, '2026-08-14 08:00:00'),
      (11, 1, 'UID-É', 'résumé.ics', 314, '2026-08-15 08:00:00'),
      (12, 1, 'UID-É', 'résumé.ics', 314, '2026-08-15 08:00:00'),
      (20, 1, 'case-distinct', 'RÉSUMÉ.ics', 315, '2026-08-15 09:00:00')`);

  const approvedIdentity = Buffer.from('UID-É', 'utf8');
  const approvedResource = Buffer.from('résumé.ics', 'utf8');
  process.env.OMS_OUTBOUND_RELEASE_MODE = 'bridge';
  process.env.OMS_CALENDAR_TOMBSTONE_REPAIR_APPROVAL = Buffer.from(JSON.stringify({
    version: 1,
    calendarId: 1,
    retainedId: 12,
    eventMatches: 0,
    rows: [
      { id: 10, deletedAt: '2026-08-14 08:00:00' },
      { id: 11, deletedAt: '2026-08-15 08:00:00' },
      { id: 12, deletedAt: '2026-08-15 08:00:00' },
    ].map(row => ({
      id: row.id,
      uidSha256: crypto.createHash('sha256').update(approvedIdentity).digest('hex'),
      uidBytes: approvedIdentity.length,
      resourceNameSha256: crypto.createHash('sha256').update(approvedResource).digest('hex'),
      resourceNameBytes: approvedResource.length,
      syncToken: '314',
      deletedAt: row.deletedAt,
    })),
  }), 'utf8').toString('base64url');

  await freshCalendarUtils().ensureCalendarSchema();

  const [retained] = await pool.query('SELECT id, uid, resource_name, sync_token FROM calendar_tombstones ORDER BY id');
  assert.deepEqual(retained.map(row => Number(row.id)), [12, 20]);
  const [archived] = await pool.query(`SELECT source_tombstone_id, calendar_id, uid, resource_name,
                                              sync_token, retained_tombstone_id, repair_reason
                                       FROM calendar_tombstone_repair_archive
                                       ORDER BY source_tombstone_id`);
  assert.deepEqual(archived.map(row => Number(row.source_tombstone_id)), [10, 11, 12]);
  assert.ok(archived.every(row => (
    Number(row.calendar_id) === 1
    && row.uid === 'UID-É'
    && row.resource_name === 'résumé.ics'
    && Number(row.sync_token) === 314
    && Number(row.retained_tombstone_id) === 12
    && row.repair_reason === 'exact_duplicate_resource_v1'
  )));
  const [liveEvents] = await pool.query('SELECT id, uid, resource_name FROM events');
  assert.deepEqual(liveEvents.map(row => Number(row.id)), [91]);

  await freshCalendarUtils().ensureCalendarSchema();
  const [[archiveCountAfterRetry]] = await pool.query('SELECT COUNT(*) AS total FROM calendar_tombstone_repair_archive');
  assert.equal(Number(archiveCountAfterRetry.total), 3);

  delete process.env.OMS_CALENDAR_TOMBSTONE_REPAIR_APPROVAL;
  delete process.env.OMS_OUTBOUND_RELEASE_MODE;

  await pool.query('ALTER TABLE calendar_tombstones DROP INDEX uniq_calendar_tombstone_resource_name');
  await pool.query('DELETE FROM calendar_tombstones');
  await pool.query(`INSERT INTO calendar_tombstones
      (id, calendar_id, uid, resource_name, sync_token, deleted_at) VALUES
      (31, 1, 'UID-A', 'ambiguous.ics', 400, '2026-08-15 10:00:00'),
      (32, 1, 'uid-a', 'ambiguous.ics', 400, '2026-08-15 11:00:00')`);
  await assert.rejects(
    freshCalendarUtils().ensureCalendarSchema(),
    /ambiguous DAV tombstone.*binary UID count 2/i,
  );
  const [[uidAmbiguityCount]] = await pool.query('SELECT COUNT(*) AS total FROM calendar_tombstones');
  assert.equal(Number(uidAmbiguityCount.total), 2);
  const [[archiveCountAfterUidAmbiguity]] = await pool.query('SELECT COUNT(*) AS total FROM calendar_tombstone_repair_archive');
  assert.equal(Number(archiveCountAfterUidAmbiguity.total), 3);

  await pool.query('DELETE FROM calendar_tombstones');
  await pool.query(`INSERT INTO calendar_tombstones
      (id, calendar_id, uid, resource_name, sync_token, deleted_at) VALUES
      (41, 1, 'same-uid', 'ambiguous.ics', 500, '2026-08-15 10:00:00'),
      (42, 1, 'same-uid', 'ambiguous.ics', 501, '2026-08-15 11:00:00')`);
  await assert.rejects(
    freshCalendarUtils().ensureCalendarSchema(),
    /ambiguous DAV tombstone.*sync-token count 2/i,
  );
  const [[syncAmbiguityCount]] = await pool.query('SELECT COUNT(*) AS total FROM calendar_tombstones');
  assert.equal(Number(syncAmbiguityCount.total), 2);
  const [[eventCountAfterFailures]] = await pool.query('SELECT COUNT(*) AS total FROM events');
  assert.equal(Number(eventCountAfterFailures.total), 1);

  // Prove the approval transaction remains closed to new tombstones and
  // target-calendar events even when the pooled session default is READ
  // COMMITTED. The production unit seam separately asserts that this exact
  // SERIALIZABLE setup occurs before the same locking reads.
  const lockConnection = await pool.getConnection();
  const tombstoneWriter = await pool.getConnection();
  const eventWriter = await pool.getConnection();
  let lockTransactionOpen = false;
  try {
    await lockConnection.query('SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED');
    await lockConnection.query('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE');
    await lockConnection.beginTransaction();
    lockTransactionOpen = true;
    await lockConnection.query(
      `SELECT id
       FROM calendar_tombstones FORCE INDEX (PRIMARY)
       ORDER BY id ASC
       FOR UPDATE`,
    );
    await lockConnection.query(
      `SELECT id, uid, resource_name
       FROM events
       WHERE calendar_id = ?
       FOR UPDATE`,
      [1],
    );
    await tombstoneWriter.query('SET SESSION innodb_lock_wait_timeout = 5');
    await eventWriter.query('SET SESSION innodb_lock_wait_timeout = 5');

    let tombstoneSettled = false;
    let eventSettled = false;
    const tombstoneInsert = tombstoneWriter.query(
      `INSERT INTO calendar_tombstones
          (id, calendar_id, uid, resource_name, sync_token, deleted_at)
       VALUES (99, 2, 'late-tombstone', 'late-tombstone.ics', 1, '2026-08-16 12:00:00')`,
    ).finally(() => { tombstoneSettled = true; });
    const eventInsert = eventWriter.query(
      `INSERT INTO events
          (id, calendar_id, uid, resource_name, ical_data, sync_token)
       VALUES (92, 1, 'late-event', 'late-event.ics', 'BEGIN:VCALENDAR\r\nEND:VCALENDAR\r\n', 315)`,
    ).finally(() => { eventSettled = true; });

    await new Promise(resolve => setTimeout(resolve, 200));
    const bothBlocked = !tombstoneSettled && !eventSettled;
    await lockConnection.commit();
    lockTransactionOpen = false;
    const insertResults = await Promise.allSettled([tombstoneInsert, eventInsert]);
    assert.equal(bothBlocked, true, 'both unapproved inserts must wait behind the approval locks');
    assert.ok(insertResults.every(result => result.status === 'fulfilled'));
  } finally {
    if (lockTransactionOpen) await lockConnection.rollback();
    await lockConnection.query('SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    lockConnection.release();
    tombstoneWriter.release();
    eventWriter.release();
  }
});
