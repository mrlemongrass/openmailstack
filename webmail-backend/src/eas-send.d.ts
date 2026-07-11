type ActiveSyncNode = {
    tag?: string;
    page?: number;
    content?: Buffer | string | {
        toString?: () => string;
    } | null;
    children?: ActiveSyncNode[];
};
export declare const isLikelyRawMime: (content: ActiveSyncNode["content"]) => boolean;
export declare const extractActiveSyncSendMailMime: (decoded: ActiveSyncNode) => Buffer | string;
export declare const summarizeActiveSyncNodeForLog: (node: ActiveSyncNode) => Record<string, unknown>;
export declare const buildActiveSyncSendMailEnvelope: (rawMime: Buffer | string, authenticatedUser: string) => Promise<{
    from: string;
    to: string[];
}>;
export {};
//# sourceMappingURL=eas-send.d.ts.map