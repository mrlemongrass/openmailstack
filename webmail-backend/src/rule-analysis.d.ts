import type { SieveRulesDocument } from './rule-semantics';
export type RuleAnalysisFindingKind = 'exact_criterion' | 'exact_action' | 'cross_rule_criterion' | 'possible_overlap';
export interface RuleAnalysisOccurrence {
    ruleIndex: number;
    ruleId: string;
    ruleName: string;
    ruleEnabled: boolean;
    itemType: 'criterion' | 'action';
    itemIndex: number;
    itemId?: string;
}
export interface RuleAnalysisRemoval {
    ruleIndex: number;
    itemType: 'criterion' | 'action';
    itemIndex: number;
}
export interface RuleAnalysisFinding {
    id: string;
    kind: RuleAnalysisFindingKind;
    safety: 'safe' | 'review';
    label: string;
    explanation: string;
    occurrences: RuleAnalysisOccurrence[];
    omittedOccurrences?: number;
}
export interface RuleAnalysis {
    summary: {
        exactCriterionDuplicates: number;
        exactActionDuplicates: number;
        crossRuleRepeats: number;
        possibleOverlaps: number;
        removableItems: number;
    };
    removals: RuleAnalysisRemoval[];
    findings: RuleAnalysisFinding[];
    truncated: boolean;
}
export declare const RULE_ANALYSIS_LIMITS: {
    readonly rules: 1000;
    readonly items: 10000;
    readonly stringCharacters: 4096;
    readonly totalStringCharacters: 1000000;
};
export declare const exceedsRuleAnalysisLimits: (document: SieveRulesDocument) => boolean;
export declare function analyzeRuleDocument(document: SieveRulesDocument): RuleAnalysis;
//# sourceMappingURL=rule-analysis.d.ts.map