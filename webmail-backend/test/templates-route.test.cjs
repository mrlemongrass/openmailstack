const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

process.env.OMS_DB_PASSWORD ||= 'unit-test-password';

const request = (port, path, { method = 'GET', body } = {}) => new Promise((resolve, reject) => {
  const raw = body == null ? '' : JSON.stringify(body);
  const req = http.request({
    hostname: '127.0.0.1',
    port,
    path,
    method,
    headers: raw ? {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(raw),
    } : {},
  }, response => {
    const chunks = [];
    response.on('data', chunk => chunks.push(chunk));
    response.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      resolve({ status: response.statusCode, json: JSON.parse(text) });
    });
  });
  req.on('error', reject);
  req.end(raw);
});

test('authenticated templates settings load and save through the user-settings route', async () => {
  const authPath = require.resolve('../src/auth.js');
  const auth = require(authPath);
  require.cache[authPath].exports = {
    ...auth,
    requireSession: (req, _res, next) => {
      req.user = { username: 'templates-route@example.test', password: 'test-only', isAdmin: false };
      next();
    },
  };

  const settingsPath = require.resolve('../src/user-settings.js');
  const userSettings = require(settingsPath);
  let stored = { templates: [] };
  userSettings.getUserSettings = async () => stored;
  userSettings.saveUserSettings = async (_username, _namespace, settings) => {
    stored = settings;
    return stored;
  };

  const originalSetInterval = global.setInterval;
  global.setInterval = () => ({ unref() {} });
  const { apiRouter } = require('../src/api.js');
  global.setInterval = originalSetInterval;

  const express = require('express');
  const app = express();
  app.use(express.json());
  app.use('/api', apiRouter);
  const server = http.createServer(app);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;

  try {
    const initial = await request(port, '/api/settings/templates');
    assert.equal(initial.status, 200);
    assert.deepEqual(initial.json.settings, { templates: [] });

    const updated = await request(port, '/api/settings/templates', {
      method: 'PUT',
      body: { settings: { templates: [{ name: 'Follow up', content: 'Checking in.' }] } },
    });
    assert.equal(updated.status, 200);
    assert.deepEqual(updated.json.settings, {
      templates: [{ name: 'Follow up', content: 'Checking in.' }],
    });
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
