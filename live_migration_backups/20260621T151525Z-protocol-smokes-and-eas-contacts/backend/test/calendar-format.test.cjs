const test = require('node:test');
const assert = require('node:assert/strict');

const {
  formatActiveSyncDate,
  getCalendarFolderSyncKey,
  parseIcalEvent,
  slugifyCalendarName,
} = require('../src/calendar-format.js');

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
});

test('formatActiveSyncDate uses ActiveSync UTC timestamp shape', () => {
  assert.equal(formatActiveSyncDate(new Date('2026-07-04T19:00:00.123Z')), '2026-07-04T19:00:00.000Z');
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
