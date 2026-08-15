const assert = require('node:assert/strict');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const test = require('node:test');
const WebSocket = require('ws');
const { Server: SocketIOServer } = require('socket.io');

process.env.OMS_DB_PASSWORD = process.env.OMS_DB_PASSWORD || 'test-password';

const indexModulePath = require.resolve('../src/index');
require.cache[indexModulePath] = {
  id: indexModulePath,
  filename: indexModulePath,
  loaded: true,
  exports: { io: { to: () => ({ emit: () => {} }) } },
};

const {
  authorizeNoteCollaboration,
  installNotesSignalingServer,
  issueNoteCollaborationCapability,
  verifyNoteCollaborationCapability,
} = require('../src/notes-collaboration');
const { pool } = require('../src/db');
const {
  NoteConflictError,
  deleteNoteIfRevisionMatches,
  saveNote,
} = require('../src/notes-utils');

const SECRET = 'notes-collaboration-test-secret-that-is-long-enough';

const listen = (server) => new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => resolve(server.address()));
});

const openSocket = (url, cookie = 'oms_session=valid', origin) => new Promise((resolve, reject) => {
  const headers = { Cookie: cookie };
  if (origin !== undefined) headers.Origin = origin;
  const socket = new WebSocket(url, { headers });
  socket.once('open', () => resolve(socket));
  socket.once('unexpected-response', (_request, response) => {
    response.resume();
    reject(new Error(`Unexpected response: ${response.statusCode}`));
  });
  socket.once('error', reject);
});

const waitForMessage = (socket) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('Timed out waiting for signaling message')), 1000);
  socket.once('message', (data) => {
    clearTimeout(timer);
    resolve(JSON.parse(data.toString()));
  });
});

const waitForClose = (socket) => new Promise((resolve) => {
  socket.once('close', (code) => resolve(code));
});

test('identical saves are no-ops while stale divergent saves are rejected', async (t) => {
  const existing = {
    id: 'owned-note',
    owner: 'owner@example.test',
    title: 'Quarterly plan',
    content: '<p>Shared content</p>',
    color: '#ffffff',
    is_pinned: 0,
    is_locked: 0,
    folder: 'notes',
    labels_json: '[]',
    sync_token: 8,
    is_deleted: 0,
  };
  const originalQuery = pool.query;
  let writes = 0;
  pool.query = async (sql) => {
    if (String(sql).startsWith('SELECT * FROM notes')) return [[existing], []];
    writes += 1;
    return [{ affectedRows: 1 }, []];
  };
  t.after(() => { pool.query = originalQuery; });

  const unchanged = await saveNote({
    ...existing,
    owner: existing.owner,
    expected_sync_token: 8,
  });
  assert.equal(unchanged.sync_token, 8);
  assert.equal(writes, 0, 'a current identical save should not create another revision');

  const converged = await saveNote({
    ...existing,
    owner: existing.owner,
    expected_sync_token: 7,
  });
  assert.equal(converged.sync_token, 8);
  assert.equal(writes, 0, 'an identical converged save should not create another revision');

  await assert.rejects(
    saveNote({
      ...existing,
      owner: existing.owner,
      content: '<p>Divergent stale content</p>',
      expected_sync_token: 7,
    }),
    (error) => error instanceof NoteConflictError,
  );
  assert.equal(writes, 0, 'a stale divergent save must not overwrite the current note');
});

test('concurrent divergent saves allow one atomic revision winner', async (t) => {
  let state = {
    id: 'atomic-note',
    owner: 'owner@example.test',
    title: 'Atomic note',
    content: '<p>Base</p>',
    color: '#ffffff',
    is_pinned: 0,
    is_locked: 0,
    folder: 'notes',
    labels_json: '[]',
    sync_token: 8,
    is_deleted: 0,
  };
  const originalQuery = pool.query;
  pool.query = async (sql, params = []) => {
    const query = String(sql);
    if (query.startsWith('SELECT * FROM notes')) return [[{ ...state }], []];
    if (query.startsWith('UPDATE notes SET')) {
      const expectedSyncToken = Number(params[params.length - 1]);
      if (expectedSyncToken !== state.sync_token) return [{ affectedRows: 0 }, []];
      state = {
        ...state,
        title: params[0],
        content: params[1],
        color: params[2],
        is_pinned: params[3],
        is_locked: params[4],
        folder: params[5],
        labels_json: params[6],
        sync_token: state.sync_token + 1,
      };
      return [{ affectedRows: 1 }, []];
    }
    throw new Error(`Unexpected query: ${query}`);
  };
  t.after(() => { pool.query = originalQuery; });

  const base = { ...state, owner: state.owner, expected_sync_token: 8 };
  const results = await Promise.allSettled([
    saveNote({ ...base, content: '<p>Writer one</p>' }),
    saveNote({ ...base, content: '<p>Writer two</p>' }),
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  const rejected = results.find((result) => result.status === 'rejected');
  assert.ok(rejected && rejected.reason instanceof NoteConflictError);
  assert.equal(state.sync_token, 9);
  assert.match(state.content, /Writer (one|two)/);
});

test('a stale IMAP deletion cannot delete a newer note revision or its dependents', async (t) => {
  let state = {
    id: 'delete-race-note',
    owner: 'owner@example.test',
    sync_token: 2,
    imap_sync_token: 2,
    imap_uid: 42,
    is_deleted: 0,
  };
  const cleanupQueries = [];
  const originalQuery = pool.query;
  let injectConcurrentEdit = true;
  pool.query = async (sql, params = []) => {
    const query = String(sql).replace(/\s+/g, ' ').trim();
    if (query.startsWith('UPDATE notes SET is_deleted = 1')) {
      if (injectConcurrentEdit) {
        injectConcurrentEdit = false;
        state = { ...state, sync_token: 3 };
      }
      const [id, owner, syncToken, imapSyncToken, imapUid] = params;
      const matches = state.id === id
        && state.owner === owner
        && state.sync_token === syncToken
        && state.imap_sync_token === imapSyncToken
        && state.imap_uid === imapUid
        && state.is_deleted === 0;
      if (!matches) return [{ affectedRows: 0 }, []];
      state = {
        ...state,
        is_deleted: 1,
        sync_token: syncToken + 1,
        imap_sync_token: syncToken + 1,
        imap_uid: null,
      };
      return [{ affectedRows: 1 }, []];
    }
    cleanupQueries.push(query);
    if (query.startsWith('SELECT a.storage_path')) return [[], []];
    return [{ affectedRows: 1 }, []];
  };
  t.after(() => { pool.query = originalQuery; });

  const staleDeleteWon = await deleteNoteIfRevisionMatches(
    state.id,
    state.owner,
    2,
    42,
  );
  assert.equal(staleDeleteWon, false);
  assert.equal(state.is_deleted, 0);
  assert.equal(state.sync_token, 3);
  assert.deepEqual(cleanupQueries, []);

  state = { ...state, imap_sync_token: 3 };
  const currentDeleteWon = await deleteNoteIfRevisionMatches(
    state.id,
    state.owner,
    3,
    42,
  );
  assert.equal(currentDeleteWon, true);
  assert.equal(state.is_deleted, 1);
  assert.equal(state.sync_token, 4);
  assert.equal(state.imap_sync_token, 4);
  assert.equal(state.imap_uid, null);
  assert.ok(cleanupQueries.some((query) => query.startsWith('DELETE FROM note_reminders')));
});

test('capabilities are opaque, owner- and session-bound, tamper-evident, and expiring', () => {
  const now = Date.UTC(2026, 7, 4, 12, 0, 0);
  const capability = issueNoteCollaborationCapability({
    noteId: 'note-private-id',
    owner: 'owner@example.test',
    sessionId: 'session-one',
    secret: SECRET,
    now,
  });

  assert.doesNotMatch(capability.room, /note-private-id|owner/i);
  assert.doesNotMatch(capability.token, /note-private-id|owner/i);
  assert.equal(capability.expiresAt, now + 5 * 60 * 1000);

  const verified = verifyNoteCollaborationCapability({
    token: capability.token,
    owner: 'owner@example.test',
    sessionId: 'session-one',
    secret: SECRET,
    now: now + 1000,
  });
  assert.equal(verified.room, capability.room);

  assert.throws(() => verifyNoteCollaborationCapability({
    token: capability.token,
    owner: 'other@example.test',
    sessionId: 'session-one',
    secret: SECRET,
    now: now + 1000,
  }), /not authorized/i);
  assert.throws(() => verifyNoteCollaborationCapability({
    token: capability.token,
    owner: 'owner@example.test',
    sessionId: 'session-two',
    secret: SECRET,
    now: now + 1000,
  }), /not authorized/i);
  assert.throws(() => verifyNoteCollaborationCapability({
    token: `${capability.token.slice(0, -1)}x`,
    owner: 'owner@example.test',
    sessionId: 'session-one',
    secret: SECRET,
    now: now + 1000,
  }), /invalid/i);
  assert.throws(() => verifyNoteCollaborationCapability({
    token: capability.token,
    owner: 'owner@example.test',
    sessionId: 'session-one',
    secret: SECRET,
    now: capability.expiresAt,
  }), /expired/i);
});

test('session issuance is opt-in and requires a live note owned by the caller', async () => {
  const calls = [];
  const findOwnedNote = async (noteId, owner) => {
    calls.push([noteId, owner]);
    return noteId === 'owned-note' && owner === 'owner@example.test' ? { id: noteId } : null;
  };

  await assert.rejects(
    authorizeNoteCollaboration({
      enabled: false,
      noteId: 'owned-note',
      owner: 'owner@example.test',
      sessionId: 'session-one',
      secret: SECRET,
      findOwnedNote,
    }),
    (error) => error.statusCode === 404,
  );
  assert.deepEqual(calls, [], 'disabled collaboration must not probe note ownership');

  await assert.rejects(
    authorizeNoteCollaboration({
      enabled: true,
      noteId: 'someone-elses-note',
      owner: 'owner@example.test',
      sessionId: 'session-one',
      secret: SECRET,
      findOwnedNote,
    }),
    (error) => error.statusCode === 404,
  );

  const capability = await authorizeNoteCollaboration({
    enabled: true,
    noteId: 'owned-note',
    owner: 'owner@example.test',
    sessionId: 'session-one',
    secret: SECRET,
    findOwnedNote,
  });
  assert.equal(typeof capability.room, 'string');
  assert.equal(typeof capability.token, 'string');
});

test('the signaling server authenticates the socket and confines it to one signed room', async (t) => {
  const server = http.createServer();
  const realtime = new SocketIOServer(server);
  let authenticationCalls = 0;
  const signaling = installNotesSignalingServer(server, {
    enabled: true,
    secret: SECRET,
    authenticate: async (request) => {
      authenticationCalls += 1;
      return request.headers.cookie === 'oms_session=valid'
        ? { owner: 'owner@example.test', sessionId: 'session-one' }
        : null;
    },
  });
  const address = await listen(server);
  t.after(async () => {
    for (const client of signaling.clients) client.terminate();
    await new Promise((resolve) => signaling.close(resolve));
    await new Promise((resolve) => realtime.close(resolve));
    if (server.listening) await new Promise((resolve) => server.close(resolve));
  });

  const capability = issueNoteCollaborationCapability({
    noteId: 'shared-owner-note',
    owner: 'owner@example.test',
    sessionId: 'session-one',
    secret: SECRET,
  });
  const url = `ws://127.0.0.1:${address.port}/notes-signal?token=${encodeURIComponent(capability.token)}`;

  const callsBeforeCrossOrigin = authenticationCalls;
  await assert.rejects(openSocket(url, 'oms_session=valid', 'https://evil.example'), /403/);
  assert.equal(authenticationCalls, callsBeforeCrossOrigin, 'origin rejection must happen before cookie authentication');
  await assert.rejects(openSocket(url, 'oms_session=invalid'), /401/);
  await assert.rejects(openSocket(`${url}x`), /401/);

  const exactOriginSocket = await openSocket(url, 'oms_session=valid', `http://127.0.0.1:${address.port}`);
  exactOriginSocket.close();

  const first = await openSocket(url);
  const second = await openSocket(url);
  const firstRole = waitForMessage(first);
  first.send(JSON.stringify({ type: 'subscribe', topics: [capability.room] }));
  assert.deepEqual(await firstRole, { type: 'oms-bootstrap', leader: true });
  const secondRole = waitForMessage(second);
  second.send(JSON.stringify({ type: 'subscribe', topics: [capability.room] }));
  assert.deepEqual(await secondRole, { type: 'oms-bootstrap', leader: false });

  const received = waitForMessage(second);
  first.send(JSON.stringify({
    type: 'publish',
    topic: capability.room,
    data: { type: 'announce', from: 'peer-one' },
  }));
  assert.equal((await received).topic, capability.room);

  const closed = waitForClose(first);
  first.send(JSON.stringify({ type: 'publish', topic: 'another-room', data: {} }));
  assert.equal(await closed, 1008);

  const expiringCapability = issueNoteCollaborationCapability({
    noteId: 'short-lived-note',
    owner: 'owner@example.test',
    sessionId: 'session-one',
    secret: SECRET,
    now: Date.now() - (5 * 60 * 1000) + 500,
  });
  const expiringSocket = await openSocket(
    `ws://127.0.0.1:${address.port}/notes-signal?token=${encodeURIComponent(expiringCapability.token)}`,
  );
  assert.equal(await waitForClose(expiringSocket), 1008);
});

test('deployment renders opt-in configuration and the self-hosted websocket route', () => {
  const installer = fs.readFileSync(path.resolve(__dirname, '../../functions/10_webmail.sh'), 'utf8');
  const installEntry = fs.readFileSync(path.resolve(__dirname, '../../install.sh'), 'utf8');
  const configTemplate = fs.readFileSync(path.resolve(__dirname, '../../config.default'), 'utf8');
  const packagedEnvironment = fs.readFileSync(
    path.resolve(__dirname, '../../packaging/webmail-backend.env.example'),
    'utf8',
  );
  const config = fs.readFileSync(path.resolve(__dirname, '../src/config.ts'), 'utf8');
  assert.match(installer, /ENABLE_OMS_NOTES_COLLABORATION/);
  assert.match(installer, /existing_env_value ENABLE_OMS_NOTES_COLLABORATION/);
  assert.match(installer, /location = \/notes-signal[\s\S]*access_log off;[\s\S]*proxy_set_header Upgrade/);
  assert.equal(
    (installer.match(/location = \/notes-signal \{/g) || []).length,
    2,
    'fresh and legacy-vhost deployments must both install the Notes signaling route',
  );
  assert.match(installEntry, /ENABLE_OMS_NOTES_COLLABORATION="false"/);
  assert.match(installEntry, /openmailstack_read_env_value[\s\S]*ENABLE_OMS_NOTES_COLLABORATION/);
  assert.match(configTemplate, /ENABLE_OMS_NOTES_COLLABORATION="false"/);
  assert.match(packagedEnvironment, /ENABLE_OMS_NOTES_COLLABORATION=false/);
  assert.match(config, /notesCollaborationEnabled:\s*parseBoolean\('ENABLE_OMS_NOTES_COLLABORATION', false\)/);
});

test('installer env reader preserves quoted and unquoted deployment values', (t) => {
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'oms-notes-env-'));
  const environmentPath = path.join(temporaryDirectory, 'backend.env');
  t.after(() => fs.rmSync(temporaryDirectory, { recursive: true, force: true }));
  fs.writeFileSync(environmentPath, [
    'ENABLE_OMS_NOTES_COLLABORATION=false',
    'OMS_SESSION_SECRET="quoted-secret"',
    '',
  ].join('\n'));
  const helperPath = path.resolve(__dirname, '../../functions/lib_os.sh');
  const result = spawnSync('bash', ['-c', [
    'source "$1"',
    'openmailstack_read_env_value "$2" ENABLE_OMS_NOTES_COLLABORATION',
    'openmailstack_read_env_value "$2" OMS_SESSION_SECRET',
  ].join('\n'), 'bash', helperPath, environmentPath], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'false\nquoted-secret\n');
});
