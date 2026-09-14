export interface SieveCriterion {
    id?: string;
    field: 'subject' | 'from' | 'to' | 'body' | string;
    operator: 'contains' | 'not_contains' | 'equals' | 'matches' | string;
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
    exceptions?: SieveCriterion[];
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

const supportedFields = new Set(['subject', 'from', 'to', 'body', 'from_address', 'from_domain']);
const supportedOperators = new Set(['contains', 'not_contains', 'equals', 'matches', 'is_one_of']);

export const ruleAddressValues = (value: string): string[] => value.split(/[,\n]/).map(item => item.trim().toLowerCase()).filter(Boolean);

export const isExecutableRuleCriterion = (criterion: SieveCriterion): boolean => (
    Boolean(criterion.value)
    && supportedFields.has(criterion.field)
    && supportedOperators.has(criterion.operator)
    && (criterion.operator !== 'is_one_of' || (criterion.field === 'from_address'
        && ruleAddressValues(criterion.value).length > 0
        && ruleAddressValues(criterion.value).every(value => /^[^\s@<>,]+@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/.test(value))))
);

export const executableRuleCriteria = (rule: SieveRule): SieveCriterion[] => (
    (rule.criteria || []).some(criterion => (
        Boolean(criterion.value) && !isExecutableRuleCriterion(criterion)
    ))
        ? []
        : (rule.criteria || []).filter(isExecutableRuleCriterion)
);

export const executableRuleActions = (rule: SieveRule): SieveAction[] => (
    (rule.actions || []).filter(action => (
        action.type === 'reject'
        || action.type === 'discard'
        || (action.type === 'move' && Boolean(action.folder))
    ))
);
