import type { SieveRulesDocument } from './rule-semantics';
export interface SenderPolicyEntry {
    kind: 'sender' | 'domain';
    value: string;
    disposition: 'block' | 'safe';
}
export declare function normalizeSenderPolicyEntry(input: any): SenderPolicyEntry;
export declare function senderPolicyEntries(document: SieveRulesDocument): SenderPolicyEntry[];
export declare function legacySenderPolicyEntries(spam: any): {
    original: string;
    entry: SenderPolicyEntry;
}[];
export declare function updateSenderPolicy(document: SieveRulesDocument, entries: SenderPolicyEntry[], junkFolder: string, remove?: boolean): SieveRulesDocument;
//# sourceMappingURL=sender-policy.d.ts.map