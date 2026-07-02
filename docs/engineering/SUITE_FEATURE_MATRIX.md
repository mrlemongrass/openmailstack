# OpenMailStack Suite Feature Matrix

OpenMailStack is a full suite: Mail, Calendar, Contacts, Notes, Settings, Admin, Sync, and mobile. Do not optimize only the mail app unless there is a critical mail emergency.

This file tracks features inspired by iCloud, Gmail/Google Workspace, and Microsoft 365/Outlook.

Translate useful ideas into OpenMailStack-native, self-hostable, privacy-respecting features.

## Status Labels

- Not Started
- Partial
- Implemented
- Needs Verification
- Blocked
- Intentionally Out of Scope

## Priority Labels

- Must
- Should
- Could
- Later

## Matrix

| Surface | Feature | Inspiration | OMS-native version | Priority | Status | Notes |
|---|---|---|---|---|---|---|
| Mail | Undo send | Gmail/Outlook-style delayed send | Configurable short cancellation window before final SMTP send | Should | Not Started | Requires queue/delay semantics |
| Mail | Snooze | Gmail/Outlook-style snooze | Hide until selected time, restore to inbox via queue | Should | Partial | Verify current implementation |
| Mail | Rules/filters | Gmail filters / Outlook rules | User-defined server-side rules via Sieve or backend rules engine | Must | Needs Verification | |
| Mail | Contact autocomplete in compose | iCloud/Google/Outlook | Typing in To/Cc/Bcc shows filtered contact dropdown from personal contacts | Must | Implemented | 2026-07-02: self-contained in ComposeModal.tsx, multi-recipient support, keyboard nav |
| Calendar | Week/day/agenda views | iCloud/Google/Outlook calendars | Month + Week + Day functional, Agenda/Year remain | Must | Partial | 2026-07-02: DayView added with hour-slotted layout, all-day events, current time indicator |
| Calendar | Contact autocomplete in guests | iCloud/Google/Outlook | Typing in event guest field shows filtered contact dropdown | Should | Implemented | 2026-07-02: EventModal.tsx, same pattern as compose autocomplete |
| Mail | Calendar invite rendering | iCloud/Gmail/Outlook | Inline event card with date/location/organizer and Add to Calendar button | Must | Implemented | 2026-07-02: backend ICS extraction, CalendarInviteCard component |
| Suite | API error surfacing | Gmail/Outlook error banners | User-facing ErrorBanner with Retry across Calendar, Contacts, Notes | Must | Implemented | 2026-07-02: calendarError, contactsError, notesError states |
| Suite | Contact Email→in-app compose | iCloud/Gmail/Outlook | Clicking Email on a contact opens compose modal, not system mailto: | Should | Implemented | 2026-07-02: CustomEvent + sessionStorage bridge |
| Suite | Admin on mobile | All productivity apps | Admin panel accessible from mobile tab bar | Should | Implemented | 2026-07-02: ShieldAlert icon + label in mobile nav |
| Settings | Password change UX | All productivity apps | Inline success feedback without alert() or page reload | Should | Implemented | 2026-07-02: removed alert+reload, inline pwSuccess banner |
| Sync | Copy-to-clipboard | iCloud-style setup | One-click copy for server addresses, protocol icons, refined layout | Should | Implemented | 2026-07-02: SyncRow component with copy state |
| Suite | Glass-styled dialogs | iCloud/Google/Microsoft | Custom ConfirmDialog replacing browser alert()/confirm() | Should | Implemented | 2026-07-02: compose close, contact delete, session revoke |
| Notes | Relative timestamps | Apple Notes / Google Keep | 'Just now', '5m ago', 'Yesterday' on note cards | Should | Implemented | 2026-07-02: formatRelativeTime helper + card footer |
| Suite | Toast notifications | iCloud/Google/Microsoft | Transient glass-styled toasts for success/error/info feedback | Should | Implemented | 2026-07-02: ToastProvider context + useToast hook |
| Calendar | Week/day/agenda views | iCloud/Google/Outlook calendars | Functional views or hide incomplete options | Must | Partial | Current report says only Month implemented |
| Calendar | Appointment scheduling | Google Calendar booking pages | Self-hosted booking page per user/calendar | Could | Not Started | Requires public availability rules |
| Calendar | Shared calendars | iCloud/Outlook/Google | Share read/edit permissions, ICS public links | Should | Needs Verification | |
| Contacts | Lists/groups | iCloud Contacts / Outlook People | Labels + groups with inline creation + click-to-filter | Should | Implemented | 2026-07-02: inline creation + label filtering via useMemo |
| Contacts | Contact search | iCloud/Outlook/Google Contacts | Fast search by name/email/company/phone | Must | Needs Verification | |
| Contacts | Birthday calendar | iCloud/Google-style integration | Contact birthdays appear in Calendar | Should | Needs Verification | |
| Notes | Checklists | Apple Notes / Google Keep | Checklist blocks in note editor | Should | Needs Verification | |
| Notes | Labels/tags | Google Keep | Tags/labels and filtered views | Should | Needs Verification | |
| Notes | Tables | Apple Notes | Simple tables in rich editor | Could | Not Started | |
| Suite | Unified search | Google/Microsoft-style productivity search | Search mail, contacts, events, notes from one box | Could | Not Started | High value, larger effort |
| Suite | Command palette | Modern productivity apps | Create mail/event/contact/note from keyboard | Could | Not Started | |
| Sync | Device sync status | iCloud-style confidence | Show last sync, connected protocols, errors | Must | Needs Verification | |
