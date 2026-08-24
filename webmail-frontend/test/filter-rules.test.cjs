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
  assert.equal(summary.bodySkippedMessages, 1);
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

test('filters expose ordered priority, stop processing, and preview-first folder runs', () => {
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

  assert.match(panelSource, /aria-label=\{`Move \$\{rule\.name \|\| 'Untitled Rule'\} up`\}/);
  assert.match(panelSource, /aria-label=\{`Move \$\{rule\.name \|\| 'Untitled Rule'\} down`\}/);
  assert.match(panelSource, /checked=\{rule\.stopProcessing !== false\}/);
  assert.match(panelSource, /Stop processing more rules/);
  assert.match(panelSource, /setActiveRuleId\(onAddRule\(\)\)/);
  assert.match(panelSource, /Save your rule changes before running them on existing mail/);
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
  assert.match(dialogSource, /selectedRuleIds/);
  assert.match(dialogSource, /Select all/);
  assert.match(dialogSource, /Clear all/);
  assert.match(dialogSource, /ruleIds: selectedRuleIds/);
  assert.match(dialogSource, /Preview matches/);
  assert.match(dialogSource, /Apply rules/);
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
