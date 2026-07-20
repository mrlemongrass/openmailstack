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

test('parseIcalEvent reads a nested display VALARM without leaking alarm fields', () => {
  const parsed = parseIcalEvent('reminder', [
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    'UID:reminder',
    'SUMMARY:Call home',
    'DESCRIPTION:Event description',
    'DTSTART:20260724T170000Z',
    'DTEND:20260724T180000Z',
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    'TRIGGER:-PT15M',
    'DESCRIPTION:Reminder text',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n'));

  assert.deepEqual(parsed.notifications, [{ id: 1, type: 'notification', time: 15 }]);
  assert.equal(parsed.description, 'Event description');
});

test('parseIcalEvent preserves external at-start display alarms', () => {
  for (const trigger of ['PT0M', 'PT0S']) {
    const parsed = parseIcalEvent(`at-start-${trigger}`, [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      `UID:at-start-${trigger}`,
      'SUMMARY:Start now',
      'DTSTART:20260724T170000Z',
      'DTEND:20260724T180000Z',
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `TRIGGER:${trigger}`,
      'END:VALARM',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n'));

    assert.deepEqual(parsed.notifications, [{ id: 1, type: 'notification', time: 0 }]);
  }
});

test('parseIcalEvent preserves RFC week-form display alarms', () => {
  const parsed = parseIcalEvent('week-reminder', [
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    'UID:week-reminder',
    'DTSTART:20260724T170000Z',
    'DTEND:20260724T180000Z',
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    'TRIGGER:-P1W',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n'));

  assert.deepEqual(parsed.notifications, [{ id: 1, type: 'notification', time: 10080 }]);
});

test('expandRecurringEvent applies deleted and modified recurrence exceptions', () => {
  const parsed = parseIcalEvent('exception-series', [
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    'UID:exception-series',
    'SUMMARY:Weekly planning',
    'DTSTART:20260703T170000Z',
    'DTEND:20260703T180000Z',
    'RRULE:FREQ=WEEKLY;COUNT=4',
    'EXDATE:20260710T170000Z',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:exception-series',
    'RECURRENCE-ID:20260717T170000Z',
    'SUMMARY:Moved planning',
    'DTSTART:20260717T190000Z',
    'DTEND:20260717T200000Z',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n'));

  const occurrences = expandRecurringEvent(
    parsed,
    new Date('2026-07-01T00:00:00Z'),
    new Date('2026-07-31T23:59:59Z')
  );

  assert.deepEqual(occurrences.map(event => [event.start.toISOString(), event.title]), [
    ['2026-07-03T17:00:00.000Z', 'Weekly planning'],
    ['2026-07-17T19:00:00.000Z', 'Moved planning'],
    ['2026-07-24T17:00:00.000Z', 'Weekly planning'],
  ]);
  assert.equal(occurrences[1].occurrenceId, '20260717T170000Z');
});

test('an explicit exception TZID overrides a UTC master timezone', () => {
  const parsed = parseIcalEvent('zoned-exception', [
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    'UID:zoned-exception',
    'SUMMARY:UTC master',
    'DTSTART:20260703T170000Z',
    'DTEND:20260703T180000Z',
    'RRULE:FREQ=WEEKLY;COUNT=2',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:zoned-exception',
    'RECURRENCE-ID:20260710T170000Z',
    'SUMMARY:New York exception',
    'DTSTART;TZID=America/New_York:20260710T140000',
    'DTEND;TZID=America/New_York:20260710T150000',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n'));

  const exception = parsed.recurrenceExceptions[0].event;
  assert.equal(exception.start.toISOString(), '2026-07-10T18:00:00.000Z');
  assert.equal(exception.timeKind, 'zoned');
  assert.equal(exception.timeZone, 'America/New_York');
});

test('custom VTIMEZONE aliases use their canonical IANA rules across DST', () => {
  const parsed = parseIcalEvent('custom-zone', [
    'BEGIN:VCALENDAR',
    'BEGIN:VTIMEZONE',
    'TZID:OMS-Eastern',
    'X-LIC-LOCATION:America/New_York',
    'BEGIN:DAYLIGHT',
    'DTSTART:19700308T020000',
    'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU',
    'TZOFFSETFROM:-0500',
    'TZOFFSETTO:-0400',
    'END:DAYLIGHT',
    'BEGIN:STANDARD',
    'DTSTART:19701101T020000',
    'RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU',
    'TZOFFSETFROM:-0400',
    'TZOFFSETTO:-0500',
    'END:STANDARD',
    'END:VTIMEZONE',
    'BEGIN:VEVENT',
    'UID:custom-zone',
    'SUMMARY:Custom zone weekly',
    'DTSTART;TZID=OMS-Eastern:20260301T090000',
    'DTEND;TZID=OMS-Eastern:20260301T100000',
    'RRULE:FREQ=WEEKLY;COUNT=3',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n'));

  assert.equal(parsed.timeKind, 'zoned');
  assert.equal(parsed.timeZone, 'America/New_York');
  assert.equal(parsed.sourceTimeZone, 'OMS-Eastern');
  assert.equal(parsed.timeZoneStatus, 'canonicalized');
  assert.deepEqual(expandRecurringEvent(
    parsed,
    new Date('2026-03-01T00:00:00Z'),
    new Date('2026-03-31T23:59:59Z')
  ).map(event => event.start.toISOString()), [
    '2026-03-01T14:00:00.000Z',
    '2026-03-08T13:00:00.000Z',
    '2026-03-15T13:00:00.000Z',
  ]);
});

test('invalid custom VTIMEZONE falls back to explicit floating semantics', () => {
  const parsed = parseIcalEvent('broken-zone', [
    'BEGIN:VCALENDAR',
    'BEGIN:VTIMEZONE',
    'TZID:Broken/Zone',
    'BEGIN:STANDARD',
    'DTSTART:19700101T000000',
    'TZOFFSETFROM:+0300',
    'END:STANDARD',
    'END:VTIMEZONE',
    'BEGIN:VEVENT',
    'UID:broken-zone',
    'SUMMARY:Do not shift me',
    'DTSTART;TZID=Broken/Zone:20260724T200000',
    'DTEND;TZID=Broken/Zone:20260724T210000',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n'));

  assert.equal(parsed.start.toISOString(), '2026-07-24T20:00:00.000Z');
  assert.equal(parsed.timeKind, 'floating');
  assert.equal(parsed.timeZone, null);
  assert.equal(parsed.sourceTimeZone, 'Broken/Zone');
  assert.equal(parsed.timeZoneStatus, 'invalid');
});

test('second-precision VTIMEZONE offsets remain floating until OMS supports them', () => {
  const parsed = parseIcalEvent('second-offset-zone', [
    'BEGIN:VCALENDAR',
    'BEGIN:VTIMEZONE',
    'TZID:Second-Precision-Baghdad',
    'X-LIC-LOCATION:Asia/Baghdad',
    'BEGIN:STANDARD',
    'DTSTART:19700101T000000',
    'TZOFFSETFROM:+030030',
    'TZOFFSETTO:+030030',
    'END:STANDARD',
    'END:VTIMEZONE',
    'BEGIN:VEVENT',
    'UID:second-offset-zone',
    'DTSTART;TZID=Second-Precision-Baghdad:20260724T200000',
    'DTEND;TZID=Second-Precision-Baghdad:20260724T210000',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n'));

  assert.equal(parsed.start.toISOString(), '2026-07-24T20:00:00.000Z');
  assert.equal(parsed.timeKind, 'floating');
  assert.equal(parsed.timeZoneStatus, 'invalid');
});

test('RFC-invalid negative-zero VTIMEZONE offsets remain floating', () => {
  const parsed = parseIcalEvent('negative-zero-zone', [
    'BEGIN:VCALENDAR',
    'BEGIN:VTIMEZONE',
    'TZID:Etc/UTC',
    'BEGIN:STANDARD',
    'DTSTART:19700101T000000',
    'TZOFFSETFROM:-0000',
    'TZOFFSETTO:-0000',
    'END:STANDARD',
    'END:VTIMEZONE',
    'BEGIN:VEVENT',
    'UID:negative-zero-zone',
    'DTSTART;TZID=Etc/UTC:20260724T200000',
    'DTEND;TZID=Etc/UTC:20260724T210000',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n'));

  assert.equal(parsed.start.toISOString(), '2026-07-24T20:00:00.000Z');
  assert.equal(parsed.timeKind, 'floating');
  assert.equal(parsed.timeZoneStatus, 'invalid');
});

test('contradictory custom VTIMEZONE aliases are rejected instead of silently shifted', () => {
  const parsed = parseIcalEvent('contradictory-zone', [
    'BEGIN:VCALENDAR',
    'BEGIN:VTIMEZONE',
    'TZID:Not-Really-Eastern',
    'X-LIC-LOCATION:America/New_York',
    'BEGIN:DAYLIGHT',
    'DTSTART:19700701T020000',
    'RRULE:FREQ=YEARLY;BYMONTH=7;BYMONTHDAY=1',
    'TZOFFSETFROM:-0500',
    'TZOFFSETTO:-0400',
    'END:DAYLIGHT',
    'BEGIN:STANDARD',
    'DTSTART:19701201T020000',
    'RRULE:FREQ=YEARLY;BYMONTH=12;BYMONTHDAY=1',
    'TZOFFSETFROM:-0400',
    'TZOFFSETTO:-0500',
    'END:STANDARD',
    'END:VTIMEZONE',
    'BEGIN:VEVENT',
    'UID:contradictory-zone',
    'SUMMARY:Keep wall time',
    'DTSTART;TZID=Not-Really-Eastern:20260724T200000',
    'DTEND;TZID=Not-Really-Eastern:20260724T210000',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n'));

  assert.equal(parsed.start.toISOString(), '2026-07-24T20:00:00.000Z');
  assert.equal(parsed.timeKind, 'floating');
  assert.equal(parsed.sourceTimeZone, 'Not-Really-Eastern');
  assert.equal(parsed.timeZoneStatus, 'invalid');
});

test('custom VTIMEZONE aliases must match the canonical rule beyond one coincidental year', () => {
  const parsed = parseIcalEvent('coincidental-zone', [
    'BEGIN:VCALENDAR',
    'BEGIN:VTIMEZONE',
    'TZID:Coincidental-Eastern',
    'X-LIC-LOCATION:America/New_York',
    'BEGIN:DAYLIGHT',
    'DTSTART:19700308T020000',
    'RRULE:FREQ=YEARLY;BYMONTH=3;BYMONTHDAY=8',
    'TZOFFSETFROM:-0500',
    'TZOFFSETTO:-0400',
    'END:DAYLIGHT',
    'BEGIN:STANDARD',
    'DTSTART:19701101T020000',
    'RRULE:FREQ=YEARLY;BYMONTH=11;BYMONTHDAY=1',
    'TZOFFSETFROM:-0400',
    'TZOFFSETTO:-0500',
    'END:STANDARD',
    'END:VTIMEZONE',
    'BEGIN:VEVENT',
    'UID:coincidental-zone',
    'SUMMARY:Do not use the 2026 coincidence',
    'DTSTART;TZID=Coincidental-Eastern:20270310T090000',
    'DTEND;TZID=Coincidental-Eastern:20270310T100000',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n'));

  assert.equal(parsed.start.toISOString(), '2027-03-10T09:00:00.000Z');
  assert.equal(parsed.timeKind, 'floating');
  assert.equal(parsed.sourceTimeZone, 'Coincidental-Eastern');
  assert.equal(parsed.timeZoneStatus, 'invalid');
});

test('bounded or not-yet-applicable custom VTIMEZONE rules stay floating', () => {
  for (const rule of [
    'FREQ=YEARLY;BYMONTH=3;BYDAY=2SU;UNTIL=20200308T070000Z',
    'FREQ=YEARLY;BYMONTH=3;BYDAY=2SU;COUNT=10',
  ]) {
    const parsed = parseIcalEvent(`bounded-zone-${rule}`, [
      'BEGIN:VCALENDAR',
      'BEGIN:VTIMEZONE',
      'TZID:Bounded-Eastern',
      'X-LIC-LOCATION:America/New_York',
      'BEGIN:DAYLIGHT',
      'DTSTART:19700308T020000',
      `RRULE:${rule}`,
      'TZOFFSETFROM:-0500',
      'TZOFFSETTO:-0400',
      'END:DAYLIGHT',
      'BEGIN:STANDARD',
      'DTSTART:20301103T020000',
      'RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU',
      'TZOFFSETFROM:-0400',
      'TZOFFSETTO:-0500',
      'END:STANDARD',
      'END:VTIMEZONE',
      'BEGIN:VEVENT',
      'UID:bounded-zone',
      'DTSTART;TZID=Bounded-Eastern:20270310T090000',
      'DTEND;TZID=Bounded-Eastern:20270310T100000',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n'));

    assert.equal(parsed.timeKind, 'floating');
    assert.equal(parsed.timeZoneStatus, 'invalid');
  }
});

test('recurrence exceptions require the master UID and use the last duplicate identity', () => {
  const parsed = parseIcalEvent('identity-series', [
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    'UID:identity-series',
    'SUMMARY:Master',
    'DTSTART:20260703T170000Z',
    'DTEND:20260703T180000Z',
    'RRULE:FREQ=WEEKLY;COUNT=2',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:another-series',
    'RECURRENCE-ID:20260710T170000Z',
    'SUMMARY:Wrong UID',
    'DTSTART:20260710T180000Z',
    'DTEND:20260710T190000Z',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:identity-series',
    'RECURRENCE-ID:20260710T170000Z',
    'SUMMARY:First duplicate',
    'DTSTART:20260710T190000Z',
    'DTEND:20260710T200000Z',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:identity-series',
    'RECURRENCE-ID:20260710T170000Z',
    'SUMMARY:Latest duplicate',
    'DTSTART:20260710T200000Z',
    'DTEND:20260710T210000Z',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n'));

  assert.equal(parsed.recurrenceExceptions.length, 1);
  assert.equal(parsed.recurrenceExceptions[0].event.title, 'Latest duplicate');
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
