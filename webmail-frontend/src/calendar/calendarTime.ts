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

const pad = (value: number): string => String(value).padStart(2, '0');

function compactWallDate(date: Date, includeTime: boolean): string {
  const parts = localWallParts(date);
  const dateValue = `${parts.year}${pad(parts.month)}${pad(parts.day)}`;
  return includeTime ? `${dateValue}T${pad(parts.hour)}${pad(parts.minute)}${pad(parts.second)}` : dateValue;
}

export function formatIcalDateProperty(
  name: 'DTSTART' | 'DTEND',
  wallDate: Date,
  timeKind: CalendarTimeKind,
  timeZone: string | null
): string {
  if (timeKind === 'all-day') return `${name};VALUE=DATE:${compactWallDate(wallDate, false)}`;
  const value = compactWallDate(wallDate, true);
  if (timeKind === 'utc') return `${name}:${value}Z`;
  if (timeKind === 'zoned' && isValidTimeZone(timeZone)) return `${name};TZID=${timeZone}:${value}`;
  return `${name}:${value}`;
}

export function formatWallTime(date: Date, clockFormat: '12h' | '24h'): string {
  const hour = date.getHours();
  const minute = pad(date.getMinutes());
  if (clockFormat === '24h') return `${pad(hour)}:${minute}`;
  const suffix = hour < 12 ? 'AM' : 'PM';
  return `${hour % 12 || 12}:${minute} ${suffix}`;
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
