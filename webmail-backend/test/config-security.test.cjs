const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const test = require('node:test');

const backendRoot = path.resolve(__dirname, '..');

function loadConfig(overrides = {}, omitted = []) {
  const env = {
    ...process.env,
    NODE_ENV: 'production',
    OMS_DB_PASSWORD: 'unit-test-db-password',
    OMS_SESSION_SECRET: 'a'.repeat(64),
    OMS_ACCOUNT_SECURITY_KEY: 'b'.repeat(64),
    ...overrides,
  };
  for (const key of omitted) delete env[key];

  return spawnSync(process.execPath, ['-e', "require('./src/config.js')"], {
    cwd: backendRoot,
    env,
    encoding: 'utf8',
  });
}

test('production requires an explicit strong session secret', () => {
  const missing = loadConfig({}, ['OMS_SESSION_SECRET']);
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /OMS_SESSION_SECRET/);

  const weak = loadConfig({ OMS_SESSION_SECRET: 'too-short' });
  assert.notEqual(weak.status, 0);
  assert.match(weak.stderr, /OMS_SESSION_SECRET/);

  const valid = loadConfig();
  assert.equal(valid.status, 0, valid.stderr);
});

test('production requires a dedicated account-security encryption key', () => {
  const missing = loadConfig({}, ['OMS_ACCOUNT_SECURITY_KEY']);
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /OMS_ACCOUNT_SECURITY_KEY/);

  const weak = loadConfig({ OMS_ACCOUNT_SECURITY_KEY: 'too-short' });
  assert.notEqual(weak.status, 0);
  assert.match(weak.stderr, /OMS_ACCOUNT_SECURITY_KEY/);
});

test('delegated credential configuration rejects incomplete user/password pairs', () => {
  const incomplete = loadConfig({
    OMS_IMAP_MASTER_USER: 'oms-internal',
    OMS_IMAP_MASTER_PASS: '',
  });

  assert.notEqual(incomplete.status, 0);
  assert.match(incomplete.stderr, /OMS_IMAP_MASTER_USER.*OMS_IMAP_MASTER_PASS/);
});
