# openmailstack
OpenMailStack - OpenSource, No-Paywall Mail Server for Debian/Ubuntu
# 🚀 OpenMailStack 

**The 100% Free, Open-Source, No-Paywall Mail Server for Debian & Ubuntu.**

OpenMailStack is a complete, automated bash deployment script that transforms a fresh Linux server into a fully-fledged enterprise mail server. It gives you the power of expensive, paid mail server panels without the subscription fees. 

**What's included in the box?**
* **MTA & Delivery:** Postfix & Dovecot (LMTP)
* **Databases & Web:** MariaDB, Nginx, PHP-FPM
* **Admin GUI:** PostfixAdmin (Manage unlimited domains, aliases, and quotas for free)
* **Webmail:** Roundcube (Modern Elastic Theme)
* **Security & Anti-Spam:** Rspamd (DKIM/ARC signing), ClamAV (Anti-virus), Fail2ban, UFW Firewall, and automated Let's Encrypt SSL.

---

## ⚠️ Phase 1: Prerequisites (Read Before Installing!)

Before you run the script, you **must** ensure your environment is ready. Mail servers are incredibly strict. 

1. **A Fresh OS:** You must use a brand new, completely clean installation of **Ubuntu (22.04 / 24.04)** or **Debian (11 / 12)**. Do not install this on a server that already runs Apache, MySQL, or another control panel.
2. **Memory Requirements:** Your server needs at least **2GB of RAM**. (ClamAV, the anti-virus engine, uses about 1.2GB of RAM by itself. If you have 1GB of RAM, the installation *will* crash).
3. **Port 25 Unblocked:** Many cloud providers (AWS, DigitalOcean, Vultr, Linode) block outgoing Port 25 by default to prevent spam. **You must contact their support to unblock Port 25 before you can send emails.**
4. **Initial DNS Record:** Before running the script, you must point your mail subdomain to your server's IP address, or the SSL certificate generation will fail.
   * Go to your domain registrar (e.g., Cloudflare, Namecheap).
   * Create an **A Record**: Name: `mail` -> Value: `YOUR_VPS_IP_ADDRESS`
   * *Wait 5-10 minutes for this to propagate before continuing.*

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

**Step 3:** Run the installer for the first time. It will safely generate your configuration file and exit.
\`\`\`bash
chmod +x install.sh
./install.sh
\`\`\`

**Step 4:** Open the newly created `config.conf` file and fill in your domain and secure passwords.
\`\`\`bash
nano config.conf
\`\`\`

**Step 5:** Run the installer again. Grab a coffee. The script will take about 5-10 minutes to compile, configure, and secure your entire stack.
\`\`\`bash
./install.sh
\`\`\`

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
This is a cryptographic signature attached to every email you send. The script automatically generated your unique key. 

To find your key, run this command on your server:
\`\`\`bash
cat /var/lib/rspamd/dkim/mail.pub
\`\`\`
Copy the contents inside the parentheses `( ... )` and remove all the quotation marks and spaces so it forms one long continuous string.

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
* **The installation crashed randomly!** -> Check your RAM. If you have less than 2GB, the ClamAV installation will run out of memory and kill the process.
