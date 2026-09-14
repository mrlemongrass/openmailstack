const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

const sourcePath = path.resolve(__dirname, '../src/mail/mail-message-identity.ts');
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


const { routeAfterMessageRemoval: route } = testModule.exports;
const before = [5, 4, 3, 2, 1].map(uid => ({ uid, folder: 'INBOX' }));
const removal = { folder: 'INBOX', uids: [4, 3], before };
test('removal follows visible order and skips every selected message', () => {
  assert.equal(route(removal, 'inbox', 4, 'previous'), '/mail/INBOX/5');
  assert.equal(route(removal, 'INBOX', 4, 'next'), '/mail/INBOX/2');
  assert.equal(route(removal, 'INBOX', 4), '/mail/INBOX');
  assert.equal(route({ ...removal, uids: [1] }, 'INBOX', 1, 'next'), '/mail/INBOX');
});
test('unrelated routes and folder-local UID collisions are preserved', () => {
  assert.equal(route(removal, 'Trash', 4, 'next'), null);
  assert.equal(route(removal, 'INBOX', 5, 'next'), null);
  const search = { ...removal, before: [{ uid: 4, folder: 'INBOX' }, { uid: 4, folder: 'Projects/Other' }] };
  assert.equal(route(search, 'INBOX', 4, 'next'), '/mail/Projects%2FOther/4');
});
