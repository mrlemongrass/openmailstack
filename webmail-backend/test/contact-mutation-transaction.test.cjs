const assert = require('node:assert/strict');
const express = require('express');
const http = require('node:http');
const test = require('node:test');

process.env.OMS_DB_PASSWORD ||= 'contact-mutation-transaction-test';

const db = require('../src/db.js');
const contactUtils = require('../src/contact-utils.js');
const {
  activeSyncContactApplicationDataToVCard,
  contactToActiveSyncApplicationData,
} = require('../src/eas-contacts.js');
const { birthdayEventUid } = require('../src/birthday-calendar.js');

const originalPoolQuery = db.pool.query;
const schemaColumns = [
  'phone', 'vcard_data', 'dav_uid', 'sync_token', 'created_at', 'updated_at',
  'emails_json', 'phones_json', 'addresses_json', 'job_title', 'organization',
  'notes', 'labels_json', 'photo_url', 'is_favorite', 'prefix', 'first_name',
  'middle_name', 'last_name', 'suffix', 'nickname', 'department', 'birthday',
  'website_url', 'deleted_at',
];

db.pool.query = async sql => {
  const compact = String(sql).replace(/\s+/g, ' ').trim();
  if (compact.startsWith('SHOW COLUMNS FROM contacts')) {
    return [schemaColumns.map(Field => ({ Field })), []];
  }
  if (compact.startsWith('SHOW INDEX FROM contacts')) {
    return [[{ Key_name: 'idx_contacts_user_dav_uid' }], []];
  }
  if (
    compact.startsWith('CREATE TABLE IF NOT EXISTS')
    || compact.startsWith('UPDATE contacts SET dav_uid')
  ) {
    return [{ affectedRows: 0 }, []];
  }
  throw new Error(`Unexpected non-transaction contact query: ${compact}`);
};

test.after(() => {
  db.pool.query = originalPoolQuery;
});

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

class AdvisoryLockManager {
  constructor() {
    this.held = new Set();
    this.waiters = new Map();
  }

  async acquire(name) {
    if (!this.held.has(name)) {
      this.held.add(name);
      return;
    }
    await new Promise(resolve => {
      const waiters = this.waiters.get(name) || [];
      waiters.push(resolve);
      this.waiters.set(name, waiters);
    });
  }

  release(name) {
    const waiters = this.waiters.get(name) || [];
    const next = waiters.shift();
    if (next) {
      if (waiters.length === 0) this.waiters.delete(name);
      next();
      return;
    }
    this.held.delete(name);
  }
}

function lockConnection(lockManager, calls = []) {
  let heldLock = null;
  return {
    query: async (sql, params = []) => {
      const compact = String(sql).replace(/\s+/g, ' ').trim();
      calls.push([compact, params]);
      if (compact.startsWith('SELECT GET_LOCK')) {
        await lockManager.acquire(params[0]);
        heldLock = params[0];
        return [[{ acquired: 1 }], []];
      }
      if (compact.startsWith('SELECT RELEASE_LOCK')) {
        assert.equal(params[0], heldLock);
        lockManager.release(heldLock);
        heldLock = null;
        return [[{ released: 1 }], []];
      }
      return [[], []];
    },
    beginTransaction: async () => calls.push(['begin']),
    commit: async () => calls.push(['commit']),
    rollback: async () => calls.push(['rollback']),
    release: () => calls.push(['release']),
    destroy: () => calls.push(['destroy']),
  };
}

test('withContactMutation holds one user-scoped database lock around one transaction', async () => {
  assert.equal(typeof contactUtils.withContactMutation, 'function');

  const calls = [];
  const connection = {
    query: async (sql, params = []) => {
      const compact = String(sql).replace(/\s+/g, ' ').trim();
      calls.push([compact, params]);
      if (compact.startsWith('SELECT GET_LOCK')) return [[{ acquired: 1 }], []];
      if (compact.startsWith('SELECT RELEASE_LOCK')) return [[{ released: 1 }], []];
      return [[], []];
    },
    beginTransaction: async () => calls.push(['begin']),
    commit: async () => calls.push(['commit']),
    rollback: async () => calls.push(['rollback']),
    release: () => calls.push(['release']),
    destroy: () => calls.push(['destroy']),
  };
  const originalGetConnection = db.pool.getConnection;
  db.pool.getConnection = async () => connection;

  try {
    const result = await contactUtils.withContactMutation('user@example.test', async lockedConnection => {
      assert.equal(lockedConnection, connection);
      calls.push(['callback']);
      return 'done';
    });
    assert.equal(result, 'done');
  } finally {
    db.pool.getConnection = originalGetConnection;
  }

  assert.match(calls[0][1][0], /^[0-9a-f]{64}$/);
  assert.equal(calls[0][1][1], 10);
  assert.deepEqual(calls.slice(1).map(call => call[0]), [
    'begin',
    'callback',
    'commit',
    'SELECT RELEASE_LOCK(?) AS released',
    'release',
  ]);
});

test('connection-scoped lock helpers expose the composable acquire and release seam', async () => {
  const calls = [];
  const manager = new AdvisoryLockManager();
  const connection = lockConnection(manager, calls);
  const lease = await contactUtils.acquireContactMutationLock(connection, 'Composable@Example.test');
  assert.match(lease.lockName, /^[0-9a-f]{64}$/);
  await contactUtils.releaseContactMutationLock(connection, lease);
  assert.deepEqual(calls.map(call => call[0]), [
    'SELECT GET_LOCK(?, ?) AS acquired',
    'SELECT RELEASE_LOCK(?) AS released',
  ]);
  assert.equal(calls[0][1][1], 10);
});

test('case-variant user mutations serialize without globally blocking a different user', async () => {
  const manager = new AdvisoryLockManager();
  const originalGetConnection = db.pool.getConnection;
  db.pool.getConnection = async () => lockConnection(manager);
  const firstEntered = deferred();
  const releaseFirst = deferred();
  const events = [];

  try {
    const first = contactUtils.withContactMutation('Case@Example.test', async () => {
      events.push('same-1-start');
      firstEntered.resolve();
      await releaseFirst.promise;
      events.push('same-1-end');
    });
    await firstEntered.promise;
    const second = contactUtils.withContactMutation('case@example.test', async () => {
      events.push('same-2');
    });
    const other = contactUtils.withContactMutation('other@example.test', async () => {
      events.push('other');
    });
    await new Promise(resolve => setImmediate(resolve));

    assert.deepEqual(events, ['same-1-start', 'other']);
    releaseFirst.resolve();
    await Promise.all([first, second, other]);
    assert.deepEqual(events, ['same-1-start', 'other', 'same-1-end', 'same-2']);
  } finally {
    db.pool.getConnection = originalGetConnection;
  }
});

test('a failed mutation rolls back before releasing the user lock', async () => {
  const manager = new AdvisoryLockManager();
  const calls = [];
  const connection = lockConnection(manager, calls);
  const originalGetConnection = db.pool.getConnection;
  db.pool.getConnection = async () => connection;

  try {
    await assert.rejects(
      contactUtils.withContactMutation('rollback@example.test', async () => {
        calls.push(['callback']);
        throw new Error('injected mutation failure');
      }),
      /injected mutation failure/,
    );
  } finally {
    db.pool.getConnection = originalGetConnection;
  }

  assert.deepEqual(calls.map(call => call[0]), [
    'SELECT GET_LOCK(?, ?) AS acquired',
    'begin',
    'callback',
    'rollback',
    'SELECT RELEASE_LOCK(?) AS released',
    'release',
  ]);
});

test('lock acquisition failure evicts the connection instead of returning a possibly lock-owning session', async () => {
  const calls = [];
  const connection = {
    query: async sql => {
      calls.push(String(sql).replace(/\s+/g, ' ').trim());
      throw new Error('injected GET_LOCK transport failure');
    },
    beginTransaction: async () => calls.push('begin'),
    commit: async () => calls.push('commit'),
    rollback: async () => calls.push('rollback'),
    release: () => calls.push('release'),
    destroy: () => calls.push('destroy'),
  };
  const originalGetConnection = db.pool.getConnection;
  db.pool.getConnection = async () => connection;
  try {
    await assert.rejects(
      contactUtils.withContactMutation('lock-failure@example.test', async () => {}),
      /injected GET_LOCK transport failure/,
    );
  } finally {
    db.pool.getConnection = originalGetConnection;
  }
  assert.ok(calls.includes('destroy'));
  assert.ok(!calls.includes('release'));
  assert.ok(!calls.includes('begin'));
});

test('release failure after commit evicts the connection without converting success to failure', async () => {
  const calls = [];
  const connection = {
    query: async sql => {
      const compact = String(sql).replace(/\s+/g, ' ').trim();
      calls.push(compact);
      if (compact.startsWith('SELECT GET_LOCK')) return [[{ acquired: 1 }], []];
      if (compact.startsWith('SELECT RELEASE_LOCK')) return [[{ released: 0 }], []];
      return [[], []];
    },
    beginTransaction: async () => calls.push('begin'),
    commit: async () => calls.push('commit'),
    rollback: async () => calls.push('rollback'),
    release: () => calls.push('release'),
    destroy: () => calls.push('destroy'),
  };
  const originalGetConnection = db.pool.getConnection;
  const originalConsoleError = console.error;
  const errors = [];
  db.pool.getConnection = async () => connection;
  console.error = message => errors.push(String(message));

  try {
    assert.equal(await contactUtils.withContactMutation('release@example.test', async () => 'committed'), 'committed');
  } finally {
    db.pool.getConnection = originalGetConnection;
    console.error = originalConsoleError;
  }

  assert.ok(errors.some(message => message.includes('Failed to release a contact mutation lock')));
  assert.ok(calls.includes('destroy'));
  assert.ok(!calls.includes('release'));
  assert.ok(!calls.includes('rollback'));
});

test('rollback failure evicts the potentially transactional connection and preserves the mutation error', async () => {
  const calls = [];
  const connection = {
    query: async sql => {
      const compact = String(sql).replace(/\s+/g, ' ').trim();
      calls.push(compact);
      if (compact.startsWith('SELECT GET_LOCK')) return [[{ acquired: 1 }], []];
      throw new Error(`Unexpected query after rollback failure: ${compact}`);
    },
    beginTransaction: async () => calls.push('begin'),
    commit: async () => calls.push('commit'),
    rollback: async () => {
      calls.push('rollback');
      throw new Error('injected rollback failure');
    },
    release: () => calls.push('release'),
    destroy: () => calls.push('destroy'),
  };
  const originalGetConnection = db.pool.getConnection;
  const originalConsoleError = console.error;
  const errors = [];
  db.pool.getConnection = async () => connection;
  console.error = message => errors.push(String(message));

  try {
    await assert.rejects(
      contactUtils.withContactMutation('rollback-destroy@example.test', async () => {
        throw new Error('primary mutation failure');
      }),
      /primary mutation failure/,
    );
  } finally {
    db.pool.getConnection = originalGetConnection;
    console.error = originalConsoleError;
  }

  assert.ok(errors.some(message => message.includes('Failed to roll back a contact mutation')));
  assert.ok(calls.includes('destroy'));
  assert.ok(!calls.includes('release'));
  assert.ok(!calls.some(call => String(call).startsWith('SELECT RELEASE_LOCK')));
});

function installContactDatabase(initialContacts = []) {
  const lockManager = new AdvisoryLockManager();
  const state = {
    contacts: structuredClone(initialContacts),
    tombstones: new Map(),
    nextId: Math.max(0, ...initialContacts.map(contact => Number(contact.id))) + 1,
  };
  const allocatedTokens = [];
  const events = [];
  let pauseRestoreUpdate = null;
  const originalGetConnection = db.pool.getConnection;

  db.pool.getConnection = async () => {
    let snapshot = null;
    let heldLock = null;
    const connection = {
      query: async (sql, params = []) => {
        const compact = String(sql).replace(/\s+/g, ' ').trim();
        events.push(compact);
        if (compact.startsWith('SELECT GET_LOCK')) {
          await lockManager.acquire(params[0]);
          heldLock = params[0];
          return [[{ acquired: 1 }], []];
        }
        if (compact.startsWith('SELECT RELEASE_LOCK')) {
          lockManager.release(heldLock);
          heldLock = null;
          return [[{ released: 1 }], []];
        }
        if (compact.includes('AS next_sync_token')) {
          const user = params[0];
          const contactTokens = state.contacts
            .filter(contact => contact.username === user)
            .map(contact => Number(contact.sync_token || 0));
          const tombstoneTokens = [...state.tombstones.values()]
            .filter(tombstone => tombstone.username === user)
            .map(tombstone => Number(tombstone.sync_token || 0));
          const token = Math.max(0, ...contactTokens, ...tombstoneTokens) + 1;
          allocatedTokens.push(token);
          return [[{ next_sync_token: token }], []];
        }
        if (compact.startsWith('SELECT id FROM calendars')) return [[], []];
        if (compact.includes('ORDER BY deleted_at IS NULL DESC, id ASC LIMIT 1')) {
          const [user, davUid] = params;
          const contacts = state.contacts
            .filter(contact => contact.username === user && contact.dav_uid === davUid)
            .sort((left, right) => Number(left.deleted_at !== null) - Number(right.deleted_at !== null) || left.id - right.id);
          return [structuredClone(contacts.slice(0, 1).map(contact => ({
            ...contact,
            is_active: contact.deleted_at === null ? 1 : 0,
          }))), []];
        }
        if (compact.includes('dav_uid = ? AND deleted_at IS NULL ORDER BY id ASC LIMIT 1')) {
          const [user, davUid] = params;
          const contacts = state.contacts
            .filter(contact => contact.username === user && contact.dav_uid === davUid && contact.deleted_at === null)
            .sort((left, right) => left.id - right.id);
          return [structuredClone(contacts.slice(0, 1)), []];
        }
        if (compact === 'SELECT * FROM contacts WHERE id = ?') {
          return [structuredClone(state.contacts.filter(contact => contact.id === Number(params[0]))), []];
        }
        if (compact.startsWith('INSERT INTO contacts')) {
          const contact = {
            id: state.nextId++,
            username: params[0],
            name: params[1],
            email: params[2],
            phone: params[3],
            vcard_data: params[4],
            dav_uid: params[5],
            sync_token: Number(params[6]),
            emails_json: params[7],
            phones_json: params[8],
            addresses_json: params[9],
            job_title: params[10],
            organization: params[11],
            notes: params[12],
            deleted_at: null,
          };
          state.contacts.push(contact);
          return [{ insertId: contact.id, affectedRows: 1 }, []];
        }
        if (compact.startsWith('UPDATE contacts SET name = ?')) {
          const id = Number(params[20]);
          const user = params[21];
          const contact = state.contacts.find(candidate => candidate.id === id && candidate.username === user);
          const expectedToken = compact.includes('AND sync_token = ?') ? Number(params[22]) : null;
          if (!contact || (expectedToken !== null && (contact.deleted_at !== null || Number(contact.sync_token) !== expectedToken))) {
            return [{ affectedRows: 0 }, []];
          }
          Object.assign(contact, {
            name: params[0],
            email: params[1],
            phone: params[2],
            vcard_data: params[3],
            sync_token: Number(params[19]),
            deleted_at: null,
          });
          return [{ affectedRows: 1 }, []];
        }
        if (compact.startsWith('SELECT id, sync_token FROM contacts')) {
          const [user, davUid] = params;
          const contact = state.contacts
            .filter(candidate => candidate.username === user && candidate.dav_uid === davUid && candidate.deleted_at === null)
            .sort((left, right) => left.id - right.id)[0];
          return [contact ? [{ id: contact.id, sync_token: contact.sync_token }] : [], []];
        }
        if (compact.startsWith('UPDATE contacts SET deleted_at = NOW(), sync_token = ?')) {
          const [syncToken, id, user, expectedToken] = params;
          const contact = state.contacts.find(candidate => candidate.id === Number(id) && candidate.username === user && candidate.deleted_at === null);
          if (!contact || (expectedToken !== undefined && Number(contact.sync_token) !== Number(expectedToken))) {
            return [{ affectedRows: 0 }, []];
          }
          contact.deleted_at = new Date();
          contact.sync_token = Number(syncToken);
          return [{ affectedRows: 1 }, []];
        }
        if (compact.startsWith('INSERT INTO contact_tombstones')) {
          const [user, davUid, syncToken] = params;
          state.tombstones.set(`${user}\0${davUid}`, {
            username: user,
            dav_uid: davUid,
            sync_token: Number(syncToken),
          });
          return [{ affectedRows: 1 }, []];
        }
        if (compact.startsWith('DELETE FROM contact_tombstones')) {
          const [user, davUid] = params;
          const affectedRows = Number(state.tombstones.delete(`${user}\0${davUid}`));
          return [{ affectedRows }, []];
        }
        if (compact.startsWith('SELECT id, dav_uid FROM contacts WHERE id = ?') && compact.includes('deleted_at IS NOT NULL')) {
          const [id, user] = params;
          const contact = state.contacts.find(candidate => candidate.id === Number(id) && candidate.username === user && candidate.deleted_at !== null);
          return [contact ? [{ id: contact.id, dav_uid: contact.dav_uid }] : [], []];
        }
        if (compact.startsWith('UPDATE contacts SET dav_uid = ?, deleted_at = NULL')) {
          if (pauseRestoreUpdate) await pauseRestoreUpdate();
          const [davUid, syncToken, id, user] = params;
          const contact = state.contacts.find(candidate => candidate.id === Number(id) && candidate.username === user && candidate.deleted_at !== null);
          if (!contact) return [{ affectedRows: 0 }, []];
          contact.dav_uid = davUid;
          contact.sync_token = Number(syncToken);
          contact.deleted_at = null;
          return [{ affectedRows: 1 }, []];
        }
        if (compact.startsWith('DELETE FROM contacts WHERE username = ?') && compact.includes('INTERVAL 30 DAY')) {
          const user = params[0];
          const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
          const before = state.contacts.length;
          state.contacts = state.contacts.filter(contact => !(
            contact.username === user
            && contact.deleted_at !== null
            && new Date(contact.deleted_at).getTime() < cutoff
          ));
          return [{ affectedRows: before - state.contacts.length }, []];
        }
        throw new Error(`Unexpected transactional contact query: ${compact}`);
      },
      beginTransaction: async () => {
        snapshot = structuredClone(state);
      },
      commit: async () => {
        snapshot = null;
      },
      rollback: async () => {
        state.contacts = snapshot.contacts;
        state.tombstones = snapshot.tombstones;
        state.nextId = snapshot.nextId;
        snapshot = null;
      },
      release: () => {},
      destroy: () => {
        if (heldLock) lockManager.release(heldLock);
      },
    };
    return connection;
  };

  return {
    state,
    allocatedTokens,
    events,
    pauseNextRestoreUpdate() {
      const entered = deferred();
      const resume = deferred();
      pauseRestoreUpdate = async () => {
        pauseRestoreUpdate = null;
        entered.resolve();
        await resume.promise;
      };
      return { entered: entered.promise, resume: resume.resolve };
    },
    restore() {
      db.pool.getConnection = originalGetConnection;
    },
  };
}

function vcard(name, email) {
  return [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `FN:${name}`,
    `EMAIL:${email}`,
    'END:VCARD',
    '',
  ].join('\r\n');
}

let cachedCarddavRouter;
function getCarddavRouter() {
  if (cachedCarddavRouter) return cachedCarddavRouter;
  const davAuthPath = require.resolve('../src/dav-auth.js');
  const davAuth = require(davAuthPath);
  require.cache[davAuthPath].exports = {
    ...davAuth,
    davBasicAuth: () => (req, _res, next) => {
      req.user = 'carddav-mutation@example.test';
      next();
    },
  };
  const indexPath = require.resolve('../src/index.js');
  require.cache[indexPath] = {
    id: indexPath,
    filename: indexPath,
    loaded: true,
    exports: { io: { to: () => ({ emit: () => {} }) } },
  };
  cachedCarddavRouter = require('../src/carddav.js').default;
  return cachedCarddavRouter;
}

async function withCarddavServer(run) {
  const app = express();
  app.use(express.raw({ type: () => true }));
  app.use('/carddav', getCarddavRouter());
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    await run(server);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

function carddavRequest(server, method, davUid, body, headers = {}) {
  return fetch(
    `http://127.0.0.1:${server.address().port}/carddav/addressbooks/carddav-mutation%40example.test/personal/${davUid}.vcf`,
    {
      method,
      headers: { 'Content-Type': 'text/vcard; charset=utf-8', ...headers },
      ...(body === undefined ? {} : { body }),
    },
  );
}

test('CardDAV rejects a stale If-Match before changing the locked contact', async () => {
  const user = 'carddav-mutation@example.test';
  const davUid = 'stale-if-match';
  const original = {
    id: 1,
    username: user,
    name: 'Original',
    email: 'original@example.test',
    phone: '',
    vcard_data: vcard('Original', 'original@example.test'),
    dav_uid: davUid,
    sync_token: 4,
    birthday: null,
    deleted_at: null,
  };
  const fake = installContactDatabase([original]);
  try {
    await withCarddavServer(async server => {
      const response = await carddavRequest(
        server,
        'PUT',
        davUid,
        vcard('Stale Write', 'stale@example.test'),
        { 'If-Match': '"definitely-stale"' },
      );
      assert.equal(response.status, 412);
    });
    assert.deepEqual(fake.state.contacts, [original]);
    assert.deepEqual(fake.allocatedTokens, []);
  } finally {
    fake.restore();
  }
});

test('concurrent CardDAV create-only PUTs create once and reject the locked race', async () => {
  const user = 'carddav-mutation@example.test';
  const davUid = 'create-only-race';
  const fake = installContactDatabase();
  try {
    await withCarddavServer(async server => {
      const responses = await Promise.all([
        carddavRequest(server, 'PUT', davUid, vcard('First', 'first@example.test'), { 'If-None-Match': '*' }),
        carddavRequest(server, 'PUT', davUid, vcard('Second', 'second@example.test'), { 'If-None-Match': '*' }),
      ]);
      assert.deepEqual(responses.map(response => response.status).sort(), [201, 412]);
    });
    const active = fake.state.contacts.filter(contact => (
      contact.username === user && contact.dav_uid === davUid && contact.deleted_at === null
    ));
    assert.equal(active.length, 1);
    assert.equal(fake.allocatedTokens.length, 1);
  } finally {
    fake.restore();
  }
});

test('CardDAV create-only PUT recreates a deleted href once and reports creation', async () => {
  const user = 'carddav-mutation@example.test';
  const davUid = 'recreate-deleted';
  const fake = installContactDatabase([{
    id: 1,
    username: user,
    name: 'Deleted',
    email: 'deleted@example.test',
    phone: '',
    vcard_data: vcard('Deleted', 'deleted@example.test'),
    dav_uid: davUid,
    sync_token: 8,
    birthday: null,
    deleted_at: new Date('2026-01-01T00:00:00.000Z'),
  }]);
  try {
    await withCarddavServer(async server => {
      const recreated = await carddavRequest(
        server,
        'PUT',
        davUid,
        vcard('Recreated', 'recreated@example.test'),
        { 'If-None-Match': '*' },
      );
      assert.equal(recreated.status, 201);

      const duplicate = await carddavRequest(
        server,
        'PUT',
        davUid,
        vcard('Duplicate', 'duplicate@example.test'),
        { 'If-None-Match': '*' },
      );
      assert.equal(duplicate.status, 412);
    });
    assert.equal(fake.state.contacts.length, 1);
    assert.equal(fake.state.contacts[0].deleted_at, null);
    assert.equal(fake.state.contacts[0].name, 'Recreated');
    assert.equal(fake.allocatedTokens.length, 1);
  } finally {
    fake.restore();
  }
});

test('CardDAV DELETE enforces both entity-tag preconditions inside the contact lock', async () => {
  const user = 'carddav-mutation@example.test';
  const davUid = 'conditional-delete';
  const original = {
    id: 1,
    username: user,
    name: 'Delete Conditionally',
    email: 'conditional@example.test',
    phone: '',
    vcard_data: vcard('Delete Conditionally', 'conditional@example.test'),
    dav_uid: davUid,
    sync_token: 9,
    birthday: null,
    deleted_at: null,
  };
  const currentEtag = contactUtils.contactEtag(original);
  const fake = installContactDatabase([original]);
  try {
    await withCarddavServer(async server => {
      const stale = await carddavRequest(server, 'DELETE', davUid, undefined, { 'If-Match': '"stale"' });
      assert.equal(stale.status, 412);
      const createOnly = await carddavRequest(server, 'DELETE', davUid, undefined, { 'If-None-Match': '*' });
      assert.equal(createOnly.status, 412);
      const current = await carddavRequest(server, 'DELETE', davUid, undefined, { 'If-Match': currentEtag });
      assert.equal(current.status, 204);
      const missing = await carddavRequest(server, 'DELETE', davUid, undefined, { 'If-Match': '*' });
      assert.equal(missing.status, 412);
    });
    assert.equal(fake.state.contacts[0].deleted_at !== null, true);
    assert.equal(fake.allocatedTokens.length, 1);
  } finally {
    fake.restore();
  }
});

test('CardDAV birthday projection failure rolls back the contact PUT', async () => {
  const state = { contacts: [] };
  let snapshot;
  let rollbacks = 0;
  let commits = 0;
  const manager = new AdvisoryLockManager();
  const originalGetConnection = db.pool.getConnection;
  const originalConsoleError = console.error;
  db.pool.getConnection = async () => {
    const connection = lockConnection(manager);
    const baseQuery = connection.query;
    connection.query = async (sql, params = []) => {
      const compact = String(sql).replace(/\s+/g, ' ').trim();
      if (compact.startsWith('SELECT GET_LOCK') || compact.startsWith('SELECT RELEASE_LOCK')) {
        return baseQuery(sql, params);
      }
      if (compact.includes('dav_uid = ? AND deleted_at IS NULL') || compact.includes('ORDER BY deleted_at IS NULL DESC')) {
        return [[], []];
      }
      if (compact.includes('AS next_sync_token')) return [[{ next_sync_token: 1 }], []];
      if (compact.startsWith('INSERT INTO contacts')) {
        state.contacts.push({ id: 1, username: params[0], dav_uid: params[5], sync_token: params[6] });
        return [{ insertId: 1, affectedRows: 1 }, []];
      }
      if (compact === 'SELECT * FROM contacts WHERE id = ?') return [structuredClone(state.contacts), []];
      if (compact.startsWith('SELECT id FROM calendars')) return [[{ id: 9 }], []];
      if (compact.startsWith('SELECT uid, ical_data FROM events')) return [[], []];
      if (compact.startsWith('SELECT sync_token FROM calendars')) return [[{ sync_token: 3 }], []];
      if (compact.startsWith('UPDATE calendars SET sync_token = ?')) return [{ affectedRows: 1 }, []];
      if (compact.startsWith('INSERT INTO events')) throw new Error('injected CardDAV birthday projection failure');
      throw new Error(`Unexpected CardDAV birthday rollback query: ${compact}`);
    };
    connection.beginTransaction = async () => { snapshot = structuredClone(state); };
    connection.commit = async () => { commits += 1; };
    connection.rollback = async () => {
      rollbacks += 1;
      state.contacts = snapshot.contacts;
    };
    return connection;
  };
  console.error = () => {};

  try {
    await withCarddavServer(async server => {
      const response = await carddavRequest(server, 'PUT', 'birthday-rollback', [
        'BEGIN:VCARD',
        'VERSION:3.0',
        'UID:birthday-rollback',
        'FN:Birthday Rollback',
        'EMAIL:birthday-rollback@example.test',
        'BDAY:1990-01-02',
        'END:VCARD',
        '',
      ].join('\r\n'));
      assert.equal(response.status, 500);
    });
    assert.equal(state.contacts.length, 0);
    assert.equal(rollbacks, 1);
    assert.equal(commits, 0);
  } finally {
    db.pool.getConnection = originalGetConnection;
    console.error = originalConsoleError;
  }
});

test('CardDAV birthday tombstone failure rolls back the contact DELETE', async () => {
  const user = 'carddav-mutation@example.test';
  const davUid = 'birthday-delete-rollback';
  const identity = {
    contactId: 1,
    davUid,
    name: 'Birthday Delete',
    email: 'birthday-delete@example.test',
  };
  const eventUid = birthdayEventUid(user, identity);
  const state = {
    contacts: [{
      id: 1,
      username: user,
      name: identity.name,
      email: identity.email,
      birthday: '1990-01-02',
      dav_uid: davUid,
      sync_token: 5,
      deleted_at: null,
    }],
    events: new Map([[eventUid, 'existing birthday event']]),
    contactTombstones: new Map(),
  };
  let snapshot;
  let rollbacks = 0;
  let commits = 0;
  const manager = new AdvisoryLockManager();
  const originalGetConnection = db.pool.getConnection;
  const originalConsoleError = console.error;
  db.pool.getConnection = async () => {
    const connection = lockConnection(manager);
    const baseQuery = connection.query;
    connection.query = async (sql, params = []) => {
      const compact = String(sql).replace(/\s+/g, ' ').trim();
      if (compact.startsWith('SELECT GET_LOCK') || compact.startsWith('SELECT RELEASE_LOCK')) return baseQuery(sql, params);
      if (compact.includes('FROM contacts') && compact.includes('dav_uid = ?') && compact.includes('deleted_at IS NULL')) {
        const contact = state.contacts.find(row => row.username === params[0] && row.dav_uid === params[1] && row.deleted_at === null);
        return [contact ? [structuredClone(contact)] : [], []];
      }
      if (compact.includes('AS next_sync_token')) return [[{ next_sync_token: 6 }], []];
      if (compact.startsWith('UPDATE contacts SET deleted_at = NOW()')) {
        state.contacts[0].deleted_at = new Date();
        state.contacts[0].sync_token = Number(params[0]);
        return [{ affectedRows: 1 }, []];
      }
      if (compact.startsWith('INSERT INTO contact_tombstones')) {
        state.contactTombstones.set(params[1], params[2]);
        return [{ affectedRows: 1 }, []];
      }
      if (compact.startsWith('SELECT id FROM calendars')) return [[{ id: 9 }], []];
      if (compact.startsWith('SELECT uid, ical_data FROM events')) {
        return [[...state.events].map(([uid, ical_data]) => ({ uid, ical_data })), []];
      }
      if (compact.startsWith('SELECT sync_token FROM calendars')) return [[{ sync_token: 3 }], []];
      if (compact.startsWith('UPDATE calendars SET sync_token = ?')) return [{ affectedRows: 1 }, []];
      if (compact.startsWith('DELETE FROM events')) {
        for (const uid of params.slice(1)) state.events.delete(uid);
        return [{ affectedRows: 1 }, []];
      }
      if (compact.startsWith('INSERT INTO calendar_tombstones')) throw new Error('injected birthday tombstone failure');
      throw new Error(`Unexpected CardDAV birthday delete query: ${compact}`);
    };
    connection.beginTransaction = async () => { snapshot = structuredClone(state); };
    connection.commit = async () => { commits += 1; };
    connection.rollback = async () => {
      rollbacks += 1;
      state.contacts = snapshot.contacts;
      state.events = snapshot.events;
      state.contactTombstones = snapshot.contactTombstones;
    };
    return connection;
  };
  console.error = () => {};

  try {
    await withCarddavServer(async server => {
      const response = await carddavRequest(server, 'DELETE', davUid);
      assert.equal(response.status, 500);
    });
    assert.equal(state.contacts[0].deleted_at, null);
    assert.equal(state.events.has(eventUid), true);
    assert.equal(state.contactTombstones.size, 0);
    assert.equal(rollbacks, 1);
    assert.equal(commits, 0);
  } finally {
    db.pool.getConnection = originalGetConnection;
    console.error = originalConsoleError;
  }
});

test('connection-scoped vCard save returns only bounded mutation metadata', async () => {
  const queries = [];
  const connection = {
    async query(sql, params = []) {
      const compact = String(sql).replace(/\s+/g, ' ').trim();
      queries.push(compact);
      if (compact.includes('ORDER BY deleted_at IS NULL DESC, id ASC LIMIT 1')) return [[], []];
      if (compact.includes('AS next_sync_token')) return [[{ next_sync_token: 7 }], []];
      if (compact.startsWith('INSERT INTO contacts')) return [{ insertId: 42, affectedRows: 1 }, []];
      if (compact.startsWith('SELECT id FROM calendars')) return [[], []];
      throw new Error(`Unexpected metadata save query: ${compact}`);
    },
  };

  const result = await contactUtils.saveContactFromVCardOnConnection(
    connection,
    'metadata@example.test',
    'metadata-uid',
    [
      'BEGIN:VCARD',
      'VERSION:3.0',
      'UID:metadata-uid',
      'FN:Metadata Only',
      'EMAIL:metadata@example.test',
      'END:VCARD',
      '',
    ].join('\r\n'),
    null,
  );

  assert.deepEqual(result, {
    contact: {
      id: 42,
      dav_uid: 'metadata-uid',
      sync_token: 7,
      name: 'Metadata Only',
      email: 'metadata@example.test',
      birthday: null,
    },
    created: true,
  });
  assert.equal(queries.some(sql => /SELECT \*/i.test(sql)), false);
});

test('ActiveSync phone types survive vCard persistence projection in arbitrary TEL order', async () => {
  const fake = installContactDatabase();
  const user = 'phone-projection@example.test';
  const davUid = 'typed-phones';
  try {
    const generated = activeSyncContactApplicationDataToVCard(davUid, {
      tag: 'ApplicationData', page: 0, children: [
        { tag: 'BusinessPhoneNumber', page: 1, content: 'work-one' },
        { tag: 'HomePhoneNumber', page: 1, content: 'home-one' },
        { tag: 'Business2PhoneNumber', page: 1, content: 'work-two' },
        { tag: 'Home2PhoneNumber', page: 1, content: 'home-two' },
      ],
    });
    const lines = generated.split(/\r?\n/);
    const telLines = lines.filter(line => /^TEL/i.test(line));
    const reordered = lines
      .filter(line => !/^TEL/i.test(line))
      .flatMap(line => line === 'END:VCARD' ? [telLines[3], telLines[1], telLines[2], telLines[0], line] : [line])
      .join('\r\n');

    const saved = await contactUtils.saveContactFromVCard(user, davUid, reordered);
    const persisted = fake.state.contacts.find(contact => contact.id === saved.contact.id);
    const outbound = new Map(contactToActiveSyncApplicationData(persisted, persisted.vcard_data)
      .map(node => [node.tag, node.content]));

    assert.equal(outbound.get('BusinessPhoneNumber'), 'work-one');
    assert.equal(outbound.get('Business2PhoneNumber'), 'work-two');
    assert.equal(outbound.get('HomePhoneNumber'), 'home-one');
    assert.equal(outbound.get('Home2PhoneNumber'), 'home-two');
    assert.equal(outbound.has('MobilePhoneNumber'), false);

    const legacy = await contactUtils.saveContactFromVCard(user, 'legacy-untyped', [
      'BEGIN:VCARD', 'VERSION:3.0', 'UID:legacy-untyped', 'FN:Legacy', 'TEL:legacy-number', 'END:VCARD', '',
    ].join('\r\n'));
    const persistedLegacy = fake.state.contacts.find(contact => contact.id === legacy.contact.id);
    const legacyOutbound = new Map(contactToActiveSyncApplicationData(persistedLegacy, persistedLegacy.vcard_data)
      .map(node => [node.tag, node.content]));
    assert.equal(legacyOutbound.get('MobilePhoneNumber'), 'legacy-number');
  } finally {
    fake.restore();
  }
});

test('concurrent same-UID saves produce one active row with strictly ordered committed tokens', async () => {
  const fake = installContactDatabase();
  const user = 'same-uid@example.test';
  const davUid = 'same-uid';
  try {
    const results = await Promise.all([
      contactUtils.saveContactFromVCard(user, davUid, vcard('First', 'first@example.test')),
      contactUtils.saveContactFromVCard(user, davUid, vcard('Second', 'second@example.test')),
    ]);
    assert.deepEqual(results.map(result => result.created).sort(), [false, true]);
    const active = fake.state.contacts.filter(contact => contact.username === user && contact.dav_uid === davUid && contact.deleted_at === null);
    assert.equal(active.length, 1);
    assert.equal(active[0].sync_token, 2);
    assert.deepEqual(fake.allocatedTokens, [1, 2]);
  } finally {
    fake.restore();
  }
});

test('expected-token conflicts do not mutate the contact or consume a committed token', async () => {
  const fake = installContactDatabase();
  const user = 'conflict@example.test';
  try {
    const created = await contactUtils.saveContactFromVCard(user, 'conflict-uid', vcard('Original', 'original@example.test'));
    const before = structuredClone(fake.state.contacts);
    assert.equal(
      await contactUtils.saveContactFromVCard(user, 'conflict-uid', vcard('Stale', 'stale@example.test'), Number(created.contact.sync_token) + 1),
      null,
    );
    assert.deepEqual(fake.state.contacts, before);
    assert.deepEqual(fake.allocatedTokens, [1]);
  } finally {
    fake.restore();
  }
});

test('delete and recreate atomically replace and then clear the matching tombstone', async () => {
  const fake = installContactDatabase();
  const user = 'recreate@example.test';
  const davUid = 'recreate-uid';
  try {
    const created = await contactUtils.saveContactFromVCard(user, davUid, vcard('Before', 'before@example.test'));
    assert.equal(await contactUtils.deleteContactByDavUid(user, davUid, Number(created.contact.sync_token)), true);
    assert.equal(fake.state.tombstones.size, 1);
    assert.equal(fake.state.contacts.filter(contact => contact.deleted_at === null).length, 0);

    const recreated = await contactUtils.saveContactFromVCard(user, davUid, vcard('After', 'after@example.test'));
    assert.equal(recreated.created, true);
    assert.equal(fake.state.tombstones.size, 0);
    assert.equal(fake.state.contacts.filter(contact => contact.username === user && contact.dav_uid === davUid && contact.deleted_at === null).length, 1);
    assert.deepEqual(fake.allocatedTokens, [1, 2, 3]);
  } finally {
    fake.restore();
  }
});

test('an injected failure rolls back a tombstone written through the unlocked primitive', async () => {
  const fake = installContactDatabase();
  try {
    await assert.rejects(
      contactUtils.withContactMutation('tombstone-rollback@example.test', async connection => {
        await contactUtils.recordContactTombstoneOnConnection(connection, 'tombstone-rollback@example.test', 'rolled-back');
        throw new Error('after tombstone');
      }),
      /after tombstone/,
    );
    assert.equal(fake.state.tombstones.size, 0);
  } finally {
    fake.restore();
  }
});

test('restore and expiry purge are ordered by the same per-user mutation lock', async () => {
  const oldDelete = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
  const fake = installContactDatabase([{
    id: 1,
    username: 'restore-purge@example.test',
    name: 'Restore Me',
    email: 'restore@example.test',
    dav_uid: 'restore-uid',
    sync_token: 1,
    deleted_at: oldDelete,
  }]);
  fake.state.tombstones.set('restore-purge@example.test\0restore-uid', {
    username: 'restore-purge@example.test',
    dav_uid: 'restore-uid',
    sync_token: 1,
  });
  const pause = fake.pauseNextRestoreUpdate();

  try {
    const restore = contactUtils.restoreContactById('restore-purge@example.test', 1);
    await pause.entered;
    const purge = contactUtils.purgeExpiredContacts('restore-purge@example.test');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(fake.events.filter(event => event.startsWith('DELETE FROM contacts WHERE username')).length, 0);
    pause.resume();
    assert.equal(await restore, true);
    assert.equal(await purge, 0);
    assert.equal(fake.state.contacts.length, 1);
    assert.equal(fake.state.contacts[0].deleted_at, null);
    assert.equal(fake.state.tombstones.size, 0);
  } finally {
    fake.restore();
  }
});

const routeUser = 'mutation-route@example.test';
let cachedAppsApiRouter;

function getAppsApiRouter() {
  if (cachedAppsApiRouter) return cachedAppsApiRouter;
  const authPath = require.resolve('../src/auth.js');
  const auth = require(authPath);
  require.cache[authPath].exports = {
    ...auth,
    requireSession: (req, _res, next) => {
      req.user = { username: routeUser, password: 'test-only', isAdmin: false };
      next();
    },
  };
  const indexPath = require.resolve('../src/index.js');
  require.cache[indexPath] = {
    id: indexPath,
    filename: indexPath,
    loaded: true,
    exports: { io: { to: () => ({ emit: () => {} }) } },
  };
  cachedAppsApiRouter = require('../src/apps-api.js').appsApiRouter;
  return cachedAppsApiRouter;
}

function postJson(server, path, body) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify(body);
    const request = http.request({
      hostname: '127.0.0.1',
      port: server.address().port,
      path,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({
        status: response.statusCode,
        json: JSON.parse(Buffer.concat(chunks).toString('utf8')),
      }));
    });
    request.on('error', reject);
    request.end(payload);
  });
}

async function withAppsServer(run) {
  const app = express();
  app.use(express.json());
  app.use('/api/apps', getAppsApiRouter());
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  try {
    return await run(server);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

test('birthday persistence failure rolls back the preceding contact insert', async () => {
  const state = { contacts: [], calendarToken: 3 };
  let snapshot;
  let rollbacks = 0;
  let commits = 0;
  const manager = new AdvisoryLockManager();
  const originalGetConnection = db.pool.getConnection;
  db.pool.getConnection = async () => {
    const connection = lockConnection(manager);
    const baseQuery = connection.query;
    connection.query = async (sql, params = []) => {
      const compact = String(sql).replace(/\s+/g, ' ').trim();
      if (compact.startsWith('SELECT GET_LOCK') || compact.startsWith('SELECT RELEASE_LOCK')) {
        return baseQuery(sql, params);
      }
      if (compact.includes('AS next_sync_token')) return [[{ next_sync_token: 1 }], []];
      if (compact.startsWith('INSERT INTO contacts')) {
        state.contacts.push({ id: 1, username: params[0], dav_uid: params[5], sync_token: params[14] });
        return [{ insertId: 1, affectedRows: 1 }, []];
      }
      if (compact.startsWith('SELECT id FROM calendars')) return [[{ id: 9 }], []];
      if (compact.startsWith('SELECT uid, ical_data FROM events')) return [[], []];
      if (compact.startsWith('SELECT sync_token FROM calendars')) return [[{ sync_token: state.calendarToken }], []];
      if (compact.startsWith('UPDATE calendars SET sync_token = ?')) {
        state.calendarToken = Number(params[0]);
        return [{ affectedRows: 1 }, []];
      }
      if (compact.startsWith('INSERT INTO events')) throw new Error('injected birthday persistence failure');
      throw new Error(`Unexpected birthday rollback query: ${compact}`);
    };
    connection.beginTransaction = async () => { snapshot = structuredClone(state); };
    connection.commit = async () => { commits += 1; };
    connection.rollback = async () => {
      rollbacks += 1;
      state.contacts = snapshot.contacts;
      state.calendarToken = snapshot.calendarToken;
    };
    return connection;
  };

  try {
    const response = await withAppsServer(server => postJson(server, '/api/apps/contacts', {
      name: 'Birthday Rollback',
      email: 'birthday@example.test',
      birthday: '1990-01-02',
    }));
    assert.equal(response.status, 500);
    assert.equal(state.contacts.length, 0);
    assert.equal(state.calendarToken, 3);
    assert.equal(rollbacks, 1);
    assert.equal(commits, 0);
  } finally {
    db.pool.getConnection = originalGetConnection;
  }
});

test('compound merge excludes the primary and rolls back its update and tombstone when deletion fails', async () => {
  const state = {
    contacts: [
      {
        id: 1,
        username: routeUser,
        name: 'Primary',
        email: 'primary@example.test',
        phone: '',
        dav_uid: 'primary-uid',
        sync_token: 1,
        deleted_at: null,
        vcard_data: vcard('Primary', 'primary@example.test'),
      },
      {
        id: 2,
        username: routeUser,
        name: 'Duplicate',
        email: 'duplicate@example.test',
        phone: '+15555550100',
        dav_uid: 'duplicate-uid',
        sync_token: 2,
        deleted_at: null,
        vcard_data: vcard('Duplicate', 'duplicate@example.test'),
      },
    ],
    tombstones: new Map(),
  };
  const initialState = structuredClone(state);
  let snapshot;
  let rollbacks = 0;
  const manager = new AdvisoryLockManager();
  const originalGetConnection = db.pool.getConnection;
  db.pool.getConnection = async () => {
    const connection = lockConnection(manager);
    const baseQuery = connection.query;
    connection.query = async (sql, params = []) => {
      const compact = String(sql).replace(/\s+/g, ' ').trim();
      if (compact.startsWith('SELECT GET_LOCK') || compact.startsWith('SELECT RELEASE_LOCK')) {
        return baseQuery(sql, params);
      }
      if (compact === 'SELECT * FROM contacts WHERE id=? AND username=? AND deleted_at IS NULL') {
        return [structuredClone(state.contacts.filter(contact => contact.id === Number(params[0]) && contact.username === params[1])), []];
      }
      if (compact === 'SELECT * FROM contacts WHERE id IN (?) AND username=? AND deleted_at IS NULL') {
        assert.deepEqual(params[0], [2]);
        const ids = params[0].map(Number);
        return [structuredClone(state.contacts.filter(contact => ids.includes(contact.id) && contact.username === params[1])), []];
      }
      if (compact.includes('AS next_sync_token')) {
        const tokens = [
          ...state.contacts.map(contact => Number(contact.sync_token || 0)),
          ...[...state.tombstones.values()].map(tombstone => Number(tombstone.sync_token || 0)),
        ];
        return [[{ next_sync_token: Math.max(0, ...tokens) + 1 }], []];
      }
      if (compact.startsWith('UPDATE contacts SET name=?')) {
        const contact = state.contacts.find(candidate => candidate.id === Number(params[13]) && candidate.username === params[14]);
        contact.name = params[0];
        contact.sync_token = Number(params[12]);
        return [{ affectedRows: 1 }, []];
      }
      if (compact.startsWith('INSERT INTO contact_tombstones')) {
        state.tombstones.set(`${params[0]}\0${params[1]}`, {
          username: params[0],
          dav_uid: params[1],
          sync_token: Number(params[2]),
        });
        return [{ affectedRows: 1 }, []];
      }
      if (compact.startsWith('DELETE FROM contacts WHERE id IN')) {
        throw new Error('injected duplicate deletion failure');
      }
      throw new Error(`Unexpected merge rollback query: ${compact}`);
    };
    connection.beginTransaction = async () => { snapshot = structuredClone(state); };
    connection.commit = async () => {};
    connection.rollback = async () => {
      rollbacks += 1;
      state.contacts = snapshot.contacts;
      state.tombstones = snapshot.tombstones;
    };
    return connection;
  };

  try {
    const response = await withAppsServer(server => postJson(server, '/api/apps/contacts-merge', {
      primaryId: 1,
      duplicateIds: [1, 2, 2],
    }));
    assert.equal(response.status, 500);
    assert.equal(rollbacks, 1);
    assert.deepEqual(state, initialState);
  } finally {
    db.pool.getConnection = originalGetConnection;
  }
});

test('contact import reports lock and database failures instead of counting them as duplicates', async () => {
  let destroyed = false;
  const originalGetConnection = db.pool.getConnection;
  db.pool.getConnection = async () => ({
    query: async sql => {
      const compact = String(sql).replace(/\s+/g, ' ').trim();
      if (compact.startsWith('SELECT GET_LOCK')) throw new Error('injected import lock failure');
      throw new Error(`Unexpected import failure query: ${compact}`);
    },
    beginTransaction: async () => {},
    commit: async () => {},
    rollback: async () => {},
    release: () => {},
    destroy: () => { destroyed = true; },
  });

  try {
    const response = await withAppsServer(server => postJson(server, '/api/apps/contacts-import', {
      format: 'csv',
      data: 'Name,Email,Phone\nLock Failure,lock-failure@example.test,+15555550101',
    }));
    assert.equal(response.status, 500);
    assert.match(response.json.error, /injected import lock failure/);
    assert.equal(destroyed, true);
  } finally {
    db.pool.getConnection = originalGetConnection;
  }
});
