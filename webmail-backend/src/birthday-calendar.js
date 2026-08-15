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
exports.MANAGED_BIRTHDAY_DTSTAMP = exports.MANAGED_BIRTHDAY_CALENDAR_SLUG = void 0;
exports.isManagedBirthdayCalendar = isManagedBirthdayCalendar;
exports.isManagedBirthdayEventUid = isManagedBirthdayEventUid;
exports.escapeIcalText = escapeIcalText;
exports.birthdayEventUid = birthdayEventUid;
exports.legacyBirthdayEventUid = legacyBirthdayEventUid;
exports.syncContactBirthdayEvent = syncContactBirthdayEvent;
exports.rebuildBirthdayCalendarProjectionOnConnection = rebuildBirthdayCalendarProjectionOnConnection;
exports.repairBirthdayCalendarProjection = repairBirthdayCalendarProjection;
exports.repairAllBirthdayCalendarProjections = repairAllBirthdayCalendarProjections;
const crypto = __importStar(require("crypto"));
const calendar_utils_1 = require("./calendar-utils");
const db_1 = require("./db");
exports.MANAGED_BIRTHDAY_CALENDAR_SLUG = 'birthdays';
exports.MANAGED_BIRTHDAY_DTSTAMP = '20000101T000000Z';
function isManagedBirthdayCalendar(calendar) {
    return String(calendar.dav_slug || '').trim().toLowerCase() === exports.MANAGED_BIRTHDAY_CALENDAR_SLUG;
}
function isManagedBirthdayEventUid(uid) {
    return /^birthday-[0-9a-f]+@openmailstack$/i.test(uid);
}
function escapeIcalText(value) {
    return value
        .replace(/\\/g, '\\\\')
        .replace(/\r\n|\r|\n/g, '\\n')
        .replace(/,/g, '\\,')
        .replace(/;/g, '\\;');
}
function birthdayEventUid(user, identity) {
    const immutableIdentity = String(identity.davUid || `contact-${identity.contactId}`).trim();
    const digest = crypto.createHash('sha256')
        .update(`${user.trim().toLowerCase()}\0${immutableIdentity}`)
        .digest('hex')
        .slice(0, 48);
    return `birthday-${digest}@openmailstack`;
}
function legacyBirthdayEventUid(identity) {
    const mutableIdentity = String(identity.email || identity.name || '');
    if (!mutableIdentity)
        return null;
    return `birthday-${Buffer.from(mutableIdentity).toString('hex').slice(0, 32)}@openmailstack`;
}
function birthdayMonthDay(value) {
    const match = value.match(/^(?:\d{4}-)?(\d{2})-(\d{2})$/);
    if (!match)
        return null;
    const month = Number(match[1]);
    const day = Number(match[2]);
    const probe = new Date(Date.UTC(2000, month - 1, day));
    if (probe.getUTCMonth() + 1 !== month || probe.getUTCDate() !== day)
        return null;
    return `${match[1]}${match[2]}`;
}
function birthdayIcalData(user, identity, birthday) {
    const monthDay = birthdayMonthDay(birthday);
    if (!monthDay)
        return null;
    const uid = birthdayEventUid(user, identity);
    const displayName = String(identity.name || identity.email || 'Contact');
    return [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//OpenMailStack//Birthdays//EN',
        'BEGIN:VEVENT',
        `UID:${uid}`,
        `DTSTAMP:${exports.MANAGED_BIRTHDAY_DTSTAMP}`,
        `DTSTART;VALUE=DATE:2000${monthDay}`,
        'RRULE:FREQ=YEARLY',
        `SUMMARY:${escapeIcalText(`${displayName}'s Birthday`)}`,
        'TRANSP:TRANSPARENT',
        'END:VEVENT',
        'END:VCALENDAR',
    ].join('\r\n');
}
async function syncContactBirthdayEvent(connection, user, identity, birthday, legacyIdentities = [identity]) {
    const monthDay = birthday ? birthdayMonthDay(birthday) : null;
    if (birthday && !monthDay)
        return;
    const [calendarRows] = await connection.query("SELECT id FROM calendars WHERE user_id = ? AND dav_slug = 'birthdays' LIMIT 1 FOR UPDATE", [user]);
    let calendarId;
    if (calendarRows.length === 0) {
        if (!birthday)
            return;
        const [result] = await connection.query(`INSERT INTO calendars (user_id, name, dav_slug, color, components, subscribed_url, sync_token)
             VALUES (?, 'Birthdays', 'birthdays', '#e91e63', 'VEVENT', NULL, 0)`, [user]);
        calendarId = Number(result.insertId);
    }
    else {
        calendarId = Number(calendarRows[0].id);
    }
    const canonicalUid = birthdayEventUid(user, identity);
    const priorCanonicalUids = legacyIdentities
        .map(previousIdentity => birthdayEventUid(user, previousIdentity))
        .filter(uid => uid !== canonicalUid);
    const legacyUids = Array.from(new Set([identity, ...legacyIdentities]
        .map(legacyBirthdayEventUid)
        .filter((uid) => Boolean(uid) && uid !== canonicalUid)));
    const migratedUids = Array.from(new Set([...priorCanonicalUids, ...legacyUids]));
    const desiredIcal = birthday && monthDay ? birthdayIcalData(user, identity, birthday) : null;
    const relevantUids = Array.from(new Set([canonicalUid, ...migratedUids]));
    const placeholders = relevantUids.map(() => '?').join(',');
    const [eventRows] = await connection.query(`SELECT uid, resource_name, ical_data FROM events
         WHERE calendar_id = ? AND uid IN (${placeholders})
         ORDER BY uid ASC FOR UPDATE`, [calendarId, ...relevantUids]);
    const eventsByUid = new Map(eventRows.map((row) => [
        String(row.uid),
        {
            icalData: String(row.ical_data || ''),
            resourceName: String(row.resource_name || row.uid),
        },
    ]));
    let canonicalTombstoneCleared = false;
    if (desiredIcal !== null) {
        const canonicalResourceName = eventsByUid.get(canonicalUid)?.resourceName || canonicalUid;
        const [clearResult] = await connection.query(`DELETE FROM calendar_tombstones
             WHERE calendar_id = ?
             AND BINARY COALESCE(NULLIF(resource_name, ''), uid) = BINARY ?`, [calendarId, canonicalResourceName]);
        canonicalTombstoneCleared = Number(clearResult.affectedRows || 0) > 0;
    }
    const requestedDeletes = birthday ? migratedUids : relevantUids;
    const eventDeletes = requestedDeletes
        .map(uid => ({ uid, event: eventsByUid.get(uid) }))
        .filter((item) => Boolean(item.event));
    const canonicalNeedsUpsert = desiredIcal !== null
        && (eventsByUid.get(canonicalUid)?.icalData !== desiredIcal || canonicalTombstoneCleared);
    if (eventDeletes.length === 0 && !canonicalNeedsUpsert)
        return;
    const revision = await (0, calendar_utils_1.allocateCalendarCollectionRevisionOnConnection)(connection, calendarId);
    if (eventDeletes.length > 0) {
        const deletePlaceholders = eventDeletes.map(() => '?').join(',');
        await connection.query(`DELETE FROM events WHERE calendar_id=? AND uid IN (${deletePlaceholders})`, [calendarId, ...eventDeletes.map(item => item.uid)]);
        for (const { uid, event } of eventDeletes) {
            await connection.query(`INSERT INTO calendar_tombstones
                 (calendar_id, uid, resource_name, sync_token)
                 VALUES (?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE
                    uid=VALUES(uid), resource_name=VALUES(resource_name),
                    sync_token=VALUES(sync_token), deleted_at=NOW()`, [calendarId, uid, event.resourceName, revision]);
        }
    }
    if (canonicalNeedsUpsert && desiredIcal !== null) {
        await connection.query(`INSERT INTO events (calendar_id, uid, resource_name, ical_data, sync_token)
             VALUES (?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE ical_data=VALUES(ical_data), sync_token=VALUES(sync_token)`, [calendarId, canonicalUid, canonicalUid, desiredIcal, revision]);
    }
}
async function rebuildBirthdayCalendarProjectionOnConnection(connection, user) {
    const [contactRows] = await connection.query(`SELECT id, dav_uid, name, email, birthday
         FROM contacts
         WHERE username = ? AND deleted_at IS NULL
         ORDER BY id ASC FOR UPDATE`, [user]);
    const desiredEvents = new Map();
    for (const row of contactRows) {
        const birthday = row.birthday ? String(row.birthday) : '';
        if (!birthday)
            continue;
        const identity = {
            contactId: row.id,
            davUid: row.dav_uid || null,
            name: row.name || null,
            email: row.email || null,
        };
        const icalData = birthdayIcalData(user, identity, birthday);
        if (!icalData) {
            throw new Error(`Birthday projection repair blocked: contact ${row.id} has an invalid birthday`);
        }
        const uid = birthdayEventUid(user, identity);
        if (desiredEvents.has(uid)) {
            throw new Error(`Birthday projection repair blocked: multiple live contacts resolve to UID "${uid}"`);
        }
        desiredEvents.set(uid, icalData);
    }
    const [calendarRows] = await connection.query("SELECT id FROM calendars WHERE user_id = ? AND dav_slug = 'birthdays' LIMIT 1 FOR UPDATE", [user]);
    let calendarId;
    if (calendarRows.length === 0) {
        if (desiredEvents.size === 0)
            return false;
        const [result] = await connection.query(`INSERT INTO calendars (user_id, name, dav_slug, color, components, subscribed_url, sync_token)
             VALUES (?, 'Birthdays', 'birthdays', '#e91e63', 'VEVENT', NULL, 0)`, [user]);
        calendarId = Number(result.insertId);
    }
    else {
        calendarId = Number(calendarRows[0].id);
    }
    const [eventRows] = await connection.query('SELECT uid, resource_name, ical_data FROM events WHERE calendar_id = ? ORDER BY uid ASC FOR UPDATE', [calendarId]);
    const existingEvents = new Map(eventRows.map((row) => [String(row.uid), {
            icalData: String(row.ical_data || ''),
            resourceName: String(row.resource_name || row.uid),
        }]));
    const [tombstoneRows] = await connection.query('SELECT uid, resource_name FROM calendar_tombstones WHERE calendar_id = ? FOR UPDATE', [calendarId]);
    const tombstoneResourceNames = new Set(tombstoneRows.map((row) => String(row.resource_name || row.uid)));
    const staleEvents = Array.from(existingEvents.entries())
        .filter(([uid]) => isManagedBirthdayEventUid(uid) && !desiredEvents.has(uid))
        .sort(([left], [right]) => left.localeCompare(right));
    const desiredTombstones = Array.from(desiredEvents.keys())
        .map(uid => existingEvents.get(uid)?.resourceName || uid)
        .filter(resourceName => tombstoneResourceNames.has(resourceName))
        .sort();
    const upserts = Array.from(desiredEvents.entries())
        .filter(([uid, icalData]) => {
        const existing = existingEvents.get(uid);
        return existing?.icalData !== icalData
            || tombstoneResourceNames.has(existing?.resourceName || uid);
    })
        .sort(([left], [right]) => left.localeCompare(right));
    if (staleEvents.length === 0 && upserts.length === 0)
        return false;
    const revision = await (0, calendar_utils_1.allocateCalendarCollectionRevisionOnConnection)(connection, calendarId);
    if (staleEvents.length > 0) {
        const placeholders = staleEvents.map(() => '?').join(',');
        await connection.query(`DELETE FROM events WHERE calendar_id = ? AND uid IN (${placeholders})`, [calendarId, ...staleEvents.map(([uid]) => uid)]);
        for (const [uid, event] of staleEvents) {
            await connection.query(`INSERT INTO calendar_tombstones
                 (calendar_id, uid, resource_name, sync_token)
                 VALUES (?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE
                    uid=VALUES(uid), resource_name=VALUES(resource_name),
                    sync_token=VALUES(sync_token), deleted_at=NOW()`, [calendarId, uid, event.resourceName, revision]);
        }
    }
    if (desiredTombstones.length > 0) {
        const placeholders = desiredTombstones.map(() => '?').join(',');
        await connection.query(`DELETE FROM calendar_tombstones
             WHERE calendar_id = ? AND resource_name IN (${placeholders})`, [calendarId, ...desiredTombstones]);
    }
    for (const [uid, icalData] of upserts) {
        await connection.query(`INSERT INTO events (calendar_id, uid, resource_name, ical_data, sync_token)
             VALUES (?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE ical_data=VALUES(ical_data), sync_token=VALUES(sync_token)`, [calendarId, uid, uid, icalData, revision]);
    }
    return true;
}
async function repairBirthdayCalendarProjection(user) {
    const connection = await db_1.pool.getConnection();
    try {
        await connection.beginTransaction();
        const changed = await rebuildBirthdayCalendarProjectionOnConnection(connection, user);
        if (changed)
            await connection.commit();
        else
            await connection.rollback();
        return changed;
    }
    catch (error) {
        await connection.rollback().catch(() => { });
        throw error;
    }
    finally {
        connection.release();
    }
}
async function repairAllBirthdayCalendarProjections() {
    const connection = await db_1.pool.getConnection();
    try {
        await connection.beginTransaction();
        const [rows] = await connection.query(`SELECT username
             FROM contacts
             WHERE deleted_at IS NULL
             UNION
             SELECT user_id AS username
             FROM calendars
             WHERE dav_slug = 'birthdays'
             ORDER BY username ASC`);
        let usersChanged = 0;
        for (const row of rows) {
            if (await rebuildBirthdayCalendarProjectionOnConnection(connection, String(row.username)))
                usersChanged += 1;
        }
        if (usersChanged > 0)
            await connection.commit();
        else
            await connection.rollback();
        return { usersChecked: rows.length, usersChanged };
    }
    catch (error) {
        await connection.rollback().catch(() => { });
        throw error;
    }
    finally {
        connection.release();
    }
}
//# sourceMappingURL=birthday-calendar.js.map