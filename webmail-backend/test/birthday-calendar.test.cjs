const assert = require('node:assert/strict');
const test = require('node:test');

process.env.OMS_DB_PASSWORD ||= 'birthday-calendar-test';

const {
  birthdayEventUid,
  escapeIcalText,
  isManagedBirthdayCalendar,
  legacyBirthdayEventUid,
  repairAllBirthdayCalendarProjections,
  repairBirthdayCalendarProjection,
  syncContactBirthdayEvent,
} = require('../src/birthday-calendar.js');

function installBirthdayStore() {
  const state = {
    calendar: null,
    events: new Map(),
    resourceNames: new Map(),
    eventRevisions: new Map(),
    tombstones: new Map(),
    calendarTokenBumps: 0,
  };
  const calls = [];
  const connection = {
    async query(sql, params = []) {
      const compact = String(sql).replace(/\s+/g, ' ').trim();
      calls.push([compact, params]);
      if (compact.startsWith('SELECT id FROM calendars')) {
        return [state.calendar ? [{ id: state.calendar.id, sync_token: state.calendar.syncToken }] : [], []];
      }
      if (compact.startsWith('INSERT INTO calendars')) {
        state.calendar = { id: 9, syncToken: 0 };
        return [{ insertId: 9, affectedRows: 1 }, []];
      }
      if (compact.startsWith('SELECT uid, resource_name, ical_data FROM events')) {
        const requested = new Set(params.slice(1));
        return [[...state.events]
          .filter(([uid]) => requested.has(uid))
          .map(([uid, ical_data]) => ({
            uid,
            resource_name: state.resourceNames.get(uid) || uid,
            ical_data,
          })), []];
      }
      if (compact.startsWith('SELECT sync_token FROM calendars')) {
        return [[{ sync_token: state.calendar.syncToken }], []];
      }
      if (compact.startsWith('DELETE FROM events WHERE calendar_id=? AND uid IN')) {
        let deleted = 0;
        for (const uid of params.slice(1)) {
          if (state.events.delete(uid)) {
            state.resourceNames.delete(uid);
            state.eventRevisions.delete(uid);
            deleted += 1;
          }
        }
        return [{ affectedRows: deleted }, []];
      }
      if (compact.startsWith('INSERT INTO events')) {
        const [calendarId, uid, resourceName, ical, revision = 1] = params;
        assert.equal(calendarId, state.calendar.id);
        const previous = state.events.get(uid);
        state.resourceNames.set(uid, resourceName);
        state.events.set(uid, ical);
        state.eventRevisions.set(uid, revision);
        return [{ affectedRows: previous === undefined ? 1 : previous === ical ? 0 : 2 }, []];
      }
      if (compact.startsWith('INSERT INTO calendar_tombstones')) {
        const [calendarId, , resourceName, revision] = params;
        assert.equal(calendarId, state.calendar.id);
        state.tombstones.set(resourceName, revision);
        return [{ affectedRows: 1 }, []];
      }
      if (compact.startsWith('DELETE FROM calendar_tombstones')) {
        const [, uid] = params;
        return [{ affectedRows: Number(state.tombstones.delete(uid)) }, []];
      }
      if (compact.startsWith('UPDATE calendars SET sync_token = ?')) {
        const [nextRevision, calendarId, currentRevision] = params;
        assert.equal(calendarId, state.calendar.id);
        if (state.calendar.syncToken !== currentRevision) return [{ affectedRows: 0 }, []];
        state.calendar.syncToken = nextRevision;
        state.calendarTokenBumps += 1;
        return [{ affectedRows: 1 }, []];
      }
      if (compact.startsWith('UPDATE calendars SET sync_token=sync_token+1')) {
        state.calendar.syncToken += 1;
        state.calendarTokenBumps += 1;
        return [{ affectedRows: 1 }, []];
      }
      throw new Error(`Unexpected birthday query: ${compact}`);
    },
  };
  return { state, calls, connection };
}

function installBirthdayRepairDatabase({ contacts, calendar }) {
  const state = {
    calendar: calendar ? { ...calendar } : null,
    contacts: contacts.map(contact => ({ ...contact })),
    events: new Map(),
    resourceNames: new Map(),
    eventRevisions: new Map(),
    tombstones: new Map(),
    calendarTokenBumps: 0,
    commits: 0,
    rollbacks: 0,
  };
  const connection = {
    async beginTransaction() {},
    async commit() { state.commits += 1; },
    async rollback() { state.rollbacks += 1; },
    release() {},
    async query(sql, params = []) {
      const compact = String(sql).replace(/\s+/g, ' ').trim();
      if (compact.startsWith('SELECT id, dav_uid, name, email, birthday FROM contacts')) {
        return [state.contacts
          .filter(contact => !contact.deleted && contact.username === params[0])
          .sort((left, right) => left.id - right.id)
          .map(({ id, dav_uid, name, email, birthday }) => ({ id, dav_uid, name, email, birthday })), []];
      }
      if (compact === "SELECT id FROM calendars WHERE user_id = ? AND dav_slug = 'birthdays' LIMIT 1 FOR UPDATE") {
        return [state.calendar ? [{ id: state.calendar.id }] : [], []];
      }
      if (compact.startsWith('INSERT INTO calendars')) {
        state.calendar = { id: 9, syncToken: 0 };
        return [{ insertId: 9, affectedRows: 1 }, []];
      }
      if (compact === 'SELECT uid, resource_name, ical_data FROM events WHERE calendar_id = ? ORDER BY uid ASC FOR UPDATE') {
        return [[...state.events].map(([uid, ical_data]) => ({
          uid,
          resource_name: state.resourceNames.get(uid) || uid,
          ical_data,
        })), []];
      }
      if (compact === 'SELECT uid, resource_name FROM calendar_tombstones WHERE calendar_id = ? FOR UPDATE') {
        return [[...state.tombstones.keys()].map(resource_name => ({
          uid: resource_name,
          resource_name,
        })), []];
      }
      if (compact === 'SELECT sync_token FROM calendars WHERE id = ? LIMIT 1 FOR UPDATE') {
        return [[{ sync_token: state.calendar.syncToken }], []];
      }
      if (compact === 'UPDATE calendars SET sync_token = ? WHERE id = ? AND sync_token = ?') {
        const [nextRevision, calendarId, currentRevision] = params;
        assert.equal(calendarId, state.calendar.id);
        if (currentRevision !== state.calendar.syncToken) return [{ affectedRows: 0 }, []];
        state.calendar.syncToken = nextRevision;
        state.calendarTokenBumps += 1;
        return [{ affectedRows: 1 }, []];
      }
      if (compact.startsWith('DELETE FROM events WHERE calendar_id = ? AND uid IN')) {
        for (const uid of params.slice(1)) {
          state.events.delete(uid);
          state.resourceNames.delete(uid);
          state.eventRevisions.delete(uid);
        }
        return [{ affectedRows: params.length - 1 }, []];
      }
      if (compact.startsWith('DELETE FROM calendar_tombstones WHERE calendar_id = ? AND resource_name IN')) {
        let removed = 0;
        for (const uid of params.slice(1)) removed += Number(state.tombstones.delete(uid));
        return [{ affectedRows: removed }, []];
      }
      if (compact.startsWith('INSERT INTO calendar_tombstones')) {
        state.tombstones.set(params[2], Number(params[3]));
        return [{ affectedRows: 1 }, []];
      }
      if (compact.startsWith('INSERT INTO events')) {
        state.resourceNames.set(params[1], params[2]);
        state.events.set(params[1], params[3]);
        state.eventRevisions.set(params[1], Number(params[4]));
        return [{ affectedRows: 1 }, []];
      }
      throw new Error(`Unexpected birthday repair query: ${compact}`);
    },
  };
  const db = require('../src/db.js');
  db.pool.getConnection = async () => connection;
  return state;
}

test('managed Birthdays identity is reserved by DAV slug rather than display name', () => {
  assert.equal(isManagedBirthdayCalendar({ dav_slug: 'birthdays', name: 'Renamed' }), true);
  assert.equal(isManagedBirthdayCalendar({ dav_slug: 'Birthdays', name: 'Renamed' }), true);
  assert.equal(isManagedBirthdayCalendar({ dav_slug: 'family-birthdays', name: 'Birthdays' }), false);
  assert.equal(isManagedBirthdayCalendar({ dav_slug: null, name: 'Birthdays' }), false);
});

test('birthday identity is derived from immutable contact identity and SUMMARY is RFC5545-safe', async () => {
  const store = installBirthdayStore();
  const identity = {
    contactId: 7,
    davUid: '5bc5eaba-b433-4ed1-a4dd-e54790799f4b',
    name: 'Comma, Semi; Slash\\ New\nLine',
    email: 'first@example.test',
  };
  const uid = birthdayEventUid('Owner@Example.test', identity);

  await syncContactBirthdayEvent(store.connection, 'Owner@Example.test', identity, '1990-01-02');

  assert.match(uid, /^birthday-[0-9a-f]{48}@openmailstack$/);
  assert.equal(store.state.events.size, 1);
  const ical = store.state.events.get(uid);
  assert.match(ical, new RegExp(`^UID:${uid}$`, 'm'));
  assert.match(ical, /^DTSTAMP:20000101T000000Z$/m);
  assert.match(ical, /^DTSTART;VALUE=DATE:20000102$/m);
  assert.doesNotMatch(ical, /^DTEND/m);
  assert.match(ical, /^SUMMARY:Comma\\, Semi\\; Slash\\\\ New\\nLine's Birthday$/m);
  assert.equal(ical.split('\r\n').filter(line => line.startsWith('SUMMARY:')).length, 1);
  assert.equal(store.state.calendarTokenBumps, 1);
  const insertCall = store.calls.find(([sql]) => sql.startsWith('INSERT INTO events'));
  assert.equal(insertCall[1][2], uid);
  assert.equal(insertCall[1][4], store.state.calendar.syncToken);
  assert.equal(
    birthdayEventUid('owner@example.test', { ...identity, name: 'Renamed', email: 'renamed@example.test' }),
    uid,
  );
  assert.equal(escapeIcalText('a,b;c\\d\r\ne'), 'a\\,b\\;c\\\\d\\ne');
});

test('leap-day birthdays use a valid recurring anchor and no zero-duration DTEND', async () => {
  const store = installBirthdayStore();
  const identity = {
    contactId: 29,
    davUid: 'leap-day-dav-uid',
    name: 'Leap Day',
    email: 'leap@example.test',
  };

  await syncContactBirthdayEvent(store.connection, 'owner@example.test', identity, '1988-02-29');

  const ical = [...store.state.events.values()][0];
  assert.match(ical, /^DTSTART;VALUE=DATE:20000229$/m);
  assert.doesNotMatch(ical, /^DTEND/m);
  assert.match(ical, /^RRULE:FREQ=YEARLY$/m);
});

test('birthday edits atomically migrate old and new mutable legacy UIDs to one canonical UID', async () => {
  const store = installBirthdayStore();
  const previous = {
    contactId: 7,
    davUid: 'stable-dav-uid',
    name: 'Old Name',
    email: 'old@example.test',
  };
  const current = {
    ...previous,
    name: 'New Name',
    email: 'new@example.test',
  };
  await syncContactBirthdayEvent(store.connection, 'owner@example.test', previous, '1990-01-02');
  const canonicalUid = birthdayEventUid('owner@example.test', previous);
  const oldLegacyUid = legacyBirthdayEventUid(previous);
  const newLegacyUid = legacyBirthdayEventUid(current);
  store.state.events.set(oldLegacyUid, 'legacy old');
  store.state.events.set(newLegacyUid, 'legacy new');
  const bumpBeforeEdit = store.state.calendarTokenBumps;

  await syncContactBirthdayEvent(
    store.connection,
    'owner@example.test',
    current,
    '1990-01-02',
    [previous, current],
  );

  assert.deepEqual([...store.state.events.keys()], [canonicalUid]);
  assert.match(store.state.events.get(canonicalUid), /^SUMMARY:New Name's Birthday$/m);
  assert.equal(store.state.calendarTokenBumps, bumpBeforeEdit + 1);

  const deleteCall = store.calls.find(([sql, params]) => (
    sql.startsWith('DELETE FROM events')
    && params.includes(oldLegacyUid)
    && params.includes(newLegacyUid)
  ));
  assert.ok(deleteCall, 'legacy cleanup must use the same supplied transaction connection');
});

test('assigning a dav_uid removes the prior contact-id-derived canonical birthday UID', async () => {
  const store = installBirthdayStore();
  const previous = {
    contactId: 7,
    davUid: null,
    name: 'Identity Upgrade',
    email: 'identity@example.test',
  };
  const current = { ...previous, davUid: 'assigned-dav-uid' };
  await syncContactBirthdayEvent(store.connection, 'owner@example.test', previous, '1990-01-02');
  const previousCanonicalUid = birthdayEventUid('owner@example.test', previous);
  const currentCanonicalUid = birthdayEventUid('owner@example.test', current);
  assert.notEqual(previousCanonicalUid, currentCanonicalUid);

  await syncContactBirthdayEvent(
    store.connection,
    'owner@example.test',
    current,
    '1990-01-02',
    [previous, current],
  );

  assert.deepEqual([...store.state.events.keys()], [currentCanonicalUid]);
});

test('birthday clear and contact delete identities remove canonical and legacy events without creating empty calendars', async () => {
  const emptyStore = installBirthdayStore();
  const identity = {
    contactId: 7,
    davUid: 'stable-dav-uid',
    name: 'Delete Me',
    email: 'delete@example.test',
  };
  await syncContactBirthdayEvent(emptyStore.connection, 'owner@example.test', identity, null, [identity]);
  assert.equal(emptyStore.state.calendar, null);
  assert.equal(emptyStore.calls.some(([sql]) => sql.startsWith('INSERT INTO calendars')), false);

  const store = installBirthdayStore();
  await syncContactBirthdayEvent(store.connection, 'owner@example.test', identity, '1990-01-02');
  store.state.events.set(legacyBirthdayEventUid(identity), 'legacy');
  await syncContactBirthdayEvent(store.connection, 'owner@example.test', identity, null, [identity]);

  assert.equal(store.state.events.size, 0);
  assert.equal(store.state.calendarTokenBumps, 2);
  const canonicalUid = birthdayEventUid('owner@example.test', identity);
  assert.equal(store.state.tombstones.get(canonicalUid), store.state.calendar.syncToken);
  assert.equal(store.state.tombstones.get(legacyBirthdayEventUid(identity)), store.state.calendar.syncToken);
});

test('an unchanged canonical birthday is a no-op for the calendar sync token', async () => {
  const store = installBirthdayStore();
  const identity = {
    contactId: 8,
    davUid: 'stable-noop-dav-uid',
    name: 'No Op',
    email: 'noop@example.test',
  };
  await syncContactBirthdayEvent(store.connection, 'owner@example.test', identity, '1990-01-02');
  await syncContactBirthdayEvent(store.connection, 'owner@example.test', identity, '1990-01-02', [identity]);
  assert.equal(store.state.calendarTokenBumps, 1);
});

test('an unchanged canonical birthday clears a stale tombstone at a fresh collection revision', async () => {
  const store = installBirthdayStore();
  const identity = {
    contactId: 9,
    davUid: 'stale-tombstone-dav-uid',
    name: 'Visible Birthday',
    email: 'visible@example.test',
  };
  await syncContactBirthdayEvent(store.connection, 'owner@example.test', identity, '1990-01-02');
  const canonicalUid = birthdayEventUid('owner@example.test', identity);
  const originalRevision = store.state.eventRevisions.get(canonicalUid);
  store.state.tombstones.set(canonicalUid, originalRevision);
  store.state.tombstones.set('old-birthday-href.ics', originalRevision);

  await syncContactBirthdayEvent(store.connection, 'owner@example.test', identity, '1990-01-02', [identity]);

  assert.equal(store.state.tombstones.has(canonicalUid), false);
  assert.equal(store.state.tombstones.get('old-birthday-href.ics'), originalRevision);
  assert.equal(store.state.calendarTokenBumps, 2);
  assert.equal(store.state.eventRevisions.get(canonicalUid), store.state.calendar.syncToken);
  assert.ok(store.state.eventRevisions.get(canonicalUid) > originalRevision);
});

test('full birthday repair rebuilds every live projection at one revision and is idempotent', async () => {
  const user = 'owner@example.test';
  const ada = { id: 1, username: user, dav_uid: 'ada-uid', name: 'Ada', email: 'ada@example.test', birthday: '1815-12-10' };
  const grace = { id: 2, username: user, dav_uid: 'grace-uid', name: 'Grace', email: 'grace@example.test', birthday: '1906-12-09' };
  const deleted = { id: 3, username: user, dav_uid: 'deleted-uid', name: 'Deleted', email: '', birthday: '1990-01-01', deleted: true };
  const state = installBirthdayRepairDatabase({
    contacts: [ada, grace, deleted],
    calendar: { id: 9, syncToken: 5 },
  });
  const adaUid = birthdayEventUid(user, { contactId: ada.id, davUid: ada.dav_uid, name: ada.name, email: ada.email });
  const graceUid = birthdayEventUid(user, { contactId: grace.id, davUid: grace.dav_uid, name: grace.name, email: grace.email });
  const deletedUid = birthdayEventUid(user, { contactId: deleted.id, davUid: deleted.dav_uid, name: deleted.name, email: deleted.email });
  state.events.set(adaUid, 'stale Ada projection');
  state.eventRevisions.set(adaUid, 3);
  state.events.set(deletedUid, 'orphaned generated projection');
  state.eventRevisions.set(deletedUid, 4);
  state.events.set('ordinary-user-event', 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:ordinary-user-event\r\nEND:VEVENT\r\nEND:VCALENDAR');
  state.eventRevisions.set('ordinary-user-event', 2);
  state.tombstones.set(graceUid, 5);

  assert.equal(await repairBirthdayCalendarProjection(user), true);

  assert.deepEqual([...state.events.keys()].sort(), [adaUid, graceUid, 'ordinary-user-event'].sort());
  assert.match(state.events.get(adaUid), /^SUMMARY:Ada's Birthday$/m);
  assert.match(state.events.get(graceUid), /^SUMMARY:Grace's Birthday$/m);
  assert.equal(state.eventRevisions.get(adaUid), 6);
  assert.equal(state.eventRevisions.get(graceUid), 6);
  assert.equal(state.eventRevisions.get('ordinary-user-event'), 2);
  assert.equal(state.tombstones.has(graceUid), false);
  assert.equal(state.tombstones.get(deletedUid), 6);
  assert.equal(state.calendar.syncToken, 6);
  assert.equal(state.calendarTokenBumps, 1);
  assert.equal(state.commits, 1);

  assert.equal(await repairBirthdayCalendarProjection(user), false);
  assert.equal(state.calendar.syncToken, 6);
  assert.equal(state.calendarTokenBumps, 1);
  assert.equal(state.commits, 1);
  assert.equal(state.rollbacks, 1);
});

test('startup birthday repair checks live-contact owners and existing managed calendar owners', async () => {
  const checkedUsers = [];
  const transaction = { begins: 0, commits: 0, rollbacks: 0, releases: 0 };
  const db = require('../src/db.js');
  db.pool.getConnection = async () => ({
    async beginTransaction() { transaction.begins += 1; },
    async commit() { transaction.commits += 1; },
    async rollback() { transaction.rollbacks += 1; },
    release() { transaction.releases += 1; },
    async query(sql, params = []) {
      const compact = String(sql).replace(/\s+/g, ' ').trim();
      if (/FROM contacts .* UNION .* dav_slug = 'birthdays'/.test(compact)) {
        return [[{ username: 'contacts@example.test' }, { username: 'calendar@example.test' }], []];
      }
      if (compact.startsWith('SELECT id, dav_uid, name, email, birthday FROM contacts')) {
        checkedUsers.push(params[0]);
        return [[], []];
      }
      if (compact === "SELECT id FROM calendars WHERE user_id = ? AND dav_slug = 'birthdays' LIMIT 1 FOR UPDATE") {
        return [[], []];
      }
      throw new Error(`Unexpected startup birthday repair query: ${compact}`);
    },
  });

  assert.deepEqual(await repairAllBirthdayCalendarProjections(), {
    usersChecked: 2,
    usersChanged: 0,
  });
  assert.deepEqual(checkedUsers, ['contacts@example.test', 'calendar@example.test']);
  assert.deepEqual(transaction, { begins: 1, commits: 0, rollbacks: 1, releases: 1 });
});

test('all-user birthday repair rolls back earlier user changes when a later user is invalid', async () => {
  const db = require('../src/db.js');
  const transaction = { begins: 0, commits: 0, rollbacks: 0, releases: 0 };
  const checkedUsers = [];
  const stagedMutations = [];
  let calendarExists = false;
  let calendarToken = 0;

  db.pool.getConnection = async () => ({
    async beginTransaction() { transaction.begins += 1; },
    async commit() { transaction.commits += 1; },
    async rollback() {
      transaction.rollbacks += 1;
      stagedMutations.length = 0;
      calendarExists = false;
      calendarToken = 0;
    },
    release() { transaction.releases += 1; },
    async query(sql, params = []) {
      const compact = String(sql).replace(/\s+/g, ' ').trim();
      if (/FROM contacts .* UNION .* dav_slug = 'birthdays'/.test(compact)) {
        return [[{ username: 'first@example.test' }, { username: 'later@example.test' }], []];
      }
      if (compact.startsWith('SELECT id, dav_uid, name, email, birthday FROM contacts')) {
        checkedUsers.push(params[0]);
        if (params[0] === 'first@example.test') {
          return [[{
            id: 1,
            dav_uid: 'first-dav-uid',
            name: 'First User',
            email: 'first@example.test',
            birthday: '1990-01-02',
          }], []];
        }
        return [[{
          id: 2,
          dav_uid: 'later-dav-uid',
          name: 'Later User',
          email: 'later@example.test',
          birthday: 'not-a-birthday',
        }], []];
      }
      if (compact === "SELECT id FROM calendars WHERE user_id = ? AND dav_slug = 'birthdays' LIMIT 1 FOR UPDATE") {
        return [calendarExists ? [{ id: 9 }] : [], []];
      }
      if (compact.startsWith('INSERT INTO calendars')) {
        calendarExists = true;
        stagedMutations.push('calendar:first@example.test');
        return [{ insertId: 9, affectedRows: 1 }, []];
      }
      if (compact === 'SELECT uid, resource_name, ical_data FROM events WHERE calendar_id = ? ORDER BY uid ASC FOR UPDATE') {
        return [[], []];
      }
      if (compact === 'SELECT uid, resource_name FROM calendar_tombstones WHERE calendar_id = ? FOR UPDATE') {
        return [[], []];
      }
      if (compact === 'SELECT sync_token FROM calendars WHERE id = ? LIMIT 1 FOR UPDATE') {
        return [[{ sync_token: calendarToken }], []];
      }
      if (compact === 'UPDATE calendars SET sync_token = ? WHERE id = ? AND sync_token = ?') {
        calendarToken = Number(params[0]);
        stagedMutations.push('revision:first@example.test');
        return [{ affectedRows: 1 }, []];
      }
      if (compact.startsWith('INSERT INTO events')) {
        stagedMutations.push('event:first@example.test');
        return [{ affectedRows: 1 }, []];
      }
      throw new Error(`Unexpected atomic birthday repair query: ${compact}`);
    },
  });

  await assert.rejects(
    () => repairAllBirthdayCalendarProjections(),
    /contact 2 has an invalid birthday/,
  );
  assert.deepEqual(checkedUsers, ['first@example.test', 'later@example.test']);
  assert.deepEqual(stagedMutations, []);
  assert.deepEqual(transaction, { begins: 1, commits: 0, rollbacks: 1, releases: 1 });
});
