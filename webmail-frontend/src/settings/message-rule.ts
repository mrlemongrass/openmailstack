import type { Rule } from '../shared/types';

export function messageRuleSender(from: string): string {
  const value = (from.match(/<([^<>]+)>\s*$/)?.[1] || from).trim().toLowerCase();
  return /^[^\s@<>,]+@(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,63}$/.test(value) ? value : '';
}

export function appendRuleSender(rule: Rule, sender: string): Rule {
  if (!sender || messageRuleSender(sender) !== sender) throw new Error('Enter a valid sender address.');
  const next = structuredClone(rule);
  next.criteria ||= [];
  next.actions ||= [];
  next.enabled = next.enabled !== false;
  next.condition = next.condition === 'any' ? 'any' : 'all';
  const addresses = next.criteria.filter(item => item.field === 'from_address' && ['equals', 'is_one_of'].includes(item.operator));
  if (addresses.length === 1) {
    const criterion = addresses[0];
    criterion.value = [...new Set([...criterion.value.split(/[,\n]/).map(value => value.trim().toLowerCase()), sender])].join(', ');
    criterion.operator = 'is_one_of';
  } else if (next.condition === 'any' || next.criteria.length === 0) {
    next.criteria.push({ id: crypto.randomUUID(), field: 'from_address', operator: 'equals', value: sender });
  } else {
    throw new Error('This ALL rule has no single exact sender condition to extend. Review its sender conditions in Settings, or create a separate rule to preserve its restrictions.');
  }
  return next;
}
