import { useEffect, useState } from 'react';
import {
  CALENDAR_SETTINGS_CHANGED,
  defaultCalendarSettings,
  getUserSettings,
  type CalendarUserSettings,
} from '../../settings/settingsApi';

interface CalendarSettingsState {
  settings: CalendarUserSettings;
  isLoading: boolean;
  error: string;
  refresh: () => Promise<void>;
}

interface CalendarSettingsUpdate {
  settings?: CalendarUserSettings;
  isLoading?: boolean;
  error?: string;
}

export function createCalendarSettingsLoader(
  readSettings: () => Promise<CalendarUserSettings>,
  update: (next: CalendarSettingsUpdate) => void
) {
  let active = true;
  let request = 0;

  const refresh = async () => {
    const currentRequest = ++request;
    if (active) update({ isLoading: true });
    try {
      const value = await readSettings();
      if (!active || currentRequest !== request) return;
      update({ settings: { ...defaultCalendarSettings, ...value }, error: '', isLoading: false });
    } catch (cause) {
      if (!active || currentRequest !== request) return;
      update({
        error: cause instanceof Error ? cause.message : 'Failed to load Calendar time settings',
        isLoading: false,
      });
    }
  };

  return {
    refresh,
    apply(next: CalendarUserSettings) {
      request += 1;
      if (active) update({ settings: { ...defaultCalendarSettings, ...next }, error: '', isLoading: false });
    },
    activate() {
      active = true;
    },
    dispose() {
      active = false;
      request += 1;
    },
  };
}

export function useCalendarSettings(): CalendarSettingsState {
  const [settings, setSettings] = useState<CalendarUserSettings>(defaultCalendarSettings);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [loader] = useState(() => (
    createCalendarSettingsLoader(
      () => getUserSettings('calendar'),
      next => {
        if (next.settings) setSettings(next.settings);
        if (next.isLoading !== undefined) setIsLoading(next.isLoading);
        if (next.error !== undefined) setError(next.error);
      }
    )
  ));

  useEffect(() => {
    loader.activate();
    const initialRefresh = window.setTimeout(() => { void loader.refresh(); }, 0);

    const handleChange = (event: Event) => {
      const next = (event as CustomEvent<CalendarUserSettings>).detail;
      if (next) loader.apply(next);
    };
    window.addEventListener(CALENDAR_SETTINGS_CHANGED, handleChange);
    window.addEventListener('focus', loader.refresh);
    return () => {
      loader.dispose();
      window.clearTimeout(initialRefresh);
      window.removeEventListener(CALENDAR_SETTINGS_CHANGED, handleChange);
      window.removeEventListener('focus', loader.refresh);
    };
  }, [loader]);

  return { settings, isLoading, error, refresh: loader.refresh };
}
