const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');

process.env.OMS_DB_PASSWORD ||= 'folder-management-route-test';

const username = 'folders@example.test';
const folderCalls = [];
const messageActionCalls = [];
const purgeCalls = [];
let activeRules = { rules: [] };
let snoozeFolders = [];
let mutationFolders = [
  { path: 'Projects/Travel', delimiter: '/' },
  { path: 'Archive/Travel', delimiter: '/' },
];
let purgeSearchIndex = async owner => { purgeCalls.push(owner); return 0; };
let createFolder = async (parent, name) => ({
  path: parent ? `${parent}/${name}` : name,
  delimiter: '/',
  unseen: 0,
});
let moveFolder = async (path, parent) => ({
  previousPath: path,
  folder: { path: parent ? `${parent}/${path.split('/').at(-1)}` : path.split('/').at(-1), delimiter: '/', unseen: 0 },
});
let renameFolder = async (path, name) => ({
  previousPath: path,
  folder: { path: `${path.slice(0, path.lastIndexOf('/') + 1)}${name}`, delimiter: '/', unseen: 0 },
});
let deleteFolder = async path => ({ deletedPath: path });
let runMessageAction = async (_folder, _uids, _action, targetFolder) => ({
  targetFolder,
  uidMap: new Map([[41, 84]]),
});

const db = require('../src/db.js');
db.pool.query = async sql => {
  if (String(sql).includes('FROM scheduled_emails')) return [[{ total: 0 }], []];
  if (String(sql).includes('FROM snooze_queue')) {
    return [snoozeFolders.map(original_folder => ({ original_folder })), []];
  }
  throw new Error('Unexpected database query in folder management test');
};

const managesievePath = require.resolve('../src/managesieve.js');
require.cache[managesievePath] = {
  id: managesievePath,
  filename: managesievePath,
  loaded: true,
  exports: {
    ManageSieveClient: class {
      async connect() {}
      async login() {}
      async getScript() {
        return `/* JSON_DATA_BASE64: ${Buffer.from(JSON.stringify(activeRules)).toString('base64url')} */`;
      }
      async logout() {}
    },
  },
  children: [],
  paths: [],
};

const authPath = require.resolve('../src/auth.js');
const auth = require(authPath);
require.cache[authPath].exports = {
  ...auth,
  requireSession: (req, _res, next) => {
    req.user = { username, password: 'test-only', isAdmin: false };
    next();
  },
};

const imapPoolPath = require.resolve('../src/imap-pool.js');
require.cache[imapPoolPath] = {
  id: imapPoolPath,
  filename: imapPoolPath,
  loaded: true,
  exports: {
    getImapConnection: async () => ({
      async getFolders() { return mutationFolders; },
      async createChildFolder(parent, name) {
        folderCalls.push({ action: 'create', parent, name });
        return createFolder(parent, name);
      },
      async createFolder(parent, name) {
        folderCalls.push({ action: 'create', parent, name });
        return createFolder(parent, name);
      },
      async moveFolder(path, parent) {
        folderCalls.push({ action: 'move', path, parent });
        return moveFolder(path, parent);
      },
      async renameFolder(path, name) {
        folderCalls.push({ action: 'rename', path, name });
        return renameFolder(path, name);
      },
      async deleteFolder(path) {
        folderCalls.push({ action: 'delete', path });
        return deleteFolder(path);
      },
      async messageAction(folder, uids, action, targetFolder) {
        messageActionCalls.push({ folder, uids, action, targetFolder });
        return runMessageAction(folder, uids, action, targetFolder);
      },
    }),
  },
  children: [],
  paths: [],
};

const searchWorkerPath = require.resolve('../src/search-worker.js');
const searchWorker = require(searchWorkerPath);
require.cache[searchWorkerPath].exports = {
  ...searchWorker,
  purgeUserSearchIndex: owner => purgeSearchIndex(owner),
};

const originalSetInterval = global.setInterval;
global.setInterval = () => ({ unref() {} });
const { apiRouter } = require('../src/api.js');
global.setInterval = originalSetInterval;
const { ImapService, MailboxMutationError } = require('../src/imap.js');

const requestJson = (port, method, path, body) => new Promise((resolve, reject) => {
  const payload = Buffer.from(JSON.stringify(body));
  const request = http.request({
    hostname: '127.0.0.1',
    port,
    path,
    method,
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': payload.length,
    },
  }, response => {
    const chunks = [];
    response.on('data', chunk => chunks.push(chunk));
    response.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      let json = null;
      try { json = JSON.parse(text); } catch {}
      resolve({ status: response.statusCode, json, text });
    });
  });
  request.on('error', reject);
  request.end(payload);
});

const postJson = (port, path, body) => requestJson(port, 'POST', path, body);

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

test('authenticated users can create a child folder under an existing mailbox', async t => {
  folderCalls.length = 0;
  createFolder = async () => ({ path: 'INBOX/Receipts', delimiter: '/', unseen: 0 });
  const port = await withServer(t);

  const response = await postJson(port, '/api/folders', {
    parent: 'INBOX',
    name: 'Receipts',
  });

  assert.equal(response.status, 201);
  assert.deepEqual(response.json, {
    success: true,
    folder: { path: 'INBOX/Receipts', delimiter: '/', unseen: 0 },
  });
  assert.deepEqual(folderCalls, [{ action: 'create', parent: 'INBOX', name: 'Receipts' }]);
});

test('authenticated users can create a top-level folder', async t => {
  folderCalls.length = 0;
  createFolder = async () => ({ path: 'Projects', delimiter: '/', unseen: 0 });
  const port = await withServer(t);

  const response = await postJson(port, '/api/folders', {
    parent: null,
    name: 'Projects',
  });

  assert.equal(response.status, 201);
  assert.deepEqual(response.json, {
    success: true,
    folder: { path: 'Projects', delimiter: '/', unseen: 0 },
  });
  assert.deepEqual(folderCalls, [{ action: 'create', parent: null, name: 'Projects' }]);
});

test('authenticated users can move and delete a custom folder', async t => {
  folderCalls.length = 0;
  purgeCalls.length = 0;
  activeRules = { rules: [] };
  snoozeFolders = [];
  mutationFolders = [
    { path: 'Projects/Travel', delimiter: '/' },
    { path: 'Archive/Travel', delimiter: '/' },
  ];
  purgeSearchIndex = async owner => { purgeCalls.push(owner); return 0; };
  moveFolder = async () => ({
    previousPath: 'Projects/Travel',
    folder: { path: 'Archive/Travel', delimiter: '/', unseen: 2 },
  });
  deleteFolder = async path => ({ deletedPath: path });
  const port = await withServer(t);

  const moved = await requestJson(port, 'PATCH', '/api/folders', {
    path: 'Projects/Travel',
    parent: 'Archive',
  });
  const deleted = await requestJson(port, 'DELETE', '/api/folders', {
    path: 'Archive/Travel',
  });

  assert.equal(moved.status, 200);
  assert.deepEqual(moved.json, {
    success: true,
    previousPath: 'Projects/Travel',
    folder: { path: 'Archive/Travel', delimiter: '/', unseen: 2 },
  });
  assert.equal(deleted.status, 200);
  assert.deepEqual(deleted.json, {
    success: true,
    deletedPath: 'Archive/Travel',
  });
  assert.deepEqual(folderCalls, [
    { action: 'move', path: 'Projects/Travel', parent: 'Archive' },
    { action: 'delete', path: 'Archive/Travel' },
  ]);
  assert.deepEqual(purgeCalls, [username, username]);
});

test('authenticated users can rename a custom folder without changing its parent', async t => {
  folderCalls.length = 0;
  purgeCalls.length = 0;
  activeRules = { rules: [] };
  snoozeFolders = [];
  mutationFolders = [{ path: 'Projects/Travel', delimiter: '/' }];
  purgeSearchIndex = async owner => { purgeCalls.push(owner); return 0; };
  renameFolder = async () => ({
    previousPath: 'Projects/Travel',
    folder: { path: 'Projects/Trips', delimiter: '/', unseen: 2 },
  });
  const port = await withServer(t);

  const response = await requestJson(port, 'PATCH', '/api/folders', {
    path: 'Projects/Travel',
    name: 'Trips',
  });

  assert.equal(response.status, 200);
  assert.deepEqual(response.json, {
    success: true,
    previousPath: 'Projects/Travel',
    folder: { path: 'Projects/Trips', delimiter: '/', unseen: 2 },
  });
  assert.deepEqual(folderCalls, [
    { action: 'rename', path: 'Projects/Travel', name: 'Trips' },
  ]);
  assert.deepEqual(purgeCalls, [username]);
});

test('folder PATCH rejects a combined move and rename before IMAP mutation', async t => {
  folderCalls.length = 0;
  purgeCalls.length = 0;
  activeRules = { rules: [] };
  snoozeFolders = [];
  const port = await withServer(t);

  const response = await requestJson(port, 'PATCH', '/api/folders', {
    path: 'Projects/Travel',
    parent: 'Archive',
    name: 'Trips',
  });

  assert.equal(response.status, 400);
  assert.equal(response.json.code, 'INVALID_FOLDER_MUTATION');
  assert.deepEqual(folderCalls, []);
  assert.deepEqual(purgeCalls, []);
});

test('committed folder mutations still succeed when best-effort search cleanup fails', async t => {
  folderCalls.length = 0;
  activeRules = { rules: [] };
  snoozeFolders = [];
  mutationFolders = [{ path: 'Projects/Travel', delimiter: '/' }];
  moveFolder = async () => ({
    previousPath: 'Projects/Travel',
    folder: { path: 'Archive/Travel', delimiter: '/', unseen: 0 },
  });
  purgeSearchIndex = async () => { throw new Error('private search database detail'); };
  const port = await withServer(t);

  const response = await requestJson(port, 'PATCH', '/api/folders', {
    path: 'Projects/Travel',
    parent: 'Archive',
  });

  assert.equal(response.status, 200);
  assert.equal(response.json.success, true);
  assert.doesNotMatch(response.text, /private search database detail/i);
});

test('folder rename, move, and delete reject rule or snooze path references before IMAP mutation', async t => {
  folderCalls.length = 0;
  purgeCalls.length = 0;
  purgeSearchIndex = async owner => { purgeCalls.push(owner); return 0; };
  mutationFolders = [
    { path: 'Projects/Travel', delimiter: '/' },
    { path: 'Archive/Travel', delimiter: '/' },
  ];
  activeRules = {
    rules: [{ actions: [{ type: 'move', folder: 'Projects/Travel/Receipts' }] }],
  };
  snoozeFolders = [];
  const port = await withServer(t);

  const renamed = await requestJson(port, 'PATCH', '/api/folders', {
    path: 'Projects/Travel',
    name: 'Trips',
  });
  const moved = await requestJson(port, 'PATCH', '/api/folders', {
    path: 'Projects/Travel',
    parent: 'Archive',
  });

  activeRules = { rules: [] };
  snoozeFolders = ['Archive/Travel'];
  const deleted = await requestJson(port, 'DELETE', '/api/folders', {
    path: 'Archive/Travel',
  });

  assert.equal(renamed.status, 409);
  assert.equal(renamed.json.code, 'FOLDER_IN_USE');
  assert.equal(moved.status, 409);
  assert.equal(moved.json.code, 'FOLDER_IN_USE');
  assert.equal(deleted.status, 409);
  assert.equal(deleted.json.code, 'FOLDER_IN_USE');
  assert.deepEqual(folderCalls, []);
  assert.deepEqual(purgeCalls, []);
});

test('expected IMAP folder conflicts preserve a useful status and safe message', async t => {
  createFolder = async () => {
    throw new MailboxMutationError('FOLDER_EXISTS', 409, 'A folder with that name already exists.');
  };
  const port = await withServer(t);

  const response = await postJson(port, '/api/folders', {
    parent: 'INBOX',
    name: 'Receipts',
  });

  assert.equal(response.status, 409);
  assert.deepEqual(response.json, {
    success: false,
    code: 'FOLDER_EXISTS',
    error: 'A folder with that name already exists.',
  });
});

test('unexpected IMAP failures do not expose upstream details', async t => {
  createFolder = async () => { throw new Error('private mailbox path and server response'); };
  const port = await withServer(t);

  const response = await postJson(port, '/api/folders', {
    parent: 'INBOX',
    name: 'Receipts',
  });

  assert.equal(response.status, 500);
  assert.deepEqual(response.json, {
    success: false,
    error: 'The folder could not be created. Please try again.',
  });
  assert.doesNotMatch(response.text, /private mailbox path|server response/i);
});

test('message move rejects a missing destination before reaching IMAP', async t => {
  messageActionCalls.length = 0;
  const port = await withServer(t);

  const response = await postJson(port, '/api/messages/action', {
    folder: 'INBOX',
    uids: [41],
    action: 'move',
  });

  assert.equal(response.status, 400);
  assert.equal(response.json.success, false);
  assert.deepEqual(messageActionCalls, []);
});

test('message action failures do not expose upstream IMAP details', async t => {
  messageActionCalls.length = 0;
  runMessageAction = async () => { throw new Error('private IMAP host and mailbox detail'); };
  const port = await withServer(t);

  const response = await postJson(port, '/api/messages/action', {
    folder: 'INBOX',
    uids: [41],
    action: 'spam',
  });

  assert.equal(response.status, 500);
  assert.deepEqual(response.json, {
    success: false,
    error: 'The message action could not be completed. Please try again.',
  });
  assert.doesNotMatch(response.text, /private IMAP host|mailbox detail/i);
});

test('IMAP folder creation supports top-level and child folders with the server delimiter', async () => {
  const calls = [];
  const service = Object.create(ImapService.prototype);
  service.client = {
    async list() {
      return [
        { path: 'INBOX', delimiter: '/' },
        { path: 'Projects', delimiter: '/' },
      ];
    },
    async mailboxCreate(segments) {
      calls.push(segments);
      return { path: segments.join('/'), created: true };
    },
  };

  const topLevel = await service.createFolder(null, '  Projects  ');
  const folder = await service.createFolder('INBOX', '  Travel ✈  ');

  assert.deepEqual(calls, [['Projects'], ['INBOX', 'Travel ✈']]);
  assert.deepEqual(topLevel, { path: 'Projects', delimiter: '/', unseen: 0 });
  assert.deepEqual(folder, { path: 'INBOX/Travel ✈', delimiter: '/', unseen: 0 });
});

test('IMAP child-folder creation rejects invalid names, virtual parents, and flat namespaces', async () => {
  const service = Object.create(ImapService.prototype);
  service.client = {
    async list() {
      return [
        { path: 'INBOX', delimiter: '/' },
        { path: 'Flat', delimiter: '' },
      ];
    },
    async mailboxCreate() {
      throw new Error('mailboxCreate must not be called for invalid input');
    },
  };

  await assert.rejects(
    () => service.createFolder('INBOX', 'Reports/2026'),
    error => error instanceof MailboxMutationError
      && error.code === 'INVALID_FOLDER_NAME'
      && error.statusCode === 400,
  );
  await assert.rejects(
    () => service.createFolder('INBOX', 'Bad\u0000Name'),
    error => error instanceof MailboxMutationError && error.code === 'INVALID_FOLDER_NAME',
  );
  await assert.rejects(
    () => service.createFolder({ path: 'INBOX' }, 'Reports'),
    error => error instanceof MailboxMutationError && error.code === 'INVALID_PARENT_FOLDER',
  );
  await assert.rejects(
    () => service.createFolder('SCHEDULED', 'Later'),
    error => error instanceof MailboxMutationError
      && error.code === 'VIRTUAL_FOLDER_UNSUPPORTED'
      && error.statusCode === 409,
  );
  await assert.rejects(
    () => service.createFolder(null, 'scheduled'),
    error => error instanceof MailboxMutationError
      && error.code === 'VIRTUAL_FOLDER_UNSUPPORTED'
      && error.statusCode === 409,
  );
  await assert.rejects(
    () => service.createFolder('Flat', 'Child'),
    error => error instanceof MailboxMutationError
      && error.code === 'FOLDER_HIERARCHY_UNAVAILABLE'
      && error.statusCode === 409,
  );
});

test('IMAP child-folder creation reports an existing folder without treating it as success', async () => {
  const service = Object.create(ImapService.prototype);
  service.client = {
    async list() { return [{ path: 'INBOX', delimiter: '/' }]; },
    async mailboxCreate() { return { path: 'INBOX/Receipts', created: false }; },
  };

  await assert.rejects(
    () => service.createFolder('INBOX', 'Receipts'),
    error => error instanceof MailboxMutationError
      && error.code === 'FOLDER_EXISTS'
      && error.statusCode === 409,
  );
});

test('IMAP folder moves preserve the leaf name and prevent unsafe destinations', async () => {
  const calls = [];
  const folders = [
    { path: 'INBOX', delimiter: '/', specialUse: '\\Inbox' },
    { path: 'Projects', delimiter: '/' },
    { path: 'Projects/Travel', delimiter: '/', subscribed: true, status: { unseen: 2 } },
    { path: 'Projects/Travel/2026', delimiter: '/', subscribed: true },
    { path: 'Projects/SCHEDULED', delimiter: '/' },
    { path: 'Archive', delimiter: '/' },
    { path: 'Old Sent', delimiter: '/', flags: new Set(['\\Sent']) },
  ];
  const service = Object.create(ImapService.prototype);
  service.client = {
    async list() { return folders; },
    async mailboxRename(path, segments) {
      calls.push(['rename', path, segments]);
      return { path, newPath: segments.join('/') };
    },
    async mailboxSubscribe(path) { calls.push(['subscribe', path]); return true; },
    async mailboxUnsubscribe(path) { calls.push(['unsubscribe', path]); return true; },
  };

  const moved = await service.moveFolder('Projects/Travel', 'Archive');
  const movedTopLevel = await service.moveFolder('Projects/Travel', null);

  assert.deepEqual(calls, [
    ['rename', 'Projects/Travel', ['Archive', 'Travel']],
    ['subscribe', 'Archive/Travel'],
    ['unsubscribe', 'Projects/Travel'],
    ['subscribe', 'Archive/Travel/2026'],
    ['unsubscribe', 'Projects/Travel/2026'],
    ['rename', 'Projects/Travel', ['Travel']],
    ['subscribe', 'Travel'],
    ['unsubscribe', 'Projects/Travel'],
    ['subscribe', 'Travel/2026'],
    ['unsubscribe', 'Projects/Travel/2026'],
  ]);
  assert.deepEqual(moved, {
    previousPath: 'Projects/Travel',
    folder: { path: 'Archive/Travel', delimiter: '/', unseen: 2 },
  });
  assert.equal(movedTopLevel.folder.path, 'Travel');

  await assert.rejects(
    () => service.moveFolder('INBOX', 'Archive'),
    error => error instanceof MailboxMutationError && error.code === 'PROTECTED_FOLDER',
  );
  await assert.rejects(
    () => service.moveFolder('Old Sent', 'Archive'),
    error => error instanceof MailboxMutationError && error.code === 'PROTECTED_FOLDER',
  );
  await assert.rejects(
    () => service.moveFolder('Projects', 'Projects/Travel'),
    error => error instanceof MailboxMutationError && error.code === 'INVALID_FOLDER_DESTINATION',
  );
  await assert.rejects(
    () => service.moveFolder('Projects/SCHEDULED', null),
    error => error instanceof MailboxMutationError && error.code === 'VIRTUAL_FOLDER_UNSUPPORTED',
  );
  await assert.rejects(
    () => service.moveFolder('Projects/Travel', { path: 'Archive' }),
    error => error instanceof MailboxMutationError && error.code === 'INVALID_FOLDER_DESTINATION',
  );
});

test('IMAP folder rename changes only the leaf and preserves subtree subscriptions', async () => {
  const calls = [];
  const folders = [
    { path: 'Projects', delimiter: '/' },
    { path: 'Projects/Travel', delimiter: '/', subscribed: true, status: { unseen: 2 } },
    { path: 'Projects/Travel/2026', delimiter: '/', subscribed: true },
  ];
  const service = Object.create(ImapService.prototype);
  service.client = {
    async list() { return folders; },
    async mailboxRename(path, segments) {
      calls.push(['rename', path, segments]);
      return { path, newPath: segments.join('/') };
    },
    async mailboxSubscribe(path) { calls.push(['subscribe', path]); return true; },
    async mailboxUnsubscribe(path) { calls.push(['unsubscribe', path]); return true; },
  };

  const renamed = await service.renameFolder('Projects/Travel', 'Trips');

  assert.deepEqual(calls, [
    ['rename', 'Projects/Travel', ['Projects', 'Trips']],
    ['subscribe', 'Projects/Trips'],
    ['unsubscribe', 'Projects/Travel'],
    ['subscribe', 'Projects/Trips/2026'],
    ['unsubscribe', 'Projects/Travel/2026'],
  ]);
  assert.deepEqual(renamed, {
    previousPath: 'Projects/Travel',
    folder: { path: 'Projects/Trips', delimiter: '/', unseen: 2 },
  });
});

test('IMAP folder rename supports a custom top-level folder', async () => {
  const calls = [];
  const service = Object.create(ImapService.prototype);
  service.client = {
    async list() {
      return [
        { path: 'INBOX', delimiter: '/' },
        { path: 'Projects', delimiter: '/', subscribed: true, status: { unseen: 4 } },
      ];
    },
    async mailboxRename(path, segments) {
      calls.push(['rename', path, segments]);
      return { path, newPath: segments.join('/') };
    },
    async mailboxSubscribe(path) { calls.push(['subscribe', path]); return true; },
    async mailboxUnsubscribe(path) { calls.push(['unsubscribe', path]); return true; },
  };

  const renamed = await service.renameFolder('Projects', 'Work');

  assert.deepEqual(calls, [
    ['rename', 'Projects', ['Work']],
    ['subscribe', 'Work'],
    ['unsubscribe', 'Projects'],
  ]);
  assert.deepEqual(renamed, {
    previousPath: 'Projects',
    folder: { path: 'Work', delimiter: '/', unseen: 4 },
  });
});

test('IMAP folder rename rejects protected, invalid, conflicting, and unchanged names', async () => {
  const service = Object.create(ImapService.prototype);
  service.client = {
    async list() {
      return [
        { path: 'INBOX', delimiter: '/' },
        { path: 'Old Sent', delimiter: '/', flags: new Set(['\\Sent']) },
        { path: 'Projects/Travel', delimiter: '/' },
        { path: 'Projects/Trips', delimiter: '/' },
        { path: 'Travel', delimiter: '/' },
      ];
    },
    async mailboxRename() {
      throw new Error('mailboxRename must not be called for rejected input');
    },
  };

  await assert.rejects(
    () => service.renameFolder('INBOX', 'Primary'),
    error => error instanceof MailboxMutationError && error.code === 'PROTECTED_FOLDER',
  );
  await assert.rejects(
    () => service.renameFolder('Old Sent', 'Sent 2'),
    error => error instanceof MailboxMutationError && error.code === 'PROTECTED_FOLDER',
  );
  await assert.rejects(
    () => service.renameFolder('Projects/Travel', '   '),
    error => error instanceof MailboxMutationError && error.code === 'INVALID_FOLDER_NAME',
  );
  await assert.rejects(
    () => service.renameFolder('Projects/Travel', 'Bad\u0000Name'),
    error => error instanceof MailboxMutationError && error.code === 'INVALID_FOLDER_NAME',
  );
  await assert.rejects(
    () => service.renameFolder('Projects/Travel', 'Reports/2026'),
    error => error instanceof MailboxMutationError && error.code === 'INVALID_FOLDER_NAME',
  );
  await assert.rejects(
    () => service.renameFolder('Projects/Travel', 'Trips'),
    error => error instanceof MailboxMutationError && error.code === 'FOLDER_EXISTS',
  );
  await assert.rejects(
    () => service.renameFolder('Projects/Travel', 'Travel'),
    error => error instanceof MailboxMutationError && error.code === 'FOLDER_NAME_UNCHANGED',
  );
  await assert.rejects(
    () => service.renameFolder('Travel', 'scheduled'),
    error => error instanceof MailboxMutationError && error.code === 'VIRTUAL_FOLDER_UNSUPPORTED',
  );
  await assert.rejects(
    () => service.renameFolder('Travel', 'inbox'),
    error => error instanceof MailboxMutationError && error.code === 'PROTECTED_FOLDER',
  );
  await assert.rejects(
    () => service.renameFolder('Missing', 'Present'),
    error => error instanceof MailboxMutationError && error.code === 'FOLDER_NOT_FOUND',
  );
});

test('IMAP spam actions honor the server-designated special-use Junk folder', async () => {
  const calls = [];
  const service = Object.create(ImapService.prototype);
  service.client = {
    async mailboxOpen(path) { calls.push(['open', path]); },
    async mailboxClose() { calls.push(['close']); },
    async list() {
      return [
        { path: 'INBOX', delimiter: '/' },
        { path: 'Spam', delimiter: '/', specialUse: '\\Junk' },
      ];
    },
    async mailboxCreate(path) { calls.push(['create', path]); },
    async messageMove(sequence, path, options) {
      calls.push(['move', sequence, path, options]);
      return { uidMap: new Map([[41, 84]]) };
    },
  };

  const result = await service.messageAction('INBOX', [41], 'spam');

  assert.deepEqual(result, { targetFolder: 'Spam', uidMap: { 41: 84 } });
  assert.deepEqual(calls, [
    ['open', 'INBOX'],
    ['move', '41', 'Spam', { uid: true }],
    ['close'],
  ]);
});

test('IMAP folder deletion rejects protected, missing, and non-empty folder trees', async () => {
  const calls = [];
  const service = Object.create(ImapService.prototype);
  service.client = {
    async list() {
      return [
        { path: 'INBOX', delimiter: '/', specialUse: '\\Inbox' },
        { path: 'Projects', delimiter: '/' },
        { path: 'Projects/Travel', delimiter: '/' },
        { path: 'Archive', delimiter: '/', subscribed: true },
        { path: 'Deleted Messages', delimiter: '/', flags: new Set(['\\Trash']) },
      ];
    },
    async mailboxDelete(path) { calls.push(['delete', path]); },
    async mailboxUnsubscribe(path) { calls.push(['unsubscribe', path]); return true; },
  };

  assert.deepEqual(await service.deleteFolder('Archive'), { deletedPath: 'Archive' });
  assert.deepEqual(calls, [['delete', 'Archive'], ['unsubscribe', 'Archive']]);
  await assert.rejects(
    () => service.deleteFolder('INBOX'),
    error => error instanceof MailboxMutationError && error.code === 'PROTECTED_FOLDER',
  );
  await assert.rejects(
    () => service.deleteFolder('Deleted Messages'),
    error => error instanceof MailboxMutationError && error.code === 'PROTECTED_FOLDER',
  );
  await assert.rejects(
    () => service.deleteFolder('Missing'),
    error => error instanceof MailboxMutationError && error.code === 'FOLDER_NOT_FOUND',
  );
  await assert.rejects(
    () => service.deleteFolder('Projects'),
    error => error instanceof MailboxMutationError && error.code === 'FOLDER_HAS_CHILDREN',
  );
});
