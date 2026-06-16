# LLM Security Training Cases: OpenMailStack Vulnerability Dataset

This document is a consolidated dataset of all security vulnerabilities, architectural flaws, and resilience bugs discovered and patched across the 3 audit passes of the OpenMailStack codebase. It is formatted specifically to help train Large Language Models (LLMs) on secure coding practices, vulnerability identification, and remediation strategies in Bash and PHP applications.

---

## 1. Destructive Upgrade Path (Idempotency Failure)
* **Component:** `functions/09_admin_portal.sh`
* **Vulnerability:** Re-running the installation script indiscriminately executed `rm -rf /var/www/openmailstack-admin`, destroying existing UI configurations, data, and user-modified configurations (like `config.php`).
* **Resolution:** Removed the destructive `rm -rf` command. Added conditional logic (`if [[ ! -f /var/www/openmailstack-admin/config.php ]]`) to strictly check for an existing `config.php` file before overwriting it, preserving existing installations.

## 2. Overwriting Existing Database Records on Upgrade
* **Component:** `functions/09_admin_portal.sh`
* **Vulnerability:** Using `INSERT INTO ... ON DUPLICATE KEY UPDATE password=...` for database seeding. If the script was re-run, it would silently reset an existing administrator's password back to the script's default or prompted password without warning.
* **Resolution:** Replaced the UPSERT logic with `INSERT IGNORE INTO admin ...`. This safely skips the insertion if the administrator account already exists, preventing destructive overwrites.

## 3. Interactive Prompts Blocking Unattended Deployments
* **Component:** `functions/backup_restore.sh`
* **Vulnerability:** The script dropped into an interactive `read -p` prompt if it found old backups during an upgrade. If provisioned via headless infrastructure (Ansible, cloud-init), the process would hang indefinitely waiting for user input.
* **Resolution:** Added headless detection checks (`if [[ ! -t 0 || "${DEBIAN_FRONTEND:-}" == "noninteractive" ]]`) to automatically skip interactive blocks and return safely when running in non-interactive environments.

## 4. SQL Injection in Bash MySQL Execution
* **Component:** `functions/09_admin_portal.sh`
* **Vulnerability:** Unsanitized user inputs (`$ADMIN_USER`) read from the CLI were directly concatenated into `mysql -e "SELECT ... username='$ADMIN_USER'"` statements, allowing arbitrary SQL execution via quote escaping.
* **Resolution:** Implemented a sanitization variable (`ADMIN_USER_SQL`) that strictly escapes backslashes and single quotes using `sed -e 's/\\/\\\\/g' -e "s/'/''/g"` before the variable is used in the MySQL execution string.

## 5. Insecure Webroot Permissions (Overly Permissive)
* **Component:** `functions/09_admin_portal.sh`
* **Vulnerability:** Handing full read/write ownership of the web root to the web server (`chown -R www-data:www-data /var/www/...`). If an attacker found an upload or RCE flaw in the PHP code, they could overwrite source code and config files to establish persistence.
* **Resolution:** Hardened permissions by giving ownership to `root:www-data` and explicitly restricting write access for the web server user. Web directories are `chmod 750` and files are `chmod 640`.

## 6. PHP Syntax Breakage via Unescaped Sed Injection
* **Component:** `functions/09_admin_portal.sh`
* **Vulnerability:** Using `sed` to inject bash variables into a PHP file template. If a password contained a single quote (`'`), `sed` would inject it raw, resulting in `define('DB_PASS', 'my'pass');`, which instantly throws a PHP syntax error and crashes the application.
* **Resolution:** Escaped single quotes with `sed` before using the variable in the templating replacement (`sed -e "s/'/\\\'/g"`), ensuring the resulting PHP string literal remains intact.

## 7. Fatal Crash on Package Repository Downtime
* **Component:** `functions/00_pre_flight.sh`
* **Vulnerability:** Running `apt-get update -qq` under Bash `set -e` without a fallback handler. A transient network failure or upstream repository 500 error would violently crash the entire installation script.
* **Resolution:** Wrapped the command in a `while true` loop with an `if apt-get update -qq; then break; fi` check. Provided interactive retry/ignore options for users, and a safe abort for headless executions.

## 8. Fragile Pipeline Commands with Pipefail
* **Component:** `functions/07_security.sh` & `functions/04_dovecot.sh`
* **Vulnerability:** Executing `dovecot --version | grep -oE '^[0-9]+\.[0-9]+'` under `set -euo pipefail`. If the `grep` command failed to find a match, it returned exit code `1`, causing `pipefail` to immediately crash the parent script.
* **Resolution:** Suppressed stderr, added an `|| echo "unknown"` fallback to the pipeline, and implemented conditional logic to gracefully default to a safe value (`2.3`) if parsing failed.

## 9. Hardcoded Absolute Paths and Relative Execution Assumptions
* **Component:** `install.sh` & `functions/09_admin_portal.sh`
* **Vulnerability:** The script broke if the project was cloned anywhere other than `/root/openmailstack/` due to hardcoded paths, and relied on `./config.conf`, meaning it failed if executed from outside its directory.
* **Resolution:** Replaced all hardcoded and relative paths with absolute dynamic paths derived from the script's location using `SCRIPT_DIR=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)`.

## 10. Incomplete SQL Literal Escaping (Backslash Injection)
* **Component:** `functions/01_system_db.sh`
* **Vulnerability:** A custom SQL escape helper only escaped single quotes (`sed "s/'/''/g"`). MariaDB processes backslash escapes by default, so a password ending in a backslash would escape the closing SQL quote (e.g., `'password\'`), causing a syntax error.
* **Resolution:** Updated the helper function to explicitly escape backslashes first (`sed -e 's/\\/\\\\/g' -e "s/'/''/g"`).

## 11. PHP Code Injection via Shell Environment Fallback
* **Component:** `functions/09_admin_portal.sh`
* **Vulnerability:** Falling back to PHP to generate a password hash via `php -r "echo password_hash('$ADMIN_PASSWORD', PASSWORD_DEFAULT);"`. An attacker providing a password with a single quote could break out of the string context and execute arbitrary PHP code as `root`.
* **Resolution:** Removed the bash string interpolation entirely. Passed the password securely via environment variables and retrieved it safely inside the PHP context using `getenv()`: `ADMIN_PASSWORD="$ADMIN_PASSWORD" php -r 'echo password_hash(getenv("ADMIN_PASSWORD"), PASSWORD_DEFAULT);'`.

## 12. DSN Parsing Failure and URL Encoding Neglect
* **Component:** `functions/06_roundcube.sh`
* **Vulnerability:** Hardcoding database variables directly into a PHP DSN string: `'mysql://${USER}:${PASSWORD}@localhost'`. If the password contained `@`, `:`, or `/`, it broke the DSN URI parsing schema resulting in connection failures.
* **Resolution:** Replaced the hardcoded bash injection with a securely URL-encoded string computed natively in PHP using `rawurlencode(getenv('VAR'))` before inserting it into the configuration file.

## 13. PHP Syntax Breakage in Heredoc Configuration
* **Component:** `functions/02_postfixadmin.sh`
* **Vulnerability:** Similar to Vulnerability 6, database variables were injected directly into a PHP configuration file via a Bash heredoc (`EOF`). Unescaped single quotes in the passwords broke the PHP array assignments.
* **Resolution:** Sanitized the bash variables with `sed` to escape single quotes (`DB_PASS_PHP=$(printf '%s' "$DB_PASS" | sed -e "s/'/\\\'/g")`) prior to injecting them in the heredoc block.

## 14. Directory Traversal in Backend API
* **Component:** `admin_portal_src/public/api.php`
* **Vulnerability:** The API endpoint for mailbox creation concatenated user-provided `$username` and `$domain` variables directly into file paths (e.g., `$maildir = $domain . '/' . $username . '/';`) without sanitization. An attacker could input `../../` to escape the mail directory.
* **Resolution:** Enforced strict regular expression validation (`preg_match('/^[a-zA-Z0-9_.-]+$/', $var)`) on all incoming `$username` and `$domain` parameters across all API endpoints to guarantee they only contain safe characters before they touch the database or filesystem.

## 15. Missing CSRF (Cross-Site Request Forgery) Protection
* **Component:** `admin_portal_src/public/api.php` & `admin_portal_src/public/js/app.js`
* **Vulnerability:** The backend API relied solely on the `PHPSESSID` cookie to authenticate state-changing requests (like deleting domains) without verifying a CSRF token. A malicious website could trick a logged-in admin into unwittingly executing destructive POST requests.
* **Resolution:** Implemented full CSRF protection. The backend generates a secure token using `random_bytes(32)` upon login. The frontend extracts this token from a meta tag and attaches it to the `X-CSRF-Token` header of all subsequent API fetch requests. The API rejects any state-changing request missing the correct token.

## 16. Stored Cross-Site Scripting (XSS) in Dynamic Dashboard
* **Component:** `admin_portal_src/public/js/app.js`
* **Vulnerability:** The frontend JavaScript dynamically constructed HTML tables by directly interpolating unescaped backend data (like user names and aliases) into string literals assigned to `innerHTML`. This allowed executing arbitrary Javascript if malicious input was present.
* **Resolution:** Authored an `escapeHTML()` helper function in the JavaScript logic to safely convert characters like `<`, `>`, `&`, `'`, and `"` to their respective HTML entities, and strictly applied it to all variable interpolations before DOM rendering.
