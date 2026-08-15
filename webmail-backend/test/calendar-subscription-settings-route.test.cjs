const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');

process.env.OMS_DB_PASSWORD ||= 'calendar-subscription-settings-route-test';

const user = 'subscription-settings@example.test';
const calendarId = 41;
let state;
let statements;
let failStatement;

function resetState({ subscribedUrl = null, events = [] } = {}) {
  state = {
    calendar: {
      id: calendarId,
      user_id: user,
      dav_slug: 'personal',
      subscribed_url: subscribedUrl,
      sync_token: 5,
      last_fetched_at: '2026-08-15 12:00:00',
      last_fetch_error: 'old status',
    },
    events: new Map(events.map(({ uid, managed, resourceName }) => [uid, { managed, resourceName }])),
    tombstones: new Map(),
  };
  statements = [];
  failStatement = null;
}

function cloneState(source) {
  return {
    calendar: { ...source.calendar },
    events: new Map([...source.events].map(([uid, event]) => [uid, { ...event }])),
    tombstones: new Map(source.tombstones),
  };
}

const db = require('../src/db.js');
db.pool.query = async sql => {
  throw new Error(`Subscription settings query escaped its transaction: ${String(sql)}`);
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
      statements.push(compact);
      if (!working) throw new Error('Subscription settings mutation escaped its transaction');
      if (failStatement && compact.includes(failStatement)) {
        failStatement = null;
        throw new Error('Injected subscription settings failure');
      }
      if (compact.startsWith('SELECT id, dav_slug, subscribed_url FROM calendars')) {
        return [working.calendar ? [{ ...working.calendar }] : [], []];
      }
      if (compact === 'SELECT uid FROM events WHERE calendar_id = ? LIMIT 1 FOR UPDATE') {
        const firstUid = working.events.keys().next().value;
        return [firstUid === undefined ? [] : [{ uid: firstUid }], []];
      }
      if (compact.startsWith('SELECT uid FROM events WHERE calendar_id = ? AND subscription_managed = 0')) {
        return [[...working.events]
          .filter(([, event]) => !event.managed)
          .slice(0, 1)
          .map(([uid]) => ({ uid })), []];
      }
      if (compact.startsWith('SELECT uid, resource_name FROM events')
        && compact.includes('subscription_managed = 1')) {
        return [[...working.events]
          .filter(([, event]) => event.managed)
          .map(([uid, event]) => ({ uid, resource_name: event.resourceName || uid })), []];
      }
      if (compact === 'SELECT sync_token FROM calendars WHERE id = ? LIMIT 1 FOR UPDATE') {
        return [[{ sync_token: working.calendar.sync_token }], []];
      }
      if (compact === 'UPDATE calendars SET sync_token = ? WHERE id = ? AND sync_token = ?') {
        if (Number(params[2]) !== working.calendar.sync_token) return [{ affectedRows: 0 }, []];
        working.calendar.sync_token = Number(params[0]);
        return [{ affectedRows: 1 }, []];
      }
      if (compact.startsWith('DELETE FROM events') && compact.includes('subscription_managed = 1')) {
        const event = working.events.get(String(params[1]));
        if (!event?.managed) return [{ affectedRows: 0 }, []];
        working.events.delete(String(params[1]));
        return [{ affectedRows: 1 }, []];
      }
      if (compact.startsWith('INSERT INTO calendar_tombstones')) {
        working.tombstones.set(String(params[1]), {
          resourceName: String(params[2]),
          revision: Number(params[3]),
        });
        return [{ affectedRows: 1 }, []];
      }
      if (compact.startsWith('UPDATE calendars SET name = ?, color = ?, subscribed_url = ?')) {
        working.calendar.subscribed_url = params[2];
        if (Number(params[3]) === 1) {
          working.calendar.last_fetched_at = null;
          working.calendar.last_fetch_error = null;
        }
        working.calendar.sync_token += Number(params[5]);
        return [{ affectedRows: 1 }, []];
      }
      throw new Error(`Unexpected subscription settings query: ${compact}`);
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

async function withServer(t) {
  const app = express();
  app.use(express.json());
  app.use('/api/apps', appsApiRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return server;
}

function updateCalendar(port, subscribedUrl, includeSubscription = true) {
  const body = { name: 'Subscribed', color: '#123456' };
  if (includeSubscription) body.subscribed_url = subscribedUrl;
  const raw = JSON.stringify(body);
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

test('first subscription conversion locks the calendar and rejects any populated calendar atomically', async t => {
  resetState({ events: [{ uid: 'local-event', managed: false }] });
  const before = cloneState(state);
  const server = await withServer(t);

  const response = await updateCalendar(server.address().port, 'https://calendar.example.test/feed.ics');

  assert.equal(response.status, 409);
  assert.match(response.body.error, /empty calendar/i);
  assert.deepEqual(state, before);
  assert.match(statements[0], /FROM calendars.*FOR UPDATE/i);
  assert.match(statements[1], /FROM events.*FOR UPDATE/i);
});

test('first subscription conversion succeeds for an empty locked calendar and resets fetch status', async t => {
  resetState();
  const server = await withServer(t);

  const response = await updateCalendar(server.address().port, 'https://calendar.example.test/feed.ics');

  assert.equal(response.status, 200);
  assert.equal(state.calendar.subscribed_url, 'https://calendar.example.test/feed.ics');
  assert.equal(state.calendar.last_fetched_at, null);
  assert.equal(state.calendar.last_fetch_error, null);
  assert.equal(state.calendar.sync_token, 6);
});

test('unsubscribe removes only worker-owned rows, preserves local rows, and tombstones one revision', async t => {
  resetState({
    subscribedUrl: 'https://calendar.example.test/feed.ics',
    events: [
      { uid: 'managed-a', managed: true, resourceName: 'managed-a-feed.ics' },
      { uid: 'local-legacy', managed: false },
      { uid: 'managed-b', managed: true },
    ],
  });
  const server = await withServer(t);

  const response = await updateCalendar(server.address().port, null);

  assert.equal(response.status, 200);
  assert.deepEqual([...state.events.keys()], ['local-legacy']);
  assert.deepEqual([...state.tombstones.entries()], [
    ['managed-a', { resourceName: 'managed-a-feed.ics', revision: 6 }],
    ['managed-b', { resourceName: 'managed-b', revision: 6 }],
  ]);
  assert.equal(state.calendar.sync_token, 6);
  assert.equal(state.calendar.subscribed_url, null);
  assert.equal(state.calendar.last_fetched_at, null);
  assert.equal(state.calendar.last_fetch_error, null);
});

test('unsubscribe rolls back ownership cleanup and metadata when tombstoning fails', async t => {
  resetState({
    subscribedUrl: 'https://calendar.example.test/feed.ics',
    events: [{ uid: 'managed-a', managed: true }, { uid: 'local-legacy', managed: false }],
  });
  failStatement = 'INSERT INTO calendar_tombstones';
  const before = cloneState(state);
  const server = await withServer(t);

  const response = await updateCalendar(server.address().port, null);

  assert.equal(response.status, 500);
  assert.deepEqual(state, before);
});

test('changing an existing feed URL keeps managed rows until refresh and resets stale fetch status', async t => {
  resetState({
    subscribedUrl: 'https://calendar.example.test/old.ics',
    events: [{ uid: 'managed-a', managed: true }],
  });
  const server = await withServer(t);

  const response = await updateCalendar(server.address().port, 'https://calendar.example.test/new.ics');

  assert.equal(response.status, 200);
  assert.deepEqual([...state.events.keys()], ['managed-a']);
  assert.equal(state.calendar.subscribed_url, 'https://calendar.example.test/new.ics');
  assert.equal(state.calendar.last_fetched_at, null);
  assert.equal(state.calendar.last_fetch_error, null);
  assert.equal(state.calendar.sync_token, 6);
});

test('changing feeds rejects a legacy unmanaged row without changing the existing subscription', async t => {
  resetState({
    subscribedUrl: 'https://calendar.example.test/old.ics',
    events: [{ uid: 'legacy-local', managed: false }, { uid: 'managed-a', managed: true }],
  });
  const before = cloneState(state);
  const server = await withServer(t);

  const response = await updateCalendar(server.address().port, 'https://calendar.example.test/new.ics');

  assert.equal(response.status, 409);
  assert.match(response.body.error, /legacy local events/i);
  assert.deepEqual(state, before);
});

test('omitting subscribed_url preserves the feed, managed events, and fetch status', async t => {
  resetState({
    subscribedUrl: 'https://calendar.example.test/feed.ics',
    events: [{ uid: 'managed-a', managed: true }],
  });
  const server = await withServer(t);

  const response = await updateCalendar(server.address().port, undefined, false);

  assert.equal(response.status, 200);
  assert.equal(state.calendar.subscribed_url, 'https://calendar.example.test/feed.ics');
  assert.equal(state.calendar.last_fetched_at, '2026-08-15 12:00:00');
  assert.equal(state.calendar.last_fetch_error, 'old status');
  assert.deepEqual([...state.events.keys()], ['managed-a']);
  assert.equal(state.calendar.sync_token, 6);
});
