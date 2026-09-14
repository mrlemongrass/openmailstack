const assert=require('node:assert/strict');const test=require('node:test');const fs=require('node:fs');const Module=require('node:module');const ts=require('typescript');const {JSDOM}=require('jsdom');
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

test('shared destructive confirmation locks duplicate clicks and preserves failure for retry',async t=>{
 const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost'});const previous={};
 for(const [key,value]of Object.entries({window:dom.window,document:dom.window.document,navigator:dom.window.navigator,HTMLElement:dom.window.HTMLElement,Node:dom.window.Node,Event:dom.window.Event,IS_REACT_ACT_ENVIRONMENT:true})){previous[key]=global[key];global[key]=value;}
 const restore=installTypeScriptLoader();const React=require('react');const {createRoot}=require('react-dom/client');const {useActionConfirmation}=require('../src/shared/components/ActionConfirmation.tsx');
 let controls;let writes=0;let reject;const pending=new Promise((_resolve,r)=>reject=r);
 function Harness(){controls=useActionConfirmation();return controls.dialog;}
 const root=createRoot(document.getElementById('root'));t.after(async()=>{await React.act(async()=>root.unmount());restore();dom.window.close();Object.assign(global,previous);});
 await React.act(async()=>root.render(React.createElement(Harness)));
 await React.act(async()=>controls.ask({title:'Move contact to Trash?',message:'Restore it later from Trash.',label:'Move to Trash',run:async()=>{writes++;if(writes===1)await pending;}}));
 const button=()=>Array.from(document.querySelectorAll('button')).find(e=>e.textContent==='Move to Trash');
 await React.act(async()=>{button().click();button().click();});assert.equal(writes,1);assert.equal(button().disabled,true);
 await React.act(async()=>reject(new Error('Server rejected this change')));assert.match(document.body.textContent,/Server rejected this change/);assert.ok(document.querySelector('[role="dialog"]'));
 await React.act(async()=>button().click());assert.equal(writes,2);assert.equal(document.querySelector('[role="dialog"]'),null);
});
