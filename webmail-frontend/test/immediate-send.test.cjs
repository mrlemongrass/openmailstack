const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');
const { File } = require('node:buffer');
const { IDBFactory } = require('fake-indexeddb');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

function loadTypeScriptModule(relativePath) {
  const sourcePath = path.resolve(__dirname, relativePath);
  const source = fs.readFileSync(sourcePath, 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: sourcePath,
  }).outputText;
  const loaded = new Module(sourcePath, module);
  loaded.paths = module.paths;
  loaded._compile(compiled, sourcePath);
  return loaded.exports;
}

function loadMailLayoutModule() {
  const sourcePath = path.resolve(__dirname, '../src/mail/MailLayout.tsx');
  const source = fs.readFileSync(sourcePath, 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
    fileName: sourcePath,
  }).outputText;
  const loaded = new Module(sourcePath, module);
  loaded.paths = module.paths;
  const container = ({ children }) => React.createElement('div', null, children);
  loaded.require = id => {
    if (id === 'react-router') {
      return { Outlet: () => React.createElement('main'), useParams: () => ({}) };
    }
    if (id === 'react-resizable-panels') {
      return {
        Panel: container,
        Group: container,
        Separator: container,
        useDefaultLayout: () => ({ defaultLayout: undefined, onLayoutChange: () => undefined }),
      };
    }
    if (id === '../shared/hooks/useMediaQuery') return { useMediaQuery: () => false };
    if (id === '../shared/hooks/useModalFocus') return { useModalFocus: () => undefined };
    if (id === './FolderSidebar') return { FolderSidebar: () => React.createElement('nav') };
    if (id === './MessageViewer') return { MessageViewer: () => React.createElement('article') };
    if (id === './components/UndoBar') return { UndoBar: () => null };
    return Module.prototype.require.call(loaded, id);
  };
  loaded._compile(compiled, sourcePath);
  return loaded.exports;
}

function response({ status = 200, body, retryAfter = null }) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: name => name.toLowerCase() === 'retry-after' ? retryAfter : null },
    json: async () => body,
  };
}

function atomicAttemptRepository(initial = []) {
  let records = structuredClone(initial);
  let tail = Promise.resolve();
  return {
    update(mutator) {
      const operation = tail.then(() => {
        const update = mutator(structuredClone(records));
        records = structuredClone(update.records);
        return update.value;
      });
      tail = operation.then(() => undefined, () => undefined);
      return operation;
    },
    snapshot() {
      return structuredClone(records);
    },
  };
}

function readIndexedDbAttempts(indexedDb) {
  return new Promise((resolve, reject) => {
    const openRequest = indexedDb.open('openmailstack-outbound-send-attempts', 1);
    openRequest.onerror = () => reject(openRequest.error);
    openRequest.onsuccess = () => {
      const database = openRequest.result;
      const transaction = database.transaction('attempts', 'readonly');
      const readRequest = transaction.objectStore('attempts').getAll();
      let records = [];
      readRequest.onsuccess = () => { records = readRequest.result; };
      readRequest.onerror = () => reject(readRequest.error);
      transaction.oncomplete = () => {
        database.close();
        resolve(records);
      };
      transaction.onerror = () => {
        database.close();
        reject(transaction.error);
      };
    };
  });
}

test('mail API requires an idempotency key on every send request', async () => {
  const { sendMessage } = loadTypeScriptModule('../src/shared/api.ts');
  const originalFetch = global.fetch;
  const requests = [];
  global.fetch = async (url, options) => {
    requests.push({ url, options });
    return response({
      status: 202,
      retryAfter: '2',
      body: {
        success: true,
        outboundId: 73,
        deliveryStatus: 'pending',
        statusUrl: '/api/messages/outbound/73',
      },
    });
  };

  try {
    const formData = new FormData();
    const pending = await sendMessage(formData, { idempotencyKey: '00000000-0000-4000-8000-000000000073' });
    await assert.rejects(
      sendMessage(formData),
      /idempotency key is required/i,
    );

    assert.equal(pending.retryAfterMs, 2000);
    assert.deepEqual(requests[0], {
      url: '/api/messages/send',
      options: {
        method: 'POST',
        body: formData,
        headers: { 'Idempotency-Key': '00000000-0000-4000-8000-000000000073' },
      },
    });
    assert.equal(requests.length, 1);
  } finally {
    global.fetch = originalFetch;
  }
});

test('owner-scoped outbound status polling accepts pending 202 and terminal 200', async () => {
  const { fetchOutboundMessageStatus } = loadTypeScriptModule('../src/shared/api.ts');
  const originalFetch = global.fetch;
  const requests = [];
  global.fetch = async (url, options) => {
    requests.push({ url, options });
    return response({
      body: {
        success: true,
        outboundId: 73,
        deliveryStatus: 'accepted',
        sentCopyStatus: 'saved',
      },
    });
  };

  try {
    const result = await fetchOutboundMessageStatus('/api/messages/outbound/73');
    assert.equal(result.deliveryStatus, 'accepted');
    assert.deepEqual(requests, [{ url: '/api/messages/outbound/73', options: undefined }]);
    await assert.rejects(
      fetchOutboundMessageStatus('https://attacker.example/api/messages/outbound/73'),
      /Invalid outbound status URL/,
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test('mail API can reconcile an outbound attempt by idempotency key without message content', async () => {
  const {
    fetchOutboundMessageStatusByKey,
  } = loadTypeScriptModule('../src/shared/api.ts');
  const originalFetch = global.fetch;
  const requests = [];
  global.fetch = async (url, options) => {
    requests.push({ url, options });
    return response({
      status: 202,
      retryAfter: '3',
      body: { success: true, deliveryStatus: 'pending', retryAfterMs: 2500 },
    });
  };
  try {
    const result = await fetchOutboundMessageStatusByKey('00000000-0000-4000-8000-000000000073');
    assert.equal(result.deliveryStatus, 'pending');
    assert.equal(result.retryAfterMs, 2500);
    assert.deepEqual(requests, [{
      url: '/api/messages/outbound/status',
      options: { headers: { 'Idempotency-Key': '00000000-0000-4000-8000-000000000073' } },
    }]);
  } finally {
    global.fetch = originalFetch;
  }
});

test('mailbox startup reconciliation clears terminal keys and retains pending uncertain and 404 records', async () => {
  const {
    createOutboundSendAttemptCoordinator,
  } = loadTypeScriptModule('../src/mail/immediate-send.ts');
  const repository = atomicAttemptRepository();
  const keys = [
    '00000000-0000-4000-8000-000000000081',
    '00000000-0000-4000-8000-000000000082',
    '00000000-0000-4000-8000-000000000083',
    '00000000-0000-4000-8000-000000000084',
    '00000000-0000-4000-8000-000000000085',
    '00000000-0000-4000-8000-000000000086',
    '00000000-0000-4000-8000-000000000087',
  ];
  const coordinatorOptions = { repository, createKey: () => keys.shift() };
  const owner = createOutboundSendAttemptCoordinator(coordinatorOptions);
  const otherOwner = createOutboundSendAttemptCoordinator(coordinatorOptions);
  for (const draftId of [
    'draft-accepted', 'draft-pending', 'draft-uncertain', 'draft-partial', 'draft-failed',
    'draft-scheduled',
  ]) {
    await owner.prepare({
      scope: { mailbox: 'owner@example.test', draftId },
      fingerprint: draftId,
      delivery: { kind: 'immediate' },
    });
  }
  await otherOwner.prepare({
    scope: { mailbox: 'other@example.test', draftId: 'draft-other' },
    fingerprint: 'other owner content',
    delivery: { kind: 'immediate' },
  });

  const ownerResult = await createOutboundSendAttemptCoordinator(coordinatorOptions).reconcileMailbox(
    'owner@example.test',
    async key => ({
      '00000000-0000-4000-8000-000000000081': { success: true, deliveryStatus: 'accepted' },
      '00000000-0000-4000-8000-000000000082': { success: true, deliveryStatus: 'pending' },
      '00000000-0000-4000-8000-000000000083': { success: true, deliveryStatus: 'uncertain' },
      '00000000-0000-4000-8000-000000000084': { success: true, deliveryStatus: 'partial' },
      '00000000-0000-4000-8000-000000000085': { success: true, deliveryStatus: 'failed' },
      '00000000-0000-4000-8000-000000000086': {
        success: true,
        submissionKind: 'scheduled',
        scheduledId: 86,
        deliveryStatus: 'pending',
      },
    })[key],
  );
  assert.deepEqual(ownerResult, {
    checked: 6,
    cleared: 4,
    accepted: 1,
    partial: 1,
    failed: 1,
    scheduled: 1,
    pending: 1,
    uncertain: 1,
    unavailable: 0,
  });
  assert.deepEqual(repository.snapshot().map(record => record.key).sort(), [
    '00000000-0000-4000-8000-000000000082',
    '00000000-0000-4000-8000-000000000083',
    '00000000-0000-4000-8000-000000000087',
  ]);

  const missing = new Error('Not found');
  missing.status = 404;
  const otherResult = await otherOwner.reconcileMailbox('other@example.test', async () => { throw missing; });
  assert.equal(otherResult.unavailable, 1);
  assert.equal(repository.snapshot().some(record => (
    record.key === '00000000-0000-4000-8000-000000000087'
  )), true);
});

test('request errors distinguish definitive conflicts from ambiguous server failures', async () => {
  const { isDefinitiveSendError, sendMessage } = loadTypeScriptModule('../src/shared/api.ts');
  const originalFetch = global.fetch;
  try {
    global.fetch = async () => response({
      status: 409,
      body: { success: false, error: 'This idempotency key belongs to different message content' },
    });
    await assert.rejects(
      sendMessage(new FormData(), { idempotencyKey: '00000000-0000-4000-8000-000000000073' }),
      error => isDefinitiveSendError(error) && /different message content/.test(error.message),
    );

    global.fetch = async () => response({
      status: 503,
      body: { success: false, error: 'Send status is temporarily unavailable' },
    });
    await assert.rejects(
      sendMessage(new FormData(), { idempotencyKey: '00000000-0000-4000-8000-000000000073' }),
      error => !isDefinitiveSendError(error) && /temporarily unavailable/.test(error.message),
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test('reload and concurrent tabs share one private persisted Undo-send identity', async () => {
  const {
    createOutboundSendAttemptCoordinator,
  } = loadTypeScriptModule('../src/mail/immediate-send.ts');
  const repository = atomicAttemptRepository();
  const keys = [
    '00000000-0000-4000-8000-000000000101',
    '00000000-0000-4000-8000-000000000102',
  ];
  const options = {
    repository,
    createKey: () => keys.shift(),
    now: () => Date.parse('2026-08-15T12:00:00.000Z'),
  };
  const firstTab = createOutboundSendAttemptCoordinator(options);
  const reloadedTab = createOutboundSendAttemptCoordinator(options);
  const request = {
    scope: {
      mailbox: 'owner-private@example.test',
      draftId: 'draft-private-73',
    },
    fingerprint: 'recipient-private@example.test\nPrivate subject\nPrivate body',
    delivery: {
      kind: 'undo',
      scheduledFor: '2026-08-15T12:00:10.000Z',
    },
  };

  const [first, recovered] = await Promise.all([
    firstTab.prepare(request),
    reloadedTab.prepare({
      ...request,
      delivery: { kind: 'undo', scheduledFor: '2026-08-15T12:00:25.000Z' },
    }),
  ]);

  assert.equal(first.key, '00000000-0000-4000-8000-000000000101');
  assert.equal(recovered.key, first.key);
  assert.equal(recovered.scheduledFor, '2026-08-15T12:00:10.000Z');
  const persisted = JSON.stringify(repository.snapshot());
  for (const plaintext of [
    'owner-private@example.test',
    'draft-private-73',
    'recipient-private@example.test',
    'Private subject',
    'Private body',
  ]) {
    assert.equal(persisted.includes(plaintext), false);
  }
  assert.deepEqual(
    Object.keys(repository.snapshot()[0]).sort(),
    [
      'contentDigest', 'createdAt', 'deliveryDigest', 'expiresAt', 'key',
      'ownerDigest', 'recordId', 'scheduledFor', 'scopeDigest', 'updatedAt',
    ],
  );
});

test('real IndexedDB transactions serialize tabs, roll back errors, and reconcile privately', async () => {
  const {
    createIndexedDbOutboundSendAttemptRepository,
    createOutboundSendAttemptCoordinator,
  } = loadTypeScriptModule('../src/mail/immediate-send.ts');
  const indexedDb = new IDBFactory();
  const firstRepository = createIndexedDbOutboundSendAttemptRepository(indexedDb);
  const secondRepository = createIndexedDbOutboundSendAttemptRepository(indexedDb);
  const keys = [
    '00000000-0000-4000-8000-000000000111',
    '00000000-0000-4000-8000-000000000112',
  ];
  const options = repository => ({
    repository,
    createKey: () => keys.shift(),
    now: () => Date.parse('2026-08-15T12:00:00.000Z'),
  });
  const firstTab = createOutboundSendAttemptCoordinator(options(firstRepository));
  const secondTab = createOutboundSendAttemptCoordinator(options(secondRepository));
  const request = {
    scope: {
      mailbox: 'indexed-owner@example.test',
      draftId: 'indexed-draft-111',
    },
    fingerprint: 'indexed-recipient@example.test\nPrivate indexed subject\nPrivate indexed body',
    delivery: {
      kind: 'scheduled',
      scheduledFor: '2026-08-16T12:00:00.000Z',
    },
  };

  const [first, second] = await Promise.all([
    firstTab.prepare(request),
    secondTab.prepare(request),
  ]);

  assert.equal(first.key, second.key);
  assert.equal(keys.length, 1);
  const committed = await readIndexedDbAttempts(indexedDb);
  assert.equal(committed.length, 1);
  assert.deepEqual(Object.keys(committed[0]).sort(), [
    'contentDigest',
    'createdAt',
    'deliveryDigest',
    'expiresAt',
    'key',
    'ownerDigest',
    'recordId',
    'scheduledFor',
    'scopeDigest',
    'updatedAt',
  ]);
  const persisted = JSON.stringify(committed);
  for (const plaintext of [
    'indexed-owner@example.test',
    'indexed-draft-111',
    'indexed-recipient@example.test',
    'Private indexed subject',
    'Private indexed body',
  ]) {
    assert.equal(persisted.includes(plaintext), false);
  }

  await assert.rejects(
    firstRepository.update(() => ({ records: [{}], value: undefined })),
    /Safe send recovery storage failed/,
  );
  assert.deepEqual(await readIndexedDbAttempts(indexedDb), committed);

  const reconciliation = await secondTab.reconcileMailbox(
    'indexed-owner@example.test',
    async key => ({
      success: true,
      submissionKind: 'scheduled',
      scheduledId: key === first.key ? 111 : 0,
      deliveryStatus: 'pending',
    }),
  );
  assert.deepEqual(reconciliation, {
    checked: 1,
    cleared: 1,
    accepted: 0,
    partial: 0,
    failed: 0,
    scheduled: 1,
    pending: 0,
    uncertain: 0,
    unavailable: 0,
  });
  assert.deepEqual(await readIndexedDbAttempts(indexedDb), []);
});

test('Undo send reuses its absolute schedule after an ambiguous failure and clears after scheduling', async () => {
  const {
    createOutboundSendAttemptCoordinator,
    sendOutboundMessage,
  } = loadTypeScriptModule('../src/mail/immediate-send.ts');
  const repository = atomicAttemptRepository();
  const keys = [
    '00000000-0000-4000-8000-000000000201',
    '00000000-0000-4000-8000-000000000202',
  ];
  const attempts = createOutboundSendAttemptCoordinator({
    repository,
    createKey: () => keys.shift(),
    now: () => Date.parse('2026-08-15T12:00:00.000Z'),
  });
  const scope = { mailbox: 'owner@example.test', draftId: 'draft-201' };
  const formData = new FormData();
  formData.set('to', 'recipient@example.test');
  formData.set('subject', 'Reliable Undo');
  formData.set('html', '<p>one logical send</p>');
  const submissions = [];
  let submission = 0;
  const submit = async (payload, key) => {
    submissions.push({ key, scheduledFor: payload.get('scheduledFor') });
    submission += 1;
    if (submission === 1) throw new TypeError('network disconnected');
    return {
      success: true,
      submissionKind: 'scheduled',
      scheduledId: 201,
      sendAt: String(payload.get('scheduledFor')),
      deliveryStatus: 'pending',
    };
  };

  await assert.rejects(sendOutboundMessage({
    scope,
    formData,
    delivery: { kind: 'undo', scheduledFor: '2026-08-15T12:00:10.000Z' },
    attempts,
    submit,
  }), /network disconnected/);
  await sendOutboundMessage({
    scope,
    formData,
    delivery: { kind: 'undo', scheduledFor: '2026-08-15T12:00:25.000Z' },
    attempts,
    submit,
  });
  await sendOutboundMessage({
    scope,
    formData,
    delivery: { kind: 'undo', scheduledFor: '2026-08-15T12:00:30.000Z' },
    attempts,
    submit: async (payload, key) => {
      submissions.push({ key, scheduledFor: payload.get('scheduledFor') });
      return {
        success: true,
        submissionKind: 'scheduled',
        scheduledId: 202,
        sendAt: String(payload.get('scheduledFor')),
        deliveryStatus: 'pending',
      };
    },
  });

  assert.deepEqual(submissions, [
    { key: '00000000-0000-4000-8000-000000000201', scheduledFor: '2026-08-15T12:00:10.000Z' },
    { key: '00000000-0000-4000-8000-000000000201', scheduledFor: '2026-08-15T12:00:10.000Z' },
    { key: '00000000-0000-4000-8000-000000000202', scheduledFor: '2026-08-15T12:00:30.000Z' },
  ]);
  assert.equal(repository.snapshot().length, 0);
});

test('a reloaded ordinary Send recovers the unresolved explicit schedule for the same Draft', async () => {
  const {
    createOutboundSendAttemptCoordinator,
    sendOutboundMessage,
  } = loadTypeScriptModule('../src/mail/immediate-send.ts');
  const repository = atomicAttemptRepository();
  const keys = [
    '00000000-0000-4000-8000-000000000301',
    '00000000-0000-4000-8000-000000000302',
  ];
  const coordinatorOptions = {
    repository,
    createKey: () => keys.shift(),
    now: () => Date.parse('2026-08-15T12:00:00.000Z'),
  };
  const scope = { mailbox: 'owner@example.test', draftId: 'draft-301' };
  const formData = new FormData();
  formData.set('to', 'recipient@example.test');
  formData.set('html', '<p>scheduled after reload</p>');
  const submissions = [];

  await assert.rejects(sendOutboundMessage({
    scope,
    formData,
    delivery: { kind: 'scheduled', scheduledFor: '2026-08-22T19:15:00.000Z' },
    attempts: createOutboundSendAttemptCoordinator(coordinatorOptions),
    submit: async (payload, key) => {
      submissions.push({ key, scheduledFor: payload.get('scheduledFor') });
      throw new TypeError('connection reset');
    },
  }), /connection reset/);

  await sendOutboundMessage({
    scope,
    formData,
    delivery: { kind: 'undo', scheduledFor: '2026-08-15T12:00:15.000Z' },
    attempts: createOutboundSendAttemptCoordinator(coordinatorOptions),
    submit: async (payload, key) => {
      submissions.push({ key, scheduledFor: payload.get('scheduledFor') });
      return { success: true, scheduledId: 301, sendAt: String(payload.get('scheduledFor')) };
    },
  });

  assert.deepEqual(submissions, [
    { key: '00000000-0000-4000-8000-000000000301', scheduledFor: '2026-08-22T19:15:00.000Z' },
    { key: '00000000-0000-4000-8000-000000000301', scheduledFor: '2026-08-22T19:15:00.000Z' },
  ]);
  assert.equal(repository.snapshot().length, 0);
});

test('browser storage failure stops safely before the message POST', async () => {
  const {
    createBrowserOutboundSendAttemptCoordinator,
    sendOutboundMessage,
  } = loadTypeScriptModule('../src/mail/immediate-send.ts');
  const formData = new FormData();
  formData.set('to', 'recipient@example.test');
  formData.set('body', 'do not send without recovery state');
  let submissions = 0;

  await assert.rejects(sendOutboundMessage({
    scope: { mailbox: 'owner@example.test', replyParent: '<parent@example.test>' },
    formData,
    delivery: { kind: 'immediate' },
    attempts: createBrowserOutboundSendAttemptCoordinator({ indexedDb: null }),
    submit: async () => {
      submissions += 1;
      return { success: true, deliveryStatus: 'accepted' };
    },
  }), /safe send recovery storage is unavailable/i);
  assert.equal(submissions, 0);
});

test('browser storage can retry after a transient IndexedDB open failure', async () => {
  const {
    createIndexedDbOutboundSendAttemptRepository,
  } = loadTypeScriptModule('../src/mail/immediate-send.ts');
  const realIndexedDb = new IDBFactory();
  let opens = 0;
  const flakyIndexedDb = {
    open(name, version) {
      opens += 1;
      if (opens > 1) return realIndexedDb.open(name, version);
      const request = {};
      queueMicrotask(() => {
        request.error = new Error('temporary open failure');
        request.onerror();
      });
      return request;
    },
  };
  const repository = createIndexedDbOutboundSendAttemptRepository(flakyIndexedDb);

  await assert.rejects(repository.update(records => ({ records, value: undefined })), /could not be opened/i);
  await repository.update(records => ({ records, value: undefined }));
  assert.equal(opens, 2);
});

test('an invalid generated key is rejected before persistence or POST', async () => {
  const {
    createOutboundSendAttemptCoordinator,
    sendOutboundMessage,
  } = loadTypeScriptModule('../src/mail/immediate-send.ts');
  const repository = atomicAttemptRepository();
  let submissions = 0;
  const formData = new FormData();
  formData.set('to', 'recipient@example.test');

  await assert.rejects(sendOutboundMessage({
    scope: { mailbox: 'owner@example.test', draftId: 'draft-invalid-key' },
    formData,
    delivery: { kind: 'immediate' },
    attempts: createOutboundSendAttemptCoordinator({
      repository,
      createKey: () => 'not-a-uuid',
    }),
    submit: async () => {
      submissions += 1;
      return { success: true, deliveryStatus: 'accepted' };
    },
  }), /valid UUID/i);
  assert.equal(repository.snapshot().length, 0);
  assert.equal(submissions, 0);
});

test('a delayed send requires an absolute scheduledFor before persistence or POST', async () => {
  const {
    createOutboundSendAttemptCoordinator,
    sendOutboundMessage,
  } = loadTypeScriptModule('../src/mail/immediate-send.ts');
  const repository = atomicAttemptRepository();
  let submissions = 0;
  const formData = new FormData();
  formData.set('to', 'recipient@example.test');

  await assert.rejects(sendOutboundMessage({
    scope: { mailbox: 'owner@example.test', draftId: 'draft-invalid-schedule' },
    formData,
    delivery: { kind: 'undo', scheduledFor: 'ten seconds from now' },
    attempts: createOutboundSendAttemptCoordinator({ repository }),
    submit: async () => {
      submissions += 1;
      return { success: true, scheduledId: 91 };
    },
  }), /absolute scheduledFor/i);
  assert.equal(repository.snapshot().length, 0);
  assert.equal(submissions, 0);
});

test('stale non-uncertain attempts expire while future schedules and uncertainty remain protected', async () => {
  const {
    createOutboundSendAttemptCoordinator,
  } = loadTypeScriptModule('../src/mail/immediate-send.ts');
  const repository = atomicAttemptRepository();
  const keys = [
    '00000000-0000-4000-8000-000000000401',
    '00000000-0000-4000-8000-000000000402',
    '00000000-0000-4000-8000-000000000403',
    '00000000-0000-4000-8000-000000000404',
  ];
  let now = Date.parse('2026-01-01T00:00:00.000Z');
  const attempts = createOutboundSendAttemptCoordinator({
    repository,
    createKey: () => keys.shift(),
    now: () => now,
  });
  const immediateRequest = {
    scope: { mailbox: 'owner@example.test', draftId: 'draft-expiring' },
    fingerprint: 'expiring content',
    delivery: { kind: 'immediate' },
  };
  const first = await attempts.prepare(immediateRequest);
  now += 31 * 24 * 60 * 60 * 1000;
  const expiredReplacement = await attempts.prepare(immediateRequest);
  assert.notEqual(expiredReplacement.key, first.key);

  const scheduledRequest = {
    scope: { mailbox: 'owner@example.test', draftId: 'draft-future' },
    fingerprint: 'future content',
    delivery: { kind: 'scheduled', scheduledFor: '2026-07-01T00:00:00.000Z' },
  };
  const future = await attempts.prepare(scheduledRequest);
  now += 31 * 24 * 60 * 60 * 1000;
  assert.equal((await attempts.prepare(scheduledRequest)).key, future.key);

  const uncertain = await attempts.prepare({
    scope: { mailbox: 'owner@example.test', draftId: 'draft-uncertain-retained' },
    fingerprint: 'uncertain content',
    delivery: { kind: 'immediate' },
  });
  await attempts.markUncertain(uncertain);
  now += 365 * 24 * 60 * 60 * 1000;
  const protectedAttempt = await attempts.prepare({
    scope: { mailbox: 'owner@example.test', draftId: 'draft-uncertain-retained' },
    fingerprint: 'uncertain content',
    delivery: { kind: 'immediate' },
  });
  assert.equal(protectedAttempt.key, uncertain.key);
  assert.equal(protectedAttempt.blocked, true);
});

test('message fingerprints survive attachment rehydration without exposing attachment bytes', async () => {
  const {
    outboundMessageFingerprint,
  } = loadTypeScriptModule('../src/mail/immediate-send.ts');
  const makeForm = (contents, lastModified) => {
    const formData = new FormData();
    formData.set('to', 'recipient@example.test');
    formData.set('subject', 'Attachment recovery');
    formData.set('draftId', 'draft changes are outside the message fingerprint');
    formData.set('attachments', new File([contents], 'report.txt', {
      type: 'text/plain',
      lastModified,
    }));
    return formData;
  };

  const original = await outboundMessageFingerprint(makeForm('private attachment bytes', 1));
  const rehydrated = await outboundMessageFingerprint(makeForm('private attachment bytes', 999999));
  const mutated = await outboundMessageFingerprint(makeForm('different attachment bytes', 999999));
  assert.equal(rehydrated, original);
  assert.notEqual(mutated, original);
  assert.match(original, /^[0-9a-f]{64}$/);
  assert.equal(original.includes('private attachment bytes'), false);
});

test('an ambiguous composer retry retains its key and a content mutation rotates it', async () => {
  const {
    createOutboundSendAttemptCoordinator,
    sendOutboundMessage,
  } = loadTypeScriptModule('../src/mail/immediate-send.ts');
  const repository = atomicAttemptRepository();
  const keys = [
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000002',
  ];
  const attempts = createOutboundSendAttemptCoordinator({ repository, createKey: () => keys.shift() });
  const scope = { mailbox: 'owner@example.test', draftId: 'draft-1' };
  const formData = new FormData();
  formData.set('body', 'revision-1');
  const submittedKeys = [];
  const submit = async (_formData, key) => {
    submittedKeys.push(key);
    throw new TypeError('network disconnected');
  };

  await assert.rejects(sendOutboundMessage({
    scope, formData, delivery: { kind: 'immediate' }, attempts, submit,
  }), /network disconnected/);
  formData.set('body', 'revision-2');
  await assert.rejects(sendOutboundMessage({
    scope, formData, delivery: { kind: 'immediate' }, attempts, submit,
  }), /network disconnected/);

  assert.deepEqual(submittedKeys, [
    '00000000-0000-4000-8000-000000000001',
    '00000000-0000-4000-8000-000000000002',
  ]);
});

test('an unresolved immediate attempt blocks rescheduling the unchanged message after reload', async () => {
  const {
    createOutboundSendAttemptCoordinator,
    sendOutboundMessage,
  } = loadTypeScriptModule('../src/mail/immediate-send.ts');
  const repository = atomicAttemptRepository();
  const keys = [
    '00000000-0000-4000-8000-000000000003',
    '00000000-0000-4000-8000-000000000004',
  ];
  const coordinatorOptions = { repository, createKey: () => keys.shift() };
  const scope = { mailbox: 'owner@example.test', draftId: 'draft-3' };
  const formData = new FormData();
  formData.set('body', 'unchanged unresolved message');
  let submitCount = 0;
  const submit = async () => {
    submitCount += 1;
    throw new TypeError('response lost');
  };

  await assert.rejects(sendOutboundMessage({
    scope,
    formData,
    delivery: { kind: 'immediate' },
    attempts: createOutboundSendAttemptCoordinator(coordinatorOptions),
    submit,
  }), /response lost/);
  await assert.rejects(sendOutboundMessage({
    scope,
    formData,
    delivery: { kind: 'scheduled', scheduledFor: '2026-08-16T12:00:00.000Z' },
    attempts: createOutboundSendAttemptCoordinator(coordinatorOptions),
    submit,
  }), /Confirm its delivery before changing the schedule/);

  assert.equal(submitCount, 1);
});

test('pending delivery polls the owner-scoped URL and a terminal failure rotates the key', async () => {
  const {
    createOutboundSendAttemptCoordinator,
    sendOutboundMessage,
  } = loadTypeScriptModule('../src/mail/immediate-send.ts');
  const repository = atomicAttemptRepository();
  const keys = [
    '00000000-0000-4000-8000-000000000011',
    '00000000-0000-4000-8000-000000000012',
  ];
  const attempts = createOutboundSendAttemptCoordinator({ repository, createKey: () => keys.shift() });
  const scope = { mailbox: 'owner@example.test', replyParent: '<message-11@example.test>' };
  const formData = new FormData();
  formData.set('body', 'pending reply');
  const submittedKeys = [];
  const pendingStates = [];
  const statusUrls = [];
  const waits = [];
  let submitCount = 0;
  let statusCount = 0;
  const submit = async (_formData, key) => {
    submittedKeys.push(key);
    submitCount += 1;
    if (submitCount === 1) {
      return {
        success: true,
        outboundId: 91,
        deliveryStatus: 'pending',
        statusUrl: '/api/messages/outbound/91',
        retryAfterMs: 750,
      };
    }
    return { success: true, deliveryStatus: 'accepted', sentCopyStatus: 'saved' };
  };

  const failed = await sendOutboundMessage({
    scope,
    formData,
    delivery: { kind: 'immediate' },
    attempts,
    submit,
    loadStatus: async url => {
      statusUrls.push(url);
      statusCount += 1;
      if (statusCount === 1) {
        return { success: true, outboundId: 91, deliveryStatus: 'pending', retryAfterMs: 10 };
      }
      return { success: true, outboundId: 91, deliveryStatus: 'failed', error: 'SMTP rejected the message' };
    },
    wait: async milliseconds => { waits.push(milliseconds); },
    onPending: result => pendingStates.push(result.deliveryStatus),
  });
  assert.equal(failed.deliveryStatus, 'failed');

  await sendOutboundMessage({
    scope, formData, delivery: { kind: 'immediate' }, attempts, submit,
  });

  assert.deepEqual(pendingStates, ['pending', 'pending']);
  assert.deepEqual(statusUrls, ['/api/messages/outbound/91', '/api/messages/outbound/91']);
  assert.deepEqual(waits, [750, 250]);
  assert.deepEqual(submittedKeys, [
    '00000000-0000-4000-8000-000000000011',
    '00000000-0000-4000-8000-000000000012',
  ]);
});

test('a status lookup failure after durable acknowledgement retains the logical-send key', async () => {
  const {
    createOutboundSendAttemptCoordinator,
    sendOutboundMessage,
  } = loadTypeScriptModule('../src/mail/immediate-send.ts');
  const repository = atomicAttemptRepository();
  const keys = [
    '00000000-0000-4000-8000-000000000013',
    '00000000-0000-4000-8000-000000000014',
  ];
  const attempts = createOutboundSendAttemptCoordinator({ repository, createKey: () => keys.shift() });
  const scope = { mailbox: 'owner@example.test', replyParent: '<message-13@example.test>' };
  const formData = new FormData();
  formData.set('body', 'retain after an expired polling session');
  const submittedKeys = [];
  let submission = 0;
  const submit = async (_formData, key) => {
    submittedKeys.push(key);
    submission += 1;
    return submission === 1
      ? {
        success: true,
        outboundId: 93,
        deliveryStatus: 'pending',
        statusUrl: '/api/messages/outbound/93',
      }
      : { success: true, deliveryStatus: 'accepted', sentCopyStatus: 'saved' };
  };
  const expiredSession = Object.assign(new Error('Not authenticated'), {
    definitive: true,
    status: 401,
  });

  await assert.rejects(sendOutboundMessage({
    scope,
    formData,
    delivery: { kind: 'immediate' },
    attempts,
    submit,
    loadStatus: async () => { throw expiredSession; },
    wait: async () => undefined,
  }), /Not authenticated/);
  await sendOutboundMessage({
    scope,
    formData,
    delivery: { kind: 'immediate' },
    attempts,
    submit,
  });

  assert.deepEqual(submittedKeys, [
    '00000000-0000-4000-8000-000000000013',
    '00000000-0000-4000-8000-000000000013',
  ]);
});

test('an uncertain terminal result blocks an unchanged resend but mutation starts a new logical send', async () => {
  const {
    createOutboundSendAttemptCoordinator,
    sendOutboundMessage,
  } = loadTypeScriptModule('../src/mail/immediate-send.ts');
  const repository = atomicAttemptRepository();
  const keys = [
    '00000000-0000-4000-8000-000000000021',
    '00000000-0000-4000-8000-000000000022',
  ];
  const coordinatorOptions = { repository, createKey: () => keys.shift() };
  const scope = { mailbox: 'owner@example.test', draftId: 'draft-21' };
  const formData = new FormData();
  formData.set('body', 'revision-1');
  let submitCount = 0;
  const submit = async () => {
    submitCount += 1;
    return submitCount === 1
      ? { success: true, deliveryStatus: 'uncertain' }
      : { success: true, deliveryStatus: 'accepted', sentCopyStatus: 'saved' };
  };

  await sendOutboundMessage({
    scope,
    formData,
    delivery: { kind: 'immediate' },
    attempts: createOutboundSendAttemptCoordinator(coordinatorOptions),
    submit,
  });
  await assert.rejects(
    sendOutboundMessage({
      scope,
      formData,
      delivery: { kind: 'immediate' },
      attempts: createOutboundSendAttemptCoordinator(coordinatorOptions),
      submit,
    }),
    /Do not resend until you verify/,
  );
  formData.set('body', 'revision-2');
  await sendOutboundMessage({
    scope,
    formData,
    delivery: { kind: 'immediate' },
    attempts: createOutboundSendAttemptCoordinator(coordinatorOptions),
    submit,
  });
  assert.equal(submitCount, 2);
});

test('an uncertain immediate attempt blocks rescheduling the unchanged message after reload', async () => {
  const {
    createOutboundSendAttemptCoordinator,
    sendOutboundMessage,
  } = loadTypeScriptModule('../src/mail/immediate-send.ts');
  const repository = atomicAttemptRepository();
  const keys = [
    '00000000-0000-4000-8000-000000000023',
    '00000000-0000-4000-8000-000000000024',
  ];
  const coordinatorOptions = { repository, createKey: () => keys.shift() };
  const scope = { mailbox: 'owner@example.test', draftId: 'draft-23' };
  const formData = new FormData();
  formData.set('body', 'unchanged uncertain message');
  let submitCount = 0;
  const submit = async () => {
    submitCount += 1;
    return { success: true, deliveryStatus: 'uncertain' };
  };

  await sendOutboundMessage({
    scope,
    formData,
    delivery: { kind: 'immediate' },
    attempts: createOutboundSendAttemptCoordinator(coordinatorOptions),
    submit,
  });
  await assert.rejects(sendOutboundMessage({
    scope,
    formData,
    delivery: { kind: 'scheduled', scheduledFor: '2026-08-16T12:00:00.000Z' },
    attempts: createOutboundSendAttemptCoordinator(coordinatorOptions),
    submit,
  }), /Do not resend until you verify/);

  assert.equal(submitCount, 1);
});

test('explicitly verified non-delivery clears uncertainty and rotates the next send key', async () => {
  const { createOutboundSendAttemptCoordinator } = loadTypeScriptModule('../src/mail/immediate-send.ts');
  const repository = atomicAttemptRepository();
  const keys = [
    '00000000-0000-4000-8000-000000000025',
    '00000000-0000-4000-8000-000000000026',
  ];
  const attempts = createOutboundSendAttemptCoordinator({ repository, createKey: () => keys.shift() });
  const request = {
    scope: { mailbox: 'owner@example.test', draftId: 'draft-25' },
    fingerprint: 'verified non-delivery',
    delivery: { kind: 'immediate' },
  };
  const first = await attempts.prepare(request);
  await attempts.markUncertain(first);
  const blocked = await attempts.prepare(request);

  assert.equal(blocked.blocked, true);
  assert.equal(blocked.blockReason, 'delivery_uncertain');
  await attempts.markDefinitive(blocked);
  const retry = await attempts.prepare(request);
  assert.equal(retry.blocked, false);
  assert.notEqual(retry.key, first.key);
});

test('checking a protected earlier send keeps its key unless delivery definitively failed', async () => {
  const {
    checkProtectedOutboundSendAttempt,
    createOutboundSendAttemptCoordinator,
  } = loadTypeScriptModule('../src/mail/immediate-send.ts');
  const scheduledFor = '2026-08-16T12:00:00.000Z';
  const cases = [
    ['accepted', { success: true, deliveryStatus: 'accepted' }],
    ['partial', {
      success: true,
      deliveryStatus: 'partial',
      rejectedRecipients: ['rejected@example.test'],
    }],
    ['scheduled', {
      success: true,
      submissionKind: 'scheduled',
      scheduledId: 88,
      sendAt: scheduledFor,
      deliveryStatus: 'pending',
    }],
    ['pending', { success: true, deliveryStatus: 'pending' }],
    ['uncertain', { success: true, deliveryStatus: 'uncertain' }],
    ['uncertain', {
      success: true,
      submissionKind: 'scheduled',
      scheduledId: 89,
      sendAt: scheduledFor,
      deliveryStatus: 'uncertain',
    }],
    ['failed', { success: true, deliveryStatus: 'failed', error: 'Mailbox unavailable' }],
  ];

  for (const [expectedState, statusResult] of cases) {
    const repository = atomicAttemptRepository();
    const keys = [
      '00000000-0000-4000-8000-000000000041',
      '00000000-0000-4000-8000-000000000042',
    ];
    const attempts = createOutboundSendAttemptCoordinator({
      repository,
      createKey: () => keys.shift(),
    });
    const scope = { mailbox: 'owner@example.test', draftId: `draft-check-${expectedState}` };
    const fingerprint = `protected ${expectedState} content`;
    const first = await attempts.prepare({
      scope,
      fingerprint,
      delivery: { kind: 'immediate' },
    });
    const protectedAttempt = await attempts.prepare({
      scope,
      fingerprint,
      delivery: { kind: 'scheduled', scheduledFor },
    });
    assert.equal(protectedAttempt.blocked, true);
    assert.equal(protectedAttempt.blockReason, 'delivery_change_pending');

    const queriedKeys = [];
    const outcome = await checkProtectedOutboundSendAttempt({
      attempt: protectedAttempt,
      attempts,
      loadStatus: async key => {
        queriedKeys.push(key);
        return statusResult;
      },
    });

    assert.equal(outcome.state, expectedState);
    assert.deepEqual(queriedKeys, [first.key]);
    const afterCheck = await attempts.prepare({
      scope,
      fingerprint,
      delivery: { kind: 'scheduled', scheduledFor },
    });
    if (expectedState === 'failed') {
      assert.equal(afterCheck.blocked, false);
      assert.notEqual(afterCheck.key, first.key);
    } else {
      assert.equal(afterCheck.blocked, true);
      assert.equal(afterCheck.key, first.key);
    }
  }

  const repository = atomicAttemptRepository();
  const attempts = createOutboundSendAttemptCoordinator({
    repository,
    createKey: () => '00000000-0000-4000-8000-000000000043',
  });
  const attempt = await attempts.prepare({
    scope: { mailbox: 'owner@example.test', draftId: 'draft-check-unavailable' },
    fingerprint: 'protected unavailable content',
    delivery: { kind: 'immediate' },
  });
  const protectedAttempt = await attempts.prepare({
    scope: { mailbox: 'owner@example.test', draftId: 'draft-check-unavailable' },
    fingerprint: 'protected unavailable content',
    delivery: { kind: 'scheduled', scheduledFor },
  });
  const unavailable = await checkProtectedOutboundSendAttempt({
    attempt: protectedAttempt,
    attempts,
    loadStatus: async key => {
      assert.equal(key, attempt.key);
      throw new Error('Status service unavailable');
    },
  });
  assert.equal(unavailable.state, 'unavailable');
  assert.equal((await attempts.prepare({
    scope: { mailbox: 'owner@example.test', draftId: 'draft-check-unavailable' },
    fingerprint: 'protected unavailable content',
    delivery: { kind: 'scheduled', scheduledFor },
  })).key, attempt.key);
});

test('a bounded pending poll returns control without rotating the logical-send key', async () => {
  const {
    createOutboundSendAttemptCoordinator,
    sendOutboundMessage,
  } = loadTypeScriptModule('../src/mail/immediate-send.ts');
  const attempts = createOutboundSendAttemptCoordinator({
    repository: atomicAttemptRepository(),
    createKey: () => '00000000-0000-4000-8000-000000000031',
  });
  const scope = { mailbox: 'owner@example.test', replyParent: '<message-31@example.test>' };
  const formData = new FormData();
  formData.set('body', 'bounded pending');
  const submittedKeys = [];
  let submission = 0;
  const submit = async (_formData, key) => {
    submittedKeys.push(key);
    submission += 1;
    return submission === 1
      ? {
        success: true,
        outboundId: 31,
        deliveryStatus: 'pending',
        statusUrl: '/api/messages/outbound/31',
        retryAfterMs: 1,
      }
      : { success: true, deliveryStatus: 'accepted' };
  };

  await assert.rejects(sendOutboundMessage({
    scope,
    formData,
    delivery: { kind: 'immediate' },
    attempts,
    submit,
    loadStatus: async () => ({ success: true, deliveryStatus: 'pending' }),
    wait: async () => undefined,
    maxPolls: 2,
  }), /still pending/);
  await sendOutboundMessage({
    scope, formData, delivery: { kind: 'immediate' }, attempts, submit,
  });
  assert.deepEqual(submittedKeys, [
    '00000000-0000-4000-8000-000000000031',
    '00000000-0000-4000-8000-000000000031',
  ]);
});

test('compose and inline reply route every delivery mode through the persistent lifecycle', () => {
  const source = fs.readFileSync(
    path.resolve(__dirname, '../src/mail/hooks/useMail.ts'),
    'utf8',
  );

  assert.match(source, /createBrowserOutboundSendAttemptCoordinator/);
  assert.equal((source.match(/sendOutboundMessage\(/g) || []).length, 2);
  assert.match(source, /await saveCurrentDraft\(\)[\s\S]*draftId/);
  assert.match(source, /scheduledFor/);
  assert.match(source, /reconcileMailbox\([\s\S]*fetchOutboundMessageStatusByKey/);
  assert.match(source, /confirmed.*earlier scheduled/);
  assert.match(source, /could not check earlier send status/);
  assert.doesNotMatch(source, /New messages will remain unsent/);
  assert.doesNotMatch(source, /append\('delaySeconds'/);
  assert.doesNotMatch(source, /await api\.sendMessage\(formData\)/);
  assert.match(source, /immediateSendPhase/);
  assert.match(source, /Delivery status is uncertain[\s\S]*Do not resend/);

  const viewer = fs.readFileSync(
    path.resolve(__dirname, '../src/mail/MessageViewer.tsx'),
    'utf8',
  );
  assert.match(viewer, /I verified it was not delivered/);
  assert.match(viewer, /allowReplyRetryAfterVerifiedNonDelivery/);

  const layout = fs.readFileSync(
    path.resolve(__dirname, '../src/mail/MailLayout.tsx'),
    'utf8',
  );
  assert.match(layout, /outboundRecoveryNotice/);
  assert.match(layout, /role="status"/);
});

test('mail layout renders the recovered-send notice as a calm dismissible status', () => {
  const { MailLayout } = loadMailLayoutModule();
  const markup = renderToStaticMarkup(React.createElement(MailLayout, {
    mail: {
      outboundRecoveryNotice: {
        tone: 'info',
        message: 'OpenMailStack is still confirming one earlier send.',
      },
      setOutboundRecoveryNotice: () => undefined,
      folders: [],
      activeFolder: 'INBOX',
      expandedFolders: {},
      setExpandedFolders: () => undefined,
      startCompose: () => undefined,
      userQuota: null,
      mailUndo: null,
      undoAction: () => undefined,
      setMailUndo: () => undefined,
    },
  }));

  assert.match(markup, /class="mail-send-recovery-notice info"/);
  assert.match(markup, /role="status"/);
  assert.match(markup, /OpenMailStack is still confirming one earlier send/);
  assert.match(markup, /aria-label="Dismiss send recovery notice"/);
});
