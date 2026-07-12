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
    const rescheduled = await store.rescheduleBookingByToken(booking.rescheduleToken, rescheduledStart);
    assert.equal(rescheduled.start.toISOString(), rescheduledStart.toISOString());
    const [rescheduledEvent] = await pool.query('SELECT ical_data FROM events WHERE calendar_id=?', [calendarId]);
    assert.match(rescheduledEvent[0].ical_data, /DTSTART:20260713T163000Z/);

    await store.cancelBookingByToken(booking.cancelToken);
    const [cancelled] = await pool.query('SELECT status FROM scheduler_bookings WHERE id=?', [booking.id]);
    assert.equal(cancelled[0].status, 'cancelled');
    const [remaining] = await pool.query('SELECT uid FROM events WHERE calendar_id=?', [calendarId]);
    assert.equal(remaining.length, 0);
    const [tombstones] = await pool.query('SELECT uid FROM calendar_tombstones WHERE calendar_id=?', [calendarId]);
    assert.equal(tombstones.length, 1);

    await pool.end();
});
