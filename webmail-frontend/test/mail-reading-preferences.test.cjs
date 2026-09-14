const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

function loadTypeScriptModule(relativePath, overrides = {}) {
  const sourcePath = path.resolve(__dirname, relativePath);
  const source = fs.readFileSync(sourcePath, 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: sourcePath,
  }).outputText;
  const loaded = new Module(sourcePath, module);
  loaded.paths = module.paths;
  loaded.require = id => {
    if (Object.hasOwn(overrides, id)) return overrides[id];
    return Module.prototype.require.call(loaded, id);
  };
  loaded._compile(compiled, sourcePath);
  return loaded.exports;
}


test('conversation grouping uses reply identifiers within a folder, never subject alone', () => {
  const {groupRelatedMessages}=loadTypeScriptModule('../src/mail/message-grouping.ts');
  const messages=[
    {uid:5,folder:'INBOX',subject:'Same',messageId:'<c>',references:['<a>','<b>']},
    {uid:4,folder:'INBOX',subject:'Same',messageId:'<unrelated>'},
    {uid:3,folder:'INBOX',subject:'Different',messageId:'<b>',inReplyTo:'<a>'},
    {uid:2,folder:'Trash',subject:'Same',messageId:'<a>'},
    {uid:1,folder:'INBOX',subject:'Original',messageId:'<a>'},
  ];
  const grouped=groupRelatedMessages(messages,'INBOX',true);
  assert.deepEqual(grouped.map(m=>m.uid),[5,3,1,4,2]);
  assert.equal(grouped[0].threadCount,3);
  assert.equal(grouped[1].conversationPosition,1);
  assert.equal(grouped[3].threadCount,undefined);
  assert.deepEqual(groupRelatedMessages(messages,'INBOX',false),messages);
  assert.equal(messages[0].threadCount,undefined);
});

test('single-reference strings and orphan parents group without dropping any message', () => {
  const {groupRelatedMessages}=loadTypeScriptModule('../src/mail/message-grouping.ts');
  const messages=[{uid:4,messageId:'<four>',references:'<missing>'},{uid:3,messageId:'<three>',inReplyTo:'<missing>'},{uid:2,subject:'same'},{uid:1,subject:'same'}];
  const grouped=groupRelatedMessages(messages,'INBOX',true);
  assert.equal(grouped.length,4);
  assert.equal(grouped[0].threadCount,2);
  assert.equal(grouped[2].threadCount,undefined);
});
