# OpenMailStack Security and Architectural Audit Report (2nd Pass)

This document contains a consolidated list of findings from both the first and second pass audits of the OpenMailStack codebase.

## 1. Validated First-Pass Findings (All Confirmed)

### Vulnerability 1: Destructive Upgrade Path in Admin Portal
* **Severity:** Critical
* **Specific Line(s):** `functions/09_admin_portal.sh` lines 24-26, 36-41.
* **Why it is a problem:** Re-running the script wipes out `/var/www/openmailstack-admin` and overwrites `config.php`, destroying existing UI configurations and settings.
* **Corrected Code Block:** Remove `rm -rf` and strictly check for an existing `config.php`.

### Vulnerability 2: Overwriting Existing Admins on Upgrade
* **Severity:** High
* **Specific Line(s):** `functions/09_admin_portal.sh` line 122.
* **Why it is a problem:** `ON DUPLICATE KEY UPDATE` resets an existing administrator's password and status seamlessly without warning.

### Vulnerability 3: Interactive Prompts Blocking Unattended Upgrades
* **Severity:** High
* **Specific Line(s):** `functions/backup_restore.sh` line 55.
* **Why it is a problem:** Prompts block unattended deployments (e.g. cloud-init, Ansible), causing the installer to hang indefinitely.

### Vulnerability 4: SQL Injection in Admin Portal Account Setup
* **Severity:** Critical
* **Specific Line(s):** `functions/09_admin_portal.sh` lines 93, 98, 99, 122.
* **Why it is a problem:** Unsanitized user inputs are directly concatenated into `mysql -e` statements, allowing arbitrary SQL execution.

### Vulnerability 5: Insecure Webroot Permissions
* **Severity:** High
* **Specific Line(s):** `functions/09_admin_portal.sh` lines 43-45.
* **Why it is a problem:** Handing full read/write ownership of the web root to `www-data` allows attackers to overwrite source code and config files if a web vulnerability is found.

### Vulnerability 6: PHP Syntax Breaking via Sed Injection
* **Severity:** Medium
* **Specific Line(s):** `functions/09_admin_portal.sh` lines 31-34.
* **Why it is a problem:** `sed` fails to escape single quotes, which leads to PHP syntax breakage when injecting into `config.php.template`.

### Vulnerability 7: Fatal Crash on Package Repository Downtime
* **Severity:** High
* **Specific Line(s):** `functions/00_pre_flight.sh` line 70.
* **Why it is a problem:** `apt-get update -qq` without a fallback handler under `set -e` will violently crash the script on transient repository failures.

### Vulnerability 8: Fragile Pipeline for Dovecot Version Checking
* **Severity:** Medium
* **Specific Line(s):** `functions/07_security.sh` line 177.
* **Why it is a problem:** `grep -oE` returning no matches with `set -euo pipefail` immediately exits the script, causing brittleness on unexpected Dovecot versions.

### Vulnerability 9: Hardcoded Absolute Paths for Project Files
* **Severity:** High
* **Specific Line(s):** `functions/09_admin_portal.sh` line 26, `install.sh` lines 116, 122.
* **Why it is a problem:** The script breaks if the project is run or cloned anywhere other than `/root/openmailstack/` and relies on the user's current working directory.

### Vulnerability 10: Incomplete SQL Literal Escaping (Backslash Injection)
* **Severity:** Medium
* **Specific Line(s):** `functions/01_system_db.sh` line 24.
* **Why it is a problem:** The SQL escape helper doesn't escape backslashes, allowing a malicious or accidental backslash to break the SQL statement.

---

## 2. Denied First-Pass Findings
* **None.** All 10 vulnerabilities in the initial report have been independently verified and are valid.

---

## 3. Newly Discovered Issues (2nd Pass)

### Vulnerability 11: PHP Code Injection in Admin Portal Password Hash Fallback
* **Severity:** Critical
* **Specific Line(s):** `functions/09_admin_portal.sh` line 119.
* **Why it is a problem:** If `doveadm` fails and the script falls back to PHP to generate a hash, it executes `php -r "echo password_hash('$ADMIN_PASSWORD', PASSWORD_DEFAULT);"`. An attacker entering a password with a single quote can break out of the string and execute arbitrary PHP code as root.
* **Corrected Code Block:**
```bash
ADMIN_HASH=$(ADMIN_PASSWORD="$ADMIN_PASSWORD" php -r 'echo password_hash(getenv("ADMIN_PASSWORD"), PASSWORD_DEFAULT);')
```

### Vulnerability 12: Roundcube DSN Parsing Failure & PHP Syntax Breakage
* **Severity:** High
* **Specific Line(s):** `functions/06_roundcube.sh` line 71.
* **Why it is a problem:** The Roundcube DSN expects URL-encoded credentials. If the DB password contains a single quote, it breaks PHP syntax. If it contains `@`, `:`, or `/`, it breaks DSN parsing and causes a database connection error.
* **Corrected Code Block:**
```bash
DSN=$(ROUNDCUBE_DB_USER="${ROUNDCUBE_DB_USER}" ROUNDCUBE_DB_PASSWORD="${ROUNDCUBE_DB_PASSWORD}" ROUNDCUBE_DB_NAME="${ROUNDCUBE_DB_NAME}" php -r 'echo "mysql://" . rawurlencode(getenv("ROUNDCUBE_DB_USER")) . ":" . rawurlencode(getenv("ROUNDCUBE_DB_PASSWORD")) . "@localhost/" . rawurlencode(getenv("ROUNDCUBE_DB_NAME"));')

cat <<EOF > /var/www/roundcube/config/config.inc.php
<?php
\$config = [];
\$config['db_dsnw'] = '${DSN}';
// ... rest of config
EOF
```

### Vulnerability 13: PHP Syntax Breakage in PostfixAdmin Configuration
* **Severity:** Medium
* **Specific Line(s):** `functions/02_postfixadmin.sh` lines 81-84.
* **Why it is a problem:** Similar to Vulnerability 6, database variables are directly injected into `config.local.php` via heredoc. If the database password contains a single quote (`'`), it will break the PHP string literal and cause PostfixAdmin to fail entirely.
* **Corrected Code Block:**
```bash
DB_USER_PHP=$(printf '%s' "$POSTFIXADMIN_DB_USER" | sed -e "s/'/\\\'/g")
DB_PASS_PHP=$(printf '%s' "$POSTFIXADMIN_DB_PASSWORD" | sed -e "s/'/\\\'/g")
DB_NAME_PHP=$(printf '%s' "$POSTFIXADMIN_DB_NAME" | sed -e "s/'/\\\'/g")

cat <<EOF > /var/www/postfixadmin/config.local.php
<?php
\$CONF['configured'] = true;
\$CONF['database_type'] = 'mysqli';
\$CONF['database_host'] = 'localhost';
\$CONF['database_user'] = '${DB_USER_PHP}';
\$CONF['database_password'] = '${DB_PASS_PHP}';
\$CONF['database_name'] = '${DB_NAME_PHP}';
EOF
```
