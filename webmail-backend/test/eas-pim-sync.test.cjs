const assert = require('node:assert/strict');
const test = require('node:test');

process.env.OMS_DB_PASSWORD ||= 'eas-pim-sync-test';
const db = require('../src/db.js');

const {
  MAX_PIM_KNOWN_ITEMS,
  MAX_PIM_KNOWN_ITEMS_BYTES,
  MAX_PIM_ITEM_SOURCE_BYTES,
  MAX_PIM_SNAPSHOT_SOURCE_BYTES,
  MAX_PIM_SYNC_PARTNERSHIPS_PER_USER,
  MAX_PIM_SYNC_RESPONSE_BYTES,
  MAX_PIM_SYNC_ROW_BYTES,
  MAX_PIM_SYNC_USER_BYTES,
  PIM_SYNC_STATE_TTL_MS,
  PimSyncLimitError,
  PimSyncStateError,
  applyAcceptedPimWrites,
  advancePimKnownItems,
  assertPimSnapshotBound,
  assertPimSyncRowBound,
  assertPimKnownItemsBound,
  computePimSyncDelta,
  createPimSyncKey,
  deterministicPimAddServerId,
  fitPimSyncCommandsToByteBudget,
  loadBoundedCalendarPimSnapshot,
  loadBoundedContactPimSnapshot,
  loadPimSyncStateOnConnection,
  normalizePimQuarantineState,
  parsePimSupportedFields,
  parsePimSupportedProperties,
  pimSqlLockName,
  pimItemFingerprint,
  pimOmittedFieldsToClear,
  pimQuarantineCommand,
  pimQuarantineFingerprint,
  pimSyncReplayResponse,
  pimSyncScopeHash,
  pimWireServerId,
  pimSyncStateDisposition,
  parsePimKnownItems,
  serializePimSupportedFields,
  withPimSqlTransaction,
  withPimCollectionLock,
  validatePimClientCommands,
} = require('../src/eas-pim-sync.js');
const { getEasContactByDavUidOnConnection } = require('../src/contact-utils.js');
const {
  normalizeActiveSyncWindowSize,
  parseActiveSyncGetChanges,
  singleActiveSyncCollection,
  validateActiveSyncCollectionRequest,
} = require('../src/eas-sync.js');

test('Sync request distinguishes malformed collection cardinality from the server limit', () => {
  assert.deepEqual(singleActiveSyncCollection({
    tag: 'Sync', page: 0, children: [{ tag: 'Collections', page: 0, children: [] }],
  }), { ok: false, status: '4' });
  assert.deepEqual(singleActiveSyncCollection({
    tag: 'Sync', page: 0, children: [{
      tag: 'Collections', page: 0, children: [
        { tag: 'Collection', page: 0, children: [] },
        { tag: 'Collection', page: 0, children: [] },
      ],
    }],
  }), { ok: false, status: '15' });

  const collection = { tag: 'Collection', page: 0, children: [] };
  assert.deepEqual(singleActiveSyncCollection({
    tag: 'Sync', page: 0, children: [{ tag: 'Collections', page: 0, children: [collection] }],
  }), { ok: true, collection });
  assert.deepEqual(singleActiveSyncCollection({
    tag: 'Sync', page: 0, children: [
      { tag: 'Collections', page: 0, children: [collection] },
      { tag: 'Partial', page: 0, content: '1' },
    ],
  }), { ok: false, status: '4' });
});

test('GetChanges and WindowSize follow ActiveSync key semantics', () => {
  assert.deepEqual(parseActiveSyncGetChanges('0', null), { ok: true, value: false });
  assert.deepEqual(parseActiveSyncGetChanges('0', { content: '0' }), { ok: true, value: false });
  assert.deepEqual(parseActiveSyncGetChanges('0', { content: '' }), { ok: false });
  assert.deepEqual(parseActiveSyncGetChanges('0', { content: '1' }), { ok: false });
  assert.deepEqual(parseActiveSyncGetChanges('oms-pim-key', null), { ok: true, value: true });
  assert.deepEqual(parseActiveSyncGetChanges('oms-pim-key', { content: '0' }), { ok: true, value: false });
  assert.deepEqual(parseActiveSyncGetChanges('oms-pim-key', { content: '2' }), { ok: false });

  assert.equal(normalizeActiveSyncWindowSize(undefined), 100);
  assert.equal(normalizeActiveSyncWindowSize('0'), 512);
  assert.equal(normalizeActiveSyncWindowSize('513'), 512);
  assert.equal(normalizeActiveSyncWindowSize('37'), 37);
  assert.throws(() => normalizeActiveSyncWindowSize(''));
});

test('Collection request validation enforces the 14.1 child schema', () => {
  const valid = {
    tag: 'Collection', page: 0, children: [
      { tag: 'SyncKey', page: 0, content: '0' },
      { tag: 'CollectionId', page: 0, content: 'contacts' },
      { tag: 'Supported', page: 0, children: [] },
      { tag: 'GetChanges', page: 0, content: '0' },
      { tag: 'WindowSize', page: 0, content: '100' },
      { tag: 'Options', page: 0, children: [] },
      { tag: 'Commands', page: 0, children: [] },
    ],
  };
  assert.deepEqual(validateActiveSyncCollectionRequest(valid), { ok: true });
  assert.deepEqual(validateActiveSyncCollectionRequest({
    ...valid,
    children: [{ tag: 'Class', page: 0, content: 'Contacts' }, ...valid.children],
  }), { ok: false });
  assert.deepEqual(validateActiveSyncCollectionRequest({
    ...valid,
    children: [valid.children[1], valid.children[0]],
  }), { ok: false });
  assert.deepEqual(validateActiveSyncCollectionRequest({
    ...valid,
    children: [...valid.children, { tag: 'SyncKey', page: 0, content: '0' }],
  }), { ok: false });
  assert.deepEqual(validateActiveSyncCollectionRequest({
    ...valid,
    children: [{ tag: 'SyncKey', page: 0, content: Buffer.from('0') }, ...valid.children.slice(1)],
  }), { ok: false });
  assert.deepEqual(validateActiveSyncCollectionRequest({
    ...valid,
    children: [{ tag: 'SyncKey', page: 0, content: 'x'.repeat(97) }, ...valid.children.slice(1)],
  }), { ok: false });
  assert.deepEqual(validateActiveSyncCollectionRequest({
    ...valid,
    children: [valid.children[0], { tag: 'CollectionId', page: 0, content: 'x'.repeat(1025) }],
  }), { ok: false });
  assert.deepEqual(validateActiveSyncCollectionRequest({
    ...valid,
    children: valid.children.map(node => node.tag === 'Supported' ? {
      ...node,
      children: [
        { tag: 'FirstName', page: 1, children: [] },
        { tag: 'FirstName', page: 1, children: [] },
      ],
    } : node),
  }), { ok: false });

  const nonzero = {
    ...valid,
    children: valid.children.map(node => {
      if (node.tag === 'SyncKey') return { ...node, content: 'oms-pim-nonzero' };
      if (node.tag === 'Supported') return {
        ...node,
        children: [{ tag: 'FirstName', page: 1, children: [] }],
      };
      return node;
    }),
  };
  assert.deepEqual(validateActiveSyncCollectionRequest(nonzero), { ok: true });
  assert.deepEqual(validateActiveSyncCollectionRequest({
    ...nonzero,
    children: nonzero.children.map(node => node.tag === 'Supported'
      ? { ...node, content: 'malformed' }
      : node),
  }), { ok: false });
  assert.deepEqual(validateActiveSyncCollectionRequest({
    ...nonzero,
    children: [
      nonzero.children[0],
      nonzero.children[1],
      nonzero.children[2],
      { tag: 'Supported', page: 0, children: [] },
      ...nonzero.children.slice(3),
    ],
  }), { ok: false });
});

test('Collection request validation accepts the physical iPad Conflict option', () => {
  const collection = {
    tag: 'Collection', page: 0, children: [
      { tag: 'SyncKey', page: 0, content: '0' },
      { tag: 'CollectionId', page: 0, content: `m-${'a'.repeat(62)}` },
      { tag: 'Options', page: 0, children: [
        { tag: 'MIMETruncation', page: 0, content: '1' },
        { tag: 'Conflict', page: 0, content: '0' },
        { tag: 'MIMESupport', page: 0, content: '0' },
        { tag: 'BodyPreference', page: 17, children: [
          { tag: 'Type', page: 17, content: '1' },
          { tag: 'TruncationSize', page: 17, content: '500' },
        ] },
      ] },
    ],
  };

  assert.deepEqual(validateActiveSyncCollectionRequest(collection), { ok: true });
  assert.deepEqual(validateActiveSyncCollectionRequest({
    ...collection,
    children: collection.children.map(node => node.tag === 'Options' ? {
      ...node,
      children: node.children.map(option => option.tag === 'Conflict'
        ? { ...option, content: '2' }
        : option),
    } : node),
  }), { ok: false });
});

test('Supported declarations are exact, bounded class properties', () => {
  const collection = children => ({
    tag: 'Collection', page: 0, children: [
      { tag: 'SyncKey', page: 0, content: '0' },
      { tag: 'CollectionId', page: 0, content: 'contacts' },
      ...children,
    ],
  });
  assert.deepEqual(parsePimSupportedProperties(collection([]), 'Contacts'), {
    ok: true, value: { wasPresent: false, fields: [] },
  });
  assert.deepEqual(parsePimSupportedProperties(collection([
    { tag: 'Supported', page: 0, children: [] },
  ]), 'Contacts'), {
    ok: true, value: { wasPresent: true, fields: [] },
  });
  assert.deepEqual(parsePimSupportedProperties(collection([{
    tag: 'Supported', page: 0, children: [
      { tag: 'NickName', page: 12, children: [] },
      { tag: 'FirstName', page: 1, children: [] },
      { tag: 'Body', page: 17, children: [] },
      { tag: 'Categories', page: 1, children: [] },
    ],
  }]), 'Contacts'), {
    ok: true,
    value: { wasPresent: true, fields: ['12:NickName', '17:Body', '1:Categories', '1:FirstName'] },
  });
  const writableContactMatrix = [
    'Anniversary', 'AssistantName', 'Categories', 'Children', 'OfficeLocation', 'Spouse',
    'YomiCompanyName', 'YomiFirstName', 'YomiLastName',
  ].map(tag => ({ tag, page: 1, children: [] }));
  assert.equal(parsePimSupportedProperties(collection([{
    tag: 'Supported', page: 0, children: writableContactMatrix,
  }]), 'Contacts').ok, true);
  for (const readOnly of ['Body', 'BodySize', 'BodyTruncated', 'Alias', 'WeightedRank']) {
    assert.deepEqual(parsePimSupportedProperties(collection([{
      tag: 'Supported', page: 0, children: [{ tag: readOnly, page: 1, children: [] }],
    }]), 'Contacts'), { ok: false }, readOnly);
  }
  const mandatoryCalendar = [
    'DtStamp', 'Categories', 'Sensitivity', 'BusyStatus', 'UID', 'TimeZone', 'StartTime',
    'Subject', 'Location', 'EndTime', 'Recurrence', 'AllDayEvent', 'Reminder', 'Exceptions',
  ].map(tag => ({ tag, page: 4, children: [] }));
  assert.deepEqual(parsePimSupportedProperties(collection([{
    tag: 'Supported', page: 0, children: [
      ...mandatoryCalendar,
      { tag: 'Body', page: 17, children: [] },
    ],
  }]), 'Calendar'), {
    ok: true,
    value: { wasPresent: true, fields: [
      '17:Body', '4:AllDayEvent', '4:BusyStatus', '4:Categories', '4:DtStamp', '4:EndTime',
      '4:Exceptions', '4:Location', '4:Recurrence', '4:Reminder', '4:Sensitivity',
      '4:StartTime', '4:Subject', '4:TimeZone', '4:UID',
    ] },
  });
  for (const missing of mandatoryCalendar) {
    assert.deepEqual(parsePimSupportedProperties(collection([{
      tag: 'Supported', page: 0, children: mandatoryCalendar.filter(node => node.tag !== missing.tag),
    }]), 'Calendar'), { ok: false });
  }

  for (const badSupported of [
    [{ tag: 'FirstName', page: 4, children: [] }],
    [{ tag: 'Category', page: 1, children: [] }],
    [{ tag: 'FirstName', page: 1, content: 'value', children: [] }],
    [{ tag: 'FirstName', page: 1, children: [{ tag: 'Child', page: 1, children: [] }] }],
    [{ tag: 'FirstName', page: 1, children: [] }, { tag: 'FirstName', page: 1, children: [] }],
  ]) {
    assert.deepEqual(parsePimSupportedProperties(collection([{
      tag: 'Supported', page: 0, children: badSupported,
    }]), 'Contacts'), { ok: false });
  }
});

test('Supported state drives omissions without clearing ghosted large properties', () => {
  const partialContact = { children: [{ tag: 'FirstName', page: 1, content: 'Ada' }] };
  const absent = pimOmittedFieldsToClear(partialContact, 'Contacts', { wasPresent: false, fields: [] });
  assert.equal(absent.has('1:CompanyName'), true);
  assert.equal(absent.has('1:FirstName'), false);
  assert.equal(absent.has('1:Picture'), false);
  assert.equal(absent.has('17:Body'), false);

  assert.deepEqual([...pimOmittedFieldsToClear(partialContact, 'Contacts', {
    wasPresent: true, fields: [],
  })], []);
  assert.deepEqual([...pimOmittedFieldsToClear(partialContact, 'Contacts', {
    wasPresent: true, fields: ['1:CompanyName', '1:Email1Address', '1:FirstName'],
  })].sort(), ['1:CompanyName', '1:Email1Address']);

  const partialCalendar = { children: [{ tag: 'Subject', page: 4, content: 'Review' }] };
  const calendarClears = pimOmittedFieldsToClear(partialCalendar, 'Calendar', {
    wasPresent: false, fields: [],
  });
  assert.equal(calendarClears.has('4:Location'), true);
  assert.equal(calendarClears.has('4:Exceptions'), false);
  assert.equal(calendarClears.has('17:Body'), false);
});

test('Supported fields serialize canonically and reject corrupt persisted state', () => {
  assert.equal(serializePimSupportedFields(['4:Location', '17:Body']), '["17:Body","4:Location"]');
  assert.deepEqual(parsePimSupportedFields('["4:Location","17:Body"]'), ['17:Body', '4:Location']);
  assert.throws(() => serializePimSupportedFields(['4:Location', '4:Location']), PimSyncStateError);
  assert.throws(() => parsePimSupportedFields('{"field":"4:Location"}'), PimSyncStateError);
});

test('PIM client command validation rejects malformed shapes and duplicate targets before mutation', () => {
  const serverId = 'a'.repeat(64);
  const valid = [
    { tag: 'Add', page: 0, children: [
      { tag: 'ClientId', page: 0, content: 'Client1' },
      { tag: 'ApplicationData', page: 0, children: [{ tag: 'FileAs', page: 1, content: 'Person' }] },
    ] },
    { tag: 'Change', page: 0, children: [
      { tag: 'ServerId', page: 0, content: serverId },
      { tag: 'ApplicationData', page: 0, children: [{ tag: 'NickName', page: 12, content: 'Nick' }] },
    ] },
  ];
  assert.deepEqual(validatePimClientCommands(valid, 'Contacts'), { ok: true });
  assert.deepEqual(validatePimClientCommands([{ tag: 'Change', page: 0, children: [
    { tag: 'ServerId', page: 0, content: '9'.repeat(64) },
    { tag: 'ApplicationData', page: 0, children: [
      { tag: 'Categories', page: 1, children: [{ tag: 'Category', page: 1, content: 'Customer' }] },
      { tag: 'Children', page: 1, children: [{ tag: 'Child', page: 1, content: 'Alex' }] },
    ] },
  ] }], 'Contacts'), { ok: true });
  assert.deepEqual(validatePimClientCommands([{ ...valid[0], children: valid[0].children.slice(0, 1) }], 'Contacts'), { ok: false });
  assert.deepEqual(validatePimClientCommands([{ ...valid[0], children: [
    { tag: 'ClientId', page: 0, content: 'not-valid!' },
    valid[0].children[1],
  ] }], 'Contacts'), { ok: false });
  assert.deepEqual(validatePimClientCommands([
    valid[1],
    { tag: 'Delete', page: 0, children: [{ tag: 'ServerId', page: 0, content: serverId }] },
  ], 'Contacts'), { ok: false });
  assert.deepEqual(validatePimClientCommands([{ tag: 'Add', page: 0, children: [
    { tag: 'Class', page: 0, content: 'Calendar' },
    { tag: 'ClientId', page: 0, content: 'Calendar1' },
    { tag: 'ApplicationData', page: 0, children: [{ tag: 'Subject', page: 4, content: 'Event' }] },
  ] }], 'Calendar'), { ok: true });
  assert.deepEqual(validatePimClientCommands([{ tag: 'Change', page: 0, children: [
    { tag: 'ServerId', page: 0, content: 'd'.repeat(64) },
    { tag: 'ApplicationData', page: 0, children: [{ tag: 'Categories', page: 4, children: [
      { tag: 'Category', page: 4, content: 'Customer' },
    ] }] },
  ] }], 'Calendar'), { ok: true });
  assert.deepEqual(validatePimClientCommands([{ tag: 'Change', page: 0, children: [
    { tag: 'ServerId', page: 0, content: 'e'.repeat(64) },
    { tag: 'ApplicationData', page: 0, children: [{ tag: 'Categories', page: 4, children: [
      { tag: 'Subject', page: 4, content: 'not-a-category' },
    ] }] },
  ] }], 'Calendar'), { ok: false });
  assert.deepEqual(validatePimClientCommands([{ tag: 'Change', page: 0, children: [
    { tag: 'ServerId', page: 0, content: 'f'.repeat(64) },
    { tag: 'ApplicationData', page: 0, children: [{ tag: 'Subject', page: 4, content: 'line one\r\nline two' }] },
  ] }], 'Calendar'), { ok: false });
  assert.deepEqual(validatePimClientCommands([{ tag: 'Change', page: 0, children: [
    { tag: 'ServerId', page: 0, content: '1'.repeat(64) },
    { tag: 'ApplicationData', page: 0, children: [{ tag: 'Body', page: 17, children: [
      { tag: 'Data', page: 17, content: 'line one\r\nline two\tindented' },
    ] }] },
  ] }], 'Calendar'), { ok: true });
  assert.deepEqual(validatePimClientCommands([{ tag: 'Add', page: 0, children: [
    { tag: 'ClientId', page: 0, content: 'EmptyData' },
    { tag: 'ApplicationData', page: 0, children: [] },
  ] }], 'Contacts'), { ok: false });
  assert.deepEqual(validatePimClientCommands([{ tag: 'Add', page: 0, children: [
    { tag: 'ClientId', page: 0, content: Buffer.from('OpaqueId') },
    { tag: 'ApplicationData', page: 0, children: [{ tag: 'FileAs', page: 1, content: 'Person' }] },
  ] }], 'Contacts'), { ok: false });
  assert.deepEqual(validatePimClientCommands([{ tag: 'Change', page: 0, children: [
    { tag: 'ServerId', page: 0, content: 'c'.repeat(64) },
    { tag: 'ApplicationData', page: 0, children: [{ tag: 'Body', page: 17, children: [
      { tag: 'NativeBodyType', page: 17, content: '1' },
      { tag: 'Data', page: 17, content: 'note' },
    ] }] },
  ] }], 'Contacts'), { ok: true });
  assert.deepEqual(validatePimClientCommands([{ tag: 'Delete', page: 0, children: [
    { tag: 'ServerId', page: 0, content: 'b'.repeat(64) },
    { tag: 'InstanceId', page: 17, content: '20260815T120000Z' },
  ] }], 'Calendar'), { ok: true });
});

test('client Add mappings are stable for retry and isolated by device scope', () => {
  const first = deterministicPimAddServerId('scope-device-a', 'oms-pim-key-a', '1');
  assert.equal(first, deterministicPimAddServerId('scope-device-a', 'oms-pim-key-a', '1'));
  assert.notEqual(first, deterministicPimAddServerId('scope-device-b', 'oms-pim-key-a', '1'));
  assert.notEqual(first, deterministicPimAddServerId('scope-device-a', 'oms-pim-key-b', '1'));
  assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test('wire ServerIds are stable, collection-isolated, collision-resistant, and at most 64 bytes', () => {
  const longSourceId = `imported-${'x'.repeat(400)}`;
  const first = pimWireServerId('contacts', longSourceId);
  assert.match(first, /^[0-9a-f]{64}$/);
  assert.equal(Buffer.byteLength(first), 64);
  assert.equal(first, pimWireServerId('contacts', longSourceId));
  assert.notEqual(first, pimWireServerId('cal-1', longSourceId));
  assert.notEqual(first, pimWireServerId('contacts', `${longSourceId}-different`));
});

test('PIM priming keys are opaque and missing or stale keyed state is rejected', () => {
  const key = createPimSyncKey();
  assert.match(key, /^oms-pim-[0-9a-f]{48}$/);
  assert.notEqual(key, '0');
  assert.equal(pimSyncStateDisposition(null, '0'), 'prime');
  assert.equal(pimSyncStateDisposition(null, key), 'stale');
  assert.equal(pimSyncStateDisposition({ currentSyncKey: key, updatedAt: new Date() }, key), 'current');
  assert.equal(pimSyncStateDisposition({ currentSyncKey: key, updatedAt: new Date() }, 'oms-pim-stale'), 'stale');
});

test('expired PIM state rejects nonzero keys but still permits an explicit partnership reset', () => {
  assert.equal(PIM_SYNC_STATE_TTL_MS, 180 * 24 * 60 * 60 * 1000);
  assert.equal(MAX_PIM_SYNC_PARTNERSHIPS_PER_USER, 256);
  const now = new Date('2026-08-15T10:00:00.000Z');
  const currentSyncKey = createPimSyncKey();
  const state = {
    currentSyncKey,
    updatedAt: new Date(now.getTime() - PIM_SYNC_STATE_TTL_MS - 1),
  };
  assert.equal(pimSyncStateDisposition(state, currentSyncKey, now), 'stale');
  assert.equal(pimSyncStateDisposition(state, '0', now), 'prime');
});

test('PIM replay requires the exact previous key and request bytes', () => {
  const response = Buffer.from('exact-response');
  const state = {
    previousSyncKey: 'oms-pim-previous',
    lastRequestHash: 'request-hash',
    lastResponse: response,
    updatedAt: new Date(),
  };
  assert.deepEqual(
    pimSyncReplayResponse(state, 'oms-pim-previous', 'request-hash'),
    response,
  );
  assert.equal(pimSyncReplayResponse(state, 'oms-pim-other', 'request-hash'), null);
  assert.equal(pimSyncReplayResponse(state, 'oms-pim-previous', 'other-hash'), null);
});

test('PIM key-zero replay expires so a later partnership reset can re-prime', () => {
  const response = Buffer.from('prime-response');
  const updatedAt = new Date('2026-08-15T10:00:00.000Z');
  const state = {
    previousSyncKey: '0',
    lastRequestHash: 'request-hash',
    lastResponse: response,
    updatedAt,
  };
  assert.deepEqual(
    pimSyncReplayResponse(state, '0', 'request-hash', new Date(updatedAt.getTime() + 119_999)),
    response,
  );
  assert.equal(
    pimSyncReplayResponse(state, '0', 'request-hash', new Date(updatedAt.getTime() + 120_001)),
    null,
  );
});

test('PIM initial snapshot paginates as Adds, then edits and deletions are exact deltas', () => {
  const firstSnapshot = [
    { serverId: 'event-a', fingerprint: pimItemFingerprint('event-a', 'ical-a-v1') },
    { serverId: 'event-b', fingerprint: pimItemFingerprint('event-b', 'ical-b-v1') },
  ];
  const pageOne = computePimSyncDelta({ knownItems: {}, snapshot: firstSnapshot, windowSize: 1 });
  assert.deepEqual(pageOne.commands.map(command => command.type), ['Add']);
  assert.equal(pageOne.commands[0].serverId, 'event-a');
  assert.equal(pageOne.moreAvailable, true);

  const pageTwo = computePimSyncDelta({
    knownItems: pageOne.nextKnownItems,
    snapshot: firstSnapshot,
    windowSize: 1,
  });
  assert.deepEqual(pageTwo.commands, [{
    type: 'Add',
    serverId: 'event-b',
    fingerprint: firstSnapshot[1].fingerprint,
  }]);
  assert.equal(pageTwo.moreAvailable, false);

  const editedSnapshot = [
    firstSnapshot[0],
    { serverId: 'event-b', fingerprint: pimItemFingerprint('event-b', 'ical-b-v2') },
  ];
  const edited = computePimSyncDelta({
    knownItems: pageTwo.nextKnownItems,
    snapshot: editedSnapshot,
    windowSize: 25,
  });
  assert.deepEqual(edited.commands.map(command => [command.type, command.serverId]), [['Change', 'event-b']]);

  const deleted = computePimSyncDelta({
    knownItems: edited.nextKnownItems,
    snapshot: [editedSnapshot[1]],
    windowSize: 25,
  });
  assert.deepEqual(deleted.commands.map(command => [command.type, command.serverId]), [['Delete', 'event-a']]);
});

test('calendar quarantine state stays quiet, deletes delivered items, and re-adds corrected items', () => {
  const serverId = 'a'.repeat(64);
  const v1 = pimItemFingerprint(serverId, 'version-1');
  const v2 = pimItemFingerprint(serverId, 'version-2');
  const add = { type: 'Add', serverId, fingerprint: v1 };

  const newlyQuarantined = pimQuarantineCommand(add, {});
  assert.equal(newlyQuarantined.wireCommand, null);
  assert.equal(newlyQuarantined.fingerprint, pimQuarantineFingerprint(v1));

  const stable = normalizePimQuarantineState(
    { [serverId]: newlyQuarantined.fingerprint },
    [{ serverId, fingerprint: v1 }],
  );
  assert.deepEqual(computePimSyncDelta({
    knownItems: stable.knownItems, snapshot: stable.snapshot, windowSize: 10,
  }).commands, []);

  const deliveredToUnsupported = pimQuarantineCommand(
    { type: 'Change', serverId, fingerprint: v2 },
    { [serverId]: v1 },
  );
  assert.equal(deliveredToUnsupported.wireCommand.type, 'Delete');
  assert.equal(deliveredToUnsupported.fingerprint, pimQuarantineFingerprint(v2));

  const corrected = normalizePimQuarantineState(
    { [serverId]: deliveredToUnsupported.fingerprint },
    [{ serverId, fingerprint: pimItemFingerprint(serverId, 'version-3') }],
  );
  assert.deepEqual(computePimSyncDelta({
    knownItems: corrected.knownItems, snapshot: corrected.snapshot, windowSize: 10,
  }).commands.map(command => command.type), ['Add']);

  const removed = normalizePimQuarantineState(
    { [serverId]: deliveredToUnsupported.fingerprint },
    [],
  );
  assert.deepEqual({ ...removed.knownItems }, {});
});

test('accepted client writes advance fingerprints so the same change is not echoed', () => {
  const oldFingerprint = pimItemFingerprint('contact-a', 'v1');
  const newFingerprint = pimItemFingerprint('contact-a', 'v2');
  const snapshot = [
    { serverId: 'contact-a', fingerprint: newFingerprint },
    { serverId: 'contact-b', fingerprint: pimItemFingerprint('contact-b', 'v1') },
  ];
  const known = applyAcceptedPimWrites(
    { 'contact-a': oldFingerprint, 'contact-deleted': pimItemFingerprint('contact-deleted', 'v1') },
    { 'contact-a': newFingerprint, 'contact-b': snapshot[1].fingerprint },
    ['contact-deleted'],
  );
  const delta = computePimSyncDelta({ knownItems: known, snapshot, windowSize: 25 });
  assert.deepEqual(delta.commands, []);
});

test('a post-commit external PIM edit is not hidden by accepted-write advancement', () => {
  const committed = pimItemFingerprint('contact-a', 'eas-v2');
  const external = pimItemFingerprint('contact-a', 'carddav-v3');
  const known = applyAcceptedPimWrites(
    { 'contact-a': pimItemFingerprint('contact-a', 'v1') },
    { 'contact-a': committed },
    [],
  );
  const delta = computePimSyncDelta({
    knownItems: known,
    snapshot: [{ serverId: 'contact-a', fingerprint: external }],
    windowSize: 25,
  });
  assert.deepEqual(delta.commands, [{ type: 'Change', serverId: 'contact-a', fingerprint: external }]);
});

test('prototype-shaped ServerIds are treated as own keys and initial Adds', () => {
  const snapshot = ['__proto__', 'constructor', 'toString'].map(serverId => ({
    serverId,
    fingerprint: pimItemFingerprint(serverId, 'v1'),
  }));
  const delta = computePimSyncDelta({ knownItems: {}, snapshot, windowSize: 100 });
  assert.deepEqual(delta.commands.map(command => [command.type, command.serverId]), [
    ['Add', '__proto__'],
    ['Add', 'constructor'],
    ['Add', 'toString'],
  ]);
  const next = advancePimKnownItems({}, delta.commands);
  assert.equal(Object.hasOwn(next, '__proto__'), true);
  assert.equal(Object.hasOwn(next, 'constructor'), true);
  assert.equal(Object.hasOwn(next, 'toString'), true);
});

test('duplicate snapshot identities fail before client writes', () => {
  assert.throws(() => assertPimSnapshotBound([
    { serverId: 'same', fingerprint: 'v1' },
    { serverId: 'same', fingerprint: 'v2' },
  ]), PimSyncStateError);
});

test('encoded PIM response budget paginates and rejects an individually oversized item', () => {
  const commands = [
    { type: 'Add', serverId: 'one', fingerprint: 'v1' },
    { type: 'Add', serverId: 'two', fingerprint: 'v2' },
  ];
  assert.equal(MAX_PIM_SYNC_RESPONSE_BYTES, 4 * 1024 * 1024);
  assert.equal(MAX_PIM_SYNC_ROW_BYTES, 14 * 1024 * 1024);
  assert.equal(MAX_PIM_SYNC_USER_BYTES, 32 * 1024 * 1024);
  assert.deepEqual(fitPimSyncCommandsToByteBudget(commands, [60, 60], 20, 100), {
    commands: [commands[0]],
    moreAvailable: true,
  });
  assert.throws(
    () => fitPimSyncCommandsToByteBudget(commands.slice(0, 1), [101], 0, 100),
    PimSyncLimitError,
  );
  assert.doesNotThrow(() => assertPimSyncRowBound(
    'x'.repeat(8 * 1024 * 1024),
    'y'.repeat(1024 * 1024),
    Buffer.alloc(4 * 1024 * 1024),
  ));
  assert.throws(() => assertPimSyncRowBound(
    'x'.repeat(9 * 1024 * 1024),
    'y'.repeat(1024 * 1024),
    Buffer.alloc(5 * 1024 * 1024),
  ), PimSyncLimitError);
});

test('PIM state load rejects oversized metadata before selecting payload columns', async () => {
  const username = 'bounded-state@example.test';
  const deviceId = 'BoundedDevice';
  const collectionId = 'contacts';
  const queries = [];
  const connection = {
    query: async sql => {
      queries.push(String(sql).replace(/\s+/g, ' ').trim());
      if (queries.length > 1) throw new Error('payload SELECT must not run');
      return [[{
        scope_hash: pimSyncScopeHash(username, deviceId, collectionId),
        username,
        device_id: deviceId,
        collection_id: collectionId,
        known_items_bytes: MAX_PIM_KNOWN_ITEMS_BYTES + 1,
        last_commands_bytes: 2,
        supported_fields_bytes: 2,
        last_response_bytes: 0,
      }], []];
    },
  };

  await assert.rejects(
    () => loadPimSyncStateOnConnection(connection, username, deviceId, collectionId),
    PimSyncLimitError,
  );
  assert.equal(queries.length, 1);
  assert.match(queries[0], /OCTET_LENGTH\(known_items\).*FOR UPDATE/);
  assert.doesNotMatch(queries[0], /SELECT \*/);
});

test('PIM state load fetches bounded payload on the same locked connection', async () => {
  const username = 'valid-state@example.test';
  const deviceId = 'ValidDevice';
  const collectionId = 'contacts';
  const queries = [];
  const connection = {
    query: async sql => {
      const compact = String(sql).replace(/\s+/g, ' ').trim();
      queries.push(compact);
      if (queries.length === 1) return [[{
        scope_hash: pimSyncScopeHash(username, deviceId, collectionId),
        username,
        device_id: deviceId,
        collection_id: collectionId,
        current_sync_key: `oms-pim-${'a'.repeat(48)}`,
        previous_sync_key: '0',
        window_size: 100,
        supported_was_present: 1,
        last_more_available: 0,
        last_request_hash: null,
        updated_at: new Date('2026-08-15T12:00:00Z'),
        known_items_bytes: 2,
        last_commands_bytes: 2,
        supported_fields_bytes: 2,
        last_response_bytes: 0,
      }], []];
      return [[{
        known_items: '{}',
        last_commands: '[]',
        supported_fields: '[]',
        last_response: null,
      }], []];
    },
  };

  const state = await loadPimSyncStateOnConnection(connection, username, deviceId, collectionId);
  assert.deepEqual({ ...state.knownItems }, {});
  assert.deepEqual(state.lastCommands, []);
  assert.equal(queries.length, 2);
  assert.match(queries[0], /LIMIT 1 FOR UPDATE$/);
  assert.match(queries[1], /OCTET_LENGTH\(known_items\) = \?/);
});

test('50k large contact and calendar metadata sets fail before payload or identity materialization', async () => {
  assert.equal(MAX_PIM_ITEM_SOURCE_BYTES, 16 * 1024 * 1024);
  assert.equal(MAX_PIM_SNAPSHOT_SOURCE_BYTES, 512 * 1024 * 1024);
  for (const [kind, load] of [
    ['contacts', connection => loadBoundedContactPimSnapshot(connection, 'large@example.test', 'contacts')],
    ['calendar', connection => loadBoundedCalendarPimSnapshot(connection, 7, 'cal-7')],
  ]) {
    const queries = [];
    const connection = {
      query: async sql => {
        queries.push(String(sql).replace(/\s+/g, ' ').trim());
        return [[{
          item_count: 50_000,
          source_bytes: MAX_PIM_SNAPSHOT_SOURCE_BYTES + 1,
        }], []];
      },
    };
    await assert.rejects(() => load(connection), PimSyncLimitError, kind);
    assert.equal(queries.length, 1, `${kind} must reject from its aggregate query`);
    assert.match(queries[0], /COUNT\(\*\).*SUM\(/);
    assert.doesNotMatch(queries[0], /SELECT \*/);
  }
});

test('bounded PIM snapshot queries use version tokens and byte metadata without payload hashing', async () => {
  const queries = [];
  const contactConnection = {
    query: async sql => {
      const compact = String(sql).replace(/\s+/g, ' ').trim();
      queries.push(compact);
      if (compact.includes('COUNT(*)')) return [[{ item_count: 2, source_bytes: 2048 }], []];
      return [[
        { id: 1, dav_uid: 'home-first', source_version: 7, source_bytes: 1024 },
        { id: 2, dav_uid: 'work-second', source_version: 9, source_bytes: 1024 },
      ], []];
    },
  };
  const contactSnapshot = await loadBoundedContactPimSnapshot(
    contactConnection, 'bounded@example.test', 'contacts',
  );
  assert.equal(contactSnapshot.items.length, 2);
  assert.equal(contactSnapshot.byServerId.size, 2);
  assert.equal(queries.length, 2);
  assert.match(queries[1], /sync_token AS source_version/);
  assert.doesNotMatch(queries[1], /SHA2\(/);
  assert.match(queries[1], /LIMIT 50001/);
  assert.doesNotMatch(queries[1], /SELECT \*/);

  queries.length = 0;
  const calendarConnection = {
    query: async sql => {
      const compact = String(sql).replace(/\s+/g, ' ').trim();
      queries.push(compact);
      if (compact.includes('COUNT(*)')) return [[{ item_count: 1, source_bytes: 512 }], []];
      return [[{ uid: 'logical-event-a', resource_name: 'opaque-event-a', source_version: 4, source_bytes: 512 }], []];
    },
  };
  const calendarSnapshot = await loadBoundedCalendarPimSnapshot(calendarConnection, 7, 'cal-7');
  assert.equal(calendarSnapshot.items.length, 1);
  assert.equal(calendarSnapshot.byServerId.size, 1);
  assert.equal(calendarSnapshot.items[0].sourceId, 'opaque-event-a');
  assert.match(queries[1], /sync_token AS source_version/);
  assert.match(queries[1], /SELECT resource_name/);
  assert.match(queries[1], /ORDER BY resource_name ASC/);
  assert.doesNotMatch(queries[1], /SHA2\(/);
  assert.doesNotMatch(queries[1], /SELECT \*/);
});

test('EAS contact rendering fetches only preflight-counted columns with the frozen version and length', async () => {
  const queries = [];
  const connection = {
    query: async (sql, params) => {
      queries.push({ sql: String(sql).replace(/\s+/g, ' ').trim(), params });
      return [[{
        id: 41,
        username: 'bounded@example.test',
        dav_uid: 'contact-41',
        sync_token: 9,
        name: 'Bounded Contact',
        email: 'bounded@example.test',
        vcard_data: 'BEGIN:VCARD\r\nEND:VCARD\r\n',
      }], []];
    },
  };

  const contact = await getEasContactByDavUidOnConnection(
    connection, 'bounded@example.test', 'contact-41', 9, 1024,
  );
  assert.equal(contact.dav_uid, 'contact-41');
  assert.equal(queries.length, 1);
  assert.doesNotMatch(queries[0].sql, /SELECT \*/);
  assert.doesNotMatch(queries[0].sql, /labels_json/);
  assert.match(queries[0].sql, /sync_token = \?/);
  assert.match(queries[0].sql, /OCTET_LENGTH\(vcard_data\)/);
  assert.match(queries[0].sql, /\) = \?/);
  assert.deepEqual(queries[0].params, ['bounded@example.test', 'contact-41', 9, 1024]);
});

test('collection mutation lock serializes two device transitions', async () => {
  const entered = [];
  let releaseFirst;
  const gate = new Promise(resolve => { releaseFirst = resolve; });
  const first = withPimCollectionLock('calendar:42', async () => {
    entered.push('device-a');
    await gate;
    entered.push('device-a-done');
  });
  await new Promise(resolve => setImmediate(resolve));
  const second = withPimCollectionLock('calendar:42', async () => {
    entered.push('device-b');
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(entered, ['device-a']);
  releaseFirst();
  await Promise.all([first, second]);
  assert.deepEqual(entered, ['device-a', 'device-a-done', 'device-b']);
});

test('PIM SQL lock canonicalizes usernames and does not fail a committed request on lock-release error', async () => {
  assert.equal(pimSqlLockName(' Person@Example.Test '), pimSqlLockName('person@example.test'));

  const originalQuery = db.pool.query;
  const originalGetConnection = db.pool.getConnection;
  const originalConsoleError = console.error;
  const events = [];
  db.pool.query = async sql => {
    if (String(sql).includes('SHOW COLUMNS')) return [[
      { Field: 'supported_was_present' }, { Field: 'supported_fields' },
    ], []];
    return [{}, []];
  };
  db.pool.getConnection = async () => ({
    query: async sql => {
      if (String(sql).includes('GET_LOCK')) return [[{ acquired: 1 }], []];
      if (String(sql).includes('RELEASE_LOCK')) {
        events.push('release-failed');
        throw new Error('simulated release failure');
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
    beginTransaction: async () => events.push('begin'),
    commit: async () => events.push('commit'),
    rollback: async () => events.push('rollback'),
    release: () => events.push('pool-release'),
    destroy: () => events.push('destroy'),
  });
  console.error = message => events.push(message);
  try {
    assert.equal(await withPimSqlTransaction('Person@Example.Test', async () => {
      events.push('operation');
      return 'committed-result';
    }), 'committed-result');
  } finally {
    db.pool.query = originalQuery;
    db.pool.getConnection = originalGetConnection;
    console.error = originalConsoleError;
  }
  assert.deepEqual(events, [
    'begin', 'operation', 'commit', 'release-failed',
    '[EAS] PIM transaction lock release failed after commit', 'destroy',
  ]);
});

test('ambiguous primary PIM lock acquisition destroys the pooled connection', async () => {
  const originalQuery = db.pool.query;
  const originalGetConnection = db.pool.getConnection;
  const events = [];
  db.pool.query = async sql => {
    if (String(sql).includes('SHOW COLUMNS')) return [[
      { Field: 'supported_was_present' }, { Field: 'supported_fields' },
    ], []];
    return [{}, []];
  };
  db.pool.getConnection = async () => ({
    query: async sql => {
      events.push(String(sql).includes('GET_LOCK') ? 'acquire:pim' : 'unexpected-query');
      throw new Error('ambiguous primary GET_LOCK response loss');
    },
    beginTransaction: async () => events.push('begin'),
    commit: async () => events.push('commit'),
    rollback: async () => events.push('rollback'),
    release: () => events.push('pool:release'),
    destroy: () => events.push('pool:destroy'),
  });
  try {
    await assert.rejects(
      () => withPimSqlTransaction('primary-lock@example.test', async () => {}),
      /ambiguous primary GET_LOCK/,
    );
  } finally {
    db.pool.query = originalQuery;
    db.pool.getConnection = originalGetConnection;
  }
  assert.deepEqual(events, ['acquire:pim', 'pool:destroy']);
});

test('ambiguous secondary lock acquisition releases known primary lock and destroys the connection', async () => {
  const originalQuery = db.pool.query;
  const originalGetConnection = db.pool.getConnection;
  const events = [];
  db.pool.query = async sql => {
    if (String(sql).includes('SHOW COLUMNS')) return [[
      { Field: 'supported_was_present' }, { Field: 'supported_fields' },
    ], []];
    return [{}, []];
  };
  db.pool.getConnection = async () => ({
    query: async sql => {
      if (String(sql).includes('GET_LOCK')) {
        events.push('acquire:pim');
        return [[{ acquired: 1 }], []];
      }
      if (String(sql).includes('RELEASE_LOCK')) {
        events.push('release:pim');
        return [[{ released: 1 }], []];
      }
      throw new Error(`Unexpected query: ${sql}`);
    },
    beginTransaction: async () => events.push('begin'),
    commit: async () => events.push('commit'),
    rollback: async () => events.push('rollback'),
    release: () => events.push('pool:release'),
    destroy: () => events.push('pool:destroy'),
  });
  try {
    await assert.rejects(
      () => withPimSqlTransaction('secondary-lock@example.test', async () => {}, {
        acquire: async () => {
          events.push('acquire:secondary');
          throw new Error('ambiguous secondary lock response loss');
        },
        release: async () => events.push('release:secondary'),
      }),
      /ambiguous secondary lock/,
    );
  } finally {
    db.pool.query = originalQuery;
    db.pool.getConnection = originalGetConnection;
  }
  assert.deepEqual(events, ['acquire:pim', 'acquire:secondary', 'release:pim', 'pool:destroy']);
});

test('known item count and serialized size fail visibly instead of truncating state', () => {
  assert.equal(MAX_PIM_KNOWN_ITEMS, 50_000);
  assert.equal(MAX_PIM_KNOWN_ITEMS_BYTES, 8 * 1024 * 1024);
  assert.throws(
    () => assertPimKnownItemsBound(Object.fromEntries(
      Array.from({ length: MAX_PIM_KNOWN_ITEMS + 1 }, (_, index) => [`item-${index}`, 'f']),
    )),
    PimSyncLimitError,
  );
  assert.throws(
    () => assertPimKnownItemsBound({ ['x'.repeat(MAX_PIM_KNOWN_ITEMS_BYTES)]: 'f' }),
    PimSyncLimitError,
  );
});

test('malformed persisted known-item state fails visibly', () => {
  assert.throws(() => parsePimKnownItems('{not-json'), PimSyncStateError);
  assert.throws(() => parsePimKnownItems('[]'), PimSyncStateError);
});
