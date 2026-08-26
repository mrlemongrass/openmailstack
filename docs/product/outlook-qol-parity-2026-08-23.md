# Outlook Quality-of-Life Migration Contract

Status: `Current first-party research baseline; Inbox Rules and core folder-tree QoL slices guarded-deployed`

Research date: 2026-08-23

Scope: Microsoft 365 Outlook on the web, new Outlook for Windows, classic Outlook
for Windows, Outlook People, Outlook/To Do/Sticky Notes integration, Scheduling
Poll, and Microsoft Bookings.

## 1. Product decision

OpenMailStack should preserve the interaction grammar that Outlook users rely on:
actions beside the object they affect, equivalent actions in context menus and
bulk toolbars, explicit selection and scope for bulk work, reversible operations
where possible, keyboard access, visible progress, and unambiguous completion.

This is a functional familiarity target, not a pixel-for-pixel copy. OMS should
not copy Microsoft artwork, wording, trademarks, or proprietary implementation.
Where web/new Outlook is simpler but classic Outlook has a valuable power-user
workflow, OMS should provide a coherent hybrid rather than reproduce either
client's limitation.

The feature priorities below are target contracts. They do **not** claim that a
capability is present or absent in the current OMS build. Each target needs a
source-and-browser audit before implementation status is assigned.

### Evidence language

- **Documented** means the behavior appears in a current first-party Microsoft
  Support or Microsoft Learn page reviewed on the research date.
- **Not established** means the reviewed Microsoft source does not document the
  behavior. It is not proof that no tenant, rollout ring, or client build has it.
- **OMS recommendation** is a product inference from the documented workflows,
  not a claim about Outlook.
- New Outlook for Windows and Outlook on the web often share interaction patterns,
  but this document keeps them separate whenever Microsoft does.

## 2. Inbox Rules: the first implementation slice

Microsoft's current rules guide explicitly separates new Outlook, classic
Outlook, Outlook on the web, and Outlook.com. The comparison below therefore does
not treat “Outlook” as one UI. [R1]

| Capability | Outlook on the web | New Outlook for Windows | Classic Outlook for Windows | OMS recommendation |
|---|---|---|---|---|
| Create and edit | Settings > Mail > Rules; each rule has a name, conditions, actions, optional exceptions, and `Stop processing more rules`. [R1][R2] | Same server-side rule model, with multiple conditions, actions, and exceptions. [R1] | Message shortcut plus Rules Wizard/templates. [R1] | Keep one calm editor with name, ordered conditions/actions/exceptions, validation, save/discard, and explicit stop-processing semantics. |
| Enable, disable, delete | Documented list controls include edit, delete, ordering, and enable/disable. [R1] | Row controls include edit, delete, ordering, and enable/disable. [R1] | A checkbox suspends a rule without deleting it; Rules & Alerts handles edits/deletes. [R1] | Make state visible in every row; deleting requires confirmation, disabling does not. |
| Run one rule now | **Not established** in Microsoft's current Outlook-on-the-web tab. [R1] | A `Run rule now` action appears beside the rule and processes existing messages. [R1] | The user checks one rule in `Run Rules Now`. [R1] | Put a run action on each row for the fastest single-rule path. |
| Run selected rules | **Not established** in the reviewed web instructions. [R1] | The reviewed instructions document one row's run action, not multi-selection. [R1] | `Run Rules Now` lets the user check one or more rules. [R1] | A `Run rules…` button opens a batch dialog with checkboxes, `Select all active`, and a selected count. |
| Run all | No explicit run-all control is documented. [R1] | No explicit run-all control is documented. [R1] | The user can check every desired rule, but Microsoft does not document a separate `Run all` command. [R1] | Offer `Run all active` as an OMS enhancement; label it plainly and never silently include disabled rules. |
| Folder and message scope | Manual-run scope is not documented in the reviewed web instructions. [R1] | The per-rule run instructions do not document a folder or read-state picker. [R1] | The batch dialog selects a folder, optionally includes subfolders, and filters all/read/unread messages. [R1] | Default to Inbox, allow another folder, `Include subfolders`, and All/Unread/Read. Show the scope in the final confirmation. |
| Ordering | Incoming rules run in displayed order; users move a rule up or down. `Stop processing more rules` prevents later matching rules from running. [R1][R2] | Same documented ordering and stop-processing controls. [R1][R2] | The Rules Wizard exposes stop-processing; the reviewed page does not specify the execution order of a manually selected batch. [R1][R2] | Execute selected rules in the visible saved order. Preview that order before a batch run and report when stop-processing suppresses later rules. |
| Server/client boundary | Only server-side rules are supported. [R3] | Only server-side rules are supported; migrated client-only rules can be incompatible. [R3] | Supports server-side and device-dependent client rules. [R3] | Implement portable server-side behavior. If a classic rule cannot map to OMS/Sieve, import it as disabled with a precise incompatibility reason. |
| Portability | No rule-file import/export is documented. [R4] | No rule-file import/export is documented. [R4] | Rules can be imported/exported as `.rwz`; the feature is classic-only. [R4] | Provide an OMS-native export/import format and a reviewed migration mapper; do not promise lossless `.rwz` support without a proven parser. |

### 2.1 Proposed OMS `Run rules` contract

This section is an **OMS recommendation**, combining new Outlook's low-friction
per-rule action with classic Outlook's explicit batch scope.

1. Every rule row has `Run now`, Edit, Enable/Disable, Move up/down, and Delete.
2. The page-level `Run rules…` action opens a dialog; it does not start work
   immediately.
3. The dialog supports rule checkboxes, `Select all active`, a selected count,
   folder selection, `Include subfolders`, and All/Unread/Read scope.
4. The confirmation summarizes rule count, folder scope, and visible execution
   order. It warns when selected actions permanently delete or externally forward.
5. A run uses a stable snapshot of the selected rule definitions. Edits made in
   another tab do not alter an in-progress job.
6. Progress is visible and can be dismissed without losing the job. Completion
   reports scanned, matched, moved, marked, deleted, skipped, and failed counts,
   with a per-rule breakdown that does not expose message bodies.
7. Partial failure is explicit and retry is bounded. Re-running a move rule must
   not keep moving messages that have already left the selected scope.
8. Keyboard and screen-reader users can select, reorder, run, cancel, and inspect
   results. The same operations remain available on touch through an overflow
   menu; right-click is an accelerator, never the only route.

### 2.2 Acceptance evidence for this slice

- Browser test: run one named rule against existing Inbox messages.
- Browser test: select two rules, change to another folder, include subfolders,
  restrict to unread mail, and verify the result summary.
- Ordering test: two matching rules with stop-processing enabled and disabled.
- Safety test: destructive actions display the correct confirmation and an API
  failure leaves the source messages and rule definitions in a truthful state.
- Stress test: many rules and a large folder preserve selection, scrolling,
  progress, and cancellation/retry behavior.
- Accessibility test: full operation by keyboard with named controls, focus return,
  status announcements, and no hover-only action.

### 2.3 OMS implementation status

The selective-run and message-scope slices are implemented. The page-level
`Run rules` action opens with every enabled saved rule selected, while a
row-local `Run now` action opens the same dialog with only that rule selected.
Disabled rules remain visible but cannot be selected. Users can choose any
selectable source folder, optionally include its selectable descendants, and
restrict the run to All, Unread, or Read messages. Selection and scope are
preserved through Preview, Apply, pagination, and bounded recovery.

The server validates the complete selection before mailbox mutation and binds
Apply to the full saved rule document, selected-rule snapshot, read state, and
a server-authored ordered snapshot of every folder's UID ceiling and
UIDVALIDITY. An initial client-authored scope snapshot is rejected. Apply
preflights every folder's UIDVALIDITY before its first mutation, and a changed
selection, rule document, folder scope, read state, or mailbox identity fails
closed. Legacy rules without IDs remain runnable, including documents with
duplicate names; their collision-safe positional selectors are invalidated by
any document reorder. Omitting `ruleIds` retains the previous all-enabled API
behavior. Folder discovery is capped at 500 and uses one LIST-STATUS command
rather than sequential STATUS round trips.

Release evidence includes 49 focused backend tests, six focused frontend tests,
the complete 838-test backend suite (831 pass and seven documented optional
skips), the complete 188-test frontend suite, lint/build, and the complete
repository integration gate. Desktop and 390 px browser checks cover a
top-level non-Inbox source, two descendants, Unread scope, two rules in saved
order, exact three-page Preview and Apply requests, totals, completion copy,
and horizontal-overflow guards. Backend regressions cover read-state IMAP
search, one-command scope metadata, nested ordering/stop-processing, all-folder
UIDVALIDITY preflight, revision binding, malformed and forged scope state, and
ambiguous child-folder copy recovery for both owner resolutions.

Commits `dcee1353` and `21b4bd8` were released through the required bridge then
active guarded path. Both stages passed public IMAPS and ActiveSync
Mail/Contacts/Calendar pre/post gates; both post-gates also passed Ping.
Rollbacks are
`/var/backups/openmailstack/protocol-guarded-webmail-20260824T192355Z` and
`/var/backups/openmailstack/protocol-guarded-webmail-20260824T193128Z`. The
active frontend and backend artifacts are byte-identical to the repository
build, local/public readiness and the protected rule-run route return the
expected unauthenticated `401`, Nginx validates, the warning journal is empty,
and the service has zero restarts. A fresh public browser loaded released
assets `index-DEtIDm_z.js` and `index-DaERTbNz.css`, repeated the three-folder
Preview/Apply flow with no overflow or fresh console/page errors, and used
mocked APIs so it did not read or mutate a real mailbox.

This closes the folder/subfolder and All/Unread/Read portion of the P0 contract,
but does **not** complete the full incoming-rule vocabulary. The existing-mail
runner supports Move actions; Reject and Discard remain delivery-time-only.
Broader existing-mail actions and their destructive confirmation/result
semantics are the next rules tranche and must not be represented as shipped.

### 2.4 OMS duplicate-hygiene contract

Large long-lived rules often accumulate repeated senders, subject phrases, or
filing actions. OMS treats cleanup as an explicit review workflow rather than
silently rewriting the saved Sieve document:

1. `Review duplicates` analyzes the rules currently in the editor, including
   unsaved changes, without reading the mailbox or opening ManageSieve.
2. Only later exact copies within the same rule are eligible for automatic
   cleanup. The first condition/action, rule order, item IDs, and all unrelated
   entries remain unchanged. Sieve's default ASCII case-insensitive comparison
   applies to condition values; whitespace, Unicode case variants, and mailbox
   path case are not normalized. [R5]
3. Repeated conditions across different rules and nested `contains` patterns
   within or across rules are advisory because rule order, ANY/ALL matching,
   enablement, and stop-processing can make them intentional.
4. Cleanup changes only the local draft, remains behind the ordinary Save
   action, and exposes Undo until another edit supersedes the cleanup.
5. Later exact copies are marked inline while editing. The review dialog has
   named loading, error, empty, safe-cleanup, and review-only states, restores
   focus, and remains operable on a 390 px viewport.
6. Analysis accepts at most 1,000 rules, 10,000 conditions/actions, 4,096
   characters per analyzed value, and 1,000,000 analyzed characters overall.
   Exact cleanup remains complete inside that boundary, while displayed
   occurrences plus advisory overlap count and character work are bounded and
   disclosed when truncated.

Release evidence includes seven focused backend tests, five
focused frontend tests, the complete 830-test backend suite (823 pass and seven
documented optional skips), the complete 187-test frontend suite, lint/build,
and the repository integration gate. Real Chromium covered desktop, 390 px
mobile, and a light-theme stress fixture with 180 rules, 540 conditions, 360
actions, and 360 rendered findings. Cleanup and Undo made zero Save requests;
the long dialog retained its action footer, had no horizontal overflow or
console errors/warnings, and the light-theme warning/success text measured
7.09:1 and 5.48:1 contrast against its surface.

Commit `5598534c` was released through the required bridge then active guarded
path. Both stages passed public IMAPS and ActiveSync Mail, Ping, Contacts, and
Calendar pre/post gates with exact canary cleanup. Rollbacks are
`/var/backups/openmailstack/protocol-guarded-webmail-20260824T170058Z` and
`/var/backups/openmailstack/protocol-guarded-webmail-20260824T170835Z`. Active
mode has zero service restarts, an empty warning journal, valid Nginx
configuration, expected local/public unauthenticated `401`, and repository/live
backend-content, version, and frontend artifact equality. A fresh public browser
loaded the released assets, rendered safe and review-only findings without
overflow or console errors, removed exactly two draft copies, and restored them
with Undo while making zero Save requests. Mocked API fixtures kept this visual
check isolated from real mailbox data.

This is configuration hygiene, not a delivery diagnostic. A message that
misses a filter still requires examination of the actual envelope/header/body
predicate and live Sieve execution evidence; duplicate rows alone do not imply
server-side fallthrough.

## 3. Outlook interaction contracts by surface

### 3.1 Mail

| Contract | Microsoft-documented behavior | Migration implication for OMS |
|---|---|---|
| Object-local actions | Message actions include Move, Archive, Sweep, Read/Unread, Categories, Pin, Flag, Snooze, and policies. Folder context actions include root folders/subfolders, rename, move, delete, favorites, empty, and mark-all-read, subject to default-folder restrictions. [M1][M2] | The toolbar, row context menu, reading pane, and bulk toolbar should use the same verbs and outcomes. Folder creation must be available at mailbox root and beneath valid folders. |
| Filing and triage | Categories can label multiple messages; Favorites surface folders and other frequently used views; Search Folders provide virtual views such as unread, flagged, important, categorized, large, old, or attachment mail, optionally scoped to folders/subfolders. [M3][M4][M5] | Users need fast organization without constructing a rule for every task. Category, favorite, filter, and saved-search state should be visible and directly actionable. |
| Inbox shape | Focused Inbox separates likely-important mail from Other and learns from interactions. Conversation view is configurable. [M6][M7] | Treat Focused/Other as later intelligence, but make conversation/list mode, density, sorting, filtering, and current scope obvious now. |
| Repeated workflows | Quick Steps combine multiple message actions, can be ordered, described, and assigned shortcuts; web/new and classic expose different depths. [M8] | A later OMS automation surface should compose existing safe message actions instead of inventing another rules engine. Always disclose irreversible steps because Microsoft notes Quick Steps may be non-undoable. |
| Personalization and keyboard | Outlook web can use Outlook, Gmail, or Yahoo shortcut schemes, show a shortcut reference, and supports mail/calendar/People navigation. Outlook.com also documents configurable message-list, reading, and compose actions. [M9][M10] | Provide a documented shortcut layer, visible focus, `Shift+?` help, and configurable common actions. Keep browser-reserved shortcuts honest. |
| Classic/new differences | Microsoft's current comparison marks Rules and Quick Steps as only partially available in new Outlook, while several web-style capabilities such as pin, snooze, Sweep, category favorites, and undo/schedule send favor new Outlook. [X1] | Do not use either client as an absolute ceiling. Prioritize the durable workflows that users miss when moving between them. |

#### 3.1.1 OMS folder-tree implementation status

The P0 folder tree now supports top-level and nested creation, Rename, Move,
recoverable Delete, account-persistent Favorites, and true folder-wide Mark all
as read. Ordinary Delete moves the complete folder subtree and its messages
beneath the server-advertised Trash mailbox, using a collision-safe suffix when
needed. A custom Trash leaf can be deleted permanently only through a separate
irreversible confirmation; Trash parents require leaf-by-leaf cleanup. The same
commands are reachable by native right click, keyboard context-menu gestures,
and a visible touch/overflow action; protected and special-use mailboxes expose
only their safe subset. Favorites and expanded state follow OMS Move, Rename,
and recoverable Delete, while permanent Delete removes the affected state.

Mark all as read is a bounded server mutation rather than an action against
only the currently loaded page. The server snapshots the selected mailbox's
UID ceiling, marks the exact unread UIDs in that snapshot, updates only those
search-index identities, and lets later arrivals remain unread. The client
serializes the action globally, exposes persistent row and accessible status,
reloads the authoritative folder/search view, and reports an acknowledged
mutation separately if that reload fails. Retry preserves an active search.

Recoverable deletion resolves source and Trash hierarchy contracts from IMAP
LIST, preserves subtree subscriptions, rejects delimiter-ambiguous cross-
namespace names before RENAME, and fails closed when Trash is unavailable or a
permanent delete lacks explicit server acknowledgement. Active rule and snooze
references still block a lifecycle mutation. Search cleanup is best-effort
after the acknowledged mailbox change; partial success is reported without
rolling back or exposing private server details, and search cleanup has an
explicit retry.

Commit `9a73f7101e814d8878499b88e4d6252486beefe3` passed all 861 backend tests
(854 pass and seven documented optional skips), all 201 frontend tests, lint,
both production builds, the complete integration gate, and exact-commit
Spec/Standards review with no findings. Guarded bridge and active releases both
passed public IMAPS plus ActiveSync Mail/Ping/Contacts/Calendar pre/post gates.
Rollbacks are
`/var/backups/openmailstack/protocol-guarded-webmail-20260825T231400Z` and
`/var/backups/openmailstack/protocol-guarded-webmail-20260825T232122Z`.

A dedicated live canary created and subscribed a three-level folder tree,
appended two messages, forced a Trash-name collision, moved the entire subtree
to the production dot-delimited Trash, restored it to the mailbox root, moved
it to Trash again, verified the permanent subtree guard, deleted only leaves,
and proved zero LIST residue. Released-asset Chromium at 1440x900 and 390x844
verified recoverable/permanent confirmation copy, protected-tree and Trash-
parent guards, post-mutation focus, partial-success retry, viewport fit, and
zero console errors or warnings.

Favorites now recover safely when Outlook or another IMAP client renames a
folder. OMS stores the folder's current IMAP generation with its Favorite
path. After an authoritative refresh, one matching generation produces a calm
`old name may have been renamed to new name` review with `Not now` and `Update
Favorite`; a missing folder can be explicitly removed. OMS never silently
accepts the guess, never treats an initial/failed folder load as deletion, and
leaves ambiguous matches unresolved. The same generation binding makes stale
Move, Rename, and Delete requests fail before they can mutate a newly reused
path.

This is deliberate recovery rather than cross-system atomicity. The deployed
IMAP surface does not expose a standards-based stable mailbox identifier, and
`UIDVALIDITY` alone is not globally unique. Automatic external-rename remapping
remains a later server-capability slice based on RFC 8474 `MAILBOXID` or an
equivalently proven server GUID.

Commit `81c16990108a530075007262af2f146b9961fe70` is guarded-deployed active.
Both bridge and active stages passed public IMAPS plus ActiveSync
Mail/Ping/Contacts/Calendar pre/post gates, and a zero-residue public-IMAPS
canary proved the live server preserves the generation across external rename.

#### 3.1.2 OMS message-action implementation status

The next P0 action-grammar slice adds Reply, Reply all, Forward, and Flag/Unflag
consistently across ordinary-message context menus, rows, the reading pane,
keyboard shortcuts, and bulk selection where the action is meaningful. Right
click remains an accelerator: visible row/reading/bulk controls and `R`, `A`,
`F`, and `S` shortcuts provide keyboard/touch alternatives. Draft and virtual
Scheduled rows retain their intentionally smaller safe menus.

All compose entry points share one recipient/threading contract. Reply honors
`Reply-To`; Reply all preserves display names, excludes the signed-in user's
configured identities, and de-duplicates recipients; reply thread headers
inherit the parent's chain and survive Draft save/resume, direct inline reply,
rich-editor handoff, and send. Newly authored textarea content submits as MIME
plain text so forwarded mailbox addresses and line breaks remain literal, while
resumed HTML-only Drafts retain their source format. Overlapping context actions
use latest-intent sequencing so a slow earlier body fetch cannot replace the
newer draft. User-facing Flag maps to IMAP `\Flagged` through the existing
internal `star`/`unstar` API. Failed optimistic changes roll back and explain the
failure, and the mobile reading toolbar wraps so no command is clipped at 390 px.

This is not full Outlook parity. Categories, Pin, Rules-from-message,
Sweep/Block/Ignore, Favorites ordering, folder color/empty commands, Search
Folders, attachment-preserving Forward, and richer RFC address parsing remain
separate bounded slices.

### 3.2 Calendar

| Contract | Microsoft-documented behavior | Migration implication for OMS |
|---|---|---|
| Event lifecycle | Users can create in-place or through New event; event versus meeting semantics are distinct. Recurring edits/cancellations offer occurrence, following events, or whole-series scope. [C1] | Keep quick-create fast, but require explicit recurrence scope and truthful Save versus Send/Cancel language. |
| Views and time context | New Outlook documents Day, Work Week, Week, and Month, configurable first day/work hours/location, and additional time zones. Classic retains some richer views that new Outlook does not yet have. [C2][C3] | Ship only views that work well, remember the user's view, and make timezone/work-hours context visible in create, edit, and scheduling flows. |
| Scheduling Assistant and rooms | Availability is shown per required/optional attendee; room discovery can filter by building, type, capacity, floor, and features. [C4] | A business-ready event editor needs a free/busy grid, required/optional distinction, suggested slots, and resource policy—not only guest autocomplete. |
| Sharing and delegation | Calendar owners can grant busy-only, titles/location, all-details, edit, or delegate access. Delegates can schedule/respond on the owner's behalf; private-event visibility is separate. [C5] | Model permissions explicitly, audit acting identity, distinguish primary versus secondary calendar limits, and make revocation immediate. |
| Scheduling Poll | Mail and Calendar can start a poll; invitees inside or outside the organization vote on proposed times, with holds and optional auto-scheduling. [C6][C7] | Add a poll when free/busy cannot resolve a meeting. It should share the Calendar attendee model and Scheduler's hold/idempotency machinery. |

### 3.3 People and Contacts

| Contract | Microsoft-documented behavior | Migration implication for OMS |
|---|---|---|
| Daily contact work | The People page supports create/view/edit/delete, search, sort, favorites, categories, contact lists, groups, and a detail pane. [P1][P2] | Keep list and detail context together, expose direct Email/Event actions, preserve selection after edits, and make bulk delete/import/export confirmable. |
| Personal plus directory identity | Organizational profiles can appear without being saved; saving adds private user data and links it to the directory identity. Address-book selection is available during recipient picking. [P1][P3] | Visually distinguish personal contacts, directory entries, and lists. Never overwrite admin-managed directory data with a user's private annotations. |
| Relationship context | Profile details can surface recent conversations/files, and favorite contacts can become Mail navigation shortcuts. [P1] | A contact should be an entry point into authorized mail/event history, not a dead record, while search results and activity remain tenant-safe. |
| Duplicate and migration trust | New/web Outlook automatically hides exact/subset duplicates; classic offers create-versus-merge choices. Microsoft documents CSV/vCard/PST-related import/export paths across clients. [P4][P5] | Prefer explicit duplicate review and reversible merge provenance. Hidden deduplication must not silently delete records or conflate people. |

### 3.4 Notes-adjacent work

| Contract | Microsoft-documented behavior | Migration implication for OMS |
|---|---|---|
| Lightweight notes | Outlook web/Outlook.com Sticky Notes supports create, autosaved edit, delete, color, formatting, pictures, and cross-device synchronization. Classic Outlook has a separate Notes module and global create shortcut; Microsoft's comparison calls new Outlook Notes partial. [N1][N2][X1] | Keep OMS Notes a first-class app, but make quick capture available without abandoning Mail or Calendar. Autosave state and delete recovery must be obvious. |
| Mail to task to calendar | My Day can remain open across Mail, Calendar, People, and Groups. Users can flag mail into To Do, drag a message to create a task, and drag work into a day plan. [N3][N4] | Add explicit Mail-to-task and task-to-calendar paths before attempting predictive assistance. Preserve a backlink to the source message. |
| Mail/event to durable note | `Send to OneNote` sends an email or meeting into a chosen notebook/section and preserves identifying context. [N5] | Provide `Save to Notes` from message and event menus, with source identity/backlink and attachment choices. This is an OMS inference from Microsoft's cross-app workflow. |

### 3.5 Booking and scheduling

| Contract | Microsoft-documented behavior | Migration implication for OMS |
|---|---|---|
| Personal booking page | Public/private 1:1 meeting types have name, description, duration, location, availability, buffers, lead-time limits, reminders, and shareable links; private types can use a single-use link. [B1][B2] | A user should publish a useful page quickly, preview it, share the whole page or one type, and see bookings immediately in the same calendar. |
| Shared booking page | Shared Bookings manages services, staff and roles, business hours, availability, branding, access control, custom/required questions, one-to-many capacity, multi-staff appointments, and reminders/follow-ups. [B3][B4][B5][B6][B7] | Treat team scheduling as a permissioned product surface, not a public-link variant of personal scheduling. Keep staff consent, tenant policy, audit, and concurrency visible. |
| Booker experience | Booking pages can localize displayed availability to the visitor's time zone, restrict access, avoid search indexing, request data-use consent, and send confirmations/reminders. [B3] | Test anonymous, authenticated, mobile, slow-network, reschedule, cancel, expired-link, DST, full-capacity, and double-booking races as primary flows. |

## 4. OMS implementation priority matrix

These are QoL parity tranches, not security-incident severity labels and not a
statement of current implementation status.

| Priority | Target | Minimum acceptance contract | Provenance |
|---|---|---|---|
| P0 | Rules run-selection and scope | Per-row run plus batch-selected run; folder/subfolder and read-state scope; deterministic order; stop-processing; progress and result counts. | Hybrid of new and classic Outlook; Section 2. |
| P0 | Mail action grammar | Consistent single/bulk/context actions for Move, Junk, Archive, Delete, Read, Flag, Category, Pin/Snooze where supported; touch/keyboard alternatives. | Web/new Outlook [M1]. |
| P0 | Complete folder tree | Create at mailbox root or as subfolder; rename/move/delete with protected defaults; Favorites and mark-all-read; confirmation and recoverable delete semantics. | Outlook web [M2]. |
| P0 | Calendar core confidence | Fast create, complete edit, explicit recurrence scope, attendee responses, Day/Work Week/Week/Month, remembered view, and timezone-correct rendering. | Web/new Outlook [C1][C2]. |
| P0 | Business meeting scheduling | Required/optional attendees, free/busy grid, suggested time, rooms/resources, and permissioned calendar sharing/delegation. | Outlook/Exchange [C4][C5]. |
| P0 | People core | Search/sort, rich create/edit/delete, favorites/categories, contact lists, directory distinction, recipient picker, and import/export with duplicate review. | Outlook People [P1][P2][P3][P4][P5]. |
| P0 | Personal Scheduler journey | Meeting-type create/edit/duplicate/delete, public/private and single-use links, preview/share, availability/buffers/lead time, confirmation/reminder, reschedule/cancel, and calendar consistency. | Personal Bookings [B1][B2]. |
| P0 | Interaction accessibility | Every right-click action is also discoverable by keyboard and touch; focus return, loading, failure, empty, confirmation, and success states are tested. | Outlook shortcut/action patterns [M9][M10]; OMS quality requirement. |
| P1 | Mail power organization | Quick Steps, Search Folders/saved views, category favorites, conversation preferences, customizable actions, and shortcut profiles. | Web/new/classic Outlook [M3][M4][M5][M7][M8][M9]. |
| P1 | Rule migration and diagnostics | OMS export/import, compatibility report for classic/server rules, disabled unsupported imports, per-rule last-run/result, and safe retry. | Classic/new boundary [R3][R4]; OMS recommendation. |
| P1 | Contact relationship workspace | Authorized recent conversations/events, stable profile cards, explicit duplicate review/merge, and reversible trash/restore. | Outlook People [P1][P4]. |
| P1 | My Day and task bridge | Flagged-mail tasks, message-to-task, source backlink, task lists/reminders/steps, and task-to-calendar time blocking. | Outlook/To Do [N3][N4]. |
| P1 | Notes capture bridge | Quick note from any app plus Save message/event to Notes with source context and attachment choice. | Sticky Notes and OneNote integration [N1][N5]; OMS recommendation. |
| P1 | Scheduling Poll | Proposed slots, internal free/busy, external voting, holds, organizer dashboard, expiry, manual/automatic finalize, and race-safe cleanup. | Outlook Scheduling Poll [C6][C7]. |
| P1 | Shared Scheduler | Services, staff/roles, group and multi-staff capacity, custom questions, branding/access policy, reminders/follow-ups, closures/time off, and audit. | Shared Bookings [B3][B4][B5][B6][B7]. |
| P2 | Adaptive inbox and visual rules | Focused/Other or an explainable privacy-respecting priority view; conditional formatting and richer saved views. | Outlook [M6][X1]. |
| P2 | Advanced workplace context | Multiple displayed time zones, work hours/location, richer resource filters, and organizational location policy. | Outlook Calendar [C2][C3][C4]. |
| P2 | Extensibility and advanced automation | Scoped add-in/action API, more Quick Step actions, workflow triggers, and administrator templates. | Outlook add-in/Quick Step model [M8][X1]. |
| P2 | Smart assistance | Suggested replies, thread summaries, and scheduling assistance only with explicit privacy, policy, provenance, and opt-out controls. | Microsoft documents these capabilities, but they are not prerequisites for dependable core workflows. [X1] |

## 5. Delivery rule

Implement one vertical slice at a time, starting with Inbox Rules. For each slice:

1. Audit the active OMS UI, API, backend behavior, mobile layout, and tests.
2. Record `Implemented`, `Partial`, `Absent`, or `Needs verification` against the
   acceptance contract; do not infer status from labels or dormant controls.
3. Prototype only when an interaction decision remains genuinely ambiguous.
4. Implement the smallest complete path, including loading, empty, failure,
   destructive confirmation, keyboard, touch, and long-list behavior.
5. Prove it in a real browser at desktop and mobile widths, add regression tests,
   then update the suite matrix and worklog.

Recheck Microsoft sources before each parity release. Microsoft's own April 2026
comparison still describes several new-Outlook capabilities as partial or
upcoming, so parity is a moving target rather than a one-time checklist. [X1]

## 6. First-party source register

### Rules and mail

- [R1] Manage rules across new, classic, web, and Outlook.com.
- [R2] Stop-processing semantics.
- [R3] Server-side versus client-side rule compatibility.
- [R4] Classic-only `.rwz` import/export.
- [M1] Archive, Sweep, Move, categories, pin, flag, snooze, and filters.
- [M2] Folder creation, subfolders, rename, move, delete, and Favorites.
- [M3] Categories.
- [M4] Favorites.
- [M5] Search Folders.
- [M6] Focused Inbox.
- [M7] Conversation/list organization.
- [M8] Quick Steps.
- [M9] Keyboard shortcuts and selectable shortcut schemes.
- [M10] Customizable message actions.
- [X1] Microsoft's current new-versus-classic Outlook feature comparison,
  last updated 2026-04-14.

### Calendar, People, Notes, and Bookings

- [C1] Outlook-on-the-web event and recurrence lifecycle.
- [C2] Calendar views and work-week settings.
- [C3] Work hours, work location, and additional time zones.
- [C4] Scheduling Assistant and Room Finder.
- [C5] Calendar sharing and delegation permissions.
- [C6] Scheduling Poll entry points.
- [C7] Scheduling Poll voting, holds, and finalization.
- [P1] Outlook-on-the-web People page.
- [P2] Contact sorting, favorites, and categories.
- [P3] Organizational address books and recipient selection.
- [P4] Duplicate contact behavior by Outlook client.
- [P5] Contact/calendar/mail import and export entry points.
- [N1] Sticky Notes in Outlook on the web.
- [N2] Notes in classic Outlook.
- [N3] To Do and My Day in Outlook.
- [N4] Drag a message to create a task.
- [N5] Send an Outlook message or meeting to OneNote.
- [B1] Personal Bookings meeting types.
- [B2] Personal Bookings page and link behavior.
- [B3] Shared booking-page controls.
- [B4] Shared services, staff assignment, capacity, and notifications.
- [B5] Custom and required booking questions.
- [B6] Bookings overview and personal/shared boundary.
- [B7] Shared Bookings staff roles and calendar-availability controls.

[r1]: https://support.microsoft.com/en-us/outlook/mail/manage-email-messages-by-using-rules-in-outlook
[r2]: https://support.microsoft.com/en-us/outlook/mail/stop-processing-more-rules-in-outlook
[r3]: https://support.microsoft.com/en-us/outlook/mail/edit-or-fix-a-broken-rule-in-outlook
[r4]: https://support.microsoft.com/en-us/outlook/mail/import-or-export-a-set-of-rules-in-classic-outlook
[r5]: https://www.rfc-editor.org/rfc/rfc5228.html
[m1]: https://support.microsoft.com/en-us/outlook/organize-your-inbox-with-archive-sweep-and-other-tools-in-outlook-on-the-web
[m2]: https://support.microsoft.com/en-us/outlook/working-with-message-folders-in-outlook-on-the-web
[m3]: https://support.microsoft.com/en-us/outlook/use-categories-in-outlook
[m4]: https://support.microsoft.com/en-us/outlook/mail/use-favorites-in-outlook
[m5]: https://support.microsoft.com/en-us/outlook/mail/use-search-folders-to-find-messages-or-other-outlook-items
[m6]: https://support.microsoft.com/en-us/outlook/mail/focused-inbox-for-outlook
[m7]: https://support.microsoft.com/en-us/outlook/training/organize-email-with-outlook-on-the-web
[m8]: https://support.microsoft.com/en-us/outlook/mail/automate-common-or-repetitive-tasks-with-quick-steps-in-outlook
[m9]: https://support.microsoft.com/en-us/office/keyboard-shortcuts-for-outlook-3cdeb221-7ae5-4c1d-8c1d-9e63216c1efd
[m10]: https://support.microsoft.com/en-us/outlook/customize-actions-on-your-messages-in-outlook-com
[x1]: https://support.microsoft.com/en-us/outlook/getstarted/feature-comparison-between-new-outlook-and-classic-outlook
[c1]: https://support.microsoft.com/en-us/outlook/create-modify-or-delete-a-meeting-request-or-appointment-in-outlook-on-the-web
[c2]: https://support.microsoft.com/en-us/outlook/calendar/change-how-you-view-your-outlook-calendar
[c3]: https://support.microsoft.com/en-us/outlook/notifications-and-settings/set-your-work-hours-and-location-in-outlook
[c4]: https://support.microsoft.com/en-us/outlook/use-the-scheduling-assistant-and-room-finder-for-meetings-in-outlook
[c5]: https://support.microsoft.com/en-us/outlook/sharing/share-and-access-a-calendar-with-edit-or-delegate-permissions-in-outlook
[c6]: https://support.microsoft.com/en-us/outlook/access-scheduling-poll
[c7]: https://support.microsoft.com/en-us/outlook/find-the-best-meeting-time-for-everyone-with-outlook-scheduling-poll
[p1]: https://support.microsoft.com/en-us/office/using-contacts-people-in-outlook-on-the-web-1e3438c7-26b2-420c-87de-3cea9d31b5cb
[p2]: https://support.microsoft.com/en-us/outlook/people/manage-contacts-in-outlook
[p3]: https://support.microsoft.com/en-us/outlook/open-and-use-all-contacts
[p4]: https://support.microsoft.com/en-us/outlook/people/manage-duplicate-contacts-in-outlook
[p5]: https://support.microsoft.com/en-us/outlook/import-and-export-outlook-email-contacts-and-calendar
[n1]: https://support.microsoft.com/en-us/windows/apps/stickynotes/create-edit-and-view-sticky-notes-in-outlook-com-or-outlook-on-the-web
[n2]: https://support.microsoft.com/en-us/outlook/create-a-note-in-classic-outlook-for-windows
[n3]: https://support.microsoft.com/en-us/outlook/calendar/manage-tasks-with-to-do-in-outlook
[n4]: https://support.microsoft.com/en-us/outlook/calendar/drag-a-message-to-create-a-task
[n5]: https://support.microsoft.com/en-us/onenote/send-emails-and-meetings-from-outlook-to-onenote
[b1]: https://learn.microsoft.com/en-us/microsoft-365/bookings/create-new-meeting-type?view=o365-worldwide
[b2]: https://learn.microsoft.com/en-us/microsoft-365/bookings/personal-bookings-faq?view=o365-worldwide
[b3]: https://learn.microsoft.com/en-us/microsoft-365/bookings/customize-booking-page?view=o365-worldwide
[b4]: https://learn.microsoft.com/en-us/microsoft-365/bookings/define-service-offerings?view=o365-worldwide
[b5]: https://learn.microsoft.com/en-us/microsoft-365/bookings/add-questions?view=o365-worldwide
[b6]: https://learn.microsoft.com/en-us/microsoft-365/bookings/bookings-overview?view=o365-worldwide
[b7]: https://learn.microsoft.com/en-us/microsoft-365/bookings/add-staff?view=o365-worldwide
