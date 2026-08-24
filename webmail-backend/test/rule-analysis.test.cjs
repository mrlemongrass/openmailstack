const assert = require('node:assert/strict');
const test = require('node:test');

const { analyzeRuleDocument } = require('../src/rule-analysis.js');

test('rule analysis separates safe same-rule duplicates from review-only findings', () => {
  const analysis = analyzeRuleDocument({
    rules: [
      {
        id: 'ads',
        name: 'Ads',
        enabled: true,
        condition: 'any',
        criteria: [
          { id: 'sender-1', field: 'from', operator: 'contains', value: 'Deals@Example.COM' },
          { id: 'sender-2', field: 'from', operator: 'contains', value: 'deals@example.com' },
          { id: 'subject-1', field: 'subject', operator: 'contains', value: 'sale' },
          { id: 'subject-2', field: 'subject', operator: 'contains', value: 'summer sale' },
        ],
        actions: [
          { id: 'move-1', type: 'move', folder: 'INBOX.ADs' },
          { id: 'move-2', type: 'move', folder: 'INBOX.ADs' },
        ],
      },
      {
        id: 'newsletters',
        name: 'Newsletters',
        enabled: true,
        condition: 'any',
        criteria: [
          { id: 'sender-3', field: 'from', operator: 'contains', value: 'DEALS@example.com' },
        ],
        actions: [{ id: 'move-3', type: 'move', folder: 'INBOX.Newsletters' }],
      },
    ],
  });

  assert.deepEqual(analysis.summary, {
    exactCriterionDuplicates: 1,
    exactActionDuplicates: 1,
    crossRuleRepeats: 1,
    possibleOverlaps: 1,
    removableItems: 2,
  });
  assert.deepEqual(analysis.removals, [
    { ruleIndex: 0, itemType: 'criterion', itemIndex: 1 },
    { ruleIndex: 0, itemType: 'action', itemIndex: 1 },
  ]);
  assert.deepEqual(
    analysis.findings.map(finding => [finding.kind, finding.safety]),
    [
      ['exact_criterion', 'safe'],
      ['exact_action', 'safe'],
      ['cross_rule_criterion', 'review'],
      ['possible_overlap', 'review'],
    ],
  );
  assert.deepEqual(
    analysis.findings[0].occurrences.map(occurrence => [occurrence.ruleIndex, occurrence.itemIndex]),
    [[0, 0], [0, 1]],
  );
  assert.equal(analysis.findings[2].occurrences.length, 3);
  assert.equal(analysis.truncated, false);
});

test('rule analysis follows Sieve ASCII case folding without changing whitespace or Unicode', () => {
  const analysis = analyzeRuleDocument({
    rules: [{
      name: 'Boundaries',
      criteria: [
        { field: 'subject', operator: 'equals', value: ' Sale' },
        { field: 'subject', operator: 'equals', value: 'sale' },
        { field: 'subject', operator: 'equals', value: 'ÄDS' },
        { field: 'subject', operator: 'equals', value: 'äds' },
        { field: 'subject', operator: 'contains', value: '' },
        { field: 'subject', operator: 'contains', value: '' },
      ],
      actions: [],
    }],
  });

  assert.equal(analysis.summary.removableItems, 0);
  assert.deepEqual(analysis.removals, []);
  assert.deepEqual(analysis.findings, []);
});

test('rule analysis reports nested contains patterns across rules as review only', () => {
  const analysis = analyzeRuleDocument({
    rules: [
      {
        id: 'ads',
        name: 'Ads',
        criteria: [
          { id: 'sale', field: 'subject', operator: 'contains', value: 'sale' },
        ],
        actions: [],
      },
      {
        id: 'promotions',
        name: 'Promotions',
        criteria: [
          { id: 'flash-sale', field: 'subject', operator: 'contains', value: 'Flash Sale' },
        ],
        actions: [],
      },
    ],
  });

  assert.equal(analysis.summary.possibleOverlaps, 1);
  const finding = analysis.findings.find(candidate => candidate.kind === 'possible_overlap');
  assert.equal(finding.safety, 'review');
  assert.deepEqual(
    finding.occurrences.map(item => [item.ruleIndex, item.itemIndex]),
    [[0, 0], [1, 0]],
  );
  assert.match(finding.explanation, /different rules/i);
  assert.deepEqual(analysis.removals, []);
});

test('rule analysis bounds advisory overlap work and finding occurrence payloads', () => {
  const repeated = analyzeRuleDocument({
    rules: [{
      name: 'Repeated senders',
      criteria: Array.from({ length: 60 }, (_value, index) => ({
        id: `sender-${index}`,
        field: 'from',
        operator: 'contains',
        value: 'ads@example.test',
      })),
      actions: [],
    }],
  });

  assert.equal(repeated.summary.removableItems, 59);
  assert.equal(repeated.removals.length, 59);
  assert.equal(repeated.findings[0].occurrences.length, 12);
  assert.equal(repeated.findings[0].omittedOccurrences, 48);

  const manyUniqueContains = analyzeRuleDocument({
    rules: [{
      name: 'Large legacy rule',
      criteria: Array.from({ length: 500 }, (_value, index) => ({
        field: 'subject',
        operator: 'contains',
        value: `token-${index.toString(36).padStart(4, '0')}`,
      })),
      actions: [],
    }],
  });

  assert.equal(manyUniqueContains.summary.possibleOverlaps, 0);
  assert.deepEqual(manyUniqueContains.findings, []);
  assert.equal(manyUniqueContains.truncated, true);
});

test('rule analysis remains bounded across many rules while retaining exact cleanup', () => {
  const analysis = analyzeRuleDocument({
    rules: Array.from({ length: 1000 }, (_value, ruleIndex) => ({
      id: `rule-${ruleIndex}`,
      name: `Legacy rule ${ruleIndex}`,
      criteria: [
        { field: 'subject', operator: 'contains', value: `campaign-${ruleIndex}-primary` },
        { field: 'subject', operator: 'contains', value: `CAMPAIGN-${ruleIndex}-PRIMARY` },
        { field: 'from', operator: 'contains', value: `sender-${ruleIndex}@example.test` },
      ],
      actions: [
        { type: 'move', folder: `INBOX.Archive-${ruleIndex}` },
        { type: 'move', folder: `INBOX.Archive-${ruleIndex}` },
      ],
    })),
  });

  assert.equal(analysis.summary.exactCriterionDuplicates, 1000);
  assert.equal(analysis.summary.exactActionDuplicates, 1000);
  assert.equal(analysis.summary.removableItems, 2000);
  assert.equal(analysis.removals.length, 2000);
  assert.equal(analysis.truncated, true);
});
