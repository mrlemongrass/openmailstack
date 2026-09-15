"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.contactActivityAttendeePattern = exports.contactActivityAddressPattern = exports.appsApiRouter = void 0;
const contact_groups_1 = require("./contact-groups");
const express_1 = require("express");
const crypto = __importStar(require("crypto"));
const db_1 = require("./db");
const auth_1 = require("./auth");
const calendar_utils_1 = require("./calendar-utils");
const eas_calendar_1 = require("./eas-calendar");
const birthday_calendar_1 = require("./birthday-calendar");
const calendar_subscription_http_1 = require("./calendar-subscription-http");
const calendar_subscription_1 = require("./calendar-subscription");
const calendar_ical_validation_1 = require("./calendar-ical-validation");
const calendar_format_1 = require("./calendar-format");
const contact_utils_1 = require("./contact-utils");
const calendar_invitations_1 = require("./calendar-invitations");
const outbound_mail_1 = require("./outbound-mail");
const scheduled_send_1 = require("./scheduled-send");
const universal_outbox_1 = require("./universal-outbox");
exports.appsApiRouter = (0, express_1.Router)();
// Middleware to protect routes and extract username
const authenticateApp = (req, res, next) => {
    (0, auth_1.requireSession)(req, res, () => {
        req.username = req.user.username;
        next();
    });
};
exports.appsApiRouter.use(authenticateApp);
function emitContactsUpdated(user, details = {}) {
    try {
        const { io } = require('./index');
        io.to(user).emit('contacts_updated', details);
    }
    catch { }
}
function emitCalendarUpdated(user, calendarId) {
    try {
        const { io } = require('./index');
        io.to(user).emit('calendar_updated', { calendarId });
    }
    catch { }
}
async function userCanWriteCalendarOnConnection(connection, user, calendarId, ownerOnly = false) {
    const [rows] = await connection.query(ownerOnly
        ? `SELECT id, dav_slug, subscribed_url FROM calendars
               WHERE id = ? AND user_id = ?
               FOR UPDATE`
        : `SELECT c.id, c.dav_slug, c.subscribed_url
               FROM calendars c
               LEFT JOIN calendar_shares cs ON cs.calendar_id = c.id AND cs.shared_with_user_id = ?
               WHERE c.id = ? AND (c.user_id = ? OR cs.permission = 'write')
               FOR UPDATE`, ownerOnly ? [calendarId, user] : [user, calendarId, user]);
    return rows.length === 1
        && !(0, birthday_calendar_1.isManagedBirthdayCalendar)(rows[0])
        && !String(rows[0].subscribed_url || '').trim();
}
function isDuplicateKeyError(error) {
    const candidate = error;
    return candidate?.code === 'ER_DUP_ENTRY' || Number(candidate?.errno) === 1062;
}
function normalizedCalendarSubscriptionUrl(value) {
    if (value === undefined || value === null || (typeof value === 'string' && !value.trim()))
        return null;
    return (0, calendar_subscription_http_1.validateCalendarSubscriptionUrl)(value).toString();
}
const MAX_WEB_CALENDAR_RESOURCES = 1_000;
const MAX_CONCURRENT_MANUAL_SUBSCRIPTION_REFRESHES = 2;
let activeManualSubscriptionRefreshes = 0;
const activeManualSubscriptionOwners = new Set();
function beginManualSubscriptionRefresh(user) {
    if (activeManualSubscriptionRefreshes >= MAX_CONCURRENT_MANUAL_SUBSCRIPTION_REFRESHES
        || activeManualSubscriptionOwners.has(user)) {
        return null;
    }
    activeManualSubscriptionRefreshes += 1;
    activeManualSubscriptionOwners.add(user);
    let released = false;
    return () => {
        if (released)
            return;
        released = true;
        activeManualSubscriptionRefreshes = Math.max(0, activeManualSubscriptionRefreshes - 1);
        activeManualSubscriptionOwners.delete(user);
    };
}
function validatedWebCalendarEvent(input) {
    const validated = (0, calendar_ical_validation_1.validateICalendarDocument)(input, {
        maxResourceComponents: MAX_WEB_CALENDAR_RESOURCES,
    });
    if (validated.resources.length !== 1 || validated.resources[0].componentType !== 'VEVENT') {
        throw new calendar_ical_validation_1.ICalendarValidationError('Calendar event data must contain exactly one VEVENT resource');
    }
    return validated.resources[0];
}
/**
 * The shared validator has already proved component nesting at this point.
 * This small structural walk only separates its canonical top-level blocks so
 * export can combine stored resources without regex-truncating recurrence
 * exceptions or their VTIMEZONE definitions.
 */
function validatedTopLevelCalendarBlocks(icalData) {
    const lines = icalData.replaceAll('\r\n', '\n').replaceAll('\r', '\n').split('\n');
    const blocks = [];
    let depth = 0;
    let currentType = '';
    let currentLines = [];
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
        if (marker === 'BEGIN')
            depth += 1;
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
function validCalendarDateTimeParts(parts) {
    const [year, month, day, hour = 0, minute = 0, second = 0] = parts;
    const value = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
    return value.getUTCFullYear() === year
        && value.getUTCMonth() + 1 === month
        && value.getUTCDate() === day
        && value.getUTCHours() === hour
        && value.getUTCMinutes() === minute
        && value.getUTCSeconds() === second;
}
function parseOccurrenceExclusion(value) {
    const input = value.trim();
    if (!input || Buffer.byteLength(input, 'utf8') > 64) {
        throw new calendar_ical_validation_1.ICalendarValidationError('Invalid recurring occurrence date');
    }
    const dateOnly = input.match(/^(\d{4})-?(\d{2})-?(\d{2})$/);
    if (dateOnly) {
        const parts = dateOnly.slice(1).map(Number);
        if (!validCalendarDateTimeParts(parts))
            throw new calendar_ical_validation_1.ICalendarValidationError('Invalid recurring occurrence date');
        return { date: dateOnly.slice(1).join(''), localDateTime: null, instant: null };
    }
    const dateTime = input.match(/^(\d{4})-?(\d{2})-?(\d{2})T(\d{2}):?(\d{2}):?(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:?\d{2})?$/);
    if (!dateTime)
        throw new calendar_ical_validation_1.ICalendarValidationError('Invalid recurring occurrence date');
    const parts = dateTime.slice(1, 7).map(Number);
    if (!validCalendarDateTimeParts(parts))
        throw new calendar_ical_validation_1.ICalendarValidationError('Invalid recurring occurrence date');
    const date = dateTime.slice(1, 4).join('');
    const localDateTime = `${date}T${dateTime.slice(4, 7).join('')}`;
    if (!dateTime[7])
        return { date, localDateTime, instant: null };
    const zone = /^[+-]\d{4}$/.test(dateTime[7])
        ? `${dateTime[7].slice(0, 3)}:${dateTime[7].slice(3)}`
        : dateTime[7];
    const iso = `${dateTime[1]}-${dateTime[2]}-${dateTime[3]}T${dateTime[4]}:${dateTime[5]}:${dateTime[6]}${zone}`;
    const instant = new Date(iso);
    if (!Number.isFinite(instant.getTime()))
        throw new calendar_ical_validation_1.ICalendarValidationError('Invalid recurring occurrence date');
    return { date, localDateTime, instant };
}
function compactUtcDateTime(value) {
    return value.toISOString().slice(0, 19).replaceAll('-', '').replaceAll(':', '') + 'Z';
}
function compactDateTimeInZone(value, timeZone) {
    let parts;
    try {
        parts = new Intl.DateTimeFormat('en-US', {
            timeZone,
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: '2-digit', minute: '2-digit', second: '2-digit',
            hourCycle: 'h23',
        }).formatToParts(value);
    }
    catch {
        throw new calendar_ical_validation_1.ICalendarValidationError('Invalid recurring occurrence time zone');
    }
    const part = (type) => parts.find(candidate => candidate.type === type)?.value || '';
    const formatted = `${part('year')}${part('month')}${part('day')}T${part('hour')}${part('minute')}${part('second')}`;
    if (!/^\d{8}T\d{6}$/.test(formatted))
        throw new calendar_ical_validation_1.ICalendarValidationError('Invalid recurring occurrence time zone');
    return formatted;
}
function unfoldedCalendarLines(source) {
    const lines = [];
    for (const line of source.replaceAll('\r\n', '\n').replaceAll('\r', '\n').split('\n')) {
        if (/^[ \t]/.test(line))
            lines[lines.length - 1] += line.slice(1);
        else
            lines.push(line);
    }
    return lines;
}
function calendarProperty(line) {
    const separator = line.indexOf(':');
    if (separator < 1)
        throw new calendar_ical_validation_1.ICalendarValidationError('Invalid iCalendar property');
    const header = line.slice(0, separator);
    return { name: header.split(';', 1)[0].toUpperCase(), header, value: line.slice(separator + 1) };
}
function calendarRecurrenceIdentity(header, value) {
    const valueType = header.match(/(?:^|;)VALUE=(?:"([^"]+)"|([^;]+))/i)?.slice(1).find(Boolean)
        || (/^\d{8}(?:,|$)/.test(value) ? 'DATE' : 'DATE-TIME');
    const timeZone = header.match(/(?:^|;)TZID=(?:"([^"]+)"|([^;]+))/i)?.slice(1).find(Boolean) || '';
    return `${valueType.toUpperCase()}\0${timeZone.trim()}`;
}
function addRecurringOccurrenceExclusion(source, exclude) {
    const resource = validatedWebCalendarEvent(source);
    const parsedEvent = (0, calendar_utils_1.parseIcalEvent)(resource.uid, resource.icalData);
    if (parsedEvent.recurrenceExceptionOverflow) {
        throw new calendar_ical_validation_1.ICalendarValidationError('This recurring event has too many exceptions to remove one occurrence safely');
    }
    if (parsedEvent.recurrenceExceptionIdentityConflict) {
        throw new calendar_ical_validation_1.ICalendarValidationError('This recurring event has ambiguous exception identities');
    }
    const lines = unfoldedCalendarLines(resource.icalData);
    const stack = [];
    const masters = [];
    const exceptions = [];
    let current = null;
    for (let index = 0; index < lines.length; index += 1) {
        const boundary = lines[index].match(/^(BEGIN|END):([A-Z0-9-]+)$/i);
        if (boundary?.[1].toUpperCase() === 'BEGIN') {
            if (stack.length === 1 && boundary[2].toUpperCase() === 'VEVENT')
                current = { direct: [] };
            stack.push(boundary[2].toUpperCase());
            continue;
        }
        if (boundary?.[1].toUpperCase() === 'END') {
            if (current && stack.length === 2 && stack[1] === 'VEVENT') {
                const recurringInstance = current.direct.some(lineIndex => calendarProperty(lines[lineIndex]).name === 'RECURRENCE-ID');
                const component = { end: index, direct: current.direct };
                if (recurringInstance)
                    exceptions.push(component);
                else
                    masters.push(component);
                current = null;
            }
            stack.pop();
            continue;
        }
        if (current && stack.length === 2 && lines[index])
            current.direct.push(index);
    }
    if (masters.length !== 1)
        throw new calendar_ical_validation_1.ICalendarValidationError('Recurring event master is missing');
    const master = masters[0];
    if (!master.direct.some(index => calendarProperty(lines[index]).name === 'RRULE')) {
        throw new calendar_ical_validation_1.ICalendarValidationError('Event is not recurring');
    }
    const dtstartIndex = master.direct.find(index => calendarProperty(lines[index]).name === 'DTSTART');
    if (dtstartIndex === undefined)
        throw new calendar_ical_validation_1.ICalendarValidationError('Recurring event DTSTART is missing');
    if (exceptions.some(exception => exception.direct.some(index => {
        const property = calendarProperty(lines[index]);
        return property.name === 'RECURRENCE-ID' && /(?:^|;)RANGE=/i.test(property.header);
    }))) {
        throw new calendar_ical_validation_1.ICalendarValidationError('This event uses a this-and-future recurrence change that cannot be removed as one occurrence yet');
    }
    const occurrence = parseOccurrenceExclusion(exclude);
    const normalizedOccurrence = occurrence.instant
        ? compactUtcDateTime(occurrence.instant)
        : occurrence.localDateTime || occurrence.date;
    const recurrenceIdentity = calendarProperty((0, calendar_invitations_1.calendarRecurrenceIdLine)(resource.icalData, normalizedOccurrence));
    const parameters = recurrenceIdentity.header.slice('RECURRENCE-ID'.length);
    const exclusionValue = recurrenceIdentity.value;
    const parameterIdentity = calendarRecurrenceIdentity(`EXDATE${parameters}`, exclusionValue);
    const alreadyExcluded = master.direct.some(index => {
        const property = calendarProperty(lines[index]);
        return property.name === 'EXDATE'
            && calendarRecurrenceIdentity(property.header, property.value) === parameterIdentity
            && property.value.split(',').includes(exclusionValue);
    });
    const insertions = [];
    let changed = false;
    if (!alreadyExcluded) {
        insertions.push({ index: master.end, line: `EXDATE${parameters}:${exclusionValue}` });
        changed = true;
    }
    const recurrenceParameterIdentity = calendarRecurrenceIdentity(`RECURRENCE-ID${parameters}`, exclusionValue);
    const utcOccurrenceValue = occurrence.instant ? compactUtcDateTime(occurrence.instant) : null;
    const exceptionInstantBySource = new Map((parsedEvent.recurrenceExceptions || []).map(exception => [
        JSON.stringify([exception.sourceParameters || '', exception.sourceValue || '']),
        compactUtcDateTime(exception.recurrenceId),
    ]));
    for (const exception of exceptions) {
        const recurrenceId = exception.direct
            .map(index => ({ index, property: calendarProperty(lines[index]) }))
            .find(candidate => candidate.property.name === 'RECURRENCE-ID');
        if (!recurrenceId)
            continue;
        const recurrenceHeaderWithoutRange = recurrenceId.property.header.replace(/;RANGE=[^;:]*/i, '');
        const exactSeriesIdentity = calendarRecurrenceIdentity(recurrenceHeaderWithoutRange, recurrenceId.property.value) === recurrenceParameterIdentity
            && recurrenceId.property.value === exclusionValue;
        const equivalentUtcIdentity = Boolean(utcOccurrenceValue
            && recurrenceId.property.value === utcOccurrenceValue
            && !/(?:^|;)TZID=/i.test(recurrenceId.property.header));
        const equivalentParsedIdentity = Boolean(utcOccurrenceValue
            && exceptionInstantBySource.get(JSON.stringify([
                recurrenceId.property.header.slice('RECURRENCE-ID'.length),
                recurrenceId.property.value,
            ])) === utcOccurrenceValue);
        if (!exactSeriesIdentity && !equivalentUtcIdentity && !equivalentParsedIdentity)
            continue;
        const statusIndex = exception.direct.find(index => calendarProperty(lines[index]).name === 'STATUS');
        if (statusIndex === undefined) {
            insertions.push({ index: exception.end, line: 'STATUS:CANCELLED' });
            changed = true;
        }
        else if (calendarProperty(lines[statusIndex]).value.toUpperCase() !== 'CANCELLED') {
            lines[statusIndex] = 'STATUS:CANCELLED';
            changed = true;
        }
    }
    if (!changed)
        return resource.icalData;
    insertions.sort((left, right) => right.index - left.index);
    for (const insertion of insertions)
        lines.splice(insertion.index, 0, insertion.line);
    const rebuilt = validatedWebCalendarEvent(lines.join('\r\n'));
    if (rebuilt.uid !== resource.uid)
        throw new calendar_ical_validation_1.ICalendarValidationError('Recurring event identity changed');
    return rebuilt.icalData;
}
function recurringOccurrenceIsCancelled(source, exclude) {
    const occurrence = parseOccurrenceExclusion(exclude);
    const parsed = (0, calendar_utils_1.parseIcalEvent)(validatedWebCalendarEvent(source).uid, source);
    const targetId = occurrence.instant
        ? compactUtcDateTime(occurrence.instant)
        : occurrence.localDateTime ? `${occurrence.localDateTime}Z` : occurrence.date;
    if (parsed.excludedOccurrenceIds?.has(targetId))
        return true;
    return (parsed.recurrenceExceptions || []).some(exception => {
        if (!exception.deleted)
            return false;
        if (occurrence.instant) {
            return (0, calendar_utils_1.formatActiveSyncDate)(exception.recurrenceId) === compactUtcDateTime(occurrence.instant);
        }
        if (!occurrence.localDateTime) {
            return exception.recurrenceId.toISOString().slice(0, 10).replaceAll('-', '') === occurrence.date;
        }
        return (0, calendar_utils_1.formatActiveSyncDate)(exception.recurrenceId).replace(/Z$/, '') === occurrence.localDateTime;
    });
}
function recurringOccurrenceExists(source, exclude) {
    const occurrence = parseOccurrenceExclusion(exclude);
    const anchor = occurrence.instant || new Date(Date.UTC(Number(occurrence.date.slice(0, 4)), Number(occurrence.date.slice(4, 6)) - 1, Number(occurrence.date.slice(6, 8)), occurrence.localDateTime ? Number(occurrence.localDateTime.slice(9, 11)) : 12, occurrence.localDateTime ? Number(occurrence.localDateTime.slice(11, 13)) : 0, occurrence.localDateTime ? Number(occurrence.localDateTime.slice(13, 15)) : 0));
    const parsed = (0, calendar_utils_1.parseIcalEvent)(validatedWebCalendarEvent(source).uid, source);
    if (!parsed.recurrence)
        return false;
    const rawRuleParts = parsed.recurrence.raw.split(';');
    const unsupportedRuleParts = rawRuleParts.filter(part => {
        const name = part.split('=', 1)[0].trim().toUpperCase();
        return !['FREQ', 'INTERVAL', 'COUNT', 'UNTIL'].includes(name);
    });
    const parsedRuleParts = rawRuleParts.map(part => {
        const separator = part.indexOf('=');
        return separator < 1
            ? { name: '', value: '' }
            : { name: part.slice(0, separator).trim().toUpperCase(), value: part.slice(separator + 1).trim() };
    });
    const ruleValues = new Map(parsedRuleParts.map(part => [part.name, part.value]));
    const duplicateRulePart = new Set(parsedRuleParts.map(part => part.name)).size !== parsedRuleParts.length;
    const interval = ruleValues.get('INTERVAL');
    const count = ruleValues.get('COUNT');
    const until = ruleValues.get('UNTIL');
    const invalidInterval = interval !== undefined
        && (!/^\d+$/.test(interval) || Number(interval) < 1 || Number(interval) > 365);
    const invalidCount = count !== undefined
        && (!/^\d+$/.test(count) || Number(count) < 1 || !Number.isSafeInteger(Number(count)));
    const untilMatch = until === undefined
        ? null
        : parsed.isAllDay
            ? until.match(/^(\d{4})(\d{2})(\d{2})$/)
            : parsed.timeKind === 'utc' || parsed.timeKind === 'zoned'
                ? until.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/)
                : until.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/);
    const invalidUntil = until !== undefined && (!untilMatch || !validCalendarDateTimeParts(untilMatch.slice(1).map(Number)));
    if (unsupportedRuleParts.length > 0 || duplicateRulePart
        || ruleValues.get('FREQ')?.toUpperCase() !== parsed.recurrence.frequency
        || invalidInterval || invalidCount || invalidUntil || (count !== undefined && until !== undefined)) {
        throw new calendar_invitations_1.CalendarInvitationActionError('UNSUPPORTED_RECURRENCE_RULE', 'This recurrence pattern cannot yet be validated safely for one-occurrence cancellation.', 409);
    }
    if (parsed.recurrence.frequency !== 'DAILY' && parsed.recurrence.frequency !== 'WEEKLY') {
        throw new calendar_invitations_1.CalendarInvitationActionError('UNSUPPORTED_RECURRENCE_RULE', 'Monthly and yearly recurrence membership cannot yet be validated safely for one-occurrence cancellation.', 409);
    }
    if (parsed.recurrence.frequency === 'DAILY' || parsed.recurrence.frequency === 'WEEKLY') {
        const wallKey = (value) => parsed.timeKind === 'zoned' && parsed.timeZone
            ? compactDateTimeInZone(value, parsed.timeZone)
            : (0, calendar_utils_1.formatActiveSyncDate)(value).replace(/Z$/, '');
        const startKey = parsed.timeKind === 'zoned' && parsed.recurrenceWallStart
            ? [
                String(parsed.recurrenceWallStart.year).padStart(4, '0'),
                String(parsed.recurrenceWallStart.month).padStart(2, '0'),
                String(parsed.recurrenceWallStart.day).padStart(2, '0'),
                'T',
                String(parsed.recurrenceWallStart.hour).padStart(2, '0'),
                String(parsed.recurrenceWallStart.minute).padStart(2, '0'),
                String(parsed.recurrenceWallStart.second).padStart(2, '0'),
            ].join('')
            : wallKey(parsed.start);
        let candidateKey = wallKey(anchor);
        if (parsed.isAllDay && !occurrence.localDateTime) {
            candidateKey = `${occurrence.date}${startKey.slice(8)}`;
        }
        if (parsed.timeKind === 'zoned' && parsed.timeZone && occurrence.instant) {
            const renderedCandidate = compactDateTimeInZone(anchor, parsed.timeZone);
            candidateKey = `${renderedCandidate.slice(0, 8)}${startKey.slice(8)}`;
            const expectedInstant = (0, calendar_format_1.wallTimeToInstant)({
                year: Number(candidateKey.slice(0, 4)),
                month: Number(candidateKey.slice(4, 6)),
                day: Number(candidateKey.slice(6, 8)),
                hour: Number(candidateKey.slice(9, 11)),
                minute: Number(candidateKey.slice(11, 13)),
                second: Number(candidateKey.slice(13, 15)),
            }, parsed.timeZone);
            if (expectedInstant.getTime() !== anchor.getTime())
                return false;
        }
        if (startKey.slice(8) !== candidateKey.slice(8))
            return false;
        const dayValue = (key) => Date.UTC(Number(key.slice(0, 4)), Number(key.slice(4, 6)) - 1, Number(key.slice(6, 8)));
        const elapsedDays = (dayValue(candidateKey) - dayValue(startKey)) / (24 * 60 * 60 * 1000);
        const cadenceDays = (parsed.recurrence.frequency === 'WEEKLY' ? 7 : 1)
            * Math.max(1, parsed.recurrence.interval || 1);
        if (!Number.isInteger(elapsedDays) || elapsedDays < 0 || elapsedDays % cadenceDays !== 0)
            return false;
        const ordinal = elapsedDays / cadenceDays;
        if (parsed.recurrence.count && ordinal >= parsed.recurrence.count)
            return false;
        const candidateForUntil = parsed.isAllDay
            ? new Date(dayValue(candidateKey))
            : anchor;
        if (parsed.recurrence.until && candidateForUntil > parsed.recurrence.until)
            return false;
        return true;
    }
    return false;
}
function legacyCalendarBoundary(line) {
    const separator = line.indexOf(':');
    if (separator < 1)
        return null;
    const marker = line.slice(0, separator).toUpperCase();
    if (marker !== 'BEGIN' && marker !== 'END')
        return null;
    const type = line.slice(separator + 1).toUpperCase();
    return type ? { marker, type } : null;
}
function legacyCalendarPropertyName(line) {
    const separator = line.indexOf(':');
    return separator > 0 ? line.slice(0, separator).split(';', 1)[0].toUpperCase() : '';
}
function structurallyParseLegacyCalendar(source) {
    if (Buffer.byteLength(source, 'utf8') > calendar_ical_validation_1.MAX_ICAL_DOCUMENT_BYTES) {
        throw new calendar_ical_validation_1.ICalendarValidationError('Legacy calendar resource is too large');
    }
    const physicalLines = source.replaceAll('\r\n', '\n').replaceAll('\r', '\n').split('\n');
    const lines = [];
    for (const line of physicalLines) {
        if (line.startsWith(' ') || line.startsWith('\t')) {
            if (lines.length === 0)
                throw new calendar_ical_validation_1.ICalendarValidationError('Invalid legacy iCalendar folding');
            lines[lines.length - 1] += line.slice(1);
        }
        else {
            lines.push(line);
        }
    }
    const calendarProperties = [];
    const components = [];
    const stack = [];
    let current = null;
    let rootSeen = false;
    let rootClosed = false;
    for (const line of lines) {
        const boundary = legacyCalendarBoundary(line);
        if (boundary?.marker === 'BEGIN') {
            if (stack.length === 0) {
                if (rootSeen || rootClosed || boundary.type !== 'VCALENDAR') {
                    throw new calendar_ical_validation_1.ICalendarValidationError('Invalid legacy iCalendar root');
                }
                rootSeen = true;
            }
            else if (stack.length === 1) {
                current = { type: boundary.type, lines: [line] };
            }
            else {
                current?.lines.push(line);
            }
            stack.push(boundary.type);
            continue;
        }
        if (boundary?.marker === 'END') {
            if (stack.length === 0 || stack[stack.length - 1] !== boundary.type) {
                throw new calendar_ical_validation_1.ICalendarValidationError('Mismatched legacy iCalendar component');
            }
            if (stack.length >= 2)
                current?.lines.push(line);
            stack.pop();
            if (stack.length === 1 && current) {
                components.push(current);
                current = null;
            }
            else if (stack.length === 0) {
                if (boundary.type !== 'VCALENDAR') {
                    throw new calendar_ical_validation_1.ICalendarValidationError('Invalid legacy iCalendar root closure');
                }
                rootClosed = true;
            }
            continue;
        }
        if (stack.length === 0) {
            if (line.trim())
                throw new calendar_ical_validation_1.ICalendarValidationError('Data outside legacy VCALENDAR is not allowed');
        }
        else if (stack.length === 1) {
            if (line)
                calendarProperties.push(line);
        }
        else if (line) {
            current?.lines.push(line);
        }
    }
    if (!rootSeen || !rootClosed || stack.length !== 0 || current) {
        throw new calendar_ical_validation_1.ICalendarValidationError('Truncated legacy iCalendar resource');
    }
    return { calendarProperties, components };
}
function legacyExportDtstamp(updatedAt) {
    let timestamp;
    if (updatedAt instanceof Date)
        timestamp = updatedAt;
    else {
        const value = String(updatedAt || '').trim();
        const mysqlUtc = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value)
            ? `${value.replace(' ', 'T')}Z`
            : value;
        timestamp = new Date(mysqlUtc);
    }
    if (!Number.isFinite(timestamp.getTime()))
        return '19700101T000000Z';
    return timestamp.toISOString().replaceAll('-', '').replaceAll(':', '').replace(/\.\d{3}Z$/, 'Z');
}
function addMissingLegacyDtstamp(component, dtstamp) {
    if (component.type !== 'VEVENT')
        return component.lines;
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
        if (depth !== 0)
            continue;
        const propertyName = legacyCalendarPropertyName(line);
        if (propertyName === 'DTSTAMP')
            directDtstamps += 1;
        if (propertyName === 'UID' && uidIndex < 0)
            uidIndex = index;
    }
    if (directDtstamps !== 0)
        return component.lines;
    const normalized = [...component.lines];
    normalized.splice(uidIndex >= 0 ? uidIndex + 1 : 1, 0, `DTSTAMP:${dtstamp}`);
    return normalized;
}
function validateStoredCalendarForExport(icalData, updatedAt) {
    const validationOptions = {
        allowMultipleResourceUids: true,
        maxResourceComponents: MAX_WEB_CALENDAR_RESOURCES,
    };
    try {
        return (0, calendar_ical_validation_1.validateICalendarDocument)(icalData, validationOptions);
    }
    catch {
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
        return (0, calendar_ical_validation_1.validateICalendarDocument)(normalized, validationOptions);
    }
}
// ==========================================
// CONTACTS API
// ==========================================
exports.appsApiRouter.get('/contacts', async (req, res) => {
    const user = req.username;
    const offset = parseInt(req.query.offset || '0', 10) || 0;
    const limit = Math.min(parseInt(req.query.limit || '200', 10) || 200, 500);
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
        await (0, contact_utils_1.purgeExpiredContacts)(user);
        const whereParts = ['username = ?', 'deleted_at IS NULL'];
        const whereParams = [user];
        if (req.query.groupId !== undefined) {
            const groupId = Number(req.query.groupId);
            if (!/^[1-9]\d*$/.test(String(req.query.groupId)) || !Number.isSafeInteger(groupId)) {
                return res.status(400).json({ success: false, error: 'Invalid group ID' });
            }
            whereParts.push(`EXISTS (SELECT 1 FROM contact_group_members m JOIN contact_groups g ON g.id = m.group_id
                WHERE m.contact_id = contacts.id AND g.username = contacts.username COLLATE utf8mb4_unicode_ci AND g.id = ?)`);
            whereParams.push(groupId);
        }
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
        const [countRows] = await db_1.pool.query(`SELECT COUNT(*) AS total FROM contacts WHERE ${whereSql}`, whereParams);
        const [rows] = await db_1.pool.query(`SELECT id, username, name, email, phone, dav_uid, sync_token, updated_at,
                    emails_json, phones_json, addresses_json, job_title, organization,
                    notes, labels_json, photo_url, is_favorite,
                    prefix, first_name, middle_name, last_name, suffix, nickname,
                    department, birthday, website_url
             FROM contacts WHERE ${whereSql}
             ORDER BY ${orderBy}
             LIMIT ? OFFSET ?`, [...whereParams, limit + 1, offset]);
        const hasMore = rows.length > limit;
        if (hasMore)
            rows.pop();
        // Parse JSON columns (mysql2 returns them as strings)
        for (const row of rows) {
            for (const col of ['emails_json', 'phones_json', 'addresses_json', 'labels_json']) {
                if (typeof row[col] === 'string') {
                    try {
                        row[col] = JSON.parse(row[col]);
                    }
                    catch { }
                }
            }
        }
        res.json({ success: true, contacts: rows, hasMore, total: Number(countRows[0]?.total || 0) });
    }
    catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});
exports.appsApiRouter.post('/contacts', async (req, res) => {
    const user = req.username;
    const { name, email, phone, vcard_data, emails_json, phones_json, addresses_json, job_title, organization, notes, labels_json, photo_url } = req.body;
    try {
        const davUid = (0, contact_utils_1.createContactUid)();
        const suppliedVCard = typeof vcard_data === 'string' && vcard_data.trim() ? vcard_data : '';
        if ((0, contact_groups_1.isGroupVCard)(suppliedVCard))
            throw new contact_groups_1.ContactGroupError('Use per-contact categories for contact groups');
        const categories = (0, contact_groups_1.vCardCategories)(suppliedVCard);
        const suppliedContact = suppliedVCard ? (0, contact_utils_1.parseVCard)(suppliedVCard) : null;
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
            ? (0, contact_utils_1.normalizeContactBirthday)(req.body.birthday)
            : suppliedVCard
                ? (0, contact_utils_1.extractVCardBirthday)(suppliedVCard)
                : null;
        const fullName = name
            || suppliedContact?.name
            || [prefix, firstName, middleName, lastName, suffix].filter(Boolean).join(' ')
            || resolvedEmail
            || '';
        const vcardBase = suppliedVCard
            ? (0, contact_utils_1.normalizeVCardData)(suppliedVCard, davUid, {
                name: fullName,
                email: resolvedEmail,
                phone: resolvedPhone,
            })
            : '';
        const newVcardData = (0, contact_utils_1.patchVCardData)(vcardBase, davUid, {
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
        const result = await (0, contact_utils_1.withContactMutation)(user, async (connection) => {
            const syncToken = await (0, contact_utils_1.nextContactSyncTokenOnConnection)(connection, user);
            const [insertResult] = await connection.query(`INSERT INTO contacts
                (username, name, email, phone, vcard_data, dav_uid, emails_json, phones_json, addresses_json, job_title, organization, notes, labels_json, photo_url, sync_token, prefix, first_name, middle_name, last_name, suffix, nickname, department, birthday, website_url)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
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
            ]);
            if (categories.length)
                await (0, contact_groups_1.syncContactCategoryMemberships)(connection, user, Number(insertResult.insertId), categories);
            await (0, birthday_calendar_1.syncContactBirthdayEvent)(connection, user, {
                contactId: insertResult.insertId,
                davUid,
                name: fullName || resolvedEmail,
                email: resolvedEmail,
            }, birthday);
            return insertResult;
        });
        emitContactsUpdated(user, { contactId: result.insertId });
        res.json({ success: true, id: result.insertId });
    }
    catch (e) {
        if (e instanceof contact_groups_1.ContactGroupError)
            return res.status(e.status).json({ success: false, error: e.message });
        if (e instanceof contact_utils_1.InvalidContactBirthdayError) {
            return res.status(400).json({ success: false, error: e.message });
        }
        res.status(500).json({ success: false, error: e.message });
    }
});
exports.appsApiRouter.put('/contacts/:id', async (req, res) => {
    const user = req.username;
    const { name, email, phone, vcard_data, emails_json, phones_json, addresses_json, job_title, organization, notes, labels_json, photo_url, prefix, first_name, middle_name, last_name, suffix, nickname, department, birthday, website_url } = req.body;
    try {
        if (typeof vcard_data === 'string' && (0, contact_groups_1.isGroupVCard)(vcard_data))
            throw new contact_groups_1.ContactGroupError('Use per-contact categories for contact groups');
        const requestedBirthday = Object.prototype.hasOwnProperty.call(req.body, 'birthday')
            ? (0, contact_utils_1.normalizeContactBirthday)(birthday)
            : typeof vcard_data === 'string'
                ? (0, contact_utils_1.extractVCardBirthday)(vcard_data)
                : undefined;
        const saved = await (0, contact_utils_1.withContactMutation)(user, async (connection) => {
            const [existing] = await connection.query('SELECT * FROM contacts WHERE id=? AND username=? AND deleted_at IS NULL', [req.params.id, user]);
            if (existing.length === 0)
                return null;
            const existingContact = existing[0];
            const previousBirthdayIdentity = {
                contactId: existingContact.id,
                davUid: existingContact.dav_uid,
                name: existingContact.name,
                email: existingContact.email,
            };
            const davUid = existingContact.dav_uid || `contact-${existingContact.id}`;
            const savedBirthday = requestedBirthday === undefined
                ? (0, contact_utils_1.normalizeContactBirthday)(existingContact.birthday)
                : requestedBirthday;
            const baseVCard = typeof vcard_data === 'string'
                ? (0, contact_utils_1.normalizeVCardData)(vcard_data, davUid, {
                    name: name || existingContact.name || '',
                    email: email || existingContact.email || '',
                    phone: phone || existingContact.phone || '',
                })
                : (0, contact_utils_1.normalizeVCardData)(existingContact.vcard_data || '', davUid, {
                    name: existingContact.name || '',
                    email: existingContact.email || '',
                    phone: existingContact.phone || '',
                });
            const baseContact = (0, contact_utils_1.parseVCard)(baseVCard);
            const fullName = name
                || [prefix, first_name, middle_name, last_name, suffix].filter(Boolean).join(' ')
                || email
                || baseContact.name
                || '';
            const newVcardData = (0, contact_utils_1.patchVCardData)(baseVCard, davUid, {
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
            const syncToken = await (0, contact_utils_1.nextContactSyncTokenOnConnection)(connection, user);
            const queryParams = [
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
            queryParams.push(req.params.id, user);
            await connection.query(updateSql, queryParams);
            if ((0, contact_groups_1.hasVCardCategories)(newVcardData) || (0, contact_groups_1.hasVCardCategories)(String(existingContact.vcard_data || ''))) {
                await (0, contact_groups_1.syncContactCategoryMemberships)(connection, user, Number(existingContact.id), (0, contact_groups_1.vCardCategories)(newVcardData));
            }
            const currentBirthdayIdentity = {
                contactId: existingContact.id,
                davUid: existingContact.dav_uid || `contact-${existingContact.id}`,
                name: fullName || existingContact.email || '',
                email: email || existingContact.email || '',
            };
            await (0, birthday_calendar_1.syncContactBirthdayEvent)(connection, user, currentBirthdayIdentity, savedBirthday, [previousBirthdayIdentity, currentBirthdayIdentity]);
            return true;
        });
        if (!saved)
            return res.status(404).json({ success: false, error: 'Contact not found' });
        emitContactsUpdated(user, { contactId: req.params.id });
        res.json({ success: true });
    }
    catch (e) {
        if (e instanceof contact_groups_1.ContactGroupError)
            return res.status(e.status).json({ success: false, error: e.message });
        if (e instanceof contact_utils_1.InvalidContactBirthdayError) {
            return res.status(400).json({ success: false, error: e.message });
        }
        res.status(500).json({ success: false, error: e.message });
    }
});
exports.appsApiRouter.put('/contacts/:id/favorite', async (req, res) => {
    const user = req.username;
    try {
        const favorite = await (0, contact_utils_1.withContactMutation)(user, async (connection) => {
            const syncToken = await (0, contact_utils_1.nextContactSyncTokenOnConnection)(connection, user);
            const [result] = await connection.query('UPDATE contacts SET is_favorite = IF(is_favorite, 0, 1), sync_token = ? WHERE id = ? AND username = ? AND deleted_at IS NULL', [syncToken, req.params.id, user]);
            if (result.affectedRows === 0)
                return null;
            const [rows] = await connection.query('SELECT is_favorite FROM contacts WHERE id = ? AND username = ? AND deleted_at IS NULL', [req.params.id, user]);
            return rows[0]?.is_favorite === 1;
        });
        if (favorite === null)
            return res.status(404).json({ success: false, error: 'Contact not found' });
        emitContactsUpdated(user, { contactId: req.params.id });
        res.json({ success: true, is_favorite: favorite });
    }
    catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});
exports.appsApiRouter.post('/contacts/bulk-delete', async (req, res) => {
    const user = req.username;
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0)
        return res.status(400).json({ success: false, error: 'ids array required' });
    try {
        const deleted = await (0, contact_utils_1.withContactMutation)(user, async (connection) => {
            const placeholders = ids.map(() => '?').join(',');
            const [rows] = await connection.query(`SELECT id, name, email, dav_uid, birthday FROM contacts
                 WHERE id IN (${placeholders}) AND username = ? AND deleted_at IS NULL`, [...ids, user]);
            if (rows.length === 0)
                return 0;
            const syncToken = await (0, contact_utils_1.nextContactSyncTokenOnConnection)(connection, user);
            const activeIds = rows.map((row) => row.id);
            const activePlaceholders = activeIds.map(() => '?').join(',');
            const [result] = await connection.query(`UPDATE contacts SET deleted_at = NOW(), sync_token = ?
                 WHERE id IN (${activePlaceholders}) AND username = ? AND deleted_at IS NULL`, [syncToken, ...activeIds, user]);
            for (const contact of rows) {
                const identity = {
                    contactId: contact.id,
                    davUid: contact.dav_uid || `contact-${contact.id}`,
                    name: contact.name,
                    email: contact.email,
                };
                await (0, contact_utils_1.recordContactTombstoneOnConnection)(connection, user, identity.davUid);
                await (0, birthday_calendar_1.syncContactBirthdayEvent)(connection, user, identity, null, [identity]);
            }
            return Number(result.affectedRows || 0);
        });
        if (deleted > 0)
            emitContactsUpdated(user, { deleted: true });
        res.json({ success: true, deleted });
    }
    catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});
exports.appsApiRouter.delete('/contacts/:id', async (req, res) => {
    const user = req.username;
    try {
        const deleted = await (0, contact_utils_1.withContactMutation)(user, async (connection) => {
            const [rows] = await connection.query(`SELECT id, name, email, dav_uid, birthday FROM contacts
                 WHERE id = ? AND username = ? AND deleted_at IS NULL LIMIT 1`, [req.params.id, user]);
            if (rows.length === 0)
                return false;
            const contact = rows[0];
            const davUid = contact.dav_uid || `contact-${contact.id}`;
            const syncToken = await (0, contact_utils_1.nextContactSyncTokenOnConnection)(connection, user);
            const [result] = await connection.query(`UPDATE contacts SET dav_uid = ?, deleted_at = NOW(), sync_token = ?
                 WHERE id = ? AND username = ? AND deleted_at IS NULL`, [davUid, syncToken, contact.id, user]);
            if (result.affectedRows === 0)
                return false;
            await (0, contact_utils_1.recordContactTombstoneOnConnection)(connection, user, davUid);
            const identity = {
                contactId: contact.id,
                davUid,
                name: contact.name,
                email: contact.email,
            };
            await (0, birthday_calendar_1.syncContactBirthdayEvent)(connection, user, identity, null, [identity]);
            return true;
        });
        if (!deleted)
            return res.status(404).json({ success: false, error: 'Contact not found' });
        emitContactsUpdated(user, { contactId: req.params.id, deleted: true });
        res.json({ success: true });
    }
    catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});
exports.appsApiRouter.get('/contacts/trash', async (req, res) => {
    const user = req.username;
    try {
        await (0, contact_utils_1.purgeExpiredContacts)(user);
        const [rows] = await db_1.pool.query(`SELECT id, name, email, phone, deleted_at
             FROM contacts WHERE username = ? AND deleted_at IS NOT NULL
             ORDER BY deleted_at DESC`, [user]);
        res.json({ success: true, contacts: rows });
    }
    catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});
exports.appsApiRouter.post('/contacts/:id/restore', async (req, res) => {
    const user = req.username;
    try {
        const restored = await (0, contact_utils_1.withContactMutation)(user, async (connection) => {
            const [rows] = await connection.query(`SELECT id, name, email, dav_uid, birthday FROM contacts
                 WHERE id = ? AND username = ? AND deleted_at IS NOT NULL LIMIT 1`, [req.params.id, user]);
            if (rows.length === 0)
                return false;
            const contact = rows[0];
            const davUid = contact.dav_uid || `contact-${contact.id}`;
            const syncToken = await (0, contact_utils_1.nextContactSyncTokenOnConnection)(connection, user);
            const [result] = await connection.query(`UPDATE contacts SET dav_uid = ?, deleted_at = NULL, sync_token = ?
                 WHERE id = ? AND username = ? AND deleted_at IS NOT NULL`, [davUid, syncToken, contact.id, user]);
            if (result.affectedRows === 0)
                return false;
            await connection.query('DELETE FROM contact_tombstones WHERE username = ? AND dav_uid = ?', [user, davUid]);
            const identity = {
                contactId: contact.id,
                davUid,
                name: contact.name,
                email: contact.email,
            };
            await (0, birthday_calendar_1.syncContactBirthdayEvent)(connection, user, identity, contact.birthday || null, [identity]);
            return true;
        });
        if (!restored)
            return res.status(404).json({ success: false, error: 'Contact not found in trash' });
        emitContactsUpdated(user, { contactId: req.params.id, restored: true });
        res.json({ success: true });
    }
    catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});
exports.appsApiRouter.delete('/contacts/:id/permanent', async (req, res) => {
    const user = req.username;
    try {
        const deletedContact = await (0, contact_utils_1.withContactMutation)(user, async (connection) => {
            const [contactToDelete] = await connection.query('SELECT id, name, email, dav_uid FROM contacts WHERE id=? AND username=? AND deleted_at IS NOT NULL', [req.params.id, user]);
            if (contactToDelete.length === 0)
                return null;
            const contact = contactToDelete[0];
            await (0, contact_utils_1.recordContactTombstoneOnConnection)(connection, user, contact.dav_uid || `contact-${contact.id}`);
            await connection.query('DELETE FROM contact_group_members WHERE contact_id = ?', [req.params.id]);
            const [delResult] = await connection.query('DELETE FROM contacts WHERE id=? AND username=? AND deleted_at IS NOT NULL', [req.params.id, user]);
            if (delResult.affectedRows === 0)
                throw new Error('Contact disappeared during permanent deletion');
            const identity = {
                contactId: contact.id,
                davUid: contact.dav_uid || `contact-${contact.id}`,
                name: contact.name,
                email: contact.email,
            };
            await (0, birthday_calendar_1.syncContactBirthdayEvent)(connection, user, identity, null, [identity]);
            return contact;
        });
        if (!deletedContact)
            return res.status(404).json({ success: false, error: 'Contact not found in trash' });
        emitContactsUpdated(user, { contactId: req.params.id, deleted: true });
        res.json({ success: true });
    }
    catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});
const contactActivityAddressPattern = (email) => {
    const escaped = email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const emailCharacters = "a-z0-9.!#$%&'*+/=?^_`{|}~-";
    return `(^|[^${emailCharacters}])${escaped}([^${emailCharacters}]|$)`;
};
exports.contactActivityAddressPattern = contactActivityAddressPattern;
const contactActivityAttendeePattern = (email) => {
    const escaped = email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const emailCharacters = "a-z0-9.!#$%&'*+/=?^_`{|}~-";
    return `mailto:${escaped}([^${emailCharacters}]|$)`;
};
exports.contactActivityAttendeePattern = contactActivityAttendeePattern;
exports.appsApiRouter.get('/contacts/:id/activity', async (req, res) => {
    const user = req.username;
    try {
        const [contactRows] = await db_1.pool.query('SELECT email, emails_json FROM contacts WHERE id=? AND username=? AND deleted_at IS NULL', [req.params.id, user]);
        if (contactRows.length === 0)
            return res.status(404).json({ success: false, error: 'Contact not found' });
        const contact = contactRows[0];
        const emailCandidates = [contact.email];
        if (contact.emails_json) {
            let parsed = contact.emails_json;
            if (typeof parsed === 'string') {
                try {
                    parsed = JSON.parse(parsed);
                }
                catch {
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
            .filter((value) => typeof value === 'string' && value.trim().length > 0)
            .map((value) => value.trim().toLowerCase())));
        if (emails.length === 0) {
            return res.json({ success: true, emails: [], meetings: [] });
        }
        const mailPredicates = emails.map(() => (`(LOWER(COALESCE(sender, '')) REGEXP ?
              OR LOWER(COALESCE(recipients, '')) REGEXP ?)`)).join(' OR ');
        const [emailRows] = await db_1.pool.query(`SELECT subject, sent_at AS received_at, id, COALESCE(preview, '') AS snippet
             FROM mail_search_index
             WHERE username = ? AND (${mailPredicates})
             ORDER BY sent_at DESC LIMIT 20`, [user, ...emails.flatMap((email) => {
                const pattern = (0, exports.contactActivityAddressPattern)(email);
                return [pattern, pattern];
            })]);
        const attendeePredicates = emails.map(() => (`LOWER(e.ical_data) REGEXP ?`)).join(' OR ');
        const [eventRows] = await db_1.pool.query(`SELECT e.uid, e.ical_data
             FROM events e
             JOIN calendars c ON c.id = e.calendar_id
             WHERE c.user_id = ? AND (${attendeePredicates})`, [user, ...emails.map(exports.contactActivityAttendeePattern)]);
        const now = new Date();
        const expansionEnd = new Date(now);
        expansionEnd.setUTCFullYear(expansionEnd.getUTCFullYear() + 2);
        const meetings = eventRows.flatMap((row) => {
            try {
                const parsed = (0, calendar_utils_1.parseIcalEvent)(row.uid, row.ical_data || '');
                const occurrences = parsed.recurrence
                    ? (0, calendar_utils_1.expandRecurringEvent)(parsed, now, expansionEnd)
                    : [parsed];
                return occurrences
                    .filter((occurrence) => new Date(occurrence.end || occurrence.start) >= now)
                    .map((occurrence) => ({
                    id: occurrence.occurrenceId || row.uid,
                    title: occurrence.title || 'Meeting',
                    start: new Date(occurrence.start).toISOString(),
                }));
            }
            catch {
                return [];
            }
        }).sort((left, right) => (new Date(left.start).getTime() - new Date(right.start).getTime())).slice(0, 10);
        res.json({ success: true, emails: emailRows, meetings });
    }
    catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});
exports.appsApiRouter.post('/contacts/:id/share', async (req, res) => {
    const user = req.username;
    const shareTo = req.body.recipientEmail;
    const shareMsg = req.body.message || '';
    if (!shareTo || !shareTo.includes('@')) {
        return res.status(400).json({ success: false, error: 'Valid recipient email is required' });
    }
    try {
        const [rows] = await db_1.pool.query('SELECT * FROM contacts WHERE id=? AND username=? AND deleted_at IS NULL', [req.params.id, user]);
        if (rows.length === 0)
            return res.status(404).json({ success: false, error: 'Contact not found' });
        const c = rows[0];
        const vcard = (0, contact_utils_1.normalizeVCardData)(c.vcard_data || '', c.dav_uid || `contact-${c.id}`, { name: c.name, email: c.email, phone: c.phone });
        res.json({
            success: true,
            vcard,
            mailtoSubject: `Contact: ${c.name || c.email}`,
            mailtoBody: `${shareMsg}\n\n`,
        });
    }
    catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});
exports.appsApiRouter.get('/contacts-export', async (req, res) => {
    const user = req.username;
    const format = req.query.format || 'vcard';
    try {
        const idsParam = req.query.ids;
        let rows;
        if (idsParam) {
            const ids = idsParam.split(',').map(Number).filter(n => !isNaN(n));
            if (ids.length === 0) {
                rows = [];
            }
            else {
                const placeholders = ids.map(() => '?').join(',');
                [rows] = await db_1.pool.query(`SELECT * FROM contacts WHERE username = ? AND id IN (${placeholders}) AND deleted_at IS NULL`, [user, ...ids]);
            }
        }
        else {
            [rows] = await db_1.pool.query('SELECT * FROM contacts WHERE username = ? AND deleted_at IS NULL', [user]);
        }
        if (format === 'csv') {
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', 'attachment; filename="contacts.csv"');
            let csv = 'Name,Email,Phone,Job Title,Organization,Notes\n';
            for (const row of rows) {
                const escapeCsv = (str) => `"${(str || '').replace(/"/g, '""')}"`;
                csv += `${escapeCsv(row.name)},${escapeCsv(row.email)},${escapeCsv(row.phone)},${escapeCsv(row.job_title)},${escapeCsv(row.organization)},${escapeCsv(row.notes)}\n`;
            }
            res.send(csv);
        }
        else {
            res.setHeader('Content-Type', 'text/vcard');
            res.setHeader('Content-Disposition', 'attachment; filename="contacts.vcf"');
            let vcards = '';
            for (const row of rows) {
                vcards += (0, contact_utils_1.normalizeVCardData)(row.vcard_data || '', (0, contact_utils_1.getContactDavUid)(row), { name: row.name, email: row.email, phone: row.phone });
            }
            res.send(vcards);
        }
    }
    catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});
exports.appsApiRouter.post('/contacts-import', async (req, res) => {
    const user = req.username;
    const { data, format } = req.body;
    if (!data)
        return res.status(400).json({ success: false, error: 'No data provided' });
    try {
        let imported = 0;
        let skippedNoFields = 0;
        let skippedDuplicate = 0;
        if (format === 'csv') {
            const lines = data.split('\n');
            const headers = lines[0].toLowerCase().split(',').map((h) => h.trim().replace(/"/g, ''));
            const nameIdx = headers.findIndex((h) => h.includes('name'));
            const emailIdx = headers.findIndex((h) => h.includes('email'));
            const phoneIdx = headers.findIndex((h) => h.includes('phone'));
            for (let i = 1; i < lines.length; i++) {
                if (!lines[i].trim())
                    continue;
                // Simple CSV split handling quotes correctly is hard without a library, but let's do a basic split for now
                // This is a naive regex that splits by comma ignoring commas inside quotes
                const match = lines[i].match(/(".*?"|[^",\s]+)(?=\s*,|\s*$)/g);
                if (!match)
                    continue;
                const cols = match.map((c) => c.replace(/^"|"$/g, '').trim());
                const name = nameIdx >= 0 ? cols[nameIdx] || '' : '';
                const email = emailIdx >= 0 ? cols[emailIdx] || '' : '';
                const phone = phoneIdx >= 0 ? cols[phoneIdx] || '' : '';
                const jobTitleIdx = headers.findIndex((h) => h.includes('job'));
                const orgIdx = headers.findIndex((h) => h.includes('organization'));
                const notesIdx = headers.findIndex((h) => h.includes('notes'));
                const jobTitle = jobTitleIdx >= 0 ? cols[jobTitleIdx] || '' : '';
                const organization = orgIdx >= 0 ? cols[orgIdx] || '' : '';
                const notes = notesIdx >= 0 ? cols[notesIdx] || '' : '';
                if (!name && !email) {
                    skippedNoFields++;
                    continue;
                }
                try {
                    const davUid = (0, contact_utils_1.createContactUid)();
                    const vcard = (0, contact_utils_1.patchVCardData)('', davUid, {
                        name,
                        email,
                        phone,
                        job_title: jobTitle,
                        organization,
                        notes,
                    });
                    const result = await (0, contact_utils_1.withContactMutation)(user, async (connection) => {
                        const syncToken = await (0, contact_utils_1.nextContactSyncTokenOnConnection)(connection, user);
                        const [insertResult] = await connection.query(`INSERT INTO contacts (username, name, email, phone, job_title, organization, notes, vcard_data, dav_uid, sync_token)
                             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                             ON DUPLICATE KEY UPDATE
                               name = VALUES(name),
                               phone = VALUES(phone),
                               job_title = VALUES(job_title),
                               organization = VALUES(organization),
                               notes = VALUES(notes),
                               deleted_at = NULL,
                               sync_token = VALUES(sync_token)`, [user, name, email, phone, jobTitle, organization, notes, vcard, davUid, syncToken]);
                        return insertResult;
                    });
                    if (result.affectedRows > 0)
                        imported++;
                    else
                        skippedDuplicate++;
                }
                catch (error) {
                    if (!isDuplicateKeyError(error))
                        throw error;
                    skippedDuplicate++;
                }
            }
        }
        else {
            // vCard import
            const vcards = data.split(/(?=BEGIN:VCARD)/i);
            for (const vcard of vcards) {
                if (!vcard.trim().toUpperCase().startsWith('BEGIN:VCARD'))
                    continue;
                const vcardUid = (0, contact_utils_1.extractVCardUid)(vcard);
                (0, contact_utils_1.extractVCardBirthday)(vcard);
                const parsed = (0, contact_utils_1.parseVCard)(vcard);
                if (!parsed.name && !parsed.email) {
                    skippedNoFields++;
                    continue;
                }
                try {
                    await (0, contact_utils_1.withContactMutation)(user, async (connection) => {
                        const existingDavUid = vcardUid
                            ? await (0, contact_utils_1.findContactDavUidByVCardUidOnConnection)(connection, user, vcardUid)
                            : null;
                        const davUid = existingDavUid || (0, contact_utils_1.createContactUid)();
                        const saved = await (0, contact_utils_1.saveContactFromVCardOnConnection)(connection, user, davUid, vcard);
                        if (!saved)
                            throw new Error('The imported contact changed during its locked mutation');
                        return saved;
                    });
                    imported++;
                }
                catch (error) {
                    if (!isDuplicateKeyError(error))
                        throw error;
                    skippedDuplicate++;
                }
            }
        }
        if (imported > 0)
            emitContactsUpdated(user, { imported });
        res.json({ success: true, imported, skippedDuplicate, skippedNoFields, total: imported + skippedDuplicate + skippedNoFields });
    }
    catch (e) {
        if (e instanceof contact_groups_1.ContactGroupError)
            return res.status(e.status).json({ success: false, error: e.message });
        if (e instanceof contact_utils_1.InvalidContactBirthdayError) {
            return res.status(400).json({ success: false, error: e.message });
        }
        if (e instanceof contact_utils_1.AmbiguousVCardUidError) {
            return res.status(409).json({ success: false, error: e.message });
        }
        res.status(500).json({ success: false, error: e.message });
    }
});
exports.appsApiRouter.get('/contacts-duplicates', async (req, res) => {
    const user = req.username;
    try {
        const [rows] = await db_1.pool.query('SELECT * FROM contacts WHERE username = ? AND deleted_at IS NULL', [user]);
        rows.sort((left, right) => (0, contact_utils_1.contactIdentityRank)(right) - (0, contact_utils_1.contactIdentityRank)(left));
        const duplicates = [];
        const seen = new Set();
        for (let i = 0; i < rows.length; i++) {
            if (seen.has(rows[i].id))
                continue;
            const matches = [rows[i]];
            for (let j = i + 1; j < rows.length; j++) {
                if (seen.has(rows[j].id))
                    continue;
                let isMatch = false;
                const c1 = rows[i];
                const c2 = rows[j];
                if (c1.email && c1.email.toLowerCase() === c2.email?.toLowerCase())
                    isMatch = true;
                else if (c1.phone && c1.phone === c2.phone)
                    isMatch = true;
                else if (c1.name && c1.name.toLowerCase() === c2.name?.toLowerCase())
                    isMatch = true;
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
    }
    catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});
exports.appsApiRouter.get('/contacts-merge-preview', async (req, res) => {
    const user = req.username;
    const ids = (req.query.ids || '').split(',').map(Number).filter(Boolean);
    if (ids.length < 2)
        return res.status(400).json({ success: false, error: 'Need at least 2 contact IDs' });
    try {
        const [rows] = await db_1.pool.query('SELECT * FROM contacts WHERE id IN (?) AND username=? AND deleted_at IS NULL', [ids, user]);
        if (rows.length < 2)
            return res.status(404).json({ success: false, error: 'Contacts not found' });
        // Build field-by-field preview showing source of each value
        const fieldSources = {};
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
        for (const field of mergeFields)
            merged[field] = fieldSources[field]?.value || '';
        res.json({ success: true, contacts: rows, fieldSources, merged });
    }
    catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});
exports.appsApiRouter.post('/contacts-merge', async (req, res) => {
    const user = req.username;
    const { primaryId, duplicateIds } = req.body;
    const normalizedPrimaryId = Number(primaryId);
    const normalizedDuplicateIds = Array.isArray(duplicateIds)
        ? Array.from(new Set(duplicateIds
            .map((id) => Number(id))
            .filter((id) => Number.isSafeInteger(id) && id > 0 && id !== normalizedPrimaryId)))
        : [];
    if (!Number.isSafeInteger(normalizedPrimaryId) || normalizedPrimaryId <= 0 || normalizedDuplicateIds.length === 0) {
        return res.status(400).json({ success: false, error: 'Invalid input' });
    }
    try {
        const outcome = await (0, contact_utils_1.withContactMutation)(user, async (connection) => {
            const [primaryRows] = await connection.query('SELECT * FROM contacts WHERE id=? AND username=? AND deleted_at IS NULL', [normalizedPrimaryId, user]);
            if (primaryRows.length === 0)
                return 'not-found';
            const primary = primaryRows[0];
            const [dupRows] = await connection.query('SELECT * FROM contacts WHERE id IN (?) AND username=? AND deleted_at IS NULL', [normalizedDuplicateIds, user]);
            if (dupRows.length === 0)
                return 'unchanged';
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
            const uniqueByValue = (arr) => Array.from(new Map(arr.map(item => [item.value, item])).values());
            emails = uniqueByValue(emails);
            phones = uniqueByValue(phones);
            addresses = uniqueByValue(addresses);
            labels = Array.from(new Set(labels));
            const newVcardData = (0, contact_utils_1.patchVCardData)(primary.vcard_data || '', primary.dav_uid || `contact-${primary.id}`, {
                name, email, phone, emails_json: emails, phones_json: phones, job_title, organization, notes,
            });
            const syncToken = await (0, contact_utils_1.nextContactSyncTokenOnConnection)(connection, user);
            await connection.query(`UPDATE contacts SET name=?, email=?, phone=?, job_title=?, organization=?, notes=?, emails_json=?, phones_json=?, addresses_json=?, labels_json=?, vcard_data=?, photo_url=?, sync_token=? WHERE id=? AND username=?`, [name, email, phone, job_title, organization, notes, JSON.stringify(emails), JSON.stringify(phones), JSON.stringify(addresses), JSON.stringify(labels), newVcardData, photo_url || null, syncToken, normalizedPrimaryId, user]);
            for (const dup of dupRows) {
                await (0, contact_utils_1.recordContactTombstoneOnConnection)(connection, user, dup.dav_uid || `contact-${dup.id}`);
            }
            await connection.query('DELETE FROM contacts WHERE id IN (?) AND username=?', [dupRows.map((duplicate) => duplicate.id), user]);
            const previousPrimaryIdentity = {
                contactId: primary.id,
                davUid: primary.dav_uid || `contact-${primary.id}`,
                name: primary.name,
                email: primary.email,
            };
            const currentPrimaryIdentity = {
                ...previousPrimaryIdentity,
                name,
                email,
            };
            await (0, birthday_calendar_1.syncContactBirthdayEvent)(connection, user, currentPrimaryIdentity, primary.birthday || null, [previousPrimaryIdentity, currentPrimaryIdentity]);
            for (const duplicate of dupRows) {
                const duplicateIdentity = {
                    contactId: duplicate.id,
                    davUid: duplicate.dav_uid || `contact-${duplicate.id}`,
                    name: duplicate.name,
                    email: duplicate.email,
                };
                await (0, birthday_calendar_1.syncContactBirthdayEvent)(connection, user, duplicateIdentity, null, [duplicateIdentity]);
            }
            return 'merged';
        });
        if (outcome === 'not-found')
            return res.status(404).json({ success: false, error: 'Primary contact not found' });
        if (outcome === 'unchanged')
            return res.json({ success: true });
        emitContactsUpdated(user, { contactId: normalizedPrimaryId, merged: true });
        res.json({ success: true });
    }
    catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});
// ==========================================
// CONTACT LABELS API
// ==========================================
exports.appsApiRouter.get('/contact-labels', async (req, res) => {
    const user = req.username;
    try {
        const [rows] = await db_1.pool.query('SELECT * FROM contact_labels WHERE username = ? ORDER BY name ASC', [user]);
        res.json({ success: true, labels: rows });
    }
    catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});
exports.appsApiRouter.post('/contact-labels', async (req, res) => {
    const user = req.username;
    const { name, color } = req.body;
    try {
        const [result] = await db_1.pool.query('INSERT INTO contact_labels (username, name, color) VALUES (?, ?, ?)', [user, name || 'New Label', color || '#60a5fa']);
        res.json({ success: true, id: result.insertId });
    }
    catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});
exports.appsApiRouter.put('/contact-labels/:id', async (req, res) => {
    const user = req.username;
    const { name, color } = req.body;
    try {
        await db_1.pool.query('UPDATE contact_labels SET name=?, color=? WHERE id=? AND username=?', [name, color, req.params.id, user]);
        res.json({ success: true });
    }
    catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});
exports.appsApiRouter.delete('/contact-labels/:id', async (req, res) => {
    const user = req.username;
    try {
        await db_1.pool.query('DELETE FROM contact_labels WHERE id=? AND username=?', [req.params.id, user]);
        res.json({ success: true });
    }
    catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});
// ==========================================
// CONTACT GROUPS API
// ==========================================
exports.appsApiRouter.get('/contact-groups', async (req, res) => {
    const user = req.username;
    try {
        const [groups] = await db_1.pool.query(`SELECT g.*, COUNT(c.id) as member_count
             FROM contact_groups g
             LEFT JOIN contact_group_members m ON g.id = m.group_id
             LEFT JOIN contacts c ON c.id = m.contact_id AND c.username COLLATE utf8mb4_unicode_ci = g.username AND c.deleted_at IS NULL
             WHERE g.username = ? GROUP BY g.id ORDER BY g.name`, [user]);
        res.json({ success: true, groups });
    }
    catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});
function contactGroupFailure(res, error) {
    if (error instanceof contact_groups_1.ContactGroupError)
        return res.status(error.status).json({ success: false, error: error.message });
    return res.status(500).json({ success: false, error: 'Unable to update contact group' });
}
exports.appsApiRouter.post('/contact-groups', async (req, res) => {
    const user = req.username;
    try {
        const id = await (0, contact_groups_1.createContactGroup)(user, req.body?.name, req.body?.color);
        emitContactsUpdated(user);
        res.json({ success: true, id });
    }
    catch (error) {
        contactGroupFailure(res, error);
    }
});
exports.appsApiRouter.put('/contact-groups/:id', async (req, res) => {
    const user = req.username;
    try {
        await (0, contact_groups_1.updateContactGroup)(user, req.params.id, { name: req.body?.name, color: req.body?.color });
        emitContactsUpdated(user);
        res.json({ success: true });
    }
    catch (error) {
        contactGroupFailure(res, error);
    }
});
exports.appsApiRouter.delete('/contact-groups/:id', async (req, res) => {
    const user = req.username;
    try {
        await (0, contact_groups_1.updateContactGroup)(user, req.params.id, null);
        emitContactsUpdated(user);
        res.json({ success: true });
    }
    catch (error) {
        contactGroupFailure(res, error);
    }
});
exports.appsApiRouter.get('/contact-groups/:id/members', async (req, res) => {
    const user = req.username;
    try {
        const [rows] = await db_1.pool.query(`SELECT m.contact_id, c.name, c.email FROM contact_group_members m
             JOIN contacts c ON c.id = m.contact_id AND c.deleted_at IS NULL
             JOIN contact_groups g ON g.id = m.group_id
             WHERE m.group_id = ? AND g.username = ? AND c.username COLLATE utf8mb4_unicode_ci = g.username`, [req.params.id, user]);
        res.json({ success: true, members: rows });
    }
    catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});
exports.appsApiRouter.post('/contact-groups/:id/members', async (req, res) => {
    const user = req.username;
    try {
        const added = await (0, contact_groups_1.changeContactGroupMembers)(user, req.params.id, req.body?.contactIds);
        emitContactsUpdated(user);
        res.json({ success: true, added });
    }
    catch (error) {
        contactGroupFailure(res, error);
    }
});
exports.appsApiRouter.delete('/contact-groups/:id/members/:contactId', async (req, res) => {
    const user = req.username;
    try {
        await (0, contact_groups_1.changeContactGroupMembers)(user, req.params.id, [req.params.contactId], true);
        emitContactsUpdated(user);
        res.json({ success: true });
    }
    catch (error) {
        contactGroupFailure(res, error);
    }
});
// ==========================================
// TASKS API
// ==========================================
exports.appsApiRouter.get('/tasks', async (req, res) => {
    const user = req.username;
    try {
        const [rows] = await db_1.pool.query('SELECT * FROM tasks WHERE username = ? ORDER BY created_at DESC', [user]);
        res.json({ success: true, tasks: rows });
    }
    catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});
exports.appsApiRouter.post('/tasks', async (req, res) => {
    const user = req.username;
    const { title, description, due_date, completed } = req.body;
    try {
        const [result] = await db_1.pool.query('INSERT INTO tasks (username, title, description, due_date, completed) VALUES (?, ?, ?, ?, ?)', [user, title, description || '', due_date || null, completed ? 1 : 0]);
        res.json({ success: true, id: result.insertId });
    }
    catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});
exports.appsApiRouter.put('/tasks/:id', async (req, res) => {
    const user = req.username;
    const { title, description, due_date, completed } = req.body;
    try {
        await db_1.pool.query('UPDATE tasks SET title=?, description=?, due_date=?, completed=? WHERE id=? AND username=?', [title, description, due_date, completed ? 1 : 0, req.params.id, user]);
        res.json({ success: true });
    }
    catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});
exports.appsApiRouter.delete('/tasks/:id', async (req, res) => {
    const user = req.username;
    try {
        await db_1.pool.query('DELETE FROM tasks WHERE id=? AND username=?', [req.params.id, user]);
        res.json({ success: true });
    }
    catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});
// ==========================================
// NOTES API
// ==========================================
// NOTES API
// ==========================================
const notes_utils_1 = require("./notes-utils");
const notes_imap_sync_1 = require("./notes-imap-sync");
exports.appsApiRouter.get('/notes', async (req, res) => {
    const user = req.username;
    const pass = req.user?.password;
    try {
        // Await IMAP sync so the response includes fresh notes.
        await (0, notes_imap_sync_1.syncNotesWithImap)(user, pass);
        const rows = await (0, notes_utils_1.listNotesWithReminders)(user);
        res.json({ success: true, notes: rows });
    }
    catch (e) {
        console.error("GET notes error", e);
        res.status(500).json({ success: false, error: e.message });
    }
});
exports.appsApiRouter.post('/notes', async (req, res) => {
    const user = req.username;
    const pass = req.user?.password;
    const { title, content, color, is_pinned, is_locked, folder, labels_json } = req.body;
    try {
        const saved = await (0, notes_utils_1.saveNote)({
            title, content, owner: user,
            color, is_pinned, is_locked, folder, labels_json
        });
        (0, notes_imap_sync_1.syncNotesWithImap)(user, pass).catch(e => console.error(e));
        res.json({ success: true, note: saved });
    }
    catch (e) {
        if (e instanceof notes_utils_1.NoteValidationError) {
            return res.status(e.statusCode).json((0, notes_utils_1.noteValidationErrorBody)(e));
        }
        console.error("POST notes error", e);
        res.status(500).json({ success: false, error: e.message });
    }
});
exports.appsApiRouter.put('/notes/:id', async (req, res) => {
    const user = req.username;
    const pass = req.user?.password;
    const { title, content, color, is_pinned, is_locked, folder, labels_json, expected_sync_token } = req.body;
    if (expected_sync_token === undefined) {
        return res.status(428).json({ success: false, error: 'The current note revision is required.' });
    }
    try {
        const saved = await (0, notes_utils_1.saveNote)({
            id: req.params.id,
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
        (0, notes_imap_sync_1.syncNotesWithImap)(user, pass).catch(e => console.error(e));
        res.json({ success: true, note: saved });
    }
    catch (e) {
        if (e instanceof notes_utils_1.NoteConflictError) {
            return res.status(409).json({ success: false, error: e.message });
        }
        if (e instanceof notes_utils_1.NoteValidationError) {
            return res.status(e.statusCode).json((0, notes_utils_1.noteValidationErrorBody)(e));
        }
        console.error("PUT notes error", e);
        res.status(500).json({ success: false, error: e.message });
    }
});
exports.appsApiRouter.delete('/notes/:id', async (req, res) => {
    const user = req.username;
    const pass = req.user?.password;
    try {
        await (0, notes_utils_1.deleteNote)(req.params.id, user);
        (0, notes_imap_sync_1.syncNotesWithImap)(user, pass).catch(e => console.error(e));
        res.json({ success: true });
    }
    catch (e) {
        console.error("DELETE notes error", e);
        res.status(500).json({ success: false, error: e.message });
    }
});
// ==========================================
// ---- Notes: Image upload ----
const multer_1 = __importDefault(require("multer"));
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const notesUploadDir = path.join(__dirname, '..', 'uploads', 'notes');
if (!fs.existsSync(notesUploadDir)) {
    fs.mkdirSync(notesUploadDir, { recursive: true });
}
const notesImageUpload = (0, multer_1.default)({
    storage: multer_1.default.diskStorage({
        destination: (_req, _file, cb) => {
            const user = _req.username || 'unknown';
            const userDir = path.join(notesUploadDir, user);
            if (!fs.existsSync(userDir))
                fs.mkdirSync(userDir, { recursive: true });
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
        }
        else {
            cb(new Error('Only PNG, JPEG, GIF, and WebP images are allowed'));
        }
    }
});
exports.appsApiRouter.post('/notes/upload', notesImageUpload.single('file'), async (req, res) => {
    if (!req.file) {
        res.status(400).json({ success: false, error: 'No file uploaded' });
        return;
    }
    const user = req.username || 'unknown';
    const url = `/uploads/notes/${user}/${req.file.filename}`;
    res.json({ success: true, url });
});
// ---- Notes: Reminders ----
const notes_utils_2 = require("./notes-utils");
exports.appsApiRouter.get('/notes/:id/reminder', async (req, res) => {
    const user = req.username;
    try {
        const reminder = await (0, notes_utils_2.getNoteReminder)(req.params.id, user);
        if (!reminder) {
            res.json({ success: true, reminder: null });
            return;
        }
        res.json({ success: true, reminder: { remind_at: reminder.remind_at } });
    }
    catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});
exports.appsApiRouter.post('/notes/:id/reminder', async (req, res) => {
    const user = req.username;
    try {
        if (!req.body.remind_at) {
            res.status(400).json({ success: false, error: 'remind_at is required' });
            return;
        }
        await (0, notes_utils_2.saveNoteReminder)(req.params.id, req.body.remind_at, user);
        res.json({ success: true });
    }
    catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});
exports.appsApiRouter.delete('/notes/:id/reminder', async (req, res) => {
    const user = req.username;
    try {
        await (0, notes_utils_2.deleteNoteReminder)(req.params.id, user);
        res.json({ success: true });
    }
    catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});
// ---- Notes: Attachments ----
const notes_utils_3 = require("./notes-utils");
const attachmentsUpload = (0, multer_1.default)({
    storage: multer_1.default.diskStorage({
        destination: (_req, _file, cb) => {
            const user = _req.username || 'unknown';
            const userDir = path.join(notesUploadDir, user);
            if (!fs.existsSync(userDir))
                fs.mkdirSync(userDir, { recursive: true });
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
        }
        else {
            cb(null, true);
        }
    }
});
exports.appsApiRouter.get('/notes/:id/attachments', async (req, res) => {
    const user = req.username;
    try {
        const attachments = await (0, notes_utils_3.listNoteAttachments)(req.params.id, user);
        const attachmentsWithUrl = attachments.map((att) => ({
            ...att,
            url: `/uploads/${att.storage_path}`,
        }));
        res.json({ success: true, attachments: attachmentsWithUrl });
    }
    catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});
exports.appsApiRouter.post('/notes/:id/attachments', attachmentsUpload.single('file'), async (req, res) => {
    const user = req.username;
    try {
        if (!req.file) {
            res.status(400).json({ success: false, error: 'No file uploaded' });
            return;
        }
        const id = crypto.randomUUID();
        const storagePath = path.join('notes', user, req.file.filename);
        const attachment = {
            id,
            note_id: req.params.id,
            filename: req.file.originalname,
            mime_type: req.file.mimetype,
            size_bytes: req.file.size,
            storage_path: storagePath,
        };
        await (0, notes_utils_3.saveNoteAttachment)(attachment, user);
        res.json({ success: true, attachment });
    }
    catch (e) {
        // Clean up uploaded file on DB error to avoid orphaned files
        try {
            if (req.file) {
                const filePath = path.join(notesUploadDir, user, req.file.filename);
                if (fs.existsSync(filePath)) {
                    fs.unlinkSync(filePath);
                }
            }
        }
        catch { } // Best-effort cleanup
        res.status(500).json({ success: false, error: e.message });
    }
});
exports.appsApiRouter.delete('/notes/:id/attachments/:attachmentId', async (req, res) => {
    const user = req.username;
    try {
        const deleted = await (0, notes_utils_3.deleteNoteAttachment)(req.params.attachmentId, user);
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
    }
    catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});
// ==========================================
// CALENDARS & EVENTS API
// ==========================================
exports.appsApiRouter.get('/calendars', async (req, res) => {
    const user = req.username;
    try {
        const identities = await (0, outbound_mail_1.listOwnedSenderIdentities)(db_1.pool, user);
        const calendars = await (0, calendar_utils_1.getVisibleCalendars)(user);
        const result = [];
        for (const cal of calendars) {
            const [events] = await db_1.pool.query('SELECT * FROM events WHERE calendar_id = ?', [cal.id]);
            const expansionStart = new Date();
            expansionStart.setUTCFullYear(expansionStart.getUTCFullYear() - 1, 0, 1);
            expansionStart.setUTCHours(0, 0, 0, 0);
            const expansionEnd = new Date();
            expansionEnd.setUTCFullYear(expansionEnd.getUTCFullYear() + 2, 11, 31);
            expansionEnd.setUTCHours(23, 59, 59, 999);
            const parsedEvents = events.flatMap((ev) => {
                const parsed = (0, calendar_utils_1.parseIcalEvent)(ev.uid, ev.ical_data || '');
                if (parsed.meetingStatus === '5')
                    return [];
                const occurrences = parsed.recurrence
                    ? (0, calendar_utils_1.expandRecurringEvent)(parsed, expansionStart, expansionEnd)
                    : [parsed];
                const invitations = (0, calendar_invitations_1.projectCalendarInvitationOccurrences)(ev.ical_data || '', identities.addresses, occurrences.map(occurrence => occurrence.occurrenceId));
                return occurrences.map((occurrence, occurrenceIndex) => {
                    const invitation = invitations[occurrenceIndex];
                    return ({
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
                        rawIcal: ev.ical_data || '',
                        guests: invitation?.attendees.map(attendee => attendee.email)
                            || parsed.activeSyncAttendees?.slice(0, 200).map(attendee => attendee.email)
                            || [],
                        invitation: invitation || undefined,
                    });
                });
            });
            result.push({
                ...cal,
                events: parsedEvents
            });
        }
        res.json({ success: true, calendars: result });
    }
    catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});
exports.appsApiRouter.post('/calendars', async (req, res) => {
    const user = req.username;
    const { name, color, subscribed_url } = req.body;
    const requestedName = typeof name === 'string' && name.trim() ? name.trim() : 'New Calendar';
    if ((0, calendar_utils_1.isReservedManagedCalendarSlug)(requestedName)) {
        return res.status(409).json({ success: false, error: 'The Birthdays calendar is managed from Contacts' });
    }
    let subscribedUrl;
    try {
        subscribedUrl = normalizedCalendarSubscriptionUrl(subscribed_url);
    }
    catch {
        return res.status(400).json({ success: false, error: 'Calendar subscription URL must be a credential-free HTTPS URL' });
    }
    try {
        const calendar = await (0, calendar_utils_1.createCalendar)(user, requestedName, { color, subscribed_url: subscribedUrl || undefined });
        res.json({ success: true, id: calendar.id });
    }
    catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});
exports.appsApiRouter.post('/calendars/:id/subscription/refresh', async (req, res) => {
    const user = req.username;
    const calendarId = Number(req.params.id);
    if (!Number.isSafeInteger(calendarId) || calendarId <= 0) {
        return res.status(400).json({ success: false, error: 'Invalid calendar ID' });
    }
    let releaseRefresh = null;
    try {
        const [calendarRows] = await db_1.pool.query(`SELECT id, subscribed_url, sync_token
             FROM calendars
             WHERE id = ? AND user_id = ?
             LIMIT 1`, [calendarId, user]);
        if (calendarRows.length !== 1) {
            return res.status(404).json({ success: false, error: 'Calendar not found' });
        }
        if (!String(calendarRows[0].subscribed_url || '').trim()) {
            return res.status(409).json({ success: false, error: 'Calendar is not a web subscription' });
        }
        const admittedSubscribedUrl = String(calendarRows[0].subscribed_url);
        const admittedSyncToken = String(calendarRows[0].sync_token ?? '');
        releaseRefresh = beginManualSubscriptionRefresh(user);
        if (!releaseRefresh) {
            res.setHeader('Retry-After', '5');
            return res.status(429).json({
                success: false,
                error: 'Another calendar subscription refresh is already running. Try again shortly.',
            });
        }
        await db_1.pool.query(`UPDATE calendars
             SET last_fetched_at = NULL, last_fetch_error = NULL
             WHERE id = ? AND user_id = ? AND subscribed_url = ? AND sync_token = ?`, [calendarId, user, admittedSubscribedUrl, admittedSyncToken]);
        const outcome = await (0, calendar_subscription_1.runCalendarSubscriptionFetchOnce)({}, {
            calendarId,
            expectedSubscribedUrl: admittedSubscribedUrl,
            expectedSyncToken: admittedSyncToken,
        });
        if (!outcome || outcome.status === 'error') {
            const workerError = outcome?.error || 'Calendar subscription synchronization did not start';
            await db_1.pool.query(`UPDATE calendars
                 SET last_fetched_at = NOW(), last_fetch_error = ?
                 WHERE id = ? AND user_id = ? AND subscribed_url = ? AND sync_token = ?`, [workerError, calendarId, user, admittedSubscribedUrl, admittedSyncToken]);
        }
        const [statusRows] = await db_1.pool.query(`SELECT last_fetched_at, last_fetch_error
             FROM calendars
             WHERE id = ? AND user_id = ?
             LIMIT 1`, [calendarId, user]);
        if (statusRows.length !== 1) {
            return res.status(404).json({ success: false, error: 'Calendar not found' });
        }
        const lastFetchError = String(statusRows[0].last_fetch_error || '').trim() || null;
        const lastFetchedAt = statusRows[0].last_fetched_at || null;
        return res.json({
            success: true,
            status: lastFetchError ? 'error' : lastFetchedAt ? 'synced' : 'pending',
            last_fetched_at: lastFetchedAt,
            last_fetch_error: lastFetchError,
        });
    }
    catch (error) {
        return res.status(500).json({ success: false, error: error?.message || 'Calendar subscription could not be refreshed' });
    }
    finally {
        releaseRefresh?.();
    }
});
exports.appsApiRouter.put('/calendars/:id', async (req, res) => {
    const user = req.username;
    const name = typeof req.body.name === 'string' ? req.body.name.trim() : '';
    const color = typeof req.body.color === 'string' ? req.body.color.trim() : '';
    const subscriptionWasProvided = Object.prototype.hasOwnProperty.call(req.body, 'subscribed_url');
    let requestedSubscribedUrl;
    if (subscriptionWasProvided) {
        try {
            requestedSubscribedUrl = normalizedCalendarSubscriptionUrl(req.body.subscribed_url);
        }
        catch {
            return res.status(400).json({ success: false, error: 'Calendar subscription URL must be a credential-free HTTPS URL' });
        }
    }
    if (!name) {
        return res.status(400).json({ success: false, error: 'Calendar name is required' });
    }
    if (!/^#[0-9a-fA-F]{6}$/.test(color)) {
        return res.status(400).json({ success: false, error: 'Calendar color must be a #RRGGBB value' });
    }
    const connection = await db_1.pool.getConnection();
    try {
        await connection.beginTransaction();
        const [calendarRows] = await connection.query(`SELECT id, dav_slug, subscribed_url
             FROM calendars
             WHERE id = ? AND user_id = ?
             LIMIT 1 FOR UPDATE`, [req.params.id, user]);
        if (calendarRows.length === 0) {
            await connection.rollback();
            return res.status(404).json({ success: false, error: 'Calendar not found' });
        }
        if ((0, birthday_calendar_1.isManagedBirthdayCalendar)(calendarRows[0])) {
            await connection.rollback();
            return res.status(409).json({ success: false, error: 'The Birthdays calendar is managed from Contacts' });
        }
        const previousSubscribedUrl = String(calendarRows[0].subscribed_url || '').trim() || null;
        const subscribedUrl = subscriptionWasProvided ? requestedSubscribedUrl : previousSubscribedUrl;
        const firstSubscription = previousSubscribedUrl === null && subscribedUrl !== null;
        if (firstSubscription) {
            const [eventRows] = await connection.query('SELECT uid FROM events WHERE calendar_id = ? LIMIT 1 FOR UPDATE', [req.params.id]);
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
            const [unmanagedRows] = await connection.query(`SELECT uid FROM events
                 WHERE calendar_id = ? AND subscription_managed = 0
                 LIMIT 1 FOR UPDATE`, [req.params.id]);
            if (unmanagedRows.length > 0) {
                await connection.rollback();
                return res.status(409).json({
                    success: false,
                    error: 'This subscribed calendar contains legacy local events and cannot change feeds safely',
                });
            }
        }
        let removedRevision = null;
        if (previousSubscribedUrl !== null && subscribedUrl === null) {
            const [managedRows] = await connection.query(`SELECT uid, resource_name FROM events
                 WHERE calendar_id = ? AND subscription_managed = 1
                 LIMIT ${MAX_WEB_CALENDAR_RESOURCES + 1} FOR UPDATE`, [req.params.id]);
            if (managedRows.length > MAX_WEB_CALENDAR_RESOURCES) {
                throw new Error('Subscribed calendar contains too many managed resources to unsubscribe safely');
            }
            if (managedRows.length > 0) {
                removedRevision = await (0, calendar_utils_1.allocateCalendarCollectionRevisionOnConnection)(connection, req.params.id);
                for (const row of managedRows) {
                    const uid = String(row.uid);
                    const resourceName = String(row.resource_name || row.uid);
                    await connection.query(`DELETE FROM events
                         WHERE calendar_id = ? AND uid = ? AND subscription_managed = 1`, [req.params.id, uid]);
                    await connection.query(`INSERT INTO calendar_tombstones
                         (calendar_id, uid, resource_name, sync_token, deleted_at)
                         VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
                         ON DUPLICATE KEY UPDATE
                            uid = VALUES(uid), resource_name = VALUES(resource_name),
                            sync_token = VALUES(sync_token), deleted_at = CURRENT_TIMESTAMP`, [req.params.id, uid, resourceName, removedRevision]);
                }
            }
        }
        const urlChanged = previousSubscribedUrl !== subscribedUrl;
        const [result] = await connection.query(`UPDATE calendars
             SET name = ?, color = ?, subscribed_url = ?,
                 last_fetched_at = IF(? = 1, NULL, last_fetched_at),
                 last_fetch_error = IF(? = 1, NULL, last_fetch_error),
                 sync_token = sync_token + ?
             WHERE id = ? AND user_id = ?`, [
            name,
            color,
            subscribedUrl,
            urlChanged ? 1 : 0,
            urlChanged ? 1 : 0,
            removedRevision === null ? 1 : 0,
            req.params.id,
            user,
        ]);
        if (Number(result.affectedRows || 0) !== 1) {
            throw new Error('Calendar settings update failed after locking the calendar');
        }
        await connection.commit();
        res.json({ success: true });
    }
    catch (e) {
        await connection.rollback();
        res.status(500).json({ success: false, error: e.message });
    }
    finally {
        connection.release();
    }
});
exports.appsApiRouter.get('/calendars/:id/shares', async (req, res) => {
    const user = req.username;
    try {
        const [rows] = await db_1.pool.query('SELECT shared_with_user_id, permission FROM calendar_shares WHERE calendar_id = ? AND calendar_id IN (SELECT id FROM calendars WHERE user_id = ?)', [req.params.id, user]);
        res.json({ success: true, shares: rows });
    }
    catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});
exports.appsApiRouter.get('/calendars/:id/export', async (req, res) => {
    const user = req.username;
    try {
        const [calRows] = await db_1.pool.query('SELECT * FROM calendars WHERE id = ? AND user_id = ?', [req.params.id, user]);
        if (calRows.length === 0)
            return res.status(404).json({ success: false, error: 'Calendar not found' });
        const [events] = await db_1.pool.query('SELECT ical_data, updated_at FROM events WHERE calendar_id = ? ORDER BY uid ASC', [req.params.id]);
        const supportingComponents = new Set();
        const resourceComponents = [];
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
                    if (block.type === 'VTIMEZONE')
                        supportingComponents.add(block.icalData);
                    else if (block.type === 'VEVENT')
                        resourceComponents.push(block.icalData);
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
    }
    catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});
exports.appsApiRouter.post('/calendars/:id/import', async (req, res) => {
    const user = req.username;
    const { ics_data } = req.body;
    if (typeof ics_data !== 'string') {
        return res.status(400).json({ success: false, error: 'Missing iCalendar data' });
    }
    let events;
    try {
        const validated = (0, calendar_ical_validation_1.validateICalendarDocument)(ics_data, {
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
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Invalid iCalendar data';
        return res.status(400).json({ success: false, error: message });
    }
    const connection = await db_1.pool.getConnection();
    try {
        await connection.beginTransaction();
        if (!(await userCanWriteCalendarOnConnection(connection, user, req.params.id, true))) {
            await connection.rollback();
            return res.status(403).json({ success: false, error: 'Unauthorized calendar' });
        }
        let imported = 0;
        let revision = null;
        for (const event of events) {
            const uid = event.uid;
            const icalLine = event.icalData;
            const [existingRows] = await connection.query(`SELECT uid, resource_name, ical_data, sync_token FROM events
                 WHERE calendar_id = ? AND uid = ? LIMIT 1 FOR UPDATE`, [req.params.id, uid]);
            const existing = existingRows[0];
            const resourceName = String(existing?.resource_name || uid);
            const [tombstoneResult] = await connection.query(`DELETE FROM calendar_tombstones
                 WHERE calendar_id = ?
                 AND BINARY COALESCE(NULLIF(resource_name, ''), uid) = BINARY ?`, [req.params.id, resourceName]);
            const changed = !existing
                || String(existing.ical_data || '') !== icalLine
                || Number(tombstoneResult.affectedRows || 0) > 0;
            if (changed) {
                revision ??= await (0, calendar_utils_1.allocateCalendarCollectionRevisionOnConnection)(connection, req.params.id);
                if (existing) {
                    await connection.query('UPDATE events SET ical_data = ?, sync_token = ? WHERE calendar_id = ? AND uid = ?', [icalLine, revision, req.params.id, uid]);
                }
                else {
                    await connection.query(`INSERT INTO events
                         (calendar_id, uid, resource_name, ical_data, sync_token)
                         VALUES (?, ?, ?, ?, ?)`, [req.params.id, uid, uid, icalLine, revision]);
                }
            }
            imported++;
        }
        if (revision === null)
            await connection.rollback();
        else {
            await connection.commit();
            emitCalendarUpdated(user, req.params.id);
        }
        res.json({ success: true, count: imported });
    }
    catch (e) {
        await connection.rollback();
        res.status(500).json({ success: false, error: e.message });
    }
    finally {
        connection.release();
    }
});
exports.appsApiRouter.post('/calendars/:id/shares', async (req, res) => {
    const user = req.username;
    const { email } = req.body;
    const permission = (0, eas_calendar_1.normalizeCalendarSharePermission)(req.body?.permission === undefined ? 'read' : req.body.permission);
    if (!email)
        return res.status(400).json({ success: false, error: 'email required' });
    if (!permission)
        return res.status(400).json({ success: false, error: 'permission must be read or write' });
    try {
        const [calRows] = await db_1.pool.query('SELECT id FROM calendars WHERE id = ? AND user_id = ?', [req.params.id, user]);
        if (calRows.length === 0)
            return res.status(403).json({ success: false, error: 'Not authorized' });
        await db_1.pool.query('INSERT INTO calendar_shares (calendar_id, shared_with_user_id, permission) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE permission = VALUES(permission)', [req.params.id, email, permission]);
        res.json({ success: true });
    }
    catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});
exports.appsApiRouter.delete('/calendars/:id/shares/:email', async (req, res) => {
    const user = req.username;
    const { email } = req.params;
    try {
        const [calRows] = await db_1.pool.query('SELECT id FROM calendars WHERE id = ? AND user_id = ?', [req.params.id, user]);
        if (calRows.length === 0 && email !== user)
            return res.status(403).json({ success: false, error: 'Not authorized' });
        await db_1.pool.query('DELETE FROM calendar_shares WHERE calendar_id = ? AND shared_with_user_id = ?', [req.params.id, email]);
        res.json({ success: true });
    }
    catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});
exports.appsApiRouter.delete('/calendars/:id', async (req, res) => {
    const user = req.username;
    const calendarId = Number(req.params.id);
    if (!Number.isInteger(calendarId) || calendarId <= 0) {
        return res.status(400).json({ success: false, error: 'Invalid calendar id' });
    }
    const connection = await db_1.pool.getConnection();
    try {
        await connection.beginTransaction();
        const [ownedCalendars] = await connection.query(`SELECT id, dav_slug, subscribed_url
             FROM calendars
             WHERE user_id = ?
             ORDER BY id ASC
             FOR UPDATE`, [user]);
        const ownedCalendar = ownedCalendars.find((calendar) => Number(calendar.id) === calendarId);
        if (!ownedCalendar) {
            const [sharedRows] = await connection.query(`SELECT cs.calendar_id
                 FROM calendar_shares cs
                 JOIN calendars c ON c.id = cs.calendar_id
                 WHERE cs.calendar_id = ? AND cs.shared_with_user_id = ?
                 LIMIT 1
                 FOR UPDATE`, [calendarId, user]);
            if (sharedRows.length === 0) {
                await connection.rollback();
                return res.status(404).json({ success: false, error: 'Calendar not found' });
            }
            await connection.query('DELETE FROM calendar_shares WHERE calendar_id = ? AND shared_with_user_id = ?', [calendarId, user]);
            await connection.commit();
            emitCalendarUpdated(user, calendarId);
            return res.json({ success: true, removed: true, deletedEvents: 0 });
        }
        if ((0, birthday_calendar_1.isManagedBirthdayCalendar)(ownedCalendar)) {
            await connection.rollback();
            return res.status(409).json({ success: false, error: 'The Birthdays calendar is managed from Contacts' });
        }
        const primaryCalendar = ownedCalendars.find((calendar) => (!(0, birthday_calendar_1.isManagedBirthdayCalendar)(calendar)
            && !String(calendar.subscribed_url || '').trim()));
        if (!String(ownedCalendar.subscribed_url || '').trim()
            && Number(primaryCalendar?.id) === calendarId) {
            await connection.rollback();
            return res.status(409).json({ success: false, error: 'The primary calendar cannot be deleted' });
        }
        const [eventRows] = await connection.query('SELECT COUNT(*) AS event_count FROM events WHERE calendar_id = ?', [calendarId]);
        const deletedEvents = Number(eventRows[0]?.event_count || 0);
        await connection.query('DELETE FROM events WHERE calendar_id = ?', [calendarId]);
        await connection.query('DELETE FROM calendar_tombstones WHERE calendar_id = ?', [calendarId]);
        await connection.query('DELETE FROM calendar_shares WHERE calendar_id = ?', [calendarId]);
        const [result] = await connection.query('DELETE FROM calendars WHERE id = ? AND user_id = ?', [calendarId, user]);
        if (result.affectedRows === 0) {
            await connection.rollback();
            return res.status(404).json({ success: false, error: 'Calendar not found' });
        }
        await connection.commit();
        emitCalendarUpdated(user, calendarId);
        res.json({
            success: true,
            deletedEvents,
            removed: Boolean(String(ownedCalendar.subscribed_url || '').trim()),
        });
    }
    catch (e) {
        try {
            await connection.rollback();
        }
        catch { }
        res.status(500).json({ success: false, error: e.message });
    }
    finally {
        connection.release();
    }
});
exports.appsApiRouter.post('/events', async (req, res) => {
    const user = req.username;
    const { data: submittedIcalData, calendar_id } = req.body;
    if (typeof submittedIcalData !== 'string' || !submittedIcalData) {
        return res.status(400).json({ success: false, error: 'Missing data (iCalendar string)' });
    }
    let validatedEvent;
    try {
        validatedEvent = validatedWebCalendarEvent(submittedIcalData);
    }
    catch (error) {
        const message = error instanceof Error ? error.message : 'Invalid iCalendar data';
        return res.status(400).json({ success: false, error: message });
    }
    // The shared validator groups a recurring master and its RECURRENCE-ID
    // exceptions under the exact same opaque UID.
    const uid = validatedEvent.uid;
    const ical_data = validatedEvent.icalData;
    let connection = null;
    try {
        // resolve calendar: use provided calendar_id, or the user's first personal calendar
        let calId = calendar_id;
        if (!calId) {
            const [userCals] = await db_1.pool.query('SELECT id FROM calendars WHERE user_id = ? ORDER BY id ASC LIMIT 1', [user]);
            if (userCals.length === 0)
                return res.status(400).json({ success: false, error: 'No calendar found for user' });
            calId = userCals[0].id;
        }
        connection = await db_1.pool.getConnection();
        await connection.beginTransaction();
        if (!(await userCanWriteCalendarOnConnection(connection, user, calId))) {
            await connection.rollback();
            return res.status(403).json({ success: false, error: 'Unauthorized calendar' });
        }
        const [existingRows] = await connection.query(`SELECT uid, resource_name, ical_data, sync_token FROM events
             WHERE calendar_id = ? AND uid = ? LIMIT 1 FOR UPDATE`, [calId, uid]);
        const existing = existingRows[0];
        const resourceName = String(existing?.resource_name || uid);
        const [tombstoneResult] = await connection.query(`DELETE FROM calendar_tombstones
             WHERE calendar_id = ?
             AND BINARY COALESCE(NULLIF(resource_name, ''), uid) = BINARY ?`, [calId, resourceName]);
        const changed = !existing
            || String(existing.ical_data || '') !== String(ical_data)
            || Number(tombstoneResult.affectedRows || 0) > 0;
        if (!changed) {
            await connection.rollback();
            return res.json({ success: true });
        }
        const revision = await (0, calendar_utils_1.allocateCalendarCollectionRevisionOnConnection)(connection, calId);
        if (existing) {
            await connection.query('UPDATE events SET ical_data = ?, sync_token = ? WHERE calendar_id = ? AND uid = ?', [ical_data, revision, calId, uid]);
        }
        else {
            await connection.query(`INSERT INTO events
                 (calendar_id, uid, resource_name, ical_data, sync_token)
                 VALUES (?, ?, ?, ?, ?)`, [calId, uid, uid, ical_data, revision]);
        }
        await connection.commit();
        emitCalendarUpdated(user, calId);
        res.json({ success: true });
    }
    catch (e) {
        if (connection)
            await connection.rollback();
        res.status(500).json({ success: false, error: e.message });
    }
    finally {
        connection?.release();
    }
});
function calendarInvitationIdempotencyKey(req) {
    const value = req.headers['idempotency-key'];
    if (typeof value !== 'string' || !/^[\x21-\x7e]{8,128}$/.test(value)) {
        throw new scheduled_send_1.OutboundIdempotencyKeyError('An ASCII Idempotency-Key between 8 and 128 characters is required');
    }
    return value;
}
function calendarInvitationMessageId(user, idempotencyKey) {
    const domain = user.slice(user.lastIndexOf('@') + 1) || 'openmailstack.local';
    const digest = crypto.createHash('sha256').update(`${user}\0${idempotencyKey}`).digest('hex').slice(0, 40);
    return `<calendar-${digest}@${domain}>`;
}
function calendarInvitationSemanticDigest(context) {
    return crypto.createHash('sha256').update(JSON.stringify(context)).digest('hex');
}
function calendarInvitationRetrySemanticDigest(actionDigest, retryOf) {
    return crypto.createHash('sha256')
        .update(JSON.stringify({ actionDigest, retryOf }))
        .digest('hex');
}
function calendarInvitationRecoveryMetadata(context, retryOf) {
    const actionDigest = calendarInvitationSemanticDigest(context);
    return {
        kind: 'calendar-invitation',
        version: 1,
        calendarId: context.calendarId,
        uid: context.uid,
        action: context.action,
        actionDigest,
        semanticDigest: calendarInvitationRetrySemanticDigest(actionDigest, retryOf),
        ...(retryOf ? { retryOf } : {}),
        ...(context.action === 'respond' ? { response: context.response } : {}),
        ...(context.action === 'cancel' ? {
            scope: context.scope,
            ...(context.occurrenceId ? { occurrenceId: context.occurrenceId } : {}),
        } : {}),
    };
}
function storedCalendarInvitationRecovery(row) {
    try {
        const display = JSON.parse(String(row.display_metadata_json || '{}'));
        const recovery = display?.recovery;
        if (recovery?.kind !== 'calendar-invitation' || recovery?.version !== 1
            || typeof recovery.calendarId !== 'string' || typeof recovery.uid !== 'string'
            || !['respond', 'cancel', 'propose-time'].includes(recovery.action)
            || !/^[a-f0-9]{64}$/.test(String(recovery.actionDigest || ''))
            || !/^[a-f0-9]{64}$/.test(String(recovery.semanticDigest || ''))) {
            return null;
        }
        return recovery;
    }
    catch {
        return null;
    }
}
function calendarInvitationRecoveryMatches(stored, expected) {
    return stored.kind === expected.kind
        && stored.version === expected.version
        && stored.calendarId === expected.calendarId
        && stored.uid === expected.uid
        && stored.action === expected.action
        && stored.actionDigest === expected.actionDigest
        && stored.semanticDigest === expected.semanticDigest;
}
function calendarInvitationActionMatches(stored, expected) {
    return stored.kind === expected.kind
        && stored.version === expected.version
        && stored.calendarId === expected.calendarId
        && stored.uid === expected.uid
        && stored.action === expected.action
        && stored.actionDigest === expected.actionDigest;
}
function calendarInvitationContextFromRecovery(recovery) {
    if (recovery.action === 'respond'
        && ['accepted', 'tentative', 'declined'].includes(String(recovery.response))) {
        return {
            calendarId: recovery.calendarId,
            uid: recovery.uid,
            action: 'respond',
            response: recovery.response,
        };
    }
    if (recovery.action === 'cancel'
        && (recovery.scope === 'occurrence' || recovery.scope === 'series')) {
        const occurrenceId = recovery.scope === 'occurrence'
            && typeof recovery.occurrenceId === 'string' && recovery.occurrenceId
            ? recovery.occurrenceId
            : null;
        if (recovery.scope === 'occurrence' && !occurrenceId)
            return null;
        return {
            calendarId: recovery.calendarId,
            uid: recovery.uid,
            action: 'cancel',
            scope: recovery.scope,
            occurrenceId,
        };
    }
    if (recovery.action === 'propose-time') {
        return {
            calendarId: recovery.calendarId,
            uid: recovery.uid,
            action: 'propose-time',
            start: '',
            end: '',
            comment: '',
        };
    }
    return null;
}
function calendarInvitationStateDigest(source, actor, context) {
    const state = context.action === 'respond'
        ? (0, calendar_invitations_1.calendarInvitationActionStateFingerprint)(source, actor, {
            action: context.action,
            response: context.response,
        })
        : context.action === 'cancel'
            ? (0, calendar_invitations_1.calendarInvitationActionStateFingerprint)(source, actor, {
                action: context.action,
                scope: context.scope,
                occurrenceId: context.occurrenceId,
            })
            : (0, calendar_invitations_1.calendarInvitationActionStateFingerprint)(source, actor, {
                action: context.action,
                start: context.start,
                end: context.end,
            });
    return crypto.createHash('sha256').update(state).digest('hex');
}
function calendarInvitationActionResponse(context) {
    if (context.action === 'respond')
        return { response: context.response, scope: 'series' };
    if (context.action === 'cancel')
        return { scope: context.scope };
    return { proposed: true };
}
function rejectedRecipientsFromOutboundRow(row) {
    try {
        const parsed = JSON.parse(String(row.rejected_recipients_json || '[]'));
        return Array.isArray(parsed) ? parsed.filter(value => typeof value === 'string') : [];
    }
    catch {
        return [];
    }
}
function sendCalendarInvitationSubmissionStatus(res, row, context, replayed) {
    res.set('Cache-Control', 'no-store');
    const rejectedRecipients = rejectedRecipientsFromOutboundRow(row);
    const base = {
        success: true,
        outboundId: Number(row.id),
        replayed,
        submissionKind: 'immediate',
        rejectedRecipients,
        ...calendarInvitationActionResponse(context),
    };
    if (['scheduled', 'retry_wait', 'claimed', 'smtp_inflight'].includes(String(row.status))) {
        res.json({
            ...base,
            deliveryStatus: 'pending',
            statusUrl: `/api/messages/outbound/${Number(row.id)}`,
            retryAfterMs: 2_000,
        });
        return;
    }
    if (row.status === 'completed' || row.status === 'partial_delivery' || row.status === 'sent_copy_pending') {
        res.json({
            ...base,
            deliveryStatus: row.status === 'partial_delivery' || rejectedRecipients.length > 0
                ? 'partial'
                : 'accepted',
            sentCopyStatus: row.status === 'sent_copy_pending' ? 'pending' : 'saved',
        });
        return;
    }
    if (row.status === 'delivery_uncertain') {
        res.json({
            ...base,
            deliveryStatus: 'uncertain',
            sentCopyStatus: 'unavailable',
            error: 'OpenMailStack could not confirm whether the mail server accepted this message.',
        });
        return;
    }
    res.json({
        ...base,
        deliveryStatus: 'failed',
        sentCopyStatus: 'unavailable',
        error: 'The mail server did not accept this message.',
    });
}
function calendarInvitationRetryKey(req) {
    const value = req.body?.retryOf;
    if (value === undefined)
        return null;
    if (typeof value !== 'string' || !/^[\x21-\x7e]{8,128}$/.test(value)) {
        throw new scheduled_send_1.OutboundIdempotencyKeyError('A retryOf idempotency key between 8 and 128 ASCII characters is required');
    }
    return value;
}
function sendCalendarInvitationError(res, error) {
    if (error instanceof calendar_invitations_1.CalendarInvitationActionError
        || error instanceof outbound_mail_1.OutboundMessageValidationError
        || error instanceof scheduled_send_1.OutboundIdempotencyKeyError
        || error instanceof scheduled_send_1.OutboundIdempotencyConflictError
        || error instanceof scheduled_send_1.OutboundReleaseBridgeError
        || error instanceof scheduled_send_1.OutboundSubmissionUnavailableError) {
        const candidate = error;
        const status = [400, 403, 404, 409, 503].includes(Number(candidate.status))
            ? Number(candidate.status)
            : 500;
        res.status(status).json({ success: false, error: candidate.message, code: candidate.code });
        return;
    }
    if (error instanceof calendar_ical_validation_1.ICalendarValidationError) {
        res.status(400).json({ success: false, error: error.message, code: 'INVALID_EVENT' });
        return;
    }
    console.error('Calendar invitation action failed:', error);
    res.status(500).json({ success: false, error: 'The meeting action could not be completed' });
}
async function reserveCalendarInvitationRetry(connection, user, idempotencyKey, retryOf, expectedContext, verifiedAbsent = false) {
    const [retryRows] = await connection.query(`SELECT id, submission_kind, submission_origin, idempotency_key, request_fingerprint,
                status, message_id, send_at, smtp_accepted_at, save_in_sent_items,
                rejected_recipients_json, last_error_code, display_metadata_json,
                sender_address, envelope_json, raw_message, sent_raw_message
         FROM scheduled_emails
         WHERE username = ? AND idempotency_key = ? LIMIT 1 FOR UPDATE`, [user, retryOf]);
    const retryRow = retryRows?.[0];
    const retryRecovery = retryRow ? storedCalendarInvitationRecovery(retryRow) : null;
    const storedContext = retryRecovery ? calendarInvitationContextFromRecovery(retryRecovery) : null;
    const context = expectedContext || storedContext;
    if (!retryRow || !retryRecovery || !context
        || (expectedContext && !calendarInvitationActionMatches(retryRecovery, calendarInvitationRecoveryMetadata(context, null)))) {
        throw new calendar_invitations_1.CalendarInvitationActionError('INVALID_RETRY', 'The original meeting notification could not be verified for this retry', 409);
    }
    if (retryRecovery.retrySuccessorKey) {
        if (retryRecovery.retrySuccessorKey === idempotencyKey) {
            const [successorRows] = await connection.query(`SELECT id, submission_kind, submission_origin, idempotency_key, request_fingerprint,
                        status, message_id, send_at, smtp_accepted_at, save_in_sent_items,
                        rejected_recipients_json, last_error_code, display_metadata_json
                 FROM scheduled_emails
                 WHERE username = ? AND idempotency_key = ? LIMIT 1 FOR UPDATE`, [user, idempotencyKey]);
            const successor = successorRows?.[0];
            const successorRecovery = successor ? storedCalendarInvitationRecovery(successor) : null;
            if (successor && successorRecovery
                && successorRecovery.actionDigest === retryRecovery.actionDigest
                && successorRecovery.semanticDigest === calendarInvitationRetrySemanticDigest(retryRecovery.actionDigest, retryOf)) {
                return { context, existing: successor };
            }
            throw new scheduled_send_1.OutboundIdempotencyConflictError();
        }
        throw new calendar_invitations_1.CalendarInvitationActionError('RETRY_ALREADY_STARTED', 'A retry has already been started for this meeting notification', 409);
    }
    if (retryRow.status !== 'failed' && retryRow.status !== 'partial_delivery'
        && !(retryRow.status === 'delivery_uncertain' && verifiedAbsent)) {
        throw new calendar_invitations_1.CalendarInvitationActionError('RETRY_NOT_ALLOWED', retryRow.status === 'delivery_uncertain'
            ? 'Confirm that the uncertain notification was independently verified as not delivered before retrying'
            : 'Only a failed or partially delivered meeting notification can be retried', 409);
    }
    if (!/^[a-f0-9]{64}$/.test(String(retryRecovery.stateDigest || ''))
        || typeof retryRecovery.actor !== 'string' || !retryRecovery.actor) {
        throw new calendar_invitations_1.CalendarInvitationActionError('RETRY_PAYLOAD_UNAVAILABLE', 'The original meeting state cannot be verified for an exact retry', 409);
    }
    const [stateRows] = await connection.query('SELECT ical_data FROM events WHERE calendar_id = ? AND uid = ? LIMIT 1 FOR UPDATE', [context.calendarId, context.uid]);
    const currentIcal = stateRows?.[0]?.ical_data;
    const currentStateDigest = typeof currentIcal === 'string'
        ? calendarInvitationStateDigest(currentIcal, retryRecovery.actor, context)
        : '';
    if (currentStateDigest !== retryRecovery.stateDigest) {
        throw new calendar_invitations_1.CalendarInvitationActionError('INVITATION_ACTION_SUPERSEDED', 'The meeting changed after this notification failed, so the old action cannot be retried safely', 409);
    }
    let originalEnvelope;
    let displayMetadata;
    try {
        originalEnvelope = JSON.parse(String(retryRow.envelope_json || ''));
        displayMetadata = JSON.parse(String(retryRow.display_metadata_json || '{}'));
    }
    catch {
        throw new calendar_invitations_1.CalendarInvitationActionError('RETRY_PAYLOAD_UNAVAILABLE', 'The original meeting notification is no longer available for an exact retry', 409);
    }
    const originalRecipients = Array.isArray(originalEnvelope.to)
        ? originalEnvelope.to.filter(value => typeof value === 'string')
        : [];
    const rejected = new Set(rejectedRecipientsFromOutboundRow(retryRow).map(outbound_mail_1.normalizeMailboxAddress).filter(Boolean));
    const retryRecipients = retryRow.status === 'partial_delivery'
        ? originalRecipients.filter(recipient => rejected.has((0, outbound_mail_1.normalizeMailboxAddress)(recipient)))
        : originalRecipients;
    const raw = Buffer.isBuffer(retryRow.raw_message)
        ? retryRow.raw_message
        : retryRow.raw_message ? Buffer.from(retryRow.raw_message) : null;
    const sentRaw = Buffer.isBuffer(retryRow.sent_raw_message)
        ? retryRow.sent_raw_message
        : retryRow.sent_raw_message ? Buffer.from(retryRow.sent_raw_message) : raw;
    const senderAddress = typeof retryRow.sender_address === 'string'
        ? retryRow.sender_address
        : typeof originalEnvelope.from === 'string' ? originalEnvelope.from : '';
    const currentIdentities = await (0, outbound_mail_1.listOwnedSenderIdentities)(connection, user);
    const normalizedSender = (0, outbound_mail_1.normalizeMailboxAddress)(senderAddress);
    if (!normalizedSender || !currentIdentities.addresses.some(address => ((0, outbound_mail_1.normalizeMailboxAddress)(address) === normalizedSender))) {
        throw new calendar_invitations_1.CalendarInvitationActionError('SENDER_NOT_AUTHORIZED', 'The identity used by the original meeting notification is no longer active for this mailbox', 403);
    }
    if (!raw || !sentRaw || !senderAddress || !retryRow.message_id || retryRecipients.length === 0) {
        throw new calendar_invitations_1.CalendarInvitationActionError('RETRY_PAYLOAD_UNAVAILABLE', 'The original meeting notification is no longer available for an exact retry', 409);
    }
    const recovery = {
        ...retryRecovery,
        semanticDigest: calendarInvitationRetrySemanticDigest(retryRecovery.actionDigest, retryOf),
        retryOf,
    };
    delete recovery.retrySuccessorKey;
    retryRecovery.retrySuccessorKey = idempotencyKey;
    recovery.stateDigest = retryRecovery.stateDigest;
    recovery.actor = retryRecovery.actor;
    displayMetadata.recovery = retryRecovery;
    await connection.query(`UPDATE scheduled_emails SET display_metadata_json = ?
         WHERE id = ? AND username = ? AND idempotency_key = ?`, [JSON.stringify(displayMetadata), retryRow.id, user, retryOf]);
    const reservation = await (0, scheduled_send_1.reserveOutboundInTransaction)(connection, {
        submissionKind: 'immediate',
        idempotencyKey,
        fingerprintSource: {
            calendarId: context.calendarId,
            uid: context.uid,
            actionDigest: recovery.actionDigest,
            retryOf,
        },
        message: {
            username: user,
            sendAt: new Date(),
            senderAddress,
            messageId: String(retryRow.message_id),
            envelope: { from: senderAddress, to: retryRecipients },
            raw,
            sentRaw,
            metadata: displayMetadata,
            recovery,
            saveSentCopy: retryRow.status === 'partial_delivery'
                ? false
                : Boolean(retryRow.save_in_sent_items),
        },
    });
    if (reservation.replayed) {
        const existing = await (0, universal_outbox_1.findUniversalOutboundIdentityForUpdate)(connection, user, { idempotencyKey });
        const existingRecovery = existing ? storedCalendarInvitationRecovery(existing) : null;
        if (!existing || !existingRecovery
            || existingRecovery.retryOf !== retryOf
            || existingRecovery.semanticDigest !== recovery.semanticDigest) {
            throw new scheduled_send_1.OutboundIdempotencyConflictError();
        }
        return { context, existing };
    }
    return { context, reservation };
}
async function performCalendarInvitationAction(req, res, action, buildPlan) {
    const user = req.username;
    const calendarId = String(req.params.calendar_id);
    const uid = String(req.params.uid);
    const context = { calendarId, uid, ...action };
    let connection = null;
    let changed = false;
    try {
        const idempotencyKey = calendarInvitationIdempotencyKey(req);
        const retryOf = calendarInvitationRetryKey(req);
        if (retryOf === idempotencyKey) {
            throw new calendar_invitations_1.CalendarInvitationActionError('INVALID_RETRY', 'A retry must use a new idempotency key', 409);
        }
        const recovery = calendarInvitationRecoveryMetadata(context, retryOf);
        await (0, scheduled_send_1.ensureScheduledEmailsSchema)(db_1.pool);
        connection = await db_1.pool.getConnection();
        await connection.beginTransaction();
        const existing = await (0, universal_outbox_1.findUniversalOutboundIdentityForUpdate)(connection, user, { idempotencyKey });
        if (existing) {
            const existingRecovery = storedCalendarInvitationRecovery(existing);
            if (existingRecovery) {
                if (!calendarInvitationRecoveryMatches(existingRecovery, recovery)) {
                    throw new scheduled_send_1.OutboundIdempotencyConflictError();
                }
                await connection.rollback();
                connection.release();
                connection = null;
                sendCalendarInvitationSubmissionStatus(res, existing, context, true);
                return;
            }
        }
        if (retryOf) {
            const retry = await reserveCalendarInvitationRetry(connection, user, idempotencyKey, retryOf, context);
            await connection.commit();
            connection.release();
            connection = null;
            if (retry.existing) {
                sendCalendarInvitationSubmissionStatus(res, retry.existing, context, true);
                return;
            }
            const reservation = retry.reservation;
            void (0, scheduled_send_1.runScheduledSender)().catch(error => console.error('Calendar invitation retry worker failed:', error));
            res.json({
                success: true,
                outboundId: reservation.id,
                replayed: reservation.replayed,
                submissionKind: 'immediate',
                deliveryStatus: 'pending',
                statusUrl: `/api/messages/outbound/${reservation.id}`,
                retryAfterMs: 2_000,
                ...calendarInvitationActionResponse(context),
            });
            return;
        }
        if (!(await userCanWriteCalendarOnConnection(connection, user, calendarId))) {
            await connection.rollback();
            connection.release();
            connection = null;
            res.status(403).json({ success: false, error: 'Unauthorized calendar' });
            return;
        }
        const [eventRows] = await connection.query(`SELECT uid, resource_name, ical_data, sync_token
             FROM events WHERE calendar_id = ? AND uid = ? LIMIT 1 FOR UPDATE`, [calendarId, uid]);
        if (eventRows.length === 0) {
            await connection.rollback();
            connection.release();
            connection = null;
            res.status(404).json({ success: false, error: 'Event not found' });
            return;
        }
        const event = eventRows[0];
        const identities = await (0, outbound_mail_1.listOwnedSenderIdentities)(connection, user);
        const sourceIcal = String(event.ical_data || '');
        const plan = buildPlan(sourceIcal, identities.addresses);
        const reservationRecovery = {
            ...recovery,
            actor: plan.delivery.sender,
            stateDigest: calendarInvitationStateDigest(plan.updatedIcal === undefined ? sourceIcal : plan.updatedIcal, plan.delivery.sender, context),
        };
        const compiled = await (0, outbound_mail_1.compileOutboundMessage)({
            sender: { address: plan.delivery.sender, name: identities.name },
            to: plan.delivery.recipients,
            subject: plan.delivery.subject,
            text: plan.delivery.text,
            headers: { 'Content-Class': 'urn:content-classes:calendarmessage' },
            icalEvent: {
                method: plan.delivery.method,
                filename: 'invite.ics',
                content: plan.delivery.ical,
            },
            messageId: calendarInvitationMessageId(user, idempotencyKey),
        });
        const reservation = await (0, scheduled_send_1.reserveOutboundInTransaction)(connection, {
            submissionKind: 'immediate',
            idempotencyKey,
            fingerprintSource: { calendarId, uid, ...plan.fingerprint },
            message: {
                username: user,
                sendAt: new Date(),
                senderAddress: compiled.envelope.from,
                messageId: compiled.messageId,
                envelope: compiled.envelope,
                raw: compiled.raw,
                sentRaw: compiled.sentRaw,
                metadata: compiled.metadata,
                recovery: reservationRecovery,
                saveSentCopy: true,
            },
        });
        if (reservation.replayed) {
            const replay = await (0, universal_outbox_1.findUniversalOutboundIdentityForUpdate)(connection, user, { idempotencyKey });
            const replayRecovery = replay ? storedCalendarInvitationRecovery(replay) : null;
            if (!replay || !replayRecovery || !calendarInvitationRecoveryMatches(replayRecovery, recovery)) {
                throw new scheduled_send_1.OutboundIdempotencyConflictError();
            }
            await connection.rollback();
            connection.release();
            connection = null;
            sendCalendarInvitationSubmissionStatus(res, replay, context, true);
            return;
        }
        if (!reservation.replayed && plan.replayOnlyError)
            throw plan.replayOnlyError;
        if (!reservation.replayed && plan.updatedIcal !== undefined
            && plan.updatedIcal !== String(event.ical_data || '')) {
            const revision = await (0, calendar_utils_1.allocateCalendarCollectionRevisionOnConnection)(connection, calendarId);
            await connection.query(`DELETE FROM calendar_tombstones
                 WHERE calendar_id = ? AND BINARY resource_name = BINARY ?`, [calendarId, String(event.resource_name || event.uid)]);
            const [updateResult] = await connection.query(`UPDATE events SET ical_data = ?, sync_token = ?
                 WHERE calendar_id = ? AND uid = ? AND sync_token = ?`, [plan.updatedIcal, revision, calendarId, uid, event.sync_token]);
            if (Number(updateResult.affectedRows) !== 1) {
                throw new calendar_invitations_1.CalendarInvitationActionError('EVENT_CHANGED', 'The meeting changed while this action was being prepared. Refresh and try again.', 409);
            }
            changed = true;
        }
        await connection.commit();
        connection.release();
        connection = null;
        if (changed)
            emitCalendarUpdated(user, calendarId);
        void (0, scheduled_send_1.runScheduledSender)().catch(error => console.error('Calendar invitation delivery worker failed:', error));
        res.json({
            success: true,
            outboundId: reservation.id,
            replayed: reservation.replayed,
            submissionKind: 'immediate',
            deliveryStatus: 'pending',
            statusUrl: `/api/messages/outbound/${reservation.id}`,
            retryAfterMs: 2_000,
            ...calendarInvitationActionResponse(context),
        });
    }
    catch (error) {
        if (connection) {
            try {
                await connection.rollback();
            }
            catch { }
        }
        sendCalendarInvitationError(res, error);
    }
    finally {
        connection?.release?.();
    }
}
exports.appsApiRouter.post('/calendar-invitations/retry', async (req, res) => {
    const user = req.username;
    let connection = null;
    try {
        const idempotencyKey = calendarInvitationIdempotencyKey(req);
        const retryOf = calendarInvitationRetryKey(req);
        if (!retryOf || retryOf === idempotencyKey) {
            throw new calendar_invitations_1.CalendarInvitationActionError('INVALID_RETRY', 'A retry requires the original idempotency key and a new idempotency key', 409);
        }
        await (0, scheduled_send_1.ensureScheduledEmailsSchema)(db_1.pool);
        connection = await db_1.pool.getConnection();
        await connection.beginTransaction();
        const existing = await (0, universal_outbox_1.findUniversalOutboundIdentityForUpdate)(connection, user, { idempotencyKey });
        if (existing) {
            const existingRecovery = storedCalendarInvitationRecovery(existing);
            const existingContext = existingRecovery
                ? calendarInvitationContextFromRecovery(existingRecovery)
                : null;
            if (!existingRecovery || !existingContext || existingRecovery.retryOf !== retryOf
                || existingRecovery.semanticDigest !== calendarInvitationRetrySemanticDigest(existingRecovery.actionDigest, retryOf)) {
                throw new scheduled_send_1.OutboundIdempotencyConflictError();
            }
            await connection.rollback();
            connection.release();
            connection = null;
            sendCalendarInvitationSubmissionStatus(res, existing, existingContext, true);
            return;
        }
        const retry = await reserveCalendarInvitationRetry(connection, user, idempotencyKey, retryOf, undefined, req.body?.verifiedAbsent === true);
        await connection.commit();
        connection.release();
        connection = null;
        if (retry.existing) {
            sendCalendarInvitationSubmissionStatus(res, retry.existing, retry.context, true);
            return;
        }
        const { context, reservation } = retry;
        void (0, scheduled_send_1.runScheduledSender)().catch(error => console.error('Calendar invitation retry worker failed:', error));
        res.json({
            success: true,
            outboundId: reservation.id,
            replayed: reservation.replayed,
            submissionKind: 'immediate',
            deliveryStatus: 'pending',
            statusUrl: `/api/messages/outbound/${reservation.id}`,
            retryAfterMs: 2_000,
            ...calendarInvitationActionResponse(context),
        });
    }
    catch (error) {
        if (connection) {
            try {
                await connection.rollback();
            }
            catch { }
        }
        sendCalendarInvitationError(res, error);
    }
    finally {
        connection?.release?.();
    }
});
exports.appsApiRouter.post('/events/:calendar_id/:uid/respond', async (req, res) => {
    const response = req.body?.response;
    if (!['accepted', 'tentative', 'declined'].includes(response)) {
        res.status(400).json({ success: false, error: 'Response must be accepted, tentative, or declined' });
        return;
    }
    await performCalendarInvitationAction(req, res, { action: 'respond', response }, (icalData, ownedAddresses) => {
        const prepared = (0, calendar_invitations_1.prepareInvitationResponse)(icalData, ownedAddresses, response);
        return {
            delivery: prepared.delivery,
            fingerprint: { action: 'respond', response, scope: 'series' },
            updatedIcal: prepared.updatedIcal,
            response: { response, scope: 'series' },
            ...(prepared.alreadyResponded ? {
                replayOnlyError: new calendar_invitations_1.CalendarInvitationActionError('ALREADY_RESPONDED', `This meeting response is already ${response}`, 409),
            } : {}),
        };
    });
});
exports.appsApiRouter.post('/events/:calendar_id/:uid/cancel', async (req, res) => {
    const scope = req.body?.scope === 'occurrence' ? 'occurrence' : req.body?.scope === 'series' ? 'series' : null;
    const occurrenceId = scope === 'occurrence' && typeof req.body?.occurrenceId === 'string'
        ? req.body.occurrenceId
        : undefined;
    if (!scope || (scope === 'occurrence' && !occurrenceId)) {
        res.status(400).json({ success: false, error: 'Cancellation scope is invalid' });
        return;
    }
    await performCalendarInvitationAction(req, res, {
        action: 'cancel', scope, occurrenceId: occurrenceId || null,
    }, (icalData, ownedAddresses) => {
        const occurrenceAlreadyCancelled = scope === 'occurrence'
            && recurringOccurrenceIsCancelled(icalData, occurrenceId);
        if (scope === 'occurrence' && !recurringOccurrenceExists(icalData, occurrenceId)) {
            throw new calendar_invitations_1.CalendarInvitationActionError('INVALID_OCCURRENCE', 'This occurrence is no longer part of the meeting series. Refresh and try again.', 409);
        }
        const prepared = (0, calendar_invitations_1.prepareInvitationCancellation)(icalData, ownedAddresses, scope === 'occurrence'
            ? { occurrenceId, alreadyOccurrenceCancelled: occurrenceAlreadyCancelled }
            : {});
        return {
            delivery: prepared.delivery,
            fingerprint: { action: 'cancel', scope, occurrenceId: occurrenceId || null },
            updatedIcal: scope === 'occurrence'
                ? addRecurringOccurrenceExclusion(prepared.revisedIcal, occurrenceId)
                : prepared.revisedIcal,
            response: { scope },
            ...(prepared.alreadyCancelled || occurrenceAlreadyCancelled ? {
                replayOnlyError: new calendar_invitations_1.CalendarInvitationActionError('ALREADY_CANCELLED', scope === 'occurrence'
                    ? 'This meeting occurrence is already canceled'
                    : 'This meeting is already canceled', 409),
            } : {}),
        };
    });
});
exports.appsApiRouter.post('/events/:calendar_id/:uid/propose-time', async (req, res) => {
    const start = typeof req.body?.start === 'string' ? new Date(req.body.start) : new Date(Number.NaN);
    const end = typeof req.body?.end === 'string' ? new Date(req.body.end) : new Date(Number.NaN);
    const comment = typeof req.body?.comment === 'string' ? req.body.comment : undefined;
    await performCalendarInvitationAction(req, res, {
        action: 'propose-time',
        start: Number.isFinite(start.getTime()) ? start.toISOString() : '',
        end: Number.isFinite(end.getTime()) ? end.toISOString() : '',
        comment: comment?.trim() || '',
    }, (icalData, ownedAddresses) => {
        const prepared = (0, calendar_invitations_1.prepareInvitationCounter)(icalData, ownedAddresses, { start, end, comment });
        return {
            delivery: prepared.delivery,
            fingerprint: {
                action: 'propose-time',
                start: Number.isFinite(start.getTime()) ? start.toISOString() : '',
                end: Number.isFinite(end.getTime()) ? end.toISOString() : '',
                comment: comment?.trim() || '',
            },
            response: { proposed: true },
        };
    });
});
exports.appsApiRouter.delete('/events/:calendar_id/:uid', async (req, res) => {
    const user = req.username;
    const calendar_id = String(req.params.calendar_id);
    const uid = String(req.params.uid);
    const connection = await db_1.pool.getConnection();
    try {
        await connection.beginTransaction();
        if (!(await userCanWriteCalendarOnConnection(connection, user, calendar_id))) {
            await connection.rollback();
            return res.status(403).json({ success: false, error: 'Unauthorized calendar' });
        }
        const excludeWasProvided = Object.prototype.hasOwnProperty.call(req.query, 'exclude');
        const excludeDate = typeof req.query.exclude === 'string' ? req.query.exclude : undefined;
        if (excludeWasProvided && !excludeDate?.trim()) {
            await connection.rollback();
            return res.status(400).json({ success: false, error: 'Invalid recurring occurrence date' });
        }
        const [events] = await connection.query(`SELECT uid, resource_name, ical_data, sync_token
             FROM events WHERE calendar_id=? AND uid=? LIMIT 1 FOR UPDATE`, [calendar_id, uid]);
        if (events.length === 0) {
            await connection.rollback();
            return res.status(404).json({ success: false, error: 'Event not found' });
        }
        if (excludeDate) {
            let icalData;
            try {
                icalData = addRecurringOccurrenceExclusion(String(events[0].ical_data || ''), excludeDate);
            }
            catch (error) {
                if (!(error instanceof calendar_ical_validation_1.ICalendarValidationError)
                    && !(error instanceof calendar_invitations_1.CalendarInvitationActionError))
                    throw error;
                await connection.rollback();
                const status = error instanceof calendar_invitations_1.CalendarInvitationActionError ? error.status : 400;
                return res.status(status).json({ success: false, error: error.message });
            }
            const resourceName = String(events[0].resource_name || events[0].uid);
            const [tombstoneResult] = await connection.query(`DELETE FROM calendar_tombstones
                 WHERE calendar_id = ? AND BINARY resource_name = BINARY ?`, [calendar_id, resourceName]);
            if (icalData === String(events[0].ical_data || '') && !Number(tombstoneResult.affectedRows || 0)) {
                await connection.rollback();
                return res.json({ success: true });
            }
            const revision = await (0, calendar_utils_1.allocateCalendarCollectionRevisionOnConnection)(connection, calendar_id);
            await connection.query('UPDATE events SET ical_data = ?, sync_token = ? WHERE calendar_id = ? AND uid = ?', [icalData, revision, calendar_id, uid]);
        }
        else {
            const revision = await (0, calendar_utils_1.allocateCalendarCollectionRevisionOnConnection)(connection, calendar_id);
            await connection.query('DELETE FROM events WHERE calendar_id=? AND uid=?', [calendar_id, uid]);
            await connection.query(`INSERT INTO calendar_tombstones
                 (calendar_id, uid, resource_name, sync_token, deleted_at)
                 VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
                 ON DUPLICATE KEY UPDATE
                    uid = VALUES(uid), resource_name = VALUES(resource_name),
                    sync_token = VALUES(sync_token), deleted_at = CURRENT_TIMESTAMP`, [calendar_id, uid, String(events[0].resource_name || events[0].uid), revision]);
        }
        await connection.commit();
        emitCalendarUpdated(user, calendar_id);
        res.json({ success: true });
    }
    catch (e) {
        await connection.rollback();
        res.status(500).json({ success: false, error: e.message });
    }
    finally {
        connection.release();
    }
});
const MAX_FREE_BUSY_USERS = 50;
const MAX_FREE_BUSY_ADDRESS_BYTES = 254;
const MAX_FREE_BUSY_WINDOW_MS = 366 * 24 * 60 * 60 * 1000;
const MAX_FREE_BUSY_EVENT_ROWS = 5_000;
const MAX_FREE_BUSY_EXPANSION_STEPS = 5_000;
const FREE_BUSY_LOCAL_PART = /^[a-z0-9._%+-]+$/i;
const FREE_BUSY_DOMAIN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;
function canonicalFreeBusyAddress(value) {
    if (/[\r\n\0]/.test(value))
        return null;
    const address = value.trim().toLowerCase();
    if (!address
        || Buffer.byteLength(address, 'utf8') > MAX_FREE_BUSY_ADDRESS_BYTES
        || /\s/.test(address)
        || /[<>()\[\]\\,;:"]/.test(address))
        return null;
    const at = address.indexOf('@');
    if (at < 1 || at !== address.lastIndexOf('@') || at === address.length - 1)
        return null;
    const local = address.slice(0, at);
    const domain = address.slice(at + 1);
    if (Buffer.byteLength(local, 'utf8') > 64
        || !FREE_BUSY_LOCAL_PART.test(local)
        || !FREE_BUSY_DOMAIN.test(domain)
        || local.startsWith('.')
        || local.endsWith('.')
        || local.includes('..'))
        return null;
    return address;
}
function requestedFreeBusyUsers(value) {
    if (typeof value !== 'string' || !value)
        return null;
    const canonical = [];
    const seen = new Set();
    for (const rawAddress of value.split(',')) {
        const address = canonicalFreeBusyAddress(rawAddress);
        if (!address)
            return null;
        if (!seen.has(address)) {
            seen.add(address);
            canonical.push(address);
        }
    }
    return canonical.length > 0 && canonical.length <= MAX_FREE_BUSY_USERS ? canonical : null;
}
function freeBusyWindow(startValue, endValue) {
    if (typeof startValue !== 'string' || typeof endValue !== 'string')
        return null;
    const start = new Date(startValue);
    const end = new Date(endValue);
    if (!Number.isFinite(start.getTime())
        || !Number.isFinite(end.getTime())
        || end <= start
        || end.getTime() - start.getTime() > MAX_FREE_BUSY_WINDOW_MS)
        return null;
    return { start, end };
}
function freeBusyExpansionSteps(event, rangeEnd) {
    if (!event.recurrence)
        return 1;
    if (event.recurrenceExceptionOverflow)
        return null;
    const keys = String(event.recurrence.raw || '')
        .split(';')
        .map(part => part.split('=', 1)[0]?.trim().toUpperCase())
        .filter(Boolean);
    if (keys.some(key => !['FREQ', 'INTERVAL', 'COUNT', 'UNTIL'].includes(key)))
        return null;
    const effectiveEnd = event.recurrence.until && event.recurrence.until < rangeEnd
        ? event.recurrence.until
        : rangeEnd;
    let steps = 0;
    if (event.start <= effectiveEnd) {
        const interval = Math.max(1, event.recurrence.interval);
        const elapsedMs = Math.max(0, effectiveEnd.getTime() - event.start.getTime());
        if (event.recurrence.frequency === 'DAILY') {
            steps = Math.ceil(elapsedMs / (interval * 24 * 60 * 60 * 1000)) + 2;
        }
        else if (event.recurrence.frequency === 'WEEKLY') {
            steps = Math.ceil(elapsedMs / (interval * 7 * 24 * 60 * 60 * 1000)) + 2;
        }
        else if (event.recurrence.frequency === 'MONTHLY') {
            const months = (effectiveEnd.getUTCFullYear() - event.start.getUTCFullYear()) * 12
                + effectiveEnd.getUTCMonth() - event.start.getUTCMonth();
            steps = Math.ceil(Math.max(0, months) / interval) + 2;
        }
        else {
            const years = effectiveEnd.getUTCFullYear() - event.start.getUTCFullYear();
            steps = Math.ceil(Math.max(0, years) / interval) + 2;
        }
        if (event.recurrence.count)
            steps = Math.min(steps, event.recurrence.count);
    }
    return steps + (event.recurrenceExceptions?.length || 0);
}
function busyIntervals(rows, start, end) {
    const intervals = new Map();
    let expansionSteps = 0;
    for (const row of rows) {
        try {
            const icalData = typeof row.ical_data === 'string' ? row.ical_data : '';
            if (!/(?:^|\r?\n)BEGIN:VEVENT(?:\r?\n|$)/i.test(icalData)
                || !/(?:^|\r?\n)END:VEVENT(?:\r?\n|$)/i.test(icalData)
                || !/(?:^|\r?\n)DTSTART(?:;[^:\r\n]*)?:[^\r\n]+/i.test(icalData))
                return null;
            const event = (0, calendar_utils_1.parseIcalEvent)('freebusy', icalData);
            if (/(?:^|\r?\n)(?:RDATE|EXRULE)(?:;|:)/i.test(icalData))
                return null;
            const rowExpansionSteps = freeBusyExpansionSteps(event, end);
            if (rowExpansionSteps === null
                || expansionSteps + rowExpansionSteps > MAX_FREE_BUSY_EXPANSION_STEPS)
                return null;
            expansionSteps += rowExpansionSteps;
            if (event.meetingStatus === '5')
                continue;
            const occurrences = event.recurrence
                ? (0, calendar_utils_1.expandRecurringEvent)(event, start, end, Math.max(1, rowExpansionSteps))
                : [event];
            for (const occurrence of occurrences) {
                if (occurrence.busyStatus === 'free')
                    continue;
                const eventStart = new Date(occurrence.start);
                const eventEnd = new Date(occurrence.end);
                if (!Number.isFinite(eventStart.getTime())
                    || !Number.isFinite(eventEnd.getTime())
                    || eventEnd <= eventStart)
                    return null;
                if (eventEnd <= start || eventStart >= end)
                    continue;
                const interval = { start: eventStart.toISOString(), end: eventEnd.toISOString() };
                intervals.set(`${interval.start}\0${interval.end}`, interval);
            }
        }
        catch {
            return null;
        }
    }
    return [...intervals.values()].sort((left, right) => (left.start.localeCompare(right.start) || left.end.localeCompare(right.end)));
}
// A free/busy key is an authorization grant. Missing, unknown, and unshared
// recipients are deliberately indistinguishable in the neutral unavailable list.
exports.appsApiRouter.get('/calendars/freebusy', async (req, res) => {
    const users = requestedFreeBusyUsers(req.query.users);
    const window = freeBusyWindow(req.query.start, req.query.end);
    if (!users || !window) {
        return res.status(400).json({ success: false, error: 'Invalid free/busy request' });
    }
    const caller = String(req.username || '').trim().toLowerCase();
    const authorized = new Set();
    const failedUsers = new Set();
    const rowsByUser = new Map();
    try {
        if (users.includes(caller)) {
            authorized.add(caller);
            const [selfRows] = await db_1.pool.query(`SELECT e.ical_data
                 FROM events e
                 JOIN calendars c ON c.id = e.calendar_id
                 WHERE c.user_id = ?
                    OR EXISTS (
                       SELECT 1 FROM calendar_shares cs
                       WHERE cs.calendar_id = c.id AND cs.shared_with_user_id = ?
                    )
                 LIMIT ${MAX_FREE_BUSY_EVENT_ROWS + 1}`, [caller, caller]);
            if ((selfRows || []).length > MAX_FREE_BUSY_EVENT_ROWS)
                failedUsers.add(caller);
            else
                rowsByUser.set(caller, selfRows || []);
        }
        const otherUsers = users.filter(user => user !== caller);
        if (otherUsers.length > 0) {
            const placeholders = otherUsers.map(() => '?').join(', ');
            const [sharedTargets] = await db_1.pool.query(`SELECT DISTINCT c.user_id AS target_user
                 FROM calendars c
                 JOIN calendar_shares cs ON cs.calendar_id = c.id
                 WHERE cs.shared_with_user_id = ?
                   AND c.user_id IN (${placeholders})`, [caller, ...otherUsers]);
            for (const row of sharedTargets || []) {
                const target = String(row.target_user || '').trim().toLowerCase();
                if (otherUsers.includes(target))
                    authorized.add(target);
            }
            const authorizedOthers = otherUsers.filter(user => authorized.has(user));
            if (authorizedOthers.length > 0) {
                const authorizedPlaceholders = authorizedOthers.map(() => '?').join(', ');
                const [sharedEventRows] = await db_1.pool.query(`SELECT c.user_id AS target_user, e.ical_data
                     FROM events e
                     JOIN calendars c ON c.id = e.calendar_id
                     WHERE c.user_id IN (${authorizedPlaceholders})
                       AND EXISTS (
                         SELECT 1 FROM calendar_shares cs
                         WHERE cs.calendar_id = c.id AND cs.shared_with_user_id = ?
                       )
                     LIMIT ${MAX_FREE_BUSY_EVENT_ROWS + 1}`, [...authorizedOthers, caller]);
                if ((sharedEventRows || []).length > MAX_FREE_BUSY_EVENT_ROWS) {
                    for (const target of authorizedOthers)
                        failedUsers.add(target);
                }
                else {
                    for (const row of sharedEventRows || []) {
                        const target = String(row.target_user || '').trim().toLowerCase();
                        if (!authorized.has(target))
                            continue;
                        const targetRows = rowsByUser.get(target) || [];
                        targetRows.push({ ical_data: row.ical_data });
                        rowsByUser.set(target, targetRows);
                    }
                }
            }
        }
        const busy = {};
        const unavailable = [];
        for (const user of users) {
            if (!authorized.has(user) || failedUsers.has(user)) {
                unavailable.push(user);
                continue;
            }
            const intervals = busyIntervals(rowsByUser.get(user) || [], window.start, window.end);
            if (intervals === null)
                unavailable.push(user);
            else
                busy[user] = intervals;
        }
        return res.json({ success: true, busy, unavailable });
    }
    catch {
        return res.status(500).json({ success: false, error: 'Unable to load free/busy' });
    }
});
// #11 Birthdays calendar
exports.appsApiRouter.get('/calendars/birthdays', async (req, res) => {
    try {
        const username = req.username;
        const [contacts] = await db_1.pool.query(`SELECT c.first_name, c.last_name, c.name, c.email, c.birthday
             FROM contacts c
             JOIN contact_owners co ON c.id = co.contact_id
             WHERE co.username = ? AND c.birthday IS NOT NULL AND c.birthday != ''`, [username]);
        const events = [];
        for (const c of contacts || []) {
            const name = c.first_name ? `${c.first_name || ''} ${c.last_name || ''}`.trim() : (c.name || c.email);
            const parts = (c.birthday || '').split('-');
            const month = parseInt(parts[1]);
            const day = parseInt(parts[2]);
            if (!month || !day)
                continue;
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
    }
    catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});
// Multer error handler — catches MulterError and returns JSON instead of HTML
exports.appsApiRouter.use((err, _req, res, _next) => {
    if (err && err.code && err.message) {
        // MulterError has a code field (e.g. 'LIMIT_FILE_SIZE', 'LIMIT_UNEXPECTED_FILE')
        res.status(400).json({ success: false, error: err.message });
        return;
    }
    res.status(500).json({ success: false, error: 'Internal server error' });
});
//# sourceMappingURL=apps-api.js.map