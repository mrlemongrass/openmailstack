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

Authenticated client-protocol smokes:

```bash
OMS_SMOKE_USER=<mailbox> OMS_SMOKE_PASSWORD=<password> OMS_SMOKE_IMAP_HOST=127.0.0.1 OMS_SMOKE_IMAP_PORT=143 rtk bash tests/integration/mail_sync_smoke.sh
OMS_SMOKE_USER=<mailbox> OMS_SMOKE_PASSWORD=<password> rtk bash tests/integration/calendar_sync_smoke.sh
OMS_SMOKE_USER=<mailbox> OMS_SMOKE_PASSWORD=<password> rtk bash tests/integration/carddav_sync_smoke.sh
OMS_SMOKE_USER=<mailbox> OMS_SMOKE_PASSWORD=<password> rtk bash tests/integration/activesync_contacts_smoke.sh
```

`mail_sync_smoke.sh` uses an IMAP client configured for cleartext/STARTTLS-style
port 143, not implicit-TLS IMAPS on 993. Keep real device setup on public IMAPS
993 with SSL/TLS.

Memory maintenance:

```bash
rtk sed -n '1,220p' .shared_memory/README.md
rtk git status --short -- .shared_memory
```
