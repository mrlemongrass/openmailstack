const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

const sourcePath = path.resolve(__dirname, '../src/mail/draft-resume.ts');

function loadModule() {
  const source = fs.readFileSync(sourcePath, 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: sourcePath,
  }).outputText;
  const loaded = new Module(sourcePath, module);
  loaded.paths = module.paths;
  loaded._compile(compiled, sourcePath);
  return loaded.exports;
}

const draft = {
  uid: 901,
  subject: 'Quarterly draft',
  from: 'Sales <sales@example.test>',
  to: 'buyer@example.net',
  cc: 'manager@example.test',
  bcc: 'audit@example.test',
  replyTo: 'support@example.test',
  date: '2026-08-15T12:00:00Z',
  html: '<p>Preserve this body</p>',
  text: 'Preserve this body',
  draftId: 'draft-resume-fixture',
  attachments: [{
    id: 3,
    filename: 'terms.txt',
    contentType: 'text/plain',
    size: 11,
  }],
};

test('draft resume restores all composer fields and stable identity', () => {
  const { draftComposeState, isDraftFolder } = loadModule();
  const attachmentFile = new File(['hello terms'], 'terms.txt', { type: 'text/plain' });

  assert.equal(isDraftFolder('Drafts'), true);
  assert.equal(isDraftFolder('[Gmail]/Drafts'), true);
  assert.equal(isDraftFolder('INBOX'), false);
  assert.deepEqual(draftComposeState(draft, [attachmentFile]), {
    from: 'sales@example.test',
    to: 'buyer@example.net',
    cc: 'manager@example.test',
    bcc: 'audit@example.test',
    replyTo: 'support@example.test',
    subject: 'Quarterly draft',
    body: 'Preserve this body',
    attachments: [attachmentFile],
    draftId: 'draft-resume-fixture',
    draftUid: '901',
  });
});

test('draft attachments hydrate from the encoded message-scoped endpoint', async () => {
  const { hydrateDraftAttachments } = loadModule();
  const requests = [];
  const files = await hydrateDraftAttachments(draft, 'Team/Drafts', async (url) => {
    requests.push(url);
    return new Response('hello terms', { status: 200, headers: { 'Content-Type': 'text/plain' } });
  });

  assert.deepEqual(requests, [
    '/api/folders/Team%2FDrafts/messages/901/attachments/3?download=1',
  ]);
  assert.equal(files[0].name, 'terms.txt');
  assert.equal(files[0].type, 'text/plain');
  assert.equal(await files[0].text(), 'hello terms');

  await assert.rejects(
    hydrateDraftAttachments(draft, 'Drafts', async () => new Response('', { status: 404 })),
    /terms\.txt could not be restored/,
  );
});

test('Drafts viewer opens the real composer without reply controls and sends stable draft identity', () => {
  const hook = fs.readFileSync(path.resolve(__dirname, '../src/mail/hooks/useMail.ts'), 'utf8');
  const viewer = fs.readFileSync(path.resolve(__dirname, '../src/mail/MessageViewer.tsx'), 'utf8');
  const cache = fs.readFileSync(path.resolve(__dirname, '../src/mail/message-cache.ts'), 'utf8');
  const row = fs.readFileSync(path.resolve(__dirname, '../src/mail/MessageRow.tsx'), 'utf8');
  const toolbar = fs.readFileSync(path.resolve(__dirname, '../src/mail/MailToolbar.tsx'), 'utf8');

  assert.match(hook, /const resumeDraft = useCallback[\s\S]*hydrateDraftAttachments[\s\S]*draftSaveCoordinatorRef\.current\.reset\([\s\S]*setDraftUid/);
  assert.match(hook, /formData\.append\('draftId',\s*currentDraft\.draftId\)/);
  assert.match(hook, /formData\.append\('draftUid',\s*currentDraft\.draftUid\)/);
  assert.match(viewer, /Edit draft/);
  assert.match(viewer, /!isScheduled && !isDraft && <InlineReply/);
  assert.match(row, /isDraft \? \([\s\S]*Delete draft[\s\S]*: !isScheduled &&/);
  assert.match(toolbar, /draftMode \? \([\s\S]*onBulkAction\('delete'\)[\s\S]*Delete/);
  assert.match(cache, /cc:\s*detail\.cc[\s\S]*bcc:\s*detail\.bcc[\s\S]*replyTo:\s*detail\.replyTo[\s\S]*draftId:\s*detail\.draftId/);
});
