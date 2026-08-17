const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const test = require('node:test');

process.env.OMS_DB_PASSWORD ||= 'outbound-compaction-guard-test';

test('outbound compaction is disabled by default and performs no database work', async () => {
  const { outboundCompactionMode } = require('../src/config.js');
  const { compactUniversalOutbox } = require('../src/universal-outbox.js');
  let databaseCalls = 0;
  const result = await compactUniversalOutbox({
    async query() {
      databaseCalls += 1;
      throw new Error('disabled compaction must not touch the database');
    },
  }, { mode: outboundCompactionMode, batchSize: 100 });

  assert.equal(outboundCompactionMode, 'disabled');
  assert.deepEqual(result, { payloadsPurged: 0, hotRowsRemoved: 0, tombstonesRemoved: 0 });
  assert.equal(databaseCalls, 0);
});

test('outbound compaction configuration fails closed on an unknown value', () => {
  const configPath = path.join(__dirname, '..', 'src', 'config.js');
  const result = spawnSync(process.execPath, ['-e', `require(${JSON.stringify(configPath)})`], {
    encoding: 'utf8',
    env: {
      ...process.env,
      OMS_DB_PASSWORD: 'outbound-compaction-invalid-test',
      OMS_OUTBOUND_COMPACTION_MODE: 'enabled',
    },
  });

  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}${result.stderr}`,
    /OMS_OUTBOUND_COMPACTION_MODE must be disabled or registry-verified-v1/);
});
