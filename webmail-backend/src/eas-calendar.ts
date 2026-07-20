import { formatActiveSyncDate, type ParsedIcalEvent, parseIcalEvent } from './calendar-format';
import { encodeActiveSyncTimeZone, formatIcalWallTime, resolveActiveSyncTimeZone } from './eas-timezone';

export interface ActiveSyncCalendarNode {
    tag: string;
    page: number;
    content?: string;
    children?: ActiveSyncCalendarNode[];
}

const nodeText = (node: any): string => node?.content ? node.content.toString() : '';
const childNode = (node: any, tag: string): any => node?.children?.find((child: any) => child.tag === tag);
const childText = (node: any, tag: string): string => nodeText(childNode(node, tag));
const firstNonEmpty = (...values: string[]): string => values.map(value => value.trim()).find(Boolean) || '';

function icalEscape(value: string): string {
    return value
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

    const compact = trimmed.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(?:\.\d+)?Z?$/);
    if (compact) {
        return new Date(Date.UTC(
            Number(compact[1]),
            Number(compact[2]) - 1,
            Number(compact[3]),
            Number(compact[4]),
            Number(compact[5]),
            Number(compact[6])
        ));
    }

    const dateOnly = trimmed.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (dateOnly) {
        return new Date(Date.UTC(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]), 0, 0, 0));
    }

    const parsed = new Date(trimmed);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatIcalDateOnly(date: Date): string {
    return date.toISOString().slice(0, 10).replace(/-/g, '');
}

export function activeSyncCalendarApplicationDataToIcal(uid: string, applicationData: any, existingIcal = ''): string {
    const existing = existingIcal ? parseIcalEvent(uid, existingIcal) : null;
    const body = childNode(applicationData, 'Body');
    const allDayText = childText(applicationData, 'AllDayEvent');
    const isAllDay = allDayText ? allDayText === '1' : Boolean(existing?.isAllDay);
    const start = parseActiveSyncCalendarDate(childText(applicationData, 'StartTime')) || existing?.start || new Date();
    const fallbackEnd = new Date(start.getTime() + (isAllDay ? 24 * 60 * 60 * 1000 : 60 * 60 * 1000));
    let end = parseActiveSyncCalendarDate(childText(applicationData, 'EndTime')) || existing?.end || fallbackEnd;
    if (end.getTime() <= start.getTime()) end = fallbackEnd;

    const subject = firstNonEmpty(childText(applicationData, 'Subject'), existing?.title || '', 'Untitled');
    const location = firstNonEmpty(childText(applicationData, 'Location'), existing?.location || '');
    const description = firstNonEmpty(childText(body, 'Data'), childText(applicationData, 'Description'), existing?.description || '');
    const dtstamp = parseActiveSyncCalendarDate(childText(applicationData, 'DtStamp')) || existing?.dtstamp || new Date();
    const timeZoneValue = childText(applicationData, 'Timezone');
    const timeZone = isAllDay
        ? null
        : timeZoneValue
            ? resolveActiveSyncTimeZone(timeZoneValue, start)
            : existing?.timeZone || null;

    let rruleLine = existing?.recurrence?.raw || '';
    const recurrenceNode = childNode(applicationData, 'Recurrence');
    if (recurrenceNode) {
        const recType = childText(recurrenceNode, 'Type');
        const interval = childText(recurrenceNode, 'Interval') || '1';
        const until = childText(recurrenceNode, 'Until');
        const occurrences = childText(recurrenceNode, 'Occurrences');
        const freqMap: Record<string, string> = { '0': 'DAILY', '1': 'WEEKLY', '2': 'MONTHLY', '5': 'YEARLY' };
        const freq = freqMap[recType] || 'DAILY';
        let rrule = `RRULE:FREQ=${freq}`;
        if (interval !== '1') rrule += `;INTERVAL=${interval}`;
        if (until) rrule += `;UNTIL=${until.replace(/[^0-9TZ]/g, '')}`;
        if (occurrences) rrule += `;COUNT=${occurrences}`;
        rruleLine = rrule;
    }

    const lines = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//OpenMailStack//ActiveSync Calendar//EN',
        'BEGIN:VEVENT',
        `UID:${icalEscape(uid)}`,
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
    lines.push('TRANSP:OPAQUE');
    lines.push('END:VEVENT');
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

function activeSyncRecurrence(event: ParsedIcalEvent): ActiveSyncCalendarNode | null {
    if (!event.recurrence) return null;
    const type = { DAILY: '0', WEEKLY: '1', MONTHLY: '2', YEARLY: '5' }[event.recurrence.frequency];
    const wall = recurrenceWallParts(event);
    const children: ActiveSyncCalendarNode[] = [
        { tag: 'Type', page: 4, content: type },
        { tag: 'Interval', page: 4, content: String(event.recurrence.interval) },
    ];
    if (event.recurrence.frequency === 'WEEKLY') {
        children.push({ tag: 'DayOfWeek', page: 4, content: String(1 << wall.weekday) });
    }
    if (event.recurrence.frequency === 'MONTHLY' || event.recurrence.frequency === 'YEARLY') {
        children.push({ tag: 'DayOfMonth', page: 4, content: String(wall.day) });
    }
    if (event.recurrence.frequency === 'YEARLY') {
        children.push({ tag: 'MonthOfYear', page: 4, content: String(wall.month) });
    }
    if (event.recurrence.count) {
        children.push({ tag: 'Occurrences', page: 4, content: String(Math.min(999, event.recurrence.count)) });
    } else if (event.recurrence.until) {
        children.push({ tag: 'Until', page: 4, content: formatActiveSyncDate(event.recurrence.until) });
    }
    return { tag: 'Recurrence', page: 4, children };
}

export function calendarEventToActiveSyncApplicationData(event: ParsedIcalEvent): ActiveSyncCalendarNode[] {
    const applicationData: ActiveSyncCalendarNode[] = [
        { tag: 'Subject', page: 4, content: event.title },
        { tag: 'UID', page: 4, content: event.uid },
        { tag: 'StartTime', page: 4, content: formatActiveSyncDate(event.start) },
        { tag: 'EndTime', page: 4, content: formatActiveSyncDate(event.end) },
        { tag: 'DtStamp', page: 4, content: formatActiveSyncDate(event.dtstamp) },
        { tag: 'AllDayEvent', page: 4, content: event.isAllDay ? '1' : '0' },
        { tag: 'BusyStatus', page: 4, content: event.busyStatus === 'free' ? '0' : '2' },
        { tag: 'Sensitivity', page: 4, content: '0' },
        { tag: 'MeetingStatus', page: 4, content: '0' },
    ];

    if (!event.isAllDay && event.timeKind === 'zoned' && event.timeZone) {
        const timeZone = encodeActiveSyncTimeZone(event.timeZone, event.start);
        if (timeZone) applicationData.unshift({ tag: 'Timezone', page: 4, content: timeZone });
    }

    if (event.location) applicationData.push({ tag: 'Location', page: 4, content: event.location });
    if (event.description) {
        applicationData.push({
            tag: 'Body',
            page: 17,
            children: [
                { tag: 'Type', page: 17, content: '1' },
                { tag: 'Data', page: 17, content: event.description },
                { tag: 'EstimatedDataSize', page: 17, content: String(event.description.length) },
            ],
        });
    }
    const recurrence = activeSyncRecurrence(event);
    if (recurrence) applicationData.push(recurrence);
    return applicationData;
}
