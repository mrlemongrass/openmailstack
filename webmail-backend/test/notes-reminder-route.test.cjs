const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');
const test = require('node:test');

process.env.OMS_DB_PASSWORD ||= 'notes-reminder-route-test';

const owner = 'notes-reminder@example.test';
const reminderLookups = [];

const authPath = require.resolve('../src/auth.js');
const auth = require(authPath);
require.cache[authPath].exports = {
  ...auth,
  requireSession: (req, _res, next) => {
    req.user = { username: owner, password: 'test-only', isAdmin: false };
    next();
  },
};

const notesUtils = require('../src/notes-utils.js');
notesUtils.getNoteReminder = async (noteId, username) => {
  reminderLookups.push({ noteId, username });
  return null;
};

const indexPath = require.resolve('../src/index.js');
require.cache[indexPath] = {
  id: indexPath,
  filename: indexPath,
  loaded: true,
  exports: { io: { to: () => ({ emit: () => {} }) } },
  children: [],
  paths: [],
};

const originalSetInterval = global.setInterval;
global.setInterval = () => ({ unref() {} });
const { apiRouter } = require('../src/api.js');
const { appsApiRouter } = require('../src/apps-api.js');
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

test('both Notes APIs return a successful empty result when an owned note has no reminder', async t => {
  reminderLookups.length = 0;
  const app = express();
  app.use('/api/apps', appsApiRouter);
  app.use('/api', apiRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const port = server.address().port;
  for (const requestPath of [
    '/api/notes/owned-note/reminder',
    '/api/apps/notes/owned-note/reminder',
  ]) {
    const response = await getJson(port, requestPath);
    assert.equal(response.status, 200);
    assert.deepEqual(response.json, { success: true, reminder: null });
  }
  assert.deepEqual(reminderLookups, [
    { noteId: 'owned-note', username: owner },
    { noteId: 'owned-note', username: owner },
  ]);
});
