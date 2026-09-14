import { senderAddress } from './rule-address';
import crypto from 'crypto';
import { pool } from './db';
import type { SieveRulesDocument } from './rule-semantics';

export const USER_JUNK_RULE_ID = 'oms-user-marked-junk';


export function junkEntries(document: SieveRulesDocument) {
    const rule = document.rules?.find(rule => rule.id === USER_JUNK_RULE_ID);
    return (rule?.criteria || []).filter(item => item.operator === 'equals' && ['from_address', 'from_domain'].includes(item.field))
        .map(item => ({ kind: item.field === 'from_domain' ? 'domain' as const : 'sender' as const, value: item.value }));
}

export function updateJunkRule(document: SieveRulesDocument, addresses: string[], scope: 'sender' | 'domain' | 'remove', junkFolder: string): SieveRulesDocument {
    const existing = document.rules?.find(rule => rule.id === USER_JUNK_RULE_ID);
    const criteria = [...(existing?.criteria || [])];
    let exceptions = [...(existing?.exceptions || [])];
    for (const raw of addresses) {
        const address = senderAddress(raw);
        if (!address) throw new Error('The message must have one valid sender address before it can update the Junk list.');
        const domain = address.slice(address.lastIndexOf('@') + 1);
        if (scope === 'remove') {
            for (let i = criteria.length - 1; i >= 0; i--) {
                if ((criteria[i].field === 'from_address' && criteria[i].value.toLowerCase() === address)
                    || (criteria[i].field === 'from_domain' && criteria[i].value.toLowerCase() === domain)) criteria.splice(i, 1);
            }
        } else {
            const field = scope === 'sender' ? 'from_address' : 'from_domain';
            const value = scope === 'sender' ? address : domain;
            exceptions = exceptions.filter(item => !(item.field === 'from_address' && item.value === address) && !(item.field === field && item.value === value));
            if (!criteria.some(item => item.field === field && item.value.toLowerCase() === value)) criteria.push({ field, operator: 'equals', value });
        }
    }
    return { ...document, rules: [{ id: USER_JUNK_RULE_ID, name: 'User-marked Junk', enabled: true, stopProcessing: true,
        condition: 'any', criteria, ...(exceptions.length ? { exceptions } : {}), actions: [{ type: 'move', folder: junkFolder }] }, ...(document.rules || []).filter(rule => rule.id !== USER_JUNK_RULE_ID)] };
}

// Serialize all webmail rule writers across backend processes, without holding a SQL transaction.
export async function withUserRuleLock<T>(username: string, operation: () => Promise<T>): Promise<T> {
    const connection = await pool.getConnection();
    const name = 'oms-rules-' + crypto.createHash('sha256').update(username).digest('hex').slice(0, 50);
    let locked = false;
    try {
        const [rows]: any = await connection.query('SELECT GET_LOCK(?, 10) AS acquired', [name]);
        locked = Number(rows?.[0]?.acquired) === 1;
        if (!locked) throw new Error('Rules are busy. Try again.');
        return await operation();
    } finally {
        if (locked) await connection.query('SELECT RELEASE_LOCK(?)', [name]).catch(() => {});
        connection.release();
    }
}
