const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');
const test = require('node:test');

process.env.OMS_DB_PASSWORD ||= 'contact-activity-route-test';

const user = 'contact-activity@example.test';
const queries = [];

const db = require('../src/db.js');
db.pool.query = async (sql, params = []) => {
  const compact = String(sql).replace(/\s+/g, ' ').trim();
  queries.push({ sql: compact, params });

  if (compact.startsWith('SELECT email, emails_json FROM contacts')) {
    return [[{
      email: 'friend@example.test',
      emails_json: JSON.stringify([
        { value: 'FRIEND@example.test' },
        { value: 'other@example.test' },
      ]),
    }], []];
  }
  if (compact.includes('FROM mail_search_index')) {
    return [[{
      subject: 'Indexed hello',
      received_at: '2026-07-29T12:00:00.000Z',
      id: 91,
      snippet: 'Indexed preview',
    }], []];
  }
  if (compact.includes('FROM events e')) {
    return [[{
      uid: 'future-contact-meeting',
      ical_data: [
        'BEGIN:VCALENDAR',
        'BEGIN:VEVENT',
        'UID:future-contact-meeting',
        'DTSTART:20300101T170000Z',
        'DTEND:20300101T180000Z',
        'SUMMARY:Future contact meeting',
        'ATTENDEE:mailto:friend@example.test',
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n'),
    }], []];
  }
  throw new Error(`Unexpected contact activity query: ${compact}`);
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

const { appsApiRouter } = require('../src/apps-api.js');

function getJson(port, path) {
  return new Promise((resolve, reject) => {
    const request = http.request({ hostname: '127.0.0.1', port, path }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({
        status: response.statusCode,
        json: JSON.parse(Buffer.concat(chunks).toString('utf8')),
      }));
    });
    request.on('error', reject);
    request.end();
  });
}

test('contact activity uses the real mail index and owner-scoped calendar tables', async t => {
  queries.length = 0;
  const app = express();
  app.use('/api/apps', appsApiRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const response = await getJson(server.address().port, '/api/apps/contacts/42/activity');

  assert.equal(response.status, 200);
  assert.deepEqual(response.json.emails, [{
    subject: 'Indexed hello',
    received_at: '2026-07-29T12:00:00.000Z',
    id: 91,
    snippet: 'Indexed preview',
  }]);
  assert.deepEqual(response.json.meetings, [{
    id: 'future-contact-meeting',
    title: 'Future contact meeting',
    start: '2030-01-01T17:00:00.000Z',
  }]);

  const sql = queries.map(query => query.sql).join('\n');
  assert.match(sql, /FROM mail_search_index/);
  assert.match(sql, /JOIN calendars c ON c\.id = e\.calendar_id/);
  assert.match(sql, /c\.user_id = \?/);
  assert.doesNotMatch(sql, /FROM messages/);
  assert.doesNotMatch(sql, /events_occurrences|event_attendees/);
});
