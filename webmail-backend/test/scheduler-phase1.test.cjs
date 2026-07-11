const test = require('node:test');
const assert = require('node:assert/strict');

process.env.OMS_DB_PASSWORD = process.env.OMS_DB_PASSWORD || 'test-only';

const {
    assertTimeZone,
    buildSchedulerCalendarEvent,
    defaultSchedulerHandle,
    normalizeSchedulerEventInput,
    normalizeSchedulerHandle,
    schedulerPublicUrl,
    schedulerTokenHash,
} = require('../src/scheduler/phase1.js');
const { schedulerHostAllowed } = require('../src/scheduler/router.js');
const { schedulerNotificationMails } = require('../src/scheduler/worker.js');

test('normalizes local-part handles and rejects reserved routes', () => {
    assert.equal(defaultSchedulerHandle('Thang@housevo.us'), 'thang');
    assert.equal(normalizeSchedulerHandle('Sales Team'), 'sales-team');
    assert.throws(() => normalizeSchedulerHandle('admin'), /reserved/);
    assert.throws(() => normalizeSchedulerHandle('action'), /reserved/);
    assert.throws(() => defaultSchedulerHandle('thang'), /full mailbox/);
});

test('normalizes a useful 30-minute event with weekday availability', () => {
    const event = normalizeSchedulerEventInput({ title: 'Intro Call' });
    assert.equal(event.slug, 'intro-call');
    assert.equal(event.durationMinutes, 30);
    assert.equal(event.intervalMinutes, 30);
    assert.equal(event.capacity, 1);
    assert.deepEqual(event.windows.map((window) => window.weekday), [1, 2, 3, 4, 5]);
    assert.throws(() => normalizeSchedulerEventInput({ title: 'Bad', durationMinutes: 0 }), /durationMinutes/);
});

test('validates IANA timezones and builds canonical public links', () => {
    assert.equal(assertTimeZone('America/Phoenix'), 'America/Phoenix');
    assert.throws(() => assertTimeZone('Not/AZone'), RangeError);
    assert.equal(
        schedulerPublicUrl('https://webmail.housevo.us/', 'thang', 'intro-call'),
        'https://webmail.housevo.us/scheduler/thang/intro-call'
    );
});

test('host allowlist does not trust arbitrary request hosts', () => {
    const allowed = ['webmail.housevo.us', 'mail.housevo.us'];
    assert.equal(schedulerHostAllowed('webmail.housevo.us', allowed), true);
    assert.equal(schedulerHostAllowed('mail.housevo.us:443', allowed), true);
    assert.equal(schedulerHostAllowed('attacker.example', allowed), false);
});

test('calendar projection contains stable UID, attendee, and cancellation state', () => {
    const ical = buildSchedulerCalendarEvent({
        uid: 'scheduler-booking@example.com',
        title: 'Intro Call',
        description: 'Agenda',
        location: 'Zoom',
        start: new Date('2026-07-20T16:00:00.000Z'),
        end: new Date('2026-07-20T16:30:00.000Z'),
        hostEmail: 'thang@housevo.us',
        bookerName: 'Ada Lovelace',
        bookerEmail: 'ada@example.net',
        sequence: 0,
    });
    assert.match(ical, /UID:scheduler-booking@example\.com/);
    assert.match(ical, /DTSTART:20260720T160000Z/);
    assert.match(ical, /ATTENDEE;CN=Ada Lovelace:mailto:ada@example\.net/);
    assert.match(ical, /STATUS:CONFIRMED/);
});

test('confirmation mail contains secure capability links and ICS', () => {
    const messages = schedulerNotificationMails('booking.confirmed', {
        bookingId: 'booking-1',
        hostEmail: 'thang@housevo.us',
        bookerEmail: 'ada@example.net',
        bookerName: 'Ada',
        title: 'Intro Call',
        start: '2026-07-20T16:00:00.000Z',
        end: '2026-07-20T16:30:00.000Z',
        timeZone: 'America/Phoenix',
        cancelToken: 'cancel-secret',
        rescheduleToken: 'reschedule-secret',
        ical: 'BEGIN:VCALENDAR',
    }, 'https://webmail.housevo.us');
    assert.equal(messages.length, 2);
    assert.match(messages[0].text, /scheduler\/action\/cancel\/cancel-secret/);
    assert.match(messages[0].text, /scheduler\/action\/reschedule\/reschedule-secret/);
    assert.equal(messages[0].ical, 'BEGIN:VCALENDAR');
    assert.equal(schedulerTokenHash('cancel-secret').length, 64);
});
