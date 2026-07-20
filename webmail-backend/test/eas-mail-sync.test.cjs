const test = require('node:test');
const assert = require('node:assert/strict');

process.env.OMS_DB_PASSWORD ||= 'unit-test-password';

const {
  computeMailSyncDelta,
  effectiveMailSyncWindow,
  normalizeMailSyncOptions,
  truncateUtf8Body,
  activeSyncMailApplicationData,
  mailSyncReplayResponse,
  mailSyncRequestHash,
  mailSyncScopeHash,
  saveMailSyncState,
  validateActiveSyncDeviceId,
} = require('../src/eas-mail-sync.js');

test('web move from Inbox emits Delete and destination folder emits Add', () => {
  const inbox = computeMailSyncDelta({
    knownItems: { '42': 0 },
    allUids: [],
    eligibleUids: [],
    changedReadFlags: {},
    windowSize: 25,
  });
  const junk = computeMailSyncDelta({
    knownItems: {},
    allUids: [7],
    eligibleUids: [7],
    changedReadFlags: {},
    windowSize: 25,
  });

  assert.deepEqual(inbox.commands, [{ type: 'Delete', uid: 42 }]);
  assert.deepEqual(junk.commands, [{ type: 'Add', uid: 7 }]);
  assert.deepEqual(inbox.nextKnownItems, {});
  assert.deepEqual(junk.nextKnownItems, { '7': 0 });
});

test('web move from Inbox to Trash emits Delete from the source folder', () => {
  const delta = computeMailSyncDelta({
    knownItems: { '81': 1 },
    allUids: [],
    eligibleUids: [],
    changedReadFlags: {},
    windowSize: 25,
  });

  assert.deepEqual(delta.commands, [{ type: 'Delete', uid: 81 }]);
  assert.equal(delta.moreAvailable, false);
});

test('ordinary no-change poll emits no commands and never backfills known history', () => {
  const delta = computeMailSyncDelta({
    knownItems: { '90': 0, '91': 1 },
    allUids: [1, 2, 90, 91],
    eligibleUids: [1, 2, 90, 91],
    changedReadFlags: {},
    windowSize: 25,
    minimumUid: 90,
  });

  assert.deepEqual(delta.commands, []);
  assert.deepEqual(delta.nextKnownItems, { '90': 0, '91': 1 });
  assert.equal(delta.moreAvailable, false);
});

test('ordinary no-change IMAP poll short-circuits before SEARCH ALL', async () => {
  const { ImapService } = require('../src/imap.js');
  const service = Object.create(ImapService.prototype);
  let searched = false;
  let closed = false;
  service.client = {
    mailboxOpen: async () => ({ uidValidity: 10n, highestModseq: 20n }),
    search: async () => { searched = true; return []; },
    mailboxClose: async () => { closed = true; },
  };

  const snapshot = await service.getActiveSyncMailSnapshot('INBOX', null, '20', [90, 91]);

  assert.equal(searched, false);
  assert.equal(closed, true);
  assert.deepEqual(snapshot.allUids, [90, 91]);
  assert.deepEqual(snapshot.eligibleUids, [90, 91]);
  assert.deepEqual(snapshot.changedReadFlags, {});
});

test('hardDelete permanently deletes by UID without attempting a Trash move', async () => {
  const { ImapService } = require('../src/imap.js');
  const service = Object.create(ImapService.prototype);
  let deleted;
  let moved = false;
  service.client = {
    mailboxOpen: async () => ({}),
    messageDelete: async (sequence, options) => { deleted = { sequence, options }; },
    messageMove: async () => { moved = true; },
    mailboxClose: async () => {},
  };

  await service.messageAction('Trash', [42], 'hardDelete');

  assert.deepEqual(deleted, { sequence: '42', options: { uid: true } });
  assert.equal(moved, false);
});

test('direct IMAP authentication bypasses configured master credentials', () => {
  const { ImapService } = require('../src/imap.js');
  const { imapConfig } = require('../src/config.js');
  const originalMasterUser = imapConfig.masterUser;
  const originalMasterPass = imapConfig.masterPass;
  imapConfig.masterUser = 'master-user';
  imapConfig.masterPass = 'master-pass';
  try {
    const direct = new ImapService('user@example.test', 'user-pass', false);
    const mastered = new ImapService('user@example.test', 'user-pass');
    assert.deepEqual(direct.client.options.auth, { user: 'user@example.test', pass: 'user-pass' });
    assert.deepEqual(mastered.client.options.auth, { user: 'user@example.test*master-user', pass: 'master-pass' });
  } finally {
    imapConfig.masterUser = originalMasterUser;
    imapConfig.masterPass = originalMasterPass;
  }
});

test('WindowSize bounds server commands and MoreAvailable exposes real pending work', () => {
  const first = computeMailSyncDelta({
    knownItems: {},
    allUids: [10, 11, 12],
    eligibleUids: [10, 11, 12],
    changedReadFlags: {},
    windowSize: 2,
  });

  assert.deepEqual(first.commands, [
    { type: 'Add', uid: 12 },
    { type: 'Add', uid: 11 },
  ]);
  assert.deepEqual(first.nextKnownItems, { '11': 0, '12': 0 });
  assert.equal(first.moreAvailable, true);

  const second = computeMailSyncDelta({
    knownItems: first.nextKnownItems,
    allUids: [10, 11, 12],
    eligibleUids: [10, 11, 12],
    changedReadFlags: {},
    windowSize: 2,
  });

  assert.deepEqual(second.commands, [{ type: 'Add', uid: 10 }]);
  assert.equal(second.moreAvailable, false);
});

test('flag changes beyond WindowSize remain pending on the next Sync', () => {
  const first = computeMailSyncDelta({
    knownItems: { '1': 0, '2': 0, '3': 0 },
    allUids: [1, 2, 3],
    eligibleUids: [1, 2, 3],
    changedReadFlags: { '1': 1, '2': 1, '3': 1 },
    windowSize: 2,
  });
  assert.deepEqual(first.commands.map(command => command.uid), [1, 2]);
  assert.equal(first.moreAvailable, true);

  const second = computeMailSyncDelta({
    knownItems: first.nextKnownItems,
    allUids: [1, 2, 3],
    eligibleUids: [1, 2, 3],
    changedReadFlags: { '1': 1, '2': 1, '3': 1 },
    windowSize: 2,
  });
  assert.deepEqual(second.commands, [{ type: 'Change', uid: 3, isRead: 1 }]);
  assert.equal(second.moreAvailable, false);
});

test('FilterType expiry emits SoftDelete while true folder removal emits Delete', () => {
  const delta = computeMailSyncDelta({
    knownItems: { '20': 0, '21': 1 },
    allUids: [20],
    eligibleUids: [],
    changedReadFlags: {},
    windowSize: 25,
  });

  assert.deepEqual(delta.commands, [
    { type: 'Delete', uid: 21 },
    { type: 'SoftDelete', uid: 20 },
  ]);
});

test('FilterType, WindowSize, and body preferences are normalized to EAS limits', () => {
  assert.deepEqual(normalizeMailSyncOptions({
    filterType: '3',
    windowSize: '900',
    bodyType: '2',
    truncationSize: '1024',
  }), {
    filterType: 3,
    windowSize: 512,
    bodyType: 2,
    truncationSize: 1024,
  });

  assert.throws(() => normalizeMailSyncOptions({ filterType: '6' }), /FilterType/);
});

test('aggregate source budget reduces large pages and leaves pending work available', () => {
  const largeBody = { windowSize: 512, truncationSize: 10 * 1024 * 1024 };
  assert.equal(effectiveMailSyncWindow(largeBody), 1);
  assert.equal(effectiveMailSyncWindow(largeBody, 1), 0);

  const delta = computeMailSyncDelta({
    knownItems: {},
    allUids: [1],
    eligibleUids: [1],
    changedReadFlags: {},
    windowSize: effectiveMailSyncWindow(largeBody, 1),
  });
  assert.deepEqual(delta.commands, []);
  assert.equal(delta.moreAvailable, true);
});

test('body truncation honors UTF-8 byte limits without splitting a character', () => {
  const result = truncateUtf8Body('hello 👋 world', 9);

  assert.equal(result.data, 'hello ');
  assert.equal(Buffer.byteLength(result.data), 6);
  assert.equal(result.estimatedDataSize, Buffer.byteLength('hello 👋 world'));
  assert.equal(result.truncated, true);
});

test('mail ApplicationData uses the requested body type and TruncationSize', async () => {
  const source = Buffer.from([
    'From: Sender <sender@example.test>',
    'To: Recipient <recipient@example.test>',
    'Subject: Bounded body',
    'Date: Mon, 20 Jul 2026 12:00:00 +0000',
    'Content-Type: text/plain; charset=utf-8',
    '',
    '0123456789abcdefghij',
  ].join('\r\n'));
  const nodes = await activeSyncMailApplicationData({
    uid: 9,
    flags: ['\\Seen'],
    envelope: {},
    internalDate: new Date('2026-07-20T12:00:00Z'),
    size: source.length,
    source,
    sourceComplete: true,
  }, { bodyType: 1, truncationSize: 10 });
  const body = nodes.find(node => node.tag === 'Body');
  const bodyChild = tag => body.children.find(node => node.tag === tag)?.content;

  assert.equal(bodyChild('Type'), '1');
  assert.equal(bodyChild('Data'), '0123456789');
  assert.equal(bodyChild('EstimatedDataSize'), '20');
  assert.equal(bodyChild('Truncated'), '1');
  assert.equal(nodes.find(node => node.tag === 'Read').content, '1');
});

test('partial MIME sources are explicitly reported as truncated', async () => {
  const source = Buffer.from('Subject: Partial\r\n\r\nshort body');
  const nodes = await activeSyncMailApplicationData({
    uid: 10,
    flags: [],
    envelope: {},
    size: 500000,
    source,
    sourceComplete: false,
  }, { bodyType: 1, truncationSize: 500 });
  const body = nodes.find(node => node.tag === 'Body');
  const bodyChild = tag => body.children.find(node => node.tag === tag)?.content;

  assert.equal(bodyChild('Truncated'), '1');
  assert.equal(bodyChild('EstimatedDataSize'), '500000');
});

test('device ids are bounded and request hashes are deterministic', () => {
  assert.equal(validateActiveSyncDeviceId('iPhoneABC123'), 'iPhoneABC123');
  assert.equal(validateActiveSyncDeviceId(undefined), null);
  assert.equal(validateActiveSyncDeviceId('x'.repeat(33)), null);
  assert.equal(validateActiveSyncDeviceId('iPhone-ABC_123'), null);
  assert.equal(validateActiveSyncDeviceId('device id'), null);
  assert.equal(mailSyncRequestHash(Buffer.from('same')), mailSyncRequestHash(Buffer.from('same')));
  assert.notEqual(mailSyncRequestHash(Buffer.from('same')), mailSyncRequestHash(Buffer.from('different')));
});

test('duplicate Sync requests replay the exact persisted WBXML response', () => {
  const requestHash = mailSyncRequestHash(Buffer.from('request'));
  const state = {
    previousSyncKey: 'oms-mail-previous',
    lastRequestHash: requestHash,
    lastResponse: Buffer.from('exact-wbxml'),
    updatedAt: new Date('2026-07-20T12:00:00Z'),
  };

  assert.deepEqual(
    mailSyncReplayResponse(state, 'oms-mail-previous', requestHash, new Date('2026-07-20T12:01:00Z')),
    Buffer.from('exact-wbxml'),
  );
  assert.equal(mailSyncReplayResponse(state, 'oms-mail-wrong', requestHash), null);
  assert.equal(mailSyncReplayResponse(state, 'oms-mail-previous', mailSyncRequestHash(Buffer.from('different'))), null);

  const initialState = { ...state, previousSyncKey: '0' };
  assert.equal(
    mailSyncReplayResponse(initialState, '0', requestHash, new Date('2026-07-20T12:03:00Z')),
    null,
  );
});

test('mail sync state persistence binds every schema value exactly once', async () => {
  const { pool } = require('../src/db.js');
  const originalQuery = pool.query;
  let insertCall;
  pool.query = async (sql, params) => {
    if (String(sql).includes('INSERT INTO eas_mail_sync_states')) insertCall = { sql: String(sql), params };
    return [[], []];
  };

  try {
    await saveMailSyncState({
      scopeHash: mailSyncScopeHash('user@example.test', 'device-1', 'SU5CT1g='),
      username: 'user@example.test',
      deviceId: 'device-1',
      collectionId: 'SU5CT1g=',
      currentSyncKey: 'oms-mail-current',
      previousSyncKey: 'oms-mail-previous',
      uidValidity: '10',
      highestModseq: '20',
      minimumUid: 30,
      filterType: 3,
      windowSize: 50,
      bodyType: 1,
      truncationSize: 500,
      knownItems: { '30': 1 },
      lastCommands: [{ type: 'Add', uid: 30 }],
      lastMoreAvailable: false,
      lastRequestHash: mailSyncRequestHash(Buffer.from('request')),
      lastResponse: Buffer.from('response'),
      updatedAt: new Date(),
    });
  } finally {
    pool.query = originalQuery;
  }

  assert.ok(insertCall);
  assert.equal((insertCall.sql.match(/\?/g) || []).length, insertCall.params.length);
  assert.equal(insertCall.params.length, 18);
  assert.deepEqual(insertCall.params.at(-1), Buffer.from('response'));
});
