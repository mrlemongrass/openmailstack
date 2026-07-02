# OpenMailStack Product Experience

OpenMailStack is not only a mail server stack. It is intended to become a polished, fast, rich, self-hostable webmail product comparable in ambition to iCloud Mail, Gmail, and Office 365 Outlook Web.

The goal is not to copy any proprietary product exactly. The goal is to match the level of care: clarity, speed, polish, reliability, consistency, accessibility, and “it just works” behavior.

## Product personality

OpenMailStack should feel:

- calm
- fast
- refined
- spacious without being wasteful
- powerful without feeling cluttered
- trustworthy
- predictable
- modern
- responsive
- accessible
- self-hostable but not “sysadmin ugly”
- professional enough for businesses
- simple enough for normal users

## “Apple-esque” means

In this project, “Apple-esque” means:

- obvious default flows
- polished spacing, alignment, and typography
- restrained visual effects
- smooth state transitions
- clear hierarchy
- elegant empty states
- high-quality loading states
- forgiving error states
- minimal unnecessary configuration
- features that feel integrated, not bolted on
- sensible defaults
- responsive layouts that feel designed, not merely squeezed

It does not mean:

- copying Apple UI pixel-for-pixel
- using Apple trademarks, icons, or proprietary designs
- sacrificing self-hostability
- hiding advanced controls users need

## Primary product surfaces

The highest-priority product surfaces are:

1. Mail inbox and message list
2. Message reading/thread view
3. Compose/reply/forward flow
4. Account setup and login/session recovery
5. Search
6. Folders/labels/navigation
7. Attachments
8. Settings
9. Calendar
10. Contacts
11. Admin portal
12. Mobile layout

A bland or confusing primary product surface is a serious product issue, even if the code technically works.

## Premium webmail expectations

### Mail shell

The mail shell should have:

- a coherent three-pane desktop layout
- a graceful single-pane mobile layout
- clear account/folder navigation
- readable message rows
- visible but not noisy bulk actions
- clear unread/read/starred/flagged states
- fast transitions between messages
- useful loading skeletons
- useful empty states
- useful offline/error states
- keyboard-friendly navigation

### Message list

The message list should feel dense but readable.

It should clearly show:

- sender
- subject
- preview
- date/time
- unread state
- attachments
- flags/stars
- selected state
- hover/focus actions
- thread/conversation hints where applicable

Large lists must remain responsive.

### Message viewer

The message viewer should make reading comfortable.

It should include:

- clear sender identity
- recipients/details disclosure
- date/time
- reply/reply-all/forward actions
- attachments
- safe HTML rendering
- readable plain text fallback
- graceful missing/failed content states
- print/readability support where applicable

### Compose

Compose is a core product experience and should feel excellent.

It should support or clearly prepare for:

- reliable draft autosave
- visible sending state
- failed-send recovery
- send-as identity/alias selection
- attachments with progress/error states
- keyboard shortcuts
- reply context
- formatting controls if implemented
- clear primary action
- unsaved-change protection
- mobile usability

### Calendar

Calendar should feel integrated, not separate.

It should have:

- clear month/week/day/agenda navigation if supported
- useful empty states
- fast event creation
- clear event editing
- RSVP/calendar invite handling where implemented
- responsive layout
- graceful loading/error states

### Contacts

Contacts should support:

- readable contact list/grid
- search
- clear contact detail view
- useful empty states
- contact autocomplete integration with compose
- CardDAV status only if implemented or explicitly planned

### Settings

Settings should feel calm and trustworthy.

It should have:

- clear sections
- plain-language labels
- safe defaults
- confirmation for destructive actions
- immediate feedback after save
- clear error handling
- account/security/session visibility where applicable

## Visual design quality bar

UI changes should improve at least one of:

- hierarchy
- spacing
- typography
- contrast
- responsiveness
- discoverability
- interaction feedback
- loading state
- empty state
- error recovery
- keyboard accessibility
- screen reader accessibility
- perceived performance
- product coherence

Avoid random decoration. Visual polish must support usability.

## UX proof requirement

For UI/UX tasks, proof should include at least one of:

- before/after screenshots
- browser verification notes
- Playwright or equivalent interaction test
- responsive viewport verification
- accessibility check
- build/typecheck
- component-level test
- clear manual reproduction steps

A UI/UX task is not complete if the agent only changed code without evaluating the user-visible result.

## Product experience backlog behavior

Agents must maintain a product-experience backlog when they find UX gaps.

Use or create:

- `docs/engineering/UX_AUDIT.md`

UX audit entries should include:

- affected surface
- problem
- user impact
- severity
- suggested fix
- proof or screenshot reference if available
- status: Open / In Progress / Done / Blocked

## Experience priority override

Once the repository is basically healthy — build passes, tests are not critically failing, and no obvious security/data-loss/auth/mail-sync emergency is present — the agent should prioritize product experience work.

In that state, bland, confusing, inconsistent, or unfinished core UI is not “polish.” It is a product defect.

At least one out of every three completed cycles should produce a user-visible product experience improvement unless blocked by a higher-priority issue.
