# Notes High-Priority Gaps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the 9 high-priority missing features for the notes webapp: checklists, image paste, tables, code blocks, undo/redo, sort options, archive, reminders, and file attachments.

**Architecture:** Frontend changes center on LiveNoteEditor (custom Quill blots + toolbar buttons), a new NoteEditorModal, and new UI components wired through the existing `useNotes` hook. Backend adds two new DB tables (`note_reminders`, `note_attachments`) and three new API route groups (upload, reminders, attachments) alongside the existing notes CRUD.

**Tech Stack:** React 19, ReactQuill (react-quill-new), Yjs/WebRTC, Express 5, MySQL (mysql2), multer (already a dependency), highlight.js (new), Node built-in test runner

## Global Constraints

- No test framework in frontend (Vite, no vitest) — verify manually in browser
- Backend tests use `node --test` with `.test.cjs` files in `test/`
- Backend source is TypeScript in `src/*.ts`, compiled to `src/*.js` via `tsc`
- Frontend has no dedicated notes CSS file — add styles to `src/index.css`
- Follow existing code patterns: `useNotes` hook owns state, components receive it as `notesCtx`
- New npm packages must be added to package.json explicitly

---

### Task 1: Extend Frontend Types and API Layer

**Files:**
- Modify: `webmail-frontend/src/shared/types.ts:260-271`
- Modify: `webmail-frontend/src/shared/api.ts:316-337`

**Interfaces:**
- Produces: `NoteAttachment` type, extended `Note` with `remind_at`, new API functions: `uploadNoteImage`, `fetchNoteReminder`, `saveNoteReminder`, `deleteNoteReminder`, `fetchNoteAttachments`, `uploadNoteAttachment`, `deleteNoteAttachment`

- [ ] **Step 1: Add new types to types.ts**

In `webmail-frontend/src/shared/types.ts`, after the `Note` interface (line 271), add:

```typescript
export interface NoteAttachment {
  id: string;
  note_id: string;
  filename: string;
  mime_type: string;
  size_bytes: number;
  storage_path: string;
  created_at: string;
}
```

Also extend the `Note` interface. Change line 270 from:
```typescript
  updated_at: string;
```
to:
```typescript
  updated_at: string;
  remind_at?: string;
  attachments?: NoteAttachment[];
```

- [ ] **Step 2: Add API functions to api.ts**

In `webmail-frontend/src/shared/api.ts`, after the existing notes API functions (line 337), add:

```typescript
// ---- Notes: Image upload ----
export async function uploadNoteImage(file: File): Promise<{ url: string }> {
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch('/api/notes/upload', { method: 'POST', body: formData });
  if (!res.ok) throw new Error('Image upload failed');
  return res.json();
}

// ---- Notes: Reminders ----
export async function fetchNoteReminder(noteId: string): Promise<{ remind_at: string } | null> {
  const res = await fetch(`/api/notes/${noteId}/reminder`);
  if (!res.ok) {
    if (res.status === 404) return null;
    throw new Error('Failed to fetch reminder');
  }
  const data = await res.json();
  return data.reminder || null;
}

export async function saveNoteReminder(noteId: string, remindAt: string): Promise<void> {
  await fetch(`/api/notes/${noteId}/reminder`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ remind_at: remindAt }),
  });
}

export async function deleteNoteReminder(noteId: string): Promise<void> {
  await fetch(`/api/notes/${noteId}/reminder`, { method: 'DELETE' });
}

// ---- Notes: Attachments ----
export async function fetchNoteAttachments(noteId: string): Promise<NoteAttachment[]> {
  const res = await fetch(`/api/notes/${noteId}/attachments`);
  if (!res.ok) throw new Error('Failed to fetch attachments');
  const data = await res.json();
  return data.attachments || [];
}

export async function uploadNoteAttachment(noteId: string, file: File): Promise<NoteAttachment> {
  const formData = new FormData();
  formData.append('file', file);
  const res = await fetch(`/api/notes/${noteId}/attachments`, { method: 'POST', body: formData });
  if (!res.ok) throw new Error('Attachment upload failed');
  const data = await res.json();
  return data.attachment;
}

export async function deleteNoteAttachment(noteId: string, attachmentId: string): Promise<void> {
  await fetch(`/api/notes/${noteId}/attachments/${attachmentId}`, { method: 'DELETE' });
}
```

- [ ] **Step 3: Verify TypeScript compilation**

Run: `cd webmail-frontend && npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 4: Commit**

```bash
git add webmail-frontend/src/shared/types.ts webmail-frontend/src/shared/api.ts
git commit -m "feat: extend notes types and API layer for reminders, attachments, image upload

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: Backend — Image Upload, Reminders, and Attachments

**Files:**
- Modify: `webmail-backend/src/notes-utils.ts` (add schema functions, upload helper)
- Modify: `webmail-backend/src/apps-api.ts` (add new routes after line 970)

**Interfaces:**
- Consumes: Existing `NoteRow` interface, `pool` from db, Express router
- Produces: `ensureAllNotesSchemas()`, `saveNoteReminder()`, `deleteNoteReminder()`, `getNoteReminder()`, `saveNoteAttachment()`, `listNoteAttachments()`, `deleteNoteAttachment()`, new Express routes

- [ ] **Step 1: Add schema and helper functions to notes-utils.ts**

In `webmail-backend/src/notes-utils.ts`, after the `hardDeleteNote` function (line 129), add:

```typescript
// ---- Reminders ----

export interface NoteReminder {
    note_id: string;
    remind_at: string;
    notified: number;
    created_at: string;
}

export async function ensureRemindersSchema(): Promise<void> {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS note_reminders (
            note_id VARCHAR(255) PRIMARY KEY,
            remind_at DATETIME NOT NULL,
            notified TINYINT(1) DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE
        )
    `);
}

export async function getNoteReminder(noteId: string): Promise<NoteReminder | null> {
    const [results]: any = await pool.query(
        'SELECT * FROM note_reminders WHERE note_id = ?',
        [noteId]
    );
    return results.length > 0 ? results[0] : null;
}

export async function saveNoteReminder(noteId: string, remindAt: string): Promise<void> {
    await pool.query(
        'INSERT INTO note_reminders (note_id, remind_at) VALUES (?, ?) ON DUPLICATE KEY UPDATE remind_at = VALUES(remind_at), notified = 0',
        [noteId, remindAt]
    );
}

export async function deleteNoteReminder(noteId: string): Promise<void> {
    await pool.query('DELETE FROM note_reminders WHERE note_id = ?', [noteId]);
}

// ---- Attachments ----

export interface NoteAttachmentRow {
    id: string;
    note_id: string;
    filename: string;
    mime_type: string;
    size_bytes: number;
    storage_path: string;
    created_at: string;
}

export async function ensureAttachmentsSchema(): Promise<void> {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS note_attachments (
            id VARCHAR(255) PRIMARY KEY,
            note_id VARCHAR(255) NOT NULL,
            filename VARCHAR(255) NOT NULL,
            mime_type VARCHAR(100) NOT NULL,
            size_bytes BIGINT NOT NULL,
            storage_path VARCHAR(500) NOT NULL,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX idx_note_attachments_note_id (note_id),
            FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE
        )
    `);
}

export async function listNoteAttachments(noteId: string): Promise<NoteAttachmentRow[]> {
    const [results]: any = await pool.query(
        'SELECT * FROM note_attachments WHERE note_id = ? ORDER BY created_at ASC',
        [noteId]
    );
    return results as NoteAttachmentRow[];
}

export async function saveNoteAttachment(attachment: NoteAttachmentRow): Promise<void> {
    await pool.query(
        'INSERT INTO note_attachments (id, note_id, filename, mime_type, size_bytes, storage_path) VALUES (?, ?, ?, ?, ?, ?)',
        [attachment.id, attachment.note_id, attachment.filename, attachment.mime_type, attachment.size_bytes, attachment.storage_path]
    );
}

export async function deleteNoteAttachment(attachmentId: string): Promise<NoteAttachmentRow | null> {
    const [results]: any = await pool.query('SELECT * FROM note_attachments WHERE id = ?', [attachmentId]);
    if (results.length === 0) return null;
    await pool.query('DELETE FROM note_attachments WHERE id = ?', [attachmentId]);
    return results[0];
}

// ---- Schema migration helper ----

export async function ensureAllNotesSchemas(): Promise<void> {
    await ensureNotesSchema();
    await ensureRemindersSchema();
    await ensureAttachmentsSchema();
}

// ---- Extended listNotes with reminders ----

export async function listNotesWithReminders(owner: string): Promise<(NoteRow & { remind_at: string | null })[]> {
    const [results]: any = await pool.query(
        `SELECT n.*, r.remind_at
         FROM notes n
         LEFT JOIN note_reminders r ON n.id = r.note_id
         WHERE n.owner = ? AND n.is_deleted = 0
         ORDER BY n.updated_at DESC`,
        [owner]
    );
    return results;
}
```

- [ ] **Step 2: Add TypeScript type declarations**

In `webmail-backend/src/notes-utils.d.ts`, add the new function declarations. Read the existing `.d.ts` first:

```bash
cat webmail-backend/src/notes-utils.d.ts
```

Then edit to append declarations for the new exports:

```typescript
export interface NoteReminder { note_id: string; remind_at: string; notified: number; created_at: string; }
export interface NoteAttachmentRow { id: string; note_id: string; filename: string; mime_type: string; size_bytes: number; storage_path: string; created_at: string; }
export declare function ensureRemindersSchema(): Promise<void>;
export declare function ensureAttachmentsSchema(): Promise<void>;
export declare function ensureAllNotesSchemas(): Promise<void>;
export declare function getNoteReminder(noteId: string): Promise<NoteReminder | null>;
export declare function saveNoteReminder(noteId: string, remindAt: string): Promise<void>;
export declare function deleteNoteReminder(noteId: string): Promise<void>;
export declare function listNoteAttachments(noteId: string): Promise<NoteAttachmentRow[]>;
export declare function saveNoteAttachment(attachment: NoteAttachmentRow): Promise<void>;
export declare function deleteNoteAttachment(attachmentId: string): Promise<NoteAttachmentRow | null>;
export declare function listNotesWithReminders(owner: string): Promise<(import('./notes-utils').NoteRow & { remind_at: string | null })[]>;
```

- [ ] **Step 3: Add new routes to apps-api.ts**

In `webmail-backend/src/apps-api.ts`, after line 970 (the closing `// ==========================================` of the notes section), insert before the calendars section:

```typescript
// ---- Notes: Image upload ----
import multer from 'multer';
import * as path from 'path';
import * as fs from 'fs';
import * as crypto from 'crypto';

const notesUploadDir = path.join(__dirname, '..', 'uploads', 'notes');
if (!fs.existsSync(notesUploadDir)) {
    fs.mkdirSync(notesUploadDir, { recursive: true });
}

const notesImageUpload = multer({
    storage: multer.diskStorage({
        destination: notesUploadDir,
        filename: (_req, file, cb) => {
            const user = (_req as any).username || 'unknown';
            const userDir = path.join(notesUploadDir, user);
            if (!fs.existsSync(userDir)) fs.mkdirSync(userDir, { recursive: true });
            const ext = path.extname(file.originalname) || '.png';
            cb(null, path.join(user, `${crypto.randomUUID()}${ext}`));
        }
    }),
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
        const allowed = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
        if (allowed.includes(file.mimetype)) {
            cb(null, true);
        } else {
            cb(new Error('Only PNG, JPEG, GIF, and WebP images are allowed'));
        }
    }
});

appsApiRouter.post('/notes/upload', notesImageUpload.single('file'), async (req: Request, res: Response) => {
    if (!req.file) {
        res.status(400).json({ success: false, error: 'No file uploaded' });
        return;
    }
    const url = `/uploads/notes/${(req.file as any).filename}`;
    res.json({ success: true, url });
});

// ---- Notes: Reminders ----
import { getNoteReminder, saveNoteReminder, deleteNoteReminder, listNotesWithReminders } from './notes-utils';

appsApiRouter.get('/notes/:id/reminder', async (req: Request, res: Response) => {
    try {
        const reminder = await getNoteReminder(req.params.id);
        if (!reminder) {
            res.status(404).json({ success: false, reminder: null });
            return;
        }
        res.json({ success: true, reminder: { remind_at: reminder.remind_at } });
    } catch (e: any) {
        res.status(500).json({ success: false, error: e.message });
    }
});

appsApiRouter.post('/notes/:id/reminder', async (req: Request, res: Response) => {
    try {
        await saveNoteReminder(req.params.id, req.body.remind_at);
        res.json({ success: true });
    } catch (e: any) {
        res.status(500).json({ success: false, error: e.message });
    }
});

appsApiRouter.delete('/notes/:id/reminder', async (req: Request, res: Response) => {
    try {
        await deleteNoteReminder(req.params.id);
        res.json({ success: true });
    } catch (e: any) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// ---- Notes: Attachments ----
import { listNoteAttachments, saveNoteAttachment, deleteNoteAttachment } from './notes-utils';

const attachmentsUpload = multer({
    storage: multer.diskStorage({
        destination: (_req, _file, cb) => {
            const user = (_req as any).username || 'unknown';
            const userDir = path.join(notesUploadDir, user);
            if (!fs.existsSync(userDir)) fs.mkdirSync(userDir, { recursive: true });
            cb(null, userDir);
        },
        filename: (_req, file, cb) => {
            const uniqueName = `${crypto.randomUUID()}${path.extname(file.originalname)}`;
            cb(null, uniqueName);
        }
    }),
    limits: { fileSize: 25 * 1024 * 1024 },
});

appsApiRouter.get('/notes/:id/attachments', async (req: Request, res: Response) => {
    try {
        const attachments = await listNoteAttachments(req.params.id);
        res.json({ success: true, attachments });
    } catch (e: any) {
        res.status(500).json({ success: false, error: e.message });
    }
});

appsApiRouter.post('/notes/:id/attachments', attachmentsUpload.single('file'), async (req: Request, res: Response) => {
    try {
        if (!req.file) {
            res.status(400).json({ success: false, error: 'No file uploaded' });
            return;
        }
        const id = crypto.randomUUID();
        const user = (req as any).username || 'unknown';
        const storagePath = path.join('notes', user, (req.file as any).filename);
        const attachment = {
            id,
            note_id: req.params.id,
            filename: req.file.originalname,
            mime_type: req.file.mimetype,
            size_bytes: req.file.size,
            storage_path: storagePath,
        };
        await saveNoteAttachment(attachment as any);
        res.json({ success: true, attachment });
    } catch (e: any) {
        res.status(500).json({ success: false, error: e.message });
    }
});

appsApiRouter.delete('/notes/:id/attachments/:attachmentId', async (req: Request, res: Response) => {
    try {
        const deleted = await deleteNoteAttachment(req.params.attachmentId);
        if (!deleted) {
            res.status(404).json({ success: false, error: 'Attachment not found' });
            return;
        }
        // Delete file from disk
        const filePath = path.join(__dirname, '..', 'uploads', deleted.storage_path);
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }
        res.json({ success: true });
    } catch (e: any) {
        res.status(500).json({ success: false, error: e.message });
    }
});
```

Also update the GET /notes route (line 909-925) to use `listNotesWithReminders` instead of `listNotes`. Replace:

```typescript
        const rows = await listNotes(user);
```

with:

```typescript
        const rows = await listNotesWithReminders(user);
```

- [ ] **Step 4: Add multer import at top of apps-api.ts**

Check if multer is already imported at the top of `apps-api.ts`. If not, the inline imports in the code above will handle it. Verify the existing imports near line 1-20:

```bash
head -20 webmail-backend/src/apps-api.ts
```

If `multer`, `path`, `fs`, and `crypto` are not already imported at the top level, the inline `import` statements inside the module body should work (TypeScript allows this in function/module scope with `esModuleInterop`).

- [ ] **Step 5: Add schema initialization to the server startup**

In `webmail-backend/src/index.ts`, line 31, update the import to include the new schema functions:

```typescript
import { ensureNotesSchema, ensureRemindersSchema, ensureAttachmentsSchema, listNotes, saveNote, deleteNote, getNotesSyncToken, hardDeleteNote } from './notes-utils';
```

After line 60 (`ensureNotesSchema().catch(...)`), add:

```typescript
ensureRemindersSchema().catch(err => console.error('Failed to initialize reminders schema:', err));
ensureAttachmentsSchema().catch(err => console.error('Failed to initialize attachments schema:', err));
```

- [ ] **Step 6: Serve static uploads**

In `webmail-backend/src/index.ts`, add a static file serve for uploads after the existing middleware setup. After line 71 (the `bodyParser.raw` section), add:

```typescript
import * as path from 'path';
app.use('/uploads', express.static(path.join(__dirname, '..', 'uploads')));
```

- [ ] **Step 7: Build and test backend**

Run: `cd webmail-backend && npm run build`
Expected: No TypeScript compilation errors.

- [ ] **Step 8: Write backend test**

Create `webmail-backend/test/notes-reminders-attachments.test.cjs`:

```javascript
const { test } = require('node:test');
const assert = require('node:assert');

test('note reminders and attachments schemas defined', async () => {
    // This test validates that the module exports exist and are callable
    // It doesn't require a database connection — just validates structure
    const mod = require('../src/notes-utils');
    assert.strictEqual(typeof mod.ensureRemindersSchema, 'function');
    assert.strictEqual(typeof mod.ensureAttachmentsSchema, 'function');
    assert.strictEqual(typeof mod.getNoteReminder, 'function');
    assert.strictEqual(typeof mod.saveNoteReminder, 'function');
    assert.strictEqual(typeof mod.deleteNoteReminder, 'function');
    assert.strictEqual(typeof mod.listNoteAttachments, 'function');
    assert.strictEqual(typeof mod.saveNoteAttachment, 'function');
    assert.strictEqual(typeof mod.deleteNoteAttachment, 'function');
    assert.strictEqual(typeof mod.listNotesWithReminders, 'function');
});
```

Run: `cd webmail-backend && npm test`
Expected: All tests pass (the new test validates exports exist).

- [ ] **Step 9: Commit**

```bash
git add webmail-backend/src/notes-utils.ts webmail-backend/src/notes-utils.d.ts webmail-backend/src/apps-api.ts webmail-backend/src/index.ts webmail-backend/test/notes-reminders-attachments.test.cjs
git commit -m "feat: backend endpoints for image upload, reminders, and attachments

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: Checklist Blot and CSS

**Files:**
- Create: `webmail-frontend/src/notes/editor/checklist-blot.ts`
- Modify: `webmail-frontend/src/index.css` (append styles)

**Interfaces:**
- Produces: `ChecklistBlot` Quill blot (registered as `formats/checklist`), CSS classes `.ql-checklist-item`, `.ql-checkbox`

- [ ] **Step 1: Create the checklist blot**

Create `webmail-frontend/src/notes/editor/checklist-blot.ts`:

```typescript
import Quill from 'react-quill-new';

const Inline = Quill.import('blots/inline') as any;

class ChecklistBlot extends Inline {
  static blotName = 'checklist-item';
  static tagName = 'li';
  static className = 'ql-checklist-item';

  static create(value: any) {
    const node = super.create(value);
    node.setAttribute('data-checked', value === true ? 'true' : 'false');
    // Insert a clickable checkbox span
    const checkbox = document.createElement('span');
    checkbox.className = 'ql-checkbox';
    checkbox.contentEditable = 'false';
    checkbox.innerHTML = value ? '✓' : '';
    node.insertBefore(checkbox, node.firstChild);
    return node;
  }

  static formats(domNode: HTMLElement): any {
    return domNode.getAttribute('data-checked') === 'true';
  }

  format(name: string, value: any): void {
    if (name === 'checklist-item') {
      this.domNode.setAttribute('data-checked', value ? 'true' : 'false');
      const checkbox = this.domNode.querySelector('.ql-checkbox');
      if (checkbox) {
        (checkbox as HTMLElement).innerHTML = value ? '✓' : '';
      }
    } else {
      super.format(name, value);
    }
  }
}

export { ChecklistBlot };
```

- [ ] **Step 2: Add checklist CSS to index.css**

Append to `webmail-frontend/src/index.css`:

```css
/* ---- Checklist ---- */
.ql-checkbox {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border: 2px solid var(--text-secondary);
  border-radius: 4px;
  margin-right: 8px;
  margin-left: 0;
  cursor: pointer;
  font-size: 12px;
  color: var(--accent-primary);
  user-select: none;
  flex-shrink: 0;
}

li[data-checked="true"] {
  text-decoration: line-through;
  opacity: 0.6;
}

li[data-checked="true"] .ql-checkbox {
  background: var(--accent-primary);
  border-color: var(--accent-primary);
}

.ql-editor li.ql-checklist-item {
  list-style: none;
  display: flex;
  align-items: flex-start;
}

.ql-editor li.ql-checklist-item::before {
  display: none;
}
```

- [ ] **Step 3: Verify TypeScript compilation**

Run: `cd webmail-frontend && npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 4: Commit**

```bash
git add webmail-frontend/src/notes/editor/checklist-blot.ts webmail-frontend/src/index.css
git commit -m "feat: add checklist blot for notes editor

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 4: Code Block Blot and highlight.js

**Files:**
- Create: `webmail-frontend/src/notes/editor/code-block-blot.ts`
- Modify: `webmail-frontend/src/index.css` (append code block styles)
- Modify: `webmail-frontend/package.json` (add highlight.js dependency)

**Interfaces:**
- Produces: `CodeBlockBlot` Quill blot (registered as `formats/code-block`)

- [ ] **Step 1: Install highlight.js**

Run: `cd webmail-frontend && npm install highlight.js`

- [ ] **Step 2: Create the code block blot**

Create `webmail-frontend/src/notes/editor/code-block-blot.ts`:

```typescript
import Quill from 'react-quill-new';

const Block = Quill.import('blots/block') as any;

class CodeBlockBlot extends Block {
  static blotName = 'code-block';
  static tagName = 'pre';
  static className = 'ql-code-block-container';

  static create(value: any) {
    const node = super.create(value);
    node.setAttribute('spellcheck', 'false');
    node.setAttribute('data-language', value || '');
    
    const code = document.createElement('code');
    code.className = value ? `language-${value}` : '';
    
    return node;
  }

  static formats(domNode: HTMLElement): any {
    return domNode.getAttribute('data-language') || '';
  }

  format(name: string, value: any): void {
    if (name === 'code-block') {
      this.domNode.setAttribute('data-language', value || '');
      const code = this.domNode.querySelector('code');
      if (code) {
        code.className = value ? `language-${value}` : '';
      }
    } else {
      super.format(name, value);
    }
  }
}

export { CodeBlockBlot };
```

- [ ] **Step 3: Add code block CSS to index.css**

Append to `webmail-frontend/src/index.css`:

```css
/* ---- Code Block ---- */
.ql-code-block-container {
  background: #1e1e1e;
  color: #d4d4d4;
  border-radius: var(--radius-md);
  padding: 12px 16px;
  margin: 8px 0;
  font-family: 'SF Mono', 'Fira Code', 'Fira Mono', 'Roboto Mono', monospace;
  font-size: 0.85rem;
  line-height: 1.5;
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-word;
}

.ql-code-block-container code {
  font-family: inherit;
  font-size: inherit;
  background: none;
  padding: 0;
}

/* Code block in editor (bubble theme) */
.ql-bubble .ql-code-block-container {
  background: #1e1e1e;
  color: #d4d4d4;
}
```

- [ ] **Step 4: Verify TypeScript compilation**

Run: `cd webmail-frontend && npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 5: Commit**

```bash
git add webmail-frontend/src/notes/editor/code-block-blot.ts webmail-frontend/src/index.css webmail-frontend/package.json webmail-frontend/package-lock.json
git commit -m "feat: add code block blot with highlight.js for notes editor

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 5: Editor Toolbar — Checklist, Code, Table, Undo/Redo, Image Handler

**Files:**
- Modify: `webmail-frontend/src/LiveNoteEditor.tsx` (full file rewrite)

**Interfaces:**
- Consumes: `ChecklistBlot` from `./notes/editor/checklist-blot`, `CodeBlockBlot` from `./notes/editor/code-block-blot`, `uploadNoteImage` from `../shared/api`
- Produces: Updated toolbar config with all 5 new controls, registered blots, image paste handler

- [ ] **Step 1: Rewrite LiveNoteEditor.tsx with all enhancements**

Replace the contents of `webmail-frontend/src/LiveNoteEditor.tsx` with:

```typescript
import React, { useEffect, useRef } from 'react';
import ReactQuill from 'react-quill-new';
import 'react-quill-new/dist/quill.bubble.css';
import * as Y from 'yjs';
import { WebrtcProvider } from 'y-webrtc';
import { QuillBinding } from 'y-quill';
import { ChecklistBlot } from './notes/editor/checklist-blot';
import { CodeBlockBlot } from './notes/editor/code-block-blot';
import { uploadNoteImage } from './shared/api';

// Register custom blots
const Quill = ReactQuill.Quill;
Quill.register(ChecklistBlot);
Quill.register(CodeBlockBlot);

// Add custom list type for checklist
const ListConfig = Quill.import('formats/list') as any;
if (ListConfig) {
  ListConfig.DEFAULTS = {
    ...ListConfig.DEFAULTS,
    checklist: {
      depth: 0,
      type: 'checklist',
    },
  };
}

interface LiveNoteEditorProps {
  noteId: string;
  initialContent: string;
  onChange: (content: string) => void;
}

export const LiveNoteEditor: React.FC<LiveNoteEditorProps> = ({ noteId, initialContent, onChange }) => {
  const quillRef = useRef<any>(null);
  const initialized = useRef(false);

  useEffect(() => {
    if (!quillRef.current || initialized.current) return;
    initialized.current = true;

    const editor = quillRef.current.getEditor();

    const ydoc = new Y.Doc();
    const provider = new WebrtcProvider(`oms-note-${noteId}`, ydoc, {
      signaling: ['wss://signaling.yjs.dev', 'wss://y-webrtc-signaling-eu.herokuapp.com']
    });
    const ytext = ydoc.getText('quill');

    const binding = new QuillBinding(ytext, editor, provider.awareness);

    if (initialContent && ytext.length === 0) {
      editor.clipboard.dangerouslyPasteHTML(initialContent);
    }

    editor.on('text-change', () => {
      onChange(editor.root.innerHTML);
    });

    return () => {
      binding.destroy();
      provider.destroy();
      ydoc.destroy();
    };
  }, [noteId]);

  // Image upload handler
  const handleImageUpload = React.useCallback(() => {
    const input = document.createElement('input');
    input.setAttribute('type', 'file');
    input.setAttribute('accept', 'image/*');
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      try {
        const editor = quillRef.current?.getEditor();
        if (!editor) return;
        const range = editor.getSelection(true);
        const { url } = await uploadNoteImage(file);
        editor.insertEmbed(range.index, 'image', url);
        editor.setSelection(range.index + 1);
      } catch (e) {
        console.error('Image upload failed', e);
      }
    };
    input.click();
  }, []);

  // Table insert helper
  const handleInsertTable = React.useCallback(() => {
    const editor = quillRef.current?.getEditor();
    if (!editor) return;
    const rows = 3, cols = 3;
    let tableHtml = '<table style="width:100%;border-collapse:collapse;border:1px solid var(--border-glass);">';
    for (let i = 0; i < rows; i++) {
      tableHtml += '<tr>';
      for (let j = 0; j < cols; j++) {
        tableHtml += '<td style="border:1px solid var(--border-glass);padding:6px 10px;min-width:80px;">&nbsp;</td>';
      }
      tableHtml += '</tr>';
    }
    tableHtml += '</table>';
    const range = editor.getSelection(true);
    editor.clipboard.dangerouslyPasteHTML(range.index, tableHtml);
  }, []);

  // Code block insert
  const handleCodeBlock = React.useCallback(() => {
    const editor = quillRef.current?.getEditor();
    if (!editor) return;
    const range = editor.getSelection(true);
    editor.formatText(range.index, range.length, 'code-block', 'plaintext');
  }, []);

  // Checklist toggle
  const handleChecklist = React.useCallback(() => {
    const editor = quillRef.current?.getEditor();
    if (!editor) return;
    const range = editor.getSelection(true);
    const format = editor.getFormat(range);
    if (format['list'] === 'checklist') {
      editor.format('list', false);
    } else {
      editor.format('list', 'checklist');
    }
  }, []);

  // Undo/Redo state
  const [canUndo, setCanUndo] = React.useState(false);
  const [canRedo, setCanRedo] = React.useState(false);

  useEffect(() => {
    const editor = quillRef.current?.getEditor();
    if (!editor) return;

    const updateState = () => {
      const history = editor.history;
      setCanUndo(history?.stack?.undo?.length > 0);
      setCanRedo(history?.stack?.redo?.length > 0);
    };

    editor.on('text-change', updateState);
    editor.on('selection-change', updateState);

    return () => {
      editor.off('text-change', updateState);
      editor.off('selection-change', updateState);
    };
  }, [noteId]);

  const modules = React.useMemo(() => ({
    toolbar: {
      container: [
        ['undo', 'redo'],
        [{ 'header': [1, 2, 3, false] }],
        ['bold', 'italic', 'underline', 'strike', 'blockquote'],
        [{ 'list': 'checklist' }, { 'list': 'ordered' }, { 'list': 'bullet' }, { 'indent': '-1' }, { 'indent': '+1' }],
        ['code-block', 'link', 'image'],
        ['table', 'clean']
      ],
      handlers: {
        'image': handleImageUpload,
        'table': handleInsertTable,
        'code-block': handleCodeBlock,
        'undo': () => quillRef.current?.getEditor()?.history?.undo(),
        'redo': () => quillRef.current?.getEditor()?.history?.redo(),
      },
    },
    keyboard: {
      bindings: {
        handleEnterOnChecklist: {
          key: 'Enter',
          format: { list: 'checklist' },
          handler: function(this: any, range: any, context: any) {
            const [line] = this.quill.getLine(range.index);
            const text = line.domNode.textContent?.trim();
            if (!text || text === '✓') {
              this.quill.format('list', false);
              return false;
            }
            this.quill.format('list', 'checklist');
            return false;
          },
        },
      },
    },
  }), [handleImageUpload, handleInsertTable, handleCodeBlock]);

  return (
    <ReactQuill
      ref={quillRef}
      theme="bubble"
      placeholder="Start typing your note here..."
      style={{ height: '100%', display: 'flex', flexDirection: 'column', color: 'var(--text-primary)', fontSize: '1.1rem', lineHeight: '1.6' }}
      modules={modules}
    />
  );
};
```

- [ ] **Step 2: Add table styles to index.css**

Append to `webmail-frontend/src/index.css`:

```css
/* ---- Tables ---- */
.ql-editor table {
  border-collapse: collapse;
  width: 100%;
}

.ql-editor td {
  border: 1px solid var(--border-glass);
  padding: 6px 10px;
  min-width: 80px;
}
```

- [ ] **Step 3: Verify TypeScript compilation**

Run: `cd webmail-frontend && npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 4: Commit**

```bash
git add webmail-frontend/src/LiveNoteEditor.tsx webmail-frontend/src/index.css
git commit -m "feat: add checklist, code block, table, undo/redo, image upload to editor toolbar

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 6: Note Editor Modal

**Files:**
- Create: `webmail-frontend/src/notes/components/NoteEditorModal.tsx`
- Modify: `webmail-frontend/src/notes/NotesLayout.tsx` (render modal)
- Modify: `webmail-frontend/src/index.css` (append modal styles)

**Interfaces:**
- Consumes: `useNotes` hook return type, `LiveNoteEditor` component
- Produces: `NoteEditorModal` component

- [ ] **Step 1: Create NoteEditorModal component**

Create `webmail-frontend/src/notes/components/NoteEditorModal.tsx`:

```typescript
import React, { useCallback, useEffect, useRef } from 'react';
import { X, Save } from 'lucide-react';
import { LiveNoteEditor } from '../../LiveNoteEditor';
import type { useNotes } from '../hooks/useNotes';
import { saveNote } from '../../shared/api';

interface NoteEditorModalProps {
  notesCtx: ReturnType<typeof useNotes>;
}

export function NoteEditorModal({ notesCtx: n }: NoteEditorModalProps) {
  const titleRef = useRef<HTMLInputElement>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout>>();

  if (!n.isNoteModalOpen) return null;

  const note = n.editingNote;
  const isNew = !note.id;

  const handleClose = useCallback(() => {
    n.setIsNoteModalOpen(false);
    n.setEditingNote({});
    n.fetchNotes();
  }, [n]);

  const handleTitleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    n.setEditingNote((prev: any) => ({ ...prev, title: e.target.value }));
  }, [n]);

  const handleContentChange = useCallback((content: string) => {
    n.setEditingNote((prev: any) => ({ ...prev, content }));
    // Auto-save debounced
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      if (n.editingNote.title || n.editingNote.content) {
        await saveNote({
          id: n.editingNote.id,
          title: n.editingNote.title || 'Untitled',
          content: n.editingNote.content || '',
          color: n.editingNote.color,
          is_pinned: n.editingNote.is_pinned,
          is_locked: n.editingNote.is_locked,
          folder: n.editingNote.folder || 'notes',
          labels_json: n.editingNote.labels_json || '[]',
        } as any);
        if (isNew) {
          n.fetchNotes();
        }
      }
    }, 1500);
  }, [n]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  // Focus title on new note
  useEffect(() => {
    if (isNew && titleRef.current) {
      titleRef.current.focus();
    }
  }, [isNew]);

  return (
    <div className="note-modal-overlay" onClick={(e) => {
      if (e.target === e.currentTarget) handleClose();
    }}>
      <div className="note-modal">
        <div className="note-modal-header">
          <input
            ref={titleRef}
            type="text"
            className="note-modal-title"
            placeholder="Note title..."
            value={note.title || ''}
            onChange={handleTitleChange}
          />
          <div className="note-modal-actions">
            <button className="btn btn-ghost btn-sm" onClick={handleClose} title="Close">
              <X size={18} />
            </button>
          </div>
        </div>
        <div className="note-modal-editor">
          <LiveNoteEditor
            noteId={note.id || 'new'}
            initialContent={note.content || ''}
            onChange={handleContentChange}
          />
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire modal into NotesLayout.tsx**

In `webmail-frontend/src/notes/NotesLayout.tsx`, add the import and render:

Add import at line 6:
```typescript
import { NoteEditorModal } from './components/NoteEditorModal';
```

In the JSX, add the modal as a sibling to the main layout div. In the `if (isMobile)` branch, add after the `<NotesGrid>`:

```typescript
<NoteEditorModal notesCtx={notesCtx} />
```

And in the desktop branch, add after the closing `</PanelGroup>`:

```typescript
<NoteEditorModal notesCtx={notesCtx} />
```

The complete modified file should look like:

```typescript
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle, useDefaultLayout } from 'react-resizable-panels';
import { useMediaQuery } from '../shared/hooks/useMediaQuery';
import { useNotes } from './hooks/useNotes';
import { NotesSidebar } from './NotesSidebar';
import { NotesGrid } from './NotesGrid';
import { NoteEditorModal } from './components/NoteEditorModal';

function ResizeHandle() {
  return (
    <PanelResizeHandle style={{ width: 16, cursor: 'col-resize', position: 'relative' }}>
      <div style={{ position: 'absolute', top: 0, bottom: 0, left: 6, right: 6,
        background: 'rgba(255,255,255,0.08)', borderRadius: 4 }} />
    </PanelResizeHandle>
  );
}

export function NotesLayout() {
  const notesCtx = useNotes();
  const isMobile = useMediaQuery('(max-width: 767px)');

  const notesPanelLayout = useDefaultLayout({
    id: 'oms-notes-v11',
    panelIds: ['notes-sidebar', 'notes-view'],
  });

  if (isMobile) {
    return (
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <NotesGrid notesCtx={notesCtx} />
        <NoteEditorModal notesCtx={notesCtx} />
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, overflow: 'hidden' }}>
      <PanelGroup
        id="oms-notes-v11"
        orientation="horizontal"
        defaultLayout={notesPanelLayout.defaultLayout}
        onLayoutChange={notesPanelLayout.onLayoutChange}
        style={{ width: '100%', height: '100%', minHeight: 0, minWidth: 0 }}
      >
        <Panel id="notes-sidebar" defaultSize="20%" minSize="8%" maxSize="35%">
          <NotesSidebar notesCtx={notesCtx} />
        </Panel>
        <ResizeHandle />
        <Panel id="notes-view" defaultSize="80%" minSize="25%">
          <NotesGrid notesCtx={notesCtx} />
        </Panel>
      </PanelGroup>
      <NoteEditorModal notesCtx={notesCtx} />
    </div>
  );
}
```

- [ ] **Step 3: Add modal CSS to index.css**

Append to `webmail-frontend/src/index.css`:

```css
/* ---- Note Editor Modal ---- */
.note-modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  backdrop-filter: blur(4px);
  z-index: 1000;
  display: flex;
  align-items: center;
  justify-content: center;
}

.note-modal {
  display: flex;
  flex-direction: column;
  width: 90vw;
  max-width: 900px;
  height: 85vh;
  background: var(--bg-primary);
  border-radius: var(--radius-lg);
  box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
  overflow: hidden;
}

.note-modal-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-glass);
}

.note-modal-title {
  flex: 1;
  background: transparent;
  border: none;
  font-size: 1.2rem;
  font-weight: 600;
  color: var(--text-primary);
  outline: none;
  padding: 4px 0;
}

.note-modal-title::placeholder {
  color: var(--text-secondary);
  opacity: 0.6;
}

.note-modal-actions {
  display: flex;
  gap: 4px;
}

.note-modal-editor {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-height: 0;
  overflow: hidden;
}

.note-modal-editor .quill {
  flex: 1;
  display: flex;
  flex-direction: column;
}

.note-modal-editor .ql-editor {
  flex: 1;
  overflow-y: auto;
  padding: 16px 24px;
}

@media (max-width: 767px) {
  .note-modal {
    width: 100vw;
    height: 100vh;
    max-width: none;
    border-radius: 0;
  }
}
```

- [ ] **Step 4: Verify TypeScript compilation**

Run: `cd webmail-frontend && npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 5: Commit**

```bash
git add webmail-frontend/src/notes/components/NoteEditorModal.tsx webmail-frontend/src/notes/NotesLayout.tsx webmail-frontend/src/index.css
git commit -m "feat: add note editor modal with auto-save

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 7: Sort Options

**Files:**
- Create: `webmail-frontend/src/notes/components/SortDropdown.tsx`
- Modify: `webmail-frontend/src/notes/NotesGrid.tsx` (add sort dropdown and sort logic)
- Modify: `webmail-frontend/src/notes/hooks/useNotes.ts` (add sort state)

**Interfaces:**
- Consumes: `Note[]`, sort state from `useNotes`
- Produces: `SortDropdown` component, sorted note list

- [ ] **Step 1: Add sort state to useNotes hook**

In `webmail-frontend/src/notes/hooks/useNotes.ts`, add after line 16 (`isNoteModalOpen`):

```typescript
  const [notesSort, setNotesSort] = useState<string>('updated');
```

Add to the return object (after line 35):

```typescript
    notesSort, setNotesSort,
```

- [ ] **Step 2: Create SortDropdown component**

Create `webmail-frontend/src/notes/components/SortDropdown.tsx`:

```typescript
import { ArrowUpDown } from 'lucide-react';

interface SortDropdownProps {
  value: string;
  onChange: (value: string) => void;
}

const SORT_OPTIONS = [
  { value: 'updated', label: 'Date modified' },
  { value: 'created', label: 'Date created' },
  { value: 'title_asc', label: 'Title A-Z' },
  { value: 'title_desc', label: 'Title Z-A' },
];

export function SortDropdown({ value, onChange }: SortDropdownProps) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
      <ArrowUpDown size={14} style={{ color: 'var(--text-secondary)' }} />
      <select
        className="glass-input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{ fontSize: '0.85rem', padding: '4px 8px', background: 'var(--bg-secondary)' }}
      >
        {SORT_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    </div>
  );
}
```

- [ ] **Step 3: Integrate sort into NotesGrid**

In `webmail-frontend/src/notes/NotesGrid.tsx`:

Add the import at line 1:
```typescript
import { SortDropdown } from './components/SortDropdown';
```

Replace the filter logic (lines 7-21) to add sort. Change the filtered variable to:

```typescript
  const filtered = n.notes.filter((note) => {
    if (n.notesView === 'pinned') return note.is_pinned;
    if (n.notesView === 'locked') return note.is_locked;
    if (n.notesView === 'archive') return note.folder === 'archive';
    if (n.notesView === 'trash') return note.folder === 'trash';
    if (n.notesView === 'notes') return note.folder !== 'trash' && note.folder !== 'archive';
    if (n.notesLabels.includes(n.notesView)) {
      try { return JSON.parse(note.labels_json || '[]').includes(n.notesView); } catch { return false; }
    }
    return true;
  }).filter((note) => {
    if (!n.notesSearchQuery) return true;
    const q = n.notesSearchQuery.toLowerCase();
    return note.title.toLowerCase().includes(q) || note.content.toLowerCase().includes(q);
  }).sort((a, b) => {
    // Pinned always on top
    if (a.is_pinned && !b.is_pinned) return -1;
    if (!a.is_pinned && b.is_pinned) return 1;
    // Then apply selected sort
    switch (n.notesSort) {
      case 'created': return new Date(b.created_at || '').getTime() - new Date(a.created_at || '').getTime();
      case 'title_asc': return (a.title || '').localeCompare(b.title || '');
      case 'title_desc': return (b.title || '').localeCompare(a.title || '');
      case 'updated':
      default: return new Date(b.updated_at || '').getTime() - new Date(a.updated_at || '').getTime();
    }
  });
```

Add the sort dropdown in the header bar. Replace the existing `<div style={{ display: 'flex', gap: 8, padding: ... }}>` (lines 26-29) with:

```tsx
      <div style={{ display: 'flex', gap: 8, padding: '8px 12px', borderBottom: '1px solid var(--border-glass)', alignItems: 'center' }}>
        <input type="text" className="glass-input" placeholder="Search notes..."
          value={n.notesSearchQuery} onChange={(e) => n.setNotesSearchQuery(e.target.value)}
          style={{ flex: 1, fontSize: '0.85rem' }} />
        <SortDropdown value={n.notesSort} onChange={n.setNotesSort} />
      </div>
```

Note: The `Note` type doesn't currently have `created_at` in the frontend type. Add it to the `Note` interface in `types.ts`:
```typescript
  created_at: string;
```

- [ ] **Step 4: Verify TypeScript compilation**

Run: `cd webmail-frontend && npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 5: Commit**

```bash
git add webmail-frontend/src/notes/components/SortDropdown.tsx webmail-frontend/src/notes/NotesGrid.tsx webmail-frontend/src/notes/hooks/useNotes.ts webmail-frontend/src/shared/types.ts
git commit -m "feat: add sort options (date, title) to notes grid

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 8: Archive

**Files:**
- Modify: `webmail-frontend/src/notes/NotesSidebar.tsx` (add Archive filter)
- Modify: `webmail-frontend/src/notes/NotesGrid.tsx` (update filter for archive, already done in Task 7)

**Interfaces:**
- Consumes: Existing sidebar filter pattern, `notesView` state

- [ ] **Step 1: Add Archive to sidebar**

In `webmail-frontend/src/notes/NotesSidebar.tsx`:

Add Archive to the import:
```typescript
import { StickyNote, Star, Lock, Archive, Trash2 } from 'lucide-react';
```

Add Archive to the filters array (after Locked, before Trash):
```typescript
    { id: 'archive', label: 'Archive', icon: Archive },
```

The full filters array should be:
```typescript
  const filters = [
    { id: 'notes', label: 'All Notes', icon: StickyNote },
    { id: 'pinned', label: 'Pinned', icon: Star },
    { id: 'locked', label: 'Locked', icon: Lock },
    { id: 'archive', label: 'Archive', icon: Archive },
    { id: 'trash', label: 'Trash', icon: Trash2 },
  ];
```

- [ ] **Step 2: Add archive actions to NoteCard context menu**

In `webmail-frontend/src/notes/NotesGrid.tsx`, add a small action bar on the NoteCard. After the labels section in the card (the `{labels.length > 0 && (...)}` block around line 78), add an archive button visible on hover or in a context menu.

Add a small hover action row at the bottom of the note card, inside the card div but after labels:

```tsx
      {/* Hover actions */}
      <div className="note-card-actions" style={{
        display: 'flex', gap: 4, padding: '0 16px 10px', opacity: 0, transition: 'opacity 0.15s',
      }} onClick={(e) => e.stopPropagation()}>
        {note.folder === 'archive' ? (
          <button className="btn btn-ghost btn-xs"
            style={{ fontSize: '0.7rem' }}
            onClick={(e) => {
              e.stopPropagation();
              n.saveNote({ id: note.id, folder: 'notes' });
            }}>
            Unarchive
          </button>
        ) : note.folder !== 'trash' ? (
          <button className="btn btn-ghost btn-xs"
            style={{ fontSize: '0.7rem' }}
            onClick={(e) => {
              e.stopPropagation();
              n.saveNote({ id: note.id, folder: 'archive' });
            }}>
            Archive
          </button>
        ) : null}
      </div>
```

Add CSS for the hover action in `index.css`:

```css
/* ---- Note card actions ---- */
.contact-card:hover .note-card-actions {
  opacity: 1;
}
```

- [ ] **Step 3: Verify**

Run: `cd webmail-frontend && npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 4: Commit**

```bash
git add webmail-frontend/src/notes/NotesSidebar.tsx webmail-frontend/src/notes/NotesGrid.tsx webmail-frontend/src/index.css
git commit -m "feat: add archive support to notes sidebar and cards

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 9: Reminder Picker

**Files:**
- Create: `webmail-frontend/src/notes/components/ReminderPicker.tsx`
- Modify: `webmail-frontend/src/notes/components/NoteEditorModal.tsx` (add ReminderPicker to header)

**Interfaces:**
- Consumes: `fetchNoteReminder`, `saveNoteReminder`, `deleteNoteReminder` from API, note `id`
- Produces: `ReminderPicker` component

- [ ] **Step 1: Create ReminderPicker component**

Create `webmail-frontend/src/notes/components/ReminderPicker.tsx`:

```typescript
import React, { useState, useEffect, useCallback } from 'react';
import { Clock, X } from 'lucide-react';
import { fetchNoteReminder, saveNoteReminder, deleteNoteReminder } from '../../shared/api';

interface ReminderPickerProps {
  noteId: string | undefined;
}

export function ReminderPicker({ noteId }: ReminderPickerProps) {
  const [remindAt, setRemindAt] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!noteId || noteId === 'new') return;
    fetchNoteReminder(noteId).then((r) => {
      if (r) setRemindAt(r.remind_at);
    }).catch(() => {});
  }, [noteId]);

  const handleSet = useCallback(async (datetime: string) => {
    if (!noteId || noteId === 'new') return;
    setLoading(true);
    try {
      await saveNoteReminder(noteId, datetime);
      setRemindAt(datetime);
      setIsOpen(false);
    } catch (e) {
      console.error('Failed to set reminder', e);
    }
    setLoading(false);
  }, [noteId]);

  const handleClear = useCallback(async () => {
    if (!noteId || noteId === 'new') return;
    setLoading(true);
    try {
      await deleteNoteReminder(noteId);
      setRemindAt(null);
      setIsOpen(false);
    } catch (e) {
      console.error('Failed to clear reminder', e);
    }
    setLoading(false);
  }, [noteId]);

  // Format date for display
  const formatted = remindAt
    ? new Date(remindAt).toLocaleString(undefined, {
        month: 'short', day: 'numeric',
        hour: 'numeric', minute: '2-digit'
      })
    : null;

  // For new notes, show disabled state
  if (!noteId || noteId === 'new') {
    return (
      <button className="btn btn-ghost btn-sm" disabled title="Save note first to set a reminder">
        <Clock size={16} style={{ opacity: 0.4 }} />
      </button>
    );
  }

  return (
    <div style={{ position: 'relative' }}>
      <button
        className={`btn btn-ghost btn-sm ${remindAt ? 'has-reminder' : ''}`}
        onClick={() => setIsOpen(!isOpen)}
        title={formatted || 'Set reminder'}
        style={{ color: remindAt ? 'var(--accent-primary)' : undefined }}
      >
        <Clock size={16} />
        {formatted && (
          <span style={{ fontSize: '0.7rem', marginLeft: 4 }}>{formatted}</span>
        )}
      </button>
      {isOpen && (
        <div className="reminder-popover" style={{
          position: 'absolute', top: '100%', left: 0, zIndex: 10,
          background: 'var(--bg-secondary)', border: '1px solid var(--border-glass)',
          borderRadius: 'var(--radius-md)', padding: 12, minWidth: 240,
          boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
        }}>
          <div style={{ fontSize: '0.85rem', fontWeight: 600, marginBottom: 8 }}>Set reminder</div>
          <input
            type="datetime-local"
            className="glass-input"
            value={remindAt ? remindAt.slice(0, 16) : ''}
            onChange={(e) => handleSet(new Date(e.target.value).toISOString())}
            style={{ width: '100%', marginBottom: 8, fontSize: '0.85rem' }}
            disabled={loading}
          />
          {remindAt && (
            <button
              className="btn btn-ghost btn-xs"
              onClick={handleClear}
              disabled={loading}
              style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}
            >
              <X size={12} /> Clear reminder
            </button>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add ReminderPicker to NoteEditorModal**

In `webmail-frontend/src/notes/components/NoteEditorModal.tsx`:

Add import:
```typescript
import { ReminderPicker } from './ReminderPicker';
```

In the modal header, add the ReminderPicker next to the close button. Replace the header section:

```tsx
        <div className="note-modal-header">
          <input
            ref={titleRef}
            type="text"
            className="note-modal-title"
            placeholder="Note title..."
            value={note.title || ''}
            onChange={handleTitleChange}
          />
          <ReminderPicker noteId={note.id} />
          <div className="note-modal-actions">
            <button className="btn btn-ghost btn-sm" onClick={handleClose} title="Close">
              <X size={18} />
            </button>
          </div>
        </div>
```

- [ ] **Step 3: Verify TypeScript compilation**

Run: `cd webmail-frontend && npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 4: Commit**

```bash
git add webmail-frontend/src/notes/components/ReminderPicker.tsx webmail-frontend/src/notes/components/NoteEditorModal.tsx
git commit -m "feat: add reminder/date picker to note editor

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 10: File Attachments UI

**Files:**
- Create: `webmail-frontend/src/notes/components/AttachmentList.tsx`
- Modify: `webmail-frontend/src/notes/components/NoteEditorModal.tsx` (add AttachmentList below editor)
- Modify: `webmail-frontend/src/index.css` (append attachment styles)

**Interfaces:**
- Consumes: `fetchNoteAttachments`, `uploadNoteAttachment`, `deleteNoteAttachment` from API, `NoteAttachment` type, note `id`
- Produces: `AttachmentList` component

- [ ] **Step 1: Create AttachmentList component**

Create `webmail-frontend/src/notes/components/AttachmentList.tsx`:

```typescript
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Paperclip, X, FileText, Image, Download } from 'lucide-react';
import { fetchNoteAttachments, uploadNoteAttachment, deleteNoteAttachment } from '../../shared/api';
import type { NoteAttachment } from '../../shared/types';

interface AttachmentListProps {
  noteId: string | undefined;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isImage(mimeType: string): boolean {
  return mimeType.startsWith('image/');
}

export function AttachmentList({ noteId }: AttachmentListProps) {
  const [attachments, setAttachments] = useState<NoteAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!noteId || noteId === 'new') return;
    fetchNoteAttachments(noteId).then(setAttachments).catch(() => {});
  }, [noteId]);

  const handleUpload = useCallback(async (file: File) => {
    if (!noteId || noteId === 'new') return;
    setUploading(true);
    try {
      const attachment = await uploadNoteAttachment(noteId, file);
      setAttachments((prev) => [...prev, attachment]);
    } catch (e) {
      console.error('Upload failed', e);
    }
    setUploading(false);
  }, [noteId]);

  const handleDelete = useCallback(async (attachmentId: string) => {
    if (!noteId) return;
    try {
      await deleteNoteAttachment(noteId, attachmentId);
      setAttachments((prev) => prev.filter((a) => a.id !== attachmentId));
    } catch (e) {
      console.error('Delete failed', e);
    }
  }, [noteId]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    files.forEach(handleUpload);
  }, [handleUpload]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragOver(false);
  }, []);

  // Don't render for new notes
  if (!noteId || noteId === 'new') {
    return null;
  }

  return (
    <div className="attachment-section">
      <div className="attachment-header">
        <Paperclip size={14} />
        <span style={{ fontSize: '0.8rem', fontWeight: 600 }}>Attachments</span>
        <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
          {attachments.length > 0 && `(${attachments.length})`}
        </span>
        <button
          className="btn btn-ghost btn-xs"
          onClick={() => fileRef.current?.click()}
          disabled={uploading}
          style={{ marginLeft: 'auto', fontSize: '0.75rem' }}
        >
          {uploading ? 'Uploading...' : '+ Add'}
        </button>
        <input
          ref={fileRef}
          type="file"
          style={{ display: 'none' }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleUpload(file);
            e.target.value = '';
          }}
        />
      </div>
      <div
        className={`attachment-dropzone ${isDragOver ? 'drag-over' : ''}`}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
      >
        {attachments.length === 0 && !uploading && (
          <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)',
            textAlign: 'center', padding: '8px 0' }}>
            Drop files here or click "+ Add"
          </div>
        )}
        {attachments.map((att) => (
          <div key={att.id} className="attachment-item">
            {isImage(att.mime_type) ? (
              <Image size={16} />
            ) : (
              <FileText size={16} />
            )}
            <a
              href={`/uploads/${att.storage_path}`}
              target="_blank"
              rel="noopener noreferrer"
              className="attachment-name"
              style={{ flex: 1, fontSize: '0.8rem', overflow: 'hidden',
                textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                color: 'var(--text-primary)', textDecoration: 'none' }}
              title={att.filename}
            >
              {att.filename}
            </a>
            <span style={{ fontSize: '0.7rem', color: 'var(--text-secondary)' }}>
              {formatSize(att.size_bytes)}
            </span>
            <button
              className="btn btn-ghost btn-xs"
              onClick={() => handleDelete(att.id)}
              title="Remove attachment"
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add AttachmentList to NoteEditorModal**

In `webmail-frontend/src/notes/components/NoteEditorModal.tsx`:

Add import:
```typescript
import { AttachmentList } from './AttachmentList';
```

Add the AttachmentList after the editor div, inside the modal. The JSX should be:

```tsx
        <div className="note-modal-editor">
          <LiveNoteEditor
            noteId={note.id || 'new'}
            initialContent={note.content || ''}
            onChange={handleContentChange}
          />
        </div>
        <AttachmentList noteId={note.id} />
```

- [ ] **Step 3: Add attachment CSS to index.css**

Append to `webmail-frontend/src/index.css`:

```css
/* ---- Attachments ---- */
.attachment-section {
  border-top: 1px solid var(--border-glass);
  padding: 8px 16px;
  max-height: 160px;
  overflow-y: auto;
}

.attachment-header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
}

.attachment-dropzone {
  border: 2px dashed transparent;
  border-radius: var(--radius-sm);
  transition: border-color 0.15s;
}

.attachment-dropzone.drag-over {
  border-color: var(--accent-primary);
  background: rgba(59, 130, 246, 0.05);
}

.attachment-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 4px 8px;
  border-radius: var(--radius-sm);
}

.attachment-item:hover {
  background: var(--bg-hover);
}
```

- [ ] **Step 4: Verify TypeScript compilation**

Run: `cd webmail-frontend && npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 5: Commit**

```bash
git add webmail-frontend/src/notes/components/AttachmentList.tsx webmail-frontend/src/notes/components/NoteEditorModal.tsx webmail-frontend/src/index.css
git commit -m "feat: add file attachment support to note editor

Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 11: Final Integration Verification

**Files:**
- None modified — verification only

- [ ] **Step 1: Build frontend**

Run: `cd webmail-frontend && npm run build`
Expected: Successful build with no errors.

- [ ] **Step 2: Build backend**

Run: `cd webmail-backend && npm run build`
Expected: Successful TypeScript compilation.

- [ ] **Step 3: Run backend tests**

Run: `cd webmail-backend && npm test`
Expected: All tests pass.

- [ ] **Step 4: Start the app and manually verify**

Run the app (use project's run skill or start command) and verify:
1. Click "+ New Note" → modal opens with full editor toolbar
2. Checklists: Click checklist button, type items, check/uncheck
3. Image: Paste or upload image → appears inline
4. Code block: Click code button → dark code block appears
5. Table: Click table button → 3x3 table inserts
6. Undo/Redo: Use undo/redo buttons, verify state
7. Sort: Change sort dropdown → grid reorders
8. Archive: Archive a note → appears in Archive view, hidden from All
9. Reminder: Set a reminder on a saved note → persists on reopen
10. Attachments: Upload a file → appears in list, can download/delete

- [ ] **Step 5: Final commit (if any fixes needed)**

Any fixes from manual verification go here.
