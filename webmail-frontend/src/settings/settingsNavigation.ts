import {
  CalendarDays,
  Filter,
  Lock,
  Mail,
  Palette,
  PenTool,
  ShieldAlert,
  SlidersHorizontal,
  Smartphone,
  Users,
  type LucideIcon,
} from 'lucide-react';
import type { SettingsTab } from './tabs';

export const settingsNavGroups: {
  title: string;
  items: { tab: SettingsTab; label: string; icon: LucideIcon }[];
}[] = [
  {
    title: 'Personalization',
    items: [
      { tab: 'appearance', label: 'Appearance', icon: Palette },
    ],
  },
  {
    title: 'Mail',
    items: [
      { tab: 'mail_identity', label: 'Identity & Compose', icon: Mail },
      { tab: 'mail_signatures', label: 'Signatures', icon: PenTool },
      { tab: 'mail_reading', label: 'Reading', icon: SlidersHorizontal },
      { tab: 'mail_filters', label: 'Filters', icon: Filter },
      { tab: 'mail_import', label: 'Import mail', icon: Mail },
      { tab: 'mail_cleanup', label: 'Junk & Trash cleanup', icon: SlidersHorizontal },
      { tab: 'mail_spam', label: 'Spam & Senders', icon: ShieldAlert },
    ],
  },
  {
    title: 'Apps',
    items: [
      { tab: 'calendar_defaults', label: 'Calendar', icon: CalendarDays },
      { tab: 'contacts_display', label: 'Contacts', icon: Users },
      { tab: 'sync_devices', label: 'Sync & Devices', icon: Smartphone },
    ],
  },
  {
    title: 'Account',
    items: [
      { tab: 'account_password', label: 'Security', icon: Lock },
      { tab: 'advanced', label: 'Advanced', icon: SlidersHorizontal },
    ],
  },
];


export const settingsSearchTerms: Partial<Record<SettingsTab, string>> = {
  appearance: 'theme dark light contrast color font spacing accessibility motion',
  mail_identity: 'compose reply rich text plain text html format default sender identity alias undo send',
  mail_signatures: 'signature signoff multiline',
  mail_reading: 'after delete spam move previous next list pane bottom right off density snippets group thread keyboard shortcuts images privacy',
  mail_filters: 'rules filters sender domain move organize existing mail preview',
  mail_import: 'import migrate migration transfer eml mbox mailbox history resume',
  mail_cleanup: 'junk trash retention cleanup automatic schedule delete empty days history',
  mail_spam: 'spam junk block ban safe whitelist allow sender domain legacy',
  calendar_defaults: 'calendar week start timezone reminders events invitations',
  contacts_display: 'contacts address book name display company duplicates',
  sync_devices: 'sync devices iphone ipad imap smtp caldav carddav exchange outlook setup',
  account_password: 'password security login session',
  advanced: 'advanced cache index search storage',
};
export function findSettings(query: string) {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return settingsNavGroups.flatMap(group => group.items).filter(item => words.every(word => `${item.label} ${settingsSearchTerms[item.tab] || ''}`.toLowerCase().includes(word)));
}
