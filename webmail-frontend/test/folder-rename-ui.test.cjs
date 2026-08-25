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

function setInputValue(input, value, window) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(input, value);
  input.dispatchEvent(new window.Event('input', { bubbles: true }));
}

test('folder rename UI protects system folders and recovers from a failed rename before routing the active subtree', async t => {
  const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
    url: 'http://openmailstack.test/mail/INBOX%2FReceipts%2F2025',
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
  global.window = dom.window;
  global.document = dom.window.document;
  global.navigator = dom.window.navigator;
  global.HTMLElement = dom.window.HTMLElement;
  global.Node = dom.window.Node;
  global.Event = dom.window.Event;
  global.KeyboardEvent = dom.window.KeyboardEvent;
  global.MouseEvent = dom.window.MouseEvent;
  global.IS_REACT_ACT_ENVIRONMENT = true;
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
  const calls = [];
  const favoriteCalls = [];
  const markReadCalls = [];
  let resolveMarkRead;
  let resolveFavoriteSave;
  let rejectRename;
  let attempt = 0;
  let finishFavoriteSettingsLoad;
  const onRenameFolder = (folderPath, name) => {
    calls.push([folderPath, name]);
    attempt += 1;
    if (attempt === 1) {
      return new Promise((_resolve, reject) => { rejectRename = reject; });
    }
    return Promise.resolve({ path: 'INBOX/Statements' });
  };
  function LocationProbe() {
    return React.createElement('output', { id: 'location' }, useLocation().pathname);
  }
  function SidebarHarness(props) {
    const [markingReadFolder, setMarkingReadFolder] = React.useState(null);
    return React.createElement(FolderSidebar, {
      ...props,
      markingReadFolder,
      onMarkFolderRead: async folderPath => {
        setMarkingReadFolder(folderPath);
        try {
          return await props.onMarkFolderRead(folderPath);
        } finally {
          setMarkingReadFolder(null);
        }
      },
    });
  }
  function SidebarWithFavoriteSettings(props) {
    const [favoriteSettings, setFavoriteSettings] = React.useState({
      ready: false,
      error: 'Favorites could not be loaded.',
      folders: [],
    });
    const [folderMutationPending, setFolderMutationPending] = React.useState(false);
    const [expandedFolders, setExpandedFolders] = React.useState(props.expandedFolders);
    finishFavoriteSettingsLoad = () => setFavoriteSettings({
      ready: true,
      error: '',
      folders: ['INBOX/Receipts'],
    });
    return React.createElement(SidebarHarness, {
      ...props,
      favoriteFolders: favoriteSettings.folders,
      favoriteSettingsReady: favoriteSettings.ready,
      favoriteSettingsError: favoriteSettings.error,
      folderMutationPending,
      expandedFolders,
      onToggleExpand: folderPath => setExpandedFolders(current => ({
        ...current,
        [folderPath]: !current[folderPath],
      })),
      onToggleFavorite: async folderPath => {
        setFolderMutationPending(true);
        setFavoriteSettings(current => ({
          ...current,
          folders: current.folders.includes(folderPath)
            ? current.folders.filter(candidate => candidate !== folderPath)
            : [...current.folders, folderPath],
        }));
        try {
          await props.onToggleFavorite(folderPath);
        } finally {
          setFolderMutationPending(false);
        }
      },
    });
  }
  const root = createRoot(document.getElementById('root'));

  t.after(async () => {
    await act(async () => root.unmount());
    restoreTypeScriptLoader();
    dom.window.close();
    Object.assign(global, previousGlobals);
  });

  await act(async () => {
    root.render(React.createElement(MemoryRouter, {
      initialEntries: ['/mail/INBOX%2FReceipts%2F2025'],
    }, React.createElement(React.Fragment, null,
      React.createElement(SidebarWithFavoriteSettings, {
        folders: [
          { path: 'INBOX', delimiter: '/', unseen: 3 },
          { path: 'INBOX/Receipts', delimiter: '/', unseen: 1 },
          { path: 'INBOX/Receipts/2025', delimiter: '/', unseen: 0 },
          { path: 'Projects', delimiter: '/', unseen: 0 },
          { path: 'Sent', delimiter: '/', unseen: 0, specialUse: '\\Sent' },
        ],
        activeFolder: 'INBOX/Receipts/2025',
        expandedFolders: { INBOX: false, 'INBOX/Receipts': true },
        onToggleFavorite: folderPath => {
          favoriteCalls.push(folderPath);
          return new Promise(resolve => { resolveFavoriteSave = resolve; });
        },
        onMarkFolderRead: folderPath => {
          markReadCalls.push(folderPath);
          return new Promise(resolve => { resolveMarkRead = () => resolve(3); });
        },
        onCompose: () => undefined,
        onCreateFolder: async () => '',
        onMoveFolder: async () => '',
        onRenameFolder,
        onDeleteFolder: async () => undefined,
        quota: null,
      }),
      React.createElement(LocationProbe),
    )));
  });

  const actionButton = label => Array.from(document.querySelectorAll('button'))
    .find(button => button.getAttribute('aria-label') === label);
  const menuItem = label => Array.from(document.querySelectorAll('[role="menuitem"]'))
    .find(button => button.textContent.trim() === label);

  assert.match(document.querySelector('[role="alert"]').textContent, /Favorites could not be loaded/);
  await act(async () => click(actionButton('Actions for Projects'), dom.window));
  assert.equal(menuItem('Rename…').disabled, true, 'rename waits until Favorites are known');
  assert.equal(menuItem('Move…').disabled, true, 'move waits until Favorites are known');
  assert.equal(menuItem('Delete').disabled, true, 'delete waits until Favorites are known');
  await act(async () => {
    document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    finishFavoriteSettingsLoad();
  });

  const favorites = document.querySelector('[aria-label="Favorite folders"]');
  assert.ok(favorites, 'saved Favorites render as a distinct shortcut section');
  assert.match(favorites.textContent, /Receipts/);

  await act(async () => click(actionButton('Actions for INBOX'), dom.window));
  assert.equal(menuItem('Rename…'), undefined, 'INBOX must not expose Rename');
  assert.ok(menuItem('Mark all as read'), 'INBOX exposes the folder-wide read action');
  assert.ok(menuItem('Add to Favorites'), 'non-favorite folders can be added');
  await act(async () => click(menuItem('Mark all as read'), dom.window));
  assert.deepEqual(markReadCalls, ['INBOX']);
  const markReadStatuses = Array.from(document.querySelectorAll('[role="status"]'))
    .filter(element => element.textContent.includes('Marking INBOX as read'));
  assert.equal(markReadStatuses.length, 1, 'folder-wide progress has one live announcement');
  assert.ok(
    document.querySelector('.folder-row-pending[aria-hidden="true"]'),
    'folder-wide progress remains visibly attached to the row after the context menu closes',
  );
  await act(async () => resolveMarkRead());

  await act(async () => click(actionButton('Actions for INBOX'), dom.window));
  await act(async () => {
    document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });

  await act(async () => click(actionButton('Actions for Projects'), dom.window));
  assert.ok(menuItem('Rename…'), 'a custom top-level folder exposes Rename');
  await act(async () => {
    document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });

  await act(async () => click(actionButton('Actions for Receipts'), dom.window));
  assert.ok(menuItem('Rename…'), 'a custom subfolder exposes Rename');
  assert.ok(menuItem('Remove from Favorites'), 'favorite folders expose the inverse action');
  await act(async () => {
    click(menuItem('Remove from Favorites'), dom.window);
    await new Promise(resolve => dom.window.setTimeout(resolve, 0));
  });
  assert.deepEqual(favoriteCalls, ['INBOX/Receipts']);
  assert.doesNotMatch(favorites.textContent, /Receipts/, 'the removed shortcut unmounts');
  assert.equal(
    document.activeElement?.getAttribute('data-mail-folder-path'),
    'INBOX',
    'a collapsed subtree falls back to its nearest rendered ancestor',
  );

  await act(async () => click(actionButton('Actions for Projects'), dom.window));
  assert.equal(menuItem('Rename…').disabled, true, 'rename waits for the Favorite save');
  assert.equal(menuItem('Move…').disabled, true, 'move waits for the Favorite save');
  assert.equal(menuItem('Delete').disabled, true, 'delete waits for the Favorite save');
  await act(async () => {
    document.dispatchEvent(new dom.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    resolveFavoriteSave();
  });

  await act(async () => click(actionButton('Expand INBOX'), dom.window));
  await act(async () => click(actionButton('Actions for Receipts'), dom.window));
  await act(async () => click(menuItem('Rename…'), dom.window));

  const dialog = document.querySelector('[role="dialog"]');
  const input = dialog.querySelector('input');
  assert.equal(input.value, 'Receipts');
  assert.equal(document.activeElement, input, 'the prefilled folder name receives focus');
  assert.equal(input.selectionStart, 0);
  assert.equal(input.selectionEnd, 'Receipts'.length);

  await act(async () => setInputValue(input, 'Statements', dom.window));
  const renameButton = Array.from(dialog.querySelectorAll('button'))
    .find(button => button.textContent.trim() === 'Rename');
  await act(async () => click(renameButton, dom.window));
  assert.equal(renameButton.disabled, true);
  assert.equal(renameButton.textContent.trim(), 'Renaming…');
  assert.deepEqual(calls, [['INBOX/Receipts', 'Statements']]);

  await act(async () => rejectRename(new Error('A folder with that name already exists.')));
  assert.match(document.querySelector('[role="alert"]').textContent, /already exists/);
  assert.equal(document.querySelector('[role="dialog"] input').disabled, false);

  const retryButton = Array.from(document.querySelectorAll('[role="dialog"] button'))
    .find(button => button.textContent.trim() === 'Rename');
  await act(async () => click(retryButton, dom.window));

  assert.equal(document.querySelector('[role="dialog"]'), null);
  assert.deepEqual(calls, [
    ['INBOX/Receipts', 'Statements'],
    ['INBOX/Receipts', 'Statements'],
  ]);
  assert.equal(
    document.getElementById('location').textContent,
    '/mail/INBOX%2FStatements%2F2025',
  );
});

test('mark-all-read toolbar stays globally disabled while naming only the active folder as busy', t => {
  const restoreTypeScriptLoader = installTypeScriptLoader();
  t.after(restoreTypeScriptLoader);
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const { MailToolbar } = require('../src/mail/MailToolbar.tsx');
  const props = {
    selectedCount: 0,
    totalCount: 3,
    searchQuery: '',
    searchField: 'all',
    searchScope: 'folder',
    isSearchActive: false,
    selectionDisabled: false,
    activeFolder: 'INBOX',
    folders: [],
    onSearchChange: () => undefined,
    onSearchSubmit: () => undefined,
    onSearchFieldChange: () => undefined,
    onSearchScopeChange: () => undefined,
    onClearSearch: () => undefined,
    onSelectAll: () => undefined,
    onBulkAction: () => undefined,
    onMoveSelected: () => undefined,
    onMarkAllRead: () => undefined,
  };

  const currentFolder = renderToStaticMarkup(React.createElement(MailToolbar, {
    ...props,
    markAllReadPending: true,
    markAllReadDisabled: true,
  }));
  assert.match(currentFolder, /disabled=""[^>]*aria-busy="true"/);
  assert.match(currentFolder, />Marking read…<\/button>/);

  const otherFolder = renderToStaticMarkup(React.createElement(MailToolbar, {
    ...props,
    markAllReadPending: false,
    markAllReadDisabled: true,
  }));
  assert.match(otherFolder, /disabled=""/);
  assert.doesNotMatch(otherFolder, /aria-busy="true"/);
  assert.match(otherFolder, /title="Another folder is being marked as read"/);
  assert.match(otherFolder, />Mark all read<\/button>/);
});
