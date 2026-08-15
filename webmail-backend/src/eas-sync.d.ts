export interface ActiveSyncChangeDecision {
    syncKey: string;
    nextSyncKey: string;
    hasClientCommands: boolean;
    getChangesRequested: boolean;
}
export type ActiveSyncGetChangesResult = {
    ok: true;
    value: boolean;
} | {
    ok: false;
};
export declare function validateActiveSyncCollectionRequest(collection: any): {
    ok: true;
} | {
    ok: false;
};
export declare function singleActiveSyncCollection(decoded: any): {
    ok: true;
    collection: any;
} | {
    ok: false;
    status: '4' | '15';
};
export declare function parseActiveSyncGetChanges(syncKey: string, node: any): ActiveSyncGetChangesResult;
export declare function normalizeActiveSyncWindowSize(value: unknown, fallback?: number): number;
export declare function shouldSendActiveSyncServerChanges(decision: ActiveSyncChangeDecision): boolean;
//# sourceMappingURL=eas-sync.d.ts.map