"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ContactGroupError = void 0;
exports.isGroupVCard = isGroupVCard;
exports.hasVCardCategories = hasVCardCategories;
exports.validateContactGroupName = validateContactGroupName;
exports.vCardCategories = vCardCategories;
exports.setVCardCategories = setVCardCategories;
exports.foldVCardCategoryLines = foldVCardCategoryLines;
exports.reconcileContactGroups = reconcileContactGroups;
exports.syncContactCategoryMemberships = syncContactCategoryMemberships;
exports.projectContactGroupCategories = projectContactGroupCategories;
exports.createContactGroup = createContactGroup;
exports.updateContactGroup = updateContactGroup;
exports.changeContactGroupMembers = changeContactGroupMembers;
const contact_utils_1 = require("./contact-utils");
const db_1 = require("./db");
class ContactGroupError extends Error {
    status;
    constructor(message, status = 400) {
        super(message);
        this.status = status;
    }
}
exports.ContactGroupError = ContactGroupError;
function lines(vcard) {
    return vcard.replace(/\r?\n[ \t]/g, '').split(/\r?\n/).filter(Boolean);
}
function property(line) {
    return line.split(':', 1)[0].split(';', 1)[0].split('.').pop().toUpperCase();
}
function isGroupVCard(vcard) {
    return lines(vcard).some(line => ['KIND', 'X-ADDRESSBOOKSERVER-KIND'].includes(property(line))
        && line.slice(line.indexOf(':') + 1).trim().toLowerCase() === 'group');
}
function hasVCardCategories(vcard) {
    return lines(vcard).some(line => property(line) === 'CATEGORIES');
}
function validateContactGroupName(value) {
    if (typeof value !== 'string' || !value.trim() || Buffer.byteLength(value.trim()) > 255 || /[\x00-\x1f\x7f]/.test(value)) {
        throw new ContactGroupError('Group name must contain 1–255 UTF-8 bytes without control characters');
    }
    return value.trim();
}
function vCardCategories(vcard) {
    const categories = [];
    for (const line of lines(vcard)) {
        if (property(line) !== 'CATEGORIES')
            continue;
        let value = '';
        const raw = line.slice(line.indexOf(':') + 1);
        const add = () => { if (value.trim())
            categories.push(validateContactGroupName(value)); value = ''; };
        for (let i = 0; i < raw.length; i++) {
            if (raw[i] === '\\' && i + 1 < raw.length) {
                const next = raw[++i];
                value += /n/i.test(next) ? '\n' : next;
            }
            else if (raw[i] === ',')
                add();
            else
                value += raw[i];
        }
        add();
    }
    const unique = [...new Set(categories)];
    if (unique.length > 128)
        throw new ContactGroupError('A contact can belong to at most 128 groups');
    return unique;
}
function setVCardCategories(vcard, categories) {
    const result = lines(vcard).filter(line => property(line) !== 'CATEGORIES');
    if (categories.length) {
        const escaped = categories.map(value => value.replace(/\\/g, '\\\\').replace(/,/g, '\\,').replace(/;/g, '\\;'));
        const end = result.findIndex(line => line.toUpperCase() === 'END:VCARD');
        result.splice(end < 0 ? result.length : end, 0, foldLine(`CATEGORIES:${escaped.join(',')}`));
    }
    return `${result.join('\r\n')}\r\n`;
}
function foldLine(line) {
    let folded = '', segment = '';
    for (const character of line) {
        if (Buffer.byteLength(segment + character) > 75) {
            folded += `${segment}\r\n`;
            segment = ' ';
        }
        segment += character;
    }
    return folded + segment;
}
function foldVCardCategoryLines(vcard) {
    return lines(vcard).map(line => property(line) === 'CATEGORIES' ? foldLine(line) : line).join('\r\n') + '\r\n';
}
// Explicit, additive reconciliation for groups/categories created before the bridge.
// A dry run reports counts only. It never rewrites or deletes contacts or memberships.
async function reconcileContactGroups(user, apply = false) {
    const reconcile = async (connection) => {
        const [contacts] = await connection.query('SELECT * FROM contacts WHERE username = ? ORDER BY id LIMIT 10001', [user]);
        if (contacts.length > 10000)
            throw new ContactGroupError('Reconciliation requires at most 10000 contacts per account');
        const [members] = await connection.query(`SELECT m.contact_id, g.name FROM contact_group_members m JOIN contact_groups g ON g.id = m.group_id
             JOIN contacts c ON c.id = m.contact_id AND c.username COLLATE utf8mb4_unicode_ci = g.username WHERE g.username = ?`, [user]);
        const plan = [];
        for (const contact of contacts) {
            if (isGroupVCard(contact.vcard_data || ''))
                throw new ContactGroupError('Existing group vCards require separate review before reconciliation');
            const categories = vCardCategories(contact.vcard_data || '');
            const names = [...new Set(members.filter((row) => row.contact_id === contact.id).map((row) => String(row.name)))];
            const combined = [...new Set([...categories, ...names])];
            combined.forEach(validateContactGroupName);
            if (combined.length > 128)
                throw new ContactGroupError('A contact can belong to at most 128 groups');
            if (JSON.stringify([...categories].sort()) !== JSON.stringify([...names].sort()))
                plan.push({ id: contact.id, names: combined });
        }
        if (apply)
            for (const contact of plan) {
                await syncContactCategoryMemberships(connection, user, contact.id, contact.names);
                await projectContactGroupCategories(connection, user, [contact.id]);
            }
        return { contactsChecked: contacts.length, contactsToReconcile: plan.length, applied: apply };
    };
    if (apply)
        return (0, contact_utils_1.withContactMutation)(user, reconcile);
    // Do not call schema initialization from a preview: its legacy UID backfill writes data.
    const connection = await db_1.pool.getConnection();
    try {
        await connection.query('START TRANSACTION READ ONLY');
        return await reconcile(connection);
    }
    finally {
        try {
            await connection.rollback();
            connection.release();
        }
        catch (error) {
            connection.destroy();
            throw error;
        }
    }
}
// Called inside the same owner lock/transaction as the contact write.
async function syncContactCategoryMemberships(connection, user, contactId, categories) {
    const groupIds = [];
    for (const name of categories) {
        const [rows] = await connection.query('SELECT id FROM contact_groups WHERE username = ? AND BINARY name = BINARY ? ORDER BY id LIMIT 1', [user, name]);
        if (rows.length)
            groupIds.push(Number(rows[0].id));
        else {
            const [result] = await connection.query('INSERT INTO contact_groups (username, name) VALUES (?, ?)', [user, name]);
            groupIds.push(Number(result.insertId));
        }
    }
    await connection.query(`DELETE m FROM contact_group_members m JOIN contact_groups g ON g.id = m.group_id
         WHERE m.contact_id = ? AND g.username = ?`, [contactId, user]);
    for (const groupId of groupIds) {
        await connection.query('INSERT INTO contact_group_members (group_id, contact_id) VALUES (?, ?)', [groupId, contactId]);
    }
}
async function projectContactGroupCategories(connection, user, contactIds) {
    if (!contactIds.length)
        return 0;
    const [contacts] = await connection.query('SELECT * FROM contacts WHERE username = ? AND id IN (?)', [user, contactIds]);
    const [members] = await connection.query(`SELECT m.contact_id, g.name FROM contact_group_members m
         JOIN contact_groups g ON g.id = m.group_id
         WHERE g.username = ? AND m.contact_id IN (?) ORDER BY g.name, g.id`, [user, contactIds]);
    let changed = 0;
    for (const contact of contacts) {
        const names = [...new Set(members.filter((row) => row.contact_id === contact.id).map((row) => String(row.name)))];
        if (names.length > 128)
            throw new ContactGroupError('A contact can belong to at most 128 groups');
        names.forEach(validateContactGroupName);
        const vcard = (0, contact_utils_1.contactVCard)(contact);
        if (JSON.stringify([...vCardCategories(vcard)].sort()) === JSON.stringify([...names].sort()))
            continue;
        const token = await (0, contact_utils_1.nextContactSyncTokenOnConnection)(connection, user);
        await connection.query('UPDATE contacts SET vcard_data = ?, sync_token = ? WHERE id = ? AND username = ?', [setVCardCategories((0, contact_utils_1.stampVCardRevision)(vcard), names), token, contact.id, user]);
        changed++;
    }
    return changed;
}
function groupId(value) {
    if (typeof value !== 'number' && (typeof value !== 'string' || !/^[1-9]\d*$/.test(value))) {
        throw new ContactGroupError('Invalid group or contact ID');
    }
    const id = Number(value);
    if (!Number.isSafeInteger(id) || id < 1)
        throw new ContactGroupError('Invalid group or contact ID');
    return id;
}
async function ownedGroup(connection, user, id) {
    const [rows] = await connection.query('SELECT * FROM contact_groups WHERE id = ? AND username = ?', [id, user]);
    if (!rows.length)
        throw new ContactGroupError('Group not found', 404);
    return rows[0];
}
async function assertUniqueName(connection, user, name, id = 0) {
    const [rows] = await connection.query('SELECT id FROM contact_groups WHERE username = ? AND BINARY name = BINARY ? AND id <> ? LIMIT 1', [user, name, id]);
    if (rows.length)
        throw new ContactGroupError('A group with that name already exists', 409);
}
async function createContactGroup(user, rawName, color) {
    const name = validateContactGroupName(rawName);
    const validColor = validateColor(color);
    return (0, contact_utils_1.withContactMutation)(user, async (connection) => {
        await assertUniqueName(connection, user, name);
        const [result] = await connection.query('INSERT INTO contact_groups (username, name, color) VALUES (?, ?, ?)', [user, name, validColor || '#60a5fa']);
        return Number(result.insertId);
    });
}
function validateColor(color) {
    if (color === undefined || color === null || color === '')
        return null;
    if (typeof color !== 'string' || !/^#[\da-f]{6}$/i.test(color))
        throw new ContactGroupError('Invalid group color');
    return color;
}
async function updateContactGroup(user, rawId, updates) {
    const id = groupId(rawId);
    const name = updates?.name === undefined ? null : validateContactGroupName(updates.name);
    const color = validateColor(updates?.color);
    await (0, contact_utils_1.withContactMutation)(user, async (connection) => {
        await ownedGroup(connection, user, id);
        const [members] = await connection.query('SELECT contact_id FROM contact_group_members WHERE group_id = ?', [id]);
        if (updates === null) {
            await connection.query('DELETE FROM contact_group_members WHERE group_id = ?', [id]);
            await connection.query('DELETE FROM contact_groups WHERE id = ? AND username = ?', [id, user]);
        }
        else {
            if (name !== null)
                await assertUniqueName(connection, user, name, id);
            await connection.query('UPDATE contact_groups SET name = COALESCE(?, name), color = COALESCE(?, color) WHERE id = ? AND username = ?', [name, color, id, user]);
        }
        await projectContactGroupCategories(connection, user, members.map((row) => Number(row.contact_id)));
    });
}
async function changeContactGroupMembers(user, rawId, rawContactIds, remove = false) {
    const id = groupId(rawId);
    if (!Array.isArray(rawContactIds) || rawContactIds.length > 1000)
        throw new ContactGroupError('Provide at most 1000 contact IDs');
    const ids = [...new Set(rawContactIds.map(groupId))];
    return (0, contact_utils_1.withContactMutation)(user, async (connection) => {
        await ownedGroup(connection, user, id);
        if (!ids.length)
            return 0;
        const [contacts] = await connection.query('SELECT id FROM contacts WHERE username = ? AND id IN (?) AND deleted_at IS NULL', [user, ids]);
        if (contacts.length !== ids.length)
            throw new ContactGroupError('Contact not found', 404);
        let changed = 0;
        for (const contactId of ids) {
            const [result] = await connection.query(remove
                ? 'DELETE FROM contact_group_members WHERE group_id = ? AND contact_id = ?'
                : 'INSERT IGNORE INTO contact_group_members (group_id, contact_id) VALUES (?, ?)', [id, contactId]);
            changed += Number(result.affectedRows);
        }
        await projectContactGroupCategories(connection, user, ids);
        return changed;
    });
}
//# sourceMappingURL=contact-groups.js.map