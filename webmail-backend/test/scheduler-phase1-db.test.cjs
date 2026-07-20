const test = require('node:test');
const assert = require('node:assert/strict');

process.env.OMS_DB_PASSWORD = process.env.OMS_DB_PASSWORD || 'test-only';

test('Phase 1 mailbox-to-booking-to-cancel lifecycle on MariaDB', { skip: process.env.OMS_SCHEDULER_PHASE1_DB_TEST !== '1' }, async () => {
    const { pool } = require('../src/db.js');
    const { SchedulerStore } = require('../src/scheduler/store.js');
    const { SchedulerPhase2Store } = require('../src/scheduler/phase2-store.js');
    const {
        SchedulerContactPreferenceRepository,
        SchedulerDeliveryProviderRepository,
        SchedulerJobRepository,
        SchedulerSecretBox,
        SchedulerWorkflowRepository,
    } = require('../src/scheduler/workflows.js');
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
        id INT AUTO_INCREMENT PRIMARY KEY, calendar_id INT,
        uid VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci,
        ical_data LONGTEXT, sync_token INT DEFAULT 1,
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
        overrides: [{ date: '2054-12-01', unavailableAllDay: true, windows: [] }],
    });
    assert.equal(publishedAvailability.published, true);
    assert.equal(publishedAvailability.overrides[0].unavailableAllDay, true);
    const defaultProfile = await store.getPublicProfile('phase1');
    assert.equal(defaultProfile.events.length, 0);
    assert.equal(defaultProfile.defaultEvent.durationMinutes, 30);
    assert.equal(defaultProfile.defaultEvent.systemManaged, true);
    const defaultSlots = await store.listSlots('phase1', '_default', new Date('2054-07-20T16:00:00.000Z'), new Date('2054-07-20T18:00:00.000Z'));
    assert.equal(defaultSlots[0].start.toISOString(), '2054-07-20T16:00:00.000Z');
    const blockedSlots = await store.listSlots('phase1', '_default', new Date('2054-12-01T16:00:00.000Z'), new Date('2054-12-01T18:00:00.000Z'));
    assert.equal(blockedSlots.length, 0);

    const event = await store.saveEventType(username, {
        title: 'Phase 1 Test', slug: 'phase-1-test', durationMinutes: 30, intervalMinutes: 30,
        minimumNoticeMinutes: 0, destinationCalendarId: calendarId, conflictCalendarIds: [calendarId],
        windows: [{ weekday: 1, startMinute: 540, endMinute: 600 }],
    });
    assert.equal(event.availabilityScheduleId, defaultAvailability.id);
    assert.equal(event.visibility, 'public');
    assert.equal((await store.getPublicProfile('phase1')).defaultEvent, null);
    const workflows = new SchedulerWorkflowRepository(pool);
    const workflow = await workflows.createWorkflow({
        tenantKey: entitlement.tenantKey,
        ownerUsername: username,
        name: 'Booking reminders',
        enabled: true,
        eventTypeIds: [event.id],
    });
    const workflowV1 = await workflows.publishVersion(workflow.id, username, {
        trigger: { type: 'booking.start', offsetSeconds: -86400 },
        steps: [
            { action: 'message.email.reminder', delaySeconds: 0, config: {} },
            { action: 'message.email.reminder', delaySeconds: 900, config: { subject: 'Soon: {{event.title}}' } },
            { action: 'message.email.reminder', delaySeconds: 1800, config: {} },
            { action: 'message.email.reminder', delaySeconds: 2700, config: {} },
        ],
    });
    assert.equal(workflowV1.version, 1);

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

    const start = new Date('2054-08-03T16:00:00.000Z');
    const slots = await store.listSlots('phase1', event.slug, start, new Date('2054-08-03T18:00:00.000Z'));
    assert.equal(slots[0].start.toISOString(), start.toISOString());

    const booking = await store.createBooking('phase1', event.slug, {
        eventTypeId: event.id, start, bookerTimeZone: 'Asia/Baghdad', bookerName: 'Ada',
        bookerEmail: 'ada@example.net', idempotencyKey: 'phase1-lifecycle-0001',
    });
    assert.equal(booking.status, 'confirmed');
    assert.deepEqual(await workflows.listBookingVersions(entitlement.tenantKey, booking.id), [{
        workflowId: workflow.id,
        versionId: workflowV1.id,
        version: 1,
    }]);
    const workflowV2 = await workflows.publishVersion(workflow.id, username, {
        trigger: { type: 'booking.start', offsetSeconds: -7200 },
        steps: [{ action: 'message.email.reminder', delaySeconds: 0, config: {} }],
    });
    assert.equal(workflowV2.version, 2);
    assert.equal((await workflows.listBookingVersions(entitlement.tenantKey, booking.id))[0].version, 1, 'existing bookings must retain their captured workflow version');
    const workflowList = await workflows.listWorkflows(username);
    assert.equal(workflowList.find(item => item.id === workflow.id).definition.trigger.type, 'booking.start');
    const clonedWorkflow = await workflows.cloneWorkflow(username, workflow.id);
    const clonedWorkflowState = (await workflows.listWorkflows(username)).find(item => item.id === clonedWorkflow.id);
    assert.equal(clonedWorkflowState.enabled, false);
    assert.equal(clonedWorkflowState.currentVersion, 1);
    assert.deepEqual(clonedWorkflowState.definition, workflowList.find(item => item.id === workflow.id).definition);

    const approvalWorkflowEvent = await store.saveEventType(username, {
        title: 'Approval Workflow Test', slug: 'approval-workflow-test', durationMinutes: 30, intervalMinutes: 30,
        minimumNoticeMinutes: 0, requiresConfirmation: true,
        destinationCalendarId: calendarId, conflictCalendarIds: [calendarId],
        windows: [{ weekday: 1, startMinute: 540, endMinute: 600 }],
    });
    const approvalWorkflow = await workflows.createWorkflow({
        tenantKey: entitlement.tenantKey, ownerUsername: username, name: 'Approval snapshot',
        enabled: true, eventTypeIds: [approvalWorkflowEvent.id],
    });
    const approvalWorkflowV1 = await workflows.publishVersion(approvalWorkflow.id, username, {
        trigger: { type: 'booking.confirmed', offsetSeconds: 0 },
        steps: [{ action: 'message.email', delaySeconds: 0, config: { subject: 'Version one', body: '{{event.title}}' } }],
    });
    const approvalWorkflowStart = new Date('2054-08-10T16:00:00.000Z');
    const approvalWorkflowBooking = await store.createBooking('phase1', approvalWorkflowEvent.slug, {
        eventTypeId: approvalWorkflowEvent.id, start: approvalWorkflowStart, bookerTimeZone: 'America/Phoenix',
        bookerName: 'Version Keeper', bookerEmail: 'version-keeper@example.net',
        idempotencyKey: 'phase3-approval-version-0001',
    });
    assert.equal(approvalWorkflowBooking.status, 'requested');
    assert.equal((await workflows.listBookingVersions(entitlement.tenantKey, approvalWorkflowBooking.id))[0].version, 1,
        'requested bookings must capture workflow versions immediately');
    await workflows.publishVersion(approvalWorkflow.id, username, {
        trigger: { type: 'booking.confirmed', offsetSeconds: 0 },
        steps: [{ action: 'message.email', delaySeconds: 0, config: { subject: 'Version two', body: '{{event.title}}' } }],
    });
    await store.decideBooking(username, approvalWorkflowBooking.id, 'confirmed');
    const [approvalWorkflowJobs] = await pool.query(
        'SELECT workflow_version_id FROM scheduler_jobs WHERE booking_id=?', [approvalWorkflowBooking.id],
    );
    assert.equal(approvalWorkflowJobs.some(row => row.workflow_version_id === approvalWorkflowV1.id), true,
        'approval must activate the version captured when the booking was requested');
    assert.equal(approvalWorkflowJobs.some(row => row.workflow_version_id !== approvalWorkflowV1.id), false);

    const secrets = new SchedulerSecretBox('phase3-disposable-secret');
    const providers = new SchedulerDeliveryProviderRepository(pool, secrets);
    await assert.rejects(() => providers.save(username, entitlement.tenantKey, {
        name: 'Unsigned webhook', channel: 'webhook', endpointUrl: 'https://adapter.example.test/unsigned',
        timeoutSeconds: 10,
    }), /require a secret/);
    const savedProvider = await providers.save(username, entitlement.tenantKey, {
        name: 'Disposable webhook', channel: 'webhook', endpointUrl: 'https://adapter.example.test/scheduler',
        secret: 'Bearer disposable', timeoutSeconds: 10,
    });
    assert.equal(savedProvider.hasSecret, true);
    assert.equal(Object.hasOwn(savedProvider, 'secret'), false, 'provider APIs must never return credentials');
    assert.equal((await providers.forDelivery(entitlement.tenantKey, savedProvider.id)).secret, 'Bearer disposable');
    const [providerSecretRows] = await pool.query('SELECT secret_key_version FROM scheduler_delivery_providers WHERE id=?', [savedProvider.id]);
    assert.equal(Number(providerSecretRows[0].secret_key_version), 1);
    await providers.recordTest(savedProvider.id, 'healthy');
    const testedProvider = (await providers.list(entitlement.tenantKey)).find(item => item.id === savedProvider.id);
    assert.equal(testedProvider.lastTestStatus, 'healthy');
    assert.ok(testedProvider.lastTestedAt);
    const preferences = new SchedulerContactPreferenceRepository(pool, secrets);
    await preferences.recordConsents(pool, entitlement.tenantKey, 'ada@example.net', {
        phone: '+16025550123', channels: ['sms'],
    });
    const currentPreference = await preferences.current(entitlement.tenantKey, 'ada@example.net', 'sms');
    assert.equal(currentPreference.phone, '+16025550123');
    await preferences.recordConsents(pool, entitlement.tenantKey, 'ada@example.net', {
        phone: '+16025550124', channels: ['sms'],
    });
    const repeatedPreference = await preferences.current(entitlement.tenantKey, 'ada@example.net', 'sms');
    assert.equal(repeatedPreference.token, currentPreference.token, 'repeat consent must not invalidate an existing unsubscribe link');
    assert.equal(repeatedPreference.phone, '+16025550124');
    const concurrentConsentEmail = 'concurrent-consent@example.net';
    await Promise.all(['+16025550131', '+16025550132'].map(async phone => {
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();
            await preferences.recordConsents(connection, entitlement.tenantKey, concurrentConsentEmail, {
                phone, channels: ['sms'],
            });
            await connection.commit();
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }));
    const [concurrentConsentRows] = await pool.query(
        `SELECT COUNT(*) AS total FROM scheduler_contact_preferences
         WHERE tenant_key=? AND contact_email=? AND channel='sms'`,
        [entitlement.tenantKey, concurrentConsentEmail],
    );
    assert.equal(Number(concurrentConsentRows[0].total), 1, 'concurrent first consent must converge on one preference');
    assert.ok(await preferences.current(entitlement.tenantKey, concurrentConsentEmail, 'sms'));
    assert.equal(await preferences.unsubscribe(currentPreference.token), true);
    assert.equal(await preferences.current(entitlement.tenantKey, 'ada@example.net', 'sms'), null);
    const [workflowJobs] = await pool.query('SELECT COUNT(*) AS total FROM scheduler_jobs WHERE booking_id=?', [booking.id]);
    assert.equal(Number(workflowJobs[0].total), 4);

    const questionEvent = await store.saveEventType(username, {
        title: 'Question Test', slug: 'question-test', durationMinutes: 30, intervalMinutes: 30,
        minimumNoticeMinutes: 0, destinationCalendarId: calendarId, conflictCalendarIds: [calendarId],
        questions: [
            { id: 'question-goal', label: 'What is your goal?', type: 'long_text', required: true, options: [] },
            { id: 'question-plan', label: 'Choose a plan', type: 'select', required: false, options: ['Basic', 'Pro'] },
        ],
    });
    assert.equal(questionEvent.questions.length, 2);
    const questionStart = new Date('2054-07-15T16:00:00.000Z');
    await assert.rejects(() => store.createBooking('phase1', questionEvent.slug, {
        eventTypeId: questionEvent.id, start: questionStart, bookerTimeZone: 'America/Phoenix',
        bookerName: 'Missing Answer', bookerEmail: 'missing-answer@example.net',
        idempotencyKey: 'phase1-question-missing-0001',
    }), /What is your goal\? is required/);
    const questionBooking = await store.createBooking('phase1', questionEvent.slug, {
        eventTypeId: questionEvent.id, start: questionStart, bookerTimeZone: 'America/Phoenix',
        bookerName: 'Question Guest', bookerEmail: 'questions@example.net',
        bookingAnswers: [
            { questionId: 'question-goal', value: 'Plan a migration' },
            { questionId: 'question-plan', value: 'Pro' },
        ],
        idempotencyKey: 'phase1-question-success-0001',
    });
    const legacyQuestionEvent = await store.saveEventType(username, {
        ...questionEvent,
        title: 'Question Test Legacy Update',
        questions: undefined,
    }, questionEvent.id);
    assert.equal(legacyQuestionEvent.questions[0].label, 'What is your goal?', 'older clients must not erase booking questions');
    const updatedQuestionEvent = await store.saveEventType(username, {
        ...questionEvent,
        questions: questionEvent.questions.map(question => question.id === 'question-goal'
            ? { ...question, label: 'What changed?' }
            : question),
    }, questionEvent.id);
    assert.equal(updatedQuestionEvent.questions[0].label, 'What changed?');
    const questionOwnerBooking = (await store.listBookings(username, 'upcoming')).find(item => item.id === questionBooking.id);
    assert.equal(questionOwnerBooking.bookingAnswers[0].label, 'What is your goal?');
    assert.equal(questionOwnerBooking.bookingAnswers[0].value, 'Plan a migration');
    assert.equal(questionOwnerBooking.event.questions[0].label, 'What is your goal?', 'booking event snapshot must be immutable');
    const [storedQuestionBooking] = await pool.query('SELECT booking_answers FROM scheduler_bookings WHERE id=?', [questionBooking.id]);
    assert.equal(JSON.parse(storedQuestionBooking[0].booking_answers)[1].value, 'Pro');
    const [answerAuditLeaks] = await pool.query("SELECT COUNT(*) AS total FROM scheduler_audit_events WHERE metadata LIKE '%Plan a migration%'");
    assert.equal(Number(answerAuditLeaks[0].total), 0, 'booking answers must not be copied into audit metadata');
    await store.cancelBookingByToken(questionBooking.cancelToken);

    const approvalEvent = await store.saveEventType(username, {
        title: 'Approval Test', slug: 'approval-test', durationMinutes: 30, intervalMinutes: 30,
        minimumNoticeMinutes: 0, destinationCalendarId: calendarId, conflictCalendarIds: [calendarId],
        requiresConfirmation: true,
    });
    assert.equal(approvalEvent.requiresConfirmation, true);
    const approvalEventAfterLegacyUpdate = await store.saveEventType(username, {
        ...approvalEvent, title: 'Approval Test Legacy Update', requiresConfirmation: undefined,
    }, approvalEvent.id);
    assert.equal(approvalEventAfterLegacyUpdate.requiresConfirmation, true, 'older clients must not disable host confirmation');
    const approvalStart = new Date('2054-07-16T16:00:00.000Z');
    const approvalRequest = await store.createBooking('phase1', approvalEvent.slug, {
        eventTypeId: approvalEvent.id, start: approvalStart, bookerTimeZone: 'America/Phoenix',
        bookerName: 'Approval Guest', bookerEmail: 'approval@example.net', idempotencyKey: 'phase1-approval-0001',
    });
    assert.equal(approvalRequest.status, 'requested');
    const [requestedRows] = await pool.query('SELECT status, confirmed_at, rejected_at FROM scheduler_bookings WHERE id=?', [approvalRequest.id]);
    assert.equal(requestedRows[0].status, 'requested');
    assert.equal(requestedRows[0].confirmed_at, null);
    assert.equal(requestedRows[0].rejected_at, null);
    const [requestedProjection] = await pool.query('SELECT COUNT(*) AS total FROM events WHERE uid=?', [`scheduler-${approvalRequest.id}@openmailstack`]);
    assert.equal(Number(requestedProjection[0].total), 0, 'requested bookings must not project Calendar events');
    const approvalSlotsWhileRequested = await store.listSlots('phase1', approvalEvent.slug, new Date(approvalStart.getTime() - 1), new Date(approvalStart.getTime() + 31 * 60 * 1000));
    assert.equal(approvalSlotsWhileRequested.some(slot => slot.start.getTime() === approvalStart.getTime()), false, 'requested bookings must reserve capacity');
    const [requestedOutbox] = await pool.query("SELECT payload FROM scheduler_outbox WHERE aggregate_id=? AND event_type='booking.requested'", [approvalRequest.id]);
    assert.equal(requestedOutbox.length, 1);
    assert.equal(Object.hasOwn(JSON.parse(requestedOutbox[0].payload), 'bookingAnswers'), false, 'request notifications must not contain answers');
    const approved = await store.decideBooking(username, approvalRequest.id, 'confirmed');
    assert.equal(approved.status, 'confirmed');
    const approvedReplay = await store.decideBooking(username, approvalRequest.id, 'confirmed');
    assert.equal(approvedReplay.idempotentReplay, true);
    const [approvedRows] = await pool.query('SELECT status, confirmed_at FROM scheduler_bookings WHERE id=?', [approvalRequest.id]);
    assert.equal(approvedRows[0].status, 'confirmed');
    assert.ok(approvedRows[0].confirmed_at);
    const [approvedProjection] = await pool.query('SELECT COUNT(*) AS total FROM events WHERE uid=?', [`scheduler-${approvalRequest.id}@openmailstack`]);
    assert.equal(Number(approvedProjection[0].total), 1);
    const [approvedOutbox] = await pool.query("SELECT COUNT(*) AS total FROM scheduler_outbox WHERE aggregate_id=? AND event_type='booking.confirmed'", [approvalRequest.id]);
    assert.equal(Number(approvedOutbox[0].total), 1, 'idempotent approval must enqueue one confirmation');
    assert.equal(await store.cancelBookingByToken(approvalRequest.cancelToken), null, 'approval must rotate the request cancellation token');
    await assert.rejects(() => store.decideBooking(username, approvalRequest.id, 'rejected'), /no longer be approved or rejected/);
    await store.cancelOwnedBooking(username, approvalRequest.id);

    const rejectionStart = new Date('2054-07-16T16:30:00.000Z');
    const rejectionRequest = await store.createBooking('phase1', approvalEvent.slug, {
        eventTypeId: approvalEvent.id, start: rejectionStart, bookerTimeZone: 'America/Phoenix',
        bookerName: 'Rejected Guest', bookerEmail: 'rejected@example.net', idempotencyKey: 'phase1-rejection-0001',
    });
    const rejected = await store.decideBooking(username, rejectionRequest.id, 'rejected');
    assert.equal(rejected.status, 'rejected');
    assert.equal((await store.decideBooking(username, rejectionRequest.id, 'rejected')).idempotentReplay, true);
    const [rejectedRows] = await pool.query('SELECT status, rejected_at FROM scheduler_bookings WHERE id=?', [rejectionRequest.id]);
    assert.equal(rejectedRows[0].status, 'rejected');
    assert.ok(rejectedRows[0].rejected_at);
    const [rejectedProjection] = await pool.query('SELECT COUNT(*) AS total FROM events WHERE uid=?', [`scheduler-${rejectionRequest.id}@openmailstack`]);
    assert.equal(Number(rejectedProjection[0].total), 0);
    const rejectionSlots = await store.listSlots('phase1', approvalEvent.slug, new Date(rejectionStart.getTime() - 1), new Date(rejectionStart.getTime() + 31 * 60 * 1000));
    assert.equal(rejectionSlots.some(slot => slot.start.getTime() === rejectionStart.getTime()), true, 'rejection must release capacity');
    assert.equal(await store.cancelBookingByToken(rejectionRequest.cancelToken), null, 'rejection must expire request action tokens');
    const [rejectedOutbox] = await pool.query("SELECT COUNT(*) AS total FROM scheduler_outbox WHERE aggregate_id=? AND event_type='booking.rejected'", [rejectionRequest.id]);
    assert.equal(Number(rejectedOutbox[0].total), 1);
    assert.equal((await store.listBookings(username, 'rejected')).some(item => item.id === rejectionRequest.id), true);

    const requestedCancelStart = new Date('2054-07-17T16:00:00.000Z');
    const requestedCancel = await store.createBooking('phase1', approvalEvent.slug, {
        eventTypeId: approvalEvent.id, start: requestedCancelStart, bookerTimeZone: 'America/Phoenix',
        bookerName: 'Cancel Request', bookerEmail: 'cancel-request@example.net', idempotencyKey: 'phase1-request-cancel-0001',
    });
    const [tombstonesBeforeRequestedCancel] = await pool.query('SELECT COUNT(*) AS total FROM calendar_tombstones');
    await store.cancelBookingByToken(requestedCancel.cancelToken);
    const [tombstonesAfterRequestedCancel] = await pool.query('SELECT COUNT(*) AS total FROM calendar_tombstones');
    assert.equal(Number(tombstonesAfterRequestedCancel[0].total), Number(tombstonesBeforeRequestedCancel[0].total), 'requested cancellation must not write a phantom Calendar tombstone');

    const raceStart = new Date('2054-07-17T16:30:00.000Z');
    const raceRequest = await store.createBooking('phase1', approvalEvent.slug, {
        eventTypeId: approvalEvent.id, start: raceStart, bookerTimeZone: 'America/Phoenix',
        bookerName: 'Decision Race', bookerEmail: 'decision-race@example.net', idempotencyKey: 'phase1-decision-race-0001',
    });
    const decisionRace = await Promise.allSettled([
        store.decideBooking(username, raceRequest.id, 'confirmed'),
        store.decideBooking(username, raceRequest.id, 'rejected'),
    ]);
    assert.equal(decisionRace.filter(result => result.status === 'fulfilled').length, 1, 'concurrent opposite decisions must yield one winner');
    const raceDecision = decisionRace.find(result => result.status === 'fulfilled').value.status;
    const [raceRows] = await pool.query('SELECT status FROM scheduler_bookings WHERE id=?', [raceRequest.id]);
    assert.equal(raceRows[0].status, raceDecision);
    const [raceAudits] = await pool.query("SELECT COUNT(*) AS total FROM scheduler_audit_events WHERE target_id=? AND action IN ('booking.confirm','booking.reject')", [raceRequest.id]);
    assert.equal(Number(raceAudits[0].total), 1);
    assert.equal((await store.decideBooking(username, raceRequest.id, raceDecision)).idempotentReplay, true);
    if (raceDecision === 'confirmed') await store.cancelOwnedBooking(username, raceRequest.id);

    const policyEvent = await store.saveEventType(username, {
        title: 'Action Policy Test', slug: 'action-policy-test', durationMinutes: 30, intervalMinutes: 30,
        minimumNoticeMinutes: 0, destinationCalendarId: calendarId, conflictCalendarIds: [calendarId],
        cancellationCutoffMinutes: 60, rescheduleCutoffMinutes: 120,
        requireCancellationReason: true, requireRescheduleReason: true,
    });
    assert.equal(policyEvent.cancellationCutoffMinutes, 60);
    assert.equal(policyEvent.rescheduleCutoffMinutes, 120);
    assert.equal(policyEvent.requireCancellationReason, true);
    assert.equal(policyEvent.requireRescheduleReason, true);
    const policyEventAfterLegacyUpdate = await store.saveEventType(username, {
        ...policyEvent, title: 'Action Policy Legacy Update', cancellationCutoffMinutes: undefined,
        rescheduleCutoffMinutes: undefined, requireCancellationReason: undefined, requireRescheduleReason: undefined,
    }, policyEvent.id);
    assert.equal(policyEventAfterLegacyUpdate.cancellationCutoffMinutes, 60, 'older clients must preserve cancellation policy');
    assert.equal(policyEventAfterLegacyUpdate.rescheduleCutoffMinutes, 120, 'older clients must preserve reschedule policy');
    assert.equal(policyEventAfterLegacyUpdate.requireCancellationReason, true);
    assert.equal(policyEventAfterLegacyUpdate.requireRescheduleReason, true);

    const policyCancelStart = new Date('2054-07-20T16:00:00.000Z');
    const policyCancelBooking = await store.createBooking('phase1', policyEvent.slug, {
        eventTypeId: policyEvent.id, start: policyCancelStart, bookerTimeZone: 'America/Phoenix',
        bookerName: 'Policy Cancel Guest', bookerEmail: 'policy-cancel@example.net', idempotencyKey: 'phase1-policy-cancel-0001',
    });
    const policyRescheduleStart = new Date('2054-07-20T16:30:00.000Z');
    const policyRescheduleBooking = await store.createBooking('phase1', policyEvent.slug, {
        eventTypeId: policyEvent.id, start: policyRescheduleStart, bookerTimeZone: 'America/Phoenix',
        bookerName: 'Policy Reschedule Guest', bookerEmail: 'policy-reschedule@example.net', idempotencyKey: 'phase1-policy-reschedule-0001',
    });
    const tightenedPolicyEvent = await store.saveEventType(username, {
        ...policyEventAfterLegacyUpdate, cancellationCutoffMinutes: 525600, rescheduleCutoffMinutes: 525600,
        requireCancellationReason: false, requireRescheduleReason: false,
    }, policyEvent.id);
    assert.equal(tightenedPolicyEvent.cancellationCutoffMinutes, 525600);
    const cancelCapability = await store.getCapabilityBooking(policyCancelBooking.cancelToken, 'cancel');
    assert.equal(cancelCapability.policy.allowed, true);
    assert.equal(cancelCapability.policy.cutoffMinutes, 60, 'booking must retain its original cancellation policy');
    assert.equal(cancelCapability.policy.reasonRequired, true);
    await assert.rejects(() => store.cancelBookingByToken(policyCancelBooking.cancelToken), /cancellation reason is required/);
    await assert.rejects(() => store.cancelBookingByToken(policyCancelBooking.cancelToken, 'x'.repeat(1001)), /1000 characters/);
    const cancellationReason = '<script>Plans changed</script>';
    await store.cancelBookingByToken(policyCancelBooking.cancelToken, cancellationReason);
    const [storedCancellationReason] = await pool.query('SELECT cancellation_reason FROM scheduler_bookings WHERE id=?', [policyCancelBooking.id]);
    assert.equal(storedCancellationReason[0].cancellation_reason, cancellationReason);
    const cancelledOwnerBooking = (await store.listBookings(username, 'cancelled')).find(item => item.id === policyCancelBooking.id);
    assert.equal(cancelledOwnerBooking.cancellationReason, cancellationReason);

    const rescheduleCapability = await store.getCapabilityBooking(policyRescheduleBooking.rescheduleToken, 'reschedule');
    assert.equal(rescheduleCapability.policy.allowed, true);
    assert.equal(rescheduleCapability.policy.cutoffMinutes, 120, 'booking must retain its original reschedule policy');
    assert.equal(rescheduleCapability.policy.reasonRequired, true);
    const policyRescheduledStart = new Date('2054-07-20T17:00:00.000Z');
    await assert.rejects(() => store.rescheduleBookingByToken(policyRescheduleBooking.rescheduleToken, policyRescheduledStart), /reschedule reason is required/);
    const rescheduleReason = 'Need more preparation time';
    await store.rescheduleBookingByToken(policyRescheduleBooking.rescheduleToken, policyRescheduledStart, rescheduleReason);
    const [storedRescheduleReason] = await pool.query('SELECT reschedule_reason FROM scheduler_bookings WHERE id=?', [policyRescheduleBooking.id]);
    assert.equal(storedRescheduleReason[0].reschedule_reason, rescheduleReason);
    const rescheduledOwnerBooking = (await store.listBookings(username, 'upcoming')).find(item => item.id === policyRescheduleBooking.id);
    assert.equal(rescheduledOwnerBooking.rescheduleReason, rescheduleReason);
    const [reasonOutboxLeaks] = await pool.query('SELECT COUNT(*) AS total FROM scheduler_outbox WHERE payload LIKE ? OR payload LIKE ?', [`%${cancellationReason}%`, `%${rescheduleReason}%`]);
    assert.equal(Number(reasonOutboxLeaks[0].total), 0, 'action reasons must not enter outbox payloads');
    const [reasonAuditLeaks] = await pool.query('SELECT COUNT(*) AS total FROM scheduler_audit_events WHERE metadata LIKE ? OR metadata LIKE ?', [`%${cancellationReason}%`, `%${rescheduleReason}%`]);
    assert.equal(Number(reasonAuditLeaks[0].total), 0, 'action reasons must not enter audit metadata');
    await store.cancelOwnedBooking(username, policyRescheduleBooking.id);

    const closedCancelStart = new Date('2054-07-21T16:00:00.000Z');
    const closedCancelBooking = await store.createBooking('phase1', tightenedPolicyEvent.slug, {
        eventTypeId: tightenedPolicyEvent.id, start: closedCancelStart, bookerTimeZone: 'America/Phoenix',
        bookerName: 'Closed Cancel Guest', bookerEmail: 'closed-cancel@example.net', idempotencyKey: 'phase1-closed-cancel-0001',
    });
    await pool.query(
        'UPDATE scheduler_bookings SET slot_start=DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 30 MINUTE), slot_end=DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 60 MINUTE) WHERE id=?',
        [closedCancelBooking.id]
    );
    assert.equal((await store.getCapabilityBooking(closedCancelBooking.cancelToken, 'cancel')).policy.allowed, false);
    await assert.rejects(() => store.cancelBookingByToken(closedCancelBooking.cancelToken), /Cancellation window has closed/);
    const [closedCancelStatus] = await pool.query('SELECT status FROM scheduler_bookings WHERE id=?', [closedCancelBooking.id]);
    assert.equal(closedCancelStatus[0].status, 'confirmed', 'closed cancellation must not mutate the booking');
    await pool.query('UPDATE scheduler_bookings SET slot_start=?,slot_end=? WHERE id=?',
        ['2054-07-21 16:00:00.000', '2054-07-21 16:30:00.000', closedCancelBooking.id]);
    await store.cancelOwnedBooking(username, closedCancelBooking.id);

    const closedRescheduleStart = new Date('2054-07-21T16:30:00.000Z');
    const closedRescheduleBooking = await store.createBooking('phase1', tightenedPolicyEvent.slug, {
        eventTypeId: tightenedPolicyEvent.id, start: closedRescheduleStart, bookerTimeZone: 'America/Phoenix',
        bookerName: 'Closed Reschedule Guest', bookerEmail: 'closed-reschedule@example.net', idempotencyKey: 'phase1-closed-reschedule-0001',
    });
    await pool.query(
        'UPDATE scheduler_bookings SET slot_start=DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 30 MINUTE), slot_end=DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 60 MINUTE) WHERE id=?',
        [closedRescheduleBooking.id]
    );
    assert.equal((await store.getCapabilityBooking(closedRescheduleBooking.rescheduleToken, 'reschedule')).policy.allowed, false);
    await assert.rejects(() => store.rescheduleBookingByToken(closedRescheduleBooking.rescheduleToken, new Date('2054-07-21T17:00:00.000Z')), /Reschedule window has closed/);
    const [closedRescheduleStatus] = await pool.query('SELECT status, CAST(slot_start AS CHAR) AS slot_start_utc FROM scheduler_bookings WHERE id=?', [closedRescheduleBooking.id]);
    assert.equal(closedRescheduleStatus[0].status, 'confirmed');
    assert.notEqual(closedRescheduleStatus[0].slot_start_utc, '2054-07-21 17:00:00.000');
    await pool.query('UPDATE scheduler_bookings SET slot_start=?,slot_end=? WHERE id=?',
        ['2054-07-21 16:30:00.000', '2054-07-21 17:00:00.000', closedRescheduleBooking.id]);
    await store.cancelOwnedBooking(username, closedRescheduleBooking.id);

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
    const [projected] = await pool.query('SELECT uid FROM events WHERE calendar_id=? AND uid=?', [
        calendarId, `scheduler-${booking.id}@openmailstack`,
    ]);
    assert.equal(projected.length, 1);

    const [calendarProjection] = await pool.query('SELECT ical_data FROM events WHERE calendar_id=? AND uid=?', [calendarId, `scheduler-${booking.id}@openmailstack`]);
    await pool.query('UPDATE events SET ical_data=? WHERE calendar_id=? AND uid=?', ['malformed-calendar-data', calendarId, `scheduler-${booking.id}@openmailstack`]);
    const fullSlotRange = await store.listSlots('phase1', event.slug, new Date(start.getTime() - 1), new Date(start.getTime() + 31 * 60 * 1000));
    assert.equal(fullSlotRange.some(slot => slot.start.getTime() === start.getTime()), false, 'confirmed capacity must hide a slot even if calendar parsing fails');
    await pool.query('UPDATE events SET ical_data=? WHERE calendar_id=? AND uid=?', [calendarProjection[0].ical_data, calendarId, `scheduler-${booking.id}@openmailstack`]);

    const rescheduledStart = new Date('2054-08-03T16:30:00.000Z');
    const rescheduleSlots = await store.listSlots('phase1', event.slug, new Date(rescheduledStart.getTime() - 1), new Date(rescheduledStart.getTime() + 31 * 60 * 1000), booking.rescheduleToken);
    assert.equal(rescheduleSlots.some(slot => slot.start.getTime() === rescheduledStart.getTime()), true, 'reschedule capability must access private-event slots');
    const rescheduled = await store.rescheduleBookingByToken(booking.rescheduleToken, rescheduledStart);
    assert.equal(rescheduled.start.toISOString(), rescheduledStart.toISOString());
    const [rescheduledEvent] = await pool.query('SELECT ical_data FROM events WHERE calendar_id=? AND uid=?', [
        calendarId, `scheduler-${booking.id}@openmailstack`,
    ]);
    assert.match(rescheduledEvent[0].ical_data, /DTSTART:20540803T163000Z/);
    const [rescheduledJobs] = await pool.query(
        `SELECT j.id, CAST(j.available_at AS CHAR) AS available_at_utc, j.payload, s.step_order
         FROM scheduler_jobs j JOIN scheduler_workflow_steps s ON s.id=j.workflow_step_id
         WHERE j.booking_id=? AND j.cancelled_at IS NULL ORDER BY s.step_order`,
        [booking.id]
    );
    assert.deepEqual(rescheduledJobs.map(row => row.available_at_utc), [
        '2054-08-02 16:30:00.000',
        '2054-08-02 16:45:00.000',
        '2054-08-02 17:00:00.000',
        '2054-08-02 17:15:00.000',
    ], 'reschedule must re-time pending jobs from the captured workflow version');
    assert.equal(JSON.parse(rescheduledJobs[0].payload).start, rescheduledStart.toISOString());

    const jobs = new SchedulerJobRepository(pool);
    await pool.query("UPDATE scheduler_jobs SET available_at='2100-01-01 00:00:00.000'");
    await pool.query('UPDATE scheduler_jobs SET available_at=UTC_TIMESTAMP(3) WHERE id=?', [rescheduledJobs[0].id]);
    const firstClaim = await jobs.claimBatch('phase3-worker-1', 1, new Date(0));
    assert.equal(firstClaim.length, 1);
    assert.equal(firstClaim[0].id, rescheduledJobs[0].id);
    await assert.rejects(() => workflows.reconcileJob(username, firstClaim[0].id, 'retry'), /actively leased/);
    const [leaseRows] = await pool.query('SELECT lease_expires_at>UTC_TIMESTAMP(3) AS active FROM scheduler_jobs WHERE id=?', [firstClaim[0].id]);
    assert.equal(Number(leaseRows[0].active), 1, 'job leases must use database time instead of the worker clock');
    assert.equal((await jobs.claimBatch('phase3-worker-other', 1, new Date('2100-01-01T00:00:00.000Z'))).length, 0,
        'another worker must not reclaim an active lease');
    await jobs.beginAttempt(firstClaim[0].id, 'phase3-worker-1', 'test-provider');
    await jobs.complete(firstClaim[0].id, 'phase3-worker-1', 'test-provider', 'message-1');

    await pool.query('UPDATE scheduler_jobs SET available_at=UTC_TIMESTAMP(3) WHERE id=?', [rescheduledJobs[1].id]);
    const inFlightClaim = (await jobs.claimBatch('phase3-worker-2', 1, new Date(0)))[0];
    await jobs.beginAttempt(inFlightClaim.id, 'phase3-worker-2', 'test-provider');
    const secondRescheduledStart = new Date('2054-08-03T17:00:00.000Z');
    const secondReschedule = await store.rescheduleBookingByToken(booking.rescheduleToken, secondRescheduledStart);
    assert.equal(secondReschedule.start.toISOString(), secondRescheduledStart.toISOString());
    const [inFlightAttemptRows] = await pool.query(
        'SELECT outcome,error_code FROM scheduler_delivery_attempts WHERE job_id=?', [inFlightClaim.id]
    );
    assert.deepEqual([inFlightAttemptRows[0].outcome, inFlightAttemptRows[0].error_code],
        ['dead_lettered', 'delivery_uncertain_rescheduled'], 'rescheduling must visibly reconcile an in-flight reminder');
    const [activeJobs] = await pool.query(
        `SELECT j.id,j.schedule_generation,j.payload,s.step_order
         FROM scheduler_jobs j JOIN scheduler_workflow_steps s ON s.id=j.workflow_step_id
         WHERE j.booking_id=? AND j.cancelled_at IS NULL AND j.completed_at IS NULL AND j.dead_lettered_at IS NULL
         ORDER BY s.step_order`,
        [booking.id]
    );
    assert.equal(activeJobs.length, 4, 'a new schedule generation must include steps already sent for the old time');
    assert.equal(activeJobs.every(row => Number(row.schedule_generation) === 3), true);
    assert.equal(activeJobs.every(row => JSON.parse(row.payload).start === secondRescheduledStart.toISOString()), true);
    await pool.query("UPDATE scheduler_jobs SET available_at='2100-01-01 00:00:00.000' WHERE booking_id=? AND cancelled_at IS NULL", [booking.id]);

    await pool.query('UPDATE scheduler_jobs SET available_at=UTC_TIMESTAMP(3) WHERE id=?', [activeJobs[0].id]);
    const retryClaim = (await jobs.claimBatch('phase3-worker-3', 1, new Date(0)))[0];
    await jobs.beginAttempt(retryClaim.id, 'phase3-worker-3', 'test-provider');
    await jobs.fail(retryClaim.id, 'phase3-worker-3', 'test-provider', retryClaim.attempts, 'PROVIDER_DOWN');
    const [retryRows] = await pool.query('SELECT completed_at, dead_lettered_at, last_error_code FROM scheduler_jobs WHERE id=?', [retryClaim.id]);
    assert.equal(retryRows[0].completed_at, null);
    assert.equal(retryRows[0].dead_lettered_at, null);
    assert.equal(retryRows[0].last_error_code, 'PROVIDER_DOWN');
    await pool.query('UPDATE scheduler_jobs SET attempts=7, available_at=UTC_TIMESTAMP(3) WHERE id=?', [retryClaim.id]);
    const finalClaim = (await jobs.claimBatch('phase3-worker-4', 1, new Date(0)))[0];
    assert.equal(finalClaim.attempts, 8);
    await jobs.beginAttempt(finalClaim.id, 'phase3-worker-4', 'test-provider');
    await jobs.fail(finalClaim.id, 'phase3-worker-4', 'test-provider', finalClaim.attempts, 'PROVIDER_DOWN');
    const [deadLetterRows] = await pool.query('SELECT dead_lettered_at, payload FROM scheduler_jobs WHERE id=?', [finalClaim.id]);
    assert.ok(deadLetterRows[0].dead_lettered_at);
    assert.notEqual(deadLetterRows[0].payload, '{}', 'dead-lettered jobs must retain replay data until an owner reconciles them');
    const operations = await workflows.listOperations(username);
    assert.equal(operations.alerts.some(alert => alert.jobId === finalClaim.id && alert.alertType === 'dead_lettered'), true);
    await workflows.reconcileJob(username, finalClaim.id, 'retry');
    const [manualRetryRows] = await pool.query('SELECT attempts,dead_lettered_at FROM scheduler_jobs WHERE id=?', [finalClaim.id]);
    assert.equal(Number(manualRetryRows[0].attempts), 8, 'manual retry must preserve delivery-attempt numbering');
    assert.equal(manualRetryRows[0].dead_lettered_at, null);
    const manualRetryClaim = (await jobs.claimBatch('phase3-worker-manual', 1, new Date(0)))[0];
    assert.equal(manualRetryClaim.id, finalClaim.id);
    assert.equal(manualRetryClaim.attempts, 9);
    await jobs.beginAttempt(manualRetryClaim.id, 'phase3-worker-manual', 'test-provider');
    await jobs.uncertain(manualRetryClaim.id, 'phase3-worker-manual', 'test-provider', 9, 'provider_timeout');
    await workflows.reconcileJob(username, finalClaim.id, 'delivered');
    const [reconciledRows] = await pool.query('SELECT completed_at,payload,dead_lettered_at FROM scheduler_jobs WHERE id=?', [finalClaim.id]);
    assert.ok(reconciledRows[0].completed_at);
    assert.equal(reconciledRows[0].payload, '{}', 'explicit delivery reconciliation must erase retained replay data');
    assert.equal(reconciledRows[0].dead_lettered_at, null);
    const [manualAttemptRows] = await pool.query('SELECT outcome,error_code FROM scheduler_delivery_attempts WHERE job_id=? AND attempt_no=9', [finalClaim.id]);
    assert.deepEqual([manualAttemptRows[0].outcome, manualAttemptRows[0].error_code], ['sent', null],
        'manual delivery reconciliation must keep the attempt ledger consistent');

    await pool.query('UPDATE scheduler_jobs SET available_at=UTC_TIMESTAMP(3) WHERE id=?', [activeJobs[1].id]);
    const uncertainClaim = (await jobs.claimBatch('phase3-worker-5', 1, new Date(0)))[0];
    await jobs.beginAttempt(uncertainClaim.id, 'phase3-worker-5', 'test-provider');
    await pool.query("UPDATE scheduler_jobs SET lease_expires_at='2000-01-01 00:00:00.000' WHERE id=?", [uncertainClaim.id]);
    assert.equal((await jobs.claimBatch('phase3-worker-6', 1, new Date(0))).length, 0,
        'an uncertain accepted attempt must dead-letter instead of sending a duplicate');
    const [uncertainRows] = await pool.query('SELECT dead_lettered_at,last_error_code FROM scheduler_jobs WHERE id=?', [uncertainClaim.id]);
    assert.ok(uncertainRows[0].dead_lettered_at);
    assert.equal(uncertainRows[0].last_error_code, 'delivery_uncertain');
    await workflows.reconcileJob(username, uncertainClaim.id, 'cancel');
    const [cancelledUncertainRows] = await pool.query('SELECT cancelled_at,payload FROM scheduler_jobs WHERE id=?', [uncertainClaim.id]);
    assert.ok(cancelledUncertainRows[0].cancelled_at);
    assert.equal(cancelledUncertainRows[0].payload, '{}');

    await pool.query("UPDATE scheduler_private_links SET expires_at='2020-07-01 00:00:00.000' WHERE event_type_id=? AND revoked_at IS NULL", [event.id]);
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

    await pool.query('UPDATE scheduler_jobs SET available_at=UTC_TIMESTAMP(3) WHERE id=?', [activeJobs[2].id]);
    const cancelInFlightClaim = (await jobs.claimBatch('phase3-worker-7', 1, new Date(0)))[0];
    await jobs.beginAttempt(cancelInFlightClaim.id, 'phase3-worker-7', 'test-provider');
    await store.cancelBookingByToken(booking.cancelToken);
    const [cancelled] = await pool.query('SELECT status FROM scheduler_bookings WHERE id=?', [booking.id]);
    assert.equal(cancelled[0].status, 'cancelled');
    const [remaining] = await pool.query('SELECT uid FROM events WHERE calendar_id=? AND uid=?', [
        calendarId, `scheduler-${booking.id}@openmailstack`,
    ]);
    assert.equal(remaining.length, 0);
    const [tombstones] = await pool.query('SELECT uid FROM calendar_tombstones WHERE calendar_id=? AND uid=?', [calendarId, `scheduler-${booking.id}@openmailstack`]);
    assert.equal(tombstones.length, 1);
    const [cancelledWorkflowJobs] = await pool.query(
        'SELECT cancelled_at,payload FROM scheduler_jobs WHERE id IN (?,?) ORDER BY id', [activeJobs[2].id, activeJobs[3].id]
    );
    assert.equal(cancelledWorkflowJobs.length, 2);
    assert.equal(cancelledWorkflowJobs.every(row => row.cancelled_at && row.payload === '{}'), true,
        'cancellation must stop every pending reminder in the current generation');
    const [cancelledAttemptRows] = await pool.query(
        'SELECT outcome,error_code FROM scheduler_delivery_attempts WHERE job_id=?', [cancelInFlightClaim.id]
    );
    assert.deepEqual([cancelledAttemptRows[0].outcome, cancelledAttemptRows[0].error_code],
        ['dead_lettered', 'delivery_uncertain_cancelled'], 'in-flight cancellation must remain observably uncertain');

    const singleUseLink = await store.rotatePrivateLink(username, event.id, null, true);
    assert.equal(singleUseLink.state.singleUse, true);
    assert.equal(singleUseLink.state.remainingUses, 1);
    const singleUseInputs = [
        {
            eventTypeId: event.id,
            start: new Date('2054-08-10T16:00:00.000Z'),
            bookerTimeZone: 'America/Phoenix',
            bookerName: 'Single Use One',
            bookerEmail: 'single-one@example.net',
            idempotencyKey: 'phase1-single-use-race-0001',
            privateAccessToken: singleUseLink.token,
        },
        {
            eventTypeId: event.id,
            start: new Date('2054-08-10T16:30:00.000Z'),
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

    const oneOffDateValue = new Date();
    oneOffDateValue.setUTCDate(oneOffDateValue.getUTCDate() + ((8 - oneOffDateValue.getUTCDay()) % 7) + 14);
    const oneOffDate = oneOffDateValue.toISOString().slice(0, 10);
    const oneOffCompactDate = oneOffDate.replaceAll('-', '');
    const oneOffTime = (time) => `${oneOffDate}T${time}:00.000Z`;
    const oneOffLink = await store.rotatePrivateLink(username, event.id, null, false, {
        timeZone: 'America/Phoenix',
        windows: [{ date: oneOffDate, startMinute: 660, endMinute: 720 }],
    });
    assert.equal(oneOffLink.state.oneOff, true);
    assert.equal(oneOffLink.state.singleUse, true, 'one-off links must always be single-use');
    assert.deepEqual(oneOffLink.state.oneOffWindows, [{ date: oneOffDate, startMinute: 660, endMinute: 720 }]);
    await pool.query(
        `INSERT INTO events (calendar_id, uid, ical_data) VALUES (?, 'one-off-busy-test', ?)
         ON DUPLICATE KEY UPDATE ical_data=VALUES(ical_data)`,
        [calendarId, `BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nUID:one-off-busy-test\r\nDTSTART:${oneOffCompactDate}T180000Z\r\nDTEND:${oneOffCompactDate}T183000Z\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`]
    );
    const oneOffSlotsWithConflict = await store.listSlots(
        'phase1', event.slug, new Date(oneOffTime('15:00')), new Date(oneOffTime('20:00')), oneOffLink.token
    );
    assert.deepEqual(oneOffSlotsWithConflict.map(slot => slot.start.toISOString()), [oneOffTime('18:30')]);
    await pool.query("DELETE FROM events WHERE calendar_id=? AND uid='one-off-busy-test'", [calendarId]);
    const oneOffSlots = await store.listSlots(
        'phase1', event.slug, new Date(oneOffTime('15:00')), new Date(oneOffTime('20:00')), oneOffLink.token
    );
    assert.deepEqual(oneOffSlots.map(slot => slot.start.toISOString()), [
        oneOffTime('18:00'),
        oneOffTime('18:30'),
    ], 'one-off windows must replace the recurring event schedule');
    await assert.rejects(() => store.createBooking('phase1', event.slug, {
        eventTypeId: event.id,
        start: new Date(oneOffTime('17:30')),
        bookerTimeZone: 'America/Phoenix',
        bookerName: 'Outside One Off',
        bookerEmail: 'outside-one-off@example.net',
        idempotencyKey: 'phase1-one-off-outside-0001',
        privateAccessToken: oneOffLink.token,
    }), /no longer available/);
    assert.equal((await store.getPrivateLinkState(username, event.id)).remainingUses, 1, 'failed one-off booking must preserve the use');
    const oneOffBookingInput = {
        eventTypeId: event.id,
        start: new Date(oneOffTime('18:00')),
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
    assert.deepEqual(JSON.parse(storedOneOffLinks[0].one_off_windows), [{ date: oneOffDate, startMinute: 660, endMinute: 720 }]);
    assert.equal(storedOneOffLinks[0].uses_remaining, 0);
    await store.cancelBookingByToken(oneOffBooking.cancelToken);

    const limitedEvent = await store.saveEventType(username, {
        title: 'Limited Booking', slug: 'limited-booking', durationMinutes: 30, intervalMinutes: 30,
        minimumNoticeMinutes: 0, destinationCalendarId: calendarId, conflictCalendarIds: [calendarId],
        activeBookingLimit: 1,
    });
    const limitedLegacy = await store.saveEventType(username, {
        ...limitedEvent, title: 'Limited Booking Updated', activeBookingLimit: undefined,
    }, limitedEvent.id);
    assert.equal(limitedLegacy.activeBookingLimit, 1, 'older clients must preserve active booking limits');
    const limitedInputs = [
        {
            eventTypeId: limitedEvent.id, start: new Date('2054-07-22T16:00:00.000Z'), bookerTimeZone: 'America/Phoenix',
            bookerName: 'Limited Guest', bookerEmail: 'limited@example.net', idempotencyKey: 'phase2-active-limit-0001',
        },
        {
            eventTypeId: limitedEvent.id, start: new Date('2054-07-22T16:30:00.000Z'), bookerTimeZone: 'America/Phoenix',
            bookerName: 'Limited Guest', bookerEmail: 'limited@example.net', idempotencyKey: 'phase2-active-limit-0002',
        },
    ];
    const limitedRace = await Promise.allSettled(limitedInputs.map(input => store.createBooking('phase1', limitedEvent.slug, input)));
    const limitedWinners = limitedRace.map((result, index) => ({ result, index })).filter(item => item.result.status === 'fulfilled');
    assert.equal(limitedWinners.length, 1, 'the per-email mutex must serialize simultaneous active-limit checks');
    assert.match(limitedRace.find(result => result.status === 'rejected').reason.message, /maximum active bookings.*manage or reschedule/);
    const limitedWinner = limitedWinners[0].result.value;
    const limitedReplay = await store.createBooking('phase1', limitedEvent.slug, limitedInputs[limitedWinners[0].index]);
    assert.equal(limitedReplay.id, limitedWinner.id);
    assert.equal(limitedReplay.idempotentReplay, true);
    await store.cancelBookingByToken(limitedWinner.cancelToken);
    const limitedLoserIndex = limitedWinners[0].index === 0 ? 1 : 0;
    const limitedSlotsAfterCancel = await store.listSlots(
        'phase1', limitedEvent.slug, new Date('2054-07-22T15:59:59.999Z'), new Date('2054-07-22T17:00:00.001Z')
    );
    assert.equal(
        limitedSlotsAfterCancel.some(slot => slot.start.getTime() === limitedInputs[limitedLoserIndex].start.getTime()),
        true,
        'cancelling the winner must restore the losing slot after the active-limit race'
    );
    const limitedAfterCancel = await store.createBooking('phase1', limitedEvent.slug, limitedInputs[limitedLoserIndex]);
    assert.equal(limitedAfterCancel.status, 'confirmed', 'cancellation must release the active-booking allowance');
    await store.cancelBookingByToken(limitedAfterCancel.cancelToken);

    const guestEvent = await store.saveEventType(username, {
        title: 'Guest Rules', slug: 'guest-rules', durationMinutes: 30, intervalMinutes: 30,
        minimumNoticeMinutes: 0, destinationCalendarId: calendarId, conflictCalendarIds: [calendarId],
        capacity: 3, maxAdditionalGuests: 2,
        guestAllowList: ['vip@outside.example', '@allowed.example'],
        guestDenyList: ['blocked@allowed.example', '@denied.example'],
    });
    assert.deepEqual(guestEvent.guestAllowList, ['vip@outside.example', '@allowed.example']);
    await assert.rejects(() => store.createBooking('phase1', guestEvent.slug, {
        eventTypeId: guestEvent.id, start: new Date('2054-07-23T16:00:00.000Z'), bookerTimeZone: 'America/Phoenix',
        bookerName: 'Outside Guest', bookerEmail: 'outside@example.net', idempotencyKey: 'phase2-guest-outside-0001',
    }), /not eligible/);
    await assert.rejects(() => store.createBooking('phase1', guestEvent.slug, {
        eventTypeId: guestEvent.id, start: new Date('2054-07-23T16:00:00.000Z'), bookerTimeZone: 'America/Phoenix',
        bookerName: 'Allowed Guest', bookerEmail: 'owner@allowed.example', seats: 2,
        attendees: [{ name: 'Blocked', email: 'blocked@allowed.example' }], idempotencyKey: 'phase2-guest-denied-0001',
    }), /not eligible/);
    await assert.rejects(() => store.createBooking('phase1', guestEvent.slug, {
        eventTypeId: guestEvent.id, start: new Date('2054-07-23T16:00:00.000Z'), bookerTimeZone: 'America/Phoenix',
        bookerName: 'Allowed Guest', bookerEmail: 'owner@allowed.example', seats: 1,
        attendees: [{ name: 'Grace', email: 'grace@allowed.example' }], idempotencyKey: 'phase2-guest-seat-mismatch-0001',
    }), /Seats must include/);
    const guestBooking = await store.createBooking('phase1', guestEvent.slug, {
        eventTypeId: guestEvent.id, start: new Date('2054-07-23T16:00:00.000Z'), bookerTimeZone: 'America/Phoenix',
        bookerName: 'Allowed Guest', bookerEmail: 'vip@outside.example', seats: 3,
        attendees: [{ name: 'Grace', email: 'grace@allowed.example' }, { name: '', email: 'linus@allowed.example' }],
        idempotencyKey: 'phase2-guest-success-0001',
    });
    const guestOwnerBooking = (await store.listBookings(username, 'upcoming')).find(item => item.id === guestBooking.id);
    assert.equal(guestOwnerBooking.seats, 3);
    assert.deepEqual(guestOwnerBooking.attendees.map(item => item.email), ['grace@allowed.example', 'linus@allowed.example']);
    const [guestProjection] = await pool.query('SELECT ical_data FROM events WHERE uid=?', [`scheduler-${guestBooking.id}@openmailstack`]);
    assert.match(guestProjection[0].ical_data, /ATTENDEE;CN=Grace:mailto:grace@allowed\.example/);
    assert.match(guestProjection[0].ical_data, /ATTENDEE;CN=linus@allowed\.example:mailto:linus@allowed\.example/);
    const [guestOutbox] = await pool.query("SELECT payload FROM scheduler_outbox WHERE aggregate_id=? AND event_type='booking.confirmed'", [guestBooking.id]);
    const guestPayload = JSON.parse(guestOutbox[0].payload);
    assert.equal(guestPayload.seats, 3);
    assert.equal(guestPayload.additionalAttendees.length, 2);
    await store.cancelBookingByToken(guestBooking.cancelToken);

    const verificationEvent = await store.saveEventType(username, {
        title: 'Verified Booking', slug: 'verified-booking', durationMinutes: 30, intervalMinutes: 30,
        minimumNoticeMinutes: 0, destinationCalendarId: calendarId, conflictCalendarIds: [calendarId],
        requireEmailVerification: true,
    });
    const challenge = await store.requestEmailVerification('phase1', verificationEvent.slug, 'verified@example.net');
    const [verificationJobs] = await pool.query("SELECT payload FROM scheduler_outbox WHERE aggregate_id=? AND event_type='booking.verification'", [challenge.challengeId]);
    const verificationCode = JSON.parse(verificationJobs[0].payload).verificationCode;
    const verificationInput = {
        eventTypeId: verificationEvent.id, start: new Date('2054-07-24T16:00:00.000Z'), bookerTimeZone: 'America/Phoenix',
        bookerName: 'Verified Guest', bookerEmail: 'verified@example.net', idempotencyKey: 'phase2-verification-0001',
        verificationChallengeId: challenge.challengeId, verificationCode,
    };
    await assert.rejects(() => store.createBooking('phase1', verificationEvent.slug, {
        ...verificationInput, verificationCode: 'WRONG-CODE', idempotencyKey: 'phase2-verification-wrong-0001',
    }), /valid email verification code/);
    const [attemptRows] = await pool.query('SELECT attempts, used_at FROM scheduler_email_verifications WHERE id=?', [challenge.challengeId]);
    assert.equal(Number(attemptRows[0].attempts), 1);
    assert.equal(attemptRows[0].used_at, null);
    const verifiedBooking = await store.createBooking('phase1', verificationEvent.slug, verificationInput);
    const [usedVerification] = await pool.query('SELECT used_at FROM scheduler_email_verifications WHERE id=?', [challenge.challengeId]);
    assert.ok(usedVerification[0].used_at);
    const verifiedReplay = await store.createBooking('phase1', verificationEvent.slug, verificationInput);
    assert.equal(verifiedReplay.id, verifiedBooking.id);
    assert.equal(verifiedReplay.idempotentReplay, true);
    await assert.rejects(() => store.createBooking('phase1', verificationEvent.slug, {
        ...verificationInput, start: new Date('2054-07-24T16:30:00.000Z'), idempotencyKey: 'phase2-verification-reuse-0001',
    }), /valid email verification code/);
    await store.cancelBookingByToken(verifiedBooking.cancelToken);

    const seatsEvent = await store.saveEventType(username, {
        title: 'Seat Capacity', slug: 'seat-capacity', durationMinutes: 30, intervalMinutes: 30,
        minimumNoticeMinutes: 0, destinationCalendarId: calendarId, conflictCalendarIds: [calendarId], capacity: 3,
    });
    const seatStart = new Date('2054-07-27T16:00:00.000Z');
    const seatBookingTwo = await store.createBooking('phase1', seatsEvent.slug, {
        eventTypeId: seatsEvent.id, start: seatStart, bookerTimeZone: 'America/Phoenix',
        bookerName: 'Two Seats', bookerEmail: 'two-seats@example.net', seats: 2, idempotencyKey: 'phase2-seats-two-0001',
    });
    const afterTwoSeats = await store.listSlots('phase1', seatsEvent.slug, new Date(seatStart.getTime() - 1), new Date(seatStart.getTime() + 31 * 60 * 1000));
    assert.equal(afterTwoSeats.find(slot => slot.start.getTime() === seatStart.getTime()).remainingSeats, 1);
    await assert.rejects(() => store.createBooking('phase1', seatsEvent.slug, {
        eventTypeId: seatsEvent.id, start: seatStart, bookerTimeZone: 'America/Phoenix',
        bookerName: 'Too Many Seats', bookerEmail: 'too-many@example.net', seats: 2, idempotencyKey: 'phase2-seats-overflow-0001',
    }), /capacity|no longer available/i);
    const seatBookingOne = await store.createBooking('phase1', seatsEvent.slug, {
        eventTypeId: seatsEvent.id, start: seatStart, bookerTimeZone: 'America/Phoenix',
        bookerName: 'One Seat', bookerEmail: 'one-seat@example.net', seats: 1, idempotencyKey: 'phase2-seats-one-0001',
    });
    const fullSeatSlots = await store.listSlots('phase1', seatsEvent.slug, new Date(seatStart.getTime() - 1), new Date(seatStart.getTime() + 31 * 60 * 1000));
    assert.equal(fullSeatSlots.some(slot => slot.start.getTime() === seatStart.getTime()), false);
    await store.cancelBookingByToken(seatBookingTwo.cancelToken);
    const restoredSeatSlots = await store.listSlots('phase1', seatsEvent.slug, new Date(seatStart.getTime() - 1), new Date(seatStart.getTime() + 31 * 60 * 1000));
    assert.equal(restoredSeatSlots.find(slot => slot.start.getTime() === seatStart.getTime()).remainingSeats, 2);
    const seatRescheduleStarts = [new Date('2054-07-27T16:30:00.000Z'), new Date('2054-07-27T17:00:00.000Z')];
    const seatRescheduleRace = await Promise.allSettled(
        seatRescheduleStarts.map(candidate => store.rescheduleBookingByToken(seatBookingOne.rescheduleToken, candidate))
    );
    assert.equal(seatRescheduleRace.filter(result => result.status === 'fulfilled').length, 1, 'concurrent reschedules must produce one destination');
    const seatRescheduleWinner = seatRescheduleRace.find(result => result.status === 'fulfilled').value.start;
    const seatRescheduleLoser = seatRescheduleStarts.find(candidate => candidate.getTime() !== seatRescheduleWinner.getTime());
    const oldSeatSlots = await store.listSlots('phase1', seatsEvent.slug, new Date(seatStart.getTime() - 1), new Date(seatStart.getTime() + 31 * 60 * 1000));
    assert.equal(oldSeatSlots.find(slot => slot.start.getTime() === seatStart.getTime()).remainingSeats, 3);
    const newSeatSlots = await store.listSlots('phase1', seatsEvent.slug, new Date(seatRescheduleWinner.getTime() - 1), new Date(seatRescheduleWinner.getTime() + 31 * 60 * 1000));
    assert.equal(newSeatSlots.find(slot => slot.start.getTime() === seatRescheduleWinner.getTime()).remainingSeats, 2);
    const losingSeatSlots = await store.listSlots('phase1', seatsEvent.slug, new Date(seatRescheduleLoser.getTime() - 1), new Date(seatRescheduleLoser.getTime() + 31 * 60 * 1000));
    assert.equal(losingSeatSlots.find(slot => slot.start.getTime() === seatRescheduleLoser.getTime()).remainingSeats, 3);
    await store.cancelBookingByToken(seatBookingOne.cancelToken);

    const phase2Availability = await store.saveDefaultAvailability(username, {
        ...(await store.getDefaultAvailability(username)),
        exclusions: [
            { kind: 'holiday', startDate: '2054-09-01', endDate: '2054-09-01', label: 'Company holiday' },
            { kind: 'out_of_office', startDate: '2054-09-02', endDate: '2054-09-03', label: 'Conference' },
        ],
    });
    assert.deepEqual(phase2Availability.exclusions.map(item => item.kind), ['holiday', 'out_of_office']);
    const exclusionEvent = await store.saveEventType(username, {
        title: 'Exclusion Test', slug: 'exclusion-test', durationMinutes: 30, intervalMinutes: 30,
        minimumNoticeMinutes: 0, destinationCalendarId: calendarId, conflictCalendarIds: [calendarId],
    });
    const exclusionSlots = await store.listSlots(
        'phase1', exclusionEvent.slug, new Date('2054-09-01T16:00:00.000Z'), new Date('2054-09-01T18:00:00.000Z')
    );
    assert.equal(exclusionSlots.length, 0, 'holidays must block inherited availability');

    const phase2Event = await store.saveEventType(username, {
        title: 'Phase 2 Complete', slug: 'phase-2-complete', durationMinutes: 30, intervalMinutes: 30,
        minimumNoticeMinutes: 0, destinationCalendarId: calendarId, conflictCalendarIds: [calendarId], capacity: 2,
        waitlistEnabled: true, maxRecurrenceOccurrences: 4, publicAccentColor: '#aa3377',
        publicIntro: 'A localized public booking page', privacyUrl: 'https://example.test/privacy',
        termsUrl: 'https://example.test/terms', locale: 'fr', lockedTimeZone: 'America/Phoenix',
    });
    assert.equal(phase2Event.waitlistEnabled, true);
    assert.equal(phase2Event.maxRecurrenceOccurrences, 4);
    assert.equal(phase2Event.publicAccentColor, '#aa3377');
    assert.equal(phase2Event.locale, 'fr');
    assert.equal(phase2Event.lockedTimeZone, 'America/Phoenix');
    const phase2Legacy = await store.saveEventType(username, {
        ...phase2Event, title: 'Phase 2 Complete Updated', waitlistEnabled: undefined,
        maxRecurrenceOccurrences: undefined, publicAccentColor: undefined, publicIntro: undefined,
        privacyUrl: undefined, termsUrl: undefined, locale: undefined, lockedTimeZone: undefined,
    }, phase2Event.id);
    assert.equal(phase2Legacy.waitlistEnabled, true, 'older clients must preserve waitlist policy');
    assert.equal(phase2Legacy.maxRecurrenceOccurrences, 4, 'older clients must preserve recurrence policy');
    assert.equal(phase2Legacy.publicAccentColor, '#aa3377', 'older clients must preserve public customization');
    assert.equal(phase2Legacy.lockedTimeZone, 'America/Phoenix', 'older clients must preserve timezone locks');
    await assert.rejects(() => store.createBooking('phase1', phase2Event.slug, {
        eventTypeId: phase2Event.id, start: new Date('2054-08-07T16:00:00.000Z'), bookerTimeZone: 'Europe/Paris',
        bookerName: 'Wrong Zone', bookerEmail: 'wrong-zone@example.net', idempotencyKey: 'phase2-locked-zone-wrong-0001',
    }), /requires the America\/Phoenix time zone/);
    const attributedBooking = await store.createBooking('phase1', phase2Event.slug, {
        eventTypeId: phase2Event.id, start: new Date('2054-08-07T16:00:00.000Z'), bookerTimeZone: 'America/Phoenix',
        bookerName: '=Campaign Guest', bookerEmail: 'campaign@example.net', idempotencyKey: 'phase2-attribution-0001',
        attribution: { utm_source: 'newsletter', utm_campaign: 'phase-two', ignored: 'drop-me' },
    });
    const attributedOwnerBooking = (await store.listBookings(username, 'upcoming')).find(item => item.id === attributedBooking.id);
    assert.deepEqual(attributedOwnerBooking.attribution, { utm_source: 'newsletter', utm_campaign: 'phase-two' });

    const waitlistEvent = await store.saveEventType(username, {
        title: 'Waitlist Test', slug: 'waitlist-test', durationMinutes: 30, intervalMinutes: 30,
        minimumNoticeMinutes: 0, destinationCalendarId: calendarId, conflictCalendarIds: [calendarId],
        capacity: 1, waitlistEnabled: true,
    });
    const waitlistStart = new Date('2054-08-04T16:00:00.000Z');
    const capacityBooking = await store.createBooking('phase1', waitlistEvent.slug, {
        eventTypeId: waitlistEvent.id, start: waitlistStart, bookerTimeZone: 'America/Phoenix',
        bookerName: 'Capacity Guest', bookerEmail: 'capacity@example.net', idempotencyKey: 'phase2-waitlist-capacity-0001',
    });
    const fullWaitlistSlots = await store.listSlots(
        'phase1', waitlistEvent.slug, new Date(waitlistStart.getTime() - 1), new Date(waitlistStart.getTime() + 31 * 60 * 1000), '', true
    );
    assert.equal(fullWaitlistSlots.find(slot => slot.start.getTime() === waitlistStart.getTime()).remainingSeats, 0);
    const waitlistEntry = await store.joinWaitlist('phase1', waitlistEvent.slug, {
        eventTypeId: waitlistEvent.id, start: waitlistStart, bookerTimeZone: 'America/Phoenix',
        bookerName: 'Waiting Guest', bookerEmail: 'waiting@example.net', idempotencyKey: 'phase2-waitlist-entry-0001',
    });
    assert.equal(waitlistEntry.status, 'pending');
    assert.equal((await store.joinWaitlist('phase1', waitlistEvent.slug, {
        eventTypeId: waitlistEvent.id, start: waitlistStart, bookerTimeZone: 'America/Phoenix',
        bookerName: 'Waiting Guest', bookerEmail: 'waiting@example.net', idempotencyKey: 'phase2-waitlist-entry-0001',
    })).idempotentReplay, true);
    await assert.rejects(() => store.joinWaitlist('phase1', waitlistEvent.slug, {
        eventTypeId: waitlistEvent.id, start: waitlistStart, bookerTimeZone: 'America/Phoenix',
        bookerName: 'Another Guest', bookerEmail: 'another@example.net', idempotencyKey: 'phase2-waitlist-entry-0001',
    }), /already used for another waitlist request/);
    await store.cancelBookingByToken(capacityBooking.cancelToken);
    const promotedEntry = (await store.listWaitlist(username)).find(item => item.id === waitlistEntry.id);
    assert.equal(promotedEntry.status, 'promoted', 'cancellation must promote the oldest fitting waitlist party');
    assert.ok(promotedEntry.promoted_booking_id);
    const [waitlistOutbox] = await pool.query("SELECT COUNT(*) AS total FROM scheduler_outbox WHERE aggregate_id=? AND event_type='waitlist.joined'", [waitlistEntry.id]);
    assert.equal(Number(waitlistOutbox[0].total), 1);

    const policyWaitlistEvent = await store.saveEventType(username, {
        title: 'Policy Waitlist Test', slug: 'policy-waitlist-test', durationMinutes: 30, intervalMinutes: 30,
        minimumNoticeMinutes: 0, destinationCalendarId: calendarId, conflictCalendarIds: [calendarId],
        capacity: 1, waitlistEnabled: true,
    });
    const policyWaitlistStart = new Date('2054-08-11T16:00:00.000Z');
    const policyCapacityBooking = await store.createBooking('phase1', policyWaitlistEvent.slug, {
        eventTypeId: policyWaitlistEvent.id, start: policyWaitlistStart, bookerTimeZone: 'America/Phoenix',
        bookerName: 'Policy Capacity Guest', bookerEmail: 'policy-capacity@example.net', idempotencyKey: 'phase2-policy-waitlist-capacity-0001',
    });
    const unverifiedPolicyEntry = await store.joinWaitlist('phase1', policyWaitlistEvent.slug, {
        eventTypeId: policyWaitlistEvent.id, start: policyWaitlistStart, bookerTimeZone: 'America/Phoenix',
        bookerName: 'Unverified Waiting Guest', bookerEmail: 'unverified-waiting@example.net', idempotencyKey: 'phase2-policy-waitlist-unverified-0001',
    });
    const verificationRequiredWaitlistEvent = await store.saveEventType(username, {
        ...policyWaitlistEvent, requireEmailVerification: true,
    }, policyWaitlistEvent.id);
    const policyChallenge = await store.requestEmailVerification('phase1', verificationRequiredWaitlistEvent.slug, 'verified-waiting@example.net');
    const [policyVerificationJobs] = await pool.query(
        "SELECT payload FROM scheduler_outbox WHERE aggregate_id=? AND event_type='booking.verification'",
        [policyChallenge.challengeId]
    );
    const policyVerificationCode = JSON.parse(policyVerificationJobs[0].payload).verificationCode;
    const verifiedPolicyEntry = await store.joinWaitlist('phase1', verificationRequiredWaitlistEvent.slug, {
        eventTypeId: verificationRequiredWaitlistEvent.id, start: policyWaitlistStart, bookerTimeZone: 'America/Phoenix',
        bookerName: 'Verified Waiting Guest', bookerEmail: 'verified-waiting@example.net', idempotencyKey: 'phase2-policy-waitlist-verified-0001',
        verificationChallengeId: policyChallenge.challengeId, verificationCode: policyVerificationCode,
    });
    await store.cancelBookingByToken(policyCapacityBooking.cancelToken);
    const policyWaitlist = await store.listWaitlist(username);
    assert.equal(policyWaitlist.find(item => item.id === unverifiedPolicyEntry.id).status, 'failed', 'new verification policy must reject an older unverified waitlist entry');
    assert.equal(policyWaitlist.find(item => item.id === verifiedPolicyEntry.id).status, 'promoted', 'promotion must continue to the oldest eligible fitting party');

    const attendeePolicyEvent = await store.saveEventType(username, {
        title: 'Attendee Policy Waitlist Test', slug: 'attendee-policy-waitlist-test', durationMinutes: 30, intervalMinutes: 30,
        minimumNoticeMinutes: 0, destinationCalendarId: calendarId, conflictCalendarIds: [calendarId],
        capacity: 3, maxAdditionalGuests: 1, waitlistEnabled: true,
    });
    const attendeePolicyStart = new Date('2054-08-18T16:00:00.000Z');
    const attendeeCapacityBooking = await store.createBooking('phase1', attendeePolicyEvent.slug, {
        eventTypeId: attendeePolicyEvent.id, start: attendeePolicyStart, bookerTimeZone: 'America/Phoenix',
        bookerName: 'Attendee Capacity Guest', bookerEmail: 'attendee-capacity@example.net', seats: 3,
        idempotencyKey: 'phase2-attendee-policy-capacity-0001',
    });
    const attendeePolicyEntry = await store.joinWaitlist('phase1', attendeePolicyEvent.slug, {
        eventTypeId: attendeePolicyEvent.id, start: attendeePolicyStart, bookerTimeZone: 'America/Phoenix',
        bookerName: 'Waiting Party', bookerEmail: 'waiting-party@example.net', seats: 2,
        attendees: [{ name: 'Waiting Guest', email: 'waiting-guest@example.net' }],
        idempotencyKey: 'phase2-attendee-policy-party-0001',
    });
    const singleSeatPolicyEntry = await store.joinWaitlist('phase1', attendeePolicyEvent.slug, {
        eventTypeId: attendeePolicyEvent.id, start: attendeePolicyStart, bookerTimeZone: 'America/Phoenix',
        bookerName: 'Single Waiting Guest', bookerEmail: 'single-waiting@example.net', seats: 1,
        idempotencyKey: 'phase2-attendee-policy-single-0001',
    });
    await store.saveEventType(username, { ...attendeePolicyEvent, maxAdditionalGuests: 0 }, attendeePolicyEvent.id);
    await store.cancelBookingByToken(attendeeCapacityBooking.cancelToken);
    const attendeePolicyWaitlist = await store.listWaitlist(username);
    assert.equal(attendeePolicyWaitlist.find(item => item.id === attendeePolicyEntry.id).status, 'failed', 'new attendee policy must reject an older oversized party');
    assert.equal(attendeePolicyWaitlist.find(item => item.id === singleSeatPolicyEntry.id).status, 'promoted', 'attendee-policy rejection must not block the next eligible fitting party');

    const phase2Store = new SchedulerPhase2Store(pool, store);
    const pollEvent = await store.saveEventType(username, {
        title: 'Verified Poll', slug: 'verified-poll', durationMinutes: 30, intervalMinutes: 30,
        minimumNoticeMinutes: 0, destinationCalendarId: calendarId, conflictCalendarIds: [calendarId],
        capacity: 3, maxAdditionalGuests: 2, requireEmailVerification: true,
    });
    const noShowWorkflow = await workflows.createWorkflow({
        tenantKey: entitlement.tenantKey, ownerUsername: username, name: 'No-show owner alert',
        enabled: true, eventTypeIds: [pollEvent.id],
    });
    await workflows.publishVersion(noShowWorkflow.id, username, {
        trigger: { type: 'booking.no_show', offsetSeconds: 0 },
        steps: [{ action: 'notification.in_app', delaySeconds: 0, config: {
            title: 'No-show: {{event.title}}', body: '{{booker.name}} did not attend.',
        } }],
    });
    const poll = await phase2Store.createPoll(username, {
        eventTypeId: pollEvent.id, title: 'Choose our meeting',
        starts: ['2054-08-05T16:00:00.000Z', '2054-08-05T16:30:00.000Z'],
    });
    const publicPoll = await phase2Store.getPublicPoll(poll.token);
    assert.equal(publicPoll.requireEmailVerification, true);
    assert.equal(publicPoll.options.length, 2);
    const pollChallenge = await phase2Store.requestPollVerification(poll.token, 'voter@example.net');
    const [pollVerificationJobs] = await pool.query(
        "SELECT payload FROM scheduler_outbox WHERE aggregate_id=? AND event_type='booking.verification'", [pollChallenge.challengeId]
    );
    const pollVerificationCode = JSON.parse(pollVerificationJobs[0].payload).verificationCode;
    await assert.rejects(() => phase2Store.votePoll(poll.token, {
        voterName: 'Verified Voter', voterEmail: 'voter@example.net', optionIds: [publicPoll.options[0].id],
        verificationChallengeId: pollChallenge.challengeId, verificationCode: 'WRONG-CODE',
    }), /valid email verification code/);
    const [pollAttemptRows] = await pool.query('SELECT attempts FROM scheduler_email_verifications WHERE id=?', [pollChallenge.challengeId]);
    assert.equal(Number(pollAttemptRows[0].attempts), 1, 'invalid poll verification codes must consume an attempt');
    await phase2Store.votePoll(poll.token, {
        voterName: 'Verified Voter', voterEmail: 'voter@example.net', optionIds: [publicPoll.options[0].id],
        verificationChallengeId: pollChallenge.challengeId, verificationCode: pollVerificationCode,
    });
    const finalizedPollBooking = await phase2Store.finalizePoll(username, poll.id, publicPoll.options[0].id);
    assert.equal(finalizedPollBooking.status, 'confirmed');
    const finalizedPoll = (await phase2Store.listPolls(username)).find(item => item.id === poll.id);
    assert.equal(finalizedPoll.status, 'finalized');
    assert.equal(finalizedPoll.options.find(item => item.id === publicPoll.options[0].id).votes, 1);
    const finalizedOwnerBooking = (await store.listBookings(username, 'upcoming')).find(item => item.id === finalizedPollBooking.id);
    assert.equal(finalizedOwnerBooking.bookedByUsername, username, 'poll finalization must use the trusted owner booking path');
    await assert.rejects(() => store.markBookingOutcome(username, finalizedPollBooking.id, 'no_show'), /only after it ends/);
    await pool.query(
        "UPDATE scheduler_bookings SET slot_start='2020-01-01 00:00:00.000', slot_end='2020-01-01 00:30:00.000' WHERE id=?",
        [finalizedPollBooking.id]
    );
    await store.markBookingOutcome(username, finalizedPollBooking.id, 'no_show');
    const [outcomeRows] = await pool.query('SELECT status,no_show_at FROM scheduler_bookings WHERE id=?', [finalizedPollBooking.id]);
    assert.equal(outcomeRows[0].status, 'no_show');
    assert.ok(outcomeRows[0].no_show_at);
    const [noShowJobs] = await pool.query(
        `SELECT j.job_type,j.payload FROM scheduler_jobs j
         JOIN scheduler_workflow_versions v ON v.id=j.workflow_version_id
         WHERE j.booking_id=? AND v.workflow_id=?`,
        [finalizedPollBooking.id, noShowWorkflow.id]
    );
    assert.equal(noShowJobs.length, 1, 'no-show must enqueue the captured lifecycle workflow');
    assert.equal(noShowJobs[0].job_type, 'notification.in_app');
    assert.equal(JSON.parse(noShowJobs[0].payload).bookerEmail, 'voter@example.net');

    const delegatedBooking = await store.bookOnBehalf(username, phase2Event.id, {
        start: new Date('2054-08-06T16:00:00.000Z'), bookerTimeZone: 'UTC',
        bookerName: 'Delegated Guest', bookerEmail: 'delegated@example.net', idempotencyKey: 'phase2-delegated-0001',
    });
    const delegatedOwnerBooking = (await store.listBookings(username, 'upcoming')).find(item => item.id === delegatedBooking.id);
    assert.equal(delegatedOwnerBooking.bookedByUsername, username);
    assert.equal(delegatedOwnerBooking.bookerTimeZone, 'America/Phoenix', 'timezone-locked events must also constrain delegated bookings');

    const exported = await phase2Store.exportOwnerData(username);
    assert.equal(exported.schema, 'openmailstack.scheduler');
    assert.equal(exported.events.some(item => item.id === phase2Event.id), true);
    const bookingCsv = await phase2Store.exportBookingsCsv(username);
    assert.match(bookingCsv, /newsletter/);
    assert.match(bookingCsv, /phase-two/);
    assert.match(bookingCsv, /"'=Campaign Guest"/, 'CSV exports must neutralize spreadsheet formulas');
    const importResult = await phase2Store.importOwnerData(username, 'calendly', {
        event_types: [{ name: 'Imported Calendly Intro', slug: 'imported-calendly-intro', duration: 45, description: 'Review before publishing' }],
    });
    assert.deepEqual({ source: importResult.source, imported: importResult.imported, skipped: importResult.skipped }, {
        source: 'calendly', imported: 1, skipped: 0,
    });
    const importedEvent = (await store.listEventTypes(username)).find(item => item.slug === 'imported-calendly-intro');
    assert.equal(importedEvent.active, false, 'migrated event types must remain drafts');
    assert.equal(importedEvent.visibility, 'unlisted', 'migrated event types must not publish automatically');

    await store.updateProfile(username, { timeZone: 'America/New_York' });
    await store.saveDefaultAvailability(username, {
        ...(await store.getDefaultAvailability(username)), timeZone: 'America/New_York', exclusions: [],
    });
    const recurringEvent = await store.saveEventType(username, {
        title: 'DST Series', slug: 'dst-series', durationMinutes: 30, intervalMinutes: 30,
        minimumNoticeMinutes: 0, destinationCalendarId: calendarId, conflictCalendarIds: [calendarId],
        maxRecurrenceOccurrences: 3,
    });
    const recurring = await store.createRecurringBooking('phase1', recurringEvent.slug, {
        eventTypeId: recurringEvent.id, start: new Date('2054-10-26T13:00:00.000Z'), bookerTimeZone: 'America/New_York',
        bookerName: 'Recurring Guest', bookerEmail: 'recurring@example.net', idempotencyKey: 'phase2-recurring-dst-0001',
        recurrenceCount: 3,
    });
    assert.equal(recurring.recurrenceCount, 3);
    assert.deepEqual(recurring.bookings.map(item => item.start.toISOString()), [
        '2054-10-26T13:00:00.000Z', '2054-11-02T14:00:00.000Z', '2054-11-09T14:00:00.000Z',
    ], 'weekly series must preserve the host-local time across DST');
    const recurringReplayInput = {
        eventTypeId: recurringEvent.id, start: new Date('2054-10-26T13:00:00.000Z'), bookerTimeZone: 'America/New_York',
        bookerName: 'Recurring Guest', bookerEmail: 'recurring@example.net', idempotencyKey: 'phase2-recurring-dst-0001',
        recurrenceCount: 3,
    };
    const recurringReplays = await Promise.all([
        store.createRecurringBooking('phase1', recurringEvent.slug, recurringReplayInput),
        store.createRecurringBooking('phase1', recurringEvent.slug, recurringReplayInput),
    ]);
    assert.equal(recurringReplays.every(item => item.idempotentReplay === true && item.seriesId === recurring.seriesId), true);
    assert.equal(recurringReplays.every(item => item.bookings.length === 3), true, 'series retries must return the complete original series');
    const [seriesRows] = await pool.query(
        'SELECT series_index,series_count FROM scheduler_bookings WHERE series_id=? ORDER BY series_index', [recurring.seriesId]
    );
    assert.deepEqual(seriesRows.map(row => [Number(row.series_index), Number(row.series_count)]), [[1, 3], [2, 3], [3, 3]]);
    const [seriesOutbox] = await pool.query(
        "SELECT COUNT(*) AS total FROM scheduler_outbox WHERE aggregate_id IN (SELECT id FROM scheduler_bookings WHERE series_id=?) AND event_type='booking.confirmed'",
        [recurring.seriesId]
    );
    assert.equal(Number(seriesOutbox[0].total), 3, 'a completed series must enqueue one notification per occurrence');

    await pool.end();
});
