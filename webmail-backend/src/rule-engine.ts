import {
    executableRuleActions,
    isExecutableRuleCriterion,
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
    matchedRuleDetails: Array<{
        id: string;
        condition: 'any' | 'all';
        matchedCriterionIndexes: number[];
        totalCriteria: number;
    }>;
    moveFolders: string[];
    deliveryOnlyActions: string[];
    unevaluatedRuleIds: string[];
    stoppedByRuleId?: string;
}

type CriterionResult = boolean | 'unknown';

type WildcardToken =
    | { kind: 'literal'; value: string }
    | { kind: 'single' }
    | { kind: 'many' };

function wildcardTokens(pattern: string): WildcardToken[] {
    const characters = Array.from(pattern);
    const tokens: WildcardToken[] = [];
    for (let index = 0; index < characters.length; index += 1) {
        const character = characters[index];
        const escaped = characters[index + 1];
        if (character === '\\' && (escaped === '*' || escaped === '?' || escaped === '\\')) {
            tokens.push({ kind: 'literal', value: escaped });
            index += 1;
        } else if (character === '*') {
            tokens.push({ kind: 'many' });
        } else if (character === '?') {
            tokens.push({ kind: 'single' });
        } else {
            tokens.push({ kind: 'literal', value: character });
        }
    }
    return tokens;
}

function matchesWildcardPattern(value: string, pattern: string): boolean {
    const characters = Array.from(value);
    const tokens = wildcardTokens(pattern);
    let characterIndex = 0;
    let tokenIndex = 0;
    let manyTokenIndex = -1;
    let manyCharacterIndex = 0;

    while (characterIndex < characters.length) {
        const token = tokens[tokenIndex];
        if (token?.kind === 'single' || (token?.kind === 'literal' && token.value === characters[characterIndex])) {
            characterIndex += 1;
            tokenIndex += 1;
        } else if (token?.kind === 'many') {
            manyTokenIndex = tokenIndex;
            manyCharacterIndex = characterIndex;
            tokenIndex += 1;
        } else if (manyTokenIndex >= 0) {
            manyCharacterIndex += 1;
            characterIndex = manyCharacterIndex;
            tokenIndex = manyTokenIndex + 1;
        } else {
            return false;
        }
    }

    while (tokens[tokenIndex]?.kind === 'many') tokenIndex += 1;
    return tokenIndex === tokens.length;
}

function criterionMatches(criterion: SieveCriterion, message: RuleMessage): CriterionResult {
    if (message.unavailableFields?.includes(criterion.field)) return 'unknown';

    const actual = String(message[criterion.field as keyof RuleMessage] || '').toLowerCase();
    const expected = String(criterion.value).toLowerCase();
    const matches = criterion.operator === 'equals'
        ? actual === expected
        : criterion.operator === 'matches'
            ? matchesWildcardPattern(actual, expected)
            : actual.includes(expected);

    return criterion.operator === 'not_contains' ? !matches : matches;
}

export function evaluateRulesForMessage(rules: SieveRule[], message: RuleMessage): RuleEvaluation {
    const result: RuleEvaluation = {
        matchedRuleIds: [],
        matchedRuleDetails: [],
        moveFolders: [],
        deliveryOnlyActions: [],
        unevaluatedRuleIds: [],
    };

    rules.forEach((rule, index) => {
        if (result.stoppedByRuleId || rule.enabled === false) return;

        const executableCriteria = (rule.criteria || []).flatMap((criterion, criterionIndex) => (
            isExecutableRuleCriterion(criterion) ? [{ criterion, criterionIndex }] : []
        ));
        const criteria = executableCriteria.map(({ criterion }) => criterionMatches(criterion, message));
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
        result.matchedRuleDetails.push({
            id: ruleId,
            condition: rule.condition === 'any' ? 'any' : 'all',
            matchedCriterionIndexes: executableCriteria.flatMap(({ criterionIndex }, resultIndex) => (
                criteria[resultIndex] === true ? [criterionIndex] : []
            )),
            totalCriteria: executableCriteria.length,
        });

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
