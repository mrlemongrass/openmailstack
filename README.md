# OpenMailStack
**Open-source, no-paywall mail server stack for Debian and Ubuntu.**

OpenMailStack is an automated Bash deployment script that transforms a fresh Linux server into a full mail platform, without subscription licensing.

**What's included in the box?**
* **MTA & Delivery:** Postfix & Dovecot (LMTP)
* **Databases & Web:** MariaDB, Nginx, PHP-FPM
* **Admin GUI:** Custom OpenMailStack Admin Portal (Unified modern UI accessible via `/SOGo/admin` featuring a System Health Dashboard, DNS/DKIM Generator, Quota Management, Audit Logs, and Embedded Rspamd UI) & PostfixAdmin (Advanced config)
* **Webmail:** Roundcube (Modern Elastic Theme)
* **Security & Anti-Spam:** Rspamd (DKIM/ARC signing), ClamAV (Anti-virus), Fail2ban, UFW Firewall, and automated SSL (Let's Encrypt with self-signed fallback).
* **Automation & Guardrails:** Intelligent state detection, automated pre-flight safety snapshots, interactive point-in-time rollbacks, and an hourly DKIM domain sync.

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

## 🚀 Quick Start (For Advanced Users)

If you are a sysadmin familiar with unblocking Port 25, setting up reverse DNS (PTR), and managing DNS records, here is the fast track:

1. Use a fresh instance of Debian 11/12/13 or Ubuntu 22.04/24.04/25.04.
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
  * **Password:** `ADMIN_PORTAL_PASSWORD`

* **Webmail (Read & Send Emails):**
  * **URL:** `https://mail.example.com/webmail`
  * **Login:** The email address you created in the Admin Portal.

* **PostfixAdmin (Legacy / Advanced Config):**
  * **URL:** `https://mail.example.com/postfixadmin`
  * **Setup Password:** `POSTFIXADMIN_SETUP_PASSWORD`

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

GitHub Actions CI runs automatically on push and pull request via `.github/workflows/ci.yml`.
