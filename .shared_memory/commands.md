# Commands

Repo instruction:

```bash
rtk <command>
```

Useful inventory:

```bash
rtk git status --short
rtk rg --files -g '!**/node_modules/**' -g '!**/.git/**'
rtk rg -n "TODO|FIXME|HACK|mock|hardcoded" -g '!**/node_modules/**' -g '!**/dist/**'
```

Installer checks:

```bash
rtk bash ./install.sh --dry-run
rtk bash ./tests/lint/run.sh
rtk bash ./tests/integration/run.sh
```

Frontend checks:

```bash
rtk npm --prefix webmail-frontend run lint
rtk npm --prefix webmail-frontend run build
```

Scheduler release checks:

```bash
rtk node tests/integration/scheduler_phase1_guard.cjs
rtk node tests/integration/scheduler_phase3_guard.cjs
rtk node tests/integration/scheduler_docs_guard.cjs
rtk bash /tmp/oms-scheduler-single-use-db-test.sh
rtk bash tests/integration/run.sh
rtk systemctl status openmailstack-scheduler-worker.service --no-pager
rtk journalctl -u openmailstack-scheduler-worker.service --since '15 minutes ago' --no-pager
```

When comparing a tested backend to `/opt/openmailstack-backend`, exclude `node_modules`, `.npm`, and persistent `uploads`. Deployment must also exclude `uploads` from `rsync --delete`.

`webmail-frontend run lint` is currently expected to exit 0 with warnings for
the staged `any` typing cleanup and React compiler-style hook migration.

Backend notes:

- `webmail-backend/package.json` has a working build script:

```bash
rtk npm --prefix webmail-backend run build
```

- Focused backend unit tests currently cover Sieve compiler escaping/round-trip behavior:

```bash
rtk npm --prefix webmail-backend test
```

- `packaging/systemd/openmailstack.service` runs `node src/index.js`; keep generated backend JS in sync until deployment switches to a different runtime artifact.
- Current code listens on `127.0.0.1:20000` by default through `OMS_WEBMAIL_HOST` and `OMS_WEBMAIL_PORT`.

Live client-validation preflight:

```bash
rtk bash tests/integration/staging_smoke.sh ./config.conf
rtk bash -lc 'for host in mail.housevo.us autodiscover.housevo.us webmail.housevo.us; do echo "== $host:443"; openssl s_client -connect "$host:443" -servername "$host" </dev/null 2>/dev/null | openssl x509 -noout -subject -issuer -ext subjectAltName -dates; done'
rtk bash -lc 'for q in A AAAA MX; do echo "== housevo.us $q"; dig +short @1.1.1.1 housevo.us "$q"; done; for name in mail.housevo.us autodiscover.housevo.us webmail.housevo.us; do echo "== $name A"; dig +short @1.1.1.1 "$name" A; echo "== $name AAAA"; dig +short @1.1.1.1 "$name" AAAA; done'
rtk bash -lc 'curl -k -sS -D - -o /dev/null -X OPTIONS https://mail.housevo.us/Microsoft-Server-ActiveSync | sed -n "1,40p"'
```

On this Debian 13/OpenSSL 3 host, the SMTP STARTTLS certificate chain is emitted on stderr. Smoke checks must capture both stdout and stderr, then require both `BEGIN CERTIFICATE` and `Verify return code: 0 (ok)`; redirecting stderr to `/dev/null` produces a false failure.

Live iPhone Exchange validation helpers:

```bash
rtk journalctl -u openmailstack -f -g 'ActiveSync|Microsoft-Server-ActiveSync|Error handling ActiveSync|Unknown tag'
rtk journalctl -u openmailstack --since '10 minutes ago' --no-pager -g 'ActiveSync|Microsoft-Server-ActiveSync|Error handling ActiveSync|Unknown tag'
```

SMTP submission health probe:

```bash
rtk curl -v --connect-timeout 8 --max-time 8 telnet://127.0.0.1:587
```

Authenticated client-protocol smokes:

```bash
rtk bash functions/provision_protocol_canary.sh
rtk bash tests/integration/protocol_release_gate.sh
rtk bash functions/protocol_guarded_deploy.sh webmail
rtk bash functions/protocol_guarded_deploy.sh dovecot

# Focused optional diagnostics:
OMS_SMOKE_USER=<mailbox> OMS_SMOKE_PASSWORD=<password> OMS_SMOKE_IMAP_HOST=127.0.0.1 OMS_SMOKE_IMAP_PORT=143 rtk bash tests/integration/mail_sync_smoke.sh
OMS_SMOKE_USER=<mailbox> OMS_SMOKE_PASSWORD=<password> rtk bash tests/integration/calendar_sync_smoke.sh
OMS_SMOKE_USER=<mailbox> OMS_SMOKE_PASSWORD=<password> rtk bash tests/integration/carddav_sync_smoke.sh
OMS_SMOKE_USER=<mailbox> OMS_SMOKE_PASSWORD=<password> rtk bash tests/integration/activesync_mail_smoke.sh
OMS_SMOKE_USER=<mailbox> OMS_SMOKE_PASSWORD=<password> rtk bash tests/integration/activesync_contacts_smoke.sh
```

Safe Sieve delivery diagnostics:

```bash
rtk doveadm user <mailbox>
rtk doveadm sieve list -u <mailbox>
rtk sieve-test -r <mailbox> <active-source.sieve> <message.eml>
rtk journalctl -u dovecot --since '10 minutes ago' --no-pager --grep='sieve|fileinto|Failed to retrieve script'
```

The Dovecot user output must contain an absolute `home` as well as `mail_path`.
For compilation diagnostics, write `sievec` output to a dedicated temporary
regular file. Never pass `/dev/null` or another device as the output path.

Authenticated browser validation:

- `localtest@housevo.us` is the established Admin test account for read-only UI and authorization checks.
- Retrieve its password only from the existing secure local credential source at runtime. Never copy it into commands that print their arguments, screenshots, Playwright artifacts, documentation, commits, or shared memory.
- Scheduler is currently disabled for this mailbox; use public Scheduler routes for guest booking-flow checks unless a task explicitly authorizes changing the entitlement.

Disposable Calendar interoperability preflight (no mailbox or real database):

```bash
rtk node --test webmail-backend/test/calendar-format.test.cjs webmail-backend/test/caldav-roundtrip.test.cjs webmail-backend/test/eas-calendar.test.cjs webmail-backend/test/scheduler-availability.test.cjs
rtk node --test webmail-frontend/test/calendar-time.test.cjs
```

These fixtures model Apple-style CalDAV and iOS-shaped ActiveSync payloads but do not replace the physical-client matrix in `docs/webmail-release-validation.md`.

Calendar timezone release checks:

```bash
rtk node --test webmail-backend/test/calendar-format.test.cjs webmail-backend/test/eas-calendar.test.cjs
rtk curl -fsS -o /dev/null -w '%{http_code}\n' -X OPTIONS http://127.0.0.1:20000/Microsoft-Server-ActiveSync
rtk curl -fsS -o /dev/null -w '%{http_code}\n' -X OPTIONS --resolve mail.housevo.us:443:127.0.0.1 https://mail.housevo.us/Microsoft-Server-ActiveSync
```

For the physical DST matrix, create a weekly `America/New_York` series at 09:00 on 2027-03-05 with four occurrences. In `Asia/Baghdad` it should display at 17:00 on March 5/12 and 16:00 on March 19/26 because New York changes offset on March 14. Run create/edit/delete from macOS Calendar over CalDAV and physical iOS over ActiveSync; record exact client versions and do not mark the rows passed from scripted payloads alone.

`protocol_release_gate.sh` is the mandatory installed-host release check and
uses strict public IMAPS 993 plus public ActiveSync. `mail_sync_smoke.sh` is a
focused diagnostic configured for cleartext/STARTTLS-style port 143 by default;
it does not replace the public gate or real-device validation.

Memory maintenance:

```bash
rtk sed -n '1,220p' .shared_memory/README.md
rtk git status --short -- .shared_memory
```
