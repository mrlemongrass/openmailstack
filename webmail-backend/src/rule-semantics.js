"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.executableRuleActions = exports.executableRuleCriteria = exports.isExecutableRuleCriterion = exports.ruleAddressValues = void 0;
const supportedFields = new Set(['subject', 'from', 'to', 'body', 'from_address', 'from_domain']);
const supportedOperators = new Set(['contains', 'not_contains', 'equals', 'matches', 'is_one_of']);
const ruleAddressValues = (value) => value.split(/[,\n]/).map(item => item.trim().toLowerCase()).filter(Boolean);
exports.ruleAddressValues = ruleAddressValues;
const isExecutableRuleCriterion = (criterion) => (Boolean(criterion.value)
    && supportedFields.has(criterion.field)
    && supportedOperators.has(criterion.operator)
    && (criterion.operator !== 'is_one_of' || (criterion.field === 'from_address'
        && (0, exports.ruleAddressValues)(criterion.value).length > 0
        && (0, exports.ruleAddressValues)(criterion.value).every(value => /^[^\s@<>,]+@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/.test(value)))));
exports.isExecutableRuleCriterion = isExecutableRuleCriterion;
const executableRuleCriteria = (rule) => ((rule.criteria || []).some(criterion => (Boolean(criterion.value) && !(0, exports.isExecutableRuleCriterion)(criterion)))
    ? []
    : (rule.criteria || []).filter(exports.isExecutableRuleCriterion));
exports.executableRuleCriteria = executableRuleCriteria;
const executableRuleActions = (rule) => ((rule.actions || []).filter(action => (action.type === 'reject'
    || action.type === 'discard'
    || (action.type === 'move' && Boolean(action.folder)))));
exports.executableRuleActions = executableRuleActions;
//# sourceMappingURL=rule-semantics.js.map