const test = require('node:test');
const assert = require('node:assert/strict');

const { calendarEventEtag } = require('../src/dav-etag.js');

test('calendarEventEtag changes when the iCalendar payload changes', () => {
  const uid = 'F8F01D2981384B189CB457103D993862';
  const original = calendarEventEtag({
    uid,
    ical_data: [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      `UID:${uid}`,
      'DTSTART:20260711T150000Z',
      'SUMMARY:OMS iPhone Calendar Test',
      'END:VEVENT',
      'END:VCALENDAR'
    ].join('\r\n')
  });
  const edited = calendarEventEtag({
    uid,
    ical_data: [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      `UID:${uid}`,
      'DTSTART:20260711T153000Z',
      'SUMMARY:OMS iPhone Calendar Test Edited',
      'END:VEVENT',
      'END:VCALENDAR'
    ].join('\r\n')
  });

  assert.notEqual(edited, original);
  assert.match(edited, new RegExp(`^"${uid}-[a-f0-9]{24}"$`));
});

test('calendarEventEtag is stable for the same event version', () => {
  const event = {
    uid: 'same-event',
    ical_data: 'BEGIN:VCALENDAR\r\nSUMMARY:Stable\r\nEND:VCALENDAR',
    updated_at: '2026-07-11T01:57:31.000Z'
  };

  assert.equal(calendarEventEtag(event), calendarEventEtag(event));
});
