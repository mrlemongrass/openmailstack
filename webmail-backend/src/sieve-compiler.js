"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractJsonFromSieve = extractJsonFromSieve;
exports.quoteSieveString = quoteSieveString;
exports.compileSieve = compileSieve;
const rule_semantics_1 = require("./rule-semantics");
const rule_analysis_1 = require("./rule-analysis");
const JSON_DATA_BASE64_PATTERN = /\/\* JSON_DATA_BASE64: ([A-Za-z0-9_-]+) \*\//;
const LEGACY_JSON_DATA_PATTERN = /\/\* JSON_DATA: ([\s\S]*?) \*\//;
const JSON_DATA_BASE64_MARKER = '/* JSON_DATA_BASE64:';
const LEGACY_JSON_DATA_MARKER = '/* JSON_DATA:';
const MAX_ENCODED_JSON_CHARACTERS = Math.ceil(rule_analysis_1.RULE_ANALYSIS_LIMITS.serializedBytes * 4 / 3) + 4;
function extractJsonFromSieve(script) {
    const encodedMatch = script.match(JSON_DATA_BASE64_PATTERN);
    if (encodedMatch?.[1]) {
        if (encodedMatch[1].length > MAX_ENCODED_JSON_CHARACTERS) {
            throw new Error('Saved rule metadata exceeds the safe size limit.');
        }
        const decoded = Buffer.from(encodedMatch[1], 'base64url');
        if (decoded.byteLength > rule_analysis_1.RULE_ANALYSIS_LIMITS.serializedBytes) {
            throw new Error('Saved rule metadata exceeds the safe size limit.');
        }
        try {
            return JSON.parse(decoded.toString('utf8'));
        }
        catch {
            throw new Error('Saved rule metadata is malformed.');
        }
    }
    if (script.includes(JSON_DATA_BASE64_MARKER)) {
        throw new Error('Saved rule metadata is malformed.');
    }
    const legacyMatch = script.match(LEGACY_JSON_DATA_PATTERN);
    if (legacyMatch?.[1]) {
        if (Buffer.byteLength(legacyMatch[1], 'utf8') > rule_analysis_1.RULE_ANALYSIS_LIMITS.serializedBytes) {
            throw new Error('Saved rule metadata exceeds the safe size limit.');
        }
        try {
            return JSON.parse(legacyMatch[1]);
        }
        catch {
            throw new Error('Saved rule metadata is malformed.');
        }
    }
    if (script.includes(LEGACY_JSON_DATA_MARKER)) {
        throw new Error('Saved rule metadata is malformed.');
    }
    throw new Error('Saved rule metadata is missing.');
}
function quoteSieveString(value) {
    const text = String(value ?? '')
        .replace(/\r\n|\r|\n/g, ' ')
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"');
    return `"${text}"`;
}
function compileCriterion(criterion) {
    if (!criterion.value)
        return null;
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
    }
    else if (criterion.field === 'body') {
        test = `body :text ${matchType} ${quoteSieveString(criterion.value)}`;
    }
    if (!test)
        return null;
    return negate ? `not ${test}` : test;
}
function compileAction(action) {
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
function compileSieve(jsonData) {
    if ((0, rule_analysis_1.exceedsRuleAnalysisLimits)(jsonData)) {
        throw new Error('Rule document exceeds the safe compilation limit.');
    }
    const normalized = (0, rule_analysis_1.normalizeRuleDocument)(jsonData);
    if (!normalized)
        throw new Error('Rule document is malformed.');
    jsonData = normalized;
    let script = 'require ["fileinto", "reject", "envelope", "body", "vacation"];\n\n';
    const encodedJson = Buffer.from(JSON.stringify(jsonData || { rules: [] }), 'utf8').toString('base64url');
    script += `/* JSON_DATA_BASE64: ${encodedJson} */\n\n`;
    for (const rule of jsonData.rules || []) {
        if (rule.enabled === false)
            continue;
        const criteriaStrings = (0, rule_semantics_1.executableRuleCriteria)(rule)
            .map(compileCriterion)
            .filter((criterion) => Boolean(criterion));
        const actionStrings = (0, rule_semantics_1.executableRuleActions)(rule)
            .map(compileAction)
            .filter((action) => Boolean(action));
        if (criteriaStrings.length === 0 || actionStrings.length === 0)
            continue;
        script += `# Rule: ${String(rule.name || 'Unnamed').replace(/\r\n|\r|\n/g, ' ')}\n`;
        const operator = rule.condition === 'any' ? 'anyof' : 'allof';
        script += `if ${operator} (${criteriaStrings.join(', ')}) {\n`;
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
//# sourceMappingURL=sieve-compiler.js.map