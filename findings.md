# OpenMailStack Security and Architectural Audit Report

This report outlines the critical vulnerabilities, architectural flaws, and breaking bugs discovered during the line-by-line audit of the OpenMailStack deployment codebase. Issues are categorized and prioritized, with specific lines of code, explanations of the impact, and the exact corrected code blocks required to patch them.

---

## 1. Upgrade Paths and Idempotency (The "What Could Go Wrong" Test)

### Vulnerability 1: Destructive Upgrade Path in Admin Portal
* **Severity:** Critical
* **Specific Line(s):** `functions/09_admin_portal.sh` lines 24-26, 36-41.
* **Why it is a problem:** If a user runs `install.sh` twice to fix a broken component, `09_admin_portal.sh` blindly executes `rm -rf /var/www/openmailstack-admin`. This entirely wipes out the directory, including any UI customizations the user may have made. Furthermore, it silently overwrites `config.php` with new defaults, discarding existing configurations (such as updated passwords) and breaking the deployment.
* **Corrected Code Block:** Remove `rm -rf` and strictly check for an existing `config.php`.

```bash
# 1. Prepare directory and copy files
echo -e "Deploying files to /var/www/openmailstack-admin..."
mkdir -p /var/www/openmailstack-admin
cp -r "${SCRIPT_DIR}/../admin_portal_src/"* /var/www/openmailstack-admin/

# 2. Configure credentials
echo -e "Configuring Admin Portal..."
DB_USER_PHP=$(printf '%s\n' "$POSTFIXADMIN_DB_USER" | sed -e 's/\\/\\\\/g' -e "s/'/\\\'/g" -e 's/[\/&]/\\&/g')
DB_PASS_PHP=$(printf '%s\n' "$POSTFIXADMIN_DB_PASSWORD" | sed -e 's/\\/\\\\/g' -e "s/'/\\\'/g" -e 's/[\/&]/\\&/g')
DB_NAME_PHP=$(printf '%s\n' "$POSTFIXADMIN_DB_NAME" | sed -e 's/\\/\\\\/g' -e "s/'/\\\'/g" -e 's/[\/&]/\\&/g')
ADMIN_PASS_PHP=$(printf '%s\n' "${ADMIN_PORTAL_PASSWORD:-ChangeMe}" | sed -e 's/\\/\\\\/g' -e "s/'/\\\'/g" -e 's/[\/&]/\\&/g')

# Only generate config if it doesn't already exist to preserve customizations
if [[ ! -f /var/www/openmailstack-admin/config.php ]]; then
    mv /var/www/openmailstack-admin/config.php.template /var/www/openmailstack-admin/config.php
    sed -i "s/{{DB_USER}}/${DB_USER_PHP}/g" /var/www/openmailstack-admin/config.php
    sed -i "s/{{DB_PASS}}/${DB_PASS_PHP}/g" /var/www/openmailstack-admin/config.php
    sed -i "s/{{DB_NAME}}/${DB_NAME_PHP}/g" /var/www/openmailstack-admin/config.php
    sed -i "s/{{ADMIN_PASS}}/${ADMIN_PASS_PHP}/g" /var/www/openmailstack-admin/config.php
else
    rm -f /var/www/openmailstack-admin/config.php.template
fi
```

### Vulnerability 2: Overwriting Existing Admins on Upgrade
* **Severity:** High
* **Specific Line(s):** `functions/09_admin_portal.sh` line 122.
* **Why it is a problem:** The `ON DUPLICATE KEY UPDATE` clause silently overwrites an existing administrator's password and status. Rerunning `install.sh` will seamlessly reset an existing admin's password back to the default/newly prompted one without warning, potentially locking them out of their systems.
* **Corrected Code Block:**

```bash
    mysql -u "$POSTFIXADMIN_DB_USER" -p"$POSTFIXADMIN_DB_PASSWORD" "$POSTFIXADMIN_DB_NAME" -e "INSERT IGNORE INTO admin (username, password, superadmin, active) VALUES ('$ADMIN_USER_SQL', '$ADMIN_HASH', 1, 1);"
```

### Vulnerability 3: Interactive Prompts Blocking Unattended Upgrades
* **Severity:** High
* **Specific Line(s):** `functions/backup_restore.sh` line 55.
* **Why it is a problem:** `backup_restore.sh` is automatically called by `install.sh` during component upgrades. If backups older than 30 days exist, it drops to an interactive prompt (`read -p`). If this stack is provisioned via cloud-init, cron, or Ansible, the installation will silently hang forever.
* **Corrected Code Block:**

```bash
    if [[ ! -t 0 || "${DEBIAN_FRONTEND:-}" == "noninteractive" ]]; then
        return 0 # Skip interactive cleanup if running headless
    fi
    echo -e "\n${YELLOW}Found ${#old_backups[@]} backup(s) older than 30 days in ${BACKUP_ROOT}.${NC}"
    read -p "Would you like to manage/delete them to save disk space? (y/N): " manage_opt
```

---

## 2. Security and Vulnerability Assessment

### Vulnerability 4: SQL Injection in Admin Portal Account Setup
* **Severity:** Critical
* **Specific Line(s):** `functions/09_admin_portal.sh` lines 93, 98, 99, 122.
* **Why it is a problem:** The script prompts the user for `$ADMIN_USER` and concatenates it directly into the `mysql -e` execution string without sanitization. An attacker (or misinformed user) could enter `' OR 1=1; DROP TABLE admin; --` leading to complete database destruction.
* **Corrected Code Block:** Ensure you escape the input securely before parsing it into MySQL.

```bash
    # Securely escape the user input
    ADMIN_USER_SQL=$(printf "%s" "$ADMIN_USER" | sed -e 's/\\/\\\\/g' -e "s/'/''/g")
    
    # Use the escaped variable in all subsequent SQL calls
    USER_EXISTS=$(mysql -u "$POSTFIXADMIN_DB_USER" -p"$POSTFIXADMIN_DB_PASSWORD" "$POSTFIXADMIN_DB_NAME" -se "SELECT COUNT(*) FROM mailbox WHERE username='$ADMIN_USER_SQL'")
```

### Vulnerability 5: Insecure Webroot Permissions
* **Severity:** High
* **Specific Line(s):** `functions/09_admin_portal.sh` lines 43-45.
* **Why it is a problem:** The script assigns full read/write ownership of the entire admin portal directory to the web server (`chown -R www-data:www-data`). If a vulnerability in PHP or a plugin allows remote code execution or file uploads, the attacker can seamlessly overwrite `config.php` and base source code to establish persistence. The web server only needs *read* access.
* **Corrected Code Block:**

```bash
chown -R root:www-data /var/www/openmailstack-admin
find /var/www/openmailstack-admin -type d -exec chmod 750 {} \;
find /var/www/openmailstack-admin -type f -exec chmod 640 {} \;
```

### Vulnerability 6: PHP Syntax Breaking via Sed Injection
* **Severity:** Medium
* **Specific Line(s):** `functions/09_admin_portal.sh` lines 31-34.
* **Why it is a problem:** Using `sed` to inject variables into a PHP file is dangerous if the variable contains a single quote (`'`). Since PHP strings in your template use single quotes, a user generating a password like `my'pass` will result in `define('DB_PASS', 'my'pass');`, immediately throwing a PHP syntax error and taking down the portal.
* **Corrected Code Block:** Include single-quote escaping in the injection prep block (patched in Vulnerability 1 above).

---

## 3. Error Handling and Resilience

### Vulnerability 7: Fatal Crash on Package Repository Downtime
* **Severity:** High
* **Specific Line(s):** `functions/00_pre_flight.sh` line 70.
* **Why it is a problem:** Because `set -e` is active, executing `apt-get update -qq` without a fallback handler means if an external repository (e.g., SOGo, Rspamd) is temporarily unreachable or returning an HTTP 500, the entire installer will abruptly terminate with a generic bash error instead of giving the user graceful instructions.
* **Corrected Code Block:**

```bash
apt-get update -qq || {
    echo -e "\n${RED}Error: Package update failed. An external repository may be temporarily down.${NC}" >&2
    echo -e "Please check your network connection or /etc/apt/sources.list and try again.${NC}" >&2
    exit 1
}
```

### Vulnerability 8: Fragile Pipeline for Dovecot Version Checking
* **Severity:** Medium
* **Specific Line(s):** `functions/07_security.sh` line 177.
* **Why it is a problem:** `DOVECOT_VERSION=$(dovecot --version | grep -oE '^[0-9]+\.[0-9]+')`. Because `set -euo pipefail` is enforced, if `grep` fails to find a match (e.g., unexpected version format, or missing binary), `pipefail` will propagate exit code `1` and instantly crash the script.
* **Corrected Code Block:**

```bash
DOVECOT_VERSION=$(dovecot --version 2>/dev/null | grep -oE '^[0-9]+\.[0-9]+' || echo "unknown")
if [[ "$DOVECOT_VERSION" == "unknown" ]]; then
    echo -e "${YELLOW}Warning: Could not dynamically parse Dovecot version. Defaulting to 2.3 logic.${NC}"
    DOVECOT_VERSION="2.3"
fi
```

---

## 4. Public Open-Source Readiness

### Vulnerability 9: Hardcoded Absolute Paths for Project Files
* **Severity:** High
* **Specific Line(s):** `functions/09_admin_portal.sh` line 26, `install.sh` lines 116, 122.
* **Why it is a problem:** The deployment assumes the repository will strictly live at `/root/openmailstack/`. `09_admin_portal.sh` does `cp -r /root/openmailstack/admin_portal_src/*`. If a user clones this repository into `/home/user/` or `/opt/`, the admin portal deployment will completely fail. Furthermore, `install.sh` relies on `./config.conf`, meaning it will fail if executed from outside the directory (e.g., `sudo /opt/openmailstack/install.sh`).
* **Corrected Code Block (for `09_admin_portal.sh`):**

```bash
cp -r "${SCRIPT_DIR}/../admin_portal_src/"* /var/www/openmailstack-admin/
```

* **Corrected Code Block (for `install.sh`):**

```bash
# 4. Config File Check
if [[ ! -f "${SCRIPT_DIR}/config.conf" ]]; then
    echo -e "${RED}Error: No config.conf found in ${SCRIPT_DIR}.${NC}"
    echo -e "Please run ${YELLOW}sudo ${SCRIPT_DIR}/setup_config.sh${NC} first to generate your secure configuration."
    exit 1
fi

source "${SCRIPT_DIR}/config.conf"
```

### Vulnerability 10: Incomplete SQL Literal Escaping (Backslash Injection)
* **Severity:** Medium
* **Specific Line(s):** `functions/01_system_db.sh` line 24.
* **Why it is a problem:** `escape_sql_literal` uses `sed "s/'/''/g"` to prevent SQL injection. However, MariaDB processes backslash escapes by default. If a user manually defines a password containing a backslash (`\`), it will escape the closing SQL quote (e.g., `'password\'`), leaving the string unterminated and causing the database creation to fail entirely.
* **Corrected Code Block:**

```bash
escape_sql_literal() {
    printf "%s" "$1" | sed -e 's/\\/\\\\/g' -e "s/'/''/g"
}
```
