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
exports.NoteConflictError = exports.NoteValidationError = exports.NOTE_LABELS_MAX_COUNT = exports.NOTE_LABELS_MAX_BYTES = exports.NOTE_CONTENT_MAX_BYTES = exports.NOTE_TITLE_MAX_BYTES = void 0;
exports.noteValidationErrorBody = noteValidationErrorBody;
exports.validateNoteFields = validateNoteFields;
exports.ensureNotesSchema = ensureNotesSchema;
exports.listNotes = listNotes;
exports.getNote = getNote;
exports.saveNote = saveNote;
exports.deleteNote = deleteNote;
exports.deleteNoteIfRevisionMatches = deleteNoteIfRevisionMatches;
exports.hardDeleteNote = hardDeleteNote;
exports.ensureRemindersSchema = ensureRemindersSchema;
exports.getNoteReminder = getNoteReminder;
exports.saveNoteReminder = saveNoteReminder;
exports.deleteNoteReminder = deleteNoteReminder;
exports.ensureAttachmentsSchema = ensureAttachmentsSchema;
exports.listNoteAttachments = listNoteAttachments;
exports.saveNoteAttachment = saveNoteAttachment;
exports.deleteNoteAttachment = deleteNoteAttachment;
exports.listNotesWithReminders = listNotesWithReminders;
exports.getNotesSyncToken = getNotesSyncToken;
const db_1 = require("./db");
const crypto = __importStar(require("crypto"));
// Product/API limits are measured in UTF-8 bytes so MariaDB and IMAP behavior
// stays consistent for ASCII and multi-byte text.
exports.NOTE_TITLE_MAX_BYTES = 4 * 1024;
exports.NOTE_CONTENT_MAX_BYTES = 4 * 1024 * 1024;
exports.NOTE_LABELS_MAX_BYTES = 32 * 1024;
exports.NOTE_LABELS_MAX_COUNT = 100;
class NoteValidationError extends Error {
    statusCode;
    code;
    field;
    limitBytes;
    constructor(field, message, statusCode = 400, limitBytes) {
        super(message);
        this.name = 'NoteValidationError';
        this.statusCode = statusCode;
        this.code = statusCode === 413 ? 'NOTE_FIELD_TOO_LARGE' : 'NOTE_FIELD_INVALID';
        this.field = field;
        this.limitBytes = limitBytes;
    }
}
exports.NoteValidationError = NoteValidationError;
function noteValidationErrorBody(error) {
    return {
        success: false,
        error: error.message,
        code: error.code,
        field: error.field,
        ...(error.limitBytes === undefined ? {} : { limit_bytes: error.limitBytes }),
    };
}
function validatedNoteText(value, field, fallback, maxBytes) {
    if (value === undefined)
        return fallback;
    if (typeof value !== 'string') {
        throw new NoteValidationError(field, `${field} must be a string`);
    }
    if (Buffer.byteLength(value, 'utf8') > maxBytes) {
        throw new NoteValidationError(field, `${field} exceeds the ${maxBytes}-byte UTF-8 limit`, 413, maxBytes);
    }
    return value;
}
function validatedNoteLabels(value) {
    if (value === undefined)
        return '[]';
    if (typeof value !== 'string') {
        throw new NoteValidationError('labels_json', 'labels_json must be a JSON string');
    }
    if (Buffer.byteLength(value, 'utf8') > exports.NOTE_LABELS_MAX_BYTES) {
        throw new NoteValidationError('labels_json', `labels_json exceeds the ${exports.NOTE_LABELS_MAX_BYTES}-byte UTF-8 limit`, 413, exports.NOTE_LABELS_MAX_BYTES);
    }
    let labels;
    try {
        labels = JSON.parse(value);
    }
    catch {
        throw new NoteValidationError('labels_json', 'labels_json must contain a JSON array');
    }
    if (!Array.isArray(labels)) {
        throw new NoteValidationError('labels_json', 'labels_json must contain a JSON array');
    }
    if (labels.length > exports.NOTE_LABELS_MAX_COUNT) {
        throw new NoteValidationError('labels_json', `labels_json cannot contain more than ${exports.NOTE_LABELS_MAX_COUNT} label IDs`);
    }
    if (!labels.every(label => typeof label === 'string' || Number.isSafeInteger(label))) {
        throw new NoteValidationError('labels_json', 'labels_json must contain only string or integer label IDs');
    }
    return value;
}
function validateNoteFields(input) {
    return {
        title: validatedNoteText(input.title, 'title', '', exports.NOTE_TITLE_MAX_BYTES),
        content: validatedNoteText(input.content, 'content', '', exports.NOTE_CONTENT_MAX_BYTES),
        labels_json: validatedNoteLabels(input.labels_json),
    };
}
class NoteConflictError extends Error {
    constructor() {
        super('This note changed in another session. Review the latest version before saving again.');
    }
}
exports.NoteConflictError = NoteConflictError;
function noteContentMatches(note, expected) {
    return note.title === expected.title
        && note.content === expected.content
        && note.color === expected.color
        && Number(note.is_pinned) === expected.is_pinned
        && Number(note.is_locked) === expected.is_locked
        && note.folder === expected.folder
        && note.labels_json === expected.labels_json;
}
let notesSchemaPromise = null;
const compatibleNoteColumnTypes = {
    id: /^varchar\(255\)$/,
    owner: /^varchar\(255\)$/,
    title: /^(?:text|mediumtext|longtext)$/,
    content: /^(?:mediumtext|longtext)$/,
    color: /^varchar\(50\)$/,
    is_pinned: /^tinyint(?:\(\d+\))?(?: unsigned)?$/,
    is_locked: /^tinyint(?:\(\d+\))?(?: unsigned)?$/,
    folder: /^varchar\(100\)$/,
    labels_json: /^(?:text|mediumtext|longtext)$/,
    sync_token: /^bigint(?:\(\d+\))?(?: unsigned)?$/,
    imap_sync_token: /^bigint(?:\(\d+\))?(?: unsigned)?$/,
    imap_uid: /^int(?:\(\d+\))?(?: unsigned)?$/,
    imap_msgid: /^varchar\(255\)$/,
    is_deleted: /^tinyint(?:\(\d+\))?(?: unsigned)?$/,
    created_at: /^timestamp(?:\(\d+\))?$/,
    updated_at: /^timestamp(?:\(\d+\))?$/,
};
async function ensureNotesSchema() {
    if (!notesSchemaPromise) {
        notesSchemaPromise = (async () => {
            await db_1.pool.query(`
                CREATE TABLE IF NOT EXISTS notes (
                    id VARCHAR(255) PRIMARY KEY,
                    owner VARCHAR(255) NOT NULL,
                    title TEXT,
                    content MEDIUMTEXT,
                    color VARCHAR(50),
                    is_pinned TINYINT(1) NOT NULL DEFAULT 0,
                    is_locked TINYINT(1) NOT NULL DEFAULT 0,
                    folder VARCHAR(100) NOT NULL DEFAULT 'notes',
                    labels_json TEXT,
                    sync_token BIGINT NOT NULL DEFAULT 1,
                    imap_sync_token BIGINT NOT NULL DEFAULT 0,
                    imap_uid INT DEFAULT NULL,
                    imap_msgid VARCHAR(255) DEFAULT NULL,
                    is_deleted TINYINT(1) NOT NULL DEFAULT 0,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    INDEX (owner)
                )
            `);
            const [columns] = await db_1.pool.query('SHOW COLUMNS FROM notes');
            const columnNames = new Set(columns.map(column => String(column.Field)));
            const extensionColumns = [
                ['is_pinned', 'TINYINT(1) NOT NULL DEFAULT 0'],
                ['is_locked', 'TINYINT(1) NOT NULL DEFAULT 0'],
                ['folder', "VARCHAR(100) NOT NULL DEFAULT 'notes'"],
                ['labels_json', 'TEXT'],
                ['sync_token', 'BIGINT NOT NULL DEFAULT 1'],
                ['imap_sync_token', 'BIGINT NOT NULL DEFAULT 0'],
                ['imap_uid', 'INT DEFAULT NULL'],
                ['imap_msgid', 'VARCHAR(255) DEFAULT NULL'],
                ['is_deleted', 'TINYINT(1) NOT NULL DEFAULT 0'],
            ];
            for (const [name, definition] of extensionColumns) {
                if (!columnNames.has(name)) {
                    await db_1.pool.query(`ALTER TABLE notes ADD COLUMN ${name} ${definition}`);
                }
            }
            const contentColumn = columns.find(column => String(column.Field) === 'content');
            if (String(contentColumn?.Type || '').toLowerCase() === 'text') {
                await db_1.pool.query('ALTER TABLE notes MODIFY COLUMN content MEDIUMTEXT NULL');
            }
            let [verifiedColumns] = await db_1.pool.query('SHOW COLUMNS FROM notes');
            let verifiedNames = new Set(verifiedColumns.map(column => String(column.Field)));
            const requiredColumns = [
                'id', 'owner', 'title', 'content', 'color', 'is_pinned', 'is_locked', 'folder',
                'labels_json', 'sync_token', 'imap_sync_token', 'imap_uid', 'imap_msgid',
                'is_deleted', 'created_at', 'updated_at',
            ];
            const missingColumns = requiredColumns.filter(column => !verifiedNames.has(column));
            if (missingColumns.length > 0) {
                throw new Error(`Notes schema is missing required columns: ${missingColumns.join(', ')}`);
            }
            let verifiedByName = new Map(verifiedColumns.map(column => [String(column.Field), column]));
            const revisionInvariants = [
                { name: 'is_pinned', definition: 'TINYINT(1) NOT NULL DEFAULT 0', fallback: '0', expectedDefault: '0' },
                { name: 'is_locked', definition: 'TINYINT(1) NOT NULL DEFAULT 0', fallback: '0', expectedDefault: '0' },
                { name: 'folder', definition: "VARCHAR(100) NOT NULL DEFAULT 'notes'", fallback: "'notes'", expectedDefault: 'notes' },
                { name: 'sync_token', definition: 'BIGINT NOT NULL DEFAULT 1', fallback: '1', expectedDefault: '1' },
                { name: 'imap_sync_token', definition: 'BIGINT NOT NULL DEFAULT 0', fallback: '0', expectedDefault: '0' },
                { name: 'is_deleted', definition: 'TINYINT(1) NOT NULL DEFAULT 0', fallback: '0', expectedDefault: '0' },
            ];
            let invariantsMigrated = false;
            for (const invariant of revisionInvariants) {
                const column = verifiedByName.get(invariant.name);
                const defaultValue = String(column?.Default ?? '').replace(/^'(.*)'$/, '$1');
                if (String(column?.Null || '').toUpperCase() === 'NO'
                    && defaultValue === invariant.expectedDefault)
                    continue;
                await db_1.pool.query(`UPDATE notes SET ${invariant.name} = ${invariant.fallback} WHERE ${invariant.name} IS NULL`);
                await db_1.pool.query(`ALTER TABLE notes MODIFY COLUMN ${invariant.name} ${invariant.definition}`);
                invariantsMigrated = true;
            }
            if (invariantsMigrated) {
                [verifiedColumns] = await db_1.pool.query('SHOW COLUMNS FROM notes');
                verifiedNames = new Set(verifiedColumns.map((column) => String(column.Field)));
                verifiedByName = new Map(verifiedColumns.map((column) => [String(column.Field), column]));
            }
            for (const [name, acceptedType] of Object.entries(compatibleNoteColumnTypes)) {
                const actualType = String(verifiedByName.get(name)?.Type || '').trim().toLowerCase();
                if (!acceptedType.test(actualType)) {
                    throw new Error(`Notes schema column ${name} has incompatible type ${actualType || '(missing)'}`);
                }
            }
            for (const invariant of revisionInvariants) {
                const column = verifiedByName.get(invariant.name);
                const defaultValue = String(column?.Default ?? '').replace(/^'(.*)'$/, '$1');
                if (String(column?.Null || '').toUpperCase() !== 'NO'
                    || defaultValue !== invariant.expectedDefault) {
                    throw new Error(`Notes schema column ${invariant.name} does not enforce its revision invariant`);
                }
            }
        })().catch(error => {
            notesSchemaPromise = null;
            throw error;
        });
    }
    return notesSchemaPromise;
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
    const { title, content, labels_json } = validateNoteFields(note);
    const color = note.color || '#ffffff';
    const is_pinned = note.is_pinned ? 1 : 0;
    const is_locked = note.is_locked ? 1 : 0;
    const folder = note.folder || 'notes';
    const expectedContent = { title, content, color, is_pinned, is_locked, folder, labels_json };
    // Check if exists
    const existing = await getNote(id, note.owner);
    if (note.expected_sync_token !== undefined) {
        const expectedSyncToken = Number(note.expected_sync_token);
        if (!Number.isSafeInteger(expectedSyncToken) || expectedSyncToken < 1 || !existing) {
            throw new NoteConflictError();
        }
        if (Number(existing.sync_token) !== expectedSyncToken) {
            if (noteContentMatches(existing, expectedContent))
                return existing;
            throw new NoteConflictError();
        }
    }
    if (existing
        && note.imap_uid === undefined
        && note.imap_msgid === undefined
        && noteContentMatches(existing, expectedContent)) {
        return existing;
    }
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
        if (note.expected_sync_token !== undefined) {
            updateQuery += ' AND sync_token = ?';
            queryParams.push(Number(note.expected_sync_token));
        }
        const [updateResult] = await db_1.pool.query(updateQuery, queryParams);
        if (note.expected_sync_token !== undefined && updateResult.affectedRows === 0) {
            const current = await getNote(id, note.owner);
            if (current && noteContentMatches(current, expectedContent))
                return current;
            throw new NoteConflictError();
        }
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
async function cleanupDeletedNoteDependents(id, owner) {
    try {
        await db_1.pool.query('DELETE FROM note_reminders WHERE note_id = ?', [id]);
        // Delete attachment files from disk before removing DB records
        const [attachments] = await db_1.pool.query(`SELECT a.storage_path FROM note_attachments a
             JOIN notes n ON n.id = a.note_id
             WHERE a.note_id = ? AND n.owner = ?`, [id, owner]);
        if (attachments && attachments.length > 0) {
            const path = require('path');
            const fs = require('fs');
            for (const att of attachments) {
                try {
                    const filePath = path.join(__dirname, '..', 'uploads', att.storage_path);
                    if (fs.existsSync(filePath))
                        fs.unlinkSync(filePath);
                }
                catch { }
            }
        }
        await db_1.pool.query('DELETE a FROM note_attachments a JOIN notes n ON n.id = a.note_id WHERE a.note_id = ? AND n.owner = ?', [id, owner]);
    }
    catch (e) {
        console.error('deleteNote: failed to clean up reminders/attachments', e);
    }
}
function emitNoteDeleted(id, owner) {
    try {
        const { io } = require('./index');
        io.to(owner).emit('note_deleted', { noteId: id });
    }
    catch (e) { }
}
async function deleteNote(id, owner) {
    const [result] = await db_1.pool.query('UPDATE notes SET is_deleted = 1, sync_token = sync_token + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND owner = ? AND is_deleted = 0', [id, owner]);
    if (result.affectedRows === 0)
        return;
    await cleanupDeletedNoteDependents(id, owner);
    emitNoteDeleted(id, owner);
}
async function deleteNoteIfRevisionMatches(id, owner, expectedSyncToken, expectedImapUid) {
    const syncToken = Number(expectedSyncToken);
    const imapUid = Number(expectedImapUid);
    if (!Number.isSafeInteger(syncToken) || syncToken < 1 || !Number.isSafeInteger(imapUid) || imapUid < 1) {
        return false;
    }
    const [result] = await db_1.pool.query(`UPDATE notes
         SET is_deleted = 1,
             sync_token = sync_token + 1,
             imap_sync_token = imap_sync_token + 1,
             imap_uid = NULL,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND owner = ?
           AND sync_token = ? AND imap_sync_token = ?
           AND imap_uid = ? AND is_deleted = 0`, [id, owner, syncToken, syncToken, imapUid]);
    if (result.affectedRows === 0)
        return false;
    await cleanupDeletedNoteDependents(id, owner);
    emitNoteDeleted(id, owner);
    return true;
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