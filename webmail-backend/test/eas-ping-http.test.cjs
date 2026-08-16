const assert = require('node:assert/strict');
const http = require('node:http');
const test = require('node:test');

process.env.NODE_ENV = 'test';
process.env.OMS_DB_PASSWORD ||= 'eas-ping-http-test';
process.env.OMS_WEBMAIL_HOST = '127.0.0.1';
process.env.OMS_WEBMAIL_PORT = '0';

const { WbxmlParser } = require('../src/wbxml/parser.js');
const { WbxmlWriter } = require('../src/wbxml/writer.js');
const {
  ACTIVE_SYNC_PING_MAX_FOLDERS,
  ACTIVE_SYNC_PING_MAX_REQUEST_BYTES,
} = require('../src/eas-ping.js');

let blockNextCalendarInventory = false;
let blockedCalendarInventoryStarted = false;
let authenticationAttempts = 0;

class FakeImapService {
  constructor(user, password, useMasterCredentials = true) {
    this.user = user;
    this.password = password;
    this.authenticationOnly = useMasterCredentials === false;
  }

  async connect() {
    if (this.authenticationOnly) authenticationAttempts += 1;
    if (this.user !== 'ping-user@example.test' || this.password !== 'test-password') {
      const error = new Error('authentication failed');
      error.authenticationFailed = true;
      throw error;
    }
  }

  async logout() {}

  close() {
    this.rejectBlockedInventory?.(new Error('IMAP connection closed'));
  }

  async getFolders() {
    return [];
  }
}

const imapPath = require.resolve('../src/imap.js');
require.cache[imapPath] = {
  id: imapPath,
  filename: imapPath,
  loaded: true,
  exports: { ImapService: FakeImapService },
};

let pimBackendMode = 'missing';
let pimSnapshotCalls = 0;
let releasedConnections = 0;
let releasedDestroyedConnections = 0;
let destroyedConnections = 0;
let resolveSlowSnapshot;
let blockCalendarConnectionAcquisition = false;
const blockedCalendarConnectionAcquisitions = [];
const createFakeConnection = () => {
  const connection = {
    destroyed: false,
    query: async () => { throw new Error('unexpected direct Ping fixture query'); },
    release: () => {
      releasedConnections += 1;
      if (connection.destroyed) releasedDestroyedConnections += 1;
    },
    destroy: () => {
      connection.destroyed = true;
      destroyedConnections += 1;
      connection.rejectBlockedOperation?.(new Error('connection destroyed'));
    },
  };
  return connection;
};
const fakePool = {
  async getConnection() {
    if (!blockCalendarConnectionAcquisition) return createFakeConnection();
    return new Promise(resolve => {
      blockedCalendarConnectionAcquisitions.push(() => resolve(createFakeConnection()));
    });
  },
};
const dbPath = require.resolve('../src/db.js');
require.cache[dbPath] = {
  id: dbPath,
  filename: dbPath,
  loaded: true,
  exports: { pool: fakePool },
};

const pimPath = require.resolve('../src/eas-pim-sync.js');
const realPim = require(pimPath);
require.cache[pimPath] = {
  id: pimPath,
  filename: pimPath,
  loaded: true,
  exports: {
    ...realPim,
    loadPimSyncStateOnConnection: async () => pimBackendMode === 'missing' ? null : ({
      knownItems: { 'item-a': 'fingerprint-a' },
    }),
    loadBoundedContactPimSnapshot: async connection => {
      pimSnapshotCalls += 1;
      if (pimBackendMode === 'slow') {
        return new Promise((resolve, reject) => {
          resolveSlowSnapshot = resolve;
          connection.rejectBlockedOperation = reject;
        });
      }
      const ids = pimBackendMode === 'changed' ? ['item-a', 'item-b'] : ['item-a'];
      return { items: ids.map(serverId => ({ serverId, fingerprint: `fingerprint-${serverId}` })) };
    },
    loadBoundedCalendarPimSnapshot: async () => ({ items: [] }),
  },
};

const calendarPath = require.resolve('../src/calendar-utils.js');
const realCalendar = require(calendarPath);
require.cache[calendarPath] = {
  id: calendarPath,
  filename: calendarPath,
  loaded: true,
  exports: {
    ...realCalendar,
    getVisibleCalendars: async () => {
      throw new Error('Ping called the write-capable calendar inventory');
    },
    getVisibleCalendarIdsOnConnection: async connection => {
      if (!blockNextCalendarInventory) return [];
      blockNextCalendarInventory = false;
      blockedCalendarInventoryStarted = true;
      return new Promise((_resolve, reject) => {
        connection.rejectBlockedOperation = reject;
      });
    },
    getVisibleCalendarRevisionsOnConnection: async () => [],
  },
};

const contactsPath = require.resolve('../src/contact-utils.js');
const realContacts = require(contactsPath);
require.cache[contactsPath] = {
  id: contactsPath,
  filename: contactsPath,
  loaded: true,
  exports: {
    ...realContacts,
    getContactCollectionRevisionOnConnection: async () => '1',
  },
};

const startupPath = require.resolve('../src/application-startup.js');
require.cache[startupPath] = {
  id: startupPath,
  filename: startupPath,
  loaded: true,
  exports: {
    startApplicationAfterRequiredMigrations: async ({ listen }) => listen(),
  },
};

let activeServer;
const originalCreateServer = http.createServer;
const originalSetInterval = global.setInterval;
http.createServer = (...args) => {
  activeServer = originalCreateServer(...args);
  return activeServer;
};
global.setInterval = () => ({ unref() {} });
const { io } = require('../src/index.js');
global.setInterval = originalSetInterval;
http.createServer = originalCreateServer;

const waitForListening = server => new Promise((resolve, reject) => {
  if (server.listening) return resolve();
  server.once('listening', resolve);
  server.once('error', reject);
});

const pingBody = ({ heartbeat = '1', folders = [{ id: 'contacts', className: 'Contacts' }] } = {}) => {
  const writer = new WbxmlWriter();
  writer.writeNode({
    tag: 'Ping',
    page: 13,
    children: [
      { tag: 'HeartbeatInterval', page: 13, content: heartbeat },
      {
        tag: 'Folders',
        page: 13,
        children: folders.map(folder => ({
          tag: 'Folder',
          page: 13,
          children: [
            { tag: 'Id', page: 13, content: folder.id },
            { tag: 'Class', page: 13, content: folder.className },
          ],
        })),
      },
    ],
  });
  return writer.getBuffer();
};

const heartbeatOnlyBody = heartbeat => {
  const writer = new WbxmlWriter();
  writer.writeNode({
    tag: 'Ping',
    page: 13,
    children: [{ tag: 'HeartbeatInterval', page: 13, content: heartbeat }],
  });
  return writer.getBuffer();
};

const startPing = ({
  body = pingBody(),
  password = 'test-password',
  authorization = true,
  deviceId = 'PINGDEVICE0123456789ABCDEF',
  deviceType = 'iPhone',
  queryUser = 'ping-user@example.test',
  protocolVersion = '14.1',
  contentType = body.length ? 'application/vnd.ms-sync.wbxml' : undefined,
  method = 'POST',
} = {}) => {
  const port = activeServer.address().port;
  let request;
  const response = new Promise((resolve, reject) => {
    const headers = { 'Content-Length': body.length };
    if (contentType !== undefined && contentType !== null) headers['Content-Type'] = contentType;
    if (protocolVersion !== undefined && protocolVersion !== null) {
      headers['MS-ASProtocolVersion'] = protocolVersion;
    }
    if (authorization) {
      headers.Authorization = `Basic ${Buffer.from(`ping-user@example.test:${password}`).toString('base64')}`;
    }
    const parameters = new URLSearchParams({
      Cmd: 'Ping',
      DeviceId: deviceId,
    });
    if (queryUser !== undefined && queryUser !== null) parameters.set('User', queryUser);
    if (deviceType !== undefined && deviceType !== null) parameters.set('DeviceType', deviceType);
    request = http.request({
      hostname: '127.0.0.1',
      port,
      method,
      path: `/Microsoft-Server-ActiveSync?${parameters}`,
      headers,
    }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({
        status: response.statusCode,
        headers: response.headers,
        body: Buffer.concat(chunks),
      }));
    });
    request.on('error', reject);
    request.end(body);
  });
  return { request, response };
};

const postPing = options => startPing(options).response;

const decodePing = response => new WbxmlParser(response.body).parse();

const waitUntil = async (predicate, message) => {
  const deadline = Date.now() + 2_000;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error(message);
    await new Promise(resolve => setTimeout(resolve, 5));
  }
};

test.before(async () => {
  assert.ok(activeServer, 'index route did not create its HTTP server');
  await waitForListening(activeServer);
});

test.after(async () => {
  io.close();
  activeServer.closeAllConnections?.();
  if (activeServer.listening) {
    await new Promise(resolve => activeServer.close(resolve));
  }
});

test('authenticated iOS Ping reaches protocol negotiation instead of HTTP 501', async () => {

  const response = await postPing();
  assert.equal(response.status, 200);
  assert.match(String(response.headers['content-type']), /^application\/vnd\.ms-sync\.wbxml/);

  const decoded = decodePing(response);
  assert.equal(decoded.tag, 'Ping');
  assert.equal(decoded.page, 13);
  assert.deepEqual(decoded.children, [
    { tag: 'Status', page: 13, content: '5', children: [] },
    { tag: 'HeartbeatInterval', page: 13, content: '60', children: [] },
  ]);
});

test('Ping HTTP boundary enforces auth, device, syntax, ownership, limits, and cache atomicity', async () => {
  assert.equal((await postPing({ authorization: false })).status, 401);
  assert.equal((await postPing({ password: 'wrong-password' })).status, 401);
  const wrongMethod = await postPing({ body: Buffer.alloc(0), method: 'GET' });
  assert.equal(wrongMethod.status, 405);
  assert.equal(wrongMethod.headers.allow, 'OPTIONS, POST');

  const tooMany = await postPing({
    body: pingBody({
      heartbeat: '60',
      folders: Array.from({ length: ACTIVE_SYNC_PING_MAX_FOLDERS + 1 }, (_, index) => ({
        id: `cal-${index + 1}`,
        className: 'Calendar',
      })),
    }),
  });
  assert.equal(tooMany.status, 200);
  assert.deepEqual(decodePing(tooMany).children, [
    { tag: 'Status', page: 13, content: '6', children: [] },
    { tag: 'MaxFolders', page: 13, content: String(ACTIVE_SYNC_PING_MAX_FOLDERS), children: [] },
  ]);

  const unknown = await postPing({
    body: pingBody({ heartbeat: '60', folders: [{ id: 'cal-999', className: 'Calendar' }] }),
  });
  assert.equal(unknown.status, 200);
  assert.equal(decodePing(unknown).children[0].content, '7');

  pimBackendMode = 'missing';
  const initial = await postPing({ body: pingBody({ heartbeat: '60' }) });
  assert.equal(initial.status, 200);
  assert.deepEqual(decodePing(initial).children, [
    { tag: 'Status', page: 13, content: '2', children: [] },
    {
      tag: 'Folders',
      page: 13,
      children: [{ tag: 'Folder', page: 13, content: 'contacts', children: [] }],
    },
  ]);

  const rejectedUpdate = await postPing({ body: heartbeatOnlyBody('1') });
  assert.equal(decodePing(rejectedUpdate).children[0].content, '5');

  const attemptsBeforeExactLimit = authenticationAttempts;
  const exactLimit = await postPing({ body: Buffer.alloc(ACTIVE_SYNC_PING_MAX_REQUEST_BYTES) });
  assert.equal(exactLimit.status, 200, 'exact Ping byte limit was rejected as oversized');
  assert.equal(decodePing(exactLimit).children[0].content, '102');
  assert.equal(authenticationAttempts, attemptsBeforeExactLimit + 1);
  const attemptsBeforeOversized = authenticationAttempts;
  const oversized = await postPing({ body: Buffer.alloc(ACTIVE_SYNC_PING_MAX_REQUEST_BYTES + 1) });
  assert.equal(oversized.status, 413);
  assert.equal(
    authenticationAttempts,
    attemptsBeforeOversized,
    'oversized Ping reached authentication instead of failing at ingress',
  );

  const cached = await postPing({ body: Buffer.alloc(0) });
  assert.equal(cached.status, 200);
  assert.equal(decodePing(cached).children[0].content, '2', 'failed input mutated the cached full request');
});

test('Ping HTTP envelope returns exact common statuses after authentication', async () => {
  const attemptsBeforeMalformedVersion = authenticationAttempts;
  assert.equal((await postPing({ protocolVersion: null })).status, 400);
  assert.equal((await postPing({ protocolVersion: 'not-a-version' })).status, 400);
  assert.equal((await postPing({ queryUser: null })).status, 400);
  assert.equal((await postPing({ queryUser: '' })).status, 400);
  assert.equal((await postPing({ queryUser: 'ping user@example.test' })).status, 400);
  assert.equal((await postPing({ queryUser: 'x'.repeat(321) })).status, 400);
  assert.equal(
    authenticationAttempts,
    attemptsBeforeMalformedVersion,
    'missing or malformed protocol version reached authentication',
  );

  const snapshotsBeforeMismatch = pimSnapshotCalls;
  const mismatchedUser = await postPing({ queryUser: 'other-user@example.test' });
  assert.equal(mismatchedUser.status, 200);
  assert.deepEqual(decodePing(mismatchedUser).children, [
    { tag: 'Status', page: 13, content: '130', children: [] },
  ]);
  assert.equal(pimSnapshotCalls, snapshotsBeforeMismatch, 'query User mismatch reached a target probe');

  for (const { options, status } of [
    { options: { protocolVersion: '16.1' }, status: '138' },
    { options: { deviceId: 'X'.repeat(33) }, status: '108' },
    { options: { deviceType: null }, status: '109' },
    { options: { deviceType: 'device type' }, status: '109' },
    { options: { contentType: null }, status: '101' },
    { options: { contentType: 'application/octet-stream' }, status: '101' },
    { options: { body: Buffer.from([0x03]) }, status: '102' },
    { options: { body: Buffer.from([0x03, 0x01, 0x6a, 0x00]) }, status: '103' },
  ]) {
    const response = await postPing(options);
    assert.equal(response.status, 200, JSON.stringify(options));
    assert.deepEqual(decodePing(response).children, [
      { tag: 'Status', page: 13, content: status, children: [] },
    ]);
  }

  for (const options of [
    { protocolVersion: '14.0' },
    { deviceType: 'x'.repeat(33) },
    { protocolVersion: '14.1', contentType: 'application/vnd.ms-sync' },
    { protocolVersion: '14.0', contentType: 'application/vnd.ms-sync' },
  ]) {
    const response = await postPing(options);
    assert.equal(response.status, 200, JSON.stringify(options));
    assert.equal(decodePing(response).children[0].content, '5');
  }
  const attemptsBeforePre14 = authenticationAttempts;
  for (const protocolVersion of ['2.5', '12.0', '12.1']) {
    assert.equal((await postPing({ protocolVersion })).status, 400);
  }
  assert.equal(authenticationAttempts, attemptsBeforePre14 + 3);

  const validBodyless = await postPing({ body: Buffer.alloc(0) });
  assert.equal(validBodyless.status, 200);
  const invalidBodyless = await postPing({ body: Buffer.alloc(0), protocolVersion: null });
  assert.equal(invalidBodyless.status, 400);
});

test('normal long Ping remains open until a validated same-device request supersedes it', async () => {
  pimBackendMode = 'stable';
  pimSnapshotCalls = 0;
  const first = startPing({ body: pingBody({ heartbeat: '60' }) });
  let firstSettled = false;
  void first.response.finally(() => { firstSettled = true; });
  await waitUntil(() => pimSnapshotCalls > 0, 'first Ping did not reach its snapshot probe');
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(firstSettled, false, 'normal request completion incorrectly aborted the long Ping');

  pimBackendMode = 'changed';
  const secondResponse = await postPing({ body: pingBody({ heartbeat: '60' }) });
  const firstResponse = await first.response;
  assert.equal(decodePing(firstResponse).children[0].content, '8');
  assert.deepEqual(decodePing(secondResponse).children, [
    { tag: 'Status', page: 13, content: '2', children: [] },
    {
      tag: 'Folders',
      page: 13,
      children: [{ tag: 'Folder', page: 13, content: 'contacts', children: [] }],
    },
  ]);
});

test('destroying a client actively destroys a blocked DB probe and frees the waiter', async () => {
  pimBackendMode = 'slow';
  resolveSlowSnapshot = undefined;
  const destroyedBefore = destroyedConnections;
  const releasedDestroyedBefore = releasedDestroyedConnections;
  const blocked = startPing({
    body: pingBody({ heartbeat: '60' }),
    deviceId: 'PINGDEVICE2',
  });
  await waitUntil(() => typeof resolveSlowSnapshot === 'function', 'blocked DB probe did not start');
  blocked.request.destroy();
  await assert.rejects(blocked.response);
  await waitUntil(() => destroyedConnections > destroyedBefore, 'abort did not destroy the DB probe connection');
  assert.equal(
    releasedDestroyedConnections,
    releasedDestroyedBefore,
    'destroyed DB connection was returned to the pool',
  );

  pimBackendMode = 'changed';
  const replacement = await postPing({
    body: pingBody({ heartbeat: '60' }),
    deviceId: 'PINGDEVICE2',
  });
  assert.equal(replacement.status, 200);
  assert.equal(decodePing(replacement).children[0].content, '2');
});

test('aborted queued DB acquisitions retain their bounded reservations until late connections drain', async () => {
  blockCalendarConnectionAcquisition = true;
  blockedCalendarConnectionAcquisitions.length = 0;
  const deviceId = 'PINGDEVICEQUEUED';
  const first = startPing({ body: pingBody({ heartbeat: '60' }), deviceId });
  const second = startPing({ body: pingBody({ heartbeat: '60' }), deviceId });
  await waitUntil(
    () => blockedCalendarConnectionAcquisitions.length === 2,
    'queued calendar acquisitions did not consume the bounded preflight slots',
  );
  assert.equal((await postPing({ body: pingBody({ heartbeat: '60' }), deviceId })).status, 503);

  first.request.destroy();
  second.request.destroy();
  await Promise.all([assert.rejects(first.response), assert.rejects(second.response)]);
  assert.equal(
    (await postPing({ body: pingBody({ heartbeat: '60' }), deviceId })).status,
    503,
    'aborted queued acquisitions released their reservations before draining',
  );

  const destroyedBefore = destroyedConnections;
  const releasedDestroyedBefore = releasedDestroyedConnections;
  blockCalendarConnectionAcquisition = false;
  for (const resolve of blockedCalendarConnectionAcquisitions.splice(0)) resolve();
  await waitUntil(
    () => destroyedConnections === destroyedBefore + 2,
    'late-acquired calendar connections were not destroyed',
  );
  assert.equal(releasedDestroyedConnections, releasedDestroyedBefore);

  pimBackendMode = 'changed';
  const replacement = await postPing({ body: pingBody({ heartbeat: '60' }), deviceId });
  assert.equal(replacement.status, 200);
  assert.equal(decodePing(replacement).children[0].content, '2');
});

test('server close destroys a blocked read-only calendar inventory and completes the live response', async () => {
  blockNextCalendarInventory = true;
  blockedCalendarInventoryStarted = false;
  const destroyedBefore = destroyedConnections;
  const releasedDestroyedBefore = releasedDestroyedConnections;
  const pending = startPing({
    body: pingBody({ heartbeat: '60' }),
    deviceId: 'PINGDEVICE3',
  });
  await waitUntil(() => blockedCalendarInventoryStarted, 'calendar inventory preflight did not block');
  const closed = new Promise((resolve, reject) => {
    activeServer.close(error => error ? reject(error) : resolve());
  });
  const response = await pending.response;
  assert.equal(response.status, 200);
  assert.equal(decodePing(response).children[0].content, '8');
  assert.equal(destroyedConnections, destroyedBefore + 1);
  assert.equal(
    releasedDestroyedConnections,
    releasedDestroyedBefore,
    'destroyed inventory connection returned to pool',
  );
  await closed;
  assert.equal(activeServer.listening, false);
});
