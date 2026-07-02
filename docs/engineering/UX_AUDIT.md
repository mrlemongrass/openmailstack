# OpenMailStack UX Audit

> Last updated: 2026-07-02
> Method: Code-level audit of all product surfaces + browser verification of login/auth gate

## Audit Summary

| Surface | Score | Status |
|---------|-------|--------|
| Mail shell / AppShell | 7/10 | Good three-pane layout, missing mobile header/settings access |
| Message list | 7/10 | Good density system, missing preview/snippet text |
| Message viewer | 8/10 | Reply All/Forward fixed, HTML sanitized with DOMPurify |
| Compose / Reply | 6/10 | Schedule send+identities fixed, inline reply basic |
| Search | 6/10 | Search always visible, loading indicator added, hints unimplemented |
| Calendar | 7/10 | MonthView solid, non-functional views hidden, empty state added |
| Contacts | 8/10 | Good detail/edit panels, empty state added |
| Settings | 8/10 | Excellent feedback/validation, mobile-inaccessible, password change reloads |
| Mobile / Responsive | 7/10 | Settings added to mobile tab bar, single breakpoint, no tablet consideration |
| Loading states | 8/10 | Good skeleton system, searchLoading indicator added |
| Error states | 7/10 | Great ErrorBoundary/ErrorBanner, critical API failures surfaced |
| Keyboard | 8/10 | Shortcuts added for all primary mail actions (r,a,f,s,e,#,Esc) |
| Design system | 6/10 | Good glass theme, missing typography/spacing tokens |

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

## Next Recommended UX Task

Fix Reply All and Forward buttons in MessageViewer — highest severity, highest reach, clear fix path.
