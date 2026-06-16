# 🚀 OpenMailStack

**The definitive, zero-paywall, open-source mail server stack for Debian and Ubuntu.**

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
* 📧 **Webmail:** Roundcube with a modern, responsive Elastic Theme.
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

---

## ⚡ Quick Start (For Advanced Users)

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
  * **Password:** Check `config.conf` or your SSH terminal output!

* **Webmail (Read & Send Emails):**
  * **URL:** `https://mail.example.com/webmail`
  * **Login:** The email address you created in the Admin Portal.

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
