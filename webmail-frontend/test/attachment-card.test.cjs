const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const componentPath = path.resolve(__dirname, '../src/mail/components/AttachmentCard.tsx');

function loadComponent() {
  const source = fs.readFileSync(componentPath, 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
    fileName: componentPath,
  }).outputText;
  const loaded = new Module(componentPath, module);
  loaded.paths = module.paths;
  loaded.require = id => {
    if (id === 'lucide-react') {
      return new Proxy({}, { get: () => props => React.createElement('svg', props) });
    }
    if (id === '../draft-resume' || id === '../attachment-preview') {
      const helperPath = path.resolve(__dirname, `../src/mail/${id.split('/').at(-1)}.ts`);
      const helperSource = fs.readFileSync(helperPath, 'utf8');
      const helperCompiled = ts.transpileModule(helperSource, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
        fileName: helperPath,
      }).outputText;
      const helper = new Module(helperPath, module);
      helper.paths = module.paths;
      helper._compile(helperCompiled, helperPath);
      return helper.exports;
    }
    return Module.prototype.require.call(loaded, id);
  };
  loaded._compile(compiled, componentPath);
  return loaded.exports.AttachmentCard;
}

test('mail attachment download uses its encoded folder and message identity', () => {
  const AttachmentCard = loadComponent();
  const markup = renderToStaticMarkup(React.createElement(AttachmentCard, {
    sourceFolder: 'Projects/2026',
    messageUid: 42,
    attachment: {
      id: 7,
      filename: 'quarterly report.pdf',
      contentType: 'application/pdf',
      size: 4096,
    },
  }));

  assert.match(markup, /href="\/api\/folders\/Projects%2F2026\/messages\/42\/attachments\/7\?download=1"/);
  assert.match(markup, /download="quarterly report\.pdf"/);
  assert.match(markup, /aria-label="Download quarterly report\.pdf"/);
  assert.match(markup, /aria-label="Preview quarterly report\.pdf"/);

  const viewer = fs.readFileSync(path.resolve(__dirname, '../src/mail/MessageViewer.tsx'), 'utf8');
  assert.match(viewer, /<AttachmentCard[\s\S]{0,160}sourceFolder=\{sourceFolder\}[\s\S]{0,160}messageUid=\{message\.uid\}/);
});

test('image attachments offer Preview while unsupported attachments keep Download', () => {
  const AttachmentCard = loadComponent();
  for (const [contentType, filename, preview] of [
    ['image/png', 'photo.png', true], ['application/octet-stream', 'scan.pdf', true],
    ['text/html', 'unsafe.html', false], ['image/svg+xml', 'drawing.svg', false],
    ['application/zip', 'archive.zip', false],
  ]) {
    const markup = renderToStaticMarkup(React.createElement(AttachmentCard, {
      sourceFolder: 'INBOX', messageUid: 42, attachment: { id: 1, filename, contentType, size: 2048 },
    }));
    assert.equal(markup.includes(`aria-label="Preview ${filename}"`), preview);
    assert.ok(markup.includes(`aria-label="Download ${filename}"`));
  }
});
