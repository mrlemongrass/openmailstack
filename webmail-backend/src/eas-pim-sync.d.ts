import type { PoolConnection } from 'mysql2/promise';
export declare const MAX_PIM_KNOWN_ITEMS = 50000;
export declare const MAX_PIM_KNOWN_ITEMS_BYTES: number;
export declare const MAX_PIM_ITEM_SOURCE_BYTES: number;
export declare const MAX_PIM_SNAPSHOT_SOURCE_BYTES: number;
export declare const MAX_PIM_SYNC_CLIENT_COMMANDS = 512;
export declare const MAX_PIM_SYNC_REPLAY_BYTES: number;
export declare const MAX_PIM_SYNC_RESPONSE_BYTES: number;
export declare const MAX_PIM_SYNC_COMMANDS_BYTES: number;
export declare const MAX_PIM_SYNC_ROW_BYTES: number;
export declare const MAX_PIM_SYNC_USER_BYTES: number;
export declare const MAX_PIM_SYNC_PARTNERSHIPS_PER_USER = 256;
export declare const PIM_SYNC_STATE_TTL_MS: number;
export type PimKnownItems = Record<string, string>;
export type PimSyncCommandType = 'Add' | 'Change' | 'Delete';
export type PimDataClass = 'Contacts' | 'Calendar';
export declare const PIM_QUARANTINE_PREFIX = "q:";
export interface PimSupportedProperties {
    wasPresent: boolean;
    fields: string[];
}
export type PimSqlConnection = PoolConnection;
export interface PimSqlSecondaryLock {
    acquire: (connection: PimSqlConnection) => Promise<unknown>;
    release: (connection: PimSqlConnection, lease: unknown) => Promise<void>;
}
export interface PimSnapshotItem {
    serverId: string;
    sourceId?: string;
    fingerprint: string;
}
export interface PimSnapshotMetadata extends PimSnapshotItem {
    sourceId: string;
    sourceBytes: number;
    versionToken?: number;
}
export interface BoundedPimSnapshot {
    items: PimSnapshotItem[];
    byServerId: Map<string, PimSnapshotMetadata>;
}
export interface PimSyncCommand extends PimSnapshotItem {
    type: PimSyncCommandType;
}
export interface StoredPimSyncState {
    scopeHash: string;
    username: string;
    deviceId: string;
    collectionId: string;
    currentSyncKey: string;
    previousSyncKey: string | null;
    windowSize: number;
    supportedWasPresent: boolean;
    supportedFields: string[];
    knownItems: PimKnownItems;
    lastCommands: PimSyncCommand[];
    lastMoreAvailable: boolean;
    lastRequestHash: string | null;
    lastResponse: Buffer | null;
    updatedAt: Date;
}
export declare class PimSyncLimitError extends Error {
    constructor(message: string);
}
export declare class PimSyncStateError extends Error {
    constructor(message: string);
}
export declare function parsePimSupportedProperties(collection: any, dataClass: PimDataClass): {
    ok: true;
    value: PimSupportedProperties;
} | {
    ok: false;
};
export declare function pimOmittedFieldsToClear(applicationData: any, dataClass: PimDataClass, supported: PimSupportedProperties): Set<string>;
export declare function serializePimSupportedFields(fields: string[]): string;
export declare function parsePimSupportedFields(value: unknown): string[];
export declare function assertPimKnownItemsBound(knownItems: PimKnownItems): string;
export declare function parsePimKnownItems(value: unknown): PimKnownItems;
export declare const pimItemFingerprint: (serverId: string, version: string) => string;
export declare const pimSyncScopeHash: (username: string, deviceId: string, collectionId: string) => string;
export declare const pimSyncRequestHash: (requestBody: Buffer) => string;
export declare const pimWireServerId: (collectionId: string, sourceId: string) => string;
export declare const createPimSyncKey: () => string;
export declare function deterministicPimAddServerId(scopeHash: string, syncKey: string, clientId: string): string;
export declare function validatePimClientCommands(commands: any[], dataClass: 'Contacts' | 'Calendar'): {
    ok: true;
} | {
    ok: false;
};
export declare const pimSyncStateDisposition: (state: Pick<StoredPimSyncState, "currentSyncKey" | "updatedAt"> | null, syncKey: string, now?: Date) => "prime" | "current" | "stale";
export declare const pimSyncReplayResponse: (state: Pick<StoredPimSyncState, "previousSyncKey" | "lastRequestHash" | "lastResponse" | "updatedAt"> | null, syncKey: string, requestHash: string, now?: Date) => Buffer | null;
export declare function computePimSyncDelta(input: {
    knownItems: PimKnownItems;
    snapshot: PimSnapshotItem[];
    windowSize: number;
}): {
    commands: PimSyncCommand[];
    nextKnownItems: PimKnownItems;
    moreAvailable: boolean;
};
export declare const pimQuarantineFingerprint: (sourceFingerprint: string) => string;
export declare function pimQuarantineCommand(command: PimSyncCommand, knownItems: PimKnownItems): {
    fingerprint: string;
    wireCommand: PimSyncCommand | null;
};
export declare function normalizePimQuarantineState(knownItems: PimKnownItems, snapshot: PimSnapshotItem[]): {
    knownItems: PimKnownItems;
    snapshot: PimSnapshotItem[];
};
export declare function assertPimSnapshotBound(snapshot: PimSnapshotItem[]): Map<string, string>;
export declare function loadBoundedContactPimSnapshot(connection: Pick<PimSqlConnection, 'query'>, username: string, collectionId: string): Promise<BoundedPimSnapshot>;
export declare function loadBoundedCalendarPimSnapshot(connection: Pick<PimSqlConnection, 'query'>, calendarId: number, collectionId: string): Promise<BoundedPimSnapshot>;
export declare function advancePimKnownItems(knownItems: PimKnownItems, commands: PimSyncCommand[]): PimKnownItems;
export declare function fitPimSyncCommandsToByteBudget(commands: PimSyncCommand[], encodedCommandBytes: number[], baseResponseBytes: number, maxBytes?: number): {
    commands: PimSyncCommand[];
    moreAvailable: boolean;
};
export declare function assertPimSyncRowBound(knownItems: string, commands: string, response: Buffer | null, supportedFields?: string): void;
export declare function applyAcceptedPimWrites(knownItems: PimKnownItems, acceptedUpserts: Record<string, string>, acceptedDeletes: string[]): PimKnownItems;
export declare const ensureEasPimSyncSchema: () => Promise<void>;
export declare const pimSqlLockName: (username: string) => string;
export declare function withPimSqlTransaction<T>(username: string, operation: (connection: PimSqlConnection) => Promise<T>, secondaryLock?: PimSqlSecondaryLock): Promise<T>;
export declare const loadPimSyncStateOnConnection: (connection: PimSqlConnection, username: string, deviceId: string, collectionId: string) => Promise<StoredPimSyncState | null>;
export declare const loadPimSyncState: (username: string, deviceId: string, collectionId: string) => Promise<StoredPimSyncState | null>;
export declare const savePimSyncStateOnConnection: (connection: PimSqlConnection, state: StoredPimSyncState) => Promise<void>;
export declare const savePimSyncState: (state: StoredPimSyncState) => Promise<void>;
export declare const deletePimSyncStateOnConnection: (connection: PimSqlConnection, username: string, deviceId: string, collectionId: string) => Promise<void>;
export declare const deletePimSyncState: (username: string, deviceId: string, collectionId: string) => Promise<void>;
export declare function withPimSyncScopeLock<T>(scopeHash: string, operation: () => Promise<T>): Promise<T>;
export declare function withPimCollectionLock<T>(collectionKey: string, operation: () => Promise<T>): Promise<T>;
//# sourceMappingURL=eas-pim-sync.d.ts.map