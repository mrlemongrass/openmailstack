# OpenMailStack 2nd Pass Remediation Actions

This log tracks the actions taken during the interactive remediation phase.

### Vulnerability 1: Destructive Upgrade Path in Admin Portal
* **Action:** Actioned
* **Resolution:** Replaced destructive directory removal and config overwrite with conditional logic in `functions/09_admin_portal.sh`.

### Vulnerability 2: Overwriting Existing Admins on Upgrade
* **Action:** Actioned
* **Resolution:** Replaced `INSERT INTO ... ON DUPLICATE KEY UPDATE` with `INSERT IGNORE INTO` in `functions/09_admin_portal.sh` to prevent overwriting existing admins.

### Vulnerability 3: Interactive Prompts Blocking Unattended Upgrades
* **Action:** Actioned
* **Resolution:** Added non-interactive and TTY checks to `functions/backup_restore.sh` to automatically skip interactive backup management during headless installs.

### Vulnerability 4: SQL Injection in Admin Portal Account Setup
* **Action:** Actioned
* **Resolution:** Added `ADMIN_USER_SQL` variable in `functions/09_admin_portal.sh` with sed sanitization for single quotes and backslashes before executing mysql commands.

### Vulnerability 5: Insecure Webroot Permissions
* **Action:** Actioned
* **Resolution:** Hardened permissions in `functions/09_admin_portal.sh` by giving ownership to `root:www-data` and restricting write access for the web server user.

### Vulnerability 6: PHP Syntax Breaking via Sed Injection
* **Action:** Actioned
* **Resolution:** Resolved implicitly with the fix for Vulnerability 1 (Added sed escaping for single quotes).

### Vulnerability 7: Fatal Crash on Package Repository Downtime
* **Action:** Actioned
* **Resolution:** Replaced `apt-get update -qq` with an interactive loop allowing users to retry, ignore, or abort upon failure, with a fallback for headless mode in `functions/00_pre_flight.sh`.

### Vulnerability 8: Fragile Pipeline for Dovecot Version Checking
* **Action:** Actioned
* **Resolution:** Added a fallback value (`2.3`) if grep fails to parse the Dovecot version in both `functions/07_security.sh` and `functions/04_dovecot.sh`.

### Vulnerability 9: Hardcoded Absolute Paths for Project Files
* **Action:** Actioned
* **Resolution:** Updated `install.sh` to use `${SCRIPT_DIR}` instead of hardcoded paths or `./` to allow execution from any directory. The `09_admin_portal.sh` script was implicitly fixed via Vulnerability 1.

### Vulnerability 10: Incomplete SQL Literal Escaping (Backslash Injection)
* **Action:** Actioned
* **Resolution:** Added backslash escaping to `escape_sql_literal` in `functions/01_system_db.sh` to prevent malformed SQL statements.

### Vulnerability 11: PHP Code Injection in Admin Portal Password Hash Fallback
* **Action:** Actioned
* **Resolution:** Modified the PHP fallback hash generation in `functions/09_admin_portal.sh` to pass the password via environment variables (`getenv()`) to prevent PHP code execution.

### Vulnerability 12: Roundcube DSN Parsing Failure & PHP Syntax Breakage
* **Action:** Actioned
* **Resolution:** Replaced the hardcoded DSN injection in `functions/06_roundcube.sh` with a securely URL-encoded PHP string using `rawurlencode()` and `getenv()`.

### Vulnerability 13: PHP Syntax Breakage in PostfixAdmin Configuration
* **Action:** Actioned
* **Resolution:** Added `sed` escaping for single quotes to DB credential variables in `functions/02_postfixadmin.sh` before injecting them into `config.local.php`.
