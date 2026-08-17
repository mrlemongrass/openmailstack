const assert = require('node:assert/strict');
const test = require('node:test');

process.env.OMS_DB_PASSWORD ||= 'eas-ping-test';

const {
  ACTIVE_SYNC_PING_MAX_FOLDERS,
  ActiveSyncPingConfigCache,
  ActiveSyncPingWaitRegistry,
  ActiveSyncPingAbortedError,
  activeSyncPingHasAdditions,
  activeSyncPingMailCursorNeedsSnapshot,
  evaluateActiveSyncPingChanges,
  activeSyncPingResponseNode,
  parseActiveSyncPingRequest,
  resolveActiveSyncPingFolders,
  startActiveSyncPingWait,
  waitForActiveSyncPing,
} = require('../src/eas-ping.js');
const { WbxmlParser } = require('../src/wbxml/parser.js');
const { WbxmlWriter } = require('../src/wbxml/writer.js');
const { getVisibleCalendarIdsOnConnection } = require('../src/calendar-utils.js');

const leaf = (tag, content) => ({ tag, page: 13, content, children: [] });
const folder = (id, className, classFirst = false) => ({
  tag: 'Folder',
  page: 13,
  children: classFirst
    ? [leaf('Class', className), leaf('Id', id)]
    : [leaf('Id', id), leaf('Class', className)],
});
const ping = children => ({ tag: 'Ping', page: 13, children });

test('Ping calendar inventory is a read-only projection of FolderSync visibility', async () => {
  const queries = [];
  const connection = {
    query: async (sql, parameters) => {
      queries.push({ sql, parameters });
      return [[
        { id: 1, name: 'Personal', event_count: 0 },
        { id: 2, name: 'Personal', event_count: 0 },
        { id: 3, name: 'Personal', event_count: 1 },
        { id: 4, name: 'Work', event_count: 0 },
      ]];
    },
  };

  assert.deepEqual(
    await getVisibleCalendarIdsOnConnection(connection, 'owner@example.test'),
    [1, 3, 4],
  );
  assert.equal(queries.length, 1);
  assert.match(queries[0].sql, /^SELECT\b/i);
  assert.doesNotMatch(queries[0].sql, /\b(?:INSERT|UPDATE|DELETE|ALTER|CREATE)\b/i);
  assert.deepEqual(queries[0].parameters, ['owner@example.test', 'owner@example.test']);
});

test('Ping request parsing follows xs:all ordering and cached partial-request semantics', () => {
  assert.equal(ACTIVE_SYNC_PING_MAX_FOLDERS, 32);
  const full = parseActiveSyncPingRequest(ping([
    {
      tag: 'Folders',
      page: 13,
      children: [folder('m-a'.padEnd(64, 'a'), 'Email', true), folder('contacts', 'Contacts')],
    },
    leaf('HeartbeatInterval', '120'),
  ]));
  assert.deepEqual(full, {
    ok: true,
    config: {
      heartbeatSeconds: 120,
      folders: [
        { id: 'm-a'.padEnd(64, 'a'), className: 'Email' },
        { id: 'contacts', className: 'Contacts' },
      ],
    },
  });

  const cached = structuredClone(full.config);
  assert.deepEqual(parseActiveSyncPingRequest(ping([leaf('HeartbeatInterval', '180')]), cached), {
    ok: true,
    config: { heartbeatSeconds: 180, folders: cached.folders },
  });
  assert.deepEqual(parseActiveSyncPingRequest(null, cached), { ok: true, config: cached });
  assert.deepEqual(parseActiveSyncPingRequest(ping([]), cached), {
    ok: false,
    response: { status: '3' },
  });
  assert.deepEqual(parseActiveSyncPingRequest(ping([leaf('HeartbeatInterval', '180')])), {
    ok: false,
    response: { status: '3' },
  });
  assert.deepEqual(cached, full.config);
});

test('Ping request parsing returns protocol bounds and rejects ambiguous folder syntax', () => {
  const oneFolder = {
    tag: 'Folders',
    page: 13,
    children: [folder('contacts', 'Contacts')],
  };
  assert.deepEqual(parseActiveSyncPingRequest(ping([leaf('HeartbeatInterval', '1'), oneFolder])), {
    ok: false,
    response: { status: '5', heartbeatSeconds: 60 },
  });
  assert.deepEqual(parseActiveSyncPingRequest(ping([leaf('HeartbeatInterval', '99999'), oneFolder])), {
    ok: false,
    response: { status: '5', heartbeatSeconds: 900 },
  });
  assert.deepEqual(parseActiveSyncPingRequest(ping([
    leaf('HeartbeatInterval', `+${'9'.repeat(1024)}`),
    oneFolder,
  ])), {
    ok: false,
    response: { status: '5', heartbeatSeconds: 900 },
  });
  assert.deepEqual(parseActiveSyncPingRequest(ping([
    leaf('HeartbeatInterval', `-${'9'.repeat(1024)}`),
    oneFolder,
  ])), {
    ok: false,
    response: { status: '5', heartbeatSeconds: 60 },
  });
  assert.equal(parseActiveSyncPingRequest(ping([leaf('HeartbeatInterval', ' +60 '), oneFolder])).ok, true);

  const tooManyFolders = Array.from(
    { length: ACTIVE_SYNC_PING_MAX_FOLDERS + 1 },
    (_, index) => folder(`m-${String(index).padStart(62, '0')}`, 'Email'),
  );
  assert.deepEqual(parseActiveSyncPingRequest(ping([
    leaf('HeartbeatInterval', '60'),
    { tag: 'Folders', page: 13, children: tooManyFolders },
  ])), {
    ok: false,
    response: { status: '6', maxFolders: ACTIVE_SYNC_PING_MAX_FOLDERS },
  });
  const duplicateOverLimit = [...tooManyFolders];
  duplicateOverLimit[duplicateOverLimit.length - 1] = folder(
    'm-0'.padEnd(64, '0'),
    'Email',
  );
  assert.deepEqual(parseActiveSyncPingRequest(ping([
    leaf('HeartbeatInterval', '60'),
    { tag: 'Folders', page: 13, children: duplicateOverLimit },
  ])), {
    ok: false,
    response: { status: '4' },
  });

  for (const folders of [
    [folder('contacts', 'Contacts'), folder('contacts', 'Contacts')],
    [{ ...folder('contacts', 'Contacts'), children: [leaf('Id', 'contacts'), leaf('Id', 'other')] }],
    [folder('x'.repeat(65), 'Contacts')],
  ]) {
    const result = parseActiveSyncPingRequest(ping([
      leaf('HeartbeatInterval', '60'),
      { tag: 'Folders', page: 13, children: folders },
    ]));
    assert.deepEqual(result, { ok: false, response: { status: '4' } });
  }
});

test('Ping response statuses round-trip through the production WBXML codec', () => {
  for (const [response, expectedChildren] of [
    ...['101', '102', '103', '108', '109', '130', '138'].map(status => [
      { status },
      [leaf('Status', status)],
    ]),
    [
      { status: '2', folders: ['contacts', 'cal-7'] },
      [
        leaf('Status', '2'),
        {
          tag: 'Folders',
          page: 13,
          children: [leaf('Folder', 'contacts'), leaf('Folder', 'cal-7')],
        },
      ],
    ],
    [
      { status: '5', heartbeatSeconds: 60 },
      [leaf('Status', '5'), leaf('HeartbeatInterval', '60')],
    ],
    [
      { status: '6', maxFolders: ACTIVE_SYNC_PING_MAX_FOLDERS },
      [leaf('Status', '6'), leaf('MaxFolders', String(ACTIVE_SYNC_PING_MAX_FOLDERS))],
    ],
  ]) {
    const writer = new WbxmlWriter();
    writer.writeNode(activeSyncPingResponseNode(response));
    const decoded = new WbxmlParser(writer.getBuffer()).parse();
    assert.equal(decoded.tag, 'Ping');
    assert.equal(decoded.page, 13);
    assert.deepEqual(decoded.children, expectedChildren);
  }
});

test('Ping folder resolution is bound to exact authenticated FolderSync identities and classes', () => {
  const mailId = 'm-b'.padEnd(64, 'b');
  const available = [
    { id: mailId, className: 'Email', kind: 'mail', folderPath: 'INBOX' },
    { id: 'contacts', className: 'Contacts', kind: 'contacts' },
    { id: 'cal-7', className: 'Calendar', kind: 'calendar', calendarId: 7 },
  ];
  assert.deepEqual(resolveActiveSyncPingFolders([
    { id: 'contacts', className: 'Contacts' },
    { id: mailId, className: 'Email' },
  ], available), {
    ok: true,
    folders: [available[1], available[0]],
  });
  assert.deepEqual(resolveActiveSyncPingFolders([
    { id: 'cal-8', className: 'Calendar' },
  ], available), { ok: false, response: { status: '7' } });
  assert.deepEqual(resolveActiveSyncPingFolders([
    { id: 'contacts', className: 'Email' },
  ], available), { ok: false, response: { status: '4' } });
  assert.deepEqual(resolveActiveSyncPingFolders([
    { id: 'contacts', className: 'Contacts' },
  ], [...available, { id: 'contacts', className: 'Contacts', kind: 'contacts' }]), {
    ok: false,
    response: { status: '8' },
  });
});

test('Ping config cache is owner-device scoped, cloned, bounded, and lazily expires', () => {
  let now = 1_000;
  const cache = new ActiveSyncPingConfigCache({
    maxEntries: 2,
    ttlMs: 100,
    now: () => now,
  });
  const config = {
    heartbeatSeconds: 120,
    folders: [{ id: 'contacts', className: 'Contacts' }],
  };
  assert.equal(cache.set('owner-a@example.test', 'DEVICEA', config), true);
  assert.equal(cache.set('owner-b@example.test', 'DEVICEA', config), true);

  const first = cache.get('owner-a@example.test', 'DEVICEA');
  first.folders[0].id = 'mutated';
  assert.deepEqual(cache.get('owner-a@example.test', 'DEVICEA'), config);
  assert.equal(cache.get('owner-b@example.test', 'DEVICEB'), null);

  assert.equal(cache.set('owner-a@example.test', 'DEVICEA', config), true);
  assert.equal(cache.set('owner-c@example.test', 'DEVICEC', config), true);
  assert.equal(cache.get('owner-b@example.test', 'DEVICEA'), null, 'least recently used entry was not evicted');
  assert.deepEqual(cache.get('owner-a@example.test', 'DEVICEA'), config);

  assert.equal(cache.set('owner-a@example.test', 'DEVICEA', {
    heartbeatSeconds: 1,
    folders: config.folders,
  }), false);
  assert.deepEqual(cache.get('owner-a@example.test', 'DEVICEA'), config);

  now += 101;
  assert.equal(cache.get('owner-a@example.test', 'DEVICEA'), null);
  assert.equal(cache.size, 0);
});

test('Ping config cache enforces a per-owner device cap without evicting other owners', () => {
  const cache = new ActiveSyncPingConfigCache({
    maxEntries: 4,
    maxEntriesPerOwner: 2,
    ttlMs: 1_000,
    now: () => 1,
  });
  const config = {
    heartbeatSeconds: 60,
    folders: [{ id: 'contacts', className: 'Contacts' }],
  };
  cache.set('owner-a@example.test', 'DEVICE1', config);
  cache.set('owner-a@example.test', 'DEVICE2', config);
  cache.set('owner-b@example.test', 'DEVICE1', config);
  cache.set('owner-a@example.test', 'DEVICE3', config);

  assert.equal(cache.get('owner-a@example.test', 'DEVICE1'), null);
  assert.deepEqual(cache.get('owner-a@example.test', 'DEVICE2'), config);
  assert.deepEqual(cache.get('owner-a@example.test', 'DEVICE3'), config);
  assert.deepEqual(cache.get('owner-b@example.test', 'DEVICE1'), config);
  assert.equal(cache.size, 3);
  assert.equal(cache.set('owner-a@example.test', 'X'.repeat(33), config), false);
});

test('Ping wait registry bounds owners and active scopes globally', () => {
  const registry = new ActiveSyncPingWaitRegistry({
    maxActive: 3,
    maxActivePerOwner: 2,
    maxActivePerScope: 2,
  });
  const a1 = registry.acquire('owner-a@example.test', 'DEVICE1');
  const a2 = registry.acquire('owner-a@example.test', 'DEVICE2');
  assert.ok(a1 && a2);
  assert.equal(registry.activeCount, 2);
  assert.equal(registry.acquire('owner-a@example.test', 'DEVICE3'), null);

  const b1 = registry.acquire('owner-b@example.test', 'DEVICE1');
  assert.ok(b1);
  assert.equal(registry.acquire('owner-c@example.test', 'DEVICE1'), null);
  assert.equal(registry.activeCount, 3);
  a1.release();
  a2.release();
  b1.release();
  assert.equal(registry.activeCount, 0);
});

test('Ping wait registry supersedes one same-scope wait without hiding its draining probe', () => {
  const registry = new ActiveSyncPingWaitRegistry({
    maxActive: 2,
    maxActivePerOwner: 2,
    maxActivePerScope: 2,
  });
  const original = registry.acquire('owner-a@example.test', 'DEVICE1');
  const replacement = registry.acquire('owner-a@example.test', 'DEVICE1');
  assert.ok(original && replacement);
  assert.equal(original.signal.aborted, true);
  assert.equal(registry.activeCount, 2);
  assert.equal(registry.acquire('owner-a@example.test', 'DEVICE1'), null);
  assert.equal(replacement.signal.aborted, false, 'a rejected replacement aborted the admitted waiter');
  original.release();
  assert.equal(registry.activeCount, 1);
  replacement.release();
  assert.equal(registry.activeCount, 0);
});

test('Ping preflight reservations are bounded before inventory and supersede only after validation', () => {
  const registry = new ActiveSyncPingWaitRegistry({
    maxActive: 2,
    maxActivePerOwner: 2,
    maxActivePerScope: 2,
  });
  const active = registry.acquire('owner-a@example.test', 'DEVICE1');
  const preflight = registry.reserve('owner-a@example.test', 'DEVICE1');
  assert.ok(active && preflight);
  assert.equal(active.signal.aborted, false);
  assert.equal(registry.activeCount, 2);
  assert.equal(registry.reserve('owner-a@example.test', 'DEVICE2'), null);

  const replacement = preflight.activate();
  assert.ok(replacement);
  assert.equal(active.signal.aborted, true);
  active.release();
  replacement.release();
  assert.equal(registry.activeCount, 0);
});

test('an older slow preflight cannot supersede a newer validated request or revert its generation', () => {
  const registry = new ActiveSyncPingWaitRegistry({
    maxActive: 2,
    maxActivePerOwner: 2,
    maxActivePerScope: 2,
  });
  const older = registry.reserve('owner-a@example.test', 'DEVICE1');
  const newer = registry.reserve('owner-a@example.test', 'DEVICE1');
  assert.ok(older && newer);
  const newerLease = newer.activate();
  assert.ok(newerLease);
  assert.equal(older.activate(), null);
  assert.equal(newerLease.signal.aborted, false);
  newerLease.release();
  assert.equal(registry.activeCount, 0);
});

class FakeScheduler {
  constructor() {
    this.time = 0;
    this.nextId = 1;
    this.timers = new Map();
  }

  now = () => this.time;

  setTimeout = (callback, delay) => {
    const id = this.nextId++;
    this.timers.set(id, { at: this.time + delay, callback });
    return id;
  };

  clearTimeout = id => {
    this.timers.delete(id);
  };

  get pending() {
    return this.timers.size;
  }

  async flush() {
    await Promise.resolve();
    await Promise.resolve();
  }

  async advance(milliseconds) {
    const target = this.time + milliseconds;
    while (true) {
      const next = Array.from(this.timers.entries())
        .filter(([, timer]) => timer.at <= target)
        .sort((left, right) => left[1].at - right[1].at)[0];
      if (!next) break;
      const [id, timer] = next;
      this.timers.delete(id);
      this.time = timer.at;
      timer.callback();
      await this.flush();
    }
    this.time = target;
    await this.flush();
  }
}

const resolvedContacts = [{ id: 'contacts', className: 'Contacts', kind: 'contacts' }];

test('Ping wait returns changed folders or timeout status with a bounded fake scheduler', async () => {
  const changedScheduler = new FakeScheduler();
  let polls = 0;
  const changed = waitForActiveSyncPing({
    heartbeatSeconds: 60,
    folders: resolvedContacts,
    poll: async () => (++polls === 2
      ? { kind: 'changed', folderIds: ['contacts'] }
      : { kind: 'none' }),
    scheduler: changedScheduler,
    pollIntervalMs: 15_000,
  });
  await changedScheduler.flush();
  assert.equal(changedScheduler.pending, 2);
  await changedScheduler.advance(15_000);
  assert.deepEqual(await changed, { status: '2', folders: ['contacts'] });
  assert.equal(changedScheduler.pending, 0);

  const timeoutScheduler = new FakeScheduler();
  const timeout = waitForActiveSyncPing({
    heartbeatSeconds: 60,
    folders: resolvedContacts,
    poll: async () => ({ kind: 'none' }),
    scheduler: timeoutScheduler,
    pollIntervalMs: 15_000,
  });
  await timeoutScheduler.flush();
  await timeoutScheduler.advance(60_000);
  assert.deepEqual(await timeout, { status: '1' });
  assert.equal(timeoutScheduler.pending, 0);
});

test('Ping wait does not start a final probe inside one poll interval of the heartbeat', async () => {
  const scheduler = new FakeScheduler();
  let clockSkewMs = 0;
  scheduler.now = () => scheduler.time + clockSkewMs;
  let polls = 0;
  const handle = startActiveSyncPingWait({
    heartbeatSeconds: 60,
    folders: resolvedContacts,
    poll: async () => {
      polls += 1;
      if (polls === 4) clockSkewMs = 4;
      if (polls === 5) {
        return new Promise(resolve => scheduler.setTimeout(
          () => resolve({ kind: 'none' }),
          10,
        ));
      }
      return { kind: 'none' };
    },
    scheduler,
    pollIntervalMs: 15_000,
  });

  await scheduler.flush();
  await scheduler.advance(60_000);
  assert.deepEqual(await handle.response, { status: '1' });
  assert.equal(polls, 4);
  await handle.drained;
  assert.equal(scheduler.pending, 0);
});

test('Ping wait maps hierarchy/probe failures and aborts without residual timers', async () => {
  const hierarchyScheduler = new FakeScheduler();
  assert.deepEqual(await waitForActiveSyncPing({
    heartbeatSeconds: 60,
    folders: resolvedContacts,
    poll: async () => ({ kind: 'hierarchy' }),
    scheduler: hierarchyScheduler,
  }), { status: '7' });
  assert.equal(hierarchyScheduler.pending, 0);

  const failureScheduler = new FakeScheduler();
  assert.deepEqual(await waitForActiveSyncPing({
    heartbeatSeconds: 60,
    folders: resolvedContacts,
    poll: async () => { throw new Error('probe failed'); },
    scheduler: failureScheduler,
  }), { status: '8' });
  assert.equal(failureScheduler.pending, 0);

  const abortScheduler = new FakeScheduler();
  const controller = new AbortController();
  const aborted = waitForActiveSyncPing({
    heartbeatSeconds: 60,
    folders: resolvedContacts,
    poll: async () => ({ kind: 'none' }),
    scheduler: abortScheduler,
    signal: controller.signal,
  });
  const rejection = assert.rejects(aborted, ActiveSyncPingAbortedError);
  await abortScheduler.flush();
  assert.equal(abortScheduler.pending, 2);
  controller.abort();
  await rejection;
  assert.equal(abortScheduler.pending, 0);
});

test('Ping heartbeat returns server error, aborts, and drains when a backend probe is blocked', async () => {
  const scheduler = new FakeScheduler();
  let finishProbe;
  let probeSignal;
  const handle = startActiveSyncPingWait({
    heartbeatSeconds: 60,
    folders: resolvedContacts,
    poll: async (_folders, signal) => {
      probeSignal = signal;
      return new Promise(resolve => { finishProbe = resolve; });
    },
    scheduler,
  });
  await scheduler.flush();
  assert.equal(scheduler.pending, 1);
  await scheduler.advance(60_000);
  assert.deepEqual(await handle.response, { status: '8' });
  assert.equal(probeSignal.aborted, true);
  assert.equal(scheduler.pending, 0);

  let drained = false;
  void handle.drained.then(() => { drained = true; });
  await scheduler.flush();
  assert.equal(drained, false);
  finishProbe({ kind: 'none' });
  await handle.drained;
  assert.equal(drained, true);
});

test('aborted Ping responds immediately but retains its slot until a slow probe drains', async () => {
  const scheduler = new FakeScheduler();
  const registry = new ActiveSyncPingWaitRegistry({
    maxActive: 1,
    maxActivePerOwner: 1,
    maxActivePerScope: 1,
  });
  const lease = registry.acquire('owner-a@example.test', 'DEVICE1');
  assert.ok(lease);
  let finishProbe;
  const handle = startActiveSyncPingWait({
    heartbeatSeconds: 60,
    folders: resolvedContacts,
    poll: async () => new Promise(resolve => { finishProbe = resolve; }),
    scheduler,
    signal: lease.signal,
  });
  void handle.drained.then(lease.release);
  await scheduler.flush();
  assert.equal(typeof finishProbe, 'function');

  lease.abort();
  await assert.rejects(handle.response, ActiveSyncPingAbortedError);
  assert.equal(registry.activeCount, 1);
  assert.equal(registry.acquire('owner-b@example.test', 'DEVICE1'), null);

  finishProbe({ kind: 'none' });
  await handle.drained;
  await scheduler.flush();
  assert.equal(registry.activeCount, 0);
  assert.equal(scheduler.pending, 0);
});

test('Ping collection comparison is bounded per collection and ignores deletions/modifications', () => {
  assert.equal(activeSyncPingHasAdditions(['1', '2'], ['1', '2'], 3), false);
  assert.equal(activeSyncPingHasAdditions(['1', '2'], ['1'], 3), false);
  assert.equal(activeSyncPingHasAdditions(['1', '2'], ['1', '2', '3'], 3), true);
  assert.throws(() => activeSyncPingHasAdditions(['1', '2'], ['1', '2', '3'], 2));
  assert.throws(() => activeSyncPingHasAdditions(['1', '1'], ['1'], 3));
});

test('Ping mail cursor probes once per external no-add MODSEQ instead of on every interval', () => {
  assert.equal(activeSyncPingMailCursorNeedsSnapshot('20', '20'), false);
  assert.equal(activeSyncPingMailCursorNeedsSnapshot('20', '21'), true);
  assert.equal(activeSyncPingMailCursorNeedsSnapshot('20', '21', '21'), false);
  assert.equal(activeSyncPingMailCursorNeedsSnapshot('20', '22', '21'), true);
  assert.equal(activeSyncPingMailCursorNeedsSnapshot('0', '0'), true);
  assert.throws(() => activeSyncPingMailCursorNeedsSnapshot('20', 'invalid'));
});

test('Ping change evaluation wakes only for additions, copy/move-in, or missing Sync state', async () => {
  const mail = [{
    id: 'm-a'.padEnd(64, 'a'),
    className: 'Email',
    kind: 'mail',
    folderPath: 'INBOX',
  }];
  const evaluate = snapshots => evaluateActiveSyncPingChanges(mail, undefined, async () => snapshots);

  assert.deepEqual(await evaluate([{
    folderId: mail[0].id,
    exists: true,
    initialized: true,
    hasAdditions: false,
  }]), { kind: 'none' });
  assert.deepEqual(await evaluate([{
    folderId: mail[0].id,
    exists: true,
    initialized: true,
    hasAdditions: false,
  }]), { kind: 'none' }, 'delete incorrectly woke Ping');
  assert.deepEqual(await evaluate([{
    folderId: mail[0].id,
    exists: true,
    initialized: true,
    hasAdditions: true,
  }]), { kind: 'changed', folderIds: [mail[0].id] });
  assert.deepEqual(await evaluate([{
    folderId: mail[0].id,
    exists: true,
    initialized: false,
    hasAdditions: false,
  }]), { kind: 'changed', folderIds: [mail[0].id] });
  assert.deepEqual(await evaluate([{
    folderId: mail[0].id,
    exists: false,
    initialized: false,
    hasAdditions: false,
  }]), { kind: 'hierarchy' });
});

test('Ping evaluator accepts the advertised folder maximum without retaining aggregate item IDs', async () => {
  const folders = Array.from({ length: ACTIVE_SYNC_PING_MAX_FOLDERS }, (_, index) => ({
    id: `cal-${index + 1}`,
    className: 'Calendar',
    kind: 'calendar',
    calendarId: index + 1,
  }));
  const result = await evaluateActiveSyncPingChanges(folders, undefined, async requested =>
    requested.map(folder => ({
      folderId: folder.id,
      exists: true,
      initialized: true,
      hasAdditions: false,
    })));
  assert.deepEqual(result, { kind: 'none' });
});
