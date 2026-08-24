import type { Rule, RuleAnalysisRemoval } from '../shared/types';

const supportedFields = new Set(['subject', 'from', 'to', 'body']);
const supportedOperators = new Set(['contains', 'not_contains', 'equals']);

const asciiFold = (value: string): string => value.replace(/[A-Z]/g, letter => letter.toLowerCase());

const criterionSignature = (criterion: Rule['criteria'][number]): string | null => {
  if (!criterion.value
    || !supportedFields.has(criterion.field)
    || !supportedOperators.has(criterion.operator)) return null;
  return `${criterion.field}\u0000${criterion.operator}\u0000${asciiFold(criterion.value)}`;
};

const actionSignature = (action: Rule['actions'][number]): string | null => {
  if (action.type === 'reject' || action.type === 'discard') return action.type;
  if (action.type === 'move' && action.folder) return `${action.type}\u0000${action.folder}`;
  return null;
};

function duplicateIndexes<T>(items: T[], signatureFor: (item: T) => string | null): number[] {
  const seen = new Set<string>();
  const duplicates: number[] = [];
  items.forEach((item, index) => {
    const signature = signatureFor(item);
    if (!signature) return;
    if (seen.has(signature)) duplicates.push(index);
    else seen.add(signature);
  });
  return duplicates;
}

export function getExactRuleDuplicateIndexes(rule: Rule): {
  criteria: number[];
  actions: number[];
} {
  return {
    criteria: duplicateIndexes(rule.criteria, criterionSignature),
    actions: duplicateIndexes(rule.actions, actionSignature),
  };
}

export function applyRuleDuplicateCleanup(
  rules: Rule[],
  requestedRemovals: RuleAnalysisRemoval[],
): { rules: Rule[]; removedCount: number } {
  const requested = new Set(requestedRemovals.map(removal => (
    `${removal.ruleIndex}:${removal.itemType}:${removal.itemIndex}`
  )));
  let removedCount = 0;

  const cleanedRules = rules.map((rule, ruleIndex) => {
    const duplicates = getExactRuleDuplicateIndexes(rule);
    const criteriaToRemove = new Set(duplicates.criteria.filter(itemIndex => (
      requested.has(`${ruleIndex}:criterion:${itemIndex}`)
    )));
    const actionsToRemove = new Set(duplicates.actions.filter(itemIndex => (
      requested.has(`${ruleIndex}:action:${itemIndex}`)
    )));
    if (criteriaToRemove.size === 0 && actionsToRemove.size === 0) return rule;
    removedCount += criteriaToRemove.size + actionsToRemove.size;
    return {
      ...rule,
      criteria: rule.criteria.filter((_criterion, itemIndex) => !criteriaToRemove.has(itemIndex)),
      actions: rule.actions.filter((_action, itemIndex) => !actionsToRemove.has(itemIndex)),
    };
  });

  return { rules: cleanedRules, removedCount };
}
