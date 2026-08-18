"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ACTIVE_SYNC_UNSUPPORTED_COMMANDS = exports.ACTIVE_SYNC_ADVERTISED_COMMANDS = exports.ACTIVE_SYNC_MAX_REQUEST_BYTES = void 0;
exports.activeSyncRequestLogSummary = activeSyncRequestLogSummary;
exports.staticActiveSyncServiceFolders = staticActiveSyncServiceFolders;
exports.activeSyncMailCollectionId = activeSyncMailCollectionId;
exports.activeSyncMailParentId = activeSyncMailParentId;
exports.resolveActiveSyncMailFolderPath = resolveActiveSyncMailFolderPath;
exports.activeSyncMailMessageServerId = activeSyncMailMessageServerId;
exports.activeSyncMailMessageUid = activeSyncMailMessageUid;
exports.parseActiveSyncFolderSyncRequest = parseActiveSyncFolderSyncRequest;
exports.isActiveSyncAuthenticationFailure = isActiveSyncAuthenticationFailure;
exports.classifyActiveSyncCollection = classifyActiveSyncCollection;
exports.unsupportedSyncCollectionResponse = unsupportedSyncCollectionResponse;
exports.activeSyncDeleteCommand = activeSyncDeleteCommand;
const crypto_1 = require("crypto");
exports.ACTIVE_SYNC_MAX_REQUEST_BYTES = 16 * 1024 * 1024;
exports.ACTIVE_SYNC_ADVERTISED_COMMANDS = [
    'Sync',
    'FolderSync',
    'ItemOperations',
    'Ping',
    'SendMail',
];
exports.ACTIVE_SYNC_UNSUPPORTED_COMMANDS = [
    'FolderCreate',
    'FolderDelete',
    'FolderUpdate',
    'GetItemEstimate',
    'MoveItems',
    'Provision',
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
function activeSyncMailCollectionId(folderPath) {
    return `m-${(0, crypto_1.createHash)('sha256').update(folderPath).digest('hex').slice(0, 62)}`;
}
function activeSyncMailParentId(folder) {
    const delimiter = folder.delimiter || '';
    if (!delimiter)
        return '0';
    const separator = folder.path.lastIndexOf(delimiter);
    if (separator <= 0)
        return '0';
    return activeSyncMailCollectionId(folder.path.slice(0, separator));
}
function resolveActiveSyncMailFolderPath(collectionId, folders) {
    const opaque = folders.find(folder => activeSyncMailCollectionId(folder.path) === collectionId);
    if (opaque)
        return opaque.path;
    const legacyPath = decodeMailCollectionId(collectionId);
    if (!legacyPath || Buffer.byteLength(collectionId, 'utf8') > 40)
        return null;
    return folders.some(folder => folder.path === legacyPath) ? legacyPath : null;
}
function activeSyncMailMessageServerId(collectionId, uid) {
    if (!Number.isSafeInteger(uid) || uid < 1)
        throw new Error('Invalid mail UID');
    const collectionHash = (0, crypto_1.createHash)('sha256').update(collectionId).digest('hex').slice(0, 40);
    return `i-${collectionHash}-${uid}`;
}
function activeSyncMailMessageUid(collectionId, serverId) {
    const prefix = `i-${(0, crypto_1.createHash)('sha256').update(collectionId).digest('hex').slice(0, 40)}-`;
    if (!serverId.startsWith(prefix))
        return null;
    const value = serverId.slice(prefix.length);
    if (!/^[1-9][0-9]{0,15}$/.test(value))
        return null;
    const uid = Number(value);
    return Number.isSafeInteger(uid) ? uid : null;
}
function parseActiveSyncFolderSyncRequest(decoded) {
    if (decoded?.tag !== 'FolderSync' || decoded?.page !== 7
        || decoded.content !== undefined && decoded.content !== null
        || !Array.isArray(decoded.children) || decoded.children.length !== 1)
        return { ok: false };
    const syncKey = decoded.children[0];
    if (syncKey?.tag !== 'SyncKey' || syncKey?.page !== 7
        || syncKey.content === undefined || syncKey.content === null
        || typeof syncKey.content !== 'string'
        || syncKey.children?.length
        || Buffer.byteLength(syncKey.content, 'utf8') < 1
        || Buffer.byteLength(syncKey.content, 'utf8') > 96
        || /[\u0000-\u001f\u007f]/.test(syncKey.content))
        return { ok: false };
    return { ok: true, syncKey: syncKey.content };
}
function isActiveSyncAuthenticationFailure(error) {
    return Boolean(error && typeof error === 'object'
        && error.authenticationFailed === true);
}
function classifyActiveSyncCollection(collectionId) {
    if (collectionId === 'contacts')
        return { kind: 'contacts' };
    const calendarMatch = collectionId.match(/^cal-([1-9][0-9]*)$/);
    if (calendarMatch)
        return { kind: 'calendar', calendarId: calendarMatch[1] };
    if (/^m-[0-9a-f]{62}$/.test(collectionId))
        return { kind: 'mail', folderPath: null };
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