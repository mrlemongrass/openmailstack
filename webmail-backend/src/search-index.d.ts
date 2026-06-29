import type { MailSearchField } from './imap';
export type IndexedMailSearchField = MailSearchField | 'attachments';
export interface MailSearchIndexRow {
    folder: string;
    uid: number;
    messageId?: string;
    subject: string;
    sender: string;
    recipients: string;
    sentAt?: Date | string | null;
    preview: string;
    bodyText: string;
    attachmentNames: string;
    inReplyTo?: string;
    references?: string[];
    isRead: boolean;
    isStarred: boolean;
    messageSize?: number;
}
export interface MailSearchIndexStatus {
    indexedCount: number;
    lastIndexedAt: Date | string | null;
}
export interface SavedMailSearch {
    id: number;
    name: string;
    query: string;
    field: IndexedMailSearchField;
    scope: 'folder' | 'all';
    folder: string;
    createdAt: Date | string;
    updatedAt: Date | string;
}
export declare const ensureMailSearchSchema: () => Promise<void>;
export declare const upsertMailSearchRows: (username: string, rows: MailSearchIndexRow[]) => Promise<number>;
export declare const deleteMailSearchRows: (username: string, folder: string, uids: number[]) => Promise<void>;
export declare const updateMailSearchFlags: (username: string, folder: string, uids: number[], updates: {
    isRead?: boolean;
    isStarred?: boolean;
}) => Promise<void>;
export declare const getMailSearchIndexStatus: (username: string) => Promise<MailSearchIndexStatus>;
export declare const getMaxIndexedUid: (username: string, folder: string) => Promise<number>;
export declare const listSavedMailSearches: (username: string) => Promise<any>;
export declare const createSavedMailSearch: (username: string, search: {
    name: string;
    query: string;
    field: IndexedMailSearchField;
    scope: "folder" | "all";
    folder: string;
}) => Promise<SavedMailSearch>;
export declare const deleteSavedMailSearch: (username: string, id: number) => Promise<boolean>;
export declare const searchMailIndex: (username: string, options: {
    query: string;
    field: IndexedMailSearchField;
    scope: "folder" | "all";
    folder: string;
    limit: number;
}) => Promise<any>;
//# sourceMappingURL=search-index.d.ts.map