const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');

process.env.OMS_DB_PASSWORD ||= 'calendar-delete-route-test';

const user = 'calendar-delete@example.test';
const calendarId = 7;
let state;
let failStatement = null;
let managedCalendar = false;
let settingsUpdates = 0;

function resetState() {
  state = {
    calendars: new Set([calendarId, 8]),
    events: new Map([[calendarId, 3]]),
    tombstones: new Map([[calendarId, 2]]),
    shares: new Map([[calendarId, 1]]),
  };
  failStatement = null;
  managedCalendar = false;
  settingsUpdates = 0;
}

function cloneState(source) {
  return {
    calendars: new Set(source.calendars),
    events: new Map(source.events),
    tombstones: new Map(source.tombstones),
    shares: new Map(source.shares),
  };
}

const db = require('../src/db.js');
db.pool.query = async (sql) => {
  const compact = String(sql).replace(/\s+/g, ' ').trim();
  if (compact === 'SELECT id, dav_slug FROM calendars WHERE id = ? AND user_id = ? LIMIT 1') {
    return [state.calendars.has(calendarId)
      ? [{ id: calendarId, dav_slug: managedCalendar ? 'birthdays' : 'disposable' }]
      : [], []];
  }
  if (compact.startsWith('UPDATE calendars SET name = ?')) {
    settingsUpdates += 1;
    return [{ affectedRows: state.calendars.has(calendarId) ? 1 : 0 }, []];
  }
  throw new Error(`Unexpected calendar pool query: ${compact}`);
};
db.pool.getConnection = async () => {
  let working = null;
  return {
    beginTransaction: async () => { working = cloneState(state); },
    commit: async () => { state = working; working = null; },
    rollback: async () => { working = null; },
    release: () => {},
    query: async (sql, params = []) => {
      const compact = String(sql).replace(/\s+/g, ' ').trim();
      if (!working) throw new Error('Calendar delete query escaped its transaction');
      if (failStatement && compact.includes(failStatement)) {
        failStatement = null;
        throw new Error('Injected calendar delete failure');
      }
      if (compact.startsWith('SELECT id, dav_slug, subscribed_url FROM calendars')) {
        return [working.calendars.has(calendarId)
          ? [{
            id: calendarId,
            dav_slug: managedCalendar ? 'birthdays' : 'disposable',
            subscribed_url: null,
          }]
          : [], []];
      }
      if (compact === 'SELECT COUNT(*) AS event_count FROM events WHERE calendar_id = ?') {
        return [[{ event_count: working.events.get(Number(params[0])) || 0 }], []];
      }
      if (compact === 'DELETE FROM events WHERE calendar_id = ?') {
        working.events.delete(Number(params[0]));
        return [{ affectedRows: 1 }, []];
      }
      if (compact === 'DELETE FROM calendar_tombstones WHERE calendar_id = ?') {
        working.tombstones.delete(Number(params[0]));
        return [{ affectedRows: 1 }, []];
      }
      if (compact === 'DELETE FROM calendar_shares WHERE calendar_id = ?') {
        working.shares.delete(Number(params[0]));
        return [{ affectedRows: 1 }, []];
      }
      if (compact === 'DELETE FROM calendars WHERE id = ? AND user_id = ?') {
        const id = Number(params[0]);
        const existed = working.calendars.delete(id);
        return [{ affectedRows: existed ? 1 : 0 }, []];
      }
      throw new Error(`Unexpected calendar delete query: ${compact}`);
    },
  };
};

const authPath = require.resolve('../src/auth.js');
const auth = require(authPath);
require.cache[authPath].exports = {
  ...auth,
  requireSession: (req, _res, next) => {
    req.user = { username: user, password: 'test-only', isAdmin: false };
    next();
  },
};

const calendarUtilsPath = require.resolve('../src/calendar-utils.js');
const calendarUtils = require(calendarUtilsPath);
require.cache[calendarUtilsPath].exports = {
  ...calendarUtils,
  getVisibleCalendars: async () => [
    { id: calendarId, user_id: user, name: 'Disposable', dav_slug: managedCalendar ? 'birthdays' : 'disposable' },
    { id: 8, user_id: user, name: 'Personal' },
  ],
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

function deleteCalendar(port) {
  return new Promise((resolve, reject) => {
    const request = http.request({
      hostname: '127.0.0.1',
      port,
      path: `/api/apps/calendars/${calendarId}`,
      method: 'DELETE',
    }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(body) }));
    });
    request.on('error', reject);
    request.end();
  });
}

function updateCalendar(port, subscribedUrl = null) {
  const raw = JSON.stringify({ name: 'Changed', color: '#123456', subscribed_url: subscribedUrl });
  return new Promise((resolve, reject) => {
    const request = http.request({
      hostname: '127.0.0.1',
      port,
      path: `/api/apps/calendars/${calendarId}`,
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(raw) },
    }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(body) }));
    });
    request.on('error', reject);
    request.end(raw);
  });
}

function createCalendar(port, name, subscribedUrl) {
  const raw = JSON.stringify({ name, color: '#123456', subscribed_url: subscribedUrl });
  return new Promise((resolve, reject) => {
    const request = http.request({
      hostname: '127.0.0.1',
      port,
      path: '/api/apps/calendars',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(raw) },
    }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(body) }));
    });
    request.on('error', reject);
    request.end(raw);
  });
}

async function withServer(t) {
  const app = express();
  app.use(express.json());
  app.use('/api/apps', appsApiRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return server;
}

test('web calendar deletion removes events, tombstones, shares, and the calendar atomically', async t => {
  resetState();
  const server = await withServer(t);

  const response = await deleteCalendar(server.address().port);

  assert.equal(response.status, 200);
  assert.equal(response.body.deletedEvents, 3);
  assert.equal(state.calendars.has(calendarId), false);
  assert.equal(state.events.has(calendarId), false);
  assert.equal(state.tombstones.has(calendarId), false);
  assert.equal(state.shares.has(calendarId), false);
});

test('web calendar deletion rolls every collection table back when cleanup fails', async t => {
  resetState();
  failStatement = 'DELETE FROM calendar_shares';
  const before = cloneState(state);
  const server = await withServer(t);

  const response = await deleteCalendar(server.address().port);

  assert.equal(response.status, 500);
  assert.deepEqual(state, before);
});

test('web settings and deletion cannot mutate the managed Birthdays calendar', async t => {
  resetState();
  managedCalendar = true;
  const before = cloneState(state);
  const server = await withServer(t);

  const reservedCreate = await createCalendar(server.address().port, 'Birthdays');
  assert.equal(reservedCreate.status, 409);
  assert.match(reservedCreate.body.error, /managed from Contacts/);

  const update = await updateCalendar(server.address().port);
  assert.equal(update.status, 409);
  assert.match(update.body.error, /managed from Contacts/);
  assert.equal(settingsUpdates, 0);

  const deletion = await deleteCalendar(server.address().port);
  assert.equal(deletion.status, 409);
  assert.match(deletion.body.error, /managed from Contacts/);
  assert.deepEqual(state, before);
});

test('calendar subscription settings reject unsafe URLs before changing state', async t => {
  resetState();
  const before = cloneState(state);
  const server = await withServer(t);

  for (const unsafeUrl of [
    'http://calendar.example.test/feed.ics',
    'https://user:secret@calendar.example.test/feed.ics',
    'not a URL',
  ]) {
    const create = await createCalendar(server.address().port, 'Subscribed', unsafeUrl);
    assert.equal(create.status, 400);
    assert.match(create.body.error, /credential-free HTTPS URL/);

    const update = await updateCalendar(server.address().port, unsafeUrl);
    assert.equal(update.status, 400);
    assert.match(update.body.error, /credential-free HTTPS URL/);
  }

  assert.equal(settingsUpdates, 0);
  assert.deepEqual(state, before);
});
