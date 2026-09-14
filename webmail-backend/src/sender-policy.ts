import { senderAddress } from './rule-address';
import { USER_JUNK_RULE_ID, updateJunkRule } from './junk-rules';
import type { SieveRulesDocument } from './rule-semantics';

export interface SenderPolicyEntry { kind: 'sender' | 'domain'; value: string; disposition: 'block' | 'safe' }

export function normalizeSenderPolicyEntry(input: any): SenderPolicyEntry {
    if (!input || !['sender', 'domain'].includes(input.kind) || !['block', 'safe'].includes(input.disposition)
        || typeof input.value !== 'string' || input.value.length > 320) throw new Error('Choose a sender address or an exact domain.');
    const value = input.value.trim().toLowerCase();
    const parsed = senderAddress(input.kind === 'sender' ? value : `probe@${value}`);
    if (!parsed || (input.kind === 'sender' ? parsed !== value : parsed !== `probe@${value}`)) {
        throw new Error('Enter one full email address or an exact domain without wildcards.');
    }
    return { kind: input.kind, value, disposition: input.disposition };
}

export function senderPolicyEntries(document: SieveRulesDocument): SenderPolicyEntry[] {
    const rule = document.rules?.find(rule => rule.id === USER_JUNK_RULE_ID);
    return (['block', 'safe'] as const).flatMap(disposition => (
        (disposition === 'block' ? rule?.criteria : rule?.exceptions) || []
    ).filter(item => item.operator === 'equals' && ['from_address', 'from_domain'].includes(item.field))
        .map(item => ({ kind: item.field === 'from_domain' ? 'domain' : 'sender', value: item.value, disposition })));
}

export function legacySenderPolicyEntries(spam: any) {
    return (['block', 'safe'] as const).flatMap(disposition => {
        const values = disposition === 'block' ? spam?.blockedSenders : spam?.safeSenders;
        return (Array.isArray(values) ? values : []).map(raw => {
            try {
                if (typeof raw !== 'string') throw new Error();
                const value = raw.trim().replace(/^\*?@/, '');
                return { original: raw, entry: normalizeSenderPolicyEntry({ value, disposition, kind: value.includes('@') ? 'sender' : 'domain' }) };
            } catch { return { original: String(raw), entry: null }; }
        });
    });
}

export function updateSenderPolicy(document: SieveRulesDocument, entries: SenderPolicyEntry[], junkFolder: string, remove = false) {
    const updated = updateJunkRule(document, [], 'sender', junkFolder);
    const rule = updated.rules![0];
    rule.exceptions = [...(rule.exceptions || [])];
    for (const entry of entries) {
        const field = entry.kind === 'domain' ? 'from_domain' : 'from_address';
        const same = (item: { field: string; value: string }) => item.field === field && item.value.toLowerCase() === entry.value;
        if (!remove || entry.disposition === 'block') rule.criteria = (rule.criteria || []).filter(item => !same(item));
        if (!remove || entry.disposition === 'safe') rule.exceptions = rule.exceptions.filter(item => !same(item));
        if (!remove) (entry.disposition === 'block' ? rule.criteria! : rule.exceptions).push({ field, operator: 'equals', value: entry.value });
    }
    return updated;
}
