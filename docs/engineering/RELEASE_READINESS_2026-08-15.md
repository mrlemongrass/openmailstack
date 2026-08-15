# OpenMailStack Five-Cycle Release Readiness

Date: 2026-08-15

Decision: **NO-GO for a paid-quality small-business or enterprise release.**

The five-cycle hardening run materially improved Notes integrity, release
recovery, protocol/PIM safety, mail truthfulness, frontend quality, and local
disaster recovery. The final tree passes every permitted local automated gate.
It is still not shippable because one known P1 outbound-delivery crash window
remains, the latest guarded production rollout was correctly rolled back on an
existing calendar-tombstone collision, and physical macOS Notes plus clean-host
restore proof are incomplete.

This verdict is intentionally stricter than “the tests are green.” A paid mail
product cannot ask a user to guess whether retrying a send will duplicate it.

## Executive scorecard

| Area | Result | Release interpretation |
|---|---|---|
| Reported Notes duplicate | Code fix complete and deployed; deterministic SQL/IMAP and web-save regressions pass | Original physical macOS edit/delete sequence still required |
| Local backend | 694 tests: 690 pass, 4 documented skips, 0 fail | Green within permitted scope |
| Local frontend | 143/143 tests; lint and production build pass | Green |
| Browser qualification | 176/176 on Chromium/WebKit desktop/mobile | Green for deterministic frontend fixtures, not a physical Apple-client gate |
| Integration/recovery | Complete repository integration and local backup/restore failure matrix pass | Green locally; no clean-host drill |
| Dependency audit | Backend and frontend production dependencies report 0 vulnerabilities | Green at audit time |
| Latest production rollout | Guarded deployment rolled back automatically | Correct safety outcome; newer code is not live |
| Immediate send | Known post-SMTP/pre-persistence crash window in web and ActiveSync | P1, release blocker |
| Small-business release | No-go | Reassess after the P1 and live gates close |
| Enterprise release | No-go | Major product/governance capabilities remain absent |

## The five cycles actually completed

### Cycle 1 — Notes identity and IMAP reconciliation

Outcome: the reported class of duplicate/re-import defect was reproduced in the
explicitly approved fake SQL/IMAP seam and fixed in commit `bfbe1d71`.

Completed:

- Serialized each owner's Notes reconciliation in-process and across backend
  processes with a dedicated MySQL named lock.
- Replaced newest-25 reconciliation with complete mailbox identity enumeration.
- Added deterministic OMS Message-IDs and convergence for duplicate or
  accepted-but-uncertain IMAP appends.
- Fenced delete/import/export acknowledgements with exact SQL revision, IMAP
  revision, UID, owner, and live-state comparisons.
- Prevented an old delete snapshot from removing a newer edit or cleaning its
  reminders/attachments.
- Proved concurrent create, edit/delete/reconcile, restore/delete, failed
  replacement delete, duplicate Message-ID, uncertain append, and mailboxes
  larger than 25 messages.

Release state:

- Deployed through the guarded protocol path with public IMAPS/ActiveSync gates.
- No real Notes row or mailbox message was used for the regression.
- Physical macOS Notes edit/close/reopen/delete remains an external gate.

### Cycle 2 — Truthful updates and reversible paired releases

Outcome: update claims became honest and the modern app plus legacy Admin Portal
became one reversible release unit.

Completed:

- Removed browser-triggered/root automatic upgrade behavior and fabricated
  “latest version” claims.
- Retired the historical passwordless web-to-root bridge.
- Added validated deployed-`VERSION` reporting and a manual operator policy.
- Made guarded deployment and restore snapshot, apply, validate, and recover the
  modern and legacy web surfaces as one globally locked pair.
- Added path, ownership, symlink, interruption, partial-apply, recovery, and
  unhealthy-restore failure coverage.
- Fixed the systemd-active/listener-not-ready race with a bounded readiness
  loop after the first live attempt rolled back conservatively.

Release state:

- Commits `a808b8d1` and `8e8e864c` were deployed successfully.
- A live previous-pair/new-pair restore round trip passed the authenticated
  public protocol gate in both directions.

### Cycle 3 — Protocol, DAV/PIM, startup, and release safety

Outcome: commits `0b04bb67` through `f94f084e` hardened protocol boundaries and
startup/deployment invariants, but the combined production rollout did not pass.

Completed:

- Bounded and validated ActiveSync/WBXML parsing and protocol behavior.
- Hardened Calendar/Contacts/Notes synchronization and exact identity handling.
- Added exact duplicate calendar-tombstone detection and a narrowly scoped
  repair path rather than silently deleting ambiguous rows.
- Hardened protocol-canary attestation and exact database cleanup while
  retaining compatibility with the installed gate.
- Gated application listeners/workers on required additive schema readiness.
- Quiesced backend consumers before guarded file replacement and recovery.

What happened live:

- The guarded deployment found two exact tombstones for one calendar resource
  and correctly rolled back to the last known-good pair.
- Read-only inspection identified the newer row as the retention candidate and
  found no live event for the resource. No row was deleted because production
  data repair requires separate explicit approval.
- Recovery snapshot:
  `/var/backups/openmailstack/protocol-guarded-webmail-20260815T203206Z/`.

### Cycle 4 — Mail truth, Draft/Undo integrity, privacy, and honest UX

Outcome: commit `869bb27b` closes multiple user-visible correctness, privacy,
authorization, and accessibility defects locally.

Completed:

- Serialized browser Notes saves so overlapping autosave/close operations carry
  the first created identity and cannot create a second logical note.
- Serialized Draft autosaves, preserved stable Draft ID/UID, and restored From,
  To, Cc, Bcc, Reply-To, body, thread headers, and attachments into the editor.
- Made scheduled enqueue remove the editable source Draft only after durable
  queueing, abort safely when cleanup fails, and surface residual cleanup risk.
- Made Cancel/Undo retain the exact queued MIME, restore it to Drafts, confirm
  the new UID, and only then clear the queue payload. Frontend Undo reopens that
  authoritative Draft without overwriting a newer composer.
- Separated SMTP MIME from Sent/Draft MIME so Bcc is hidden in transport headers
  but retained in the user's own copy.
- Reported partial SMTP recipient acceptance honestly and never retried already
  accepted recipients.
- Renewed scheduled Sent-copy leases immediately before IMAP and bounded
  credential lookup.
- Enforced same-origin browser mutation/signaling boundaries and replaced the
  public uploads mount with authenticated, owner-scoped, same-origin delivery.
- Enforced free/busy authorization and excluded cancelled events while keeping
  unsupported recurrence fail-closed.
- Enforced Ask/Trusted/Always remote-content policy, configured read delay, and
  current authorized send identities.
- Removed misleading controls for conversation mode, mute, forwarding,
  auto-responder, recoverable Notes Trash, and other behavior not implemented.
- Fixed mobile INBOX casing/prefetch races, Draft row keyboard bubbling, final
  Calendar guest persistence, modal focus, accessible names, and failed-action
  toast expiry.

Release state:

- Fully validated locally, but not deployed because the Cycle 3 live data gate
  remains unresolved.

### Cycle 5 — Independent audit, browser qualification, and recovery hardening

Outcome: local certification is green, but the independent second pass found a
remaining P1 and therefore stopped the release.

Completed:

- Ran independent security/spec/standards and architecture passes over Notes,
  outbound mail, uploads, free/busy, browser behavior, and disaster recovery.
- Added a fail-closed backup/restore state machine in commit `e33c6df6` with
  explicit inventory, checksums, root-only paths, an exclusive lock, continuous
  quiescence, a verified safety snapshot, exact prior-service restoration, and
  rollback on file, database, health, or service-resume failure.
- Excluded package-managed MySQL configuration from the restore contract rather
  than restoring it without a matching database restart.
- Qualified the latest production frontend bundle with clean Chromium and
  WebKit desktop/mobile profiles. Drafts, Mail privacy, Calendar, Contacts,
  Notes, Scheduler, Settings, Admin, accessibility, keyboard operation, and
  unexpected network/error counters passed 176/176.
- Recorded the capability comparison against official Gmail/Workspace,
  Outlook/Microsoft 365, Yahoo, Proton, Fastmail, and Apple documentation.

Release state:

- No-go. Immediate web and ActiveSync sends still lack a durable reservation
  before SMTP acceptance.

## Verification ledger

Final permitted checks on commit `e33c6df6` plus the documentation closeout:

- Backend build: passed.
- Backend tests: 694 total, 690 passed, 4 skipped, 0 failed.
- Frontend tests: 143/143 passed.
- Frontend ESLint: passed.
- Frontend TypeScript/Vite production build: passed; 3,556 modules transformed.
- Browser qualification: Chromium desktop 43/43, Chromium mobile 45/45,
  WebKit desktop 43/43, WebKit mobile 45/45.
- Repository integration: passed, including installer, release-gate,
  rollback/recovery, Admin/RBAC, dependency, frontend, and local DR checks.
- Backup/restore shell syntax and ShellCheck: passed.
- Backend and frontend `npm audit --omit=dev`: 0 vulnerabilities.
- Generated TypeScript/runtime parity: passed inside the backend suite.
- `git diff --check`: passed.

Deliberately not run:

- `webmail-backend/test/scheduled-send-db.test.cjs`. It creates and drops
  `scheduled_emails` and is opt-in for an explicitly disposable MariaDB. The
  user approved the Notes fake SQL/IMAP seam, not this destructive database
  seam.

Browser evidence and limitations are recorded in
`output/playwright/cycle5/REPORT.md`.

## Known release blockers and residual risks

| Severity | Finding | User impact | Required closure |
|---|---|---|---|
| P1 | Immediate web send calls SMTP before durable replay state exists | Crash/lost response can cause duplicate delivery on retry | Universal durable outbox, idempotency/fingerprint contract, crash matrix, disposable MariaDB proof, web and ActiveSync parity |
| P1 release gate | New code cannot pass startup on an existing duplicate calendar tombstone | Cycle 3-5 code is not deployed | Explicit approval for the exact row repair, guarded rollout, rollback and protocol proof |
| Release gate | Physical macOS Notes lifecycle not repeated after the fix | Original client symptom is not physically closed | Edit/close/reopen/delete observation with SQL+IMAP identity evidence |
| P2 | Recovery is fixture-proven but not drilled on a clean host | Unknown package/version and real-service restore gaps | Clean-host install/restore drill, documented RPO/RTO, off-host encrypted retention and PITR plan |
| P2 | Complex free/busy recurrence such as unsupported BYDAY forms fails closed | Availability may show unavailable rather than a precise projection | Standards-complete bounded recurrence engine and interoperability cases |
| P2 | Scheduled-message UI does not expose every attachment/rejected-recipient detail | Recovery/partial-delivery diagnosis is less complete | Extend scheduled detail projection and browser tests |
| Feature gap | True conversations, shared/delegated mailboxes, cross-account Notes ACLs, Tasks UI, rooms/resources | Small-business collaboration parity is incomplete | Separate product slices after correctness gates |
| Enterprise gap | SSO/SCIM, domain-scoped RBAC, enforced MFA/WebAuthn, retention/legal hold/DLP, guided migration, offline/PWA | Enterprise procurement and governance requirements are unmet | Multi-release enterprise roadmap; do not market these as implemented |

Workaround for the outbound P1 until fixed: if a send response is lost or the
service restarts during sending, the sender must check Sent and confirm with the
recipient before retrying. That is not acceptable as a paid-quality release
contract, which is why the verdict is no-go.

## Minimal next implementation

Reuse `scheduled_emails` as the universal outbound outbox rather than creating a
second queue. Add an immediate/scheduled submission kind, an owner-scoped
idempotency key, a server-computed canonical request fingerprint, and a unique
owner/key index. Commit the complete SMTP MIME, Bcc-preserving Sent MIME,
envelope, Message-ID, Draft identity, and recovery state before SMTP.

The request path may claim and process its own row immediately for normal
latency; the existing worker recovers it. Same-key/same-fingerprint replay must
return the stored result without SMTP. Same key with different content must be
`409`. Expired pre-SMTP claims may retry; an expired post-DATA `smtp_inflight`
row must become terminal `delivery_uncertain` and never resend. Sent append may
retry independently and reconcile by Message-ID. ActiveSync SendMail requires
the same guarantee, not a web-only exception.

Before enablement:

1. Perform a read-only live MariaDB version/table/index/state preflight.
2. Apply the additive migration twice on a disposable MariaDB matching live
   version and collation.
3. Prove simultaneous reservation/claim, worker/request races, crash states,
   owner isolation, and immediate-row non-cancellability.
4. Add frontend idempotency-key retention and explicit pending/uncertain UX.
5. Run guarded web and physical iOS ActiveSync send/retry validation.

## What went wrong during the five cycles

- The initial goal—repeat until there are no bugs—was not a falsifiable release
  criterion. Each deeper pass found real defects; the correct stop condition is
  zero known P0/P1 defects plus completed release evidence.
- Planned competitor-parity features were displaced by correctness work. The
  cycles improved the product substantially but did not implement conversations,
  delegation, SSO/SCIM, compliance, migration, offline mode, or Notes sharing.
- The first Cycle 2 live release attempt exposed a readiness race. The rollback
  worked, and the retry policy was fixed and later proven live.
- The Cycle 3 guarded rollout exposed pre-existing duplicate production
  tombstones. The rollout correctly recovered, but the repair is blocked on
  explicit production-data approval.
- A four-browser concurrent run made the three-second mark-read assertion miss
  its 500 ms margin once (42/43). The isolated rerun passed 43/43; the report
  records this as test-host timing sensitivity rather than hiding it.
- The final browser pass found a mobile `inbox`/`INBOX` identity race and Draft
  keyboard bubbling late. Both were fixed and rerun across Chromium/WebKit.
- Parallel code movement briefly left source-regex tests stale. The final tests
  use behavior or whitespace-tolerant checks and pass.
- One backend validation command initially expanded to Node's automatic test
  discovery, reached an authentication failure in a legacy probe, and was
  stopped. No mutation succeeded. The corrected explicit file list excluded
  the permission-gated scheduled-send database test and passed 694 tests.
- Local recovery fixtures are not a substitute for a clean-host drill, and
  Playwright WebKit is not a physical macOS/Apple Notes client.

## Final release position

OpenMailStack is a serious, broad FOSS suite with a much stronger correctness
and recovery foundation than at the start of this run. It is not yet something
this review can responsibly call ready for paying small-business users, and it
is materially short of enterprise readiness. Keep the latest known-good
production pair, close the universal outbound outbox first, obtain the narrow
production tombstone-repair approval, then complete physical Notes and
clean-host recovery gates before another go/no-go review.
