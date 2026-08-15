const test = require('node:test');
const assert = require('node:assert/strict');

const calendarPreamble = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//OpenMailStack Tests//EN'];
const eventRequired = ['DTSTAMP:20260815T120000Z', 'DTSTART:20260816T120000Z'];

test('iCalendar validation exposes exact unfolded identity and groups recurrence components', () => {
  const { validateICalendarDocument } = require('../src/calendar-ical-validation.js');
  const document = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//OpenMailStack Tests//EN',
    'BEGIN:VTIMEZONE',
    'TZID:Etc/UTC',
    'END:VTIMEZONE',
    'BEGIN:VEVENT',
    'UID:series-',
    ' one',
    'DTSTAMP:20260815T120000Z',
    'DTSTART:20260816T120000Z',
    'END:VEVENT',
    'BEGIN:VEVENT',
    'UID:series-one',
    'DTSTAMP:20260815T120000Z',
    'RECURRENCE-ID:20260817T120000Z',
    'DTSTART:20260817T130000Z',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');

  const validated = validateICalendarDocument(document);
  assert.deepEqual(validated.componentTypes, ['VEVENT', 'VEVENT']);
  assert.deepEqual(validated.supportingComponentTypes, ['VTIMEZONE']);
  assert.deepEqual(validated.unfoldedUids, ['series-one', 'series-one']);
  assert.equal(validated.canonicalUid, 'series-one');
  assert.equal(validated.resources.length, 1);
  assert.equal(validated.resources[0].componentType, 'VEVENT');
  assert.equal(validated.resources[0].uid, 'series-one');
  assert.equal(validated.resources[0].componentCount, 2);
  assert.match(validated.resources[0].icalData, /BEGIN:VTIMEZONE/);
  assert.equal((validated.resources[0].icalData.match(/BEGIN:VEVENT/g) || []).length, 2);
});

test('only subscription mode permits an empty or multi-resource VCALENDAR', () => {
  const { validateICalendarDocument } = require('../src/calendar-ical-validation.js');
  const empty = [...calendarPreamble, 'END:VCALENDAR'].join('\r\n');
  assert.throws(() => validateICalendarDocument(empty), /no calendar resource/i);
  assert.equal(validateICalendarDocument(empty, { allowEmpty: true }).isEmpty, true);

  const multi = [
    ...calendarPreamble,
    'BEGIN:VEVENT', 'UID:one', ...eventRequired, 'END:VEVENT',
    'BEGIN:VEVENT', 'UID:two', ...eventRequired, 'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
  assert.throws(() => validateICalendarDocument(multi), /multiple resource UIDs/i);
  assert.deepEqual(
    validateICalendarDocument(multi, { allowMultipleResourceUids: true }).resources
      .map(resource => resource.uid),
    ['one', 'two'],
  );
});

test('truncated, mismatched, missing-UID, and duplicate-UID components fail atomically', () => {
  const { validateICalendarDocument } = require('../src/calendar-ical-validation.js');
  const malformedDocuments = [
    [...calendarPreamble, 'BEGIN:VEVENT', 'UID:a', ...eventRequired, 'END:VCALENDAR'].join('\r\n'),
    [...calendarPreamble, 'BEGIN:VEVENT', 'UID:a', ...eventRequired, 'END:VTODO', 'END:VCALENDAR'].join('\r\n'),
    [...calendarPreamble, 'BEGIN:VEVENT', ...eventRequired, 'SUMMARY:no uid', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n'),
    [...calendarPreamble, 'BEGIN:VEVENT', 'UID:a', 'UID:b', ...eventRequired, 'END:VEVENT', 'END:VCALENDAR'].join('\r\n'),
    [...calendarPreamble, 'BEGIN:VEVENT', 'UID:a\u0001b', ...eventRequired, 'END:VEVENT', 'END:VCALENDAR'].join('\r\n'),
  ];
  for (const malformed of malformedDocuments) {
    assert.throws(
      () => validateICalendarDocument(malformed, { allowEmpty: true, allowMultipleResourceUids: true }),
      /iCalendar|VEVENT/i,
    );
  }
});

test('one resource UID cannot silently combine different calendar component kinds', () => {
  const { validateICalendarDocument } = require('../src/calendar-ical-validation.js');
  const mixed = [
    ...calendarPreamble,
    'BEGIN:VEVENT', 'UID:shared', ...eventRequired, 'END:VEVENT',
    'BEGIN:VTODO', 'UID:shared', 'DTSTAMP:20260815T120000Z', 'END:VTODO',
    'END:VCALENDAR',
  ].join('\r\n');
  assert.throws(() => validateICalendarDocument(mixed), /component type|component kind/i);
  const explicit = validateICalendarDocument(mixed, { allowMultipleResourceTypes: true });
  assert.deepEqual(explicit.resources.map(resource => resource.componentType), ['VEVENT', 'VTODO']);
});

test('document, component-count, UID, and per-resource byte limits are enforced', () => {
  const {
    validateICalendarDocument,
    MAX_ICAL_DOCUMENT_BYTES,
    MAX_ICAL_RESOURCE_BYTES,
    MAX_ICAL_RESOURCE_COMPONENTS,
    MAX_ICAL_UID_BYTES,
  } = require('../src/calendar-ical-validation.js');
  assert.throws(
    () => validateICalendarDocument(Buffer.alloc(MAX_ICAL_DOCUMENT_BYTES + 1)),
    /document is too large/i,
  );
  assert.throws(
    () => validateICalendarDocument([
      ...calendarPreamble, 'BEGIN:VEVENT', `UID:${'u'.repeat(MAX_ICAL_UID_BYTES + 1)}`, ...eventRequired, 'END:VEVENT', 'END:VCALENDAR',
    ].join('\r\n')),
    /UID is too large/i,
  );
  assert.throws(
    () => validateICalendarDocument([
      ...calendarPreamble, 'BEGIN:VEVENT', `UID:${'a'.repeat(256)}`, ...eventRequired, 'END:VEVENT', 'END:VCALENDAR',
    ].join('\r\n')),
    /UID is too large/i,
  );
  assert.throws(
    () => validateICalendarDocument([
      ...calendarPreamble, 'BEGIN:VEVENT', 'UID:large', ...eventRequired,
      `DESCRIPTION:${'x'.repeat(MAX_ICAL_RESOURCE_BYTES)}`, 'END:VEVENT', 'END:VCALENDAR',
    ].join('\r\n')),
    /component is too large|resource is too large/i,
  );
  const many = [...calendarPreamble];
  for (let index = 0; index <= MAX_ICAL_RESOURCE_COMPONENTS; index += 1) {
    many.push('BEGIN:VEVENT', `UID:event-${index}`, ...eventRequired, 'END:VEVENT');
  }
  many.push('END:VCALENDAR');
  assert.throws(
    () => validateICalendarDocument(many.join('\r\n'), {
      allowMultipleResourceUids: true,
    }),
    /too many resources/i,
  );
});

test('UIDs that collide under SQL PAD SPACE semantics are rejected', () => {
  const { validateICalendarDocument } = require('../src/calendar-ical-validation.js');
  assert.throws(() => validateICalendarDocument([
    ...calendarPreamble, 'BEGIN:VEVENT', 'UID:identity ', ...eventRequired, 'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n')), /UID is invalid/i);
});

test('calendar resource components must appear at valid structural levels', () => {
  const { validateICalendarDocument } = require('../src/calendar-ical-validation.js');
  const invalidStructures = [
    [
      ...calendarPreamble,
      'BEGIN:VALARM', 'ACTION:DISPLAY', 'END:VALARM',
      'END:VCALENDAR',
    ],
    [
      ...calendarPreamble,
      'BEGIN:VTODO', 'UID:task', 'DTSTAMP:20260815T120000Z',
      'BEGIN:VEVENT', 'UID:nested-event', ...eventRequired, 'END:VEVENT',
      'END:VTODO',
      'END:VCALENDAR',
    ],
  ];
  for (const lines of invalidStructures) {
    assert.throws(
      () => validateICalendarDocument(lines.join('\r\n'), {
        allowEmpty: true,
        allowMultipleResourceUids: true,
      }),
      /component nesting|top-level component/i,
    );
  }
});

test('invalid UTF-8 cannot be normalized into a different calendar resource', () => {
  const { validateICalendarDocument } = require('../src/calendar-ical-validation.js');
  const invalid = Buffer.concat([
    Buffer.from(`${calendarPreamble.join('\r\n')}\r\nBEGIN:VEVENT\r\nUID:utf8\r\n${eventRequired.join('\r\n')}\r\nSUMMARY:`),
    Buffer.from([0xc3, 0x28]),
    Buffer.from('\r\nEND:VEVENT\r\nEND:VCALENDAR'),
  ]);
  assert.throws(() => validateICalendarDocument(invalid), /UTF-8/i);
});

test('calendar text rejects XML controls and Unicode noncharacters but permits legal folding whitespace', () => {
  const { validateICalendarDocument } = require('../src/calendar-ical-validation.js');
  const valid = [
    ...calendarPreamble,
    'BEGIN:VEVENT',
    'UID:folded-text',
    ...eventRequired,
    'DESCRIPTION:folded',
    '\twith a tab continuation',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
  assert.equal(validateICalendarDocument(valid).canonicalUid, 'folded-text');

  for (const poison of ['\u0001', '\u000b', '\u007f', '\u0085', '\ufdd0', '\ufffe', '\u{1ffff}']) {
    const malformed = valid.replace('folded-text', `folded${poison}text`);
    assert.throws(() => validateICalendarDocument(malformed), /invalid character data/i);
  }
});

test('shared calendar data cannot amplify into unbounded materialized resources', () => {
  const { validateICalendarDocument } = require('../src/calendar-ical-validation.js');
  const lines = [
    ...calendarPreamble,
    'BEGIN:VTIMEZONE',
    'TZID:Large/Shared',
    `X-SHARED:${'x'.repeat(200)}`,
    'END:VTIMEZONE',
  ];
  for (let index = 0; index < 10; index += 1) {
    lines.push('BEGIN:VEVENT', `UID:event-${index}`, ...eventRequired, 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  assert.throws(() => validateICalendarDocument(lines.join('\r\n'), {
    allowMultipleResourceUids: true,
    maxAggregateResourceBytes: 1_000,
  }), /aggregate.*too large|materialized.*too large/i);
});

test('a recurrence resource rejects duplicate masters and recurrence identities', () => {
  const { validateICalendarDocument } = require('../src/calendar-ical-validation.js');
  const malformedSets = [
    [
      ...calendarPreamble,
      'BEGIN:VEVENT', 'UID:series', 'DTSTAMP:20260815T120000Z', 'DTSTART:20260816T120000Z', 'END:VEVENT',
      'BEGIN:VEVENT', 'UID:series', 'DTSTAMP:20260815T120000Z', 'DTSTART:20260817T120000Z', 'END:VEVENT',
      'END:VCALENDAR',
    ],
    [
      ...calendarPreamble,
      'BEGIN:VEVENT', 'UID:series', 'DTSTAMP:20260815T120000Z', 'RECURRENCE-ID:20260817T120000Z', 'DTSTART:20260817T130000Z', 'END:VEVENT',
      'BEGIN:VEVENT', 'UID:series', 'DTSTAMP:20260815T120000Z', 'RECURRENCE-ID:20260817T120000Z', 'DTSTART:20260817T130000Z', 'END:VEVENT',
      'END:VCALENDAR',
    ],
  ];
  for (const lines of malformedSets) {
    assert.throws(() => validateICalendarDocument(lines.join('\r\n')), /duplicate.*recurrence|multiple.*master/i);
  }
});

test('a maximum-size recurrence group remains a bounded linear parse', () => {
  const { validateICalendarDocument, MAX_ICAL_RESOURCE_COMPONENTS } = require('../src/calendar-ical-validation.js');
  const lines = [...calendarPreamble, 'BEGIN:VEVENT', 'UID:large-series', ...eventRequired, 'END:VEVENT'];
  for (let index = 1; index < MAX_ICAL_RESOURCE_COMPONENTS; index += 1) {
    lines.push(
      'BEGIN:VEVENT',
      'UID:large-series',
      'DTSTAMP:20260815T120000Z',
      `RECURRENCE-ID:${index}`,
      `DTSTART:202608${String((index % 28) + 1).padStart(2, '0')}T120000Z`,
      'END:VEVENT',
    );
  }
  lines.push('END:VCALENDAR');
  const validated = validateICalendarDocument(lines.join('\r\n'), { maxResourceBytes: 2 * 1024 * 1024 });
  assert.equal(validated.resources[0].componentCount, MAX_ICAL_RESOURCE_COMPONENTS);
});

test('stored resources require canonical calendar metadata and direct RFC identity fields', () => {
  const { validateICalendarDocument } = require('../src/calendar-ical-validation.js');
  const valid = [...calendarPreamble, 'BEGIN:VEVENT', 'UID:strict', ...eventRequired, 'END:VEVENT', 'END:VCALENDAR'];
  assert.equal(validateICalendarDocument(valid.join('\r\n')).canonicalUid, 'strict');

  const malformed = [
    valid.filter(line => line !== 'VERSION:2.0'),
    valid.map(line => line === 'VERSION:2.0' ? 'VERSION:1.0' : line),
    [...valid.slice(0, 2), 'VERSION:2.0', ...valid.slice(2)],
    valid.filter(line => !line.startsWith('PRODID:')),
    [...valid.slice(0, 3), 'PRODID:-//Duplicate//EN', ...valid.slice(3)],
    valid.filter(line => !line.startsWith('DTSTAMP:')),
    [...valid.slice(0, -2), 'DTSTAMP:20260815T130000Z', ...valid.slice(-2)],
    valid.filter(line => !line.startsWith('DTSTART:')),
  ];
  for (const lines of malformed) {
    assert.throws(() => validateICalendarDocument(lines.join('\r\n')), /VERSION|PRODID|DTSTAMP|DTSTART/i);
  }
});

test('METHOD is forbidden in stored resources and allowed only in explicit import modes', () => {
  const { validateICalendarDocument } = require('../src/calendar-ical-validation.js');
  const withMethod = [
    ...calendarPreamble,
    'METHOD:PUBLISH',
    'BEGIN:VEVENT', 'UID:published', ...eventRequired, 'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
  assert.throws(() => validateICalendarDocument(withMethod), /must not contain METHOD/i);
  const imported = validateICalendarDocument(withMethod, { mode: 'import' });
  const subscribed = validateICalendarDocument(withMethod, { mode: 'subscription' });
  assert.equal(imported.canonicalUid, 'published');
  assert.equal(subscribed.canonicalUid, 'published');
  assert.doesNotMatch(imported.resources[0].icalData, /(?:^|\r\n)METHOD:/i);
  assert.doesNotMatch(subscribed.resources[0].icalData, /(?:^|\r\n)METHOD:/i);
});
