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

Last checked: 2026-06-21 against `mail.housevo.us`.

| Area | Status | Evidence |
| --- | --- | --- |
| Core services | Pass | `nginx`, `mariadb`, `postfix`, `dovecot`, `rspamd`, `openmailstack`, `redis-server`, and `clamav-daemon` active. |
| Public listeners | Pass | TCP 25, 443, 587, and 993 reachable; UFW allows 25, 80, 443, 587, 993, and 995. |
| TLS names | Pass | Let's Encrypt certificate covers `mail.housevo.us`, `autodiscover.housevo.us`, and `webmail.housevo.us`; expires 2026-08-06. |
| Public DNS | Pass | `housevo.us` MX points to `mail.housevo.us`; `mail`, `autodiscover`, and `webmail` resolve to the public server address. |
| Web routes | Pass | `/` returns 200; `/api/auth/me` returns 401 unauthenticated; Roundcube `/webmail/` returns 200. |
| ActiveSync preflight | Pass | `OPTIONS /Microsoft-Server-ActiveSync` returns 200 and advertises EAS 14.0/14.1 commands. |
| Autodiscover | Pass | `mail.housevo.us` and `autodiscover.housevo.us` return MobileSync URL `https://mail.housevo.us/Microsoft-Server-ActiveSync`. |
| CalDAV/CardDAV preflight | Pass | `/.well-known/caldav` and `/.well-known/carddav` redirect; unauthenticated DAV requests return Basic auth challenges. |
| Authenticated scripted smokes | Pass | `mail_sync_smoke.sh`, `calendar_sync_smoke.sh`, `carddav_sync_smoke.sh`, and `activesync_contacts_smoke.sh` passed with `localtest@housevo.us`; password not recorded. Mail smoke used local IMAP `127.0.0.1:143` because the script is not configured for implicit-TLS IMAPS. |
| Real devices | Not run | No iPhone, macOS, Android, or Thunderbird client row has been completed yet. |

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
| iPhone Exchange | Add Exchange account, send and receive a self-message with an attachment, confirm Sent copy. | Enable Calendars, verify existing event, create/edit/delete a phone event and confirm in web calendar. | Enable Contacts, verify existing contact, create/edit/delete a phone contact and confirm in web contacts/CardDAV. | Not run | Autodiscover should avoid manual server URL entry; if prompted, use `mail.housevo.us`. |
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
- CardDAV address book round trip: PUT vCard, PROPFIND address book, REPORT `addressbook-query`/`addressbook-multiget`, GET vCard, DELETE vCard.
- Authenticated smoke: `OMS_SMOKE_USER=<mailbox> OMS_SMOKE_PASSWORD=<password> rtk bash tests/integration/carddav_sync_smoke.sh`.

Mobile Sync:

- iOS account setup using Exchange autodiscover.
- ActiveSync OPTIONS, FolderSync, Sync, SendMail, Ping.
- Account password change rejects old credentials and accepts new credentials.
- Remove/re-add account does not require manual server URL edits.

Security:

- Session cookie is HttpOnly, SameSite=Lax, Secure over HTTPS.
- SSE `/api/events` has no token in the URL.
- Login rate limit triggers after repeated failures.
- CalDAV Basic auth rejects wrong password and does not expose calendar data.
- No committed production secrets in repo diffs or packaged docs.
