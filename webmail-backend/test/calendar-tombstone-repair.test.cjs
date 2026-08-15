const test = require('node:test');
const assert = require('node:assert/strict');

process.env.OMS_DB_PASSWORD ||= 'calendar-tombstone-repair-test';

const REPAIR_REASON = 'exact_duplicate_resource_v1';

function binaryKey(value) {
  return Buffer.from(String(value), 'utf8').toString('hex');
}

function cloneRows(rows) {
  return rows.map(row => ({ ...row }));
}

function installCalendarSchemaDatabase(t, {
  tombstones,
  events = [],
  failRedundantDelete = false,
  initialArchive = [],
  calendarIdNullable = false,
  lockAcquired = true,
  mutateLockedRows = false,
  prefixResourceIndex = false,
  uniqueResourceIndex = false,
}) {
  const db = require('../src/db.js');
  const originalQuery = db.pool.query;
  const originalGetConnection = db.pool.getConnection;
  t.after(() => {
    db.pool.query = originalQuery;
    db.pool.getConnection = originalGetConnection;
  });

  let storedTombstones = cloneRows(tombstones);
  const storedEvents = cloneRows(events);
  const archive = cloneRows(initialArchive);
  const statements = [];
  let tombstoneResourceIndex = uniqueResourceIndex;
  let transactionSnapshot = null;
  let lockAcquisitions = 0;
  let lockReleases = 0;

  const duplicateGroups = () => {
    const groups = new Map();
    for (const row of storedTombstones) {
      if (row.resource_name === null || row.resource_name === '') continue;
      const key = `${row.calendar_id}:${binaryKey(row.resource_name)}`;
      const group = groups.get(key) || [];
      group.push(row);
      groups.set(key, group);
    }
    return [...groups.values()]
      .filter(group => group.length > 1)
      .map(group => ({
        calendar_id: group[0].calendar_id,
        resource_name: group[0].resource_name,
        duplicate_count: group.length,
        distinct_uid_count: new Set(group.map(row => binaryKey(row.uid))).size,
        distinct_sync_token_count: new Set(group.map(row => String(row.sync_token))).size,
      }));
  };

  const sortedTombstones = () => cloneRows(storedTombstones).sort((left, right) => {
    if (Number(left.calendar_id) !== Number(right.calendar_id)) {
      return Number(left.calendar_id) - Number(right.calendar_id);
    }
    const resourceOrder = Buffer.compare(
      Buffer.from(String(left.resource_name), 'utf8'),
      Buffer.from(String(right.resource_name), 'utf8'),
    );
    if (resourceOrder !== 0) return resourceOrder;
    const deletedOrder = String(right.deleted_at).localeCompare(String(left.deleted_at));
    if (deletedOrder !== 0) return deletedOrder;
    return Number(right.id) - Number(left.id);
  });

  const schemaQuery = async (sql, params = []) => {
    const compact = String(sql).replace(/\s+/g, ' ').trim();
    statements.push(compact);

    if (compact === "SHOW COLUMNS FROM calendars LIKE 'dav_slug'"
      || compact === "SHOW COLUMNS FROM calendars LIKE 'components'"
      || compact === "SHOW COLUMNS FROM calendars LIKE 'subscribed_url'"
      || compact === "SHOW COLUMNS FROM events LIKE 'sync_token'"
      || compact === "SHOW COLUMNS FROM calendar_tombstones LIKE 'sync_token'") {
      return [[{ Field: 'present' }], []];
    }
    if (compact === "SHOW FULL COLUMNS FROM calendar_tombstones LIKE 'calendar_id'") {
      return [[{ Null: calendarIdNullable ? 'YES' : 'NO' }], []];
    }
    if (compact === "SHOW FULL COLUMNS FROM events LIKE 'uid'"
      || compact === "SHOW FULL COLUMNS FROM events LIKE 'resource_name'"
      || compact === "SHOW FULL COLUMNS FROM calendar_tombstones LIKE 'uid'"
      || compact === "SHOW FULL COLUMNS FROM calendar_tombstones LIKE 'resource_name'") {
      return [[{ Collation: 'utf8mb4_bin', Null: 'NO' }], []];
    }
    if (compact.startsWith('SELECT user_id, dav_slug, COUNT(*) AS duplicate_count FROM calendars')) {
      return [[], []];
    }
    if (compact === 'SHOW INDEX FROM calendars') {
      return [[
        { Non_unique: 0, Key_name: 'uniq_calendars_user_dav_slug', Seq_in_index: 1, Column_name: 'user_id' },
        { Non_unique: 0, Key_name: 'uniq_calendars_user_dav_slug', Seq_in_index: 2, Column_name: 'dav_slug' },
      ], []];
    }
    if (compact === 'SELECT id, user_id, name, dav_slug FROM calendars ORDER BY user_id ASC, id ASC') {
      return [[], []];
    }
    if (compact === 'SHOW INDEX FROM events') {
      return [[
        { Non_unique: 0, Key_name: 'uniq_events_calendar_uid', Seq_in_index: 1, Column_name: 'calendar_id' },
        { Non_unique: 0, Key_name: 'uniq_events_calendar_uid', Seq_in_index: 2, Column_name: 'uid' },
        { Non_unique: 0, Key_name: 'uniq_events_calendar_resource_name', Seq_in_index: 1, Column_name: 'calendar_id' },
        { Non_unique: 0, Key_name: 'uniq_events_calendar_resource_name', Seq_in_index: 2, Column_name: 'resource_name' },
        { Non_unique: 1, Key_name: 'idx_events_calendar_sync', Seq_in_index: 1, Column_name: 'calendar_id' },
        { Non_unique: 1, Key_name: 'idx_events_calendar_sync', Seq_in_index: 2, Column_name: 'sync_token' },
      ], []];
    }
    if (compact.startsWith('SELECT calendar_id, resource_name, COUNT(*) AS duplicate_count FROM events')) {
      return [[], []];
    }
    if (compact === 'UPDATE calendar_tombstones SET resource_name = uid WHERE resource_name IS NULL OR resource_name = \'\'') {
      for (const row of storedTombstones) {
        if (row.resource_name === null || row.resource_name === '') row.resource_name = row.uid;
      }
      return [{ affectedRows: 0 }, []];
    }
    if (compact.includes('FROM calendar_tombstones')
      && compact.includes('GROUP BY calendar_id, BINARY resource_name')
      && compact.includes('HAVING')) {
      return [duplicateGroups(), []];
    }
    if (compact === 'SHOW INDEX FROM calendar_tombstones') {
      return [[
        ...(tombstoneResourceIndex ? [
          { Non_unique: 0, Key_name: 'uniq_calendar_tombstone_resource_name', Seq_in_index: 1, Column_name: 'calendar_id', Sub_part: null },
          { Non_unique: 0, Key_name: 'uniq_calendar_tombstone_resource_name', Seq_in_index: 2, Column_name: 'resource_name', Sub_part: null },
        ] : prefixResourceIndex ? [
          { Non_unique: 0, Key_name: 'uniq_calendar_tombstone_resource_name', Seq_in_index: 1, Column_name: 'calendar_id', Sub_part: null },
          { Non_unique: 0, Key_name: 'uniq_calendar_tombstone_resource_name', Seq_in_index: 2, Column_name: 'resource_name', Sub_part: 191 },
        ] : []),
        { Non_unique: 1, Key_name: 'idx_tombstones_calendar_sync', Seq_in_index: 1, Column_name: 'calendar_id' },
        { Non_unique: 1, Key_name: 'idx_tombstones_calendar_sync', Seq_in_index: 2, Column_name: 'sync_token' },
      ], []];
    }
    if (compact.startsWith('ALTER TABLE calendar_tombstones ADD UNIQUE KEY')
      && compact.endsWith('(calendar_id, resource_name)')) {
      assert.equal(duplicateGroups().length, 0, 'the unique key must only be added after duplicate repair and recheck');
      tombstoneResourceIndex = true;
      return [{ affectedRows: 0 }, []];
    }
    if (compact.startsWith('DELETE calendar_tombstones FROM calendar_tombstones INNER JOIN events')) {
      return [{ affectedRows: 0 }, []];
    }
    return [{ affectedRows: 0 }, []];
  };

  db.pool.query = schemaQuery;
  db.pool.getConnection = async () => ({
    async query(sql, params = []) {
      const compact = String(sql).replace(/\s+/g, ' ').trim();
      statements.push(compact);
      if (compact === 'SELECT GET_LOCK(?, 30) AS acquired') {
        lockAcquisitions += 1;
        return [[{ acquired: lockAcquired ? 1 : 0 }], []];
      }
      if (compact === 'SELECT RELEASE_LOCK(?) AS released') {
        lockReleases += 1;
        return [[{ released: 1 }], []];
      }
      if (compact.includes('FROM calendar_tombstones FORCE INDEX (PRIMARY)')
        && compact.endsWith('FOR UPDATE')) {
        const ids = new Set(params.map(Number));
        const rows = sortedTombstones().filter(row => ids.has(Number(row.id)));
        if (mutateLockedRows && rows.length > 0) rows[0].sync_token = Number(rows[0].sync_token) + 1;
        return [rows, []];
      }
      if (compact.startsWith('SELECT id, calendar_id, uid, resource_name, CAST(sync_token AS CHAR) AS sync_token, deleted_at FROM calendar_tombstones')
        && !compact.includes('FOR UPDATE')) {
        const [calendarId, resourceName] = params;
        return [sortedTombstones().filter(row => (
          Number(row.calendar_id) === Number(calendarId)
          && binaryKey(row.resource_name) === binaryKey(resourceName)
        )), []];
      }
      if (compact.startsWith('INSERT INTO calendar_tombstone_repair_archive')) {
        const [source_tombstone_id, calendar_id, uid, resource_name, sync_token, deleted_at,
          retained_tombstone_id, repair_reason] = params;
        const existing = archive.find(row => (
          Number(row.source_tombstone_id) === Number(source_tombstone_id)
          && row.repair_reason === repair_reason
        ));
        if (!existing) {
          archive.push({
            source_tombstone_id: Number(source_tombstone_id),
            calendar_id: Number(calendar_id),
            uid,
            resource_name,
            sync_token: Number(sync_token),
            deleted_at,
            retained_tombstone_id: Number(retained_tombstone_id),
            repair_reason,
          });
          return [{ affectedRows: 1 }, []];
        }
        return [{ affectedRows: 0 }, []];
      }
      if (compact.startsWith('SELECT source_tombstone_id, calendar_id, uid, resource_name, CAST(sync_token AS CHAR) AS sync_token,')) {
        const repairReason = params[0];
        const ids = new Set(params.slice(1).map(Number));
        return [cloneRows(archive.filter(row => (
          row.repair_reason === repairReason && ids.has(Number(row.source_tombstone_id))
        ))), []];
      }
      if (compact.startsWith('DELETE FROM calendar_tombstones WHERE id IN (')) {
        if (failRedundantDelete) throw new Error('injected tombstone repair delete failure');
        const ids = new Set(params.map(Number));
        const before = storedTombstones.length;
        storedTombstones = storedTombstones.filter(row => !ids.has(Number(row.id)));
        return [{ affectedRows: before - storedTombstones.length }, []];
      }
      if (compact.includes('FROM calendar_tombstones')
        && compact.includes('GROUP BY calendar_id, BINARY resource_name')
        && compact.includes('HAVING')) {
        return [duplicateGroups(), []];
      }
      throw new Error(`Unexpected repair query: ${compact}`);
    },
    async beginTransaction() {
      assert.equal(transactionSnapshot, null);
      transactionSnapshot = {
        tombstones: cloneRows(storedTombstones),
        archive: cloneRows(archive),
      };
    },
    async commit() {
      assert.notEqual(transactionSnapshot, null);
      transactionSnapshot = null;
    },
    async rollback() {
      if (!transactionSnapshot) return;
      storedTombstones = cloneRows(transactionSnapshot.tombstones);
      archive.splice(0, archive.length, ...cloneRows(transactionSnapshot.archive));
      transactionSnapshot = null;
    },
    release() {},
    destroy() {},
  });

  return {
    archive,
    events: storedEvents,
    statements,
    tombstones: () => cloneRows(storedTombstones),
    lockAcquisitions: () => lockAcquisitions,
    lockReleases: () => lockReleases,
  };
}

function freshCalendarUtils() {
  const modulePath = require.resolve('../src/calendar-utils.js');
  delete require.cache[modulePath];
  return require(modulePath);
}

test('steady binary schema with a full unique resource key skips every repair scan and lock', async (t) => {
  const state = installCalendarSchemaDatabase(t, {
    tombstones: [
      { id: 1, calendar_id: 1, uid: 'steady', resource_name: 'steady.ics', sync_token: 1, deleted_at: '2026-08-15T08:00:00.000Z' },
    ],
    uniqueResourceIndex: true,
  });

  await freshCalendarUtils().ensureCalendarSchema();

  assert.equal(state.statements.some(sql => sql.includes('GROUP BY calendar_id, BINARY resource_name')), false);
  assert.equal(state.statements.some(sql => sql.startsWith('CREATE TABLE IF NOT EXISTS calendar_tombstone_repair_archive')), false);
  assert.equal(state.statements.some(sql => sql.startsWith('UPDATE calendar_tombstones SET resource_name = uid')), false);
  assert.equal(state.lockAcquisitions(), 0);
});

test('a prefix-only unique resource index does not masquerade as the full identity invariant', async (t) => {
  const state = installCalendarSchemaDatabase(t, {
    tombstones: [
      { id: 2, calendar_id: 1, uid: 'prefix', resource_name: 'prefix.ics', sync_token: 1, deleted_at: '2026-08-15T08:00:00.000Z' },
    ],
    prefixResourceIndex: true,
  });

  await freshCalendarUtils().ensureCalendarSchema();

  assert.equal(
    state.statements.filter(sql => sql.includes('GROUP BY calendar_id, BINARY resource_name')).length,
    2,
  );
  assert.ok(state.statements.some(sql => (
    sql.startsWith('ALTER TABLE calendar_tombstones ADD UNIQUE KEY')
    && sql.includes('uniq_calendar_tombstone_resource_name_2')
  )));
  assert.equal(state.lockAcquisitions(), 0);
});

test('a nullable calendar ID fails closed before repair scans, locks, archives, or deletes', async (t) => {
  const state = installCalendarSchemaDatabase(t, {
    tombstones: [
      { id: 3, calendar_id: 1, uid: 'nullable-owner', resource_name: 'nullable-owner.ics', sync_token: 1, deleted_at: '2026-08-15T08:00:00.000Z' },
    ],
    calendarIdNullable: true,
    uniqueResourceIndex: true,
  });

  await assert.rejects(
    freshCalendarUtils().ensureCalendarSchema(),
    /calendar_tombstones\.calendar_id is nullable.*owner IDs are never inferred or repaired/i,
  );

  assert.equal(
    state.statements.filter(sql => sql.includes('GROUP BY calendar_id, BINARY resource_name')).length,
    0,
  );
  assert.equal(state.lockAcquisitions(), 0);
  assert.deepEqual(state.archive, []);
  assert.equal(state.statements.some(sql => sql.startsWith('DELETE FROM calendar_tombstones WHERE id IN')), false);
  assert.equal(state.statements.some(sql => sql.startsWith('DELETE calendar_tombstones FROM calendar_tombstones')), false);
});

test('startup archives an exact tombstone duplicate group and retains the newest deterministic row', async (t) => {
  const originalTombstones = [
    { id: 10, calendar_id: 7, uid: 'UID-É', resource_name: 'résumé.ics', sync_token: 314, deleted_at: '2026-08-14T08:00:00.000Z' },
    { id: 11, calendar_id: 7, uid: 'UID-É', resource_name: 'résumé.ics', sync_token: 314, deleted_at: '2026-08-15T08:00:00.000Z' },
    { id: 12, calendar_id: 7, uid: 'UID-É', resource_name: 'résumé.ics', sync_token: 314, deleted_at: '2026-08-15T08:00:00.000Z' },
    { id: 20, calendar_id: 7, uid: 'case-distinct', resource_name: 'RÉSUMÉ.ics', sync_token: 315, deleted_at: '2026-08-15T09:00:00.000Z' },
  ];
  const state = installCalendarSchemaDatabase(t, {
    tombstones: originalTombstones,
    events: [{ id: 91, calendar_id: 7, uid: 'live-event', resource_name: 'live.ics' }],
  });

  await freshCalendarUtils().ensureCalendarSchema();

  assert.deepEqual(state.tombstones().map(row => row.id), [12, 20]);
  assert.deepEqual(state.events, [{ id: 91, calendar_id: 7, uid: 'live-event', resource_name: 'live.ics' }]);
  assert.deepEqual(
    state.archive.map(row => ({
      ...row,
      sync_token: Number(row.sync_token),
    })).sort((left, right) => left.source_tombstone_id - right.source_tombstone_id),
    originalTombstones.slice(0, 3).map(row => ({
      source_tombstone_id: row.id,
      calendar_id: row.calendar_id,
      uid: row.uid,
      resource_name: row.resource_name,
      sync_token: row.sync_token,
      deleted_at: row.deleted_at,
      retained_tombstone_id: 12,
      repair_reason: REPAIR_REASON,
    })),
  );
  assert.equal(state.lockAcquisitions(), 1);
  assert.equal(state.lockReleases(), 1);
  assert.equal(state.statements.some(sql => /^DELETE FROM events\b/.test(sql)), false);
  const tombstoneLocks = state.statements.filter(sql => (
    sql.includes('FROM calendar_tombstones') && sql.endsWith('FOR UPDATE')
  ));
  assert.ok(tombstoneLocks.length > 0);
  assert.ok(tombstoneLocks.every(sql => (
    sql.includes('FORCE INDEX (PRIMARY)') && sql.includes('WHERE id IN (')
  )), 'the repair must lock only its discovered tombstone primary keys');

  const archiveBeforeRetry = cloneRows(state.archive);
  await freshCalendarUtils().ensureCalendarSchema();
  assert.deepEqual(state.tombstones().map(row => row.id), [12, 20]);
  assert.deepEqual(state.archive, archiveBeforeRetry, 'a startup retry must not duplicate the repair archive');
  assert.equal(state.lockAcquisitions(), 1, 'an idempotent retry with no duplicates needs no repair lock');

  const backfillIndex = state.statements.findIndex(sql => sql.startsWith('UPDATE calendar_tombstones SET resource_name = uid'));
  const archiveTableIndex = state.statements.findIndex(sql => sql.startsWith('CREATE TABLE IF NOT EXISTS calendar_tombstone_repair_archive'));
  const repairScanIndex = state.statements.findIndex(sql => (
    sql.includes('FROM calendar_tombstones') && sql.includes('GROUP BY calendar_id, BINARY resource_name')
  ));
  const uniqueIndex = state.statements.findIndex(sql => sql.startsWith(
    'ALTER TABLE calendar_tombstones ADD UNIQUE KEY uniq_calendar_tombstone_resource_name',
  ));
  assert.ok(backfillIndex >= 0 && backfillIndex < archiveTableIndex);
  assert.ok(archiveTableIndex < repairScanIndex && repairScanIndex < uniqueIndex);
});

test('a mid-repair failure rolls back both the archive and redundant tombstone deletion', async (t) => {
  const rows = [
    { id: 51, calendar_id: 10, uid: 'same-uid', resource_name: 'rollback.ics', sync_token: 600, deleted_at: '2026-08-15T10:00:00.000Z' },
    { id: 52, calendar_id: 10, uid: 'same-uid', resource_name: 'rollback.ics', sync_token: 600, deleted_at: '2026-08-15T11:00:00.000Z' },
  ];
  const state = installCalendarSchemaDatabase(t, {
    tombstones: rows,
    failRedundantDelete: true,
  });

  await assert.rejects(
    freshCalendarUtils().ensureCalendarSchema(),
    /injected tombstone repair delete failure/,
  );

  assert.deepEqual(state.tombstones(), rows);
  assert.deepEqual(state.archive, []);
  assert.equal(state.lockAcquisitions(), 1);
  assert.equal(state.lockReleases(), 1);
});

test('repair bounds duplicate-group count before taking the advisory lock', async (t) => {
  const rows = [];
  for (let group = 1; group <= 101; group += 1) {
    rows.push(
      { id: group * 2, calendar_id: 11, uid: `uid-${group}`, resource_name: `resource-${group}.ics`, sync_token: 700, deleted_at: '2026-08-15T10:00:00.000Z' },
      { id: group * 2 + 1, calendar_id: 11, uid: `uid-${group}`, resource_name: `resource-${group}.ics`, sync_token: 700, deleted_at: '2026-08-15T11:00:00.000Z' },
    );
  }
  const state = installCalendarSchemaDatabase(t, { tombstones: rows });

  await assert.rejects(
    freshCalendarUtils().ensureCalendarSchema(),
    /more than 100 duplicate DAV tombstone groups/i,
  );

  assert.equal(state.lockAcquisitions(), 0);
  assert.deepEqual(state.archive, []);
  assert.equal(state.statements.some(sql => sql.startsWith('DELETE FROM calendar_tombstones WHERE id IN')), false);
});

test('repair bounds rows in one duplicate group before taking the advisory lock', async (t) => {
  const rows = Array.from({ length: 101 }, (_, offset) => ({
    id: 300 + offset,
    calendar_id: 12,
    uid: 'bounded-uid',
    resource_name: 'bounded.ics',
    sync_token: 701,
    deleted_at: `2026-08-15T10:${String(offset % 60).padStart(2, '0')}:00.000Z`,
  }));
  const state = installCalendarSchemaDatabase(t, { tombstones: rows });

  await assert.rejects(
    freshCalendarUtils().ensureCalendarSchema(),
    /more than 100 tombstones for one DAV resource/i,
  );

  assert.equal(state.lockAcquisitions(), 0);
  assert.deepEqual(state.archive, []);
});

test('advisory lock timeout leaves the exact duplicate group untouched', async (t) => {
  const rows = [
    { id: 501, calendar_id: 13, uid: 'lock-uid', resource_name: 'lock.ics', sync_token: 702, deleted_at: '2026-08-15T10:00:00.000Z' },
    { id: 502, calendar_id: 13, uid: 'lock-uid', resource_name: 'lock.ics', sync_token: 702, deleted_at: '2026-08-15T11:00:00.000Z' },
  ];
  const state = installCalendarSchemaDatabase(t, { tombstones: rows, lockAcquired: false });

  await assert.rejects(
    freshCalendarUtils().ensureCalendarSchema(),
    /Timed out waiting for the calendar tombstone repair lock/,
  );

  assert.deepEqual(state.tombstones(), rows);
  assert.deepEqual(state.archive, []);
  assert.equal(state.lockAcquisitions(), 1);
  assert.equal(state.lockReleases(), 0);
});

test('conflicting pre-existing archive evidence fails verification before deletion', async (t) => {
  const rows = [
    { id: 601, calendar_id: 14, uid: 'archive-uid', resource_name: 'archive.ics', sync_token: 703, deleted_at: '2026-08-15T10:00:00.000Z' },
    { id: 602, calendar_id: 14, uid: 'archive-uid', resource_name: 'archive.ics', sync_token: 703, deleted_at: '2026-08-15T11:00:00.000Z' },
  ];
  const conflictingArchive = [{
    source_tombstone_id: 601,
    calendar_id: 14,
    uid: 'different-uid',
    resource_name: 'archive.ics',
    sync_token: 703,
    deleted_at: '2026-08-15T10:00:00.000Z',
    retained_tombstone_id: 602,
    repair_reason: REPAIR_REASON,
  }];
  const state = installCalendarSchemaDatabase(t, {
    tombstones: rows,
    initialArchive: conflictingArchive,
  });

  await assert.rejects(
    freshCalendarUtils().ensureCalendarSchema(),
    /archive verification failed for source row 601/i,
  );

  assert.deepEqual(state.tombstones(), rows);
  assert.deepEqual(state.archive, conflictingArchive);
  assert.equal(state.statements.some(sql => sql.startsWith('DELETE FROM calendar_tombstones WHERE id IN')), false);
});

test('a group change between discovery and primary-key locking fails closed', async (t) => {
  const rows = [
    { id: 701, calendar_id: 15, uid: 'race-uid', resource_name: 'race.ics', sync_token: 704, deleted_at: '2026-08-15T10:00:00.000Z' },
    { id: 702, calendar_id: 15, uid: 'race-uid', resource_name: 'race.ics', sync_token: 704, deleted_at: '2026-08-15T11:00:00.000Z' },
  ];
  const state = installCalendarSchemaDatabase(t, { tombstones: rows, mutateLockedRows: true });

  await assert.rejects(
    freshCalendarUtils().ensureCalendarSchema(),
    /group changed before its primary-key lock was acquired/i,
  );

  assert.deepEqual(state.tombstones(), rows);
  assert.deepEqual(state.archive, []);
  assert.equal(state.lockAcquisitions(), 1);
  assert.equal(state.lockReleases(), 1);
});

for (const scenario of [
  {
    name: 'different binary UIDs',
    rows: [
      { id: 31, calendar_id: 8, uid: 'UID-A', resource_name: 'same.ics', sync_token: 9, deleted_at: '2026-08-15T08:00:00.000Z' },
      { id: 32, calendar_id: 8, uid: 'uid-a', resource_name: 'same.ics', sync_token: 9, deleted_at: '2026-08-15T09:00:00.000Z' },
    ],
  },
  {
    name: 'different collection revisions',
    rows: [
      { id: 41, calendar_id: 9, uid: 'same-uid', resource_name: 'same.ics', sync_token: 9, deleted_at: '2026-08-15T08:00:00.000Z' },
      { id: 42, calendar_id: 9, uid: 'same-uid', resource_name: 'same.ics', sync_token: 10, deleted_at: '2026-08-15T09:00:00.000Z' },
    ],
  },
]) {
  test(`startup fails closed without deleting an ambiguous tombstone group with ${scenario.name}`, async (t) => {
    const state = installCalendarSchemaDatabase(t, { tombstones: scenario.rows });

    await assert.rejects(
      freshCalendarUtils().ensureCalendarSchema(),
      /Calendar schema migration blocked:.*ambiguous DAV tombstone/i,
    );

    assert.deepEqual(state.tombstones(), scenario.rows);
    assert.deepEqual(state.archive, []);
    assert.equal(state.statements.some(sql => sql.startsWith('DELETE FROM calendar_tombstones WHERE id IN')), false);
    assert.equal(state.statements.some(sql => /^DELETE FROM events\b/.test(sql)), false);
  });
}
