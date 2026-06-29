"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.extractJsonFromSieve = extractJsonFromSieve;
exports.quoteSieveString = quoteSieveString;
exports.compileSieve = compileSieve;
const JSON_DATA_BASE64_PATTERN = /\/\* JSON_DATA_BASE64: ([A-Za-z0-9_-]+) \*\//;
const LEGACY_JSON_DATA_PATTERN = /\/\* JSON_DATA: ([\s\S]*?) \*\//;
function extractJsonFromSieve(script) {
    const encodedMatch = script.match(JSON_DATA_BASE64_PATTERN);
    if (encodedMatch?.[1]) {
        try {
            return JSON.parse(Buffer.from(encodedMatch[1], 'base64url').toString('utf8'));
        }
        catch {
            return { rules: [] };
        }
    }
    const legacyMatch = script.match(LEGACY_JSON_DATA_PATTERN);
    if (legacyMatch?.[1]) {
        try {
            return JSON.parse(legacyMatch[1]);
        }
        catch {
            return { rules: [] };
        }
    }
    return { rules: [] };
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
    const matchType = criterion.operator === 'equals' ? ':is' : ':contains';
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
    let script = 'require ["fileinto", "reject", "envelope", "body", "vacation"];\n\n';
    const encodedJson = Buffer.from(JSON.stringify(jsonData || { rules: [] }), 'utf8').toString('base64url');
    script += `/* JSON_DATA_BASE64: ${encodedJson} */\n\n`;
    for (const rule of jsonData.rules || []) {
        if (rule.enabled === false)
            continue;
        const criteriaStrings = (rule.criteria || [])
            .map(compileCriterion)
            .filter((criterion) => Boolean(criterion));
        const actionStrings = (rule.actions || [])
            .map(compileAction)
            .filter((action) => Boolean(action));
        if (criteriaStrings.length === 0 || actionStrings.length === 0)
            continue;
        script += `# Rule: ${String(rule.name || 'Unnamed').replace(/\r\n|\r|\n/g, ' ')}\n`;
        const operator = rule.condition === 'any' ? 'anyof' : 'allof';
        script += `if ${operator} (${criteriaStrings.join(', ')}) {\n`;
        script += `${actionStrings.join('\n')}\n`;
        script += `    stop;\n}\n\n`;
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