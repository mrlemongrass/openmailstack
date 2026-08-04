const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

const sourcePath = path.resolve(__dirname, '../src/notes/collaboration.ts');
const source = fs.readFileSync(sourcePath, 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
  fileName: sourcePath,
}).outputText;
const testModule = new Module(sourcePath, module);
testModule.paths = module.paths;
testModule._compile(compiled, sourcePath);

const {
  collaborationRetryDelay,
  collaborationRefreshDelay,
  collaborationWebSocketUrl,
  fetchNoteCollaborationSession,
  observeNoteCollaborationProvider,
} = testModule.exports;

test('collaboration sessions are requested at runtime and converted to same-origin websocket URLs', async () => {
  const calls = [];
  const session = await fetchNoteCollaborationSession('note/one', undefined, async (url, options) => {
    calls.push([url, options]);
    return {
      ok: true,
      json: async () => ({
        success: true,
        room: 'opaque-room',
        token: 'short-lived-token',
        signalingPath: '/notes-signal',
        expiresAt: 123,
      }),
    };
  });

  assert.equal(calls[0][0], '/api/notes/note%2Fone/collaboration-session');
  assert.equal(calls[0][1].method, 'POST');
  assert.equal(
    collaborationWebSocketUrl(session, { protocol: 'https:', host: 'mail.example.test' }),
    'wss://mail.example.test/notes-signal?token=short-lived-token',
  );
  assert.equal(
    collaborationWebSocketUrl(session, { protocol: 'http:', host: 'localhost:5173' }),
    'ws://localhost:5173/notes-signal?token=short-lived-token',
  );
});

test('disabled or denied collaboration returns a local-editing result without leaking response details', async () => {
  const result = await fetchNoteCollaborationSession('missing', undefined, async () => ({
    ok: false,
    status: 404,
    json: async () => ({ error: 'internal detail' }),
  }));
  assert.equal(result, null);
});

test('capabilities refresh before expiry so websocket reconnects do not reuse stale URLs', () => {
  assert.equal(collaborationRefreshDelay({ expiresAt: 400_000 }, 100_000), 270_000);
  assert.equal(collaborationRefreshDelay({ expiresAt: 100_500 }, 100_000), 1000);
});

test('transient refresh failures retry with bounded backoff only while the capability is live', () => {
  assert.equal(collaborationRetryDelay(0, 200_000, 100_000), 1000);
  assert.equal(collaborationRetryDelay(10, 200_000, 100_000), 30_000);
  assert.equal(collaborationRetryDelay(10, 101_500, 100_000), 1500);
  assert.equal(collaborationRetryDelay(0, 100_000, 100_000), null);
});

test('a synced event initializes only while at least one peer is still live', () => {
  const handlers = new Map();
  const provider = {
    signalingConns: [{ on: () => {} }],
    on: (eventName, handler) => handlers.set(eventName, handler),
  };
  let synchronized = 0;
  observeNoteCollaborationProvider(provider, {
    onBootstrap: () => {},
    onPeerChange: () => {},
    onSynced: () => { synchronized += 1; },
  });
  handlers.get('synced')({ synced: true });
  assert.equal(synchronized, 0);
  handlers.get('peers')({ webrtcPeers: ['peer-one'], bcPeers: [] });
  handlers.get('synced')({ synced: true });
  assert.equal(synchronized, 1);
  handlers.get('peers')({ webrtcPeers: [], bcPeers: [] });
  handlers.get('synced')({ synced: true });
  assert.equal(synchronized, 1);
});

test('the editor uses only authenticated runtime signaling and preserves local fallback', () => {
  const editor = fs.readFileSync(path.resolve(__dirname, '../src/LiveNoteEditor.tsx'), 'utf8');
  assert.doesNotMatch(editor, /VITE_OMS_NOTES_SIGNALING_URLS/);
  assert.match(editor, /fetchNoteCollaborationSession/);
  assert.match(editor, /collaborationWebSocketUrl/);
  assert.match(editor, /observeNoteCollaborationProvider/);
  assert.match(editor, /onBootstrap:[\s\S]*leader[\s\S]*initializeFromPersistedHtml/);
  assert.match(source, /signalingConns\[0\][\s\S]*oms-bootstrap/);
  assert.match(editor, /Editing locally/);
  assert.ok(
    editor.indexOf('initTimerRef.current = setTimeout')
      < editor.indexOf('await fetchNoteCollaborationSession'),
    'the persisted-note fallback deadline must start before the session request',
  );
  assert.match(editor, /collaborationRetryDelay/);
  assert.match(editor, /editor\.enable\(false\)/);
  assert.match(editor, /ytext\.observe\(handleSharedText\)/);
  assert.match(editor, /editor\.enable\(true\)/);
  assert.match(editor, /filterBcConns:\s*false/);
  assert.match(editor, /onSynced/);
  assert.match(editor, /collaborationStopped/);
  assert.match(editor, /if \(refreshTimer\) clearTimeout\(refreshTimer\)/);
  assert.match(
    editor,
    /const disconnectProvider[\s\S]*activeProvider\.disconnect\(\)[\s\S]*activeProvider\.destroy\(\)/,
  );
  assert.doesNotMatch(editor, /provider\??\.destroy\(\)/);
});

test('note persistence carries a revision and keeps stale conflicts visible', () => {
  const modal = fs.readFileSync(
    path.resolve(__dirname, '../src/notes/components/NoteEditorModal.tsx'),
    'utf8',
  );
  const api = fs.readFileSync(path.resolve(__dirname, '../src/shared/api.ts'), 'utf8');
  const backend = fs.readFileSync(
    path.resolve(__dirname, '../../webmail-backend/src/api.ts'),
    'utf8',
  );
  assert.match(modal, /expected_sync_token:\s*latest\.sync_token/);
  assert.match(modal, /latestDraftRef/);
  assert.match(modal, /const latest = latestDraftRef\.current/);
  assert.match(modal, /Save on close failed[\s\S]*showToast[\s\S]*return;/);
  assert.match(modal, /NoteSaveConflictError/);
  assert.match(api, /res\.status === 409[\s\S]*NoteSaveConflictError/);
  assert.match(backend, /NoteConflictError[\s\S]*status\(409\)/);
  assert.match(backend, /expected_sync_token === undefined[\s\S]*status\(428\)/);
  const grid = fs.readFileSync(
    path.resolve(__dirname, '../src/notes/NotesGrid.tsx'),
    'utf8',
  );
  assert.match(grid, /expected_sync_token:\s*note\.sync_token/g);
});
