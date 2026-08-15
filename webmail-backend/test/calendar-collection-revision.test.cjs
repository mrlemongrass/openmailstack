const test = require('node:test');
const assert = require('node:assert/strict');

process.env.OMS_DB_PASSWORD ||= 'calendar-collection-revision-test';

test('calendar mutations allocate one locked monotonic collection revision', async () => {
  const queries = [];
  let syncToken = 41;
  const connection = {
    query: async (sql, params = []) => {
      const compact = String(sql).replace(/\s+/g, ' ').trim();
      queries.push({ sql: compact, params });
      if (compact === 'SELECT sync_token FROM calendars WHERE id = ? LIMIT 1 FOR UPDATE') {
        return [[{ sync_token: syncToken }], []];
      }
      if (compact === 'UPDATE calendars SET sync_token = ? WHERE id = ? AND sync_token = ?') {
        assert.deepEqual(params, [42, 7, 41]);
        syncToken = Number(params[0]);
        return [{ affectedRows: 1 }, []];
      }
      throw new Error(`Unexpected query: ${compact}`);
    },
  };

  const { allocateCalendarCollectionRevisionOnConnection } = require('../src/calendar-utils.js');
  assert.equal(await allocateCalendarCollectionRevisionOnConnection(connection, 7), 42);
  assert.equal(syncToken, 42);
  assert.deepEqual(queries.map(query => query.sql), [
    'SELECT sync_token FROM calendars WHERE id = ? LIMIT 1 FOR UPDATE',
    'UPDATE calendars SET sync_token = ? WHERE id = ? AND sync_token = ?',
  ]);
});

test('calendar revision allocation fails closed when the calendar disappears', async () => {
  const connection = {
    query: async () => [[], []],
  };
  const { allocateCalendarCollectionRevisionOnConnection } = require('../src/calendar-utils.js');
  await assert.rejects(
    allocateCalendarCollectionRevisionOnConnection(connection, 404),
    /Calendar not found/,
  );
});

test('legacy calendar rows are migrated onto collection revisions without retaining live tombstones', async () => {
  const statements = [];
  const db = require('../src/db.js');
  db.pool.query = async (sql) => {
    const compact = String(sql).replace(/\s+/g, ' ').trim();
    statements.push(compact);
    if (compact === "SHOW COLUMNS FROM calendars LIKE 'dav_slug'"
      || compact === "SHOW COLUMNS FROM calendars LIKE 'components'"
      || compact === "SHOW COLUMNS FROM calendars LIKE 'subscribed_url'"
      || compact === "SHOW COLUMNS FROM events LIKE 'sync_token'") {
      return [[{ Field: 'present' }], []];
    }
    if (compact === "SHOW COLUMNS FROM calendar_tombstones LIKE 'sync_token'") return [[], []];
    if (compact === "SHOW FULL COLUMNS FROM events LIKE 'uid'"
      || compact === "SHOW FULL COLUMNS FROM calendar_tombstones LIKE 'uid'"
      || compact === "SHOW FULL COLUMNS FROM events LIKE 'resource_name'") {
      return [[{ Collation: 'utf8mb4_bin', Null: 'NO' }], []];
    }
    if (compact === "SHOW FULL COLUMNS FROM calendar_tombstones LIKE 'resource_name'") {
      return [[{ Collation: 'utf8mb4_bin', Null: 'YES' }], []];
    }
    if (compact.startsWith('SELECT calendar_id, resource_name, COUNT(*) AS duplicate_count')) return [[], []];
    if (compact.startsWith('SHOW INDEX FROM calendars')) return [[{ Key_name: 'idx_calendars_user_dav_slug' }], []];
    if (compact === 'SHOW INDEX FROM events') {
      return [[
        { Non_unique: 0, Key_name: 'uniq_events_calendar_uid', Seq_in_index: 1, Column_name: 'calendar_id' },
        { Non_unique: 0, Key_name: 'uniq_events_calendar_uid', Seq_in_index: 2, Column_name: 'uid' },
      ], []];
    }
    if (compact === 'SHOW INDEX FROM calendar_tombstones') return [[], []];
    if (compact === 'SELECT id, user_id, name, dav_slug FROM calendars ORDER BY user_id ASC, id ASC') return [[], []];
    return [{ affectedRows: 1 }, []];
  };

  const { ensureCalendarSchema } = require('../src/calendar-utils.js');
  await ensureCalendarSchema();

  assert.ok(statements.includes('ALTER TABLE calendar_tombstones ADD COLUMN sync_token BIGINT UNSIGNED NOT NULL DEFAULT 1 AFTER uid'));
  assert.ok(statements.some(sql => sql.startsWith('UPDATE events INNER JOIN calendars')));
  assert.ok(statements.some(sql => sql.startsWith('UPDATE calendar_tombstones INNER JOIN calendars')));
  assert.ok(statements.some(sql => sql.startsWith('DELETE calendar_tombstones FROM calendar_tombstones INNER JOIN events')));
  assert.ok(statements.some(sql => sql.includes("COALESCE(NULLIF(events.resource_name, ''), events.uid)")));
  assert.ok(statements.some(sql => sql.includes('ADD UNIQUE KEY uniq_calendar_tombstone_resource_name (calendar_id, resource_name)')));
  assert.ok(statements.some(sql => sql.includes('ADD KEY idx_events_calendar_sync (calendar_id, sync_token)')));
  assert.ok(statements.some(sql => sql.includes('ADD KEY idx_tombstones_calendar_sync (calendar_id, sync_token)')));
  const createTombstones = statements.find(sql => sql.startsWith('CREATE TABLE IF NOT EXISTS calendar_tombstones'));
  assert.match(createTombstones, /resource_name VARCHAR\(255\).*utf8mb4_bin NOT NULL/);
  assert.match(createTombstones, /UNIQUE KEY uniq_calendar_tombstone_resource_name \(calendar_id, resource_name\)/);
  const resourceBackfillIndex = statements.findIndex(sql => sql.startsWith('UPDATE calendar_tombstones SET resource_name = uid'));
  const duplicateCheckIndex = statements.findIndex(sql => sql.startsWith('SELECT calendar_id, resource_name, COUNT\(\*\) AS duplicate_count FROM calendar_tombstones'));
  const resourceNotNullIndex = statements.findIndex(sql => sql.startsWith('ALTER TABLE calendar_tombstones MODIFY COLUMN resource_name'));
  const resourceUniqueIndex = statements.findIndex(sql => sql.startsWith(
    'ALTER TABLE calendar_tombstones ADD UNIQUE KEY uniq_calendar_tombstone_resource_name',
  ));
  assert.ok(resourceBackfillIndex >= 0 && resourceBackfillIndex < duplicateCheckIndex);
  assert.ok(duplicateCheckIndex < resourceNotNullIndex);
  assert.ok(resourceNotNullIndex < resourceUniqueIndex);
});

test('adding only the event revision column still backfills existing rows to the collection revision', async () => {
  const statements = [];
  const db = require('../src/db.js');
  db.pool.query = async (sql) => {
    const compact = String(sql).replace(/\s+/g, ' ').trim();
    statements.push(compact);
    if (compact === "SHOW COLUMNS FROM events LIKE 'sync_token'") return [[], []];
    if (compact === "SHOW FULL COLUMNS FROM events LIKE 'uid'"
      || compact === "SHOW FULL COLUMNS FROM calendar_tombstones LIKE 'uid'"
      || compact === "SHOW FULL COLUMNS FROM events LIKE 'resource_name'"
      || compact === "SHOW FULL COLUMNS FROM calendar_tombstones LIKE 'resource_name'") {
      return [[{ Collation: 'utf8mb4_bin', Null: 'NO' }], []];
    }
    if (compact.startsWith('SHOW COLUMNS')) return [[{ Field: 'present' }], []];
    if (compact.startsWith('SHOW INDEX FROM calendars')) return [[{ Key_name: 'idx_calendars_user_dav_slug' }], []];
    if (compact === 'SHOW INDEX FROM events') {
      return [[
        { Non_unique: 0, Key_name: 'uniq_events_calendar_uid', Seq_in_index: 1, Column_name: 'calendar_id' },
        { Non_unique: 0, Key_name: 'uniq_events_calendar_uid', Seq_in_index: 2, Column_name: 'uid' },
        { Non_unique: 0, Key_name: 'uniq_events_calendar_resource_name', Seq_in_index: 1, Column_name: 'calendar_id' },
        { Non_unique: 0, Key_name: 'uniq_events_calendar_resource_name', Seq_in_index: 2, Column_name: 'resource_name' },
      ], []];
    }
    if (compact === 'SHOW INDEX FROM calendar_tombstones') {
      return [[
        { Non_unique: 0, Key_name: 'uniq_calendar_tombstone_resource_name', Seq_in_index: 1, Column_name: 'calendar_id' },
        { Non_unique: 0, Key_name: 'uniq_calendar_tombstone_resource_name', Seq_in_index: 2, Column_name: 'resource_name' },
        { Non_unique: 1, Key_name: 'idx_tombstones_calendar_sync', Seq_in_index: 1, Column_name: 'calendar_id' },
        { Non_unique: 1, Key_name: 'idx_tombstones_calendar_sync', Seq_in_index: 2, Column_name: 'sync_token' },
      ], []];
    }
    if (compact === 'SELECT id, user_id, name, dav_slug FROM calendars ORDER BY user_id ASC, id ASC') return [[], []];
    return [{ affectedRows: 1 }, []];
  };

  const modulePath = require.resolve('../src/calendar-utils.js');
  delete require.cache[modulePath];
  const { ensureCalendarSchema } = require(modulePath);
  await ensureCalendarSchema();

  assert.ok(statements.includes('ALTER TABLE events ADD COLUMN sync_token BIGINT UNSIGNED NOT NULL DEFAULT 1 AFTER ical_data'));
  assert.ok(statements.some(sql => sql.startsWith('UPDATE events INNER JOIN calendars')));
  assert.ok(statements.some(sql => sql.startsWith('UPDATE calendar_tombstones INNER JOIN calendars')));
});

test('calendar UID migration preserves case-distinct opaque event and tombstone identities', async () => {
  const statements = [];
  const db = require('../src/db.js');
  db.pool.query = async (sql) => {
    const compact = String(sql).replace(/\s+/g, ' ').trim();
    statements.push(compact);
    if (compact === "SHOW FULL COLUMNS FROM events LIKE 'resource_name'") {
      return [[{ Collation: 'utf8mb4_bin', Null: 'YES' }], []];
    }
    if (compact === "SHOW FULL COLUMNS FROM events LIKE 'uid'"
      || compact === "SHOW FULL COLUMNS FROM calendar_tombstones LIKE 'uid'"
      || compact === "SHOW FULL COLUMNS FROM calendar_tombstones LIKE 'resource_name'") {
      return [[{ Collation: 'utf8mb4_unicode_ci', Null: 'NO' }], []];
    }
    if (compact.startsWith('SHOW COLUMNS')) return [[{ Field: 'present' }], []];
    if (compact.startsWith('SHOW INDEX FROM calendars')) return [[{ Key_name: 'idx_calendars_user_dav_slug' }], []];
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
    if (compact === 'SHOW INDEX FROM calendar_tombstones') {
      return [[
        { Non_unique: 0, Key_name: 'uniq_calendar_tombstone_resource_name', Seq_in_index: 1, Column_name: 'calendar_id' },
        { Non_unique: 0, Key_name: 'uniq_calendar_tombstone_resource_name', Seq_in_index: 2, Column_name: 'resource_name' },
        { Non_unique: 1, Key_name: 'idx_tombstones_calendar_sync', Seq_in_index: 1, Column_name: 'calendar_id' },
        { Non_unique: 1, Key_name: 'idx_tombstones_calendar_sync', Seq_in_index: 2, Column_name: 'sync_token' },
      ], []];
    }
    if (compact === 'SELECT id, user_id, name, dav_slug FROM calendars ORDER BY user_id ASC, id ASC') return [[], []];
    return [{ affectedRows: 1 }, []];
  };

  const modulePath = require.resolve('../src/calendar-utils.js');
  delete require.cache[modulePath];
  const { ensureCalendarSchema } = require(modulePath);
  await ensureCalendarSchema();

  assert.ok(statements.includes(
    'ALTER TABLE events MODIFY COLUMN uid VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL',
  ));
  assert.ok(statements.includes(
    'ALTER TABLE calendar_tombstones MODIFY COLUMN uid VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL',
  ));
  assert.ok(statements.includes(
    'ALTER TABLE events MODIFY COLUMN resource_name VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL',
  ));
  const resourceBackfillIndex = statements.indexOf(
    'UPDATE events AS event_rows SET event_rows.resource_name = event_rows.uid WHERE event_rows.resource_name IS NULL OR event_rows.resource_name = \'\'',
  );
  const resourceConstraintIndex = statements.indexOf(
    'ALTER TABLE events MODIFY COLUMN resource_name VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL',
  );
  assert.ok(resourceBackfillIndex >= 0 && resourceBackfillIndex < resourceConstraintIndex);
  assert.ok(statements.some(sql => sql.includes('uid VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL')));
});

test('calendar schema initialization fails closed when duplicate event UIDs prevent the required unique key', async () => {
  const statements = [];
  const db = require('../src/db.js');
  db.pool.query = async (sql) => {
    const compact = String(sql).replace(/\s+/g, ' ').trim();
    statements.push(compact);
    if (compact === "SHOW FULL COLUMNS FROM events LIKE 'uid'"
      || compact === "SHOW FULL COLUMNS FROM calendar_tombstones LIKE 'uid'"
      || compact === "SHOW FULL COLUMNS FROM events LIKE 'resource_name'"
      || compact === "SHOW FULL COLUMNS FROM calendar_tombstones LIKE 'resource_name'") {
      return [[{ Collation: 'utf8mb4_bin', Null: 'NO' }], []];
    }
    if (compact.startsWith('SHOW COLUMNS')) return [[{ Field: 'present' }], []];
    if (compact.startsWith('SHOW INDEX FROM calendars')) return [[{ Key_name: 'idx_calendars_user_dav_slug' }], []];
    if (compact === 'SHOW INDEX FROM events') {
      return [[
        { Non_unique: 0, Key_name: 'uniq_events_calendar_resource_name', Seq_in_index: 1, Column_name: 'calendar_id' },
        { Non_unique: 0, Key_name: 'uniq_events_calendar_resource_name', Seq_in_index: 2, Column_name: 'resource_name' },
        { Non_unique: 1, Key_name: 'idx_events_calendar_sync', Seq_in_index: 1, Column_name: 'calendar_id' },
        { Non_unique: 1, Key_name: 'idx_events_calendar_sync', Seq_in_index: 2, Column_name: 'sync_token' },
      ], []];
    }
    if (compact.startsWith('SELECT calendar_id, uid, COUNT(*) AS duplicate_count')) {
      return [[{ calendar_id: 17, uid: 'duplicate-event', duplicate_count: 2 }], []];
    }
    if (compact === 'SHOW INDEX FROM calendar_tombstones') {
      return [[
        { Non_unique: 0, Key_name: 'uniq_calendar_tombstone_resource_name', Seq_in_index: 1, Column_name: 'calendar_id' },
        { Non_unique: 0, Key_name: 'uniq_calendar_tombstone_resource_name', Seq_in_index: 2, Column_name: 'resource_name' },
        { Non_unique: 1, Key_name: 'idx_tombstones_calendar_sync', Seq_in_index: 1, Column_name: 'calendar_id' },
        { Non_unique: 1, Key_name: 'idx_tombstones_calendar_sync', Seq_in_index: 2, Column_name: 'sync_token' },
      ], []];
    }
    if (compact === 'SELECT id, user_id, name, dav_slug FROM calendars ORDER BY user_id ASC, id ASC') return [[], []];
    return [{ affectedRows: 1 }, []];
  };

  const modulePath = require.resolve('../src/calendar-utils.js');
  delete require.cache[modulePath];
  const { ensureCalendarSchema } = require(modulePath);
  await assert.rejects(
    ensureCalendarSchema(),
    /calendar 17.*duplicate-event.*2 rows.*unique.*calendar_id.*uid/i,
  );
  assert.equal(statements.some(sql => sql.includes('ADD UNIQUE KEY uniq_events_calendar_uid')), false);
});

test('calendar resource-name migration fails closed without merging duplicate href identities', async () => {
  const statements = [];
  const db = require('../src/db.js');
  db.pool.query = async (sql) => {
    const compact = String(sql).replace(/\s+/g, ' ').trim();
    statements.push(compact);
    if (compact.startsWith('SHOW COLUMNS')) return [[{ Field: 'present' }], []];
    if (compact.startsWith('SHOW INDEX FROM calendars')) {
      return [[
        { Non_unique: 0, Key_name: 'uniq_calendars_user_dav_slug', Seq_in_index: 1, Column_name: 'user_id' },
        { Non_unique: 0, Key_name: 'uniq_calendars_user_dav_slug', Seq_in_index: 2, Column_name: 'dav_slug' },
      ], []];
    }
    if (compact.startsWith('SELECT user_id, dav_slug, COUNT(*)')) return [[], []];
    if (compact === 'SELECT id, user_id, name, dav_slug FROM calendars ORDER BY user_id ASC, id ASC') return [[], []];
    if (compact === "SHOW FULL COLUMNS FROM events LIKE 'uid'"
      || compact === "SHOW FULL COLUMNS FROM events LIKE 'resource_name'") {
      return [[{ Collation: 'utf8mb4_bin', Null: 'YES' }], []];
    }
    if (compact.startsWith('SELECT calendar_id, resource_name, COUNT(*) AS duplicate_count FROM events')) {
      return [[{ calendar_id: 23, resource_name: 'same-href', duplicate_count: 2 }], []];
    }
    return [{ affectedRows: 1 }, []];
  };

  const modulePath = require.resolve('../src/calendar-utils.js');
  delete require.cache[modulePath];
  const { ensureCalendarSchema } = require(modulePath);
  await assert.rejects(
    ensureCalendarSchema(),
    /calendar 23.*same-href.*2 rows.*duplicate calendar resources/i,
  );
  assert.equal(statements.some(sql => /DELETE older FROM events|DELETE .*events.*duplicate/i.test(sql)), false);
});
