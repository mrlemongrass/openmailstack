#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
SMOKE_SCRIPT="${PROJECT_ROOT}/tests/integration/activesync_mail_smoke.sh"

fail() {
    echo "FAIL: $1" >&2
    exit 1
}

require_text() {
    local needle=$1
    grep -Fq "${needle}" "${SMOKE_SCRIPT}" \
        || fail "mail smoke fixture is missing required proof: ${needle}"
}

reject_text() {
    local needle=$1
    if grep -Fq "${needle}" "${SMOKE_SCRIPT}"; then
        fail "mail smoke fixture retained unsafe bounded or hard-coded cleanup: ${needle}"
    fi
}

require_text 'const messageId ='
require_text 'messageIdForCanary(user, deviceId)'
require_text 'messageId,'
require_text 'await client.list()'
require_text '.specialUse'
require_text 'const MAX_SELECTABLE_MAILBOXES = 512'
require_text "client.search({ header: { 'message-id': messageId } }, { uid: true })"
require_text 'parsed.messageId === messageId'
require_text 'resolvedImapFolders.inbox.path'
require_text 'resolvedImapFolders.junk.path'
require_text 'resolvedImapFolders.trash.path'
require_text 'cleanupImapFolders.selectablePaths'
require_text 'const cleanupImapFolders = await resolveImapFolders()'
require_text 'await assertNoSeedMessages(client, cleanupFolders)'
require_text "if (cleanupFailed) throw new Error('Protocol smoke cleanup did not complete')"
require_text 'validateMailChangeResponse'
require_text 'validateItemOperationsFetchResponse'
require_text 'reconcileSeedCleanup'
require_text 'removeExactQueuedSeedMessages'
require_text 'await cleanupSeedMessage();'
require_text "const cleanupOnly = process.env.CLEANUP_ONLY === '1'"
require_text 'PASS: ActiveSync mail smoke removed and proved zero exact mailbox and Postfix canary residue'

reject_text 'mailbox.exists - 79'
reject_text "['INBOX', 'Junk', 'Trash']"
reject_text 'parsed.subject === subject'
reject_text "findSeedMessage('INBOX')"
reject_text "findSeedMessage('Junk')"
reject_text "findSeedMessage('Trash')"

node_source=$(mktemp --suffix=.cjs)
trap 'rm -f -- "${node_source}"' EXIT
sed -n "/^node <<'NODE'$/,/^NODE$/p" "${SMOKE_SCRIPT}" | sed '1d;$d' > "${node_source}"
node --check "${node_source}"

if OMS_SMOKE_CLEANUP_ONLY=invalid bash "${SMOKE_SCRIPT}" >/dev/null 2>&1; then
  fail 'mail smoke accepted an invalid cleanup-only mode'
fi

node - "${SMOKE_SCRIPT}" "${PROJECT_ROOT}" <<'NODE'
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const Module = require('module');

const smokePath = process.argv[2];
const projectRoot = process.argv[3];
const shellSource = fs.readFileSync(smokePath, 'utf8');
const heredocStart = "node <<'NODE'\n";
const start = shellSource.indexOf(heredocStart);
const end = shellSource.indexOf('\nNODE\n', start + heredocStart.length);
if (start < 0 || end < 0) throw new Error('Could not extract the mail smoke Node fixture');
const nodeSource = shellSource.slice(start + heredocStart.length, end);
const mainStart = nodeSource.indexOf('\n(async () => {\n');
if (mainStart < 0) throw new Error('Could not isolate the mail smoke fixture helpers');
const helperSource = nodeSource.slice(0, mainStart);

process.env.BASE_URL = 'https://mail.example.test';
process.env.SMOKE_USER = 'fixture@example.test';
process.env.SMOKE_PASSWORD = 'fixture-password';
process.env.NETWORK_TIMEOUT_MS = '15000';
process.env.DEVICE_ID = 'OMSPG0123456789abcdef01234567';

async function fixtureRunner() {
  const assert = require('assert');
  assert.equal(
    messageIdForCanary('Fixture@Example.Test', 'OMSPG0123456789abcdef01234567'),
    messageId,
  );
  assert.equal(
    messageIdForCanary('fixture@example.test', 'OMSPG0123456789abcdef01234567'),
    messageId,
  );
  assert.notEqual(
    messageIdForCanary('fixture@example.test', 'OMSPGfedcba9876543210fedcba98'),
    messageId,
  );
  assert.match(messageId, /^<oms-protocol-[0-9a-f]{64}@openmailstack\.invalid>$/);
  const rawMessage = id => Buffer.from([
    `Message-ID: ${id}`,
    'Subject: fixture',
    'Content-Type: text/plain; charset=utf-8',
    '',
    'fixture body',
  ].join('\r\n'));

  class FakeClient {
    constructor(folders, options = {}) {
      this.folders = folders;
      this.current = '';
      this.searchCalls = [];
      this.deleteCalls = [];
      this.failSearch = options.failSearch || false;
      this.omitUid = options.omitUid || null;
      this.persistDeletes = options.persistDeletes !== false;
      this.deleteResult = options.deleteResult !== false;
    }

    async mailboxOpen(folderPath) {
      if (!this.folders.has(folderPath)) throw new Error('fixture mailbox missing');
      this.current = folderPath;
      return { path: folderPath };
    }

    async mailboxClose() {
      this.current = '';
      return true;
    }

    async search(query, options) {
      assert.equal(query.header['message-id'], messageId);
      assert.equal(options.uid, true);
      this.searchCalls.push(this.current);
      if (this.failSearch) return false;
      return Array.from(this.folders.get(this.current).keys());
    }

    async *fetch(uids, query, options) {
      assert.equal(query.uid, true);
      assert.equal(query.source, true);
      assert.equal(options.uid, true);
      for (const uid of uids) {
        if (uid === this.omitUid) continue;
        const source = this.folders.get(this.current).get(uid);
        if (source) yield { uid, flags: new Set(), source };
      }
    }

    async messageDelete(uids, options) {
      assert.equal(options.uid, true);
      this.deleteCalls.push({ folder: this.current, uids: [...uids] });
      if (this.persistDeletes) {
        for (const uid of uids) this.folders.get(this.current).delete(uid);
      }
      return this.deleteResult;
    }
  }

  const nearMessageId = messageId.replace('@openmailstack.invalid>', '.near@openmailstack.invalid>');
  const folders = new Map([
    ['Inbox/Actual', new Map([[11, rawMessage(messageId)], [12, rawMessage(nearMessageId)]])],
    ['Spam/Actual', new Map([[21, rawMessage(messageId)]])],
    ['Deleted/Actual', new Map([[31, rawMessage(nearMessageId)]])],
    ['Rules/Custom', new Map([[41, rawMessage(messageId)]])],
  ]);
  const client = new FakeClient(folders);
  await client.mailboxOpen('Inbox/Actual');
  const exactMatches = await findExactSeedMessages(client);
  await client.mailboxClose();
  assert.equal(exactMatches.length, 1);
  assert.equal(exactMatches[0].uid, 11);

  const cleanupFolders = ['Inbox/Actual', 'Spam/Actual', 'Deleted/Actual', 'Rules/Custom'];
  await deleteSeedMessages(client, cleanupFolders);
  assert.equal(client.deleteCalls.length, 3);
  assert.equal(folders.get('Inbox/Actual').has(11), false);
  assert.equal(folders.get('Inbox/Actual').has(12), true);
  assert.equal(folders.get('Spam/Actual').has(21), false);
  assert.equal(folders.get('Deleted/Actual').has(31), true);
  assert.equal(folders.get('Rules/Custom').has(41), false);
  for (const folderPath of cleanupFolders) {
    assert.ok(client.searchCalls.filter(value => value === folderPath).length >= 2);
  }

  const failedSearch = new FakeClient(new Map([['Inbox', new Map()]]), { failSearch: true });
  await failedSearch.mailboxOpen('Inbox');
  await assert.rejects(() => findExactSeedMessages(failedSearch), /no verifiable result/);

  const incompleteFetch = new FakeClient(new Map([[
    'Inbox',
    new Map([[1, rawMessage(messageId)], [2, rawMessage(messageId)]]),
  ]]), { omitUid: 2 });
  await incompleteFetch.mailboxOpen('Inbox');
  await assert.rejects(() => findExactSeedMessages(incompleteFetch), /did not fetch every search result/);

  const unverifiedDelete = new FakeClient(new Map([[
    'Inbox',
    new Map([[1, rawMessage(messageId)]]),
  ]]), { persistDeletes: false });
  await assert.rejects(() => deleteSeedMessages(unverifiedDelete, ['Inbox']), /remaining canary artifacts/);

  const mailboxes = [
    { path: 'Named/Junk', delimiter: '/', flags: new Set() },
    { path: 'Special/Spam', delimiter: '/', flags: new Set(), specialUse: '\\Junk' },
  ];
  assert.equal(resolveMailboxRole(mailboxes, 'Junk', '\\junk', ['JUNK', 'SPAM']).path, 'Special/Spam');
  assert.throws(() => resolveMailboxRole([
    ...mailboxes,
    { path: 'Other/Spam', delimiter: '/', flags: new Set(), specialUse: '\\Junk' },
  ], 'Junk', '\\junk', ['JUNK', 'SPAM']), /exactly one Junk mailbox/);

  const discovered = resolveListedImapFolders([
    { path: 'INBOX', delimiter: '/', flags: new Set(), specialUse: '\\Inbox' },
    { path: 'Rules/Custom', delimiter: '/', flags: new Set() },
    { path: 'Junk', delimiter: '/', flags: new Set(), specialUse: '\\Junk' },
    { path: 'Trash', delimiter: '/', flags: new Set(), specialUse: '\\Trash' },
    { path: 'Container', delimiter: '/', flags: new Set(['\\Noselect']) },
  ]);
  assert.equal(discovered.selectablePaths.length, 4);
  assert.ok(discovered.selectablePaths.includes('Rules/Custom'));
  assert.throws(() => resolveListedImapFolders(Array.from(
    { length: MAX_SELECTABLE_MAILBOXES + 1 },
    (_, index) => ({ path: `Folder-${index}`, delimiter: '/', flags: new Set() }),
  )), /too many selectable mailboxes/);
  assert.throws(() => resolveListedImapFolders([
    { path: 'x'.repeat(MAX_MAILBOX_PATH_BYTES + 1), delimiter: '/', flags: new Set() },
  ]), /mailbox path exceeds/);
  assert.throws(() => resolveListedImapFolders([
    { path: 'INBOX', delimiter: '/', flags: new Set() },
    { path: 'INBOX', delimiter: '/', flags: new Set() },
  ]), /duplicate selectable mailbox path/);
  assert.deepEqual(
    resolveListedImapFolders([
      { path: 'Archive/Only', delimiter: '/', flags: new Set() },
    ], { requireSpecialUse: false }).selectablePaths,
    ['Archive/Only'],
  );

  assert.equal(headersContainExactSeedMessageId(`Message-ID: ${messageId}\r\nSubject: fixture\r\n`), true);
  assert.equal(headersContainExactSeedMessageId(`Message-ID: ${nearMessageId}\r\nSubject: fixture\r\n`), false);
  assert.equal(headersContainExactSeedMessageId([
    `Message-ID: ${messageId}`,
    `Message-ID: ${messageId}`,
    '',
  ].join('\r\n')), false);
  assert.equal(queueEntryTargetsCanary({
    sender: 'FIXTURE@example.test',
    recipients: [{ address: 'fixture@EXAMPLE.test' }],
  }), true);
  assert.equal(queueEntryTargetsCanary({
    sender: 'fixture@example.test',
    recipients: [{ address: 'someone-else@example.test' }],
  }), false);

  const legacyChange = {
    tag: 'Sync', page: 0, children: [{ tag: 'Collections', page: 0, children: [{
      tag: 'Collection', page: 0, children: [
        { tag: 'SyncKey', page: 0, content: 'legacy-next' },
        { tag: 'CollectionId', page: 0, content: 'legacy-inbox' },
        { tag: 'Status', page: 0, content: '1' },
        { tag: 'Responses', page: 0, children: [{ tag: 'Change', page: 0, children: [
          { tag: 'ServerId', page: 0, content: 'legacy-message' },
          { tag: 'Status', page: 0, content: '1' },
        ] }] },
      ],
    }] }],
  };
  assert.equal(validateMailChangeResponse(
    legacyChange,
    'legacy-message',
    'legacy-current',
    'mail',
  ), 'legacy-next');
  assert.throws(() => validateMailChangeResponse(
    legacyChange,
    'legacy-message',
    'legacy-current',
    'suite',
  ), /unexpectedly returned Responses/);

  const suiteChange = {
    tag: 'Sync', page: 0, children: [{ tag: 'Collections', page: 0, children: [{
      tag: 'Collection', page: 0, children: [
        { tag: 'SyncKey', page: 0, content: 'suite-next' },
        { tag: 'CollectionId', page: 0, content: 'suite-inbox' },
        { tag: 'Status', page: 0, content: '1' },
      ],
    }] }],
  };
  assert.equal(validateMailChangeResponse(
    suiteChange,
    'suite-message',
    'suite-current',
    'suite',
  ), 'suite-next');

  const legacyItemOperations = {
    tag: 'ItemOperations', page: 20, children: [
      { tag: 'Status', page: 20, content: '1' },
      { tag: 'Response', page: 20, children: [{ tag: 'Fetch', page: 20, children: [
        { tag: 'Status', page: 20, content: '1' },
        { tag: 'ServerId', page: 20, content: 'legacy-message' },
        { tag: 'Properties', page: 20, children: [{ tag: 'Body', page: 17, children: [
          { tag: 'Type', page: 17, content: '1' },
          { tag: 'Data', page: 17, content: bodyPrefix },
        ] }] },
      ] }] },
    ],
  };
  assert.doesNotThrow(() => validateItemOperationsFetchResponse(
    legacyItemOperations,
    'legacy-message',
    'mail',
  ));
  assert.throws(() => validateItemOperationsFetchResponse(
    legacyItemOperations,
    'legacy-message',
    'suite',
  ), /did not return/);

  let nowMs = 0;
  const cleanupCycles = [];
  let cleanupCycle = 0;
  await reconcileSeedCleanup({
    quietWindowMs: 2000,
    deadlineMs: 10000,
    pollMs: 1000,
    now: () => nowMs,
    wait: async milliseconds => { nowMs += milliseconds; },
    cleanupMailboxes: async () => {
      cleanupCycles.push(nowMs);
      return cleanupCycle === 2 ? 1 : 0;
    },
    cleanupQueue: async () => (cleanupCycle++ === 0 ? 1 : 0),
  });
  assert.deepEqual(cleanupCycles, [0, 1000, 2000, 3000, 4000, 5000]);

  nowMs = 0;
  let slowZeroSweeps = 0;
  await reconcileSeedCleanup({
    quietWindowMs: 2000,
    deadlineMs: 10000,
    pollMs: 1000,
    now: () => nowMs,
    wait: async milliseconds => { nowMs += milliseconds; },
    cleanupMailboxes: async () => {
      slowZeroSweeps += 1;
      if (slowZeroSweeps === 1) nowMs += 2500;
      return 0;
    },
    cleanupQueue: async () => 0,
  });
  assert.equal(slowZeroSweeps, 3, 'a completed zero sweep must start, not satisfy, the quiet window');
  assert.equal(nowMs, 4500);

  nowMs = 0;
  await assert.rejects(() => reconcileSeedCleanup({
    quietWindowMs: 2000,
    deadlineMs: 3000,
    pollMs: 1000,
    now: () => nowMs,
    wait: async milliseconds => { nowMs += milliseconds; },
    cleanupMailboxes: async () => 0,
    cleanupQueue: async () => 1,
  }), /deadline/);
}

const context = {
  require: Module.createRequire(path.join(projectRoot, '.oms-mail-fixture.cjs')),
  process,
  console,
  Buffer,
  URL,
  fetch,
  AbortSignal,
  setTimeout,
  clearTimeout,
};
const promise = vm.runInNewContext(
  `${helperSource}\n(${fixtureRunner.toString()})()`,
  context,
  { filename: path.join(projectRoot, '.oms-mail-fixture.cjs') },
);
Promise.resolve(promise)
  .then(() => console.log('PASS: exact Message-ID cleanup fixture covers custom selectable folders and rejects uncertainty'))
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  });
NODE

echo 'PASS: ActiveSync mail smoke uses an immutable Message-ID, discovered folders, exact searches, and zero-residue proof'
