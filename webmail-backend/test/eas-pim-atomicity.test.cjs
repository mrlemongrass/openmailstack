const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

process.env.OMS_DB_PASSWORD ||= 'eas-pim-atomicity-test';

const db = require('../src/db.js');
const { withPimSqlTransaction } = require('../src/eas-pim-sync.js');

class LockManager {
  constructor() {
    this.owners = new Map();
    this.waiters = new Map();
  }

  async acquire(name, owner) {
    if (!this.owners.has(name)) {
      this.owners.set(name, owner);
      return;
    }
    await new Promise(resolve => {
      const queue = this.waiters.get(name) || [];
      queue.push(resolve);
      this.waiters.set(name, queue);
    });
    this.owners.set(name, owner);
  }

  release(name, owner) {
    assert.equal(this.owners.get(name), owner);
    this.owners.delete(name);
    const next = this.waiters.get(name)?.shift();
    if (next) next();
  }
}

const clone = value => structuredClone(value);

class FakePimDatabase {
  constructor(kind, primed = true) {
    this.kind = kind;
    this.data = {
      resource: { row: `${kind}-old`, tombstone: false },
      syncState: primed ? {
        currentKey: 'key-1', previousKey: null, requestHash: null, response: null,
      } : null,
      committedMutations: 0,
    };
    this.keyCounter = primed ? 1 : 0;
    this.socketEmits = 0;
    this.trace = [];
    this.locks = new LockManager();
    this.connectionCounter = 0;
  }

  async getConnection() {
    const database = this;
    const id = ++this.connectionCounter;
    return {
      id,
      working: null,
      pendingMutations: 0,
      failCommit: false,
      async query(sql, params) {
        const compact = String(sql).replace(/\s+/g, ' ').trim();
        if (compact.includes('GET_LOCK')) {
          const name = String(params[0]);
          database.trace.push(name.startsWith('oms-pim-') ? 'acquire:pim' : `acquire:${database.kind}`);
          await database.locks.acquire(name, id);
          return [[{ acquired: 1 }], []];
        }
        if (compact.includes('RELEASE_LOCK')) {
          const name = String(params[0]);
          database.trace.push(name.startsWith('oms-pim-') ? 'release:pim' : `release:${database.kind}`);
          database.locks.release(name, id);
          return [[{ released: 1 }], []];
        }
        throw new Error(`Unexpected fake SQL: ${compact}`);
      },
      async beginTransaction() {
        database.trace.push('begin');
        this.working = clone(database.data);
        this.pendingMutations = 0;
      },
      async commit() {
        database.trace.push('commit');
        if (this.failCommit) throw new Error('injected commit failure');
        this.working.committedMutations += this.pendingMutations;
        database.data = this.working;
        this.working = null;
      },
      async rollback() {
        database.trace.push('rollback');
        this.working = null;
        this.pendingMutations = 0;
      },
      release() {
        database.trace.push('pool:release');
      },
      destroy() {
        database.trace.push('pool:destroy');
      },
      mutateFirst() {
        this.working.resource = { row: null, tombstone: true };
        this.pendingMutations += 1;
      },
      mutateSecond() {
        this.working.resource = { row: `${database.kind}-new`, tombstone: false };
        this.pendingMutations += 1;
      },
    };
  }
}

const secondaryLock = kind => ({
  acquire: async connection => {
    const name = `${kind}-resource-lock`;
    await connection.query('SELECT GET_LOCK(?, 10) AS acquired', [name]);
    return { name };
  },
  release: async (connection, lease) => {
    await connection.query('SELECT RELEASE_LOCK(?) AS released', [lease.name]);
  },
});

function requestRunner(database) {
  return async ({ syncKey, requestHash, fault = null, sendFails = false, keyZero = false }) => {
    const result = await withPimSqlTransaction(
      'Person@Example.Test',
      async connection => {
        const state = connection.working.syncState;
        if (keyZero) {
          if (state?.previousKey === '0' && state.requestHash === requestHash) {
            return { status: '1', response: Buffer.from(state.response, 'base64'), mutated: false };
          }
          const nextKey = `key-${++database.keyCounter}`;
          const response = Buffer.from(`${database.kind}:prime:${nextKey}:${requestHash}`);
          connection.working.syncState = {
            currentKey: nextKey,
            previousKey: '0',
            requestHash,
            response: response.toString('base64'),
          };
          return { status: '1', response, mutated: false };
        }
        if (!state || syncKey !== state.currentKey) {
          if (state?.previousKey === syncKey && state.requestHash === requestHash) {
            return { status: '1', response: Buffer.from(state.response, 'base64'), mutated: false };
          }
          return { status: '3', response: Buffer.from('status-3'), mutated: false };
        }

        connection.mutateFirst();
        if (fault === 'after-resource') throw new Error('injected after first resource mutation');
        connection.mutateSecond();
        const nextKey = `key-${++database.keyCounter}`;
        const response = Buffer.from(`${database.kind}:success:${nextKey}:${requestHash}`);
        if (fault === 'render') throw new Error('injected response render/byte-fit failure');
        if (fault === 'before-state') throw new Error('injected before state UPSERT');
        connection.working.syncState = {
          currentKey: nextKey,
          previousKey: syncKey,
          requestHash,
          response: response.toString('base64'),
        };
        if (fault === 'commit') connection.failCommit = true;
        return { status: '1', response, mutated: true };
      },
      secondaryLock(database.kind),
    );
    if (result.mutated) database.socketEmits += 1;
    if (sendFails) {
      const error = new Error('simulated HTTP send failure after commit');
      error.response = result.response;
      throw error;
    }
    return result;
  };
}

const originalPoolQuery = db.pool.query;
const originalGetConnection = db.pool.getConnection;
let activeDatabase = null;

test.before(() => {
  db.pool.query = async sql => {
    if (String(sql).includes('SHOW COLUMNS')) return [[
      { Field: 'supported_was_present' }, { Field: 'supported_fields' },
    ], []];
    return [{}, []];
  };
  db.pool.getConnection = () => activeDatabase.getConnection();
});

test.after(() => {
  db.pool.query = originalPoolQuery;
  db.pool.getConnection = originalGetConnection;
});

for (const kind of ['contacts', 'calendar']) {
  test(`${kind} PIM failures roll back resource, tombstone, state, batch, and socket side effects`, async t => {
    for (const fault of ['after-resource', 'render', 'before-state', 'commit']) {
      await t.test(fault, async () => {
        activeDatabase = new FakePimDatabase(kind);
        const run = requestRunner(activeDatabase);
        const before = clone(activeDatabase.data);
        await assert.rejects(
          () => run({ syncKey: 'key-1', requestHash: `${kind}-${fault}`, fault }),
          /injected/,
        );
        assert.deepEqual(activeDatabase.data, before);
        assert.equal(activeDatabase.socketEmits, 0);

        const retry = await run({ syncKey: 'key-1', requestHash: `${kind}-${fault}` });
        assert.equal(retry.status, '1');
        assert.deepEqual(activeDatabase.data.resource, { row: `${kind}-new`, tombstone: false });
        assert.equal(activeDatabase.data.committedMutations, 2);
        assert.equal(activeDatabase.socketEmits, 1);
      });
    }
  });

  test(`${kind} committed response replays byte-for-byte after HTTP send failure`, async () => {
    activeDatabase = new FakePimDatabase(kind);
    const run = requestRunner(activeDatabase);
    let committedResponse;
    try {
      await run({ syncKey: 'key-1', requestHash: `${kind}-send-failure`, sendFails: true });
      assert.fail('send failure should reject');
    } catch (error) {
      committedResponse = error.response;
    }
    assert.equal(activeDatabase.data.committedMutations, 2);
    assert.equal(activeDatabase.socketEmits, 1);
    const replay = await run({ syncKey: 'key-1', requestHash: `${kind}-send-failure` });
    assert.deepEqual(replay.response, committedResponse);
    assert.equal(activeDatabase.data.committedMutations, 2);
    assert.equal(activeDatabase.socketEmits, 1);
  });

  test(`${kind} concurrent same-key requests advance once, replay identical bytes, and reject a different body`, async () => {
    activeDatabase = new FakePimDatabase(kind);
    const run = requestRunner(activeDatabase);
    const [first, duplicate] = await Promise.all([
      run({ syncKey: 'key-1', requestHash: `${kind}-identical` }),
      run({ syncKey: 'key-1', requestHash: `${kind}-identical` }),
    ]);
    assert.deepEqual(first.response, duplicate.response);
    assert.equal(activeDatabase.data.committedMutations, 2);
    assert.equal(activeDatabase.socketEmits, 1);

    activeDatabase = new FakePimDatabase(kind);
    const runDifferent = requestRunner(activeDatabase);
    const results = await Promise.all([
      runDifferent({ syncKey: 'key-1', requestHash: `${kind}-body-a` }),
      runDifferent({ syncKey: 'key-1', requestHash: `${kind}-body-b` }),
    ]);
    assert.deepEqual(results.map(result => result.status).sort(), ['1', '3']);
    assert.equal(activeDatabase.data.committedMutations, 2);
    assert.equal(activeDatabase.socketEmits, 1);
  });

  test(`${kind} concurrent identical key-zero requests converge on one stored key and response`, async () => {
    activeDatabase = new FakePimDatabase(kind, false);
    const run = requestRunner(activeDatabase);
    const [first, duplicate] = await Promise.all([
      run({ syncKey: '0', requestHash: `${kind}-prime`, keyZero: true }),
      run({ syncKey: '0', requestHash: `${kind}-prime`, keyZero: true }),
    ]);
    assert.deepEqual(first.response, duplicate.response);
    assert.equal(activeDatabase.keyCounter, 1);
    assert.equal(activeDatabase.data.syncState.currentKey, 'key-1');
    assert.equal(activeDatabase.data.committedMutations, 0);
  });
}

test('PIM lock trace follows PIM then resource then BEGIN and reverses releases', async () => {
  activeDatabase = new FakePimDatabase('contacts');
  const run = requestRunner(activeDatabase);
  await run({ syncKey: 'key-1', requestHash: 'lock-order' });
  assert.deepEqual(activeDatabase.trace, [
    'acquire:pim', 'acquire:contacts', 'begin', 'commit',
    'release:contacts', 'release:pim', 'pool:release',
  ]);
});

test('PIM route transaction callbacks use only connection-scoped helpers and defer external side effects', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/index.ts'), 'utf8');
  const contactsStart = source.indexOf('if (isContactsCollection(collectionId))');
  const calendarStart = source.indexOf("if (collectionId.startsWith('cal-'))", contactsStart);
  const mailStart = source.indexOf('const classifiedCollection = classifyActiveSyncCollection', calendarStart);
  const contacts = source.slice(contactsStart, calendarStart);
  const calendar = source.slice(calendarStart, mailStart);
  const pingSnapshots = source.slice(
    source.indexOf('async function loadActiveSyncPingSnapshots'),
    source.indexOf('function isContactsCollection'),
  );

  assert.equal((source.match(/withPimSqlTransaction\(creds\.user/g) || []).length, 2);
  assert.equal((source.match(/loadPimSyncStateOnConnection\(/g) || []).length, 3);
  assert.match(pingSnapshots, /loadPimSyncStateOnConnection\(connection/);
  assert.doesNotMatch(contacts, /await pool\.query|\blistContacts\(|\bsaveContactFromVCard\(|\bdeleteContactByDavUid\(/);
  assert.doesNotMatch(contacts, /listContactsOnConnection\(connection/);
  assert.match(contacts, /loadBoundedContactPimSnapshot\(connection/);
  assert.match(contacts, /saveContactFromVCardOnConnection\(\s*connection/);
  assert.match(contacts, /deleteContactByDavUidOnConnection\(\s*connection/);
  assert.match(contacts, /resolveActiveSyncWindowSize\(\s*syncKey/);
  assert.match(calendar, /resolveActiveSyncWindowSize\(\s*syncKey/);
  assert.match(contacts, /savePimSyncStateOnConnection\(connection/);
  assert.doesNotMatch(calendar, /await pool\.query|\bsaveActiveSyncCalendarEvent\(|\bdeleteActiveSyncCalendarEvent\(/);
  assert.doesNotMatch(calendar, /getVisibleCalendars\(/);
  assert.match(calendar, /LEFT JOIN calendar_shares cs[\s\S]*cs\.shared_with_user_id = \?[\s\S]*LIMIT 1 FOR UPDATE/);
  assert.match(calendar, /SELECT c\.id, c\.user_id, c\.dav_slug, c\.subscribed_url, cs\.permission/);
  assert.match(calendar, /const accessRole = resolveActiveSyncCalendarAccessRole\(calendarRows\[0\], creds\.user\)/);
  assert.match(calendar, /if \(!canWriteActiveSyncCalendar\(accessRole\)\)[\s\S]*Status', page: 0, content: '8'/);
  assert.match(calendar, /loadBoundedCalendarPimSnapshot\(connection/);
  assert.doesNotMatch(calendar, /SELECT uid, ical_data FROM events WHERE calendar_id = \? ORDER BY/);
  assert.match(calendar, /saveActiveSyncCalendarEventInTransaction\(\s*connection/);
  assert.match(calendar, /savePimSyncStateOnConnection\(connection/);

  const contactTransactionBody = contacts.slice(
    contacts.indexOf('const result = await withPimSqlTransaction'),
    contacts.indexOf('for (const event of contactEvents)'),
  );
  const calendarTransactionBody = calendar.slice(
    calendar.indexOf('const result = await withPimSqlTransaction'),
    calendar.indexOf('if (result.calendarChanged'),
  );
  assert.doesNotMatch(contactTransactionBody, /\bres\.|io\.to/);
  assert.doesNotMatch(calendarTransactionBody, /\bres\.|io\.to/);
  assert.match(contactTransactionBody, /loadPimSyncStateOnConnection\(connection/);
  assert.match(calendarTransactionBody, /loadPimSyncStateOnConnection\(connection/);
  assert.match(contactTransactionBody, /await renderPimCommandPage/);
  assert.match(calendarTransactionBody, /await renderPimCommandPage/);

  const contactMutations = fs.readFileSync(path.join(__dirname, '../src/contact-utils.ts'), 'utf8');
  const saveMutation = contactMutations.slice(
    contactMutations.indexOf('export async function saveContactFromVCardOnConnection'),
    contactMutations.indexOf('export async function saveContactFromVCard(user'),
  );
  const deleteMutation = contactMutations.slice(
    contactMutations.indexOf('export async function deleteContactByDavUidOnConnection'),
    contactMutations.indexOf('export async function deleteContactByDavUid(user'),
  );
  assert.match(saveMutation, /await syncContactBirthdayEvent\(/);
  assert.match(deleteMutation, /await syncContactBirthdayEvent\(/);

  const persistence = fs.readFileSync(path.join(__dirname, '../src/eas-pim-sync.ts'), 'utf8');
  assert.match(persistence, /DELETE FROM eas_pim_sync_states WHERE username = \? AND updated_at/);
  assert.doesNotMatch(persistence, /SELECT \* FROM eas_pim_sync_states/);
  assert.match(persistence, /OCTET_LENGTH\(known_items\) AS known_items_bytes[\s\S]*LIMIT 1 FOR UPDATE/);
  assert.match(persistence, /loadPimSyncState = async[\s\S]*withPimSqlTransaction\(/);
});
