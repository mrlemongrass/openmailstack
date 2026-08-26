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

test('forward preparation opens Compose once with every hydrated attachment', async () => {
  const { prepareMessageComposeAction } = loadModule();
  const files = [
    new File(['pdf'], 'plan.pdf', { type: 'application/pdf' }),
    new File(['csv'], 'forecast.csv', { type: 'text/csv' }),
  ];
  const opened = [];

  const result = await prepareMessageComposeAction({
    action: 'forward',
    message: { ...message, bodyLoaded: true },
    folderPath: 'INBOX',
    body: '',
    identitiesReady: true,
    ownAddresses: [],
    isCurrent: () => true,
    loadMessage: async () => { throw new Error('loaded detail should be reused'); },
    loadForwardContent: async () => ({
      message: { ...message, text: 'Hydrated original body', bodyLoaded: true },
      attachments: files,
    }),
    openCompose: initial => { opened.push(initial); return true; },
  });

  assert.equal(result, 'started');
  assert.equal(opened.length, 1);
  assert.equal(opened[0].subject, 'Fwd: Quarterly plan');
  assert.match(opened[0].body, /> Hydrated original body/);
  assert.deepEqual(opened[0].attachments, files);
});

test('forward preparation fails closed when an attachment batch is incomplete', async () => {
  const { prepareMessageComposeAction } = loadModule();
  let opened = false;

  const result = await prepareMessageComposeAction({
    action: 'forward',
    message: { ...message, bodyLoaded: true },
    folderPath: 'INBOX',
    body: '',
    identitiesReady: true,
    ownAddresses: [],
    isCurrent: () => true,
    loadMessage: async () => undefined,
    loadForwardContent: async () => { throw new Error('incomplete batch'); },
    openCompose: () => { opened = true; return true; },
  });

  assert.equal(result, 'attachments-unavailable');
  assert.equal(opened, false);
});

test('forward preparation preserves permanent attachment limit reasons', async () => {
  const { prepareMessageComposeAction } = loadModule();
  const baseInput = {
    action: 'forward',
    message: { ...message, bodyLoaded: true },
    folderPath: 'INBOX',
    body: '',
    identitiesReady: true,
    ownAddresses: [],
    isCurrent: () => true,
    loadMessage: async () => undefined,
    openCompose: () => { throw new Error('limited Forward must not open Compose'); },
  };

  for (const [code, expected] of [
    ['ATTACHMENT_COUNT_LIMIT', 'attachments-count-exceeded'],
    ['ATTACHMENT_FILE_SIZE_LIMIT', 'attachments-size-exceeded'],
    ['ATTACHMENT_TOTAL_SIZE_LIMIT', 'attachments-size-exceeded'],
    ['MESSAGE_SOURCE_LIMIT', 'message-size-exceeded'],
  ]) {
    const result = await prepareMessageComposeAction({
      ...baseInput,
      loadForwardContent: async () => {
        throw Object.assign(new Error('permanent attachment limit'), { code });
      },
    });
    assert.equal(result, expected);
  }
});

test('a newer compose intent wins while Forward attachments are still loading', async () => {
  const { prepareMessageComposeAction } = loadModule();
  let current = true;
  let releaseAttachments;
  let opened = false;
  const pendingAttachments = new Promise(resolve => { releaseAttachments = resolve; });

  const preparation = prepareMessageComposeAction({
    action: 'forward',
    message: { ...message, bodyLoaded: true },
    folderPath: 'INBOX',
    body: '',
    identitiesReady: true,
    ownAddresses: [],
    isCurrent: () => current,
    loadMessage: async () => undefined,
    loadForwardContent: () => pendingAttachments,
    openCompose: () => { opened = true; return true; },
  });

  current = false;
  releaseAttachments({
    message: { ...message, bodyLoaded: true },
    attachments: [new File(['pdf'], 'plan.pdf', { type: 'application/pdf' })],
  });

  assert.equal(await preparation, 'superseded');
  assert.equal(opened, false);
});
