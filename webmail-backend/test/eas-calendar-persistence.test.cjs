const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.OMS_DB_PASSWORD ||= 'unit-test-password';

const db = require('../src/db.js');

function calendarIcal(uid, title = uid) {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//OpenMailStack//ActiveSync Persistence Test//EN',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    'DTSTAMP:20260815T120000Z',
    'DTSTART:20260816T120000Z',
    `SUMMARY:${title}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
}

function calendarUid(ical) {
  return String(ical || '').match(/(?:^|\r?\n)UID:([^\r\n]+)/)?.[1] || null;
}

function fakeCalendarConnection(initialEvent, initialTombstone, initialCalendarRevision = 7, initialResourceName = null) {
  let event = initialEvent;
  let tombstone = initialTombstone;
  let syncTokenChanges = 0;
  let eventSyncToken = initialEvent === null ? 0 : 1;
  let resourceName = initialEvent === null ? null : initialResourceName;
  let logicalUid = initialEvent === null ? null : calendarUid(initialEvent);
  let calendarRevision = initialCalendarRevision;
  const transactions = [];
  const connection = {
    beginTransaction: async () => transactions.push('begin'),
    commit: async () => transactions.push('commit'),
    rollback: async () => transactions.push('rollback'),
    release: () => transactions.push('release'),
    query: async (sql, params) => {
      const compact = String(sql).replace(/\s+/g, ' ').trim();
      if (compact === 'SELECT sync_token FROM calendars WHERE id = ? LIMIT 1 FOR UPDATE') {
        return [[{ sync_token: calendarRevision }], []];
      }
      if (compact.startsWith('SELECT uid, resource_name, ical_data FROM events')) {
        return [event === null || resourceName !== params[1]
          ? []
          : [{ uid: logicalUid, resource_name: resourceName, ical_data: event }], []];
      }
      if (compact.startsWith('SELECT resource_name FROM events')) {
        const conflict = event !== null && logicalUid === params[1] && resourceName !== params[2];
        return [conflict ? [{ resource_name: resourceName }] : [], []];
      }
      if (compact.startsWith('INSERT INTO events')) {
        logicalUid = params[1];
        resourceName = params[2];
        event = params[3];
        eventSyncToken = Number(params[4]);
        return [{ affectedRows: 1 }, []];
      }
      if (compact.startsWith('UPDATE events SET uid')) {
        logicalUid = params[0];
        resourceName = params[1];
        event = params[2];
        eventSyncToken = Number(params[3]);
        return [{ affectedRows: 1 }, []];
      }
      if (compact === 'DELETE FROM calendar_tombstones WHERE calendar_id = ? AND BINARY resource_name = BINARY ?') {
        if (Array.isArray(tombstone)) {
          const retained = tombstone.filter(row => row.resourceName !== params[1]);
          const affectedRows = tombstone.length - retained.length;
          tombstone = retained;
          return [{ affectedRows }, []];
        }
        const affectedRows = tombstone ? 1 : 0;
        tombstone = false;
        return [{ affectedRows }, []];
      }
      if (compact.startsWith('DELETE FROM events')) {
        const affectedRows = event !== null && resourceName === params[1] ? 1 : 0;
        if (affectedRows) {
          event = null;
          logicalUid = null;
          eventSyncToken = 0;
        }
        return [{ affectedRows }, []];
      }
      if (compact.startsWith('INSERT INTO calendar_tombstones')) {
        tombstone = { uid: params[1], resourceName: params[2], revision: Number(params[3]) };
        return [{ affectedRows: 1 }, []];
      }
      if (compact.startsWith('UPDATE calendars SET sync_token')) {
        assert.deepEqual(params, [calendarRevision + 1, 7, calendarRevision]);
        calendarRevision = Number(params[0]);
        syncTokenChanges += 1;
        return [{ affectedRows: 1 }, []];
      }
      throw new Error(`Unexpected query: ${compact}`);
    },
  };
  return { connection, state: () => ({ event, logicalUid, resourceName, eventSyncToken, tombstone, calendarRevision, syncTokenChanges, transactions }) };
}

test('ActiveSync calendar recreate atomically clears a matching CalDAV tombstone', async () => {
  const fake = fakeCalendarConnection(null, true);
  db.pool.getConnection = async () => fake.connection;
  const { saveActiveSyncCalendarEvent } = require('../src/eas-calendar-persistence.js');
  const created = calendarIcal('logical-recreated', 'Created');

  assert.equal(await saveActiveSyncCalendarEvent(7, 'recreated', created, null), 'changed');
  assert.deepEqual(fake.state(), {
    event: created,
    logicalUid: 'logical-recreated',
    resourceName: 'recreated',
    eventSyncToken: 8,
    tombstone: false,
    calendarRevision: 8,
    syncTokenChanges: 1,
    transactions: ['begin', 'commit', 'release'],
  });
});

test('ActiveSync recreation preserves a same-UID tombstone for a different opaque href', async () => {
  const historicalDelete = { uid: 'logical-recreated', resourceName: 'old-opaque-href', revision: 6 };
  const fake = fakeCalendarConnection(null, [historicalDelete]);
  db.pool.getConnection = async () => fake.connection;
  const { saveActiveSyncCalendarEvent } = require('../src/eas-calendar-persistence.js');
  const created = calendarIcal('logical-recreated', 'Created');

  assert.equal(await saveActiveSyncCalendarEvent(7, 'recreated', created, null), 'changed');
  assert.deepEqual(fake.state(), {
    event: created,
    logicalUid: 'logical-recreated',
    resourceName: 'recreated',
    eventSyncToken: 8,
    tombstone: [historicalDelete],
    calendarRevision: 8,
    syncTokenChanges: 1,
    transactions: ['begin', 'commit', 'release'],
  });
});

test('a stale tombstone is cleared even when the live event body is unchanged', async () => {
  const unchanged = calendarIcal('live-with-stale-delete', 'Same');
  const fake = fakeCalendarConnection(unchanged, true, 7, 'live-resource');
  db.pool.getConnection = async () => fake.connection;
  const { saveActiveSyncCalendarEvent } = require('../src/eas-calendar-persistence.js');

  assert.equal(await saveActiveSyncCalendarEvent(7, 'live-resource', unchanged, unchanged), 'changed');
  assert.deepEqual(fake.state(), {
    event: unchanged,
    logicalUid: 'live-with-stale-delete',
    resourceName: 'live-resource',
    eventSyncToken: 8,
    tombstone: false,
    calendarRevision: 8,
    syncTokenChanges: 1,
    transactions: ['begin', 'commit', 'release'],
  });
});

test('an identical live event without a tombstone remains a no-op', async () => {
  const unchanged = calendarIcal('logical-unchanged', 'Same');
  const fake = fakeCalendarConnection(unchanged, false, 7, 'unchanged-resource');
  db.pool.getConnection = async () => fake.connection;
  const { saveActiveSyncCalendarEvent } = require('../src/eas-calendar-persistence.js');

  assert.equal(await saveActiveSyncCalendarEvent(7, 'unchanged-resource', unchanged, unchanged), 'unchanged');
  assert.deepEqual(fake.state(), {
    event: unchanged,
    logicalUid: 'logical-unchanged',
    resourceName: 'unchanged-resource',
    eventSyncToken: 1,
    tombstone: false,
    calendarRevision: 7,
    syncTokenChanges: 0,
    transactions: ['begin', 'rollback', 'release'],
  });
});

test('ActiveSync Change keeps the opaque resource identity while persisting the validated logical UID', async () => {
  const original = calendarIcal('client-logical-uid', 'Original');
  const changed = calendarIcal('client-logical-uid', 'Changed');
  const fake = fakeCalendarConnection(original, false, 7, 'stable-server-resource');
  db.pool.getConnection = async () => fake.connection;
  const { saveActiveSyncCalendarEvent } = require('../src/eas-calendar-persistence.js');

  assert.equal(
    await saveActiveSyncCalendarEvent(7, 'stable-server-resource', changed, original),
    'changed',
  );
  assert.deepEqual(fake.state(), {
    event: changed,
    logicalUid: 'client-logical-uid',
    resourceName: 'stable-server-resource',
    eventSyncToken: 8,
    tombstone: false,
    calendarRevision: 8,
    syncTokenChanges: 1,
    transactions: ['begin', 'commit', 'release'],
  });
});

test('ActiveSync Add rejects a duplicate logical UID at another resource identity', async () => {
  const existing = calendarIcal('shared-logical-uid', 'Existing');
  const duplicate = calendarIcal('shared-logical-uid', 'Duplicate');
  const fake = fakeCalendarConnection(existing, false, 7, 'first-resource');
  db.pool.getConnection = async () => fake.connection;
  const { saveActiveSyncCalendarEvent } = require('../src/eas-calendar-persistence.js');

  assert.equal(await saveActiveSyncCalendarEvent(7, 'second-resource', duplicate, null), 'conflict');
  assert.deepEqual(fake.state(), {
    event: existing,
    logicalUid: 'shared-logical-uid',
    resourceName: 'first-resource',
    eventSyncToken: 1,
    tombstone: false,
    calendarRevision: 7,
    syncTokenChanges: 0,
    transactions: ['begin', 'rollback', 'release'],
  });
});

test('ActiveSync calendar delete preserves an opaque CalDAV href in its tombstone', async () => {
  const deleted = calendarIcal('logical-deleted', 'Deleted');
  const fake = fakeCalendarConnection(deleted, false, 7, 'opaque-resource-name');
  db.pool.getConnection = async () => fake.connection;
  const { deleteActiveSyncCalendarEvent } = require('../src/eas-calendar-persistence.js');

  assert.equal(await deleteActiveSyncCalendarEvent(7, 'opaque-resource-name', deleted), 'changed');
  assert.deepEqual(fake.state(), {
    event: null,
    logicalUid: null,
    resourceName: 'opaque-resource-name',
    eventSyncToken: 0,
    tombstone: { uid: 'logical-deleted', resourceName: 'opaque-resource-name', revision: 8 },
    calendarRevision: 8,
    syncTokenChanges: 1,
    transactions: ['begin', 'commit', 'release'],
  });
});

test('all calendar content writers use the centralized transaction-scoped collection revision contract', () => {
  const expectedSourceFiles = [
    'apps-api.ts', 'birthday-calendar.ts', 'caldav.ts', 'calendar-subscription.ts', 'eas-calendar-persistence.ts',
    'scheduler/store.ts',
  ];
  const sourceRoot = process.env.OMS_SOURCE_ROOT || path.join(__dirname, '../src');
  const sourceFiles = (function walk(directory) {
    return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
      const absolute = path.join(directory, entry.name);
      return entry.isDirectory() ? walk(absolute) : entry.name.endsWith('.ts') ? [absolute] : [];
    });
  })(sourceRoot);
  const writerFiles = sourceFiles.filter(absolute =>
    /INSERT INTO events|UPDATE events SET/.test(fs.readFileSync(absolute, 'utf8'))
  ).map(absolute => path.relative(sourceRoot, absolute));
  assert.deepEqual(writerFiles.sort(), expectedSourceFiles.sort());

  for (const relative of writerFiles) {
    const source = fs.readFileSync(path.join(sourceRoot, relative), 'utf8');
    assert.match(
      source,
      /allocateCalendarCollectionRevisionOnConnection/,
      `${relative} must allocate the shared collection revision inside its transaction`,
    );
    for (const statement of source.matchAll(/(?:INSERT INTO events|UPDATE events SET)[\s\S]{0,420}?(?:`|'|\")/g)) {
      assert.match(statement[0], /sync_token/, `${relative} event writer must version its row`);
    }
    assert.doesNotMatch(source, /UPDATE events SET[\s\S]{0,180}?sync_token\s*=\s*sync_token\s*\+\s*1/);
    for (const insert of source.matchAll(/INSERT INTO events\s*\(([^)]*)\)\s*VALUES\s*\(([^)]*)\)/g)) {
      const columns = insert[1].split(',').map(column => column.trim().toLowerCase());
      const values = insert[2].split(',').map(value => value.trim());
      const syncTokenIndex = columns.indexOf('sync_token');
      assert.notEqual(
        values[syncTokenIndex],
        '1',
        `${relative} must not hard-code the collection revision`,
      );
    }
  }

  const persistence = fs.readFileSync(path.join(sourceRoot, 'eas-calendar-persistence.ts'), 'utf8');
  assert.match(persistence, /UPDATE events SET uid = \?, resource_name = \?, ical_data = \?, sync_token = \?/);
  assert.match(persistence, /DELETE FROM calendar_tombstones WHERE calendar_id = \? AND BINARY resource_name = BINARY \?/);
  assert.match(persistence, /SELECT resource_name FROM events[\s\S]*BINARY uid = BINARY \?/);
  assert.match(persistence, /calendar_tombstones \(calendar_id, uid, resource_name, sync_token, deleted_at\)/);

  const calendarSchema = fs.readFileSync(path.join(sourceRoot, 'calendar-utils.ts'), 'utf8');
  assert.match(calendarSchema, /SELECT sync_token FROM calendars WHERE id = \? LIMIT 1 FOR UPDATE/);
  assert.match(calendarSchema, /UPDATE calendars SET sync_token = \? WHERE id = \? AND sync_token = \?/);
  assert.match(calendarSchema, /SHOW COLUMNS FROM events LIKE 'sync_token'/);
  assert.match(calendarSchema, /ALTER TABLE events ADD COLUMN sync_token BIGINT UNSIGNED NOT NULL DEFAULT 1/);
});
