import { ImapFlow } from 'imapflow';
export type MailSearchField = 'all' | 'from' | 'to' | 'subject' | 'body' | 'unread' | 'starred' | 'attachments';
export declare class ImapService {
    client: ImapFlow;
    constructor(user: string, pass: string);
    connect(): Promise<void>;
    logout(): Promise<void>;
    getFolders(): Promise<any[]>;
    getMessages(folderPath: string, minUid?: number, fetchOlderThan?: number): Promise<{
        messages: any[];
        uidNext: number;
        lowestUid: number;
        moreAvailable: boolean;
    }>;
    private buildSearchQuery;
    searchMessages(folderPaths: string[], query: string, field?: MailSearchField, limit?: number): Promise<any[]>;
    getRecentMessagesForIndex(folderPath: string, limit?: number): Promise<any[]>;
    getMessagesSinceUid(folderPath: string, minUid: number, limit?: number): Promise<any[]>;
    getMessageByUid(folderPath: string, uid: number): Promise<any>;
    appendMessage(folderPath: string, content: string | Buffer, flags?: string[]): Promise<void>;
    moveMessage(sourceFolder: string, targetFolder: string, uid: number): Promise<void>;
    messageAction(folderPath: string, uids: number[], action: 'delete' | 'archive' | 'spam' | 'move' | 'read' | 'unread' | 'star' | 'unstar', targetFolder?: string): Promise<{
        targetFolder: string;
        uidMap: {
            [k: string]: number;
        };
    }>;
}
//# sourceMappingURL=imap.d.ts.map