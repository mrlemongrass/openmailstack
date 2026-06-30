// Types extracted from App.tsx — all interfaces used across the app

// ---- Mail types ----
export interface Rule {
  id: string;
  name: string;
  enabled: boolean;
  condition: 'any' | 'all';
  criteria: { id: string; field: string; operator: string; value: string }[];
  actions: { id: string; type: string; folder?: string }[];
}

export interface MailFolder {
  path: string;
  unseen: number;
  delimiter?: string;
}

export interface FolderTreeNode {
  name: string;
  fullPath: string;
  children: Record<string, FolderTreeNode>;
  unseen: number;
}

export interface Message {
  folder?: string;
  uid: number;
  subject: string;
  from: string;
  to?: string;
  cc?: string;
  date: string | Date;
  isRead?: boolean;
  isStarred?: boolean;
  hasAttachments?: boolean;
  attachments?: MessageAttachment[];
  preview?: string;
  html?: string;
  text?: string;
  messageId?: string;
  inReplyTo?: string;
  references?: string[];
  is_scheduled?: boolean;
  scheduled_id?: number;
  draftId?: string;
  threadCount?: number;
  threadUids?: number[];
}

export interface MessageAttachment {
  id: number;
  filename: string;
  contentType: string;
  size: number;
  disposition?: string;
  previewable?: boolean;
}

export interface Signature {
  id: string;
  name: string;
  content: string;
  isDefault?: boolean;
  defaultForNew?: boolean;
  defaultForReply?: boolean;
}

export interface MessageResponse {
  success: boolean;
  message: Message;
}

export interface MessageActionResponse {
  success: boolean;
  error?: string;
  targetFolder?: string;
  undoUids?: number[];
}

export interface MessageListResponse {
  success: boolean;
  messages?: Message[];
  uidNext?: number;
  lowestUid?: number;
  moreAvailable?: boolean;
  error?: string;
}

export interface SearchResponse {
  success: boolean;
  messages?: Message[];
  error?: string;
  source?: 'index' | 'imap';
}

export interface SearchIndexStatusResponse {
  success: boolean;
  indexedCount?: number;
  lastIndexedAt?: string | Date | null;
  error?: string;
}

export interface SearchIndexRefreshResponse {
  success: boolean;
  indexed?: number;
  folders?: number;
  error?: string;
}

export interface SearchWorkerStatusResponse {
  success: boolean;
  totalUsers?: number;
  totalFolders?: number;
  totalIndexed?: number;
  lastRunAt?: string | null;
  isRunning?: boolean;
  error?: string;
}

export type SearchField = 'all' | 'from' | 'to' | 'subject' | 'body' | 'attachments' | 'unread' | 'starred';
export type SearchScope = 'folder' | 'all';

export interface SavedSearch {
  id: string;
  name: string;
  query: string;
}

export interface SearchHint {
  category: string;
  icon: string;
  items: { operator: string; description: string; example: string }[];
}

export interface UserIdentities {
  name: string;
  address: string;
  aliases: { address: string; name?: string }[];
}

export interface MailUndoState {
  message: string;
  uids: number[];
  targetFolder?: string;
  timestamp: number;
}

// ---- Contact types ----
export interface ContactItem {
  value: string;
  label: string;
}

export interface ContactLabel {
  id: number;
  name: string;
  color: string;
}

export interface Contact {
  id?: number | string;
  name: string;
  email: string;
  phone?: string;
  alternateEmail?: string;
  company?: string;
  jobTitle?: string;
  organization?: string;
  address?: string;
  notes?: string;
  source?: 'personal' | 'directory';
  emails_json?: ContactItem[];
  phones_json?: ContactItem[];
  addresses_json?: ContactItem[];
  labels_json?: number[];
  vcard_data?: string;
  photo_url?: string;
  is_favorite?: number;
  prefix?: string;
  first_name?: string;
  middle_name?: string;
  last_name?: string;
  suffix?: string;
  nickname?: string;
  department?: string;
  birthday?: string;
  website_url?: string;
  deleted_at?: string;
}

export type DisplayContact = Contact & { displayName: string; _parsedName?: any };

export interface ContactGroup {
  id: number;
  name: string;
  color: string;
  member_count?: number;
}

export interface ContactsResponse {
  success: boolean;
  contacts?: Contact[];
  error?: string;
}

// ---- Calendar types ----
export interface CalendarEvent {
  id: string;
  occurrenceId?: string;
  calendarId: number;
  title: string;
  start: Date;
  end: Date;
  isAllDay?: boolean;
  location?: string;
  description?: string;
  recurrence?: string;
  recurrenceLabel?: string;
  rawIcal?: string;
  guests?: string[];
  attachments?: { name: string; size: number }[];
}

export interface Calendar {
  id: number;
  name: string;
  color: string;
  isVisible?: boolean;
  access_role?: string;
  subscribed_url?: string;
  events: CalendarEvent[];
}

export interface RawCalendarEvent extends Omit<CalendarEvent, 'start' | 'end'> {
  start: string | Date;
  end: string | Date;
}

export interface RawCalendar extends Omit<Calendar, 'events'> {
  events?: RawCalendarEvent[];
}

export interface CalendarsResponse {
  success: boolean;
  calendars?: RawCalendar[];
}

export interface CalendarUpdateResponse {
  success: boolean;
  error?: string;
}

export interface CalendarDeleteResponse {
  success: boolean;
  deletedEvents?: number;
  error?: string;
}

// ---- Notes types ----
export interface Note {
  id: string;
  title: string;
  content: string;
  color: string;
  is_pinned: number;
  is_locked: number;
  folder: string;
  labels_json: string;
  updated_at: string;
}
