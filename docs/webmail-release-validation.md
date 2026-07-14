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

Last checked: 2026-07-11 against `mail.housevo.us`.

| Area | Status | Evidence |
| --- | --- | --- |
| Core services | Pass | `staging_smoke.sh ./config.conf` confirmed `nginx`, `mariadb`, `postfix`, `dovecot`, `rspamd`, `openmailstack`, `redis-server`, and `clamav-daemon` active. |
| Public listeners | Pass | `staging_smoke.sh ./config.conf` confirmed TCP 25, 80, 443, 587, 993, backend port 20000, and optional 995 listening. |
| TLS names | Pass | Local TLS check confirmed certificate SANs for `mail.housevo.us`, `autodiscover.housevo.us`, and `webmail.housevo.us`; expires 2026-10-05. |
| Public DNS | Pass | External DNS lookup confirmed `housevo.us` MX points to `mail.housevo.us`; `mail`, `autodiscover`, and `webmail` resolve to the public server address. |
| Web routes | Pass | `/` returns 200; `/api/auth/me` returns 401 unauthenticated; Roundcube `/webmail/` returns 200. |
| ActiveSync preflight | Pass | `OPTIONS /Microsoft-Server-ActiveSync` returns 200 and advertises EAS 14.0/14.1 commands. |
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
| macOS Mail/Calendar/Contacts | Add IMAP account in Mail with SMTP submission, send and receive a self-message. | Add CalDAV account in Calendar through discovery or fallback URL, create/edit/delete an event both ways. | Add CardDAV account in Contacts through discovery or fallback URL, create/edit/delete a contact both ways. | Not run | Keep mail, calendar, and contacts as separate IMAP/CalDAV/CardDAV accounts. |
| Android mail plus DAVx5 | Add IMAP/SMTP account in the chosen mail app, send and receive a self-message. | Add CalDAV in DAVx5, verify synced calendar, create/edit/delete an Android event and confirm in web calendar. | Add CardDAV in DAVx5, verify synced address book, create/edit/delete an Android contact and confirm in web contacts. | Not run | Use DAVx5 with the discovery URL first; fall back to `/caldav/` and `/carddav/` if discovery fails. |
| Thunderbird desktop | Add IMAP/SMTP account, send and receive a self-message. | Add network calendar with CalDAV discovery/fallback URL, create/edit/delete an event both ways. | Add CardDAV address book with discovery/fallback URL, create/edit/delete a contact both ways. | Not run | Record Thunderbird version because DAV behavior can vary by release. |

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
