const test = require('node:test');
const assert = require('node:assert/strict');

const { WbxmlWriter } = require('../src/wbxml/writer.js');
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
