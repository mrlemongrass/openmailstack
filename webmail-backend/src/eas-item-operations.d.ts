export declare const ITEM_OPERATIONS_MAX_SOURCE_BYTES: number;
export declare const ITEM_OPERATIONS_MAX_BODY_BYTES: number;
export declare const ITEM_OPERATIONS_MAX_FETCHES = 100;
export declare const ITEM_OPERATIONS_MAX_RESPONSE_BODY_BYTES: number;
export declare const ITEM_OPERATIONS_MAX_AGGREGATE_SOURCE_BYTES: number;
export interface ItemOperationsMessage {
    uid: number;
    flags: string[];
    source: Buffer;
    size: number;
    sourceComplete: boolean;
}
export interface ItemOperationsFetchInput {
    collectionId: string;
    serverId: string;
    message: ItemOperationsMessage;
    maxBodyBytes: number;
    bodyPreferences: ItemOperationsBodyPreference[];
}
export interface ItemOperationsBodyPreference {
    bodyType: number;
    maxBodyBytes: number;
    allowTruncation: boolean;
}
export type ItemOperationsMailboxTarget = {
    ok: true;
    folderPath: string;
    uid: number;
} | {
    ok: false;
    status: string;
};
export type ItemOperationsFetchRequest = {
    ok: true;
    store: string;
    collectionId: string;
    serverId: string;
    bodyPreferences: ItemOperationsBodyPreference[];
} | {
    ok: false;
    collectionId: string;
    serverId: string;
    status: '2';
};
export declare function itemOperationsRequestFetches(decoded: any): any[] | null;
export declare function itemOperationsFetchRequest(fetchNode: any): ItemOperationsFetchRequest;
export declare function itemOperationsMailboxTarget(store: string, collectionId: string, serverId: string): ItemOperationsMailboxTarget;
export declare function itemOperationsSourceAllowance(remainingBytes: number): number;
export declare function itemOperationsBodyAllowance(remainingBytes: number, requestedBytes: number): number;
export declare function itemOperationsFetchBodyBytes(fetchNode: any): number;
export declare function itemOperationsFetchError(collectionId: string, serverId: string, status: string): any;
export declare function itemOperationsFetchSuccess(input: ItemOperationsFetchInput): Promise<any>;
//# sourceMappingURL=eas-item-operations.d.ts.map