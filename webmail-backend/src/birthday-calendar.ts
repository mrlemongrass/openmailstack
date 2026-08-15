import * as crypto from 'crypto';
import type { ContactMutationConnection } from './contact-utils';
import { allocateCalendarCollectionRevisionOnConnection } from './calendar-utils';
import { pool } from './db';

export interface BirthdayContactIdentity {
    contactId: string | number;
    davUid?: string | null;
    name?: string | null;
    email?: string | null;
}

export const MANAGED_BIRTHDAY_CALENDAR_SLUG = 'birthdays';
export const MANAGED_BIRTHDAY_DTSTAMP = '20000101T000000Z';

export function isManagedBirthdayCalendar(calendar: { dav_slug?: string | null }): boolean {
    return String(calendar.dav_slug || '').trim().toLowerCase() === MANAGED_BIRTHDAY_CALENDAR_SLUG;
}

export function isManagedBirthdayEventUid(uid: string): boolean {
    return /^birthday-[0-9a-f]+@openmailstack$/i.test(uid);
}

export function escapeIcalText(value: string): string {
    return value
        .replace(/\\/g, '\\\\')
        .replace(/\r\n|\r|\n/g, '\\n')
        .replace(/,/g, '\\,')
        .replace(/;/g, '\\;');
}

export function birthdayEventUid(user: string, identity: BirthdayContactIdentity): string {
    const immutableIdentity = String(identity.davUid || `contact-${identity.contactId}`).trim();
    const digest = crypto.createHash('sha256')
        .update(`${user.trim().toLowerCase()}\0${immutableIdentity}`)
        .digest('hex')
        .slice(0, 48);
    return `birthday-${digest}@openmailstack`;
}

export function legacyBirthdayEventUid(identity: BirthdayContactIdentity): string | null {
    const mutableIdentity = String(identity.email || identity.name || '');
    if (!mutableIdentity) return null;
    return `birthday-${Buffer.from(mutableIdentity).toString('hex').slice(0, 32)}@openmailstack`;
}

function birthdayMonthDay(value: string): string | null {
    const match = value.match(/^(?:\d{4}-)?(\d{2})-(\d{2})$/);
    if (!match) return null;
    const month = Number(match[1]);
    const day = Number(match[2]);
    const probe = new Date(Date.UTC(2000, month - 1, day));
    if (probe.getUTCMonth() + 1 !== month || probe.getUTCDate() !== day) return null;
    return `${match[1]}${match[2]}`;
}

function birthdayIcalData(
    user: string,
    identity: BirthdayContactIdentity,
    birthday: string,
): string | null {
    const monthDay = birthdayMonthDay(birthday);
    if (!monthDay) return null;
    const uid = birthdayEventUid(user, identity);
    const displayName = String(identity.name || identity.email || 'Contact');
    return [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//OpenMailStack//Birthdays//EN',
        'BEGIN:VEVENT',
        `UID:${uid}`,
        `DTSTAMP:${MANAGED_BIRTHDAY_DTSTAMP}`,
        `DTSTART;VALUE=DATE:2000${monthDay}`,
        'RRULE:FREQ=YEARLY',
        `SUMMARY:${escapeIcalText(`${displayName}'s Birthday`)}`,
        'TRANSP:TRANSPARENT',
        'END:VEVENT',
        'END:VCALENDAR',
    ].join('\r\n');
}

export async function syncContactBirthdayEvent(
    connection: ContactMutationConnection,
    user: string,
    identity: BirthdayContactIdentity,
    birthday: string | null,
    legacyIdentities: BirthdayContactIdentity[] = [identity],
): Promise<void> {
    const monthDay = birthday ? birthdayMonthDay(birthday) : null;
    if (birthday && !monthDay) return;

    const [calendarRows]: any = await connection.query(
        "SELECT id FROM calendars WHERE user_id = ? AND dav_slug = 'birthdays' LIMIT 1 FOR UPDATE",
        [user],
    );
    let calendarId: number;
    if (calendarRows.length === 0) {
        if (!birthday) return;
        const [result]: any = await connection.query(
            `INSERT INTO calendars (user_id, name, dav_slug, color, components, subscribed_url, sync_token)
             VALUES (?, 'Birthdays', 'birthdays', '#e91e63', 'VEVENT', NULL, 0)`,
            [user],
        );
        calendarId = Number(result.insertId);
    } else {
        calendarId = Number(calendarRows[0].id);
    }

    const canonicalUid = birthdayEventUid(user, identity);
    const priorCanonicalUids = legacyIdentities
        .map(previousIdentity => birthdayEventUid(user, previousIdentity))
        .filter(uid => uid !== canonicalUid);
    const legacyUids = Array.from(new Set(
        [identity, ...legacyIdentities]
            .map(legacyBirthdayEventUid)
            .filter((uid): uid is string => Boolean(uid) && uid !== canonicalUid),
    ));
    const migratedUids = Array.from(new Set([...priorCanonicalUids, ...legacyUids]));
    const desiredIcal = birthday && monthDay ? birthdayIcalData(user, identity, birthday) : null;

    const relevantUids = Array.from(new Set([canonicalUid, ...migratedUids]));
    const placeholders = relevantUids.map(() => '?').join(',');
    const [eventRows]: any = await connection.query(
        `SELECT uid, resource_name, ical_data FROM events
         WHERE calendar_id = ? AND uid IN (${placeholders})
         ORDER BY uid ASC FOR UPDATE`,
        [calendarId, ...relevantUids],
    );
    const eventsByUid = new Map<string, { icalData: string; resourceName: string }>(eventRows.map((row: any) => [
        String(row.uid),
        {
            icalData: String(row.ical_data || ''),
            resourceName: String(row.resource_name || row.uid),
        },
    ]));
    let canonicalTombstoneCleared = false;
    if (desiredIcal !== null) {
        const canonicalResourceName = eventsByUid.get(canonicalUid)?.resourceName || canonicalUid;
        const [clearResult]: any = await connection.query(
            `DELETE FROM calendar_tombstones
             WHERE calendar_id = ?
             AND BINARY COALESCE(NULLIF(resource_name, ''), uid) = BINARY ?`,
            [calendarId, canonicalResourceName],
        );
        canonicalTombstoneCleared = Number(clearResult.affectedRows || 0) > 0;
    }
    const requestedDeletes = birthday ? migratedUids : relevantUids;
    const eventDeletes = requestedDeletes
        .map(uid => ({ uid, event: eventsByUid.get(uid) }))
        .filter((item): item is { uid: string; event: { icalData: string; resourceName: string } } => Boolean(item.event));
    const canonicalNeedsUpsert = desiredIcal !== null
        && (eventsByUid.get(canonicalUid)?.icalData !== desiredIcal || canonicalTombstoneCleared);
    if (eventDeletes.length === 0 && !canonicalNeedsUpsert) return;

    const revision = await allocateCalendarCollectionRevisionOnConnection(connection, calendarId);
    if (eventDeletes.length > 0) {
        const deletePlaceholders = eventDeletes.map(() => '?').join(',');
        await connection.query(
            `DELETE FROM events WHERE calendar_id=? AND uid IN (${deletePlaceholders})`,
            [calendarId, ...eventDeletes.map(item => item.uid)],
        );
        for (const { uid, event } of eventDeletes) {
            await connection.query(
                `INSERT INTO calendar_tombstones
                 (calendar_id, uid, resource_name, sync_token)
                 VALUES (?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE
                    uid=VALUES(uid), resource_name=VALUES(resource_name),
                    sync_token=VALUES(sync_token), deleted_at=NOW()`,
                [calendarId, uid, event.resourceName, revision],
            );
        }
    }

    if (canonicalNeedsUpsert && desiredIcal !== null) {
        await connection.query(
            `INSERT INTO events (calendar_id, uid, resource_name, ical_data, sync_token)
             VALUES (?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE ical_data=VALUES(ical_data), sync_token=VALUES(sync_token)`,
            [calendarId, canonicalUid, canonicalUid, desiredIcal, revision],
        );
    }
}

export async function rebuildBirthdayCalendarProjectionOnConnection(
    connection: ContactMutationConnection,
    user: string,
): Promise<boolean> {
    const [contactRows]: any = await connection.query(
        `SELECT id, dav_uid, name, email, birthday
         FROM contacts
         WHERE username = ? AND deleted_at IS NULL
         ORDER BY id ASC FOR UPDATE`,
        [user],
    );
    const desiredEvents = new Map<string, string>();
    for (const row of contactRows) {
        const birthday = row.birthday ? String(row.birthday) : '';
        if (!birthday) continue;
        const identity: BirthdayContactIdentity = {
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

    const [calendarRows]: any = await connection.query(
        "SELECT id FROM calendars WHERE user_id = ? AND dav_slug = 'birthdays' LIMIT 1 FOR UPDATE",
        [user],
    );
    let calendarId: number;
    if (calendarRows.length === 0) {
        if (desiredEvents.size === 0) return false;
        const [result]: any = await connection.query(
            `INSERT INTO calendars (user_id, name, dav_slug, color, components, subscribed_url, sync_token)
             VALUES (?, 'Birthdays', 'birthdays', '#e91e63', 'VEVENT', NULL, 0)`,
            [user],
        );
        calendarId = Number(result.insertId);
    } else {
        calendarId = Number(calendarRows[0].id);
    }

    const [eventRows]: any = await connection.query(
        'SELECT uid, resource_name, ical_data FROM events WHERE calendar_id = ? ORDER BY uid ASC FOR UPDATE',
        [calendarId],
    );
    const existingEvents = new Map<string, { icalData: string; resourceName: string }>(
        eventRows.map((row: any) => [String(row.uid), {
            icalData: String(row.ical_data || ''),
            resourceName: String(row.resource_name || row.uid),
        }]),
    );
    const [tombstoneRows]: any = await connection.query(
        'SELECT uid, resource_name FROM calendar_tombstones WHERE calendar_id = ? FOR UPDATE',
        [calendarId],
    );
    const tombstoneResourceNames = new Set<string>(
        tombstoneRows.map((row: any) => String(row.resource_name || row.uid)),
    );
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
    if (staleEvents.length === 0 && upserts.length === 0) return false;

    const revision = await allocateCalendarCollectionRevisionOnConnection(connection, calendarId);
    if (staleEvents.length > 0) {
        const placeholders = staleEvents.map(() => '?').join(',');
        await connection.query(
            `DELETE FROM events WHERE calendar_id = ? AND uid IN (${placeholders})`,
            [calendarId, ...staleEvents.map(([uid]) => uid)],
        );
        for (const [uid, event] of staleEvents) {
            await connection.query(
                `INSERT INTO calendar_tombstones
                 (calendar_id, uid, resource_name, sync_token)
                 VALUES (?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE
                    uid=VALUES(uid), resource_name=VALUES(resource_name),
                    sync_token=VALUES(sync_token), deleted_at=NOW()`,
                [calendarId, uid, event.resourceName, revision],
            );
        }
    }
    if (desiredTombstones.length > 0) {
        const placeholders = desiredTombstones.map(() => '?').join(',');
        await connection.query(
            `DELETE FROM calendar_tombstones
             WHERE calendar_id = ? AND resource_name IN (${placeholders})`,
            [calendarId, ...desiredTombstones],
        );
    }
    for (const [uid, icalData] of upserts) {
        await connection.query(
            `INSERT INTO events (calendar_id, uid, resource_name, ical_data, sync_token)
             VALUES (?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE ical_data=VALUES(ical_data), sync_token=VALUES(sync_token)`,
            [calendarId, uid, uid, icalData, revision],
        );
    }
    return true;
}

export async function repairBirthdayCalendarProjection(user: string): Promise<boolean> {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        const changed = await rebuildBirthdayCalendarProjectionOnConnection(connection, user);
        if (changed) await connection.commit();
        else await connection.rollback();
        return changed;
    } catch (error) {
        await connection.rollback().catch(() => {});
        throw error;
    } finally {
        connection.release();
    }
}

export async function repairAllBirthdayCalendarProjections(): Promise<{ usersChecked: number; usersChanged: number }> {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        const [rows]: any = await connection.query(
            `SELECT username
             FROM contacts
             WHERE deleted_at IS NULL
             UNION
             SELECT user_id AS username
             FROM calendars
             WHERE dav_slug = 'birthdays'
             ORDER BY username ASC`,
        );
        let usersChanged = 0;
        for (const row of rows) {
            if (await rebuildBirthdayCalendarProjectionOnConnection(
                connection,
                String(row.username),
            )) usersChanged += 1;
        }
        if (usersChanged > 0) await connection.commit();
        else await connection.rollback();
        return { usersChecked: rows.length, usersChanged };
    } catch (error) {
        await connection.rollback().catch(() => {});
        throw error;
    } finally {
        connection.release();
    }
}
