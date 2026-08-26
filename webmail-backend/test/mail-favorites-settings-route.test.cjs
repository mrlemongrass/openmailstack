const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');

process.env.OMS_DB_PASSWORD ||= 'mail-favorites-route-test';

const request = (port, body) => new Promise((resolve, reject) => {
  const raw = JSON.stringify(body);
  const req = http.request({
    hostname: '127.0.0.1',
    port,
    path: '/api/settings/mail/favorites',
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(raw),
    },
  }, response => {
    const chunks = [];
    response.on('data', chunk => chunks.push(chunk));
    response.on('end', () => {
      resolve({
        status: response.statusCode,
        json: JSON.parse(Buffer.concat(chunks).toString('utf8')),
      });
    });
  });
  req.on('error', reject);
  req.end(raw);
});

test('authenticated mail Favorites use the scoped settings merge route', async () => {
  const authPath = require.resolve('../src/auth.js');
  const auth = require(authPath);
  require.cache[authPath].exports = {
    ...auth,
    requireSession: (req, _res, next) => {
      req.user = { username: 'favorites-route@example.test', password: 'test-only', isAdmin: false };
      next();
    },
  };

  const settingsPath = require.resolve('../src/user-settings.js');
  const userSettings = require(settingsPath);
  const calls = [];
  userSettings.saveMailFavoriteSettings = async (username, folders) => {
    calls.push({ username, folders });
    return {
      signatures: [],
      identity: { defaultFrom: '', replyTo: '', alwaysBccSelf: false },
      compose: { defaultMode: 'rich', defaultFont: 'system', attachmentReminder: true, undoSendSeconds: 10 },
      reading: {
        threaded: false,
        density: 'cozy',
        previewPane: 'right',
        snippets: true,
        externalImages: 'ask',
        markReadDelaySeconds: 1,
      },
      spam: { blockedSenders: [], safeSenders: [] },
      folders,
    };
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
    const folders = {
      favorites: ['Projects'],
      favoriteUidValidities: { Projects: '101' },
    };
    const response = await request(port, { folders });

    assert.equal(response.status, 200);
    assert.deepEqual(response.json.settings.folders, folders);
    assert.deepEqual(calls, [{ username: 'favorites-route@example.test', folders }]);

    const invalid = await request(port, {});
    assert.equal(invalid.status, 400);
    assert.equal(invalid.json.error, 'Favorite folder settings are required');
    assert.equal(calls.length, 1);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
