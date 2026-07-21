const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const loadTypeScriptModule = (relativePath) => {
  const sourcePath = path.resolve(__dirname, relativePath);
  const source = fs.readFileSync(sourcePath, 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
    fileName: sourcePath,
  }).outputText;
  const testModule = new Module(sourcePath, module);
  testModule.paths = module.paths;
  testModule._compile(compiled, sourcePath);
  return testModule.exports;
};

test('mail search waits for typing to pause and clears immediately', () => {
  const { createMailSearchInputController } = loadTypeScriptModule('../src/mail/mail-search-input.ts');
  const pending = new Map();
  const changedQueries = [];
  const searchedQueries = [];
  let nextTimer = 1;

  const controller = createMailSearchInputController({
    delayMs: 300,
    onQueryChange: query => changedQueries.push(query),
    onSearch: query => searchedQueries.push(query),
    schedule: (callback, delayMs) => {
      const timer = nextTimer++;
      pending.set(timer, { callback, delayMs });
      return timer;
    },
    cancel: timer => pending.delete(timer),
  });

  controller.update('pro');
  controller.update('project');

  assert.deepEqual(changedQueries, ['pro', 'project']);
  assert.deepEqual(searchedQueries, []);
  assert.equal(pending.size, 1);
  assert.equal([...pending.values()][0].delayMs, 300);

  [...pending.values()][0].callback();
  pending.clear();
  assert.deepEqual(searchedQueries, ['project']);

  controller.update('');
  assert.deepEqual(changedQueries, ['pro', 'project', '']);
  assert.deepEqual(searchedQueries, ['project', '']);
  assert.equal(pending.size, 0);
});

test('mail search submits the pending query immediately when Enter is pressed', () => {
  const { createMailSearchInputController } = loadTypeScriptModule('../src/mail/mail-search-input.ts');
  const pending = new Map();
  const searchedQueries = [];
  let nextTimer = 1;
  const controller = createMailSearchInputController({
    onQueryChange: () => undefined,
    onSearch: query => searchedQueries.push(query),
    schedule: callback => {
      const timer = nextTimer++;
      pending.set(timer, callback);
      return timer;
    },
    cancel: timer => pending.delete(timer),
  });

  controller.update('specific subject');
  assert.equal(controller.flush(), true);
  assert.deepEqual(searchedQueries, ['specific subject']);
  assert.equal(pending.size, 0);
  assert.equal(controller.flush(), false);
});

test('mail search sends every option and distinguishes folder from all-mail scope', async () => {
  const { searchMessages } = loadTypeScriptModule('../src/shared/api.ts');
  const originalFetch = global.fetch;
  const urls = [];
  global.fetch = async url => {
    urls.push(String(url));
    return { ok: true, json: async () => ({ success: true, messages: [] }) };
  };

  try {
    await searchMessages({
      query: 'quarterly plan',
      field: 'subject',
      scope: 'folder',
      folder: 'Projects/2026',
      limit: 75,
    });
    await searchMessages({
      query: 'invoice.pdf',
      field: 'attachments',
      scope: 'all',
      limit: 40,
    });

    assert.deepEqual(urls, [
      '/api/messages/search?q=quarterly+plan&field=subject&scope=folder&folder=Projects%2F2026&limit=75',
      '/api/messages/search?q=invoice.pdf&field=attachments&scope=all&limit=40',
    ]);
  } finally {
    global.fetch = originalFetch;
  }
});

test('mail search reports an API failure instead of silently keeping old results', async () => {
  const { searchMessages } = loadTypeScriptModule('../src/shared/api.ts');
  const originalFetch = global.fetch;
  global.fetch = async () => ({
    ok: false,
    status: 503,
    json: async () => ({ success: false, error: 'Search temporarily unavailable' }),
  });

  try {
    await assert.rejects(
      searchMessages({ query: 'project', field: 'all', scope: 'folder', folder: 'INBOX' }),
      /Search temporarily unavailable/,
    );
  } finally {
    global.fetch = originalFetch;
  }
});

test('mail search forwards an abort signal so superseded requests can be cancelled', async () => {
  const { searchMessages } = loadTypeScriptModule('../src/shared/api.ts');
  const originalFetch = global.fetch;
  const controller = new AbortController();
  let receivedSignal;
  global.fetch = async (_url, options) => {
    receivedSignal = options?.signal;
    return { ok: true, json: async () => ({ success: true, messages: [] }) };
  };

  try {
    await searchMessages({
      query: 'quarterly',
      field: 'all',
      scope: 'all',
      signal: controller.signal,
    });
    assert.equal(receivedSignal, controller.signal);
  } finally {
    global.fetch = originalFetch;
  }
});

test('starting a newer mail search aborts the previous in-flight request', () => {
  const { createMailSearchRequestCoordinator } = loadTypeScriptModule('../src/mail/mail-search-request.ts');
  const coordinator = createMailSearchRequestCoordinator();

  const first = coordinator.begin();
  const second = coordinator.begin();

  assert.equal(first.signal.aborted, true);
  assert.equal(second.signal.aborted, false);
  coordinator.complete(second);
  assert.equal(second.signal.aborted, false);

  const third = coordinator.begin();
  coordinator.cancel();
  assert.equal(third.signal.aborted, true);
});

test('message move sends the selected destination folder to the action API', async () => {
  const { messageAction } = loadTypeScriptModule('../src/shared/api.ts');
  const originalFetch = global.fetch;
  const requests = [];
  global.fetch = async (url, options) => {
    requests.push({ url: String(url), options });
    return { ok: true, json: async () => ({ success: true, targetFolder: 'Projects/2026' }) };
  };

  try {
    await messageAction('move', 'INBOX', [41, 42], 'Projects/2026');
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, '/api/messages/action');
    assert.deepEqual(JSON.parse(requests[0].options.body), {
      action: 'move',
      folder: 'INBOX',
      uids: [41, 42],
      targetFolder: 'Projects/2026',
    });
  } finally {
    global.fetch = originalFetch;
  }
});

test('mail toolbar exposes field and folder-scope controls', () => {
  const sourcePath = path.resolve(__dirname, '../src/mail/MailToolbar.tsx');
  const source = fs.readFileSync(sourcePath, 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
    fileName: sourcePath,
  }).outputText;
  const toolbarModule = new Module(sourcePath, module);
  toolbarModule.paths = module.paths;
  toolbarModule.require = id => {
    if (id === 'lucide-react') {
      return new Proxy({}, { get: () => props => React.createElement('svg', props) });
    }
    if (id === './components/MoveToPopover') {
      return { MoveToPopover: () => React.createElement('div', { role: 'dialog' }) };
    }
    if (id === './mail-message-identity') {
      return loadTypeScriptModule('../src/mail/mail-message-identity.ts');
    }
    return Module.prototype.require.call(toolbarModule, id);
  };
  toolbarModule._compile(compiled, sourcePath);

  const toolbarProps = {
    selectedCount: 2,
    totalCount: 2,
    searchQuery: '',
    searchField: 'all',
    searchScope: 'folder',
    isSearchActive: true,
    selectionDisabled: false,
    activeFolder: 'Projects',
    folders: [
      { path: 'INBOX', unseen: 0 },
      { path: 'Projects', unseen: 0 },
      { path: 'Archive', unseen: 0 },
    ],
    onSearchChange: () => undefined,
    onSearchSubmit: () => undefined,
    onSearchFieldChange: () => undefined,
    onSearchScopeChange: () => undefined,
    onClearSearch: () => undefined,
    onSelectAll: () => undefined,
    onBulkAction: () => undefined,
    onMoveSelected: () => undefined,
  };
  const markup = renderToStaticMarkup(React.createElement(toolbarModule.exports.MailToolbar, toolbarProps));

  assert.match(markup, /aria-label="Search field"/);
  assert.match(markup, /<option value="attachments">Attachments<\/option>/);
  assert.match(markup, /aria-label="Search scope"/);
  assert.match(markup, /<option value="folder" selected="">Current folder<\/option>/);
  assert.match(markup, /<option value="all">All mail<\/option>/);
  assert.match(markup, /in Projects/);
  assert.match(markup, /aria-label="Clear search"/);
  assert.match(markup, /title="Move to folder"/);
  assert.match(markup, /2 selected/);

  const disabledMarkup = renderToStaticMarkup(React.createElement(toolbarModule.exports.MailToolbar, {
    ...toolbarProps,
    selectionDisabled: true,
  }));
  assert.doesNotMatch(disabledMarkup, /title="Move to folder"/);
  assert.doesNotMatch(disabledMarkup, /2 selected/);
});

test('move picker renders destinations and completes a selected-folder workflow', () => {
  const sourcePath = path.resolve(__dirname, '../src/mail/components/MoveToPopover.tsx');
  const source = fs.readFileSync(sourcePath, 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
    fileName: sourcePath,
  }).outputText;
  const pickerModule = new Module(sourcePath, module);
  pickerModule.paths = module.paths;
  pickerModule.require = id => {
    if (id === 'lucide-react') {
      return new Proxy({}, { get: () => props => React.createElement('svg', props) });
    }
    if (id === './move-picker-selection') {
      return loadTypeScriptModule('../src/mail/components/move-picker-selection.ts');
    }
    return Module.prototype.require.call(pickerModule, id);
  };
  pickerModule._compile(compiled, sourcePath);

  const selected = [];
  let closed = false;
  const props = {
    folders: [
      { path: 'INBOX', unseen: 0 },
      { path: 'Projects/2026', unseen: 0 },
    ],
    onMove: folderPath => selected.push(folderPath),
    onClose: () => { closed = true; },
  };
  const markup = renderToStaticMarkup(React.createElement(pickerModule.exports.MoveToPopover, props));

  assert.match(markup, /role="dialog"/);
  assert.match(markup, /aria-label="Filter folders"/);
  assert.match(markup, />INBOX<\/button>/);
  assert.match(markup, />Projects\/2026<\/button>/);

  const { selectMoveDestination } = loadTypeScriptModule('../src/mail/components/move-picker-selection.ts');
  selectMoveDestination('Projects/2026', props.onMove, props.onClose);
  assert.deepEqual(selected, ['Projects/2026']);
  assert.equal(closed, true);
});

test('mail search identities and route lookups remain folder-qualified when UIDs collide', () => {
  const {
    groupMessagesByFolder,
    messageForRoute,
    messageIdentityKey,
    moveDestinationFolders,
  } = loadTypeScriptModule('../src/mail/mail-message-identity.ts');
  const messages = [
    { folder: 'INBOX', uid: 42, subject: 'Inbox copy' },
    { folder: 'Archive', uid: 42, subject: 'Archive copy' },
    { uid: 7 },
  ];

  assert.notEqual(messageIdentityKey(messages[0], 'INBOX'), messageIdentityKey(messages[1], 'INBOX'));
  assert.equal(messageForRoute(messages, 'Archive', 42)?.subject, 'Archive copy');
  assert.deepEqual(
    [...groupMessagesByFolder(messages, 'Projects')],
    [['INBOX', [42]], ['Archive', [42]], ['Projects', [7]]],
  );
  assert.deepEqual(
    moveDestinationFolders([
      { path: 'INBOX', unseen: 0 },
      { path: 'Archive', unseen: 0 },
      { path: 'Projects', unseen: 0 },
    ], 'Archive').map((folder) => folder.path),
    ['INBOX', 'Projects'],
  );
});
