export interface RuleCopyLedgerAction {
    actionKey: string;
    operationKey: string;
    uid: number;
    destination: string;
}
export interface RuleCopyLedgerReservation {
    token: string;
    ready: Set<string>;
    completed: Set<string>;
    blocked: Set<string>;
    pending: RuleCopyLedgerAction[];
}
export interface RuleCopyLedger {
    pendingForSourceUids(sourceUids: number[]): Promise<RuleCopyLedgerAction[]>;
    reserve(actions: RuleCopyLedgerAction[]): Promise<RuleCopyLedgerReservation>;
    complete(actions: RuleCopyLedgerAction[], token: string): Promise<void>;
    clear(actions: RuleCopyLedgerAction[]): Promise<void>;
    resolvePending(operationKey: string, actionKeys: string[], resolution: 'completed' | 'retry'): Promise<number>;
}
type Queryable = {
    query(sql: string, values?: unknown[]): Promise<any>;
};
export declare class RuleRunLedger implements RuleCopyLedger {
    private owner;
    private sourceFolder;
    private sourceUidValidity;
    private db;
    constructor(owner: string, sourceFolder: string, sourceUidValidity: string, db?: Queryable);
    reserve(actions: RuleCopyLedgerAction[]): Promise<RuleCopyLedgerReservation>;
    pendingForSourceUids(sourceUids: number[]): Promise<RuleCopyLedgerAction[]>;
    complete(actions: RuleCopyLedgerAction[], token: string): Promise<void>;
    clear(actions: RuleCopyLedgerAction[]): Promise<void>;
    resolvePending(operationKey: string, actionKeys: string[], resolution: 'completed' | 'retry'): Promise<number>;
}
export {};
//# sourceMappingURL=rule-run-ledger.d.ts.map