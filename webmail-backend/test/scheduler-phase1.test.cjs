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
    normalizeSchedulerAttendees,
    normalizeSchedulerActionReason,
    normalizeSchedulerGuestRules,
    assertSchedulerGuestEligible,
    normalizeSchedulerHandle,
    normalizeOneOffAvailability,
    normalizePrivateLinkExpiry,
    schedulerPublicUrl,
    schedulerBookingActionPolicy,
    schedulerTokenHash,
} = require('../src/scheduler/phase1.js');
const { schedulerHostAllowed } = require('../src/scheduler/router.js');
const { schedulerNotificationMails, schedulerTransportOptions } = require('../src/scheduler/worker.js');
const {
    exclusionDateKeys,
    normalizeImportSource,
    normalizeRecurrenceCount,
    normalizeSchedulerAttribution,
    normalizeSchedulerExclusions,
    normalizeSchedulerPublicSettings,
} = require('../src/scheduler/phase2.js');

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
    assert.equal(event.requiresConfirmation, false);
    assert.equal(event.cancellationCutoffMinutes, null);
    assert.equal(event.rescheduleCutoffMinutes, null);
    assert.equal(event.requireCancellationReason, false);
    assert.equal(event.requireRescheduleReason, false);
    assert.equal(event.activeBookingLimit, null);
    assert.deepEqual(event.guestAllowList, []);
    assert.deepEqual(event.guestDenyList, []);
    assert.equal(event.requireEmailVerification, false);
    assert.equal(event.maxAdditionalGuests, 0);
    assert.deepEqual(event.windows.map((window) => window.weekday), [1, 2, 3, 4, 5]);
    assert.equal(normalizeSchedulerEventInput({ title: 'Hair Coloring', durationMinutes: 180 }).durationMinutes, 180);
    const scheduleId = '12345678-1234-1234-1234-123456789abc';
    assert.equal(normalizeSchedulerEventInput({ title: 'Consultation', durationMinutes: 60, availabilityScheduleId: scheduleId }).availabilityScheduleId, scheduleId);
    assert.equal(normalizeSchedulerEventInput({ title: 'Private consult', visibility: 'unlisted' }).visibility, 'unlisted');
    assert.equal(normalizeSchedulerEventInput({ title: 'Token consult', visibility: 'private' }).visibility, 'private');
    assert.equal(normalizeSchedulerEventInput({ title: 'Approval consult', requiresConfirmation: true }).requiresConfirmation, true);
    const policyEvent = normalizeSchedulerEventInput({
        title: 'Policy consult', cancellationCutoffMinutes: 60, rescheduleCutoffMinutes: 120,
        requireCancellationReason: true, requireRescheduleReason: true,
    });
    assert.equal(policyEvent.cancellationCutoffMinutes, 60);
    assert.equal(policyEvent.rescheduleCutoffMinutes, 120);
    assert.equal(policyEvent.requireCancellationReason, true);
    assert.equal(policyEvent.requireRescheduleReason, true);
    assert.throws(() => normalizeSchedulerEventInput({ title: 'Bad visibility', visibility: 'secret' }), /event visibility/);
    assert.throws(() => normalizeSchedulerEventInput({ title: 'Bad schedule', availabilityScheduleId: 'not-an-id' }), /availability schedule/);
    assert.throws(() => normalizeSchedulerEventInput({ title: 'Bad', durationMinutes: 0 }), /durationMinutes/);
    assert.throws(() => normalizeSchedulerEventInput({ title: 'Too Long', durationMinutes: 1441 }), /durationMinutes/);
    assert.throws(() => normalizeSchedulerEventInput({ title: 'Bad cutoff', cancellationCutoffMinutes: -1 }), /cancellationCutoffMinutes/);
    assert.throws(() => normalizeSchedulerEventInput({ title: 'Bad cutoff', rescheduleCutoffMinutes: 525601 }), /rescheduleCutoffMinutes/);
});

test('normalizes booking-integrity policies and guest eligibility', () => {
    const event = normalizeSchedulerEventInput({
        title: 'Controlled booking', capacity: 3, activeBookingLimit: 2,
        guestAllowList: [' VIP@Example.net ', '@partners.example', 'vip@example.net'],
        guestDenyList: ['blocked@example.net', '@risky.example'],
        requireEmailVerification: true, maxAdditionalGuests: 2,
    });
    assert.equal(event.activeBookingLimit, 2);
    assert.deepEqual(event.guestAllowList, ['vip@example.net', '@partners.example']);
    assert.deepEqual(event.guestDenyList, ['blocked@example.net', '@risky.example']);
    assert.equal(event.requireEmailVerification, true);
    assert.equal(event.maxAdditionalGuests, 2);
    assert.deepEqual(normalizeSchedulerGuestRules(['@EXAMPLE.NET', '@example.net']), ['@example.net']);
    assert.doesNotThrow(() => assertSchedulerGuestEligible('person@partners.example', event.guestAllowList, event.guestDenyList));
    assert.throws(() => assertSchedulerGuestEligible('blocked@example.net', event.guestAllowList, event.guestDenyList), /not eligible/);
    assert.throws(() => assertSchedulerGuestEligible('person@outside.example', event.guestAllowList, event.guestDenyList), /not eligible/);
    assert.deepEqual(normalizeSchedulerAttendees([
        { name: ' Grace ', email: 'GRACE@PARTNERS.EXAMPLE' },
        { name: '', email: 'linus@partners.example' },
    ], 'owner@example.net', 2), [
        { name: 'Grace', email: 'grace@partners.example' },
        { name: '', email: 'linus@partners.example' },
    ]);
    assert.throws(() => normalizeSchedulerAttendees([{ email: 'owner@example.net' }], 'owner@example.net', 2), /different from the booker/);
    assert.throws(() => normalizeSchedulerAttendees([{ email: 'a@example.net' }, { email: 'A@example.net' }], 'owner@example.net', 2), /unique/);
    assert.throws(() => normalizeSchedulerEventInput({ title: 'Bad limit', activeBookingLimit: 0 }), /activeBookingLimit/);
    assert.throws(() => normalizeSchedulerEventInput({ title: 'Too many guests', maxAdditionalGuests: 21 }), /maxAdditionalGuests/);
});

test('booking action policies enforce immutable cutoffs and bounded reasons', () => {
    const start = new Date('2026-07-20T16:00:00.000Z');
    const event = {
        cancellationCutoffMinutes: 60,
        rescheduleCutoffMinutes: null,
        requireCancellationReason: true,
        requireRescheduleReason: false,
    };
    const beforeDeadline = schedulerBookingActionPolicy(event, 'cancel', start, new Date('2026-07-20T14:59:59.999Z'));
    assert.equal(beforeDeadline.allowed, true);
    assert.equal(beforeDeadline.reasonRequired, true);
    assert.equal(beforeDeadline.closesAt.toISOString(), '2026-07-20T15:00:00.000Z');
    assert.equal(schedulerBookingActionPolicy(event, 'cancel', start, new Date('2026-07-20T15:00:00.001Z')).allowed, false);
    assert.equal(schedulerBookingActionPolicy(event, 'reschedule', start, new Date('2027-01-01T00:00:00.000Z')).allowed, true);
    assert.equal(normalizeSchedulerActionReason('  Plans changed  ', 'cancel', true), 'Plans changed');
    assert.throws(() => normalizeSchedulerActionReason('', 'cancel', true), /cancellation reason is required/);
    assert.throws(() => normalizeSchedulerActionReason({ text: 'not a string' }, 'cancel', false), /reason must be text/);
    assert.throws(() => normalizeSchedulerActionReason('x'.repeat(1001), 'reschedule', false), /1000 characters/);
});

test('normalizes Phase 2 exclusions, public settings, attribution, recurrence, and import sources', () => {
    const exclusions = normalizeSchedulerExclusions([
        { kind: 'holiday', startDate: '2026-12-24', endDate: '2026-12-25', label: 'Winter holiday' },
        { kind: 'out_of_office', startDate: '2027-01-02', endDate: '2027-01-03', label: 'Away' },
    ]);
    assert.equal(exclusions.length, 2);
    assert.deepEqual([...exclusionDateKeys(exclusions, new Date('2026-12-24T00:00:00Z'), new Date('2026-12-26T00:00:00Z'))], ['2026-12-24', '2026-12-25']);
    assert.deepEqual(
        [...exclusionDateKeys(exclusions, new Date('2026-12-24T18:00:00Z'), new Date('2026-12-25T18:00:00Z'))],
        ['2026-12-24', '2026-12-25'],
        'UTC range edges must not omit host-local exclusion dates'
    );
    assert.throws(() => normalizeSchedulerExclusions([{ kind: 'holiday', startDate: '2026-12-25', endDate: '2026-12-24' }]), /dates are invalid/);
    const settings = normalizeSchedulerPublicSettings({
        publicAccentColor: '#AABBCC', publicIntro: '  Welcome  ', privacyUrl: 'https://example.test/privacy',
        termsUrl: '', locale: 'fr', lockedTimeZone: 'Europe/Paris',
    });
    assert.equal(settings.publicAccentColor, '#aabbcc');
    assert.equal(settings.locale, 'fr');
    assert.equal(settings.lockedTimeZone, 'Europe/Paris');
    assert.throws(() => normalizeSchedulerPublicSettings({ privacyUrl: 'javascript:alert(1)' }), /HTTPS/);
    assert.deepEqual(normalizeSchedulerAttribution({ utm_source: ' newsletter ', arbitrary: 'drop', utm_campaign: 'x'.repeat(300) }), {
        utm_source: 'newsletter', utm_campaign: 'x'.repeat(255),
    });
    assert.equal(normalizeRecurrenceCount(4, 6), 4);
    assert.throws(() => normalizeRecurrenceCount(7, 6), /between 1 and 6/);
    assert.equal(normalizeImportSource('calcom'), 'calcom');
    assert.throws(() => normalizeImportSource('unknown'), /Import source/);
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

test('request and rejection mail explain the approval lifecycle without calendar attachments', () => {
    const payload = {
        bookingId: 'booking-request-1',
        hostEmail: 'thang@housevo.us',
        bookerEmail: 'ada@example.net',
        bookerName: 'Ada',
        title: 'Approval Call',
        start: '2026-07-20T16:00:00.000Z',
        end: '2026-07-20T16:30:00.000Z',
        timeZone: 'America/Phoenix',
        notificationFrom: 'thang@housevo.us',
        notificationName: 'Thang Vo',
        cancelToken: 'cancel-request-secret',
    };
    const requested = schedulerNotificationMails('booking.requested', payload, 'https://webmail.housevo.us');
    assert.equal(requested.length, 2);
    assert.match(requested[0].subject, /Request received/);
    assert.match(requested[0].text, /waiting for approval/);
    assert.match(requested[0].text, /cancel-request-secret/);
    assert.equal(requested[0].ical, undefined);
    assert.match(requested[1].text, /scheduler-app/);
    const rejected = schedulerNotificationMails('booking.rejected', payload, 'https://webmail.housevo.us');
    assert.equal(rejected.length, 1);
    assert.match(rejected[0].subject, /declined/);
    assert.equal(rejected[0].ical, undefined);
});

test('verification codes and additional attendees receive bounded workflow mail', () => {
    const verification = schedulerNotificationMails('booking.verification', {
        hostEmail: 'thang@housevo.us', bookerEmail: 'ada@example.net', bookerName: 'Ada',
        title: 'Verified Call', notificationFrom: 'thang@housevo.us', notificationName: 'Thang Vo',
        verificationCode: 'ABC1234567',
    }, 'https://webmail.housevo.us');
    assert.equal(verification.length, 1);
    assert.equal(verification[0].to, 'ada@example.net');
    assert.match(verification[0].text, /ABC1234567/);
    assert.match(verification[0].text, /15 minutes/);

    const confirmed = schedulerNotificationMails('booking.confirmed', {
        bookingId: 'booking-guests', hostEmail: 'thang@housevo.us', bookerEmail: 'ada@example.net',
        bookerName: 'Ada', title: 'Group Call', start: '2026-07-22T16:00:00.000Z',
        end: '2026-07-22T16:30:00.000Z', timeZone: 'America/Phoenix', seats: 3,
        notificationFrom: 'thang@housevo.us', notificationName: 'Thang Vo',
        cancelToken: 'cancel-secret', rescheduleToken: 'reschedule-secret', ical: 'BEGIN:VCALENDAR',
        additionalAttendees: [{ name: 'Grace', email: 'grace@example.net' }, { name: '', email: 'linus@example.net' }],
    }, 'https://webmail.housevo.us');
    assert.equal(confirmed.length, 4);
    assert.deepEqual(confirmed.slice(2).map(message => message.to), ['grace@example.net', 'linus@example.net']);
    assert.doesNotMatch(confirmed[2].text, /cancel-secret|reschedule-secret/);
    assert.match(confirmed[1].text, /for 3 seats/);
});

test('Scheduler SMTP verifies the certificate using the configured mail hostname', () => {
    const options = schedulerTransportOptions({
        smtpHost: '127.0.0.1', smtpPort: 25, smtpServerName: 'mail.housevo.us', smtpRejectUnauthorized: true,
    });
    assert.equal(options.host, '127.0.0.1');
    assert.equal(options.tls.servername, 'mail.housevo.us');
    assert.equal(options.tls.rejectUnauthorized, true);
});
