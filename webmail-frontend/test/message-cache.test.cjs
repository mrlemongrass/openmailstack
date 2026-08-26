const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

const sourcePath = path.resolve(__dirname, '../src/mail/message-cache.ts');
const source = fs.readFileSync(sourcePath, 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
  fileName: sourcePath,
}).outputText;
const testModule = new Module(sourcePath, module);
testModule.paths = module.paths;
testModule._compile(compiled, sourcePath);

const {
  createMessageDetailLoader,
  mailboxPathsEqual,
  markMessageBodyLoaded,
  mergeMessageDetails,
  messageCacheKey,
} = testModule.exports;

test('message detail survives a summary refresh after mark-as-read', () => {
  const detail = markMessageBodyLoaded({
    uid: 42,
    subject: 'Before refresh',
    from: 'sender@example.test',
    date: '2026-07-12T00:00:00.000Z',
    isRead: false,
    html: '<p>Full body</p>',
    bodyMode: 'rich',
    attachments: [{ id: 1, filename: 'proof.txt', contentType: 'text/plain', size: 5 }],
  });
  const refreshedSummary = {
    uid: 42,
    subject: 'Before refresh',
    from: 'sender@example.test',
    date: '2026-07-12T00:00:00.000Z',
    isRead: true,
    preview: 'Full body',
  };

  const merged = mergeMessageDetails(refreshedSummary, detail);

  assert.equal(merged.html, '<p>Full body</p>');
  assert.equal(merged.bodyMode, 'rich');
  assert.equal(merged.bodyLoaded, true);
  assert.equal(merged.isRead, true, 'the refreshed flag state must remain authoritative');
  assert.equal(merged.attachments[0].filename, 'proof.txt');
});

test('message cache keys are scoped by folder because IMAP UIDs are not global', () => {
  assert.notEqual(messageCacheKey('INBOX', 42), messageCacheKey('Archive', 42));
  assert.equal(messageCacheKey('inbox', 42), messageCacheKey('INBOX', 42));
});

test('an empty message body is still a completed load', () => {
  const detail = markMessageBodyLoaded({
    uid: 7,
    subject: '',
    from: '',
    date: '2026-07-12T00:00:00.000Z',
    html: '',
    text: '',
  });

  assert.equal(mergeMessageDetails({ ...detail, bodyLoaded: undefined }, detail).bodyLoaded, true);
});

test('mobile viewer joins an in-flight prefetch and treats INBOX casing as one mailbox', async () => {
  let resolveDetail;
  let calls = 0;
  const detailPromise = new Promise(resolve => { resolveDetail = resolve; });
  const loader = createMessageDetailLoader(async () => {
    calls += 1;
    return detailPromise;
  });

  const prefetch = loader.load('INBOX', 101);
  const viewer = loader.load('INBOX', 101);
  assert.equal(calls, 1, 'the viewer must join the prefetch instead of being suppressed by it');

  resolveDetail({ uid: 101, subject: 'Privacy test', from: 'sender@example.test', date: '', text: 'Loaded' });
  assert.equal((await prefetch)?.text, 'Loaded');
  assert.equal((await viewer)?.text, 'Loaded');
  assert.equal(loader.cached('INBOX', 101)?.text, 'Loaded');
  assert.equal(mailboxPathsEqual('inbox', 'INBOX'), true);
  assert.equal(mailboxPathsEqual('Projects', 'projects'), false);
});

test('a failed detail request can be retried by the viewer', async () => {
  let attempts = 0;
  const loader = createMessageDetailLoader(async () => {
    attempts += 1;
    if (attempts === 1) throw new Error('prefetch failed');
    return { uid: 101, subject: '', from: '', date: '', text: 'Recovered' };
  });

  await assert.rejects(loader.load('INBOX', 101), /prefetch failed/);
  assert.equal((await loader.load('INBOX', 101))?.text, 'Recovered');
  assert.equal(attempts, 2);
});
