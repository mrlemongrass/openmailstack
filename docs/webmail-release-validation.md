# Webmail Release Validation

Use this as the release gate for the modern webmail stack. Local checks prove the repo builds; staging checks prove the installed system behaves like production.

## Local Gates

Run from the repo root:

```bash
rtk bash ./tests/lint/run.sh
rtk bash ./tests/integration/run.sh
rtk npm --prefix webmail-backend test
rtk npm --prefix webmail-backend run build
rtk npm --prefix webmail-frontend run lint
rtk npm --prefix webmail-frontend run build
```

Expected frontend build shape:

- A main `index-*.js` chunk below 500 kB minified.
- A separate rich-editor chunk for compose.

Current scripted snapshot, 2026-07-11:

- Pass: `rtk bash ./tests/lint/run.sh` bash syntax checks passed; shellcheck was not installed.
- Pass: `rtk bash ./tests/integration/run.sh` passed, including the ActiveSync mail smoke guard.
- Pass: `rtk npm --prefix webmail-backend test` passed 14/14 backend tests.
- Pass: `rtk npm --prefix webmail-backend run build` completed TypeScript compilation.
- Pass: `rtk npm --prefix webmail-frontend run lint` exits 0 with zero warnings.
- Pass: `rtk npm --prefix webmail-frontend run build` completed with no Vite chunk-size advisory. The current main chunk is `224.12 kB`; the largest route chunk is `481.41 kB`.

Rspamd hardening snapshot, 2026-07-14:

- Pass: Backend suite completed 93/95 with two optional database tests skipped; frontend lint, 13/13 tests, and production build passed. The largest route chunk is 489.28 kB.
- Pass: Functional health completed a normal-worker scan on `11333`, a real Milter transaction on `11332`, and worker-generation checks without replacement or fatal signals.
- Pass: Recovery tests cover failures within and between probes, systemd crash restarts, controlled restart baselines, three-failure threshold, 15-minute cooldown, and reset.
- Pass: Live systemd timer, map timestamp stability, artifact equality, controlled Rspamd restart, empty Postfix queue, and full staging smoke passed.

Calendar interoperability preflight and guarded test release, 2026-07-20:

| Area | Status | Evidence |
| --- | --- | --- |
| RFC 5545 time semantics | Pass locally | Backend and frontend golden vectors cover UTC, `Asia/Baghdad`, floating, all-day, New York spring gap/fall overlap, and zoned recurrence. Gap/overlap resolution is deterministic and a parsed end that would not follow its start falls back to the event duration instead of creating a zero/negative event. |
| Reversible CalDAV | Pass locally | An in-memory Express lifecycle sends an Apple-style Baghdad VEVENT through create, HEAD, byte-for-byte GET, stale `If-Match` rejection, conditional update, and DELETE. The PUT ETag is stable on immediate HEAD/GET, and the deleted resource returns 404. No real calendar or mailbox is used. |
| ActiveSync Calendar | Pass automated; physical DST pending | iOS-shaped timed/all-day payloads and simple daily/weekly/monthly/yearly recurrence convert to/from iCalendar. The 172-byte binary origin `Timezone` value round-trips fixed Baghdad plus DST-observing New York, Microsoft Pacific, and Windows Central fixtures while retaining local wall time. |
| Scheduler | Pass locally | Existing availability tests skip DST gaps, return both overlap instants, and project the same slots into Baghdad, Phoenix, and Tokyo while preserving buffers, notice, and midnight boundaries. |
| Chromium/WebKit | Pass locally | Real Chromium and WebKit desktop/mobile runs render `2026-07-24T17:00:00Z` as `8:00 PM - 9:00 PM` in Home `Asia/Baghdad`, preserve the instant when converting to Phoenix, confine the current-time line to the current day, and exercise System/Home plus the keyboard clock toggle with no unexpected page/console errors. Screenshots are under ignored `output/playwright/`. |
| Full repository gates | Pass | Backend 133 total: 130 pass and three expected optional database skips; frontend 28/28; ESLint; TypeScript/Vite production build; shell syntax; full integration; focused EAS tests; independent Standards/Spec reviews; and `git diff --check` pass. The authenticated Calendar route smoke skipped because no smoke credentials were supplied. |
| Named Apple clients | Partial pass | macOS 26.5.2 CalDAV single-event create/edit/delete and four-occurrence New York DST projection passed. Physical iOS ActiveSync DST recurrence remains open. |

Production rollout decision: guarded test release deployed; broad completion remains on hold. Root-only rollback snapshot `/var/backups/openmailstack/calendar-timezone-20260720T150815Z` contains the complete pre-release backend source and web root. Deployed backend runtime files match the tested repository, direct/public ActiveSync `OPTIONS` return `200`, public web returns `200`, unauthenticated `/api/auth/me` returns `401`, Nginx and services are healthy, post-restart journal review is clean, and full staging smoke passes. Physical macOS Calendar CRUD and DST projection now pass; complete the physical iOS ActiveSync DST recurrence row before marking Track T complete.

## Clean VM Gate

Run a fresh install on each supported OS family before release:

- Debian 12 or 13.
- Ubuntu 24.04 LTS.
- Rocky/Alma/RHEL 9.

For each VM:

1. Run `setup_config.sh`, then `install.sh`.
2. Confirm `openmailstack.service` is active.
3. Confirm `/etc/openmailstack/webmail-backend.env` exists with `0600` root ownership.
4. Confirm Nginx serves `https://mail.<domain>/` and keeps Roundcube at `/webmail`.
5. Confirm `/api/auth/me` returns 401 when unauthenticated and succeeds after web login.

## Client Matrix

Do not mark a real-device row as passed until the named client has completed
the listed account setup and round-trip checks against a real mailbox. The
scripted smoke checks below are useful preflight coverage, but they are not a
substitute for Apple, Android, or Thunderbird client behavior.

### Live Server Preflight

Last checked: 2026-07-20 against `mail.housevo.us`.

| Area | Status | Evidence |
| --- | --- | --- |
| Core services | Pass | `staging_smoke.sh ./config.conf` confirmed `nginx`, `mariadb`, `postfix`, `dovecot`, `rspamd`, `openmailstack`, `redis-server`, and `clamav-daemon` active. |
| Public listeners | Pass | `staging_smoke.sh ./config.conf` confirmed TCP 25, 80, 443, 587, 993, backend port 20000, and optional 995 listening. |
| TLS names | Pass | Local TLS check confirmed certificate SANs for `mail.housevo.us`, `autodiscover.housevo.us`, and `webmail.housevo.us`; expires 2026-10-05. |
| Public DNS | Pass | External DNS lookup confirmed `housevo.us` MX points to `mail.housevo.us`; `mail`, `autodiscover`, and `webmail` resolve to the public server address. |
| Web routes | Pass | `/` returns 200; `/api/auth/me` returns 401 unauthenticated; Roundcube `/webmail/` returns 200. |
| ActiveSync preflight | Pass | `OPTIONS /Microsoft-Server-ActiveSync` returns 200 and advertises EAS 14.0/14.1 commands. |
| Calendar timezone test release | Pass operationally | The deployed EAS adapter and timezone codec match the tested repository artifacts; fixed/DST fixtures pass locally, and direct/public `OPTIONS`, web/auth boundaries, Nginx, services, post-restart logs, and full staging smoke pass. Physical Apple-client rows remain separate. |
| Autodiscover | Pass | `autodiscover.housevo.us` returns MobileSync URL `https://mail.housevo.us/Microsoft-Server-ActiveSync`. |
| SMTP submission health | Pass | Live submission port returns `220 mail.housevo.us ESMTP Postfix (Debian/GNU)` within the Admin health probe's 8s timeout. |
| Rspamd filtering health | Pass | The one-minute monitor completes both a normal-worker scan and real Postfix-path Milter transaction, persists cross-probe worker generations, and rate-limits Rspamd-only recovery. Repeated post-deploy probes added zero fatal signals. |
| CalDAV/CardDAV preflight | Pass | `/.well-known/caldav` and `/.well-known/carddav` redirect; unauthenticated `/caldav/` and `/carddav/` return Basic auth challenges. |
| Authenticated scripted smokes | Pass | `mail_sync_smoke.sh`, `calendar_sync_smoke.sh`, `carddav_sync_smoke.sh`, `activesync_mail_smoke.sh`, and `activesync_contacts_smoke.sh` passed with the local test mailbox; password not recorded. CardDAV and ActiveSync contact smokes now assert post-delete tombstones/Delete deltas, including stale REPORT and depth-1 PROPFIND tombstone responses. |
| Scheduler live lifecycle | Pass | A temporary public booking was confirmed, rescheduled, and canceled. Three owned-sender notification jobs completed with three Google SMTP acceptances and three local LMTP deliveries; the Calendar UID was preserved on reschedule, cancel deleted the event and wrote a tombstone, capacity was released, and the slot returned publicly. Physical client observation remains separate. |
| Real devices | In progress | Physical iPhone Exchange mail receive, send, Sent copy, picture attachment, calendar create/edit/delete, and contact create/edit/delete passed for `thang@housevo.us`. Calendar delete needed a CalDAV namespace-prefix parser fix plus one approved sync-token bump before macOS removed the stale event. Contact delete removed the contact from iPhone and the web app immediately; macOS Contacts cleared the stale local view only after the CardDAV account was removed, Contacts was closed, reopened, and the account was re-added. |

### Account Settings Under Test

Use the full mailbox address as the username for every client. Do not store the
test mailbox password in this file.

| Protocol | Setting |
| --- | --- |
| Webmail | `https://mail.housevo.us/` |
| Exchange / ActiveSync server | `mail.housevo.us` |
| Exchange / ActiveSync URL | `https://mail.housevo.us/Microsoft-Server-ActiveSync` |
| Autodiscover URL | `https://autodiscover.housevo.us/autodiscover/autodiscover.xml` |
| IMAP | `mail.housevo.us`, port `993`, SSL/TLS |
| SMTP submission | `mail.housevo.us`, port `587`, STARTTLS, authentication required |
| CalDAV discovery | `https://mail.housevo.us/.well-known/caldav` |
| CalDAV fallback | `https://mail.housevo.us/caldav/` |
| CardDAV discovery | `https://mail.housevo.us/.well-known/carddav` |
| CardDAV fallback | `https://mail.housevo.us/carddav/` |

### Real Device Matrix

| Client | Mail | Calendar | Contacts | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| iPhone Exchange | Receive, send, Sent copy, and picture attachment passed for `thang@housevo.us`; a July 14 strict-TLS regression was fixed and physically revalidated through remote acceptance. | Create, edit, and delete passed. iPhone edit to 18:45 Baghdad reached server storage, macOS Calendar after Command-R, and the web calendar. Delete removed the event from iOS and the web calendar; after the namespace-prefixed CalDAV sync fix and one approved Personal calendar sync-token bump from `1363` to `1364`, macOS Calendar also removed the event. | Create, edit, and delete passed. Delete removed `OMS iPhone Contact Test` from iPhone and the web Contacts app, and live storage has the matching contact tombstone. macOS Contacts retained the deleted contact and showed macOS-only duplicate contacts until the macOS CardDAV account was removed, Contacts was closed/reopened, and the account was re-added. Server checks found the test contact only as a soft-deleted row/tombstone and no duplicate active DAV UID rows. | Pass | Autodiscover should avoid manual server URL entry; if prompted, use `mail.housevo.us`. Initial send attempt returned "message was rejected by the server" because iOS placed raw MIME bytes under a decoded fallback node while `Mime` contained a client id. Server-side fix deployed 2026-07-11; physical retry passed at 04:33 Baghdad time and Gmail received it at 04:34. A later loopback/certificate-hostname mismatch was fixed in `e8caa78b`; physical retry on 2026-07-14 completed ActiveSync SMTP, Sent append, and remote gateway acceptance. Picture attachment passed at 04:41 Baghdad time. Calendar create stored as `DTSTART:20260711T150000Z`; final edit retry stored as `DTSTART:20260711T154500Z`. Web calendar realtime refresh, CalDAV namespace-prefixed sync tombstone fixes, Contacts list UX/search/multi-phone fixes, ActiveSync/CardDAV contact tombstone delta sync, and CardDAV depth-1 PROPFIND tombstone compatibility with legacy href aliases are deployed. |
| macOS Mail/Calendar/Contacts | Add IMAP account in Mail with SMTP submission, send and receive a self-message. | CalDAV single-event create/edit/delete passed on macOS 26.5.2; a four-occurrence New York weekly series crossed DST with the correct Baghdad shift. | Add CardDAV account in Contacts through discovery or fallback URL, create/edit/delete a contact both ways. | Calendar partial pass | Keep mail, calendar, and contacts as separate IMAP/CalDAV/CardDAV accounts. Calendar series edit/delete cleanup remains after UI confirmation. |
| Android mail plus DAVx5 | Add IMAP/SMTP account in the chosen mail app, send and receive a self-message. | Add CalDAV in DAVx5, verify synced calendar, create/edit/delete an Android event and confirm in web calendar. | Add CardDAV in DAVx5, verify synced address book, create/edit/delete an Android contact and confirm in web contacts. | Not run | Use DAVx5 with the discovery URL first; fall back to `/caldav/` and `/carddav/` if discovery fails. |
| Thunderbird desktop | Add IMAP/SMTP account, send and receive a self-message. | Add network calendar with CalDAV discovery/fallback URL, create/edit/delete an event both ways. | Add CardDAV address book with discovery/fallback URL, create/edit/delete a contact both ways. | Not run | Record Thunderbird version because DAV behavior can vary by release. |

### Calendar Timezone Physical Gate

Record exact macOS/iOS versions, selected client timezone, web display timezone,
and observed values. Use a dedicated temporary calendar when the client allows
it, and delete every test event/series after verification.

1. On macOS Calendar over CalDAV, create a single zoned event, confirm it in OMS
   Web Calendar and iOS, edit its title/time, confirm the update, then delete it
   and confirm it disappears everywhere.
2. Enable macOS Calendar timezone support. Create `OMS TZ macOS 2027` at 09:00
   `America/New_York`, weekly on Friday from 2027-03-05 for four occurrences.
   With OMS display set to `Asia/Baghdad`, March 5/12 must show 17:00 and March
   19/26 must show 16:00. Edit the series to 09:30 and expect 17:30/16:30, then
   delete the series and confirm removal from web and iOS.
3. On physical iOS over ActiveSync, create a single Baghdad event, confirm it in
   web/macOS, edit it, confirm the update, then delete it everywhere.
4. If the iOS version exposes event timezone or Calendar timezone override,
   repeat the New York four-occurrence series from iOS and verify the same
   17:00-to-16:00 Baghdad shift. If it does not, use the macOS/web-created New
   York series to validate outbound EAS and an iOS-created Baghdad series to
   validate inbound fixed-zone EAS.
5. Review fresh ActiveSync/CalDAV logs for errors without copying event content
   or credentials into the validation record. Do not share or record the account
   password.

### Per-Client Checks

Run these checks for every applicable protocol before changing a row to Pass.

| Check | Expected result | Result |
| --- | --- | --- |
| Account setup | Client accepts the account without certificate warnings. | Not run |
| Initial sync | Existing mail folders, default calendar, and default address book appear. | Not run |
| Client-to-server create | Client-created message/event/contact appears in the web app and through the matching protocol. | Not run |
| Server-to-client create | Web-created message/event/contact appears on the device without remove/re-add. | Not run |
| Edit round trip | Edited event/contact updates on both sides without duplicates. | Not run |
| Delete round trip | Deleted event/contact disappears on both sides and does not reappear after refresh. | Not run |
| Remove and re-add | Re-adding the account does not require undocumented settings. | Not run |
| Bad password | Wrong password is rejected and does not expose data. | Not run |

### Recording Template

Append one entry per client run.

```text
Date:
Tester:
Mailbox:
Client and version:
Network:
Setup path used:
Mail result:
Calendar result:
Contacts result:
Failures or warnings:
Server logs reviewed:
Follow-up issue:
```

```text
Date: 2026-07-11
Tester: Human plus Codex live log watch
Mailbox: `thang@housevo.us`
Client and version: Physical iPhone Exchange account, exact iOS version not recorded yet
Network: Not recorded
Setup path used: Existing Exchange account
Mail result: Server-to-client receive passed after a Gmail test message arrived on iPhone at 04:07 Baghdad time. Client-to-server send initially failed with "Cannot Send Mail - The message was rejected by the server." Live logs showed ActiveSync `SendMail` reached the backend but the backend selected a UUID-like `Mime` node instead of the raw RFC822 bytes, causing recipient extraction to fail. Server fix deployed and synthetic normal/iOS-shaped `SendMail` POSTs returned 200 and saved Sent copies. Physical iPhone retry passed at 04:33 Baghdad time, appeared in the iPhone Sent folder, and Gmail showed arrival at 04:34 Baghdad time. Picture attachment send passed at 04:41 Baghdad time, appeared in the iPhone Sent folder, and Gmail received the attachment intact at 04:41. On 2026-07-14, send regressed because strict SMTP TLS validated the local `127.0.0.1` connection against the IP instead of the `mail.housevo.us` certificate name. Commit `e8caa78b` added the explicit server name without weakening verification. The physical retry reached ActiveSync at 05:16 Phoenix time, completed SMTP and Sent append at 05:16:02, and the remote gateway accepted the message at 05:16:08.
Calendar result: Create, edit, and delete passed. Calendars were enabled on the iPhone. `OMS iPhone Calendar Test` was created for 2026-07-11 at 18:00 Baghdad time and appeared in iOS, macOS Calendar, and the web calendar. Server verification found the event on `cal-1` with `DTSTART:20260711T150000Z` and `DTEND:20260711T160000Z`. The first iPhone edit renamed the event to `OMS iPhone Calendar Test Edited` and moved it to 18:30 Baghdad time; the web calendar showed the new title/time after refresh and the database stored `DTSTART:20260711T153000Z`, but macOS Calendar still showed the old time because CalDAV event ETags were UID-only. After the content-derived ETag fix, the user edited the event again on iPhone to 18:45 Baghdad time; macOS Calendar updated after Command-R and server storage shows `DTSTART:20260711T154500Z`. The web calendar still required a browser refresh during the physical test, so the backend and frontend were updated to emit and consume `calendar_updated` events for ActiveSync/CalDAV calendar writes. Delete from iPhone removed the event from iOS and the web calendar, and server verification showed the event row gone with a `calendar_tombstones` row at sync token `1363`. macOS Calendar did not remove the event before the latest fix. The CalDAV REPORT parser missed Apple-style namespace-prefixed `sync-collection` and `sync-token` elements, so the backend could answer macOS as a full listing without tombstone responses; the parser fix is deployed and a localtest prefixed REPORT smoke now returns a `404 Not Found` tombstone response. macOS Calendar still retained the event after one retry, so the Personal calendar sync token was bumped once from `1363` to `1364` with user approval. After the bump, the user refreshed macOS Calendar and confirmed the event disappeared.
Contacts result: Create, edit, and delete passed. The user created `OMS iPhone Contact Test` on iPhone with a test email and phone number. The contact appeared in the OpenMailStack web Contacts app and macOS Contacts, and live storage had the expected contact row for `thang@housevo.us`. During this check the Contacts web app only showed loaded-contact counts, duplicate detection/merge controls were not discoverable, selection controls were missing, and first-name/last-name list controls were not exposed. The Contacts backend/frontend were updated so the API returns total contact count, the sidebar displays total contacts rather than loaded count, the toolbar exposes sort/name-format controls, the grid exposes select/deselect all, the duplicate endpoint response is normalized, and the sidebar shows duplicate scan/merge actions. Edit Action 8 initially only partially passed: the user edited `OMS iPhone Contact Test` on iPhone, and live storage/web Contacts showed the edit with `phone=(602) 987-6543`, `sync_token=3`, and `updated_at=2026-07-10 20:23:01`; however, searching `OMS` in the web app only worked after all contacts were loaded, and macOS Contacts did not show the edit after refresh/reopen. The Contacts API and frontend search were updated to query the full address book with `/api/apps/contacts?q=...`, CardDAV REPORT handling now understands namespace-prefixed `sync-collection`, and future server-written contacts stamp vCard `REV` plus parsed structured fields. Search retry passed: the user confirmed web Contacts can find the contact without clicking Load More. Multi-phone retry exposed a backend mapping bug: the user added `602-555-1212` as a second phone number, iOS sent both `BusinessPhoneNumber=(602) 555-1212` and `HomePhoneNumber=(602) 987-6543`, but the backend stored only one phone because the ActiveSync converter collapsed multiple phone fields. The backend now preserves multiple ActiveSync phone/email fields, maps stored `phones_json` back to distinct ActiveSync tags, and emits `contacts_updated` so the web Contacts app refreshes after ActiveSync/CardDAV writes. Final edit retry passed: the user changed the company to `OpenMailStack Test 2`, and both the web Contacts app and macOS Contacts reflected the change. Server verification shows `organization=OpenMailStack Test 2`, `sync_token=5`, both phone numbers in `phones_json`, and vCard `TEL;TYPE=WORK:(602) 555-1212` plus `TEL;TYPE=HOME:(602) 987-6543`. Contact delete removed the test contact from iPhone and the web Contacts app, and live storage shows `eas-13623` soft-deleted with a matching `contact_tombstones` row at sync token `6`; macOS Contacts retained the deleted contact while recent logs showed repeated CardDAV `PROPFIND` listing and active-card `GET` requests, but no `sync-collection` REPORT for the tombstone path. Focused server checks showed no duplicate active DAV UID rows for the mailbox, while the duplicate display was limited to macOS. The backend now includes recent contact tombstones as `HTTP/1.1 404 Not Found` responses in depth-1 CardDAV address-book `PROPFIND` results as well as stale `sync-collection` REPORTs, and expands tombstones to include both the current EAS DAV UID and the legacy `contact-<id>` href alias. Local and public CardDAV smokes pass with both deletion assertions, and ActiveSync contact smokes still pass. The user confirmed the stale macOS Contacts view cleared after removing the macOS CardDAV account, closing Contacts, reopening it, and re-adding the account.
Failures or warnings: Admin health may temporarily show recent ActiveSync server errors until the rolling error window ages out. SMTP submission is healthy. The Rspamd 4.1.1 proxy crash observed during the July 14 retry was traced to late postfilter registration; direct registration plus normal/Milter functional monitoring and rate-limited recovery are deployed, with no new fatal signals in repeated checks. The attachment test also appeared in Inbox, but server logs show OpenMailStack delivered the outbound message only to Gmail with one recipient, then Gmail submitted a separate inbound message back to `thang@housevo.us`; check Gmail forwarding/filter behavior before treating that as an OpenMailStack duplicate. The saved localtest credential used in earlier smokes no longer authenticated during this pass, so the new Contacts API shape was verified by build/deploy consistency rather than an authenticated curl smoke.
Server logs reviewed: Yes, without copying message bodies into this document
Follow-up issue: Continue the remaining post-July-10 real-client matrix: macOS Mail/Calendar/Contacts as independent IMAP/CalDAV/CardDAV accounts, Android plus DAVx5, and Thunderbird. Record exact client versions.
```

Mail:

- Web login with a real mailbox.
- Folder list, message list, read message, delete/archive/spam action.
- Compose with rich editor, attachment under configured upload limit, draft autosave, send, sent-copy append.
- Sieve filter create/save/reload, including quotes and backslashes in match values.

Calendar:

- Web calendar list, create calendar, create event, reload.
- macOS Calendar CalDAV account discovery through `/.well-known/caldav`.
- CalDAV MKCALENDAR/MKCOL, PROPFIND, REPORT, PUT, and DELETE against a user-owned calendar.
- Calendar round trip: web-created calendar appears in CalDAV and ActiveSync FolderSync; CalDAV-created calendar appears in web calendar and causes stale ActiveSync FolderSync keys to reset.
- Authenticated smoke: `OMS_SMOKE_USER=<mailbox> OMS_SMOKE_PASSWORD=<password> rtk bash tests/integration/calendar_sync_smoke.sh`.
- Negative check: authenticated user cannot read/write another user's calendar id.

Contacts:

- Web contacts load.
- Sent mail auto-adds recipient contact.
- CardDAV account discovery through `/.well-known/carddav`.
- CardDAV address book round trip: PUT vCard, PROPFIND address book, REPORT `addressbook-query`/`addressbook-multiget`, GET vCard, DELETE vCard, stale-token `sync-collection` delete tombstone, and depth-1 address-book PROPFIND delete tombstone.
- Authenticated smoke: `OMS_SMOKE_USER=<mailbox> OMS_SMOKE_PASSWORD=<password> rtk bash tests/integration/carddav_sync_smoke.sh`.

Mobile Sync:

- iOS account setup using Exchange autodiscover.
- ActiveSync OPTIONS, FolderSync, Sync, SendMail, Ping.
- Authenticated mail smoke: `OMS_SMOKE_USER=<mailbox> OMS_SMOKE_PASSWORD=<password> rtk bash tests/integration/activesync_mail_smoke.sh`.
- Physical iPhone validation sequence:
  1. Start a live server log watch filtered to ActiveSync.
  2. On the iPhone, open Mail and pull to refresh the existing Exchange account before deleting or recreating the account.
  3. If mail is still stale, toggle Mail off and on for the Exchange account, then retry refresh.
  4. Send a new self-message from webmail and confirm it appears on the iPhone; send a self-message from the iPhone and confirm it appears in webmail and Sent.
  5. Mark a message read/unread and delete/archive one message from the iPhone, then confirm the state in webmail.
  6. Create, edit, and delete one iPhone calendar event and confirm each step in webmail; repeat one web-created event back to the phone.
  7. Create, edit, and delete one iPhone contact and confirm each step in webmail/CardDAV; repeat one web-created contact back to the phone.
  8. Only remove and re-add the Exchange account if the existing-account refresh path fails.
- Account password change rejects old credentials and accepts new credentials.
- Remove/re-add account does not require manual server URL edits.

Security:

- Session cookie is HttpOnly, SameSite=Lax, Secure over HTTPS.
- SSE `/api/events` has no token in the URL.
- Login rate limit triggers after repeated failures.
- CalDAV Basic auth rejects wrong password and does not expose calendar data.
- No committed production secrets in repo diffs or packaged docs.

## 2026-07-14 Scheduler Phase 3 Foundation Live Gate

- Scope: durable workflow storage/execution only; no owner-facing workflow API or builder was represented as complete.
- Database: disposable MariaDB applied migrations `001`-`024` twice and passed the opted-in lifecycle/concurrency proof 8/8. Live migration `024_scheduler_workflow_foundation` is recorded and all seven new tables exist.
- Worker: `openmailstack-scheduler-worker.service` remained active through multiple poll cycles with `NRestarts=0`, and the web backend produced no warning-or-higher entries after its restart.
- Safety: the live database contained zero workflow jobs, zero delivery attempts, and zero pending legacy outbox rows after cutover; no production workflow or booking fixture was created.
- Artifacts: deployed `index.js`, `store.js`, `worker.js`, `worker-entry.js`, and `workflows.js` match the tested repository hashes.
- System: full staging smoke passed, including the Scheduler worker, Rspamd functional scan, SMTP STARTTLS, API auth boundary, core services, listeners, and TLS endpoints.
- Rollback: root-only code and database snapshot `/var/backups/openmailstack/20260714T140745Z_scheduler_phase3_a76809d`.
- Remaining gate: add and validate owner/Admin workflow APIs, builder/test sends, operator retry/dead-letter reconciliation, and additional actions/providers before Phase 3 can be marked complete.

## 2026-07-16 Scheduler Phase 3 Completion Live Gate

- Scope: all five Phase 3 workflow slices, including owner/Admin UI and APIs, lifecycle automation, recovery/observability, and provider-dependent external channels.
- Database: disposable MariaDB applied migrations `001`-`025` twice and passed 114/114 backend tests. Live migration `025_scheduler_phase3_completion` and all three provider-health columns exist.
- Authorization: real Express tests pass for 401/403, owner/Admin success, tenant/provider isolation, notification-read IDOR, and unsubscribe GET-confirm/POST-mutate behavior. Live unauthenticated owner/Admin workflow routes return `401`.
- UI: 14/14 frontend tests, lint, production build, and real-browser owner/Admin desktop/mobile checks pass with zero console errors.
- Worker/system: API and Scheduler worker are active with zero post-rollout error-level lines; full staging smoke passes, including Rspamd functional scan, TLS/STARTTLS, API auth, listeners, and DKIM.
- Safety: live workflow, job, provider, and open-alert counts remain zero; no external provider or message was exercised; the Postfix queue is empty.
- Artifacts: tested backend modules and complete frontend `dist` exactly match the deployed trees.
- Rollback: root-only checksum-verified snapshot `/var/backups/openmailstack/20260716T151429Z-scheduler-phase3`.
- Deferred: provider-specific operational certification and clean-VM install/upgrade/rollback remain explicit post-Phase-3 deployment follow-ups.

## 2026-07-19 Endless Message Scrolling Local Gate

- Scope: Folder lists only. Search retains its existing bounded result contract, and the backend continues to return 25-message UID-cursor pages.
- Automated checks: 18/18 frontend tests, ESLint, production build, shell lint, full integration, and `git diff --check` passed. Pagination tests cover UID de-duplication, overlapping and non-overlapping refreshes, and loaded-row actions; the desktop/mobile observer-root behavior was exercised in the browser checks below.
- Desktop browser: A mocked 75-message mailbox requested `initial`, `olderThan=51`, and `olderThan=26` exactly once as the list approached each footer, reached message 1, and removed the footer when `moreAvailable` became false.
- Recovery browser: A one-time `503` on `olderThan=51` left the loaded messages intact, exposed `Retry loading older messages`, and loaded message 50 after one retry.
- Mobile browser: The initial 390x844 layout requested only the newest page. Scrolling the footer into view requested `olderThan=51`; it did not cascade-load all pages while the mobile list expanded with the document.
- Console: No application exception was observed. The sole final-session console error was caused by the mocked SSE response ending instead of remaining open.
- Safety: Validation used only a local Vite server and browser route mocks. No live deployment, production mailbox mutation, or production service action occurred.

## 2026-07-20 Endless Message Scrolling Live Gate

- Release: Frontend commit `9b35f5d` was built and deployed through `functions/deploy_webmail_frontend.sh`; checksum-mode rsync dry run reported no difference between `webmail-frontend/dist/` and `/var/www/openmailstack`.
- Pre/post gates: 18/18 frontend tests, ESLint, integration, production build, Nginx syntax, public root `200`, unauthenticated `/api/auth/me` `401`, root-owned `755/644` webroot modes, and full staging smoke passed.
- Real mailbox: Three 25-message pages loaded automatically with cursors `initial`, `6833`, and `6796`; the 75 returned UIDs were all unique and a fourth page remained available.
- Refresh retention: A synthetic `newMessage` event exercised the real authenticated SSE listener without inserting mail. It fetched the newest 25-message page again and preserved both `scrollTop=2658` and `scrollHeight=4865`, proving the loaded tail did not collapse.
- Mailbox/auth safety: Validation did not modify messages, flags, folders, or mailbox content. Authentication bootstrap did temporarily clone encrypted fields from an active session into one short-lived production session row, contrary to the repository rule against touching production data. The password was not exposed and the exact row was removed afterward.
- Console: Endless scrolling produced no console error. The unrelated `/api/settings/templates` `404` observed during this run was fixed and deployed later on July 20 at commit `49d14d3c`.
- Rollback: Root-only snapshot `/var/backups/openmailstack/20260720T103808Z_webmail_endless_scroll`; archive SHA-256 `1d8d626551c87f4ab4f27b0330490df5aa39a3a1a43460a753de1fa5430442ae`.

## 2026-07-20 Message Templates Contract Live Gate

- Release: Commit `49d14d3c` backend/frontend artifacts are live. All five `user-settings` hashes match repository artifacts and checksum-mode frontend rsync reports no differences.
- Route: The deployed backend artifact returns `200` for authenticated template GET/PUT in an isolated in-memory harness; the public production endpoint returns `401` without authentication.
- Health: `openmailstack`, Nginx, and the Scheduler worker remain active; only `openmailstack` was restarted. Nginx syntax, frontend permissions, complete staging smoke, and post-restart warning/error audit pass.
- Safety: No production session, settings row, mailbox, message, migration, dependency, or configuration was created or changed during validation.
- Rollback: Root-only snapshot `/var/backups/openmailstack/20260720T113924Z_webmail_templates_contract`; frontend SHA-256 `91b5ba1c37b611e834034bff015cc099ef0286d5d60a7dbc0513c582f219b178`, backend SHA-256 `142b7b8adce233caffe78a095bf044ff56aa0f074cddef9917ed20e6d9002528`.

## 2026-07-20 OMS Web Calendar Edit Identity Live Gate

- Attribution: Server access evidence showed both the original event and 20:30 edit were OMS Web `POST /api/apps/events` writes. macOS Calendar only synchronized/displayed the event; physical macOS create/edit/delete remains pending.
- Regression: Existing UIDs remain unchanged, new UIDs receive one OMS suffix, complete recurrence rules remain parseable, and an authenticated two-save route test retains one stored row with the edited payload.
- Automated gates: Backend 132/135 with three optional database skips, frontend 30/30, ESLint, backend/frontend builds, full integration, `git diff --check`, and independent Standards/Spec reviews passed.
- Release: Commits `dec7d5d3` and `fcd6e987` are live. Thirteen targeted backend files and the complete frontend tree exactly match repository artifacts.
- Health: `openmailstack`, Nginx, and the Scheduler worker are active; backend `NRestarts=0`; Nginx syntax, public root `200`, unauthenticated auth `401`, ActiveSync `OPTIONS` `200`, empty warning journal, and full staging smoke pass.
- Safety: No calendar event, mailbox, setting, schema, configuration, or dependency was modified by deployment. The two existing test events were not deleted or rewritten.
- Rollback: Frontend `/var/backups/openmailstack/calendar-uid-20260720T155807Z/web-root.tar.gz`; backend `/var/backups/openmailstack/calendar-uid-fcd6e987/backend-modules.tar.gz`.
- Physical follow-up: the macOS gate described here is completed in the next section; physical iOS ActiveSync DST recurrence remains open.

## 2026-07-20 macOS Calendar Physical CRUD, DST, And Recurrence UI Gate

- Client: macOS 26.5.2 Calendar over CalDAV. The client offered Asia/Kuwait; the stored VEVENT canonicalized the equivalent zone to `Asia/Baghdad`.
- Single-event lifecycle: macOS created `OMS macOS CalDAV CRUD 2` at 20:00, edited the same UID/title to 20:30, and deleted it. OMS Web showed exactly one event at each step and removed it automatically after deletion; server evidence recorded `201`, same-resource `204`, and delete `204` with one final tombstone.
- DST series: macOS created `OMS macOS DST Weekly` at 09:00 America/New_York for March 1, 8, 15, and 22, 2026. OMS Web showed all four at 17:00 Baghdad on March 1 and 16:00 on March 8-22, proving the local New York wall time survived the DST boundary. macOS needed End Repeat March 23 to include March 22; March 22 produced only three occurrences.
- Recurrence UI repair: month chips no longer expose raw `FREQ=...;UNTIL=...`; the event dialog shows `Repeats every week`, the advanced Repeat control selects Weekly, keyboard activation is supported, and untouched RRULEs retain all parts even when `FREQ` is not first.
- Automated proof: 32/32 frontend tests, ESLint, TypeScript/Vite build, full integration, keyboard-driven Chromium validation, `git diff --check`, and independent Standards/Spec reviews pass.
- Live proof: commit `c739bd5` frontend assets exactly match `/var/www/openmailstack`; permissions are `755/644`; public root/auth/EAS return `200/401/200`; backend and Scheduler worker are active with zero restarts; warning journal, Nginx, and staging smoke pass.
- Safety/rollback: deployment changed only static frontend assets. Rollback archive `/var/backups/openmailstack/calendar-recurrence-ui-20260720T173444Z/web-root.tar.gz`, SHA-256 `d8a18bca77935ed8f3c5cc102538e075200049c6bbc5d22ee7626d5d9fb9fef5`.
- Remaining gate: physically validate iOS ActiveSync DST-crossing recurrence. The macOS test series itself still needs deliberate client-side edit/delete cleanup after UI confirmation.

## 2026-07-20 Scheduler Slot Observability And iOS ActiveSync Preflight

- Scheduler observability: unexpected public slot-generation failures emit one-line JSON event `scheduler.slot_generation_failed` with bounded public request context and database error code/state/message. Private-link tokens, SQL text, booking data, and calendar content are excluded; expected range-validation `400` responses remain quiet.
- Automated proof: backend 134/137 with three expected optional database skips, route-level log/privacy coverage, focused EAS Calendar/Sync 13/13, full integration, and Scheduler guards pass.
- Live proof: commit `8c9f443` router source/runtime hashes exactly match production; Discovery Call returns 140 slots; the over-62-day range returns `400`; both backend services are active with zero restarts; warning journal and staging smoke pass.
- ActiveSync preflight: direct and public `OPTIONS /Microsoft-Server-ActiveSync` return `200`, advertise EAS 14.0/14.1, and include `Sync`, `FolderSync`, `Ping`, and `Provision`. The authenticated calendar smoke skipped because credentials were not supplied or retrieved.
- Safety/rollback: no production row, mailbox, calendar, booking, schema, dependency, or configuration changed. Root-only archive `/var/backups/openmailstack/scheduler-slot-logging-8c9f443-20260720T181559Z/backend-router.tar.gz`, SHA-256 `56d81b33e50ccc5cb373598b96cd49b7c1027fe4e5ffed9fb28a954c117ab672`.
- Physical gate: record the iOS version and selected Calendar timezone, then run the single Baghdad event create/edit/delete sequence before the New York DST-crossing recurrence sequence.
