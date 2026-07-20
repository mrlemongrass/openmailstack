const test = require('node:test');
const assert = require('node:assert/strict');

const {
  activeSyncCalendarApplicationDataToIcal,
  calendarEventToActiveSyncApplicationData,
} = require('../src/eas-calendar.js');
const { expandRecurringEvent, parseIcalEvent } = require('../src/calendar-format.js');

const child = (node, tag) => node.children?.find((candidate) => candidate.tag === tag);
const field = (nodes, tag) => nodes.find((node) => node.tag === tag);
const systemTime = (buffer, offset) => Array.from({ length: 8 }, (_, index) => buffer.readUInt16LE(offset + index * 2));

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
        { tag: 'Occurrences', content: '4' },
      ] },
    ],
  });
  const parsed = parseIcalEvent('ios-recurring', ical);

  assert.equal(parsed.description, 'From iOS');
  assert.equal(parsed.recurrence.raw, 'FREQ=WEEKLY;INTERVAL=2;COUNT=4');
});
