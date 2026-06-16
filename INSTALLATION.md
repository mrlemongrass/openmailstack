# OpenMailStack Installation Guide

Welcome! Building a mail server from scratch can be intimidating, but this guide is designed to hold your hand through the entire process. Whether you are an experienced sysadmin or a complete beginner, following these steps exactly will guarantee you a functioning, secure, and spam-free email platform.

---

## Phase 1: Prerequisites (Do Not Skip!)

Before running the installation script, there are several strict requirements you must meet. **Mail servers are unforgiving.** If you skip these, your emails will go to spam, or the installation will fail entirely.

### 1. A Fresh Operating System
You **must** use a brand new, completely clean server. If your server already has Apache, Nginx, MySQL, or a control panel (like cPanel or CyberPanel) installed, this script will clash with them and break your system.
* Supported OS: **Debian 11 / 12 / 13**, **Ubuntu 22.04 / 24.04 / 25.04**, or **RHEL / AlmaLinux / Rocky Linux / CentOS Stream 8 / 9**

### 2. Check Port 25 (Crucial Step)
Almost all major cloud providers (AWS, Google Cloud, DigitalOcean, Vultr, Linode) block outbound Port 25 by default. This is to stop malicious users from creating spam bots. **If Port 25 is blocked, you can receive emails, but you cannot send them.**
* **Action Required:** Open a support ticket with your hosting provider and ask them to "unblock outbound Port 25 for mail server usage." They usually approve this within a few hours if your account is in good standing.

### 3. Memory Requirements
Anti-virus software (ClamAV) requires a decent amount of RAM to load its virus definitions.
* **Recommended:** 2GB of RAM or higher.
* **Low Memory:** If your server has only 1GB of RAM, you must disable ClamAV during the setup, or the installation will crash out of memory.

### 4. Initial DNS Setup
Before the script can secure your server with an SSL certificate, it needs to prove you actually own the domain. 
Go to your Domain Registrar (where you bought the domain, like Namecheap, GoDaddy, or Cloudflare) and create an **A Record**:
* **Type:** A Record
* **Name:** `mail`
* **Target / Value:** `Your Server's IP Address`

*Note: Wait 10-15 minutes after doing this before running the script. DNS takes time to update across the internet.*

---

## Phase 2: Running the Installation Script

Once your server is fresh, Port 25 is unblocked, and your `mail` A Record is pointing to your IP, you are ready to begin.

**Step 1:** Log into your server via SSH as the `root` user.
```bash
sudo su -
```

**Step 2:** Download the OpenMailStack repository.
```bash
git clone https://github.com/mrlemongrass/openmailstack.git
cd openmailstack
```

**Step 3:** Make the scripts executable.
```bash
chmod +x setup_config.sh install.sh
```

**Step 4:** Run the configuration wizard.
```bash
./setup_config.sh
```
The wizard will ask you for your primary domain (e.g., `example.com`) and an admin email. It will then generate a file called `config.conf` containing highly secure, randomly generated passwords for your databases and admin portals.

**Step 5:** Review your configuration.
```bash
nano config.conf
```
*If your server has less than 2GB of RAM, change `CLAMAV_ENABLED="1"` to `CLAMAV_ENABLED="0"` here.*

**Step 6:** Start the installer.
```bash
./install.sh
```
Grab a coffee! The script will take 5 to 10 minutes to download, install, and configure MariaDB, Nginx, PHP, Postfix, Dovecot, Rspamd, ClamAV, the OpenMailStack Admin Portal, and Roundcube Webmail. 

---

## Phase 2.5: Existing Installations & Safety Rollbacks

If you run `./install.sh` on a server that already has OpenMailStack installed, the script will intelligently detect your existing state. Instead of blindly overwriting your data, it will present an interactive menu:

1. **Install/Configure only missing components**: Perfect for upgrading or adding newly developed features (like the new Admin Portal) without disrupting your working mailflow.
2. **Reinstall everything**: Forces an overwrite of the existing setup.
3. **Revert to a previous safety snapshot (Rollback)**: Allows you to instantly rewind your server state.

### Automated Safety Snapshots
Any time you choose Option 1 or 2 on an existing installation, the script automatically takes a complete backup of your database schemas, configuration files, and web directories. These are securely stored in `/var/backups/openmailstack/`. 
* **Data Retention & Cleanups**: After creating a backup, the script will notify you if it finds backups older than 30 days. It will interactively ask if you'd like to purge them, allowing you to selectively delete old snapshots to save disk space, or retain them for strict compliance auditing.

### Performing a Rollback
If a new component breaks your server, simply run `./install.sh` again and select Option 3 (`Revert to a previous safety snapshot`). You will be presented with a list of timestamped backups. Selecting one will instantly restore your databases, configurations, and web files to that exact moment in time, ensuring maximum uptime and zero headaches.

---

## Phase 3: The "Anti-Spam Shield" (DNS Records)

If you skip this phase, every email you send will immediately go into the recipient's Spam folder. You must prove to Gmail, Outlook, and Yahoo that your server is legally authorized to send emails on behalf of your domain.

Log back into your Domain Registrar (Cloudflare, Namecheap, etc.) and add the following records:

### 1. MX Record (Mail Exchange)
This tells the internet where to deliver incoming emails addressed to your domain.
* **Type:** MX
* **Name:** `@` (or leave blank, depending on your provider)
* **Value:** `mail.example.com`
* **Priority:** `10`

### 2. SPF Record (Sender Policy Framework)
This tells the internet which IP addresses are permitted to send emails from your domain.
* **Type:** TXT
* **Name:** `@`
* **Value:** `v=spf1 mx a:mail.example.com -all`

### 3. DMARC Record
This tells receiving servers what to do if an email fails the SPF or DKIM check. We set it to quarantine (send to spam) to protect your reputation.
* **Type:** TXT
* **Name:** `_dmarc`
* **Value:** `v=DMARC1; p=quarantine; rua=mailto:postmaster@example.com;`

### 4. DKIM Record (DomainKeys Identified Mail)
This is a cryptographic signature attached to every email you send. The OpenMailStack script automatically generated this unique key for you during installation.

To find your unique key, run this command on your server:
```bash
cat /var/lib/rspamd/dkim/example.com.pub
```
You will see a block of text. Copy everything inside the parentheses `( ... )`, remove all the quotation marks and spaces, and paste it as one long continuous string into this DNS record:
* **Type:** TXT
* **Name:** `mail._domainkey`
* **Value:** `v=DKIM1; k=rsa; p=YOUR_MASSIVE_LONG_KEY_STRING_HERE...`

### 5. Reverse DNS (PTR Record)
You cannot do this in your domain registrar. You must log into your **Hosting Provider Dashboard** (e.g., DigitalOcean, Hetzner, Linode). Look for the networking or IP address settings and set the "Reverse DNS" or "PTR Record" for your server's IP address to: `mail.example.com`

---

## Phase 4: Accessing Your Server

Once your installation is complete and your DNS records have propagated, you can access your web interfaces. To find your passwords, run `cat config.conf` on your server.

### 1. The Admin Portal
* **URL:** `https://mail.example.com/SOGo/admin`
* **Password:** Use the `ADMIN_PORTAL_PASSWORD` from your config file.
* **Usage:** Use this beautiful, unified dashboard to:
  * Monitor real-time system health and server resources (CPU, RAM, Disk).
  * Create domains, mailboxes, aliases, and manage cross-domain routing.
  * Enforce strict disk storage quotas for domains and individual users.
  * Generate and instantly copy required DNS/DKIM records.
  * Review the SQL Spam Quarantine to safely release or delete intercepted emails.
  * Configure Hierarchical JSON Spam Policies to block specific IPs, domains, or attachments.
  * Access the embedded Rspamd WebUI to monitor live spam scoring. *(Note: Rspamd requires its own master password. The portal automatically extracts this from your server config and displays it above the embedded view so you can easily copy/paste it to log in).*
  * Review comprehensive Audit Logs of all administrative actions.

### 2. Webmail
* **URL:** `https://mail.example.com/webmail`
* **Login:** The full email address you just created in the Admin Portal (e.g., `you@example.com`).
* **Password:** The password you assigned to that user in the Admin Portal.
* **Usage:** Send and receive emails through the modern Roundcube Elastic interface.

### 3. PostfixAdmin (Advanced/Legacy)
* **URL:** `https://mail.example.com/postfixadmin`
* **Setup Password:** Use the `POSTFIXADMIN_SETUP_PASSWORD` from your config file.
* **Usage:** Only required if you need to access advanced legacy features not currently covered by the new OpenMailStack Admin Portal.

---

## Troubleshooting

* **I can receive emails, but I can't send them!** -> Your hosting provider has blocked outbound Port 25. Open a support ticket with them.
* **My emails are going to Spam!** -> DNS changes can take up to 24 hours to propagate across the globe. Wait a bit, and test your spam score using [Mail-Tester.com](https://www.mail-tester.com/). Ensure your Reverse DNS (PTR) is set properly.
* **The installation crashed randomly!** -> You likely ran out of RAM. Ensure you have 2GB, or edit `config.conf` to set `CLAMAV_ENABLED="0"` and re-run `./install.sh`.
* **Installer says my OS is unsupported!** -> Ensure you are running a fresh install of Debian 11/12/13, Ubuntu 22.04/24.04/25.04, or RHEL/Alma/Rocky/CentOS 8/9. You can run `bash ./install.sh --dry-run` to see what the script detects.
