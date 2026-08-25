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

test('folder delete UI moves subtrees to Trash and reserves permanent deletion for Trash leaves', async t => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'http://openmailstack.test/mail/Projects%2F2026',
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
  const restoreTypeScriptLoader = installTypeScriptLoader();
  const React = require('react');
  const { act } = React;
  const { createRoot } = require('react-dom/client');
  const { MemoryRouter, useLocation } = require('react-router');
  const { FolderSidebar } = require('../src/mail/FolderSidebar.tsx');
  const { ToastProvider } = require('../src/shared/components/Toast.tsx');
  const calls = [];
  let searchCleanupRetries = 0;
  const root = createRoot(document.getElementById('root'));
  const initialFolders = [
    { path: 'INBOX', delimiter: '/', unseen: 2, specialUse: '\\Inbox' },
    { path: 'Projects', delimiter: '/', unseen: 1 },
    { path: 'Projects/2026', delimiter: '/', unseen: 0 },
    { path: 'Managed', delimiter: '/', unseen: 0 },
    { path: 'Managed/System', delimiter: '/', unseen: 0, specialUse: '\\Sent' },
    { path: 'Trash', delimiter: '/', unseen: 0, specialUse: '\\Trash' },
    { path: 'Trash/Old', delimiter: '/', unseen: 0 },
    { path: 'Trash/Tree', delimiter: '/', unseen: 0 },
    { path: 'Trash/Tree/Child', delimiter: '/', unseen: 0 },
    { path: 'Trash/Collision', delimiter: '.', unseen: 0 },
  ];

  function LocationProbe() {
    return React.createElement('output', { id: 'location' }, useLocation().pathname);
  }

  function Harness() {
    const [folders, setFolders] = React.useState(initialFolders);
    return React.createElement(React.Fragment, null,
      React.createElement(FolderSidebar, {
        folders,
        activeFolder: 'Projects/2026',
        expandedFolders: { Projects: true, Managed: true, Trash: true, 'Trash/Tree': true },
        favoriteFolders: [],
        favoriteSettingsReady: true,
        onToggleExpand: () => undefined,
        onToggleFavorite: async () => undefined,
        onMarkFolderRead: async () => 0,
        onCompose: () => undefined,
        onCreateFolder: async () => '',
        onMoveFolder: async () => '',
        onRenameFolder: async () => '',
        onRetrySearchCleanup: async () => { searchCleanupRetries += 1; },
        onDeleteFolder: async (folderPath, permanent) => {
          calls.push([folderPath, permanent]);
          if (permanent) {
            setFolders(previous => previous.filter(folder => folder.path !== folderPath));
            return {
              disposition: 'deleted',
              deletedPath: folderPath,
              warnings: ['SUBSCRIPTIONS_NOT_RECONCILED', 'SEARCH_INDEX_RESET_FAILED'],
            };
          }
          const source = folders.find(folder => folder.path === folderPath);
          const destinationPath = `Trash/${folderPath.split('/').at(-1)}`;
          setFolders(previous => previous.map(folder => (
            folder.path === folderPath || folder.path.startsWith(`${folderPath}/`)
              ? { ...folder, path: `${destinationPath}${folder.path.slice(folderPath.length)}` }
              : folder
          )));
          return {
            disposition: 'trashed',
            previousPath: folderPath,
            folder: { path: destinationPath, delimiter: '/', unseen: source?.unseen || 0 },
          };
        },
        quota: null,
      }),
      React.createElement(LocationProbe),
    );
  }

  t.after(async () => {
    await act(async () => root.unmount());
    restoreTypeScriptLoader();
    dom.window.close();
    Object.assign(global, previousGlobals);
  });

  await act(async () => {
    root.render(React.createElement(MemoryRouter, {
      initialEntries: ['/mail/Projects%2F2026'],
    }, React.createElement(ToastProvider, null, React.createElement(Harness))));
  });

  const actionButton = label => Array.from(document.querySelectorAll('button'))
    .find(button => button.getAttribute('aria-label') === label);
  const menuItem = label => Array.from(document.querySelectorAll('[role="menuitem"]'))
    .find(button => button.textContent.trim() === label);
  const dialogButton = label => Array.from(document.querySelectorAll('[role="dialog"] button'))
    .find(button => button.textContent.trim() === label);

  await act(async () => click(actionButton('Actions for Projects'), dom.window));
  await act(async () => click(menuItem('Delete'), dom.window));
  assert.match(document.querySelector('[role="dialog"]').textContent, /Move Projects to Trash/);
  assert.match(document.querySelector('[role="dialog"]').textContent, /subfolders and messages/);
  assert.match(document.querySelector('[role="dialog"]').textContent, /restore it with Move/);
  await act(async () => {
    click(dialogButton('Move to Trash'), dom.window);
    await new Promise(resolve => setTimeout(resolve, 10));
  });
  assert.deepEqual(calls, [['Projects', false]]);
  assert.equal(document.getElementById('location').textContent, '/mail/INBOX');
  assert.equal(document.activeElement?.dataset.mailFolderPath, 'Trash/Projects');

  await act(async () => click(actionButton('Actions for Trash/Collision'), dom.window));
  assert.ok(menuItem('Delete'));
  assert.equal(menuItem('Delete permanently'), undefined);
  await act(async () => document.activeElement.dispatchEvent(new dom.window.KeyboardEvent('keydown', {
    key: 'Escape',
    bubbles: true,
  })));

  await act(async () => click(actionButton('Actions for Old'), dom.window));
  assert.ok(menuItem('Delete permanently'));
  await act(async () => click(menuItem('Delete permanently'), dom.window));
  assert.match(document.querySelector('[role="dialog"]').textContent, /Permanently delete Old/);
  assert.match(document.querySelector('[role="dialog"]').textContent, /cannot be undone/i);
  await act(async () => {
    click(dialogButton('Delete permanently'), dom.window);
    await new Promise(resolve => setTimeout(resolve, 10));
  });
  assert.deepEqual(calls, [
    ['Projects', false],
    ['Trash/Old', true],
  ]);
  assert.equal(document.activeElement?.dataset.mailFolderPath, 'Trash');
  const warningToast = Array.from(document.querySelectorAll('[role="status"]'))
    .find(element => /subscriptions and search cleanup need attention/i.test(element.textContent));
  assert.ok(warningToast);
  assert.match(warningToast.textContent, /folder deletion completed/i);
  assert.match(warningToast.textContent, /check folder subscriptions in other mail clients/i);
  assert.doesNotMatch(warningToast.textContent, /messages are intact/i);
  await act(async () => {
    click(Array.from(warningToast.querySelectorAll('button'))
      .find(button => button.textContent.trim() === 'Retry search cleanup'), dom.window);
    await new Promise(resolve => setTimeout(resolve, 10));
  });
  assert.equal(searchCleanupRetries, 1);
  assert.ok(Array.from(document.querySelectorAll('[role="status"]'))
    .some(element => /search cleanup completed/i.test(element.textContent)));

  await act(async () => click(actionButton('Actions for Tree'), dom.window));
  assert.equal(menuItem('Delete subfolders first').disabled, true);

  await act(async () => click(actionButton('Actions for Managed'), dom.window));
  assert.equal(menuItem('Contains system folder')?.disabled, true);
});
