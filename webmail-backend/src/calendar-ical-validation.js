"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ICalendarValidationError = exports.MAX_ICAL_UID_BYTES = exports.MAX_ICAL_UID_CHARACTERS = exports.MAX_ICAL_RESOURCE_COMPONENTS = exports.MAX_ICAL_AGGREGATE_RESOURCE_BYTES = exports.MAX_ICAL_RESOURCE_BYTES = exports.MAX_ICAL_DOCUMENT_BYTES = void 0;
exports.validateICalendarDocument = validateICalendarDocument;
const util_1 = require("util");
exports.MAX_ICAL_DOCUMENT_BYTES = 8 * 1024 * 1024;
exports.MAX_ICAL_RESOURCE_BYTES = 1024 * 1024;
exports.MAX_ICAL_AGGREGATE_RESOURCE_BYTES = 16 * 1024 * 1024;
exports.MAX_ICAL_RESOURCE_COMPONENTS = 10_000;
exports.MAX_ICAL_UID_CHARACTERS = 255;
exports.MAX_ICAL_UID_BYTES = exports.MAX_ICAL_UID_CHARACTERS * 4;
const RESOURCE_COMPONENT_TYPES = new Set(['VEVENT', 'VTODO', 'VJOURNAL', 'VFREEBUSY', 'VAVAILABILITY']);
const TOP_LEVEL_COMPONENT_TYPES = new Set([...RESOURCE_COMPONENT_TYPES, 'VTIMEZONE']);
const ALLOWED_NESTED_COMPONENTS = {
    VEVENT: new Set(['VALARM']),
    VTODO: new Set(['VALARM']),
    VTIMEZONE: new Set(['STANDARD', 'DAYLIGHT']),
    VAVAILABILITY: new Set(['AVAILABLE']),
};
class ICalendarValidationError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ICalendarValidationError';
    }
}
exports.ICalendarValidationError = ICalendarValidationError;
function validationError(message) {
    throw new ICalendarValidationError(message);
}
function validateCalendarTextCharacters(source) {
    for (const character of source) {
        const codePoint = character.codePointAt(0);
        const invalidControl = codePoint <= 0x08
            || codePoint === 0x0b
            || codePoint === 0x0c
            || codePoint >= 0x0e && codePoint <= 0x1f
            || codePoint >= 0x7f && codePoint <= 0x9f;
        const noncharacter = codePoint >= 0xfdd0 && codePoint <= 0xfdef
            || (codePoint & 0xffff) >= 0xfffe;
        if (invalidControl || noncharacter) {
            validationError('iCalendar document contains invalid character data');
        }
    }
}
function unfoldIcalendarLines(source) {
    const physicalLines = source.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
    const logicalLines = [];
    for (const line of physicalLines) {
        if (/^[ \t]/.test(line)) {
            if (logicalLines.length === 0)
                validationError('Invalid iCalendar line folding');
            logicalLines[logicalLines.length - 1] += line.slice(1);
        }
        else {
            logicalLines.push(line);
        }
    }
    return logicalLines;
}
function componentBoundary(line) {
    const match = line.match(/^(BEGIN|END):([A-Z0-9-]+)$/i);
    if (!match)
        return null;
    return { kind: match[1].toUpperCase(), type: match[2].toUpperCase() };
}
function propertyName(line) {
    const separator = line.indexOf(':');
    if (separator < 1)
        validationError('Invalid iCalendar property');
    return line.slice(0, separator).split(';', 1)[0].toUpperCase();
}
function propertyValue(line) {
    const separator = line.indexOf(':');
    if (separator < 1)
        validationError('Invalid iCalendar property');
    return line.slice(separator + 1);
}
function directPropertyValues(component, name) {
    return component.directProperties
        .filter(line => line && propertyName(line) === name)
        .map(propertyValue);
}
function validateCalendarProperties(calendarProperties, mode) {
    const values = (name) => calendarProperties
        .filter(line => line && propertyName(line) === name)
        .map(propertyValue);
    const versions = values('VERSION');
    if (versions.length !== 1 || versions[0].trim() !== '2.0') {
        validationError('VCALENDAR must contain exactly one VERSION:2.0 property');
    }
    const prodids = values('PRODID');
    if (prodids.length !== 1 || !prodids[0].trim() || /[\x00-\x1f\x7f]/.test(prodids[0])) {
        validationError('VCALENDAR must contain exactly one valid PRODID property');
    }
    const methods = values('METHOD');
    if (methods.length > 1 || methods.some(value => !value.trim() || /[\x00-\x1f\x7f]/.test(value))) {
        validationError('VCALENDAR contains an invalid METHOD property');
    }
    if (mode === 'stored-resource' && methods.length > 0) {
        validationError('Stored calendar resources must not contain METHOD');
    }
}
function validateRequiredResourceProperties(component) {
    if (!RESOURCE_COMPONENT_TYPES.has(component.type))
        return;
    const dtstamps = directPropertyValues(component, 'DTSTAMP');
    if (dtstamps.length !== 1 || !/^\d{8}T\d{6}Z$/.test(dtstamps[0])) {
        validationError(`${component.type} must contain exactly one valid direct DTSTAMP property`);
    }
    const starts = directPropertyValues(component, 'DTSTART');
    if (starts.length > 1 || starts.some(value => !value || /[\x00-\x1f\x7f]/.test(value))) {
        validationError(`${component.type} contains an invalid DTSTART property`);
    }
    if (component.type === 'VEVENT' && starts.length !== 1) {
        validationError('VEVENT must contain exactly one direct DTSTART property');
    }
}
function directUid(component, maxUidBytes) {
    const values = component.directProperties
        .filter(line => line && propertyName(line) === 'UID')
        .map(line => line.slice(line.indexOf(':') + 1));
    if (!RESOURCE_COMPONENT_TYPES.has(component.type))
        return values[0] ?? null;
    if (values.length !== 1)
        validationError(`${component.type} must contain exactly one direct UID property`);
    const uid = values[0];
    if (!uid || uid.endsWith(' ') || /[\x00-\x1f\x7f]/.test(uid)) {
        validationError(`${component.type} UID is invalid`);
    }
    if (Array.from(uid).length > exports.MAX_ICAL_UID_CHARACTERS
        || Buffer.byteLength(uid, 'utf8') > maxUidBytes) {
        validationError(`${component.type} UID is too large`);
    }
    return uid;
}
function directRecurrenceId(component, maxUidBytes) {
    if (!RESOURCE_COMPONENT_TYPES.has(component.type))
        return null;
    const values = component.directProperties
        .filter(line => line && propertyName(line) === 'RECURRENCE-ID')
        .map(line => line.slice(line.indexOf(':') + 1));
    if (values.length > 1)
        validationError(`${component.type} contains duplicate RECURRENCE-ID properties`);
    const recurrenceId = values[0] ?? null;
    if (recurrenceId !== null && (!recurrenceId || /[\x00-\x1f\x7f]/.test(recurrenceId)
        || Buffer.byteLength(recurrenceId, 'utf8') > maxUidBytes)) {
        validationError(`${component.type} RECURRENCE-ID is invalid`);
    }
    return recurrenceId;
}
function validateICalendarDocument(input, options = {}) {
    const maxDocumentBytes = options.maxDocumentBytes ?? exports.MAX_ICAL_DOCUMENT_BYTES;
    const maxResourceBytes = options.maxResourceBytes ?? exports.MAX_ICAL_RESOURCE_BYTES;
    const maxAggregateResourceBytes = options.maxAggregateResourceBytes ?? exports.MAX_ICAL_AGGREGATE_RESOURCE_BYTES;
    const maxResourceComponents = options.maxResourceComponents ?? exports.MAX_ICAL_RESOURCE_COMPONENTS;
    const maxUidBytes = options.maxUidBytes ?? exports.MAX_ICAL_UID_BYTES;
    const mode = options.mode ?? 'stored-resource';
    const sourceBuffer = Buffer.isBuffer(input) ? input : Buffer.from(input, 'utf8');
    if (sourceBuffer.length > maxDocumentBytes)
        validationError('iCalendar document is too large');
    let source;
    try {
        source = new util_1.TextDecoder('utf-8', { fatal: true }).decode(sourceBuffer);
    }
    catch {
        validationError('iCalendar document must be valid UTF-8');
    }
    if (source.charCodeAt(0) === 0xfeff)
        source = source.slice(1);
    validateCalendarTextCharacters(source);
    const lines = unfoldIcalendarLines(source);
    const stack = [];
    const calendarProperties = [];
    const components = [];
    let openTopLevel = null;
    let calendarSeen = false;
    let calendarClosed = false;
    for (const line of lines) {
        const boundary = componentBoundary(line);
        if (boundary?.kind === 'BEGIN') {
            if (stack.length === 0) {
                if (calendarSeen || boundary.type !== 'VCALENDAR' || calendarClosed) {
                    validationError('iCalendar document must contain exactly one VCALENDAR root');
                }
                calendarSeen = true;
                stack.push({ type: boundary.type });
                continue;
            }
            if (calendarClosed || boundary.type === 'VCALENDAR')
                validationError('Invalid nested iCalendar root');
            if (stack.length === 1) {
                if (!TOP_LEVEL_COMPONENT_TYPES.has(boundary.type)) {
                    validationError(`Invalid top-level component ${boundary.type}`);
                }
                openTopLevel = {
                    type: boundary.type,
                    lines: [line],
                    directProperties: [],
                    uid: null,
                    recurrenceId: null,
                };
            }
            else {
                const parentType = stack[stack.length - 1].type;
                if (!ALLOWED_NESTED_COMPONENTS[parentType]?.has(boundary.type)) {
                    validationError(`Invalid component nesting: ${boundary.type} inside ${parentType}`);
                }
                openTopLevel?.lines.push(line);
            }
            stack.push({ type: boundary.type });
            continue;
        }
        if (boundary?.kind === 'END') {
            if (stack.length === 0 || stack[stack.length - 1].type !== boundary.type) {
                validationError('Mismatched or truncated iCalendar component');
            }
            if (stack.length >= 2)
                openTopLevel?.lines.push(line);
            stack.pop();
            if (stack.length === 1 && openTopLevel) {
                components.push(openTopLevel);
                openTopLevel = null;
            }
            else if (stack.length === 0) {
                if (boundary.type !== 'VCALENDAR')
                    validationError('Invalid iCalendar root closure');
                calendarClosed = true;
            }
            continue;
        }
        if (stack.length === 0) {
            if (line.trim())
                validationError('Data outside VCALENDAR is not allowed');
            continue;
        }
        if (!line)
            continue;
        const name = propertyName(line);
        if (name === 'BEGIN' || name === 'END')
            validationError('Malformed iCalendar component boundary');
        if (stack.length === 1) {
            calendarProperties.push(line);
        }
        else {
            openTopLevel?.lines.push(line);
            if (stack.length === 2)
                openTopLevel?.directProperties.push(line);
        }
    }
    if (!calendarSeen || !calendarClosed || stack.length !== 0 || openTopLevel) {
        validationError('Mismatched or truncated iCalendar component');
    }
    validateCalendarProperties(calendarProperties, mode);
    const resourceComponents = components.filter(component => RESOURCE_COMPONENT_TYPES.has(component.type));
    if (resourceComponents.length > maxResourceComponents)
        validationError('iCalendar contains too many resources');
    for (const component of components) {
        component.uid = directUid(component, maxUidBytes);
        component.recurrenceId = directRecurrenceId(component, maxUidBytes);
        validateRequiredResourceProperties(component);
        if (RESOURCE_COMPONENT_TYPES.has(component.type)
            && Buffer.byteLength(component.lines.join('\r\n'), 'utf8') > maxResourceBytes) {
            validationError(`${component.type} component is too large`);
        }
    }
    if (resourceComponents.length === 0 && !options.allowEmpty) {
        validationError('iCalendar document contains no calendar resource');
    }
    const unfoldedUids = resourceComponents.map(component => component.uid);
    const uniqueUids = new Set(unfoldedUids);
    const uniqueResourceTypes = new Set(resourceComponents.map(component => component.type));
    if (uniqueResourceTypes.size > 1 && !options.allowMultipleResourceTypes) {
        validationError('iCalendar document contains multiple resource component types');
    }
    if (uniqueUids.size > 1 && !options.allowMultipleResourceUids) {
        validationError('iCalendar document contains multiple resource UIDs');
    }
    const canonicalUid = uniqueUids.size === 1 ? unfoldedUids[0] : null;
    const supportingComponents = components
        .filter(component => !RESOURCE_COMPONENT_TYPES.has(component.type))
        .map(component => component.lines.join('\r\n'));
    const materializedCalendarProperties = mode === 'stored-resource'
        ? calendarProperties
        : calendarProperties.filter(line => propertyName(line) !== 'METHOD');
    const grouped = new Map();
    for (const component of resourceComponents) {
        const key = `${component.type}\0${component.uid}`;
        const existingGroup = grouped.get(key);
        if (existingGroup)
            existingGroup.push(component);
        else
            grouped.set(key, [component]);
    }
    let aggregateResourceBytes = 0;
    const resources = Array.from(grouped.values()).map(group => {
        const recurrenceIdentities = new Set();
        for (const component of group) {
            const identity = component.recurrenceId === null ? '\0master' : component.recurrenceId;
            if (recurrenceIdentities.has(identity)) {
                validationError(component.recurrenceId === null
                    ? `${component.type} resource contains multiple master components`
                    : `${component.type} resource contains duplicate recurrence instances`);
            }
            recurrenceIdentities.add(identity);
        }
        const resourceLines = [
            'BEGIN:VCALENDAR',
            ...materializedCalendarProperties,
            ...supportingComponents,
            ...group.map(component => component.lines.join('\r\n')),
            'END:VCALENDAR',
        ];
        const icalData = resourceLines.join('\r\n');
        const resourceBytes = Buffer.byteLength(icalData, 'utf8');
        if (resourceBytes > maxResourceBytes) {
            validationError(`${group[0].type} resource is too large`);
        }
        aggregateResourceBytes += resourceBytes;
        if (aggregateResourceBytes > maxAggregateResourceBytes) {
            validationError('iCalendar materialized aggregate is too large');
        }
        return {
            componentType: group[0].type,
            uid: group[0].uid,
            componentCount: group.length,
            icalData,
        };
    });
    return {
        componentTypes: resourceComponents.map(component => component.type),
        supportingComponentTypes: components
            .filter(component => !RESOURCE_COMPONENT_TYPES.has(component.type))
            .map(component => component.type),
        unfoldedUids,
        canonicalUid,
        resources,
        isEmpty: resourceComponents.length === 0,
    };
}
//# sourceMappingURL=calendar-ical-validation.js.map