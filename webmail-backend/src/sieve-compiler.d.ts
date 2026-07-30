import { type SieveRulesDocument } from './rule-semantics';
export type { SieveAction, SieveCriterion, SieveRule, SieveRulesDocument, SieveVacation, } from './rule-semantics';
export declare function extractJsonFromSieve(script: string): SieveRulesDocument;
export declare function quoteSieveString(value: unknown): string;
export declare function compileSieve(jsonData: SieveRulesDocument): string;
//# sourceMappingURL=sieve-compiler.d.ts.map