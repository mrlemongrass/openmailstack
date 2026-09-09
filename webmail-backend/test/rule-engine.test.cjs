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
  assert.deepEqual(result.matchedRuleDetails, [
    {
      id: 'all',
      condition: 'all',
      matchedCriterionIndexes: [0, 1],
      totalCriteria: 2,
    },
    {
      id: 'any',
      condition: 'any',
      matchedCriterionIndexes: [0],
      totalCriteria: 2,
    },
  ]);
  assert.deepEqual(result.moveFolders, ['Exact', 'Body']);
});

test('wildcard patterns match dynamic order subjects as a whole field', () => {
  const orderRules = [{
    id: 'order-confirmations',
    criteria: [{ field: 'subject', operator: 'matches', value: 'Order * confirmed' }],
    actions: [{ type: 'move', folder: 'INBOX.Receipts' }],
  }];

  for (const subject of ['Order #37013 confirmed', 'Order #36527 confirmed', 'ORDER #37013 CONFIRMED']) {
    assert.deepEqual(
      evaluateRulesForMessage(orderRules, { uid: 1, subject }).matchedRuleIds,
      ['order-confirmations'],
    );
  }
  assert.deepEqual(
    evaluateRulesForMessage(orderRules, { uid: 1, subject: 'Order #37013 shipped' }).matchedRuleIds,
    [],
  );
  assert.deepEqual(
    evaluateRulesForMessage(orderRules, { uid: 1, subject: 'Re: Order #37013 confirmed' }).matchedRuleIds,
    [],
  );

  const fiveDigitRules = [{
    id: 'five-digit-order',
    criteria: [{ field: 'subject', operator: 'matches', value: 'Order #????? confirmed' }],
    actions: [{ type: 'move', folder: 'INBOX.Receipts' }],
  }];
  assert.deepEqual(
    evaluateRulesForMessage(fiveDigitRules, { uid: 1, subject: 'Order #37013 confirmed' }).matchedRuleIds,
    ['five-digit-order'],
  );
  assert.deepEqual(
    evaluateRulesForMessage(fiveDigitRules, { uid: 1, subject: 'Order #3701 confirmed' }).matchedRuleIds,
    [],
  );

  const literalWildcardRules = [{
    id: 'literal-wildcard',
    criteria: [{ field: 'subject', operator: 'matches', value: 'Order \\* confirmed' }],
    actions: [{ type: 'move', folder: 'INBOX.Receipts' }],
  }];
  assert.deepEqual(
    evaluateRulesForMessage(literalWildcardRules, { uid: 1, subject: 'Order * confirmed' }).matchedRuleIds,
    ['literal-wildcard'],
  );
  assert.deepEqual(
    evaluateRulesForMessage(literalWildcardRules, { uid: 1, subject: 'Order #37013 confirmed' }).matchedRuleIds,
    [],
  );

  const literalQuestionRules = [{
    id: 'literal-question',
    criteria: [{ field: 'subject', operator: 'matches', value: 'Order \\? confirmed' }],
    actions: [{ type: 'move', folder: 'INBOX.Receipts' }],
  }];
  assert.deepEqual(
    evaluateRulesForMessage(literalQuestionRules, { uid: 1, subject: 'Order ? confirmed' }).matchedRuleIds,
    ['literal-question'],
  );
  assert.deepEqual(
    evaluateRulesForMessage(literalQuestionRules, { uid: 1, subject: 'Order 7 confirmed' }).matchedRuleIds,
    [],
  );
});

test('wildcard matching follows Sieve byte and ASCII-case semantics', () => {
  const singleByteRules = [{
    id: 'single-byte',
    criteria: [{ field: 'subject', operator: 'matches', value: 'Order ? confirmed' }],
    actions: [{ type: 'move', folder: 'INBOX.Receipts' }],
  }];
  assert.deepEqual(
    evaluateRulesForMessage(singleByteRules, { uid: 1, subject: 'Order é confirmed' }).matchedRuleIds,
    [],
  );

  const twoByteRules = [{
    id: 'two-byte',
    criteria: [{ field: 'subject', operator: 'matches', value: 'Order ?? confirmed' }],
    actions: [{ type: 'move', folder: 'INBOX.Receipts' }],
  }];
  assert.deepEqual(
    evaluateRulesForMessage(twoByteRules, { uid: 1, subject: 'Order é confirmed' }).matchedRuleIds,
    ['two-byte'],
  );

  const nonAsciiCaseRules = [{
    id: 'non-ascii-case',
    criteria: [{ field: 'subject', operator: 'matches', value: 'Ä*' }],
    actions: [{ type: 'move', folder: 'INBOX.Receipts' }],
  }];
  assert.deepEqual(
    evaluateRulesForMessage(nonAsciiCaseRules, { uid: 1, subject: 'äbc' }).matchedRuleIds,
    [],
  );
  assert.deepEqual(
    evaluateRulesForMessage(nonAsciiCaseRules, { uid: 1, subject: 'Äbc' }).matchedRuleIds,
    ['non-ascii-case'],
  );
});

test('wildcard matching fails closed when its shared work budget is exhausted', () => {
  const result = evaluateRulesForMessage([{
    id: 'bounded-wildcard',
    criteria: [{
      field: 'body',
      operator: 'matches',
      value: '*' + 'a'.repeat(1000) + 'b*',
    }],
    actions: [{ type: 'move', folder: 'INBOX.Receipts' }],
  }], {
    uid: 1,
    body: 'a'.repeat(20000),
  });

  assert.deepEqual(result.matchedRuleIds, []);
  assert.deepEqual(result.unevaluatedRuleIds, ['bounded-wildcard']);
});

test('an undecidable stopping rule blocks downstream actions', () => {
  const firstRule = {
    id: 'undecidable-first',
    criteria: [{
      field: 'body',
      operator: 'matches',
      value: '*' + 'a'.repeat(1000) + 'b*',
    }],
    actions: [{ type: 'move', folder: 'First' }],
  };
  const laterRule = {
    id: 'later',
    criteria: [{ field: 'subject', operator: 'contains', value: 'receipt' }],
    actions: [{ type: 'move', folder: 'Later' }],
  };
  const message = {
    uid: 1,
    subject: 'Receipt',
    body: 'a'.repeat(20000),
  };

  const stopped = evaluateRulesForMessage([firstRule, laterRule], message);
  assert.deepEqual(stopped.unevaluatedRuleIds, ['undecidable-first']);
  assert.deepEqual(stopped.matchedRuleIds, []);
  assert.deepEqual(stopped.moveFolders, []);

  const continued = evaluateRulesForMessage([
    { ...firstRule, stopProcessing: false },
    laterRule,
  ], message);
  assert.deepEqual(continued.unevaluatedRuleIds, ['undecidable-first']);
  assert.deepEqual(continued.matchedRuleIds, ['later']);
  assert.deepEqual(continued.moveFolders, ['Later']);
});

test('an undecidable stopping rule invalidates actions accumulated above it', () => {
  const result = evaluateRulesForMessage([
    {
      id: 'matched-first',
      stopProcessing: false,
      criteria: [{ field: 'subject', operator: 'contains', value: 'receipt' }],
      actions: [
        { type: 'move', folder: 'Earlier' },
        { type: 'discard' },
      ],
    },
    {
      id: 'undecidable-second',
      criteria: [{
        field: 'body',
        operator: 'matches',
        value: '*' + 'a'.repeat(1000) + 'b*',
      }],
      actions: [{ type: 'move', folder: 'Uncertain' }],
    },
  ], {
    uid: 1,
    subject: 'Receipt',
    body: 'a'.repeat(20000),
  });

  assert.deepEqual(result.matchedRuleIds, ['matched-first']);
  assert.deepEqual(result.unevaluatedRuleIds, ['undecidable-second']);
  assert.deepEqual(result.moveFolders, []);
  assert.deepEqual(result.deliveryOnlyActions, []);
});

test('a populated unsupported criterion makes its entire rule non-executable', () => {
  const result = evaluateRulesForMessage([{
    id: 'mixed-unknown',
    condition: 'all',
    criteria: [
      { field: 'subject', operator: 'matches', value: 'Order * confirmed' },
      { field: 'subject', operator: 'future_operator', value: 'future value' },
    ],
    actions: [{ type: 'discard' }],
  }], {
    uid: 1,
    subject: 'Order #37013 confirmed',
  });

  assert.deepEqual(result.matchedRuleIds, []);
  assert.deepEqual(result.deliveryOnlyActions, []);

  const incompleteEditorResult = evaluateRulesForMessage([{
    id: 'incomplete-editor-row',
    condition: 'all',
    criteria: [
      { field: 'subject', operator: 'matches', value: 'Order * confirmed' },
      { field: 'subject', operator: 'contains', value: '' },
    ],
    actions: [{ type: 'move', folder: 'INBOX.Receipts' }],
  }], {
    uid: 1,
    subject: 'Order #37013 confirmed',
  });
  assert.deepEqual(incompleteEditorResult.matchedRuleIds, ['incomplete-editor-row']);
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
