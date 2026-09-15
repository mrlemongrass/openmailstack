# WebApp P2 workflow release — 2026-09-14

Scope: every P2 item in `WEBAPP_POWER_USER_REVIEW_2026-09-14.md`. The message rule shortcuts were already delivered with P1; this release retains them.

## Delivered behavior

| Workflow | Result and boundaries |
|---|---|
| Whole-result selection | Explicit loaded count and server snapshot, at most 10,000 messages / 200 folders, ten-minute lifetime, 100-message batches. Folder + UID + UIDVALIDITY identity, cursor replay, stop after current batch, confirmed progress and no automatic retry of uncertain writes. Attachment-match verification is bounded to 5 MiB/message and 50 MiB total. Later arrivals are excluded. |
| Bulk Junk | Junk-only selections offer Not junk, with one explicit unblock confirmation. Mark as spam retains sender/domain choice. |
| Keyboard / mailbox controls | Arrow/J/K navigation, Shift range selection, X selection, slash search, C compose, G folder picker, help and Settings opt-out. Sort applies explicitly to loaded results; unread/flagged/attachment shortcuts reuse existing search and scope. |
| Notes | Native sidebar controls with selected state. Trash retains content, files and reminders; restore preserves IMAP linkage and does not immediately fire expired reminders. Permanent deletion removes dependencies and keeps a scrubbed sync tombstone. Historical permanent deletions are not resurrected. |
| Composer windows | Save-and-transfer to a separate window, browser Web Locks ownership, blocked-popup fallback, and up to ten minimized drafts per browser tab/account. Drafts reopen by stable identity instead of stale UID. Save, discard, attachment handling and delivery recovery remain shared. |
| Rich authoring | Embedded PNG/JPEG/GIF/WebP, alt text and width, basic table insertion/editing, safe paste and explicit conversion of unsupported layouts. CID MIME round trips preserve images without duplicate attachments. Limits: 1 MiB/image, 4 MiB total, 20 images, 8 MiB HTML. |
| Calendar / Contacts | Accessible confirmations, pending locks and retained failure state for delete/merge/restore controls while preserving existing deletion scope. |
| Settings | Search by task terms plus contextual Reading and migration/device links. |
| Mail import | EML and standard mboxrd into a reviewed existing folder; 50 MiB/file, 1,000 messages, 20 MiB/message, 10-message batches. At most 25 staged sources / 100 MiB per account. Database history and destination identity survive reload/restart; exact-byte dedup and an IMAP marker reconcile lost append acknowledgements. Retained sources remain removable after completion. |

## Migration inventory and limits

Existing Contacts supports CSV/vCard and Calendar supports ICS. IMAP/SMTP and device setup already exist. No provider-account mailbox importer was found. This release adds file-based mailbox import; it does not claim provider migration parity or request/store source-provider credentials. Bodies, attachments, headers and valid message dates transfer; imported messages are read. Folder trees, provider labels, flags/stars, rules and account settings do not transfer. Dedup applies to identical bytes imported here into the same mailbox identity, not arbitrary pre-existing mail or different exports with changed bytes. An unresolved append requires checking the destination before explicitly retrying.

## Verification

- Browser fixtures use synthetic mail, notes, drafts and import history; no customer messages were changed.
- Browser checks cover whole-result selection, keyboard search/range selection, progress after loaded rows empty, Notes Trash/restore, Settings task search, import review/completion at desktop and 390-pixel mobile width, inline image/table authoring and resize, minimized draft round trip, separate-window content retention, blocked-popup fallback and rejection of a competing draft window.
- MIME tests compile and parse two draft generations, verifying image bytes, CID conversion, table content, alt/width and no duplicate attachment.
- Disposable MariaDB tests with a controlled IMAP adapter exercise import review without append, owner isolation, duplicate upload, replayed cursors, lost append acknowledgement, cleanup failure/retry, changed mailbox identity, source cancellation, case-sensitive destination identity, Notes restore linkage, expired reminders and retained/deleted attachment files. The temporary database, restricted user and test files are removed afterward.
- Shared confirmation interaction test verifies duplicate-click locking, visible rejection and successful retry.
- Independent Standards and Spec reviews found and resolved early-unmounted bulk progress, abandoned snapshot slots, Notes restore linkage and inaccessible import cleanup/history. Follow-up source reviews confirmed the fixes.
- Final frontend suite: **288 passed**. Final backend suite: **1,026 passed, 9 intentionally skipped**. Both builds and frontend lint passed. Disposable database suite: **2 passed** with cleanup confirmed. Shell syntax and whitespace checks passed. Live proof follows below.

A final import regression reproduced a case-insensitive SQL comparison conflating two distinct IMAP folder names. The correction uses an exact binary folder comparison; the same-destination retry remains idempotent.

## Remaining boundaries

Browser ownership coordinates tabs/windows in the same browser profile; it is not a cross-device draft lock. The separate editor requires Web Locks and allowed popups; expansion remains available otherwise. Complex tables, remote images and unsupported HTML require explicit conversion. Tests do not substitute for physical mobile clients or a physical screen-reader session. Existing dependency/configuration advisories are outside this change.

Next recommended task: the P3 accessibility and performance stress pass, including physical screen readers and large mailbox/contact/note datasets.

## Live release

Implementation commits: `4c53a7fd` and destination-identity correction `47f55912`.
Both are pushed to the remote.

The corrected bridge deployment passed its pre/post public IMAPS, ActiveSync mail,
Ping, Contacts and Calendar gates with enforced canary cleanup. Its rollback
snapshot is `/var/backups/openmailstack/protocol-guarded-webmail-20260914T235621Z`.
The corrected active deployment also passed its pre/post gates and cleanup.
Its rollback snapshot is
`/var/backups/openmailstack/protocol-guarded-webmail-20260915T000434Z`.
Both guarded commands exited successfully. No rollback was needed or exercised;
the snapshots are retained recovery points with compatible forward schema.

Live code revision: **`47f55912`**. Deployment logs are
`/tmp/oms-p2-folder-live-bridge.log` and `/tmp/oms-p2-folder-live-active.log`.

After active installation, staging smoke passed service/listener checks,
configuration checks, the Rspamd functional scan, HTTPS/SMTP STARTTLS/IMAPS TLS,
webmail/admin/autoconfiguration endpoints and unauthenticated API rejection.
All **58 frontend distribution files** and **nine changed backend JavaScript
runtime files** match the build. The public index and six referenced/editor
assets match too. Public webmail returns HTTP 200; local/public auth returns 401.
Backend/admin VERSION is `0.1.5`, outbound mode is `active`, and the import staging
directory is private (`700`, `openmailstack:openmailstack`).

Health and artifact evidence: `/tmp/oms-p2-staging-smoke.log` and
`/tmp/oms-p2-artifact-check.log`. All P2 implementation tasks are deployed;
the physical-client/accessibility boundaries above remain explicit.
