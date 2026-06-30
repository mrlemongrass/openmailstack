import { pool } from './db';
import * as crypto from 'crypto';

export interface NoteRow {
    id: string;
    owner: string;
    title: string;
    content: string;
    color: string;
    is_pinned: number;
    is_locked: number;
    folder: string;
    labels_json: string;
    sync_token: number;
    imap_sync_token: number;
    is_deleted: number;
    created_at: string;
    updated_at: string;
}

export async function ensureNotesSchema(): Promise<void> {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS notes (
            id VARCHAR(255) PRIMARY KEY,
            owner VARCHAR(255) NOT NULL,
            title TEXT,
            content TEXT,
            color VARCHAR(50),
            is_pinned TINYINT(1) DEFAULT 0,
            is_locked TINYINT(1) DEFAULT 0,
            folder VARCHAR(100) DEFAULT 'notes',
            labels_json TEXT,
            sync_token BIGINT NOT NULL DEFAULT 1,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            INDEX (owner)
        )
    `);
    
    // Attempt to add new columns to existing table
    try {
        await pool.query("ALTER TABLE notes ADD COLUMN is_pinned TINYINT(1) DEFAULT 0");
        await pool.query("ALTER TABLE notes ADD COLUMN is_locked TINYINT(1) DEFAULT 0");
        await pool.query("ALTER TABLE notes ADD COLUMN folder VARCHAR(100) DEFAULT 'notes'");
        await pool.query("ALTER TABLE notes ADD COLUMN labels_json TEXT");
    } catch (e) { }
    try {
        await pool.query("ALTER TABLE notes ADD COLUMN sync_token BIGINT NOT NULL DEFAULT 1");
    } catch (e) { }
    try {
        await pool.query("ALTER TABLE notes ADD COLUMN imap_sync_token BIGINT NOT NULL DEFAULT 0");
    } catch (e) { }
    try {
        await pool.query("ALTER TABLE notes ADD COLUMN is_deleted TINYINT(1) DEFAULT 0");
    } catch (e) { }
}

export async function listNotes(owner: string, includeDeleted = false): Promise<NoteRow[]> {
    const query = includeDeleted 
        ? 'SELECT * FROM notes WHERE owner = ? ORDER BY updated_at DESC' 
        : 'SELECT * FROM notes WHERE owner = ? AND is_deleted = 0 ORDER BY updated_at DESC';
    const [results]: any = await pool.query(query, [owner]);
    return results as NoteRow[];
}

export async function getNote(id: string, owner: string, includeDeleted = false): Promise<NoteRow | null> {
    const query = includeDeleted 
        ? 'SELECT * FROM notes WHERE id = ? AND owner = ?' 
        : 'SELECT * FROM notes WHERE id = ? AND owner = ? AND is_deleted = 0';
    const [results]: any = await pool.query(query, [id, owner]);
    return results.length > 0 ? results[0] : null;
}

export async function saveNote(note: Partial<NoteRow> & { owner: string, imap_uid?: number, imap_msgid?: string }): Promise<NoteRow> {
    const id = note.id || crypto.randomUUID();
    const title = note.title || '';
    const content = note.content || '';
    const color = note.color || '#ffffff';
    const is_pinned = note.is_pinned ? 1 : 0;
    const is_locked = note.is_locked ? 1 : 0;
    const folder = note.folder || 'notes';
    const labels_json = note.labels_json || '[]';
    
    // Check if exists
    const existing = await getNote(id, note.owner);
    if (existing) {
        let updateQuery = 'UPDATE notes SET title = ?, content = ?, color = ?, is_pinned = ?, is_locked = ?, folder = ?, labels_json = ?, sync_token = sync_token + 1, updated_at = CURRENT_TIMESTAMP';
        let queryParams = [title, content, color, is_pinned, is_locked, folder, labels_json];
        
        if (note.imap_uid !== undefined) {
            updateQuery += ', imap_uid = ?';
            queryParams.push(note.imap_uid);
        }
        if (note.imap_msgid !== undefined) {
            updateQuery += ', imap_msgid = ?';
            queryParams.push(note.imap_msgid);
        }
        updateQuery += ' WHERE id = ? AND owner = ?';
        queryParams.push(id, note.owner);
        
        await pool.query(updateQuery, queryParams);
    } else {
        await pool.query(
            'INSERT INTO notes (id, owner, title, content, color, is_pinned, is_locked, folder, labels_json, sync_token, imap_uid, imap_msgid) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)',
            [id, note.owner, title, content, color, is_pinned, is_locked, folder, labels_json, note.imap_uid || null, note.imap_msgid || null]
        );
    }
    
    const saved = await getNote(id, note.owner);
    
    try {
        const { io } = require('./index');
        io.to(note.owner).emit('note_updated', { noteId: id });
    } catch(e) {}
    
    return saved!;
}

export async function deleteNote(id: string, owner: string): Promise<void> {
    await pool.query('UPDATE notes SET is_deleted = 1, sync_token = sync_token + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND owner = ?', [id, owner]);
    try {
        const { io } = require('./index');
        io.to(owner).emit('note_deleted', { noteId: id });
    } catch(e) {}
}

export async function hardDeleteNote(id: string, owner: string): Promise<void> {
    await pool.query('DELETE FROM notes WHERE id = ? AND owner = ?', [id, owner]);
}

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

export async function getNotesSyncToken(owner: string): Promise<number> {
    const [results]: any = await pool.query('SELECT MAX(sync_token) as max_token FROM notes WHERE owner = ?', [owner]);
    return results[0]?.max_token || 1;
}
