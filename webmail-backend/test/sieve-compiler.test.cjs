const test = require('node:test');
const assert = require('node:assert/strict');

const {
  compileSieve,
  extractJsonFromSieve,
  quoteSieveString
} = require('../src/sieve-compiler.js');

test('quoteSieveString escapes quotes, backslashes, and newlines', () => {
  assert.equal(quoteSieveString('a"b\\c\nx'), '"a\\"b\\\\c x"');
});

test('compileSieve escapes user-controlled criteria and folder values', () => {
  const script = compileSieve({
    rules: [
      {
        name: 'Injection attempt',
        condition: 'all',
        criteria: [
          { field: 'subject', operator: 'contains', value: 'bad"; discard; #' }
        ],
        actions: [
          { type: 'move', folder: 'INBOX"\r\nstop;' }
        ]
      }
    ]
  });

  assert.match(script, /JSON_DATA_BASE64:/);
  assert.ok(script.includes('header :contains "Subject" "bad\\"; discard; #"'));
  assert.ok(script.includes('fileinto "INBOX\\" stop;";'));
  assert.doesNotMatch(script, /fileinto "INBOX"\r?\nstop;/);
});

test('compileSieve stores UI JSON as base64 and round-trips unsafe comment content', () => {
  const document = {
    rules: [
      {
        name: 'Comment closer */ stays data',
        condition: 'any',
        criteria: [
          { field: 'from', operator: 'not_contains', value: 'bad@example.com' },
          { field: 'body', operator: 'equals', value: 'invoice' }
        ],
        actions: [
          { type: 'discard' }
        ]
      }
    ]
  };

  const script = compileSieve(document);

  assert.doesNotMatch(script, /JSON_DATA: /);
  assert.deepEqual(extractJsonFromSieve(script), document);
  assert.ok(script.includes('if anyof ('));
  assert.ok(script.includes('not header :contains "From" "bad@example.com"'));
  assert.ok(script.includes('body :text :is "invoice"'));
});

test('extractJsonFromSieve keeps legacy JSON_DATA compatibility', () => {
  const legacyScript = '/* JSON_DATA: {"rules":[{"name":"legacy"}]} */';

  assert.deepEqual(extractJsonFromSieve(legacyScript), {
    rules: [{ name: 'legacy' }]
  });
});

test('compileSieve keeps legacy stop behavior and allows an ordered rule to continue', () => {
  const script = compileSieve({
    rules: [
      {
        name: 'Finance first',
        criteria: [{ field: 'subject', operator: 'contains', value: 'statement is available' }],
        actions: [{ type: 'move', folder: 'INBOX.Finance' }]
      },
      {
        name: 'Broad Chase rule',
        stopProcessing: false,
        criteria: [{ field: 'from', operator: 'contains', value: 'noreply@chase.com' }],
        actions: [{ type: 'move', folder: 'INBOX.ADs' }]
      }
    ]
  });

  const financeBlock = script.slice(
    script.indexOf('# Rule: Finance first'),
    script.indexOf('# Rule: Broad Chase rule')
  );
  const chaseBlock = script.slice(script.indexOf('# Rule: Broad Chase rule'));

  assert.match(financeBlock, /fileinto "INBOX\.Finance";[\s\S]*stop;/);
  assert.match(chaseBlock, /fileinto "INBOX\.ADs";/);
  assert.doesNotMatch(chaseBlock, /\bstop;/);
});
