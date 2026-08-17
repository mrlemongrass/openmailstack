const assert = require('node:assert/strict');
const test = require('node:test');

const { WbxmlParser } = require('../src/wbxml/parser.js');
const { WbxmlWriter } = require('../src/wbxml/writer.js');
const {
  activeSyncMailCollectionId,
  activeSyncMailMessageServerId,
} = require('../src/eas-protocol.js');
const {
  ITEM_OPERATIONS_MAX_AGGREGATE_SOURCE_BYTES,
  ITEM_OPERATIONS_MAX_BODY_BYTES,
  ITEM_OPERATIONS_MAX_FETCHES,
  ITEM_OPERATIONS_MAX_RESPONSE_BODY_BYTES,
  ITEM_OPERATIONS_MAX_SOURCE_BYTES,
  itemOperationsBodyAllowance,
  itemOperationsFetchRequest,
  itemOperationsFetchError,
  itemOperationsFetchBodyBytes,
  itemOperationsFetchSuccess,
  itemOperationsMailboxTarget,
  itemOperationsRequestFetches,
  itemOperationsSourceAllowance,
} = require('../src/eas-item-operations.js');

const child = (node, tag) => node.children.find(candidate => candidate.tag === tag);

test('ItemOperations Fetch uses ItemOperations, AirSync, Email, and AirSyncBase namespaces correctly', async () => {
  const source = Buffer.from([
    'From: Sender <sender@example.test>',
    'To: Recipient <recipient@example.test>',
    'Subject: Namespace proof',
    'Date: Mon, 20 Jul 2026 12:00:00 +0000',
    'Content-Type: text/plain; charset=utf-8',
    '',
    'hello 👋 world',
  ].join('\r\n'));
  const fetch = await itemOperationsFetchSuccess({
    collectionId: 'SU5CT1g=',
    serverId: 'SU5CT1g=-9',
    message: {
      uid: 9,
      flags: ['\\Seen'],
      source,
      size: source.length,
      sourceComplete: true,
    },
    maxBodyBytes: 9,
    bodyPreferences: [{ bodyType: 1, maxBodyBytes: 9, allowTruncation: true }],
  });
  const response = {
    tag: 'ItemOperations', page: 20, children: [
      { tag: 'Status', page: 20, content: '1' },
      { tag: 'Response', page: 20, children: [fetch] },
    ],
  };

  const writer = new WbxmlWriter();
  assert.doesNotThrow(() => writer.writeNode(response));
  const decoded = new WbxmlParser(writer.getBuffer()).parse();
  const decodedFetch = child(child(decoded, 'Response'), 'Fetch');
  const properties = child(decodedFetch, 'Properties');
  const body = child(properties, 'Body');

  assert.equal(decoded.page, 20);
  assert.equal(decodedFetch.page, 20);
  assert.equal(child(decodedFetch, 'Status').page, 20);
  assert.equal(child(decodedFetch, 'CollectionId').page, 0);
  assert.equal(child(decodedFetch, 'ServerId').page, 0);
  assert.equal(child(decodedFetch, 'Class').page, 0);
  assert.equal(properties.page, 20);
  assert.equal(child(properties, 'Subject').page, 2);
  assert.equal(body.page, 17);
  assert.equal(child(body, 'Data').content, 'hello ');
  assert.equal(child(body, 'EstimatedDataSize').content, String(Buffer.byteLength('hello 👋 world')));
  assert.equal(child(body, 'Truncated').content, '1');
});

test('ItemOperations Fetch returns bounded per-item protocol errors', async () => {
  assert.equal(ITEM_OPERATIONS_MAX_FETCHES, 100);
  assert.equal(ITEM_OPERATIONS_MAX_SOURCE_BYTES, 16 * 1024 * 1024);
  assert.equal(ITEM_OPERATIONS_MAX_BODY_BYTES, 10 * 1024 * 1024);
  assert.equal(ITEM_OPERATIONS_MAX_RESPONSE_BODY_BYTES, 16 * 1024 * 1024);
  assert.equal(ITEM_OPERATIONS_MAX_AGGREGATE_SOURCE_BYTES, 16 * 1024 * 1024);

  for (const [status, expected] of [['2', '2'], ['6', '6'], ['11', '11'], ['14', '14']]) {
    const fetch = itemOperationsFetchError('SU5CT1g=', 'SU5CT1g=-9', status);
    assert.equal(child(fetch, 'Status').content, expected);
    const writer = new WbxmlWriter();
    assert.doesNotThrow(() => writer.writeNode({
      tag: 'ItemOperations', page: 20, children: [
        { tag: 'Status', page: 20, content: '1' },
        { tag: 'Response', page: 20, children: [fetch] },
      ],
    }));
  }

  const oversized = await itemOperationsFetchSuccess({
    collectionId: 'SU5CT1g=',
    serverId: 'SU5CT1g=-9',
    message: {
      uid: 9,
      flags: [],
      source: Buffer.from('partial'),
      size: ITEM_OPERATIONS_MAX_SOURCE_BYTES + 1,
      sourceComplete: false,
    },
    maxBodyBytes: ITEM_OPERATIONS_MAX_BODY_BYTES,
    bodyPreferences: [{
      bodyType: 1,
      maxBodyBytes: ITEM_OPERATIONS_MAX_BODY_BYTES,
      allowTruncation: false,
    }],
  });
  assert.equal(child(oversized, 'Status').content, '11');
  assert.equal(child(oversized, 'Properties'), undefined);
});

test('ItemOperations validates required Mailbox Store and item identifiers per Fetch', () => {
  const collectionId = 'SU5CT1g=';
  const serverId = activeSyncMailMessageServerId(collectionId, 9);
  const folders = [{ path: 'INBOX', delimiter: '/' }];

  assert.deepEqual(itemOperationsMailboxTarget('', collectionId, serverId, folders), { ok: false, status: '2' });
  assert.deepEqual(itemOperationsMailboxTarget('DocumentLibrary', collectionId, serverId, folders), { ok: false, status: '9' });
  assert.deepEqual(itemOperationsMailboxTarget('Mailbox', 'mock-notes', serverId, folders), { ok: false, status: '2' });
  assert.deepEqual(itemOperationsMailboxTarget('Mailbox', collectionId, 'wrong-9', folders), { ok: false, status: '2' });
  assert.deepEqual(itemOperationsMailboxTarget('Mailbox', collectionId, `i-${'9'.repeat(1_000)}-9`, folders), { ok: false, status: '2' });
  assert.deepEqual(itemOperationsMailboxTarget(
    'Mailbox',
    collectionId,
    activeSyncMailMessageServerId(collectionId, 4294967296),
    folders,
  ), { ok: false, status: '2' });
  assert.deepEqual(itemOperationsMailboxTarget('Mailbox', collectionId, serverId, folders), {
    ok: true,
    folderPath: 'INBOX',
    uid: 9,
  });
});

test('ItemOperations resolves the opaque mail identifiers emitted by Sync within the authenticated folder set', () => {
  const collectionId = activeSyncMailCollectionId('INBOX');
  const serverId = activeSyncMailMessageServerId(collectionId, 54);
  const archiveCollectionId = activeSyncMailCollectionId('Archive');
  const archiveServerId = activeSyncMailMessageServerId(archiveCollectionId, 73);
  const folders = [
    { path: 'INBOX', delimiter: '/' },
    { path: 'Archive', delimiter: '/' },
  ];

  assert.deepEqual(itemOperationsMailboxTarget('Mailbox', collectionId, serverId, folders), {
    ok: true,
    folderPath: 'INBOX',
    uid: 54,
  });
  assert.deepEqual(itemOperationsMailboxTarget('Mailbox', archiveCollectionId, archiveServerId, folders), {
    ok: true,
    folderPath: 'Archive',
    uid: 73,
  });
  assert.deepEqual(itemOperationsMailboxTarget('Mailbox', collectionId, serverId, [
    { path: 'Archive', delimiter: '/' },
  ]), { ok: false, status: '2' });

  assert.deepEqual(
    itemOperationsMailboxTarget('Mailbox', archiveCollectionId, serverId, folders),
    { ok: false, status: '2' },
  );

  const unlistedLegacyCollectionId = Buffer.from('Private').toString('base64');
  assert.deepEqual(itemOperationsMailboxTarget(
    'Mailbox',
    unlistedLegacyCollectionId,
    activeSyncMailMessageServerId(unlistedLegacyCollectionId, 54),
    folders,
  ), { ok: false, status: '2' });

  const prefix = serverId.slice(0, serverId.lastIndexOf('-') + 1);
  for (const malformedServerId of [
    `${prefix}054`,
    `${prefix}-54`,
    `${prefix}54suffix`,
    `${prefix}0`,
  ]) {
    assert.deepEqual(
      itemOperationsMailboxTarget('Mailbox', collectionId, malformedServerId, folders),
      { ok: false, status: '2' },
    );
  }
  assert.deepEqual(itemOperationsMailboxTarget('Mailbox', collectionId, serverId), { ok: false, status: '2' });
});

test('ItemOperations enforces one aggregate UTF-8 body budget across Fetches', async () => {
  let remaining = 16;
  const first = itemOperationsBodyAllowance(remaining, 10);
  assert.equal(first, 10);
  remaining -= first;
  const second = itemOperationsBodyAllowance(remaining, 10);
  assert.equal(second, 6);
  remaining -= second;
  assert.equal(itemOperationsBodyAllowance(remaining, 1), 0);

  const fetch = await itemOperationsFetchSuccess({
    collectionId: 'SU5CT1g=',
    serverId: 'SU5CT1g=-9',
    message: {
      uid: 9,
      flags: [],
      source: Buffer.from('Subject: budget\r\n\r\nhello 👋'),
      size: Buffer.byteLength('Subject: budget\r\n\r\nhello 👋'),
      sourceComplete: true,
    },
    maxBodyBytes: 9,
    bodyPreferences: [{ bodyType: 1, maxBodyBytes: 9, allowTruncation: true }],
  });
  assert.equal(itemOperationsFetchBodyBytes(fetch), 6);

  let sourceRemaining = ITEM_OPERATIONS_MAX_AGGREGATE_SOURCE_BYTES;
  const firstSource = itemOperationsSourceAllowance(sourceRemaining);
  assert.equal(firstSource, ITEM_OPERATIONS_MAX_SOURCE_BYTES);
  sourceRemaining -= firstSource;
  assert.equal(itemOperationsSourceAllowance(sourceRemaining), 0);
});

test('ItemOperations validates request namespaces and selects one of multiple BodyPreferences', () => {
  const validFetch = {
    tag: 'Fetch', page: 20, children: [
      { tag: 'Store', page: 20, content: 'Mailbox' },
      { tag: 'CollectionId', page: 0, content: 'SU5CT1g=' },
      { tag: 'ServerId', page: 0, content: 'SU5CT1g=-9' },
      { tag: 'Options', page: 20, children: [
        { tag: 'BodyPreference', page: 17, children: [
          { tag: 'Type', page: 17, content: '4' },
          { tag: 'TruncationSize', page: 17, content: '128' },
          { tag: 'AllOrNone', page: 17, content: '0' },
        ] },
        { tag: 'BodyPreference', page: 17, children: [
          { tag: 'Type', page: 17, content: '1' },
          { tag: 'TruncationSize', page: 17, content: '64' },
        ] },
      ] },
    ],
  };
  const root = { tag: 'ItemOperations', page: 20, children: [validFetch] };
  assert.deepEqual(itemOperationsRequestFetches(root), [validFetch]);
  assert.deepEqual(itemOperationsFetchRequest(validFetch), {
    ok: true,
    store: 'Mailbox',
    collectionId: 'SU5CT1g=',
    serverId: 'SU5CT1g=-9',
    bodyPreferences: [
      { bodyType: 4, maxBodyBytes: 128, allowTruncation: true },
      { bodyType: 1, maxBodyBytes: 64, allowTruncation: true },
    ],
  });
  const reorderedFetch = structuredClone(validFetch);
  reorderedFetch.children = [
    reorderedFetch.children[3],
    reorderedFetch.children[2],
    reorderedFetch.children[0],
    reorderedFetch.children[1],
  ];
  assert.equal(itemOperationsFetchRequest(reorderedFetch).ok, true);

  assert.equal(itemOperationsRequestFetches({ tag: 'Sync', page: 0, children: [] }), null);
  assert.equal(itemOperationsRequestFetches({
    tag: 'ItemOperations', page: 20, children: [{ ...validFetch, page: 0 }],
  }), null);
  assert.equal(itemOperationsFetchRequest({
    ...validFetch,
    children: validFetch.children.map(node => node.tag === 'CollectionId' ? { ...node, page: 6 } : node),
  }).ok, false);

  const duplicatePreference = structuredClone(validFetch);
  duplicatePreference.children[3].children[1].children[0].content = '4';
  assert.equal(itemOperationsFetchRequest(duplicatePreference).ok, false);

  const unsupportedOption = structuredClone(validFetch);
  unsupportedOption.children[3].children.push({ tag: 'Schema', page: 20, children: [] });
  assert.equal(itemOperationsFetchRequest(unsupportedOption).ok, false);

  const unsupportedPreview = structuredClone(validFetch);
  unsupportedPreview.children[3].children[0].children.push({ tag: 'Preview', page: 17, content: '32' });
  assert.equal(itemOperationsFetchRequest(unsupportedPreview).ok, false);
});

test('ItemOperations does not silently truncate when TruncationSize is omitted or AllOrNone is set', async () => {
  const source = Buffer.from('Subject: complete body\r\n\r\nhello');
  const message = {
    uid: 9,
    flags: [],
    source,
    size: source.length,
    sourceComplete: true,
  };
  const fetch = await itemOperationsFetchSuccess({
    collectionId: 'SU5CT1g=',
    serverId: 'SU5CT1g=-9',
    message,
    maxBodyBytes: 4,
    bodyPreferences: [{ bodyType: 1, maxBodyBytes: 4, allowTruncation: false }],
  });
  assert.equal(child(fetch, 'Status').content, '11');
  assert.equal(child(fetch, 'Properties'), undefined);

  const noTruncationSize = {
    tag: 'Fetch', page: 20, children: [
      { tag: 'Store', page: 20, content: 'Mailbox' },
      { tag: 'CollectionId', page: 0, content: 'SU5CT1g=' },
      { tag: 'ServerId', page: 0, content: 'SU5CT1g=-9' },
      { tag: 'Options', page: 20, children: [{
        tag: 'BodyPreference', page: 17, children: [{ tag: 'Type', page: 17, content: '1' }],
      }] },
    ],
  };
  const parsed = itemOperationsFetchRequest(noTruncationSize);
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.bodyPreferences, [{
    bodyType: 1,
    maxBodyBytes: ITEM_OPERATIONS_MAX_BODY_BYTES,
    allowTruncation: false,
  }]);

  const allOrNone = structuredClone(noTruncationSize);
  allOrNone.children[3].children[0].children.push(
    { tag: 'TruncationSize', page: 17, content: '4' },
    { tag: 'AllOrNone', page: 17, content: '1' },
  );
  const allOrNoneParsed = itemOperationsFetchRequest(allOrNone);
  assert.equal(allOrNoneParsed.ok, true);
  assert.equal(allOrNoneParsed.bodyPreferences[0].allowTruncation, false);

  const fallback = await itemOperationsFetchSuccess({
    collectionId: 'SU5CT1g=',
    serverId: 'SU5CT1g=-9',
    message,
    maxBodyBytes: 5,
    bodyPreferences: [
      { bodyType: 4, maxBodyBytes: 4, allowTruncation: false },
      { bodyType: 1, maxBodyBytes: 5, allowTruncation: true },
    ],
  });
  assert.equal(child(fallback, 'Status').content, '1');
  assert.equal(child(child(fallback, 'Properties'), 'Body').children.find(node => node.tag === 'Type').content, '1');
});
