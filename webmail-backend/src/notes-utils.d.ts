export declare const NOTE_TITLE_MAX_BYTES: number;
export declare const NOTE_CONTENT_MAX_BYTES: number;
export declare const NOTE_LABELS_MAX_BYTES: number;
export declare const NOTE_LABELS_MAX_COUNT = 100;
export declare class NoteValidationError extends Error {
    readonly statusCode: 400 | 413;
    readonly code: 'NOTE_FIELD_INVALID' | 'NOTE_FIELD_TOO_LARGE';
    readonly field: 'title' | 'content' | 'labels_json';
    readonly limitBytes?: number;
    constructor(field: 'title' | 'content' | 'labels_json', message: string, statusCode?: 400 | 413, limitBytes?: number);
}
export declare function noteValidationErrorBody(error: NoteValidationError): {
    success: false;
    error: string;
    code: NoteValidationError['code'];
    field: NoteValidationError['field'];
    limit_bytes?: number;
};
export declare function validateNoteFields(input: {
    title?: unknown;
    content?: unknown;
    labels_json?: unknown;
}): Pick<NoteRow, 'title' | 'content' | 'labels_json'>;
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
export declare class NoteConflictError extends Error {
    constructor();
}
export declare function ensureNotesSchema(): Promise<void>;
export declare function listNotes(owner: string, includeDeleted?: boolean): Promise<NoteRow[]>;
export declare function getNote(id: string, owner: string, includeDeleted?: boolean): Promise<NoteRow | null>;
export declare function saveNote(note: Partial<NoteRow> & {
    owner: string;
    imap_uid?: number;
    imap_msgid?: string;
    expected_sync_token?: number;
}): Promise<NoteRow>;
export declare function deleteNote(id: string, owner: string): Promise<void>;
export declare function deleteNoteIfRevisionMatches(id: string, owner: string, expectedSyncToken: number, expectedImapUid: number): Promise<boolean>;
export declare function hardDeleteNote(id: string, owner: string): Promise<void>;
export interface NoteReminder {
    note_id: string;
    remind_at: string;
    notified: number;
    created_at: string;
}
export declare function ensureRemindersSchema(): Promise<void>;
export declare function getNoteReminder(noteId: string, owner: string): Promise<NoteReminder | null>;
export declare function saveNoteReminder(noteId: string, remindAt: string, owner: string): Promise<void>;
export declare function deleteNoteReminder(noteId: string, owner: string): Promise<void>;
export interface NoteAttachmentRow {
    id: string;
    note_id: string;
    filename: string;
    mime_type: string;
    size_bytes: number;
    storage_path: string;
    created_at: string;
}
export declare function ensureAttachmentsSchema(): Promise<void>;
export declare function listNoteAttachments(noteId: string, owner: string): Promise<NoteAttachmentRow[]>;
export declare function saveNoteAttachment(attachment: NoteAttachmentRow, owner: string): Promise<void>;
export declare function deleteNoteAttachment(attachmentId: string, owner: string): Promise<NoteAttachmentRow | null>;
export declare function listNotesWithReminders(owner: string): Promise<(NoteRow & {
    remind_at: string | null;
})[]>;
export declare function getNotesSyncToken(owner: string): Promise<number>;
//# sourceMappingURL=notes-utils.d.ts.map