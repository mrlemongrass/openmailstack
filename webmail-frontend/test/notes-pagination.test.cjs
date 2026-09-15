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

test('large Notes pages stay bounded and every result remains reachable', async t => {
 const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost'});const previous={};
 for(const [key,value]of Object.entries({window:dom.window,document:dom.window.document,navigator:dom.window.navigator,HTMLElement:dom.window.HTMLElement,Node:dom.window.Node,Event:dom.window.Event,IS_REACT_ACT_ENVIRONMENT:true})){previous[key]=global[key];global[key]=value;}
 dom.window.HTMLElement.prototype.scrollTo=function(){this.scrollTop=0;};
 const restore=installTypeScriptLoader();const React=require('react');const {createRoot}=require('react-dom/client');
 const toastPath=require.resolve('../src/shared/components/Toast.tsx');require.cache[toastPath]={id:toastPath,filename:toastPath,loaded:true,exports:{useToast:()=>({showToast(){}})}};
 const {NotesGrid}=require('../src/notes/NotesGrid.tsx');const root=createRoot(document.getElementById('root'));
 t.after(async()=>{await React.act(async()=>root.unmount());restore();dom.window.close();Object.assign(global,previous);});
 const n={notes:Array.from({length:3000},(_,i)=>({id:String(i),title:'Note '+String(i).padStart(4,'0'),content:'body',labels_json:'[]',folder:'notes'})),notesView:'notes',notesLabels:[],notesSearchQuery:'',notesSort:'title_asc',isLoading:false};
 const render=()=>React.act(async()=>root.render(React.createElement(NotesGrid,{notesCtx:n})));
 await render();assert.equal(document.querySelectorAll('.contact-card').length,60);assert.match(document.body.textContent,/Page 1 of 50/);
 const next=()=>Array.from(document.querySelectorAll('button')).find(el=>el.textContent==='Next page');
 await React.act(async()=>next().click());assert.match(document.body.textContent,/Note 0060/);assert.doesNotMatch(document.body.textContent,/Note 0000/);
 n.notesSearchQuery='2999';await render();assert.equal(document.querySelectorAll('.contact-card').length,1);assert.match(document.body.textContent,/Note 2999/);assert.equal(next(),undefined);
});
