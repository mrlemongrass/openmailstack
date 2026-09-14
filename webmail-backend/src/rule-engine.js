"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.evaluateRulesForMessage = evaluateRulesForMessage;
const rule_semantics_1 = require("./rule-semantics");
const rule_address_1 = require("./rule-address");
const rule_semantics_2 = require("./rule-semantics");
const MAX_WILDCARD_MATCH_STEPS_PER_MESSAGE = 250000;
const BYTE_A = 0x41;
const BYTE_Z = 0x5a;
const BYTE_CASE_OFFSET = 0x20;
const BYTE_BACKSLASH = 0x5c;
const BYTE_QUESTION = 0x3f;
const BYTE_STAR = 0x2a;
const asciiFoldByte = (value) => (value >= BYTE_A && value <= BYTE_Z ? value + BYTE_CASE_OFFSET : value);
function wildcardTokens(pattern, context) {
    const characters = Buffer.from(pattern, 'utf8');
    if (characters.length > context.remainingSteps) {
        context.remainingSteps = 0;
        return null;
    }
    context.remainingSteps -= characters.length;
    const tokens = [];
    let firstManyIndex = -1;
    let manyCount = 0;
    for (let index = 0; index < characters.length; index += 1) {
        const character = characters[index];
        const escaped = characters[index + 1];
        if (character === BYTE_BACKSLASH
            && (escaped === BYTE_STAR || escaped === BYTE_QUESTION || escaped === BYTE_BACKSLASH)) {
            tokens.push({ kind: 'literal', value: asciiFoldByte(escaped) });
            index += 1;
        }
        else if (character === BYTE_STAR) {
            if (tokens.at(-1)?.kind !== 'many') {
                if (firstManyIndex < 0)
                    firstManyIndex = tokens.length;
                manyCount += 1;
                tokens.push({ kind: 'many' });
            }
        }
        else if (character === BYTE_QUESTION) {
            tokens.push({ kind: 'single' });
        }
        else {
            tokens.push({ kind: 'literal', value: asciiFoldByte(character) });
        }
    }
    return { tokens, firstManyIndex, manyCount };
}
function fixedTokensMatchAt(characters, tokens, start, context) {
    if (tokens.length > context.remainingSteps) {
        context.remainingSteps = 0;
        return 'unknown';
    }
    context.remainingSteps -= tokens.length;
    for (let index = 0; index < tokens.length; index += 1) {
        const token = tokens[index];
        if (token.kind === 'many')
            return false;
        if (token.kind === 'literal'
            && token.value !== asciiFoldByte(characters[start + index]))
            return false;
    }
    return true;
}
function matchesWildcardPattern(characters, pattern, context) {
    const parsed = wildcardTokens(pattern, context);
    if (!parsed)
        return 'unknown';
    const { tokens, firstManyIndex, manyCount } = parsed;
    if (manyCount === 0) {
        if (tokens.length !== characters.length)
            return false;
        return fixedTokensMatchAt(characters, tokens, 0, context);
    }
    if (manyCount === 1) {
        const prefix = tokens.slice(0, firstManyIndex);
        const suffix = tokens.slice(firstManyIndex + 1);
        if (prefix.length + suffix.length > characters.length)
            return false;
        const prefixMatches = fixedTokensMatchAt(characters, prefix, 0, context);
        if (prefixMatches !== true)
            return prefixMatches;
        return fixedTokensMatchAt(characters, suffix, characters.length - suffix.length, context);
    }
    let characterIndex = 0;
    let tokenIndex = 0;
    let manyTokenIndex = -1;
    let manyCharacterIndex = 0;
    while (characterIndex < characters.length) {
        if (context.remainingSteps <= 0)
            return 'unknown';
        context.remainingSteps -= 1;
        const token = tokens[tokenIndex];
        if (token?.kind === 'single'
            || (token?.kind === 'literal'
                && token.value === asciiFoldByte(characters[characterIndex]))) {
            characterIndex += 1;
            tokenIndex += 1;
        }
        else if (token?.kind === 'many') {
            manyTokenIndex = tokenIndex;
            manyCharacterIndex = characterIndex;
            tokenIndex += 1;
        }
        else if (manyTokenIndex >= 0) {
            manyCharacterIndex += 1;
            characterIndex = manyCharacterIndex;
            tokenIndex = manyTokenIndex + 1;
        }
        else {
            return false;
        }
    }
    while (tokens[tokenIndex]?.kind === 'many') {
        if (context.remainingSteps <= 0)
            return 'unknown';
        context.remainingSteps -= 1;
        tokenIndex += 1;
    }
    return tokenIndex === tokens.length;
}
function criterionMatches(criterion, message, wildcardContext) {
    if (message.unavailableFields?.includes(criterion.field))
        return 'unknown';
    const addressField = ['from_address', 'from_domain'].includes(criterion.field);
    if (addressField && message.unavailableFields?.includes('from'))
        return 'unknown';
    const address = addressField ? (0, rule_address_1.senderAddress)(message.from || '') : null;
    if (addressField && !address)
        return 'unknown';
    const actualText = addressField ? (criterion.field === 'from_domain' ? address.split('@').at(-1) : address) : String(message[criterion.field] || '');
    const expectedText = String(criterion.value);
    if (criterion.operator === 'matches') {
        let characters = wildcardContext.valueBytes.get(criterion.field);
        if (!characters) {
            characters = Buffer.from(actualText, 'utf8');
            wildcardContext.valueBytes.set(criterion.field, characters);
        }
        return matchesWildcardPattern(characters, expectedText, wildcardContext);
    }
    const actual = actualText.toLowerCase();
    const expected = expectedText.toLowerCase();
    if (criterion.operator === 'is_one_of')
        return (0, rule_semantics_1.ruleAddressValues)(expectedText).includes(actual);
    const matches = criterion.operator === 'equals' ? actual === expected : actual.includes(expected);
    return criterion.operator === 'not_contains' ? !matches : matches;
}
function evaluateRulesForMessage(rules, message) {
    const result = {
        matchedRuleIds: [],
        matchedRuleDetails: [],
        moveFolders: [],
        deliveryOnlyActions: [],
        unevaluatedRuleIds: [],
    };
    const wildcardContext = {
        remainingSteps: MAX_WILDCARD_MATCH_STEPS_PER_MESSAGE,
        valueBytes: new Map(),
    };
    let blockedByUndecidableStoppingRule = false;
    rules.forEach((rule, index) => {
        if (result.stoppedByRuleId || blockedByUndecidableStoppingRule || rule.enabled === false)
            return;
        const executableCriterionSet = new Set((0, rule_semantics_2.executableRuleCriteria)(rule));
        const executableCriteria = (rule.criteria || []).flatMap((criterion, criterionIndex) => (executableCriterionSet.has(criterion)
            ? [{ criterion, criterionIndex }]
            : []));
        const exceptionMatches = (rule.exceptions || []).map(item => ({ field: item.field, match: criterionMatches(item, message, wildcardContext) }));
        const addressExceptions = exceptionMatches.filter(item => item.field === 'from_address').map(item => item.match);
        const allExceptions = exceptionMatches.map(item => item.match);
        const addressSafe = addressExceptions.includes(true) ? true : addressExceptions.includes('unknown') ? 'unknown' : false;
        const domainSafe = allExceptions.includes(true) ? true : allExceptions.includes('unknown') ? 'unknown' : false;
        const criteria = executableCriteria.map(({ criterion }) => {
            const match = criterionMatches(criterion, message, wildcardContext);
            if (match === false)
                return false;
            const safe = criterion.field === 'from_domain' ? domainSafe : addressSafe;
            if (safe === true)
                return false;
            return safe === 'unknown' ? 'unknown' : match;
        });
        const actions = (0, rule_semantics_2.executableRuleActions)(rule);
        if (criteria.length === 0 || actions.length === 0)
            return;
        const hasUnknown = criteria.includes('unknown');
        const knownCriteria = criteria.filter((match) => match !== 'unknown');
        const matches = rule.condition === 'any'
            ? knownCriteria.some(Boolean)
            : knownCriteria.length === criteria.length && knownCriteria.every(Boolean);
        const canDecide = rule.condition === 'any'
            ? matches || !hasUnknown
            : knownCriteria.includes(false) || !hasUnknown;
        if (!canDecide) {
            result.unevaluatedRuleIds.push(String(rule.id || rule.name || `rule-${index + 1}`));
            if (rule.stopProcessing !== false) {
                blockedByUndecidableStoppingRule = true;
                result.moveFolders = [];
                result.deliveryOnlyActions = [];
            }
            return;
        }
        if (!matches)
            return;
        const ruleId = String(rule.id || rule.name || `rule-${index + 1}`);
        result.matchedRuleIds.push(ruleId);
        result.matchedRuleDetails.push({
            id: ruleId,
            condition: rule.condition === 'any' ? 'any' : 'all',
            matchedCriterionIndexes: executableCriteria.flatMap(({ criterionIndex }, resultIndex) => (criteria[resultIndex] === true ? [criterionIndex] : [])),
            totalCriteria: executableCriteria.length,
        });
        for (const action of actions) {
            if (action.type === 'move' && action.folder) {
                result.moveFolders = result.moveFolders.filter(folder => folder !== action.folder);
                result.moveFolders.push(action.folder);
            }
            else if ((action.type === 'reject' || action.type === 'discard')
                && !result.deliveryOnlyActions.includes(action.type)) {
                result.deliveryOnlyActions.push(action.type);
            }
        }
        if (rule.stopProcessing !== false) {
            result.stoppedByRuleId = ruleId;
        }
    });
    return result;
}
//# sourceMappingURL=rule-engine.js.map