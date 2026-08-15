# OpenMailStack Suite Capability Benchmark

Status: `Cycle 1 research baseline`

Research date: 2026-08-15

Scope: Gmail/Google Workspace, Outlook/Microsoft 365, Yahoo Mail, Proton Mail, Fastmail, Apple iCloud Mail and Notes

## 1. Executive Decision

OpenMailStack is not an empty prototype. Current source contains a broad web suite, advanced indexed mail search and saved searches, scheduled and undo send, snooze, server-side mail rules, templates, Calendar free/busy plus sharing/import/export foundations, rich Contacts, Notes attachments/reminders/checklists/pinning, TOTP and app passwords, standards-based client sync, Scheduler booking workflows, and a substantial Admin/operations surface.

It is not yet a product that should be represented as enterprise-ready. The highest-risk gaps are:

1. **Notes correctness:** the reported edit-on-macOS duplicate is consistent with the known SQL/IMAP reconciliation seam. A note must have one durable identity and concurrent sync must be idempotent before any Notes feature expansion.
2. **Mail collaboration and conversations:** the UI exposes a conversation preference, but the current message list hard-codes `isThreaded={false}`. Delegated/shared mailboxes are also absent.
3. **Enterprise identity and governance:** OMS has TOTP, recovery codes, app passwords, sessions, and global Admin/Superadmin roles, but no passkeys/security keys, enforced MFA policy, domain-scoped RBAC, SAML/OIDC SSO, or SCIM lifecycle.
4. **Compliance and recovery:** operational audit and health telemetry exist, but retention policy, legal hold/eDiscovery, DLP, point-in-time recovery, and a routinely proven restore workflow are not product capabilities.
5. **Migration and offline continuity:** Contacts and Calendar have file-level import/export foundations, but no resumable mail/calendar/contact provider migration center. The web client has no service worker or offline data layer.

The honest target for five delivery cycles is a defensible paid-quality **small-business release candidate** plus enterprise foundations. Full Microsoft 365/Google Workspace compliance parity is a multi-release program, not a credible five-cycle promise.

## 2. Method And Status Language

- Vendor claims below use first-party product/help documentation reviewed on 2026-08-15.
- OMS status comes from current implementation source, not the older `SUITE_FEATURE_MATRIX.md`, which now understates several shipped features.
- `Implemented` means an end-user or administrator flow is wired through UI and backend. `Partial` includes a backend-only seam, incomplete scope, or an exposed setting that does not change the underlying behavior. `Absent` means no current implementing UI/service was found in the inspected active code roots; it is not a claim that a prototype cannot exist elsewhere.
- Comparator marks mean: `●` documented capability, `◐` narrower or conditional capability, `·` not established by the official documents reviewed. A dot is deliberately not an assertion of vendor absence.
- This is a source/research snapshot. It did not mutate live systems or production data.

## 3. Current OMS Baseline

### Implemented strengths

| Surface | Current evidence |
|---|---|
| Suite shell | Mail, Calendar, Contacts, Notes, Scheduler, Settings, Admin, and Sync routes in `webmail-frontend/src/App.tsx` |
| Mail | Compose/drafts/attachments, schedule and undo send, snooze, mute storage, templates, signatures, server-side rules, indexed body/attachment search, saved searches, cross-folder search, message actions, and calendar-invite rendering in `webmail-backend/src/api.ts`, `search-index.ts`, `scheduled-send.ts`, and `webmail-frontend/src/mail/` |
| Calendar | Month/week/day, recurrence and exceptions, guests, timezone-aware editing, free/busy, birthdays, CalDAV, ActiveSync, public booking through Scheduler, and backend sharing/ICS endpoints in `webmail-frontend/src/calendar/`, `webmail-backend/src/apps-api.ts`, `caldav.ts`, and `scheduler/` |
| Contacts | Rich fields, favorites, groups/labels, directory lookup, trash/restore, activity, vCard/CSV import/export, duplicate review/merge, CardDAV, and ActiveSync in `webmail-frontend/src/contacts/`, `webmail-backend/src/apps-api.ts`, and `carddav.ts` |
| Notes | Rich editing, code/checklist blocks, images/files, reminders, color/pin/archive, optimistic revision conflicts, ActiveSync Notes, IMAP projection, optional same-owner signaling, and stored label/folder/lock/delete metadata in `webmail-frontend/src/notes/`, `webmail-backend/src/notes-utils.ts`, `notes-imap-sync.ts`, and `notes-collaboration.ts` |
| Account security | TOTP, recovery codes, app passwords, password rotation, and session listing/revocation in `webmail-backend/src/api.ts` and `webmail-frontend/src/settings/AccountSecurityControls.tsx` |
| Admin/operations | Domains, mailboxes, aliases, routing, Admin/Superadmin, API keys, branding, updates, spam settings, audit log, Prometheus metrics, live logs, protocol health, Rspamd checks, and Fail2ban controls in `webmail-frontend/src/admin/` and `webmail-backend/src/api.ts` |
| Interoperability | IMAP/SMTP, CalDAV, CardDAV, ActiveSync mail/calendar/contacts/notes, Exchange autodiscover, and Mozilla autoconfiguration in `webmail-backend/src/` |

### Important partial or misleading seams

| Capability | Current finding | Consequence |
|---|---|---|
| Conversation view | A persisted `threaded` preference and `threadCount` types exist, but `MessageList.tsx` always passes `isThreaded={false}` and no conversation assembly consumes `Message-ID`, `In-Reply-To`, or `References`. | The setting promises behavior that is not implemented. |
| Forwarding and vacation responder | Settings controls are rendered, but the current save path does not persist or activate those controls. | These controls are misleading and must be wired or disabled before release. |
| Tasks | CRUD routes exist under `/api/apps/tasks`; there is no Tasks route, user UI, mail-to-task flow, or real task collection sync. | Backend scaffolding is not a shipped task product. |
| Notes collaboration | Optional signaling authorizes the signed-in note owner. No invitation, membership, per-note ACL, participant identity, or cross-account authorization model was found. | It is same-owner multi-tab/device collaboration, not shared Notes. |
| Contact sharing | The share route creates vCard content for an email handoff. It is not a shared/delegated address book. | Useful export, but not team Contacts parity. |
| Calendar scheduling | Guest free/busy exists. No room/resource directory, capacity/equipment policy, or suggestion engine was found. | Scheduling Assistant parity is incomplete. |
| Calendar sharing/import/export | Backend share and ICS endpoints/types exist, but no current frontend flow calls them. | Protocol/backend foundation exists; the user-facing capability is incomplete. |
| Notes organization/protection | Label/folder/lock fields and filters exist, but the editor cannot fully assign/manage them. “Locked” hides the card preview but does not enforce re-authentication or encrypt content. | Stored metadata must not be described as Apple Notes-style folders, tags, or protected notes. |
| Notes trash/recovery | Delete sets `is_deleted=1`, while normal listing excludes deleted rows and the UI Trash view looks for `folder === 'trash'` within that normal list. Delete also removes reminders and attachments immediately; no restore flow was found. | The UI says “moved to trash,” but the Trash view cannot recover the note or its deleted attachments. |
| Admin roles | Regular Admin and Superadmin exist, but the login path explicitly describes the Admin app as global-only until domain scoping exists. | Multi-domain delegated administration is unsafe to promise. |
| Migration | Contacts vCard/CSV and Calendar ICS foundations exist; provider migration remains a roadmap. Scheduler can import configuration, not a user's mailbox suite. | No guided, resumable tenant/user migration path. |
| Offline | No service worker, Workbox, IndexedDB mail cache, or web manifest registration was found in the active frontend. | A network interruption stops the web suite. |

## 4. Official Comparator Evidence

All links in this section were reviewed on **2026-08-15**.

### Gmail And Google Workspace

- Gmail documents [advanced search operators](https://support.google.com/mail/answer/7190?co=GENIE.Platform%3DDesktop&hl=en), [filters, labels, snooze, and inbox organization](https://support.google.com/mail/answer/9259770?hl=en-GB), [scheduled send](https://support.google.com/mail/answer/9214606), reusable [message templates](https://support.google.com/mail/answer/14864208?hl=en), [offline mail](https://support.google.com/mail/answer/1306849?hl=en), and [delegated inbox access](https://support.google.com/mail/answer/138350?hl=en).
- Calendar documents [permissioned sharing](https://support.google.com/calendar/answer/15716974?hl=en), [room and resource calendars](https://support.google.com/calendar/answer/44105), and [appointment schedules/booking pages](https://support.google.com/calendar/answer/11608416?hl=en).
- Workspace connects [Tasks with recurring work](https://support.google.com/tasks/answer/12132599?co=GENIE.Platform%3DDesktop&hl=en) and provides an organization [Directory with shared external contacts and scoped directories](https://support.google.com/a/answer/1628009?hl=en-BR).
- Enterprise controls include [custom Admin roles](https://support.google.com/a/answer/1219251?hl=en-uk), [SAML/OIDC SSO](https://support.google.com/a/answer/12032922?hl=en-rd), [Gmail DLP](https://support.google.com/a/answer/14767988?hl=en-AL&ref_topic=7556687), [Vault retention/hold/search/export](https://support.google.com/vault/answer/6127699?hl=en), and [audit/investigation activity rules](https://support.google.com/a/answer/9275024?hl=en-419).
- Migration is treated as an operated product with [supported data and sources](https://support.google.com/workspacemigrate/answer/9991155?hl=en) rather than a one-shot upload.
- Gemini can [summarize threads, draft/reply, search mail, consult Drive/Calendar, and create events](https://support.google.com/mail/answer/14355636); this is a useful Later benchmark, not a prerequisite for OMS correctness.

### Outlook And Microsoft 365

- Outlook documents [rules, categories, pin, snooze, Sweep, and archive](https://support.microsoft.com/en-us/outlook/organize-your-inbox-with-archive-sweep-and-other-tools-in-outlook-on-the-web), [scheduled send](https://support.microsoft.com/en-us/outlook/schedule-send-for-outlook-on-the-web), reusable [message templates](https://support.microsoft.com/en-gb/office/create-an-email-message-template-43ec7142-4dd0-4351-8727-bd0977b6b2d1), and [shared mailbox settings](https://support.microsoft.com/en-US/Outlook/sharing/manage-shared-mailbox-settings-in-new-outlook).
- Calendar provides [Scheduling Assistant and Room Finder](https://support.microsoft.com/en-US/Outlook/use-the-scheduling-assistant-and-room-finder-for-meetings-in-outlook), while Microsoft Bookings provides a customer-facing [appointment booking page](https://support.microsoft.com/en-gb/topic/customize-your-booking-page-116d7a84-a7a0-4911-a1e9-debb2cca7c43). Microsoft 365 Groups add a [shared inbox and shared calendar](https://support.microsoft.com/en-us/outlook/people/learn-about-groups-in-outlook).
- Outlook integrates task lists through [My Day](https://support.microsoft.com/en-us/outlook/create-and-manage-task-lists-with-my-day-in-outlook) and Microsoft To Do.
- Enterprise identity/lifecycle is built on [standards-based provisioning and SSO](https://learn.microsoft.com/en-us/entra/identity/app-provisioning/user-provisioning) with [SCIM support](https://learn.microsoft.com/en-us/entra/identity/app-provisioning/scim-support-in-entra-id).
- Purview supplies [Exchange retention](https://learn.microsoft.com/en-us/purview/retention-policies-exchange), [eDiscovery data sources](https://learn.microsoft.com/purview/edisc-settings-data-sources), [audit search](https://learn.microsoft.com/en-us/purview/audit-search), and [DLP policy](https://learn.microsoft.com/en-us/purview/dlp-policy-reference).
- Exchange migration supports [mailbox migration sources](https://learn.microsoft.com/en-us/exchange/mailbox-migration/mailbox-migration) and managed [migration batches](https://learn.microsoft.com/en-us/exchange/mailbox-migration/manage-migration-batches).
- New Outlook supports [offline mail, calendar, and people](https://support.microsoft.com/en-us/outlook/getstarted/how-to-work-offline-in-outlook-for-windows); this is desktop-client capability, not equivalent to offline Outlook on the web.
- Copilot documents [thread summaries, drafting/coaching, meeting creation, and chat](https://support.microsoft.com/en-us/outlook/frequently-asked-questions-about-copilot-in-outlook), again a Later benchmark.

### Yahoo Mail

- Yahoo documents up to [500 mail filters](https://help.yahoo.com/kb/email-filters-sln36699.html), search across [mail, files, photos, and categories](https://help.yahoo.com/kb/new-yahoo-mail/search-emails-yahoo-mail-sln26451.html), and up to [500 disposable addresses for eligible plans](https://help.yahoo.com/kb/new-yahoo-mail/create-edit-delete-temporary-email-addresses-yahoo-mail-sln36718.html).
- Contacts support [import/export](https://help.yahoo.com/kb/mail/instructions-import-export-contacts-sln36726.html), while account transfer covers [mail and contacts](https://help.yahoo.com/kb/new-yahoo-mail/transfer-emails-contacts-accounts-yahoo-mail-sln36731.html).
- Calendar documents [event and series lifecycle](https://help.yahoo.com/kb/new-yahoo-mail/add-edit-delete-calendar-events-yahoo-mail-sln36704.html), [sharing](https://help.yahoo.com/kb/SLN36692.html), and [CalDAV/iCal access](https://uk.help.yahoo.com/kb/new-yahoo-mail/sync-access-calendar-multiple-devices-applications-sln4707.html).
- Account security supports [two-step verification, authenticator apps, security keys, and app passwords](https://help.yahoo.com/kb/new-yahoo-mail/two-step-verification-sln5013.html).

Yahoo is primarily a consumer comparator here; the reviewed sources do not establish an enterprise governance/compliance suite.

### Proton Mail

- Proton documents [scheduled send](https://proton.me/support/schedule-email-send), [filters](https://proton.me/support/email-inbox-filters), and encrypted [message-content search with a local index](https://proton.me/support/search-message-content).
- Privacy differentiators include [PGP and zero-access/end-to-end encryption boundaries](https://proton.me/support/how-to-use-pgp), [hide-my-email aliases](https://proton.me/support/aliases-mail), and [security-key 2FA](https://proton.me/support/2fa-security-key).
- [Easy Switch](https://proton.me/support/easy-switch) imports mail, calendars, and contacts in the background; Proton's Gmail migration guidance explicitly describes [repeat-import deduplication](https://proton.me/support/switch-from-gmail-to-proton).
- Calendar supports [multiple calendars and import/export](https://proton.me/support/protoncalendar-calendars) plus [shareable calendar links](https://proton.me/support/share-calendar-via-link).
- Business accounts provide [organizations and multi-user administration](https://proton.me/support/creating-an-organization) and [user roles](https://proton.me/support/user-roles). The reviewed Proton SCIM material applies to Proton VPN for Business, so it is not counted as Proton Mail SCIM.
- [Proton Scribe](https://proton.me/support/proton-scribe-writing-assistant) is notable because its writing assistant can run locally; privacy-preserving local assistance is the relevant Later pattern for OMS.

### Fastmail

- Fastmail's [feature overview](https://www.fastmail.help/hc/en-us/articles/360058753254) documents rules, snooze, scheduled send, enhanced/saved search, Calendar views, and Contacts; it separately documents [undo send](https://www.fastmail.help/hc/en-us/articles/1500000278222) and detailed [mail search](https://www.fastmail.help/hc/en-us/articles/360060591213-Searching-your-mail).
- Privacy/productivity features include [masked email](https://www.fastmail.help/hc/en-us/articles/4406536368911-Masked-Email) and shared [team calendars](https://www.fastmail.help/hc/en-us/articles/1500000279781-Sharing-calendars-with-other-users) and [contacts](https://www.fastmail.help/hc/en-us/articles/1500000279721).
- Migration covers [mail, calendars, and contacts](https://www.fastmail.help/hc/en-us/articles/360060590593-Migrate-to-Fastmail-from-another-provider), with mail support for [IMAP, MBOX, and EML](https://www.fastmail.help/hc/en-us/articles/360058753594-Import-your-mail).
- Fastmail provides [offline web/mobile support](https://www.fastmail.help/hc/en-us/articles/11517883953039-Offline-support), TOTP and [WebAuthn/U2F security keys](https://www.fastmail.help/hc/en-us/articles/360058752374-Using-two-step-verification-2FA), a tamper-resistant [retention archive](https://www.fastmail.help/hc/en-us/articles/1500000279761-Professional-email-retention-archive), scoped [JMAP API tokens](https://www.fastmail.help/hc/en-us/articles/5254602856719-API-tokens), and standards [autodiscovery](https://www.fastmail.help/hc/en-us/articles/360060591153).

### Apple iCloud Mail, Calendar, Contacts, And Notes

- iCloud Mail documents [folders, rules, junk handling, aliases, and Hide My Email](https://support.apple.com/guide/icloud/mail-on-icloudcom-overview-mm6b1a17e3/icloud), [undo send](https://support.apple.com/guide/icloud/write-and-send-email-mm6b1a5a47/icloud), [custom domains](https://support.apple.com/en-us/102540), and guided [mail import from Gmail, Yahoo, and Outlook](https://support.apple.com/en-ca/guide/icloud/mm63d98f4438/icloud).
- Calendar provides [private/public sharing and permissions](https://support.apple.com/en-by/guide/icloud/mm6b1a9479/icloud).
- Contacts supports [import/export](https://support.apple.com/guide/icloud/import-export-and-print-contacts-mmfba748b2/1.0/icloud/1.0), lists, delete/restore, and automatic synchronization.
- Apple Notes is the strongest direct Notes comparator: it documents [shared-note/folder collaboration, activity, highlights, and mentions](https://support.apple.com/guide/notes/collaborate-with-shared-notes-and-folders-apd4e6e2c9a6/mac), [tags](https://support.apple.com/en-euro/guide/notes/apdc88ed7f1d/mac), and rule-based [Smart Folders](https://support.apple.com/en-euro/guide/notes/apd58edc7964/mac).
- Apple Reminders provides shared task lists where participants can [collaborate and assign tasks](https://support.apple.com/en-mide/guide/iphone/iph2a8f9121e/ios).
- Apple Accounts can require [FIDO-certified security keys](https://support.apple.com/en-la/102637). Advanced Data Protection protects supported iCloud content, including shared Notes when participants qualify, but Apple's platform guide explicitly states that [Mail, Contacts, and Calendar are not end-to-end encrypted because of interoperability](https://support.apple.com/en-euro/guide/security/sec973254c5f/web).

## 5. Capability Matrix

| Domain | Capability | OMS | G | M | Y | P | F | A |
|---|---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| Mail | Core compose/drafts/attachments/actions | Implemented | ● | ● | ● | ● | ● | ● |
| Mail | True conversation assembly and thread actions | **Partial** | ● | ● | · | ● | ● | · |
| Mail | Body/attachment/advanced search and saved searches | Implemented | ● | · | ● | ● | ● | ● |
| Mail | User rules, forwarding, vacation, signatures | Implemented | ● | ● | ● | ● | ● | ● |
| Mail | Schedule send, undo, and snooze | Implemented | ● | ● | · | ● | ● | ◐ |
| Mail | True thread mute/pin behavior | **Partial** | ● | ● | · | ● | ● | · |
| Mail | Reusable message templates | Implemented | ● | ● | · | · | · | · |
| Mail | Delegated/shared mailboxes with scoped send/read/delete | **Absent** | ● | ● | · | · | · | · |
| Mail | Self-service masked/disposable addresses | **Partial** | · | · | ● | ● | ● | ● |
| Mail | End-to-end/confidential-message mode | **Absent** | · | · | · | ● | · | · |
| Calendar | Events, recurrence, invites, multiple views | **Partial** (no agenda/year) | ● | ● | ● | ● | ● | ● |
| Calendar | Permissioned sharing and import/export | **Partial** (backend only) | ● | ● | ● | ● | ● | ● |
| Calendar | Guest free/busy, room/resource directory and suggestions | **Partial** | ● | ● | · | · | ◐ | · |
| Calendar | Public appointment/booking pages | Implemented | ● | ● | · | · | · | · |
| Contacts | Rich records, lists, import/export, duplicate handling | Implemented | ● | ● | ● | ● | ● | ● |
| Contacts | Organization directory and genuinely shared address books | **Partial** | ● | ● | · | · | ● | · |
| Notes | Rich text, checklists, files, reminders, color and pin | Implemented | · | · | · | · | · | ● |
| Notes | User-managed labels/folders and protected notes | **Partial** | · | · | · | · | · | ● |
| Notes | Cross-account sharing, ACLs, participants and activity | **Partial** | · | ● | · | · | · | ● |
| Notes | Stable cross-client identity without duplicate/re-import | **Blocker** | · | · | · | · | · | · |
| Notes | Recoverable trash/restore lifecycle | **Blocker** | · | · | · | · | · | ● |
| Tasks | User-facing task lists integrated with mail/calendar | **Partial** (API only) | ● | ● | · | · | · | ● |
| Security | TOTP, recovery codes, app passwords, session revocation | Implemented | ● | ● | ● | ● | ● | ● |
| Security | Passkeys/WebAuthn/FIDO security keys and MFA enforcement | **Absent** | ● | ● | ● | ● | ● | ● |
| Enterprise | SAML/OIDC SSO and SCIM user lifecycle | **Absent** | ◐ | ● | · | · | · | · |
| Enterprise | Domain-scoped/delegated RBAC and group lifecycle | **Partial** | ● | ● | · | ◐ | ◐ | · |
| Compliance | Immutable audit export, retention, legal hold/eDiscovery | **Absent** | ● | ● | · | · | ◐ | · |
| Compliance | DLP/content classification and policy enforcement | **Absent** | ● | ● | · | · | · | · |
| Operations | Admin audit, metrics, logs, queue/protocol health | Implemented | ● | ● | · | · | ◐ | · |
| Continuity | Offline web/desktop use with safe queued changes | **Absent** | ● | ◐ | · | · | ● | ● |
| Interop | IMAP/SMTP, DAV/Exchange-style sync, autodiscovery | Implemented | ● | ● | ◐ | ◐ | ● | ● |
| Migration | Guided mail/calendar/contact migration, resume/dedup/report | **Partial** | ● | ● | ◐ | ● | ● | ◐ |
| Platform | Public/scoped suite API, events and integration ecosystem | **Partial** | ● | ● | · | · | ● | · |
| Assistance | Privacy-governed summarize/draft/action assistance | **Absent** | ● | ● | · | ● | · | · |

Abbreviations: G = Gmail/Google Workspace, M = Outlook/Microsoft 365, Y = Yahoo Mail, P = Proton Mail, F = Fastmail, A = Apple iCloud suite.

## 6. Ranked Backlog

### Must — paid-quality release blockers and foundations

1. **M0: Make Notes identity, deletion, and sync idempotent.** One logical note maps to one durable OMS ID and one current IMAP representation. Serialize per-user reconciliation, fence stale writers, preserve stable identity across macOS edits, and prevent deleted content from being re-imported. Make Trash real and recoverable—including attachment/reminder retention until permanent deletion—or stop presenting soft deletion as “moved to trash.” Gate on deterministic concurrent-save/delete/restore tests plus a physical macOS edit/close/reopen/delete observation.
2. **M1: Ship real conversation view.** Assemble by normalized `Message-ID`/`In-Reply-To`/`References`, preserve folder+UID identity, render all members, and apply bulk/thread actions deterministically. Hide the preference until the behavior is real.
3. **M2: Add shared/delegated mailboxes.** Model owner, delegate, read/send/delete/manage permissions, Send As/On Behalf identity, audit, and revocation. Do not implement this as shared passwords.
4. **M3: Establish enterprise identity/security.** WebAuthn/passkeys/security keys, administrator-enforced MFA with recovery policy, SAML or OIDC SSO, SCIM provisioning/deprovisioning, domain-scoped RBAC, and break-glass administration.
5. **M4: Deliver a recoverable Migration Center.** Start with reviewed vCard/CSV/ICS and IMAP import, then Google/Microsoft connectors. Every job needs preview, source IDs, idempotency, resume, rate-limit handling, progress, per-item errors, dedup policy, notification suppression, report, and safe undo/rollback boundaries.
6. **M5: Make backup/restore a product capability.** Document storage ownership, encrypted backups, retention, point-in-time database recovery, mail/DAV/uploads consistency, per-tenant export where feasible, clean-host restore, RPO/RTO, and routine restore-drill evidence.
7. **M6: Add a compliance minimum.** Immutable/exportable Admin and mailbox-access audit, configurable retention, deletion policy, user/admin data export, legal-hold boundary, and explicit private-mailbox administrator-access semantics. Treat full eDiscovery and DLP as later expansions of this foundation.
8. **M7: Provide offline continuity.** Installable PWA, encrypted/local bounded cache, offline read/search for recent mail/calendar/contacts, safe draft and action outbox, conflict UX, remote-wipe/cache-expiry policy, and explicit unavailable states for operations that require the server.

### Should — strong differentiation after the Must gates

1. **S1: Unified suite search and command palette** across mail, contacts, events, notes, and tasks with authorization-aware indexing.
2. **S2: Complete Tasks** with lists, due/recurrence/reminders, mail-to-task, event linkage, Today/My Day, and real protocol behavior.
3. **S3: Resource scheduling** with rooms/equipment, capacity, policy, admin directory, availability suggestions, and booking approval.
4. **S4: Shared and organized Notes** with user-managed folders/labels, protected-note semantics, invitation/membership, reader/editor/owner ACLs, participant presence, activity, comments/mentions, and safe conflict history. Add tables, tags, and Smart Folders without weakening the sync model.
5. **S5: Self-service masked addresses** with creation, labels, disable/rotate, reply routing, abuse limits, Admin policy, and audit.
6. **S6: Scoped integration platform** with documented API tokens, suite events/webhooks, rate limits, idempotency, audit, and a JMAP feasibility decision.
7. **S7: DLP phase 1** with outbound rules, attachment/type/size controls, quarantine/approval, policy simulation, and explainable audit before content classification expands.
8. **S8: Connected-device confidence** showing recent clients, last successful protocol sync, failures, app-password association, and one-click revocation.

### Later — valuable, but not a substitute for correctness

- Privacy-governed local or administrator-selected assistance for draft, summarize, tone, action extraction, and semantic search; require opt-in, no silent training/data egress, citations to source messages, and policy controls.
- Priority/category inbox, nudges, smart replies, unsubscribe intelligence, and mail-merge campaigns.
- Native desktop/mobile shells after the PWA and protocols are dependable.
- Advanced DLP/classification, eDiscovery case management, information barriers, data residency controls, and multi-region HA.
- Drive/file workspace and broad third-party add-in marketplace.

## 7. Five-Cycle Delivery Map

This sequence is dependency-ordered. A cycle closes only when its acceptance gates pass; unfinished Must work rolls forward and displaces lower-priority features.

### Cycle 1 — Stop correctness regressions

- Reproduce and fix Notes duplicate/re-import behavior with the fake SQL/IMAP harness.
- Prove browser and protocol CRUD identity for Notes, Contacts, Calendar, and Mail attachments.
- Remove or label misleading dormant controls such as conversation view if they cannot be completed safely in-cycle.
- Re-run suite-wide browser smoke and the protocol release gate.

Exit: no known P0/P1 data-integrity defect; Notes concurrent save/delete tests pass; physical macOS confirmation is recorded or remains an explicit no-go item.

### Cycle 2 — Paid mail and recovery core

- Implement real conversation view and thread actions.
- Implement the first delegated/shared-mailbox slice with audited read/send permissions.
- Deliver backup inventory plus an automated clean-host restore drill.
- Build Migration Center job/source/report primitives and an idempotent IMAP/file-import slice.

Exit: large-mailbox thread fixtures, permission/IDOR tests, migration restart/dedup tests, and restore evidence pass.

### Cycle 3 — Enterprise identity and administration

- Add WebAuthn/security keys and MFA enforcement/recovery.
- Add domain-scoped roles and audit every privilege/lifecycle change.
- Add one standards-based SSO path and SCIM create/update/suspend/delete with dry-run and rollback guidance.
- Add connected-device/app-password visibility and revocation.

Exit: tenant-isolation, deprovisioning, break-glass, replay, recovery, and security review gates pass.

### Cycle 4 — Daily-work productivity

- Add PWA/offline recent-data cache and safe action outbox.
- Ship unified search foundations and the Tasks app.
- Add room/resource scheduling.
- Add cross-account Notes ACLs only after the stabilized identity model is proven.

Exit: offline/online conflict tests, authorization-filtered search, task lifecycle, resource races, and Notes ACL tests pass on desktop/mobile.

### Cycle 5 — Governance and release certification

- Add retention/deletion policy, immutable audit export, administrator-access boundaries, legal-hold foundation, and DLP phase 1.
- Complete staged migration and recovery UX.
- Run clean-VM install/upgrade/rollback, backup restore, load/concurrency, accessibility, supported browser, IMAP/SMTP/CalDAV/CardDAV/ActiveSync, and abuse/security checks.
- Freeze features, triage every known issue, and publish a residual-risk register.

Exit: the release checklist below passes. Enterprise capabilities not actually complete must be labeled Preview or omitted from sales-quality claims.

## 8. Release Checklist

“No more bugs” is not a falsifiable release criterion. Use this paid-quality definition instead:

- Zero known P0/P1 security, privacy, data-loss, duplication, cross-tenant, or unrecoverable-sync defects.
- Every Must capability included in the release has deterministic regression coverage and user-visible error/recovery UX.
- A clean machine can install, upgrade, roll back, back up, and restore the exact release artifact using documented steps.
- Mail send/receive/body/attachment/search/thread actions pass; Calendar and Contacts round-trip through web, DAV, ActiveSync, and physical Apple clients; Notes edit/delete does not duplicate or resurrect.
- Session, MFA, app-password, SSO/SCIM, delegation, Admin, and tenant boundaries pass negative authorization and audit tests.
- Migration is resumable and idempotent, produces a report, and never silently merges or deletes source/user data.
- Browser coverage includes desktop/mobile Chromium and WebKit with zero uncaught console errors on primary flows; accessibility and keyboard gates pass.
- Performance budgets are measured on representative mailbox/contact/calendar/note sizes, with graceful degraded states and bounded background work.
- Every accepted residual risk has an owner, severity, workaround, and target release. Marketing/readme claims match verified behavior.

## 9. Recommended Immediate Next Task

Finish M0 before expanding scope: lock the Notes SQL/IMAP duplicate and delete/re-import cases into deterministic tests, apply the smallest identity/reconciliation fix, then validate the exact edit sequence through macOS Notes. Once that gate is green, true conversation view is the highest-value bounded user-facing slice.
