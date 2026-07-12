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

const { markMessageBodyLoaded, mergeMessageDetails, messageCacheKey } = testModule.exports;

test('message detail survives a summary refresh after mark-as-read', () => {
  const detail = markMessageBodyLoaded({
    uid: 42,
    subject: 'Before refresh',
    from: 'sender@example.test',
    date: '2026-07-12T00:00:00.000Z',
    isRead: false,
    html: '<p>Full body</p>',
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
  assert.equal(merged.bodyLoaded, true);
  assert.equal(merged.isRead, true, 'the refreshed flag state must remain authoritative');
  assert.equal(merged.attachments[0].filename, 'proof.txt');
});

test('message cache keys are scoped by folder because IMAP UIDs are not global', () => {
  assert.notEqual(messageCacheKey('INBOX', 42), messageCacheKey('Archive', 42));
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
