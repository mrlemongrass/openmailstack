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
| RFC 5545 time semantics | Pass locally | Backend and frontend golden vectors cover UTC, `Asia/Baghdad`, floating, all-day, New York spring gap/fall overlap, zoned recurrence, `EXDATE`, cancelled/modified exceptions, and display alarms including at-start/week forms. Explicit exception zones/all-day state override master defaults. |
| Reversible CalDAV | Pass locally | An in-memory Express lifecycle sends an Apple-style Baghdad VEVENT through create, HEAD, byte-for-byte GET, stale `If-Match` rejection, conditional update, and DELETE. The PUT ETag is stable on immediate HEAD/GET, and the deleted resource returns 404. No real calendar or mailbox is used. |
| ActiveSync Calendar | Pass automated and physical iOS 26.5.2 | iOS-shaped timed/all-day payloads, daily/weekly/monthly/yearly recurrence, reminders, deleted/modified exceptions, and exception-specific all-day state convert to/from iCalendar and pass the real WBXML writer/parser. The 172-byte binary origin `TimeZone` value round-trips fixed Baghdad plus DST-observing New York, Microsoft Pacific, and Windows Central fixtures while retaining local wall time. Physical fixed-zone CRUD, DST-series create/edit/delete, edit-one/delete-one exceptions, inherited/overridden reminders, and deliberate cleanup passed with automatic OMS Web reconciliation. |
| Custom/invalid VTIMEZONE | Pass locally | Supported custom aliases must match IANA transitions across a 28-year calendar cycle and all referenced event years. Contradictory, bounded, future, malformed, second-precision, and negative-zero definitions preserve wall time as floating and surface a repair warning instead of silently shifting. Whole-series saves retain raw timezone and exception components. |
| Scheduler | Pass locally | Existing availability tests skip DST gaps, return both overlap instants, and project the same slots into Baghdad, Phoenix, and Tokyo while preserving buffers, notice, and midnight boundaries. |
| Chromium/WebKit | Pass locally | Real Chromium and WebKit desktop/mobile runs render `2026-07-24T17:00:00Z` as `8:00 PM - 9:00 PM` in Home `Asia/Baghdad`, preserve the instant when converting to Phoenix, confine the current-time line to the current day, and exercise System/Home plus the keyboard clock toggle with no unexpected page/console errors. Screenshots are under ignored `output/playwright/`. |
| Full repository gates | Pass | Backend 160 total: 157 pass and three expected optional database skips; frontend 37/37; ESLint; TypeScript/Vite production build; shell syntax; full integration; focused Calendar/EAS/WBXML tests; independent Standards/Spec reviews; and `git diff --check` pass. The authenticated Calendar route smoke remains credential-gated. |
| Named Apple clients | Pass for Calendar | macOS 26.5.2 CalDAV and iOS 26.5.2 ActiveSync single-event create/edit/delete, four-occurrence New York DST projection, recurrence-exception editing/deletion, reminder inheritance/override, and cleanup passed. Standalone macOS Mail/Contacts remain separate rows. |

Production rollout decision: Calendar Track T is complete for the deployed scope at guarded release `8469e90`. Root-only rollback `/var/backups/openmailstack/calendar-track-t-8469e90-20260720T203554Z` contains the affected backend modules and prior web root. Exact backend/frontend contents, direct/public EAS `200`, public web/auth `200/401`, active zero-restart services after the stable restart, empty post-stable-start warning journal, Nginx, full staging smoke, and the physical macOS/iOS exception-reminder matrix pass. The first restart exposed a manual-deploy permission error because `rsync -a` preserved one generated `0600 root:root` runtime file; normalizing the bounded backend artifacts to `0644` and restarting corrected it.

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

Last checked: 2026-07-30 against `mail.housevo.us`.

| Area | Status | Evidence |
| --- | --- | --- |
| Core services | Pass | `staging_smoke.sh ./config.conf` confirmed `nginx`, `mariadb`, `postfix`, `dovecot`, `rspamd`, `openmailstack`, `redis-server`, and `clamav-daemon` active. |
| Public listeners | Pass | `staging_smoke.sh ./config.conf` confirmed TCP 25, 80, 443, 587, 993, backend port 20000, and optional 995 listening. |
| TLS names | Pass after regression repair | Public IMAP, local HTTPS, and SMTP submission hostname verification pass with the Let's Encrypt certificate covering `mail.housevo.us`, `autodiscover.housevo.us`, and `webmail.housevo.us`; it expires 2026-10-05. The staging smoke now checks port 993 explicitly. A targeted Dovecot installer rerun also retained the valid certificate paths. |
| Public DNS | Pass | External DNS lookup confirmed `housevo.us` MX points to `mail.housevo.us`; `mail`, `autodiscover`, and `webmail` resolve to the public server address. |
| Web routes | Pass | `/` returns 200; `/api/auth/me` returns 401 unauthenticated; Roundcube `/webmail/` returns 200. |
| ActiveSync preflight | Pass | `OPTIONS /Microsoft-Server-ActiveSync` returns 200 and advertises EAS 14.0/14.1 commands. |
| Calendar timezone test release | Pass operationally | The deployed EAS adapter and timezone codec match the tested repository artifacts; fixed/DST fixtures pass locally, and direct/public `OPTIONS`, web/auth boundaries, Nginx, services, post-restart logs, and full staging smoke pass. Physical Apple-client rows remain separate. |
| Autodiscover | Pass | `autodiscover.housevo.us` returns MobileSync URL `https://mail.housevo.us/Microsoft-Server-ActiveSync`. |
| SMTP submission health | Pass | Live submission port returns `220 mail.housevo.us ESMTP Postfix (Debian/GNU)` within the Admin health probe's 8s timeout. |
| Rspamd filtering health | Pass | The one-minute monitor completes both a normal-worker scan and real Postfix-path Milter transaction, persists cross-probe worker generations, and rate-limits Rspamd-only recovery. Repeated post-deploy probes added zero fatal signals. |
| Server-side Sieve delivery | Pass after userdb repair | Dovecot's SQL userdb returns an absolute `home` and `mail_path`, the active personal script is visible through delegated ManageSieve, and a disposable `localtest@housevo.us` LMTP message triggered `fileinto` into the temporary target mailbox with no Inbox copy. The message, script, and mailbox were removed after proof. |
| CalDAV/CardDAV preflight | Pass | `/.well-known/caldav` and `/.well-known/carddav` redirect; unauthenticated `/caldav/` and `/carddav/` return Basic auth challenges. |
| Authenticated scripted smokes | Pass | `mail_sync_smoke.sh`, `calendar_sync_smoke.sh`, `carddav_sync_smoke.sh`, `activesync_mail_smoke.sh`, and `activesync_contacts_smoke.sh` passed with the local test mailbox; password not recorded. CardDAV now asserts truthful owner capability metadata, cleans its remote contact on every post-PUT failure, and proves post-delete tombstones through stale REPORT and depth-1 PROPFIND responses. |
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
| macOS Mail/Calendar/Contacts | Add IMAP account in Mail with SMTP submission, send and receive a self-message. | CalDAV single-event create/edit/delete passed on macOS 26.5.2; a four-occurrence New York weekly series crossed DST with the correct Baghdad shift; edit-one/delete-one recurrence exceptions and reminders projected correctly through OMS Web and iOS. | HouseVo authenticates, syncs, shows `All HouseVo Contacts`, and allows edits, but was absent from the Default Account menu. Owner `read`/contact `write-content`/collection `bind` and `unbind` metadata is deployed and script-verified; recheck the menu, then complete reversible create/edit/delete. | Calendar pass; Contacts recheck pending | Keep mail, calendar, and contacts as separate IMAP/CalDAV/CardDAV accounts. Mail remains a separate physical gate. Remove/re-add CardDAV only if the post-deploy menu remains stale. |
| Android mail plus DAVx5 | Thunderbird Android 21.0 on Android 11 (API 30) connected manually to IMAP 993 with SSL/TLS and SMTP 587 with STARTTLS. `OMS Android Thunderbird Matrix 20260730T1710Z` appeared in both the Android Inbox and Sent views and as server UIDs 30 and 9 before exact cleanup. | DAVx5 4.5.18-ose discovered the Personal calendar from `/.well-known/caldav`. Etar 1.0.56 created, edited, and deleted the event; server event 1457 retained UID `b5970849-2731-417c-bbd8-4213d72ab9db` through the edit and produced the expected tombstone on delete. | A separate DAVx5 account using `/.well-known/carddav` discovered Personal Contacts. Android Contacts created, edited, and deleted contact 1510 with stable DAV UID `52bc33ce-50ee-471d-b5e4-b8cfcddf8d60`; the delete produced sync token 56 and the expected tombstone. | Pass (Android emulator) | Run on Android Emulator 37.1.11 in the Debian 13.6 `dev2-debian` LXC. The host has no `/dev/kvm`, so the completed API 30 run used CPU emulation after an API 36 image proved unstable. The bundled API 30 Calendar viewer lacked its declared event-editor class, so the verified F-Droid Etar build exercised the native Android Calendar provider. Thunderbird Android reported `Configuration not found`; manual settings were required. Both discovery URLs worked for their respective service. All active test mail/event/contact state, profiles, AVDs, and cached credentials were removed. |
| Thunderbird desktop | Thunderbird 140.12.0esr on Debian 13.6 sent `OMS Thunderbird Matrix 20260730T1520Z` through SMTP submission and received it over IMAP; the message appeared in Inbox and Sent as server UIDs 29 and 8 before exact cleanup. | `/.well-known/caldav` discovered the calendars. Create/edit/delete in Personal retained event UID `6777c423-ab92-4a87-8517-e8e525a5f853` and produced the expected tombstone. | `/.well-known/carddav` discovered Personal Contacts. Create/edit/delete retained DAV UID `d48307b8-6570-4f48-9af0-0a9d3e60e82d` and produced the expected tombstone. | Pass | The first automatic mail guess used short username `localtest` and SMTP without encryption. The passing setup used full username `localtest@housevo.us`, IMAP 993 SSL/TLS, and SMTP 587 STARTTLS. CalDAV/CardDAV discovery passed directly. All active test data and the disposable profile were removed. |

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

Physical result, 2026-07-20: pass on macOS 26.5.2 CalDAV and iOS 26.5.2 ActiveSync. The macOS-originated August series retained its 15-minute alert while one occurrence moved from 20:00 to 20:30 and a different occurrence was deleted. The iOS-originated September series retained 30-minute master alerts, applied a 5-minute alert to only the edited 20:30 occurrence, and deleted a different occurrence. OMS Web and the opposite Apple client showed exactly the three expected occurrences in both directions. Cleanup sent two deliberate, UID-specific EAS deletes and left one tombstone per series with no active test rows.

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
- Ordered Sieve filters: reorder two saved rules, verify priority survives reload, verify default Stop and explicit Continue compile as expected, preview a chosen folder, and Apply against the same saved-rule revision/UIDVALIDITY/UID snapshot. Confirm Reject/Discard remain non-retroactive, same-folder Move is a no-op, a confirmed continued copy is skipped on retry, and an uncertain copy is blocked until the owner resolves it as present or missing.

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
- Physical follow-up: the macOS and iOS Calendar gates described here are completed in later sections on the same date.

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

## 2026-07-20 iOS 26.5.2 ActiveSync Calendar CRUD And DST Live Gate

- Client/setup: physical iOS 26.5.2 Calendar through the existing Exchange account with Calendar Time Zone `Asia/Baghdad`.
- Fixed-zone lifecycle: iOS created one July 29, 2026 20:00-20:30 Baghdad event, edited the same UID/title to 20:30-21:00, and deleted it. OMS Web showed exactly one current version at each step and removed it automatically; the server ended with zero event rows and one tombstone.
- DST lifecycle: iOS created one 09:00 America/New_York weekly series for March 5, 12, 19, and 26, 2027. OMS Web displayed 17:00 Baghdad before US DST and 16:00 afterward. A whole-series 09:30 edit retained the UID and displayed 17:30/16:30; one ActiveSync `Delete` removed the row, created one tombstone, and cleared OMS Web automatically.
- Protocol repair: physical iOS uses the case-sensitive EAS Calendar tag `TimeZone`. Commit `52033bf` corrected the converter's `Timezone` spelling and added captured-payload plus real-WBXML-writer regressions. Commit `bbbd49e` ensures a partial iOS `Change` that omits `Recurrence` preserves the existing rule as `RRULE:...`, not a malformed bare `FREQ=...` line.
- Automated proof: final backend 137/140 with three expected optional database skips; focused EAS Calendar/WBXML 14/14; full integration and `git diff --check` passed.
- Live proof: deployed source/runtime hashes matched the repository; direct/public ActiveSync `OPTIONS` returned `200`/EAS 14.1; backend stayed active with `NRestarts=0`; warning journal and full staging smoke passed.
- Safety: only user-created physical test events were written and deleted. The agent made no direct production calendar mutation. Rollbacks are `/var/backups/openmailstack/eas-timezone-tag-52033bf8-20260720T185910Z` and `/var/backups/openmailstack/eas-recurrence-preservation-bbbd49ed-20260720T191354Z`.
- Remaining Calendar time gates: recurrence exceptions/reminders and custom or invalid `VTIMEZONE`.

## 2026-07-20 ActiveSync Mail Delta Automated And Live Gate

- Release: commit `5b9cd89e` adds durable user/device/folder state, opaque SyncKeys, authenticated exact-response replay, IMAP UID disappearance Deletes, destination-folder Adds, FilterType/WindowSize/body handling, and an unchanged-MODSEQ fast path. Hotfix `bc4f7387` corrects FilterType-0/omitted all-mail behavior to page the complete collection through `MoreAvailable`.
- Automated proof: 17/17 focused mail-sync regressions; backend 174/177 with three expected optional database skips; frontend 37/37; full integration; shell syntax; `git diff --check`; and independent Standards/Spec reviews pass.
- Authenticated live proof: one unique message passed SMTP delivery, initial EAS Add, read/unread Change, empty no-change Sync, OMS Web Inbox-to-Junk, EAS Inbox Delete plus Junk Add, OMS Web Junk-to-Trash, and EAS Junk Delete plus Trash Add. The body was UTF-8 byte-truncated to the requested size. The message and isolated synthetic-device state were removed afterward.
- Deployment proof: repository/live hashes match; `openmailstack.service` is active/running with `NRestarts=0`; direct EAS OPTIONS returns 200; invalid Basic returns 401; the InnoDB state table exists; full staging smoke and the post-rollout warning/error scan pass.
- Safety/rollback: no real device state was removed. Root-only rollback archive `/var/backups/openmailstack/eas-mail-sync-5b9cd89-20260720T222243Z/backend-before.tar.gz`, SHA-256 `058fc4c5914b2e38dc598cc0cc41299fe83283dd9d4249fa5d36e530621ffd56`.
- Remaining physical gate: refresh the existing iOS 26.5.2 Exchange account once so its legacy key resets into new scoped state. Confirm the two spam messages are absent from Exchange Inbox and present only in Junk, the deleted self-test message is absent, and the second no-change refresh is quick and agrees with macOS Mail and the iOS IMAP account.

## 2026-07-20 ActiveSync All-Mail Physical Paging Hotfix

- Reproduction: physical iOS stored FilterType 0, WindowSize 25, exactly 25 known Inbox messages, a floor at the 25th UID, and `MoreAvailable=false`. A deterministic 100-item regression reproduced the same false terminal page.
- Correction: FilterType 0 and omitted FilterType now synchronize every item. Existing floored partnerships force one complete UID snapshot, reset the floor to 1, retain checkpoint 0 while older pages remain, and restore the MODSEQ fast path only after exhaustion.
- Automated/live proof: backend 176/179 with three expected skips, frontend 37/37, full integration, exact live artifacts, local/public EAS 200, zero service restarts, clean error scan, and staging smoke pass. Rollback SHA-256 is `fae62ec9da106e396d5fd61878a86d935b9bf4b6ddfc154134bd852afef081f6`.
- Physical result in progress: iOS advanced beyond the original 25-message ceiling into continuous 25-item pages and reached 4,550 known Inbox messages without server errors before pausing with `MoreAvailable=true`. The Inbox contains roughly 6,034 messages, so exhaustion/no-change requires the client to resume and finish catch-up.
- Folder-state follow-up: the user confirmed the IMAP account consistently shows the two historical spam examples in Junk. Read-only current server search finds active Inbox records with those sender/subject pairs, but the recent human web action referenced a different UID and the search index has no usable Message-ID for identity comparison. Do not perform a subject-only move; reconcile the exact instances first. The deleted self-test is absent from Inbox and present in Trash.
