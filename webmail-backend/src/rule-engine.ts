import {
    executableRuleActions,
    executableRuleCriteria,
    type SieveCriterion,
    type SieveRule,
} from './rule-semantics';

export interface RuleMessage {
    uid: number;
    subject?: string;
    from?: string;
    to?: string;
    body?: string;
    unavailableFields?: string[];
}

export interface RuleEvaluation {
    matchedRuleIds: string[];
    moveFolders: string[];
    deliveryOnlyActions: string[];
    unevaluatedRuleIds: string[];
    stoppedByRuleId?: string;
}

type CriterionResult = boolean | 'unknown';

function criterionMatches(criterion: SieveCriterion, message: RuleMessage): CriterionResult {
    if (message.unavailableFields?.includes(criterion.field)) return 'unknown';

    const actual = String(message[criterion.field as keyof RuleMessage] || '').toLowerCase();
    const expected = String(criterion.value).toLowerCase();
    const matches = criterion.operator === 'equals'
        ? actual === expected
        : actual.includes(expected);

    return criterion.operator === 'not_contains' ? !matches : matches;
}

export function evaluateRulesForMessage(rules: SieveRule[], message: RuleMessage): RuleEvaluation {
    const result: RuleEvaluation = {
        matchedRuleIds: [],
        moveFolders: [],
        deliveryOnlyActions: [],
        unevaluatedRuleIds: [],
    };

    rules.forEach((rule, index) => {
        if (result.stoppedByRuleId || rule.enabled === false) return;

        const criteria = executableRuleCriteria(rule).map(criterion => criterionMatches(criterion, message));
        const actions = executableRuleActions(rule);
        if (criteria.length === 0 || actions.length === 0) return;

        const hasUnknown = criteria.includes('unknown');
        const knownCriteria = criteria.filter((match): match is boolean => match !== 'unknown');
        const matches = rule.condition === 'any'
            ? knownCriteria.some(Boolean)
            : knownCriteria.length === criteria.length && knownCriteria.every(Boolean);
        const canDecide = rule.condition === 'any'
            ? matches || !hasUnknown
            : knownCriteria.includes(false) || !hasUnknown;
        if (!canDecide) {
            result.unevaluatedRuleIds.push(String(rule.id || rule.name || `rule-${index + 1}`));
            return;
        }
        if (!matches) return;

        const ruleId = String(rule.id || rule.name || `rule-${index + 1}`);
        result.matchedRuleIds.push(ruleId);

        for (const action of actions) {
            if (action.type === 'move' && action.folder) {
                result.moveFolders = result.moveFolders.filter(folder => folder !== action.folder);
                result.moveFolders.push(action.folder);
            } else if (
                (action.type === 'reject' || action.type === 'discard')
                && !result.deliveryOnlyActions.includes(action.type)
            ) {
                result.deliveryOnlyActions.push(action.type);
            }
        }

        if (rule.stopProcessing !== false) {
            result.stoppedByRuleId = ruleId;
        }
    });

    return result;
}
