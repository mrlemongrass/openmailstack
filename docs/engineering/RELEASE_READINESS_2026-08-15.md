# OpenMailStack Eight-Cycle Release Readiness

Date: 2026-08-15

Decision: **NO-GO for a paid-quality small-business or enterprise release.**

The eight-cycle hardening run closed the reported Notes duplication class and
the previously release-blocking outbound crash window in the repository. Web,
delayed/Undo, and ActiveSync mail now share a durable, idempotent outbox; the
browser can recover logical sends across tabs, reloads, network ambiguity, and
delivery-mode changes; and the migration/crash/timezone/privacy contract passes
on isolated MariaDB.

The code result is materially stronger than the deployment result. This tree
must not be enabled through the currently installed automatic rollback target:
that older runtime does not understand immediate outbox rows or keyed retries,
so rollback after accepting new traffic could itself create a duplicate-send
path. The guarded rollout also remains blocked by an existing duplicate
calendar tombstone that requires separate production-data approval. Physical
iOS SendMail retry and the original macOS Notes lifecycle have not been
repeated. “All tests green” is therefore not being misreported as “shippable.”

## Executive scorecard

| Area | Result | Release interpretation |
|---|---|---|
| Reported Notes duplicate | SQL/IMAP and overlapping web-save races fixed; original Notes backend fix is deployed | Physical macOS edit/close/reopen/delete remains open |
| Universal outbound delivery | Implemented for web, scheduled/Undo, and ActiveSync; independent spec review found no remaining code-level P1 | Locally green, not deployment-safe yet |
| Backend | 729 tests: 724 pass, 5 documented skips, 0 fail | Green within the tested scope |
| Frontend | 175/175, ESLint, and production build pass | Green |
| Database proof | Isolated MariaDB 11.8.6 migration-twice, concurrency, crash, UTC, privacy, and replay matrix passes | Green without production mutation |
| Browser qualification | 240/240 across Chromium/WebKit desktop/mobile with zero unexpected diagnostics | Deterministic real-browser evidence, not physical Apple-client evidence |
| Repository integration | Complete integration suite passes | Green locally |
| Production dependencies | Backend and frontend report 0 production vulnerabilities | Green at audit time |
| Deployment/rollback | New tree intentionally not deployed | P1 operational blocker: old rollback target is incompatible with new traffic |
| Small-business release | No-go | Reassess after rollback bridge, data gate, and physical clients |
| Enterprise release | No-go | Product, governance, scale, and recovery gaps remain |

## Work completed across all eight cycles

### Cycle 1 — Notes identity and reconciliation

- Reproduced the approved fake SQL/IMAP race instead of using production Notes.
- Serialized each owner's reconciliation in-process and across processes.
- Enumerated complete mailbox identity instead of only the newest 25 messages.
- Added deterministic OMS Message-IDs and convergence after duplicate or
  accepted-but-uncertain appends.
- Fenced delete, import, and export acknowledgements with owner, revision, UID,
  and live-state checks so an older snapshot cannot delete or resurrect a newer
  note.
- Deployed the backend fix through the guarded protocol path. Physical macOS
  confirmation remains a separate gate.

### Cycle 2 — Truthful updates and reversible paired releases

- Removed fabricated/automatic update claims and retired the historical
  passwordless web-to-root upgrade bridge.
- Made the modern application and legacy Admin Portal one locked, reversible
  release unit with validated snapshots and bounded readiness.
- A first live attempt exposed a listener-readiness race. Recovery succeeded;
  the readiness loop was fixed and the old/new pair restore round trip later
  passed public protocol gates.

### Cycle 3 — Protocol, DAV/PIM, startup, and release safety

- Hardened WBXML/ActiveSync parsing, Calendar/Contacts/Notes identity, canary
  attestation and cleanup, startup schema barriers, and runtime quiescence.
- Added exact duplicate calendar-tombstone detection rather than silently
  deleting ambiguous data.
- The guarded production rollout found one real duplicate tombstone pair and
  correctly rolled back. Read-only inspection identified a likely retention
  candidate, but no row was changed without explicit production-data approval.

### Cycle 4 — Mail truth, Draft/Undo integrity, privacy, and honest UX

- Serialized overlapping browser Notes and Draft saves and kept stable IDs.
- Restored complete Draft identity, recipients, Reply-To, body, threading, and
  attachments.
- Made scheduled enqueue, source-Draft cleanup, Cancel/Undo restoration, and
  authoritative returned Draft UID one truthful lifecycle.
- Separated transport MIME from Bcc-preserving Sent/Draft MIME and reported
  partial recipient acceptance honestly.
- Closed owner-scoped upload, free/busy, external-content, sender-identity,
  keyboard, mobile caching, focus, accessible-name, and false-control defects.

### Cycle 5 — Independent audit, browser qualification, and recovery

- Added a fail-closed, checksummed, root-only backup/restore transaction with
  explicit inventory, continuous quiescence, safety snapshot, exact prior
  service restoration, and rollback on failure.
- Qualified Mail, Calendar, Contacts, Notes, Scheduler, Settings, and Admin in
  Chromium and WebKit desktop/mobile fixtures.
- Compared capabilities with Gmail/Workspace, Outlook/Microsoft 365, Yahoo,
  Proton, Fastmail, and Apple using official product documentation.
- The independent architecture pass found the critical web/EAS
  SMTP-before-durable-record crash window and correctly kept the release no-go.

### Cycle 6 — Universal durable outbox

- Reused core `scheduled_emails` rather than creating a second delivery queue.
- Added immediate/scheduled kind, owner-scoped idempotency key, server-computed
  canonical fingerprint, SaveInSentItems, stable Message-ID, complete transport
  and Sent MIME, envelope, leases, recovery state, and owner status projection.
- A durable row commits before SMTP. Same-key/same-fingerprint replay returns
  stored state without SMTP; changed content under the same key fails `409`.
- Request and worker claims race safely. Pre-SMTP work may retry; accepted mail
  reconciles only its Sent copy; post-DATA ambiguity becomes terminal and is
  never automatically resent.
- Routed immediate compose, inline reply, delayed/Undo mail, and strict
  ActiveSync SendMail through the same deep seam.
- Corrected official ComposeMail tokens, ClientId scope, From ownership,
  SaveInSentItems behavior, and transport-only Bcc handling. SmartReply and
  SmartForward stay unadvertised and fail closed.
- Added browser UUID keys, pending/uncertain feedback, bounded status polling,
  and key retention across ambiguous failures.

### Cycle 7 — Persistence, scheduled lifecycle, and second-pass hardening

- Persisted privacy-safe browser attempt records in IndexedDB using UUIDs and
  cryptographic scope/content digests; no subject, body, recipient, or
  attachment bytes enter recovery storage.
- Coordinated concurrent tabs transactionally and recovered by idempotency key
  after reload without reconstructing message content.
- Required keys for every immediate and scheduled request; kept one absolute
  scheduled instant across retries; removed obsolete bypass wrappers.
- Soft-hid and scrubbed owner-removed terminal scheduled rows while retaining
  the dedupe tombstone. Immediate rows cannot appear in or be cancelled through
  the Scheduled folder.
- Classified explicit SMTP 5xx as terminal, 4xx as retryable, and connection
  loss during DATA as uncertain. Stored only bounded diagnostic tokens.
- Changed the worker to claim one row immediately before processing.
- Stripped both Bcc and Resent-Bcc plus folded continuations from ActiveSync
  transport while preserving exact Sent MIME/body bytes.
- The rollback audit found that the installed old runtime is not a safe target
  after new outbox traffic. This became the remaining P1 release blocker.

### Cycle 8 — Independent qualification and late-edge closure

- Independent spec, standards, and real-browser passes attacked replay,
  scheduling, privacy, storage, migration, and recovery boundaries.
- Retained the key after any status-poll error following durable `202`
  acknowledgement; a session expiry, 404, or rollback cannot silently rotate a
  logical send.
- Blocked pending, ambiguous, or uncertain immediate mail from being changed
  into a new scheduled request with a second key after reload.
- Added an explicit verified-non-delivery decision before an uncertain unchanged
  message may rotate to a new attempt. Added in-place status recheck for a
  protected pending attempt instead of requiring a page reload.
- Made IndexedDB open failures retryable and reset cached handles on database
  version changes.
- Scrubbed terminal immediate MIME, envelope, and message metadata while
  preserving only the dedupe/outcome tombstone.
- Added `Cache-Control: no-store` to authenticated outbound status results.
- Fixed the outbox-only timezone boundary: new timestamps are explicit UTC SQL
  strings, keyed projections are explicit UTC, and legacy unkeyed scheduled
  rows retain the historical mysql2 local-wall-clock interpretation without a
  destructive conversion. Legacy retry/lease timestamps remain database UTC.
- Proved exact schedule time under `Pacific/Kiritimati`, immediate timing near
  database UTC, legacy due/not-due behavior, payload scrubbing, and complete
  disposable cleanup.

## Universal outbound contract now implemented

```text
reserve complete row -> claim -> smtp_inflight -> sent_copy_pending
                                             -> completed / partial_delivery
safe pre-DATA failure -> retry_wait -> claim
ambiguous DATA/crash  -> delivery_uncertain (never auto-resend)
terminal rejection    -> failed
```

Important invariants:

- No SMTP attempt occurs if durable reservation fails.
- Owner + key is unique; the server, not the client, computes the fingerprint.
- A replay never creates contacts, resends SMTP, or duplicates a Sent copy.
- Sent-copy retry is distinct from SMTP retry and deduplicates by Message-ID.
- Terminal immediate payload is scrubbed; dedupe identity and outcome remain.
- Scheduled Undo restores the exact payload as a confirmed Draft before queue
  state clears.
- Status routes are owner-scoped and non-cacheable.
- ActiveSync ClientId is scoped by owner and validated DeviceId.

## Verification ledger

Final evidence after all late Cycle 8 regressions:

- Backend build and generated TypeScript/runtime parity: passed.
- Backend complete suite: 729 total, 724 passed, 5 documented skips,
  0 failed.
- Frontend complete suite: 175/175 passed; ESLint and TypeScript/Vite
  production build passed with 3,557 modules transformed.
- Repository integration suite: passed.
- Disposable MariaDB 11.8.6 universal-outbox proof: passed; temporary schema,
  user, server, and datadir were removed.
- Independent focused standards proof: passed.
- Browser qualification: Chromium desktop 59/59, Chromium mobile 61/61,
  WebKit desktop 59/59, and WebKit mobile 61/61: 240/240 total, with zero
  unexpected console errors/warnings, page errors, failed requests, API
  requests, or external requests. See `output/playwright/cycle8/REPORT.md`.
- Backend and frontend `npm audit --omit=dev`: 0 vulnerabilities.
- `git diff --check`: passed.

The root historical lint wrapper still reports pre-existing ShellCheck findings
outside this change when run as a standalone broad lint gate. Changed shell
integration paths pass their executed suite; unrelated installer cleanup was
not folded into this outbound change.

## Known blockers and residual risks

| Severity | Finding | Required closure |
|---|---|---|
| P1 operational | Automatic rollback target can mis-handle new immediate rows and keyed retries | First deploy a rollback-compatible bridge, or quarantine outbound/API/EAS traffic and workers through rollback proof |
| P1 release gate | Existing duplicate production calendar tombstone blocks startup/deploy | Obtain explicit approval for the exact repair, snapshot, repair only the proven row, and rerun guarded forward/rollback gates |
| Release gate | Physical iOS ActiveSync SendMail/retry is unproven | Observe fresh acceptance, lost/retried ClientId behavior, Sent-copy choice, and zero duplicate SMTP |
| Release gate | Original macOS Notes lifecycle is unproven | Repeat edit/close/reopen/delete and inspect one SQL/IMAP identity |
| P2 operations | Universal-outbox tombstone metadata has no bounded archival policy | Define a web/EAS-safe retry horizon and archive/cleanup design without reopening duplicate risk |
| P2 legacy UX | Mixed legacy/local and keyed/UTC rows can sort out of true instant order in the Scheduled folder | Sort on projected instants or add an explicit normalized sort key; delivery eligibility is already correct |
| P2 recovery | No clean-host install/restore drill | Prove packages, service state, restore, RPO/RTO, off-host retention, and rollback on a disposable host |
| P2 protocol | A pre-network process crash after `smtp_inflight` is conservatively uncertain | Deepen the SMTP transaction boundary only with evidence that cannot cause resend after DATA |
| P2 protocol | No authenticated HTTP-to-database-to-SMTP ActiveSync canary yet | Add a disposable end-to-end EAS SendMail harness, then physical client proof |
| Feature gap | True conversations, shared/delegated mailboxes, cross-account Notes ACLs, Tasks UI, rooms/resources | Deliver as bounded product slices after release correctness gates |
| Enterprise gap | SSO/SCIM, domain RBAC, enforced MFA/WebAuthn policy, legal hold/retention/DLP, guided migration, offline/PWA | Multi-release enterprise roadmap; do not market these as implemented |

## What went wrong during the eight cycles

- “Repeat until there are no bugs” is not a falsifiable engineering exit
  condition. Each deeper independent pass found a real edge. The responsible
  stop condition is zero known P0/P1 defects plus complete release evidence.
- Competitor-parity feature work was displaced by correctness work. That was the
  right safety choice, but conversations, delegation, enterprise identity,
  compliance, migration, and offline capability remain unfinished.
- The first live paired release exposed a listener-readiness race; recovery
  worked, and the readiness contract was corrected.
- The guarded Cycle 3 rollout exposed pre-existing production data ambiguity.
  The gate worked, but the unresolved tombstone prevented later deployment and
  physical validation.
- The original immediate-send design treated SMTP success and durable recovery
  as separate after-the-fact operations. The independent Cycle 5 pass correctly
  rejected that architecture.
- Source and generated JavaScript briefly diverged during parallel changes.
  Generated-runtime parity caught it; every final backend build regenerates and
  verifies the deployed JavaScript.
- Several first-pass tests asserted source formatting instead of behavior.
  Those brittle checks were corrected or supplemented with runtime proofs.
- A four-browser concurrent Cycle 5 run made one three-second timer miss a
  500 ms margin under CPU contention. Its isolated rerun passed; the event was
  recorded rather than hidden.
- Cycle 8 found a host-timezone defect only after testing a far non-UTC zone.
  The first UTC fix would have misread historical queued rows; a second
  migration pass found that and added dual-basis compatibility.
- Browser fixtures and Playwright WebKit are valuable but do not substitute for
  physical Apple Notes or iOS ActiveSync retry behavior.

## Recommended next release sequence

1. Build and deploy an expand/contract bridge that understands
   `submission_kind`/`removed_at`, processes scheduled rows only, and rejects
   keyed retries instead of direct-sending them. Prove it as the rollback target.
2. Obtain approval for the exact calendar-tombstone repair and execute the
   guarded repair/forward/rollback sequence with snapshots and zero residue.
3. Enable the universal outbox in a bounded canary, then test network loss,
   worker restart, status replay, partial delivery, and rollback.
4. Complete physical iOS SendMail/retry and macOS Notes lifecycle evidence.
5. Run a clean-host restore drill and design bounded outbox tombstone archival.
6. Re-run the complete product/browser/protocol matrix and issue a new go/no-go.

## Final release position

OpenMailStack is now a serious FOSS suite with a much stronger Notes, Draft,
mail-delivery, privacy, and recovery foundation than at the start. The
repository's largest known duplicate-send defect is closed locally. It is not
yet safe to ask a small business to depend on this build, because its rollback
path and physical-client evidence are incomplete. It is substantially short of
enterprise procurement requirements. Keep the last known-good production pair
until the ordered release sequence above is complete.
