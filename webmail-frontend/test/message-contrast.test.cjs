const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const test = require('node:test');
const ts = require('typescript');
const { JSDOM } = require('jsdom');

const sourcePath = path.resolve(__dirname, '../src/mail/message-contrast.ts');
const loaded = new Module(sourcePath, module);
loaded.paths = module.paths;
loaded._compile(ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, sourcePath);
const { correctMessageContrast } = loaded.exports;

function fixture(t, html, background = '#0b0f19', color = 'white') {
  const dom = new JSDOM(`<div id="root" style="background:${background};color:${color}">${html}</div>`);
  t.after(() => dom.window.close());
  return { root: dom.window.document.getElementById('root'), doc: dom.window.document };
}

test('mixed light panels and transparent dark regions remain readable', t => {
  const { root, doc } = fixture(t, '<div style="background:white"><p id="light">Inherited text</p></div><p id="dark" style="color:black!important">Black disclaimer</p>');
  assert.equal(correctMessageContrast(root), true);
  assert.equal(doc.getElementById('light').style.color, 'rgb(0, 0, 0)');
  assert.equal(doc.getElementById('dark').style.color, 'rgb(255, 255, 255)');
  assert.equal(doc.getElementById('light').parentElement.style.background, 'white');
});

test('repairing a parent preserves readable child colors and sender artwork', t => {
  const { root, doc } = fixture(t, '<div style="background:white"><p id="child" style="background:#32145f">White on purple</p><img src="data:image/png;base64,AAAA" style="filter:none"></div>');
  correctMessageContrast(root);
  assert.equal(doc.getElementById('child').style.color, 'rgb(255, 255, 255)');
  assert.equal(doc.getElementById('child').style.background, 'rgb(50, 20, 95)');
  assert.equal(doc.querySelector('img').getAttribute('src'), 'data:image/png;base64,AAAA');
  assert.equal(doc.querySelector('img').style.filter, 'none');
});

test('light mode repairs white text on transparent regions', t => {
  const { root, doc } = fixture(t, '<p id="text" style="color:white">Light text</p>', 'white', 'black');
  correctMessageContrast(root);
  assert.equal(doc.getElementById('text').style.color, 'rgb(0, 0, 0)');
});

test('translucent nested backgrounds and faint text use their composited contrast', t => {
  const { root, doc } = fixture(t, '<div style="background:rgba(255,255,255,0.95)"><p id="text" style="color:rgba(0,0,0,0.1)">Faint text</p></div>');
  correctMessageContrast(root);
  assert.equal(doc.getElementById('text').style.color, 'rgb(0, 0, 0)');
});

test('good sender colors and link targets are preserved', t => {
  const { root, doc } = fixture(t, '<a id="link" href="https://example.test" style="color:#123456">Readable link</a>', 'white', 'black');
  correctMessageContrast(root);
  assert.equal(doc.getElementById('link').style.color, 'rgb(18, 52, 86)');
  assert.equal(doc.getElementById('link').href, 'https://example.test/');
});

test('oversized markup selects the readable fallback before computing styles', t => {
  const { root } = fixture(t, '<span>Text</span>'.repeat(5001));
  assert.equal(correctMessageContrast(root), false);
  assert.equal(root.firstElementChild.style.color, '');
});


test('rendered email restores sender markup and recomputes when the app theme changes', async t => {
  const dom = new JSDOM('<style>.message-body {color:white;background:black} html.light .message-body {color:black;background:white}</style><div id="mount"></div>');
  const previous = Object.fromEntries(['window','document','navigator','MutationObserver','IS_REACT_ACT_ENVIRONMENT'].map(key=>[key,global[key]]));
  Object.assign(global, {window:dom.window,document:dom.window.document,navigator:dom.window.navigator,MutationObserver:dom.window.MutationObserver,IS_REACT_ACT_ENVIRONMENT:true});
  const React = require('react');
  const {createRoot} = require('react-dom/client');
  const componentPath = path.resolve(__dirname, '../src/mail/components/EmailBody.tsx');
  const component = new Module(componentPath,module); component.paths=module.paths;
  component.require = id => id === '../message-contrast' ? loaded.exports : Module.prototype.require.call(component,id);
  component._compile(ts.transpileModule(fs.readFileSync(componentPath,'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText,componentPath);
  const root=createRoot(document.getElementById('mount'));
  t.after(async()=>{await React.act(async()=>root.unmount());dom.window.close();Object.assign(global,previous);});
  const html='<p id="plain">Inherited text</p><p id="black" style="color:black">Black text</p>';
  await React.act(async()=>root.render(React.createElement(component.exports.EmailBody,{html})));
  assert.equal(document.getElementById('black').style.color,'rgb(255, 255, 255)');
  await React.act(async()=>{document.documentElement.className='light';await new Promise(resolve=>setTimeout(resolve,0));});
  assert.equal(document.getElementById('plain').style.color,'rgb(0, 0, 0)');
  assert.equal(document.getElementById('black').style.color,'rgb(0, 0, 0)');
  await React.act(async()=>document.querySelector('button').click());
  assert.ok(document.querySelector('.message-body-readable'));
  await React.act(async()=>document.querySelector('button').click());
  assert.equal(document.querySelector('.message-body-readable'),null);
  assert.equal(document.getElementById('black').style.color,'rgb(0, 0, 0)');
  await React.act(async()=>root.render(React.createElement(component.exports.EmailBody,{html:'<p id="replacement" style="color:white">New body</p>'})));
  assert.equal(document.getElementById('black'),null);
  assert.equal(document.getElementById('replacement').style.color,'rgb(0, 0, 0)');
});
