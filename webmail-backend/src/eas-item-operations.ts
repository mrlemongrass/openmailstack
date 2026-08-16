import { simpleParser } from 'mailparser';
import {
    activeSyncMailMessageUid,
    classifyActiveSyncCollection,
    resolveActiveSyncMailFolderPath,
    type ActiveSyncMailFolder,
} from './eas-protocol';

export const ITEM_OPERATIONS_MAX_SOURCE_BYTES = 16 * 1024 * 1024;
export const ITEM_OPERATIONS_MAX_BODY_BYTES = 10 * 1024 * 1024;
export const ITEM_OPERATIONS_MAX_FETCHES = 100;
export const ITEM_OPERATIONS_MAX_RESPONSE_BODY_BYTES = 16 * 1024 * 1024;
export const ITEM_OPERATIONS_MAX_AGGREGATE_SOURCE_BYTES = 16 * 1024 * 1024;
const ITEM_OPERATIONS_MAX_COLLECTION_ID_CHARS = 1024;
const ITEM_OPERATIONS_MAX_SERVER_ID_CHARS = 53;

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

export type ItemOperationsMailboxTarget =
    | { ok: true; folderPath: string; uid: number }
    | { ok: false; status: string };

export type ItemOperationsFetchRequest =
    | {
        ok: true;
        store: string;
        collectionId: string;
        serverId: string;
        bodyPreferences: ItemOperationsBodyPreference[];
    }
    | { ok: false; collectionId: string; serverId: string; status: '2' };

const childrenWithTag = (node: any, tag: string): any[] => (
    Array.isArray(node?.children)
        ? node.children.filter((child: any) => child?.tag === tag)
        : []
);

const exactChild = (
    node: any,
    tag: string,
    page: number,
    required: boolean,
): { valid: boolean; node: any | null } => {
    const tagged = childrenWithTag(node, tag);
    if (tagged.length === 0) return { valid: !required, node: null };
    if (tagged.length !== 1 || tagged[0]?.page !== page) return { valid: false, node: null };
    return { valid: true, node: tagged[0] };
};

const nodeText = (node: any): string => node?.content?.toString() || '';

export function itemOperationsRequestFetches(decoded: any): any[] | null {
    if (decoded?.tag !== 'ItemOperations' || decoded?.page !== 20 || !Array.isArray(decoded.children)) {
        return null;
    }
    if (decoded.children.some((operation: any) => operation?.tag !== 'Fetch' || operation?.page !== 20)) {
        return null;
    }
    return decoded.children;
}

export function itemOperationsFetchRequest(fetchNode: any): ItemOperationsFetchRequest {
    let collectionId = '';
    let serverId = '';
    const invalid = (): ItemOperationsFetchRequest => ({
        ok: false,
        collectionId,
        serverId,
        status: '2',
    });

    if (fetchNode?.tag !== 'Fetch' || fetchNode?.page !== 20) return invalid();
    const allowedFetchChildren = new Set(['Store', 'CollectionId', 'ServerId', 'Options']);
    for (const child of fetchNode.children || []) {
        if (!allowedFetchChildren.has(child?.tag)) return invalid();
    }
    const storeNode = exactChild(fetchNode, 'Store', 20, true);
    const collectionNode = exactChild(fetchNode, 'CollectionId', 0, true);
    const serverNode = exactChild(fetchNode, 'ServerId', 0, true);
    const optionsNode = exactChild(fetchNode, 'Options', 20, false);
    if (!storeNode.valid || !collectionNode.valid || !serverNode.valid || !optionsNode.valid) return invalid();

    collectionId = nodeText(collectionNode.node);
    serverId = nodeText(serverNode.node);
    let bodyType = 1;
    let requestedBytes = ITEM_OPERATIONS_MAX_BODY_BYTES;
    let allowTruncation = false;
    let bodyPreferences: ItemOperationsBodyPreference[] = [];
    if (optionsNode.node) {
        if ((optionsNode.node.children || []).some((child: any) => (
            child?.tag !== 'BodyPreference' || child?.page !== 17
        ))) return invalid();
        const preferenceNodes = childrenWithTag(optionsNode.node, 'BodyPreference');
        const seenTypes = new Set<number>();
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
            if (typeText.length > 2 || !/^[0-9]+$/.test(typeText)) return invalid();
            const parsedType = Number.parseInt(typeText, 10);
            if (seenTypes.has(parsedType)) return invalid();
            seenTypes.add(parsedType);

            const truncationText = nodeText(truncationNode.node);
            if (truncationNode.node && (!/^[0-9]+$/.test(truncationText) || truncationText.length > 10)) {
                return invalid();
            }
            const allOrNone = nodeText(allOrNoneNode.node);
            if (allOrNoneNode.node && allOrNone !== '0' && allOrNone !== '1') return invalid();

            if ([1, 2, 4].includes(parsedType)) {
                const hasTruncationSize = Boolean(truncationNode.node);
                bodyPreferences.push({
                    bodyType: parsedType,
                    maxBodyBytes: hasTruncationSize
                        ? Number.parseInt(truncationText, 10)
                        : ITEM_OPERATIONS_MAX_BODY_BYTES,
                    allowTruncation: hasTruncationSize && allOrNone !== '1',
                });
            }
        }
        if (preferenceNodes.length > 0 && bodyPreferences.length === 0) return invalid();
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

export function itemOperationsMailboxTarget(
    store: string,
    collectionId: string,
    serverId: string,
    folders: ActiveSyncMailFolder[],
): ItemOperationsMailboxTarget {
    if (!store) return { ok: false, status: '2' };
    if (store !== 'Mailbox') return { ok: false, status: '9' };
    if (!collectionId || !serverId) return { ok: false, status: '2' };
    if (collectionId.length > ITEM_OPERATIONS_MAX_COLLECTION_ID_CHARS
        || serverId.length > ITEM_OPERATIONS_MAX_SERVER_ID_CHARS
        || !Array.isArray(folders)) {
        return { ok: false, status: '2' };
    }
    const collection = classifyActiveSyncCollection(collectionId);
    if (collection.kind !== 'mail') return { ok: false, status: '2' };
    const uid = activeSyncMailMessageUid(collectionId, serverId);
    if (uid === null || uid > 0xFFFFFFFF) return { ok: false, status: '2' };
    const folderPath = resolveActiveSyncMailFolderPath(collectionId, folders);
    if (!folderPath) return { ok: false, status: '2' };
    return { ok: true, folderPath, uid };
}

export function itemOperationsSourceAllowance(remainingBytes: number): number {
    const remaining = Number.isFinite(remainingBytes) ? Math.max(0, Math.floor(remainingBytes)) : 0;
    return Math.min(remaining, ITEM_OPERATIONS_MAX_SOURCE_BYTES);
}

export function itemOperationsBodyAllowance(remainingBytes: number, requestedBytes: number): number {
    const remaining = Number.isFinite(remainingBytes) ? Math.max(0, Math.floor(remainingBytes)) : 0;
    const requested = Number.isFinite(requestedBytes)
        ? Math.max(0, Math.floor(requestedBytes))
        : ITEM_OPERATIONS_MAX_BODY_BYTES;
    return Math.min(remaining, requested, ITEM_OPERATIONS_MAX_BODY_BYTES);
}

export function itemOperationsFetchBodyBytes(fetchNode: any): number {
    const properties = fetchNode?.children?.find((node: any) => node.tag === 'Properties');
    const body = properties?.children?.find((node: any) => node.tag === 'Body');
    const data = body?.children?.find((node: any) => node.tag === 'Data')?.content;
    return Buffer.byteLength(String(data || ''), 'utf8');
}

const truncateUtf8Body = (value: string, maxBytes: number): {
    data: string;
    estimatedDataSize: number;
    truncated: boolean;
} => {
    const source = Buffer.from(value, 'utf8');
    const limit = Math.max(0, maxBytes);
    if (source.length <= limit) return { data: value, estimatedDataSize: source.length, truncated: false };
    let end = Math.min(limit, source.length);
    while (end > 0 && (source[end] & 0xC0) === 0x80) end -= 1;
    return {
        data: source.subarray(0, end).toString('utf8'),
        estimatedDataSize: source.length,
        truncated: true,
    };
};

export function itemOperationsFetchError(collectionId: string, serverId: string, status: string): any {
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

export async function itemOperationsFetchSuccess(input: ItemOperationsFetchInput): Promise<any> {
    if (!input.message.sourceComplete
        || input.message.size > ITEM_OPERATIONS_MAX_SOURCE_BYTES
        || input.message.source.length > ITEM_OPERATIONS_MAX_SOURCE_BYTES) {
        return itemOperationsFetchError(input.collectionId, input.serverId, '11');
    }

    const parsed = await simpleParser(input.message.source);
    const aggregateLimit = Number.isFinite(input.maxBodyBytes)
        ? Math.max(0, Math.min(ITEM_OPERATIONS_MAX_BODY_BYTES, Math.floor(input.maxBodyBytes)))
        : ITEM_OPERATIONS_MAX_BODY_BYTES;
    let selected: { bodyType: number; body: ReturnType<typeof truncateUtf8Body> } | null = null;
    const preferences = input.bodyPreferences.length > 0
        ? input.bodyPreferences
        : [{ bodyType: 1, maxBodyBytes: ITEM_OPERATIONS_MAX_BODY_BYTES, allowTruncation: false }];
    for (const preference of preferences) {
        const bodyType = [1, 2, 4].includes(preference.bodyType) ? preference.bodyType : 1;
        let bodyData = parsed.text || '';
        if (bodyType === 2) bodyData = typeof parsed.html === 'string' ? parsed.html : bodyData;
        if (bodyType === 4) bodyData = input.message.source.toString('utf8');
        const preferenceLimit = Number.isFinite(preference.maxBodyBytes)
            ? Math.max(0, Math.floor(preference.maxBodyBytes))
            : ITEM_OPERATIONS_MAX_BODY_BYTES;
        const body = truncateUtf8Body(bodyData, Math.min(aggregateLimit, preferenceLimit));
        if (body.truncated && !preference.allowTruncation) continue;
        selected = { bodyType, body };
        break;
    }
    if (!selected) return itemOperationsFetchError(input.collectionId, input.serverId, '11');
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
                { tag: 'To', page: 2, content: (parsed.to as any)?.text || '' },
                { tag: 'From', page: 2, content: (parsed.from as any)?.text || '' },
                { tag: 'Subject', page: 2, content: parsed.subject || '' },
                { tag: 'DateReceived', page: 2, content: (parsed.date || new Date(0)).toISOString() },
                { tag: 'DisplayTo', page: 2, content: (parsed.to as any)?.text || '' },
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
