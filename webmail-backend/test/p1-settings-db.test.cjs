const test = require('node:test');
const assert = require('node:assert/strict');

test('Settings HTTP writes survive fresh database reads and remain owner scoped', { skip: process.env.OMS_P1_DB_TEST !== '1' }, async t => {
  assert.match(process.env.OMS_DB_NAME || '', /^oms_p1_[a-f0-9]+$/, 'Use the disposable P1 database only');
  const { pool } = require('../src/db.js');
  t.after(() => pool.end());
  let username = 'p1-settings@example.test';
  const file = require.resolve('../src/auth.js');
  require(file);
  require.cache[file].exports = { ...require.cache[file].exports, requireSession(req, _res, next) { req.user = { username, password: 'fixture-only' }; next(); } };
  const originalInterval = global.setInterval;
  global.setInterval = () => ({ unref() {} });
  const { apiRouter } = require('../src/api.js');
  global.setInterval = originalInterval;
  const express = require('express');
  const app = express(); app.use(express.json()); app.use('/api', apiRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const endpoint = `http://127.0.0.1:${server.address().port}/api/settings/`;
  const { settingsDefaults } = require('../src/user-settings.js');
  for (const pane of ['right', 'bottom', 'off']) {
    const settings = structuredClone(settingsDefaults.mail);
    settings.reading = { ...settings.reading, previewPane: pane, threaded: true, density: 'compact', snippets: false, markReadDelaySeconds: 3, externalImages: 'trusted' };
    settings.compose.defaultMode = 'html';
    const response = await fetch(endpoint + 'mail', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ settings }) });
    assert.equal(response.status, 200);
    const saved = (await response.json()).settings;
    assert.equal(saved.reading.previewPane, pane);
    const read = await fetch(endpoint + 'mail');
    assert.deepEqual((await read.json()).settings, saved);
  }
  username = 'p1-other@example.test';
  const other = await fetch(endpoint + 'mail');
  assert.equal((await other.json()).settings.compose.defaultMode, settingsDefaults.mail.compose.defaultMode);
  assert.equal((await fetch(endpoint + 'unknown', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 404);
});
