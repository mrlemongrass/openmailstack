export interface ActiveSyncChangeDecision {
    syncKey: string;
    nextSyncKey: string;
    hasClientCommands: boolean;
    getChangesRequested: boolean;
}

export function shouldSendActiveSyncServerChanges(decision: ActiveSyncChangeDecision): boolean {
    const keyNeedsRefresh = decision.syncKey === '0'
        || decision.syncKey === '1'
        || decision.syncKey !== decision.nextSyncKey;

    if (!keyNeedsRefresh) return false;
    if (decision.hasClientCommands && !decision.getChangesRequested) return false;
    return true;
}
