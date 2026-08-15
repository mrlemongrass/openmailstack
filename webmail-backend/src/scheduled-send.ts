import { pool } from './db';
import crypto from 'crypto';
import { decryptPassword } from './auth';
import { delegatedAuthEnabled, smtpTransportOptions } from './config';
import nodemailer from 'nodemailer';
import {
    authorizeOutboundSender,
    classifySmtpRecipientOutcome,
    compileOutboundMessage,
    mailboxAddressFromHeader,
    normalizeMailboxAddress,
    OutboundMessageValidationError,
    SenderAuthorizationError,
    type OwnedSenderIdentity,
} from './outbound-mail';

export type ScheduledEmailStatus = 'scheduled' | 'retry_wait' | 'claimed' | 'smtp_inflight'
    | 'sent_copy_pending' | 'cancel_restore_pending' | 'completed' | 'failed'
    | 'delivery_uncertain' | 'partial_delivery' | 'cancelled';

export interface ScheduledEmailRow {
    id: number;
    username: string;
    send_at: Date;
    mail_options: string;
    draft_uid: number | null;
    payload_version?: number;
    status?: ScheduledEmailStatus;
    available_at?: Date;
    attempts?: number;
    lease_owner?: string | null;
    sender_address?: string | null;
    message_id?: string | null;
    envelope_json?: string | null;
    rejected_recipients_json?: string | null;
    raw_message?: Buffer | null;
    sent_raw_message?: Buffer | null;
    smtp_accepted_at?: Date | null;
}

export interface ScheduledEmailStore {
    materialize?(row: ScheduledEmailRow, workerId: string): Promise<void>;
    beginSmtp?(row: ScheduledEmailRow, workerId: string): Promise<void>;
    accepted?(row: ScheduledEmailRow, workerId: string): Promise<void>;
    renewSentCopyLease?(row: ScheduledEmailRow, workerId: string): Promise<void>;
    complete?(row: ScheduledEmailRow, workerId: string): Promise<void>;
    sentCopyPending?(row: ScheduledEmailRow, workerId: string, code: string): Promise<void>;
    retry?(row: ScheduledEmailRow, workerId: string, code: string): Promise<void>;
    failed?(row: ScheduledEmailRow, workerId: string, code: string): Promise<void>;
    uncertain?(row: ScheduledEmailRow, workerId: string, code: string): Promise<void>;
}

export interface ScheduledEmailDependencies {
    operationTimeoutMs?: number;
    getCredential(username: string): Promise<string>;
    createTransport(username: string, password: string): any;
    createImap(username: string, password: string): Promise<any>;
    authorizeSender(username: string, sender: string): Promise<OwnedSenderIdentity>;
}

const timeoutError = (): any => {
    const error: any = new Error('Scheduled delivery operation timed out');
    error.code = 'ETIMEDOUT';
    return error;
};

const withOperationTimeout = async <T>(
    operation: Promise<T>,
    timeoutMs: number,
    onTimeout?: () => void,
): Promise<T> => {
    let timeout: NodeJS.Timeout | null = null;
    const bounded = new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => {
            try { onTimeout?.(); } catch {}
            reject(timeoutError());
        }, timeoutMs);
    });
    try {
        return await Promise.race([operation, bounded]);
    } finally {
        if (timeout) clearTimeout(timeout);
    }
};

const smtpErrorCode = (error: any): string => (
    [error?.code || error?.name || 'delivery_failed', error?.command]
        .filter(Boolean).join(':').slice(0, 80)
);

export const classifyScheduledSmtpError = (error: any): 'safe_to_retry' | 'delivery_uncertain' => {
    const command = String(error?.command || '').toUpperCase();
    if (command) return command === 'DATA' ? 'delivery_uncertain' : 'safe_to_retry';
    const safeCodes = new Set(['ECONNECTION', 'ECONNREFUSED', 'EDNS', 'EAUTH', 'ETLS', 'EENVELOPE', 'EMESSAGE']);
    return safeCodes.has(String(error?.code || '').toUpperCase()) ? 'safe_to_retry' : 'delivery_uncertain';
};

const scheduledRaw = (row: ScheduledEmailRow): Buffer => {
    if (!row.raw_message) throw new Error('Scheduled message payload is missing');
    return Buffer.isBuffer(row.raw_message) ? row.raw_message : Buffer.from(row.raw_message as any);
};

const scheduledSentRaw = (row: ScheduledEmailRow): Buffer => {
    const raw = row.sent_raw_message || row.raw_message;
    if (!raw) throw new Error('Scheduled Sent-copy payload is missing');
    return Buffer.isBuffer(raw) ? raw : Buffer.from(raw as any);
};

const scheduledEnvelope = (row: ScheduledEmailRow): { from: string; to: string[] } => {
    const envelope = JSON.parse(String(row.envelope_json || '{}'));
    if (!envelope.from || !Array.isArray(envelope.to) || envelope.to.length === 0) {
        throw new Error('Scheduled message envelope is invalid');
    }
    return envelope;
};

const appendScheduledSentCopy = async (imap: any, row: ScheduledEmailRow): Promise<void> => {
    const folders = await imap.getFolders();
    let sentFolder = folders.find((folder: any) => folder.path.toLowerCase().includes('sent'))?.path;
    if (!sentFolder) {
        try { await imap.client.mailboxCreate('Sent'); } catch {}
        sentFolder = 'Sent';
    }
    await imap.client.mailboxOpen(sentFolder);
    const messageId = String(row.message_id || '');
    const existing = messageId
        ? await imap.client.search({ header: { 'message-id': messageId } })
        : [];
    if (!existing || existing.length === 0) {
        await imap.appendMessage(sentFolder, scheduledSentRaw(row), ['\\Seen']);
    }
    if (row.draft_uid) {
        const draftsFolder = folders.find((folder: any) => folder.path.toLowerCase().includes('draft'))?.path;
        if (draftsFolder) {
            try { await imap.messageAction(draftsFolder, [Number(row.draft_uid)], 'delete'); } catch {}
        }
    }
};

export const processScheduledEmail = async (
    row: ScheduledEmailRow,
    workerId: string,
    store: ScheduledEmailStore,
    dependencies: ScheduledEmailDependencies,
): Promise<ScheduledEmailStatus> => {
    const operationTimeoutMs = Math.max(1, Math.min(60_000, Number(dependencies.operationTimeoutMs || 60_000)));
    const connectTimeoutMs = Math.min(30_000, operationTimeoutMs);
    const accepted = Boolean(row.smtp_accepted_at) || row.status === 'sent_copy_pending';
    let password = '';
    if (!accepted) {
        try {
            let legacyOptions: any = null;
            let requestedSender = String(row.sender_address || row.username);
            if (!row.raw_message || !row.envelope_json || !row.message_id) {
                legacyOptions = JSON.parse(String(row.mail_options || '{}'));
                if (legacyOptions.from) {
                    const legacySender = mailboxAddressFromHeader(legacyOptions.from);
                    if (!legacySender) throw new OutboundMessageValidationError('Legacy From address is invalid');
                    requestedSender = legacySender;
                }
            }
            const sender = await dependencies.authorizeSender(row.username, requestedSender);
            if (legacyOptions) {
                const compiled = await compileOutboundMessage({
                    sender,
                    to: legacyOptions.to,
                    cc: legacyOptions.cc,
                    bcc: legacyOptions.bcc,
                    replyTo: legacyOptions.replyTo,
                    subject: legacyOptions.subject,
                    text: legacyOptions.text,
                    body: legacyOptions.body,
                    html: legacyOptions.html,
                    inReplyTo: legacyOptions.inReplyTo,
                    references: legacyOptions.references,
                    attachments: Array.isArray(legacyOptions.attachments)
                        ? legacyOptions.attachments.map((attachment: any) => ({
                            filename: String(attachment.filename || 'attachment'),
                            content: Buffer.from(String(attachment.content || ''), 'base64'),
                            contentType: attachment.contentType,
                        }))
                        : [],
                });
                row.payload_version = 2;
                row.sender_address = sender.address;
                row.message_id = compiled.messageId;
                row.envelope_json = JSON.stringify(compiled.envelope);
                row.raw_message = compiled.raw;
                row.sent_raw_message = compiled.sentRaw;
                row.mail_options = JSON.stringify(compiled.metadata);
                await store.materialize?.(row, workerId);
            }
        } catch (error) {
            if (error instanceof SenderAuthorizationError
                || error instanceof OutboundMessageValidationError
                || error instanceof SyntaxError) {
                const code = error instanceof SenderAuthorizationError ? 'sender_not_authorized' : 'invalid_payload';
                await store.failed?.(row, workerId, code);
                return 'failed';
            }
            const code = smtpErrorCode(error);
            if (Number(row.attempts || 0) >= 8) {
                await store.failed?.(row, workerId, code);
                return 'failed';
            }
            await store.retry?.(row, workerId, code);
            return 'retry_wait';
        }
    }
    try {
        password = await withOperationTimeout(
            dependencies.getCredential(row.username),
            operationTimeoutMs,
        );
    } catch (error) {
        const code = smtpErrorCode(error);
        if (accepted) {
            await store.sentCopyPending?.(row, workerId, code);
            return 'sent_copy_pending';
        }
        if (Number(row.attempts || 0) >= 8) {
            await store.failed?.(row, workerId, code);
            return 'failed';
        }
        await store.retry?.(row, workerId, code);
        return 'retry_wait';
    }

    if (!accepted) {
        let raw: Buffer;
        let envelope: { from: string; to: string[] };
        try {
            raw = scheduledRaw(row);
            envelope = scheduledEnvelope(row);
            if (normalizeMailboxAddress(envelope.from) !== normalizeMailboxAddress(row.sender_address)) {
                throw new Error('Scheduled envelope sender does not match its authorized identity');
            }
        } catch {
            await store.failed?.(row, workerId, 'invalid_payload');
            return 'failed';
        }
        let transporter: any;
        try {
            transporter = dependencies.createTransport(row.username, password);
        } catch (error) {
            const code = smtpErrorCode(error);
            if (Number(row.attempts || 0) >= 8) {
                await store.failed?.(row, workerId, code);
                return 'failed';
            }
            await store.retry?.(row, workerId, code);
            return 'retry_wait';
        }
        await store.beginSmtp?.(row, workerId);
        let smtpAccepted = false;
        try {
            const smtpInfo = await withOperationTimeout(
                transporter.sendMail({ raw, envelope }),
                operationTimeoutMs,
                () => transporter.close?.(),
            );
            const recipientOutcome = classifySmtpRecipientOutcome(smtpInfo, envelope.to);
            row.rejected_recipients_json = JSON.stringify(recipientOutcome.rejected);
            smtpAccepted = true;
            row.smtp_accepted_at = new Date();
            row.status = 'sent_copy_pending';
            await store.accepted?.(row, workerId);
        } catch (error) {
            const code = smtpErrorCode(error);
            if (smtpAccepted || classifyScheduledSmtpError(error) === 'delivery_uncertain') {
                await store.uncertain?.(row, workerId, code);
                return 'delivery_uncertain';
            }
            if (Number(row.attempts || 0) >= 8) {
                await store.failed?.(row, workerId, code);
                return 'failed';
            }
            await store.retry?.(row, workerId, code);
            return 'retry_wait';
        } finally {
            try { transporter.close?.(); } catch {}
        }
    }

    await store.renewSentCopyLease?.(row, workerId);

    let imap: any = null;
    try {
        imap = await withOperationTimeout(dependencies.createImap(row.username, password), connectTimeoutMs);
        await withOperationTimeout(
            appendScheduledSentCopy(imap, row),
            operationTimeoutMs,
            () => imap?.client?.close?.(),
        );
        await store.complete?.(row, workerId);
        const rejectedRecipients = JSON.parse(String(row.rejected_recipients_json || '[]'));
        return Array.isArray(rejectedRecipients) && rejectedRecipients.length > 0
            ? 'partial_delivery'
            : 'completed';
    } catch (error) {
        await store.sentCopyPending?.(row, workerId, smtpErrorCode(error));
        return 'sent_copy_pending';
    } finally {
        try {
            if (imap?.logout) await withOperationTimeout(Promise.resolve(imap.logout()), 5_000, () => imap?.client?.close?.());
        } catch {}
    }
};

const schemaPromises = new WeakMap<object, Promise<void>>();

const scheduledColumnDefinitions: Record<string, string> = {
    payload_version: 'TINYINT UNSIGNED NOT NULL DEFAULT 1 AFTER draft_uid',
    status: "VARCHAR(32) NOT NULL DEFAULT 'scheduled' AFTER payload_version",
    available_at: 'DATETIME NULL AFTER status',
    attempts: 'INT UNSIGNED NOT NULL DEFAULT 0 AFTER available_at',
    lease_owner: 'VARCHAR(64) NULL AFTER attempts',
    lease_expires_at: 'DATETIME NULL AFTER lease_owner',
    sender_address: 'VARCHAR(255) NULL AFTER lease_expires_at',
    message_id: 'VARCHAR(255) NULL AFTER sender_address',
    envelope_json: 'MEDIUMTEXT NULL AFTER message_id',
    rejected_recipients_json: 'MEDIUMTEXT NULL AFTER envelope_json',
    raw_message: 'LONGBLOB NULL AFTER rejected_recipients_json',
    sent_raw_message: 'LONGBLOB NULL AFTER raw_message',
    smtp_accepted_at: 'DATETIME NULL AFTER sent_raw_message',
    sent_copy_completed_at: 'DATETIME NULL AFTER smtp_accepted_at',
    completed_at: 'DATETIME NULL AFTER sent_copy_completed_at',
    cancelled_at: 'DATETIME NULL AFTER completed_at',
    last_error_code: 'VARCHAR(80) NULL AFTER cancelled_at',
    last_error_at: 'DATETIME NULL AFTER last_error_code',
    updated_at: 'TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at',
};

export const ensureScheduledEmailsSchema = async (db: any = pool) => {
    const existing = schemaPromises.get(db);
    if (existing) return existing;
    const promise = (async () => {
        await db.query(`
            CREATE TABLE IF NOT EXISTS scheduled_emails (
                id BIGINT AUTO_INCREMENT PRIMARY KEY,
                username VARCHAR(255) NOT NULL,
                send_at DATETIME NOT NULL,
                mail_options MEDIUMTEXT NOT NULL,
                draft_uid BIGINT NULL,
                payload_version TINYINT UNSIGNED NOT NULL DEFAULT 1,
                status VARCHAR(32) NOT NULL DEFAULT 'scheduled',
                available_at DATETIME NULL,
                attempts INT UNSIGNED NOT NULL DEFAULT 0,
                lease_owner VARCHAR(64) NULL,
                lease_expires_at DATETIME NULL,
                sender_address VARCHAR(255) NULL,
                message_id VARCHAR(255) NULL,
                envelope_json MEDIUMTEXT NULL,
                rejected_recipients_json MEDIUMTEXT NULL,
                raw_message LONGBLOB NULL,
                sent_raw_message LONGBLOB NULL,
                smtp_accepted_at DATETIME NULL,
                sent_copy_completed_at DATETIME NULL,
                completed_at DATETIME NULL,
                cancelled_at DATETIME NULL,
                last_error_code VARCHAR(80) NULL,
                last_error_at DATETIME NULL,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                KEY idx_send_at (send_at),
                KEY idx_scheduled_claim (status, available_at, lease_expires_at, id),
                KEY idx_scheduled_owner_state (username, status, send_at, id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        const [columnRows]: any = await db.query(
            `SELECT COLUMN_NAME, COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'scheduled_emails'`,
        );
        const columns = new Set((columnRows || []).map((row: any) => String(row.COLUMN_NAME || row.column_name)));
        for (const [name, definition] of Object.entries(scheduledColumnDefinitions)) {
            if (!columns.has(name)) await db.query(`ALTER TABLE scheduled_emails ADD COLUMN ${name} ${definition}`);
        }
        const attemptsColumn = (columnRows || []).find((row: any) => String(row.COLUMN_NAME || row.column_name) === 'attempts');
        if (attemptsColumn && !String(attemptsColumn.COLUMN_TYPE || attemptsColumn.column_type || '').toLowerCase().startsWith('int')) {
            await db.query('ALTER TABLE scheduled_emails MODIFY COLUMN attempts INT UNSIGNED NOT NULL DEFAULT 0');
        }
        await db.query(
            `UPDATE scheduled_emails
             SET status = COALESCE(NULLIF(status, ''), 'scheduled'),
                 available_at = COALESCE(available_at, send_at),
                 sender_address = COALESCE(NULLIF(sender_address, ''), username),
                 payload_version = COALESCE(payload_version, 1)
             WHERE available_at IS NULL OR sender_address IS NULL OR sender_address = '' OR status = ''`,
        );
        const [indexRows]: any = await db.query(
            `SELECT DISTINCT INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'scheduled_emails'`,
        );
        const indexes = new Set((indexRows || []).map((row: any) => String(row.INDEX_NAME || row.index_name)));
        if (!indexes.has('idx_scheduled_claim')) {
            await db.query('ALTER TABLE scheduled_emails ADD KEY idx_scheduled_claim (status, available_at, lease_expires_at, id)');
        }
        if (!indexes.has('idx_scheduled_owner_state')) {
            await db.query('ALTER TABLE scheduled_emails ADD KEY idx_scheduled_owner_state (username, status, send_at, id)');
        }
    })();
    schemaPromises.set(db, promise);
    try {
        await promise;
    } catch (error) {
        schemaPromises.delete(db);
        throw error;
    }
};

const retryDelaySeconds = (attempts: number): number => Math.min(3600, 2 ** Math.max(1, attempts) * 15);

export class MySqlScheduledEmailStore implements ScheduledEmailStore {
    constructor(private readonly db: any = pool) {}

    async claimBatch(workerId: string, limit = 25): Promise<ScheduledEmailRow[]> {
        const connection = await this.db.getConnection();
        try {
            await connection.beginTransaction();
            await connection.query(
                `UPDATE scheduled_emails
                 SET status = 'delivery_uncertain', last_error_code = 'lease_expired_during_smtp',
                     last_error_at = UTC_TIMESTAMP(), lease_owner = NULL, lease_expires_at = NULL
                 WHERE status = 'smtp_inflight' AND lease_expires_at <= UTC_TIMESTAMP()`,
            );
            await connection.query(
                `UPDATE scheduled_emails
                 SET status = 'retry_wait', available_at = UTC_TIMESTAMP(),
                     last_error_code = 'lease_expired_before_smtp', last_error_at = UTC_TIMESTAMP(),
                     lease_owner = NULL, lease_expires_at = NULL
                 WHERE status = 'claimed' AND lease_expires_at <= UTC_TIMESTAMP()`,
            );
            const [rows]: any = await connection.query(
                `SELECT * FROM scheduled_emails
                 WHERE status IN ('scheduled', 'retry_wait', 'sent_copy_pending')
                   AND COALESCE(available_at, send_at) <= UTC_TIMESTAMP()
                   AND (lease_expires_at IS NULL OR lease_expires_at <= UTC_TIMESTAMP())
                 ORDER BY COALESCE(available_at, send_at), id
                 LIMIT ? FOR UPDATE SKIP LOCKED`,
                [Math.max(1, Math.min(100, Math.trunc(limit)))],
            );
            for (const row of rows || []) {
                const previousStatus = String(row.status || 'scheduled') as ScheduledEmailStatus;
                if (previousStatus === 'sent_copy_pending') {
                    await connection.query(
                        `UPDATE scheduled_emails
                         SET attempts = attempts + 1, lease_owner = ?,
                             lease_expires_at = DATE_ADD(UTC_TIMESTAMP(), INTERVAL 120 SECOND)
                         WHERE id = ? AND status = 'sent_copy_pending'`,
                        [workerId, row.id],
                    );
                    row.attempts = Number(row.attempts || 0) + 1;
                } else {
                    await connection.query(
                        `UPDATE scheduled_emails
                         SET status = 'claimed', attempts = attempts + 1, lease_owner = ?,
                             lease_expires_at = DATE_ADD(UTC_TIMESTAMP(), INTERVAL 120 SECOND)
                         WHERE id = ? AND status = ?`,
                        [workerId, row.id, previousStatus],
                    );
                    row.status = 'claimed';
                    row.attempts = Number(row.attempts || 0) + 1;
                }
                row.lease_owner = workerId;
            }
            await connection.commit();
            return rows || [];
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }

    private async update(sql: string, params: any[], message: string): Promise<void> {
        const [result]: any = await this.db.query(sql, params);
        if (Number(result?.affectedRows) !== 1) throw new Error(message);
    }

    async materialize(row: ScheduledEmailRow, workerId: string): Promise<void> {
        await this.update(
            `UPDATE scheduled_emails
             SET payload_version = 2, sender_address = ?, message_id = ?, envelope_json = ?,
                 raw_message = ?, sent_raw_message = ?, mail_options = ?
             WHERE id = ? AND lease_owner = ? AND status = 'claimed' AND smtp_accepted_at IS NULL`,
            [row.sender_address, row.message_id, row.envelope_json, row.raw_message,
                row.sent_raw_message || row.raw_message, row.mail_options, row.id, workerId],
            'Scheduled email lease was lost while materializing the legacy payload',
        );
    }

    async beginSmtp(row: ScheduledEmailRow, workerId: string): Promise<void> {
        await this.update(
            `UPDATE scheduled_emails SET status = 'smtp_inflight',
                 lease_expires_at = DATE_ADD(UTC_TIMESTAMP(), INTERVAL 120 SECOND)
             WHERE id = ? AND lease_owner = ? AND status = 'claimed'`,
            [row.id, workerId], 'Scheduled email lease was lost before SMTP',
        );
    }

    async accepted(row: ScheduledEmailRow, workerId: string): Promise<void> {
        await this.update(
            `UPDATE scheduled_emails
             SET status = 'sent_copy_pending', smtp_accepted_at = UTC_TIMESTAMP(),
                 rejected_recipients_json = ?,
                 last_error_code = NULL, last_error_at = NULL,
                 lease_expires_at = DATE_ADD(UTC_TIMESTAMP(), INTERVAL 120 SECOND)
             WHERE id = ? AND lease_owner = ? AND status = 'smtp_inflight'`,
            [row.rejected_recipients_json || '[]', row.id, workerId],
            'Scheduled email lease was lost after SMTP acceptance',
        );
    }

    async renewSentCopyLease(row: ScheduledEmailRow, workerId: string): Promise<void> {
        await this.update(
            `UPDATE scheduled_emails
             SET lease_expires_at = DATE_ADD(UTC_TIMESTAMP(), INTERVAL 120 SECOND)
             WHERE id = ? AND lease_owner = ? AND status = 'sent_copy_pending'
               AND smtp_accepted_at IS NOT NULL`,
            [row.id, workerId], 'Scheduled email lease was lost before Sent-copy reconciliation',
        );
    }

    async complete(row: ScheduledEmailRow, workerId: string): Promise<void> {
        const rejectedRecipients = JSON.parse(String(row.rejected_recipients_json || '[]'));
        if (Array.isArray(rejectedRecipients) && rejectedRecipients.length > 0) {
            await this.update(
                `UPDATE scheduled_emails
                 SET status = 'partial_delivery', sent_copy_completed_at = UTC_TIMESTAMP(),
                     completed_at = UTC_TIMESTAMP(), raw_message = NULL, sent_raw_message = NULL,
                     envelope_json = NULL,
                     last_error_code = 'partial_recipient_rejection', last_error_at = UTC_TIMESTAMP(),
                     lease_owner = NULL, lease_expires_at = NULL
                 WHERE id = ? AND lease_owner = ? AND status = 'sent_copy_pending'
                   AND smtp_accepted_at IS NOT NULL`,
                [row.id, workerId], 'Scheduled email lease was lost before partial-delivery completion',
            );
            return;
        }
        await this.update(
            `UPDATE scheduled_emails
             SET status = 'completed', sent_copy_completed_at = UTC_TIMESTAMP(), completed_at = UTC_TIMESTAMP(),
                 raw_message = NULL, sent_raw_message = NULL, envelope_json = NULL, mail_options = '{}',
                 last_error_code = NULL, last_error_at = NULL, lease_owner = NULL, lease_expires_at = NULL
             WHERE id = ? AND lease_owner = ? AND status = 'sent_copy_pending' AND smtp_accepted_at IS NOT NULL`,
            [row.id, workerId], 'Scheduled email lease was lost before completion',
        );
    }

    async sentCopyPending(row: ScheduledEmailRow, workerId: string, code: string): Promise<void> {
        await this.update(
            `UPDATE scheduled_emails
             SET status = 'sent_copy_pending', available_at = DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? SECOND),
                 last_error_code = ?, last_error_at = UTC_TIMESTAMP(), lease_owner = NULL, lease_expires_at = NULL
             WHERE id = ? AND lease_owner = ? AND smtp_accepted_at IS NOT NULL`,
            [retryDelaySeconds(Number(row.attempts || 1)), code.slice(0, 80), row.id, workerId],
            'Scheduled email lease was lost while retaining the Sent copy retry',
        );
    }

    async retry(row: ScheduledEmailRow, workerId: string, code: string): Promise<void> {
        await this.update(
            `UPDATE scheduled_emails
             SET status = 'retry_wait', available_at = DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? SECOND),
                 last_error_code = ?, last_error_at = UTC_TIMESTAMP(), lease_owner = NULL, lease_expires_at = NULL
             WHERE id = ? AND lease_owner = ? AND status IN ('claimed', 'smtp_inflight') AND smtp_accepted_at IS NULL`,
            [retryDelaySeconds(Number(row.attempts || 1)), code.slice(0, 80), row.id, workerId],
            'Scheduled email lease was lost while recording a retry',
        );
    }

    async failed(row: ScheduledEmailRow, workerId: string, code: string): Promise<void> {
        await this.update(
            `UPDATE scheduled_emails
             SET status = 'failed', last_error_code = ?, last_error_at = UTC_TIMESTAMP(),
                 lease_owner = NULL, lease_expires_at = NULL
             WHERE id = ? AND lease_owner = ? AND smtp_accepted_at IS NULL`,
            [code.slice(0, 80), row.id, workerId], 'Scheduled email lease was lost while recording failure',
        );
    }

    async uncertain(row: ScheduledEmailRow, workerId: string, code: string): Promise<void> {
        await this.update(
            `UPDATE scheduled_emails
             SET status = 'delivery_uncertain', last_error_code = ?, last_error_at = UTC_TIMESTAMP(),
                 lease_owner = NULL, lease_expires_at = NULL
             WHERE id = ? AND lease_owner = ? AND status = 'smtp_inflight'`,
            [code.slice(0, 80), row.id, workerId], 'Scheduled email lease was lost while recording uncertain delivery',
        );
    }
}

export type ScheduledCancellationClaim =
    | { outcome: 'ready'; row: ScheduledEmailRow }
    | { outcome: 'not_found' | 'conflict' };

export const claimScheduledCancellation = async (
    db: any,
    id: number,
    username: string,
    workerId: string,
): Promise<ScheduledCancellationClaim> => {
    const [result]: any = await db.query(
        `UPDATE scheduled_emails
         SET status = 'cancel_restore_pending', lease_owner = ?,
             lease_expires_at = DATE_ADD(UTC_TIMESTAMP(), INTERVAL 120 SECOND)
         WHERE id = ? AND username = ?
           AND (status IN ('scheduled', 'retry_wait')
             OR (status = 'cancel_restore_pending'
               AND (lease_owner IS NULL OR lease_expires_at <= UTC_TIMESTAMP())))`,
        [workerId, id, username],
    );
    if (Number(result?.affectedRows) === 1) {
        const [rows]: any = await db.query(
            `SELECT * FROM scheduled_emails
             WHERE id = ? AND username = ? AND status = 'cancel_restore_pending'
               AND lease_owner = ? LIMIT 1`,
            [id, username, workerId],
        );
        if (!rows?.[0]) throw new Error('Scheduled cancellation payload is unavailable');
        return { outcome: 'ready', row: rows[0] };
    }
    const [rows]: any = await db.query('SELECT status FROM scheduled_emails WHERE id = ? AND username = ? LIMIT 1', [id, username]);
    if (!rows || rows.length === 0 || ['completed', 'cancelled'].includes(String(rows[0].status))) {
        return { outcome: 'not_found' };
    }
    return { outcome: 'conflict' };
};

export const completeScheduledCancellation = async (
    db: any,
    id: number,
    username: string,
    workerId: string,
    restoredDraftUid: number,
): Promise<void> => {
    const [result]: any = await db.query(
        `UPDATE scheduled_emails
         SET status = 'cancelled', cancelled_at = UTC_TIMESTAMP(), raw_message = NULL,
             sent_raw_message = NULL,
             envelope_json = NULL, mail_options = '{}', draft_uid = ?,
             lease_owner = NULL, lease_expires_at = NULL,
             last_error_code = NULL, last_error_at = NULL
         WHERE id = ? AND username = ? AND status = 'cancel_restore_pending'
           AND lease_owner = ?`,
        [restoredDraftUid, id, username, workerId],
    );
    if (Number(result?.affectedRows) !== 1) {
        throw new Error('Scheduled cancellation lease was lost after Draft restoration');
    }
};

export const releaseScheduledCancellation = async (
    db: any,
    id: number,
    username: string,
    workerId: string,
    code: string,
): Promise<void> => {
    const [result]: any = await db.query(
        `UPDATE scheduled_emails
         SET lease_owner = NULL, lease_expires_at = NULL,
             last_error_code = ?, last_error_at = UTC_TIMESTAMP()
         WHERE id = ? AND username = ? AND status = 'cancel_restore_pending'
           AND lease_owner = ?`,
        [code.slice(0, 80), id, username, workerId],
    );
    if (Number(result?.affectedRows) !== 1) {
        throw new Error('Scheduled cancellation lease was lost while retaining its payload');
    }
};

export const removeTerminalScheduledEmail = async (
    db: any,
    id: number,
    username: string,
): Promise<'removed' | 'not_found' | 'conflict'> => {
    const [result]: any = await db.query(
        `DELETE FROM scheduled_emails
         WHERE id = ? AND username = ? AND status IN ('failed', 'delivery_uncertain', 'partial_delivery')`,
        [id, username],
    );
    if (Number(result?.affectedRows) === 1) return 'removed';
    const [rows]: any = await db.query(
        'SELECT status FROM scheduled_emails WHERE id = ? AND username = ? LIMIT 1',
        [id, username],
    );
    return !rows || rows.length === 0 ? 'not_found' : 'conflict';
};

export const abortScheduledEmailBeforeDelivery = async (
    db: any,
    id: number,
    username: string,
): Promise<boolean> => {
    const [result]: any = await db.query(
        `DELETE FROM scheduled_emails
         WHERE id = ? AND username = ? AND status = 'scheduled'
           AND smtp_accepted_at IS NULL`,
        [id, username],
    );
    return Number(result?.affectedRows) === 1;
};

export interface PersistedOutboundMessage {
    username: string;
    sendAt: Date;
    senderAddress: string;
    messageId: string;
    envelope: { from: string; to: string[] };
    raw: Buffer;
    sentRaw?: Buffer;
    metadata: Record<string, any>;
    draftUid?: number | null;
}

export const enqueueScheduledEmail = async (db: any, message: PersistedOutboundMessage): Promise<number> => {
    await ensureScheduledEmailsSchema(db);
    const [result]: any = await db.query(
        `INSERT INTO scheduled_emails
            (username, send_at, mail_options, draft_uid, payload_version, status, available_at, attempts,
             sender_address, message_id, envelope_json, raw_message, sent_raw_message)
         VALUES (?, ?, ?, ?, 2, 'scheduled', ?, 0, ?, ?, ?, ?, ?)`,
        [message.username, message.sendAt, JSON.stringify(message.metadata), message.draftUid || null,
            message.sendAt, message.senderAddress, message.messageId, JSON.stringify(message.envelope), message.raw,
            message.sentRaw || message.raw],
    );
    return Number(result.insertId);
};

export const retainAcceptedSentCopy = async (db: any, message: PersistedOutboundMessage): Promise<number> => {
    await ensureScheduledEmailsSchema(db);
    const [result]: any = await db.query(
        `INSERT INTO scheduled_emails
            (username, send_at, mail_options, draft_uid, payload_version, status, available_at, attempts,
             sender_address, message_id, envelope_json, raw_message, sent_raw_message,
             smtp_accepted_at, last_error_code, last_error_at)
         VALUES (?, ?, ?, ?, 2, 'sent_copy_pending', UTC_TIMESTAMP(), 1, ?, ?, ?, ?, ?, UTC_TIMESTAMP(),
                 'sent_copy_pending', UTC_TIMESTAMP())`,
        [message.username, message.sendAt, JSON.stringify(message.metadata), message.draftUid || null,
            message.senderAddress, message.messageId, JSON.stringify(message.envelope), message.raw,
            message.sentRaw || message.raw],
    );
    return Number(result.insertId);
};

const getScheduledCredential = async (username: string): Promise<string> => {
    if (delegatedAuthEnabled) return '';
    const [rows]: any = await pool.query(
        `SELECT password_ciphertext, password_iv, password_tag FROM (
            SELECT password_ciphertext, password_iv, password_tag, 0 AS credential_priority
            FROM webmail_sessions WHERE username = ? AND expires_at > NOW()
            UNION ALL
            SELECT password_ciphertext, password_iv, password_tag, 1 AS credential_priority
            FROM mailbox_credentials WHERE username = ?
         ) AS credentials ORDER BY credential_priority LIMIT 1`,
        [username, username],
    );
    if (!rows || rows.length === 0) {
        const error: any = new Error('No background mailbox credential is available');
        error.code = 'CREDENTIALS_UNAVAILABLE';
        throw error;
    }
    return decryptPassword(rows[0].password_ciphertext, rows[0].password_iv, rows[0].password_tag);
};

const defaultScheduledDependencies: ScheduledEmailDependencies = {
    getCredential: getScheduledCredential,
    createTransport: (username, password) => nodemailer.createTransport(
        smtpTransportOptions({ user: username, pass: password }),
    ),
    createImap: async (username, password) => {
        const { ImapService } = require('./imap');
        const imap = new ImapService(username, password);
        try {
            await withOperationTimeout(Promise.resolve(imap.connect()), 30_000, () => imap.client?.close?.());
            return imap;
        } catch (error) {
            try { imap.client?.close?.(); } catch {}
            throw error;
        }
    },
    authorizeSender: (username, sender) => authorizeOutboundSender(pool, username, sender),
};

const runningScheduledDatabases = new WeakSet<object>();

export const runScheduledSender = async (
    dependencies: ScheduledEmailDependencies = defaultScheduledDependencies,
    db: any = pool,
    workerId?: string,
) => {
    if (runningScheduledDatabases.has(db)) return 0;
    runningScheduledDatabases.add(db);
    const claimToken = workerId || `webmail-${process.pid}-${crypto.randomUUID()}`;
    try {
        await ensureScheduledEmailsSchema(db);
        const store = new MySqlScheduledEmailStore(db);
        const rows = await store.claimBatch(claimToken, 25);
        for (const row of rows) {
            try {
                await processScheduledEmail(row, claimToken, store, dependencies);
            } catch (error) {
                console.error(`Scheduled email ${row.id} worker failure:`, error);
            }
        }
        return rows.length;
    } finally {
        runningScheduledDatabases.delete(db);
    }
};

export const startScheduledSender = () => {
    const timer = setInterval(() => {
        runScheduledSender().catch(err => console.error('Scheduled sender error:', err));
    }, 10000);
    timer.unref?.();
};
