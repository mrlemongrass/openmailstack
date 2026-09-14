const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const test = require('node:test');
const ts = require('typescript');
const { JSDOM } = require('jsdom');
function installTypeScriptLoader() {
  const previous = {
    ts: Module._extensions['.ts'],
    tsx: Module._extensions['.tsx'],
  };
  const compile = (loadedModule, filename) => {
    const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
        esModuleInterop: true,
      },
      fileName: filename,
    }).outputText;
    loadedModule._compile(output, filename);
  };
  Module._extensions['.ts'] = compile;
  Module._extensions['.tsx'] = compile;
  return () => {
    if (previous.ts) Module._extensions['.ts'] = previous.ts;
    else delete Module._extensions['.ts'];
    if (previous.tsx) Module._extensions['.tsx'] = previous.tsx;
    else delete Module._extensions['.tsx'];
  };
}


test('navigation keeps failed edits available, retries saves, and requires discard for unsaved forms', async t => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' });
  const prior = {};
  for (const [key, value] of Object.entries({window:dom.window,document:dom.window.document,navigator:dom.window.navigator,HTMLElement:dom.window.HTMLElement,Node:dom.window.Node,Event:dom.window.Event,IS_REACT_ACT_ENVIRONMENT:true})) { prior[key]=global[key]; global[key]=value; }
  const restore=installTypeScriptLoader();
  const React=require('react'); const {createRoot}=require('react-dom/client');
  const {createMemoryRouter,RouterProvider}=require('react-router');
  const {UnsavedChangesGuard}=require('../src/shared/components/UnsavedChangesGuard.tsx');
  const root=createRoot(document.getElementById('root'));
  t.after(async()=>{await React.act(async()=>root.unmount());restore();dom.window.close();Object.assign(global,prior);});
  let saves=0; let succeed=false; let release;
  const save=async()=>{saves++; await new Promise(r=>{release=r;});return succeed;};
  const router=createMemoryRouter([{path:'/settings',element:React.createElement(UnsavedChangesGuard,{dirty:true,onSave:save})},{path:'/form',element:React.createElement(UnsavedChangesGuard,{dirty:true})},{path:'/done',element:React.createElement('p',null,'Done')}],{initialEntries:['/settings']});
  await React.act(async()=>root.render(React.createElement(RouterProvider,{router})));
  await React.act(async()=>router.navigate('/form'));
  assert.equal(router.state.location.pathname,'/settings'); assert.equal(saves,1);
  assert.match(document.body.textContent,/Saving changes/);
  await React.act(async()=>release());
  assert.match(document.body.textContent,/Changes could not be saved/);
  assert.equal(router.state.location.pathname,'/settings');
  const click=label=>Array.from(document.querySelectorAll('button')).find(b=>b.textContent===label).click();
  succeed=true;
  await React.act(async()=>click('Retry save'));
  await React.act(async()=>release());
  assert.equal(router.state.location.pathname,'/form'); assert.equal(saves,2);
  const unload=new dom.window.Event('beforeunload',{cancelable:true});
  dom.window.dispatchEvent(unload); assert.equal(unload.defaultPrevented,true);
  await React.act(async()=>router.navigate('/done'));
  assert.equal(router.state.location.pathname,'/form');
  await React.act(async()=>click('Keep editing'));
  assert.equal(router.state.location.pathname,'/form');
  await React.act(async()=>router.navigate('/done'));
  await React.act(async()=>click('Discard changes'));
  assert.equal(router.state.location.pathname,'/done');
});
