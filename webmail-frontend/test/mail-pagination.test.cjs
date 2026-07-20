const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

const sourcePath = path.resolve(__dirname, '../src/mail/mail-pagination.ts');
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
  appendOlderMessagePage,
  applyLoadedMessageAction,
  reconcileNewestMessagePage,
} = testModule.exports;

const message = (uid) => ({
  uid,
  subject: `Message ${uid}`,
  from: 'sender@example.test',
  date: `2026-07-19T00:00:${String(uid).padStart(2, '0')}.000Z`,
});

test('older message pages append in order without duplicate UIDs', () => {
  const current = [message(75), message(74)];
  const older = [message(74), message(73), message(73), message(72)];

  assert.deepEqual(
    appendOlderMessagePage(current, older).map((item) => item.uid),
    [75, 74, 73, 72],
  );
});

test('a refreshed newest page preserves the loaded older tail when pages overlap', () => {
  const current = [105, 104, 103, 102, 101, 100, 99].map(message);
  const refreshed = [107, 106, 105, 104, 103].map(message);

  const result = reconcileNewestMessagePage(current, refreshed);

  assert.equal(result.preservedTail, true);
  assert.deepEqual(
    result.messages.map((item) => item.uid),
    [107, 106, 105, 104, 103, 102, 101, 100, 99],
  );
});

test('a non-overlapping refresh resets instead of leaving a hidden UID gap', () => {
  const current = [105, 104, 103].map(message);
  const refreshed = [140, 139, 138].map(message);

  const result = reconcileNewestMessagePage(current, refreshed);

  assert.equal(result.preservedTail, false);
  assert.deepEqual(result.messages.map((item) => item.uid), [140, 139, 138]);
});

test('successful actions update or remove loaded messages without collapsing older pages', () => {
  const current = [message(75), message(74), message(73)];

  const markedRead = applyLoadedMessageAction(current, 'read', [74]);
  assert.equal(markedRead.find((item) => item.uid === 74).isRead, true);

  const archived = applyLoadedMessageAction(markedRead, 'archive', [74]);
  assert.deepEqual(archived.map((item) => item.uid), [75, 73]);
});
