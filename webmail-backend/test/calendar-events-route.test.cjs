const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');

process.env.OMS_DB_PASSWORD ||= 'calendar-events-route-test';

const user = 'calendar-route@example.test';
const calendarId = 7;
const storedEvents = new Map();
const eventRevisions = new Map();
const resourceNames = new Map();
const eventUpdatedAt = new Map();
const tombstones = new Map();
let calendarRevision = 1;
let permissionGranted = true;
let failNextStatementContaining = null;
let rejectPoolPermissionQueries = false;
let managedCalendar = false;
let subscribedCalendar = false;
let connectionCount = 0;

function resetState() {
  storedEvents.clear();
  eventRevisions.clear();
  resourceNames.clear();
  eventUpdatedAt.clear();
  tombstones.clear();
  calendarRevision = 1;
  permissionGranted = true;
  failNextStatementContaining = null;
  rejectPoolPermissionQueries = false;
  managedCalendar = false;
  subscribedCalendar = false;
  connectionCount = 0;
}

function cloneState() {
  return {
    events: new Map(storedEvents),
    revisions: new Map(eventRevisions),
    resourceNames: new Map(resourceNames),
    eventUpdatedAt: new Map(eventUpdatedAt),
    tombstones: new Map([...tombstones].map(([uid, value]) => [uid, { ...value }])),
    calendarRevision,
  };
}

function applyState(state) {
  storedEvents.clear();
  eventRevisions.clear();
  resourceNames.clear();
  eventUpdatedAt.clear();
  tombstones.clear();
  for (const [uid, value] of state.events) storedEvents.set(uid, value);
  for (const [uid, value] of state.revisions) eventRevisions.set(uid, value);
  for (const [uid, value] of state.resourceNames) resourceNames.set(uid, value);
  for (const [uid, value] of state.eventUpdatedAt) eventUpdatedAt.set(uid, value);
  for (const [uid, value] of state.tombstones) tombstones.set(uid, value);
  calendarRevision = state.calendarRevision;
}

async function queryState(state, sql, params = []) {
  const compact = String(sql).replace(/\s+/g, ' ').trim();
  if (compact.startsWith('SELECT c.id')) {
    return [permissionGranted ? [{
      id: calendarId,
      dav_slug: managedCalendar ? 'birthdays' : 'personal',
      subscribed_url: subscribedCalendar ? 'https://calendar.example.test/feed.ics' : null,
    }] : [], []];
  }
  if (compact.startsWith('SELECT id, dav_slug, subscribed_url FROM calendars WHERE id = ? AND user_id = ?')) {
    return [permissionGranted ? [{
      id: calendarId,
      dav_slug: managedCalendar ? 'birthdays' : 'personal',
      subscribed_url: subscribedCalendar ? 'https://calendar.example.test/feed.ics' : null,
    }] : [], []];
  }
  if (compact.startsWith('SELECT ical_data, updated_at FROM events WHERE calendar_id = ? ORDER BY uid ASC')) {
    return [[...state.events.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([uid, ical_data]) => ({
        ical_data,
        updated_at: state.eventUpdatedAt.get(uid) || null,
      })), []];
  }
  if (compact.startsWith('SELECT uid') || compact.startsWith('SELECT ical_data FROM events')) {
    const uid = params[1];
    return [state.events.has(uid) ? [{
      uid,
      resource_name: state.resourceNames.get(uid) || uid,
      ical_data: state.events.get(uid),
      sync_token: state.revisions.get(uid),
    }] : [], []];
  }
  if (compact.startsWith('INSERT INTO events')) {
    const carriesResourceName = compact.includes('resource_name');
    state.resourceNames.set(params[1], carriesResourceName ? params[2] : params[1]);
    state.events.set(params[1], params[carriesResourceName ? 3 : 2]);
    state.eventUpdatedAt.set(params[1], new Date('2026-08-15T12:00:00Z'));
    state.revisions.set(params[1], Number(params[carriesResourceName ? 4 : 3] ?? 1));
    return [{ affectedRows: 1 }, []];
  }
  if (compact.startsWith('UPDATE events SET ical_data')) {
    const uid = params[3] ?? params[2];
    if (!state.events.has(uid)) return [{ affectedRows: 0 }, []];
    state.events.set(uid, params[0]);
    state.eventUpdatedAt.set(uid, new Date('2026-08-15T12:00:00Z'));
    state.revisions.set(uid, Number(params[1]));
    return [{ affectedRows: 1 }, []];
  }
  if (compact.startsWith('DELETE FROM calendar_tombstones')) {
    return [{ affectedRows: state.tombstones.delete(params[1]) ? 1 : 0 }, []];
  }
  if (compact.startsWith('INSERT INTO calendar_tombstones')) {
    const carriesResourceName = compact.includes('resource_name');
    const resourceName = carriesResourceName ? params[2] : params[1];
    state.tombstones.set(resourceName, {
      calendarId: params[0],
      uid: params[1],
      resourceName,
      sync_token: Number(params[carriesResourceName ? 3 : 2] ?? state.calendarRevision + 1),
    });
    return [{ affectedRows: 1 }, []];
  }
  if (compact.startsWith('DELETE FROM events WHERE calendar_id')) {
    const deleted = state.events.delete(params[1]);
    state.revisions.delete(params[1]);
    state.resourceNames.delete(params[1]);
    state.eventUpdatedAt.delete(params[1]);
    return [{ affectedRows: deleted ? 1 : 0 }, []];
  }
  throw new Error(`Unexpected calendar event route query: ${compact}`);
}

const db = require('../src/db.js');
db.pool.query = async (sql, params = []) => {
  const compact = String(sql).replace(/\s+/g, ' ').trim();
  if (rejectPoolPermissionQueries && compact.startsWith('SELECT c.id')) {
    throw new Error('Permission check escaped the calendar transaction');
  }
  if (failNextStatementContaining && compact.includes(failNextStatementContaining)) {
    failNextStatementContaining = null;
    throw new Error('Injected web calendar mutation failure');
  }
  if (compact.startsWith('SELECT * FROM calendars WHERE id = ? AND user_id = ?')) {
    return [permissionGranted ? [{ id: calendarId, user_id: user }] : [], []];
  }
  if (compact.startsWith('UPDATE calendars SET sync_token')) {
    calendarRevision += 1;
    return [{ affectedRows: 1 }, []];
  }
  const state = {
    events: storedEvents,
    revisions: eventRevisions,
    resourceNames,
    eventUpdatedAt,
    tombstones,
    calendarRevision,
  };
  return queryState(state, compact, params);
};
db.pool.getConnection = async () => {
  connectionCount += 1;
  let working = null;
  return {
    beginTransaction: async () => { working = cloneState(); },
    commit: async () => { applyState(working); working = null; },
    rollback: async () => { working = null; },
    release: () => {},
    query: async (sql, params = []) => {
      const compact = String(sql).replace(/\s+/g, ' ').trim();
      if (!working) throw new Error('Web calendar mutation query escaped its transaction');
      if (failNextStatementContaining && compact.includes(failNextStatementContaining)) {
        failNextStatementContaining = null;
        throw new Error('Injected web calendar mutation failure');
      }
      if (compact === 'SELECT sync_token FROM calendars WHERE id = ? LIMIT 1 FOR UPDATE') {
        return [[{ sync_token: working.calendarRevision }], []];
      }
      if (compact === 'UPDATE calendars SET sync_token = ? WHERE id = ? AND sync_token = ?') {
        if (Number(params[2]) !== working.calendarRevision) return [{ affectedRows: 0 }, []];
        working.calendarRevision = Number(params[0]);
        return [{ affectedRows: 1 }, []];
      }
      return queryState(working, compact, params);
    },
  };
};

resetState();

const authPath = require.resolve('../src/auth.js');
const auth = require(authPath);
require.cache[authPath].exports = {
  ...auth,
  requireSession: (req, _res, next) => {
    req.user = { username: user, password: 'test-only', isAdmin: false };
    next();
  },
};

const indexPath = require.resolve('../src/index.js');
require.cache[indexPath] = {
  id: indexPath,
  filename: indexPath,
  loaded: true,
  exports: { io: { to: () => ({ emit: () => {} }) } },
  children: [],
  paths: [],
};

const { appsApiRouter } = require('../src/apps-api.js');
const { validateICalendarDocument } = require('../src/calendar-ical-validation.js');

function postEvent(port, icalData) {
  const raw = JSON.stringify({ calendar_id: calendarId, data: icalData });
  return new Promise((resolve, reject) => {
    const request = http.request({
      hostname: '127.0.0.1',
      port,
      path: '/api/apps/events',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(raw),
      },
    }, response => {
      response.resume();
      response.on('end', () => resolve(response.statusCode));
    });
    request.on('error', reject);
    request.end(raw);
  });
}

function deleteEvent(port, uid, exclude) {
  return new Promise((resolve, reject) => {
    const query = exclude === undefined ? '' : `?exclude=${encodeURIComponent(exclude)}`;
    const request = http.request({
      hostname: '127.0.0.1',
      port,
      path: `/api/apps/events/${calendarId}/${encodeURIComponent(uid)}${query}`,
      method: 'DELETE',
    }, response => {
      response.resume();
      response.on('end', () => resolve(response.statusCode));
    });
    request.on('error', reject);
    request.end();
  });
}

function importEvents(port, icsData) {
  const raw = JSON.stringify({ ics_data: icsData });
  return new Promise((resolve, reject) => {
    const request = http.request({
      hostname: '127.0.0.1',
      port,
      path: `/api/apps/calendars/${calendarId}/import`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(raw),
      },
    }, response => {
      response.resume();
      response.on('end', () => resolve(response.statusCode));
    });
    request.on('error', reject);
    request.end(raw);
  });
}

function exportEvents(port) {
  return new Promise((resolve, reject) => {
    const request = http.request({
      hostname: '127.0.0.1',
      port,
      path: `/api/apps/calendars/${calendarId}/export`,
      method: 'GET',
    }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, body }));
    });
    request.on('error', reject);
    request.end();
  });
}

function eventDocument(uid, title = 'Event') {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//OpenMailStack//Calendar Route Test//EN',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    'DTSTAMP:20260815T120000Z',
    'DTSTART:20260816T120000Z',
    `SUMMARY:${title}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
}

test('editing an event upserts the exact submitted UID instead of inserting a copy', async (t) => {
  resetState();
  const app = express();
  app.use(express.json());
  app.use('/api/apps', appsApiRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const port = server.address().port;
  const uid = 'opaque event uid';
  const event = title => [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//OpenMailStack//Calendar Route Test//EN',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    'DTSTAMP:20260815T120000Z',
    'DTSTART:20260724T170000Z',
    'DTEND:20260724T180000Z',
    `SUMMARY:${title}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');

  assert.equal(await postEvent(port, event('Original')), 200);
  assert.equal(await postEvent(port, event('Edited')), 200);
  assert.equal(storedEvents.size, 1);
  assert.equal(storedEvents.get(uid), event('Edited'));
});

test('deleting an event records the tombstone required by sync clients', async (t) => {
  resetState();
  const app = express();
  app.use(express.json());
  app.use('/api/apps', appsApiRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const uid = 'calendar-delete-regression@example.test';
  storedEvents.set(uid, 'event payload');

  assert.equal(await deleteEvent(server.address().port, uid), 200);
  assert.equal(storedEvents.has(uid), false);
  assert.deepEqual(tombstones.get(uid), {
    calendarId: String(calendarId), uid, resourceName: uid, sync_token: 2,
  });
});

test('web delete preserves a CalDAV-created opaque resource name in the tombstone', async (t) => {
  resetState();
  const app = express();
  app.use(express.json());
  app.use('/api/apps', appsApiRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const uid = 'logical-event-uid';
  storedEvents.set(uid, eventDocument(uid));
  eventRevisions.set(uid, 1);
  resourceNames.set(uid, 'opaque-caldav-resource.ics');

  assert.equal(await deleteEvent(server.address().port, uid), 200);
  assert.deepEqual(tombstones.get('opaque-caldav-resource.ics'), {
    calendarId: String(calendarId),
    uid,
    resourceName: 'opaque-caldav-resource.ics',
    sync_token: 2,
  });
});

test('web save clears only the matching DAV href tombstone for a shared logical UID', async (t) => {
  resetState();
  const app = express();
  app.use(express.json());
  app.use('/api/apps', appsApiRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const uid = 'shared-logical-uid';
  const event = eventDocument(uid);
  storedEvents.set(uid, event);
  eventRevisions.set(uid, 1);
  resourceNames.set(uid, 'active-resource.ics');
  tombstones.set('active-resource.ics', { uid, resourceName: 'active-resource.ics', sync_token: 1 });
  tombstones.set('older-resource.ics', { uid, resourceName: 'older-resource.ics', sync_token: 1 });

  assert.equal(await postEvent(server.address().port, event), 200);
  assert.equal(tombstones.has('active-resource.ics'), false);
  assert.equal(tombstones.has('older-resource.ics'), true);
});

test('recurring-instance delete structurally adds all-day and TZID EXDATE values without injection', async (t) => {
  resetState();
  const app = express();
  app.use(express.json());
  app.use('/api/apps', appsApiRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const port = server.address().port;

  const allDayUid = 'all-day-series';
  const allDay = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//OpenMailStack//Calendar Route Test//EN',
    'BEGIN:VEVENT', `UID:${allDayUid}`, 'DTSTAMP:20260815T120000Z',
    'DTSTART;VALUE=DATE:20260816', 'DTEND;VALUE=DATE:20260817',
    'RRULE:FREQ=DAILY;COUNT=3', 'SUMMARY:All day', 'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n');
  storedEvents.set(allDayUid, allDay);
  eventRevisions.set(allDayUid, 1);
  resourceNames.set(allDayUid, 'opaque-all-day-resource');
  tombstones.set('opaque-all-day-resource', { uid: allDayUid, resourceName: 'opaque-all-day-resource' });
  tombstones.set('historical-resource', { uid: allDayUid, resourceName: 'historical-resource' });

  assert.equal(await deleteEvent(port, allDayUid, '2026-08-17'), 200);
  assert.match(storedEvents.get(allDayUid), /EXDATE;VALUE=DATE:20260817/);
  assert.doesNotMatch(storedEvents.get(allDayUid), /20260817Z/);
  assert.equal(validateICalendarDocument(storedEvents.get(allDayUid)).canonicalUid, allDayUid);
  assert.equal(tombstones.has('opaque-all-day-resource'), false);
  assert.equal(tombstones.has('historical-resource'), true);
  const allDayRevision = calendarRevision;
  assert.equal(await deleteEvent(port, allDayUid, '2026-08-17'), 200);
  assert.equal(calendarRevision, allDayRevision);

  const beforeInjection = storedEvents.get(allDayUid);
  assert.equal(await deleteEvent(port, allDayUid, '2026-08-18\r\nATTENDEE:mailto:attacker@example.test'), 400);
  assert.equal(storedEvents.get(allDayUid), beforeInjection);

  const zonedUid = 'zoned-series';
  const zoned = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//OpenMailStack//Calendar Route Test//EN',
    'BEGIN:VEVENT', `UID:${zonedUid}`, 'DTSTAMP:20260815T120000Z',
    'DTSTART;TZID=America/Phoenix:20260816T090000', 'DTEND;TZID=America/Phoenix:20260816T100000',
    'RRULE:FREQ=DAILY;COUNT=3', 'EXDATE;TZID=America/Phoenix:20260816T090000',
    'SUMMARY:Zoned', 'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n');
  storedEvents.set(zonedUid, zoned);
  eventRevisions.set(zonedUid, calendarRevision);
  resourceNames.set(zonedUid, 'opaque-zoned-resource');

  assert.equal(await deleteEvent(port, zonedUid, '2026-08-17T16:00:00.000Z'), 200);
  assert.match(storedEvents.get(zonedUid), /EXDATE;TZID=America\/Phoenix:20260817T090000/);
  assert.equal(validateICalendarDocument(storedEvents.get(zonedUid)).canonicalUid, zonedUid);
});

test('an identical web event save does not advance the collection revision', async (t) => {
  resetState();
  const app = express();
  app.use(express.json());
  app.use('/api/apps', appsApiRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const uid = 'no-op-web-event@example.test';
  const event = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//OpenMailStack//Calendar Route Test//EN',
    'BEGIN:VEVENT', `UID:${uid}`, 'DTSTAMP:20260815T120000Z',
    'DTSTART:20260724T170000Z', 'DTEND:20260724T180000Z',
    'SUMMARY:Unchanged', 'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n');

  assert.equal(await postEvent(server.address().port, event), 200);
  const afterCreate = calendarRevision;
  assert.equal(await postEvent(server.address().port, event), 200);
  assert.equal(calendarRevision, afterCreate);
  assert.equal(eventRevisions.get(uid), afterCreate);
});

test('web event mutation failure rolls back the body and collection revision', async (t) => {
  resetState();
  const app = express();
  app.use(express.json());
  app.use('/api/apps', appsApiRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const uid = 'rollback-web-event@example.test';
  const original = eventDocument(uid, 'Original');
  const changed = original.replace('Original', 'Changed');
  assert.equal(await postEvent(server.address().port, original), 200);
  const beforeFailure = calendarRevision;

  failNextStatementContaining = 'UPDATE calendars SET sync_token';
  assert.equal(await postEvent(server.address().port, changed), 500);
  assert.equal(storedEvents.get(uid), original);
  assert.equal(calendarRevision, beforeFailure);

  failNextStatementContaining = 'DELETE FROM events';
  assert.equal(await deleteEvent(server.address().port, uid), 500);
  assert.equal(storedEvents.get(uid), original);
  assert.equal(tombstones.has(uid), false);
  assert.equal(calendarRevision, beforeFailure);
});

test('web event write permission is checked inside the mutation transaction', async (t) => {
  resetState();
  permissionGranted = false;
  rejectPoolPermissionQueries = true;
  const app = express();
  app.use(express.json());
  app.use('/api/apps', appsApiRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const event = eventDocument('forbidden-event');
  assert.equal(await postEvent(server.address().port, event), 403);
  assert.equal(storedEvents.size, 0);
  assert.equal(calendarRevision, 1);
});

test('web event and import routes cannot mutate the managed Birthdays projection', async (t) => {
  resetState();
  managedCalendar = true;
  const uid = 'managed-birthday-event';
  const event = eventDocument(uid);
  storedEvents.set(uid, event);
  eventRevisions.set(uid, 1);
  const before = cloneState();
  const app = express();
  app.use(express.json());
  app.use('/api/apps', appsApiRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const port = server.address().port;
  assert.equal(await postEvent(port, event.replace('END:VEVENT', 'SUMMARY:Changed\r\nEND:VEVENT')), 403);
  assert.equal(await deleteEvent(port, uid), 403);
  assert.equal(await importEvents(port, event), 403);
  assert.deepEqual(cloneState(), before);
});

test('web event, delete, and import routes treat subscribed calendars as read-only', async (t) => {
  resetState();
  subscribedCalendar = true;
  const uid = 'subscribed-read-only';
  const event = eventDocument(uid);
  storedEvents.set(uid, event);
  eventRevisions.set(uid, 1);
  const before = cloneState();
  const app = express();
  app.use(express.json());
  app.use('/api/apps', appsApiRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const port = server.address().port;
  assert.equal(await postEvent(port, event.replace('SUMMARY:Event', 'SUMMARY:Changed')), 403);
  assert.equal(await deleteEvent(port, uid), 403);
  assert.equal(await importEvents(port, event), 403);
  assert.deepEqual(cloneState(), before);
});

test('web create and import validate bounded iCalendar structure before opening a transaction', async (t) => {
  resetState();
  const app = express();
  app.use(express.json());
  app.use('/api/apps', appsApiRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const port = server.address().port;
  assert.equal(await postEvent(port, '<html>not an event</html>'), 400);
  assert.equal(await importEvents(port, 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT'), 400);
  const todo = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//OpenMailStack//Calendar Route Test//EN',
    'BEGIN:VTODO', 'UID:unsupported-task', 'DTSTAMP:20260815T120000Z',
    'END:VTODO', 'END:VCALENDAR',
  ].join('\r\n');
  assert.equal(await importEvents(port, todo), 400);
  assert.equal(connectionCount, 0);
  assert.equal(storedEvents.size, 0);
});

test('calendar import uses one collection revision, clears tombstones, and is idempotent', async (t) => {
  resetState();
  tombstones.set('import-a', { calendarId: String(calendarId), uid: 'import-a', sync_token: 1 });
  const app = express();
  app.use(express.json());
  app.use('/api/apps', appsApiRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const imported = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//OpenMailStack//Calendar Route Test//EN',
    'BEGIN:VEVENT', 'UID:import-a', 'DTSTAMP:20260815T120000Z',
    'DTSTART:20260816T120000Z', 'SUMMARY:A', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:import-b', 'DTSTAMP:20260815T120000Z',
    'DTSTART:20260817T120000Z', 'SUMMARY:B', 'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');

  assert.equal(await importEvents(server.address().port, imported), 200);
  assert.equal(calendarRevision, 2);
  assert.equal(eventRevisions.get('import-a'), 2);
  assert.equal(eventRevisions.get('import-b'), 2);
  assert.equal(tombstones.has('import-a'), false);

  assert.equal(await importEvents(server.address().port, imported), 200);
  assert.equal(calendarRevision, 2);
});

test('calendar import and export round-trip VTIMEZONE plus recurring master and exception intact', async (t) => {
  resetState();
  const app = express();
  app.use(express.json());
  app.use('/api/apps', appsApiRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const recurring = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//OpenMailStack//Calendar Route Test//EN',
    'METHOD:PUBLISH',
    'BEGIN:VTIMEZONE',
    'TZID:America/Phoenix',
    'BEGIN:STANDARD',
    'DTSTART:19700101T000000',
    'TZOFFSETFROM:-0700',
    'TZOFFSETTO:-0700',
    'END:STANDARD',
    'END:VTIMEZONE',
    'BEGIN:VEVENT',
    'UID:recurring-roundtrip',
    'DTSTAMP:20260815T120000Z',
    'DTSTART;TZID=America/Phoenix:20260816T090000',
    'RRULE:FREQ=DAILY;COUNT=2',
    'SUMMARY:Master',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:recurring-roundtrip',
    'DTSTAMP:20260815T120000Z',
    'RECURRENCE-ID;TZID=America/Phoenix:20260817T090000',
    'DTSTART;TZID=America/Phoenix:20260817T100000',
    'SUMMARY:Exception',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');

  const port = server.address().port;
  assert.equal(await importEvents(port, recurring), 200);
  assert.equal(storedEvents.size, 1);
  assert.equal(storedEvents.get('recurring-roundtrip').includes('BEGIN:VTIMEZONE'), true);
  assert.equal(storedEvents.get('recurring-roundtrip').includes('METHOD:'), false);
  assert.equal(storedEvents.get('recurring-roundtrip').split('BEGIN:VEVENT').length - 1, 2);

  const exported = await exportEvents(port);
  assert.equal(exported.status, 200);
  assert.equal(exported.body.includes('BEGIN:VTIMEZONE'), true);
  assert.equal(exported.body.includes('RECURRENCE-ID;TZID=America/Phoenix:20260817T090000'), true);
  assert.equal(exported.body.split('BEGIN:VEVENT').length - 1, 2);
});

test('calendar export safely normalizes legacy recurrence rows missing PRODID and DTSTAMP', async (t) => {
  resetState();
  const app = express();
  app.use(express.json());
  app.use('/api/apps', appsApiRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const legacy = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'BEGIN:VEVENT',
    'UID:legacy-series',
    'DTSTART:20260816T120000Z',
    'RRULE:FREQ=DAILY;COUNT=2',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:legacy-series',
    'RECURRENCE-ID:20260817T120000Z',
    'DTSTART:20260817T130000Z',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
  storedEvents.set('legacy-series', legacy);
  eventRevisions.set('legacy-series', 1);
  resourceNames.set('legacy-series', 'legacy-series.ics');
  eventUpdatedAt.set('legacy-series', '2026-08-15 12:34:56');

  const exported = await exportEvents(server.address().port);

  assert.equal(exported.status, 200);
  assert.match(exported.body, /PRODID:-\/\/OpenMailStack\/\/WebCalendar\/\/EN/);
  assert.equal(exported.body.split('DTSTAMP:20260815T123456Z').length - 1, 2);
  assert.equal(exported.body.split('BEGIN:VEVENT').length - 1, 2);
  const validated = validateICalendarDocument(exported.body);
  assert.equal(validated.resources[0].componentCount, 2);
});
