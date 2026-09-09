const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

function loadTypeScriptModule(relativePath, overrides = {}) {
  const sourcePath = path.resolve(__dirname, relativePath);
  const source = fs.readFileSync(sourcePath, 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: sourcePath,
  }).outputText;
  const loaded = new Module(sourcePath, module);
  loaded.paths = module.paths;
  loaded.require = id => {
    if (Object.hasOwn(overrides, id)) return overrides[id];
    return Module.prototype.require.call(loaded, id);
  };
  loaded._compile(compiled, sourcePath);
  return loaded.exports;
}

test('saved-rule loading fails closed on HTTP and malformed response errors', async t => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  const { fetchRules } = loadTypeScriptModule('../src/shared/api.ts');

  global.fetch = async () => ({
    ok: false,
    json: async () => ({ error: 'Saved rules are malformed.' }),
  });
  await assert.rejects(fetchRules(), /Saved rules are malformed/);

  global.fetch = async () => ({
    ok: true,
    json: async () => ({ error: 'not a rules document' }),
  });
  await assert.rejects(fetchRules(), /valid saved rule set/i);
});

test('folder rule runs aggregate paged results against one stable snapshot', async () => {
  const pages = [
    {
      success: true,
      mode: 'preview',
      folder: 'INBOX',
      processed: 200,
      matchedMessages: 20,
      affectedMessages: 18,
      appliedMessages: 0,
      copiedMessages: 0,
      movedMessages: 0,
      deliveryOnlyMatches: 2,
      bodySkippedMessages: 0,
      invalidDestinations: [],
      ruleMatches: [{ id: 'finance', name: 'Finance', count: 10 }],
      destinations: [{ folder: 'Finance', count: 10 }],
      ruleRevision: 'saved-rules-v1',
      cursor: 220,
      maxUid: 500,
      uidValidity: '9001',
      done: false,
    },
    {
      success: true,
      mode: 'preview',
      folder: 'INBOX',
      processed: 180,
      matchedMessages: 12,
      affectedMessages: 12,
      appliedMessages: 0,
      copiedMessages: 0,
      movedMessages: 0,
      deliveryOnlyMatches: 0,
      bodySkippedMessages: 1,
      invalidDestinations: ['Missing'],
      ruleMatches: [{ id: 'finance', name: 'Finance', count: 4 }],
      destinations: [{ folder: 'Finance', count: 4 }],
      ruleRevision: 'saved-rules-v1',
      cursor: 500,
      maxUid: 500,
      uidValidity: '9001',
      done: true,
    },
  ];
  const requests = [];
  const progress = [];
  const { runRulesThroughFolder } = loadTypeScriptModule('../src/settings/rule-run.ts', {
    '../shared/api': {
      runRulesPage: async request => {
        requests.push(request);
        return pages.shift();
      },
    },
  });

  const summary = await runRulesThroughFolder({
    folder: 'INBOX',
    mode: 'preview',
    ruleIds: ['finance', 'ads'],
    onProgress: value => progress.push(value.processed),
  });

  assert.deepEqual(requests, [
    { folder: 'INBOX', mode: 'preview', cursor: 0, ruleIds: ['finance', 'ads'] },
    {
      folder: 'INBOX',
      mode: 'preview',
      cursor: 220,
      maxUid: 500,
      uidValidity: '9001',
      ruleRevision: 'saved-rules-v1',
      ruleIds: ['finance', 'ads'],
    },
  ]);
  assert.equal(summary.processed, 380);
  assert.equal(summary.affectedMessages, 30);
  assert.equal(summary.deliveryOnlyMatches, 2);
  assert.equal(summary.undecidableMessages, 1);
  assert.deepEqual(summary.ruleMatches, [{ id: 'finance', name: 'Finance', count: 14 }]);
  assert.deepEqual(summary.destinations, [{ folder: 'Finance', count: 14 }]);
  assert.deepEqual(summary.invalidDestinations, ['Missing']);
  assert.equal(summary.ruleRevision, 'saved-rules-v1');
  assert.equal(summary.uidValidity, '9001');
  assert.deepEqual(progress, [200, 380]);
});

test('scoped rule runs carry the server folder snapshot and read state across folders', async () => {
  const scopeSnapshot = [
    { folder: 'INBOX', maxUid: 105, uidValidity: '9001' },
    { folder: 'INBOX/Projects', maxUid: 201, uidValidity: '9002' },
  ];
  const pages = [
    {
      success: true,
      mode: 'preview',
      folder: 'INBOX',
      sourceFolder: 'INBOX',
      includeSubfolders: true,
      readState: 'unread',
      scopeSnapshot,
      scopeIndex: 1,
      processed: 3,
      matchedMessages: 1,
      affectedMessages: 1,
      appliedMessages: 0,
      copiedMessages: 0,
      movedMessages: 0,
      deliveryOnlyMatches: 0,
      bodySkippedMessages: 0,
      invalidDestinations: [],
      ruleMatches: [{ id: 'finance', name: 'Finance', count: 1 }],
      destinations: [{ folder: 'Finance', count: 1 }],
      ruleRevision: 'scoped-rules-v1',
      cursor: 0,
      maxUid: 105,
      uidValidity: '9001',
      done: false,
    },
    {
      success: true,
      mode: 'preview',
      folder: 'INBOX',
      sourceFolder: 'INBOX/Projects',
      includeSubfolders: true,
      readState: 'unread',
      scopeSnapshot,
      scopeIndex: 1,
      processed: 1,
      matchedMessages: 1,
      affectedMessages: 1,
      appliedMessages: 0,
      copiedMessages: 0,
      movedMessages: 0,
      deliveryOnlyMatches: 0,
      bodySkippedMessages: 0,
      invalidDestinations: [],
      ruleMatches: [{ id: 'finance', name: 'Finance', count: 1 }],
      destinations: [{ folder: 'Finance', count: 1 }],
      ruleRevision: 'scoped-rules-v1',
      cursor: 201,
      maxUid: 201,
      uidValidity: '9002',
      done: true,
    },
  ];
  const requests = [];
  const { runRulesThroughFolder } = loadTypeScriptModule('../src/settings/rule-run.ts', {
    '../shared/api': {
      runRulesPage: async request => {
        requests.push(request);
        return pages.shift();
      },
    },
  });

  const summary = await runRulesThroughFolder({
    folder: 'INBOX',
    mode: 'preview',
    ruleIds: ['finance'],
    includeSubfolders: true,
    readState: 'unread',
  });

  assert.deepEqual(requests, [
    {
      folder: 'INBOX',
      mode: 'preview',
      cursor: 0,
      ruleIds: ['finance'],
      includeSubfolders: true,
      readState: 'unread',
    },
    {
      folder: 'INBOX',
      mode: 'preview',
      cursor: 0,
      scopeIndex: 1,
      scopeSnapshot,
      ruleRevision: 'scoped-rules-v1',
      ruleIds: ['finance'],
      includeSubfolders: true,
      readState: 'unread',
    },
  ]);
  assert.equal(summary.processed, 4);
  assert.equal(summary.affectedMessages, 2);
  assert.equal(summary.includeSubfolders, true);
  assert.equal(summary.readState, 'unread');
  assert.equal(summary.sourceFolder, 'INBOX/Projects');
  assert.deepEqual(summary.scopeSnapshot, scopeSnapshot);
});

test('rule-run preview keeps twenty match details and loads later pages from the stable snapshot', async () => {
  const scopeSnapshot = [{ folder: 'INBOX.ADs', maxUid: 500, uidValidity: '9200' }];
  const matchDetail = uid => ({
    folder: 'INBOX.ADs',
    uid,
    subject: `Receipt ${uid}`,
    from: `Store ${uid} <receipts-${uid}@example.test>`,
    date: `2026-08-${String(Math.min(uid, 28)).padStart(2, '0')}T12:00:00.000Z`,
    rules: [{
      ruleIndex: 0,
      condition: 'any',
      matchedCriterionIndexes: [0],
      totalCriteria: 2,
    }],
    destinations: ['INBOX.Receipts'],
    outcome: 'move',
  });
  const matchRuleCatalog = [{
    ruleIndex: 0,
    name: 'Receipts from stores',
    condition: 'any',
    criteria: [
      { criterionIndex: 0, field: 'from', operator: 'contains', value: 'receipts' },
      { criterionIndex: 1, field: 'subject', operator: 'contains', value: 'receipt' },
    ],
  }];
  const pages = [
    {
      success: true,
      mode: 'preview',
      folder: 'INBOX.ADs',
      sourceFolder: 'INBOX.ADs',
      scopeSnapshot,
      scopeIndex: 0,
      processed: 20,
      matchedMessages: 20,
      affectedMessages: 20,
      appliedMessages: 0,
      copiedMessages: 0,
      movedMessages: 0,
      deliveryOnlyMatches: 0,
      bodySkippedMessages: 0,
      invalidDestinations: [],
      ruleMatches: [{ id: 'receipts', name: 'Receipts', count: 20 }],
      destinations: [{ folder: 'INBOX.Receipts', count: 20 }],
      matchDetails: Array.from({ length: 20 }, (_value, index) => matchDetail(index + 1)),
      matchRuleCatalog,
      previewToken: 'preview-token-123456789012345678',
      ruleRevision: 'receipts-v1',
      cursor: 20,
      maxUid: 500,
      uidValidity: '9200',
      done: false,
    },
    {
      success: true,
      mode: 'preview',
      folder: 'INBOX.ADs',
      sourceFolder: 'INBOX.ADs',
      scopeSnapshot,
      scopeIndex: 0,
      processed: 180,
      matchedMessages: 3,
      affectedMessages: 3,
      appliedMessages: 0,
      copiedMessages: 0,
      movedMessages: 0,
      deliveryOnlyMatches: 0,
      bodySkippedMessages: 0,
      invalidDestinations: [],
      ruleMatches: [{ id: 'receipts', name: 'Receipts', count: 3 }],
      destinations: [{ folder: 'INBOX.Receipts', count: 3 }],
      previewToken: 'preview-token-123456789012345678',
      ruleRevision: 'receipts-v1',
      cursor: 500,
      maxUid: 500,
      uidValidity: '9200',
      done: true,
    },
    {
      success: true,
      mode: 'preview',
      folder: 'INBOX.ADs',
      sourceFolder: 'INBOX.ADs',
      scopeSnapshot,
      scopeIndex: 0,
      processed: 180,
      matchedMessages: 3,
      affectedMessages: 3,
      appliedMessages: 0,
      copiedMessages: 0,
      movedMessages: 0,
      deliveryOnlyMatches: 0,
      bodySkippedMessages: 0,
      invalidDestinations: [],
      ruleMatches: [{ id: 'receipts', name: 'Receipts', count: 3 }],
      destinations: [{ folder: 'INBOX.Receipts', count: 3 }],
      matchDetails: [matchDetail(21), matchDetail(22), matchDetail(23)],
      previewToken: 'preview-token-123456789012345678',
      ruleRevision: 'receipts-v1',
      cursor: 500,
      maxUid: 500,
      uidValidity: '9200',
      done: true,
    },
  ];
  const requests = [];
  const {
    loadRuleMatchDetailsPage,
    runRulesThroughFolder,
  } = loadTypeScriptModule('../src/settings/rule-run.ts', {
    '../shared/api': {
      runRulesPage: async request => {
        requests.push(request);
        return pages.shift();
      },
    },
  });

  const summary = await runRulesThroughFolder({
    folder: 'INBOX.ADs',
    mode: 'preview',
    ruleIds: ['receipts'],
    captureMatchDetails: true,
  });

  assert.equal(summary.matchDetails.length, 20);
  assert.deepEqual(summary.matchDetailsCursor, { scopeIndex: 0, cursor: 20 });
  assert.deepEqual(summary.matchRuleCatalog, matchRuleCatalog);
  assert.equal(summary.previewToken, 'preview-token-123456789012345678');
  assert.equal(requests[0].includeMatchDetails, true);
  assert.equal(requests[1].includeMatchDetails, undefined);
  assert.equal(requests[0].previewToken, undefined);
  assert.equal(requests[1].previewToken, 'preview-token-123456789012345678');

  const nextPage = await loadRuleMatchDetailsPage({
    preview: summary,
    ruleIds: ['receipts'],
    cursor: summary.matchDetailsCursor,
  });

  assert.deepEqual(nextPage.matchDetails.map(message => message.uid), [21, 22, 23]);
  assert.equal(nextPage.nextCursor, null);
  assert.deepEqual(requests[2], {
    folder: 'INBOX.ADs',
    mode: 'preview',
    cursor: 20,
    scopeIndex: 0,
    scopeSnapshot,
    ruleIds: ['receipts'],
    ruleRevision: 'receipts-v1',
    previewToken: 'preview-token-123456789012345678',
    includeMatchDetails: true,
  });
});

test('rule-run message selection defaults to every result and supports sparse bulk changes', () => {
  const {
    countSelectedRuleRunMessages,
    createRuleRunMessageSelection,
    isRuleRunMessageSelected,
    serializeRuleRunMessageSelection,
    setRuleRunMessageSelected,
  } = loadTypeScriptModule('../src/settings/rule-run.ts', {
    '../shared/api': { runRulesPage: async () => { throw new Error('not called'); } },
  });
  const first = { folder: 'INBOX.ADs', uid: 11, subject: 'Must not be serialized' };
  const unloaded = { folder: 'INBOX.ADs', uid: 43 };

  const defaultSelection = createRuleRunMessageSelection('allExcept');
  assert.equal(isRuleRunMessageSelected(defaultSelection, first), true);
  assert.equal(isRuleRunMessageSelected(defaultSelection, unloaded), true);
  assert.equal(countSelectedRuleRunMessages(defaultSelection, 43), 43);

  const withOneExcluded = setRuleRunMessageSelected(defaultSelection, first, false);
  assert.equal(isRuleRunMessageSelected(withOneExcluded, first), false);
  assert.equal(isRuleRunMessageSelected(withOneExcluded, unloaded), true);
  assert.equal(countSelectedRuleRunMessages(withOneExcluded, 43), 42);
  assert.deepEqual(serializeRuleRunMessageSelection(withOneExcluded), {
    mode: 'allExcept',
    groups: [{ folder: 'INBOX.ADs', uids: [11] }],
  });

  const cleared = createRuleRunMessageSelection('only');
  assert.equal(countSelectedRuleRunMessages(cleared, 43), 0);
  assert.equal(isRuleRunMessageSelected(cleared, unloaded), false);
  const withOneIncluded = setRuleRunMessageSelected(cleared, unloaded, true);
  assert.equal(countSelectedRuleRunMessages(withOneIncluded, 43), 1);
  assert.deepEqual(serializeRuleRunMessageSelection(withOneIncluded), {
    mode: 'only',
    groups: [{ folder: 'INBOX.ADs', uids: [43] }],
  });

  const withGroupedOverrides = setRuleRunMessageSelected(
    setRuleRunMessageSelected(withOneExcluded, { folder: 'INBOX.ADs', uid: 12 }, false),
    { folder: 'Archive', uid: 5 },
    false,
  );
  assert.deepEqual(serializeRuleRunMessageSelection(withGroupedOverrides), {
    mode: 'allExcept',
    groups: [
      { folder: 'INBOX.ADs', uids: [11, 12] },
      { folder: 'Archive', uids: [5] },
    ],
  });
});

test('rule-run Apply sends selection overrides once and reuses the preview token', async () => {
  const responses = [
    {
      success: true,
      mode: 'apply',
      folder: 'INBOX',
      sourceFolder: 'INBOX',
      processed: 200,
      matchedMessages: 2,
      affectedMessages: 1,
      appliedMessages: 1,
      copiedMessages: 0,
      movedMessages: 1,
      deliveryOnlyMatches: 0,
      bodySkippedMessages: 0,
      invalidDestinations: [],
      ruleMatches: [{ id: 'receipts', name: 'Receipts', count: 2 }],
      destinations: [{ folder: 'Receipts', count: 1 }],
      previewToken: 'preview-token-123456789012345678',
      ruleRevision: 'receipts-v2',
      cursor: 200,
      maxUid: 400,
      uidValidity: '9001',
      done: false,
    },
    {
      success: true,
      mode: 'apply',
      folder: 'INBOX',
      sourceFolder: 'INBOX',
      processed: 200,
      matchedMessages: 3,
      affectedMessages: 2,
      appliedMessages: 2,
      copiedMessages: 0,
      movedMessages: 2,
      deliveryOnlyMatches: 0,
      bodySkippedMessages: 0,
      invalidDestinations: [],
      ruleMatches: [{ id: 'receipts', name: 'Receipts', count: 3 }],
      destinations: [{ folder: 'Receipts', count: 2 }],
      previewToken: 'preview-token-123456789012345678',
      ruleRevision: 'receipts-v2',
      cursor: 400,
      maxUid: 400,
      uidValidity: '9001',
      done: true,
    },
  ];
  const requests = [];
  let failSecondPageOnce = true;
  const { runRulesThroughFolder } = loadTypeScriptModule('../src/settings/rule-run.ts', {
    '../shared/api': {
      runRulesPage: async request => {
        requests.push(request);
        if (request.cursor === 200 && failSecondPageOnce) {
          failSecondPageOnce = false;
          throw new TypeError('simulated lost response');
        }
        return responses.shift();
      },
    },
  });
  const messageSelection = {
    mode: 'allExcept',
    groups: [{ folder: 'INBOX', uids: [101] }],
  };

  const summary = await runRulesThroughFolder({
    folder: 'INBOX',
    mode: 'apply',
    ruleIds: ['receipts'],
    maxUid: 400,
    uidValidity: '9001',
    ruleRevision: 'receipts-v2',
    previewToken: 'preview-token-123456789012345678',
    messageSelection,
  });

  assert.equal(summary.appliedMessages, 3);
  assert.equal(requests.length, 3);
  assert.deepEqual(requests.map(request => request.mode), [
    'apply-selected',
    'apply-selected',
    'apply-selected',
  ]);
  assert.deepEqual(requests.map(request => request.messageSelection), [
    messageSelection,
    undefined,
    undefined,
  ]);
  assert.deepEqual(requests.map(request => request.previewToken), [
    'preview-token-123456789012345678',
    'preview-token-123456789012345678',
    'preview-token-123456789012345678',
  ]);
  assert.deepEqual(requests[2], requests[1]);
});

test('rule-run selection keeps saved order and supports legacy identities', () => {
  const {
    getRunnableRuleIds,
    getRuleRunSelectors,
    normalizeRuleRunSelection,
  } = loadTypeScriptModule('../src/settings/rule-run.ts', {
    '../shared/api': { runRulesPage: async () => { throw new Error('not called'); } },
  });
  const rules = [
    { id: 'finance', name: 'Finance', enabled: true },
    { name: 'Legacy named', enabled: true },
    { id: 'disabled', name: 'Disabled', enabled: false },
    { enabled: true },
  ];

  assert.deepEqual(getRuleRunSelectors(rules), ['finance', 'Legacy named', 'disabled', 'rule-4']);
  assert.deepEqual(getRunnableRuleIds(rules), ['finance', 'Legacy named', 'rule-4']);
  assert.deepEqual(
    normalizeRuleRunSelection(rules, ['rule-4', 'disabled', 'finance']),
    ['finance', 'rule-4'],
  );

  const collidingRules = [
    { name: 'Same legacy name', enabled: true },
    { name: 'Same legacy name', enabled: true },
    { id: 'unique', name: 'Unique', enabled: true },
  ];
  assert.deepEqual(getRuleRunSelectors(collidingRules), ['rule-1', 'rule-2', 'rule-3']);
  assert.deepEqual(
    normalizeRuleRunSelection(collidingRules, ['rule-2']),
    ['rule-2'],
  );
});

test('dirty rule runs wait for a successful save before opening the preview', async () => {
  const { prepareRuleRun } = loadTypeScriptModule('../src/settings/rule-run.ts', {
    '../shared/api': { runRulesPage: async () => { throw new Error('not called'); } },
  });
  const events = [];

  assert.equal(await prepareRuleRun({
    rulesDirty: false,
    saveRules: async () => {
      events.push('save-clean');
      return true;
    },
  }), true);
  assert.deepEqual(events, []);

  assert.equal(await prepareRuleRun({
    rulesDirty: true,
    saveRules: async () => {
      events.push('save-dirty');
      return true;
    },
  }), true);
  assert.deepEqual(events, ['save-dirty']);

  assert.equal(await prepareRuleRun({
    rulesDirty: true,
    saveRules: async () => {
      events.push('save-failed');
      return false;
    },
  }), false);
  assert.deepEqual(events, ['save-dirty', 'save-failed']);
});

test('duplicate cleanup removes only later exact copies and preserves the original draft', () => {
  const {
    applyRuleDuplicateCleanup,
    getExactRuleDuplicateIndexes,
  } = loadTypeScriptModule('../src/settings/rule-duplicates.ts');
  const rules = [{
    id: 'ads',
    name: 'Ads',
    enabled: true,
    condition: 'any',
    criteria: [
      { id: 'sender-1', field: 'from', operator: 'contains', value: 'Deals@Example.COM' },
      { id: 'sender-2', field: 'from', operator: 'contains', value: 'deals@example.com' },
      { id: 'sender-space', field: 'from', operator: 'contains', value: ' deals@example.com' },
      { id: 'unicode-1', field: 'subject', operator: 'equals', value: 'ÄDS' },
      { id: 'unicode-2', field: 'subject', operator: 'equals', value: 'äds' },
    ],
    actions: [
      { id: 'move-1', type: 'move', folder: 'INBOX.ADs' },
      { id: 'move-2', type: 'move', folder: 'INBOX.ADs' },
    ],
  }];

  assert.deepEqual(getExactRuleDuplicateIndexes(rules[0]), {
    criteria: [1],
    actions: [1],
  });

  const result = applyRuleDuplicateCleanup(rules, [
    { ruleIndex: 0, itemType: 'criterion', itemIndex: 0 },
    { ruleIndex: 0, itemType: 'criterion', itemIndex: 1 },
    { ruleIndex: 0, itemType: 'action', itemIndex: 1 },
    { ruleIndex: 0, itemType: 'action', itemIndex: 99 },
    { ruleIndex: 99, itemType: 'criterion', itemIndex: 0 },
  ]);

  assert.equal(result.removedCount, 2);
  assert.deepEqual(result.rules[0].criteria.map(item => item.id), [
    'sender-1', 'sender-space', 'unicode-1', 'unicode-2',
  ]);
  assert.deepEqual(result.rules[0].actions.map(item => item.id), ['move-1']);
  assert.equal(rules[0].criteria.length, 5);
  assert.equal(rules[0].actions.length, 2);
});

test('duplicate cleanup recognizes repeated wildcard-pattern conditions', () => {
  const { getExactRuleDuplicateIndexes } = loadTypeScriptModule('../src/settings/rule-duplicates.ts');
  const rule = {
    criteria: [
      { field: 'subject', operator: 'matches', value: 'Order * confirmed' },
      { field: 'subject', operator: 'matches', value: 'ORDER * CONFIRMED' },
    ],
    actions: [],
  };

  assert.deepEqual(getExactRuleDuplicateIndexes(rule), {
    criteria: [1],
    actions: [],
  });
});

test('duplicate cleanup stays deterministic across many rules and conditions', () => {
  const { applyRuleDuplicateCleanup } = loadTypeScriptModule('../src/settings/rule-duplicates.ts');
  const rules = Array.from({ length: 500 }, (_value, ruleIndex) => ({
    id: `rule-${ruleIndex}`,
    name: `Rule ${ruleIndex}`,
    enabled: true,
    condition: 'any',
    criteria: [
      { id: `keep-${ruleIndex}`, field: 'from', operator: 'contains', value: `Sender-${ruleIndex}@example.test` },
      { id: `remove-${ruleIndex}`, field: 'from', operator: 'contains', value: `sender-${ruleIndex}@example.test` },
      { id: `other-${ruleIndex}`, field: 'subject', operator: 'contains', value: `Campaign ${ruleIndex}` },
    ],
    actions: [
      { id: `move-keep-${ruleIndex}`, type: 'move', folder: `INBOX.Archive-${ruleIndex}` },
      { id: `move-remove-${ruleIndex}`, type: 'move', folder: `INBOX.Archive-${ruleIndex}` },
    ],
  }));
  const removals = rules.flatMap((_rule, ruleIndex) => [
    { ruleIndex, itemType: 'criterion', itemIndex: 1 },
    { ruleIndex, itemType: 'action', itemIndex: 1 },
  ]);

  const result = applyRuleDuplicateCleanup(rules, removals);

  assert.equal(result.removedCount, 1000);
  assert.equal(result.rules.length, 500);
  assert.ok(result.rules.every(rule => rule.criteria.length === 2 && rule.actions.length === 1));
  assert.equal(rules[499].criteria.length, 3);
  assert.equal(rules[499].actions.length, 2);
});

test('filter editor exposes and explains wildcard-pattern matching', () => {
  const panelSource = fs.readFileSync(
    path.join(__dirname, '../src/settings/SettingsPanel.tsx'),
    'utf8',
  );
  const dialogSource = fs.readFileSync(
    path.join(__dirname, '../src/settings/RuleRunDialog.tsx'),
    'utf8',
  );
  const indexCss = fs.readFileSync(
    path.join(__dirname, '../src/index.css'),
    'utf8',
  );

  assert.match(panelSource, /<option value="matches">matches pattern<\/option>/);
  assert.match(panelSource, /Matches the whole field/);
  assert.match(panelSource, /Use <code>\*<\/code> for any text/);
  assert.match(panelSource, /<code>\?<\/code> for one byte/);
  assert.match(panelSource, /accented letters or emoji need multiple/);
  assert.match(panelSource, /<code>\\\*<\/code> or <code>\\\?<\/code> for literal wildcards/);
  assert.match(panelSource, /aria-describedby=\{criteria\.operator === 'matches'/);
  assert.match(dialogSource, /matches: 'matches pattern'/);
  assert.match(dialogSource, /could not be evaluated safely/);
  assert.doesNotMatch(dialogSource, /large message.*Body conditions/);
  assert.match(indexCss, /\.rule-duplicate-value \.filter-pattern-hint/);
});

test('filters expose ordered priority, stop processing, and preview-first folder runs', () => {
  const routesSource = fs.readFileSync(
    path.join(__dirname, '../src/settings/routes.tsx'),
    'utf8',
  );
  const panelSource = fs.readFileSync(
    path.join(__dirname, '../src/settings/SettingsPanel.tsx'),
    'utf8',
  );
  const dialogSource = fs.readFileSync(
    path.join(__dirname, '../src/settings/RuleRunDialog.tsx'),
    'utf8',
  );
  const duplicateDialogSource = fs.readFileSync(
    path.join(__dirname, '../src/settings/RuleDuplicateReviewDialog.tsx'),
    'utf8',
  );
  const indexCss = fs.readFileSync(
    path.join(__dirname, '../src/index.css'),
    'utf8',
  );

  assert.match(routesSource, /const \[rulesLoaded, setRulesLoaded\] = useState\(false\)/);
  assert.match(routesSource, /setRules\(rulesData\);\s*setRulesLoaded\(true\)/);
  assert.match(routesSource, /if \(!rulesLoaded\)/);
  assert.match(panelSource, /aria-label=\{`Move \$\{rule\.name \|\| 'Untitled Rule'\} up`\}/);
  assert.match(panelSource, /aria-label=\{`Move \$\{rule\.name \|\| 'Untitled Rule'\} down`\}/);
  assert.match(panelSource, /checked=\{rule\.stopProcessing !== false\}/);
  assert.match(panelSource, /Stop processing more rules/);
  assert.match(panelSource, /setActiveRuleId\(onAddRule\(\)\)/);
  assert.match(panelSource, /You have unsaved rule changes/);
  assert.match(panelSource, /Save &amp; run/);
  assert.match(panelSource, /rulesDirty \? 'Save & run' : 'Run rules'/);
  assert.match(panelSource, /void handleOpenRunDialog\(enabledRuleIds\)/);
  assert.match(panelSource, /aria-label=\{`Run \$\{rule\.name \|\| 'Untitled Rule'\} now`\}/);
  assert.match(panelSource, /<RuleRunDialog[\s\S]*rules=\{rules\}/);
  assert.match(panelSource, /Review duplicates/);
  assert.match(panelSource, /Already listed above/);
  assert.match(panelSource, /Undo cleanup/);
  assert.match(panelSource, /<RuleDuplicateReviewDialog/);
  assert.match(dialogSource, /aria-labelledby="rule-run-title"/);
  assert.match(dialogSource, /aria-label="Source folder"/);
  assert.match(dialogSource, /Message scope/);
  assert.match(dialogSource, /Include subfolders/);
  assert.match(dialogSource, /All messages/);
  assert.match(dialogSource, /Unread/);
  assert.match(dialogSource, /Read/);
  assert.match(dialogSource, /includeSubfolders/);
  assert.match(dialogSource, /readState/);
  assert.match(dialogSource, /scopeSnapshot: preview\.scopeSnapshot/);
  assert.match(dialogSource, /Rules to run/);
  assert.doesNotMatch(dialogSource, /rules\[rule\.ruleIndex\]/);
  assert.match(dialogSource, /Selected rule execution order/);
  assert.match(dialogSource, /in saved order/);
  assert.match(dialogSource, /previewScopeCount/);
  assert.match(dialogSource, /selectedRuleIds/);
  assert.match(dialogSource, /Select all/);
  assert.match(dialogSource, /Clear all/);
  assert.match(dialogSource, /ruleIds: selectedRuleIds/);
  assert.match(dialogSource, /Preview matches/);
  assert.match(dialogSource, /Matched messages/);
  assert.match(dialogSource, /Choose which messages to move/);
  assert.match(dialogSource, /Deselect all/);
  assert.match(dialogSource, /Why it matched/);
  assert.match(dialogSource, /matchedCriterionIndexes/);
  assert.match(dialogSource, /preview\.matchRuleCatalog/);
  assert.doesNotMatch(dialogSource, /additionalCriterionCount/);
  assert.match(dialogSource, /messageSelection:/);
  assert.match(dialogSource, /aria-label=\{`Move .* in this run`\}/);
  assert.match(dialogSource, /Previous matches/);
  assert.match(dialogSource, /Next matches/);
  assert.match(dialogSource, /nextLoadedCount > preview\.matchedMessages/);
  assert.match(dialogSource, /Matched messages changed after this preview/);
  assert.match(dialogSource, /className="rule-run-metrics" role="status" aria-live="polite"/);
  assert.doesNotMatch(dialogSource, /className="rule-run-summary" aria-live=/);
  assert.match(dialogSource, /Apply to \{selectedMoveCount\} selected/);
  assert.match(dialogSource, /disabled=\{phase === 'applying'\}/);
  assert.match(dialogSource, /Stop preview/);
  assert.match(dialogSource, /Keep this window open until the run finishes/);
  assert.match(dialogSource, /uidValidity: preview\.uidValidity/);
  assert.match(dialogSource, /Confirm the interrupted copy/);
  assert.match(dialogSource, /copyActionKeys: pendingCopies\.map/);
  assert.match(dialogSource, /this exact group is present or missing/);
  assert.match(dialogSource, /Copies are missing/);
  assert.match(dialogSource, /Copies are present/);
  assert.match(dialogSource, /Reject and discard only apply to new deliveries/);
  assert.match(duplicateDialogSource, /aria-labelledby="rule-duplicate-review-title"/);
  assert.match(duplicateDialogSource, /Safe cleanup/);
  assert.match(duplicateDialogSource, /Review only/);
  assert.match(duplicateDialogSource, /Remove exact duplicates/);
  assert.match(duplicateDialogSource, /No duplicate conditions or actions found/);
  assert.match(indexCss, /\.filter-rule-priority-controls/);
  assert.match(indexCss, /\.rule-duplicate-review/);
  assert.match(indexCss, /\.rule-run-match-list/);
  assert.match(indexCss, /\.rule-run-message-selection/);
  assert.match(indexCss, /\.rule-run-match-select-control/);
  assert.match(indexCss, /\.rule-run-match-explanation/);
  assert.match(
    indexCss,
    /\.rule-run-footnote\.warning\s*\{\s*color:\s*var\(--feedback-warning-text\)/,
  );
  assert.match(
    indexCss,
    /@media \(max-width: 767px\)[\s\S]*\.filter-rule-list-row[\s\S]*grid-template-columns:\s*116px minmax\(0, 1fr\)/,
  );
  assert.match(
    indexCss,
    /@media \(max-width: 767px\)[\s\S]*\.rule-run-actions[\s\S]*flex-direction:\s*column/,
  );
});
