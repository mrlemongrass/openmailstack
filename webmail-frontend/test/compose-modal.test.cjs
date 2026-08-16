const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const componentPath = path.resolve(__dirname, '../src/mail/ComposeModal.tsx');

function loadTypeScriptModule(sourcePath) {
  const source = fs.readFileSync(sourcePath, 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: sourcePath,
  }).outputText;
  const loadedModule = new Module(sourcePath, module);
  loadedModule.paths = module.paths;
  loadedModule._compile(compiled, sourcePath);
  return loadedModule.exports;
}

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
    if (id === '../shared/contactSuggestions') {
      return loadTypeScriptModule(path.resolve(__dirname, '../src/shared/contactSuggestions.ts'));
    }
    if (id === '../shared/hooks/useModalFocus') {
      return { useModalFocus: () => undefined };
    }
    if (id === './outbound-send-feedback') {
      return loadTypeScriptModule(path.resolve(__dirname, '../src/mail/outbound-send-feedback.ts'));
    }
    return Module.prototype.require.call(componentModule, id);
  };
  componentModule._compile(compiled, componentPath);
  return componentModule.exports;
}

function renderCompose(overrides = {}) {
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
      immediateSendPhase: 'idle',
      immediateSendNotice: null,
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
      allowRetryAfterVerifiedNonDelivery: noop,
      checkEarlierComposeSend: noop,
      checkingEarlierComposeSend: false,
      ...overrides,
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
  const { uniqueContactSuggestions } = loadTypeScriptModule(
    path.resolve(__dirname, '../src/shared/contactSuggestions.ts'),
  );

  assert.deepEqual(uniqueContactSuggestions([
    { name: '', email: 'LOCALTEST@housevo.us' },
    { name: 'Local Test', email: 'localtest@housevo.us' },
    { name: 'Another Person', email: 'another@housevo.us' },
  ]), [
    { name: 'Local Test', email: 'LOCALTEST@housevo.us' },
    { name: 'Another Person', email: 'another@housevo.us' },
  ]);
});

test('scheduled send arms cancellation feedback and exposes labelled local date/time controls', () => {
  const source = fs.readFileSync(componentPath, 'utf8');

  assert.match(source, /scheduledDateFromLocalInputs\(scheduleDate, scheduleTime\)/);
  assert.match(source, /setDidSend\(true\);[\s\S]{0,160}mail\.handleSend\(sendAt\)/);
  assert.match(source, /aria-label="Scheduled send date"/);
  assert.match(source, /aria-label="Scheduled send time"/);
  assert.match(source, /role="alert"[\s\S]{0,200}\{scheduleError\}/);
  assert.match(source, /setScheduleError\('Choose a future date and time\.'\)/);
});

test('compose makes uncertain delivery explicit and prevents an unchanged resend', () => {
  const markup = renderCompose({
    immediateSendPhase: 'uncertain',
    immediateSendNotice: {
      tone: 'warning',
      message: 'Delivery status is uncertain. Do not resend until you verify whether the recipient received it.',
    },
  });

  assert.match(markup, /class="compose-send-notice warning"[^>]*role="alert"/);
  assert.match(markup, /Delivery status is uncertain/);
  assert.match(markup, /Do not resend/);
  assert.match(markup, /Check earlier send/);
  assert.match(markup, /I verified it was not delivered/);
  assert.match(markup, /<button[^>]*disabled=""[^>]*><svg[^>]*><\/svg> Do not resend<\/button>/);
});

test('compose exposes recovery for an unresolved delivery change without rotating the send', () => {
  const markup = renderCompose({
    immediateSendPhase: 'blocked',
    immediateSendNotice: {
      tone: 'warning',
      message: 'An earlier send of this unchanged message is unresolved.',
    },
  });

  assert.match(markup, /class="compose-send-notice warning"[^>]*role="alert"/);
  assert.match(markup, /Check earlier send/);
  assert.doesNotMatch(markup, /I verified it was not delivered/);
  assert.match(markup, /<button[^>]*disabled=""[^>]*><svg[^>]*><\/svg> Do not resend<\/button>/);
});

test('compose labels a retained ambiguous attempt as a safe delivery check', () => {
  const markup = renderCompose({
    immediateSendPhase: 'retryable',
    immediateSendNotice: {
      tone: 'info',
      message: 'Delivery was not confirmed. Use “Check delivery” to safely continue the same send attempt.',
    },
  });

  assert.match(markup, /class="compose-send-notice info"[^>]*role="status"/);
  assert.match(markup, /same send attempt/);
  assert.match(markup, /<svg[^>]*><\/svg> Check delivery<\/button>/);
});
