import { pool } from './db';
import crypto from 'crypto';
import { decryptPassword } from './auth';
import {
    delegatedAuthEnabled,
    outboundReleaseMode,
    smtpTransportOptions,
    type OutboundReleaseMode,
} from './config';
import nodemailer from 'nodemailer';
import { getUserSettings, type ContactsSettings } from './user-settings';
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

export type OutboundSubmissionKind = 'immediate' | 'scheduled';

export class OutboundReleaseBridgeError extends Error {
    readonly code = 'OUTBOUND_RELEASE_BRIDGE';
    readonly status = 503;

    constructor() {
        super('Outbound submission is paused while a rollback-compatible release bridge is active');
        this.name = 'OutboundReleaseBridgeError';
    }
}

const requireActiveOutboundRelease = (): void => {
    if (outboundReleaseMode === 'bridge') throw new OutboundReleaseBridgeError();
};

export type CanonicalFingerprintValue = null | boolean | number | string | Date | Buffer
    | CanonicalFingerprintValue[] | { [key: string]: CanonicalFingerprintValue | undefined };

export interface OutboundRequestFingerprintInput {
    submissionKind: OutboundSubmissionKind;
    sendAt: Date;
    username: string;
    senderAddress: string;
    recipients: string[];
    fingerprintSource: CanonicalFingerprintValue;
}

const canonicalFingerprintValue = (value: CanonicalFingerprintValue, seen = new Set<object>()): string => {
    if (value === null) return 'null';
    if (typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
    if (typeof value === 'number') {
        if (!Number.isFinite(value)) throw new Error('Outbound fingerprint values must be finite');
        return Object.is(value, -0) ? '0' : String(value);
    }
    if (value instanceof Date) {
        if (!Number.isFinite(value.getTime())) throw new Error('Outbound fingerprint dates must be valid');
        return JSON.stringify({ $date: value.toISOString() });
    }
    if (Buffer.isBuffer(value)) {
        return JSON.stringify({
            $bufferLength: value.length,
            $bufferSha256: crypto.createHash('sha256').update(value).digest('hex'),
        });
    }
    if (seen.has(value)) throw new Error('Outbound fingerprint values must not contain cycles');
    seen.add(value);
    try {
        if (Array.isArray(value)) {
            return `[${value.map(item => canonicalFingerprintValue(item, seen)).join(',')}]`;
        }
        const prototype = Object.getPrototypeOf(value);
        if (prototype !== Object.prototype && prototype !== null) {
            throw new Error('Outbound fingerprint values must contain only plain objects');
        }
        const entries = Object.keys(value).sort().flatMap(key => {
            const item = value[key];
            return item === undefined ? [] : [`${JSON.stringify(key)}:${canonicalFingerprintValue(item, seen)}`];
        });
        return `{${entries.join(',')}}`;
    } finally {
        seen.delete(value);
    }
};

export const computeOutboundRequestFingerprint = (input: OutboundRequestFingerprintInput): string => {
    const username = normalizeMailboxAddress(input.username);
    const senderAddress = normalizeMailboxAddress(input.senderAddress);
    const recipients = Array.from(new Set(input.recipients.map(normalizeMailboxAddress).filter(Boolean) as string[])).sort();
    if (!username || !senderAddress || recipients.length === 0) {
        throw new Error('Outbound fingerprint mailbox identities are invalid');
    }
    const payload: CanonicalFingerprintValue = {
        submissionKind: input.submissionKind,
        sendAt: input.submissionKind === 'scheduled' ? input.sendAt : null,
        username,
        senderAddress,
        recipients,
        request: input.fingerprintSource,
    };
    return crypto.createHash('sha256').update(canonicalFingerprintValue(payload)).digest('hex');
};

export interface ScheduledEmailRow {
    id: number;
    username: string;
    send_at: Date;
    mail_options: string;
    draft_uid: number | null;
    payload_version?: number;
    submission_kind?: OutboundSubmissionKind;
    idempotency_key?: string | null;
    request_fingerprint?: string | null;
    save_in_sent_items?: number | boolean;
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
    removed_at?: Date | null;
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
    onAccepted?(row: ScheduledEmailRow, acceptedRecipients: string[]): Promise<void>;
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

const smtpResponseCode = (error: any): number | null => {
    const responseCode = Number(error?.responseCode);
    return Number.isInteger(responseCode) && responseCode >= 100 && responseCode <= 599
        ? responseCode
        : null;
};

const privacySafeErrorToken = (value: unknown): string => (
    String(value).replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 32)
);

const smtpErrorCode = (error: any): string => (
    [error?.code || error?.name || 'delivery_failed', error?.command, smtpResponseCode(error)]
        .filter(value => value !== null && value !== undefined && value !== '')
        .map(privacySafeErrorToken)
        .join(':')
        .slice(0, 80)
);

export const classifyScheduledSmtpError = (
    error: any,
): 'safe_to_retry' | 'permanent_failure' | 'delivery_uncertain' => {
    const responseCode = smtpResponseCode(error);
    if (responseCode !== null && responseCode >= 500) return 'permanent_failure';
    if (responseCode !== null && responseCode >= 400) return 'safe_to_retry';
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
    const saveSentCopy = row.save_in_sent_items === undefined || Boolean(row.save_in_sent_items);
    const completeWithoutSentCopy = async (): Promise<ScheduledEmailStatus> => {
        await store.renewSentCopyLease?.(row, workerId);
        await store.complete?.(row, workerId);
        const rejectedRecipients = JSON.parse(String(row.rejected_recipients_json || '[]'));
        return Array.isArray(rejectedRecipients) && rejectedRecipients.length > 0
            ? 'partial_delivery'
            : 'completed';
    };
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
    if (accepted && !saveSentCopy) {
        return completeWithoutSentCopy();
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
            try {
                if (dependencies.onAccepted) {
                    await withOperationTimeout(
                        Promise.resolve(dependencies.onAccepted(row, recipientOutcome.accepted)),
                        Math.min(5_000, operationTimeoutMs),
                    );
                }
            } catch (error) {
                console.error(`Outbound submission ${row.id} acceptance side effect failed:`, smtpErrorCode(error));
            }
        } catch (error) {
            const code = smtpErrorCode(error);
            const classification = classifyScheduledSmtpError(error);
            if (smtpAccepted || classification === 'delivery_uncertain') {
                await store.uncertain?.(row, workerId, code);
                return 'delivery_uncertain';
            }
            if (classification === 'permanent_failure') {
                await store.failed?.(row, workerId, code);
                return 'failed';
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

    if (!saveSentCopy) {
        return completeWithoutSentCopy();
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
    submission_kind: "VARCHAR(16) NOT NULL DEFAULT 'scheduled' AFTER payload_version",
    idempotency_key: 'VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER submission_kind',
    request_fingerprint: 'CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER idempotency_key',
    save_in_sent_items: 'TINYINT(1) NOT NULL DEFAULT 1 AFTER request_fingerprint',
    status: "VARCHAR(32) NOT NULL DEFAULT 'scheduled' AFTER save_in_sent_items",
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
    removed_at: 'DATETIME NULL AFTER cancelled_at',
    last_error_code: 'VARCHAR(80) NULL AFTER removed_at',
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
                submission_kind VARCHAR(16) NOT NULL DEFAULT 'scheduled',
                idempotency_key VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NULL,
                request_fingerprint CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NULL,
                save_in_sent_items TINYINT(1) NOT NULL DEFAULT 1,
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
                removed_at DATETIME NULL,
                last_error_code VARCHAR(80) NULL,
                last_error_at DATETIME NULL,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                KEY idx_send_at (send_at),
                KEY idx_scheduled_claim (status, available_at, lease_expires_at, id),
                KEY idx_scheduled_owner_state (username, status, send_at, id),
                UNIQUE KEY uq_scheduled_owner_idempotency (username, idempotency_key)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
        const [columnRows]: any = await db.query(
            `SELECT COLUMN_NAME, COLUMN_TYPE FROM INFORMATION_SCHEMA.COLUMNS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'scheduled_emails'`,
        );
        const columns = new Set((columnRows || []).map((row: any) => String(row.COLUMN_NAME || row.column_name)));
        const columnAlterations = Object.entries(scheduledColumnDefinitions)
            .filter(([name]) => !columns.has(name))
            .map(([name, definition]) => `ADD COLUMN ${name} ${definition}`);
        const attemptsColumn = (columnRows || []).find((row: any) => String(row.COLUMN_NAME || row.column_name) === 'attempts');
        if (attemptsColumn && !String(attemptsColumn.COLUMN_TYPE || attemptsColumn.column_type || '').toLowerCase().startsWith('int')) {
            columnAlterations.push('MODIFY COLUMN attempts INT UNSIGNED NOT NULL DEFAULT 0');
        }
        if (columnAlterations.length > 0) {
            await db.query(`ALTER TABLE scheduled_emails ${columnAlterations.join(', ')}`);
        }
        await db.query(
            `UPDATE scheduled_emails
             SET status = COALESCE(NULLIF(status, ''), 'scheduled'),
                 available_at = COALESCE(available_at, send_at),
                 sender_address = COALESCE(NULLIF(sender_address, ''), username),
                 payload_version = COALESCE(payload_version, 1),
                 submission_kind = COALESCE(NULLIF(submission_kind, ''), 'scheduled')
             WHERE available_at IS NULL OR sender_address IS NULL OR sender_address = ''
                OR status = '' OR submission_kind = ''`,
        );
        const [indexRows]: any = await db.query(
            `SELECT DISTINCT INDEX_NAME FROM INFORMATION_SCHEMA.STATISTICS
             WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'scheduled_emails'`,
        );
        const indexes = new Set((indexRows || []).map((row: any) => String(row.INDEX_NAME || row.index_name)));
        const indexAlterations: string[] = [];
        if (!indexes.has('idx_scheduled_claim')) {
            indexAlterations.push('ADD KEY idx_scheduled_claim (status, available_at, lease_expires_at, id)');
        }
        if (!indexes.has('idx_scheduled_owner_state')) {
            indexAlterations.push('ADD KEY idx_scheduled_owner_state (username, status, send_at, id)');
        }
        if (!indexes.has('uq_scheduled_owner_idempotency')) {
            indexAlterations.push('ADD UNIQUE KEY uq_scheduled_owner_idempotency (username, idempotency_key)');
        }
        if (indexAlterations.length > 0) {
            await db.query(`ALTER TABLE scheduled_emails ${indexAlterations.join(', ')}`);
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
    constructor(
        private readonly db: any = pool,
        private readonly releaseMode: OutboundReleaseMode = outboundReleaseMode,
    ) {}

    async claimById(
        id: number,
        username: string,
        workerId: string,
    ): Promise<ScheduledEmailRow | null> {
        if (this.releaseMode === 'bridge') return null;
        const connection = await this.db.getConnection();
        try {
            await connection.beginTransaction();
            await connection.query(
                `UPDATE scheduled_emails
                 SET status = 'delivery_uncertain', last_error_code = 'lease_expired_during_smtp',
                     raw_message = CASE WHEN submission_kind = 'immediate' THEN NULL ELSE raw_message END,
                     sent_raw_message = CASE WHEN submission_kind = 'immediate' THEN NULL ELSE sent_raw_message END,
                     envelope_json = CASE WHEN submission_kind = 'immediate' THEN NULL ELSE envelope_json END,
                     mail_options = CASE WHEN submission_kind = 'immediate' THEN '{}' ELSE mail_options END,
                     last_error_at = UTC_TIMESTAMP(), lease_owner = NULL, lease_expires_at = NULL
                 WHERE id = ? AND username = ? AND submission_kind = 'immediate'
                   AND status = 'smtp_inflight' AND lease_expires_at <= UTC_TIMESTAMP()`,
                [id, username],
            );
            await connection.query(
                `UPDATE scheduled_emails
                 SET status = 'retry_wait', available_at = UTC_TIMESTAMP(),
                     last_error_code = 'lease_expired_before_smtp', last_error_at = UTC_TIMESTAMP(),
                     lease_owner = NULL, lease_expires_at = NULL
                 WHERE id = ? AND username = ? AND submission_kind = 'immediate'
                   AND status = 'claimed' AND lease_expires_at <= UTC_TIMESTAMP()`,
                [id, username],
            );
            const [rows]: any = await connection.query(
                `SELECT * FROM scheduled_emails
                 WHERE id = ? AND username = ? AND submission_kind = 'immediate'
                   AND status IN ('scheduled', 'retry_wait', 'sent_copy_pending')
                   AND COALESCE(available_at, send_at) <= UTC_TIMESTAMP()
                   AND (lease_expires_at IS NULL OR lease_expires_at <= UTC_TIMESTAMP())
                 LIMIT 1 FOR UPDATE SKIP LOCKED`,
                [id, username],
            );
            const row = rows?.[0] as ScheduledEmailRow | undefined;
            if (!row) {
                await connection.commit();
                return null;
            }
            const previousStatus = String(row.status || 'scheduled') as ScheduledEmailStatus;
            const [result]: any = previousStatus === 'sent_copy_pending'
                ? await connection.query(
                    `UPDATE scheduled_emails
                     SET attempts = attempts + 1, lease_owner = ?,
                         lease_expires_at = DATE_ADD(UTC_TIMESTAMP(), INTERVAL 120 SECOND)
                     WHERE id = ? AND username = ? AND submission_kind = 'immediate'
                       AND status = 'sent_copy_pending'`,
                    [workerId, id, username],
                )
                : await connection.query(
                    `UPDATE scheduled_emails
                     SET status = 'claimed', attempts = attempts + 1, lease_owner = ?,
                         lease_expires_at = DATE_ADD(UTC_TIMESTAMP(), INTERVAL 120 SECOND)
                     WHERE id = ? AND username = ? AND submission_kind = 'immediate'
                       AND status = ?`,
                    [workerId, id, username, previousStatus],
                );
            if (Number(result?.affectedRows) !== 1) {
                throw new Error('Outbound submission was claimed by another worker');
            }
            row.status = previousStatus === 'sent_copy_pending' ? 'sent_copy_pending' : 'claimed';
            row.attempts = Number(row.attempts || 0) + 1;
            row.lease_owner = workerId;
            await connection.commit();
            return row;
        } catch (error) {
            await connection.rollback();
            throw error;
        } finally {
            connection.release();
        }
    }

    async claimBatch(workerId: string, limit = 25): Promise<ScheduledEmailRow[]> {
        if (this.releaseMode === 'bridge') return [];
        const connection = await this.db.getConnection();
        try {
            await connection.beginTransaction();
            await connection.query(
                `UPDATE scheduled_emails
                 SET status = 'delivery_uncertain', last_error_code = 'lease_expired_during_smtp',
                     raw_message = CASE WHEN submission_kind = 'immediate' THEN NULL ELSE raw_message END,
                     sent_raw_message = CASE WHEN submission_kind = 'immediate' THEN NULL ELSE sent_raw_message END,
                     envelope_json = CASE WHEN submission_kind = 'immediate' THEN NULL ELSE envelope_json END,
                     mail_options = CASE WHEN submission_kind = 'immediate' THEN '{}' ELSE mail_options END,
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
                   AND (
                       (idempotency_key IS NULL AND status = 'scheduled'
                        AND COALESCE(available_at, send_at) <= ?)
                       OR ((idempotency_key IS NOT NULL OR status <> 'scheduled')
                           AND COALESCE(available_at, send_at) <= UTC_TIMESTAMP())
                   )
                   AND (lease_expires_at IS NULL OR lease_expires_at <= UTC_TIMESTAMP())
                 ORDER BY COALESCE(available_at, send_at), id
                 LIMIT ? FOR UPDATE SKIP LOCKED`,
                [new Date(), Math.max(1, Math.min(100, Math.trunc(limit)))],
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
                     mail_options = CASE WHEN submission_kind = 'immediate' THEN '{}' ELSE mail_options END,
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
                 raw_message = CASE WHEN submission_kind = 'immediate' THEN NULL ELSE raw_message END,
                 sent_raw_message = CASE WHEN submission_kind = 'immediate' THEN NULL ELSE sent_raw_message END,
                 envelope_json = CASE WHEN submission_kind = 'immediate' THEN NULL ELSE envelope_json END,
                 mail_options = CASE WHEN submission_kind = 'immediate' THEN '{}' ELSE mail_options END,
                 lease_owner = NULL, lease_expires_at = NULL
             WHERE id = ? AND lease_owner = ? AND smtp_accepted_at IS NULL`,
            [code.slice(0, 80), row.id, workerId], 'Scheduled email lease was lost while recording failure',
        );
    }

    async uncertain(row: ScheduledEmailRow, workerId: string, code: string): Promise<void> {
        await this.update(
             `UPDATE scheduled_emails
             SET status = 'delivery_uncertain', last_error_code = ?, last_error_at = UTC_TIMESTAMP(),
                 raw_message = CASE WHEN submission_kind = 'immediate' THEN NULL ELSE raw_message END,
                 sent_raw_message = CASE WHEN submission_kind = 'immediate' THEN NULL ELSE sent_raw_message END,
                 envelope_json = CASE WHEN submission_kind = 'immediate' THEN NULL ELSE envelope_json END,
                 mail_options = CASE WHEN submission_kind = 'immediate' THEN '{}' ELSE mail_options END,
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
    requireActiveOutboundRelease();
    const [result]: any = await db.query(
        `UPDATE scheduled_emails
         SET status = 'cancel_restore_pending', lease_owner = ?,
             lease_expires_at = DATE_ADD(UTC_TIMESTAMP(), INTERVAL 120 SECOND)
         WHERE id = ? AND username = ? AND submission_kind = 'scheduled'
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
    requireActiveOutboundRelease();
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
    requireActiveOutboundRelease();
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
    requireActiveOutboundRelease();
    const [result]: any = await db.query(
        `UPDATE scheduled_emails
         SET removed_at = UTC_TIMESTAMP(), mail_options = '{}', envelope_json = NULL,
             raw_message = NULL, sent_raw_message = NULL,
             lease_owner = NULL, lease_expires_at = NULL
         WHERE id = ? AND username = ? AND submission_kind = 'scheduled'
           AND status IN ('failed', 'delivery_uncertain', 'partial_delivery')
           AND removed_at IS NULL`,
        [id, username],
    );
    if (Number(result?.affectedRows) === 1) return 'removed';
    const [rows]: any = await db.query(
        'SELECT status, removed_at FROM scheduled_emails WHERE id = ? AND username = ? LIMIT 1',
        [id, username],
    );
    if (!rows || rows.length === 0 || rows[0].removed_at) return 'not_found';
    return 'conflict';
};

export const abortScheduledEmailBeforeDelivery = async (
    db: any,
    id: number,
    username: string,
): Promise<boolean> => {
    requireActiveOutboundRelease();
    const [result]: any = await db.query(
        `DELETE FROM scheduled_emails
         WHERE id = ? AND username = ? AND status = 'scheduled'
           AND submission_kind = 'scheduled'
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
    saveSentCopy?: boolean;
}

export interface OutboundSubmissionInput {
    submissionKind: OutboundSubmissionKind;
    idempotencyKey: string;
    fingerprintSource: CanonicalFingerprintValue;
    message: PersistedOutboundMessage;
    requestCredential?: string;
}

export interface OutboundSubmissionStatus {
    id: number;
    submissionKind: OutboundSubmissionKind;
    status: ScheduledEmailStatus;
    messageId: string | null;
    sendAt: Date;
    smtpAccepted: boolean;
    saveSentCopy: boolean;
    rejectedRecipients: string[];
    lastErrorCode: string | null;
}

export interface OutboundSubmissionResult extends OutboundSubmissionStatus {
    replayed: boolean;
}

export type OutboundSubmissionLookup = { id: number } | { idempotencyKey: string };

export interface SubmitOutboundRuntime {
    workerId?: string;
    dependencies?: Partial<ScheduledEmailDependencies>;
}

export class OutboundIdempotencyKeyError extends Error {
    readonly code = 'OUTBOUND_IDEMPOTENCY_KEY_INVALID';
    readonly status = 400;

    constructor(message = 'An ASCII idempotency key between 1 and 128 characters is required') {
        super(message);
        this.name = 'OutboundIdempotencyKeyError';
    }
}

export class OutboundIdempotencyConflictError extends Error {
    readonly code = 'OUTBOUND_IDEMPOTENCY_CONFLICT';
    readonly status = 409;

    constructor() {
        super('The idempotency key was already used for a different outbound request');
        this.name = 'OutboundIdempotencyConflictError';
    }
}

export class OutboundSubmissionUnavailableError extends Error {
    readonly code = 'OUTBOUND_SUBMISSION_UNAVAILABLE';
    readonly status = 503;

    constructor(cause?: unknown) {
        super('The durable outbound submission service is unavailable', { cause });
        this.name = 'OutboundSubmissionUnavailableError';
    }
}

const normalizeOutboundIdempotencyKey = (value: unknown): string => {
    if (typeof value !== 'string' || !/^[\x21-\x7e]{1,128}$/.test(value)) {
        throw new OutboundIdempotencyKeyError();
    }
    return value;
};

const outboundSqlUtcDate = (value: Date): string => (
    value.toISOString().slice(0, 19).replace('T', ' ')
);

const isDuplicateKeyError = (error: any): boolean => (
    String(error?.code || '') === 'ER_DUP_ENTRY' || Number(error?.errno) === 1062
);

const rowRejectedRecipients = (row: any): string[] => {
    try {
        const values = JSON.parse(String(row?.rejected_recipients_json || '[]'));
        return Array.isArray(values)
            ? values.filter(value => typeof value === 'string').map(String)
            : [];
    } catch {
        return [];
    }
};

const projectOutboundSubmission = (row: any): OutboundSubmissionStatus => {
    const sendAt = row.idempotency_key === null
        ? row.send_at
        : row.send_at_utc || row.send_at;
    return {
        id: Number(row.id),
        submissionKind: row.submission_kind === 'immediate' ? 'immediate' : 'scheduled',
        status: String(row.status || 'scheduled') as ScheduledEmailStatus,
        messageId: row.message_id ? String(row.message_id) : null,
        sendAt: sendAt instanceof Date ? sendAt : new Date(sendAt),
        smtpAccepted: Boolean(row.smtp_accepted_at),
        saveSentCopy: row.save_in_sent_items === undefined || Boolean(row.save_in_sent_items),
        rejectedRecipients: rowRejectedRecipients(row),
        lastErrorCode: row.last_error_code ? String(row.last_error_code) : null,
    };
};

export const getOutboundSubmission = async (
    db: any,
    username: string,
    lookup: OutboundSubmissionLookup,
): Promise<OutboundSubmissionStatus | null> => {
    await ensureScheduledEmailsSchema(db);
    let sql = '';
    let params: any[] = [];
    if ('id' in lookup) {
        if (!Number.isSafeInteger(lookup.id) || lookup.id <= 0) return null;
        sql = `SELECT id, submission_kind, idempotency_key, status, message_id, send_at,
                      DATE_FORMAT(send_at, '%Y-%m-%dT%H:%i:%s.000Z') AS send_at_utc,
                      smtp_accepted_at,
                      save_in_sent_items, rejected_recipients_json, last_error_code
               FROM scheduled_emails WHERE id = ? AND username = ? LIMIT 1`;
        params = [lookup.id, username];
    } else {
        const key = normalizeOutboundIdempotencyKey(lookup.idempotencyKey);
        sql = `SELECT id, submission_kind, idempotency_key, status, message_id, send_at,
                      DATE_FORMAT(send_at, '%Y-%m-%dT%H:%i:%s.000Z') AS send_at_utc,
                      smtp_accepted_at,
                      save_in_sent_items, rejected_recipients_json, last_error_code
               FROM scheduled_emails WHERE username = ? AND idempotency_key = ? LIMIT 1`;
        params = [username, key];
    }
    const [rows]: any = await db.query(sql, params);
    return rows?.[0] ? projectOutboundSubmission(rows[0]) : null;
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
    onAccepted: async (row, acceptedRecipients) => {
        const contactsSettings = await getUserSettings(row.username, 'contacts') as ContactsSettings;
        if (contactsSettings.autoCreateFromSent === false) return;
        for (const recipient of acceptedRecipients) {
            const address = normalizeMailboxAddress(recipient);
            if (!address) continue;
            try {
                await pool.query(
                    'INSERT IGNORE INTO contacts (username, name, email) VALUES (?, ?, ?)',
                    [row.username, address.slice(0, address.indexOf('@')), address],
                );
            } catch {}
        }
    },
};

export const submitOutbound = async (
    db: any,
    input: OutboundSubmissionInput,
    runtime: SubmitOutboundRuntime = {},
): Promise<OutboundSubmissionResult> => {
    requireActiveOutboundRelease();
    try {
        await ensureScheduledEmailsSchema(db);
    } catch (error) {
        throw new OutboundSubmissionUnavailableError(error);
    }
    if (input.submissionKind !== 'immediate' && input.submissionKind !== 'scheduled') {
        throw new Error('Outbound submission kind is invalid');
    }
    const idempotencyKey = normalizeOutboundIdempotencyKey(input.idempotencyKey);
    const message = input.message;
    if (!Buffer.isBuffer(message.raw) || (message.sentRaw !== undefined && !Buffer.isBuffer(message.sentRaw))
        || !message.messageId || !message.envelope || !Array.isArray(message.envelope.to)
        || message.envelope.to.length === 0) {
        throw new Error('Outbound submission payload is incomplete');
    }
    const requestedSendAt = message.sendAt instanceof Date ? message.sendAt : new Date(message.sendAt);
    if (!Number.isFinite(requestedSendAt.getTime())) throw new Error('Outbound submission time is invalid');
    const sendAt = input.submissionKind === 'scheduled' ? requestedSendAt : new Date();
    const sendAtSql = outboundSqlUtcDate(sendAt);
    const saveSentCopy = message.saveSentCopy !== false;
    const requestFingerprint = computeOutboundRequestFingerprint({
        submissionKind: input.submissionKind,
        sendAt,
        username: message.username,
        senderAddress: message.senderAddress,
        recipients: message.envelope.to,
        fingerprintSource: {
            request: input.fingerprintSource,
            saveSentCopy,
        },
    });
    let id = 0;
    try {
        const [result]: any = await db.query(
            `INSERT INTO scheduled_emails
                (username, send_at, mail_options, draft_uid, payload_version,
                 submission_kind, idempotency_key, request_fingerprint, save_in_sent_items,
                 status, available_at, attempts, sender_address, message_id, envelope_json,
                 raw_message, sent_raw_message)
             VALUES (?, ?, ?, ?, 2, ?, ?, ?, ?, 'scheduled', ?, 0, ?, ?, ?, ?, ?)`,
            [message.username, sendAtSql, JSON.stringify(message.metadata), message.draftUid || null,
                input.submissionKind, idempotencyKey, requestFingerprint, saveSentCopy ? 1 : 0,
                sendAtSql, message.senderAddress, message.messageId, JSON.stringify(message.envelope),
                message.raw, message.sentRaw || message.raw],
        );
        id = Number(result?.insertId);
        if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Outbound submission was not persisted');
    } catch (error) {
        if (!isDuplicateKeyError(error)) {
            throw new OutboundSubmissionUnavailableError(error);
        }
        let rows: any;
        try {
            [rows] = await db.query(
                `SELECT id, submission_kind, idempotency_key, status, message_id, send_at,
                        DATE_FORMAT(send_at, '%Y-%m-%dT%H:%i:%s.000Z') AS send_at_utc,
                        smtp_accepted_at,
                        save_in_sent_items, rejected_recipients_json, last_error_code, request_fingerprint
                 FROM scheduled_emails WHERE username = ? AND idempotency_key = ? LIMIT 1`,
                [message.username, idempotencyKey],
            );
        } catch (lookupError) {
            throw new OutboundSubmissionUnavailableError(lookupError);
        }
        const existing = rows?.[0];
        if (!existing) throw new OutboundSubmissionUnavailableError(error);
        if (String(existing.request_fingerprint || '') !== requestFingerprint) {
            throw new OutboundIdempotencyConflictError();
        }
        return { ...projectOutboundSubmission(existing), replayed: true };
    }

    if (input.submissionKind === 'immediate') {
        const workerId = runtime.workerId || `request-${process.pid}-${crypto.randomUUID()}`;
        const store = new MySqlScheduledEmailStore(db);
        try {
            const row = await store.claimById(id, message.username, workerId);
            if (row) {
                const baseDependencies: ScheduledEmailDependencies = {
                    ...defaultScheduledDependencies,
                    ...runtime.dependencies,
                };
                const dependencies = input.requestCredential === undefined
                    ? baseDependencies
                    : {
                        ...baseDependencies,
                        getCredential: async (username: string) => {
                            if (normalizeMailboxAddress(username) !== normalizeMailboxAddress(message.username)) {
                                throw new Error('Outbound request credential owner mismatch');
                            }
                            return input.requestCredential!;
                        },
                    };
                await processScheduledEmail(row, workerId, store, dependencies);
            }
        } catch (error) {
            throw new OutboundSubmissionUnavailableError(error);
        }
    }

    let result: OutboundSubmissionStatus | null;
    try {
        result = await getOutboundSubmission(db, message.username, { id });
    } catch (error) {
        if (error instanceof OutboundIdempotencyKeyError) throw error;
        throw new OutboundSubmissionUnavailableError(error);
    }
    if (!result) throw new OutboundSubmissionUnavailableError();
    return { ...result, replayed: false };
};

const runningScheduledDatabases = new WeakSet<object>();

export const runScheduledSender = async (
    dependencies: ScheduledEmailDependencies = defaultScheduledDependencies,
    db: any = pool,
    workerId?: string,
) => {
    if (outboundReleaseMode === 'bridge') return 0;
    if (runningScheduledDatabases.has(db)) return 0;
    runningScheduledDatabases.add(db);
    const claimToken = workerId || `webmail-${process.pid}-${crypto.randomUUID()}`;
    try {
        await ensureScheduledEmailsSchema(db);
        const store = new MySqlScheduledEmailStore(db);
        let processed = 0;
        while (processed < 25) {
            const [row] = await store.claimBatch(claimToken, 1);
            if (!row) break;
            processed += 1;
            try {
                await processScheduledEmail(row, claimToken, store, dependencies);
            } catch (error) {
                console.error(`Scheduled email ${row.id} worker failure:`, error);
            }
        }
        return processed;
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
