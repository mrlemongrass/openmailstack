"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.shouldSendActiveSyncServerChanges = shouldSendActiveSyncServerChanges;
function shouldSendActiveSyncServerChanges(decision) {
    const keyNeedsRefresh = decision.syncKey === '0'
        || decision.syncKey === '1'
        || decision.syncKey !== decision.nextSyncKey;
    if (!keyNeedsRefresh)
        return false;
    if (decision.hasClientCommands && !decision.getChangesRequested)
        return false;
    return true;
}
//# sourceMappingURL=eas-sync.js.map