const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

process.env.OMS_DB_PASSWORD ||= 'admin-updates-route-test';

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'oms-admin-updates-'));
const versionFile = path.join(tempDir, 'VERSION');
fs.writeFileSync(versionFile, '9.8.7-rc.1\n', 'utf8');
process.env.OMS_VERSION_FILE = versionFile;

const authPath = require.resolve('../src/auth.js');
const auth = require(authPath);
const authorizeAdmin = (req, _res, next) => {
  req.user = { username: 'admin-updates@example.test', isAdmin: true };
  next();
};
require.cache[authPath].exports = {
  ...auth,
  requireSession: authorizeAdmin,
  requireAdminSession: authorizeAdmin,
};

const originalSetInterval = global.setInterval;
global.setInterval = () => ({ unref() {} });
const { apiRouter } = require('../src/api.js');
global.setInterval = originalSetInterval;

const getJson = (port, requestPath) => new Promise((resolve, reject) => {
  const request = http.request({ hostname: '127.0.0.1', port, path: requestPath }, response => {
    const chunks = [];
    response.on('data', chunk => chunks.push(chunk));
    response.on('end', () => resolve({
      status: response.statusCode,
      json: JSON.parse(Buffer.concat(chunks).toString('utf8')),
    }));
  });
  request.on('error', reject);
  request.end();
});

test('Admin updates endpoint reports the packaged version and manual policy', async t => {
  const app = require('express')();
  app.use('/api', apiRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => {
    delete process.env.OMS_VERSION_FILE;
    fs.rmSync(tempDir, { recursive: true, force: true });
    await new Promise(resolve => server.close(resolve));
  });

  const installed = await getJson(server.address().port, '/api/admin/updates');
  assert.equal(installed.status, 200);
  assert.equal(installed.json.success, true);
  assert.equal(installed.json.current_version, '9.8.7-rc.1');
  assert.equal(installed.json.update_policy.mode, 'manual');
  assert.match(installed.json.update_policy.message, /manual/i);
  assert.equal(Object.hasOwn(installed.json, 'latest_version'), false);
  assert.equal(Object.hasOwn(installed.json, 'has_update'), false);

  process.env.OMS_VERSION_FILE = path.join(tempDir, 'missing-VERSION');
  const missing = await getJson(server.address().port, '/api/admin/updates');
  assert.equal(missing.status, 503);
  assert.equal(missing.json.success, false);
  assert.match(missing.json.error, /VERSION/);

  fs.writeFileSync(versionFile, 'not-a-version\n', 'utf8');
  process.env.OMS_VERSION_FILE = versionFile;
  const invalid = await getJson(server.address().port, '/api/admin/updates');
  assert.equal(invalid.status, 503);
  assert.equal(invalid.json.success, false);
  assert.match(invalid.json.error, /invalid/);

  fs.writeFileSync(versionFile, '9.8.7\n', 'utf8');
  const originalReadFileSync = fs.readFileSync;
  fs.readFileSync = (candidate, ...args) => {
    if (candidate === versionFile) {
      const error = new Error('simulated VERSION read race');
      error.code = 'ENOENT';
      throw error;
    }
    return originalReadFileSync(candidate, ...args);
  };
  try {
    const raced = await getJson(server.address().port, '/api/admin/updates');
    assert.equal(raced.status, 503);
    assert.equal(raced.json.success, false);
    assert.match(raced.json.error, /could not be read/);
  } finally {
    fs.readFileSync = originalReadFileSync;
  }
});
