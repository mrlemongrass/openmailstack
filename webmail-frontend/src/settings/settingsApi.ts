import type { AppearancePreferences } from './appearance';

export type SettingsNamespace = 'mail' | 'calendar' | 'contacts' | 'appearance';

export interface SignatureSettings {
  id: string;
  name: string;
  content: string;
  isDefault?: boolean;
  defaultForNew?: boolean;
  defaultForReply?: boolean;
}

export interface MailUserSettings {
  signatures: SignatureSettings[];
  identity: {
    defaultFrom: string;
    replyTo: string;
    alwaysBccSelf: boolean;
  };
  compose: {
    defaultMode: 'rich' | 'plain';
    defaultFont: 'system' | 'serif' | 'mono';
    attachmentReminder: boolean;
    undoSendSeconds: 0 | 5 | 10 | 20 | 30;
  };
  reading: {
    threaded: boolean;
    density: 'comfortable' | 'cozy' | 'compact';
    previewPane: 'right' | 'bottom' | 'off';
    snippets: boolean;
    externalImages: 'ask' | 'trusted' | 'always';
    markReadDelaySeconds: 0 | 1 | 3 | 5;
  };
}

export interface CalendarUserSettings {
  defaultCalendarId: number | null;
  defaultView: 'day' | 'week' | 'month' | 'year';
  defaultEventDurationMinutes: number;
  defaultReminderMinutes: 0 | 5 | 10 | 15 | 30 | 60 | 1440;
  weekStartsOn: 0 | 1 | 6;
  timeZone: string;
}

export interface ContactsUserSettings {
  nameFormat: 'firstLast' | 'lastFirst';
  sortBy: 'name' | 'email';
  listDensity: 'comfortable' | 'cozy' | 'compact';
  autoCreateFromSent: boolean;
}

export const defaultMailSettings: MailUserSettings = {
  signatures: [],
  identity: {
    defaultFrom: '',
    replyTo: '',
    alwaysBccSelf: false,
  },
  compose: {
    defaultMode: 'rich',
    defaultFont: 'system',
    attachmentReminder: true,
    undoSendSeconds: 10,
  },
  reading: {
    threaded: false,
    density: 'cozy',
    previewPane: 'right',
    snippets: true,
    externalImages: 'ask',
    markReadDelaySeconds: 1,
  },
};

export const defaultCalendarSettings: CalendarUserSettings = {
  defaultCalendarId: null,
  defaultView: 'month',
  defaultEventDurationMinutes: 60,
  defaultReminderMinutes: 10,
  weekStartsOn: 0,
  timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
};

export const defaultContactsSettings: ContactsUserSettings = {
  nameFormat: 'firstLast',
  sortBy: 'name',
  listDensity: 'cozy',
  autoCreateFromSent: true,
};

export interface NamespaceSettings {
  mail: MailUserSettings;
  calendar: CalendarUserSettings;
  contacts: ContactsUserSettings;
  appearance: AppearancePreferences;
}

interface SettingsResponse<T extends SettingsNamespace> {
  success: boolean;
  namespace: T;
  settings: NamespaceSettings[T];
  error?: string;
}

export async function getUserSettings<T extends SettingsNamespace>(namespace: T): Promise<NamespaceSettings[T]> {
  const response = await fetch(`/api/settings/${namespace}`, {
    credentials: 'include',
  });
  const body = await response.json() as SettingsResponse<T>;
  if (!response.ok || !body.success) {
    throw new Error(body.error || `Failed to load ${namespace} settings`);
  }
  return body.settings;
}

export async function saveUserSettings<T extends SettingsNamespace>(namespace: T, settings: NamespaceSettings[T]): Promise<NamespaceSettings[T]> {
  const response = await fetch(`/api/settings/${namespace}`, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ settings }),
  });
  const body = await response.json() as SettingsResponse<T>;
  if (!response.ok || !body.success) {
    throw new Error(body.error || `Failed to save ${namespace} settings`);
  }
  return body.settings;
}
