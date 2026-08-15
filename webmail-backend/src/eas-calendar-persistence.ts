import { createHash } from 'crypto';
import type { PoolConnection } from 'mysql2/promise';
import { pool } from './db';
import { allocateCalendarCollectionRevisionOnConnection } from './calendar-utils';
import { ICalendarValidationError, validateICalendarDocument } from './calendar-ical-validation';

export type ActiveSyncCalendarSaveResult = 'changed' | 'unchanged' | 'conflict' | 'invalid';

export interface ActiveSyncCalendarLockLease {
    name: string;
}

const activeSyncCalendarLockName = (calendarId: number): string =>
    `oms-calendar-${createHash('sha256').update(String(calendarId)).digest('hex').slice(0, 44)}`;

export async function acquireActiveSyncCalendarLock(
    connection: PoolConnection,
    calendarId: number,
): Promise<ActiveSyncCalendarLockLease> {
    const name = activeSyncCalendarLockName(calendarId);
    const [rows]: any = await connection.query('SELECT GET_LOCK(?, 10) AS acquired', [name]);
    if (Number(rows[0]?.acquired || 0) !== 1) throw new Error('ActiveSync calendar mutation lock was unavailable');
    return { name };
}

export async function releaseActiveSyncCalendarLock(
    connection: PoolConnection,
    lease: ActiveSyncCalendarLockLease,
): Promise<void> {
    const [rows]: any = await connection.query('SELECT RELEASE_LOCK(?) AS released', [lease.name]);
    if (Number(rows[0]?.released || 0) !== 1) throw new Error('ActiveSync calendar mutation lock release failed');
}

export async function saveActiveSyncCalendarEventInTransaction(
    connection: PoolConnection,
    calendarId: number,
    resourceName: string,
    ical: string,
    expectedIcal?: string | null,
): Promise<ActiveSyncCalendarSaveResult> {
    let logicalUid: string;
    try {
        const validated = validateICalendarDocument(ical);
        if (validated.resources.length !== 1 || validated.resources[0].componentType !== 'VEVENT') return 'invalid';
        logicalUid = validated.resources[0].uid;
    } catch (error) {
        if (error instanceof ICalendarValidationError) return 'invalid';
        throw error;
    }
    if (!resourceName
        || resourceName.endsWith(' ')
        || /[\x00-\x1f\x7f]/.test(resourceName)
        || Array.from(resourceName).length > 255
        || Buffer.byteLength(resourceName, 'utf8') > 1020) return 'invalid';

    const [calendarRows]: any = await connection.query(
        'SELECT sync_token FROM calendars WHERE id = ? LIMIT 1 FOR UPDATE',
        [calendarId],
    );
    if (calendarRows.length !== 1) throw new Error('Calendar not found');
    const [existingRows]: any = await connection.query(
        `SELECT uid, resource_name, ical_data FROM events
         WHERE calendar_id = ? AND BINARY resource_name = BINARY ?
         LIMIT 1 FOR UPDATE`,
        [calendarId, resourceName],
    );
    if (expectedIcal !== undefined) {
        const currentIcal = existingRows.length ? String(existingRows[0].ical_data || '') : null;
        if (currentIcal !== expectedIcal) return 'conflict';
    }

    const [uidConflicts]: any = await connection.query(
        `SELECT resource_name FROM events
         WHERE calendar_id = ? AND BINARY uid = BINARY ?
           AND BINARY resource_name <> BINARY ?
         LIMIT 1 FOR UPDATE`,
        [calendarId, logicalUid, resourceName],
    );
    if (uidConflicts.length > 0) return 'conflict';

    const eventChanged = existingRows.length === 0
        || String(existingRows[0].uid || '') !== logicalUid
        || String(existingRows[0].ical_data || '') !== ical;

    const [tombstoneResult]: any = await connection.query(
        'DELETE FROM calendar_tombstones WHERE calendar_id = ? AND BINARY resource_name = BINARY ?',
        [calendarId, resourceName],
    );
    if (!eventChanged && !tombstoneResult.affectedRows) return 'unchanged';

    const revision = await allocateCalendarCollectionRevisionOnConnection(connection, calendarId);
    if (existingRows.length > 0) {
        await connection.query(
            `UPDATE events SET uid = ?, resource_name = ?, ical_data = ?, sync_token = ?
             WHERE calendar_id = ? AND BINARY resource_name = BINARY ?`,
            [logicalUid, resourceName, ical, revision, calendarId, resourceName],
        );
    } else {
        await connection.query(
            'INSERT INTO events (calendar_id, uid, resource_name, ical_data, sync_token) VALUES (?, ?, ?, ?, ?)',
            [calendarId, logicalUid, resourceName, ical, revision],
        );
    }
    return 'changed';
}

export async function saveActiveSyncCalendarEvent(
    calendarId: number,
    resourceName: string,
    ical: string,
    expectedIcal?: string | null,
): Promise<ActiveSyncCalendarSaveResult> {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        const result = await saveActiveSyncCalendarEventInTransaction(
            connection, calendarId, resourceName, ical, expectedIcal,
        );
        if (result === 'changed') await connection.commit();
        else {
            await connection.rollback();
        }
        return result;
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
}

export async function deleteActiveSyncCalendarEventInTransaction(
    connection: PoolConnection,
    calendarId: number,
    resourceName: string,
    expectedIcal: string,
): Promise<'changed' | 'conflict'> {
    const [calendarRows]: any = await connection.query(
        'SELECT sync_token FROM calendars WHERE id = ? LIMIT 1 FOR UPDATE',
        [calendarId],
    );
    if (calendarRows.length !== 1) throw new Error('Calendar not found');
    const [existingRows]: any = await connection.query(
        `SELECT uid, resource_name, ical_data FROM events
         WHERE calendar_id = ? AND BINARY resource_name = BINARY ?
         LIMIT 1 FOR UPDATE`,
        [calendarId, resourceName],
    );
    if (existingRows.length !== 1 || String(existingRows[0].ical_data || '') !== expectedIcal) return 'conflict';
    const revision = await allocateCalendarCollectionRevisionOnConnection(connection, calendarId);
    const [deleteResult]: any = await connection.query(
        'DELETE FROM events WHERE calendar_id = ? AND BINARY resource_name = BINARY ?',
        [calendarId, resourceName],
    );
    if (!deleteResult.affectedRows) return 'conflict';
    await connection.query(
        `INSERT INTO calendar_tombstones (calendar_id, uid, resource_name, sync_token, deleted_at)
         VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
         ON DUPLICATE KEY UPDATE uid = VALUES(uid), sync_token = VALUES(sync_token), deleted_at = CURRENT_TIMESTAMP`,
        [calendarId, String(existingRows[0].uid), resourceName, revision],
    );
    return 'changed';
}

export async function deleteActiveSyncCalendarEvent(
    calendarId: number,
    resourceName: string,
    expectedIcal: string,
): Promise<'changed' | 'conflict'> {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        const result = await deleteActiveSyncCalendarEventInTransaction(
            connection, calendarId, resourceName, expectedIcal,
        );
        if (result === 'conflict') {
            await connection.rollback();
            return 'conflict';
        }
        await connection.commit();
        return result;
    } catch (error) {
        await connection.rollback();
        throw error;
    } finally {
        connection.release();
    }
}
