"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.evaluateRulesForMessage = evaluateRulesForMessage;
const rule_semantics_1 = require("./rule-semantics");
function criterionMatches(criterion, message) {
    if (message.unavailableFields?.includes(criterion.field))
        return 'unknown';
    const actual = String(message[criterion.field] || '').toLowerCase();
    const expected = String(criterion.value).toLowerCase();
    const matches = criterion.operator === 'equals'
        ? actual === expected
        : actual.includes(expected);
    return criterion.operator === 'not_contains' ? !matches : matches;
}
function evaluateRulesForMessage(rules, message) {
    const result = {
        matchedRuleIds: [],
        moveFolders: [],
        deliveryOnlyActions: [],
        unevaluatedRuleIds: [],
    };
    rules.forEach((rule, index) => {
        if (result.stoppedByRuleId || rule.enabled === false)
            return;
        const criteria = (0, rule_semantics_1.executableRuleCriteria)(rule).map(criterion => criterionMatches(criterion, message));
        const actions = (0, rule_semantics_1.executableRuleActions)(rule);
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
            return;
        }
        if (!matches)
            return;
        const ruleId = String(rule.id || rule.name || `rule-${index + 1}`);
        result.matchedRuleIds.push(ruleId);
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