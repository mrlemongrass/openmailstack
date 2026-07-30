const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const componentPath = path.resolve(__dirname, '../src/contacts/ContactEditModal.tsx');

function renderContactEditor() {
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
  const componentModule = new Module(componentPath, module);
  componentModule.paths = module.paths;
  componentModule.require = id => {
    if (id === 'lucide-react') {
      return new Proxy({}, {
        get: () => props => React.createElement('svg', props),
      });
    }
    if (id === '../shared/api') {
      return { saveContact: async () => ({ success: true }) };
    }
    if (id === '../shared/components/Toast') {
      return { useToast: () => ({ showToast: () => undefined }) };
    }
    return Module.prototype.require.call(componentModule, id);
  };
  componentModule._compile(compiled, componentPath);

  return renderToStaticMarkup(React.createElement(componentModule.exports.ContactEditModal, {
    contact: {},
    onClose: () => undefined,
    onSaved: () => undefined,
  }));
}

test('contact editor is an explicit, labelled modal workflow', () => {
  const markup = renderContactEditor();

  assert.match(markup, /class="glass-panel contact-dialog"[^>]*role="dialog"/);
  assert.match(markup, /aria-modal="true"/);
  assert.match(markup, /aria-labelledby="contact-dialog-title"/);
  assert.match(markup, /id="contact-dialog-title"[^>]*>Create Contact/);
  assert.match(markup, /aria-label="Close contact editor"/);
  assert.match(markup, /for="contact-first-name"/);
  assert.match(markup, /id="contact-first-name"/);
  assert.match(markup, /for="contact-email"/);
  assert.match(markup, /id="contact-email"/);
  assert.match(markup, /class="contact-dialog-footer"/);
  assert.match(markup, />Cancel</);
});

test('mobile contact editor keeps its action footer visible', () => {
  const css = fs.readFileSync(
    path.resolve(__dirname, '../src/index.css'),
    'utf8',
  );

  assert.match(css, /\.contact-dialog\s*\{[\s\S]*background:\s*var\(--surface-color\)/);
  assert.match(
    css,
    /@media \(max-width: 767px\)[\s\S]*\.contact-modal-overlay\s*\{[\s\S]*padding:\s*0[\s\S]*\.contact-dialog\s*\{[\s\S]*height:\s*100dvh[\s\S]*max-height:\s*none[\s\S]*border-radius:\s*0/,
  );
  assert.match(
    css,
    /@media \(max-width: 767px\)[\s\S]*\.contact-name-fields\s*\{[\s\S]*grid-template-columns:\s*1fr/,
  );
  assert.match(css, /\.contact-dialog-body\s*\{[\s\S]*overflow-y:\s*auto/);
});
