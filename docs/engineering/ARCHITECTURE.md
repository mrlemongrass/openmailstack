# OpenMailStack Technical Architecture

> **Purpose:** This document is the architecture source of truth for OpenMailStack, but it is intentionally editable. It should describe what the repository and deployed system actually do, what is partially implemented, and what is planned.
>
> **Important:** This file was converted from the older root-level `TECHNICAL.md`. It has **not** been independently verified against the current repository state at conversion time. AI agents and human maintainers should verify claims against code, tests, scripts, configs, and runtime behavior before relying on them.

---

## 0. Document Maintenance Policy

This document is not sacred. It should evolve with the codebase.

AI agents may update `docs/engineering/ARCHITECTURE.md` when they discover evidence that this document is incomplete, stale, misleading, or wrong.

### 0.1 Source-of-truth order

When this document conflicts with reality, trust evidence in this order:

1. Current running production/staging configuration, when safely available and explicitly permitted
2. Current repository code and configuration
3. Tests, CI, and reproducible local execution
4. Installation scripts and migrations
5. Recent commits and worklog entries
6. This document
7. Older README or marketing copy

### 0.2 Status labels

Every major subsystem, feature, or integration should use one of these labels:

- `Implemented` — exists in the repository and has evidence that it works
- `Partial` — exists but is incomplete, fragile, limited, or not fully tested
- `Planned` — intended product direction, not yet implemented
- `Legacy` — retained for compatibility, fallback, migration, or administrative reasons
- `Needs Verification` — documented here, but the current code must be inspected before relying on it
- `Deprecated` — scheduled for removal or replacement

Prefer `Needs Verification` when uncertain. Do not upgrade a feature to `Implemented` unless there is code and proof.

### 0.3 How agents should update this file

Agents may modify this file if they follow these rules:

- Preserve useful historical information, but relabel stale claims instead of deleting them silently.
- Distinguish observed facts from product ambitions.
- Add file paths, script names, service names, ports, table names, and commands only after verifying them.
- If a claim is inferred, mark it as inferred.
- If a feature is partially present, mark it `Partial` and explain what remains.
- If a feature is only desired, mark it `Planned`.
- If a feature is not found after inspection, mark it `Needs Verification` or move it to a “Planned or Unverified” subsection.
- Update `docs/engineering/WORKLOG.md` Always append a concise WORKLOG.md entry before finishing. Update ARCHITECTURE.md only when useful and evidence-based.
- Do not use this document to justify broad rewrites without code evidence and acceptance criteria.

### 0.4 Suggested verification entry format

When a subsystem is verified, add a short note like this:

```md
Status: Partial
Last verified: 2026-07-02 by agent/human, commit `<short-sha>`
Evidence: `webmail-backend/src/server.ts`, `package.json`, `npm test`
Notes: Express backend starts locally; ActiveSync route exists but lacks integration coverage.
```

---

## 1. Product and System Overview

Status: `Partial - Deployed`

OpenMailStack is intended to be a free and open-source mail platform with a modern webmail experience comparable in ambition to iCloud Mail, Gmail, and Office 365 Outlook Web.

The system appears to combine:

- a Linux-based mail server stack
- Postfix for SMTP/MTA behavior
- Dovecot for IMAP/POP3/authentication/LMTP behavior
- MariaDB for mail-domain/account/admin metadata
- Rspamd and optional ClamAV for anti-spam and malware scanning
- Nginx and PHP-FPM for admin and legacy web surfaces
- a custom Admin Portal layered over the PostfixAdmin database model
- a modern webmail frontend
- a modern webmail backend
- calendar, contacts, notes, and sync-related ambitions
- SOGo ActiveSync work, location and completeness to be verified

### 1.1 Product goal

OpenMailStack should become:

- fast and responsive
- polished and coherent
- self-hostable
- privacy-respecting
- operationally transparent
- easy to install and recover
- secure by default
- understandable to administrators
- pleasant for non-technical end users

### 1.2 Architecture warning

Some sections below describe intended or previously documented behavior. They are not guarantees that the current repository implements every item completely.

Agents must inspect the current codebase before assuming that any listed webmail, sync, JMAP, ActiveSync, collaborative editing, SSE, calendar, contact, or notes feature is fully implemented.

---

## 2. Repository and Documentation Map

Status: `Needs Verification`

Expected high-level documentation and agent files:

```text
AGENTS.md
CLAUDE.md
TECHNICAL.md                         # Optional root-level pointer to this file
docs/
  engineering/
    OPENMAILSTACK_PRODUCT_LOOP.md     # Agent operating model
    QUALITY_BAR.md                    # Product quality bar and task-selection rubric
    ARCHITECTURE.md                   # This file
    WORKLOG.md                        # Rolling work notes, findings, proof, and follow-ups
```

Expected high-level code areas, based on the prior technical document:

```text
install.sh
setup_config.sh
functions/
admin_portal_src/
webmail-frontend/
webmail-backend/
```

Agents should verify the actual repository layout during repository intake and update this section if paths differ.

---

## 3. Deployment Orchestrator

Status: `Needs Verification`

OpenMailStack is documented as being deployed through Bash scripts orchestrated by `install.sh`.

The intended design is transparent deployment using standard GNU/Linux tooling instead of an opaque compiled installer.

### 3.1 Configuration parsing

Status: `Needs Verification`

The user is expected to generate a `config.conf` file through `setup_config.sh`.

`install.sh` is documented as loading this configuration into environment variables. These variables may include:

- database passwords
- fully qualified domain names
- feature toggles
- optional component choices, such as ClamAV installation

Agents should verify:

- where `config.conf` is generated
- whether secrets are properly protected
- whether generated files use safe permissions
- whether config values are validated before use
- whether dangerous defaults are avoided

### 3.2 Installation pipeline

Status: `Needs Verification`

The older technical document described `install.sh` as executing scripts in `functions/` sequentially.

Expected pipeline:

| Step | Script | Documented responsibility | Status |
|---:|---|---|---|
| 0 | `00_preflight.sh` | Safety snapshot, OS compatibility, outbound port 25 check | Needs Verification |
| 1 | `01_mariadb.sh` | Install/provision MariaDB and secure it | Needs Verification |
| 2 | `02_nginx_php.sh` | Install Nginx and PHP-FPM | Needs Verification |
| 3 | `03_postfixadmin.sh` | Install legacy PostfixAdmin interface and/or database schema | Needs Verification |
| 4 | `04_postfix_dovecot.sh` | Configure Postfix, Dovecot, SQL lookup maps, LMTP/SASL | Needs Verification |
| 5 | `05_rspamd_clamav.sh` | Install/configure Rspamd, optional ClamAV, DKIM generation | Needs Verification |
| 6 | `06_roundcube.sh` | Install legacy Roundcube fallback webmail | Needs Verification |
| 7 | `07_fail2ban.sh` | Install/configure Fail2ban jails | Needs Verification |
| 8 | `08_ufw_ssl.sh` | Configure UFW firewall and Let’s Encrypt certificates | Needs Verification |
| 9 | `09_admin_portal.sh` | Deploy custom Admin Portal and sudoers bridge | Needs Verification |
| 10 | `10_webmail.sh` | Build/deploy modern webmail frontend/backend and Nginx routes | Needs Verification |

Agents should verify whether these scripts exist, whether they are idempotent, whether they are safe to re-run, and whether they make destructive changes.

### 3.3 Deployment safety concerns

Status: `Needs Verification`

Agents should pay special attention to:

- secret handling in shell scripts
- `sudoers` modifications
- file ownership and permissions
- service restarts
- database migrations and schema changes
- certificate issuance and renewal
- rollback behavior
- snapshots and recovery behavior
- idempotency of repeated installs or upgrades
- handling of partially failed installs

---

## 4. Mail Delivery Architecture

Status: `Needs Verification`

OpenMailStack is documented as using virtual mailboxes rather than local Linux system users for email accounts.

The intended model:

- email accounts are stored in MariaDB
- no per-mailbox Linux users are created in `/etc/passwd`
- mail is stored under a virtual mailbox directory
- Postfix performs MTA duties
- Dovecot performs IMAP/authentication/delivery duties
- Rspamd scans mail through a milter integration

### 4.1 Postfix

Status: `Needs Verification`

Documented responsibilities:

- receive mail on SMTP port 25
- handle authenticated submission on port 587
- query MariaDB to validate domains, mailboxes, and aliases
- use the PostfixAdmin-compatible schema, including tables such as:
  - `domain`
  - `mailbox`
  - `alias`
- pass valid local mail to Dovecot over LMTP
- send messages through Rspamd via milter before delivery

Previously documented integration points:

```text
/var/run/dovecot/lmtp
inet:localhost:11332
mysql_virtual_mailbox_maps.cf
```

Agents should verify all paths, sockets, ports, SQL map files, and service configuration before relying on them.

### 4.2 Dovecot

Status: `Authentication, storage paths, and Sieve delivery verified 2026-07-30`

The live host runs Dovecot 2.4.1. Its ordered passdb list contains a root-owned
master-user passwd-file, an SQL app-password passdb, and an SQL mailbox-password
passdb. App passwords are SHA-256 digests stored in `app_passwords` and are
accepted only while the matching `account_security` row has two-factor
authentication enabled. Enabling two-factor authentication blocks the mailbox
password at Dovecot while leaving named app passwords available to IMAP, SMTP
submission, ManageSieve, and CalDAV; the internal master identity remains
available for bounded backend work. The Dovecot 2.4 custom-named SQL passdbs use
`sql_query`; the legacy 2.3 rendering retains its compatible syntax.

Public IMAP TLS uses the same hostname-valid certificate selected by the
security module. `functions/04_dovecot.sh` preserves an existing valid
certificate/key pair when it rewrites `local.conf`, or recovers the matching
pair from the deterministic Let's Encrypt/self-signed locations. Both hostname
coverage and certificate/key public-key equality are checked first. The live
staging smoke verifies port 993 with `mail.housevo.us`, not merely that a TLS
handshake returns some certificate.

The SQL userdb returns both an absolute `home` and `mail_path`, each rooted at
`/var/vmail/<domain>/<user>`. This is a delivery invariant, not duplicate
metadata: the personal Sieve storage is configured beneath `~/sieve`, so LMTP
and ManageSieve require a resolved per-user home to find the active script.
`tests/integration/auth_hardening_guard.cjs` prevents the Dovecot 2.4 query from
dropping either field. A disposable live LMTP delivery on 2026-07-30 exercised
an active `fileinto` rule and stored the message only in its target mailbox.

Documented responsibilities:

- serve IMAP, likely on port 993 for TLS
- optionally serve POP3, depending on install/config
- provide SASL authentication for Postfix submission
- receive mail from Postfix via LMTP
- authenticate users against MariaDB
- store mailbox data in Maildir format

Previously documented storage and ownership model:

```text
/var/vmail/<domain>/<user>/
vmail:vmail
UID 5000
```

Previously documented password schemes:

- `SHA512-CRYPT`
- Argon2, depending on Dovecot support and configuration

Remaining verification:

- enabled protocols
- password scheme support
- Maildir path format
- UID/GID ownership
- quota support
- LMTP socket configuration
- SQL query files
- auth failure behavior

### 4.3 Rspamd and ClamAV

Status: `Needs Verification`

Documented responsibilities:

- spam scoring
- DKIM verification/signing support
- optional ClamAV malware scanning
- milter integration with Postfix
- local web UI on Rspamd’s default HTTP port

Agents should verify:

- whether ClamAV is optional or always installed
- whether Rspamd is configured through generated files or static templates
- DKIM key generation path
- DKIM selector behavior
- local Rspamd UI protection
- log privacy
- false-positive handling

### 4.4 Roundcube fallback

Status: `Legacy / Needs Verification`

The older document describes Roundcube as a legacy fallback webmail client.

Agents should verify:

- whether Roundcube is installed by default
- whether it is optional
- whether it shares auth with Dovecot/MariaDB
- whether it remains supported
- whether modern webmail is intended to replace it

---

## 5. Admin Portal

Status: `Authentication and authorization verified 2026-07-29`

The endpoint-by-endpoint inventory is maintained in
`docs/engineering/ADMIN_RBAC_AUDIT.md`. All 47 modern Node Admin routes require
an authenticated web session and a fresh active-superadmin database check.
Legacy PHP actions use explicit policies for global-superadmin operations,
domain-scoped administration, self-service, and quarantine ownership. The
modern React Admin remains intentionally superadmin-only.

The custom Admin Portal is documented as living in `admin_portal_src/` and being deployed under something like:

```text
/var/www/openmailstack-admin/
```

It is intended to provide a simpler management surface over the PostfixAdmin-compatible database schema.

### 5.1 Backend API: `api.php`

Status: `RBAC boundary verified 2026-07-29`

Previously documented characteristics:

- PHP backend
- dependency-light or dependency-free design
- PDO connection to MariaDB
- PHP session-based authentication
- action routing through a `switch($action)` style endpoint
- prepared SQL statements
- role-based access control

Previously documented roles:

- `superadmin` — can view/modify all domains
- domain admin — restricted to domains linked through `domain_admins`
- standard mailbox user — limited self-service access

Previously documented security behavior:

- regular mailbox users can be promoted to administrators
- their existing hashed mailbox password may be duplicated into the `admin` table
- plaintext passwords should not be stored

Verified controls:

- current auth flow
- CSRF protections
- session cookie flags
- RBAC enforcement server-side
- SQL injection defenses
- password verification logic
- audit logging coverage
- multi-tenant boundary enforcement
- error response behavior
- whether any shell commands are reachable from the web UI

### 5.2 REST integration API: `api_v1.php`

Status: `Global bearer-key boundary verified 2026-07-29`

This integration API is superadmin-provisioned and global by design. Keys are
hashed at rest, shown once, revocable, and audited. Per-key domain scopes are not
implemented; adding scoped integration keys requires a new authorization model,
not implicit reuse of legacy domain-admin sessions.

The older document describes a stateless JSON API endpoint for external provisioning systems.

Documented path:

```text
/api_v1.php
```

Documented auth model:

```text
Authorization: Bearer sk_...
```

Documented capabilities:

- CRUD operations for domains
- CRUD operations for mailboxes
- CRUD operations for aliases
- audit log traceability
- API keys hashed in database
- plaintext API key displayed once during creation

Remaining verification or future scope:

- actual endpoint path
- HTTP methods
- request/response format
- key hashing behavior
- key display behavior
- rate limiting
- audit coverage
- input validation
- authorization boundaries
- whether keys can be revoked
- whether key scopes exist

### 5.3 Admin Portal frontend

Status: `Needs Verification`

Previously documented characteristics:

- Vanilla JavaScript and CSS
- no major frontend framework
- browser `fetch()` API calls to `api.php`
- responsive sidebar navigation
- dynamic modal rendering
- modern glassmorphism styling

Agents should verify:

- frontend source location
- current UI organization
- accessibility state
- mobile behavior
- error handling
- loading states
- whether user/admin boundaries are visible and enforced

---

## 6. Modern Webmail Application and Sync Layer

Status: `Needs Verification`

The modern end-user product surface is documented as living in:

```text
webmail-frontend/
webmail-backend/
```

This area is the most likely to contain aspirational or partial features. Agents must inspect current source files before treating listed features as implemented.

### 6.1 Frontend architecture

Status: `Needs Verification`

Previously documented stack:

- React
- Vite
- TypeScript
- React Router
- custom CSS theme
- responsive desktop/mobile layout
- no external component library

Previously documented route examples:

```text
/mail/inbox/123
/calendar/month
/contacts
/notes
/settings/:tab
/admin/:panel
/sync
```

Agents should verify:

- package versions in `package.json`
- actual router configuration
- build command
- test command
- lint/typecheck setup
- whether generated/dist files are committed
- whether frontend is deployed by `10_webmail.sh`

### 6.2 Frontend layout model

Status: `Needs Verification`

Previously documented layout:

```text
Auth gate
  → App shell
    → header
    → mobile tab bar
    → per-app layouts
```

Desktop mail UI is documented as a multi-pane layout. Mobile is documented as a single-pane drill-down below approximately 768px.

Agents should verify:

- actual breakpoint values
- keyboard navigation
- screen reader labels
- focus management
- route transitions
- loading, empty, and error states
- responsiveness under large data sets

### 6.3 Previously documented frontend source map

Status: `Needs Verification`

The older technical document listed this source organization. Treat it as a map to verify, not a guarantee.

```text
src/
├── App.tsx
├── shared/
│   ├── types.ts
│   ├── api.ts
│   ├── hooks/
│   ├── components/
│   └── layouts/
├── mail/
│   ├── hooks/useMail.ts
│   ├── FolderSidebar.tsx
│   ├── MessageList.tsx
│   ├── MessageRow.tsx
│   ├── MessageViewer.tsx
│   ├── ComposeModal.tsx
│   ├── SearchBar.tsx
│   └── components/
├── calendar/
│   ├── hooks/useCalendar.ts
│   ├── CalendarSidebar.tsx
│   ├── CalendarToolbar.tsx
│   ├── EventModal.tsx
│   └── views/
├── contacts/
│   ├── hooks/useContacts.ts
│   ├── ContactSidebar.tsx
│   ├── ContactGrid.tsx
│   └── components/
├── notes/
│   ├── hooks/useNotes.ts
│   ├── NotesSidebar.tsx
│   ├── NotesGrid.tsx
│   ├── LiveNoteEditor.tsx
│   └── components/
├── settings/
└── admin/
```

Agents should update this tree after inspecting the repository.

### 6.4 Webmail feature inventory

Status: `Needs Verification`

The following feature list is a product/implementation inventory seed. It is not proof of implementation.

Agents should reclassify each feature as `Implemented`, `Partial`, `Planned`, or `Not Found` after code inspection.

#### Mail features to verify

- 3-pane layout
- folder sidebar
- virtualized message list
- thread/message viewer
- compose modal
- inline reply
- Send & Archive
- snooze
- custom snooze time picker
- drag-and-drop attachments
- inline image previews
- attachment size warnings
- hover actions
- archive/delete/read/star/snooze actions
- raw message viewer
- copy-to-clipboard
- print stylesheet
- scheduled send
- send-as alias/identity switching
- templates/canned responses
- move-to folder picker
- mute thread
- full-text search
- search operators
- SSE or live updates

Verified 2026-07-30: Mail Filters preserve array order as user-visible priority.
Each executable rule stops later processing unless `stopProcessing=false`;
legacy rules without the field retain stop behavior. The Sieve compiler and
manual evaluator share one executable criterion/action contract so Preview
cannot stop on a rule that delivery-time Sieve would omit.

`POST /api/rules/run` evaluates the active saved `webmail` script against any
existing IMAP folder. Preview and Apply use one bounded UID snapshot and the
same UIDVALIDITY plus SHA-256 saved-rule revision. Apply performs only Move
actions; Reject and Discard remain delivery-time actions. Continued Move
matches copy into earlier destinations and move to the final destination.
Copy completion is reserved and recorded by source UIDVALIDITY, UID, and
destination in the durable `mail_rule_copy_ledger`; that action identity stays
stable across rule edits. Confirmed copies are skipped on a retry, while an
uncertain interrupted copy is never repeated automatically. The owner must
verify the displayed destination/count and explicitly resolve that exact
pending copy group as present or missing before processing resumes. Only the
destination group about to be copied is reserved; a pending copy also blocks a
later edited single-Move rule for the same source UID. Copies and final moves
are grouped by destination under one source-mailbox session.
Large-message Body conditions use three-valued evaluation:
known header matches can still decide `any` rules, while only genuinely
undecidable rules are reported as skipped.

#### Calendar features to verify

- Month view
- Week view
- Day view
- Year view
- Agenda view
- event editor
- guests/attendees
- video call links
- attachments
- recurrence
- invitation generation
- ICS attendee behavior
- free/busy lookup
- per-guest availability indicators
- drag-and-drop calendar events
- mini-calendar sidebar
- week numbers
- natural language quick-create
- birthdays from contacts

#### Contacts features to verify

- address books
- labels
- groups
- contact grid/list
- contact search
- contact autocomplete
- CardDAV integration
- import/export

#### Notes features to verify

- notes list/grid
- note editor
- Apple Notes IMAP sync support
- collaborative editing
- Yjs/WebRTC usage
- conflict behavior

Verified 2026-07-29: the editor always uses a local Yjs/Quill binding, but creates a `WebrtcProvider` only when the build-time `VITE_OMS_NOTES_SIGNALING_URLS` list is explicitly configured. Default builds make no public signaling connection. Endpoint configuration alone does not provide authenticated room authorization; do not claim production-ready collaborative editing until a self-hosted signaling and access-control contract is implemented and validated.

### 6.5 Backend architecture

Status: `Authentication/session boundary verified 2026-07-29`

The modern backend stores opaque sessions in MariaDB and uses a Secure,
HttpOnly, SameSite=Lax cookie. Production requires a preserved high-entropy
`OMS_SESSION_SECRET` and a separate `OMS_ACCOUNT_SECURITY_KEY`; the latter
encrypts TOTP material with AES-256-GCM under a purpose-separated key. Login is
two-step when two-factor authentication is enabled, accepts TOTP or a
transactionally consumed recovery code, and retains only the current session
when 2FA is enabled. Internal Dovecot work uses delegated empty per-user
credentials; protocol clients use either the mailbox password while 2FA is off
or an app password while it is on. Mailbox verification supports current
bcrypt hashes and bounded legacy SHA512-CRYPT verification.

Previously documented backend stack:

- Node.js
- Express
- local listener on `127.0.0.1:20000`
- MySQL/MariaDB-backed sessions
- HttpOnly cookie sessions
- auth middleware such as `requireAuth` or `requireSession`

Previously documented protocols or integrations:

- IMAP
- SMTP
- ManageSieve
- CalDAV
- CardDAV
- ActiveSync / EAS
- JMAP
- SSE
- Socket.IO
- WebSocket notifications

Agents must verify which protocols are actually implemented, which are proxy routes, which are stubs, and which are planned.

### 6.6 Backend API surface

Status: `Needs Verification`

Previously documented API groups:

```text
/api/auth/*
/api/folders/*
/api/messages/*
/api/apps/*
/api/settings/*
/api/admin/*
/api/events
```

Previously documented capabilities:

- login/logout/session
- folders/mailbox listing
- message send/search/snooze/mute/raw
- calendars/events/contacts/freebusy/birthdays
- user settings
- templates
- admin domain/mailbox/alias management
- real-time events

Agents should verify actual route files, middleware, auth boundaries, request schemas, response schemas, error handling, and tests.

### 6.7 Nginx routing

Status: `Needs Verification`

The install process is documented as wiring Nginx routes for:

```text
/
/api
/caldav
/carddav
autodiscover
ActiveSync
```

Agents should verify:

- actual Nginx config templates
- reverse proxy targets
- static frontend serving
- TLS behavior
- upload limits
- request buffering
- timeout settings for long-lived sync connections
- SSE/WebSocket compatibility
- CalDAV/CardDAV/ActiveSync path behavior

---

## 7. Database Model

Status: `Needs Verification`

OpenMailStack appears to rely on the PostfixAdmin-compatible database schema for core mail-domain/account/alias management and additional tables for webmail/admin functionality.

### 7.1 PostfixAdmin-compatible tables

Status: `Needs Verification`

Previously referenced tables:

- `domain`
- `mailbox`
- `alias`
- `admin`
- `domain_admins`

Agents should verify the schema source, migrations, installation SQL, and compatibility expectations.

### 7.2 Admin Portal tables

Status: `Needs Verification`

Previously referenced tables:

- `api_keys`
- `audit_log`
- `domain_verification`
- `global_spam_rules`
- `domain_spam_rules`
- `user_spam_rules`
- `quarantine_log`

Agents should verify:

- table creation scripts
- migrations
- indexes
- foreign keys
- tenant boundaries
- deletion behavior
- retention policies
- audit completeness

### 7.3 Webmail-specific tables

Status: `Needs Verification`

Previously documented tables:

- `sessions`
- `scheduled_emails`
- `snooze_queue`
- `muted_threads`
- `calendars`
- `cal_events`
- `contacts`
- `contact_owners`
- `contact_labels`
- `contact_groups`
- `notes`
- `webmail_admin_audit`
- `webhook_deliveries`

Agents should verify:

- whether these tables exist
- whether they are created by install scripts or migrations
- whether migrations are idempotent
- whether sensitive fields are encrypted or protected
- whether indexes support large mailboxes/calendars/contact lists
- whether cleanup jobs exist for queues and sessions

---

## 8. Specific Feature Implementations

This section preserves detailed implementation notes from the older technical document, but marks each area for verification. Agents should confirm, correct, or reclassify these sections during repository intake.

### 8.1 System health monitoring

Status: `Needs Verification`

Current modern-backend behavior:

- The authenticated Admin System Health API reports allowlisted service state, host load/memory/disk, Postfix queue size, network connection counts, and focused ActiveSync/IMAP/SMTP/CalDAV/CardDAV probes.
- Prometheus gauges refresh every 15 seconds. `postqueue -j` counts JSON queue records and `ss` classifies established connections without accepting user-controlled commands.
- `openmailstack.service` runs as the unprivileged `openmailstack` user with `ProtectSystem=full` and an address-family allowlist. That allowlist includes `AF_NETLINK` because both Postfix `getifaddrs()` and `ss` require a netlink socket; transient-unit reproduction proves the commands fail without it and pass with it.

Legacy behavior still requiring separate verification:

- Admin Portal displays real-time server health.
- `api.php` may expose a `get_system_health` action.
- The backend may call `systemctl is-active <service>` through PHP shell execution.
- The backend may parse memory and disk usage through commands such as `free -m` and `df -h /`.

Previously referenced services:

- Nginx
- Postfix
- Dovecot
- MariaDB
- Rspamd

Security concerns to verify:

- whether shell execution is restricted to fixed commands
- whether user input can influence shell commands
- whether service names are allowlisted
- whether outputs are sanitized
- whether non-admin users can access health data
- whether health data leaks sensitive host information

### 8.2 In-place GitHub upgrades

Status: `Needs Verification`

Previously documented behavior:

- Admin UI checks the latest GitHub release.
- Admin UI compares local and remote versions.
- A restricted sudoers rule allows `www-data` to execute a single upgrade script as root.
- Upgrade script may run `git pull` in the repository directory.
- Upgrade script may copy updated web files and restart services.

Previously referenced paths:

```text
/etc/sudoers.d/openmailstack-upgrade
/usr/local/bin/openmailstack-upgrade.sh
/root/openmailstack/
/var/www/openmailstack-admin/
```

High-risk area. Agents should verify carefully:

- exact sudoers rule
- whether the upgrade script is root-writable only
- whether arguments are accepted
- whether `git pull` can execute untrusted hooks or unexpected code
- whether release verification exists
- whether rollback exists
- whether service restarts are safe
- whether local modifications are preserved
- whether the feature is appropriate for production installs

### 8.3 Audit logs

Status: `Needs Verification`

Previously documented behavior:

- mutating Admin Portal actions insert an audit row
- audit table records actor, target domain, action, description, and timestamp

Agents should verify:

- every mutating action is covered
- failed attempts are logged where appropriate
- logs cannot be altered by lower-privileged users
- logs avoid storing secrets or private mail contents
- retention behavior exists or is documented

### 8.4 Automated DKIM and Rspamd proxy

Status: `Needs Verification`

Previously documented behavior:

- Rspamd UI runs locally, possibly on port `11334`
- Nginx reverse proxies `/rspamd/` to Rspamd
- DKIM records are generated automatically
- a systemd timer periodically syncs DKIM keys for new domains

Previously referenced timer:

```text
openmailstack-dkim-sync.timer
```

Agents should verify:

- proxy authentication
- whether Rspamd password is exposed in headers or config
- whether Rspamd UI is admin-only
- DKIM key permissions
- DNS record display behavior
- timer installation and idempotency
- behavior for deleted or renamed domains

### 8.5 Domain ownership verification

Status: `Needs Verification`

Previously documented behavior:

- non-superadmins adding domains create inactive/pending domains
- a nonce is generated and stored
- users are instructed to create a DNS TXT record
- verification uses PHP DNS lookup
- domain is activated once the TXT token is found

Previously documented TXT record format:

```text
_openmailstack.<domain> IN TXT openmailstack-verify=<nonce>
```

Agents should verify:

- nonce generation strength
- replay behavior
- token expiry
- whether verification is required only for non-superadmins
- whether domains are unusable while pending
- whether DNS lookup handles multiple TXT records
- whether IDN/punycode and subdomains are handled safely
- whether domain names are normalized and validated

### 8.6 Hierarchical JSON spam policies / Rspamd multimap

Status: `Needs Verification`

Previously documented behavior:

- spam policies are stored as JSON in MariaDB
- global, domain, and user-level rule tables exist
- Rspamd queries MariaDB dynamically
- JSON functions such as `JSON_CONTAINS()` are used
- user-level whitelist may override domain-level blacklist

Previously referenced tables:

- `global_spam_rules`
- `domain_spam_rules`
- `user_spam_rules`

Agents should verify:

- actual Rspamd config
- actual SQL query behavior
- rule precedence
- performance impact on inbound mail
- indexes or caching
- input validation for domains/IPs
- failure behavior if MariaDB is unavailable
- whether policies are auditable

### 8.7 SQL spam quarantine and interception

Status: `Needs Verification`

Previously documented behavior:

1. Rspamd marks high-scoring mail with a hidden header.
2. Postfix `header_checks` detects the header.
3. Postfix routes the message to a quarantine transport.
4. A PHP CLI filter stores the raw `.eml` file and metadata.
5. Admin UI can release the message by piping it into `sendmail -t`.

Previously referenced header:

```text
X-OMS-Quarantine: YES
```

Previously referenced paths:

```text
/etc/rspamd/rspamd.local.lua
/usr/local/bin/quarantine_filter.php
/var/vmail/quarantine/
/usr/sbin/sendmail
```

Previously referenced table:

```text
quarantine_log
```

Agents should verify:

- score threshold
- whether messages are rejected, quarantined, or delivered
- whether raw messages are encrypted or protected on disk
- file permissions
- path traversal defenses
- release authorization
- whether release bypasses filtering intentionally
- audit logging of release/delete actions
- retention and cleanup behavior
- whether headers can be spoofed by external senders

### 8.8 OMS Scheduler

Status: `Implemented - Phase 3 Complete And Live`

Last verified: 2026-07-16 in the repository, disposable MariaDB, real Express routes, browser UI, and the guarded live migration/deployment.

Phase 0 and Phase 1 are implemented behind `ENABLE_OMS_SCHEDULER`. Ordered migrations create tenant-scoped slot inventory/holds, mailbox entitlements, event types, availability windows, bookings, a leased outbox, and sanitized audit events. Disabled installations do not apply these migrations. Only the existing modern superadmin boundary can enable a mailbox and assign its globally unique public handle.

The Node backend separates public, owner, and Admin Scheduler APIs. Public requests require an allowlisted hostname and unpublished, disabled, unknown, and cross-tenant resources share generic not-found behavior. Booking creation rechecks native calendar conflicts, acquires transactional capacity, and stores an immutable event snapshot. Instant-confirmation event types then project one VEVENT into the existing `events` table, increment the calendar sync token, and enqueue email/ICS delivery. Event types may instead require host confirmation: the public transaction stores a `requested` booking and reserves capacity but creates no Calendar event; an owner decision locks the booking row and either projects/notifies exactly once with rotated guest tokens or rejects/notifies and releases capacity. Event types may also define up to ten required/optional short, long, or dropdown questions. Booking creation validates IDs, required values, sizes, and dropdown membership before acquiring capacity, then stores immutable label/type/value answer snapshots; answers are owner-visible but excluded from audits, outbox payloads, iCalendar, and public capability responses. The same immutable snapshot carries optional cancellation/reschedule cutoffs and reason requirements. Public capability reads expose policy state, while mutations recheck deadlines and bounded reasons under the booking lock. Reasons stay on the booking for authenticated owner detail and do not enter email, outbox, audit, Calendar, or public read surfaces. Reschedule preserves the calendar UID; cancellation deletes confirmed projections and writes `calendar_tombstones`, while requested cancellation releases capacity without creating a phantom tombstone, so existing CalDAV and ActiveSync paths consume the same source of truth. Event visibility is persisted as `public`, `unlisted`, or `private`; only public events appear in profile directories, unlisted events remain reachable through exact slugs, and private events require an active, unexpired bearer token. Private tokens are 256-bit random values stored only as SHA-256 hashes. The browser receives them in URL fragments, moves them to tab-only storage, removes the fragment from history, and sends them only through `X-Scheduler-Access` on no-store API requests. Optional single-use links keep a database remaining-use counter; booking commits lock and decrement that counter atomically, while failed transactions preserve it. One-off links add a bounded owner timezone plus one to fourteen date/time windows, force single-use, and replace the recurring availability source while reusing the normal duration, interval, notice, conflict, buffer, capacity, and transactional-consumption boundaries. Idempotent booking lookup precedes consumed-token rejection so a successful attempt can be replayed safely after a lost response.

Phase 2 booking integrity runs eligibility and verification before capacity acquisition. Exact-email and `@domain` allow/deny rules apply to the booker and each named attendee but are stripped from public event responses. Optional verification challenges bind a hash to event plus normalized email, expire after 15 minutes, and are consumed under the booking transaction. Active-booking limits serialize on a durable event/email mutex so simultaneous requests cannot both pass the count. Group bookings reserve an explicit seat count; every named attendee consumes a seat, while remaining capacity comes from slot inventory rather than Calendar busy parsing. Same-event confirmed projections are excluded from ordinary conflict input and remain governed by that inventory, whereas unrelated Calendar events still block the slot. Cancellation, rejection, and reschedule move the exact seat count, and a booking-row recheck prevents concurrent reschedules from retaining capacity at two destinations.

Phase 2 personal scheduling extends through migrations `017`-`023`: host-local holiday/out-of-office exclusions, capacity-aware waitlists, DST-safe recurring series, verified meeting polls, delegated booking and completed/no-show outcomes, public embed/customization/attribution controls, and guarded JSON/CSV portability. Waitlist admission snapshots verification state, while promotion rechecks current event policy. Permanently ineligible entries are marked failed and promotion continues to the next oldest party whose seats fit; transient capacity failures remain pending. Meeting-poll creation writes a complete sanitized audit record including the required occurrence timestamp. Import creates inactive unlisted drafts, and booking CSV cells are neutralized against spreadsheet formulas.

Phase 3 uses immutable workflow/version/step rows, booking-version snapshots, schedule generations, MariaDB-time leases, a delivery-attempt ledger, and a separate systemd worker. Migration `025` extends lifecycle triggers through request/start/end/confirmation/rejection/reschedule/cancellation/completion/no-show and adds email, in-app, mandatory-signed webhook, and external-message actions. Owners can create, clone, publish, condition, preview, translate, test, assign, enable, archive, read in-app notifications, inspect, and reconcile their workflows. Publish rejects unknown/malformed variables and translations that do not preserve the original placeholder set. Administrators configure write-only HTTPS adapters with explicit credential/cost disclosure, persisted last-test health, and workflow/queue metrics, and can inspect/reconcile deliveries across tenants. External requests resolve DNS once and pin the validated address into a one-request TLS connection, block private and IPv4-mapped ranges by default, do not follow redirects, and treat a response/network failure after request transmission as delivery-uncertain rather than retry-safe. Operator-fixable failures retain payloads in an observable dead letter. SMS/WhatsApp/voice use the immutable booking phone and require both consent captured on that booking and an active contact preference. Unsubscribe capabilities remain stable across repeat consent, confirm on GET, mutate only on POST, and are supplied to voice adapters. Provider credentials and unsubscribe capabilities use purpose-separated AES-256-GCM with a stored key version and configured rotation keyring. Translation adapters return rendered locale variants while the immutable step retains the original templates. Disposable Express acceptance tests exercise authentication, superadmin authorization, cross-tenant workflow/provider isolation, notification-read IDOR, and public unsubscribe mutation boundaries.

The React app lazy-loads authenticated Scheduler management and unauthenticated `/scheduler/<handle>` pages. Entitled users see Scheduler immediately after Notes. Mobile navigation keeps Mail, Calendar, Contacts, Notes, and Scheduler primary and moves Settings, Sync, and Admin into More.

Evidence: `webmail-backend/src/scheduler/`, versioned migrations `001` through `025`, `functions/10_webmail.sh`, `functions/12_scheduler.sh`, the native owner/Admin/public React surfaces, backend tests, static integration guards, disposable MariaDB lifecycle/concurrency tests, and the guarded live deployments. Migrations `001`-`025` apply twice and all 114 backend tests pass without skips. Real Express acceptance covers session/Admin authorization, tenant/provider isolation, notification IDOR, unsubscribe confirmation/mutation, and semantic delivery metrics. Desktop/mobile owner surfaces and the Admin delivery dashboard pass browser checks with zero console errors. On the live host migration `025` and its provider-health columns exist; the keyring is configured; API and worker services are active with zero recent error-level lines; workflow/Admin APIs return `401` unauthenticated; the public profile and workflow SPA return `200`; repository/deployed backend and frontend artifacts are exact; workflow/job/provider/open-alert counts remain zero; the Postfix queue is empty; and staging smoke including Rspamd functional health passes. Rollback snapshot: `/var/backups/openmailstack/20260716T151429Z-scheduler-phase3`. Remaining validation is physical CalDAV/ActiveSync observation and clean-VM work after a second development Linux server is available.

---

## 9. ActiveSync, CalDAV, CardDAV, JMAP, and Sync Services

Status: `Needs Verification`

The project goal includes SOGo ActiveSync support and modern sync behavior. The older technical document mentions:

- ActiveSync / EAS
- SOGo ActiveSync work
- CalDAV
- CardDAV
- JMAP
- autodiscover
- mobile/device sync

This is a high-importance area and must not be assumed complete.

Current Calendar interoperability seam, verified locally 2026-07-20:

- `webmail-backend/src/caldav.ts` implements the native CalDAV collection/resource routes. Event resources support GET/HEAD, conditional PUT with stable content ETags, DELETE, PROPFIND, and REPORT against the Calendar event store.
- `webmail-backend/src/calendar-format.ts` keeps recurrence masters, `EXDATE`/cancelled/modified exceptions, `VALARM` reminders, and source timezone status in the parsed domain object. Embedded custom aliases are used only when a bounded supported yearly rule matches the canonical IANA transitions; unsupported or invalid definitions remain floating so OMS never applies a guessed offset. Raw `VTIMEZONE` and exception components remain available for lossless whole-series edits.
- `webmail-backend/src/eas-calendar.ts` is the testable ActiveSync Calendar adapter used by the embedded `/Microsoft-Server-ActiveSync` route in `webmail-backend/src/index.ts`. It converts EAS UTC/date-only payloads, simple recurrence fields, recurring-event origin timezones, reminders, and deleted/modified exceptions to and from iCalendar. Exception reminder omission inherits the master, an empty reminder disables it, and exception all-day state is independent of the master.
- `webmail-backend/src/eas-timezone.ts` encodes and decodes the 172-byte EAS `TIME_ZONE_INFORMATION` value, validates candidate IANA/Windows names against the decoded bias and transition rules, and uses bounded caches/fallbacks. `windows-timezones.ts` carries the CLDR 48 territory-`001` map under the Unicode notice in `THIRD_PARTY_NOTICES.md`.
- Recurrence exceptions, reminders, and conservative custom/invalid `VTIMEZONE` handling pass the automated and physical macOS/iOS Calendar gates recorded in the worklog. Arbitrary unsupported custom rules remain floating by design.

Current ActiveSync Mail interoperability seam, deployed and script-verified 2026-07-20:

- `webmail-backend/src/eas-mail-sync.ts` owns persistent mail delta state. State is isolated by normalized mailbox, EAS `DeviceId`, and folder `CollectionId`; opaque sync keys bind the client to one stored snapshot, and exact WBXML retry responses are replayed only after the request has passed direct IMAP credential verification.
- Each folder snapshot stores `UIDVALIDITY`, `HIGHESTMODSEQ`, a filter-specific UID floor, cached Sync options, and known UID/read state. Previously known UIDs that leave the source folder emit EAS `Delete`; messages moved into Junk or Trash arrive as normal `Add` commands when those destination collections synchronize.
- Email `FilterType`, `WindowSize`, and AirSyncBase body preferences are honored with UTF-8-safe truncation, protocol window bounds, and a 16 MiB aggregate source-fetch budget. FilterType `0` or an omitted FilterType paginates every eligible item through `MoreAvailable`; once the initial catch-up is complete, unchanged `HIGHESTMODSEQ` polls avoid `SEARCH ALL`.
- `tests/integration/activesync_mail_smoke.sh` uses the real web message-action API to prove Inbox-to-Junk and Junk-to-Trash deltas, body truncation, read/unread changes, and an empty no-change Sync. The production smoke passed under isolated synthetic-device state. Physical iOS 26.5.2 passed the stale-key reset and continuous all-mail paging after hotfix `bc4f7387`; exhaustion/no-change remains open. Do not repeat a spam move based on subject alone while the IMAP clients and current server UIDs disagree about the two historical examples.

Current CardDAV interoperability seam, deployed and verified 2026-08-03:

- `webmail-backend/src/carddav.ts` implements native principal/address-book
  discovery and one owner-only Personal Contacts collection. Its
  `DAV:current-user-privilege-set` reports read access, contact-resource
  `write-content`, and collection `bind`/`unbind`. It does not advertise
  aggregate `write`, RFC 3744 `access-control`, or `write-properties` because
  arbitrary property and ACL mutation are not implemented.
- The address-book home and Personal Contacts collection identify the
  authenticated principal through `DAV:owner`. Personal Contacts advertises
  the already-handled `addressbook-query`, `addressbook-multiget`, and
  `sync-collection` reports through `DAV:supported-report-set`, matching the
  property names captured from macOS 26.5.2 onboarding.
- `webmail-backend/test/carddav-capabilities.test.cjs` exercises authenticated
  owner discovery through the real Express router.
  `tests/integration/carddav_sync_smoke.sh` checks the public capability and
  CRUD/tombstone lifecycle and deletes its unique remote contact from the EXIT
  trap if a post-PUT assertion fails.
- Production artifacts match commit `35d29345`; the authenticated public
  lifecycle, complete staging smoke, zero active synthetic contacts, and
  zero-restart/error service checks pass. A targeted macOS 26.5.2
  Contacts-framework create/delete reached the Personal collection through a
  real CardDAV PUT/DELETE pair and cleaned up successfully. HouseVo still does
  not appear as Default Account, isolating that remaining issue to the macOS
  picker rather than server writability; no further DAV privilege broadening
  is justified.

Agents should locate and document:

- where the SOGo ActiveSync integration lives
- whether ActiveSync is proxied, embedded, adapted, or configured externally
- which URL paths serve ActiveSync
- whether autodiscover is implemented for Apple/Microsoft clients
- whether TLS and auth expectations match client requirements
- whether CalDAV/CardDAV are native, proxied, or planned
- whether JMAP is implemented or aspirational
- what tests exist for sync behavior
- what known client compatibility issues exist

Suggested future subsection structure after verification:

```text
9.1 ActiveSync / EAS
9.2 SOGo integration model
9.3 Autodiscover
9.4 CalDAV
9.5 CardDAV
9.6 JMAP
9.7 Client compatibility matrix
```

---

## 10. Security and Privacy Model

Status: `Needs Verification`

OpenMailStack handles extremely sensitive data: credentials, mail contents, contacts, calendars, attachments, admin actions, domains, and server configuration.

Agents should treat security/privacy as part of architecture, not as a later polish step.

### 10.1 Sensitive data classes

Likely sensitive data includes:

- mailbox passwords
- admin passwords
- API keys
- OAuth tokens, if added
- session cookies
- raw email message bodies
- attachments
- contact details
- calendar invitations
- DNS/domain ownership tokens
- DKIM private keys
- spam quarantine contents
- server hostnames and internal paths
- logs containing user identifiers or operational data

### 10.2 Required security properties

Agents should verify or improve:

- credentials are never logged
- message bodies are not logged except with explicit safe debug controls
- sessions use secure cookie flags where appropriate
- CSRF protection exists for cookie-authenticated mutation endpoints
- all RBAC boundaries are enforced server-side
- API keys are hashed and revocable
- destructive actions require appropriate authorization
- admin actions are audited
- shell execution is tightly constrained
- sudoers bridges are minimal and auditable
- uploads and attachments are validated and safely served
- multi-tenant data boundaries are tested

### 10.3 High-risk architecture areas

Known high-risk areas to verify:

- web-triggered upgrade flow
- `www-data` sudoers bridge
- PHP shell execution for health checks
- quarantine release through `sendmail -t`
- Rspamd proxy authentication
- DNS domain verification
- ActiveSync/autodiscover auth behavior
- attachment preview/download behavior
- admin API key provisioning

---

## 11. Performance and Reliability Considerations

Status: `Needs Verification`

OpenMailStack’s product goal requires perceived speed and reliability, especially for large mailboxes and mobile users.

Agents should verify:

- mailbox list performance with thousands of messages
- virtualization or pagination behavior
- search responsiveness
- compose autosave reliability
- scheduled-send queue reliability
- snooze queue reliability
- sync conflict behavior
- retry behavior for failed protocol calls
- background job supervision
- service restart behavior
- long-lived connection behavior for SSE/WebSocket/ActiveSync
- database indexes for common queries
- memory usage for large messages and attachments

Performance work should be based on evidence. Agents should not optimize blindly.

---

## 12. Testing and CI Expectations

Status: `Needs Verification`

Agents should inspect and document:

- package manager
- frontend test framework
- backend test framework
- PHP lint/test approach
- shellcheck or script checks
- TypeScript typecheck
- frontend build command
- backend build/start command
- integration tests
- end-to-end tests
- CI provider and workflows
- fixtures or seeded data
- mock mail server behavior
- protocol/sync test coverage

Suggested commands to discover during intake:

```bash
git status --short
find . -maxdepth 3 -iname 'package.json' -o -iname 'composer.json' -o -iname '.github'
find . -maxdepth 3 -iname '*test*' -o -iname '*spec*'
```

Agents should update this section with actual commands once verified.

---

## 13. Operational Notes

Status: `Needs Verification`

Agents should verify and document:

- supported operating systems
- required ports
- firewall defaults
- SSL/TLS certificate flow
- service names
- systemd units
- backup and restore behavior
- upgrade behavior
- rollback behavior
- log locations
- config file locations
- generated secret locations
- migration strategy

Previously documented allowed firewall ports:

```text
22   SSH
25   SMTP
80   HTTP / ACME
443  HTTPS
587  SMTP submission
993  IMAPS
```

Agents should verify whether additional ports are required or intentionally internal-only.

---

## 14. Known Ambiguities for Next Architecture Review

These are areas where the previous technical document may overstate implementation completeness.

Agents should prioritize verification of:

1. The exact location and completeness of SOGo ActiveSync work
2. Whether JMAP is implemented, stubbed, proxied, or only planned
3. Whether CalDAV/CardDAV are implemented natively or proxied
4. Whether all documented React routes exist
5. Whether all documented mail features are implemented
6. Whether calendar, contacts, and notes are production-ready or partial
7. Whether Yjs/WebRTC collaborative notes actually exist
8. Whether SSE, Socket.IO, and WebSocket are all used or only some are present
9. Whether `10_webmail.sh` builds and deploys the modern app reliably
10. Whether web-triggered GitHub upgrades are safe enough for production
11. Whether the admin portal’s RBAC is fully enforced server-side
12. Whether spam quarantine can be bypassed or spoofed through headers
13. Whether all database tables listed here are created by scripts/migrations
14. Whether the install process is idempotent and safe after partial failure
15. Whether root-level documentation contradicts this architecture document

---

## 15. Architecture Review Checklist for Agents

During repository intake, agents should answer these questions and update this file where needed:

### Product shape

- What surfaces exist today?
- Which are legacy, modern, partial, or planned?
- What is the primary user-facing webmail path?
- What is the primary admin path?

### Frontend

- What framework and versions are actually used?
- What routes exist?
- What data fetching layer exists?
- What state management approach is used?
- What core workflows are implemented?
- What is tested?

### Backend

- What runtime and framework are actually used?
- What endpoints exist?
- What auth/session model is used?
- What protocol clients or proxy layers exist?
- What background jobs exist?
- What is tested?

### Mail stack

- How are Postfix and Dovecot configured?
- How does auth work?
- How does delivery work?
- How are aliases and domains resolved?
- How are DKIM, spam, quarantine, and malware scanning configured?

### Sync

- Where is ActiveSync implemented?
- What does SOGo provide versus OpenMailStack code?
- What clients are supported?
- What tests or manual verification exist?

### Security

- Where are secrets generated and stored?
- Which web endpoints can mutate system state?
- Which code paths execute shell commands?
- Which code paths use elevated privileges?
- Are tenant boundaries enforced server-side?

### Operations

- How is the system installed?
- How is it upgraded?
- How is it backed up and restored?
- What happens when an install step fails?
- What logs are safe to inspect?

---

## 16. Change Log for This Document

- 2026-07-30: Documented deployed owner-only CardDAV privilege metadata,
  truthful non-ACL boundaries, regression coverage, and the remaining physical
  macOS Default Account gate.
- 2026-07-30: Documented verified ordered Sieve rules, per-rule stop/continue behavior, and the bounded preview-first existing-mail runner with rule-revision, UID-snapshot, partial-failure, and large-body safeguards.
- 2026-07-20: Documented deployed per-device/per-folder ActiveSync Mail delta state, move/delete behavior, bounded filtering/body retrieval, paginated all-mail initial synchronization, authenticated production smoke evidence, and physical iOS paging status.
- 2026-07-11: Added and live-verified the OMS Scheduler Phase 0/1 architecture, trust boundaries, native calendar projection, installer gating, alias-host routing, and remaining mailbox/client release validation.
- 2026-07-02: Converted older root-level `TECHNICAL.md` into an agent-safe architecture document. Added status labels, maintenance policy, verification warnings, source-of-truth rules, and known ambiguity list. Reclassified many feature claims as `Needs Verification` to prevent agents from assuming aspirational or partial features are fully implemented.
