export type SettingsTab =
  | 'appearance'
  | 'mail_identity'
  | 'mail_signatures'
  | 'mail_reading'
  | 'mail_forwarding'
  | 'mail_vacation'
  | 'mail_filters'
  | 'mail_spam'
  | 'calendar_defaults'
  | 'contacts_display'
  | 'sync_devices'
  | 'account_password'
  | 'advanced';

const SETTINGS_TABS: SettingsTab[] = [
  'appearance',
  'mail_identity',
  'mail_signatures',
  'mail_reading',
  'mail_forwarding',
  'mail_vacation',
  'mail_filters',
  'mail_spam',
  'calendar_defaults',
  'contacts_display',
  'sync_devices',
  'account_password',
  'advanced',
];

export function normalizeSettingsTab(tab: string | null | undefined): SettingsTab {
  if (tab === 'general') return 'mail_signatures';
  if (tab === 'forwarding') return 'mail_forwarding';
  if (tab === 'filters') return 'mail_filters';
  if (tab === 'spam') return 'mail_spam';
  if (tab === 'security') return 'account_password';

  return SETTINGS_TABS.includes(tab as SettingsTab) ? tab as SettingsTab : 'appearance';
}
