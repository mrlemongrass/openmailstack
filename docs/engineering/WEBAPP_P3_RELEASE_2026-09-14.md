# WebApp P3 workflow release — 2026-09-14

Scope: the three P3 rows in `WEBAPP_POWER_USER_REVIEW_2026-09-14.md`. Implementation and scripted checks are complete; guarded live release proof is recorded below.

## Delivered behavior

| Workflow | Result and boundaries |
|---|---|
| Junk / Trash schedules | Settings → Junk & Trash cleanup. Off by default; choose periods, preview exact folders/counts, and explicitly confirm. Junk moves to Trash; Trash deletion is permanent. Stop cancels after the current batch. |
| Safe residence age | First observation in the folder starts the clock, including existing mail. Original message dates never cause immediate deletion. Re-enabling resets grace. Moved Junk gets a fresh Trash grace period. |
| Bounded cleanup | Hourly eligibility, at most 10,000 messages per folder and 100 per mutating batch. Requires unique special-use folders and UIDPLUS. Folder path and UIDVALIDITY are checked again before writes. Interrupted or unacknowledged operations stop automatic cleanup and require review. |
| Cleanup history | Last 50 entries / 90 days, confirmed move/delete counts, selected periods, cancellation and uncertainty. An uncertain batch can have acted beyond its confirmed count. |
| Account lifecycle | Consent, observations and both histories cascade with mailbox deletion, including legacy admin paths. A per-batch account lock and immutable policy generation prevent a running job from continuing against a recreated address. All writes under the account lock use the same database connection. |
| Activity | Activity & health in desktop navigation and mobile More. Last 100 recorded web actions / 30 days, app and attention filters, pending/accepted/completed/failed/uncertain states and links to scoped recovery. Recovery never blindly repeats a mutation. Fixed labels only; no request bodies, subjects, sender addresses, note titles or raw errors are retained. |
| Sync health | Independent server checks for Mail, Calendar, Contacts, Notes and Scheduler. Separate observations show available ActiveSync exchange timestamps, calendar subscription freshness/failure and booking-workflow backlog. Unknown remains explicit where durable observation is unavailable, including Notes device sync. A successful storage check never claims a phone is synchronized. |
| Large collections | Notes renders 60 cards per page with keyboard controls, full-set search and page reset. Contacts now constrains the mobile virtual viewport instead of rendering all 3,000 cards. |
| Accessibility / reflow | Named Notes sort control, larger mail/contact targets, usable Notes navigation, Calendar grid row semantics, stronger Today/badge contrast, small-screen toolbar wrapping, header reflow, operating-system reduced motion and forced-color focus styling. |

Schema migration 028 creates four additive tables. Runtime schema setup aligns ownership columns with the install's existing mailbox collation (including legacy latin1) and adds ON DELETE CASCADE foreign keys. No account is opted in by migration or deployment. Existing customer messages are not used for destructive validation.

## Verification method

Browser data is synthetic: 10,000 messages, 500 long-named project folders plus Inbox/Junk/Trash, 3,000 contacts, 3,000 notes and 120 calendars. Desktop 1440px and narrow 320px checks cover Mail, Calendar, Contacts, Notes, Scheduler, cleanup settings and Activity. Browser automation runs Chromium against the local development build; it does not measure real-account network or IMAP latency.

After the rendering fixes, desktop Contacts rendered 33 cards and phone Contacts 9; Notes rendered 60 in both. All seven screens had no horizontal document overflow or clipped tested headings/controls at 320px. DOM-ready samples included a fixed one-second stabilization wait and therefore are not presented as paint latency or a production performance SLA.

The 320 CSS-pixel reflow check follows the [WCAG reflow criterion](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html); it is not a claim of a physical browser zoom test. Automated axe-core 4.13.0 checks use WCAG 2 A/AA, 2.1 AA and 2.2 AA rules, including [target size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html). Manual keyboard checks address [focus visibility/obscuration](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum.html). Automated contrast results marked incomplete require human inspection; zero automated violations alone would not establish WCAG conformance.

Disposable MariaDB tests use a restricted, temporary schema and a controlled IMAP adapter. They cover opt-in, wrong-owner/replayed previews, full grace, new arrivals, moved Junk grace, disabling/re-enabling, changed UIDVALIDITY, lost acknowledgements with no automatic replay, batch cancellation, crash recovery, missing UIDPLUS, deletion during an active batch, account recreation and history isolation. The database and restricted user are removed afterward.

Independent Standards and Spec reviews identified and resolved account lifecycle/locking, actual route coverage, response-level uncertainty and missing sync observations. Unit regressions cover real bulk/import/send response shapes, including HTTP 200 with failed, partial or uncertain delivery.

## Remaining verification boundary

A physical screen-reader session and physical touch-device/browser zoom confirmation cannot be performed in this server-only environment. Those human acceptance checks remain open; this report does not certify full accessibility conformance. Notes/device synchronization is explicitly unknown when no durable server observation exists. History begins with this release and covers the documented web workflows rather than all protocol or legacy-admin activity.

## Release proof

- Full frontend suite: **289 passed**. Full backend suite: **1,032 passed, 11 gated skips**. The two P3 database tests also passed separately against disposable MariaDB, with cleanup confirmed.
- Frontend lint and both builds passed. A focused Notes regression passed again after the final pagination stacking fix.
- axe-core 4.13.0: all seven audited screens clear of automated violations at 1440px and 320px, with the final Notes rescan recorded separately. Contrast checks marked incomplete remain a manual acceptance boundary.
- Browser checks passed cleanup preview/cancel/duplicate-confirm/rejection/retry/stop, activity filtering and scoped recovery, health failure retaining history, keyboard Notes pagination and full-set search, bounded desktop/mobile Contacts, forced-colors focus and reduced-motion media, and header fit at 768/1024/1280px.
- Single-run local browser samples: Notes search to a result near the end of 3,000 records took **80 ms**; keyboard page advance took **1,280 ms**, including browser automation focus/key processing. These are development-fixture observations, not production latency guarantees.
- Evidence: `/tmp/oms-p3-backend-full.log`, `/tmp/oms-p3-frontend-full.log`, `/tmp/oms-p3-db-final.log`, `/tmp/oms-p3-flows3.log`, `/tmp/oms-p3-baseline5.log`, `/tmp/oms-p3-axe2.log`, `/tmp/oms-p3-notes-axe2.log`, and screenshots under `output/playwright/p3/`.

Guarded deployment pending.
