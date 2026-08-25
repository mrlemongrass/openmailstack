const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
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

function click(element, window) {
  element.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
}

function button(label) {
  return Array.from(document.querySelectorAll('button'))
    .find(element => element.getAttribute('aria-label') === label || element.textContent.trim() === label);
}

function menuItem(label) {
  return Array.from(document.querySelectorAll('[role="menuitem"]'))
    .find(element => element.textContent.trim() === label);
}

function visibleModalDialogs() {
  return Array.from(document.querySelectorAll('[role="dialog"][aria-modal="true"]'))
    .filter(element => !element.closest('[hidden]'));
}

test('mobile folder drawer yields to Compose and nested folder dialogs without competing focus traps', async t => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'http://openmailstack.test/mail/INBOX',
  });
  const previousGlobals = {
    window: global.window,
    document: global.document,
    navigator: global.navigator,
    HTMLElement: global.HTMLElement,
    Node: global.Node,
    Event: global.Event,
    KeyboardEvent: global.KeyboardEvent,
    MouseEvent: global.MouseEvent,
    IS_REACT_ACT_ENVIRONMENT: global.IS_REACT_ACT_ENVIRONMENT,
  };
  Object.assign(global, {
    window: dom.window,
    document: dom.window.document,
    navigator: dom.window.navigator,
    HTMLElement: dom.window.HTMLElement,
    Node: dom.window.Node,
    Event: dom.window.Event,
    KeyboardEvent: dom.window.KeyboardEvent,
    MouseEvent: dom.window.MouseEvent,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  Object.defineProperty(dom.window.HTMLElement.prototype, 'getClientRects', {
    configurable: true,
    value: () => [{ width: 100, height: 24 }],
  });
  Object.defineProperty(dom.window.HTMLElement.prototype, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ x: 8, y: 8, top: 8, left: 8, right: 108, bottom: 32, width: 100, height: 24 }),
  });
  const restoreTypeScriptLoader = installTypeScriptLoader();
  const React = require('react');
  const { act } = React;
  const { createRoot } = require('react-dom/client');
  const { MemoryRouter } = require('react-router');
  const originalLoad = Module._load;
  const panel = ({ children }) => React.createElement('div', null, children);
  Module._load = function load(request, parent, isMain) {
    if (request === '../shared/hooks/useMediaQuery' && parent?.filename.endsWith('/mail/MailLayout.tsx')) {
      return { useMediaQuery: () => true };
    }
    if (request === 'react-resizable-panels') {
      return {
        Panel: panel,
        Group: panel,
        Separator: panel,
        useDefaultLayout: () => ({ defaultLayout: undefined, onLayoutChange: () => undefined }),
      };
    }
    return originalLoad.call(this, request, parent, isMain);
  };
  const { MailLayout } = require('../src/mail/MailLayout.tsx');
  Module._load = originalLoad;

  let composeCalls = 0;
  const mail = {
    outboundRecoveryNotice: null,
    setOutboundRecoveryNotice: () => undefined,
    folders: [
      { path: 'INBOX', delimiter: '/', unseen: 2, specialUse: '\\Inbox' },
      { path: 'Projects', delimiter: '/', unseen: 1 },
    ],
    activeFolder: 'INBOX',
    expandedFolders: {},
    setExpandedFolders: () => undefined,
    favoriteFolders: ['INBOX'],
    favoriteSettingsReady: true,
    favoriteSettingsError: '',
    markingReadFolder: null,
    toggleFavoriteFolder: async () => undefined,
    markFolderRead: async () => 0,
    retryFavoriteSettings: () => undefined,
    startCompose: () => { composeCalls += 1; },
    createFolder: async () => '',
    moveFolder: async () => '',
    renameFolder: async () => '',
    deleteFolder: async () => undefined,
    userQuota: null,
    mailUndo: null,
    undoAction: () => undefined,
    setMailUndo: () => undefined,
  };
  const root = createRoot(document.getElementById('root'));
  t.after(async () => {
    Module._load = originalLoad;
    await act(async () => root.unmount());
    restoreTypeScriptLoader();
    dom.window.close();
    Object.assign(global, previousGlobals);
  });

  await act(async () => {
    root.render(React.createElement(MemoryRouter, { initialEntries: ['/mail/INBOX'] },
      React.createElement(MailLayout, { mail })));
  });

  const trigger = button('Open folders');
  trigger.focus();
  await act(async () => click(trigger, dom.window));
  assert.equal(visibleModalDialogs()[0]?.getAttribute('aria-label'), 'Mail folders');
  await act(async () => {
    document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
  assert.equal(visibleModalDialogs().length, 0);
  assert.equal(document.activeElement, trigger, 'closing the drawer restores its trigger');

  await act(async () => click(trigger, dom.window));
  await act(async () => click(button('Compose'), dom.window));
  assert.equal(composeCalls, 1);
  assert.equal(document.querySelector('.mobile-mail-folder-overlay'), null, 'Compose closes the drawer first');

  await act(async () => click(trigger, dom.window));
  await act(async () => click(button('Actions for Projects'), dom.window));
  await act(async () => {
    menuItem('Open').dispatchEvent(new dom.window.KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
    }));
  });
  assert.equal(document.querySelector('[role="menu"]'), null, 'Escape closes the topmost context menu');
  assert.equal(visibleModalDialogs()[0]?.getAttribute('aria-label'), 'Mail folders', 'the drawer stays open');
  assert.ok(visibleModalDialogs()[0].contains(document.activeElement), 'focus returns inside the drawer');

  await act(async () => click(button('Actions for Projects'), dom.window));
  await act(async () => click(menuItem('Delete'), dom.window));
  const overlay = document.querySelector('.mobile-mail-folder-overlay');
  assert.equal(overlay.hidden, true, 'the drawer is visually and semantically suspended');
  assert.equal(visibleModalDialogs().length, 1, 'only the delete confirmation remains modal');
  assert.match(visibleModalDialogs()[0].textContent, /Delete Projects/);

  await act(async () => {
    document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
  assert.equal(visibleModalDialogs().length, 1, 'Escape returns to the drawer after closing confirmation');
  assert.equal(overlay.hidden, false);
  assert.ok(overlay.contains(document.activeElement), 'focus returns inside the restored drawer');
});
