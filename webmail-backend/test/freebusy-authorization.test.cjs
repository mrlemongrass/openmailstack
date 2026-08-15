const assert = require('node:assert/strict');
const express = require('express');
const fs = require('node:fs');
const http = require('node:http');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

process.env.OMS_DB_PASSWORD ||= 'freebusy-authorization-test';

const caller = 'alice@example.test';
const users = {
  alice: caller,
  bob: 'bob@example.test',
  carol: 'carol@example.test',
  empty: 'empty@example.test',
  private: 'private@example.test',
  unknown: 'unknown@example.test',
};

const calendars = [
  { id: 1, user_id: users.alice },
  { id: 2, user_id: users.carol },
  { id: 3, user_id: users.bob },
  { id: 4, user_id: users.bob },
  { id: 5, user_id: users.carol },
  { id: 6, user_id: users.empty },
  { id: 7, user_id: users.private },
];
const shares = [
  { calendar_id: 2, shared_with_user_id: users.alice },
  { calendar_id: 4, shared_with_user_id: users.alice },
  { calendar_id: 5, shared_with_user_id: users.bob },
  { calendar_id: 6, shared_with_user_id: users.alice },
];

function event(calendarId, uid, startHour, transparent = false) {
  return {
    calendar_id: calendarId,
    ical_data: [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'BEGIN:VEVENT',
      `UID:${uid}`,
      `DTSTART:20260820T${String(startHour).padStart(2, '0')}0000Z`,
      `DTEND:20260820T${String(startHour + 1).padStart(2, '0')}0000Z`,
      ...(transparent ? ['TRANSP:TRANSPARENT'] : []),
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n'),
  };
}

const events = [
  event(1, 'alice-owned', 9),
  event(2, 'carol-shared-to-alice', 11),
  event(3, 'bob-private', 13),
  event(4, 'bob-shared-to-alice', 15),
  event(4, 'bob-transparent', 17, true),
  event(5, 'carol-shared-to-bob', 19),
  event(7, 'private-admin-target', 21),
];

let currentCaller = caller;
let currentAdmin = false;
let queries = [];
let selfEventRowsOverride;

function calendarSharedTo(calendarId, username) {
  return shares.some(share => share.calendar_id === calendarId && share.shared_with_user_id === username);
}

const db = require('../src/db.js');
db.pool.query = async (sql, params = []) => {
  const compact = String(sql).replace(/\s+/g, ' ').trim();
  queries.push({ sql: compact, params });

  if (compact.startsWith('SELECT DISTINCT c.user_id AS target_user')) {
    const [requestingUser, ...targets] = params.map(String);
    return [[...new Set(calendars
      .filter(calendar => targets.includes(calendar.user_id) && calendarSharedTo(calendar.id, requestingUser))
      .map(calendar => calendar.user_id))]
      .map(target_user => ({ target_user })), []];
  }
  if (compact.startsWith('SELECT c.user_id AS target_user, e.ical_data')) {
    const values = params.map(String);
    const requestingUser = values.at(-1);
    const targets = values.slice(0, -1);
    return [events.flatMap(stored => {
      const calendar = calendars.find(candidate => candidate.id === stored.calendar_id);
      return calendar && targets.includes(calendar.user_id) && calendarSharedTo(calendar.id, requestingUser)
        ? [{ target_user: calendar.user_id, ical_data: stored.ical_data }]
        : [];
    }), []];
  }
  if (compact.startsWith('SELECT e.ical_data') && compact.includes('EXISTS ( SELECT 1 FROM calendar_shares')) {
    const requestingUser = String(params[0]);
    if (selfEventRowsOverride) return [selfEventRowsOverride, []];
    return [events.filter(stored => {
      const calendar = calendars.find(candidate => candidate.id === stored.calendar_id);
      return calendar?.user_id === requestingUser || calendarSharedTo(stored.calendar_id, requestingUser);
    }).map(stored => ({ ical_data: stored.ical_data })), []];
  }
  throw new Error(`Unexpected free/busy query: ${compact}`);
};

const authPath = require.resolve('../src/auth.js');
const auth = require(authPath);
require.cache[authPath].exports = {
  ...auth,
  requireSession: (req, _res, next) => {
    req.user = { username: currentCaller, password: 'test-only', isAdmin: currentAdmin };
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

const sourcePath = path.resolve(__dirname, '../src/apps-api.ts');
const source = fs.readFileSync(sourcePath, 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  fileName: sourcePath,
}).outputText;
const loaded = new Module(sourcePath, module);
loaded.filename = sourcePath;
loaded.paths = Module._nodeModulePaths(path.dirname(sourcePath));
loaded._compile(compiled, sourcePath);
const { appsApiRouter } = loaded.exports;

async function withServer(t) {
  const app = express();
  app.use('/api/apps', appsApiRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return server.address().port;
}

async function freeBusy(port, requestedUsers, {
  start = '2026-08-01T00:00:00.000Z',
  end = '2026-09-01T00:00:00.000Z',
} = {}) {
  const params = new URLSearchParams({ users: requestedUsers, start, end });
  const response = await fetch(`http://127.0.0.1:${port}/api/apps/calendars/freebusy?${params}`);
  return { status: response.status, json: await response.json() };
}

test.beforeEach(() => {
  currentCaller = caller;
  currentAdmin = false;
  queries = [];
  selfEventRowsOverride = undefined;
});

test('self lookup includes owned and shared-in calendars and filters transparent events', async t => {
  const port = await withServer(t);
  const response = await freeBusy(port, ' ALICE@EXAMPLE.TEST,alice@example.test ');

  assert.equal(response.status, 200);
  assert.deepEqual(Object.keys(response.json.busy), [users.alice]);
  assert.deepEqual(response.json.unavailable, []);
  assert.deepEqual(response.json.busy[users.alice].map(interval => interval.start), [
    '2026-08-20T09:00:00.000Z',
    '2026-08-20T11:00:00.000Z',
    '2026-08-20T15:00:00.000Z',
  ]);
  assert.equal(queries.filter(query => query.sql.includes('EXISTS ( SELECT 1 FROM calendar_shares')).length, 1);
});

test('other-user lookup exposes only target-owned calendars shared directly to the caller', async t => {
  const port = await withServer(t);
  const response = await freeBusy(port, users.bob);

  assert.equal(response.status, 200);
  assert.deepEqual(response.json, {
    success: true,
    busy: {
      [users.bob]: [{ start: '2026-08-20T15:00:00.000Z', end: '2026-08-20T16:00:00.000Z' }],
    },
    unavailable: [],
  });
  const eventQuery = queries.find(query => query.sql.startsWith('SELECT c.user_id AS target_user, e.ical_data'));
  assert.ok(eventQuery);
  assert.match(eventQuery.sql, /EXISTS \( SELECT 1 FROM calendar_shares cs/);
  assert.match(eventQuery.sql, /c\.user_id IN/);
});

test('unknown, private, and unshared targets are neutral unavailable and never reach an event query', async t => {
  const port = await withServer(t);
  const response = await freeBusy(port, `${users.unknown},${users.private}`);

  assert.equal(response.status, 200);
  assert.deepEqual(response.json, {
    success: true,
    busy: {},
    unavailable: [users.unknown, users.private],
  });
  assert.equal(queries.some(query => query.sql.includes('FROM events')), false);
});

test('an explicitly shared empty target is authorized with an empty busy list', async t => {
  const port = await withServer(t);
  const response = await freeBusy(port, users.empty);

  assert.deepEqual(response.json, {
    success: true,
    busy: { [users.empty]: [] },
    unavailable: [],
  });
});

test('administrator status never overrides free/busy sharing', async t => {
  currentAdmin = true;
  const port = await withServer(t);
  const response = await freeBusy(port, users.private);

  assert.deepEqual(response.json, {
    success: true,
    busy: {},
    unavailable: [users.private],
  });
  assert.equal(queries.some(query => query.sql.includes('FROM events')), false);
});

test('recipient and time-window bounds reject malformed requests before database access', async t => {
  const port = await withServer(t);
  const tooMany = Array.from({ length: 51 }, (_, index) => `person${index}@example.test`).join(',');
  const tooLong = `${'a'.repeat(64)}@${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(63)}.test`;
  const cases = [
    { users: 'bad@@example.test' },
    { users: 'Display Name <user@example.test>' },
    { users: 'user@example.test,' },
    { users: 'user example@example.test' },
    { users: 'user@example.test\n' },
    { users: 'user@example.test\0' },
    { users: tooLong },
    { users: 'user@-example.test' },
    { users: 'user@example_test' },
    { users: 'user@example' },
    { users: 'user/role@example.test' },
    { users: tooMany },
    { users: users.alice, start: 'invalid' },
    { users: users.alice, start: '2026-08-02T00:00:00.000Z', end: '2026-08-01T00:00:00.000Z' },
    { users: users.alice, start: '2026-01-01T00:00:00.000Z', end: '2027-01-03T00:00:00.000Z' },
  ];
  for (const candidate of cases) {
    const response = await freeBusy(port, candidate.users, candidate);
    assert.equal(response.status, 400, JSON.stringify(candidate));
  }
  assert.deepEqual(queries, []);
});

test('duplicate share rows collapse identical busy intervals', async t => {
  const duplicated = event(1, 'duplicate', 9);
  selfEventRowsOverride = [duplicated, duplicated];
  const port = await withServer(t);
  const response = await freeBusy(port, users.alice);

  assert.equal(response.status, 200);
  assert.deepEqual(response.json.busy[users.alice], [
    { start: '2026-08-20T09:00:00.000Z', end: '2026-08-20T10:00:00.000Z' },
  ]);
});

test('a cancelled standalone event does not contribute a busy interval', async t => {
  selfEventRowsOverride = [{
    ical_data: [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'BEGIN:VEVENT',
      'UID:cancelled-appointment',
      'DTSTART:20260820T090000Z',
      'DTEND:20260820T100000Z',
      'STATUS:CANCELLED',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n'),
  }, event(1, 'still-busy', 11)];
  const port = await withServer(t);
  const response = await freeBusy(port, users.alice);

  assert.equal(response.status, 200);
  assert.deepEqual(response.json, {
    success: true,
    busy: {
      [users.alice]: [{ start: '2026-08-20T11:00:00.000Z', end: '2026-08-20T12:00:00.000Z' }],
    },
    unavailable: [],
  });
});

test('recurring events contribute each occurrence inside the requested window', async t => {
  selfEventRowsOverride = [{
    ical_data: [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'BEGIN:VEVENT',
      'UID:daily-standup',
      'DTSTART:20260819T090000Z',
      'DTEND:20260819T093000Z',
      'RRULE:FREQ=DAILY;COUNT=3',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n'),
  }];
  const port = await withServer(t);
  const response = await freeBusy(port, users.alice, {
    start: '2026-08-20T00:00:00.000Z',
    end: '2026-08-22T00:00:00.000Z',
  });

  assert.equal(response.status, 200);
  assert.deepEqual(response.json.busy[users.alice], [
    { start: '2026-08-20T09:00:00.000Z', end: '2026-08-20T09:30:00.000Z' },
    { start: '2026-08-21T09:00:00.000Z', end: '2026-08-21T09:30:00.000Z' },
  ]);
});

test('a cancelled recurrence instance is excluded while the remaining series stays busy', async t => {
  selfEventRowsOverride = [{
    ical_data: [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'BEGIN:VEVENT',
      'UID:daily-office-hours',
      'DTSTART:20260819T090000Z',
      'DTEND:20260819T093000Z',
      'RRULE:FREQ=DAILY;COUNT=3',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:daily-office-hours',
      'RECURRENCE-ID:20260820T090000Z',
      'STATUS:CANCELLED',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n'),
  }];
  const port = await withServer(t);
  const response = await freeBusy(port, users.alice, {
    start: '2026-08-19T00:00:00.000Z',
    end: '2026-08-22T00:00:00.000Z',
  });

  assert.equal(response.status, 200);
  assert.deepEqual(response.json.busy[users.alice], [
    { start: '2026-08-19T09:00:00.000Z', end: '2026-08-19T09:30:00.000Z' },
    { start: '2026-08-21T09:00:00.000Z', end: '2026-08-21T09:30:00.000Z' },
  ]);
  assert.deepEqual(response.json.unavailable, []);
});

test('unsupported or excessively old recurrence rules fail closed instead of appearing Free', async t => {
  const port = await withServer(t);
  for (const [uid, start, rule] of [
    ['multi-day-weekly', '20260817T090000Z', 'FREQ=WEEKLY;BYDAY=MO,WE'],
    ['unbounded-history', '20000101T090000Z', 'FREQ=DAILY'],
  ]) {
    selfEventRowsOverride = [{
      ical_data: [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'BEGIN:VEVENT',
        `UID:${uid}`,
        `DTSTART:${start}`,
        `DTEND:${start.replace('090000Z', '093000Z')}`,
        `RRULE:${rule}`,
        'END:VEVENT',
        'END:VCALENDAR',
      ].join('\r\n'),
    }];
    const response = await freeBusy(port, users.alice);
    assert.deepEqual(response.json, {
      success: true,
      busy: {},
      unavailable: [users.alice],
    }, uid);
  }
});

test('corrupt iCalendar data fails closed instead of appearing Free', async t => {
  selfEventRowsOverride = [{
    ical_data: [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'BEGIN:VEVENT',
      'UID:missing-start',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n'),
  }];
  const port = await withServer(t);
  const response = await freeBusy(port, users.alice);

  assert.equal(response.status, 200);
  assert.deepEqual(response.json, {
    success: true,
    busy: {},
    unavailable: [users.alice],
  });
});

test('event loading is bounded and an oversized result fails closed', async t => {
  const repeated = event(1, 'bounded', 9);
  selfEventRowsOverride = Array(5_001).fill(repeated);
  const port = await withServer(t);
  const response = await freeBusy(port, users.alice);

  assert.equal(response.status, 200);
  assert.deepEqual(response.json, {
    success: true,
    busy: {},
    unavailable: [users.alice],
  });
  const eventQuery = queries.find(query => query.sql.startsWith('SELECT e.ical_data'));
  assert.match(eventQuery.sql, /LIMIT 5001$/);
});
