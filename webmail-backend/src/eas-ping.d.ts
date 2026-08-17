import type { WbxmlNode } from './wbxml/parser';
export declare const ACTIVE_SYNC_PING_MIN_HEARTBEAT_SECONDS = 60;
export declare const ACTIVE_SYNC_PING_MAX_HEARTBEAT_SECONDS = 900;
export declare const ACTIVE_SYNC_PING_MAX_FOLDERS = 32;
export declare const ACTIVE_SYNC_PING_MAX_REQUEST_BYTES: number;
export declare const ACTIVE_SYNC_PING_MAX_CACHED_CONFIGS = 4096;
export declare const ACTIVE_SYNC_PING_MAX_CACHED_CONFIGS_PER_OWNER = 64;
export declare const ACTIVE_SYNC_PING_CONFIG_TTL_MS: number;
export declare const ACTIVE_SYNC_PING_MAX_ACTIVE_WAITS = 64;
export declare const ACTIVE_SYNC_PING_MAX_ACTIVE_WAITS_PER_OWNER = 8;
export declare const ACTIVE_SYNC_PING_MAX_ACTIVE_WAITS_PER_SCOPE = 2;
export declare const ACTIVE_SYNC_PING_POLL_INTERVAL_MS = 15000;
export type ActiveSyncPingFolderClass = 'Email' | 'Calendar' | 'Contacts';
export interface ActiveSyncPingFolder {
    id: string;
    className: ActiveSyncPingFolderClass;
}
export interface ActiveSyncPingConfig {
    heartbeatSeconds: number;
    folders: ActiveSyncPingFolder[];
}
export type ActiveSyncPingResolvedFolder = {
    id: string;
    className: 'Email';
    kind: 'mail';
    folderPath: string;
} | {
    id: 'contacts';
    className: 'Contacts';
    kind: 'contacts';
} | {
    id: string;
    className: 'Calendar';
    kind: 'calendar';
    calendarId: number;
};
export type ActiveSyncPingFolderResolution = {
    ok: true;
    folders: ActiveSyncPingResolvedFolder[];
} | {
    ok: false;
    response: ActiveSyncPingResponse;
};
export type ActiveSyncPingResponse = {
    status: '1' | '3' | '4' | '7' | '8' | '101' | '102' | '103' | '108' | '109' | '130' | '138';
} | {
    status: '2';
    folders: string[];
} | {
    status: '5';
    heartbeatSeconds: number;
} | {
    status: '6';
    maxFolders: number;
};
export type ActiveSyncPingParseResult = {
    ok: true;
    config: ActiveSyncPingConfig;
} | {
    ok: false;
    response: ActiveSyncPingResponse;
};
export declare const activeSyncPingScopePrefix: (owner: string, deviceId: string) => string;
export declare class ActiveSyncPingConfigCache {
    private readonly entries;
    private readonly maxEntries;
    private readonly maxEntriesPerOwner;
    private readonly ttlMs;
    private readonly now;
    constructor(options?: {
        maxEntries?: number;
        maxEntriesPerOwner?: number;
        ttlMs?: number;
        now?: () => number;
    });
    private pruneExpired;
    get size(): number;
    get(owner: string, deviceId: string): ActiveSyncPingConfig | null;
    set(owner: string, deviceId: string, config: ActiveSyncPingConfig): boolean;
    delete(owner: string, deviceId: string): void;
}
export declare class ActiveSyncPingAbortedError extends Error {
    constructor(message?: string);
}
export declare class ActiveSyncPingSupersededError extends ActiveSyncPingAbortedError {
    constructor();
}
export interface ActiveSyncPingWaitLease {
    signal: AbortSignal;
    abort: (reason?: Error) => void;
    release: () => void;
}
export interface ActiveSyncPingPreflightReservation extends ActiveSyncPingWaitLease {
    activate: () => ActiveSyncPingWaitLease | null;
}
export declare class ActiveSyncPingWaitRegistry {
    private readonly waits;
    private readonly currentByScope;
    private readonly latestActivatedGenerationByScope;
    private nextGeneration;
    private readonly maxActive;
    private readonly maxActivePerOwner;
    private readonly maxActivePerScope;
    constructor(options?: {
        maxActive?: number;
        maxActivePerOwner?: number;
        maxActivePerScope?: number;
    });
    get activeCount(): number;
    reserve(owner: string, deviceId: string): ActiveSyncPingPreflightReservation | null;
    acquire(owner: string, deviceId: string): ActiveSyncPingWaitLease | null;
    abortAll(reason?: ActiveSyncPingAbortedError): void;
}
export type ActiveSyncPingPollResult = {
    kind: 'none';
} | {
    kind: 'changed';
    folderIds: string[];
} | {
    kind: 'hierarchy';
};
export interface ActiveSyncPingFolderSnapshot {
    folderId: string;
    exists: boolean;
    initialized: boolean;
    hasAdditions: boolean;
}
export declare function activeSyncPingHasAdditions(knownItemIds: string[], currentItemIds: string[], maximumItems: number): boolean;
export declare function activeSyncPingMailCursorNeedsSnapshot(syncModseq: string, liveModseq: string, lastProbedModseq?: string): boolean;
export declare function evaluateActiveSyncPingChanges(folders: ActiveSyncPingResolvedFolder[], signal: AbortSignal | undefined, loadSnapshots: (folders: ActiveSyncPingResolvedFolder[], signal?: AbortSignal) => Promise<ActiveSyncPingFolderSnapshot[]>): Promise<ActiveSyncPingPollResult>;
export interface ActiveSyncPingScheduler {
    now: () => number;
    setTimeout: (callback: () => void, delayMs: number) => unknown;
    clearTimeout: (timer: unknown) => void;
}
export interface ActiveSyncPingWaitHandle {
    response: Promise<ActiveSyncPingResponse>;
    drained: Promise<void>;
}
export declare function startActiveSyncPingWait(options: {
    heartbeatSeconds: number;
    folders: ActiveSyncPingResolvedFolder[];
    poll: (folders: ActiveSyncPingResolvedFolder[], signal?: AbortSignal) => Promise<ActiveSyncPingPollResult>;
    signal?: AbortSignal;
    scheduler?: ActiveSyncPingScheduler;
    pollIntervalMs?: number;
}): ActiveSyncPingWaitHandle;
export declare function waitForActiveSyncPing(options: Parameters<typeof startActiveSyncPingWait>[0]): Promise<ActiveSyncPingResponse>;
export declare function parseActiveSyncPingRequest(decoded: WbxmlNode | null, cached?: ActiveSyncPingConfig | null): ActiveSyncPingParseResult;
export declare function resolveActiveSyncPingFolders(requested: ActiveSyncPingFolder[], available: ActiveSyncPingResolvedFolder[]): ActiveSyncPingFolderResolution;
export declare function activeSyncPingResponseNode(response: ActiveSyncPingResponse): WbxmlNode;
//# sourceMappingURL=eas-ping.d.ts.map