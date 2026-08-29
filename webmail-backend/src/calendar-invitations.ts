import { parseIcalEvent, wallTimeAt, wallTimeToInstant } from './calendar-format';
import {
    ICalendarValidationError,
    validateICalendarDocument,
    type ValidatedICalendarResource,
} from './calendar-ical-validation';
import { normalizeMailboxAddress } from './outbound-mail';

export type CalendarInvitationRole = 'organizer' | 'attendee' | 'unowned';
export type CalendarInvitationResponse = 'needs-action' | 'accepted' | 'tentative' | 'declined';
export type CalendarInvitationAttendeeRole = 'required' | 'optional' | 'non-participant';
export type CalendarInvitationMethod = 'REPLY' | 'CANCEL' | 'COUNTER';

export interface CalendarInvitationAttendee {
    email: string;
    name?: string;
    response: CalendarInvitationResponse;
    role: CalendarInvitationAttendeeRole;
}

export interface CalendarInvitationProjection {
    role: CalendarInvitationRole;
    organizerEmail: string;
    organizerName?: string;
    attendeeEmail?: string;
    response?: CalendarInvitationResponse;
    responseRequested: boolean;
    attendees: CalendarInvitationAttendee[];
    attendeeCount: number;
    attendeesTruncated: boolean;
    recurring: boolean;
    canRespond: boolean;
    canCancel: boolean;
    canCancelOccurrence: boolean;
    seriesResponse?: Exclude<CalendarInvitationResponse, 'needs-action'>;
    actionUnavailableReason?: string;
    canProposeNewTime: boolean;
    canForward: boolean;
    sequence: number;
}

export interface CalendarInvitationDelivery {
    method: CalendarInvitationMethod;
    sender: string;
    recipients: string[];
    subject: string;
    text: string;
    ical: string;
}

export class CalendarInvitationActionError extends Error {
    readonly status: number;
    readonly code: string;

    constructor(code: string, message: string, status = 409) {
        super(message);
        this.name = 'CalendarInvitationActionError';
        this.code = code;
        this.status = status;
    }
}

interface CalendarProperty {
    name: string;
    header: string;
    value: string;
}

interface CalendarComponent {
    start: number;
    end: number;
    direct: number[];
}

interface ParsedInvitationDocument {
    resource: ValidatedICalendarResource;
    lines: string[];
    master: CalendarComponent;
    events: CalendarComponent[];
    parsedMaster?: ReturnType<typeof parseIcalEvent>;
    recurrenceCandidates?: InvitationRecurrenceCandidate[];
    occurrenceIndex?: InvitationOccurrenceIndex;
}

interface InvitationRecurrenceCandidate {
    component: CalendarComponent;
    property: CalendarProperty;
    hasTimeZone: boolean;
    identity: string;
    sourceKey: string;
}

interface InvitationOccurrenceIndex {
    byIdentityAndValue: Map<string, CalendarComponent[]>;
    byUntzonedValue: Map<string, CalendarComponent[]>;
    byFloatingValue: Map<string, CalendarComponent[]>;
    byInstant: Map<string, CalendarComponent[]>;
    parsedInstantKeys: Set<string>;
}

interface InvitationRuntime {
    now?: () => Date;
}

interface InvitationProjectionCache {
    owned: Set<string>;
    attendees: Map<CalendarComponent, {
        properties: CalendarProperty[];
        values: CalendarInvitationAttendee[];
        projectedValues: CalendarInvitationAttendee[];
    }>;
    organizers: Map<CalendarComponent, {
        email: string;
        name?: string;
    } | null>;
    projections: Map<CalendarComponent, CalendarInvitationProjection | null>;
    mixedOwnedAttendeeIdentities?: boolean;
}

const MAX_PROJECTED_INVITATION_ATTENDEES = 50;
const MAX_PROJECTED_DISPLAY_NAME_BYTES = 160;

const responseByPartstat: Record<string, CalendarInvitationResponse> = {
    'NEEDS-ACTION': 'needs-action',
    ACCEPTED: 'accepted',
    TENTATIVE: 'tentative',
    DECLINED: 'declined',
};

const attendeeRoleByValue: Record<string, CalendarInvitationAttendeeRole> = {
    'REQ-PARTICIPANT': 'required',
    'OPT-PARTICIPANT': 'optional',
    'NON-PARTICIPANT': 'non-participant',
};

function validatedEvent(source: string): ValidatedICalendarResource {
    const document = validateICalendarDocument(source);
    if (document.resources.length !== 1 || document.resources[0].componentType !== 'VEVENT') {
        throw new CalendarInvitationActionError(
            'INVALID_EVENT',
            'Invitation actions require exactly one calendar event resource',
            400,
        );
    }
    return document.resources[0];
}

function unfoldCalendar(source: string): string[] {
    const lines: string[] = [];
    for (const line of source.replaceAll('\r\n', '\n').replaceAll('\r', '\n').split('\n')) {
        if (/^[ \t]/.test(line)) {
            if (lines.length === 0) throw new ICalendarValidationError('Invalid iCalendar folding');
            lines[lines.length - 1] += line.slice(1);
        } else {
            lines.push(line);
        }
    }
    return lines;
}

function calendarProperty(line: string): CalendarProperty {
    let separator = -1;
    let quoted = false;
    for (let index = 0; index < line.length; index += 1) {
        if (line[index] === '"' && line[index - 1] !== '\\') quoted = !quoted;
        if (line[index] === ':' && !quoted) {
            separator = index;
            break;
        }
    }
    if (separator < 1) throw new ICalendarValidationError('Invalid iCalendar property');
    const header = line.slice(0, separator);
    return {
        name: header.split(';', 1)[0].toUpperCase(),
        header,
        value: line.slice(separator + 1),
    };
}

function eventComponents(lines: string[]): CalendarComponent[] {
    const stack: string[] = [];
    const events: CalendarComponent[] = [];
    let current: CalendarComponent | null = null;
    for (let index = 0; index < lines.length; index += 1) {
        const boundary = lines[index].match(/^(BEGIN|END):([A-Z0-9-]+)$/i);
        if (boundary?.[1].toUpperCase() === 'BEGIN') {
            if (stack.length === 1 && boundary[2].toUpperCase() === 'VEVENT') {
                current = { start: index, end: -1, direct: [] };
            }
            stack.push(boundary[2].toUpperCase());
            continue;
        }
        if (boundary?.[1].toUpperCase() === 'END') {
            if (current && stack.length === 2 && stack[1] === 'VEVENT') {
                current.end = index;
                events.push(current);
                current = null;
            }
            stack.pop();
            continue;
        }
        if (current && stack.length === 2 && lines[index]) current.direct.push(index);
    }
    return events;
}

function parseInvitationDocument(source: string): ParsedInvitationDocument {
    const resource = validatedEvent(source);
    const lines = unfoldCalendar(resource.icalData);
    const events = eventComponents(lines);
    const master = events.find(event => !event.direct.some(index => calendarProperty(lines[index]).name === 'RECURRENCE-ID'));
    if (!master) throw new CalendarInvitationActionError('INVALID_EVENT', 'Invitation event master is missing', 400);
    return { resource, lines, master, events };
}

function parsedInvitationMaster(document: ParsedInvitationDocument): ReturnType<typeof parseIcalEvent> {
    document.parsedMaster ||= parseIcalEvent(document.resource.uid, document.resource.icalData);
    return document.parsedMaster;
}

function directProperty(document: ParsedInvitationDocument, component: CalendarComponent, name: string): CalendarProperty | null {
    const target = name.toUpperCase();
    const line = component.direct.find(index => calendarProperty(document.lines[index]).name === target);
    return line === undefined ? null : calendarProperty(document.lines[line]);
}

function directPropertyLines(document: ParsedInvitationDocument, component: CalendarComponent, name: string): string[] {
    const target = name.toUpperCase();
    return component.direct
        .filter(index => calendarProperty(document.lines[index]).name === target)
        .map(index => document.lines[index]);
}

function effectivePropertyLines(
    document: ParsedInvitationDocument,
    component: CalendarComponent,
    name: string,
): string[] {
    const own = directPropertyLines(document, component, name);
    if (name.toUpperCase() === 'ATTENDEE'
        && component !== document.master
        && directProperty(document, component, 'X-OMS-ACTIVESYNC-ATTENDEES-CLEARED')?.value === '1') {
        return [];
    }
    return own.length > 0 || component === document.master
        ? own
        : directPropertyLines(document, document.master, name);
}

function effectivePropertySource(
    document: ParsedInvitationDocument,
    component: CalendarComponent,
    name: string,
): CalendarComponent {
    if (component === document.master) return component;
    if (name.toUpperCase() === 'ATTENDEE'
        && directProperty(document, component, 'X-OMS-ACTIVESYNC-ATTENDEES-CLEARED')?.value === '1') {
        return component;
    }
    const target = name.toUpperCase();
    return component.direct.some(index => calendarProperty(document.lines[index]).name === target)
        ? component
        : document.master;
}

function headerParameters(header: string): string[] {
    const parameters: string[] = [];
    let current = '';
    let quoted = false;
    for (const character of header) {
        if (character === '"') quoted = !quoted;
        if (character === ';' && !quoted) {
            parameters.push(current);
            current = '';
        } else {
            current += character;
        }
    }
    parameters.push(current);
    return parameters;
}

function parameterValue(header: string, name: string): string | undefined {
    const target = name.toUpperCase();
    for (const parameter of headerParameters(header).slice(1)) {
        const separator = parameter.indexOf('=');
        if (separator < 1 || parameter.slice(0, separator).toUpperCase() !== target) continue;
        const value = parameter.slice(separator + 1);
        return value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value;
    }
    return undefined;
}

function recurrencePropertyIdentity(property: CalendarProperty): string {
    const valueType = (parameterValue(property.header, 'VALUE')
        || (/^\d{8}(?:,|$)/.test(property.value) ? 'DATE' : 'DATE-TIME')).toUpperCase();
    const timeZone = (parameterValue(property.header, 'TZID') || '').trim();
    return `${valueType}\0${timeZone}`;
}

function replaceHeaderParameter(header: string, name: string, value: string): string {
    const parts = headerParameters(header);
    const target = name.toUpperCase();
    let replaced = false;
    const next = parts.filter((part, index) => {
        if (index === 0) return true;
        const separator = part.indexOf('=');
        if (separator < 1 || part.slice(0, separator).toUpperCase() !== target) return true;
        if (replaced) return false;
        replaced = true;
        return true;
    }).map((part, index) => {
        if (index === 0) return part;
        const separator = part.indexOf('=');
        return separator > 0 && part.slice(0, separator).toUpperCase() === target
            ? `${part.slice(0, separator)}=${value}`
            : part;
    });
    if (!replaced) next.push(`${name.toUpperCase()}=${value}`);
    return next.join(';');
}

function calendarAddress(value: string): string | null {
    const address = value.replace(/^mailto:/i, '').trim();
    return normalizeMailboxAddress(address) ? address : null;
}

function normalizedCalendarAddress(value: string): string {
    return normalizeMailboxAddress(value) || '';
}

function textValue(value: string): string {
    return value
        .replace(/\\n/gi, '\n')
        .replace(/\\,/g, ',')
        .replace(/\\;/g, ';')
        .replace(/\\\\/g, '\\');
}

function boundedDisplayName(value: string): string {
    const decoded = textValue(value);
    if (Buffer.byteLength(decoded, 'utf8') <= MAX_PROJECTED_DISPLAY_NAME_BYTES) return decoded;
    let result = '';
    for (const character of decoded) {
        if (Buffer.byteLength(`${result}${character}…`, 'utf8') > MAX_PROJECTED_DISPLAY_NAME_BYTES) break;
        result += character;
    }
    return `${result}…`;
}

function escapeText(value: string): string {
    return value
        .replace(/\\/g, '\\\\')
        .replace(/\r\n|\r|\n/g, '\\n')
        .replace(/,/g, '\\,')
        .replace(/;/g, '\\;');
}

function compactUtc(value: Date): string {
    if (!Number.isFinite(value.getTime())) {
        throw new CalendarInvitationActionError('INVALID_TIME', 'Invitation action time is invalid', 400);
    }
    return value.toISOString().slice(0, 19).replaceAll('-', '').replaceAll(':', '') + 'Z';
}

function normalizedOwnedAddresses(addresses: string[]): Set<string> {
    return new Set(addresses.map(normalizeMailboxAddress).filter(Boolean) as string[]);
}

function attendeeFromProperty(property: CalendarProperty): CalendarInvitationAttendee | null {
    const email = calendarAddress(property.value);
    if (!email) return null;
    const partstat = parameterValue(property.header, 'PARTSTAT')?.toUpperCase() || 'NEEDS-ACTION';
    const role = parameterValue(property.header, 'ROLE')?.toUpperCase() || 'REQ-PARTICIPANT';
    const name = parameterValue(property.header, 'CN');
    return {
        email,
        ...(name ? { name: boundedDisplayName(name) } : {}),
        response: responseByPartstat[partstat] || 'needs-action',
        role: attendeeRoleByValue[role] || 'required',
    };
}

function attendeeProjectionData(
    document: ParsedInvitationDocument,
    component: CalendarComponent,
    cache: InvitationProjectionCache,
) {
    const source = effectivePropertySource(document, component, 'ATTENDEE');
    const cached = cache.attendees.get(source);
    if (cached) return cached;
    const properties = effectivePropertyLines(document, source, 'ATTENDEE').map(calendarProperty);
    const values = properties
        .map(attendeeFromProperty)
        .filter((attendee): attendee is CalendarInvitationAttendee => Boolean(attendee));
    const projectedValues = values.slice(0, MAX_PROJECTED_INVITATION_ATTENDEES);
    const ownedAttendee = values.find(attendee => (
        cache.owned.has(normalizedCalendarAddress(attendee.email))
    ));
    if (ownedAttendee && !projectedValues.includes(ownedAttendee)) {
        projectedValues[Math.max(0, projectedValues.length - 1)] = ownedAttendee;
    }
    const value = { properties, values, projectedValues };
    cache.attendees.set(source, value);
    return value;
}

function ownedAttendeeIdentities(
    document: ParsedInvitationDocument,
    ownedAddresses: string[],
    cache?: InvitationProjectionCache,
): Set<string> {
    const projectionCache: InvitationProjectionCache = cache || {
        owned: normalizedOwnedAddresses(ownedAddresses),
        attendees: new Map(),
        organizers: new Map(),
        projections: new Map(),
    };
    const identities = new Set<string>();
    const visited = new Set<CalendarComponent>();
    for (const component of document.events) {
        if (directProperty(document, component, 'STATUS')?.value.toUpperCase() === 'CANCELLED') continue;
        const source = effectivePropertySource(document, component, 'ATTENDEE');
        if (visited.has(source)) continue;
        visited.add(source);
        for (const property of attendeeProjectionData(document, source, projectionCache).properties) {
            const address = normalizedCalendarAddress(calendarAddress(property.value) || '');
            if (projectionCache.owned.has(address)) identities.add(address);
        }
    }
    return identities;
}

function consistentSeriesResponse(
    document: ParsedInvitationDocument,
    attendeeEmail: string,
): Exclude<CalendarInvitationResponse, 'needs-action'> | undefined {
    const normalizedAttendee = normalizedCalendarAddress(attendeeEmail);
    let consistent: Exclude<CalendarInvitationResponse, 'needs-action'> | undefined;
    let found = false;
    for (const component of document.events) {
        for (const index of component.direct) {
            const property = calendarProperty(document.lines[index]);
            if (property.name !== 'ATTENDEE'
                || normalizedCalendarAddress(calendarAddress(property.value) || '') !== normalizedAttendee) continue;
            found = true;
            const response = responseByPartstat[parameterValue(property.header, 'PARTSTAT')?.toUpperCase() || '']
                || 'needs-action';
            if (response === 'needs-action'
                || parameterValue(property.header, 'RSVP')?.toUpperCase() === 'TRUE'
                || (consistent && consistent !== response)) return undefined;
            consistent = response;
        }
    }
    return found ? consistent : undefined;
}

function recurrenceRuleSupportsOccurrenceCancellation(document: ParsedInvitationDocument): boolean {
    try {
        if (invitationRecurrenceCandidates(document).some(candidate => parameterValue(candidate.property.header, 'RANGE'))) {
            return false;
        }
        const parsed = parsedInvitationMaster(document);
        if (!parsed.recurrence
            || parsed.recurrenceExceptionOverflow
            || parsed.recurrenceExceptionIdentityConflict
            || !['DAILY', 'WEEKLY'].includes(parsed.recurrence.frequency)) return false;
        const parts = parsed.recurrence.raw.split(';').map(part => {
            const separator = part.indexOf('=');
            return separator < 1
                ? { name: '', value: '' }
                : { name: part.slice(0, separator).trim().toUpperCase(), value: part.slice(separator + 1).trim() };
        });
        if (parts.some(part => !['FREQ', 'INTERVAL', 'COUNT', 'UNTIL'].includes(part.name))
            || new Set(parts.map(part => part.name)).size !== parts.length) return false;
        const values = new Map(parts.map(part => [part.name, part.value]));
        if (values.get('FREQ')?.toUpperCase() !== parsed.recurrence.frequency) return false;
        const interval = values.get('INTERVAL');
        const count = values.get('COUNT');
        const until = values.get('UNTIL');
        if (interval !== undefined
            && (!/^\d+$/.test(interval) || Number(interval) < 1 || Number(interval) > 365)) return false;
        if (count !== undefined
            && (!/^\d+$/.test(count) || Number(count) < 1 || !Number.isSafeInteger(Number(count)))) return false;
        if (count !== undefined && until !== undefined) return false;
        if (until !== undefined) {
            const match = parsed.isAllDay
                ? until.match(/^(\d{4})(\d{2})(\d{2})$/)
                : parsed.timeKind === 'utc' || parsed.timeKind === 'zoned'
                    ? until.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/)
                    : until.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/);
            if (!match) return false;
            const [year, month, day, hour = '0', minute = '0', second = '0'] = match.slice(1);
            const candidate = new Date(Date.UTC(
                Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second),
            ));
            if (candidate.getUTCFullYear() !== Number(year)
                || candidate.getUTCMonth() + 1 !== Number(month)
                || candidate.getUTCDate() !== Number(day)
                || candidate.getUTCHours() !== Number(hour)
                || candidate.getUTCMinutes() !== Number(minute)
                || candidate.getUTCSeconds() !== Number(second)) return false;
        }
        return true;
    } catch {
        return false;
    }
}

function invitationDetails(
    document: ParsedInvitationDocument,
    ownedAddresses: string[],
    component = document.master,
    cache?: InvitationProjectionCache,
): CalendarInvitationProjection | null {
    const projectionCache: InvitationProjectionCache = cache || {
        owned: normalizedOwnedAddresses(ownedAddresses),
        attendees: new Map(),
        organizers: new Map(),
        projections: new Map(),
    };
    if (projectionCache.projections.has(component)) {
        return projectionCache.projections.get(component) || null;
    }
    const owned = projectionCache.owned;
    const organizerSource = effectivePropertySource(document, component, 'ORGANIZER');
    let organizerData = projectionCache.organizers.get(organizerSource);
    if (organizerData === undefined) {
        const organizerLine = effectivePropertyLines(document, organizerSource, 'ORGANIZER')[0];
        const organizer = organizerLine ? calendarProperty(organizerLine) : null;
        const organizerEmail = organizer ? calendarAddress(organizer.value) : null;
        const organizerName = organizer ? parameterValue(organizer.header, 'CN') : null;
        organizerData = organizer && organizerEmail ? {
            email: organizerEmail,
            ...(organizerName ? { name: boundedDisplayName(organizerName) } : {}),
        } : null;
        projectionCache.organizers.set(organizerSource, organizerData);
    }
    const organizerEmail = organizerData?.email || null;
    const attendeeData = attendeeProjectionData(document, component, projectionCache);
    const attendeeProperties = attendeeData.properties;
    const attendees = attendeeData.projectedValues;
    if (!organizerEmail || attendees.length === 0) {
        projectionCache.projections.set(component, null);
        return null;
    }

    const ownAttendee = attendees.find(attendee => owned.has(normalizedCalendarAddress(attendee.email)));
    const role: CalendarInvitationRole = owned.has(normalizedCalendarAddress(organizerEmail))
        ? 'organizer'
        : ownAttendee ? 'attendee' : 'unowned';
    const rsvpProperty = ownAttendee
        ? attendeeProperties.find(property => property.name === 'ATTENDEE'
                && normalizedCalendarAddress(calendarAddress(property.value) || '') === normalizedCalendarAddress(ownAttendee.email))
        : null;
    const recurring = Boolean(directProperty(document, document.master, 'RRULE'));
    const sequenceValue = directProperty(document, component, 'SEQUENCE')?.value
        || directProperty(document, document.master, 'SEQUENCE')?.value
        || '0';
    const parsedSequence = /^\d+$/.test(sequenceValue) ? Number(sequenceValue) : 0;
    const disallowCounter = directProperty(document, document.master, 'X-MICROSOFT-DISALLOW-COUNTER')?.value.toUpperCase() === 'TRUE'
        || directProperty(document, document.master, 'X-OMS-DISALLOW-NEW-TIME-PROPOSAL')?.value === '1';
    const disallowForwarding = directProperty(document, document.master, 'X-MICROSOFT-DISALLOW-FORWARDING')?.value.toUpperCase() === 'TRUE'
        || directProperty(document, document.master, 'X-MICROSOFT-CDO-ALLOW-FORWARDING')?.value.toUpperCase() === 'FALSE';
    projectionCache.mixedOwnedAttendeeIdentities ??=
        ownedAttendeeIdentities(document, ownedAddresses, projectionCache).size > 1;
    const masterInvitation = component === document.master
        ? null
        : invitationDetails(document, ownedAddresses, document.master, projectionCache);
    const masterRole = component === document.master ? role : masterInvitation?.role || 'unowned';
    const masterOrganizerEmail = component === document.master
        ? organizerEmail
        : masterInvitation?.organizerEmail || '';
    const canRespond = role === 'attendee'
        && masterRole === 'attendee'
        && !projectionCache.mixedOwnedAttendeeIdentities;
    const seriesResponse = canRespond
        ? consistentSeriesResponse(
            document,
            component === document.master ? ownAttendee?.email || '' : masterInvitation?.attendeeEmail || '',
        )
        : undefined;
    const canCancel = role === 'organizer'
        && masterRole === 'organizer'
        && normalizedCalendarAddress(organizerEmail) === normalizedCalendarAddress(masterOrganizerEmail);

    const projection: CalendarInvitationProjection = {
        role,
        organizerEmail,
        ...(organizerData?.name ? { organizerName: organizerData.name } : {}),
        ...(ownAttendee ? { attendeeEmail: ownAttendee.email, response: ownAttendee.response } : {}),
        responseRequested: role === 'attendee'
            ? parameterValue(rsvpProperty?.header || '', 'RSVP')?.toUpperCase() === 'TRUE'
            : false,
        attendees,
        attendeeCount: attendeeData.values.length,
        attendeesTruncated: attendeeData.values.length > attendees.length,
        recurring,
        canRespond,
        canCancel,
        canCancelOccurrence: canCancel && recurring && recurrenceRuleSupportsOccurrenceCancellation(document),
        ...(seriesResponse ? { seriesResponse } : {}),
        canProposeNewTime: canRespond && !recurring && !disallowCounter,
        canForward: role !== 'unowned' && !disallowForwarding,
        sequence: Number.isSafeInteger(parsedSequence) ? parsedSequence : 0,
    };
    projectionCache.projections.set(component, projection);
    return projection;
}

function unsupportedRecurrenceInvitation(
    document: ParsedInvitationDocument,
    ownedAddresses: string[],
    cache?: InvitationProjectionCache,
): CalendarInvitationProjection | null {
    const projectionCache = cache || {
        owned: normalizedOwnedAddresses(ownedAddresses),
        attendees: new Map(),
        organizers: new Map(),
        projections: new Map(),
    };
    for (const component of [document.master, ...document.events.filter(event => event !== document.master)]) {
        try {
            const projected = invitationDetails(document, ownedAddresses, component, projectionCache);
            if (!projected) continue;
            return {
                role: 'unowned',
                organizerEmail: projected.organizerEmail,
                ...(projected.organizerName ? { organizerName: projected.organizerName } : {}),
                responseRequested: false,
                attendees: projected.attendees,
                attendeeCount: projected.attendeeCount,
                attendeesTruncated: projected.attendeesTruncated,
                recurring: projected.recurring,
                canRespond: false,
                canCancel: false,
                canCancelOccurrence: false,
                canProposeNewTime: false,
                canForward: false,
                sequence: projected.sequence,
                actionUnavailableReason: 'Meeting actions unavailable for this recurrence',
            };
        } catch {
            // Try the next structurally valid invitation component.
        }
    }
    return null;
}

export function projectCalendarInvitation(
    source: string,
    ownedAddresses: string[],
    occurrenceId?: string,
): CalendarInvitationProjection | null {
    let document: ParsedInvitationDocument | null = null;
    try {
        document = parseInvitationDocument(source);
        const component = occurrenceId ? occurrenceComponent(document, occurrenceId) || document.master : document.master;
        return invitationDetails(document, ownedAddresses, component);
    } catch {
        return document ? unsupportedRecurrenceInvitation(document, ownedAddresses) : null;
    }
}

export function projectCalendarInvitationOccurrences(
    source: string,
    ownedAddresses: string[],
    occurrenceIds: Array<string | undefined>,
): Array<CalendarInvitationProjection | null> {
    try {
        const document = parseInvitationDocument(source);
        const cache: InvitationProjectionCache = {
            owned: normalizedOwnedAddresses(ownedAddresses),
            attendees: new Map(),
            organizers: new Map(),
            projections: new Map(),
        };
        return occurrenceIds.map(occurrenceId => {
            try {
                const component = occurrenceId
                    ? occurrenceComponent(document, occurrenceId) || document.master
                    : document.master;
                return invitationDetails(document, ownedAddresses, component, cache);
            } catch {
                return unsupportedRecurrenceInvitation(document, ownedAddresses, cache);
            }
        });
    } catch {
        return occurrenceIds.map(() => null);
    }
}

function requireInvitation(
    document: ParsedInvitationDocument,
    ownedAddresses: string[],
    role: CalendarInvitationRole,
): CalendarInvitationProjection {
    const invitation = invitationDetails(document, ownedAddresses);
    if (!invitation || invitation.role !== role) {
        throw new CalendarInvitationActionError(
            role === 'attendee' ? 'NOT_ATTENDEE' : 'NOT_ORGANIZER',
            role === 'attendee'
                ? 'This mailbox is not an attendee of the meeting'
                : 'Only the meeting organizer can cancel it',
            403,
        );
    }
    return invitation;
}

function replaceDirectProperty(
    document: ParsedInvitationDocument,
    component: CalendarComponent,
    name: string,
    line: string,
): void {
    const target = name.toUpperCase();
    const existingIndex = component.direct.find(index => calendarProperty(document.lines[index]).name === target);
    if (existingIndex !== undefined) {
        document.lines[existingIndex] = line;
        return;
    }
    document.lines.splice(component.end, 0, line);
}

function validatedMutation(document: ParsedInvitationDocument): string {
    return validatedEvent(document.lines.join('\r\n')).icalData;
}

function referencedTimeZoneComponents(document: ParsedInvitationDocument, eventLines: string[]): string[] {
    const referenced = new Set(eventLines.flatMap(line => {
        try {
            const value = parameterValue(calendarProperty(line).header, 'TZID');
            return value ? [value] : [];
        } catch {
            return [];
        }
    }));
    if (referenced.size === 0) return [];

    const components: string[] = [];
    for (let start = 0; start < document.lines.length; start += 1) {
        if (document.lines[start].toUpperCase() !== 'BEGIN:VTIMEZONE') continue;
        let end = start + 1;
        while (end < document.lines.length && document.lines[end].toUpperCase() !== 'END:VTIMEZONE') end += 1;
        if (end >= document.lines.length) break;
        const block = document.lines.slice(start, end + 1);
        const timeZoneId = block.flatMap(line => {
            try {
                const property = calendarProperty(line);
                return property.name === 'TZID' ? [property.value] : [];
            } catch {
                return [];
            }
        })[0];
        if (timeZoneId && referenced.has(timeZoneId)) components.push(...block);
        start = end;
    }
    return components;
}

function methodCalendar(
    document: ParsedInvitationDocument,
    method: CalendarInvitationMethod,
    eventLines: string[],
): string {
    return [
        'BEGIN:VCALENDAR',
        'PRODID:-//OpenMailStack//Calendar Invitations//EN',
        'VERSION:2.0',
        `METHOD:${method}`,
        ...referencedTimeZoneComponents(document, eventLines),
        'BEGIN:VEVENT',
        ...eventLines,
        'END:VEVENT',
        'END:VCALENDAR',
    ].join('\r\n');
}

function validateMethodCalendar(source: string): void {
    validatedEvent(source.replace(/^METHOD:.*\r?\n/m, ''));
}

function requiredSourceLine(document: ParsedInvitationDocument, name: string): string {
    const index = document.master.direct.find(lineIndex => calendarProperty(document.lines[lineIndex]).name === name);
    if (index === undefined) {
        throw new CalendarInvitationActionError('INVALID_EVENT', `Invitation ${name} is missing`, 400);
    }
    return document.lines[index];
}

function optionalSourceLines(document: ParsedInvitationDocument, names: string[]): string[] {
    const wanted = new Set(names);
    return document.master.direct
        .map(index => document.lines[index])
        .filter(line => wanted.has(calendarProperty(line).name));
}

function eventHeaderTitle(document: ParsedInvitationDocument, component = document.master): string {
    const summary = effectivePropertyLines(document, component, 'SUMMARY')[0];
    const title = textValue(summary ? calendarProperty(summary).value : 'Untitled meeting')
        .replace(/[\u0000-\u001f\u007f]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim() || 'Untitled meeting';
    if (title.length <= 900) return title;
    let bounded = title.slice(0, 899);
    if (/[\uD800-\uDBFF]$/.test(bounded)) bounded = bounded.slice(0, -1);
    return `${bounded}…`;
}

function effectiveEventProjection(document: ParsedInvitationDocument, component: CalendarComponent) {
    if (component === document.master) {
        return parseIcalEvent(document.resource.uid, document.resource.icalData);
    }
    const eventLines = [
        requiredSourceLine(document, 'UID'),
        ...['DTSTART', 'DTEND', 'SUMMARY', 'LOCATION']
            .flatMap(name => effectivePropertyLines(document, component, name).slice(0, 1)),
    ];
    const source = [
        'BEGIN:VCALENDAR',
        'PRODID:-//OpenMailStack//Calendar Invitation Projection//EN',
        'VERSION:2.0',
        ...referencedTimeZoneComponents(document, eventLines),
        'BEGIN:VEVENT',
        ...eventLines,
        'END:VEVENT',
        'END:VCALENDAR',
    ].join('\r\n');
    return parseIcalEvent(document.resource.uid, source);
}

function deliveryText(
    prefix: string,
    document: ParsedInvitationDocument,
    extra?: string,
    component = document.master,
): string {
    const parsed = effectiveEventProjection(document, component);
    return [
        `${prefix}: ${parsed.title}`,
        `Starts: ${parsed.start.toISOString()}`,
        ...(parsed.location ? [`Location: ${parsed.location}`] : []),
        ...(extra ? ['', extra] : []),
    ].join('\n');
}

export function prepareInvitationResponse(
    source: string,
    ownedAddresses: string[],
    response: Exclude<CalendarInvitationResponse, 'needs-action'>,
    runtime: InvitationRuntime = {},
): { updatedIcal: string; delivery: CalendarInvitationDelivery; alreadyResponded: boolean } {
    if (!['accepted', 'tentative', 'declined'].includes(response)) {
        throw new CalendarInvitationActionError('INVALID_RESPONSE', 'Meeting response is invalid', 400);
    }
    const document = parseInvitationDocument(source);
    const invitation = requireInvitation(document, ownedAddresses, 'attendee');
    if (ownedAttendeeIdentities(document, ownedAddresses).size > 1) {
        throw new CalendarInvitationActionError(
            'MIXED_ATTENDEE_IDENTITIES',
            'This meeting series uses more than one of your attendee identities and cannot be answered safely as one response',
            409,
        );
    }
    const attendeeEmail = invitation.attendeeEmail!;
    const partstat = response.toUpperCase();
    let replaced = false;
    let everyAttendeeRowAlreadyResponded = true;
    let replyAttendee = '';
    for (const component of document.events) {
        for (const index of component.direct) {
            const property = calendarProperty(document.lines[index]);
            if (property.name !== 'ATTENDEE'
                || normalizedCalendarAddress(calendarAddress(property.value) || '') !== normalizedCalendarAddress(attendeeEmail)) continue;
            if (parameterValue(property.header, 'PARTSTAT')?.toUpperCase() !== partstat
                || parameterValue(property.header, 'RSVP')?.toUpperCase() === 'TRUE') {
                everyAttendeeRowAlreadyResponded = false;
            }
            let header = replaceHeaderParameter(property.header, 'PARTSTAT', partstat);
            header = replaceHeaderParameter(header, 'RSVP', 'FALSE');
            document.lines[index] = `${header}:${property.value}`;
            if (component === document.master) replyAttendee = document.lines[index];
            replaced = true;
        }
    }
    if (!replaced || !replyAttendee) {
        throw new CalendarInvitationActionError('NOT_ATTENDEE', 'Meeting attendee record is missing', 403);
    }
    const alreadyResponded = everyAttendeeRowAlreadyResponded;
    const updatedIcal = validatedMutation(document);
    const timestamp = compactUtc((runtime.now || (() => new Date()))());
    const labels = { accepted: 'Accepted', tentative: 'Tentative', declined: 'Declined' } as const;
    const label = labels[response];
    const replyLines = [
        requiredSourceLine(document, 'UID'),
        `DTSTAMP:${timestamp}`,
        ...(directProperty(document, document.master, 'SEQUENCE') ? [requiredSourceLine(document, 'SEQUENCE')] : []),
        requiredSourceLine(document, 'ORGANIZER'),
        replyAttendee,
        ...optionalSourceLines(document, ['DTSTART', 'DTEND', 'SUMMARY', 'LOCATION']),
    ];
    const ical = methodCalendar(document, 'REPLY', replyLines);
    validateMethodCalendar(ical);
    return {
        updatedIcal,
        alreadyResponded,
        delivery: {
            method: 'REPLY',
            sender: attendeeEmail,
            recipients: [invitation.organizerEmail],
            subject: `${label}: ${eventHeaderTitle(document)}`,
            text: deliveryText(label, document),
            ical,
        },
    };
}

function normalizedOccurrenceId(value: string | undefined): string | null {
    if (value === undefined) return null;
    const normalized = value.trim();
    if (!/^\d{8}(?:T\d{6}Z?)?$/.test(normalized)) {
        throw new CalendarInvitationActionError('INVALID_OCCURRENCE', 'Recurring occurrence identity is invalid', 400);
    }
    return normalized;
}

function compactDateTimeInZone(value: Date, timeZone: string): string {
    let parts: Intl.DateTimeFormatPart[];
    try {
        parts = new Intl.DateTimeFormat('en-US', {
            timeZone,
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hourCycle: 'h23',
        }).formatToParts(value);
    } catch {
        throw new CalendarInvitationActionError(
            'INVALID_OCCURRENCE',
            'Recurring occurrence time zone is invalid',
            400,
        );
    }
    const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(candidate => candidate.type === type)?.value || '';
    const formatted = `${part('year')}${part('month')}${part('day')}T${part('hour')}${part('minute')}${part('second')}`;
    if (!/^\d{8}T\d{6}$/.test(formatted)) {
        throw new CalendarInvitationActionError(
            'INVALID_OCCURRENCE',
            'Recurring occurrence time zone is invalid',
            400,
        );
    }
    return formatted;
}

function compactUtcInstant(value: string): Date | null {
    const match = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/);
    if (!match) return null;
    const instant = new Date(Date.UTC(
        Number(match[1]),
        Number(match[2]) - 1,
        Number(match[3]),
        Number(match[4]),
        Number(match[5]),
        Number(match[6]),
    ));
    return compactUtc(instant) === value ? instant : null;
}

function recurrenceLookupKey(...values: string[]): string {
    return JSON.stringify(values);
}

function appendOccurrenceCandidate(
    map: Map<string, CalendarComponent[]>,
    key: string,
    component: CalendarComponent,
): void {
    const current = map.get(key);
    if (current) current.push(component);
    else map.set(key, [component]);
}

function invitationRecurrenceCandidates(document: ParsedInvitationDocument): InvitationRecurrenceCandidate[] {
    if (document.recurrenceCandidates) return document.recurrenceCandidates;
    document.recurrenceCandidates = document.events.flatMap(component => {
        if (component === document.master) return [];
        const property = directProperty(document, component, 'RECURRENCE-ID');
        if (!property) return [];
        return [{
            component,
            property,
            hasTimeZone: parameterValue(property.header, 'TZID') !== undefined,
            identity: recurrencePropertyIdentity(property),
            sourceKey: recurrenceLookupKey(
                property.header.slice('RECURRENCE-ID'.length),
                property.value,
            ),
        }];
    });
    return document.recurrenceCandidates;
}

function invitationOccurrenceIndex(
    document: ParsedInvitationDocument,
    parsedMaster: ReturnType<typeof parseIcalEvent>,
): InvitationOccurrenceIndex {
    if (document.occurrenceIndex) return document.occurrenceIndex;
    const parsedInstantKeys = new Set<string>();
    const instantBySource = new Map<string, string>();
    for (const exception of parsedMaster.recurrenceExceptions || []) {
        const instantKey = compactUtc(exception.recurrenceId);
        parsedInstantKeys.add(instantKey);
        instantBySource.set(recurrenceLookupKey(
            exception.sourceParameters || '',
            exception.sourceValue || '',
        ), instantKey);
    }
    const index: InvitationOccurrenceIndex = {
        byIdentityAndValue: new Map(),
        byUntzonedValue: new Map(),
        byFloatingValue: new Map(),
        byInstant: new Map(),
        parsedInstantKeys,
    };
    for (const candidate of invitationRecurrenceCandidates(document)) {
        appendOccurrenceCandidate(
            index.byIdentityAndValue,
            recurrenceLookupKey(candidate.identity, candidate.property.value),
            candidate.component,
        );
        if (!candidate.hasTimeZone) {
            appendOccurrenceCandidate(index.byUntzonedValue, candidate.property.value, candidate.component);
            appendOccurrenceCandidate(
                index.byFloatingValue,
                candidate.property.value.replace(/Z$/, ''),
                candidate.component,
            );
        }
        const instantKey = instantBySource.get(candidate.sourceKey);
        if (instantKey) appendOccurrenceCandidate(index.byInstant, instantKey, candidate.component);
    }
    document.occurrenceIndex = index;
    return index;
}

function recurrenceIdLine(document: ParsedInvitationDocument, value: string): string {
    const start = calendarProperty(requiredSourceLine(document, 'DTSTART'));
    if (/^\d{8}$/.test(start.value) || /(?:^|;)VALUE=DATE(?:;|$)/i.test(start.header)) {
        return `RECURRENCE-ID;VALUE=DATE:${value.slice(0, 8)}`;
    }
    if (!/^\d{8}T\d{6}Z?$/.test(value)) {
        throw new CalendarInvitationActionError(
            'INVALID_OCCURRENCE',
            'Timed recurring occurrences require a date and time',
            400,
        );
    }
    const parameters = start.header.slice('DTSTART'.length);
    if (start.value.endsWith('Z')) {
        return `RECURRENCE-ID${parameters}:${value.endsWith('Z') ? value : `${value}Z`}`;
    }
    const sourceTimeZone = parameterValue(start.header, 'TZID');
    if (sourceTimeZone && value.endsWith('Z')) {
        const instant = compactUtcInstant(value);
        if (!instant) {
            throw new CalendarInvitationActionError(
                'INVALID_OCCURRENCE',
                'Recurring occurrence identity is invalid',
                400,
            );
        }
        const parsed = parsedInvitationMaster(document);
        // Unsupported embedded TZIDs are deliberately projected as floating
        // wall time. The web occurrence identity is therefore a wall-time
        // surrogate ending in Z, not an instant that may be fed to Intl.
        if (parsed.timeKind === 'floating') {
            return `RECURRENCE-ID${parameters}:${value.slice(0, -1)}`;
        }
        const timeZone = parsed.timeZone || sourceTimeZone;
        let localValue = compactDateTimeInZone(instant, timeZone);
        if (parsed.recurrence && ['DAILY', 'WEEKLY'].includes(parsed.recurrence.frequency)
            && /^\d{8}T\d{6}$/.test(start.value)) {
            const nominalValue = `${localValue.slice(0, 8)}T${start.value.slice(9, 15)}`;
            const match = nominalValue.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/);
            if (match) {
                const nominalInstant = wallTimeToInstant({
                    year: Number(match[1]),
                    month: Number(match[2]),
                    day: Number(match[3]),
                    hour: Number(match[4]),
                    minute: Number(match[5]),
                    second: Number(match[6]),
                }, timeZone);
                if (nominalInstant.getTime() === instant.getTime()) localValue = nominalValue;
            }
        }
        return `RECURRENCE-ID${parameters}:${localValue}`;
    }
    return `RECURRENCE-ID${parameters}:${value.replace(/Z$/, '')}`;
}

export function calendarRecurrenceIdLine(source: string, value: string): string {
    return recurrenceIdLine(parseInvitationDocument(source), value);
}

function occurrenceComponent(
    document: ParsedInvitationDocument,
    value: string,
): CalendarComponent | null {
    const recurrenceCandidates = invitationRecurrenceCandidates(document);
    if (recurrenceCandidates.some(candidate => parameterValue(candidate.property.header, 'RANGE'))) {
        throw new CalendarInvitationActionError(
            'UNSUPPORTED_RECURRENCE_RANGE',
            'This meeting uses a this-and-future recurrence change that cannot be canceled as one occurrence yet.',
            409,
        );
    }
    const expected = calendarProperty(recurrenceIdLine(document, value));
    const parsedMaster = parsedInvitationMaster(document);
    if (parsedMaster.recurrenceExceptionOverflow) {
        throw new CalendarInvitationActionError(
            'TOO_MANY_RECURRENCE_EXCEPTIONS',
            'This meeting has too many recurrence exceptions to change one occurrence safely.',
            409,
        );
    }
    if (parsedMaster.recurrenceExceptionIdentityConflict) {
        throw new CalendarInvitationActionError(
            'AMBIGUOUS_OCCURRENCE',
            'This meeting contains multiple exceptions for the same occurrence and cannot be changed safely.',
            409,
        );
    }
    const masterTimeKind = parsedMaster.timeKind;
    const allowFloatingFallback = masterTimeKind === 'floating';
    const expectedIdentity = recurrencePropertyIdentity(expected);
    const requestedInstant = compactUtcInstant(value);
    const requestedKey = requestedInstant ? compactUtc(requestedInstant) : null;
    const index = invitationOccurrenceIndex(document, parsedMaster);
    const matches = new Set<CalendarComponent>();
    const addMatches = (candidates: CalendarComponent[] | undefined) => {
        for (const candidate of candidates || []) matches.add(candidate);
    };
    addMatches(index.byIdentityAndValue.get(recurrenceLookupKey(expectedIdentity, expected.value)));
    addMatches(index.byUntzonedValue.get(value));
    if (allowFloatingFallback) addMatches(index.byFloatingValue.get(value.replace(/Z$/, '')));
    if (requestedKey && masterTimeKind !== 'floating') addMatches(index.byInstant.get(requestedKey));
    if (matches.size > 1) {
        throw new CalendarInvitationActionError(
            'AMBIGUOUS_OCCURRENCE',
            'This meeting contains multiple matching occurrence exceptions and cannot be changed safely.',
            409,
        );
    }
    if (matches.size === 1) return matches.values().next().value || null;
    if (requestedKey && index.parsedInstantKeys.has(requestedKey)) {
        throw new CalendarInvitationActionError(
            'INVALID_OCCURRENCE',
            'The matching occurrence exception could not be resolved safely.',
            409,
        );
    }
    return null;
}

function componentSequence(document: ParsedInvitationDocument, component: CalendarComponent): number {
    const raw = directProperty(document, component, 'SEQUENCE')?.value || '0';
    const value = /^\d+$/.test(raw) ? Number(raw) : 0;
    return Number.isSafeInteger(value) ? value : 0;
}

export function calendarInvitationActionStateFingerprint(
    source: string,
    actorAddress: string,
    action:
        | { action: 'respond'; response: 'accepted' | 'tentative' | 'declined' }
        | { action: 'cancel'; scope: 'occurrence' | 'series'; occurrenceId: string | null }
        | { action: 'propose-time'; start: string; end: string },
): string {
    const document = parseInvitationDocument(source);
    const componentIdentity = (component: CalendarComponent) => {
        const recurrence = directProperty(document, component, 'RECURRENCE-ID');
        return recurrence ? `${recurrence.header}:${recurrence.value}` : 'MASTER';
    };
    const attendeeState = (component: CalendarComponent) => effectivePropertyLines(document, component, 'ATTENDEE')
        .map(line => calendarProperty(line))
        .map(property => ({
            email: normalizedCalendarAddress(calendarAddress(property.value) || ''),
            partstat: parameterValue(property.header, 'PARTSTAT')?.toUpperCase() || 'NEEDS-ACTION',
            rsvp: parameterValue(property.header, 'RSVP')?.toUpperCase() || 'FALSE',
        }))
        .filter(attendee => attendee.email)
        .sort((left, right) => left.email.localeCompare(right.email));
    const effectiveLines = (component: CalendarComponent, names: string[]) => names
        .flatMap(name => effectivePropertyLines(document, component, name));
    const attendeeLines = (component: CalendarComponent) => effectivePropertyLines(document, component, 'ATTENDEE')
        .slice()
        .sort();
    const organizerState = (component: CalendarComponent) => {
        const line = effectivePropertyLines(document, component, 'ORGANIZER')[0];
        return line ? normalizedCalendarAddress(calendarAddress(calendarProperty(line).value) || '') : '';
    };
    if (action.action === 'respond') {
        const actor = normalizedCalendarAddress(actorAddress);
        const distinctActorStates = new Map<string, ReturnType<typeof attendeeState>[number]>();
        for (const component of document.events) {
            const attendee = attendeeState(component).find(candidate => candidate.email === actor);
            if (attendee) distinctActorStates.set(JSON.stringify(attendee), attendee);
        }
        return JSON.stringify({
            action: action.action,
            response: action.response,
            uid: document.resource.uid,
            organizer: organizerState(document.master),
            attendeeStates: [...distinctActorStates.values()].sort((left, right) => (
                JSON.stringify(left).localeCompare(JSON.stringify(right))
            )),
            actorLines: document.events
                .flatMap(component => directPropertyLines(document, component, 'ATTENDEE'))
                .filter(line => normalizedCalendarAddress(
                    calendarAddress(calendarProperty(line).value) || '',
                ) === actor)
                .sort(),
            messageFields: effectiveLines(document.master, [
                'SEQUENCE', 'ORGANIZER', 'DTSTART', 'DTEND', 'DURATION', 'SUMMARY', 'LOCATION',
            ]),
        });
    }
    if (action.action === 'cancel' && action.scope === 'series') {
        const activeVariants = new Map<string, {
            organizer: string;
            attendees: string[];
        }>();
        for (const component of document.events) {
            if (component !== document.master
                && directProperty(document, component, 'STATUS')?.value.toUpperCase() === 'CANCELLED') continue;
            if (component !== document.master
                && directProperty(document, component, 'X-OMS-ACTIVESYNC-ATTENDEES-CLEARED')?.value === '1') continue;
            const variant = {
                organizer: effectivePropertyLines(document, component, 'ORGANIZER')[0] || '',
                attendees: attendeeLines(component),
            };
            activeVariants.set(JSON.stringify(variant), variant);
        }
        return JSON.stringify({
            action: action.action,
            scope: action.scope,
            uid: document.resource.uid,
            status: directProperty(document, document.master, 'STATUS')?.value.toUpperCase() || '',
            sequence: Math.max(...document.events.map(component => componentSequence(document, component))),
            messageFields: effectiveLines(document.master, [
                'DTSTAMP', 'DTSTART', 'DTEND', 'DURATION', 'SUMMARY', 'LOCATION',
            ]),
            activeVariants: [...activeVariants.values()].sort((left, right) => (
                JSON.stringify(left).localeCompare(JSON.stringify(right))
            )),
        });
    }
    if (action.action === 'cancel') {
        const occurrenceId = action.occurrenceId || '';
        const target = occurrenceComponent(document, occurrenceId);
        const component = target || document.master;
        const recurrence = calendarProperty(recurrenceIdLine(document, occurrenceId));
        const excludedIds = parsedInvitationMaster(document).excludedOccurrenceIds || new Set<string>();
        const excluded = excludedIds.has(occurrenceId)
            || excludedIds.has(occurrenceId.replace(/Z$/, ''))
            || excludedIds.has(`${occurrenceId.replace(/Z$/, '')}Z`);
        return JSON.stringify({
            action: action.action,
            scope: action.scope,
            uid: document.resource.uid,
            recurrence: `${recurrencePropertyIdentity(recurrence)}:${recurrence.value}`,
            organizer: organizerState(component),
            cancelled: excluded || directProperty(document, component, 'STATUS')?.value.toUpperCase() === 'CANCELLED',
            attendees: attendeeLines(component),
            sequence: componentSequence(document, component),
            messageFields: effectiveLines(component, [
                'DTSTAMP', 'ORGANIZER', 'DTSTART', 'DTEND', 'DURATION', 'SUMMARY', 'LOCATION',
            ]),
        });
    }
    return JSON.stringify({
        action: action.action,
        uid: document.resource.uid,
        organizer: organizerState(document.master),
        attendees: attendeeLines(document.master),
        messageFields: effectiveLines(document.master, [
            'SEQUENCE', 'ORGANIZER', 'DTSTART', 'DTEND', 'DURATION', 'SUMMARY', 'LOCATION',
        ]),
    });
}

function calendarWallSurrogate(value: string): Date | null {
    const match = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})Z?)?$/);
    if (!match) return null;
    const date = new Date(Date.UTC(
        Number(match[1]), Number(match[2]) - 1, Number(match[3]),
        Number(match[4] || 0), Number(match[5] || 0), Number(match[6] || 0),
    ));
    return Number.isFinite(date.getTime()) ? date : null;
}

function occurrenceDateLines(document: ParsedInvitationDocument, occurrenceId: string): string[] {
    const recurrence = calendarProperty(recurrenceIdLine(document, occurrenceId));
    const masterStart = calendarProperty(requiredSourceLine(document, 'DTSTART'));
    const masterEndLine = directPropertyLines(document, document.master, 'DTEND')[0];
    const masterEnd = masterEndLine ? calendarProperty(masterEndLine) : null;
    const masterDurationLine = directPropertyLines(document, document.master, 'DURATION')[0];
    if (!masterEnd && masterDurationLine) {
        const parameters = recurrence.header.slice('RECURRENCE-ID'.length);
        return [
            `DTSTART${parameters}:${recurrence.value}`,
            masterDurationLine,
        ];
    }
    if (!masterEnd) {
        const parameters = recurrence.header.slice('RECURRENCE-ID'.length);
        return [`DTSTART${parameters}:${recurrence.value}`];
    }
    const originalStart = calendarWallSurrogate(masterStart.value);
    const originalEnd = masterEnd ? calendarWallSurrogate(masterEnd.value) : null;
    const occurrenceStart = calendarWallSurrogate(recurrence.value);
    if (!originalStart || !originalEnd || !occurrenceStart) {
        throw new CalendarInvitationActionError(
            'INVALID_OCCURRENCE',
            'The recurring occurrence duration is invalid',
            400,
        );
    }
    const parsedMaster = parsedInvitationMaster(document);
    const durationMs = parsedMaster.end.getTime() - parsedMaster.start.getTime();
    if (!Number.isFinite(durationMs) || durationMs <= 0) {
        throw new CalendarInvitationActionError(
            'INVALID_OCCURRENCE',
            'The recurring occurrence duration is invalid',
            400,
        );
    }
    const isDate = /^\d{8}$/.test(recurrence.value);
    const durationSeconds = Math.round(durationMs / 1000);
    const duration = isDate
        ? `P${Math.max(1, Math.round(durationMs / 86_400_000))}D`
        : `PT${durationSeconds}S`;
    const parameters = recurrence.header.slice('RECURRENCE-ID'.length);
    return [
        `DTSTART${parameters}:${recurrence.value}`,
        `DURATION:${duration}`,
    ];
}

export function prepareInvitationCancellation(
    source: string,
    ownedAddresses: string[],
    input: { occurrenceId?: string; alreadyOccurrenceCancelled?: boolean } = {},
    runtime: InvitationRuntime = {},
): { revisedIcal: string; delivery: CalendarInvitationDelivery; alreadyCancelled: boolean } {
    let document = parseInvitationDocument(source);
    const invitation = requireInvitation(document, ownedAddresses, 'organizer');
    const occurrenceId = normalizedOccurrenceId(input.occurrenceId);
    if (occurrenceId && !invitation.recurring) {
        throw new CalendarInvitationActionError('INVALID_OCCURRENCE', 'This meeting is not recurring', 400);
    }
    const initialTargetComponent = occurrenceId ? occurrenceComponent(document, occurrenceId) : null;
    const alreadyCancelled = directProperty(document, occurrenceId && initialTargetComponent ? initialTargetComponent : document.master, 'STATUS')
        ?.value.toUpperCase() === 'CANCELLED'
        || Boolean(occurrenceId && input.alreadyOccurrenceCancelled);
    const timestamp = compactUtc((runtime.now || (() => new Date()))());
    const authoritativeSequence = Math.max(
        invitation.sequence,
        ...(occurrenceId
            ? [initialTargetComponent ? componentSequence(document, initialTargetComponent) : 0]
            : document.events.map(component => componentSequence(document, component))),
    );
    const nextSequence = alreadyCancelled ? authoritativeSequence : authoritativeSequence + 1;
    if (!alreadyCancelled) {
        replaceDirectProperty(document, document.master, 'SEQUENCE', `SEQUENCE:${nextSequence}`);
        replaceDirectProperty(document, document.master, 'DTSTAMP', `DTSTAMP:${timestamp}`);
        if (!occurrenceId) {
            replaceDirectProperty(document, document.master, 'STATUS', 'STATUS:CANCELLED');
        } else if (initialTargetComponent) {
            // Master insertions shift all later VEVENT indices. Reparse before
            // touching the target exception so optional SEQUENCE/DTSTAMP fields
            // cannot make us overwrite the wrong line.
            document = parseInvitationDocument(validatedMutation(document));
            const refreshedTarget = occurrenceComponent(document, occurrenceId);
            if (!refreshedTarget) {
                throw new CalendarInvitationActionError(
                    'INVALID_OCCURRENCE',
                    'The recurring occurrence changed while cancellation was prepared',
                    409,
                );
            }
            replaceDirectProperty(document, refreshedTarget, 'SEQUENCE', `SEQUENCE:${nextSequence}`);
            replaceDirectProperty(document, refreshedTarget, 'DTSTAMP', `DTSTAMP:${timestamp}`);
            replaceDirectProperty(document, refreshedTarget, 'STATUS', 'STATUS:CANCELLED');
        }
    }
    const revisedIcal = validatedMutation(document);
    document = parseInvitationDocument(revisedIcal);
    const targetComponent = occurrenceId ? occurrenceComponent(document, occurrenceId) : null;
    const deliveryComponent = targetComponent || document.master;
    const attendeeLines = effectivePropertyLines(document, deliveryComponent, 'ATTENDEE');
    if (!occurrenceId) {
        const attendeeIdentity = (lines: string[]) => lines
            .map(line => attendeeFromProperty(calendarProperty(line))?.email || '')
            .map(normalizedCalendarAddress)
            .filter(Boolean)
            .sort()
            .join('\0');
        const masterIdentity = attendeeIdentity(attendeeLines);
        const masterOrganizer = normalizedCalendarAddress(invitation.organizerEmail);
        const activeException = (component: CalendarComponent) => (
            component !== document.master
            && directProperty(document, component, 'STATUS')?.value.toUpperCase() !== 'CANCELLED'
            && directProperty(document, component, 'X-OMS-ACTIVESYNC-ATTENDEES-CLEARED')?.value !== '1'
        );
        if (document.events.some(component => (
            activeException(component)
            && attendeeIdentity(effectivePropertyLines(document, component, 'ATTENDEE')) !== masterIdentity
        ))) {
            throw new CalendarInvitationActionError(
                'UNSUPPORTED_SERIES_ATTENDEE_VARIANTS',
                'This series has occurrence-specific attendees. Cancel those occurrences individually before canceling the series.',
                409,
            );
        }
        if (document.events.some(component => {
            if (!activeException(component)) return false;
            const line = effectivePropertyLines(document, component, 'ORGANIZER')[0];
            return normalizedCalendarAddress(line
                ? calendarAddress(calendarProperty(line).value) || ''
                : '') !== masterOrganizer;
        })) {
            throw new CalendarInvitationActionError(
                'ORGANIZER_MISMATCH',
                'This series contains an occurrence owned by a different organizer and cannot be canceled as one series.',
                409,
            );
        }
    }
    const owned = normalizedOwnedAddresses(ownedAddresses);
    const recipients = attendeeLines
        .map(line => attendeeFromProperty(calendarProperty(line)))
        .filter((attendee): attendee is CalendarInvitationAttendee => Boolean(attendee))
        .map(attendee => attendee.email)
        .filter(email => !owned.has(normalizedCalendarAddress(email)));
    if (recipients.length === 0) {
        throw new CalendarInvitationActionError('NO_ATTENDEES', 'This meeting has no attendees to notify', 409);
    }
    const effectiveOrganizer = effectivePropertyLines(document, deliveryComponent, 'ORGANIZER')[0]
        || requiredSourceLine(document, 'ORGANIZER');
    const effectiveOrganizerAddress = calendarAddress(calendarProperty(effectiveOrganizer).value);
    if (!effectiveOrganizerAddress
        || normalizedCalendarAddress(effectiveOrganizerAddress)
            !== normalizedCalendarAddress(invitation.organizerEmail)) {
        throw new CalendarInvitationActionError(
            'ORGANIZER_MISMATCH',
            'This occurrence names a different organizer and cannot be canceled from this mailbox',
            409,
        );
    }
    const targetOwnStart = targetComponent ? directPropertyLines(document, targetComponent, 'DTSTART') : [];
    const targetOwnEnd = targetComponent ? directPropertyLines(document, targetComponent, 'DTEND') : [];
    const targetOwnDuration = targetComponent ? directPropertyLines(document, targetComponent, 'DURATION') : [];
    const effectiveDateLines = occurrenceId
        ? targetComponent && targetOwnStart.length > 0
            ? [targetOwnStart[0], ...targetOwnEnd.slice(0, 1), ...targetOwnDuration.slice(0, 1)]
            : occurrenceDateLines(document, occurrenceId)
        : [
            ...effectivePropertyLines(document, deliveryComponent, 'DTSTART').slice(0, 1),
            ...effectivePropertyLines(document, deliveryComponent, 'DTEND').slice(0, 1),
            ...(effectivePropertyLines(document, deliveryComponent, 'DTEND').length === 0
                ? effectivePropertyLines(document, deliveryComponent, 'DURATION').slice(0, 1)
                : []),
        ];
    const effectiveDetails = [
        ...effectiveDateLines,
        ...['SUMMARY', 'LOCATION']
            .flatMap(name => effectivePropertyLines(document, deliveryComponent, name).slice(0, 1)),
    ];
    const cancellationLines = [
        requiredSourceLine(document, 'UID'),
        `DTSTAMP:${timestamp}`,
        `SEQUENCE:${nextSequence}`,
        effectiveOrganizer,
        ...attendeeLines,
        ...(occurrenceId ? [recurrenceIdLine(document, occurrenceId)] : []),
        'STATUS:CANCELLED',
        ...effectiveDetails,
    ];
    const ical = methodCalendar(document, 'CANCEL', cancellationLines);
    validateMethodCalendar(ical);
    const cancellationProjection = parseIcalEvent(document.resource.uid, ical);
    return {
        revisedIcal,
        alreadyCancelled,
        delivery: {
            method: 'CANCEL',
            sender: invitation.organizerEmail,
            recipients,
            subject: `Canceled: ${eventHeaderTitle(document, deliveryComponent)}`,
            text: [
                `Canceled: ${cancellationProjection.title}`,
                `Starts: ${cancellationProjection.start.toISOString()}`,
                ...(cancellationProjection.location ? [`Location: ${cancellationProjection.location}`] : []),
            ].join('\n'),
            ical,
        },
    };
}

function counterDateLines(document: ParsedInvitationDocument, start: Date, end: Date): string[] {
    const parsed = parseIcalEvent(document.resource.uid, document.resource.icalData);
    if (parsed.isAllDay) {
        const date = (value: Date) => value.toISOString().slice(0, 10).replaceAll('-', '');
        return [`DTSTART;VALUE=DATE:${date(start)}`, `DTEND;VALUE=DATE:${date(end)}`];
    }
    return [`DTSTART:${compactUtc(start)}`, `DTEND:${compactUtc(end)}`];
}

export function prepareInvitationCounter(
    source: string,
    ownedAddresses: string[],
    input: { start: Date; end: Date; comment?: string },
    runtime: InvitationRuntime = {},
): { delivery: CalendarInvitationDelivery } {
    const document = parseInvitationDocument(source);
    const invitation = requireInvitation(document, ownedAddresses, 'attendee');
    if (!invitation.canProposeNewTime) {
        throw new CalendarInvitationActionError(
            'PROPOSAL_NOT_ALLOWED',
            invitation.recurring
                ? 'A new time cannot be proposed for a recurring meeting'
                : 'The organizer does not allow new-time proposals',
            409,
        );
    }
    if (!Number.isFinite(input.start.getTime()) || !Number.isFinite(input.end.getTime()) || input.end <= input.start) {
        throw new CalendarInvitationActionError('INVALID_TIME', 'The proposed meeting time is invalid', 400);
    }
    if (input.end.getTime() - input.start.getTime() > 31 * 24 * 60 * 60 * 1000) {
        throw new CalendarInvitationActionError('INVALID_TIME', 'The proposed meeting duration is too long', 400);
    }
    const comment = input.comment?.trim() || '';
    if (Buffer.byteLength(comment, 'utf8') > 4_000 || /\0/.test(comment)) {
        throw new CalendarInvitationActionError('INVALID_COMMENT', 'The proposal note is too long', 400);
    }
    const attendeeLine = document.master.direct
        .map(index => document.lines[index])
        .find(line => calendarProperty(line).name === 'ATTENDEE'
            && normalizedCalendarAddress(calendarAddress(calendarProperty(line).value) || '')
                === normalizedCalendarAddress(invitation.attendeeEmail || ''));
    if (!attendeeLine) throw new CalendarInvitationActionError('NOT_ATTENDEE', 'Meeting attendee record is missing', 403);
    const timestamp = compactUtc((runtime.now || (() => new Date()))());
    const counterLines = [
        requiredSourceLine(document, 'UID'),
        `DTSTAMP:${timestamp}`,
        ...(directProperty(document, document.master, 'SEQUENCE') ? [requiredSourceLine(document, 'SEQUENCE')] : []),
        requiredSourceLine(document, 'ORGANIZER'),
        attendeeLine,
        ...counterDateLines(document, input.start, input.end),
        ...optionalSourceLines(document, ['SUMMARY', 'LOCATION']),
        ...(comment ? [`COMMENT:${escapeText(comment)}`] : []),
    ];
    const ical = methodCalendar(document, 'COUNTER', counterLines);
    validateMethodCalendar(ical);
    const original = effectiveEventProjection(document, document.master);
    return {
        delivery: {
            method: 'COUNTER',
            sender: invitation.attendeeEmail!,
            recipients: [invitation.organizerEmail],
            subject: `New time proposed: ${eventHeaderTitle(document)}`,
            text: [
                `New time proposed: ${original.title}`,
                `Proposed start: ${input.start.toISOString()}`,
                `Proposed end: ${input.end.toISOString()}`,
                ...(original.location ? [`Location: ${original.location}`] : []),
                ...(comment ? ['', comment] : []),
            ].join('\n'),
            ical,
        },
    };
}
