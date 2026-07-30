const test = require('node:test');
const assert = require('node:assert/strict');

const { evaluateRulesForMessage } = require('../src/rule-engine.js');

const chaseMessage = {
  uid: 42,
  subject: 'Your statement is available',
  from: 'Chase <noreply@chase.com>',
  to: 'Customer <customer@example.com>',
  body: 'Your monthly statement is ready.',
};

function chaseRules(stopProcessing = true) {
  return [
    {
      id: 'finance',
      name: 'Finance',
      enabled: true,
      stopProcessing,
      condition: 'all',
      criteria: [
        { field: 'subject', operator: 'contains', value: 'your statement is available' },
      ],
      actions: [{ type: 'move', folder: 'INBOX.Finance' }],
    },
    {
      id: 'ads',
      name: 'Ads',
      enabled: true,
      stopProcessing: true,
      condition: 'all',
      criteria: [
        { field: 'from', operator: 'contains', value: 'noreply@chase.com' },
      ],
      actions: [{ type: 'move', folder: 'INBOX.ADs' }],
    },
  ];
}

test('ordered rules stop after the first matching rule by default', () => {
  const result = evaluateRulesForMessage(chaseRules(), chaseMessage);

  assert.deepEqual(result.matchedRuleIds, ['finance']);
  assert.deepEqual(result.moveFolders, ['INBOX.Finance']);
  assert.equal(result.stoppedByRuleId, 'finance');
});

test('a continuing rule allows later matches and preserves destination order', () => {
  const result = evaluateRulesForMessage(chaseRules(false), chaseMessage);

  assert.deepEqual(result.matchedRuleIds, ['finance', 'ads']);
  assert.deepEqual(result.moveFolders, ['INBOX.Finance', 'INBOX.ADs']);
  assert.equal(result.stoppedByRuleId, 'ads');
});

test('the last repeated Move destination remains the final destination', () => {
  const continuingRules = chaseRules(false);
  continuingRules[1].stopProcessing = false;
  const result = evaluateRulesForMessage([
    ...continuingRules,
    {
      id: 'finance-last',
      criteria: [{ field: 'body', operator: 'contains', value: 'monthly statement' }],
      actions: [{ type: 'move', folder: 'INBOX.Finance' }],
    },
  ], chaseMessage);

  assert.deepEqual(result.moveFolders, ['INBOX.ADs', 'INBOX.Finance']);
});

test('a matching rule without an executable action does not stop later rules', () => {
  const result = evaluateRulesForMessage([
    {
      id: 'empty',
      criteria: [{ field: 'subject', operator: 'contains', value: 'statement' }],
      actions: [],
    },
    ...chaseRules(),
  ], chaseMessage);

  assert.deepEqual(result.matchedRuleIds, ['finance']);
  assert.deepEqual(result.moveFolders, ['INBOX.Finance']);
});

test('an unavailable body keeps ANY rules decidable from matching headers', () => {
  const result = evaluateRulesForMessage([
    {
      id: 'header-or-body',
      condition: 'any',
      criteria: [
        { field: 'subject', operator: 'contains', value: 'statement' },
        { field: 'body', operator: 'contains', value: 'unavailable text' },
      ],
      actions: [{ type: 'move', folder: 'Finance' }],
    },
  ], { ...chaseMessage, body: '', unavailableFields: ['body'] });

  assert.deepEqual(result.matchedRuleIds, ['header-or-body']);
  assert.deepEqual(result.unevaluatedRuleIds, []);
});

test('an unavailable body reports only rules whose result cannot be decided', () => {
  const result = evaluateRulesForMessage([
    {
      id: 'unknown-any',
      condition: 'any',
      criteria: [
        { field: 'subject', operator: 'contains', value: 'not this subject' },
        { field: 'body', operator: 'contains', value: 'unavailable text' },
      ],
      actions: [{ type: 'move', folder: 'Maybe' }],
    },
    {
      id: 'known-false-all',
      condition: 'all',
      criteria: [
        { field: 'subject', operator: 'contains', value: 'not this subject' },
        { field: 'body', operator: 'contains', value: 'unavailable text' },
      ],
      actions: [{ type: 'move', folder: 'No' }],
    },
  ], { ...chaseMessage, body: '', unavailableFields: ['body'] });

  assert.deepEqual(result.matchedRuleIds, []);
  assert.deepEqual(result.unevaluatedRuleIds, ['unknown-any']);
});

test('rule matching is case-insensitive and honors any, all, equals, and negation', () => {
  const rules = [
    {
      id: 'disabled',
      enabled: false,
      criteria: [{ field: 'from', operator: 'contains', value: 'chase' }],
      actions: [{ type: 'move', folder: 'Disabled' }],
    },
    {
      id: 'all',
      stopProcessing: false,
      condition: 'all',
      criteria: [
        { field: 'subject', operator: 'equals', value: 'YOUR STATEMENT IS AVAILABLE' },
        { field: 'to', operator: 'not_contains', value: 'other@example.com' },
      ],
      actions: [{ type: 'move', folder: 'Exact' }],
    },
    {
      id: 'any',
      condition: 'any',
      criteria: [
        { field: 'body', operator: 'contains', value: 'monthly statement' },
        { field: 'from', operator: 'equals', value: 'nobody@example.com' },
      ],
      actions: [{ type: 'move', folder: 'Body' }],
    },
  ];

  const result = evaluateRulesForMessage(rules, chaseMessage);

  assert.deepEqual(result.matchedRuleIds, ['all', 'any']);
  assert.deepEqual(result.moveFolders, ['Exact', 'Body']);
});

test('manual evaluation reports delivery-only actions without deleting existing mail', () => {
  const result = evaluateRulesForMessage([
    {
      id: 'discard',
      criteria: [{ field: 'subject', operator: 'contains', value: 'statement' }],
      actions: [{ type: 'discard' }, { type: 'reject' }],
    },
  ], chaseMessage);

  assert.deepEqual(result.moveFolders, []);
  assert.deepEqual(result.deliveryOnlyActions, ['discard', 'reject']);
});
