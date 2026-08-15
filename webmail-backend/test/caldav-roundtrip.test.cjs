process.env.OMS_DB_PASSWORD ||= 'caldav-roundtrip-test';
process.env.OMS_DEFAULT_DOMAIN ||= 'example.test';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const xml2js = require('xml2js');

const user = 'mac@example.test';
const calendar = {
  id: 7,
  user_id: user,
  name: 'macOS Interop',
  dav_slug: 'macos-interop',
  components: 'VEVENT',
  sync_token: 1,
};
let database;
let wallClock;
let calendarLockTail = Promise.resolve();
let failNextStatementContaining = null;
let concurrentPoolReadBarrier = null;
let defaultCalendarSelectionSql = '';

function resetDatabase() {
  calendar.name = 'macOS Interop';
  calendar.dav_slug = 'macos-interop';
  delete calendar.subscribed_url;
  calendar.sync_token = 1;
  wallClock = 0;
  database = {
    events: new Map(),
    tombstones: new Map(),
    shares: new Map([
      ['shared@example.test', 'write'],
      ['reader@example.test', 'read'],
    ]),
    calendarExists: true,
  };
  calendarLockTail = Promise.resolve();
  failNextStatementContaining = null;
  concurrentPoolReadBarrier = null;
  defaultCalendarSelectionSql = '';
}

function cloneDatabase(source) {
  return {
    events: new Map([...source.events].map(([uid, event]) => [uid, { ...event }])),
    tombstones: new Map([...source.tombstones].map(([uid, tombstone]) => [uid, { ...tombstone }])),
    shares: new Map(source.shares),
    calendarExists: source.calendarExists,
  };
}

function logicalUidFromIcal(icalData) {
  return String(icalData).match(/(?:^|\r?\n)UID:([^\r\n]+)/)?.[1] || '';
}

function eventRow(resourceName, icalData, syncToken, logicalUid = logicalUidFromIcal(icalData) || resourceName) {
  wallClock += 1;
  return {
    uid: logicalUid,
    resource_name: resourceName,
    ical_data: icalData,
    sync_token: Number(syncToken),
    updated_at: new Date(Date.UTC(2026, 6, 20, 12, 0, wallClock)),
  };
}

async function queryDatabase(target, sql, params = []) {
  const compact = String(sql).replace(/\s+/g, ' ').trim();
  if (compact.startsWith('SELECT resource_name, uid FROM events')) {
    const conflict = [...target.events.values()].find(event =>
      event.uid === params[1] && event.resource_name !== params[2]
    );
    return [conflict ? [{ uid: conflict.uid, resource_name: conflict.resource_name }] : [], []];
  }
  if (compact.startsWith('SELECT resource_name FROM events')) {
    const conflict = [...target.events.values()].find(event =>
      event.uid === params[1] && event.resource_name !== params[2]
    );
    return [conflict ? [{ resource_name: conflict.resource_name }] : [], []];
  }
  if (compact.startsWith('SELECT uid, resource_name, ical_data, updated_at')
    || compact.startsWith('SELECT uid, resource_name, ical_data FROM events')
    || compact.startsWith('SELECT * FROM events WHERE calendar_id = ? AND BINARY COALESCE')) {
    const event = target.events.get(params[1]);
    return [event ? [{ ...event }] : [], []];
  }
  if (compact.startsWith('INSERT INTO events')) {
    target.events.set(params[2], eventRow(params[2], params[3], params[4] ?? 1, params[1]));
    return [{ affectedRows: 1 }, []];
  }
  if (compact.startsWith('UPDATE events SET uid = ?')) {
    const previousResourceName = params[5];
    const existing = target.events.get(previousResourceName);
    if (!existing) return [{ affectedRows: 0 }, []];
    target.events.delete(previousResourceName);
    target.events.set(params[1], eventRow(params[1], params[2], params[3], params[0]));
    return [{ affectedRows: 1 }, []];
  }
  if (compact.startsWith('DELETE FROM calendar_tombstones') && compact.includes('COALESCE')) {
    return [{ affectedRows: target.tombstones.delete(params[1]) ? 1 : 0 }, []];
  }
  if (compact === 'DELETE FROM calendar_tombstones WHERE calendar_id = ? AND BINARY resource_name = BINARY ?') {
    return [{ affectedRows: target.tombstones.delete(params[1]) ? 1 : 0 }, []];
  }
  if (compact === 'DELETE FROM calendar_tombstones WHERE calendar_id = ?') {
    const affectedRows = target.tombstones.size;
    target.tombstones.clear();
    return [{ affectedRows }, []];
  }
  if (compact.startsWith('INSERT INTO calendar_tombstones')) {
    target.tombstones.set(params[2], {
      uid: params[1],
      resource_name: params[2],
      sync_token: Number(params[3] ?? calendar.sync_token + 1),
      deleted_at: new Date(Date.UTC(2026, 6, 20, 13, 0, ++wallClock)),
    });
    return [{ affectedRows: 1 }, []];
  }
  if (compact.startsWith('DELETE FROM events WHERE calendar_id')) {
    if (params.length === 1) {
      const affectedRows = target.events.size;
      target.events.clear();
      return [{ affectedRows }, []];
    }
    return [{ affectedRows: target.events.delete(params[1]) ? 1 : 0 }, []];
  }
  if (compact === 'DELETE FROM calendar_shares WHERE calendar_id = ?') {
    const affectedRows = target.shares.size;
    target.shares.clear();
    return [{ affectedRows }, []];
  }
  if (compact.startsWith('DELETE FROM calendars WHERE id = ? AND user_id = ?')) {
    const affectedRows = target.calendarExists ? 1 : 0;
    target.calendarExists = false;
    return [{ affectedRows }, []];
  }
  throw new Error(`Unexpected CalDAV data query: ${compact}`);
}

function createConnection() {
  let working = null;
  let workingSyncToken = null;
  let releaseCalendarLock = null;
  let inTransaction = false;

  const acquireCalendarLock = async () => {
    const predecessor = calendarLockTail;
    let release;
    calendarLockTail = new Promise(resolve => { release = resolve; });
    await predecessor;
    releaseCalendarLock = release;
    working = cloneDatabase(database);
    workingSyncToken = calendar.sync_token;
  };

  const release = () => {
    if (releaseCalendarLock) releaseCalendarLock();
    releaseCalendarLock = null;
    working = null;
    workingSyncToken = null;
  };

  return {
    beginTransaction: async () => { inTransaction = true; },
    commit: async () => {
      if (working) {
        database = working;
        calendar.sync_token = workingSyncToken;
      }
      inTransaction = false;
      release();
    },
    rollback: async () => {
      inTransaction = false;
      release();
    },
    release: () => release(),
    query: async (sql, params = []) => {
      const compact = String(sql).replace(/\s+/g, ' ').trim();
      if (!inTransaction) throw new Error('Calendar mutation query escaped its transaction');
      if (compact.startsWith('SELECT c.user_id')) {
        if (!working) await acquireCalendarLock();
        const requestingUser = params[0];
        return working.calendarExists ? [[{
          user_id: user,
          dav_slug: calendar.dav_slug,
          subscribed_url: calendar.subscribed_url || null,
          permission: requestingUser === user ? null : working.shares.get(requestingUser) || null,
        }], []] : [[], []];
      }
      if (compact.startsWith('SELECT user_id FROM calendars WHERE id = ?')) {
        if (!working) await acquireCalendarLock();
        return working.calendarExists ? [[{ user_id: user }], []] : [[], []];
      }
      if (compact === 'SELECT sync_token FROM calendars WHERE id = ? LIMIT 1 FOR UPDATE') {
        if (!working) await acquireCalendarLock();
        return [[{ sync_token: workingSyncToken }], []];
      }
      if (failNextStatementContaining && compact.includes(failNextStatementContaining)) {
        failNextStatementContaining = null;
        throw new Error('Injected calendar transaction failure');
      }
      if (compact === 'UPDATE calendars SET sync_token = ? WHERE id = ? AND sync_token = ?') {
        if (Number(params[2]) !== workingSyncToken) return [{ affectedRows: 0 }, []];
        workingSyncToken = Number(params[0]);
        return [{ affectedRows: 1 }, []];
      }
      return queryDatabase(working || database, compact, params);
    },
  };
}

resetDatabase();

const db = require('../src/db.js');
db.pool.query = async (sql, params = []) => {
  const compact = String(sql).replace(/\s+/g, ' ').trim();
  if (compact === "SHOW FULL COLUMNS FROM events LIKE 'uid'"
    || compact === "SHOW FULL COLUMNS FROM calendar_tombstones LIKE 'uid'"
    || compact === "SHOW FULL COLUMNS FROM events LIKE 'resource_name'"
    || compact === "SHOW FULL COLUMNS FROM calendar_tombstones LIKE 'resource_name'") {
    return [[{ Collation: 'utf8mb4_bin', Null: 'NO' }], []];
  }
  if (compact.startsWith('SHOW COLUMNS')) return [[{ Field: 'present' }], []];
  if (compact.startsWith('SHOW INDEX FROM calendars')) {
    return [[
      { Non_unique: 0, Key_name: 'uniq_calendars_user_dav_slug', Seq_in_index: 1, Column_name: 'user_id' },
      { Non_unique: 0, Key_name: 'uniq_calendars_user_dav_slug', Seq_in_index: 2, Column_name: 'dav_slug' },
    ], []];
  }
  if (compact.startsWith('SELECT user_id, dav_slug, COUNT(*) AS duplicate_count FROM calendars')) return [[], []];
  if (compact === "UPDATE calendars SET dav_slug = NULL WHERE dav_slug = ''") return [{ affectedRows: 0 }, []];
  if (compact.startsWith('SHOW INDEX FROM events')) {
    return [[
      { Non_unique: 0, Key_name: 'uniq_events_calendar_uid', Seq_in_index: 1, Column_name: 'calendar_id' },
      { Non_unique: 0, Key_name: 'uniq_events_calendar_uid', Seq_in_index: 2, Column_name: 'uid' },
      { Non_unique: 0, Key_name: 'uniq_events_calendar_resource_name', Seq_in_index: 1, Column_name: 'calendar_id' },
      { Non_unique: 0, Key_name: 'uniq_events_calendar_resource_name', Seq_in_index: 2, Column_name: 'resource_name' },
      { Non_unique: 1, Key_name: 'idx_events_calendar_sync', Seq_in_index: 1, Column_name: 'calendar_id' },
      { Non_unique: 1, Key_name: 'idx_events_calendar_sync', Seq_in_index: 2, Column_name: 'sync_token' },
    ], []];
  }
  if (compact.startsWith('SHOW INDEX FROM calendar_tombstones')) {
    return [[
      { Non_unique: 0, Key_name: 'uniq_calendar_tombstone_resource_name', Seq_in_index: 1, Column_name: 'calendar_id' },
      { Non_unique: 0, Key_name: 'uniq_calendar_tombstone_resource_name', Seq_in_index: 2, Column_name: 'resource_name' },
      { Non_unique: 1, Key_name: 'idx_tombstones_calendar_sync', Seq_in_index: 1, Column_name: 'calendar_id' },
      { Non_unique: 1, Key_name: 'idx_tombstones_calendar_sync', Seq_in_index: 2, Column_name: 'sync_token' },
    ], []];
  }
  if (compact.startsWith('CREATE TABLE')) return [[], []];
  if (compact.startsWith('UPDATE events AS event_rows SET event_rows.resource_name')) return [{ affectedRows: 0 }, []];
  if (compact.startsWith('UPDATE calendar_tombstones SET resource_name = uid')) return [{ affectedRows: 0 }, []];
  if (compact.startsWith('SELECT calendar_id, resource_name, COUNT(*) AS duplicate_count')) return [[], []];
  if (compact.startsWith('DELETE calendar_tombstones FROM calendar_tombstones')) return [{ affectedRows: 0 }, []];
  if (compact.startsWith('SELECT id, user_id, name, dav_slug FROM calendars')) return [[calendar], []];
  if (compact.startsWith('SELECT c.*, COUNT(e.uid) AS event_count')) {
    const requestedUser = params[0];
    const visible = requestedUser === user || database.shares.has(requestedUser);
    return [database.calendarExists && visible ? [{
      ...calendar,
      event_count: database.events.size,
      access_role: requestedUser === user ? 'owner' : database.shares.get(requestedUser),
    }] : [], []];
  }
  if (compact.startsWith('SELECT c.*, CASE WHEN c.user_id')) {
    const requestedUser = params[0];
    const visible = requestedUser === user || database.shares.has(requestedUser);
    return [database.calendarExists && visible ? [{
      ...calendar,
      access_role: requestedUser === user ? 'owner' : database.shares.get(requestedUser),
    }] : [], []];
  }
  if (compact.startsWith('SELECT * FROM calendars WHERE user_id = ?')) {
    defaultCalendarSelectionSql = compact;
    const requestedUser = String(params[0]);
    const fallback = {
      id: 99,
      user_id: requestedUser,
      name: 'Fallback',
      dav_slug: 'fallback',
      subscribed_url: null,
      sync_token: 1,
    };
    if (requestedUser !== user || !database.calendarExists) return [[fallback], []];
    const writableOnly = compact.includes("LOWER(TRIM(COALESCE(dav_slug, ''))) <> 'birthdays'")
      && compact.includes("subscribed_url IS NULL OR TRIM(subscribed_url) = ''");
    const primaryIsWritable = String(calendar.dav_slug || '').trim().toLowerCase() !== 'birthdays'
      && String(calendar.subscribed_url || '').trim() === '';
    return [[writableOnly && !primaryIsWritable ? fallback : { ...calendar }], []];
  }
  if (compact.startsWith('SELECT c.user_id')) return [[{
    user_id: user,
    dav_slug: calendar.dav_slug,
    subscribed_url: calendar.subscribed_url || null,
    permission: params[0] === user ? null : database.shares.get(params[0]) || null,
  }], []];
  if (failNextStatementContaining && compact.includes(failNextStatementContaining)) {
    failNextStatementContaining = null;
    throw new Error('Injected calendar transaction failure');
  }
  if (concurrentPoolReadBarrier && compact.startsWith('SELECT uid, ical_data, updated_at FROM events')) {
    const result = await queryDatabase(database, compact, params);
    await concurrentPoolReadBarrier();
    return result;
  }
  if (compact.includes('UNION ALL') && compact.includes('FROM events')) {
    const requestedRevision = Number(params[1]);
    const rows = [
      ...[...database.events.values()]
        .filter(event => Number(event.sync_token) > requestedRevision)
        .map(event => ({ ...event, deleted: 0 })),
      ...[...database.tombstones.values()]
        .filter(tombstone => Number(tombstone.sync_token) > requestedRevision)
        .map(tombstone => ({ ...tombstone, ical_data: null, updated_at: tombstone.deleted_at, deleted: 1 })),
    ].sort((left, right) => Number(left.sync_token) - Number(right.sync_token) || left.uid.localeCompare(right.uid));
    return [rows, []];
  }
  if (compact.startsWith('SELECT * FROM events WHERE calendar_id = ? AND updated_at >')) {
    const newestDelete = [...database.tombstones.values()]
      .reduce((latest, tombstone) => Math.max(latest, tombstone.deleted_at.getTime()), 0);
    return [[...database.events.values()]
      .filter(event => event.updated_at.getTime() > newestDelete)
      .map(event => ({ ...event })), []];
  }
  if (compact.startsWith('SELECT uid, deleted_at FROM calendar_tombstones')) {
    return [[...database.tombstones.values()].map(tombstone => ({ ...tombstone })), []];
  }
  if (compact === 'SELECT * FROM events WHERE calendar_id = ?') {
    return [[...database.events.values()].map(event => ({ ...event })), []];
  }
  if (compact.startsWith('UPDATE calendars SET sync_token = sync_token + 1')) {
    calendar.sync_token += 1;
    return [{ affectedRows: 1 }, []];
  }
  if (compact.startsWith('DELETE FROM calendar_tombstones WHERE deleted_at')) return [{ affectedRows: 0 }, []];
  return queryDatabase(database, compact, params);
};
db.pool.getConnection = async () => createConnection();

const imap = require('../src/imap.js');
imap.ImapService.prototype.connect = async function connect() {};
imap.ImapService.prototype.logout = async function logout() {};

const indexPath = require.resolve('../src/index.js');
require.cache[indexPath] = {
  id: indexPath,
  filename: indexPath,
  loaded: true,
  exports: { io: { to: () => ({ emit: () => {} }) } },
  children: [],
  paths: [],
};

const caldavRouter = require('../src/caldav.js').default;
const { ensureDefaultCalendar } = require('../src/calendar-utils.js');
const authFor = (principal) => `Basic ${Buffer.from(`${principal}:test-password`).toString('base64')}`;
const auth = authFor(user);

async function startServer(t) {
  const app = express();
  app.use(express.raw({ type: () => true }));
  app.use('/caldav', caldavRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return server;
}

function eventUrl(server, uid) {
  return `http://127.0.0.1:${server.address().port}/caldav/calendars/${encodeURIComponent(user)}/macos-interop/${encodeURIComponent(uid)}.ics`;
}

function numericEventUrl(server, principal, resourceName) {
  return `http://127.0.0.1:${server.address().port}/caldav/calendars/${encodeURIComponent(principal)}/${calendar.id}/${encodeURIComponent(resourceName)}.ics`;
}

function numericCollectionUrl(server, principal) {
  return `http://127.0.0.1:${server.address().port}/caldav/calendars/${encodeURIComponent(principal)}/${calendar.id}/`;
}

function collectionUrl(server) {
  return `http://127.0.0.1:${server.address().port}/caldav/calendars/${encodeURIComponent(user)}/macos-interop/`;
}

test('CalDAV default selection skips managed and subscribed collections', async () => {
  resetDatabase();
  calendar.dav_slug = 'birthdays';

  const managedDefault = await ensureDefaultCalendar(user);

  assert.equal(managedDefault.id, 99);
  assert.match(defaultCalendarSelectionSql, /dav_slug.*birthdays/i);
  assert.match(defaultCalendarSelectionSql, /subscribed_url.*IS NULL/i);

  resetDatabase();
  calendar.subscribed_url = 'https://calendar.example.test/feed.ics';

  const subscribedDefault = await ensureDefaultCalendar(user);

  assert.equal(subscribedDefault.id, 99);
  assert.match(defaultCalendarSelectionSql, /dav_slug.*birthdays/i);
  assert.match(defaultCalendarSelectionSql, /subscribed_url.*IS NULL/i);
});

function ical(uid, title) {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//OpenMailStack Tests//EN',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    'DTSTAMP:20260720T120000Z',
    'DTSTART:20260724T170000Z',
    'DTEND:20260724T180000Z',
    `SUMMARY:${title}`,
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n');
}

async function putEvent(server, uid, title, headers = {}) {
  return fetch(eventUrl(server, uid), {
    method: 'PUT',
    headers: { Authorization: auth, 'Content-Type': 'text/calendar', ...headers },
    body: ical(uid, title),
  });
}

async function deleteEvent(server, uid, headers = {}) {
  return fetch(eventUrl(server, uid), {
    method: 'DELETE',
    headers: { Authorization: auth, ...headers },
  });
}

async function deleteCollection(server) {
  return fetch(collectionUrl(server), {
    method: 'DELETE',
    headers: { Authorization: auth },
  });
}

function syncTokenFor(cal, revision) {
  return `http://sabre.io/ns/sync/calendar/v2/${cal.id}/${revision}`;
}

async function syncReport(server, revision, token = syncTokenFor(calendar, revision)) {
  return fetch(collectionUrl(server), {
    method: 'REPORT',
    headers: { Authorization: auth, 'Content-Type': 'application/xml' },
    body: [
      '<D:sync-collection xmlns:D="DAV:">',
      `<D:sync-token>${token}</D:sync-token>`,
      '<D:sync-level>1</D:sync-level>',
      '</D:sync-collection>',
    ].join(''),
  });
}

function hrefResponseStatuses(xml, uid) {
  const encoded = `${encodeURIComponent(uid)}.ics`;
  return [...xml.matchAll(/<D:response>([\s\S]*?)<\/D:response>/g)]
    .map(match => match[1])
    .filter(response => response.includes(encoded))
    .map(response => response.match(/HTTP\/1\.1 (\d+)/)?.[1]);
}

test('macOS-style CalDAV create, HEAD, update, GET, and delete is reversible', async (t) => {
  resetDatabase();
  const app = express();
  app.use(express.raw({ type: () => true }));
  app.use('/caldav', caldavRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));

  const address = server.address();
  const url = `http://127.0.0.1:${address.port}/caldav/calendars/${encodeURIComponent(user)}/macos-interop/apple-event.ics`;
  const original = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Apple Inc.//macOS Calendar//EN',
    'BEGIN:VEVENT',
    'UID:apple-event',
    'DTSTAMP:20260720T120000Z',
    'DTSTART;TZID=Asia/Baghdad:20260724T200000',
    'DTEND;TZID=Asia/Baghdad:20260724T210000',
    'SUMMARY:macOS round trip',
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n');

  const created = await fetch(url, {
    method: 'PUT',
    headers: { Authorization: auth, 'Content-Type': 'text/calendar', 'If-None-Match': '*' },
    body: original,
  });
  assert.equal(created.status, 201);
  const originalEtag = created.headers.get('etag');
  assert.ok(originalEtag);

  const head = await fetch(url, { method: 'HEAD', headers: { Authorization: auth } });
  assert.equal(head.status, 200);
  assert.equal(head.headers.get('etag'), originalEtag);
  assert.equal(await head.text(), '');

  const fetched = await fetch(url, { headers: { Authorization: auth } });
  assert.equal(fetched.status, 200);
  assert.equal(fetched.headers.get('etag'), originalEtag);
  assert.equal(await fetched.text(), original);

  const rejected = await fetch(url, {
    method: 'PUT',
    headers: { Authorization: auth, 'Content-Type': 'text/calendar', 'If-Match': '"stale"' },
    body: original.replace('round trip', 'stale overwrite'),
  });
  assert.equal(rejected.status, 412);

  const editedBody = original.replace('round trip', 'updated');
  const updated = await fetch(url, {
    method: 'PUT',
    headers: { Authorization: auth, 'Content-Type': 'text/calendar', 'If-Match': originalEtag },
    body: editedBody,
  });
  assert.equal(updated.status, 204);
  assert.notEqual(updated.headers.get('etag'), originalEtag);

  const edited = await fetch(url, { headers: { Authorization: auth } });
  assert.equal(edited.headers.get('etag'), updated.headers.get('etag'));
  assert.equal(await edited.text(), editedBody);

  const deleted = await fetch(url, { method: 'DELETE', headers: { Authorization: auth } });
  assert.equal(deleted.status, 204);
  const absent = await fetch(url, { headers: { Authorization: auth } });
  assert.equal(absent.status, 404);
});

test('ActiveSync Add and Change retain one stable CalDAV resource for a distinct logical UID', async (t) => {
  resetDatabase();
  const server = await startServer(t);
  const { saveActiveSyncCalendarEvent } = require('../src/eas-calendar-persistence.js');
  const { pimWireServerId } = require('../src/eas-pim-sync.js');
  const resourceName = 'eas-stable-resource';
  const logicalUid = 'client-owned-logical-uid@example.test';
  const created = ical(logicalUid, 'Created through EAS');
  const changed = ical(logicalUid, 'Changed through EAS');
  const serverId = pimWireServerId(`cal-${calendar.id}`, resourceName);

  assert.equal(await saveActiveSyncCalendarEvent(calendar.id, resourceName, created, null), 'changed');
  assert.equal(database.events.size, 1);
  assert.equal(database.events.get(resourceName).uid, logicalUid);

  const firstRead = await fetch(eventUrl(server, resourceName), { headers: { Authorization: auth } });
  assert.equal(firstRead.status, 200);
  assert.equal(await firstRead.text(), created);

  assert.equal(await saveActiveSyncCalendarEvent(calendar.id, resourceName, changed, created), 'changed');
  assert.equal(database.events.size, 1);
  assert.equal(database.events.get(resourceName).uid, logicalUid);
  assert.equal(database.events.get(resourceName).ical_data, changed);
  assert.equal(pimWireServerId(`cal-${calendar.id}`, resourceName), serverId);

  const secondRead = await fetch(eventUrl(server, resourceName), { headers: { Authorization: auth } });
  assert.equal(secondRead.status, 200);
  assert.equal(await secondRead.text(), changed);

  assert.equal(
    await saveActiveSyncCalendarEvent(calendar.id, 'second-resource', ical(logicalUid, 'Duplicate'), null),
    'conflict',
  );
  assert.equal(database.events.size, 1);
});

test('CalDAV OPTIONS advertises only methods implemented by the router', async (t) => {
  resetDatabase();
  const server = await startServer(t);
  const response = await fetch(collectionUrl(server), {
    method: 'OPTIONS',
    headers: { Authorization: auth },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(
    response.headers.get('allow').split(',').map(value => value.trim()).sort(),
    ['DELETE', 'GET', 'HEAD', 'MKCALENDAR', 'MKCOL', 'OPTIONS', 'PROPFIND', 'PROPPATCH', 'PUT', 'REPORT'].sort(),
  );
  assert.deepEqual(
    response.headers.get('dav').split(',').map(value => value.trim()),
    ['1', 'calendar-access', 'extended-mkcol'],
  );
});

test('CalDAV PROPFIND escapes user-controlled calendar names and opaque event hrefs', async (t) => {
  resetDatabase();
  calendar.name = 'Planning & Delivery';
  database.events.set('propfind&uid', eventRow('propfind&uid', ical('propfind&uid', 'Discovery'), 1));
  const server = await startServer(t);

  const response = await fetch(collectionUrl(server), {
    method: 'PROPFIND',
    headers: { Authorization: auth, Depth: '1' },
  });
  assert.equal(response.status, 207);
  const parsed = await xml2js.parseStringPromise(await response.text(), { explicitArray: false });
  const responses = Array.isArray(parsed['D:multistatus']['D:response'])
    ? parsed['D:multistatus']['D:response']
    : [parsed['D:multistatus']['D:response']];
  assert.equal(
    responses.find(item => item['D:propstat']?.['D:prop']?.['D:displayname'])['D:propstat']['D:prop']['D:displayname'],
    'Planning & Delivery',
  );
  assert.ok(responses.some(item => /\/propfind%26uid\.ics$/.test(item['D:href'])));
});

test('CalDAV principal discovery follows the percent-encoded calendar home it advertises', async (t) => {
  resetDatabase();
  const server = await startServer(t);
  const origin = `http://127.0.0.1:${server.address().port}`;
  const principal = await fetch(`${origin}/caldav/principals/${encodeURIComponent(user)}/`, {
    method: 'PROPFIND',
    headers: { Authorization: auth, Depth: '0' },
  });
  assert.equal(principal.status, 207);
  const principalXml = await principal.text();
  const homeHref = principalXml.match(/<C:calendar-home-set><D:href>([^<]+)<\/D:href>/)?.[1];
  assert.equal(homeHref, `/caldav/calendars/${encodeURIComponent(user)}/`);

  const home = await fetch(`${origin}${homeHref}`, {
    method: 'PROPFIND',
    headers: { Authorization: auth, Depth: '1' },
  });
  assert.equal(home.status, 207);
  const homeXml = await home.text();
  await xml2js.parseStringPromise(homeXml, { explicitArray: false });
  assert.match(homeXml, /<D:displayname>macOS Interop<\/D:displayname>/);
  assert.match(homeXml, new RegExp(`/${calendar.id}/`));
});

test('malformed percent-encoded calendar tokens return a clean 404 instead of a server error', async (t) => {
  resetDatabase();
  const server = await startServer(t);
  const url = `http://127.0.0.1:${server.address().port}/caldav/calendars/${encodeURIComponent(user)}/bad%E0%A4%A/`;
  const response = await fetch(url, {
    method: 'PROPFIND',
    headers: { Authorization: auth, Depth: '1' },
  });
  assert.equal(response.status, 404);
});

test('CalDAV rejects malformed or ambiguous resources before changing collection state', async (t) => {
  resetDatabase();
  const server = await startServer(t);
  assert.equal((await putEvent(server, 'valid-event', 'Original', { 'If-None-Match': '*' })).status, 201);
  const beforeRevision = calendar.sync_token;
  const before = cloneDatabase(database);
  const invalidBodies = [
    'not an iCalendar document',
    'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:valid-event\r\nEND:VCALENDAR',
    'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nSUMMARY:missing uid\r\nEND:VEVENT\r\nEND:VCALENDAR',
    [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT', 'UID:valid-event', 'END:VEVENT',
      'BEGIN:VEVENT', 'UID:different-event', 'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n'),
  ];

  for (const body of invalidBodies) {
    const response = await fetch(eventUrl(server, 'valid-event'), {
      method: 'PUT',
      headers: { Authorization: auth, 'Content-Type': 'text/calendar' },
      body,
    });
    assert.equal(response.status, 403);
    assert.match(await response.text(), /valid-calendar-object-resource/);
    assert.equal(calendar.sync_token, beforeRevision);
    assert.deepEqual(database, before);
  }

  const opaqueHref = await fetch(eventUrl(server, 'href-identity'), {
    method: 'PUT',
    headers: { Authorization: auth, 'Content-Type': 'text/calendar', 'If-None-Match': '*' },
    body: ical('body-identity', 'Mismatch'),
  });
  assert.equal(opaqueHref.status, 201);
  assert.equal(database.events.get('href-identity').uid, 'body-identity');
  assert.equal(database.events.get('href-identity').resource_name, 'href-identity');
  assert.equal(database.events.get('href-identity').ical_data, ical('body-identity', 'Mismatch'));

  const sameHrefUpdate = await fetch(eventUrl(server, 'href-identity'), {
    method: 'PUT',
    headers: { Authorization: auth, 'Content-Type': 'text/calendar' },
    body: ical('body-identity', 'Same href update'),
  });
  assert.equal(sameHrefUpdate.status, 204);
  assert.match(database.events.get('href-identity').ical_data, /SUMMARY:Same href update/);

  const duplicateLogicalUid = await fetch(eventUrl(server, 'second-href'), {
    method: 'PUT',
    headers: { Authorization: auth, 'Content-Type': 'text/calendar', 'If-None-Match': '*' },
    body: ical('body-identity', 'Conflicting href'),
  });
  assert.equal(duplicateLogicalUid.status, 403);
  assert.match(await duplicateLogicalUid.text(), /no-uid-conflict/);
  assert.equal(database.events.has('second-href'), false);
});

test('CalDAV rejects ambiguous or oversized opaque href stems before opening a write transaction', async (t) => {
  resetDatabase();
  const server = await startServer(t);
  const before = cloneDatabase(database);
  const beforeRevision = calendar.sync_token;
  for (const resourceName of ['', 'trailing-space ', 'control\u0001name', 'x'.repeat(256)]) {
    const url = resourceName
      ? eventUrl(server, resourceName)
      : `${collectionUrl(server)}.ics`;
    const response = await fetch(url, {
      method: 'PUT',
      headers: { Authorization: auth, 'Content-Type': 'text/calendar' },
      body: ical('safe-logical-uid', 'Rejected href'),
    });
    assert.equal(response.status, 400);
  }
  assert.equal(calendar.sync_token, beforeRevision);
  assert.deepEqual(database, before);
});

test('concurrent PUTs cannot create one logical iCalendar UID at two opaque hrefs', async (t) => {
  resetDatabase();
  const server = await startServer(t);
  const write = (resourceName) => fetch(eventUrl(server, resourceName), {
    method: 'PUT',
    headers: { Authorization: auth, 'Content-Type': 'text/calendar', 'If-None-Match': '*' },
    body: ical('one-logical-uid', resourceName),
  });
  const responses = await Promise.all([write('first-resource'), write('second-resource')]);
  assert.deepEqual(responses.map(response => response.status).sort(), [201, 403]);
  assert.equal(database.events.size, 1);
  assert.equal([...database.events.values()][0].uid, 'one-logical-uid');
  assert.match(await responses.find(response => response.status === 403).text(), /no-uid-conflict/);
});

test('CalDAV exposes Birthdays read-only and reserves its managed collection identity', async (t) => {
  resetDatabase();
  calendar.name = 'Birthdays';
  calendar.dav_slug = 'birthdays';
  const managedUid = 'managed-birthday';
  database.events.set(managedUid, eventRow(managedUid, ical(managedUid, 'Managed'), 1));
  const before = cloneDatabase(database);
  const beforeRevision = calendar.sync_token;
  const server = await startServer(t);

  assert.equal((await putEvent(server, managedUid, 'Changed')).status, 403);
  assert.equal((await deleteEvent(server, managedUid)).status, 403);
  assert.equal((await deleteCollection(server)).status, 403);
  const managedProppatch = await fetch(collectionUrl(server), {
    method: 'PROPPATCH',
    headers: { Authorization: auth, 'Content-Type': 'application/xml' },
    body: '<D:propertyupdate xmlns:D="DAV:"><D:set><D:prop><D:displayname>Mutable</D:displayname></D:prop></D:set></D:propertyupdate>',
  });
  assert.equal(managedProppatch.status, 403);

  const origin = `http://127.0.0.1:${server.address().port}`;
  const reservedCreate = await fetch(`${origin}/caldav/calendars/${encodeURIComponent(user)}/birthdays/`, {
    method: 'MKCALENDAR',
    headers: { Authorization: auth, 'Content-Type': 'application/xml' },
    body: '<C:mkcalendar xmlns:C="urn:ietf:params:xml:ns:caldav"/>',
  });
  assert.equal(reservedCreate.status, 403);
  assert.equal(calendar.sync_token, beforeRevision);
  assert.deepEqual(database, before);

  const readable = await fetch(eventUrl(server, managedUid), { headers: { Authorization: auth } });
  assert.equal(readable.status, 200);
  assert.equal(await readable.text(), ical(managedUid, 'Managed'));
});

test('subscribed calendars are readable but reject CalDAV event writes and deletes', async (t) => {
  resetDatabase();
  calendar.subscribed_url = 'https://calendar.example.test/feed.ics';
  database.events.set('feed-resource', eventRow('feed-resource', ical('feed-logical-uid', 'Feed event'), 1));
  const before = cloneDatabase(database);
  const beforeRevision = calendar.sync_token;
  const server = await startServer(t);

  const readable = await fetch(eventUrl(server, 'feed-resource'), { headers: { Authorization: auth } });
  assert.equal(readable.status, 200);
  assert.match(await readable.text(), /UID:feed-logical-uid/);
  assert.equal((await fetch(eventUrl(server, 'new-feed-resource'), {
    method: 'PUT',
    headers: { Authorization: auth, 'Content-Type': 'text/calendar' },
    body: ical('new-feed-event', 'Must remain read-only'),
  })).status, 403);
  assert.equal((await deleteEvent(server, 'feed-resource')).status, 403);
  assert.equal(calendar.sync_token, beforeRevision);
  assert.deepEqual(database, before);
});

test('shared calendars use recipient-scoped numeric hrefs with read and write ACL enforcement', async (t) => {
  resetDatabase();
  database.events.set('shared-existing', eventRow('shared-existing', ical('shared-logical', 'Shared'), 1));
  const server = await startServer(t);
  const origin = `http://127.0.0.1:${server.address().port}`;

  const reader = 'reader@example.test';
  const readerHome = await fetch(`${origin}/caldav/calendars/${encodeURIComponent(reader)}/`, {
    method: 'PROPFIND',
    headers: { Authorization: authFor(reader), Depth: '1' },
  });
  assert.equal(readerHome.status, 207);
  assert.match(await readerHome.text(), new RegExp(`/caldav/calendars/${encodeURIComponent(reader)}/${calendar.id}/`));
  const readerGet = await fetch(numericEventUrl(server, reader, 'shared-existing'), {
    headers: { Authorization: authFor(reader) },
  });
  assert.equal(readerGet.status, 200);
  const readerPut = await fetch(numericEventUrl(server, reader, 'reader-write'), {
    method: 'PUT',
    headers: { Authorization: authFor(reader), 'Content-Type': 'text/calendar' },
    body: ical('reader-write', 'Denied'),
  });
  assert.equal(readerPut.status, 403);
  assert.equal((await fetch(numericEventUrl(server, reader, 'shared-existing'), {
    method: 'DELETE', headers: { Authorization: authFor(reader) },
  })).status, 403);

  const writer = 'shared@example.test';
  const writerPut = await fetch(numericEventUrl(server, writer, 'writer-resource'), {
    method: 'PUT',
    headers: { Authorization: authFor(writer), 'Content-Type': 'text/calendar', 'If-None-Match': '*' },
    body: ical('writer-logical-uid', 'Allowed'),
  });
  assert.equal(writerPut.status, 201);
  assert.equal(database.events.get('writer-resource').uid, 'writer-logical-uid');
  const writerReport = await fetch(numericCollectionUrl(server, writer), {
    method: 'REPORT',
    headers: { Authorization: authFor(writer), 'Content-Type': 'application/xml' },
    body: '<C:calendar-query xmlns:C="urn:ietf:params:xml:ns:caldav"/>',
  });
  assert.equal(writerReport.status, 207);
  assert.match(await writerReport.text(), /writer-resource\.ics/);
});

test('sync-collection returns every change since the requested collection revision', async (t) => {
  resetDatabase();
  const server = await startServer(t);

  assert.equal((await putEvent(server, 'event-a', 'A original', { 'If-None-Match': '*' })).status, 201);
  assert.equal((await putEvent(server, 'event-b', 'B original', { 'If-None-Match': '*' })).status, 201);
  const requestedRevision = calendar.sync_token;

  assert.equal((await putEvent(server, 'event-a', 'A changed')).status, 204);
  assert.equal((await deleteEvent(server, 'event-b')).status, 204);

  const report = await syncReport(server, requestedRevision);
  assert.equal(report.status, 207);
  const xml = await report.text();
  assert.deepEqual(hrefResponseStatuses(xml, 'event-a'), ['200']);
  assert.deepEqual(hrefResponseStatuses(xml, 'event-b'), ['404']);
  assert.match(xml, new RegExp(`<D:sync-token>${syncTokenFor(calendar, calendar.sync_token).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}</D:sync-token>`));
});

test('CalDAV REPORT quarantines stored calendar text that would poison its XML response', async (t) => {
  resetDatabase();
  const server = await startServer(t);
  const poison = '\u{1ffff}';
  const poisonedIcal = ical('poisoned-resource', `unsafe${poison}summary`);
  database.events.set('poisoned-resource', eventRow('poisoned-resource', poisonedIcal, 2));
  calendar.sync_token = 2;

  const response = await fetch(collectionUrl(server), {
    method: 'REPORT',
    headers: { Authorization: auth, 'Content-Type': 'application/xml' },
    body: '<C:calendar-query xmlns:C="urn:ietf:params:xml:ns:caldav"/>',
  });
  const body = await response.text();

  assert.equal(response.status, 207);
  assert.doesNotMatch(body, new RegExp(poison, 'u'));
  assert.match(body, /poisoned-resource\.ics/);
  assert.match(body, /HTTP\/1\.1 500 Internal Server Error/);
  assert.doesNotMatch(body, /<D:sync-token>/);
  await xml2js.parseStringPromise(body);
});

test('sync-collection safely encodes opaque hrefs and preserves CDATA terminators', async (t) => {
  resetDatabase();
  const uid = 'uid&special';
  const body = ical(uid, 'XML-safe report').replace(
    'SUMMARY:XML-safe report',
    'SUMMARY:XML-safe report\r\nDESCRIPTION:before]]>after & intact',
  );
  calendar.sync_token = 2;
  database.events.set(uid, eventRow(uid, body, 2));
  const server = await startServer(t);

  const report = await syncReport(server, 1);
  assert.equal(report.status, 207);
  const xml = await report.text();
  const parsed = await xml2js.parseStringPromise(xml, { explicitArray: false });
  const response = parsed['D:multistatus']['D:response'];
  assert.match(response['D:href'], /\/uid%26special\.ics$/);
  assert.equal(response['D:propstat']['D:prop']['C:calendar-data'], body);

  const fetched = await fetch(new URL(response['D:href'], collectionUrl(server)), {
    headers: { Authorization: auth },
  });
  assert.equal(fetched.status, 200);
  assert.equal(await fetched.text(), body);
});

test('case-distinct opaque UIDs remain separate resources through write, read, and sync', async (t) => {
  resetDatabase();
  const server = await startServer(t);
  const requestedRevision = calendar.sync_token;

  assert.equal((await putEvent(server, 'Case-Sensitive-UID', 'Upper', { 'If-None-Match': '*' })).status, 201);
  assert.equal((await putEvent(server, 'case-sensitive-uid', 'Lower', { 'If-None-Match': '*' })).status, 201);
  assert.equal(database.events.size, 2);
  assert.deepEqual([...database.events.keys()].sort(), ['Case-Sensitive-UID', 'case-sensitive-uid'].sort());

  const upper = await fetch(eventUrl(server, 'Case-Sensitive-UID'), { headers: { Authorization: auth } });
  const lower = await fetch(eventUrl(server, 'case-sensitive-uid'), { headers: { Authorization: auth } });
  assert.match(await upper.text(), /SUMMARY:Upper/);
  assert.match(await lower.text(), /SUMMARY:Lower/);

  const report = await syncReport(server, requestedRevision);
  const xml = await report.text();
  assert.deepEqual(hrefResponseStatuses(xml, 'Case-Sensitive-UID'), ['200']);
  assert.deepEqual(hrefResponseStatuses(xml, 'case-sensitive-uid'), ['200']);
});

test('delete then recreate yields exactly one live sync response for the href', async (t) => {
  resetDatabase();
  const server = await startServer(t);
  assert.equal((await putEvent(server, 'recreated-event', 'Before', { 'If-None-Match': '*' })).status, 201);
  const requestedRevision = calendar.sync_token;

  assert.equal((await deleteEvent(server, 'recreated-event')).status, 204);
  assert.equal((await putEvent(server, 'recreated-event', 'After', { 'If-None-Match': '*' })).status, 201);

  const report = await syncReport(server, requestedRevision);
  assert.equal(report.status, 207);
  assert.deepEqual(hrefResponseStatuses(await report.text(), 'recreated-event'), ['200']);
});

test('concurrent conditional edits serialize so only one stale ETag can win', async (t) => {
  resetDatabase();
  const server = await startServer(t);
  const created = await putEvent(server, 'etag-race', 'Original', { 'If-None-Match': '*' });
  assert.equal(created.status, 201);
  const etag = created.headers.get('etag');
  assert.ok(etag);

  let waitingReaders = 0;
  let releaseReaders;
  const bothReadersReady = new Promise(resolve => { releaseReaders = resolve; });
  concurrentPoolReadBarrier = async () => {
    waitingReaders += 1;
    if (waitingReaders === 2) releaseReaders();
    await bothReadersReady;
  };

  const results = await Promise.all([
    putEvent(server, 'etag-race', 'First contender', { 'If-Match': etag }),
    putEvent(server, 'etag-race', 'Second contender', { 'If-Match': etag }),
  ]);
  concurrentPoolReadBarrier = null;
  assert.deepEqual(results.map(result => result.status).sort(), [204, 412]);
});

test('failed PUT and DELETE roll back resource, tombstone, and collection revision together', async (t) => {
  resetDatabase();
  const server = await startServer(t);
  const initialRevision = calendar.sync_token;

  failNextStatementContaining = 'UPDATE calendars SET sync_token';
  assert.equal((await putEvent(server, 'failed-create', 'Must roll back')).status, 500);
  assert.equal((await fetch(eventUrl(server, 'failed-create'), { headers: { Authorization: auth } })).status, 404);
  assert.equal(calendar.sync_token, initialRevision);

  const created = await putEvent(server, 'failed-delete', 'Must survive', { 'If-None-Match': '*' });
  assert.equal(created.status, 201);
  const beforeDeleteRevision = calendar.sync_token;
  failNextStatementContaining = 'DELETE FROM events';
  assert.equal((await deleteEvent(server, 'failed-delete')).status, 500);
  assert.equal((await fetch(eventUrl(server, 'failed-delete'), { headers: { Authorization: auth } })).status, 200);
  assert.equal(calendar.sync_token, beforeDeleteRevision);

  const report = await syncReport(server, beforeDeleteRevision);
  assert.deepEqual(hrefResponseStatuses(await report.text(), 'failed-delete'), []);
});

test('conditional DELETE rejects a stale ETag and preserves the resource', async (t) => {
  resetDatabase();
  const server = await startServer(t);
  const created = await putEvent(server, 'delete-precondition', 'Original', { 'If-None-Match': '*' });
  assert.equal(created.status, 201);

  const rejected = await deleteEvent(server, 'delete-precondition', { 'If-Match': '"stale"' });
  assert.equal(rejected.status, 412);
  assert.equal((await fetch(eventUrl(server, 'delete-precondition'), { headers: { Authorization: auth } })).status, 200);
});

test('If-None-Match uses weak comparison and rejects a matching weak ETag', async (t) => {
  resetDatabase();
  const server = await startServer(t);
  const created = await putEvent(server, 'weak-none-match', 'Original', { 'If-None-Match': '*' });
  assert.equal(created.status, 201);
  const etag = created.headers.get('etag');
  assert.ok(etag);

  const rejected = await putEvent(server, 'weak-none-match', 'Must not replace', {
    'If-None-Match': `W/${etag}`,
  });
  assert.equal(rejected.status, 412);
  const preserved = await fetch(eventUrl(server, 'weak-none-match'), { headers: { Authorization: auth } });
  assert.match(await preserved.text(), /SUMMARY:Original/);
});

test('an identical PUT is a no-op for the collection revision', async (t) => {
  resetDatabase();
  const server = await startServer(t);
  assert.equal((await putEvent(server, 'no-op-event', 'Unchanged', { 'If-None-Match': '*' })).status, 201);
  const beforeNoop = calendar.sync_token;

  assert.equal((await putEvent(server, 'no-op-event', 'Unchanged')).status, 204);
  assert.equal(calendar.sync_token, beforeNoop);
});

test('sync-collection rejects malformed and future collection tokens', async (t) => {
  resetDatabase();
  const server = await startServer(t);

  for (const invalidToken of ['not-a-revision', calendar.sync_token + 1]) {
    const report = await syncReport(server, invalidToken);
    assert.equal(report.status, 403);
    assert.match(await report.text(), /<D:valid-sync-token\s*\/>/);
  }
});

test('sync-collection tokens are bound to the exact calendar identity and version epoch', async (t) => {
  resetDatabase();
  const server = await startServer(t);
  const revision = calendar.sync_token;

  const accepted = await syncReport(server, revision);
  assert.equal(accepted.status, 207);

  const otherCalendar = {
    ...calendar,
    id: calendar.id + 1,
  };
  const invalidTokens = [
    syncTokenFor(otherCalendar, revision),
    `http://sabre.io/ns/sync/calendar/v1/${calendar.id}/${revision}`,
    `https://foreign.example.test/sync/${revision}`,
    `http://sabre.io/ns/sync/${revision}`,
    `${syncTokenFor(calendar, revision)}/999`,
    String(revision),
  ];
  for (const token of invalidTokens) {
    const rejected = await syncReport(server, revision, token);
    assert.equal(rejected.status, 403, token);
    assert.match(await rejected.text(), /<D:valid-sync-token\s*\/>/);
  }
});

test('collection DELETE rolls back child cleanup on failure and removes all owned state on success', async (t) => {
  resetDatabase();
  const server = await startServer(t);
  assert.equal((await putEvent(server, 'collection-child', 'Retained on rollback', { 'If-None-Match': '*' })).status, 201);
  database.tombstones.set('old-delete', {
    uid: 'old-delete', sync_token: 1, deleted_at: new Date(Date.UTC(2026, 6, 20, 11)),
  });

  failNextStatementContaining = 'DELETE FROM calendars';
  assert.equal((await deleteCollection(server)).status, 500);
  assert.equal((await fetch(eventUrl(server, 'collection-child'), { headers: { Authorization: auth } })).status, 200);
  assert.equal(database.tombstones.has('old-delete'), true);
  assert.equal(database.shares.size, 2);

  assert.equal((await deleteCollection(server)).status, 204);
  assert.equal(database.calendarExists, false);
  assert.equal(database.events.size, 0);
  assert.equal(database.tombstones.size, 0);
  assert.equal(database.shares.size, 0);
});
