const test = require('node:test');
const assert = require('node:assert/strict');

const {
  expandRecurringEvent,
  extractIcalEventUid,
  formatActiveSyncDate,
  getCalendarFolderSyncKey,
  parseIcalEvent,
  slugifyCalendarName,
} = require('../src/calendar-format.js');

test('extractIcalEventUid preserves the complete VEVENT identity', () => {
  assert.equal(extractIcalEventUid([
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    'UID:  byte-for-byte  ',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n')), '  byte-for-byte  ');
});

test('parseIcalEvent unfolds and unescapes event fields', () => {
  const parsed = parseIcalEvent('fallback', [
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    'UID:event-1',
    'SUMMARY:Family\\, dinner',
    'LOCATION:Home',
    'DESCRIPTION:Line one\\n line two',
    'DTSTART:20260704T190000Z',
    'DTEND:20260704T200000Z',
    'DTSTAMP:20260621T130000Z',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n'));

  assert.equal(parsed.uid, 'event-1');
  assert.equal(parsed.title, 'Family, dinner');
  assert.equal(parsed.location, 'Home');
  assert.equal(parsed.description, 'Line one\n line two');
  assert.equal(parsed.start.toISOString(), '2026-07-04T19:00:00.000Z');
  assert.equal(parsed.end.toISOString(), '2026-07-04T20:00:00.000Z');
  assert.equal(parsed.isAllDay, false);
  assert.equal(parsed.timeKind, 'utc');
  assert.equal(parsed.timeZone, 'UTC');
});

test('parseIcalEvent preserves floating wall time without treating it as UTC', () => {
  const parsed = parseIcalEvent('floating', [
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    'SUMMARY:Floating appointment',
    'DTSTART:20260724T160000',
    'DTEND:20260724T170000',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n'));

  assert.equal(parsed.start.toISOString(), '2026-07-24T16:00:00.000Z');
  assert.equal(parsed.end.toISOString(), '2026-07-24T17:00:00.000Z');
  assert.equal(parsed.timeKind, 'floating');
  assert.equal(parsed.timeZone, null);
});

test('parseIcalEvent handles all-day events', () => {
  const parsed = parseIcalEvent('all-day', [
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    'SUMMARY:Holiday',
    'DTSTART;VALUE=DATE:20261225',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\n'));

  assert.equal(parsed.uid, 'all-day');
  assert.equal(parsed.start.toISOString(), '2026-12-25T00:00:00.000Z');
  assert.equal(parsed.end.toISOString(), '2026-12-26T00:00:00.000Z');
  assert.equal(parsed.isAllDay, true);
  assert.equal(parsed.timeKind, 'all-day');
  assert.equal(parsed.timeZone, null);
});

test('parseIcalEvent reads simple recurrence rules', () => {
  const parsed = parseIcalEvent('recurring', [
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    'UID:standup',
    'SUMMARY:Standup',
    'DTSTART:20260706T160000Z',
    'DTEND:20260706T163000Z',
    'RRULE:FREQ=WEEKLY;INTERVAL=2;COUNT=3',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n'));

  assert.equal(parsed.recurrence.raw, 'FREQ=WEEKLY;INTERVAL=2;COUNT=3');
  assert.equal(parsed.recurrence.frequency, 'WEEKLY');
  assert.equal(parsed.recurrence.interval, 2);
  assert.equal(parsed.recurrence.count, 3);
  assert.equal(parsed.recurrenceLabel, 'Every 2 weeks');
});

test('expandRecurringEvent expands bounded recurring occurrences', () => {
  const parsed = parseIcalEvent('recurring', [
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    'UID:standup',
    'SUMMARY:Standup',
    'DTSTART:20260706T160000Z',
    'DTEND:20260706T163000Z',
    'RRULE:FREQ=WEEKLY;COUNT=3',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n'));

  const occurrences = expandRecurringEvent(
    parsed,
    new Date('2026-07-01T00:00:00Z'),
    new Date('2026-07-31T23:59:59Z')
  );

  assert.deepEqual(
    occurrences.map((event) => event.start.toISOString()),
    [
      '2026-07-06T16:00:00.000Z',
      '2026-07-13T16:00:00.000Z',
      '2026-07-20T16:00:00.000Z',
    ]
  );
  assert.equal(occurrences[0].occurrenceId, '20260706T160000Z');
});

test('expandRecurringEvent keeps zoned weekly events at the same wall time across DST', () => {
  const parsed = parseIcalEvent('dst-recurring', [
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    'SUMMARY:Weekly review',
    'DTSTART;TZID=America/New_York:20260301T090000',
    'DTEND;TZID=America/New_York:20260301T100000',
    'RRULE:FREQ=WEEKLY;COUNT=3',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n'));

  const occurrences = expandRecurringEvent(
    parsed,
    new Date('2026-03-01T00:00:00Z'),
    new Date('2026-03-31T23:59:59Z')
  );

  assert.deepEqual(
    occurrences.map((event) => event.start.toISOString()),
    [
      '2026-03-01T14:00:00.000Z',
      '2026-03-08T13:00:00.000Z',
      '2026-03-15T13:00:00.000Z',
    ]
  );
});

test('parseIcalEvent follows RFC 5545 for DST gaps and preserves a positive duration', () => {
  const parsed = parseIcalEvent('dst-gap', [
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    'SUMMARY:Spring gap',
    'DTSTART;TZID=America/New_York:20260308T023000',
    'DTEND;TZID=America/New_York:20260308T033000',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n'));

  assert.equal(parsed.start.toISOString(), '2026-03-08T07:30:00.000Z');
  assert.equal(parsed.end.toISOString(), '2026-03-08T08:30:00.000Z');
});

test('parseIcalEvent chooses the first occurrence of an ambiguous DST wall time', () => {
  const parsed = parseIcalEvent('dst-overlap', [
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    'SUMMARY:Fall overlap',
    'DTSTART;TZID=America/New_York:20261101T013000',
    'DTEND;TZID=America/New_York:20261101T023000',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n'));

  assert.equal(parsed.start.toISOString(), '2026-11-01T05:30:00.000Z');
  assert.equal(parsed.end.toISOString(), '2026-11-01T07:30:00.000Z');
});

test('parseIcalEvent ignores VTIMEZONE fields before VEVENT', () => {
  const parsed = parseIcalEvent('apple-event', [
    'BEGIN:VCALENDAR',
    'CALSCALE:GREGORIAN',
    'PRODID:-//Apple Inc.//macOS 26.5.1//EN',
    'VERSION:2.0',
    'BEGIN:VTIMEZONE',
    'TZID:Asia/Baghdad',
    'BEGIN:STANDARD',
    'DTSTART:19911001T040000',
    'RDATE:19911001T040000',
    'TZNAME:GMT+3',
    'TZOFFSETFROM:+0400',
    'TZOFFSETTO:+0300',
    'END:STANDARD',
    'END:VTIMEZONE',
    'BEGIN:VEVENT',
    'CREATED:20260621T151122Z',
    'DTEND;TZID=Asia/Baghdad:20260624T100000',
    'DTSTAMP:20260621T151127Z',
    'DTSTART;TZID=Asia/Baghdad:20260624T090000',
    'SUMMARY:iCAL Test',
    'UID:A0A0BEE8-BD0B-4F7E-8E2B-AA2A3EA5DB78',
    'BEGIN:VALARM',
    'DESCRIPTION:Alarm text should not become the event description',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n'));

  assert.equal(parsed.uid, 'A0A0BEE8-BD0B-4F7E-8E2B-AA2A3EA5DB78');
  assert.equal(parsed.title, 'iCAL Test');
  assert.equal(parsed.start.toISOString(), '2026-06-24T06:00:00.000Z');
  assert.equal(parsed.end.toISOString(), '2026-06-24T07:00:00.000Z');
  assert.equal(parsed.timeKind, 'zoned');
  assert.equal(parsed.timeZone, 'Asia/Baghdad');
  assert.equal(parsed.description, '');
});

test('formatActiveSyncDate uses compact ActiveSync calendar UTC timestamp shape', () => {
  assert.equal(formatActiveSyncDate(new Date('2026-07-04T19:00:00.123Z')), '20260704T190000Z');
});

test('folder sync key is stable across folder ordering and changes when calendars change', () => {
  const base = [
    { serverId: 'INBOX', displayName: 'Inbox', type: '2' },
    { serverId: 'cal-1', displayName: 'Personal', type: '8' },
  ];
  const reordered = [...base].reverse();
  const addedCalendar = [...base, { serverId: 'cal-2', displayName: 'Family', type: '8' }];

  assert.equal(getCalendarFolderSyncKey(base), getCalendarFolderSyncKey(reordered));
  assert.notEqual(getCalendarFolderSyncKey(base), getCalendarFolderSyncKey(addedCalendar));
});

test('slugifyCalendarName produces DAV-safe slugs', () => {
  assert.equal(slugifyCalendarName('Family Calendar!'), 'family-calendar');
  assert.equal(slugifyCalendarName('   '), 'calendar');
});
