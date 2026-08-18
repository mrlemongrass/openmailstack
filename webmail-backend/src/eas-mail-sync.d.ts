import type { ActiveSyncMailMessage } from './imap';
export type MailReadState = 0 | 1;
export type MailSyncKnownItems = Record<string, MailReadState>;
export type MailSyncCommandType = 'Add' | 'Change' | 'Delete' | 'SoftDelete';
export interface MailSyncCommand {
    type: MailSyncCommandType;
    uid: number;
    isRead?: MailReadState;
}
export interface MailSyncOptions {
    filterType: number;
    windowSize: number;
    bodyType: number;
    truncationSize: number;
}
export interface StoredMailSyncState extends MailSyncOptions {
    scopeHash: string;
    username: string;
    deviceId: string;
    collectionId: string;
    currentSyncKey: string;
    previousSyncKey: string | null;
    uidValidity: string;
    highestModseq: string;
    minimumUid: number;
    knownItems: MailSyncKnownItems;
    lastCommands: MailSyncCommand[];
    lastMoreAvailable: boolean;
    lastRequestHash: string | null;
    lastResponse: Buffer | null;
    updatedAt: Date;
}
export declare class MailSyncStateError extends Error {
    constructor(message: string);
}
interface ComputeMailSyncDeltaInput {
    knownItems: MailSyncKnownItems;
    allUids: number[];
    eligibleUids: number[];
    changedReadFlags: Record<string, MailReadState>;
    filterType: number;
    windowSize: number;
    minimumUid?: number;
}
interface ComputeMailSyncDeltaResult {
    commands: MailSyncCommand[];
    nextKnownItems: MailSyncKnownItems;
    moreAvailable: boolean;
}
export declare function resolveActiveSyncWindowSize(syncKey: string, value: unknown, persistedWindowSize?: number): number;
export declare function normalizeMailSyncOptions(values: Partial<Record<'filterType' | 'windowSize' | 'bodyType' | 'truncationSize', unknown>>, fallback?: MailSyncOptions): MailSyncOptions;
export declare function filterTypeCutoff(filterType: number, now?: Date): Date | null;
export declare function truncateUtf8Body(value: string, maxBytes: number): {
    data: string;
    estimatedDataSize: number;
    truncated: boolean;
};
export declare function activeSyncMailApplicationData(message: ActiveSyncMailMessage, options: Pick<MailSyncOptions, 'bodyType' | 'truncationSize'>): Promise<any[]>;
export declare function computeMailSyncDelta(input: ComputeMailSyncDeltaInput): ComputeMailSyncDeltaResult;
export declare const mailSyncScopeHash: (username: string, deviceId: string, collectionId: string) => string;
export declare const mailSyncRequestHash: (requestBody: Buffer) => string;
export declare const validateActiveSyncDeviceId: (value: unknown) => string | null;
export declare const createMailSyncKey: () => string;
export declare const MAX_MAIL_SYNC_REPLAY_BYTES: number;
export declare const MAX_MAIL_SYNC_RESPONSE_BYTES: number;
export declare const MAX_MAIL_SYNC_SOURCE_BYTES: number;
export declare const MAX_MAIL_SYNC_KNOWN_ITEMS = 100000;
export declare const MAX_MAIL_SYNC_KNOWN_ITEMS_BYTES: number;
export declare const MAX_MAIL_SYNC_COMMANDS_BYTES: number;
export declare const MAX_MAIL_SYNC_ROW_BYTES: number;
export declare const MAX_MAIL_SYNC_USER_BYTES: number;
export declare const MAX_MAIL_SYNC_PARTNERSHIPS_PER_USER = 1024;
export declare const MAIL_SYNC_STATE_TTL_MS: number;
export declare function validateMailClientCommands(commands: any[], collectionId: string): {
    ok: true;
} | {
    ok: false;
};
export declare function assertMailSyncRowBound(knownItems: string, commands: string, response: Buffer | null): void;
export declare const effectiveMailSyncWindow: (options: Pick<MailSyncOptions, "windowSize" | "truncationSize">, reservedBodyItems?: number) => number;
export declare const mailSyncReplayResponse: (state: StoredMailSyncState | null, syncKey: string, requestHash: string, now?: Date) => Buffer | null;
export declare const mailSyncPreviousKeyFetchResponseKey: (state: StoredMailSyncState | null, syncKey: string, commands: any[], collectionId: string, now?: Date) => string | null;
export declare const ensureEasMailSyncSchema: () => Promise<void>;
export declare const parseMailSyncKnownItems: (value: unknown) => MailSyncKnownItems;
export declare const loadMailSyncState: (username: string, deviceId: string, collectionId: string, signal?: AbortSignal) => Promise<StoredMailSyncState | null>;
export declare const deleteMailSyncState: (username: string, deviceId: string, collectionId: string) => Promise<void>;
export declare const saveMailSyncState: (state: StoredMailSyncState) => Promise<void>;
export declare function withMailSyncScopeLock<T>(scopeHash: string, operation: () => Promise<T>): Promise<T>;
export {};
//# sourceMappingURL=eas-mail-sync.d.ts.map