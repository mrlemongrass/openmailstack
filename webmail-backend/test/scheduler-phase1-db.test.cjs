const test = require('node:test');
const assert = require('node:assert/strict');

process.env.OMS_DB_PASSWORD = process.env.OMS_DB_PASSWORD || 'test-only';

test('Phase 1 mailbox-to-booking-to-cancel lifecycle on MariaDB', { skip: process.env.OMS_SCHEDULER_PHASE1_DB_TEST !== '1' }, async () => {
    const { pool } = require('../src/db.js');
    const { SchedulerStore } = require('../src/scheduler/store.js');
    await pool.query(`CREATE TABLE IF NOT EXISTS mailbox (
        username VARCHAR(255) PRIMARY KEY, name VARCHAR(255), local_part VARCHAR(255), domain VARCHAR(255), active TINYINT(1)
    ) ENGINE=InnoDB`);
    await pool.query(`CREATE TABLE IF NOT EXISTS alias (
        address VARCHAR(255) PRIMARY KEY, goto TEXT, domain VARCHAR(255), active TINYINT(1)
    ) ENGINE=InnoDB`);
    await pool.query(`CREATE TABLE IF NOT EXISTS calendars (
        id INT AUTO_INCREMENT PRIMARY KEY, user_id VARCHAR(255), name VARCHAR(255), dav_slug VARCHAR(255),
        color VARCHAR(32), components VARCHAR(255) DEFAULT 'VEVENT,VTODO', subscribed_url TEXT NULL, sync_token INT DEFAULT 1,
        KEY idx_calendars_user_dav_slug (user_id, dav_slug)
    ) ENGINE=InnoDB`);
    await pool.query(`CREATE TABLE IF NOT EXISTS events (
        id INT AUTO_INCREMENT PRIMARY KEY, calendar_id INT, uid VARCHAR(255), ical_data LONGTEXT, sync_token INT DEFAULT 1,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_events_calendar_uid (calendar_id, uid)
    ) ENGINE=InnoDB`);
    await pool.query(`CREATE TABLE IF NOT EXISTS calendar_shares (
        id INT AUTO_INCREMENT PRIMARY KEY, calendar_id INT, shared_with_user_id VARCHAR(255), permission VARCHAR(16)
    ) ENGINE=InnoDB`);
    await pool.query(`CREATE TABLE IF NOT EXISTS calendar_tombstones (
        id INT AUTO_INCREMENT PRIMARY KEY, calendar_id INT, uid VARCHAR(255), deleted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    ) ENGINE=InnoDB`);

    const username = 'phase1@housevo.us';
    await pool.query("INSERT INTO mailbox VALUES (?, 'Phase One', 'phase1', 'housevo.us', 1)", [username]);
    const [calendarResult] = await pool.query("INSERT INTO calendars (user_id, name, dav_slug, color) VALUES (?, 'Personal', 'personal', '#3498db')", [username]);
    const calendarId = calendarResult.insertId;
    const store = new SchedulerStore(pool);
    const entitlement = await store.setEntitlement(username, 'admin@housevo.us', { enabled: true, handle: 'phase1', timeZone: 'America/Phoenix' });
    assert.equal(entitlement.enabled, true);
    assert.equal(entitlement.published, true);
    assert.equal(entitlement.notificationFrom, username);
    await pool.query("INSERT INTO alias VALUES ('appointments@second.test', ?, 'second.test', 1)", [username]);
    await pool.query("INSERT INTO alias VALUES ('@second.test', ?, 'second.test', 1)", [username]);
    const identities = await store.listNotificationIdentities(username);
    assert.deepEqual(identities.map(item => item.address), [username, 'appointments@second.test']);
    const senderProfile = await store.updateProfile(username, { notificationFrom: 'appointments@second.test' });
    assert.equal(senderProfile.notificationFrom, 'appointments@second.test');
    await assert.rejects(() => store.updateProfile(username, { notificationFrom: 'spoof@example.net' }), /mailbox or an active alias/);

    const defaultAvailability = await store.getDefaultAvailability(username);
    assert.equal(defaultAvailability.published, false);
    assert.deepEqual(defaultAvailability.windows.map(window => window.weekday), [1, 2, 3, 4, 5]);
    const publishedAvailability = await store.saveDefaultAvailability(username, {
        ...defaultAvailability,
        published: true,
        overrides: [{ date: '2026-07-14', unavailableAllDay: true, windows: [] }],
    });
    assert.equal(publishedAvailability.published, true);
    assert.equal(publishedAvailability.overrides[0].unavailableAllDay, true);
    const defaultProfile = await store.getPublicProfile('phase1');
    assert.equal(defaultProfile.events.length, 0);
    assert.equal(defaultProfile.defaultEvent.durationMinutes, 30);
    assert.equal(defaultProfile.defaultEvent.systemManaged, true);
    const defaultSlots = await store.listSlots('phase1', '_default', new Date('2026-07-13T16:00:00.000Z'), new Date('2026-07-13T18:00:00.000Z'));
    assert.equal(defaultSlots[0].start.toISOString(), '2026-07-13T16:00:00.000Z');
    const blockedSlots = await store.listSlots('phase1', '_default', new Date('2026-07-14T16:00:00.000Z'), new Date('2026-07-14T18:00:00.000Z'));
    assert.equal(blockedSlots.length, 0);

    const event = await store.saveEventType(username, {
        title: 'Phase 1 Test', slug: 'phase-1-test', durationMinutes: 30, intervalMinutes: 30,
        minimumNoticeMinutes: 0, destinationCalendarId: calendarId, conflictCalendarIds: [calendarId],
        windows: [{ weekday: 1, startMinute: 540, endMinute: 600 }],
    });
    assert.equal(event.availabilityScheduleId, defaultAvailability.id);
    assert.equal(event.visibility, 'public');
    assert.equal((await store.getPublicProfile('phase1')).defaultEvent, null);

    const unlistedEvent = await store.saveEventType(username, {
        title: 'Private Consultation', slug: 'private-consultation', visibility: 'unlisted',
        durationMinutes: 30, intervalMinutes: 30, minimumNoticeMinutes: 0,
        destinationCalendarId: calendarId, conflictCalendarIds: [calendarId],
        windows: [{ weekday: 1, startMinute: 540, endMinute: 600 }],
    });
    const publicProfile = await store.getPublicProfile('phase1');
    assert.equal(publicProfile.events.some(item => item.id === unlistedEvent.id), false);
    assert.equal((await store.getPublicEvent('phase1', unlistedEvent.slug)).event.id, unlistedEvent.id);
    const unlistedAfterLegacyUpdate = await store.saveEventType(username, {
        ...unlistedEvent,
        title: 'Private Consultation Updated',
        visibility: undefined,
    }, unlistedEvent.id);
    assert.equal(unlistedAfterLegacyUpdate.visibility, 'unlisted');

    const start = new Date('2026-07-13T16:00:00.000Z');
    const slots = await store.listSlots('phase1', event.slug, start, new Date('2026-07-13T18:00:00.000Z'));
    assert.equal(slots[0].start.toISOString(), start.toISOString());

    const booking = await store.createBooking('phase1', event.slug, {
        eventTypeId: event.id, start, bookerTimeZone: 'Asia/Baghdad', bookerName: 'Ada',
        bookerEmail: 'ada@example.net', idempotencyKey: 'phase1-lifecycle-0001',
    });
    assert.equal(booking.status, 'confirmed');

    const privateEvent = await store.saveEventType(username, { ...event, visibility: 'private' }, event.id);
    assert.equal(privateEvent.visibility, 'private');
    assert.equal(await store.getPublicEvent('phase1', event.slug), null);
    assert.equal((await store.getPublicProfile('phase1')).events.some(item => item.id === event.id), false);
    const firstPrivateLink = await store.rotatePrivateLink(username, event.id, new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString());
    assert.equal((await store.getPublicEvent('phase1', event.slug, firstPrivateLink.token)).event.id, event.id);
    assert.equal(await store.getPublicEvent('phase1', event.slug, 'incorrect-private-token-value-that-is-long-enough'), null);
    const [storedPrivateLink] = await pool.query('SELECT token_hash, token_hint FROM scheduler_private_links WHERE event_type_id=? AND revoked_at IS NULL', [event.id]);
    assert.equal(storedPrivateLink[0].token_hash.length, 64);
    assert.notEqual(storedPrivateLink[0].token_hash, firstPrivateLink.token);
    assert.equal(storedPrivateLink[0].token_hint, firstPrivateLink.token.slice(-8));
    const rotatedPrivateLink = await store.rotatePrivateLink(username, event.id, null);
    assert.equal(await store.getPublicEvent('phase1', event.slug, firstPrivateLink.token), null);
    assert.equal((await store.getPublicEvent('phase1', event.slug, rotatedPrivateLink.token)).event.id, event.id);
    const [confirmationOutbox] = await pool.query("SELECT payload FROM scheduler_outbox WHERE aggregate_id=? AND event_type='booking.confirmed'", [booking.id]);
    const confirmationPayload = JSON.parse(confirmationOutbox[0].payload);
    assert.equal(confirmationPayload.notificationFrom, 'appointments@second.test');
    assert.equal(confirmationPayload.notificationName, 'Phase One');
    const ownerBookings = await store.listBookings(username, 'upcoming');
    assert.equal(ownerBookings.find(item => item.id === booking.id).start.toISOString(), start.toISOString());
    const [projected] = await pool.query('SELECT uid FROM events WHERE calendar_id=?', [calendarId]);
    assert.equal(projected.length, 1);

    const [calendarProjection] = await pool.query('SELECT ical_data FROM events WHERE calendar_id=? AND uid=?', [calendarId, `scheduler-${booking.id}@openmailstack`]);
    await pool.query('UPDATE events SET ical_data=? WHERE calendar_id=? AND uid=?', ['malformed-calendar-data', calendarId, `scheduler-${booking.id}@openmailstack`]);
    const fullSlotRange = await store.listSlots('phase1', event.slug, new Date(start.getTime() - 1), new Date(start.getTime() + 31 * 60 * 1000));
    assert.equal(fullSlotRange.some(slot => slot.start.getTime() === start.getTime()), false, 'confirmed capacity must hide a slot even if calendar parsing fails');
    await pool.query('UPDATE events SET ical_data=? WHERE calendar_id=? AND uid=?', [calendarProjection[0].ical_data, calendarId, `scheduler-${booking.id}@openmailstack`]);

    const rescheduledStart = new Date('2026-07-13T16:30:00.000Z');
    const rescheduleSlots = await store.listSlots('phase1', event.slug, new Date(rescheduledStart.getTime() - 1), new Date(rescheduledStart.getTime() + 31 * 60 * 1000), booking.rescheduleToken);
    assert.equal(rescheduleSlots.some(slot => slot.start.getTime() === rescheduledStart.getTime()), true, 'reschedule capability must access private-event slots');
    const rescheduled = await store.rescheduleBookingByToken(booking.rescheduleToken, rescheduledStart);
    assert.equal(rescheduled.start.toISOString(), rescheduledStart.toISOString());
    const [rescheduledEvent] = await pool.query('SELECT ical_data FROM events WHERE calendar_id=?', [calendarId]);
    assert.match(rescheduledEvent[0].ical_data, /DTSTART:20260713T163000Z/);

    await pool.query("UPDATE scheduler_private_links SET expires_at='2026-07-01 00:00:00.000' WHERE event_type_id=? AND revoked_at IS NULL", [event.id]);
    assert.equal(await store.getPublicEvent('phase1', event.slug, rotatedPrivateLink.token), null);
    assert.equal((await store.getPrivateLinkState(username, event.id)).expired, true);
    const finalPrivateLink = await store.rotatePrivateLink(username, event.id, null);
    assert.equal((await store.getPublicEvent('phase1', event.slug, finalPrivateLink.token)).event.id, event.id);
    const relistedEvent = await store.saveEventType(username, { ...privateEvent, visibility: 'public' }, event.id);
    assert.equal(relistedEvent.visibility, 'public');
    assert.equal((await store.getPrivateLinkState(username, event.id)).active, false);
    assert.equal(await store.getPublicEvent('phase1', event.slug, finalPrivateLink.token).then(result => result?.event.id), event.id);
    const privateAgain = await store.saveEventType(username, { ...relistedEvent, visibility: 'private' }, event.id);
    assert.equal(privateAgain.visibility, 'private');
    assert.equal(await store.getPublicEvent('phase1', event.slug, finalPrivateLink.token), null, 'relisting must prevent an old private token from reviving later');
    const revocablePrivateLink = await store.rotatePrivateLink(username, event.id, null);
    assert.equal((await store.getPublicEvent('phase1', event.slug, revocablePrivateLink.token)).event.id, event.id);
    await store.revokePrivateLink(username, event.id);
    assert.equal(await store.getPublicEvent('phase1', event.slug, revocablePrivateLink.token), null);
    assert.equal((await store.getPrivateLinkState(username, event.id)).active, false);

    await store.cancelBookingByToken(booking.cancelToken);
    const [cancelled] = await pool.query('SELECT status FROM scheduler_bookings WHERE id=?', [booking.id]);
    assert.equal(cancelled[0].status, 'cancelled');
    const [remaining] = await pool.query('SELECT uid FROM events WHERE calendar_id=?', [calendarId]);
    assert.equal(remaining.length, 0);
    const [tombstones] = await pool.query('SELECT uid FROM calendar_tombstones WHERE calendar_id=?', [calendarId]);
    assert.equal(tombstones.length, 1);

    const singleUseLink = await store.rotatePrivateLink(username, event.id, null, true);
    assert.equal(singleUseLink.state.singleUse, true);
    assert.equal(singleUseLink.state.remainingUses, 1);
    const singleUseInputs = [
        {
            eventTypeId: event.id,
            start: new Date('2026-07-13T16:00:00.000Z'),
            bookerTimeZone: 'America/Phoenix',
            bookerName: 'Single Use One',
            bookerEmail: 'single-one@example.net',
            idempotencyKey: 'phase1-single-use-race-0001',
            privateAccessToken: singleUseLink.token,
        },
        {
            eventTypeId: event.id,
            start: new Date('2026-07-13T16:30:00.000Z'),
            bookerTimeZone: 'America/Phoenix',
            bookerName: 'Single Use Two',
            bookerEmail: 'single-two@example.net',
            idempotencyKey: 'phase1-single-use-race-0002',
            privateAccessToken: singleUseLink.token,
        },
    ];
    const singleUseAttempts = await Promise.allSettled(singleUseInputs.map(input =>
        store.createBooking('phase1', event.slug, input)
    ));
    const successfulSingleUseAttempts = singleUseAttempts
        .map((result, index) => ({ result, index }))
        .filter(item => item.result.status === 'fulfilled');
    assert.equal(successfulSingleUseAttempts.length, 1, 'two simultaneous final-use bookings must yield exactly one success');
    const winnerIndex = successfulSingleUseAttempts[0].index;
    const winner = successfulSingleUseAttempts[0].result.value;
    const replay = await store.createBooking('phase1', event.slug, singleUseInputs[winnerIndex]);
    assert.equal(replay.id, winner.id);
    assert.equal(replay.idempotentReplay, true, 'the successful request must replay after its private token is consumed');
    const [consumedLinks] = await pool.query(
        'SELECT uses_remaining, consumed_at FROM scheduler_private_links WHERE event_type_id=? AND revoked_at IS NULL',
        [event.id]
    );
    assert.equal(consumedLinks[0].uses_remaining, 0);
    assert.ok(consumedLinks[0].consumed_at);
    assert.equal((await store.getPrivateLinkState(username, event.id)).consumed, true);
    assert.equal(await store.getPublicEvent('phase1', event.slug, singleUseLink.token), null);
    const [singleUseBookings] = await pool.query(
        "SELECT COUNT(*) AS total FROM scheduler_bookings WHERE booker_email IN ('single-one@example.net', 'single-two@example.net')"
    );
    assert.equal(Number(singleUseBookings[0].total), 1);
    const [consumptionAudits] = await pool.query(
        "SELECT COUNT(*) AS total FROM scheduler_audit_events WHERE action='private_link.consume' AND target_id=?",
        [winner.id]
    );
    assert.equal(Number(consumptionAudits[0].total), 1);
    await store.cancelBookingByToken(winner.cancelToken);

    const oneOffLink = await store.rotatePrivateLink(username, event.id, null, false, {
        timeZone: 'America/Phoenix',
        windows: [{ date: '2026-07-13', startMinute: 660, endMinute: 720 }],
    });
    assert.equal(oneOffLink.state.oneOff, true);
    assert.equal(oneOffLink.state.singleUse, true, 'one-off links must always be single-use');
    assert.deepEqual(oneOffLink.state.oneOffWindows, [{ date: '2026-07-13', startMinute: 660, endMinute: 720 }]);
    await pool.query(
        `INSERT INTO events (calendar_id, uid, ical_data) VALUES (?, 'one-off-busy-test', ?)
         ON DUPLICATE KEY UPDATE ical_data=VALUES(ical_data)`,
        [calendarId, 'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:one-off-busy-test\r\nDTSTART:20260713T180000Z\r\nDTEND:20260713T183000Z\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n']
    );
    const oneOffSlotsWithConflict = await store.listSlots(
        'phase1', event.slug, new Date('2026-07-13T15:00:00.000Z'), new Date('2026-07-13T20:00:00.000Z'), oneOffLink.token
    );
    assert.deepEqual(oneOffSlotsWithConflict.map(slot => slot.start.toISOString()), ['2026-07-13T18:30:00.000Z']);
    await pool.query("DELETE FROM events WHERE calendar_id=? AND uid='one-off-busy-test'", [calendarId]);
    const oneOffSlots = await store.listSlots(
        'phase1', event.slug, new Date('2026-07-13T15:00:00.000Z'), new Date('2026-07-13T20:00:00.000Z'), oneOffLink.token
    );
    assert.deepEqual(oneOffSlots.map(slot => slot.start.toISOString()), [
        '2026-07-13T18:00:00.000Z',
        '2026-07-13T18:30:00.000Z',
    ], 'one-off windows must replace the recurring event schedule');
    await assert.rejects(() => store.createBooking('phase1', event.slug, {
        eventTypeId: event.id,
        start: new Date('2026-07-13T17:30:00.000Z'),
        bookerTimeZone: 'America/Phoenix',
        bookerName: 'Outside One Off',
        bookerEmail: 'outside-one-off@example.net',
        idempotencyKey: 'phase1-one-off-outside-0001',
        privateAccessToken: oneOffLink.token,
    }), /no longer available/);
    assert.equal((await store.getPrivateLinkState(username, event.id)).remainingUses, 1, 'failed one-off booking must preserve the use');
    const oneOffBookingInput = {
        eventTypeId: event.id,
        start: new Date('2026-07-13T18:00:00.000Z'),
        bookerTimeZone: 'America/Phoenix',
        bookerName: 'One Off Guest',
        bookerEmail: 'one-off@example.net',
        idempotencyKey: 'phase1-one-off-success-0001',
        privateAccessToken: oneOffLink.token,
    };
    const oneOffBooking = await store.createBooking('phase1', event.slug, oneOffBookingInput);
    assert.equal(oneOffBooking.status, 'confirmed');
    assert.equal((await store.getPrivateLinkState(username, event.id)).consumed, true);
    assert.equal(await store.getPublicEvent('phase1', event.slug, oneOffLink.token), null);
    const oneOffReplay = await store.createBooking('phase1', event.slug, oneOffBookingInput);
    assert.equal(oneOffReplay.id, oneOffBooking.id);
    assert.equal(oneOffReplay.idempotentReplay, true);
    const [storedOneOffLinks] = await pool.query(
        'SELECT one_off_time_zone, one_off_windows, uses_remaining FROM scheduler_private_links WHERE event_type_id=? AND revoked_at IS NULL',
        [event.id]
    );
    assert.equal(storedOneOffLinks[0].one_off_time_zone, 'America/Phoenix');
    assert.deepEqual(JSON.parse(storedOneOffLinks[0].one_off_windows), [{ date: '2026-07-13', startMinute: 660, endMinute: 720 }]);
    assert.equal(storedOneOffLinks[0].uses_remaining, 0);
    await store.cancelBookingByToken(oneOffBooking.cancelToken);

    await pool.end();
});
