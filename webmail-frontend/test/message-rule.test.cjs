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


test('adding an alternative sender preserves ALL restrictions and actions', () => {
  const { appendRuleSender, messageRuleSender }=loadTypeScriptModule('../src/settings/message-rule.ts');
  const original={id:'x',condition:'all',criteria:[{id:'a',field:'from_address',operator:'equals',value:'a@example.test'},{id:'b',field:'subject',operator:'contains',value:'receipt'}],actions:[{id:'m',type:'move',folder:'Receipts'}]};
  const next=appendRuleSender(original,'b@example.test');
  assert.equal(next.condition,'all');
  assert.equal(next.enabled,true);
  const legacy=appendRuleSender({...original,condition:undefined,enabled:undefined},'b@example.test');
  assert.equal(legacy.condition,'all');
  assert.equal(legacy.enabled,true);
  assert.deepEqual(legacy.criteria[1],original.criteria[1]);
  assert.throws(()=>appendRuleSender({...original,condition:undefined,criteria:[original.criteria[1]]},'b@example.test'),/preserve its restrictions/);
  assert.equal(next.criteria[0].value,'a@example.test, b@example.test');
  assert.equal(next.criteria[0].operator,'is_one_of');
  assert.deepEqual(next.criteria[1],original.criteria[1]);
  assert.deepEqual(next.actions,original.actions);
  assert.equal(original.criteria[0].value,'a@example.test');
  assert.deepEqual(appendRuleSender(next,'b@example.test'),next);
  assert.throws(()=>appendRuleSender({...original,criteria:[original.criteria[1]]},'b@example.test'),/preserve its restrictions/);
  assert.equal(messageRuleSender('Someone <A@example.test>'),'a@example.test');
  assert.equal(messageRuleSender('not an address'),'');
});
