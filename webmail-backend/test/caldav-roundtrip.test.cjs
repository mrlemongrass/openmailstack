process.env.OMS_DB_PASSWORD ||= 'caldav-roundtrip-test';
process.env.OMS_DEFAULT_DOMAIN ||= 'example.test';

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const user = 'mac@example.test';
const calendar = {
  id: 7,
  user_id: user,
  name: 'macOS Interop',
  dav_slug: 'macos-interop',
  components: 'VEVENT',
  sync_token: 1,
};
const events = new Map();
let revision = 0;

const db = require('../src/db.js');
db.pool.query = async (sql, params = []) => {
  const compact = String(sql).replace(/\s+/g, ' ').trim();
  if (compact.startsWith('SHOW COLUMNS')) return [[{ Field: 'present' }], []];
  if (compact.startsWith('SHOW INDEX FROM calendars')) return [[{ Key_name: 'idx_calendars_user_dav_slug' }], []];
  if (compact.startsWith('SHOW INDEX FROM events')) {
    return [[
      { Non_unique: 0, Key_name: 'uniq_events_calendar_uid', Seq_in_index: 1, Column_name: 'calendar_id' },
      { Non_unique: 0, Key_name: 'uniq_events_calendar_uid', Seq_in_index: 2, Column_name: 'uid' },
    ], []];
  }
  if (compact.startsWith('CREATE TABLE')) return [[], []];
  if (compact.startsWith('SELECT id, user_id, name, dav_slug FROM calendars')) return [[calendar], []];
  if (compact.startsWith('SELECT * FROM calendars WHERE user_id = ? AND (dav_slug')) return [[calendar], []];
  if (compact.startsWith('SELECT c.user_id, cs.permission')) return [[{ user_id: user, permission: null }], []];
  if (compact.startsWith('SELECT uid, ical_data, updated_at FROM events')) {
    const event = events.get(params[1]);
    return [event ? [event] : [], []];
  }
  if (compact.startsWith('SELECT * FROM events WHERE calendar_id = ? AND uid = ?')) {
    const event = events.get(params[1]);
    return [event ? [event] : [], []];
  }
  if (compact.startsWith('INSERT INTO events')) {
    revision += 1;
    events.set(params[1], {
      uid: params[1],
      ical_data: params[2],
      updated_at: new Date(Date.UTC(2026, 6, 20, 12, 0, revision)),
    });
    return [{ affectedRows: 1 }, []];
  }
  if (compact.startsWith('UPDATE calendars SET sync_token')) {
    calendar.sync_token += 1;
    return [{ affectedRows: 1 }, []];
  }
  if (compact.startsWith('INSERT INTO calendar_tombstones')) return [{ affectedRows: 1 }, []];
  if (compact.startsWith('DELETE FROM events')) {
    events.delete(params[1]);
    return [{ affectedRows: 1 }, []];
  }
  throw new Error(`Unexpected CalDAV test query: ${compact}`);
};

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
const auth = `Basic ${Buffer.from(`${user}:test-password`).toString('base64')}`;

test('macOS-style CalDAV create, HEAD, update, GET, and delete is reversible', async (t) => {
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
