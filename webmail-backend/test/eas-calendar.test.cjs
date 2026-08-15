const test = require('node:test');
const assert = require('node:assert/strict');

process.env.OMS_DB_PASSWORD ||= 'unit-test-password';

const {
  MAX_ACTIVE_SYNC_CALENDAR_BODY_BYTES,
  ActiveSyncCalendarFieldError,
  activeSyncCalendarApplicationDataToIcal: convertActiveSyncCalendarApplicationDataToIcal,
  canWriteActiveSyncCalendar,
  normalizeCalendarSharePermission,
  resolveActiveSyncCalendarAccessRole,
  calendarEventToActiveSyncApplicationData,
  parseActiveSyncCalendarDate,
  storedIcalEventToActiveSyncApplicationData,
} = require('../src/eas-calendar.js');
const { MAX_PIM_SYNC_RESPONSE_BYTES } = require('../src/eas-pim-sync.js');
const { WbxmlWriter } = require('../src/wbxml/writer.js');

test('calendar write access is fail-closed for malformed ACL roles', () => {
  assert.equal(canWriteActiveSyncCalendar('owner'), true);
  assert.equal(canWriteActiveSyncCalendar('write'), true);
  assert.equal(canWriteActiveSyncCalendar('read'), false);
  assert.equal(canWriteActiveSyncCalendar(null), false);
  assert.equal(canWriteActiveSyncCalendar('admin'), false);
});

test('calendar share permissions accept only read or write', () => {
  assert.equal(normalizeCalendarSharePermission('read'), 'read');
  assert.equal(normalizeCalendarSharePermission('write'), 'write');
  assert.equal(normalizeCalendarSharePermission(null), null);
  assert.equal(normalizeCalendarSharePermission('owner'), null);
});

test('ActiveSync exposes subscribed and managed Birthdays calendars as read-only', () => {
  const user = 'owner@example.test';
  assert.equal(resolveActiveSyncCalendarAccessRole({ user_id: user, dav_slug: 'personal' }, user), 'owner');
  assert.equal(resolveActiveSyncCalendarAccessRole({ user_id: user, dav_slug: 'birthdays' }, user), 'read');
  assert.equal(resolveActiveSyncCalendarAccessRole({
    user_id: user,
    dav_slug: 'feed',
    subscribed_url: 'https://calendar.example.test/feed.ics',
  }, user), 'read');
  assert.equal(resolveActiveSyncCalendarAccessRole({
    user_id: 'sharer@example.test',
    dav_slug: 'team',
    permission: 'write',
  }, user), 'write');
  assert.equal(resolveActiveSyncCalendarAccessRole({
    user_id: 'sharer@example.test',
    dav_slug: 'birthdays',
    permission: 'write',
  }, user), 'read');
  assert.equal(resolveActiveSyncCalendarAccessRole({ user_id: 'other@example.test', permission: null }, user), null);
});
const { expandRecurringEvent, parseIcalEvent } = require('../src/calendar-format.js');

const child = (node, tag) => node.children?.find((candidate) => candidate.tag === tag);
const field = (nodes, tag) => nodes.find((node) => node.tag === tag);
const systemTime = (buffer, offset) => Array.from({ length: 8 }, (_, index) => buffer.readUInt16LE(offset + index * 2));
const withCalendarPages = (node, parentPage = 4) => {
  const page = node.tag === 'Body' || parentPage === 17 ? 17 : parentPage;
  return {
    ...node,
    page: node.page ?? page,
    ...(node.children ? { children: node.children.map(childNode => withCalendarPages(childNode, page)) } : {}),
  };
};
const activeSyncCalendarApplicationDataToIcal = (uid, applicationData, existingIcal, omittedFieldsToClear) =>
  convertActiveSyncCalendarApplicationDataToIcal(uid, {
    ...applicationData,
    children: (applicationData.children || []).map(node => withCalendarPages(node)),
  }, existingIcal, omittedFieldsToClear);

const MICROSOFT_PACIFIC_TIMEZONE = [
  '4AEAACgARwBNAFQALQAwADgAOgAwADAAKQAgAFAAYQBjAGkAZgBpAGMAIABUAGkAbQBlACAAKABV',
  'AFMAIAAmACAAQwAAAAsAAAABAAIAAAAAAAAAAAAAACgARwBNAFQALQAwADgAOgAwADAAKQAgAFAAYQ',
  'BjAGkAZgBpAGMAIABUAGkAbQBlACAAKABVAFMAIAAmACAAQwAAAAMAAAACAAIAAAAAAAAAxP///w==',
].join('');
const IOS_NEW_YORK_TIME_ZONE = 'LAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAsAAAABAAIAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAMAAAACAAIAAAAAAAAAxP///w==';

test('Apple-style Baghdad CalDAV events export as UTC ActiveSync instants', () => {
  const parsed = parseIcalEvent('baghdad', [
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    'UID:baghdad',
    'SUMMARY:Friday event',
    'DTSTART;TZID=Asia/Baghdad:20260724T200000',
    'DTEND;TZID=Asia/Baghdad:20260724T210000',
    'RRULE:FREQ=WEEKLY;COUNT=3',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n'));
  const payload = calendarEventToActiveSyncApplicationData(parsed);

  assert.equal(field(payload, 'StartTime').content, '20260724T170000Z');
  assert.equal(field(payload, 'EndTime').content, '20260724T180000Z');
  assert.equal(child(field(payload, 'Recurrence'), 'Type').content, '1');
  assert.equal(child(field(payload, 'Recurrence'), 'DayOfWeek').content, '32');
  assert.equal(child(field(payload, 'Recurrence'), 'Occurrences').content, '3');
  const timezone = Buffer.from(field(payload, 'TimeZone').content, 'base64');
  assert.equal(timezone.length, 172);
  assert.equal(timezone.readInt32LE(0), -180);
  assert.deepEqual(systemTime(timezone, 68), [0, 0, 0, 0, 0, 0, 0, 0]);
  assert.deepEqual(systemTime(timezone, 152), [0, 0, 0, 0, 0, 0, 0, 0]);
});

test('zoned recurrence exports the EAS TIME_ZONE_INFORMATION DST rules', () => {
  const parsed = parseIcalEvent('new-york', [
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    'UID:new-york',
    'SUMMARY:Weekly planning',
    'DTSTART;TZID=America/New_York:20260227T090000',
    'DTEND;TZID=America/New_York:20260227T100000',
    'RRULE:FREQ=WEEKLY;COUNT=6',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n'));
  const payload = calendarEventToActiveSyncApplicationData(parsed);
  const timezone = Buffer.from(field(payload, 'TimeZone').content, 'base64');

  assert.equal(timezone.length, 172);
  assert.equal(timezone.readInt32LE(0), 300);
  assert.equal(timezone.readInt32LE(84), 0);
  assert.equal(timezone.readInt32LE(168), -60);
  assert.deepEqual(systemTime(timezone, 68), [0, 11, 0, 1, 2, 0, 0, 0]);
  assert.deepEqual(systemTime(timezone, 152), [0, 3, 0, 2, 2, 0, 0, 0]);
});

test('EAS timezone round trip keeps New York recurrence at 09:00 across DST', () => {
  const source = parseIcalEvent('new-york-round-trip', [
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    'UID:new-york-round-trip',
    'SUMMARY:Weekly planning',
    'DTSTART;TZID=America/New_York:20260227T090000',
    'DTEND;TZID=America/New_York:20260227T100000',
    'RRULE:FREQ=WEEKLY;COUNT=6',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n'));
  const outbound = calendarEventToActiveSyncApplicationData(source);
  const ical = activeSyncCalendarApplicationDataToIcal('new-york-round-trip', {
    children: [
      { tag: 'Subject', content: 'Weekly planning' },
      { tag: 'TimeZone', content: field(outbound, 'TimeZone').content },
      { tag: 'StartTime', content: field(outbound, 'StartTime').content },
      { tag: 'EndTime', content: field(outbound, 'EndTime').content },
      { tag: 'Recurrence', children: [
        { tag: 'Type', content: '1' },
        { tag: 'Interval', content: '1' },
        { tag: 'DayOfWeek', content: '32' },
        { tag: 'Occurrences', content: '6' },
      ] },
    ],
  });
  const parsed = parseIcalEvent('new-york-round-trip', ical);
  const occurrences = expandRecurringEvent(
    parsed,
    new Date('2026-02-01T00:00:00Z'),
    new Date('2026-05-01T00:00:00Z'),
  );

  assert.match(ical, /DTSTART;TZID=America\/New_York:20260227T090000/);
  assert.equal(occurrences[0].start.toISOString(), '2026-02-27T14:00:00.000Z');
  assert.equal(occurrences.at(-1).start.toISOString(), '2026-04-03T13:00:00.000Z');
});

test('physical iOS TimeZone payload preserves a New York weekly series across DST', () => {
  const ical = activeSyncCalendarApplicationDataToIcal('ios-new-york', {
    children: [
      { tag: 'TimeZone', content: IOS_NEW_YORK_TIME_ZONE },
      { tag: 'Subject', content: 'iOS weekly planning' },
      { tag: 'StartTime', content: '20260305T140000Z' },
      { tag: 'EndTime', content: '20260305T143000Z' },
      { tag: 'Recurrence', children: [
        { tag: 'Type', content: '1' },
        { tag: 'Interval', content: '1' },
        { tag: 'DayOfWeek', content: '16' },
        { tag: 'Until', content: '20260328T130000Z' },
        { tag: 'FirstDayOfWeek', content: '1' },
      ] },
    ],
  });
  const parsed = parseIcalEvent('ios-new-york', ical);
  const occurrences = expandRecurringEvent(
    parsed,
    new Date('2026-03-01T00:00:00Z'),
    new Date('2026-04-01T00:00:00Z'),
  );

  assert.match(ical, /DTSTART;TZID=America\/New_York:20260305T090000/);
  assert.equal(occurrences.length, 4);
  assert.deepEqual(occurrences.map(item => item.start.toISOString()), [
    '2026-03-05T14:00:00.000Z',
    '2026-03-12T13:00:00.000Z',
    '2026-03-19T13:00:00.000Z',
    '2026-03-26T13:00:00.000Z',
  ]);
});

test('iOS partial Change preserves an existing recurrence as a valid RRULE', () => {
  const existing = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'BEGIN:VEVENT',
    'UID:ios-partial-change',
    'DTSTART;TZID=America/New_York:20270305T090000',
    'DTEND;TZID=America/New_York:20270305T093000',
    'SUMMARY:Before edit',
    'RRULE:FREQ=WEEKLY;COUNT=4',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
  const ical = activeSyncCalendarApplicationDataToIcal('ios-partial-change', {
    children: [
      { tag: 'Subject', content: 'After edit' },
      { tag: 'StartTime', content: '20270305T140000Z' },
      { tag: 'EndTime', content: '20270305T143000Z' },
    ],
  }, existing);

  assert.match(ical, /\r\nRRULE:FREQ=WEEKLY;COUNT=4\r\n/);
  assert.doesNotMatch(ical, /\r\nFREQ=WEEKLY/);
  assert.equal(parseIcalEvent('ios-partial-change', ical).recurrence?.frequency, 'WEEKLY');
});

test('subject-only calendar Change preserves meeting and custom iCalendar metadata', () => {
  const existing = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', 'UID:rich-meeting',
    'DTSTAMP:20260815T120000Z', 'DTSTART:20260816T120000Z', 'DTEND:20260816T130000Z',
    'SUMMARY:Before edit', 'ORGANIZER;CN="Owner":mailto:owner@example.test',
    'ATTENDEE;CN="Guest";ROLE=REQ-PARTICIPANT:mailto:guest@example.test',
    'CATEGORIES:Planning,Private', 'SEQUENCE:7', 'STATUS:TENTATIVE',
    'URL:https://example.test/event', 'ATTACH:https://example.test/brief.pdf',
    'CONFERENCE;VALUE=URI:https://meet.example.test/room', 'X-OMS-CUSTOM:value',
    'END:VEVENT', 'END:VCALENDAR', '',
  ].join('\r\n');
  const changed = activeSyncCalendarApplicationDataToIcal('rich-meeting', {
    children: [{ tag: 'Subject', page: 4, content: 'After edit' }],
  }, existing);
  assert.match(changed, /SUMMARY:After edit/);
  for (const preserved of [
    'ORGANIZER;CN="Owner":mailto:owner@example.test',
    'ATTENDEE;CN="Guest";ROLE=REQ-PARTICIPANT:mailto:guest@example.test',
    'CATEGORIES:Planning,Private', 'SEQUENCE:7', 'STATUS:TENTATIVE',
    'URL:https://example.test/event', 'ATTACH:https://example.test/brief.pdf',
    'CONFERENCE;VALUE=URI:https://meet.example.test/room', 'X-OMS-CUSTOM:value',
  ]) assert.match(changed, new RegExp(preserved.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('recognized but unsupported calendar fields fail before conversion', () => {
  assert.throws(() => activeSyncCalendarApplicationDataToIcal('unsupported', {
    children: [{ tag: 'Attachments', page: 4, children: [] }],
  }), ActiveSyncCalendarFieldError);
});

test('ActiveSync calendar Change preserves omitted optional text and clears explicit empty values', () => {
  const existing = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'BEGIN:VEVENT',
    'UID:clear-optional-fields',
    'DTSTART:20270305T140000Z',
    'DTEND:20270305T143000Z',
    'SUMMARY:Before edit',
    'LOCATION:Old room',
    'DESCRIPTION:Old description',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
  const omitted = activeSyncCalendarApplicationDataToIcal('clear-optional-fields', {
    children: [
      { tag: 'Subject', content: 'After edit' },
      { tag: 'StartTime', content: '20270305T140000Z' },
      { tag: 'EndTime', content: '20270305T143000Z' },
    ],
  }, existing);
  assert.match(omitted, /\r\nLOCATION:Old room/);
  assert.match(omitted, /\r\nDESCRIPTION:Old description/);

  const explicitlyEmpty = activeSyncCalendarApplicationDataToIcal('clear-optional-fields', {
    children: [
      { tag: 'Subject', content: 'After edit' },
      { tag: 'StartTime', content: '20270305T140000Z' },
      { tag: 'EndTime', content: '20270305T143000Z' },
      { tag: 'Location', content: '' },
      { tag: 'Body', children: [{ tag: 'Data', content: '' }] },
    ],
  }, existing);
  assert.doesNotMatch(explicitlyEmpty, /\r\nLOCATION:/);
  assert.doesNotMatch(explicitlyEmpty, /\r\nDESCRIPTION:/);
});

test('calendar omission clears are scoped while Body and Exceptions stay ghosted', () => {
  const existing = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT', 'UID:calendar-ghosting',
    'DTSTAMP:20260815T120000Z', 'DTSTART:20260816T120000Z', 'DTEND:20260816T130000Z',
    'SUMMARY:Before edit', 'LOCATION:Old room', 'DESCRIPTION:Keep description', 'CATEGORIES:Planning,Private',
    'RRULE:FREQ=WEEKLY;COUNT=2', 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:calendar-ghosting', 'RECURRENCE-ID:20260823T120000Z',
    'DTSTART:20260823T140000Z', 'DTEND:20260823T150000Z', 'SUMMARY:Keep exception', 'END:VEVENT',
    'END:VCALENDAR', '',
  ].join('\r\n');
  const applicationData = { children: [
    { tag: 'Subject', content: 'After edit' },
    { tag: 'StartTime', content: '20260816T120000Z' },
    { tag: 'EndTime', content: '20260816T130000Z' },
    { tag: 'DtStamp', content: '20260815T120000Z' },
  ] };

  const cleared = activeSyncCalendarApplicationDataToIcal(
    'calendar-ghosting', applicationData, existing, new Set(['4:Location', '4:Categories']),
  );
  assert.doesNotMatch(cleared, /\r\nLOCATION:/);
  assert.doesNotMatch(cleared, /\r\nCATEGORIES:/);
  assert.match(cleared, /\r\nDESCRIPTION:Keep description/);
  assert.match(cleared, /\r\nRECURRENCE-ID:20260823T120000Z/);

  const preserved = activeSyncCalendarApplicationDataToIcal(
    'calendar-ghosting', applicationData, existing, new Set(),
  );
  assert.match(preserved, /\r\nLOCATION:Old room/);
  assert.match(preserved, /\r\nCATEGORIES:Planning,Private/);

  const locationOnly = activeSyncCalendarApplicationDataToIcal(
    'calendar-ghosting', applicationData, existing, new Set(['4:Location']),
  );
  assert.doesNotMatch(locationOnly, /\r\nLOCATION:/);
  assert.match(locationOnly, /\r\nCATEGORIES:Planning,Private/);
});

test('EAS timezone rules resolve without optional display names', () => {
  const source = parseIcalEvent('unnamed-new-york', [
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    'UID:unnamed-new-york',
    'SUMMARY:Unnamed timezone',
    'DTSTART;TZID=America/New_York:20260227T090000',
    'DTEND;TZID=America/New_York:20260227T100000',
    'RRULE:FREQ=WEEKLY;COUNT=2',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n'));
  const outbound = calendarEventToActiveSyncApplicationData(source);
  const timezone = Buffer.from(field(outbound, 'TimeZone').content, 'base64');
  timezone.fill(0, 4, 68);
  timezone.fill(0, 88, 152);
  const ical = activeSyncCalendarApplicationDataToIcal('unnamed-new-york', {
    children: [
      { tag: 'Subject', content: 'Unnamed timezone' },
      { tag: 'TimeZone', content: timezone.toString('base64') },
      { tag: 'StartTime', content: '20260227T140000Z' },
      { tag: 'EndTime', content: '20260227T150000Z' },
      { tag: 'Recurrence', children: [
        { tag: 'Type', content: '1' },
        { tag: 'DayOfWeek', content: '32' },
        { tag: 'Occurrences', content: '2' },
      ] },
    ],
  });

  assert.match(ical, /DTSTART;TZID=America\/New_York:20260227T090000/);
});

test('Microsoft Pacific EAS timezone decodes to a DST-safe zoned iCalendar recurrence', () => {
  const ical = activeSyncCalendarApplicationDataToIcal('pacific-recurring', {
    children: [
      { tag: 'Subject', content: 'Pacific planning' },
      { tag: 'TimeZone', content: MICROSOFT_PACIFIC_TIMEZONE },
      { tag: 'StartTime', content: '20110510T170000Z' },
      { tag: 'EndTime', content: '20110510T180000Z' },
      { tag: 'DtStamp', content: '20110504T152200Z' },
      { tag: 'Recurrence', children: [
        { tag: 'Type', content: '1' },
        { tag: 'Interval', content: '1' },
        { tag: 'DayOfWeek', content: '4' },
        { tag: 'Occurrences', content: '30' },
      ] },
    ],
  });
  const parsed = parseIcalEvent('pacific-recurring', ical);

  assert.match(ical, /DTSTART;TZID=America\/Los_Angeles:20110510T100000/);
  assert.equal(parsed.timeKind, 'zoned');
  assert.equal(parsed.timeZone, 'America/Los_Angeles');
  assert.equal(parsed.start.toISOString(), '2011-05-10T17:00:00.000Z');
  const occurrences = expandRecurringEvent(
    parsed,
    new Date('2011-05-01T00:00:00Z'),
    new Date('2011-12-01T00:00:00Z'),
  );
  assert.equal(occurrences[0].start.toISOString(), '2011-05-10T17:00:00.000Z');
  assert.equal(occurrences.at(-1).start.toISOString(), '2011-11-29T18:00:00.000Z');
});

test('Windows Central timezone names preserve recurrence semantics across DST', () => {
  const source = parseIcalEvent('central-source', [
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    'UID:central-source',
    'SUMMARY:Central planning',
    'DTSTART;TZID=America/Chicago:20270226T090000',
    'DTEND;TZID=America/Chicago:20270226T100000',
    'RRULE:FREQ=WEEKLY;COUNT=6',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n'));
  const outbound = calendarEventToActiveSyncApplicationData(source);
  const timezone = Buffer.from(field(outbound, 'TimeZone').content, 'base64');
  timezone.fill(0, 4, 68);
  timezone.write('Central Standard Time', 4, 62, 'utf16le');
  timezone.fill(0, 88, 152);
  timezone.write('Central Daylight Time', 88, 62, 'utf16le');

  const ical = activeSyncCalendarApplicationDataToIcal('central-recurring', {
    children: [
      { tag: 'Subject', content: 'Central planning' },
      { tag: 'TimeZone', content: timezone.toString('base64') },
      { tag: 'StartTime', content: '20270226T150000Z' },
      { tag: 'EndTime', content: '20270226T160000Z' },
      { tag: 'Recurrence', children: [
        { tag: 'Type', content: '1' },
        { tag: 'Interval', content: '1' },
        { tag: 'DayOfWeek', content: '32' },
        { tag: 'Occurrences', content: '6' },
      ] },
    ],
  });
  const parsed = parseIcalEvent('central-recurring', ical);
  const occurrences = expandRecurringEvent(
    parsed,
    new Date('2027-02-01T00:00:00Z'),
    new Date('2027-05-01T00:00:00Z'),
  );

  assert.match(ical, /DTSTART;TZID=America\/Chicago:20270226T090000/);
  assert.equal(occurrences[0].start.toISOString(), '2027-02-26T15:00:00.000Z');
  assert.equal(occurrences.at(-1).start.toISOString(), '2027-04-02T14:00:00.000Z');
});

test('malformed EAS timezone falls back to UTC without rejecting the event', () => {
  const ical = activeSyncCalendarApplicationDataToIcal('bad-timezone', {
    children: [
      { tag: 'Subject', content: 'Still usable' },
      { tag: 'TimeZone', content: 'not-a-timezone' },
      { tag: 'StartTime', content: '20260724T170000Z' },
      { tag: 'EndTime', content: '20260724T180000Z' },
    ],
  });

  assert.match(ical, /DTSTART:20260724T170000Z/);
  assert.doesNotMatch(ical, /DTSTART;TZID=/);
});

test('unknown well-formed EAS timezone falls back without exhaustive zone guessing', () => {
  const timezone = Buffer.from(MICROSOFT_PACIFIC_TIMEZONE, 'base64');
  timezone.writeInt32LE(12_345, 0);
  timezone.fill(0, 4, 68);
  timezone.fill(0, 88, 152);
  const ical = activeSyncCalendarApplicationDataToIcal('unknown-timezone', {
    children: [
      { tag: 'Subject', content: 'Unknown timezone' },
      { tag: 'TimeZone', content: timezone.toString('base64') },
      { tag: 'StartTime', content: '20260724T170000Z' },
      { tag: 'EndTime', content: '20260724T180000Z' },
    ],
  });

  assert.match(ical, /DTSTART:20260724T170000Z/);
  assert.doesNotMatch(ical, /DTSTART;TZID=/);
});

test('iOS-style ActiveSync all-day writes round trip as exclusive iCalendar dates', () => {
  const ical = activeSyncCalendarApplicationDataToIcal('ios-all-day', {
    children: [
      { tag: 'Subject', content: 'Holiday' },
      { tag: 'AllDayEvent', content: '1' },
      { tag: 'StartTime', content: '20260724' },
      { tag: 'EndTime', content: '20260725' },
      { tag: 'DtStamp', content: '20260701T120000Z' },
    ],
  });
  const parsed = parseIcalEvent('ios-all-day', ical);

  assert.equal(parsed.timeKind, 'all-day');
  assert.equal(parsed.start.toISOString(), '2026-07-24T00:00:00.000Z');
  assert.equal(parsed.end.toISOString(), '2026-07-25T00:00:00.000Z');
  assert.equal(field(calendarEventToActiveSyncApplicationData(parsed), 'TimeZone'), undefined);
});

test('ActiveSync recurrence and AirSyncBase body survive conversion to iCalendar', () => {
  const ical = activeSyncCalendarApplicationDataToIcal('ios-recurring', {
    children: [
      { tag: 'Subject', content: 'Standup' },
      { tag: 'StartTime', content: '20260724T170000Z' },
      { tag: 'EndTime', content: '20260724T173000Z' },
      { tag: 'DtStamp', content: '20260701T120000Z' },
      { tag: 'Body', children: [{ tag: 'Data', content: 'From iOS' }] },
      { tag: 'Recurrence', children: [
        { tag: 'Type', content: '1' },
        { tag: 'Interval', content: '2' },
        { tag: 'DayOfWeek', content: '32' },
        { tag: 'Occurrences', content: '4' },
      ] },
    ],
  });
  const parsed = parseIcalEvent('ios-recurring', ical);

  assert.equal(parsed.description, 'From iOS');
  assert.equal(parsed.recurrence.raw, 'FREQ=WEEKLY;INTERVAL=2;COUNT=4;BYDAY=FR');
});

test('oversized stored calendar bodies are UTF-8 safely truncated instead of poisoning Sync', () => {
  const parsed = parseIcalEvent('large-body', [
    'BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'UID:large-body', 'SUMMARY:Large body',
    'DTSTART:20260724T170000Z', 'DTEND:20260724T180000Z',
    `DESCRIPTION:${'x'.repeat(MAX_ACTIVE_SYNC_CALENDAR_BODY_BYTES + 100)}`,
    'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n'));
  const payload = calendarEventToActiveSyncApplicationData(parsed);
  const body = field(payload, 'Body');
  assert.equal(Buffer.byteLength(child(body, 'Data').content, 'utf8'), MAX_ACTIVE_SYNC_CALENDAR_BODY_BYTES);
  assert.equal(child(body, 'Truncated').content, '1');
  assert.equal(Number(child(body, 'EstimatedDataSize').content) > MAX_ACTIVE_SYNC_CALENDAR_BODY_BYTES, true);
});

test('display reminders round trip between iCalendar and ActiveSync', () => {
  const source = parseIcalEvent('reminder-round-trip', [
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    'UID:reminder-round-trip',
    'SUMMARY:Reminder round trip',
    'DTSTART:20260724T170000Z',
    'DTEND:20260724T180000Z',
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    'TRIGGER:-PT15M',
    'DESCRIPTION:Reminder round trip',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n'));
  const outbound = calendarEventToActiveSyncApplicationData(source);

  assert.equal(field(outbound, 'Reminder').content, '15');

  const ical = activeSyncCalendarApplicationDataToIcal('reminder-round-trip', {
    children: [
      { tag: 'Subject', content: 'Reminder round trip' },
      { tag: 'StartTime', content: '20260724T170000Z' },
      { tag: 'EndTime', content: '20260724T180000Z' },
      { tag: 'Reminder', content: '15' },
    ],
  });
  assert.match(ical, /BEGIN:VALARM\r\nACTION:DISPLAY\r\nTRIGGER:-PT15M\r\nDESCRIPTION:Reminder round trip\r\nEND:VALARM/);
  assert.deepEqual(parseIcalEvent('reminder-round-trip', ical).notifications, [
    { id: 1, type: 'notification', time: 15 },
  ]);
});

test('deleted and modified recurrence exceptions round trip through ActiveSync', () => {
  const source = parseIcalEvent('exceptions-round-trip', [
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    'UID:exceptions-round-trip',
    'SUMMARY:Weekly planning',
    'DTSTART:20260703T170000Z',
    'DTEND:20260703T180000Z',
    'RRULE:FREQ=WEEKLY;COUNT=4',
    'EXDATE:20260710T170000Z',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:exceptions-round-trip',
    'RECURRENCE-ID:20260717T170000Z',
    'SUMMARY:Moved planning',
    'DTSTART:20260717T190000Z',
    'DTEND:20260717T200000Z',
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    'TRIGGER:-PT5M',
    'DESCRIPTION:Moved planning',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n'));
  const outbound = calendarEventToActiveSyncApplicationData(source);
  const exceptions = field(outbound, 'Exceptions');

  assert.equal(exceptions.children.length, 2);
  assert.equal(child(exceptions.children[0], 'ExceptionStartTime').content, '20260710T170000Z');
  assert.equal(child(exceptions.children[0], 'Deleted').content, '1');
  assert.equal(child(exceptions.children[1], 'ExceptionStartTime').content, '20260717T170000Z');
  assert.equal(child(exceptions.children[1], 'StartTime').content, '20260717T190000Z');
  assert.equal(child(exceptions.children[1], 'Reminder').content, '5');

  const ical = activeSyncCalendarApplicationDataToIcal('exceptions-round-trip', {
    children: [
      { tag: 'Subject', content: 'Weekly planning' },
      { tag: 'StartTime', content: '20260703T170000Z' },
      { tag: 'EndTime', content: '20260703T180000Z' },
      { tag: 'Recurrence', children: [
        { tag: 'Type', content: '1' },
        { tag: 'DayOfWeek', content: '32' },
        { tag: 'Occurrences', content: '4' },
      ] },
      exceptions,
    ],
  });
  const expanded = expandRecurringEvent(
    parseIcalEvent('exceptions-round-trip', ical),
    new Date('2026-07-01T00:00:00Z'),
    new Date('2026-07-31T23:59:59Z'),
  );

  assert.match(ical, /EXDATE:20260710T170000Z/);
  assert.match(ical, /RECURRENCE-ID:20260717T170000Z/);
  assert.deepEqual(expanded.map(event => [event.start.toISOString(), event.title]), [
    ['2026-07-03T17:00:00.000Z', 'Weekly planning'],
    ['2026-07-17T19:00:00.000Z', 'Moved planning'],
    ['2026-07-24T17:00:00.000Z', 'Weekly planning'],
  ]);
});

test('exception-specific all-day state round trips independently of the master', () => {
  const timedMaster = parseIcalEvent('timed-to-all-day', [
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    'UID:timed-to-all-day',
    'SUMMARY:Timed master',
    'DTSTART:20260703T170000Z',
    'DTEND:20260703T180000Z',
    'RRULE:FREQ=WEEKLY;COUNT=2',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:timed-to-all-day',
    'RECURRENCE-ID:20260710T170000Z',
    'SUMMARY:All-day exception',
    'DTSTART;VALUE=DATE:20260710',
    'DTEND;VALUE=DATE:20260711',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n'));
  const timedOutboundException = child(field(
    calendarEventToActiveSyncApplicationData(timedMaster),
    'Exceptions',
  ), 'Exception');
  assert.equal(child(timedOutboundException, 'AllDayEvent').content, '1');

  const timedRoundTrip = parseIcalEvent('timed-to-all-day', activeSyncCalendarApplicationDataToIcal(
    'timed-to-all-day',
    { children: [
      { tag: 'Subject', content: 'Timed master' },
      { tag: 'StartTime', content: '20260703T170000Z' },
      { tag: 'EndTime', content: '20260703T180000Z' },
      { tag: 'Recurrence', children: [
        { tag: 'Type', content: '1' },
        { tag: 'DayOfWeek', content: '32' },
        { tag: 'Occurrences', content: '2' },
      ] },
      field(calendarEventToActiveSyncApplicationData(timedMaster), 'Exceptions'),
    ] },
  ));
  assert.equal(timedRoundTrip.recurrenceExceptions[0].event.isAllDay, true);
  assert.equal(timedRoundTrip.recurrenceExceptions[0].event.start.toISOString(), '2026-07-10T00:00:00.000Z');

  const allDayMaster = parseIcalEvent('all-day-to-timed', [
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    'UID:all-day-to-timed',
    'SUMMARY:All-day master',
    'DTSTART;VALUE=DATE:20260703',
    'DTEND;VALUE=DATE:20260704',
    'RRULE:FREQ=WEEKLY;COUNT=2',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:all-day-to-timed',
    'RECURRENCE-ID;VALUE=DATE:20260710',
    'SUMMARY:Timed exception',
    'DTSTART:20260710T170000Z',
    'DTEND:20260710T180000Z',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n'));
  const allDayOutbound = calendarEventToActiveSyncApplicationData(allDayMaster);
  const allDayOutboundException = child(field(allDayOutbound, 'Exceptions'), 'Exception');
  assert.equal(child(allDayOutboundException, 'AllDayEvent').content, '0');

  const allDayRoundTrip = parseIcalEvent('all-day-to-timed', activeSyncCalendarApplicationDataToIcal(
    'all-day-to-timed',
    { children: [
      { tag: 'Subject', content: 'All-day master' },
      { tag: 'AllDayEvent', content: '1' },
      { tag: 'StartTime', content: '20260703T000000Z' },
      { tag: 'EndTime', content: '20260704T000000Z' },
      { tag: 'Recurrence', children: [
        { tag: 'Type', content: '1' },
        { tag: 'DayOfWeek', content: '32' },
        { tag: 'Occurrences', content: '2' },
      ] },
      field(allDayOutbound, 'Exceptions'),
    ] },
  ));
  assert.equal(allDayRoundTrip.recurrenceExceptions[0].event.isAllDay, false);
  assert.equal(allDayRoundTrip.recurrenceExceptions[0].event.start.toISOString(), '2026-07-10T17:00:00.000Z');
});

test('partial ActiveSync changes preserve existing reminders and exceptions', () => {
  const existing = [
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    'UID:partial-with-exception',
    'SUMMARY:Before edit',
    'DTSTART:20260703T170000Z',
    'DTEND:20260703T180000Z',
    'RRULE:FREQ=WEEKLY;COUNT=3',
    'EXDATE:20260710T170000Z',
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    'TRIGGER:-PT10M',
    'DESCRIPTION:Before edit',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
  const ical = activeSyncCalendarApplicationDataToIcal('partial-with-exception', {
    children: [{ tag: 'Subject', content: 'After edit' }],
  }, existing);

  assert.match(ical, /EXDATE:20260710T170000Z/);
  assert.match(ical, /TRIGGER:-PT10M/);
});

test('subject-only ActiveSync changes preserve stored structural EXDATE properties', () => {
  const preservedExdate = 'EXDATE;TZID=America/New_York;X-OMS-KEEP=YES:20260308T090000,20260315T090000';
  const existing = [
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    'UID:partial-with-zoned-exdate',
    'SUMMARY:Before edit',
    'DTSTART;TZID=America/New_York:20260301T090000',
    'DTEND;TZID=America/New_York:20260301T100000',
    'RRULE:FREQ=WEEKLY;COUNT=4',
    preservedExdate,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');

  const ical = activeSyncCalendarApplicationDataToIcal('partial-with-zoned-exdate', {
    children: [{ tag: 'Subject', content: 'After edit' }],
  }, existing);

  assert.deepEqual(
    ical.split('\r\n').filter(line => line.startsWith('EXDATE')),
    [preservedExdate],
  );
});

test('replacement ActiveSync exceptions use the master DTSTART value form across DST', () => {
  const deletedExceptions = (...values) => ({
    tag: 'Exceptions',
    children: values.map(value => ({
      tag: 'Exception',
      children: [
        { tag: 'ExceptionStartTime', content: value },
        { tag: 'Deleted', content: '1' },
      ],
    })),
  });
  const cases = [
    {
      uid: 'replacement-all-day-exdates',
      start: 'DTSTART;VALUE=DATE:20260301',
      end: 'DTEND;VALUE=DATE:20260302',
      exceptions: deletedExceptions('20260308T000000Z'),
      expected: 'EXDATE;VALUE=DATE:20260308',
    },
    {
      uid: 'replacement-utc-exdates',
      start: 'DTSTART:20260301T140000Z',
      end: 'DTEND:20260301T150000Z',
      exceptions: deletedExceptions('20260308T130000Z'),
      expected: 'EXDATE:20260308T130000Z',
    },
    {
      uid: 'replacement-zoned-exdates',
      start: 'DTSTART;TZID=America/New_York:20260301T090000',
      end: 'DTEND;TZID=America/New_York:20260301T100000',
      exceptions: deletedExceptions('20260301T140000Z', '20260308T130000Z'),
      expected: 'EXDATE;TZID=America/New_York:20260301T090000,20260308T090000',
    },
  ];

  for (const item of cases) {
    const existing = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      `UID:${item.uid}`,
      'SUMMARY:Before edit',
      item.start,
      item.end,
      'RRULE:FREQ=WEEKLY;COUNT=4',
      'EXDATE:20260322T140000Z',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    const ical = activeSyncCalendarApplicationDataToIcal(item.uid, {
      children: [
        { tag: 'Subject', content: 'After edit' },
        item.exceptions,
      ],
    }, existing);

    assert.deepEqual(
      ical.split('\r\n').filter(line => line.startsWith('EXDATE')),
      [item.expected],
      item.uid,
    );
  }
});

test('partial ActiveSync changes preserve cancelled RECURRENCE-ID exceptions', () => {
  const existing = [
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    'UID:cancelled-partial',
    'SUMMARY:Before edit',
    'DTSTART:20260703T170000Z',
    'DTEND:20260703T180000Z',
    'RRULE:FREQ=WEEKLY;COUNT=3',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:cancelled-partial',
    'RECURRENCE-ID:20260710T170000Z',
    'STATUS:CANCELLED',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');

  const ical = activeSyncCalendarApplicationDataToIcal('cancelled-partial', {
    children: [{ tag: 'Subject', content: 'After edit' }],
  }, existing);

  assert.doesNotMatch(ical, /EXDATE:/);
  assert.match(ical, /RECURRENCE-ID:20260710T170000Z/);
  assert.match(ical, /STATUS:CANCELLED/);
  assert.equal(expandRecurringEvent(
    parseIcalEvent('cancelled-partial', ical),
    new Date('2026-07-01T00:00:00Z'),
    new Date('2026-07-31T23:59:59Z'),
  ).length, 2);
});

test('malformed ActiveSync Exceptions are rejected before replacing stored exception state', () => {
  const existing = [
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    'UID:malformed-exception-change',
    'SUMMARY:Before edit',
    'DTSTART:20260703T170000Z',
    'DTEND:20260703T180000Z',
    'RRULE:FREQ=WEEKLY;COUNT=3',
    'EXDATE:20260710T170000Z',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:malformed-exception-change',
    'RECURRENCE-ID:20260717T170000Z',
    'SUMMARY:Moved occurrence',
    'DTSTART:20260717T190000Z',
    'DTEND:20260717T200000Z',
    'END:VEVENT',
    'END:VCALENDAR',
    '',
  ].join('\r\n');
  let stored = existing;

  assert.throws(() => {
    stored = activeSyncCalendarApplicationDataToIcal('malformed-exception-change', {
      children: [
        { tag: 'Subject', content: 'After edit' },
        { tag: 'Exceptions', children: [{ tag: 'Exception', children: [
          { tag: 'Deleted', content: '1' },
        ] }] },
      ],
    }, stored);
  }, ActiveSyncCalendarFieldError);

  assert.equal(stored, existing);
  assert.match(stored, /EXDATE:20260710T170000Z/);
  assert.match(stored, /RECURRENCE-ID:20260717T170000Z/);
});

test('calendar scalar domains reject lossy coercions before changing stored content', () => {
  const existing = [
    'BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'UID:strict-existing', 'SUMMARY:Before',
    'DTSTART:20260703T170000Z', 'DTEND:20260703T180000Z', 'END:VEVENT', 'END:VCALENDAR', '',
  ].join('\r\n');
  const invalidChildren = [
    [{ tag: 'AllDayEvent', content: '2' }],
    [{ tag: 'BusyStatus', content: '5' }],
    [{ tag: 'Sensitivity', content: '4' }],
    [{ tag: 'MeetingStatus', content: '2' }],
    [{ tag: 'ResponseRequested', content: '2' }],
    [{ tag: 'DisallowNewTimeProposal', content: '2' }],
    [{ tag: 'Reminder', content: '-1' }],
    [{ tag: 'Reminder', content: '1.5' }],
    [{ tag: 'Reminder', content: '525601' }],
    [{ tag: 'StartTime', content: '20260703T180000Z' }, { tag: 'EndTime', content: '20260703T180000Z' }],
    [{ tag: 'Exceptions', children: [{ tag: 'Exception', children: [
      { tag: 'ExceptionStartTime', content: '20260710T170000Z' },
      { tag: 'Deleted', content: '2' },
    ] }] }],
    [{ tag: 'Exceptions', children: [{ tag: 'Exception', children: [
      { tag: 'ExceptionStartTime', content: '20260710T170000Z' },
      { tag: 'AllDayEvent', content: '2' },
    ] }] }],
    [{ tag: 'Exceptions', children: [{ tag: 'Exception', children: [
      { tag: 'ExceptionStartTime', content: '20260710T170000Z' },
      { tag: 'StartTime', content: '20260710T190000Z' },
      { tag: 'EndTime', content: '20260710T180000Z' },
    ] }] }],
  ];
  for (const children of invalidChildren) {
    let stored = existing;
    assert.throws(() => {
      stored = activeSyncCalendarApplicationDataToIcal('strict-storage-id', { children }, stored);
    }, ActiveSyncCalendarFieldError, JSON.stringify(children));
    assert.equal(stored, existing);
  }
});

test('accepted calendar enums and attendee metadata round-trip without coercion', () => {
  const ical = activeSyncCalendarApplicationDataToIcal('enum-storage-id', { children: [
    { tag: 'UID', content: 'enum-client-id' },
    { tag: 'StartTime', content: '20260703T170000Z' },
    { tag: 'EndTime', content: '20260703T180000Z' },
    { tag: 'BusyStatus', content: '4' },
    { tag: 'Sensitivity', content: '3' },
    { tag: 'MeetingStatus', content: '15' },
    { tag: 'ResponseRequested', content: '1' },
    { tag: 'DisallowNewTimeProposal', content: '1' },
    { tag: 'Attendees', children: [{ tag: 'Attendee', children: [
      { tag: 'Email', content: 'guest@example.test' },
      { tag: 'Name', content: 'Guest Person' },
      { tag: 'AttendeeStatus', content: '4' },
      { tag: 'AttendeeType', content: '3' },
    ] }] },
  ] });
  const outbound = storedIcalEventToActiveSyncApplicationData('enum-storage-id', ical);

  assert.equal(field(outbound, 'UID').content, 'enum-client-id');
  assert.equal(field(outbound, 'BusyStatus').content, '4');
  assert.equal(field(outbound, 'Sensitivity').content, '3');
  assert.equal(field(outbound, 'MeetingStatus').content, '15');
  assert.equal(field(outbound, 'ResponseRequested').content, '1');
  assert.equal(field(outbound, 'DisallowNewTimeProposal').content, '1');
  const attendee = child(field(outbound, 'Attendees'), 'Attendee');
  assert.equal(child(attendee, 'Email').content, 'guest@example.test');
  assert.equal(child(attendee, 'Name').content, 'Guest Person');
  assert.equal(child(attendee, 'AttendeeStatus').content, '4');
  assert.equal(child(attendee, 'AttendeeType').content, '3');
});

test('calendar UID is client identity, remains distinct from storage ServerId, and is bounded', () => {
  const clientUid = 'client-generated-series-identity@example.test';
  const storageUid = 'opaque-deterministic-storage-id';
  const created = activeSyncCalendarApplicationDataToIcal(storageUid, { children: [
    { tag: 'UID', content: clientUid },
    { tag: 'Subject', content: 'UID fidelity' },
    { tag: 'StartTime', content: '20260703T170000Z' },
    { tag: 'EndTime', content: '20260703T180000Z' },
  ] });
  assert.match(created, new RegExp(`UID:${clientUid}`));
  assert.doesNotMatch(created, new RegExp(`UID:${storageUid}`));
  assert.equal(field(storedIcalEventToActiveSyncApplicationData(storageUid, created), 'UID').content, clientUid);

  const changed = activeSyncCalendarApplicationDataToIcal(storageUid, {
    children: [{ tag: 'Subject', content: 'Changed without UID' }],
  }, created);
  assert.match(changed, new RegExp(`UID:${clientUid}`));
  assert.throws(() => activeSyncCalendarApplicationDataToIcal(storageUid, {
    children: [{ tag: 'UID', content: 'u'.repeat(301) }],
  }), ActiveSyncCalendarFieldError);
});

test('DisallowNewTimeProposal round-trips through stable iCalendar metadata', () => {
  const ical = activeSyncCalendarApplicationDataToIcal('proposal-policy', { children: [
    { tag: 'UID', content: 'proposal-policy-client' },
    { tag: 'StartTime', content: '20260703T170000Z' },
    { tag: 'EndTime', content: '20260703T180000Z' },
    { tag: 'DisallowNewTimeProposal', content: '1' },
  ] });
  assert.match(ical, /X-OMS-DISALLOW-NEW-TIME-PROPOSAL:1/);
  assert.equal(field(storedIcalEventToActiveSyncApplicationData('proposal-policy', ical), 'DisallowNewTimeProposal').content, '1');
});

test('stored malformed and EAS-unrepresentable recurrences become item projection errors', () => {
  for (const ical of [
    [
      'BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'UID:unsupported-rule', 'SUMMARY:Unsupported',
      'DTSTART:20260703T170000Z', 'DTEND:20260703T180000Z',
      'RRULE:FREQ=WEEKLY;BYDAY=MO;BYHOUR=9', 'END:VEVENT', 'END:VCALENDAR', '',
    ].join('\r\n'),
    [
      'BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'UID:malformed-date', 'SUMMARY:Malformed',
      'DTSTART:99999999T999999Z', 'DTEND:20260703T180000Z', 'END:VEVENT', 'END:VCALENDAR', '',
    ].join('\r\n'),
  ]) {
    assert.throws(() => storedIcalEventToActiveSyncApplicationData('storage-id', ical), ActiveSyncCalendarFieldError);
  }
});

test('an empty exception Reminder disables the inherited series alarm', () => {
  const ical = activeSyncCalendarApplicationDataToIcal('exception-no-reminder', {
    children: [
      { tag: 'Subject', content: 'Weekly reminder' },
      { tag: 'StartTime', content: '20260703T170000Z' },
      { tag: 'EndTime', content: '20260703T180000Z' },
      { tag: 'Reminder', content: '15' },
      { tag: 'Recurrence', children: [
        { tag: 'Type', content: '1' },
        { tag: 'DayOfWeek', content: '32' },
        { tag: 'Occurrences', content: '2' },
      ] },
      { tag: 'Exceptions', children: [{ tag: 'Exception', children: [
        { tag: 'ExceptionStartTime', content: '20260710T170000Z' },
        { tag: 'StartTime', content: '20260710T180000Z' },
        { tag: 'EndTime', content: '20260710T190000Z' },
        { tag: 'Reminder', content: '' },
      ] }] },
    ],
  });
  const parsed = parseIcalEvent('exception-no-reminder', ical);

  assert.equal(parsed.notifications[0].time, 15);
  assert.equal(parsed.recurrenceExceptions[0].event.notifications, undefined);
  const outboundException = child(field(calendarEventToActiveSyncApplicationData(parsed), 'Exceptions'), 'Exception');
  assert.equal(child(outboundException, 'Reminder').content, '');
});

test('calendar converter requires real WBXML code pages', () => {
  assert.throws(() => convertActiveSyncCalendarApplicationDataToIcal('missing-pages', {
    children: [{ tag: 'Subject', content: 'Missing page' }],
  }), ActiveSyncCalendarFieldError);
});

test('compact calendar dates reject normalization and out-of-range components', () => {
  assert.equal(parseActiveSyncCalendarDate('20260228T235959Z').toISOString(), '2026-02-28T23:59:59.000Z');
  assert.equal(parseActiveSyncCalendarDate('20260230T120000Z'), null);
  assert.equal(parseActiveSyncCalendarDate('20261340T256199Z'), null);
  assert.equal(parseActiveSyncCalendarDate('20260724T170000'), null);

  for (const [tag, invalid] of [
    ['StartTime', '20260230T120000Z'],
    ['EndTime', '20261340T256199Z'],
    ['DtStamp', '20260230T120000Z'],
  ]) {
    assert.throws(() => activeSyncCalendarApplicationDataToIcal(`invalid-${tag}`, {
      children: [{ tag, content: invalid }],
    }), ActiveSyncCalendarFieldError);
  }
  assert.throws(() => activeSyncCalendarApplicationDataToIcal('invalid-until', {
    children: [{ tag: 'Recurrence', children: [
      { tag: 'Type', content: '0' },
      { tag: 'Until', content: '20260230T120000Z' },
    ] }],
  }), ActiveSyncCalendarFieldError);
  assert.throws(() => activeSyncCalendarApplicationDataToIcal('invalid-exception', {
    children: [{ tag: 'Exceptions', children: [{ tag: 'Exception', children: [
      { tag: 'ExceptionStartTime', content: '20261340T256199Z' },
    ] }] }],
  }), ActiveSyncCalendarFieldError);
});

test('calendar recurrence validation rejects coercion and accepts protocol boundaries', () => {
  const convertRecurrence = children => activeSyncCalendarApplicationDataToIcal('recurrence-validation', {
    children: [
      { tag: 'StartTime', content: '20260815T120000Z' },
      { tag: 'EndTime', content: '20260815T130000Z' },
      { tag: 'Recurrence', children },
    ],
  });
  for (const recurrence of [
    [{ tag: 'Type', content: '9' }],
    [{ tag: 'Type', content: '0' }, { tag: 'Occurrences', content: '0' }],
    [{ tag: 'Type', content: '1' }, { tag: 'DayOfWeek', content: '0' }],
    [{ tag: 'Type', content: '2' }],
    [{ tag: 'Type', content: '5' }, { tag: 'DayOfMonth', content: '15' }],
  ]) assert.throws(() => convertRecurrence(recurrence), ActiveSyncCalendarFieldError);

  const zeroInterval = convertRecurrence([
    { tag: 'Type', content: '0' },
    { tag: 'Interval', content: '0' },
  ]);
  assert.match(zeroInterval, /RRULE:FREQ=DAILY/);
  assert.doesNotMatch(zeroInterval, /INTERVAL=0/);

  const boundary = convertRecurrence([
    { tag: 'Type', content: '1' },
    { tag: 'Interval', content: '999' },
    { tag: 'Occurrences', content: '999' },
    { tag: 'DayOfWeek', content: '127' },
    { tag: 'FirstDayOfWeek', content: '6' },
  ]);
  assert.match(boundary, /RRULE:FREQ=WEEKLY;INTERVAL=999;COUNT=999;BYDAY=SU,MO,TU,WE,TH,FR,SA;WKST=SA/);

  const countWins = convertRecurrence([
    { tag: 'Type', content: '0' },
    { tag: 'Occurrences', content: '2' },
    { tag: 'Until', content: '20260816T120000Z' },
  ]);
  assert.match(countWins, /RRULE:FREQ=DAILY;COUNT=2/);
  assert.doesNotMatch(countWins, /UNTIL=/);

  assert.throws(() => activeSyncCalendarApplicationDataToIcal('explicit-empty-recurrence', {
    children: [{ tag: 'Recurrence', children: [] }],
  }, [
    'BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'UID:clear-recurrence', 'DTSTART:20260815T120000Z',
    'DTEND:20260815T130000Z', 'SUMMARY:Clear recurrence', 'RRULE:FREQ=DAILY',
    'END:VEVENT', 'END:VCALENDAR', '',
  ].join('\r\n')), ActiveSyncCalendarFieldError);

  const cleared = activeSyncCalendarApplicationDataToIcal('clear-recurrence', {
    children: [],
  }, [
    'BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'UID:clear-recurrence', 'DTSTART:20260815T120000Z',
    'DTEND:20260815T130000Z', 'SUMMARY:Clear recurrence', 'RRULE:FREQ=DAILY',
    'END:VEVENT', 'END:VCALENDAR', '',
  ].join('\r\n'), new Set(['4:Recurrence']));
  assert.doesNotMatch(cleared, /RRULE:/);
});

test('calendar recurrence preserves 14.1 calendar-system metadata and optional Type 6 weekday', () => {
  const validCalendarTypes = [...Array.from({ length: 13 }, (_, index) => index), 14, 15, 20];
  for (const calendarType of validCalendarTypes) {
    assert.doesNotThrow(() => activeSyncCalendarApplicationDataToIcal(`calendar-type-${calendarType}`, {
      children: [
        { tag: 'StartTime', content: '20260815T120000Z' },
        { tag: 'EndTime', content: '20260815T130000Z' },
        { tag: 'Recurrence', children: [
          { tag: 'Type', content: '2' },
          { tag: 'DayOfMonth', content: '15' },
          { tag: 'CalendarType', content: String(calendarType) },
        ] },
      ],
    }));
  }
  for (const calendarType of [13, 16, 17, 18, 19, 21, 22, 23, 255]) {
    assert.throws(() => activeSyncCalendarApplicationDataToIcal(`reserved-calendar-type-${calendarType}`, {
      children: [{ tag: 'Recurrence', children: [
        { tag: 'Type', content: '2' },
        { tag: 'DayOfMonth', content: '15' },
        { tag: 'CalendarType', content: String(calendarType) },
      ] }],
    }), ActiveSyncCalendarFieldError);
  }

  const stored = activeSyncCalendarApplicationDataToIcal('lunar-type-six', {
    children: [
      { tag: 'StartTime', content: '20260815T120000Z' },
      { tag: 'EndTime', content: '20260815T130000Z' },
      { tag: 'Recurrence', children: [
        { tag: 'Type', content: '6' },
        { tag: 'Interval', content: '0' },
        { tag: 'WeekOfMonth', content: '2' },
        { tag: 'MonthOfYear', content: '11' },
        { tag: 'CalendarType', content: '15' },
        { tag: 'IsLeapMonth', content: '1' },
      ] },
    ],
  });
  assert.match(stored, /RRULE:FREQ=YEARLY;BYDAY=SA;BYSETPOS=2;BYMONTH=11/);
  assert.match(stored, /X-OMS-ACTIVESYNC-CALENDAR-TYPE:15/);
  assert.match(stored, /X-OMS-ACTIVESYNC-IS-LEAP-MONTH:1/);
  assert.match(stored, /X-OMS-ACTIVESYNC-DAY-OF-WEEK-OMITTED:1/);

  const recurrence = field(calendarEventToActiveSyncApplicationData(parseIcalEvent('lunar-type-six', stored)), 'Recurrence');
  const recurrenceValues = new Map(recurrence.children.map(node => [node.tag, node.content]));
  assert.equal(recurrenceValues.get('Type'), '6');
  assert.equal(recurrenceValues.get('Interval'), '1');
  assert.equal(recurrenceValues.get('WeekOfMonth'), '2');
  assert.equal(recurrenceValues.get('MonthOfYear'), '11');
  assert.equal(recurrenceValues.get('CalendarType'), '15');
  assert.equal(recurrenceValues.get('IsLeapMonth'), '1');
  assert.equal(recurrenceValues.has('DayOfWeek'), false);

  for (const rule of [
    'FREQ=MONTHLY;BYMONTHDAY=15',
    'FREQ=MONTHLY;BYDAY=TU;BYSETPOS=2',
    'FREQ=YEARLY;BYMONTH=11;BYMONTHDAY=15',
    'FREQ=YEARLY;BYMONTH=11;BYDAY=TU;BYSETPOS=2',
  ]) {
    const parsed = parseIcalEvent('gregorian-default', [
      'BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'UID:gregorian-default', 'SUMMARY:Gregorian default',
      'DTSTART:20260815T120000Z', 'DTEND:20260815T130000Z', `RRULE:${rule}`,
      'END:VEVENT', 'END:VCALENDAR', '',
    ].join('\r\n'));
    assert.equal(child(field(calendarEventToActiveSyncApplicationData(parsed), 'Recurrence'), 'CalendarType').content, '1');
  }

  for (const invalidChildren of [
    [{ tag: 'Type', content: '1' }, { tag: 'DayOfWeek', content: '2' }, { tag: 'CalendarType', content: '1' }],
    [{ tag: 'Type', content: '2' }, { tag: 'DayOfMonth', content: '1' }, { tag: 'IsLeapMonth', content: '1' }],
    [{ tag: 'Type', content: '5' }, { tag: 'DayOfMonth', content: '1' }, { tag: 'MonthOfYear', content: '1' }, { tag: 'IsLeapMonth', content: '2' }],
  ]) {
    assert.throws(() => activeSyncCalendarApplicationDataToIcal('invalid-calendar-system', {
      children: [{ tag: 'Recurrence', children: invalidChildren }],
    }), ActiveSyncCalendarFieldError);
  }
});

test('calendar 14.1 rejects response-only request properties at both exception depths', () => {
  for (const tag of ['OnlineMeetingConfLink', 'OnlineMeetingExternalLink', 'AppointmentReplyTime', 'ResponseType']) {
    assert.throws(() => activeSyncCalendarApplicationDataToIcal(`response-only-${tag}`, {
      children: [{ tag, content: tag.includes('Time') ? '20260815T120000Z' : 'https://meeting.example.test' }],
    }), ActiveSyncCalendarFieldError);
    assert.throws(() => activeSyncCalendarApplicationDataToIcal(`response-only-exception-${tag}`, {
      children: [{ tag: 'Exceptions', children: [{ tag: 'Exception', children: [
        { tag: 'ExceptionStartTime', content: '20260815T120000Z' },
        { tag, content: tag.includes('Time') ? '20260815T120000Z' : '1' },
      ] }] }],
    }), ActiveSyncCalendarFieldError);
  }
});

test('calendar recurrence preserves multi-day and relative rule semantics across ActiveSync', () => {
  const outboundRecurrence = rule => {
    const parsed = parseIcalEvent('advanced-recurrence', [
      'BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'UID:advanced-recurrence', 'SUMMARY:Advanced recurrence',
      'DTSTART:20260803T120000Z', 'DTEND:20260803T130000Z', `RRULE:${rule}`,
      'END:VEVENT', 'END:VCALENDAR', '',
    ].join('\r\n'));
    return field(calendarEventToActiveSyncApplicationData(parsed), 'Recurrence');
  };
  const values = recurrence => new Map(recurrence.children.map(node => [node.tag, node.content]));

  const typeZeroWeekdayIcal = activeSyncCalendarApplicationDataToIcal('advanced-recurrence', {
    children: [
      { tag: 'StartTime', content: '20260803T120000Z' },
      { tag: 'EndTime', content: '20260803T130000Z' },
      { tag: 'Recurrence', children: [
        { tag: 'Type', content: '0' },
        { tag: 'Interval', content: '2' },
        { tag: 'DayOfWeek', content: '62' },
        { tag: 'Occurrences', content: '5' },
      ] },
    ],
  });
  assert.match(typeZeroWeekdayIcal, /RRULE:FREQ=WEEKLY;INTERVAL=2;COUNT=5;BYDAY=MO,TU,WE,TH,FR/);
  const typeZeroWeekday = values(field(
    calendarEventToActiveSyncApplicationData(parseIcalEvent('advanced-recurrence', typeZeroWeekdayIcal)),
    'Recurrence',
  ));
  assert.equal(typeZeroWeekday.get('Type'), '1');
  assert.equal(typeZeroWeekday.get('Interval'), '2');
  assert.equal(typeZeroWeekday.get('DayOfWeek'), '62');

  const weekly = values(outboundRecurrence('FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE,FR;COUNT=6'));
  assert.equal(weekly.get('Type'), '1');
  assert.equal(weekly.get('DayOfWeek'), '42');
  assert.equal(weekly.get('Occurrences'), '6');

  const secondTuesdayNode = outboundRecurrence('FREQ=MONTHLY;BYDAY=TU;BYSETPOS=2;COUNT=4');
  const secondTuesday = values(secondTuesdayNode);
  assert.equal(secondTuesday.get('Type'), '3');
  assert.equal(secondTuesday.get('DayOfWeek'), '4');
  assert.equal(secondTuesday.get('WeekOfMonth'), '2');
  const secondTuesdayRoundTrip = activeSyncCalendarApplicationDataToIcal('advanced-recurrence', {
    children: [
      { tag: 'StartTime', content: '20260803T120000Z' },
      { tag: 'EndTime', content: '20260803T130000Z' },
      secondTuesdayNode,
    ],
  });
  assert.match(secondTuesdayRoundTrip, /RRULE:FREQ=MONTHLY;COUNT=4;BYDAY=TU;BYSETPOS=2/);

  const lastWeekdayNode = outboundRecurrence('FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1');
  const lastWeekday = values(lastWeekdayNode);
  assert.equal(lastWeekday.get('Type'), '3');
  assert.equal(lastWeekday.get('DayOfWeek'), '62');
  assert.equal(lastWeekday.get('WeekOfMonth'), '5');
  const lastWeekdayRoundTrip = activeSyncCalendarApplicationDataToIcal('advanced-recurrence', {
    children: [
      { tag: 'StartTime', content: '20260803T120000Z' },
      { tag: 'EndTime', content: '20260803T130000Z' },
      lastWeekdayNode,
    ],
  });
  assert.match(lastWeekdayRoundTrip, /RRULE:FREQ=MONTHLY;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1/);

  const yearlyNode = outboundRecurrence('FREQ=YEARLY;BYMONTH=11;BYDAY=TH;BYSETPOS=4;COUNT=3');
  const yearly = values(yearlyNode);
  assert.equal(yearly.get('Type'), '6');
  assert.equal(yearly.get('DayOfWeek'), '16');
  assert.equal(yearly.get('WeekOfMonth'), '4');
  assert.equal(yearly.get('MonthOfYear'), '11');
  const yearlyRoundTrip = activeSyncCalendarApplicationDataToIcal('advanced-recurrence', {
    children: [
      { tag: 'StartTime', content: '20260803T120000Z' },
      { tag: 'EndTime', content: '20260803T130000Z' },
      yearlyNode,
    ],
  });
  assert.match(yearlyRoundTrip, /RRULE:FREQ=YEARLY;COUNT=3;BYDAY=TH;BYSETPOS=4;BYMONTH=11/);

  assert.throws(
    () => outboundRecurrence('FREQ=MONTHLY;BYMONTHDAY=1,15'),
    ActiveSyncCalendarFieldError,
  );
  assert.throws(
    () => outboundRecurrence('FREQ=WEEKLY;BYDAY=MO;BYHOUR=9'),
    ActiveSyncCalendarFieldError,
  );
});

test('calendar 14.1 exception writable fields and explicit clears round-trip without inheritance', () => {
  const stored = activeSyncCalendarApplicationDataToIcal('rich-exception', {
    children: [
      { tag: 'Subject', content: 'Master subject' },
      { tag: 'Location', content: 'Master room' },
      { tag: 'StartTime', content: '20260815T120000Z' },
      { tag: 'EndTime', content: '20260815T130000Z' },
      { tag: 'DtStamp', content: '20260801T120000Z' },
      { tag: 'Body', children: [{ tag: 'Type', content: '1' }, { tag: 'Data', content: 'Master body' }] },
      { tag: 'Categories', children: [{ tag: 'Category', content: 'Master' }] },
      { tag: 'Sensitivity', content: '0' },
      { tag: 'BusyStatus', content: '2' },
      { tag: 'MeetingStatus', content: '1' },
      { tag: 'Reminder', content: '15' },
      { tag: 'Attendees', children: [{ tag: 'Attendee', children: [
        { tag: 'Email', content: 'master@example.test' }, { tag: 'AttendeeStatus', content: '3' },
        { tag: 'AttendeeType', content: '1' },
      ] }] },
      { tag: 'Recurrence', children: [
        { tag: 'Type', content: '1' }, { tag: 'DayOfWeek', content: '64' }, { tag: 'Occurrences', content: '3' },
      ] },
      { tag: 'Exceptions', children: [
        { tag: 'Exception', children: [
          { tag: 'ExceptionStartTime', content: '20260822T120000Z' },
          { tag: 'StartTime', content: '20260822T140000Z' },
          { tag: 'EndTime', content: '20260822T150000Z' },
          { tag: 'DtStamp', content: '20260802T120000Z' },
          { tag: 'Subject', content: 'Exception subject' },
          { tag: 'Location', content: 'Exception room' },
          { tag: 'Body', children: [{ tag: 'Type', content: '1' }, { tag: 'Data', content: 'Exception body' }] },
          { tag: 'Categories', children: [{ tag: 'Category', content: 'VIP,Special' }] },
          { tag: 'Sensitivity', content: '2' },
          { tag: 'BusyStatus', content: '0' },
          { tag: 'MeetingStatus', content: '3' },
          { tag: 'Reminder', content: '5' },
          { tag: 'Attendees', children: [{ tag: 'Attendee', children: [
            { tag: 'Email', content: 'exception@example.test' }, { tag: 'Name', content: 'Exception Person' },
            { tag: 'AttendeeStatus', content: '2' }, { tag: 'AttendeeType', content: '2' },
          ] }] },
        ] },
        { tag: 'Exception', children: [
          { tag: 'ExceptionStartTime', content: '20260829T120000Z' },
          { tag: 'Subject', content: '' },
          { tag: 'Location', content: '' },
          { tag: 'Body', children: [{ tag: 'Type', content: '1' }, { tag: 'Data', content: '' }] },
          { tag: 'Categories', children: [] },
          { tag: 'Attendees', children: [] },
          { tag: 'Reminder', content: '' },
        ] },
      ] },
    ],
  });

  const parsed = parseIcalEvent('rich-exception', stored);
  const rich = parsed.recurrenceExceptions[0].event;
  assert.equal(rich.description, 'Exception body');
  assert.deepEqual(rich.categories, ['VIP,Special']);
  assert.equal(rich.sensitivity, '2');
  assert.equal(rich.activeSyncBusyStatus, '0');
  assert.equal(rich.meetingStatus, '3');
  assert.equal(rich.dtstamp.toISOString(), '2026-08-02T12:00:00.000Z');
  assert.deepEqual(rich.activeSyncAttendees, [{
    email: 'exception@example.test', name: 'Exception Person', status: '2', type: '2',
  }]);

  const cleared = parsed.recurrenceExceptions[1].event;
  assert.equal(cleared.title, '');
  assert.equal(cleared.location, '');
  assert.equal(cleared.description, '');
  assert.deepEqual(cleared.categories, []);
  assert.deepEqual(cleared.activeSyncAttendees, []);
  assert.equal(cleared.notifications, undefined);

  const outbound = field(calendarEventToActiveSyncApplicationData(parsed), 'Exceptions').children;
  const richOutbound = outbound[0];
  assert.equal(child(child(richOutbound, 'Body'), 'Data').content, 'Exception body');
  assert.deepEqual(child(richOutbound, 'Categories').children.map(node => node.content), ['VIP,Special']);
  assert.equal(child(richOutbound, 'Sensitivity').content, '2');
  assert.equal(child(richOutbound, 'BusyStatus').content, '0');
  assert.equal(child(richOutbound, 'DtStamp').content, '20260802T120000Z');
  assert.equal(child(richOutbound, 'MeetingStatus').content, '3');
  assert.equal(child(child(richOutbound, 'Attendees'), 'Attendee').children[0].content, 'exception@example.test');

  const clearedOutbound = outbound[1];
  assert.equal(child(clearedOutbound, 'Subject').content, '');
  assert.equal(child(clearedOutbound, 'Location').content, '');
  assert.equal(child(child(clearedOutbound, 'Body'), 'Data').content, '');
  assert.deepEqual(child(clearedOutbound, 'Categories').children, []);
  assert.deepEqual(child(clearedOutbound, 'Attendees').children, []);
  assert.equal(child(clearedOutbound, 'Reminder').content, '');
});

test('calendar exception output allows 256 entries and rejects larger sources for quarantine', () => {
  const event = parseIcalEvent('exception-limit', [
    'BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'UID:exception-limit', 'SUMMARY:Exception limit',
    'DTSTART:20260815T120000Z', 'DTEND:20260815T130000Z', 'RRULE:FREQ=DAILY',
    'END:VEVENT', 'END:VCALENDAR', '',
  ].join('\r\n'));
  event.excludedOccurrenceIds = new Set(Array.from({ length: 256 }, (_, index) => {
    const date = new Date(Date.UTC(2026, 7, 16 + index, 12));
    return date.toISOString().replace(/[-:]/g, '').replace(/\.000/, '');
  }));
  assert.equal(field(calendarEventToActiveSyncApplicationData(event), 'Exceptions').children.length, 256);
  event.excludedOccurrenceIds.add('20270501T120000Z');
  assert.throws(() => calendarEventToActiveSyncApplicationData(event), ActiveSyncCalendarFieldError);

  assert.throws(() => activeSyncCalendarApplicationDataToIcal('too-many-client-exceptions', {
    children: [{ tag: 'Exceptions', children: Array.from({ length: 257 }, (_, index) => ({
      tag: 'Exception', children: [{
        tag: 'ExceptionStartTime',
        content: new Date(Date.UTC(2026, 7, 16 + index, 12)).toISOString().replace(/[-:]/g, '').replace(/\.000/, ''),
      }],
    })) }],
  }), ActiveSyncCalendarFieldError);

  const storedLines = [
    'BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'UID:stored-exception-overflow', 'SUMMARY:Stored overflow',
    'DTSTART:20260815T120000Z', 'DTEND:20260815T130000Z', 'RRULE:FREQ=DAILY', 'END:VEVENT',
  ];
  for (let index = 0; index < 257; index += 1) {
    const occurrenceId = new Date(Date.UTC(2026, 7, 16 + index, 12))
      .toISOString().replace(/[-:]/g, '').replace(/\.000/, '');
    storedLines.push(
      'BEGIN:VEVENT', 'UID:stored-exception-overflow', `RECURRENCE-ID:${occurrenceId}`,
      `DTSTART:${occurrenceId}`, `DTEND:${new Date(Date.parse(occurrenceId.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, '$1-$2-$3T$4:$5:$6Z')) + 3600000).toISOString().replace(/[-:]/g, '').replace(/\.000/, '')}`,
      'SUMMARY:Overflow exception', 'END:VEVENT',
    );
  }
  storedLines.push('END:VCALENDAR', '');
  assert.throws(
    () => storedIcalEventToActiveSyncApplicationData('stored-exception-overflow', storedLines.join('\r\n')),
    ActiveSyncCalendarFieldError,
  );
});

test('calendar structured controls are rejected while Body newlines are normalized', () => {
  assert.throws(() => activeSyncCalendarApplicationDataToIcal('calendar-injection', {
    children: [{ tag: 'Subject', content: 'Safe\r\nATTENDEE:mailto:injected@example.test' }],
  }), ActiveSyncCalendarFieldError);
  const ical = activeSyncCalendarApplicationDataToIcal('calendar-body-newlines', {
    children: [{ tag: 'Body', children: [{ tag: 'Data', content: 'first\r\nsecond\rthird\nfourth\tindented' }] }],
  });
  assert.match(ical, /DESCRIPTION:first\\nsecond\\nthird\\nfourth\tindented\r\n/);
});

test('maximum bounded stored calendar content fits in one PIM response', () => {
  const event = parseIcalEvent('bounded-wire-event', [
    'BEGIN:VCALENDAR', 'BEGIN:VEVENT', 'UID:bounded-wire-event', 'SUMMARY:Bounded wire event',
    'DTSTART:20260815T120000Z', 'DTEND:20260815T130000Z', 'RRULE:FREQ=WEEKLY;COUNT=200',
    'END:VEVENT', 'END:VCALENDAR', '',
  ].join('\r\n'));
  event.description = 'd'.repeat(MAX_ACTIVE_SYNC_CALENDAR_BODY_BYTES + 1024);
  event.categories = Array.from({ length: 128 }, (_, index) => `category-${index}-${'c'.repeat(8192)}`);
  event.attendees = Array.from({ length: 128 }, (_, index) => `person-${index}@${'a'.repeat(900)}.test`).join(', ');
  event.recurrenceExceptions = Array.from({ length: 128 }, (_, index) => ({
    recurrenceId: new Date(Date.UTC(2026, 7, 15 + index * 7, 12)),
    deleted: false,
    event: {
      ...event,
      uid: `bounded-wire-event-${index}`,
      title: `exception-${index}-${'s'.repeat(8192)}`,
      location: `location-${index}-${'l'.repeat(8192)}`,
      start: new Date(Date.UTC(2026, 7, 15 + index * 7, 12)),
      end: new Date(Date.UTC(2026, 7, 15 + index * 7, 13)),
      recurrenceExceptions: [],
      excludedOccurrenceIds: new Set(),
    },
  }));
  const applicationData = calendarEventToActiveSyncApplicationData(event);
  const writer = new WbxmlWriter();
  writer.writeNode({ tag: 'Add', page: 0, children: [
    { tag: 'ServerId', page: 0, content: 'a'.repeat(64) },
    { tag: 'ApplicationData', page: 0, children: applicationData },
  ] });
  const encoded = writer.getBuffer();
  assert.equal(encoded.length < MAX_PIM_SYNC_RESPONSE_BYTES, true);
  assert.equal(encoded.length > 2 * 1024 * 1024, true);
});
