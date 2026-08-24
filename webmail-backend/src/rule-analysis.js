"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.exceedsRuleAnalysisLimits = exports.RULE_ANALYSIS_LIMITS = void 0;
exports.analyzeRuleDocument = analyzeRuleDocument;
const supportedFields = new Set(['subject', 'from', 'to', 'body']);
const supportedOperators = new Set(['contains', 'not_contains', 'equals']);
const MAX_FINDINGS = 500;
const MAX_FINDING_OCCURRENCES = 12;
const MAX_OVERLAP_COMPARISONS = 100000;
const MAX_OVERLAP_CHARACTER_COMPARISONS = 4000000;
exports.RULE_ANALYSIS_LIMITS = {
    rules: 1000,
    items: 10000,
    stringCharacters: 4096,
    totalStringCharacters: 1000000,
};
const asciiFold = (value) => value.replace(/[A-Z]/g, letter => letter.toLowerCase());
const displayText = (value) => {
    const text = String(value ?? '').replace(/[\r\n\t]+/g, ' ');
    return text.length > 120 ? `${text.slice(0, 117)}...` : text;
};
const criterionSignature = (criterion) => {
    const field = String(criterion?.field || '');
    const operator = String(criterion?.operator || '');
    const value = String(criterion?.value ?? '');
    if (!value || !supportedFields.has(field) || !supportedOperators.has(operator))
        return null;
    return `${field}\u0000${operator}\u0000${asciiFold(value)}`;
};
const actionSignature = (action) => {
    const type = String(action?.type || '');
    if (type === 'reject' || type === 'discard')
        return type;
    if (type === 'move' && action.folder)
        return `${type}\u0000${String(action.folder)}`;
    return null;
};
const exceedsRuleAnalysisLimits = (document) => {
    const rules = Array.isArray(document?.rules) ? document.rules : [];
    if (rules.length > exports.RULE_ANALYSIS_LIMITS.rules)
        return true;
    let itemCount = 0;
    let totalStringCharacters = 0;
    let exceeded = false;
    const measure = (value) => {
        if (value === undefined || value === null || exceeded)
            return;
        const length = String(value).length;
        totalStringCharacters += length;
        if (length > exports.RULE_ANALYSIS_LIMITS.stringCharacters
            || totalStringCharacters > exports.RULE_ANALYSIS_LIMITS.totalStringCharacters) {
            exceeded = true;
        }
    };
    for (const rawRule of rules) {
        if (!rawRule || typeof rawRule !== 'object')
            continue;
        const rule = rawRule;
        const criteria = Array.isArray(rule.criteria) ? rule.criteria : [];
        const actions = Array.isArray(rule.actions) ? rule.actions : [];
        itemCount += criteria.length + actions.length;
        if (itemCount > exports.RULE_ANALYSIS_LIMITS.items)
            return true;
        measure(rule.id);
        measure(rule.name);
        for (const criterion of criteria) {
            if (!criterion || typeof criterion !== 'object')
                continue;
            measure(criterion.id);
            measure(criterion.field);
            measure(criterion.operator);
            measure(criterion.value);
        }
        for (const action of actions) {
            if (!action || typeof action !== 'object')
                continue;
            measure(action.id);
            measure(action.type);
            measure(action.folder);
        }
        if (exceeded)
            return true;
    }
    return false;
};
exports.exceedsRuleAnalysisLimits = exceedsRuleAnalysisLimits;
const fieldLabel = (field) => ({
    subject: 'Subject',
    from: 'Sender',
    to: 'Recipient',
    body: 'Body',
}[field] || field);
const operatorLabel = (operator) => ({
    contains: 'contains',
    not_contains: 'does not contain',
    equals: 'equals',
}[operator] || operator);
const criterionLabel = (criterion) => (`${fieldLabel(String(criterion.field))} ${operatorLabel(String(criterion.operator))} “${displayText(criterion.value)}”`);
const actionLabel = (action) => {
    if (action.type === 'move')
        return `Move to “${displayText(action.folder)}”`;
    if (action.type === 'reject')
        return 'Reject with message';
    if (action.type === 'discard')
        return 'Silently discard';
    return displayText(action.type);
};
const ruleIdentity = (rule, index) => (String(rule.id || rule.name || `rule-${index + 1}`));
const occurrence = (rule, ruleIndex, itemType, itemIndex, itemId) => ({
    ruleIndex,
    ruleId: ruleIdentity(rule, ruleIndex),
    ruleName: displayText(rule.name || `Rule ${ruleIndex + 1}`),
    ruleEnabled: rule.enabled !== false,
    itemType,
    itemIndex,
    ...(itemId ? { itemId: String(itemId) } : {}),
});
const findingOccurrences = (occurrences) => ({
    occurrences: occurrences.slice(0, MAX_FINDING_OCCURRENCES),
    ...(occurrences.length > MAX_FINDING_OCCURRENCES
        ? { omittedOccurrences: occurrences.length - MAX_FINDING_OCCURRENCES }
        : {}),
});
function analyzeRuleDocument(document) {
    const rules = Array.isArray(document?.rules) ? document.rules : [];
    const findings = [];
    const removals = [];
    const crossRuleCriteria = new Map();
    const overlapCandidates = [];
    let exactCriterionDuplicates = 0;
    let exactActionDuplicates = 0;
    let crossRuleRepeats = 0;
    let possibleOverlaps = 0;
    let truncated = false;
    const addFinding = (finding) => {
        if (findings.length < MAX_FINDINGS)
            findings.push(finding);
        else
            truncated = true;
    };
    rules.forEach((rawRule, ruleIndex) => {
        const rule = rawRule && typeof rawRule === 'object' ? rawRule : {};
        const criteria = Array.isArray(rule.criteria) ? rule.criteria : [];
        const actions = Array.isArray(rule.actions) ? rule.actions : [];
        const criterionGroups = new Map();
        const actionGroups = new Map();
        criteria.forEach((rawCriterion, itemIndex) => {
            if (!rawCriterion || typeof rawCriterion !== 'object')
                return;
            const criterion = rawCriterion;
            const signature = criterionSignature(criterion);
            if (!signature)
                return;
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
            if (!rawAction || typeof rawAction !== 'object')
                return;
            const action = rawAction;
            const signature = actionSignature(action);
            if (!signature)
                return;
            const sameRuleGroup = actionGroups.get(signature) || { action, occurrences: [] };
            sameRuleGroup.occurrences.push(occurrence(rule, ruleIndex, 'action', itemIndex, action.id));
            actionGroups.set(signature, sameRuleGroup);
        });
        criterionGroups.forEach(group => {
            if (group.occurrences.length < 2)
                return;
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
            if (group.occurrences.length < 2)
                return;
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
        if (distinctRules.size < 2)
            return;
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
    overlapScan: for (let firstIndex = 0; firstIndex < overlapCandidates.length; firstIndex += 1) {
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
            if (first.criterion.field !== second.criterion.field)
                continue;
            if (first.foldedValue === second.foldedValue)
                continue;
            if (!first.foldedValue.includes(second.foldedValue)
                && !second.foldedValue.includes(first.foldedValue))
                continue;
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
    removals.sort((left, right) => (left.ruleIndex - right.ruleIndex
        || (left.itemType === right.itemType ? 0 : left.itemType === 'criterion' ? -1 : 1)
        || left.itemIndex - right.itemIndex));
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
//# sourceMappingURL=rule-analysis.js.map