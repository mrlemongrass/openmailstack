const test = require('node:test');
const assert = require('node:assert/strict');
process.env.OMS_DB_PASSWORD ||= 'junk-route-fixture';
const { pool } = require('../src/db.js');
let lockHeld = false;
let releaseLock;
let tail = Promise.resolve();
pool.getConnection = async () => ({
  async query(sql) {
    if (sql.includes('GET_LOCK')) {
      const previous = tail;
      tail = new Promise(resolve => { releaseLock = resolve; });
      const release = releaseLock;
      await previous;
      this.releaseOwned = release;
      assert.equal(lockHeld, false);
      lockHeld = true;
      return [[{ acquired: 1 }]];
    }
    lockHeld = false;
    this.releaseOwned();
    return [[{ released: 1 }]];
  }, release() {},
});
pool.execute = pool.query = async () => [[], []];
const { compileSieve, extractJsonFromSieve } = require('../src/sieve-compiler.js');
const { junkEntries, updateJunkRule } = require('../src/junk-rules.js');
const { evaluateRulesForMessage } = require('../src/rule-engine.js');
let documents, movements, failSave, failMove, sender, addresses, authUser;
const mock = (name, exports) => {
  const file = require.resolve('../src/' + name + '.js');
  require.cache[file] = { id: file, filename: file, loaded: true, exports };
};
mock('managesieve', { ManageSieveClient: class {
  async connect() {} async login(user) { this.user = user; }
  async getScript() { return compileSieve(documents[this.user] || { rules: [] }); }
  async putScript(_name, script) { if (failSave) throw new Error('sieve unavailable'); documents[this.user] = extractJsonFromSieve(script); }
  async setActive() {} async logout() {}
} });
const auth = require('../src/auth.js');
mock('auth', { ...auth, requireSession(req, _res, next) { req.user = { username: authUser, password: 'fixture-only' }; next(); } });
mock('imap-pool', { getImapConnection: async () => ({ async messageAction(folder, uids, action) { movements.push({ folder, uids, action, target: 'Junk' }); return { targetFolder: 'Junk' }; } }), withDedicatedImapConnection: async (user, _pass, operation) => operation({ client: {
  list: async () => [{ path: 'Junk', specialUse: '\\Junk' }],
  getMailboxLock: async path => ({ release() {} }),
  async *fetch(sequence, query, options) { assert.equal(options.uid, true); for (const uid of sequence.split(',').map(Number)) yield { uid, envelope: { from: addresses || [{ address: sender }] } }; },
  async messageMove(sequence, target, options) { if (failMove) throw new Error('move interrupted'); movements.push({ user, sequence, target, options }); return { uidMap: new Map([[4, 40]]) }; },
} }) });
const search = require('../src/search-index.js');
mock('search-index', { ...search, deleteMailSearchRows: async () => {}, invalidateSearchIndexSnapshot: async () => {} });
const oldInterval = global.setInterval;
global.setInterval = () => ({ unref() {} });
const { apiRouter } = require('../src/api.js');
global.setInterval = oldInterval;
const express = require('express');
const app = express(); app.use(express.json()); app.use('/api', apiRouter);
let server, origin;
test.before(async () => { server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve)); origin = 'http://127.0.0.1:' + server.address().port; });
test.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
test.beforeEach(() => { documents = {}; movements = []; failSave = false; failMove = false; sender = 'Alex@example.test'; addresses = null; authUser = 'reader@example.test'; });
async function request(path, body, method = 'POST') {
  const res = await fetch(origin + '/api' + path, { method, headers: { 'Content-Type': 'application/json' }, ...(method === 'GET' ? {} : { body: JSON.stringify(body) }) });
  return { status: res.status, body: await res.json() };
}
const spam = scope => request('/messages/action', { action: 'spam', folder: 'INBOX', uids: [4], junkScope: scope });
test('explicit choices are validated and sender is read from IMAP, not request text', async () => {
  assert.equal((await spam('invalid')).status, 400);
  assert.equal(movements.length, 0);
  assert.equal((await spam('sender')).status, 200);
  assert.deepEqual(junkEntries(documents[authUser]), [{ kind: 'sender', value: 'alex@example.test' }]);
  assert.equal(movements[0].target, 'Junk');
  assert.equal((await spam('sender')).status, 200);
  assert.equal(junkEntries(documents[authUser]).length, 1);
});
test('domain block is exact, before existing filters, preserved on stale rule save, and user scoped', async () => {
  documents[authUser] = { vacation: { enabled: true, body: 'Away' }, rules: [{ id: 'old', criteria: [{ field: 'subject', operator: 'contains', value: 'sale' }], actions: [{ type: 'move', folder: 'Ads' }] }] };
  assert.equal((await spam('domain')).status, 200);
  const doc = documents[authUser];
  assert.equal(doc.rules[0].name, 'User-marked Junk');
  assert.match(compileSieve(doc), /address :domain :is "From" "example.test"/);
  assert.deepEqual(evaluateRulesForMessage(doc.rules, { from: 'Other <other@example.test>', subject: 'sale', body: '' }).moveFolders, ['Junk']);
  assert.deepEqual(evaluateRulesForMessage(doc.rules, { from: 'Other <other@example.test.evil>', subject: '', body: '' }).moveFolders, []);
  assert.equal((await request('/rules', { rules: [], vacation: doc.vacation })).status, 200);
  assert.equal(junkEntries(documents[authUser]).length, 1);
  assert.equal(documents[authUser].vacation.body, 'Away');
  authUser = 'other@example.test';
  assert.deepEqual((await request('/rules/junk-list', null, 'GET')).body.entries, []);
});
test('Not junk removes both matching scopes, keeps unrelated blocks, and moves to Inbox', async () => {
  let doc = updateJunkRule({ rules: [] }, [sender, 'keep@other.test'], 'sender', 'Junk');
  documents[authUser] = updateJunkRule(doc, [sender], 'domain', 'Junk');
  const res = await request('/messages/action', { action: 'notspam', folder: 'Junk', uids: [4] });
  assert.equal(res.status, 200);
  assert.deepEqual(junkEntries(documents[authUser]), [{ kind: 'sender', value: 'keep@other.test' }]);
  assert.equal(movements[0].target, 'INBOX');
});
test('Sieve failure preserves message; move failure reports partial outcome; ambiguous sender creates no rule', async () => {
  failSave = true;
  assert.equal((await spam('sender')).status, 500);
  assert.equal(movements.length, 0);
  failSave = false; failMove = true;
  assert.match((await spam('sender')).body.error, /Junk list was updated/);
  assert.equal(junkEntries(documents[authUser]).length, 1);
  documents = {}; addresses = [{ address: 'a@one.test' }, { address: 'b@two.test' }];
  assert.equal((await spam('domain')).status, 500);
  assert.equal(documents[authUser], undefined);
});
test('simultaneous choices append without losing entries; explicit removal is scoped and retry safe', async () => {
  await Promise.all([spam('sender'), spam('domain')]);
  assert.equal(junkEntries(documents[authUser]).length, 2);
  const entry = { kind: 'domain', value: 'example.test' };
  assert.equal((await request('/rules/junk-list', entry, 'DELETE')).status, 200);
  assert.equal((await request('/rules/junk-list', entry, 'DELETE')).status, 200);
  assert.deepEqual(junkEntries(documents[authUser]), [{ kind: 'sender', value: 'alex@example.test' }]);
});

test('legacy spam callers retain move-only behavior without creating a sender or domain block', async () => {
  assert.equal((await spam()).status, 200);
  assert.equal(movements[0].action, 'spam');
  assert.equal(movements[0].target, 'Junk');
  assert.equal(documents[authUser], undefined);
});
