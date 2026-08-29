# Outlook Calendar Interaction Parity Baseline

Status: `Current first-party research baseline; Calendar management and the bounded meeting-communication tranche are guarded-deployed and live-verified`

Research date: 2026-08-29

Scope: Outlook on the web and the closely related new Outlook Calendar
interactions shown in the owner's supplied screenshots: calendar-list management,
empty-grid and event context menus, and the Personal Bookings entry point.

## 1. Product decision

OpenMailStack should adopt the useful interaction grammar, not copy Outlook's
pixels or Microsoft-only product wiring:

- calendar actions belong beside the calendar they affect and in its context
  menu;
- right-click is a fast path, never the only path—every command must also be
  reachable from a visible overflow button and by keyboard/touch;
- commands must be ownership- and event-aware, so users are not offered a
  destructive action they cannot complete;
- calendar visibility is reversible and must never be confused with deletion;
- destructive actions require a clear target, protected-primary-calendar
  behavior, recurrence scope where applicable, and visible success or failure;
- Microsoft Teams, OneNote, and Bookings names should become provider-neutral
  OpenMailStack actions backed by real OMS capabilities.

This is a functional-familiarity target, not a blanket parity claim.

### Evidence language

- **Documented** means the behavior appears in a current first-party Microsoft
  Support or Microsoft Learn page reviewed on the research date.
- **Screenshot-observed** means the supplied current Outlook screenshots show
  the command, but the reviewed first-party page does not establish that exact
  menu placement or availability across account types and rollout rings.
- **OMS recommendation** is a portable product decision; it is not a claim
  about Outlook.
- Microsoft documentation sometimes groups new Outlook and Outlook on the web,
  but this note does not silently transfer a desktop-only instruction to web.

## 2. Calendar navigation and management

| Capability | Current Microsoft evidence | Evidence boundary | OMS contract |
|---|---|---|---|
| Add calendar | Outlook on the web documents `Add calendar` flows for a blank calendar, personal calendar connection, a person/group/resource calendar, `.ics` upload or web subscription, holidays, and birthdays. A blank calendar has a name, color/charm, and optional group. [C1][C2] | **Documented.** Available sources and account types vary by tenant, region, and policy. | Ship a prominent `Add calendar` entry with create-blank, validated one-time `.ics` import, and credential-free HTTPS web subscriptions backed by OMS persistence. Defer directory/resource and personal-account connections until their identity and permission models are real. |
| Show or hide calendars | A checkbox beside each calendar adds or removes it from the current view without deleting it. Multiple selected calendars can be merged or split. [C3] | **Documented.** | Keep a per-calendar checkbox. Visibility is local view state and must not mutate or delete calendar data. |
| Show only / Show all | Microsoft documents `show only that calendar` for an added calendar and arbitrary multi-calendar selection. [C3] The supplied UI shows a `Show all` affordance. | `Show only` is **documented**; the exact `Show all` label and placement are **screenshot-observed**. | Provide `Show only this calendar` per row and an explicit `Show all calendars` batch action. Preserve the prior selection so `Restore selected calendars` can undo show-only without guesswork. |
| Rename and delete | The More Options menu for an owned calendar can rename or delete it. Microsoft's wider Outlook delete guide says the primary calendar cannot be deleted; opened/shared calendars are removed rather than deleting their source. [C3][C4] | Owned-versus-added behavior is **documented**. Primary-calendar protection is documented for new Outlook and classic Outlook; the reviewed OWA multi-calendar page does not spell out that exception. | Allow rename for owned calendars. Allow delete only for an owned non-primary calendar, with confirmation that names the calendar. For shared/subscribed calendars use `Remove from my calendars`, never `Delete`. |
| Color and charm | Owned calendars can change color and charm; added calendars can change color. [C1][C3] | **Documented.** Charm is an Outlook visual convention, not a portability requirement. | Ship persisted color for owned calendars now. Add per-user color overrides for shared/subscribed calendars only after OMS has a real recipient-scoped preference model. Treat an optional generic icon as later polish; do not copy Outlook charm artwork. |
| Sharing and permissions | Outlook documents busy-only, titles-and-locations, all-details, edit, and delegate access; delegates can schedule and respond on the owner's behalf. Outside-organization access is narrower, and private-event visibility is separately controlled. [C5] | **Documented**, with account and tenant-policy limits. | Expose sharing only when server-side authorization and revocation are enforced. Name permission levels by what recipients can actually do, and keep delegate/private-event scope explicit. |
| Calendar groups | Outlook on the web documents creating a group, renaming/deleting user-created groups, and moving calendars between groups. Default groups cannot necessarily be renamed or deleted. [C3] | **Documented.** | Later: add group CRUD and `Move to` after OMS persists group identity/order. Never make a cosmetic frontend-only group that disappears on another device. |
| Reorder / arrange by name | The screenshots show `Arrange by name`, `Move up`, and `Move down`. The reviewed current Outlook-on-the-web management page documents group movement but not those exact ordering commands. [C3] | **Screenshot-observed**, not established in the reviewed current web documentation. | Later: persist a stable per-user order and offer drag, Move up/down, and alphabetical reset together. Do not ship controls that only reorder one render. |

### Recommended calendar-row command rules

| Calendar kind | Commands |
|---|---|
| Owned primary | Show/hide, Show only, Color, Sharing and permissions, Rename only if the backend permits it; Delete unavailable with a reason. |
| Owned secondary | Show/hide, Show only, Rename, Color, Sharing and permissions, Delete. |
| Shared/subscribed | Show/hide, Show only, Remove from my calendars. Never label source removal as Delete. Per-user Color and Move to group remain later work. |
| Managed/system projection | Show/hide and Show only; only expose other commands that the backing projection can safely honor. |

## 3. Empty calendar grid

Microsoft's current Outlook-on-the-web scheduling guide starts an event by
selecting an open time. Older OWA guidance documents double-clicking an open
slot, while Outlook desktop documentation explicitly supports right-clicking a
time block to create an appointment. [E1][E2][E3] Outlook also documents a
Today control and keyboard command. [E4][E5]

The supplied current screenshot shows this exact empty-grid context menu:

1. `New event`
2. `Go to today`

That exact web menu is **screenshot-observed**, not established by the reviewed
current support pages. It is nevertheless a sound portable interaction.

### OMS empty-grid contract

- Right-click or keyboard Context Menu/`Shift+F10` on an empty date/time opens
  `New event` and `Go to today`.
- `New event` pre-fills the exact clicked date and, in timed views, the clicked
  time; month/all-day areas create an all-day draft for that date.
- The visible New event button, double-click/tap behavior, and keyboard creation
  path remain available.
- The menu is viewport-contained, closes on Escape/outside click/navigation,
  returns focus to the invoking slot, and never opens beneath an event.

## 4. Event context actions

The supplied event screenshot is broader than one portable event type. Outlook
shows different actions depending on whether the item is an owned appointment,
an organized meeting, an invitation, an online meeting, or a recurring item.
OMS should do the same instead of rendering one long menu full of dead commands.

| Action in supplied screenshot | Current Microsoft evidence | OMS recommendation |
|---|---|---|
| Join meeting / Copy meeting link | Teams is natively integrated into new Outlook/web scheduling and adds join details to sent invitations; Microsoft documents joining through the invite link. [M1][M2] The exact two context-menu commands are **screenshot-observed**. | Ship provider-neutral `Join meeting` and `Copy meeting link` only when the event has a validated `https:` conference URL. Do not require Teams. |
| Print | Outlook on the web documents calendar printing, date range, view, and detailed agenda. [M3] The exact event-row `Print` command is **screenshot-observed**. | Ship `Print event` with an event-focused print layout; keep whole-calendar Print separate. |
| Accept / Tentative / Decline | Outlook documents these response states, including delegate responses on the owner's behalf and the option to retain a declined meeting on the calendar. [M4][M17] The supplied screenshot establishes their event-menu placement. | **Shipped 2026-08-29.** For a real owned attendee identity, OMS atomically persists the series `PARTSTAT` and reserves an RFC 5546 `REPLY`. The current response is visible, and ambiguous or duplicate delivery is blocked behind exact recovery. Decline does not silently delete the stored event. [I2] |
| Propose new time | Microsoft documents this for new Outlook work/school accounts, not personal/IMAP/POP accounts; recurring meetings and organizer-disabled proposals are excluded. [M5] The exact web context-menu placement is **screenshot-observed**. | **Shipped with the same bounds.** OMS emits an RFC 5546 `COUNTER` for a non-recurring attendee invitation without moving the stored event. Recurring meetings and organizer-disabled proposals remain unavailable. [I2] |
| Reply / Reply all / Forward | Microsoft documents reply/reply-all as actions that can remain available even when meeting forwarding is blocked, and documents forwarding an existing meeting request. [M6][M7] Exact context-menu placement is **screenshot-observed**. | **Shipped 2026-08-29.** All three use normal OMS Compose. Reply targets the organizer; Reply all excludes the current owned identity and fails closed when the attendee projection is truncated; Forward attaches the original `.ics` and honors recognized forwarding restrictions. The exact Calendar alias remains visible and Send/Schedule stay disabled until that sender is authorized. |
| Charm | Microsoft documents charms for calendars. [C1][C3] Event-level charm in this menu is **screenshot-observed**. | Later optional generic event icon; not core calendar confidence. |
| Send to OneNote | `Send to OneNote` is a Microsoft cloud add-in available in Outlook for the web/new Outlook; it saves an opened mail or meeting item to a selected OneNote section. [M8] | Microsoft-only. Do not present it without OneNote. A later OMS-native `Save to Notes` can preserve source title, date/time, stable backlink, and chosen attachments. |
| Show as | New Outlook documents right-clicking a calendar item and selecting Free/Busy/Out of Office-style availability. [M9] | Ship when the event model round-trips availability. Use the values OMS actually supports and update free/busy immediately. |
| Categorize | New Outlook and Outlook on the web document right-click `Categorize`; categories are private to the user, and a single recurrence instance cannot be categorized independently. [M10] | Ship only with persisted per-user categories and explicit recurrence-series behavior. Do not equate the calendar's display color with an event category. |
| Private | Outlook documents private events and warns that delegates with private-item permission can still see details. [M11][C5] Exact context-menu placement is **screenshot-observed**. | Ship only if every sharing/read path enforces private-detail redaction. A lock icon without server enforcement is unsafe. |
| Duplicate event | Microsoft explicitly documents right-click `Duplicate event` in new Outlook. [M12][M13] | Ship now for owned/readable events. Generate a new UID, clear response state, preserve safe content, and open the copy as an unsaved draft. |
| Save as `.ics` | Microsoft documents interoperable iCalendar import/subscription, calendar publishing, and classic Outlook iCalendar export. [C2][M14] The exact single-event web command is **screenshot-observed**. | Ship `Download .ics` for any readable event with privacy-safe fields and a stable filename. This is portable and useful even without Outlook parity. |
| Delete / Cancel | Outlook on the web documents Delete for appointments, Cancel for organized meetings, and occurrence-versus-series scope for recurring items. New Outlook documents right-click Edit or Cancel. [M15][M16] | **Shipped with role-specific semantics.** Plain appointments retain local Delete. Owned organizers use Cancel-and-notify with RFC 5546 `CANCEL`; whole-series cancellation is supported, while one-occurrence cancellation is offered only when recurrence membership can be proved safely. Attendees use Decline/`REPLY`, not organizer cancellation. [I2] |

### OMS event-menu ordering

Keep the first menu bounded and contextual:

1. Open/Edit
2. Join meeting and Copy meeting link, only when present
3. Invitation response commands, only for attendees
4. Duplicate, Download `.ics`, and Print
5. Show as, Category, and Private, only when supported
6. Delete/Cancel/Decline with correct recurrence and notification semantics

Reply, Reply all, Forward, and new-time proposals now live in the contextual
meeting actions. Notes integration and other advanced actions remain deferred.

### Implemented invitation-delivery contract

- Meeting actions are projected from the stored iCalendar organizer and attendee
  records plus every authorized mailbox alias; an exception-only or otherwise
  ambiguous identity becomes view-only instead of inheriting unsafe series powers.
- RSVP, organizer cancellation, and new-time proposals reserve their frozen MIME,
  envelope, semantic fingerprint, and local Calendar mutation in one transaction.
  Same-key replay cannot resend. Pending, partial, failed, and uncertain outcomes
  remain visible in Calendar and use the same universal-outbox recovery contract.
- A retry reauthorizes the original sender and rechecks the exact Calendar state.
  Partial cancellation retries only rejected recipients. Uncertain delivery requires
  the user to verify non-delivery before a successor is allowed. Retry payloads are
  retained for seven days and then scrubbed; privacy-safe replay metadata remains.
- Recurrence identity preserves date-only, floating, UTC, `TZID`, custom-zone, DST,
  and exact `DURATION` semantics. One-occurrence cancellation is limited to simple
  validated daily/weekly rules with `FREQ`, optional `INTERVAL`, and one of `COUNT`
  or `UNTIL`. Monthly/yearly rules, selector-rich rules, `RANGE=THISANDFUTURE`,
  malformed/ambiguous recurrence state, and more than 256 exceptions fail closed.
- The event projection exposes at most 50 attendees and bounded display names. The
  full attendee count remains visible; Reply all is unavailable when the roster is
  truncated so hidden recipients can never be silently omitted.
- This implements the relevant iTIP methods defined by RFC 5546 while retaining the
  iCalendar recurrence/value rules from RFC 5545. [I1][I2]

## 5. `Go to my booking page`

Microsoft documents Personal Bookings as an Outlook-connected 1:1 scheduling
product. Users reach it through the Bookings app in Outlook/Teams or `book.ms`;
public meeting types appear on a personal page, private types can use single-use
links, and the page/link can be previewed, copied, emailed, or placed in an email
signature. Confirmed appointments are added to Outlook Calendar. [B1][B2]

The exact `Go to my booking page` Calendar-rail shortcut is
**screenshot-observed**. For OMS it should be a native Scheduler bridge:

- if the owner has a published Scheduler profile, open that public page in a
  new tab and provide a nearby copy-link action;
- if Scheduler is enabled but unpublished, open the owner Profile/Publish flow;
- if the account lacks Scheduler entitlement, hide the shortcut or explain why
  it is unavailable—never send the user to a dead page;
- do not call it Microsoft Bookings or depend on a Microsoft account.

## 6. Recommended OMS parity matrix

| Tranche | Capability | Minimum complete contract |
|---|---|---|
| **Ship now** | Calendar-list interaction surface | Right-click, visible ellipsis, keyboard, and touch reach the same ownership-aware menu; focus and viewport behavior are tested. |
| **Ship now** | Add/manage owned calendars | Create blank calendar; validated one-time `.ics` import; credential-free HTTPS web subscription; rename; color; delete owned secondary calendar with confirmation; protect the primary in both UI and the transactional API; use `Remove` for shared/subscribed calendars; truthful loading/error/success states. |
| **Ship now** | Calendar visibility | Per-row checkbox, Show only, Show all, and restore prior selection; no data mutation. |
| **Ship now** | Scheduler bridge | `Go to my booking page` opens the real OMS Scheduler public page when published, offers a nearby copy-link action, and routes unpublished owners directly to Profile/Publish. |
| **Ship now** | Empty-grid context | New event at exact date/time and Go to today, with equivalent visible/keyboard paths. |
| **Ship now** | Core event context | View/Edit according to calendar access, conditional generic Join/Copy for recognized conference links, Duplicate into an editable calendar with a new UID, Download `.ics`, event Print, appointment Delete, attendee RSVP, and organizer Cancel with safe recurrence scope. |
| **Ship now** | Meeting communication | Alias-aware RSVP/iTIP, bounded non-recurring Propose new time, Reply/Reply all/Forward through Compose, forwarding policy, atomic outbox reservation, exact replay, and visible delivery recovery. |
| **Ship now if already enforced end to end** | Sharing, Show as, Category, Private | Expose each only when its API/protocol/storage path is real and permission-safe; otherwise omit rather than ship a decorative control. |
| **Later** | Calendar groups and ordering | Persistent group CRUD, Move to, drag/Move up/down, alphabetical reset, and cross-session/device consistency. |
| **Later** | Additional calendar sources | Directory/resource lookup, shared-calendar discovery, personal-account connections, and policy-aware source limits. Web subscriptions are included now only through the bounded OMS HTTPS feed contract. |
| **Later** | Save to OMS Notes | Event-to-note capture with stable backlink and explicit attachment choices. |
| **Microsoft-only; do not copy** | Teams provisioning, OneNote add-in, Microsoft Bookings tenant/licensing behavior | Use generic conference URLs, OMS Notes, and OMS Scheduler instead. Preserve workflow value without presenting nonexistent Microsoft integrations. |

## 7. Release evidence required

This slice is not complete from labels or screenshots alone. Verify:

- owned primary, owned secondary, shared/subscribed, and managed calendars;
- zero, one, and many calendars, including long names and a scrollable list;
- month, week, and day empty-slot coordinates;
- appointment, organizer meeting, attendee invitation, online meeting, and
  recurring series/occurrence event menus;
- right-click, visible overflow, Context Menu/`Shift+F10`, Escape, focus return,
  touch, and mobile alternatives;
- permission failures, stale concurrent edits, delete confirmation, recurrence
  scope, and backend error recovery;
- desktop and mobile browser screenshots, focused regressions, complete relevant
  suites, deployed artifact equality, and protocol-safe release gates.

### 2026-08-29 meeting-communication evidence

Commit `7267b6a8` passes 998 backend tests (991 pass, seven optional skips),
252/252 frontend tests, lint/build, the exact-tree integration gate, desktop/mobile
fixture Chromium, forced Calendar-alias lookup failure/retry, and independent
Specification/Standards reviews with no findings. Guarded bridge and active releases
passed public IMAPS plus ActiveSync Mail/Ping/Contacts/Calendar pre/post gates with
exact synthetic cleanup; rollbacks are `protocol-guarded-webmail-20260829T224524Z`
and `protocol-guarded-webmail-20260829T225257Z`. Staging smoke, zero-restart active
services, Nginx, application journals, auth boundaries, exact live artifacts, and
public sign-in Chromium are clean. Fixture browser QA sent no real invitation;
physical Outlook/macOS/iOS consumption of the new iTIP messages remains a separate
gate.

## 8. First-party source register

- [C1] [Add a calendar in Outlook.com or Outlook on the web](https://support.microsoft.com/en-us/outlook/add-a-calendar-in-outlook-com-or-outlook-on-the-web)
- [C2] [Import or subscribe to a calendar in Outlook.com or Outlook on the web](https://support.microsoft.com/en-us/outlook/import-or-subscribe-to-a-calendar-in-outlook-com-or-outlook-on-the-web)
- [C3] [Working with multiple calendars in Outlook on the web](https://support.microsoft.com/en-us/outlook/working-with-multiple-calendars-in-outlook-on-the-web)
- [C4] [Delete a calendar in Outlook](https://support.microsoft.com/en-us/outlook/calendar/delete-a-calendar-in-outlook)
- [C5] [Share and access a calendar with edit or delegate permissions in Outlook](https://support.microsoft.com/en-us/outlook/sharing/share-and-access-a-calendar-with-edit-or-delegate-permissions-in-outlook)
- [E1] [Schedule an appointment or meeting in Outlook on the web](https://support.microsoft.com/en-us/outlook/officeweb/schedule-an-appointment-or-meeting)
- [E2] [Calendar in Outlook Web App](https://support.microsoft.com/en-us/outlook/calendar-in-outlook-web-app)
- [E3] [Create or schedule an appointment](https://support.microsoft.com/en-us/outlook/create-or-schedule-an-appointment)
- [E4] [Keyboard shortcuts for Outlook](https://support.microsoft.com/en-us/office/keyboard-shortcuts-for-outlook-3cdeb221-7ae5-4c1d-8c1d-9e63216c1efd)
- [E5] [Welcome to your Outlook calendar](https://support.microsoft.com/en-us/outlook/training/welcome-to-your-outlook-calendar)
- [M1] [Schedule a Microsoft Teams meeting from Outlook](https://support.microsoft.com/en-us/teams/meetings/schedule-a-microsoft-teams-meeting-from-outlook)
- [M2] [Join a meeting in Microsoft Teams](https://support.microsoft.com/en-us/office/get-started-with-meetings-909b75b4-5448-455c-9c9a-5115acf4d3d8)
- [M3] [Print messages, calendars, or other Outlook items](https://support.microsoft.com/en-us/outlook/getstarted/print-messages-calendars-or-other-outlook-items)
- [M4] [Manage someone else's calendar in Outlook on the web](https://support.microsoft.com/en-us/outlook/manage-someone-else-s-calendar-in-outlook-on-the-web)
- [M5] [Propose a new meeting time in Outlook](https://support.microsoft.com/en-us/outlook/calendar/propose-a-new-meeting-time-in-outlook)
- [M6] [Prevent forwarding of a meeting](https://support.microsoft.com/en-us/outlook/prevent-forwarding-of-a-meeting)
- [M7] [Schedule a meeting or event in Outlook](https://support.microsoft.com/en-us/outlook/calendar/schedule-a-meeting-or-event-in-outlook)
- [M8] [Send emails and meetings from Outlook to OneNote](https://support.microsoft.com/en-us/onenote/send-emails-and-meetings-from-outlook-to-onenote)
- [M9] [Add your out of office event to the Outlook calendar of others](https://support.microsoft.com/en-us/outlook/calendar/add-your-out-of-office-event-to-the-outlook-calendar-of-others)
- [M10] [Use categories in Outlook](https://support.microsoft.com/en-us/outlook/use-categories-in-outlook)
- [M11] [Create a private event in Outlook](https://support.microsoft.com/en-us/outlook/create-an-all-day-event)
- [M12] [New Outlook tips for executive admins and delegates](https://support.microsoft.com/en-us/office/new-outlook-tips-for-executive-admins-and-delegates-20fb5fab-b6e0-4736-bcd8-9b65db3a50d4)
- [M13] [Use shared family calendars in Outlook.com](https://support.microsoft.com/en-us/outlook/use-shared-family-calendars-in-outlook-com)
- [M14] [Create an Add to calendar link in an email message](https://support.microsoft.com/en-us/outlook/create-an-add-to-calendar-link-in-an-email-message)
- [M15] [Create, modify, or delete a meeting request or appointment in Outlook on the web](https://support.microsoft.com/en-us/outlook/create-modify-or-delete-a-meeting-request-or-appointment-in-outlook-on-the-web)
- [M16] [Change an appointment, meeting, or event in Outlook](https://support.microsoft.com/en-us/outlook/calendar/change-an-appointment-meeting-or-event-in-outlook)
- [M17] [Show a declined meeting on my calendar in Outlook](https://support.microsoft.com/en-us/outlook/calendar/show-a-declined-meeting-on-my-calendar-in-outlook)
- [B1] [Personal Bookings Frequently Asked Questions](https://learn.microsoft.com/en-us/microsoft-365/bookings/personal-bookings-faq?view=o365-worldwide)
- [B2] [Preview and share your personal booking page](https://learn.microsoft.com/en-us/microsoft-365/bookings/preview-share-personal-booking-page?view=o365-worldwide)
- [I1] [RFC 5545: Internet Calendaring and Scheduling Core Object Specification](https://www.rfc-editor.org/rfc/rfc5545.html)
- [I2] [RFC 5546: iCalendar Transport-Independent Interoperability Protocol](https://www.rfc-editor.org/rfc/rfc5546.html)
