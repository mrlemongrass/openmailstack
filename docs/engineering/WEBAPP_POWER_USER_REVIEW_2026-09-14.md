# WebApp power-user and quality-of-life review — 2026-09-14

## Outcome and scope

This review follows the editor release and the user's Junk/Trash, default-format,
post-action navigation and sender/domain-blocking reports. It examines Mail,
Settings, Calendar, Contacts, Notes and Scheduler. It is a workflow review, not a
claim of feature parity with any commercial service.

The central problem is inconsistent completion of workflows. The suite has many
advanced capabilities, but a visible control, saved preference, successful API
request and useful next screen do not always agree. Fixing these inconsistencies
should precede adding more independent controls.

Evidence labels below distinguish source inspection, synthetic browser checks of
the real frontend, automated regression tests and current primary documentation.
The browser used isolated API fixtures; it did not change user mail, rules,
contacts, notes, calendars or booking configuration. Competitor documentation was
checked on September 14. Outlook desktop, Outlook on the web and older OWA are
not treated as interchangeable products.

## Completed in this change

| Workflow | Before | Implemented behavior and proof |
| --- | --- | --- |
| Junk cleanup | No context-menu action for its contents | **Empty Junk…** counts the whole folder on the server and moves the confirmed messages to the server's special-use Trash. Browser confirmation tested with 1,201 messages; IMAP tests cover three batches. |
| Trash cleanup | No context-menu action for its contents | **Empty Trash…** requires an explicit permanent-deletion confirmation. Folder and subfolders survive. Snapshot UIDVALIDITY and maximum UID exclude later arrivals; UIDPLUS is required to avoid expunging unrelated messages. Cancellation sends no cleanup request. |
| Reading after actions | Successful deletion/spam could leave a nonexistent message URL and endless skeleton | Reading settings offer message list, previous message, or next message in visible order. Applies to successful removal actions, including row/bulk actions affecting the open message. Skips removed selections, scopes UIDs by folder, falls back to list at the boundary, and preserves unrelated routes. |
| Failed message loading | Body loading could remain indefinite | Missing list item has a route back to the list; a failed body fetch shows Retry message and Back to message list. |
| Format defaults | Server normalization forced `defaultMode` to plain, even when the UI saved rich | New-message and reply defaults independently support plain, rich and HTML source; invalid values fall back safely. Save/normalization round trips cover all nine combinations. |
| HTML source | No source editor | Source stays in a textarea and is sent/saved as HTML. Rich rendering sanitizes it. Switching to plain text requires confirmation; complex rich layouts retain the existing simplification guard. Browser verified HTML request content and retention after a simulated send rejection. |
| Reply consistency | Inline reply was always plain and the new-message preference was reused | Rich/HTML reply defaults open the full composer. Plain inline reply remains available for the plain preference. Full Reply/Reply all honors the reply preference even without a Message-ID. |
| User-marked Junk | Mark as spam only moved a message | A dialog offers **Block sender** (recommended) or **Block domain**. The backend reads sender addresses from the selected IMAP envelopes, not client-submitted sender text. It creates/updates one **User-marked Junk** Sieve rule ahead of ordinary folder rules. |
| Reversing a block | No equivalent reverse flow | **Not junk…** removes the selected sender entry and an exact domain entry covering it, then moves to Inbox. The confirmation explains that removing a domain block also unblocks other senders there. This is removal, not a blanket allow-list or security bypass. |
| Managing active blocks | Older saved sender preferences were not enforced | Spam & Senders now shows the active User-marked Junk list with sender/domain scope and Unblock actions. The same list is displayed when selecting its managed rule under Filters. Legacy saved lists remain explicitly labelled as unenforced. |
| Rule consistency | A new action could overwrite a concurrent rule edit | Rule writes use an owner-specific database lock. Ordinary rule saves preserve the latest managed Junk rule, avoiding stale settings-page overwrites. Tests cover concurrent sender/domain updates, other-user isolation and preservation of vacation data. |
| Failure honesty | Some viewer buttons displayed success before the action completed | Delete/archive feedback follows success. A failed Junk-rule save does not move the message; a move failure after saving the rule reports the partial outcome. Generic move Undo is not offered for Junk actions because it would not reverse the rule; use Not junk. |

Junk matching uses the exact parsed From address or exact domain, not a substring
of the display name and not a parent-domain/subdomain wildcard. Invalid or
ambiguous From addresses fail without adding a rule. These choices do not assert
that a domain is compromised. Existing incoming security checks and other rules
can still send unblocked mail to Junk.

## What already exists — keep and strengthen it

| Area | Current capabilities found | Evidence / limits |
| --- | --- | --- |
| Mail list and folders | Virtualized rows, incremental older-message loading, shift selection, per-message/context actions, folder nesting, favorites with identity reconciliation, mark-whole-folder-read, move/rename/delete safeguards | `mail/MessageList.tsx`, `FolderSidebar.tsx`, `hooks/useMail.ts`; fixtures and existing tests. Select all operates on loaded messages, not the entire matching mailbox. |
| Mail composition | Draft autosave/reopen/discard, resizable and expandable in-app editor, identities, Cc/Bcc, contacts suggestions, rich toolbar, signatures, templates, attachments, attachment reminder, scheduled send and protected retry/undo delivery handling | Current and preceding editor regressions/browser checks. Separate browser windows, multiple draft workspaces and inline-image/table authoring remain absent. |
| Search and rules | Field/scope search, saved searches, index status/recovery, rule analysis and duplicate cleanup, preview/run with scope snapshots and selection | `mail/hooks/useMail.ts`, Settings rule dialogs, backend rule engine. These features should not be described as missing. Ordinary list selection and full rule-run selection have different scope models. |
| Calendar | Multiple views, search, time zones, recurrence choices, reminders, invitations, subscriptions, visibility/sharing controls and guarded event editing | Calendar source/tests and populated calendar browser fixture. Physical-client sync and all recurrence-series edits were not revalidated in this UI pass. |
| Contacts | Virtualized list, search/sort/name display, favorites, groups/labels, duplicate scan/merge, CSV/vCard export/import paths and Trash | Contacts source and populated 30-contact browser fixture. Import/merge correctness was not independently re-executed in this pass. |
| Notes | Rich content, labels, pin/archive, reminders, attachments, explicit save state and synchronization conflict handling | Notes source and 12-note browser fixture. Notes navigation has keyboard gaps and deletion is permanent. |
| Scheduler | Availability/time-zone controls, booking types, private/unlisted links, guest rules, capacity/waitlist, recurring bookings, workflows and delivery tools | Scheduler source and fixture-based surface inspection. No real services or availability were invented or saved. |
| Settings/security | Grouped settings, acknowledged queued saves and retry, navigation guards, appearance/accessibility preferences, sync/device and account security controls | Current source and previous editor release tests. Grouped loading still couples unrelated services. |

## Prioritized follow-up backlog

P1 = trust/reliability or an important daily workflow. P2 = high-value productivity.
P3 = additional refinement. “Verified gap” means source or browser evidence;
“proposal” means a desirable improvement, not a claimed bug.

| Priority | Finding | Evidence | Acceptance criteria for the next task |
| --- | --- | --- | --- |
| P1 | Reading settings still promise behavior the mail layout does not apply consistently | `mail/routes.tsx` passes `isThreaded: false`; `MessageList.tsx` also fixes it false; `MailLayout.tsx` uses UID presence for the viewer and horizontal panes rather than the saved pane preference. Density comes from Appearance. Source-verified. | Trace every Reading setting from save through reload and layout. Implement each offered choice or remove/disable it with an explanation. Verify right/bottom/off, grouping and both density settings without conflicting controls. |
| P1 | Logout can invalidate the session before unsaved-state navigation protection runs | `shared/hooks/useAuth.ts`: POST logout, clear user, then assign location. Source-verified. | Check unsaved changes before ending the session; cancellation retains the session and fields. Cover Compose, Settings, Calendar, Contacts and Notes, including a failed save. |
| P1 | Legacy Blocked/Safe Senders lists are saved but not active incoming-mail policy | Explicit note in `settings/SettingsPanel.tsx`; new managed Junk list is separate. Source/browser-verified. | Unify into one clearly scoped policy UI. Offer a reviewable migration of legacy entries, define allow/block precedence, and test delivery. Do not silently enforce old entries or bypass malware checks. |
| P1 | One failed Settings dependency blocks unrelated sections | Eight operations in one `Promise.all` in `settings/routes.tsx`. Source-verified; fixture setup also exposed this coupling. | Independent section loading/retry. A rules or calendars outage must not block account format/appearance settings; pending saves survive retry. |
| P1 | Scheduler confirmations and error recovery are inconsistent | `scheduler/routes.tsx` event delete and several booking outcome/cancel handlers use native confirm and awaited mutations without local error handling; editor Cancel closes directly. Source-verified. | Consistent confirmation, pending lock, visible failure and retained input for every mutation. Add unsaved-state guards to event/profile/availability editing. |
| P1 | Recovery confidence needs a suite-wide acceptance matrix | This change and the previous editor change found failures after otherwise successful actions. | For every mutation test success, rejection, network uncertainty, duplicate click, navigation and refresh. Give each result one clear user-visible state. Include actual API persistence round trips, not just UI mocks. |
| P2 | Select all is limited to loaded messages; global search disables ambiguous selection | `MessageList.tsx` uses `mail.messages.map(uid)` and selected UID arrays. Source-verified. | Show loaded count and offer “Select all N matching messages” with server-side bounded scope, cancellation and recovery. Mixed-folder identity must remain folder+UID. |
| P2 | Junk actions lack full bulk-menu parity | Not junk is available in the viewer/context menu; the bulk toolbar still offers Mark as spam in Junk. Source-verified. | Offer Not junk for selections entirely in Junk, retaining one explicit unblock-scope confirmation and folder-scoped identities. |
| P2 | Keyboard coverage is much narrower than power-user expectations | `KeyboardHelp.tsx` lists viewer actions; there is no complete list/folder navigation model or configurable keymap. Source-verified. | Arrow/J/K navigation, selection extension, search/compose/folder shortcuts, clear help and opt-out. Shortcuts must not fire behind dialogs or while editing. |
| P2 | Notes sidebar controls are not keyboard reachable | Clickable `div.nav-item` in `notes/NotesSidebar.tsx`; populated browser inspection confirms nonfocusable elements. | Use native buttons/links, visible focus, selected state and keyboard access for every filter/label. Test mobile screen-reader navigation. |
| P2 | Notes has permanent deletion but no recoverable Trash workflow | `notes/NotesGrid.tsx` permanent-delete confirmation; no Trash in sidebar. Source-verified. | Recoverable trash, restore and explicit permanent delete with attachment/reminder consistency. Existing permanent-delete tests must remain intentional. |
| P2 | Composer cannot pop into an independent window or retain multiple minimized drafts | `ComposeModal.tsx` and single `isComposing` state. Source-verified. | Single-owner draft editing across windows, blocked-popup fallback, close/save/discard semantics and attachment retention; then minimized/multiple composer support. |
| P2 | Rich authoring lacks inline images and tables | Rich sanitizer/toolbar and complex-layout guard. Source-verified. | CID/image round trip, safe paste, resize/alt text, table preservation and explicit conversion. Do not silently strip unsupported content. |
| P2 | No everyday mailbox sort/filter bar comparable to power-user clients | Search field/scope and fixed message ordering exist; no user-facing sort model in list. Source-verified. | Sort direction, unread/flagged/attachment quick filters, selection retention and explicit scope. Integrate existing indexed search instead of building a competing model. |
| P2 | Faster repeat organization could use sender-based cleanup and rule creation | Existing rule editor and run dialog are powerful but multi-step. Proposal. | From a message: create a rule with a populated sender, preview scope/count, then apply to future mail and optionally existing matches. Keep sender/domain choice explicit. |
| P2 | Calendar/Contacts confirmation patterns vary | Native confirmations remain in ContactSidebar/ContactGrid/ContactsLayout; Calendar has dedicated dialogs. Source-verified. | Shared accessible confirmation, pending state, failure recovery and undo/restore where supported; preserve existing delete scopes. |
| P2 | Settings discoverability can improve without adding more tabs | Compose defaults sit under Identity & Compose; Reading behavior under Reading. Browser-verified. | Search settings by task (“format”, “after delete”, “block sender”); link contextual help/actions to the relevant section. |
| P2 | Mail import and switching confidence need a dedicated onboarding path | Proposal; no complete provider-migration workflow was verified here. | Inventory existing import/protocol tooling first; define a bounded mailbox import/resume/dedup workflow and explain what transfers. Avoid claiming migration parity until tested. |
| P3 | User-controlled trash/junk retention and cleanup schedules | Proposal; manual cleanup is implemented, automatic deletion is not. | Explicit opt-in, preview retention scope/count, cancellation, audit trail, and clear permanent-deletion semantics. Never enable automatically. |
| P3 | Unified action history and sync health would reduce uncertainty | Some mail/calendar delivery recovery already exists. Proposal. | A concise activity view showing completed/pending/failed user actions, scoped retry and useful per-app sync state without exposing message content or secrets. |
| P3 | Formal accessibility and performance stress pass | Current viewport checks are targeted, not a full audit. | Test long folders, 10k-message lists, large contacts/notes sets, zoom, reduced motion, high contrast, touch and physical screen readers. Record latency and focus behavior. |

Recommended order: finish Reading preference wiring and unsaved logout, then
unify sender policy and isolate Settings loads. Follow with whole-search
selection and the keyboard/navigation model. Separate-window Compose should
follow a clear ownership design because two simultaneous autosavers can corrupt
a draft even when both windows look correct.

## Commercial workflow baseline

These sources identify useful expectations, not a requirement to copy visual
styling or every feature.

- [Outlook on the web folder actions](https://support.microsoft.com/en-us/outlook/working-with-message-folders-in-outlook-on-the-web): folder context-menu cleanup, move and rule shortcuts. This supports the requested empty-folder workflow and the proposed sender cleanup shortcut.
- [Outlook desktop next/previous navigation](https://support.microsoft.com/en-us/outlook/go-to-the-next-or-previous-item-in-email): configurable behavior after deleting an open item and explicit message navigation. Desktop-specific controls are not claimed to exist in every web version.
- [Gmail message deletion and selection scope](https://support.google.com/mail/answer/7401?hl=en): distinguishes selecting a page from all conversations and provides a whole-Trash action. Our loaded-list selection remains a gap outside the new folder cleanup.
- [Gmail keyboard shortcuts](https://support.google.com/mail/answer/6594?hl=en): list navigation, selection and actions form a complete workflow, beyond isolated viewer shortcuts.
- [Proton composer](https://proton.me/support/composer) and [embedded images](https://proton.me/support/embedded-images): formatting and inline media are established composition expectations. Our new HTML-source option is an explicit product choice, not a claim that each competitor offers source editing.
- [Yahoo blocked addresses](https://help.yahoo.com/kb/SLN36701.html): a visible, reversible block list is an ordinary user expectation.

## Validation and limits

- Full frontend suite: 276 passed. Full backend suite after compatibility correction: 1,014 passed, seven skipped, no failures. Subsequent affected checks and release evidence are recorded in WORKLOG.
- New regressions: settings normalization/save reload, folder-scoped after-action routing, empty-folder IMAP safety and route confirmation, Junk rule/action concurrency/isolation/partial failure.
- Real Chromium frontend with isolated API fixtures: previous-message routing, boundary return to list, cancel-without-action, sender choice payload, Junk count/confirmation, Trash cancellation/mobile bounds, separate format defaults, rich reply, HTML send payload and retained body after rejection, Not junk routing, and failed-body Retry recovery; populated Contacts/Notes/Calendar/Scheduler inventory.
- `sieve-test` with a separate temporary Dovecot configuration and synthetic messages: matching domain files into Junk; a From display-name look-alike from another domain keeps Inbox. No `-e` execution and no user mailbox were used.
- Screenshot artifacts: `output/playwright/qol-*.png`. Synthetic fixtures are intentionally distinct from live credentials/data. Fixture shape mistakes and intentional API rejection/SSE errors are not counted as product failures.
- Browser engine: Chromium. Physical devices, other browsers, screen readers, full provider migration and every existing advanced workflow remain unverified in this pass.
- Legacy spam API calls without a scope retain move-only behavior; only an explicit sender/domain choice creates a lasting block. New Junk entries are enforced only when the managed rule is successfully compiled/saved/activated. Server security checks still apply. No blanket whitelist, global domain ban, automatic deletion policy or retrospective sweep of other messages is introduced.
- Large empty-folder operations run bounded UID batches. A connection interruption can leave partial progress; retry uses the same confirmed cutoff. New arrivals and subfolders are retained. Folder cleanup has no bulk Undo; Junk remains recoverable from Trash, while confirmed Trash deletion is permanent.

## Live release

Implementation commits `1e807a80` and `23eff51f` are pushed to `origin/main` and
live in active mode. Guarded bridge and active deployments passed public IMAPS
and ActiveSync Mail/Contacts/Calendar before and after installation; both
post-deploy Ping gates passed, with no cleanup warnings. Service/TLS/endpoint
smoke checks passed. All 56 frontend files and nine changed backend runtime files
match the build, as do the public index and five served assets.

The first bridge attempt exposed an older caller that omitted spam scope. The
guard restored the previous release and passed recovery validation. The
compatibility correction preserves move-only behavior for older callers and
requires an explicit choice to create a block in the new UI. The repeated full
backend suite and corrected bridge/active gates passed. Rollback snapshots and
remaining release limits are recorded in WORKLOG.md.

## P1 follow-up implemented — 2026-09-14

All six P1 findings above are addressed by the follow-up implementation. The
original rows are retained as the dated diagnosis. See
[P1 acceptance and evidence](P1_QOL_ACCEPTANCE_2026-09-14.md) for the implemented
behavior, mutation matrix, tests, and limits. Message right-click Create rule and
Add to existing rule are included, with exact-sender alternatives, stale-edit
protection and optional saved-rule preview. P2/P3 scope remains as listed.
