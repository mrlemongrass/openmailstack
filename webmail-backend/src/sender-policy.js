"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeSenderPolicyEntry = normalizeSenderPolicyEntry;
exports.senderPolicyEntries = senderPolicyEntries;
exports.legacySenderPolicyEntries = legacySenderPolicyEntries;
exports.updateSenderPolicy = updateSenderPolicy;
const rule_address_1 = require("./rule-address");
const junk_rules_1 = require("./junk-rules");
function normalizeSenderPolicyEntry(input) {
    if (!input || !['sender', 'domain'].includes(input.kind) || !['block', 'safe'].includes(input.disposition)
        || typeof input.value !== 'string' || input.value.length > 320)
        throw new Error('Choose a sender address or an exact domain.');
    const value = input.value.trim().toLowerCase();
    const parsed = (0, rule_address_1.senderAddress)(input.kind === 'sender' ? value : `probe@${value}`);
    if (!parsed || (input.kind === 'sender' ? parsed !== value : parsed !== `probe@${value}`)) {
        throw new Error('Enter one full email address or an exact domain without wildcards.');
    }
    return { kind: input.kind, value, disposition: input.disposition };
}
function senderPolicyEntries(document) {
    const rule = document.rules?.find(rule => rule.id === junk_rules_1.USER_JUNK_RULE_ID);
    return ['block', 'safe'].flatMap(disposition => ((disposition === 'block' ? rule?.criteria : rule?.exceptions) || []).filter(item => item.operator === 'equals' && ['from_address', 'from_domain'].includes(item.field))
        .map(item => ({ kind: item.field === 'from_domain' ? 'domain' : 'sender', value: item.value, disposition })));
}
function legacySenderPolicyEntries(spam) {
    return ['block', 'safe'].flatMap(disposition => {
        const values = disposition === 'block' ? spam?.blockedSenders : spam?.safeSenders;
        return (Array.isArray(values) ? values : []).map(raw => {
            try {
                if (typeof raw !== 'string')
                    throw new Error();
                const value = raw.trim().replace(/^\*?@/, '');
                return { original: raw, entry: normalizeSenderPolicyEntry({ value, disposition, kind: value.includes('@') ? 'sender' : 'domain' }) };
            }
            catch {
                return { original: String(raw), entry: null };
            }
        });
    });
}
function updateSenderPolicy(document, entries, junkFolder, remove = false) {
    const updated = (0, junk_rules_1.updateJunkRule)(document, [], 'sender', junkFolder);
    const rule = updated.rules[0];
    rule.exceptions = [...(rule.exceptions || [])];
    for (const entry of entries) {
        const field = entry.kind === 'domain' ? 'from_domain' : 'from_address';
        const same = (item) => item.field === field && item.value.toLowerCase() === entry.value;
        if (!remove || entry.disposition === 'block')
            rule.criteria = (rule.criteria || []).filter(item => !same(item));
        if (!remove || entry.disposition === 'safe')
            rule.exceptions = rule.exceptions.filter(item => !same(item));
        if (!remove)
            (entry.disposition === 'block' ? rule.criteria : rule.exceptions).push({ field, operator: 'equals', value: entry.value });
    }
    return updated;
}
//# sourceMappingURL=sender-policy.js.map