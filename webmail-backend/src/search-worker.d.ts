export declare const getSearchIndexCoverage: (username: string, folders: string[]) => Promise<Map<string, {
    uidValidity: string;
    lastUidIndexed: number;
}>>;
export interface SearchIndexSnapshot {
    folderPaths: string[];
    uidNextByFolder: Map<string, number>;
    uidValidityByFolder: Map<string, string>;
    ageMs: number;
}
export declare const invalidateSearchIndexSnapshot: (username: string) => Promise<void>;
export declare const getFreshSearchIndexSnapshot: (username: string, scope: "folder" | "all", folder: string, maxAgeMs?: number) => Promise<SearchIndexSnapshot | null>;
export declare const invalidateSearchIndexFolderIdentity: (username: string, folder: string, uidValidity: string) => Promise<void>;
export declare const runSearchIndexer: () => Promise<void>;
export interface SearchWorkerStatus {
    totalUsers: number;
    totalFolders: number;
    totalIndexedMessages: number;
    lastUpdatedAt: Date | string | null;
    folders: Array<{
        username: string;
        folder: string;
        uidValidity: string;
        lastUidIndexed: number;
        lastFullSyncAt: Date | string | null;
        messageCount: number;
        indexedCount: number;
        updatedAt: Date | string | null;
    }>;
}
export declare const getSearchWorkerStatus: () => Promise<SearchWorkerStatus>;
export declare const purgeUserSearchIndex: (username: string) => Promise<any>;
export declare const startSearchWorker: () => void;
//# sourceMappingURL=search-worker.d.ts.map