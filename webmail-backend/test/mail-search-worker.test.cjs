const assert = require('node:assert/strict');
const test = require('node:test');

const username = 'worker@example.test';
const dbEvents = [];
const deletedRows = [];
let pageMoreAvailable = false;
let reconciliationFails = false;
let imapInstances = 0;
let connectGate = null;
let connectStarted = null;

const dbPath = require.resolve('../src/db.js');
require.cache[dbPath] = {
  id: dbPath,
  filename: dbPath,
  loaded: true,
  exports: {
    pool: {
      async query(sql, params = []) {
        const text = String(sql).replace(/\s+/g, ' ').trim();
        if (text.startsWith('DELETE FROM mail_search_user_state')) dbEvents.push('snapshot-invalidated');
        if (text.startsWith('INSERT INTO mail_search_user_state')) dbEvents.push('snapshot-saved');
        if (text.startsWith('SHOW COLUMNS')) return [[{ Field: 'uid_validity' }], []];
        if (text.includes('FROM webmail_sessions')) {
          return [[{
            username,
            password_ciphertext: 'ciphertext',
            password_iv: 'iv',
            password_tag: 'tag',
          }], []];
        }
        if (text.startsWith('SELECT uid_validity')) {
          return [[{
            uid_validity: '1',
            last_uid_indexed: 11,
            last_full_sync_at: null,
            message_count: 2,
            indexed_count: 2,
          }], []];
        }
        if (text.startsWith('SELECT COUNT(*)')) return [[{ cnt: 2 }], []];
        if (text.startsWith('SELECT uid FROM mail_search_index')) {
          return [[{ uid: 10 }, { uid: 11 }], []];
        }
        return [[], []];
      },
    },
  },
  children: [],
  paths: [],
};

const authPath = require.resolve('../src/auth.js');
require.cache[authPath] = {
  id: authPath,
  filename: authPath,
  loaded: true,
  exports: { decryptPassword: () => 'password' },
  children: [],
  paths: [],
};

const searchIndexPath = require.resolve('../src/search-index.js');
require.cache[searchIndexPath] = {
  id: searchIndexPath,
  filename: searchIndexPath,
  loaded: true,
  exports: {
    ensureMailSearchSchema: async () => {},
    upsertMailSearchRows: async () => 0,
    deleteMailSearchRows: async (user, folder, uids) => {
      deletedRows.push({ user, folder, uids });
      dbEvents.push('stale-row-deleted');
    },
  },
  children: [],
  paths: [],
};

class FakeImapService {
  constructor() {
    imapInstances += 1;
    this.client = {
      mailboxOpen: async () => ({ exists: 1 }),
      mailboxClose: async () => {},
      search: async () => {
        if (reconciliationFails) throw new Error('reconciliation failed');
        return [10];
      },
    };
  }

  async connect() {
    connectStarted?.();
    if (connectGate) await connectGate;
  }

  async logout() {}

  async getSearchFolderSnapshot() {
    return {
      folderPaths: ['INBOX'],
      uidNextByFolder: new Map([['INBOX', 12]]),
      uidValidityByFolder: new Map([['INBOX', '1']]),
      failedFolders: [],
    };
  }

  async getMessagesSinceUid() {
    return { messages: [], moreAvailable: pageMoreAvailable };
  }
}

const imapPath = require.resolve('../src/imap.js');
require.cache[imapPath] = {
  id: imapPath,
  filename: imapPath,
  loaded: true,
  exports: { ImapService: FakeImapService },
  children: [],
  paths: [],
};

const { runSearchIndexer } = require('../src/search-worker.js');

const reset = () => {
  dbEvents.length = 0;
  deletedRows.length = 0;
  pageMoreAvailable = false;
  reconciliationFails = false;
  imapInstances = 0;
  connectGate = null;
  connectStarted = null;
};

test('worker invalidates the old snapshot and reconciles deletions before certifying a new one', async () => {
  reset();

  await runSearchIndexer();

  assert.deepEqual(deletedRows, [{ user: username, folder: 'INBOX', uids: [11] }]);
  assert.ok(dbEvents.indexOf('snapshot-invalidated') < dbEvents.indexOf('stale-row-deleted'));
  assert.ok(dbEvents.indexOf('stale-row-deleted') < dbEvents.indexOf('snapshot-saved'));
});

test('an incomplete or failed worker cycle removes the previous snapshot without replacing it', async () => {
  reset();
  pageMoreAvailable = true;
  reconciliationFails = true;

  await runSearchIndexer();

  assert.deepEqual(dbEvents.filter(event => event === 'snapshot-invalidated'), ['snapshot-invalidated']);
  assert.equal(dbEvents.includes('snapshot-saved'), false);
});

test('a second scheduler tick does not overlap an active indexing cycle', async () => {
  reset();
  let releaseConnect;
  connectGate = new Promise(resolve => { releaseConnect = resolve; });
  const started = new Promise(resolve => { connectStarted = resolve; });

  const firstCycle = runSearchIndexer();
  await started;
  await runSearchIndexer();

  assert.equal(imapInstances, 1);
  releaseConnect();
  await firstCycle;
});
