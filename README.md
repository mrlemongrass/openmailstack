# 🚀 OpenMailStack

**The definitive, zero-paywall, open-source mail server stack for Linux (Debian, Ubuntu, RHEL, Alma, Rocky, CentOS).**

Welcome to OpenMailStack! We transform a fresh Linux server into a beautiful, production-ready, enterprise-grade mail platform in minutes—without the subscription licensing fees. 

Stop wrestling with cryptic config files and manual database queries. OpenMailStack gives you complete sovereignty over your email infrastructure, paired with a gorgeous custom Admin Portal designed for humans.

---

## ✨ What's in the Box?

* 📨 **MTA & Delivery:** Rock-solid Postfix & Dovecot (LMTP) routing.
* 🗄️ **Databases & Web:** MariaDB, Nginx, and PHP-FPM.
* 🎨 **Gorgeous Admin GUI:** The completely custom OpenMailStack Admin Portal (accessible via `/SOGo/admin`).
  * 📊 **Live System Health:** Real-time dashboards monitoring RAM, Disk, and service states.
  * 🔄 **1-Click GitHub Upgrades:** In-place, secure semantic versioning upgrades straight from the GitHub API.
  * 🔑 **DNS & DKIM Generator:** Stop guessing. We generate the exact TXT records you need to copy/paste.
  * 🛡️ **Embedded Security:** Direct single-sign-on access into the Rspamd WebUI.
  * 📜 **Audit Logs:** Track exactly *who* modified *what* account and *when*.
  * ✏️ **Intuitive Editing:** Beautiful popup modals for managing user aliases, quotas, and account suspensions.
  * 🧩 **RESTful API v1:** Generate secure API tokens and easily connect external billing platforms (like WHMCS) to automate provisioning.
  * 🌐 **Self-Service User Portal:** End users can securely log in to change their Dovecot passwords, manage mail-forwarding aliases, and configure personal Rspamd Spam Whitelists/Blacklists.
  * 🏰 **Multi-Tenant Domain Verification:** Domain admins are strictly bounded to their own domains, and can securely add new domains utilizing automated DNS TXT record ownership verification.
  * 🛑 **SQL Spam Quarantining:** High-scoring spam is automatically intercepted at the Postfix MTA level, saved to disk, and logged to MariaDB where admins can securely review, delete, or release it to users' inboxes directly from the UI.
  * 🚫 **Hierarchical JSON Ban Policies:** Configure granular domain or server-wide blocklists for specific IPs, wildcard domains, or file extensions, parsed dynamically by Rspamd.
* 📧 **Mail, Calendar & Contacts:** The primary end-user experience is the React/Vite app in `webmail-frontend`, backed by the Node/Express mail and sync proxy in `webmail-backend`. Roundcube remains available as a legacy mail fallback while the modern suite continues to mature.
* 🛑 **Security & Anti-Spam:** Rspamd (DKIM/ARC signing), ClamAV (Anti-virus), Fail2ban, UFW Firewall, and automated Let's Encrypt SSL.
* 🤖 **Automation & Guardrails:** Intelligent state detection, automated pre-flight safety snapshots, interactive point-in-time rollbacks, and hourly automated DKIM domain synchronization.

---

## 📖 Installation Documentation

Mail servers are notoriously strict and require precise DNS configuration, port availability, and OS preparation. 

👉 **[Please click here to read the comprehensive INSTALLATION.md guide](INSTALLATION.md)** 👈

The Installation Guide provides a highly detailed, lay-person friendly walkthrough covering:
1. Server preparation and port requirements.
2. The exact DNS records (SPF, DKIM, DMARC, MX) required to keep your emails out of the spam folder.
3. Step-by-step command execution.
4. Troubleshooting tips.

---

## 🤓 Technical Deep Dive

Are you a sysadmin, a security researcher, or just an unapologetic nerd? We love transparency. We documented *every single detail* of how OpenMailStack works under the hood.

👉 **[Read the TECHNICAL.md Architecture Guide](TECHNICAL.md)** 👈

## 🗺️ Roadmap

The modern React webmail, calendar, contacts, and sync stack is under active development. Current product and release priorities live in **[ROADMAP.md](ROADMAP.md)**.

---

## ⚡ Quick Start (For Advanced Users)

If you are a sysadmin familiar with unblocking Port 25, setting up reverse DNS (PTR), and managing DNS records, here is the fast track:

1. Use a fresh instance of Debian 11/12/13, Ubuntu 22.04/24.04/25.04, or RHEL/Alma/Rocky/CentOS 8/9.
2. Point an A Record for `mail.yourdomain.com` to your server's IP.
3. Run the following commands as `root`:

```bash
git clone https://github.com/mrlemongrass/openmailstack.git
cd openmailstack
chmod +x setup_config.sh install.sh

# Follow the wizard to generate config.conf with secure passwords
./setup_config.sh

# Review config.conf (disable ClamAV here if RAM < 2GB)
nano config.conf

# Install the stack
./install.sh
```

---

## 🌐 Accessing Your Server

Once installation is complete, you can find your automatically generated passwords by running `cat config.conf` on your server.

* **OpenMailStack Admin Portal (Manage Domains & Mailboxes):**
  * **URL:** `https://mail.example.com/SOGo/admin`
  * **Password:** Check `config.conf` or your SSH terminal output!

* **Modern Webmail (Read & Send Emails):**
  * **URL:** `https://mail.example.com/`
  * **Login:** The email address you created in the Admin Portal.

* **Legacy Roundcube Fallback:**
  * **URL:** `https://mail.example.com/webmail`

---

## 🧹 Uninstallation

If you made a mistake or want to wipe the server and start fresh, run the uninstall script. 
**WARNING: This will permanently delete all databases and emails!**
```bash
chmod +x uninstall.sh
./uninstall.sh
```

---

### Development: CI and Integration Tests

Run lint checks locally:
```bash
./tests/lint/run.sh
```

Run integration checks locally:
```bash
./tests/integration/run.sh
```

Run staging smoke tests on a deployed host (as `root`):
```bash
./tests/integration/staging_smoke.sh ./config.conf
```
