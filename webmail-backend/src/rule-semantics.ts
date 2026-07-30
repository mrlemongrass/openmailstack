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

const supportedFields = new Set(['subject', 'from', 'to', 'body']);
const supportedOperators = new Set(['contains', 'not_contains', 'equals']);

export const executableRuleCriteria = (rule: SieveRule): SieveCriterion[] => (
    (rule.criteria || []).filter(criterion => (
        Boolean(criterion.value)
        && supportedFields.has(criterion.field)
        && supportedOperators.has(criterion.operator)
    ))
);

export const executableRuleActions = (rule: SieveRule): SieveAction[] => (
    (rule.actions || []).filter(action => (
        action.type === 'reject'
        || action.type === 'discard'
        || (action.type === 'move' && Boolean(action.folder))
    ))
);
