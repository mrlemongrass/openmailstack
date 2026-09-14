import { ruleAddressValues } from './rule-semantics';
import {
    executableRuleActions,
    executableRuleCriteria,
    type SieveAction,
    type SieveCriterion,
    type SieveRulesDocument,
} from './rule-semantics';
import { exceedsRuleAnalysisLimits, normalizeRuleDocument, RULE_ANALYSIS_LIMITS } from './rule-analysis';

export type {
    SieveAction,
    SieveCriterion,
    SieveRule,
    SieveRulesDocument,
    SieveVacation,
} from './rule-semantics';

const JSON_DATA_BASE64_PATTERN = /\/\* JSON_DATA_BASE64: ([A-Za-z0-9_-]+) \*\//;
const LEGACY_JSON_DATA_PATTERN = /\/\* JSON_DATA: ([\s\S]*?) \*\//;
const JSON_DATA_BASE64_MARKER = '/* JSON_DATA_BASE64:';
const LEGACY_JSON_DATA_MARKER = '/* JSON_DATA:';
const MAX_ENCODED_JSON_CHARACTERS = Math.ceil(RULE_ANALYSIS_LIMITS.serializedBytes * 4 / 3) + 4;

export function extractJsonFromSieve(script: string): SieveRulesDocument {
    const encodedMatch = script.match(JSON_DATA_BASE64_PATTERN);
    if (encodedMatch?.[1]) {
        if (encodedMatch[1].length > MAX_ENCODED_JSON_CHARACTERS) {
            throw new Error('Saved rule metadata exceeds the safe size limit.');
        }
        const decoded = Buffer.from(encodedMatch[1], 'base64url');
        if (decoded.byteLength > RULE_ANALYSIS_LIMITS.serializedBytes) {
            throw new Error('Saved rule metadata exceeds the safe size limit.');
        }
        try {
            return JSON.parse(decoded.toString('utf8'));
        } catch {
            throw new Error('Saved rule metadata is malformed.');
        }
    }
    if (script.includes(JSON_DATA_BASE64_MARKER)) {
        throw new Error('Saved rule metadata is malformed.');
    }

    const legacyMatch = script.match(LEGACY_JSON_DATA_PATTERN);
    if (legacyMatch?.[1]) {
        if (Buffer.byteLength(legacyMatch[1], 'utf8') > RULE_ANALYSIS_LIMITS.serializedBytes) {
            throw new Error('Saved rule metadata exceeds the safe size limit.');
        }
        try {
            return JSON.parse(legacyMatch[1]);
        } catch {
            throw new Error('Saved rule metadata is malformed.');
        }
    }
    if (script.includes(LEGACY_JSON_DATA_MARKER)) {
        throw new Error('Saved rule metadata is malformed.');
    }

    throw new Error('Saved rule metadata is missing.');
}

export function quoteSieveString(value: unknown): string {
    const text = String(value ?? '')
        .replace(/\r\n|\r|\n/g, ' ')
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"');
    return `"${text}"`;
}

function compileCriterion(criterion: SieveCriterion): string | null {
    if (!criterion.value) return null;
    if (criterion.operator === 'is_one_of') return `address :all :is "From" [${ruleAddressValues(criterion.value).map(quoteSieveString).join(', ')}]`;

    const matchType = criterion.operator === 'equals'
        ? ':is'
        : criterion.operator === 'matches'
            ? ':matches'
            : ':contains';
    const negate = criterion.operator === 'not_contains';

    let test = '';
    if (criterion.field === 'subject' || criterion.field === 'from' || criterion.field === 'to') {
        const headerName = criterion.field === 'subject' ? 'Subject' : criterion.field === 'from' ? 'From' : 'To';
        test = `header ${matchType} ${quoteSieveString(headerName)} ${quoteSieveString(criterion.value)}`;
    } else if (criterion.field === 'from_address' || criterion.field === 'from_domain') {
        test = `address ${criterion.field === 'from_domain' ? ':domain' : ':all'} ${matchType} \"From\" ${quoteSieveString(criterion.value)}`;
    } else if (criterion.field === 'body') {
        test = `body :text ${matchType} ${quoteSieveString(criterion.value)}`;
    }

    if (!test) return null;
    return negate ? `not ${test}` : test;
}

function compileAction(action: SieveAction): string | null {
    if (action.type === 'move' && action.folder) {
        return `    fileinto ${quoteSieveString(action.folder)};`;
    }
    if (action.type === 'reject') {
        return `    reject "Message rejected by user filter.";`;
    }
    if (action.type === 'discard') {
        return `    discard;`;
    }
    return null;
}

export function compileSieve(jsonData: SieveRulesDocument): string {
    if (exceedsRuleAnalysisLimits(jsonData)) {
        throw new Error('Rule document exceeds the safe compilation limit.');
    }
    const normalized = normalizeRuleDocument(jsonData);
    if (!normalized) throw new Error('Rule document is malformed.');
    jsonData = normalized;
    let script = 'require ["fileinto", "reject", "envelope", "body", "vacation"];\n\n';
    const encodedJson = Buffer.from(JSON.stringify(jsonData || { rules: [] }), 'utf8').toString('base64url');
    script += `/* JSON_DATA_BASE64: ${encodedJson} */\n\n`;

    for (const rule of jsonData.rules || []) {
        if (rule.enabled === false) continue;
        const criteriaStrings = executableRuleCriteria(rule).map(compileCriterion).filter((criterion): criterion is string => Boolean(criterion));
        let condition = `${rule.condition === 'any' ? 'anyof' : 'allof'} (${criteriaStrings.join(', ')})`;
        if (rule.exceptions?.length) {
            const groups = ['from_address', 'from_domain'].flatMap(field => {
                const blocked = executableRuleCriteria(rule).filter(item => item.field === field).map(compileCriterion).filter(Boolean);
                if (!blocked.length) return [];
                const safe = rule.exceptions!.filter(item => item.field === 'from_address' || field === 'from_domain').map(compileCriterion).filter(Boolean);
                const test = `anyof (${blocked.join(', ')})`;
                return [safe.length ? `allof (${test}, not anyof (${safe.join(', ')}))` : test];
            });
            condition = `anyof (${groups.join(', ')})`;
        }
        const actionStrings = executableRuleActions(rule)
            .map(compileAction)
            .filter((action): action is string => Boolean(action));

        if (criteriaStrings.length === 0 || actionStrings.length === 0) continue;

        script += `# Rule: ${String(rule.name || 'Unnamed').replace(/\r\n|\r|\n/g, ' ')}\n`;
        script += `if ${condition} {\n`;
        script += `${actionStrings.join('\n')}\n`;
        if (rule.stopProcessing !== false) {
            script += `    stop;\n`;
        }
        script += `}\n\n`;
    }

    if (jsonData.vacation && jsonData.vacation.enabled && jsonData.vacation.body) {
        script += `# Vacation Auto-Responder\n`;
        const days = jsonData.vacation.days || 1;
        const subjectPart = jsonData.vacation.subject ? ` :subject ${quoteSieveString(jsonData.vacation.subject)}` : '';
        script += `vacation :days ${days}${subjectPart} ${quoteSieveString(jsonData.vacation.body)};\n\n`;
    }

    return script;
}
