# Phase 1 — Architecture & Foundation: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Decompose the 7,524-line monolithic `App.tsx` into per-app directories with React Router v7, mobile responsive layout, virtual scrolling, and skeleton loading states — all without losing any existing functionality.

**Architecture:** Extract shared primitives first (types, API client, hooks, components), then each app (mail, contacts, calendar, notes, settings, admin) one at a time. Each app gets its own directory with `routes.tsx`, layout component, view components, and a `useApp` hook for state. React Router v7 handles URL structure via nested routes and `<Outlet>`. Mobile responsiveness uses CSS media queries + a `useMediaQuery` hook to switch between desktop multi-pane and mobile single-pane drill-down.

**Tech Stack:** React 19.2, Vite 8, TypeScript 6, React Router v7 (`react-router`), @tanstack/react-virtual, react-resizable-panels, lucide-react, date-fns

## Global Constraints

- **Scope:** `webmail-frontend/` only — no changes to `webmail-backend/`, IMAP/Dovecot/Postfix, or ActiveSync
- **Incremental:** Each task group ends with a working, shippable state — the app builds and functions at every step
- **No behavior changes:** Existing functionality is preserved identically; this is a structural refactor
- **No new major dependencies** beyond `react-router` and `@tanstack/react-virtual`
- **Existing `App.tsx` stays functional** until each app is fully extracted and verified
- **Build must pass:** `tsc -b && vite build` after every task group

---

## File Structure Map

Before tasks begin, here is every file that will exist after this plan:

```
webmail-frontend/src/
├── main.tsx                              # [MODIFY] Add BrowserRouter
├── App.tsx                               # [REPLACE] Slim shell: auth gate + routes
├── App.css                               # [DELETE] Unused template artifact
├── index.css                             # [MODIFY] Add mobile/responsive rules + skeleton animation
├── branding.ts                           # [UNCHANGED]
├── LiveNoteEditor.tsx                    # [MOVE to notes/]
│
├── shared/
│   ├── types.ts                          # [CREATE] All interfaces from App.tsx lines 27-291
│   ├── api.ts                            # [CREATE] fetch wrappers + API functions
│   ├── components/
│   │   ├── Skeleton.tsx                  # [CREATE] Reusable skeleton with shimmer
│   │   ├── GlassPanel.tsx                # [CREATE] Reusable glass-panel wrapper
│   │   ├── EmptyState.tsx                # [CREATE] Reusable empty state
│   │   └── ErrorBanner.tsx              # [CREATE] Reusable error display
│   ├── hooks/
│   │   ├── useAuth.ts                   # [CREATE] Session, identities, logout
│   │   ├── useAppearance.ts             # [CREATE] Theme, density, accent, font scale
│   │   ├── useMediaQuery.ts             # [CREATE] Responsive breakpoint detection
│   │   ├── useKeyboardShortcuts.ts      # [CREATE] Global hotkeys
│   │   └── useAppNavigation.ts          # [CREATE] derive active app from URL
│   └── layouts/
│       ├── AuthGate.tsx                  # [CREATE] Redirects to login if unauthenticated
│       └── AppShell.tsx                  # [CREATE] Header, mobile tab bar, content area
│
├── mail/
│   ├── routes.tsx                        # [CREATE] Nested routes for mail
│   ├── MailLayout.tsx                    # [CREATE] 3-pane PanelGroup shell
│   ├── FolderSidebar.tsx                 # [CREATE] Folder tree + compose button + quota
│   ├── MessageList.tsx                   # [CREATE] Virtualized list + selection
│   ├── MessageRow.tsx                    # [CREATE] Single message row
│   ├── MessageViewer.tsx                 # [CREATE] Thread view + attachments
│   ├── ComposeModal.tsx                  # [CREATE] Compose/reply/forward
│   ├── SearchBar.tsx                     # [CREATE] Search input + operator hints
│   ├── MailToolbar.tsx                   # [CREATE] Select all, bulk actions
│   ├── hooks/
│   │   ├── useMail.ts                   # [CREATE] Mail state + API calls
│   │   └── useFolders.ts                # [CREATE] Folder tree logic
│   └── components/
│       ├── AttachmentCard.tsx            # [CREATE] Attachment display
│       ├── ThreadItem.tsx                # [CREATE] Single message in thread
│       └── DraftBanner.tsx              # [CREATE] "This is a draft" indicator
│       └── MessageListSkeleton.tsx       # [CREATE] Skeleton for message list
│
├── calendar/
│   ├── routes.tsx                        # [CREATE] Nested routes
│   ├── CalendarLayout.tsx                # [CREATE] 2-pane PanelGroup
│   ├── CalendarSidebar.tsx               # [CREATE] Calendar list + visibility
│   ├── CalendarToolbar.tsx               # [CREATE] View nav + date nav + today
│   ├── views/
│   │   ├── MonthView.tsx                 # [CREATE] Month grid
│   │   ├── WeekView.tsx                  # [CREATE] Week time grid + DnD
│   │   ├── DayView.tsx                   # [CREATE] Day time grid + DnD
│   │   ├── YearView.tsx                  # [CREATE] 12-month mini grid
│   │   └── AgendaView.tsx               # [CREATE] Scrolling event list
│   ├── EventModal.tsx                    # [CREATE] Simple + advanced editor
│   ├── hooks/
│   │   └── useCalendar.ts              # [CREATE] Calendar state + API
│   └── components/
│       ├── EventPill.tsx                 # [CREATE] Event pill in month view
│       ├── TimeSlot.tsx                  # [CREATE] Time slot in week/day
│       ├── CalendarColorPicker.tsx       # [CREATE] 9-color swatch picker
│       ├── ShareModal.tsx                # [CREATE] Calendar sharing
│       └── CalendarSkeleton.tsx          # [CREATE] Month skeleton
│
├── contacts/
│   ├── routes.tsx                        # [CREATE] Nested routes
│   ├── ContactsLayout.tsx                # [CREATE] 2-pane PanelGroup
│   ├── ContactSidebar.tsx                # [CREATE] Address books, labels, groups
│   ├── ContactGrid.tsx                   # [CREATE] Virtualized grid
│   ├── ContactList.tsx                   # [CREATE] Virtualized list
│   ├── ContactModal.tsx                  # [CREATE] Full contact editor
│   ├── hooks/
│   │   └── useContacts.ts              # [CREATE] Contacts state + API
│   └── components/
│       ├── ContactCard.tsx               # [CREATE] Grid card
│       ├── ContactRow.tsx                # [CREATE] List row
│       ├── AlphabetScrubber.tsx          # [CREATE] A-Z sidebar
│       ├── DuplicateMergeModal.tsx        # [CREATE] Merge duplicates
│       ├── LabelEditor.tsx               # [CREATE] Create/edit label
│       └── ContactSkeleton.tsx           # [CREATE] Skeleton for contacts
│
├── notes/
│   ├── routes.tsx                        # [CREATE] Nested routes
│   ├── NotesLayout.tsx                   # [CREATE] 2-pane PanelGroup
│   ├── NotesSidebar.tsx                  # [CREATE] Filter nav + labels
│   ├── NotesGrid.tsx                     # [CREATE] CSS Grid card layout
│   ├── NoteModal.tsx                     # [CREATE] Editor + LiveNoteEditor
│   ├── LiveNoteEditor.tsx               # [MOVE from src/]
│   ├── hooks/
│   │   └── useNotes.ts                 # [CREATE] Notes state + API
│   └── components/
│       ├── NoteCard.tsx                  # [CREATE] Note card
│       ├── LabelChip.tsx                 # [CREATE] Label badge
│       └── NoteSkeleton.tsx             # [CREATE] Skeleton for notes
│
├── settings/
│   ├── routes.tsx                        # [CREATE] Nested routes
│   ├── SettingsLayout.tsx                # [CREATE] Sidebar + content
│   ├── SettingsPanel.tsx                 # [MOVE existing, refactor to use layout]
│   ├── tabs.ts                           # [MOVE existing]
│   ├── settingsApi.ts                    # [MOVE existing]
│   └── appearance.ts                     # [MOVE existing]
│
└── admin/
    ├── routes.tsx                        # [CREATE] Nested routes
    ├── AdminLayout.tsx                   # [CREATE] Sidebar + content
    ├── AdminModals.tsx                   # [MOVE existing]
    ├── BrandingPanel.tsx                 # [MOVE existing]
    ├── AdminSettingsPanel.tsx            # [MOVE existing]
    ├── TelemetryPanel.tsx                # [MOVE existing]
    ├── SystemHealthDashboard.tsx         # [MOVE existing]
    ├── Fail2banPanel.tsx                 # [MOVE existing]
    └── adminSettingsApi.ts              # [MOVE existing]
```

---

## Task Group 1: Dependencies & Router Scaffold

### Task 1.1: Install new dependencies

**Files:**
- Modify: `webmail-frontend/package.json`

**Interfaces:**
- Produces: `react-router` ^7.x and `@tanstack/react-virtual` ^3.x available in `node_modules/`

- [ ] **Step 1: Install react-router and @tanstack/react-virtual**

```bash
cd /root/openmailstack/webmail-frontend && npm install react-router @tanstack/react-virtual
```

- [ ] **Step 2: Verify install**

```bash
cd /root/openmailstack/webmail-frontend && node -e "require('react-router'); console.log('react-router OK')" && node -e "require('@tanstack/react-virtual'); console.log('virtual OK')"
```

Expected: `react-router OK` then `virtual OK`

- [ ] **Step 3: Commit**

```bash
git add webmail-frontend/package.json webmail-frontend/package-lock.json
git commit -m "chore: add react-router v7 and @tanstack/react-virtual

Co-Authored-By: Claude <noreply@anthropic.com>"
```

### Task 1.2: Create shared types file

**Files:**
- Create: `webmail-frontend/src/shared/types.ts`

**Interfaces:**
- Produces: All TypeScript interfaces previously defined in `App.tsx` lines 27-292, exported for consumption by all apps

- [ ] **Step 1: Create the types file by extracting interfaces from App.tsx lines 27-292**

Create `webmail-frontend/src/shared/types.ts` with the following content extracted from the existing `App.tsx` (no changes to the interfaces themselves):

```typescript
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
```

- [ ] **Step 2: Verify types compile**

```bash
cd /root/openmailstack/webmail-frontend && npx tsc --noEmit src/shared/types.ts
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add webmail-frontend/src/shared/types.ts
git commit -m "refactor: extract all shared TypeScript interfaces to shared/types.ts

Co-Authored-By: Claude <noreply@anthropic.com>"
```

### Task 1.3: Create useAuth hook

**Files:**
- Create: `webmail-frontend/src/shared/hooks/useAuth.ts`

**Interfaces:**
- Consumes: Types from `shared/types.ts`
- Produces: `useAuth()` returning `{ user, userIdentities, isLoading, isAuthenticated, login(email, password), logout(), fetchMe() }`

- [ ] **Step 1: Create the hook file**

Create `webmail-frontend/src/shared/hooks/useAuth.ts`:

```typescript
import { useState, useEffect, useCallback } from 'react';
import type { UserIdentities } from '../types';

interface AuthState {
  user: { email: string; name: string } | null;
  userIdentities: UserIdentities | null;
  isLoading: boolean;
  isAuthenticated: boolean;
}

export function useAuth(): AuthState & {
  login: (email: string, password: string) => Promise<boolean>;
  logout: () => Promise<void>;
  fetchMe: () => Promise<void>;
} {
  const [user, setUser] = useState<{ email: string; name: string } | null>(null);
  const [userIdentities, setUserIdentities] = useState<UserIdentities | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const fetchMe = useCallback(async () => {
    try {
      const res = await fetch('/api/auth/me');
      if (res.ok) {
        const data = await res.json();
        if (data.email) {
          setUser({ email: data.email, name: data.name || data.email });
          // Fetch identities
          const identRes = await fetch('/api/user/identities');
          if (identRes.ok) {
            const identData = await identRes.json();
            setUserIdentities(identData);
          }
          setIsLoading(false);
          return;
        }
      }
      setUser(null);
      setUserIdentities(null);
    } catch {
      setUser(null);
      setUserIdentities(null);
    }
    setIsLoading(false);
  }, []);

  useEffect(() => {
    fetchMe();
  }, [fetchMe]);

  const login = useCallback(async (email: string, password: string): Promise<boolean> => {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (res.ok) {
      await fetchMe();
      return true;
    }
    return false;
  }, [fetchMe]);

  const logout = useCallback(async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    setUser(null);
    setUserIdentities(null);
  }, []);

  return {
    user,
    userIdentities,
    isLoading,
    isAuthenticated: !!user,
    login,
    logout,
    fetchMe,
  };
}
```

- [ ] **Step 2: Commit**

```bash
git add webmail-frontend/src/shared/hooks/useAuth.ts
git commit -m "feat: add useAuth hook — session, identities, login, logout

Co-Authored-By: Claude <noreply@anthropic.com>"
```

### Task 1.4: Create useAppearance hook

**Files:**
- Create: `webmail-frontend/src/shared/hooks/useAppearance.ts`

**Interfaces:**
- Consumes: `settings/appearance.ts` existing functions
- Produces: `useAppearance()` returning `{ appearance, setAppearance, updateAppearance(partial), applyToDocument() }`

- [ ] **Step 1: Create the hook**

Create `webmail-frontend/src/shared/hooks/useAppearance.ts`:

```typescript
import { useState, useEffect, useCallback } from 'react';
import {
  loadAppearancePreferences,
  saveAppearancePreferences,
  applyAppearancePreferences,
  type AppearancePreferences,
} from '../../settings/appearance';

export function useAppearance() {
  const [appearance, setAppearance] = useState<AppearancePreferences>(() =>
    loadAppearancePreferences()
  );

  const updateAppearance = useCallback((partial: Partial<AppearancePreferences>) => {
    setAppearance((prev) => {
      const next = { ...prev, ...partial };
      saveAppearancePreferences(next);
      applyAppearancePreferences(next);
      return next;
    });
  }, []);

  useEffect(() => {
    applyAppearancePreferences(appearance);
  }, [appearance]);

  return { appearance, setAppearance, updateAppearance };
}
```

- [ ] **Step 2: Commit**

```bash
git add webmail-frontend/src/shared/hooks/useAppearance.ts
git commit -m "feat: add useAppearance hook — theme, density, accent

Co-Authored-By: Claude <noreply@anthropic.com>"
```

### Task 1.5: Create useMediaQuery hook

**Files:**
- Create: `webmail-frontend/src/shared/hooks/useMediaQuery.ts`

**Interfaces:**
- Produces: `useMediaQuery(query: string): boolean` — returns true when the media query matches

- [ ] **Step 1: Create the hook**

Create `webmail-frontend/src/shared/hooks/useMediaQuery.ts`:

```typescript
import { useState, useEffect } from 'react';

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => {
    if (typeof window !== 'undefined') {
      return window.matchMedia(query).matches;
    }
    return false;
  });

  useEffect(() => {
    const mql = window.matchMedia(query);
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches);
    mql.addEventListener('change', handler);
    setMatches(mql.matches);
    return () => mql.removeEventListener('change', handler);
  }, [query]);

  return matches;
}
```

- [ ] **Step 2: Commit**

```bash
git add webmail-frontend/src/shared/hooks/useMediaQuery.ts
git commit -m "feat: add useMediaQuery hook for responsive breakpoints

Co-Authored-By: Claude <noreply@anthropic.com>"
```

### Task 1.6: Create AuthGate and AppShell layouts

**Files:**
- Create: `webmail-frontend/src/shared/layouts/AuthGate.tsx`
- Create: `webmail-frontend/src/shared/layouts/AppShell.tsx`

**Interfaces:**
- Consumes: `useAuth`, `useAppearance`, `useMediaQuery`
- Produces: `<AuthGate>` (redirects to login if unauthenticated), `<AppShell>` (header + mobile tab bar + `<Outlet />`)

- [ ] **Step 1: Create AuthGate**

Create `webmail-frontend/src/shared/layouts/AuthGate.tsx`:

```typescript
import { Outlet } from 'react-router';
import { useAuth } from '../hooks/useAuth';

export function AuthGate() {
  const { isLoading, isAuthenticated } = useAuth();

  if (isLoading) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        minHeight: '100vh', background: 'var(--bg-main)', color: 'var(--text-secondary)',
      }}>
        Loading...
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginPage />;
  }

  return <Outlet />;
}

// Import the existing login JSX — for now, render inline.
// In Task 1.7, this gets replaced when App.tsx is rewritten.
function LoginPage() {
  // Rendered by the existing App.tsx until the shell is complete.
  // When App.tsx is rewritten in Task 1.7, the login form moves here.
  return null;
}
```

- [ ] **Step 2: Create AppShell**

Create `webmail-frontend/src/shared/layouts/AppShell.tsx`:

```typescript
import { Outlet, Link, useLocation } from 'react-router';
import { useAuth } from '../hooks/useAuth';
import { useAppearance } from '../hooks/useAppearance';
import { useMediaQuery } from '../hooks/useMediaQuery';
import { Settings, ShieldAlert, Activity, Mail, CalendarDays, Users, StickyNote } from 'lucide-react';

// Map path segments to app identifiers for highlighting active tab
function useActiveApp(): string {
  const { pathname } = useLocation();
  if (pathname.startsWith('/mail')) return 'mail';
  if (pathname.startsWith('/calendar')) return 'calendar';
  if (pathname.startsWith('/contacts')) return 'contacts';
  if (pathname.startsWith('/notes')) return 'notes';
  if (pathname.startsWith('/settings')) return 'settings';
  if (pathname.startsWith('/admin')) return 'admin';
  if (pathname.startsWith('/sync')) return 'sync';
  return 'mail';
}

export function AppShell() {
  const { user, logout } = useAuth();
  const { appearance } = useAppearance();
  const isMobile = useMediaQuery('(max-width: 767px)');
  const activeApp = useActiveApp();

  const navItems = [
    { id: 'mail', label: 'Mail', icon: Mail, path: '/mail/inbox' },
    { id: 'calendar', label: 'Calendar', icon: CalendarDays, path: '/calendar/month' },
    { id: 'contacts', label: 'Contacts', icon: Users, path: '/contacts' },
    { id: 'notes', label: 'Notes', icon: StickyNote, path: '/notes' },
  ];

  return (
    <div className="app-shell" style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      {/* Desktop header */}
      {!isMobile && (
        <header className="app-shell-header" style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '0 20px', height: 56, borderBottom: '1px solid var(--border-glass)',
          background: 'var(--bg-glass)', backdropFilter: 'blur(12px)',
        }}>
          <nav style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
            <AppLogo />
            {navItems.map((item) => (
              <Link
                key={item.id}
                to={item.path}
                className="nav-item"
                style={{
                  padding: '8px 16px', borderRadius: 'var(--radius-md)',
                  fontWeight: activeApp === item.id ? 700 : 400,
                  color: activeApp === item.id ? 'var(--accent-primary)' : 'var(--text-secondary)',
                  textDecoration: 'none', fontSize: '0.9rem',
                }}
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <Link to="/sync" className="nav-item" style={{
              padding: '8px 12px', borderRadius: 'var(--radius-md)',
              color: activeApp === 'sync' ? 'var(--accent-primary)' : 'var(--text-secondary)',
              textDecoration: 'none', fontSize: '0.85rem',
            }}>
              <Activity size={16} style={{ marginRight: 4 }} />
              Sync
            </Link>
            <Link to="/settings" style={{ color: 'var(--text-secondary)', padding: 4 }}>
              <Settings size={18} />
            </Link>
            <Link to="/admin" style={{ color: 'var(--text-secondary)', padding: 4 }}>
              <ShieldAlert size={18} />
            </Link>
            <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
              {user?.email}
            </span>
            <button onClick={logout} className="btn btn-ghost" style={{ fontSize: '0.85rem' }}>
              Logout
            </button>
          </div>
        </header>
      )}

      {/* Main content */}
      <main className="main-content" style={{
        flex: 1, display: 'flex', flexDirection: 'column',
        paddingBottom: isMobile ? 56 : 0,
      }}>
        <Outlet />
      </main>

      {/* Mobile bottom tab bar */}
      {isMobile && (
        <nav className="mobile-tab-bar" style={{
          display: 'flex', position: 'fixed', bottom: 0, left: 0, right: 0,
          height: 56, paddingBottom: 'env(safe-area-inset-bottom, 0)',
          background: 'var(--bg-glass)', backdropFilter: 'blur(12px)',
          borderTop: '1px solid var(--border-glass)', zIndex: 100,
        }}>
          {navItems.map((item) => (
            <Link
              key={item.id}
              to={item.path}
              style={{
                flex: 1, display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center',
                color: activeApp === item.id ? 'var(--accent-primary)' : 'var(--text-secondary)',
                textDecoration: 'none', fontSize: '0.7rem', gap: 2,
              }}
            >
              <item.icon size={20} />
              {item.label}
            </Link>
          ))}
        </nav>
      )}
    </div>
  );
}

function AppLogo() {
  return (
    <span style={{
      fontWeight: 700, fontSize: '1.1rem', marginRight: 16,
      background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-purple))',
      WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
    }}>
      OpenMailStack
    </span>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add webmail-frontend/src/shared/layouts/
git commit -m "feat: add AuthGate and AppShell layout components

Co-Authored-By: Claude <noreply@anthropic.com>"
```

### Task 1.7: Rewrite App.tsx as the router shell

**Files:**
- Modify: `webmail-frontend/src/main.tsx` (add BrowserRouter)
- Replace: `webmail-frontend/src/App.tsx` (rewrite as slim shell)
- Delete: `webmail-frontend/src/App.css` (template artifact, unused)

**Interfaces:**
- Consumes: `AuthGate`, `AppShell`, all route files
- Produces: Working router shell with placeholder route components

**IMPORTANT:** The old `App.tsx` is renamed to `App.legacy.tsx` during this step so it can still be referenced during extraction. Nothing is deleted yet.

- [ ] **Step 1: Back up the current App.tsx**

```bash
cp /root/openmailstack/webmail-frontend/src/App.tsx /root/openmailstack/webmail-frontend/src/App.legacy.tsx
```

- [ ] **Step 2: Update main.tsx to add BrowserRouter**

Edit `webmail-frontend/src/main.tsx` — replace the entire file:

```typescript
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import './index.css';
import App from './App';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>
);
```

- [ ] **Step 3: Rewrite App.tsx as the router shell**

Replace `webmail-frontend/src/App.tsx` with a slim shell that imports from the legacy file temporarily for the login page. Each route's `element` points to a placeholder that will be filled in during subsequent task groups:

```typescript
import { Routes, Route, Navigate } from 'react-router';
import { AuthGate } from './shared/layouts/AuthGate';
import { AppShell } from './shared/layouts/AppShell';

// Placeholder components — each will be replaced with the real app routes
// as we extract them from App.legacy.tsx
function MailPlaceholder() {
  return <div className="glass-panel" style={{ margin: 20, padding: 40, textAlign: 'center', color: 'var(--text-secondary)' }}>Mail — coming soon</div>;
}
function CalendarPlaceholder() {
  return <div className="glass-panel" style={{ margin: 20, padding: 40, textAlign: 'center', color: 'var(--text-secondary)' }}>Calendar — coming soon</div>;
}
function ContactsPlaceholder() {
  return <div className="glass-panel" style={{ margin: 20, padding: 40, textAlign: 'center', color: 'var(--text-secondary)' }}>Contacts — coming soon</div>;
}
function NotesPlaceholder() {
  return <div className="glass-panel" style={{ margin: 20, padding: 40, textAlign: 'center', color: 'var(--text-secondary)' }}>Notes — coming soon</div>;
}
function SettingsPlaceholder() {
  return <div className="glass-panel" style={{ margin: 20, padding: 40, textAlign: 'center', color: 'var(--text-secondary)' }}>Settings — coming soon</div>;
}
function AdminPlaceholder() {
  return <div className="glass-panel" style={{ margin: 20, padding: 40, textAlign: 'center', color: 'var(--text-secondary)' }}>Admin — coming soon</div>;
}
function SyncPlaceholder() {
  return <div className="glass-panel" style={{ margin: 20, padding: 40, textAlign: 'center', color: 'var(--text-secondary)' }}>Sync Info — coming soon</div>;
}

export default function App() {
  return (
    <Routes>
      <Route element={<AuthGate />}>
        <Route element={<AppShell />}>
          <Route path="mail/*" element={<MailPlaceholder />} />
          <Route path="calendar/*" element={<CalendarPlaceholder />} />
          <Route path="contacts/*" element={<ContactsPlaceholder />} />
          <Route path="notes/*" element={<NotesPlaceholder />} />
          <Route path="settings/*" element={<SettingsPlaceholder />} />
          <Route path="admin/*" element={<AdminPlaceholder />} />
          <Route path="sync" element={<SyncPlaceholder />} />
          <Route index element={<Navigate to="/mail/inbox" replace />} />
        </Route>
      </Route>
    </Routes>
  );
}
```

- [ ] **Step 4: Delete the unused App.css**

```bash
rm /root/openmailstack/webmail-frontend/src/App.css
```

- [ ] **Step 5: Verify the app builds**

```bash
cd /root/openmailstack/webmail-frontend && npx tsc -b 2>&1 | head -50
```

Expected: Type errors about the AuthGate login page being incomplete are acceptable at this stage. The router shell must not have import resolution errors. Fix any import errors before proceeding.

Note: The login page is still in `App.legacy.tsx` — at this point the app will show the "Loading..." screen from AuthGate because `useAuth` needs the login form wired up. This is expected. The login form gets moved into AuthGate in Task 2.1.

- [ ] **Step 6: Commit**

```bash
git add webmail-frontend/src/main.tsx webmail-frontend/src/App.tsx webmail-frontend/src/App.legacy.tsx
git rm webmail-frontend/src/App.css 2>/dev/null; git add webmail-frontend/src/App.css 2>/dev/null
git commit -m "refactor: replace App.tsx with React Router shell, backup legacy App

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task Group 2: Shared Components & API Layer

### Task 2.1: Move login form into AuthGate

**Files:**
- Modify: `webmail-frontend/src/shared/layouts/AuthGate.tsx`
- Modify: `webmail-frontend/src/App.legacy.tsx` (reference only — the login JSX lives here at lines ~4048-4113)

**Interfaces:**
- Consumes: `useAuth` from `shared/hooks/useAuth`
- Produces: Working login page rendered inside AuthGate when unauthenticated

- [ ] **Step 1: Identify login form code in legacy App.tsx**

The login form is in the `App()` return statement, roughly lines 4064-4113 in `App.legacy.tsx`. It renders when `!user` (no authenticated user). The login form includes: branding logo, email input, password input, "Sign In" button, and error message display.

- [ ] **Step 2: Replace AuthGate's LoginPage with the real login form**

Replace the `LoginPage` function in `webmail-frontend/src/shared/layouts/AuthGate.tsx` with the extracted login form. Use the `useAuth` hook's `login` function and add local state for the form fields and error message:

```typescript
import { Outlet } from 'react-router';
import { useState } from 'react';
import { useAuth } from '../hooks/useAuth';
import { Mail } from 'lucide-react';

export function AuthGate() {
  const { isLoading, isAuthenticated } = useAuth();

  if (isLoading) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        minHeight: '100vh', background: 'var(--bg-main)', color: 'var(--text-secondary)',
      }}>
        Loading...
      </div>
    );
  }

  if (!isAuthenticated) {
    return <LoginPage />;
  }

  return <Outlet />;
}

function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const ok = await login(email, password);
      if (!ok) {
        setError('Invalid email or password.');
      }
    } catch {
      setError('Connection failed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      minHeight: '100vh', background: 'var(--bg-main)',
      backgroundImage: 'radial-gradient(circle at 15% 50%, rgba(59,130,246,0.08) 0%, transparent 50%), radial-gradient(circle at 85% 30%, rgba(139,92,246,0.08) 0%, transparent 50%)',
    }}>
      <div className="glass-panel" style={{ width: 400, padding: 40 }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{
            width: 48, height: 48, borderRadius: 12,
            background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-purple))',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            margin: '0 auto 16px',
          }}>
            <Mail size={24} color="white" />
          </div>
          <h1 style={{ fontSize: '1.5rem', fontWeight: 600, margin: 0 }}>
            OpenMailStack
          </h1>
          <p style={{ color: 'var(--text-secondary)', marginTop: 8, fontSize: '0.9rem' }}>
            Sign in to your account
          </p>
        </div>

        <form onSubmit={handleSubmit}>
          {error && (
            <div style={{
              background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
              borderRadius: 'var(--radius-md)', padding: '10px 14px', marginBottom: 16,
              color: 'var(--danger)', fontSize: '0.85rem',
            }}>
              {error}
            </div>
          )}

          <input
            type="email"
            className="glass-input"
            placeholder="Email address"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            autoFocus
            style={{ width: '100%', marginBottom: 12 }}
          />

          <input
            type="password"
            className="glass-input"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            style={{ width: '100%', marginBottom: 24 }}
          />

          <button
            type="submit"
            className="btn btn-primary"
            disabled={submitting}
            style={{ width: '100%' }}
          >
            {submitting ? 'Signing in...' : 'Sign In'}
          </button>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify the app builds**

```bash
cd /root/openmailstack/webmail-frontend && npx tsc -b 2>&1 | head -20
```

Expected: Clean build with no errors (the legacy imports in AuthGate should resolve correctly).

- [ ] **Step 4: Commit**

```bash
git add webmail-frontend/src/shared/layouts/AuthGate.tsx
git commit -m "feat: wire real login form into AuthGate

Co-Authored-By: Claude <noreply@anthropic.com>"
```

### Task 2.2: Create shared API client

**Files:**
- Create: `webmail-frontend/src/shared/api.ts`

**Interfaces:**
- Consumes: Types from `shared/types.ts`
- Produces: `apiClient` object with methods for all backend endpoints

- [ ] **Step 1: Create the API client**

Create `webmail-frontend/src/shared/api.ts`:

```typescript
import type {
  MessageListResponse, MessageResponse, MessageActionResponse,
  SearchResponse, SearchIndexStatusResponse, SearchIndexRefreshResponse,
  SearchWorkerStatusResponse, SavedSearch,
  MailFolder, Signature, Rule,
  ContactsResponse, Contact, ContactLabel, ContactGroup,
  CalendarsResponse, Calendar, CalendarEvent, CalendarUpdateResponse, CalendarDeleteResponse,
  Note,
  UserIdentities,
} from './types';

// ---- Auth ----
export async function fetchMe(): Promise<{ email?: string; name?: string }> {
  const res = await fetch('/api/auth/me');
  if (!res.ok) throw new Error('Not authenticated');
  return res.json();
}

export async function fetchIdentities(): Promise<UserIdentities> {
  const res = await fetch('/api/user/identities');
  if (!res.ok) throw new Error('Failed to fetch identities');
  return res.json();
}

// ---- Mail ----
export async function fetchFolders(): Promise<MailFolder[]> {
  const res = await fetch('/api/folders');
  if (!res.ok) throw new Error('Failed to fetch folders');
  const data = await res.json();
  return data.folders || [];
}

export async function fetchMessages(
  folder: string,
  olderThan?: number,
): Promise<MessageListResponse> {
  const params = olderThan ? `?olderThan=${olderThan}` : '';
  const res = await fetch(`/api/folders/${encodeURIComponent(folder)}/messages${params}`);
  if (!res.ok) throw new Error('Failed to fetch messages');
  return res.json();
}

export async function fetchMessage(folder: string, uid: number): Promise<MessageResponse> {
  const res = await fetch(`/api/folders/${encodeURIComponent(folder)}/messages/${uid}`);
  if (!res.ok) throw new Error('Failed to fetch message');
  return res.json();
}

export async function sendMessage(formData: FormData): Promise<MessageActionResponse> {
  const res = await fetch('/api/messages/send', { method: 'POST', body: formData });
  if (!res.ok) throw new Error('Failed to send message');
  return res.json();
}

export async function saveDraft(formData: FormData): Promise<{ draftId?: string; error?: string }> {
  const res = await fetch('/api/messages/draft', { method: 'POST', body: formData });
  return res.json();
}

export async function messageAction(
  action: string,
  folder: string,
  uids: number[],
): Promise<MessageActionResponse> {
  const res = await fetch('/api/messages/action', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, folder, uids }),
  });
  if (!res.ok) throw new Error('Action failed');
  return res.json();
}

export async function undoAction(undo: { uids: number[]; targetFolder?: string }): Promise<void> {
  await fetch('/api/messages/undo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(undo),
  });
}

export async function searchMessages(
  query: string,
  folder?: string,
): Promise<SearchResponse> {
  const params = new URLSearchParams({ q: query });
  if (folder) params.set('folder', folder);
  const res = await fetch(`/api/messages/search?${params}`);
  return res.json();
}

export async function fetchSearchIndexStatus(): Promise<SearchIndexStatusResponse> {
  const res = await fetch('/api/messages/search/index/status');
  return res.json();
}

export async function fetchSearchWorkerStatus(): Promise<SearchWorkerStatusResponse> {
  const res = await fetch('/api/messages/search/index/status?worker=true');
  return res.json();
}

export async function refreshSearchIndex(): Promise<SearchIndexRefreshResponse> {
  const res = await fetch('/api/messages/search/index', { method: 'POST' });
  return res.json();
}

export async function fetchSavedSearches(): Promise<SavedSearch[]> {
  const res = await fetch('/api/messages/search/saved');
  const data = await res.json();
  return data.searches || [];
}

export async function saveSearch(name: string, query: string): Promise<void> {
  await fetch('/api/messages/search/saved', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, query }),
  });
}

export async function deleteSearch(id: string): Promise<void> {
  await fetch(`/api/messages/search/saved/${id}`, { method: 'DELETE' });
}

export async function fetchSignatures(): Promise<Signature[]> {
  const res = await fetch('/api/settings/signatures');
  const data = await res.json();
  return data.signatures || [];
}

export async function fetchRules(): Promise<Rule[]> {
  const res = await fetch('/api/rules');
  const data = await res.json();
  return data.rules || [];
}

// ---- Contacts ----
export async function fetchContacts(limit = 200, offset = 0): Promise<ContactsResponse> {
  const res = await fetch(`/api/apps/contacts?limit=${limit}&offset=${offset}`);
  return res.json();
}

export async function fetchDirectoryContacts(query?: string): Promise<{ success: boolean; contacts?: Contact[] }> {
  const url = query ? `/api/directory?q=${encodeURIComponent(query)}` : '/api/directory';
  const res = await fetch(url);
  return res.json();
}

export async function fetchContactDuplicates(): Promise<{ success: boolean; groups?: Contact[][] }> {
  const res = await fetch('/api/apps/contacts-duplicates');
  return res.json();
}

export async function saveContact(contact: Partial<Contact>): Promise<{ success: boolean; contact?: Contact; error?: string }> {
  const method = contact.id ? 'PUT' : 'POST';
  const url = contact.id ? `/api/apps/contacts/${contact.id}` : '/api/apps/contacts';
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(contact),
  });
  return res.json();
}

export async function deleteContact(id: number | string): Promise<void> {
  await fetch(`/api/apps/contacts/${id}`, { method: 'DELETE' });
}

export async function bulkDeleteContacts(ids: (number | string)[]): Promise<void> {
  await fetch('/api/apps/contacts/bulk-delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
  });
}

export async function toggleFavorite(id: number | string): Promise<void> {
  await fetch(`/api/apps/contacts/${id}/favorite`, { method: 'PUT' });
}

export async function fetchContactLabels(): Promise<ContactLabel[]> {
  const res = await fetch('/api/apps/contact-labels');
  const data = await res.json();
  return data.labels || [];
}

export async function saveContactLabel(label: Partial<ContactLabel>): Promise<ContactLabel> {
  const method = label.id ? 'PUT' : 'POST';
  const url = label.id ? `/api/apps/contact-labels/${label.id}` : '/api/apps/contact-labels';
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(label),
  });
  const data = await res.json();
  return data.label;
}

export async function deleteContactLabel(id: number): Promise<void> {
  await fetch(`/api/apps/contact-labels/${id}`, { method: 'DELETE' });
}

export async function fetchContactGroups(): Promise<ContactGroup[]> {
  const res = await fetch('/api/apps/contact-groups');
  const data = await res.json();
  return data.groups || [];
}

export async function saveContactGroup(group: Partial<ContactGroup>): Promise<ContactGroup> {
  const method = group.id ? 'PUT' : 'POST';
  const url = group.id ? `/api/apps/contact-groups/${group.id}` : '/api/apps/contact-groups';
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(group),
  });
  const data = await res.json();
  return data.group;
}

export async function deleteContactGroup(id: number): Promise<void> {
  await fetch(`/api/apps/contact-groups/${id}`, { method: 'DELETE' });
}

export async function mergeContacts(primaryId: number, duplicateIds: number[]): Promise<void> {
  await fetch('/api/apps/contacts-merge', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ primaryId, duplicateIds }),
  });
}

// ---- Calendar ----
export async function fetchCalendars(): Promise<CalendarsResponse> {
  const res = await fetch('/api/apps/calendars');
  return res.json();
}

export async function saveCalendar(calendar: Partial<Calendar>): Promise<Calendar> {
  const method = calendar.id ? 'PUT' : 'POST';
  const url = calendar.id ? `/api/apps/calendars/${calendar.id}` : '/api/apps/calendars';
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(calendar),
  });
  const data = await res.json();
  return data.calendar;
}

export async function deleteCalendarApi(id: number): Promise<CalendarDeleteResponse> {
  const res = await fetch(`/api/apps/calendars/${id}`, { method: 'DELETE' });
  return res.json();
}

export async function saveEvent(icsData: string): Promise<CalendarUpdateResponse> {
  const res = await fetch('/api/apps/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ data: icsData }),
  });
  return res.json();
}

export async function deleteEvent(calendarId: number, uid: string, excludeDate?: string): Promise<void> {
  const url = excludeDate
    ? `/api/apps/events/${calendarId}/${uid}?exclude=${encodeURIComponent(excludeDate)}`
    : `/api/apps/events/${calendarId}/${uid}`;
  await fetch(url, { method: 'DELETE' });
}

export async function fetchCalendarShares(calendarId: number): Promise<any[]> {
  const res = await fetch(`/api/apps/calendars/${calendarId}/shares`);
  const data = await res.json();
  return data.shares || [];
}

export async function shareCalendar(calendarId: number, email: string, permission: string): Promise<void> {
  await fetch(`/api/apps/calendars/${calendarId}/shares`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, permission }),
  });
}

export async function unshareCalendar(calendarId: number, email: string): Promise<void> {
  await fetch(`/api/apps/calendars/${calendarId}/shares/${encodeURIComponent(email)}`, { method: 'DELETE' });
}

// ---- Notes ----
export async function fetchNotes(): Promise<Note[]> {
  const res = await fetch(`/api/notes?t=${Date.now()}`);
  const data = await res.json();
  return data.notes || [];
}

export async function saveNote(note: Partial<Note>): Promise<Note> {
  const method = note.id ? 'PUT' : 'POST';
  const url = note.id ? `/api/notes/${note.id}` : '/api/notes';
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(note),
  });
  const data = await res.json();
  return data.note;
}

export async function deleteNoteApi(id: string): Promise<void> {
  await fetch(`/api/notes/${id}`, { method: 'DELETE' });
}

// ---- Settings ----
export async function fetchUserSettings(namespace: string): Promise<any> {
  const res = await fetch(`/api/settings/${namespace}`);
  if (!res.ok) throw new Error(`Failed to fetch settings for ${namespace}`);
  return res.json();
}

export async function saveUserSettings(namespace: string, settings: any): Promise<void> {
  await fetch(`/api/settings/${namespace}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  });
}
```

- [ ] **Step 2: Verify module compiles**

```bash
cd /root/openmailstack/webmail-frontend && npx tsc --noEmit src/shared/api.ts
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
git add webmail-frontend/src/shared/api.ts
git commit -m "feat: add shared API client with typed fetch wrappers

Co-Authored-By: Claude <noreply@anthropic.com>"
```

### Task 2.3: Create Skeleton component

**Files:**
- Create: `webmail-frontend/src/shared/components/Skeleton.tsx`

**Interfaces:**
- Produces: `<Skeleton width={} height={} variant={} count={} />`

- [ ] **Step 1: Create Skeleton component**

Create `webmail-frontend/src/shared/components/Skeleton.tsx`:

```typescript
interface SkeletonProps {
  width?: string | number;
  height?: string | number;
  variant?: 'text' | 'circle' | 'rect';
  count?: number;
  style?: React.CSSProperties;
}

export function Skeleton({
  width = '100%',
  height = 14,
  variant = 'text',
  count = 1,
  style,
}: SkeletonProps) {
  const baseStyle: React.CSSProperties = {
    width,
    height,
    borderRadius: variant === 'circle' ? '50%' : variant === 'rect' ? 'var(--radius-sm)' : 'var(--radius-sm)',
    ...style,
  };

  if (count === 1) {
    return <div className="skeleton" style={baseStyle} />;
  }

  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="skeleton"
          style={{
            ...baseStyle,
            marginTop: i > 0 ? 6 : 0,
            width: typeof width === 'number' ? width : (i === count - 1 ? '60%' : width),
          }}
        />
      ))}
    </>
  );
}
```

- [ ] **Step 2: Add skeleton CSS to index.css**

Append to `webmail-frontend/src/index.css`:

```css
/* Skeleton shimmer */
@keyframes skeleton-shimmer {
  0%   { background-position: -200% 0; }
  100% { background-position: 200% 0; }
}

.skeleton {
  background: linear-gradient(
    90deg,
    rgba(255, 255, 255, 0.04) 0%,
    rgba(255, 255, 255, 0.08) 40%,
    rgba(255, 255, 255, 0.04) 80%
  );
  background-size: 200% 100%;
  animation: skeleton-shimmer 1.8s ease-in-out infinite;
  border-radius: var(--radius-sm);
}
```

- [ ] **Step 3: Commit**

```bash
git add webmail-frontend/src/shared/components/Skeleton.tsx webmail-frontend/src/index.css
git commit -m "feat: add Skeleton component with shimmer animation

Co-Authored-By: Claude <noreply@anthropic.com>"
```

### Task 2.4: Create EmptyState and ErrorBanner components

**Files:**
- Create: `webmail-frontend/src/shared/components/EmptyState.tsx`
- Create: `webmail-frontend/src/shared/components/ErrorBanner.tsx`

- [ ] **Step 1: Create EmptyState**

Create `webmail-frontend/src/shared/components/EmptyState.tsx`:

```typescript
import { type LucideIcon } from 'lucide-react';

interface EmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
  action?: { label: string; onClick: () => void };
}

export function EmptyState({ icon: Icon, title, description, action }: EmptyStateProps) {
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      justifyContent: 'center', padding: 60, textAlign: 'center',
      color: 'var(--text-secondary)',
    }}>
      <Icon size={48} style={{ marginBottom: 16, opacity: 0.4 }} />
      <h3 style={{ fontSize: '1.1rem', fontWeight: 600, margin: '0 0 8px', color: 'var(--text-primary)' }}>
        {title}
      </h3>
      {description && <p style={{ margin: '0 0 20px', fontSize: '0.9rem' }}>{description}</p>}
      {action && (
        <button className="btn btn-primary" onClick={action.onClick}>
          {action.label}
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create ErrorBanner**

Create `webmail-frontend/src/shared/components/ErrorBanner.tsx`:

```typescript
import { AlertCircle } from 'lucide-react';

interface ErrorBannerProps {
  error: string;
  onRetry?: () => void;
}

export function ErrorBanner({ error, onRetry }: ErrorBannerProps) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 12,
      padding: '12px 16px', margin: '0 16px 16px',
      borderRadius: 'var(--radius-md)',
      background: 'rgba(239,68,68,0.1)',
      border: '1px solid rgba(239,68,68,0.3)',
      color: 'var(--danger)', fontSize: '0.85rem',
    }}>
      <AlertCircle size={18} />
      <span style={{ flex: 1 }}>{error}</span>
      {onRetry && (
        <button className="btn btn-ghost" onClick={onRetry} style={{ fontSize: '0.8rem', padding: '4px 12px' }}>
          Retry
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add webmail-frontend/src/shared/components/EmptyState.tsx webmail-frontend/src/shared/components/ErrorBanner.tsx
git commit -m "feat: add EmptyState and ErrorBanner shared components

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task Group 3: Mail App Extraction

### Task 3.1: Create useMail hook

**Files:**
- Create: `webmail-frontend/src/mail/hooks/useMail.ts`

**Interfaces:**
- Consumes: `shared/types.ts`, `shared/api.ts`
- Produces: `useMail()` returning all mail state and actions previously in App.tsx top-level

- [ ] **Step 1: Create useMail hook**

Create `webmail-frontend/src/mail/hooks/useMail.ts`:

```typescript
import { useState, useCallback, useEffect, useRef } from 'react';
import type {
  Message, MailFolder, Signature, Rule, SavedSearch,
  MessageListResponse, MailUndoState,
  SearchField, SearchScope,
} from '../../shared/types';
import * as api from '../../shared/api';

interface UseMailOptions {
  mailSettings: any;
  isThreaded: boolean;
  userIdentities: any;
}

export function useMail({ mailSettings, isThreaded, userIdentities }: UseMailOptions) {
  // Folder state
  const [folders, setFolders] = useState<MailFolder[]>([]);
  const [activeFolder, setActiveFolder] = useState('INBOX');
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({});

  // Message state
  const [messages, setMessages] = useState<Message[]>([]);
  const [selectedMessages, setSelectedMessages] = useState<number[]>([]);
  const [viewingThread, setViewingThread] = useState<Message[] | null>(null);
  const [mailLowestUid, setMailLowestUid] = useState<number | null>(null);
  const [mailMoreAvailable, setMailMoreAvailable] = useState(false);

  // Loading state
  const [mailLoading, setMailLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [loadingOlderMessages, setLoadingOlderMessages] = useState(false);

  // Undo
  const [mailUndo, setMailUndo] = useState<MailUndoState | null>(null);

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchField, setSearchField] = useState<SearchField>('all');
  const [searchScope, setSearchScope] = useState<SearchScope>('folder');
  const [isSearchActive, setIsSearchActive] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [searchInfo, setSearchInfo] = useState('');
  const [searchIndexStatus, setSearchIndexStatus] = useState<any>(null);
  const [searchWorkerStatus, setSearchWorkerStatus] = useState<any>(null);
  const [savedSearches, setSavedSearches] = useState<SavedSearch[]>([]);

  // Compose state
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
  const [composeMode, setComposeMode] = useState<'rich' | 'plain'>('rich');
  const [draftUid, setDraftUid] = useState<string | null>(null);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [draftSaveStatus, setDraftSaveStatus] = useState<'saving' | 'saved' | 'error' | null>(null);
  const [sending, setSending] = useState(false);

  // Other mail state
  const [signatures, setSignatures] = useState<Signature[]>([]);
  const [rules, setRules] = useState<Rule[]>([]);
  const [userQuota, setUserQuota] = useState<{ usage: number; limit: number } | null>(null);
  const [loadedImagesForMsg, setLoadedImagesForMsg] = useState<Set<string>>(new Set());
  const [showSearchHints, setShowSearchHints] = useState(false);

  // ---- Data fetching ----
  const fetchFolders = useCallback(async () => {
    try {
      const folders = await api.fetchFolders();
      setFolders(folders);
      const quotaFolder = folders.find((f) => f.path === 'QUOTA');
      if (quotaFolder) {
        // Quota is extracted from the folder structure; backend provides it
      }
    } catch (e) {
      console.error('Failed to fetch folders', e);
    }
  }, []);

  const fetchMessages = useCallback(async () => {
    setMailLoading(true);
    try {
      const data = await api.fetchMessages(activeFolder);
      if (data.messages) {
        setMessages(data.messages);
        setMailLowestUid(data.lowestUid || null);
        setMailMoreAvailable(data.moreAvailable || false);
      }
    } catch (e) {
      console.error('Failed to fetch messages', e);
    }
    setMailLoading(false);
  }, [activeFolder]);

  const loadOlderMessages = useCallback(async () => {
    if (loadingOlderMessages || !mailMoreAvailable || !mailLowestUid) return;
    setLoadingOlderMessages(true);
    try {
      const data = await api.fetchMessages(activeFolder, mailLowestUid);
      if (data.messages) {
        setMessages((prev) => [...prev, ...data.messages!]);
        setMailLowestUid(data.lowestUid || null);
        setMailMoreAvailable(data.moreAvailable || false);
      }
    } catch (e) {
      console.error('Failed to load older messages', e);
    }
    setLoadingOlderMessages(false);
  }, [activeFolder, mailLowestUid, mailMoreAvailable, loadingOlderMessages]);

  const refreshMessages = useCallback(async () => {
    setIsRefreshing(true);
    await fetchMessages();
    setIsRefreshing(false);
  }, [fetchMessages]);

  // ---- Message actions ----
  const messageAction = useCallback(async (action: string, uids?: number[]) => {
    const targetUids = uids || selectedMessages;
    if (!targetUids.length) return;
    try {
      const result = await api.messageAction(action, activeFolder, targetUids);
      if (result.undoUids) {
        setMailUndo({
          message: getUndoMessage(action),
          uids: result.undoUids,
          targetFolder: result.targetFolder,
          timestamp: Date.now(),
        });
      }
      setSelectedMessages([]);
      await fetchMessages();
      await fetchFolders();
    } catch (e) {
      console.error('Action failed', e);
    }
  }, [activeFolder, selectedMessages, fetchMessages, fetchFolders]);

  const undoAction = useCallback(async () => {
    if (!mailUndo) return;
    try {
      await api.undoAction({ uids: mailUndo.uids, targetFolder: mailUndo.targetFolder });
      setMailUndo(null);
      await fetchMessages();
      await fetchFolders();
    } catch (e) {
      console.error('Undo failed', e);
    }
  }, [mailUndo, fetchMessages, fetchFolders]);

  // ---- Search ----
  const doSearch = useCallback(async (query: string, scope: SearchScope) => {
    if (!query.trim()) {
      setIsSearchActive(false);
      await fetchMessages();
      return;
    }
    setIsSearchActive(true);
    setSearchLoading(true);
    setSearchError('');
    try {
      const result = await api.searchMessages(query, scope === 'folder' ? activeFolder : undefined);
      if (result.messages) {
        setMessages(result.messages);
      }
      setSearchInfo(result.source ? `Results from ${result.source}` : '');
    } catch (e: any) {
      setSearchError(e.message || 'Search failed');
    }
    setSearchLoading(false);
  }, [activeFolder, fetchMessages]);

  // ---- Real-time events ----
  useEffect(() => {
    const es = new EventSource('/api/events');
    es.addEventListener('newMessage', () => {
      fetchFolders();
      if (!isSearchActive) fetchMessages();
    });
    es.addEventListener('flagsUpdate', () => {
      fetchFolders();
      if (!isSearchActive) fetchMessages();
    });
    es.onerror = () => {
      // EventSource will auto-reconnect
    };
    return () => es.close();
  }, [isSearchActive, fetchFolders, fetchMessages]);

  // ---- Initial load ----
  useEffect(() => {
    fetchFolders();
    fetchMessages();
    api.fetchSignatures().then(setSignatures).catch(() => {});
    api.fetchRules().then(setRules).catch(() => {});
  }, [fetchFolders, fetchMessages]);

  return {
    // Folders
    folders, activeFolder, setActiveFolder, expandedFolders, setExpandedFolders,
    // Messages
    messages, setMessages, selectedMessages, setSelectedMessages,
    viewingThread, setViewingThread,
    mailLowestUid, mailMoreAvailable,
    // Loading
    mailLoading, isRefreshing, loadingOlderMessages,
    // Undo
    mailUndo, setMailUndo,
    // Search
    searchQuery, setSearchQuery, searchField, setSearchField,
    searchScope, setSearchScope, isSearchActive, setIsSearchActive,
    searchLoading, searchError, searchInfo,
    searchIndexStatus, searchWorkerStatus,
    savedSearches,
    showSearchHints, setShowSearchHints,
    // Compose
    isComposing, setIsComposing, composeDocked, setComposeDocked,
    showCc, setShowCc, showBcc, setShowBcc,
    composeTo, setComposeTo, composeCc, setComposeCc, composeBcc, setComposeBcc,
    composeSubject, setComposeSubject, composeBody, setComposeBody,
    composeFrom, setComposeFrom, composeSignature, setComposeSignature,
    composeAttachments, setComposeAttachments,
    composeMode, setComposeMode,
    draftUid, setDraftUid, draftId, setDraftId,
    draftSaveStatus, setDraftSaveStatus,
    sending, setSending,
    // Other
    signatures, setSignatures, rules, setRules,
    userQuota, loadedImagesForMsg, setLoadedImagesForMsg,
    // Actions
    fetchFolders, fetchMessages, loadOlderMessages, refreshMessages,
    messageAction, undoAction, doSearch,
  };
}

function getUndoMessage(action: string): string {
  switch (action) {
    case 'delete': return 'Message moved to Trash.';
    case 'archive': return 'Message archived.';
    case 'spam': return 'Message marked as spam.';
    default: return 'Action undone.';
  }
}
```

- [ ] **Step 2: Verify it compiles**

```bash
cd /root/openmailstack/webmail-frontend && npx tsc --noEmit src/mail/hooks/useMail.ts
```

Expected: No errors. Fix any import issues.

- [ ] **Step 3: Commit**

```bash
git add webmail-frontend/src/mail/hooks/useMail.ts
git commit -m "feat: add useMail hook — all mail state and API actions

Co-Authored-By: Claude <noreply@anthropic.com>"
```

### Task 3.2: Create mail routes and folder sidebar

**Files:**
- Create: `webmail-frontend/src/mail/routes.tsx`
- Create: `webmail-frontend/src/mail/MailLayout.tsx`
- Create: `webmail-frontend/src/mail/FolderSidebar.tsx`

**Interfaces:**
- Consumes: `useMail` hook
- Produces: Mail routes with 3-pane layout and folder sidebar

- [ ] **Step 1: Create FolderSidebar**

Create `webmail-frontend/src/mail/FolderSidebar.tsx`:

```typescript
import { useNavigate } from 'react-router';
import { Inbox, Send, Star, Trash2, Archive, FolderOpen, Edit2 } from 'lucide-react';
import type { MailFolder } from '../shared/types';

interface FolderSidebarProps {
  folders: MailFolder[];
  activeFolder: string;
  expandedFolders: Record<string, boolean>;
  onToggleExpand: (path: string) => void;
  onCompose: () => void;
  onFolderDrop: (folderPath: string) => void;
  quota: { usage: number; limit: number } | null;
}

// Build folder tree from flat folder list
function buildFolderTree(folders: MailFolder[]): FolderTreeNode[] {
  const root: Record<string, FolderTreeNode> = {};
  for (const f of folders) {
    const parts = f.path.split('/').filter(Boolean);
    if (parts.length === 0) continue;
    let current = root;
    for (let i = 0; i < parts.length; i++) {
      const name = parts[i];
      if (!current[name]) {
        current[name] = {
          name,
          fullPath: parts.slice(0, i + 1).join('/'),
          children: {},
          unseen: 0,
        };
      }
      if (i === parts.length - 1) {
        current[name].unseen = f.unseen;
      }
      current = current[name].children;
    }
  }
  return Object.values(root);
}

interface FolderTreeNode {
  name: string;
  fullPath: string;
  children: Record<string, FolderTreeNode>;
  unseen: number;
}

const ICON_MAP: Record<string, React.ComponentType<any>> = {
  INBOX: Inbox,
  Sent: Send,
  Starred: Star,
  Trash: Trash2,
  Archive: Archive,
};

export function FolderSidebar({
  folders, activeFolder, expandedFolders, onToggleExpand,
  onCompose, onFolderDrop, quota,
}: FolderSidebarProps) {
  const navigate = useNavigate();
  const tree = buildFolderTree(folders);

  return (
    <div className="folder-sidebar" style={{
      display: 'flex', flexDirection: 'column', height: '100%',
      padding: 12,
    }}>
      <button
        className="btn btn-primary"
        onClick={onCompose}
        style={{ width: '100%', marginBottom: 16 }}
      >
        <Edit2 size={16} />
        Compose
      </button>

      <nav style={{ flex: 1, overflowY: 'auto' }}>
        {tree.map((node) => (
          <FolderItem
            key={node.fullPath}
            node={node}
            activeFolder={activeFolder}
            expandedFolders={expandedFolders}
            onToggleExpand={onToggleExpand}
            onClick={() => {
              navigate(`/mail/${encodeURIComponent(node.fullPath)}`);
            }}
            onDrop={() => onFolderDrop(node.fullPath)}
            depth={0}
          />
        ))}
      </nav>

      {quota && (
        <div style={{
          marginTop: 12, paddingTop: 12,
          borderTop: '1px solid var(--border-glass)',
          fontSize: '0.75rem', color: 'var(--text-secondary)',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
            <span>{formatBytes(quota.usage)}</span>
            <span>{formatBytes(quota.limit)}</span>
          </div>
          <div style={{
            height: 4, borderRadius: 2,
            background: 'rgba(255,255,255,0.1)',
          }}>
            <div style={{
              height: '100%', borderRadius: 2,
              width: `${Math.min(100, (quota.usage / quota.limit) * 100)}%`,
              background: quota.usage / quota.limit > 0.9
                ? 'var(--danger)' : 'var(--accent-primary)',
            }} />
          </div>
        </div>
      )}
    </div>
  );
}

function FolderItem({ node, activeFolder, expandedFolders, onToggleExpand, onClick, onDrop, depth }: any) {
  const isExpanded = expandedFolders[node.fullPath];
  const hasChildren = Object.keys(node.children).length > 0;
  const IconComp = ICON_MAP[node.name] || FolderOpen;
  const isActive = activeFolder === node.fullPath;

  return (
    <div>
      <div
        className={`nav-item ${isActive ? 'nav-item--active' : ''}`}
        style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '6px 10px', paddingLeft: 12 + depth * 16,
          borderRadius: 'var(--radius-md)',
          cursor: 'pointer',
          fontWeight: isActive ? 600 : 400,
          background: isActive ? 'rgba(59,130,246,0.15)' : 'transparent',
          color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
          fontSize: '0.9rem',
        }}
        onClick={() => {
          if (hasChildren) onToggleExpand(node.fullPath);
          onClick();
        }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); onDrop(); }}
      >
        {hasChildren && (
          <span style={{ fontSize: '0.7rem', width: 12 }}>
            {isExpanded ? '▼' : '▶'}
          </span>
        )}
        <IconComp size={16} />
        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {node.name}
        </span>
        {node.unseen > 0 && (
          <span className="unread-badge" style={{
            background: 'var(--accent-primary)', color: 'white',
            borderRadius: 999, padding: '1px 6px', fontSize: '0.7rem',
            fontWeight: 600,
          }}>
            {node.unseen}
          </span>
        )}
      </div>
      {isExpanded && hasChildren && Object.values(node.children).map((child: any) => (
        <FolderItem
          key={child.fullPath}
          node={child}
          activeFolder={activeFolder}
          expandedFolders={expandedFolders}
          onToggleExpand={onToggleExpand}
          onClick={() => {}}
          onDrop={() => {}}
          depth={depth + 1}
        />
      ))}
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes >= 1073741824) return `${(bytes / 1073741824).toFixed(1)} GB`;
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(0)} MB`;
  return `${(bytes / 1024).toFixed(0)} KB`;
}
```

- [ ] **Step 2: Create MailLayout**

Create `webmail-frontend/src/mail/MailLayout.tsx`:

```typescript
import { Outlet } from 'react-router';
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from 'react-resizable-panels';
import { useMediaQuery } from '../shared/hooks/useMediaQuery';
import { FolderSidebar } from './FolderSidebar';
import type { useMail } from './hooks/useMail';

interface MailLayoutProps {
  mail: ReturnType<typeof useMail>;
}

export function MailLayout({ mail }: MailLayoutProps) {
  const isMobile = useMediaQuery('(max-width: 767px)');

  if (isMobile) {
    // Mobile: single pane, routes handle drill-down
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <Outlet />
      </div>
    );
  }

  // Desktop: 3-pane layout
  return (
    <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
      <PanelGroup direction="horizontal" style={{ flex: 1 }}>
        <Panel defaultSize={20} minSize={15} maxSize={30}>
          <FolderSidebar
            folders={mail.folders}
            activeFolder={mail.activeFolder}
            expandedFolders={mail.expandedFolders}
            onToggleExpand={(path) => mail.setExpandedFolders((prev) => ({
              ...prev, [path]: !prev[path],
            }))}
            onCompose={() => mail.setIsComposing(true)}
            onFolderDrop={(folderPath) => {
              if (mail.selectedMessages.length > 0) {
                mail.messageAction('move', mail.selectedMessages);
              }
            }}
            quota={mail.userQuota}
          />
        </Panel>
        <PanelResizeHandle style={{ width: 4, background: 'transparent' }} />
        <Panel defaultSize={35} minSize={20}>
          <Outlet />
        </Panel>
        <PanelResizeHandle style={{ width: 4, background: 'transparent' }} />
        <Panel defaultSize={45} minSize={25}>
          <Outlet />
        </Panel>
      </PanelGroup>
    </div>
  );
}
```

- [ ] **Step 3: Create mail routes**

Create `webmail-frontend/src/mail/routes.tsx` (placeholder — will be filled in subsequent tasks):

```typescript
import { Routes, Route } from 'react-router';
import { MailLayout } from './MailLayout';

// Placeholder — will wire up real components in Tasks 3.3-3.5
function MessageListPlaceholder() {
  return (
    <div className="glass-panel" style={{ margin: 12, padding: 24, color: 'var(--text-secondary)' }}>
      Message list — extract from App.legacy.tsx next
    </div>
  );
}

function MessageViewerPlaceholder() {
  return (
    <div className="glass-panel" style={{ margin: 12, padding: 24, color: 'var(--text-secondary)' }}>
      Select a message to view
    </div>
  );
}

export function MailRoutes() {
  return (
    <Routes>
      <Route element={<MailLayout mail={/* wired in Task 3.6 */ {} as any} />}>
        <Route path=":folder" element={<MessageListPlaceholder />}>
          <Route path=":uid" element={<MessageViewerPlaceholder />} />
        </Route>
      </Route>
    </Routes>
  );
}
```

- [ ] **Step 4: Verify build**

```bash
cd /root/openmailstack/webmail-frontend && npx tsc -b 2>&1 | head -20
```

Fix any errors. The placeholder cast `{} as any` is intentional — it gets replaced when the hook is wired.

- [ ] **Step 5: Commit**

```bash
git add webmail-frontend/src/mail/
git commit -m "feat: add mail routes, MailLayout, and FolderSidebar

Co-Authored-By: Claude <noreply@anthropic.com>"
```

### Task 3.3: Create MessageRow and MessageListSkeleton

**Files:**
- Create: `webmail-frontend/src/mail/MessageRow.tsx`
- Create: `webmail-frontend/src/mail/components/MessageListSkeleton.tsx`

- [ ] **Step 1: Create MessageRow**

Create `webmail-frontend/src/mail/MessageRow.tsx`:

```typescript
import { Star, Paperclip } from 'lucide-react';
import type { Message } from '../shared/types';
import { format, isToday, isYesterday } from 'date-fns';

interface MessageRowProps {
  message: Message;
  isSelected: boolean;
  isThreaded: boolean;
  density: 'compact' | 'cozy' | 'comfortable';
  style?: React.CSSProperties;
  onSelect: (uid: number, shift: boolean) => void;
  onClick: (uid: number) => void;
  onStar: (uid: number) => void;
  forwardedRef?: React.RefCallback<HTMLDivElement>;
}

const DENSITY_HEIGHTS = { compact: 48, cozy: 64, comfortable: 80 };

export function MessageRow({
  message, isSelected, isThreaded, density, style, onSelect, onClick, onStar, forwardedRef,
}: MessageRowProps) {
  const height = DENSITY_HEIGHTS[density];
  const padding = density === 'compact' ? '4px 8px' : density === 'cozy' ? '8px 12px' : '12px 16px';

  const dateObj = typeof message.date === 'string' ? new Date(message.date) : message.date;
  let dateStr = '';
  if (dateObj) {
    if (isToday(dateObj)) dateStr = format(dateObj, 'h:mm a');
    else if (isYesterday(dateObj)) dateStr = 'Yesterday';
    else dateStr = format(dateObj, 'MMM d');
  }

  return (
    <div
      ref={forwardedRef}
      className="message-row"
      style={{
        display: 'flex', alignItems: 'center', gap: 8, padding,
        height, cursor: 'pointer',
        background: isSelected
          ? 'rgba(59,130,246,0.12)'
          : message.isRead ? 'transparent' : 'rgba(59,130,246,0.04)',
        borderBottom: '1px solid var(--border-glass)',
        ...style,
      }}
      onClick={(e) => {
        if (e.shiftKey) onSelect(message.uid, true);
        else onClick(message.uid);
      }}
    >
      {/* Checkbox */}
      <input
        type="checkbox"
        checked={isSelected}
        onChange={(e) => { e.stopPropagation(); onSelect(message.uid, false); }}
        style={{ flexShrink: 0 }}
      />

      {/* Star */}
      <button
        onClick={(e) => { e.stopPropagation(); onStar(message.uid); }}
        style={{
          background: 'none', border: 'none', cursor: 'pointer', padding: 0,
          color: message.isStarred ? '#f59e0b' : 'var(--text-secondary)',
          flexShrink: 0,
        }}
      >
        <Star size={16} fill={message.isStarred ? '#f59e0b' : 'none'} />
      </button>

      {/* Avatar circle */}
      <div style={{
        width: 28, height: 28, borderRadius: '50%',
        background: 'linear-gradient(135deg, var(--accent-primary), var(--accent-purple))',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '0.7rem', fontWeight: 600, flexShrink: 0,
        color: 'white',
      }}>
        {(message.from || '?')[0].toUpperCase()}
      </div>

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          display: 'flex', justifyContent: 'space-between',
          fontWeight: message.isRead ? 400 : 600,
          fontSize: density === 'compact' ? '0.8rem' : '0.9rem',
        }}>
          <span style={{
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            color: message.isRead ? 'var(--text-secondary)' : 'var(--text-primary)',
          }}>
            {message.from?.split('<')[0]?.trim() || message.from}
          </span>
          <span style={{
            flexShrink: 0, marginLeft: 8,
            fontSize: '0.75rem', color: 'var(--text-secondary)',
          }}>
            {dateStr}
          </span>
        </div>
        <div style={{
          display: 'flex', justifyContent: 'space-between', marginTop: 2,
          fontSize: density === 'compact' ? '0.75rem' : '0.82rem',
          color: 'var(--text-secondary)',
        }}>
          <span style={{
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            fontWeight: message.isRead ? 400 : 500,
          }}>
            {message.subject || '(no subject)'}
          </span>
          <span style={{ flexShrink: 0, marginLeft: 8, display: 'flex', gap: 4, alignItems: 'center' }}>
            {message.hasAttachments && <Paperclip size={12} />}
            {isThreaded && message.threadCount && message.threadCount > 1 && (
              <span style={{
                background: 'rgba(59,130,246,0.2)', borderRadius: 999,
                padding: '0 5px', fontSize: '0.7rem',
              }}>
                {message.threadCount}
              </span>
            )}
          </span>
        </div>
        {density !== 'compact' && message.preview && (
          <div style={{
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            marginTop: 2, fontSize: '0.78rem', color: 'var(--text-secondary)',
            opacity: 0.7,
          }}>
            {message.preview}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create MessageListSkeleton**

Create `webmail-frontend/src/mail/components/MessageListSkeleton.tsx`:

```typescript
import { Skeleton } from '../../shared/components/Skeleton';

const DENSITY_HEIGHTS = { compact: 48, cozy: 64, comfortable: 80 };

export function MessageListSkeleton({
  count = 10,
  density = 'cozy',
}: {
  count?: number;
  density?: 'compact' | 'cozy' | 'comfortable';
}) {
  const height = DENSITY_HEIGHTS[density];
  const padding = density === 'compact' ? '4px 8px' : density === 'cozy' ? '8px 12px' : '12px 16px';

  return (
    <div>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          style={{
            display: 'flex', alignItems: 'center', gap: 8,
            padding, height,
            borderBottom: '1px solid var(--border-glass)',
          }}
        >
          <Skeleton variant="rect" width={16} height={16} />
          <Skeleton variant="circle" width={16} height={16} />
          <Skeleton variant="circle" width={28} height={28} />
          <div style={{ flex: 1 }}>
            <Skeleton width="30%" height={13} />
            <Skeleton width="70%" height={13} style={{ marginTop: 4 }} />
            {density !== 'compact' && (
              <Skeleton width="50%" height={11} style={{ marginTop: 4 }} />
            )}
          </div>
          <Skeleton width={36} height={11} />
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add webmail-frontend/src/mail/MessageRow.tsx webmail-frontend/src/mail/components/MessageListSkeleton.tsx
git commit -m "feat: add MessageRow and MessageListSkeleton components

Co-Authored-By: Claude <noreply@anthropic.com>"
```

### Task 3.4: Create virtualized MessageList

**Files:**
- Create: `webmail-frontend/src/mail/MessageList.tsx`

**Interfaces:**
- Consumes: `MessageRow`, `MessageListSkeleton`, `useMail`, `@tanstack/react-virtual`
- Produces: Virtualized message list with selection, density, hover actions

- [ ] **Step 1: Create MessageList with virtualization**

Create `webmail-frontend/src/mail/MessageList.tsx`:

```typescript
import { useRef, useCallback } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useNavigate, useParams, Outlet } from 'react-router';
import { MessageRow } from './MessageRow';
import { MessageListSkeleton } from './components/MessageListSkeleton';
import { MailToolbar } from './MailToolbar';
import { ErrorBanner } from '../shared/components/ErrorBanner';
import type { Message } from '../shared/types';
import type { useMail } from './hooks/useMail';

const DENSITY_HEIGHTS = { compact: 48, cozy: 64, comfortable: 80 };

interface MessageListProps {
  mail: ReturnType<typeof useMail>;
  density: 'compact' | 'cozy' | 'comfortable';
}

export function MessageList({ mail, density }: MessageListProps) {
  const { folder } = useParams<{ folder: string }>();
  const navigate = useNavigate();
  const parentRef = useRef<HTMLDivElement>(null);

  // Sync active folder from URL
  const decodedFolder = folder ? decodeURIComponent(folder) : 'INBOX';
  if (decodedFolder !== mail.activeFolder) {
    mail.setActiveFolder(decodedFolder);
  }

  const rowVirtualizer = useVirtualizer({
    count: mail.messages.length,
    getScrollElement: () => parentRef.current,
    estimateSize: useCallback(() => DENSITY_HEIGHTS[density], [density]),
    overscan: 10,
  });

  const handleSelect = (uid: number, shift: boolean) => {
    if (shift) {
      const idx = mail.messages.findIndex((m) => m.uid === uid);
      const lastIdx = mail.selectedMessages.length > 0
        ? mail.messages.findIndex((m) => m.uid === mail.selectedMessages[mail.selectedMessages.length - 1])
        : idx;
      const range = mail.messages
        .slice(Math.min(idx, lastIdx), Math.max(idx, lastIdx) + 1)
        .map((m) => m.uid);
      mail.setSelectedMessages((prev) => [...new Set([...prev, ...range])]);
    } else {
      mail.setSelectedMessages((prev) =>
        prev.includes(uid) ? prev.filter((id) => id !== uid) : [...prev, uid]
      );
    }
  };

  const handleClick = (uid: number) => {
    navigate(`/mail/${encodeURIComponent(decodedFolder)}/${uid}`);
  };

  const handleStar = (uid: number) => {
    // Toggle star — optimistic
    const msg = mail.messages.find((m) => m.uid === uid);
    if (msg) {
      msg.isStarred = !msg.isStarred;
      mail.messageAction(msg.isStarred ? 'star' : 'unstar', [uid]);
    }
  };

  // Loading state
  if (mail.mailLoading && mail.messages.length === 0) {
    return <MessageListSkeleton density={density} />;
  }

  // Error state
  if (mail.searchError) {
    return <ErrorBanner error={mail.searchError} onRetry={() => mail.doSearch(mail.searchQuery, mail.searchScope)} />;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <MailToolbar
        selectedCount={mail.selectedMessages.length}
        totalCount={mail.messages.length}
        searchQuery={mail.searchQuery}
        onSearchChange={mail.setSearchQuery}
        onSelectAll={() => {
          if (mail.selectedMessages.length === mail.messages.length) {
            mail.setSelectedMessages([]);
          } else {
            mail.setSelectedMessages(mail.messages.map((m) => m.uid));
          }
        }}
        onBulkAction={(action) => mail.messageAction(action)}
      />

      <div ref={parentRef} style={{ flex: 1, overflow: 'auto' }}>
        <div style={{ height: rowVirtualizer.getTotalSize(), position: 'relative' }}>
          {rowVirtualizer.getVirtualItems().map((virtualRow) => {
            const msg = mail.messages[virtualRow.index];
            return (
              <MessageRow
                key={msg.uid}
                message={msg}
                isSelected={mail.selectedMessages.includes(msg.uid)}
                isThreaded={false}
                density={density}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${virtualRow.start}px)`,
                }}
                onSelect={handleSelect}
                onClick={handleClick}
                onStar={handleStar}
              />
            );
          })}
        </div>

        {/* Load older button */}
        {mail.mailMoreAvailable && (
          <div style={{ textAlign: 'center', padding: 12 }}>
            <button
              className="btn btn-ghost"
              onClick={mail.loadOlderMessages}
              disabled={mail.loadingOlderMessages}
            >
              {mail.loadingOlderMessages ? 'Loading...' : 'Load older messages'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create MailToolbar**

Create `webmail-frontend/src/mail/MailToolbar.tsx`:

```typescript
import { Trash2, Archive, ShieldAlert, Mail, MailOpen, StarIcon } from 'lucide-react';

interface MailToolbarProps {
  selectedCount: number;
  totalCount: number;
  searchQuery: string;
  onSearchChange: (q: string) => void;
  onSelectAll: () => void;
  onBulkAction: (action: string) => void;
}

export function MailToolbar({
  selectedCount, totalCount, searchQuery,
  onSearchChange, onSelectAll, onBulkAction,
}: MailToolbarProps) {
  const allSelected = selectedCount > 0 && selectedCount === totalCount;

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
      borderBottom: '1px solid var(--border-glass)',
      background: 'rgba(0,0,0,0.1)',
    }}>
      <input
        type="checkbox"
        checked={allSelected}
        onChange={onSelectAll}
        title="Select all"
      />

      {selectedCount > 0 ? (
        <>
          <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
            {selectedCount} selected
          </span>
          <button className="btn btn-ghost" onClick={() => onBulkAction('read')} title="Mark read">
            <Mail size={16} />
          </button>
          <button className="btn btn-ghost" onClick={() => onBulkAction('unread')} title="Mark unread">
            <MailOpen size={16} />
          </button>
          <button className="btn btn-ghost" onClick={() => onBulkAction('archive')} title="Archive">
            <Archive size={16} />
          </button>
          <button className="btn btn-ghost" onClick={() => onBulkAction('star')} title="Star">
            <StarIcon size={16} />
          </button>
          <button className="btn btn-ghost" onClick={() => onBulkAction('spam')} title="Mark as spam">
            <ShieldAlert size={16} />
          </button>
          <button className="btn btn-danger" onClick={() => onBulkAction('delete')} title="Delete">
            <Trash2 size={16} />
          </button>
        </>
      ) : (
        <input
          type="text"
          className="glass-input"
          placeholder="Search messages..."
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          style={{ flex: 1, fontSize: '0.85rem' }}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 3: Compile check**

```bash
cd /root/openmailstack/webmail-frontend && npx tsc --noEmit src/mail/MessageList.tsx src/mail/MailToolbar.tsx 2>&1 | head -30
```

Fix any import/type errors.

- [ ] **Step 4: Commit**

```bash
git add webmail-frontend/src/mail/MessageList.tsx webmail-frontend/src/mail/MailToolbar.tsx
git commit -m "feat: add virtualized MessageList and MailToolbar

Co-Authored-By: Claude <noreply@anthropic.com>"
```

### Task 3.5: Create MessageViewer and ComposeModal

**Files:**
- Create: `webmail-frontend/src/mail/MessageViewer.tsx`
- Create: `webmail-frontend/src/mail/ComposeModal.tsx`
- Create: `webmail-frontend/src/mail/components/AttachmentCard.tsx`

**Interfaces:**
- Consumes: `useMail`, `Message`, shared types
- Produces: Thread viewer + compose modal

- [ ] **Step 1: Create AttachmentCard**

Create `webmail-frontend/src/mail/components/AttachmentCard.tsx`:

```typescript
import { Paperclip, Download } from 'lucide-react';
import type { MessageAttachment } from '../../shared/types';

interface AttachmentCardProps {
  attachment: MessageAttachment;
}

function formatSize(bytes: number): string {
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${Math.round(bytes / 1024)} KB`;
}

export function AttachmentCard({ attachment }: AttachmentCardProps) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10,
      padding: '8px 12px', borderRadius: 'var(--radius-md)',
      background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border-glass)',
    }}>
      <Paperclip size={16} style={{ color: 'var(--text-secondary)' }} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontSize: '0.85rem', fontWeight: 500,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
        }}>
          {attachment.filename}
        </div>
        <div style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
          {formatSize(attachment.size)}
        </div>
      </div>
      <a
        href={`/api/attachments/${attachment.id}`}
        download={attachment.filename}
        className="btn btn-ghost"
        style={{ padding: '4px 8px' }}
      >
        <Download size={14} />
      </a>
    </div>
  );
}
```

- [ ] **Step 2: Create MessageViewer**

Create `webmail-frontend/src/mail/MessageViewer.tsx`:

```typescript
import { useParams, useNavigate } from 'react-router';
import { Reply, ReplyAll, Forward, Star, Trash2, Archive, Mail } from 'lucide-react';
import { format } from 'date-fns';
import { AttachmentCard } from './components/AttachmentCard';
import { Skeleton } from '../shared/components/Skeleton';
import type { useMail } from './hooks/useMail';

interface MessageViewerProps {
  mail: ReturnType<typeof useMail>;
}

export function MessageViewer({ mail }: MessageViewerProps) {
  const { folder, uid } = useParams<{ folder: string; uid: string }>();
  const navigate = useNavigate();

  if (!uid) {
    return (
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '100%', color: 'var(--text-secondary)', fontSize: '0.9rem',
      }}>
        Select a message to read
      </div>
    );
  }

  const messageUid = parseInt(uid, 10);
  const message = mail.messages.find((m) => m.uid === messageUid);

  if (!message) {
    // Still loading this message — show skeleton
    return (
      <div style={{ padding: 20 }}>
        <Skeleton width="60%" height={22} />
        <Skeleton width="40%" height={14} style={{ marginTop: 12 }} />
        <div style={{ borderTop: '1px solid var(--border-glass)', margin: '16px 0' }} />
        <Skeleton count={8} height={14} />
        <div style={{ marginTop: 20 }}>
          <Skeleton width={120} height={32} />
        </div>
      </div>
    );
  }

  const dateObj = typeof message.date === 'string' ? new Date(message.date) : message.date;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Toolbar */}
      <div style={{
        display: 'flex', gap: 4, padding: '8px 12px',
        borderBottom: '1px solid var(--border-glass)',
      }}>
        <button
          className="btn btn-ghost"
          onClick={() => navigate(`/mail/${encodeURIComponent(folder || 'INBOX')}`)}
        >
          <Mail size={16} />
        </button>
        <button
          className="btn btn-ghost"
          onClick={() => {
            mail.setComposeTo(message.from);
            mail.setComposeSubject(`Re: ${message.subject}`);
            mail.setIsComposing(true);
          }}
          title="Reply"
        >
          <Reply size={16} />
        </button>
        <button className="btn btn-ghost" title="Reply All">
          <ReplyAll size={16} />
        </button>
        <button className="btn btn-ghost" title="Forward">
          <Forward size={16} />
        </button>
        <div style={{ flex: 1 }} />
        <button className="btn btn-ghost" onClick={() => mail.messageAction('star', [message.uid])}>
          <Star size={16} fill={message.isStarred ? '#f59e0b' : 'none'} color={message.isStarred ? '#f59e0b' : undefined} />
        </button>
        <button className="btn btn-ghost" onClick={() => mail.messageAction('archive', [message.uid])}>
          <Archive size={16} />
        </button>
        <button className="btn btn-danger" onClick={() => mail.messageAction('delete', [message.uid])}>
          <Trash2 size={16} />
        </button>
      </div>

      {/* Message content */}
      <div style={{ flex: 1, overflow: 'auto', padding: 20 }}>
        <h2 style={{ fontSize: '1.2rem', fontWeight: 600, margin: '0 0 12px' }}>
          {message.subject || '(no subject)'}
        </h2>
        <div style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: 16 }}>
          <div><strong style={{ color: 'var(--text-primary)' }}>From:</strong> {message.from}</div>
          {message.to && <div><strong style={{ color: 'var(--text-primary)' }}>To:</strong> {message.to}</div>}
          {message.cc && <div><strong style={{ color: 'var(--text-primary)' }}>Cc:</strong> {message.cc}</div>}
          <div><strong style={{ color: 'var(--text-primary)' }}>Date:</strong> {dateObj ? format(dateObj, 'EEEE, MMMM d, yyyy h:mm a') : ''}</div>
        </div>

        <div style={{ borderTop: '1px solid var(--border-glass)', paddingTop: 16 }}>
          {message.html ? (
            <div
              className="message-body"
              dangerouslySetInnerHTML={{ __html: message.html }}
              style={{ lineHeight: 1.6, fontSize: '0.95rem' }}
            />
          ) : (
            <pre style={{
              whiteSpace: 'pre-wrap', fontFamily: 'inherit',
              lineHeight: 1.6, fontSize: '0.95rem',
            }}>
              {message.text || '(no content)'}
            </pre>
          )}
        </div>

        {/* Attachments */}
        {message.attachments && message.attachments.length > 0 && (
          <div style={{
            marginTop: 24, paddingTop: 16,
            borderTop: '1px solid var(--border-glass)',
          }}>
            <h4 style={{ fontSize: '0.9rem', fontWeight: 600, marginBottom: 8 }}>
              Attachments ({message.attachments.length})
            </h4>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {message.attachments.map((att) => (
                <AttachmentCard key={att.id} attachment={att} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create ComposeModal**

Create `webmail-frontend/src/mail/ComposeModal.tsx` with the compose form (simplified placeholder — full extraction from legacy in Task 3.6):

```typescript
import { X, Send, Paperclip } from 'lucide-react';
import type { useMail } from './hooks/useMail';

interface ComposeModalProps {
  mail: ReturnType<typeof useMail>;
}

export function ComposeModal({ mail }: ComposeModalProps) {
  if (!mail.isComposing) return null;

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      background: 'rgba(0,0,0,0.7)', display: 'flex',
      alignItems: 'flex-end', justifyContent: 'flex-end',
      padding: 20,
    }}>
      <div className="glass-panel" style={{
        width: 600, maxHeight: '80vh', display: 'flex',
        flexDirection: 'column', overflow: 'hidden',
      }}>
        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '12px 16px', borderBottom: '1px solid var(--border-glass)',
        }}>
          <span style={{ fontWeight: 600 }}>New Message</span>
          <button className="btn btn-ghost" onClick={() => mail.setIsComposing(false)} style={{ padding: 4 }}>
            <X size={18} />
          </button>
        </div>

        {/* Form fields */}
        <div style={{ flex: 1, overflow: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <input
            className="glass-input"
            placeholder="To"
            value={mail.composeTo}
            onChange={(e) => mail.setComposeTo(e.target.value)}
          />
          <input
            className="glass-input"
            placeholder="Subject"
            value={mail.composeSubject}
            onChange={(e) => mail.setComposeSubject(e.target.value)}
          />
          <textarea
            className="glass-input"
            placeholder="Write your message..."
            value={mail.composeBody}
            onChange={(e) => mail.setComposeBody(e.target.value)}
            style={{ flex: 1, minHeight: 200, resize: 'vertical' }}
          />
        </div>

        {/* Footer */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '12px 16px', borderTop: '1px solid var(--border-glass)',
        }}>
          <label className="btn btn-ghost" style={{ cursor: 'pointer' }}>
            <Paperclip size={16} />
            <input type="file" multiple hidden onChange={(e) => {
              if (e.target.files) {
                mail.setComposeAttachments((prev) => [...prev, ...Array.from(e.target.files!)]);
              }
            }} />
          </label>
          <button className="btn btn-primary" disabled={mail.sending}>
            <Send size={16} />
            {mail.sending ? 'Sending...' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Commit**

```bash
git add webmail-frontend/src/mail/MessageViewer.tsx webmail-frontend/src/mail/ComposeModal.tsx webmail-frontend/src/mail/components/AttachmentCard.tsx
git commit -m "feat: add MessageViewer, ComposeModal, and AttachmentCard

Co-Authored-By: Claude <noreply@anthropic.com>"
```

### Task 3.6: Wire mail app into router and extract remaining mail code

**Files:**
- Modify: `webmail-frontend/src/mail/routes.tsx` (replace placeholders with real components)
- Modify: `webmail-frontend/src/App.tsx` (replace MailPlaceholder with MailRoutes)
- Modify: `webmail-frontend/src/mail/hooks/useMail.ts` (wire real API functions from legacy)

**Interfaces:**
- Consumes: All mail components from Tasks 3.1-3.5, mail settings from legacy
- Produces: Fully functional mail app at `/mail/*` routes

- [ ] **Step 1: Update App.tsx to use real MailRoutes**

Replace the `MailPlaceholder` import and usage in `webmail-frontend/src/App.tsx`:

```typescript
// Remove: function MailPlaceholder() { ... }
// Add import:
import { MailRoutes } from './mail/routes';
// Replace: <Route path="mail/*" element={<MailPlaceholder />} />
// With: <Route path="mail/*" element={<MailRoutes />} />
```

- [ ] **Step 2: Update mail/routes.tsx to use real components**

Replace the file content with:

```typescript
import { Routes, Route } from 'react-router';
import { MailLayout } from './MailLayout';
import { MessageList } from './MessageList';
import { MessageViewer } from './MessageViewer';
import { ComposeModal } from './ComposeModal';
import { SearchBar } from './SearchBar';
import { useMail } from './hooks/useMail';
import { useAppearance } from '../shared/hooks/useAppearance';

// Mail app context — the hook is called once here and passed down
export function MailRoutes() {
  const { appearance } = useAppearance();
  const density = (appearance.density as 'compact' | 'cozy' | 'comfortable') || 'cozy';

  // TODO Task 3.6: Wire real settings from useAuth and settings system
  const mail = useMail({
    mailSettings: {} as any,   // Wired from settings in next iteration
    isThreaded: false,
    userIdentities: {} as any,
  });

  return (
    <>
      <Routes>
        <Route element={<MailLayout mail={mail} />}>
          <Route path=":folder" element={<MessageList mail={mail} density={density} />}>
            <Route path=":uid" element={<MessageViewer mail={mail} />} />
          </Route>
        </Route>
      </Routes>
      <ComposeModal mail={mail} />
      <SearchBar mail={mail} />
    </>
  );
}
```

- [ ] **Step 3: Create SearchBar stub**

Create `webmail-frontend/src/mail/SearchBar.tsx`:

```typescript
import { Search } from 'lucide-react';
import type { useMail } from './hooks/useMail';

interface SearchBarProps {
  mail: ReturnType<typeof useMail>;
}

export function SearchBar({ mail }: SearchBarProps) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '8px 12px',
    }}>
      <Search size={16} style={{ color: 'var(--text-secondary)' }} />
      <input
        type="text"
        className="glass-input"
        placeholder="Search mail..."
        value={mail.searchQuery}
        onChange={(e) => {
          mail.setSearchQuery(e.target.value);
          mail.doSearch(e.target.value, mail.searchScope);
        }}
        style={{ flex: 1, fontSize: '0.85rem' }}
      />
    </div>
  );
}
```

- [ ] **Step 4: Build and fix any import errors**

```bash
cd /root/openmailstack/webmail-frontend && npx tsc -b 2>&1 | head -40
```

Fix all type errors. This is the integration step — adjust imports, ensure all types match.

- [ ] **Step 5: Commit**

```bash
git add webmail-frontend/src/mail/ webmail-frontend/src/App.tsx
git commit -m "feat: wire mail app into router with real components

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Task Groups 4-6: Contacts, Calendar, Notes Extraction

*[The pattern established in Task Group 3 repeats for Contacts (Task Group 4), Calendar (Task Group 5), and Notes (Task Group 6). Each follows the same structure: create the useApp hook, create view components with virtualization where applicable, create skeleton components, wire into the router. Due to length, these follow the identical pattern — see the spec for component catalogs and the completed mail extraction for the template.]*

## Task Group 4: Contacts App Extraction

### Task 4.1: Create useContacts hook

**Files:**
- Create: `webmail-frontend/src/contacts/hooks/useContacts.ts`

Follow the same pattern as `useMail` — extract all contact state from `App.legacy.tsx` lines 94-110 (contact state) and lines 2930-3000 (contact API functions). Export a single `useContacts()` hook returning contact state, refresh functions, label/group CRUD, duplicate detection, and import/export.

### Task 4.2: Create ContactCard, ContactSkeleton, ContactGrid

**Files:**
- Create: `webmail-frontend/src/contacts/components/ContactCard.tsx`
- Create: `webmail-frontend/src/contacts/components/ContactSkeleton.tsx`
- Create: `webmail-frontend/src/contacts/ContactGrid.tsx` (virtualized)

### Task 4.3: Create ContactSidebar and ContactsLayout

**Files:**
- Create: `webmail-frontend/src/contacts/ContactSidebar.tsx`
- Create: `webmail-frontend/src/contacts/ContactsLayout.tsx`
- Create: `webmail-frontend/src/contacts/routes.tsx`

### Task 4.4: Wire contacts into router

Replace `ContactsPlaceholder` in `App.tsx` with `ContactsRoutes`.

---

## Task Group 5: Calendar App Extraction

### Task 5.1: Create useCalendar hook

**Files:**
- Create: `webmail-frontend/src/calendar/hooks/useCalendar.ts`

### Task 5.2: Create calendar views (Month, Week, Day, Agenda, Year)

**Files:**
- Create: `webmail-frontend/src/calendar/views/MonthView.tsx`
- Create: `webmail-frontend/src/calendar/views/WeekView.tsx`
- Create: `webmail-frontend/src/calendar/views/DayView.tsx`
- Create: `webmail-frontend/src/calendar/views/AgendaView.tsx`
- Create: `webmail-frontend/src/calendar/views/YearView.tsx`
- Create: `webmail-frontend/src/calendar/components/CalendarSkeleton.tsx`

### Task 5.3: Create EventModal and CalendarSidebar

**Files:**
- Create: `webmail-frontend/src/calendar/EventModal.tsx`
- Create: `webmail-frontend/src/calendar/CalendarSidebar.tsx`
- Create: `webmail-frontend/src/calendar/CalendarLayout.tsx`
- Create: `webmail-frontend/src/calendar/routes.tsx`

### Task 5.4: Wire calendar into router

Replace `CalendarPlaceholder` in `App.tsx` with `CalendarRoutes`.

---

## Task Group 6: Notes App Extraction

### Task 6.1: Create useNotes hook

**Files:**
- Create: `webmail-frontend/src/notes/hooks/useNotes.ts`

### Task 6.2: Create NoteCard, NoteSkeleton, NotesGrid

**Files:**
- Create: `webmail-frontend/src/notes/components/NoteCard.tsx`
- Create: `webmail-frontend/src/notes/components/NoteSkeleton.tsx`
- Create: `webmail-frontend/src/notes/NotesGrid.tsx`

### Task 6.3: Create NotesSidebar, NoteModal, NotesLayout

**Files:**
- Create: `webmail-frontend/src/notes/NotesSidebar.tsx`
- Create: `webmail-frontend/src/notes/NoteModal.tsx`
- Create: `webmail-frontend/src/notes/NotesLayout.tsx`
- Move: `webmail-frontend/src/LiveNoteEditor.tsx` → `webmail-frontend/src/notes/LiveNoteEditor.tsx` (update import in NoteModal)
- Create: `webmail-frontend/src/notes/routes.tsx`

### Task 6.4: Wire notes into router

Replace `NotesPlaceholder` in `App.tsx` with `NotesRoutes`.

---

## Task Group 7: Settings & Admin Extraction

### Task 7.1: Extract settings routes and layout

**Files:**
- Create: `webmail-frontend/src/settings/routes.tsx`
- Create: `webmail-frontend/src/settings/SettingsLayout.tsx` (wrap existing SettingsPanel)
- Move: existing settings files remain in place, paths updated

### Task 7.2: Extract admin routes and layout

**Files:**
- Create: `webmail-frontend/src/admin/routes.tsx`
- Create: `webmail-frontend/src/admin/AdminLayout.tsx`
- Move: existing admin files remain in place

### Task 7.3: Wire settings and admin into router, replace placeholders

---

## Task Group 8: Mobile Responsive Layout

### Task 8.1: Add mobile CSS rules to index.css

Add all mobile breakpoint CSS (header hiding, tab bar, panel stacking, FAB positioning):

```css
@media (max-width: 767px) {
  .app-shell-header {
    display: none;
  }

  .mobile-tab-bar {
    display: flex;
    position: fixed;
    bottom: 0; left: 0; right: 0;
    height: 56px;
    padding-bottom: env(safe-area-inset-bottom, 0);
    background: var(--bg-glass);
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    border-top: 1px solid var(--border-glass);
    z-index: 100;
  }

  .main-content {
    padding-bottom: 56px;
  }

  /* Stack panels vertically on mobile */
  .mail-layout-mobile [data-panel-group-direction="horizontal"] {
    flex-direction: column !important;
  }

  /* Full-screen modals on mobile */
  .compose-modal-mobile {
    position: fixed;
    inset: 0;
    width: 100% !important;
    max-height: 100vh !important;
    border-radius: 0 !important;
    z-index: 1000;
  }

  /* Contact grid to single column */
  .contact-grid-mobile {
    grid-template-columns: 1fr !important;
  }

  /* Notes grid to 2 columns */
  .notes-grid-mobile {
    grid-template-columns: repeat(2, 1fr) !important;
  }
}

@media (max-width: 400px) {
  .notes-grid-mobile {
    grid-template-columns: 1fr !important;
  }
}
```

### Task 8.2: Add mobile-aware rendering to each app layout

Update `MailLayout`, `ContactsLayout`, `CalendarLayout`, `NotesLayout` to detect `isMobile` and switch rendering:

- On mobile: `<Outlet />` only (no sidebar panel) — routing handles the drill-down
- On desktop: current multi-pane panel behavior

---

## Task Group 9: Final Integration & Cleanup

### Task 9.1: Remove App.legacy.tsx

Once all apps are extracted and verified, remove the legacy backup:

```bash
rm /root/openmailstack/webmail-frontend/src/App.legacy.tsx
```

### Task 9.2: Full build verification

```bash
cd /root/openmailstack/webmail-frontend && rm -rf dist && npx tsc -b && npx vite build
```

Verify: Clean build with no errors. All routes produce the expected chunks.

### Task 9.3: Integration smoke test

Verify the app loads and navigates correctly:

```bash
# Start dev server in background
cd /root/openmailstack/webmail-frontend && npx vite --host 0.0.0.0 &
sleep 3
# Check that the dev server responds
curl -s http://localhost:5173/ | head -5
# Verify API proxy works
curl -s http://localhost:5173/api/auth/me
```

### Task 9.4: Run existing test suite

```bash
cd /root/openmailstack && bash tests/run_all.sh
```

Verify: All existing integration tests pass.

### Task 9.5: Final commit

```bash
git add -A
git commit -m "feat: complete Phase 1 architecture — decomposition, routing, mobile, virtualization, skeletons

- Decomposed 7,524-line App.tsx into per-app directories
- Added React Router v7 with URL structure for all apps
- Added mobile responsive layout with bottom tab bar
- Added @tanstack/react-virtual to message list and contact grid
- Added skeleton loading states to all list views
- Removed legacy App.tsx backup

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Testing Strategy

### Per-Task Verification

After every task:
1. `npx tsc -b` — TypeScript compiles with no errors
2. Import graph is valid — no circular dependencies

### Per-Task-Group Verification

After each task group (mail, contacts, calendar, notes):
1. `npx vite build` — production build succeeds
2. Spot-check: navigate to the app's routes in dev mode, verify basic rendering

### End-to-End

After all task groups:
1. `npx vite build` — clean production build
2. `bash tests/run_all.sh` — all integration tests pass
3. Manual check: login → navigate each app → create an item in each → verify URL updates

---

## Risk Register

| Risk | Mitigation |
|------|-----------|
| Breaking imports during extraction | `App.legacy.tsx` preserved until all extractions verified |
| `useMail` hook growing too large | Can split into `useFolders`, `useCompose`, `useSearch` if needed — current plan keeps it unified for simplicity |
| Calendar drag-and-drop breaks during extraction | DnD handlers are preserved in WeekView/DayView extraction; verify drag-drop works after Task Group 5 |
| React Router nested `<Outlet>` confusion with multiple outlets in MailLayout | Mail has 2 `<Outlet>`s (list + viewer). React Router v7 supports this with named outlets if needed, but the current approach uses index routes. If the 2-outlet pattern fails, fall back to passing the viewer as a sibling component selected by URL param rather than a nested route |
| Mobile layout regression on desktop | `useMediaQuery` handles SSR by defaulting to `false`, ensuring desktop layout on first render |
