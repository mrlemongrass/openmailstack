import type { WbxmlNode } from './wbxml/parser';
export declare const ACTIVE_SYNC_MAX_REQUEST_BYTES: number;
export declare const ACTIVE_SYNC_ADVERTISED_COMMANDS: readonly ["Sync", "FolderSync", "ItemOperations"];
export declare const ACTIVE_SYNC_UNSUPPORTED_COMMANDS: readonly ["FolderCreate", "FolderDelete", "FolderUpdate", "GetItemEstimate", "MoveItems", "Ping", "Provision", "Settings", "SendMail", "SmartForward", "SmartReply"];
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
    folderPath: string;
} | {
    kind: 'unsupported';
};
export declare function activeSyncRequestLogSummary(method: unknown, command: unknown, bodyBytes: unknown, decoded?: WbxmlNode | null, parseError?: boolean): ActiveSyncLogSummary;
export declare function staticActiveSyncServiceFolders(): ActiveSyncStaticFolder[];
export declare function classifyActiveSyncCollection(collectionId: string): ActiveSyncCollection;
export declare function unsupportedSyncCollectionResponse(collectionId: string, syncKey: string): any;
export declare function activeSyncDeleteCommand(serverId: string): any;
//# sourceMappingURL=eas-protocol.d.ts.map