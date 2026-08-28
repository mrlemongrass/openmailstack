"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.executableRuleActions = exports.executableRuleCriteria = exports.isExecutableRuleCriterion = void 0;
const supportedFields = new Set(['subject', 'from', 'to', 'body']);
const supportedOperators = new Set(['contains', 'not_contains', 'equals']);
const isExecutableRuleCriterion = (criterion) => (Boolean(criterion.value)
    && supportedFields.has(criterion.field)
    && supportedOperators.has(criterion.operator));
exports.isExecutableRuleCriterion = isExecutableRuleCriterion;
const executableRuleCriteria = (rule) => ((rule.criteria || []).filter(exports.isExecutableRuleCriterion));
exports.executableRuleCriteria = executableRuleCriteria;
const executableRuleActions = (rule) => ((rule.actions || []).filter(action => (action.type === 'reject'
    || action.type === 'discard'
    || (action.type === 'move' && Boolean(action.folder)))));
exports.executableRuleActions = executableRuleActions;
//# sourceMappingURL=rule-semantics.js.map