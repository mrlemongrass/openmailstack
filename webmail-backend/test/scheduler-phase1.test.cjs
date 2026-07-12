const test = require('node:test');
const assert = require('node:assert/strict');

process.env.OMS_DB_PASSWORD = process.env.OMS_DB_PASSWORD || 'test-only';

const {
    assertTimeZone,
    buildSchedulerCalendarEvent,
    createSchedulerToken,
    defaultSchedulerHandle,
    normalizeSchedulerEventInput,
    normalizeSchedulerBookingAnswers,
    normalizeSchedulerHandle,
    normalizeOneOffAvailability,
    normalizePrivateLinkExpiry,
    schedulerPublicUrl,
    schedulerTokenHash,
} = require('../src/scheduler/phase1.js');
const { schedulerHostAllowed } = require('../src/scheduler/router.js');
const { schedulerNotificationMails, schedulerTransportOptions } = require('../src/scheduler/worker.js');

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
    assert.equal(event.visibility, 'public');
    assert.deepEqual(event.windows.map((window) => window.weekday), [1, 2, 3, 4, 5]);
    assert.equal(normalizeSchedulerEventInput({ title: 'Hair Coloring', durationMinutes: 180 }).durationMinutes, 180);
    const scheduleId = '12345678-1234-1234-1234-123456789abc';
    assert.equal(normalizeSchedulerEventInput({ title: 'Consultation', durationMinutes: 60, availabilityScheduleId: scheduleId }).availabilityScheduleId, scheduleId);
    assert.equal(normalizeSchedulerEventInput({ title: 'Private consult', visibility: 'unlisted' }).visibility, 'unlisted');
    assert.equal(normalizeSchedulerEventInput({ title: 'Token consult', visibility: 'private' }).visibility, 'private');
    assert.throws(() => normalizeSchedulerEventInput({ title: 'Bad visibility', visibility: 'secret' }), /event visibility/);
    assert.throws(() => normalizeSchedulerEventInput({ title: 'Bad schedule', availabilityScheduleId: 'not-an-id' }), /availability schedule/);
    assert.throws(() => normalizeSchedulerEventInput({ title: 'Bad', durationMinutes: 0 }), /durationMinutes/);
    assert.throws(() => normalizeSchedulerEventInput({ title: 'Too Long', durationMinutes: 1441 }), /durationMinutes/);
});

test('normalizes booking questions and snapshots validated answers', () => {
    const event = normalizeSchedulerEventInput({
        title: 'Consultation',
        questions: [
            { id: 'question-goal', label: 'What is your goal?', type: 'long_text', required: true, options: [] },
            { id: 'question-plan', label: 'Choose a plan', type: 'select', required: false, options: ['Basic', 'Pro', 'Pro'] },
        ],
    });
    assert.deepEqual(event.questions[1].options, ['Basic', 'Pro']);
    assert.deepEqual(normalizeSchedulerBookingAnswers(event.questions, [
        { questionId: 'question-goal', value: 'Plan a migration' },
        { questionId: 'question-plan', value: 'Pro' },
    ]), [
        { questionId: 'question-goal', label: 'What is your goal?', type: 'long_text', value: 'Plan a migration' },
        { questionId: 'question-plan', label: 'Choose a plan', type: 'select', value: 'Pro' },
    ]);
    assert.throws(() => normalizeSchedulerBookingAnswers(event.questions, []), /What is your goal\? is required/);
    assert.throws(() => normalizeSchedulerBookingAnswers(event.questions, [
        { questionId: 'question-goal', value: 'Plan a migration' },
        { questionId: 'question-plan', value: 'Enterprise' },
    ]), /invalid selection/);
    assert.throws(() => normalizeSchedulerEventInput({
        title: 'Broken form', questions: [{ id: 'question-plan', label: 'Choose', type: 'select', options: ['Only one'] }],
    }), /2 to 20/);
});

test('private-link tokens are high entropy and expiry is bounded', () => {
    const first = createSchedulerToken();
    const second = createSchedulerToken();
    assert.equal(Buffer.from(first, 'base64url').length, 32);
    assert.notEqual(first, second);
    const now = new Date('2026-07-12T00:00:00.000Z');
    assert.equal(normalizePrivateLinkExpiry(null, now), null);
    assert.equal(normalizePrivateLinkExpiry('2026-07-13T00:00:00.000Z', now).toISOString(), '2026-07-13T00:00:00.000Z');
    assert.throws(() => normalizePrivateLinkExpiry('2026-07-11T00:00:00.000Z', now), /future/);
    assert.throws(() => normalizePrivateLinkExpiry('2027-08-01T00:00:00.000Z', now), /366 days/);
});

test('one-off availability is timezone-bound, bounded, and fits the event duration', () => {
    const now = new Date('2026-07-12T12:00:00.000Z');
    const availability = normalizeOneOffAvailability({
        timeZone: 'America/Phoenix',
        windows: [
            { date: '2026-07-13', startMinute: 660, endMinute: 750 },
            { date: '2026-07-13', startMinute: 660, endMinute: 750 },
        ],
    }, 60, now);
    assert.equal(availability.timeZone, 'America/Phoenix');
    assert.deepEqual(availability.windows, [{ date: '2026-07-13', startMinute: 660, endMinute: 750 }]);
    assert.throws(() => normalizeOneOffAvailability({
        timeZone: 'America/Phoenix', windows: [{ date: '2026-07-13', startMinute: 660, endMinute: 700 }],
    }, 60, now), /fit the event duration/);
    assert.throws(() => normalizeOneOffAvailability({
        timeZone: 'America/Phoenix', windows: [{ date: '2026-10-01', startMinute: 660, endMinute: 750 }],
    }, 60, now), /next 62 days/);
    assert.throws(() => normalizeOneOffAvailability({ timeZone: 'UTC', windows: [] }, 60, now), /between 1 and 14/);
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
        notificationFrom: 'thang@housevo.us',
        notificationName: 'Thang Vo',
        cancelToken: 'cancel-secret',
        rescheduleToken: 'reschedule-secret',
        ical: 'BEGIN:VCALENDAR',
    }, 'https://webmail.housevo.us');
    assert.equal(messages.length, 2);
    assert.match(messages[0].text, /scheduler\/action\/cancel\/cancel-secret/);
    assert.match(messages[0].text, /scheduler\/action\/reschedule\/reschedule-secret/);
    assert.equal(messages[0].ical, 'BEGIN:VCALENDAR');
    assert.deepEqual(messages[0].from, { name: 'Thang Vo', address: 'thang@housevo.us' });
    assert.equal(messages[0].replyTo, 'thang@housevo.us');
    assert.equal(schedulerTokenHash('cancel-secret').length, 64);
});

test('Scheduler SMTP verifies the certificate using the configured mail hostname', () => {
    const options = schedulerTransportOptions({
        smtpHost: '127.0.0.1', smtpPort: 25, smtpServerName: 'mail.housevo.us', smtpRejectUnauthorized: true,
    });
    assert.equal(options.host, '127.0.0.1');
    assert.equal(options.tls.servername, 'mail.housevo.us');
    assert.equal(options.tls.rejectUnauthorized, true);
});
