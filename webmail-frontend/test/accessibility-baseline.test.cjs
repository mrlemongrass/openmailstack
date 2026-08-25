const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const source = relativePath => fs.readFileSync(path.resolve(__dirname, '..', relativePath), 'utf8');

test('desktop shell and icon-only mail/calendar controls have accessible names', () => {
  const appShell = source('src/shared/layouts/AppShell.tsx');
  const messageViewer = source('src/mail/MessageViewer.tsx');
  const calendarToolbar = source('src/calendar/CalendarToolbar.tsx');

  assert.match(appShell, /to="\/settings" aria-label="Settings"/);
  assert.match(appShell, /to="\/admin" aria-label="Admin"/);
  assert.match(messageViewer, /aria-label=\{message\.isStarred \? 'Remove star' : 'Star message'\}/);
  assert.match(messageViewer, /aria-label="Archive message"/);
  assert.match(messageViewer, /aria-label="Delete message"/);
  assert.match(calendarToolbar, /aria-label=\{`Previous \$\{cal\.calendarView\}`\}/);
  assert.match(calendarToolbar, /aria-label=\{`Next \$\{cal\.calendarView\}`\}/);
});

test('contact and note cards expose keyboard-operable open actions', () => {
  const contacts = source('src/contacts/ContactGrid.tsx');
  const notes = source('src/notes/NotesGrid.tsx');

  assert.match(contacts, /role="button"[\s\S]*tabIndex=\{0\}[\s\S]*aria-label=\{`Open contact/);
  assert.match(contacts, /event\.key === 'Enter' \|\| event\.key === ' '/);
  assert.match(notes, /role="button"[\s\S]*tabIndex=\{0\}[\s\S]*aria-label=\{`Open note/);
  assert.match(notes, /event\.key === 'Enter' \|\| event\.key === ' '/);
});

test('the Notes editor is a focus-managed named modal', () => {
  const modal = source('src/notes/components/NoteEditorModal.tsx');

  assert.match(modal, /useModalFocus\(\{[\s\S]*dialogRef,[\s\S]*open: n\.isNoteModalOpen,[\s\S]*onClose: handleClose/);
  assert.match(modal, /role="dialog"/);
  assert.match(modal, /aria-modal="true"/);
  assert.match(modal, /aria-label=\{note\.id \? `Edit note/);
  assert.match(modal, /aria-label="Close note editor"/);
});

test('mobile Mail exposes a focus-managed touch folder drawer', () => {
  const layout = source('src/mail/MailLayout.tsx');

  assert.match(layout, /aria-label="Open folders"/);
  assert.match(layout, /role="dialog"/);
  assert.match(layout, /aria-label="Mail folders"/);
  assert.match(layout, /active: open && !folderDialogOpen/);
  assert.match(layout, /onFolderNavigate=\{closeDrawer\}/);
  assert.match(layout, /onFolderDialogChange=\{setFolderDialogOpen\}/);
});
