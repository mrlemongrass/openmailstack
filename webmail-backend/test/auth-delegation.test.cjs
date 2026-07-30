const assert = require('node:assert/strict');
const test = require('node:test');

process.env.OMS_DB_PASSWORD = 'unit-test-db-password';
process.env.OMS_SESSION_SECRET = 's'.repeat(64);
process.env.OMS_IMAP_MASTER_USER = 'oms-internal';
process.env.OMS_IMAP_MASTER_PASS = 'delegated-secret';
process.env.OMS_SMTP_MASTER_USER = 'oms-internal';
process.env.OMS_SMTP_MASTER_PASS = 'delegated-secret';
process.env.OMS_SIEVE_MASTER_USER = 'oms-internal';
process.env.OMS_SIEVE_MASTER_PASS = 'delegated-secret';

const queries = [];
const dbPath = require.resolve('../src/db.js');
require.cache[dbPath] = {
  id: dbPath,
  filename: dbPath,
  loaded: true,
  exports: {
    pool: {
      async query(sql, params = []) {
        const text = String(sql).replace(/\s+/g, ' ').trim();
        queries.push({ text, params });
        if (text.startsWith('SELECT id_hash FROM webmail_sessions')) {
          return [[{ id_hash: 'existing-session' }], []];
        }
        if (text.startsWith('SELECT username FROM mailbox_credentials')) {
          return [[{ username: 'existing@example.test' }], []];
        }
        return [[], []];
      },
    },
  },
  children: [],
  paths: [],
};

const { createSession } = require('../src/auth.js');

test('delegated sessions replace stored mailbox credentials with encrypted empty values', async () => {
  const response = { setHeader() {} };
  await createSession(response, {
    username: 'user@example.test',
    password: 'mailbox-password-must-not-persist',
    isAdmin: false,
  });

  const existingSessionUpdate = queries.find(({ text }) => (
    text.startsWith('UPDATE webmail_sessions SET password_ciphertext')
  ));
  assert.ok(existingSessionUpdate, 'existing sessions should be sanitized');
  assert.equal(existingSessionUpdate.params[0], '');

  const credentialUpdate = queries.find(({ text }) => (
    text.startsWith('UPDATE mailbox_credentials SET password_ciphertext')
  ));
  assert.ok(credentialUpdate, 'persistent mailbox credentials should be sanitized');
  assert.equal(credentialUpdate.params[0], '');

  const sessionInsert = queries.find(({ text }) => text.startsWith('INSERT INTO webmail_sessions'));
  assert.ok(sessionInsert);
  assert.equal(sessionInsert.params[2], '');

  const credentialInsert = queries.find(({ text }) => text.startsWith('INSERT INTO mailbox_credentials'));
  assert.ok(credentialInsert, 'offline indexing should retain a username registry');
  assert.equal(credentialInsert.params[1], '');
  assert.equal(
    queries.some(({ params }) => params.includes('mailbox-password-must-not-persist')),
    false,
  );
});
