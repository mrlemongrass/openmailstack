const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const test = require('node:test');

process.env.OMS_DB_PASSWORD ||= 'account-session-route-test';
process.env.OMS_SESSION_SECRET ||= 's'.repeat(64);
process.env.OMS_ACCOUNT_SECURITY_KEY ||= 'a'.repeat(64);
process.env.OMS_IMAP_MASTER_USER ||= 'session-test-master';
process.env.OMS_IMAP_MASTER_PASS ||= 'session-test-password';
process.env.OMS_SMTP_MASTER_USER ||= 'session-test-master';
process.env.OMS_SMTP_MASTER_PASS ||= 'session-test-password';
process.env.OMS_SIEVE_MASTER_USER ||= 'session-test-master';
process.env.OMS_SIEVE_MASTER_PASS ||= 'session-test-password';

const username = 'sessions@example.test';
const currentSessionId = 'current-session-token';
const currentSessionHash = crypto.createHash('sha256').update(currentSessionId).digest('hex');
const otherSessionHash = crypto.createHash('sha256').update('other-session-token').digest('hex');
const sessionRows = [
  {
    id_hash: currentSessionHash,
    created_at: new Date('2026-08-22T12:00:00Z'),
    updated_at: new Date('2026-08-22T12:30:00Z'),
  },
  {
    id_hash: otherSessionHash,
    created_at: new Date('2026-08-21T12:00:00Z'),
    updated_at: new Date('2026-08-21T12:30:00Z'),
  },
];

const deleteCalls = [];
const connection = {
  async query(sql, params = []) {
    const normalizedSql = String(sql).replace(/\s+/g, ' ').trim();
    if (normalizedSql.startsWith('SELECT id_hash, created_at, updated_at FROM webmail_sessions')) {
      return [sessionRows, []];
    }
    if (normalizedSql.startsWith('DELETE FROM webmail_sessions WHERE id_hash LIKE')) {
      deleteCalls.push(params);
      return [{ affectedRows: 1 }, []];
    }
    throw new Error(`Unexpected account-session query: ${normalizedSql}`);
  },
  release() {},
};

const db = require('../src/db.js');
db.pool.getConnection = async () => connection;
db.pool.query = async (sql, params = []) => {
  const normalizedSql = String(sql).replace(/\s+/g, ' ').trim();
  if (normalizedSql.startsWith('CREATE TABLE IF NOT EXISTS')) {
    return [{}, []];
  }
  if (normalizedSql.startsWith('SELECT id_hash FROM webmail_sessions WHERE password_ciphertext')) {
    return [[], []];
  }
  if (normalizedSql.startsWith('SELECT username FROM mailbox_credentials WHERE password_ciphertext')) {
    return [[], []];
  }
  if (normalizedSql.includes('FROM webmail_sessions s') && normalizedSql.includes('WHERE s.id_hash = ?')) {
    if (params[0] !== currentSessionHash) return [[], []];
    return [[{
      username,
      password_ciphertext: '',
      password_iv: Buffer.alloc(12),
      password_tag: Buffer.alloc(16),
      is_admin: 0,
      expires_at: new Date('2026-08-23T12:00:00Z'),
      superadmin: 0,
    }], []];
  }
  if (normalizedSql.startsWith('UPDATE webmail_sessions SET expires_at')) {
    return [{ affectedRows: 1 }, []];
  }
  throw new Error(`Unexpected auth query: ${normalizedSql}`);
};

let confirmTotpArgs = null;
const accountSecurityPath = require.resolve('../src/account-security.js');
const accountSecurity = require(accountSecurityPath);
require.cache[accountSecurityPath].exports = {
  ...accountSecurity,
  confirmTotpSetup: async (...args) => {
    confirmTotpArgs = args;
    return ['recovery-code'];
  },
};

const originalSetInterval = global.setInterval;
global.setInterval = () => ({ unref() {} });
const { apiRouter } = require('../src/api.js');
global.setInterval = originalSetInterval;

const requestJson = (port, method, requestPath, body) => new Promise((resolve, reject) => {
  const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
  const request = http.request({
    hostname: '127.0.0.1',
    port,
    path: requestPath,
    method,
    headers: {
      Cookie: `oms_session=${encodeURIComponent(currentSessionId)}`,
      ...(payload ? {
        'Content-Type': 'application/json',
        'Content-Length': payload.length,
      } : {}),
    },
  }, response => {
    const chunks = [];
    response.on('data', chunk => chunks.push(chunk));
    response.on('end', () => resolve({
      status: response.statusCode,
      json: JSON.parse(Buffer.concat(chunks).toString('utf8')),
    }));
  });
  request.on('error', reject);
  request.end(payload || undefined);
});

async function withServer(t) {
  const express = require('express');
  const app = express();
  app.use(express.json());
  app.use('/api', apiRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return server.address().port;
}

test('session listing marks the authenticated request session as current', async t => {
  const port = await withServer(t);

  const response = await requestJson(port, 'GET', '/api/account/sessions');

  assert.equal(response.status, 200);
  assert.equal(response.json.success, true);
  assert.deepEqual(
    response.json.sessions.map(session => Object.keys(session).sort()),
    sessionRows.map(() => ['created_at', 'id', 'isCurrent', 'updated_at']),
  );
  assert.equal(JSON.stringify(response.json).includes(currentSessionId), false);
  assert.deepEqual(
    response.json.sessions.map(session => ({ id: session.id, isCurrent: session.isCurrent })),
    [
      { id: currentSessionHash.substring(0, 8), isCurrent: true },
      { id: otherSessionHash.substring(0, 8), isCurrent: false },
    ],
  );
});

test('session revocation rejects the authenticated request session', async t => {
  deleteCalls.length = 0;
  const port = await withServer(t);

  const response = await requestJson(
    port,
    'DELETE',
    `/api/account/sessions/${currentSessionHash.substring(0, 8)}`,
  );

  assert.equal(response.status, 400);
  assert.deepEqual(response.json, {
    success: false,
    error: 'Cannot revoke your current session.',
  });
  assert.deepEqual(deleteCalls, []);

  const authResponse = await requestJson(port, 'GET', '/api/auth/me');
  assert.equal(authResponse.status, 200);
  assert.deepEqual(authResponse.json, {
    success: true,
    user: { username, isAdmin: false },
  });
});

test('session revocation still removes another session owned by the user', async t => {
  deleteCalls.length = 0;
  const port = await withServer(t);
  const otherPrefix = otherSessionHash.substring(0, 8);

  const response = await requestJson(port, 'DELETE', `/api/account/sessions/${otherPrefix}`);

  assert.equal(response.status, 200);
  assert.deepEqual(response.json, { success: true, revoked: 1 });
  assert.deepEqual(deleteCalls, [[`${otherPrefix}%`, username]]);
});

test('session revocation rejects malformed selectors before querying the database', async t => {
  deleteCalls.length = 0;
  const port = await withServer(t);

  for (const selector of ['%', '_', 'abc1234', 'abc123456', 'not-hex!']) {
    const response = await requestJson(
      port,
      'DELETE',
      `/api/account/sessions/${encodeURIComponent(selector)}`,
    );

    assert.equal(response.status, 400, selector);
    assert.deepEqual(response.json, {
      success: false,
      error: 'Invalid session identifier.',
    });
  }
  assert.deepEqual(deleteCalls, []);
});

test('two-factor confirmation retains the authenticated request session', async t => {
  confirmTotpArgs = null;
  const port = await withServer(t);

  const response = await requestJson(port, 'POST', '/api/account/2fa/confirm', { code: '123456' });

  assert.equal(response.status, 200);
  assert.deepEqual(response.json, { success: true, recoveryCodes: ['recovery-code'] });
  assert.deepEqual(confirmTotpArgs, [username, '123456', currentSessionHash]);
});
