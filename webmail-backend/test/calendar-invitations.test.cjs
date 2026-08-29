const test = require('node:test');
const assert = require('node:assert/strict');

process.env.OMS_DB_PASSWORD ||= 'calendar-invitations-test';

const {
  CalendarInvitationActionError,
  prepareInvitationCancellation,
  prepareInvitationCounter,
  prepareInvitationResponse,
  projectCalendarInvitation,
  projectCalendarInvitationOccurrences,
} = require('../src/calendar-invitations.js');
const { parseIcalEvent } = require('../src/calendar-format.js');
const { validateICalendarDocument } = require('../src/calendar-ical-validation.js');

const now = () => new Date('2026-08-29T18:30:00.000Z');

function invitation(overrides = []) {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//OpenMailStack//Invitation Test//EN',
    'BEGIN:VEVENT',
    'UID:meeting-123@example.test',
    'DTSTAMP:20260820T120000Z',
    'SEQUENCE:3',
    'DTSTART:20260901T160000Z',
    'DTEND:20260901T170000Z',
    'SUMMARY:Roadmap review',
    'LOCATION:Room 4',
    'ORGANIZER;CN="Alice Organizer":mailto:alice@example.test',
    'ATTENDEE;CN="Guest Alias";ROLE=REQ-PARTICIPANT;PARTSTAT=TENTATIVE;RSVP=TRUE:mailto:alias@example.test',
    'ATTENDEE;CN="Bob Guest";ROLE=OPT-PARTICIPANT;PARTSTAT=ACCEPTED:mailto:bob@example.test',
    ...overrides,
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
}

test('projects attendee identity, current response, participants, and action capabilities', () => {
  const projected = projectCalendarInvitation(invitation(), ['owner@example.test', 'alias@example.test']);

  assert.deepEqual(projected, {
    role: 'attendee',
    organizerEmail: 'alice@example.test',
    organizerName: 'Alice Organizer',
    attendeeEmail: 'alias@example.test',
    response: 'tentative',
    responseRequested: true,
    attendees: [
      { email: 'alias@example.test', name: 'Guest Alias', response: 'tentative', role: 'required' },
      { email: 'bob@example.test', name: 'Bob Guest', response: 'accepted', role: 'optional' },
    ],
    attendeeCount: 2,
    attendeesTruncated: false,
    recurring: false,
    canRespond: true,
    canCancel: false,
    canCancelOccurrence: false,
    canProposeNewTime: true,
    canForward: true,
    sequence: 3,
  });
});

test('bounds large attendee projections and display names across occurrence batches', () => {
  const longName = 'N'.repeat(500_000);
  const attendeeLines = Array.from({ length: 1_000 }, (_, index) => (
    `ATTENDEE;CN="${'Guest '.repeat(40)}${index}";PARTSTAT=NEEDS-ACTION:mailto:guest${index}@example.test`
  ));
  const source = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//OpenMailStack//Large Projection Test//EN',
    'BEGIN:VEVENT', 'UID:large-projection',
    'DTSTAMP:20260829T183000Z',
    'DTSTART:20260901T160000Z', 'DTEND:20260901T170000Z',
    'RRULE:FREQ=DAILY;COUNT=400',
    `ORGANIZER;CN="${longName}":mailto:organizer@example.test`,
    ...attendeeLines,
    'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n');
  const projections = projectCalendarInvitationOccurrences(
    source,
    ['guest999@example.test'],
    Array.from({ length: 400 }, (_, index) => `202609${String((index % 28) + 1).padStart(2, '0')}T160000Z`),
  );

  assert.equal(projections.length, 400);
  for (const projected of projections) {
    assert.equal(projected.attendeeCount, 1_000);
    assert.equal(projected.attendees.length, 50);
    assert.equal(projected.attendeesTruncated, true);
    assert.equal(projected.role, 'attendee');
    assert.ok(projected.attendees.some(attendee => attendee.email === 'guest999@example.test'));
    assert.ok(Buffer.byteLength(projected.organizerName, 'utf8') <= 160);
    assert.ok(projected.attendees.every(attendee => !attendee.name || Buffer.byteLength(attendee.name, 'utf8') <= 160));
  }
  assert.ok(Buffer.byteLength(JSON.stringify(projections), 'utf8') < 8 * 1024 * 1024);
});

test('indexes 256 recurrence exceptions once for a 400-occurrence projection batch', () => {
  const occurrenceIds = Array.from({ length: 400 }, (_, index) => {
    const date = new Date(Date.UTC(2026, 8, 1 + index, 16));
    return date.toISOString().slice(0, 19).replaceAll('-', '').replaceAll(':', '') + 'Z';
  });
  const exceptions = occurrenceIds.slice(1, 257).flatMap((recurrenceId, index) => [
    'BEGIN:VEVENT',
    'UID:indexed-exceptions',
    'DTSTAMP:20260829T183000Z',
    `RECURRENCE-ID:${recurrenceId}`,
    `DTSTART:${recurrenceId}`,
    `DTEND:${new Date(Date.parse(
      recurrenceId.replace(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/, '$1-$2-$3T$4:$5:$6Z'),
    ) + 3_600_000).toISOString().slice(0, 19).replaceAll('-', '').replaceAll(':', '')}Z`,
    `SUMMARY:Exception ${index}`,
    'END:VEVENT',
  ]);
  const source = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//OpenMailStack//Indexed Exceptions Test//EN',
    'BEGIN:VEVENT', 'UID:indexed-exceptions', 'DTSTAMP:20260829T183000Z',
    'DTSTART:20260901T160000Z', 'DTEND:20260901T170000Z',
    'RRULE:FREQ=DAILY;COUNT=400', 'SUMMARY:Indexed exception series',
    'ORGANIZER:mailto:organizer@example.test', 'ATTENDEE:mailto:owner@example.test',
    'END:VEVENT', ...exceptions, 'END:VCALENDAR',
  ].join('\r\n');

  const started = process.hrtime.bigint();
  const projections = projectCalendarInvitationOccurrences(source, ['owner@example.test'], occurrenceIds);
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1_000_000;

  assert.equal(projections.length, 400);
  assert.equal(projections.filter(Boolean).length, 400);
  assert.ok(elapsedMs < 2_000, `projection batch took ${elapsedMs.toFixed(1)}ms`);
});

test('fails closed before selecting a recurrence exception beyond the supported bound', () => {
  const exceptionLines = Array.from({ length: 257 }, (_, index) => {
    const recurrence = new Date(Date.UTC(2026, 8, 2 + index, 16));
    const end = new Date(recurrence.getTime() + 3_600_000);
    const compact = value => value.toISOString().slice(0, 19).replaceAll('-', '').replaceAll(':', '') + 'Z';
    return [
      'BEGIN:VEVENT', 'UID:overflow-exceptions', 'DTSTAMP:20260829T183000Z',
      `RECURRENCE-ID:${compact(recurrence)}`, `DTSTART:${compact(recurrence)}`, `DTEND:${compact(end)}`,
      'SUMMARY:Overflow exception', 'END:VEVENT',
    ].join('\r\n');
  });
  const source = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//OpenMailStack//Overflow Exceptions Test//EN',
    'BEGIN:VEVENT', 'UID:overflow-exceptions', 'DTSTAMP:20260829T183000Z',
    'DTSTART:20260901T160000Z', 'DTEND:20260901T170000Z',
    'RRULE:FREQ=DAILY;COUNT=400', 'SUMMARY:Overflow exception series',
    'ORGANIZER:mailto:organizer@example.test', 'ATTENDEE:mailto:owner@example.test',
    'END:VEVENT', ...exceptionLines, 'END:VCALENDAR',
  ].join('\r\n');

  assert.throws(
    () => prepareInvitationCancellation(
      source,
      ['organizer@example.test'],
      { occurrenceId: '20260902T160000Z' },
      { now },
    ),
    error => error instanceof CalendarInvitationActionError
      && error.code === 'TOO_MANY_RECURRENCE_EXCEPTIONS',
  );
  const [projected] = projectCalendarInvitationOccurrences(
    source,
    ['organizer@example.test'],
    ['20260902T160000Z'],
  );
  assert.equal(projected?.role, 'unowned');
  assert.equal(projected?.canCancel, false);
  assert.match(projected?.actionUnavailableReason || '', /unavailable for this recurrence/i);
});

test('parses quoted parameter colons, preserves address casing, and treats omitted RSVP as false', () => {
  const source = invitation()
    .replace(
      'ORGANIZER;CN="Alice Organizer":mailto:alice@example.test',
      'ORGANIZER;CN="Ops: West":mailto:Alice@Example.Test',
    )
    .replace(
      'ATTENDEE;CN="Guest Alias";ROLE=REQ-PARTICIPANT;PARTSTAT=TENTATIVE;RSVP=TRUE:mailto:alias@example.test',
      'ATTENDEE;CN="Guest: Alias";ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED:mailto:Alias@Example.Test',
    );
  const projected = projectCalendarInvitation(source, ['alias@example.test']);
  const prepared = prepareInvitationResponse(source, ['alias@example.test'], 'accepted', { now });

  assert.equal(projected?.organizerName, 'Ops: West');
  assert.equal(projected?.organizerEmail, 'Alice@Example.Test');
  assert.equal(projected?.attendeeEmail, 'Alias@Example.Test');
  assert.equal(projected?.attendees[0].name, 'Guest: Alias');
  assert.equal(projected?.responseRequested, false);
  assert.equal(prepared.alreadyResponded, true);
  assert.equal(prepared.delivery.sender, 'Alias@Example.Test');
  assert.deepEqual(prepared.delivery.recipients, ['Alice@Example.Test']);
});

test('projects an owned organized meeting and excludes appointments without attendees', () => {
  const organized = projectCalendarInvitation(invitation(), ['alice@example.test']);
  assert.equal(organized?.role, 'organizer');
  assert.equal(organized?.canCancel, true);
  assert.equal(organized?.canCancelOccurrence, false);
  assert.equal(organized?.canProposeNewTime, false);

  const appointment = invitation().replace(/^ATTENDEE.*(?:\r\n|$)/gim, '');
  assert.equal(projectCalendarInvitation(appointment, ['alice@example.test']), null);
});

test('projects a meeting without an owned identity as view-only instead of an appointment', () => {
  const projected = projectCalendarInvitation(invitation(), ['delegate@example.test']);

  assert.equal(projected?.role, 'unowned');
  assert.equal(projected?.organizerEmail, 'alice@example.test');
  assert.equal(projected?.canForward, false);
  assert.equal(projected?.canProposeNewTime, false);
});

test('projects an occurrence-specific attendee roster instead of the master roster', () => {
  const source = invitation(['RRULE:FREQ=WEEKLY;COUNT=4']).replace('END:VCALENDAR', [
    'BEGIN:VEVENT',
    'UID:meeting-123@example.test',
    'DTSTAMP:20260820T120000Z',
    'RECURRENCE-ID:20260908T160000Z',
    'DTSTART:20260908T180000Z',
    'DTEND:20260908T190000Z',
    'ORGANIZER:mailto:alice@example.test',
    'ATTENDEE;PARTSTAT=ACCEPTED:mailto:alias@example.test',
    'ATTENDEE;PARTSTAT=TENTATIVE:mailto:instance@example.test',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n'));

  const projected = projectCalendarInvitation(
    source,
    ['alias@example.test'],
    '20260908T160000Z',
  );
  assert.deepEqual(projected?.attendees.map(attendee => attendee.email), [
    'alias@example.test',
    'instance@example.test',
  ]);
  assert.equal(projected?.response, 'accepted');
});

test('exception-only attendee and organizer identities are projected without unsupported series actions', () => {
  const attendeeOnly = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//OpenMailStack//Scoped Identity Test//EN',
    'BEGIN:VEVENT', 'UID:scoped-attendee', 'DTSTAMP:20260820T120000Z',
    'DTSTART:20260901T160000Z', 'DTEND:20260901T170000Z', 'RRULE:FREQ=WEEKLY;COUNT=3',
    'ORGANIZER:mailto:organizer@example.test', 'ATTENDEE:mailto:master-guest@example.test',
    'END:VEVENT', 'BEGIN:VEVENT', 'UID:scoped-attendee', 'DTSTAMP:20260820T120000Z',
    'RECURRENCE-ID:20260908T160000Z', 'DTSTART:20260908T180000Z', 'DTEND:20260908T190000Z',
    'ORGANIZER:mailto:organizer@example.test', 'ATTENDEE:mailto:alias@example.test',
    'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n');
  const attendeeProjection = projectCalendarInvitation(
    attendeeOnly,
    ['alias@example.test'],
    '20260908T160000Z',
  );
  assert.equal(attendeeProjection?.role, 'attendee');
  assert.equal(attendeeProjection?.canRespond, false);
  assert.equal(attendeeProjection?.canCancel, false);
  assert.throws(
    () => prepareInvitationResponse(attendeeOnly, ['alias@example.test'], 'accepted', { now }),
    error => error instanceof CalendarInvitationActionError && error.code === 'NOT_ATTENDEE',
  );

  const organizerOnly = attendeeOnly
    .replaceAll('scoped-attendee', 'scoped-organizer')
    .replace(
      'ORGANIZER:mailto:organizer@example.test\r\nATTENDEE:mailto:alias@example.test',
      'ORGANIZER:mailto:alias@example.test\r\nATTENDEE:mailto:master-guest@example.test',
    );
  const organizerProjection = projectCalendarInvitation(
    organizerOnly,
    ['alias@example.test'],
    '20260908T160000Z',
  );
  assert.equal(organizerProjection?.role, 'organizer');
  assert.equal(organizerProjection?.canCancel, false);
  assert.throws(
    () => prepareInvitationCancellation(
      organizerOnly,
      ['alias@example.test'],
      { occurrenceId: '20260908T160000Z' },
      { now },
    ),
    error => error instanceof CalendarInvitationActionError && error.code === 'NOT_ORGANIZER',
  );
});

test('an occurrence with explicitly cleared attendees does not inherit the master invitation', () => {
  const source = invitation(['RRULE:FREQ=WEEKLY;COUNT=4']).replace('END:VCALENDAR', [
    'BEGIN:VEVENT',
    'UID:meeting-123@example.test',
    'DTSTAMP:20260820T120000Z',
    'RECURRENCE-ID:20260908T160000Z',
    'DTSTART:20260908T180000Z',
    'DTEND:20260908T190000Z',
    'X-OMS-ACTIVESYNC-ATTENDEES-CLEARED:1',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n'));

  assert.equal(projectCalendarInvitation(source, ['alias@example.test'], '20260908T160000Z'), null);
});

test('an attendee-cleared occurrence does not block notifying the master roster of a series cancellation', () => {
  const source = invitation(['RRULE:FREQ=WEEKLY;COUNT=4']).replace('END:VCALENDAR', [
    'BEGIN:VEVENT',
    'UID:meeting-123@example.test',
    'DTSTAMP:20260820T120000Z',
    'RECURRENCE-ID:20260908T160000Z',
    'DTSTART:20260908T180000Z',
    'DTEND:20260908T190000Z',
    'X-OMS-ACTIVESYNC-ATTENDEES-CLEARED:1',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n'));
  const prepared = prepareInvitationCancellation(source, ['alice@example.test'], {}, { now });

  assert.deepEqual(prepared.delivery.recipients, ['alias@example.test', 'bob@example.test']);
  assert.match(prepared.delivery.ical, /^STATUS:CANCELLED$/m);
});

test('prepares an idempotent attendee REPLY and persists only the matching PARTSTAT', () => {
  const source = invitation();
  const prepared = prepareInvitationResponse(
    source,
    ['owner@example.test', 'alias@example.test'],
    'accepted',
    { now },
  );

  assert.match(prepared.updatedIcal, /ATTENDEE;CN="Guest Alias";ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED;RSVP=FALSE:mailto:alias@example\.test/i);
  assert.match(prepared.updatedIcal, /ATTENDEE;CN="Bob Guest";ROLE=OPT-PARTICIPANT;PARTSTAT=ACCEPTED:mailto:bob@example\.test/i);
  assert.equal(validateICalendarDocument(prepared.updatedIcal).canonicalUid, 'meeting-123@example.test');

  assert.equal(prepared.delivery.method, 'REPLY');
  assert.equal(prepared.delivery.sender, 'alias@example.test');
  assert.deepEqual(prepared.delivery.recipients, ['alice@example.test']);
  assert.equal(prepared.delivery.subject, 'Accepted: Roadmap review');
  assert.match(prepared.delivery.ical, /^METHOD:REPLY$/m);
  assert.match(prepared.delivery.ical, /^SEQUENCE:3$/m);
  assert.match(prepared.delivery.ical, /^DTSTAMP:20260829T183000Z$/m);
  assert.match(prepared.delivery.ical, /PARTSTAT=ACCEPTED/);
  assert.doesNotMatch(prepared.delivery.ical, /mailto:bob@example\.test/i);
  assert.equal(validateICalendarDocument(prepared.delivery.ical.replace(/^METHOD:.*\r?\n/m, '')).canonicalUid, 'meeting-123@example.test');

  const duplicate = prepareInvitationResponse(
    prepared.updatedIcal,
    ['alias@example.test'],
    'accepted',
    { now },
  );
  assert.equal(prepared.alreadyResponded, false);
  assert.equal(duplicate.alreadyResponded, true);
});

test('series REPLY uses the master attendee row when an exception precedes the master', () => {
  const source = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//OpenMailStack//Reply Ordering Test//EN',
    'BEGIN:VEVENT', 'UID:reply-ordering', 'DTSTAMP:20260821T120000Z',
    'RECURRENCE-ID:20260908T160000Z', 'DTSTART:20260908T180000Z', 'DTEND:20260908T190000Z',
    'ORGANIZER:mailto:alice@example.test',
    'ATTENDEE;CN="Exception attendee";ROLE=OPT-PARTICIPANT;PARTSTAT=NEEDS-ACTION:mailto:alias@example.test',
    'END:VEVENT',
    'BEGIN:VEVENT', 'UID:reply-ordering', 'DTSTAMP:20260820T120000Z', 'SEQUENCE:2',
    'DTSTART:20260901T160000Z', 'DTEND:20260901T170000Z', 'RRULE:FREQ=WEEKLY;COUNT=3',
    'SUMMARY:Reply ordering', 'ORGANIZER:mailto:alice@example.test',
    'ATTENDEE;CN="Master attendee";ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION:mailto:alias@example.test',
    'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n');
  const prepared = prepareInvitationResponse(source, ['alias@example.test'], 'accepted', { now });

  assert.match(prepared.delivery.ical, /ATTENDEE;CN="Master attendee";ROLE=REQ-PARTICIPANT;PARTSTAT=ACCEPTED;RSVP=FALSE/);
  assert.doesNotMatch(prepared.delivery.ical, /Exception attendee/);
  assert.equal((prepared.updatedIcal.match(/PARTSTAT=ACCEPTED;RSVP=FALSE/g) || []).length, 2);
});

test('invitation mail subjects collapse controls and bound long folded summaries', () => {
  const multiline = prepareInvitationResponse(
    invitation().replace('SUMMARY:Roadmap review', 'SUMMARY:Line one\\nLine two'),
    ['alias@example.test'],
    'accepted',
    { now },
  );
  assert.equal(multiline.delivery.subject, 'Accepted: Line one Line two');
  assert.match(multiline.delivery.ical, /^SUMMARY:Line one\\nLine two$/m);

  const longTitle = 'Quarterly roadmap '.repeat(100);
  const chunks = longTitle.match(/.{1,70}/g);
  const foldedSummary = chunks.map((chunk, index) => `${index === 0 ? 'SUMMARY:' : ' '}${chunk}`).join('\r\n');
  const bounded = prepareInvitationResponse(
    invitation().replace('SUMMARY:Roadmap review', foldedSummary),
    ['alias@example.test'],
    'accepted',
    { now },
  );
  assert.ok(bounded.delivery.subject.length <= 998);
  assert.doesNotMatch(bounded.delivery.subject, /[\r\n\0]/);
  assert.match(bounded.delivery.subject, /…$/);
  assert.match(bounded.delivery.ical, /Quarterly roadmap Quarterly roadmap/);
});

test('series response is not treated as duplicate while an exception still requests a response', () => {
  const source = invitation(['RRULE:FREQ=WEEKLY;COUNT=4'])
    .replace('PARTSTAT=TENTATIVE;RSVP=TRUE', 'PARTSTAT=ACCEPTED;RSVP=FALSE')
    .replace('END:VCALENDAR', [
      'BEGIN:VEVENT',
      'UID:meeting-123@example.test',
      'DTSTAMP:20260820T120000Z',
      'RECURRENCE-ID:20260908T160000Z',
      'DTSTART:20260908T180000Z',
      'DTEND:20260908T190000Z',
      'ORGANIZER:mailto:alice@example.test',
      'ATTENDEE;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:alias@example.test',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n'));
  const projectedBefore = projectCalendarInvitation(
    source,
    ['alias@example.test'],
    '20260915T160000Z',
  );
  assert.equal(projectedBefore?.response, 'accepted');
  assert.equal(projectedBefore?.seriesResponse, undefined);

  const prepared = prepareInvitationResponse(source, ['alias@example.test'], 'accepted', { now });

  assert.equal(prepared.alreadyResponded, false);
  assert.doesNotMatch(prepared.updatedIcal, /PARTSTAT=NEEDS-ACTION/);
  assert.equal((prepared.updatedIcal.match(/PARTSTAT=ACCEPTED;RSVP=FALSE/g) || []).length, 2);
  assert.equal(projectCalendarInvitation(
    prepared.updatedIcal,
    ['alias@example.test'],
    '20260915T160000Z',
  )?.seriesResponse, 'accepted');
});

test('mixed owned attendee identities are projected and enforced as view-only responses', () => {
  const source = invitation(['RRULE:FREQ=WEEKLY;COUNT=4'])
    .replace('PARTSTAT=TENTATIVE;RSVP=TRUE', 'PARTSTAT=ACCEPTED;RSVP=FALSE')
    .replace('END:VCALENDAR', [
      'BEGIN:VEVENT',
      'UID:meeting-123@example.test',
      'DTSTAMP:20260820T120000Z',
      'RECURRENCE-ID:20260908T160000Z',
      'DTSTART:20260908T180000Z',
      'DTEND:20260908T190000Z',
      'ORGANIZER:mailto:alice@example.test',
      'ATTENDEE;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:second-alias@example.test',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n'));

  assert.equal(projectCalendarInvitation(
    source,
    ['alias@example.test', 'second-alias@example.test'],
    '20260908T160000Z',
  )?.canRespond, false);
  assert.throws(
    () => prepareInvitationResponse(
      source,
      ['alias@example.test', 'second-alias@example.test'],
      'accepted',
      { now },
    ),
    error => error instanceof CalendarInvitationActionError
      && error.code === 'MIXED_ATTENDEE_IDENTITIES',
  );
});

test('rejects RSVP when the mailbox is not an attendee', () => {
  assert.throws(
    () => prepareInvitationResponse(invitation(), ['intruder@example.test'], 'declined', { now }),
    (error) => error instanceof CalendarInvitationActionError && error.code === 'NOT_ATTENDEE',
  );
});

test('prepares organizer CANCEL with a bumped sequence and bounded occurrence identity', () => {
  const source = invitation(['RRULE:FREQ=WEEKLY;COUNT=4']);
  const prepared = prepareInvitationCancellation(
    source,
    ['alice@example.test', 'other-alias@example.test'],
    { occurrenceId: '20260908T160000Z' },
    { now },
  );

  assert.equal(prepared.delivery.method, 'CANCEL');
  assert.equal(prepared.delivery.sender, 'alice@example.test');
  assert.deepEqual(prepared.delivery.recipients, ['alias@example.test', 'bob@example.test']);
  assert.equal(prepared.delivery.subject, 'Canceled: Roadmap review');
  assert.match(prepared.delivery.ical, /^METHOD:CANCEL$/m);
  assert.match(prepared.delivery.ical, /^RECURRENCE-ID:20260908T160000Z$/m);
  assert.match(prepared.delivery.ical, /^SEQUENCE:4$/m);
  assert.match(prepared.delivery.ical, /^STATUS:CANCELLED$/m);
  assert.match(prepared.revisedIcal, /^SEQUENCE:4$/m);
  assert.match(prepared.revisedIcal, /^DTSTAMP:20260829T183000Z$/m);
  assert.equal(validateICalendarDocument(prepared.delivery.ical.replace(/^METHOD:.*\r?\n/m, '')).canonicalUid, 'meeting-123@example.test');

  assert.throws(
    () => prepareInvitationCancellation(source, ['alice@example.test'], { occurrenceId: '20260908T160000Z\r\nATTENDEE:mailto:attacker@example.test' }, { now }),
    (error) => error instanceof CalendarInvitationActionError && error.code === 'INVALID_OCCURRENCE',
  );
});

test('projects occurrence cancellation only for recurrence rules with supported membership checks', () => {
  const weekly = projectCalendarInvitation(
    invitation(['RRULE:FREQ=WEEKLY;COUNT=4']),
    ['alice@example.test'],
    '20260908T160000Z',
  );
  assert.equal(weekly?.canCancel, true);
  assert.equal(weekly?.canCancelOccurrence, true);

  const monthly = projectCalendarInvitation(
    invitation(['RRULE:FREQ=MONTHLY;COUNT=4']),
    ['alice@example.test'],
    '20261001T160000Z',
  );
  assert.equal(monthly?.canCancel, true);
  assert.equal(monthly?.canCancelOccurrence, false);

  const selectedWeekdays = projectCalendarInvitation(
    invitation(['RRULE:FREQ=DAILY;COUNT=10;BYDAY=MO,TU,WE,TH,FR']),
    ['alice@example.test'],
    '20260902T160000Z',
  );
  assert.equal(selectedWeekdays?.canCancel, true);
  assert.equal(selectedWeekdays?.canCancelOccurrence, false);
});

test('preserves an exact master DURATION in an ordinary occurrence cancellation', () => {
  const source = invitation(['RRULE:FREQ=WEEKLY;COUNT=4'])
    .replace('DTEND:20260901T170000Z', 'DURATION:PT30M');
  const prepared = prepareInvitationCancellation(
    source,
    ['alice@example.test'],
    { occurrenceId: '20260908T160000Z' },
    { now },
  );

  assert.match(prepared.delivery.ical, /^DTSTART:20260908T160000Z$/m);
  assert.match(prepared.delivery.ical, /^DURATION:PT30M$/m);
  assert.doesNotMatch(prepared.delivery.ical, /^DTEND:/m);
});

test('omits an optional end for an all-day series with implicit duration', () => {
  const source = invitation(['RRULE:FREQ=DAILY;COUNT=4'])
    .replace('DTSTART:20260901T160000Z', 'DTSTART;VALUE=DATE:20260901')
    .replace('DTEND:20260901T170000Z\r\n', '');
  const prepared = prepareInvitationCancellation(
    source,
    ['alice@example.test'],
    { occurrenceId: '20260902' },
    { now },
  );

  assert.match(prepared.delivery.ical, /^DTSTART;VALUE=DATE:20260902$/m);
  assert.doesNotMatch(prepared.delivery.ical, /^(?:DTEND|DURATION):/m);
});

test('keeps the real duration when a zoned occurrence crosses a DST gap', () => {
  const source = invitation(['RRULE:FREQ=WEEKLY;COUNT=4'])
    .replace('DTSTART:20260901T160000Z', 'DTSTART;TZID=America/New_York:20260301T013000')
    .replace('DTEND:20260901T170000Z', 'DTEND;TZID=America/New_York:20260301T023000')
    .replace('RRULE:FREQ=WEEKLY;COUNT=4', 'RRULE:FREQ=WEEKLY;COUNT=3');
  const prepared = prepareInvitationCancellation(
    source,
    ['alice@example.test'],
    { occurrenceId: '20260308T063000Z' },
    { now },
  );

  assert.match(prepared.delivery.ical, /^DTSTART;TZID=America\/New_York:20260308T013000$/m);
  assert.match(prepared.delivery.ical, /^DURATION:PT3600S$/m);
  assert.doesNotMatch(prepared.delivery.ical, /^DTEND/m);
});

test('accepts a positive mixed-zone master duration for occurrence cancellation', () => {
  const source = invitation(['RRULE:FREQ=WEEKLY;COUNT=3'])
    .replace('DTSTART:20260901T160000Z', 'DTSTART;TZID=Asia/Tokyo:20260901T200000')
    .replace('DTEND:20260901T170000Z', 'DTEND:20260901T120000Z');
  const prepared = prepareInvitationCancellation(
    source,
    ['alice@example.test'],
    { occurrenceId: '20260908T110000Z' },
    { now },
  );

  assert.match(prepared.delivery.ical, /^DTSTART;TZID=Asia\/Tokyo:20260908T200000$/m);
  assert.match(prepared.delivery.ical, /^DURATION:PT3600S$/m);
});

test('synthesized overlap occurrence cancellation keeps duration unambiguous', () => {
  const source = invitation(['RRULE:FREQ=WEEKLY;COUNT=3'])
    .replace('DTSTART:20260901T160000Z', 'DTSTART;TZID=America/New_York:20261025T013000')
    .replace('DTEND:20260901T170000Z', 'DTEND;TZID=America/New_York:20261025T023000');
  const prepared = prepareInvitationCancellation(
    source,
    ['alice@example.test'],
    { occurrenceId: '20261101T053000Z' },
    { now },
  );

  assert.match(prepared.delivery.ical, /^DTSTART;TZID=America\/New_York:20261101T013000$/m);
  assert.match(prepared.delivery.ical, /^DURATION:PT3600S$/m);
  assert.doesNotMatch(prepared.delivery.ical, /^DTEND/m);
});

test('matches semantically equivalent recurrence parameters and quoted TZIDs', () => {
  const source = invitation(['RRULE:FREQ=WEEKLY;COUNT=4'])
    .replace('DTSTART:20260901T160000Z', 'DTSTART;TZID=America/New_York;VALUE=DATE-TIME:20260901T090000')
    .replace('DTEND:20260901T170000Z', 'DTEND;TZID=America/New_York:20260901T100000')
    .replace('END:VCALENDAR', [
      'BEGIN:VEVENT',
      'UID:meeting-123@example.test',
      'DTSTAMP:20260820T120000Z',
      'RECURRENCE-ID;TZID="America/New_York":20260908T090000',
      'DTSTART;TZID=America/New_York:20260908T110000',
      'DTEND;TZID=America/New_York:20260908T120000',
      'SUMMARY:Moved semantic exception',
      'ORGANIZER:mailto:alice@example.test',
      'ATTENDEE:mailto:instance@example.test',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n'));
  const prepared = prepareInvitationCancellation(
    source,
    ['alice@example.test'],
    { occurrenceId: '20260908T130000Z' },
    { now },
  );

  assert.equal(prepared.delivery.subject, 'Canceled: Moved semantic exception');
  assert.deepEqual(prepared.delivery.recipients, ['instance@example.test']);
  assert.match(prepared.revisedIcal, /RECURRENCE-ID;TZID="America\/New_York":20260908T090000[\s\S]*STATUS:CANCELLED/);
});

test('fails closed for a zoned this-and-future exception', () => {
  const source = invitation(['RRULE:FREQ=WEEKLY;COUNT=4'])
    .replace('DTSTART:20260901T160000Z', 'DTSTART;TZID=America/New_York:20260901T090000')
    .replace('DTEND:20260901T170000Z', 'DTEND;TZID=America/New_York:20260901T100000')
    .replace('END:VCALENDAR', [
      'BEGIN:VEVENT',
      'UID:meeting-123@example.test',
      'DTSTAMP:20260820T120000Z',
      'RECURRENCE-ID;TZID=America/New_York;RANGE=THISANDFUTURE:20260908T090000',
      'DTSTART;TZID=America/New_York:20260908T100000',
      'DTEND;TZID=America/New_York:20260908T110000',
      'ORGANIZER:mailto:alice@example.test',
      'ATTENDEE:mailto:alias@example.test',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n'));

  assert.throws(
    () => prepareInvitationCancellation(
      source,
      ['alice@example.test'],
      { occurrenceId: '20260908T130000Z' },
      { now },
    ),
    error => error instanceof CalendarInvitationActionError && error.code === 'UNSUPPORTED_RECURRENCE_RANGE',
  );
  const [projected] = projectCalendarInvitationOccurrences(
    source,
    ['alice@example.test'],
    ['20260908T130000Z'],
  );
  assert.equal(projected?.role, 'unowned');
  assert.equal(projected?.canRespond, false);
  assert.equal(projected?.canCancel, false);
  assert.match(projected?.actionUnavailableReason || '', /unavailable for this recurrence/i);
});

test('does not co-match a floating exception to a zoned occurrence instant', () => {
  const source = invitation(['RRULE:FREQ=WEEKLY;COUNT=4'])
    .replace('DTSTART:20260901T160000Z', 'DTSTART;TZID=America/New_York:20260901T090000')
    .replace('DTEND:20260901T170000Z', 'DTEND;TZID=America/New_York:20260901T100000')
    .replace('END:VCALENDAR', [
      'BEGIN:VEVENT',
      'UID:meeting-123@example.test',
      'DTSTAMP:20260820T120000Z',
      'RECURRENCE-ID:20260908T130000',
      'DTSTART:20260908T180000',
      'DTEND:20260908T190000',
      'SUMMARY:Unrelated floating exception',
      'ORGANIZER:mailto:alice@example.test',
      'ATTENDEE:mailto:floating@example.test',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n'));
  const prepared = prepareInvitationCancellation(
    source,
    ['alice@example.test'],
    { occurrenceId: '20260908T130000Z' },
    { now },
  );

  assert.equal(prepared.delivery.subject, 'Canceled: Roadmap review');
  assert.deepEqual(prepared.delivery.recipients, ['alias@example.test', 'bob@example.test']);
  assert.match(prepared.delivery.ical, /^RECURRENCE-ID;TZID=America\/New_York:20260908T090000$/m);
  assert.doesNotMatch(prepared.revisedIcal, /RECURRENCE-ID:20260908T130000[\s\S]*STATUS:CANCELLED/);
});

test('does not notify a master roster when an occurrence explicitly clears attendees', () => {
  const source = invitation(['RRULE:FREQ=WEEKLY;COUNT=4']).replace('END:VCALENDAR', [
    'BEGIN:VEVENT',
    'UID:meeting-123@example.test',
    'DTSTAMP:20260820T120000Z',
    'RECURRENCE-ID:20260908T160000Z',
    'DTSTART:20260908T160000Z',
    'DTEND:20260908T170000Z',
    'X-OMS-ACTIVESYNC-ATTENDEES-CLEARED:1',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n'));

  assert.throws(
    () => prepareInvitationCancellation(
      source,
      ['alice@example.test'],
      { occurrenceId: '20260908T160000Z' },
      { now },
    ),
    error => error instanceof CalendarInvitationActionError && error.code === 'NO_ATTENDEES',
  );
});

test('occurrence cancellation fails closed when an exception names a different organizer', () => {
  const source = invitation(['RRULE:FREQ=WEEKLY;COUNT=4']).replace('END:VCALENDAR', [
    'BEGIN:VEVENT',
    'UID:meeting-123@example.test',
    'DTSTAMP:20260820T120000Z',
    'RECURRENCE-ID:20260908T160000Z',
    'DTSTART:20260908T180000Z',
    'DTEND:20260908T190000Z',
    'ORGANIZER:mailto:legitimate@example.net',
    'ATTENDEE:mailto:victim@example.net',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n'));

  assert.throws(
    () => prepareInvitationCancellation(
      source,
      ['alice@example.test'],
      { occurrenceId: '20260908T160000Z' },
      { now },
    ),
    error => error instanceof CalendarInvitationActionError && error.code === 'ORGANIZER_MISMATCH',
  );
});

test('allows series cancellation after a variant occurrence has already been canceled', () => {
  const source = invitation(['RRULE:FREQ=WEEKLY;COUNT=4']).replace('END:VCALENDAR', [
    'BEGIN:VEVENT',
    'UID:meeting-123@example.test',
    'DTSTAMP:20260820T120000Z',
    'RECURRENCE-ID:20260908T160000Z',
    'DTSTART:20260908T180000Z',
    'DTEND:20260908T190000Z',
    'STATUS:CANCELLED',
    'ORGANIZER:mailto:alice@example.test',
    'ATTENDEE:mailto:instance@example.test',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n'));
  const prepared = prepareInvitationCancellation(source, ['alice@example.test'], {}, { now });

  assert.deepEqual(prepared.delivery.recipients, ['alias@example.test', 'bob@example.test']);
  assert.match(prepared.delivery.ical, /^STATUS:CANCELLED$/m);
});

test('renders a UTC occurrence identity in the recurring series time zone', () => {
  const source = invitation([
    'RRULE:FREQ=WEEKLY;COUNT=4',
  ])
    .replace('DTSTART:20260901T160000Z', 'DTSTART;TZID=America/New_York:20260901T090000')
    .replace('DTEND:20260901T170000Z', 'DTEND;TZID=America/New_York:20260901T100000');
  const prepared = prepareInvitationCancellation(
    source,
    ['alice@example.test'],
    { occurrenceId: '20260908T130000Z' },
    { now },
  );

  assert.match(
    prepared.delivery.ical,
    /^RECURRENCE-ID;TZID=America\/New_York:20260908T090000$/m,
  );
  assert.doesNotMatch(prepared.delivery.ical, /TZID=America\/New_York:[^\r\n]*Z$/m);
});

test('renders occurrence identity wall time through a canonical custom VTIMEZONE alias', () => {
  const source = invitation(['RRULE:FREQ=WEEKLY;COUNT=4'])
    .replace('BEGIN:VEVENT', [
      'BEGIN:VTIMEZONE',
      'TZID:OMS-Eastern',
      'X-LIC-LOCATION:America/New_York',
      'BEGIN:DAYLIGHT',
      'DTSTART:19700308T020000',
      'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU',
      'TZOFFSETFROM:-0500',
      'TZOFFSETTO:-0400',
      'END:DAYLIGHT',
      'BEGIN:STANDARD',
      'DTSTART:19701101T020000',
      'RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU',
      'TZOFFSETFROM:-0400',
      'TZOFFSETTO:-0500',
      'END:STANDARD',
      'END:VTIMEZONE',
      'BEGIN:VEVENT',
    ].join('\r\n'))
    .replace('DTSTART:20260901T160000Z', 'DTSTART;TZID=OMS-Eastern:20260901T090000')
    .replace('DTEND:20260901T170000Z', 'DTEND;TZID=OMS-Eastern:20260901T100000');
  const prepared = prepareInvitationCancellation(
    source,
    ['alice@example.test'],
    { occurrenceId: '20260908T130000Z' },
    { now },
  );

  assert.match(prepared.delivery.ical, /^RECURRENCE-ID;TZID=OMS-Eastern:20260908T090000$/m);
  assert.match(prepared.delivery.ical, /BEGIN:VTIMEZONE[\s\S]*TZID:OMS-Eastern[\s\S]*END:VTIMEZONE/);
  const roundTrip = parseIcalEvent('meeting-123@example.test', prepared.delivery.ical);
  assert.equal(roundTrip.timeZone, 'America/New_York');
});

test('preserves an unsupported TZID while cancelling its floating wall-time occurrence', () => {
  const source = invitation(['RRULE:FREQ=WEEKLY;COUNT=4'])
    .replace('BEGIN:VEVENT', [
      'BEGIN:VTIMEZONE',
      'TZID:Broken/Zone',
      'BEGIN:STANDARD',
      'DTSTART:19700101T000000',
      'TZOFFSETFROM:+0100',
      'TZOFFSETTO:+013015',
      'END:STANDARD',
      'END:VTIMEZONE',
      'BEGIN:VEVENT',
    ].join('\r\n'))
    .replace('DTSTART:20260901T160000Z', 'DTSTART;TZID=Broken/Zone:20260901T200000')
    .replace('DTEND:20260901T170000Z', 'DTEND;TZID=Broken/Zone:20260901T210000');
  const prepared = prepareInvitationCancellation(
    source,
    ['alice@example.test'],
    { occurrenceId: '20260908T200000Z' },
    { now },
  );

  assert.match(prepared.delivery.ical, /^RECURRENCE-ID;TZID=Broken\/Zone:20260908T200000$/m);
});

test('projects an already-canceled organizer meeting so an exact request replay can be recognized', () => {
  const source = invitation(['STATUS:CANCELLED']);
  const prepared = prepareInvitationCancellation(source, ['alice@example.test'], {}, { now });

  assert.equal(prepared.alreadyCancelled, true);
  assert.match(prepared.revisedIcal, /^STATUS:CANCELLED$/m);
  assert.match(prepared.revisedIcal, /^SEQUENCE:3$/m);
  assert.match(prepared.delivery.ical, /^SEQUENCE:3$/m);
  assert.equal(prepared.delivery.method, 'CANCEL');
});

test('prepares an attendee COUNTER without rewriting the stored event', () => {
  const source = invitation();
  const prepared = prepareInvitationCounter(
    source,
    ['alias@example.test'],
    {
      start: new Date('2026-09-01T18:00:00.000Z'),
      end: new Date('2026-09-01T18:45:00.000Z'),
      comment: 'Could we start two hours later?',
    },
    { now },
  );

  assert.equal(prepared.delivery.method, 'COUNTER');
  assert.equal(prepared.delivery.sender, 'alias@example.test');
  assert.deepEqual(prepared.delivery.recipients, ['alice@example.test']);
  assert.equal(prepared.delivery.subject, 'New time proposed: Roadmap review');
  assert.match(prepared.delivery.ical, /^DTSTART:20260901T180000Z$/m);
  assert.match(prepared.delivery.ical, /^DTEND:20260901T184500Z$/m);
  assert.match(prepared.delivery.ical, /^COMMENT:Could we start two hours later\?$/m);
  assert.match(prepared.delivery.text, /Proposed start: 2026-09-01T18:00:00\.000Z/);
  assert.match(prepared.delivery.text, /Proposed end: 2026-09-01T18:45:00\.000Z/);
  assert.doesNotMatch(prepared.delivery.text, /Starts: 2026-09-01T16:00:00\.000Z/);
  assert.equal(validateICalendarDocument(prepared.delivery.ical.replace(/^METHOD:.*\r?\n/m, '')).canonicalUid, 'meeting-123@example.test');
  assert.equal(source.includes('20260901T180000Z'), false);
});

test('blocks new-time proposals for recurring meetings and organizer-disabled proposals', () => {
  assert.throws(
    () => prepareInvitationCounter(
      invitation(['RRULE:FREQ=WEEKLY;COUNT=4']),
      ['alias@example.test'],
      { start: new Date('2026-09-01T18:00:00Z'), end: new Date('2026-09-01T19:00:00Z') },
      { now },
    ),
    (error) => error instanceof CalendarInvitationActionError && error.code === 'PROPOSAL_NOT_ALLOWED',
  );

  assert.throws(
    () => prepareInvitationCounter(
      invitation(['X-MICROSOFT-DISALLOW-COUNTER:TRUE']),
      ['alias@example.test'],
      { start: new Date('2026-09-01T18:00:00Z'), end: new Date('2026-09-01T19:00:00Z') },
      { now },
    ),
    (error) => error instanceof CalendarInvitationActionError && error.code === 'PROPOSAL_NOT_ALLOWED',
  );
});

test('honors recognized organizer forwarding policy flags', () => {
  const blocked = projectCalendarInvitation(
    invitation(['X-MICROSOFT-DISALLOW-FORWARDING:TRUE']),
    ['alias@example.test'],
  );
  assert.equal(blocked?.canForward, false);
});
