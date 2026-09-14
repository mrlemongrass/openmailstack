import type { SieveRulesDocument } from './rule-semantics';
export declare const USER_JUNK_RULE_ID = "oms-user-marked-junk";
export declare function junkEntries(document: SieveRulesDocument): {
    kind: "domain" | "sender";
    value: string;
}[];
export declare function updateJunkRule(document: SieveRulesDocument, addresses: string[], scope: 'sender' | 'domain' | 'remove', junkFolder: string): SieveRulesDocument;
export declare function withUserRuleLock<T>(username: string, operation: () => Promise<T>): Promise<T>;
//# sourceMappingURL=junk-rules.d.ts.map