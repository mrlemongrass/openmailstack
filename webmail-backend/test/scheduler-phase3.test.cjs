const test = require('node:test');
const assert = require('node:assert/strict');

const {
    normalizeWorkflowDefinition,
    schedulerReminderMail,
    workflowRunAt,
    runSchedulerJobCycle,
    SchedulerProviderError,
} = require('../src/scheduler/workflows.js');

test('workflow definitions accept the bounded reminder action and reject mutable or unsupported input', () => {
    const input = {
        trigger: { type: 'booking.start', offsetSeconds: -86_400 },
        steps: [{
            action: 'message.email.reminder',
            delaySeconds: 0,
            config: { subject: 'Reminder: {{event.title}}' },
        }],
    };
    const definition = normalizeWorkflowDefinition(input);
    input.steps[0].config.subject = 'changed after publishing';

    assert.equal(definition.trigger.type, 'booking.start');
    assert.equal(definition.trigger.offsetSeconds, -86_400);
    assert.equal(definition.steps[0].config.subject, 'Reminder: {{event.title}}');
    assert.throws(() => normalizeWorkflowDefinition({
        trigger: { type: 'booking.created', offsetSeconds: 0 },
        steps: input.steps,
    }), /unsupported/);
    assert.throws(() => normalizeWorkflowDefinition({
        trigger: { type: 'booking.start', offsetSeconds: 0 },
        steps: [{ action: 'webhook', delaySeconds: 0, config: {} }],
    }), /unsupported/);
});

test('workflow run time is deterministic across worker clock skew', () => {
    const start = new Date('2026-07-20T18:00:00.000Z');
    assert.equal(
        workflowRunAt(start, -86_400, 900).toISOString(),
        '2026-07-19T18:15:00.000Z',
    );
});

test('reminder rendering preserves the owned sender, reply-to, and management link', () => {
    const mail = schedulerReminderMail({
        bookingId: 'booking-1',
        hostEmail: 'owner@housevo.us',
        notificationFrom: 'appointments@housevo.us',
        notificationName: 'House Vo',
        bookerEmail: 'guest@example.net',
        bookerName: 'Ada',
        title: 'Design review',
        start: '2026-07-20T18:00:00.000Z',
        timeZone: 'America/Phoenix',
        manageUrl: 'https://mail.housevo.us/scheduler/action/reschedule/token',
    }, { subject: 'Reminder: {{event.title}}' });

    assert.deepEqual(mail.from, { name: 'House Vo', address: 'appointments@housevo.us' });
    assert.equal(mail.replyTo, 'owner@housevo.us');
    assert.equal(mail.to, 'guest@example.net');
    assert.equal(mail.subject, 'Reminder: Design review');
    assert.match(mail.text, /Design review/);
    assert.match(mail.text, /Monday, July 20, 2026 at 11:00 AM/);
    assert.match(mail.text, /https:\/\/mail\.housevo\.us\/scheduler\/action\/reschedule\/token/);
});

test('job cycle acknowledges success and records a retry without hiding provider failure', async () => {
    const completed = [];
    const failed = [];
    const started = [];
    const jobs = [{
        id: 'job-1',
        idempotencyKey: 'workflow:booking-1:step-1',
        attempts: 1,
        payload: {
            bookingId: 'booking-1', hostEmail: 'owner@housevo.us', bookerEmail: 'guest@example.net',
            bookerName: 'Ada', title: 'Design review', start: '2026-07-20T18:00:00.000Z', timeZone: 'UTC',
            manageUrl: 'https://mail.housevo.us/scheduler',
        },
        config: {},
    }];
    const repository = {
        claimBatch: async () => jobs,
        beginAttempt: async (...args) => started.push(args),
        complete: async (...args) => completed.push(args),
        fail: async (...args) => failed.push(args),
    };
    const provider = { name: 'test', send: async () => ({ messageId: 'message-1' }) };

    assert.equal(await runSchedulerJobCycle(repository, provider, 'worker-1'), 1);
    assert.deepEqual(started, [['job-1', 'worker-1', 'test']]);
    assert.deepEqual(completed, [['job-1', 'worker-1', 'test', 'message-1']]);
    assert.deepEqual(failed, []);

    provider.send = async () => {
        throw new SchedulerProviderError('provider unavailable', 'safe_to_retry', 'ECONNECTION');
    };
    assert.equal(await runSchedulerJobCycle(repository, provider, 'worker-1'), 1);
    assert.equal(failed.length, 1);
    assert.deepEqual(failed[0].slice(0, 5), ['job-1', 'worker-1', 'test', 1, 'ECONNECTION']);
});

test('ambiguous provider delivery is reconciled immediately instead of retried', async () => {
    const uncertain = [];
    const failed = [];
    const job = {
        id: 'job-uncertain', idempotencyKey: 'workflow:booking-uncertain:step-1', attempts: 1,
        jobType: 'webhook.http', config: {},
        payload: {
            bookingId: 'booking-uncertain', hostEmail: 'owner@housevo.us', bookerEmail: 'guest@example.net',
            bookerName: 'Ada', title: 'Design review', start: '2026-07-20T18:00:00.000Z', timeZone: 'UTC',
            manageUrl: 'https://mail.housevo.us/scheduler',
        },
    };
    const repository = {
        claimBatch: async () => [job],
        beginAttempt: async () => undefined,
        complete: async () => undefined,
        fail: async (...args) => failed.push(args),
        uncertain: async (...args) => uncertain.push(args),
    };
    const dispatcher = {
        providerName: () => 'test-webhook',
        deliver: async () => { throw new SchedulerProviderError('timeout after write', 'delivery_uncertain', 'provider_timeout'); },
    };

    assert.equal(await runSchedulerJobCycle(repository, dispatcher, 'worker-uncertain'), 1);
    assert.deepEqual(uncertain, [['job-uncertain', 'worker-uncertain', 'test-webhook', 1, 'provider_timeout']]);
    assert.deepEqual(failed, []);
});

test('operator-fixable provider failures dead-letter with retained recovery state', async () => {
    const deadLettered = [];
    const cancelled = [];
    const job = {
        id: 'job-provider-config', idempotencyKey: 'workflow:booking-provider-config:step-1', attempts: 1,
        jobType: 'webhook.http', config: {},
        payload: {
            bookingId: 'booking-provider-config', hostEmail: 'owner@housevo.us', bookerEmail: 'guest@example.net',
            bookerName: 'Ada', title: 'Design review', start: '2026-07-20T18:00:00.000Z', timeZone: 'UTC',
            manageUrl: 'https://mail.housevo.us/scheduler',
        },
    };
    const repository = {
        claimBatch: async () => [job],
        beginAttempt: async () => undefined,
        complete: async () => undefined,
        fail: async () => undefined,
        deadLetter: async (...args) => deadLettered.push(args),
        cancel: async (...args) => cancelled.push(args),
    };
    const dispatcher = {
        providerName: () => 'test-webhook',
        deliver: async () => { throw new SchedulerProviderError('missing provider', 'operator_action', 'provider_unavailable'); },
    };

    assert.equal(await runSchedulerJobCycle(repository, dispatcher, 'worker-provider-config'), 1);
    assert.deepEqual(deadLettered, [[
        'job-provider-config', 'worker-provider-config', 'test-webhook', 1, 'provider_unavailable',
    ]]);
    assert.deepEqual(cancelled, []);
});

test('SMTP acceptance followed by acknowledgement failure is not retried as a duplicate', async () => {
    const failed = [];
    const job = {
        id: 'job-ack-failure', idempotencyKey: 'workflow:booking-2:step-1', attempts: 1, config: {},
        payload: {
            bookingId: 'booking-2', hostEmail: 'owner@housevo.us', bookerEmail: 'guest@example.net',
            bookerName: 'Ada', title: 'Design review', start: '2026-07-20T18:00:00.000Z', timeZone: 'UTC',
            manageUrl: 'https://mail.housevo.us/scheduler',
        },
    };
    const repository = {
        claimBatch: async () => [job],
        beginAttempt: async () => undefined,
        complete: async () => { throw new Error('database acknowledgement failed'); },
        fail: async (...args) => failed.push(args),
    };
    const provider = { name: 'test', send: async () => ({ messageId: 'accepted-message' }) };

    await assert.rejects(() => runSchedulerJobCycle(repository, provider, 'worker-ack'), /acknowledgement failed/);
    assert.deepEqual(failed, [], 'accepted SMTP must remain uncertain instead of being sent twice');
});

test('malformed persisted reminder payloads enter the visible retry and dead-letter path', async () => {
    const failed = [];
    const repository = {
        claimBatch: async () => [{ id: 'job-invalid', idempotencyKey: 'invalid', attempts: 1, payload: {}, config: {} }],
        beginAttempt: async () => undefined,
        complete: async () => undefined,
        fail: async (...args) => failed.push(args),
    };
    const provider = { name: 'test', send: async () => { throw new Error('must not send'); } };

    assert.equal(await runSchedulerJobCycle(repository, provider, 'worker-invalid'), 1);
    assert.deepEqual(failed[0].slice(0, 5), ['job-invalid', 'worker-invalid', 'test', 1, 'invalid_payload']);
});
