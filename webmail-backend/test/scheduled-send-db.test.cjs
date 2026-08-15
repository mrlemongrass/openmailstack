const assert = require('node:assert/strict');
const test = require('node:test');

process.env.OMS_DB_PASSWORD ||= 'scheduled-send-db-test';

test('scheduled send additive migration and atomic claim on disposable MariaDB', {
  skip: process.env.OMS_SCHEDULED_SEND_DB_TEST !== '1',
}, async t => {
  const databaseName = String(process.env.OMS_DB_NAME || 'postfixadmin');
  assert.match(databaseName, /(^|[_-])(test|ci|tmp|disposable)([_-]|$)/i,
    'OMS_SCHEDULED_SEND_DB_TEST requires OMS_DB_NAME to identify an isolated disposable database');

  const { pool } = require('../src/db.js');
  const {
    MySqlScheduledEmailStore,
    cancelScheduledEmail,
    ensureScheduledEmailsSchema,
  } = require('../src/scheduled-send.js');
  t.after(async () => {
    await pool.query('DROP TABLE IF EXISTS scheduled_emails');
    await pool.end();
  });

  await pool.query('DROP TABLE IF EXISTS scheduled_emails');
  await pool.query(`
    CREATE TABLE scheduled_emails (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      username VARCHAR(255) NOT NULL,
      send_at DATETIME NOT NULL,
      mail_options MEDIUMTEXT NOT NULL,
      draft_uid BIGINT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      KEY idx_send_at (send_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  const [insert] = await pool.query(
    `INSERT INTO scheduled_emails (username, send_at, mail_options, draft_uid)
     VALUES ('owner@example.test', DATE_SUB(UTC_TIMESTAMP(), INTERVAL 1 SECOND),
             '{"from":"owner@example.test","to":"recipient@example.net","text":"legacy"}', NULL)`,
  );
  await ensureScheduledEmailsSchema(pool);

  const [migrated] = await pool.query(
    `SELECT payload_version, status, available_at, sender_address, raw_message, smtp_accepted_at
     FROM scheduled_emails WHERE id = ?`,
    [insert.insertId],
  );
  assert.equal(Number(migrated[0].payload_version), 1);
  assert.equal(migrated[0].status, 'scheduled');
  assert.equal(migrated[0].sender_address, 'owner@example.test');
  assert.ok(migrated[0].available_at);
  assert.equal(migrated[0].raw_message, null);
  assert.equal(migrated[0].smtp_accepted_at, null);

  const firstStore = new MySqlScheduledEmailStore(pool);
  const secondStore = new MySqlScheduledEmailStore(pool);
  const [firstClaims, secondClaims] = await Promise.all([
    firstStore.claimBatch('db-worker-one', 1),
    secondStore.claimBatch('db-worker-two', 1),
  ]);
  assert.equal(firstClaims.length + secondClaims.length, 1);
  const claimed = firstClaims[0] || secondClaims[0];
  assert.equal(claimed.status, 'claimed');
  assert.equal(Number(claimed.attempts), 1);

  assert.equal(await cancelScheduledEmail(pool, insert.insertId, 'owner@example.test'), 'conflict');
  const [retained] = await pool.query('SELECT status, attempts FROM scheduled_emails WHERE id = ?', [insert.insertId]);
  assert.equal(retained[0].status, 'claimed');
  assert.equal(Number(retained[0].attempts), 1);
});
