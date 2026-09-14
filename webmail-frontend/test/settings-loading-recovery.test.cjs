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



test('a rules outage leaves Reading editable and scoped retry preserves saved and pending settings', async t => {
  const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost/'});
  const prior={};for(const[key,value]of Object.entries({window:dom.window,document:dom.window.document,navigator:dom.window.navigator,HTMLElement:dom.window.HTMLElement,Node:dom.window.Node,IS_REACT_ACT_ENVIRONMENT:true})){prior[key]=global[key];global[key]=value;}
  const restore=installTypeScriptLoader();const React=require('react');const{createRoot}=require('react-dom/client');const{createMemoryRouter,RouterProvider}=require('react-router');
  const actualSettings=require('../src/settings/settingsApi.ts');
  let mailReads=0;let ruleReads=0;let rejectRules=true;let rejectSave=true;let saved;
  const originalLoad=Module._load;
  Module._load=function(id,parent,isMain){
    if(parent?.filename.endsWith('/settings/routes.tsx')) {
      if(id==='./SettingsPanel')return {SettingsSidebar:()=>null,SettingsContent:props=>React.createElement('div',null,
        React.createElement('p',null,props.activeTab+' '+props.mailSettings.compose.defaultMode),
        React.createElement('button',{onClick:()=>props.onMailSettingsChange({...props.mailSettings,compose:{...props.mailSettings.compose,defaultMode:'html'}})},'Edit format'),
        React.createElement('button',{onClick:()=>props.onFlushSettings()},'Flush'))};
      if(id==='./settingsApi')return {...actualSettings,getUserSettings:async namespace=>{
        if(namespace==='mail'){mailReads++;return structuredClone(actualSettings.defaultMailSettings);}
        if(namespace==='calendar')return actualSettings.defaultCalendarSettings;
        if(namespace==='contacts')return actualSettings.defaultContactsSettings;
        return require('../src/settings/appearance.ts').DEFAULT_APPEARANCE;
      },saveUserSettings:async(namespace,value)=>{if(rejectSave)throw new Error('Save unavailable');saved=structuredClone(value);}};
      if(id==='../shared/api')return {fetchRules:async()=>{ruleReads++;if(rejectRules)throw new Error('Rules unavailable');return [];},fetchFolders:async()=>[],fetchIdentities:async()=>({address:'owner@example.test',aliases:[]}),fetchCalendars:()=>new Promise(()=>{})};
    }
    return originalLoad.call(this,id,parent,isMain);
  };
  const{SettingsRoutes}=require('../src/settings/routes.tsx');Module._load=originalLoad;
  const router=createMemoryRouter([{path:'/settings/*',element:React.createElement(SettingsRoutes)}],{initialEntries:['/settings/mail_reading']});
  const root=createRoot(document.getElementById('root'));
  t.after(async()=>{await React.act(async()=>root.unmount());restore();dom.window.close();Object.assign(global,prior);Module._load=originalLoad;});
  await React.act(async()=>root.render(React.createElement(RouterProvider,{router})));
  assert.match(document.body.textContent,/mail_reading plain/);
  const click=label=>{const element=[...document.querySelectorAll('button')].find(button=>button.textContent===label);assert.ok(element,label);element.click();};
  await React.act(async()=>click('Edit format'));
  await React.act(async()=>click('Flush'));
  assert.match(document.body.textContent,/mail_reading html/);
  await React.act(async()=>router.navigate('/settings/mail_filters'));
  assert.equal(router.state.location.pathname,'/settings/mail_reading');
  assert.match(document.body.textContent,/Changes could not be saved/);
  rejectSave=false;
  await React.act(async()=>click('Retry save'));
  assert.equal(router.state.location.pathname,'/settings/mail_filters');
  assert.match(document.body.textContent,/Rules unavailable/);
  assert.equal(saved.compose.defaultMode,'html');
  rejectRules=false;
  await React.act(async()=>click('Retry rules'));
  assert.match(document.body.textContent,/mail_filters html/);
  assert.equal(ruleReads,2);assert.equal(mailReads,1);
  await React.act(async()=>router.navigate('/settings/mail_reading'));
  assert.match(document.body.textContent,/mail_reading html/);
});
