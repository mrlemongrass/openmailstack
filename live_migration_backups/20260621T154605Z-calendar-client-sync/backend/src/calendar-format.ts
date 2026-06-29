import { createHash } from 'crypto';

export interface ParsedIcalEvent {
    uid: string;
    title: string;
    location: string;
    description: string;
    start: Date;
    end: Date;
    isAllDay: boolean;
    dtstamp: Date;
}

export function slugifyCalendarName(name: string): string {
    const slug = name
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80);
    return slug || 'calendar';
}

function unfoldIcal(ical: string): string[] {
    const lines = ical.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    const unfolded: string[] = [];
    for (const line of lines) {
        if (/^[ \t]/.test(line) && unfolded.length > 0) {
            unfolded[unfolded.length - 1] += line.slice(1);
        } else {
            unfolded.push(line);
        }
    }
    return unfolded;
}

function firstIcalValue(lines: string[], name: string): { value: string; params: string } | null {
    const prefix = `${name.toUpperCase()}`;
    for (const line of lines) {
        const idx = line.indexOf(':');
        if (idx === -1) continue;
        const left = line.slice(0, idx);
        const tag = left.split(';')[0].toUpperCase();
        if (tag !== prefix) continue;
        return { params: left.slice(tag.length), value: line.slice(idx + 1) };
    }
    return null;
}

function unescapeIcalText(value: string): string {
    return value
        .replace(/\\n/gi, '\n')
        .replace(/\\,/g, ',')
        .replace(/\\;/g, ';')
        .replace(/\\\\/g, '\\');
}

function parseIcalDate(value: string, allDay: boolean): Date {
    if (!value) return new Date();
    const compact = value.trim();
    const year = Number(compact.slice(0, 4));
    const month = Number(compact.slice(4, 6)) - 1;
    const day = Number(compact.slice(6, 8));

    if (allDay || compact.length === 8) {
        return new Date(Date.UTC(year, month, day, 0, 0, 0));
    }

    const hour = Number(compact.slice(9, 11)) || 0;
    const minute = Number(compact.slice(11, 13)) || 0;
    const second = Number(compact.slice(13, 15)) || 0;
    return new Date(Date.UTC(year, month, day, hour, minute, second));
}

export function parseIcalEvent(uid: string, ical: string): ParsedIcalEvent {
    const lines = unfoldIcal(ical);
    const startField = firstIcalValue(lines, 'DTSTART');
    const endField = firstIcalValue(lines, 'DTEND');
    const allDay = Boolean(startField?.params.includes('VALUE=DATE') || startField?.value.length === 8);
    const start = parseIcalDate(startField?.value || '', allDay);
    const fallbackEnd = new Date(start.getTime() + (allDay ? 24 * 60 * 60 * 1000 : 60 * 60 * 1000));

    return {
        uid: firstIcalValue(lines, 'UID')?.value || uid,
        title: unescapeIcalText(firstIcalValue(lines, 'SUMMARY')?.value || 'Untitled'),
        location: unescapeIcalText(firstIcalValue(lines, 'LOCATION')?.value || ''),
        description: unescapeIcalText(firstIcalValue(lines, 'DESCRIPTION')?.value || ''),
        start,
        end: endField?.value ? parseIcalDate(endField.value, allDay) : fallbackEnd,
        isAllDay: allDay,
        dtstamp: parseIcalDate(firstIcalValue(lines, 'DTSTAMP')?.value || '', false)
    };
}

export function formatActiveSyncDate(date: Date): string {
    return date.toISOString().replace(/\.\d{3}Z$/, '.000Z');
}

export function getCalendarFolderSyncKey(folders: Array<{ serverId: string; displayName: string; type: string }>): string {
    const signature = folders
        .map(folder => `${folder.serverId}\t${folder.displayName}\t${folder.type}`)
        .sort()
        .join('\n');
    return `oms-${createHash('sha1').update(signature).digest('hex').slice(0, 12)}`;
}
