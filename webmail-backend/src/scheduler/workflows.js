"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.SchedulerJobRepository = exports.SchedulerWorkflowRepository = exports.SchedulerProviderError = void 0;
exports.normalizeWorkflowDefinition = normalizeWorkflowDefinition;
exports.workflowRunAt = workflowRunAt;
exports.schedulerReminderMail = schedulerReminderMail;
exports.runSchedulerJobCycle = runSchedulerJobCycle;
const crypto_1 = __importDefault(require("crypto"));
const MAX_SCHEDULE_SECONDS = 366 * 24 * 60 * 60;
const MAX_JOB_ATTEMPTS = 8;
class SchedulerProviderError extends Error {
    disposition;
    code;
    constructor(message, disposition, code = 'delivery_failed') {
        super(message);
        this.disposition = disposition;
        this.code = code;
        this.name = 'SchedulerProviderError';
    }
}
exports.SchedulerProviderError = SchedulerProviderError;
const integer = (value, label, minimum, maximum) => {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
        throw new Error(`${label} must be an integer between ${minimum} and ${maximum}`);
    }
    return parsed;
};
const optionalString = (value, maximum, label) => {
    if (value == null || value === '')
        return undefined;
    const parsed = String(value).trim();
    if (!parsed || parsed.length > maximum)
        throw new Error(`${label} must contain at most ${maximum} characters`);
    return parsed;
};
function normalizeWorkflowDefinition(value) {
    if (!value || value.trigger?.type !== 'booking.start') {
        throw new Error('Scheduler workflow trigger must be booking.start');
    }
    if (!Array.isArray(value.steps) || value.steps.length < 1 || value.steps.length > 20) {
        throw new Error('Scheduler workflow must contain between 1 and 20 steps');
    }
    return {
        trigger: {
            type: 'booking.start',
            offsetSeconds: integer(value.trigger.offsetSeconds ?? 0, 'Trigger offset', -MAX_SCHEDULE_SECONDS, MAX_SCHEDULE_SECONDS),
        },
        steps: value.steps.map((step) => {
            if (step?.action !== 'message.email.reminder') {
                throw new Error('Scheduler workflow action must be message.email.reminder');
            }
            return {
                action: 'message.email.reminder',
                delaySeconds: integer(step.delaySeconds ?? 0, 'Step delay', 0, MAX_SCHEDULE_SECONDS),
                config: {
                    subject: optionalString(step.config?.subject, 200, 'Reminder subject'),
                    body: optionalString(step.config?.body, 8000, 'Reminder body'),
                },
            };
        }),
    };
}
function workflowRunAt(bookingStart, triggerOffsetSeconds, stepDelaySeconds) {
    if (!Number.isFinite(bookingStart.getTime()))
        throw new Error('Booking start must be a valid date');
    return new Date(bookingStart.getTime() + (triggerOffsetSeconds + stepDelaySeconds) * 1000);
}
const replaceTitle = (template, title) => template.replaceAll('{{event.title}}', title);
function schedulerReminderMail(payload, config) {
    const when = new Intl.DateTimeFormat('en-US', {
        timeZone: payload.timeZone || 'UTC',
        dateStyle: 'full',
        timeStyle: 'short',
    }).format(new Date(payload.start));
    const defaultBody = `This is a reminder that ${payload.title} is scheduled for ${when}.\n\nManage booking: ${payload.manageUrl}`;
    return {
        to: payload.bookerEmail,
        subject: replaceTitle(config.subject || 'Reminder: {{event.title}}', payload.title),
        text: replaceTitle(config.body || defaultBody, payload.title),
        from: {
            name: payload.notificationName || payload.hostEmail || 'OpenMailStack Scheduler',
            address: payload.notificationFrom || payload.hostEmail,
        },
        replyTo: payload.hostEmail,
    };
}
async function runSchedulerJobCycle(repository, provider, workerId) {
    const jobs = await repository.claimBatch(workerId, 1, new Date(Date.now() + 120_000));
    for (const job of jobs) {
        await repository.beginAttempt(job.id, workerId, provider.name);
        let mail;
        try {
            mail = schedulerReminderMail(job.payload, job.config);
        }
        catch {
            await repository.fail(job.id, workerId, provider.name, job.attempts, 'invalid_payload');
            continue;
        }
        let result;
        try {
            result = await provider.send(mail, job.idempotencyKey);
        }
        catch (error) {
            if (error?.disposition !== 'safe_to_retry')
                throw error;
            const errorCode = String(error?.code || error?.name || 'delivery_failed').slice(0, 80);
            await repository.fail(job.id, workerId, provider.name, job.attempts, errorCode);
            continue;
        }
        await repository.complete(job.id, workerId, provider.name, result.messageId);
    }
    return jobs.length;
}
const mysqlDate = (date) => date.toISOString().slice(0, 23).replace('T', ' ');
const utcDate = (value) => new Date(`${String(value).replace(' ', 'T')}Z`);
const safeJson = (value) => {
    try {
        return JSON.parse(String(value || '{}'));
    }
    catch {
        return {};
    }
};
class SchedulerWorkflowRepository {
    pool;
    constructor(pool) {
        this.pool = pool;
    }
    async createWorkflow(input) {
        const name = String(input.name || '').trim();
        if (!name || name.length > 160)
            throw new Error('Workflow name must contain between 1 and 160 characters');
        const eventTypeIds = Array.from(new Set((input.eventTypeIds || []).map(String).filter(Boolean)));
        const connection = await this.pool.getConnection();
        const id = crypto_1.default.randomUUID();
        try {
            await connection.beginTransaction();
            const [entitlementRows] = await connection.query('SELECT tenant_key FROM scheduler_mailbox_entitlements WHERE username=? FOR UPDATE', [input.ownerUsername]);
            if (!entitlementRows.length || entitlementRows[0].tenant_key !== input.tenantKey) {
                throw new Error('Workflow tenant must match the owner entitlement');
            }
            if (eventTypeIds.length) {
                const placeholders = eventTypeIds.map(() => '?').join(',');
                const [rows] = await connection.query(`SELECT id FROM scheduler_event_types WHERE tenant_key=? AND owner_username=? AND id IN (${placeholders}) FOR UPDATE`, [input.tenantKey, input.ownerUsername, ...eventTypeIds]);
                if (rows.length !== eventTypeIds.length)
                    throw new Error('Workflow event types must belong to the workflow owner');
            }
            await connection.query(`INSERT INTO scheduler_workflows
                    (id, tenant_key, owner_username, name, enabled, applies_to_all_event_types)
                 VALUES (?, ?, ?, ?, ?, ?)`, [id, input.tenantKey, input.ownerUsername, name, input.enabled ? 1 : 0, eventTypeIds.length ? 0 : 1]);
            for (const eventTypeId of eventTypeIds) {
                await connection.query('INSERT INTO scheduler_workflow_event_types (tenant_key, workflow_id, event_type_id) VALUES (?, ?, ?)', [input.tenantKey, id, eventTypeId]);
            }
            await connection.commit();
            return { id };
        }
        catch (error) {
            await connection.rollback();
            throw error;
        }
        finally {
            connection.release();
        }
    }
    async publishVersion(workflowId, createdBy, value) {
        const definition = normalizeWorkflowDefinition(value);
        const connection = await this.pool.getConnection();
        try {
            await connection.beginTransaction();
            const [rows] = await connection.query('SELECT tenant_key, owner_username, current_version FROM scheduler_workflows WHERE id=? FOR UPDATE', [workflowId]);
            if (!rows.length)
                throw new Error('Workflow not found');
            if (rows[0].owner_username !== createdBy)
                throw new Error('Only the workflow owner can publish a version');
            const version = Number(rows[0].current_version || 0) + 1;
            const versionId = crypto_1.default.randomUUID();
            await connection.query(`INSERT INTO scheduler_workflow_versions
                    (id, tenant_key, workflow_id, version, trigger_type, trigger_offset_seconds, created_by)
                 VALUES (?, ?, ?, ?, ?, ?, ?)`, [versionId, rows[0].tenant_key, workflowId, version, definition.trigger.type, definition.trigger.offsetSeconds, createdBy]);
            for (const [index, step] of definition.steps.entries()) {
                await connection.query(`INSERT INTO scheduler_workflow_steps
                        (id, tenant_key, workflow_version_id, step_order, action_type, delay_seconds, config)
                     VALUES (?, ?, ?, ?, ?, ?, ?)`, [crypto_1.default.randomUUID(), rows[0].tenant_key, versionId, index + 1, step.action, step.delaySeconds, JSON.stringify(step.config)]);
            }
            await connection.query('UPDATE scheduler_workflows SET current_version=? WHERE id=?', [version, workflowId]);
            await connection.commit();
            return { id: versionId, version };
        }
        catch (error) {
            await connection.rollback();
            throw error;
        }
        finally {
            connection.release();
        }
    }
    async captureForBooking(db, input) {
        const [rows] = await db.query(`SELECT w.id AS workflow_id, v.id AS version_id, v.version, v.trigger_offset_seconds,
                    s.id AS step_id, s.step_order, s.action_type, s.delay_seconds
             FROM scheduler_workflows w
             JOIN scheduler_workflow_versions v ON v.workflow_id=w.id AND v.version=w.current_version
             JOIN scheduler_workflow_steps s ON s.workflow_version_id=v.id
             WHERE w.tenant_key=? AND w.owner_username=? AND w.enabled=1
               AND (w.applies_to_all_event_types=1 OR EXISTS (
                    SELECT 1 FROM scheduler_workflow_event_types we
                    WHERE we.workflow_id=w.id AND we.event_type_id=?
               ))
             ORDER BY w.id, s.step_order`, [input.tenantKey, input.hostEmail, input.eventTypeId]);
        let captured = 0;
        const newWorkflows = new Set();
        for (const row of rows) {
            if (!newWorkflows.has(row.workflow_id)) {
                const [result] = await db.query(`INSERT IGNORE INTO scheduler_booking_workflow_versions
                        (tenant_key, booking_id, workflow_id, workflow_version_id, schedule_generation, scheduled_start)
                     VALUES (?, ?, ?, ?, 1, ?)`, [input.tenantKey, input.bookingId, row.workflow_id, row.version_id, mysqlDate(input.start)]);
                if (result.affectedRows === 0)
                    continue;
                newWorkflows.add(row.workflow_id);
                captured += 1;
            }
            if (!newWorkflows.has(row.workflow_id))
                continue;
            const idempotencyKey = `workflow:${row.workflow_id}:v${row.version}:booking:${input.bookingId}:g1:step:${row.step_order}`;
            await db.query(`INSERT IGNORE INTO scheduler_jobs
                    (id, tenant_key, booking_id, workflow_version_id, workflow_step_id, schedule_generation,
                     job_type, idempotency_key, payload, available_at)
                 VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`, [crypto_1.default.randomUUID(), input.tenantKey, input.bookingId, row.version_id, row.step_id, row.action_type,
                idempotencyKey, JSON.stringify(input), mysqlDate(workflowRunAt(input.start, Number(row.trigger_offset_seconds), Number(row.delay_seconds)))]);
        }
        return captured;
    }
    async rescheduleForBooking(db, input) {
        const [rows] = await db.query(`SELECT b.workflow_id, b.workflow_version_id, b.schedule_generation,
                    CAST(b.scheduled_start AS CHAR) AS scheduled_start_utc,
                    v.version, v.trigger_offset_seconds,
                    s.id AS step_id, s.step_order, s.action_type, s.delay_seconds
             FROM scheduler_booking_workflow_versions b
             JOIN scheduler_workflow_versions v ON v.id=b.workflow_version_id AND v.tenant_key=b.tenant_key
             JOIN scheduler_workflow_steps s ON s.workflow_version_id=v.id AND s.tenant_key=b.tenant_key
             WHERE b.tenant_key=? AND b.booking_id=?
             ORDER BY b.workflow_id, s.step_order FOR UPDATE`, [input.tenantKey, input.bookingId]);
        let scheduled = 0;
        const generations = new Map();
        for (const row of rows) {
            if (utcDate(row.scheduled_start_utc).getTime() === input.start.getTime())
                continue;
            let generation = generations.get(row.workflow_id);
            if (!generation) {
                generation = Number(row.schedule_generation) + 1;
                generations.set(row.workflow_id, generation);
                await db.query(`UPDATE scheduler_delivery_attempts a
                     JOIN scheduler_jobs j ON j.id=a.job_id
                     SET a.outcome='dead_lettered', a.error_code='delivery_uncertain_rescheduled'
                     WHERE j.tenant_key=? AND j.booking_id=? AND j.workflow_version_id=? AND a.outcome='sending'`, [input.tenantKey, input.bookingId, row.workflow_version_id]);
                await db.query(`UPDATE scheduler_jobs SET cancelled_at=UTC_TIMESTAMP(3), payload='{}', lease_owner=NULL, lease_expires_at=NULL
                     WHERE tenant_key=? AND booking_id=? AND workflow_version_id=?
                       AND completed_at IS NULL AND cancelled_at IS NULL AND dead_lettered_at IS NULL`, [input.tenantKey, input.bookingId, row.workflow_version_id]);
                await db.query(`UPDATE scheduler_booking_workflow_versions SET schedule_generation=?, scheduled_start=?
                     WHERE tenant_key=? AND booking_id=? AND workflow_id=?`, [generation, mysqlDate(input.start), input.tenantKey, input.bookingId, row.workflow_id]);
            }
            const idempotencyKey = `workflow:${row.workflow_id}:v${row.version}:booking:${input.bookingId}:g${generation}:step:${row.step_order}`;
            await db.query(`INSERT IGNORE INTO scheduler_jobs
                    (id, tenant_key, booking_id, workflow_version_id, workflow_step_id, schedule_generation,
                     job_type, idempotency_key, payload, available_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [crypto_1.default.randomUUID(), input.tenantKey, input.bookingId, row.workflow_version_id, row.step_id, generation,
                row.action_type, idempotencyKey, JSON.stringify(input),
                mysqlDate(workflowRunAt(input.start, Number(row.trigger_offset_seconds), Number(row.delay_seconds)))]);
            scheduled += 1;
        }
        return scheduled;
    }
    async cancelForBooking(db, tenantKey, bookingId) {
        await db.query(`UPDATE scheduler_delivery_attempts a
             JOIN scheduler_jobs j ON j.id=a.job_id
             SET a.outcome='dead_lettered', a.error_code='delivery_uncertain_cancelled'
             WHERE j.tenant_key=? AND j.booking_id=? AND a.outcome='sending'`, [tenantKey, bookingId]);
        await db.query(`UPDATE scheduler_jobs SET cancelled_at=UTC_TIMESTAMP(3), payload='{}', lease_owner=NULL, lease_expires_at=NULL
             WHERE tenant_key=? AND booking_id=? AND completed_at IS NULL AND cancelled_at IS NULL AND dead_lettered_at IS NULL`, [tenantKey, bookingId]);
    }
    async listBookingVersions(tenantKey, bookingId) {
        const [rows] = await this.pool.query(`SELECT b.workflow_id, b.workflow_version_id, v.version
             FROM scheduler_booking_workflow_versions b
             JOIN scheduler_workflow_versions v ON v.id=b.workflow_version_id
             WHERE b.tenant_key=? AND b.booking_id=? ORDER BY b.workflow_id`, [tenantKey, bookingId]);
        return rows.map((row) => ({
            workflowId: row.workflow_id,
            versionId: row.workflow_version_id,
            version: Number(row.version),
        }));
    }
}
exports.SchedulerWorkflowRepository = SchedulerWorkflowRepository;
class SchedulerJobRepository {
    pool;
    constructor(pool) {
        this.pool = pool;
    }
    async claimBatch(workerId, limit, _leaseUntil) {
        const connection = await this.pool.getConnection();
        try {
            await connection.beginTransaction();
            await connection.query(`UPDATE scheduler_jobs j
                 JOIN scheduler_delivery_attempts a ON a.job_id=j.id AND a.attempt_no=j.attempts AND a.outcome='sending'
                 SET j.dead_lettered_at=UTC_TIMESTAMP(3), j.payload='{}', j.last_error_code='delivery_uncertain',
                     j.lease_owner=NULL, j.lease_expires_at=NULL,
                     a.outcome='dead_lettered', a.error_code='delivery_uncertain'
                 WHERE j.completed_at IS NULL AND j.cancelled_at IS NULL AND j.dead_lettered_at IS NULL
                   AND j.lease_expires_at<=UTC_TIMESTAMP(3)`);
            const [rows] = await connection.query(`SELECT j.id, j.idempotency_key, j.payload, j.attempts, s.config
                 FROM scheduler_jobs j
                 JOIN scheduler_workflow_steps s ON s.id=j.workflow_step_id
                 WHERE j.completed_at IS NULL AND j.cancelled_at IS NULL AND j.dead_lettered_at IS NULL
                   AND j.available_at<=UTC_TIMESTAMP(3)
                   AND (j.lease_expires_at IS NULL OR j.lease_expires_at<=UTC_TIMESTAMP(3))
                 ORDER BY j.available_at, j.created_at
                 LIMIT ? FOR UPDATE SKIP LOCKED`, [Math.max(1, Math.min(100, Math.trunc(limit)))]);
            for (const row of rows) {
                await connection.query(`UPDATE scheduler_jobs SET lease_owner=?,
                        lease_expires_at=DATE_ADD(UTC_TIMESTAMP(3), INTERVAL 120 SECOND), attempts=attempts+1 WHERE id=?`, [workerId, row.id]);
                row.attempts = Number(row.attempts) + 1;
            }
            await connection.commit();
            return rows.map((row) => ({
                id: row.id,
                idempotencyKey: row.idempotency_key,
                attempts: Number(row.attempts),
                payload: safeJson(row.payload),
                config: safeJson(row.config || '{}'),
            }));
        }
        catch (error) {
            await connection.rollback();
            throw error;
        }
        finally {
            connection.release();
        }
    }
    async beginAttempt(jobId, workerId, provider) {
        const [result] = await this.pool.query(`INSERT INTO scheduler_delivery_attempts
                (id, tenant_key, job_id, attempt_no, provider, outcome)
             SELECT ?, tenant_key, id, attempts, ?, 'sending' FROM scheduler_jobs
             WHERE id=? AND lease_owner=? AND completed_at IS NULL AND cancelled_at IS NULL AND dead_lettered_at IS NULL`, [crypto_1.default.randomUUID(), provider.slice(0, 64), jobId, workerId]);
        if (result.affectedRows !== 1)
            throw new Error('Scheduler job lease was lost before delivery started');
    }
    async complete(jobId, workerId, provider, providerMessageId) {
        const connection = await this.pool.getConnection();
        try {
            await connection.beginTransaction();
            const [result] = await connection.query(`UPDATE scheduler_jobs SET completed_at=UTC_TIMESTAMP(3), payload='{}', last_error_code=NULL,
                    lease_owner=NULL, lease_expires_at=NULL
                 WHERE id=? AND lease_owner=? AND cancelled_at IS NULL AND dead_lettered_at IS NULL`, [jobId, workerId]);
            if (result.affectedRows !== 1)
                throw new Error('Scheduler job lease was lost before completion');
            const [attemptResult] = await connection.query(`UPDATE scheduler_delivery_attempts a
                 JOIN scheduler_jobs j ON j.id=a.job_id AND j.attempts=a.attempt_no
                 SET a.outcome='sent', a.provider_message_id=?, a.error_code=NULL
                 WHERE a.job_id=? AND a.provider=? AND a.outcome='sending'`, [providerMessageId?.slice(0, 255) || null, jobId, provider.slice(0, 64)]);
            if (attemptResult.affectedRows !== 1)
                throw new Error('Scheduler delivery attempt was lost before completion');
            await connection.commit();
        }
        catch (error) {
            await connection.rollback();
            throw error;
        }
        finally {
            connection.release();
        }
    }
    async fail(jobId, workerId, provider, attempt, errorCode) {
        const connection = await this.pool.getConnection();
        const deadLettered = attempt >= MAX_JOB_ATTEMPTS;
        try {
            await connection.beginTransaction();
            const delaySeconds = Math.min(3600, 2 ** attempt * 15);
            const [result] = await connection.query(deadLettered
                ? `UPDATE scheduler_jobs SET dead_lettered_at=UTC_TIMESTAMP(3), payload='{}', last_error_code=?,
                         lease_owner=NULL, lease_expires_at=NULL
                       WHERE id=? AND lease_owner=? AND cancelled_at IS NULL AND dead_lettered_at IS NULL`
                : `UPDATE scheduler_jobs SET available_at=DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ? SECOND), last_error_code=?,
                         lease_owner=NULL, lease_expires_at=NULL
                       WHERE id=? AND lease_owner=? AND cancelled_at IS NULL AND dead_lettered_at IS NULL`, deadLettered
                ? [errorCode.slice(0, 80), jobId, workerId]
                : [delaySeconds, errorCode.slice(0, 80), jobId, workerId]);
            if (result.affectedRows !== 1)
                throw new Error('Scheduler job lease was lost before failure recording');
            const [attemptResult] = await connection.query(`UPDATE scheduler_delivery_attempts SET outcome=?, error_code=?
                 WHERE job_id=? AND attempt_no=? AND provider=? AND outcome='sending'`, [deadLettered ? 'dead_lettered' : 'retrying', errorCode.slice(0, 80), jobId, attempt, provider.slice(0, 64)]);
            if (attemptResult.affectedRows !== 1)
                throw new Error('Scheduler delivery attempt was lost before failure recording');
            await connection.commit();
        }
        catch (error) {
            await connection.rollback();
            throw error;
        }
        finally {
            connection.release();
        }
    }
}
exports.SchedulerJobRepository = SchedulerJobRepository;
//# sourceMappingURL=workflows.js.map