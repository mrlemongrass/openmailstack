import type { WbxmlNode } from './wbxml/parser';

export const ACTIVE_SYNC_MAX_REQUEST_BYTES = 16 * 1024 * 1024;
export const ACTIVE_SYNC_ADVERTISED_COMMANDS = [
    'Sync',
    'FolderSync',
    'ItemOperations',
] as const;
export const ACTIVE_SYNC_UNSUPPORTED_COMMANDS = [
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
] as const;
const MAX_LOG_NODES = 128;
const MAX_LOG_DEPTH = 16;
const MAX_COLLECTION_ID_BYTES = 1024;
const MAX_FOLDER_PATH_BYTES = 512;

export interface ActiveSyncLogSummary {
    method: string;
    command: string;
    bodyBytes: number;
    rootTag?: string;
    nodeCount?: number;
    maxDepth?: number;
    truncated?: boolean;
    parseError?: boolean;
}

export interface ActiveSyncStaticFolder {
    serverId: string;
    parentId: string;
    displayName: string;
    type: string;
}

export type ActiveSyncCollection =
    | { kind: 'contacts' }
    | { kind: 'calendar'; calendarId: string | null }
    | { kind: 'mail'; folderPath: string }
    | { kind: 'unsupported' };

const boundedToken = (value: unknown, fallback: string): string => {
    const token = String(value || '');
    return /^[A-Za-z][A-Za-z0-9]{0,31}$/.test(token) ? token : fallback;
};

export function activeSyncRequestLogSummary(
    method: unknown,
    command: unknown,
    bodyBytes: unknown,
    decoded?: WbxmlNode | null,
    parseError = false,
): ActiveSyncLogSummary {
    const numericBodyBytes = Number(bodyBytes);
    const summary: ActiveSyncLogSummary = {
        method: boundedToken(method, 'UNKNOWN'),
        command: boundedToken(command, 'Unknown'),
        bodyBytes: Number.isFinite(numericBodyBytes)
            ? Math.max(0, Math.min(ACTIVE_SYNC_MAX_REQUEST_BYTES, Math.floor(numericBodyBytes)))
            : 0,
    };

    if (parseError) summary.parseError = true;
    if (!decoded) return summary;

    summary.rootTag = boundedToken(decoded.tag, 'Unknown');
    let nodeCount = 0;
    let maxDepth = 0;
    const pending: Array<{ node: WbxmlNode; depth: number }> = [{ node: decoded, depth: 0 }];
    while (pending.length > 0 && nodeCount < MAX_LOG_NODES) {
        const current = pending.pop()!;
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

export function staticActiveSyncServiceFolders(): ActiveSyncStaticFolder[] {
    return [{
        serverId: 'contacts',
        parentId: '0',
        displayName: 'Contacts',
        type: '9',
    }];
}

const decodeMailCollectionId = (collectionId: string): string | null => {
    if (!collectionId || Buffer.byteLength(collectionId, 'utf8') > MAX_COLLECTION_ID_BYTES) return null;
    if (collectionId.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(collectionId)) return null;

    const bytes = Buffer.from(collectionId, 'base64');
    if (bytes.length === 0 || bytes.length > MAX_FOLDER_PATH_BYTES || bytes.toString('base64') !== collectionId) return null;
    const folderPath = bytes.toString('utf8');
    if (!Buffer.from(folderPath, 'utf8').equals(bytes) || /[\u0000-\u001f\u007f]/.test(folderPath)) return null;
    return folderPath;
};

export function classifyActiveSyncCollection(collectionId: string): ActiveSyncCollection {
    if (collectionId === 'contacts' || collectionId === 'mock-contacts') return { kind: 'contacts' };
    if (collectionId === 'mock-calendar') return { kind: 'calendar', calendarId: null };
    const calendarMatch = collectionId.match(/^cal-([1-9][0-9]*)$/);
    if (calendarMatch) return { kind: 'calendar', calendarId: calendarMatch[1] };
    const folderPath = decodeMailCollectionId(collectionId);
    return folderPath ? { kind: 'mail', folderPath } : { kind: 'unsupported' };
}

export function unsupportedSyncCollectionResponse(collectionId: string, syncKey: string): any {
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

export function activeSyncDeleteCommand(serverId: string): any {
    return {
        tag: 'Delete',
        page: 0,
        children: [{ tag: 'ServerId', page: 0, content: serverId }],
    };
}
