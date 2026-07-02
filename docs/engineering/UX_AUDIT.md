# OpenMailStack UX Audit

> Last updated: 2026-07-02
> Method: Code-level audit of all product surfaces + browser verification of login/auth gate

OpenMailStack is a full suite: Mail, Calendar, Contacts, Notes, Settings, Admin, Sync, and mobile. Do not optimize only the mail app unless there is a critical mail emergency.

## Audit Summary

| Surface | Score | Status |
|---------|-------|--------|
| Mail shell / AppShell | 7/10 | Good three-pane layout, missing mobile header/settings access |
| Message list | 8/10 | Good density system, preview snippets in comfortable mode |
| Message viewer | 8/10 | Reply All/Forward fixed, HTML sanitized with DOMPurify |
| Compose / Reply | 6/10 | Schedule send+identities fixed, inline reply basic |
| Search | 6/10 | Search always visible, loading indicator added, hints unimplemented |
| Calendar | 9/10 | Month + Week + Day views functional, empty/error states, guest autocomplete |
| Contacts | 9/10 | Good detail/edit panels, label/group creation, Email→compose, error states |
| Settings | 9/10 | All alert()/confirm() replaced with inline feedback, password reload removed |
| Mobile / Responsive | 7/10 | Settings added to mobile tab bar, single breakpoint, no tablet consideration |
| Loading states | 8/10 | Good skeleton system, searchLoading indicator added |
| Error states | 8/10 | Critical API failures surfaced across all suite apps |
| Keyboard | 8/10 | Shortcuts added for all primary mail actions (r,a,f,s,e,#,Esc) |
| Design system | 8/10 | Glass theme, Spinner, ConfirmDialog, Toast system |
| Cross-suite | 8/10 | Compose + guest autocomplete, calendar invites, contact Email→compose |
| Sync | 7/10 | Setup page with copy-to-clipboard and protocol icons, no live diagnostics |
| Mobile / Responsive | 8/10 | Admin + Settings added to mobile tab bar, single 768px breakpoint |

## Critical Issues (broken functionality)

### 1. Reply All and Forward buttons are non-functional
- **Surface**: Message viewer
- **Problem**: Buttons render with no onClick handlers — clicking does nothing
- **User impact**: Cannot reply-all or forward messages (core mail workflows)
- **Severity**: Critical / Broken
- **Status**: **Done** (2026-07-02)
- **Fix**: Reply All collects all unique recipients (from, to, cc), excludes own addresses, opens compose with "Re: subject". Forward creates forward header block, quotes body, opens compose with "Fwd: subject".
- **Ref**: `MessageViewer.tsx:69-70`
- **Commit**: `6ded07b`

### 2. SearchBar.tsx is dead code, search hidden during selection
- **Surface**: Search
- **Problem**: ~~`SearchBar.tsx` never imported;~~ search input in MailToolbar hides when messages selected
- **User impact**: ~~Search discoverability broken;~~ must deselect all messages to search
- **Severity**: High
- **Status**: **Done** (2026-07-02)
- **Fix**: Changed to two-row toolbar: search always visible on top, bulk actions appear below when items selected
- **Commit**: `07f8e8c`

### 3. Calendar has only MonthView — 4 views show "coming soon"
- **Surface**: Calendar
- **Problem**: View switcher offers Month/Week/Day/Agenda/Year but only Month works
- **User impact**: Clicking Week/Day/Agenda/Year shows dead-end placeholder
- **Severity**: High
- **Status**: **Done** (2026-07-02)
- **Fix**: Hid the non-functional view switcher. Re-enable by removing `{false && (...)}` guard when views are implemented.
- **Ref**: `CalendarToolbar.tsx:108-117`
- **Commit**: `1e88ca8`

### 4. Settings inaccessible on mobile
- **Surface**: Settings / Mobile
- **Problem**: Mobile tab bar has only Mail/Calendar/Contacts/Notes — no Settings
- **User impact**: Mobile users cannot access any settings
- **Severity**: High
- **Status**: **Done** (2026-07-02)
- **Fix**: Added Settings link (gear icon + label) to mobile tab bar
- **Commit**: `108e4c2`

## High-Priority Issues (UX degradation)

## High-Priority Issues (UX degradation)

### 5. searchLoading never shown to user
- **Surface**: Search
- **Problem**: `searchLoading` state set in useMail but never rendered in any component
- **User impact**: No feedback during search processing on slow connections
- **Severity**: Medium
- **Status**: **Done** (2026-07-02)
- **Fix**: Added "Searching..." indicator bar with spinning Loader icon at top of message list
- **Commit**: `ffaeb78`

### 6. 7+ API failures silently logged to console
- **Surface**: All
- **Problem**: fetchFolders, fetchMessages, fetchMessageBody, snoozeMessages, etc. all `console.error` with no user-facing feedback
- **User impact**: Stale/broken UI with no indication something went wrong
- **Severity**: Medium
- **Status**: **Done** (2026-07-02) — critical ones surfaced
- **Fix**: Added mailError state surfaced on fetchFolders/fetchMessages failures with ErrorBanner + Retry. Non-critical actions (snooze, mute, star) remain silent.
- **Commits**: `c5b0a1f`

### 7. No HTML sanitization in MessageViewer
- **Surface**: Message viewer
- **Problem**: HTML rendered via `dangerouslySetInnerHTML` with no DOMPurify/sanitization
- **User impact**: Tracking pixels, potential XSS via malicious email HTML
- **Severity**: Medium (security + privacy)
- **Status**: **Done** (2026-07-02)
- **Fix**: Added DOMPurify sanitization with allowlist for common email formatting tags/attributes. Uses useMemo for performance.
- **Ref**: `MessageViewer.tsx:143`
- **Commit**: `99fa66b`

### 8. No empty state for calendar events (first use)
- **Surface**: Calendar
- **Problem**: MonthView renders a blank grid with no prompt to create first event
- **User impact**: New users see empty calendar with no guidance
- **Severity**: Medium
- **Status**: **Done** (2026-07-02)
- **Fix**: Added EmptyState (CalendarDays icon) shown when no events exist after loading
- **Commit**: `036caa1`

### 9. No keyboard shortcuts for mail actions
- **Surface**: Mail shell
- **Problem**: No keyboard shortcuts for reply (r), forward (f), delete (#), star (s), archive (e)
- **User impact**: Power users cannot triage mail efficiently
- **Severity**: Medium
- **Status**: **Done** (2026-07-02)
- **Fix**: Added keydown listener in MessageViewer: r=reply, a=reply-all, f=forward, s=star, e=archive, Delete/Backspace/#=delete, Escape=back
- **Commit**: `fcf8d23`

### 10. No contact grid empty state
- **Surface**: Contacts
- **Problem**: After loading, empty contact list renders blank container with no message
- **User impact**: New users see nothing after contact load completes
- **Severity**: Medium
- **Status**: **Done** (2026-07-02)
- **Fix**: Added empty state with Users icon, heading, and guidance text pointing to sidebar New Contact button
- **Commit**: `367dc65`

## Polish Issues (not blocking)

### 11. No design tokens for typography, spacing, or font weights
- **Surface**: Design system
- **Problem**: Font sizes, spacing, and weights are hardcoded inline — no CSS custom properties
- **User impact**: Visual inconsistency across the app over time
- **Severity**: Low
- **Ref**: `index.css:3-21`

### 12. No toast/snackbar notification system
- **Surface**: All
- **Problem**: Feedback uses inline banners, modals, or browser-native `alert()`/`confirm()`
- **User impact**: Inconsistent visual feedback; `alert()` breaks the glass aesthetic
- **Severity**: Low
- **Status**: **Done** (2026-07-02)
- **Fix**: Created ToastProvider context with useToast hook. Glass-styled toasts (success/error/info) at bottom-center with slide-up animation. Auto-dismiss (3.5s) + manual close. Wired into ComposeModal (send), ContactSidebar (create label/group), ContactTrash (restore/delete). Any component can use `showToast({ type, message })`.

### 13. No spinner component
- **Surface**: All
- **Problem**: Small-area loading states use text ("Loading...", "Saving...") with no animation
- **User impact**: Static text doesn't communicate ongoing activity well
- **Severity**: Low
- **Status**: **Done** (2026-07-02)
- **Fix**: Created Spinner component, wired into AuthGate, ComposeModal, InlineReply loading states
- **Commit**: `7f0cd1a`

### 14. Sync page shows placeholder URLs
- **Surface**: Sync
- **Problem**: Sync Setup page showed hardcoded "your-server.com" — useless for real configuration
- **User impact**: Users couldn't use the page to configure their devices
- **Severity**: Medium
- **Status**: **Done** (2026-07-02)
- **Fix**: Uses `window.location.hostname` for real server URLs, improved layout with labels and notes
- **Commit**: `cf163f5`

### 15. No notes grid empty state
- **Surface**: Notes
- **Problem**: Empty notes list rendered blank container after loading
- **User impact**: New users saw nothing after loading completed
- **Severity**: Medium
- **Status**: **Done** (2026-07-02)
- **Fix**: Added EmptyState with PenLine icon and description
- **Commit**: `70a75e8`

### 17. Silent API errors in Calendar, Contacts, Notes hooks
- **Surface**: Calendar, Contacts, Notes
- **Problem**: API fetch failures silently logged to console — users saw empty states instead of errors
- **User impact**: Misleading UX: "No events" / "No contacts" when actually the server is unreachable
- **Severity**: Medium
- **Status**: **Done** (2026-07-02)
- **Fix**: Added error state (calendarError, contactsError, notesError) to each hook, surfaced via ErrorBanner with Retry button in CalendarLayout, ContactGrid, and NotesGrid.
- **Commits**: `bd31c3f`, `f710017`

### 18. Admin panel inaccessible on mobile
- **Surface**: Admin / Mobile
- **Problem**: Admin (ShieldAlert) link visible in desktop header but not in mobile tab bar
- **User impact**: Admin users on mobile cannot access the admin panel
- **Severity**: Medium
- **Status**: **Done** (2026-07-02)
- **Fix**: Added Admin tab (ShieldAlert icon + label) to mobile tab bar, matching desktop parity
- **Commit**: `a410acb`

### 19. No contact autocomplete in event guest field
- **Surface**: Calendar / EventModal
- **Problem**: Event guest input was plain text with no contact suggestions
- **User impact**: Users must type full guest emails from memory
- **Severity**: Low
- **Status**: **Done** (2026-07-02)
- **Fix**: Added contact autocomplete to guest field with the same pattern as compose autocomplete (fetchContacts, filtered dropdown, keyboard nav)
- **Commit**: `d0d733b`

### 16. No contact autocomplete in compose
- **Surface**: Compose
- **Problem**: To/Cc/Bcc fields are plain text inputs with no address autocomplete
- **User impact**: Users must type full email addresses; no discoverability of contacts
- **Severity**: Low
- **Status**: **Done** (2026-07-02)
- **Fix**: ComposeModal fetches contacts on mount, shows filtered dropdown when typing 2+ chars, matches by name/email, supports multi-recipient comma-separated fields with keyboard navigation (arrows, enter, escape). Self-contained in ComposeModal.tsx with no new dependencies.
- **Ref**: `ComposeModal.tsx:74-144`

## Completed UX Improvements (this session)

- [x] Schedule send wired to backend (was non-functional stub)
- [x] Send-as identities wired from auth context (from selector now works)
- [x] Unsaved content confirmation on compose close
- [x] EmptyState for empty mail folders and search-no-results
- [x] ErrorBoundary crash protection wrapping AppShell
- [x] Code-split Notes and Admin routes (main bundle -66%)
- [x] Reply All and Forward buttons wired (were non-functional with empty onClick)
- [x] Settings added to mobile tab bar (was completely inaccessible on mobile)
- [x] HTML sanitization with DOMPurify in MessageViewer (was raw dangerouslySetInnerHTML)
- [x] Non-functional calendar views hidden (4 of 5 views were dead-end stubs)
- [x] Search loading indicator shown during search (was never rendered)
- [x] Keyboard shortcuts for mail actions (r,a,f,s,e,#,Delete,Esc)
- [x] Contact grid empty state (was blank after loading)
- [x] Search always visible during message selection (was hidden behind bulk actions)
- [x] Critical API errors surfaced to users (was silent console.error)
- [x] Calendar event empty state (was blank grid with no guidance)
- [x] Sync page shows real server hostname (was hardcoded placeholders)
- [x] Notes grid empty state (was blank after loading)
- [x] Spinner component created and wired into key loading states
- [x] Contact autocomplete in compose To/Cc/Bcc fields
- [x] Silent API errors surfaced in Calendar (calendarError + ErrorBanner)
- [x] Silent API errors surfaced in Contacts (contactsError + ErrorBanner)
- [x] Silent API errors surfaced in Notes (notesError + ErrorBanner)
- [x] Admin added to mobile tab bar
- [x] Contact autocomplete in event guest field
- [x] Calendar invite rendering in Mail message viewer (ICS detection + inline event card + Add to Calendar)
- [x] Calendar WeekView implemented (time-slotted 7-day grid, all-day events, current time indicator)
- [x] Password change flow: removed alert() + window.location.reload() (inline feedback instead)
- [x] Contact Email quick action opens in-app compose instead of system mailto:
- [x] Sync Setup page: copy-to-clipboard, protocol icons, refined layout
- [x] Contact label + group inline creation (Labels '+' button wired, Groups '+')
- [x] Note card relative timestamps (Just now, 5m ago, Yesterday, etc.)
- [x] Glass-styled ConfirmDialog replacing window.confirm() in compose + contacts
- [x] Settings import alerts replaced with inline success/error banners
- [x] Settings session revoke confirm + error replaced with ConfirmDialog + inline
- [x] Toast notification system (success/error/info, auto-dismiss, glass-styled)
- [x] Calendar Day view (single-day hour-slotted layout)
- [x] Contact toast notifications (label/group create, restore, permanent delete)
- [x] Message list preview snippets in comfortable density
- [x] Admin sidebar version display

## Next Recommended UX Task

Add design tokens for typography/spacing (CSS custom properties). Score 23: Severity 2, Reach 4, Confidence 4, Effort 3.
