import { ImapFlow } from 'imapflow';
export type MailSearchField = 'all' | 'from' | 'to' | 'subject' | 'body' | 'unread' | 'starred' | 'attachments';
export interface ActiveSyncMailSnapshot {
    uidValidity: string;
    highestModseq: string;
    allUids: number[];
    eligibleUids: number[];
    changedReadFlags: Record<string, 0 | 1>;
}
export interface ActiveSyncMailMessage {
    uid: number;
    flags: string[];
    envelope: any;
    internalDate?: Date;
    size: number;
    source: Buffer;
    sourceComplete: boolean;
}
export declare class ImapService {
    client: ImapFlow;
    constructor(user: string, pass: string, useMasterCredentials?: boolean);
    connect(): Promise<void>;
    logout(): Promise<void>;
    getFolders(): Promise<any[]>;
    getMessages(folderPath: string, minUid?: number, fetchOlderThan?: number): Promise<{
        messages: any[];
        uidNext: number;
        highestModseq: string;
        lowestUid: number;
        moreAvailable: boolean;
    }>;
    getChangedFlags(folderPath: string, sinceModseq: string): Promise<{
        changed: {
            uid: number;
            flags: string[];
        }[];
        highestModseq: string;
    }>;
    getActiveSyncMailSnapshot(folderPath: string, cutoff: Date | null, sinceModseq: string, knownUids: number[]): Promise<ActiveSyncMailSnapshot>;
    getActiveSyncMessages(folderPath: string, uids: number[], maxSourceBytes: number): Promise<ActiveSyncMailMessage[]>;
    private buildSearchQuery;
    searchMessages(folderPaths: string[], query: string, field?: MailSearchField, limit?: number): Promise<any[]>;
    getRecentMessagesForIndex(folderPath: string, limit?: number): Promise<any[]>;
    getMessagesSinceUid(folderPath: string, minUid: number, limit?: number): Promise<any[]>;
    getQuota(): Promise<false | import("imapflow").QuotaResponse>;
    getMessageByUid(folderPath: string, uid: number): Promise<any>;
    appendMessage(folderPath: string, content: string | Buffer, flags?: string[]): Promise<void>;
    moveMessage(sourceFolder: string, targetFolder: string, uid: number): Promise<void>;
    messageAction(folderPath: string, uids: number[], action: 'delete' | 'hardDelete' | 'archive' | 'spam' | 'move' | 'read' | 'unread' | 'star' | 'unstar', targetFolder?: string): Promise<{
        targetFolder: string;
        uidMap: {
            [k: string]: number;
        };
    }>;
}
//# sourceMappingURL=imap.d.ts.map