const assert = require('node:assert/strict');
const test = require('node:test');

process.env.OMS_DB_PASSWORD ||= 'imap-mail-search-test';

const { ImapService } = require('../src/imap.js');

test('folder listings request unseen counts through LIST-STATUS', async () => {
  const calls = [];
  const service = Object.create(ImapService.prototype);
  service.client = {
    async list(options) {
      calls.push(options);
      return [{ path: 'INBOX', delimiter: '/', status: { unseen: 7 } }];
    },
  };

  const folders = await service.getFolders();

  assert.deepEqual(calls, [{ statusQuery: { unseen: true } }]);
  assert.deepEqual(folders, [{ path: 'INBOX', delimiter: '/', unseen: 7 }]);
});

test('search snapshots collect UID state in one LIST-STATUS request', async () => {
  const calls = [];
  const service = Object.create(ImapService.prototype);
  service.client = {
    async list(options) {
      calls.push(options);
      return [
        { path: 'INBOX', flags: new Set(), status: { uidNext: 42, uidValidity: 9n } },
        { path: 'Virtual', flags: new Set(['\\Noselect']), status: {} },
        { path: 'Broken', flags: new Set(), status: { uidNext: 0 } },
      ];
    },
  };

  const snapshot = await service.getSearchFolderSnapshot();

  assert.deepEqual(calls, [{ statusQuery: { uidNext: true, uidValidity: true } }]);
  assert.deepEqual(snapshot.folderPaths, ['INBOX', 'Broken']);
  assert.equal(snapshot.uidNextByFolder.get('INBOX'), 42);
  assert.equal(snapshot.uidValidityByFolder.get('INBOX'), '9');
  assert.deepEqual(snapshot.failedFolders, ['Broken']);
});

test('incremental indexing reports when another UID page remains', async () => {
  const fetched = [];
  const service = Object.create(ImapService.prototype);
  service.client = {
    async mailboxOpen() {},
    async mailboxClose() {},
    async search() { return [10, 11, 12]; },
    async *fetch(uids) {
      fetched.push(uids);
      for (const uid of uids) {
        yield { uid, flags: new Set(), envelope: {}, source: Buffer.from('') };
      }
    },
  };

  const page = await service.getMessagesSinceUid('INBOX', 10, 2);

  assert.deepEqual(fetched, [[10, 11]]);
  assert.deepEqual(page.messages.map(message => message.uid), [10, 11]);
  assert.equal(page.moreAvailable, true);
});

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

test('live IMAP search does not open a folder after its request is cancelled', async () => {
  const opened = [];
  const service = Object.create(ImapService.prototype);
  service.client = {
    async mailboxOpen(folder) { opened.push(folder); },
    async mailboxClose() {},
    async search() { return []; },
    async *fetch() {},
  };

  const result = await service.searchMessages(
    ['INBOX', 'Archive'],
    'roadmap',
    'subject',
    10,
    () => true,
  );

  assert.deepEqual(opened, []);
  assert.deepEqual(result.messages, []);
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

test('rule runs page through a stable folder UID snapshot', async () => {
  const calls = [];
  const service = Object.create(ImapService.prototype);
  service.client = {
    async mailboxOpen(folder) {
      calls.push({ type: 'open', folder });
      return { uidNext: 51, uidValidity: 9001n };
    },
    async mailboxClose() { calls.push({ type: 'close' }); },
    async search(query, options) {
      calls.push({ type: 'search', query, options });
      return [11, 12, 20];
    },
    async *fetch(uids, query, options) {
      calls.push({ type: 'fetch', uids, query, options });
      for (const uid of uids) {
        yield { uid, envelope: { subject: `Message ${uid}` }, size: 100 };
      }
    },
  };

  const page = await service.getRuleRunBatch('INBOX', 10, undefined, 2, false);

  assert.equal(page.maxUid, 50);
  assert.equal(page.uidValidity, '9001');
  assert.equal(page.nextCursor, 12);
  assert.equal(page.done, false);
  assert.deepEqual(page.messages.map(message => message.uid), [11, 12]);
  assert.deepEqual(calls[1], {
    type: 'search',
    query: { uid: '11:50' },
    options: { uid: true },
  });
  assert.equal(calls[2].query.source, undefined);
});

test('rule-run paging bounds each IMAP search window in sparse large mailboxes', async () => {
  const searches = [];
  const service = Object.create(ImapService.prototype);
  service.client = {
    async mailboxOpen() { return { uidNext: 100001 }; },
    async mailboxClose() {},
    async search(query) {
      searches.push(query);
      return [];
    },
    async *fetch() {},
  };

  const page = await service.getRuleRunBatch('INBOX', 10, undefined, 2, false);

  assert.deepEqual(searches, [{ uid: '11:210' }]);
  assert.equal(page.nextCursor, 210);
  assert.equal(page.maxUid, 100000);
  assert.equal(page.done, false);
});

test('manual rule moves batch continued copies and final moves by destination', async () => {
  const calls = [];
  const sourceUids = new Set([41, 42, 43]);
  const completedCopies = new Set();
  const service = Object.create(ImapService.prototype);
  service.client = {
    async mailboxOpen(folder) { calls.push({ type: 'open', folder }); },
    async mailboxClose() {},
    async search(query) {
      if (query.uid) {
        return String(query.uid).split(',').map(Number).filter(uid => sourceUids.has(uid));
      }
      return [];
    },
    async messageCopy(sequence, targetFolder, options) {
      calls.push({ type: 'copy', sequence, targetFolder, options });
      return { destination: targetFolder };
    },
    async messageMove(sequence, targetFolder, options) {
      calls.push({ type: 'move', sequence, targetFolder, options });
      String(sequence).split(',').map(Number).forEach(uid => sourceUids.delete(uid));
      return { destination: targetFolder };
    },
  };
  const ledger = {
    async pendingForSourceUids() { return []; },
    async reserve(actions) {
      return {
        token: 'reservation-1',
        ready: new Set(actions.map(action => action.actionKey)),
        completed: new Set(),
        blocked: new Set(),
      };
    },
    async complete(actions) {
      actions.forEach(action => completedCopies.add(action.actionKey));
    },
    async clear() {},
  };

  const result = await service.applyRuleMoves('INBOX', [
    { uid: 41, moveFolders: ['Finance'] },
    { uid: 42, moveFolders: ['Finance', 'Ads'] },
    { uid: 43, moveFolders: ['INBOX', 'Finance'] },
  ], 'test-operation', ledger);

  assert.deepEqual(calls, [
    { type: 'open', folder: 'INBOX' },
    { type: 'copy', sequence: '42', targetFolder: 'Finance', options: { uid: true } },
    { type: 'move', sequence: '41,43', targetFolder: 'Finance', options: { uid: true } },
    { type: 'move', sequence: '42', targetFolder: 'Ads', options: { uid: true } },
  ]);
  assert.equal(completedCopies.size, 1);
  assert.deepEqual(result, {
    affected: 3,
    copied: 1,
    moved: 3,
    movedUids: [41, 43, 42],
  });
});

test('continued rule copies are idempotent when a later move is retried', async () => {
  const sourceUids = new Set([42]);
  const completedCopies = new Set();
  let copyCalls = 0;
  let failMove = true;
  const service = Object.create(ImapService.prototype);
  service.client = {
    async mailboxOpen() {},
    async mailboxClose() {},
    async search(query) {
      if (query.uid) return String(query.uid).split(',').map(Number).filter(uid => sourceUids.has(uid));
      return [];
    },
    async messageCopy() {
      copyCalls += 1;
      return { destination: 'Finance' };
    },
    async messageMove(uid, targetFolder) {
      if (failMove) {
        failMove = false;
        throw new Error('temporary move failure');
      }
      String(uid).split(',').map(Number).forEach(sourceUid => sourceUids.delete(sourceUid));
      return { destination: targetFolder };
    },
  };
  const ledger = {
    async pendingForSourceUids() { return []; },
    async reserve(actions) {
      return {
        token: 'reservation',
        ready: new Set(actions.filter(action => !completedCopies.has(action.actionKey)).map(action => action.actionKey)),
        completed: new Set(actions.filter(action => completedCopies.has(action.actionKey)).map(action => action.actionKey)),
        blocked: new Set(),
      };
    },
    async complete(actions) {
      actions.forEach(action => completedCopies.add(action.actionKey));
    },
    async clear() {},
  };
  const plans = [{ uid: 42, moveFolders: ['Finance', 'Ads'] }];

  await assert.rejects(
    service.applyRuleMoves('INBOX', plans, 'stable-operation', ledger),
    /Apply again to reconcile safely/,
  );
  const retry = await service.applyRuleMoves('INBOX', plans, 'stable-operation', ledger);

  assert.equal(copyCalls, 1);
  assert.deepEqual(retry, {
    affected: 1,
    copied: 1,
    moved: 1,
    movedUids: [42],
  });
});

test('continued rule copies refuse an ambiguous pending retry instead of duplicating mail', async () => {
  let copyCalls = 0;
  const service = Object.create(ImapService.prototype);
  service.client = {
    async mailboxOpen() {},
    async mailboxClose() {},
    async search() { return [42]; },
    async messageCopy() { copyCalls += 1; return {}; },
    async messageMove() { return {}; },
  };
  const ledger = {
    async pendingForSourceUids() { return []; },
    async reserve(actions) {
      return {
        token: 'new-reservation',
        ready: new Set(),
        completed: new Set(),
        blocked: new Set(actions.map(action => action.actionKey)),
      };
    },
    async complete() {},
    async clear() {},
  };

  await assert.rejects(
    service.applyRuleMoves(
      'INBOX',
      [{ uid: 42, moveFolders: ['Finance', 'Ads'] }],
      'stable-operation',
      ledger,
    ),
    error => {
      assert.match(error.message, /not repeated to prevent duplicate mail/);
      assert.equal(error.result.affected, 1);
      return true;
    },
  );
  assert.equal(copyCalls, 0);
});

test('an older pending copy blocks a rule edited down to one final Move', async () => {
  let moveCalls = 0;
  const pending = {
    actionKey: 'a'.repeat(64),
    operationKey: 'b'.repeat(32),
    uid: 42,
    destination: 'Finance',
  };
  const service = Object.create(ImapService.prototype);
  service.client = {
    async mailboxOpen() {},
    async mailboxClose() {},
    async search() { return [42]; },
    async messageMove() { moveCalls += 1; return {}; },
  };
  const ledger = {
    async pendingForSourceUids() { return [pending]; },
    async reserve() { throw new Error('reserve should not run'); },
    async complete() {},
    async clear() {},
  };

  await assert.rejects(
    service.applyRuleMoves(
      'INBOX',
      [{ uid: 42, moveFolders: ['Ads'] }],
      'stable-operation',
      ledger,
    ),
    error => {
      assert.equal(error.retrySafe, false);
      assert.deepEqual(error.pendingCopies, [pending]);
      return true;
    },
  );
  assert.equal(moveCalls, 0);
});

test('continued destinations reserve only the copy group being attempted', async () => {
  const states = new Map();
  const reservations = [];
  let copyCalls = 0;
  const service = Object.create(ImapService.prototype);
  service.client = {
    async mailboxOpen() {},
    async mailboxClose() {},
    async search() { return [42]; },
    async messageCopy() {
      copyCalls += 1;
      if (copyCalls === 2) throw new Error('second destination interrupted');
      return {};
    },
  };
  const ledger = {
    async pendingForSourceUids() { return []; },
    async reserve(actions) {
      reservations.push(actions.map(action => action.destination));
      actions.forEach(action => states.set(action.actionKey, 'pending'));
      return {
        token: `group-${reservations.length}`,
        ready: new Set(actions.map(action => action.actionKey)),
        completed: new Set(),
        blocked: new Set(),
        pending: [],
      };
    },
    async complete(actions) {
      actions.forEach(action => states.set(action.actionKey, 'completed'));
    },
    async clear() {},
  };

  await assert.rejects(
    service.applyRuleMoves(
      'INBOX',
      [{ uid: 42, moveFolders: ['Finance', 'Statements', 'Ads'] }],
      'stable-operation',
      ledger,
    ),
    error => {
      assert.equal(error.retrySafe, false);
      assert.deepEqual(error.pendingCopies.map(copy => copy.destination), ['Statements']);
      return true;
    },
  );
  assert.deepEqual(reservations, [['Finance'], ['Statements']]);
  assert.deepEqual([...states.values()].sort(), ['completed', 'pending']);
});

test('a failed copy remains pending instead of being retried ambiguously', async () => {
  const service = Object.create(ImapService.prototype);
  service.client = {
    async mailboxOpen() {},
    async mailboxClose() {},
    async search() { return [42]; },
    async messageCopy() { throw new Error('connection lost after COPY'); },
  };
  let completed = false;
  const ledger = {
    async pendingForSourceUids() { return []; },
    async reserve(actions) {
      return {
        token: 'copy-failure',
        ready: new Set(actions.map(action => action.actionKey)),
        completed: new Set(),
        blocked: new Set(),
      };
    },
    async complete() { completed = true; },
    async clear() {},
  };

  await assert.rejects(
    service.applyRuleMoves(
      'INBOX',
      [{ uid: 42, moveFolders: ['Finance', 'Ads'] }],
      'stable-operation',
      ledger,
    ),
    error => {
      assert.match(error.message, /not repeated to prevent duplicate mail/);
      assert.equal(error.result.affected, 1);
      return true;
    },
  );
  assert.equal(completed, false);
});

test('a partial grouped move reconciles source UIDs before reporting failure', async () => {
  const sourceUids = new Set([41, 42]);
  const service = Object.create(ImapService.prototype);
  service.client = {
    async mailboxOpen() {},
    async mailboxClose() {},
    async search(query) {
      return String(query.uid).split(',').map(Number).filter(uid => sourceUids.has(uid));
    },
    async messageMove() {
      sourceUids.delete(41);
      throw new Error('connection lost during MOVE');
    },
  };
  const ledger = {
    async pendingForSourceUids() { return []; },
    async reserve() {
      return {
        token: 'move-failure',
        ready: new Set(),
        completed: new Set(),
        blocked: new Set(),
      };
    },
    async complete() {},
    async clear() {},
  };

  await assert.rejects(
    service.applyRuleMoves(
      'INBOX',
      [
        { uid: 41, moveFolders: ['Finance'] },
        { uid: 42, moveFolders: ['Finance'] },
      ],
      'stable-operation',
      ledger,
    ),
    error => {
      assert.match(error.message, /Apply again to reconcile safely/);
      assert.equal(error.result.affected, 1);
      assert.equal(error.result.moved, 1);
      assert.deepEqual(error.result.movedUids, [41]);
      return true;
    },
  );
});

test('mailbox-close failures preserve completed move reconciliation', async () => {
  const service = Object.create(ImapService.prototype);
  service.client = {
    async mailboxOpen() {},
    async mailboxClose() { throw new Error('close failed'); },
    async search() { return [41]; },
    async messageMove() { return {}; },
  };
  const ledger = {
    async pendingForSourceUids() { return []; },
    async reserve() {
      return {
        token: 'close-failure',
        ready: new Set(),
        completed: new Set(),
        blocked: new Set(),
      };
    },
    async complete() {},
    async clear() {},
  };

  await assert.rejects(
    service.applyRuleMoves(
      'INBOX',
      [{ uid: 41, moveFolders: ['Finance'] }],
      'stable-operation',
      ledger,
    ),
    error => {
      assert.equal(error.result.affected, 1);
      assert.equal(error.result.moved, 1);
      assert.deepEqual(error.result.movedUids, [41]);
      return true;
    },
  );
});
