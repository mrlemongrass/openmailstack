const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const ts = require('typescript');

const sourcePath = path.join(__dirname, '../src/calendar/calendarTime.ts');
const source = fs.readFileSync(sourcePath, 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const moduleUnderTest = { exports: {} };
new Function('module', 'exports', 'require', compiled)(moduleUnderTest, moduleUnderTest.exports, require);

const {
  addWallDays,
  buildCalendarEventIcal,
  calendarEventDraftForEdit,
  calendarEventPresentation,
  eventUidForSave,
  convertWallDateTimeZone,
  formatIcalDateProperty,
  projectInstantToWallDate,
  recurrenceChoice,
  recurrenceSummary,
  resolveDisplayTimeZone,
  wallDateToInstant,
} = moduleUnderTest.exports;

test('whole-series edit restores the master all-day state', () => {
  const draft = calendarEventDraftForEdit({
    id: 'series',
    calendarId: 1,
    title: 'All-day exception',
    start: new Date('2027-03-12T00:00:00Z'),
    end: new Date('2027-03-13T00:00:00Z'),
    isAllDay: true,
    timeKind: 'all-day',
    seriesStart: new Date('2027-03-05T14:00:00Z'),
    seriesEnd: new Date('2027-03-05T15:00:00Z'),
    seriesTitle: 'Timed master',
    seriesIsAllDay: false,
    seriesTimeKind: 'zoned',
    seriesTimeZone: 'America/New_York',
  }, 'Asia/Baghdad');

  assert.equal(draft.title, 'Timed master');
  assert.equal(draft.isAllDay, false);
  assert.equal(draft.timeKind, 'zoned');
  assert.equal(draft.timeZone, 'America/New_York');
});

test('recurring events use human labels without leaking raw RRULE text', () => {
  const recurrence = 'FREQ=WEEKLY;UNTIL=20260323T045959Z';
  const presentation = calendarEventPresentation({
    title: 'OMS macOS DST Weekly',
    start: new Date(2026, 2, 1, 17, 0, 0),
    isAllDay: false,
    recurrence,
    recurrenceLabel: 'Every week',
  }, '24h');

  assert.equal(recurrenceChoice(recurrence), 'weekly');
  assert.equal(recurrenceSummary(recurrence, 'Every week'), 'Repeats every week');
  assert.equal(recurrenceSummary('FREQ=DAILY'), 'Repeats every day');
  assert.equal(recurrenceSummary('COUNT=3;FREQ=MONTHLY'), 'Repeats every month');
  assert.equal(recurrenceSummary('FREQ=YEARLY;COUNT=2'), 'Repeats every year');
  assert.equal(presentation.text, '17:00 OMS macOS DST Weekly');
  assert.equal(presentation.title, '17:00 OMS macOS DST Weekly\nRepeats every week');
  assert.doesNotMatch(presentation.text, /FREQ=|UNTIL=/);
  assert.doesNotMatch(presentation.title, /FREQ=|UNTIL=/);
});

test('editing an event preserves its existing UID without adding another suffix', () => {
  let generated = false;
  const uid = eventUidForSave('10f2e6ac@openmailstack', () => {
    generated = true;
    return 'replacement';
  });

  assert.equal(uid, '10f2e6ac@openmailstack');
  assert.equal(generated, false);
  assert.equal(eventUidForSave('  byte-for-byte  ', () => 'replacement'), '  byte-for-byte  ');
  assert.equal(eventUidForSave(undefined, () => 'new-event'), 'new-event@openmailstack');
});

test('editing a recurring event preserves its UID and complete recurrence rule', () => {
  const ical = buildCalendarEventIcal({
    title: 'Weekly planning',
    start: new Date(2027, 2, 5, 9, 0, 0),
    end: new Date(2027, 2, 5, 10, 0, 0),
    timeKind: 'zoned',
    timeZone: 'America/New_York',
    recurrence: 'FREQ=WEEKLY;COUNT=4',
  }, 'America/New_York', 'series@openmailstack', () => 'replacement');

  assert.match(ical, /\r\nUID:series@openmailstack\r\n/);
  assert.match(ical, /\r\nRRULE:FREQ=WEEKLY;COUNT=4\r\n/);
  assert.doesNotMatch(ical, /FREQ=FREQ=/);
});

test('editing preserves a raw recurrence rule when FREQ is not the first part', () => {
  const recurrence = 'UNTIL=20260323T045959Z;INTERVAL=2;FREQ=WEEKLY';
  const ical = buildCalendarEventIcal({
    title: 'Client-authored recurrence',
    start: new Date(2026, 2, 1, 9, 0, 0),
    end: new Date(2026, 2, 1, 10, 0, 0),
    timeKind: 'zoned',
    timeZone: 'America/New_York',
    recurrence,
  }, 'America/New_York', 'series@openmailstack', () => 'replacement');

  assert.match(ical, new RegExp(`\\r\\nRRULE:${recurrence}\\r\\n`));
  assert.doesNotMatch(ical, /FREQ=UNTIL=/);
});

test('calendar serialization emits the selected display reminder', () => {
  const ical = buildCalendarEventIcal({
    title: 'Reminder event',
    start: new Date(2026, 6, 24, 20, 0, 0),
    end: new Date(2026, 6, 24, 21, 0, 0),
    timeKind: 'zoned',
    timeZone: 'Asia/Baghdad',
    notifications: [{ id: 1, type: 'notification', time: 10 }],
  }, 'Asia/Baghdad', 'reminder@openmailstack');

  assert.match(ical, /BEGIN:VALARM\r\nACTION:DISPLAY\r\nTRIGGER:-PT10M\r\nDESCRIPTION:Reminder event\r\nEND:VALARM/);
});

test('calendar serialization distinguishes an at-start reminder from no reminder', () => {
  const withReminder = buildCalendarEventIcal({
    title: 'Starts now',
    start: new Date(2026, 6, 24, 20, 0, 0),
    end: new Date(2026, 6, 24, 21, 0, 0),
    timeKind: 'zoned',
    timeZone: 'Asia/Baghdad',
    notifications: [{ id: 1, type: 'notification', time: 0 }],
  }, 'Asia/Baghdad', 'starts-now');
  const withoutReminder = buildCalendarEventIcal({
    title: 'No alarm',
    start: new Date(2026, 6, 24, 20, 0, 0),
    end: new Date(2026, 6, 24, 21, 0, 0),
    timeKind: 'zoned',
    timeZone: 'Asia/Baghdad',
  }, 'Asia/Baghdad', 'no-alarm');

  assert.match(withReminder, /TRIGGER:-PT0M/);
  assert.doesNotMatch(withoutReminder, /BEGIN:VALARM/);
});

test('whole-series edits preserve VTIMEZONE, EXDATE, and RECURRENCE-ID components', () => {
  const rawIcal = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'BEGIN:VTIMEZONE',
    'TZID:OMS-Eastern',
    'X-LIC-LOCATION:America/New_York',
    'BEGIN:STANDARD',
    'DTSTART:19701101T020000',
    'TZOFFSETFROM:-0400',
    'TZOFFSETTO:-0500',
    'END:STANDARD',
    'END:VTIMEZONE',
    'BEGIN:VEVENT',
    'UID:preserve-series',
    'DTSTART;TZID=OMS-Eastern:20260703T090000',
    'DTEND;TZID=OMS-Eastern:20260703T100000',
    'SUMMARY:Before edit',
    'RRULE:FREQ=WEEKLY;COUNT=3',
    'EXDATE;TZID=OMS-Eastern:20260710T090000',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:preserve-series',
    'RECURRENCE-ID;TZID=OMS-Eastern:20260717T090000',
    'DTSTART;TZID=OMS-Eastern:20260717T110000',
    'DTEND;TZID=OMS-Eastern:20260717T120000',
    'SUMMARY:Moved occurrence',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
  const ical = buildCalendarEventIcal({
    title: 'After edit',
    start: new Date(2026, 6, 3, 9, 0, 0),
    end: new Date(2026, 6, 3, 10, 0, 0),
    timeKind: 'zoned',
    timeZone: 'America/New_York',
    sourceTimeZone: 'OMS-Eastern',
    timeZoneStatus: 'canonicalized',
    recurrence: 'FREQ=WEEKLY;COUNT=3',
    rawIcal,
  }, 'America/New_York', 'preserve-series');

  assert.match(ical, /BEGIN:VTIMEZONE\r\nTZID:OMS-Eastern/);
  assert.match(ical, /DTSTART;TZID=OMS-Eastern:20260703T090000/);
  assert.match(ical, /EXDATE;TZID=OMS-Eastern:20260710T090000/);
  assert.match(ical, /RECURRENCE-ID;TZID=OMS-Eastern:20260717T090000/);
  assert.match(ical, /SUMMARY:Moved occurrence/);
});

test('changing a master zone retains VTIMEZONE definitions used by preserved exceptions', () => {
  const rawIcal = [
    'BEGIN:VCALENDAR',
    'BEGIN:VTIMEZONE',
    'TZID:OMS-Eastern',
    'BEGIN:STANDARD',
    'DTSTART:19701101T020000',
    'TZOFFSETFROM:-0400',
    'TZOFFSETTO:-0500',
    'END:STANDARD',
    'END:VTIMEZONE',
    'BEGIN:VEVENT',
    'UID:zone-change',
    'DTSTART;TZID=OMS-Eastern:20260703T090000',
    'DTEND;TZID=OMS-Eastern:20260703T100000',
    'SUMMARY:Before',
    'RRULE:FREQ=WEEKLY;COUNT=2',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:zone-change',
    'RECURRENCE-ID;TZID=OMS-Eastern:20260710T090000',
    'DTSTART;TZID=OMS-Eastern:20260710T110000',
    'DTEND;TZID=OMS-Eastern:20260710T120000',
    'SUMMARY:Exception',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
  const ical = buildCalendarEventIcal({
    title: 'After',
    start: new Date(2026, 6, 3, 20, 0, 0),
    end: new Date(2026, 6, 3, 21, 0, 0),
    timeKind: 'zoned',
    timeZone: 'Asia/Baghdad',
    recurrence: 'FREQ=WEEKLY;COUNT=2',
    rawIcal,
  }, 'Asia/Baghdad', 'zone-change');

  assert.match(ical, /DTSTART;TZID=Asia\/Baghdad:20260703T200000/);
  assert.match(ical, /BEGIN:VTIMEZONE\r\nTZID:OMS-Eastern/);
  assert.match(ical, /RECURRENCE-ID;TZID=OMS-Eastern:20260710T090000/);
});

test('resolveDisplayTimeZone chooses the browser system zone or saved home zone', () => {
  assert.equal(resolveDisplayTimeZone({ timeZoneMode: 'system', timeZone: 'Asia/Baghdad' }, 'America/Phoenix'), 'America/Phoenix');
  assert.equal(resolveDisplayTimeZone({ timeZoneMode: 'home', timeZone: 'Asia/Baghdad' }, 'America/Phoenix'), 'Asia/Baghdad');
});

test('projectInstantToWallDate renders one instant in the selected display zone', () => {
  const instant = new Date('2026-07-24T17:00:00.000Z');
  const baghdad = projectInstantToWallDate(instant, 'zoned', 'Asia/Baghdad');
  const phoenix = projectInstantToWallDate(instant, 'zoned', 'America/Phoenix');

  assert.deepEqual(
    [baghdad.getFullYear(), baghdad.getMonth() + 1, baghdad.getDate(), baghdad.getHours(), baghdad.getMinutes()],
    [2026, 7, 24, 20, 0]
  );
  assert.deepEqual(
    [phoenix.getFullYear(), phoenix.getMonth() + 1, phoenix.getDate(), phoenix.getHours(), phoenix.getMinutes()],
    [2026, 7, 24, 10, 0]
  );
});

test('floating values keep their wall time when the display zone changes', () => {
  const floating = new Date('2026-07-24T16:00:00.000Z');
  const projected = projectInstantToWallDate(floating, 'floating', 'Asia/Baghdad');
  assert.deepEqual(
    [projected.getFullYear(), projected.getMonth() + 1, projected.getDate(), projected.getHours()],
    [2026, 7, 24, 16]
  );
});

test('wallDateToInstant and iCalendar serialization preserve explicit event semantics', () => {
  const wallDate = new Date(2026, 6, 24, 20, 0, 0);
  assert.equal(wallDateToInstant(wallDate, 'zoned', 'Asia/Baghdad').toISOString(), '2026-07-24T17:00:00.000Z');
  assert.equal(formatIcalDateProperty('DTSTART', wallDate, 'zoned', 'Asia/Baghdad'), 'DTSTART;TZID=Asia/Baghdad:20260724T200000');
  assert.equal(formatIcalDateProperty('DTSTART', wallDate, 'floating', null), 'DTSTART:20260724T200000');
  assert.equal(formatIcalDateProperty('DTSTART', wallDate, 'utc', 'UTC'), 'DTSTART:20260724T200000Z');
  assert.equal(formatIcalDateProperty('DTSTART', wallDate, 'all-day', null), 'DTSTART;VALUE=DATE:20260724');
});

test('wallDateToInstant follows iCalendar DST gap and overlap rules', () => {
  const gap = new Date(2026, 2, 8, 2, 30, 0);
  const overlap = new Date(2026, 10, 1, 1, 30, 0);

  assert.equal(wallDateToInstant(gap, 'zoned', 'America/New_York').toISOString(), '2026-03-08T07:30:00.000Z');
  assert.equal(wallDateToInstant(overlap, 'zoned', 'America/New_York').toISOString(), '2026-11-01T05:30:00.000Z');
});

test('addWallDays keeps all-day ranges exclusive with calendar-date arithmetic', () => {
  const start = new Date(2026, 2, 7, 0, 0, 0);
  const end = addWallDays(start, 2);
  assert.deepEqual([end.getFullYear(), end.getMonth() + 1, end.getDate()], [2026, 3, 9]);
});

test('event timezone conversion preserves instants, while floating assignment preserves wall time', () => {
  const baghdadWall = new Date(2026, 6, 24, 20, 0, 0);
  const phoenixWall = convertWallDateTimeZone(baghdadWall, 'zoned', 'Asia/Baghdad', 'zoned', 'America/Phoenix');
  assert.deepEqual(
    [phoenixWall.getFullYear(), phoenixWall.getMonth() + 1, phoenixWall.getDate(), phoenixWall.getHours()],
    [2026, 7, 24, 10]
  );

  const floatingToBaghdad = convertWallDateTimeZone(baghdadWall, 'floating', null, 'zoned', 'Asia/Baghdad');
  assert.deepEqual(
    [floatingToBaghdad.getFullYear(), floatingToBaghdad.getMonth() + 1, floatingToBaghdad.getDate(), floatingToBaghdad.getHours()],
    [2026, 7, 24, 20]
  );
});
