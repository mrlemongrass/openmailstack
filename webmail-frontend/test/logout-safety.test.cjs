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



test('a rejected logout retains the session and reports failure', async t => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' });
  const prior = {};
  for (const [key, value] of Object.entries({window:dom.window,document:dom.window.document,navigator:dom.window.navigator,HTMLElement:dom.window.HTMLElement,Node:dom.window.Node,IS_REACT_ACT_ENVIRONMENT:true})) { prior[key]=global[key]; global[key]=value; }
  const previousFetch=global.fetch;
  global.fetch=async url => url==='/api/auth/logout'
    ? {ok:false,status:503}
    : {ok:true,json:async()=>url==='/api/auth/me'?{user:{username:'owner@example.test'}}:{identities:[]}};
  const restore=installTypeScriptLoader();
  const React=require('react'); const {createRoot}=require('react-dom/client');
  const {useAuth}=require('../src/shared/hooks/useAuth.ts');
  let auth;
  function Harness(){auth=useAuth();return null;}
  const root=createRoot(document.getElementById('root'));
  t.after(async()=>{await React.act(async()=>root.unmount());restore();dom.window.close();Object.assign(global,prior);global.fetch=previousFetch;});
  await React.act(async()=>root.render(React.createElement(Harness)));
  await React.act(async()=>auth.fetchMe());
  assert.equal(auth.isAuthenticated,true);
  await React.act(async()=>assert.rejects(auth.logout(), /sign out/i));
  assert.equal(auth.isAuthenticated,true);
  assert.equal(auth.user.email,'owner@example.test');
});

test('navigation waits for an in-flight editor operation before saving or leaving', async t => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' });
  const prior={};
  for(const [key,value] of Object.entries({window:dom.window,document:dom.window.document,navigator:dom.window.navigator,HTMLElement:dom.window.HTMLElement,Node:dom.window.Node,IS_REACT_ACT_ENVIRONMENT:true})){prior[key]=global[key];global[key]=value;}
  const restore=installTypeScriptLoader();
  const React=require('react'); const {createRoot}=require('react-dom/client');
  const {createMemoryRouter,RouterProvider}=require('react-router');
  const {UnsavedChangesGuard}=require('../src/shared/components/UnsavedChangesGuard.tsx');
  let saves=0;let unlock;
  function Editor(){const[locked,setLocked]=React.useState(true);unlock=()=>setLocked(false);return React.createElement(UnsavedChangesGuard,{dirty:true,locked,onSave:async()=>{saves++;return true;}});}
  const router=createMemoryRouter([{path:'/editor',element:React.createElement(Editor)},{path:'/logout',element:React.createElement('p',null,'Logout reached')}],{initialEntries:['/editor']});
  const root=createRoot(document.getElementById('root'));
  t.after(async()=>{await React.act(async()=>root.unmount());restore();dom.window.close();Object.assign(global,prior);});
  await React.act(async()=>root.render(React.createElement(RouterProvider,{router})));
  await React.act(async()=>router.navigate('/logout'));
  assert.equal(saves,0);
  assert.equal(router.state.location.pathname,'/editor');
  await React.act(async()=>unlock());
  assert.equal(saves,1);
  assert.equal(router.state.location.pathname,'/logout');
});

test('a save that closes its editor while awaiting refresh proceeds only once', async t => {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' });
  const prior={};
  for(const [key,value] of Object.entries({window:dom.window,document:dom.window.document,navigator:dom.window.navigator,HTMLElement:dom.window.HTMLElement,Node:dom.window.Node,IS_REACT_ACT_ENVIRONMENT:true})){prior[key]=global[key];global[key]=value;}
  const restore=installTypeScriptLoader();
  const React=require('react'); const {createRoot}=require('react-dom/client');
  const {createMemoryRouter,RouterProvider}=require('react-router');
  const {UnsavedChangesGuard}=require('../src/shared/components/UnsavedChangesGuard.tsx');
  let complete;let saves=0;
  function Editor(){const[dirty,setDirty]=React.useState(true);return React.createElement(UnsavedChangesGuard,{dirty,onSave:dirty?async()=>{saves++;setDirty(false);await new Promise(resolve=>complete=resolve);return true;}:undefined});}
  const router=createMemoryRouter([{path:'/editor',element:React.createElement(Editor)},{path:'/logout',element:React.createElement('p',null,'Logout reached')}],{initialEntries:['/editor']});
  const root=createRoot(document.getElementById('root'));
  t.after(async()=>{await React.act(async()=>root.unmount());restore();dom.window.close();Object.assign(global,prior);});
  await React.act(async()=>root.render(React.createElement(RouterProvider,{router})));
  await React.act(async()=>router.navigate('/logout'));
  assert.equal(router.state.location.pathname,'/editor');
  await React.act(async()=>complete());
  assert.equal(saves,1);assert.equal(router.state.location.pathname,'/logout');
  assert.match(document.body.textContent,/Logout reached/);
});
