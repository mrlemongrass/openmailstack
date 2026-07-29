# OpenMailStack UX Audit

> Last updated: 2026-07-29
> Method: Playwright desktop/mobile review plus source tracing. Public/login routes used the live site; the initial authenticated audit used deterministic API fixtures, followed by read-only validation with the established `localtest@housevo.us` admin test account.

OpenMailStack is a full suite: Mail, Calendar, Contacts, Notes, Settings, Admin, Sync, and mobile. Do not optimize only the mail app unless there is a critical mail emergency.

## 2026-07-29 Suite Playwright Audit

The desktop suite is generally coherent and usable. The largest current gaps are mobile creation workflows. Playwright evidence for this pass is stored locally under `output/playwright/` and contains no authenticated production user data.

### Resolved in this cycle

| Surface | Finding | Resolution | Proof |
|---------|---------|------------|-------|
| Mail | The Move-to-folder picker inherited the shared translucent glass background, allowing message content to show through in both dark and light themes. | Added a dedicated opaque, theme-aware picker surface while preserving the shared glass treatment elsewhere. | Computed backgrounds are opaque in dark (`rgb(17, 24, 39)`), light (`rgb(255, 255, 255)`), and high-contrast (`rgb(5, 5, 5)`); focus, filtering, and Escape-to-close pass in Playwright. |
| Public Scheduler / mobile | Selecting a time left the booking form below the complete mobile slot list, with no transition to show that the next step was ready. | On viewports up to 680 px, a selected slot now scrolls the details form into view and focuses its labelled container. The transition is smooth by default and immediate when reduced motion is requested; desktop behavior is unchanged. | At 390×844, Playwright observed the full 378 px form in the viewport, `#root.scrollTop` moving from 0 to 6761, and the form receiving programmatic focus. Reduced-motion and desktop branches were verified separately with zero public-page console errors. |
| Mail | Clicking a message-row checkbox also opened the message. | The checkbox now stops its originating click before it reaches row navigation and exposes a subject-based accessible label. | Authenticated Playwright verified mouse and Space-key toggles at desktop and 390×844 while the route remained `/mail/inbox`; clicking the message subject still opened `/mail/inbox/19`. |
| Contacts / mobile | The virtualized grid forced three columns after the sidebar disappeared, clipping cards and removing the only New Contact action. | Mobile now renders one full-width card per virtual row, uses a compact row estimate, hides the redundant grid/list switch, and exposes a primary New Contact action that opens the editor. | At 390×844, authenticated Playwright measured a 390 px document with 358 px cards, consecutive row tops at 201/291 px, and a complete Create Contact modal opened from the populated list without saving data. |
| Calendar / mobile | Month event chips truncated from the leading time, leaving no visible event identity. | Narrow mobile chips now lead with the event title while the full time, title, location, and recurrence context remain in the accessible label and tooltip; desktop keeps the full time-first text. | At 390 px, authenticated Playwright observed visible `Calendar Smoke Event` / `ActiveSync Calendar Smoke Event` strings in 46 px chips with complete time/location titles. At 1440 px, the rendered text retained the complete time-first presentation. |
| Notes / mobile | The populated list had no creation action, and numeric false flags rendered as stray `0`/`00` text. Opening the editor also contacted hard-coded public WebRTC signaling endpoints by default. | Mobile now exposes New Note above populated cards, normalizes numeric flags before rendering, and enables WebRTC only when an operator explicitly configures signaling endpoints. The empty-state copy no longer promises unconfigured collaboration. | A populated 390×844 fixture showed the primary action, no numeric artifacts, no overflow, and a working editor. A fresh editor open produced zero console errors and no signaling requests; existing content still initialized through the local Yjs/Quill binding. |
| Scheduler owner / mobile | Six owner tabs lived in an unlabelled horizontal overflow strip, hiding later destinations, while public-link actions competed for one row. | Mobile now uses a labelled section picker containing every destination and stacks the public-link actions at full width. Desktop retains the icon sidebar and inline actions. | At 390×844, Playwright confirmed the desktop tabs hidden, all six picker options visible, 328 px action columns, zero horizontal overflow, and a successful Profile transition. At 1440 px the desktop grid returned and the mobile picker was hidden. |

### Prioritized open findings

| Priority | Surface | Finding | User impact | Source evidence |
|----------|---------|---------|-------------|-----------------|
| P3 | Login / dark | The tenant logo is very low contrast against the dark login background. | Branding looks faint and can appear missing on first load. | Live login Playwright screenshot at 1440 px. |

### What is working well

- Mail's desktop three-pane hierarchy, Calendar's desktop views, Contacts detail, Notes cards, and the Scheduler owner desktop are visually coherent.
- The suite-level mobile tab bar is consistent across the audited authenticated apps.
- Scheduler's owner event cards, public profile, mobile navigation, and public booking transition are clear.

## Earlier Audit Summary (2026-07-02)

| Surface | Score | Status |
|---------|-------|--------|
| Mail shell / AppShell | 7/10 | Good three-pane layout, missing mobile header/settings access |
| Message list | 8/10 | Good density system, preview snippets in comfortable mode |
| Message viewer | 8/10 | Reply All/Forward fixed, HTML sanitized with DOMPurify |
| Compose / Reply | 7/10 | Schedule send+identities fixed, word count, toast for Send & Archive |
| Search | 7/10 | Search always visible, syntax hints + folder scope indicator, loading indicator |
| Admin | 7/10 | System health with countdown, Fail2ban with unban toast, Spam JSON formatter |
| Calendar | 9/10 | Month + Week + Day views functional, empty/error states, guest autocomplete |
| Contacts | 9/10 | Label/group creation + filtering, bulk delete, Email→compose, error states |
| Notes | 8/10 | Rich editor + autosave indicator, pin toggle + toast, actionable empty state |
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

## Critical Bugs Found + Fixed (2026-07-03 live verification)

### B1. Admin Updates panel crashes with React error
- **Surface**: Admin → Updates
- **Root cause**: Backend `components` returned object `{Nginx: "1.24"}` but frontend treated as array with `.map()`
- **Fix**: Backend converts to `[{name, version}]` array
- **Commit**: `ebbd2ba0`
- **Verification method**: Live Playwright — 0 console errors after fix

### B2. Contacts limited to 200 with no way to load more
- **Surface**: Contacts
- **Root cause**: `loadMoreContacts` hook existed but had zero UI triggers — no button, no infinite scroll
- **Fix**: Added "Load More Contacts" button when `hasMore` is true
- **Commit**: `ebbd2ba0`

### B3. Admin domains show 0 mailboxes and 0 aliases
- **Surface**: Admin → Domains
- **Root cause**: `domain.aliases`/`domain.mailboxes` were stale counter columns, not live counts
- **Fix**: Real-time `COUNT(*)` subqueries on `alias` and `mailbox` tables
- **Commit**: `ebbd2ba0`

### B4. Mail message loading is very slow
- **Surface**: Mail → Message viewer
- **Root cause**: IMAP connection-per-request — pre-fetching 10 messages = 10 parallel TCP connections
- **Fix (partial)**: Reduced pre-fetch to 3. Full fix needs IMAP connection pooling.
- **Commit**: `ebbd2ba0`

## QoL Issues (2026-07-02 QoL pass)

### Q1. Compose autocomplete dropdown clipped by scroll container
- **Surface**: Compose
- **Stress case**: Typing in To/Cc/Bcc with contacts matching → dropdown clipped inside `overflow: auto` form area
- **User impact**: Can't see all matching contacts, especially on smaller viewports
- **Severity**: Medium
- **Status**: **Done** (2026-07-02)
- **Fix**: Restructured compose layout — recipient fields (From, To, Cc, Bcc, Subject) now outside scroll area (`flexShrink: 0`). Only body textarea + attachments scroll.
- **Commit**: `3d91ba4`

### Q2. Settings panes: some lack sticky Save button
- **Surface**: Settings (various panes)
- **Audit result (2026-07-03)**: Most panes auto-save on change (Identity, Signatures, Reading, Spam, Contacts, Calendar, Appearance, Advanced). Panes with explicit Save (Forwarding, Vacation) have forms short enough to fit on screen. Filters already has sticky bar ✅. **No critical gaps found.** 
- **Status**: **Closed — no action needed**

### Q3. Mobile: no Compose button on mobile viewport
- **Surface**: Mail / Mobile
- **Stress case**: 375px viewport — folder sidebar hidden, desktop header hidden, no way to compose
- **User impact**: Mobile users literally cannot compose a new email
- **Severity**: Critical
- **Status**: **Done** (2026-07-02)
- **Fix**: Added floating action button (+ icon) at bottom-right of message list, positioned above the mobile tab bar
- **Commit**: `8e567c1`

### Q4. Mobile compose: modal width overflows on small screens
- **Surface**: Compose + Event modals / Mobile
- **Stress case**: 375px viewport — compose modal 650px fixed, event modal 600px fixed
- **User impact**: Modal content cut off, buttons unreachable
- **Severity**: Medium
- **Status**: **Done** (2026-07-02)
- **Fix**: Changed to `width: min(650px, 100%)` and `width: min(600px, 100%)` for responsive sizing
- **Commit**: `329bb35`

### Q5. Compose modal: no keyboard Escape to close
- **Surface**: Compose
- **Stress case**: Keyboard user composing — must reach for mouse to close modal
- **User impact**: Breaks keyboard workflow, excessive mouse travel
- **Severity**: Medium
- **Status**: **Done** (2026-07-02)
- **Fix**: Added `onKeyDown` handler on overlay div, Escape calls `handleClose()`. Overlay auto-focuses via `tabIndex=-1`.
- **Commit**: `1d94362`

### Q6. Long lists: no quick scroll-to-top
- **Surface**: Mail, Contacts
- **Stress case**: Scrolling through 50+ messages, no way to quickly return to top
- **User impact**: Excessive mouse travel, repetitive scrolling
- **Severity**: Medium
- **Status**: **Done** (2026-07-03)
- **Fix**: Created reusable `ScrollToTop` component — monitors scroll position, shows glass-styled ↑ button at bottom-right when scrolled past 400px. Smooth-scrolls to top on click. Wired into MessageList.
- **Commit**: `b29619c` — extended to Contacts + Notes grids in `200ce80`

### Q7. Message viewer: no Back button after scrolling past body
- **Surface**: Mail / Message viewer
- **Stress case**: Reading a long email — must scroll all the way back to top to press the back arrow
- **User impact**: Excessive scroll travel, especially on mobile
- **Severity**: Medium
- **Status**: **Done** (2026-07-03)
- **Fix**: Floating "← Back" button at bottom-left when scrolled past 60px. Uses passive scroll listener, navigates to inbox.
- **Commit**: `bda7aa1`

### Q8. Forwarding/Vacation: no unsaved changes warning on navigation
- **Surface**: Settings
- **Stress case**: User types in Forwarding address, navigates away — text is lost with no warning
- **User impact**: Minor data loss risk for panes with explicit Save
- **Severity**: Low — panes are short, explicit Save is visible in header
- **Status**: Open — future enhancement

## Polish Issues (not blocking)

### 11. No design tokens for typography, spacing, or font weights
- **Surface**: Design system
- **Status**: **Done** (2026-07-03)
- **Fix**: Defined CSS custom properties for font sizes (xs–2xl), font weights (normal–bold), line heights, and spacing (4px–40px) in `:root`. Enables gradual adoption.
- **Commit**: `0792edb`

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

### [Status] Surface — Short title

Surface:
Mail / Calendar / Contacts / Notes / Settings / Admin / Sync / Mobile / Cross-suite

Type:
Bug / Missing feature / Misleading placeholder / Quality-of-life / Accessibility / Performance / Visual polish / Cross-suite integration

Problem:
Describe the current user-facing issue.

User impact:
Explain why this makes the product feel confusing, slow, fragile, awkward, inaccessible, or unfinished.

Realistic stress case:
Describe the data volume or interaction that reveals the issue, such as many filters, many guests, many contacts, long note, mobile viewport, many attachments, or long settings page.

Expected behavior:
Describe what should happen instead.

Suggested fix:
Describe a bounded improvement.

Severity:
1-5

Reach:
1-5

Release blocker level:
P0 / P1 / P2 / P3 / N/A

Proof:
Screenshot, route, browser notes, reproduction steps, test, or code reference.

Status:
Open / In Progress / Done / Blocked / Needs Verification

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
- [x] Notes empty state with actionable Create Note button
- [x] Contact label filtering (clicking a label now filters contacts)
- [x] Notes pin/unpin toast feedback on cards
- [x] Mail compose word/character count
- [x] Message body loading spinner (replaces misleading '(no content)')
- [x] Message body pre-fetching (bodies cached before click, like Gmail/Outlook)
- [x] Admin SpamPanel JSON Format button
- [x] Calendar event count in toolbar
- [x] Send & Archive toast confirmation
- [x] Settings Forwarding helper text
- [x] Mail search folder scope indicator ("in INBOX")
- [x] Contacts clear filter button when label selected
- [x] Notes clear label filter button
- [x] Contact cards show organization + job title
- [x] Sync page refresh button + last-checked timestamp
- [x] Admin Updates panel last-checked time
- [x] Settings Advanced → About with version v0.1.5
- [x] Notes card delete button with toast

## Acceptance Criteria for Batch 17

| Cycle | Task | AC | Proof |
|-------|------|----|-------|
| 1 | Sync refresh | Refresh button re-checks, timestamp shows | TSC/Build ✅ |
| 2 | Admin last-checked | Timestamp next to Check Again | TSC/Build ✅ |
| 3 | Settings About | v0.1.5 shown in Advanced pane | TSC/Build ✅ |
| 4 | Notes delete | Delete moves to trash + toast | TSC/Build ✅ |

## Acceptance Criteria for Batch 16

| Cycle | Task | User-Visible AC | Technical AC |
|-------|------|----------------|--------------|
| 1 | Search scope | "in INBOX" shown next to search bar | activeFolder prop passed to MailToolbar |
| 2 | Contacts clear filter | Button appears when label active, resets to all | setSelectedLabel(null) |
| 3 | Notes clear filter | Button when filtering by label | setNotesView('notes') |
| 4 | Contact org display | Company + job title on grid cards | organization + jobTitle fields rendered |

### Proof: TSC ✅, Build ✅, Backend tests 26/26 ✅

## Acceptance Criteria for Batch 15

| Cycle | Task | User-Visible AC | Technical AC |
|-------|------|----------------|--------------|
| 1 | Admin Spam Format | Format button pretty-prints JSON; red error on invalid | JSON.parse/stringify with 2-space indent |
| 2 | Calendar event count | Event count badge next to month label | Filter cal.events by calendarVisibility |
| 3 | Send & Archive toast | Toast "Message sent" appears for Send & Archive | setDidSend(true) before handleSendAndArchive |
| 4 | Forwarding helper | Descriptive text above Forward To field | Pure UI, no API changes |

### Proof

| Check | Result |
|-------|--------|
| `npx tsc -b` | No errors |
| `npx vite build` | Success |
| `npm test` (backend) | 26/26 pass |

## Acceptance Criteria for Batch 14

| Cycle | Task | User-Visible AC | Technical AC |
|-------|------|----------------|--------------|
| 1 | Notes actionable empty state | Empty notes grid shows "Create Note" button that opens editor | Button calls setEditingNote + setIsNoteModalOpen |
| 2 | Contacts label filtering | Clicking a label filters the contact grid to matching contacts | useMemo filters contacts by labels_json match |
| 3 | Notes pin toast | Pin/Unpin on card shows toast confirmation | useToast in NoteCard, saveNote persists toggle |
| 4 | Mail compose word count | Word and character count visible below body textarea while typing | Strips HTML, counts words via split(/\s+/) |

### Proof

| Check | Result |
|-------|--------|
| `npx tsc -b` | No errors |
| `npx vite build` | Success |
| `npm test` (backend) | 26/26 pass |
| Playwright | Notes editor opens, mail body loads |

## Next Recommended UX Task

Add design tokens for typography/spacing (CSS custom properties). Score 23: Severity 2, Reach 4, Confidence 4, Effort 3.
