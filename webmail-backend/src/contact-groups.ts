import {
    contactVCard,
    nextContactSyncTokenOnConnection,
    stampVCardRevision,
    withContactMutation,
    type ContactMutationConnection,
} from './contact-utils';
import { pool } from './db';

export class ContactGroupError extends Error {
    constructor(message: string, public readonly status = 400) { super(message); }
}

function lines(vcard: string): string[] {
    return vcard.replace(/\r?\n[ \t]/g, '').split(/\r?\n/).filter(Boolean);
}

function property(line: string): string {
    return line.split(':', 1)[0].split(';', 1)[0].split('.').pop()!.toUpperCase();
}

export function isGroupVCard(vcard: string): boolean {
    return lines(vcard).some(line => ['KIND', 'X-ADDRESSBOOKSERVER-KIND'].includes(property(line))
        && line.slice(line.indexOf(':') + 1).trim().toLowerCase() === 'group');
}

export function hasVCardCategories(vcard: string): boolean {
    return lines(vcard).some(line => property(line) === 'CATEGORIES');
}

export function validateContactGroupName(value: unknown): string {
    if (typeof value !== 'string' || !value.trim() || Buffer.byteLength(value.trim()) > 255 || /[\x00-\x1f\x7f]/.test(value)) {
        throw new ContactGroupError('Group name must contain 1–255 UTF-8 bytes without control characters');
    }
    return value.trim();
}

export function vCardCategories(vcard: string): string[] {
    const categories: string[] = [];
    for (const line of lines(vcard)) {
        if (property(line) !== 'CATEGORIES') continue;
        let value = '';
        const raw = line.slice(line.indexOf(':') + 1);
        const add = () => { if (value.trim()) categories.push(validateContactGroupName(value)); value = ''; };
        for (let i = 0; i < raw.length; i++) {
            if (raw[i] === '\\' && i + 1 < raw.length) {
                const next = raw[++i];
                value += /n/i.test(next) ? '\n' : next;
            } else if (raw[i] === ',') add();
            else value += raw[i];
        }
        add();
    }
    const unique = [...new Set(categories)];
    if (unique.length > 128) throw new ContactGroupError('A contact can belong to at most 128 groups');
    return unique;
}

export function setVCardCategories(vcard: string, categories: string[]): string {
    const result = lines(vcard).filter(line => property(line) !== 'CATEGORIES');
    if (categories.length) {
        const escaped = categories.map(value => value.replace(/\\/g, '\\\\').replace(/,/g, '\\,').replace(/;/g, '\\;'));
        const end = result.findIndex(line => line.toUpperCase() === 'END:VCARD');
        result.splice(end < 0 ? result.length : end, 0, foldLine(`CATEGORIES:${escaped.join(',')}`));
    }
    return `${result.join('\r\n')}\r\n`;
}

function foldLine(line: string): string {
    let folded = '', segment = '';
    for (const character of line) {
        if (Buffer.byteLength(segment + character) > 75) { folded += `${segment}\r\n`; segment = ' '; }
        segment += character;
    }
    return folded + segment;
}

export function foldVCardCategoryLines(vcard: string): string {
    return lines(vcard).map(line => property(line) === 'CATEGORIES' ? foldLine(line) : line).join('\r\n') + '\r\n';
}

// Explicit, additive reconciliation for groups/categories created before the bridge.
// A dry run reports counts only. It never rewrites or deletes contacts or memberships.
export async function reconcileContactGroups(user: string, apply = false) {
    const reconcile = async (connection: ContactMutationConnection) => {
        const [contacts]: any = await connection.query('SELECT * FROM contacts WHERE username = ? ORDER BY id LIMIT 10001', [user]);
        if (contacts.length > 10000) throw new ContactGroupError('Reconciliation requires at most 10000 contacts per account');
        const [members]: any = await connection.query(
            `SELECT m.contact_id, g.name FROM contact_group_members m JOIN contact_groups g ON g.id = m.group_id
             JOIN contacts c ON c.id = m.contact_id AND c.username COLLATE utf8mb4_unicode_ci = g.username WHERE g.username = ?`, [user],
        );
        const plan: { id: number; names: string[] }[] = [];
        for (const contact of contacts) {
            if (isGroupVCard(contact.vcard_data || '')) throw new ContactGroupError('Existing group vCards require separate review before reconciliation');
            const categories = vCardCategories(contact.vcard_data || '');
            const names = [...new Set<string>(members.filter((row: any) => row.contact_id === contact.id).map((row: any) => String(row.name)))];
            const combined = [...new Set([...categories, ...names])];
            combined.forEach(validateContactGroupName);
            if (combined.length > 128) throw new ContactGroupError('A contact can belong to at most 128 groups');
            if (JSON.stringify([...categories].sort()) !== JSON.stringify([...names].sort())) plan.push({ id: contact.id, names: combined });
        }
        if (apply) for (const contact of plan) {
            await syncContactCategoryMemberships(connection, user, contact.id, contact.names);
            await projectContactGroupCategories(connection, user, [contact.id]);
        }
        return { contactsChecked: contacts.length, contactsToReconcile: plan.length, applied: apply };
    };
    if (apply) return withContactMutation(user, reconcile);
    // Do not call schema initialization from a preview: its legacy UID backfill writes data.
    const connection = await pool.getConnection();
    try {
        await connection.query('START TRANSACTION READ ONLY');
        return await reconcile(connection);
    } finally {
        try { await connection.rollback(); connection.release(); }
        catch (error) { connection.destroy(); throw error; }
    }
}

// Called inside the same owner lock/transaction as the contact write.
export async function syncContactCategoryMemberships(
    connection: ContactMutationConnection, user: string, contactId: number, categories: string[],
): Promise<void> {
    const groupIds: number[] = [];
    for (const name of categories) {
        const [rows]: any = await connection.query(
            'SELECT id FROM contact_groups WHERE username = ? AND BINARY name = BINARY ? ORDER BY id LIMIT 1', [user, name],
        );
        if (rows.length) groupIds.push(Number(rows[0].id));
        else {
            const [result]: any = await connection.query('INSERT INTO contact_groups (username, name) VALUES (?, ?)', [user, name]);
            groupIds.push(Number(result.insertId));
        }
    }
    await connection.query(
        `DELETE m FROM contact_group_members m JOIN contact_groups g ON g.id = m.group_id
         WHERE m.contact_id = ? AND g.username = ?`, [contactId, user],
    );
    for (const groupId of groupIds) {
        await connection.query('INSERT INTO contact_group_members (group_id, contact_id) VALUES (?, ?)', [groupId, contactId]);
    }
}

export async function projectContactGroupCategories(
    connection: ContactMutationConnection, user: string, contactIds: number[],
): Promise<number> {
    if (!contactIds.length) return 0;
    const [contacts]: any = await connection.query('SELECT * FROM contacts WHERE username = ? AND id IN (?)', [user, contactIds]);
    const [members]: any = await connection.query(
        `SELECT m.contact_id, g.name FROM contact_group_members m
         JOIN contact_groups g ON g.id = m.group_id
         WHERE g.username = ? AND m.contact_id IN (?) ORDER BY g.name, g.id`, [user, contactIds],
    );
    let changed = 0;
    for (const contact of contacts) {
        const names = [...new Set<string>(members.filter((row: any) => row.contact_id === contact.id).map((row: any) => String(row.name)))];
        if (names.length > 128) throw new ContactGroupError('A contact can belong to at most 128 groups');
        names.forEach(validateContactGroupName);
        const vcard = contactVCard(contact);
        if (JSON.stringify([...vCardCategories(vcard)].sort()) === JSON.stringify([...names].sort())) continue;
        const token = await nextContactSyncTokenOnConnection(connection, user);
        await connection.query('UPDATE contacts SET vcard_data = ?, sync_token = ? WHERE id = ? AND username = ?',
            [setVCardCategories(stampVCardRevision(vcard), names), token, contact.id, user]);
        changed++;
    }
    return changed;
}

function groupId(value: unknown): number {
    if (typeof value !== 'number' && (typeof value !== 'string' || !/^[1-9]\d*$/.test(value))) {
        throw new ContactGroupError('Invalid group or contact ID');
    }
    const id = Number(value);
    if (!Number.isSafeInteger(id) || id < 1) throw new ContactGroupError('Invalid group or contact ID');
    return id;
}

async function ownedGroup(connection: ContactMutationConnection, user: string, id: number) {
    const [rows]: any = await connection.query('SELECT * FROM contact_groups WHERE id = ? AND username = ?', [id, user]);
    if (!rows.length) throw new ContactGroupError('Group not found', 404);
    return rows[0];
}

async function assertUniqueName(connection: ContactMutationConnection, user: string, name: string, id = 0) {
    const [rows]: any = await connection.query(
        'SELECT id FROM contact_groups WHERE username = ? AND BINARY name = BINARY ? AND id <> ? LIMIT 1', [user, name, id],
    );
    if (rows.length) throw new ContactGroupError('A group with that name already exists', 409);
}

export async function createContactGroup(user: string, rawName: unknown, color?: unknown): Promise<number> {
    const name = validateContactGroupName(rawName);
    const validColor = validateColor(color);
    return withContactMutation(user, async connection => {
        await assertUniqueName(connection, user, name);
        const [result]: any = await connection.query('INSERT INTO contact_groups (username, name, color) VALUES (?, ?, ?)',
            [user, name, validColor || '#60a5fa']);
        return Number(result.insertId);
    });
}

function validateColor(color: unknown): string | null {
    if (color === undefined || color === null || color === '') return null;
    if (typeof color !== 'string' || !/^#[\da-f]{6}$/i.test(color)) throw new ContactGroupError('Invalid group color');
    return color;
}

export async function updateContactGroup(user: string, rawId: unknown, updates: { name?: unknown; color?: unknown } | null): Promise<void> {
    const id = groupId(rawId);
    const name = updates?.name === undefined ? null : validateContactGroupName(updates.name);
    const color = validateColor(updates?.color);
    await withContactMutation(user, async connection => {
        await ownedGroup(connection, user, id);
        const [members]: any = await connection.query('SELECT contact_id FROM contact_group_members WHERE group_id = ?', [id]);
        if (updates === null) {
            await connection.query('DELETE FROM contact_group_members WHERE group_id = ?', [id]);
            await connection.query('DELETE FROM contact_groups WHERE id = ? AND username = ?', [id, user]);
        } else {
            if (name !== null) await assertUniqueName(connection, user, name, id);
            await connection.query('UPDATE contact_groups SET name = COALESCE(?, name), color = COALESCE(?, color) WHERE id = ? AND username = ?', [name, color, id, user]);
        }
        await projectContactGroupCategories(connection, user, members.map((row: any) => Number(row.contact_id)));
    });
}

export async function changeContactGroupMembers(user: string, rawId: unknown, rawContactIds: unknown, remove = false): Promise<number> {
    const id = groupId(rawId);
    if (!Array.isArray(rawContactIds) || rawContactIds.length > 1000) throw new ContactGroupError('Provide at most 1000 contact IDs');
    const ids = [...new Set(rawContactIds.map(groupId))];
    return withContactMutation(user, async connection => {
        await ownedGroup(connection, user, id);
        if (!ids.length) return 0;
        const [contacts]: any = await connection.query('SELECT id FROM contacts WHERE username = ? AND id IN (?) AND deleted_at IS NULL', [user, ids]);
        if (contacts.length !== ids.length) throw new ContactGroupError('Contact not found', 404);
        let changed = 0;
        for (const contactId of ids) {
            const [result]: any = await connection.query(remove
                ? 'DELETE FROM contact_group_members WHERE group_id = ? AND contact_id = ?'
                : 'INSERT IGNORE INTO contact_group_members (group_id, contact_id) VALUES (?, ?)', [id, contactId]);
            changed += Number(result.affectedRows);
        }
        await projectContactGroupCategories(connection, user, ids);
        return changed;
    });
}
