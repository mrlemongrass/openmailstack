import type { CalendarUserSettings } from '../settings/settingsApi';
import type { CalendarEvent } from '../shared/types';

export type CalendarTimeKind = 'utc' | 'zoned' | 'floating' | 'all-day';

interface WallTimeParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
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
}

function partsAt(instant: Date, timeZone: string): WallTimeParts {
  const values = new Map(formatterFor(timeZone).formatToParts(instant).map(part => [part.type, part.value]));
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
  const rendered = partsAt(instant, timeZone);
  const renderedAsUtc = Date.UTC(
    rendered.year,
    rendered.month - 1,
    rendered.day,
    rendered.hour,
    rendered.minute,
    rendered.second,
  );
  return renderedAsUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

function localWallParts(date: Date): WallTimeParts {
  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
    hour: date.getHours(),
    minute: date.getMinutes(),
    second: date.getSeconds(),
  };
}

function utcWallParts(date: Date): WallTimeParts {
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes(),
    second: date.getUTCSeconds(),
  };
}

function localDateFromParts(parts: WallTimeParts): Date {
  return new Date(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
}

export function systemTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
}

export function isValidTimeZone(value: string | null | undefined): value is string {
  if (!value) return false;
  try {
    formatterFor(value);
    return true;
  } catch {
    return false;
  }
}

export function resolveDisplayTimeZone(
  settings: Pick<CalendarUserSettings, 'timeZoneMode' | 'timeZone'>,
  browserTimeZone = systemTimeZone()
): string {
  if (settings.timeZoneMode === 'home' && isValidTimeZone(settings.timeZone)) return settings.timeZone;
  return isValidTimeZone(browserTimeZone) ? browserTimeZone : 'UTC';
}

export function supportedTimeZones(): string[] {
  const intlWithValues = Intl as typeof Intl & { supportedValuesOf?: (key: 'timeZone') => string[] };
  const values = intlWithValues.supportedValuesOf
    ? intlWithValues.supportedValuesOf('timeZone')
    : [systemTimeZone()];
  return [...new Set(['UTC', systemTimeZone(), ...values].filter(Boolean))];
}

export function eventTimeKind(event: Pick<CalendarEvent, 'isAllDay' | 'timeKind'>): CalendarTimeKind {
  if (event.isAllDay) return 'all-day';
  return event.timeKind || 'utc';
}

export function projectInstantToWallDate(
  instant: Date,
  timeKind: CalendarTimeKind,
  displayTimeZone: string
): Date {
  if (timeKind === 'floating' || timeKind === 'all-day') return localDateFromParts(utcWallParts(instant));
  return localDateFromParts(partsAt(instant, displayTimeZone));
}

export function wallDateToInstant(
  wallDate: Date,
  timeKind: CalendarTimeKind,
  timeZone: string | null
): Date {
  const parts = localWallParts(wallDate);
  const target = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  if (timeKind !== 'zoned' || !isValidTimeZone(timeZone)) return new Date(target);

  const offsets = new Set<number>();
  for (let sampleHours = -36; sampleHours <= 36; sampleHours += 6) {
    offsets.add(offsetAt(new Date(target + sampleHours * 60 * 60 * 1000), timeZone));
  }
  const candidates = Array.from(offsets, offset => {
    const instant = new Date(target - offset);
    const rendered = partsAt(instant, timeZone);
    const renderedAsUtc = Date.UTC(
      rendered.year,
      rendered.month - 1,
      rendered.day,
      rendered.hour,
      rendered.minute,
      rendered.second,
    );
    return { instant, renderedAsUtc };
  });
  const exact = candidates
    .filter(candidate => candidate.renderedAsUtc === target)
    .sort((left, right) => left.instant.getTime() - right.instant.getTime());
  if (exact.length > 0) return exact[0].instant;

  const afterGap = candidates
    .filter(candidate => candidate.renderedAsUtc > target)
    .sort((left, right) => left.renderedAsUtc - right.renderedAsUtc);
  return afterGap[0]?.instant || new Date(target);
}

export function convertWallDateTimeZone(
  wallDate: Date,
  currentKind: CalendarTimeKind,
  currentTimeZone: string | null,
  nextKind: CalendarTimeKind,
  nextTimeZone: string | null
): Date {
  if (currentKind === 'floating' || nextKind === 'floating' || nextKind === 'all-day') return new Date(wallDate);
  const instant = wallDateToInstant(wallDate, currentKind, currentTimeZone);
  return projectInstantToWallDate(instant, nextKind, nextTimeZone || 'UTC');
}

export function addWallDays(wallDate: Date, days: number): Date {
  return new Date(
    wallDate.getFullYear(),
    wallDate.getMonth(),
    wallDate.getDate() + days,
    wallDate.getHours(),
    wallDate.getMinutes(),
    wallDate.getSeconds()
  );
}

export function calendarEventDraftForEdit(
  event: CalendarEvent,
  displayTimeZone: string,
): Partial<CalendarEvent> {
  const timeKind = event.seriesTimeKind || eventTimeKind(event);
  const sourceTimeZone = event.seriesSourceTimeZone ?? event.sourceTimeZone;
  const timeZoneStatus = event.seriesTimeZoneStatus ?? event.timeZoneStatus;
  const eventTimeZone = event.seriesTimeZone !== undefined ? event.seriesTimeZone : event.timeZone;
  const editTimeZone = timeKind === 'zoned' ? eventTimeZone : timeKind === 'utc' ? 'UTC' : displayTimeZone;
  const seriesStart = event.seriesStart || event.sourceStart || event.start;
  const seriesEnd = event.seriesEnd || event.sourceEnd || event.end;
  return {
    ...event,
    title: event.seriesTitle || event.title,
    location: event.seriesLocation ?? event.location,
    description: event.seriesDescription ?? event.description,
    notifications: event.seriesNotifications ?? event.notifications,
    isAllDay: event.seriesIsAllDay ?? event.isAllDay,
    sourceTimeZone,
    timeZoneStatus,
    start: projectInstantToWallDate(seriesStart, timeKind, editTimeZone || displayTimeZone),
    end: projectInstantToWallDate(seriesEnd, timeKind, editTimeZone || displayTimeZone),
    timeKind,
    timeZone: timeKind === 'zoned' ? eventTimeZone : timeKind === 'utc' ? 'UTC' : null,
  };
}

const pad = (value: number): string => String(value).padStart(2, '0');

function escapeIcalText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/\r\n|\r|\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');
}

function serializeIcalAttendee(value: string): string {
  const email = value.trim();
  const containsControlCharacter = Array.from(email)
    .some(character => character.charCodeAt(0) <= 0x1f || character.charCodeAt(0) === 0x7f);
  if (email.length === 0 || email.length > 254 || containsControlCharacter) {
    throw new Error('Invalid attendee email address');
  }
  const separator = email.lastIndexOf('@');
  if (separator <= 0 || separator === email.length - 1) {
    throw new Error('Invalid attendee email address');
  }
  const localPart = email.slice(0, separator);
  const domain = email.slice(separator + 1);
  if (localPart.length > 64
    || localPart.startsWith('.')
    || localPart.endsWith('.')
    || localPart.includes('..')
    || !/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+$/.test(localPart)
    || !/^(?=.{1,253}$)(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?\.)+[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/.test(domain)) {
    throw new Error('Invalid attendee email address');
  }
  return `ATTENDEE:mailto:${encodeURIComponent(localPart)}@${domain}`;
}

function compactWallDate(date: Date, includeTime: boolean): string {
  const parts = localWallParts(date);
  const dateValue = `${parts.year}${pad(parts.month)}${pad(parts.day)}`;
  return includeTime ? `${dateValue}T${pad(parts.hour)}${pad(parts.minute)}${pad(parts.second)}` : dateValue;
}

export function eventUidForSave(
  existingUid: string | null | undefined,
  createUid: () => string = () => crypto.randomUUID()
): string {
  return existingUid ?? `${createUid()}@openmailstack`;
}

export function formatIcalDateProperty(
  name: 'DTSTART' | 'DTEND',
  wallDate: Date,
  timeKind: CalendarTimeKind,
  timeZone: string | null,
  allowExternalTimeZone = false,
): string {
  if (timeKind === 'all-day') return `${name};VALUE=DATE:${compactWallDate(wallDate, false)}`;
  const value = compactWallDate(wallDate, true);
  if (timeKind === 'utc') return `${name}:${value}Z`;
  if (timeKind === 'zoned' && timeZone && (allowExternalTimeZone || isValidTimeZone(timeZone))) {
    return `${name};TZID=${timeZone}:${value}`;
  }
  return `${name}:${value}`;
}

function icalComponentBlocks(ical: string, component: string): string[][] {
  const lines = ical.replace(/\r\n/g, '\n').replace(/\r/g, '\n').split('\n');
  const blocks: string[][] = [];
  let current: string[] | null = null;
  let depth = 0;
  for (const line of lines) {
    const normalized = line.trim().toUpperCase();
    if (!current) {
      if (normalized === `BEGIN:${component}`) {
        current = [line];
        depth = 1;
      }
      continue;
    }
    current.push(line);
    if (normalized.startsWith('BEGIN:')) depth += 1;
    if (normalized.startsWith('END:')) depth -= 1;
    if (depth === 0) {
      blocks.push(current);
      current = null;
    }
  }
  return blocks;
}

function directIcalProperties(componentBlock: string[]): string[] {
  const properties: string[] = [];
  let depth = 0;
  for (const line of componentBlock.slice(1, -1)) {
    const normalized = line.trim().toUpperCase();
    if (normalized.startsWith('BEGIN:')) {
      depth += 1;
      continue;
    }
    if (normalized.startsWith('END:')) {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (depth === 0) properties.push(line);
  }
  return properties;
}

function formatUtcIcalTimestamp(date: Date): string {
  return date.toISOString().replaceAll('-', '').replaceAll(':', '').replace(/\.\d{3}Z$/, 'Z');
}

function withDirectIcalProperty(componentBlock: string[], name: string, value: string): string[] {
  const output = [componentBlock[0]];
  let nestedDepth = 0;
  let inserted = false;
  for (const line of componentBlock.slice(1, -1)) {
    const normalized = line.trim().toUpperCase();
    if (normalized.startsWith('BEGIN:')) {
      nestedDepth += 1;
      output.push(line);
      continue;
    }
    if (normalized.startsWith('END:')) {
      nestedDepth = Math.max(0, nestedDepth - 1);
      output.push(line);
      continue;
    }
    const propertyName = line.split(':')[0].split(';')[0].toUpperCase();
    if (nestedDepth === 0 && propertyName === name) continue;
    output.push(line);
    if (nestedDepth === 0 && propertyName === 'UID' && !inserted) {
      output.push(value);
      inserted = true;
    }
  }
  if (!inserted) output.splice(1, 0, value);
  output.push(componentBlock[componentBlock.length - 1]);
  return output;
}

export function buildCalendarEventIcal(
  draft: Partial<CalendarEvent>,
  displayTimeZone: string,
  existingUid?: string | null,
  createUid: () => string = () => crypto.randomUUID(),
  now: () => Date = () => new Date(),
): string {
  const start = draft.start || new Date();
  const end = draft.end || new Date(start.getTime() + 3_600_000);
  const timeKind = draft.isAllDay ? 'all-day' : (draft.timeKind || 'zoned');
  const timeZone = timeKind === 'zoned'
    ? (draft.timeZone || displayTimeZone)
    : (timeKind === 'utc' ? 'UTC' : null);
  const rawIcal = draft.rawIcal || '';
  const sourceTimeZone = draft.sourceTimeZone?.trim() || '';
  const preserveSourceTimeZone = Boolean(sourceTimeZone && rawIcal);
  const serializedTimeKind = preserveSourceTimeZone && timeKind === 'floating' ? 'zoned' : timeKind;
  const serializedTimeZone = preserveSourceTimeZone ? sourceTimeZone : timeZone;
  const timeZoneBlocks = rawIcal ? icalComponentBlocks(rawIcal, 'VTIMEZONE') : [];
  const eventBlocks = rawIcal ? icalComponentBlocks(rawIcal, 'VEVENT') : [];
  const masterBlock = eventBlocks.find(block => !directIcalProperties(block)
    .some(line => line.split(':')[0].split(';')[0].toUpperCase() === 'RECURRENCE-ID'));
  const preservedExdates = masterBlock
    ? directIcalProperties(masterBlock).filter(line => line.split(':')[0].split(';')[0].toUpperCase() === 'EXDATE')
    : [];
  const dtstamp = `DTSTAMP:${formatUtcIcalTimestamp(now())}`;
  const preservedExceptions = eventBlocks.filter(block => directIcalProperties(block)
    .some(line => line.split(':')[0].split(';')[0].toUpperCase() === 'RECURRENCE-ID'))
    .map(block => withDirectIcalProperty(block, 'DTSTAMP', dtstamp));
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//OpenMailStack//WebCalendar//EN',
    ...timeZoneBlocks.flat(),
    'BEGIN:VEVENT',
    `UID:${eventUidForSave(existingUid, createUid)}`,
    dtstamp,
    formatIcalDateProperty('DTSTART', start, serializedTimeKind, serializedTimeZone, preserveSourceTimeZone),
    formatIcalDateProperty('DTEND', end, serializedTimeKind, serializedTimeZone, preserveSourceTimeZone),
    `SUMMARY:${escapeIcalText(draft.title || '')}`,
  ];
  if (draft.location) lines.push(`LOCATION:${escapeIcalText(draft.location)}`);
  if (draft.description) lines.push(`DESCRIPTION:${escapeIcalText(draft.description)}`);
  if (draft.recurrence && draft.recurrence !== 'none') {
    const recurrence = /(?:^|;)FREQ=/i.test(draft.recurrence)
      ? draft.recurrence
      : `FREQ=${draft.recurrence.toUpperCase()}`;
    lines.push(`RRULE:${recurrence}`);
  }
  lines.push(...preservedExdates);
  draft.guests?.forEach(guest => lines.push(serializeIcalAttendee(guest)));
  const reminderMinutes = draft.notifications?.[0]?.time;
  if (reminderMinutes !== undefined && reminderMinutes >= 0) {
    lines.push(
      'BEGIN:VALARM',
      'ACTION:DISPLAY',
      `TRIGGER:-PT${Math.floor(reminderMinutes)}M`,
      `DESCRIPTION:${escapeIcalText(draft.title || '')}`,
      'END:VALARM',
    );
  }
  lines.push('END:VEVENT', ...preservedExceptions.flat(), 'END:VCALENDAR');
  return lines.join('\r\n');
}

export function formatWallTime(date: Date, clockFormat: '12h' | '24h'): string {
  const hour = date.getHours();
  const minute = pad(date.getMinutes());
  if (clockFormat === '24h') return `${pad(hour)}:${minute}`;
  const suffix = hour < 12 ? 'AM' : 'PM';
  return `${hour % 12 || 12}:${minute} ${suffix}`;
}

export type RecurrenceChoice = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly';

export function recurrenceChoice(recurrence: string | null | undefined): RecurrenceChoice {
  if (!recurrence || recurrence === 'none') return 'none';
  const normalized = recurrence.trim().toLowerCase();
  if (['daily', 'weekly', 'monthly', 'yearly'].includes(normalized)) {
    return normalized as RecurrenceChoice;
  }
  const frequency = /(?:^|;)FREQ=(DAILY|WEEKLY|MONTHLY|YEARLY)(?:;|$)/i.exec(recurrence)?.[1];
  return frequency ? frequency.toLowerCase() as RecurrenceChoice : 'none';
}

export function recurrenceSummary(
  recurrence: string | null | undefined,
  recurrenceLabel?: string | null
): string {
  const choice = recurrenceChoice(recurrence);
  if (choice === 'none') return '';
  const fallback = {
    daily: 'Every day',
    weekly: 'Every week',
    monthly: 'Every month',
    yearly: 'Every year',
  }[choice];
  const label = recurrenceLabel?.trim() || fallback;
  return `Repeats ${label.charAt(0).toLowerCase()}${label.slice(1)}`;
}

export function calendarEventPresentation(
  event: Pick<CalendarEvent, 'title' | 'start' | 'isAllDay' | 'location' | 'recurrence' | 'recurrenceLabel'>,
  clockFormat: '12h' | '24h'
): { text: string; compactText: string; title: string } {
  const text = `${event.isAllDay ? '' : `${formatWallTime(event.start, clockFormat)} `}${event.title}${event.location ? ` — ${event.location}` : ''}`;
  const repeat = recurrenceSummary(event.recurrence, event.recurrenceLabel);
  return { text, compactText: event.title, title: repeat ? `${text}\n${repeat}` : text };
}

export function formatHourLabel(hour: number, clockFormat: '12h' | '24h'): string {
  if (clockFormat === '24h') return `${pad(hour)}:00`;
  if (hour === 0) return '12 AM';
  if (hour < 12) return `${hour} AM`;
  if (hour === 12) return '12 PM';
  return `${hour - 12} PM`;
}

export function shortTimeZoneName(instant: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat(undefined, { timeZone, timeZoneName: 'short' }).formatToParts(instant);
  return parts.find(part => part.type === 'timeZoneName')?.value || timeZone;
}
