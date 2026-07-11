export interface ActiveSyncChangeDecision {
    syncKey: string;
    nextSyncKey: string;
    hasClientCommands: boolean;
    getChangesRequested: boolean;
}
export declare function shouldSendActiveSyncServerChanges(decision: ActiveSyncChangeDecision): boolean;
//# sourceMappingURL=eas-sync.d.ts.map