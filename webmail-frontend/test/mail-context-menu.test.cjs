const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const source = relativePath => fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');

function loadTypeScriptModule(relativePath) {
  const sourcePath = path.resolve(__dirname, relativePath);
  const compiled = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
    fileName: sourcePath,
  }).outputText;
  const loaded = new Module(sourcePath, module);
  loaded.paths = module.paths;
  loaded._compile(compiled, sourcePath);
  return loaded.exports;
}

test('context menu positioning remains inside the visible viewport', () => {
  const { clampContextMenuPosition } = loadTypeScriptModule('../src/shared/context-menu-navigation.ts');

  assert.deepEqual(
    clampContextMenuPosition({ x: 980, y: 760 }, { width: 220, height: 260 }, { width: 1000, height: 800 }),
    { left: 772, top: 532 },
  );
  assert.deepEqual(
    clampContextMenuPosition({ x: -20, y: -10 }, { width: 220, height: 260 }, { width: 1000, height: 800 }),
    { left: 8, top: 8 },
  );
});

test('context menu arrow navigation skips disabled commands and wraps', () => {
  const {
    contextMenuOwnsScrollTarget,
    nextEnabledMenuIndex,
  } = loadTypeScriptModule('../src/shared/context-menu-navigation.ts');
  const disabled = [false, true, false, true];
  const ownedTarget = {};
  const menu = { contains: target => target === ownedTarget };

  assert.equal(nextEnabledMenuIndex(disabled, 0, 1), 2);
  assert.equal(nextEnabledMenuIndex(disabled, 2, 1), 0);
  assert.equal(nextEnabledMenuIndex(disabled, 0, -1), 2);
  assert.equal(nextEnabledMenuIndex([true, true], 0, 1), -1);
  assert.equal(contextMenuOwnsScrollTarget(menu, ownedTarget), true);
  assert.equal(contextMenuOwnsScrollTarget(menu, {}), false);
});

test('folder tree safely preserves mailbox names that match object prototype keys', () => {
  const { buildFolderTree } = loadTypeScriptModule('../src/mail/mail-folder-tree.ts');
  const tree = buildFolderTree([
    { path: '__proto__', delimiter: '/', unseen: 1 },
    { path: 'constructor', delimiter: '/', unseen: 2 },
    { path: '__proto__/Child', delimiter: '/', unseen: 3 },
  ]);

  assert.deepEqual(tree.map(node => node.fullPath).sort(), ['__proto__', 'constructor']);
  const prototypeFolder = tree.find(node => node.fullPath === '__proto__');
  assert.equal(prototypeFolder.unseen, 1);
  assert.equal(prototypeFolder.children.Child.fullPath, '__proto__/Child');
  assert.equal(Object.getPrototypeOf(prototypeFolder.children), null);
});

test('folder tree preserves an authoritative empty delimiter for flat namespaces', () => {
  const { buildFolderTree } = loadTypeScriptModule('../src/mail/mail-folder-tree.ts');
  const tree = buildFolderTree([
    { path: 'Projects.Travel', delimiter: '', unseen: 4 },
  ]);

  assert.equal(tree.length, 1);
  assert.equal(tree[0].fullPath, 'Projects.Travel');
  assert.equal(tree[0].name, 'Projects.Travel');
  assert.equal(tree[0].delimiter, '');
  assert.deepEqual(Object.keys(tree[0].children), []);
});

test('folder subtree state follows a rename without touching similarly prefixed siblings', () => {
  const {
    reconcileFavoriteFolderReferences,
    removeFavoriteFolderReferences,
    removeFavoriteFolderSubtree,
    remapExpandedFolderPaths,
    remapFavoriteFolderReferences,
    remapFavoriteFolderPaths,
    remapFolderSubtreePath,
  } = loadTypeScriptModule('../src/mail/folder-mutation-state.ts');

  assert.equal(
    remapFolderSubtreePath('INBOX/Receipts/2025', 'INBOX/Receipts', 'INBOX/Statements', '/'),
    'INBOX/Statements/2025',
  );
  assert.equal(
    remapFolderSubtreePath('INBOX/Receipts-old', 'INBOX/Receipts', 'INBOX/Statements', '/'),
    'INBOX/Receipts-old',
  );
  assert.equal(
    remapFolderSubtreePath('Trash.Project.Child', 'Trash.Project', 'Projects/Project', '.', '/'),
    'Projects/Project/Child',
  );
  assert.deepEqual(
    remapExpandedFolderPaths({
      INBOX: true,
      'INBOX/Receipts': true,
      'INBOX/Receipts/2025': false,
    }, 'INBOX/Receipts', 'INBOX/Statements', '/'),
    {
      INBOX: true,
      'INBOX/Statements': true,
      'INBOX/Statements/2025': false,
    },
  );
  assert.deepEqual(
    remapFavoriteFolderPaths(
      ['INBOX', 'INBOX/Receipts', 'INBOX/Receipts/2025', 'INBOX/Statements'],
      'INBOX/Receipts',
      'INBOX/Statements',
      '/',
    ),
    ['INBOX', 'INBOX/Statements', 'INBOX/Statements/2025'],
  );
  assert.deepEqual(
    remapFavoriteFolderPaths(
      ['Trash.Project', 'Trash.Project.Child'],
      'Trash.Project',
      'Projects/Project',
      '.',
      '/',
    ),
    ['Projects/Project', 'Projects/Project/Child'],
  );
  assert.deepEqual(
    removeFavoriteFolderSubtree(
      ['INBOX', 'INBOX/Receipts', 'INBOX/Receipts/2025', 'INBOX/Receipts-old'],
      'INBOX/Receipts',
      '/',
    ),
    ['INBOX', 'INBOX/Receipts-old'],
  );
  assert.deepEqual(
    remapFavoriteFolderReferences(
      {
        paths: ['Trash.Project', 'Trash.Project.Child', 'Projects/Project', 'INBOX'],
        uidValidities: {
          'Trash.Project': '101',
          'Trash.Project.Child': '102',
          'Projects/Project': '999',
          INBOX: '103',
        },
      },
      'Trash.Project',
      'Projects/Project',
      '.',
      '/',
    ),
    {
      paths: ['Projects/Project', 'Projects/Project/Child', 'INBOX'],
      uidValidities: {
        'Projects/Project': '101',
        'Projects/Project/Child': '102',
        INBOX: '103',
      },
    },
  );
  assert.deepEqual(
    removeFavoriteFolderReferences(
      {
        paths: ['INBOX', 'INBOX/Receipts', 'INBOX/Receipts/2025'],
        uidValidities: { INBOX: '100', 'INBOX/Receipts': '101', 'INBOX/Receipts/2025': '102' },
      },
      'INBOX/Receipts',
      '/',
    ),
    { paths: ['INBOX'], uidValidities: { INBOX: '100' } },
  );

  assert.deepEqual(
    reconcileFavoriteFolderReferences(
      {
        paths: ['Old name', 'INBOX', 'Missing legacy'],
        uidValidities: { 'Old name': '200', Ghost: '999' },
      },
      [
        { path: 'New name', uidValidity: '200' },
        { path: 'INBOX', uidValidity: '100' },
        { path: 'Container', uidValidity: '300', disabled: true },
      ],
    ),
    {
      references: {
        paths: ['Old name', 'INBOX', 'Missing legacy'],
        uidValidities: { 'Old name': '200', INBOX: '100' },
      },
      visiblePaths: ['INBOX'],
      renameCandidates: [{ fromPath: 'Old name', toPath: 'New name', uidValidity: '200' }],
      unresolvedPaths: ['Missing legacy'],
      unresolvedCount: 1,
      changed: true,
    },
  );
  assert.deepEqual(
    reconcileFavoriteFolderReferences(
      { paths: ['Old name'], uidValidities: { 'Old name': '200' } },
      [
        { path: 'Possible A', uidValidity: '200' },
        { path: 'Possible B', uidValidity: '200' },
      ],
    ),
    {
      references: { paths: ['Old name'], uidValidities: { 'Old name': '200' } },
      visiblePaths: [],
      renameCandidates: [],
      unresolvedPaths: ['Old name'],
      unresolvedCount: 1,
      changed: false,
    },
  );
  assert.deepEqual(
    reconcileFavoriteFolderReferences(
      { paths: ['__proto__'], uidValidities: {} },
      [{ path: '__proto__', uidValidity: '400' }],
    ),
    {
      references: {
        paths: ['__proto__'],
        uidValidities: Object.fromEntries([['__proto__', '400']]),
      },
      visiblePaths: ['__proto__'],
      renameCandidates: [],
      unresolvedPaths: [],
      unresolvedCount: 0,
      changed: true,
    },
  );

  assert.deepEqual(
    reconcileFavoriteFolderReferences(
      { paths: ['Old name'], uidValidities: { 'Old name': '200' } },
      [
        { path: 'Old name', uidValidity: '300' },
        { path: 'New name', uidValidity: '200' },
      ],
    ),
    {
      references: { paths: ['Old name'], uidValidities: { 'Old name': '200' } },
      visiblePaths: [],
      renameCandidates: [{ fromPath: 'Old name', toPath: 'New name', uidValidity: '200' }],
      unresolvedPaths: [],
      unresolvedCount: 0,
      changed: false,
    },
  );
});

test('the shared context menu exposes desktop and keyboard menu semantics', () => {
  const menu = source('src/shared/components/ContextMenu.tsx');
  const confirmation = source('src/shared/components/ConfirmDialog.tsx');
  const styles = source('src/index.css');

  assert.match(menu, /createPortal/);
  assert.match(menu, /role="menu"/);
  assert.match(menu, /role="menuitem"/);
  assert.match(menu, /ArrowDown/);
  assert.match(menu, /ArrowUp/);
  assert.match(menu, /event\.key === 'Escape'/);
  assert.match(menu, /addEventListener\('scroll'/);
  assert.match(styles, /\.context-menu\s*\{[^}]*max-height:\s*calc\(100vh - 16px\)/s);
  assert.match(styles, /\.context-menu\s*\{[^}]*overflow-y:\s*auto/s);
  assert.match(styles, /@media \(hover: none\)[\s\S]*\.folder-nav-row \.folder-row-actions[\s\S]*opacity:\s*1/);
  assert.match(styles, /\.mail-folder-dialog\s*\{[^}]*max-height:\s*calc\(100vh - 40px\)/s);
  assert.match(styles, /\.mail-folder-dialog\s*\{[^}]*overflow-y:\s*auto/s);
  assert.match(confirmation, /createPortal/);
  assert.match(confirmation, /document\.body/);
});

test('folders expose top-level creation and guarded lifecycle actions from the same accessible menu', () => {
  const sidebar = source('src/mail/FolderSidebar.tsx');
  const dialogs = source('src/mail/components/FolderDialogs.tsx');

  assert.match(sidebar, /onContextMenu=/);
  assert.match(sidebar, /event\.shiftKey && event\.key === 'F10'/);
  assert.match(sidebar, /event\.key === 'ContextMenu'/);
  assert.match(sidebar, /aria-haspopup="menu"/);
  assert.match(sidebar, /New folder/);
  assert.match(sidebar, /New subfolder/);
  assert.match(sidebar, /Rename…/);
  assert.match(sidebar, /Move/);
  assert.match(sidebar, /Delete/);
  assert.match(sidebar, /ConfirmDialog/);
  assert.match(sidebar, /isProtectedFolder/);
  assert.match(sidebar, /RenameFolderDialog/);
  assert.match(sidebar, /onRenameFolder/);
  assert.match(sidebar, /role="status"/);
  assert.match(sidebar, /Marking .* as read/);
  assert.match(sidebar, /Folder change in progress/);
  assert.doesNotMatch(sidebar, /Updating Favorites|Updating folder shortcuts/);
  assert.match(sidebar, /className="folder-row-pending" aria-hidden="true"/);
  assert.match(sidebar, /onFolderDialogChange/);
  assert.match(dialogs, /role="dialog"/);
  assert.match(dialogs, /aria-modal="true"/);
  assert.match(dialogs, /Folder name/);
  assert.match(dialogs, /Rename folder/);
  assert.match(dialogs, /Top level/);
});

test('message toolbar distinguishes a global mark-all-read lock from current-folder progress', () => {
  const list = source('src/mail/MessageList.tsx');
  const toolbar = source('src/mail/MailToolbar.tsx');

  assert.match(list, /markAllReadPending=\{mail\.markingReadFolder === decodedFolder\}/);
  assert.match(list, /markAllReadDisabled=\{Boolean\(mail\.markingReadFolder\)\}/);
  assert.match(toolbar, /markAllReadDisabled/);
  assert.match(toolbar, /Another folder is being marked as read/);
});

test('mobile folder drawer suspends for nested dialogs and uses defined visual tokens', () => {
  const layout = source('src/mail/MailLayout.tsx');
  const styles = source('src/index.css');

  assert.match(layout, /active: open && !folderDialogOpen/);
  assert.match(layout, /hidden=\{folderDialogOpen\}/);
  assert.match(layout, /onFolderDialogChange=\{setFolderDialogOpen\}/);
  assert.match(styles, /\.mobile-mail-folder-overlay\[hidden\][\s\S]*display:\s*none/);
  assert.doesNotMatch(styles, /var\(--(?:bg-elevated|shadow-lg|radius-xl)\)/);
});

test('message rows expose a context menu without replacing their normal open behavior', () => {
  const row = source('src/mail/MessageRow.tsx');
  const list = source('src/mail/MessageList.tsx');
  const viewer = source('src/mail/MessageViewer.tsx');
  const hook = source('src/mail/hooks/useMail.ts');
  const composeActions = source('src/mail/message-compose-actions.ts');

  assert.match(row, /onContextMenu=/);
  assert.match(row, /event\.shiftKey && event\.key === 'F10'/);
  assert.match(row, /event\.key === 'ContextMenu'/);
  assert.match(row, /onClick\(message\.uid\)/);
  assert.match(list, /<ContextMenu/);
  assert.match(list, /id: 'reply'/);
  assert.match(list, /id: 'reply-all'/);
  assert.match(list, /id: 'forward'/);
  assert.match(composeActions, /buildMessageComposeDraft/);
  assert.match(hook, /fetchMessageBody/);
  assert.match(list, /mail\.prepareMessageCompose\(action, message, folderPath\)/);
  assert.match(viewer, /prepareMessageCompose[\s\S]*prepareMessageCompose\(action, message, sourceFolder, body\)/);
  assert.match(list, /Preparing \{messageComposeActionLabel\(preparingComposeAction\)\}/);
  assert.match(hook, /const prepareMessageCompose = useCallback[\s\S]*composePreparationCoordinatorRef\.current\.begin\(\)/);
  assert.match(hook, /prepareMessageComposeAction\(\{/);
  assert.match(hook, /hydrateForwardContent\(summaryMessage, sourceFolder, fetch, preparationSignal\)/);
  assert.match(hook, /setComposeAttachments\(initial\.attachments \|\| \[\]\)/);
  assert.match(hook, /composePreparationErrorToast/);
  assert.match(hook, /attachments-count-exceeded[\s\S]*too many attachments[\s\S]*smaller selection/);
  assert.match(hook, /attachments-size-exceeded[\s\S]*forwarding limit[\s\S]*smaller selection/);
  assert.match(hook, /message-size-exceeded[\s\S]*too large to prepare for forwarding/);
  assert.match(list, /typeof result === 'object'[\s\S]*showToast\(\{ type: 'error', \.\.\.result \}\)/);
  assert.match(viewer, /typeof result === 'object'[\s\S]*showToast\(\{ type: 'error', \.\.\.result \}\)/);
  assert.match(viewer, /role="status"[\s\S]*Preparing \{messageComposeActionLabel\(preparingComposeAction\)\}/);
  assert.match(hook, /const claimComposeIntent = useCallback[\s\S]*isComposingRef\.current = true/);
  assert.match(list, /Mark (?:as )?unread|Mark (?:as )?read/);
  assert.match(list, /message\.isStarred \? 'Unflag' : 'Flag'/);
  assert.match(list, /Archive/);
  assert.match(list, /Move to…/);
  assert.match(list, /Mark as spam/);
  assert.match(list, /messageAction\('move'/);
  assert.match(list, /messageAction\('spam'/);
  assert.match(list, /Snooze until tomorrow/);
  assert.match(list, /Delete/);
  assert.match(list, /flaggedMessageUids\.has\(uid\)/);
});

test('rendered message rows expose sibling controls instead of nesting them in the open control', () => {
  const { MessageRow } = loadTypeScriptModule('../src/mail/MessageRow.tsx');
  const noop = () => undefined;
  const markup = renderToStaticMarkup(React.createElement(MessageRow, {
    message: {
      uid: 42,
      from: 'Alice <alice@example.test>',
      subject: 'Quarterly plan',
      date: '2026-08-22T12:00:00Z',
      isRead: false,
      isStarred: false,
      hasAttachments: false,
    },
    isSelected: false,
    isThreaded: false,
    density: 'cozy',
    onSelect: noop,
    onClick: noop,
    onStar: noop,
    onArchive: noop,
    onDelete: noop,
    onMarkRead: noop,
    onSnooze: noop,
    onOpenContextMenu: noop,
  }));

  const groupTag = markup.slice(0, markup.indexOf('>') + 1);
  assert.match(groupTag, /role="group"/);
  assert.doesNotMatch(groupTag, /tabindex=/);
  assert.doesNotMatch(markup, /role="link"/);

  const openClass = markup.indexOf('class="message-row-open"');
  const openStart = markup.lastIndexOf('<button', openClass);
  const openTagEnd = markup.indexOf('>', openClass);
  const openEnd = markup.indexOf('</button>', openTagEnd);
  assert.ok(openStart >= 0 && openTagEnd > openStart && openEnd > openTagEnd);
  const openTag = markup.slice(openStart, openTagEnd + 1);
  const openChildren = markup.slice(openTagEnd + 1, openEnd);
  assert.match(openTag, /aria-label="Open message Quarterly plan"/);
  assert.match(openTag, /aria-keyshortcuts="Shift\+F10"/);
  assert.doesNotMatch(openChildren, /<(?:button|input|a\s[^>]*href=)/);
  assert.match(markup, /aria-label="Flag message"/);
});

test('folder lifecycle actions use the authenticated API and refresh the tree', () => {
  const api = source('src/shared/api.ts');
  const hook = source('src/mail/hooks/useMail.ts');
  const routes = source('src/mail/routes.tsx');
  const sidebar = source('src/mail/FolderSidebar.tsx');

  assert.match(api, /fetch\('\/api\/folders',\s*\{[\s\S]*method:\s*'POST'/);
  assert.match(api, /JSON\.stringify\(\{ parent, name \}\)/);
  assert.match(api, /method:\s*'PATCH'/);
  assert.match(api, /JSON\.stringify\(\{ path, parent, sourceUidValidity, parentUidValidity \}\)/);
  assert.match(api, /JSON\.stringify\(\{ path, name, sourceUidValidity \}\)/);
  assert.match(api, /method:\s*'DELETE'/);
  assert.match(api, /JSON\.stringify\(\{ path \}\)/);
  assert.match(api, /'\/api\/folders\/mark-read'/);
  assert.match(hook, /api\.createFolder\(parent, name\)/);
  assert.match(hook, /api\.moveFolder\([\s\S]*sourceFolder\.uidValidity/);
  assert.match(hook, /api\.renameFolder\(path, name, sourceFolder\.uidValidity/);
  assert.match(hook, /api\.deleteFolder\(path, permanent, sourceFolder\.uidValidity/);
  assert.match(hook, /result\.disposition === 'trashed'/);
  assert.match(hook, /path: result\.folder\.path,[\s\S]*delimiter: typeof result\.folder\.delimiter/);
  assert.match(sidebar, /const destinationDelimiter = typeof result\.delimiter/);
  assert.match(hook, /remapExpandedFolderPaths/);
  assert.match(hook, /remapFavoriteFolderReferences/);
  assert.match(hook, /removeFavoriteFolderReferences/);
  assert.match(hook, /api\.markFolderRead\(path\)/);
  assert.match(hook, /refreshAfterFolderMarkReadRef\.current\(result\.path\)/);
  assert.match(hook, /setSelectedMessages/);
  assert.doesNotMatch(hook, /reconcileFolderMarkReadState|result\.maxUid/);
  assert.match(hook, /persistFavoriteFolders/);
  assert.match(hook, /reconcileFavoriteFolderReferences/);
  assert.match(hook, /favoriteUidValidities/);
  assert.match(hook, /folderRequestIdRef/);
  assert.match(hook, /folderListReady/);
  assert.match(hook, /setFolderListReady\(true\)/);
  assert.match(hook, /folderListReady\s*\?\s*favoriteReconciliation\.unresolvedPaths/);
  assert.match(hook, /requestId !== folderRequestIdRef\.current/);
  assert.match(hook, /FAVORITES_NOT_RECONCILED/);
  assert.match(hook, /confirmFavoriteRename/);
  assert.match(hook, /removeUnavailableFavorite/);
  assert.match(hook, /retryFavoritePersistence/);
  assert.doesNotMatch(hook, /onMailSettingsChange/);
  assert.match(routes, /saveMailFavoriteSettings/);
  assert.match(sidebar, /Update Favorite/);
  assert.match(sidebar, /Remove Favorite/);
  assert.match(sidebar, /unavailable/);
  assert.match(sidebar, /Not now/);
  assert.match(sidebar, /!favoritePersistencePending[\s\S]*favoriteRenameCandidates\.slice/);
  assert.match(api, /JSON\.stringify\(\{ path, permanent, sourceUidValidity \}\)/);
  assert.match(hook, /case 'move': return 'Message moved\.'/);
  assert.match(hook, /await fetchFolders\(\)/);
});

test('folder-wide mark as read client sends only the selected folder path', async t => {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, init) => {
    calls.push({ url, init });
    return {
      ok: true,
      async json() {
        return { success: true, path: 'INBOX/Receipts', marked: 38, maxUid: 502 };
      },
    };
  };
  t.after(() => { global.fetch = originalFetch; });
  const { markFolderRead } = loadTypeScriptModule('../src/shared/api.ts');

  assert.deepEqual(await markFolderRead('INBOX/Receipts'), {
    path: 'INBOX/Receipts',
    marked: 38,
    maxUid: 502,
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, '/api/folders/mark-read');
  assert.equal(calls[0].init.method, 'POST');
  assert.deepEqual(JSON.parse(calls[0].init.body), { path: 'INBOX/Receipts' });
});

test('folder deletion binds recoverable versus permanent intent to the authenticated request', async t => {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, init) => {
    calls.push({ url, init });
    const body = JSON.parse(init.body);
    return {
      ok: true,
      async json() {
        return body.permanent
          ? {
              success: true,
              disposition: 'deleted',
              deletedPath: body.path,
              warnings: ['SEARCH_INDEX_RESET_FAILED', 'UNKNOWN_PRIVATE_WARNING'],
            }
          : {
              success: true,
              disposition: 'trashed',
              previousPath: body.path,
              folder: { path: 'Trash/Projects', delimiter: '/', unseen: 0 },
              warnings: ['SUBSCRIPTIONS_NOT_RECONCILED'],
            };
      },
    };
  };
  t.after(() => { global.fetch = originalFetch; });
  const { deleteFolder } = loadTypeScriptModule('../src/shared/api.ts');

  assert.deepEqual(await deleteFolder('Projects', false), {
    disposition: 'trashed',
    previousPath: 'Projects',
    folder: { path: 'Trash/Projects', delimiter: '/', unseen: 0 },
    warnings: ['SUBSCRIPTIONS_NOT_RECONCILED'],
  });
  assert.deepEqual(await deleteFolder('Trash/Old', true), {
    disposition: 'deleted',
    deletedPath: 'Trash/Old',
    warnings: ['SEARCH_INDEX_RESET_FAILED'],
  });
  assert.deepEqual(calls.map(call => ({
    url: call.url,
    method: call.init.method,
    body: JSON.parse(call.init.body),
  })), [
    { url: '/api/folders', method: 'DELETE', body: { path: 'Projects', permanent: false } },
    { url: '/api/folders', method: 'DELETE', body: { path: 'Trash/Old', permanent: true } },
  ]);
});

test('search cleanup retry purges the authenticated search index', async t => {
  const originalFetch = global.fetch;
  const calls = [];
  global.fetch = async (url, init) => {
    calls.push({ url, init });
    return {
      ok: calls.length === 1,
      async json() {
        return calls.length === 1
          ? { success: true, deletedCount: 4 }
          : { success: false, error: 'private search database detail' };
      },
    };
  };
  t.after(() => { global.fetch = originalFetch; });
  const { purgeSearchIndex } = loadTypeScriptModule('../src/shared/api.ts');

  await purgeSearchIndex();
  await assert.rejects(
    () => purgeSearchIndex(),
    error => error.message === 'Search cleanup could not be completed.'
      && !/private search database detail/i.test(error.message),
  );

  assert.deepEqual(calls, [
    { url: '/api/messages/search/index', init: { method: 'DELETE' } },
    { url: '/api/messages/search/index', init: { method: 'DELETE' } },
  ]);
});

test('folder-wide mark as read refreshes the current authoritative view instead of projecting UID ranges', () => {
  const hook = source('src/mail/hooks/useMail.ts');

  assert.match(hook, /if \(isSearchActive\)[\s\S]*return doSearch\(searchQuery, searchScope, searchField\)/);
  assert.match(hook, /mailboxPathsEqual\(activeFolder, path\)[\s\S]*setSelectedMessages\(\[\]\)[\s\S]*return fetchMessages\('reset'\)/);
  assert.match(hook, /const foldersRefreshed = await fetchFolders\(\)/);
  assert.match(hook, /if \(!foldersRefreshed \|\| !viewRefreshed\)/);
  assert.match(hook, /Messages were marked as read, but Mail could not refresh/);
  assert.doesNotMatch(hook, /message\.uid <= result\.maxUid|message\.uid > result\.maxUid/);
});

test('mail refresh retry preserves an active search view', () => {
  const list = source('src/mail/MessageList.tsx');

  assert.match(
    list,
    /if \(isSearchActive\)[\s\S]*mail\.doSearch\(mail\.searchQuery, mail\.searchScope, mail\.searchField\)[\s\S]*else[\s\S]*fetchMessages\(\)/,
  );
});
