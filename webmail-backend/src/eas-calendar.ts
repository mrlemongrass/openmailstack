import { formatActiveSyncDate, type ParsedIcalEvent, parseIcalEvent } from './calendar-format';
import { encodeActiveSyncTimeZone, formatIcalWallTime, resolveActiveSyncTimeZone } from './eas-timezone';

export interface ActiveSyncCalendarNode {
    tag: string;
    page: number;
    content?: string;
    children?: ActiveSyncCalendarNode[];
}

export const MAX_ACTIVE_SYNC_CALENDAR_BODY_BYTES = 1024 * 1024;
export const MAX_ACTIVE_SYNC_CALENDAR_EXCEPTIONS = 256;
const MAX_ACTIVE_SYNC_CALENDAR_CATEGORY_BYTES = 4096;
const MAX_ACTIVE_SYNC_CALENDAR_EXCEPTION_TEXT_BYTES = 4096;

export class ActiveSyncCalendarFieldError extends Error {
    constructor() {
        super('ActiveSync calendar field is unsupported or too large');
        this.name = 'ActiveSyncCalendarFieldError';
    }
}

export const canWriteActiveSyncCalendar = (accessRole: unknown): boolean =>
    accessRole === 'owner' || accessRole === 'write';

export const normalizeCalendarSharePermission = (value: unknown): 'read' | 'write' | null =>
    value === 'read' || value === 'write' ? value : null;

export function resolveActiveSyncCalendarAccessRole(
    row: { user_id?: unknown; dav_slug?: unknown; subscribed_url?: unknown; permission?: unknown } | null | undefined,
    user: string,
): 'owner' | 'read' | 'write' | null {
    if (!row) return null;
    const baseRole = String(row.user_id || '') === user
        ? 'owner'
        : normalizeCalendarSharePermission(row.permission);
    if (!baseRole) return null;
    const isManaged = String(row.dav_slug || '').trim().toLowerCase() === 'birthdays';
    const isSubscribed = Boolean(String(row.subscribed_url || '').trim());
    return isManaged || isSubscribed ? 'read' : baseRole;
}

function truncateCalendarBody(value: string): { data: string; bytes: number; truncated: boolean } {
    const safeValue = value.replace(/\0/g, '\uFFFD');
    const source = Buffer.from(safeValue, 'utf8');
    if (source.length <= MAX_ACTIVE_SYNC_CALENDAR_BODY_BYTES) {
        return { data: safeValue, bytes: source.length, truncated: false };
    }
    let end = MAX_ACTIVE_SYNC_CALENDAR_BODY_BYTES;
    while (end > 0 && (source[end] & 0xC0) === 0x80) end -= 1;
    return { data: source.subarray(0, end).toString('utf8'), bytes: source.length, truncated: true };
}

const nodeText = (node: any): string => node?.content ? node.content.toString() : '';
const childNode = (node: any, tag: string): any => node?.children?.find((child: any) => child.tag === tag);
const childText = (node: any, tag: string): string => nodeText(childNode(node, tag));
const firstNonEmpty = (...values: string[]): string => values.map(value => value.trim()).find(Boolean) || '';

function boundedCalendarText(value: unknown, maxBytes = 8192): string {
    const source = Buffer.from(String(value || '').replace(/\0/g, '\uFFFD'), 'utf8');
    if (source.length <= maxBytes) return source.toString('utf8');
    let end = maxBytes;
    while (end > 0 && (source[end] & 0xC0) === 0x80) end -= 1;
    return source.subarray(0, end).toString('utf8');
}

function unfoldIcalLines(ical: string): string[] {
    const unfolded: string[] = [];
    for (const line of ical.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n')) {
        if (/^[ \t]/.test(line) && unfolded.length) unfolded[unfolded.length - 1] += line.slice(1);
        else if (line) unfolded.push(line);
    }
    return unfolded;
}

function icalPropertyName(line: string): string {
    return line.slice(0, Math.max(0, line.indexOf(':'))).split(';')[0].toUpperCase();
}

function existingEventBlocks(ical: string): string[][] {
    const blocks: string[][] = [];
    let current: string[] | null = null;
    let depth = 0;
    for (const line of unfoldIcalLines(ical)) {
        if (line.toUpperCase() === 'BEGIN:VEVENT') {
            if (depth === 0) current = [];
            depth += 1;
        }
        if (current) current.push(line);
        if (line.toUpperCase() === 'END:VEVENT' && depth > 0) {
            depth -= 1;
            if (depth === 0 && current) {
                blocks.push(current);
                current = null;
            }
        }
    }
    return blocks;
}

function directEventProperties(block: string[]): string[] {
    const result: string[] = [];
    let nested = 0;
    for (const line of block.slice(1, -1)) {
        if (/^BEGIN:/i.test(line)) { nested += 1; continue; }
        if (/^END:/i.test(line)) { nested = Math.max(0, nested - 1); continue; }
        if (nested === 0) result.push(line);
    }
    return result;
}

const CALENDAR_SCALAR_FIELDS = new Set([
    'TimeZone', 'AllDayEvent', 'BusyStatus', 'DtStamp', 'EndTime', 'Location', 'MeetingStatus',
    'OrganizerEmail', 'OrganizerName', 'Reminder', 'Sensitivity', 'Subject', 'StartTime', 'UID',
    'ResponseRequested', 'DisallowNewTimeProposal',
]);

function assertSupportedCalendarApplicationData(applicationData: any): void {
    const topSeen = new Set<string>();
    const scalar = (node: any, maxBytes = 8192, allowEmpty = true): boolean =>
        node && (!node.children || node.children.length === 0)
        && (node.content === undefined && allowEmpty
            || typeof node.content === 'string'
                && Buffer.byteLength(node.content, 'utf8') <= maxBytes
                && !/[\u0000-\u001f\u007f]/.test(node.content)
                && (allowEmpty || node.content.length > 0));
    const multilineScalar = (node: any, maxBytes: number): boolean =>
        node && (!node.children || node.children.length === 0) && typeof node.content === 'string'
        && Buffer.byteLength(node.content, 'utf8') <= maxBytes
        && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(node.content);
    const validDate = (value: string): boolean => Boolean(parseActiveSyncCalendarDate(value));
    const validBody = (node: any): boolean => {
        if (node?.page !== 17 || !Array.isArray(node.children)
            || node.children.length < 1 || node.children.length > 8) return false;
        const seen = new Set<string>();
        for (const child of node.children) {
            if (child?.page !== 17 || seen.has(child.tag)
                || !['Type', 'Data', 'EstimatedDataSize', 'Truncated', 'NativeBodyType'].includes(child.tag)
                || !(child.tag === 'Data'
                    ? multilineScalar(child, MAX_ACTIVE_SYNC_CALENDAR_BODY_BYTES)
                    : scalar(child, 16))) return false;
            seen.add(child.tag);
        }
        const bodyValue = (tag: string) => nodeText(node.children.find((child: any) => child.tag === tag));
        return !(seen.has('Type') && bodyValue('Type') !== '1'
            || seen.has('EstimatedDataSize') && !/^(?:0|[1-9][0-9]{0,9})$/.test(bodyValue('EstimatedDataSize'))
            || seen.has('EstimatedDataSize') && Number(bodyValue('EstimatedDataSize')) > 0xFFFFFFFF
            || seen.has('Truncated') && bodyValue('Truncated') !== '0'
            || seen.has('NativeBodyType') && bodyValue('NativeBodyType') !== '1');
    };
    const validCategories = (node: any): boolean => Array.isArray(node?.children)
        && node.children.length <= 128
        && node.children.every((child: any) => child?.page === 4 && child.tag === 'Category'
            && scalar(child, MAX_ACTIVE_SYNC_CALENDAR_CATEGORY_BYTES));
    const validAttendees = (node: any): boolean => Array.isArray(node?.children)
        && node.children.length <= 128
        && node.children.every((attendee: any) => {
            const seen = new Set<string>();
            return attendee?.page === 4 && attendee.tag === 'Attendee'
                && Array.isArray(attendee.children)
                && attendee.children.every((child: any) => child?.page === 4 && !seen.has(child.tag)
                    && (seen.add(child.tag), true)
                    && ['Email', 'Name', 'AttendeeStatus', 'AttendeeType'].includes(child.tag)
                    && scalar(child)
                    && !(child.tag === 'AttendeeStatus' && !/^(?:0|2|3|4)$/.test(nodeText(child)))
                    && !(child.tag === 'AttendeeType' && !/^[123]$/.test(nodeText(child))));
        });
    for (const field of applicationData?.children || []) {
        const identity = `${field?.page}:${field?.tag}`;
        if (topSeen.has(identity)) throw new ActiveSyncCalendarFieldError();
        topSeen.add(identity);
        if (field.page === 17 && field.tag === 'Body') {
            if (!validBody(field)) throw new ActiveSyncCalendarFieldError();
            continue;
        }
        if (field.page !== 4) throw new ActiveSyncCalendarFieldError();
        if (CALENDAR_SCALAR_FIELDS.has(field.tag)) {
            const max = field.tag === 'TimeZone' ? 1024 : field.tag === 'UID' ? 300 : 8192;
            if (!scalar(field, max)
                || ['StartTime', 'EndTime', 'DtStamp'].includes(field.tag) && nodeText(field) && !validDate(nodeText(field))) {
                throw new ActiveSyncCalendarFieldError();
            }
            const value = nodeText(field);
            if (field.tag === 'UID' && !value
                || ['AllDayEvent', 'ResponseRequested', 'DisallowNewTimeProposal'].includes(field.tag)
                    && !/^[01]$/.test(value)
                || field.tag === 'BusyStatus' && !/^[0-4]$/.test(value)
                || field.tag === 'Sensitivity' && !/^[0-3]$/.test(value)
                || field.tag === 'MeetingStatus' && !/^(?:0|1|3|5|7|9|11|13|15)$/.test(value)
                || field.tag === 'Reminder' && value !== '' && !/^(?:0|[1-9][0-9]{0,5})$/.test(value)
                || field.tag === 'Reminder' && value !== '' && Number(value) > 525_600
                || ['StartTime', 'EndTime', 'DtStamp'].includes(field.tag) && !value) {
                throw new ActiveSyncCalendarFieldError();
            }
            continue;
        }
        if (field.tag === 'Recurrence') {
            const seen = new Set<string>();
            if (!Array.isArray(field.children) || field.children.length === 0 || field.children.length > 11
                || field.children.some((child: any) => {
                    if (child?.page !== 4 || seen.has(child.tag)
                        || !['Type', 'Until', 'Occurrences', 'Interval', 'DayOfWeek', 'DayOfMonth', 'WeekOfMonth', 'MonthOfYear', 'CalendarType', 'IsLeapMonth', 'FirstDayOfWeek'].includes(child.tag)
                        || !scalar(child, 32)) return true;
                    seen.add(child.tag);
                    return child.tag === 'Until'
                        ? !/^\d{8}T\d{6}Z$/.test(nodeText(child))
                        : !/^\d{1,4}$/.test(nodeText(child));
                })) {
                throw new ActiveSyncCalendarFieldError();
            }
            const value = (tag: string): string => nodeText(field.children.find((child: any) => child.tag === tag));
            const number = (tag: string): number | null => {
                const raw = value(tag);
                return raw === '' ? null : Number(raw);
            };
            const type = value('Type');
            const interval = number('Interval');
            const occurrences = number('Occurrences');
            const dayOfWeek = number('DayOfWeek');
            const dayOfMonth = number('DayOfMonth');
            const weekOfMonth = number('WeekOfMonth');
            const monthOfYear = number('MonthOfYear');
            const calendarType = number('CalendarType');
            const isLeapMonth = number('IsLeapMonth');
            const firstDayOfWeek = number('FirstDayOfWeek');
            if (!['0', '1', '2', '3', '5', '6'].includes(type)
                || interval !== null && (!Number.isInteger(interval) || interval < 0 || interval > 999)
                || occurrences !== null && (!Number.isInteger(occurrences) || occurrences < 1 || occurrences > 999)
                || dayOfWeek !== null && (!Number.isInteger(dayOfWeek) || dayOfWeek < 1 || dayOfWeek > 127)
                || dayOfMonth !== null && (!Number.isInteger(dayOfMonth) || dayOfMonth < 1 || dayOfMonth > 31)
                || weekOfMonth !== null && (!Number.isInteger(weekOfMonth) || weekOfMonth < 1 || weekOfMonth > 5)
                || monthOfYear !== null && (!Number.isInteger(monthOfYear) || monthOfYear < 1 || monthOfYear > 12)
                || calendarType !== null && ![0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 15, 20].includes(calendarType)
                || isLeapMonth !== null && ![0, 1].includes(isLeapMonth)
                || firstDayOfWeek !== null && (!Number.isInteger(firstDayOfWeek) || firstDayOfWeek < 0 || firstDayOfWeek > 6)
                || value('Until') && !validDate(value('Until'))
                || type === '1' && dayOfWeek === null
                || type === '2' && dayOfMonth === null
                || type === '3' && (dayOfWeek === null || weekOfMonth === null)
                || type === '5' && (dayOfMonth === null || monthOfYear === null)
                || type === '6' && (weekOfMonth === null || monthOfYear === null)
                || dayOfWeek !== null && !['0', '1', '3', '6'].includes(type)
                || dayOfMonth !== null && !['2', '5'].includes(type)
                || weekOfMonth !== null && !['3', '6'].includes(type)
                || monthOfYear !== null && !['5', '6'].includes(type)
                || calendarType !== null && !['2', '3', '5', '6'].includes(type)
                || isLeapMonth !== null && !['5', '6'].includes(type)) {
                throw new ActiveSyncCalendarFieldError();
            }
            continue;
        }
        if (field.tag === 'Categories') {
            if (!validCategories(field)) throw new ActiveSyncCalendarFieldError();
            continue;
        }
        if (field.tag === 'Attendees') {
            if (!validAttendees(field)) throw new ActiveSyncCalendarFieldError();
            continue;
        }
        if (field.tag === 'Exceptions') {
            if (!Array.isArray(field.children) || field.children.length > MAX_ACTIVE_SYNC_CALENDAR_EXCEPTIONS) {
                throw new ActiveSyncCalendarFieldError();
            }
            const occurrenceIds = new Set<string>();
            for (const exception of field.children) {
                if (exception?.page !== 4 || exception.tag !== 'Exception'
                    || !Array.isArray(exception.children) || exception.children.length > 15) {
                    throw new ActiveSyncCalendarFieldError();
                }
                const seen = new Set<string>();
                for (const child of exception.children) {
                    if (!child || seen.has(`${child.page}:${child.tag}`)) throw new ActiveSyncCalendarFieldError();
                    seen.add(`${child.page}:${child.tag}`);
                    if (child.page === 17 && child.tag === 'Body') {
                        if (!validBody(child)) throw new ActiveSyncCalendarFieldError();
                        continue;
                    }
                    if (child.page !== 4) throw new ActiveSyncCalendarFieldError();
                    if (child.tag === 'Categories') {
                        if (!validCategories(child)) throw new ActiveSyncCalendarFieldError();
                        continue;
                    }
                    if (child.tag === 'Attendees') {
                        if (!validAttendees(child)) throw new ActiveSyncCalendarFieldError();
                        continue;
                    }
                    if (!['Deleted', 'ExceptionStartTime', 'AllDayEvent', 'StartTime', 'EndTime', 'Subject',
                        'Reminder', 'Location', 'Sensitivity', 'BusyStatus', 'DtStamp', 'MeetingStatus'].includes(child.tag)
                        || !scalar(child, ['Subject', 'Location'].includes(child.tag)
                            ? MAX_ACTIVE_SYNC_CALENDAR_EXCEPTION_TEXT_BYTES : 32)) {
                        throw new ActiveSyncCalendarFieldError();
                    }
                    const value = nodeText(child);
                    if (['ExceptionStartTime', 'StartTime', 'EndTime', 'DtStamp'].includes(child.tag)
                            && (!value || !validDate(value))
                        || ['Deleted', 'AllDayEvent'].includes(child.tag) && !/^[01]$/.test(value)
                        || child.tag === 'Sensitivity' && !/^[0-3]$/.test(value)
                        || child.tag === 'BusyStatus' && !/^[0-4]$/.test(value)
                        || child.tag === 'MeetingStatus' && !/^(?:0|1|3|5|7|9|11|13|15)$/.test(value)
                        || child.tag === 'Reminder' && value !== ''
                            && (!/^(?:0|[1-9][0-9]{0,5})$/.test(value) || Number(value) > 525_600)) {
                        throw new ActiveSyncCalendarFieldError();
                    }
                }
                const occurrenceId = childText(exception, 'ExceptionStartTime');
                if (!occurrenceId || occurrenceIds.has(occurrenceId)) throw new ActiveSyncCalendarFieldError();
                occurrenceIds.add(occurrenceId);
                const exceptionStart = childNode(exception, 'StartTime');
                const exceptionEnd = childNode(exception, 'EndTime');
                if (exceptionStart && exceptionEnd
                    && parseActiveSyncCalendarDate(nodeText(exceptionEnd))!.getTime()
                        <= parseActiveSyncCalendarDate(nodeText(exceptionStart))!.getTime()) {
                    throw new ActiveSyncCalendarFieldError();
                }
            }
            continue;
        }
        throw new ActiveSyncCalendarFieldError();
    }
    if (childNode(applicationData, 'EndTime') && !childNode(applicationData, 'StartTime')) {
        throw new ActiveSyncCalendarFieldError();
    }
    const start = childNode(applicationData, 'StartTime');
    const end = childNode(applicationData, 'EndTime');
    if (start && end && parseActiveSyncCalendarDate(nodeText(end))!.getTime()
        <= parseActiveSyncCalendarDate(nodeText(start))!.getTime()) {
        throw new ActiveSyncCalendarFieldError();
    }
}

function icalEscape(value: string): string {
    return value
        .replace(/\r\n?/g, '\n')
        .replace(/\\/g, '\\\\')
        .replace(/\n/g, '\\n')
        .replace(/;/g, '\\;')
        .replace(/,/g, '\\,');
}

export function normalizeCalendarEventUid(value: string): string {
    const normalized = value
        .trim()
        .replace(/[\r\n]+/g, '-')
        .replace(/[^A-Za-z0-9._@-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 180);
    return normalized || `eas-event-${Date.now()}`;
}

export function parseActiveSyncCalendarDate(value: string): Date | null {
    const trimmed = value.trim();
    if (!trimmed) return null;

    const compact = trimmed.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
    if (compact) {
        const parts = compact.slice(1, 7).map(Number);
        const parsed = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], parts[5]));
        if (parsed.getUTCFullYear() !== parts[0] || parsed.getUTCMonth() + 1 !== parts[1]
            || parsed.getUTCDate() !== parts[2] || parsed.getUTCHours() !== parts[3]
            || parsed.getUTCMinutes() !== parts[4] || parsed.getUTCSeconds() !== parts[5]) return null;
        return parsed;
    }

    const dateOnly = trimmed.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (dateOnly) {
        const parts = dateOnly.slice(1, 4).map(Number);
        const parsed = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2], 0, 0, 0));
        if (parsed.getUTCFullYear() !== parts[0] || parsed.getUTCMonth() + 1 !== parts[1]
            || parsed.getUTCDate() !== parts[2]) return null;
        return parsed;
    }
    return null;
}

function formatIcalDateOnly(date: Date): string {
    return date.toISOString().slice(0, 10).replace(/-/g, '');
}

function reminderMinutes(node: any): number | null {
    if (!node || node.content === undefined || node.content === null || nodeText(node).trim() === '') return null;
    const parsed = Number(nodeText(node));
    if (!Number.isFinite(parsed) || parsed < 0) return null;
    return Math.min(525_600, Math.floor(parsed));
}

function appendDisplayAlarm(lines: string[], subject: string, minutes: number | null | undefined): void {
    if (minutes === null || minutes === undefined) return;
    lines.push(
        'BEGIN:VALARM',
        'ACTION:DISPLAY',
        `TRIGGER:-PT${Math.max(0, Math.floor(minutes))}M`,
        `DESCRIPTION:${icalEscape(subject)}`,
        'END:VALARM'
    );
}

type ActiveSyncCalendarAttendee = { email: string; name?: string; status?: string; type?: string };

function activeSyncAttendeeValues(node: any): ActiveSyncCalendarAttendee[] {
    return (node?.children || []).map((attendee: any) => ({
        email: childText(attendee, 'Email').trim(),
        ...(childText(attendee, 'Name') ? { name: childText(attendee, 'Name') } : {}),
        ...(childText(attendee, 'AttendeeStatus') ? { status: childText(attendee, 'AttendeeStatus') } : {}),
        ...(childText(attendee, 'AttendeeType') ? { type: childText(attendee, 'AttendeeType') } : {}),
    }));
}

function appendIcalAttendees(lines: string[], attendees: ActiveSyncCalendarAttendee[]): void {
    const statusMap: Record<string, string> = { '0': 'NEEDS-ACTION', '2': 'TENTATIVE', '3': 'ACCEPTED', '4': 'DECLINED' };
    const roleMap: Record<string, string> = { '1': 'REQ-PARTICIPANT', '2': 'OPT-PARTICIPANT', '3': 'NON-PARTICIPANT' };
    for (const attendee of attendees) {
        const email = attendee.email.trim();
        if (!email || /[\r\n]/.test(email)) throw new ActiveSyncCalendarFieldError();
        const name = String(attendee.name || '').replace(/[\r\n"]/g, ' ').trim();
        const parameters = [
            ...(name ? [`CN="${name}"`] : []),
            ...(statusMap[attendee.status || ''] ? [`PARTSTAT=${statusMap[attendee.status || '']}`] : []),
            ...(roleMap[attendee.type || ''] ? [`ROLE=${roleMap[attendee.type || '']}`] : []),
        ];
        lines.push(`ATTENDEE${parameters.length ? `;${parameters.join(';')}` : ''}:mailto:${email}`);
    }
}

function appendParsedException(lines: string[], uid: string, recurrenceId: Date, event: ParsedIcalEvent): void {
    lines.push('BEGIN:VEVENT', `UID:${icalEscape(uid)}`, `RECURRENCE-ID:${formatActiveSyncDate(recurrenceId)}`);
    if (event.isAllDay) {
        lines.push(`DTSTART;VALUE=DATE:${formatIcalDateOnly(event.start)}`);
        lines.push(`DTEND;VALUE=DATE:${formatIcalDateOnly(event.end)}`);
    } else if (event.timeKind === 'zoned' && event.timeZone) {
        lines.push(`DTSTART;TZID=${event.timeZone}:${formatIcalWallTime(event.start, event.timeZone)}`);
        lines.push(`DTEND;TZID=${event.timeZone}:${formatIcalWallTime(event.end, event.timeZone)}`);
    } else {
        lines.push(`DTSTART:${formatActiveSyncDate(event.start)}`, `DTEND:${formatActiveSyncDate(event.end)}`);
    }
    lines.push(`SUMMARY:${icalEscape(event.title)}`);
    if (event.location) lines.push(`LOCATION:${icalEscape(event.location)}`);
    if (event.description) lines.push(`DESCRIPTION:${icalEscape(event.description)}`);
    appendDisplayAlarm(lines, event.title, event.notifications?.[0]?.time);
    lines.push('END:VEVENT');
}

function calendarApplicationDataWithOmittedClears(
    applicationData: any,
    omittedFieldsToClear: ReadonlySet<string>,
): any {
    if (omittedFieldsToClear.size === 0) return applicationData;
    const children = [...(applicationData?.children || [])];
    const present = new Set(children.map((child: any) => `${child?.page}:${child?.tag}`));
    for (const identity of omittedFieldsToClear) {
        if (present.has(identity) || !identity.startsWith('4:')) continue;
        const tag = identity.slice(2);
        if (tag === 'UID') continue;
        if (CALENDAR_SCALAR_FIELDS.has(tag)) {
            children.push({ tag, page: 4, content: '' });
        } else if (['Attendees', 'Categories', 'Recurrence'].includes(tag)) {
            children.push({ tag, page: 4, children: [] });
        }
    }
    return { ...applicationData, children };
}

export function activeSyncCalendarApplicationDataToIcal(
    uid: string,
    applicationData: any,
    existingIcal = '',
    omittedFieldsToClear: ReadonlySet<string> = new Set(),
): string {
    assertSupportedCalendarApplicationData(applicationData);
    applicationData = calendarApplicationDataWithOmittedClears(applicationData, omittedFieldsToClear);
    const existing = existingIcal ? parseIcalEvent(uid, existingIcal) : null;
    const eventBlocks = existingIcal ? existingEventBlocks(existingIcal) : [];
    const mainBlock = eventBlocks.find(block => !directEventProperties(block).some(line => icalPropertyName(line) === 'RECURRENCE-ID'));
    const exceptionBlocks = eventBlocks.filter(block => directEventProperties(block).some(line => icalPropertyName(line) === 'RECURRENCE-ID'));
    const body = childNode(applicationData, 'Body');
    const allDayNode = childNode(applicationData, 'AllDayEvent');
    const isAllDay = allDayNode ? nodeText(allDayNode) === '1' : Boolean(existing?.isAllDay);
    const startNode = childNode(applicationData, 'StartTime');
    const endNode = childNode(applicationData, 'EndTime');
    const dtstampNode = childNode(applicationData, 'DtStamp');
    if (existing && [startNode, endNode, dtstampNode].some(node => node && !nodeText(node))) {
        throw new ActiveSyncCalendarFieldError();
    }
    const start = parseActiveSyncCalendarDate(nodeText(startNode)) || existing?.start || new Date();
    const fallbackEnd = new Date(start.getTime() + (isAllDay ? 24 * 60 * 60 * 1000 : 60 * 60 * 1000));
    const existingDuration = existing ? existing.end.getTime() - existing.start.getTime() : 0;
    const end = parseActiveSyncCalendarDate(nodeText(endNode))
        || (existing && startNode && !endNode && existingDuration > 0
            ? new Date(start.getTime() + existingDuration)
            : existing?.end || fallbackEnd);
    if (end.getTime() <= start.getTime()) throw new ActiveSyncCalendarFieldError();

    const subjectNode = childNode(applicationData, 'Subject');
    const subject = subjectNode ? firstNonEmpty(nodeText(subjectNode), 'Untitled') : firstNonEmpty(existing?.title || '', 'Untitled');
    const locationNode = childNode(applicationData, 'Location');
    const location = locationNode ? childText(applicationData, 'Location') : existing?.location || '';
    const descriptionNode = childNode(applicationData, 'Description');
    const description = body
        ? childText(body, 'Data')
        : descriptionNode
            ? nodeText(descriptionNode)
            : existing?.description || '';
    const dtstamp = parseActiveSyncCalendarDate(nodeText(dtstampNode)) || existing?.dtstamp || new Date();
    const timeZoneNode = childNode(applicationData, 'TimeZone');
    const timeZoneValue = nodeText(timeZoneNode);
    const timeZone = isAllDay
        ? null
        : timeZoneNode
            ? timeZoneValue
            ? resolveActiveSyncTimeZone(timeZoneValue, start)
                : null
            : existing?.timeKind === 'zoned' ? existing.timeZone : null;
    const incomingReminder = childNode(applicationData, 'Reminder');
    const reminder = incomingReminder
        ? reminderMinutes(incomingReminder)
        : existing?.notifications?.[0]?.time ?? null;

    let rruleLine = existing?.recurrence?.raw ? `RRULE:${existing.recurrence.raw}` : '';
    let recurrenceCalendarType = existing?.activeSyncCalendarType;
    let recurrenceIsLeapMonth = existing?.activeSyncIsLeapMonth;
    let recurrenceDayOfWeekOmitted = existing?.activeSyncRecurrenceDayOfWeekOmitted || false;
    const recurrenceNode = childNode(applicationData, 'Recurrence');
    if (recurrenceNode && recurrenceNode.children?.length === 0) {
        rruleLine = '';
        recurrenceCalendarType = undefined;
        recurrenceIsLeapMonth = undefined;
        recurrenceDayOfWeekOmitted = false;
    } else if (recurrenceNode) {
        const recType = childText(recurrenceNode, 'Type');
        const intervalValue = childText(recurrenceNode, 'Interval');
        const interval = !intervalValue || intervalValue === '0' ? '1' : intervalValue;
        const until = childText(recurrenceNode, 'Until');
        const occurrences = childText(recurrenceNode, 'Occurrences');
        recurrenceCalendarType = childNode(recurrenceNode, 'CalendarType')
            ? childText(recurrenceNode, 'CalendarType')
            : undefined;
        recurrenceIsLeapMonth = childNode(recurrenceNode, 'IsLeapMonth')
            ? childText(recurrenceNode, 'IsLeapMonth')
            : undefined;
        recurrenceDayOfWeekOmitted = recType === '6' && !childNode(recurrenceNode, 'DayOfWeek');
        const freqMap: Record<string, string> = {
            '0': 'DAILY',
            '1': 'WEEKLY',
            '2': 'MONTHLY',
            '3': 'MONTHLY',
            '5': 'YEARLY',
            '6': 'YEARLY',
        };
        const freq = recType === '0' && childText(recurrenceNode, 'DayOfWeek') ? 'WEEKLY' : freqMap[recType];
        let rrule = `RRULE:FREQ=${freq}`;
        if (interval !== '1') rrule += `;INTERVAL=${interval}`;
        if (occurrences) rrule += `;COUNT=${occurrences}`;
        else if (until) rrule += `;UNTIL=${until.replace(/[^0-9TZ]/g, '')}`;
        const dayOfWeek = Number(childText(recurrenceNode, 'DayOfWeek'));
        const dayNames = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];
        let selectedDays = dayNames.filter((_, index) => Number.isInteger(dayOfWeek) && (dayOfWeek & (1 << index)) !== 0);
        if (recurrenceDayOfWeekOmitted) {
            const startWeekday = timeZone
                ? ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(new Intl.DateTimeFormat('en-US', {
                    timeZone,
                    weekday: 'short',
                }).format(start))
                : start.getUTCDay();
            selectedDays = [dayNames[startWeekday]];
        }
        const weekOfMonth = Number(childText(recurrenceNode, 'WeekOfMonth'));
        if (selectedDays.length) {
            rrule += `;BYDAY=${selectedDays.join(',')}`;
            if (Number.isInteger(weekOfMonth) && weekOfMonth >= 1 && weekOfMonth <= 5) {
                rrule += `;BYSETPOS=${weekOfMonth === 5 ? -1 : weekOfMonth}`;
            }
        }
        const dayOfMonth = Number(childText(recurrenceNode, 'DayOfMonth'));
        if (Number.isInteger(dayOfMonth) && dayOfMonth >= 1 && dayOfMonth <= 31) rrule += `;BYMONTHDAY=${dayOfMonth}`;
        const monthOfYear = Number(childText(recurrenceNode, 'MonthOfYear'));
        if (Number.isInteger(monthOfYear) && monthOfYear >= 1 && monthOfYear <= 12) rrule += `;BYMONTH=${monthOfYear}`;
        const firstDay = Number(childText(recurrenceNode, 'FirstDayOfWeek'));
        if (childText(recurrenceNode, 'FirstDayOfWeek')) rrule += `;WKST=${dayNames[firstDay]}`;
        rruleLine = rrule;
    }

    const incomingUidNode = childNode(applicationData, 'UID');
    const eventUid = incomingUidNode ? nodeText(incomingUidNode) : existing?.uid || uid;
    const lines = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//OpenMailStack//ActiveSync Calendar//EN',
        'BEGIN:VEVENT',
        `UID:${icalEscape(eventUid)}`,
        `DTSTAMP:${formatActiveSyncDate(dtstamp)}`
    ];

    if (isAllDay) {
        lines.push(`DTSTART;VALUE=DATE:${formatIcalDateOnly(start)}`);
        lines.push(`DTEND;VALUE=DATE:${formatIcalDateOnly(end)}`);
    } else if (timeZone) {
        lines.push(`DTSTART;TZID=${timeZone}:${formatIcalWallTime(start, timeZone)}`);
        lines.push(`DTEND;TZID=${timeZone}:${formatIcalWallTime(end, timeZone)}`);
    } else {
        lines.push(`DTSTART:${formatActiveSyncDate(start)}`);
        lines.push(`DTEND:${formatActiveSyncDate(end)}`);
    }

    lines.push(`SUMMARY:${icalEscape(subject)}`);
    if (location) lines.push(`LOCATION:${icalEscape(location)}`);
    if (description) lines.push(`DESCRIPTION:${icalEscape(description)}`);
    if (rruleLine) lines.push(rruleLine);
    if (rruleLine && recurrenceCalendarType !== undefined) {
        lines.push(`X-OMS-ACTIVESYNC-CALENDAR-TYPE:${recurrenceCalendarType}`);
    }
    if (rruleLine && recurrenceIsLeapMonth !== undefined) {
        lines.push(`X-OMS-ACTIVESYNC-IS-LEAP-MONTH:${recurrenceIsLeapMonth}`);
    }
    if (rruleLine && recurrenceDayOfWeekOmitted) {
        lines.push('X-OMS-ACTIVESYNC-DAY-OF-WEEK-OMITTED:1');
    }
    const incomingExceptions = childNode(applicationData, 'Exceptions');
    if (!incomingExceptions) {
        const existingExdates = mainBlock
            ? directEventProperties(mainBlock).filter(property => icalPropertyName(property) === 'EXDATE')
            : [];
        lines.push(...existingExdates);
    } else {
        const deletedOccurrenceCandidates = incomingExceptions.children
            ?.filter((exception: any) => childText(exception, 'Deleted') === '1')
            .map((exception: any) => parseActiveSyncCalendarDate(childText(exception, 'ExceptionStartTime')))
            .filter((date: Date | null): date is Date => Boolean(date)) || [];
        const deletedOccurrenceIds = Array.from(new Map<string, Date>(
            deletedOccurrenceCandidates.map(date => [formatActiveSyncDate(date), date] as const)
        ).values());
        if (deletedOccurrenceIds.length > 0) {
            if (isAllDay) {
                lines.push(`EXDATE;VALUE=DATE:${deletedOccurrenceIds.map(formatIcalDateOnly).join(',')}`);
            } else if (timeZone) {
                lines.push(`EXDATE;TZID=${timeZone}:${deletedOccurrenceIds
                    .map(date => formatIcalWallTime(date, timeZone)).join(',')}`);
            } else {
                lines.push(`EXDATE:${deletedOccurrenceIds.map(formatActiveSyncDate).join(',')}`);
            }
        }
    }
    const attendeesNode = childNode(applicationData, 'Attendees');
    const masterAttendees = attendeesNode
        ? activeSyncAttendeeValues(attendeesNode)
        : existing?.activeSyncAttendees || [];
    if (attendeesNode) appendIcalAttendees(lines, masterAttendees);
    const organizerEmailNode = childNode(applicationData, 'OrganizerEmail');
    const organizerNameNode = childNode(applicationData, 'OrganizerName');
    if (organizerEmailNode || organizerNameNode) {
        const email = (organizerEmailNode ? nodeText(organizerEmailNode) : existing?.organizerEmail || '').trim();
        if (email && (!/^[^\s@<>]+@[^\s@<>]+$/.test(email) || /[\r\n\0]/.test(email))) {
            throw new ActiveSyncCalendarFieldError();
        }
        if (email) {
            const name = (organizerNameNode ? nodeText(organizerNameNode) : existing?.organizerName || '')
                .replace(/[\r\n"]/g, ' ').trim();
            lines.push(`ORGANIZER${name ? `;CN="${name}"` : ''}:mailto:${email}`);
        }
    }
    const categoriesNode = childNode(applicationData, 'Categories');
    if (categoriesNode) {
        const categories = (categoriesNode.children || []).map((category: any) => nodeText(category)).filter(Boolean);
        if (categories.length) lines.push(`CATEGORIES:${categories.map(icalEscape).join(',')}`);
    }
    const sensitivityNode = childNode(applicationData, 'Sensitivity');
    if (sensitivityNode) {
        const raw = nodeText(sensitivityNode);
        const value = ({ '0': 'PUBLIC', '1': 'PERSONAL', '2': 'PRIVATE', '3': 'CONFIDENTIAL' } as Record<string, string>)[raw];
        if (value) lines.push(`CLASS:${value}`, `X-OMS-ACTIVESYNC-SENSITIVITY:${raw}`);
    }
    const meetingStatusNode = childNode(applicationData, 'MeetingStatus');
    if (meetingStatusNode && nodeText(meetingStatusNode)) {
        const raw = nodeText(meetingStatusNode);
        lines.push(`STATUS:${['5', '7', '13', '15'].includes(raw) ? 'CANCELLED' : 'CONFIRMED'}`);
        lines.push(`X-OMS-ACTIVESYNC-MEETING-STATUS:${raw}`);
    }
    const conferenceNode = childNode(applicationData, 'OnlineMeetingConfLink');
    const externalConferenceNode = childNode(applicationData, 'OnlineMeetingExternalLink');
    if (conferenceNode && nodeText(conferenceNode)) lines.push(`CONFERENCE;VALUE=URI:${icalEscape(nodeText(conferenceNode))}`);
    if (externalConferenceNode && nodeText(externalConferenceNode)) lines.push(`X-OMS-ONLINE-MEETING-EXTERNAL:${icalEscape(nodeText(externalConferenceNode))}`);
    const responseRequestedNode = childNode(applicationData, 'ResponseRequested');
    if (responseRequestedNode && nodeText(responseRequestedNode)) {
        lines.push(`X-OMS-RESPONSE-REQUESTED:${icalEscape(nodeText(responseRequestedNode))}`);
    }
    const disallowNewTimeProposalNode = childNode(applicationData, 'DisallowNewTimeProposal');
    if (disallowNewTimeProposalNode && nodeText(disallowNewTimeProposalNode)) {
        lines.push(`X-OMS-DISALLOW-NEW-TIME-PROPOSAL:${nodeText(disallowNewTimeProposalNode)}`);
    }
    const incomingBusyStatusNode = childNode(applicationData, 'BusyStatus');
    const incomingBusyStatus = nodeText(incomingBusyStatusNode);

    const managedProperties = new Set([
        'UID', 'DTSTAMP', 'DTSTART', 'DTEND', 'SUMMARY', 'LOCATION', 'DESCRIPTION', 'RRULE', 'EXDATE', 'TRANSP',
        'X-OMS-ACTIVESYNC-CALENDAR-TYPE', 'X-OMS-ACTIVESYNC-IS-LEAP-MONTH',
        'X-OMS-ACTIVESYNC-DAY-OF-WEEK-OMITTED',
    ]);
    if (attendeesNode) managedProperties.add('ATTENDEE');
    if (organizerEmailNode || organizerNameNode) managedProperties.add('ORGANIZER');
    if (categoriesNode) managedProperties.add('CATEGORIES');
    if (sensitivityNode) managedProperties.add('CLASS');
    if (sensitivityNode) managedProperties.add('X-OMS-ACTIVESYNC-SENSITIVITY');
    if (meetingStatusNode) {
        managedProperties.add('STATUS');
        managedProperties.add('X-OMS-ACTIVESYNC-MEETING-STATUS');
    }
    if (conferenceNode) managedProperties.add('CONFERENCE');
    if (externalConferenceNode) managedProperties.add('X-OMS-ONLINE-MEETING-EXTERNAL');
    if (responseRequestedNode) managedProperties.add('X-OMS-RESPONSE-REQUESTED');
    if (disallowNewTimeProposalNode) managedProperties.add('X-OMS-DISALLOW-NEW-TIME-PROPOSAL');
    if (incomingBusyStatusNode) managedProperties.add('X-OMS-ACTIVESYNC-BUSY-STATUS');
    if (mainBlock) {
        for (const property of directEventProperties(mainBlock)) {
            if (!managedProperties.has(icalPropertyName(property))) lines.push(property);
        }
    }
    if (incomingBusyStatusNode && incomingBusyStatus) {
        lines.push(`X-OMS-ACTIVESYNC-BUSY-STATUS:${incomingBusyStatus}`);
    }
    lines.push(`TRANSP:${incomingBusyStatusNode
        ? incomingBusyStatus === '0' ? 'TRANSPARENT' : 'OPAQUE'
        : existing?.busyStatus === 'free' ? 'TRANSPARENT' : 'OPAQUE'}`);
    appendDisplayAlarm(lines, subject, reminder);
    lines.push('END:VEVENT');

    if (incomingExceptions) {
        for (const exception of incomingExceptions.children || []) {
            if (childText(exception, 'Deleted') === '1') continue;
            const recurrenceId = parseActiveSyncCalendarDate(childText(exception, 'ExceptionStartTime'));
            if (!recurrenceId) continue;
            const existingException = existing?.recurrenceExceptions?.find(candidate =>
                formatActiveSyncDate(candidate.recurrenceId) === formatActiveSyncDate(recurrenceId)
            )?.event;
            const exceptionAllDayText = childText(exception, 'AllDayEvent');
            const exceptionIsAllDay = exceptionAllDayText
                ? exceptionAllDayText === '1'
                : existingException?.isAllDay ?? isAllDay;
            const exceptionStart = parseActiveSyncCalendarDate(childText(exception, 'StartTime'))
                || existingException?.start
                || recurrenceId;
            const exceptionEnd = parseActiveSyncCalendarDate(childText(exception, 'EndTime'))
                || existingException?.end
                || new Date(exceptionStart.getTime() + (end.getTime() - start.getTime()));
            const exceptionSubjectNode = childNode(exception, 'Subject');
            const exceptionSubject = exceptionSubjectNode
                ? nodeText(exceptionSubjectNode)
                : existingException?.title ?? subject;
            const exceptionLocationNode = childNode(exception, 'Location');
            const exceptionLocation = exceptionLocationNode
                ? nodeText(exceptionLocationNode)
                : existingException?.location ?? location;
            const exceptionBodyNode = childNode(exception, 'Body');
            const exceptionDescription = exceptionBodyNode
                ? childText(exceptionBodyNode, 'Data')
                : existingException?.description ?? description;
            const exceptionCategoriesNode = childNode(exception, 'Categories');
            const masterCategories = categoriesNode
                ? (categoriesNode.children || []).map((category: any) => nodeText(category)).filter(Boolean)
                : existing?.categories || [];
            const exceptionCategories = exceptionCategoriesNode
                ? (exceptionCategoriesNode.children || []).map((category: any) => nodeText(category)).filter(Boolean)
                : existingException?.categories ?? masterCategories;
            const exceptionSensitivity = childNode(exception, 'Sensitivity')
                ? childText(exception, 'Sensitivity')
                : existingException?.sensitivity ?? (sensitivityNode ? nodeText(sensitivityNode) : existing?.sensitivity || '0');
            const exceptionBusyStatus = childNode(exception, 'BusyStatus')
                ? childText(exception, 'BusyStatus')
                : existingException?.activeSyncBusyStatus
                    ?? (incomingBusyStatusNode ? incomingBusyStatus : existing?.activeSyncBusyStatus || '2');
            const exceptionDtStamp = parseActiveSyncCalendarDate(childText(exception, 'DtStamp'))
                || existingException?.dtstamp
                || dtstamp;
            const exceptionMeetingStatus = childNode(exception, 'MeetingStatus')
                ? childText(exception, 'MeetingStatus')
                : existingException?.meetingStatus
                    ?? (meetingStatusNode ? nodeText(meetingStatusNode) : existing?.meetingStatus || '0');
            const exceptionAttendeesNode = childNode(exception, 'Attendees');
            const exceptionAttendees = exceptionAttendeesNode
                ? activeSyncAttendeeValues(exceptionAttendeesNode)
                : existingException?.activeSyncAttendees ?? masterAttendees;
            const exceptionReminderNode = childNode(exception, 'Reminder');
            const exceptionReminder = exceptionReminderNode
                ? reminderMinutes(exceptionReminderNode)
                : existingException?.notifications?.[0]?.time ?? reminder;
            lines.push(
                'BEGIN:VEVENT',
                `UID:${icalEscape(eventUid)}`,
                `DTSTAMP:${formatActiveSyncDate(exceptionDtStamp)}`,
            );
            if (isAllDay) {
                lines.push(`RECURRENCE-ID;VALUE=DATE:${formatIcalDateOnly(recurrenceId)}`);
            } else {
                lines.push(`RECURRENCE-ID:${formatActiveSyncDate(recurrenceId)}`);
            }
            if (exceptionIsAllDay) {
                lines.push(`DTSTART;VALUE=DATE:${formatIcalDateOnly(exceptionStart)}`);
                lines.push(`DTEND;VALUE=DATE:${formatIcalDateOnly(exceptionEnd)}`);
            } else {
                lines.push(`DTSTART:${formatActiveSyncDate(exceptionStart)}`);
                lines.push(`DTEND:${formatActiveSyncDate(exceptionEnd)}`);
            }
            lines.push(`SUMMARY:${icalEscape(exceptionSubject)}`);
            if (exceptionLocationNode || exceptionLocation) lines.push(`LOCATION:${icalEscape(exceptionLocation)}`);
            if (exceptionBodyNode || exceptionDescription) lines.push(`DESCRIPTION:${icalEscape(exceptionDescription)}`);
            if (exceptionCategoriesNode || exceptionCategories.length > 0) {
                lines.push(`CATEGORIES:${exceptionCategories.map(icalEscape).join(',')}`);
            }
            const sensitivityClass = ({
                '0': 'PUBLIC', '1': 'PERSONAL', '2': 'PRIVATE', '3': 'CONFIDENTIAL',
            } as Record<string, string>)[exceptionSensitivity];
            if (sensitivityClass) {
                lines.push(`CLASS:${sensitivityClass}`, `X-OMS-ACTIVESYNC-SENSITIVITY:${exceptionSensitivity}`);
            }
            lines.push(
                `X-OMS-ACTIVESYNC-BUSY-STATUS:${exceptionBusyStatus}`,
                `TRANSP:${exceptionBusyStatus === '0' ? 'TRANSPARENT' : 'OPAQUE'}`,
                `STATUS:${['5', '7', '13', '15'].includes(exceptionMeetingStatus) ? 'CANCELLED' : 'CONFIRMED'}`,
                `X-OMS-ACTIVESYNC-MEETING-STATUS:${exceptionMeetingStatus}`,
            );
            if (JSON.stringify(exceptionAttendees) !== JSON.stringify(masterAttendees)) {
                if (exceptionAttendees.length === 0) lines.push('X-OMS-ACTIVESYNC-ATTENDEES-CLEARED:1');
                else appendIcalAttendees(lines, exceptionAttendees);
            }
            appendDisplayAlarm(lines, exceptionSubject, exceptionReminder);
            lines.push('END:VEVENT');
        }
    } else {
        for (const block of exceptionBlocks) lines.push(...block);
    }
    lines.push('END:VCALENDAR');

    return `${lines.join('\r\n')}\r\n`;
}

function recurrenceWallParts(event: ParsedIcalEvent): { month: number; day: number; weekday: number } {
    if (event.timeKind === 'zoned' && event.timeZone) {
        const values = new Map(new Intl.DateTimeFormat('en-US', {
            timeZone: event.timeZone,
            month: 'numeric',
            day: 'numeric',
            weekday: 'short',
        }).formatToParts(event.start).map(part => [part.type, part.value]));
        const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(values.get('weekday') || '');
        return { month: Number(values.get('month')), day: Number(values.get('day')), weekday };
    }
    return { month: event.start.getUTCMonth() + 1, day: event.start.getUTCDate(), weekday: event.start.getUTCDay() };
}

function recurrenceParts(raw: string): Map<string, string> {
    const parts = new Map<string, string>();
    for (const item of raw.split(';')) {
        const separator = item.indexOf('=');
        if (separator <= 0) throw new ActiveSyncCalendarFieldError();
        const key = item.slice(0, separator).trim().toUpperCase();
        const value = item.slice(separator + 1).trim().toUpperCase();
        if (!value || parts.has(key)) throw new ActiveSyncCalendarFieldError();
        parts.set(key, value);
    }
    const supported = new Set(['FREQ', 'INTERVAL', 'COUNT', 'UNTIL', 'BYDAY', 'BYMONTHDAY', 'BYMONTH', 'BYSETPOS', 'WKST']);
    if ([...parts.keys()].some(key => !supported.has(key))) throw new ActiveSyncCalendarFieldError();
    return parts;
}

function recurrenceDaySelection(value: string | undefined): { mask: number; position: number | null } | null {
    if (!value) return null;
    const dayBits: Record<string, number> = { SU: 1, MO: 2, TU: 4, WE: 8, TH: 16, FR: 32, SA: 64 };
    let mask = 0;
    const positions = new Set<number>();
    for (const token of value.split(',')) {
        const match = /^([+-]?\d+)?(SU|MO|TU|WE|TH|FR|SA)$/.exec(token);
        if (!match || mask & dayBits[match[2]]) throw new ActiveSyncCalendarFieldError();
        mask |= dayBits[match[2]];
        if (match[1]) positions.add(Number(match[1]));
    }
    if (!mask || positions.size > 1) throw new ActiveSyncCalendarFieldError();
    return { mask, position: positions.size === 1 ? [...positions][0] : null };
}

function recurrenceListNumber(parts: Map<string, string>, key: string, minimum: number, maximum: number): number | null {
    const value = parts.get(key);
    if (!value) return null;
    if (!/^\d+$/.test(value) || value.includes(',')) throw new ActiveSyncCalendarFieldError();
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) throw new ActiveSyncCalendarFieldError();
    return parsed;
}

function activeSyncRecurrence(event: ParsedIcalEvent): ActiveSyncCalendarNode | null {
    if (!event.recurrence) return null;
    const parts = recurrenceParts(event.recurrence.raw);
    const wall = recurrenceWallParts(event);
    const daySelection = recurrenceDaySelection(parts.get('BYDAY'));
    const dayOfMonth = recurrenceListNumber(parts, 'BYMONTHDAY', 1, 31);
    const monthOfYear = recurrenceListNumber(parts, 'BYMONTH', 1, 12);
    const bySetPositionValue = parts.get('BYSETPOS');
    let bySetPosition: number | null = null;
    if (bySetPositionValue !== undefined) {
        if (!/^(?:[1-4]|-1)$/.test(bySetPositionValue)) throw new ActiveSyncCalendarFieldError();
        bySetPosition = Number(bySetPositionValue);
    }
    if (daySelection?.position !== null && daySelection?.position !== undefined) {
        if (![1, 2, 3, 4, -1].includes(daySelection.position)
            || bySetPosition !== null && bySetPosition !== daySelection.position) {
            throw new ActiveSyncCalendarFieldError();
        }
        bySetPosition = daySelection.position;
    }

    let type: string;
    const recurrenceFields: ActiveSyncCalendarNode[] = [];
    if (event.recurrence.frequency === 'DAILY') {
        if (dayOfMonth !== null || monthOfYear !== null || bySetPosition !== null
            || daySelection?.position !== null && daySelection?.position !== undefined) {
            throw new ActiveSyncCalendarFieldError();
        }
        type = '0';
        if (daySelection) recurrenceFields.push({ tag: 'DayOfWeek', page: 4, content: String(daySelection.mask) });
    } else if (event.recurrence.frequency === 'WEEKLY') {
        if (dayOfMonth !== null || monthOfYear !== null || bySetPosition !== null
            || daySelection?.position !== null && daySelection?.position !== undefined) {
            throw new ActiveSyncCalendarFieldError();
        }
        type = '1';
        recurrenceFields.push({ tag: 'DayOfWeek', page: 4, content: String(daySelection?.mask || 1 << wall.weekday) });
    } else if (event.recurrence.frequency === 'MONTHLY') {
        if (monthOfYear !== null || dayOfMonth !== null && daySelection) throw new ActiveSyncCalendarFieldError();
        if (daySelection) {
            if (bySetPosition === null) throw new ActiveSyncCalendarFieldError();
            type = '3';
            recurrenceFields.push(
                { tag: 'DayOfWeek', page: 4, content: String(daySelection.mask) },
                { tag: 'WeekOfMonth', page: 4, content: String(bySetPosition === -1 ? 5 : bySetPosition) },
            );
        } else {
            if (bySetPosition !== null) throw new ActiveSyncCalendarFieldError();
            type = '2';
            recurrenceFields.push({ tag: 'DayOfMonth', page: 4, content: String(dayOfMonth || wall.day) });
        }
    } else {
        if (dayOfMonth !== null && daySelection) throw new ActiveSyncCalendarFieldError();
        if (daySelection) {
            if (monthOfYear === null || bySetPosition === null) throw new ActiveSyncCalendarFieldError();
            type = '6';
            recurrenceFields.push(
                { tag: 'DayOfWeek', page: 4, content: String(daySelection.mask) },
                { tag: 'WeekOfMonth', page: 4, content: String(bySetPosition === -1 ? 5 : bySetPosition) },
                { tag: 'MonthOfYear', page: 4, content: String(monthOfYear) },
            );
        } else {
            if (bySetPosition !== null) throw new ActiveSyncCalendarFieldError();
            if ((dayOfMonth === null) !== (monthOfYear === null)) throw new ActiveSyncCalendarFieldError();
            type = '5';
            recurrenceFields.push(
                { tag: 'DayOfMonth', page: 4, content: String(dayOfMonth || wall.day) },
                { tag: 'MonthOfYear', page: 4, content: String(monthOfYear || wall.month) },
            );
        }
    }

    if (type === '6' && event.activeSyncRecurrenceDayOfWeekOmitted) {
        const dayOfWeekIndex = recurrenceFields.findIndex(field => field.tag === 'DayOfWeek');
        if (dayOfWeekIndex >= 0) recurrenceFields.splice(dayOfWeekIndex, 1);
    }
    if (['2', '3', '5', '6'].includes(type)) {
        const calendarType = event.activeSyncCalendarType ?? '1';
        if (!/^(?:[0-9]|1[0-2]|14|15|20)$/.test(calendarType)) throw new ActiveSyncCalendarFieldError();
        recurrenceFields.push({ tag: 'CalendarType', page: 4, content: calendarType });
        if (['5', '6'].includes(type) && event.activeSyncIsLeapMonth !== undefined) {
            if (!/^[01]$/.test(event.activeSyncIsLeapMonth)) throw new ActiveSyncCalendarFieldError();
            recurrenceFields.push({ tag: 'IsLeapMonth', page: 4, content: event.activeSyncIsLeapMonth });
        }
    }

    const children: ActiveSyncCalendarNode[] = [
        { tag: 'Type', page: 4, content: type },
        { tag: 'Interval', page: 4, content: String(Math.max(1, event.recurrence.interval || 1)) },
        ...recurrenceFields,
    ];
    const firstDay = parts.get('WKST');
    if (firstDay) {
        const index = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'].indexOf(firstDay);
        if (index < 0) throw new ActiveSyncCalendarFieldError();
        children.push({ tag: 'FirstDayOfWeek', page: 4, content: String(index) });
    }
    if (event.recurrence.count) {
        if (event.recurrence.count > 999) throw new ActiveSyncCalendarFieldError();
        children.push({ tag: 'Occurrences', page: 4, content: String(event.recurrence.count) });
    } else if (event.recurrence.until) {
        children.push({ tag: 'Until', page: 4, content: formatActiveSyncDate(event.recurrence.until) });
    }
    return { tag: 'Recurrence', page: 4, children };
}

export function calendarEventToActiveSyncApplicationData(event: ParsedIcalEvent): ActiveSyncCalendarNode[] {
    const applicationData: ActiveSyncCalendarNode[] = [
        { tag: 'Subject', page: 4, content: boundedCalendarText(event.title) },
        { tag: 'UID', page: 4, content: boundedCalendarText(event.uid, 300) },
        { tag: 'StartTime', page: 4, content: formatActiveSyncDate(event.start) },
        { tag: 'EndTime', page: 4, content: formatActiveSyncDate(event.end) },
        { tag: 'DtStamp', page: 4, content: formatActiveSyncDate(event.dtstamp) },
        { tag: 'AllDayEvent', page: 4, content: event.isAllDay ? '1' : '0' },
        { tag: 'BusyStatus', page: 4, content: event.activeSyncBusyStatus || (event.busyStatus === 'free' ? '0' : '2') },
        { tag: 'Sensitivity', page: 4, content: event.sensitivity || '0' },
        { tag: 'MeetingStatus', page: 4, content: event.meetingStatus || '0' },
    ];

    if (!event.isAllDay && event.timeKind === 'zoned' && event.timeZone) {
        const timeZone = encodeActiveSyncTimeZone(event.timeZone, event.start);
        if (timeZone) applicationData.unshift({ tag: 'TimeZone', page: 4, content: timeZone });
    }

    if (event.location) applicationData.push({ tag: 'Location', page: 4, content: boundedCalendarText(event.location) });
    if (event.organizerEmail) {
        applicationData.push({ tag: 'OrganizerEmail', page: 4, content: boundedCalendarText(event.organizerEmail, 1024) });
        if (event.organizerName) applicationData.push({ tag: 'OrganizerName', page: 4, content: boundedCalendarText(event.organizerName) });
    }
    const attendees: Array<{ email: string; name?: string; status?: string; type?: string }> = event.activeSyncAttendees?.length
        ? event.activeSyncAttendees.slice(0, 128)
        : String(event.attendees || '').split(/,\s*/).filter(Boolean).slice(0, 128).map(email => ({ email }));
    if (attendees.length) {
        applicationData.push({ tag: 'Attendees', page: 4, children: attendees.map(attendee => ({
            tag: 'Attendee', page: 4, children: [
                { tag: 'Email', page: 4, content: boundedCalendarText(attendee.email, 1024) },
                ...(attendee.name ? [{ tag: 'Name', page: 4, content: boundedCalendarText(attendee.name) }] : []),
                ...(attendee.status ? [{ tag: 'AttendeeStatus', page: 4, content: attendee.status }] : []),
                ...(attendee.type ? [{ tag: 'AttendeeType', page: 4, content: attendee.type }] : []),
            ],
        })) });
    }
    if (event.categories?.length) {
        applicationData.push({ tag: 'Categories', page: 4, children: event.categories.slice(0, 128).map(category => ({
            tag: 'Category', page: 4, content: boundedCalendarText(category, MAX_ACTIVE_SYNC_CALENDAR_CATEGORY_BYTES),
        })) });
    }
    if (event.notifications?.[0]) {
        applicationData.push({ tag: 'Reminder', page: 4, content: String(Math.max(0, Math.floor(event.notifications[0].time))) });
    }
    if (event.responseRequested !== undefined) {
        applicationData.push({ tag: 'ResponseRequested', page: 4, content: event.responseRequested ? '1' : '0' });
    }
    if (event.disallowNewTimeProposal !== undefined) {
        applicationData.push({
            tag: 'DisallowNewTimeProposal', page: 4,
            content: event.disallowNewTimeProposal ? '1' : '0',
        });
    }
    if (event.description) {
        const body = truncateCalendarBody(event.description);
        applicationData.push({
            tag: 'Body',
            page: 17,
            children: [
                { tag: 'Type', page: 17, content: '1' },
                { tag: 'Data', page: 17, content: body.data },
                { tag: 'EstimatedDataSize', page: 17, content: String(body.bytes) },
                ...(body.truncated ? [{ tag: 'Truncated', page: 17, content: '1' }] : []),
            ],
        });
    }
    const recurrence = activeSyncRecurrence(event);
    if (recurrence) applicationData.push(recurrence);
    if (event.recurrenceExceptionOverflow) throw new ActiveSyncCalendarFieldError();
    const exceptionNodesByOccurrence = new Map<string, ActiveSyncCalendarNode>();
    for (const occurrenceId of event.excludedOccurrenceIds || []) {
        exceptionNodesByOccurrence.set(occurrenceId, {
            tag: 'Exception', page: 4, children: [
                { tag: 'Deleted', page: 4, content: '1' },
                { tag: 'ExceptionStartTime', page: 4, content: occurrenceId },
            ],
        });
    }
    for (const exception of event.recurrenceExceptions || []) {
        const occurrenceId = formatActiveSyncDate(exception.recurrenceId);
        if (exception.deleted) {
            exceptionNodesByOccurrence.set(occurrenceId, {
                tag: 'Exception', page: 4, children: [
                    { tag: 'Deleted', page: 4, content: '1' },
                    { tag: 'ExceptionStartTime', page: 4, content: occurrenceId },
                ],
            });
            continue;
        }
        if (!exception.event) continue;
        const exceptionEvent = exception.event;
        const children: ActiveSyncCalendarNode[] = [
            { tag: 'ExceptionStartTime', page: 4, content: occurrenceId },
            { tag: 'AllDayEvent', page: 4, content: exceptionEvent.isAllDay ? '1' : '0' },
            { tag: 'StartTime', page: 4, content: formatActiveSyncDate(exceptionEvent.start) },
            { tag: 'EndTime', page: 4, content: formatActiveSyncDate(exceptionEvent.end) },
            { tag: 'Subject', page: 4, content: boundedCalendarText(exceptionEvent.title, MAX_ACTIVE_SYNC_CALENDAR_EXCEPTION_TEXT_BYTES) },
        ];
        if (exceptionEvent.location !== event.location) {
            children.push({
                tag: 'Location', page: 4,
                content: boundedCalendarText(exceptionEvent.location, MAX_ACTIVE_SYNC_CALENDAR_EXCEPTION_TEXT_BYTES),
            });
        }
        if (exceptionEvent.description !== event.description) {
            const body = truncateCalendarBody(exceptionEvent.description);
            children.push({
                tag: 'Body', page: 17, children: [
                    { tag: 'Type', page: 17, content: '1' },
                    { tag: 'Data', page: 17, content: body.data },
                    { tag: 'EstimatedDataSize', page: 17, content: String(body.bytes) },
                    ...(body.truncated ? [{ tag: 'Truncated', page: 17, content: '1' }] : []),
                ],
            });
        }
        const masterCategories = event.categories || [];
        const exceptionCategories = exceptionEvent.categories || [];
        if (JSON.stringify(exceptionCategories) !== JSON.stringify(masterCategories)) {
            children.push({ tag: 'Categories', page: 4, children: exceptionCategories.slice(0, 128).map(category => ({
                tag: 'Category', page: 4,
                content: boundedCalendarText(category, MAX_ACTIVE_SYNC_CALENDAR_CATEGORY_BYTES),
            })) });
        }
        if (exceptionEvent.sensitivity !== event.sensitivity) {
            children.push({ tag: 'Sensitivity', page: 4, content: exceptionEvent.sensitivity || '0' });
        }
        if (exceptionEvent.activeSyncBusyStatus !== event.activeSyncBusyStatus) {
            children.push({
                tag: 'BusyStatus', page: 4,
                content: exceptionEvent.activeSyncBusyStatus || (exceptionEvent.busyStatus === 'free' ? '0' : '2'),
            });
        }
        if (exceptionEvent.dtstamp.getTime() !== event.dtstamp.getTime()) {
            children.push({ tag: 'DtStamp', page: 4, content: formatActiveSyncDate(exceptionEvent.dtstamp) });
        }
        if (exceptionEvent.meetingStatus !== event.meetingStatus) {
            children.push({ tag: 'MeetingStatus', page: 4, content: exceptionEvent.meetingStatus || '0' });
        }
        const exceptionAttendees: ActiveSyncCalendarAttendee[] = exceptionEvent.activeSyncAttendees !== undefined
            ? exceptionEvent.activeSyncAttendees
            : String(exceptionEvent.attendees || '').split(/,\s*/).filter(Boolean)
                .map((email): ActiveSyncCalendarAttendee => ({ email }));
        if (JSON.stringify(exceptionAttendees) !== JSON.stringify(attendees)) {
            children.push({ tag: 'Attendees', page: 4, children: exceptionAttendees.slice(0, 128).map(attendee => ({
                tag: 'Attendee', page: 4, children: [
                    { tag: 'Email', page: 4, content: boundedCalendarText(attendee.email, 1024) },
                    ...(attendee.name ? [{ tag: 'Name', page: 4, content: boundedCalendarText(attendee.name) }] : []),
                    ...(attendee.status ? [{ tag: 'AttendeeStatus', page: 4, content: attendee.status }] : []),
                    ...(attendee.type ? [{ tag: 'AttendeeType', page: 4, content: attendee.type }] : []),
                ],
            })) });
        }
        const exceptionReminder = exceptionEvent.notifications?.[0]?.time;
        if (exceptionReminder === undefined && event.notifications?.[0]) {
            children.push({ tag: 'Reminder', page: 4, content: '' });
        } else if (exceptionReminder !== undefined && exceptionReminder !== event.notifications?.[0]?.time) {
            children.push({ tag: 'Reminder', page: 4, content: String(Math.max(0, Math.floor(exceptionReminder))) });
        }
        exceptionNodesByOccurrence.set(occurrenceId, { tag: 'Exception', page: 4, children });
    }
    if (exceptionNodesByOccurrence.size > MAX_ACTIVE_SYNC_CALENDAR_EXCEPTIONS) {
        throw new ActiveSyncCalendarFieldError();
    }
    const exceptionNodes = [...exceptionNodesByOccurrence.values()];
    if (exceptionNodes.length > 0) applicationData.push({ tag: 'Exceptions', page: 4, children: exceptionNodes });
    return applicationData;
}

export function storedIcalEventToActiveSyncApplicationData(
    storageUid: string,
    ical: string,
): ActiveSyncCalendarNode[] {
    try {
        const event = parseIcalEvent(storageUid, ical);
        const dates = [event.start, event.end, event.dtstamp,
            ...(event.recurrenceExceptions || []).flatMap(exception => [
                exception.recurrenceId,
                ...(exception.event ? [exception.event.start, exception.event.end, exception.event.dtstamp] : []),
            ])];
        if (dates.some(date => {
            if (!(date instanceof Date) || !Number.isFinite(date.getTime())) return true;
            try {
                return !/^\d{8}T\d{6}Z$/.test(formatActiveSyncDate(date));
            } catch {
                return true;
            }
        })) {
            throw new ActiveSyncCalendarFieldError();
        }
        return calendarEventToActiveSyncApplicationData(event);
    } catch (error) {
        if (error instanceof ActiveSyncCalendarFieldError) throw error;
        if (error instanceof RangeError) throw new ActiveSyncCalendarFieldError();
        throw error;
    }
}
