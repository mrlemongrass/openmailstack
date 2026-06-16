# OpenMailStack 3rd Pass Security Audit Findings

**Date:** June 16, 2026
**Scope:** `admin_portal_src/` and `functions/09_admin_portal.sh`

During the third-pass methodical security review of the OpenMailStack Admin Portal, 3 high-severity vulnerabilities were discovered within the PHP source code of the admin panel. These vulnerabilities must be remediated prior to public release or deployment onto a live SOGo instance to prevent full system compromise.

---

### 1. Directory Traversal in Mailbox Creation (Critical)

*   **Location:** `admin_portal_src/public/api.php` line 117
*   **Description:** The API endpoint for `add_mailbox` concatenates the user-provided `$username` and `$domain` variables directly into the `$maildir` path (`$maildir = $domain . '/' . $username . '/';`) without sanitizing for directory traversal sequences (e.g., `../`).
*   **Impact:** A malicious or compromised admin could create a mailbox with a username like `../../../../etc/cron.d`, forcing Dovecot or Postfix to write files to arbitrary locations on the filesystem as the `vmail` user. This could lead to privilege escalation or quota bypass.
*   **Proposed Fix:** Strictly validate that `$username` and `$domain` contain only valid alphanumeric characters, dots, and hyphens before using them in database queries or file paths.

### 2. Missing CSRF (Cross-Site Request Forgery) Protection (High)

*   **Location:** `admin_portal_src/public/api.php`
*   **Description:** The entire backend API relies exclusively on the `PHPSESSID` cookie to authenticate state-changing requests (adding/deleting mailboxes, domains, etc.) without verifying a CSRF token.
*   **Impact:** If a logged-in administrator visits a malicious website, that website could silently execute POST requests against the `api.php` endpoint to create a rogue admin mailbox, delete all domains, or alter configurations without the administrator's knowledge.
*   **Proposed Fix:** Generate a CSRF token upon login, store it in the session, and require the frontend application to pass this token in an HTTP header for all state-changing API requests.

### 3. Stored Cross-Site Scripting (XSS) in Dashboard (High)

*   **Location:** `admin_portal_src/public/js/app.js`
*   **Description:** The frontend JavaScript dynamically constructs HTML strings using data fetched from the backend (e.g., `html += '<td>' + m.name + '</td>';`). The data is not escaped or sanitized before being injected into the DOM via `.innerHTML`.
*   **Impact:** If an attacker manages to insert an XSS payload into a user's name or a domain description (or if an admin is tricked into doing so), the payload will execute in the browser of any administrator viewing the dashboard, leading to session hijacking or unauthorized administrative actions.
*   **Proposed Fix:** Use `textContent` instead of `innerHTML` when creating table cells, or implement an HTML escaping function before interpolating variables into the template literals.

---

**Next Steps:**
I will guide you through fixing these issues interactively, logging our progress to `3rdpass_actions.md` just as before.
