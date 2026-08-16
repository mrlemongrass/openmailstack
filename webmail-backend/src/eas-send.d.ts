type ActiveSyncNode = {
    tag?: string;
    page?: number;
    content?: Buffer | string | {
        toString?: () => string;
    } | null;
    children?: ActiveSyncNode[];
};
export type ActiveSyncSendMailStatus = '101' | '102' | '107' | '108' | '116' | '118' | '119' | '120' | '166';
export declare class ActiveSyncSendMailRequestError extends Error {
    readonly status: ActiveSyncSendMailStatus;
    constructor(message: string, status: ActiveSyncSendMailStatus);
}
export interface ParsedActiveSyncSendMailRequest {
    clientId: string;
    mime: Buffer;
    saveInSentItems: boolean;
    accountId: string | null;
}
export interface PreparedActiveSyncSendMailSubmission {
    raw: Buffer;
    sentRaw: Buffer;
    envelope: {
        from: string;
        to: string[];
    };
    messageId: string;
    metadata: Record<string, any>;
    fingerprintSource: Record<string, any>;
}
export declare const isLikelyRawMime: (content: ActiveSyncNode["content"]) => boolean;
export declare const extractActiveSyncSendMailMime: (decoded: ActiveSyncNode) => Buffer | string;
export declare const parseActiveSyncSendMailRequest: (decoded: ActiveSyncNode | null | undefined) => ParsedActiveSyncSendMailRequest;
export declare const activeSyncSendMailIdempotencyKey: (authenticatedUser: string, deviceId: string, clientId: string) => string;
export declare const prepareActiveSyncSendMailSubmission: (rawMime: Buffer | string, authenticatedUser: string, deviceId: string, clientId: string) => Promise<PreparedActiveSyncSendMailSubmission>;
export declare const activeSyncSendMailResultStatus: (result: {
    replayed: boolean;
    status: string;
    smtpAccepted: boolean;
    rejectedRecipients: string[];
}) => ActiveSyncSendMailStatus | null;
export declare const summarizeActiveSyncNodeForLog: (node: ActiveSyncNode) => Record<string, unknown>;
export declare const buildActiveSyncSendMailEnvelope: (rawMime: Buffer | string, authenticatedUser: string) => Promise<{
    from: string;
    to: string[];
}>;
export {};
//# sourceMappingURL=eas-send.d.ts.map