const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const notesGrid = fs.readFileSync(path.join(__dirname, '../src/notes/NotesGrid.tsx'), 'utf8');
const notesSidebar = fs.readFileSync(path.join(__dirname, '../src/notes/NotesSidebar.tsx'), 'utf8');
const styles = fs.readFileSync(path.join(__dirname, '../src/index.css'), 'utf8');

test('Notes exposes permanent deletion honestly and requires confirmation', () => {
  assert.doesNotMatch(notesSidebar, /label:\s*['"]Trash['"]/);
  assert.doesNotMatch(notesSidebar, /label:\s*['"]Locked['"]/);
  assert.doesNotMatch(notesGrid, /moved to trash/i);
  assert.doesNotMatch(notesGrid, />\s*Locked Note\s*</);
  assert.match(notesGrid, />\s*Preview hidden\s*</);
  assert.match(notesGrid, /title="Delete note permanently\?"/);
  assert.match(notesGrid, /attachments, and its reminder/);
  assert.match(notesGrid, /confirmLabel="Delete permanently"/);
  assert.match(styles, /\.contact-card:focus-within\s+\.note-card-actions/);
});
