export interface SelectionGroup {
    folder: string;
    uidValidity: string;
    uids: number[];
    junk: boolean;
    trash: boolean;
}
export interface SelectionResult {
    token: string;
    count: number;
    completed: number;
    state: 'ready' | 'complete' | 'cancelled' | 'uncertain';
    allJunk: boolean;
    includesTrash: boolean;
    error?: string;
    confirmedBatch?: {
        folder: string;
        uids: number[];
    };
}
export declare class MailSelectionStore {
    private now;
    private entries;
    constructor(now?: () => number);
    create(owner: string, groups: SelectionGroup[]): SelectionResult;
    private get;
    cancel(owner: string, token: string): {
        token: string;
        count: number;
        completed: number;
        state: "ready" | "complete" | "cancelled" | "uncertain";
        allJunk: boolean;
        includesTrash: boolean;
        error?: string;
        confirmedBatch?: {
            folder: string;
            uids: number[];
        };
    };
    apply(owner: string, token: string, cursor: number, operation: string, run: (group: SelectionGroup) => Promise<void>): Promise<SelectionResult>;
}
export declare const mailSelections: MailSelectionStore;
//# sourceMappingURL=mail-selection.d.ts.map