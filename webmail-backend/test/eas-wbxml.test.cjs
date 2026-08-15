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

test('Contacts, Contacts2, and Notes use their official WBXML code-page tokens', () => {
  const writer = new WbxmlWriter();
  writer.writeNode({ tag: 'ApplicationData', page: 0, children: [
    { tag: 'RadioPhoneNumber', page: 1, content: 'radio' },
    { tag: 'Picture', page: 1, content: 'cGljdHVyZQ==' },
    { tag: 'NickName', page: 12, content: 'nick' },
    { tag: 'IMAddress', page: 12, content: 'im@example.test' },
    { tag: 'Subject', page: 23, content: 'note' },
  ] });
  const decoded = new WbxmlParser(writer.getBuffer()).parse();
  assert.deepEqual(decoded.children.map(node => [node.page, node.tag, node.content]), [
    [1, 'RadioPhoneNumber', 'radio'],
    [1, 'Picture', 'cGljdHVyZQ=='],
    [12, 'NickName', 'nick'],
    [12, 'IMAddress', 'im@example.test'],
    [23, 'Subject', 'note'],
  ]);
});

test('WBXML writer rejects embedded NUL and arbitrary scalar coercion', () => {
  assert.throws(() => new WbxmlWriter().writeNode({ tag: 'Status', page: 0, content: '1\0forged' }), /cannot contain NUL/);
  assert.throws(() => new WbxmlWriter().writeNode({ tag: 'Status', page: 0, content: 1 }), /string or Buffer/);
});

test('WBXML parser rejects excessive nesting before the JavaScript call stack is exhausted', () => {
  const depth = 96;
  const body = [
    ...Array(depth).fill(0x45), // Sync with content
    0x05, // empty Sync leaf
    ...Array(depth).fill(0x01),
  ];
  const payload = Buffer.from([0x03, 0x01, 0x6a, 0x00, ...body]);

  assert.throws(
    () => new WbxmlParser(payload).parse(),
    /WBXML nesting depth exceeds limit/,
  );
});

test('WBXML parser rejects excessive element counts', () => {
  const body = [
    0x45, // Sync with content
    ...Array(4_097).fill(0x05), // empty Sync children
    0x01,
  ];
  const payload = Buffer.from([0x03, 0x01, 0x6a, 0x00, ...body]);

  assert.throws(
    () => new WbxmlParser(payload).parse(),
    /WBXML element count exceeds limit/,
  );
});

test('WBXML parser rejects excessive token counts within one element', () => {
  const body = [0x45]; // Sync with content
  for (let index = 0; index < 16_500; index += 1) body.push(0x03, 0x00); // empty STR_I
  body.push(0x01);
  const payload = Buffer.from([0x03, 0x01, 0x6a, 0x00, ...body]);

  assert.throws(
    () => new WbxmlParser(payload).parse(),
    /WBXML token count exceeds limit/,
  );
});

test('WBXML parser rejects a second root or trailing bytes', () => {
  const payload = Buffer.from([
    0x03, 0x01, 0x6a, 0x00,
    0x05, // empty Sync root
    0x05, // unexpected second root
  ]);
  assert.throws(
    () => new WbxmlParser(payload).parse(),
    /WBXML trailing data after root element/,
  );
});

test('WBXML writer stores large content in Buffer chunks instead of byte-number arrays', () => {
  const writer = new WbxmlWriter();
  const content = 'x'.repeat(1024 * 1024);
  writer.writeNode({ tag: 'Data', page: 17, content });

  assert.equal(writer.buffer, undefined);
  assert.ok(writer.chunks.some(chunk => Buffer.isBuffer(chunk) && chunk.length === content.length));
  assert.ok(writer.pendingBytes.length < 4096);
  const output = writer.getBuffer();
  assert.equal(new WbxmlParser(output).parse().content.length, content.length);
});
