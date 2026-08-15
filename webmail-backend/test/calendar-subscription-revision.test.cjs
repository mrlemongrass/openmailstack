const test = require('node:test');
const assert = require('node:assert/strict');

process.env.OMS_DB_PASSWORD ||= 'calendar-subscription-revision-test';

const calendar = {
  id: 12,
  user_id: 'subscriber@example.test',
  subscribed_url: 'https://calendar.example.test/feed.ics',
  sync_token: 1,
};
const events = new Map();
const eventRevisions = new Map();
const resourceNames = new Map();
const subscriptionManaged = new Map();
const tombstones = new Map();
let feedBody = '';
let failNextStatementContaining = null;
let lastFetchError = null;
const activeSubscriptionLocks = new Set();
let fakeNow = 0;
let expireRunAfterStatementContaining = null;
let subscriptionSelectionSql = '';

function cloneState() {
  return {
    events: new Map(events),
    revisions: new Map(eventRevisions),
    resourceNames: new Map(resourceNames),
    managed: new Map(subscriptionManaged),
    tombstones: new Map(tombstones),
    revision: calendar.sync_token,
  };
}

function applyState(state) {
  events.clear();
  eventRevisions.clear();
  resourceNames.clear();
  subscriptionManaged.clear();
  tombstones.clear();
  for (const [uid, value] of state.events) events.set(uid, value);
  for (const [uid, value] of state.revisions) eventRevisions.set(uid, value);
  for (const [uid, value] of state.resourceNames) resourceNames.set(uid, value);
  for (const [uid, value] of state.managed) subscriptionManaged.set(uid, value);
  for (const [uid, value] of state.tombstones) tombstones.set(uid, value);
  calendar.sync_token = state.revision;
}

const db = require('../src/db.js');
db.pool.query = async (sql, params = []) => {
  const compact = String(sql).replace(/\s+/g, ' ').trim();
  if (compact.startsWith('SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, IS_NULLABLE, COLUMN_DEFAULT')) {
    return [[
      {
        TABLE_NAME: 'calendars', COLUMN_NAME: 'last_fetched_at', DATA_TYPE: 'datetime',
        IS_NULLABLE: 'YES', COLUMN_DEFAULT: null,
      },
      {
        TABLE_NAME: 'calendars', COLUMN_NAME: 'last_fetch_error', DATA_TYPE: 'text',
        IS_NULLABLE: 'YES', COLUMN_DEFAULT: null,
      },
      {
        TABLE_NAME: 'events', COLUMN_NAME: 'subscription_managed', DATA_TYPE: 'tinyint',
        IS_NULLABLE: 'NO', COLUMN_DEFAULT: '0',
      },
    ], []];
  }
  if (compact.startsWith('SELECT id, user_id, subscribed_url')) {
    subscriptionSelectionSql = compact;
    return [[calendar], []];
  }
  throw new Error(`Unexpected subscription pool query: ${compact}`);
};
db.pool.getConnection = async () => {
  let working = null;
  let namedLock = null;
  return {
    beginTransaction: async () => { working = cloneState(); },
    commit: async () => { applyState(working); working = null; },
    rollback: async () => { working = null; },
    release: () => {},
    destroy: () => {},
    query: async (sql, params = []) => {
      const compact = String(sql).replace(/\s+/g, ' ').trim();
      if (compact === 'SELECT GET_LOCK(?, 0) AS acquired') {
        const requestedLock = String(params[0]);
        if (activeSubscriptionLocks.has(requestedLock)) return [[{ acquired: 0 }], []];
        activeSubscriptionLocks.add(requestedLock);
        namedLock = requestedLock;
        return [[{ acquired: 1 }], []];
      }
      if (compact === 'SELECT RELEASE_LOCK(?) AS released') {
        const released = namedLock === String(params[0]) ? 1 : 0;
        if (namedLock) activeSubscriptionLocks.delete(namedLock);
        namedLock = null;
        return [[{ released }], []];
      }
      if (compact.startsWith('UPDATE calendars SET last_fetched_at')) {
        const hasGenerationGuard = compact.includes('sync_token = ?');
        const expectedUrl = String(params[hasGenerationGuard ? params.length - 2 : params.length - 1]);
        if (expectedUrl !== calendar.subscribed_url) return [{ affectedRows: 0 }, []];
        if (hasGenerationGuard && Number(params[params.length - 1]) !== calendar.sync_token) {
          return [{ affectedRows: 0 }, []];
        }
        lastFetchError = compact.includes('last_fetch_error = NULL') ? null : String(params[0]);
        return [{ affectedRows: 1 }, []];
      }
      if (!working) throw new Error('Subscription mutation escaped its transaction');
      if (failNextStatementContaining && compact.includes(failNextStatementContaining)) {
        failNextStatementContaining = null;
        throw new Error('Injected subscription mutation failure');
      }
      if (expireRunAfterStatementContaining && compact.includes(expireRunAfterStatementContaining)) {
        expireRunAfterStatementContaining = null;
        fakeNow = Number.MAX_SAFE_INTEGER;
      }
      if (compact === 'SELECT subscribed_url, sync_token FROM calendars WHERE id = ? LIMIT 1 FOR UPDATE') {
        return [[{ subscribed_url: calendar.subscribed_url, sync_token: working.revision }], []];
      }
      if (compact === 'SELECT sync_token FROM calendars WHERE id = ? LIMIT 1 FOR UPDATE') {
        return [[{ sync_token: working.revision }], []];
      }
      if (compact === 'UPDATE calendars SET sync_token = ? WHERE id = ? AND sync_token = ?') {
        if (Number(params[2]) !== working.revision) return [{ affectedRows: 0 }, []];
        working.revision = Number(params[0]);
        return [{ affectedRows: 1 }, []];
      }
      if (compact.startsWith('SELECT uid, ical_data') && compact.includes('AND uid = ?')) {
        const uid = params[1];
        return [working.events.has(uid) ? [{ uid, ical_data: working.events.get(uid) }] : [], []];
      }
      if (compact.startsWith('SELECT uid') && compact.includes('FROM events WHERE calendar_id = ?')) {
        return [[...working.events.entries()].map(([uid, ical_data]) => ({
          uid,
          resource_name: working.resourceNames.get(uid) || uid,
          ical_data,
          subscription_managed: working.managed.get(uid) ? 1 : 0,
        })), []];
      }
      if (compact.startsWith('DELETE FROM calendar_tombstones')) {
        return [{ affectedRows: working.tombstones.delete(params[1]) ? 1 : 0 }, []];
      }
      if (compact === 'DELETE FROM events WHERE calendar_id = ? AND uid = ?') {
        working.revisions.delete(params[1]);
        working.resourceNames.delete(params[1]);
        working.managed.delete(params[1]);
        return [{ affectedRows: working.events.delete(params[1]) ? 1 : 0 }, []];
      }
      if (compact.startsWith('INSERT INTO calendar_tombstones')) {
        const resourceName = compact.includes('resource_name') ? params[2] : params[1];
        working.tombstones.set(resourceName, Number(compact.includes('resource_name') ? params[3] : params[2]));
        return [{ affectedRows: 1 }, []];
      }
      if (compact.startsWith('INSERT INTO events')) {
        const carriesResourceName = compact.includes('resource_name');
        working.resourceNames.set(params[1], carriesResourceName ? params[2] : params[1]);
        working.events.set(params[1], params[carriesResourceName ? 3 : 2]);
        working.revisions.set(params[1], Number(params[carriesResourceName ? 4 : 3]));
        working.managed.set(params[1], true);
        return [{ affectedRows: 1 }, []];
      }
      if (compact.startsWith('UPDATE events SET subscription_managed = 1')) {
        const uid = params[1];
        if (working.managed.get(uid) || working.events.get(uid) !== params[2]) {
          return [{ affectedRows: 0 }, []];
        }
        working.managed.set(uid, true);
        return [{ affectedRows: 1 }, []];
      }
      if (compact.startsWith('UPDATE events SET ical_data')) {
        if (compact.includes('subscription_managed = 1') && !compact.includes('sync_token = ?')) {
          const uid = params[2];
          if (working.managed.get(uid) || working.events.get(uid) !== params[3]) {
            return [{ affectedRows: 0 }, []];
          }
          working.events.set(uid, params[0]);
          working.managed.set(uid, true);
          return [{ affectedRows: 1 }, []];
        }
        working.events.set(params[3], params[0]);
        working.revisions.set(params[3], Number(params[1]));
        working.managed.set(params[3], true);
        return [{ affectedRows: 1 }, []];
      }
      throw new Error(`Unexpected subscription transaction query: ${compact}`);
    },
  };
};

const { runCalendarSubscriptionFetchOnce } = require('../src/calendar-subscription.js');
const runSubscriptionWorker = (overrides = {}) => runCalendarSubscriptionFetchOnce({
  fetchSubscription: async () => Buffer.from(feedBody, 'utf8'),
  ...overrides,
});

function feed(titleA = 'A', includeB = true) {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//OpenMailStack//Subscription Test//EN',
    'BEGIN:VEVENT', 'UID:subscription-a', 'DTSTAMP:20260815T120000Z',
    'DTSTART:20260816T120000Z', `SUMMARY:${titleA}`, 'END:VEVENT',
    ...(includeB ? [
      'BEGIN:VEVENT', 'UID:subscription-b', 'DTSTAMP:20260815T120000Z',
      'DTSTART:20260817T120000Z', 'SUMMARY:B', 'END:VEVENT',
    ] : []),
    'END:VCALENDAR',
  ].join('\r\n');
}

function singleEvent(uid, summary) {
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Legacy Subscription Test//EN',
    'BEGIN:VEVENT', `UID:${uid}`, 'DTSTAMP:20260815T120000Z',
    'DTSTART:20260817T120000Z', `SUMMARY:${summary}`, 'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n');
}

test('subscription refresh stamps one revision for real changes and remains idempotent', async () => {
  calendar.sync_token = 1;
  events.clear();
  eventRevisions.clear();
  tombstones.clear();
  tombstones.set('subscription-a', 1);
  feedBody = feed();

  await runSubscriptionWorker();
  assert.equal(calendar.sync_token, 2);
  assert.equal(eventRevisions.get('subscription-a'), 2);
  assert.equal(eventRevisions.get('subscription-b'), 2);
  assert.equal(tombstones.has('subscription-a'), false);

  await runSubscriptionWorker();
  assert.equal(calendar.sync_token, 2);

  feedBody = feed('A changed');
  await runSubscriptionWorker();
  assert.equal(calendar.sync_token, 3);
  assert.equal(eventRevisions.get('subscription-a'), 3);
  assert.equal(eventRevisions.get('subscription-b'), 2);
});

test('subscription refresh retracts missing events at the same revision as feed updates and is idempotent', async () => {
  calendar.sync_token = 1;
  events.clear();
  eventRevisions.clear();
  tombstones.clear();
  feedBody = feed();

  await runSubscriptionWorker();
  assert.equal(calendar.sync_token, 2);

  feedBody = feed('A changed while B disappears', false);
  await runSubscriptionWorker();
  assert.equal(calendar.sync_token, 3);
  assert.equal(events.has('subscription-b'), false);
  assert.equal(eventRevisions.get('subscription-a'), 3);
  assert.equal(tombstones.get('subscription-b'), 3);

  await runSubscriptionWorker();
  assert.equal(calendar.sync_token, 3);
  assert.equal(tombstones.get('subscription-b'), 3);
});

test('subscription write failure rolls back event and collection revisions', async () => {
  const beforeBody = events.get('subscription-a');
  const beforeRevision = calendar.sync_token;
  feedBody = feed('Must roll back');
  failNextStatementContaining = 'UPDATE events SET ical_data';

  await runSubscriptionWorker();
  assert.equal(events.get('subscription-a'), beforeBody);
  assert.equal(calendar.sync_token, beforeRevision);
});

test('subscription tombstone failure rolls back the removed event and collection revision', async () => {
  calendar.sync_token = 1;
  events.clear();
  eventRevisions.clear();
  tombstones.clear();
  feedBody = feed();

  await runSubscriptionWorker();
  const beforeRevision = calendar.sync_token;

  feedBody = feed('A', false);
  failNextStatementContaining = 'INSERT INTO calendar_tombstones';
  await runSubscriptionWorker();
  assert.equal(events.has('subscription-b'), true);
  assert.equal(tombstones.has('subscription-b'), false);
  assert.equal(calendar.sync_token, beforeRevision);
  assert.match(lastFetchError, /Injected subscription mutation failure/);
});

test('subscription refresh aborts atomically before touching tombstones when a feed UID collides with a local row', async () => {
  calendar.sync_token = 11;
  events.clear();
  eventRevisions.clear();
  subscriptionManaged.clear();
  tombstones.clear();
  events.set('local-collision', singleEvent('local-collision', 'Local body'));
  eventRevisions.set('local-collision', 7);
  subscriptionManaged.set('local-collision', false);
  tombstones.set('feed-new', 9);
  feedBody = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//OpenMailStack//Subscription Test//EN',
    'BEGIN:VEVENT', 'UID:feed-new', 'DTSTAMP:20260815T120000Z',
    'DTSTART:20260816T120000Z', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:local-collision', 'DTSTAMP:20260815T120000Z',
    'DTSTART:20260817T120000Z', 'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');

  await runSubscriptionWorker();

  assert.deepEqual([...events.entries()], [[
    'local-collision', singleEvent('local-collision', 'Local body'),
  ]]);
  assert.equal(eventRevisions.get('local-collision'), 7);
  assert.equal(subscriptionManaged.get('local-collision'), false);
  assert.equal(tombstones.get('feed-new'), 9);
  assert.equal(calendar.sync_token, 11);
  assert.match(lastFetchError, /collides with a local calendar event/i);
});

test('subscription refresh fails closed before all mutations when any unmanaged legacy row exists', async () => {
  calendar.sync_token = 4;
  events.clear();
  eventRevisions.clear();
  subscriptionManaged.clear();
  tombstones.clear();
  events.set('legacy-local', 'legacy local body');
  eventRevisions.set('legacy-local', 4);
  subscriptionManaged.set('legacy-local', false);
  tombstones.set('subscription-a', 3);
  feedBody = feed();

  await runSubscriptionWorker();

  assert.equal(events.get('legacy-local'), 'legacy local body');
  assert.equal(events.has('subscription-a'), false);
  assert.equal(events.has('subscription-b'), false);
  assert.equal(eventRevisions.get('legacy-local'), 4);
  assert.equal(tombstones.get('subscription-a'), 3);
  assert.equal(calendar.sync_token, 4);
  assert.match(lastFetchError, /unmatched unmanaged local event/i);
});

test('an exact unambiguous legacy feed row exposes canonicalization at a fresh collection revision', async () => {
  calendar.sync_token = 8;
  events.clear();
  eventRevisions.clear();
  resourceNames.clear();
  subscriptionManaged.clear();
  tombstones.clear();
  const canonical = feed('A', false);
  const legacy = canonical.replace(
    'PRODID:-//OpenMailStack//Subscription Test//EN',
    'PRODID:-//Legacy Producer//EN',
  );
  events.set('subscription-a', legacy);
  eventRevisions.set('subscription-a', 8);
  resourceNames.set('subscription-a', 'legacy-subscription.ics');
  subscriptionManaged.set('subscription-a', false);
  feedBody = canonical;

  await runSubscriptionWorker();

  assert.equal(events.get('subscription-a'), canonical);
  assert.equal(subscriptionManaged.get('subscription-a'), true);
  assert.equal(resourceNames.get('subscription-a'), 'legacy-subscription.ics');
  assert.equal(eventRevisions.get('subscription-a'), 9);
  assert.equal(calendar.sync_token, 9);
  assert.equal(lastFetchError, null);
});

test('subscription refresh clears only its exact DAV resource tombstone', async () => {
  calendar.sync_token = 3;
  events.clear();
  eventRevisions.clear();
  resourceNames.clear();
  subscriptionManaged.clear();
  tombstones.clear();
  feedBody = feed('A', false);
  await runSubscriptionWorker();
  resourceNames.set('subscription-a', 'active-feed-resource.ics');
  tombstones.set('active-feed-resource.ics', 3);
  tombstones.set('older-same-uid-resource.ics', 2);

  await runSubscriptionWorker();

  assert.equal(tombstones.has('active-feed-resource.ics'), false);
  assert.equal(tombstones.get('older-same-uid-resource.ics'), 2);
  assert.equal(calendar.sync_token, 5);
});

test('a recurring legacy row is never claimed through an ambiguous structural match', async () => {
  calendar.sync_token = 6;
  events.clear();
  eventRevisions.clear();
  resourceNames.clear();
  subscriptionManaged.clear();
  tombstones.clear();
  const recurring = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//OpenMailStack//Subscription Test//EN',
    'BEGIN:VEVENT', 'UID:series-legacy', 'DTSTAMP:20260815T120000Z',
    'DTSTART:20260816T120000Z', 'RRULE:FREQ=DAILY;COUNT=2', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:series-legacy', 'DTSTAMP:20260815T120000Z',
    'RECURRENCE-ID:20260817T120000Z', 'DTSTART:20260817T130000Z', 'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
  events.set('series-legacy', recurring);
  eventRevisions.set('series-legacy', 6);
  subscriptionManaged.set('series-legacy', false);
  feedBody = recurring;

  await runSubscriptionWorker();

  assert.equal(events.get('series-legacy'), recurring);
  assert.equal(subscriptionManaged.get('series-legacy'), false);
  assert.equal(calendar.sync_token, 6);
  assert.match(lastFetchError, /structurally ambiguous/i);
});

test('malformed subscription content cannot be mistaken for an empty feed', async () => {
  calendar.sync_token = 1;
  events.clear();
  eventRevisions.clear();
  tombstones.clear();
  feedBody = feed();

  await runSubscriptionWorker();
  const beforeRevision = calendar.sync_token;

  feedBody = '<html>temporary upstream error</html>';
  await runSubscriptionWorker();
  assert.deepEqual([...events.keys()].sort(), ['subscription-a', 'subscription-b']);
  assert.equal(calendar.sync_token, beforeRevision);
  assert.match(lastFetchError, /VCALENDAR/i);
});

test('a truncated inner VEVENT cannot retract the previously stored feed', async () => {
  calendar.sync_token = 1;
  events.clear();
  eventRevisions.clear();
  tombstones.clear();
  feedBody = feed();

  await runSubscriptionWorker();
  const beforeRevision = calendar.sync_token;

  feedBody = [
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    'UID:subscription-a',
    'END:VCALENDAR',
  ].join('\r\n');
  await runSubscriptionWorker();

  assert.deepEqual([...events.keys()].sort(), ['subscription-a', 'subscription-b']);
  assert.equal(calendar.sync_token, beforeRevision);
  assert.match(lastFetchError, /truncated|mismatched/i);
});

test('a genuinely empty VCALENDAR retracts the previous feed at one revision', async () => {
  calendar.sync_token = 1;
  events.clear();
  eventRevisions.clear();
  tombstones.clear();
  feedBody = feed();
  await runSubscriptionWorker();

  feedBody = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//OpenMailStack//Subscription Test//EN',
    'END:VCALENDAR',
  ].join('\r\n');
  await runSubscriptionWorker();
  assert.deepEqual([...events.keys()], []);
  assert.equal(calendar.sync_token, 3);
  assert.deepEqual([...tombstones.entries()].sort(), [
    ['subscription-a', 3],
    ['subscription-b', 3],
  ]);
});

test('a non-event resource feed is not treated as a genuinely empty event calendar', async () => {
  calendar.sync_token = 1;
  events.clear();
  eventRevisions.clear();
  tombstones.clear();
  feedBody = feed();
  await runSubscriptionWorker();
  const beforeRevision = calendar.sync_token;

  feedBody = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0', 'PRODID:-//OpenMailStack//Subscription Test//EN',
    'BEGIN:VTODO', 'UID:task-only', 'DTSTAMP:20260815T120000Z', 'END:VTODO',
    'END:VCALENDAR',
  ].join('\r\n');
  await runSubscriptionWorker();
  assert.deepEqual([...events.keys()].sort(), ['subscription-a', 'subscription-b']);
  assert.equal(calendar.sync_token, beforeRevision);
  assert.match(lastFetchError, /unsupported.*VTODO|VEVENT/i);
});

test('recurrence exceptions sharing one UID remain one stored subscription resource', async () => {
  calendar.sync_token = 1;
  events.clear();
  eventRevisions.clear();
  tombstones.clear();
  feedBody = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//OpenMailStack//Subscription Test//EN',
    'BEGIN:VEVENT', 'UID:series', 'DTSTAMP:20260815T120000Z',
    'DTSTART:20260816T120000Z', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:series', 'DTSTAMP:20260815T120000Z',
    'RECURRENCE-ID:20260817T120000Z', 'DTSTART:20260817T130000Z', 'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
  await runSubscriptionWorker();
  assert.deepEqual([...events.keys()], ['series']);
  assert.equal((events.get('series').match(/BEGIN:VEVENT/g) || []).length, 2);
});

test('a response fetched for a replaced subscription URL cannot commit or set status', async () => {
  calendar.sync_token = 1;
  calendar.subscribed_url = 'https://calendar.example.test/old.ics';
  events.clear();
  eventRevisions.clear();
  tombstones.clear();
  feedBody = feed('Original');
  await runSubscriptionWorker();
  const before = new Map(events);
  const beforeRevision = calendar.sync_token;
  lastFetchError = null;

  await runSubscriptionWorker({
    fetchSubscription: async () => {
      calendar.subscribed_url = 'https://calendar.example.test/new.ics';
      return Buffer.from(feed('Stale response'), 'utf8');
    },
  });
  assert.deepEqual(events, before);
  assert.equal(calendar.sync_token, beforeRevision);
  assert.equal(lastFetchError, null);
  calendar.subscribed_url = 'https://calendar.example.test/feed.ics';
});

test('the per-calendar database lease prevents overlapping workers from fetching twice', async () => {
  calendar.sync_token = 1;
  events.clear();
  eventRevisions.clear();
  tombstones.clear();
  feedBody = feed();
  let releaseFetch;
  let markFetchStarted;
  const fetchStarted = new Promise(resolve => { markFetchStarted = resolve; });
  const fetchRelease = new Promise(resolve => { releaseFetch = resolve; });
  let fetchCount = 0;
  const first = runSubscriptionWorker({
    fetchSubscription: async () => {
      fetchCount += 1;
      markFetchStarted();
      await fetchRelease;
      return Buffer.from(feedBody, 'utf8');
    },
  });
  await fetchStarted;
  await runSubscriptionWorker({
    fetchSubscription: async () => {
      fetchCount += 1;
      return Buffer.from(feedBody, 'utf8');
    },
  });
  assert.equal(fetchCount, 1);
  releaseFetch();
  await first;
  assert.equal(activeSubscriptionLocks.size, 0);
});

test('subscription failures redact full secret URLs from status and logs', async (t) => {
  calendar.subscribed_url = 'https://calendar.example.test/private/secret-token.ics?access=secret-token';
  const originalConsoleError = console.error;
  const logs = [];
  console.error = (...values) => logs.push(values.join(' '));
  t.after(() => {
    console.error = originalConsoleError;
    calendar.subscribed_url = 'https://calendar.example.test/feed.ics';
  });
  await runSubscriptionWorker({
    fetchSubscription: async url => { throw new Error(`fetch failed for ${url}`); },
  });
  assert.doesNotMatch(lastFetchError, /secret-token|access=/i);
  assert.doesNotMatch(logs.join('\n'), /secret-token|access=/i);
});

test('the run deadline stops additional subscription work', async () => {
  const { MAX_CALENDAR_SUBSCRIPTION_RUN_MS } = require('../src/calendar-subscription.js');
  let nowCall = 0;
  let fetchCount = 0;
  await runSubscriptionWorker({
    now: () => nowCall++ === 0 ? 0 : MAX_CALENDAR_SUBSCRIPTION_RUN_MS + 1,
    fetchSubscription: async () => {
      fetchCount += 1;
      return Buffer.from(feedBody, 'utf8');
    },
  });
  assert.equal(fetchCount, 0);
});

test('the run deadline also rolls back work that expires during database apply', async () => {
  const { MAX_CALENDAR_SUBSCRIPTION_RUN_MS } = require('../src/calendar-subscription.js');
  calendar.sync_token = 1;
  events.clear();
  eventRevisions.clear();
  tombstones.clear();
  feedBody = feed();
  fakeNow = 0;
  expireRunAfterStatementContaining = 'DELETE FROM calendar_tombstones';

  await runSubscriptionWorker({ now: () => fakeNow });

  assert.equal(events.size, 0);
  assert.equal(calendar.sync_token, 1);
  assert.match(lastFetchError, /run deadline/i);
  fakeNow = MAX_CALENDAR_SUBSCRIPTION_RUN_MS + 1;
});

test('a same-URL ABA replacement cannot commit an old response or status', async () => {
  calendar.sync_token = 1;
  calendar.subscribed_url = 'https://calendar.example.test/feed.ics';
  events.clear();
  eventRevisions.clear();
  tombstones.clear();
  lastFetchError = null;

  await runSubscriptionWorker({
    fetchSubscription: async () => {
      calendar.subscribed_url = 'https://calendar.example.test/replacement.ics';
      calendar.sync_token += 1;
      calendar.subscribed_url = 'https://calendar.example.test/feed.ics';
      calendar.sync_token += 1;
      return Buffer.from(feed('Stale ABA response'), 'utf8');
    },
  });

  assert.equal(events.size, 0);
  assert.equal(calendar.sync_token, 3);
  assert.equal(lastFetchError, null);
});

test('subscription selection prioritizes never-fetched and oldest feeds before calendar id', async () => {
  feedBody = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//OpenMailStack//Subscription Test//EN',
    'END:VCALENDAR',
  ].join('\r\n');
  await runSubscriptionWorker();
  assert.match(
    subscriptionSelectionSql,
    /ORDER BY \(last_fetched_at IS NOT NULL\) ASC, last_fetched_at ASC, id ASC/i,
  );
});

test('subscription event count is capped before database apply', async () => {
  calendar.sync_token = 1;
  events.clear();
  eventRevisions.clear();
  tombstones.clear();
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//OpenMailStack//Subscription Test//EN',
  ];
  for (let index = 0; index <= 1_000; index += 1) {
    lines.push(
      'BEGIN:VEVENT', `UID:event-${index}`, 'DTSTAMP:20260815T120000Z',
      'DTSTART:20260816T120000Z', 'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  feedBody = lines.join('\r\n');

  await runSubscriptionWorker();

  assert.equal(events.size, 0);
  assert.equal(calendar.sync_token, 1);
  assert.match(lastFetchError, /too many resources/i);
});
