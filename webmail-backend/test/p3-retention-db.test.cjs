const test = require('node:test');
const assert = require('node:assert/strict');
let dbPool;
test.after(async () => { if (dbPool) await dbPool.end(); });

test('opt-in retention preserves grace, identities, owner boundaries, cancellation and uncertain writes', { skip: process.env.OMS_P3_DB_TEST !== '1' }, async t => {
  assert.match(process.env.OMS_DB_NAME || '', /^oms_p3_[a-f0-9]+$/);
  const { pool } = require('../src/db.js');
  dbPool = pool;
  const retention = require('../src/mail-retention.js');
  await pool.query("CREATE TABLE IF NOT EXISTS mailbox (username VARCHAR(255) CHARACTER SET latin1 COLLATE latin1_general_ci PRIMARY KEY, active TINYINT NOT NULL DEFAULT 1) ENGINE=InnoDB");
  await pool.query("INSERT IGNORE INTO mailbox (username) VALUES ('retention@example.test'),('stranger@example.test'),('one@example.test'),('two@example.test')");
  await retention.ensureMailRetentionSchema();
  const owner = 'retention@example.test';
  let selected = 'Junk', validity = '77', afterWrite = async () => {}, loseAck = false;
  const messages = { Junk: new Set([1, 2]), Trash: new Set([10]) };
  const writes = [];
  const client = {
    capabilities: new Set(['UIDPLUS']),
    list: async () => ['Junk', 'Trash'].map(path => ({ path, specialUse: `\\${path}`, flags: new Set() })),
    getMailboxLock: async path => { selected = path; return { release() {} }; },
    get mailbox() { return { uidValidity: validity, exists: messages[selected].size }; },
    search: async query => query.uid ? query.uid.split(',').map(Number).filter(uid => messages[selected].has(uid)) : [...messages[selected]],
    messageDelete: async range => {
      const uids = range.split(',').map(Number); writes.push({ action: 'delete', uids }); uids.forEach(uid => messages.Trash.delete(uid));
      await afterWrite(); if (loseAck) throw new Error('lost ack'); return true;
    },
    messageMove: async range => {
      const uids = range.split(',').map(Number); writes.push({ action: 'move', uids }); uids.forEach(uid => { messages.Junk.delete(uid); messages.Trash.add(1000 + uid); });
      await afterWrite(); if (loseAck) throw new Error('lost ack'); return {};
    },
  };
  const dedicated = async (_owner, _password, work) => work({ client });
  const policy = async () => (await pool.query('SELECT * FROM mail_retention WHERE owner = ?', [owner]))[0][0];
  const due = () => pool.query('UPDATE mail_retention SET next_run = DATE_SUB(NOW(), INTERVAL 1 SECOND) WHERE owner = ?', [owner]);
  const age = () => pool.query('UPDATE mail_retention_seen SET first_seen = DATE_SUB(NOW(), INTERVAL 31 DAY) WHERE owner = ?', [owner]);
  const enable = async () => {
    const preview = await retention.previewRetention(owner, '', { junk: 7, trash: 30 }, dedicated);
    await retention.enableRetention(owner, preview.token, true);
    return preview;
  };
  await retention.runRetentionForOwner(owner, '', dedicated); assert.equal(writes.length, 0);
  const preview = await retention.previewRetention(owner, '', { junk: 7, trash: 30 }, dedicated);
  assert.equal(preview.folders.reduce((n, f) => n + f.total, 0), 3); assert.equal((await policy()).enabled, 0);
  await assert.rejects(retention.enableRetention('stranger@example.test', preview.token, true), /preview/);
  await assert.rejects(retention.enableRetention(owner, preview.token, false), /confirm/);
  await retention.enableRetention(owner, preview.token, true);
  await assert.rejects(retention.enableRetention(owner, preview.token, true), /preview/);
  await due(); await retention.runRetentionForOwner(owner, '', dedicated); assert.equal(writes.length, 0, 'existing messages receive grace');
  await age(); messages.Junk.add(3); await due(); await retention.runRetentionForOwner(owner, '', dedicated);
  assert.deepEqual(writes, [{ action: 'delete', uids: [10] }, { action: 'move', uids: [1, 2] }]);
  assert.deepEqual([...messages.Junk], [3], 'new arrival receives grace'); assert.deepEqual([...messages.Trash], [1001, 1002]);
  await due(); await retention.runRetentionForOwner(owner, '', dedicated); assert.equal(writes.length, 2, 'moved Junk has fresh Trash grace');
  await retention.disableRetention(owner); await age(); await due(); await retention.runRetentionForOwner(owner, '', dedicated); assert.equal(writes.length, 2);
  await enable(); await due(); await retention.runRetentionForOwner(owner, '', dedicated); assert.equal(writes.length, 2, 're-enabling resets grace');
  await age(); validity = '78'; await due(); await retention.runRetentionForOwner(owner, '', dedicated); assert.equal(writes.length, 2); assert.equal((await policy()).status, 'needs_review');
  validity = '77'; await enable(); await due(); await retention.runRetentionForOwner(owner, '', dedicated); await age();
  loseAck = true; await due(); await retention.runRetentionForOwner(owner, '', dedicated);
  const afterUncertain = writes.length; assert.equal((await policy()).enabled, 0); await due(); await retention.runRetentionForOwner(owner, '', dedicated); assert.equal(writes.length, afterUncertain, 'uncertain operations never auto-replay');
  loseAck = false; messages.Trash = new Set(Array.from({ length: 205 }, (_, i) => i + 3000)); messages.Junk.clear();
  await enable(); await due(); await retention.runRetentionForOwner(owner, '', dedicated); await age();
  afterWrite = () => retention.disableRetention(owner); await due(); await retention.runRetentionForOwner(owner, '', dedicated);
  assert.equal(messages.Trash.size, 105, 'disable cancels after one 100-message batch'); assert.equal((await policy()).status, 'off');
  const [runs] = await pool.query('SELECT * FROM mail_retention_runs WHERE owner = ?', [owner]);
  assert.ok(runs.some(run => run.state === 'cancelled' && run.deleted === 100)); assert.ok(runs.some(run => run.state === 'uncertain'));
  afterWrite = async () => {}; await enable(); await pool.query("UPDATE mail_retention SET status='running',next_run=NOW() WHERE owner=?", [owner]);
  await retention.runRetentionForOwner(owner, '', dedicated); assert.equal((await policy()).status, 'needs_review');
  // Queue account deletion while an IMAP batch holds the account shared lock.
  // Progress must commit on that same connection, allowing deletion to finish.
  messages.Trash = new Set(Array.from({ length: 205 }, (_, i) => i + 6000));
  await enable(); await due(); await retention.runRetentionForOwner(owner, '', dedicated); await age();
  let deletion;
  afterWrite = async () => {
    deletion = pool.query('DELETE FROM mailbox WHERE username = ?', [owner]);
    await new Promise(resolve => setTimeout(resolve, 40));
  };
  await due(); await retention.runRetentionForOwner(owner, '', dedicated); await deletion;
  assert.equal(messages.Trash.size, 105, 'account deletion stops before the next batch');
  await pool.query('INSERT INTO mailbox (username) VALUES (?)', [owner]);
  assert.equal(await policy(), undefined, 'recreated account has no inherited consent');
  for (const table of ['mail_retention_seen', 'mail_retention_runs']) {
    assert.equal((await pool.query(`SELECT COUNT(*) AS total FROM ${table} WHERE owner = ?`, [owner]))[0][0].total, 0);
  }
  const beforeRecreated = writes.length;
  await retention.runRetentionForOwner(owner, '', dedicated);
  assert.equal(writes.length, beforeRecreated);
  // Deletion before the next fresh history/observation insert cannot inherit consent.
  await enable(); await pool.query('DELETE FROM mailbox WHERE username = ?', [owner]);
  await pool.query('INSERT INTO mailbox (username) VALUES (?)', [owner]);
  await retention.runRetentionForOwner(owner, '', dedicated);
  assert.equal(writes.length, beforeRecreated);
  client.capabilities.clear(); await assert.rejects(retention.previewRetention(owner, '', { junk: 7, trash: 0 }, dedicated), /UIDPLUS/);
});

test('activity history is owner-scoped and persists only fixed labels', { skip: process.env.OMS_P3_DB_TEST !== '1' }, async t => {
  const { pool } = require('../src/db.js');
  dbPool = pool;
  const { ensureUserActivitySchema, listUserActivity } = require('../src/user-activity.js');
  await ensureUserActivitySchema();
  await pool.query("INSERT INTO user_activity (id,owner,area,action,state,recovery_path) VALUES ('one','one@example.test','Mail','Message action','completed','/mail/inbox'),('two','two@example.test','Notes','Note change','failed','/notes')");
  const rows = await listUserActivity('one@example.test'); assert.equal(rows.length, 1); assert.equal(rows[0].id, 'one');
  assert.deepEqual(await listUserActivity('nobody@example.test'), []);
  await pool.query("DELETE FROM mailbox WHERE username = 'one@example.test'");
  await pool.query("INSERT INTO mailbox (username) VALUES ('one@example.test')");
  assert.deepEqual(await listUserActivity('one@example.test'), [], 'history cascades on account deletion');
});
