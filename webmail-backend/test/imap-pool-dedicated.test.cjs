const assert = require('node:assert/strict');
const test = require('node:test');

test('dedicated IMAP work never reuses the pooled client and always cleans up', async t => {
  const calls = [];
  let nextId = 0;
  const failConnectIds = new Set();
  const failLogoutIds = new Set();
  class FakeImapService {
    constructor(user, pass) {
      this.id = ++nextId;
      calls.push(['construct', this.id, user, pass]);
    }
    async connect() {
      calls.push(['connect', this.id]);
      if (failConnectIds.has(this.id)) throw new Error('connect failed');
    }
    async logout() {
      calls.push(['logout', this.id]);
      if (failLogoutIds.has(this.id)) throw new Error('logout failed');
    }
    close() { calls.push(['close', this.id]); }
  }

  const imapPath = require.resolve('../src/imap.js');
  const poolPath = require.resolve('../src/imap-pool.js');
  const priorImap = require.cache[imapPath];
  const priorPool = require.cache[poolPath];
  delete require.cache[poolPath];
  require.cache[imapPath] = {
    id: imapPath,
    filename: imapPath,
    loaded: true,
    exports: { ImapService: FakeImapService },
    children: [],
    paths: [],
  };
  t.after(() => {
    if (priorImap) require.cache[imapPath] = priorImap;
    else delete require.cache[imapPath];
    if (priorPool) require.cache[poolPath] = priorPool;
    else delete require.cache[poolPath];
  });

  const imapPool = require(poolPath);
  const pooled = await imapPool.getImapConnection('reader@example.test', 'secret');
  const result = await imapPool.withDedicatedImapConnection(
    'reader@example.test',
    'secret',
    async imap => {
      assert.notEqual(imap, pooled);
      calls.push(['operate', imap.id]);
      return 'done';
    },
  );

  assert.equal(result, 'done');
  assert.deepEqual(calls.slice(-4), [
    ['construct', 2, 'reader@example.test', 'secret'],
    ['connect', 2],
    ['operate', 2],
    ['logout', 2],
  ]);

  await assert.rejects(
    () => imapPool.withDedicatedImapConnection(
      'reader@example.test',
      'secret',
      async imap => {
        calls.push(['fail', imap.id]);
        throw new Error('operation failed');
      },
    ),
    /operation failed/,
  );
  assert.deepEqual(calls.slice(-4), [
    ['construct', 3, 'reader@example.test', 'secret'],
    ['connect', 3],
    ['fail', 3],
    ['logout', 3],
  ]);

  failConnectIds.add(4);
  await assert.rejects(
    () => imapPool.withDedicatedImapConnection('reader@example.test', 'secret', async () => 'unused'),
    /connect failed/,
  );
  assert.deepEqual(calls.slice(-3), [
    ['construct', 4, 'reader@example.test', 'secret'],
    ['connect', 4],
    ['close', 4],
  ]);

  failLogoutIds.add(5);
  assert.equal(
    await imapPool.withDedicatedImapConnection('reader@example.test', 'secret', async () => 'cleanup'),
    'cleanup',
  );
  assert.deepEqual(calls.slice(-4), [
    ['construct', 5, 'reader@example.test', 'secret'],
    ['connect', 5],
    ['logout', 5],
    ['close', 5],
  ]);

  await imapPool.closeAllConnections();
});
