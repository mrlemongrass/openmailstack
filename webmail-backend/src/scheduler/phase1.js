"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createSchedulerToken = exports.schedulerTokenHash = void 0;
exports.normalizeSchedulerHandle = normalizeSchedulerHandle;
exports.defaultSchedulerHandle = defaultSchedulerHandle;
exports.normalizeSchedulerQuestions = normalizeSchedulerQuestions;
exports.normalizeSchedulerBookingAnswers = normalizeSchedulerBookingAnswers;
exports.normalizeSchedulerEventInput = normalizeSchedulerEventInput;
exports.assertTimeZone = assertTimeZone;
exports.normalizePrivateLinkExpiry = normalizePrivateLinkExpiry;
exports.normalizeOneOffAvailability = normalizeOneOffAvailability;
exports.buildSchedulerCalendarEvent = buildSchedulerCalendarEvent;
exports.schedulerPublicUrl = schedulerPublicUrl;
const crypto_1 = __importDefault(require("crypto"));
const RESERVED_HANDLES = new Set([
    'action', 'admin', 'api', 'auth', 'calendar', 'carddav', 'contacts', 'mail', 'notes',
    'public', 'scheduler', 'settings', 'socket.io', 'sync', 'uploads', 'webmail',
]);
const cleanSlug = (value, fallback) => {
    const slug = value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 80);
    return slug || fallback;
};
function normalizeSchedulerHandle(value) {
    const handle = cleanSlug(value, '');
    if (!handle || handle.length < 2)
        throw new Error('Scheduler handle must contain at least two letters or numbers');
    if (RESERVED_HANDLES.has(handle))
        throw new Error('That Scheduler handle is reserved');
    return handle;
}
function defaultSchedulerHandle(username) {
    const separator = username.lastIndexOf('@');
    if (separator <= 0)
        throw new Error('Scheduler username must be a full mailbox address');
    return normalizeSchedulerHandle(username.slice(0, separator));
}
function normalizeSchedulerQuestions(value) {
    if (value == null)
        return [];
    if (!Array.isArray(value) || value.length > 10)
        throw new Error('Booking forms support up to 10 custom questions');
    const questions = value.map((candidate) => {
        const input = candidate;
        const id = /^[A-Za-z0-9_-]{8,64}$/.test(String(input.id || '')) ? String(input.id) : crypto_1.default.randomUUID();
        const label = String(input.label || '').replace(/[\r\n]+/g, ' ').trim();
        if (!label || label.length > 160)
            throw new Error('Each booking question needs a label of 160 characters or fewer');
        const type = String(input.type || 'short_text');
        if (!['short_text', 'long_text', 'select'].includes(type))
            throw new Error('Booking question type is invalid');
        let options = [];
        if (type === 'select') {
            if (!Array.isArray(input.options))
                throw new Error('Dropdown questions require options');
            options = Array.from(new Set(input.options.map((option) => String(option).replace(/[\r\n]+/g, ' ').trim())
                .filter(Boolean)));
            if (options.length < 2 || options.length > 20 || options.some((option) => option.length > 100)) {
                throw new Error('Dropdown questions require 2 to 20 unique options of 100 characters or fewer');
            }
        }
        return { id, label, type, required: input.required === true, options };
    });
    if (new Set(questions.map((question) => question.id)).size !== questions.length) {
        throw new Error('Booking question identifiers must be unique');
    }
    return questions;
}
function normalizeSchedulerBookingAnswers(questions, value) {
    const input = value == null ? [] : value;
    if (!Array.isArray(input) || input.length > questions.length)
        throw new Error('Booking answers are invalid');
    const answers = new Map();
    for (const candidate of input) {
        const questionId = String(candidate.questionId || '');
        if (!questions.some((question) => question.id === questionId) || answers.has(questionId)) {
            throw new Error('Booking answers are invalid');
        }
        answers.set(questionId, String(candidate.value || '').replace(/\r\n/g, '\n').trim());
    }
    return questions.flatMap((question) => {
        let answer = answers.get(question.id) || '';
        if (question.type === 'short_text')
            answer = answer.replace(/\s*\n\s*/g, ' ');
        if (question.required && !answer)
            throw new Error(`${question.label} is required`);
        const maximum = question.type === 'long_text' ? 2000 : question.type === 'select' ? 100 : 255;
        if (answer.length > maximum)
            throw new Error(`${question.label} is too long`);
        if (question.type === 'select' && answer && !question.options.includes(answer)) {
            throw new Error(`${question.label} has an invalid selection`);
        }
        return answer ? [{ questionId: question.id, label: question.label, type: question.type, value: answer }] : [];
    });
}
function normalizeSchedulerEventInput(input) {
    const title = String(input.title || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 160);
    if (!title)
        throw new Error('Event title is required');
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
    ]) {
        if (!Number.isInteger(value) || value < minimum || value > maximum) {
            throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
        }
    }
    const windows = input.windows || [1, 2, 3, 4, 5].map((weekday) => ({ weekday, startMinute: 540, endMinute: 1020 }));
    for (const window of windows) {
        if (!Number.isInteger(window.weekday) || window.weekday < 0 || window.weekday > 6)
            throw new Error('Invalid availability weekday');
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
    if (!['in_person', 'phone', 'custom', 'conference'].includes(locationType))
        throw new Error('Invalid location type');
    const availabilityScheduleId = input.availabilityScheduleId == null ? null : String(input.availabilityScheduleId).trim();
    if (availabilityScheduleId !== null && !/^[0-9a-f-]{36}$/i.test(availabilityScheduleId))
        throw new Error('Invalid availability schedule');
    const visibility = input.visibility || 'public';
    if (!['public', 'unlisted', 'private'].includes(visibility))
        throw new Error('Invalid event visibility');
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
        visibility,
        active: input.active !== false,
        requiresConfirmation: input.requiresConfirmation === true,
        windows,
        questions: normalizeSchedulerQuestions(input.questions),
    };
}
function assertTimeZone(timeZone) {
    const normalized = String(timeZone || '').trim();
    if (!normalized)
        throw new Error('Time zone is required');
    new Intl.DateTimeFormat('en-US', { timeZone: normalized }).format(new Date());
    return normalized;
}
const schedulerTokenHash = (token) => crypto_1.default.createHash('sha256').update(token).digest('hex');
exports.schedulerTokenHash = schedulerTokenHash;
const createSchedulerToken = () => crypto_1.default.randomBytes(32).toString('base64url');
exports.createSchedulerToken = createSchedulerToken;
function normalizePrivateLinkExpiry(value, now = new Date()) {
    if (value == null || String(value).trim() === '')
        return null;
    const expiresAt = new Date(String(value));
    if (!Number.isFinite(expiresAt.getTime()) || expiresAt <= now)
        throw new Error('Private link expiry must be in the future');
    if (expiresAt.getTime() > now.getTime() + 366 * 24 * 60 * 60 * 1000) {
        throw new Error('Private link expiry cannot be more than 366 days away');
    }
    return expiresAt;
}
const localDateKey = (value, timeZone) => {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).formatToParts(value);
    const part = (type) => parts.find((item) => item.type === type)?.value || '';
    return `${part('year')}-${part('month')}-${part('day')}`;
};
function normalizeOneOffAvailability(value, durationMinutes, now = new Date()) {
    if (value == null)
        return null;
    if (!Number.isInteger(durationMinutes) || durationMinutes < 5 || durationMinutes > 1440) {
        throw new Error('A valid event duration is required for one-off availability');
    }
    const input = value;
    const timeZone = assertTimeZone(String(input.timeZone || ''));
    if (!Array.isArray(input.windows) || input.windows.length < 1 || input.windows.length > 14) {
        throw new Error('One-off availability requires between 1 and 14 windows');
    }
    const firstDate = localDateKey(now, timeZone);
    const lastDate = localDateKey(new Date(now.getTime() + 62 * 24 * 60 * 60 * 1000), timeZone);
    const normalized = input.windows.map((candidate) => {
        const window = candidate;
        const date = String(window.date || '').trim();
        const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
        if (!match)
            throw new Error('One-off availability dates must use YYYY-MM-DD');
        const probe = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
        if (probe.toISOString().slice(0, 10) !== date)
            throw new Error('One-off availability contains an invalid date');
        if (date < firstDate || date > lastDate)
            throw new Error('One-off availability must be within the next 62 days');
        const startMinute = Number(window.startMinute);
        const endMinute = Number(window.endMinute);
        if (!Number.isInteger(startMinute) || !Number.isInteger(endMinute)
            || startMinute < 0 || endMinute > 1440 || startMinute >= endMinute) {
            throw new Error('One-off availability contains an invalid time window');
        }
        if (endMinute - startMinute < durationMinutes) {
            throw new Error('Each one-off availability window must fit the event duration');
        }
        return { date, startMinute, endMinute };
    });
    const windows = Array.from(new Map(normalized
        .sort((left, right) => left.date.localeCompare(right.date) || left.startMinute - right.startMinute || left.endMinute - right.endMinute)
        .map((window) => [`${window.date}:${window.startMinute}:${window.endMinute}`, window])).values());
    return { timeZone, windows };
}
const icalEscape = (value) => value
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,');
const icalDate = (date) => date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
function buildSchedulerCalendarEvent(event) {
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
    if (event.location)
        lines.push(`LOCATION:${icalEscape(event.location)}`);
    lines.push('END:VEVENT', 'END:VCALENDAR', '');
    return lines.join('\r\n');
}
function schedulerPublicUrl(baseUrl, handle, slug) {
    const base = baseUrl.replace(/\/$/, '');
    return `${base}/scheduler/${encodeURIComponent(handle)}${slug ? `/${encodeURIComponent(slug)}` : ''}`;
}
//# sourceMappingURL=phase1.js.map