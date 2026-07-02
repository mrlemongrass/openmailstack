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
| Calendar | Week/day/agenda views | iCloud/Google/Outlook calendars | Functional views or hide incomplete options | Must | Partial | Current report says only Month implemented |
| Calendar | Appointment scheduling | Google Calendar booking pages | Self-hosted booking page per user/calendar | Could | Not Started | Requires public availability rules |
| Calendar | Shared calendars | iCloud/Outlook/Google | Share read/edit permissions, ICS public links | Should | Needs Verification | |
| Contacts | Lists/groups | iCloud Contacts / Outlook People | Contact lists/groups usable in compose and invites | Should | Needs Verification | |
| Contacts | Contact search | iCloud/Outlook/Google Contacts | Fast search by name/email/company/phone | Must | Needs Verification | |
| Contacts | Birthday calendar | iCloud/Google-style integration | Contact birthdays appear in Calendar | Should | Needs Verification | |
| Notes | Checklists | Apple Notes / Google Keep | Checklist blocks in note editor | Should | Needs Verification | |
| Notes | Labels/tags | Google Keep | Tags/labels and filtered views | Should | Needs Verification | |
| Notes | Tables | Apple Notes | Simple tables in rich editor | Could | Not Started | |
| Suite | Unified search | Google/Microsoft-style productivity search | Search mail, contacts, events, notes from one box | Could | Not Started | High value, larger effort |
| Suite | Command palette | Modern productivity apps | Create mail/event/contact/note from keyboard | Could | Not Started | |
| Sync | Device sync status | iCloud-style confidence | Show last sync, connected protocols, errors | Must | Needs Verification | |
