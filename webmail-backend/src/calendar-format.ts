import { createHash } from 'crypto';

export interface ParsedIcalEvent {
    uid: string;
    title: string;
    location: string;
    description: string;
    start: Date;
    end: Date;
    isAllDay: boolean;
    timeKind: 'utc' | 'zoned' | 'floating' | 'all-day';
    timeZone: string | null;
    sourceTimeZone?: string;
    timeZoneStatus?: 'valid' | 'canonicalized' | 'unsupported' | 'invalid';
    dtstamp: Date;
    recurrence: RecurrenceRule | null;
    recurrenceLabel: string;
    occurrenceId?: string;
    exdates?: Set<string>;
    excludedOccurrenceIds?: Set<string>;
    recurrenceExceptions?: ParsedRecurrenceException[];
    attendees?: string;
    busyStatus?: string;
    notifications?: Array<{id: number; type: string; time: number}>;
}

export interface ParsedRecurrenceException {
    recurrenceId: Date;
    deleted: boolean;
    event?: Omit<ParsedIcalEvent, 'recurrenceExceptions' | 'excludedOccurrenceIds' | 'exdates'>;
}

export interface RecurrenceRule {
    frequency: 'DAILY' | 'WEEKLY' | 'MONTHLY' | 'YEARLY';
    interval: number;
    count: number | null;
    until: Date | null;
    raw: string;
}

export function slugifyCalendarName(name: string): string {
    const slug = name
        .trim()
        .replace(/[^a-zA-Z0-9._-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80)
        .toLowerCase();
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

function firstComponentPropertyLines(lines: string[], componentName: string): string[] {
    const target = componentName.toUpperCase();
    let collecting = false;
    let depth = 0;
    const componentLines: string[] = [];

    for (const line of lines) {
        const normalized = line.trim().toUpperCase();

        if (!collecting) {
            if (normalized === `BEGIN:${target}`) {
                collecting = true;
                depth = 1;
            }
            continue;
        }

        if (normalized.startsWith('BEGIN:')) {
            depth += 1;
            continue;
        }

        if (normalized.startsWith('END:')) {
            if (depth === 1 && normalized === `END:${target}`) {
                return componentLines;
            }
            depth = Math.max(0, depth - 1);
            continue;
        }

        if (depth === 1) {
            componentLines.push(line);
        }
    }

    return componentLines.length > 0 ? componentLines : lines;
}

function componentBodies(lines: string[], componentName: string): string[][] {
    const target = componentName.toUpperCase();
    const bodies: string[][] = [];
    let current: string[] | null = null;
    let depth = 0;

    for (const line of lines) {
        const normalized = line.trim().toUpperCase();
        if (!current) {
            if (normalized === `BEGIN:${target}`) {
                current = [];
                depth = 1;
            }
            continue;
        }

        if (normalized.startsWith('BEGIN:')) {
            depth += 1;
            current.push(line);
            continue;
        }
        if (normalized.startsWith('END:')) {
            if (depth === 1 && normalized === `END:${target}`) {
                bodies.push(current);
                current = null;
                depth = 0;
                continue;
            }
            depth = Math.max(1, depth - 1);
            current.push(line);
            continue;
        }
        current.push(line);
    }
    return bodies;
}

function directPropertyLines(componentBody: string[]): string[] {
    const direct: string[] = [];
    let depth = 0;
    for (const line of componentBody) {
        const normalized = line.trim().toUpperCase();
        if (normalized.startsWith('BEGIN:')) {
            depth += 1;
            continue;
        }
        if (normalized.startsWith('END:')) {
            depth = Math.max(0, depth - 1);
            continue;
        }
        if (depth === 0) direct.push(line);
    }
    return direct;
}

export function extractIcalEventUid(ical: string): string | null {
    const eventLines = firstComponentPropertyLines(unfoldIcal(ical), 'VEVENT');
    const uid = firstIcalValue(eventLines, 'UID')?.value;
    return uid && uid.length > 0 ? uid : null;
}

function unescapeIcalText(value: string): string {
    return value
        .replace(/\\n/gi, '\n')
        .replace(/\\,/g, ',')
        .replace(/\\;/g, ';')
        .replace(/\\\\/g, '\\');
}

interface ParsedIcalDate {
    date: Date;
    timeKind: ParsedIcalEvent['timeKind'];
    timeZone: string | null;
    sourceTimeZone?: string;
    timeZoneStatus?: ParsedIcalEvent['timeZoneStatus'];
}

interface IcalTimeZoneResolution {
    canonicalTimeZone: string | null;
    status: NonNullable<ParsedIcalEvent['timeZoneStatus']>;
}

export interface WallTimeParts {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
    second: number;
}

const timeZoneFormatters = new Map<string, Intl.DateTimeFormat>();
const MAX_TIME_ZONE_FORMATTERS = 256;

function formatterForTimeZone(timeZone: string): Intl.DateTimeFormat {
    let formatter = timeZoneFormatters.get(timeZone);
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
        timeZoneFormatters.set(timeZone, formatter);
        if (timeZoneFormatters.size > MAX_TIME_ZONE_FORMATTERS) {
            timeZoneFormatters.delete(timeZoneFormatters.keys().next().value);
        }
    }
    return formatter;
}

export function wallTimeAt(instant: Date, timeZone: string): WallTimeParts {
    const values = new Map(formatterForTimeZone(timeZone).formatToParts(instant).map(part => [part.type, part.value]));
    return {
        year: Number(values.get('year')),
        month: Number(values.get('month')),
        day: Number(values.get('day')),
        hour: Number(values.get('hour')),
        minute: Number(values.get('minute')),
        second: Number(values.get('second')),
    };
}

function offsetAt(instant: Date, timeZone: string): number {
    const rendered = wallTimeAt(instant, timeZone);
    const renderedAsUtc = Date.UTC(
        rendered.year,
        rendered.month - 1,
        rendered.day,
        rendered.hour,
        rendered.minute,
        rendered.second
    );
    return renderedAsUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

function wallTimeToInstant(parts: WallTimeParts, timeZone: string): Date {
    const target = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    const offsets = new Set<number>();
    for (let sampleHours = -36; sampleHours <= 36; sampleHours += 6) {
        offsets.add(offsetAt(new Date(target + sampleHours * 60 * 60 * 1000), timeZone));
    }

    const candidates = Array.from(offsets, offset => {
        const instant = new Date(target - offset);
        const rendered = wallTimeAt(instant, timeZone);
        const renderedAsUtc = Date.UTC(
            rendered.year,
            rendered.month - 1,
            rendered.day,
            rendered.hour,
            rendered.minute,
            rendered.second
        );
        return { instant, renderedAsUtc };
    });
    const exact = candidates
        .filter(candidate => candidate.renderedAsUtc === target)
        .sort((left, right) => left.instant.getTime() - right.instant.getTime());

    // RFC 5545 chooses the first occurrence when a wall time repeats.
    if (exact.length > 0) return exact[0].instant;

    // For a nonexistent wall time, RFC 5545 applies the offset that was in
    // effect before the gap. That candidate renders immediately after it.
    const afterGap = candidates
        .filter(candidate => candidate.renderedAsUtc > target)
        .sort((left, right) => left.renderedAsUtc - right.renderedAsUtc);
    if (afterGap.length > 0) return afterGap[0].instant;

    return new Date(target);
}

function parameterValue(params: string, name: string): string | null {
    const match = new RegExp(`(?:^|;)${name}=([^;]+)`, 'i').exec(params);
    return match?.[1]?.replace(/^"|"$/g, '').trim() || null;
}

function isValidTimeZone(value: string): boolean {
    try {
        formatterForTimeZone(value);
        return true;
    } catch {
        return false;
    }
}

function validUtcOffset(value: string | undefined): boolean {
    const normalized = value?.trim();
    return Boolean(normalized && normalized !== '-0000' && /^[+-](?:0\d|1\d|2[0-3])[0-5]\d$/.test(normalized));
}

function utcOffsetMinutes(value: string): number {
    const sign = value.startsWith('-') ? -1 : 1;
    const compact = value.slice(1);
    return sign * (Number(compact.slice(0, 2)) * 60 + Number(compact.slice(2, 4)));
}

function canonicalOffsets(timeZone: string): Set<number> {
    const offsets = new Set<number>();
    const year = new Date().getUTCFullYear();
    for (let month = 0; month < 12; month += 1) {
        offsets.add(Math.round(offsetAt(new Date(Date.UTC(year, month, 15, 12)), timeZone) / 60_000));
    }
    return offsets;
}

interface TimeZoneTransitionRule {
    month: number;
    day: number;
    hour: number;
    minute: number;
    second: number;
    offsetFrom: number;
    offsetTo: number;
}

function compactWallParts(value: string | undefined): WallTimeParts | null {
    const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/.exec(value?.trim() || '');
    if (!match) return null;
    const parts = {
        year: Number(match[1]), month: Number(match[2]), day: Number(match[3]),
        hour: Number(match[4]), minute: Number(match[5]), second: Number(match[6]),
    };
    const check = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second));
    return check.getUTCFullYear() === parts.year
        && check.getUTCMonth() + 1 === parts.month
        && check.getUTCDate() === parts.day
        && check.getUTCHours() === parts.hour
        && check.getUTCMinutes() === parts.minute
        && check.getUTCSeconds() === parts.second
        ? parts
        : null;
}

function rruleParts(value: string | undefined): Map<string, string> {
    return new Map((value || '').split(';').map(part => {
        const [key, ...rest] = part.split('=');
        return [key?.toUpperCase(), rest.join('=')];
    }).filter(([key, val]) => Boolean(key && val)) as Array<[string, string]>);
}

function nthWeekdayOfMonth(year: number, month: number, weekday: number, ordinal: number): number | null {
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    if (ordinal > 0) {
        const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
        const day = 1 + (weekday - firstWeekday + 7) % 7 + (ordinal - 1) * 7;
        return day <= daysInMonth ? day : null;
    }
    const lastWeekday = new Date(Date.UTC(year, month - 1, daysInMonth)).getUTCDay();
    const day = daysInMonth - (lastWeekday - weekday + 7) % 7 + (ordinal + 1) * 7;
    return day > 0 ? day : null;
}

function definitionTransition(observance: string[], year: number): TimeZoneTransitionRule | null {
    const fields = directPropertyLines(observance);
    const start = compactWallParts(firstIcalValue(fields, 'DTSTART')?.value);
    const from = firstIcalValue(fields, 'TZOFFSETFROM')?.value?.trim();
    const to = firstIcalValue(fields, 'TZOFFSETTO')?.value?.trim();
    if (!start || !from || !to || !validUtcOffset(from) || !validUtcOffset(to)) return null;
    if (from === to) return null;

    const rrule = rruleParts(firstIcalValue(fields, 'RRULE')?.value);
    if (rrule.size === 0) return start.year === year ? { ...start, offsetFrom: utcOffsetMinutes(from), offsetTo: utcOffsetMinutes(to) } : null;
    const supportedKeys = new Set(['FREQ', 'INTERVAL', 'BYMONTH', 'BYDAY', 'BYMONTHDAY']);
    if (Array.from(rrule.keys()).some(key => !supportedKeys.has(key))) return null;
    if (rrule.get('FREQ')?.toUpperCase() !== 'YEARLY') return null;
    if ((rrule.get('INTERVAL') || '1') !== '1' || year < start.year) return null;
    const month = Number(rrule.get('BYMONTH') || start.month);
    if (!Number.isInteger(month) || month < 1 || month > 12) return null;

    let day: number | null = null;
    const rawMonthDay = rrule.get('BYMONTHDAY');
    const rawByDay = rrule.get('BYDAY');
    if (rawMonthDay && rawByDay) return null;
    if (rawMonthDay) {
        if (!/^[+-]?\d{1,2}$/.test(rawMonthDay)) return null;
        const monthDay = Number(rawMonthDay);
        if (monthDay === 0) return null;
        const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
        day = monthDay > 0 ? monthDay : daysInMonth + monthDay + 1;
    } else if (rawByDay) {
        const byDay = /^([+-]?\d)(SU|MO|TU|WE|TH|FR|SA)$/.exec(rawByDay.toUpperCase());
        if (!byDay) return null;
        const weekday = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'].indexOf(byDay[2]);
        day = nthWeekdayOfMonth(year, month, weekday, Number(byDay[1]));
    } else {
        day = start.day;
    }
    if (!day) return null;
    if (year === start.year) {
        const transition = Date.UTC(year, month - 1, day, start.hour, start.minute, start.second);
        const firstOccurrence = Date.UTC(start.year, start.month - 1, start.day, start.hour, start.minute, start.second);
        if (transition < firstOccurrence) return null;
    }
    return { month, day, hour: start.hour, minute: start.minute, second: start.second,
        offsetFrom: utcOffsetMinutes(from), offsetTo: utcOffsetMinutes(to) };
}

const canonicalTransitionCache = new Map<string, TimeZoneTransitionRule[]>();

function canonicalTransitions(timeZone: string, year: number): TimeZoneTransitionRule[] {
    const cacheKey = `${timeZone}:${year}`;
    const cached = canonicalTransitionCache.get(cacheKey);
    if (cached) return cached;
    const transitions: TimeZoneTransitionRule[] = [];
    const start = Date.UTC(year, 0, 1);
    const end = Date.UTC(year + 1, 0, 1);
    let previousInstant = start;
    let previousOffset = Math.round(offsetAt(new Date(start), timeZone) / 60_000);
    for (let instant = start + 86_400_000; instant <= end; instant += 86_400_000) {
        const nextOffset = Math.round(offsetAt(new Date(instant), timeZone) / 60_000);
        if (nextOffset !== previousOffset) {
            let low = Math.floor(previousInstant / 60_000);
            let high = Math.floor(instant / 60_000);
            while (high - low > 1) {
                const middle = Math.floor((low + high) / 2);
                const middleOffset = Math.round(offsetAt(new Date(middle * 60_000), timeZone) / 60_000);
                if (middleOffset === previousOffset) low = middle;
                else high = middle;
            }
            const local = new Date(high * 60_000 + previousOffset * 60_000);
            transitions.push({
                month: local.getUTCMonth() + 1, day: local.getUTCDate(), hour: local.getUTCHours(),
                minute: local.getUTCMinutes(), second: local.getUTCSeconds(),
                offsetFrom: previousOffset, offsetTo: nextOffset,
            });
        }
        previousInstant = instant;
        previousOffset = nextOffset;
    }
    if (canonicalTransitionCache.size >= 256) canonicalTransitionCache.clear();
    canonicalTransitionCache.set(cacheKey, transitions);
    return transitions;
}

function sameTransition(left: TimeZoneTransitionRule, right: TimeZoneTransitionRule): boolean {
    return left.month === right.month && left.day === right.day && left.hour === right.hour
        && left.minute === right.minute && left.second === right.second
        && left.offsetFrom === right.offsetFrom && left.offsetTo === right.offsetTo;
}

function parseIcalTimeZones(lines: string[]): Map<string, IcalTimeZoneResolution> {
    const resolutions = new Map<string, IcalTimeZoneResolution>();
    const currentYear = new Date().getUTCFullYear();
    const validationYears = new Set(Array.from({ length: 28 }, (_, index) => currentYear + index));
    for (const eventBody of [
        ...componentBodies(lines, 'VEVENT'),
        ...componentBodies(lines, 'VTODO'),
    ].slice(0, 257)) {
        for (const field of directPropertyLines(eventBody).slice(0, 512)) {
            const separator = field.indexOf(':');
            if (separator < 0) continue;
            const property = field.slice(0, separator).split(';')[0].toUpperCase();
            if (!['DTSTART', 'DTEND', 'RECURRENCE-ID', 'EXDATE', 'RDATE'].includes(property)) continue;
            for (const value of field.slice(separator + 1).split(',').slice(0, 64)) {
                const year = Number(value.trim().slice(0, 4));
                if (Number.isInteger(year) && year >= 1 && year <= 9999) validationYears.add(year);
            }
        }
    }
    const years = Array.from(validationYears).sort((left, right) => left - right);
    for (const body of componentBodies(lines, 'VTIMEZONE').slice(0, 32)) {
        const properties = directPropertyLines(body);
        const tzid = firstIcalValue(properties, 'TZID')?.value?.trim();
        if (!tzid) continue;

        const observances = [
            ...componentBodies(body, 'STANDARD'),
            ...componentBodies(body, 'DAYLIGHT'),
        ];
        const validDefinition = observances.length > 0 && observances.length <= 8 && observances.every(observance => {
            const fields = directPropertyLines(observance);
            return Boolean(compactWallParts(firstIcalValue(fields, 'DTSTART')?.value))
                && validUtcOffset(firstIcalValue(fields, 'TZOFFSETFROM')?.value)
                && validUtcOffset(firstIcalValue(fields, 'TZOFFSETTO')?.value);
        });
        const canonical = firstIcalValue(properties, 'X-LIC-LOCATION')?.value?.trim() || '';
        const definitionOffsets = new Set(observances
            .map(observance => firstIcalValue(directPropertyLines(observance), 'TZOFFSETTO')?.value?.trim())
            .filter((value): value is string => Boolean(value && validUtcOffset(value)))
            .map(utcOffsetMinutes));
        const canonicalCandidate = isValidTimeZone(tzid) ? tzid : canonical;
        const transitionRulesSupported = observances.every(observance => {
            const fields = directPropertyLines(observance);
            const rule = firstIcalValue(fields, 'RRULE')?.value;
            if (!rule) return true;
            const parts = rruleParts(rule);
            return !parts.has('UNTIL') && !parts.has('COUNT')
                && Array.from(parts.keys()).every(key => ['FREQ', 'INTERVAL', 'BYMONTH', 'BYDAY', 'BYMONTHDAY'].includes(key))
                && Boolean(definitionTransition(
                    observance,
                    Math.max(currentYear, compactWallParts(firstIcalValue(fields, 'DTSTART')?.value)?.year || currentYear)
                ));
        });
        const transitionsMatch = Boolean(canonicalCandidate) && isValidTimeZone(canonicalCandidate)
            && years.every(year => {
                const definitionTransitions = observances
                    .map(observance => definitionTransition(observance, year))
                    .filter((transition): transition is TimeZoneTransitionRule => Boolean(transition))
                    .sort((left, right) => left.month - right.month || left.day - right.day);
                const expectedTransitions = canonicalTransitions(canonicalCandidate, year);
                return definitionTransitions.length === expectedTransitions.length
                    && definitionTransitions.every((transition, index) => sameTransition(transition, expectedTransitions[index]));
            });
        const canonicalRuleMatch = validDefinition && Boolean(canonicalCandidate) && isValidTimeZone(canonicalCandidate)
            && transitionRulesSupported
            && Array.from(canonicalOffsets(canonicalCandidate)).every(offset => definitionOffsets.has(offset))
            && transitionsMatch;
        if (canonicalRuleMatch) {
            resolutions.set(tzid, {
                canonicalTimeZone: canonicalCandidate,
                status: canonicalCandidate === tzid ? 'valid' : 'canonicalized',
            });
        } else {
            resolutions.set(tzid, {
                canonicalTimeZone: null,
                status: validDefinition && !canonical ? 'unsupported' : 'invalid',
            });
        }
    }
    return resolutions;
}

function parseIcalDate(
    field: { value: string; params: string } | null,
    allDay: boolean,
    fallback?: Pick<ParsedIcalDate, 'timeKind' | 'timeZone' | 'sourceTimeZone' | 'timeZoneStatus'>,
    timeZones: Map<string, IcalTimeZoneResolution> = new Map()
): ParsedIcalDate {
    if (!field?.value) return { date: new Date(), timeKind: 'utc', timeZone: 'UTC' };
    const value = field.value;
    const compact = value.trim();
    const year = Number(compact.slice(0, 4));
    const month = Number(compact.slice(4, 6));
    const day = Number(compact.slice(6, 8));

    if (allDay || compact.length === 8) {
        return {
            date: new Date(Date.UTC(year, month - 1, day, 0, 0, 0)),
            timeKind: 'all-day',
            timeZone: null,
        };
    }

    const hour = Number(compact.slice(9, 11)) || 0;
    const minute = Number(compact.slice(11, 13)) || 0;
    const second = Number(compact.slice(13, 15)) || 0;
    const wallTime = { year, month, day, hour, minute, second };
    const explicitTimeZone = parameterValue(field.params, 'TZID');
    const sourceTimeZone = explicitTimeZone
        || (fallback?.timeKind === 'zoned' ? fallback.sourceTimeZone || fallback.timeZone : null);

    if (compact.toUpperCase().endsWith('Z') || (!explicitTimeZone && fallback?.timeKind === 'utc')) {
        return {
            date: new Date(Date.UTC(year, month - 1, day, hour, minute, second)),
            timeKind: 'utc',
            timeZone: 'UTC',
        };
    }

    if (sourceTimeZone) {
        const resolution = timeZones.get(sourceTimeZone);
        const timeZone = resolution
            ? resolution.canonicalTimeZone
            : isValidTimeZone(sourceTimeZone) ? sourceTimeZone : null;
        if (timeZone) {
            return {
                date: wallTimeToInstant(wallTime, timeZone),
                timeKind: 'zoned',
                timeZone,
                sourceTimeZone: sourceTimeZone !== timeZone || resolution?.status === 'invalid'
                    ? sourceTimeZone
                    : undefined,
                timeZoneStatus: resolution?.status || 'valid',
            };
        }
        return {
            date: new Date(Date.UTC(year, month - 1, day, hour, minute, second)),
            timeKind: 'floating',
            timeZone: null,
            sourceTimeZone,
            timeZoneStatus: resolution?.status || 'unsupported',
        };
    }

    return {
        date: new Date(Date.UTC(year, month - 1, day, hour, minute, second)),
        timeKind: 'floating',
        timeZone: null,
    };
}

function parseRrule(value: string | undefined, start: ParsedIcalDate): RecurrenceRule | null {
    if (!value) return null;
    const parts = new Map<string, string>();
    for (const segment of value.split(';')) {
        const [rawKey, ...rawValue] = segment.split('=');
        const key = rawKey?.trim().toUpperCase();
        const parsedValue = rawValue.join('=').trim();
        if (key && parsedValue) parts.set(key, parsedValue);
    }

    const frequency = parts.get('FREQ')?.toUpperCase();
    if (!frequency || !['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(frequency)) return null;

    const interval = Math.max(1, Math.min(365, Number(parts.get('INTERVAL') || 1) || 1));
    const rawCount = Number(parts.get('COUNT') || 0);
    const count = Number.isFinite(rawCount) && rawCount > 0 ? Math.min(1000, Math.floor(rawCount)) : null;
    const untilValue = parts.get('UNTIL');

    return {
        frequency: frequency as RecurrenceRule['frequency'],
        interval,
        count,
        until: untilValue ? parseIcalDate({ value: untilValue, params: '' }, untilValue.length === 8, start).date : null,
        raw: value,
    };
}

function recurrenceLabel(rule: RecurrenceRule | null): string {
    if (!rule) return '';
    const unit = {
        DAILY: 'day',
        WEEKLY: 'week',
        MONTHLY: 'month',
        YEARLY: 'year',
    }[rule.frequency];
    return rule.interval === 1 ? `Every ${unit}` : `Every ${rule.interval} ${unit}s`;
}

function parseDisplayAlarm(componentBody: string[]): Array<{id: number; type: string; time: number}> | undefined {
    for (const alarmBody of componentBodies(componentBody, 'VALARM').slice(0, 16)) {
        const alarmLines = directPropertyLines(alarmBody);
        if (firstIcalValue(alarmLines, 'ACTION')?.value?.toUpperCase() !== 'DISPLAY') continue;
        const trigger = firstIcalValue(alarmLines, 'TRIGGER')?.value?.trim().toUpperCase() || '';
        const weekMatch = /^(-?)P(\d+)W$/.exec(trigger);
        if (weekMatch) {
            const minutes = Number(weekMatch[2]) * 10_080;
            if (weekMatch[1] !== '-' && minutes !== 0) continue;
            return [{ id: 1, type: 'notification', time: Math.min(525_600, minutes) }];
        }
        const match = /^(-?)P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(trigger);
        if (!match) continue;
        if (!match.slice(2).some(value => value !== undefined)) continue;
        const seconds = Number(match[2] || 0) * 86_400
            + Number(match[3] || 0) * 3_600
            + Number(match[4] || 0) * 60
            + Number(match[5] || 0);
        if (match[1] !== '-' && seconds !== 0) continue;
        const minutes = Math.ceil(seconds / 60);
        return [{ id: 1, type: 'notification', time: Math.min(525_600, minutes) }];
    }
    return undefined;
}

function parseEventComponent(
    uid: string,
    componentBody: string[],
    timeZones: Map<string, IcalTimeZoneResolution>,
    fallback?: ParsedIcalEvent,
    isTask = false
): ParsedIcalEvent & { type?: 'event' | 'task' } {
    const eventLines = directPropertyLines(componentBody);
    const startField = firstIcalValue(eventLines, 'DTSTART');
    const endField = firstIcalValue(eventLines, 'DTEND');
    const allDay = startField
        ? Boolean(startField.params.toUpperCase().includes('VALUE=DATE') || startField.value.length === 8)
        : Boolean(fallback?.isAllDay);
    const fallbackTime = fallback ? {
        timeKind: fallback.timeKind,
        timeZone: fallback.timeZone,
        sourceTimeZone: fallback.sourceTimeZone,
        timeZoneStatus: fallback.timeZoneStatus,
    } : undefined;
    const parsedStart = startField
        ? parseIcalDate(startField, allDay, fallbackTime, timeZones)
        : fallback
            ? { date: new Date(fallback.start), ...fallbackTime! }
            : parseIcalDate(null, allDay, undefined, timeZones);
    const start = parsedStart.date;
    const fallbackDuration = fallback ? fallback.end.getTime() - fallback.start.getTime() : 0;
    const fallbackEnd = new Date(start.getTime() + (fallbackDuration > 0
        ? fallbackDuration
        : allDay ? 24 * 60 * 60 * 1000 : 60 * 60 * 1000));
    const parsedEnd = endField?.value ? parseIcalDate(endField, allDay, parsedStart, timeZones).date : fallbackEnd;
    const recurrence = parseRrule(firstIcalValue(eventLines, 'RRULE')?.value, parsedStart);

    const transpValue = firstIcalValue(eventLines, 'TRANSP')?.value?.toUpperCase();
    const busyStatus = transpValue ? (transpValue === 'TRANSPARENT' ? 'free' : 'busy') : fallback?.busyStatus || 'busy';

    const attendeeLines = eventLines.filter(l => l.split(':')[0].split(';')[0].toUpperCase() === 'ATTENDEE');
    const attendees = attendeeLines.map(l => {
        const mailto = l.match(/mailto:([^\s]+)/i);
        return mailto ? mailto[1] : '';
    }).filter(Boolean).join(', ');
    const titleField = firstIcalValue(eventLines, 'SUMMARY');
    const locationField = firstIcalValue(eventLines, 'LOCATION');
    const descriptionField = firstIcalValue(eventLines, 'DESCRIPTION');
    const alarm = parseDisplayAlarm(componentBody);

    return {
        uid: firstIcalValue(eventLines, 'UID')?.value || uid,
        title: titleField ? unescapeIcalText(titleField.value) : fallback?.title || 'Untitled',
        location: locationField ? unescapeIcalText(locationField.value) : fallback?.location || '',
        description: descriptionField ? unescapeIcalText(descriptionField.value) : fallback?.description || '',
        start,
        end: parsedEnd.getTime() > start.getTime() ? parsedEnd : fallbackEnd,
        isAllDay: allDay,
        timeKind: parsedStart.timeKind,
        timeZone: parsedStart.timeZone,
        sourceTimeZone: parsedStart.sourceTimeZone,
        timeZoneStatus: parsedStart.timeZoneStatus,
        dtstamp: firstIcalValue(eventLines, 'DTSTAMP')
            ? parseIcalDate(firstIcalValue(eventLines, 'DTSTAMP'), false, undefined, timeZones).date
            : fallback?.dtstamp || new Date(),
        recurrence,
        recurrenceLabel: recurrenceLabel(recurrence),
        type: isTask ? 'task' : 'event',
        attendees: attendees || fallback?.attendees || undefined,
        busyStatus,
        notifications: alarm,
    };
}

function parseExdates(
    lines: string[],
    fallback: ParsedIcalEvent,
    timeZones: Map<string, IcalTimeZoneResolution>
): { raw: Set<string>; occurrenceIds: Set<string> } {
    const excluded = new Set<string>();
    const occurrenceIds = new Set<string>();
    for (const line of lines) {
        const separator = line.indexOf(':');
        const left = separator >= 0 ? line.slice(0, separator) : line;
        const propUpper = left.split(';')[0].toUpperCase();
        if (propUpper !== 'EXDATE') continue;
        const val = line.slice(separator + 1).trim();
        const params = left.slice(propUpper.length);
        for (const dateStr of val.split(',')) {
            const clean = dateStr.trim().replace(/[^0-9TZ]/g, '');
            if (clean.length < 8) continue;
            excluded.add(clean);
            const parsed = parseIcalDate({ value: dateStr.trim(), params }, fallback.isAllDay, fallback, timeZones);
            occurrenceIds.add(formatActiveSyncDate(parsed.date));
        }
    }
    return { raw: excluded, occurrenceIds };
}

export function parseIcalEvent(uid: string, ical: string): ParsedIcalEvent & { type?: 'event' | 'task' } {
    const lines = unfoldIcal(ical);
    const timeZones = parseIcalTimeZones(lines);
    let eventBodies = componentBodies(lines, 'VEVENT');
    let isTask = false;
    if (eventBodies.length === 0) {
        eventBodies = componentBodies(lines, 'VTODO');
        isTask = eventBodies.length > 0;
    }
    if (eventBodies.length === 0) eventBodies = [lines];

    const masterBody = eventBodies.find(body => !firstIcalValue(directPropertyLines(body), 'RECURRENCE-ID')) || eventBodies[0];
    const master = parseEventComponent(uid, masterBody, timeZones, undefined, isTask);
    const masterLines = directPropertyLines(masterBody);
    const exdates = parseExdates(masterLines, master, timeZones);
    const recurrenceExceptions = new Map<string, ParsedRecurrenceException>();

    for (const body of eventBodies.slice(0, 257)) {
        if (body === masterBody) continue;
        const properties = directPropertyLines(body);
        const recurrenceIdField = firstIcalValue(properties, 'RECURRENCE-ID');
        if (!recurrenceIdField) continue;
        const exceptionUid = firstIcalValue(properties, 'UID')?.value || master.uid;
        if (exceptionUid !== master.uid) continue;
        const recurrenceId = parseIcalDate(recurrenceIdField, master.isAllDay, master, timeZones).date;
        const deleted = firstIcalValue(properties, 'STATUS')?.value?.toUpperCase() === 'CANCELLED';
        recurrenceExceptions.set(formatActiveSyncDate(recurrenceId), {
            recurrenceId,
            deleted,
            event: deleted ? undefined : parseEventComponent(uid, body, timeZones, master),
        });
    }

    return {
        ...master,
        exdates: exdates.raw,
        excludedOccurrenceIds: exdates.occurrenceIds,
        recurrenceExceptions: Array.from(recurrenceExceptions.values()),
    };
}

function addRecurrenceInterval(
    date: Date,
    frequency: RecurrenceRule['frequency'],
    interval: number,
    timeZone: string | null
): Date {
    if (timeZone) {
        const wallTime = wallTimeAt(date, timeZone);
        const surrogate = new Date(Date.UTC(
            wallTime.year,
            wallTime.month - 1,
            wallTime.day,
            wallTime.hour,
            wallTime.minute,
            wallTime.second
        ));
        if (frequency === 'DAILY') surrogate.setUTCDate(surrogate.getUTCDate() + interval);
        if (frequency === 'WEEKLY') surrogate.setUTCDate(surrogate.getUTCDate() + interval * 7);
        if (frequency === 'MONTHLY') surrogate.setUTCMonth(surrogate.getUTCMonth() + interval);
        if (frequency === 'YEARLY') surrogate.setUTCFullYear(surrogate.getUTCFullYear() + interval);
        return wallTimeToInstant({
            year: surrogate.getUTCFullYear(),
            month: surrogate.getUTCMonth() + 1,
            day: surrogate.getUTCDate(),
            hour: surrogate.getUTCHours(),
            minute: surrogate.getUTCMinutes(),
            second: surrogate.getUTCSeconds(),
        }, timeZone);
    }
    const next = new Date(date);
    if (frequency === 'DAILY') next.setUTCDate(next.getUTCDate() + interval);
    if (frequency === 'WEEKLY') next.setUTCDate(next.getUTCDate() + interval * 7);
    if (frequency === 'MONTHLY') next.setUTCMonth(next.getUTCMonth() + interval);
    if (frequency === 'YEARLY') next.setUTCFullYear(next.getUTCFullYear() + interval);
    return next;
}

export function expandRecurringEvent(
    event: ParsedIcalEvent,
    rangeStart: Date,
    rangeEnd: Date,
    maxOccurrences = 400
): ParsedIcalEvent[] {
    if (!event.recurrence) return [event];

    const occurrences: ParsedIcalEvent[] = [];
    const exceptionByOccurrence = new Map(
        (event.recurrenceExceptions || []).map(exception => [formatActiveSyncDate(exception.recurrenceId), exception])
    );
    const durationMs = event.end.getTime() - event.start.getTime();
    let occurrenceStart = new Date(event.start);
    let generated = 0;

    while (generated < maxOccurrences) {
        if (event.recurrence.count && generated >= event.recurrence.count) break;
        if (event.recurrence.until && occurrenceStart > event.recurrence.until) break;
        if (occurrenceStart > rangeEnd) break;

        const occurrenceEnd = new Date(occurrenceStart.getTime() + durationMs);
        if (occurrenceEnd >= rangeStart && occurrenceStart <= rangeEnd) {
            const occurrenceKey = formatActiveSyncDate(occurrenceStart);
            const isExcluded = event.excludedOccurrenceIds?.has(occurrenceKey)
                || event.exdates?.has(occurrenceKey)
                || event.exdates?.has(occurrenceKey.replace(/Z$/, ''));
            if (!isExcluded && !exceptionByOccurrence.has(occurrenceKey)) {
                occurrences.push({
                    ...event,
                    start: new Date(occurrenceStart),
                    end: occurrenceEnd,
                    uid: event.uid,
                    title: event.title,
                    recurrenceLabel: event.recurrenceLabel,
                    occurrenceId: occurrenceKey,
                });
            }
        }

        occurrenceStart = addRecurrenceInterval(
            occurrenceStart,
            event.recurrence.frequency,
            event.recurrence.interval,
            event.timeKind === 'zoned' ? event.timeZone : null
        );
        generated += 1;
    }

    for (const exception of exceptionByOccurrence.values()) {
        if (exception.deleted || !exception.event) continue;
        if (exception.event.end < rangeStart || exception.event.start > rangeEnd) continue;
        occurrences.push({
            ...exception.event,
            uid: event.uid,
            recurrence: event.recurrence,
            recurrenceLabel: event.recurrenceLabel,
            occurrenceId: formatActiveSyncDate(exception.recurrenceId),
        });
    }

    occurrences.sort((left, right) => left.start.getTime() - right.start.getTime());

    return occurrences;
}

export function formatActiveSyncDate(date: Date): string {
    return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

export function getCalendarFolderSyncKey(folders: Array<{ serverId: string; displayName: string; type: string }>): string {
    const signature = folders
        .map(folder => `${folder.serverId}\t${folder.displayName}\t${folder.type}`)
        .sort()
        .join('\n');
    return `oms-${createHash('sha1').update(signature).digest('hex').slice(0, 12)}`;
}
