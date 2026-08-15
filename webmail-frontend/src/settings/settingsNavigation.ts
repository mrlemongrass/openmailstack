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
