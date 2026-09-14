"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.USER_JUNK_RULE_ID = void 0;
exports.junkEntries = junkEntries;
exports.updateJunkRule = updateJunkRule;
exports.withUserRuleLock = withUserRuleLock;
const rule_address_1 = require("./rule-address");
const crypto_1 = __importDefault(require("crypto"));
const db_1 = require("./db");
exports.USER_JUNK_RULE_ID = 'oms-user-marked-junk';
function junkEntries(document) {
    const rule = document.rules?.find(rule => rule.id === exports.USER_JUNK_RULE_ID);
    return (rule?.criteria || []).filter(item => item.operator === 'equals' && ['from_address', 'from_domain'].includes(item.field))
        .map(item => ({ kind: item.field === 'from_domain' ? 'domain' : 'sender', value: item.value }));
}
function updateJunkRule(document, addresses, scope, junkFolder) {
    const existing = document.rules?.find(rule => rule.id === exports.USER_JUNK_RULE_ID);
    const criteria = [...(existing?.criteria || [])];
    for (const raw of addresses) {
        const address = (0, rule_address_1.senderAddress)(raw);
        if (!address)
            throw new Error('The message must have one valid sender address before it can update the Junk list.');
        const domain = address.slice(address.lastIndexOf('@') + 1);
        if (scope === 'remove') {
            for (let i = criteria.length - 1; i >= 0; i--) {
                if ((criteria[i].field === 'from_address' && criteria[i].value.toLowerCase() === address)
                    || (criteria[i].field === 'from_domain' && criteria[i].value.toLowerCase() === domain))
                    criteria.splice(i, 1);
            }
        }
        else {
            const field = scope === 'sender' ? 'from_address' : 'from_domain';
            const value = scope === 'sender' ? address : domain;
            if (!criteria.some(item => item.field === field && item.value.toLowerCase() === value))
                criteria.push({ field, operator: 'equals', value });
        }
    }
    return { ...document, rules: [{ id: exports.USER_JUNK_RULE_ID, name: 'User-marked Junk', enabled: true, stopProcessing: true,
                condition: 'any', criteria, actions: [{ type: 'move', folder: junkFolder }] }, ...(document.rules || []).filter(rule => rule.id !== exports.USER_JUNK_RULE_ID)] };
}
// Serialize all webmail rule writers across backend processes, without holding a SQL transaction.
async function withUserRuleLock(username, operation) {
    const connection = await db_1.pool.getConnection();
    const name = 'oms-rules-' + crypto_1.default.createHash('sha256').update(username).digest('hex').slice(0, 50);
    let locked = false;
    try {
        const [rows] = await connection.query('SELECT GET_LOCK(?, 10) AS acquired', [name]);
        locked = Number(rows?.[0]?.acquired) === 1;
        if (!locked)
            throw new Error('Rules are busy. Try again.');
        return await operation();
    }
    finally {
        if (locked)
            await connection.query('SELECT RELEASE_LOCK(?)', [name]).catch(() => { });
        connection.release();
    }
}
//# sourceMappingURL=junk-rules.js.map