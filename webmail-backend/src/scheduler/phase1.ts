import crypto from 'crypto';

const RESERVED_HANDLES = new Set([
    'action', 'admin', 'api', 'auth', 'calendar', 'carddav', 'contacts', 'mail', 'notes',
    'public', 'scheduler', 'settings', 'socket.io', 'sync', 'uploads', 'webmail',
]);

export interface SchedulerEventInput {
    title: string;
    slug?: string;
    description?: string;
    durationMinutes?: number;
    intervalMinutes?: number;
    bufferBeforeMinutes?: number;
    bufferAfterMinutes?: number;
    minimumNoticeMinutes?: number;
    capacity?: number;
    locationType?: 'in_person' | 'phone' | 'custom' | 'conference';
    locationLabel?: string;
    destinationCalendarId?: number | null;
    conflictCalendarIds?: number[];
    availabilityScheduleId?: string | null;
    active?: boolean;
    windows?: Array<{ weekday: number; startMinute: number; endMinute: number }>;
}

export interface BookingCalendarEvent {
    uid: string;
    title: string;
    description: string;
    location: string;
    start: Date;
    end: Date;
    hostEmail: string;
    bookerName: string;
    bookerEmail: string;
    sequence: number;
    cancelled?: boolean;
}

const cleanSlug = (value: string, fallback: string): string => {
    const slug = value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80);
    return slug || fallback;
};

export function normalizeSchedulerHandle(value: string): string {
    const handle = cleanSlug(value, '');
    if (!handle || handle.length < 2) throw new Error('Scheduler handle must contain at least two letters or numbers');
    if (RESERVED_HANDLES.has(handle)) throw new Error('That Scheduler handle is reserved');
    return handle;
}

export function defaultSchedulerHandle(username: string): string {
    const separator = username.lastIndexOf('@');
    if (separator <= 0) throw new Error('Scheduler username must be a full mailbox address');
    return normalizeSchedulerHandle(username.slice(0, separator));
}

export function normalizeSchedulerEventInput(input: SchedulerEventInput): Required<Omit<SchedulerEventInput, 'destinationCalendarId'>> & { destinationCalendarId: number | null } {
    const title = String(input.title || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 160);
    if (!title) throw new Error('Event title is required');
    const durationMinutes = Number(input.durationMinutes ?? 30);
    const intervalMinutes = Number(input.intervalMinutes ?? durationMinutes);
    const bufferBeforeMinutes = Number(input.bufferBeforeMinutes ?? 0);
    const bufferAfterMinutes = Number(input.bufferAfterMinutes ?? 0);
    const minimumNoticeMinutes = Number(input.minimumNoticeMinutes ?? 60);
    const capacity = Number(input.capacity ?? 1);
    for (const [name, value, minimum, maximum] of [
        ['durationMinutes', durationMinutes, 5, 1440],
        ['intervalMinutes', intervalMinutes, 5, 1440],
        ['bufferBeforeMinutes', bufferBeforeMinutes, 0, 1440],
        ['bufferAfterMinutes', bufferAfterMinutes, 0, 1440],
        ['minimumNoticeMinutes', minimumNoticeMinutes, 0, 525600],
        ['capacity', capacity, 1, 1000],
    ] as const) {
        if (!Number.isInteger(value) || value < minimum || value > maximum) {
            throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
        }
    }
    const windows = input.windows || [1, 2, 3, 4, 5].map((weekday) => ({ weekday, startMinute: 540, endMinute: 1020 }));
    for (const window of windows) {
        if (!Number.isInteger(window.weekday) || window.weekday < 0 || window.weekday > 6) throw new Error('Invalid availability weekday');
        if (!Number.isInteger(window.startMinute) || !Number.isInteger(window.endMinute)
            || window.startMinute < 0 || window.endMinute > 1440 || window.startMinute >= window.endMinute) {
            throw new Error('Invalid availability window');
        }
    }
    const conflictCalendarIds = Array.from(new Set((input.conflictCalendarIds || [])
        .map(Number)
        .filter((id) => Number.isInteger(id) && id > 0)));
    const destinationCalendarId = input.destinationCalendarId == null ? null : Number(input.destinationCalendarId);
    if (destinationCalendarId !== null && (!Number.isInteger(destinationCalendarId) || destinationCalendarId <= 0)) {
        throw new Error('Invalid destination calendar');
    }
    const locationType = input.locationType || 'custom';
    if (!['in_person', 'phone', 'custom', 'conference'].includes(locationType)) throw new Error('Invalid location type');
    const availabilityScheduleId = input.availabilityScheduleId == null ? null : String(input.availabilityScheduleId).trim();
    if (availabilityScheduleId !== null && !/^[0-9a-f-]{36}$/i.test(availabilityScheduleId)) throw new Error('Invalid availability schedule');
    return {
        title,
        slug: cleanSlug(input.slug || title, 'meeting'),
        description: String(input.description || '').trim().slice(0, 4000),
        durationMinutes,
        intervalMinutes,
        bufferBeforeMinutes,
        bufferAfterMinutes,
        minimumNoticeMinutes,
        capacity,
        locationType,
        locationLabel: String(input.locationLabel || '').trim().slice(0, 255),
        destinationCalendarId,
        conflictCalendarIds,
        availabilityScheduleId,
        active: input.active !== false,
        windows,
    };
}

export function assertTimeZone(timeZone: string): string {
    const normalized = String(timeZone || '').trim();
    if (!normalized) throw new Error('Time zone is required');
    new Intl.DateTimeFormat('en-US', { timeZone: normalized }).format(new Date());
    return normalized;
}

export const schedulerTokenHash = (token: string): string => crypto.createHash('sha256').update(token).digest('hex');
export const createSchedulerToken = (): string => crypto.randomBytes(32).toString('base64url');

const icalEscape = (value: string): string => value
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,');

const icalDate = (date: Date): string => date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');

export function buildSchedulerCalendarEvent(event: BookingCalendarEvent): string {
    const lines = [
        'BEGIN:VCALENDAR',
        'VERSION:2.0',
        'PRODID:-//OpenMailStack//OMS Scheduler//EN',
        'CALSCALE:GREGORIAN',
        `METHOD:${event.cancelled ? 'CANCEL' : 'PUBLISH'}`,
        'BEGIN:VEVENT',
        `UID:${icalEscape(event.uid)}`,
        `DTSTAMP:${icalDate(new Date())}`,
        `DTSTART:${icalDate(event.start)}`,
        `DTEND:${icalDate(event.end)}`,
        `SEQUENCE:${event.sequence}`,
        `STATUS:${event.cancelled ? 'CANCELLED' : 'CONFIRMED'}`,
        `SUMMARY:${icalEscape(event.title)}`,
        `DESCRIPTION:${icalEscape(event.description)}`,
        `ORGANIZER:mailto:${icalEscape(event.hostEmail)}`,
        `ATTENDEE;CN=${icalEscape(event.bookerName)}:mailto:${icalEscape(event.bookerEmail)}`,
        'TRANSP:OPAQUE',
    ];
    if (event.location) lines.push(`LOCATION:${icalEscape(event.location)}`);
    lines.push('END:VEVENT', 'END:VCALENDAR', '');
    return lines.join('\r\n');
}

export function schedulerPublicUrl(baseUrl: string, handle: string, slug?: string): string {
    const base = baseUrl.replace(/\/$/, '');
    return `${base}/scheduler/${encodeURIComponent(handle)}${slug ? `/${encodeURIComponent(slug)}` : ''}`;
}
