# 🧠 OpenMailStack Technical Architecture

Welcome to the nerdy deep-dive into OpenMailStack. This document outlines exactly how the deployment works, how the backend services communicate, and how the custom Admin Portal interacts with the system at a microscopic level. 

Transparency is security. We want you to know exactly what is running on your server.

---

## 1. The Deployment Orchestrator (`install.sh`)

OpenMailStack is deployed via bash scripting, orchestrated by `install.sh`. Rather than an opaque compiled binary, we rely on standard GNU/Linux tools to provision the server.

### 1.1 Configuration Parsing
The user generates a `config.conf` file via `setup_config.sh`. This configuration is loaded into environment variables by `install.sh`. These variables contain database passwords, FQDNs, and feature toggles (e.g., `INSTALL_CLAMAV=true`).

### 1.2 Execution Pipeline
`install.sh` executes the scripts in the `functions/` directory sequentially:
1. `00_preflight.sh`: Takes an LVM/Btrfs safety snapshot, checks OS compatibility (Debian/Ubuntu), and verifies Port 25 outbound connectivity.
2. `01_mariadb.sh`: Provisions the local MariaDB SQL server and secures it.
3. `02_nginx_php.sh`: Installs Nginx and PHP-FPM (automatically detecting PHP 8.2+ based on the OS repo).
4. `03_postfixadmin.sh`: Installs the legacy PostfixAdmin interface (to generate the underlying database schema).
5. `04_postfix_dovecot.sh`: The heavy lifting. Configures Postfix (MTA) and Dovecot (IMAP/POP3) and links them to MariaDB via SQL lookup tables (e.g. `mysql_virtual_mailbox_maps.cf`).
6. `05_rspamd_clamav.sh`: Installs the Rspamd anti-spam engine and ClamAV. It also configures automated DKIM key generation.
7. `06_roundcube.sh`: Installs the legacy Roundcube fallback mail client.
8. `07_fail2ban.sh`: Sets up Fail2ban jails to block brute-force SSH and IMAP attempts.
9. `08_ufw_ssl.sh`: Locks down the firewall using UFW (allowing only 22, 25, 80, 443, 587, 993) and acquires Let's Encrypt certificates.
10. `09_admin_portal.sh`: Deploys our custom OpenMailStack PHP/JS Admin Portal and secures the `www-data` sudoers bridge.
11. `10_webmail.sh`: Builds and deploys the modern React webmail frontend, installs the Node/Express backend, renders `/etc/openmailstack/webmail-backend.env`, installs `openmailstack.service`, and wires Nginx routes for `/`, `/api`, `/caldav`, `/carddav`, autodiscover, and ActiveSync.

---

## 2. Mail Delivery Architecture (MTA & MDA)

OpenMailStack utilizes a virtual mailbox setup. There are no local Linux system users (`/etc/passwd`) created for email accounts. 

### 2.1 Postfix (Port 25, 587)
- **Database Lookups:** When Postfix receives an email, it queries MariaDB (using the `postfixadmin` database) to determine if the recipient domain exists (`domain` table), if the user exists (`mailbox` table), or if it's an alias (`alias` table).
- **Delivery:** If valid, Postfix passes the email to Dovecot via LMTP (Local Mail Transfer Protocol) over a Unix socket (`/var/run/dovecot/lmtp`).
- **Milter:** Before delivery, Postfix streams the message to Rspamd via a Milter interface (`inet:localhost:11332`) for DKIM signature verification, spam scoring, and ClamAV scanning.

### 2.2 Dovecot (Port 993)
- **Authentication:** Dovecot handles IMAP (email reading) and SASL authentication for Postfix (so users can send outbound emails via Port 587). Passwords in the database are hashed using `SHA512-CRYPT` or modern Argon2 (depending on Dovecot version).
- **Storage:** Emails are stored in the Maildir format located at `/var/vmail/domain.com/user/`.
- **Permissions:** The entire `/var/vmail` tree is owned by a single unprivileged system user (`vmail:vmail`, UID 5000).

---

## 3. The OpenMailStack Admin Portal

The pride and joy of the stack is the custom Admin Portal (`admin_portal_src`). Because PostfixAdmin is incredibly powerful but visually dated and overly complex, we built a bespoke PHP/Vanilla-JS single-page application (SPA) that acts as a modern overlay on top of the PostfixAdmin database.

### 3.1 Backend (`api.php`)
- **Location:** `/var/www/openmailstack-admin/public/api.php`
- **Framework:** Pure, dependency-free PHP.
- **Database Connection:** Connects locally to MariaDB (`postfixadmin` db) via PDO.
- **Authentication:** Relies on standard PHP Session tracking (`$_SESSION`). The initial login verifies the provided password against Dovecot's hash format directly in the `admin` table.
- **Endpoints:** Uses a `switch($action)` statement based on `POST` data. 
- **Security:**
  - Prepared SQL statements are strictly enforced to prevent SQL Injection.
  - User privilege elevation is handled seamlessly. When a regular mailbox user is promoted to an Administrator, `api.php` duplicates their hashed Dovecot password into the `admin` table, ensuring their credentials remain in sync without storing plaintext.
  - **Role-Based Access Control (RBAC):** `api.php` distinguishes between `superadmin` (can view/modify all domains) and normal domain admins (restricted via the `domain_admins` table boundaries). Standard mailbox users can also authenticate to access a self-service view, modifying only their own row in the `mailbox` and `user_spam_rules` tables.

### 3.2 RESTful Integration API (`api_v1.php`)
For external automated provisioning (e.g. WHMCS or custom billing software), we engineered a completely stateless JSON API endpoint at `/api_v1.php`.
- **Authentication:** Validates requests using an `Authorization: Bearer sk_...` header.
- **Key Generation:** API Keys are generated in the Admin Portal, securely hashed using PHP's native algorithms (like Bcrypt), and stored in the `api_keys` table. The plaintext `sk_...` key is only shown to the admin exactly once during generation.
- **Capabilities:** Allows external systems to execute atomic Create, Read, Update, and Delete (CRUD) operations on Domains, Mailboxes, and Aliases, bypassing CSRF/Cookie requirements while maintaining Audit Log traceability (keys are tagged to logs).

### 3.2 Frontend (`app.js` & `index.js`)
- **Framework:** Vanilla JavaScript & CSS. No React, no Vue, no bloated Node_Modules. 
- **Design:** Implements a modern "glassmorphism" aesthetic with responsive sidebar navigation and asynchronous DOM updates.
- **Interaction:** Uses standard browser `fetch()` API to communicate with `api.php`. Forms are presented via cleanly injected dynamic HTML modals (DOM manipulation).

## 4. Modern Webmail, Calendar, Contacts, Notes, And Sync Proxy

The modern end-user product surface lives in `webmail-frontend/` and `webmail-backend/`.

### 4.1 Frontend Architecture (`webmail-frontend`)
- **Framework:** React 19 + Vite 8 + TypeScript 6.
- **Routing:** React Router v7 with URL structure: `/mail/inbox/123`, `/calendar/month`, `/contacts`, `/notes`, `/settings/:tab`, `/admin/:panel`, `/sync`.
- **Design:** Custom dark glassmorphism theme using CSS custom properties. No external component library.
- **Layout:** Auth gate → App shell (header + mobile tab bar) → per-app layouts with `react-resizable-panels` for desktop multi-pane views.
- **Mobile:** Responsive breakpoints at 768px. Single-pane drill-down with fixed bottom tab bar below 768px.

#### Component Architecture
```
src/
├── App.tsx (65 lines — router shell)
├── shared/
│   ├── types.ts (all TypeScript interfaces)
│   ├── api.ts (typed fetch wrappers for all backend endpoints)
│   ├── hooks/ (useAuth, useAppearance, useMediaQuery)
│   ├── components/ (Skeleton, EmptyState, ErrorBanner)
│   └── layouts/ (AuthGate, AppShell)
├── mail/
│   ├── hooks/useMail.ts (all mail state + API actions)
│   ├── FolderSidebar.tsx, MessageList.tsx (virtualized), MessageRow.tsx
│   ├── MessageViewer.tsx, ComposeModal.tsx, SearchBar.tsx
│   └── components/ (InlineReply, SnoozePopover, RawMessageModal, AttachmentCard, MoveToPopover, MessageListSkeleton)
├── calendar/
│   ├── hooks/useCalendar.ts (calendar state, event CRUD, free/busy)
│   ├── CalendarSidebar.tsx (mini-calendar + calendar list), CalendarToolbar.tsx
│   ├── EventModal.tsx (full event editor: guests, video links, attachments, recurrence)
│   └── views/MonthView.tsx (week numbers, drag-and-drop, click-to-edit)
├── contacts/
│   ├── hooks/useContacts.ts
│   ├── ContactSidebar.tsx (address books, labels, groups)
│   ├── ContactGrid.tsx (virtualized)
│   └── components/ContactSkeleton.tsx
├── notes/
│   ├── hooks/useNotes.ts
│   ├── NotesSidebar.tsx, NotesGrid.tsx
│   ├── LiveNoteEditor.tsx (Yjs/WebRTC collaborative editing)
│   └── components/NoteSkeleton.tsx
├── settings/ (routes + existing SettingsPanel files)
└── admin/ (routes + existing admin panel files)
```

#### Key Mail Features
- 3-pane layout: folder sidebar → virtualized message list → thread viewer
- Inline reply box, Send & Archive, snooze with custom time picker
- Drag-and-drop attachments, inline image previews, attachment size warnings
- Quick hover actions (archive, delete, read, snooze, star)
- Raw message viewer with copy-to-clipboard, print stylesheet
- Custom scheduled send with datetime picker
- Send-as alias identity switching, templates/canned responses
- Move-to folder picker with search, mute thread
- Full-text search with operators, SSE real-time updates

#### Key Calendar Features
- Five views: Month, Week, Day, Year, Agenda
- Full event editor with guests, video call links (Meet/Zoom/Teams), attachments, recurrence
- Invitation system with ICS ATTENDEE generation
- Free/busy lookup endpoint with per-guest availability indicators
- Drag-and-drop in month and week/day views
- Mini-calendar sidebar, week numbers, natural language quick-create
- Birthdays auto-calendar from contacts

### 4.2 Backend (`webmail-backend`)
- **Runtime:** Node.js + Express 5, listening on `127.0.0.1:20000`.
- **Protocols:** IMAP (Dovecot), SMTP (Postfix), ManageSieve, CalDAV, CardDAV, ActiveSync (EAS), JMAP.
- **Session:** HttpOnly cookie sessions in MySQL. `requireAuth` / `requireSession` middleware.
- **Real-time:** SSE (`/api/events`) for mail push. Socket.IO available. WebSocket for calendar/contacts sync notifications.
- **API surface:** `/api/auth/*` (login/logout/session), `/api/folders/*` (mail), `/api/messages/*` (send, search, snooze, mute, raw), `/api/apps/*` (calendars, events, contacts, freebusy, birthdays), `/api/settings/*` (user settings, templates), `/api/admin/*` (domain, mailbox, alias management).

### 4.3 Database Tables (webmail-specific)
- `sessions` — HttpOnly cookie sessions
- `scheduled_emails` — delayed/scheduled send queue
- `snooze_queue` — snoozed messages with restore time
- `muted_threads` — muted message UIDs per user
- `calendars`, `cal_events` — CalDAV + webapp calendar data
- `contacts`, `contact_owners`, `contact_labels`, `contact_groups` — CardDAV + webapp contacts
- `notes` — Notes with Apple Notes IMAP sync support
- `webmail_admin_audit`, `webhook_deliveries` — admin audit trail

---

## 5. Specific Feature Implementations

### 5.1 System Health Monitoring
The Admin Portal displays real-time server health. When `api.php` receives a `get_system_health` request, it:
1. Executes `systemctl is-active <service>` via PHP's `shell_exec()` to check the live status of Nginx, Postfix, Dovecot, MariaDB, and Rspamd.
2. Parses `/proc/meminfo` (via `free -m`) and disk usage (`df -h /`) to render the usage bars in the UI.

### 5.2 In-Place Secure GitHub Upgrades
We designed an automated upgrade bridge that allows the web interface to pull updates from GitHub without compromising server security.
- **Version Check:** The web panel hits the `https://api.github.com/repos/mrlemongrass/openmailstack/releases/latest` endpoint to compare SemVer strings. It also pulls live local component versions (e.g. `postconf -h mail_version`).
- **The Sudoers Bridge:** The portal runs as the restricted `www-data` user. We created `/etc/sudoers.d/openmailstack-upgrade` which explicitly allows `www-data` to execute **only** `/usr/local/bin/openmailstack-upgrade.sh` as root, with no password.
- **The Upgrade Script:** When triggered, the `upgrade.sh` script executes a `git pull` in `/root/openmailstack/`, copies the newly updated web interface files to `/var/www/openmailstack-admin/`, restarts `php-fpm`, and updates the local version tracker, all while preserving user state.

### 5.3 Audit Logs
Enterprise security requires accountability. We implemented an `audit_log` SQL table.
- Every mutating action in `api.php` (creating a user, deleting a domain, editing an alias) triggers a secondary `INSERT` into the `audit_log` table.
- The log records the `admin_username`, the target `domain`, the exact `action`, a detailed `description`, and a `timestamp`.

### 5.4 Automated DKIM & Rspamd Proxy
Rspamd's UI runs locally on port `11334`. To expose it securely to the admin without opening extra firewall ports, Nginx Reverse Proxies `/rspamd/` directly to localhost, passing the `RSPAMD_PASS` via headers securely generated during `setup_config.sh`.
DKIM records are managed by the `05_rspamd_clamav.sh` script, which installs a systemd timer (`openmailstack-dkim-sync.timer`) to ensure newly created domains in the database have their cryptographic keys generated automatically every hour without manual CLI intervention.

### 5.5 Domain Ownership Verification
To prevent malicious domain hijacking in a multi-tenant environment, OpenMailStack enforces DNS TXT verification for non-superadmins:
1. When a normal domain admin adds a domain, it is inserted into the MariaDB `domain` table with `active = 0` (Pending) and linked to their account in the `domain_admins` table.
2. A cryptographic nonce is generated and saved in the `domain_verification` table.
3. The Admin Portal instructs the user to create a DNS TXT record (`_openmailstack.domain.com IN TXT openmailstack-verify=<nonce>`).
4. Upon clicking "Verify", `api.php` triggers a native PHP `dns_get_record()` lookup. If the token is found, the domain activates immediately.

### 5.6 Hierarchical JSON Spam Policies (Rspamd Multimap)
OpenMailStack supports granular, multi-tenant spam policies allowing Administrators and Users to define exact Whitelists, Blacklists, and Banned IPs.
- **The Storage Strategy:** Policies are stored in MariaDB as raw JSON objects across three tables: `global_spam_rules`, `domain_spam_rules`, and `user_spam_rules`. 
- **The Execution Layer:** We completely re-engineered Rspamd's `multimap.conf` module to bypass standard flat-file checks. When an email arrives, Rspamd dynamically executes SQL queries against MariaDB in real-time, utilizing MariaDB's strict native `JSON_CONTAINS()` function to see if the sender's IP or Domain exists in the specific policy array.
- **The Hierarchy:** Rspamd evaluates rules in a strict hierarchy. A User's personal whitelist will override a Domain-level blacklist, ensuring maximum flexibility.

### 5.7 SQL Spam Quarantining & Interception
Rather than silently dropping emails that score highly on Rspamd (which leads to false positives and missing critical business communications), OpenMailStack intercepts and stores them securely.
1. **Rspamd Flagging:** A custom Lua post-filter script (`/etc/rspamd/rspamd.local.lua`) is registered inside Rspamd. If an email scores `>= 15.0`, rather than rejecting it, Rspamd stamps it with a hidden header: `X-OMS-Quarantine: YES`.
2. **Postfix Header Routing:** Postfix's `header_checks` map scans every incoming email. Upon detecting `X-OMS-Quarantine`, Postfix strips the email from standard Dovecot LMTP delivery and pipes it to a custom `quarantine` transport queue.
3. **The PHP CLI Interceptor:** Postfix pipes the raw email `STDIN` into `/usr/local/bin/quarantine_filter.php`. This high-speed script parses the metadata, saves the raw `.eml` file to an unindexed, secure disk folder (`/var/vmail/quarantine/`), and logs the metadata to the `quarantine_log` SQL table.
4. **The Release Mechanism:** In the Admin UI, clicking "Release" triggers the API to locate the raw `.eml` file on disk and pipe it directly into `/usr/sbin/sendmail -t`, forcing Postfix to immediately deliver the mail to the user's inbox, bypassing the Rspamd filters entirely.
