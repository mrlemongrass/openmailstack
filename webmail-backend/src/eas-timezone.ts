interface SystemTimeRule {
    year: number;
    month: number;
    dayOfWeek: number;
    day: number;
    hour: number;
    minute: number;
    second: number;
    milliseconds: number;
}

export interface ActiveSyncTimeZone {
    bias: number;
    standardName: string;
    standardDate: SystemTimeRule;
    standardBias: number;
    daylightName: string;
    daylightDate: SystemTimeRule;
    daylightBias: number;
}

interface ZoneTransition {
    instant: Date;
    beforeOffset: number;
    afterOffset: number;
}

const TIME_ZONE_BYTES = 172;
const EMPTY_SYSTEM_TIME: SystemTimeRule = {
    year: 0,
    month: 0,
    dayOfWeek: 0,
    day: 0,
    hour: 0,
    minute: 0,
    second: 0,
    milliseconds: 0,
};

const resolutionCache = new Map<string, string | null>();
const formatterCache = new Map<string, Intl.DateTimeFormat>();
const zoneInformationCache = new Map<string, ActiveSyncTimeZone | null>();

function timeZoneFormatter(timeZone: string): Intl.DateTimeFormat {
    const cached = formatterCache.get(timeZone);
    if (cached) return cached;
    const formatter = new Intl.DateTimeFormat('en-US', {
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
    return formatter;
}

function wallParts(instant: Date, timeZone: string): Omit<SystemTimeRule, 'dayOfWeek'> & { dayOfWeek: number } {
    const values = new Map(timeZoneFormatter(timeZone).formatToParts(instant).map(part => [part.type, part.value]));
    const year = Number(values.get('year'));
    const month = Number(values.get('month'));
    const day = Number(values.get('day'));
    const hour = Number(values.get('hour'));
    const minute = Number(values.get('minute'));
    const second = Number(values.get('second'));
    return {
        year,
        month,
        day,
        hour,
        minute,
        second,
        milliseconds: 0,
        dayOfWeek: new Date(Date.UTC(year, month - 1, day)).getUTCDay(),
    };
}

function offsetMinutesAt(instant: Date, timeZone: string): number {
    const parts = wallParts(instant, timeZone);
    const rendered = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    return Math.round((rendered - Math.floor(instant.getTime() / 1000) * 1000) / 60_000);
}

function findTransitions(timeZone: string, year: number): ZoneTransition[] {
    const start = Date.UTC(year, 0, 1);
    const end = Date.UTC(year + 1, 0, 1);
    const step = 24 * 60 * 60 * 1000;
    const transitions: ZoneTransition[] = [];
    let previousInstant = start;
    let previousOffset = offsetMinutesAt(new Date(start), timeZone);

    for (let instant = start + step; instant <= end; instant += step) {
        const currentOffset = offsetMinutesAt(new Date(instant), timeZone);
        if (currentOffset !== previousOffset) {
            let low = Math.floor(previousInstant / 60_000);
            let high = Math.floor(instant / 60_000);
            while (high - low > 1) {
                const middle = Math.floor((low + high) / 2);
                if (offsetMinutesAt(new Date(middle * 60_000), timeZone) === previousOffset) low = middle;
                else high = middle;
            }
            const transitionInstant = new Date(high * 60_000);
            transitions.push({
                instant: transitionInstant,
                beforeOffset: offsetMinutesAt(new Date(transitionInstant.getTime() - 60_000), timeZone),
                afterOffset: offsetMinutesAt(transitionInstant, timeZone),
            });
        }
        previousInstant = instant;
        previousOffset = currentOffset;
    }
    return transitions;
}

function transitionRule(transition: ZoneTransition, timeZone: string): SystemTimeRule {
    const before = wallParts(new Date(transition.instant.getTime() - 60_000), timeZone);
    const localTransition = new Date(Date.UTC(
        before.year,
        before.month - 1,
        before.day,
        before.hour,
        before.minute + 1,
        before.second,
    ));
    const day = localTransition.getUTCDate();
    const month = localTransition.getUTCMonth() + 1;
    const ordinal = Math.ceil(day / 7);
    const daysInMonth = new Date(Date.UTC(localTransition.getUTCFullYear(), month, 0)).getUTCDate();
    return {
        year: 0,
        month,
        dayOfWeek: localTransition.getUTCDay(),
        day: day + 7 > daysInMonth ? 5 : ordinal,
        hour: localTransition.getUTCHours(),
        minute: localTransition.getUTCMinutes(),
        second: localTransition.getUTCSeconds(),
        milliseconds: 0,
    };
}

function zoneInformation(timeZone: string, year: number): ActiveSyncTimeZone | null {
    const cacheKey = `${year}:${timeZone}`;
    if (zoneInformationCache.has(cacheKey)) return zoneInformationCache.get(cacheKey) || null;
    try {
        timeZoneFormatter(timeZone);
        const transitions = findTransitions(timeZone, year);
        if (transitions.length === 0) {
            const fixedInformation = {
                bias: -offsetMinutesAt(new Date(Date.UTC(year, 0, 1)), timeZone),
                standardName: timeZone,
                standardDate: { ...EMPTY_SYSTEM_TIME },
                standardBias: 0,
                daylightName: timeZone,
                daylightDate: { ...EMPTY_SYSTEM_TIME },
                daylightBias: 0,
            };
            zoneInformationCache.set(cacheKey, fixedInformation);
            return fixedInformation;
        }
        if (transitions.length !== 2) {
            zoneInformationCache.set(cacheKey, null);
            return null;
        }

        const daylightStart = transitions.find(transition => transition.afterOffset > transition.beforeOffset);
        const standardStart = transitions.find(transition => transition.afterOffset < transition.beforeOffset);
        if (!daylightStart || !standardStart) {
            zoneInformationCache.set(cacheKey, null);
            return null;
        }

        const bias = -standardStart.afterOffset;
        const information = {
            bias,
            standardName: timeZone,
            standardDate: transitionRule(standardStart, timeZone),
            standardBias: 0,
            daylightName: timeZone,
            daylightDate: transitionRule(daylightStart, timeZone),
            daylightBias: -daylightStart.afterOffset - bias,
        };
        zoneInformationCache.set(cacheKey, information);
        return information;
    } catch {
        zoneInformationCache.set(cacheKey, null);
        return null;
    }
}

function writeName(buffer: Buffer, offset: number, value: string): void {
    const encoded = Buffer.from(value.slice(0, 31), 'utf16le');
    encoded.copy(buffer, offset, 0, Math.min(encoded.length, 62));
}

function readName(buffer: Buffer, offset: number): string {
    return buffer.subarray(offset, offset + 64).toString('utf16le').replace(/\0.*$/s, '').trim();
}

function writeSystemTime(buffer: Buffer, offset: number, value: SystemTimeRule): void {
    const fields = [value.year, value.month, value.dayOfWeek, value.day, value.hour, value.minute, value.second, value.milliseconds];
    fields.forEach((field, index) => buffer.writeUInt16LE(field, offset + index * 2));
}

function readSystemTime(buffer: Buffer, offset: number): SystemTimeRule {
    const fields = Array.from({ length: 8 }, (_, index) => buffer.readUInt16LE(offset + index * 2));
    return {
        year: fields[0], month: fields[1], dayOfWeek: fields[2], day: fields[3],
        hour: fields[4], minute: fields[5], second: fields[6], milliseconds: fields[7],
    };
}

export function encodeActiveSyncTimeZone(timeZone: string, reference: Date): string | null {
    const information = zoneInformation(timeZone, reference.getUTCFullYear());
    if (!information) return null;

    const buffer = Buffer.alloc(TIME_ZONE_BYTES);
    buffer.writeInt32LE(information.bias, 0);
    writeName(buffer, 4, information.standardName);
    writeSystemTime(buffer, 68, information.standardDate);
    buffer.writeInt32LE(information.standardBias, 84);
    writeName(buffer, 88, information.daylightName);
    writeSystemTime(buffer, 152, information.daylightDate);
    buffer.writeInt32LE(information.daylightBias, 168);
    return buffer.toString('base64');
}

export function decodeActiveSyncTimeZone(value: string): ActiveSyncTimeZone | null {
    const normalized = value.trim();
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(normalized)) return null;
    const buffer = Buffer.from(normalized, 'base64');
    if (buffer.length !== TIME_ZONE_BYTES) return null;
    return {
        bias: buffer.readInt32LE(0),
        standardName: readName(buffer, 4),
        standardDate: readSystemTime(buffer, 68),
        standardBias: buffer.readInt32LE(84),
        daylightName: readName(buffer, 88),
        daylightDate: readSystemTime(buffer, 152),
        daylightBias: buffer.readInt32LE(168),
    };
}

function validTimeZone(value: string): boolean {
    if (!value) return false;
    try {
        timeZoneFormatter(value);
        return true;
    } catch {
        return false;
    }
}

function namedTimeZone(information: ActiveSyncTimeZone): string | null {
    for (const name of [information.standardName, information.daylightName]) {
        if (validTimeZone(name)) return name;
        const normalized = name.toLowerCase();
        if (normalized === 'pacific standard time' || normalized.startsWith('(gmt-08:00) pacific time')) return 'America/Los_Angeles';
        if (normalized === 'eastern standard time' || normalized.startsWith('(gmt-05:00) eastern time')) return 'America/New_York';
        if (normalized === 'us mountain standard time' || normalized.includes('arizona')) return 'America/Phoenix';
        if (normalized === 'arabic standard time' || normalized.includes('baghdad')) return 'Asia/Baghdad';
    }
    return null;
}

function sameSystemTime(left: SystemTimeRule, right: SystemTimeRule): boolean {
    return left.year === right.year
        && left.month === right.month
        && left.dayOfWeek === right.dayOfWeek
        && left.day === right.day
        && left.hour === right.hour
        && left.minute === right.minute
        && left.second === right.second;
}

function sameRule(left: ActiveSyncTimeZone, right: ActiveSyncTimeZone): boolean {
    return left.bias === right.bias
        && left.standardBias === right.standardBias
        && left.daylightBias === right.daylightBias
        && sameSystemTime(left.standardDate, right.standardDate)
        && sameSystemTime(left.daylightDate, right.daylightDate);
}

function supportedTimeZones(): string[] {
    const intl = Intl as typeof Intl & { supportedValuesOf?: (key: 'timeZone') => string[] };
    return intl.supportedValuesOf ? intl.supportedValuesOf('timeZone') : [];
}

export function resolveActiveSyncTimeZone(value: string, reference: Date): string | null {
    const cacheKey = `${reference.getUTCFullYear()}:${value}`;
    if (resolutionCache.has(cacheKey)) return resolutionCache.get(cacheKey) || null;

    const information = decodeActiveSyncTimeZone(value);
    if (!information) {
        resolutionCache.set(cacheKey, null);
        return null;
    }

    const year = reference.getUTCFullYear();
    const named = namedTimeZone(information);
    const namedInformation = named ? zoneInformation(named, year) : null;
    if (named && namedInformation && sameRule(information, namedInformation)) {
        resolutionCache.set(cacheKey, named);
        return named;
    }

    const preferred = information.bias === 0
        ? ['UTC']
        : information.bias === -180
            ? ['Asia/Baghdad']
            : information.bias === 420
                ? ['America/Phoenix']
                : [];
    const candidates = [...preferred, ...supportedTimeZones().filter(zone => !preferred.includes(zone))];
    const match = candidates.find(zone => {
        const candidate = zoneInformation(zone, year);
        return candidate ? sameRule(information, candidate) : false;
    }) || null;
    resolutionCache.set(cacheKey, match);
    return match;
}

export function formatIcalWallTime(instant: Date, timeZone: string): string {
    const parts = wallParts(instant, timeZone);
    return [
        String(parts.year).padStart(4, '0'),
        String(parts.month).padStart(2, '0'),
        String(parts.day).padStart(2, '0'),
        'T',
        String(parts.hour).padStart(2, '0'),
        String(parts.minute).padStart(2, '0'),
        String(parts.second).padStart(2, '0'),
    ].join('');
}
