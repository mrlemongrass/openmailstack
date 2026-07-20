const test = require('node:test');
const assert = require('node:assert/strict');

const { WbxmlWriter } = require('../src/wbxml/writer.js');
const { WbxmlParser } = require('../src/wbxml/parser.js');
const { parseIcalEvent } = require('../src/calendar-format.js');
const { calendarEventToActiveSyncApplicationData } = require('../src/eas-calendar.js');

test('ActiveSync read flag change responses encode Read in the Email code page', () => {
  const writer = new WbxmlWriter();

  assert.doesNotThrow(() => writer.writeNode({
    tag: 'Sync',
    page: 0,
    children: [
      {
        tag: 'Collections',
        page: 0,
        children: [
          {
            tag: 'Collection',
            page: 0,
            children: [
              { tag: 'Class', page: 0, content: 'Email' },
              { tag: 'SyncKey', page: 0, content: '1-100-200' },
              { tag: 'CollectionId', page: 0, content: 'SU5CT1g=' },
              { tag: 'Status', page: 0, content: '1' },
              {
                tag: 'Responses',
                page: 0,
                children: [
                  {
                    tag: 'Change',
                    page: 0,
                    children: [
                      { tag: 'ServerId', page: 0, content: 'SU5CT1g=-42' },
                      {
                        tag: 'ApplicationData',
                        page: 0,
                        children: [
                          { tag: 'Read', page: 2, content: '1' }
                        ]
                      }
                    ]
                  }
                ]
              }
            ]
          }
        ]
      }
    ]
  }));
});

test('ActiveSync Calendar Sync encodes the protocol TimeZone tag for zoned recurrence', () => {
  const event = parseIcalEvent('ios-timezone-writer', [
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    'UID:ios-timezone-writer',
    'SUMMARY:iOS timezone writer',
    'DTSTART;TZID=America/New_York:20270305T090000',
    'DTEND;TZID=America/New_York:20270305T093000',
    'RRULE:FREQ=WEEKLY;COUNT=4',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n'));
  const applicationData = calendarEventToActiveSyncApplicationData(event);
  const writer = new WbxmlWriter();

  assert.equal(applicationData.some(node => node.tag === 'TimeZone'), true);
  assert.doesNotThrow(() => writer.writeNode({
    tag: 'Sync',
    page: 0,
    children: [{
      tag: 'Collections',
      page: 0,
      children: [{
        tag: 'Collection',
        page: 0,
        children: [{
          tag: 'Commands',
          page: 0,
          children: [{
            tag: 'Add',
            page: 0,
            children: [{
              tag: 'ApplicationData',
              page: 0,
              children: applicationData,
            }],
          }],
        }],
      }],
    }],
  }));
});

test('ActiveSync Calendar reminder and exception nodes survive the real WBXML writer and parser', () => {
  const event = parseIcalEvent('ios-exception-writer', [
    'BEGIN:VCALENDAR',
    'BEGIN:VEVENT',
    'UID:ios-exception-writer',
    'SUMMARY:Weekly planning',
    'DTSTART:20260703T170000Z',
    'DTEND:20260703T180000Z',
    'RRULE:FREQ=WEEKLY;COUNT=3',
    'EXDATE:20260710T170000Z',
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    'TRIGGER:-PT15M',
    'DESCRIPTION:Weekly planning',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n'));
  const writer = new WbxmlWriter();
  writer.writeNode({ tag: 'ApplicationData', page: 0, children: calendarEventToActiveSyncApplicationData(event) });

  const parsed = new WbxmlParser(writer.getBuffer()).parse();
  const reminder = parsed.children.find(node => node.tag === 'Reminder');
  const exceptions = parsed.children.find(node => node.tag === 'Exceptions');

  assert.equal(reminder.content, '15');
  assert.equal(exceptions.children[0].tag, 'Exception');
  assert.equal(exceptions.children[0].children.find(node => node.tag === 'Deleted').content, '1');
  assert.equal(exceptions.children[0].children.find(node => node.tag === 'ExceptionStartTime').content, '20260710T170000Z');
});
