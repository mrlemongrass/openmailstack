# OpenMailStack Suite Experience
OpenMailStack is a full suite: Mail, Calendar, Contacts, Notes, Settings, Admin, Sync, and mobile. Do not optimize only the mail app unless there is a critical mail emergency.

OpenMailStack is not only a webmail client.

OpenMailStack is a self-hosted, open-source communication and productivity suite inspired by the best qualities of iCloud, Gmail/Google Workspace, and Microsoft 365/Outlook.

The goal is not to copy any proprietary product exactly. The goal is to match the level of care, integration, usefulness, polish, speed, and reliability users expect from first-class productivity suites.

## Product scope

OpenMailStack includes or is expected to include:

- Mail
- Calendar
- Contacts
- Notes
- Settings
- Admin
- Sync
- Mobile/responsive web experience
- Self-hosted deployment and operations

Agents must not treat Calendar, Contacts, Notes, Settings, Admin, or Sync as secondary afterthoughts.

## Product mission

Build OpenMailStack into a polished, fast, rich, self-hostable replacement for the everyday personal/work information suite people currently get from:

- iCloud Mail, Calendar, Contacts, Notes, and device sync
- Gmail, Google Calendar, Google Contacts, and Google Keep-style notes
- Outlook, Microsoft 365 Calendar, People/Contacts, and OneNote-style organization

OpenMailStack should feel:

- calm
- fast
- coherent
- integrated
- trustworthy
- responsive
- accessible
- powerful without being cluttered
- self-hostable without feeling rough
- polished enough for normal users
- capable enough for power users and organizations

## “Apple-esque” means

In this project, “Apple-esque” means:

- obvious default flows
- refined spacing, typography, and hierarchy
- restrained visual effects
- graceful animations and transitions
- strong empty/loading/error states
- minimal unnecessary friction
- sensible defaults
- consistent patterns across apps
- reliable sync and recovery
- features that feel integrated instead of bolted on

It does not mean:

- copying Apple UI pixel-for-pixel
- using proprietary Apple assets, trademarks, or icons
- sacrificing openness or self-hostability
- hiding advanced controls required by admins or power users

## Suite-level design principle

A feature is more valuable when it improves more than one app.

Prefer improvements that connect the suite:

- contact autocomplete in Mail compose
- contact birthdays in Calendar
- calendar invites rendered in Mail
- notes linked to contacts, events, or messages
- unified search across Mail, Calendar, Contacts, and Notes
- consistent command palette across the suite
- consistent keyboard shortcuts
- consistent empty/loading/error states
- consistent mobile navigation
- sync status visible across mail, calendar, contacts, and notes
- settings that affect the entire account, not one isolated screen

## Primary suite surfaces

Agents must consider all of these primary surfaces:

1. Mail inbox
2. Mail message list
3. Mail message viewer
4. Compose/reply/forward
5. Mail search
6. Folders/labels
7. Calendar month/week/day/agenda
8. Event create/edit
9. Calendar invites and RSVP
10. Contacts list/grid
11. Contact detail view
12. Contact groups/lists/labels
13. Notes list/grid
14. Note editor
15. Notes organization
16. Settings
17. Admin portal
18. Sync status and device integration
19. Mobile layout
20. First-run/account setup

A bland or incomplete Calendar, Contacts, or Notes experience is a product defect, not merely polish.

## Feature inspiration model

Agents may use iCloud, Gmail/Google Workspace, and Microsoft 365/Outlook as inspiration sources, but must translate features into OpenMailStack-native designs.

Do not copy proprietary UI, assets, or branding.

For each inspiration feature, ask:

1. What user problem does this solve?
2. Which OpenMailStack app does it belong to?
3. Does it connect multiple apps?
4. Can it be implemented with current architecture?
5. Is it self-hostable?
6. Is it privacy-respecting?
7. Does it require external services?
8. Can it be implemented as a bounded task?
9. How will it be tested?
10. How will the user know it works?

## Suite feature backlog categories

Use these categories when creating or updating UX/product backlog items.

### Mail

Examples of valuable mail features:

- unified inbox
- multi-account support
- send-as identities
- aliases
- scheduled send
- undo send
- snooze
- filters/rules
- labels/folders
- smart categories
- conversation threading
- search operators
- attachment previews
- drag-and-drop attachments
- templates/canned replies
- signatures
- keyboard shortcuts
- safe HTML rendering
- phishing/security warnings
- junk/quarantine visibility
- recoverable send failures
- draft autosave
- calendar invite rendering

### Calendar

Examples of valuable calendar features:

- month/week/day/agenda views
- fast event creation
- natural language quick event creation
- recurring events
- reminders
- color-coded calendars
- calendar sharing
- free/busy lookup
- invite guests
- RSVP handling
- ICS import/export
- appointment/booking pages
- birthdays from contacts
- attachments on events
- event notes
- meeting links
- timezone clarity
- mobile calendar layout

### Contacts

Examples of valuable contacts features:

- contact list/grid
- search
- contact detail cards
- contact groups/lists
- labels/categories
- favorites
- duplicate detection or merge flow
- import/export vCard/CSV
- contact autocomplete in compose
- contact autocomplete in calendar invites
- birthday/anniversary calendar integration
- organization/company fields
- notes on contacts
- safe delete and restore behavior
- CardDAV sync status

### Notes

Examples of valuable notes features:

- fast note creation
- notes list/grid
- folders
- tags/labels
- pinned notes
- checklists
- bulleted/numbered lists
- tables
- attachments/images
- links
- search
- archive
- note sharing/collaboration if supported
- link note to email/contact/event
- autosave
- offline/poor-network recovery
- import/export
- mobile-friendly editing
- keyboard shortcuts

### Settings

Examples of valuable settings features:

- account/profile settings
- identities and aliases
- signatures
- theme/appearance
- keyboard shortcut settings
- notification settings
- security/session management
- connected devices
- sync status
- mail rules/filters
- calendar defaults
- contacts import/export
- notes import/export
- admin-safe destructive action confirmations

### Admin

Examples of valuable admin features:

- domain management
- mailbox management
- alias management
- spam/quarantine management
- service health
- logs without leaking private data
- upgrade status
- DNS/domain verification
- DKIM/SPF/DMARC guidance
- backup/restore guidance
- audit log
- user role management

### Sync

Examples of valuable sync features:

- ActiveSync status
- CalDAV status
- CardDAV status
- IMAP/SMTP status
- device connection visibility
- last sync time
- sync error recovery
- conflict handling
- per-app sync diagnostics
- safe retry
- clear user-facing explanations

## Suite-level priority rule

After critical repo health is satisfied, agents should not keep selecting only mail/debug/build tasks.

At least one out of every three product cycles should improve a non-mail suite surface unless a higher-priority security, data-loss, auth, broken mail/sync, crash, or failing-build issue exists.

Non-mail surfaces include:

- Calendar
- Contacts
- Notes
- Settings
- Admin
- Sync
- Mobile suite navigation

## Surface rotation rule

When choosing product experience tasks, rotate attention across the suite.

Do not repeatedly work on Mail unless Mail has a critical issue.

Recommended rotation:

1. Mail
2. Calendar
3. Contacts
4. Notes
5. Settings/Admin/Sync
6. Mobile/cross-suite integration

If a previous cycle completed Mail work, the next product experience cycle should strongly consider Calendar, Contacts, Notes, Settings, Admin, Sync, or cross-suite integration.

## Cross-suite product opportunities

Prefer tasks that make OpenMailStack feel integrated.

Examples:

- Mail calendar invites create Calendar events
- Compose recipient autocomplete uses Contacts
- Contacts birthdays appear in Calendar
- Contact detail page shows recent messages
- Event detail links to related notes
- Note can link to a message, event, or contact
- Unified search finds mail, events, contacts, and notes
- Command palette can create mail, event, contact, or note
- Settings exposes sync status for mail/calendar/contacts/notes
- Mobile nav treats Mail, Calendar, Contacts, and Notes as equal apps

## Product proof requirement

For suite/product tasks, proof must include at least one of:

- screenshot
- browser verification notes
- Playwright or equivalent interaction test
- responsive viewport check
- accessibility check
- user workflow reproduction
- build/typecheck/test output
- before/after UX summary

A product task is not complete if the agent only changes code and never evaluates the user-visible result.

## UX audit requirement

Agents must use or create:

- `docs/engineering/UX_AUDIT.md`

UX audit entries should cover all suite surfaces, not only Mail.

Each entry should include:

- surface
- problem
- user impact
- severity
- reach
- suggested fix
- proof or evidence
- status

## Current suite expectation

OpenMailStack should eventually feel like one integrated product, not separate experimental apps living in the same sidebar.

The user should feel:

- “My mail, calendar, contacts, and notes all belong together.”
- “The app is fast and polished.”
- “The defaults make sense.”
- “I can recover if something goes wrong.”
- “This feels trustworthy enough to use every day.”
