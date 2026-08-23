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

test('filters expose ordered priority, stop processing, and preview-first folder runs', () => {
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

  assert.match(panelSource, /aria-label=\{`Move \$\{rule\.name \|\| 'Untitled Rule'\} up`\}/);
  assert.match(panelSource, /aria-label=\{`Move \$\{rule\.name \|\| 'Untitled Rule'\} down`\}/);
  assert.match(panelSource, /checked=\{rule\.stopProcessing !== false\}/);
  assert.match(panelSource, /Stop processing more rules/);
  assert.match(panelSource, /setActiveRuleId\(onAddRule\(\)\)/);
  assert.match(panelSource, /Save your rule changes before running them on existing mail/);
  assert.match(panelSource, /aria-label=\{`Run \$\{rule\.name \|\| 'Untitled Rule'\} now`\}/);
  assert.match(panelSource, /<RuleRunDialog[\s\S]*rules=\{rules\}/);
  assert.match(dialogSource, /aria-labelledby="rule-run-title"/);
  assert.match(dialogSource, /aria-label="Source folder"/);
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
  assert.match(indexCss, /\.filter-rule-priority-controls/);
  assert.match(
    indexCss,
    /@media \(max-width: 767px\)[\s\S]*\.filter-rule-list-row[\s\S]*grid-template-columns:\s*116px minmax\(0, 1fr\)/,
  );
  assert.match(
    indexCss,
    /@media \(max-width: 767px\)[\s\S]*\.rule-run-actions[\s\S]*flex-direction:\s*column/,
  );
});
