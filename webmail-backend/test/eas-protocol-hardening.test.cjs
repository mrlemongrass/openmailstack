const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const { WbxmlParser } = require('../src/wbxml/parser.js');
const { WbxmlWriter } = require('../src/wbxml/writer.js');
const {
  ACTIVE_SYNC_ADVERTISED_COMMANDS,
  ACTIVE_SYNC_UNSUPPORTED_COMMANDS,
  activeSyncMailCollectionId,
  activeSyncMailMessageServerId,
  activeSyncMailMessageUid,
  activeSyncMailParentId,
  activeSyncDeleteCommand,
  activeSyncRequestLogSummary,
  classifyActiveSyncCollection,
  isActiveSyncAuthenticationFailure,
  parseActiveSyncFolderSyncRequest,
  resolveActiveSyncMailFolderPath,
  staticActiveSyncServiceFolders,
  unsupportedSyncCollectionResponse,
} = require('../src/eas-protocol.js');

test('FolderSync request parsing is strict and bounded', () => {
  const valid = { tag: 'FolderSync', page: 7, children: [{ tag: 'SyncKey', page: 7, content: '0' }] };
  assert.deepEqual(parseActiveSyncFolderSyncRequest(valid), { ok: true, syncKey: '0' });
  for (const malformed of [
    null,
    { ...valid, page: 0 },
    { ...valid, tag: 'Sync' },
    { ...valid, children: [] },
    { ...valid, children: [...valid.children, ...valid.children] },
    { ...valid, children: [{ ...valid.children[0], page: 0 }] },
    { ...valid, children: [{ ...valid.children[0], content: Buffer.from('0') }] },
    { ...valid, children: [{ ...valid.children[0], content: `key-${'x'.repeat(100)}` }] },
    { ...valid, children: [{ ...valid.children[0], content: 'bad\0key' }] },
  ]) assert.deepEqual(parseActiveSyncFolderSyncRequest(malformed), { ok: false });
});

test('opaque mail folder and item ids are bounded, stable, delimiter-aware, and resolvable', () => {
  const longPath = `Projects/${'nested'.repeat(40)}/Receipts`;
  const collectionId = activeSyncMailCollectionId(longPath);
  assert.match(collectionId, /^m-[0-9a-f]{62}$/);
  assert.equal(Buffer.byteLength(collectionId), 64);
  assert.equal(collectionId, activeSyncMailCollectionId(longPath));
  assert.equal(resolveActiveSyncMailFolderPath(collectionId, [{ path: longPath, delimiter: '/' }]), longPath);
  assert.equal(activeSyncMailParentId({ path: longPath, delimiter: '/' }), activeSyncMailCollectionId(longPath.slice(0, longPath.lastIndexOf('/'))));
  assert.equal(activeSyncMailParentId({ path: 'Top.Level.Child', delimiter: '.' }), activeSyncMailCollectionId('Top.Level'));

  const serverId = activeSyncMailMessageServerId(collectionId, Number.MAX_SAFE_INTEGER);
  assert.ok(Buffer.byteLength(serverId) <= 64);
  assert.equal(activeSyncMailMessageUid(collectionId, serverId), Number.MAX_SAFE_INTEGER);
  assert.equal(activeSyncMailMessageUid(collectionId, `${serverId}0`), null);
  assert.equal(activeSyncMailMessageUid(collectionId, serverId.replace(/-([1-9])/, '-0$1')), null);

  const legacy = Buffer.from('INBOX').toString('base64');
  assert.equal(resolveActiveSyncMailFolderPath(legacy, [{ path: 'INBOX', delimiter: '/' }]), 'INBOX');
  assert.equal(resolveActiveSyncMailFolderPath(Buffer.from('x'.repeat(40)).toString('base64'), [{ path: 'x'.repeat(40) }]), null);
});

test('only explicit IMAP authentication errors are treated as credential failures', () => {
  assert.equal(isActiveSyncAuthenticationFailure({ authenticationFailed: true }), true);
  assert.equal(isActiveSyncAuthenticationFailure(new Error('connection refused')), false);
  assert.equal(isActiveSyncAuthenticationFailure({ authenticationFailed: false }), false);
});

test('ActiveSync OPTIONS advertises only commands with reachable implementations', () => {
  assert.deepEqual(ACTIVE_SYNC_ADVERTISED_COMMANDS, [
    'Sync',
    'FolderSync',
    'ItemOperations',
    'Ping',
    'SendMail',
  ]);
  assert.deepEqual(ACTIVE_SYNC_UNSUPPORTED_COMMANDS, [
    'FolderCreate',
    'FolderDelete',
    'FolderUpdate',
    'GetItemEstimate',
    'MoveItems',
    'Provision',
    'Settings',
    'SmartForward',
    'SmartReply',
  ]);
  for (const command of ACTIVE_SYNC_UNSUPPORTED_COMMANDS) {
    assert.equal(ACTIVE_SYNC_ADVERTISED_COMMANDS.includes(command), false, command);
  }
});

test('ActiveSync route wires bounded parsing, post-auth logs, explicit unsupported responses, and ItemOperations budgets', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.ts'), 'utf8');
  const routeBodyParser = source.indexOf("app.use('/Microsoft-Server-ActiveSync', (req, res, next) => {");
  const defaultParser = source.indexOf('const activeSyncRawParser = bodyParser.raw({');
  const pingParser = source.indexOf('const activeSyncPingRawParser = bodyParser.raw({');
  const globalBodyParser = source.indexOf('app.use(express.json(');
  const routeStart = source.indexOf("app.all(['/Microsoft-Server-ActiveSync']");
  const authenticate = source.indexOf('await authenticationImap.connect()', routeStart);
  const structuralLog = source.indexOf('activeSyncRequestLogSummary(', routeStart);
  const sendMailDelegation = source.indexOf('await activeSyncSendMailHttpHandler(req, res)', routeStart);
  const unsupportedGuard = source.indexOf('ACTIVE_SYNC_UNSUPPORTED_COMMANDS as readonly string[]', routeStart);
  const legacyFolderCreate = source.indexOf("if (cmd === 'FolderCreate')", routeStart);

  assert.ok(defaultParser >= 0 && defaultParser < pingParser);
  assert.ok(pingParser < routeBodyParser && routeBodyParser < globalBodyParser);
  assert.match(source.slice(defaultParser, pingParser), /limit: `\$\{ACTIVE_SYNC_MAX_REQUEST_BYTES\}b`/);
  assert.match(source.slice(pingParser, routeBodyParser), /limit: `\$\{ACTIVE_SYNC_PING_MAX_REQUEST_BYTES\}b`/);
  assert.match(source.slice(routeBodyParser, globalBodyParser),
    /String\(req\.query\.Cmd \|\| ''\) === 'Ping'[\s\S]*activeSyncPingRawParser[\s\S]*activeSyncRawParser/);
  assert.ok(sendMailDelegation >= 0 && sendMailDelegation < authenticate);
  assert.ok(authenticate >= 0 && authenticate < structuralLog);
  assert.match(source.slice(routeStart), /if \(requestParseFailed\)[\s\S]*cmd === 'Ping'[\s\S]*sendPingProtocolStatus\('102'\)[\s\S]*res\.status\(400\)\.send\(\)/);
  assert.match(source.slice(routeStart), /MS-ASProtocolCommands', ACTIVE_SYNC_ADVERTISED_COMMANDS\.join\(','\)/);
  assert.ok(unsupportedGuard >= 0 && unsupportedGuard < legacyFolderCreate);
  assert.match(source.slice(unsupportedGuard, legacyFolderCreate), /return res\.status\(501\)\.send\(\)/);
  assert.match(source.slice(routeStart), /itemOperationsRequestFetches\(decodedForStructure\)/);
  assert.match(source.slice(routeStart), /ITEM_OPERATIONS_MAX_AGGREGATE_SOURCE_BYTES/);
  assert.match(source.slice(routeStart), /ITEM_OPERATIONS_MAX_RESPONSE_BODY_BYTES/);
  assert.match(source.slice(routeStart), /operations\.length > ITEM_OPERATIONS_MAX_FETCHES\) return sendItemOperations\('2'\)/);
  assert.match(source.slice(routeStart), /globalFailureStatus = '12'/);
  assert.match(source.slice(routeStart), /target\.status === '9'[\s\S]*globalFailureStatus = '9'/);
  assert.doesNotMatch(source.slice(routeStart), /itemOperationsFetchError\([^\n]*'12'/);
  assert.doesNotMatch(source.slice(routeStart), /itemOperationsFetchError\([^\n]*'9'/);
  assert.match(source.slice(routeStart), /res\.status\(400\)\.send\(\);\s*\}\);\s*async function startServer/s);
  assert.match(source.slice(routeStart), /await ensureCalendarSchema\(\)[\s\S]*server\.listen/);
  assert.doesNotMatch(source.slice(routeStart), /Decoded Request|JSON\.stringify\(decoded/);
});

test('ActiveSync request logging exposes bounded structure but no WBXML values', () => {
  const decoded = {
    tag: 'Sync',
    page: 0,
    children: [{
      tag: 'Collections',
      page: 0,
      children: [{
        tag: 'Collection',
        page: 0,
        children: [
          { tag: 'CollectionId', page: 0, content: 'private-folder-id' },
          { tag: 'SyncKey', page: 0, content: 'private-sync-key' },
          { tag: 'ApplicationData', page: 0, content: 'private@example.test' },
        ],
      }],
    }],
  };

  const summary = activeSyncRequestLogSummary('POST', 'Sync', 4096, decoded);
  assert.deepEqual(summary, {
    method: 'POST',
    command: 'Sync',
    bodyBytes: 4096,
    rootTag: 'Sync',
    nodeCount: 6,
    maxDepth: 3,
    truncated: false,
  });
  assert.doesNotMatch(JSON.stringify(summary), /private|example\.test|CollectionId|SyncKey|ApplicationData/);

  const oversized = { tag: 'Sync', page: 0, children: [] };
  let cursor = oversized;
  for (let index = 0; index < 200; index += 1) {
    const child = { tag: `Node${index}`, page: 0, content: `secret-${index}`, children: [] };
    cursor.children.push(child);
    cursor = child;
  }
  const bounded = activeSyncRequestLogSummary('POST', 'Sync', 99_999_999, oversized);
  assert.equal(bounded.nodeCount, 128);
  assert.equal(bounded.maxDepth, 16);
  assert.equal(bounded.truncated, true);
  assert.equal(bounded.bodyBytes, 16 * 1024 * 1024);
  assert.doesNotMatch(JSON.stringify(bounded), /secret/);

  const parseFailure = activeSyncRequestLogSummary('POST', 'Sync', 17, null, true);
  assert.deepEqual(parseFailure, {
    method: 'POST',
    command: 'Sync',
    bodyBytes: 17,
    parseError: true,
  });
});

test('FolderSync advertises only implemented static service collections', () => {
  assert.deepEqual(staticActiveSyncServiceFolders(), [{
    serverId: 'contacts',
    parentId: '0',
    displayName: 'Contacts',
    type: '9',
  }]);
});

test('unsupported mock collections preserve the key and return object-not-found without acknowledgements', () => {
  for (const collectionId of ['mock-notes', 'mock-tasks', 'mock-reminders']) {
    const writer = new WbxmlWriter();
    writer.writeNode(unsupportedSyncCollectionResponse(collectionId, 'client-key-7'));
    const decoded = new WbxmlParser(writer.getBuffer()).parse();
    const collection = decoded.children[0].children[0];
    const child = tag => collection.children.find(node => node.tag === tag);

    assert.equal(child('CollectionId').content, collectionId);
    assert.equal(child('SyncKey').content, 'client-key-7');
    assert.equal(child('Status').content, '8');
    assert.equal(child('Responses'), undefined);
    assert.equal(child('Commands'), undefined);
  }
});

test('calendar tombstones are emitted as AirSync Delete commands', () => {
  const writer = new WbxmlWriter();
  writer.writeNode({ tag: 'Commands', page: 0, children: [activeSyncDeleteCommand('event-7')] });
  const decoded = new WbxmlParser(writer.getBuffer()).parse();
  assert.equal(decoded.children[0].tag, 'Delete');
  assert.equal(decoded.children[0].children[0].tag, 'ServerId');
  assert.equal(decoded.children[0].children[0].content, 'event-7');
});

test('ActiveSync collection classification accepts only implemented collection identifiers', () => {
  assert.deepEqual(classifyActiveSyncCollection('contacts'), { kind: 'contacts' });
  assert.deepEqual(classifyActiveSyncCollection('cal-42'), { kind: 'calendar', calendarId: '42' });
  assert.deepEqual(classifyActiveSyncCollection('SU5CT1g='), { kind: 'mail', folderPath: 'INBOX' });
  assert.deepEqual(classifyActiveSyncCollection('mock-notes'), { kind: 'unsupported' });
  assert.deepEqual(classifyActiveSyncCollection('not base64'), { kind: 'unsupported' });

});
