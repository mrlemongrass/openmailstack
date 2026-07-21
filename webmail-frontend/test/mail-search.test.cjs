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
    return Module.prototype.require.call(toolbarModule, id);
  };
  toolbarModule._compile(compiled, sourcePath);

  const markup = renderToStaticMarkup(React.createElement(toolbarModule.exports.MailToolbar, {
    selectedCount: 0,
    totalCount: 1,
    searchQuery: '',
    searchField: 'all',
    searchScope: 'folder',
    isSearchActive: true,
    selectionDisabled: false,
    activeFolder: 'Projects',
    onSearchChange: () => undefined,
    onSearchFieldChange: () => undefined,
    onSearchScopeChange: () => undefined,
    onClearSearch: () => undefined,
    onSelectAll: () => undefined,
    onBulkAction: () => undefined,
  }));

  assert.match(markup, /aria-label="Search field"/);
  assert.match(markup, /<option value="attachments">Attachments<\/option>/);
  assert.match(markup, /aria-label="Search scope"/);
  assert.match(markup, /<option value="folder" selected="">Current folder<\/option>/);
  assert.match(markup, /<option value="all">All mail<\/option>/);
  assert.match(markup, /in Projects/);
  assert.match(markup, /aria-label="Clear search"/);
});

test('mail search identities remain distinct when folders reuse the same UID', () => {
  const { messageIdentityKey, groupMessagesByFolder } = loadTypeScriptModule('../src/mail/mail-message-identity.ts');
  const messages = [
    { folder: 'INBOX', uid: 42 },
    { folder: 'Archive', uid: 42 },
    { uid: 7 },
  ];

  assert.notEqual(messageIdentityKey(messages[0], 'INBOX'), messageIdentityKey(messages[1], 'INBOX'));
  assert.deepEqual(
    [...groupMessagesByFolder(messages, 'Projects')],
    [['INBOX', [42]], ['Archive', [42]], ['Projects', [7]]],
  );
});
