const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');
const path = require('node:path');
const test = require('node:test');

process.env.OMS_DB_PASSWORD ||= 'notes-api-contract-test';
process.env.OMS_SESSION_SECRET ||= 'notes-api-contract-session-secret-long-enough';

const sourceDir = path.join(__dirname, '..', 'src');
const owner = 'notes-api@example.test';
const db = require(path.join(sourceDir, 'db.js'));
const originalQuery = db.pool.query;
let noteState;
let writeCount = 0;
let syncCount = 0;

function resetNote() {
  noteState = {
    id: 'existing-note',
    owner,
    title: 'Current title',
    content: '<p>Current body</p>',
    color: '#ffffff',
    is_pinned: 0,
    is_locked: 0,
    folder: 'notes',
    labels_json: '[]',
    sync_token: 8,
    imap_sync_token: 8,
    imap_uid: 42,
    imap_msgid: '<existing-note@example.test>',
    is_deleted: 0,
    created_at: '2026-08-15T00:00:00.000Z',
    updated_at: '2026-08-15T00:00:00.000Z',
  };
  writeCount = 0;
  syncCount = 0;
}

resetNote();
db.pool.query = async (sql, params = []) => {
  const compact = String(sql).replace(/\s+/g, ' ').trim();
  if (compact.startsWith('SELECT * FROM notes WHERE id = ?')) {
    const matches = noteState
      && noteState.id === params[0]
      && noteState.owner === params[1]
      && noteState.is_deleted === 0;
    return [matches ? [{ ...noteState }] : [], []];
  }
  if (compact.startsWith('UPDATE notes SET title = ?')) {
    const expectedToken = compact.includes('AND sync_token = ?')
      ? Number(params[params.length - 1])
      : null;
    if (!noteState || (expectedToken !== null && noteState.sync_token !== expectedToken)) {
      return [{ affectedRows: 0 }, []];
    }
    noteState = {
      ...noteState,
      title: params[0],
      content: params[1],
      color: params[2],
      is_pinned: params[3],
      is_locked: params[4],
      folder: params[5],
      labels_json: params[6],
      sync_token: noteState.sync_token + 1,
    };
    writeCount += 1;
    return [{ affectedRows: 1 }, []];
  }
  throw new Error(`Unexpected Notes API query: ${compact}`);
};

const authPath = require.resolve(path.join(sourceDir, 'auth.js'));
const auth = require(authPath);
require.cache[authPath].exports = {
  ...auth,
  requireSession: (req, _res, next) => {
    req.user = { username: owner, password: 'test-only', sessionId: 'notes-api-session', isAdmin: false };
    next();
  },
};

const notesSyncPath = require.resolve(path.join(sourceDir, 'notes-imap-sync.js'));
require.cache[notesSyncPath] = {
  id: notesSyncPath,
  filename: notesSyncPath,
  loaded: true,
  exports: { syncNotesWithImap: async () => { syncCount += 1; } },
};

const indexPath = require.resolve(path.join(sourceDir, 'index.js'));
require.cache[indexPath] = {
  id: indexPath,
  filename: indexPath,
  loaded: true,
  exports: { io: { to: () => ({ emit: () => {} }) } },
};

const originalSetInterval = global.setInterval;
global.setInterval = () => ({ unref() {} });
const { apiRouter } = require(path.join(sourceDir, 'api.js'));
const { appsApiRouter } = require(path.join(sourceDir, 'apps-api.js'));
global.setInterval = originalSetInterval;

test.after(() => {
  db.pool.query = originalQuery;
});

function requestJson(server, method, requestPath, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const request = http.request({
      hostname: '127.0.0.1',
      port: server.address().port,
      path: requestPath,
      method,
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
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
    request.end(payload);
  });
}

async function withNotesServer(run) {
  const app = express();
  app.use(express.json({ limit: '20mb' }));
  app.use('/api', apiRouter);
  app.use('/api/apps', appsApiRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    return await run(server);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

test('both Notes update APIs require the current revision and report conflicts identically', async () => {
  resetNote();
  const missingRevision = await withNotesServer(async server => Promise.all([
    requestJson(server, 'PUT', '/api/notes/existing-note', { title: 'Edit' }),
    requestJson(server, 'PUT', '/api/apps/notes/existing-note', { title: 'Edit' }),
  ]));
  for (const response of missingRevision) {
    assert.equal(response.status, 428);
    assert.deepEqual(response.json, {
      success: false,
      error: 'The current note revision is required.',
    });
  }
  assert.equal(writeCount, 0);
  assert.equal(syncCount, 0);

  const staleBody = {
    title: 'Stale edit',
    content: '<p>Stale</p>',
    color: '#ffffff',
    is_pinned: 0,
    is_locked: 0,
    folder: 'notes',
    labels_json: '[]',
    expected_sync_token: 7,
  };
  const conflicts = await withNotesServer(async server => Promise.all([
    requestJson(server, 'PUT', '/api/notes/existing-note', staleBody),
    requestJson(server, 'PUT', '/api/apps/notes/existing-note', staleBody),
  ]));
  for (const response of conflicts) {
    assert.equal(response.status, 409);
    assert.equal(response.json.success, false);
    assert.match(response.json.error, /changed in another session/i);
  }
  assert.equal(writeCount, 0);
  assert.equal(syncCount, 0);
});

test('both Notes APIs return stable bounded validation errors without writes or sync', async () => {
  resetNote();
  const overLimitTitle = `${'🚀'.repeat(1024)}a`;
  const updateBody = {
    title: overLimitTitle,
    content: '<p>Unchanged</p>',
    labels_json: '[]',
    expected_sync_token: 8,
  };
  const tooLarge = await withNotesServer(async server => Promise.all([
    requestJson(server, 'PUT', '/api/notes/existing-note', updateBody),
    requestJson(server, 'PUT', '/api/apps/notes/existing-note', updateBody),
  ]));
  for (const response of tooLarge) {
    assert.equal(response.status, 413);
    assert.deepEqual(response.json, {
      success: false,
      error: 'title exceeds the 4096-byte UTF-8 limit',
      code: 'NOTE_FIELD_TOO_LARGE',
      field: 'title',
      limit_bytes: 4096,
    });
  }

  const invalid = await withNotesServer(async server => Promise.all([
    requestJson(server, 'POST', '/api/notes', { labels_json: [] }),
    requestJson(server, 'POST', '/api/apps/notes', { labels_json: [] }),
  ]));
  for (const response of invalid) {
    assert.equal(response.status, 400);
    assert.deepEqual(response.json, {
      success: false,
      error: 'labels_json must be a JSON string',
      code: 'NOTE_FIELD_INVALID',
      field: 'labels_json',
    });
  }
  assert.equal(writeCount, 0);
  assert.equal(syncCount, 0);
});
