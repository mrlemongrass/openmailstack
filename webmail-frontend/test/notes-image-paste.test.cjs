const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

const sourcePath = path.resolve(__dirname, '../src/notes/editor/image-paste.ts');
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

const {
  NOTE_IMAGE_LIMIT_BYTES,
  clipboardHasTextContent,
  clipboardImageFiles,
  noteImageValidationError,
  uploadAndInsertNoteImages,
} = testModule.exports;

const liveEditorSource = fs.readFileSync(
  path.resolve(__dirname, '../src/LiveNoteEditor.tsx'),
  'utf8',
);
const noteModalSource = fs.readFileSync(
  path.resolve(__dirname, '../src/notes/components/NoteEditorModal.tsx'),
  'utf8',
);
const reminderPickerSource = fs.readFileSync(
  path.resolve(__dirname, '../src/notes/components/ReminderPicker.tsx'),
  'utf8',
);
const styles = fs.readFileSync(
  path.resolve(__dirname, '../src/index.css'),
  'utf8',
);

test('clipboard image extraction ignores text and does not duplicate the files fallback', () => {
  const image = { name: 'clipboard.png', type: 'image/png', size: 128 };
  const clipboard = {
    items: [
      { kind: 'string', type: 'text/plain', getAsFile: () => null },
      { kind: 'file', type: 'image/png', getAsFile: () => image },
    ],
    files: [image],
  };

  assert.deepEqual(clipboardImageFiles(clipboard), [image]);
  assert.deepEqual(clipboardImageFiles({
    items: [{ kind: 'string', type: 'text/plain', getAsFile: () => null }],
    files: [],
  }), []);
});

test('clipboard image validation follows the existing upload type and size contract', () => {
  assert.equal(noteImageValidationError({ type: 'image/png', size: NOTE_IMAGE_LIMIT_BYTES }), null);
  assert.equal(
    noteImageValidationError({ type: 'image/tiff', size: 128 }),
    'Paste a PNG, JPEG, GIF, or WebP image.',
  );
  assert.equal(
    noteImageValidationError({ type: 'image/jpeg', size: NOTE_IMAGE_LIMIT_BYTES + 1 }),
    'Pasted images must be 5 MB or smaller.',
  );
});

test('mixed text and image clipboard content stays on the native Quill path', () => {
  assert.equal(clipboardHasTextContent({
    types: ['text/html', 'Files'],
    getData: (type) => type === 'text/html' ? '<p>Caption</p>' : '',
  }), true);
  assert.equal(clipboardHasTextContent({
    types: ['Files'],
    getData: () => '',
  }), false);
  assert.equal(clipboardHasTextContent({
    types: ['Files', 'text/html'],
    getData: (type) => type === 'text/html'
      ? '<html><body><!--StartFragment--><p><img src="data:image/png;base64,fixture"></p><!--EndFragment--></body></html>'
      : '',
  }), false, 'an image-only HTML representation must still use the upload path');
  assert.equal(clipboardHasTextContent({
    types: ['Files', 'text/html'],
    getData: (type) => type === 'text/html'
      ? '<p><img src="data:image/png;base64,fixture">Quarterly chart</p>'
      : '',
  }), true, 'a real caption must stay on the native rich-paste path');
});

test('uploads preserve file order while resolving the insertion point after async work', async () => {
  const files = [{ name: 'first.png' }, { name: 'second.png' }];
  const uploaded = [];
  const inserted = [];
  const selections = [];
  let liveIndex = 3;
  let selectionIndex = 3;
  const controller = new AbortController();

  const result = await uploadAndInsertNoteImages(
    files,
    async (file) => {
      uploaded.push(file.name);
      liveIndex = 8;
      selectionIndex = 10;
      return { url: `/uploads/${file.name}` };
    },
    {
      isCurrent: () => true,
      resolveInsertionIndex: () => liveIndex,
      selectionIndex: () => selectionIndex,
      insertImage: (index, url) => inserted.push([index, url]),
      setSelection: (index) => selections.push(index),
    },
    controller.signal,
  );

  assert.deepEqual(uploaded, ['first.png', 'second.png']);
  assert.deepEqual(inserted, [
    [8, '/uploads/first.png'],
    [9, '/uploads/second.png'],
  ]);
  assert.deepEqual(selections, [], 'an upload must not steal a cursor that moved');
  assert.deepEqual(result, { state: 'complete', inserted: 2, total: 2 });
});

test('partial failure inserts completed uploads and invalidated work inserts nothing', async () => {
  const files = [{ name: 'first.png' }, { name: 'second.png' }];
  const partialInsertions = [];
  const partialSelections = [];
  const controller = new AbortController();
  const partial = await uploadAndInsertNoteImages(
    files,
    async (file) => {
      if (file.name === 'second.png') throw new Error('fixture failure');
      return { url: '/uploads/first.png' };
    },
    {
      isCurrent: () => true,
      resolveInsertionIndex: () => 4,
      selectionIndex: () => 4,
      insertImage: (index, url) => partialInsertions.push([index, url]),
      setSelection: (index) => partialSelections.push(index),
    },
    controller.signal,
  );
  assert.deepEqual(partial, { state: 'partial', inserted: 1, total: 2 });
  assert.deepEqual(partialInsertions, [[4, '/uploads/first.png']]);
  assert.deepEqual(partialSelections, [5]);

  let current = true;
  const invalidatedInsertions = [];
  const invalidated = await uploadAndInsertNoteImages(
    [files[0]],
    async () => {
      current = false;
      return { url: '/uploads/stale.png' };
    },
    {
      isCurrent: () => current,
      resolveInsertionIndex: () => 4,
      selectionIndex: () => 4,
      insertImage: (index, url) => invalidatedInsertions.push([index, url]),
      setSelection: () => {},
    },
    controller.signal,
  );
  assert.deepEqual(invalidated, { state: 'aborted', inserted: 0, total: 1 });
  assert.deepEqual(invalidatedInsertions, []);
});

test('the live editor intercepts image paste before Quill and exposes upload feedback', () => {
  assert.match(liveEditorSource, /clipboardImageFiles\(event\.clipboardData\)/);
  assert.match(liveEditorSource, /clipboardHasTextContent\(event\.clipboardData\)/);
  assert.match(liveEditorSource, /addEventListener\('paste', handlePaste, true\)/);
  assert.match(liveEditorSource, /removeEventListener\('paste', handlePaste, true\)/);
  assert.match(liveEditorSource, /event\.preventDefault\(\)/);
  assert.match(liveEditorSource, /event\.stopImmediatePropagation\(\)/);
  assert.match(liveEditorSource, /Y\.createRelativePositionFromTypeIndex/);
  assert.match(liveEditorSource, /Y\.createAbsolutePositionFromRelativePosition/);
  assert.match(liveEditorSource, /controller\.abort\(\)/);
  assert.match(liveEditorSource, /role=\{imageStatus\.kind === 'error' \? 'alert' : 'status'\}/);
  assert.match(liveEditorSource, /aria-live=\{imageStatus\.kind === 'error' \? undefined : 'polite'\}/);
  assert.match(noteModalSource, /className="note-modal-meta"/);
  assert.match(noteModalSource, /className="note-modal-status-controls"/);
  assert.match(styles, /\.note-modal-header\s*\{\s*flex-wrap:\s*wrap;/);
  assert.match(styles, /\.note-modal-meta\s*\{[^}]*flex:\s*1 0 100%;/s);
  assert.match(styles, /\.note-color-picker\s*\{[^}]*overflow-x:\s*auto;/s);
  assert.doesNotMatch(reminderPickerSource, /position: 'absolute'/);
  assert.match(styles, /\.reminder-popover\s*\{\s*position:\s*fixed;\s*top:\s*110px;\s*right:\s*16px;\s*left:\s*16px;/);
});
