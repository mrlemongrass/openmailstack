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
    remapExpandedFolderPaths,
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
  assert.match(dialogs, /role="dialog"/);
  assert.match(dialogs, /aria-modal="true"/);
  assert.match(dialogs, /Folder name/);
  assert.match(dialogs, /Rename folder/);
  assert.match(dialogs, /Top level/);
});

test('message rows expose a context menu without replacing their normal open behavior', () => {
  const row = source('src/mail/MessageRow.tsx');
  const list = source('src/mail/MessageList.tsx');

  assert.match(row, /onContextMenu=/);
  assert.match(row, /event\.shiftKey && event\.key === 'F10'/);
  assert.match(row, /event\.key === 'ContextMenu'/);
  assert.match(row, /onClick\(message\.uid\)/);
  assert.match(list, /<ContextMenu/);
  assert.match(list, /Mark (?:as )?unread|Mark (?:as )?read/);
  assert.match(list, /Archive/);
  assert.match(list, /Move to…/);
  assert.match(list, /Mark as spam/);
  assert.match(list, /messageAction\('move'/);
  assert.match(list, /messageAction\('spam'/);
  assert.match(list, /Snooze until tomorrow/);
  assert.match(list, /Delete/);
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
});

test('folder lifecycle actions use the authenticated API and refresh the tree', () => {
  const api = source('src/shared/api.ts');
  const hook = source('src/mail/hooks/useMail.ts');

  assert.match(api, /fetch\('\/api\/folders',\s*\{[\s\S]*method:\s*'POST'/);
  assert.match(api, /JSON\.stringify\(\{ parent, name \}\)/);
  assert.match(api, /method:\s*'PATCH'/);
  assert.match(api, /JSON\.stringify\(\{ path, parent \}\)/);
  assert.match(api, /JSON\.stringify\(\{ path, name \}\)/);
  assert.match(api, /method:\s*'DELETE'/);
  assert.match(api, /JSON\.stringify\(\{ path \}\)/);
  assert.match(hook, /api\.createFolder\(parent, name\)/);
  assert.match(hook, /api\.moveFolder\(path, parent\)/);
  assert.match(hook, /api\.renameFolder\(path, name\)/);
  assert.match(hook, /api\.deleteFolder\(path\)/);
  assert.match(hook, /case 'move': return 'Message moved\.'/);
  assert.match(hook, /await fetchFolders\(\)/);
});
