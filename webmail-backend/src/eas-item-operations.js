"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ITEM_OPERATIONS_MAX_AGGREGATE_SOURCE_BYTES = exports.ITEM_OPERATIONS_MAX_RESPONSE_BODY_BYTES = exports.ITEM_OPERATIONS_MAX_FETCHES = exports.ITEM_OPERATIONS_MAX_BODY_BYTES = exports.ITEM_OPERATIONS_MAX_SOURCE_BYTES = void 0;
exports.itemOperationsRequestFetches = itemOperationsRequestFetches;
exports.itemOperationsFetchRequest = itemOperationsFetchRequest;
exports.itemOperationsMailboxTarget = itemOperationsMailboxTarget;
exports.itemOperationsSourceAllowance = itemOperationsSourceAllowance;
exports.itemOperationsBodyAllowance = itemOperationsBodyAllowance;
exports.itemOperationsFetchBodyBytes = itemOperationsFetchBodyBytes;
exports.itemOperationsFetchError = itemOperationsFetchError;
exports.itemOperationsFetchSuccess = itemOperationsFetchSuccess;
const mailparser_1 = require("mailparser");
const eas_protocol_1 = require("./eas-protocol");
exports.ITEM_OPERATIONS_MAX_SOURCE_BYTES = 16 * 1024 * 1024;
exports.ITEM_OPERATIONS_MAX_BODY_BYTES = 10 * 1024 * 1024;
exports.ITEM_OPERATIONS_MAX_FETCHES = 100;
exports.ITEM_OPERATIONS_MAX_RESPONSE_BODY_BYTES = 16 * 1024 * 1024;
exports.ITEM_OPERATIONS_MAX_AGGREGATE_SOURCE_BYTES = 16 * 1024 * 1024;
const ITEM_OPERATIONS_MAX_COLLECTION_ID_CHARS = 1024;
const ITEM_OPERATIONS_MAX_SERVER_ID_CHARS = 53;
const childrenWithTag = (node, tag) => (Array.isArray(node?.children)
    ? node.children.filter((child) => child?.tag === tag)
    : []);
const exactChild = (node, tag, page, required) => {
    const tagged = childrenWithTag(node, tag);
    if (tagged.length === 0)
        return { valid: !required, node: null };
    if (tagged.length !== 1 || tagged[0]?.page !== page)
        return { valid: false, node: null };
    return { valid: true, node: tagged[0] };
};
const nodeText = (node) => node?.content?.toString() || '';
function itemOperationsRequestFetches(decoded) {
    if (decoded?.tag !== 'ItemOperations' || decoded?.page !== 20 || !Array.isArray(decoded.children)) {
        return null;
    }
    if (decoded.children.some((operation) => operation?.tag !== 'Fetch' || operation?.page !== 20)) {
        return null;
    }
    return decoded.children;
}
function itemOperationsFetchRequest(fetchNode) {
    let collectionId = '';
    let serverId = '';
    const invalid = () => ({
        ok: false,
        collectionId,
        serverId,
        status: '2',
    });
    if (fetchNode?.tag !== 'Fetch' || fetchNode?.page !== 20)
        return invalid();
    const allowedFetchChildren = new Set(['Store', 'CollectionId', 'ServerId', 'Options']);
    for (const child of fetchNode.children || []) {
        if (!allowedFetchChildren.has(child?.tag))
            return invalid();
    }
    const storeNode = exactChild(fetchNode, 'Store', 20, true);
    const collectionNode = exactChild(fetchNode, 'CollectionId', 0, true);
    const serverNode = exactChild(fetchNode, 'ServerId', 0, true);
    const optionsNode = exactChild(fetchNode, 'Options', 20, false);
    if (!storeNode.valid || !collectionNode.valid || !serverNode.valid || !optionsNode.valid)
        return invalid();
    collectionId = nodeText(collectionNode.node);
    serverId = nodeText(serverNode.node);
    let bodyType = 1;
    let requestedBytes = exports.ITEM_OPERATIONS_MAX_BODY_BYTES;
    let allowTruncation = false;
    let bodyPreferences = [];
    if (optionsNode.node) {
        if ((optionsNode.node.children || []).some((child) => (child?.tag !== 'BodyPreference' || child?.page !== 17)))
            return invalid();
        const preferenceNodes = childrenWithTag(optionsNode.node, 'BodyPreference');
        const seenTypes = new Set();
        for (const preferenceNode of preferenceNodes) {
            const allowedPreferenceChildren = new Map([
                ['Type', 0],
                ['TruncationSize', 1],
                ['AllOrNone', 2],
            ]);
            let previousPreferenceChild = -1;
            for (const child of preferenceNode.children || []) {
                const childOrder = allowedPreferenceChildren.get(child?.tag);
                if (child?.page !== 17 || childOrder === undefined || childOrder < previousPreferenceChild) {
                    return invalid();
                }
                previousPreferenceChild = childOrder;
            }
            const typeNode = exactChild(preferenceNode, 'Type', 17, true);
            const truncationNode = exactChild(preferenceNode, 'TruncationSize', 17, false);
            const allOrNoneNode = exactChild(preferenceNode, 'AllOrNone', 17, false);
            if (!typeNode.valid || !truncationNode.valid || !allOrNoneNode.valid) {
                return invalid();
            }
            const typeText = nodeText(typeNode.node);
            if (typeText.length > 2 || !/^[0-9]+$/.test(typeText))
                return invalid();
            const parsedType = Number.parseInt(typeText, 10);
            if (seenTypes.has(parsedType))
                return invalid();
            seenTypes.add(parsedType);
            const truncationText = nodeText(truncationNode.node);
            if (truncationNode.node && (!/^[0-9]+$/.test(truncationText) || truncationText.length > 10)) {
                return invalid();
            }
            const allOrNone = nodeText(allOrNoneNode.node);
            if (allOrNoneNode.node && allOrNone !== '0' && allOrNone !== '1')
                return invalid();
            if ([1, 2, 4].includes(parsedType)) {
                const hasTruncationSize = Boolean(truncationNode.node);
                bodyPreferences.push({
                    bodyType: parsedType,
                    maxBodyBytes: hasTruncationSize
                        ? Number.parseInt(truncationText, 10)
                        : exports.ITEM_OPERATIONS_MAX_BODY_BYTES,
                    allowTruncation: hasTruncationSize && allOrNone !== '1',
                });
            }
        }
        if (preferenceNodes.length > 0 && bodyPreferences.length === 0)
            return invalid();
    }
    if (bodyPreferences.length === 0) {
        bodyPreferences = [{ bodyType, maxBodyBytes: requestedBytes, allowTruncation }];
    }
    return {
        ok: true,
        store: nodeText(storeNode.node),
        collectionId,
        serverId,
        bodyPreferences,
    };
}
function itemOperationsMailboxTarget(store, collectionId, serverId, folders) {
    if (!store)
        return { ok: false, status: '2' };
    if (store !== 'Mailbox')
        return { ok: false, status: '9' };
    if (!collectionId || !serverId)
        return { ok: false, status: '2' };
    if (collectionId.length > ITEM_OPERATIONS_MAX_COLLECTION_ID_CHARS
        || serverId.length > ITEM_OPERATIONS_MAX_SERVER_ID_CHARS
        || !Array.isArray(folders)) {
        return { ok: false, status: '2' };
    }
    const collection = (0, eas_protocol_1.classifyActiveSyncCollection)(collectionId);
    if (collection.kind !== 'mail')
        return { ok: false, status: '2' };
    const uid = (0, eas_protocol_1.activeSyncMailMessageUid)(collectionId, serverId);
    if (uid === null || uid > 0xFFFFFFFF)
        return { ok: false, status: '2' };
    const folderPath = (0, eas_protocol_1.resolveActiveSyncMailFolderPath)(collectionId, folders);
    if (!folderPath)
        return { ok: false, status: '2' };
    return { ok: true, folderPath, uid };
}
function itemOperationsSourceAllowance(remainingBytes) {
    const remaining = Number.isFinite(remainingBytes) ? Math.max(0, Math.floor(remainingBytes)) : 0;
    return Math.min(remaining, exports.ITEM_OPERATIONS_MAX_SOURCE_BYTES);
}
function itemOperationsBodyAllowance(remainingBytes, requestedBytes) {
    const remaining = Number.isFinite(remainingBytes) ? Math.max(0, Math.floor(remainingBytes)) : 0;
    const requested = Number.isFinite(requestedBytes)
        ? Math.max(0, Math.floor(requestedBytes))
        : exports.ITEM_OPERATIONS_MAX_BODY_BYTES;
    return Math.min(remaining, requested, exports.ITEM_OPERATIONS_MAX_BODY_BYTES);
}
function itemOperationsFetchBodyBytes(fetchNode) {
    const properties = fetchNode?.children?.find((node) => node.tag === 'Properties');
    const body = properties?.children?.find((node) => node.tag === 'Body');
    const data = body?.children?.find((node) => node.tag === 'Data')?.content;
    return Buffer.byteLength(String(data || ''), 'utf8');
}
const truncateUtf8Body = (value, maxBytes) => {
    const source = Buffer.from(value, 'utf8');
    const limit = Math.max(0, maxBytes);
    if (source.length <= limit)
        return { data: value, estimatedDataSize: source.length, truncated: false };
    let end = Math.min(limit, source.length);
    while (end > 0 && (source[end] & 0xC0) === 0x80)
        end -= 1;
    return {
        data: source.subarray(0, end).toString('utf8'),
        estimatedDataSize: source.length,
        truncated: true,
    };
};
function itemOperationsFetchError(collectionId, serverId, status) {
    return {
        tag: 'Fetch',
        page: 20,
        children: [
            { tag: 'Status', page: 20, content: status },
            ...(collectionId ? [{ tag: 'CollectionId', page: 0, content: collectionId }] : []),
            ...(serverId ? [{ tag: 'ServerId', page: 0, content: serverId }] : []),
        ],
    };
}
async function itemOperationsFetchSuccess(input) {
    if (!input.message.sourceComplete
        || input.message.size > exports.ITEM_OPERATIONS_MAX_SOURCE_BYTES
        || input.message.source.length > exports.ITEM_OPERATIONS_MAX_SOURCE_BYTES) {
        return itemOperationsFetchError(input.collectionId, input.serverId, '11');
    }
    const parsed = await (0, mailparser_1.simpleParser)(input.message.source);
    const aggregateLimit = Number.isFinite(input.maxBodyBytes)
        ? Math.max(0, Math.min(exports.ITEM_OPERATIONS_MAX_BODY_BYTES, Math.floor(input.maxBodyBytes)))
        : exports.ITEM_OPERATIONS_MAX_BODY_BYTES;
    let selected = null;
    const preferences = input.bodyPreferences.length > 0
        ? input.bodyPreferences
        : [{ bodyType: 1, maxBodyBytes: exports.ITEM_OPERATIONS_MAX_BODY_BYTES, allowTruncation: false }];
    for (const preference of preferences) {
        const bodyType = [1, 2, 4].includes(preference.bodyType) ? preference.bodyType : 1;
        let bodyData = parsed.text || '';
        if (bodyType === 2)
            bodyData = typeof parsed.html === 'string' ? parsed.html : bodyData;
        if (bodyType === 4)
            bodyData = input.message.source.toString('utf8');
        const preferenceLimit = Number.isFinite(preference.maxBodyBytes)
            ? Math.max(0, Math.floor(preference.maxBodyBytes))
            : exports.ITEM_OPERATIONS_MAX_BODY_BYTES;
        const body = truncateUtf8Body(bodyData, Math.min(aggregateLimit, preferenceLimit));
        if (body.truncated && !preference.allowTruncation)
            continue;
        selected = { bodyType, body };
        break;
    }
    if (!selected)
        return itemOperationsFetchError(input.collectionId, input.serverId, '11');
    const { bodyType, body } = selected;
    return {
        tag: 'Fetch',
        page: 20,
        children: [
            { tag: 'Status', page: 20, content: '1' },
            { tag: 'CollectionId', page: 0, content: input.collectionId },
            { tag: 'ServerId', page: 0, content: input.serverId },
            { tag: 'Class', page: 0, content: 'Email' },
            { tag: 'Properties', page: 20, children: [
                    { tag: 'To', page: 2, content: parsed.to?.text || '' },
                    { tag: 'From', page: 2, content: parsed.from?.text || '' },
                    { tag: 'Subject', page: 2, content: parsed.subject || '' },
                    { tag: 'DateReceived', page: 2, content: (parsed.date || new Date(0)).toISOString() },
                    { tag: 'DisplayTo', page: 2, content: parsed.to?.text || '' },
                    { tag: 'Read', page: 2, content: input.message.flags.includes('\\Seen') ? '1' : '0' },
                    { tag: 'MessageClass', page: 2, content: 'IPM.Note' },
                    { tag: 'Body', page: 17, children: [
                            { tag: 'Type', page: 17, content: String(bodyType) },
                            { tag: 'EstimatedDataSize', page: 17, content: String(body.estimatedDataSize) },
                            ...(body.truncated ? [{ tag: 'Truncated', page: 17, content: '1' }] : []),
                            { tag: 'Data', page: 17, content: body.data },
                        ] },
                ] },
        ],
    };
}
//# sourceMappingURL=eas-item-operations.js.map