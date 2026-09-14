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
let legacySettings = { spam: { blockedSenders: [], safeSenders: [] } };
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
const userSettings = require('../src/user-settings.js');
mock('user-settings', { ...userSettings, getUserSettings: async () => legacySettings });
const oldInterval = global.setInterval;
global.setInterval = () => ({ unref() {} });
const { apiRouter } = require('../src/api.js');
global.setInterval = oldInterval;
const express = require('express');
const app = express(); app.use(express.json()); app.use('/api', apiRouter);
let server, origin;
test.before(async () => { server = app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve)); origin = 'http://127.0.0.1:' + server.address().port; });
test.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
test.beforeEach(() => { legacySettings = { spam: { blockedSenders: [], safeSenders: [] } }; documents = {}; movements = []; failSave = false; failMove = false; sender = 'Alex@example.test'; addresses = null; authUser = 'reader@example.test'; });
async function request(path, body, method = 'POST') {
  const res = await fetch(origin + '/api' + path, { method, headers: { 'Content-Type': 'application/json' }, ...(method === 'GET' ? {} : { body: JSON.stringify(body) }) });
  return { status: res.status, body: await res.json() };
}
const spam = scope => request('/messages/action', { action: 'spam', folder: 'INBOX', uids: [4], junkScope: scope });
test('message rule saves preserve other rules, reject stale edits and reconcile retries', async () => {
  const rule = { id: 'receipt', name: 'Receipts', enabled: true, condition: 'all', criteria: [{ field: 'from_address', operator: 'is_one_of', value: 'a@example.test, b@example.test' }, { field: 'subject', operator: 'contains', value: 'receipt' }], actions: [{ type: 'move', folder: 'Receipts' }] };
  documents[authUser] = { rules: [{ ...rule, id: 'other' }], vacation: { enabled: true, body: 'Away' } };
  assert.equal((await request('/rules/one', { rule })).status, 200);
  assert.deepEqual(documents[authUser].rules.map(item => item.id), ['other', 'receipt']);
  assert.equal(documents[authUser].vacation.body, 'Away');
  assert.equal((await request('/rules/one', { rule })).status, 200);
  assert.equal(documents[authUser].rules.length, 2);
  const updated = { ...rule, name: 'Updated receipts' };
  assert.equal((await request('/rules/one', { rule: updated, previous: rule })).status, 200);
  assert.equal((await request('/rules/one', { rule: { ...rule, name: 'Stale' }, previous: rule })).status, 409);
  assert.equal(documents[authUser].rules[1].name, 'Updated receipts');
  failSave = true;
  assert.equal((await request('/rules/one', { rule: { ...updated, name: 'Failed' }, previous: updated })).status, 503);
  assert.equal(documents[authUser].rules[1].name, 'Updated receipts');
  for (const from of ['a@example.test', 'Person <b@example.test>']) {
    assert.deepEqual(evaluateRulesForMessage([rule], { uid: 1, from, subject: 'receipt 123' }).matchedRuleIds, ['receipt']);
    assert.deepEqual(evaluateRulesForMessage([rule], { uid: 1, from, subject: 'Unrelated' }).matchedRuleIds, []);
  }
  assert.deepEqual(evaluateRulesForMessage([rule], { uid: 1, from: 'b@example.test.evil.test', subject: 'receipt' }).matchedRuleIds, []);
  assert.match(compileSieve({ rules: [rule] }), /address :all :is "From" \["a@example.test", "b@example.test"\]/);
});
test('message rule save rejects managed-policy overwrite and malformed address lists', async () => {
  const rule = { id: 'new', criteria: [{ field: 'from_address', operator: 'is_one_of', value: 'a@example.test, invalid' }], actions: [{ type: 'move', folder: 'Work' }] };
  assert.equal((await request('/rules/one', { rule })).status, 400);
  rule.criteria[0].value = 'a@example.test'; rule.id = 'oms-user-marked-junk';
  assert.equal((await request('/rules/one', { rule })).status, 400);
  assert.deepEqual(documents, {});
});
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

test('active sender policy round-trips through API and Sieve, with specific sender precedence', async () => {
  const put=entry=>request('/rules/sender-policy',entry,'PUT');
  assert.equal((await put({kind:'domain',value:'example.test',disposition:'block'})).status,200);
  assert.equal((await put({kind:'sender',value:'alex@example.test',disposition:'safe'})).status,200);
  const doc=documents[authUser];
  assert.deepEqual(evaluateRulesForMessage(doc.rules,{from:'alex@example.test'}).moveFolders,[]);
  assert.deepEqual(evaluateRulesForMessage(doc.rules,{from:'other@example.test'}).moveFolders,['Junk']);
  assert.equal((await request('/rules/sender-policy',null,'GET')).body.entries.length,2);
  assert.equal((await request('/rules',{rules:[]})).status,200);
  assert.equal((await request('/rules/sender-policy',null,'GET')).body.entries.length,2);
  assert.equal((await put({kind:'domain',value:'example.test',disposition:'safe'})).status,200);
  assert.equal((await put({kind:'sender',value:'alex@example.test',disposition:'block'})).status,200);
  assert.deepEqual(evaluateRulesForMessage(documents[authUser].rules,{from:'alex@example.test'}).moveFolders,['Junk']);
  assert.deepEqual(evaluateRulesForMessage(documents[authUser].rules,{from:'other@example.test'}).moveFolders,[]);
  const removal={kind:'sender',value:'alex@example.test',disposition:'block'};
  assert.equal((await request('/rules/sender-policy',removal,'DELETE')).status,200);
  assert.equal((await request('/rules/sender-policy',removal,'DELETE')).status,200);
  assert.deepEqual(evaluateRulesForMessage(documents[authUser].rules,{from:'alex@example.test'}).moveFolders,[]);
});

test('legacy sender entries require selected, confirmed activation; invalid and conflicting choices are retained', async () => {
  legacySettings={spam:{blockedSenders:['@example.test','bad*value'],safeSenders:['alex@example.test']}};
  const before=await request('/rules/sender-policy',null,'GET');
  assert.deepEqual(before.body.entries,[]);
  assert.equal(before.body.legacy[1].entry,null);
  const entries=before.body.legacy.flatMap(item=>item.entry?[item.entry]:[]);
  assert.equal((await request('/rules/sender-policy',{entries})).status,400);
  assert.equal((await request('/rules/sender-policy',{entries,confirm:true})).status,200);
  assert.equal((await request('/rules/sender-policy',null,'GET')).body.entries.length,2);
  assert.equal(legacySettings.spam.blockedSenders.length,2);
  assert.equal((await request('/rules/sender-policy',{entries:[{kind:'sender',value:'stranger@else.test',disposition:'block'}],confirm:true})).status,503);
  assert.equal((await request('/rules/sender-policy',{kind:'domain',value:'*.example.test',disposition:'block'},'PUT')).status,400);
  assert.equal((await request('/rules/sender-policy',{entries:[entries[0],{...entries[0],disposition:'safe'}],confirm:true})).status,400);
  authUser='another@example.test';
  assert.deepEqual((await request('/rules/sender-policy',null,'GET')).body.entries,[]);
});

test('safe exceptions preserve ordinary filters, avoid display-name lookalikes, and survive failed writes', async () => {
  documents[authUser]={rules:[{id:'work',condition:'any',criteria:[{field:'subject',operator:'contains',value:'work'}],actions:[{type:'move',folder:'Work'}]}]};
  await request('/rules/sender-policy',{kind:'domain',value:'example.test',disposition:'block'},'PUT');
  await request('/rules/sender-policy',{kind:'sender',value:'alex@example.test',disposition:'safe'},'PUT');
  assert.deepEqual(evaluateRulesForMessage(documents[authUser].rules,{from:'Alex <alex@example.test>',subject:'work'}).moveFolders,['Work']);
  assert.deepEqual(evaluateRulesForMessage(documents[authUser].rules,{from:'"alex@example.test" <other@example.test>',subject:'work'}).moveFolders,['Junk']);
  const before=JSON.stringify(documents[authUser]);failSave=true;
  assert.equal((await request('/rules/sender-policy',{kind:'sender',value:'alex@example.test',disposition:'safe'},'DELETE')).status,503);
  assert.equal(JSON.stringify(documents[authUser]),before);
  failSave=false;
  assert.equal((await spam('sender')).status,200);
  assert.deepEqual(evaluateRulesForMessage(documents[authUser].rules,{from:'alex@example.test',subject:'work'}).moveFolders,['Junk']);
});

test('compilation with many blocks and exceptions grows linearly', () => {
  const doc=updateJunkRule({rules:[]},[], 'sender','Junk');
  doc.rules[0].criteria=Array.from({length:400},(_,i)=>({field:'from_domain',operator:'equals',value:'blocked'+i+'.test'}));
  doc.rules[0].exceptions=Array.from({length:400},(_,i)=>({field:'from_address',operator:'equals',value:'safe'+i+'@blocked0.test'}));
  assert.ok(compileSieve(doc).length < 250000);
  const parsed=extractJsonFromSieve(compileSieve(doc));
  assert.equal(parsed.rules[0].exceptions.length,400);
});
