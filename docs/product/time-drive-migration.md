# OpenMailStack Time, Drive, And Migration Roadmap

Status: `Track T automated exception/reminder/custom-VTIMEZONE gates passed; physical exception/reminder matrix pending`

Research date: 2026-07-20

Owner: OpenMailStack

## 1. Outcome

OpenMailStack should address this feedback as three connected product tracks:

1. **Time correctness and display** — fix calendar interoperability first, then add a user-selectable system or home timezone and an optional live clock.
2. **OMS Drive and connected files** — add a lean, optional self-hosted file service plus a common provider interface for Google Drive, OneDrive, Nextcloud, and OpenCloud.
3. **Migration Center** — provide safe, resumable one-time imports from Google, Microsoft 365, and iCloud into OMS Contacts and Calendar before considering continuous two-way synchronization.

The immediate priority is Track T. The reported `16:00` web / `20:00` macOS discrepancy is a correctness and interoperability defect, not a cosmetic preference issue. Calendar migration must build on the corrected time model so imported events do not silently move. The F0 file-tray/provider prototype and non-calendar Drive discovery can proceed independently, but they remain sequenced after the user-visible time repair unless priorities change.

## 2. Current Evidence

Repository inspection on 2026-07-20 originally found the timezone defect. The first implementation slice now provides:

- Calendar settings persist explicit `System` or fixed `Home` timezone mode, IANA home zone, 12/24-hour format, and the optional desktop-header clock setting.
- The backend iCalendar boundary distinguishes UTC values ending in `Z`, IANA `TZID` values, floating local times, and all-day dates; event kind and original zone travel through the Calendar API.
- Month, Week, Day, the mini-calendar, current-time marker, event editor, and free/busy query projection use the selected display/event timezone. Calendar labels the active zone and offset.
- New timed events serialize with the active display zone as explicit `TZID`; existing UTC, zoned, floating, and all-day forms retain their meaning when edited.
- Focused tests cover UTC, Baghdad, floating, all-day, legacy settings, all-day date arithmetic, explicit event-zone conversion, and weekly New York recurrence across DST. Mocked Chromium flows prove the reported Baghdad rendering, searchable settings/clock keyboard behavior, mobile layout, and visible recovery from a settings failure.
- `AppShell` owns cross-suite navigation and header controls.
- Calendar and Notes already use `react-resizable-panels`.
- Mail, Calendar, and Notes each have attachment entry points. Notes already has persisted file attachments despite the older roadmap saying otherwise.
- Contacts already supports vCard and CSV import. Calendar `.ics` import is still shown as planned. No Google or Microsoft migration wizard exists.

This means the suite has useful seams, but the older “timezone conversion complete” and “Calendar Settings complete” roadmap labels are too strong and are reopened by this plan.

## 3. Recommended Product Decisions

Unless the owner decides otherwise, implementation should use these defaults:

- **Calendar display timezone:** `Use system timezone` by default, with `Use a fixed home timezone` as the second mode.
- **Existing saved timezone:** treat a pre-mode saved timezone as an intentional fixed Home preference so upgrades do not silently change an existing user's selection; accounts without a saved preference still default to System.
- **Clock:** optional in the desktop header; Calendar always shows its active timezone and current-time marker. The clock uses the selected display timezone and the existing 12/24-hour preference.
- **Event semantics:** preserve whether a value is all-day, UTC, explicitly zoned, or floating. Never reduce all four kinds to one browser-local `Date` during parsing.
- **New timed events:** use the active System/Home display zone as an explicit `TZID`, not an accidental floating value. Edit an existing zoned event in its original event timezone and preserve that `TZID` unless the user explicitly changes the event timezone. Changing only the display timezone never reinterprets the event.
- **OMS Drive:** an optional installer component and an Admin-controlled per-mailbox entitlement, following the proven Scheduler installation pattern.
- **Navigation:** preserve the existing product decision that Scheduler appears immediately after Notes. Add Drive after Scheduler on desktop; place it in `More` on mobile initially, while attachment surfaces expose a direct file-tray button.
- **File transfer:** `Attach a copy` is the default for Mail, Notes, and Calendar. `Insert share link` is an explicit alternative only when the provider can create a suitable link.
- **External connections:** least-privilege user OAuth for Google and Microsoft; app-password/WebDAV connections for user-owned Nextcloud/OpenCloud endpoints; encrypted credentials and tokens at rest.
- **Migration:** one-time copy/import first. Do not combine initial migration with continuous bidirectional sync or account cutover.
- **iCloud Drive:** do not promise a persistent server-side connector until a feasibility spike identifies a supported Apple interface. Apple-platform file selection through the browser remains available as a normal upload path.

## 4. Track T — Time Correctness And Clock

Implementation status (2026-07-20): T0-T2 plus most of T3 are implemented and deployed. Apple-shaped CalDAV lifecycle tests, EAS `TIME_ZONE_INFORMATION`, recurrence exceptions, display reminders, conservative custom/invalid `VTIMEZONE` handling, Scheduler availability, deterministic DST vectors, and real Chromium/WebKit pass. Physical macOS 26.5.2 CalDAV and iOS 26.5.2 ActiveSync single-event create/edit/delete plus four-occurrence New York weekly series across DST also pass in OMS Web. T3 remains open only for the physical recurrence-exception/reminder matrix.

### 4.1 Required time model

| Event kind | Example | Meaning | Display behavior |
|---|---|---|---|
| All-day | `DTSTART;VALUE=DATE:20260724` | A calendar date, not midnight UTC | Remains July 24 in every timezone |
| UTC instant | `DTSTART:20260724T170000Z` | One global instant | Convert to selected display timezone |
| Zoned wall time | `DTSTART;TZID=Asia/Baghdad:20260724T200000` | 20:00 in Baghdad with zone rules | Preserve zone and convert for other display zones |
| Floating wall time | `DTSTART:20260724T200000` | 20:00 without a zone | Preserve floating semantics; do not silently label it UTC |

The domain boundary should carry the event kind and original timezone through parsing, recurrence, API responses, editing, and serialization. A JavaScript `Date` may represent a resolved instant internally, but it must not be the only stored meaning for all-day or floating values.

### 4.2 T0 — Reproduce and lock the defect

Acceptance criteria:

- Add golden iCalendar fixtures for UTC, `TZID=Asia/Baghdad`, floating, all-day, and a DST-observing zone.
- Reproduce the reported four-hour discrepancy or document the exact source payload if it expresses a different offset.
- Prove current browser, CalDAV/macOS, and backend interpretations before changing serialization.
- Add focused tests that fail under the current parser.

### 4.3 T1 — Correct the protocol boundary

Work:

- Keep timezone math inside one bounded module at each deployable runtime boundary: backend parse/recurrence and browser projection/serialization. Lock both to the same golden conversion vectors; consolidate them into a shared package only when the installer can ship that package atomically with both applications.
- Parse RFC 5545 `Z`, `TZID`, floating, and `VALUE=DATE` forms distinctly.
- Preserve original `TZID` when editing an existing zoned event.
- Serialize new timed events with the active display zone as explicit `TZID`; never emit an ambiguous floating value accidentally.
- Edit existing zoned event fields in the event's original timezone. An explicit event-timezone change preserves the instant by default and must preview any wall-time change before save.
- Keep all-day end dates exclusive and date-based.
- Cover DST gaps, overlaps, recurrence, exceptions, reminders, Scheduler projections, CalDAV, and ActiveSync.
- Select a mature iCalendar/timezone dependency only if the fixture spike proves it reduces risk relative to extending the current parser.

Release gates:

- The same event represents the same instant in OMS Web Calendar and macOS Calendar.
- `20:00 Asia/Baghdad` displays as `20:00` when the selected display timezone is Baghdad.
- Switching the display timezone changes presentation, not stored event identity or instant.
- All-day events never move to the previous or next date.
- Existing Calendar CRUD, recurrence, CalDAV, ActiveSync, Scheduler, and free/busy tests pass.

### 4.4 T2 — Apply user preferences everywhere

Settings under **Calendar > Time & date**:

- Timezone mode: `System` or `Home`.
- Home timezone: searchable IANA timezone list.
- Clock format: existing 12-hour or 24-hour preference.
- Show current time in header: on/off.
- Later, optional secondary timezone in Week/Day view.

UX requirements:

- Label the Calendar grid with the active timezone and abbreviation/offset.
- Use the selected timezone in Month, Week, Day, Agenda, event details, free/busy, and the event editor.
- Show the current-time line only on the selected timezone's current day.
- If system timezone changes while `System` mode is selected, refresh safely on focus/visibility.
- Warn before changing the meaning of an existing floating event; ordinary display-zone changes require no confirmation.
- Existing floating events remain floating unless the user explicitly converts them. Assigning a zone means “keep this wall time in the selected zone” and previews the resulting instant; removing a zone keeps the event's wall time and makes it floating. A recurring conversion applies coherently to the master and exceptions, rejects nonexistent DST wall times, and requires an explicit earlier/later choice for ambiguous overlap times.
- On narrow screens, keep the clock out of the bottom navigation and show it in Calendar/header overflow instead.

### 4.5 T3 — Interoperability validation

- Golden fixtures: UTC, Baghdad, Phoenix, New York DST gap/overlap, floating, all-day, recurrence, and exception.
- Browser matrix: at least Chromium plus WebKit/Safari behavior for `datetime-local` and `Intl` formatting.
- Protocol matrix: web create/edit, macOS CalDAV create/edit, iOS ActiveSync create/edit, and Scheduler-created event.
- Record exact payload, selected display timezone, expected time, actual web time, and client time in the release validation document.

Local preflight status, 2026-07-20:

- Passed: UTC, Baghdad, Phoenix, New York DST gap/overlap, floating, all-day, recurrence exceptions, deleted occurrences, explicit exception zones/all-day state, and display reminders including at-start/week forms in backend/frontend tests.
- Passed: custom aliases are canonicalized only when their supported yearly transition behavior matches the IANA candidate across a 28-year calendar cycle and every referenced event year. Contradictory, bounded, not-yet-applicable, malformed, second-precision, and negative-zero definitions preserve wall time as explicit floating semantics with an OMS Web warning; whole-series saves retain the original `VTIMEZONE`, `EXDATE`, and exception components.
- Passed: real Chromium and WebKit desktop/mobile Calendar and Settings flows, including `17:00Z` displayed as `20:00 Asia/Baghdad`, Home/System selection, optional clock, current-day-only time line, and instant-preserving event-zone conversion.
- Passed: an in-memory reversible CalDAV lifecycle using an Apple-style Baghdad event and strong conditional requests; the test creates, HEADs, reads byte-for-byte, rejects a stale ETag, updates, and deletes the event.
- Passed: iOS-shaped ActiveSync single/all-day conversions plus simple recurrence mapping, and Scheduler DST/Baghdad/Phoenix/Tokyo availability projection.
- Passed: EAS recurring meetings encode/decode the 172-byte little-endian origin `TimeZone` value; fixed Baghdad, New York, Microsoft Pacific, and Windows Central fixtures preserve local wall time across DST. CLDR Windows-to-IANA names are accepted only when their binary rules match.
- Passed: the tested Calendar backend/frontend are live behind a root-only rollback snapshot; local/direct/public ActiveSync `OPTIONS`, public web/auth boundaries, exact backend artifacts, Nginx, services, journal audit, and full staging smoke pass without production calendar mutation.
- Passed named-client gate: macOS 26.5.2 CalDAV created, edited, and deleted one zoned event without duplication; OMS Web updated automatically. A New York weekly series on March 1, 8, 15, and 22 retained 09:00 local time, displaying 17:00 Baghdad before US DST and 16:00 afterward. macOS required an End Repeat date of March 23 to include March 22, consistent with its exclusive end-date UI behavior.
- Passed named-client gate: iOS 26.5.2 ActiveSync created, edited, and deleted one Baghdad event under one UID with automatic OMS Web reconciliation. A 09:00 America/New_York weekly series on March 5, 12, 19, and 26, 2027 displayed at 17:00 Baghdad before US DST and 16:00 afterward; the whole-series 09:30 edit displayed at 17:30/16:30 under the same UID, and deletion produced one tombstone with automatic OMS Web removal.

## 5. Track F — OMS Drive And Connected Files

### 5.1 Product boundary

OMS Drive should be a calm file service, not a second groupware suite. The first deployable release is F1 plus F2 and includes:

- folders and breadcrumbs;
- upload, resumable upload, download, rename, move, copy, and trash/restore;
- metadata search and sorting;
- quotas and Admin enablement;
- safe previews and thumbnails for a bounded type list;
- checksums, duplicate-safe naming, audit events, malware scanning, and backup/restore documentation;
- attaching files into Mail, Notes, and Calendar;
- provider-neutral attachment transfer into Mail, Notes, and Calendar.

WebDAV client access, file versions, public sharing, S3-compatible storage, content indexing, and an expanded preview matrix remain F4. The first release does not include office editing, chat, photo-library intelligence, project management, collaborative documents, or public anonymous editing.

### 5.2 Storage architecture

- Add a bounded `webmail-backend/src/drive/` module rather than expanding the general API file.
- Store tenant/user/folder/file/version metadata in additive MariaDB migrations.
- Store blobs outside the deployed application tree, under a dedicated configurable data root such as `/var/lib/openmailstack/drive`.
- Use content checksums and opaque storage keys; never use user filenames as filesystem paths.
- Keep a storage-driver boundary so an S3-compatible driver can follow, but ship only the proven local driver first.
- Installation is opt-in. Installation does not entitle every mailbox automatically.
- Define backup, restore, quota recalculation, orphan cleanup, and rollback before live deployment.

### 5.3 Shared provider contract

The frontend should consume one capability-aware `FileProvider` contract rather than provider-specific components:

- connect/disconnect and health;
- list/search/get metadata;
- download or server-side materialize;
- upload/create folder when permitted;
- create/revoke share link when permitted;
- pagination, cancellation, retry, and normalized error states.

| Provider | First capability | Auth | Notes |
|---|---|---|---|
| OMS Drive | Full read/write | OMS session | Native source of truth |
| Nextcloud | Read/write via WebDAV | App password/token | Reuse generic WebDAV adapter |
| OpenCloud | Read/write via WebDAV | Deployment-specific credential | Reuse generic WebDAV adapter with configurable DAV root |
| Google Drive | Pick, browse, attach-copy; upload later | User OAuth | Google-native documents require export to a chosen format before attachment |
| OneDrive | Pick, browse, attach-copy; upload later | Delegated user OAuth | Official picker can be embedded and returns drive/item identifiers |
| iCloud Drive | Feasibility spike; browser file selection fallback | Apple platform/browser | No committed server-side connector until a supported API is proven |

### 5.4 Interactive file tray

Desktop behavior:

- Drive is a full application route for normal file management.
- `Open files` in Mail, Notes, Calendar, or Scheduler opens a shell-level, resizable right tray.
- Default to approximately 60/40 app/files, allow 50/50, remember the user's width, and enforce usable minimum widths.
- Switching folders or providers does not discard the open draft, note, or event.
- Dragging a file card highlights only valid drop targets. Keyboard users can select files and activate `Attach to …` without dragging.
- Closing the tray restores the previous app width and focus.

Mobile/tablet behavior:

- Use a full-screen sheet or route, not two compressed half-width panes.
- Multi-select files, then return them to the originating draft/note/event.
- Preserve the origin state across OAuth redirects and provider errors.

Transfer behavior:

- A drop passes a provider item descriptor, not a browser-only URL.
- The backend materializes external content directly to the destination or a bounded temporary draft store; large files do not round-trip through browser memory.
- Mail attachments become immutable copies before send so delivery does not depend on a later-expired provider token or permission.
- Link insertion is separate and discloses link audience, expiry, and whether recipients need an account.
- A Calendar drop creates an OMS-owned copy. By default it is private to the event owner; it is not silently exposed to attendees or converted into a public URL.
- Before Calendar attachment integration ships, define and test a capability matrix for OMS Web Calendar, invitation email, ICS `ATTACH`, CalDAV, and ActiveSync. Unsupported clients must degrade visibly; sharing with attendees requires either a bounded invitation attachment or an explicitly-created share link.

### 5.5 Security and reliability gates

- Encrypt OAuth refresh tokens and external credentials with a purpose-separated key and versioned rotation path.
- Use least-privilege scopes, CSRF-protected OAuth state, PKCE where applicable, revocation, and per-user provider isolation.
- Treat user-supplied WebDAV endpoints as SSRF-sensitive: HTTPS policy, DNS/IP validation, redirect restrictions, response-size limits, timeouts, and no credential logging.
- Sanitize filenames and preview content; force safe download headers for untrusted types.
- Scan uploaded and materialized files through the configured malware boundary.
- Enforce quotas transactionally and test concurrent uploads.
- Make copy/materialization jobs idempotent, cancellable, observable, and clean up abandoned temporary files.
- Never expose provider tokens, signed URLs, file contents, or private folder names in normal logs or audit descriptions.

F1/F2 release gates:

- Publish and enforce default/max file size, quota, chunk size, temporary-storage, and filename limits; test the configured boundaries rather than relying on prose such as “large” or “bounded.”
- Resume an interrupted multi-chunk upload without duplicating bytes or quota and reject two concurrent uploads that exceed the remaining quota.
- Fail closed when required malware scanning is unavailable, with an Admin-visible health state and recoverable user error.
- Cancel or fail a materialization job without leaving a usable partial file, quota leak, or unbounded temporary object.
- Restore an F1 backup into an empty test installation, recalculate quotas, and verify file checksums plus metadata before release.
- Publish the exact preview MIME/type matrix and verify unsafe/unknown types download with safe headers instead of rendering inline.
- Prove desktop resize/focus/keyboard drag alternative, mobile return flow, slow-network retry, expired OAuth, provider revocation, and destination-draft preservation.

### 5.6 Delivery phases

**F0 — Contract and interaction prototype**

- Define provider capability types and transfer states.
- Build the shell-level tray with a fake provider.
- Prove resize, focus, route persistence, mobile return flow, keyboard selection, and drops into Mail/Notes/Calendar.
- Run provider feasibility spikes for Google-native export formats and download, OneDrive picker/tenant behavior, WebDAV root/auth variants, server-side materialization, and share-link audience/revocation. Record required scopes and an end-to-end read-only file proof before scheduling each F3 connector.
- No production storage or OAuth in this phase.

**F1 — OMS Drive foundation**

- Optional installer, Admin entitlements, local storage driver, metadata migrations, folders, resumable upload/download, rename/move/copy, metadata search/sort, bounded previews, quota, trash/restore, checksum, scan, audit, and backup/rollback proof.

**F2 — Native attachment integration**

- Server-side materialization and destination adapters for Mail drafts/compose, Notes, Calendar events, and Scheduler workflows where appropriate.

**F3 — External providers**

- Nextcloud/OpenCloud WebDAV first because they share a standards-based adapter.
- Google Drive and OneDrive next with user OAuth and official picker/API flows.
- iCloud Drive feasibility decision after the spike; keep the browser file-selection fallback regardless.
- Each connector must pass pagination to true end, rate-limit/`Retry-After`, token expiry and revocation, source change/deletion during transfer, retry checkpoint, content checksum, and interrupted-copy cleanup tests. Google-native export cancellation/format loss, Microsoft personal/work/school tenant restrictions, and WebDAV auth/root/redirect/SSRF variants require provider-specific fixtures before release.

**F4 — File-service maturity**

- Versions, sharing links, WebDAV client access, content indexing, expanded previews, S3-compatible storage, retention controls, and operational recovery.

## 6. Track M — Migration Center

### 6.1 Product boundary

Migration Center lives under **Settings > Import & migration** and performs reviewed, one-time copies. It does not delete source data, change MX/DNS, or begin continuous sync.

Source connections are read-only. Import writes must use a notification-suppressed destination path: they cannot send attendee invitations or updates, change source RSVP/organizer state, trigger Scheduler workflows, or write back to the source provider. The preview must disclose this behavior before the first destination write.

Supported first sources:

| Source | Contacts | Calendars | Initial transport |
|---|---|---|---|
| Existing files | vCard/CSV | ICS | Browser upload |
| Google | People API | Calendar API | User OAuth, read-only |
| Microsoft 365 / Outlook.com | Microsoft Graph contacts | Microsoft Graph calendars/events | Delegated user OAuth, read-only |
| iCloud | vCard export | ICS export | Guided file import first |
| Nextcloud/OpenCloud | CardDAV export/read | CalDAV export/read | Standards-based connection after file import |

### 6.2 Migration workflow

1. Choose a source and destination address book/calendar.
2. Connect with read-only OAuth or upload an export file.
3. Scan source data and show counts, date range, calendars/groups, unsupported fields, and likely duplicates.
4. Let the user include/exclude containers and choose conflict behavior.
5. Run a dry preview without destination writes.
6. Start an idempotent background import with visible progress, pause/resume/cancel, and retry.
7. Show imported, merged, skipped, failed, and unsupported counts with a downloadable sanitized report.
8. Offer a bounded undo window for records created by that migration job when ownership and later edits make undo safe.
9. Disconnect/revoke the source credential on request; one-time imports should offer automatic disconnect after completion.

### 6.3 Data integrity rules

- Preserve source IDs and iCalendar UIDs in source-mapping records so retries do not duplicate data.
- Enforce mapping uniqueness by destination user, provider, source account, entity type, source container, and source entity ID.
- Preserve calendar timezone, event timezone kind, recurrence master/exception relationships, attendees, reminders, descriptions, locations, transparency, and all-day semantics where OMS supports them.
- Preserve recurrence masters, exceptions, and cancellation state without expanding an unbounded series. Exclude source-cancelled events by default and report them; make import date range explicit in preview.
- Import provider-specific event types only when their semantics can be represented; otherwise report the downgrade before writes.
- Preserve multiple contact names, emails, phones, postal addresses, organizations, birthdays, notes, photos, and groups where supported.
- Use conservative duplicate detection and present merge choices. Do not silently merge solely on display name.
- A preview captures a source version/fingerprint and exact conflict choices. If the source changes before execution, require a rescan instead of running a stale preview.
- Pause/cancel stops after the current atomic record, keeps attributable completed outcomes, and resumes idempotently. It does not pretend to roll back unrelated successful rows.
- Undo may remove only records created by that job that have not been modified since import. The owner must confirm the undo window before M0 ships.
- A failed row must not roll back unrelated successful rows, but every row outcome must be attributable to the job.
- Never log raw contacts, event descriptions, attendee lists, tokens, or uploaded export content.
- Maintain a source/version-specific capability matrix covering every mapped contact field, photo/group behavior, calendar/event type, recurrence/exception/cancellation form, reminder, attendee/organizer field, timezone form, attachment, and downgrade. Every source phase needs golden input/output fixtures and a zero-silent-loss gate: preserved, transformed, skipped, and unsupported data must be deterministic and reported before writes.

### 6.4 Delivery phases

**M0 — Unified file import**

- Move existing contact vCard/CSV import into the Migration Center contract with preview and reporting.
- Implement ICS calendar import only after the T1 protocol correction and T3 interoperability matrix pass.
- Route imported events through the notification-suppressed destination path and regression-test that no invitation, RSVP mutation, Scheduler workflow, or source write occurs.
- Add idempotent job/source-mapping records and regression fixtures.

**M1 — Google migration**

- Read-only OAuth, People contacts, calendar selection, paginated event import, recurrence/timezone mapping, preview, resumable jobs, and disconnect.
- Release with multi-page and rate-limit fixtures, expired sync/page token recovery, source changes between preview/run, Google event-type and recurrence mappings, an interrupted-run resume, and proof that rerunning creates no duplicate destination records.

**M2 — Microsoft migration**

- Delegated read-only OAuth, contact folders, calendars/events, recurrence/timezone mapping, preview, resumable jobs, and disconnect.
- Release with personal/work/school account fixtures as supported, paginated and throttled responses, token expiry/revocation, changed source records, recurrence/timezone mappings, interrupted-run resume, and duplicate-prevention proof.

**M3 — iCloud and DAV migration**

- Guided iCloud vCard/ICS export/import first.
- Add CardDAV/CalDAV one-time copy for Nextcloud/OpenCloud and feasible iCloud account flows only after credential, interoperability, and Apple-policy review.
- Release each DAV source with collection pagination/sync fixtures where applicable, auth expiry, ETag/source-change handling, recurrence/timezone/contact-group fidelity, interrupted-run resume, and duplicate-prevention proof.

**M4 — Optional continuous connections**

- Reassess the existing external sync-daemon roadmap after one-time migration is reliable.
- Continuous two-way sync requires conflict policy, deletions/tombstones, rate-limit recovery, credential rotation, monitoring, and user-visible source-of-truth rules. It is not an extension flag on the importer.

## 7. Program Order

| Order | Slice | Why now | Completion proof |
|---|---|---|---|
| 1 | T0 defect fixtures | Protects existing user data and establishes the exact bug | Current behavior reproduced in automated tests |
| 2 | T1 protocol correction | Drive/migration cannot safely import calendars without it | Web, macOS/CalDAV, iOS/ActiveSync agree |
| 3 | T2 preferences and clock | Delivers the visible user request on a correct model | System/home modes and clock verified across views |
| 4 | T3 interoperability validation | Prevents a browser-only fix from being called complete | Browser, CalDAV, ActiveSync, and Scheduler matrix passes |
| 5 | F0 file-tray/provider prototype | Validates the signature interaction and provider feasibility before storage investment | Desktop/mobile/keyboard prototype and read-only provider spikes pass |
| 6 | M0 file migration | Fastest safe migration value using existing contacts work | Previewed vCard/CSV/ICS imports are idempotent and notification-suppressed |
| 7 | F1-F2 OMS Drive | Delivers self-hosted storage and cross-app attachment flow | Optional install, quota, scan, restore, and attachment gates pass |
| 8 | F3 providers | Adds standards/OAuth connected files | WebDAV, Google, and Microsoft provider contracts pass |
| 9 | M1-M3 providers | Adds direct source migrations | Resumable source-specific migrations and reports pass |
| 10 | F4/M4 maturity | Sharing, versions, WebDAV clients, and possible continuous sync | Operational and conflict-recovery gates pass |

Each implementation cycle should take one bounded slice from this order, define tests first, and leave production deployment as a separate guarded decision unless explicitly requested.

## 8. Decisions To Confirm

1. Should the optional header clock default to **on** or **off** for existing users?
2. Is `System` plus one fixed `Home` timezone sufficient for the first release, or is a visible secondary timezone required immediately?
3. Confirm the product name **OMS Drive** and the proposed navigation placement after Scheduler so Scheduler remains immediately after Notes.
4. Confirm `Attach a copy` as the default, with `Insert share link` as a deliberate alternative.
5. Confirm that Migration Center is one-time copy first, with continuous two-way sync deferred; also confirm the default conflict behavior and desired undo window.
6. Is direct persistent iCloud Drive browsing a release requirement, or is Apple Files/browser upload acceptable until a supported integration path is proven?
7. Should OMS Drive v1 ship local-disk storage only, or is S3-compatible object storage required in the first deployable release?
8. Should Admins set only quotas/entitlements, or must they also be able to disable individual external providers installation-wide?
9. Should users be able to connect multiple accounts for the same external provider in v1?
10. What default per-user quota and maximum file size should OMS Drive ship with? The recommended scanner policy is fail-closed when scanning is enabled or required.

Work can begin on T0 and T1 without waiting for answers to any of these owner questions.

## 9. Official Sources Reviewed

- [RFC 5545 — iCalendar](https://www.rfc-editor.org/rfc/rfc5545.html)
- [Google Picker overview](https://developers.google.com/workspace/drive/picker/guides/overview)
- [Google Drive files and folders](https://developers.google.com/workspace/drive/api/guides/about-files)
- [OneDrive File Picker v8](https://learn.microsoft.com/en-us/onedrive/developer/controls/file-pickers/?view=odsp-graph-online)
- [Nextcloud WebDAV file operations](https://docs.nextcloud.com/server/stable/developer_manual/client_apis/WebDAV/basic.html)
- [OpenCloud WebDAV API](https://docs.opencloud.eu/docs/dev/server/apis/http/webdav/)
- [Google People contacts list](https://developers.google.com/people/api/rest/v1/people.connections/list)
- [Google Calendar events list](https://developers.google.com/workspace/calendar/api/v3/reference/events/list)
- [Microsoft Graph contacts list](https://learn.microsoft.com/en-us/graph/api/user-list-contacts?view=graph-rest-1.0)
- [Microsoft Graph events list](https://learn.microsoft.com/en-us/graph/api/user-list-events?view=graph-rest-1.0)
- [Apple iCloud archive/export guidance](https://support.apple.com/en-us/108306)
- [Apple File Provider framework](https://developer.apple.com/documentation/FileProvider)
- [Apple document picker directory access](https://developer.apple.com/documentation/uikit/providing-access-to-directories)
