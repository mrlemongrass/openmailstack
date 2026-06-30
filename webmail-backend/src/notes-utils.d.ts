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
export declare function ensureNotesSchema(): Promise<void>;
export declare function listNotes(owner: string, includeDeleted?: boolean): Promise<NoteRow[]>;
export declare function getNote(id: string, owner: string, includeDeleted?: boolean): Promise<NoteRow | null>;
export declare function saveNote(note: Partial<NoteRow> & {
    owner: string;
    imap_uid?: number;
    imap_msgid?: string;
}): Promise<NoteRow>;
export declare function deleteNote(id: string, owner: string): Promise<void>;
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