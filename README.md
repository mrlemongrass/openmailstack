# OpenMailStack
**Open-source, no-paywall mail server stack for Debian and Ubuntu.**

OpenMailStack is an automated Bash deployment script that transforms a fresh Linux server into a full mail platform, without subscription licensing.

**What's included in the box?**
* **MTA & Delivery:** Postfix & Dovecot (LMTP)
* **Databases & Web:** MariaDB, Nginx, PHP-FPM
* **Admin GUI:** PostfixAdmin (Manage unlimited domains, aliases, and quotas for free)
* **Webmail:** Roundcube (Modern Elastic Theme)
* **Security & Anti-Spam:** Rspamd (DKIM/ARC signing), ClamAV (Anti-virus), Fail2ban, UFW Firewall, and automated SSL (Let's Encrypt with self-signed fallback).
* **Automation & Safety:** Hourly DKIM domain sync (`openmailstack-dkim-sync.timer`) and SHA256 verification for downloaded PostfixAdmin/Roundcube release tarballs.

---

## ⚠️ Phase 1: Prerequisites (Read Before Installing!)

Before you run the script, you **must** ensure your environment is ready. Mail servers are incredibly strict. 

1. **A Fresh OS:** You must use a brand new, completely clean installation of **Debian (11 / 12 / 13)** or **Ubuntu (22.04 / 24.04 / 25.04)**. Do not install this on a server that already runs Apache, MySQL, or another control panel.
2. **Memory Requirements:** **2GB RAM is recommended** when ClamAV is enabled (default). On low-memory servers, set `CLAMAV_ENABLED="0"` in `config.conf` before running `install.sh`.
3. **Port 25 Unblocked:** Many cloud providers (AWS, DigitalOcean, Vultr, Linode) block outgoing Port 25 by default to prevent spam. **You must contact their support to unblock Port 25 before you can send emails.**
4. **Initial DNS Record:** Before running the script, you must point your mail subdomain to your server's IP address, or the SSL certificate generation will fail.
   * Go to your domain registrar (e.g., Cloudflare, Namecheap).
   * Create an **A Record**: Name: `mail` -> Value: `YOUR_VPS_IP_ADDRESS`
   * *Wait 5-10 minutes for this to propagate before continuing.*
   * The configuration wizard verifies `mail.<your-domain>` resolution, because that's the actual SSL certificate target.

### ✅ Optional: Compatibility Dry Run (No Changes)
You can check OS support and resolved install decisions before making any system changes:
\`\`\`bash
bash ./install.sh --dry-run
\`\`\`
The report shows detected platform/version, PHP-FPM service/socket, Rspamd repo codename, and base package set.

---

## 🛠️ Phase 2: Installation

**Step 1:** Log into your server as the `root` user via SSH.
\`\`\`bash
sudo su -
\`\`\`

**Step 2:** Clone this repository and enter the directory.
\`\`\`bash
git clone https://github.com/mrlemongrass/openmailstack.git
cd openmailstack
\`\`\`

**Step 3 (Optional but recommended):** Run a safe dry run to verify compatibility and resolved settings.
\`\`\`bash
bash ./install.sh --dry-run
\`\`\`

**Step 4:** Run the configuration wizard to generate `config.conf` with secure random passwords.
\`\`\`bash
chmod +x setup_config.sh install.sh
./setup_config.sh
\`\`\`

**Step 5:** Review the generated `config.conf` file and adjust values if needed.
\`\`\`bash
nano config.conf
\`\`\`
Optional toggles in `config.conf`:
\`\`\`bash
SSL_CERT_MODE="auto"      # auto | letsencrypt | self-signed
CLAMAV_ENABLED="1"        # 1 = enabled, 0 = disabled
POSTFIXADMIN_ALLOW_LAB_DOMAINS="0"  # 0 = enforce DNS checks, 1 = lab mode
\`\`\`

**Step 6:** Run the installer. Grab a coffee. The script will take about 5-10 minutes to compile, configure, and secure your entire stack.
\`\`\`bash
./install.sh
\`\`\`

If some optional packages are unavailable for your OS version (for example, certain PHP extensions), the installer will continue and print a **Non-Fatal Issues Encountered** summary at the end.

### 📦 Required vs Optional Packages
OpenMailStack now does OS/version-aware package checks before installation.

- **Required packages:** must exist for your platform; installation stops if missing.
- **Optional packages:** installer skips them when unavailable and reports them at the end.

| Module | Required Packages | Optional Packages | If Optional Is Missing |
| :--- | :--- | :--- | :--- |
| `00_pre_flight.sh` | Base tooling from platform matrix (`curl`, `wget`, `lsb-release`, etc.) | None | N/A |
| `01_system_db.sh` | `mariadb-server`, `nginx`, PHP core modules (`fpm`, `mysql`, `cli`, `mbstring`, `intl`, `xml`, `curl`, `zip`, `gd`, `bz2`) | `php-imap`, `php-ldap` | Roundcube/PostfixAdmin may run with reduced feature coverage |
| `03_postfix.sh` | `postfix`, `postfix-mysql` | None | N/A |
| `04_dovecot.sh` | `dovecot-core`, `dovecot-imapd`, `dovecot-lmtpd`, `dovecot-mysql` | `dovecot-pop3d` | POP3 is disabled automatically; IMAP/LMTP continue |
| `05_rspamd_clamav.sh` | `redis-server`, `rspamd` | `clamav-daemon`, `clamav-freshclam` | Mail server continues without ClamAV antivirus scanning |
| `07_security.sh` | `openssl` | `certbot`, `python3-certbot-nginx`, `ufw`, `fail2ban` | Falls back to self-signed cert and/or skips firewall/fail2ban setup |

---

## 🛡️ Phase 3: The "Anti-Spam Shield" (DNS Records)

If you skip this step, Gmail, Outlook, and Yahoo will reject your emails. You must prove to the internet that your server is legally allowed to send mail on behalf of your domain.

Log into your DNS provider and create the following records:

### 1. MX Record (Mail Exchange)
Tells the internet where to deliver incoming mail for `example.com`.

| Type | Name / Host | Value / Target | Priority |
| :--- | :--- | :--- | :--- |
| **MX** | `@` (or `example.com`) | `mail.example.com` | `10` |

### 2. SPF Record (Sender Policy Framework)
Tells the internet which IP addresses are allowed to send emails from your domain.

| Type | Name / Host | Value / Target |
| :--- | :--- | :--- |
| **TXT** | `@` | `v=spf1 mx a:mail.example.com -all` |

### 3. DMARC Record
Tells receiving servers what to do if an email fails the SPF or DKIM check (we set it to quarantine/spam folder to be safe).

| Type | Name / Host | Value / Target |
| :--- | :--- | :--- |
| **TXT** | `_dmarc` | `v=DMARC1; p=quarantine; rua=mailto:postmaster@example.com;` |

### 4. DKIM Record (DomainKeys Identified Mail)
This is a cryptographic signature attached to every email you send. The script generates one DKIM key per domain.

To list generated DKIM public keys, run:
\`\`\`bash
ls /var/lib/rspamd/dkim/*.pub
\`\`\`
Example for `example.com`:
\`\`\`bash
cat /var/lib/rspamd/dkim/example.com.pub
\`\`\`
Copy the contents inside the parentheses `( ... )` and remove all quotation marks and spaces so it forms one long continuous string.
New domains added in PostfixAdmin are synced automatically by the `openmailstack-dkim-sync.timer` (hourly).
To sync immediately, run:
\`\`\`bash
sudo /usr/local/sbin/openmailstack-dkim-sync
\`\`\`

| Type | Name / Host | Value / Target |
| :--- | :--- | :--- |
| **TXT** | `mail._domainkey` | `v=DKIM1; k=rsa; p=YOUR_MASSIVE_LONG_KEY_STRING_HERE...` |

### 5. Reverse DNS (PTR Record)
This cannot be done in your domain registrar. You must go to your **VPS Hosting Dashboard** (e.g., DigitalOcean, Hetzner, Linode) and set the Reverse DNS / PTR record for your IP address to:
`mail.example.com`

---

## 🌐 Phase 4: Accessing Your Server

Once installation is complete and your DNS is set, you can access your server using the passwords you set in `config.conf`.

* **Admin Panel (Create Mailboxes & Aliases):**
  * **URL:** `https://mail.example.com/postfixadmin`
  * **Setup Password:** The `POSTFIXADMIN_SETUP_PASSWORD` from your config file.
  * *Note: Log in with the Setup Password, create a Superadmin account, and then you can start adding domains and mailboxes!*

* **Webmail (Read & Send Emails):**
  * **URL:** `https://mail.example.com/webmail`
  * **Login:** `you@example.com` (After you create the mailbox in PostfixAdmin)
  * **Password:** The password you assigned the user in PostfixAdmin.

---

## 🧹 Uninstallation

If you made a mistake or want to wipe the server and start fresh, run the uninstall script. 
**WARNING: This will permanently delete all databases and emails!**
\`\`\`bash
chmod +x uninstall.sh
./uninstall.sh
\`\`\`

---

### Troubleshooting

* **I can receive emails, but I can't send them!** -> Your hosting provider has blocked Port 25. Open a support ticket with them to unblock it.
* **My emails are still going to Spam!** -> DNS changes can take up to 24 hours to propagate. Wait a bit, and test your score using [Mail-Tester.com](https://www.mail-tester.com/).
* **The installation crashed randomly!** -> Check your RAM. If memory is low, set `CLAMAV_ENABLED="0"` in `config.conf` and re-run.
* **Installer says my OS is unsupported!** -> Run `bash ./install.sh --dry-run` and verify you are on one of the supported versions: Debian 11/12/13 or Ubuntu 22.04/24.04/25.04.

---

### Development: CI and Integration Tests

Run lint checks locally:
\`\`\`bash
./tests/lint/run.sh
\`\`\`

Run integration checks locally:
\`\`\`bash
./tests/integration/run.sh
\`\`\`

Run dry-run integration inside a specific container:
\`\`\`bash
./tests/integration/dry_run_container.sh debian:12 debian-12
\`\`\`

Run staging smoke tests on a deployed host (as `root`):
\`\`\`bash
./tests/integration/staging_smoke.sh ./config.conf
\`\`\`

GitHub Actions CI runs automatically on push and pull request via `.github/workflows/ci.yml`.
