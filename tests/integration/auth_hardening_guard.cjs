const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '../..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const dovecot = read('functions/04_dovecot.sh');
const webmail = read('functions/10_webmail.sh');
const auth = read('webmail-backend/src/auth.ts');
const davAuth = read('webmail-backend/src/dav-auth.ts');
const index = read('webmail-backend/src/index.ts');
const searchWorker = read('webmail-backend/src/search-worker.ts');

assert.match(dovecot, /DOVECOT_MASTER_SECRET_FILE=.*dovecot-master\.secret/);
assert.match(dovecot, /DOVECOT_MASTER_USERS_FILE=.*passwd\.masterusers/);
assert.match(dovecot, /openssl passwd -6 -stdin/);
assert.match(dovecot, /auth_master_user_separator = \*/);
assert.match(dovecot, /master = yes/);
assert.match(dovecot, /chmod 0600 "\$\{DOVECOT_MASTER_SECRET_FILE\}"/);
assert.match(dovecot, /chown root:dovecot "\$\{DOVECOT_MASTER_USERS_FILE\}"/);
assert.match(dovecot, /chmod 0640 "\$\{DOVECOT_MASTER_USERS_FILE\}"/);

assert.match(webmail, /OMS_SESSION_SECRET/);
assert.match(webmail, /DOVECOT_MASTER_SECRET_FILE/);
assert.match(webmail, /write_env_line "OMS_IMAP_MASTER_USER"/);
assert.match(webmail, /write_env_line "OMS_SMTP_MASTER_USER"/);
assert.match(webmail, /write_env_line "OMS_SIEVE_MASTER_USER"/);

assert.match(auth, /sanitizeStoredMailboxCredentials/);
assert.match(auth, /delegatedAuthEnabled \? '' : data\.password/);
assert.match(davAuth, /new ImapService\(user, pass, false\)/);
assert.match(index, /initializeSessionStore\(\)/);
assert.match(searchWorker, /if \(delegatedAuthEnabled\)/);

console.log('[pass] Production delegated-auth and session-secret guards');
