"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.slugifyCalendarName = exports.parseIcalEvent = exports.getCalendarFolderSyncKey = exports.formatActiveSyncDate = exports.extractIcalEventUid = exports.expandRecurringEvent = void 0;
exports.isReservedManagedCalendarSlug = isReservedManagedCalendarSlug;
exports.allocateCalendarCollectionRevisionOnConnection = allocateCalendarCollectionRevisionOnConnection;
exports.ensureCalendarSchema = ensureCalendarSchema;
exports.ensureCalendarSlug = ensureCalendarSlug;
exports.createCalendar = createCalendar;
exports.ensureDefaultCalendar = ensureDefaultCalendar;
exports.getCalendarByToken = getCalendarByToken;
exports.getVisibleCalendars = getVisibleCalendars;
exports.getCalendarHref = getCalendarHref;
const db_1 = require("./db");
const calendar_format_1 = require("./calendar-format");
const crypto = __importStar(require("crypto"));
var calendar_format_2 = require("./calendar-format");
Object.defineProperty(exports, "expandRecurringEvent", { enumerable: true, get: function () { return calendar_format_2.expandRecurringEvent; } });
Object.defineProperty(exports, "extractIcalEventUid", { enumerable: true, get: function () { return calendar_format_2.extractIcalEventUid; } });
Object.defineProperty(exports, "formatActiveSyncDate", { enumerable: true, get: function () { return calendar_format_2.formatActiveSyncDate; } });
Object.defineProperty(exports, "getCalendarFolderSyncKey", { enumerable: true, get: function () { return calendar_format_2.getCalendarFolderSyncKey; } });
Object.defineProperty(exports, "parseIcalEvent", { enumerable: true, get: function () { return calendar_format_2.parseIcalEvent; } });
Object.defineProperty(exports, "slugifyCalendarName", { enumerable: true, get: function () { return calendar_format_2.slugifyCalendarName; } });
const RESERVED_MANAGED_CALENDAR_SLUGS = new Set(['birthdays']);
function isReservedManagedCalendarSlug(value) {
    return RESERVED_MANAGED_CALENDAR_SLUGS.has((0, calendar_format_1.slugifyCalendarName)(value));
}
/**
 * Allocate the one collection revision shared by every event/tombstone changed
 * in the caller's transaction. Callers must roll the transaction back when no
 * durable calendar resource changed.
 */
async function allocateCalendarCollectionRevisionOnConnection(connection, calendarId) {
    const [rows] = await connection.query('SELECT sync_token FROM calendars WHERE id = ? LIMIT 1 FOR UPDATE', [calendarId]);
    if (rows.length !== 1)
        throw new Error('Calendar not found while allocating collection revision');
    const currentRevision = Number(rows[0].sync_token || 0);
    if (!Number.isSafeInteger(currentRevision) || currentRevision < 0 || currentRevision >= Number.MAX_SAFE_INTEGER) {
        throw new Error('Calendar collection revision is invalid');
    }
    const nextRevision = currentRevision + 1;
    const [result] = await connection.query('UPDATE calendars SET sync_token = ? WHERE id = ? AND sync_token = ?', [nextRevision, calendarId, currentRevision]);
    if (Number(result.affectedRows || 0) !== 1) {
        throw new Error('Calendar collection revision allocation failed');
    }
    return nextRevision;
}
let schemaPromise = null;
const TOMBSTONE_REPAIR_LOCK = 'oms:calendar-tombstone-repair:v1';
const TOMBSTONE_REPAIR_REASON = 'exact_duplicate_resource_v1';
const MAX_TOMBSTONE_REPAIR_GROUPS = 100;
const MAX_TOMBSTONES_PER_REPAIR_GROUP = 100;
const tombstoneDuplicateQuery = `SELECT calendar_id, MIN(BINARY resource_name) AS resource_name,
        COUNT(*) AS duplicate_count,
        COUNT(DISTINCT BINARY uid) AS distinct_uid_count,
        COUNT(DISTINCT sync_token) AS distinct_sync_token_count
     FROM calendar_tombstones
     WHERE resource_name IS NOT NULL AND resource_name != ''
     GROUP BY calendar_id, BINARY resource_name
     HAVING COUNT(*) > 1
     ORDER BY calendar_id ASC, BINARY resource_name ASC`;
function identifierBytes(value) {
    return Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'utf8');
}
function hasExactObjectKeys(value, keys) {
    const actual = Object.keys(value).sort();
    const expected = [...keys].sort();
    return actual.length === expected.length && actual.every((key, index) => key === expected[index]);
}
function parseTombstoneRepairApproval() {
    const raw = process.env.OMS_CALENDAR_TOMBSTONE_REPAIR_APPROVAL;
    if (raw === undefined || raw === '')
        return null;
    if (process.env.OMS_OUTBOUND_RELEASE_MODE !== 'bridge') {
        throw new Error('Calendar tombstone repair approval is valid only during guarded bridge mode; '
            + 'no tombstones were deleted');
    }
    if (raw.length > 8192 || !/^[A-Za-z0-9_-]+$/.test(raw)) {
        throw new Error('Calendar tombstone repair approval is malformed; no tombstones were deleted');
    }
    let parsed;
    try {
        const encoded = Buffer.from(raw, 'base64url');
        const decoded = encoded.toString('utf8');
        if (encoded.toString('base64url') !== raw
            || !Buffer.from(decoded, 'utf8').equals(encoded)) {
            throw new Error('non-canonical approval encoding');
        }
        parsed = JSON.parse(decoded);
    }
    catch {
        throw new Error('Calendar tombstone repair approval is malformed; no tombstones were deleted');
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Calendar tombstone repair approval is malformed; no tombstones were deleted');
    }
    const approval = parsed;
    if (!hasExactObjectKeys(approval, ['version', 'calendarId', 'retainedId', 'eventMatches', 'rows'])
        || approval.version !== 1
        || !Number.isSafeInteger(approval.calendarId) || Number(approval.calendarId) < 1
        || !Number.isSafeInteger(approval.retainedId) || Number(approval.retainedId) < 1
        || approval.eventMatches !== 0
        || !Array.isArray(approval.rows)
        || approval.rows.length < 2
        || approval.rows.length > MAX_TOMBSTONES_PER_REPAIR_GROUP) {
        throw new Error('Calendar tombstone repair approval is malformed; no tombstones were deleted');
    }
    const rowIds = new Set();
    const rows = approval.rows.map(value => {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            throw new Error('Calendar tombstone repair approval is malformed; no tombstones were deleted');
        }
        const row = value;
        if (!hasExactObjectKeys(row, [
            'id',
            'uidSha256',
            'uidBytes',
            'resourceNameSha256',
            'resourceNameBytes',
            'syncToken',
            'deletedAt',
        ])
            || !Number.isSafeInteger(row.id) || Number(row.id) < 1
            || !Number.isSafeInteger(row.uidBytes) || Number(row.uidBytes) < 1
            || !Number.isSafeInteger(row.resourceNameBytes) || Number(row.resourceNameBytes) < 1
            || typeof row.uidSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(row.uidSha256)
            || typeof row.resourceNameSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(row.resourceNameSha256)
            || typeof row.syncToken !== 'string' || !/^(?:0|[1-9][0-9]*)$/.test(row.syncToken)
            || typeof row.deletedAt !== 'string'
            || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(row.deletedAt)) {
            throw new Error('Calendar tombstone repair approval is malformed; no tombstones were deleted');
        }
        const id = Number(row.id);
        if (rowIds.has(id)) {
            throw new Error('Calendar tombstone repair approval is malformed; no tombstones were deleted');
        }
        rowIds.add(id);
        return {
            id,
            uidSha256: row.uidSha256,
            uidBytes: Number(row.uidBytes),
            resourceNameSha256: row.resourceNameSha256,
            resourceNameBytes: Number(row.resourceNameBytes),
            syncToken: row.syncToken,
            deletedAt: row.deletedAt,
        };
    });
    if (!rowIds.has(Number(approval.retainedId))) {
        throw new Error('Calendar tombstone repair approval is malformed; no tombstones were deleted');
    }
    return {
        version: 1,
        calendarId: Number(approval.calendarId),
        retainedId: Number(approval.retainedId),
        eventMatches: 0,
        rows,
    };
}
function identifierSha256(value) {
    return crypto.createHash('sha256').update(identifierBytes(value)).digest('hex');
}
function approvalTimestamp(row) {
    if (typeof row.deleted_at_approval === 'string')
        return row.deleted_at_approval;
    const raw = String(row.deleted_at);
    const match = raw.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}:\d{2})/);
    return match ? `${match[1]} ${match[2]}` : raw;
}
function sameIdentifier(left, right) {
    return identifierBytes(left).equals(identifierBytes(right));
}
function assertRepairableTombstoneGroups(groups) {
    if (groups.length > MAX_TOMBSTONE_REPAIR_GROUPS) {
        throw new Error(`Calendar schema migration blocked: more than ${MAX_TOMBSTONE_REPAIR_GROUPS} duplicate DAV `
            + 'tombstone groups require repair. No tombstones were deleted.');
    }
    for (const group of groups) {
        const distinctUids = Number(group.distinct_uid_count);
        const distinctSyncTokens = Number(group.distinct_sync_token_count);
        if (Number(group.duplicate_count) > MAX_TOMBSTONES_PER_REPAIR_GROUP) {
            throw new Error(`Calendar schema migration blocked: calendar ${String(group.calendar_id)} contains more than `
                + `${MAX_TOMBSTONES_PER_REPAIR_GROUP} tombstones for one DAV resource. No tombstones were deleted.`);
        }
        if (distinctUids === 1 && distinctSyncTokens === 1)
            continue;
        throw new Error(`Calendar schema migration blocked: calendar ${String(group.calendar_id)} contains ambiguous DAV `
            + `tombstone resource name "${String(group.resource_name)}" across ${String(group.duplicate_count)} rows `
            + `(binary UID count ${String(group.distinct_uid_count)}, sync-token count `
            + `${String(group.distinct_sync_token_count)}). No tombstones were deleted.`);
    }
}
function sameTimestamp(left, right) {
    if (left instanceof Date && right instanceof Date)
        return left.getTime() === right.getTime();
    return String(left) === String(right);
}
function sameTombstoneRepairRow(left, right) {
    return Number(left.id) === Number(right.id)
        && Number(left.calendar_id) === Number(right.calendar_id)
        && sameIdentifier(left.uid, right.uid)
        && sameIdentifier(left.resource_name, right.resource_name)
        && String(left.sync_token) === String(right.sync_token)
        && sameTimestamp(left.deleted_at, right.deleted_at);
}
async function assertTombstoneRepairApproval(connection, duplicateGroups, approval) {
    if (duplicateGroups.length !== 1) {
        throw new Error('Calendar tombstone repair approval does not match the locked duplicate set; no tombstones were deleted');
    }
    const group = duplicateGroups[0];
    if (group.length !== approval.rows.length
        || Number(group[0]?.calendar_id) !== approval.calendarId
        || Number(group[0]?.id) !== approval.retainedId) {
        throw new Error('Calendar tombstone repair approval does not match the locked duplicate set; no tombstones were deleted');
    }
    const expectedRows = new Map(approval.rows.map(row => [row.id, row]));
    for (const row of group) {
        const expected = expectedRows.get(Number(row.id));
        const uid = identifierBytes(row.uid);
        const resourceName = identifierBytes(row.resource_name);
        if (!expected
            || Number(row.calendar_id) !== approval.calendarId
            || uid.length !== expected.uidBytes
            || identifierSha256(uid) !== expected.uidSha256
            || resourceName.length !== expected.resourceNameBytes
            || identifierSha256(resourceName) !== expected.resourceNameSha256
            || String(row.sync_token) !== expected.syncToken
            || approvalTimestamp(row) !== expected.deletedAt) {
            throw new Error('Calendar tombstone repair approval does not match the locked duplicate set; no tombstones were deleted');
        }
    }
    const [calendarEvents] = await connection.query(`SELECT id, uid, resource_name
         FROM events
         WHERE calendar_id = ?
         FOR UPDATE`, [approval.calendarId]);
    const matchingEvents = calendarEvents.filter((event) => (sameIdentifier(event.resource_name, group[0].resource_name)
        || sameIdentifier(event.uid, group[0].uid)));
    if (matchingEvents.length !== approval.eventMatches) {
        throw new Error('Calendar tombstone repair approval does not match live event state; no tombstones were deleted');
    }
}
async function repairExactDuplicateCalendarTombstones(approval) {
    const connection = await db_1.pool.getConnection();
    let acquired = false;
    let transactionStarted = false;
    let connectionUsable = true;
    try {
        const [lockRows] = await connection.query('SELECT GET_LOCK(?, 30) AS acquired', [TOMBSTONE_REPAIR_LOCK]);
        if (Number(lockRows[0]?.acquired || 0) !== 1) {
            throw new Error('Timed out waiting for the calendar tombstone repair lock');
        }
        acquired = true;
        // The approval boundary must freeze both existing rows and insertion
        // gaps even when an operator has changed the server/session default
        // to READ COMMITTED. SET TRANSACTION affects only this next
        // transaction and avoids changing pooled-session behavior.
        if (approval) {
            await connection.query('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE');
        }
        await connection.beginTransaction();
        transactionStarted = true;
        if (approval) {
            // Freeze every existing row and the primary-key supremum gap. This
            // one-time bridge migration must not authorize an insert, update,
            // or delete that arrived after the approval snapshot.
            await connection.query(`SELECT id
                 FROM calendar_tombstones FORCE INDEX (PRIMARY)
                 ORDER BY id ASC
                 FOR UPDATE`);
        }
        const [currentDuplicateGroups] = await connection.query(`${tombstoneDuplicateQuery} LIMIT ${MAX_TOMBSTONE_REPAIR_GROUPS + 1}`);
        assertRepairableTombstoneGroups(currentDuplicateGroups);
        const duplicateGroups = [];
        for (const duplicate of currentDuplicateGroups) {
            const [candidateRows] = await connection.query(`SELECT id, calendar_id, uid, resource_name, CAST(sync_token AS CHAR) AS sync_token, deleted_at,
                        DATE_FORMAT(deleted_at, '%Y-%m-%d %H:%i:%s') AS deleted_at_approval
                 FROM calendar_tombstones
                 WHERE calendar_id = ? AND BINARY resource_name = BINARY ?
                 ORDER BY deleted_at DESC, id DESC
                 LIMIT ${MAX_TOMBSTONES_PER_REPAIR_GROUP + 1}`, [duplicate.calendar_id, duplicate.resource_name]);
            if (candidateRows.length !== Number(duplicate.duplicate_count)) {
                throw new Error('Calendar tombstone repair group changed while the migration was discovering it');
            }
            const candidates = candidateRows;
            assertRepairableTombstoneGroups([{
                    calendar_id: duplicate.calendar_id,
                    resource_name: duplicate.resource_name,
                    duplicate_count: candidates.length,
                    distinct_uid_count: new Set(candidates.map(row => identifierBytes(row.uid).toString('base64'))).size,
                    distinct_sync_token_count: new Set(candidates.map(row => String(row.sync_token))).size,
                }]);
            const candidateIds = candidates.map(row => Number(row.id));
            if (candidateIds.some(id => !Number.isSafeInteger(id) || id < 1)
                || new Set(candidateIds).size !== candidateIds.length) {
                throw new Error('Calendar tombstone repair encountered invalid candidate source IDs');
            }
            const placeholders = candidateIds.map(() => '?').join(',');
            const [lockedRows] = await connection.query(`SELECT id, calendar_id, uid, resource_name, CAST(sync_token AS CHAR) AS sync_token, deleted_at,
                        DATE_FORMAT(deleted_at, '%Y-%m-%d %H:%i:%s') AS deleted_at_approval
                 FROM calendar_tombstones FORCE INDEX (PRIMARY)
                 WHERE id IN (${placeholders})
                 ORDER BY deleted_at DESC, id DESC
                 FOR UPDATE`, candidateIds);
            const lockedGroup = lockedRows;
            const candidateById = new Map(candidates.map(row => [Number(row.id), row]));
            if (lockedGroup.length !== candidates.length
                || lockedGroup.some(row => {
                    const candidate = candidateById.get(Number(row.id));
                    return !candidate || !sameTombstoneRepairRow(candidate, row);
                })) {
                throw new Error('Calendar tombstone repair group changed before its primary-key lock was acquired');
            }
            assertRepairableTombstoneGroups([{
                    calendar_id: duplicate.calendar_id,
                    resource_name: duplicate.resource_name,
                    duplicate_count: lockedGroup.length,
                    distinct_uid_count: new Set(lockedGroup.map(row => identifierBytes(row.uid).toString('base64'))).size,
                    distinct_sync_token_count: new Set(lockedGroup.map(row => String(row.sync_token))).size,
                }]);
            duplicateGroups.push(lockedGroup);
        }
        if (approval) {
            await assertTombstoneRepairApproval(connection, duplicateGroups, approval);
        }
        const archivedRows = [];
        const redundantIds = [];
        for (const group of duplicateGroups) {
            // The SELECT order makes the first row deterministic: newest
            // deletion timestamp, then highest source ID.
            const retainedId = Number(group[0].id);
            if (!Number.isSafeInteger(retainedId) || retainedId < 1) {
                throw new Error('Calendar tombstone repair encountered an invalid source ID');
            }
            for (const row of group) {
                const sourceId = Number(row.id);
                if (!Number.isSafeInteger(sourceId) || sourceId < 1) {
                    throw new Error('Calendar tombstone repair encountered an invalid source ID');
                }
                await connection.query(`INSERT INTO calendar_tombstone_repair_archive
                        (source_tombstone_id, calendar_id, uid, resource_name, sync_token, deleted_at,
                         retained_tombstone_id, repair_reason)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                     ON DUPLICATE KEY UPDATE source_tombstone_id = VALUES(source_tombstone_id)`, [
                    sourceId,
                    row.calendar_id,
                    row.uid,
                    row.resource_name,
                    row.sync_token,
                    row.deleted_at,
                    retainedId,
                    TOMBSTONE_REPAIR_REASON,
                ]);
                archivedRows.push({ source: row, retainedId });
                if (sourceId !== retainedId)
                    redundantIds.push(sourceId);
            }
        }
        // Verify the durable recovery copy before removing any canonical-table
        // row. Chunking keeps the one-time migration within query limits.
        for (let offset = 0; offset < archivedRows.length; offset += 200) {
            const expectedChunk = archivedRows.slice(offset, offset + 200);
            const placeholders = expectedChunk.map(() => '?').join(',');
            const [archiveRows] = await connection.query(`SELECT source_tombstone_id, calendar_id, uid, resource_name, CAST(sync_token AS CHAR) AS sync_token,
                        deleted_at, retained_tombstone_id, repair_reason
                 FROM calendar_tombstone_repair_archive
                 WHERE repair_reason = ? AND source_tombstone_id IN (${placeholders})
                 FOR UPDATE`, [TOMBSTONE_REPAIR_REASON, ...expectedChunk.map(item => Number(item.source.id))]);
            const archivedBySourceId = new Map(archiveRows.map((row) => [Number(row.source_tombstone_id), row]));
            for (const expected of expectedChunk) {
                const sourceId = Number(expected.source.id);
                const archived = archivedBySourceId.get(sourceId);
                if (!archived
                    || Number(archived.calendar_id) !== Number(expected.source.calendar_id)
                    || !sameIdentifier(archived.uid, expected.source.uid)
                    || !sameIdentifier(archived.resource_name, expected.source.resource_name)
                    || String(archived.sync_token) !== String(expected.source.sync_token)
                    || !sameTimestamp(archived.deleted_at, expected.source.deleted_at)
                    || Number(archived.retained_tombstone_id) !== expected.retainedId
                    || String(archived.repair_reason) !== TOMBSTONE_REPAIR_REASON) {
                    throw new Error(`Calendar tombstone repair archive verification failed for source row ${sourceId}`);
                }
            }
        }
        for (let offset = 0; offset < redundantIds.length; offset += 200) {
            const chunk = redundantIds.slice(offset, offset + 200);
            const placeholders = chunk.map(() => '?').join(',');
            const [deleteResult] = await connection.query(`DELETE FROM calendar_tombstones WHERE id IN (${placeholders})`, chunk);
            if (Number(deleteResult.affectedRows || 0) !== chunk.length) {
                throw new Error('Calendar tombstone repair did not remove the expected redundant rows');
            }
        }
        const [remainingDuplicates] = await connection.query(`${tombstoneDuplicateQuery} LIMIT 1`);
        if (remainingDuplicates.length > 0) {
            throw new Error('Calendar tombstone repair left duplicate DAV resource names');
        }
        await connection.commit();
        transactionStarted = false;
    }
    catch (error) {
        if (transactionStarted) {
            try {
                await connection.rollback();
            }
            catch {
                connectionUsable = false;
            }
        }
        throw error;
    }
    finally {
        if (acquired) {
            try {
                const [releaseRows] = await connection.query('SELECT RELEASE_LOCK(?) AS released', [TOMBSTONE_REPAIR_LOCK]);
                if (Number(releaseRows[0]?.released || 0) !== 1)
                    connectionUsable = false;
            }
            catch {
                connectionUsable = false;
            }
        }
        if (connectionUsable)
            connection.release();
        else
            connection.destroy();
    }
}
async function ensureCalendarSchema() {
    if (!schemaPromise) {
        const tombstoneRepairApproval = parseTombstoneRepairApproval();
        schemaPromise = (async () => {
            const [slugColumn] = await db_1.pool.query("SHOW COLUMNS FROM calendars LIKE 'dav_slug'");
            if (slugColumn.length === 0) {
                await db_1.pool.query('ALTER TABLE calendars ADD COLUMN dav_slug VARCHAR(255) NULL AFTER name');
            }
            const [duplicateCalendarSlugs] = await db_1.pool.query(`SELECT user_id, dav_slug, COUNT(*) AS duplicate_count
                 FROM calendars
                 WHERE dav_slug IS NOT NULL AND dav_slug != ''
                 GROUP BY user_id, dav_slug
                 HAVING duplicate_count > 1
                 LIMIT 1`);
            if (duplicateCalendarSlugs.length > 0) {
                const duplicate = duplicateCalendarSlugs[0];
                throw new Error(`Calendar schema migration blocked: user "${String(duplicate.user_id)}" has DAV slug `
                    + `"${String(duplicate.dav_slug)}" in ${duplicate.duplicate_count} rows; the required unique `
                    + '(user_id, dav_slug) key cannot be created. Resolve duplicate calendar rows before startup.');
            }
            await db_1.pool.query("UPDATE calendars SET dav_slug = NULL WHERE dav_slug = ''");
            const [componentsColumn] = await db_1.pool.query("SHOW COLUMNS FROM calendars LIKE 'components'");
            if (componentsColumn.length === 0) {
                await db_1.pool.query("ALTER TABLE calendars ADD COLUMN components VARCHAR(255) NOT NULL DEFAULT 'VEVENT,VTODO' AFTER dav_slug");
            }
            const [subscribedUrlColumn] = await db_1.pool.query("SHOW COLUMNS FROM calendars LIKE 'subscribed_url'");
            if (subscribedUrlColumn.length === 0) {
                await db_1.pool.query('ALTER TABLE calendars ADD COLUMN subscribed_url TEXT NULL AFTER components');
            }
            const [calendarIndexes] = await db_1.pool.query('SHOW INDEX FROM calendars');
            const uniqueCalendarIndexes = new Map();
            for (const index of calendarIndexes) {
                if (index.Non_unique !== 0)
                    continue;
                const columns = uniqueCalendarIndexes.get(index.Key_name) || [];
                columns[index.Seq_in_index - 1] = index.Column_name;
                uniqueCalendarIndexes.set(index.Key_name, columns);
            }
            const hasUniqueCalendarSlug = Array.from(uniqueCalendarIndexes.values()).some(columns => (columns.length === 2 && columns[0] === 'user_id' && columns[1] === 'dav_slug'));
            if (!hasUniqueCalendarSlug) {
                await db_1.pool.query('ALTER TABLE calendars ADD UNIQUE KEY uniq_calendars_user_dav_slug (user_id, dav_slug)');
            }
            await backfillMissingCalendarSlugs();
            const [eventUidColumns] = await db_1.pool.query("SHOW FULL COLUMNS FROM events LIKE 'uid'");
            if (eventUidColumns.length !== 1)
                throw new Error('Calendar event UID column is missing');
            if (String(eventUidColumns[0].Collation || '').toLowerCase() !== 'utf8mb4_bin') {
                const nullability = eventUidColumns[0].Null === 'YES' ? 'NULL' : 'NOT NULL';
                await db_1.pool.query(`ALTER TABLE events MODIFY COLUMN uid VARCHAR(255)
                     CHARACTER SET utf8mb4 COLLATE utf8mb4_bin ${nullability}`);
            }
            const [eventResourceNameColumns] = await db_1.pool.query("SHOW FULL COLUMNS FROM events LIKE 'resource_name'");
            const eventResourceNameNeedsNormalization = eventResourceNameColumns.length === 0
                || String(eventResourceNameColumns[0].Collation || '').toLowerCase() !== 'utf8mb4_bin'
                || String(eventResourceNameColumns[0].Null || '').toUpperCase() !== 'NO';
            if (eventResourceNameColumns.length === 0) {
                await db_1.pool.query(`ALTER TABLE events ADD COLUMN resource_name VARCHAR(255)
                     CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL AFTER uid`);
            }
            // Existing producers historically used the logical iCalendar UID
            // as the DAV href. Keep that identity while allowing CalDAV clients
            // to choose an independent opaque resource name for new writes.
            await db_1.pool.query(`UPDATE events AS event_rows SET event_rows.resource_name = event_rows.uid
                 WHERE event_rows.resource_name IS NULL OR event_rows.resource_name = ''`);
            const [duplicateEventResourceNames] = await db_1.pool.query(`SELECT calendar_id, resource_name, COUNT(*) AS duplicate_count
                 FROM events
                 WHERE resource_name IS NOT NULL AND resource_name != ''
                 GROUP BY calendar_id, resource_name
                 HAVING duplicate_count > 1
                 LIMIT 1`);
            if (duplicateEventResourceNames.length > 0) {
                const duplicate = duplicateEventResourceNames[0];
                throw new Error(`Calendar schema migration blocked: calendar ${duplicate.calendar_id} contains DAV resource `
                    + `name "${String(duplicate.resource_name)}" in ${duplicate.duplicate_count} rows. Resolve `
                    + 'duplicate calendar resources before startup.');
            }
            if (eventResourceNameNeedsNormalization) {
                await db_1.pool.query(`ALTER TABLE events MODIFY COLUMN resource_name VARCHAR(255)
                     CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL`);
            }
            const [eventIndexes] = await db_1.pool.query('SHOW INDEX FROM events');
            const uniqueEventIndexes = new Map();
            for (const index of eventIndexes) {
                if (index.Non_unique !== 0)
                    continue;
                const columns = uniqueEventIndexes.get(index.Key_name) || [];
                columns[index.Seq_in_index - 1] = index.Column_name;
                uniqueEventIndexes.set(index.Key_name, columns);
            }
            const hasCalendarUidKey = Array.from(uniqueEventIndexes.values()).some(columns => (columns.length === 2 && columns[0] === 'calendar_id' && columns[1] === 'uid'));
            const hasCalendarResourceNameKey = Array.from(uniqueEventIndexes.values()).some(columns => (columns.length === 2 && columns[0] === 'calendar_id' && columns[1] === 'resource_name'));
            const eventIndexColumns = new Map();
            for (const index of eventIndexes) {
                const columns = eventIndexColumns.get(index.Key_name) || [];
                columns[index.Seq_in_index - 1] = index.Column_name;
                eventIndexColumns.set(index.Key_name, columns);
            }
            const hasCalendarSyncIndex = Array.from(eventIndexColumns.values()).some(columns => (columns.length >= 2 && columns[0] === 'calendar_id' && columns[1] === 'sync_token'));
            if (!hasCalendarUidKey) {
                const [duplicates] = await db_1.pool.query(`SELECT calendar_id, uid, COUNT(*) AS duplicate_count
                     FROM events
                     GROUP BY calendar_id, uid
                     HAVING duplicate_count > 1
                     LIMIT 1`);
                if (duplicates.length === 0) {
                    await db_1.pool.query('ALTER TABLE events ADD UNIQUE KEY uniq_events_calendar_uid (calendar_id, uid)');
                }
                else {
                    const duplicate = duplicates[0];
                    throw new Error(`Calendar schema migration blocked: calendar ${duplicate.calendar_id} contains UID `
                        + `"${String(duplicate.uid)}" in ${duplicate.duplicate_count} rows; the required unique `
                        + '(calendar_id, uid) key cannot be created. Resolve duplicate event rows before startup.');
                }
            }
            if (!hasCalendarResourceNameKey) {
                await db_1.pool.query('ALTER TABLE events ADD UNIQUE KEY uniq_events_calendar_resource_name (calendar_id, resource_name)');
            }
            const [eventSyncTokenColumn] = await db_1.pool.query("SHOW COLUMNS FROM events LIKE 'sync_token'");
            const addedEventSyncToken = eventSyncTokenColumn.length === 0;
            if (addedEventSyncToken) {
                await db_1.pool.query('ALTER TABLE events ADD COLUMN sync_token BIGINT UNSIGNED NOT NULL DEFAULT 1 AFTER ical_data');
            }
            if (!hasCalendarSyncIndex) {
                await db_1.pool.query('ALTER TABLE events ADD KEY idx_events_calendar_sync (calendar_id, sync_token)');
            }
            await db_1.pool.query(`
                CREATE TABLE IF NOT EXISTS calendar_shares (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    calendar_id INT NOT NULL,
                    shared_with_user_id VARCHAR(255) NOT NULL,
                    permission ENUM('read', 'write') DEFAULT 'read',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE KEY unique_share (calendar_id, shared_with_user_id)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            `);
            await db_1.pool.query(`
                CREATE TABLE IF NOT EXISTS calendar_tombstones (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    calendar_id INT NOT NULL,
                    uid VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
                    resource_name VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
                    sync_token BIGINT UNSIGNED NOT NULL DEFAULT 1,
                    deleted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    UNIQUE KEY uniq_calendar_tombstone_resource_name (calendar_id, resource_name),
                    KEY idx_tombstones_calendar (calendar_id),
                    KEY idx_tombstones_calendar_sync (calendar_id, sync_token),
                    KEY idx_tombstones_deleted (deleted_at)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            `);
            const [tombstoneSyncTokenColumn] = await db_1.pool.query("SHOW COLUMNS FROM calendar_tombstones LIKE 'sync_token'");
            const addedTombstoneSyncToken = tombstoneSyncTokenColumn.length === 0;
            if (addedTombstoneSyncToken) {
                await db_1.pool.query('ALTER TABLE calendar_tombstones ADD COLUMN sync_token BIGINT UNSIGNED NOT NULL DEFAULT 1 AFTER uid');
            }
            const [tombstoneUidColumns] = await db_1.pool.query("SHOW FULL COLUMNS FROM calendar_tombstones LIKE 'uid'");
            if (tombstoneUidColumns.length !== 1)
                throw new Error('Calendar tombstone UID column is missing');
            if (String(tombstoneUidColumns[0].Collation || '').toLowerCase() !== 'utf8mb4_bin') {
                const nullability = tombstoneUidColumns[0].Null === 'YES' ? 'NULL' : 'NOT NULL';
                await db_1.pool.query(`ALTER TABLE calendar_tombstones MODIFY COLUMN uid VARCHAR(255)
                     CHARACTER SET utf8mb4 COLLATE utf8mb4_bin ${nullability}`);
            }
            const [tombstoneCalendarIdColumns] = await db_1.pool.query("SHOW FULL COLUMNS FROM calendar_tombstones LIKE 'calendar_id'");
            if (tombstoneCalendarIdColumns.length !== 1) {
                throw new Error('Calendar tombstone calendar ID column is missing');
            }
            const tombstoneCalendarIdIsNotNull = String(tombstoneCalendarIdColumns[0].Null || '').toUpperCase() === 'NO';
            if (!tombstoneCalendarIdIsNotNull) {
                throw new Error('Calendar schema migration blocked: calendar_tombstones.calendar_id is nullable. '
                    + 'Resolve tombstone ownership before startup; owner IDs are never inferred or repaired.');
            }
            const [tombstoneResourceNameColumns] = await db_1.pool.query("SHOW FULL COLUMNS FROM calendar_tombstones LIKE 'resource_name'");
            const tombstoneResourceNameNeedsNormalization = tombstoneResourceNameColumns.length === 0
                || String(tombstoneResourceNameColumns[0].Collation || '').toLowerCase() !== 'utf8mb4_bin'
                || String(tombstoneResourceNameColumns[0].Null || '').toUpperCase() !== 'NO';
            if (tombstoneResourceNameColumns.length === 0) {
                await db_1.pool.query(`ALTER TABLE calendar_tombstones ADD COLUMN resource_name VARCHAR(255)
                     CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NULL AFTER uid`);
            }
            const [tombstoneIndexes] = await db_1.pool.query('SHOW INDEX FROM calendar_tombstones');
            const tombstoneIndexColumns = new Map();
            const uniqueTombstoneIndexColumns = new Map();
            for (const index of tombstoneIndexes) {
                const column = {
                    name: String(index.Column_name),
                    fullLength: index.Sub_part === null || index.Sub_part === undefined,
                };
                const columns = tombstoneIndexColumns.get(index.Key_name) || [];
                columns[Number(index.Seq_in_index) - 1] = column;
                tombstoneIndexColumns.set(index.Key_name, columns);
                if (Number(index.Non_unique) === 0) {
                    const uniqueColumns = uniqueTombstoneIndexColumns.get(index.Key_name) || [];
                    uniqueColumns[Number(index.Seq_in_index) - 1] = column;
                    uniqueTombstoneIndexColumns.set(index.Key_name, uniqueColumns);
                }
            }
            const hasFullUniqueTombstoneResourceName = Array.from(uniqueTombstoneIndexColumns.values())
                .some(columns => (columns.length === 2
                && columns[0]?.name === 'calendar_id'
                && columns[1]?.name === 'resource_name'
                && columns.every(column => column.fullLength)));
            const hasSteadyTombstoneResourceInvariant = !tombstoneResourceNameNeedsNormalization
                && hasFullUniqueTombstoneResourceName;
            if (!hasSteadyTombstoneResourceInvariant) {
                if (tombstoneRepairApproval) {
                    const [missingResourceNames] = await db_1.pool.query(`SELECT id FROM calendar_tombstones
                         WHERE resource_name IS NULL OR resource_name = ''
                         LIMIT 1`);
                    if (missingResourceNames.length > 0) {
                        throw new Error('Calendar tombstone repair approval does not permit resource-name backfill; '
                            + 'no tombstones were deleted');
                    }
                }
                await db_1.pool.query(`UPDATE calendar_tombstones SET resource_name = uid
                     WHERE resource_name IS NULL OR resource_name = ''`);
                await db_1.pool.query(`
                    CREATE TABLE IF NOT EXISTS calendar_tombstone_repair_archive (
                        id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
                        source_tombstone_id INT NOT NULL,
                        calendar_id INT NOT NULL,
                        uid VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
                        resource_name VARCHAR(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL,
                        sync_token BIGINT UNSIGNED NOT NULL,
                        deleted_at TIMESTAMP NOT NULL,
                        retained_tombstone_id INT NOT NULL,
                        repair_reason VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
                        archived_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                        UNIQUE KEY uniq_calendar_tombstone_repair_source (source_tombstone_id, repair_reason),
                        KEY idx_calendar_tombstone_repair_resource (calendar_id, resource_name)
                    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
                `);
                const [duplicateTombstoneResourceNames] = await db_1.pool.query(`${tombstoneDuplicateQuery} LIMIT ${MAX_TOMBSTONE_REPAIR_GROUPS + 1}`);
                if (duplicateTombstoneResourceNames.length > 0) {
                    if (process.env.OMS_OUTBOUND_RELEASE_MODE === 'bridge' && !tombstoneRepairApproval) {
                        throw new Error('Calendar tombstone repair approval is required during a guarded bridge startup; '
                            + 'no tombstones were deleted');
                    }
                    assertRepairableTombstoneGroups(duplicateTombstoneResourceNames);
                    await repairExactDuplicateCalendarTombstones(tombstoneRepairApproval);
                }
                else if (tombstoneRepairApproval) {
                    throw new Error('Calendar tombstone repair approval does not match the duplicate set; '
                        + 'no tombstones were deleted');
                }
                const [remainingDuplicateTombstoneResourceNames] = await db_1.pool.query(`${tombstoneDuplicateQuery} LIMIT 1`);
                if (remainingDuplicateTombstoneResourceNames.length > 0) {
                    const duplicate = remainingDuplicateTombstoneResourceNames[0];
                    throw new Error(`Calendar schema migration blocked: calendar ${String(duplicate.calendar_id)} still contains `
                        + `DAV tombstone resource name "${String(duplicate.resource_name)}" in `
                        + `${String(duplicate.duplicate_count)} rows after repair.`);
                }
                if (tombstoneResourceNameNeedsNormalization) {
                    await db_1.pool.query(`ALTER TABLE calendar_tombstones MODIFY COLUMN resource_name VARCHAR(255)
                         CHARACTER SET utf8mb4 COLLATE utf8mb4_bin NOT NULL`);
                }
                if (!hasFullUniqueTombstoneResourceName) {
                    const baseIndexName = 'uniq_calendar_tombstone_resource_name';
                    let resourceIndexName = baseIndexName;
                    let suffix = 2;
                    while (tombstoneIndexColumns.has(resourceIndexName)) {
                        resourceIndexName = `${baseIndexName}_${suffix++}`;
                    }
                    if (resourceIndexName === baseIndexName) {
                        await db_1.pool.query('ALTER TABLE calendar_tombstones ADD UNIQUE KEY uniq_calendar_tombstone_resource_name (calendar_id, resource_name)');
                    }
                    else {
                        await db_1.pool.query(`ALTER TABLE calendar_tombstones ADD UNIQUE KEY \`${resourceIndexName}\` (calendar_id, resource_name)`);
                    }
                }
            }
            if (addedEventSyncToken || addedTombstoneSyncToken) {
                // One-time compatibility bridge: clients holding a pre-revision
                // token must receive every still-live resource and tombstone.
                await db_1.pool.query(`UPDATE events
                     INNER JOIN calendars ON calendars.id = events.calendar_id
                     SET events.sync_token = GREATEST(events.sync_token, calendars.sync_token)`);
                await db_1.pool.query(`UPDATE calendar_tombstones
                     INNER JOIN calendars ON calendars.id = calendar_tombstones.calendar_id
                     SET calendar_tombstones.sync_token = GREATEST(calendar_tombstones.sync_token, calendars.sync_token)`);
            }
            // A live row supersedes every historical delete marker for its UID.
            // An approval-pinned repair is intentionally narrower: prove this
            // cleanup would be a no-op, then skip it so the startup can delete
            // only the explicitly approved redundant source rows.
            if (tombstoneRepairApproval) {
                const [liveEventCollisions] = await db_1.pool.query(`SELECT calendar_tombstones.id
                     FROM calendar_tombstones
                     INNER JOIN events
                       ON events.calendar_id = calendar_tombstones.calendar_id
                      AND BINARY COALESCE(NULLIF(events.resource_name, ''), events.uid)
                          = BINARY COALESCE(NULLIF(calendar_tombstones.resource_name, ''), calendar_tombstones.uid)
                     LIMIT 1`);
                if (liveEventCollisions.length > 0) {
                    throw new Error('Calendar tombstone repair approval does not permit live-event collision cleanup; '
                        + 'no additional tombstones were deleted');
                }
            }
            else {
                await db_1.pool.query(`DELETE calendar_tombstones FROM calendar_tombstones
                     INNER JOIN events
                       ON events.calendar_id = calendar_tombstones.calendar_id
                      AND BINARY COALESCE(NULLIF(events.resource_name, ''), events.uid)
                          = BINARY COALESCE(NULLIF(calendar_tombstones.resource_name, ''), calendar_tombstones.uid)`);
            }
            // Tombstones track the DAV href that disappeared. A historical
            // unique logical-UID key incorrectly prevents deleting a resource
            // re-created under a new href, so retire it after the href key is
            // established. The bounded repair above consolidates only fully
            // archived, byte-identical duplicate rows; do not infer any broader
            // UID-based merge or deletion here.
            for (const [indexName, columns] of uniqueTombstoneIndexColumns.entries()) {
                if (columns.length === 2 && columns[0]?.name === 'calendar_id' && columns[1]?.name === 'uid') {
                    if (!/^[A-Za-z0-9_$]+$/.test(indexName)) {
                        throw new Error('Calendar tombstone UID index has an unsafe identifier');
                    }
                    await db_1.pool.query(`ALTER TABLE calendar_tombstones DROP INDEX \`${indexName}\``);
                }
            }
            const hasTombstoneSyncIndex = Array.from(tombstoneIndexColumns.values()).some(columns => (columns.length >= 2 && columns[0]?.name === 'calendar_id' && columns[1]?.name === 'sync_token'));
            if (!hasTombstoneSyncIndex) {
                await db_1.pool.query('ALTER TABLE calendar_tombstones ADD KEY idx_tombstones_calendar_sync (calendar_id, sync_token)');
            }
        })();
    }
    return schemaPromise;
}
async function backfillMissingCalendarSlugs() {
    const [rows] = await db_1.pool.query('SELECT id, user_id, name, dav_slug FROM calendars ORDER BY user_id ASC, id ASC');
    for (const row of rows) {
        if (row.dav_slug)
            continue;
        const base = (0, calendar_format_1.slugifyCalendarName)(row.name);
        let slug = base;
        let suffix = 2;
        if (isReservedManagedCalendarSlug(slug))
            slug = `${base}-${suffix++}`;
        while (true) {
            const [collisions] = await db_1.pool.query('SELECT id FROM calendars WHERE user_id = ? AND dav_slug = ? AND id <> ? LIMIT 1', [row.user_id, slug, row.id]);
            if (collisions.length > 0) {
                slug = `${base}-${suffix++}`;
                continue;
            }
            try {
                const [result] = await db_1.pool.query('UPDATE calendars SET dav_slug = ? WHERE id = ? AND dav_slug IS NULL', [slug, row.id]);
                if (Number(result.affectedRows || 0) === 1)
                    row.dav_slug = slug;
                break;
            }
            catch (error) {
                if (!isDuplicateEntry(error))
                    throw error;
                slug = `${base}-${suffix++}`;
            }
        }
    }
}
async function uniqueCalendarSlug(user, preferred, excludeCalendarId) {
    await ensureCalendarSchema();
    return uniqueCalendarSlugOnConnection(db_1.pool, user, preferred, excludeCalendarId);
}
async function uniqueCalendarSlugOnConnection(connection, user, preferred, excludeCalendarId) {
    const base = (0, calendar_format_1.slugifyCalendarName)(preferred);
    let slug = base;
    let suffix = 2;
    if (isReservedManagedCalendarSlug(slug))
        slug = `${base}-${suffix++}`;
    while (true) {
        const params = [user, slug];
        let excludeClause = '';
        if (excludeCalendarId) {
            excludeClause = ' AND id <> ?';
            params.push(excludeCalendarId);
        }
        const [rows] = await connection.query(`SELECT id FROM calendars WHERE user_id = ? AND dav_slug = ?${excludeClause} LIMIT 1`, params);
        if (rows.length === 0)
            return slug;
        slug = `${base}-${suffix++}`;
    }
}
function calendarSlugLockName(user) {
    const digest = crypto.createHash('sha256').update(user.trim().toLowerCase()).digest('hex').slice(0, 40);
    return `oms:calendar-slug:${digest}`;
}
async function withCalendarSlugLock(user, operation) {
    const connection = await db_1.pool.getConnection();
    const lockName = calendarSlugLockName(user);
    let acquired = false;
    let connectionUsable = true;
    try {
        const [lockRows] = await connection.query('SELECT GET_LOCK(?, 10) AS acquired', [lockName]);
        if (Number(lockRows[0]?.acquired || 0) !== 1) {
            throw new Error('Timed out waiting for the calendar identity lock');
        }
        acquired = true;
        return await operation(connection);
    }
    finally {
        if (acquired) {
            try {
                const [releaseRows] = await connection.query('SELECT RELEASE_LOCK(?) AS released', [lockName]);
                if (Number(releaseRows[0]?.released || 0) !== 1)
                    connectionUsable = false;
            }
            catch {
                connectionUsable = false;
            }
        }
        if (connectionUsable)
            connection.release();
        else
            connection.destroy();
    }
}
function isDuplicateEntry(error) {
    return Boolean(error && typeof error === 'object' && error.code === 'ER_DUP_ENTRY');
}
async function ensureCalendarSlug(calendar) {
    await ensureCalendarSchema();
    if (calendar.dav_slug)
        return calendar.dav_slug;
    const slug = await uniqueCalendarSlug(calendar.user_id, calendar.name, calendar.id);
    await db_1.pool.query('UPDATE calendars SET dav_slug = ? WHERE id = ?', [slug, calendar.id]);
    calendar.dav_slug = slug;
    return slug;
}
async function createCalendar(user, name, options = {}) {
    const cleanName = name.trim() || 'New Calendar';
    const requestedSlug = options.slug || cleanName;
    if (isReservedManagedCalendarSlug(requestedSlug)) {
        throw new Error('Calendar slug "birthdays" is reserved for a managed calendar');
    }
    await ensureCalendarSchema();
    return withCalendarSlugLock(user, async (connection) => {
        for (let attempt = 0; attempt < 8; attempt += 1) {
            const slug = await uniqueCalendarSlugOnConnection(connection, user, requestedSlug);
            try {
                const [result] = await connection.query('INSERT INTO calendars (user_id, name, dav_slug, color, components, subscribed_url, sync_token) VALUES (?, ?, ?, ?, ?, ?, 1)', [user, cleanName, slug, options.color || '#3498db', options.components || 'VEVENT,VTODO', options.subscribed_url || null]);
                const [created] = await connection.query('SELECT * FROM calendars WHERE id = ?', [result.insertId]);
                if (created.length !== 1)
                    throw new Error('Created calendar could not be reloaded');
                return created[0];
            }
            catch (error) {
                if (!isDuplicateEntry(error) || attempt === 7)
                    throw error;
            }
        }
        throw new Error('Calendar identity allocation failed');
    });
}
async function ensureDefaultCalendar(user) {
    await ensureCalendarSchema();
    const [existing] = await db_1.pool.query(`SELECT * FROM calendars
         WHERE user_id = ?
           AND LOWER(TRIM(COALESCE(dav_slug, ''))) <> 'birthdays'
           AND (subscribed_url IS NULL OR TRIM(subscribed_url) = '')
         ORDER BY id ASC LIMIT 1`, [user]);
    if (existing.length > 0) {
        await ensureCalendarSlug(existing[0]);
        return existing[0];
    }
    return createCalendar(user, 'Personal', { slug: 'personal' });
}
async function getCalendarByToken(user, token) {
    await ensureCalendarSchema();
    let decodedToken;
    try {
        decodedToken = decodeURIComponent(token);
    }
    catch {
        return null;
    }
    if (/^\d+$/.test(decodedToken)) {
        const [rows] = await db_1.pool.query(`SELECT c.*,
                    CASE WHEN c.user_id = ? THEN 'owner' ELSE cs.permission END AS access_role
             FROM calendars c
             LEFT JOIN calendar_shares cs
               ON cs.calendar_id = c.id AND cs.shared_with_user_id = ?
             WHERE c.id = ? AND (c.user_id = ? OR cs.shared_with_user_id = ?)
             LIMIT 1`, [user, user, decodedToken, user, user]);
        if (rows.length > 0)
            return rows[0];
    }
    const [rows] = await db_1.pool.query(`SELECT c.*,
                CASE WHEN c.user_id = ? THEN 'owner' ELSE cs.permission END AS access_role
         FROM calendars c
         LEFT JOIN calendar_shares cs
           ON cs.calendar_id = c.id AND cs.shared_with_user_id = ?
         WHERE (c.user_id = ? OR cs.shared_with_user_id = ?)
           AND (c.dav_slug = ? OR c.name = ?)
         ORDER BY (c.user_id = ?) DESC, c.id ASC
         LIMIT 1`, [user, user, user, user, (0, calendar_format_1.slugifyCalendarName)(decodedToken), decodedToken, user]);
    return rows.length > 0 ? rows[0] : null;
}
async function getVisibleCalendars(user) {
    await ensureCalendarSchema();
    await ensureDefaultCalendar(user);
    const [rows] = await db_1.pool.query(`SELECT c.*, COUNT(e.uid) AS event_count,
                (CASE WHEN c.user_id = ? THEN 'owner' ELSE cs.permission END) AS access_role
         FROM calendars c
         LEFT JOIN events e ON e.calendar_id = c.id
         LEFT JOIN calendar_shares cs ON cs.calendar_id = c.id AND cs.shared_with_user_id = ?
         WHERE c.user_id = ? OR cs.shared_with_user_id = ?
         GROUP BY c.id
         ORDER BY c.id ASC`, [user, user, user, user]);
    let keptPersonal = false;
    const visible = rows.filter((cal) => {
        if (cal.name !== 'Personal')
            return true;
        if ((cal.event_count || 0) > 0)
            return true;
        if (!keptPersonal) {
            keptPersonal = true;
            return true;
        }
        return false;
    });
    for (const cal of visible) {
        await ensureCalendarSlug(cal);
    }
    return visible;
}
function getCalendarHref(user, calendar) {
    return `/caldav/calendars/${encodeURIComponent(user)}/${calendar.id}/`;
}
//# sourceMappingURL=calendar-utils.js.map