import type { WbxmlNode } from './wbxml/parser';
export declare const ACTIVE_SYNC_MAX_REQUEST_BYTES: number;
export declare const ACTIVE_SYNC_ADVERTISED_COMMANDS: readonly ["Sync", "FolderSync", "ItemOperations", "SendMail"];
export declare const ACTIVE_SYNC_UNSUPPORTED_COMMANDS: readonly ["FolderCreate", "FolderDelete", "FolderUpdate", "GetItemEstimate", "MoveItems", "Ping", "Provision", "Settings", "SmartForward", "SmartReply"];
export interface ActiveSyncLogSummary {
    method: string;
    command: string;
    bodyBytes: number;
    rootTag?: string;
    nodeCount?: number;
    maxDepth?: number;
    truncated?: boolean;
    parseError?: boolean;
}
export interface ActiveSyncStaticFolder {
    serverId: string;
    parentId: string;
    displayName: string;
    type: string;
}
export type ActiveSyncCollection = {
    kind: 'contacts';
} | {
    kind: 'calendar';
    calendarId: string | null;
} | {
    kind: 'mail';
    folderPath: string | null;
} | {
    kind: 'unsupported';
};
export type ActiveSyncMailFolder = {
    path: string;
    delimiter?: string | null;
};
export declare function activeSyncRequestLogSummary(method: unknown, command: unknown, bodyBytes: unknown, decoded?: WbxmlNode | null, parseError?: boolean): ActiveSyncLogSummary;
export declare function staticActiveSyncServiceFolders(): ActiveSyncStaticFolder[];
export declare function activeSyncMailCollectionId(folderPath: string): string;
export declare function activeSyncMailParentId(folder: ActiveSyncMailFolder): string;
export declare function resolveActiveSyncMailFolderPath(collectionId: string, folders: ActiveSyncMailFolder[]): string | null;
export declare function activeSyncMailMessageServerId(collectionId: string, uid: number): string;
export declare function activeSyncMailMessageUid(collectionId: string, serverId: string): number | null;
export declare function parseActiveSyncFolderSyncRequest(decoded: any): {
    ok: true;
    syncKey: string;
} | {
    ok: false;
};
export declare function isActiveSyncAuthenticationFailure(error: unknown): boolean;
export declare function classifyActiveSyncCollection(collectionId: string): ActiveSyncCollection;
export declare function unsupportedSyncCollectionResponse(collectionId: string, syncKey: string): any;
export declare function activeSyncDeleteCommand(serverId: string): any;
//# sourceMappingURL=eas-protocol.d.ts.map