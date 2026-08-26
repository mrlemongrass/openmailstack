const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');

process.env.OMS_DB_PASSWORD ||= 'folder-management-route-test';

const username = 'folders@example.test';
const folderCalls = [];
const messageActionCalls = [];
const markFolderReadCalls = [];
const dedicatedImapCalls = [];
const markReadIndexCalls = [];
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
let deleteFolder = async (path, permanent) => permanent
  ? { disposition: 'deleted', deletedPath: path }
  : {
      disposition: 'trashed',
      previousPath: path,
      folder: { path: `Deleted Messages/${path.split('/').at(-1)}`, delimiter: '/', unseen: 0 },
    };
let runMarkFolderRead = async path => ({ path, marked: 3, maxUid: 42, markedUids: [11, 21, 42] });
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

const searchIndexPath = require.resolve('../src/search-index.js');
const searchIndex = require(searchIndexPath);
require.cache[searchIndexPath].exports = {
  ...searchIndex,
  async markMailSearchFolderRead(owner, folder, uids) {
    markReadIndexCalls.push({ owner, folder, uids });
  },
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
    async withDedicatedImapConnection(user, pass, operation) {
      dedicatedImapCalls.push({ user, pass });
      return operation({
        async markFolderRead(path) {
          markFolderReadCalls.push(path);
          return runMarkFolderRead(path);
        },
      });
    },
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
      async moveFolder(path, parent, sourceUidValidity, parentUidValidity) {
        folderCalls.push({
          action: 'move',
          path,
          parent,
          ...(sourceUidValidity === undefined ? {} : { sourceUidValidity }),
          ...(parentUidValidity === undefined ? {} : { parentUidValidity }),
        });
        return moveFolder(path, parent, sourceUidValidity, parentUidValidity);
      },
      async renameFolder(path, name, sourceUidValidity) {
        folderCalls.push({
          action: 'rename',
          path,
          name,
          ...(sourceUidValidity === undefined ? {} : { sourceUidValidity }),
        });
        return renameFolder(path, name, sourceUidValidity);
      },
      async deleteFolder(path, permanent, sourceUidValidity) {
        folderCalls.push({
          action: 'delete',
          path,
          permanent,
          ...(sourceUidValidity === undefined ? {} : { sourceUidValidity }),
        });
        return deleteFolder(path, permanent, sourceUidValidity);
      },
      async markFolderRead(path) {
        markFolderReadCalls.push(path);
        return runMarkFolderRead(path);
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

function createMutationTestService() {
  const service = Object.create(ImapService.prototype);
  let client;
  Object.defineProperty(service, 'client', {
    configurable: true,
    get: () => client,
    set: value => {
      const list = value.list?.bind(value);
      if (list) {
        value.list = async (...args) => (await list(...args)).map(folder => ({
          ...folder,
          status: {
            ...(folder.status || {}),
            uidValidity: folder.status?.uidValidity ?? 1n,
          },
        }));
      }
      client = value;
    },
  });
  service.moveFolder = (path, parent, sourceUidValidity = '1', parentUidValidity = parent === null ? undefined : '1') => (
    ImapService.prototype.moveFolder.call(service, path, parent, sourceUidValidity, parentUidValidity)
  );
  service.renameFolder = (path, name, sourceUidValidity = '1') => (
    ImapService.prototype.renameFolder.call(service, path, name, sourceUidValidity)
  );
  service.deleteFolder = (path, permanent, sourceUidValidity = '1') => (
    ImapService.prototype.deleteFolder.call(service, path, permanent, sourceUidValidity)
  );
  return service;
}

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

test('authenticated users can move and recoverably delete a custom folder', async t => {
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
  deleteFolder = async path => ({
    disposition: 'trashed',
    previousPath: path,
    folder: { path: 'Deleted Messages/Travel', delimiter: '/', unseen: 2 },
  });
  const port = await withServer(t);

  const moved = await requestJson(port, 'PATCH', '/api/folders', {
    path: 'Projects/Travel',
    parent: 'Archive',
    sourceUidValidity: '101',
    parentUidValidity: '202',
  });
  const deleted = await requestJson(port, 'DELETE', '/api/folders', {
    path: 'Archive/Travel',
    sourceUidValidity: '101',
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
    disposition: 'trashed',
    previousPath: 'Archive/Travel',
    folder: { path: 'Deleted Messages/Travel', delimiter: '/', unseen: 2 },
  });
  assert.deepEqual(folderCalls, [
    {
      action: 'move',
      path: 'Projects/Travel',
      parent: 'Archive',
      sourceUidValidity: '101',
      parentUidValidity: '202',
    },
    {
      action: 'delete',
      path: 'Archive/Travel',
      permanent: false,
      sourceUidValidity: '101',
    },
  ]);
  assert.deepEqual(purgeCalls, [username, username]);
});

test('folder deletion requires explicit permanent intent for a folder already in Trash', async t => {
  folderCalls.length = 0;
  purgeCalls.length = 0;
  activeRules = { rules: [] };
  snoozeFolders = [];
  mutationFolders = [{ path: 'Deleted Messages/Old', delimiter: '/' }];
  purgeSearchIndex = async owner => { purgeCalls.push(owner); return 0; };
  deleteFolder = async (path, permanent) => ({
    disposition: 'deleted',
    deletedPath: path,
    permanent,
  });
  const port = await withServer(t);

  const deleted = await requestJson(port, 'DELETE', '/api/folders', {
    path: 'Deleted Messages/Old',
    permanent: true,
    sourceUidValidity: '303',
  });

  assert.equal(deleted.status, 200);
  assert.deepEqual(deleted.json, {
    success: true,
    disposition: 'deleted',
    deletedPath: 'Deleted Messages/Old',
    permanent: true,
  });
  assert.deepEqual(folderCalls, [{
    action: 'delete',
    path: 'Deleted Messages/Old',
    permanent: true,
    sourceUidValidity: '303',
  }]);
  assert.deepEqual(purgeCalls, [username]);
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
    sourceUidValidity: '101',
  });

  assert.equal(response.status, 200);
  assert.deepEqual(response.json, {
    success: true,
    previousPath: 'Projects/Travel',
    folder: { path: 'Projects/Trips', delimiter: '/', unseen: 2 },
  });
  assert.deepEqual(folderCalls, [
    {
      action: 'rename',
      path: 'Projects/Travel',
      name: 'Trips',
      sourceUidValidity: '101',
    },
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
    sourceUidValidity: '101',
    parentUidValidity: '202',
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
    sourceUidValidity: '101',
    parentUidValidity: '202',
  });

  assert.equal(response.status, 200);
  assert.equal(response.json.success, true);
  assert.deepEqual(response.json.warnings, ['SEARCH_INDEX_RESET_FAILED']);
  assert.doesNotMatch(response.text, /private search database detail/i);
});

test('search cleanup failures do not expose private backend details', async t => {
  purgeSearchIndex = async () => { throw new Error('private search database detail'); };
  const port = await withServer(t);

  const response = await requestJson(port, 'DELETE', '/api/messages/search/index', {});

  assert.equal(response.status, 500);
  assert.deepEqual(response.json, {
    success: false,
    error: 'Search cleanup could not be completed.',
  });
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
    sourceUidValidity: '101',
  });
  const moved = await requestJson(port, 'PATCH', '/api/folders', {
    path: 'Projects/Travel',
    parent: 'Archive',
    sourceUidValidity: '101',
    parentUidValidity: '202',
  });

  activeRules = { rules: [] };
  snoozeFolders = ['Archive/Travel'];
  const deleted = await requestJson(port, 'DELETE', '/api/folders', {
    path: 'Archive/Travel',
    sourceUidValidity: '202',
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

test('folder lifecycle routes reject requests without bound mailbox identities', async t => {
  folderCalls.length = 0;
  purgeCalls.length = 0;
  activeRules = { rules: [] };
  snoozeFolders = [];
  const port = await withServer(t);

  const renamed = await requestJson(port, 'PATCH', '/api/folders', {
    path: 'Projects/Travel',
    name: 'Trips',
  });
  const moved = await requestJson(port, 'PATCH', '/api/folders', {
    path: 'Projects/Travel',
    parent: 'Archive',
    sourceUidValidity: '101',
  });
  const deleted = await requestJson(port, 'DELETE', '/api/folders', {
    path: 'Projects/Travel',
  });

  for (const response of [renamed, moved, deleted]) {
    assert.equal(response.status, 400);
    assert.equal(response.json.code, 'INVALID_FOLDER_IDENTITY');
  }
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

test('folder-wide mark as read reaches IMAP once and returns the exact unread count', async t => {
  markFolderReadCalls.length = 0;
  dedicatedImapCalls.length = 0;
  markReadIndexCalls.length = 0;
  runMarkFolderRead = async path => ({
    path: 'INBOX',
    marked: 3,
    maxUid: 502,
    markedUids: [11, 207, 501],
  });
  const port = await withServer(t);

  const response = await postJson(port, '/api/folders/mark-read', {
    path: 'INBOX',
  });

  assert.equal(response.status, 200);
  assert.deepEqual(response.json, {
    success: true,
    path: 'INBOX',
    marked: 3,
    maxUid: 502,
  });
  assert.deepEqual(markFolderReadCalls, ['INBOX']);
  assert.deepEqual(dedicatedImapCalls, [{ user: username, pass: 'test-only' }]);
  assert.deepEqual(markReadIndexCalls, [{
    owner: username,
    folder: 'INBOX',
    uids: [11, 207, 501],
  }]);
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
  const service = createMutationTestService();
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
  const service = createMutationTestService();
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
  const service = createMutationTestService();
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
  const service = createMutationTestService();
  service.client = {
    async list() { return folders; },
    async mailboxRename(path, destination) {
      calls.push(['rename', path, destination]);
      return { path, newPath: destination };
    },
    async mailboxSubscribe(path) { calls.push(['subscribe', path]); return true; },
    async mailboxUnsubscribe(path) { calls.push(['unsubscribe', path]); return true; },
  };

  const moved = await service.moveFolder('Projects/Travel', 'Archive');
  const movedTopLevel = await service.moveFolder('Projects/Travel', null);

  assert.deepEqual(calls, [
    ['rename', 'Projects/Travel', 'Archive/Travel'],
    ['subscribe', 'Archive/Travel'],
    ['unsubscribe', 'Projects/Travel'],
    ['subscribe', 'Archive/Travel/2026'],
    ['unsubscribe', 'Projects/Travel/2026'],
    ['rename', 'Projects/Travel', 'Travel'],
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

test('IMAP folder moves translate subscribed descendants across namespace delimiters', async () => {
  const calls = [];
  const service = createMutationTestService();
  service.client = {
    async list() {
      return [
        { path: 'Deleted Messages.Project', delimiter: '.', subscribed: true, status: { unseen: 3 } },
        { path: 'Deleted Messages.Project.Child', delimiter: '.', subscribed: true },
        { path: 'Projects', delimiter: '/' },
      ];
    },
    async mailboxRename(path, destination) {
      calls.push(['rename', path, destination]);
      return { path, newPath: destination };
    },
    async mailboxSubscribe(path) { calls.push(['subscribe', path]); return true; },
    async mailboxUnsubscribe(path) { calls.push(['unsubscribe', path]); return true; },
  };

  assert.deepEqual(await service.moveFolder('Deleted Messages.Project', 'Projects'), {
    previousPath: 'Deleted Messages.Project',
    folder: { path: 'Projects/Project', delimiter: '/', unseen: 3 },
  });
  assert.deepEqual(calls, [
    ['rename', 'Deleted Messages.Project', 'Projects/Project'],
    ['subscribe', 'Projects/Project'],
    ['unsubscribe', 'Deleted Messages.Project'],
    ['subscribe', 'Projects/Project/Child'],
    ['unsubscribe', 'Deleted Messages.Project.Child'],
  ]);
});

test('IMAP folder restore to top level uses the personal namespace delimiter', async () => {
  const calls = [];
  const service = createMutationTestService();
  service.client = {
    namespace: { prefix: '', delimiter: '/' },
    async list() {
      return [
        { path: 'INBOX', delimiter: '/', specialUse: '\\Inbox' },
        { path: 'Deleted Messages.Project', delimiter: '.', subscribed: true, status: { unseen: 3 } },
        { path: 'Deleted Messages.Project.Child', delimiter: '.', subscribed: true },
      ];
    },
    async mailboxRename(path, destination) {
      calls.push(['rename', path, destination]);
      return { path, newPath: destination };
    },
    async mailboxSubscribe(path) { calls.push(['subscribe', path]); return true; },
    async mailboxUnsubscribe(path) { calls.push(['unsubscribe', path]); return true; },
  };

  assert.deepEqual(await service.moveFolder('Deleted Messages.Project', null), {
    previousPath: 'Deleted Messages.Project',
    folder: { path: 'Project', delimiter: '/', unseen: 3 },
  });
  assert.deepEqual(calls, [
    ['rename', 'Deleted Messages.Project', 'Project'],
    ['subscribe', 'Project'],
    ['unsubscribe', 'Deleted Messages.Project'],
    ['subscribe', 'Project/Child'],
    ['unsubscribe', 'Deleted Messages.Project.Child'],
  ]);
});

test('IMAP folder restore fails closed when a name becomes ambiguous in the root namespace', async () => {
  let folders = [
    { path: 'INBOX', delimiter: '/', specialUse: '\\Inbox' },
    { path: 'Deleted Messages.Project/2026', delimiter: '.' },
  ];
  const service = createMutationTestService();
  service.client = {
    namespace: { prefix: '', delimiter: '/' },
    async list() { return folders; },
    async mailboxRename() { throw new Error('mailboxRename must not be called'); },
  };

  await assert.rejects(
    () => service.moveFolder('Deleted Messages.Project/2026', null),
    error => error instanceof MailboxMutationError && error.code === 'FOLDER_NAME_INCOMPATIBLE',
  );

  folders = [
    { path: 'INBOX', delimiter: '/', specialUse: '\\Inbox' },
    { path: 'Deleted Messages.Project', delimiter: '.' },
    { path: 'Deleted Messages.Project.Child/2026', delimiter: '.' },
  ];
  await assert.rejects(
    () => service.moveFolder('Deleted Messages.Project', null),
    error => error instanceof MailboxMutationError && error.code === 'FOLDER_NAME_INCOMPATIBLE',
  );
});

test('IMAP folder rename changes only the leaf and preserves subtree subscriptions', async () => {
  const calls = [];
  const folders = [
    { path: 'Projects', delimiter: '/' },
    { path: 'Projects/Travel', delimiter: '/', subscribed: true, status: { unseen: 2 } },
    { path: 'Projects/Travel/2026', delimiter: '/', subscribed: true },
  ];
  const service = createMutationTestService();
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
  const service = createMutationTestService();
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

test('IMAP folder mutations reject a path reused by a different mailbox generation', async () => {
  const calls = [];
  const service = createMutationTestService();
  service.client = {
    namespace: { prefix: '', delimiter: '/' },
    async list(options) {
      calls.push(['list', options]);
      return [
        { path: 'INBOX', delimiter: '/', status: { uidValidity: 1n } },
        { path: 'Projects', delimiter: '/', status: { uidValidity: 202n } },
        { path: 'Archive', delimiter: '/', status: { uidValidity: 303n } },
        { path: 'Deleted Messages', delimiter: '/', specialUse: '\\Trash', status: { uidValidity: 404n } },
      ];
    },
    async mailboxRename() {
      throw new Error('mailboxRename must not run for a reused path');
    },
    async mailboxDelete() {
      throw new Error('mailboxDelete must not run for a reused path');
    },
  };

  await assert.rejects(
    () => ImapService.prototype.renameFolder.call(service, 'Projects', 'Work', undefined),
    error => error instanceof MailboxMutationError && error.code === 'INVALID_FOLDER_IDENTITY',
  );
  await assert.rejects(
    () => ImapService.prototype.moveFolder.call(service, 'Projects', 'Archive', '202', undefined),
    error => error instanceof MailboxMutationError && error.code === 'INVALID_FOLDER_IDENTITY',
  );
  await assert.rejects(
    () => ImapService.prototype.deleteFolder.call(service, 'Projects', false, undefined),
    error => error instanceof MailboxMutationError && error.code === 'INVALID_FOLDER_IDENTITY',
  );

  await assert.rejects(
    () => service.renameFolder('Projects', 'Work', '101'),
    error => error instanceof MailboxMutationError && error.code === 'FOLDER_CHANGED',
  );
  await assert.rejects(
    () => service.moveFolder('Projects', 'Archive', '101', '303'),
    error => error instanceof MailboxMutationError && error.code === 'FOLDER_CHANGED',
  );
  await assert.rejects(
    () => service.moveFolder('Projects', 'Archive', '202', '999'),
    error => error instanceof MailboxMutationError && error.code === 'FOLDER_CHANGED',
  );
  await assert.rejects(
    () => service.deleteFolder('Projects', false, '101'),
    error => error instanceof MailboxMutationError && error.code === 'FOLDER_CHANGED',
  );
  assert.equal(calls.length, 4);
  assert.ok(calls.every(([, options]) => options?.statusQuery?.uidValidity === true));
});

test('IMAP folder rename rejects protected, invalid, conflicting, and unchanged names', async () => {
  const service = createMutationTestService();
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

test('IMAP folder-wide mark as read is bounded to the mailbox UID ceiling captured at click time', async () => {
  const calls = [];
  const service = createMutationTestService();
  service.client = {
    async list() {
      calls.push(['list']);
      return [{ path: 'INBOX', delimiter: '/', flags: new Set() }];
    },
    mailbox: null,
    async getMailboxLock(path) {
      calls.push(['lock', path]);
      this.mailbox = { uidNext: 503 };
      return { release: () => calls.push(['release']) };
    },
    async search(query, options) {
      calls.push(['search', query, options]);
      return [11, 207, 501];
    },
    async messageFlagsAdd(sequence, flags, options) {
      calls.push(['flags-add', sequence, flags, options]);
    },
    async mailboxClose() {
      calls.push(['close']);
    },
  };

  const result = await service.markFolderRead('INBOX');

  assert.deepEqual(result, {
    path: 'INBOX',
    marked: 3,
    maxUid: 502,
    markedUids: [11, 207, 501],
  });
  assert.deepEqual(calls, [
    ['list'],
    ['lock', 'INBOX'],
    ['search', { uid: '1:502', seen: false }, { uid: true }],
    ['flags-add', '11,207,501', ['\\Seen'], { uid: true }],
    ['release'],
  ]);
});

test('IMAP folder-wide mark as read skips STORE when no unread messages exist and rejects invalid targets', async () => {
  const calls = [];
  const service = createMutationTestService();
  service.client = {
    async list() {
      return [
        { path: 'INBOX', delimiter: '/', flags: new Set() },
        { path: 'Container', delimiter: '/', flags: new Set(['\\Noselect']) },
      ];
    },
    mailbox: null,
    async getMailboxLock(path) {
      calls.push(['lock', path]);
      this.mailbox = { uidNext: 8 };
      return { release: () => calls.push(['release']) };
    },
    async search() {
      calls.push(['search']);
      return [];
    },
    async messageFlagsAdd() {
      calls.push(['flags-add']);
    },
  };

  assert.deepEqual(await service.markFolderRead('INBOX'), {
    path: 'INBOX',
    marked: 0,
    maxUid: 7,
    markedUids: [],
  });
  assert.deepEqual(calls, [['lock', 'INBOX'], ['search'], ['release']]);
  await assert.rejects(
    () => service.markFolderRead('SCHEDULED'),
    error => error instanceof MailboxMutationError && error.code === 'VIRTUAL_FOLDER_UNSUPPORTED',
  );
  await assert.rejects(
    () => service.markFolderRead('Container'),
    error => error instanceof MailboxMutationError && error.code === 'INVALID_FOLDER',
  );
  await assert.rejects(
    () => service.markFolderRead('Missing'),
    error => error instanceof MailboxMutationError && error.code === 'FOLDER_NOT_FOUND',
  );
  await assert.rejects(
    () => service.markFolderRead('Bad\u0000Path'),
    error => error instanceof MailboxMutationError && error.code === 'INVALID_FOLDER',
  );
});

test('IMAP folder-wide mark as read stores only searched unread UIDs in bounded batches', async () => {
  const flagSequences = [];
  const service = createMutationTestService();
  service.client = {
    mailbox: null,
    async list() {
      return [{ path: 'Bulk', delimiter: '/', flags: new Set() }];
    },
    async getMailboxLock() {
      this.mailbox = { uidNext: 700 };
      return { release() {} };
    },
    async search() {
      return Array.from({ length: 501 }, (_, index) => index + 1);
    },
    async messageFlagsAdd(sequence) {
      flagSequences.push(sequence);
    },
  };

  assert.deepEqual(await service.markFolderRead('Bulk'), {
    path: 'Bulk',
    marked: 501,
    maxUid: 699,
    markedUids: Array.from({ length: 501 }, (_, index) => index + 1),
  });
  assert.equal(flagSequences.length, 2);
  assert.equal(flagSequences[0].split(',').length, 500);
  assert.equal(flagSequences[1], '501');
});

test('IMAP spam actions honor the server-designated special-use Junk folder', async () => {
  const calls = [];
  const service = createMutationTestService();
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

test('IMAP recoverable folder deletion moves a subscribed subtree beneath the designated Trash folder', async () => {
  const calls = [];
  const service = createMutationTestService();
  service.client = {
    async list() {
      return [
        { path: 'INBOX', delimiter: '.', specialUse: '\\Inbox' },
        { path: 'Projects', delimiter: '/', subscribed: true, status: { unseen: 4 } },
        { path: 'Projects/Travel', delimiter: '/', subscribed: true },
        { path: 'Deleted Messages', delimiter: '.', flags: new Set(['\\Trash']) },
        { path: 'Deleted Messages.Projects', delimiter: '.' },
      ];
    },
    async mailboxRename(path, destination) {
      calls.push(['rename', path, destination]);
      return { path, newPath: destination };
    },
    async mailboxDelete(path) { calls.push(['delete', path]); },
    async mailboxSubscribe(path) { calls.push(['subscribe', path]); return true; },
    async mailboxUnsubscribe(path) { calls.push(['unsubscribe', path]); return true; },
  };

  assert.deepEqual(await service.deleteFolder('Projects', false), {
    disposition: 'trashed',
    previousPath: 'Projects',
    folder: { path: 'Deleted Messages.Projects (2)', delimiter: '.', unseen: 4 },
  });
  assert.deepEqual(calls, [
    ['rename', 'Projects', 'Deleted Messages.Projects (2)'],
    ['subscribe', 'Deleted Messages.Projects (2)'],
    ['unsubscribe', 'Projects'],
    ['subscribe', 'Deleted Messages.Projects (2).Travel'],
    ['unsubscribe', 'Projects/Travel'],
  ]);
});

test('IMAP recoverable folder deletion reports subscription reconciliation failures after the move commits', async () => {
  let unsubscribeCalls = 0;
  const service = createMutationTestService();
  service.client = {
    async list() {
      return [
        { path: 'Projects', delimiter: '/', subscribed: true, status: { unseen: 1 } },
        { path: 'Trash', delimiter: '/', flags: new Set(['\\Trash']) },
      ];
    },
    async mailboxRename(_path, destination) {
      return { newPath: destination };
    },
    async mailboxSubscribe() {
      return false;
    },
    async mailboxUnsubscribe() {
      unsubscribeCalls += 1;
      return true;
    },
  };

  assert.deepEqual(await service.deleteFolder('Projects', false), {
    disposition: 'trashed',
    previousPath: 'Projects',
    folder: { path: 'Trash/Projects', delimiter: '/', unseen: 1 },
    warnings: ['SUBSCRIPTIONS_NOT_RECONCILED'],
  });
  assert.equal(unsubscribeCalls, 0, 'the old subscription remains when the new subscription is rejected');
});

test('IMAP recoverable folder deletion fails closed when a name becomes ambiguous beneath Trash', async () => {
  let folders = [
    { path: 'Reports.2026', delimiter: '/' },
    { path: 'Deleted Messages', delimiter: '.', flags: new Set(['\\Trash']) },
  ];
  const service = createMutationTestService();
  service.client = {
    async list() { return folders; },
    async mailboxRename() { throw new Error('mailboxRename must not be called'); },
  };

  await assert.rejects(
    () => service.deleteFolder('Reports.2026', false),
    error => error instanceof MailboxMutationError && error.code === 'FOLDER_NAME_INCOMPATIBLE',
  );

  folders = [
    { path: 'Reports', delimiter: '/' },
    { path: 'Reports/Client.2026', delimiter: '/' },
    { path: 'Deleted Messages', delimiter: '.', flags: new Set(['\\Trash']) },
  ];
  await assert.rejects(
    () => service.deleteFolder('Reports', false),
    error => error instanceof MailboxMutationError && error.code === 'FOLDER_NAME_INCOMPATIBLE',
  );
});

test('IMAP recoverable folder deletion fails closed without a usable Trash contract', async () => {
  const service = createMutationTestService();
  let folders = [
    { path: 'Projects', delimiter: '/' },
  ];
  service.client = {
    async list() { return folders; },
    async mailboxRename() { throw new Error('mailboxRename must not be called'); },
  };

  await assert.rejects(
    () => service.deleteFolder('Projects', false),
    error => error instanceof MailboxMutationError && error.code === 'TRASH_FOLDER_UNAVAILABLE',
  );
  await assert.rejects(
    () => service.deleteFolder('Projects', 'true'),
    error => error instanceof MailboxMutationError && error.code === 'INVALID_FOLDER_MUTATION',
  );

  folders = [
    { path: 'Projects', delimiter: '' },
    { path: 'Trash', delimiter: '.', flags: new Set(['\\Trash']) },
  ];
  await assert.rejects(
    () => service.deleteFolder('Projects', false),
    error => error instanceof MailboxMutationError && error.code === 'FOLDER_HIERARCHY_UNAVAILABLE',
  );

  folders = [
    { path: 'Projects', delimiter: '/' },
    { path: 'Trash', delimiter: '', flags: new Set(['\\Trash']) },
  ];
  await assert.rejects(
    () => service.deleteFolder('Projects', false),
    error => error instanceof MailboxMutationError && error.code === 'FOLDER_HIERARCHY_UNAVAILABLE',
  );
});

test('IMAP permanent folder deletion is limited to a leaf already beneath Trash', async () => {
  const calls = [];
  const service = createMutationTestService();
  service.client = {
    async list() {
      return [
        { path: 'INBOX', delimiter: '/', specialUse: '\\Inbox' },
        { path: 'Outside', delimiter: '/' },
        { path: 'Projects', delimiter: '/' },
        { path: 'Projects/Protected', delimiter: '/', flags: new Set(['\\Archive']) },
        { path: 'Deleted Messages', delimiter: '/', flags: new Set(['\\Trash']) },
        { path: 'Deleted Messages/Old', delimiter: '/', subscribed: true },
        { path: 'Deleted Messages/Tree', delimiter: '/' },
        { path: 'Deleted Messages/Tree/Child', delimiter: '/' },
      ];
    },
    async mailboxRename() { throw new Error('mailboxRename must not be called'); },
    async mailboxDelete(path) { calls.push(['delete', path]); return { path }; },
    async mailboxUnsubscribe(path) { calls.push(['unsubscribe', path]); return false; },
  };

  assert.deepEqual(await service.deleteFolder('Deleted Messages/Old', true), {
    disposition: 'deleted',
    deletedPath: 'Deleted Messages/Old',
    warnings: ['SUBSCRIPTIONS_NOT_RECONCILED'],
  });
  assert.deepEqual(calls, [
    ['delete', 'Deleted Messages/Old'],
    ['unsubscribe', 'Deleted Messages/Old'],
  ]);
  await assert.rejects(
    () => service.deleteFolder('Deleted Messages/Old', false),
    error => error instanceof MailboxMutationError && error.code === 'FOLDER_ALREADY_IN_TRASH',
  );
  await assert.rejects(
    () => service.deleteFolder('Outside', true),
    error => error instanceof MailboxMutationError && error.code === 'PERMANENT_DELETE_REQUIRES_TRASH',
  );
  await assert.rejects(
    () => service.deleteFolder('Deleted Messages/Tree', true),
    error => error instanceof MailboxMutationError && error.code === 'FOLDER_HAS_CHILDREN',
  );
  await assert.rejects(
    () => service.deleteFolder('INBOX', false),
    error => error instanceof MailboxMutationError && error.code === 'PROTECTED_FOLDER',
  );
  await assert.rejects(
    () => service.deleteFolder('Deleted Messages', false),
    error => error instanceof MailboxMutationError && error.code === 'PROTECTED_FOLDER',
  );
  await assert.rejects(
    () => service.deleteFolder('Missing', false),
    error => error instanceof MailboxMutationError && error.code === 'FOLDER_NOT_FOUND',
  );
  await assert.rejects(
    () => service.deleteFolder('Projects', false),
    error => error instanceof MailboxMutationError && error.code === 'PROTECTED_FOLDER',
  );
});

test('IMAP permanent folder deletion requires a matching Trash namespace contract', async () => {
  const service = createMutationTestService();
  service.client = {
    async list() {
      return [
        { path: 'Deleted Messages', delimiter: '.', flags: new Set(['\\Trash']) },
        { path: 'Deleted Messages.Project', delimiter: '/' },
      ];
    },
    async mailboxDelete() { throw new Error('mailboxDelete must not be called'); },
  };

  await assert.rejects(
    () => service.deleteFolder('Deleted Messages.Project', true),
    error => error instanceof MailboxMutationError && error.code === 'PERMANENT_DELETE_REQUIRES_TRASH',
  );
});

test('IMAP permanent folder deletion fails closed without server acknowledgement', async () => {
  const service = createMutationTestService();
  service.client = {
    async list() {
      return [
        { path: 'Trash', delimiter: '/', flags: new Set(['\\Trash']) },
        { path: 'Trash/Old', delimiter: '/' },
      ];
    },
    async mailboxDelete() { return undefined; },
    async mailboxUnsubscribe() { throw new Error('mailboxUnsubscribe must not be called'); },
  };

  await assert.rejects(
    () => service.deleteFolder('Trash/Old', true),
    error => error instanceof MailboxMutationError && error.code === 'FOLDER_DELETE_NOT_CONFIRMED',
  );
});
