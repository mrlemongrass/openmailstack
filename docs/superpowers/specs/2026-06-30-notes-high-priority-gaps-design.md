# Notes App — High Priority Gaps Design

**Date:** 2026-06-30
**Scope:** Features #1–9 from the notes gap analysis
**Sequence:** Group A (Editor) → Group B (Organization) → Group C (Data Features)

---

## Current Architecture

- **Frontend:** React + ReactQuill (bubble theme) with Yjs/WebRTC collaborative editing
- **Backend:** Express (TypeScript, compiled to JS), MySQL, IMAP sync for Apple Notes
- **Note schema:** `notes(id, owner, title, content, color, is_pinned, is_locked, folder, labels_json, sync_token, imap_sync_token, is_deleted, created_at, updated_at)`
- **API:** `GET/POST /api/notes`, `PUT/DELETE /api/notes/:id`
- **UI:** `NotesLayout` (resizable sidebar+grid), `NotesSidebar` (filters, labels), `NotesGrid` (search bar, card grid), `LiveNoteEditor` (Quill+Yjs)
- **Gap:** `isNoteModalOpen`/`editingNote` state exists in `useNotes` hook but no modal component consumes it

---

## Group A — Editor Enhancements

### A1. Checklists

**Approach:** Custom Quill blot extending list format.

- Register a `checklist-item` blot that renders as `<li data-checked="true|false"><span class="checklist-checkbox">✓</span>content</li>`
- Click handler on the checkbox span toggles `data-checked` attribute
- Toolbar: `[{ 'list': 'checklist' }]` button between ordered list and bullet list
- CSS: `li[data-checked="true"] { text-decoration: line-through; opacity: 0.7; }`
- Stored inline in HTML content — no schema changes, survives Yjs sync

### A2. Image Paste & Display

**Approach:** Quill image upload handler + server endpoint.

- **Frontend:** Configure ReactQuill's `modules.toolbar.handlers.image` to open file picker, then POST blob to `/api/notes/upload`, insert returned URL
- Handle clipboard paste: intercept `paste` event on the editor container, extract image blobs, upload, insert
- **Backend:** `POST /api/notes/upload` — multipart, stores to `webmail-backend/uploads/notes/<user>/<uuid>.<ext>`, returns `{ url: "/uploads/notes/<user>/<uuid>.<ext>" }`
- Serve static files from uploads directory
- Max 5MB per image, accept image/png, image/jpeg, image/gif, image/webp

### A3. Table Support

**Approach:** HTML table insertion via toolbar button.

- **Primary plan:** Add a toolbar button that inserts a basic `<table>` structure (3x3 grid) using Quill's `clipboard.dangerouslyPasteHTML` or `insertEmbed`
- Provide a small popover to choose rows/cols before insertion
- Quill handles the HTML as rich text — survives Yjs sync naturally
- **Fallback if needed:** Evaluate `quill-better-table` package; only adopt if Yjs compatibility is confirmed
- No backend changes

### A4. Code Blocks

**Approach:** Custom code-block format + highlight.js.

- Register a `code-block` blot in Quill that renders `<pre><code>content</code></pre>`
- Toolbar: code button (`</>` icon) — applies code-block format to selection or new block
- `highlight.js` applied on display (in note grid preview, strip tags)
- CSS: monospace font, dark background (`#1e1e1e`), light text in editor
- Language selection: dropdown toggle on the code block (optional, defaults to auto-detect)
- No backend changes

### A5. Undo/Redo Buttons

**Approach:** Toolbar buttons bound to Quill History module.

- Add undo/redo buttons at the left of the toolbar (arrow icons)
- Bind to `quill.history.undo()` / `quill.history.redo()`
- Disable when at history boundary
- Quill's History module already handles keyboard shortcuts — just adding visible buttons
- No backend changes

### Editor Modal Wiring

- New `NoteEditorModal` component in `src/notes/components/`
- Consumes `isNoteModalOpen`, `editingNote` from `useNotes` context
- Full-screen modal (mobile) or large centered modal (desktop) with LiveNoteEditor
- Title input at top, toolbar, editor body, close/save buttons
- Auto-save: content saved on every `onChange` via existing debounced saveNote
- Wired into `NotesLayout.tsx`

---

## Group B — Note Organization

### B1. Sort Options

**Approach:** Client-side sort dropdown, no backend changes.

- Sort dropdown in NotesGrid header bar, next to search input
- Options: **Date modified** (default), **Date created**, **Title A-Z**, **Title Z-A**
- Pinned notes always float to the top regardless of sort
- `useMemo` sort on the already-filtered array
- Manual drag-to-reorder deferred (requires DB `sort_order` column — future iteration)

### B2. Archive

**Approach:** Use existing `folder` column with `'archive'` value — no DB migration.

- **Backend:** No changes. PUT endpoint already passes `folder` through.
- **Sidebar:** New filter entry "Archive" (Archive icon) between Locked and Trash
- **Note actions:** "Archive" option moves `folder` from `'notes'` to `'archive'`; "Unarchive" moves back
- **Filtering:** Archive view shows `folder === 'archive'`; archived notes excluded from "All Notes"
- **Trash interaction:** Notes in trash cannot be archived — must restore first
- **Grid card:** Show archive icon indicator on archived notes

---

## Group C — New Data Features

### C1. Reminders / Due Dates

**Approach:** New DB table, API, date picker in editor.

- **DB:** `note_reminders(note_id VARCHAR(255) PK FK→notes.id, remind_at DATETIME NOT NULL, notified TINYINT(1) DEFAULT 0, created_at TIMESTAMP)`
- **API:**
  - `POST /api/notes/:id/reminder` — body `{ remind_at }` — upsert
  - `DELETE /api/notes/:id/reminder` — remove
  - `GET /api/notes/reminders` — return all pending reminders for user
- **Backend migration:** `ensureNotesSchema()` adds the new table
- **Frontend:**
  - Date picker in note editor modal (small clock/calendar icon in header)
  - Click opens popover with datetime-local input
  - Grid card shows clock icon + formatted date when reminder set
  - `Notification API` for browser notifications when `remind_at` passes (polled on notes fetch)
- **Type extension:** `Note` interface gains optional `remind_at?: string`. Backend `listNotes()` LEFT JOINs `note_reminders` to include `remind_at` in the note row response

### C2. File Attachments

**Approach:** New DB table, upload endpoint, attachment UI in editor.

- **DB:** `note_attachments(id VARCHAR(255) PK, note_id VARCHAR(255) FK→notes.id, filename VARCHAR(255), mime_type VARCHAR(100), size_bytes BIGINT, storage_path VARCHAR(500), created_at TIMESTAMP, INDEX(note_id))`
- **API:**
  - `POST /api/notes/:id/attachments` — multipart file, max 25MB, stores to disk, returns attachment record
  - `GET /api/notes/:id/attachments` — list attachments
  - `DELETE /api/notes/:id/attachments/:attachmentId` — delete file + record
  - Files served from `/uploads/notes/<user>/<attachment_id>/<filename>`
- **Backend migration:** `ensureNotesSchema()` adds the new table
- **Frontend:**
  - Attachment section below editor in note modal
  - Drag-and-drop zone + click-to-browse button
  - File list: filename, size (formatted), delete button
  - Image attachments show thumbnail; PDFs show PDF icon
  - Attachments fetched with note (separate API call on modal open)
- **Type extension:** New `NoteAttachment` type, fetched per-note

---

## Files Changed

### New files
- `webmail-frontend/src/notes/components/NoteEditorModal.tsx`
- `webmail-frontend/src/notes/components/AttachmentList.tsx`
- `webmail-frontend/src/notes/components/ReminderPicker.tsx`
- `webmail-frontend/src/notes/editor/checklist-blot.ts`
- `webmail-frontend/src/notes/editor/code-block-blot.ts`

### Modified files
- `webmail-frontend/src/notes/hooks/useNotes.ts` — add sort state, reminder/attachment state
- `webmail-frontend/src/notes/NotesGrid.tsx` — sort dropdown, archive filter updates
- `webmail-frontend/src/notes/NotesSidebar.tsx` — archive filter
- `webmail-frontend/src/notes/NotesLayout.tsx` — render NoteEditorModal
- `webmail-frontend/src/notes/routes.tsx` — no changes expected
- `webmail-frontend/src/LiveNoteEditor.tsx` — add checklist+code blot registration, image handler, undo/redo buttons, table button, code button
- `webmail-frontend/src/shared/types.ts` — add NoteAttachment, extend Note
- `webmail-frontend/src/shared/api.ts` — add upload, reminder, attachment API functions
- `webmail-backend/src/notes-utils.ts` — add ensureRemindersSchema, ensureAttachmentsSchema, listAttachments, saveReminder, deleteReminder, etc.
- `webmail-backend/src/apps-api.js` — add new routes (upload, reminders, attachments)

---

## Testing Strategy

- **Checklists:** Verify toggle survives save/refresh round-trip, works in collaborative session
- **Image upload:** Verify paste, drag-drop, file picker all work; verify size limit enforcement
- **Tables:** Verify insert, edit, delete cells; verify HTML survives save/load
- **Code blocks:** Verify syntax highlighting renders, code survives save/load
- **Undo/redo:** Verify buttons enable/disable correctly, undo/redo works with keyboard and buttons
- **Sort:** Verify all four sort orders, pinned-float-to-top behavior
- **Archive:** Verify archive/unarchive moves, filter visibility, trash interaction
- **Reminders:** Verify set/clear/notify flow, datetime persistence
- **Attachments:** Verify upload, list, delete, download, size limit
- **Modal:** Verify open from "+ New Note" and card click, close saves state
