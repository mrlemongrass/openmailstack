# OpenMailStack UX Audit

> Last updated: 2026-07-02
> Method: Code-level audit of all product surfaces + browser verification of login/auth gate

## Audit Summary

| Surface | Score | Status |
|---------|-------|--------|
| Mail shell / AppShell | 7/10 | Good three-pane layout, missing mobile header/settings access |
| Message list | 7/10 | Good density system, missing preview/snippet text |
| Message viewer | 6/10 | Good actions toolbar, Reply All/Forward broken, no HTML sanitization |
| Compose / Reply | 6/10 | Schedule send+identities fixed, inline reply basic |
| Search | 4/10 | SearchBar.tsx dead code, loading never shown, hints unimplemented |
| Calendar | 5/10 | MonthView solid, 4 views are stubs, no event empty state |
| Contacts | 7/10 | Good detail/edit panels, missing empty state for grid |
| Settings | 8/10 | Excellent feedback/validation, mobile-inaccessible, password change reloads |
| Mobile / Responsive | 6/10 | Single breakpoint, no tablet consideration, settings/admin missing |
| Loading states | 7/10 | Good skeleton system, searchLoading/isRefreshing unused |
| Error states | 6/10 | Great ErrorBoundary/ErrorBanner, 7+ API failures silent |
| Design system | 6/10 | Good glass theme, missing typography/spacing tokens |

## Critical Issues (broken functionality)

### 1. Reply All and Forward buttons are non-functional
- **Surface**: Message viewer
- **Problem**: Buttons render with no onClick handlers — clicking does nothing
- **User impact**: Cannot reply-all or forward messages (core mail workflows)
- **Severity**: Critical / Broken
- **Status**: Open
- **Suggested fix**: Wire Reply All to open compose with all recipients; wire Forward to open compose with "Fwd:" subject and quoted body
- **Ref**: `MessageViewer.tsx:69-70`

### 2. SearchBar.tsx is dead code, search hidden during selection
- **Surface**: Search
- **Problem**: `SearchBar.tsx` never imported; search input in MailToolbar hides when messages selected
- **User impact**: Search discoverability broken; must deselect all messages to search
- **Severity**: High
- **Status**: Open
- **Ref**: `SearchBar.tsx` (whole file), `MailToolbar.tsx:29-31`

### 3. Calendar has only MonthView — 4 views show "coming soon"
- **Surface**: Calendar
- **Problem**: View switcher offers Month/Week/Day/Agenda/Year but only Month works
- **User impact**: Clicking Week/Day/Agenda/Year shows dead-end placeholder
- **Severity**: High
- **Status**: Open
- **Suggested fix**: Hide non-functional views or implement WeekView
- **Ref**: `CalendarLayout.tsx:20-27`

### 4. Settings inaccessible on mobile
- **Surface**: Settings / Mobile
- **Problem**: Mobile tab bar has only Mail/Calendar/Contacts/Notes — no Settings
- **User impact**: Mobile users cannot access any settings
- **Severity**: High
- **Status**: Open
- **Suggested fix**: Add Settings icon to mobile tab bar
- **Ref**: `AppShell.tsx:85-104`

## High-Priority Issues (UX degradation)

### 5. searchLoading never shown to user
- **Surface**: Search
- **Problem**: `searchLoading` state set in useMail but never rendered in any component
- **User impact**: No feedback during search processing on slow connections
- **Severity**: Medium
- **Status**: Open
- **Ref**: `useMail.ts:56`, `MessageList.tsx:72-74`

### 6. 7+ API failures silently logged to console
- **Surface**: All
- **Problem**: fetchFolders, fetchMessages, fetchMessageBody, snoozeMessages, etc. all `console.error` with no user-facing feedback
- **User impact**: Stale/broken UI with no indication something went wrong
- **Severity**: Medium
- **Status**: Open
- **Ref**: `useMail.ts:99,113,203,215,226,239,267`

### 7. No HTML sanitization in MessageViewer
- **Surface**: Message viewer
- **Problem**: HTML rendered via `dangerouslySetInnerHTML` with no DOMPurify/sanitization
- **User impact**: Tracking pixels, potential XSS via malicious email HTML
- **Severity**: Medium (security + privacy)
- **Status**: Open
- **Ref**: `MessageViewer.tsx:112`

### 8. No empty state for calendar events (first use)
- **Surface**: Calendar
- **Problem**: MonthView renders a blank grid with no prompt to create first event
- **User impact**: New users see empty calendar with no guidance
- **Severity**: Medium
- **Status**: Open
- **Ref**: `MonthView.tsx:34-101`

### 9. No keyboard shortcuts for mail actions
- **Surface**: Mail shell
- **Problem**: No keyboard shortcuts for reply (r), forward (f), delete (#), star (s), archive (e)
- **User impact**: Power users cannot triage mail efficiently
- **Severity**: Medium
- **Status**: Open

### 10. No contact grid empty state
- **Surface**: Contacts
- **Problem**: After loading, empty contact list renders blank container with no message
- **User impact**: New users see nothing after contact load completes
- **Severity**: Medium
- **Status**: Open
- **Ref**: `ContactGrid.tsx:79-107`

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

### 13. No spinner component
- **Surface**: All
- **Problem**: Small-area loading states use text ("Loading...", "Saving...") with no animation
- **User impact**: Static text doesn't communicate ongoing activity well
- **Severity**: Low

### 14. No contact autocomplete in compose
- **Surface**: Compose
- **Problem**: To/Cc/Bcc fields are plain text inputs with no address autocomplete
- **User impact**: Users must type full email addresses; no discoverability of contacts
- **Severity**: Low
- **Ref**: `ComposeModal.tsx:98-103`

## Completed UX Improvements (this session)

- [x] Schedule send wired to backend (was non-functional stub)
- [x] Send-as identities wired from auth context (from selector now works)
- [x] Unsaved content confirmation on compose close
- [x] EmptyState for empty mail folders and search-no-results
- [x] ErrorBoundary crash protection wrapping AppShell
- [x] Code-split Notes and Admin routes (main bundle -66%)

## Next Recommended UX Task

Fix Reply All and Forward buttons in MessageViewer — highest severity, highest reach, clear fix path.
