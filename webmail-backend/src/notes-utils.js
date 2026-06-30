"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureNotesSchema = ensureNotesSchema;
exports.listNotes = listNotes;
exports.getNote = getNote;
exports.saveNote = saveNote;
exports.deleteNote = deleteNote;
exports.hardDeleteNote = hardDeleteNote;
exports.ensureRemindersSchema = ensureRemindersSchema;
exports.getNoteReminder = getNoteReminder;
exports.saveNoteReminder = saveNoteReminder;
exports.deleteNoteReminder = deleteNoteReminder;
exports.ensureAttachmentsSchema = ensureAttachmentsSchema;
exports.listNoteAttachments = listNoteAttachments;
exports.saveNoteAttachment = saveNoteAttachment;
exports.deleteNoteAttachment = deleteNoteAttachment;
exports.ensureAllNotesSchemas = ensureAllNotesSchemas;
exports.listNotesWithReminders = listNotesWithReminders;
exports.getNotesSyncToken = getNotesSyncToken;
const db_1 = require("./db");
const crypto = __importStar(require("crypto"));
async function ensureNotesSchema() {
    await db_1.pool.query(`
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
        await db_1.pool.query("ALTER TABLE notes ADD COLUMN is_pinned TINYINT(1) DEFAULT 0");
        await db_1.pool.query("ALTER TABLE notes ADD COLUMN is_locked TINYINT(1) DEFAULT 0");
        await db_1.pool.query("ALTER TABLE notes ADD COLUMN folder VARCHAR(100) DEFAULT 'notes'");
        await db_1.pool.query("ALTER TABLE notes ADD COLUMN labels_json TEXT");
    }
    catch (e) { }
    try {
        await db_1.pool.query("ALTER TABLE notes ADD COLUMN sync_token BIGINT NOT NULL DEFAULT 1");
    }
    catch (e) { }
    try {
        await db_1.pool.query("ALTER TABLE notes ADD COLUMN imap_sync_token BIGINT NOT NULL DEFAULT 0");
    }
    catch (e) { }
    try {
        await db_1.pool.query("ALTER TABLE notes ADD COLUMN is_deleted TINYINT(1) DEFAULT 0");
    }
    catch (e) { }
}
async function listNotes(owner, includeDeleted = false) {
    const query = includeDeleted
        ? 'SELECT * FROM notes WHERE owner = ? ORDER BY updated_at DESC'
        : 'SELECT * FROM notes WHERE owner = ? AND is_deleted = 0 ORDER BY updated_at DESC';
    const [results] = await db_1.pool.query(query, [owner]);
    return results;
}
async function getNote(id, owner, includeDeleted = false) {
    const query = includeDeleted
        ? 'SELECT * FROM notes WHERE id = ? AND owner = ?'
        : 'SELECT * FROM notes WHERE id = ? AND owner = ? AND is_deleted = 0';
    const [results] = await db_1.pool.query(query, [id, owner]);
    return results.length > 0 ? results[0] : null;
}
async function saveNote(note) {
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
        await db_1.pool.query(updateQuery, queryParams);
    }
    else {
        await db_1.pool.query('INSERT INTO notes (id, owner, title, content, color, is_pinned, is_locked, folder, labels_json, sync_token, imap_uid, imap_msgid) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)', [id, note.owner, title, content, color, is_pinned, is_locked, folder, labels_json, note.imap_uid || null, note.imap_msgid || null]);
    }
    const saved = await getNote(id, note.owner);
    try {
        const { io } = require('./index');
        io.to(note.owner).emit('note_updated', { noteId: id });
    }
    catch (e) { }
    return saved;
}
async function deleteNote(id, owner) {
    await db_1.pool.query('UPDATE notes SET is_deleted = 1, sync_token = sync_token + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND owner = ?', [id, owner]);
    try {
        const { io } = require('./index');
        io.to(owner).emit('note_deleted', { noteId: id });
    }
    catch (e) { }
}
async function hardDeleteNote(id, owner) {
    await db_1.pool.query('DELETE FROM notes WHERE id = ? AND owner = ?', [id, owner]);
}
async function ensureRemindersSchema() {
    await db_1.pool.query(`
        CREATE TABLE IF NOT EXISTS note_reminders (
            note_id VARCHAR(255) PRIMARY KEY,
            remind_at DATETIME NOT NULL,
            notified TINYINT(1) DEFAULT 0,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE
        )
    `);
}
async function getNoteReminder(noteId, owner) {
    const [results] = await db_1.pool.query(`SELECT r.* FROM note_reminders r
         JOIN notes n ON n.id = r.note_id
         WHERE r.note_id = ? AND n.owner = ?`, [noteId, owner]);
    return results.length > 0 ? results[0] : null;
}
async function saveNoteReminder(noteId, remindAt, owner) {
    const note = await getNote(noteId, owner);
    if (!note)
        throw new Error('Note not found');
    await db_1.pool.query('INSERT INTO note_reminders (note_id, remind_at) VALUES (?, ?) ON DUPLICATE KEY UPDATE remind_at = VALUES(remind_at), notified = 0', [noteId, remindAt]);
}
async function deleteNoteReminder(noteId, owner) {
    await db_1.pool.query(`DELETE r FROM note_reminders r
         JOIN notes n ON n.id = r.note_id
         WHERE r.note_id = ? AND n.owner = ?`, [noteId, owner]);
}
async function ensureAttachmentsSchema() {
    await db_1.pool.query(`
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
async function listNoteAttachments(noteId, owner) {
    const [results] = await db_1.pool.query(`SELECT a.* FROM note_attachments a
         JOIN notes n ON n.id = a.note_id
         WHERE a.note_id = ? AND n.owner = ?
         ORDER BY a.created_at ASC`, [noteId, owner]);
    return results;
}
async function saveNoteAttachment(attachment, owner) {
    const note = await getNote(attachment.note_id, owner);
    if (!note)
        throw new Error('Note not found');
    await db_1.pool.query('INSERT INTO note_attachments (id, note_id, filename, mime_type, size_bytes, storage_path) VALUES (?, ?, ?, ?, ?, ?)', [attachment.id, attachment.note_id, attachment.filename, attachment.mime_type, attachment.size_bytes, attachment.storage_path]);
}
async function deleteNoteAttachment(attachmentId, owner) {
    const [results] = await db_1.pool.query(`SELECT a.* FROM note_attachments a
         JOIN notes n ON n.id = a.note_id
         WHERE a.id = ? AND n.owner = ?`, [attachmentId, owner]);
    if (results.length === 0)
        return null;
    await db_1.pool.query('DELETE FROM note_attachments WHERE id = ?', [attachmentId]);
    return results[0];
}
// ---- Schema migration helper ----
async function ensureAllNotesSchemas() {
    await ensureNotesSchema();
    await ensureRemindersSchema();
    await ensureAttachmentsSchema();
}
// ---- Extended listNotes with reminders ----
async function listNotesWithReminders(owner) {
    const [results] = await db_1.pool.query(`SELECT n.*, r.remind_at
         FROM notes n
         LEFT JOIN note_reminders r ON n.id = r.note_id
         WHERE n.owner = ? AND n.is_deleted = 0
         ORDER BY n.updated_at DESC`, [owner]);
    return results;
}
async function getNotesSyncToken(owner) {
    const [results] = await db_1.pool.query('SELECT MAX(sync_token) as max_token FROM notes WHERE owner = ?', [owner]);
    return results[0]?.max_token || 1;
}
//# sourceMappingURL=notes-utils.js.map