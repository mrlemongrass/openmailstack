import type { Calendar, CalendarEvent } from '../shared/types';
import { buildCalendarEventIcal, calendarEventDraftForEdit } from './calendarTime';

const HTTP_URL = /https?:\/\/[^\s<>"']+/gi;
const CONFERENCE_HOST = /(^|\.)(meet\.google\.com|teams\.microsoft\.com|zoom\.us|webex\.com|meet\.jit\.si|whereby\.com)$/i;
const CONFERENCE_CONTEXT_BEFORE = /\b(join|meet|meeting|conference|video call|webinar)(?:\s+(?:at|link|url|room|here))?\s*[:\-–—]?\s*$/i;
const CONFERENCE_CONTEXT_AFTER = /^\s*[:\-–—]?\s*(?:join|meet|meeting|conference|video call|webinar)\b/i;

export type CalendarVisibilityOverride =
  | { kind: 'all' }
  | { kind: 'only'; calendarId: number }
  | null;

export type CalendarRemovalKind = 'delete' | 'remove' | null;

function normalizedHttpsUrl(candidate: string): string | null {
  const trimmed = candidate.replace(/[),.;!?]+$/g, '');
  try {
    const url = new URL(trimmed);
    return url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

export function meetingUrlForEvent(
  event: Pick<CalendarEvent, 'location' | 'description'>,
): string | null {
  for (const value of [event.location, event.description]) {
    for (const candidate of value?.match(HTTP_URL) || []) {
      const url = normalizedHttpsUrl(candidate);
      if (!url) continue;
      const parsed = new URL(url);
      const candidateIndex = value?.indexOf(candidate) ?? -1;
      const before = candidateIndex >= 0 ? value?.slice(Math.max(0, candidateIndex - 80), candidateIndex) || '' : '';
      const after = candidateIndex >= 0 ? value?.slice(candidateIndex + candidate.length, candidateIndex + candidate.length + 48) || '' : '';
      if (CONFERENCE_HOST.test(parsed.hostname)
        || CONFERENCE_CONTEXT_BEFORE.test(before)
        || CONFERENCE_CONTEXT_AFTER.test(after)) return url;
    }
  }
  return null;
}

export function eventIcsFilename(event: Pick<CalendarEvent, 'title'>): string {
  const stem = (event.title || 'event')
    .normalize('NFKD')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'event';
  return `${stem}.ics`;
}

function standaloneCalendarEventDraft(
  event: CalendarEvent,
  displayTimeZone: string,
): Partial<CalendarEvent> {
  const normalized = calendarEventDraftForEdit({
    ...event,
    seriesStart: undefined,
    seriesEnd: undefined,
    seriesTitle: undefined,
    seriesLocation: undefined,
    seriesDescription: undefined,
    seriesNotifications: undefined,
    seriesIsAllDay: undefined,
    seriesTimeKind: undefined,
    seriesTimeZone: undefined,
    seriesSourceTimeZone: undefined,
    seriesTimeZoneStatus: undefined,
  }, displayTimeZone);
  const {
    id: _id,
    occurrenceId: _occurrenceId,
    rawIcal: _rawIcal,
    recurrence: _recurrence,
    recurrenceLabel: _recurrenceLabel,
    seriesStart: _seriesStart,
    seriesEnd: _seriesEnd,
    seriesTitle: _seriesTitle,
    seriesLocation: _seriesLocation,
    seriesDescription: _seriesDescription,
    seriesNotifications: _seriesNotifications,
    seriesIsAllDay: _seriesIsAllDay,
    seriesTimeKind: _seriesTimeKind,
    seriesTimeZone: _seriesTimeZone,
    seriesSourceTimeZone: _seriesSourceTimeZone,
    seriesTimeZoneStatus: _seriesTimeZoneStatus,
    sourceStart: _sourceStart,
    sourceEnd: _sourceEnd,
    invitation: _invitation,
    ...copy
  } = normalized;

  return {
    ...copy,
    start: new Date(normalized.start || event.start),
    end: new Date(normalized.end || event.end),
  };
}

export function duplicateCalendarEventDraft(
  event: CalendarEvent,
  displayTimeZone = 'UTC',
): Partial<CalendarEvent> {
  return {
    ...standaloneCalendarEventDraft(event, displayTimeZone),
    title: `${event.title || 'Untitled event'} (copy)`,
  };
}

export function downloadableCalendarEventIcal(
  event: CalendarEvent,
  displayTimeZone: string,
  createUid: () => string = () => crypto.randomUUID(),
  now: () => Date = () => new Date(),
): string {
  const draft = standaloneCalendarEventDraft(event, displayTimeZone);
  return buildCalendarEventIcal(
    draft,
    displayTimeZone,
    event.occurrenceId ? null : event.id,
    createUid,
    now,
  );
}

export function isManagedCalendar(calendar: Pick<Calendar, 'dav_slug'>): boolean {
  return calendar.dav_slug?.toLowerCase() === 'birthdays';
}

export function canManageCalendar(
  calendar: Pick<Calendar, 'access_role' | 'dav_slug'>,
): boolean {
  return calendar.access_role === 'owner' && !isManagedCalendar(calendar);
}

export function canShareCalendar(
  calendar: Pick<Calendar, 'access_role' | 'dav_slug' | 'subscribed_url'>,
): boolean {
  return canManageCalendar(calendar) && !calendar.subscribed_url;
}

export function canEditCalendarEvents(
  calendar: Pick<Calendar, 'access_role' | 'dav_slug' | 'subscribed_url'>,
): boolean {
  return (calendar.access_role === 'owner' || calendar.access_role === 'write')
    && !isManagedCalendar(calendar)
    && !calendar.subscribed_url;
}

export function primaryOwnedCalendarId(calendars: Calendar[]): number | null {
  return calendars
    .filter(calendar => canManageCalendar(calendar) && !calendar.subscribed_url)
    .sort((left, right) => left.id - right.id)[0]?.id ?? null;
}

export function canDeleteCalendar(calendar: Calendar, calendars: Calendar[]): boolean {
  return calendarRemovalKind(calendar, calendars) !== null;
}

export function calendarRemovalKind(calendar: Calendar, calendars: Calendar[]): CalendarRemovalKind {
  if (isManagedCalendar(calendar)) return null;
  if (calendar.access_role && calendar.access_role !== 'owner') return 'remove';
  if (!canManageCalendar(calendar)) return null;
  if (calendar.subscribed_url) return 'remove';
  return calendar.id === primaryOwnedCalendarId(calendars) ? null : 'delete';
}

export function writableCalendarForEvent(
  eventCalendarId: number,
  calendars: Calendar[],
  preferredCalendarId?: number | null,
): Calendar | null {
  const writable = calendars.filter(canEditCalendarEvents);
  return writable.find(calendar => calendar.id === eventCalendarId)
    || writable.find(calendar => calendar.id === preferredCalendarId)
    || writable[0]
    || null;
}

export function calendarIsVisible(
  calendarId: number,
  selected: Record<number, boolean>,
  override: CalendarVisibilityOverride,
): boolean {
  if (override?.kind === 'all') return true;
  if (override?.kind === 'only') return override.calendarId === calendarId;
  return selected[calendarId] !== false;
}
