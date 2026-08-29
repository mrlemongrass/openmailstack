const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const { expandRecurringEvent, parseIcalEvent } = require('../src/calendar-format.js');
const { calendarEventToActiveSyncApplicationData } = require('../src/eas-calendar.js');

process.env.OMS_DB_PASSWORD ||= 'calendar-invitation-routes-test';

const user = 'guest@example.test';
const calendarId = 9;
const events = new Map();
const revisions = new Map();
const reservations = new Map();
const hotRemovedKeys = new Set();
const identityLookupMisses = new Map();
const deliveries = [];
let calendarRevision = 1;
let permissionGranted = true;
let ownedSenderAddresses = [user];

function reset() {
  events.clear();
  revisions.clear();
  reservations.clear();
  hotRemovedKeys.clear();
  identityLookupMisses.clear();
  deliveries.length = 0;
  calendarRevision = 1;
  permissionGranted = true;
  ownedSenderAddresses = [user];
}

function invite(uid = 'route-meeting') {
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//OpenMailStack//Route Test//EN',
    'BEGIN:VEVENT', `UID:${uid}`, 'DTSTAMP:20260820T120000Z', 'SEQUENCE:2',
    'DTSTART:20260901T160000Z', 'DTEND:20260901T170000Z',
    'SUMMARY:Route meeting', 'ORGANIZER:mailto:organizer@example.test',
    'ATTENDEE;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:guest@example.test',
    'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n');
}

function organizedSeries(uid = 'organized-series') {
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//OpenMailStack//Route Test//EN',
    'BEGIN:VEVENT', `UID:${uid}`, 'DTSTAMP:20260820T120000Z', 'SEQUENCE:2',
    'DTSTART:20260901T160000Z', 'DTEND:20260901T170000Z',
    'RRULE:FREQ=WEEKLY;COUNT=3', 'SUMMARY:Owned series',
    'ORGANIZER:mailto:guest@example.test',
    'ATTENDEE;PARTSTAT=NEEDS-ACTION:mailto:attendee@example.net',
    'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n');
}

function organizedSeriesWithMovedOccurrence(uid = 'organized-series') {
  return organizedSeries(uid).replace('END:VCALENDAR', [
    'BEGIN:VEVENT', `UID:${uid}`, 'DTSTAMP:20260821T120000Z', 'SEQUENCE:7',
    'RECURRENCE-ID:20260908T160000Z',
    'DTSTART:20260908T180000Z', 'DTEND:20260908T190000Z',
    'SUMMARY:Moved owned series occurrence',
    'ORGANIZER:mailto:guest@example.test',
    'ATTENDEE;PARTSTAT=NEEDS-ACTION:mailto:instance-attendee@example.net',
    'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n'));
}

function organizedCustomZoneSeries(uid = 'organized-custom-zone') {
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//OpenMailStack//Route Test//EN',
    'BEGIN:VTIMEZONE', 'TZID:OMS-Eastern', 'X-LIC-LOCATION:America/New_York',
    'BEGIN:DAYLIGHT', 'DTSTART:19700308T020000', 'RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=2SU',
    'TZOFFSETFROM:-0500', 'TZOFFSETTO:-0400', 'END:DAYLIGHT',
    'BEGIN:STANDARD', 'DTSTART:19701101T020000', 'RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=1SU',
    'TZOFFSETFROM:-0400', 'TZOFFSETTO:-0500', 'END:STANDARD', 'END:VTIMEZONE',
    'BEGIN:VEVENT', `UID:${uid}`, 'DTSTAMP:20260820T120000Z', 'SEQUENCE:2',
    'DTSTART;TZID=OMS-Eastern:20260901T090000', 'DTEND;TZID=OMS-Eastern:20260901T100000',
    'RRULE:FREQ=WEEKLY;COUNT=3', 'SUMMARY:Owned custom zone series',
    'ORGANIZER:mailto:guest@example.test',
    'ATTENDEE;PARTSTAT=NEEDS-ACTION:mailto:attendee@example.net',
    'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n');
}

function organizedUnsupportedZoneSeries(uid = 'organized-unsupported-zone') {
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//OpenMailStack//Route Test//EN',
    'BEGIN:VTIMEZONE', 'TZID:Broken/Zone', 'BEGIN:STANDARD',
    'DTSTART:19700101T000000', 'TZOFFSETFROM:+0100', 'TZOFFSETTO:+013015',
    'END:STANDARD', 'END:VTIMEZONE',
    'BEGIN:VEVENT', `UID:${uid}`, 'DTSTAMP:20260820T120000Z', 'SEQUENCE:2',
    'DTSTART;TZID=Broken/Zone:20260901T200000', 'DTEND;TZID=Broken/Zone:20260901T210000',
    'RRULE:FREQ=WEEKLY;COUNT=3', 'SUMMARY:Owned unsupported zone series',
    'ORGANIZER:mailto:guest@example.test',
    'ATTENDEE;PARTSTAT=NEEDS-ACTION:mailto:attendee@example.net',
    'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n');
}

const db = require('../src/db.js');
db.pool.query = async () => { throw new Error('Invitation route query escaped its transaction'); };
db.pool.getConnection = async () => {
  let workingEvents;
  let workingRevisions;
  let workingReservations;
  let workingCalendarRevision;
  const connection = {
    beginTransaction: async () => {
      workingEvents = new Map(events);
      workingRevisions = new Map(revisions);
      workingReservations = new Map(reservations);
      workingCalendarRevision = calendarRevision;
    },
    commit: async () => {
      events.clear();
      revisions.clear();
      reservations.clear();
      for (const entry of workingEvents) events.set(...entry);
      for (const entry of workingRevisions) revisions.set(...entry);
      for (const entry of workingReservations) reservations.set(...entry);
      calendarRevision = workingCalendarRevision;
    },
    rollback: async () => {},
    release: () => {},
    query: async (sql, params = []) => {
      const compact = String(sql).replace(/\s+/g, ' ').trim();
      if (compact.startsWith('SELECT c.id')) {
        return [permissionGranted ? [{ id: calendarId, dav_slug: 'personal', subscribed_url: null }] : [], []];
      }
      if (compact.startsWith('SELECT uid, resource_name, ical_data, sync_token FROM events')) {
        const uid = params[1];
        return [workingEvents.has(uid) ? [{
          uid, resource_name: `${uid}.ics`, ical_data: workingEvents.get(uid),
          sync_token: workingRevisions.get(uid),
        }] : [], []];
      }
      if (compact.startsWith('SELECT ical_data FROM events')) {
        const uid = params[1];
        return [workingEvents.has(uid) ? [{ ical_data: workingEvents.get(uid) }] : [], []];
      }
      if (compact.startsWith('SELECT id, submission_kind, submission_origin, idempotency_key')) {
        const key = params[1];
        const misses = identityLookupMisses.get(key) || 0;
        if (misses > 0) {
          identityLookupMisses.set(key, misses - 1);
          return [[], []];
        }
        const reservation = hotRemovedKeys.has(key) ? null : workingReservations.get(key);
        return [reservation ? [{
          id: reservation.id,
          submission_kind: 'immediate',
          submission_origin: 'web',
          idempotency_key: key,
          request_fingerprint: reservation.fingerprint,
          status: reservation.status,
          message_id: `<route-${reservation.id}@example.test>`,
          send_at: new Date('2026-08-29T18:30:00.000Z'),
          send_at_utc: '2026-08-29T18:30:00.000Z',
          smtp_accepted_at: reservation.status === 'completed' || reservation.status === 'partial_delivery'
            ? new Date('2026-08-29T18:30:01.000Z')
            : null,
          save_in_sent_items: reservation.saveSentCopy ? 1 : 0,
          rejected_recipients_json: JSON.stringify(reservation.rejectedRecipients || []),
          last_error_code: reservation.status === 'failed' ? 'smtp_failed' : null,
          display_metadata_json: JSON.stringify({ recovery: reservation.recovery }),
          sender_address: reservation.senderAddress,
          envelope_json: JSON.stringify(reservation.envelope),
          raw_message: reservation.raw,
          sent_raw_message: reservation.sentRaw,
        }] : [], []];
      }
      if (compact.includes('FROM outbound_submission_registry')) {
        const key = params[1];
        const misses = identityLookupMisses.get(key) || 0;
        if (misses > 0) {
          identityLookupMisses.set(key, misses - 1);
          return [[], []];
        }
        const reservation = workingReservations.get(key);
        return [reservation ? [{
          id: reservation.id,
          submission_kind: 'immediate',
          submission_origin: 'web',
          idempotency_key: key,
          request_fingerprint: reservation.fingerprint,
          status: reservation.status,
          message_id: null,
          send_at: new Date('2026-08-29T18:30:00.000Z'),
          send_at_utc: '2026-08-29T18:30:00.000Z',
          smtp_accepted_at: reservation.status === 'completed'
            ? new Date('2026-08-29T18:30:01.000Z')
            : null,
          save_in_sent_items: reservation.saveSentCopy ? 1 : 0,
          rejected_recipients_json: '[]',
          last_error_code: null,
          display_metadata_json: JSON.stringify({ recovery: reservation.recovery }),
          registry_only: 1,
        }] : [], []];
      }
      if (compact.startsWith('UPDATE scheduled_emails SET display_metadata_json')) {
        const reservation = workingReservations.get(params[3]);
        if (!reservation || reservation.id !== Number(params[1])) return [{ affectedRows: 0 }, []];
        reservation.recovery = JSON.parse(params[0]).recovery;
        return [{ affectedRows: 1 }, []];
      }
      if (compact === 'SELECT sync_token FROM calendars WHERE id = ? LIMIT 1 FOR UPDATE') {
        return [[{ sync_token: workingCalendarRevision }], []];
      }
      if (compact === 'UPDATE calendars SET sync_token = ? WHERE id = ? AND sync_token = ?') {
        if (Number(params[2]) !== workingCalendarRevision) return [{ affectedRows: 0 }, []];
        workingCalendarRevision = Number(params[0]);
        return [{ affectedRows: 1 }, []];
      }
      if (compact.startsWith('DELETE FROM calendar_tombstones')) return [{ affectedRows: 0 }, []];
      if (compact.startsWith('UPDATE events SET ical_data')) {
        const uid = params[3];
        if (!workingEvents.has(uid) || Number(params[4]) !== Number(workingRevisions.get(uid))) {
          return [{ affectedRows: 0 }, []];
        }
        workingEvents.set(uid, params[0]);
        workingRevisions.set(uid, Number(params[1]));
        return [{ affectedRows: 1 }, []];
      }
      throw new Error(`Unexpected invitation route query: ${compact}`);
    },
  };
  Object.defineProperty(connection, 'workingReservations', { get: () => workingReservations });
  return connection;
};

const authPath = require.resolve('../src/auth.js');
const auth = require(authPath);
require.cache[authPath].exports = {
  ...auth,
  requireSession: (req, _res, next) => {
    req.user = { username: user, password: 'test-only', isAdmin: false };
    next();
  },
};

const outboundPath = require.resolve('../src/outbound-mail.js');
const outbound = require(outboundPath);
require.cache[outboundPath].exports = {
  ...outbound,
  listOwnedSenderIdentities: async () => ({
    name: 'Calendar User', primary: user, addresses: ownedSenderAddresses,
  }),
  compileOutboundMessage: async input => {
    deliveries.push(input);
    const raw = Buffer.from(`Message-ID: ${input.messageId}\r\n\r\n${input.text}`);
    return {
      raw, sentRaw: raw, envelope: { from: input.sender.address, to: input.to },
      messageId: input.messageId, date: new Date(),
      metadata: {
        from: input.sender.address, to: input.to.join(', '), cc: '', bcc: '', replyTo: '',
        subject: input.subject, text: input.text, html: '', inReplyTo: '', references: [],
      },
    };
  },
};

const scheduledPath = require.resolve('../src/scheduled-send.js');
const scheduled = require(scheduledPath);
require.cache[scheduledPath].exports = {
  ...scheduled,
  ensureScheduledEmailsSchema: async () => {},
  reserveOutboundInTransaction: async (connection, input) => {
    const transactionalReservations = connection.workingReservations;
    const existing = transactionalReservations.get(input.idempotencyKey);
    const fingerprint = JSON.stringify(input.fingerprintSource);
    if (existing) {
      if (existing.fingerprint !== fingerprint) throw new scheduled.OutboundIdempotencyConflictError();
      return { id: existing.id, replayed: true };
    }
    const value = {
      id: transactionalReservations.size + 1,
      fingerprint,
      status: 'scheduled',
      rejectedRecipients: [],
      recovery: input.message.recovery,
      senderAddress: input.message.senderAddress,
      envelope: input.message.envelope,
      raw: input.message.raw,
      sentRaw: input.message.sentRaw,
      saveSentCopy: input.message.saveSentCopy !== false,
    };
    transactionalReservations.set(input.idempotencyKey, value);
    return { id: value.id, replayed: false };
  },
  runScheduledSender: async () => 0,
};

const indexPath = require.resolve('../src/index.js');
require.cache[indexPath] = {
  id: indexPath, filename: indexPath, loaded: true,
  exports: { io: { to: () => ({ emit: () => {} }) } }, children: [], paths: [],
};

const { appsApiRouter } = require('../src/apps-api.js');

async function withServer(t) {
  const app = express();
  app.use(express.json());
  app.use('/api/apps', appsApiRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return server.address().port;
}

function post(port, path, body, key) {
  const raw = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const request = http.request({
      hostname: '127.0.0.1', port, path: `/api/apps${path}`, method: 'POST',
      headers: {
        'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(raw),
        ...(key ? { 'Idempotency-Key': key } : {}),
      },
    }, response => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { text += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(text) }));
    });
    request.on('error', reject);
    request.end(raw);
  });
}

test('attendee response atomically persists PARTSTAT and reserves one REPLY per request key', async t => {
  reset();
  const uid = 'route-meeting';
  events.set(uid, invite(uid));
  revisions.set(uid, 1);
  const port = await withServer(t);

  const first = await post(port, `/events/${calendarId}/${uid}/respond`, { response: 'accepted' }, 'route-response-0001');
  assert.equal(first.status, 200);
  assert.equal(first.body.deliveryStatus, 'pending');
  assert.equal(first.body.statusUrl, '/api/messages/outbound/1');
  assert.equal(first.body.replayed, false);
  assert.match(events.get(uid), /PARTSTAT=ACCEPTED;RSVP=FALSE/);
  assert.match(deliveries[0].icalEvent.content, /^METHOD:REPLY$/m);

  const replay = await post(port, `/events/${calendarId}/${uid}/respond`, { response: 'accepted' }, 'route-response-0001');
  assert.equal(replay.status, 200);
  assert.equal(replay.body.replayed, true);

  const duplicate = await post(port, `/events/${calendarId}/${uid}/respond`, { response: 'accepted' }, 'route-response-0002');
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.body.code, 'ALREADY_RESPONDED');
  assert.equal(reservations.size, 1);
});

test('an exact invitation request replays from durable outbound identity after the event is gone', async t => {
  reset();
  const uid = 'deleted-after-response';
  events.set(uid, invite(uid));
  revisions.set(uid, 1);
  const port = await withServer(t);
  const key = 'route-deleted-replay-0001';

  const first = await post(port, `/events/${calendarId}/${uid}/respond`, { response: 'accepted' }, key);
  assert.equal(first.status, 200);
  events.delete(uid);
  revisions.delete(uid);

  const replay = await post(port, `/events/${calendarId}/${uid}/respond`, { response: 'accepted' }, key);
  assert.equal(replay.status, 200);
  assert.equal(replay.body.replayed, true);
  assert.equal(replay.body.deliveryStatus, 'pending');
  assert.equal(deliveries.length, 1, 'exact replay must not rebuild or duplicate the notification');
});

test('a reservation-time replay re-reads and returns the durable terminal delivery state', async t => {
  reset();
  const uid = 'reservation-race-response';
  const key = 'route-race-replay-0001';
  events.set(uid, invite(uid));
  revisions.set(uid, 1);
  const port = await withServer(t);

  const first = await post(port, `/events/${calendarId}/${uid}/respond`, { response: 'accepted' }, key);
  assert.equal(first.status, 200);
  reservations.get(key).status = 'completed';
  const committedEvent = events.get(uid);
  identityLookupMisses.set(key, 2);

  const replay = await post(port, `/events/${calendarId}/${uid}/respond`, { response: 'accepted' }, key);
  assert.equal(replay.status, 200);
  assert.equal(replay.body.replayed, true);
  assert.equal(replay.body.deliveryStatus, 'accepted');
  assert.equal(events.get(uid), committedEvent);
  assert.equal(reservations.size, 1);
});

test('an exact terminal replay survives hot-row compaction through privacy-safe registry metadata', async t => {
  reset();
  const uid = 'compacted-response';
  events.set(uid, invite(uid));
  revisions.set(uid, 1);
  const port = await withServer(t);
  const key = 'route-compacted-replay-0001';

  await post(port, `/events/${calendarId}/${uid}/respond`, { response: 'accepted' }, key);
  reservations.get(key).status = 'completed';
  hotRemovedKeys.add(key);
  events.delete(uid);
  revisions.delete(uid);

  const replay = await post(port, `/events/${calendarId}/${uid}/respond`, { response: 'accepted' }, key);
  assert.equal(replay.status, 200);
  assert.equal(replay.body.replayed, true);
  assert.equal(replay.body.deliveryStatus, 'accepted');
  assert.equal(deliveries.length, 1);
});

test('a failed attendee response can retry under a fresh key without mutating the event twice', async t => {
  reset();
  const uid = 'failed-response';
  events.set(uid, invite(uid));
  revisions.set(uid, 1);
  const port = await withServer(t);
  const firstKey = 'route-failed-response-0001';

  const first = await post(port, `/events/${calendarId}/${uid}/respond`, { response: 'accepted' }, firstKey);
  assert.equal(first.status, 200);
  const revised = events.get(uid);
  const revisedToken = revisions.get(uid);
  reservations.get(firstKey).status = 'failed';

  const retry = await post(port, `/events/${calendarId}/${uid}/respond`, {
    response: 'accepted', retryOf: firstKey,
  }, 'route-failed-response-0002');
  assert.equal(retry.status, 200);
  assert.equal(retry.body.replayed, false);
  assert.equal(events.get(uid), revised);
  assert.equal(revisions.get(uid), revisedToken);
  assert.equal(reservations.size, 2);
  assert.deepEqual(reservations.get('route-failed-response-0002').envelope.to, ['organizer@example.test']);
  assert.equal(deliveries.length, 1, 'retry must reuse the immutable original notification');
});

test('a privacy-safe generic retry reconstructs the frozen action from its predecessor key', async t => {
  reset();
  const uid = 'generic-failed-response';
  events.set(uid, invite(uid));
  revisions.set(uid, 1);
  const port = await withServer(t);
  const firstKey = 'route-generic-response-0001';
  const retryKey = 'route-generic-response-0002';

  await post(port, `/events/${calendarId}/${uid}/respond`, { response: 'accepted' }, firstKey);
  reservations.get(firstKey).status = 'failed';
  const retry = await post(port, '/calendar-invitations/retry', { retryOf: firstKey }, retryKey);
  assert.equal(retry.status, 200);
  assert.equal(retry.body.replayed, false);
  assert.deepEqual(reservations.get(retryKey).envelope.to, ['organizer@example.test']);

  events.delete(uid);
  revisions.delete(uid);
  const replay = await post(port, '/calendar-invitations/retry', { retryOf: firstKey }, retryKey);
  assert.equal(replay.status, 200);
  assert.equal(replay.body.replayed, true);
});

test('uncertain invitation delivery requires explicit verified absence before exact retry', async t => {
  reset();
  const uid = 'uncertain-response';
  events.set(uid, invite(uid));
  revisions.set(uid, 1);
  const port = await withServer(t);
  const firstKey = 'route-uncertain-response-0001';

  await post(port, `/events/${calendarId}/${uid}/respond`, { response: 'accepted' }, firstKey);
  reservations.get(firstKey).status = 'delivery_uncertain';
  const blocked = await post(port, '/calendar-invitations/retry', {
    retryOf: firstKey,
  }, 'route-uncertain-response-0002');
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.code, 'RETRY_NOT_ALLOWED');

  const confirmed = await post(port, '/calendar-invitations/retry', {
    retryOf: firstKey,
    verifiedAbsent: true,
  }, 'route-uncertain-response-0003');
  assert.equal(confirmed.status, 200);
  assert.equal(confirmed.body.deliveryStatus, 'pending');
});

test('exact retry rejects a sender identity that is no longer owned', async t => {
  reset();
  const uid = 'revoked-alias-response';
  const alias = 'former-alias@example.test';
  const firstKey = 'route-revoked-alias-0001';
  events.set(uid, invite(uid).replace('mailto:guest@example.test', `mailto:${alias}`));
  revisions.set(uid, 1);
  ownedSenderAddresses = [user, alias];
  const port = await withServer(t);

  const first = await post(port, `/events/${calendarId}/${uid}/respond`, {
    response: 'accepted',
  }, firstKey);
  assert.equal(first.status, 200);
  reservations.get(firstKey).status = 'failed';
  ownedSenderAddresses = [user];

  const retry = await post(port, '/calendar-invitations/retry', {
    retryOf: firstKey,
  }, 'route-revoked-alias-0002');
  assert.equal(retry.status, 403);
  assert.equal(retry.body.code, 'SENDER_NOT_AUTHORIZED');
  assert.equal(reservations.size, 1);
});

test('a failed notification permits one retry successor and binds replay to its predecessor', async t => {
  reset();
  const uid = 'single-retry-successor';
  events.set(uid, invite(uid));
  revisions.set(uid, 1);
  const port = await withServer(t);
  const firstKey = 'route-single-retry-0001';
  const retryKey = 'route-single-retry-0002';

  await post(port, `/events/${calendarId}/${uid}/respond`, { response: 'accepted' }, firstKey);
  reservations.get(firstKey).status = 'failed';
  const firstRetry = await post(port, `/events/${calendarId}/${uid}/respond`, {
    response: 'accepted', retryOf: firstKey,
  }, retryKey);
  assert.equal(firstRetry.status, 200);

  const sameRetry = await post(port, `/events/${calendarId}/${uid}/respond`, {
    response: 'accepted', retryOf: firstKey,
  }, retryKey);
  assert.equal(sameRetry.status, 200);
  assert.equal(sameRetry.body.replayed, true);

  const secondSuccessor = await post(port, `/events/${calendarId}/${uid}/respond`, {
    response: 'accepted', retryOf: firstKey,
  }, 'route-single-retry-0003');
  assert.equal(secondSuccessor.status, 409);
  assert.equal(secondSuccessor.body.code, 'RETRY_ALREADY_STARTED');

  const changedPredecessor = await post(port, `/events/${calendarId}/${uid}/respond`, {
    response: 'accepted', retryOf: 'route-other-predecessor-0001',
  }, retryKey);
  assert.equal(changedPredecessor.status, 409);
  assert.equal(changedPredecessor.body.code, 'OUTBOUND_IDEMPOTENCY_CONFLICT');
  assert.equal(reservations.size, 2);
});

test('retry fails closed when the locally committed invitation action was superseded', async t => {
  reset();
  const uid = 'superseded-response';
  events.set(uid, invite(uid));
  revisions.set(uid, 1);
  const port = await withServer(t);
  const firstKey = 'route-superseded-response-0001';

  await post(port, `/events/${calendarId}/${uid}/respond`, { response: 'accepted' }, firstKey);
  reservations.get(firstKey).status = 'failed';
  events.set(uid, events.get(uid).replace('PARTSTAT=ACCEPTED;RSVP=FALSE', 'PARTSTAT=DECLINED;RSVP=FALSE'));
  revisions.set(uid, 3);

  const retry = await post(port, `/events/${calendarId}/${uid}/respond`, {
    response: 'accepted', retryOf: firstKey,
  }, 'route-superseded-response-0002');
  assert.equal(retry.status, 409);
  assert.equal(retry.body.code, 'INVITATION_ACTION_SUPERSEDED');
  assert.equal(reservations.size, 1);
});

test('invitation retries fail closed after emitted schedule or sequence fields change', async t => {
  reset();
  const responseUid = 'rescheduled-response';
  const responseKey = 'route-rescheduled-response-0001';
  const cancelUid = 'rescheduled-cancel';
  const cancelKey = 'route-rescheduled-cancel-0001';
  const proposalUid = 'rescheduled-proposal';
  const proposalKey = 'route-rescheduled-proposal-0001';
  events.set(responseUid, invite(responseUid));
  revisions.set(responseUid, 1);
  events.set(cancelUid, organizedSeries(cancelUid));
  revisions.set(cancelUid, 1);
  events.set(proposalUid, invite(proposalUid));
  revisions.set(proposalUid, 1);
  const port = await withServer(t);

  await post(port, `/events/${calendarId}/${responseUid}/respond`, { response: 'accepted' }, responseKey);
  reservations.get(responseKey).status = 'failed';
  events.set(responseUid, events.get(responseUid)
    .replace('SEQUENCE:2', 'SEQUENCE:3')
    .replace('DTSTART:20260901T160000Z', 'DTSTART:20260901T180000Z')
    .replace('DTEND:20260901T170000Z', 'DTEND:20260901T190000Z'));

  await post(port, `/events/${calendarId}/${cancelUid}/cancel`, { scope: 'series' }, cancelKey);
  reservations.get(cancelKey).status = 'failed';
  events.set(cancelUid, events.get(cancelUid)
    .replace('SEQUENCE:3', 'SEQUENCE:4')
    .replace('DTSTART:20260901T160000Z', 'DTSTART:20260901T180000Z')
    .replace('DTEND:20260901T170000Z', 'DTEND:20260901T190000Z'));

  await post(port, `/events/${calendarId}/${proposalUid}/propose-time`, {
    start: '2026-09-01T18:00:00.000Z', end: '2026-09-01T19:00:00.000Z',
  }, proposalKey);
  reservations.get(proposalKey).status = 'failed';
  events.set(proposalUid, events.get(proposalUid).replace('SEQUENCE:2', 'SEQUENCE:3'));

  for (const [retryOf, retryKey] of [
    [responseKey, 'route-rescheduled-response-0002'],
    [cancelKey, 'route-rescheduled-cancel-0002'],
    [proposalKey, 'route-rescheduled-proposal-0002'],
  ]) {
    const retry = await post(port, '/calendar-invitations/retry', { retryOf }, retryKey);
    assert.equal(retry.status, 409);
    assert.equal(retry.body.code, 'INVITATION_ACTION_SUPERSEDED');
  }
  assert.equal(reservations.size, 3);
});

test('series cancellation retry fails closed when a new active exception roster appears', async t => {
  reset();
  const uid = 'series-roster-superseded';
  const firstKey = 'route-series-roster-0001';
  events.set(uid, organizedSeries(uid));
  revisions.set(uid, 1);
  const port = await withServer(t);

  const first = await post(port, `/events/${calendarId}/${uid}/cancel`, { scope: 'series' }, firstKey);
  assert.equal(first.status, 200);
  reservations.get(firstKey).status = 'failed';
  events.set(uid, events.get(uid).replace('END:VCALENDAR', [
    'BEGIN:VEVENT', `UID:${uid}`, 'DTSTAMP:20260822T120000Z',
    'RECURRENCE-ID:20260908T160000Z',
    'DTSTART:20260908T180000Z', 'DTEND:20260908T190000Z',
    'ORGANIZER:mailto:guest@example.test',
    'ATTENDEE:mailto:new-roster@example.net',
    'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n')));
  revisions.set(uid, 3);

  const retry = await post(port, '/calendar-invitations/retry', {
    retryOf: firstKey,
  }, 'route-series-roster-0002');
  assert.equal(retry.status, 409);
  assert.equal(retry.body.code, 'INVITATION_ACTION_SUPERSEDED');
  assert.equal(reservations.size, 1);
});

test('organizer occurrence cancellation persists EXDATE and queues CANCEL without deleting the series', async t => {
  reset();
  const uid = 'organized-series';
  events.set(uid, organizedSeriesWithMovedOccurrence(uid));
  revisions.set(uid, 1);
  const port = await withServer(t);

  const result = await post(port, `/events/${calendarId}/${uid}/cancel`, {
    scope: 'occurrence', occurrenceId: '20260908T160000Z',
  }, 'route-cancel-0001');
  assert.equal(result.status, 200);
  assert.match(events.get(uid), /EXDATE:20260908T160000Z/);
  assert.match(events.get(uid), /SEQUENCE:8[\s\S]*RECURRENCE-ID:20260908T160000Z[\s\S]*STATUS:CANCELLED/);
  assert.match(events.get(uid), /^SEQUENCE:8$/m);
  assert.match(deliveries[0].icalEvent.content, /^METHOD:CANCEL$/m);
  assert.match(deliveries[0].icalEvent.content, /^RECURRENCE-ID:20260908T160000Z$/m);
  assert.match(deliveries[0].icalEvent.content, /^DTSTART:20260908T180000Z$/m);
  assert.match(deliveries[0].icalEvent.content, /^SEQUENCE:8$/m);
  assert.deepEqual(deliveries[0].to, ['instance-attendee@example.net']);
  assert.equal(deliveries[0].subject, 'Canceled: Moved owned series occurrence');
  assert.match(deliveries[0].text, /Starts: 2026-09-08T18:00:00\.000Z/);

  const parsed = parseIcalEvent(uid, events.get(uid));
  assert.equal(expandRecurringEvent(
    parsed,
    new Date('2026-09-01T00:00:00Z'),
    new Date('2026-09-30T23:59:59Z'),
  ).some(event => event.occurrenceId === '20260908T160000Z'), false);
  const activeSyncExceptions = calendarEventToActiveSyncApplicationData(parsed)
    .find(node => node.tag === 'Exceptions')?.children || [];
  const canceledOccurrence = activeSyncExceptions.find(node => (
    node.children?.some(child => child.tag === 'ExceptionStartTime' && child.content === '20260908T160000Z')
  ));
  assert.equal(canceledOccurrence?.children?.find(child => child.tag === 'Deleted')?.content, '1');

  const replay = await post(port, `/events/${calendarId}/${uid}/cancel`, {
    scope: 'occurrence', occurrenceId: '20260908T160000Z',
  }, 'route-cancel-0001');
  assert.equal(replay.status, 200);
  assert.equal(replay.body.replayed, true);

  const duplicate = await post(port, `/events/${calendarId}/${uid}/cancel`, {
    scope: 'occurrence', occurrenceId: '20260908T160000Z',
  }, 'route-cancel-0002');
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.body.code, 'ALREADY_CANCELLED');
  assert.equal(reservations.size, 1, 'a rejected duplicate cancellation must roll back its outbox row');
});

test('occurrence cancellation retry accepts an equivalent UTC EXDATE representation', async t => {
  reset();
  const uid = 'semantic-exdate-retry';
  const firstKey = 'route-semantic-exdate-0001';
  const source = organizedSeries(uid)
    .replace('DTSTART:20260901T160000Z', 'DTSTART;TZID=America/New_York:20260901T090000')
    .replace('DTEND:20260901T170000Z', 'DTEND;TZID=America/New_York:20260901T100000');
  events.set(uid, source);
  revisions.set(uid, 1);
  const port = await withServer(t);

  const first = await post(port, `/events/${calendarId}/${uid}/cancel`, {
    scope: 'occurrence', occurrenceId: '20260908T130000Z',
  }, firstKey);
  assert.equal(first.status, 200);
  reservations.get(firstKey).status = 'failed';
  events.set(uid, events.get(uid).replace(
    'EXDATE;TZID=America/New_York:20260908T090000',
    'EXDATE:20260908T130000Z',
  ));

  const retry = await post(port, '/calendar-invitations/retry', {
    retryOf: firstKey,
  }, 'route-semantic-exdate-0002');
  assert.equal(retry.status, 200);
  assert.deepEqual(reservations.get('route-semantic-exdate-0002').envelope.to, ['attendee@example.net']);
});

test('occurrence cancellation retry fails closed when emitted organizer parameters change', async t => {
  reset();
  const uid = 'occurrence-organizer-superseded';
  const firstKey = 'route-occurrence-organizer-0001';
  events.set(uid, organizedSeriesWithMovedOccurrence(uid));
  revisions.set(uid, 1);
  const port = await withServer(t);

  const first = await post(port, `/events/${calendarId}/${uid}/cancel`, {
    scope: 'occurrence', occurrenceId: '20260908T160000Z',
  }, firstKey);
  assert.equal(first.status, 200);
  reservations.get(firstKey).status = 'failed';
  events.set(uid, events.get(uid).replace(
    'SUMMARY:Moved owned series occurrence\r\nORGANIZER:mailto:guest@example.test',
    'SUMMARY:Moved owned series occurrence\r\nORGANIZER;SENT-BY="mailto:delegate@example.test":mailto:guest@example.test',
  ));
  revisions.set(uid, 3);

  const retry = await post(port, '/calendar-invitations/retry', {
    retryOf: firstKey,
  }, 'route-occurrence-organizer-0002');
  assert.equal(retry.status, 409);
  assert.equal(retry.body.code, 'INVITATION_ACTION_SUPERSEDED');
  assert.equal(reservations.size, 1);
});

test('a failed moved-occurrence cancellation remains retryable after later series cancellation', async t => {
  reset();
  const uid = 'occurrence-before-series';
  const occurrenceKey = 'route-occurrence-before-series-0001';
  events.set(uid, organizedSeriesWithMovedOccurrence(uid));
  revisions.set(uid, 1);
  const port = await withServer(t);

  const occurrenceCancel = await post(port, `/events/${calendarId}/${uid}/cancel`, {
    scope: 'occurrence', occurrenceId: '20260908T160000Z',
  }, occurrenceKey);
  assert.equal(occurrenceCancel.status, 200);
  const frozenRaw = Buffer.from(reservations.get(occurrenceKey).raw);
  reservations.get(occurrenceKey).status = 'failed';

  const seriesCancel = await post(port, `/events/${calendarId}/${uid}/cancel`, {
    scope: 'series',
  }, 'route-occurrence-before-series-0002');
  assert.equal(seriesCancel.status, 200);

  const retry = await post(port, '/calendar-invitations/retry', {
    retryOf: occurrenceKey,
  }, 'route-occurrence-before-series-0003');
  assert.equal(retry.status, 200);
  assert.deepEqual(
    reservations.get('route-occurrence-before-series-0003').envelope.to,
    ['instance-attendee@example.net'],
  );
  assert.equal(
    Buffer.compare(reservations.get('route-occurrence-before-series-0003').raw, frozenRaw),
    0,
  );
});

test('organizer series cancellation is replayable by key but rejects a second semantic request', async t => {
  reset();
  const uid = 'organized-series';
  events.set(uid, organizedSeries(uid));
  revisions.set(uid, 1);
  const port = await withServer(t);

  const first = await post(port, `/events/${calendarId}/${uid}/cancel`, {
    scope: 'series',
  }, 'route-series-cancel-0001');
  assert.equal(first.status, 200);
  assert.equal(first.body.replayed, false);
  assert.match(events.get(uid), /^STATUS:CANCELLED$/m);
  assert.match(events.get(uid), /^SEQUENCE:3$/m);

  const replay = await post(port, `/events/${calendarId}/${uid}/cancel`, {
    scope: 'series',
  }, 'route-series-cancel-0001');
  assert.equal(replay.status, 200);
  assert.equal(replay.body.replayed, true);

  const duplicate = await post(port, `/events/${calendarId}/${uid}/cancel`, {
    scope: 'series',
  }, 'route-series-cancel-0002');
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.body.code, 'ALREADY_CANCELLED');
  assert.equal(reservations.size, 1);
});

test('a partially delivered cancellation retries only rejected attendees', async t => {
  reset();
  const uid = 'partial-series-cancel';
  const source = organizedSeries(uid).replace(
    'ATTENDEE;PARTSTAT=NEEDS-ACTION:mailto:attendee@example.net',
    [
      'ATTENDEE;PARTSTAT=NEEDS-ACTION:mailto:attendee@example.net',
      'ATTENDEE;PARTSTAT=NEEDS-ACTION:mailto:second@example.net',
    ].join('\r\n'),
  );
  events.set(uid, source);
  revisions.set(uid, 1);
  const port = await withServer(t);
  const firstKey = 'route-partial-cancel-0001';

  const first = await post(port, `/events/${calendarId}/${uid}/cancel`, { scope: 'series' }, firstKey);
  assert.equal(first.status, 200);
  reservations.get(firstKey).status = 'partial_delivery';
  reservations.get(firstKey).rejectedRecipients = ['second@example.net'];

  const retry = await post(port, `/events/${calendarId}/${uid}/cancel`, {
    scope: 'series', retryOf: firstKey,
  }, 'route-partial-cancel-0002');
  assert.equal(retry.status, 200);
  assert.deepEqual(reservations.get('route-partial-cancel-0002').envelope.to, ['second@example.net']);
  assert.equal(reservations.get('route-partial-cancel-0002').saveSentCopy, false);
  assert.equal(reservations.size, 2);
});

test('a failed successor of a partial retry never creates a duplicate Sent copy', async t => {
  reset();
  const uid = 'partial-retry-chain';
  const source = organizedSeries(uid).replace(
    'ATTENDEE;PARTSTAT=NEEDS-ACTION:mailto:attendee@example.net',
    [
      'ATTENDEE;PARTSTAT=NEEDS-ACTION:mailto:attendee@example.net',
      'ATTENDEE;PARTSTAT=NEEDS-ACTION:mailto:second@example.net',
    ].join('\r\n'),
  );
  events.set(uid, source);
  revisions.set(uid, 1);
  const port = await withServer(t);
  const firstKey = 'route-partial-chain-0001';
  const secondKey = 'route-partial-chain-0002';

  await post(port, `/events/${calendarId}/${uid}/cancel`, { scope: 'series' }, firstKey);
  reservations.get(firstKey).status = 'partial_delivery';
  reservations.get(firstKey).rejectedRecipients = ['second@example.net'];
  await post(port, `/events/${calendarId}/${uid}/cancel`, {
    scope: 'series', retryOf: firstKey,
  }, secondKey);
  assert.equal(reservations.get(secondKey).saveSentCopy, false);
  reservations.get(secondKey).status = 'failed';

  const finalRetry = await post(port, `/events/${calendarId}/${uid}/cancel`, {
    scope: 'series', retryOf: secondKey,
  }, 'route-partial-chain-0003');
  assert.equal(finalRetry.status, 200);
  assert.equal(reservations.get('route-partial-chain-0003').saveSentCopy, false);
  assert.deepEqual(reservations.get('route-partial-chain-0003').envelope.to, ['second@example.net']);
});

test('organizer occurrence cancellation rejects a syntactically valid non-member', async t => {
  reset();
  const uid = 'organized-series';
  events.set(uid, organizedSeries(uid));
  revisions.set(uid, 1);
  const port = await withServer(t);

  const result = await post(port, `/events/${calendarId}/${uid}/cancel`, {
    scope: 'occurrence', occurrenceId: '20261020T160000Z',
  }, 'route-non-member-cancel-0001');

  assert.equal(result.status, 409);
  assert.equal(result.body.code, 'INVALID_OCCURRENCE');
  assert.equal(reservations.size, 0);
  assert.equal(events.get(uid), organizedSeries(uid));
});

test('occurrence cancellation matches equivalent VALUE and quoted TZID parameters', async t => {
  reset();
  const uid = 'semantic-zone-series';
  const source = organizedSeries(uid)
    .replace('DTSTART:20260901T160000Z', 'DTSTART;TZID=America/New_York;VALUE=DATE-TIME:20260901T090000')
    .replace('DTEND:20260901T170000Z', 'DTEND;TZID=America/New_York:20260901T100000')
    .replace('END:VCALENDAR', [
      'BEGIN:VEVENT', `UID:${uid}`, 'DTSTAMP:20260821T120000Z',
      'RECURRENCE-ID;TZID="America/New_York":20260908T090000',
      'DTSTART;TZID=America/New_York:20260908T110000',
      'DTEND;TZID=America/New_York:20260908T120000',
      'SUMMARY:Semantic moved occurrence',
      'ORGANIZER:mailto:guest@example.test',
      'ATTENDEE:mailto:instance-attendee@example.net',
      'END:VEVENT', 'END:VCALENDAR',
    ].join('\r\n'));
  events.set(uid, source);
  revisions.set(uid, 1);
  const port = await withServer(t);

  const result = await post(port, `/events/${calendarId}/${uid}/cancel`, {
    scope: 'occurrence', occurrenceId: '20260908T130000Z',
  }, 'route-semantic-zone-0001');
  assert.equal(result.status, 200);
  assert.deepEqual(deliveries[0].to, ['instance-attendee@example.net']);
  assert.match(deliveries[0].icalEvent.content, /SUMMARY:Semantic moved occurrence/);
  assert.match(events.get(uid), /RECURRENCE-ID;TZID="America\/New_York":20260908T090000[\s\S]*STATUS:CANCELLED/);
});

test('occurrence cancellation resolves an equivalent-instant exception expressed in another TZID', async t => {
  reset();
  const uid = 'cross-zone-exception';
  const source = organizedSeries(uid)
    .replace('DTSTART:20260901T160000Z', 'DTSTART;TZID=America/New_York:20260901T090000')
    .replace('DTEND:20260901T170000Z', 'DTEND;TZID=America/New_York:20260901T100000')
    .replace('END:VCALENDAR', [
      'BEGIN:VEVENT', `UID:${uid}`, 'DTSTAMP:20260821T120000Z',
      'RECURRENCE-ID;TZID=America/Chicago:20260908T080000',
      'DTSTART;TZID=America/Chicago:20260908T100000',
      'DTEND;TZID=America/Chicago:20260908T110000',
      'SUMMARY:Cross-zone moved occurrence',
      'ORGANIZER:mailto:guest@example.test',
      'ATTENDEE:mailto:cross-zone-attendee@example.net',
      'END:VEVENT', 'END:VCALENDAR',
    ].join('\r\n'));
  events.set(uid, source);
  revisions.set(uid, 1);
  const port = await withServer(t);

  const result = await post(port, `/events/${calendarId}/${uid}/cancel`, {
    scope: 'occurrence', occurrenceId: '20260908T130000Z',
  }, 'route-cross-zone-0001');
  assert.equal(result.status, 200);
  assert.deepEqual(deliveries[0].to, ['cross-zone-attendee@example.net']);
  assert.match(deliveries[0].icalEvent.content, /SUMMARY:Cross-zone moved occurrence/);
  assert.match(events.get(uid), /RECURRENCE-ID;TZID=America\/Chicago:20260908T080000[\s\S]*STATUS:CANCELLED/);
});

test('occurrence cancellation does not co-match case-distinct TZIDs', async t => {
  reset();
  const uid = 'case-distinct-zone-exception';
  const source = organizedSeries(uid)
    .replace('DTSTART:20260901T160000Z', 'DTSTART;TZID=Example/Zone:20260901T090000')
    .replace('DTEND:20260901T170000Z', 'DTEND;TZID=Example/Zone:20260901T100000')
    .replace('END:VCALENDAR', [
      'BEGIN:VEVENT', `UID:${uid}`, 'DTSTAMP:20260821T120000Z',
      'RECURRENCE-ID;TZID=example/zone:20260908T090000',
      'DTSTART;TZID=example/zone:20260908T110000',
      'DTEND;TZID=example/zone:20260908T120000',
      'SUMMARY:Case-distinct occurrence',
      'ORGANIZER:mailto:guest@example.test',
      'ATTENDEE:mailto:wrong-attendee@example.net',
      'END:VEVENT', 'END:VCALENDAR',
    ].join('\r\n'));
  events.set(uid, source);
  revisions.set(uid, 1);
  const port = await withServer(t);

  const result = await post(port, `/events/${calendarId}/${uid}/cancel`, {
    scope: 'occurrence', occurrenceId: '20260908T090000Z',
  }, 'route-case-zone-0001');
  assert.equal(result.status, 409);
  assert.equal(result.body.code, 'INVALID_OCCURRENCE');
  assert.equal(deliveries.length, 0);
  assert.equal(events.get(uid), source);
});

test('materialized exceptions cannot extend a supported recurrence off cadence or beyond COUNT', async t => {
  reset();
  const cases = [
    ['off-cadence-exception', '20260902T160000Z', '20260902T180000Z'],
    ['out-of-count-exception', '20260922T160000Z', '20260922T180000Z'],
    ['cancelled-off-cadence-exception', '20260903T160000Z', '20260903T180000Z', 'STATUS:CANCELLED'],
  ];
  const originals = new Map();
  for (const [uid, recurrenceId, movedStart, status] of cases) {
    const movedEnd = movedStart.replace('180000Z', '190000Z');
    const source = organizedSeries(uid).replace('END:VCALENDAR', [
      'BEGIN:VEVENT', `UID:${uid}`, 'DTSTAMP:20260821T120000Z',
      `RECURRENCE-ID:${recurrenceId}`, `DTSTART:${movedStart}`, `DTEND:${movedEnd}`,
      'SUMMARY:Orphan materialized exception',
      'ORGANIZER:mailto:guest@example.test',
      'ATTENDEE:mailto:orphan-roster@example.net',
      ...(status ? [status] : []),
      'END:VEVENT', 'END:VCALENDAR',
    ].join('\r\n'));
    events.set(uid, source);
    revisions.set(uid, 1);
    originals.set(uid, source);
  }
  const port = await withServer(t);

  for (const [index, [uid, occurrenceId]] of cases.entries()) {
    const result = await post(port, `/events/${calendarId}/${uid}/cancel`, {
      scope: 'occurrence', occurrenceId,
    }, `route-orphan-exception-000${index + 1}`);
    assert.equal(result.status, 409);
    assert.equal(result.body.code, 'INVALID_OCCURRENCE');
    assert.equal(events.get(uid), originals.get(uid));
  }
  assert.equal(deliveries.length, 0);
  assert.equal(reservations.size, 0);
});

test('zoned occurrence membership accepts the RFC overlap instant and rejects its duplicate wall instant', async t => {
  reset();
  const uid = 'overlap-series';
  const source = organizedSeries(uid)
    .replace('DTSTART:20260901T160000Z', 'DTSTART;TZID=America/New_York:20261025T013000')
    .replace('DTEND:20260901T170000Z', 'DTEND;TZID=America/New_York:20261025T023000');
  events.set(uid, source);
  revisions.set(uid, 1);
  const port = await withServer(t);

  const falseTwin = await post(port, `/events/${calendarId}/${uid}/cancel`, {
    scope: 'occurrence', occurrenceId: '20261101T063000Z',
  }, 'route-overlap-false-0001');
  assert.equal(falseTwin.status, 409);
  assert.equal(falseTwin.body.code, 'INVALID_OCCURRENCE');

  const real = await post(port, `/events/${calendarId}/${uid}/cancel`, {
    scope: 'occurrence', occurrenceId: '20261101T053000Z',
  }, 'route-overlap-real-0001');
  assert.equal(real.status, 200);
  assert.match(deliveries[0].icalEvent.content, /^DURATION:PT3600S$/m);
});

test('zoned weekly membership keeps the nominal wall clock through a spring gap', async t => {
  reset();
  const uid = 'spring-gap-series';
  const source = organizedSeries(uid)
    .replace('DTSTART:20260901T160000Z', 'DTSTART;TZID=America/New_York:20260301T023000')
    .replace('DTEND:20260901T170000Z', 'DTEND;TZID=America/New_York:20260301T033000');
  events.set(uid, source);
  revisions.set(uid, 1);
  const port = await withServer(t);

  const gap = await post(port, `/events/${calendarId}/${uid}/cancel`, {
    scope: 'occurrence', occurrenceId: '20260308T073000Z',
  }, 'route-gap-day-0001');
  assert.equal(gap.status, 200);
  assert.match(events.get(uid), /^EXDATE;TZID=America\/New_York:20260308T023000$/m);
  assert.match(deliveries[0].icalEvent.content, /^RECURRENCE-ID;TZID=America\/New_York:20260308T023000$/m);

  reset();
  events.set(uid, source);
  revisions.set(uid, 1);
  const nextWeek = await post(port, `/events/${calendarId}/${uid}/cancel`, {
    scope: 'occurrence', occurrenceId: '20260315T063000Z',
  }, 'route-gap-next-week-0001');
  assert.equal(nextWeek.status, 200);
});

test('all-day occurrence cancellation accepts a plain calendar date identity', async t => {
  reset();
  const uid = 'all-day-series';
  const source = organizedSeries(uid)
    .replace('DTSTART:20260901T160000Z', 'DTSTART;VALUE=DATE:20260901')
    .replace('DTEND:20260901T170000Z', 'DTEND;VALUE=DATE:20260902')
    .replace('RRULE:FREQ=WEEKLY;COUNT=3', 'RRULE:FREQ=DAILY;COUNT=3');
  events.set(uid, source);
  revisions.set(uid, 1);
  const port = await withServer(t);

  const result = await post(port, `/events/${calendarId}/${uid}/cancel`, {
    scope: 'occurrence', occurrenceId: '20260902',
  }, 'route-all-day-cancel-0001');
  assert.equal(result.status, 200);
  assert.match(events.get(uid), /^EXDATE;VALUE=DATE:20260902$/m);
  assert.match(deliveries[0].icalEvent.content, /^RECURRENCE-ID;VALUE=DATE:20260902$/m);
});

test('occurrence cancellation fails closed for monthly and yearly membership', async t => {
  reset();
  const monthlyUid = 'organized-monthly';
  const monthly = organizedSeries(monthlyUid)
    .replace('DTSTART:20260901T160000Z', 'DTSTART:20260131T160000Z')
    .replace('DTEND:20260901T170000Z', 'DTEND:20260131T170000Z')
    .replace('RRULE:FREQ=WEEKLY;COUNT=3', 'RRULE:FREQ=MONTHLY;COUNT=4');
  events.set(monthlyUid, monthly);
  revisions.set(monthlyUid, 1);
  const port = await withServer(t);

  const monthlyResult = await post(port, `/events/${calendarId}/${monthlyUid}/cancel`, {
    scope: 'occurrence', occurrenceId: '20260331T160000Z',
  }, 'route-monthly-cancel-0001');
  assert.equal(monthlyResult.status, 409);
  assert.equal(monthlyResult.body.code, 'UNSUPPORTED_RECURRENCE_RULE');
  assert.equal(events.get(monthlyUid), monthly);
  assert.equal(reservations.size, 0);
});

test('unsupported monthly membership is rejected before accepting a materialized exception', async t => {
  reset();
  const uid = 'materialized-monthly';
  const source = organizedSeries(uid)
    .replace('DTSTART:20260901T160000Z', 'DTSTART;TZID=America/New_York:20260131T023000')
    .replace('DTEND:20260901T170000Z', 'DTEND;TZID=America/New_York:20260131T033000')
    .replace('RRULE:FREQ=WEEKLY;COUNT=3', 'RRULE:FREQ=MONTHLY;COUNT=4')
    .replace('END:VCALENDAR', [
      'BEGIN:VEVENT', `UID:${uid}`, 'DTSTAMP:20260821T120000Z',
      'RECURRENCE-ID;TZID=America/New_York:20260308T023000',
      'DTSTART;TZID=America/New_York:20260308T043000',
      'DTEND;TZID=America/New_York:20260308T053000',
      'ORGANIZER:mailto:guest@example.test',
      'ATTENDEE:mailto:wrong-monthly-attendee@example.net',
      'END:VEVENT', 'END:VCALENDAR',
    ].join('\r\n'));
  events.set(uid, source);
  revisions.set(uid, 1);
  const port = await withServer(t);

  const result = await post(port, `/events/${calendarId}/${uid}/cancel`, {
    scope: 'occurrence', occurrenceId: '20260308T073000Z',
  }, 'route-materialized-monthly-0001');
  assert.equal(result.status, 409);
  assert.equal(result.body.code, 'UNSUPPORTED_RECURRENCE_RULE');
  assert.equal(deliveries.length, 0);
});

test('occurrence cancellation rejects malformed supported-rule values', async t => {
  reset();
  const fractionalUid = 'fractional-interval';
  const malformedUntilUid = 'malformed-until';
  const impossibleUntilUid = 'impossible-until';
  const fractional = organizedSeries(fractionalUid)
    .replace('RRULE:FREQ=WEEKLY;COUNT=3', 'RRULE:FREQ=DAILY;INTERVAL=1.5;COUNT=3');
  const malformedUntil = organizedSeries(malformedUntilUid)
    .replace('RRULE:FREQ=WEEKLY;COUNT=3', 'RRULE:FREQ=DAILY;UNTIL=not-a-date');
  const impossibleUntil = organizedSeries(impossibleUntilUid)
    .replace('RRULE:FREQ=WEEKLY;COUNT=3', 'RRULE:FREQ=DAILY;UNTIL=20260231T160000Z');
  events.set(fractionalUid, fractional);
  revisions.set(fractionalUid, 1);
  events.set(malformedUntilUid, malformedUntil);
  revisions.set(malformedUntilUid, 1);
  events.set(impossibleUntilUid, impossibleUntil);
  revisions.set(impossibleUntilUid, 1);
  const port = await withServer(t);

  for (const [uid, key] of [
    [fractionalUid, 'route-fractional-rule-0001'],
    [malformedUntilUid, 'route-malformed-until-0001'],
    [impossibleUntilUid, 'route-impossible-until-0001'],
  ]) {
    const result = await post(port, `/events/${calendarId}/${uid}/cancel`, {
      scope: 'occurrence', occurrenceId: '20260902T160000Z',
    }, key);
    assert.equal(result.status, 409);
    assert.equal(result.body.code, 'UNSUPPORTED_RECURRENCE_RULE');
  }
  assert.equal(deliveries.length, 0);
});

test('occurrence cancellation fails closed for recurrence selectors not implemented by membership validation', async t => {
  reset();
  const uid = 'organized-weekdays';
  const source = organizedSeries(uid)
    .replace('RRULE:FREQ=WEEKLY;COUNT=3', 'RRULE:FREQ=DAILY;COUNT=10;BYDAY=MO,TU,WE,TH,FR');
  events.set(uid, source);
  revisions.set(uid, 1);
  const port = await withServer(t);

  const result = await post(port, `/events/${calendarId}/${uid}/cancel`, {
    scope: 'occurrence', occurrenceId: '20260905T160000Z',
  }, 'route-weekday-cancel-0001');

  assert.equal(result.status, 409);
  assert.equal(result.body.code, 'UNSUPPORTED_RECURRENCE_RULE');
  assert.equal(events.get(uid), source);
  assert.equal(reservations.size, 0);
});

test('this-and-future recurrence changes block later occurrence cancellation', async t => {
  reset();
  const uid = 'range-later-series';
  const source = organizedSeries(uid).replace('END:VCALENDAR', [
    'BEGIN:VEVENT', `UID:${uid}`, 'DTSTAMP:20260821T120000Z',
    'RECURRENCE-ID;RANGE=THISANDFUTURE:20260908T160000Z',
    'DTSTART:20260908T180000Z', 'DTEND:20260908T190000Z',
    'ORGANIZER:mailto:guest@example.test',
    'ATTENDEE:mailto:range-attendee@example.net',
    'END:VEVENT', 'END:VCALENDAR',
  ].join('\r\n'));
  events.set(uid, source);
  revisions.set(uid, 1);
  const port = await withServer(t);

  const result = await post(port, `/events/${calendarId}/${uid}/cancel`, {
    scope: 'occurrence', occurrenceId: '20260915T160000Z',
  }, 'route-range-later-0001');
  assert.equal(result.status, 409);
  assert.equal(result.body.code, 'UNSUPPORTED_RECURRENCE_RANGE');
  assert.equal(deliveries.length, 0);
  assert.equal(events.get(uid), source);
});

test('occurrence cancellation preserves a supported custom TZID while using its canonical rules', async t => {
  reset();
  const uid = 'organized-custom-zone';
  events.set(uid, organizedCustomZoneSeries(uid));
  revisions.set(uid, 1);
  const port = await withServer(t);

  const result = await post(port, `/events/${calendarId}/${uid}/cancel`, {
    scope: 'occurrence', occurrenceId: '20260908T130000Z',
  }, 'route-custom-zone-cancel-0001');

  assert.equal(result.status, 200);
  assert.match(events.get(uid), /^EXDATE;TZID=OMS-Eastern:20260908T090000$/m);
  assert.match(deliveries[0].icalEvent.content, /^RECURRENCE-ID;TZID=OMS-Eastern:20260908T090000$/m);
});

test('occurrence cancellation keeps unsupported TZID data on floating wall time', async t => {
  reset();
  const uid = 'organized-unsupported-zone';
  events.set(uid, organizedUnsupportedZoneSeries(uid));
  revisions.set(uid, 1);
  const port = await withServer(t);

  const result = await post(port, `/events/${calendarId}/${uid}/cancel`, {
    scope: 'occurrence', occurrenceId: '20260908T200000Z',
  }, 'route-unsupported-zone-cancel-0001');

  assert.equal(result.status, 200);
  assert.match(events.get(uid), /^EXDATE;TZID=Broken\/Zone:20260908T200000$/m);
  assert.match(deliveries[0].icalEvent.content, /^RECURRENCE-ID;TZID=Broken\/Zone:20260908T200000$/m);
});

test('new-time proposal queues COUNTER without moving the stored attendee event', async t => {
  reset();
  const uid = 'route-meeting';
  const source = invite(uid);
  events.set(uid, source);
  revisions.set(uid, 1);
  const port = await withServer(t);

  const result = await post(port, `/events/${calendarId}/${uid}/propose-time`, {
    start: '2026-09-01T18:00:00.000Z', end: '2026-09-01T19:00:00.000Z', comment: 'Two hours later',
  }, 'route-counter-0001');
  assert.equal(result.status, 200);
  assert.equal(events.get(uid), source);
  assert.match(deliveries[0].icalEvent.content, /^METHOD:COUNTER$/m);
  assert.match(deliveries[0].icalEvent.content, /^DTSTART:20260901T180000Z$/m);
});

test('invitation routes require writable calendar access and an idempotency key', async t => {
  reset();
  events.set('route-meeting', invite());
  revisions.set('route-meeting', 1);
  const port = await withServer(t);

  const missingKey = await post(port, `/events/${calendarId}/route-meeting/respond`, { response: 'accepted' });
  assert.equal(missingKey.status, 400);
  permissionGranted = false;
  const forbidden = await post(port, `/events/${calendarId}/route-meeting/respond`, { response: 'accepted' }, 'route-response-0002');
  assert.equal(forbidden.status, 403);
  assert.equal(reservations.size, 0);
});
