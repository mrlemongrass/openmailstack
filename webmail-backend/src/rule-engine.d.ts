import { type SieveRule } from './rule-semantics';
export interface RuleMessage {
    uid: number;
    subject?: string;
    from?: string;
    to?: string;
    body?: string;
    unavailableFields?: string[];
}
export interface RuleEvaluation {
    matchedRuleIds: string[];
    moveFolders: string[];
    deliveryOnlyActions: string[];
    unevaluatedRuleIds: string[];
    stoppedByRuleId?: string;
}
export declare function evaluateRulesForMessage(rules: SieveRule[], message: RuleMessage): RuleEvaluation;
//# sourceMappingURL=rule-engine.d.ts.map