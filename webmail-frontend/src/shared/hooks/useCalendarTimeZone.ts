import { useEffect, useState } from 'react';
import type { CalendarUserSettings } from '../../settings/settingsApi';
import { resolveDisplayTimeZone, systemTimeZone } from '../../calendar/calendarTime';

export function useCalendarTimeZone(settings: Pick<CalendarUserSettings, 'timeZoneMode' | 'timeZone'>): string {
  const [browserTimeZone, setBrowserTimeZone] = useState(systemTimeZone);

  useEffect(() => {
    const refresh = () => setBrowserTimeZone(systemTimeZone());
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, []);

  return resolveDisplayTimeZone(settings, browserTimeZone);
}
