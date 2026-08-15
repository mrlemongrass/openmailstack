const test = require('node:test');
const assert = require('node:assert/strict');

process.env.OMS_DB_PASSWORD ||= 'unit-test-password';
if (process.env.OMS_TEST_TYPESCRIPT_SOURCE === '1') {
  process.env.TS_NODE_COMPILER_OPTIONS ||= JSON.stringify({
    module: 'CommonJS',
    moduleResolution: 'node',
    ignoreDeprecations: '6.0',
  });
  require('ts-node/register/transpile-only');
}

const sourceExtension = process.env.OMS_TEST_TYPESCRIPT_SOURCE === '1' ? '.ts' : '.js';
const {
  loadMailSyncState,
  mailSyncScopeHash,
  MailSyncStateError,
  MAX_MAIL_SYNC_KNOWN_ITEMS_BYTES,
  saveMailSyncState,
  withMailSyncScopeLock,
} = require(`../src/eas-mail-sync${sourceExtension}`);
const { pool } = require('../src/db.js');

const username = 'storage-safety@example.test';
const deviceId = 'device-storage-safety';
const collectionId = 'SU5CT1g=';
const scopeHash = mailSyncScopeHash(username, deviceId, collectionId);

const validMetadata = (overrides = {}) => ({
  scope_hash: scopeHash,
  username,
  device_id: deviceId,
  collection_id: collectionId,
  current_sync_key: `oms-mail-${'a'.repeat(48)}`,
  previous_sync_key: null,
  uid_validity: '10',
  highest_modseq: '20',
  minimum_uid: 1,
  filter_type: 0,
  window_size: 100,
  body_type: 1,
  truncation_size: 500,
  last_more_available: 0,
  last_request_hash: null,
  updated_at: new Date(),
  known_items_bytes: Buffer.byteLength('{"42":1}'),
  last_commands_bytes: Buffer.byteLength('[]'),
  last_response_bytes: 3,
  ...overrides,
});

const validPayload = () => ({
  known_items: '{"42":1}',
  last_commands: '[]',
  last_response: Buffer.from('abc'),
});

const validState = (overrides = {}) => ({
  scopeHash,
  username,
  deviceId,
  collectionId,
  currentSyncKey: `oms-mail-${'a'.repeat(48)}`,
  previousSyncKey: null,
  uidValidity: '10',
  highestModseq: '20',
  minimumUid: 1,
  filterType: 0,
  windowSize: 100,
  bodyType: 1,
  truncationSize: 500,
  knownItems: { 42: 1 },
  lastCommands: [],
  lastMoreAvailable: false,
  lastRequestHash: null,
  lastResponse: Buffer.from('abc'),
  updatedAt: new Date(),
  ...overrides,
});

const compactSql = sql => String(sql).replace(/\s+/g, ' ').trim();

async function withPoolStubs(connection, operation, directQuery) {
  const originalQuery = pool.query;
  const originalGetConnection = pool.getConnection;
  pool.query = directQuery || (async sql => {
    if (compactSql(sql).startsWith('CREATE TABLE')) return [[], []];
    throw new Error(`Unexpected direct pool query: ${compactSql(sql)}`);
  });
  pool.getConnection = async () => connection;
  try {
    return await operation();
  } finally {
    pool.query = originalQuery;
    pool.getConnection = originalGetConnection;
  }
}

function lifecycleConnection(query) {
  const events = [];
  return {
    events,
    connection: {
      query: async (sql, params = []) => {
        events.push(['query', compactSql(sql), params]);
        return query(compactSql(sql), params);
      },
      beginTransaction: async () => events.push(['begin']),
      commit: async () => events.push(['commit']),
      rollback: async () => events.push(['rollback']),
      release: () => events.push(['release']),
      destroy: () => events.push(['destroy']),
    },
  };
}

test('mail sync payload lengths are rejected before MEDIUMTEXT/BLOB fetch', async () => {
  const { connection, events } = lifecycleConnection(async sql => {
    if (sql.includes('AS known_items_bytes')) {
      return [[validMetadata({ known_items_bytes: MAX_MAIL_SYNC_KNOWN_ITEMS_BYTES + 1 })], []];
    }
    if (sql.startsWith('SELECT known_items')) throw new Error('payload SELECT must not run');
    throw new Error(`Unexpected connection query: ${sql}`);
  });
  const legacyRow = { ...validMetadata(), ...validPayload() };

  await assert.rejects(
    withPoolStubs(
      connection,
      () => loadMailSyncState(username, deviceId, collectionId),
      async sql => {
        if (compactSql(sql).startsWith('CREATE TABLE')) return [[], []];
        if (compactSql(sql).startsWith('SELECT *')) return [[legacyRow], []];
        throw new Error(`Unexpected direct pool query: ${compactSql(sql)}`);
      },
    ),
    MailSyncStateError,
  );

  assert.equal(events.filter(event => event[0] === 'query' && event[1].startsWith('SELECT known_items')).length, 0);
});

test('valid mail sync state loads on one transaction with exact payload-length predicates', async () => {
  const metadata = validMetadata();
  const payload = validPayload();
  const { connection, events } = lifecycleConnection(async (sql, params) => {
    if (sql.includes('AS known_items_bytes')) return [[metadata], []];
    if (sql.startsWith('SELECT known_items')) {
      assert.match(sql, /OCTET_LENGTH\(known_items\) = \?/);
      assert.match(sql, /OCTET_LENGTH\(last_commands\) = \?/);
      assert.match(sql, /COALESCE\(OCTET_LENGTH\(last_response\), 0\) = \?/);
      assert.deepEqual(params, [
        scopeHash,
        metadata.known_items_bytes,
        metadata.last_commands_bytes,
        metadata.last_response_bytes,
      ]);
      return [[payload], []];
    }
    throw new Error(`Unexpected connection query: ${sql}`);
  });

  const loaded = await withPoolStubs(connection, () => loadMailSyncState(username, deviceId, collectionId));

  assert.deepEqual(loaded.knownItems, { 42: 1 });
  assert.deepEqual(loaded.lastCommands, []);
  assert.deepEqual(loaded.lastResponse, Buffer.from('abc'));
  assert.deepEqual(events.map(event => event[0]), ['begin', 'query', 'query', 'commit', 'release']);
  assert.match(events[1][1], /LIMIT 1 FOR UPDATE$/);
});

test('a mail sync payload changed between preflight and fetch is rejected', async () => {
  const { connection } = lifecycleConnection(async sql => {
    if (sql.includes('AS known_items_bytes')) return [[validMetadata()], []];
    if (sql.startsWith('SELECT known_items')) return [[], []];
    throw new Error(`Unexpected connection query: ${sql}`);
  });

  await assert.rejects(
    withPoolStubs(connection, () => loadMailSyncState(username, deviceId, collectionId)),
    /changed while its payload was loading/,
  );
});

function saveConnection(options = {}) {
  const events = [];
  const connection = {
    query: async sql => {
      const compact = compactSql(sql);
      events.push(compact);
      if (compact.startsWith('SELECT GET_LOCK')) {
        if (options.acquireError) throw options.acquireError;
        const acquired = Object.hasOwn(options, 'acquireResult') ? options.acquireResult : 1;
        return [[{ acquired }], []];
      }
      if (compact.startsWith('DELETE FROM eas_mail_sync_states')) {
        if (options.writeError) throw options.writeError;
        return [[], []];
      }
      if (compact.includes('COUNT(*) AS count')) return [[{ count: 0 }], []];
      if (compact.includes('AS bytes')) return [[{ bytes: 0 }], []];
      if (compact.startsWith('INSERT INTO eas_mail_sync_states')) return [[], []];
      if (compact.startsWith('SELECT RELEASE_LOCK')) {
        if (options.releaseError) throw options.releaseError;
        const released = Object.hasOwn(options, 'releaseResult') ? options.releaseResult : 1;
        return [[{ released }], []];
      }
      throw new Error(`Unexpected query: ${compact}`);
    },
    beginTransaction: async () => events.push('begin'),
    commit: async () => events.push('commit'),
    rollback: async () => {
      events.push('rollback');
      if (options.rollbackError) throw options.rollbackError;
    },
    release: () => events.push('release'),
    destroy: () => events.push('destroy'),
  };
  return { connection, events };
}

test('definitively unavailable mail lock is reusable and never released as owned', async () => {
  const { connection, events } = saveConnection({ acquireResult: 0 });
  await assert.rejects(
    withPoolStubs(connection, () => saveMailSyncState(validState())),
    /lock was unavailable/,
  );
  assert.ok(!events.some(event => String(event).startsWith('SELECT RELEASE_LOCK')));
  assert.ok(events.includes('release'));
  assert.ok(!events.includes('destroy'));
});

test('indeterminate and transport-failed mail lock acquisition destroy the session', async t => {
  await t.test('NULL result', async () => {
    const { connection, events } = saveConnection({ acquireResult: null });
    await assert.rejects(
      withPoolStubs(connection, () => saveMailSyncState(validState())),
      /lock acquisition was indeterminate/,
    );
    assert.ok(events.includes('destroy'));
    assert.ok(!events.includes('release'));
    assert.ok(!events.some(event => String(event).startsWith('SELECT RELEASE_LOCK')));
  });

  await t.test('transport failure', async () => {
    const { connection, events } = saveConnection({ acquireError: new Error('GET_LOCK response lost') });
    await assert.rejects(
      withPoolStubs(connection, () => saveMailSyncState(validState())),
      /GET_LOCK response lost/,
    );
    assert.ok(events.includes('destroy'));
    assert.ok(!events.includes('release'));
    assert.ok(!events.some(event => String(event).startsWith('SELECT RELEASE_LOCK')));
  });
});

test('mail rollback failure preserves the write error and destroys the session', async () => {
  const { connection, events } = saveConnection({
    writeError: new Error('mail state write failed'),
    rollbackError: new Error('rollback response lost'),
  });
  const originalConsoleError = console.error;
  const errors = [];
  console.error = message => errors.push(String(message));
  try {
    await assert.rejects(
      withPoolStubs(connection, () => saveMailSyncState(validState())),
      /mail state write failed/,
    );
  } finally {
    console.error = originalConsoleError;
  }
  assert.ok(errors.some(message => message.includes('rollback failed')));
  assert.ok(events.includes('destroy'));
  assert.ok(!events.includes('release'));
  assert.ok(!events.some(event => String(event).startsWith('SELECT RELEASE_LOCK')));
});

test('mail release failure after commit evicts and logs without converting success', async () => {
  const { connection, events } = saveConnection({ releaseResult: 0 });
  const originalConsoleError = console.error;
  const errors = [];
  console.error = message => errors.push(String(message));
  try {
    await withPoolStubs(connection, () => saveMailSyncState(validState()));
  } finally {
    console.error = originalConsoleError;
  }
  assert.ok(events.includes('commit'));
  assert.ok(events.includes('destroy'));
  assert.ok(!events.includes('release'));
  assert.ok(errors.some(message => message.includes('lock release failed after commit')));
});

test('two independently loaded backend instances serialize the same mail scope through the database lock', async () => {
  const modulePath = require.resolve(`../src/eas-mail-sync${sourceExtension}`);
  delete require.cache[modulePath];
  const secondInstance = require(modulePath);
  const originalGetConnection = pool.getConnection;
  let held = false;
  const waiters = [];
  const connections = [];
  pool.getConnection = async () => {
    const connection = {
      async query(sql) {
        const compact = compactSql(sql);
        if (compact.startsWith('SELECT GET_LOCK')) {
          if (held) await new Promise(resolve => waiters.push(resolve));
          held = true;
          return [[{ acquired: 1 }], []];
        }
        if (compact.startsWith('SELECT RELEASE_LOCK')) {
          held = false;
          const next = waiters.shift();
          if (next) next();
          return [[{ released: 1 }], []];
        }
        throw new Error(`Unexpected scope-lock query: ${compact}`);
      },
      release() {},
      destroy() {},
    };
    connections.push(connection);
    return connection;
  };

  const order = [];
  let enterFirst;
  const firstEntered = new Promise(resolve => { enterFirst = resolve; });
  let finishFirst;
  const firstMayFinish = new Promise(resolve => { finishFirst = resolve; });
  try {
    const first = withMailSyncScopeLock(scopeHash, async () => {
      order.push('first-enter');
      enterFirst();
      await firstMayFinish;
      order.push('first-exit');
    });
    await firstEntered;
    const second = secondInstance.withMailSyncScopeLock(scopeHash, async () => {
      order.push('second-enter');
      order.push('second-exit');
    });
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(order, ['first-enter']);
    finishFirst();
    await Promise.all([first, second]);
    assert.deepEqual(order, ['first-enter', 'first-exit', 'second-enter', 'second-exit']);
    assert.equal(connections.length, 2);
  } finally {
    pool.getConnection = originalGetConnection;
  }
});
