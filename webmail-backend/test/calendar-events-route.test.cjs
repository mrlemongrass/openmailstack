const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');

process.env.OMS_DB_PASSWORD ||= 'calendar-events-route-test';

const user = 'calendar-route@example.test';
const calendarId = 7;
const storedEvents = new Map();

const db = require('../src/db.js');
db.pool.query = async (sql, params = []) => {
  const compact = String(sql).replace(/\s+/g, ' ').trim();
  if (compact.startsWith('SELECT c.id FROM calendars')) return [[{ id: calendarId }], []];
  if (compact.startsWith('INSERT INTO events')) {
    storedEvents.set(params[1], params[2]);
    return [{ affectedRows: 1 }, []];
  }
  if (compact.startsWith('UPDATE calendars SET sync_token')) return [{ affectedRows: 1 }, []];
  throw new Error(`Unexpected calendar event route query: ${compact}`);
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

test('editing an event upserts the exact submitted UID instead of inserting a copy', async (t) => {
  storedEvents.clear();
  const app = express();
  app.use(express.json());
  app.use('/api/apps', appsApiRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const port = server.address().port;
  const uid = '  opaque event uid  ';
  const event = title => [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'BEGIN:VEVENT',
    `UID:${uid}`,
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
