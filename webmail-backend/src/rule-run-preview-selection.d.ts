export type RuleRunPreviewMessageRef = {
    folder: string;
    uid: number;
};
export type RuleRunPreviewSelectionMode = 'allExcept' | 'only';
export type RuleRunApplyHttpResult = {
    status: number;
    response: Record<string, unknown>;
};
export type RuleRunApplyRequestClaim = {
    kind: 'claimed';
} | {
    kind: 'pending';
    result: Promise<RuleRunApplyHttpResult>;
} | {
    kind: 'replay';
    result: RuleRunApplyHttpResult;
} | {
    kind: 'unavailable';
};
export type ParsedRuleRunMessageSelection = {
    mode: RuleRunPreviewSelectionMode;
    messages: RuleRunPreviewMessageRef[];
};
export type RuleRunPreviewSelectionState = {
    complete: boolean;
    applyStarted: boolean;
    applyComplete: boolean;
    matchedCount: number;
};
export declare class RuleRunPreviewSelectionUnavailableError extends Error {
    constructor();
}
type RuleRunPreviewSelectionStoreOptions = {
    ttlMs?: number;
    maxEntries?: number;
    maxEntriesPerOwner?: number;
    maxMessagesPerEntry?: number;
    maxStoredMessages?: number;
    maxStoredMessagesPerOwner?: number;
    now?: () => number;
    createToken?: () => string;
};
export declare const RULE_RUN_PREVIEW_SELECTION_TTL_MS: number;
export declare const MAX_RULE_RUN_PREVIEW_SELECTION_ENTRIES = 128;
export declare const MAX_RULE_RUN_PREVIEW_SELECTION_ENTRIES_PER_OWNER = 32;
export declare const MAX_RULE_RUN_PREVIEW_MESSAGES = 100000;
export declare const MAX_RULE_RUN_STORED_PREVIEW_MESSAGES = 250000;
export declare const MAX_RULE_RUN_STORED_PREVIEW_MESSAGES_PER_OWNER = 150000;
export declare const parseRuleRunMessageSelection: (value: unknown, limits: {
    maxGroups: number;
    maxMessages: number;
}) => ParsedRuleRunMessageSelection | null;
export declare class RuleRunPreviewSelectionStore {
    private readonly entries;
    private readonly ttlMs;
    private readonly maxEntries;
    private readonly maxEntriesPerOwner;
    private readonly maxMessagesPerEntry;
    private readonly maxStoredMessages;
    private readonly maxStoredMessagesPerOwner;
    private readonly now;
    private readonly createToken;
    constructor(options?: RuleRunPreviewSelectionStoreOptions);
    private deleteEntry;
    private pruneExpired;
    private storedMessageCount;
    private evictOldest;
    private getEntry;
    create(owner: string, binding: string): string | null;
    state(token: string, owner: string, binding: string): RuleRunPreviewSelectionState | null;
    append(token: string, owner: string, binding: string, matchedMessages: RuleRunPreviewMessageRef[], actionableMessages: RuleRunPreviewMessageRef[]): boolean;
    markPreviewComplete(token: string, owner: string, binding: string): boolean;
    containsMatched(token: string, owner: string, binding: string, folder: string, uid: number): boolean;
    containsActionable(token: string, owner: string, binding: string, folder: string, uid: number): boolean;
    beginApply(token: string, owner: string, binding: string, mode: RuleRunPreviewSelectionMode, messages: RuleRunPreviewMessageRef[]): boolean;
    createApplySelector(token: string, owner: string, binding: string): ((folder: string, uid: number) => boolean) | null;
    isSelected(token: string, owner: string, binding: string, folder: string, uid: number): boolean;
    assertApplyActive(token: string, owner: string, binding: string): void;
    claimApplyRequest(token: string, owner: string, binding: string, requestKey: string): RuleRunApplyRequestClaim;
    finishApplyRequest(token: string, owner: string, binding: string, requestKey: string, result: RuleRunApplyHttpResult, options: {
        retain: boolean;
        applyComplete: boolean;
    }): boolean;
    replayApplyResult(token: string, owner: string, binding: string, requestKey: string): RuleRunApplyHttpResult | null;
}
export declare const ruleRunPreviewSelectionStore: RuleRunPreviewSelectionStore;
export {};
//# sourceMappingURL=rule-run-preview-selection.d.ts.map