import { ImapFlow } from 'imapflow';
import type { RuleCopyLedger, RuleCopyLedgerAction } from './rule-run-ledger';
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
export interface RuleRunRawMessage {
    uid: number;
    envelope: any;
    size: number;
    source?: Buffer;
    sourceComplete: boolean;
}
export interface RuleMovePlan {
    uid: number;
    moveFolders: string[];
}
export interface RuleMoveApplyResult {
    affected: number;
    copied: number;
    moved: number;
    movedUids: number[];
}
export declare class RuleMoveApplyError extends Error {
    result: RuleMoveApplyResult;
    retrySafe: boolean;
    pendingCopies: RuleCopyLedgerAction[];
    constructor(result: RuleMoveApplyResult, cause: unknown, retrySafe?: boolean, pendingCopies?: RuleCopyLedgerAction[]);
}
export declare class MailboxMutationError extends Error {
    code: string;
    statusCode: number;
    constructor(code: string, statusCode: number, message: string);
}
export declare class ImapService {
    client: ImapFlow;
    constructor(user: string, pass: string, useMasterCredentials?: boolean);
    connect(): Promise<void>;
    logout(): Promise<void>;
    close(): void;
    getFolders(): Promise<any[]>;
    private preserveSubscriptionsAfterMailboxRename;
    createFolder(parentPath: string | null | undefined, requestedName: string): Promise<{
        path: string;
        delimiter: string;
        unseen: number;
    }>;
    moveFolder(requestedPath: string, requestedParent: string | null | undefined): Promise<{
        previousPath: string;
        folder: {
            path: string;
            delimiter: string;
            unseen: number;
        };
    }>;
    renameFolder(requestedPath: string, requestedName: string): Promise<{
        previousPath: string;
        folder: {
            path: string;
            delimiter: string;
            unseen: number;
        };
    }>;
    deleteFolder(requestedPath: string): Promise<{
        deletedPath: string;
    }>;
    getMessageIdentities(folderPath: string): Promise<any[]>;
    getSearchFolderSnapshot(): Promise<{
        folderPaths: string[];
        uidNextByFolder: Map<string, number>;
        uidValidityByFolder: Map<string, string>;
        failedFolders: string[];
    }>;
    getMessages(folderPath: string, minUid?: number, fetchOlderThan?: number): Promise<{
        messages: any[];
        uidNext: number;
        highestModseq: string;
        lowestUid: number;
        moreAvailable: boolean;
    }>;
    getRuleRunBatch(folderPath: string, cursor?: number, maxUid?: number, batchSize?: number, includeBody?: boolean, readState?: 'all' | 'unread' | 'read'): Promise<{
        messages: RuleRunRawMessage[];
        nextCursor: number;
        maxUid: number;
        uidValidity: string;
        done: boolean;
    }>;
    applyRuleMoves(folderPath: string, plans: RuleMovePlan[], operationKey: string, ledger: RuleCopyLedger): Promise<RuleMoveApplyResult>;
    getChangedFlags(folderPath: string, sinceModseq: string): Promise<{
        changed: {
            uid: number;
            flags: string[];
        }[];
        highestModseq: string;
    }>;
    getActiveSyncMailboxCursor(folderPath: string): Promise<{
        uidValidity: string;
        highestModseq: string;
    }>;
    getActiveSyncMailSnapshot(folderPath: string, cutoff: Date | null, sinceModseq: string, knownUids: number[], forceFullSnapshot?: boolean): Promise<ActiveSyncMailSnapshot>;
    getActiveSyncMessages(folderPath: string, uids: number[], maxSourceBytes: number): Promise<ActiveSyncMailMessage[]>;
    private buildSearchQuery;
    searchMessages(folderPaths: string[], query: string, field?: MailSearchField, limit?: number, shouldStop?: () => boolean): Promise<{
        messages: any[];
        failedFolders: string[];
        partialFolders: string[];
    }>;
    getExistingUidStates(folderPath: string, uids: number[]): Promise<{
        uid: number;
        flags: string[];
    }[]>;
    getFolderUidNext(folderPaths: string[]): Promise<{
        uidNextByFolder: Map<string, number>;
        uidValidityByFolder: Map<string, string>;
        failedFolders: string[];
    }>;
    getRecentMessagesForIndex(folderPath: string, limit?: number): Promise<any[]>;
    getMessagesSinceUid(folderPath: string, minUid: number, limit?: number): Promise<{
        messages: any[];
        moreAvailable: boolean;
    }>;
    getQuota(): Promise<false | import("imapflow").QuotaResponse>;
    getMessageByUid(folderPath: string, uid: number, maxSourceBytes?: number): Promise<{
        uid: number;
        flags: string[];
        envelope: import("imapflow").MessageEnvelopeObject;
        source: Buffer<ArrayBufferLike>;
        size: number;
        sourceComplete: boolean;
    }>;
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