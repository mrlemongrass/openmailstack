export declare const runSearchIndexer: () => Promise<void>;
export interface SearchWorkerStatus {
    totalUsers: number;
    totalFolders: number;
    totalIndexedMessages: number;
    lastUpdatedAt: Date | string | null;
    folders: Array<{
        username: string;
        folder: string;
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