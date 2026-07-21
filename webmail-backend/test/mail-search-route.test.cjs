const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');

process.env.OMS_DB_PASSWORD ||= 'mail-search-route-test';

const user = 'search-route@example.test';
const searchCalls = [];
const existingUidCalls = [];
const deletedIndexRows = [];
let indexedMessages = [];
let liveMessages = [];
let missingUidKeys = new Set();
let currentFlags = new Map();
let indexedThrough = new Map();
let uidNextByFolder = new Map();
let indexedUidValidity = new Map();
let currentUidValidity = new Map();
let failedFolders = [];
const invalidatedFolderIdentities = [];

const rawMessage = ({ subject, messageId, date }) => Buffer.from([
  'From: Sender <sender@example.test>',
  'To: Search User <search-route@example.test>',
  `Subject: ${subject}`,
  `Date: ${date}`,
  `Message-ID: <${messageId}>`,
  'Content-Type: text/plain; charset=utf-8',
  '',
  `${subject} preview`,
].join('\r\n'));

const fakeImap = {
  async searchMessages(folderPaths, query, field, limit) {
    searchCalls.push({ folderPaths, query, field, limit });
    return { messages: liveMessages, failedFolders, partialFolders: [] };
  },
  async getExistingUidStates(folder, uids) {
    existingUidCalls.push({ folder, uids });
    return uids
      .filter(uid => !missingUidKeys.has(`${folder}:${uid}`))
      .map(uid => ({ uid, flags: currentFlags.get(`${folder}:${uid}`) || [] }));
  },
  async getFolderUidNext(folderPaths) {
    return {
      uidNextByFolder: new Map(folderPaths.map(folder => [folder, uidNextByFolder.get(folder) || 1])),
      uidValidityByFolder: new Map(folderPaths.map(folder => [folder, currentUidValidity.get(folder) || '1'])),
      failedFolders: [],
    };
  },
  async getFolders() {
    return [{ path: 'INBOX' }, { path: 'Projects' }, { path: 'Archive' }];
  },
};

const authPath = require.resolve('../src/auth.js');
const auth = require(authPath);
require.cache[authPath].exports = {
  ...auth,
  requireSession: (req, _res, next) => {
    req.user = { username: user, password: 'test-only', isAdmin: false };
    next();
  },
};

const searchIndexPath = require.resolve('../src/search-index.js');
const searchIndex = require(searchIndexPath);
searchIndex.searchMailIndex = async () => indexedMessages;
searchIndex.deleteMailSearchRows = async (username, folder, uids) => {
  deletedIndexRows.push({ username, folder, uids });
};
searchIndex.upsertMailSearchRows = async () => 0;

const searchWorkerPath = require.resolve('../src/search-worker.js');
const searchWorker = require(searchWorkerPath);
searchWorker.getSearchIndexCoverage = async (_username, folders) => new Map(
  folders.map(folder => [folder, {
    lastUidIndexed: indexedThrough.get(folder) || 0,
    uidValidity: indexedUidValidity.get(folder) || '1',
  }]),
);
searchWorker.invalidateSearchIndexFolderIdentity = async (username, folder, uidValidity) => {
  invalidatedFolderIdentities.push({ username, folder, uidValidity });
};

const imapPoolPath = require.resolve('../src/imap-pool.js');
require.cache[imapPoolPath] = {
  id: imapPoolPath,
  filename: imapPoolPath,
  loaded: true,
  exports: { getImapConnection: async () => fakeImap },
  children: [],
  paths: [],
};

const originalSetInterval = global.setInterval;
global.setInterval = () => ({ unref() {} });
const { apiRouter } = require('../src/api.js');
global.setInterval = originalSetInterval;

const request = (port, path) => new Promise((resolve, reject) => {
  const req = http.request({ hostname: '127.0.0.1', port, path }, response => {
    const chunks = [];
    response.on('data', chunk => chunks.push(chunk));
    response.on('end', () => resolve({
      status: response.statusCode,
      json: JSON.parse(Buffer.concat(chunks).toString('utf8')),
    }));
  });
  req.on('error', reject);
  req.end();
});

test('folder search merges live matches and removes moved or deleted index rows', async t => {
  indexedMessages = [
    {
      folder: 'Projects', uid: 101, messageId: 'indexed-valid@example.test',
      subject: 'Quarterly plan indexed', from: 'sender@example.test', to: user,
      date: '2026-07-19T12:00:00.000Z', preview: 'indexed valid',
    },
    {
      folder: 'Projects', uid: 102, messageId: 'indexed-stale@example.test',
      subject: 'Quarterly plan moved', from: 'sender@example.test', to: user,
      date: '2026-07-20T12:00:00.000Z', preview: 'stale source row',
    },
  ];
  liveMessages = [{
    folder: 'Projects',
    uid: 103,
    flags: [],
    envelope: {
      subject: 'Quarterly plan live', date: new Date('2026-07-21T12:00:00.000Z'),
      from: [{ name: 'Sender', address: 'sender@example.test' }], to: [{ address: user }],
      messageId: '<live@example.test>',
    },
    source: rawMessage({
      subject: 'Quarterly plan live',
      messageId: 'live@example.test',
      date: 'Tue, 21 Jul 2026 12:00:00 +0000',
    }),
  }];
  missingUidKeys = new Set(['Projects:102']);
  currentFlags = new Map();
  indexedThrough = new Map([['Projects', 0]]);
  uidNextByFolder = new Map([['Projects', 104]]);
  indexedUidValidity = new Map([['Projects', '1']]);
  currentUidValidity = new Map([['Projects', '1']]);
  failedFolders = [];
  invalidatedFolderIdentities.length = 0;
  searchCalls.length = 0;
  existingUidCalls.length = 0;
  deletedIndexRows.length = 0;

  const express = require('express');
  const app = express();
  app.use('/api', apiRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const response = await request(
    server.address().port,
    '/api/messages/search?q=quarterly&field=subject&scope=folder&folder=Projects&limit=50',
  );

  assert.equal(response.status, 200);
  assert.equal(response.json.source, 'hybrid');
  assert.deepEqual(
    response.json.messages.map(message => `${message.folder}:${message.uid}`),
    ['Projects:103', 'Projects:101'],
  );
  assert.deepEqual(searchCalls, [{
    folderPaths: ['Projects'], query: 'quarterly', field: 'subject', limit: 50,
  }]);
  assert.deepEqual(existingUidCalls, [{ folder: 'Projects', uids: [101, 102] }]);
  assert.deepEqual(deletedIndexRows, [{ username: user, folder: 'Projects', uids: [102] }]);
});

test('all-mail search replaces moved source rows and purges removed-folder rows', async t => {
  indexedMessages = [
    {
      folder: 'Removed', uid: 201, messageId: 'removed-folder@example.test',
      subject: 'Roadmap in removed folder', from: 'sender@example.test', to: user,
      date: '2026-07-21T13:00:00.000Z', preview: 'must not be returned',
    },
    {
      folder: 'Projects', uid: 202, messageId: 'moved-source@example.test',
      subject: 'Roadmap before move', from: 'sender@example.test', to: user,
      date: '2026-07-21T11:00:00.000Z', preview: 'stale source folder',
    },
  ];
  liveMessages = [
    {
      folder: 'INBOX', uid: 301, flags: [],
      envelope: {
        subject: 'Roadmap inbox', date: new Date('2026-07-20T12:00:00.000Z'),
        from: [{ name: 'Sender', address: 'sender@example.test' }], to: [{ address: user }],
        messageId: '<inbox@example.test>',
      },
      source: rawMessage({
        subject: 'Roadmap inbox', messageId: 'inbox@example.test',
        date: 'Mon, 20 Jul 2026 12:00:00 +0000',
      }),
    },
    {
      folder: 'Archive', uid: 302, flags: ['\\Seen'],
      envelope: {
        subject: 'Roadmap archive', date: new Date('2026-07-21T12:00:00.000Z'),
        from: [{ name: 'Sender', address: 'sender@example.test' }], to: [{ address: user }],
        messageId: '<archive@example.test>',
      },
      source: rawMessage({
        subject: 'Roadmap archive', messageId: 'archive@example.test',
        date: 'Tue, 21 Jul 2026 12:00:00 +0000',
      }),
    },
  ];
  missingUidKeys = new Set(['Projects:202']);
  currentFlags = new Map();
  indexedThrough = new Map([['INBOX', 0], ['Projects', 0], ['Archive', 0]]);
  uidNextByFolder = new Map([['INBOX', 302], ['Projects', 203], ['Archive', 303]]);
  indexedUidValidity = new Map([['INBOX', '1'], ['Projects', '1'], ['Archive', '1']]);
  currentUidValidity = new Map([['INBOX', '1'], ['Projects', '1'], ['Archive', '1']]);
  failedFolders = [];
  invalidatedFolderIdentities.length = 0;
  searchCalls.length = 0;
  existingUidCalls.length = 0;
  deletedIndexRows.length = 0;

  const express = require('express');
  const app = express();
  app.use('/api', apiRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const response = await request(
    server.address().port,
    '/api/messages/search?q=roadmap&field=all&scope=all&limit=50',
  );

  assert.equal(response.status, 200);
  assert.equal(response.json.source, 'imap');
  assert.deepEqual(
    response.json.messages.map(message => `${message.folder}:${message.uid}`),
    ['Archive:302', 'INBOX:301'],
  );
  assert.deepEqual(searchCalls, [{
    folderPaths: ['INBOX', 'Projects', 'Archive'], query: 'roadmap', field: 'all', limit: 50,
  }]);
  assert.deepEqual(existingUidCalls, [{ folder: 'Projects', uids: [202] }]);
  assert.deepEqual(deletedIndexRows, [
    { username: user, folder: 'Removed', uids: [201] },
    { username: user, folder: 'Projects', uids: [202] },
  ]);
});

test('all-mail search live-searches only folders whose index coverage is incomplete', async t => {
  indexedMessages = [{
    folder: 'Projects', uid: 401, messageId: 'complete-folder@example.test',
    subject: 'Quarterly plan indexed', from: 'sender@example.test', to: user,
    date: '2026-07-20T12:00:00.000Z', preview: 'complete folder result',
    isRead: false, isStarred: false,
  }];
  liveMessages = [{
    folder: 'Archive', uid: 502, flags: [],
    envelope: {
      subject: 'Quarterly plan archived', date: new Date('2026-07-21T12:00:00.000Z'),
      from: [{ address: 'sender@example.test' }], to: [{ address: user }],
      messageId: '<incomplete-folder@example.test>',
    },
  }];
  missingUidKeys = new Set();
  currentFlags = new Map([['Projects:401', []]]);
  indexedThrough = new Map([['INBOX', 300], ['Projects', 401], ['Archive', 500]]);
  uidNextByFolder = new Map([['INBOX', 301], ['Projects', 402], ['Archive', 503]]);
  indexedUidValidity = new Map([['INBOX', '1'], ['Projects', '1'], ['Archive', '1']]);
  currentUidValidity = new Map([['INBOX', '1'], ['Projects', '1'], ['Archive', '1']]);
  failedFolders = [];
  invalidatedFolderIdentities.length = 0;
  searchCalls.length = 0;
  existingUidCalls.length = 0;
  deletedIndexRows.length = 0;

  const express = require('express');
  const app = express();
  app.use('/api', apiRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const response = await request(
    server.address().port,
    '/api/messages/search?q=quarterly&field=subject&scope=all&limit=50',
  );

  assert.equal(response.status, 200);
  assert.equal(response.json.source, 'hybrid');
  assert.deepEqual(
    response.json.messages.map(message => `${message.folder}:${message.uid}`),
    ['Archive:502', 'Projects:401'],
  );
  assert.deepEqual(searchCalls, [{
    folderPaths: ['Archive'], query: 'quarterly', field: 'subject', limit: 50,
  }]);
});

test('a complete index avoids a live full-folder search while refreshing current flags', async t => {
  indexedMessages = [{
    folder: 'Projects', uid: 401, messageId: 'complete@example.test',
    subject: 'Complete indexed roadmap', from: 'sender@example.test', to: user,
    date: '2026-07-21T12:00:00.000Z', preview: 'indexed preview',
    isRead: false, isStarred: false,
  }];
  liveMessages = [];
  missingUidKeys = new Set();
  currentFlags = new Map([['Projects:401', ['\\Seen', '\\Flagged']]]);
  indexedThrough = new Map([['Projects', 401]]);
  uidNextByFolder = new Map([['Projects', 402]]);
  indexedUidValidity = new Map([['Projects', '1']]);
  currentUidValidity = new Map([['Projects', '1']]);
  failedFolders = [];
  invalidatedFolderIdentities.length = 0;
  searchCalls.length = 0;
  existingUidCalls.length = 0;
  deletedIndexRows.length = 0;

  const express = require('express');
  const app = express();
  app.use('/api', apiRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const response = await request(
    server.address().port,
    '/api/messages/search?q=roadmap&field=subject&scope=folder&folder=Projects&limit=50',
  );

  assert.equal(response.status, 200);
  assert.equal(response.json.source, 'index');
  assert.equal(response.json.messages[0].isRead, true);
  assert.equal(response.json.messages[0].isStarred, true);
  assert.deepEqual(searchCalls, []);
});

test('flag-only search excludes stale indexed flags and uses live IMAP matches', async t => {
  indexedMessages = [{
    folder: 'INBOX', uid: 501, subject: 'Now read', from: 'sender@example.test', to: user,
    date: '2026-07-21T12:00:00.000Z', preview: 'stale unread', isRead: false, isStarred: false,
  }];
  liveMessages = [{
    folder: 'INBOX', uid: 502, flags: [],
    envelope: {
      subject: 'Actually unread', date: new Date('2026-07-21T13:00:00.000Z'),
      from: [{ name: 'Sender', address: 'sender@example.test' }],
      to: [{ address: user }], messageId: '<unread@example.test>',
    },
  }];
  missingUidKeys = new Set();
  currentFlags = new Map([['INBOX:501', ['\\Seen']]]);
  indexedThrough = new Map([['INBOX', 501]]);
  uidNextByFolder = new Map([['INBOX', 503]]);
  indexedUidValidity = new Map([['INBOX', '1']]);
  currentUidValidity = new Map([['INBOX', '1']]);
  failedFolders = [];
  invalidatedFolderIdentities.length = 0;
  searchCalls.length = 0;
  existingUidCalls.length = 0;
  deletedIndexRows.length = 0;

  const express = require('express');
  const app = express();
  app.use('/api', apiRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const response = await request(
    server.address().port,
    '/api/messages/search?q=&field=unread&scope=folder&folder=INBOX&limit=50',
  );

  assert.equal(response.status, 200);
  assert.deepEqual(response.json.messages.map(message => message.uid), [502]);
  assert.equal(searchCalls.length, 1);
});

test('all-mail mutable-flag search still reconciles every folder with live IMAP', async t => {
  indexedMessages = [];
  liveMessages = [{
    folder: 'INBOX', uid: 801, flags: [],
    envelope: {
      subject: 'Unread from live state', date: new Date('2026-07-21T13:00:00.000Z'),
      from: [{ address: 'sender@example.test' }], to: [{ address: user }],
      messageId: '<live-unread@example.test>',
    },
  }];
  missingUidKeys = new Set();
  currentFlags = new Map();
  indexedThrough = new Map([['INBOX', 801], ['Projects', 601], ['Archive', 701]]);
  uidNextByFolder = new Map([['INBOX', 802], ['Projects', 602], ['Archive', 702]]);
  indexedUidValidity = new Map([['INBOX', '1'], ['Projects', '1'], ['Archive', '1']]);
  currentUidValidity = new Map([['INBOX', '1'], ['Projects', '1'], ['Archive', '1']]);
  failedFolders = [];
  invalidatedFolderIdentities.length = 0;
  searchCalls.length = 0;
  existingUidCalls.length = 0;
  deletedIndexRows.length = 0;

  const express = require('express');
  const app = express();
  app.use('/api', apiRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const response = await request(
    server.address().port,
    '/api/messages/search?q=&field=unread&scope=all&limit=50',
  );

  assert.equal(response.status, 200);
  assert.deepEqual(searchCalls, [{
    folderPaths: ['INBOX', 'Projects', 'Archive'], query: '', field: 'unread', limit: 50,
  }]);
  assert.deepEqual(response.json.messages.map(message => message.uid), [801]);
});

test('attachment-name search rejects a body-text false positive from live IMAP', async t => {
  const attachmentSource = Buffer.from([
    'From: Sender <sender@example.test>',
    `To: ${user}`,
    'Subject: Attached invoice',
    'Date: Tue, 21 Jul 2026 14:00:00 +0000',
    'Message-ID: <attachment@example.test>',
    'Content-Type: multipart/mixed; boundary="oms-test"',
    '',
    '--oms-test',
    'Content-Type: text/plain; charset=utf-8',
    '',
    'Please see the file.',
    '--oms-test',
    'Content-Type: application/pdf',
    'Content-Disposition: attachment; filename="invoice.pdf"',
    'Content-Transfer-Encoding: base64',
    '',
    'JVBERi0xLjQ=',
    '--oms-test--',
  ].join('\r\n'));
  const bodyOnlySource = rawMessage({
    subject: 'Invoice mentioned only in body',
    messageId: 'body-only@example.test',
    date: 'Tue, 21 Jul 2026 13:00:00 +0000',
  });
  indexedMessages = [];
  liveMessages = [
    {
      folder: 'INBOX', uid: 601, flags: [], source: attachmentSource,
      envelope: { subject: 'Attached invoice', date: new Date('2026-07-21T14:00:00.000Z') },
    },
    {
      folder: 'INBOX', uid: 602, flags: [], source: bodyOnlySource,
      envelope: { subject: 'Invoice mentioned only in body', date: new Date('2026-07-21T13:00:00.000Z') },
    },
  ];
  missingUidKeys = new Set();
  currentFlags = new Map();
  indexedThrough = new Map([['INBOX', 0]]);
  uidNextByFolder = new Map([['INBOX', 603]]);
  indexedUidValidity = new Map([['INBOX', '1']]);
  currentUidValidity = new Map([['INBOX', '1']]);
  failedFolders = [];
  invalidatedFolderIdentities.length = 0;
  searchCalls.length = 0;

  const express = require('express');
  const app = express();
  app.use('/api', apiRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const response = await request(
    server.address().port,
    '/api/messages/search?q=invoice&field=attachments&scope=folder&folder=INBOX&limit=50',
  );

  assert.equal(response.status, 200);
  assert.deepEqual(response.json.messages.map(message => message.uid), [601]);
});

test('UIDVALIDITY reset purges reused UID rows and returns the new live identity', async t => {
  indexedMessages = [{
    folder: 'INBOX', uid: 701, messageId: 'old-generation@example.test',
    subject: 'Old generation result', from: 'old@example.test', to: user,
    date: '2026-07-20T12:00:00.000Z', preview: 'stale reused UID',
    isRead: false, isStarred: false,
  }];
  liveMessages = [{
    folder: 'INBOX', uid: 701, flags: [],
    envelope: {
      subject: 'New generation result', date: new Date('2026-07-21T15:00:00.000Z'),
      from: [{ address: 'new@example.test' }], to: [{ address: user }],
      messageId: '<new-generation@example.test>',
    },
  }];
  missingUidKeys = new Set();
  currentFlags = new Map([['INBOX:701', []]]);
  indexedThrough = new Map([['INBOX', 701]]);
  uidNextByFolder = new Map([['INBOX', 702]]);
  indexedUidValidity = new Map([['INBOX', '100']]);
  currentUidValidity = new Map([['INBOX', '200']]);
  failedFolders = [];
  searchCalls.length = 0;
  invalidatedFolderIdentities.length = 0;

  const express = require('express');
  const app = express();
  app.use('/api', apiRouter);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));

  const response = await request(
    server.address().port,
    '/api/messages/search?q=generation&field=subject&scope=folder&folder=INBOX&limit=50',
  );

  assert.equal(response.status, 200);
  assert.equal(response.json.source, 'imap');
  assert.deepEqual(response.json.messages.map(message => message.subject), ['New generation result']);
  assert.deepEqual(invalidatedFolderIdentities, [{ username: user, folder: 'INBOX', uidValidity: '200' }]);
});
