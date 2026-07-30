const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const componentPath = path.resolve(__dirname, '../src/mail/ComposeModal.tsx');

function loadComposeModule() {
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
    if (id === '../shared/components/Spinner') {
      return { Spinner: () => React.createElement('span', null, 'Loading') };
    }
    if (id === '../shared/components/ConfirmDialog') {
      return { ConfirmDialog: () => null };
    }
    if (id === '../shared/components/Toast') {
      return { useToast: () => ({ showToast: () => undefined }) };
    }
    if (id === '../shared/api') {
      return { fetchContacts: async () => ({ contacts: [] }) };
    }
    if (id === '../settings/settingsApi') {
      return {
        getUserSettings: async () => ({ templates: [] }),
        saveUserSettings: async () => ({ templates: [] }),
      };
    }
    return Module.prototype.require.call(componentModule, id);
  };
  componentModule._compile(compiled, componentPath);
  return componentModule.exports;
}

function renderCompose() {
  const noop = () => undefined;
  return renderToStaticMarkup(React.createElement(loadComposeModule().ComposeModal, {
    mail: {
      isComposing: true,
      composeAttachments: [],
      composeTo: '',
      composeCc: '',
      composeBcc: '',
      composeSubject: '',
      composeBody: '',
      composeFrom: 'localtest@housevo.us',
      composeIdentities: [{ address: 'localtest@housevo.us', name: 'Local Test' }],
      composeSignature: 'none',
      composeError: null,
      draftSaveStatus: 'saved',
      sending: false,
      showCc: false,
      showBcc: false,
      signatures: [],
      undoSendId: null,
      setComposeAttachments: noop,
      setComposeTo: noop,
      setComposeCc: noop,
      setComposeBcc: noop,
      setComposeSubject: noop,
      setComposeBody: noop,
      setComposeFrom: noop,
      setComposeSignature: noop,
      setIsComposing: noop,
      setShowCc: noop,
      setShowBcc: noop,
      handleSend: noop,
      handleSendAndArchive: noop,
    },
  }));
}

test('compose opens as a labelled modal with stable recipient focus', () => {
  const markup = renderCompose();

  assert.match(markup, /class="glass-panel compose-dialog"[^>]*role="dialog"/);
  assert.match(markup, /aria-modal="true"/);
  assert.match(markup, /aria-labelledby="compose-dialog-title"/);
  assert.match(markup, /id="compose-dialog-title"[^>]*>New Message/);
  assert.match(markup, /placeholder="To"[^>]*autofocus=""/);
  assert.doesNotMatch(markup, /class="compose-modal-overlay"[^>]*tabindex=/);
  assert.match(markup, /aria-label="Close message composer"/);
  assert.match(markup, /aria-label="Attach files"/);
});

test('mobile compose uses an opaque full-screen sheet with grouped actions', () => {
  const markup = renderCompose();
  const css = fs.readFileSync(
    path.resolve(__dirname, '../src/index.css'),
    'utf8',
  );

  assert.match(markup, /class="compose-header"/);
  assert.match(markup, /class="compose-recipient-fields"/);
  assert.match(markup, /class="compose-body"/);
  assert.match(markup, /class="compose-footer"/);
  assert.match(markup, /class="compose-footer-tools"/);
  assert.match(markup, /class="compose-footer-status"/);
  assert.match(markup, /class="compose-footer-actions"/);
  assert.match(css, /\.compose-dialog\s*\{[\s\S]*background:\s*var\(--surface-color\)/);
  assert.match(
    css,
    /@media \(max-width: 767px\)[\s\S]*\.compose-modal-overlay\s*\{[\s\S]*padding:\s*0[\s\S]*\.compose-dialog\s*\{[\s\S]*width:\s*100%[\s\S]*height:\s*100dvh[\s\S]*max-height:\s*none[\s\S]*border-radius:\s*0/,
  );
});

test('compose autocomplete deduplicates case-insensitive email matches', () => {
  const { uniqueContactSuggestions } = loadComposeModule();

  assert.deepEqual(uniqueContactSuggestions([
    { name: '', email: 'LOCALTEST@housevo.us' },
    { name: 'Local Test', email: 'localtest@housevo.us' },
    { name: 'Another Person', email: 'another@housevo.us' },
  ]), [
    { name: 'Local Test', email: 'LOCALTEST@housevo.us' },
    { name: 'Another Person', email: 'another@housevo.us' },
  ]);
});
