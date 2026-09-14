import type {
    SieveAction,
    SieveCriterion,
    SieveRule,
    SieveRulesDocument,
} from './rule-semantics';

export type RuleAnalysisFindingKind =
    | 'exact_criterion'
    | 'exact_action'
    | 'cross_rule_criterion'
    | 'possible_overlap';

export interface RuleAnalysisOccurrence {
    ruleIndex: number;
    ruleId: string;
    ruleName: string;
    ruleEnabled: boolean;
    itemType: 'criterion' | 'action';
    itemIndex: number;
    itemId?: string;
}

export interface RuleAnalysisRemoval {
    ruleIndex: number;
    itemType: 'criterion' | 'action';
    itemIndex: number;
}

export interface RuleAnalysisFinding {
    id: string;
    kind: RuleAnalysisFindingKind;
    safety: 'safe' | 'review';
    label: string;
    explanation: string;
    occurrences: RuleAnalysisOccurrence[];
    omittedOccurrences?: number;
}

export interface RuleAnalysis {
    summary: {
        exactCriterionDuplicates: number;
        exactActionDuplicates: number;
        crossRuleRepeats: number;
        possibleOverlaps: number;
        removableItems: number;
    };
    removals: RuleAnalysisRemoval[];
    findings: RuleAnalysisFinding[];
    truncated: boolean;
}

const supportedFields = new Set(['subject', 'from', 'to', 'body', 'from_address', 'from_domain']);
const supportedOperators = new Set(['contains', 'not_contains', 'equals', 'matches', 'is_one_of']);
const MAX_FINDINGS = 500;
const MAX_FINDING_OCCURRENCES = 12;
const MAX_OVERLAP_COMPARISONS = 100000;
const MAX_OVERLAP_CHARACTER_COMPARISONS = 4000000;

export const RULE_ANALYSIS_LIMITS = {
    rules: 1000,
    items: 10000,
    stringCharacters: 4096,
    totalStringCharacters: 1000000,
    serializedBytes: 1250000,
} as const;

const isRecord = (value: unknown): value is Record<string, unknown> => (
    Boolean(value) && typeof value === 'object' && !Array.isArray(value)
);

const copyOptionalString = (
    source: Record<string, unknown>,
    target: Record<string, unknown>,
    key: string,
): boolean => {
    if (source[key] === undefined) return true;
    if (typeof source[key] !== 'string') return false;
    target[key] = source[key];
    return true;
};

const copyOptionalBoolean = (
    source: Record<string, unknown>,
    target: Record<string, unknown>,
    key: string,
): boolean => {
    if (source[key] === undefined) return true;
    if (typeof source[key] !== 'boolean') return false;
    target[key] = source[key];
    return true;
};

export const normalizeRuleDocument = (document: unknown): SieveRulesDocument | null => {
    if (!isRecord(document) || !Array.isArray(document.rules)) return null;
    const rules: SieveRule[] = [];
    for (const rawRule of document.rules) {
        if (!isRecord(rawRule)) return null;
        const normalizedRule: Record<string, unknown> = {};
        if (
            !copyOptionalString(rawRule, normalizedRule, 'id')
            || !copyOptionalString(rawRule, normalizedRule, 'name')
            || !copyOptionalString(rawRule, normalizedRule, 'condition')
            || !copyOptionalBoolean(rawRule, normalizedRule, 'enabled')
            || !copyOptionalBoolean(rawRule, normalizedRule, 'stopProcessing')
        ) return null;

        for (const key of ['criteria', 'exceptions'] as const) {
            if (rawRule[key] === undefined) continue;
            if (!Array.isArray(rawRule[key])) return null;
            if (key === 'exceptions' && (rawRule.id !== 'oms-user-marked-junk' || rawRule.condition !== 'any')) return null;
            const criteria: SieveCriterion[] = [];
            for (const rawCriterion of rawRule[key]) {
                if (!isRecord(rawCriterion)) return null;
                const criterion: Record<string, unknown> = {};
                if (
                    !copyOptionalString(rawCriterion, criterion, 'id')
                    || !copyOptionalString(rawCriterion, criterion, 'field')
                    || !copyOptionalString(rawCriterion, criterion, 'operator')
                    || !copyOptionalString(rawCriterion, criterion, 'value')
                    || typeof criterion.field !== 'string'
                    || typeof criterion.operator !== 'string'
                    || typeof criterion.value !== 'string'
                ) return null;
                if (key === 'exceptions' && (!['from_address', 'from_domain'].includes(String(criterion.field)) || criterion.operator !== 'equals')) return null;
                criteria.push(criterion as unknown as SieveCriterion);
            }
            normalizedRule[key] = criteria;
        }

        if (rawRule.actions !== undefined) {
            if (!Array.isArray(rawRule.actions)) return null;
            const actions: SieveAction[] = [];
            for (const rawAction of rawRule.actions) {
                if (!isRecord(rawAction)) return null;
                const action: Record<string, unknown> = {};
                if (
                    !copyOptionalString(rawAction, action, 'id')
                    || !copyOptionalString(rawAction, action, 'type')
                    || !copyOptionalString(rawAction, action, 'folder')
                    || typeof action.type !== 'string'
                ) return null;
                actions.push(action as unknown as SieveAction);
            }
            normalizedRule.actions = actions;
        }
        rules.push(normalizedRule as unknown as SieveRule);
    }

    const normalized: SieveRulesDocument = { rules };
    if (document.vacation !== undefined) {
        if (!isRecord(document.vacation)) return null;
        const vacation: Record<string, unknown> = {};
        if (
            !copyOptionalBoolean(document.vacation, vacation, 'enabled')
            || !copyOptionalString(document.vacation, vacation, 'subject')
            || !copyOptionalString(document.vacation, vacation, 'body')
            || typeof vacation.enabled !== 'boolean'
            || typeof vacation.body !== 'string'
        ) return null;
        if (document.vacation.days !== undefined) {
            if (
                !Number.isInteger(document.vacation.days)
                || Number(document.vacation.days) < 1
                || Number(document.vacation.days) > 365
            ) return null;
            vacation.days = Number(document.vacation.days);
        }
        normalized.vacation = vacation as unknown as SieveRulesDocument['vacation'];
    }
    return normalized;
};

const asciiFold = (value: string): string => value.replace(/[A-Z]/g, letter => letter.toLowerCase());

const displayText = (value: unknown): string => {
    const text = String(value ?? '').replace(/[\r\n\t]+/g, ' ');
    return text.length > 120 ? `${text.slice(0, 117)}...` : text;
};

const criterionSignature = (criterion: SieveCriterion): string | null => {
    const field = String(criterion?.field || '');
    const operator = String(criterion?.operator || '');
    const value = String(criterion?.value ?? '');
    if (!value || !supportedFields.has(field) || !supportedOperators.has(operator)) return null;
    return `${field}\u0000${operator}\u0000${asciiFold(value)}`;
};

const actionSignature = (action: SieveAction): string | null => {
    const type = String(action?.type || '');
    if (type === 'reject' || type === 'discard') return type;
    if (type === 'move' && action.folder) return `${type}\u0000${String(action.folder)}`;
    return null;
};

export const exceedsRuleAnalysisLimits = (document: SieveRulesDocument): boolean => {
    try {
        if (Buffer.byteLength(JSON.stringify(document), 'utf8') > RULE_ANALYSIS_LIMITS.serializedBytes) {
            return true;
        }
    } catch {
        return true;
    }
    const rules = Array.isArray(document?.rules) ? document.rules : [];
    if (rules.length > RULE_ANALYSIS_LIMITS.rules) return true;

    let itemCount = 0;
    let totalStringCharacters = 0;
    let exceeded = false;
    const measure = (value: unknown) => {
        if (value === undefined || value === null || exceeded) return;
        const length = String(value).length;
        totalStringCharacters += length;
        if (length > RULE_ANALYSIS_LIMITS.stringCharacters
            || totalStringCharacters > RULE_ANALYSIS_LIMITS.totalStringCharacters) {
            exceeded = true;
        }
    };

    for (const rawRule of rules) {
        if (!rawRule || typeof rawRule !== 'object') continue;
        const rule = rawRule as SieveRule;
        const criteria = Array.isArray(rule.criteria) ? rule.criteria : [];
        const actions = Array.isArray(rule.actions) ? rule.actions : [];
        const exceptions = Array.isArray(rule.exceptions) ? rule.exceptions : [];
        itemCount += criteria.length + actions.length + exceptions.length;
        if (itemCount > RULE_ANALYSIS_LIMITS.items) return true;

        measure(rule.id);
        measure(rule.name);
        measure(rule.condition);
        for (const criterion of [...criteria, ...exceptions]) {
            if (!criterion || typeof criterion !== 'object') continue;
            measure(criterion.id);
            measure(criterion.field);
            measure(criterion.operator);
            measure(criterion.value);
        }
        for (const action of actions) {
            if (!action || typeof action !== 'object') continue;
            measure(action.id);
            measure(action.type);
            measure(action.folder);
        }
        if (exceeded) return true;
    }

    if (document.vacation && typeof document.vacation === 'object') {
        measure(document.vacation.subject);
        measure(document.vacation.body);
    }

    return exceeded;
};

const fieldLabel = (field: string): string => ({
    subject: 'Subject',
    from: 'Sender',
    to: 'Recipient',
    body: 'Body',
}[field] || field);

const operatorLabel = (operator: string): string => ({
    contains: 'contains',
    not_contains: 'does not contain',
    equals: 'equals',
    matches: 'matches pattern',
}[operator] || operator);

const criterionLabel = (criterion: SieveCriterion): string => (
    `${fieldLabel(String(criterion.field))} ${operatorLabel(String(criterion.operator))} “${displayText(criterion.value)}”`
);

const actionLabel = (action: SieveAction): string => {
    if (action.type === 'move') return `Move to “${displayText(action.folder)}”`;
    if (action.type === 'reject') return 'Reject with message';
    if (action.type === 'discard') return 'Silently discard';
    return displayText(action.type);
};

const ruleIdentity = (rule: SieveRule, index: number): string => (
    String(rule.id || rule.name || `rule-${index + 1}`)
);

const occurrence = (
    rule: SieveRule,
    ruleIndex: number,
    itemType: 'criterion' | 'action',
    itemIndex: number,
    itemId: unknown,
): RuleAnalysisOccurrence => ({
    ruleIndex,
    ruleId: ruleIdentity(rule, ruleIndex),
    ruleName: displayText(rule.name || `Rule ${ruleIndex + 1}`),
    ruleEnabled: rule.enabled !== false,
    itemType,
    itemIndex,
    ...(itemId ? { itemId: String(itemId) } : {}),
});

const findingOccurrences = (occurrences: RuleAnalysisOccurrence[]): {
    occurrences: RuleAnalysisOccurrence[];
    omittedOccurrences?: number;
} => ({
    occurrences: occurrences.slice(0, MAX_FINDING_OCCURRENCES),
    ...(occurrences.length > MAX_FINDING_OCCURRENCES
        ? { omittedOccurrences: occurrences.length - MAX_FINDING_OCCURRENCES }
        : {}),
});

export function analyzeRuleDocument(document: SieveRulesDocument): RuleAnalysis {
    const rules = Array.isArray(document?.rules) ? document.rules : [];
    const findings: RuleAnalysisFinding[] = [];
    const removals: RuleAnalysisRemoval[] = [];
    const crossRuleCriteria = new Map<string, {
        criterion: SieveCriterion;
        occurrences: RuleAnalysisOccurrence[];
    }>();
    const overlapCandidates: Array<{
        rule: SieveRule;
        ruleIndex: number;
        criterion: SieveCriterion;
        itemIndex: number;
        foldedValue: string;
    }> = [];
    let exactCriterionDuplicates = 0;
    let exactActionDuplicates = 0;
    let crossRuleRepeats = 0;
    let possibleOverlaps = 0;
    let truncated = false;

    const addFinding = (finding: RuleAnalysisFinding) => {
        if (findings.length < MAX_FINDINGS) findings.push(finding);
        else truncated = true;
    };

    rules.forEach((rawRule, ruleIndex) => {
        const rule = rawRule && typeof rawRule === 'object' ? rawRule : {};
        const criteria = Array.isArray(rule.criteria) ? rule.criteria : [];
        const actions = Array.isArray(rule.actions) ? rule.actions : [];
        const criterionGroups = new Map<string, {
            criterion: SieveCriterion;
            occurrences: RuleAnalysisOccurrence[];
        }>();
        const actionGroups = new Map<string, {
            action: SieveAction;
            occurrences: RuleAnalysisOccurrence[];
        }>();
        criteria.forEach((rawCriterion, itemIndex) => {
            if (!rawCriterion || typeof rawCriterion !== 'object') return;
            const criterion = rawCriterion as SieveCriterion;
            const signature = criterionSignature(criterion);
            if (!signature) return;
            const itemOccurrence = occurrence(rule, ruleIndex, 'criterion', itemIndex, criterion.id);
            const sameRuleGroup = criterionGroups.get(signature) || { criterion, occurrences: [] };
            sameRuleGroup.occurrences.push(itemOccurrence);
            criterionGroups.set(signature, sameRuleGroup);

            const crossRuleGroup = crossRuleCriteria.get(signature) || { criterion, occurrences: [] };
            crossRuleGroup.occurrences.push(itemOccurrence);
            crossRuleCriteria.set(signature, crossRuleGroup);

            if (criterion.operator === 'contains') {
                overlapCandidates.push({
                    rule,
                    ruleIndex,
                    criterion,
                    itemIndex,
                    foldedValue: asciiFold(String(criterion.value)),
                });
            }
        });

        actions.forEach((rawAction, itemIndex) => {
            if (!rawAction || typeof rawAction !== 'object') return;
            const action = rawAction as SieveAction;
            const signature = actionSignature(action);
            if (!signature) return;
            const sameRuleGroup = actionGroups.get(signature) || { action, occurrences: [] };
            sameRuleGroup.occurrences.push(occurrence(rule, ruleIndex, 'action', itemIndex, action.id));
            actionGroups.set(signature, sameRuleGroup);
        });

        criterionGroups.forEach(group => {
            if (group.occurrences.length < 2) return;
            const duplicateOccurrences = group.occurrences.slice(1);
            exactCriterionDuplicates += duplicateOccurrences.length;
            duplicateOccurrences.forEach(item => removals.push({
                ruleIndex: item.ruleIndex,
                itemType: 'criterion',
                itemIndex: item.itemIndex,
            }));
            addFinding({
                id: `exact-criterion-${ruleIndex}-${group.occurrences[0].itemIndex}`,
                kind: 'exact_criterion',
                safety: 'safe',
                label: criterionLabel(group.criterion),
                explanation: `${duplicateOccurrences.length} later ${duplicateOccurrences.length === 1 ? 'copy' : 'copies'} can be removed without changing this rule.`,
                ...findingOccurrences(group.occurrences),
            });
        });

        actionGroups.forEach(group => {
            if (group.occurrences.length < 2) return;
            const duplicateOccurrences = group.occurrences.slice(1);
            exactActionDuplicates += duplicateOccurrences.length;
            duplicateOccurrences.forEach(item => removals.push({
                ruleIndex: item.ruleIndex,
                itemType: 'action',
                itemIndex: item.itemIndex,
            }));
            addFinding({
                id: `exact-action-${ruleIndex}-${group.occurrences[0].itemIndex}`,
                kind: 'exact_action',
                safety: 'safe',
                label: actionLabel(group.action),
                explanation: `${duplicateOccurrences.length} later ${duplicateOccurrences.length === 1 ? 'copy' : 'copies'} can be removed without changing this rule.`,
                ...findingOccurrences(group.occurrences),
            });
        });

    });

    crossRuleCriteria.forEach(group => {
        const distinctRules = new Set(group.occurrences.map(item => item.ruleIndex));
        if (distinctRules.size < 2) return;
        crossRuleRepeats += 1;
        addFinding({
            id: `cross-rule-criterion-${crossRuleRepeats}`,
            kind: 'cross_rule_criterion',
            safety: 'review',
            label: criterionLabel(group.criterion),
            explanation: `This condition appears in ${distinctRules.size} rules. Rule order and stop-processing may make each occurrence intentional.`,
            ...findingOccurrences(group.occurrences),
        });
    });

    let overlapComparisons = 0;
    let overlapCharacterComparisons = 0;
    overlapScan:
    for (let firstIndex = 0; firstIndex < overlapCandidates.length; firstIndex += 1) {
        for (let secondIndex = firstIndex + 1; secondIndex < overlapCandidates.length; secondIndex += 1) {
            const first = overlapCandidates[firstIndex];
            const second = overlapCandidates[secondIndex];
            const comparisonCharacters = first.foldedValue.length + second.foldedValue.length;
            if (overlapComparisons >= MAX_OVERLAP_COMPARISONS
                || overlapCharacterComparisons + comparisonCharacters > MAX_OVERLAP_CHARACTER_COMPARISONS) {
                truncated = true;
                break overlapScan;
            }
            overlapComparisons += 1;
            overlapCharacterComparisons += comparisonCharacters;
            if (first.criterion.field !== second.criterion.field) continue;
            if (first.foldedValue === second.foldedValue) continue;
            if (!first.foldedValue.includes(second.foldedValue)
                && !second.foldedValue.includes(first.foldedValue)) continue;

            const broader = first.foldedValue.length <= second.foldedValue.length ? first : second;
            const narrower = broader === first ? second : first;
            const crossesRules = first.ruleIndex !== second.ruleIndex;
            possibleOverlaps += 1;
            addFinding({
                id: `possible-overlap-${first.ruleIndex}-${first.itemIndex}-${second.ruleIndex}-${second.itemIndex}`,
                kind: 'possible_overlap',
                safety: 'review',
                label: `${criterionLabel(broader.criterion)} overlaps “${displayText(narrower.criterion.value)}”`,
                explanation: crossesRules
                    ? 'These contains patterns appear in different rules. Review them manually because rule order and stop-processing may make both intentional.'
                    : 'One contains pattern includes the other. Review it manually because ANY/ALL intent may differ.',
                occurrences: [
                    occurrence(first.rule, first.ruleIndex, 'criterion', first.itemIndex, first.criterion.id),
                    occurrence(second.rule, second.ruleIndex, 'criterion', second.itemIndex, second.criterion.id),
                ],
            });
        }
    }

    removals.sort((left, right) => (
        left.ruleIndex - right.ruleIndex
        || (left.itemType === right.itemType ? 0 : left.itemType === 'criterion' ? -1 : 1)
        || left.itemIndex - right.itemIndex
    ));

    return {
        summary: {
            exactCriterionDuplicates,
            exactActionDuplicates,
            crossRuleRepeats,
            possibleOverlaps,
            removableItems: removals.length,
        },
        removals,
        findings,
        truncated,
    };
}
