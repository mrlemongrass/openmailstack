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
export declare function getNotesSyncToken(owner: string): Promise<number>;
//# sourceMappingURL=notes-utils.d.ts.map