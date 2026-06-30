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

  const refreshCalendars = useCallback(async () => {
    setIsRefreshing(true);
    try {
      const data = await api.fetchCalendars();
      if (data.calendars) {
        const normalized: Calendar[] = data.calendars.map((raw) => ({
          ...raw,
          events: (raw.events || []).map((e) => ({
            ...e,
            start: new Date(e.start),
            end: new Date(e.end),
          })),
        }));
        setCalendars(normalized);
        setEvents(normalized.flatMap((c) => c.events));
      }
    } catch (e) { console.error('Failed to fetch calendars', e); }
    setIsRefreshing(false);
  }, []);

  useEffect(() => {
    setIsLoading(true);
    refreshCalendars().finally(() => setIsLoading(false));
  }, []);

  return {
    calendars, events, calendarView, setCalendarView,
    currentDate, setCurrentDate,
    calendarSearchQuery, setCalendarSearchQuery,
    isEventModalOpen, setIsEventModalOpen,
    isLoading, isRefreshing,
    refreshCalendars,
  };
}
