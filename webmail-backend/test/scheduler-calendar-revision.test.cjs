const test = require('node:test');
const assert = require('node:assert/strict');

process.env.OMS_DB_PASSWORD ||= 'scheduler-calendar-revision-test';

const { SchedulerStore } = require('../src/scheduler/store.js');
const { validateICalendarDocument } = require('../src/calendar-ical-validation.js');

function schedulerIcal(uid = 'scheduler-event') {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//OpenMailStack//Scheduler test//EN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${uid}`,
    'DTSTAMP:20260815T120000Z',
    'DTSTART:20260816T120000Z',
    'DTEND:20260816T123000Z',
    'SUMMARY:Scheduler test',
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n');
}

function calendarConnection(calendarOverrides = {}) {
  const state = {
    calendar: {
      id: 7,
      user_id: 'scheduler-owner@example.test',
      dav_slug: 'personal',
      subscribed_url: null,
      ...calendarOverrides,
    },
    calendarRevision: 4,
    event: null,
    tombstones: new Map([
      ['scheduler-event', { uid: 'scheduler-event', syncToken: 3 }],
      ['old-href.ics', { uid: 'scheduler-event', syncToken: 2 }],
    ]),
  };

  return {
    state,
    async query(sql, params = []) {
      const compact = String(sql).replace(/\s+/g, ' ').trim();
      if (compact.startsWith('SELECT id, user_id, dav_slug, subscribed_url FROM calendars')) {
        return Number(params[0]) === state.calendar.id ? [[{ ...state.calendar }], []] : [[], []];
      }
      if (compact === 'SELECT id FROM calendars WHERE id = ? LIMIT 1 FOR UPDATE') {
        return [[{ id: Number(params[0]) }], []];
      }
      if (compact === 'SELECT sync_token FROM calendars WHERE id = ? LIMIT 1 FOR UPDATE') {
        return [[{ sync_token: state.calendarRevision }], []];
      }
      if (compact.startsWith('UPDATE calendars SET sync_token = ?')) {
        const [next, , expected] = params;
        if (Number(expected) !== state.calendarRevision) return [{ affectedRows: 0 }, []];
        state.calendarRevision = Number(next);
        return [{ affectedRows: 1 }, []];
      }
      if (compact.startsWith('SELECT ical_data, resource_name FROM events')) {
        return [state.event ? [{ ical_data: state.event.ical, resource_name: state.event.resourceName }] : [], []];
      }
      if (compact.startsWith('SELECT uid, resource_name FROM events')) {
        return [state.event ? [{ uid: state.event.uid, resource_name: state.event.resourceName }] : [], []];
      }
      if (compact.startsWith('DELETE FROM calendar_tombstones')) {
        const affectedRows = Number(state.tombstones.delete(String(params[1])));
        return [{ affectedRows }, []];
      }
      if (compact.startsWith('INSERT INTO events')) {
        state.event = {
          uid: params[1],
          resourceName: params[2],
          ical: params[3],
          syncToken: Number(params[4]),
        };
        return [{ affectedRows: 1 }, []];
      }
      if (compact.startsWith('UPDATE events SET ical_data')) {
        state.event = {
          uid: params[3],
          resourceName: state.event.resourceName,
          ical: params[0],
          syncToken: Number(params[1]),
        };
        return [{ affectedRows: 1 }, []];
      }
      if (compact.startsWith('DELETE FROM events')) {
        const affectedRows = state.event ? 1 : 0;
        state.event = null;
        return [{ affectedRows }, []];
      }
      if (compact.startsWith('INSERT INTO calendar_tombstones')) {
        state.tombstones.set(String(params[2]), { uid: params[1], syncToken: Number(params[3]) });
        return [{ affectedRows: 1 }, []];
      }
      throw new Error(`Unexpected Scheduler calendar query: ${compact}`);
    },
  };
}

test('Scheduler projects create, no-op, delete, and recreate onto exact collection revisions', async () => {
  const store = Object.create(SchedulerStore.prototype);
  const connection = calendarConnection();
  const publishIcal = schedulerIcal();

  assert.equal(
    await store.upsertCalendarEventOnConnection(
      connection, 7, 'scheduler-owner@example.test', 'scheduler-event', publishIcal,
    ),
    true,
  );
  assert.equal(connection.state.calendarRevision, 5);
  assert.deepEqual(connection.state.tombstones, new Map([
    ['old-href.ics', { uid: 'scheduler-event', syncToken: 2 }],
  ]));
  assert.equal(connection.state.event.uid, 'scheduler-event');
  assert.equal(connection.state.event.resourceName, 'scheduler-event');
  assert.equal(connection.state.event.syncToken, 5);
  assert.doesNotMatch(connection.state.event.ical, /^METHOD:/m);
  assert.equal(
    validateICalendarDocument(connection.state.event.ical, { mode: 'stored-resource' }).canonicalUid,
    'scheduler-event',
  );

  assert.equal(
    await store.upsertCalendarEventOnConnection(
      connection, 7, 'scheduler-owner@example.test', 'scheduler-event', publishIcal,
    ),
    false,
  );
  assert.equal(connection.state.calendarRevision, 5);

  assert.equal(await store.deleteCalendarEventOnConnection(connection, 7, 'scheduler-event'), true);
  assert.equal(connection.state.calendarRevision, 6);
  assert.equal(connection.state.event, null);
  assert.deepEqual(connection.state.tombstones, new Map([
    ['old-href.ics', { uid: 'scheduler-event', syncToken: 2 }],
    ['scheduler-event', { uid: 'scheduler-event', syncToken: 6 }],
  ]));

  assert.equal(
    await store.upsertCalendarEventOnConnection(
      connection, 7, 'scheduler-owner@example.test', 'scheduler-event', publishIcal,
    ),
    true,
  );
  assert.equal(connection.state.calendarRevision, 7);
  assert.equal(connection.state.event.resourceName, 'scheduler-event');
  assert.equal(connection.state.event.syncToken, 7);
  assert.deepEqual(connection.state.tombstones, new Map([
    ['old-href.ics', { uid: 'scheduler-event', syncToken: 2 }],
  ]));
});

test('Scheduler rechecks writable destination role under the projection transaction lock', async () => {
  const store = Object.create(SchedulerStore.prototype);
  const birthday = calendarConnection({ dav_slug: 'birthdays' });
  const subscribed = calendarConnection({ subscribed_url: 'https://calendar.example.test/feed.ics' });
  const wrongOwner = calendarConnection({ user_id: 'someone-else@example.test' });

  await assert.rejects(
    store.upsertCalendarEventOnConnection(
      birthday, 7, 'scheduler-owner@example.test', 'scheduler-event', schedulerIcal(),
    ),
    /writable Scheduler destination/i,
  );
  await assert.rejects(
    store.upsertCalendarEventOnConnection(
      subscribed, 7, 'scheduler-owner@example.test', 'scheduler-event', schedulerIcal(),
    ),
    /writable Scheduler destination/i,
  );
  await assert.rejects(
    store.upsertCalendarEventOnConnection(
      wrongOwner, 7, 'scheduler-owner@example.test', 'scheduler-event', schedulerIcal(),
    ),
    /writable Scheduler destination/i,
  );
  assert.equal(birthday.state.event, null);
  assert.equal(subscribed.state.event, null);
  assert.equal(wrongOwner.state.event, null);
});

test('Scheduler destination and default selection reject managed and subscribed calendars', async () => {
  const owner = 'scheduler-owner@example.test';
  const calendars = new Map([
    [7, { id: 7, user_id: owner, dav_slug: 'birthdays', subscribed_url: null }],
    [8, { id: 8, user_id: owner, dav_slug: 'feed', subscribed_url: 'https://calendar.example.test/feed.ics' }],
    [9, { id: 9, user_id: owner, dav_slug: 'personal', subscribed_url: null }],
  ]);
  const store = Object.create(SchedulerStore.prototype);
  store.pool = {
    async query(sql, params = []) {
      const compact = String(sql).replace(/\s+/g, ' ').trim();
      if (compact === 'SELECT * FROM calendars WHERE id = ? AND user_id = ? LIMIT 1') {
        const calendar = calendars.get(Number(params[0]));
        return [calendar && calendar.user_id === params[1] ? [{ ...calendar }] : [], []];
      }
      throw new Error(`Unexpected Scheduler destination query: ${compact}`);
    },
  };
  store.requireOwner = async () => ({
    username: owner,
    tenantKey: 'example.test',
    handle: 'owner',
    enabled: true,
    published: true,
    displayName: 'Owner',
    welcomeMessage: '',
    timeZone: 'UTC',
    defaultCalendarId: null,
    notificationFrom: owner,
  });

  for (const calendarId of [7, 8]) {
    await assert.rejects(
      store.updateProfile(owner, { defaultCalendarId: calendarId }),
      /writable Scheduler destination/i,
    );
    await assert.rejects(
      store.saveEventType(owner, {
        title: 'Selection regression',
        slug: 'selection-regression',
        durationMinutes: 30,
        intervalMinutes: 30,
        destinationCalendarId: calendarId,
        conflictCalendarIds: [7, 8],
        availabilityScheduleId: '00000000-0000-4000-8000-000000000001',
        windows: [{ weekday: 1, startMinute: 540, endMinute: 600 }],
      }),
      /writable Scheduler destination/i,
    );
  }

  assert.equal((await store.assertWritableCalendarOwnership(owner, 9)).id, 9);
  assert.equal((await store.assertCalendarOwnership(owner, 7)).id, 7);
  assert.equal((await store.assertCalendarOwnership(owner, 8)).id, 8);

  store.assertScheduleOwnership = async () => {
    throw new Error('Reached availability validation after readable conflict calendars');
  };
  await assert.rejects(
    store.saveEventType(owner, {
      title: 'Readable conflicts',
      slug: 'readable-conflicts',
      durationMinutes: 30,
      intervalMinutes: 30,
      destinationCalendarId: 9,
      conflictCalendarIds: [7, 8],
      availabilityScheduleId: '00000000-0000-4000-8000-000000000001',
      windows: [{ weekday: 1, startMinute: 540, endMinute: 600 }],
    }),
    /reached availability validation after readable conflict calendars/i,
  );
});
