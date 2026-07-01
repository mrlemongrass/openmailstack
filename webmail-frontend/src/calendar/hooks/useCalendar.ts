import { useState, useCallback, useEffect } from 'react';
import type { Calendar, CalendarEvent } from '../../shared/types';
import * as api from '../../shared/api';

export function useCalendar() {
  const [calendars, setCalendars] = useState<Calendar[]>([]);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [calendarView, setCalendarView] = useState<'month' | 'week' | 'day' | 'year' | 'agenda'>('month');
  const [currentDate, setCurrentDate] = useState(new Date());
  const [calendarSearchQuery, setCalendarSearchQuery] = useState('');
  const [isEventModalOpen, setIsEventModalOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isAdvancedEventMode, setIsAdvancedEventMode] = useState(false);
  const [editingEvent, setEditingEvent] = useState<Partial<CalendarEvent> | null>(null);
  const [eventError, setEventError] = useState('');
  const [eventSaving, setEventSaving] = useState(false);
  const [calendarVisibility, setCalendarVisibility] = useState<Record<number, boolean>>({});
  const [quickCreateText, setQuickCreateText] = useState('');

  // New event draft
  const [newEvent, setNewEvent] = useState<Partial<CalendarEvent>>({
    title: '', start: new Date(), end: new Date(new Date().getTime() + 3600000),
    isAllDay: false, location: '', description: '', calendarId: 0,
  });

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
        setCalendars(normalized);
        setEvents(normalized.flatMap((c) => c.events));
      }
    } catch (e) { console.error('Failed to fetch calendars', e); }
    setIsRefreshing(false);
  }, []);

  useEffect(() => { setIsLoading(true); refreshCalendars().finally(() => setIsLoading(false)); }, []);

  // Event CRUD
  const saveEvent = useCallback(async () => {
    if (!newEvent.title?.trim()) { setEventError('Title is required'); return false; }
    setEventSaving(true); setEventError('');
    try {
      const start = newEvent.start || new Date();
      const end = newEvent.end || new Date(start.getTime() + 3600000);
      const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'BEGIN:VEVENT',
        `UID:${editingEvent?.id || crypto.randomUUID()}@openmailstack`,
        `DTSTART:${formatIcalDate(start, newEvent.isAllDay)}`,
        `DTEND:${formatIcalDate(end, newEvent.isAllDay)}`,
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
      setNewEvent({ title: '', start: new Date(), end: new Date(new Date().getTime() + 3600000), isAllDay: false, location: '', description: '', calendarId: 0 });
      await refreshCalendars();
      setEventSaving(false);
      return true;
    } catch (e: any) { setEventError(e.message || 'Failed to save'); setEventSaving(false); return false; }
  }, [newEvent, editingEvent, calendars, refreshCalendars]);

  const deleteEvent = useCallback(async (eventId: string, calendarId: number, excludeDate?: string) => {
    try {
      await api.deleteEvent(calendarId, eventId, excludeDate);
      await refreshCalendars();
    } catch (e) { console.error('Delete failed', e); }
  }, [refreshCalendars]);

  const openNewEvent = useCallback((start?: Date, isAllDay = false) => {
    setEditingEvent(null);
    setNewEvent({
      title: '', start: start || new Date(), end: start ? new Date(start.getTime() + 3600000) : new Date(new Date().getTime() + 3600000),
      isAllDay, location: '', description: '', calendarId: calendars[0]?.id || 0,
    });
    setIsEventModalOpen(true);
  }, [calendars]);

  const editExistingEvent = useCallback((event: CalendarEvent) => {
    setEditingEvent(event);
    setNewEvent({ ...event });
    setIsEventModalOpen(true);
  }, []);

  // Free/busy
  const [freeBusy, setFreeBusy] = useState<Record<string, { start: Date; end: Date }[]>>({});
  const [freeBusyLoading, setFreeBusyLoading] = useState(false);

  const lookupFreeBusy = useCallback(async (emails: string[], start: Date, end: Date) => {
    setFreeBusyLoading(true);
    try {
      const res = await fetch(`/api/apps/calendars/freebusy?users=${emails.join(',')}&start=${start.toISOString()}&end=${end.toISOString()}`);
      const data = await res.json();
      if (data.busy) setFreeBusy(data.busy);
    } catch (e) { console.error('Free/busy lookup failed', e); }
    setFreeBusyLoading(false);
  }, []);

  return {
    calendars, events, calendarView, setCalendarView,
    currentDate, setCurrentDate,
    calendarSearchQuery, setCalendarSearchQuery,
    isEventModalOpen, setIsEventModalOpen,
    isAdvancedEventMode, setIsAdvancedEventMode,
    isLoading, isRefreshing,
    refreshCalendars,
    newEvent, setNewEvent, editingEvent, eventError, eventSaving,
    saveEvent, deleteEvent, openNewEvent, editExistingEvent,
    calendarVisibility, setCalendarVisibility,
    quickCreateText, setQuickCreateText,
    freeBusy, freeBusyLoading, lookupFreeBusy,
  };
}

function formatIcalDate(d: Date, isAllDay?: boolean): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  if (isAllDay) return `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}`;
  return `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}T${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}
