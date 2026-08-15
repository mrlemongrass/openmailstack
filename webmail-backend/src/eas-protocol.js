"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ACTIVE_SYNC_UNSUPPORTED_COMMANDS = exports.ACTIVE_SYNC_ADVERTISED_COMMANDS = exports.ACTIVE_SYNC_MAX_REQUEST_BYTES = void 0;
exports.activeSyncRequestLogSummary = activeSyncRequestLogSummary;
exports.staticActiveSyncServiceFolders = staticActiveSyncServiceFolders;
exports.classifyActiveSyncCollection = classifyActiveSyncCollection;
exports.unsupportedSyncCollectionResponse = unsupportedSyncCollectionResponse;
exports.activeSyncDeleteCommand = activeSyncDeleteCommand;
exports.ACTIVE_SYNC_MAX_REQUEST_BYTES = 16 * 1024 * 1024;
exports.ACTIVE_SYNC_ADVERTISED_COMMANDS = [
    'Sync',
    'FolderSync',
    'ItemOperations',
];
exports.ACTIVE_SYNC_UNSUPPORTED_COMMANDS = [
    'FolderCreate',
    'FolderDelete',
    'FolderUpdate',
    'GetItemEstimate',
    'MoveItems',
    'Ping',
    'Provision',
    'Settings',
    'SendMail',
    'SmartForward',
    'SmartReply',
];
const MAX_LOG_NODES = 128;
const MAX_LOG_DEPTH = 16;
const MAX_COLLECTION_ID_BYTES = 1024;
const MAX_FOLDER_PATH_BYTES = 512;
const boundedToken = (value, fallback) => {
    const token = String(value || '');
    return /^[A-Za-z][A-Za-z0-9]{0,31}$/.test(token) ? token : fallback;
};
function activeSyncRequestLogSummary(method, command, bodyBytes, decoded, parseError = false) {
    const numericBodyBytes = Number(bodyBytes);
    const summary = {
        method: boundedToken(method, 'UNKNOWN'),
        command: boundedToken(command, 'Unknown'),
        bodyBytes: Number.isFinite(numericBodyBytes)
            ? Math.max(0, Math.min(exports.ACTIVE_SYNC_MAX_REQUEST_BYTES, Math.floor(numericBodyBytes)))
            : 0,
    };
    if (parseError)
        summary.parseError = true;
    if (!decoded)
        return summary;
    summary.rootTag = boundedToken(decoded.tag, 'Unknown');
    let nodeCount = 0;
    let maxDepth = 0;
    const pending = [{ node: decoded, depth: 0 }];
    while (pending.length > 0 && nodeCount < MAX_LOG_NODES) {
        const current = pending.pop();
        nodeCount += 1;
        maxDepth = Math.max(maxDepth, Math.min(MAX_LOG_DEPTH, current.depth));
        const children = current.node.children || [];
        for (let index = children.length - 1; index >= 0; index -= 1) {
            pending.push({ node: children[index], depth: current.depth + 1 });
        }
    }
    summary.nodeCount = nodeCount;
    summary.maxDepth = maxDepth;
    summary.truncated = pending.length > 0;
    return summary;
}
function staticActiveSyncServiceFolders() {
    return [{
            serverId: 'contacts',
            parentId: '0',
            displayName: 'Contacts',
            type: '9',
        }];
}
const decodeMailCollectionId = (collectionId) => {
    if (!collectionId || Buffer.byteLength(collectionId, 'utf8') > MAX_COLLECTION_ID_BYTES)
        return null;
    if (collectionId.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(collectionId))
        return null;
    const bytes = Buffer.from(collectionId, 'base64');
    if (bytes.length === 0 || bytes.length > MAX_FOLDER_PATH_BYTES || bytes.toString('base64') !== collectionId)
        return null;
    const folderPath = bytes.toString('utf8');
    if (!Buffer.from(folderPath, 'utf8').equals(bytes) || /[\u0000-\u001f\u007f]/.test(folderPath))
        return null;
    return folderPath;
};
function classifyActiveSyncCollection(collectionId) {
    if (collectionId === 'contacts' || collectionId === 'mock-contacts')
        return { kind: 'contacts' };
    if (collectionId === 'mock-calendar')
        return { kind: 'calendar', calendarId: null };
    const calendarMatch = collectionId.match(/^cal-([1-9][0-9]*)$/);
    if (calendarMatch)
        return { kind: 'calendar', calendarId: calendarMatch[1] };
    const folderPath = decodeMailCollectionId(collectionId);
    return folderPath ? { kind: 'mail', folderPath } : { kind: 'unsupported' };
}
function unsupportedSyncCollectionResponse(collectionId, syncKey) {
    return {
        tag: 'Sync',
        page: 0,
        children: [{
                tag: 'Collections',
                page: 0,
                children: [{
                        tag: 'Collection',
                        page: 0,
                        children: [
                            { tag: 'SyncKey', page: 0, content: syncKey },
                            { tag: 'CollectionId', page: 0, content: collectionId },
                            { tag: 'Status', page: 0, content: '8' },
                        ],
                    }],
            }],
    };
}
function activeSyncDeleteCommand(serverId) {
    return {
        tag: 'Delete',
        page: 0,
        children: [{ tag: 'ServerId', page: 0, content: serverId }],
    };
}
//# sourceMappingURL=eas-protocol.js.map