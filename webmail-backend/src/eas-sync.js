"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.validateActiveSyncCollectionRequest = validateActiveSyncCollectionRequest;
exports.singleActiveSyncCollection = singleActiveSyncCollection;
exports.parseActiveSyncGetChanges = parseActiveSyncGetChanges;
exports.normalizeActiveSyncWindowSize = normalizeActiveSyncWindowSize;
exports.shouldSendActiveSyncServerChanges = shouldSendActiveSyncServerChanges;
const boundedStringScalar = (node, maxBytes, allowEmpty = false) => {
    if (!node || node.children?.length || typeof node.content !== 'string')
        return false;
    const bytes = Buffer.byteLength(node.content, 'utf8');
    return bytes <= maxBytes && (allowEmpty || bytes > 0) && !/[\u0000-\u001f\u007f]/.test(node.content);
};
const emptyElement = (node) => node && (!node.children || node.children.length === 0)
    && (node.content === undefined || node.content === null || node.content === '');
const safeCollectionId = (value) => {
    if (Buffer.byteLength(value, 'utf8') > 1024 || /[\u0000-\u001f\u007f]/.test(value))
        return false;
    if (value === 'contacts')
        return true;
    if (/^cal-[1-9][0-9]{0,18}$/.test(value) || /^m-[0-9a-f]{62}$/.test(value))
        return true;
    if (Buffer.byteLength(value, 'utf8') > 40 || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value))
        return false;
    const decoded = Buffer.from(value, 'base64');
    return decoded.length > 0 && decoded.length <= 30 && decoded.toString('base64') === value
        && Buffer.from(decoded.toString('utf8'), 'utf8').equals(decoded);
};
const validOptions = (node) => {
    if (node.content !== undefined && node.content !== null || !Array.isArray(node.children) || node.children.length > 16)
        return false;
    const seen = new Set();
    for (const option of node.children) {
        const identity = `${option?.page}:${option?.tag}`;
        if (seen.has(identity))
            return false;
        seen.add(identity);
        if (option?.page === 0 && ['FilterType', 'MIMESupport', 'MIMETruncation'].includes(option.tag)) {
            if (!boundedStringScalar(option, 10) || !/^[0-9]+$/.test(option.content))
                return false;
            continue;
        }
        if (option?.page === 0 && option.tag === 'Conflict') {
            if (!boundedStringScalar(option, 1) || !/^[01]$/.test(option.content))
                return false;
            continue;
        }
        if (option?.page === 17 && ['BodyPreference', 'BodyPartPreference'].includes(option.tag)) {
            if (option.content !== undefined && option.content !== null || !Array.isArray(option.children) || option.children.length > 8)
                return false;
            const bodySeen = new Set();
            for (const child of option.children) {
                if (child?.page !== 17 || bodySeen.has(child.tag)
                    || !['Type', 'TruncationSize', 'AllOrNone', 'Preview'].includes(child?.tag)
                    || !boundedStringScalar(child, 10) || !/^[0-9]+$/.test(child.content))
                    return false;
                bodySeen.add(child.tag);
            }
            if (!bodySeen.has('Type'))
                return false;
            continue;
        }
        return false;
    }
    return true;
};
function validateActiveSyncCollectionRequest(collection) {
    if (collection?.tag !== 'Collection' || collection?.page !== 0
        || collection.content !== undefined && collection.content !== null
        || !Array.isArray(collection.children)) {
        return { ok: false };
    }
    const order = new Map([
        ['SyncKey', 0],
        ['CollectionId', 1],
        ['Supported', 2],
        ['DeletesAsMoves', 3],
        ['GetChanges', 4],
        ['WindowSize', 5],
        ['ConversationMode', 6],
        ['Options', 7],
        ['Commands', 8],
    ]);
    const requestSyncKey = collection.children.find((child) => child?.page === 0 && child.tag === 'SyncKey')?.content;
    const counts = new Map();
    let supportedNode = null;
    let priorRank = -1;
    for (const child of collection.children) {
        const rank = order.get(child?.tag);
        const count = (counts.get(child?.tag) || 0) + 1;
        const maxCount = child?.tag === 'Options' ? 2 : 1;
        if (rank === undefined || child?.page !== 0 || count > maxCount || rank < priorRank)
            return { ok: false };
        counts.set(child.tag, count);
        priorRank = rank;
        if (child.tag === 'SyncKey') {
            if (!boundedStringScalar(child, 96))
                return { ok: false };
        }
        else if (child.tag === 'CollectionId') {
            if (!boundedStringScalar(child, 1024) || !safeCollectionId(child.content))
                return { ok: false };
        }
        else if (['DeletesAsMoves', 'ConversationMode'].includes(child.tag)) {
            if (!boundedStringScalar(child, 1) || !/^[01]$/.test(child.content))
                return { ok: false };
        }
        else if (child.tag === 'GetChanges') {
            if (!(emptyElement(child) || boundedStringScalar(child, 1) && /^[01]$/.test(child.content)))
                return { ok: false };
        }
        else if (child.tag === 'WindowSize') {
            if (!boundedStringScalar(child, 3) || !/^[0-9]{1,3}$/.test(child.content))
                return { ok: false };
        }
        else if (child.tag === 'Options') {
            if (!validOptions(child))
                return { ok: false };
        }
        else if (child.tag === 'Commands') {
            if (child.content !== undefined && child.content !== null || !Array.isArray(child.children) || child.children.length > 512)
                return { ok: false };
        }
        else if (child.tag === 'Supported') {
            supportedNode = child;
        }
    }
    if (!counts.has('SyncKey') || !counts.has('CollectionId'))
        return { ok: false };
    if (supportedNode) {
        const supportedFields = new Set();
        if (supportedNode.content !== undefined && supportedNode.content !== null
            || !Array.isArray(supportedNode.children) || supportedNode.children.length > 128
            || supportedNode.children.some((supported) => {
                const identity = `${supported?.page}:${supported?.tag}`;
                if (!Number.isInteger(supported?.page) || typeof supported?.tag !== 'string'
                    || supportedFields.has(identity) || !emptyElement(supported))
                    return true;
                supportedFields.add(identity);
                return false;
            }))
            return { ok: false };
    }
    return { ok: true };
}
function singleActiveSyncCollection(decoded) {
    if (decoded?.tag !== 'Sync' || decoded?.page !== 0 || !Array.isArray(decoded.children)) {
        return { ok: false, status: '4' };
    }
    if (decoded.children.length !== 1)
        return { ok: false, status: '4' };
    const containers = decoded.children.filter((child) => child?.tag === 'Collections');
    if (containers.length !== 1 || containers[0]?.page !== 0 || !Array.isArray(containers[0].children)) {
        return { ok: false, status: '4' };
    }
    if (containers[0].children.length === 0)
        return { ok: false, status: '4' };
    if (containers[0].children.length > 1)
        return { ok: false, status: '15' };
    const collection = containers[0].children[0];
    if (collection?.tag !== 'Collection' || collection?.page !== 0)
        return { ok: false, status: '4' };
    return { ok: true, collection };
}
function parseActiveSyncGetChanges(syncKey, node) {
    if (!node)
        return { ok: true, value: syncKey !== '0' };
    const value = node.content?.toString() || '';
    if (value === '' || value === '1')
        return syncKey === '0' ? { ok: false } : { ok: true, value: true };
    if (value === '0')
        return { ok: true, value: false };
    return { ok: false };
}
function normalizeActiveSyncWindowSize(value, fallback = 100) {
    if (value === undefined || value === null) {
        return Number.isInteger(fallback) && fallback >= 1 && fallback <= 512 ? fallback : 100;
    }
    const text = String(value);
    if (!/^[0-9]+$/.test(text))
        throw new Error('Invalid ActiveSync WindowSize');
    const parsed = Number.parseInt(text, 10);
    if (parsed === 0 || parsed > 512)
        return 512;
    return parsed;
}
function shouldSendActiveSyncServerChanges(decision) {
    if (decision.syncKey === '0')
        return false;
    const keyNeedsRefresh = decision.syncKey === '1' || decision.syncKey !== decision.nextSyncKey;
    if (!keyNeedsRefresh)
        return false;
    if (decision.hasClientCommands && !decision.getChangesRequested)
        return false;
    return true;
}
//# sourceMappingURL=eas-sync.js.map