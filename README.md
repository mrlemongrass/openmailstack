# OpenMailStack

OpenMailStack is a self-hosted mail and groupware suite. The product goal is a modern open-source alternative to iCloud Mail, Gmail, and Outlook Web: mail, calendar, contacts, notes, admin controls, and client sync that remain understandable to operate on a Linux server.

The current stack combines standard mail-server components with a native React/Node web suite:

- Postfix and Dovecot for SMTP, LMTP, IMAP, auth, and mailbox storage.
- MariaDB for domains, mailboxes, admins, user settings, contacts, calendars, audit records, and modern app state.
- Rspamd, optional ClamAV, Fail2ban, UFW, Nginx, PHP-FPM, and Let's Encrypt for the mail-server perimeter.
- `webmail-frontend`, the canonical React/Vite app for Mail, Calendar, Contacts, Notes, Settings, Sync Info, and Admin.
- `webmail-backend`, the Node/Express API and sync proxy for webmail, CalDAV, CardDAV, ActiveSync, autodiscover, admin APIs, and protocol smokes.
- Roundcube and PostfixAdmin as legacy/fallback surfaces, not the destination product experience.

## Current Status

OpenMailStack is under active development. The live validation focus is real client interoperability:

- iOS Exchange/ActiveSync mail receive/send, Sent copy, attachment send, calendar create/edit/delete, and contacts create/edit/delete have passed on the live server after the July 2026 protocol fixes.
- macOS Calendar and Contacts work through CalDAV/CardDAV, with documented recovery notes for stale local Apple caches after earlier server-side protocol changes.
- Scripted local and public smokes cover mail, calendar, CardDAV, ActiveSync mail, and ActiveSync contacts.
- Clean-VM installer validation remains a release blocker and is intentionally lower priority than live-server stabilization until another Linux LXC is available.

See [docs/webmail-release-validation.md](docs/webmail-release-validation.md) for the current release gate and client matrix.

## Repository Map

| Path | Purpose |
| --- | --- |
| `webmail-frontend/` | Canonical React/Vite product frontend. |
| `webmail-backend/` | Node/Express API, sync proxy, ActiveSync, CalDAV, CardDAV, and app APIs. |
| `functions/` | Installer modules for the Linux mail stack and modern webmail deployment. |
| `admin_portal_src/` | Legacy PHP admin/self-service portal surface. |
| `tests/integration/` | Static installer guards, the mandatory installed-host IMAPS/ActiveSync gate, and optional authenticated calendar/contact smokes. |
| `docs/engineering/` | Architecture, quality bar, product loop, release criteria, and worklog. |
| `docs/product/` | Product plans such as OMS Scheduler. |
| `.shared_memory/` | Repo-specific implementation notes, commands, risks, and change history for future agents. |

## Documentation

- [INSTALLATION.md](INSTALLATION.md): fresh-server install and operational access guide.
- [docs/engineering/ARCHITECTURE.md](docs/engineering/ARCHITECTURE.md): source-of-truth technical architecture, with status labels.
- [ROADMAP.md](ROADMAP.md): current product and release roadmap.
- [docs/product/scheduler.md](docs/product/scheduler.md): planned OMS Scheduler product and engineering contract.
- [TECHNICAL.md](TECHNICAL.md): short pointer to the canonical architecture document.

Older docs may describe intended behavior. When docs and code disagree, trust current code, tests, live configuration when safely inspected, then update the docs.

## Quick Start

Use a fresh supported server and run as `root`:

```bash
git clone https://github.com/mrlemongrass/openmailstack.git
cd openmailstack
chmod +x setup_config.sh install.sh
./setup_config.sh
./install.sh
```

Before installing, make sure:

- Outbound port 25 is unblocked by the hosting provider.
- `mail.example.com` points to the server.
- Reverse DNS/PTR can be set to the mail hostname.
- The server has at least 2 GB RAM if ClamAV is enabled.

## Access After Install

| Surface | URL |
| --- | --- |
| Modern webmail suite | `https://mail.example.com/` |
| Modern Admin | `https://mail.example.com/admin` |
| Legacy admin portal | `https://mail.example.com/SOGo/admin` |
| Legacy Roundcube fallback | `https://mail.example.com/webmail` |
| PostfixAdmin fallback | `https://mail.example.com/postfixadmin` |

## Development Checks

Run from the repository root. This host expects commands to be prefixed with `rtk`.

```bash
rtk bash ./tests/lint/run.sh
rtk bash ./tests/integration/run.sh
rtk npm --prefix webmail-backend test
rtk npm --prefix webmail-backend run build
rtk npm --prefix webmail-frontend run lint
rtk npm --prefix webmail-frontend run build
```

Notes:

- `webmail-frontend run lint` is currently a clean green gate with zero warnings.
- `webmail-frontend run build` is below the documented 500 kB main-chunk target and currently emits no Vite chunk-size advisory.
- `packaging/systemd/openmailstack.service` still runs generated backend JavaScript, so keep backend `.js`, `.d.ts`, and source maps in sync with TypeScript changes.

## Live Validation

Provision the dedicated protocol canary once on an installed host, then use the
fail-closed public protocol gate and guarded deployment entry points:

```bash
rtk bash functions/provision_protocol_canary.sh
rtk bash tests/integration/protocol_release_gate.sh
rtk bash functions/protocol_guarded_deploy.sh webmail-bridge
rtk bash functions/protocol_guarded_deploy.sh webmail
rtk bash functions/protocol_guarded_deploy.sh dovecot
```

Webmail releases are bridge-first. `webmail-bridge` temporarily pauses every
new web, scheduled, and ActiveSync send plus scheduled-worker and
cancellation/removal mutations; status reads remain available. Run `webmail`
immediately after the bridge passes. The active step requires the live mode to
be exactly the attested bridge. The first failed bridge can automatically
recover its freshly captured legacy runtime because the bridge accepted no
outbound mutations. After the bridge succeeds, legacy rollback is unsafe and
rejected; only compatible guarded bridge/active snapshots can be selected.

Hosts provisioned before the dedicated identity marker was introduced must use
the explicit migration command once:

```bash
rtk bash functions/provision_protocol_canary.sh --rotate-legacy
```

That mode only accepts the exact active `OMS Protocol Canary` mailbox with an
empty legacy marker, exact active self-alias, matching root-only credential,
and a credential password that verifies against the stored mailbox hash. It
preserves the mailbox row and maildir, rotates the password, and installs the
new attestation. Normal provisioning never migrates a legacy mailbox.

The generated credential and identity remain root-only under
`/etc/openmailstack`; they are
never printed or stored in the repository. The gate uses the same disposable
message to prove public IMAPS 993 body retrieval and ActiveSync full-MIME sync,
then removes its mail, web session, and synthetic device state. Once
provisioned, direct webmail and Dovecot module runs fail closed so releases use
the guarded pre-check, rollback snapshot, and post-check workflow.

Other authenticated smokes remain opt-in and require a real test mailbox:

```bash
OMS_SMOKE_BASE_URL=https://mail.example.com \
OMS_SMOKE_USER=localtest@example.com \
OMS_SMOKE_PASSWORD='...' \
rtk bash tests/integration/calendar_sync_smoke.sh
```

Available smoke scripts include:

- `mail_sync_smoke.sh`
- `calendar_sync_smoke.sh`
- `carddav_sync_smoke.sh`
- `activesync_mail_smoke.sh`
- `activesync_contacts_smoke.sh`

Do not store real mailbox passwords, tokens, cookies, or private message content in repository docs.
