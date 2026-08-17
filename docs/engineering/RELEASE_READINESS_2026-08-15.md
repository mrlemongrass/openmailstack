# OpenMailStack Release Readiness — Cycle 13 Addendum

Original assessment: 2026-08-15

Current addendum: 2026-08-17

Decision: **NO-GO for a paid-quality small-business or enterprise release.**

The eight-cycle hardening run closed the reported Notes duplication class and
the previously release-blocking outbound crash window in the repository. Web,
delayed/Undo, and ActiveSync mail now share a durable, idempotent outbox; the
browser can recover logical sends across tabs, reloads, network ambiguity, and
delivery-mode changes; and the migration/crash/timezone/privacy contract passes
on isolated MariaDB.

Cycles 9-12 closed the former deployment blockers. A verified full logical OMS
backup preceded the approval-pinned calendar repair; tombstone 23 was retained,
22 was archived and removed, and the unique invariant now holds. Production was
then moved through an attested total-quarantine bridge into active universal
outbound delivery. Public IMAPS, ActiveSync Mail/Contacts/Calendar, three-class
Ping wake and Sync, deletion non-wake, 60-second renewals, and one 900.080-second
Ping heartbeat all passed with zero canary residue or service restart.

The integrated `main` branch goes further than the installed runtime: it adds a
privacy-minimal replay registry, disabled-by-default verified compaction, exact
mixed-time-basis ordering, a real authenticated ActiveSync SendMail
HTTP-to-database-to-SMTP test, and the clean-host recovery drill. Physical iOS
SendMail retry, the original macOS Notes lifecycle, the on-screen/network-
transition Direct Push matrix, the physical macOS CardDAV identity edit/merge
retry, and a full off-host/
mutating-install recovery exercise remain open. “All tests green” is therefore
still not being misreported as “shippable.”

## Executive scorecard

| Area | Result | Release interpretation |
|---|---|---|
| Reported Notes duplicate | SQL/IMAP and overlapping web-save races fixed; original Notes backend fix is deployed | Physical macOS edit/close/reopen/delete remains open |
| Universal outbound delivery | Active in production for web, scheduled/Undo, and ActiveSync; integrated registry expansion is locally verified | Delivery path deployed; compaction remains disabled pending registry-compatible rollback proof |
| Backend | 786 tests: 779 pass, 7 documented opt-in skips, 0 fail | Green within the tested scope |
| Frontend | 175/175, ESLint, and production build pass | Green |
| Database proof | Four isolated MariaDB proofs cover migration, ordering, registry retention, real EAS HTTP durability, and exact tombstone repair | Green; temporary servers and trees removed |
| Browser qualification | 240/240 across Chromium/WebKit desktop/mobile with zero unexpected diagnostics | Deterministic real-browser evidence, not physical Apple-client evidence |
| Repository integration | Complete integration suite passes | Green locally |
| Production dependencies | Backend and frontend report 0 production vulnerabilities | Green at audit time |
| Deployment/rollback | Verified backup, exact repair, guarded bridge, active release, hotfix bridge/active round trip, runtime attestation, and an inert durable-row production rollback canary passed | Current active/bridge pair is proven; registry compaction still waits for a registry-compatible installed rollback pair |
| Small-business release | No-go | Reassess after the physical Apple-client matrix and full recovery exercise |
| Enterprise release | No-go | Product, governance, scale, and recovery gaps remain |

## Cycles 9-13 addendum — bridge, repair, registry, Direct Push, and rollback

- `webmail-bridge` is a total fail-closed outbound pause: new web/scheduled
  submissions receive `503`, ActiveSync SendMail returns
  `MailSubmissionFailed`, workers perform no database claim/lease work, and
  scheduled cancellation/removal cannot mutate rollback-visible rows.
- Active deployment requires the live rollback target to be exactly the
  attested bridge. A failed active deployment restores and re-attests that
  exact bridge mode before recovery can be called successful.
- The only markerless legacy recovery is the exact snapshot recorded during
  the first bridge attempt. Environment and runtime bytes must match after
  restore; arbitrary, active, or altered markerless states fail closed.
- Deployed code and ancestry are root-owned and non-writable by the service,
  while only uploads remain writable. The mode file and marker are root-only;
  runtime symlinks must remain inside protected code and outside uploads.
- The confirmed regression reserves a durable immediate row in active mode,
  retries the same key under bridge, and runs the worker. The row, state,
  payload, and key remain byte-identical with zero claim, SMTP, IMAP,
  authorization, or acceptance side effect.
- Final local evidence: backend 737 total / 732 pass / 5 skips / 0 fail,
  disposable MariaDB 1/1, full repository integration green, affected guarded
  restore/release and shell checks green, and both independent review axes
  clean at the fixed point.

Cycle 10 guarded-deployed the bridge and active runtime after a root-only,
checksummed backup and the exact approved calendar repair. The current live
runtime is `active`, its code/environment attestation passes, the repair
approval is absent, all relevant services report zero restarts, and the outbox
was empty at final attestation. Cycle 13 later completed the separately
authorized synthetic durable-row production canary described below.

Cycle 11 added the replay registry, bounded retention policy, exact mixed-basis
ordering, real ActiveSync SendMail HTTP seam, and a clean Debian 13 recovery
drill. Registry compaction stays disabled unless explicitly set to
`registry-verified-v1`; these integrated-main additions have not yet replaced
the active production runtime.

Cycle 10 also closed the ItemOperations, CardDAV, and CalDAV release-gate
failures. Cycle 12 implemented bounded ActiveSync Ping/Direct Push. The first
public long gate exposed a heartbeat-edge poll race (Status 8 at 60 seconds),
and the second exposed the smoke client's independent 300-second Undici header
timeout. Both were reproduced deterministically and fixed. The final public
gate returned Status 1 after 900.080 seconds and completed with zero protocol
canary residue.

Cycle 13 completed the exactly approved production rollback proof. Fresh
root-only backup `/var/backups/openmailstack/oms-backup-20260817T215021Z`
passed the complete trusted validator. One inert immediate row with a
far-future lease was inserted, captured as a canonical 30-column digest, and
observed through an active worker interval. Restoring the exact bridge snapshot
left that digest byte-identical and produced zero canary-specific journal,
mail-log, or Postfix-queue matches. The row was then deleted exactly once under
bridge using its captured ID and full approved state/payload predicate. The
automatically captured active preimage was restored, runtime/environment
attestation passed, the outbox returned to zero, all relevant services retained
zero restarts, and the explicit Ping-required public suite passed. Root-only
checksummed evidence is retained at
`/var/backups/openmailstack/outbound-rollback-canary-20260817T213124Z-1fc49e9b2c64`.

## Work completed across Cycles 1-13

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

Final evidence after the Cycle 12 integration:

- Backend build and generated TypeScript/runtime parity: passed.
- Backend complete suite: 786 tests, 779 passed, 7 documented opt-in skips,
  0 failed.
- Frontend complete suite: 175/175 passed; ESLint and TypeScript/Vite
  production build passed with 3,557 modules transformed.
- Repository integration suite: passed after the final merge, including every
  protocol, deployment, rollback, backup/restore, security, and dry-run gate.
- Disposable MariaDB proofs passed for legacy outbox migration/races, replay
  registry retention/compaction, authenticated EAS SendMail durability, and
  approval-pinned calendar repair; temporary servers and trees were removed.
- Clean Debian 13 backup/verify/restore and injected rollback drill passed with
  exact service-state recovery and zero controlled fixture transactions lost.
- Independent final Spec review found no code blocker. Standards review found
  only stale release documentation as a hard issue; this addendum closes it.
- Public production gate passed mail, contacts, calendar, deletion non-wake,
  60-second full/bodyless renewals, and a 900.080-second Ping heartbeat with
  zero restarts and zero canary residue.
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
| Closed live | Legacy automatic rollback could mis-handle immediate rows/keyed retries | Bridge-first release is deployed and every later rollback target is universal-outbox-aware or total-quarantine; never restore unmarked legacy snapshots |
| Closed live | Duplicate production calendar tombstone blocked startup | Verified backup plus approval-pinned repair retained 23, archived 22/23, removed only 22, and left zero duplicate groups |
| P1 release evidence | Physical Direct Push matrix is incomplete | Confirm on-screen idle renewal, mail/contact/calendar wake+Sync, sleep/wake, Wi-Fi/cellular transition, and restart/reconnect on an owned iPhone/iPad |
| Closed live | No production durable-row rollback evidence | An exactly approved inert immediate row survived active-to-bridge byte-for-byte with zero claim/SMTP/IMAP evidence, was deleted once under bridge, and active plus the Ping-required public suite were restored |
| Release gate | Physical iOS ActiveSync SendMail/retry is unproven | Observe fresh acceptance, lost/retried ClientId behavior, Sent-copy choice, and zero duplicate SMTP |
| Release gate | Original macOS Notes lifecycle is unproven | Repeat edit/close/reopen/delete and inspect one SQL/IMAP identity |
| Release gate | macOS CardDAV identity edit/merge retry is unproven | Edit the UUID-backed contact, merge only the known legacy duplicate, and confirm one stable href/UID with no re-created row |
| Rollout gate | Bounded universal-outbox retention is implemented and disposable-database verified | Keep compaction disabled until the installed rollback runtime is registry-compatible; then opt in only with `registry-verified-v1` |
| Closed locally | Mixed legacy/local and keyed/UTC Scheduled ordering | Project both bases to real instants for list and global worker claim order; do not rewrite historical DATETIME values |
| P2 recovery | Clean-host recovery semantics are proven, but not a full production-scale rebuild | Add a full mutating install plus realistically sized second-host/off-host restore, DNS/TLS, and mail-flow exercise |
| P2 availability | Full logical backup keeps services quiesced while copying and hashing the production mail tree | Split immutable snapshot finalization/verification from the quiesced capture window, then measure the reduced outage and preserve the existing fail-closed recovery contract |
| P2 protocol | A pre-network process crash after `smtp_inflight` is conservatively uncertain | Deepen the SMTP transaction boundary only with evidence that cannot cause resend after DATA |
| Closed locally | No authenticated HTTP-to-database-to-SMTP ActiveSync harness | Disposable WBXML/Basic-auth/MariaDB/SMTP/Sent-copy proof now covers first send, replay, changed MIME, auth, malformed input, and bridge quarantine |
| Feature gap | True conversations, shared/delegated mailboxes, cross-account Notes ACLs, Tasks UI, rooms/resources | Deliver as bounded product slices after release correctness gates |
| Enterprise gap | SSO/SCIM, domain RBAC, enforced MFA/WebAuthn policy, legal hold/retention/DLP, guided migration, offline/PWA | Multi-release enterprise roadmap; do not market these as implemented |

## What went wrong during the twelve cycles

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
- The first production bridge transition could not satisfy the user's exact
  repair approval because the generic migration was not ID/hash/timestamp-
  pinned. An approval manifest and serializable full-table/event lock boundary
  were added before the live mutation.
- Ping was intentionally fail-closed at 501 until its cache, folder ownership,
  add-only wake semantics, cancellation, and resource bounds were complete.
  The first active gate then found a poll starting at the heartbeat deadline;
  Status 8 was correct for a truly hung probe but wrong for a newly launched
  boundary probe.
- The next 900-second gate failure was not the server: Node's global Fetch
  client had a separate 300-second response-header timeout. The test harness
  now owns explicit finite header/body ceilings above its AbortSignal deadline.
- The Cycle 13 production backup finished its checksums but initially refused
  promotion because the backend needed six seconds to listen after systemd
  reported it active. The snapshot stayed visibly incomplete, services
  recovered, and no canary row existed. A bounded readiness loop is now
  regression-backed; the exact staging tree then passed the full trusted
  validator and was atomically promoted. The run also exposed an unacceptably
  long service-quiescence window while the large mail tree is copied and
  repeatedly hashed.

## Recommended next release sequence

1. Complete physical iOS SendMail/ClientId retry, Direct Push idle/wake/network/
   restart behavior, the macOS CardDAV identity edit/merge retry, and the
   original macOS Notes edit/reopen/delete lifecycle.
2. Reduce the full-backup quiescence window by finalizing and verifying the
   immutable staging tree after services resume; preserve exact-state recovery
   tests and remeasure production-scale outage.
3. Deploy the integrated registry expansion through the already-proven bridge
   sequence. Keep compaction disabled until that installed rollback pair reads
   registry tombstones, then enable only `registry-verified-v1` under a bounded
   maintenance/scale canary.
4. Complete a mutating clean install and realistically sized off-host restore,
   including DNS/TLS, mail flow, and recovery-time/capacity evidence.
5. Re-run the complete authenticated product/browser/physical-client matrix and
   issue a fresh small-business go/no-go.

## Final release position

OpenMailStack is now a serious FOSS suite with a much stronger Notes, Draft,
mail-delivery, privacy, and recovery foundation than at the start. The
repository's largest known duplicate-send defect is closed and its bridge-first
delivery runtime is active. It is not yet responsible to call the release
small-business ready because the physical Apple-client and full off-host
recovery evidence is incomplete, and the production-size backup still has an
excessive quiescence window. It remains
substantially short of enterprise procurement requirements. Keep the attested
active/bridge snapshots and compaction disabled until the ordered sequence above
is complete.
