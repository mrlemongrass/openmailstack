const assert = require('node:assert/strict');
const test = require('node:test');

process.env.OMS_DB_PASSWORD = 'unit-test-password';
process.env.OMS_SESSION_SECRET = 's'.repeat(64);
process.env.OMS_ACCOUNT_SECURITY_KEY = 'a'.repeat(64);

const queries = [];
const transactions = [];
let connectionQueryHandler = null;
const connection = {
  async beginTransaction() { transactions.push('begin'); },
  async query(sql, params = []) {
    const normalizedSql = String(sql).replace(/\s+/g, ' ').trim();
    queries.push({ sql: normalizedSql, params });
    if (connectionQueryHandler) return connectionQueryHandler(normalizedSql, params);
    return [{ affectedRows: 1 }, []];
  },
  async commit() { transactions.push('commit'); },
  async rollback() { transactions.push('rollback'); },
  release() { transactions.push('release'); },
};

const dbPath = require.resolve('../src/db.js');
require.cache[dbPath] = {
  id: dbPath,
  filename: dbPath,
  loaded: true,
  exports: {
    pool: {
      async query(sql, params = []) {
        queries.push({ sql: String(sql).replace(/\s+/g, ' ').trim(), params });
        return [{ affectedRows: 1 }, []];
      },
      async getConnection() {
        return connection;
      },
    },
  },
  children: [],
  paths: [],
};

const {
  beginTotpSetup,
  createAppPassword,
  disableTwoFactor,
  hashAppPassword,
  hashRecoveryCode,
  verifyAccountSecondFactor,
} = require('../src/account-security.js');

test('TOTP setup persists only encrypted secret material', async () => {
  queries.length = 0;
  const setup = await beginTotpSetup('user@example.test');
  const insert = queries.find(({ sql }) => sql.startsWith('INSERT INTO account_security'));

  assert.ok(insert);
  assert.match(setup.secret, /^[A-Z2-7]{32}$/);
  assert.equal(insert.params.includes(setup.secret), false);
  assert.equal(insert.params[0], 'user@example.test');
  assert.equal(typeof insert.params[1], 'string');
  assert.ok(Buffer.isBuffer(insert.params[2]));
  assert.ok(Buffer.isBuffer(insert.params[3]));
});

test('app-password persistence receives only the digest and display prefix', async () => {
  queries.length = 0;
  const created = await createAppPassword('user@example.test', '  MacBook   Mail  ');
  const insert = queries.find(({ sql }) => sql.startsWith('INSERT INTO app_passwords'));

  assert.ok(insert);
  assert.equal(created.label, 'MacBook Mail');
  assert.equal(insert.params.includes(created.password), false);
  assert.equal(insert.params[3], hashAppPassword(created.password));
  assert.equal(insert.params[4], created.prefix);
  assert.equal(created.last_used_at, null);
});

test('disabling two-factor authentication revokes every active app password atomically', async () => {
  queries.length = 0;
  transactions.length = 0;
  await disableTwoFactor('user@example.test');

  assert.deepEqual(transactions, ['begin', 'commit', 'release']);
  assert.ok(queries.some(({ sql, params }) => (
    sql.startsWith('UPDATE account_security')
    && params[0] === 'user@example.test'
  )));
  assert.ok(queries.some(({ sql, params }) => (
    sql.startsWith('UPDATE app_passwords SET revoked_at = NOW()')
    && params[0] === 'user@example.test'
  )));
});

test('recovery-code consumption locks and updates the account-security row atomically', async () => {
  const username = 'user@example.test';
  const recoveryCode = 'ab12-cd34-ef56';
  queries.length = 0;
  const setup = await beginTotpSetup(username);
  const encrypted = queries.find(({ sql }) => sql.startsWith('INSERT INTO account_security')).params;

  queries.length = 0;
  transactions.length = 0;
  connectionQueryHandler = async sql => {
    if (sql.startsWith('SELECT totp_secret_ciphertext')) {
      return [[{
        totp_secret_ciphertext: encrypted[1],
        totp_secret_iv: encrypted[2],
        totp_secret_tag: encrypted[3],
        recovery_code_hashes: JSON.stringify([hashRecoveryCode(recoveryCode)]),
      }], []];
    }
    return [{ affectedRows: 1 }, []];
  };

  try {
    assert.equal(await verifyAccountSecondFactor(username, recoveryCode), true);
  } finally {
    connectionQueryHandler = null;
  }

  assert.deepEqual(transactions, ['begin', 'commit', 'release']);
  assert.ok(queries.some(({ sql }) => sql.includes('FOR UPDATE')));
  assert.ok(queries.some(({ sql, params }) => (
    sql.startsWith('UPDATE account_security SET recovery_code_hashes')
    && params[0] === '[]'
    && params[1] === username
  )));
  assert.notEqual(setup.secret, recoveryCode);
});
