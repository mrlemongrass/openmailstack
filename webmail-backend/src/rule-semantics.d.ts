export interface SieveCriterion {
    id?: string;
    field: 'subject' | 'from' | 'to' | 'body' | string;
    operator: 'contains' | 'not_contains' | 'equals' | string;
    value: string;
}
export interface SieveAction {
    id?: string;
    type: 'move' | 'reject' | 'discard' | string;
    folder?: string;
}
export interface SieveRule {
    id?: string;
    name?: string;
    enabled?: boolean;
    stopProcessing?: boolean;
    condition?: 'any' | 'all' | string;
    criteria?: SieveCriterion[];
    actions?: SieveAction[];
}
export interface SieveVacation {
    enabled: boolean;
    subject?: string;
    body: string;
    days?: number;
}
export interface SieveRulesDocument {
    rules?: SieveRule[];
    vacation?: SieveVacation;
}
export declare const executableRuleCriteria: (rule: SieveRule) => SieveCriterion[];
export declare const executableRuleActions: (rule: SieveRule) => SieveAction[];
//# sourceMappingURL=rule-semantics.d.ts.map