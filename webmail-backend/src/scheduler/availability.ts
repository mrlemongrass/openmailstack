export interface AvailabilityWindow {
    weekday: number;
    startMinute: number;
    endMinute: number;
}

export interface AvailabilityOverride {
    date: string;
    windows: Array<Pick<AvailabilityWindow, 'startMinute' | 'endMinute'>>;
}

export interface BusyInterval {
    start: Date;
    end: Date;
}

export interface AvailabilityRequest {
    timeZone: string;
    rangeStart: Date;
    rangeEnd: Date;
    durationMinutes: number;
    intervalMinutes: number;
    windows: AvailabilityWindow[];
    overrides?: AvailabilityOverride[];
    busy?: BusyInterval[];
    bufferBeforeMinutes?: number;
    bufferAfterMinutes?: number;
    minimumNoticeMinutes?: number;
    now?: Date;
}

export interface AvailabilitySlot {
    start: Date;
    end: Date;
}

export interface LocalAvailabilitySlot {
    timeZone: string;
    startDate: string;
    startMinute: number;
    endDate: string;
    endMinute: number;
}

interface LocalParts {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
    second: number;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

const formatterFor = (timeZone: string): Intl.DateTimeFormat => {
    let formatter = formatterCache.get(timeZone);
    if (!formatter) {
        formatter = new Intl.DateTimeFormat('en-US', {
            timeZone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hourCycle: 'h23',
        });
        formatterCache.set(timeZone, formatter);
    }
    return formatter;
};

const localPartsAt = (instant: Date, timeZone: string): LocalParts => {
    const parts = formatterFor(timeZone).formatToParts(instant);
    const values = new Map(parts.map((part) => [part.type, part.value]));
    return {
        year: Number(values.get('year')),
        month: Number(values.get('month')),
        day: Number(values.get('day')),
        hour: Number(values.get('hour')),
        minute: Number(values.get('minute')),
        second: Number(values.get('second')),
    };
};

const dateKey = ({ year, month, day }: Pick<LocalParts, 'year' | 'month' | 'day'>): string => (
    `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
);

const parseDateKey = (value: string): Pick<LocalParts, 'year' | 'month' | 'day'> => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) throw new Error(`Invalid local date: ${value}`);
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const probe = new Date(Date.UTC(year, month - 1, day));
    if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) {
        throw new Error(`Invalid local date: ${value}`);
    }
    return { year, month, day };
};

const addLocalDays = (value: string, days: number): string => {
    const parsed = parseDateKey(value);
    const date = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day + days));
    return dateKey({ year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() });
};

const offsetAt = (instant: Date, timeZone: string): number => {
    const parts = localPartsAt(instant, timeZone);
    const renderedAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    return renderedAsUtc - Math.floor(instant.getTime() / 1000) * 1000;
};

const possibleInstants = (localDate: string, minuteOfDay: number, timeZone: string): Date[] => {
    const parsed = parseDateKey(localDate);
    const hour = Math.floor(minuteOfDay / 60);
    const minute = minuteOfDay % 60;
    const localAsUtc = Date.UTC(parsed.year, parsed.month - 1, parsed.day, hour, minute);
    const offsets = new Set<number>();

    for (let sampleHours = -36; sampleHours <= 36; sampleHours += 6) {
        offsets.add(offsetAt(new Date(localAsUtc + sampleHours * 60 * 60 * 1000), timeZone));
    }

    const matches: Date[] = [];
    for (const offset of offsets) {
        const candidate = new Date(localAsUtc - offset);
        const parts = localPartsAt(candidate, timeZone);
        if (
            parts.year === parsed.year
            && parts.month === parsed.month
            && parts.day === parsed.day
            && parts.hour === hour
            && parts.minute === minute
        ) {
            matches.push(candidate);
        }
    }

    return matches.sort((a, b) => a.getTime() - b.getTime());
};

const overlaps = (leftStart: number, leftEnd: number, rightStart: number, rightEnd: number): boolean => (
    leftStart < rightEnd && rightStart < leftEnd
);

const assertMinute = (name: string, value: number, allowEndOfDay = false): void => {
    const maximum = allowEndOfDay ? 1440 : 1439;
    if (!Number.isInteger(value) || value < 0 || value > maximum) {
        throw new Error(`${name} must be an integer between 0 and ${maximum}`);
    }
};

const validateRequest = (request: AvailabilityRequest): void => {
    if (!Number.isFinite(request.rangeStart.getTime()) || !Number.isFinite(request.rangeEnd.getTime())) {
        throw new Error('rangeStart and rangeEnd must be valid dates');
    }
    if (request.now && !Number.isFinite(request.now.getTime())) throw new Error('now must be a valid date');
    formatterFor(request.timeZone).format(request.rangeStart);
    if (request.rangeStart.getTime() >= request.rangeEnd.getTime()) throw new Error('rangeStart must be before rangeEnd');
    if (!Number.isInteger(request.durationMinutes) || request.durationMinutes <= 0) throw new Error('durationMinutes must be positive');
    if (!Number.isInteger(request.intervalMinutes) || request.intervalMinutes <= 0) throw new Error('intervalMinutes must be positive');
    for (const [name, value] of [
        ['bufferBeforeMinutes', request.bufferBeforeMinutes || 0],
        ['bufferAfterMinutes', request.bufferAfterMinutes || 0],
        ['minimumNoticeMinutes', request.minimumNoticeMinutes || 0],
    ] as const) {
        if (!Number.isInteger(value) || value < 0) throw new Error(`${name} must be a non-negative integer`);
    }
    for (const window of request.windows) {
        if (!Number.isInteger(window.weekday) || window.weekday < 0 || window.weekday > 6) throw new Error('weekday must be between 0 and 6');
        assertMinute('startMinute', window.startMinute);
        assertMinute('endMinute', window.endMinute, true);
        if (window.startMinute >= window.endMinute) throw new Error('availability windows must not cross midnight');
    }
    for (const override of request.overrides || []) {
        parseDateKey(override.date);
        for (const window of override.windows) {
            assertMinute('override startMinute', window.startMinute);
            assertMinute('override endMinute', window.endMinute, true);
            if (window.startMinute >= window.endMinute) throw new Error('availability override windows must not cross midnight');
        }
    }
    for (const interval of request.busy || []) {
        if (!Number.isFinite(interval.start.getTime()) || !Number.isFinite(interval.end.getTime())) {
            throw new Error('busy intervals must contain valid dates');
        }
        if (interval.start.getTime() >= interval.end.getTime()) throw new Error('busy interval start must be before end');
    }
};

export function calculateAvailability(request: AvailabilityRequest): AvailabilitySlot[] {
    validateRequest(request);
    const rangeStart = request.rangeStart.getTime();
    const rangeEnd = request.rangeEnd.getTime();
    const durationMs = request.durationMinutes * 60 * 1000;
    const bufferBeforeMs = (request.bufferBeforeMinutes || 0) * 60 * 1000;
    const bufferAfterMs = (request.bufferAfterMinutes || 0) * 60 * 1000;
    const earliestStart = (request.now || new Date()).getTime() + (request.minimumNoticeMinutes || 0) * 60 * 1000;
    const busy = (request.busy || []).map((interval) => ({
        start: interval.start.getTime(),
        end: interval.end.getTime(),
    }));
    const overrides = new Map((request.overrides || []).map((override) => [override.date, override.windows]));
    const slots = new Map<number, AvailabilitySlot>();

    let localDate = addLocalDays(dateKey(localPartsAt(request.rangeStart, request.timeZone)), -1);
    const finalLocalDate = addLocalDays(dateKey(localPartsAt(request.rangeEnd, request.timeZone)), 1);

    while (localDate <= finalLocalDate) {
        const parsed = parseDateKey(localDate);
        const weekday = new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day)).getUTCDay();
        const windows = overrides.has(localDate)
            ? overrides.get(localDate) || []
            : request.windows.filter((window) => window.weekday === weekday);

        for (const window of windows) {
            for (
                let startMinute = window.startMinute;
                startMinute + request.durationMinutes <= window.endMinute;
                startMinute += request.intervalMinutes
            ) {
                for (const start of possibleInstants(localDate, startMinute, request.timeZone)) {
                    const startMs = start.getTime();
                    const endMs = startMs + durationMs;
                    if (startMs < rangeStart || endMs > rangeEnd || startMs < earliestStart) continue;

                    const endParts = localPartsAt(new Date(endMs), request.timeZone);
                    const endLocalMinute = endParts.hour * 60 + endParts.minute;
                    const endDate = dateKey(endParts);
                    const endsAtLocalMidnight = window.endMinute === 1440
                        && endDate === addLocalDays(localDate, 1)
                        && endLocalMinute === 0;
                    if (!endsAtLocalMidnight && (endDate !== localDate || endLocalMinute > window.endMinute)) continue;

                    const occupiedStart = startMs - bufferBeforeMs;
                    const occupiedEnd = endMs + bufferAfterMs;
                    if (busy.some((interval) => overlaps(occupiedStart, occupiedEnd, interval.start, interval.end))) continue;

                    slots.set(startMs, { start, end: new Date(endMs) });
                }
            }
        }

        localDate = addLocalDays(localDate, 1);
    }

    return Array.from(slots.values()).sort((a, b) => a.start.getTime() - b.start.getTime());
}

export function projectAvailabilitySlot(slot: AvailabilitySlot, timeZone: string): LocalAvailabilitySlot {
    if (!Number.isFinite(slot.start.getTime()) || !Number.isFinite(slot.end.getTime())) {
        throw new Error('slot start and end must be valid dates');
    }
    if (slot.start.getTime() >= slot.end.getTime()) throw new Error('slot start must be before end');
    formatterFor(timeZone).format(slot.start);
    const start = localPartsAt(slot.start, timeZone);
    const end = localPartsAt(slot.end, timeZone);
    return {
        timeZone,
        startDate: dateKey(start),
        startMinute: start.hour * 60 + start.minute,
        endDate: dateKey(end),
        endMinute: end.hour * 60 + end.minute,
    };
}
