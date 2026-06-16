# 🚀 OpenMailStack Features

**The definitive, zero-paywall, open-source mail server stack for Linux (Debian, Ubuntu, RHEL, Alma, Rocky, CentOS).**

Welcome to the feature sheet of OpenMailStack. If you are a sysadmin, a DevOps engineer, or a security researcher who is tired of bloated corporate mail servers locked behind enterprise licenses, you are in the right place. 

We took the most powerful, battle-tested open-source MTAs and MDAs in the world, stitched them together with hyper-efficient SQL bindings, and placed a gorgeously engineered, lightning-fast Admin SPA on top of it.

Here is the ultimate "hype sheet" of exactly what OpenMailStack brings to your bare-metal server.

---

## ⚡ The Architecture

* **Postfix + Dovecot (LMTP):** No local Linux accounts (`/etc/passwd`). Pure Virtual Mailbox lookups routing directly through a lightning-fast Unix Socket.
* **MariaDB Core:** We don't use flat files. Everything from Domain Validation rules to Rspamd routing maps is fully integrated into MariaDB for atomic, highly transactional data management.
* **Dependency-Free Admin SPA:** The Admin Portal is built with Pure PHP 8.2+ and Vanilla JavaScript. No Node_Modules. No React bloat. No Webpack. Just blazing fast asynchronous DOM manipulation and raw `PDO` queries wrapped in a stunning glassmorphism UI.

## 🛡️ Enterprise Security & Multi-Tenancy

* **Strict Role-Based Access Control (RBAC):** Superadmins can see everything. Domain Admins are strictly jailed to their assigned domains. End users are jailed to their own mailboxes.
* **Cryptographic Domain Ownership Verification:** In a multi-tenant environment, you cannot trust users. When a normal Domain Admin adds a domain, it enters a `Pending` state. The Portal generates a cryptographic nonce and forces them to create a DNS TXT record (`openmailstack-verify=<nonce>`). The PHP backend natively queries the global DNS registry before activating the domain, absolutely preventing domain hijacking.
* **Comprehensive Audit Logging:** Every mutating action (password changes, aliases created, domains deleted) is permanently recorded in the `audit_log` SQL table with the exact timestamp and the username of the actor.
* **Automated Safety Rollbacks:** Upgrading shouldn't be a sweat-inducing event. During installation or updates, the script automatically takes pre-flight snapshots of your `/etc/`, `/var/www/`, and MariaDB schemas. If an update fails, simply select `Revert to previous snapshot` from the CLI menu to instantly time-travel your server back to safety.

## 🛑 Next-Generation Anti-Spam Pipeline

We fundamentally re-engineered how Rspamd interacts with a mail stack.
* **Hierarchical JSON Ban Policies:** Drop the confusing flat-file regex configurations. Administrators can block specific IPs, wildcard domains, or sender emails globally, per-domain, or per-user. Rspamd's `multimap` is configured to execute native SQL `JSON_CONTAINS()` queries directly against MariaDB in real-time. A user's personal whitelist will safely override a domain-wide blacklist.
* **SQL Spam Quarantining:** High-scoring spam is no longer silently dropped. 
  1. A custom Rspamd Lua script intercepts scores `>= 15.0` and injects `X-OMS-Quarantine: YES`.
  2. Postfix `header_checks` catches the stamp and shunts the mail down a custom transport pipe.
  3. A lightning-fast PHP CLI filter extracts the raw `.eml`, saves it to an unindexed folder, and inserts the metadata into MariaDB.
  4. Admins can view the raw email in the UI, and click **Release** to force local `sendmail` delivery, bypassing all filters directly into the user's inbox.
* **Automated DKIM & ARC Signing:** Cryptographic keys are automatically generated via an hourly Systemd timer for all newly registered domains.
* **Fail2Ban, UFW & Firewalld:** The stack automatically jails IPs that fail SSH or IMAP auth, and strictly whitelists only necessary mail ports (25, 80, 443, 587, 993) using native OS firewalls.

## 🔌 API & Automation

* **REST API v1:** Generate secure, Bcrypt-hashed Bearer Tokens (`sk_live_...`) in the Admin Portal. External billing systems (like WHMCS) can interact with a completely stateless JSON API to programmatically provision domains, mailboxes, and aliases automatically when your clients pay their invoices.
* **In-Place GitHub Upgrades:** You can update the entire stack without touching the CLI. The web portal securely pulls the latest semantic version tag via the GitHub API, triggers a secure sudoers bridge (`www-data NOPASSWD /usr/local/bin/upgrade.sh`), runs a `git pull`, and atomically swaps out the backend files without exposing root credentials.

## 🧑‍💻 The User Experience

* **Live System Health Dashboards:** The Admin Portal parses `/proc/meminfo` and executing `systemctl is-active` to render live memory, disk usage, and service health states (Postfix, Nginx, Rspamd) visually in the browser.
* **Self-Service Portal:** End-users can securely log into the portal using their Dovecot passwords. They can change their own passwords, set up forwarding aliases, and manage their personal Spam Whitelists/Blacklists—drastically reducing IT support tickets.
* **Modern Webmail:** Shipped out-of-the-box with Roundcube, utilizing the highly responsive Elastic theme.
* **1-Click DNS Generation:** The Admin Portal tells you the exact SPF, DKIM, and DMARC text you need to copy/paste into Cloudflare to guarantee 10/10 inbox deliverability.

---
**OpenMailStack. The mail server, perfected.**
