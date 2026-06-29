# Repo Overview

OpenMailStack is a self-hosted mail platform. The product goal is a fast modern webmail, calendar, and contacts suite in the same broad category as Gmail, Outlook 365, and Proton Mail. SOGo is not the desired end-user experience; it is currently a compatibility reference/legacy stack being reverse engineered where useful, especially for ActiveSync behavior.

The intended client story is:

- iOS users should be able to choose "Exchange", rely on autodiscover, and get mail, calendar, and contacts configured through the ActiveSync-compatible proxy.
- macOS and desktop users can use standards-based IMAP, CalDAV, and CardDAV.
- The web UI should become the primary modern app experience for mail, calendars, contacts, and related settings.

The older core is a bash installer for Postfix, Dovecot, MariaDB, Nginx/PHP, PostfixAdmin, Roundcube, Rspamd, ClamAV, Fail2ban, UFW/firewalld, DKIM sync, and a PHP admin portal. The newer direction adds a React webmail/groupware frontend and a Node/Express proxy for IMAP, ActiveSync, CalDAV, CardDAV/contacts, tasks, notes, and app APIs.

Important roots:

- `install.sh`, `setup_config.sh`, `upgrade.sh`, `uninstall.sh`: installer and lifecycle entrypoints.
- `functions/`: modular install/config scripts. `install.sh` runs these in order and uses `functions/lib_os.sh` plus `functions/backup_restore.sh`.
- `config.default`: template for generated `config.conf`. Do not commit or copy `config.conf`; it is ignored and may contain secrets.
- `admin_portal_src/`: PHP plus vanilla JS admin portal deployed under `/SOGo/admin`.
- `admin_portal_src/public/api.php`: session API for admin/user portal actions.
- `admin_portal_src/public/api_v1.php`: stateless bearer-token provisioning API intended for external systems.
- `admin_portal_src/quarantine_filter.php`: Postfix pipe interceptor for spam quarantine.
- `webmail-backend/`: Node/Express TypeScript backend. Primary source appears to be `src/*.ts`; generated `src/*.js`, `*.d.ts`, and maps also exist.
- `webmail-frontend/`: main React/Vite app for webmail, settings, admin, calendar, and contacts.
- `webmail/`: mostly default Vite starter scaffold, likely superseded by `webmail-frontend`.
- `sogo-modern-ui/`: contains built `dist/` assets and `node_modules`; no first-party source found in the current tree.
- `tests/`: shell lint and integration guard scripts. This directory is currently ignored by `.gitignore`.

Document map:

- `README.md`: product pitch, features, quick start, test command references.
- `INSTALLATION.md`: user-facing install/DNS/rollback guide.
- `TECHNICAL.md`: architecture guide for the installer, mail stack, modern React/Node app, and security controls.
- `ROADMAP.md`: current product-grade roadmap for Mail, Calendar, Contacts, sync, settings, security, and release operations.
- `settings_plan.md`: staged plan for Mail, Calendar, and Contacts settings.
- `docs/webmail-release-validation.md`: release validation checklist for modern webmail behavior.
- `webmail-frontend/README.md`, `webmail-backend/README.md`, `webmail/README.md`: package-local notes.
- `.shared_memory/*.md`: durable project context, commands, implementation state, risks, and change history. Old standalone audit/status docs were removed during documentation cleanup after their useful context was merged here and into the roadmap.

Worktree note from initial review:

- `.gitignore` was already modified before this memory folder was created.
- Several app folders and generated/dependency directories were already untracked, including `webmail-backend/`, `webmail-frontend/`, `webmail/`, and `sogo-modern-ui/`.
- Treat existing untracked or modified files as user work unless explicitly instructed otherwise.
