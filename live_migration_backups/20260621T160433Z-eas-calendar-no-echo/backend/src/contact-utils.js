"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureContactsSchema = ensureContactsSchema;
exports.xmlEscape = xmlEscape;
exports.parseVCard = parseVCard;
exports.normalizeDavUid = normalizeDavUid;
exports.getContactDavUid = getContactDavUid;
exports.getContactHref = getContactHref;
exports.normalizeVCardData = normalizeVCardData;
exports.contactEtag = contactEtag;
exports.listContacts = listContacts;
exports.getContactByDavUid = getContactByDavUid;
exports.saveContactFromVCard = saveContactFromVCard;
exports.deleteContactByDavUid = deleteContactByDavUid;
exports.addressBookSyncToken = addressBookSyncToken;
exports.contactVCard = contactVCard;
const crypto_1 = require("crypto");
const db_1 = require("./db");
let schemaPromise = null;
async function ensureContactsSchema() {
    if (!schemaPromise) {
        schemaPromise = (async () => {
            await db_1.pool.query(`
                CREATE TABLE IF NOT EXISTS contacts (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    username VARCHAR(255) NOT NULL,
                    name VARCHAR(255) NOT NULL DEFAULT '',
                    email VARCHAR(255) NOT NULL DEFAULT '',
                    phone VARCHAR(64) NOT NULL DEFAULT '',
                    vcard_data MEDIUMTEXT NULL,
                    dav_uid VARCHAR(255) NULL,
                    sync_token BIGINT UNSIGNED NOT NULL DEFAULT 1,
                    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    KEY idx_contacts_username (username),
                    KEY idx_contacts_user_dav_uid (username, dav_uid)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            `);
            const [columns] = await db_1.pool.query('SHOW COLUMNS FROM contacts');
            const columnNames = new Set(columns.map((column) => column.Field));
            if (!columnNames.has('phone')) {
                await db_1.pool.query("ALTER TABLE contacts ADD COLUMN phone VARCHAR(64) NOT NULL DEFAULT '' AFTER email");
            }
            if (!columnNames.has('vcard_data')) {
                await db_1.pool.query('ALTER TABLE contacts ADD COLUMN vcard_data MEDIUMTEXT NULL AFTER phone');
            }
            if (!columnNames.has('dav_uid')) {
                await db_1.pool.query('ALTER TABLE contacts ADD COLUMN dav_uid VARCHAR(255) NULL AFTER vcard_data');
            }
            if (!columnNames.has('sync_token')) {
                await db_1.pool.query('ALTER TABLE contacts ADD COLUMN sync_token BIGINT UNSIGNED NOT NULL DEFAULT 1 AFTER dav_uid');
            }
            if (!columnNames.has('created_at')) {
                await db_1.pool.query('ALTER TABLE contacts ADD COLUMN created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER sync_token');
            }
            if (!columnNames.has('updated_at')) {
                await db_1.pool.query('ALTER TABLE contacts ADD COLUMN updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at');
            }
            const [indexes] = await db_1.pool.query("SHOW INDEX FROM contacts WHERE Key_name = 'idx_contacts_user_dav_uid'");
            if (indexes.length === 0) {
                await db_1.pool.query('ALTER TABLE contacts ADD KEY idx_contacts_user_dav_uid (username, dav_uid)');
            }
            await db_1.pool.query("UPDATE contacts SET dav_uid = CONCAT('contact-', id) WHERE dav_uid IS NULL OR dav_uid = ''");
        })();
    }
    return schemaPromise;
}
function xmlEscape(value) {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&apos;');
}
function vcardEscape(value) {
    return value
        .replace(/\\/g, '\\\\')
        .replace(/\n/g, '\\n')
        .replace(/;/g, '\\;')
        .replace(/,/g, '\\,');
}
function vcardUnescape(value) {
    return value
        .replace(/\\n/gi, '\n')
        .replace(/\\,/g, ',')
        .replace(/\\;/g, ';')
        .replace(/\\\\/g, '\\');
}
function unfoldVCard(vcard) {
    return vcard
        .replace(/\r\n[ \t]/g, '')
        .replace(/\n[ \t]/g, '')
        .replace(/\r/g, '\n')
        .split('\n')
        .map(line => line.trimEnd())
        .filter(Boolean);
}
function firstVCardValue(lines, propertyName) {
    const upperName = propertyName.toUpperCase();
    const line = lines.find(candidate => {
        const separatorIndex = candidate.indexOf(':');
        if (separatorIndex < 0)
            return false;
        const name = candidate.slice(0, separatorIndex).split(';')[0].toUpperCase();
        return name === upperName;
    });
    if (!line)
        return '';
    const separatorIndex = line.indexOf(':');
    return vcardUnescape(line.slice(separatorIndex + 1).trim());
}
function parseVCard(vcard) {
    const lines = unfoldVCard(vcard);
    const fn = firstVCardValue(lines, 'FN');
    const n = firstVCardValue(lines, 'N')
        .split(';')
        .filter(Boolean)
        .join(' ')
        .trim();
    return {
        name: fn || n,
        email: firstVCardValue(lines, 'EMAIL'),
        phone: firstVCardValue(lines, 'TEL')
    };
}
function normalizeDavUid(raw) {
    const cleaned = decodeURIComponent(raw)
        .replace(/\.vcf$/i, '')
        .replace(/[^A-Za-z0-9._~-]/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 180);
    return cleaned || `contact-${Date.now()}`;
}
function getContactDavUid(contact) {
    return contact.dav_uid || `contact-${contact.id}`;
}
function getContactHref(user, contact) {
    return `/carddav/addressbooks/${user}/personal/${encodeURIComponent(getContactDavUid(contact))}.vcf`;
}
function normalizeVCardData(vcard, davUid, fallback) {
    const trimmed = vcard.trim();
    let lines = trimmed && /^BEGIN:VCARD/i.test(trimmed)
        ? unfoldVCard(trimmed)
        : [];
    if (lines.length === 0) {
        lines = [
            'BEGIN:VCARD',
            'VERSION:3.0',
            `UID:${vcardEscape(davUid)}`,
            `FN:${vcardEscape(fallback.name || fallback.email || 'Unnamed Contact')}`,
            `N:${vcardEscape(fallback.name || '')};;;;`,
        ];
        if (fallback.email)
            lines.push(`EMAIL;TYPE=INTERNET:${vcardEscape(fallback.email)}`);
        if (fallback.phone)
            lines.push(`TEL;TYPE=CELL:${vcardEscape(fallback.phone)}`);
        lines.push('END:VCARD');
    }
    else if (!lines.some(line => line.toUpperCase().startsWith('UID:') || line.toUpperCase().startsWith('UID;'))) {
        const versionIndex = lines.findIndex(line => line.toUpperCase().startsWith('VERSION:'));
        lines.splice(versionIndex >= 0 ? versionIndex + 1 : 1, 0, `UID:${vcardEscape(davUid)}`);
    }
    return `${lines.join('\r\n')}\r\n`;
}
function contactEtag(contact) {
    const hash = (0, crypto_1.createHash)('sha1');
    hash.update(String(contact.id));
    hash.update('\0');
    hash.update(getContactDavUid(contact));
    hash.update('\0');
    hash.update(contact.name || '');
    hash.update('\0');
    hash.update(contact.email || '');
    hash.update('\0');
    hash.update(contact.phone || '');
    hash.update('\0');
    hash.update(contact.vcard_data || '');
    hash.update('\0');
    hash.update(contact.updated_at instanceof Date ? contact.updated_at.toISOString() : String(contact.updated_at || ''));
    return `"${hash.digest('hex')}"`;
}
async function listContacts(user) {
    await ensureContactsSchema();
    const [rows] = await db_1.pool.query('SELECT * FROM contacts WHERE username = ? ORDER BY name ASC, email ASC, id ASC', [user]);
    return rows;
}
async function getContactByDavUid(user, davUid) {
    await ensureContactsSchema();
    const [rows] = await db_1.pool.query('SELECT * FROM contacts WHERE username = ? AND dav_uid = ? ORDER BY id ASC LIMIT 1', [user, davUid]);
    return rows.length > 0 ? rows[0] : null;
}
async function saveContactFromVCard(user, davUid, vcard) {
    await ensureContactsSchema();
    const parsed = parseVCard(vcard);
    const normalized = normalizeVCardData(vcard, davUid, parsed);
    const existing = await getContactByDavUid(user, davUid);
    if (existing) {
        await db_1.pool.query(`UPDATE contacts
             SET name = ?, email = ?, phone = ?, vcard_data = ?, sync_token = sync_token + 1
             WHERE id = ? AND username = ?`, [parsed.name || '', parsed.email || '', parsed.phone || '', normalized, existing.id, user]);
        const updated = await getContactByDavUid(user, davUid);
        return { contact: updated, created: false };
    }
    const [result] = await db_1.pool.query(`INSERT INTO contacts (username, name, email, phone, vcard_data, dav_uid, sync_token)
         VALUES (?, ?, ?, ?, ?, ?, 1)`, [user, parsed.name || '', parsed.email || '', parsed.phone || '', normalized, davUid]);
    const [rows] = await db_1.pool.query('SELECT * FROM contacts WHERE id = ?', [result.insertId]);
    return { contact: rows[0], created: true };
}
async function deleteContactByDavUid(user, davUid) {
    await ensureContactsSchema();
    const [result] = await db_1.pool.query('DELETE FROM contacts WHERE username = ? AND dav_uid = ?', [user, davUid]);
    return result.affectedRows > 0;
}
async function addressBookSyncToken(user) {
    await ensureContactsSchema();
    const [rows] = await db_1.pool.query(`SELECT COUNT(*) AS contact_count,
                COALESCE(MAX(sync_token), 1) AS max_sync_token,
                COALESCE(UNIX_TIMESTAMP(MAX(updated_at)), 1) AS max_updated_at
         FROM contacts
         WHERE username = ?`, [user]);
    const row = rows[0] || {};
    return `${row.contact_count || 0}-${row.max_sync_token || 1}-${row.max_updated_at || 1}`;
}
function contactVCard(contact) {
    const davUid = getContactDavUid(contact);
    const fallback = {
        name: contact.name || '',
        email: contact.email || '',
        phone: contact.phone || ''
    };
    return normalizeVCardData(contact.vcard_data || '', davUid, fallback);
}
//# sourceMappingURL=contact-utils.js.map