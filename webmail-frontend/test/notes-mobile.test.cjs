const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const notesLayoutSource = fs.readFileSync(
  path.join(__dirname, '../src/notes/NotesLayout.tsx'),
  'utf8',
);
const notesGridSource = fs.readFileSync(
  path.join(__dirname, '../src/notes/NotesGrid.tsx'),
  'utf8',
);
const liveEditorSource = fs.readFileSync(
  path.join(__dirname, '../src/LiveNoteEditor.tsx'),
  'utf8',
);

test('populated mobile notes expose creation without rendering numeric false flags', () => {
  assert.match(
    notesLayoutSource,
    /<NotesGrid notesCtx=\{notesCtx\} isMobile \/>/,
    'the mobile route should identify itself to the notes grid',
  );
  assert.match(
    notesGridSource,
    /isMobile &&[\s\S]*New Note/,
    'the populated mobile grid should expose New Note',
  );
  assert.match(notesGridSource, /const isPinned = Boolean\(note\.is_pinned\);/);
  assert.match(notesGridSource, /const isLocked = Boolean\(note\.is_locked\);/);
  assert.doesNotMatch(notesGridSource, /\{note\.is_(?:pinned|locked) &&/);
});

test('notes do not contact public collaboration signaling by default', () => {
  assert.doesNotMatch(liveEditorSource, /signaling\.yjs\.dev|herokuapp\.com/);
  assert.match(liveEditorSource, /VITE_OMS_NOTES_SIGNALING_URLS/);
  assert.match(liveEditorSource, /signalingUrls\.length > 0[\s\S]*new WebrtcProvider/);
  assert.match(liveEditorSource, /provider\?\.awareness/);
  assert.match(liveEditorSource, /provider\?\.destroy\(\)/);
});
