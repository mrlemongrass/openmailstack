const assert = require('node:assert/strict');
const test = require('node:test');

const {
  parseRuleRunMessageSelection,
  RuleRunPreviewSelectionStore,
} = require('../src/rule-run-preview-selection.js');

test('preview selection tokens freeze matched and actionable membership for Apply', () => {
  let now = 1000;
  const store = new RuleRunPreviewSelectionStore({
    now: () => now,
    createToken: () => 'token-1',
    maxEntries: 2,
    maxMessagesPerEntry: 4,
    maxStoredMessages: 6,
    ttlMs: 100,
  });
  const token = store.create('owner-a', 'revision-a');
  assert.equal(store.append(token, 'owner-a', 'revision-a', [
    { folder: 'INBOX', uid: 1 },
    { folder: 'INBOX', uid: 2 },
  ], [
    { folder: 'INBOX', uid: 1 },
  ]), true);
  assert.equal(store.markPreviewComplete(token, 'owner-a', 'revision-a'), true);
  assert.equal(store.containsMatched(token, 'owner-a', 'revision-a', 'INBOX', 2), true);
  assert.equal(store.containsActionable(token, 'owner-a', 'revision-a', 'INBOX', 2), false);
  assert.equal(store.beginApply(token, 'owner-a', 'revision-a', 'allExcept', []), true);
  assert.equal(store.isSelected(token, 'owner-a', 'revision-a', 'INBOX', 1), true);
  assert.equal(store.isSelected(token, 'owner-a', 'revision-a', 'INBOX', 2), false);
  assert.equal(store.isSelected(token, 'owner-b', 'revision-a', 'INBOX', 1), false);

  now += 101;
  assert.equal(store.state(token, 'owner-a', 'revision-a'), null);
});

test('preview selection tokens reject oversized manifests and non-preview overrides', () => {
  let tokenNumber = 0;
  const store = new RuleRunPreviewSelectionStore({
    createToken: () => `token-${++tokenNumber}`,
    maxEntries: 2,
    maxMessagesPerEntry: 2,
    maxStoredMessages: 3,
  });
  const token = store.create('owner', 'revision');
  assert.equal(store.append(token, 'owner', 'revision', [
    { folder: 'INBOX', uid: 1 },
    { folder: 'INBOX', uid: 2 },
    { folder: 'INBOX', uid: 3 },
  ], []), false);

  assert.equal(store.append(token, 'owner', 'revision', [
    { folder: 'INBOX', uid: 1 },
    { folder: 'INBOX', uid: 2 },
  ], [
    { folder: 'INBOX', uid: 1 },
  ]), true);
  assert.equal(store.markPreviewComplete(token, 'owner', 'revision'), true);
  assert.equal(store.beginApply(token, 'owner', 'revision', 'only', [
    { folder: 'INBOX', uid: 2 },
  ]), false);
  assert.equal(store.beginApply(token, 'owner', 'revision', 'only', [
    { folder: 'INBOX', uid: 1 },
  ]), true);
  assert.deepEqual(
    store.claimApplyRequest(token, 'owner', 'revision', 'request'),
    { kind: 'claimed' },
  );
  assert.equal(store.finishApplyRequest(token, 'owner', 'revision', 'request', {
    status: 200,
    response: { success: true, done: true },
  }, { retain: true, applyComplete: true }), true);
  assert.equal(store.isSelected(token, 'owner', 'revision', 'INBOX', 1), false);
  assert.equal(store.entries.get(token).selection, undefined);
});

test('in-flight Apply and replay results cannot be evicted by concurrent previews', () => {
  let now = 1000;
  let tokenNumber = 0;
  const store = new RuleRunPreviewSelectionStore({
    now: () => now,
    createToken: () => `token-${++tokenNumber}`,
    maxEntries: 1,
    maxMessagesPerEntry: 2,
    maxStoredMessages: 2,
    ttlMs: 100,
  });
  const token = store.create('owner', 'revision');
  assert.ok(token);
  assert.equal(store.append(token, 'owner', 'revision', [
    { folder: 'INBOX', uid: 1 },
  ], [
    { folder: 'INBOX', uid: 1 },
  ]), true);
  assert.equal(store.markPreviewComplete(token, 'owner', 'revision'), true);
  assert.equal(store.beginApply(token, 'owner', 'revision', 'allExcept', []), true);
  const selector = store.createApplySelector(token, 'owner', 'revision');
  assert.equal(selector('INBOX', 1), true);
  assert.equal(store.create('other-owner', 'other-revision'), null);

  const response = { success: true, done: true, appliedMessages: 1 };
  assert.deepEqual(
    store.claimApplyRequest(token, 'owner', 'revision', 'request-1'),
    { kind: 'claimed' },
  );
  assert.equal(store.finishApplyRequest(token, 'owner', 'revision', 'request-1', {
    status: 200,
    response,
  }, { retain: true, applyComplete: true }), true);
  assert.deepEqual(store.replayApplyResult(token, 'owner', 'revision', 'request-1'), {
    status: 200,
    response,
  });
  assert.equal(store.replayApplyResult(token, 'owner', 'revision', 'different-request'), null);
  assert.equal(store.create('other-owner', 'other-revision'), null);

  now += 101;
  assert.equal(store.create('other-owner', 'other-revision'), 'token-2');
  assert.equal(store.replayApplyResult(token, 'owner', 'revision', 'request-1'), null);
});

test('one owner cannot exhaust preview capacity reserved for other accounts', () => {
  let tokenNumber = 0;
  const store = new RuleRunPreviewSelectionStore({
    createToken: () => `token-${++tokenNumber}`,
    maxEntries: 4,
    maxEntriesPerOwner: 2,
  });

  assert.equal(store.create('owner-a', 'revision-1'), 'token-1');
  assert.equal(store.create('owner-a', 'revision-2'), 'token-2');
  assert.equal(store.create('owner-a', 'revision-3'), null);
  assert.equal(store.create('owner-b', 'revision-1'), 'token-3');
  assert.equal(store.create('owner-c', 'revision-1'), 'token-4');
});

test('one owner cannot exhaust stored-message capacity reserved for another account', () => {
  let tokenNumber = 0;
  const store = new RuleRunPreviewSelectionStore({
    createToken: () => `token-${++tokenNumber}`,
    maxEntries: 4,
    maxEntriesPerOwner: 2,
    maxMessagesPerEntry: 4,
    maxStoredMessages: 6,
    maxStoredMessagesPerOwner: 4,
  });
  const firstOwnerToken = store.create('owner-a', 'revision-1');
  const secondOwnerToken = store.create('owner-a', 'revision-2');
  const otherOwnerToken = store.create('owner-b', 'revision-1');

  assert.equal(store.append(firstOwnerToken, 'owner-a', 'revision-1', [
    { folder: 'INBOX', uid: 1 },
    { folder: 'INBOX', uid: 2 },
    { folder: 'INBOX', uid: 3 },
  ], []), true);
  assert.equal(store.append(secondOwnerToken, 'owner-a', 'revision-2', [
    { folder: 'INBOX', uid: 4 },
    { folder: 'INBOX', uid: 5 },
  ], []), false);
  assert.equal(store.append(otherOwnerToken, 'owner-b', 'revision-1', [
    { folder: 'INBOX', uid: 6 },
    { folder: 'INBOX', uid: 7 },
  ], []), true);
});

test('selection storage supports a sparse arbitrary subset beyond ten thousand messages', () => {
  const store = new RuleRunPreviewSelectionStore({
    createToken: () => 'large-token',
    maxMessagesPerEntry: 20000,
    maxStoredMessages: 25000,
  });
  const messages = Array.from({ length: 10001 }, (_value, index) => ({
    folder: 'INBOX',
    uid: index + 1,
  }));
  const token = store.create('owner', 'revision');
  assert.equal(store.append(token, 'owner', 'revision', messages, messages), true);
  assert.equal(store.markPreviewComplete(token, 'owner', 'revision'), true);
  assert.equal(store.beginApply(token, 'owner', 'revision', 'only', messages), true);
  const selector = store.createApplySelector(token, 'owner', 'revision');
  assert.equal(selector('INBOX', 1), true);
  assert.equal(selector('INBOX', 10001), true);
  assert.equal(selector('INBOX', 10002), false);
});

test('duplicate Apply requests wait for one claimed mutation and replay its exact result', async () => {
  const store = new RuleRunPreviewSelectionStore({ createToken: () => 'claim-token' });
  const token = store.create('owner', 'revision');
  assert.equal(store.append(token, 'owner', 'revision', [
    { folder: 'INBOX', uid: 1 },
  ], [
    { folder: 'INBOX', uid: 1 },
  ]), true);
  assert.equal(store.markPreviewComplete(token, 'owner', 'revision'), true);
  assert.equal(store.beginApply(token, 'owner', 'revision', 'allExcept', []), true);

  assert.deepEqual(
    store.claimApplyRequest(token, 'owner', 'revision', 'request-1'),
    { kind: 'claimed' },
  );
  const duplicate = store.claimApplyRequest(token, 'owner', 'revision', 'request-1');
  assert.equal(duplicate.kind, 'pending');

  const result = {
    status: 200,
    response: { success: true, done: false, appliedMessages: 1 },
  };
  assert.equal(store.finishApplyRequest(
    token,
    'owner',
    'revision',
    'request-1',
    result,
    { retain: true, applyComplete: false },
  ), true);
  assert.deepEqual(await duplicate.result, result);
  assert.deepEqual(store.claimApplyRequest(token, 'owner', 'revision', 'request-1'), {
    kind: 'replay',
    result,
  });
});

test('selection parsing rejects oversized UID groups before reading or copying their entries', () => {
  const oversizedUids = new Array(101);
  Object.defineProperty(oversizedUids, 0, {
    get() {
      throw new Error('oversized UID entries must not be read');
    },
  });

  assert.equal(parseRuleRunMessageSelection({
    mode: 'only',
    groups: [{ folder: 'INBOX', uids: oversizedUids }],
  }, { maxGroups: 5, maxMessages: 100 }), null);
  assert.deepEqual(parseRuleRunMessageSelection({
    mode: 'allExcept',
    groups: [
      { folder: 'INBOX', uids: [1, 2] },
      { folder: 'Archive', uids: [3] },
    ],
  }, { maxGroups: 5, maxMessages: 3 }), {
    mode: 'allExcept',
    messages: [
      { folder: 'INBOX', uid: 1 },
      { folder: 'INBOX', uid: 2 },
      { folder: 'Archive', uid: 3 },
    ],
  });
});
