"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.OmsSchedulerMessageProvider = void 0;
exports.schedulerTransportOptions = schedulerTransportOptions;
exports.schedulerNotificationMails = schedulerNotificationMails;
exports.runSchedulerOutboxCycle = runSchedulerOutboxCycle;
exports.runSchedulerWorkerCycle = runSchedulerWorkerCycle;
const crypto_1 = __importDefault(require("crypto"));
const nodemailer_1 = __importDefault(require("nodemailer"));
const db_1 = require("../db");
const config_1 = require("../config");
const workflows_1 = require("./workflows");
function schedulerTransportOptions(config = config_1.schedulerConfig) {
    return {
        host: config.smtpHost,
        port: config.smtpPort,
        secure: false,
        connectionTimeout: 15_000,
        greetingTimeout: 15_000,
        socketTimeout: 45_000,
        tls: {
            rejectUnauthorized: config.smtpRejectUnauthorized,
            ...(config.smtpServerName ? { servername: config.smtpServerName } : {}),
        },
    };
}
const readableDate = (value, timeZone = 'UTC') => new Intl.DateTimeFormat('en-US', {
    timeZone,
    dateStyle: 'full',
    timeStyle: 'short',
}).format(new Date(value));
function schedulerNotificationMails(eventType, payload, baseUrl) {
    const title = payload.title || payload.event?.title || 'Meeting';
    const senderAddress = payload.notificationFrom || payload.hostEmail || config_1.schedulerConfig.notificationFrom;
    const sender = { name: payload.notificationName || payload.hostEmail || 'OpenMailStack Scheduler', address: senderAddress };
    const common = { from: sender, replyTo: payload.hostEmail };
    if (eventType === 'booking.verification') {
        return [{
                to: payload.bookerEmail,
                subject: `Verify your email for ${title}`,
                text: `Your OpenMailStack Scheduler verification code is ${payload.verificationCode}. It expires in 15 minutes.`,
                ...common,
            }];
    }
    if (eventType === 'waitlist.joined') {
        return [{
                to: payload.bookerEmail,
                subject: `Waitlist joined: ${title}`,
                text: `You are on the waitlist for ${title}. If enough seats become available, Scheduler will promote your request and send a booking confirmation automatically.`,
                ...common,
            }];
    }
    const when = readableDate(payload.start, payload.timeZone || 'UTC');
    const attendeeMails = (payload.additionalAttendees || []).map((attendee) => ({
        to: attendee.email,
        subject: `Confirmed: ${title}`,
        text: `${title} with ${payload.hostEmail} is confirmed for ${when}.`,
        ical: payload.ical,
        ...common,
    }));
    if (eventType === 'booking.requested') {
        const cancelUrl = `${baseUrl}/scheduler/action/cancel/${encodeURIComponent(payload.cancelToken || '')}`;
        return [
            {
                to: payload.bookerEmail,
                subject: `Request received: ${title}`,
                text: `Your request for ${title} with ${payload.hostEmail} at ${when} is waiting for approval. We will email you when it is reviewed.\n\nCancel request: ${cancelUrl}`,
                ...common,
            },
            {
                to: payload.hostEmail,
                subject: `Booking approval requested: ${title}`,
                text: `${payload.bookerName} (${payload.bookerEmail}) requested ${title} for ${when}. Review it in Scheduler: ${baseUrl}/scheduler-app`,
                ...common,
            },
        ];
    }
    if (eventType === 'booking.confirmed') {
        const cancelUrl = `${baseUrl}/scheduler/action/cancel/${encodeURIComponent(payload.cancelToken || '')}`;
        const rescheduleUrl = `${baseUrl}/scheduler/action/reschedule/${encodeURIComponent(payload.rescheduleToken || '')}`;
        return [
            {
                to: payload.bookerEmail,
                subject: `Confirmed: ${title}`,
                text: `${title} with ${payload.hostEmail} is confirmed for ${when}.\n\nCancel: ${cancelUrl}\nReschedule: ${rescheduleUrl}`,
                ical: payload.ical,
                ...common,
            },
            {
                to: payload.hostEmail,
                subject: `New booking: ${title}`,
                text: `${payload.bookerName} (${payload.bookerEmail}) booked ${title} for ${when}${Number(payload.seats || 1) > 1 ? ` for ${payload.seats} seats` : ''}.`,
                ical: payload.ical,
                ...common,
            },
            ...attendeeMails,
        ];
    }
    if (eventType === 'booking.cancelled') {
        return [payload.bookerEmail, payload.hostEmail, ...(payload.additionalAttendees || []).map((attendee) => attendee.email)].map((to) => ({
            ...common,
            to,
            subject: `Cancelled: ${title}`,
            text: `${title}, previously scheduled for ${when}, has been cancelled.`,
            ical: payload.ical,
        }));
    }
    if (eventType === 'booking.rejected') {
        return [{
                ...common,
                to: payload.bookerEmail,
                subject: `Booking request declined: ${title}`,
                text: `Your request for ${title} at ${when} could not be confirmed. Please return to the scheduling page to choose another time.`,
            }];
    }
    if (eventType === 'booking.rescheduled') {
        return [payload.bookerEmail, payload.hostEmail, ...(payload.additionalAttendees || []).map((attendee) => attendee.email)].map((to) => ({
            ...common,
            to,
            subject: `Rescheduled: ${title}`,
            text: `${title} is now scheduled for ${when}.`,
            ical: payload.ical,
        }));
    }
    return [];
}
async function claimOutbox(workerId) {
    const connection = await db_1.pool.getConnection();
    try {
        await connection.beginTransaction();
        const [rows] = await connection.query(`SELECT id, event_type, payload, attempts
             FROM scheduler_outbox
             WHERE completed_at IS NULL AND dead_lettered_at IS NULL AND available_at <= UTC_TIMESTAMP(3)
               AND (lease_expires_at IS NULL OR lease_expires_at <= UTC_TIMESTAMP(3))
             ORDER BY created_at
             LIMIT 10
             FOR UPDATE SKIP LOCKED`);
        const leaseUntil = new Date(Date.now() + 60_000).toISOString().slice(0, 23).replace('T', ' ');
        for (const row of rows) {
            await connection.query('UPDATE scheduler_outbox SET lease_owner=?, lease_expires_at=?, attempts=attempts+1 WHERE id=?', [workerId, leaseUntil, row.id]);
            row.attempts = Number(row.attempts) + 1;
        }
        await connection.commit();
        return rows;
    }
    catch (error) {
        await connection.rollback();
        throw error;
    }
    finally {
        connection.release();
    }
}
async function deliverOutbox(row, workerId) {
    try {
        const payload = JSON.parse(row.payload);
        const messages = schedulerNotificationMails(row.event_type, payload, config_1.schedulerConfig.publicBaseUrl);
        const transporter = nodemailer_1.default.createTransport(schedulerTransportOptions());
        for (const message of messages) {
            await transporter.sendMail({
                from: message.from,
                replyTo: message.replyTo,
                to: message.to,
                subject: message.subject,
                text: message.text,
                attachments: message.ical ? [{ filename: 'invite.ics', content: message.ical, contentType: 'text/calendar; charset=utf-8' }] : [],
            });
        }
        await db_1.pool.query("UPDATE scheduler_outbox SET completed_at=UTC_TIMESTAMP(3), payload='{}', last_error_code=NULL, lease_owner=NULL, lease_expires_at=NULL WHERE id=? AND lease_owner=?", [row.id, workerId]);
    }
    catch (error) {
        const errorCode = [error?.code || 'delivery_failed', error?.command].filter(Boolean).join(':').slice(0, 80);
        if (process.env.NODE_ENV !== 'test') {
            console.error('Scheduler notification delivery failed:', { eventType: row.event_type, errorCode, attempt: row.attempts });
        }
        if (row.attempts >= 8) {
            await db_1.pool.query(`UPDATE scheduler_outbox
                 SET dead_lettered_at=UTC_TIMESTAMP(3),
                     payload=CASE WHEN event_type='booking.verification' THEN '{}' ELSE payload END,
                     last_error_code=?, lease_owner=NULL, lease_expires_at=NULL
                 WHERE id=? AND lease_owner=?`, [errorCode, row.id, workerId]);
        }
        else {
            const delaySeconds = Math.min(3600, 2 ** row.attempts * 15);
            await db_1.pool.query('UPDATE scheduler_outbox SET available_at=DATE_ADD(UTC_TIMESTAMP(3), INTERVAL ? SECOND), last_error_code=?, lease_owner=NULL, lease_expires_at=NULL WHERE id=? AND lease_owner=?', [delaySeconds, errorCode, row.id, workerId]);
        }
    }
}
class OmsSchedulerMessageProvider {
    name = 'oms-smtp';
    async send(mail, idempotencyKey) {
        const messageIdDomain = new URL(config_1.schedulerConfig.publicBaseUrl).hostname || 'openmailstack.local';
        const deliveryKey = crypto_1.default.createHash('sha256').update(idempotencyKey).digest('hex');
        const messageId = `<scheduler-${deliveryKey}@${messageIdDomain}>`;
        const transporter = nodemailer_1.default.createTransport(schedulerTransportOptions());
        let timeout = null;
        try {
            const timeoutPromise = new Promise((_, reject) => {
                timeout = setTimeout(() => {
                    transporter.close();
                    const error = new Error('Scheduler SMTP delivery timed out');
                    error.code = 'ETIMEDOUT';
                    reject(error);
                }, 60_000);
            });
            const result = await Promise.race([
                transporter.sendMail({
                    from: mail.from,
                    replyTo: mail.replyTo,
                    to: mail.to,
                    subject: mail.subject,
                    text: mail.text,
                    messageId,
                }),
                timeoutPromise,
            ]);
            return { messageId: result.messageId || messageId };
        }
        catch (error) {
            const command = String(error?.command || '').toUpperCase();
            const retrySafe = command ? command !== 'DATA' : new Set([
                'ECONNECTION', 'ECONNREFUSED', 'EDNS', 'EAUTH', 'ETLS', 'EENVELOPE', 'EMESSAGE',
            ]).has(String(error?.code || '').toUpperCase());
            throw new workflows_1.SchedulerProviderError(String(error?.message || 'Scheduler SMTP delivery failed'), retrySafe ? 'safe_to_retry' : 'delivery_uncertain', String(error?.code || error?.name || 'delivery_failed').slice(0, 80));
        }
        finally {
            if (timeout)
                clearTimeout(timeout);
            transporter.close();
        }
    }
}
exports.OmsSchedulerMessageProvider = OmsSchedulerMessageProvider;
async function runSchedulerOutboxCycle(workerId) {
    const rows = await claimOutbox(workerId);
    for (const row of rows)
        await deliverOutbox(row, workerId);
    return rows.length;
}
async function runSchedulerWorkerCycle(workerId, provider = new OmsSchedulerMessageProvider()) {
    const outbox = await runSchedulerOutboxCycle(workerId);
    const jobs = await (0, workflows_1.runSchedulerJobCycle)(new workflows_1.SchedulerJobRepository(db_1.pool), provider, workerId);
    return { outbox, jobs };
}
//# sourceMappingURL=worker.js.map