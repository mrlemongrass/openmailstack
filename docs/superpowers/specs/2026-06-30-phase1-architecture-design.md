# Phase 1 — Architecture & Foundation

**Date:** 2026-06-30
**Status:** Approved
**Scope:** `webmail-frontend/` only — no changes to `webmail-backend/`, IMAP/Dovecot/Postfix, or ActiveSync.

## Goals

1. Decompose the monolithic `App.tsx` (7,524 lines) into per-app component directories
2. Add React Router v7 with URL structure for all apps
3. Add mobile responsive layout (single-pane drill-down + bottom tab bar)
4. Add virtual scrolling to message list and contact list
5. Add skeleton loading states everywhere

## Constraints

- **ActiveSync untouched** — lives in `webmail-backend/src/eas-*.ts`, Vite proxy at `/Microsoft-Server-ActiveSync` stays as-is
- **IMAP/Dovecot/Postfix unaffected** — mail delivery continues throughout; only the webmail SPA is changing
- **Incremental extraction** — one app at a time, each step shippable and testable
- **No behavior changes** — existing functionality is preserved; this is a structural refactor
- **Keep existing dependencies** — no new major libraries beyond React Router v7 and @tanstack/react-virtual

---

## Section 1: Directory Structure & Routing

### Target directory layout

```
webmail-frontend/src/
├── main.tsx                        # Entry point (adds BrowserRouter)
├── App.tsx                         # Slim wrapper: auth gate + layout shell (~200 lines)
├── index.css                       # Global design system (add mobile/responsive rules)
├── branding.ts                     # (unchanged)
│
├── shared/                         # Extracted primitives
│   ├── components/                 # GlassPanel, GlassInput, Avatar, SearchInput, Skeleton, etc.
│   ├── hooks/                      # useAuth, useKeyboardShortcuts, useAppearance, useMediaQuery, etc.
│   ├── api/                        # fetch wrappers (authClient, apiClient)
│   ├── types/                      # All interfaces (Message, Contact, CalendarEvent, Note, etc.)
│   └── layouts/                    # AppShell, AuthGate
│
├── mail/
│   ├── routes.tsx                   # /mail → layout, /mail/:folder → list, /mail/:folder/:uid → detail
│   ├── MailLayout.tsx               # 3-pane PanelGroup shell
│   ├── FolderSidebar.tsx            # Folder tree, compose button, quota bar
│   ├── MessageList.tsx              # Virtualized list with selection, checkboxes, hover actions
│   ├── MessageRow.tsx               # Single row: sender, subject, preview, date, star, checkbox
│   ├── MessageViewer.tsx            # Thread view, inline reply (future), attachments
│   ├── ComposeModal.tsx             # Compose/reply/forward with ReactQuill, attachments, send options
│   ├── MailToolbar.tsx              # Select all, bulk actions, pagination
│   ├── SearchBar.tsx                # Search input + operator hints + scope controls
│   ├── hooks/                       # useMail, useFolders, useSearch, useDrafts
│   └── components/                  # AttachmentCard, ThreadItem, DraftBanner, etc.
│
├── calendar/
│   ├── routes.tsx
│   ├── CalendarLayout.tsx           # 2-pane PanelGroup
│   ├── CalendarSidebar.tsx          # Calendar list + visibility toggles + CRUD
│   ├── views/                       # MonthView, WeekView, DayView, YearView, AgendaView
│   ├── EventModal.tsx               # Simple + advanced event editor
│   ├── hooks/                       # useCalendar
│   └── components/                  # EventPill, TimeSlot, CalendarColorPicker
│
├── contacts/
│   ├── routes.tsx
│   ├── ContactsLayout.tsx           # 2-pane PanelGroup
│   ├── ContactSidebar.tsx           # Address books, labels, groups
│   ├── ContactGrid.tsx              # Virtualized grid with cards + alphabet scrubber
│   ├── ContactList.tsx              # Virtualized list alternative view
│   ├── ContactModal.tsx             # Full contact editor form
│   ├── hooks/                       # useContacts
│   └── components/                  # ContactCard, ContactRow, DuplicateMergeModal
│
├── notes/
│   ├── routes.tsx
│   ├── NotesLayout.tsx              # 2-pane PanelGroup
│   ├── NotesSidebar.tsx             # Filter nav + labels
│   ├── NotesGrid.tsx                # CSS Grid card layout
│   ├── NoteModal.tsx                # Editor with LiveNoteEditor integration
│   ├── hooks/                       # useNotes
│   └── components/                  # NoteCard, LabelChip, ColorPicker
│
├── settings/
│   ├── routes.tsx
│   ├── SettingsLayout.tsx           # Adapts existing SettingsPanel structure
│   └── panes/                       # Split existing panes into individual files
│
└── admin/
    ├── routes.tsx
    ├── AdminLayout.tsx
    └── panes/                       # Existing admin components already split out
```

### URL Structure

| Path | App | Behavior |
|------|-----|----------|
| `/` | — | Redirect to `/mail/inbox` |
| `/mail/:folder` | Mail | Folder list + message list (no message selected) |
| `/mail/:folder/:uid` | Mail | Message viewer open in third pane |
| `/calendar/:view?` | Calendar | view = month / week / day / year / agenda (default: month) |
| `/calendar/:view?date=YYYY-MM-DD` | Calendar | Specific date anchor |
| `/contacts` | Contacts | Default grid view |
| `/contacts?view=list` | Contacts | List view alternative |
| `/contacts?label=X&group=Y` | Contacts | Filter by label or group |
| `/notes` | Notes | All notes |
| `/notes?filter=pinned` | Notes | Pinned / locked / trash / label-name |
| `/settings/:tab?` | Settings | Optional deep-link to tab |
| `/admin/:panel?` | Admin | Optional deep-link to panel |
| `/sync` | Sync | Sync setup guide |

### Routing implementation

```tsx
// main.tsx
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

```tsx
// App.tsx — after decomposition, just the shell
import { Routes, Route, Navigate } from 'react-router';
import { AuthGate } from './shared/layouts/AuthGate';
import { AppShell } from './shared/layouts/AppShell';
import { MailRoutes } from './mail/routes';
import { CalendarRoutes } from './calendar/routes';
import { ContactsRoutes } from './contacts/routes';
import { NotesRoutes } from './notes/routes';
import { SettingsRoutes } from './settings/routes';
import { AdminRoutes } from './admin/routes';
import { SyncView } from './sync/SyncView';

function App() {
  return (
    <Routes>
      <Route element={<AuthGate />}>
        <Route element={<AppShell />}>
          <Route path="mail/*" element={<MailRoutes />} />
          <Route path="calendar/*" element={<CalendarRoutes />} />
          <Route path="contacts/*" element={<ContactsRoutes />} />
          <Route path="notes/*" element={<NotesRoutes />} />
          <Route path="settings/*" element={<SettingsRoutes />} />
          <Route path="admin/*" element={<AdminRoutes />} />
          <Route path="sync" element={<SyncView />} />
          <Route index element={<Navigate to="/mail/inbox" replace />} />
        </Route>
      </Route>
    </Routes>
  );
}
```

Each app's routes file uses nested routes. Mail serves as the canonical example:

```tsx
// mail/routes.tsx
import { Routes, Route } from 'react-router';
import { MailLayout } from './MailLayout';
import { MessageList } from './MessageList';
import { MessageViewer } from './MessageViewer';

export function MailRoutes() {
  return (
    <Routes>
      <Route element={<MailLayout />}>
        <Route path=":folder" element={<MessageList />}>
          <Route path=":uid" element={<MessageViewer />} />
        </Route>
      </Route>
    </Routes>
  );
}
```

`MailLayout` renders three panels: `<FolderSidebar />`, `<Outlet />` (MessageList), and `<Outlet />` (MessageViewer when a message is selected). React Router's nested `<Outlet>` handles this cleanly.

---

## Section 2: Extraction Order & Component Breakdown

### Extraction order

1. **Shared primitives** — types, API client, hooks, UI components into `src/shared/`. ~400 lines extracted, zero behavior change. Every subsequent step depends on this.

2. **Mail app** — the largest app (~2,500 lines). Virtual scrolling and skeleton states land here first. After this step, `App.tsx` shrinks by ~35%.

3. **Contacts** — ~800 lines extracted. Virtual scrolling for contact grid/list.

4. **Calendar** — ~1,200 lines extracted.

5. **Notes** — ~600 lines extracted.

6. **Settings + Admin** — remaining ~800 lines. Settings and admin already have some files extracted; this step completes the decomposition.

### State management pattern

Each app's state moves into a dedicated hook (e.g., `useMail`, `useContacts`). These hooks are called in the app's layout component and data is passed down as props — NOT through React Context. Context is reserved for truly global state only.

**Per-app hooks (called in layout, props down):**

| Hook | Holds |
|------|-------|
| `useMail` | Messages, folders, selection, search, compose state, undo state |
| `useContacts` | Contacts, directory contacts, labels, groups, duplicates |
| `useCalendar` | Calendars, events, view state, event editor state |
| `useNotes` | Notes, labels, view filter, search |

**Global hooks (Context — available everywhere):**

| Hook | Holds |
|------|-------|
| `useAuth` | User session, identities, logout function |
| `useAppearance` | Theme, density, accent, font scale, motion |
| `useAppShell` | Header nav (derived from URL), mobile detection |
| `useKeyboardShortcuts` | Global hotkeys registered per route |

### Component catalog

**Mail:**

| Component | Est. lines | Replaces |
|-----------|-----------|----------|
| `MailLayout` | 80 | 3-pane PanelGroup + mail-mode conditional block |
| `FolderSidebar` | 200 | Folder tree + compose button + quota bar |
| `MessageList` | 400 | Virtualized list with selection, density, hover actions |
| `MessageRow` | 80 | Single row: sender, subject, preview, date, star, checkbox |
| `MessageViewer` | 300 | Thread view, inline reply, attachments, headers |
| `ComposeModal` | 400 | Compose/reply/forward with ReactQuill, attachments, send options |
| `SearchBar` | 150 | Search input + operator hints + scope controls |
| `MailToolbar` | 60 | Select all, bulk actions, pagination |
| `useMail` hook | 300 | All mail state + API calls (~30 useState/useCallback consolidated) |
| `useFolders` hook | 80 | Folder tree build + expand/collapse + unseen counts |

**Contacts:**

| Component | Est. lines | Replaces |
|-----------|-----------|----------|
| `ContactsLayout` | 60 | 2-pane PanelGroup |
| `ContactSidebar` | 150 | Address books, labels, groups |
| `ContactGrid` | 200 | Virtualized grid + alphabet scrubber |
| `ContactList` | 120 | Virtualized list alternative |
| `ContactModal` | 250 | Full contact editor form |
| `useContacts` hook | 150 | State + API (~10 useState consolidated) |

**Calendar:**

| Component | Est. lines | Replaces |
|-----------|-----------|----------|
| `CalendarLayout` | 60 | 2-pane PanelGroup |
| `CalendarSidebar` | 100 | Calendar list + visibility toggles |
| `MonthView` | 200 | Month grid with event pills |
| `WeekView/DayView` | 350 | Time grid with drag-drop + resize |
| `YearView` | 80 | 12-month mini-calendar grid |
| `AgendaView` | 60 | Scrolling event list |
| `EventModal` | 300 | Simple + advanced event editor |
| `useCalendar` hook | 200 | State + API + recurrence expansion |

**Notes:**

| Component | Est. lines | Replaces |
|-----------|-----------|----------|
| `NotesLayout` | 60 | 2-pane PanelGroup |
| `NotesSidebar` | 100 | Filter nav + labels |
| `NotesGrid` | 200 | CSS Grid card layout |
| `NoteModal` | 200 | Editor with LiveNoteEditor integration |
| `useNotes` hook | 100 | State + API + import/export |

---

## Section 3: Mobile Responsive Layout

### Breakpoints

| Breakpoint | Layout | Target devices |
|-----------|--------|---------------|
| < 768px | Mobile — single pane, drill-down, bottom tab bar | Phones, small tablets |
| 768px – 1024px | Tablet — 2-pane where possible, sidebar collapsed by default | iPad portrait, small laptops |
| > 1024px | Desktop — current multi-pane layout preserved | Full experience |

### Mobile: Bottom tab bar

The header nav is replaced by a fixed bottom tab bar on mobile:

```
┌──────────────────────────────────┐
│       App Content (single pane)  │
│                                  │
├────────┬────────┬────────┬───────┤
│  Mail  │Calendar│Contacts│ Notes │  ← 56px, touch-friendly
│   📬   │   📅   │   👥   │  📝   │     safe-area-inset-bottom
└────────┴────────┴────────┴───────┘
```

- Each tab is a `<Link>` to the app's root route
- Active tab highlighted with `--accent-primary`
- Badge on Mail tab shows unread count
- Settings accessed from a gear icon in the top-right corner of the content area
- Admin accessed from the settings menu (same as desktop)

### Mobile: Mail drill-down

The desktop 3-pane becomes 3 sequential screens:

```
Screen 1: Folders        Screen 2: Message list      Screen 3: Message/thread
┌──────────────────┐     ┌──────────────────┐        ┌──────────────────┐
│ ← Settings  New ✚│     │ ← Inbox    ✓ ☰   │        │ ← Back    ⭐ 🗑   │
│──────────────────│     │──────────────────│        │──────────────────│
│ 📥 Inbox     (3) │ →   │ 🔵 Alice   10:32 │ →     │ Re: Design Review │
│ 📤 Sent          │     │    Re: Design... │        │ alice@acme.com    │
│ ✩ Starred        │     │ ⭐ Bob     Jun 28│        │                   │
│ 📁 Projects      │     │    Q3 Roadmap   │        │ Hi team, here's   │
│ 📁 Archive       │     │ 📎 Carol    Jun 27│       │ the latest mockups│
│    ⋮             │     │    Invoice.pdf  │        │ ...               │
│──────────────────│     │──────────────────│        │──────────────────│
│ Quota: 2.3/5 GB  │     │  Load older...   │        │  ══ Reply ══     │
└──────────────────┘     └──────────────────┘        │ [type here...]   │
                                                     └──────────────────┘
```

- **Screen 1 → 2**: Tap folder, navigate to `/mail/:folder`
- **Screen 2 → 3**: Tap message, navigate to `/mail/:folder/:uid`
- **Screen 3 → 2**: Back button or browser back
- **Compose**: Full-screen overlay from FAB (floating action button) at bottom-right
- **Swipe gestures** (future phase): Swipe left on message row → archive/delete

### Mobile: Calendar

- Month view compresses to single-column on phones (7-row grid, abbreviated day names: S M T W T F S)
- Week/day view: vertical scrollable timeline (standard mobile calendar pattern)
- "New Event" is a FAB at bottom-right
- Drag-and-drop disabled on mobile (tap-to-edit instead)

### Mobile: Contacts

- Grid becomes single-column cards
- Alphabet scrubber hidden on mobile — replaced by quick-jump search
- Detail view shows prominent quick-action buttons (Email, Call, Map)
- "New Contact" is a FAB

### Mobile: Notes

- Grid becomes 2-column on phones, 1-column on <400px
- Note editor is full-screen (not modal) — more room for keyboard + rich text toolbar
- "New Note" is a FAB

### CSS implementation

No framework. CSS custom properties with media queries + a `useMediaQuery` hook for JS-level layout switching:

```css
@media (max-width: 767px) {
  .app-shell-header {
    display: none;
  }

  .mobile-tab-bar {
    display: flex;
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    height: 56px;
    padding-bottom: env(safe-area-inset-bottom);
    background: var(--bg-glass);
    backdrop-filter: blur(12px);
    border-top: 1px solid var(--border-glass);
    z-index: 100;
  }

  .main-content {
    padding-bottom: 56px; /* space for tab bar */
  }
}
```

```tsx
// shared/hooks/useMediaQuery.ts
function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mql = window.matchMedia(query);
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, [query]);
  return matches;
}

// Usage in layouts
const isMobile = useMediaQuery('(max-width: 767px)');
```

When `isMobile` is true, layout components switch from multi-pane `PanelGroup` to single-pane drill-down with React Router navigation.

---

## Section 4: Virtual Scrolling

### Library: `@tanstack/react-virtual`

Headless — no DOM assumptions. Works with the existing density variants and custom row styling.

### Where applied

| List | Row height | Approach |
|------|-----------|----------|
| Message list | Variable (64px compact, 80px cozy, 96px comfortable) | `useVirtualizer` with `measureElement` for dynamic height |
| Contact grid | ~200px cards (varies by density) | Grid rows via `useVirtualizer` |
| Contact list | ~64px rows (varies by density) | `useVirtualizer` with density-based estimate |

### What is NOT virtualized (and why)

| Surface | Reason |
|---------|--------|
| Folder tree sidebar | < 50 folders, no perf issue |
| Calendar month cells | Always 28-42 cells, fixed size |
| Calendar day/week time grid | Fixed 24 hours × visible days |
| Notes grid | < 500 notes typically, DOM manageable |
| Settings/admin | Fixed lists, already server-paginated |

### Message list implementation

```tsx
import { useVirtualizer } from '@tanstack/react-virtual';

const DENSITY_HEIGHTS = { compact: 64, cozy: 80, comfortable: 96 };

function MessageList({ messages, density }: Props) {
  const parentRef = useRef<HTMLDivElement>(null);

  const rowVirtualizer = useVirtualizer({
    count: messages.length,
    getScrollElement: () => parentRef.current,
    estimateSize: useCallback(() => DENSITY_HEIGHTS[density], [density]),
    measureElement: (el) => el.getBoundingClientRect().height, // dynamic for variable rows
    overscan: 10,
  });

  return (
    <div ref={parentRef} style={{ overflow: 'auto', height: '100%' }}>
      <div style={{ height: rowVirtualizer.getTotalSize(), position: 'relative' }}>
        {rowVirtualizer.getVirtualItems().map((virtualRow) => (
          <MessageRow
            key={messages[virtualRow.index].uid}
            message={messages[virtualRow.index]}
            density={density}
            ref={rowVirtualizer.measureElement}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              transform: `translateY(${virtualRow.start}px)`,
            }}
          />
        ))}
      </div>
    </div>
  );
}
```

### Contact grid implementation

Grid virtualization works with rows of cards:

```tsx
function ContactGrid({ contacts, density }: Props) {
  const parentRef = useRef<HTMLDivElement>(null);
  const [columns, setColumns] = useState(3);

  // Recalculate columns on resize
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => {
      setColumns(Math.max(1, Math.floor(entry.contentRect.width / 300)));
    });
    if (parentRef.current) observer.observe(parentRef.current);
    return () => observer.disconnect();
  }, []);

  const rows = Math.ceil(contacts.length / columns);

  const gridVirtualizer = useVirtualizer({
    count: rows,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 200, // card height
    overscan: 3,
  });

  // Render only visible rows
  return (
    <div ref={parentRef} style={{ overflow: 'auto', height: '100%' }}>
      <div style={{ height: gridVirtualizer.getTotalSize(), position: 'relative' }}>
        {gridVirtualizer.getVirtualItems().map((virtualRow) => {
          const startIdx = virtualRow.index * columns;
          const rowContacts = contacts.slice(startIdx, startIdx + columns);
          return (
            <div
              key={virtualRow.key}
              style={{
                position: 'absolute',
                top: 0,
                transform: `translateY(${virtualRow.start}px)`,
                display: 'grid',
                gridTemplateColumns: `repeat(${columns}, 1fr)`,
                gap: 20,
                width: '100%',
              }}
            >
              {rowContacts.map((c) => (
                <ContactCard key={c.id} contact={c} />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
```

### Scroll position preservation

Since React Router preserves the parent layout when navigating to a nested detail route (e.g., `/mail/inbox/:uid`), the message list component stays mounted and scroll position is naturally preserved. For cases where the component is remounted (e.g., folder switch), scroll position resets to top — this is the expected behavior.

---

## Section 5: Skeleton Loading States

### Reusable `<Skeleton>` component

A single component in `shared/components/Skeleton.tsx` — no per-app duplication:

```tsx
interface SkeletonProps {
  width?: string | number;
  height?: string | number;
  variant?: 'text' | 'circle' | 'rect';
  count?: number;  // Repeat N times with gap
}
```

CSS shimmer animation:

```css
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

.skeleton--circle { border-radius: 50%; }
.skeleton--text   { border-radius: var(--radius-sm); }
```

### Loading state semantics

Each data hook exposes `isLoading` and `isRefreshing`:

| Flag | Meaning | Skeleton? |
|------|---------|-----------|
| `isLoading` | First load, no data yet | **Yes** — full skeleton |
| `isRefreshing` | Background refresh, stale data exists | **No** — keep stale data, show subtle spinner in header |
| Both false, data empty | Loaded, zero results | **No** — show empty state ("No messages", etc.) |

This prevents the "flash skeleton then flash empty state" UX.

### Skeleton locations

| Surface | Trigger | Pattern |
|---------|---------|---------|
| Message list | Folder switch, search, initial load | 10 rows: checkbox circle + avatar circle + 3 text bars + date bar |
| Message viewer | Opening a message | Subject bar, date bar, 8 body text lines, 2 attachment blocks |
| Folder sidebar | Initial auth | 8 nav-item bars + quota bar |
| Contact grid | Initial load, GAL search | 20 cards: avatar circle + 4-5 text bars each |
| Contact list | Same, list view | 15 rows: avatar circle + 3 text bars each |
| Calendar month | Initial load, month nav | 35 day cells, ~5 with 1-2 event bar placeholders each |
| Calendar week/day | Initial load | Time grid with 3-4 event block placeholders |
| Notes grid | Initial load | 12 cards: 4px color bar + title bar + 3 content text lines |

### Example: Message list skeleton

```tsx
function MessageListSkeleton({ count = 10, density }: { count?: number; density: string }) {
  const height = DENSITY_HEIGHTS[density];
  return (
    <div className="message-list">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="message-row" style={{ height }}>
          <Skeleton variant="circle" width={16} height={16} />
          <Skeleton variant="circle" width={28} height={28} />
          <div style={{ flex: 1, marginLeft: 12 }}>
            <Skeleton width="30%" height={13} />
            <Skeleton width="70%" height={13} style={{ marginTop: 4 }} />
            <Skeleton width="50%" height={11} style={{ marginTop: 4 }} />
          </div>
          <Skeleton width={36} height={11} />
        </div>
      ))}
    </div>
  );
}
```

### Integration with data hooks

```tsx
// Example: ContactsLayout
function ContactsLayout() {
  const { contacts, isLoading, isRefreshing, error, refresh } = useContacts();

  if (error) return <ErrorBanner error={error} onRetry={refresh} />;
  if (isLoading) return <ContactGridSkeleton count={20} />;
  if (contacts.length === 0) return <EmptyContacts />;

  return (
    <>
      {isRefreshing && <RefreshingIndicator />}
      <ContactGrid contacts={contacts} />
    </>
  );
}
```

---

## What This Phase Does NOT Include

- New features for any app (inline reply, snooze, invitations, etc. — those are Phase 2+)
- PWA / offline support (Phase 5)
- Global search (Phase 5)
- Accessibility audit (Phase 5)
- Right-click context menus (Phase 5)
- Component library migration (Tailwind, etc.)
- Any backend changes
- ActiveSync changes
- IMAP/Dovecot/Postfix changes

---

## Success Criteria

1. `App.tsx` is under 300 lines — just the auth gate and layout shell
2. Every app has its own directory with routes, components, and hooks
3. All existing functionality works identically (no regressions)
4. URLs are deep-linkable and browser back/forward works
5. On mobile (< 768px), the app switches to single-pane drill-down with bottom tab bar
6. Message list with 10,000 items scrolls at 60fps (virtualized)
7. Contact grid with 5,000 contacts scrolls at 60fps (virtualized)
8. Every list/grid shows skeleton placeholders on first load instead of a spinner
9. `tsc -b && vite build` passes with no errors
10. Existing integration smoke tests pass
