export const OUTBOUND_COMPACTION_VERIFIED_MODE = 'registry-verified-v1' as const;

export type OutboundSubmissionOrigin = 'web' | 'activesync';
export type OutboundCompactionMode = 'disabled' | typeof OUTBOUND_COMPACTION_VERIFIED_MODE;

export interface UniversalOutboundReservation {
    username: string;
    sendAtSql: string;
    mailOptions: string;
    displayMetadata: string;
    draftUid: number | null;
    submissionKind: 'immediate' | 'scheduled';
    submissionOrigin: OutboundSubmissionOrigin;
    idempotencyKey: string;
    requestFingerprint: string;
    saveSentCopy: boolean;
    senderAddress: string;
    messageId: string;
    envelopeJson: string;
    rawMessage: Buffer;
    sentRawMessage: Buffer;
}

export interface UniversalOutboundIdentityRow {
    id: number;
    submission_kind: 'immediate' | 'scheduled';
    submission_origin?: OutboundSubmissionOrigin;
    idempotency_key: string | null;
    request_fingerprint: string | null;
    status: string;
    message_id: string | null;
    send_at: Date | string;
    send_at_utc?: string;
    smtp_accepted_at: Date | null;
    save_in_sent_items: number | boolean;
    rejected_recipients_json: string | null;
    last_error_code: string | null;
    registry_only?: number | boolean;
}

export interface UniversalOutboundReservationResult {
    id: number;
    replayed: boolean;
    existing?: UniversalOutboundIdentityRow;
}

export interface OutboundMaintenanceResult {
    payloadsPurged: number;
    hotRowsRemoved: number;
    tombstonesRemoved: number;
}

export class UniversalOutboundFingerprintConflictError extends Error {
    constructor() {
        super('The idempotency key was already used for a different outbound request');
        this.name = 'UniversalOutboundFingerprintConflictError';
    }
}

const schemaPromises = new WeakMap<object, Promise<void>>();

export const ensureOutboundRegistrySchema = async (db: any): Promise<void> => {
    const existing = schemaPromises.get(db);
    if (existing) return existing;
    const promise = (async () => {
        await db.query(`
            CREATE TABLE IF NOT EXISTS outbound_submission_registry (
                username VARCHAR(255) NOT NULL,
                idempotency_key VARCHAR(128) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
                request_fingerprint CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
                submission_id BIGINT UNSIGNED NOT NULL,
                submission_origin VARCHAR(16) NOT NULL DEFAULT 'web',
                submission_kind VARCHAR(16) NOT NULL,
                terminal_status VARCHAR(32) NULL,
                last_error_code VARCHAR(80) NULL,
                send_at DATETIME NOT NULL,
                smtp_accepted TINYINT(1) NOT NULL DEFAULT 0,
                save_in_sent_items TINYINT(1) NOT NULL DEFAULT 1,
                terminal_at DATETIME NULL,
                hot_row_removed_at DATETIME NULL,
                replay_expires_at DATETIME NULL,
                created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                PRIMARY KEY (username, idempotency_key),
                UNIQUE KEY uq_outbound_registry_submission (submission_id),
                KEY idx_outbound_registry_expiry (replay_expires_at, submission_id)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
        `);
    })();
    schemaPromises.set(db, promise);
    try {
        await promise;
    } catch (error) {
        schemaPromises.delete(db);
        throw error;
    }
};

const isDuplicateKeyError = (error: any): boolean => (
    String(error?.code || '') === 'ER_DUP_ENTRY' || Number(error?.errno) === 1062
);

const transactionConnection = async (db: any): Promise<{ connection: any; release: boolean }> => {
    if (typeof db?.getConnection === 'function') {
        return { connection: await db.getConnection(), release: true };
    }
    if (typeof db?.beginTransaction === 'function'
        && typeof db?.commit === 'function'
        && typeof db?.rollback === 'function') {
        return { connection: db, release: false };
    }
    throw new Error('Universal outbox writes require a transaction-capable database handle');
};

const registryProjectionSql = `
    SELECT submission_id AS id, submission_kind, submission_origin, idempotency_key,
           request_fingerprint, terminal_status AS status, NULL AS message_id, send_at,
           DATE_FORMAT(send_at, '%Y-%m-%dT%H:%i:%s.000Z') AS send_at_utc,
           CASE WHEN smtp_accepted = 1 THEN UTC_TIMESTAMP() ELSE NULL END AS smtp_accepted_at,
           save_in_sent_items, '[]' AS rejected_recipients_json, last_error_code,
           1 AS registry_only
    FROM outbound_submission_registry`;

export const findUniversalOutboundIdentity = async (
    db: any,
    username: string,
    lookup: { id: number } | { idempotencyKey: string },
): Promise<UniversalOutboundIdentityRow | null> => {
    const byId = 'id' in lookup;
    const hotParams = byId ? [lookup.id, username] : [username, lookup.idempotencyKey];
    const hotWhere = byId ? 'id = ? AND username = ?' : 'username = ? AND idempotency_key = ?';
    const [hotRows]: any = await db.query(
        `SELECT id, submission_kind, submission_origin, idempotency_key, request_fingerprint,
                status, message_id, send_at,
                DATE_FORMAT(send_at, '%Y-%m-%dT%H:%i:%s.000Z') AS send_at_utc,
                smtp_accepted_at, save_in_sent_items, rejected_recipients_json, last_error_code
         FROM scheduled_emails WHERE ${hotWhere} LIMIT 1`,
        hotParams,
    );
    if (hotRows?.[0]) return hotRows[0];

    const registryWhere = byId
        ? 'submission_id = ? AND username = ?'
        : 'username = ? AND idempotency_key = ?';
    const [registryRows]: any = await db.query(
        `${registryProjectionSql} WHERE ${registryWhere} AND terminal_status IS NOT NULL LIMIT 1`,
        hotParams,
    );
    return registryRows?.[0] || null;
};

export const reserveUniversalOutbound = async (
    db: any,
    reservation: UniversalOutboundReservation,
): Promise<UniversalOutboundReservationResult> => {
    const { connection, release } = await transactionConnection(db);
    try {
        await connection.beginTransaction();
        const [result]: any = await connection.query(
            `INSERT INTO scheduled_emails
                (username, send_at, mail_options, display_metadata_json, draft_uid, payload_version,
                 submission_kind, submission_origin, idempotency_key, request_fingerprint,
                 save_in_sent_items, status, available_at, attempts, sender_address,
                 message_id, envelope_json, raw_message, sent_raw_message)
             VALUES (?, ?, ?, ?, ?, 2, ?, ?, ?, ?, ?, 'scheduled', ?, 0, ?, ?, ?, ?, ?)`,
            [reservation.username, reservation.sendAtSql, reservation.mailOptions,
                reservation.displayMetadata, reservation.draftUid,
                reservation.submissionKind, reservation.submissionOrigin, reservation.idempotencyKey,
                reservation.requestFingerprint, reservation.saveSentCopy ? 1 : 0,
                reservation.sendAtSql, reservation.senderAddress, reservation.messageId,
                reservation.envelopeJson, reservation.rawMessage, reservation.sentRawMessage],
        );
        const id = Number(result?.insertId);
        if (!Number.isSafeInteger(id) || id <= 0) {
            throw new Error('Outbound submission was not persisted');
        }
        await connection.query(
            `INSERT INTO outbound_submission_registry
                (username, idempotency_key, request_fingerprint, submission_id,
                 submission_origin, submission_kind, send_at, save_in_sent_items)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [reservation.username, reservation.idempotencyKey, reservation.requestFingerprint, id,
                reservation.submissionOrigin, reservation.submissionKind, reservation.sendAtSql,
                reservation.saveSentCopy ? 1 : 0],
        );
        await connection.commit();
        return { id, replayed: false };
    } catch (error) {
        try { await connection.rollback(); } catch {}
        if (!isDuplicateKeyError(error)) throw error;
    } finally {
        if (release) connection.release();
    }

    const existing = await findUniversalOutboundIdentity(
        db,
        reservation.username,
        { idempotencyKey: reservation.idempotencyKey },
    );
    if (!existing) throw new Error('The existing outbound reservation is unavailable');
    if (String(existing.request_fingerprint || '') !== reservation.requestFingerprint) {
        throw new UniversalOutboundFingerprintConflictError();
    }
    if (existing.submission_origin
        && existing.submission_origin !== reservation.submissionOrigin) {
        throw new UniversalOutboundFingerprintConflictError();
    }
    return { id: Number(existing.id), replayed: true, existing };
};

export const abortUniversalOutboundReservation = async (
    db: any,
    id: number,
    username: string,
): Promise<boolean> => {
    const { connection, release } = await transactionConnection(db);
    try {
        await connection.beginTransaction();
        const [rows]: any = await connection.query(
            `SELECT id, idempotency_key, request_fingerprint, submission_origin, submission_kind
             FROM scheduled_emails
             WHERE id = ? AND username = ? AND status = 'scheduled'
               AND submission_kind = 'scheduled' AND smtp_accepted_at IS NULL
             LIMIT 1 FOR UPDATE`,
            [id, username],
        );
        const row = rows?.[0];
        if (!row) {
            await connection.commit();
            return false;
        }
        if (row.idempotency_key !== null) {
            const replayDays = row.submission_origin === 'activesync' ? 400 : 120;
            const [registryResult]: any = await connection.query(
                `UPDATE outbound_submission_registry
                 SET terminal_status = 'cancelled', terminal_at = UTC_TIMESTAMP(),
                     hot_row_removed_at = UTC_TIMESTAMP(),
                     replay_expires_at = DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? DAY)
                 WHERE username = ? AND idempotency_key = ? AND submission_id = ?
                   AND request_fingerprint = ? AND submission_kind = 'scheduled'
                   AND submission_origin = ?`,
                [replayDays, username, row.idempotency_key, id, row.request_fingerprint,
                    row.submission_origin === 'activesync' ? 'activesync' : 'web'],
            );
            if (Number(registryResult?.affectedRows) !== 1) {
                throw new Error('Outbound abort requires its verified replay registry identity');
            }
        }
        const [deleteResult]: any = await connection.query(
            `DELETE FROM scheduled_emails
             WHERE id = ? AND username = ? AND status = 'scheduled'
               AND submission_kind = 'scheduled' AND smtp_accepted_at IS NULL`,
            [id, username],
        );
        if (Number(deleteResult?.affectedRows) !== 1) {
            throw new Error('Outbound reservation changed during abort');
        }
        await connection.commit();
        return true;
    } catch (error) {
        try { await connection.rollback(); } catch {}
        throw error;
    } finally {
        if (release) connection.release();
    }
};

const terminalStatusSql = "('completed', 'failed', 'partial_delivery', 'cancelled')";
const terminalAtSql = 'COALESCE(s.completed_at, s.cancelled_at, s.last_error_at, s.removed_at, s.updated_at, s.created_at)';

export const backfillOutboundRegistry = async (
    db: any,
    batchSize = 100,
): Promise<{ inserted: number; remaining: number }> => {
    const limit = Math.max(1, Math.min(1000, Math.trunc(batchSize)));
    await ensureOutboundRegistrySchema(db);
    const [result]: any = await db.query(
        `INSERT IGNORE INTO outbound_submission_registry
            (username, idempotency_key, request_fingerprint, submission_id,
             submission_origin, submission_kind, terminal_status, last_error_code, send_at,
             smtp_accepted, save_in_sent_items, terminal_at, replay_expires_at)
         SELECT s.username, s.idempotency_key, s.request_fingerprint, s.id,
                CASE
                    WHEN s.submission_origin = 'activesync' OR s.idempotency_key LIKE 'eas:%'
                        THEN 'activesync'
                    ELSE 'web'
                END,
                s.submission_kind,
                CASE
                    WHEN s.status IN ${terminalStatusSql} OR s.status = 'delivery_uncertain'
                        THEN s.status
                    ELSE NULL
                END,
                CASE
                    WHEN s.status IN ${terminalStatusSql} OR s.status = 'delivery_uncertain'
                        THEN s.last_error_code
                    ELSE NULL
                END,
                s.send_at, s.smtp_accepted_at IS NOT NULL, s.save_in_sent_items,
                CASE
                    WHEN s.status IN ${terminalStatusSql} OR s.status = 'delivery_uncertain'
                        THEN ${terminalAtSql}
                    ELSE NULL
                END,
                CASE
                    WHEN s.status IN ${terminalStatusSql}
                        THEN DATE_ADD(${terminalAtSql}, INTERVAL
                            CASE
                                WHEN s.submission_origin = 'activesync' OR s.idempotency_key LIKE 'eas:%'
                                    THEN 400
                                ELSE 120
                            END DAY)
                    ELSE NULL
                END
         FROM scheduled_emails s
         LEFT JOIN outbound_submission_registry r
           ON r.username = s.username AND r.idempotency_key = s.idempotency_key
         WHERE s.idempotency_key IS NOT NULL AND r.username IS NULL
         ORDER BY s.id
         LIMIT ?`,
        [limit],
    );
    const [remainingRows]: any = await db.query(
        `SELECT 1
         FROM scheduled_emails s
         LEFT JOIN outbound_submission_registry r
           ON r.username = s.username AND r.idempotency_key = s.idempotency_key
         WHERE s.idempotency_key IS NOT NULL AND r.username IS NULL
         LIMIT 1`,
    );
    return {
        inserted: Number(result?.affectedRows || 0),
        remaining: remainingRows?.length ? 1 : 0,
    };
};

const assertRegistryCoverage = async (db: any): Promise<void> => {
    const [mismatches]: any = await db.query(
        `SELECT s.id
         FROM scheduled_emails s
         LEFT JOIN outbound_submission_registry r
           ON r.username = s.username AND r.idempotency_key = s.idempotency_key
         WHERE s.idempotency_key IS NOT NULL
           AND (r.username IS NULL OR r.submission_id <> s.id
             OR r.request_fingerprint <> s.request_fingerprint
             OR r.submission_kind <> s.submission_kind
             OR r.submission_origin <> CASE
                 WHEN s.submission_origin = 'activesync' OR s.idempotency_key LIKE 'eas:%'
                     THEN 'activesync'
                 ELSE 'web'
             END)
         LIMIT 1`,
    );
    if (mismatches?.length) {
        throw new Error('Outbound compaction requires a complete verified replay registry');
    }
};

const compactHotRows = async (db: any, batchSize: number): Promise<number> => {
    const { connection, release } = await transactionConnection(db);
    try {
        await connection.beginTransaction();
        const [rows]: any = await connection.query(
            `SELECT s.id, s.username, s.idempotency_key, s.request_fingerprint,
                    s.submission_origin, s.submission_kind, s.status, s.last_error_code, s.send_at,
                    s.smtp_accepted_at, s.save_in_sent_items,
                    ${terminalAtSql} AS terminal_at
             FROM scheduled_emails s
             WHERE s.idempotency_key IS NOT NULL
               AND s.status IN ${terminalStatusSql}
               AND (s.submission_kind <> 'scheduled' OR s.send_at <= UTC_TIMESTAMP())
               AND (
                    (s.submission_kind = 'immediate'
                     AND ${terminalAtSql} <= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 7 DAY))
                 OR (s.submission_kind = 'scheduled'
                     AND ${terminalAtSql} <= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 90 DAY))
               )
             ORDER BY ${terminalAtSql}, s.id
             LIMIT ? FOR UPDATE SKIP LOCKED`,
            [batchSize],
        );
        let removed = 0;
        for (const row of rows || []) {
            const origin = row.submission_origin === 'activesync' ? 'activesync' : 'web';
            const replayDays = origin === 'activesync' ? 400 : 120;
            const [registryResult]: any = await connection.query(
                `UPDATE outbound_submission_registry
                 SET terminal_status = ?, last_error_code = ?, terminal_at = ?,
                     smtp_accepted = ?, save_in_sent_items = ?,
                     hot_row_removed_at = UTC_TIMESTAMP(),
                     replay_expires_at = DATE_ADD(?, INTERVAL ? DAY)
                 WHERE username = ? AND idempotency_key = ? AND submission_id = ?
                   AND request_fingerprint = ? AND submission_kind = ?
                   AND submission_origin = ?`,
                [row.status, row.last_error_code || null, row.terminal_at, row.smtp_accepted_at ? 1 : 0,
                    row.save_in_sent_items ? 1 : 0, row.terminal_at, replayDays,
                    row.username, row.idempotency_key, row.id, row.request_fingerprint,
                    row.submission_kind, origin],
            );
            if (Number(registryResult?.affectedRows) !== 1) {
                throw new Error(`Outbound registry verification failed for submission ${Number(row.id)}`);
            }
            const [deleteResult]: any = await connection.query(
                `DELETE FROM scheduled_emails
                 WHERE id = ? AND username = ? AND idempotency_key = ?
                   AND request_fingerprint = ? AND status = ?`,
                [row.id, row.username, row.idempotency_key, row.request_fingerprint, row.status],
            );
            if (Number(deleteResult?.affectedRows) !== 1) {
                throw new Error(`Outbound hot row changed during compaction for submission ${Number(row.id)}`);
            }
            removed += 1;
        }
        await connection.commit();
        return removed;
    } catch (error) {
        try { await connection.rollback(); } catch {}
        throw error;
    } finally {
        if (release) connection.release();
    }
};

export const compactUniversalOutbox = async (
    db: any,
    options: { mode: OutboundCompactionMode; batchSize?: number },
): Promise<OutboundMaintenanceResult> => {
    if (options.mode !== OUTBOUND_COMPACTION_VERIFIED_MODE) {
        return { payloadsPurged: 0, hotRowsRemoved: 0, tombstonesRemoved: 0 };
    }
    const batchSize = Math.max(1, Math.min(1000, Math.trunc(options.batchSize || 100)));
    await ensureOutboundRegistrySchema(db);
    await assertRegistryCoverage(db);

    const [purgeResult]: any = await db.query(
        `UPDATE scheduled_emails s
         SET s.display_metadata_json = CASE
                 WHEN s.submission_kind = 'scheduled' AND s.display_metadata_json IS NULL
                      AND JSON_VALID(s.mail_options)
                 THEN JSON_OBJECT(
                     'from', COALESCE(JSON_UNQUOTE(JSON_EXTRACT(s.mail_options, '$.from')), ''),
                     'to', COALESCE(JSON_UNQUOTE(JSON_EXTRACT(s.mail_options, '$.to')), ''),
                     'cc', COALESCE(JSON_UNQUOTE(JSON_EXTRACT(s.mail_options, '$.cc')), ''),
                     'bcc', COALESCE(JSON_UNQUOTE(JSON_EXTRACT(s.mail_options, '$.bcc')), ''),
                     'subject', COALESCE(JSON_UNQUOTE(JSON_EXTRACT(s.mail_options, '$.subject')), '')
                 )
                 ELSE s.display_metadata_json
             END,
             s.mail_options = '{}', s.envelope_json = NULL,
             s.raw_message = NULL, s.sent_raw_message = NULL
         WHERE s.idempotency_key IS NOT NULL
           AND s.status IN ${terminalStatusSql}
           AND (s.submission_kind <> 'scheduled' OR s.send_at <= UTC_TIMESTAMP())
           AND ${terminalAtSql} <= DATE_SUB(UTC_TIMESTAMP(), INTERVAL 7 DAY)
           AND (s.mail_options <> '{}' OR s.envelope_json IS NOT NULL
             OR s.raw_message IS NOT NULL OR s.sent_raw_message IS NOT NULL)
         ORDER BY ${terminalAtSql}, s.id
         LIMIT ?`,
        [batchSize],
    );
    const hotRowsRemoved = await compactHotRows(db, batchSize);
    const [tombstoneResult]: any = await db.query(
        `DELETE r FROM outbound_submission_registry r
         LEFT JOIN scheduled_emails s ON s.id = r.submission_id
         WHERE s.id IS NULL AND r.hot_row_removed_at IS NOT NULL
           AND r.terminal_status IN ${terminalStatusSql}
           AND r.replay_expires_at <= UTC_TIMESTAMP()
         ORDER BY r.replay_expires_at, r.submission_id
         LIMIT ?`,
        [batchSize],
    );
    return {
        payloadsPurged: Number(purgeResult?.affectedRows || 0),
        hotRowsRemoved,
        tombstonesRemoved: Number(tombstoneResult?.affectedRows || 0),
    };
};

export const projectMixedBasisInstant = (
    row: any,
    localField = 'send_at',
    utcAlias = 'send_at_utc',
): Date => {
    const value = row.idempotency_key === null ? row[localField] : (row[utcAlias] || row[localField]);
    const instant = value instanceof Date ? value : new Date(value);
    if (!Number.isFinite(instant.getTime())) throw new Error('Outbound schedule contains an invalid instant');
    return instant;
};

export const selectMixedBasisDueRows = async (
    connection: any,
    limit: number,
    now: Date,
): Promise<any[]> => {
    const boundedLimit = Math.max(1, Math.min(100, Math.trunc(limit)));
    const [legacyRows]: any = await connection.query(
        `SELECT scheduled_emails.*,
                DATE_FORMAT(COALESCE(available_at, send_at), '%Y-%m-%dT%H:%i:%s.000Z') AS due_at_utc,
                'local' AS due_basis
         FROM scheduled_emails
         WHERE idempotency_key IS NULL AND status = 'scheduled'
           AND COALESCE(available_at, send_at) <= ?
           AND (lease_expires_at IS NULL OR lease_expires_at <= UTC_TIMESTAMP())
         ORDER BY COALESCE(available_at, send_at), id
         LIMIT ? FOR UPDATE SKIP LOCKED`,
        [now, boundedLimit],
    );
    const [utcRows]: any = await connection.query(
        `SELECT scheduled_emails.*,
                DATE_FORMAT(COALESCE(available_at, send_at), '%Y-%m-%dT%H:%i:%s.000Z') AS due_at_utc,
                'utc' AS due_basis
         FROM scheduled_emails
         WHERE (idempotency_key IS NOT NULL OR status <> 'scheduled')
           AND status IN ('scheduled', 'retry_wait', 'sent_copy_pending')
           AND COALESCE(available_at, send_at) <= UTC_TIMESTAMP()
           AND (lease_expires_at IS NULL OR lease_expires_at <= UTC_TIMESTAMP())
         ORDER BY COALESCE(available_at, send_at), id
         LIMIT ? FOR UPDATE SKIP LOCKED`,
        [boundedLimit],
    );
    return [...(legacyRows || []), ...(utcRows || [])]
        .sort((left, right) => {
            const leftInstant = left.due_basis === 'local'
                ? new Date(left.available_at ?? left.send_at)
                : new Date(left.due_at_utc ?? left.available_at ?? left.send_at);
            const rightInstant = right.due_basis === 'local'
                ? new Date(right.available_at ?? right.send_at)
                : new Date(right.due_at_utc ?? right.available_at ?? right.send_at);
            if (!Number.isFinite(leftInstant.getTime()) || !Number.isFinite(rightInstant.getTime())) {
                throw new Error('Outbound schedule contains an invalid due instant');
            }
            return leftInstant.getTime() - rightInstant.getTime() || Number(left.id) - Number(right.id);
        })
        .slice(0, boundedLimit);
};
