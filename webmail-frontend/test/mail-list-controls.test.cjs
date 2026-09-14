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


test('sorting keeps distinct folder/UID identities and never mutates source messages',()=>{
 const {sortMailMessages}=loadTypeScriptModule('../src/mail/mail-list-controls.ts');
 const messages=[{uid:1,folder:'INBOX',from:'Zed',subject:'B',date:'2026-02-01'},{uid:1,folder:'Other',from:'Amy',subject:'A',date:'2026-01-01'}];
 assert.equal(sortMailMessages(messages,'oldest')[0].folder,'Other');
 assert.equal(sortMailMessages(messages,'sender-asc')[0].from,'Amy');
 assert.equal(sortMailMessages(messages,'subject-desc')[0].subject,'B');
 assert.equal(messages[0].from,'Zed');
});
test('mail shortcuts respect editors, menus, dialogs, modifier keys and IME composition',()=>{
 const {ignoreMailShortcut}=loadTypeScriptModule('../src/mail/mail-list-controls.ts');
 global.document={querySelector:()=>null};
 const base={target:{closest:()=>null}};
 assert.equal(ignoreMailShortcut(base),false);
 for(const key of ['ctrlKey','metaKey','altKey','defaultPrevented','isComposing']) assert.equal(ignoreMailShortcut({...base,[key]:true}),true);
 assert.equal(ignoreMailShortcut({target:{closest:()=>({})}}),true);
 global.document={querySelector:()=>({})};assert.equal(ignoreMailShortcut(base),true);
 delete global.document;
});


test('draft ownership excludes another window and cancels a late lock acquisition', async () => {
 const {createDraftOwnership}=loadTypeScriptModule('../src/mail/draft-ownership.ts');
 const held=new Set();
 const locks={request:async(name,_options,callback)=>{
  await Promise.resolve();
  if(held.has(name)) return callback(null);
  held.add(name); try {await callback({name});} finally {held.delete(name);}
 }};
 const first=createDraftOwnership(locks), second=createDraftOwnership(locks);
 assert.equal(await first.acquire('draft'),true);
 assert.equal(await second.acquire('draft'),false);
 first.release(); await new Promise(r=>setImmediate(r));
 assert.equal(await second.acquire('draft'),true); second.release();
 const late=createDraftOwnership(locks); const pending=late.acquire('late'); late.release();
 assert.equal(await pending,false);
 await new Promise(r=>setImmediate(r)); assert.equal(held.size,0);
});
test('settings task search resolves familiar terms and requires every query word',()=>{
 const tabs=loadTypeScriptModule('../src/settings/tabs.ts');
 const {findSettings}=loadTypeScriptModule('../src/settings/settingsNavigation.ts',{'./tabs':tabs});
 assert.equal(findSettings('import mbox')[0].tab,'mail_import');
 assert.equal(findSettings('keyboard shortcuts')[0].tab,'mail_reading');
 assert.equal(findSettings('plain text')[0].tab,'mail_identity');
 assert.equal(findSettings('nonsense query').length,0);
});
