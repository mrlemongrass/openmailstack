const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const test = require('node:test');
const ts = require('typescript');
const React = require('react');
const { JSDOM } = require('jsdom');

function load(relative, mocks = {}) {
  const filename = path.resolve(__dirname, '../src/mail', relative);
  const loaded = new Module(filename, module);
  loaded.paths = module.paths;
  loaded.require = id => mocks[id] || Module.prototype.require.call(loaded, id);
  loaded._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
  }).outputText, filename);
  return loaded.exports;
}

function mount(t) {
  const dom = new JSDOM('<div id="mount"></div>');
  const keys = ['window', 'document', 'navigator', 'IntersectionObserver', 'IS_REACT_ACT_ENVIRONMENT'];
  const previous = Object.fromEntries(keys.map(key => [key, global[key]]));
  Object.assign(global, { window: dom.window, document: dom.window.document, navigator: dom.window.navigator, IS_REACT_ACT_ENVIRONMENT: true });
  const root = require('react-dom/client').createRoot(document.getElementById('mount'));
  t.after(async () => { await React.act(async () => root.unmount()); dom.window.close(); Object.assign(global, previous); });
  return root;
}

test('inline media mounts only when visible and releases content and observer on exit', async t => {
  const root = mount(t);
  let notify;
  let disconnected = false;
  let active = 0;
  global.IntersectionObserver = class {
    constructor(callback) { notify = callback; }
    observe() {}
    disconnect() { disconnected = true; }
  };
  function PreviewContent({ maxBytes }) {
    React.useEffect(() => { active++; return () => { active--; }; }, []);
    return React.createElement('span', null, `budget:${maxBytes}`);
  }
  const { InlineAttachment } = load('components/InlineAttachment.tsx', { './AttachmentPreview': { PreviewContent } });
  await React.act(async () => root.render(React.createElement(InlineAttachment, {
    url: '/file', filename: 'file.pdf', kind: 'pdf', size: 100, onOpen() {},
  })));
  assert.equal(active, 0);
  await React.act(async () => notify([{ isIntersecting: true }]));
  assert.equal(active, 1);
  assert.match(document.body.textContent, /budget:100/);
  await React.act(async () => notify([{ isIntersecting: false }]));
  assert.equal(active, 0);
  await React.act(async () => root.render(null));
  assert.equal(disconnected, true);
});

test('collapse retains cards and changing message identity resets inline previews', async t => {
  const root = mount(t);
  const { MessageAttachments } = load('components/MessageAttachments.tsx', {
    '../attachment-preview': load('attachment-preview.ts'),
    './AttachmentCard': { AttachmentCard: props => React.createElement('div', { 'data-inline': String(props.inline) }, props.attachment.filename) },
  });
  const props = { sourceFolder: 'INBOX', messageUid: 1, attachments: [{ id: 1, filename: 'file.pdf', contentType: 'application/pdf', size: 100 }] };
  await React.act(async () => root.render(React.createElement(MessageAttachments, { ...props, key: 'INBOX:1' })));
  assert.equal(document.querySelector('[data-inline]').dataset.inline, 'true');
  await React.act(async () => document.querySelector('button').click());
  assert.equal(document.querySelector('[data-inline]').dataset.inline, 'false');
  assert.match(document.body.textContent, /file.pdf/);
  assert.equal(document.querySelector('button').getAttribute('aria-expanded'), 'false');
  await React.act(async () => root.render(React.createElement(MessageAttachments, { ...props, messageUid: 2, key: 'INBOX:2' })));
  assert.equal(document.querySelector('[data-inline]').dataset.inline, 'true');
});
