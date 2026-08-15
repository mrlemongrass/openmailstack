const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const dovecot = read('functions/04_dovecot.sh');
const webmail = read('functions/10_webmail.sh');
const adminInstaller = read('functions/09_admin_portal.sh');
const auth = read('webmail-backend/src/auth.ts');
const davAuth = read('webmail-backend/src/dav-auth.ts');
const index = read('webmail-backend/src/index.ts');
const applicationStartup = read('webmail-backend/src/application-startup.ts');
const searchWorker = read('webmail-backend/src/search-worker.ts');
const config = read('webmail-backend/src/config.ts');
const accountSecurity = read('webmail-backend/src/account-security.ts');
const passwordVerification = read('webmail-backend/src/password-verification.ts');
const api = read('webmail-backend/src/api.ts');
const legacy = read('admin_portal_src/public/api.php');
const login = read('webmail-frontend/src/shared/layouts/AuthGate.tsx');
const securityUi = read('webmail-frontend/src/settings/AccountSecurityControls.tsx');

assert.match(dovecot, /DOVECOT_MASTER_SECRET_FILE=.*dovecot-master\.secret/);
assert.match(dovecot, /DOVECOT_MASTER_USERS_FILE=.*passwd\.masterusers/);
assert.match(dovecot, /openssl passwd -6 -stdin/);
assert.match(dovecot, /auth_master_user_separator = \*/);
assert.match(dovecot, /master = yes/);
assert.match(dovecot, /passdb app-passwords \{\s+driver = sql/);
assert.match(dovecot, /passdb mailbox-passwords \{\s+driver = sql/);
assert.match(dovecot, /chmod 0600 "\$\{DOVECOT_MASTER_SECRET_FILE\}"/);
assert.match(dovecot, /chown root:dovecot "\$\{DOVECOT_MASTER_USERS_FILE\}"/);
assert.match(dovecot, /chmod 0640 "\$\{DOVECOT_MASTER_USERS_FILE\}"/);

assert.match(webmail, /OMS_SESSION_SECRET/);
assert.match(webmail, /OMS_ACCOUNT_SECURITY_KEY/);
assert.match(webmail, /DOVECOT_MASTER_SECRET_FILE/);
assert.match(webmail, /write_env_line "OMS_IMAP_MASTER_USER"/);
assert.match(webmail, /write_env_line "OMS_SMTP_MASTER_USER"/);
assert.match(webmail, /write_env_line "OMS_SIEVE_MASTER_USER"/);
assert.match(adminInstaller, /existing mailbox user an Admin \(recommended; supports modern two-factor authentication\)/);
assert.match(adminInstaller, /Password must be between 12 and 128 characters/);

assert.match(auth, /sanitizeStoredMailboxCredentials/);
assert.match(auth, /delegatedAuthEnabled \? '' : data\.password/);
assert.match(davAuth, /new ImapService\(user, pass, false\)/);
assert.match(index, /\binitializeSessionStore,\s*\n/);
assert.match(applicationStartup, /await dependencies\.initializeSessionStore\(\)/);
assert.match(searchWorker, /if \(delegatedAuthEnabled\)/);
assert.match(config, /Production requires OMS_ACCOUNT_SECURITY_KEY/);

assert.match(dovecot, /CREATE TABLE IF NOT EXISTS account_security/);
assert.match(dovecot, /CREATE TABLE IF NOT EXISTS app_passwords/);
assert.match(dovecot, /ap\.secret_hash = SHA2\('%\{password\}', 256\)/);
assert.match(dovecot, /ap\.secret_hash = SHA2\('%w', 256\)/);
assert.match(dovecot, /totp_enabled_at IS NOT NULL/);
assert.match(dovecot, /'%\{master_user\}' <> ''/);
assert.match(dovecot, /INNER JOIN account_security s ON s\.username = ap\.username AND s\.totp_enabled_at IS NOT NULL/);
assert.match(dovecot, /CONCAT\('\/var\/vmail\/', maildir\) AS home, CONCAT\('\/var\/vmail\/', maildir\) AS mail_path/);

assert.match(accountSecurity, /createCipheriv\('aes-256-gcm', securityKey\(\), iv\)/);
assert.match(accountSecurity, /hashAppPassword\(password\)/);
assert.match(accountSecurity, /recoveryHashes\.splice\(matchIndex, 1\)/);
assert.match(accountSecurity, /LIMIT 1\s+FOR UPDATE/);
assert.match(passwordVerification, /spawn\('doveadm', \['pw', '-t', hash\]/);
assert.doesNotMatch(passwordVerification, /-p/);
assert.match(legacy, /hash_equals\(\$stored, \$computed\)/);
assert.doesNotMatch(legacy, /doveadm pw -t/);
assert.match(api, /apiRouter\.post\('\/account\/2fa\/setup'/);
assert.match(api, /apiRouter\.post\('\/account\/app-passwords'/);
assert.match(api, /UPDATE app_passwords SET revoked_at = NOW\(\)/);
assert.match(login, /requiresTwoFactor/);
assert.match(login, /autoComplete="one-time-code"/);
assert.match(securityUi, /They will not be shown again/);
assert.match(securityUi, /After enabling two-factor authentication, mail and sync apps must use an app password/);

console.log('[pass] Production delegated-auth, session-secret, 2FA, and app-password guards');
