const assert = require('node:assert/strict');
const test = require('node:test');

process.env.OMS_DB_PASSWORD ||= 'imap-mail-search-test';

const { ImapService } = require('../src/imap.js');

test('all-mail IMAP search chooses the newest matches across every folder', async () => {
  const folderMessages = {
    INBOX: [
      { uid: 1, date: '2026-07-18T12:00:00.000Z' },
      { uid: 2, date: '2026-07-19T12:00:00.000Z' },
    ],
    Projects: [{ uid: 20, date: '2026-07-20T12:00:00.000Z' }],
    Archive: [{ uid: 10, date: '2026-07-21T12:00:00.000Z' }],
  };
  let currentFolder = '';
  const searchedFolders = [];

  const service = Object.create(ImapService.prototype);
  service.client = {
    async mailboxOpen(folder) {
      currentFolder = folder;
      return { exists: folderMessages[folder].length };
    },
    async mailboxClose() {},
    async search() {
      searchedFolders.push(currentFolder);
      return folderMessages[currentFolder].map(message => message.uid);
    },
    async *fetch(uids, options) {
      const requested = new Set(Array.isArray(uids) ? uids : [uids]);
      for (const message of folderMessages[currentFolder]) {
        if (!requested.has(message.uid)) continue;
        yield {
          uid: message.uid,
          flags: new Set(),
          envelope: { date: new Date(message.date) },
          ...(options.source ? { source: Buffer.from(`Subject: Match ${message.uid}\r\n\r\nBody`) } : {}),
        };
      }
    },
  };

  const result = await service.searchMessages(
    ['INBOX', 'Projects', 'Archive'],
    'roadmap',
    'subject',
    2,
  );

  assert.deepEqual(searchedFolders, ['INBOX', 'Projects', 'Archive']);
  assert.deepEqual(
    result.messages.map(message => `${message.folder}:${message.uid}`),
    ['Archive:10', 'Projects:20'],
  );
  assert.deepEqual(result.failedFolders, []);
  assert.equal(result.messages.some(message => message.source), false);
});

test('live IMAP search translates every advertised query option', async () => {
  let currentFolder = '';
  const queries = [];
  const service = Object.create(ImapService.prototype);
  service.client = {
    async mailboxOpen(folder) { currentFolder = folder; return { exists: 0 }; },
    async mailboxClose() {},
    async search(query) { queries.push({ folder: currentFolder, query }); return []; },
    async *fetch() {},
  };

  await service.searchMessages(
    ['INBOX'],
    'has:attachment before:2026-07-21 after:2026-07-01 from:alice subject:roadmap',
    'all',
    10,
  );

  assert.equal(queries.length, 1);
  assert.equal(queries[0].query.from, 'alice');
  assert.equal(queries[0].query.subject, 'roadmap');
  assert.equal(new Date(queries[0].query.sentBefore).toISOString(), '2026-07-21T00:00:00.000Z');
  assert.equal(new Date(queries[0].query.sentSince).toISOString(), '2026-07-01T00:00:00.000Z');
  assert.deepEqual(queries[0].query.or, [
    { body: 'Content-Disposition: attachment' },
    { body: 'filename=' },
  ]);
});

test('live IMAP search reports a folder failure instead of silently returning a complete-looking result', async () => {
  let currentFolder = '';
  const service = Object.create(ImapService.prototype);
  service.client = {
    async mailboxOpen(folder) {
      currentFolder = folder;
      if (folder === 'Broken') throw new Error('folder unavailable');
      return { exists: 0 };
    },
    async mailboxClose() {},
    async search() { return currentFolder === 'INBOX' ? [] : false; },
    async *fetch() {},
  };

  const result = await service.searchMessages(['INBOX', 'Broken'], 'roadmap', 'subject', 10);
  assert.deepEqual(result.messages, []);
  assert.deepEqual(result.failedFolders, ['Broken']);
});

test('bulk move sends every selected UID to the chosen destination folder', async () => {
  const calls = [];
  const service = Object.create(ImapService.prototype);
  service.client = {
    async mailboxOpen(folder) { calls.push({ type: 'open', folder }); },
    async mailboxClose() { calls.push({ type: 'close' }); },
    async messageMove(sequence, targetFolder, options) {
      calls.push({ type: 'move', sequence, targetFolder, options });
      return { uidMap: new Map([[41, 141], [42, 142]]) };
    },
  };

  const result = await service.messageAction('INBOX', [41, 42], 'move', 'Projects/2026');

  assert.deepEqual(calls, [
    { type: 'open', folder: 'INBOX' },
    { type: 'move', sequence: '41,42', targetFolder: 'Projects/2026', options: { uid: true } },
    { type: 'close' },
  ]);
  assert.equal(result.targetFolder, 'Projects/2026');
  assert.deepEqual(result.uidMap, { 41: 141, 42: 142 });
});
