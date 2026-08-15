import { pool } from './db';
import * as crypto from 'crypto';

// Product/API limits are measured in UTF-8 bytes so MariaDB and IMAP behavior
// stays consistent for ASCII and multi-byte text.
export const NOTE_TITLE_MAX_BYTES = 4 * 1024;
export const NOTE_CONTENT_MAX_BYTES = 4 * 1024 * 1024;
export const NOTE_LABELS_MAX_BYTES = 32 * 1024;
export const NOTE_LABELS_MAX_COUNT = 100;

export class NoteValidationError extends Error {
    readonly statusCode: 400 | 413;
    readonly code: 'NOTE_FIELD_INVALID' | 'NOTE_FIELD_TOO_LARGE';
    readonly field: 'title' | 'content' | 'labels_json';
    readonly limitBytes?: number;

    constructor(
        field: 'title' | 'content' | 'labels_json',
        message: string,
        statusCode: 400 | 413 = 400,
        limitBytes?: number,
    ) {
        super(message);
        this.name = 'NoteValidationError';
        this.statusCode = statusCode;
        this.code = statusCode === 413 ? 'NOTE_FIELD_TOO_LARGE' : 'NOTE_FIELD_INVALID';
        this.field = field;
        this.limitBytes = limitBytes;
    }
}

export function noteValidationErrorBody(error: NoteValidationError): {
    success: false;
    error: string;
    code: NoteValidationError['code'];
    field: NoteValidationError['field'];
    limit_bytes?: number;
} {
    return {
        success: false,
        error: error.message,
        code: error.code,
        field: error.field,
        ...(error.limitBytes === undefined ? {} : { limit_bytes: error.limitBytes }),
    };
}

function validatedNoteText(
    value: unknown,
    field: 'title' | 'content',
    fallback: string,
    maxBytes: number,
): string {
    if (value === undefined) return fallback;
    if (typeof value !== 'string') {
        throw new NoteValidationError(field, `${field} must be a string`);
    }
    if (Buffer.byteLength(value, 'utf8') > maxBytes) {
        throw new NoteValidationError(
            field,
            `${field} exceeds the ${maxBytes}-byte UTF-8 limit`,
            413,
            maxBytes,
        );
    }
    return value;
}

function validatedNoteLabels(value: unknown): string {
    if (value === undefined) return '[]';
    if (typeof value !== 'string') {
        throw new NoteValidationError('labels_json', 'labels_json must be a JSON string');
    }
    if (Buffer.byteLength(value, 'utf8') > NOTE_LABELS_MAX_BYTES) {
        throw new NoteValidationError(
            'labels_json',
            `labels_json exceeds the ${NOTE_LABELS_MAX_BYTES}-byte UTF-8 limit`,
            413,
            NOTE_LABELS_MAX_BYTES,
        );
    }
    let labels: unknown;
    try {
        labels = JSON.parse(value);
    } catch {
        throw new NoteValidationError('labels_json', 'labels_json must contain a JSON array');
    }
    if (!Array.isArray(labels)) {
        throw new NoteValidationError('labels_json', 'labels_json must contain a JSON array');
    }
    if (labels.length > NOTE_LABELS_MAX_COUNT) {
        throw new NoteValidationError(
            'labels_json',
            `labels_json cannot contain more than ${NOTE_LABELS_MAX_COUNT} label IDs`,
        );
    }
    if (!labels.every(label => typeof label === 'string' || Number.isSafeInteger(label))) {
        throw new NoteValidationError('labels_json', 'labels_json must contain only string or integer label IDs');
    }
    return value;
}

export function validateNoteFields(input: {
    title?: unknown;
    content?: unknown;
    labels_json?: unknown;
}): Pick<NoteRow, 'title' | 'content' | 'labels_json'> {
    return {
        title: validatedNoteText(input.title, 'title', '', NOTE_TITLE_MAX_BYTES),
        content: validatedNoteText(input.content, 'content', '', NOTE_CONTENT_MAX_BYTES),
        labels_json: validatedNoteLabels(input.labels_json),
    };
}

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

export class NoteConflictError extends Error {
    constructor() {
        super('This note changed in another session. Review the latest version before saving again.');
    }
}

function noteContentMatches(
    note: NoteRow,
    expected: {
        title: string;
        content: string;
        color: string;
        is_pinned: number;
        is_locked: number;
        folder: string;
        labels_json: string;
    },
): boolean {
    return note.title === expected.title
        && note.content === expected.content
        && note.color === expected.color
        && Number(note.is_pinned) === expected.is_pinned
        && Number(note.is_locked) === expected.is_locked
        && note.folder === expected.folder
        && note.labels_json === expected.labels_json;
}

let notesSchemaPromise: Promise<void> | null = null;

const compatibleNoteColumnTypes: Record<string, RegExp> = {
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

export async function ensureNotesSchema(): Promise<void> {
    if (!notesSchemaPromise) {
        notesSchemaPromise = (async () => {
            await pool.query(`
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

            const [columns]: any = await pool.query('SHOW COLUMNS FROM notes');
            const columnNames = new Set((columns as any[]).map(column => String(column.Field)));
            const extensionColumns: Array<[string, string]> = [
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
                    await pool.query(`ALTER TABLE notes ADD COLUMN ${name} ${definition}`);
                }
            }

            const contentColumn = (columns as any[]).find(column => String(column.Field) === 'content');
            if (String(contentColumn?.Type || '').toLowerCase() === 'text') {
                await pool.query('ALTER TABLE notes MODIFY COLUMN content MEDIUMTEXT NULL');
            }

            let [verifiedColumns]: any = await pool.query('SHOW COLUMNS FROM notes');
            let verifiedNames = new Set((verifiedColumns as any[]).map(column => String(column.Field)));
            const requiredColumns = [
                'id', 'owner', 'title', 'content', 'color', 'is_pinned', 'is_locked', 'folder',
                'labels_json', 'sync_token', 'imap_sync_token', 'imap_uid', 'imap_msgid',
                'is_deleted', 'created_at', 'updated_at',
            ];
            const missingColumns = requiredColumns.filter(column => !verifiedNames.has(column));
            if (missingColumns.length > 0) {
                throw new Error(`Notes schema is missing required columns: ${missingColumns.join(', ')}`);
            }
            let verifiedByName = new Map(
                (verifiedColumns as any[]).map(column => [String(column.Field), column]),
            );

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
                const column: any = verifiedByName.get(invariant.name);
                const defaultValue = String(column?.Default ?? '').replace(/^'(.*)'$/, '$1');
                if (String(column?.Null || '').toUpperCase() === 'NO'
                    && defaultValue === invariant.expectedDefault) continue;
                await pool.query(
                    `UPDATE notes SET ${invariant.name} = ${invariant.fallback} WHERE ${invariant.name} IS NULL`,
                );
                await pool.query(`ALTER TABLE notes MODIFY COLUMN ${invariant.name} ${invariant.definition}`);
                invariantsMigrated = true;
            }
            if (invariantsMigrated) {
                [verifiedColumns] = await pool.query('SHOW COLUMNS FROM notes');
                verifiedNames = new Set((verifiedColumns as any[]).map((column: any) => String(column.Field)));
                verifiedByName = new Map(
                    (verifiedColumns as any[]).map((column: any) => [String(column.Field), column]),
                );
            }
            for (const [name, acceptedType] of Object.entries(compatibleNoteColumnTypes)) {
                const actualType = String(verifiedByName.get(name)?.Type || '').trim().toLowerCase();
                if (!acceptedType.test(actualType)) {
                    throw new Error(`Notes schema column ${name} has incompatible type ${actualType || '(missing)'}`);
                }
            }
            for (const invariant of revisionInvariants) {
                const column: any = verifiedByName.get(invariant.name);
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

export async function saveNote(note: Partial<NoteRow> & {
    owner: string;
    imap_uid?: number;
    imap_msgid?: string;
    expected_sync_token?: number;
}): Promise<NoteRow> {
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
            if (noteContentMatches(existing, expectedContent)) return existing;
            throw new NoteConflictError();
        }
    }
    if (
        existing
        && note.imap_uid === undefined
        && note.imap_msgid === undefined
        && noteContentMatches(existing, expectedContent)
    ) {
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

        const [updateResult]: any = await pool.query(updateQuery, queryParams);
        if (note.expected_sync_token !== undefined && updateResult.affectedRows === 0) {
            const current = await getNote(id, note.owner);
            if (current && noteContentMatches(current, expectedContent)) return current;
            throw new NoteConflictError();
        }
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

async function cleanupDeletedNoteDependents(id: string, owner: string): Promise<void> {
    try {
        await pool.query('DELETE FROM note_reminders WHERE note_id = ?', [id]);
        // Delete attachment files from disk before removing DB records
        const [attachments]: any = await pool.query(
            `SELECT a.storage_path FROM note_attachments a
             JOIN notes n ON n.id = a.note_id
             WHERE a.note_id = ? AND n.owner = ?`,
            [id, owner]
        );
        if (attachments && attachments.length > 0) {
            const path = require('path');
            const fs = require('fs');
            for (const att of attachments) {
                try {
                    const filePath = path.join(__dirname, '..', 'uploads', att.storage_path);
                    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
                } catch {}
            }
        }
        await pool.query('DELETE a FROM note_attachments a JOIN notes n ON n.id = a.note_id WHERE a.note_id = ? AND n.owner = ?', [id, owner]);
    } catch (e) {
        console.error('deleteNote: failed to clean up reminders/attachments', e);
    }
}

function emitNoteDeleted(id: string, owner: string): void {
    try {
        const { io } = require('./index');
        io.to(owner).emit('note_deleted', { noteId: id });
    } catch(e) {}
}

export async function deleteNote(id: string, owner: string): Promise<void> {
    const [result]: any = await pool.query(
        'UPDATE notes SET is_deleted = 1, sync_token = sync_token + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND owner = ? AND is_deleted = 0',
        [id, owner],
    );
    if (result.affectedRows === 0) return;
    await cleanupDeletedNoteDependents(id, owner);
    emitNoteDeleted(id, owner);
}

export async function deleteNoteIfRevisionMatches(
    id: string,
    owner: string,
    expectedSyncToken: number,
    expectedImapUid: number,
): Promise<boolean> {
    const syncToken = Number(expectedSyncToken);
    const imapUid = Number(expectedImapUid);
    if (!Number.isSafeInteger(syncToken) || syncToken < 1 || !Number.isSafeInteger(imapUid) || imapUid < 1) {
        return false;
    }

    const [result]: any = await pool.query(
        `UPDATE notes
         SET is_deleted = 1,
             sync_token = sync_token + 1,
             imap_sync_token = imap_sync_token + 1,
             imap_uid = NULL,
             updated_at = CURRENT_TIMESTAMP
         WHERE id = ? AND owner = ?
           AND sync_token = ? AND imap_sync_token = ?
           AND imap_uid = ? AND is_deleted = 0`,
        [id, owner, syncToken, syncToken, imapUid],
    );
    if (result.affectedRows === 0) return false;

    await cleanupDeletedNoteDependents(id, owner);
    emitNoteDeleted(id, owner);
    return true;
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

export async function getNoteReminder(noteId: string, owner: string): Promise<NoteReminder | null> {
    const [results]: any = await pool.query(
        `SELECT r.* FROM note_reminders r
         JOIN notes n ON n.id = r.note_id
         WHERE r.note_id = ? AND n.owner = ?`,
        [noteId, owner]
    );
    return results.length > 0 ? results[0] : null;
}

export async function saveNoteReminder(noteId: string, remindAt: string, owner: string): Promise<void> {
    const note = await getNote(noteId, owner);
    if (!note) throw new Error('Note not found');
    await pool.query(
        'INSERT INTO note_reminders (note_id, remind_at) VALUES (?, ?) ON DUPLICATE KEY UPDATE remind_at = VALUES(remind_at), notified = 0',
        [noteId, remindAt]
    );
}

export async function deleteNoteReminder(noteId: string, owner: string): Promise<void> {
    await pool.query(
        `DELETE r FROM note_reminders r
         JOIN notes n ON n.id = r.note_id
         WHERE r.note_id = ? AND n.owner = ?`,
        [noteId, owner]
    );
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

export async function listNoteAttachments(noteId: string, owner: string): Promise<NoteAttachmentRow[]> {
    const [results]: any = await pool.query(
        `SELECT a.* FROM note_attachments a
         JOIN notes n ON n.id = a.note_id
         WHERE a.note_id = ? AND n.owner = ?
         ORDER BY a.created_at ASC`,
        [noteId, owner]
    );
    return results as NoteAttachmentRow[];
}

export async function saveNoteAttachment(attachment: NoteAttachmentRow, owner: string): Promise<void> {
    const note = await getNote(attachment.note_id, owner);
    if (!note) throw new Error('Note not found');
    await pool.query(
        'INSERT INTO note_attachments (id, note_id, filename, mime_type, size_bytes, storage_path) VALUES (?, ?, ?, ?, ?, ?)',
        [attachment.id, attachment.note_id, attachment.filename, attachment.mime_type, attachment.size_bytes, attachment.storage_path]
    );
}

export async function deleteNoteAttachment(attachmentId: string, owner: string): Promise<NoteAttachmentRow | null> {
    const [results]: any = await pool.query(
        `SELECT a.* FROM note_attachments a
         JOIN notes n ON n.id = a.note_id
         WHERE a.id = ? AND n.owner = ?`,
        [attachmentId, owner]
    );
    if (results.length === 0) return null;
    await pool.query('DELETE FROM note_attachments WHERE id = ?', [attachmentId]);
    return results[0];
}

// ---- Schema migration helper ----

async function ensureAllNotesSchemas(): Promise<void> {
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
