const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

const sourcePath = path.resolve(__dirname, '../src/mail/message-compose-actions.ts');

function loadModule() {
  const source = fs.readFileSync(sourcePath, 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
    fileName: sourcePath,
  }).outputText;
  const loaded = new Module(sourcePath, module);
  loaded.paths = module.paths;
  loaded._compile(compiled, sourcePath);
  return loaded.exports;
}

const message = {
  uid: 42,
  subject: 'Quarterly plan',
  from: 'Alice Sender <alice@example.test>',
  replyTo: 'Campaign Desk <reply@example.test>',
  to: 'Owner <owner@example.test>, "Doe, Jane" <jane@example.test>',
  cc: 'ALICE@example.test, Teammate <team@example.test>',
  date: '2026-08-25T18:30:00Z',
  text: 'First line\nSecond line',
  messageId: '<quarterly-plan@example.test>',
  references: ['<project-root@example.test>'],
};

test('reply honors Reply-To and avoids stacking an existing reply prefix', () => {
  const { buildMessageComposeDraft } = loadModule();

  assert.deepEqual(
    buildMessageComposeDraft('reply', { ...message, subject: 'Re: Quarterly plan' }, ['owner@example.test']),
    {
      to: 'Campaign Desk <reply@example.test>',
      subject: 'Re: Quarterly plan',
      inReplyTo: '<quarterly-plan@example.test>',
      references: '<project-root@example.test> <quarterly-plan@example.test>',
    },
  );
});

test('reply all preserves quoted display names, excludes own identities, and de-duplicates by mailbox', () => {
  const { buildMessageComposeDraft } = loadModule();

  assert.deepEqual(
    buildMessageComposeDraft('reply-all', message, ['OWNER@example.test']),
    {
      to: 'Campaign Desk <reply@example.test>',
      cc: '"Doe, Jane" <jane@example.test>, Teammate <team@example.test>',
      subject: 'Re: Quarterly plan',
      inReplyTo: '<quarterly-plan@example.test>',
      references: '<project-root@example.test> <quarterly-plan@example.test>',
    },
  );
});

test('reply inherits In-Reply-To when the parent has no References chain', () => {
  const { buildMessageComposeDraft } = loadModule();

  const draft = buildMessageComposeDraft('reply', {
    ...message,
    references: [],
    inReplyTo: '<grandparent@example.test>',
  }, ['owner@example.test']);

  assert.equal(
    draft.references,
    '<grandparent@example.test> <quarterly-plan@example.test>',
  );
});

test('forward creates one forward prefix and quotes loaded plain text without recipients', () => {
  const { buildMessageComposeDraft } = loadModule();
  const draft = buildMessageComposeDraft('forward', { ...message, subject: 'Fwd: Quarterly plan' }, []);

  assert.equal(draft.subject, 'Fwd: Quarterly plan');
  assert.equal('to' in draft, false);
  assert.equal('inReplyTo' in draft, false);
  assert.match(draft.body, /---------- Forwarded message ---------/);
  assert.match(draft.body, /From: Alice Sender <alice@example\.test>/);
  assert.match(draft.body, /To: Owner <owner@example\.test>, "Doe, Jane" <jane@example\.test>/);
  assert.match(draft.body, /> First line\n> Second line/);
});
