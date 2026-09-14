# P1 QoL acceptance — 2026-09-14

Scope: the six P1 findings in the power-user review, plus message-context Create
rule / Add to existing rule. Synthetic accounts and fixtures only. No customer
mail was used for mutation testing.

## Implemented behavior

- Reading uses the saved right/bottom/off pane, mail-specific density, snippets,
  grouping, read delay and external-image policy. Grouping follows Message-ID
  relationships within loaded folder messages; it does not merge by subject or
  claim to load a complete server-side conversation.
- Logout is a guarded route. The session request starts only after editor
  navigation succeeds. Compose and Notes save before leaving; manually saved
  editors require an explicit discard decision. Inline replies are also guarded.
  Failed logout retains local session state and offers retry.
- One active sender-policy editor manages exact sender/domain blocks and safe
  exceptions. Exact sender choices override domain choices. Legacy entries require
  selection and confirmation. Safe choices bypass only the managed Junk rule;
  normal rules and server security still apply. Trusted remote images use active
  safe addresses, never safe domains or unactivated legacy entries.
- Settings dependencies load independently. Scoped retry cannot overwrite a
  successfully loaded namespace or its pending edits. Rule saves have a duplicate
  lock and revision check so newer edits cannot be reported saved accidentally.
- Scheduler event, profile, availability, workflow and tool forms retain edits on
  failures, lock pending writes, and guard navigation/reload. Destructive actions
  have named confirmations. Booking retries retain the same idempotency key.
  Poll/import uncertainty explicitly asks users to refresh and reconcile before
  retrying. Private-link options are not silently discarded by an event save.
- Message context shortcuts prefill an exact sender and reuse the rule editor.
  Extending an exact sender condition creates an address alternative while
  preserving ALL restrictions and actions. Ambiguous ALL rules require a separate
  rule or an explicit edit in Settings. Saving changes only the reviewed rule,
  detects stale edits, preserves other rules/vacation/policy, and reconciles
  identical retries. Existing mail changes only through saved preview and apply.

## Mutation acceptance matrix

This matrix groups operations by their shared persistence/recovery contract. It
records automated contract coverage plus the browser flows exercised for this
release; it is not a claim that every permutation was manually exercised.

| Operation family | Success and persistence | Rejection / uncertain response | Duplicate requests | Navigation / refresh |
| --- | --- | --- | --- | --- |
| Compose send, draft save/discard, scheduled actions | Existing outbound and draft suites; MIME/draft round trips in release gate | Delivery-uncertain and partial outcomes retain protected attempt; draft failures retain edits | Send-attempt and draft coordinators | Guarded logout; save/close awaits refresh; beforeunload warning |
| Inline reply | Existing reply/outbound suites | Protected uncertain send retained | Reply action lock | Pending text guards leaving; successful expansion transfers text to Compose |
| Mail move/delete/spam/unblock/folder cleanup | Mail action API and folder identity suites | Partial policy/move outcomes and folder refresh recovery | Owner lock; idempotent policy entries; scoped cleanup | After-action navigation follows displayed order; empty reader recovery |
| Reading / appearance / identity settings | HTTP PUT/GET against disposable MariaDB; all pane choices round-trip | Save queue and independent dependency recovery tests | Serialized namespace save queue | Pending save protects routes; retry Rules leaves Mail edits intact; browser pane/density/snippet/group checks |
| Active sender policy / legacy activation | API-to-Sieve metadata tests; real sieve-test delivery simulation | Failed script activation retains saved rules/message; UI retains input | Owner lock and idempotent same choice; browser double-click check | Browser pending-input logout cancellation; mobile layout; explicit reload to reconcile |
| Create / append message rule | HTTP fixture exercises actual API-to-Sieve save; real Sieve address-list evaluation | 409 stale rule, 400 malformed list/managed ID, failed write preserved | Identical retry reconciled; browser duplicate click submits once | Browser cancel navigation retains review; saved-only optional preview |
| Calendar event/invitation/subscription | Existing Calendar route, identity, invitation and recurrence suites; protocol gate round trip | Transaction/conflict and invitation failure tests | Event/invitation identity and action locks | Existing editor guard now precedes session invalidation; physical client confirmation remains separate |
| Contacts create/edit/delete/import | Contact identity, transaction, activity and CardDAV/ActiveSync suites | Rollback/revision/ownership tests | Stable identity/transaction tests | Existing editor guard now precedes logout; no new contact deletion semantics |
| Notes save/delete/reminder/attachment | Notes API/IMAP sync/coordinator suites | Revision conflict and failed save keep note open | Save coordinator and close promise | Persistent guard survives editor close while refresh finishes; beforeunload warning regression |
| Scheduler event/private links | Disposable MariaDB lifecycle; browser saved event readback | Browser rejected event save retains fields; link options remain open | Browser double submit produces one write | Named discard and delete cancellation; aggregated editor guard |
| Scheduler profile / availability | Disposable MariaDB lifecycle/profile/availability; browser profile and availability readback | Browser rejected profile/availability saves retain fields; availability validation tests | Pending form lock; browser profile/availability double click | Browser logout cancellation makes no logout request; browser hidden Availability draft remains protected across tabs |
| Scheduler booking/approval/outcome/cancel/poll/workflow | Full disposable MariaDB lifecycle including replay, concurrency, poll finalization, workflow and authorization tests | Named confirmation, caught failure and reconcile notice; existing lifecycle failures/rollbacks | Booking attempt key; mutation refs; DB idempotency/concurrency tests | Scheduler root waits for active mutations and protects unpublished forms; refresh reloads authoritative state |
| Logout itself | Route mounts after navigation permission | Browser 503 keeps session and offers retry | Local in-flight ref | No logout request before discard/save decision; browser returns to Mail after rejected logout |

## Evidence

- Frontend suite: 283 passing tests, followed by focused regression checks for the
  final Notes guard and legacy rule-default changes. Production build and lint passed.
- Backend suite: 1,020 passed, eight opt-in tests skipped in the ordinary run.
  The Scheduler database lifecycle and new Settings HTTP/database test were also
  enabled separately: **2/2 passed**, using all migrations in a disposable schema.
  The schema and its restricted database user were removed afterward.
- `tests/integration/run.sh`: passed, including protocol/restore safety fixtures.
- Real `sieve-test`, without execution mode: safe exact sender through domain
  block goes to Receipts only when subject matches; blocked sender goes to Junk;
  safe sender with other subject and unrelated domain remain in Inbox.
- Browser artifacts under `output/playwright/p1/`: right/bottom/off reading
  panes, rule preview, Scheduler confirmation, logout failure, mobile sender
  policy. API routes were intercepted with synthetic state and deliberate 503s.
  Browser console failures corresponding to those injected 503s are expected.
- Implementation `cfd1599a` is live. Both bridge and active protocol gates passed,
  including post-deploy Ping and canary cleanup. Independent live health checks
  passed; all 57 frontend files and seven changed backend runtime files match
  the build. Public assets and active outbound mode were verified. Rollback
  snapshot paths and release limitations are recorded in WORKLOG.

## Remaining product scope

P2/P3 remain in the review: whole-search selection, keyboard/list navigation,
Junk bulk-menu parity, Notes Trash/accessibility, independent composer windows,
inline images/tables, sort/filter controls, migration onboarding, retention and
activity history. Complete server-side conversation expansion is also separate
from grouping already loaded messages. The message-rule shortcut part of the
former P2 organization item is included in this release.
