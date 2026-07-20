const test = require('node:test');
const assert = require('node:assert/strict');

const {
  activeSyncCalendarApplicationDataToIcal,
  calendarEventToActiveSyncApplicationData,
} = require('../src/eas-calendar.js');
const { parseIcalEvent } = require('../src/calendar-format.js');

const child = (node, tag) => node.children?.find((candidate) => candidate.tag === tag);
const field = (nodes, tag) => nodes.find((node) => node.tag === tag);

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
