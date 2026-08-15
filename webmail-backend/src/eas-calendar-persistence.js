"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.acquireActiveSyncCalendarLock = acquireActiveSyncCalendarLock;
exports.releaseActiveSyncCalendarLock = releaseActiveSyncCalendarLock;
exports.saveActiveSyncCalendarEventInTransaction = saveActiveSyncCalendarEventInTransaction;
exports.saveActiveSyncCalendarEvent = saveActiveSyncCalendarEvent;
exports.deleteActiveSyncCalendarEventInTransaction = deleteActiveSyncCalendarEventInTransaction;
exports.deleteActiveSyncCalendarEvent = deleteActiveSyncCalendarEvent;
const crypto_1 = require("crypto");
const db_1 = require("./db");
const calendar_utils_1 = require("./calendar-utils");
const calendar_ical_validation_1 = require("./calendar-ical-validation");
const activeSyncCalendarLockName = (calendarId) => `oms-calendar-${(0, crypto_1.createHash)('sha256').update(String(calendarId)).digest('hex').slice(0, 44)}`;
async function acquireActiveSyncCalendarLock(connection, calendarId) {
    const name = activeSyncCalendarLockName(calendarId);
    const [rows] = await connection.query('SELECT GET_LOCK(?, 10) AS acquired', [name]);
    if (Number(rows[0]?.acquired || 0) !== 1)
        throw new Error('ActiveSync calendar mutation lock was unavailable');
    return { name };
}
async function releaseActiveSyncCalendarLock(connection, lease) {
    const [rows] = await connection.query('SELECT RELEASE_LOCK(?) AS released', [lease.name]);
    if (Number(rows[0]?.released || 0) !== 1)
        throw new Error('ActiveSync calendar mutation lock release failed');
}
async function saveActiveSyncCalendarEventInTransaction(connection, calendarId, resourceName, ical, expectedIcal) {
    let logicalUid;
    try {
        const validated = (0, calendar_ical_validation_1.validateICalendarDocument)(ical);
        if (validated.resources.length !== 1 || validated.resources[0].componentType !== 'VEVENT')
            return 'invalid';
        logicalUid = validated.resources[0].uid;
    }
    catch (error) {
        if (error instanceof calendar_ical_validation_1.ICalendarValidationError)
            return 'invalid';
        throw error;
    }
    if (!resourceName
        || resourceName.endsWith(' ')
        || /[\x00-\x1f\x7f]/.test(resourceName)
        || Array.from(resourceName).length > 255
        || Buffer.byteLength(resourceName, 'utf8') > 1020)
        return 'invalid';
    const [calendarRows] = await connection.query('SELECT sync_token FROM calendars WHERE id = ? LIMIT 1 FOR UPDATE', [calendarId]);
    if (calendarRows.length !== 1)
        throw new Error('Calendar not found');
    const [existingRows] = await connection.query(`SELECT uid, resource_name, ical_data FROM events
         WHERE calendar_id = ? AND BINARY resource_name = BINARY ?
         LIMIT 1 FOR UPDATE`, [calendarId, resourceName]);
    if (expectedIcal !== undefined) {
        const currentIcal = existingRows.length ? String(existingRows[0].ical_data || '') : null;
        if (currentIcal !== expectedIcal)
            return 'conflict';
    }
    const [uidConflicts] = await connection.query(`SELECT resource_name FROM events
         WHERE calendar_id = ? AND BINARY uid = BINARY ?
           AND BINARY resource_name <> BINARY ?
         LIMIT 1 FOR UPDATE`, [calendarId, logicalUid, resourceName]);
    if (uidConflicts.length > 0)
        return 'conflict';
    const eventChanged = existingRows.length === 0
        || String(existingRows[0].uid || '') !== logicalUid
        || String(existingRows[0].ical_data || '') !== ical;
    const [tombstoneResult] = await connection.query('DELETE FROM calendar_tombstones WHERE calendar_id = ? AND BINARY resource_name = BINARY ?', [calendarId, resourceName]);
    if (!eventChanged && !tombstoneResult.affectedRows)
        return 'unchanged';
    const revision = await (0, calendar_utils_1.allocateCalendarCollectionRevisionOnConnection)(connection, calendarId);
    if (existingRows.length > 0) {
        await connection.query(`UPDATE events SET uid = ?, resource_name = ?, ical_data = ?, sync_token = ?
             WHERE calendar_id = ? AND BINARY resource_name = BINARY ?`, [logicalUid, resourceName, ical, revision, calendarId, resourceName]);
    }
    else {
        await connection.query('INSERT INTO events (calendar_id, uid, resource_name, ical_data, sync_token) VALUES (?, ?, ?, ?, ?)', [calendarId, logicalUid, resourceName, ical, revision]);
    }
    return 'changed';
}
async function saveActiveSyncCalendarEvent(calendarId, resourceName, ical, expectedIcal) {
    const connection = await db_1.pool.getConnection();
    try {
        await connection.beginTransaction();
        const result = await saveActiveSyncCalendarEventInTransaction(connection, calendarId, resourceName, ical, expectedIcal);
        if (result === 'changed')
            await connection.commit();
        else {
            await connection.rollback();
        }
        return result;
    }
    catch (error) {
        await connection.rollback();
        throw error;
    }
    finally {
        connection.release();
    }
}
async function deleteActiveSyncCalendarEventInTransaction(connection, calendarId, resourceName, expectedIcal) {
    const [calendarRows] = await connection.query('SELECT sync_token FROM calendars WHERE id = ? LIMIT 1 FOR UPDATE', [calendarId]);
    if (calendarRows.length !== 1)
        throw new Error('Calendar not found');
    const [existingRows] = await connection.query(`SELECT uid, resource_name, ical_data FROM events
         WHERE calendar_id = ? AND BINARY resource_name = BINARY ?
         LIMIT 1 FOR UPDATE`, [calendarId, resourceName]);
    if (existingRows.length !== 1 || String(existingRows[0].ical_data || '') !== expectedIcal)
        return 'conflict';
    const revision = await (0, calendar_utils_1.allocateCalendarCollectionRevisionOnConnection)(connection, calendarId);
    const [deleteResult] = await connection.query('DELETE FROM events WHERE calendar_id = ? AND BINARY resource_name = BINARY ?', [calendarId, resourceName]);
    if (!deleteResult.affectedRows)
        return 'conflict';
    await connection.query(`INSERT INTO calendar_tombstones (calendar_id, uid, resource_name, sync_token, deleted_at)
         VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
         ON DUPLICATE KEY UPDATE uid = VALUES(uid), sync_token = VALUES(sync_token), deleted_at = CURRENT_TIMESTAMP`, [calendarId, String(existingRows[0].uid), resourceName, revision]);
    return 'changed';
}
async function deleteActiveSyncCalendarEvent(calendarId, resourceName, expectedIcal) {
    const connection = await db_1.pool.getConnection();
    try {
        await connection.beginTransaction();
        const result = await deleteActiveSyncCalendarEventInTransaction(connection, calendarId, resourceName, expectedIcal);
        if (result === 'conflict') {
            await connection.rollback();
            return 'conflict';
        }
        await connection.commit();
        return result;
    }
    catch (error) {
        await connection.rollback();
        throw error;
    }
    finally {
        connection.release();
    }
}
//# sourceMappingURL=eas-calendar-persistence.js.map