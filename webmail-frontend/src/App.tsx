import React, { useState, useEffect, useMemo, useCallback, useRef, lazy, Suspense } from 'react';
import { Mail, MailOpen, Users, Settings, X, Plus, Filter, Search, Star, Trash2, Maximize2, Minimize2, Send, Reply, ReplyAll, Forward, Inbox, ChevronRight, ChevronLeft, ChevronDown, ShieldAlert, Edit, Edit2, Share2, Save, Lock, User, UserPlus, RefreshCw, Paperclip, Eye, Download, Copy, Check, Smartphone, Monitor, Link2, Image, SlidersHorizontal, Undo2 } from 'lucide-react';
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle, useDefaultLayout } from 'react-resizable-panels';
import DOMPurify from 'dompurify';
import 'react-quill-new/dist/quill.snow.css';
import './index.css';
import { SettingsContent, SettingsSidebar } from './settings/SettingsPanel';
import { normalizeSettingsTab } from './settings/tabs';
import { applyAppearancePreferences, loadAppearancePreferences, saveAppearancePreferences, type AppearancePreferences } from './settings/appearance';
import { defaultCalendarSettings, defaultContactsSettings, defaultMailSettings, getUserSettings, saveUserSettings, type CalendarUserSettings, type ContactsUserSettings, type MailUserSettings } from './settings/settingsApi';
import { BrandingPanel } from './admin/BrandingPanel';
import { AdminSettingsPanel } from './admin/AdminSettingsPanel';
import { defaultAdminSettings, getAdminSettings, saveAdminSettings, type AdminSettingsMap } from './admin/adminSettingsApi';
import { applyBrandingToDocument, defaultBranding, fetchBranding, saveAdminBranding, type BrandingSettings } from './branding';

import { format, addMonths, subMonths, addWeeks, subWeeks, addDays, subDays, startOfMonth, endOfMonth, startOfWeek, endOfWeek, isSameMonth, isSameDay } from 'date-fns';

const ReactQuill = lazy(() => import('react-quill-new'));

interface Rule {
  id: string;
  name: string;
  condition: 'any' | 'all';
  criteria: { id: string; field: string; operator: string; value: string }[];
  actions: { id: string; type: string; folder?: string }[];
}

interface MailFolder {
  path: string;
  unseen: number;
}

interface FolderTreeNode {
  name: string;
  fullPath: string;
  children: Record<string, FolderTreeNode>;
  unseen: number;
}

interface Message {
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
  threadCount?: number;
  threadUids?: number[];
}

interface MessageAttachment {
  id: number;
  filename: string;
  contentType: string;
  size: number;
  disposition?: string;
  previewable?: boolean;
}

interface Signature {
  id: string;
  name: string;
  content: string;
  isDefault?: boolean;
  defaultForNew?: boolean;
  defaultForReply?: boolean;
}

interface Contact {
  id?: number | string;
  name: string;
  email: string;
  phone?: string;
  alternateEmail?: string;
  company?: string;
  jobTitle?: string;
  address?: string;
  notes?: string;
  source?: 'personal' | 'directory';
}

type DisplayContact = Contact & { displayName: string };

interface CalendarEvent {
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
}

interface Calendar {
  id: number;
  name: string;
  color: string;
  isVisible?: boolean;
  events: CalendarEvent[];
}

interface RawCalendarEvent extends Omit<CalendarEvent, 'start' | 'end'> {
  start: string | Date;
  end: string | Date;
}

interface RawCalendar extends Omit<Calendar, 'events'> {
  events?: RawCalendarEvent[];
}

interface ContactsResponse {
  success: boolean;
  contacts?: Contact[];
  error?: string;
}

interface CalendarsResponse {
  success: boolean;
  calendars?: RawCalendar[];
}

interface CalendarUpdateResponse {
  success: boolean;
  error?: string;
}

interface CalendarDeleteResponse {
  success: boolean;
  deletedEvents?: number;
  error?: string;
}

interface MessageResponse {
  success: boolean;
  message: Message;
}

interface MessageActionResponse {
  success: boolean;
  error?: string;
  targetFolder?: string;
  undoUids?: number[];
}

interface MessageListResponse {
  success: boolean;
  messages?: Message[];
  uidNext?: number;
  lowestUid?: number;
  moreAvailable?: boolean;
  error?: string;
}

interface SearchResponse {
  success: boolean;
  messages?: Message[];
  error?: string;
  source?: 'index' | 'imap';
}

interface SearchIndexStatusResponse {
  success: boolean;
  indexedCount?: number;
  lastIndexedAt?: string | Date | null;
  error?: string;
}

interface SearchIndexRefreshResponse {
  success: boolean;
  indexed?: number;
  folders?: number;
  error?: string;
}

type SearchField = 'all' | 'from' | 'to' | 'subject' | 'body' | 'attachments' | 'unread' | 'starred';
type SearchScope = 'folder' | 'all';
type AppMode = 'webmail' | 'settings' | 'admin' | 'calendar' | 'contacts' | 'sync';

const CALENDAR_COLOR_OPTIONS = ['#3498db', '#e74c3c', '#2ecc71', '#f1c40f', '#9b59b6', '#e67e22', '#1abc9c', '#e91e63', '#607d8b'];

const defaultTabForAppMode = (mode: AppMode): string => {
  if (mode === 'calendar') return 'calendar_month';
  if (mode === 'contacts') return 'contacts_list';
  if (mode === 'settings') return 'appearance';
  if (mode === 'admin') return 'admin_dashboard';
  if (mode === 'sync') return 'sync_info';
  return 'inbox';
};

const isTabValidForAppMode = (mode: AppMode, tab: string): boolean => {
  if (mode === 'webmail') return tab === 'inbox';
  if (mode === 'calendar') return tab === 'calendar_month';
  if (mode === 'contacts') return tab === 'contacts_list';
  if (mode === 'sync') return tab === 'sync_info';
  if (mode === 'admin') return tab.startsWith('admin_');
  return normalizeSettingsTab(tab) === tab || ['general', 'forwarding', 'filters', 'security', 'spam'].includes(tab);
};

const getInitialAppMode = (): AppMode => {
  if (typeof window === 'undefined') return 'webmail';
  const stored = window.localStorage.getItem('oms_app_mode') as AppMode | null;
  return stored && ['webmail', 'settings', 'admin', 'calendar', 'contacts', 'sync'].includes(stored) ? stored : 'webmail';
};

interface SavedSearch {
  id: number;
  name: string;
  query: string;
  field: SearchField;
  scope: SearchScope;
  folder: string;
}

interface SavedSearchesResponse {
  success: boolean;
  savedSearches?: SavedSearch[];
  error?: string;
}

interface SavedSearchResponse {
  success: boolean;
  savedSearch?: SavedSearch;
  error?: string;
}

interface AdminDomain {
  domain: string;
  description?: string;
  aliases?: number;
  mailboxes?: number;
  maxquota?: number;
  quota?: number;
  transport?: string;
  backupmx?: number;
  created?: string;
  modified?: string;
  active: number;
  verify_token?: string | null;
}

interface AdminMailbox {
  username: string;
  name?: string;
  domain?: string;
  quota?: number;
  active?: number;
  phone?: string;
  email_other?: string;
  company?: string;
  job_title?: string;
  street_address?: string;
  city?: string;
  region?: string;
  postal_code?: string;
  country?: string;
  notes?: string;
  show_in_directory?: number;
}

interface AdminAlias {
  address: string;
  goto: string;
  domain?: string;
  active?: number;
}

interface AdminRouting {
  alias_domain: string;
  target_domain: string;
  active?: number;
}

interface DnsRecord {
  type: string;
  name: string;
  value: string;
  description?: string;
}

interface AdminListResponse<T> {
  success: boolean;
  data?: T[];
  error?: string;
}

interface AdminMutationResponse {
  success: boolean;
  error?: string;
}

interface AdminApiKey {
  id: number | string;
  description: string;
  created_at: string;
}

interface AdminApiKeyCreateResponse extends AdminMutationResponse {
  raw_key?: string;
}

interface AdminUser {
  username: string;
}

interface AdminLog {
  id: number | string;
  timestamp: string;
  username: string;
  domain?: string;
  action: string;
  data?: string;
}

interface AdminUpdates {
  current_version?: string;
  latest_version?: string;
  has_update?: boolean;
  components?: Record<string, string | number>;
}

type AdminUpdatesResponse = AdminMutationResponse & AdminUpdates;

interface SpamPolicies {
  whitelisted_senders?: string[];
  blacklisted_senders?: string[];
  banned_ips?: string[];
  [key: string]: unknown;
}

interface SpamPoliciesResponse extends AdminMutationResponse {
  rules?: SpamPolicies;
}

type ContactsView = 'personal' | 'directory';

interface MailboxEditorDraft {
  name: string;
  quota: string;
  phone: string;
  alternateEmail: string;
  company: string;
  jobTitle: string;
  streetAddress: string;
  city: string;
  region: string;
  postalCode: string;
  country: string;
  notes: string;
  showInDirectory: boolean;
}

interface UserIdentities {
  name: string;
  address: string;
  aliases: string[];
}

interface MailUndoState {
  label: string;
  sourceFolder: string;
  targetFolder: string;
  uids: number[];
}

const getHeaders = () => ({
  'Content-Type': 'application/json'
});

const adminFetch = async <T extends AdminMutationResponse>(url: string, options: RequestInit = {}): Promise<T> => {
  const headers = new Headers(getHeaders());
  if (options.headers) {
    new Headers(options.headers).forEach((value, key) => headers.set(key, value));
  }
  const response = await fetch(url, {
    ...options,
    headers
  });
  const data = await response.json() as T;
  if (!response.ok || !data.success) {
    throw new Error(data.error || 'Admin request failed.');
  }
  return data;
};

const quotaBytesToMbInput = (bytes?: number) => {
  if (!bytes || bytes < 0) return '0';
  return String(Math.round(bytes / 1048576));
};

const isEditableTarget = (target: EventTarget | null) => {
  const element = target as HTMLElement | null;
  if (!element) return false;
  return ['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName) || element.isContentEditable;
};

const recurrenceToRrule = (recurrence: string) => {
  const frequencyByValue: Record<string, string> = {
    daily: 'DAILY',
    weekly: 'WEEKLY',
    monthly: 'MONTHLY',
    yearly: 'YEARLY',
  };
  const frequency = frequencyByValue[recurrence];
  return frequency ? `RRULE:FREQ=${frequency}` : '';
};

const recurrenceFromRrule = (rrule?: string) => {
  const match = String(rrule || '').match(/FREQ=(DAILY|WEEKLY|MONTHLY|YEARLY)/i);
  if (!match) return 'none';
  return match[1].toLowerCase();
};

const escapeIcalText = (value: string) => value
  .replace(/\\/g, '\\\\')
  .replace(/\n/g, '\\n')
  .replace(/,/g, '\\,')
  .replace(/;/g, '\\;');

const formatQuota = (bytes?: number) => {
  if (!bytes || bytes <= 0) return 'Unlimited';
  return `${Math.round(bytes / 1048576)} MB`;
};

const splitAliasTargets = (value: string) => (
  value
    .split(',')
    .map(target => target.trim().toLowerCase())
    .filter(Boolean)
);

const dedupeEmails = (values: string[]) => Array.from(new Set(
  values.map(value => value.trim().toLowerCase()).filter(Boolean)
));

const mailboxToEditorDraft = (mailbox: AdminMailbox): MailboxEditorDraft => ({
  name: mailbox.name || '',
  quota: quotaBytesToMbInput(mailbox.quota),
  phone: mailbox.phone || '',
  alternateEmail: mailbox.email_other || '',
  company: mailbox.company || '',
  jobTitle: mailbox.job_title || '',
  streetAddress: mailbox.street_address || '',
  city: mailbox.city || '',
  region: mailbox.region || '',
  postalCode: mailbox.postal_code || '',
  country: mailbox.country || '',
  notes: mailbox.notes || '',
  showInDirectory: mailbox.show_in_directory !== 0,
});

const loadLocalSignatures = (): Signature[] => {
  try {
    const saved = localStorage.getItem('oms_signatures');
    return saved ? JSON.parse(saved) : [];
  } catch {
    return [];
  }
};

const loadLocalThreaded = () => localStorage.getItem('oms_threaded') === 'true';

const buildSettingsSaveSnapshot = (
  mailSettings: MailUserSettings,
  appearance: AppearancePreferences,
  calendarSettings: CalendarUserSettings,
  contactsSettings: ContactsUserSettings
) => (
  JSON.stringify({ mail: mailSettings, appearance, calendar: calendarSettings, contacts: contactsSettings })
);

const formatAttachmentSize = (bytes: number) => {
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const getAttachmentUrl = (folder: string, uid: number, attachmentId: number, download = false) => (
  `/api/folders/${encodeURIComponent(folder)}/messages/${uid}/attachments/${attachmentId}${download ? '?download=1' : ''}`
);

const buildFolderTree = (folders: MailFolder[]): Record<string, FolderTreeNode> => {
  const root: FolderTreeNode = { name: '', fullPath: '', children: {}, unseen: 0 };
  for (const f of folders) {
    const parts = f.path.split(/[./]/);
    let current: FolderTreeNode = root;
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (!current.children[part]) {
        current.children[part] = { 
          name: part, 
          fullPath: parts.slice(0, i + 1).join(f.path.includes('.') ? '.' : '/'), 
          children: {},
          unseen: 0
        };
      }
      current = current.children[part];
      // Attach unseen count to the exact matched node
      if (i === parts.length - 1) {
          current.unseen = f.unseen;
      }
    }
  }
  return root.children;
};

interface FolderNodeProps {
  node: FolderTreeNode;
  level: number;
  activeFolder: string;
  setActiveFolder: (folder: string) => void;
  expandedFolders: Record<string, boolean>;
  toggleFolder: (folderPath: string) => void;
  handleMessageMove: (uids: number[], targetFolder: string) => void;
}

const FolderNode = ({ node, level, activeFolder, setActiveFolder, expandedFolders, toggleFolder, handleMessageMove }: FolderNodeProps) => {
  const hasChildren = Object.keys(node.children).length > 0;
  const isExpanded = expandedFolders[node.fullPath];
  const isActive = activeFolder === node.fullPath;
  
  const [isDragOver, setIsDragOver] = useState(false);

  return (
    <div>
      <div 
        className={`nav-item ${isActive ? 'active' : ''}`}
        style={{ 
          paddingLeft: `${8 + level * 16}px`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', padding: '6px 12px', borderRadius: '4px',
          background: isDragOver ? 'var(--accent-primary-transparent)' : undefined
        }}
        onClick={(e) => { e.stopPropagation(); setActiveFolder(node.fullPath); }}
        onDragOver={(e) => {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          setIsDragOver(true);
        }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragOver(false);
          const data = e.dataTransfer.getData('application/json');
          if (data && handleMessageMove) {
            try {
              const uids = JSON.parse(data) as number[];
              handleMessageMove(uids, node.fullPath);
            } catch {
              return;
            }
          }
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <div 
            onClick={(e) => { 
              if (hasChildren) {
                e.stopPropagation(); 
                toggleFolder(node.fullPath); 
              }
            }}
            style={{ width: '20px', display: 'flex', justifyContent: 'center', alignItems: 'center', opacity: hasChildren ? 1 : 0 }}
          >
            {hasChildren ? (isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />) : <span style={{width: 14}}/>}
          </div>
          <span style={{ marginLeft: '4px' }}>{node.name}</span>
        </div>
        {node.unseen > 0 && (
          <span style={{ 
            background: 'var(--accent-primary)', 
            color: '#fff', 
            fontSize: '0.75rem', 
            fontWeight: 'bold', 
            padding: '2px 8px', 
            borderRadius: '12px' 
          }}>
            {node.unseen}
          </span>
        )}
      </div>
      {hasChildren && isExpanded && (
        <div>
          {Object.values(node.children).sort((a, b) => a.name.localeCompare(b.name)).map((child) => (
            <FolderNode key={child.fullPath} node={child} level={level + 1} activeFolder={activeFolder} setActiveFolder={setActiveFolder} expandedFolders={expandedFolders} toggleFolder={toggleFolder} handleMessageMove={handleMessageMove} />
          ))}
        </div>
      )}
    </div>
  );
};

function App() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [saving, setSaving] = useState(false);
  const [appMode, setAppMode] = useState<AppMode>(() => getInitialAppMode());
  const [activeTab, setActiveTab] = useState(() => {
    const mode = getInitialAppMode();
    if (typeof window === 'undefined') return defaultTabForAppMode(mode);
    const storedTab = window.localStorage.getItem('oms_active_tab');
    if (storedTab && isTabValidForAppMode(mode, storedTab)) {
      return mode === 'settings' ? normalizeSettingsTab(storedTab) : storedTab;
    }
    return defaultTabForAppMode(mode);
  });
  const [messages, setMessages] = useState<Message[]>([]);
  const [selectedMessages, setSelectedMessages] = useState<number[]>([]);
  const [mailUndo, setMailUndo] = useState<MailUndoState | null>(null);
  const [loading, setLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [mailLoading, setMailLoading] = useState(false);
  const [loadingOlderMessages, setLoadingOlderMessages] = useState(false);
  const [mailLowestUid, setMailLowestUid] = useState<number | null>(null);
  const [mailMoreAvailable, setMailMoreAvailable] = useState(false);
  const [viewingThread, setViewingThread] = useState<Message[] | null>(null);
  const [activeFolder, setActiveFolder] = useState('INBOX');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchField, setSearchField] = useState<SearchField>('all');
  const [searchScope, setSearchScope] = useState<SearchScope>('folder');
  const [isSearchActive, setIsSearchActive] = useState(false);
  const canBulkAct = !isSearchActive || searchScope === 'folder';
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [searchInfo, setSearchInfo] = useState('');
  const [indexLoading, setIndexLoading] = useState(false);
  const [searchIndexStatus, setSearchIndexStatus] = useState<SearchIndexStatusResponse | null>(null);
  const [savedSearches, setSavedSearches] = useState<SavedSearch[]>([]);
  const [expandedFolders, setExpandedFolders] = useState<{[key: string]: boolean}>({});
  const [isComposing, setIsComposing] = useState(false);
  const [composeDocked, setComposeDocked] = useState(false);
  const [showCc, setShowCc] = useState(false);
  const [showBcc, setShowBcc] = useState(false);
  const [composeTo, setComposeTo] = useState('');
  const [composeCc, setComposeCc] = useState('');
  const [composeBcc, setComposeBcc] = useState('');
  const [composeSubject, setComposeSubject] = useState('');
  const [composeBody, setComposeBody] = useState('');
  const [composeFrom, setComposeFrom] = useState('');
  const [composeSignature, setComposeSignature] = useState('none');
  const [composeAttachments, setComposeAttachments] = useState<File[]>([]);
  const [draftUid, setDraftUid] = useState<string | null>(null);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [userIdentities, setUserIdentities] = useState<UserIdentities>({ name: '', address: '', aliases: [] });
  const [syncGuideOpen, setSyncGuideOpen] = useState<'calendar' | 'contacts' | null>(null);
  const [copiedSetupField, setCopiedSetupField] = useState<string | null>(null);
  const [appearance, setAppearance] = useState<AppearancePreferences>(() => loadAppearancePreferences());
  const [settingsHydrated, setSettingsHydrated] = useState(false);
  const [settingsHydratedFor, setSettingsHydratedFor] = useState('');
  const [settingsSyncError, setSettingsSyncError] = useState('');
  const [isThreaded, setIsThreaded] = useState(() => loadLocalThreaded());
  const [signatures, setSignatures] = useState<Signature[]>(() => loadLocalSignatures());
  const [mailSettings, setMailSettings] = useState<MailUserSettings>(() => defaultMailSettings);
  const [calendarSettings, setCalendarSettings] = useState<CalendarUserSettings>(() => defaultCalendarSettings);
  const [contactsSettings, setContactsSettings] = useState<ContactsUserSettings>(() => defaultContactsSettings);
  const settingsSaveTimer = useRef<number | null>(null);
  const settingsSaveSnapshot = useRef('');
  const mailUndoTimer = useRef<number | null>(null);
  const mailKeyboardAction = useRef<((action: 'delete' | 'archive' | 'spam' | 'read' | 'unread' | 'star' | 'unstar') => Promise<void>) | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [directoryContacts, setDirectoryContacts] = useState<Contact[]>([]);
  const [contactsView, setContactsView] = useState<ContactsView>('personal');
  const [contactsActionStatus, setContactsActionStatus] = useState('');
  const [contactsActionError, setContactsActionError] = useState('');

  useEffect(() => {
    localStorage.setItem('oms_signatures', JSON.stringify(signatures));
  }, [signatures]);

  useEffect(() => {
    localStorage.setItem('oms_threaded', isThreaded ? 'true' : 'false');
  }, [isThreaded]);

  useEffect(() => {
    applyAppearancePreferences(appearance);
    saveAppearancePreferences(appearance);
  }, [appearance]);

  useEffect(() => {
    localStorage.setItem('oms_app_mode', appMode);
    localStorage.setItem('oms_active_tab', activeTab);
  }, [appMode, activeTab]);

  useEffect(() => () => {
    if (mailUndoTimer.current) {
      window.clearTimeout(mailUndoTimer.current);
    }
  }, []);

  // Password state
  const [passwords, setPasswords] = useState({ current: '', new: '', confirm: '' });

  const [calendarView, setCalendarView] = useState<'day' | 'week' | 'month' | 'year'>('month');
  const [currentDate, setCurrentDate] = useState(new Date(2026, 5, 20)); // June 20, 2026

  const [calendars, setCalendars] = useState<Calendar[]>([]);
  const [events, setEvents] = useState<CalendarEvent[]>([]);

  const [isEventModalOpen, setIsEventModalOpen] = useState(false);
  const [isAdvancedEventMode, setIsAdvancedEventMode] = useState(false);
  const [selectedCalendarEvent, setSelectedCalendarEvent] = useState<CalendarEvent | null>(null);
  const [editingCalendarEvent, setEditingCalendarEvent] = useState<CalendarEvent | null>(null);
  const [editingCalendar, setEditingCalendar] = useState<Calendar | null>(null);
  const [calendarEditorData, setCalendarEditorData] = useState({ name: '', color: '#3498db' });
  const [calendarEditorSaving, setCalendarEditorSaving] = useState(false);
  const [calendarEditorError, setCalendarEditorError] = useState('');
  const [deletingCalendarId, setDeletingCalendarId] = useState<number | null>(null);
  const [newEventData, setNewEventData] = useState({ 
    title: '', calendarId: 1, start: new Date(), end: new Date(new Date().getTime() + 60*60*1000), 
    isAllDay: false, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    recurrence: 'none', guests: '', guestPermissions: { invite: true, seeList: true },
    location: '', description: '',
    notifications: [{id: 1, type: 'notification', time: 10}],
    busyStatus: 'busy', visibility: 'default'
  });


  const [folders, setFolders] = useState<MailFolder[]>([]);

  const [isAdmin, setIsAdmin] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [currentUsername, setCurrentUsername] = useState<string>('');
  const [loginUsername, setLoginUsername] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [loginError, setLoginError] = useState('');

  const [adminDomains, setAdminDomains] = useState<AdminDomain[]>([]);
  const [adminMailboxes, setAdminMailboxes] = useState<AdminMailbox[]>([]);
  const [adminAliases, setAdminAliases] = useState<AdminAlias[]>([]);
  const [adminRouting, setAdminRouting] = useState<AdminRouting[]>([]);
  const [adminApiKeys, setAdminApiKeys] = useState<AdminApiKey[]>([]);
  const [adminUpdates, setAdminUpdates] = useState<AdminUpdates | null>(null);
  const [adminSpamPolicies, setAdminSpamPolicies] = useState<SpamPolicies | null>(null);
  const [adminAdmins, setAdminAdmins] = useState<AdminUser[]>([]);
  const [adminLogs, setAdminLogs] = useState<AdminLog[]>([]);
  const [adminActionStatus, setAdminActionStatus] = useState('');
  const [adminActionError, setAdminActionError] = useState('');
  const [routingAliasDomain, setRoutingAliasDomain] = useState('');
  const [routingTargetDomain, setRoutingTargetDomain] = useState('');
  const [dnsRecordsModal, setDnsRecordsModal] = useState<{ domain: string; records: DnsRecord[] } | null>(null);
  const [aliasEditor, setAliasEditor] = useState<AdminAlias | null>(null);
  const [aliasEditorAddress, setAliasEditorAddress] = useState('');
  const [aliasEditorMembers, setAliasEditorMembers] = useState<string[]>([]);
  const [selectedAliasMembers, setSelectedAliasMembers] = useState<string[]>([]);
  const [aliasNewMember, setAliasNewMember] = useState('');
  const [mailboxEditor, setMailboxEditor] = useState<AdminMailbox | null>(null);
  const [mailboxEditorDraft, setMailboxEditorDraft] = useState<MailboxEditorDraft | null>(null);
  const [forwardingGoto, setForwardingGoto] = useState('');
  const [branding, setBranding] = useState<BrandingSettings>(() => defaultBranding);
  const [brandingDraft, setBrandingDraft] = useState<BrandingSettings>(() => defaultBranding);
  const [brandingSaving, setBrandingSaving] = useState(false);
  const [brandingStatus, setBrandingStatus] = useState('');
  const [adminSettings, setAdminSettings] = useState<AdminSettingsMap>(() => defaultAdminSettings);
  const [adminSettingsSaving, setAdminSettingsSaving] = useState(false);
  const [adminSettingsStatus, setAdminSettingsStatus] = useState('');

  useEffect(() => {
    let cancelled = false;
    void fetchBranding()
      .then(settings => {
        if (cancelled) return;
        setBranding(settings);
        setBrandingDraft(settings);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    applyBrandingToDocument(branding);
  }, [branding]);

  useEffect(() => {
    if (!isAuthenticated || !isAdmin) return;
    let cancelled = false;
    void Promise.all([
      getAdminSettings('organization'),
      getAdminSettings('publicUrls'),
      getAdminSettings('security'),
      getAdminSettings('mailPolicy'),
      getAdminSettings('system'),
    ])
      .then(([organization, publicUrls, security, mailPolicy, system]) => {
        if (cancelled) return;
        setAdminSettings({ organization, publicUrls, security, mailPolicy, system });
      })
      .catch(() => {
        if (!cancelled) setAdminSettingsStatus('Admin settings could not be loaded.');
      });

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, isAdmin]);

  useEffect(() => {
    if (!isAuthenticated || !currentUsername) {
      queueMicrotask(() => {
        setSettingsHydrated(false);
        setSettingsHydratedFor('');
        setSettingsSyncError('');
      });
      if (settingsSaveTimer.current !== null) {
        window.clearTimeout(settingsSaveTimer.current);
        settingsSaveTimer.current = null;
      }
      return;
    }

    let cancelled = false;
    const migrationKey = `oms_settings_migrated_v1:${currentUsername}`;

    queueMicrotask(() => {
      if (cancelled) return;
      setSettingsHydrated(false);
      setSettingsHydratedFor('');
      setSettingsSyncError('');
    });

    const hydrateSettings = async () => {
      try {
        const [serverMail, serverAppearance, serverCalendar, serverContacts] = await Promise.all([
          getUserSettings('mail'),
          getUserSettings('appearance'),
          getUserSettings('calendar'),
          getUserSettings('contacts'),
        ]);

        const hasMigrated = localStorage.getItem(migrationKey) === 'true';
        const hasLocalSignatures = localStorage.getItem('oms_signatures') !== null;
        const hasLocalThreaded = localStorage.getItem('oms_threaded') !== null;
        const hasLocalAppearance = localStorage.getItem('oms_appearance') !== null;

        let nextMail: MailUserSettings = serverMail;
        let nextAppearance = serverAppearance;
        const nextCalendar = serverCalendar;
        const nextContacts = serverContacts;
        const migrationSaves: Promise<unknown>[] = [];

        if (!hasMigrated) {
          nextMail = {
            ...serverMail,
            signatures: hasLocalSignatures ? loadLocalSignatures() : serverMail.signatures,
            reading: {
              ...serverMail.reading,
              threaded: hasLocalThreaded ? loadLocalThreaded() : serverMail.reading.threaded,
            },
          };
          nextAppearance = hasLocalAppearance ? loadAppearancePreferences() : serverAppearance;

          if (hasLocalSignatures || hasLocalThreaded) {
            migrationSaves.push(saveUserSettings('mail', nextMail));
          }
          if (hasLocalAppearance) {
            migrationSaves.push(saveUserSettings('appearance', nextAppearance));
          }
        }

        if (cancelled) return;
        setSignatures(nextMail.signatures);
        setIsThreaded(nextMail.reading.threaded);
        setMailSettings(nextMail);
        setCalendarSettings(nextCalendar);
        setContactsSettings(nextContacts);
        setCalendarView(nextCalendar.defaultView);
        if (nextMail.identity.defaultFrom) setComposeFrom(nextMail.identity.defaultFrom);
        setAppearance(nextAppearance);

        let migrationWarning = '';
        const settingsSnapshot = buildSettingsSaveSnapshot(nextMail, nextAppearance, nextCalendar, nextContacts);
        if (!hasMigrated) {
          if (migrationSaves.length > 0) {
            try {
              await Promise.all(migrationSaves);
              localStorage.setItem(migrationKey, 'true');
              settingsSaveSnapshot.current = settingsSnapshot;
            } catch {
              migrationWarning = 'Settings loaded locally, but server sync did not complete.';
            }
          } else {
            localStorage.setItem(migrationKey, 'true');
            settingsSaveSnapshot.current = settingsSnapshot;
          }
        } else {
          settingsSaveSnapshot.current = settingsSnapshot;
        }

        if (cancelled) return;
        setSettingsHydratedFor(currentUsername);
        setSettingsHydrated(true);
        setSettingsSyncError(migrationWarning);
      } catch {
        if (cancelled) return;
        setSettingsHydrated(false);
        setSettingsHydratedFor('');
        setSettingsSyncError('Settings are saved locally until server sync is reachable.');
      }
    };

    void hydrateSettings();

    return () => {
      cancelled = true;
      if (settingsSaveTimer.current !== null) {
        window.clearTimeout(settingsSaveTimer.current);
        settingsSaveTimer.current = null;
      }
    };
  }, [isAuthenticated, currentUsername]);

  useEffect(() => {
    if (!isAuthenticated || !currentUsername || !settingsHydrated || settingsHydratedFor !== currentUsername) {
      return;
    }

    let cancelled = false;
    if (settingsSaveTimer.current !== null) {
      window.clearTimeout(settingsSaveTimer.current);
    }

    const timerId = window.setTimeout(() => {
      const nextMailSettings: MailUserSettings = {
        ...mailSettings,
        signatures,
        reading: { ...mailSettings.reading, threaded: isThreaded },
      };
      const settingsSnapshot = buildSettingsSaveSnapshot(nextMailSettings, appearance, calendarSettings, contactsSettings);

      if (settingsSaveSnapshot.current === settingsSnapshot) {
        settingsSaveTimer.current = null;
        return;
      }

      void Promise.all([
        saveUserSettings('mail', nextMailSettings),
        saveUserSettings('appearance', appearance),
        saveUserSettings('calendar', calendarSettings),
        saveUserSettings('contacts', contactsSettings),
      ])
        .then(() => {
          if (!cancelled) {
            settingsSaveSnapshot.current = settingsSnapshot;
            setSettingsSyncError('');
          }
        })
        .catch(() => {
          if (!cancelled) {
            setSettingsSyncError('Settings changes are saved locally, but not synced to the server.');
          }
        });

      settingsSaveTimer.current = null;
    }, 500);

    settingsSaveTimer.current = timerId;

    return () => {
      cancelled = true;
      if (settingsSaveTimer.current === timerId) {
        window.clearTimeout(timerId);
        settingsSaveTimer.current = null;
      }
    };
  }, [appearance, calendarSettings, contactsSettings, currentUsername, isAuthenticated, isThreaded, mailSettings, settingsHydrated, settingsHydratedFor, signatures]);

  const webmailPanelLayout = useDefaultLayout({ id: 'oms-webmail-v7', panelIds: ['webmail-sidebar', 'message-list', 'message-view'] });
  const calendarPanelLayout = useDefaultLayout({ id: 'oms-cal-v8', panelIds: ['calendar-sidebar', 'calendar-view'] });
  const contactsPanelLayout = useDefaultLayout({ id: 'oms-contacts-v8', panelIds: ['contacts-sidebar', 'contacts-view'] });

  const availableSenders = useMemo(() => {
    const candidates = [userIdentities.address, ...userIdentities.aliases, currentUsername]
      .map(address => address.trim())
      .filter(Boolean);
    return Array.from(new Set(candidates));
  }, [currentUsername, userIdentities.address, userIdentities.aliases]);

  const displayContacts = useMemo((): DisplayContact[] => {
    const formatContactName = (contact: Contact) => {
      const rawName = contact.name.trim();
      if (!rawName) return 'Unknown Name';
      if (contactsSettings.nameFormat === 'lastFirst') {
        const parts = rawName.split(/\s+/);
        if (parts.length > 1) {
          return `${parts[parts.length - 1]}, ${parts.slice(0, -1).join(' ')}`;
        }
      }
      return rawName;
    };

    const sourceContacts = contactsView === 'directory' ? directoryContacts : contacts;

    return [...sourceContacts]
      .map(contact => ({ ...contact, displayName: formatContactName(contact) }))
      .sort((a, b) => {
        const aValue = contactsSettings.sortBy === 'email' ? a.email : a.displayName;
        const bValue = contactsSettings.sortBy === 'email' ? b.email : b.displayName;
        return aValue.localeCompare(bValue, undefined, { sensitivity: 'base' });
      });
  }, [contacts, contactsSettings.nameFormat, contactsSettings.sortBy, contactsView, directoryContacts]);

  const recipientContacts = useMemo(() => {
    const seen = new Set<string>();
    const combined: Contact[] = [];
    for (const contact of [...contacts, ...directoryContacts]) {
      const email = contact.email.trim().toLowerCase();
      if (!email || seen.has(email)) continue;
      seen.add(email);
      combined.push(contact);
    }
    return combined.sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email, undefined, { sensitivity: 'base' }));
  }, [contacts, directoryContacts]);

  const contactOptionValue = (contact: Contact) => {
    const name = contact.name.trim();
    return name ? `"${name.replace(/"/g, '')}" <${contact.email}>` : contact.email;
  };

  const contactListMetrics = useMemo(() => {
    if (contactsSettings.listDensity === 'compact') return { padding: '10px 12px', avatar: 32, nameSize: '1rem' };
    if (contactsSettings.listDensity === 'comfortable') return { padding: '18px', avatar: 48, nameSize: '1.12rem' };
    return { padding: '14px', avatar: 40, nameSize: '1.06rem' };
  }, [contactsSettings.listDensity]);

  const getDefaultCalendarId = useCallback(() => {
    const configuredCalendar = calendarSettings.defaultCalendarId === null
      ? null
      : calendars.find(calendar => calendar.id === calendarSettings.defaultCalendarId);
    return configuredCalendar?.id || calendars.find(calendar => calendar.isVisible !== false)?.id || calendars[0]?.id || 1;
  }, [calendarSettings.defaultCalendarId, calendars]);

  const createDefaultEventDraft = useCallback((start: Date, isAllDay = false) => {
    const durationMinutes = Math.max(5, Math.min(480, calendarSettings.defaultEventDurationMinutes));
    const eventStart = new Date(start);
    const eventEnd = isAllDay ? addDays(eventStart, 1) : new Date(eventStart.getTime() + durationMinutes * 60 * 1000);
    return {
      title: '',
      calendarId: getDefaultCalendarId(),
      start: eventStart,
      end: eventEnd,
      isAllDay,
      timezone: calendarSettings.timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone,
      recurrence: 'none',
      guests: '',
      guestPermissions: { invite: true, seeList: true },
      location: '',
      description: '',
      notifications: [{ id: 1, type: 'notification', time: calendarSettings.defaultReminderMinutes }],
      busyStatus: 'busy',
      visibility: 'default'
    };
  }, [calendarSettings.defaultEventDurationMinutes, calendarSettings.defaultReminderMinutes, calendarSettings.timeZone, getDefaultCalendarId]);

  const navigateApp = (mode: AppMode) => {
    setAppMode(mode);
    setActiveTab(defaultTabForAppMode(mode));
    setUserMenuOpen(false);
  };

  const handleSaveBranding = async () => {
    setBrandingSaving(true);
    setBrandingStatus('');
    try {
      const saved = await saveAdminBranding(brandingDraft);
      setBranding(saved);
      setBrandingDraft(saved);
      setBrandingStatus('Branding saved.');
    } catch (err) {
      setBrandingStatus(err instanceof Error ? err.message : 'Failed to save branding.');
    } finally {
      setBrandingSaving(false);
    }
  };

  const handleResetBranding = () => {
    setBrandingDraft(defaultBranding);
    setBrandingStatus('');
  };

  const handleSaveAdminSettings = async () => {
    setAdminSettingsSaving(true);
    setAdminSettingsStatus('');
    try {
      const [organization, publicUrls, security, mailPolicy, system] = await Promise.all([
        saveAdminSettings('organization', adminSettings.organization),
        saveAdminSettings('publicUrls', adminSettings.publicUrls),
        saveAdminSettings('security', adminSettings.security),
        saveAdminSettings('mailPolicy', adminSettings.mailPolicy),
        saveAdminSettings('system', adminSettings.system),
      ]);
      setAdminSettings({ organization, publicUrls, security, mailPolicy, system });
      setAdminSettingsStatus('Admin settings saved.');
    } catch (err) {
      setAdminSettingsStatus(err instanceof Error ? err.message : 'Failed to save admin settings.');
    } finally {
      setAdminSettingsSaving(false);
    }
  };

  const refreshAdminData = useCallback(async () => {
    const [
      domains,
      mailboxes,
      aliases,
      routing,
      apiKeys,
      updates,
      spamPolicies,
      admins,
      logs
    ] = await Promise.all([
      adminFetch<AdminListResponse<AdminDomain>>('/api/admin/domains'),
      adminFetch<AdminListResponse<AdminMailbox>>('/api/admin/mailboxes'),
      adminFetch<AdminListResponse<AdminAlias>>('/api/admin/aliases'),
      adminFetch<AdminListResponse<AdminRouting>>('/api/admin/routing'),
      adminFetch<AdminListResponse<AdminApiKey>>('/api/admin/apikeys'),
      adminFetch<AdminUpdatesResponse>('/api/admin/updates'),
      adminFetch<SpamPoliciesResponse>('/api/admin/spam_policies'),
      adminFetch<AdminListResponse<AdminUser>>('/api/admin/admins'),
      adminFetch<AdminListResponse<AdminLog>>('/api/admin/logs')
    ]);

    const domainRows = domains.data || [];
    setAdminDomains(domainRows);
    setAdminMailboxes(mailboxes.data || []);
    setAdminAliases(aliases.data || []);
    setAdminRouting(routing.data || []);
    setAdminApiKeys(apiKeys.data || []);
    setAdminUpdates(updates);
    setAdminSpamPolicies(spamPolicies.rules || {
      whitelisted_senders: [],
      blacklisted_senders: [],
      banned_ips: []
    });
    setAdminAdmins(admins.data || []);
    setAdminLogs(logs.data || []);
    setRoutingTargetDomain(current => current || domainRows[0]?.domain || '');
  }, []);

  const runAdminAction = async (successMessage: string, action: () => Promise<void>) => {
    setAdminActionError('');
    setAdminActionStatus('');
    try {
      await action();
      await refreshAdminData();
      setAdminActionStatus(successMessage);
      return true;
    } catch (err) {
      setAdminActionError(err instanceof Error ? err.message : 'Admin action failed.');
      return false;
    }
  };

  const handleAddDomain = async () => {
    const domain = window.prompt('Domain name');
    if (!domain) return;
    const maxquota = window.prompt('Maximum domain quota in MB (0 for unlimited)', '0');
    if (maxquota === null) return;
    const quota = window.prompt('Default mailbox quota in MB (0 for unlimited)', '0');
    if (quota === null) return;

    await runAdminAction(`Domain ${domain.trim()} added.`, async () => {
      await adminFetch('/api/admin/domains', {
        method: 'POST',
        body: JSON.stringify({ domain, maxquota, quota })
      });
    });
  };

  const handleShowDnsRecords = async (domain: string) => {
    setAdminActionError('');
    setAdminActionStatus('Loading DNS records...');
    try {
      const data = await adminFetch<AdminListResponse<DnsRecord>>(`/api/admin/domains/${encodeURIComponent(domain)}/dns`);
      setDnsRecordsModal({ domain, records: data.data || [] });
      setAdminActionStatus('');
    } catch (err) {
      setAdminActionStatus('');
      setAdminActionError(err instanceof Error ? err.message : 'Could not load DNS records.');
    }
  };

  const handleDeleteDomain = async (domain: string) => {
    if (!window.confirm(`Delete ${domain} and all mailboxes, aliases, and routing for that domain?`)) return;
    await runAdminAction(`Domain ${domain} deleted.`, async () => {
      await adminFetch(`/api/admin/domains/${encodeURIComponent(domain)}`, { method: 'DELETE' });
    });
  };

  const handleAddRouting = async () => {
    const aliasDomain = routingAliasDomain.trim() || window.prompt('Alias domain to route');
    if (!aliasDomain) return;
    const targetDomain = routingTargetDomain || adminDomains[0]?.domain || '';
    if (!targetDomain) {
      setAdminActionError('Add a target domain before creating routing.');
      return;
    }

    await runAdminAction(`Routing added for ${aliasDomain.trim()}.`, async () => {
      await adminFetch('/api/admin/routing', {
        method: 'POST',
        body: JSON.stringify({ alias_domain: aliasDomain, target_domain: targetDomain })
      });
      setRoutingAliasDomain('');
    });
  };

  const handleDeleteRouting = async (aliasDomain: string) => {
    if (!window.confirm(`Delete routing for ${aliasDomain}?`)) return;
    await runAdminAction(`Routing for ${aliasDomain} deleted.`, async () => {
      await adminFetch(`/api/admin/routing/${encodeURIComponent(aliasDomain)}`, { method: 'DELETE' });
    });
  };

  const handleAddMailbox = async () => {
    const domain = window.prompt('Mailbox domain', adminDomains[0]?.domain || '');
    if (!domain) return;
    const username = window.prompt('Mailbox username before @');
    if (!username) return;
    const name = window.prompt('Display name', username) || '';
    const password = window.prompt('Temporary mailbox password');
    if (!password) return;
    const quota = window.prompt('Quota in MB (-1 uses the domain default, 0 is unlimited)', '-1');
    if (quota === null) return;

    await runAdminAction(`Mailbox ${username.trim()}@${domain.trim()} created.`, async () => {
      await adminFetch('/api/admin/mailboxes', {
        method: 'POST',
        body: JSON.stringify({ domain, username, name, password, quota })
      });
    });
  };

  const openMailboxEditor = (mailbox: AdminMailbox) => {
    setMailboxEditor(mailbox);
    setMailboxEditorDraft(mailboxToEditorDraft(mailbox));
    setAdminActionError('');
    setAdminActionStatus('');
  };

  const handleSaveMailboxEditor = async () => {
    if (!mailboxEditor || !mailboxEditorDraft) return;

    const saved = await runAdminAction(`Mailbox ${mailboxEditor.username} updated.`, async () => {
      await adminFetch(`/api/admin/mailboxes/${encodeURIComponent(mailboxEditor.username)}`, {
        method: 'PUT',
        body: JSON.stringify({
          username: mailboxEditor.username,
          name: mailboxEditorDraft.name,
          quota: mailboxEditorDraft.quota,
          phone: mailboxEditorDraft.phone,
          email_other: mailboxEditorDraft.alternateEmail,
          company: mailboxEditorDraft.company,
          job_title: mailboxEditorDraft.jobTitle,
          street_address: mailboxEditorDraft.streetAddress,
          city: mailboxEditorDraft.city,
          region: mailboxEditorDraft.region,
          postal_code: mailboxEditorDraft.postalCode,
          country: mailboxEditorDraft.country,
          notes: mailboxEditorDraft.notes,
          show_in_directory: mailboxEditorDraft.showInDirectory ? 1 : 0,
          active: mailboxEditor.active ?? 1
        })
      });
    });
    if (saved) {
      setMailboxEditor(null);
      setMailboxEditorDraft(null);
    }
  };

  const handleResetMailboxPassword = async (username: string) => {
    const password = window.prompt(`New password for ${username}`);
    if (!password) return;
    await runAdminAction(`Password reset for ${username}.`, async () => {
      await adminFetch(`/api/admin/mailboxes/${encodeURIComponent(username)}/password`, {
        method: 'POST',
        body: JSON.stringify({ password })
      });
    });
  };

  const handleToggleMailboxActive = async (mailbox: AdminMailbox) => {
    const nextActive = mailbox.active === 0 ? 1 : 0;
    const verb = nextActive === 1 ? 'activate' : 'suspend';
    if (!window.confirm(`Really ${verb} ${mailbox.username}?`)) return;

    await runAdminAction(`Mailbox ${mailbox.username} ${nextActive === 1 ? 'activated' : 'suspended'}.`, async () => {
      await adminFetch(`/api/admin/mailboxes/${encodeURIComponent(mailbox.username)}`, {
        method: 'PUT',
        body: JSON.stringify({
          username: mailbox.username,
          name: mailbox.name || '',
          quota: quotaBytesToMbInput(mailbox.quota),
          active: nextActive
        })
      });
    });
  };

  const handleDeleteMailbox = async (username: string) => {
    if (!window.confirm(`Delete mailbox ${username}? This does not preserve the mailbox record.`)) return;
    await runAdminAction(`Mailbox ${username} deleted.`, async () => {
      await adminFetch(`/api/admin/mailboxes/${encodeURIComponent(username)}`, { method: 'DELETE' });
    });
  };

  const handleAddAlias = async () => {
    const domain = window.prompt('Alias domain', adminDomains[0]?.domain || '');
    if (!domain) return;
    const address = window.prompt('Alias address (sales, sales@example.com, or @example.com)');
    if (!address) return;
    const goto = window.prompt('Target addresses, comma-separated');
    if (!goto) return;

    await runAdminAction(`Alias ${address.trim()} added.`, async () => {
      await adminFetch('/api/admin/aliases', {
        method: 'POST',
        body: JSON.stringify({ domain, address, goto })
      });
    });
  };

  const openAliasEditor = (alias: AdminAlias) => {
    setAliasEditor(alias);
    setAliasEditorAddress(alias.address);
    setAliasEditorMembers(dedupeEmails(splitAliasTargets(alias.goto)));
    setSelectedAliasMembers([]);
    setAliasNewMember('');
    setAdminActionError('');
    setAdminActionStatus('');
  };

  const toggleAliasMemberSelection = (member: string) => {
    setSelectedAliasMembers(current => (
      current.includes(member)
        ? current.filter(candidate => candidate !== member)
        : [...current, member]
    ));
  };

  const addAliasMember = () => {
    const member = aliasNewMember.trim().toLowerCase();
    if (!member) return;
    setAliasEditorMembers(current => dedupeEmails([...current, member]));
    setSelectedAliasMembers(current => current.filter(candidate => candidate !== member));
    setAliasNewMember('');
  };

  const removeSelectedAliasMembers = () => {
    setAliasEditorMembers(current => current.filter(member => !selectedAliasMembers.includes(member)));
    setSelectedAliasMembers([]);
  };

  const handleSaveAliasEditor = async () => {
    if (!aliasEditor) return;
    if (aliasEditorMembers.length === 0) {
      setAdminActionError('Alias groups need at least one target.');
      return;
    }

    const saved = await runAdminAction(`Alias ${aliasEditor.address} updated.`, async () => {
      await adminFetch(`/api/admin/aliases/${encodeURIComponent(aliasEditor.address)}`, {
        method: 'PUT',
        body: JSON.stringify({
          address: aliasEditorAddress,
          goto: aliasEditorMembers.join(','),
          domain: aliasEditor.domain
        })
      });
    });
    if (saved) {
      setAliasEditor(null);
    }
  };

  const handleDeleteAlias = async (address: string) => {
    if (!window.confirm(`Delete alias ${address}?`)) return;
    await runAdminAction(`Alias ${address} deleted.`, async () => {
      await adminFetch(`/api/admin/aliases/${encodeURIComponent(address)}`, { method: 'DELETE' });
    });
  };

  const handlePromoteAdmin = async () => {
    const username = window.prompt('Full mailbox address to promote');
    if (!username) return;
    await runAdminAction(`${username.trim()} promoted to admin.`, async () => {
      await adminFetch('/api/admin/admins', {
        method: 'POST',
        body: JSON.stringify({ username })
      });
    });
  };

  const handleDemoteAdmin = async (username: string) => {
    if (!window.confirm(`Revoke admin privileges for ${username}?`)) return;
    await runAdminAction(`${username} demoted.`, async () => {
      await adminFetch(`/api/admin/admins/${encodeURIComponent(username)}`, { method: 'DELETE' });
    });
  };

  const handleCreateApiKey = async () => {
    const description = window.prompt('API key description');
    if (!description) return;
    await runAdminAction('API key generated.', async () => {
      const response = await adminFetch<AdminApiKeyCreateResponse>('/api/admin/apikeys', {
        method: 'POST',
        body: JSON.stringify({ description })
      });
      if (response.raw_key) {
        window.alert(`Your new API key is: ${response.raw_key}\n\nCopy this now. It will not be shown again.`);
      }
    });
  };

  const handleDeleteApiKey = async (id: number | string) => {
    if (!window.confirm('Revoke this API key?')) return;
    await runAdminAction('API key revoked.', async () => {
      await adminFetch(`/api/admin/apikeys/${encodeURIComponent(String(id))}`, { method: 'DELETE' });
    });
  };

  const handleSaveSpamPolicies = async () => {
    if (!adminSpamPolicies) return;
    setSaving(true);
    try {
      await runAdminAction('Spam policies saved.', async () => {
        await adminFetch('/api/admin/spam_policies', {
          method: 'POST',
          body: JSON.stringify({ rules: adminSpamPolicies })
        });
      });
    } finally {
      setSaving(false);
    }
  };

  const handleUpdateSignatures = (nextSignatures: Signature[]) => {
    setSignatures(nextSignatures);
    setMailSettings(current => ({ ...current, signatures: nextSignatures }));
  };

  const handleAddSignature = () => {
    const isFirstSignature = signatures.length === 0;
    handleUpdateSignatures([
      ...signatures,
      {
        id: Math.random().toString(36).substr(2, 9),
        name: 'New Signature',
        content: '',
        isDefault: isFirstSignature,
        defaultForNew: isFirstSignature,
        defaultForReply: isFirstSignature
      }
    ]);
  };

  const handleMailSettingsChange = (nextSettings: MailUserSettings) => {
    setMailSettings(nextSettings);
    setIsThreaded(nextSettings.reading.threaded);
    setSignatures(nextSettings.signatures);
    if (!isComposing && nextSettings.identity.defaultFrom) {
      setComposeFrom(nextSettings.identity.defaultFrom);
    }
  };

  const handleCalendarSettingsChange = (nextSettings: CalendarUserSettings) => {
    setCalendarSettings(nextSettings);
    setCalendarView(nextSettings.defaultView);
  };

  const toggleFolder = (folderPath: string) => {
    setExpandedFolders(prev => ({ ...prev, [folderPath]: !prev[folderPath] }));
  };

  const handleFolderSelect = (folderPath: string) => {
    setActiveFolder(folderPath);
    setMessages([]);
    setMailLowestUid(null);
    setMailMoreAvailable(false);
    setSelectedMessages([]);
    setViewingThread(null);
    setIsSearchActive(false);
    setSearchQuery('');
    setSearchError('');
    setSearchInfo('');
  };

  useEffect(() => {
    fetch('/api/auth/me', { credentials: 'include' })
      .then(res => res.ok ? res.json() : Promise.reject())
      .then(data => {
        if (data.success) {
          setIsAuthenticated(true);
          setIsAdmin(!!data.user?.isAdmin);
          setCurrentUsername(data.user?.username || '');
        }
      })
      .catch(() => {
        setIsAuthenticated(false);
        setIsAdmin(false);
        setCurrentUsername('');
      })
      .finally(() => setAuthChecked(true));
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      fetch(`/api/rules`, { headers: getHeaders() }).then(res => res.json())
        .then(data => { if (data.rules) setRules(data.rules); setLoading(false); })
        .catch(() => setLoading(false));
      fetch(`/api/folders`, { headers: getHeaders() }).then(res => res.json())
        .then(data => setFolders(data.folders || []));
      fetch(`/api/settings/forwarding`, { headers: getHeaders() }).then(res => res.json())
        .then(data => { if (data.success) setForwardingGoto(data.goto); });
      fetch(`/api/user/identities`, { headers: getHeaders() }).then(res => res.json())
        .then(data => { 
          if (data.success) {
            setUserIdentities(data);
            setComposeFrom(data.address);
          }
        });
    }
  }, [isAuthenticated]);

  const refreshFolders = useCallback(() => {
    return fetch(`/api/folders`, { headers: getHeaders() })
      .then(res => res.json())
      .then(data => setFolders(data.folders || []));
  }, []);

  const refreshSearchIndexStatus = useCallback(() => {
    return fetch('/api/messages/search/index/status', { headers: getHeaders() })
      .then(res => res.json())
      .then((data: SearchIndexStatusResponse) => {
        if (data.success) setSearchIndexStatus(data);
      })
      .catch(() => undefined);
  }, []);

  const refreshSavedSearches = useCallback(() => {
    return fetch('/api/messages/search/saved', { headers: getHeaders() })
      .then(res => res.json())
      .then((data: SavedSearchesResponse) => {
        if (data.success) setSavedSearches(data.savedSearches || []);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      void refreshSearchIndexStatus();
      void refreshSavedSearches();
    }
  }, [isAuthenticated, refreshSearchIndexStatus, refreshSavedSearches]);

  const updateFolderUnread = useCallback((folderPath: string, delta: number) => {
    if (delta === 0) return;
    setFolders(prev => prev.map(folder => (
      folder.path === folderPath
        ? { ...folder, unseen: Math.max(0, folder.unseen + delta) }
        : folder
    )));
  }, []);

  const updateMessageFlags = useCallback((folderPath: string, uids: number[], updates: Partial<Pick<Message, 'isRead' | 'isStarred'>>) => {
    setMessages(prev => prev.map(message => (
      (message.folder || activeFolder) === folderPath && uids.includes(message.uid)
        ? { ...message, ...updates }
        : message
    )));
    setViewingThread(prev => prev ? prev.map(message => (
      (message.folder || activeFolder) === folderPath && uids.includes(message.uid)
        ? { ...message, ...updates }
        : message
    )) : prev);
  }, [activeFolder]);

  const applyMessageListPage = useCallback((data: MessageListResponse, mode: 'replace' | 'append') => {
    if (!data.success) return;
    const pageMessages = data.messages || [];
    setMessages(prev => {
      if (mode === 'replace') return pageMessages;
      const existing = new Set(prev.map(message => `${message.folder || activeFolder}:${message.uid}`));
      const additions = pageMessages.filter(message => !existing.has(`${message.folder || activeFolder}:${message.uid}`));
      return [...prev, ...additions];
    });
    setMailLowestUid(typeof data.lowestUid === 'number' && data.lowestUid > 0 ? data.lowestUid : null);
    setMailMoreAvailable(!!data.moreAvailable);
  }, [activeFolder]);

  const fetchMessages = useCallback(() => {
    if (!isAuthenticated || !activeFolder) return Promise.resolve();
    setMailLoading(true);
    return fetch(`/api/folders/${encodeURIComponent(activeFolder)}/messages`, { headers: getHeaders() })
      .then(res => res.json())
      .then((data: MessageListResponse) => applyMessageListPage(data, 'replace'))
      .finally(() => setMailLoading(false));
  }, [isAuthenticated, activeFolder, applyMessageListPage]);

  useEffect(() => {
    if (isAuthenticated && activeFolder && !isSearchActive) {
      let cancelled = false;
      fetch(`/api/folders/${encodeURIComponent(activeFolder)}/messages`, { headers: getHeaders() })
        .then(res => res.json())
        .then((data: MessageListResponse) => {
          if (!cancelled) applyMessageListPage(data, 'replace');
        })
        .catch(() => undefined);

      const evtSource = new EventSource(`/api/events?folder=${encodeURIComponent(activeFolder)}`, { withCredentials: true });
      evtSource.onmessage = (event) => {
        if (event.data === 'ping') return;
        try {
          const data = JSON.parse(event.data) as { type?: string };
          if (data.type === 'newMessage' || data.type === 'flagsUpdate') {
            fetchMessages();
          }
        } catch {
          return;
        }
      };

      return () => {
        cancelled = true;
        evtSource.close();
      };
    }
  }, [isAuthenticated, activeFolder, isSearchActive, fetchMessages, applyMessageListPage]);

  useEffect(() => {
    if (!isAuthenticated || !activeFolder) return;
    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        const res = await fetch('/api/messages/search/index/sync', {
          method: 'POST',
          headers: getHeaders(),
          body: JSON.stringify({ scope: 'folder', folder: activeFolder, limit: 75 })
        });
        const data = await res.json() as SearchIndexRefreshResponse;
        if (!cancelled && data.success && (data.indexed || 0) > 0) {
          void refreshSearchIndexStatus();
        }
      } catch (err) {
        console.error(err);
      }
    }, 1200);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [isAuthenticated, activeFolder, refreshSearchIndexStatus]);

  const executeSearch = async (
    queryInput = searchQuery,
    fieldInput = searchField,
    scopeInput = searchScope,
    folderInput = activeFolder
  ) => {
    const query = queryInput.trim();
    const isFlagOnlySearch = fieldInput === 'unread' || fieldInput === 'starred';
    setSearchError('');
    setSearchInfo('');

    if (query.length === 0 && !isFlagOnlySearch) {
      setIsSearchActive(false);
      setSelectedMessages([]);
      setViewingThread(null);
      void fetchMessages();
      return;
    }

    if (query.length < 2 && !isFlagOnlySearch) {
      setSearchError('Search query must be at least 2 characters.');
      return;
    }

    setSearchLoading(true);
    setSelectedMessages([]);
    setViewingThread(null);

    const params = new URLSearchParams({
      q: query,
      field: fieldInput,
      scope: scopeInput,
      folder: folderInput,
      limit: '50'
    });

    try {
      const res = await fetch(`/api/messages/search?${params.toString()}`, { headers: getHeaders() });
      const data = await res.json() as SearchResponse;
      if (data.success) {
        setMessages(data.messages || []);
        setMailLowestUid(null);
        setMailMoreAvailable(false);
        setIsSearchActive(true);
        setSearchInfo(data.source === 'imap' ? 'Mailbox search' : 'Indexed search');
        void refreshSearchIndexStatus();
      } else {
        setSearchError(data.error || 'Search failed.');
      }
    } catch (err) {
      console.error(err);
      setSearchError('Search failed.');
    } finally {
      setSearchLoading(false);
    }
  };

  const handleSearch = async (event?: React.FormEvent) => {
    event?.preventDefault();
    await executeSearch();
  };

  const handleClearSearch = () => {
    setSearchQuery('');
    setSearchError('');
    setSearchInfo('');
    setIsSearchActive(false);
    setSelectedMessages([]);
    setViewingThread(null);
    void fetchMessages();
  };

  const handleLoadOlderMessages = async () => {
    if (!activeFolder || !mailLowestUid || !mailMoreAvailable || loadingOlderMessages || isSearchActive) return;
    setLoadingOlderMessages(true);
    setSearchError('');

    try {
      const res = await fetch(`/api/folders/${encodeURIComponent(activeFolder)}/messages?olderThan=${mailLowestUid}`, { headers: getHeaders() });
      const data = await res.json() as MessageListResponse;
      if (data.success) {
        applyMessageListPage(data, 'append');
      } else {
        setSearchError(data.error || 'Could not load older messages.');
      }
    } catch (err) {
      console.error(err);
      setSearchError('Could not load older messages.');
    } finally {
      setLoadingOlderMessages(false);
    }
  };

  const handleUpdateSearchIndex = async () => {
    setIndexLoading(true);
    setSearchError('');
    setSearchInfo('');

    try {
      const res = await fetch('/api/messages/search/index', {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({
          scope: searchScope,
          folder: activeFolder,
          limit: searchScope === 'all' ? 50 : 200
        })
      });
      const data = await res.json() as SearchIndexRefreshResponse;
      if (data.success) {
        setSearchInfo(`Indexed ${data.indexed || 0} message${data.indexed === 1 ? '' : 's'}`);
        await refreshSearchIndexStatus();
        if (isSearchActive) {
          await handleSearch();
        }
      } else {
        setSearchError(data.error || 'Index update failed.');
      }
    } catch (err) {
      console.error(err);
      setSearchError('Index update failed.');
    } finally {
      setIndexLoading(false);
    }
  };

  const handleSaveCurrentSearch = async () => {
    const query = searchQuery.trim();
    const isFlagOnlySearch = searchField === 'unread' || searchField === 'starred';
    if (query.length < 2 && !isFlagOnlySearch) {
      setSearchError('Search query must be at least 2 characters.');
      return;
    }

    const defaultName = query || (searchField === 'unread' ? 'Unread' : searchField === 'starred' ? 'Starred' : searchField);
    const name = window.prompt('Save search as', defaultName);
    if (!name || !name.trim()) return;

    try {
      const res = await fetch('/api/messages/search/saved', {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({
          name: name.trim(),
          query,
          field: searchField,
          scope: searchScope,
          folder: activeFolder
        })
      });
      const data = await res.json() as SavedSearchResponse;
      const savedSearch = data.savedSearch;
      if (data.success && savedSearch) {
        setSavedSearches(prev => [savedSearch, ...prev.filter(saved => saved.id !== savedSearch.id)]);
        setSearchInfo('Search saved');
      } else {
        setSearchError(data.error || 'Save search failed.');
      }
    } catch (err) {
      console.error(err);
      setSearchError('Save search failed.');
    }
  };

  const handleApplySavedSearch = async (savedSearch: SavedSearch) => {
    setSearchQuery(savedSearch.query);
    setSearchField(savedSearch.field);
    setSearchScope(savedSearch.scope);
    if (savedSearch.scope === 'folder' && savedSearch.folder) {
      setActiveFolder(savedSearch.folder);
    }
    await executeSearch(savedSearch.query, savedSearch.field, savedSearch.scope, savedSearch.folder || activeFolder);
  };

  const handleDeleteSavedSearch = async (savedSearch: SavedSearch, event: React.MouseEvent) => {
    event.stopPropagation();
    try {
      const res = await fetch(`/api/messages/search/saved/${savedSearch.id}`, {
        method: 'DELETE',
        headers: getHeaders()
      });
      const data = await res.json() as { success: boolean; error?: string };
      if (data.success) {
        setSavedSearches(prev => prev.filter(saved => saved.id !== savedSearch.id));
      } else {
        setSearchError(data.error || 'Delete saved search failed.');
      }
    } catch (err) {
      console.error(err);
      setSearchError('Delete saved search failed.');
    }
  };

  const loadMessage = async (uidOrUids: number | number[], folderPath = activeFolder) => {
    const uids = Array.isArray(uidOrUids) ? uidOrUids : [uidOrUids];
    const fetches = uids.map(uid => 
      fetch(`/api/folders/${encodeURIComponent(folderPath)}/messages/${uid}`, { headers: getHeaders() }).then(res => res.json() as Promise<MessageResponse>)
    );
    const results = await Promise.all(fetches);
    const threadMsgs = results.filter(r => r.success).map(r => ({ ...r.message, folder: folderPath }));
    threadMsgs.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
    setViewingThread(threadMsgs.length > 0 ? threadMsgs : null);

    const unreadUids = threadMsgs.filter(message => !message.isRead).map(message => message.uid);
    if (unreadUids.length > 0) {
      updateMessageFlags(folderPath, unreadUids, { isRead: true });
      updateFolderUnread(folderPath, -unreadUids.length);
      try {
        await fetch('/api/messages/action', {
          method: 'POST',
          headers: getHeaders(),
          body: JSON.stringify({ folder: folderPath, uids: unreadUids, action: 'read' })
        });
        void refreshFolders();
      } catch (err) {
        console.error(err);
        void refreshFolders();
      }
    }
  };

  const handleSend = () => {
    setSending(true);
    
    const formData = new FormData();
    formData.append('from', composeFrom);
    formData.append('to', composeTo);
    if (composeCc) formData.append('cc', composeCc);
    if (composeBcc) formData.append('bcc', composeBcc);
    if (mailSettings.identity.replyTo) formData.append('replyTo', mailSettings.identity.replyTo);
    formData.append('subject', composeSubject);
    formData.append('html', composeBody);
    if (draftUid) formData.append('draftUid', draftUid);
    
    composeAttachments.forEach(file => {
      formData.append('attachments', file);
    });
    
    const headers = new Headers(getHeaders());
    headers.delete('Content-Type');

    fetch('/api/messages/send', {
      method: 'POST',
      headers,
      body: formData
    })
    .then(res => res.json())
    .then(data => {
      setSending(false);
      if (data.success) {
        setIsComposing(false);
        setDraftUid(null);
      } else {
        alert('Failed to send: ' + data.error);
      }
    })
    .catch((err: unknown) => {
      console.error(err);
      setSending(false);
      alert('Error sending email');
    });
  };

  const handleMessageMove = async (uids: number[], targetFolder: string) => {
    if (uids.length === 0 || targetFolder === activeFolder) return;
    const sourceFolder = activeFolder;
    try {
      const res = await fetch('/api/messages/action', {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({ folder: sourceFolder, uids, action: 'move', targetFolder })
      });
      const data = await res.json() as MessageActionResponse;
      if (data.success) {
        setMessages(messages.filter(m => !uids.includes(m.uid)));
        setSelectedMessages(selectedMessages.filter(uid => !uids.includes(uid)));
        if (viewingThread && viewingThread.some(t => uids.includes(t.uid))) {
           setViewingThread(null);
        }
        showMailUndo(`Moved ${uids.length} message${uids.length === 1 ? '' : 's'} to ${data.targetFolder || targetFolder}.`, sourceFolder, data.targetFolder || targetFolder, data.undoUids || []);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const showMailUndo = (label: string, sourceFolder: string, targetFolder: string, uids: number[]) => {
    if (mailUndoTimer.current) {
      window.clearTimeout(mailUndoTimer.current);
    }
    if (uids.length === 0) {
      setMailUndo(null);
      return;
    }
    setMailUndo({ label, sourceFolder, targetFolder, uids });
    mailUndoTimer.current = window.setTimeout(() => setMailUndo(null), 8000);
  };

  const handleUndoMailAction = async () => {
    if (!mailUndo) return;
    const undo = mailUndo;
    setMailUndo(null);
    if (mailUndoTimer.current) {
      window.clearTimeout(mailUndoTimer.current);
      mailUndoTimer.current = null;
    }
    try {
      const res = await fetch('/api/messages/action', {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({
          folder: undo.targetFolder,
          uids: undo.uids,
          action: 'move',
          targetFolder: undo.sourceFolder
        })
      });
      const data = await res.json() as MessageActionResponse;
      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Undo failed.');
      }
      await refreshFolders();
      if (!isSearchActive) {
        await fetchMessages();
      } else {
        await executeSearch();
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Undo failed.');
    }
  };

  const handleMessageAction = async (action: 'delete' | 'archive' | 'spam' | 'read' | 'unread' | 'star' | 'unstar') => {
    if (selectedMessages.length === 0) return;
    const affectedMessages = messages.filter(message => selectedMessages.includes(message.uid));
    const actionUids = [...selectedMessages];
    const sourceFolder = activeFolder;
    
    try {
      const res = await fetch('/api/messages/action', {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({
          folder: sourceFolder,
          uids: actionUids,
          action
        })
      });
      const data = await res.json() as MessageActionResponse;
      if (data.success) {
        if (action === 'delete' || action === 'archive' || action === 'spam') {
          setMessages(messages.filter(m => !actionUids.includes(m.uid)));
          setSelectedMessages([]);
          if (viewingThread && actionUids.some(uid => viewingThread.some(m => m.uid === uid))) {
              setViewingThread(null);
          }
          const label = action === 'delete' ? 'Moved to Trash' : action === 'archive' ? 'Archived' : 'Moved to Junk';
          showMailUndo(`${label} ${actionUids.length} message${actionUids.length === 1 ? '' : 's'}.`, sourceFolder, data.targetFolder || '', data.undoUids || []);
        } else if (action === 'read' || action === 'unread') {
          const nextRead = action === 'read';
          const unreadDelta = affectedMessages.filter(message => !!message.isRead !== nextRead).length * (nextRead ? -1 : 1);
          updateMessageFlags(sourceFolder, actionUids, { isRead: nextRead });
          updateFolderUnread(sourceFolder, unreadDelta);
          void refreshFolders();
        } else if (action === 'star' || action === 'unstar') {
          updateMessageFlags(sourceFolder, actionUids, { isStarred: action === 'star' });
        }
      } else {
        alert('Failed to move messages: ' + data.error);
      }
    } catch (err) {
      console.error(err);
      alert('Error communicating with server');
    }
  };

  const handleToggleStar = async (message: Message, event: React.MouseEvent) => {
    event.stopPropagation();
    const folderPath = message.folder || activeFolder;
    const nextStarred = !message.isStarred;
    updateMessageFlags(folderPath, [message.uid], { isStarred: nextStarred });

    try {
      const res = await fetch('/api/messages/action', {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({
          folder: folderPath,
          uids: [message.uid],
          action: nextStarred ? 'star' : 'unstar'
        })
      });
      const data = await res.json();
      if (!data.success) {
        updateMessageFlags(folderPath, [message.uid], { isStarred: !nextStarred });
      }
    } catch (err) {
      console.error(err);
      updateMessageFlags(folderPath, [message.uid], { isStarred: !nextStarred });
    }
  };

  useEffect(() => {
    mailKeyboardAction.current = handleMessageAction;
  });

  useEffect(() => {
    if (appMode !== 'webmail' || isComposing) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target) || event.metaKey || event.ctrlKey || event.altKey) return;
      if (selectedMessages.length === 0 || !canBulkAct) return;

      const key = event.key.toLowerCase();
      if (key === 'delete' || key === 'backspace') {
        event.preventDefault();
        void mailKeyboardAction.current?.('delete');
      } else if (key === 'e') {
        event.preventDefault();
        void mailKeyboardAction.current?.('archive');
      } else if (key === 'u') {
        event.preventDefault();
        void mailKeyboardAction.current?.('unread');
      } else if (key === 's') {
        event.preventDefault();
        void mailKeyboardAction.current?.('star');
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [appMode, canBulkAct, isComposing, selectedMessages.length]);

  const buildSignatureHtml = (signature?: Signature) => (
    signature
      ? '<br><br>' + signature.content.replace(/\n/g, '<br>') + '<br>' + (userIdentities.name || 'OpenMailStack User')
      : ''
  );

  const getPreferredComposeFrom = () => mailSettings.identity.defaultFrom || userIdentities.address || currentUsername;

  const handleReply = (type: 'reply' | 'replyAll' | 'forward', msgToReply?: Message) => {
    const targetMsg = msgToReply || (viewingThread && viewingThread[viewingThread.length - 1]);
    if (!targetMsg) return;
    setIsComposing(true);
    setDraftUid(null);
    setComposeFrom(getPreferredComposeFrom());
    setComposeCc(type === 'replyAll' ? targetMsg.cc || '' : '');
    const selfBcc = mailSettings.identity.alwaysBccSelf ? userIdentities.address || currentUsername : '';
    setComposeBcc(selfBcc);
    setShowBcc(!!selfBcc);
    setShowCc(type === 'replyAll' && !!targetMsg.cc);
    setComposeAttachments([]);
    
    let subject = targetMsg.subject || '';
    if (type === 'reply' || type === 'replyAll') {
      subject = subject.toLowerCase().startsWith('re:') ? subject : `Re: ${subject}`;
      setComposeTo(targetMsg.from);
    } else {
      subject = subject.toLowerCase().startsWith('fwd:') ? subject : `Fwd: ${subject}`;
      setComposeTo('');
    }
    
    setComposeSubject(subject);
    
    const dateStr = new Date(targetMsg.date).toLocaleString();
    const quotedHtml = targetMsg.html
      ? `<br><br><br><div>On ${dateStr}, ${targetMsg.from} wrote:</div><blockquote style="margin:0 0 0 .8ex;border-left:1px #ccc solid;padding-left:1ex">${targetMsg.html}</blockquote>`
      : `<br><br><br><div>On ${dateStr}, ${targetMsg.from} wrote:</div><blockquote style="margin:0 0 0 .8ex;border-left:1px #ccc solid;padding-left:1ex"><pre>${targetMsg.text || ''}</pre></blockquote>`;
    
    const defaultSig = signatures.find(s => s.defaultForReply) || signatures.find(s => s.isDefault);
    setComposeSignature(defaultSig?.id || 'none');
    setComposeBody(buildSignatureHtml(defaultSig) + quotedHtml);
  };

  const handleCompose = () => {
    const selfBcc = mailSettings.identity.alwaysBccSelf ? userIdentities.address || currentUsername : '';
    setComposeFrom(getPreferredComposeFrom());
    setComposeTo('');
    setComposeCc('');
    setComposeBcc(selfBcc);
    setComposeSubject('');
    setShowCc(false);
    setShowBcc(!!selfBcc);
    const defaultSig = signatures.find(s => s.defaultForNew) || signatures.find(s => s.isDefault);
    if (defaultSig) {
      setComposeSignature(defaultSig.id);
      setComposeBody(buildSignatureHtml(defaultSig));
    } else {
      setComposeSignature('none');
      setComposeBody('');
    }
    setComposeAttachments([]);
    setDraftUid(null);
    setIsComposing(true);
  };

  useEffect(() => {
    if (!isComposing || (!composeTo && !composeSubject && !composeBody)) return;
    const timeout = setTimeout(() => {
      const formData = new FormData();
      formData.append('from', composeFrom);
      formData.append('to', composeTo);
      if (composeCc) formData.append('cc', composeCc);
      if (composeBcc) formData.append('bcc', composeBcc);
      if (mailSettings.identity.replyTo) formData.append('replyTo', mailSettings.identity.replyTo);
      formData.append('subject', composeSubject);
      formData.append('html', composeBody);
      if (draftUid) formData.append('draftUid', draftUid);
      
      composeAttachments.forEach(file => {
        formData.append('attachments', file);
      });
      
      const headers = new Headers(getHeaders());
      headers.delete('Content-Type');

      fetch('/api/messages/draft', {
        method: 'POST',
        headers,
        body: formData
      })
      .then(res => res.json())
      .then(data => {
        if (data.success && data.draftUid) {
          setDraftUid(data.draftUid.toString());
        }
      }).catch(() => {
        return;
      });
    }, 5000); // Save draft after 5 seconds of inactivity
    return () => clearTimeout(timeout);
  }, [composeFrom, composeTo, composeCc, composeBcc, composeSubject, composeBody, composeAttachments, draftUid, isComposing, mailSettings.identity.replyTo]);

  const refreshContacts = useCallback(() => {
    return fetch(`/api/apps/contacts`, { headers: getHeaders() })
      .then(r => r.json() as Promise<ContactsResponse>)
      .then(d => d.success && setContacts(d.contacts || []));
  }, []);

  const refreshDirectoryContacts = useCallback(() => {
    return fetch(`/api/directory`, { headers: getHeaders() })
      .then(r => r.json() as Promise<ContactsResponse>)
      .then(d => d.success && setDirectoryContacts(d.contacts || []));
  }, []);

  const handleAddDirectoryContact = async (contact: Contact) => {
    setContactsActionError('');
    setContactsActionStatus('');
    try {
      const response = await fetch('/api/contacts', {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({
          name: contact.name || contact.email,
          email: contact.email,
          phone: contact.phone || ''
        })
      });
      const data = await response.json() as ContactsResponse;
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Could not save contact.');
      }
      await refreshContacts();
      setContactsActionStatus(`${contact.name || contact.email} saved to Personal Contacts.`);
    } catch (err) {
      setContactsActionError(err instanceof Error ? err.message : 'Could not save contact.');
    }
  };

  const refreshCalendars = useCallback(() => {
    return fetch(`/api/apps/calendars`, { headers: getHeaders() }).then(r => r.json() as Promise<CalendarsResponse>).then(d => {
      if (d.success && d.calendars) {
          const normalizedCalendars = d.calendars.map((c): Calendar => ({
            ...c,
            events: (c.events || []).map((e): CalendarEvent => ({
              ...e,
              start: new Date(e.start),
              end: new Date(e.end)
            })),
            isVisible: true
          }));
          setCalendars(normalizedCalendars);
          setEvents(normalizedCalendars.flatMap((c) => c.events));
      }
    });
  }, []);

  const refreshCurrentView = async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    try {
      if (appMode === 'webmail') {
        await refreshFolders();
        if (isSearchActive) {
          await executeSearch();
        } else {
          await fetchMessages();
        }
      } else if (appMode === 'calendar') {
        await refreshCalendars();
      } else if (appMode === 'contacts') {
        await Promise.all([refreshContacts(), refreshDirectoryContacts()]);
      } else if (appMode === 'sync') {
        await Promise.all([refreshCalendars(), refreshContacts()]);
      }
    } finally {
      setIsRefreshing(false);
    }
  };

  useEffect(() => {
    if (isAdmin && isAuthenticated) {
      void Promise.resolve()
        .then(() => refreshAdminData())
        .catch((err) => {
          setAdminActionError(err instanceof Error ? err.message : 'Could not load admin data.');
        });
    }
    if (isAuthenticated) {
      refreshContacts();
      refreshDirectoryContacts();
      refreshCalendars();
    }
  }, [isAdmin, isAuthenticated, refreshAdminData, refreshContacts, refreshDirectoryContacts, refreshCalendars]);

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');
    fetch(`/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ username: loginUsername, password: loginPassword })
    })
    .then(res => res.json())
    .then(d => {
      if (d.success) {
        setIsAuthenticated(true);
        setIsAdmin(d.isAdmin);
        setCurrentUsername(d.username);
        localStorage.removeItem('oms_token');
        localStorage.removeItem('oms_isAdmin');
        localStorage.removeItem('oms_username');
      } else {
        setLoginError(d.error || 'Login failed');
      }
    })
    .catch(() => setLoginError('Network error'));
  };

  const handleSave = () => {
    setSaving(true);
    fetch(`/api/rules`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ rules })
    })
    .then(res => res.json())
    .then(() => {
      setSaving(false);
    })
    .catch(() => setSaving(false));
  };

  const handleSaveForwarding = () => {
    setSaving(true);
    fetch(`/api/settings/forwarding`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ goto: forwardingGoto })
    })
    .then(() => setSaving(false))
    .catch(() => setSaving(false));
  };

  const addRule = () => {
    const newRule: Rule = {
      id: Math.random().toString(36).substr(2, 9),
      name: 'New Filter Rule',
      condition: 'any',
      criteria: [{ id: Math.random().toString(36), field: 'subject', operator: 'contains', value: '' }],
      actions: [{ id: Math.random().toString(36), type: 'move', folder: folders[0]?.path || 'INBOX' }]
    };
    setRules([newRule, ...rules]);
  };

  const deleteRule = (id: string) => {
    setRules(rules.filter(r => r.id !== id));
  };

  const updateRule = (id: string, updates: Partial<Rule>) => {
    setRules(rules.map(r => r.id === id ? { ...r, ...updates } : r));
  };

  const normalizedSubject = (subj: string) => subj.replace(/^(Re|Fwd|Fw|Aw):\s*/i, '').trim();

  const displayMessages = useMemo(() => {
    if (!isThreaded) return messages;
    
    const threadMap = new Map<string, typeof messages>();
    messages.forEach(msg => {
      const folderKey = msg.folder || activeFolder;
      const norm = normalizedSubject(msg.subject || '');
      const threadKey = `${folderKey}\u0000${norm}`;
      if (!threadMap.has(threadKey)) {
        threadMap.set(threadKey, []);
      }
      threadMap.get(threadKey)!.push(msg);
    });

    return Array.from(threadMap.values()).map(thread => {
      thread.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
      const representative = thread[0];
      return { ...representative, threadCount: thread.length, threadUids: thread.map(t => t.uid) };
    });
  }, [messages, isThreaded, activeFolder]);

  const fieldOnlySearchLabels: Record<SearchField, string> = {
    all: 'mail',
    from: 'senders',
    to: 'recipients',
    subject: 'subjects',
    body: 'message body',
    attachments: 'attachments',
    unread: 'unread mail',
    starred: 'starred mail'
  };
  const activeSearchLabel = searchQuery.trim() || fieldOnlySearchLabels[searchField];
  const searchStatusPrimary = searchError || (isSearchActive ? `${messages.length} result${messages.length === 1 ? '' : 's'} for ${activeSearchLabel}` : searchInfo);
  const searchStatusSecondary = searchError
    ? ''
    : [isSearchActive ? searchInfo : '', isSearchActive && searchScope === 'all' ? 'All folders' : '', searchIndexStatus?.indexedCount ? `${searchIndexStatus.indexedCount} indexed` : ''].filter(Boolean).join(' | ');

  const calendarDays = useMemo(() => {
    const start = startOfWeek(startOfMonth(currentDate));
    const end = endOfWeek(endOfMonth(currentDate));
    const days = [];
    let day = start;
    while (day <= end) {
      days.push(day);
      day = addDays(day, 1);
    }
    return days;
  }, [currentDate]);

  const weekDays = useMemo(() => {
    const start = startOfWeek(currentDate);
    return Array.from({length: 7}, (_, i) => addDays(start, i));
  }, [currentDate]);

  const setupMailboxAddress = userIdentities.address || currentUsername || 'your-email@example.com';
  const setupOrigin = useMemo(() => {
    if (typeof window === 'undefined') return '';
    return window.location.origin;
  }, []);
  const setupHost = useMemo(() => {
    if (typeof window === 'undefined') return '';
    try {
      return new URL(setupOrigin).hostname;
    } catch {
      return window.location.hostname;
    }
  }, [setupOrigin]);
  const setupValues = useMemo(() => {
    const encodedMailbox = encodeURIComponent(setupMailboxAddress);
    return {
      caldavDiscoveryUrl: `${setupOrigin}/.well-known/caldav`,
      caldavHomeUrl: `${setupOrigin}/caldav/calendars/${encodedMailbox}/`,
      carddavDiscoveryUrl: `${setupOrigin}/.well-known/carddav`,
      carddavAddressBookUrl: `${setupOrigin}/carddav/addressbooks/${encodedMailbox}/personal/`,
      activeSyncUrl: `${setupOrigin}/Microsoft-Server-ActiveSync`,
      mailHost: setupHost,
      imapPort: '993',
      smtpPort: '587',
    };
  }, [setupMailboxAddress, setupOrigin, setupHost]);

  const copySetupValue = useCallback((fieldKey: string, value: string) => {
    const markCopied = () => {
      setCopiedSetupField(fieldKey);
      window.setTimeout(() => setCopiedSetupField(null), 1400);
    };

    if (navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(value).then(markCopied).catch(() => {
        window.prompt('Copy this value:', value);
        markCopied();
      });
      return;
    }

    window.prompt('Copy this value:', value);
    markCopied();
  }, []);

  const openCalendarEvent = (event: CalendarEvent) => {
    setSelectedCalendarEvent(event);
  };

  const beginEditCalendarEvent = (event: CalendarEvent) => {
    setEditingCalendarEvent(event);
    setSelectedCalendarEvent(null);
    setNewEventData({
      title: event.title,
      calendarId: event.calendarId,
      start: new Date(event.start),
      end: new Date(event.end),
      isAllDay: !!event.isAllDay,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      recurrence: recurrenceFromRrule(event.recurrence),
      guests: '',
      guestPermissions: { invite: true, seeList: true },
      location: event.location || '',
      description: event.description || '',
      notifications: [{id: 1, type: 'notification', time: 10}],
      busyStatus: 'busy',
      visibility: 'default'
    });
    setIsAdvancedEventMode(true);
    setIsEventModalOpen(true);
  };

  const deleteCalendarEvent = async (event: CalendarEvent) => {
    if (!window.confirm(`Delete "${event.title || 'Untitled'}"?`)) return;
    const res = await fetch(`/api/apps/events/${event.calendarId}/${encodeURIComponent(event.id)}`, {
      method: 'DELETE',
      headers: getHeaders()
    });
    const data = await res.json() as { success: boolean; error?: string };
    if (data.success) {
      setSelectedCalendarEvent(null);
      await refreshCalendars();
    } else {
      window.alert(data.error || 'Failed to delete event.');
    }
  };

  const formatCalendarEventRange = (event: CalendarEvent): string => {
    if (event.isAllDay) {
      return `${format(event.start, 'EEEE, MMMM d, yyyy')} - all day`;
    }

    const sameDay = isSameDay(event.start, event.end);
    return sameDay
      ? `${format(event.start, 'EEEE, MMMM d, yyyy')} | ${format(event.start, 'h:mm a')} - ${format(event.end, 'h:mm a')}`
      : `${format(event.start, 'MMM d, yyyy h:mm a')} - ${format(event.end, 'MMM d, yyyy h:mm a')}`;
  };

  const openCalendarEditor = (calendar: Calendar) => {
    const validColor = /^#[0-9a-fA-F]{6}$/.test(calendar.color) ? calendar.color : '#3498db';
    setEditingCalendar(calendar);
    setCalendarEditorData({ name: calendar.name, color: validColor });
    setCalendarEditorError('');
  };

  const saveCalendarEditor = async () => {
    if (!editingCalendar || calendarEditorSaving) return;

    const name = calendarEditorData.name.trim();
    if (!name) {
      setCalendarEditorError('Calendar name is required.');
      return;
    }

    setCalendarEditorSaving(true);
    setCalendarEditorError('');

    try {
      const res = await fetch(`/api/apps/calendars/${editingCalendar.id}`, {
        method: 'PUT',
        headers: getHeaders(),
        body: JSON.stringify({ name, color: calendarEditorData.color })
      });
      const data = await res.json() as CalendarUpdateResponse;

      if (!res.ok || !data.success) {
        setCalendarEditorError(data.error || 'Failed to update calendar.');
        return;
      }

      setCalendars((currentCalendars) => currentCalendars.map((calendar) => (
        calendar.id === editingCalendar.id
          ? { ...calendar, name, color: calendarEditorData.color }
          : calendar
      )));
      setEditingCalendar(null);
    } catch {
      setCalendarEditorError('Failed to update calendar.');
    } finally {
      setCalendarEditorSaving(false);
    }
  };

  const deleteCalendar = async (calendar: Calendar) => {
    if (deletingCalendarId !== null) return;

    if (calendars.length <= 1) {
      window.alert('You must keep at least one calendar.');
      return;
    }

    const eventCount = events.filter((event) => event.calendarId === calendar.id).length;
    const confirmation = eventCount > 0
      ? `Delete "${calendar.name}" and its ${eventCount} event${eventCount === 1 ? '' : 's'}? This cannot be undone.`
      : `Delete "${calendar.name}"? This cannot be undone.`;

    if (!window.confirm(confirmation)) return;

    setDeletingCalendarId(calendar.id);
    try {
      const res = await fetch(`/api/apps/calendars/${calendar.id}`, {
        method: 'DELETE',
        headers: getHeaders()
      });
      const data = await res.json() as CalendarDeleteResponse;

      if (!res.ok || !data.success) {
        window.alert(data.error || 'Failed to delete calendar.');
        return;
      }

      setSelectedCalendarEvent((selectedEvent) => (
        selectedEvent?.calendarId === calendar.id ? null : selectedEvent
      ));
      await refreshCalendars();
    } catch {
      window.alert('Failed to delete calendar.');
    } finally {
      setDeletingCalendarId(null);
    }
  };

  const renderSetupCopyRow = (label: string, value: string, fieldKey: string, description?: string) => (
    <div className="sync-copy-row">
      <div className="sync-copy-text">
        <div className="sync-copy-label">{label}</div>
        <code className="sync-copy-value">{value}</code>
        {description && <div className="sync-copy-description">{description}</div>}
      </div>
      <button className="btn btn-ghost sync-copy-button" onClick={() => copySetupValue(fieldKey, value)} title={`Copy ${label}`} aria-label={`Copy ${label}`}>
        {copiedSetupField === fieldKey ? <Check size={16} /> : <Copy size={16} />}
      </button>
    </div>
  );

  const renderSyncSetupSections = (scope: 'all' | 'calendar' | 'contacts' = 'all') => (
    <>
      {(scope === 'all' || scope === 'calendar') && (
        <section className="sync-setup-section">
          <div className="sync-setup-section-title"><Share2 size={16} /> CalDAV</div>
          {renderSetupCopyRow('Auto-discovery URL', setupValues.caldavDiscoveryUrl, 'caldav-discovery', 'Use this first in Apple Calendar, Thunderbird, DAVx5, and other CalDAV clients.')}
          {renderSetupCopyRow('Calendar home URL', setupValues.caldavHomeUrl, 'caldav-home', 'Use this when a client asks for the direct calendar collection root.')}
          <div className="sync-setup-note">Sign in with your mailbox address and mailbox password.</div>
        </section>
      )}

      {(scope === 'all' || scope === 'contacts') && (
        <section className="sync-setup-section">
          <div className="sync-setup-section-title"><Users size={16} /> CardDAV</div>
          {renderSetupCopyRow('Auto-discovery URL', setupValues.carddavDiscoveryUrl, 'carddav-discovery', 'Use this first in Apple Contacts, Thunderbird, DAVx5, and other CardDAV clients.')}
          {renderSetupCopyRow('Address book URL', setupValues.carddavAddressBookUrl, 'carddav-addressbook', 'Use this when a client asks for the direct address book collection.')}
          <div className="sync-setup-note">Sign in with your mailbox address and mailbox password.</div>
        </section>
      )}

      <section className="sync-setup-section">
        <div className="sync-setup-section-title"><Mail size={16} /> Mail Apps</div>
        {renderSetupCopyRow('Username', setupMailboxAddress, 'mail-username')}
        {renderSetupCopyRow('IMAP server', setupValues.mailHost, 'imap-host', `Port ${setupValues.imapPort}, SSL/TLS`)}
        {renderSetupCopyRow('SMTP server', setupValues.mailHost, 'smtp-host', `Port ${setupValues.smtpPort}, STARTTLS`)}
        <div className="sync-setup-note">Use your mailbox password for IMAP and SMTP authentication.</div>
      </section>

      <section className="sync-setup-section">
        <div className="sync-setup-section-title"><Smartphone size={16} /> iOS and Android</div>
        {renderSetupCopyRow('Exchange server', setupValues.mailHost, 'exchange-server')}
        {renderSetupCopyRow('ActiveSync URL', setupValues.activeSyncUrl, 'activesync-url')}
        <div className="sync-client-grid">
          <div>
            <div className="sync-client-title">iPhone / iPad</div>
            <ol className="sync-step-list">
              <li>Add a Microsoft Exchange account.</li>
              <li>Use your full mailbox address for Email and Username.</li>
              <li>If asked for Server, enter the Exchange server above.</li>
              <li>Enable Mail, Calendars, and Contacts.</li>
            </ol>
          </div>
          <div>
            <div className="sync-client-title">Android</div>
            <ol className="sync-step-list">
              <li>Use an Exchange or ActiveSync account for mail, calendar, and contacts when your app supports it.</li>
              <li>Use manual IMAP/SMTP setup when the app only needs mail.</li>
              <li>Use CalDAV/CardDAV in DAVx5 or similar apps when the Android client needs calendar or contacts separately.</li>
            </ol>
          </div>
        </div>
      </section>

      <section className="sync-setup-section">
        <div className="sync-setup-section-title"><Monitor size={16} /> Desktop Apps</div>
        <div className="sync-setup-note">
          macOS Calendar should use CalDAV, macOS Contacts should use CardDAV, and Thunderbird can use the discovery URLs above. Outlook-style desktop mail clients should use IMAP and SMTP unless they support ActiveSync.
        </div>
      </section>
    </>
  );

  const appBrandName = branding.appName || defaultBranding.appName;
  const renderBrandMark = (size: number, className = '') => {
    const logo = branding.loginLogoDataUrl || branding.appIconDataUrl;
    if (logo) {
      return <img className={`app-brand-image ${className}`} src={logo} alt="" style={{ width: size, height: size }} />;
    }
    return <Settings className={`text-accent-primary ${className}`} size={size} color="var(--accent-primary)" />;
  };
  const loginContainerStyle: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  };
  if (branding.loginBackgroundDataUrl) {
    loginContainerStyle.backgroundImage = `linear-gradient(rgba(7, 12, 20, 0.45), rgba(7, 12, 20, 0.72)), url(${branding.loginBackgroundDataUrl})`;
    loginContainerStyle.backgroundSize = 'cover';
    loginContainerStyle.backgroundPosition = 'center';
  }

  if (!authChecked) {
    return (
      <div className="app-container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div className="glass-panel" style={{ width: '320px', padding: '32px', textAlign: 'center', color: 'var(--text-secondary)' }}>
          Loading...
        </div>
      </div>
    );
  }

  if (!isAuthenticated) {
    return (
      <div className="app-container" style={loginContainerStyle}>
        <div className="glass-panel" style={{ width: '400px', padding: '40px', display: 'flex', flexDirection: 'column', gap: '20px' }}>
          <div style={{ textAlign: 'center', marginBottom: '20px' }}>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '16px' }}>
              {renderBrandMark(56, 'login-brand-mark')}
            </div>
            <h1 style={{ margin: 0, fontSize: '1.5rem' }}>{branding.loginTitle || appBrandName}</h1>
            <p style={{ color: 'var(--text-secondary)', margin: '8px 0 0' }}>{branding.loginSubtitle || defaultBranding.loginSubtitle}</p>
          </div>
          <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div>
              <label style={{ display: 'block', marginBottom: '8px', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Email Address</label>
              <input 
                type="email" 
                className="glass-input" 
                style={{ width: '100%' }} 
                value={loginUsername} 
                onChange={e => setLoginUsername(e.target.value)} 
                required 
                placeholder="user@example.com"
              />
            </div>
            <div>
              <label style={{ display: 'block', marginBottom: '8px', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>Password</label>
              <input 
                type="password" 
                className="glass-input" 
                style={{ width: '100%' }} 
                value={loginPassword} 
                onChange={e => setLoginPassword(e.target.value)} 
                required 
              />
            </div>
            {loginError && <div style={{ color: 'var(--danger)', fontSize: '0.85rem' }}>{loginError}</div>}
            <button type="submit" className="btn btn-primary" style={{ marginTop: '8px', padding: '12px' }}>Sign In</button>
          </form>
        </div>
      </div>
    );
  }
  return (
    <div className={`app-container ${(appMode === 'webmail' || appMode === 'calendar' || appMode === 'contacts' || appMode === 'sync' || appMode === 'settings' || appMode === 'admin') ? 'webmail-mode' : ''}`}>
      <header className="header" style={{ padding: '0 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '30px' }}>
          <div className="header-title" style={{ margin: 0 }}>
            {renderBrandMark(32, 'header-brand-mark')}
            {appBrandName}
          </div>
          <div style={{ display: 'flex', gap: '20px', fontSize: '1rem' }}>
            <span 
              onClick={() => navigateApp('webmail')} 
              style={{ cursor: 'pointer', fontWeight: appMode === 'webmail' ? 'bold' : 'normal', color: appMode === 'webmail' ? 'var(--accent-primary)' : 'var(--text-primary)' }}
            >
              Mail
            </span>
            <span 
              onClick={() => navigateApp('calendar')} 
              style={{ cursor: 'pointer', fontWeight: appMode === 'calendar' ? 'bold' : 'normal', color: appMode === 'calendar' ? 'var(--accent-primary)' : 'var(--text-primary)' }}
            >
              Calendar
            </span>
            <span 
              onClick={() => navigateApp('contacts')} 
              style={{ cursor: 'pointer', fontWeight: appMode === 'contacts' ? 'bold' : 'normal', color: appMode === 'contacts' ? 'var(--accent-primary)' : 'var(--text-primary)' }}
            >
              Contacts
            </span>
            <span
              onClick={() => navigateApp('sync')}
              style={{ cursor: 'pointer', fontWeight: appMode === 'sync' ? 'bold' : 'normal', color: appMode === 'sync' ? 'var(--accent-primary)' : 'var(--text-primary)' }}
            >
              Sync Info
            </span>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
          <button
            className="btn btn-ghost"
            type="button"
            onClick={refreshCurrentView}
            disabled={isRefreshing}
            title="Refresh current view"
            aria-label="Refresh current view"
            style={{ padding: '6px 10px' }}
          >
            <RefreshCw size={18} style={{ transform: isRefreshing ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
          </button>
          
          <div style={{ position: 'relative' }}>
            <button 
              className="btn btn-ghost" 
              style={{ display: 'flex', gap: '8px', alignItems: 'center', padding: '6px 12px' }}
              onClick={() => setUserMenuOpen(!userMenuOpen)}
            >
              <User size={18} />
              <span>{currentUsername}</span>
              <ChevronDown size={14} />
            </button>
            
            {userMenuOpen && (
              <div style={{
                position: 'absolute', top: '100%', right: '0', marginTop: '8px', width: '200px',
                background: 'var(--surface-color)', border: '1px solid rgba(255,255,255,0.1)',
                borderRadius: '8px', boxShadow: '0 8px 32px rgba(0,0,0,0.5)', zIndex: 1000,
                display: 'flex', flexDirection: 'column', overflow: 'hidden'
              }}>
                <button 
                  className="btn btn-ghost" 
                  style={{ width: '100%', textAlign: 'left', borderRadius: 0, borderBottom: '1px solid rgba(255,255,255,0.05)', padding: '12px 16px' }}
                  onClick={() => navigateApp('settings')}
                >
                  <Settings size={16} style={{ display: 'inline', marginRight: '8px' }} /> Settings
                </button>
                {isAdmin && (
                  <button 
                    className="btn btn-ghost" 
                    style={{ width: '100%', textAlign: 'left', borderRadius: 0, borderBottom: '1px solid rgba(255,255,255,0.05)', padding: '12px 16px' }}
                    onClick={() => navigateApp('admin')}
                  >
                    <ShieldAlert size={16} style={{ display: 'inline', marginRight: '8px' }} /> Admin Portal
                  </button>
                )}
	                <button 
	                  className="btn btn-ghost" 
	                  style={{ width: '100%', textAlign: 'left', borderRadius: 0, padding: '12px 16px', color: 'var(--danger-color)' }}
	                  onClick={() => {
	                    fetch('/api/auth/logout', { method: 'POST', credentials: 'include' }).finally(() => {
	                      setIsAuthenticated(false);
	                      setIsAdmin(false);
	                      setCurrentUsername('');
	                      setMessages([]);
	                      setViewingThread(null);
	                      localStorage.removeItem('oms_token');
	                      localStorage.removeItem('oms_isAdmin');
	                      localStorage.removeItem('oms_username');
	                    });
	                  }}
	                >
                  <X size={16} style={{ display: 'inline', marginRight: '8px' }} /> Sign Out
                </button>
              </div>
            )}
          </div>
        </div>
      </header>

      <div className="main-layout" style={{ gridTemplateColumns: (appMode === 'settings' || appMode === 'admin') ? '280px 1fr' : '1fr' }}>
        {(appMode === 'settings' || appMode === 'admin') && (
          <aside className="sidebar glass-panel">

          {appMode === 'settings' && (
            <SettingsSidebar activeTab={activeTab} onTabChange={setActiveTab} />
          )}



          {appMode === 'admin' && isAdmin && (
            <>
              <div className="sidebar-section-title">Administration</div>
              <div className={`nav-item ${activeTab === 'admin_dashboard' ? 'active' : ''}`} onClick={() => setActiveTab('admin_dashboard')}>
                <Settings size={18} /> Dashboard
              </div>
              <div className={`nav-item ${activeTab === 'admin_domains' ? 'active' : ''}`} onClick={() => setActiveTab('admin_domains')}>
                <Mail size={18} /> Domains & DNS
              </div>
              <div className={`nav-item ${activeTab === 'admin_routing' ? 'active' : ''}`} onClick={() => setActiveTab('admin_routing')}>
                <Share2 size={18} /> Cross-Domain Routing
              </div>
              <div className={`nav-item ${activeTab === 'admin_mailboxes' ? 'active' : ''}`} onClick={() => setActiveTab('admin_mailboxes')}>
                <Users size={18} /> Mailboxes
              </div>
              <div className={`nav-item ${activeTab === 'admin_aliases' ? 'active' : ''}`} onClick={() => setActiveTab('admin_aliases')}>
                <Users size={18} /> Aliases & Groups
              </div>
              <div className={`nav-item ${activeTab === 'admin_quarantine' ? 'active' : ''}`} onClick={() => setActiveTab('admin_quarantine')}>
                <ShieldAlert size={18} /> Spam Quarantine
              </div>
              <div className={`nav-item ${activeTab === 'admin_spam_policies' ? 'active' : ''}`} onClick={() => setActiveTab('admin_spam_policies')}>
                <Filter size={18} /> Spam Policies
              </div>
              <div className={`nav-item ${activeTab === 'admin_rspamd' ? 'active' : ''}`} onClick={() => setActiveTab('admin_rspamd')}>
                <ShieldAlert size={18} /> Rspamd WebUI
              </div>
              <div className={`nav-item ${activeTab === 'admin_branding' ? 'active' : ''}`} onClick={() => setActiveTab('admin_branding')}>
                <Image size={18} /> Branding
              </div>
              <div className={`nav-item ${activeTab === 'admin_settings' ? 'active' : ''}`} onClick={() => setActiveTab('admin_settings')}>
                <SlidersHorizontal size={18} /> Settings
              </div>
              <div className={`nav-item ${activeTab === 'admin_admins' ? 'active' : ''}`} onClick={() => setActiveTab('admin_admins')}>
                <Lock size={18} /> Administrators
              </div>
              <div className={`nav-item ${activeTab === 'admin_logs' ? 'active' : ''}`} onClick={() => setActiveTab('admin_logs')}>
                <Settings size={18} /> Audit Logs
              </div>
              <div className={`nav-item ${activeTab === 'admin_apikeys' ? 'active' : ''}`} onClick={() => setActiveTab('admin_apikeys')}>
                <Lock size={18} /> API Keys
              </div>
              <div className={`nav-item ${activeTab === 'admin_updates' ? 'active' : ''}`} onClick={() => setActiveTab('admin_updates')}>
                <Settings size={18} /> System Updates
              </div>
            </>
          )}
          </aside>
        )}

        <main className="content-area">
          {appMode === 'webmail' && activeTab === 'inbox' && (
            <PanelGroup id="oms-webmail-v7" orientation="horizontal" defaultLayout={webmailPanelLayout.defaultLayout} onLayoutChanged={webmailPanelLayout.onLayoutChanged} style={{ width: '100%', height: '100%', minHeight: 0 }}>
              <Panel id="webmail-sidebar" defaultSize={20} minSize={10}>
                <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                  <div style={{ padding: '16px', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                    <button 
                      className="btn btn-primary" 
                      style={{ width: '100%', display: 'flex', justifyContent: 'center', gap: '8px' }}
                      onClick={handleCompose}
                    >
                      <Edit size={16} /> Compose
                    </button>
                  </div>
                  <div style={{ padding: '16px', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                    <h3 style={{ margin: 0 }}>Folders</h3>
                  </div>
                  <div style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>
                    {Object.values(buildFolderTree(folders)).sort((a, b) => a.name.localeCompare(b.name)).map((node) => (
                      <FolderNode 
                        key={node.fullPath} 
                        node={node} 
                        level={0} 
                        activeFolder={activeFolder} 
                        setActiveFolder={handleFolderSelect} 
                        expandedFolders={expandedFolders} 
                        toggleFolder={toggleFolder} 
                        handleMessageMove={handleMessageMove}
                      />
                    ))}
                  </div>
                </div>
              </Panel>
              <PanelResizeHandle style={{ width: '16px', cursor: 'col-resize', position: 'relative' }}>
                <div style={{ position: 'absolute', top: 0, bottom: 0, left: '6px', right: '6px', background: 'rgba(255,255,255,0.1)', borderRadius: '4px' }} />
              </PanelResizeHandle>
              <Panel id="message-list" defaultSize={30} minSize={15}>
                <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                  <form onSubmit={handleSearch} style={{ padding: '12px 16px', borderBottom: savedSearches.length > 0 ? '1px solid rgba(255,255,255,0.06)' : '1px solid rgba(255,255,255,0.1)', display: 'grid', gridTemplateColumns: 'minmax(160px, 1fr) auto auto auto auto auto auto', gap: '8px', alignItems: 'center', background: 'rgba(255,255,255,0.03)' }}>
                    <div style={{ position: 'relative', minWidth: 0 }}>
                      <Search size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-secondary)' }} />
                      <input
                        className="glass-input"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Search mail"
                        style={{ width: '100%', paddingLeft: '36px' }}
                      />
                    </div>
                    <select className="glass-input glass-select" value={searchField} onChange={(e) => setSearchField(e.target.value as SearchField)} style={{ width: '118px' }}>
                      <option value="all">All</option>
                      <option value="from">From</option>
                      <option value="to">To</option>
                      <option value="subject">Subject</option>
                      <option value="body">Body</option>
                      <option value="attachments">Attachments</option>
                      <option value="unread">Unread</option>
                      <option value="starred">Starred</option>
                    </select>
                    <select className="glass-input glass-select" value={searchScope} onChange={(e) => setSearchScope(e.target.value as SearchScope)} style={{ width: '132px' }}>
                      <option value="folder">This folder</option>
                      <option value="all">All folders</option>
                    </select>
                    <button className="btn btn-primary" type="submit" disabled={searchLoading} style={{ padding: '10px 12px', minWidth: '92px' }}>
                      <Search size={16} /> {searchLoading ? 'Searching' : 'Search'}
                    </button>
                    <button className="btn btn-ghost" type="button" title="Save search" onClick={handleSaveCurrentSearch} disabled={searchLoading} style={{ padding: '10px 12px' }}>
                      <Save size={16} />
                    </button>
                    <button className="btn btn-ghost" type="button" title="Update search index" onClick={handleUpdateSearchIndex} disabled={indexLoading} style={{ padding: '10px 12px' }}>
                      <RefreshCw size={16} />
                    </button>
                    {isSearchActive && (
                      <button className="btn btn-ghost" type="button" title="Clear search" onClick={handleClearSearch} style={{ padding: '10px 12px' }}>
                        <X size={16} />
                      </button>
                    )}
                  </form>
                  {savedSearches.length > 0 && (
                    <div style={{ padding: '8px 16px', borderBottom: '1px solid rgba(255,255,255,0.1)', display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center', background: 'rgba(255,255,255,0.025)' }}>
                      {savedSearches.map(savedSearch => (
                        <div key={savedSearch.id} style={{ display: 'inline-flex', alignItems: 'center', maxWidth: '100%', border: '1px solid rgba(255,255,255,0.16)', borderRadius: '999px', overflow: 'hidden', background: 'rgba(255,255,255,0.04)' }}>
                          <button className="btn btn-ghost" type="button" title={`Run ${savedSearch.name}`} onClick={() => handleApplySavedSearch(savedSearch)} style={{ padding: '5px 8px 5px 10px', minHeight: '28px', maxWidth: '150px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', borderRadius: 0 }}>
                            {savedSearch.name}
                          </button>
                          <button className="btn btn-ghost" type="button" title="Delete saved search" onClick={(event) => handleDeleteSavedSearch(savedSearch, event)} style={{ padding: '5px 8px', minHeight: '28px', borderRadius: 0 }}>
                            <X size={12} />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  {(isSearchActive || searchError || searchInfo) && (
                    <div style={{ padding: '8px 16px', borderBottom: '1px solid rgba(255,255,255,0.06)', color: searchError ? 'var(--danger)' : 'var(--text-secondary)', fontSize: '0.85rem', display: 'flex', justifyContent: 'space-between', gap: '12px' }}>
                      <span>{searchStatusPrimary}</span>
                      <span>{searchStatusSecondary}</span>
                    </div>
                  )}
                  <div style={{ padding: '12px 16px', borderBottom: '1px solid rgba(255,255,255,0.1)', display: 'flex', alignItems: 'center', gap: '12px', background: 'rgba(255,255,255,0.02)' }}>
                    <input 
                      type="checkbox" 
                      checked={canBulkAct && messages.length > 0 && selectedMessages.length === messages.length}
                      disabled={!canBulkAct}
                      onChange={(e) => {
                        if (!canBulkAct) return;
                        if (e.target.checked) setSelectedMessages(messages.map(m => m.uid));
                        else setSelectedMessages([]);
                      }}
                      title="Select All"
                    />
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button className="btn btn-ghost" style={{ padding: '4px 8px' }} title="Delete" onClick={() => handleMessageAction('delete')} disabled={selectedMessages.length === 0 || !canBulkAct}><Trash2 size={14} /></button>
                      <button className="btn btn-ghost" style={{ padding: '4px 8px' }} title="Archive" onClick={() => handleMessageAction('archive')} disabled={selectedMessages.length === 0 || !canBulkAct}><Inbox size={14} /></button>
                      <button className="btn btn-ghost" style={{ padding: '4px 8px' }} title="Report Spam" onClick={() => handleMessageAction('spam')} disabled={selectedMessages.length === 0 || !canBulkAct}><ShieldAlert size={14} /></button>
                      <button className="btn btn-ghost" style={{ padding: '4px 8px' }} title="Mark read" onClick={() => handleMessageAction('read')} disabled={selectedMessages.length === 0 || !canBulkAct}><MailOpen size={14} /></button>
                      <button className="btn btn-ghost" style={{ padding: '4px 8px' }} title="Mark unread" onClick={() => handleMessageAction('unread')} disabled={selectedMessages.length === 0 || !canBulkAct}><Mail size={14} /></button>
                      <button className="btn btn-ghost" style={{ padding: '4px 8px' }} title="Star" onClick={() => handleMessageAction('star')} disabled={selectedMessages.length === 0 || !canBulkAct}><Star size={14} /></button>
                    </div>
                    <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>Threads</label>
                      <div 
                        style={{
                          width: '32px', height: '18px', background: isThreaded ? 'var(--accent-primary)' : 'rgba(255,255,255,0.1)',
                          borderRadius: '9px', position: 'relative', cursor: 'pointer', transition: 'background 0.2s'
                        }}
                        onClick={() => setIsThreaded(!isThreaded)}
                      >
                        <div style={{
                          width: '14px', height: '14px', background: '#fff', borderRadius: '50%',
                          position: 'absolute', top: '2px', left: isThreaded ? '16px' : '2px', transition: 'left 0.2s'
                        }} />
                      </div>
                    </div>
                  </div>
                  <div style={{ flex: 1, overflowY: 'auto' }}>
                    {(mailLoading || searchLoading) ? (
                      <div style={{ padding: '32px', textAlign: 'center', color: 'var(--text-secondary)' }}>{searchLoading ? 'Searching...' : 'Loading messages...'}</div>
                    ) : displayMessages.length === 0 ? (
                      <div style={{ padding: '32px', textAlign: 'center', color: 'var(--text-secondary)' }}>No messages found.</div>
                    ) : (
                      <>
                        {displayMessages.map((msg) => (
                          <div 
                          key={`${msg.folder || activeFolder}:${msg.uid}`} 
                          draggable={canBulkAct}
                          onDragStart={(e) => {
                            if (!canBulkAct) {
                              e.preventDefault();
                              return;
                            }
                            let draggedUids = selectedMessages.includes(msg.uid) ? selectedMessages : [msg.uid];
                            if (isThreaded && msg.threadUids) {
                              draggedUids = Array.from(new Set([...draggedUids, ...msg.threadUids]));
                            }
                            e.dataTransfer.setData('application/json', JSON.stringify(draggedUids));
                            e.dataTransfer.effectAllowed = 'move';
                          }}
                          style={{ 
                            padding: '12px 16px', 
                            borderBottom: '1px solid rgba(255,255,255,0.05)',
                            display: 'flex', gap: '12px', alignItems: 'flex-start',
                            cursor: 'pointer',
                            background: viewingThread && viewingThread.some(t => t.uid === msg.uid && (t.folder || activeFolder) === (msg.folder || activeFolder)) ? 'var(--accent-primary-transparent)' : (msg.isRead ? 'transparent' : 'rgba(255,255,255,0.05)')
                          }}
                          onClick={() => loadMessage(msg.threadUids || msg.uid, msg.folder || activeFolder)}
                        >
                          <input 
                            type="checkbox" 
                            checked={selectedMessages.includes(msg.uid)}
                            disabled={!canBulkAct}
                            onClick={e => e.stopPropagation()}
                            onChange={(e) => {
                              if (!canBulkAct) return;
                              if (e.target.checked) setSelectedMessages([...selectedMessages, msg.uid]);
                              else setSelectedMessages(selectedMessages.filter(id => id !== msg.uid));
                            }}
                          />
                          <button
                            className="btn btn-ghost"
                            title={msg.isStarred ? 'Unstar' : 'Star'}
                            onClick={(event) => handleToggleStar(msg, event)}
                            style={{ padding: '2px', color: msg.isStarred ? '#FBBF24' : 'var(--text-secondary)', flexShrink: 0 }}
                          >
                            <Star size={16} fill={msg.isStarred ? '#FBBF24' : 'none'} />
                          </button>
                          <div style={{ flex: 1, overflow: 'hidden' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '4px' }}>
                              <strong style={{ color: msg.isRead ? 'var(--text-primary)' : 'var(--accent-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{msg.from}</strong>
                              <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginLeft: '8px', flexShrink: 0 }}>{new Date(msg.date).toLocaleDateString()}</span>
                            </div>
                            <div style={{ fontWeight: msg.isRead ? 'normal' : 'bold', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {(msg.threadCount || 0) > 1 && <span style={{ marginRight: '6px', fontSize: '0.8rem', background: 'rgba(255,255,255,0.1)', padding: '2px 6px', borderRadius: '10px' }}>{msg.threadCount}</span>}
                              {msg.hasAttachments && <Paperclip size={13} style={{ marginRight: '6px', verticalAlign: '-2px', color: 'var(--text-secondary)' }} />}
                              {msg.subject}
                            </div>
                            <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {msg.preview}
                            </div>
                            {isSearchActive && searchScope === 'all' && msg.folder && (
                              <div style={{ marginTop: '4px', fontSize: '0.75rem', color: 'var(--accent-primary)' }}>{msg.folder}</div>
                            )}
                          </div>
                        </div>
                        ))}
                        {!isSearchActive && mailMoreAvailable && (
                          <div style={{ padding: '16px', display: 'flex', justifyContent: 'center', borderTop: '1px solid rgba(255,255,255,0.05)' }}>
                            <button className="btn btn-ghost" type="button" onClick={handleLoadOlderMessages} disabled={loadingOlderMessages} style={{ padding: '8px 14px', minWidth: '128px' }}>
                              {loadingOlderMessages ? 'Loading...' : 'Load older'}
                            </button>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </Panel>
              <PanelResizeHandle style={{ width: '16px', cursor: 'col-resize', position: 'relative' }}>
                <div style={{ position: 'absolute', top: 0, bottom: 0, left: '6px', right: '6px', background: 'rgba(255,255,255,0.1)', borderRadius: '4px' }} />
              </PanelResizeHandle>
              <Panel id="message-view" defaultSize={50} minSize={20}>
                <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                  {!viewingThread ? (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-secondary)' }}>
                      Select an item to read
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflowY: 'auto', padding: '24px', gap: '24px' }}>
                      <h2 style={{ marginTop: 0, marginBottom: '10px' }}>{viewingThread[0]?.subject}</h2>
                      {viewingThread.map((msg) => (
                        <div key={msg.uid} style={{ display: 'flex', flexDirection: 'column', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '12px', padding: '20px' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px', paddingBottom: '20px', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                            <div>
                              <div><strong>From:</strong> {msg.from}</div>
                              <div><strong>To:</strong> {msg.to}</div>
                              <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>{new Date(msg.date).toLocaleString()}</div>
                            </div>
                            <div style={{ display: 'flex', gap: '8px' }}>
                              <button className="btn btn-ghost" title="Reply" onClick={() => handleReply('reply', msg)}><Reply size={16} /></button>
                              <button className="btn btn-ghost" title="Reply All" onClick={() => handleReply('replyAll', msg)}><ReplyAll size={16} /></button>
                              <button className="btn btn-ghost" title="Forward" onClick={() => handleReply('forward', msg)}><Forward size={16} /></button>
                            </div>
                          </div>
                          <div 
                            style={{ background: '#fff', color: '#000', padding: '20px', borderRadius: '8px', overflowX: 'auto' }} 
                            dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(msg.html || `<pre>${msg.text}</pre>`) }} 
                          />
                          {(msg.attachments || []).length > 0 && (
                            <div style={{ marginTop: '16px', borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                              {(msg.attachments || []).map((attachment) => {
                                const folderPath = msg.folder || activeFolder;
                                const previewUrl = getAttachmentUrl(folderPath, msg.uid, attachment.id);
                                const downloadUrl = getAttachmentUrl(folderPath, msg.uid, attachment.id, true);
                                return (
                                  <div key={attachment.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: '12px', alignItems: 'center', padding: '8px 0' }}>
                                    <div style={{ display: 'flex', minWidth: 0, alignItems: 'center', gap: '10px' }}>
                                      <Paperclip size={16} style={{ color: 'var(--text-secondary)', flexShrink: 0 }} />
                                      <div style={{ minWidth: 0 }}>
                                        <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{attachment.filename}</div>
                                        <div style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>{[attachment.contentType, formatAttachmentSize(attachment.size)].filter(Boolean).join(' | ')}</div>
                                      </div>
                                    </div>
                                    <div style={{ display: 'flex', gap: '8px' }}>
                                      {attachment.previewable && (
                                        <a className="btn btn-ghost" title="Preview" href={previewUrl} target="_blank" rel="noreferrer" style={{ padding: '6px 8px' }}>
                                          <Eye size={14} />
                                        </a>
                                      )}
                                      <a className="btn btn-ghost" title="Download" href={downloadUrl} style={{ padding: '6px 8px' }}>
                                        <Download size={14} />
                                      </a>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </Panel>
            </PanelGroup>
          )}

          {appMode === 'admin' && (adminActionError || adminActionStatus) && (
            <div className={adminActionError ? 'settings-error-banner' : 'settings-status-banner'} style={{ marginBottom: '16px' }}>
              {adminActionError || adminActionStatus}
            </div>
          )}

          {activeTab === 'admin_dashboard' && (
            <div className="glass-panel" style={{ padding: '30px' }}>
              <div className="content-header" style={{ marginBottom: '20px' }}>
                <h2>System Health Dashboard</h2>
                <span style={{ background: 'var(--accent-primary)', padding: '4px 12px', borderRadius: '12px', fontSize: '0.8rem', fontWeight: 'bold' }}>ADMIN</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '16px', marginBottom: '30px' }}>
                <div className="glass-panel" style={{ padding: '20px' }}>
                  <h3>System Services</h3>
                  <ul style={{ listStyle: 'none', padding: 0, marginTop: '10px' }}>
                    <li style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0' }}><span>Dovecot (IMAP)</span> <span style={{ color: 'var(--success)' }}>Active</span></li>
                    <li style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0' }}><span>Postfix (SMTP)</span> <span style={{ color: 'var(--success)' }}>Active</span></li>
                    <li style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0' }}><span>Rspamd</span> <span style={{ color: 'var(--success)' }}>Active</span></li>
                  </ul>
                </div>
                <div className="glass-panel" style={{ padding: '20px', gridColumn: 'span 2' }}>
                  <h3>Server Resources</h3>
                  <div style={{ marginTop: '10px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px' }}><span>CPU Load</span> <span>0.15, 0.10, 0.05</span></div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px', marginTop: '10px' }}><span>Memory Usage</span> <span>1024 MB / 4096 MB (25%)</span></div>
                    <div style={{ width: '100%', height: '8px', background: 'var(--border-glass)', borderRadius: '4px' }}><div style={{ width: '25%', height: '100%', background: 'var(--primary)', borderRadius: '4px' }}></div></div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '5px', marginTop: '10px' }}><span>Disk Usage (/)</span> <span>20 GB / 100 GB (20%)</span></div>
                    <div style={{ width: '100%', height: '8px', background: 'var(--border-glass)', borderRadius: '4px' }}><div style={{ width: '20%', height: '100%', background: 'var(--primary)', borderRadius: '4px' }}></div></div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'admin_domains' && (
            <div className="glass-panel" style={{ padding: '30px' }}>
              <div className="content-header" style={{ marginBottom: '20px' }}>
                <h2>Domain & DNS Management</h2>
                <button className="btn btn-primary" onClick={handleAddDomain}><Plus size={16} /> Add Domain</button>
              </div>
              <div className="rules-list">
                {adminDomains.map(d => (
                  <div key={d.domain} className="condition-row" style={{ justifyContent: 'space-between', padding: '16px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                        <span style={{ fontSize: '1.1rem', fontWeight: 500 }}>{d.domain}</span>
                        {d.active === 1 && <span style={{ fontSize: '0.75rem', background: 'var(--success)', color: 'black', padding: '2px 8px', borderRadius: '12px', fontWeight: 600 }}>Active</span>}
                        {d.active === 0 && <span style={{ fontSize: '0.75rem', background: 'var(--danger)', color: 'white', padding: '2px 8px', borderRadius: '12px', fontWeight: 600 }}>Suspended</span>}
                      </div>
                      <small style={{ color: 'var(--text-secondary)' }}>Default quota {formatQuota(d.quota)} · max {formatQuota(d.maxquota)}</small>
                    </div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button className="btn btn-ghost" style={{ fontSize: '0.85rem' }} onClick={() => handleShowDnsRecords(d.domain)}>DNS Settings</button>
                      <button className="btn btn-danger" style={{ fontSize: '0.85rem' }} onClick={() => handleDeleteDomain(d.domain)}>Delete</button>
                    </div>
                  </div>
                ))}
                {adminDomains.length === 0 && <p style={{ padding: '16px', color: 'var(--text-secondary)' }}>Loading domains...</p>}
              </div>
            </div>
          )}

          {activeTab === 'admin_routing' && (
            <div className="glass-panel" style={{ padding: '30px' }}>
              <div className="content-header" style={{ marginBottom: '20px' }}>
                <h2>Cross-Domain Routing</h2>
                <button className="btn btn-primary" onClick={handleAddRouting}><Plus size={16} /> Add Routing</button>
              </div>
              <p style={{ color: 'var(--text-secondary)', marginBottom: '20px' }}>Route all mail from an Alias Domain to a Target Domain.</p>
              <div className="rules-list">
                <div className="condition-row" style={{ padding: '16px', display: 'flex', gap: '20px', background: 'var(--bg-dark)' }}>
                  <input className="glass-input" placeholder="Alias Domain (e.g. example.net)" style={{ flex: 1 }} value={routingAliasDomain} onChange={(e) => setRoutingAliasDomain(e.target.value)} />
                  <span style={{ color: 'var(--text-secondary)', alignSelf: 'center' }}>➔</span>
                  <select className="glass-input glass-select" style={{ flex: 1 }} value={routingTargetDomain} onChange={(e) => setRoutingTargetDomain(e.target.value)}>
                    {!routingTargetDomain && <option value="">Target Domain</option>}
                    {adminDomains.map(d => <option key={d.domain} value={d.domain}>{d.domain}</option>)}
                  </select>
                </div>
                {adminRouting.map(route => (
                  <div key={route.alias_domain} className="condition-row" style={{ justifyContent: 'space-between', padding: '16px' }}>
                    <div>
                      <strong style={{ display: 'block' }}>{route.alias_domain}</strong>
                      <small style={{ color: 'var(--text-secondary)' }}>Routes to {route.target_domain}</small>
                    </div>
                    <button className="btn btn-danger" style={{ fontSize: '0.85rem' }} onClick={() => handleDeleteRouting(route.alias_domain)}>Delete</button>
                  </div>
                ))}
                {adminRouting.length === 0 && <p style={{ padding: '16px', color: 'var(--text-secondary)' }}>No cross-domain routing rules.</p>}
              </div>
            </div>
          )}

          {activeTab === 'admin_mailboxes' && (
            <div className="glass-panel" style={{ padding: '30px' }}>
              <div className="content-header" style={{ marginBottom: '20px' }}>
                <h2>Mailbox Management</h2>
                <button className="btn btn-primary" onClick={handleAddMailbox}><Plus size={16} /> Create User</button>
              </div>
              <div className="rules-list">
                {adminMailboxes.map(user => (
                  <div key={user.username} className="condition-row" style={{ justifyContent: 'space-between', padding: '16px' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                      <span style={{ fontSize: '1rem', fontWeight: 500 }}>{user.username}</span>
                      <small style={{ color: 'var(--text-secondary)' }}>{user.name || 'No display name'} · {formatQuota(user.quota)}</small>
                    </div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button className="btn btn-ghost" style={{ fontSize: '0.85rem' }} onClick={() => openMailboxEditor(user)}>Edit</button>
                      <button className="btn btn-ghost" style={{ fontSize: '0.85rem' }} onClick={() => handleResetMailboxPassword(user.username)}>Reset Password</button>
                      <button className="btn btn-danger" style={{ fontSize: '0.85rem' }} onClick={() => handleToggleMailboxActive(user)}>{user.active === 0 ? 'Activate' : 'Suspend'}</button>
                      <button className="btn btn-danger" style={{ fontSize: '0.85rem' }} onClick={() => handleDeleteMailbox(user.username)}>Delete</button>
                    </div>
                  </div>
                ))}
                {adminMailboxes.length === 0 && <p style={{ padding: '16px', color: 'var(--text-secondary)' }}>Loading mailboxes...</p>}
              </div>
            </div>
          )}

          {activeTab === 'admin_aliases' && (
            <div className="glass-panel" style={{ padding: '30px' }}>
              <div className="content-header" style={{ marginBottom: '20px' }}>
                <h2>Aliases & Groups (Catch-Alls)</h2>
                <button className="btn btn-primary" onClick={handleAddAlias}><Plus size={16} /> Add Alias</button>
              </div>
              <div className="rules-list">
                {adminAliases.map(alias => (
                  <div key={alias.address} className="condition-row" style={{ justifyContent: 'space-between', padding: '16px' }}>
                    <div>
                      <strong style={{ display: 'block' }}>{alias.address}</strong>
                      <small style={{ color: 'var(--text-secondary)' }}>➔ {alias.goto}</small>
                    </div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button className="btn btn-ghost" style={{ fontSize: '0.85rem' }} onClick={() => openAliasEditor(alias)}>Manage Members</button>
                      <button className="btn btn-danger" style={{ fontSize: '0.85rem' }} onClick={() => handleDeleteAlias(alias.address)}>Delete</button>
                    </div>
                  </div>
                ))}
                {adminAliases.length === 0 && <p style={{ padding: '16px', color: 'var(--text-secondary)' }}>Loading aliases...</p>}
              </div>
            </div>
          )}

          {activeTab === 'admin_quarantine' && (
            <div className="glass-panel" style={{ padding: '30px' }}>
              <div className="content-header" style={{ marginBottom: '20px' }}>
                <h2>Spam Quarantine</h2>
              </div>
              <div className="empty-state">
                <p>Quarantine is currently empty. All good!</p>
              </div>
            </div>
          )}

          {activeTab === 'admin_spam_policies' && (
            <div className="glass-panel" style={{ padding: '30px' }}>
              <div className="content-header" style={{ marginBottom: '20px' }}>
                <h2>Global Spam Policies</h2>
                <button className="btn btn-primary" onClick={handleSaveSpamPolicies} disabled={saving || !adminSpamPolicies}>
                  {saving ? 'Saving...' : 'Save JSON Rules'}
                </button>
              </div>
              <p style={{ color: 'var(--text-secondary)', marginBottom: '10px' }}>Edit hierarchical JSON rules for Rspamd (Whitelists, Blacklists, Banned IPs).</p>
              <textarea 
                className="glass-input" 
                style={{ width: '100%', height: '300px', fontFamily: 'monospace' }} 
                value={adminSpamPolicies ? JSON.stringify(adminSpamPolicies, null, 2) : "Loading..."}
                onChange={(e) => {
                  try {
                    setAdminSpamPolicies(JSON.parse(e.target.value));
                  } catch {
                    return;
                  }
                }}
              />
            </div>
          )}

          {activeTab === 'admin_rspamd' && (
            <div className="glass-panel" style={{ padding: '30px', height: '100%', display: 'flex', flexDirection: 'column' }}>
              <div className="content-header" style={{ marginBottom: '20px' }}>
                <h2>Rspamd Web Interface</h2>
                <button className="btn btn-ghost" onClick={() => window.open('/rspamd/', '_blank', 'noopener,noreferrer')}>
                  <Eye size={16} /> Open in New Tab
                </button>
              </div>
              <iframe title="Rspamd Web Interface" src="/rspamd/" style={{ flex: 1, width: '100%', minHeight: '620px', border: '1px solid var(--border-glass)', borderRadius: '8px', background: '#fff' }} />
            </div>
          )}

          {activeTab === 'admin_branding' && (
            <BrandingPanel
              branding={brandingDraft}
              saving={brandingSaving}
              status={brandingStatus}
              onChange={setBrandingDraft}
              onReset={handleResetBranding}
              onSave={handleSaveBranding}
            />
          )}

          {activeTab === 'admin_settings' && (
            <AdminSettingsPanel
              settings={adminSettings}
              saving={adminSettingsSaving}
              status={adminSettingsStatus}
              onChange={setAdminSettings}
              onSave={handleSaveAdminSettings}
            />
          )}

          {activeTab === 'admin_admins' && (
            <div className="glass-panel" style={{ padding: '30px' }}>
              <div className="content-header" style={{ marginBottom: '20px' }}>
                <h2>Administrators</h2>
                <button className="btn btn-primary" onClick={handlePromoteAdmin}><Plus size={16} /> Promote Mailbox</button>
              </div>
              <div className="rules-list">
                {adminAdmins.length === 0 ? <p style={{ padding: '16px', color: 'var(--text-secondary)' }}>No administrators found.</p> : adminAdmins.map(admin => (
                  <div key={admin.username} className="condition-row" style={{ justifyContent: 'space-between', padding: '16px' }}>
                    <span style={{ fontSize: '1rem', fontWeight: 500 }}>{admin.username}</span>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button className="btn btn-danger" style={{ fontSize: '0.85rem' }} onClick={() => handleDemoteAdmin(admin.username)}>Demote</button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'admin_logs' && (
            <div className="glass-panel" style={{ padding: '30px' }}>
              <div className="content-header" style={{ marginBottom: '20px' }}>
                <h2>Audit Logs</h2>
              </div>
              <div className="rules-list">
                {adminLogs.length === 0 ? <p style={{ padding: '16px', color: 'var(--text-secondary)' }}>No logs found.</p> : adminLogs.map(log => (
                  <div key={log.id} className="condition-row" style={{ padding: '12px 16px', fontSize: '0.9rem' }}>
                    <span style={{ color: 'var(--text-secondary)', width: '150px' }}>{new Date(log.timestamp).toLocaleString()}</span>
                    <strong style={{ width: '150px' }}>{log.username}</strong>
                    <span style={{ background: 'rgba(59, 130, 246, 0.2)', color: 'var(--accent)', padding: '2px 6px', borderRadius: '4px' }}>{log.action}</span>
                    <span style={{ color: 'var(--text-secondary)', marginLeft: '10px' }}>{log.domain} {log.data ? `- ${log.data}` : ''}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {activeTab === 'admin_apikeys' && (
            <div className="glass-panel" style={{ padding: '30px' }}>
              <div className="content-header" style={{ marginBottom: '20px' }}>
                <h2>API Keys</h2>
                <button className="btn btn-primary" onClick={handleCreateApiKey}><Plus size={16} /> Generate Key</button>
              </div>
              <div className="rules-list">
                {adminApiKeys.length === 0 ? (
                  <div className="empty-state"><p>No external API keys generated.</p></div>
                ) : (
                  adminApiKeys.map(k => (
                    <div key={k.id} className="condition-row" style={{ justifyContent: 'space-between', padding: '16px' }}>
                      <div>
                        <strong style={{ display: 'block' }}>{k.description}</strong>
                        <small style={{ color: 'var(--text-secondary)' }}>Created: {new Date(k.created_at).toLocaleString()}</small>
                      </div>
                      <button className="btn btn-danger" style={{ fontSize: '0.85rem' }} onClick={() => handleDeleteApiKey(k.id)}>Revoke</button>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {activeTab === 'admin_updates' && (
            <div className="glass-panel" style={{ padding: '30px', textAlign: 'center' }}>
              <div style={{ fontSize: '3rem', margin: '20px 0' }}>📦</div>
              <h2>System Updates</h2>
              <p style={{ margin: '10px 0', fontSize: '1.1rem' }}>Current Version: <strong>v{adminUpdates?.current_version || '...'}</strong></p>
              <p style={{ fontSize: '1.1rem', marginBottom: '30px' }}>Latest Release: <strong>v{adminUpdates?.latest_version || '...'}</strong></p>
              
              <div style={{ background: 'rgba(255, 255, 255, 0.05)', border: '1px solid rgba(255, 255, 255, 0.1)', padding: '20px', borderRadius: '8px' }}>
                <h3 style={{ marginBottom: '10px' }}>{adminUpdates?.has_update ? 'Update Available!' : 'System is Up to Date'}</h3>
                <p style={{ color: 'var(--text-secondary)' }}>{adminUpdates?.has_update ? 'Click the button below to upgrade your system components.' : 'You are running the latest version of OpenMailStack.'}</p>
                {adminUpdates?.has_update && <button className="btn btn-primary" style={{ marginTop: '16px' }}>Run Upgrade</button>}
              </div>

              <div style={{ marginTop: '40px', textAlign: 'left', background: 'var(--bg-dark)', padding: '20px', borderRadius: '8px' }}>
                <h3 style={{ marginBottom: '16px' }}>Component Versions</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                  {adminUpdates?.components && Object.entries(adminUpdates.components).map(([k, v]) => (
                    <div key={k} style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ color: 'var(--text-secondary)' }}>{k}</span>
                      <span>{String(v)}</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {appMode === 'settings' && (
            <SettingsContent
              activeTab={activeTab}
              loading={loading}
              saving={saving}
              settingsSyncError={settingsSyncError}
              rules={rules}
              folders={folders}
              signatures={signatures}
              mailSettings={mailSettings}
              calendarSettings={calendarSettings}
              contactsSettings={contactsSettings}
              availableSenders={availableSenders}
              calendars={calendars.map(calendar => ({ id: calendar.id, name: calendar.name }))}
              forwardingGoto={forwardingGoto}
              passwords={passwords}
              appearance={appearance}
              copiedSetupField={copiedSetupField}
              setupValues={setupValues}
              setupMailboxAddress={setupMailboxAddress}
              onAddRule={addRule}
              onUpdateRule={updateRule}
              onDeleteRule={deleteRule}
              onSaveRules={handleSave}
              onAddSignature={handleAddSignature}
              onUpdateSignatures={handleUpdateSignatures}
              onMailSettingsChange={handleMailSettingsChange}
              onCalendarSettingsChange={handleCalendarSettingsChange}
              onContactsSettingsChange={setContactsSettings}
              onForwardingChange={setForwardingGoto}
              onSaveForwarding={handleSaveForwarding}
              onPasswordChange={setPasswords}
              onAppearanceChange={setAppearance}
              onCopySetupValue={copySetupValue}
            />
          )}

          {appMode === 'sync' && activeTab === 'sync_info' && (
            <div className="glass-panel" style={{ padding: '30px', height: '100%', overflowY: 'auto' }}>
              <div className="content-header" style={{ marginBottom: '20px', alignItems: 'center' }}>
                <div>
                  <h2 style={{ marginBottom: '6px' }}>Sync Info</h2>
                  <p style={{ color: 'var(--text-secondary)', margin: 0 }}>Copy the correct addresses for mail, calendar, contacts, iOS, Android, and desktop apps.</p>
                </div>
                <button className="btn btn-ghost" onClick={refreshCurrentView} disabled={isRefreshing} title="Refresh sync info" aria-label="Refresh sync info">
                  <RefreshCw size={18} /> Refresh
                </button>
              </div>
              <div className="sync-setup-body" style={{ padding: 0, overflow: 'visible' }}>
                {renderSyncSetupSections('all')}
              </div>
            </div>
          )}

          {appMode === 'calendar' && activeTab === 'calendar_month' && (
            <PanelGroup id="oms-cal-v8" orientation="horizontal" defaultLayout={calendarPanelLayout.defaultLayout} onLayoutChanged={calendarPanelLayout.onLayoutChanged} style={{ width: '100%', height: '100%', minHeight: 0 }}>
              <Panel id="calendar-sidebar" defaultSize={20} minSize={20}>
                <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                  <div style={{ padding: '16px', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                    <button 
                      className="btn btn-primary" 
                      style={{ width: '100%', display: 'flex', justifyContent: 'center', gap: '8px' }}
                      onClick={() => {
                        setEditingCalendarEvent(null);
                        setNewEventData(createDefaultEventDraft(new Date()));
                        setIsEventModalOpen(true);
                        setIsAdvancedEventMode(false);
                      }}
                    >
                      <Plus size={16} /> New Event
                    </button>
                  </div>
                  <div style={{ padding: '16px', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                    <h3 style={{ margin: 0 }}>Calendars</h3>
                  </div>
                  <div style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>
                    {calendars.map(cal => (
                      <div key={cal.id} className="nav-item group" style={{ display: 'flex', alignItems: 'center' }}>
                        <input 
                          type="checkbox" 
                          checked={cal.isVisible} 
                          onChange={(e) => setCalendars(calendars.map(c => c.id === cal.id ? {...c, isVisible: e.target.checked} : c))}
                          style={{ marginRight: '8px', cursor: 'pointer' }}
                        />
                        <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: cal.color, marginRight: '8px' }}></div>
                        <span style={{ flex: 1 }}>{cal.name}</span>
                        <div style={{ display: 'flex', gap: '4px', opacity: 0.5 }}>
                          <button className="btn btn-ghost" style={{ padding: '2px' }} title="Edit calendar" aria-label={`Edit ${cal.name}`} onClick={(e) => {
                             e.stopPropagation();
                             openCalendarEditor(cal);
                          }}><Edit2 size={12} /></button>
                          <button className="btn btn-ghost" style={{ padding: '2px' }} title="Delete calendar" aria-label={`Delete ${cal.name}`} onClick={(e) => {
                             e.stopPropagation();
                             deleteCalendar(cal);
                          }} disabled={deletingCalendarId === cal.id}><Trash2 size={12} /></button>
                        </div>
                      </div>
                    ))}
                    <div className="nav-item" style={{ marginTop: '16px', color: 'var(--text-secondary)', cursor: 'pointer' }} onClick={() => {
                       const name = window.prompt("New calendar name:");
                       if (name) {
                         const colors = ['#3498db', '#e74c3c', '#2ecc71', '#f1c40f', '#9b59b6', '#e67e22'];
                         const color = colors[calendars.length % colors.length];
                         fetch('/api/apps/calendars', {
                             method: 'POST',
                             headers: getHeaders(),
                             body: JSON.stringify({ name, color })
                         }).then(r => r.json()).then(d => {
                             if (d.success) refreshCalendars();
                         });
                       }
                    }}>
                      <Plus size={16} style={{ marginRight: '8px' }} /> Add Calendar
                    </div>
                  </div>
                </div>
              </Panel>
              <PanelResizeHandle style={{ width: '16px', cursor: 'col-resize', position: 'relative' }}>
                <div style={{ position: 'absolute', top: 0, bottom: 0, left: '6px', right: '6px', background: 'rgba(255,255,255,0.1)', borderRadius: '4px' }} />
              </PanelResizeHandle>
              <Panel id="calendar-view" minSize={30}>
                <div className="glass-panel" style={{ padding: '30px', height: '100%', display: 'flex', flexDirection: 'column' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                      <h2 style={{ margin: 0 }}>{format(currentDate, calendarView === 'day' ? 'MMMM d, yyyy' : calendarView === 'year' ? 'yyyy' : 'MMMM yyyy')}</h2>
                      <button className="btn btn-ghost" onClick={() => setCurrentDate(new Date())}>Today</button>
                      <button className="btn btn-ghost" onClick={() => navigateApp('sync')} title="Calendar sync information" aria-label="Calendar sync information">
                        <Link2 size={18} /> Sync Info
                      </button>
                    </div>
                    <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
                      <div style={{ display: 'flex', background: 'rgba(255,255,255,0.05)', borderRadius: '6px', padding: '2px' }}>
                        <button className={`btn ${calendarView === 'day' ? 'btn-primary' : 'btn-ghost'}`} style={{ padding: '4px 12px' }} onClick={() => setCalendarView('day')}>Day</button>
                        <button className={`btn ${calendarView === 'week' ? 'btn-primary' : 'btn-ghost'}`} style={{ padding: '4px 12px' }} onClick={() => setCalendarView('week')}>Week</button>
                        <button className={`btn ${calendarView === 'month' ? 'btn-primary' : 'btn-ghost'}`} style={{ padding: '4px 12px' }} onClick={() => setCalendarView('month')}>Month</button>
                        <button className={`btn ${calendarView === 'year' ? 'btn-primary' : 'btn-ghost'}`} style={{ padding: '4px 12px' }} onClick={() => setCalendarView('year')}>Year</button>
                      </div>
                      <div style={{ display: 'flex', gap: '8px' }}>
                        <button className="btn btn-ghost" onClick={() => setCurrentDate(calendarView === 'year' ? subMonths(currentDate, 12) : calendarView === 'month' ? subMonths(currentDate, 1) : calendarView === 'week' ? subWeeks(currentDate, 1) : subDays(currentDate, 1))}><ChevronLeft size={18} /></button>
                        <button className="btn btn-ghost" onClick={() => setCurrentDate(calendarView === 'year' ? addMonths(currentDate, 12) : calendarView === 'month' ? addMonths(currentDate, 1) : calendarView === 'week' ? addWeeks(currentDate, 1) : addDays(currentDate, 1))}><ChevronRight size={18} /></button>
                      </div>
                    </div>
                  </div>
                  
                  {calendarView === 'year' ? (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px', flex: 1, overflowY: 'auto' }}>
                      {Array.from({length: 12}).map((_, m) => {
                         const monthDate = new Date(currentDate.getFullYear(), m, 1);
                         const start = startOfWeek(startOfMonth(monthDate));
                         const end = endOfWeek(endOfMonth(monthDate));
                         const days = [];
                         let d = start;
                         while (d <= end) {
                           days.push(d);
                           d = addDays(d, 1);
                         }
                         return (
                           <div key={m} style={{ background: 'rgba(255,255,255,0.02)', borderRadius: '8px', padding: '16px', border: '1px solid rgba(255,255,255,0.05)' }}>
                             <h3 style={{ margin: '0 0 12px 0', fontSize: '1.1rem', textAlign: 'center', cursor: 'pointer' }} onClick={() => { setCurrentDate(monthDate); setCalendarView('month'); }}>{format(monthDate, 'MMMM')}</h3>
                             <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px', fontSize: '0.75rem', color: 'var(--text-secondary)', textAlign: 'center', marginBottom: '8px' }}>
                               {['S','M','T','W','T','F','S'].map((day, i) => <div key={i}>{day}</div>)}
                             </div>
                             <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px' }}>
                               {days.map((day, i) => (
                                  <div key={i} onClick={() => { setCurrentDate(day); setCalendarView('day'); }} style={{ textAlign: 'center', padding: '4px 0', fontSize: '0.8rem', borderRadius: '50%', background: isSameDay(day, new Date()) ? 'var(--accent-primary)' : 'transparent', color: isSameDay(day, new Date()) ? 'var(--bg-dark)' : isSameMonth(day, monthDate) ? 'inherit' : 'rgba(255,255,255,0.2)', cursor: 'pointer' }}>
                                    {format(day, 'd')}
                                  </div>
                               ))}
                             </div>
                           </div>
                         );
                      })}
                    </div>
                  ) : calendarView === 'month' ? (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '8px', flex: 1, minHeight: 0 }}>
                      {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
                        <div key={day} style={{ textAlign: 'center', fontWeight: 'bold', padding: '10px 0', color: 'var(--text-secondary)' }}>{day}</div>
                      ))}
                      {calendarDays.map((day, i) => {
                        const isCurrentMonth = isSameMonth(day, currentDate);
                        const isTodayDate = isSameDay(day, new Date());
                        const dayEvents = events.filter(e => isSameDay(e.start, day) && calendars.find(c => c.id === e.calendarId)?.isVisible !== false);
                        
                        return (
                          <div key={i} onClick={() => {
                            setEditingCalendarEvent(null);
                            setNewEventData(createDefaultEventDraft(day, true));
                            setIsEventModalOpen(true);
                            setIsAdvancedEventMode(false);
                          }} style={{ 
                            background: isCurrentMonth ? 'rgba(255,255,255,0.02)' : 'transparent',
                            border: '1px solid rgba(255,255,255,0.05)',
                            borderRadius: '8px',
                            padding: '8px',
                            display: 'flex', flexDirection: 'column',
                            opacity: isCurrentMonth ? 1 : 0.3,
                            cursor: 'pointer'
                          }}>
                            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '4px' }}>
                              <div style={{ color: isTodayDate ? 'var(--bg-dark)' : 'var(--text-primary)', fontWeight: isTodayDate ? 'bold' : 'normal', background: isTodayDate ? 'var(--accent-primary)' : 'transparent', borderRadius: '50%', width: '24px', height: '24px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                                {format(day, 'd')}
                              </div>
                            </div>
                            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '4px' }}>
                              {dayEvents.map(e => {
                                const cal = calendars.find(c => c.id === e.calendarId);
                                return (
                                  <div key={`${e.id}:${e.occurrenceId || e.start.toISOString()}`} onClick={(ev) => { ev.stopPropagation(); openCalendarEvent(e); }} style={{ padding: '2px 6px', background: cal ? `${cal.color}33` : 'rgba(255,255,255,0.1)', color: cal ? cal.color : 'white', fontSize: '0.75rem', borderRadius: '4px', cursor: 'pointer', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                    {!e.isAllDay && <span style={{ marginRight: '4px' }}>{format(e.start, 'h:mm a')}</span>}
                                    {e.title}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', background: 'rgba(255,255,255,0.02)', borderRadius: '8px', overflow: 'hidden', border: '1px solid rgba(255,255,255,0.05)' }}>
                      <div style={{ display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                        <div style={{ width: '60px' }}></div>
                        {(calendarView === 'week' ? weekDays : [currentDate]).map((day, i) => {
                          const isTodayDate = isSameDay(day, new Date());
                          return (
                           <div key={i} style={{ flex: 1, textAlign: 'center', padding: '10px 0', borderLeft: '1px solid rgba(255,255,255,0.05)' }}>
                             <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>{format(day, 'EEE')}</div>
                             <div style={{ fontSize: '1.4rem', marginTop: '4px', fontWeight: isTodayDate ? 'bold' : 'normal', color: isTodayDate ? 'var(--bg-dark)' : 'inherit', background: isTodayDate ? 'var(--accent-primary)' : 'transparent', width: '32px', height: '32px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', borderRadius: '50%' }}>{format(day, 'd')}</div>
                           </div>
                          );
                        })}
                      </div>
                      <div style={{ flex: 1, overflowY: 'auto', display: 'flex', position: 'relative' }}>
                        <div style={{ width: '60px', flexShrink: 0, borderRight: '1px solid rgba(255,255,255,0.05)' }}>
                          {Array.from({length: 24}).map((_, h) => (
                            <div key={h} style={{ height: '60px', position: 'relative' }}>
                              <span style={{ position: 'absolute', top: '-10px', right: '8px', fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                                {h === 0 ? '' : h < 12 ? `${h} AM` : h === 12 ? '12 PM' : `${h-12} PM`}
                              </span>
                            </div>
                          ))}
                        </div>
                        <div style={{ flex: 1, position: 'relative', display: 'flex' }}>
                          {Array.from({length: 24}).map((_, h) => (
                            <div key={h} style={{ position: 'absolute', top: `${h * 60}px`, left: 0, right: 0, height: '1px', background: 'rgba(255,255,255,0.05)' }}></div>
                          ))}
                          {(calendarView === 'week' ? weekDays : [currentDate]).map((day, i) => {
                             const dayEvents = events.filter(e => isSameDay(e.start, day) && !e.isAllDay && calendars.find(c => c.id === e.calendarId)?.isVisible !== false);
                             return (
                               <div key={i} style={{ flex: 1, borderLeft: i > 0 ? '1px solid rgba(255,255,255,0.05)' : 'none', position: 'relative' }}>
                                 {Array.from({length: 24}).map((_, h) => (
                                   <div key={`click-${h}`} onClick={() => {
                                     const clickedDate = new Date(day);
                                     clickedDate.setHours(h, 0, 0, 0);
                                     setEditingCalendarEvent(null);
                                     setNewEventData(createDefaultEventDraft(clickedDate));
                                     setIsEventModalOpen(true);
                                     setIsAdvancedEventMode(false);
                                   }} style={{ position: 'absolute', top: `${h * 60}px`, height: '60px', left: 0, right: 0, cursor: 'pointer' }} />
                                 ))}
                                 {dayEvents.map(e => {
                                    const cal = calendars.find(c => c.id === e.calendarId);
                                    const startMinutes = e.start.getHours() * 60 + e.start.getMinutes();
                                    const endMinutes = e.end.getHours() * 60 + e.end.getMinutes();
                                    const duration = Math.max(endMinutes - startMinutes, 30);
                                    return (
                                      <div key={`${e.id}:${e.occurrenceId || e.start.toISOString()}`} onClick={(ev) => { ev.stopPropagation(); openCalendarEvent(e); }} style={{ position: 'absolute', top: `${startMinutes}px`, height: `${duration}px`, left: '4px', right: '4px', background: cal ? `${cal.color}33` : 'rgba(255,255,255,0.1)', color: cal ? cal.color : 'white', borderRadius: '4px', padding: '4px 8px', fontSize: '0.8rem', cursor: 'pointer', overflow: 'hidden', borderLeft: `3px solid ${cal?.color || 'white'}` }}>
                                        <div style={{ fontWeight: 'bold' }}>{e.title}</div>
                                        <div style={{ opacity: 0.8, fontSize: '0.7rem' }}>{format(e.start, 'h:mm a')} - {format(e.end, 'h:mm a')}</div>
                                      </div>
                                    )
                                 })}
                               </div>
                             );
                          })}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </Panel>
            </PanelGroup>
          )}

          {appMode === 'contacts' && activeTab === 'contacts_list' && (
            <PanelGroup id="oms-contacts-v8" orientation="horizontal" defaultLayout={contactsPanelLayout.defaultLayout} onLayoutChanged={contactsPanelLayout.onLayoutChanged} style={{ width: '100%', height: '100%', minHeight: 0 }}>
              <Panel id="contacts-sidebar" defaultSize={20} minSize={20}>
                <div className="glass-panel" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
                  <div style={{ padding: '16px', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                    <button
                      className="btn btn-primary"
                      style={{ width: '100%', display: 'flex', justifyContent: 'center', gap: '8px' }}
                      disabled={contactsView === 'directory'}
                      title={contactsView === 'directory' ? 'Global directory entries are managed from Admin > Mailboxes' : 'New Contact'}
                    >
                      <User size={16} /> New Contact
                    </button>
                  </div>
                  <div style={{ padding: '16px', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                    <h3 style={{ margin: 0 }}>Address Books</h3>
                  </div>
                  <div style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>
                    <div className={`nav-item ${contactsView === 'personal' ? 'active' : ''}`} onClick={() => setContactsView('personal')}>
                      <Users size={18} style={{ marginRight: '8px' }} /> Personal Contacts
                    </div>
                    <div className={`nav-item ${contactsView === 'directory' ? 'active' : ''}`} onClick={() => setContactsView('directory')}>
                      <Users size={18} style={{ marginRight: '8px' }} /> Global Directory (GAL)
                    </div>
                    <div className="nav-item" style={{ marginTop: '16px', color: 'var(--text-secondary)' }}>
                      <Plus size={16} style={{ marginRight: '8px' }} /> New Address Book
                    </div>
                  </div>
                </div>
              </Panel>
              <PanelResizeHandle style={{ width: '16px', cursor: 'col-resize', position: 'relative' }}>
                <div style={{ position: 'absolute', top: 0, bottom: 0, left: '6px', right: '6px', background: 'rgba(255,255,255,0.1)', borderRadius: '4px' }} />
              </PanelResizeHandle>
              <Panel id="contacts-view" minSize={30}>
                <div className="glass-panel" style={{ padding: '30px', height: '100%', display: 'flex', flexDirection: 'column' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px' }}>
                    <h2 style={{ margin: 0 }}>{contactsView === 'directory' ? 'Global Directory' : 'Address Book'}</h2>
                    <button className="btn btn-ghost" onClick={() => navigateApp('sync')} title="Contacts sync information" aria-label="Contacts sync information">
                      <Link2 size={18} /> Sync Info
                    </button>
                  </div>
                  {(contactsActionError || contactsActionStatus) && (
                    <div className={contactsActionError ? 'settings-error-banner' : 'settings-status-banner'} style={{ marginBottom: '16px' }}>
                      {contactsActionError || contactsActionStatus}
                    </div>
                  )}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', overflowY: 'auto' }}>
                    {displayContacts.length === 0 ? (
                      <div style={{ textAlign: 'center', padding: '40px', color: 'var(--text-secondary)' }}>
                        {contactsView === 'directory' ? 'No directory entries are visible.' : 'No contacts found. Send an email to automatically add contacts.'}
                      </div>
                    ) : (
                      displayContacts.map((contact, index) => (
                        <div key={contact.id || contact.email || index} style={{ 
                          display: 'flex', alignItems: 'center', gap: '16px', padding: contactListMetrics.padding, 
                          background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '8px' 
                        }}>
                          <div style={{ 
                            width: `${contactListMetrics.avatar}px`, height: `${contactListMetrics.avatar}px`, borderRadius: '50%', background: 'var(--accent-primary)', 
                            display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 'bold', fontSize: '1.2rem'
                          }}>
                            {contact.displayName !== 'Unknown Name' ? contact.displayName.charAt(0).toUpperCase() : contact.email.charAt(0).toUpperCase()}
                          </div>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontWeight: 'bold', fontSize: contactListMetrics.nameSize }}>{contact.displayName}</div>
                            <div style={{ color: 'var(--text-secondary)' }}>{contact.email}</div>
                            {(contact.phone || contact.company || contact.jobTitle || contact.address) && (
                              <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginTop: '4px' }}>
                                {[contact.jobTitle, contact.company, contact.phone, contact.address].filter(Boolean).join(' · ')}
                              </div>
                            )}
                          </div>
                          {contactsView === 'directory' && (
                            <button className="btn btn-ghost" style={{ padding: '8px 10px', flexShrink: 0 }} onClick={() => handleAddDirectoryContact(contact)} title="Save to Personal Contacts">
                              <UserPlus size={16} />
                            </button>
                          )}
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </Panel>
            </PanelGroup>
          )}

        </main>
      </div>

      {mailUndo && (
        <div style={{
          position: 'fixed',
          left: '50%',
          bottom: '24px',
          transform: 'translateX(-50%)',
          zIndex: 1200,
          display: 'flex',
          alignItems: 'center',
          gap: '14px',
          padding: '12px 14px',
          border: '1px solid rgba(255,255,255,0.16)',
          background: 'rgba(18,18,20,0.96)',
          boxShadow: '0 18px 42px rgba(0,0,0,0.35)',
          borderRadius: '8px',
          color: 'var(--text-primary)'
        }}>
          <span style={{ fontSize: '0.92rem' }}>{mailUndo.label}</span>
          <button className="btn btn-ghost" style={{ padding: '6px 10px' }} onClick={handleUndoMailAction}>
            <Undo2 size={15} /> Undo
          </button>
          <button className="btn btn-ghost" style={{ padding: '6px' }} onClick={() => setMailUndo(null)} title="Dismiss" aria-label="Dismiss undo message">
            <X size={15} />
          </button>
        </div>
      )}

      {syncGuideOpen && (
        <div className="sync-setup-overlay" role="dialog" aria-modal="true" aria-labelledby="sync-setup-title" onClick={() => setSyncGuideOpen(null)}>
          <div className="glass-panel sync-setup-modal" onClick={(e) => e.stopPropagation()}>
            <div className="sync-setup-header">
              <div>
                <div className="sync-setup-eyebrow">{syncGuideOpen === 'calendar' ? 'Calendar' : 'Contacts'}</div>
                <h3 id="sync-setup-title">Sync Setup</h3>
              </div>
              <button className="btn btn-ghost" style={{ padding: '6px' }} onClick={() => setSyncGuideOpen(null)} title="Close" aria-label="Close sync setup">
                <X size={18} />
              </button>
            </div>

            <div className="sync-setup-body">
              {renderSyncSetupSections(syncGuideOpen)}
            </div>
          </div>
        </div>
      )}

      {dnsRecordsModal && (
        <div className="sync-setup-overlay" role="dialog" aria-modal="true" aria-labelledby="dns-records-title" onClick={() => setDnsRecordsModal(null)}>
          <div className="glass-panel sync-setup-modal" onClick={(e) => e.stopPropagation()}>
            <div className="sync-setup-header">
              <div>
                <div className="sync-setup-eyebrow">DNS</div>
                <h3 id="dns-records-title">{dnsRecordsModal.domain}</h3>
              </div>
              <button className="btn btn-ghost" style={{ padding: '6px' }} onClick={() => setDnsRecordsModal(null)} title="Close" aria-label="Close DNS records">
                <X size={18} />
              </button>
            </div>
            <div className="sync-setup-body">
              <section className="sync-setup-section">
                <div className="sync-setup-section-title"><Mail size={16} /> Records</div>
                {dnsRecordsModal.records.map((record, index) => (
                  <div key={`${record.type}-${record.name}-${index}`} style={{ marginTop: index === 0 ? 0 : '10px' }}>
                    {renderSetupCopyRow(`${record.type} ${record.name}`, record.value, `dns-${dnsRecordsModal.domain}-${index}`, record.description)}
                  </div>
                ))}
                {dnsRecordsModal.records.length === 0 && <div className="sync-setup-note">No DNS records were returned.</div>}
              </section>
            </div>
          </div>
        </div>
      )}

      {mailboxEditor && mailboxEditorDraft && (
        <div className="sync-setup-overlay" role="dialog" aria-modal="true" aria-labelledby="mailbox-editor-title" onClick={() => setMailboxEditor(null)}>
          <div className="glass-panel sync-setup-modal" style={{ width: 'min(760px, 100%)' }} onClick={(e) => e.stopPropagation()}>
            <div className="sync-setup-header">
              <div>
                <div className="sync-setup-eyebrow">Mailbox</div>
                <h3 id="mailbox-editor-title">{mailboxEditor.username}</h3>
              </div>
              <button className="btn btn-ghost" style={{ padding: '6px' }} onClick={() => setMailboxEditor(null)} title="Close" aria-label="Close mailbox editor">
                <X size={18} />
              </button>
            </div>
            <div className="sync-setup-body">
              <section className="sync-setup-section">
                <div className="sync-setup-section-title"><User size={16} /> Profile</div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: '14px' }}>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>Mailbox address</span>
                    <input className="glass-input" value={mailboxEditor.username} disabled />
                  </label>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>Display name</span>
                    <input className="glass-input" value={mailboxEditorDraft.name} onChange={(e) => setMailboxEditorDraft({ ...mailboxEditorDraft, name: e.target.value })} />
                  </label>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>Quota in MB</span>
                    <input className="glass-input" type="number" min="-1" value={mailboxEditorDraft.quota} onChange={(e) => setMailboxEditorDraft({ ...mailboxEditorDraft, quota: e.target.value })} />
                  </label>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>Phone</span>
                    <input className="glass-input" value={mailboxEditorDraft.phone} onChange={(e) => setMailboxEditorDraft({ ...mailboxEditorDraft, phone: e.target.value })} />
                  </label>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>Alternate email</span>
                    <input className="glass-input" value={mailboxEditorDraft.alternateEmail} onChange={(e) => setMailboxEditorDraft({ ...mailboxEditorDraft, alternateEmail: e.target.value })} />
                  </label>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>Company</span>
                    <input className="glass-input" value={mailboxEditorDraft.company} onChange={(e) => setMailboxEditorDraft({ ...mailboxEditorDraft, company: e.target.value })} />
                  </label>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>Title</span>
                    <input className="glass-input" value={mailboxEditorDraft.jobTitle} onChange={(e) => setMailboxEditorDraft({ ...mailboxEditorDraft, jobTitle: e.target.value })} />
                  </label>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', gridColumn: '1 / -1' }}>
                    <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>Address</span>
                    <input className="glass-input" value={mailboxEditorDraft.streetAddress} onChange={(e) => setMailboxEditorDraft({ ...mailboxEditorDraft, streetAddress: e.target.value })} />
                  </label>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>City</span>
                    <input className="glass-input" value={mailboxEditorDraft.city} onChange={(e) => setMailboxEditorDraft({ ...mailboxEditorDraft, city: e.target.value })} />
                  </label>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>State / Region</span>
                    <input className="glass-input" value={mailboxEditorDraft.region} onChange={(e) => setMailboxEditorDraft({ ...mailboxEditorDraft, region: e.target.value })} />
                  </label>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>Postal code</span>
                    <input className="glass-input" value={mailboxEditorDraft.postalCode} onChange={(e) => setMailboxEditorDraft({ ...mailboxEditorDraft, postalCode: e.target.value })} />
                  </label>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>Country</span>
                    <input className="glass-input" value={mailboxEditorDraft.country} onChange={(e) => setMailboxEditorDraft({ ...mailboxEditorDraft, country: e.target.value })} />
                  </label>
                  <label style={{ display: 'flex', gap: '10px', alignItems: 'center', gridColumn: '1 / -1' }}>
                    <input type="checkbox" checked={mailboxEditorDraft.showInDirectory} onChange={(e) => setMailboxEditorDraft({ ...mailboxEditorDraft, showInDirectory: e.target.checked })} />
                    <span>Show in Global Directory</span>
                  </label>
                  <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', gridColumn: '1 / -1' }}>
                    <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>Notes</span>
                    <textarea className="glass-input" rows={3} value={mailboxEditorDraft.notes} onChange={(e) => setMailboxEditorDraft({ ...mailboxEditorDraft, notes: e.target.value })} />
                  </label>
                </div>
              </section>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', padding: '0 24px 24px' }}>
              <button className="btn btn-ghost" onClick={() => setMailboxEditor(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleSaveMailboxEditor}>Save</button>
            </div>
          </div>
        </div>
      )}

      {aliasEditor && (
        <div className="sync-setup-overlay" role="dialog" aria-modal="true" aria-labelledby="alias-editor-title" onClick={() => setAliasEditor(null)}>
          <div className="glass-panel sync-setup-modal" style={{ width: 'min(680px, 100%)' }} onClick={(e) => e.stopPropagation()}>
            <div className="sync-setup-header">
              <div>
                <div className="sync-setup-eyebrow">Alias Group</div>
                <h3 id="alias-editor-title">{aliasEditor.address}</h3>
              </div>
              <button className="btn btn-ghost" style={{ padding: '6px' }} onClick={() => setAliasEditor(null)} title="Close" aria-label="Close alias editor">
                <X size={18} />
              </button>
            </div>
            <div className="sync-setup-body">
              <section className="sync-setup-section">
                <div className="sync-setup-section-title"><Users size={16} /> Members</div>
                <label style={{ display: 'flex', flexDirection: 'column', gap: '6px', marginBottom: '14px' }}>
                  <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>Alias address</span>
                  <input className="glass-input" value={aliasEditorAddress} onChange={(e) => setAliasEditorAddress(e.target.value)} />
                </label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '14px' }}>
                  <button className="btn btn-ghost" onClick={() => setSelectedAliasMembers(aliasEditorMembers)}>Select All</button>
                  <button className="btn btn-ghost" onClick={() => setSelectedAliasMembers([])}>Select None</button>
                  <button className="btn btn-danger" onClick={removeSelectedAliasMembers} disabled={selectedAliasMembers.length === 0}>Remove Selected</button>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '16px' }}>
                  {aliasEditorMembers.map(member => {
                    const mailbox = adminMailboxes.find(candidate => candidate.username === member);
                    return (
                      <div key={member} className="condition-row" style={{ padding: '10px 12px', justifyContent: 'space-between' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '10px', minWidth: 0 }}>
                          <input type="checkbox" checked={selectedAliasMembers.includes(member)} onChange={() => toggleAliasMemberSelection(member)} />
                          <span style={{ overflowWrap: 'anywhere' }}>{mailbox?.name ? `${mailbox.name} <${member}>` : member}</span>
                        </label>
                        <button className="btn btn-ghost" style={{ padding: '6px' }} onClick={() => {
                          setAliasEditorMembers(current => current.filter(candidate => candidate !== member));
                          setSelectedAliasMembers(current => current.filter(candidate => candidate !== member));
                        }} title={`Remove ${member}`} aria-label={`Remove ${member}`}>
                          <X size={16} />
                        </button>
                      </div>
                    );
                  })}
                  {aliasEditorMembers.length === 0 && <div style={{ color: 'var(--text-secondary)' }}>No members selected.</div>}
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: '10px' }}>
                  <div>
                    <input className="glass-input" list="alias-member-options" placeholder="Add mailbox or address" value={aliasNewMember} onChange={(e) => setAliasNewMember(e.target.value)} onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        addAliasMember();
                      }
                    }} />
                    <datalist id="alias-member-options">
                      {adminMailboxes
                        .filter(mailbox => !aliasEditorMembers.includes(mailbox.username))
                        .map(mailbox => (
                          <option key={mailbox.username} value={mailbox.username}>{mailbox.name || mailbox.username}</option>
                        ))}
                    </datalist>
                  </div>
                  <button className="btn btn-primary" onClick={addAliasMember}><Plus size={16} /> Add</button>
                </div>
              </section>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px', padding: '0 24px 24px' }}>
              <button className="btn btn-ghost" onClick={() => setAliasEditor(null)}>Cancel</button>
              <button className="btn btn-primary" onClick={handleSaveAliasEditor}>Save</button>
            </div>
          </div>
        </div>
      )}

      {editingCalendar && (
        <div className="sync-setup-overlay" role="dialog" aria-modal="true" aria-labelledby="calendar-editor-title" onClick={() => !calendarEditorSaving && setEditingCalendar(null)}>
          <div className="glass-panel sync-setup-modal" style={{ width: 'min(480px, 100%)' }} onClick={(e) => e.stopPropagation()}>
            <div className="sync-setup-header">
              <div>
                <div className="sync-setup-eyebrow">Calendar</div>
                <h3 id="calendar-editor-title">Edit Calendar</h3>
              </div>
              <button className="btn btn-ghost" style={{ padding: '6px' }} onClick={() => setEditingCalendar(null)} disabled={calendarEditorSaving} title="Close" aria-label="Close calendar editor">
                <X size={18} />
              </button>
            </div>
            <div className="sync-setup-body">
              <section className="sync-setup-section">
                <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '6px' }}>Name</label>
                <input
                  className="glass-input"
                  value={calendarEditorData.name}
                  onChange={(event) => setCalendarEditorData({ ...calendarEditorData, name: event.target.value })}
                  style={{ width: '100%' }}
                  autoFocus
                />

                <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-secondary)', margin: '18px 0 8px' }}>Color</label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(9, 28px)', gap: '8px', marginBottom: '14px' }}>
                  {CALENDAR_COLOR_OPTIONS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      onClick={() => setCalendarEditorData({ ...calendarEditorData, color })}
                      title={color}
                      aria-label={`Use calendar color ${color}`}
                      style={{
                        width: '28px',
                        height: '28px',
                        borderRadius: '50%',
                        border: calendarEditorData.color.toLowerCase() === color.toLowerCase() ? '2px solid #fff' : '1px solid rgba(255,255,255,0.25)',
                        background: color,
                        cursor: 'pointer',
                        boxShadow: calendarEditorData.color.toLowerCase() === color.toLowerCase() ? `0 0 0 3px ${color}66` : 'none'
                      }}
                    />
                  ))}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <input
                    type="color"
                    value={calendarEditorData.color}
                    onChange={(event) => setCalendarEditorData({ ...calendarEditorData, color: event.target.value })}
                    style={{ width: '44px', height: '36px', padding: 0, border: '1px solid var(--border-glass)', background: 'transparent', borderRadius: '6px' }}
                    aria-label="Custom calendar color"
                  />
                  <code className="sync-copy-value" style={{ fontSize: '0.85rem' }}>{calendarEditorData.color}</code>
                </div>
                {calendarEditorError && <div style={{ color: 'var(--danger)', fontSize: '0.85rem', marginTop: '12px' }}>{calendarEditorError}</div>}
              </section>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '12px' }}>
                <button className="btn btn-ghost" onClick={() => setEditingCalendar(null)} disabled={calendarEditorSaving}>Cancel</button>
                <button className="btn btn-primary" onClick={saveCalendarEditor} disabled={calendarEditorSaving}>
                  {calendarEditorSaving ? 'Saving...' : 'Save Calendar'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {selectedCalendarEvent && (() => {
        const calendar = calendars.find((cal) => cal.id === selectedCalendarEvent.calendarId);
        return (
          <div className="sync-setup-overlay" role="dialog" aria-modal="true" aria-labelledby="calendar-event-title" onClick={() => setSelectedCalendarEvent(null)}>
            <div className="glass-panel sync-setup-modal" style={{ width: 'min(560px, 100%)' }} onClick={(e) => e.stopPropagation()}>
              <div className="sync-setup-header">
                <div style={{ minWidth: 0 }}>
                  <div className="sync-setup-eyebrow">{calendar?.name || 'Calendar'}</div>
                  <h3 id="calendar-event-title" style={{ overflowWrap: 'anywhere' }}>{selectedCalendarEvent.title || 'Untitled event'}</h3>
                </div>
                <button className="btn btn-ghost" style={{ padding: '6px' }} onClick={() => setSelectedCalendarEvent(null)} title="Close" aria-label="Close event details">
                  <X size={18} />
                </button>
              </div>
              <div className="sync-setup-body">
                <section className="sync-setup-section">
                  <div className="sync-status-row">
                    <span style={{ width: '90px', color: 'var(--text-secondary)' }}>When</span>
                    <span>{formatCalendarEventRange(selectedCalendarEvent)}</span>
                  </div>
                  <div className="sync-status-row">
                    <span style={{ width: '90px', color: 'var(--text-secondary)' }}>Calendar</span>
                    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ width: '10px', height: '10px', borderRadius: '50%', background: calendar?.color || 'var(--accent-primary)' }} />
                      {calendar?.name || 'Calendar'}
                    </span>
                  </div>
                  {selectedCalendarEvent.recurrenceLabel && (
                    <div className="sync-status-row">
                      <span style={{ width: '90px', color: 'var(--text-secondary)' }}>Repeats</span>
                      <span>{selectedCalendarEvent.recurrenceLabel}</span>
                    </div>
                  )}
                  {selectedCalendarEvent.location && (
                    <div className="sync-status-row">
                      <span style={{ width: '90px', color: 'var(--text-secondary)' }}>Location</span>
                      <span>{selectedCalendarEvent.location}</span>
                    </div>
                  )}
                  {selectedCalendarEvent.description && (
                    <div className="sync-status-row" style={{ alignItems: 'flex-start' }}>
                      <span style={{ width: '90px', color: 'var(--text-secondary)' }}>Details</span>
                      <span style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{selectedCalendarEvent.description}</span>
                    </div>
                  )}
                </section>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px' }}>
                  <button className="btn btn-danger" onClick={() => deleteCalendarEvent(selectedCalendarEvent)}>
                    <Trash2 size={16} /> Delete
                  </button>
                  <button className="btn btn-primary" onClick={() => beginEditCalendarEvent(selectedCalendarEvent)}>
                    <Edit2 size={16} /> Edit event
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {isComposing && (
        <div style={{ 
          position: 'fixed', 
          ...(composeDocked ? {
            bottom: '0',
            right: '40px',
            width: '500px',
            height: '600px',
            borderBottomLeftRadius: 0,
            borderBottomRightRadius: 0,
            boxShadow: '0 -4px 20px rgba(0,0,0,0.5)',
            zIndex: 1000
          } : {
            top: 0, left: 0, right: 0, bottom: 0, 
            background: 'rgba(0,0,0,0.8)', 
            display: 'flex', alignItems: 'center', justifyContent: 'center', 
            zIndex: 1000 
          })
        }}>
          <div className="glass-panel" style={{ 
            width: composeDocked ? '100%' : '600px', 
            height: composeDocked ? '100%' : 'auto',
            background: '#1a1a1a', 
            display: 'flex', 
            flexDirection: 'column',
            ...(composeDocked && { borderRadius: '16px 16px 0 0', borderBottom: 'none' })
          }}>
            <div style={{ padding: '16px', borderBottom: '1px solid rgba(255,255,255,0.1)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'rgba(255,255,255,0.05)' }}>
              <h3 style={{ margin: 0 }}>New Message</h3>
              <div style={{ display: 'flex', gap: '8px' }}>
                <button className="btn btn-ghost" style={{ padding: '4px' }} onClick={() => setComposeDocked(!composeDocked)}>
                  {composeDocked ? <Maximize2 size={18} /> : <Minimize2 size={18} />}
                </button>
                <button className="btn btn-ghost" style={{ padding: '4px' }} onClick={() => setIsComposing(false)}>
                  <X size={18} />
                </button>
              </div>
            </div>
            <div style={{ padding: '16px', display: 'flex', flexDirection: 'column', gap: '12px', flex: 1, overflowY: 'auto' }}>
              <datalist id="contacts-list">
                {recipientContacts.map(c => (
                  <option key={`${c.source || 'personal'}:${c.email}`} value={contactOptionValue(c)} label={c.source === 'directory' ? 'Global Directory' : 'Personal Contact'} />
                ))}
              </datalist>
              <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                <label style={{ width: '40px', color: 'var(--text-secondary)' }}>From:</label>
                <select className="glass-input glass-select" style={{ flex: 1 }} value={composeFrom} onChange={e => setComposeFrom(e.target.value)}>
	                  <option value={userIdentities.address || currentUsername}>
	                    {userIdentities.name ? `${userIdentities.name} <${userIdentities.address}>` : (userIdentities.address || currentUsername)}
                  </option>
                  {userIdentities.aliases.map(alias => (
                    <option key={alias} value={alias}>{userIdentities.name ? `${userIdentities.name} <${alias}>` : alias}</option>
                  ))}
                </select>
              </div>
              <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                <label style={{ width: '40px', color: 'var(--text-secondary)' }}>To:</label>
                <input list="contacts-list" className="glass-input" style={{ flex: 1 }} value={composeTo} onChange={e => setComposeTo(e.target.value)} />
                <button className="btn btn-ghost" style={{ padding: '4px 8px', fontSize: '0.8rem' }} onClick={() => setShowCc(!showCc)}>Cc</button>
                <button className="btn btn-ghost" style={{ padding: '4px 8px', fontSize: '0.8rem' }} onClick={() => setShowBcc(!showBcc)}>Bcc</button>
              </div>
              {showCc && (
                <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                  <label style={{ width: '40px', color: 'var(--text-secondary)' }}>Cc:</label>
                  <input list="contacts-list" className="glass-input" style={{ flex: 1 }} value={composeCc} onChange={e => setComposeCc(e.target.value)} />
                </div>
              )}
              {showBcc && (
                <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                  <label style={{ width: '40px', color: 'var(--text-secondary)' }}>Bcc:</label>
                  <input list="contacts-list" className="glass-input" style={{ flex: 1 }} value={composeBcc} onChange={e => setComposeBcc(e.target.value)} />
                </div>
              )}
              <div style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                <label style={{ width: '40px', color: 'var(--text-secondary)' }}>Subj:</label>
                <input className="glass-input" style={{ flex: 1 }} value={composeSubject} onChange={e => setComposeSubject(e.target.value)} />
              </div>
              <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', background: '#fff', borderRadius: '4px', marginTop: '12px', color: '#000' }}>
                <Suspense fallback={<div style={{ padding: '16px', color: '#333' }}>Loading editor...</div>}>
                  <ReactQuill 
                    theme="snow"
                    value={composeBody}
                    onChange={setComposeBody}
                    style={{ height: '100%', display: 'flex', flexDirection: 'column' }}
                    modules={{
                      toolbar: [
                        [{ 'header': [1, 2, 3, false] }],
                        ['bold', 'italic', 'underline', 'strike', 'blockquote'],
                        [{'list': 'ordered'}, {'list': 'bullet'}, {'indent': '-1'}, {'indent': '+1'}],
                        ['link', 'image'],
                        ['clean']
                      ]
                    }}
                  />
                </Suspense>
              </div>
              <div style={{ padding: '8px 0', borderTop: '1px dashed rgba(255,255,255,0.1)' }}>
                <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', display: 'block', marginBottom: '8px' }}>Attachments:</span>
                <input 
                  type="file" 
                  multiple 
                  style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }} 
                  onChange={e => {
                    if (e.target.files) {
                      setComposeAttachments(Array.from(e.target.files));
                    }
                  }}
                />
                {composeAttachments.length > 0 && (
                  <div style={{ marginTop: '8px', fontSize: '0.85rem' }}>
                    {composeAttachments.map((f, i) => <div key={i}>📎 {f.name}</div>)}
                  </div>
                )}
              </div>
            </div>
            <div style={{ padding: '16px', borderTop: '1px solid rgba(255,255,255,0.1)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Signature:</span>
                <select className="glass-input glass-select" style={{ padding: '4px 30px 4px 8px', fontSize: '0.85rem' }} value={composeSignature} onChange={e => {
                  setComposeSignature(e.target.value);
                  if (e.target.value !== 'none') {
                    const sigContent = signatures.find(s => s.id === e.target.value)?.content || '';
                    const sigHtml = '<br><br>' + sigContent.replace(/\n/g, '<br>') + '<br>' + (userIdentities.name || 'OpenMailStack User');
                    if (!composeBody.includes(sigHtml)) {
                      setComposeBody(composeBody + sigHtml);
                    }
                  }
                }}>
                  <option value="none">None</option>
                  {signatures.map(s => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>
              <button className="btn btn-primary" onClick={handleSend} disabled={sending}>
                <Send size={16} /> {sending ? 'Sending...' : 'Send'}
              </button>
            </div>
          </div>
        </div>
      )}

      {isEventModalOpen && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="glass-panel" style={{ width: isAdvancedEventMode ? '800px' : '500px', maxHeight: '90vh', overflowY: 'auto', background: 'var(--surface-color)', padding: '24px', display: 'flex', flexDirection: 'column', gap: '16px', transition: 'width 0.2s' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h3 style={{ margin: 0 }}>{editingCalendarEvent ? (isAdvancedEventMode ? 'Edit Event Details' : 'Edit Event') : (isAdvancedEventMode ? 'New Event Details' : 'New Event')}</h3>
              <button className="btn btn-ghost" onClick={() => { setIsEventModalOpen(false); setEditingCalendarEvent(null); }}><X size={18} /></button>
            </div>

            <div style={{ display: isAdvancedEventMode ? 'grid' : 'block', gridTemplateColumns: '1fr 300px', gap: '32px' }}>
              
              {/* LEFT COLUMN (or full width if simple) */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <input 
                  type="text" 
                  className="glass-input" 
                  placeholder="Event Title" 
                  value={newEventData.title}
                  onChange={e => setNewEventData({...newEventData, title: e.target.value})}
                  autoFocus
                  style={{ fontSize: '1.2rem', fontWeight: 'bold' }}
                />
                
                <div style={{ display: 'flex', gap: '16px', alignItems: 'center' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <input type="checkbox" id="allday" checked={newEventData.isAllDay} onChange={e => setNewEventData({...newEventData, isAllDay: e.target.checked})} />
                    <label htmlFor="allday">All Day</label>
                  </div>
                  {isAdvancedEventMode && (
                    <select className="glass-input glass-select" value={newEventData.timezone} onChange={e => setNewEventData({...newEventData, timezone: e.target.value})}>
                      {Intl.supportedValuesOf('timeZone').map(tz => (
                        <option key={tz} value={tz}>{tz}</option>
                      ))}
                    </select>
                  )}
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>Start</label>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <input type="date" className="glass-input" style={{ flex: 2 }} value={format(newEventData.start, 'yyyy-MM-dd')} onChange={e => {
                         const [y,m,d] = e.target.value.split('-').map(Number);
                         const dObj = new Date(newEventData.start); dObj.setFullYear(y, m-1, d);
                         setNewEventData({...newEventData, start: dObj});
                      }} />
                      {!newEventData.isAllDay && <input type="time" className="glass-input" style={{ flex: 1 }} value={format(newEventData.start, 'HH:mm')} onChange={e => {
                         const [h,m] = e.target.value.split(':').map(Number);
                         const dObj = new Date(newEventData.start); dObj.setHours(h, m);
                         setNewEventData({...newEventData, start: dObj});
                      }} />}
                    </div>
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>End</label>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <input type="date" className="glass-input" style={{ flex: 2 }} value={format(newEventData.end, 'yyyy-MM-dd')} onChange={e => {
                         const [y,m,d] = e.target.value.split('-').map(Number);
                         const dObj = new Date(newEventData.end); dObj.setFullYear(y, m-1, d);
                         setNewEventData({...newEventData, end: dObj});
                      }} />
                      {!newEventData.isAllDay && <input type="time" className="glass-input" style={{ flex: 1 }} value={format(newEventData.end, 'HH:mm')} onChange={e => {
                         const [h,m] = e.target.value.split(':').map(Number);
                         const dObj = new Date(newEventData.end); dObj.setHours(h, m);
                         setNewEventData({...newEventData, end: dObj});
                      }} />}
                    </div>
                  </div>
                </div>

                {isAdvancedEventMode && (
                  <>
                    <div>
                      <select className="glass-input glass-select" value={newEventData.recurrence} onChange={e => setNewEventData({...newEventData, recurrence: e.target.value})}>
                        <option value="none">Does not repeat</option>
                        <option value="daily">Daily</option>
                        <option value="weekly">Weekly</option>
                        <option value="monthly">Monthly</option>
                        <option value="yearly">Yearly</option>
                      </select>
                    </div>

                    <div style={{ display: 'flex', gap: '20px', borderBottom: '1px solid rgba(255,255,255,0.1)', marginTop: '8px', paddingBottom: '8px' }}>
                      <span style={{ fontWeight: 'bold', borderBottom: '2px solid var(--accent-primary)', paddingBottom: '8px', marginBottom: '-9px' }}>Event details</span>
                      <span style={{ color: 'var(--text-secondary)', cursor: 'pointer' }}>Find a time</span>
                    </div>

                    <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '8px' }}>
                      <input type="text" className="glass-input" placeholder="Add location" value={newEventData.location} onChange={e => setNewEventData({...newEventData, location: e.target.value})} />
                      
                      <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        <span style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>Notification</span>
                        <input type="number" className="glass-input" style={{ width: '60px' }} value={newEventData.notifications[0].time} onChange={e => setNewEventData({...newEventData, notifications: [{...newEventData.notifications[0], time: Number(e.target.value)}]})} />
                        <span style={{ fontSize: '0.85rem' }}>minutes</span>
                      </div>

                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '16px' }}>
                        <div>
                          <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>Calendar</label>
                          <select className="glass-input glass-select" value={newEventData.calendarId} onChange={e => setNewEventData({...newEventData, calendarId: Number(e.target.value)})}>
                            {calendars.map(cal => (
                              <option key={cal.id} value={cal.id}>{cal.name}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>Show as</label>
                          <select className="glass-input glass-select" value={newEventData.busyStatus} onChange={e => setNewEventData({...newEventData, busyStatus: e.target.value})}>
                            <option value="busy">Busy</option>
                            <option value="free">Free</option>
                          </select>
                        </div>
                      </div>

                      <div>
                        <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>Visibility</label>
                        <select className="glass-input glass-select" value={newEventData.visibility} onChange={e => setNewEventData({...newEventData, visibility: e.target.value})}>
                          <option value="default">Default visibility</option>
                          <option value="public">Public</option>
                          <option value="private">Private</option>
                        </select>
                      </div>

                      <textarea 
                        className="glass-input" 
                        placeholder="Add description" 
                        rows={4}
                        value={newEventData.description}
                        onChange={e => setNewEventData({...newEventData, description: e.target.value})}
                      />
                    </div>
                  </>
                )}

                {!isAdvancedEventMode && (
                  <div>
                    <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '4px' }}>Calendar</label>
                    <select className="glass-input glass-select" value={newEventData.calendarId} onChange={e => setNewEventData({...newEventData, calendarId: Number(e.target.value)})}>
                      {calendars.map(cal => (
                        <option key={cal.id} value={cal.id}>{cal.name}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              {/* RIGHT COLUMN (only in advanced mode) */}
              {isAdvancedEventMode && (
                <div style={{ borderLeft: '1px solid rgba(255,255,255,0.1)', paddingLeft: '32px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  <div style={{ fontWeight: 'bold' }}>Guests</div>
                  <input type="text" className="glass-input" placeholder="Add guests" value={newEventData.guests} onChange={e => setNewEventData({...newEventData, guests: e.target.value})} />
                  
                  <div style={{ marginTop: '16px' }}>
                    <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '8px' }}>Guest permissions</div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <input type="checkbox" id="perm-modify" />
                        <label htmlFor="perm-modify" style={{ fontSize: '0.9rem' }}>Modify event</label>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <input type="checkbox" id="perm-invite" checked={newEventData.guestPermissions.invite} onChange={e => setNewEventData({...newEventData, guestPermissions: {...newEventData.guestPermissions, invite: e.target.checked}})} />
                        <label htmlFor="perm-invite" style={{ fontSize: '0.9rem' }}>Invite others</label>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <input type="checkbox" id="perm-see" checked={newEventData.guestPermissions.seeList} onChange={e => setNewEventData({...newEventData, guestPermissions: {...newEventData.guestPermissions, seeList: e.target.checked}})} />
                        <label htmlFor="perm-see" style={{ fontSize: '0.9rem' }}>See guest list</label>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '16px' }}>
              {!isAdvancedEventMode ? (
                <button className="btn btn-ghost" onClick={() => setIsAdvancedEventMode(true)}>More options</button>
              ) : (
                <div />
              )}
              <div style={{ display: 'flex', gap: '12px' }}>
                <button className="btn btn-ghost" onClick={() => { setIsEventModalOpen(false); setEditingCalendarEvent(null); }}>Cancel</button>
                <button className="btn btn-primary" onClick={() => {
                  const uid = editingCalendarEvent?.id || Math.random().toString(36).substring(2) + "@openmailstack";
                  
                  const formatIcalDate = (d: Date, isAllDay: boolean) => {
                      if (isAllDay) {
                          return d.toISOString().split('T')[0].replace(/-/g, '');
                      }
                      return d.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
                  };
                  const recurrenceLine = recurrenceToRrule(newEventData.recurrence);

                  const icalLines = [
                      "BEGIN:VCALENDAR",
                      "VERSION:2.0",
                      "PRODID:-//OpenMailStack//WebCalendar//EN",
                      "BEGIN:VEVENT",
                      `UID:${uid}`,
                      `DTSTAMP:${formatIcalDate(new Date(), false)}`,
                      `DTSTART${newEventData.isAllDay ? ';VALUE=DATE' : ''}:${formatIcalDate(newEventData.start, newEventData.isAllDay)}`,
                      `DTEND${newEventData.isAllDay ? ';VALUE=DATE' : ''}:${formatIcalDate(newEventData.end, newEventData.isAllDay)}`,
                      `SUMMARY:${escapeIcalText(newEventData.title)}`,
                      `DESCRIPTION:${escapeIcalText(newEventData.description)}`,
                      `LOCATION:${escapeIcalText(newEventData.location)}`,
                      recurrenceLine,
                      "END:VEVENT",
                      "END:VCALENDAR"
                  ].filter(Boolean);
                  const ical_data = icalLines.join('\r\n');

                  fetch('/api/apps/events', {
                      method: 'POST',
                      headers: getHeaders(),
                      body: JSON.stringify({ calendar_id: newEventData.calendarId, uid, ical_data })
                  }).then(r => r.json()).then(d => {
                      if (d.success) refreshCalendars();
                      setEditingCalendarEvent(null);
                  });

                  setIsEventModalOpen(false);
                }}>{editingCalendarEvent ? 'Save Changes' : 'Save Event'}</button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

export default App;
