import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { io as createSocket } from 'socket.io-client';
import type { Calendar, CalendarEvent } from '../../shared/types';
import * as api from '../../shared/api';
import { useCalendarSettings } from '../../shared/hooks/useCalendarSettings';
import { useCalendarTimeZone } from '../../shared/hooks/useCalendarTimeZone';
import {
  addWallDays,
  eventTimeKind,
  formatIcalDateProperty,
  projectInstantToWallDate,
  wallDateToInstant,
} from '../calendarTime';

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function useCalendar() {
  const {
    settings: calendarSettings,
    isLoading: settingsLoading,
    error: settingsError,
    refresh: refreshCalendarSettings,
  } = useCalendarSettings();
  const displayTimeZone = useCalendarTimeZone(calendarSettings);
  const [calendars, setCalendars] = useState<Calendar[]>([]);
  const [sourceEvents, setSourceEvents] = useState<CalendarEvent[]>([]);
  const [calendarViewOverride, setCalendarView] = useState<'month' | 'week' | 'day' | 'year' | 'agenda' | null>(null);
  const calendarView = calendarViewOverride || calendarSettings.defaultView;
  const [currentDate, setCurrentDate] = useState(() => projectInstantToWallDate(new Date(), 'utc', displayTimeZone));
  const [calendarSearchQuery, setCalendarSearchQuery] = useState('');
  const [isEventModalOpen, setIsEventModalOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [calendarError, setCalendarError] = useState('');
  const [isAdvancedEventMode, setIsAdvancedEventMode] = useState(false);
  const [editingEvent, setEditingEvent] = useState<Partial<CalendarEvent> | null>(null);
  const [eventError, setEventError] = useState('');
  const [eventSaving, setEventSaving] = useState(false);
  const [calendarVisibility, setCalendarVisibility] = useState<Record<number, boolean>>(() => {
    try {
      const stored = localStorage.getItem('oms_calendar_visibility');
      return stored ? JSON.parse(stored) : {};
    } catch { return {}; }
  });
  const [quickCreateText, setQuickCreateText] = useState('');
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const displayNow = useMemo(
    () => projectInstantToWallDate(now, 'utc', displayTimeZone),
    [displayTimeZone, now]
  );
  const previousDisplayTimeZone = useRef(displayTimeZone);

  useEffect(() => {
    const previousToday = projectInstantToWallDate(new Date(), 'utc', previousDisplayTimeZone.current);
    setCurrentDate(current => (
      current.getFullYear() === previousToday.getFullYear()
      && current.getMonth() === previousToday.getMonth()
      && current.getDate() === previousToday.getDate()
        ? projectInstantToWallDate(new Date(), 'utc', displayTimeZone)
        : current
    ));
    previousDisplayTimeZone.current = displayTimeZone;
  }, [displayTimeZone]);

  // New event draft
  const [newEvent, setNewEvent] = useState<Partial<CalendarEvent>>({
    title: '', start: displayNow, end: new Date(displayNow.getTime() + 3600000),
    isAllDay: false, timeKind: 'zoned', timeZone: displayTimeZone,
    location: '', description: '', calendarId: 0,
  });

  const events = useMemo(() => sourceEvents.map(event => {
    const timeKind = eventTimeKind(event);
    const sourceStart = event.sourceStart || event.start;
    const sourceEnd = event.sourceEnd || event.end;
    return {
      ...event,
      timeKind,
      sourceStart,
      sourceEnd,
      start: projectInstantToWallDate(sourceStart, timeKind, displayTimeZone),
      end: projectInstantToWallDate(sourceEnd, timeKind, displayTimeZone),
    };
  }), [sourceEvents, displayTimeZone]);

  const refreshCalendars = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const data = await api.fetchCalendars();
      if (data.calendars) {
        const normalized: Calendar[] = data.calendars.map((raw) => ({
          ...raw, events: (raw.events || []).map((e) => ({
            ...e, start: new Date(e.start), end: new Date(e.end),
          })),
        }));
        setCalendarError('');
        setCalendars(normalized);
        setSourceEvents(normalized.flatMap((c) => c.events));
      }
    } catch (e: unknown) { setCalendarError(errorMessage(e, 'Failed to load calendars')); console.error('Failed to fetch calendars', e); }
    setIsRefreshing(false);
  }, []);

  const retryCalendar = useCallback(async () => {
    await Promise.all([refreshCalendarSettings(), refreshCalendars()]);
  }, [refreshCalendarSettings, refreshCalendars]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setIsLoading(true);
      refreshCalendars().finally(() => setIsLoading(false));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [refreshCalendars]);

  useEffect(() => {
    let isActive = true;
    let socket: ReturnType<typeof createSocket> | null = null;
    let refreshTimer: ReturnType<typeof window.setTimeout> | undefined;

    const scheduleRefresh = () => {
      if (!isActive) return;
      if (refreshTimer !== undefined) window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => {
        void refreshCalendars();
      }, 250);
    };

    const connectCalendarUpdates = async () => {
      try {
        const res = await fetch('/api/auth/me');
        if (!res.ok || !isActive) return;
        const data = await res.json();
        const username = data?.user?.username || data?.email;
        if (!username || !isActive) return;

        socket = createSocket({ withCredentials: true });
        socket.emit('join', username);
        socket.on('connect', () => {
          socket?.emit('join', username);
        });
        socket.on('calendar_updated', scheduleRefresh);
      } catch (e) {
        console.error('Failed to start calendar realtime updates', e);
      }
    };

    void connectCalendarUpdates();

    return () => {
      isActive = false;
      if (refreshTimer !== undefined) window.clearTimeout(refreshTimer);
      socket?.off('calendar_updated', scheduleRefresh);
      socket?.disconnect();
    };
  }, [refreshCalendars]);

  // Persist calendar visibility to localStorage
  useEffect(() => {
    try {
      localStorage.setItem('oms_calendar_visibility', JSON.stringify(calendarVisibility));
    } catch {}
  }, [calendarVisibility]);

  // Event CRUD
  const saveEvent = useCallback(async () => {
    if (!newEvent.title?.trim()) { setEventError('Title is required'); return false; }
    setEventSaving(true); setEventError('');
    try {
      const start = newEvent.start || new Date();
      const end = newEvent.end || new Date(start.getTime() + 3600000);
      const timeKind = newEvent.isAllDay ? 'all-day' : (newEvent.timeKind || 'zoned');
      const timeZone = timeKind === 'zoned' ? (newEvent.timeZone || displayTimeZone) : (timeKind === 'utc' ? 'UTC' : null);
      const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT',
        `UID:${editingEvent?.id || crypto.randomUUID()}@openmailstack`,
        formatIcalDateProperty('DTSTART', start, timeKind, timeZone),
        formatIcalDateProperty('DTEND', end, timeKind, timeZone),
        `SUMMARY:${newEvent.title}`];
      if (newEvent.location) lines.push(`LOCATION:${newEvent.location}`);
      if (newEvent.description) lines.push(`DESCRIPTION:${newEvent.description}`);
      if (newEvent.recurrence && newEvent.recurrence !== 'none') lines.push(`RRULE:FREQ=${newEvent.recurrence.toUpperCase()}`);
      if (newEvent.guests) {
        (newEvent.guests as string[]).forEach((g) => lines.push(`ATTENDEE:mailto:${g}`));
      }
      lines.push('END:VEVENT', 'END:VCALENDAR');
      await api.saveEvent(lines.join('\r\n'), newEvent.calendarId);
      setIsEventModalOpen(false);
      setEditingEvent(null);
      const nextStart = projectInstantToWallDate(new Date(), 'utc', displayTimeZone);
      setNewEvent({
        title: '', start: nextStart, end: new Date(nextStart.getTime() + calendarSettings.defaultEventDurationMinutes * 60000),
        isAllDay: false, timeKind: 'zoned', timeZone: displayTimeZone,
        location: '', description: '', calendarId: 0,
      });
      await refreshCalendars();
      setEventSaving(false);
      return true;
    } catch (e: unknown) { setEventError(errorMessage(e, 'Failed to save')); setEventSaving(false); return false; }
  }, [newEvent, editingEvent, refreshCalendars, displayTimeZone, calendarSettings.defaultEventDurationMinutes]);

  const deleteEvent = useCallback(async (eventId: string, calendarId: number, excludeDate?: string) => {
    try {
      await api.deleteEvent(calendarId, eventId, excludeDate);
      await refreshCalendars();
    } catch (e) { console.error('Delete failed', e); }
  }, [refreshCalendars]);

  const openNewEvent = useCallback((start?: Date, isAllDay = false) => {
    setEditingEvent(null);
    const eventStart = start || projectInstantToWallDate(new Date(), 'utc', displayTimeZone);
    setNewEvent({
      title: '', start: eventStart, end: isAllDay ? addWallDays(eventStart, 1) : new Date(eventStart.getTime() + calendarSettings.defaultEventDurationMinutes * 60000),
      isAllDay, timeKind: isAllDay ? 'all-day' : 'zoned', timeZone: isAllDay ? null : displayTimeZone,
      location: '', description: '', calendarId: calendarSettings.defaultCalendarId || calendars[0]?.id || 0,
    });
    setIsEventModalOpen(true);
  }, [calendars, calendarSettings.defaultCalendarId, calendarSettings.defaultEventDurationMinutes, displayTimeZone]);

  const editExistingEvent = useCallback((event: CalendarEvent) => {
    setEditingEvent(event);
    const timeKind = eventTimeKind(event);
    const editTimeZone = timeKind === 'zoned' ? event.timeZone : timeKind === 'utc' ? 'UTC' : displayTimeZone;
    setNewEvent({
      ...event,
      start: projectInstantToWallDate(event.sourceStart || event.start, timeKind, editTimeZone || displayTimeZone),
      end: projectInstantToWallDate(event.sourceEnd || event.end, timeKind, editTimeZone || displayTimeZone),
      timeKind,
      timeZone: timeKind === 'zoned' ? event.timeZone : timeKind === 'utc' ? 'UTC' : null,
    });
    setIsEventModalOpen(true);
  }, [displayTimeZone]);

  // Free/busy
  const [freeBusy, setFreeBusy] = useState<Record<string, { start: Date; end: Date }[]>>({});
  const [freeBusyLoading, setFreeBusyLoading] = useState(false);

  const draftWallDateToInstant = useCallback((date: Date) => {
    const timeKind = newEvent.isAllDay ? 'all-day' : (newEvent.timeKind || 'zoned');
    const timeZone = timeKind === 'zoned' ? (newEvent.timeZone || displayTimeZone) : null;
    return wallDateToInstant(date, timeKind, timeZone);
  }, [newEvent.isAllDay, newEvent.timeKind, newEvent.timeZone, displayTimeZone]);

  const lookupFreeBusy = useCallback(async (emails: string[], start: Date, end: Date) => {
    setFreeBusyLoading(true);
    try {
      const startInstant = draftWallDateToInstant(start);
      const endInstant = draftWallDateToInstant(end);
      const res = await fetch(`/api/apps/calendars/freebusy?users=${emails.join(',')}&start=${startInstant.toISOString()}&end=${endInstant.toISOString()}`);
      const data = await res.json();
      if (data.busy) setFreeBusy(data.busy);
    } catch (e) { console.error('Free/busy lookup failed', e); }
    setFreeBusyLoading(false);
  }, [draftWallDateToInstant]);

  return {
    calendars, events, calendarView, setCalendarView,
    currentDate, setCurrentDate,
    calendarSettings, displayTimeZone, displayNow,
    calendarSearchQuery, setCalendarSearchQuery,
    isEventModalOpen, setIsEventModalOpen,
    isAdvancedEventMode, setIsAdvancedEventMode,
    isLoading: isLoading || settingsLoading, isRefreshing, calendarError: settingsError || calendarError,
    refreshCalendars, retryCalendar,
    newEvent, setNewEvent, editingEvent, eventError, eventSaving,
    saveEvent, deleteEvent, openNewEvent, editExistingEvent,
    calendarVisibility, setCalendarVisibility,
    quickCreateText, setQuickCreateText,
    freeBusy, freeBusyLoading, lookupFreeBusy, draftWallDateToInstant,
  };
}
