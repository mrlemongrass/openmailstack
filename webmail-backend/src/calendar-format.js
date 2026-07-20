"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.slugifyCalendarName = slugifyCalendarName;
exports.parseIcalEvent = parseIcalEvent;
exports.expandRecurringEvent = expandRecurringEvent;
exports.formatActiveSyncDate = formatActiveSyncDate;
exports.getCalendarFolderSyncKey = getCalendarFolderSyncKey;
const crypto_1 = require("crypto");
function slugifyCalendarName(name) {
    const slug = name
        .trim()
        .replace(/[^a-zA-Z0-9._-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80)
        .toLowerCase();
    return slug || 'calendar';
}
function unfoldIcal(ical) {
    const lines = ical.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    const unfolded = [];
    for (const line of lines) {
        if (/^[ \t]/.test(line) && unfolded.length > 0) {
            unfolded[unfolded.length - 1] += line.slice(1);
        }
        else {
            unfolded.push(line);
        }
    }
    return unfolded;
}
function firstIcalValue(lines, name) {
    const prefix = `${name.toUpperCase()}`;
    for (const line of lines) {
        const idx = line.indexOf(':');
        if (idx === -1)
            continue;
        const left = line.slice(0, idx);
        const tag = left.split(';')[0].toUpperCase();
        if (tag !== prefix)
            continue;
        return { params: left.slice(tag.length), value: line.slice(idx + 1) };
    }
    return null;
}
function firstComponentPropertyLines(lines, componentName) {
    const target = componentName.toUpperCase();
    let collecting = false;
    let depth = 0;
    const componentLines = [];
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
function unescapeIcalText(value) {
    return value
        .replace(/\\n/gi, '\n')
        .replace(/\\,/g, ',')
        .replace(/\\;/g, ';')
        .replace(/\\\\/g, '\\');
}
const timeZoneFormatters = new Map();
function formatterForTimeZone(timeZone) {
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
    }
    return formatter;
}
function wallTimeAt(instant, timeZone) {
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
function wallTimeToInstant(parts, timeZone) {
    const target = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    let instant = new Date(target);
    for (let attempt = 0; attempt < 3; attempt += 1) {
        const rendered = wallTimeAt(instant, timeZone);
        const renderedAsUtc = Date.UTC(rendered.year, rendered.month - 1, rendered.day, rendered.hour, rendered.minute, rendered.second);
        const correction = target - renderedAsUtc;
        if (correction === 0)
            break;
        instant = new Date(instant.getTime() + correction);
    }
    return instant;
}
function parameterValue(params, name) {
    const match = new RegExp(`(?:^|;)${name}=([^;]+)`, 'i').exec(params);
    return match?.[1]?.replace(/^"|"$/g, '').trim() || null;
}
function isValidTimeZone(value) {
    try {
        formatterForTimeZone(value);
        return true;
    }
    catch {
        return false;
    }
}
function parseIcalDate(field, allDay, fallback) {
    if (!field?.value)
        return { date: new Date(), timeKind: 'utc', timeZone: 'UTC' };
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
    const timeZone = parameterValue(field.params, 'TZID') || (fallback?.timeKind === 'zoned' ? fallback.timeZone : null);
    if (compact.toUpperCase().endsWith('Z') || fallback?.timeKind === 'utc') {
        return {
            date: new Date(Date.UTC(year, month - 1, day, hour, minute, second)),
            timeKind: 'utc',
            timeZone: 'UTC',
        };
    }
    if (timeZone && isValidTimeZone(timeZone)) {
        return { date: wallTimeToInstant(wallTime, timeZone), timeKind: 'zoned', timeZone };
    }
    return {
        date: new Date(Date.UTC(year, month - 1, day, hour, minute, second)),
        timeKind: 'floating',
        timeZone: null,
    };
}
function parseRrule(value, start) {
    if (!value)
        return null;
    const parts = new Map();
    for (const segment of value.split(';')) {
        const [rawKey, ...rawValue] = segment.split('=');
        const key = rawKey?.trim().toUpperCase();
        const parsedValue = rawValue.join('=').trim();
        if (key && parsedValue)
            parts.set(key, parsedValue);
    }
    const frequency = parts.get('FREQ')?.toUpperCase();
    if (!frequency || !['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY'].includes(frequency))
        return null;
    const interval = Math.max(1, Math.min(365, Number(parts.get('INTERVAL') || 1) || 1));
    const rawCount = Number(parts.get('COUNT') || 0);
    const count = Number.isFinite(rawCount) && rawCount > 0 ? Math.min(1000, Math.floor(rawCount)) : null;
    const untilValue = parts.get('UNTIL');
    return {
        frequency: frequency,
        interval,
        count,
        until: untilValue ? parseIcalDate({ value: untilValue, params: '' }, untilValue.length === 8, start).date : null,
        raw: value,
    };
}
function recurrenceLabel(rule) {
    if (!rule)
        return '';
    const unit = {
        DAILY: 'day',
        WEEKLY: 'week',
        MONTHLY: 'month',
        YEARLY: 'year',
    }[rule.frequency];
    return rule.interval === 1 ? `Every ${unit}` : `Every ${rule.interval} ${unit}s`;
}
function parseIcalEvent(uid, ical) {
    const lines = unfoldIcal(ical);
    let isTask = false;
    let eventLines = firstComponentPropertyLines(lines, 'VEVENT');
    if (eventLines === lines) {
        const todoLines = firstComponentPropertyLines(lines, 'VTODO');
        if (todoLines !== lines) {
            eventLines = todoLines;
            isTask = true;
        }
    }
    const startField = firstIcalValue(eventLines, 'DTSTART');
    const endField = firstIcalValue(eventLines, 'DTEND');
    const allDay = Boolean(startField?.params.toUpperCase().includes('VALUE=DATE') || startField?.value.length === 8);
    const parsedStart = parseIcalDate(startField, allDay);
    const start = parsedStart.date;
    const fallbackEnd = new Date(start.getTime() + (allDay ? 24 * 60 * 60 * 1000 : 60 * 60 * 1000));
    const recurrence = parseRrule(firstIcalValue(eventLines, 'RRULE')?.value, parsedStart);
    const exdates = parseExdates(eventLines);
    // Parse TRANSP
    const transpValue = firstIcalValue(eventLines, 'TRANSP')?.value?.toUpperCase() || '';
    const busyStatus = transpValue === 'TRANSPARENT' ? 'free' : 'busy';
    // Parse ATTENDEE
    const attendeeLines = eventLines.filter(l => l.split(':')[0].split(';')[0].toUpperCase() === 'ATTENDEE');
    const attendees = attendeeLines.map(l => {
        const mailto = l.match(/mailto:([^\s]+)/i);
        return mailto ? mailto[1] : '';
    }).filter(Boolean).join(', ');
    // Parse VALARM trigger
    let notifications;
    const valarmStart = eventLines.findIndex(l => l.toUpperCase().trim() === 'BEGIN:VALARM');
    if (valarmStart >= 0) {
        const triggerLine = eventLines.slice(valarmStart).find(l => l.split(':')[0].split(';')[0].toUpperCase() === 'TRIGGER');
        if (triggerLine) {
            const triggerVal = triggerLine.slice(triggerLine.indexOf(':') + 1).trim();
            const minutesMatch = triggerVal.match(/^-PT(\d+)M/i) || triggerVal.match(/^-P(\d+)D/i);
            if (minutesMatch) {
                const minutes = triggerVal.includes('D') ? parseInt(minutesMatch[1]) * 1440 : parseInt(minutesMatch[1]);
                notifications = [{ id: 1, type: 'notification', time: minutes }];
            }
        }
    }
    return {
        uid: firstIcalValue(eventLines, 'UID')?.value || uid,
        title: unescapeIcalText(firstIcalValue(eventLines, 'SUMMARY')?.value || 'Untitled'),
        location: unescapeIcalText(firstIcalValue(eventLines, 'LOCATION')?.value || ''),
        description: unescapeIcalText(firstIcalValue(eventLines, 'DESCRIPTION')?.value || ''),
        start,
        end: endField?.value ? parseIcalDate(endField, allDay, parsedStart).date : fallbackEnd,
        isAllDay: allDay,
        timeKind: parsedStart.timeKind,
        timeZone: parsedStart.timeZone,
        dtstamp: parseIcalDate(firstIcalValue(eventLines, 'DTSTAMP'), false).date,
        recurrence,
        recurrenceLabel: recurrenceLabel(recurrence),
        type: isTask ? 'task' : 'event',
        exdates,
        attendees: attendees || undefined,
        busyStatus,
        notifications,
    };
}
function parseExdates(lines) {
    const excluded = new Set();
    for (const line of lines) {
        const propUpper = line.split(':')[0].split(';')[0].toUpperCase();
        if (propUpper !== 'EXDATE')
            continue;
        const val = line.slice(line.indexOf(':') + 1).trim();
        for (const dateStr of val.split(',')) {
            const clean = dateStr.trim().replace(/[^0-9TZ]/g, '');
            if (clean.length >= 8)
                excluded.add(clean);
        }
    }
    return excluded;
}
function addRecurrenceInterval(date, frequency, interval, timeZone) {
    if (timeZone) {
        const wallTime = wallTimeAt(date, timeZone);
        const surrogate = new Date(Date.UTC(wallTime.year, wallTime.month - 1, wallTime.day, wallTime.hour, wallTime.minute, wallTime.second));
        if (frequency === 'DAILY')
            surrogate.setUTCDate(surrogate.getUTCDate() + interval);
        if (frequency === 'WEEKLY')
            surrogate.setUTCDate(surrogate.getUTCDate() + interval * 7);
        if (frequency === 'MONTHLY')
            surrogate.setUTCMonth(surrogate.getUTCMonth() + interval);
        if (frequency === 'YEARLY')
            surrogate.setUTCFullYear(surrogate.getUTCFullYear() + interval);
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
    if (frequency === 'DAILY')
        next.setUTCDate(next.getUTCDate() + interval);
    if (frequency === 'WEEKLY')
        next.setUTCDate(next.getUTCDate() + interval * 7);
    if (frequency === 'MONTHLY')
        next.setUTCMonth(next.getUTCMonth() + interval);
    if (frequency === 'YEARLY')
        next.setUTCFullYear(next.getUTCFullYear() + interval);
    return next;
}
function expandRecurringEvent(event, rangeStart, rangeEnd, maxOccurrences = 400) {
    if (!event.recurrence)
        return [event];
    const occurrences = [];
    const durationMs = event.end.getTime() - event.start.getTime();
    let occurrenceStart = new Date(event.start);
    let generated = 0;
    while (generated < maxOccurrences) {
        if (event.recurrence.count && generated >= event.recurrence.count)
            break;
        if (event.recurrence.until && occurrenceStart > event.recurrence.until)
            break;
        if (occurrenceStart > rangeEnd)
            break;
        const occurrenceEnd = new Date(occurrenceStart.getTime() + durationMs);
        if (occurrenceEnd >= rangeStart && occurrenceStart <= rangeEnd) {
            const occurrenceKey = formatActiveSyncDate(occurrenceStart);
            const isExcluded = event.exdates && event.exdates.has(occurrenceKey.replace(/Z$/, ''));
            if (!isExcluded) {
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
        occurrenceStart = addRecurrenceInterval(occurrenceStart, event.recurrence.frequency, event.recurrence.interval, event.timeKind === 'zoned' ? event.timeZone : null);
        generated += 1;
    }
    return occurrences;
}
function formatActiveSyncDate(date) {
    return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}
function getCalendarFolderSyncKey(folders) {
    const signature = folders
        .map(folder => `${folder.serverId}\t${folder.displayName}\t${folder.type}`)
        .sort()
        .join('\n');
    return `oms-${(0, crypto_1.createHash)('sha1').update(signature).digest('hex').slice(0, 12)}`;
}
//# sourceMappingURL=calendar-format.js.map