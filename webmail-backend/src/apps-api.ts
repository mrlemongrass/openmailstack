import { Router, Request, Response, NextFunction } from 'express';
import { pool } from './db';
import { requireSession } from './auth';
import {
    allocateCalendarCollectionRevisionOnConnection,
    createCalendar,
    getVisibleCalendars,
    isReservedManagedCalendarSlug,
    expandRecurringEvent,
    parseIcalEvent,
    type CalendarMutationConnection,
} from './calendar-utils';
import { normalizeCalendarSharePermission } from './eas-calendar';
import {
    isManagedBirthdayCalendar,
    syncContactBirthdayEvent,
    type BirthdayContactIdentity,
} from './birthday-calendar';
import { validateCalendarSubscriptionUrl } from './calendar-subscription-http';
import {
    ICalendarValidationError,
    MAX_ICAL_DOCUMENT_BYTES,
    validateICalendarDocument,
    type ValidatedICalendarDocument,
    type ValidatedICalendarResource,
} from './calendar-ical-validation';
import {
    AmbiguousVCardUidError,
    contactIdentityRank,
    createContactUid,
    extractVCardBirthday,
    extractVCardUid,
    findContactDavUidByVCardUidOnConnection,
    getContactDavUid,
    InvalidContactBirthdayError,
    nextContactSyncTokenOnConnection,
    normalizeContactBirthday,
    normalizeVCardData,
    parseVCard,
    patchVCardData,
    purgeExpiredContacts,
    recordContactTombstoneOnConnection,
    saveContactFromVCardOnConnection,
    withContactMutation,
} from './contact-utils';

export const appsApiRouter = Router();

// Middleware to protect routes and extract username
const authenticateApp = (req: Request, res: Response, next: NextFunction) => {
    requireSession(req, res, () => {
        (req as any).username = (req as any).user.username;
        next();
    });
};

appsApiRouter.use(authenticateApp);

function emitContactsUpdated(user: string, details: Record<string, any> = {}) {
    try {
        const { io } = require('./index');
        io.to(user).emit('contacts_updated', details);
    } catch {}
}

function emitCalendarUpdated(user: string, calendarId: string | number) {
    try {
        const { io } = require('./index');
        io.to(user).emit('calendar_updated', { calendarId });
    } catch {}
}

async function userCanWriteCalendarOnConnection(
    connection: CalendarMutationConnection,
    user: string,
    calendarId: string | number,
    ownerOnly = false,
): Promise<boolean> {
    const [rows]: any = await connection.query(
        ownerOnly
            ? `SELECT id, dav_slug, subscribed_url FROM calendars
               WHERE id = ? AND user_id = ?
               FOR UPDATE`
            : `SELECT c.id, c.dav_slug, c.subscribed_url
               FROM calendars c
               LEFT JOIN calendar_shares cs ON cs.calendar_id = c.id AND cs.shared_with_user_id = ?
               WHERE c.id = ? AND (c.user_id = ? OR cs.permission = 'write')
               FOR UPDATE`,
        ownerOnly ? [calendarId, user] : [user, calendarId, user],
    );
    return rows.length === 1
        && !isManagedBirthdayCalendar(rows[0])
        && !String(rows[0].subscribed_url || '').trim();
}

function isDuplicateKeyError(error: unknown): boolean {
    const candidate = error as { code?: unknown; errno?: unknown } | null;
    return candidate?.code === 'ER_DUP_ENTRY' || Number(candidate?.errno) === 1062;
}

function normalizedCalendarSubscriptionUrl(value: unknown): string | null {
    if (value === undefined || value === null || (typeof value === 'string' && !value.trim())) return null;
    return validateCalendarSubscriptionUrl(value).toString();
}

const MAX_WEB_CALENDAR_RESOURCES = 1_000;

function validatedWebCalendarEvent(input: string): ValidatedICalendarResource {
    const validated = validateICalendarDocument(input, {
        maxResourceComponents: MAX_WEB_CALENDAR_RESOURCES,
    });
    if (validated.resources.length !== 1 || validated.resources[0].componentType !== 'VEVENT') {
        throw new ICalendarValidationError('Calendar event data must contain exactly one VEVENT resource');
    }
    return validated.resources[0];
}

interface CalendarComponentBlock {
    type: string;
    icalData: string;
}

/**
 * The shared validator has already proved component nesting at this point.
 * This small structural walk only separates its canonical top-level blocks so
 * export can combine stored resources without regex-truncating recurrence
 * exceptions or their VTIMEZONE definitions.
 */
function validatedTopLevelCalendarBlocks(icalData: string): CalendarComponentBlock[] {
    const lines = icalData.replaceAll('\r\n', '\n').replaceAll('\r', '\n').split('\n');
    const blocks: CalendarComponentBlock[] = [];
    let depth = 0;
    let currentType = '';
    let currentLines: string[] = [];
    for (const line of lines) {
        const separator = line.indexOf(':');
        const marker = separator > 0 ? line.slice(0, separator).toUpperCase() : '';
        const componentType = separator > 0 ? line.slice(separator + 1).toUpperCase() : '';
        if (depth === 0) {
            if (marker === 'BEGIN' && componentType !== 'VCALENDAR') {
                depth = 1;
                currentType = componentType;
                currentLines = [line];
            }
            continue;
        }
        currentLines.push(line);
        if (marker === 'BEGIN') depth += 1;
        else if (marker === 'END') {
            depth -= 1;
            if (depth === 0) {
                blocks.push({ type: currentType, icalData: currentLines.join('\r\n') });
                currentType = '';
                currentLines = [];
            }
        }
    }
    return blocks;
}

interface ParsedOccurrenceExclusion {
    date: string;
    localDateTime: string | null;
    instant: Date | null;
}

function validCalendarDateTimeParts(parts: number[]): boolean {
    const [year, month, day, hour = 0, minute = 0, second = 0] = parts;
    const value = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
    return value.getUTCFullYear() === year
        && value.getUTCMonth() + 1 === month
        && value.getUTCDate() === day
        && value.getUTCHours() === hour
        && value.getUTCMinutes() === minute
        && value.getUTCSeconds() === second;
}

function parseOccurrenceExclusion(value: string): ParsedOccurrenceExclusion {
    const input = value.trim();
    if (!input || Buffer.byteLength(input, 'utf8') > 64) {
        throw new ICalendarValidationError('Invalid recurring occurrence date');
    }
    const dateOnly = input.match(/^(\d{4})-?(\d{2})-?(\d{2})$/);
    if (dateOnly) {
        const parts = dateOnly.slice(1).map(Number);
        if (!validCalendarDateTimeParts(parts)) throw new ICalendarValidationError('Invalid recurring occurrence date');
        return { date: dateOnly.slice(1).join(''), localDateTime: null, instant: null };
    }

    const dateTime = input.match(
        /^(\d{4})-?(\d{2})-?(\d{2})T(\d{2}):?(\d{2}):?(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:?\d{2})?$/,
    );
    if (!dateTime) throw new ICalendarValidationError('Invalid recurring occurrence date');
    const parts = dateTime.slice(1, 7).map(Number);
    if (!validCalendarDateTimeParts(parts)) throw new ICalendarValidationError('Invalid recurring occurrence date');
    const date = dateTime.slice(1, 4).join('');
    const localDateTime = `${date}T${dateTime.slice(4, 7).join('')}`;
    if (!dateTime[7]) return { date, localDateTime, instant: null };

    const zone = /^[+-]\d{4}$/.test(dateTime[7])
        ? `${dateTime[7].slice(0, 3)}:${dateTime[7].slice(3)}`
        : dateTime[7];
    const iso = `${dateTime[1]}-${dateTime[2]}-${dateTime[3]}T${dateTime[4]}:${dateTime[5]}:${dateTime[6]}${zone}`;
    const instant = new Date(iso);
    if (!Number.isFinite(instant.getTime())) throw new ICalendarValidationError('Invalid recurring occurrence date');
    return { date, localDateTime, instant };
}

function compactUtcDateTime(value: Date): string {
    return value.toISOString().slice(0, 19).replaceAll('-', '').replaceAll(':', '') + 'Z';
}

function compactDateTimeInZone(value: Date, timeZone: string): string {
    let parts: Intl.DateTimeFormatPart[];
    try {
        parts = new Intl.DateTimeFormat('en-US', {
            timeZone,
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit',
            hourCycle: 'h23',
        }).formatToParts(value);
    } catch {
        throw new ICalendarValidationError('Invalid recurring occurrence time zone');
    }
    const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(candidate => candidate.type === type)?.value || '';
    const formatted = `${part('year')}${part('month')}${part('day')}T${part('hour')}${part('minute')}${part('second')}`;
    if (!/^\d{8}T\d{6}$/.test(formatted)) throw new ICalendarValidationError('Invalid recurring occurrence time zone');
    return formatted;
}

function unfoldedCalendarLines(source: string): string[] {
    const lines: string[] = [];
    for (const line of source.replaceAll('\r\n', '\n').replaceAll('\r', '\n').split('\n')) {
        if (/^[ \t]/.test(line)) lines[lines.length - 1] += line.slice(1);
        else lines.push(line);
    }
    return lines;
}

function calendarProperty(line: string): { name: string; header: string; value: string } {
    const separator = line.indexOf(':');
    if (separator < 1) throw new ICalendarValidationError('Invalid iCalendar property');
    const header = line.slice(0, separator);
    return { name: header.split(';', 1)[0].toUpperCase(), header, value: line.slice(separator + 1) };
}

function calendarParameterIdentity(header: string): string {
    return header.split(';').slice(1).map(parameter => parameter.toUpperCase()).sort().join(';');
}

function addRecurringOccurrenceExclusion(source: string, exclude: string): string {
    const resource = validatedWebCalendarEvent(source);
    const lines = unfoldedCalendarLines(resource.icalData);
    const stack: string[] = [];
    const masters: Array<{ end: number; direct: number[] }> = [];
    let current: { direct: number[] } | null = null;
    for (let index = 0; index < lines.length; index += 1) {
        const boundary = lines[index].match(/^(BEGIN|END):([A-Z0-9-]+)$/i);
        if (boundary?.[1].toUpperCase() === 'BEGIN') {
            if (stack.length === 1 && boundary[2].toUpperCase() === 'VEVENT') current = { direct: [] };
            stack.push(boundary[2].toUpperCase());
            continue;
        }
        if (boundary?.[1].toUpperCase() === 'END') {
            if (current && stack.length === 2 && stack[1] === 'VEVENT') {
                const recurringInstance = current.direct.some(lineIndex => calendarProperty(lines[lineIndex]).name === 'RECURRENCE-ID');
                if (!recurringInstance) masters.push({ end: index, direct: current.direct });
                current = null;
            }
            stack.pop();
            continue;
        }
        if (current && stack.length === 2 && lines[index]) current.direct.push(index);
    }
    if (masters.length !== 1) throw new ICalendarValidationError('Recurring event master is missing');
    const master = masters[0];
    if (!master.direct.some(index => calendarProperty(lines[index]).name === 'RRULE')) {
        throw new ICalendarValidationError('Event is not recurring');
    }
    const dtstartIndex = master.direct.find(index => calendarProperty(lines[index]).name === 'DTSTART');
    if (dtstartIndex === undefined) throw new ICalendarValidationError('Recurring event DTSTART is missing');
    const dtstart = calendarProperty(lines[dtstartIndex]);
    const parameters = dtstart.header.slice('DTSTART'.length);
    const occurrence = parseOccurrenceExclusion(exclude);
    const dateValue = /(?:^|;)VALUE=DATE(?:;|$)/i.test(parameters) || /^\d{8}$/.test(dtstart.value);
    if (!dateValue && !occurrence.localDateTime) {
        throw new ICalendarValidationError('Timed recurring occurrences require a date and time');
    }
    let exclusionValue: string;
    if (dateValue) {
        exclusionValue = occurrence.date;
    } else if (dtstart.value.endsWith('Z')) {
        exclusionValue = occurrence.instant
            ? compactUtcDateTime(occurrence.instant)
            : `${occurrence.localDateTime}Z`;
    } else {
        const timeZone = parameters.match(/(?:^|;)TZID=(?:"([^"]+)"|([^;]+))/i)?.slice(1).find(Boolean);
        exclusionValue = timeZone && occurrence.instant
            ? compactDateTimeInZone(occurrence.instant, timeZone)
            : occurrence.localDateTime || `${occurrence.date}T000000`;
    }

    const parameterIdentity = calendarParameterIdentity(`EXDATE${parameters}`);
    const alreadyExcluded = master.direct.some(index => {
        const property = calendarProperty(lines[index]);
        return property.name === 'EXDATE'
            && calendarParameterIdentity(property.header) === parameterIdentity
            && property.value.split(',').includes(exclusionValue);
    });
    if (alreadyExcluded) return resource.icalData;

    lines.splice(master.end, 0, `EXDATE${parameters}:${exclusionValue}`);
    const rebuilt = validatedWebCalendarEvent(lines.join('\r\n'));
    if (rebuilt.uid !== resource.uid) throw new ICalendarValidationError('Recurring event identity changed');
    return rebuilt.icalData;
}

interface LegacyCalendarParts {
    calendarProperties: string[];
    components: Array<{ type: string; lines: string[] }>;
}

function legacyCalendarBoundary(line: string): { marker: 'BEGIN' | 'END'; type: string } | null {
    const separator = line.indexOf(':');
    if (separator < 1) return null;
    const marker = line.slice(0, separator).toUpperCase();
    if (marker !== 'BEGIN' && marker !== 'END') return null;
    const type = line.slice(separator + 1).toUpperCase();
    return type ? { marker, type } as { marker: 'BEGIN' | 'END'; type: string } : null;
}

function legacyCalendarPropertyName(line: string): string {
    const separator = line.indexOf(':');
    return separator > 0 ? line.slice(0, separator).split(';', 1)[0].toUpperCase() : '';
}

function structurallyParseLegacyCalendar(source: string): LegacyCalendarParts {
    if (Buffer.byteLength(source, 'utf8') > MAX_ICAL_DOCUMENT_BYTES) {
        throw new ICalendarValidationError('Legacy calendar resource is too large');
    }
    const physicalLines = source.replaceAll('\r\n', '\n').replaceAll('\r', '\n').split('\n');
    const lines: string[] = [];
    for (const line of physicalLines) {
        if (line.startsWith(' ') || line.startsWith('\t')) {
            if (lines.length === 0) throw new ICalendarValidationError('Invalid legacy iCalendar folding');
            lines[lines.length - 1] += line.slice(1);
        } else {
            lines.push(line);
        }
    }

    const calendarProperties: string[] = [];
    const components: LegacyCalendarParts['components'] = [];
    const stack: string[] = [];
    let current: LegacyCalendarParts['components'][number] | null = null;
    let rootSeen = false;
    let rootClosed = false;
    for (const line of lines) {
        const boundary = legacyCalendarBoundary(line);
        if (boundary?.marker === 'BEGIN') {
            if (stack.length === 0) {
                if (rootSeen || rootClosed || boundary.type !== 'VCALENDAR') {
                    throw new ICalendarValidationError('Invalid legacy iCalendar root');
                }
                rootSeen = true;
            } else if (stack.length === 1) {
                current = { type: boundary.type, lines: [line] };
            } else {
                current?.lines.push(line);
            }
            stack.push(boundary.type);
            continue;
        }
        if (boundary?.marker === 'END') {
            if (stack.length === 0 || stack[stack.length - 1] !== boundary.type) {
                throw new ICalendarValidationError('Mismatched legacy iCalendar component');
            }
            if (stack.length >= 2) current?.lines.push(line);
            stack.pop();
            if (stack.length === 1 && current) {
                components.push(current);
                current = null;
            } else if (stack.length === 0) {
                if (boundary.type !== 'VCALENDAR') {
                    throw new ICalendarValidationError('Invalid legacy iCalendar root closure');
                }
                rootClosed = true;
            }
            continue;
        }
        if (stack.length === 0) {
            if (line.trim()) throw new ICalendarValidationError('Data outside legacy VCALENDAR is not allowed');
        } else if (stack.length === 1) {
            if (line) calendarProperties.push(line);
        } else if (line) {
            current?.lines.push(line);
        }
    }
    if (!rootSeen || !rootClosed || stack.length !== 0 || current) {
        throw new ICalendarValidationError('Truncated legacy iCalendar resource');
    }
    return { calendarProperties, components };
}

function legacyExportDtstamp(updatedAt: unknown): string {
    let timestamp: Date;
    if (updatedAt instanceof Date) timestamp = updatedAt;
    else {
        const value = String(updatedAt || '').trim();
        const mysqlUtc = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
            ? `${value.replace(' ', 'T')}Z`
            : value;
        timestamp = new Date(mysqlUtc);
    }
    if (!Number.isFinite(timestamp.getTime())) return '19700101T000000Z';
    return timestamp.toISOString().replaceAll('-', '').replaceAll(':', '').replace(/\.\d{3}Z$/, 'Z');
}

function addMissingLegacyDtstamp(component: LegacyCalendarParts['components'][number], dtstamp: string): string[] {
    if (component.type !== 'VEVENT') return component.lines;
    let depth = 0;
    let directDtstamps = 0;
    let uidIndex = -1;
    for (let index = 1; index < component.lines.length - 1; index += 1) {
        const line = component.lines[index];
        const boundary = legacyCalendarBoundary(line);
        if (boundary?.marker === 'BEGIN') {
            depth += 1;
            continue;
        }
        if (boundary?.marker === 'END') {
            depth = Math.max(0, depth - 1);
            continue;
        }
        if (depth !== 0) continue;
        const propertyName = legacyCalendarPropertyName(line);
        if (propertyName === 'DTSTAMP') directDtstamps += 1;
        if (propertyName === 'UID' && uidIndex < 0) uidIndex = index;
    }
    if (directDtstamps !== 0) return component.lines;
    const normalized = [...component.lines];
    normalized.splice(uidIndex >= 0 ? uidIndex + 1 : 1, 0, `DTSTAMP:${dtstamp}`);
    return normalized;
}

function validateStoredCalendarForExport(icalData: string, updatedAt: unknown): ValidatedICalendarDocument {
    const validationOptions = {
        allowMultipleResourceUids: true,
        maxResourceComponents: MAX_WEB_CALENDAR_RESOURCES,
    } as const;
    try {
        return validateICalendarDocument(icalData, validationOptions);
    } catch {
        const parsed = structurallyParseLegacyCalendar(icalData);
        const calendarProperties = parsed.calendarProperties
            .filter(line => legacyCalendarPropertyName(line) !== 'METHOD');
        if (!calendarProperties.some(line => legacyCalendarPropertyName(line) === 'VERSION')) {
            calendarProperties.unshift('VERSION:2.0');
        }
        if (!calendarProperties.some(line => legacyCalendarPropertyName(line) === 'PRODID')) {
            const versionIndex = calendarProperties
                .findIndex(line => legacyCalendarPropertyName(line) === 'VERSION');
            calendarProperties.splice(versionIndex + 1, 0, 'PRODID:-//OpenMailStack//Legacy Export//EN');
        }
        const dtstamp = legacyExportDtstamp(updatedAt);
        const normalized = [
            'BEGIN:VCALENDAR',
            ...calendarProperties,
            ...parsed.components.flatMap(component => addMissingLegacyDtstamp(component, dtstamp)),
            'END:VCALENDAR',
        ].join('\r\n');
        return validateICalendarDocument(normalized, validationOptions);
    }
}

// ==========================================
// CONTACTS API
// ==========================================
appsApiRouter.get('/contacts', async (req: Request, res: Response) => {
    const user = (req as any).username;
    const offset = parseInt(req.query.offset as string || '0', 10) || 0;
    const limit = Math.min(parseInt(req.query.limit as string || '200', 10) || 200, 500);
    const query = String(req.query.q || '').trim().slice(0, 120);
    const requestedSort = String(req.query.sortBy || 'firstName');
    const sortBy = ['firstName', 'lastName', 'email'].includes(requestedSort) ? requestedSort : 'firstName';
    const orderBy = sortBy === 'lastName'
        ? `is_favorite DESC,
           COALESCE(NULLIF(last_name, ''), NULLIF(SUBSTRING_INDEX(TRIM(name), ' ', -1), ''), email) ASC,
           COALESCE(NULLIF(first_name, ''), NULLIF(SUBSTRING_INDEX(TRIM(name), ' ', 1), ''), name) ASC,
           email ASC,
           id ASC`
        : sortBy === 'email'
            ? `is_favorite DESC, email ASC, name ASC, id ASC`
            : `is_favorite DESC,
               COALESCE(NULLIF(first_name, ''), NULLIF(SUBSTRING_INDEX(TRIM(name), ' ', 1), ''), email) ASC,
               COALESCE(NULLIF(last_name, ''), NULLIF(SUBSTRING_INDEX(TRIM(name), ' ', -1), ''), name) ASC,
               email ASC,
               id ASC`;
    try {
        await purgeExpiredContacts(user);
        const whereParts = ['username = ?', 'deleted_at IS NULL'];
        const whereParams: any[] = [user];
        if (query) {
            const likeQuery = `%${query.replace(/[\\%_]/g, '\\$&')}%`;
            const searchFields = [
                'name',
                'email',
                'phone',
                'organization',
                'job_title',
                'notes',
                'first_name',
                'last_name',
                'nickname',
                'department',
                'website_url',
                'vcard_data',
                'CAST(emails_json AS CHAR)',
                'CAST(phones_json AS CHAR)',
                'CAST(addresses_json AS CHAR)',
            ];
            whereParts.push(`(${searchFields.map(field => `COALESCE(${field}, '') LIKE ? ESCAPE '\\\\'`).join(' OR ')})`);
            whereParams.push(...searchFields.map(() => likeQuery));
        }
        const whereSql = whereParts.join(' AND ');
        const [countRows]: any = await pool.query(
            `SELECT COUNT(*) AS total FROM contacts WHERE ${whereSql}`,
            whereParams
        );
        const [rows]: any = await pool.query(
            `SELECT id, username, name, email, phone, dav_uid, sync_token, updated_at,
                    emails_json, phones_json, addresses_json, job_title, organization,
                    notes, labels_json, photo_url, is_favorite,
                    prefix, first_name, middle_name, last_name, suffix, nickname,
                    department, birthday, website_url
             FROM contacts WHERE ${whereSql}
             ORDER BY ${orderBy}
             LIMIT ? OFFSET ?`,
            [...whereParams, limit + 1, offset]
        );
        const hasMore = rows.length > limit;
        if (hasMore) rows.pop();
        // Parse JSON columns (mysql2 returns them as strings)
        for (const row of rows) {
            for (const col of ['emails_json', 'phones_json', 'addresses_json', 'labels_json']) {
                if (typeof row[col] === 'string') {
                    try { row[col] = JSON.parse(row[col]); } catch {}
                }
            }
        }
        res.json({ success: true, contacts: rows, hasMore, total: Number(countRows[0]?.total || 0) });
    } catch (e: any) {
        res.status(500).json({ success: false, error: e.message });
    }
});

appsApiRouter.post('/contacts', async (req: Request, res: Response) => {
    const user = (req as any).username;
    const { name, email, phone, vcard_data, emails_json, phones_json, addresses_json, job_title, organization, notes, labels_json, photo_url } = req.body;
    try {
        const davUid = createContactUid();
        const suppliedVCard = typeof vcard_data === 'string' && vcard_data.trim() ? vcard_data : '';
        const suppliedContact = suppliedVCard ? parseVCard(suppliedVCard) : null;
        const prefix = req.body.prefix ?? suppliedContact?.prefix ?? '';
        const firstName = req.body.first_name ?? suppliedContact?.firstName ?? '';
        const middleName = req.body.middle_name ?? suppliedContact?.middleName ?? '';
        const lastName = req.body.last_name ?? suppliedContact?.lastName ?? '';
        const suffix = req.body.suffix ?? suppliedContact?.suffix ?? '';
        const nickname = req.body.nickname ?? suppliedContact?.nickname ?? '';
        const department = req.body.department ?? suppliedContact?.department ?? '';
        const websiteUrl = req.body.website_url ?? suppliedContact?.websiteUrl ?? '';
        const resolvedEmail = email ?? suppliedContact?.email ?? '';
        const resolvedPhone = phone ?? suppliedContact?.phone ?? '';
        const resolvedJobTitle = job_title ?? suppliedContact?.title ?? '';
        const resolvedOrganization = organization ?? suppliedContact?.organization ?? '';
        const resolvedNotes = notes ?? suppliedContact?.note ?? '';
        const parsedEmailsJson = suppliedContact?.emails?.length
            ? suppliedContact.emails.map(value => ({ value, label: 'Other' }))
            : null;
        const parsedPhonesJson = suppliedContact?.phoneItems?.length
            ? suppliedContact.phoneItems.map(item => ({
                value: item.value,
                label: item.label,
                ...(item.types.length > 0 ? { type: item.types.join(',') } : {}),
            }))
            : null;
        const parsedAddressesJson = suppliedContact?.address
            ? [{ value: suppliedContact.address, label: 'Other' }]
            : null;
        const resolvedEmailsJson = emails_json !== undefined ? emails_json : parsedEmailsJson;
        const resolvedPhonesJson = phones_json !== undefined ? phones_json : parsedPhonesJson;
        const resolvedAddressesJson = addresses_json !== undefined ? addresses_json : parsedAddressesJson;
        const birthday = Object.prototype.hasOwnProperty.call(req.body, 'birthday')
            ? normalizeContactBirthday(req.body.birthday)
            : suppliedVCard
                ? extractVCardBirthday(suppliedVCard)
                : null;
        const fullName = name
            || suppliedContact?.name
            || [prefix, firstName, middleName, lastName, suffix].filter(Boolean).join(' ')
            || resolvedEmail
            || '';
        const vcardBase = suppliedVCard
            ? normalizeVCardData(suppliedVCard, davUid, {
                name: fullName,
                email: resolvedEmail,
                phone: resolvedPhone,
            })
            : '';
        const newVcardData = patchVCardData(vcardBase, davUid, {
            name: fullName,
            first_name: firstName || suppliedContact?.firstName,
            last_name: lastName || suppliedContact?.lastName,
            middle_name: middleName || suppliedContact?.middleName,
            prefix: prefix || suppliedContact?.prefix,
            suffix: suffix || suppliedContact?.suffix,
            email: resolvedEmail,
            phone: resolvedPhone,
            emails_json: resolvedEmailsJson,
            phones_json: resolvedPhonesJson,
            job_title: resolvedJobTitle,
            organization: resolvedOrganization,
            department,
            notes: resolvedNotes,
            birthday,
        });
        const result: any = await withContactMutation(user, async connection => {
            const syncToken = await nextContactSyncTokenOnConnection(connection, user);
            const [insertResult]: any = await connection.query(
                `INSERT INTO contacts
                (username, name, email, phone, vcard_data, dav_uid, emails_json, phones_json, addresses_json, job_title, organization, notes, labels_json, photo_url, sync_token, prefix, first_name, middle_name, last_name, suffix, nickname, department, birthday, website_url)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [
                    user,
                    fullName || '',
                    resolvedEmail,
                    resolvedPhone,
                    newVcardData,
                    davUid,
                    resolvedEmailsJson ? JSON.stringify(resolvedEmailsJson) : null,
                    resolvedPhonesJson ? JSON.stringify(resolvedPhonesJson) : null,
                    resolvedAddressesJson ? JSON.stringify(resolvedAddressesJson) : null,
                    resolvedJobTitle || null,
                    resolvedOrganization || null,
                    resolvedNotes || null,
                    labels_json ? JSON.stringify(labels_json) : null,
                    photo_url || null,
                    syncToken,
                    prefix || null,
                    firstName || null,
                    middleName || null,
                    lastName || null,
                    suffix || null,
                    nickname || null,
                    department || null,
                    birthday,
                    websiteUrl || null,
                ],
            );
            await syncContactBirthdayEvent(connection, user, {
                contactId: insertResult.insertId,
                davUid,
                name: fullName || resolvedEmail,
                email: resolvedEmail,
            }, birthday);
            return insertResult;
        });
        emitContactsUpdated(user, { contactId: result.insertId });
        res.json({ success: true, id: result.insertId });
    } catch (e: any) {
        if (e instanceof InvalidContactBirthdayError) {
            return res.status(400).json({ success: false, error: e.message });
        }
        res.status(500).json({ success: false, error: e.message });
    }
});

appsApiRouter.put('/contacts/:id', async (req: Request, res: Response) => {
    const user = (req as any).username;
    const { name, email, phone, vcard_data, emails_json, phones_json, addresses_json, job_title, organization, notes, labels_json, photo_url, prefix, first_name, middle_name, last_name, suffix, nickname, department, birthday, website_url } = req.body;
    try {
        const requestedBirthday: string | null | undefined = Object.prototype.hasOwnProperty.call(req.body, 'birthday')
            ? normalizeContactBirthday(birthday)
            : typeof vcard_data === 'string'
                ? extractVCardBirthday(vcard_data)
                : undefined;
        const saved = await withContactMutation(user, async connection => {
            const [existing]: any = await connection.query(
                'SELECT * FROM contacts WHERE id=? AND username=? AND deleted_at IS NULL',
                [req.params.id as string, user],
            );
            if (existing.length === 0) return null;

            const existingContact = existing[0];
            const previousBirthdayIdentity: BirthdayContactIdentity = {
                contactId: existingContact.id,
                davUid: existingContact.dav_uid,
                name: existingContact.name,
                email: existingContact.email,
            };
            const davUid = existingContact.dav_uid || `contact-${existingContact.id}`;
            const savedBirthday = requestedBirthday === undefined
                ? normalizeContactBirthday(existingContact.birthday)
                : requestedBirthday;
            const baseVCard = typeof vcard_data === 'string'
                ? normalizeVCardData(vcard_data, davUid, {
                    name: name || existingContact.name || '',
                    email: email || existingContact.email || '',
                    phone: phone || existingContact.phone || '',
                })
                : normalizeVCardData(existingContact.vcard_data || '', davUid, {
                    name: existingContact.name || '',
                    email: existingContact.email || '',
                    phone: existingContact.phone || '',
                });
            const baseContact = parseVCard(baseVCard);
            const fullName = name
                || [prefix, first_name, middle_name, last_name, suffix].filter(Boolean).join(' ')
                || email
                || baseContact.name
                || '';
            const newVcardData = patchVCardData(baseVCard, davUid, {
                name: fullName,
                first_name: first_name || baseContact.firstName,
                last_name: last_name || baseContact.lastName,
                middle_name: middle_name || baseContact.middleName,
                prefix: prefix || baseContact.prefix,
                suffix: suffix || baseContact.suffix,
                email: email || baseContact.email,
                phone: phone || baseContact.phone,
                emails_json,
                phones_json,
                job_title: job_title || baseContact.title,
                organization: organization || baseContact.organization,
                notes: notes || baseContact.note,
                birthday: savedBirthday,
            });

            const syncToken = await nextContactSyncTokenOnConnection(connection, user);
            const queryParams: any[] = [
                fullName || '',
                email || '',
                phone || '',
                newVcardData || '',
                emails_json ? JSON.stringify(emails_json) : null,
                phones_json ? JSON.stringify(phones_json) : null,
                addresses_json ? JSON.stringify(addresses_json) : null,
                job_title || null,
                organization || null,
                notes || null,
                labels_json ? JSON.stringify(labels_json) : null,
                first_name || null,
                last_name || null,
                middle_name || null,
                prefix || null,
                suffix || null,
                nickname || null,
                department || null,
                savedBirthday,
                website_url || null,
                syncToken,
            ];

            let updateSql = `UPDATE contacts SET name=?, email=?, phone=?, vcard_data=?, emails_json=?, phones_json=?, addresses_json=?, job_title=?, organization=?, notes=?, labels_json=?, first_name=?, last_name=?, middle_name=?, prefix=?, suffix=?, nickname=?, department=?, birthday=?, website_url=?, sync_token=?`;
            if (photo_url !== undefined) {
                updateSql += `, photo_url=?`;
                queryParams.push(photo_url || null);
            }
            updateSql += ` WHERE id=? AND username=?`;
            queryParams.push(req.params.id as string, user);
            await connection.query(updateSql, queryParams);
            const currentBirthdayIdentity: BirthdayContactIdentity = {
                contactId: existingContact.id,
                davUid: existingContact.dav_uid || `contact-${existingContact.id}`,
                name: fullName || existingContact.email || '',
                email: email || existingContact.email || '',
            };
            await syncContactBirthdayEvent(
                connection,
                user,
                currentBirthdayIdentity,
                savedBirthday,
                [previousBirthdayIdentity, currentBirthdayIdentity],
            );
            return true;
        });
        if (!saved) return res.status(404).json({ success: false, error: 'Contact not found' });
        emitContactsUpdated(user, { contactId: req.params.id });
        res.json({ success: true });
    } catch (e: any) {
        if (e instanceof InvalidContactBirthdayError) {
            return res.status(400).json({ success: false, error: e.message });
        }
        res.status(500).json({ success: false, error: e.message });
    }
});

appsApiRouter.put('/contacts/:id/favorite', async (req: Request, res: Response) => {
    const user = (req as any).username;
    try {
        const favorite = await withContactMutation(user, async connection => {
            const syncToken = await nextContactSyncTokenOnConnection(connection, user);
            const [result]: any = await connection.query(
                'UPDATE contacts SET is_favorite = IF(is_favorite, 0, 1), sync_token = ? WHERE id = ? AND username = ? AND deleted_at IS NULL',
                [syncToken, req.params.id, user],
            );
            if (result.affectedRows === 0) return null;
            const [rows]: any = await connection.query(
                'SELECT is_favorite FROM contacts WHERE id = ? AND username = ? AND deleted_at IS NULL',
                [req.params.id, user],
            );
            return rows[0]?.is_favorite === 1;
        });
        if (favorite === null) return res.status(404).json({ success: false, error: 'Contact not found' });
        emitContactsUpdated(user, { contactId: req.params.id });
        res.json({ success: true, is_favorite: favorite });
    } catch (e: any) {
        res.status(500).json({ success: false, error: e.message });
    }
});

appsApiRouter.post('/contacts/bulk-delete', async (req: Request, res: Response) => {
    const user = (req as any).username;
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ success: false, error: 'ids array required' });
    try {
        const deleted = await withContactMutation(user, async connection => {
            const placeholders = ids.map(() => '?').join(',');
            const [rows]: any = await connection.query(
                `SELECT id, name, email, dav_uid, birthday FROM contacts
                 WHERE id IN (${placeholders}) AND username = ? AND deleted_at IS NULL`,
                [...ids, user],
            );
            if (rows.length === 0) return 0;
            const syncToken = await nextContactSyncTokenOnConnection(connection, user);
            const activeIds = rows.map((row: any) => row.id);
            const activePlaceholders = activeIds.map(() => '?').join(',');
            const [result]: any = await connection.query(
                `UPDATE contacts SET deleted_at = NOW(), sync_token = ?
                 WHERE id IN (${activePlaceholders}) AND username = ? AND deleted_at IS NULL`,
                [syncToken, ...activeIds, user],
            );
            for (const contact of rows) {
                const identity: BirthdayContactIdentity = {
                    contactId: contact.id,
                    davUid: contact.dav_uid || `contact-${contact.id}`,
                    name: contact.name,
                    email: contact.email,
                };
                await recordContactTombstoneOnConnection(connection, user, identity.davUid!);
                await syncContactBirthdayEvent(connection, user, identity, null, [identity]);
            }
            return Number(result.affectedRows || 0);
        });
        if (deleted > 0) emitContactsUpdated(user, { deleted: true });
        res.json({ success: true, deleted });
    } catch (e: any) {
        res.status(500).json({ success: false, error: e.message });
    }
});

appsApiRouter.delete('/contacts/:id', async (req: Request, res: Response) => {
    const user = (req as any).username;
    try {
        const deleted = await withContactMutation(user, async connection => {
            const [rows]: any = await connection.query(
                `SELECT id, name, email, dav_uid, birthday FROM contacts
                 WHERE id = ? AND username = ? AND deleted_at IS NULL LIMIT 1`,
                [req.params.id as string, user],
            );
            if (rows.length === 0) return false;
            const contact = rows[0];
            const davUid = contact.dav_uid || `contact-${contact.id}`;
            const syncToken = await nextContactSyncTokenOnConnection(connection, user);
            const [result]: any = await connection.query(
                `UPDATE contacts SET dav_uid = ?, deleted_at = NOW(), sync_token = ?
                 WHERE id = ? AND username = ? AND deleted_at IS NULL`,
                [davUid, syncToken, contact.id, user],
            );
            if (result.affectedRows === 0) return false;
            await recordContactTombstoneOnConnection(connection, user, davUid);
            const identity: BirthdayContactIdentity = {
                contactId: contact.id,
                davUid,
                name: contact.name,
                email: contact.email,
            };
            await syncContactBirthdayEvent(connection, user, identity, null, [identity]);
            return true;
        });
        if (!deleted) return res.status(404).json({ success: false, error: 'Contact not found' });
        emitContactsUpdated(user, { contactId: req.params.id, deleted: true });
        res.json({ success: true });
    } catch (e: any) {
        res.status(500).json({ success: false, error: e.message });
    }
});

appsApiRouter.get('/contacts/trash', async (req: Request, res: Response) => {
    const user = (req as any).username;
    try {
        await purgeExpiredContacts(user);
        const [rows]: any = await pool.query(
            `SELECT id, name, email, phone, deleted_at
             FROM contacts WHERE username = ? AND deleted_at IS NOT NULL
             ORDER BY deleted_at DESC`,
            [user]
        );
        res.json({ success: true, contacts: rows });
    } catch (e: any) {
        res.status(500).json({ success: false, error: e.message });
    }
});

appsApiRouter.post('/contacts/:id/restore', async (req: Request, res: Response) => {
    const user = (req as any).username;
    try {
        const restored = await withContactMutation(user, async connection => {
            const [rows]: any = await connection.query(
                `SELECT id, name, email, dav_uid, birthday FROM contacts
                 WHERE id = ? AND username = ? AND deleted_at IS NOT NULL LIMIT 1`,
                [req.params.id as string, user],
            );
            if (rows.length === 0) return false;
            const contact = rows[0];
            const davUid = contact.dav_uid || `contact-${contact.id}`;
            const syncToken = await nextContactSyncTokenOnConnection(connection, user);
            const [result]: any = await connection.query(
                `UPDATE contacts SET dav_uid = ?, deleted_at = NULL, sync_token = ?
                 WHERE id = ? AND username = ? AND deleted_at IS NOT NULL`,
                [davUid, syncToken, contact.id, user],
            );
            if (result.affectedRows === 0) return false;
            await connection.query(
                'DELETE FROM contact_tombstones WHERE username = ? AND dav_uid = ?',
                [user, davUid],
            );
            const identity: BirthdayContactIdentity = {
                contactId: contact.id,
                davUid,
                name: contact.name,
                email: contact.email,
            };
            await syncContactBirthdayEvent(
                connection,
                user,
                identity,
                contact.birthday || null,
                [identity],
            );
            return true;
        });
        if (!restored) return res.status(404).json({ success: false, error: 'Contact not found in trash' });
        emitContactsUpdated(user, { contactId: req.params.id, restored: true });
        res.json({ success: true });
    } catch (e: any) {
        res.status(500).json({ success: false, error: e.message });
    }
});

appsApiRouter.delete('/contacts/:id/permanent', async (req: Request, res: Response) => {
    const user = (req as any).username;
    try {
        const deletedContact = await withContactMutation(user, async connection => {
            const [contactToDelete]: any = await connection.query(
                'SELECT id, name, email, dav_uid FROM contacts WHERE id=? AND username=? AND deleted_at IS NOT NULL',
                [req.params.id as string, user],
            );
            if (contactToDelete.length === 0) return null;
            const contact = contactToDelete[0];
            await recordContactTombstoneOnConnection(
                connection,
                user,
                contact.dav_uid || `contact-${contact.id}`,
            );
            await connection.query(
                'DELETE FROM contact_group_members WHERE contact_id = ?',
                [req.params.id as string],
            );
            const [delResult]: any = await connection.query(
                'DELETE FROM contacts WHERE id=? AND username=? AND deleted_at IS NOT NULL',
                [req.params.id as string, user],
            );
            if (delResult.affectedRows === 0) throw new Error('Contact disappeared during permanent deletion');
            const identity: BirthdayContactIdentity = {
                contactId: contact.id,
                davUid: contact.dav_uid || `contact-${contact.id}`,
                name: contact.name,
                email: contact.email,
            };
            await syncContactBirthdayEvent(connection, user, identity, null, [identity]);
            return contact;
        });
        if (!deletedContact) return res.status(404).json({ success: false, error: 'Contact not found in trash' });
        emitContactsUpdated(user, { contactId: req.params.id, deleted: true });
        res.json({ success: true });
    } catch (e: any) {
        res.status(500).json({ success: false, error: e.message });
    }
});

export const contactActivityAddressPattern = (email: string) => {
    const escaped = email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const emailCharacters = "a-z0-9.!#$%&'*+/=?^_`{|}~-";
    return `(^|[^${emailCharacters}])${escaped}([^${emailCharacters}]|$)`;
};

export const contactActivityAttendeePattern = (email: string) => {
    const escaped = email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const emailCharacters = "a-z0-9.!#$%&'*+/=?^_`{|}~-";
    return `mailto:${escaped}([^${emailCharacters}]|$)`;
};

appsApiRouter.get('/contacts/:id/activity', async (req: Request, res: Response) => {
    const user = (req as any).username;
    try {
        const [contactRows]: any = await pool.query(
            'SELECT email, emails_json FROM contacts WHERE id=? AND username=? AND deleted_at IS NULL',
            [req.params.id as string, user]
        );
        if (contactRows.length === 0) return res.status(404).json({ success: false, error: 'Contact not found' });

        const contact = contactRows[0];
        const emailCandidates: unknown[] = [contact.email];
        if (contact.emails_json) {
            let parsed = contact.emails_json;
            if (typeof parsed === 'string') {
                try {
                    parsed = JSON.parse(parsed);
                } catch {
                    parsed = [];
                }
            }
            if (Array.isArray(parsed)) {
                for (const item of parsed) {
                    emailCandidates.push(item?.value);
                }
            }
        }
        const emails = Array.from(new Set(emailCandidates
            .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
            .map((value) => value.trim().toLowerCase())));
        if (emails.length === 0) {
            return res.json({ success: true, emails: [], meetings: [] });
        }

        const mailPredicates = emails.map(() => (
            `(LOWER(COALESCE(sender, '')) REGEXP ?
              OR LOWER(COALESCE(recipients, '')) REGEXP ?)`
        )).join(' OR ');
        const [emailRows]: any = await pool.query(
            `SELECT subject, sent_at AS received_at, id, COALESCE(preview, '') AS snippet
             FROM mail_search_index
             WHERE username = ? AND (${mailPredicates})
             ORDER BY sent_at DESC LIMIT 20`,
            [user, ...emails.flatMap((email) => {
                const pattern = contactActivityAddressPattern(email);
                return [pattern, pattern];
            })]
        );

        const attendeePredicates = emails.map(() => (
            `LOWER(e.ical_data) REGEXP ?`
        )).join(' OR ');
        const [eventRows]: any = await pool.query(
            `SELECT e.uid, e.ical_data
             FROM events e
             JOIN calendars c ON c.id = e.calendar_id
             WHERE c.user_id = ? AND (${attendeePredicates})`,
            [user, ...emails.map(contactActivityAttendeePattern)]
        );

        const now = new Date();
        const expansionEnd = new Date(now);
        expansionEnd.setUTCFullYear(expansionEnd.getUTCFullYear() + 2);
        const meetings = eventRows.flatMap((row: any) => {
            try {
                const parsed = parseIcalEvent(row.uid, row.ical_data || '');
                const occurrences = parsed.recurrence
                    ? expandRecurringEvent(parsed, now, expansionEnd)
                    : [parsed];
                return occurrences
                    .filter((occurrence) => new Date(occurrence.end || occurrence.start) >= now)
                    .map((occurrence) => ({
                        id: occurrence.occurrenceId || row.uid,
                        title: occurrence.title || 'Meeting',
                        start: new Date(occurrence.start).toISOString(),
                    }));
            } catch {
                return [];
            }
        }).sort((left: any, right: any) => (
            new Date(left.start).getTime() - new Date(right.start).getTime()
        )).slice(0, 10);

        res.json({ success: true, emails: emailRows, meetings });
    } catch (e: any) {
        res.status(500).json({ success: false, error: e.message });
    }
});

appsApiRouter.post('/contacts/:id/share', async (req: Request, res: Response) => {
    const user = (req as any).username;
    const shareTo = req.body.recipientEmail as string;
    const shareMsg = (req.body.message as string) || '';

    if (!shareTo || !shareTo.includes('@')) {
        return res.status(400).json({ success: false, error: 'Valid recipient email is required' });
    }

    try {
        const [rows]: any = await pool.query(
            'SELECT * FROM contacts WHERE id=? AND username=? AND deleted_at IS NULL',
            [req.params.id as string, user]
        );
        if (rows.length === 0) return res.status(404).json({ success: false, error: 'Contact not found' });

        const c = rows[0];
        const vcard = normalizeVCardData(
            c.vcard_data || '',
            c.dav_uid || `contact-${c.id}`,
            { name: c.name, email: c.email, phone: c.phone }
        );

        res.json({
            success: true,
            vcard,
            mailtoSubject: `Contact: ${c.name || c.email}`,
            mailtoBody: `${shareMsg}\n\n`,
        });
    } catch (e: any) {
        res.status(500).json({ success: false, error: e.message });
    }
});

appsApiRouter.get('/contacts-export', async (req: Request, res: Response) => {
    const user = (req as any).username;
    const format = req.query.format as string || 'vcard';
    try {
        const idsParam = req.query.ids as string;
        let rows: any;
        if (idsParam) {
            const ids = idsParam.split(',').map(Number).filter(n => !isNaN(n));
            if (ids.length === 0) {
                rows = [];
            } else {
                const placeholders = ids.map(() => '?').join(',');
                [rows] = await pool.query(
                    `SELECT * FROM contacts WHERE username = ? AND id IN (${placeholders}) AND deleted_at IS NULL`,
                    [user, ...ids]
                );
            }
        } else {
            [rows] = await pool.query('SELECT * FROM contacts WHERE username = ? AND deleted_at IS NULL', [user]);
        }
        if (format === 'csv') {
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', 'attachment; filename="contacts.csv"');
            let csv = 'Name,Email,Phone,Job Title,Organization,Notes\n';
            for (const row of rows) {
                const escapeCsv = (str: string) => `"${(str || '').replace(/"/g, '""')}"`;
                csv += `${escapeCsv(row.name)},${escapeCsv(row.email)},${escapeCsv(row.phone)},${escapeCsv(row.job_title)},${escapeCsv(row.organization)},${escapeCsv(row.notes)}\n`;
            }
            res.send(csv);
        } else {
            res.setHeader('Content-Type', 'text/vcard');
            res.setHeader('Content-Disposition', 'attachment; filename="contacts.vcf"');
            let vcards = '';
            for (const row of rows) {
                vcards += normalizeVCardData(row.vcard_data || '', getContactDavUid(row), { name: row.name, email: row.email, phone: row.phone });
            }
            res.send(vcards);
        }
    } catch (e: any) {
        res.status(500).json({ success: false, error: e.message });
    }
});

appsApiRouter.post('/contacts-import', async (req: Request, res: Response) => {
    const user = (req as any).username;
    const { data, format } = req.body;
    
    if (!data) return res.status(400).json({ success: false, error: 'No data provided' });

    try {
        let imported = 0;
        let skippedNoFields = 0;
        let skippedDuplicate = 0;
        if (format === 'csv') {
            const lines = data.split('\n');
            const headers = lines[0].toLowerCase().split(',').map((h: string) => h.trim().replace(/"/g, ''));
            const nameIdx = headers.findIndex((h: string) => h.includes('name'));
            const emailIdx = headers.findIndex((h: string) => h.includes('email'));
            const phoneIdx = headers.findIndex((h: string) => h.includes('phone'));
            
            for (let i = 1; i < lines.length; i++) {
                if (!lines[i].trim()) continue;
                // Simple CSV split handling quotes correctly is hard without a library, but let's do a basic split for now
                // This is a naive regex that splits by comma ignoring commas inside quotes
                const match = lines[i].match(/(".*?"|[^",\s]+)(?=\s*,|\s*$)/g);
                if (!match) continue;
                const cols = match.map((c: string) => c.replace(/^"|"$/g, '').trim());

                const name = nameIdx >= 0 ? cols[nameIdx] || '' : '';
                const email = emailIdx >= 0 ? cols[emailIdx] || '' : '';
                const phone = phoneIdx >= 0 ? cols[phoneIdx] || '' : '';
                const jobTitleIdx = headers.findIndex((h: string) => h.includes('job'));
                const orgIdx = headers.findIndex((h: string) => h.includes('organization'));
                const notesIdx = headers.findIndex((h: string) => h.includes('notes'));
                const jobTitle = jobTitleIdx >= 0 ? cols[jobTitleIdx] || '' : '';
                const organization = orgIdx >= 0 ? cols[orgIdx] || '' : '';
                const notes = notesIdx >= 0 ? cols[notesIdx] || '' : '';

                if (!name && !email) { skippedNoFields++; continue; }
                try {
                    const davUid = createContactUid();
                    const vcard = patchVCardData('', davUid, {
                        name,
                        email,
                        phone,
                        job_title: jobTitle,
                        organization,
                        notes,
                    });
                    const result: any = await withContactMutation(user, async connection => {
                        const syncToken = await nextContactSyncTokenOnConnection(connection, user);
                        const [insertResult]: any = await connection.query(
                            `INSERT INTO contacts (username, name, email, phone, job_title, organization, notes, vcard_data, dav_uid, sync_token)
                             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                             ON DUPLICATE KEY UPDATE
                               name = VALUES(name),
                               phone = VALUES(phone),
                               job_title = VALUES(job_title),
                               organization = VALUES(organization),
                               notes = VALUES(notes),
                               deleted_at = NULL,
                               sync_token = VALUES(sync_token)`,
                            [user, name, email, phone, jobTitle, organization, notes, vcard, davUid, syncToken],
                        );
                        return insertResult;
                    });
                    if (result.affectedRows > 0) imported++; else skippedDuplicate++;
                } catch (error) {
                    if (!isDuplicateKeyError(error)) throw error;
                    skippedDuplicate++;
                }
            }
        } else {
            // vCard import
            const vcards = data.split(/(?=BEGIN:VCARD)/i);
            for (const vcard of vcards) {
                if (!vcard.trim().toUpperCase().startsWith('BEGIN:VCARD')) continue;
                const vcardUid = extractVCardUid(vcard);
                extractVCardBirthday(vcard);
                const parsed = parseVCard(vcard);
                if (!parsed.name && !parsed.email) { skippedNoFields++; continue; }
                try {
                    await withContactMutation(user, async connection => {
                        const existingDavUid = vcardUid
                            ? await findContactDavUidByVCardUidOnConnection(connection, user, vcardUid)
                            : null;
                        const davUid = existingDavUid || createContactUid();
                        const saved = await saveContactFromVCardOnConnection(connection, user, davUid, vcard);
                        if (!saved) throw new Error('The imported contact changed during its locked mutation');
                        return saved;
                    });
                    imported++;
                } catch (error) {
                    if (!isDuplicateKeyError(error)) throw error;
                    skippedDuplicate++;
                }
            }
        }
        if (imported > 0) emitContactsUpdated(user, { imported });
        res.json({ success: true, imported, skippedDuplicate, skippedNoFields, total: imported + skippedDuplicate + skippedNoFields });
    } catch (e: any) {
        if (e instanceof InvalidContactBirthdayError) {
            return res.status(400).json({ success: false, error: e.message });
        }
        if (e instanceof AmbiguousVCardUidError) {
            return res.status(409).json({ success: false, error: e.message });
        }
        res.status(500).json({ success: false, error: e.message });
    }
});

appsApiRouter.get('/contacts-duplicates', async (req: Request, res: Response) => {
    const user = (req as any).username;
    try {
        const [rows]: any = await pool.query('SELECT * FROM contacts WHERE username = ? AND deleted_at IS NULL', [user]);
        rows.sort((left: any, right: any) => contactIdentityRank(right) - contactIdentityRank(left));
        const duplicates: any[][] = [];
        const seen = new Set<number>();

        for (let i = 0; i < rows.length; i++) {
            if (seen.has(rows[i].id)) continue;
            
            const matches = [rows[i]];
            for (let j = i + 1; j < rows.length; j++) {
                if (seen.has(rows[j].id)) continue;
                
                let isMatch = false;
                const c1 = rows[i];
                const c2 = rows[j];
                
                if (c1.email && c1.email.toLowerCase() === c2.email?.toLowerCase()) isMatch = true;
                else if (c1.phone && c1.phone === c2.phone) isMatch = true;
                else if (c1.name && c1.name.toLowerCase() === c2.name?.toLowerCase()) isMatch = true;
                
                if (isMatch) {
                    matches.push(c2);
                    seen.add(c2.id);
                }
            }
            if (matches.length > 1) {
                duplicates.push(matches);
            }
            seen.add(rows[i].id);
        }
        
        res.json({ success: true, duplicates });
    } catch (e: any) {
        res.status(500).json({ success: false, error: e.message });
    }
});

appsApiRouter.get('/contacts-merge-preview', async (req: Request, res: Response) => {
    const user = (req as any).username;
    const ids = (req.query.ids as string || '').split(',').map(Number).filter(Boolean);
    if (ids.length < 2) return res.status(400).json({ success: false, error: 'Need at least 2 contact IDs' });
    try {
        const [rows]: any = await pool.query('SELECT * FROM contacts WHERE id IN (?) AND username=? AND deleted_at IS NULL', [ids, user]);
        if (rows.length < 2) return res.status(404).json({ success: false, error: 'Contacts not found' });
        // Build field-by-field preview showing source of each value
        const fieldSources: Record<string, { value: any; fromId: number; fromName: string }> = {};
        const mergeFields = ['name', 'email', 'phone', 'job_title', 'organization', 'notes', 'photo_url'];
        for (const field of mergeFields) {
            for (const r of rows) {
                if (r[field]) {
                    fieldSources[field] = { value: r[field], fromId: r.id, fromName: r.name || r.email };
                    break;
                }
            }
        }
        const merged = { name: '', email: '', phone: '', job_title: '', organization: '', notes: '', photo_url: '' };
        for (const field of mergeFields) merged[field as keyof typeof merged] = fieldSources[field]?.value || '';
        res.json({ success: true, contacts: rows, fieldSources, merged });
    } catch (e: any) {
        res.status(500).json({ success: false, error: e.message });
    }
});

appsApiRouter.post('/contacts-merge', async (req: Request, res: Response) => {
    const user = (req as any).username;
    const { primaryId, duplicateIds } = req.body;
    const normalizedPrimaryId = Number(primaryId);
    const normalizedDuplicateIds = Array.isArray(duplicateIds)
        ? Array.from(new Set(duplicateIds
            .map((id: unknown) => Number(id))
            .filter((id: number) => Number.isSafeInteger(id) && id > 0 && id !== normalizedPrimaryId)))
        : [];

    if (!Number.isSafeInteger(normalizedPrimaryId) || normalizedPrimaryId <= 0 || normalizedDuplicateIds.length === 0) {
        return res.status(400).json({ success: false, error: 'Invalid input' });
    }

    try {
        const outcome = await withContactMutation(user, async connection => {
            const [primaryRows]: any = await connection.query(
                'SELECT * FROM contacts WHERE id=? AND username=? AND deleted_at IS NULL',
                [normalizedPrimaryId, user],
            );
            if (primaryRows.length === 0) return 'not-found';
            const primary = primaryRows[0];

            const [dupRows]: any = await connection.query(
                'SELECT * FROM contacts WHERE id IN (?) AND username=? AND deleted_at IS NULL',
                [normalizedDuplicateIds, user],
            );
            if (dupRows.length === 0) return 'unchanged';

            let emails = primary.emails_json ? (typeof primary.emails_json === 'string' ? JSON.parse(primary.emails_json) : primary.emails_json) : [];
            let phones = primary.phones_json ? (typeof primary.phones_json === 'string' ? JSON.parse(primary.phones_json) : primary.phones_json) : [];
            let addresses = primary.addresses_json ? (typeof primary.addresses_json === 'string' ? JSON.parse(primary.addresses_json) : primary.addresses_json) : [];
            let labels = primary.labels_json ? (typeof primary.labels_json === 'string' ? JSON.parse(primary.labels_json) : primary.labels_json) : [];
            let { name, email, phone, job_title, organization, notes } = primary;
            let photo_url = primary.photo_url;

            for (const dup of dupRows) {
                name = name || dup.name;
                email = email || dup.email;
                phone = phone || dup.phone;
                job_title = job_title || dup.job_title;
                organization = organization || dup.organization;
                photo_url = photo_url || dup.photo_url;
                notes = [notes, dup.notes].filter(Boolean).join('\n\n');

                const dEmails = dup.emails_json ? (typeof dup.emails_json === 'string' ? JSON.parse(dup.emails_json) : dup.emails_json) : [];
                const dPhones = dup.phones_json ? (typeof dup.phones_json === 'string' ? JSON.parse(dup.phones_json) : dup.phones_json) : [];
                const dAddresses = dup.addresses_json ? (typeof dup.addresses_json === 'string' ? JSON.parse(dup.addresses_json) : dup.addresses_json) : [];
                const dLabels = dup.labels_json ? (typeof dup.labels_json === 'string' ? JSON.parse(dup.labels_json) : dup.labels_json) : [];
                emails = [...emails, ...dEmails];
                phones = [...phones, ...dPhones];
                addresses = [...addresses, ...dAddresses];
                labels = [...labels, ...dLabels];
            }

            const uniqueByValue = (arr: any[]) => Array.from(new Map(arr.map(item => [item.value, item])).values());
            emails = uniqueByValue(emails);
            phones = uniqueByValue(phones);
            addresses = uniqueByValue(addresses);
            labels = Array.from(new Set(labels));
            const newVcardData = patchVCardData(primary.vcard_data || '', primary.dav_uid || `contact-${primary.id}`, {
                name, email, phone, emails_json: emails, phones_json: phones, job_title, organization, notes,
            });
            const syncToken = await nextContactSyncTokenOnConnection(connection, user);
            await connection.query(
                `UPDATE contacts SET name=?, email=?, phone=?, job_title=?, organization=?, notes=?, emails_json=?, phones_json=?, addresses_json=?, labels_json=?, vcard_data=?, photo_url=?, sync_token=? WHERE id=? AND username=?`,
                [name, email, phone, job_title, organization, notes, JSON.stringify(emails), JSON.stringify(phones), JSON.stringify(addresses), JSON.stringify(labels), newVcardData, photo_url || null, syncToken, normalizedPrimaryId, user],
            );
            for (const dup of dupRows) {
                await recordContactTombstoneOnConnection(connection, user, dup.dav_uid || `contact-${dup.id}`);
            }
            await connection.query(
                'DELETE FROM contacts WHERE id IN (?) AND username=?',
                [dupRows.map((duplicate: any) => duplicate.id), user],
            );
            const previousPrimaryIdentity: BirthdayContactIdentity = {
                contactId: primary.id,
                davUid: primary.dav_uid || `contact-${primary.id}`,
                name: primary.name,
                email: primary.email,
            };
            const currentPrimaryIdentity: BirthdayContactIdentity = {
                ...previousPrimaryIdentity,
                name,
                email,
            };
            await syncContactBirthdayEvent(
                connection,
                user,
                currentPrimaryIdentity,
                primary.birthday || null,
                [previousPrimaryIdentity, currentPrimaryIdentity],
            );
            for (const duplicate of dupRows) {
                const duplicateIdentity: BirthdayContactIdentity = {
                    contactId: duplicate.id,
                    davUid: duplicate.dav_uid || `contact-${duplicate.id}`,
                    name: duplicate.name,
                    email: duplicate.email,
                };
                await syncContactBirthdayEvent(
                    connection,
                    user,
                    duplicateIdentity,
                    null,
                    [duplicateIdentity],
                );
            }
            return 'merged';
        });
        if (outcome === 'not-found') return res.status(404).json({ success: false, error: 'Primary contact not found' });
        if (outcome === 'unchanged') return res.json({ success: true });
        emitContactsUpdated(user, { contactId: normalizedPrimaryId, merged: true });
        res.json({ success: true });
    } catch (e: any) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// ==========================================
// CONTACT LABELS API
// ==========================================
appsApiRouter.get('/contact-labels', async (req: Request, res: Response) => {
    const user = (req as any).username;
    try {
        const [rows] = await pool.query('SELECT * FROM contact_labels WHERE username = ? ORDER BY name ASC', [user]);
        res.json({ success: true, labels: rows });
    } catch (e: any) {
        res.status(500).json({ success: false, error: e.message });
    }
});

appsApiRouter.post('/contact-labels', async (req: Request, res: Response) => {
    const user = (req as any).username;
    const { name, color } = req.body;
    try {
        const [result]: any = await pool.query(
            'INSERT INTO contact_labels (username, name, color) VALUES (?, ?, ?)',
            [user, name || 'New Label', color || '#60a5fa']
        );
        res.json({ success: true, id: result.insertId });
    } catch (e: any) {
        res.status(500).json({ success: false, error: e.message });
    }
});

appsApiRouter.put('/contact-labels/:id', async (req: Request, res: Response) => {
    const user = (req as any).username;
    const { name, color } = req.body;
    try {
        await pool.query(
            'UPDATE contact_labels SET name=?, color=? WHERE id=? AND username=?',
            [name, color, req.params.id as string, user]
        );
        res.json({ success: true });
    } catch (e: any) {
        res.status(500).json({ success: false, error: e.message });
    }
});

appsApiRouter.delete('/contact-labels/:id', async (req: Request, res: Response) => {
    const user = (req as any).username;
    try {
        await pool.query('DELETE FROM contact_labels WHERE id=? AND username=?', [req.params.id as string, user]);
        res.json({ success: true });
    } catch (e: any) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// ==========================================
// CONTACT GROUPS API
// ==========================================
appsApiRouter.get('/contact-groups', async (req: Request, res: Response) => {
    const user = (req as any).username;
    try {
        const [groups]: any = await pool.query(
            `SELECT g.*, COUNT(c.id) as member_count
             FROM contact_groups g
             LEFT JOIN contact_group_members m ON g.id = m.group_id
             LEFT JOIN contacts c ON c.id = m.contact_id AND c.deleted_at IS NULL
             WHERE g.username = ? GROUP BY g.id ORDER BY g.name`,
            [user]
        );
        res.json({ success: true, groups });
    } catch (e: any) {
        res.status(500).json({ success: false, error: e.message });
    }
});

appsApiRouter.post('/contact-groups', async (req: Request, res: Response) => {
    const user = (req as any).username;
    const { name, color } = req.body;
    if (!name || !name.trim()) return res.status(400).json({ success: false, error: 'Group name is required' });
    try {
        const [result]: any = await pool.query(
            'INSERT INTO contact_groups (username, name, color) VALUES (?, ?, ?)',
            [user, name.trim(), color || '#60a5fa']
        );
        res.json({ success: true, id: result.insertId });
    } catch (e: any) {
        res.status(500).json({ success: false, error: e.message });
    }
});

appsApiRouter.put('/contact-groups/:id', async (req: Request, res: Response) => {
    const user = (req as any).username;
    const { name, color } = req.body;
    try {
        const [result]: any = await pool.query(
            'UPDATE contact_groups SET name = COALESCE(?, name), color = COALESCE(?, color) WHERE id = ? AND username = ?',
            [name?.trim() || null, color || null, req.params.id, user]
        );
        if (result.affectedRows === 0) return res.status(404).json({ success: false, error: 'Group not found' });
        res.json({ success: true });
    } catch (e: any) {
        res.status(500).json({ success: false, error: e.message });
    }
});

appsApiRouter.delete('/contact-groups/:id', async (req: Request, res: Response) => {
    const user = (req as any).username;
    try {
        await pool.query('DELETE FROM contact_group_members WHERE group_id = ?', [req.params.id]);
        const [result]: any = await pool.query('DELETE FROM contact_groups WHERE id = ? AND username = ?', [req.params.id, user]);
        if (result.affectedRows === 0) return res.status(404).json({ success: false, error: 'Group not found' });
        res.json({ success: true });
    } catch (e: any) {
        res.status(500).json({ success: false, error: e.message });
    }
});

appsApiRouter.get('/contact-groups/:id/members', async (req: Request, res: Response) => {
    const user = (req as any).username;
    try {
        const [rows]: any = await pool.query(
            `SELECT m.contact_id, c.name, c.email FROM contact_group_members m
             JOIN contacts c ON c.id = m.contact_id AND c.deleted_at IS NULL
             JOIN contact_groups g ON g.id = m.group_id
             WHERE m.group_id = ? AND g.username = ?`,
            [req.params.id, user]
        );
        res.json({ success: true, members: rows });
    } catch (e: any) {
        res.status(500).json({ success: false, error: e.message });
    }
});

appsApiRouter.post('/contact-groups/:id/members', async (req: Request, res: Response) => {
    const user = (req as any).username;
    const { contactIds } = req.body;
    if (!Array.isArray(contactIds)) return res.status(400).json({ success: false, error: 'contactIds array required' });
    try {
        const [group]: any = await pool.query('SELECT id FROM contact_groups WHERE id = ? AND username = ?', [req.params.id, user]);
        if (group.length === 0) return res.status(404).json({ success: false, error: 'Group not found' });

        let added = 0;
        for (const contactId of contactIds) {
            try {
                await pool.query('INSERT IGNORE INTO contact_group_members (group_id, contact_id) VALUES (?, ?)', [req.params.id, contactId]);
                added++;
            } catch {}
        }
        res.json({ success: true, added });
    } catch (e: any) {
        res.status(500).json({ success: false, error: e.message });
    }
});

appsApiRouter.delete('/contact-groups/:id/members/:contactId', async (req: Request, res: Response) => {
    const user = (req as any).username;
    try {
        await pool.query(
            `DELETE m FROM contact_group_members m
             JOIN contact_groups g ON g.id = m.group_id
             WHERE m.group_id = ? AND m.contact_id = ? AND g.username = ?`,
            [req.params.id, req.params.contactId, user]
        );
        res.json({ success: true });
    } catch (e: any) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// ==========================================
// TASKS API
// ==========================================
appsApiRouter.get('/tasks', async (req: Request, res: Response) => {
    const user = (req as any).username;
    try {
        const [rows] = await pool.query('SELECT * FROM tasks WHERE username = ? ORDER BY created_at DESC', [user]);
        res.json({ success: true, tasks: rows });
    } catch (e: any) {
        res.status(500).json({ success: false, error: e.message });
    }
});

appsApiRouter.post('/tasks', async (req: Request, res: Response) => {
    const user = (req as any).username;
    const { title, description, due_date, completed } = req.body;
    try {
        const [result]: any = await pool.query(
            'INSERT INTO tasks (username, title, description, due_date, completed) VALUES (?, ?, ?, ?, ?)',
            [user, title, description || '', due_date || null, completed ? 1 : 0]
        );
        res.json({ success: true, id: result.insertId });
    } catch (e: any) {
        res.status(500).json({ success: false, error: e.message });
    }
});

appsApiRouter.put('/tasks/:id', async (req: Request, res: Response) => {
    const user = (req as any).username;
    const { title, description, due_date, completed } = req.body;
    try {
        await pool.query(
            'UPDATE tasks SET title=?, description=?, due_date=?, completed=? WHERE id=? AND username=?',
            [title, description, due_date, completed ? 1 : 0, req.params.id as string, user]
        );
        res.json({ success: true });
    } catch (e: any) {
        res.status(500).json({ success: false, error: e.message });
    }
});

appsApiRouter.delete('/tasks/:id', async (req: Request, res: Response) => {
    const user = (req as any).username;
    try {
        await pool.query('DELETE FROM tasks WHERE id=? AND username=?', [req.params.id as string, user]);
        res.json({ success: true });
    } catch (e: any) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// ==========================================
// NOTES API
// ==========================================
// NOTES API
// ==========================================
import {
    deleteNote,
    listNotesWithReminders,
    noteValidationErrorBody,
    NoteConflictError,
    NoteValidationError,
    saveNote,
} from './notes-utils';
import { syncNotesWithImap } from './notes-imap-sync';

appsApiRouter.get('/notes', async (req: Request, res: Response) => {
    const user = (req as any).username;
    const pass = (req as any).user?.password;
    try {
        // Await IMAP sync so the response includes fresh notes.
        await syncNotesWithImap(user, pass);
        
        const rows = await listNotesWithReminders(user);
        res.json({ success: true, notes: rows });
    } catch (e: any) {
        console.error("GET notes error", e);
        res.status(500).json({ success: false, error: e.message });
    }
});

appsApiRouter.post('/notes', async (req: Request, res: Response) => {
    const user = (req as any).username;
    const pass = (req as any).user?.password;
    const { title, content, color, is_pinned, is_locked, folder, labels_json } = req.body;
    try {
        const saved = await saveNote({
            title, content, owner: user,
            color, is_pinned, is_locked, folder, labels_json
        });
        syncNotesWithImap(user, pass).catch(e => console.error(e));
        res.json({ success: true, note: saved });
    } catch (e: any) {
        if (e instanceof NoteValidationError) {
            return res.status(e.statusCode).json(noteValidationErrorBody(e));
        }
        console.error("POST notes error", e);
        res.status(500).json({ success: false, error: e.message });
    }
});

appsApiRouter.put('/notes/:id', async (req: Request, res: Response) => {
    const user = (req as any).username;
    const pass = (req as any).user?.password;
    const { title, content, color, is_pinned, is_locked, folder, labels_json, expected_sync_token } = req.body;
    if (expected_sync_token === undefined) {
        return res.status(428).json({ success: false, error: 'The current note revision is required.' });
    }
    try {
        const saved = await saveNote({
            id: req.params.id as string,
            owner: user,
            title,
            content,
            color,
            is_pinned: is_pinned ? 1 : 0,
            is_locked: is_locked ? 1 : 0,
            folder,
            labels_json,
            expected_sync_token,
        });
        syncNotesWithImap(user, pass).catch(e => console.error(e));
        res.json({ success: true, note: saved });
    } catch (e: any) {
        if (e instanceof NoteConflictError) {
            return res.status(409).json({ success: false, error: e.message });
        }
        if (e instanceof NoteValidationError) {
            return res.status(e.statusCode).json(noteValidationErrorBody(e));
        }
        console.error("PUT notes error", e);
        res.status(500).json({ success: false, error: e.message });
    }
});

appsApiRouter.delete('/notes/:id', async (req: Request, res: Response) => {
    const user = (req as any).username;
    const pass = (req as any).user?.password;
    try {
        await deleteNote(req.params.id as string, user);
        syncNotesWithImap(user, pass).catch(e => console.error(e));
        res.json({ success: true });
    } catch (e: any) {
        console.error("DELETE notes error", e);
        res.status(500).json({ success: false, error: e.message });
    }
});
// ==========================================

// ---- Notes: Image upload ----
import multer from 'multer';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';

const notesUploadDir = path.join(__dirname, '..', 'uploads', 'notes');
if (!fs.existsSync(notesUploadDir)) {
    fs.mkdirSync(notesUploadDir, { recursive: true });
}

const notesImageUpload = multer({
    storage: multer.diskStorage({
        destination: (_req, _file, cb) => {
            const user = (_req as any).username || 'unknown';
            const userDir = path.join(notesUploadDir, user);
            if (!fs.existsSync(userDir)) fs.mkdirSync(userDir, { recursive: true });
            cb(null, userDir);
        },
        filename: (_req, file, cb) => {
            const uniqueName = `${crypto.randomUUID()}${path.extname(file.originalname) || '.png'}`;
            cb(null, uniqueName);
        }
    }),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
        const allowed = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
        if (allowed.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Only PNG, JPEG, GIF, and WebP images are allowed'));
        }
    }
});

appsApiRouter.post('/notes/upload', notesImageUpload.single('file'), async (req: Request, res: Response) => {
    if (!req.file) {
        res.status(400).json({ success: false, error: 'No file uploaded' });
        return;
    }
    const user = (req as any).username || 'unknown';
    const url = `/uploads/notes/${user}/${(req.file as any).filename}`;
    res.json({ success: true, url });
});

// ---- Notes: Reminders ----
import { getNoteReminder, saveNoteReminder, deleteNoteReminder } from './notes-utils';

appsApiRouter.get('/notes/:id/reminder', async (req: Request, res: Response) => {
    const user = (req as any).username;
    try {
        const reminder = await getNoteReminder(req.params.id as string, user);
        if (!reminder) {
            res.json({ success: true, reminder: null });
            return;
        }
        res.json({ success: true, reminder: { remind_at: reminder.remind_at } });
    } catch (e: any) {
        res.status(500).json({ success: false, error: e.message });
    }
});

appsApiRouter.post('/notes/:id/reminder', async (req: Request, res: Response) => {
    const user = (req as any).username;
    try {
        if (!req.body.remind_at) {
            res.status(400).json({ success: false, error: 'remind_at is required' });
            return;
        }
        await saveNoteReminder(req.params.id as string, req.body.remind_at, user);
        res.json({ success: true });
    } catch (e: any) {
        res.status(500).json({ success: false, error: e.message });
    }
});

appsApiRouter.delete('/notes/:id/reminder', async (req: Request, res: Response) => {
    const user = (req as any).username;
    try {
        await deleteNoteReminder(req.params.id as string, user);
        res.json({ success: true });
    } catch (e: any) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// ---- Notes: Attachments ----
import { listNoteAttachments, saveNoteAttachment, deleteNoteAttachment } from './notes-utils';

const attachmentsUpload = multer({
    storage: multer.diskStorage({
        destination: (_req, _file, cb) => {
            const user = (_req as any).username || 'unknown';
            const userDir = path.join(notesUploadDir, user);
            if (!fs.existsSync(userDir)) fs.mkdirSync(userDir, { recursive: true });
            cb(null, userDir);
        },
        filename: (_req, file, cb) => {
            const uniqueName = `${crypto.randomUUID()}${path.extname(file.originalname)}`;
            cb(null, uniqueName);
        }
    }),
    limits: { fileSize: 25 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
        const blocked = ['application/x-msdownload', 'application/x-msdos-program', 'application/x-executable', 'application/x-sh', 'application/x-shockwave-flash'];
        if (blocked.includes(file.mimetype)) {
            cb(new Error('Executable files are not allowed'));
        } else {
            cb(null, true);
        }
    }
});

appsApiRouter.get('/notes/:id/attachments', async (req: Request, res: Response) => {
    const user = (req as any).username;
    try {
        const attachments = await listNoteAttachments(req.params.id as string, user);
        const attachmentsWithUrl = attachments.map((att: any) => ({
            ...att,
            url: `/uploads/${att.storage_path}`,
        }));
        res.json({ success: true, attachments: attachmentsWithUrl });
    } catch (e: any) {
        res.status(500).json({ success: false, error: e.message });
    }
});

appsApiRouter.post('/notes/:id/attachments', attachmentsUpload.single('file'), async (req: Request, res: Response) => {
    const user = (req as any).username;
    try {
        if (!req.file) {
            res.status(400).json({ success: false, error: 'No file uploaded' });
            return;
        }
        const id = crypto.randomUUID();
        const storagePath = path.join('notes', user, (req.file as any).filename);
        const attachment = {
            id,
            note_id: req.params.id as string,
            filename: req.file.originalname,
            mime_type: req.file.mimetype,
            size_bytes: req.file.size,
            storage_path: storagePath,
        };
        await saveNoteAttachment(attachment as any, user);
        res.json({ success: true, attachment });
    } catch (e: any) {
        // Clean up uploaded file on DB error to avoid orphaned files
        try {
            if (req.file) {
                const filePath = path.join(notesUploadDir, user, (req.file as any).filename);
                if (fs.existsSync(filePath)) {
                    fs.unlinkSync(filePath);
                }
            }
        } catch {} // Best-effort cleanup
        res.status(500).json({ success: false, error: e.message });
    }
});

appsApiRouter.delete('/notes/:id/attachments/:attachmentId', async (req: Request, res: Response) => {
    const user = (req as any).username;
    try {
        const deleted = await deleteNoteAttachment(req.params.attachmentId as string, user);
        if (!deleted) {
            res.status(404).json({ success: false, error: 'Attachment not found' });
            return;
        }
        // Delete file from disk
        const filePath = path.join(__dirname, '..', 'uploads', deleted.storage_path);
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
        res.json({ success: true });
    } catch (e: any) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// ==========================================
// CALENDARS & EVENTS API
// ==========================================
appsApiRouter.get('/calendars', async (req: Request, res: Response) => {
    const user = (req as any).username;
    try {
        const calendars = await getVisibleCalendars(user);
        const result = [];
        for (const cal of calendars) {
            const [events]: any = await pool.query('SELECT * FROM events WHERE calendar_id = ?', [cal.id]);
            const expansionStart = new Date();
            expansionStart.setUTCFullYear(expansionStart.getUTCFullYear() - 1, 0, 1);
            expansionStart.setUTCHours(0, 0, 0, 0);
            const expansionEnd = new Date();
            expansionEnd.setUTCFullYear(expansionEnd.getUTCFullYear() + 2, 11, 31);
            expansionEnd.setUTCHours(23, 59, 59, 999);

            const parsedEvents = events.flatMap((ev: any) => {
                const parsed = parseIcalEvent(ev.uid, ev.ical_data || '');
                const occurrences = parsed.recurrence
                    ? expandRecurringEvent(parsed, expansionStart, expansionEnd)
                    : [parsed];

                return occurrences.map((occurrence) => ({
                    id: ev.uid,
                    occurrenceId: occurrence.occurrenceId,
                    calendarId: cal.id,
                    title: occurrence.title,
                    start: occurrence.start,
                    end: occurrence.end,
                    isAllDay: occurrence.isAllDay,
                    timeKind: occurrence.timeKind,
                    timeZone: occurrence.timeZone,
                    location: occurrence.location,
                    description: occurrence.description,
                    recurrence: occurrence.recurrence?.raw || '',
                    recurrenceLabel: occurrence.recurrenceLabel,
                    notifications: occurrence.notifications,
                    sourceTimeZone: occurrence.sourceTimeZone,
                    timeZoneStatus: occurrence.timeZoneStatus,
                    seriesStart: parsed.start,
                    seriesEnd: parsed.end,
                    seriesTitle: parsed.title,
                    seriesLocation: parsed.location,
                    seriesDescription: parsed.description,
                    seriesNotifications: parsed.notifications,
                    seriesIsAllDay: parsed.isAllDay,
                    seriesTimeKind: parsed.timeKind,
                    seriesTimeZone: parsed.timeZone,
                    seriesSourceTimeZone: parsed.sourceTimeZone,
                    seriesTimeZoneStatus: parsed.timeZoneStatus,
                    rawIcal: ev.ical_data || ''
                }));
            });
            result.push({
                ...cal,
                events: parsedEvents
            });
        }
        res.json({ success: true, calendars: result });
    } catch (e: any) {
        res.status(500).json({ success: false, error: e.message });
    }
});

appsApiRouter.post('/calendars', async (req: Request, res: Response) => {
    const user = (req as any).username;
    const { name, color, subscribed_url } = req.body;
    const requestedName = typeof name === 'string' && name.trim() ? name.trim() : 'New Calendar';
    if (isReservedManagedCalendarSlug(requestedName)) {
        return res.status(409).json({ success: false, error: 'The Birthdays calendar is managed from Contacts' });
    }
    let subscribedUrl: string | null;
    try {
        subscribedUrl = normalizedCalendarSubscriptionUrl(subscribed_url);
    } catch {
        return res.status(400).json({ success: false, error: 'Calendar subscription URL must be a credential-free HTTPS URL' });
    }
    try {
        const calendar = await createCalendar(user, requestedName, { color, subscribed_url: subscribedUrl || undefined });
        res.json({ success: true, id: calendar.id });
    } catch (e: any) {
        res.status(500).json({ success: false, error: e.message });
    }
});

appsApiRouter.put('/calendars/:id', async (req: Request, res: Response) => {
    const user = (req as any).username;
    const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
    const color = typeof req.body.color === 'string' ? req.body.color.trim() : '';
    const subscriptionWasProvided = Object.prototype.hasOwnProperty.call(req.body, 'subscribed_url');
    let requestedSubscribedUrl: string | null | undefined;
    if (subscriptionWasProvided) {
        try {
            requestedSubscribedUrl = normalizedCalendarSubscriptionUrl(req.body.subscribed_url);
        } catch {
            return res.status(400).json({ success: false, error: 'Calendar subscription URL must be a credential-free HTTPS URL' });
        }
    }

    if (!name) {
        return res.status(400).json({ success: false, error: 'Calendar name is required' });
    }

    if (!/^#[0-9a-fA-F]{6}$/.test(color)) {
        return res.status(400).json({ success: false, error: 'Calendar color must be a #RRGGBB value' });
    }

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        const [calendarRows]: any = await connection.query(
            `SELECT id, dav_slug, subscribed_url
             FROM calendars
             WHERE id = ? AND user_id = ?
             LIMIT 1 FOR UPDATE`,
            [req.params.id as string, user],
        );
        if (calendarRows.length === 0) {
            await connection.rollback();
            return res.status(404).json({ success: false, error: 'Calendar not found' });
        }
        if (isManagedBirthdayCalendar(calendarRows[0])) {
            await connection.rollback();
            return res.status(409).json({ success: false, error: 'The Birthdays calendar is managed from Contacts' });
        }

        const previousSubscribedUrl = String(calendarRows[0].subscribed_url || '').trim() || null;
        const subscribedUrl = subscriptionWasProvided ? requestedSubscribedUrl! : previousSubscribedUrl;
        const firstSubscription = previousSubscribedUrl === null && subscribedUrl !== null;
        if (firstSubscription) {
            const [eventRows]: any = await connection.query(
                'SELECT uid FROM events WHERE calendar_id = ? LIMIT 1 FOR UPDATE',
                [req.params.id as string],
            );
            if (eventRows.length > 0) {
                await connection.rollback();
                return res.status(409).json({
                    success: false,
                    error: 'Only an empty calendar can be converted to a subscription',
                });
            }
        }
        if (previousSubscribedUrl !== null
            && subscribedUrl !== null
            && previousSubscribedUrl !== subscribedUrl) {
            const [unmanagedRows]: any = await connection.query(
                `SELECT uid FROM events
                 WHERE calendar_id = ? AND subscription_managed = 0
                 LIMIT 1 FOR UPDATE`,
                [req.params.id as string],
            );
            if (unmanagedRows.length > 0) {
                await connection.rollback();
                return res.status(409).json({
                    success: false,
                    error: 'This subscribed calendar contains legacy local events and cannot change feeds safely',
                });
            }
        }

        let removedRevision: number | null = null;
        if (previousSubscribedUrl !== null && subscribedUrl === null) {
            const [managedRows]: any = await connection.query(
                `SELECT uid, resource_name FROM events
                 WHERE calendar_id = ? AND subscription_managed = 1
                 LIMIT ${MAX_WEB_CALENDAR_RESOURCES + 1} FOR UPDATE`,
                [req.params.id as string],
            );
            if (managedRows.length > MAX_WEB_CALENDAR_RESOURCES) {
                throw new Error('Subscribed calendar contains too many managed resources to unsubscribe safely');
            }
            if (managedRows.length > 0) {
                removedRevision = await allocateCalendarCollectionRevisionOnConnection(
                    connection,
                    req.params.id as string,
                );
                for (const row of managedRows) {
                    const uid = String(row.uid);
                    const resourceName = String(row.resource_name || row.uid);
                    await connection.query(
                        `DELETE FROM events
                         WHERE calendar_id = ? AND uid = ? AND subscription_managed = 1`,
                        [req.params.id as string, uid],
                    );
                    await connection.query(
                        `INSERT INTO calendar_tombstones
                         (calendar_id, uid, resource_name, sync_token, deleted_at)
                         VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
                         ON DUPLICATE KEY UPDATE
                            uid = VALUES(uid), resource_name = VALUES(resource_name),
                            sync_token = VALUES(sync_token), deleted_at = CURRENT_TIMESTAMP`,
                        [req.params.id as string, uid, resourceName, removedRevision],
                    );
                }
            }
        }

        const urlChanged = previousSubscribedUrl !== subscribedUrl;
        const [result]: any = await connection.query(
            `UPDATE calendars
             SET name = ?, color = ?, subscribed_url = ?,
                 last_fetched_at = IF(? = 1, NULL, last_fetched_at),
                 last_fetch_error = IF(? = 1, NULL, last_fetch_error),
                 sync_token = sync_token + ?
             WHERE id = ? AND user_id = ?`,
            [
                name,
                color,
                subscribedUrl,
                urlChanged ? 1 : 0,
                urlChanged ? 1 : 0,
                removedRevision === null ? 1 : 0,
                req.params.id as string,
                user,
            ],
        );

        if (Number(result.affectedRows || 0) !== 1) {
            throw new Error('Calendar settings update failed after locking the calendar');
        }

        await connection.commit();
        res.json({ success: true });
    } catch (e: any) {
        await connection.rollback();
        res.status(500).json({ success: false, error: e.message });
    } finally {
        connection.release();
    }
});

appsApiRouter.get('/calendars/:id/shares', async (req: Request, res: Response) => {
    const user = (req as any).username;
    try {
        const [rows]: any = await pool.query('SELECT shared_with_user_id, permission FROM calendar_shares WHERE calendar_id = ? AND calendar_id IN (SELECT id FROM calendars WHERE user_id = ?)', [req.params.id as string, user]);
        res.json({ success: true, shares: rows });
    } catch (e: any) {
        res.status(500).json({ success: false, error: e.message });
    }
});

appsApiRouter.get('/calendars/:id/export', async (req: Request, res: Response) => {
    const user = (req as any).username;
    try {
        const [calRows]: any = await pool.query('SELECT * FROM calendars WHERE id = ? AND user_id = ?', [req.params.id as string, user]);
        if (calRows.length === 0) return res.status(404).json({ success: false, error: 'Calendar not found' });
        
        const [events]: any = await pool.query(
            'SELECT ical_data, updated_at FROM events WHERE calendar_id = ? ORDER BY uid ASC',
            [req.params.id as string],
        );
        const supportingComponents = new Set<string>();
        const resourceComponents: string[] = [];
        for (const ev of events) {
            if (typeof ev.ical_data !== 'string' || !ev.ical_data) {
                throw new Error('Calendar contains an invalid empty event resource');
            }
            const validated = validateStoredCalendarForExport(ev.ical_data, ev.updated_at);
            if (validated.resources.some(resource => resource.componentType !== 'VEVENT')) {
                throw new Error('Calendar export contains an unsupported non-VEVENT resource');
            }
            for (const resource of validated.resources) {
                for (const block of validatedTopLevelCalendarBlocks(resource.icalData)) {
                    if (block.type === 'VTIMEZONE') supportingComponents.add(block.icalData);
                    else if (block.type === 'VEVENT') resourceComponents.push(block.icalData);
                }
            }
        }

        const icsData = [
            'BEGIN:VCALENDAR',
            'VERSION:2.0',
            'PRODID:-//OpenMailStack//WebCalendar//EN',
            ...supportingComponents,
            ...resourceComponents,
            'END:VCALENDAR',
        ];
        
        res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
        res.setHeader('Content-Disposition', `attachment; filename="calendar-${req.params.id}.ics"`);
        res.send(icsData.join('\r\n'));
    } catch (e: any) {
        res.status(500).json({ success: false, error: e.message });
    }
});

appsApiRouter.post('/calendars/:id/import', async (req: Request, res: Response) => {
    const user = (req as any).username;
    const { ics_data } = req.body;
    if (typeof ics_data !== 'string') {
        return res.status(400).json({ success: false, error: 'Missing iCalendar data' });
    }
    let events: ValidatedICalendarResource[];
    try {
        const validated = validateICalendarDocument(ics_data, {
            mode: 'import',
            allowMultipleResourceUids: true,
            maxResourceComponents: MAX_WEB_CALENDAR_RESOURCES,
        });
        if (validated.resources.some(resource => resource.componentType !== 'VEVENT')) {
            return res.status(400).json({
                success: false,
                error: 'Calendar import supports VEVENT resources only',
            });
        }
        events = validated.resources;
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Invalid iCalendar data';
        return res.status(400).json({ success: false, error: message });
    }
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        if (!(await userCanWriteCalendarOnConnection(connection, user, req.params.id as string, true))) {
            await connection.rollback();
            return res.status(403).json({ success: false, error: 'Unauthorized calendar' });
        }
        let imported = 0;
        let revision: number | null = null;
        
        for (const event of events) {
            const uid = event.uid;
            const icalLine = event.icalData;

            const [existingRows]: any = await connection.query(
                `SELECT uid, resource_name, ical_data, sync_token FROM events
                 WHERE calendar_id = ? AND uid = ? LIMIT 1 FOR UPDATE`,
                [req.params.id as string, uid],
            );
            const existing = existingRows[0];
            const resourceName = String(existing?.resource_name || uid);
            const [tombstoneResult]: any = await connection.query(
                `DELETE FROM calendar_tombstones
                 WHERE calendar_id = ?
                 AND BINARY COALESCE(NULLIF(resource_name, ''), uid) = BINARY ?`,
                [req.params.id as string, resourceName],
            );
            const changed = !existing
                || String(existing.ical_data || '') !== icalLine
                || Number(tombstoneResult.affectedRows || 0) > 0;
            if (changed) {
                revision ??= await allocateCalendarCollectionRevisionOnConnection(connection, req.params.id as string);
                if (existing) {
                    await connection.query(
                        'UPDATE events SET ical_data = ?, sync_token = ? WHERE calendar_id = ? AND uid = ?',
                        [icalLine, revision, req.params.id as string, uid],
                    );
                } else {
                    await connection.query(
                        `INSERT INTO events
                         (calendar_id, uid, resource_name, ical_data, sync_token)
                         VALUES (?, ?, ?, ?, ?)`,
                        [req.params.id as string, uid, uid, icalLine, revision],
                    );
                }
            }
            imported++;
        }

        if (revision === null) await connection.rollback();
        else {
            await connection.commit();
            emitCalendarUpdated(user, req.params.id as string);
        }
        res.json({ success: true, count: imported });
    } catch (e: any) {
        await connection.rollback();
        res.status(500).json({ success: false, error: e.message });
    } finally {
        connection.release();
    }
});

appsApiRouter.post('/calendars/:id/shares', async (req: Request, res: Response) => {
    const user = (req as any).username;
    const { email } = req.body;
    const permission = normalizeCalendarSharePermission(req.body?.permission === undefined ? 'read' : req.body.permission);
    if (!email) return res.status(400).json({ success: false, error: 'email required' });
    if (!permission) return res.status(400).json({ success: false, error: 'permission must be read or write' });
    try {
        const [calRows]: any = await pool.query('SELECT id FROM calendars WHERE id = ? AND user_id = ?', [req.params.id as string, user]);
        if (calRows.length === 0) return res.status(403).json({ success: false, error: 'Not authorized' });
        await pool.query('INSERT INTO calendar_shares (calendar_id, shared_with_user_id, permission) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE permission = VALUES(permission)', [req.params.id as string, email, permission]);
        res.json({ success: true });
    } catch (e: any) {
        res.status(500).json({ success: false, error: e.message });
    }
});

appsApiRouter.delete('/calendars/:id/shares/:email', async (req: Request, res: Response) => {
    const user = (req as any).username;
    const { email } = req.params;
    try {
        const [calRows]: any = await pool.query('SELECT id FROM calendars WHERE id = ? AND user_id = ?', [req.params.id as string, user]);
        if (calRows.length === 0 && email !== user) return res.status(403).json({ success: false, error: 'Not authorized' });
        await pool.query('DELETE FROM calendar_shares WHERE calendar_id = ? AND shared_with_user_id = ?', [req.params.id as string, email]);
        res.json({ success: true });
    } catch (e: any) {
        res.status(500).json({ success: false, error: e.message });
    }
});

appsApiRouter.delete('/calendars/:id', async (req: Request, res: Response) => {
    const user = (req as any).username;
    const calendarId = Number(req.params.id as string);

    if (!Number.isInteger(calendarId) || calendarId <= 0) {
        return res.status(400).json({ success: false, error: 'Invalid calendar id' });
    }

    try {
        const visibleCalendars = await getVisibleCalendars(user);
        const calendar = visibleCalendars.find((cal) => cal.id === calendarId);

        if (!calendar) {
            return res.status(404).json({ success: false, error: 'Calendar not found' });
        }

        if (isManagedBirthdayCalendar(calendar)) {
            return res.status(409).json({ success: false, error: 'The Birthdays calendar is managed from Contacts' });
        }

        if (visibleCalendars.length <= 1) {
            return res.status(409).json({ success: false, error: 'You must keep at least one calendar' });
        }

        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();
            const [eventRows]: any = await connection.query('SELECT COUNT(*) AS event_count FROM events WHERE calendar_id = ?', [calendarId]);
            const deletedEvents = Number(eventRows[0]?.event_count || 0);
            await connection.query('DELETE FROM events WHERE calendar_id = ?', [calendarId]);
            await connection.query('DELETE FROM calendar_tombstones WHERE calendar_id = ?', [calendarId]);
            await connection.query('DELETE FROM calendar_shares WHERE calendar_id = ?', [calendarId]);
            const [result]: any = await connection.query('DELETE FROM calendars WHERE id = ? AND user_id = ?', [calendarId, user]);

            if (result.affectedRows === 0) {
                await connection.rollback();
                return res.status(404).json({ success: false, error: 'Calendar not found' });
            }

            await connection.commit();
            res.json({ success: true, deletedEvents });
        } catch (e) {
            await connection.rollback();
            throw e;
        } finally {
            connection.release();
        }
    } catch (e: any) {
        res.status(500).json({ success: false, error: e.message });
    }
});

appsApiRouter.post('/events', async (req: Request, res: Response) => {
    const user = (req as any).username;
    const { data: submittedIcalData, calendar_id } = req.body;
    if (typeof submittedIcalData !== 'string' || !submittedIcalData) {
        return res.status(400).json({ success: false, error: 'Missing data (iCalendar string)' });
    }
    let validatedEvent: ValidatedICalendarResource;
    try {
        validatedEvent = validatedWebCalendarEvent(submittedIcalData);
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Invalid iCalendar data';
        return res.status(400).json({ success: false, error: message });
    }

    // The shared validator groups a recurring master and its RECURRENCE-ID
    // exceptions under the exact same opaque UID.
    const uid = validatedEvent.uid;
    const ical_data = validatedEvent.icalData;

    let connection: any = null;
    try {
        // resolve calendar: use provided calendar_id, or the user's first personal calendar
        let calId = calendar_id;
        if (!calId) {
            const [userCals]: any = await pool.query('SELECT id FROM calendars WHERE user_id = ? ORDER BY id ASC LIMIT 1', [user]);
            if (userCals.length === 0) return res.status(400).json({ success: false, error: 'No calendar found for user' });
            calId = userCals[0].id;
        }

        connection = await pool.getConnection();
        await connection.beginTransaction();
        if (!(await userCanWriteCalendarOnConnection(connection, user, calId))) {
            await connection.rollback();
            return res.status(403).json({success: false, error: 'Unauthorized calendar'});
        }

        const [existingRows]: any = await connection.query(
            `SELECT uid, resource_name, ical_data, sync_token FROM events
             WHERE calendar_id = ? AND uid = ? LIMIT 1 FOR UPDATE`,
            [calId, uid],
        );
        const existing = existingRows[0];
        const resourceName = String(existing?.resource_name || uid);
        const [tombstoneResult]: any = await connection.query(
            `DELETE FROM calendar_tombstones
             WHERE calendar_id = ?
             AND BINARY COALESCE(NULLIF(resource_name, ''), uid) = BINARY ?`,
            [calId, resourceName],
        );
        const changed = !existing
            || String(existing.ical_data || '') !== String(ical_data)
            || Number(tombstoneResult.affectedRows || 0) > 0;
        if (!changed) {
            await connection.rollback();
            return res.json({ success: true });
        }

        const revision = await allocateCalendarCollectionRevisionOnConnection(connection, calId);
        if (existing) {
            await connection.query(
                'UPDATE events SET ical_data = ?, sync_token = ? WHERE calendar_id = ? AND uid = ?',
                [ical_data, revision, calId, uid],
            );
        } else {
            await connection.query(
                `INSERT INTO events
                 (calendar_id, uid, resource_name, ical_data, sync_token)
                 VALUES (?, ?, ?, ?, ?)`,
                [calId, uid, uid, ical_data, revision],
            );
        }
        await connection.commit();
        emitCalendarUpdated(user, calId);

        res.json({ success: true });
    } catch (e: any) {
        if (connection) await connection.rollback();
        res.status(500).json({ success: false, error: e.message });
    } finally {
        connection?.release();
    }
});

appsApiRouter.delete('/events/:calendar_id/:uid', async (req: Request, res: Response) => {
    const user = (req as any).username;
    const calendar_id = String(req.params.calendar_id);
    const uid = String(req.params.uid);
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        if (!(await userCanWriteCalendarOnConnection(connection, user, calendar_id))) {
            await connection.rollback();
            return res.status(403).json({success: false, error: 'Unauthorized calendar'});
        }

        const excludeWasProvided = Object.prototype.hasOwnProperty.call(req.query, 'exclude');
        const excludeDate = typeof req.query.exclude === 'string' ? req.query.exclude : undefined;
        if (excludeWasProvided && !excludeDate?.trim()) {
            await connection.rollback();
            return res.status(400).json({ success: false, error: 'Invalid recurring occurrence date' });
        }
        const [events]: any = await connection.query(
            `SELECT uid, resource_name, ical_data, sync_token
             FROM events WHERE calendar_id=? AND uid=? LIMIT 1 FOR UPDATE`,
            [calendar_id, uid],
        );
        if (events.length === 0) {
            await connection.rollback();
            return res.status(404).json({ success: false, error: 'Event not found' });
        }
        if (excludeDate) {
            let icalData: string;
            try {
                icalData = addRecurringOccurrenceExclusion(String(events[0].ical_data || ''), excludeDate);
            } catch (error) {
                if (!(error instanceof ICalendarValidationError)) throw error;
                await connection.rollback();
                return res.status(400).json({ success: false, error: error.message });
            }
            const resourceName = String(events[0].resource_name || events[0].uid);
            const [tombstoneResult]: any = await connection.query(
                `DELETE FROM calendar_tombstones
                 WHERE calendar_id = ? AND BINARY resource_name = BINARY ?`,
                [calendar_id, resourceName],
            );
            if (icalData === String(events[0].ical_data || '') && !Number(tombstoneResult.affectedRows || 0)) {
                await connection.rollback();
                return res.json({ success: true });
            }
            const revision = await allocateCalendarCollectionRevisionOnConnection(connection, calendar_id);
            await connection.query(
                'UPDATE events SET ical_data = ?, sync_token = ? WHERE calendar_id = ? AND uid = ?',
                [icalData, revision, calendar_id, uid],
            );
        } else {
            const revision = await allocateCalendarCollectionRevisionOnConnection(connection, calendar_id);
            await connection.query('DELETE FROM events WHERE calendar_id=? AND uid=?', [calendar_id, uid]);
            await connection.query(
                `INSERT INTO calendar_tombstones
                 (calendar_id, uid, resource_name, sync_token, deleted_at)
                 VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
                 ON DUPLICATE KEY UPDATE
                    uid = VALUES(uid), resource_name = VALUES(resource_name),
                    sync_token = VALUES(sync_token), deleted_at = CURRENT_TIMESTAMP`,
                [calendar_id, uid, String(events[0].resource_name || events[0].uid), revision],
            );
        }
        await connection.commit();
        emitCalendarUpdated(user, calendar_id);

        res.json({ success: true });
    } catch (e: any) {
        await connection.rollback();
        res.status(500).json({ success: false, error: e.message });
    } finally {
        connection.release();
    }
});

// #2 Free/busy lookup
appsApiRouter.get('/calendars/freebusy', async (req: Request, res: Response) => {
    try {
        const users = (req.query.users as string || '').split(',').filter(Boolean);
        const start = new Date(req.query.start as string);
        const end = new Date(req.query.end as string);
        if (!users.length || isNaN(start.getTime()) || isNaN(end.getTime())) {
            return res.status(400).json({ error: 'Missing users, start, or end' });
        }
        const busy: Record<string, { start: string; end: string }[]> = {};
        for (const user of users) {
            const [rows]: any = await pool.query(
                `SELECT events.ical_data FROM events
                 JOIN calendars ON events.calendar_id = calendars.id
                 WHERE calendars.user_id = ? OR calendars.id IN
                   (SELECT calendar_id FROM calendar_shares WHERE shared_with_user_id = ?)`,
                [user, user]
            );
            const userBusy: { start: string; end: string }[] = [];
            for (const row of rows || []) {
                try {
                    const evt = parseIcalEvent('freebusy', row.ical_data);
                    if (!evt) continue;
                    if (row.ical_data.includes('TRANSP:TRANSPARENT')) continue;
                    const eStart = new Date(evt.start);
                    const eEnd = new Date(evt.end);
                    if (eEnd > start && eStart < end) {
                        userBusy.push({ start: eStart.toISOString(), end: eEnd.toISOString() });
                    }
                } catch (e) {}
            }
            busy[user] = userBusy;
        }
        res.json({ success: true, busy });
    } catch (e: any) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// #11 Birthdays calendar
appsApiRouter.get('/calendars/birthdays', async (req: Request, res: Response) => {
    try {
        const username = (req as any).username;
        const [contacts]: any = await pool.query(
            `SELECT c.first_name, c.last_name, c.name, c.email, c.birthday
             FROM contacts c
             JOIN contact_owners co ON c.id = co.contact_id
             WHERE co.username = ? AND c.birthday IS NOT NULL AND c.birthday != ''`,
            [username]
        );
        const events: any[] = [];
        for (const c of contacts || []) {
            const name = c.first_name ? `${c.first_name || ''} ${c.last_name || ''}`.trim() : (c.name || c.email);
            const parts = (c.birthday || '').split('-');
            const month = parseInt(parts[1]);
            const day = parseInt(parts[2]);
            if (!month || !day) continue;
            const eventDate = new Date(new Date().getFullYear(), month - 1, day);
            events.push({
                id: `bday-${c.email || c.name}`,
                title: `🎂 ${name}'s Birthday`,
                start: eventDate.toISOString(),
                end: eventDate.toISOString(),
                isAllDay: true,
                recurrence: 'yearly',
                calendarId: 'birthdays',
                calendarColor: '#ec4899',
            });
        }
        res.json({ success: true, events });
    } catch (e: any) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// Multer error handler — catches MulterError and returns JSON instead of HTML
appsApiRouter.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    if (err && err.code && err.message) {
        // MulterError has a code field (e.g. 'LIMIT_FILE_SIZE', 'LIMIT_UNEXPECTED_FILE')
        res.status(400).json({ success: false, error: err.message });
        return;
    }
    res.status(500).json({ success: false, error: 'Internal server error' });
});
