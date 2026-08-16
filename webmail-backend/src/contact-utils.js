"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.easContactSourceBytesExpression = exports.EAS_CONTACT_SOURCE_COLUMNS = exports.AmbiguousVCardUidError = exports.InvalidContactBirthdayError = void 0;
exports.createContactUid = createContactUid;
exports.contactIdentityRank = contactIdentityRank;
exports.ensureContactsSchema = ensureContactsSchema;
exports.acquireContactMutationLock = acquireContactMutationLock;
exports.releaseContactMutationLock = releaseContactMutationLock;
exports.withContactMutation = withContactMutation;
exports.xmlEscape = xmlEscape;
exports.stampVCardRevision = stampVCardRevision;
exports.normalizeContactBirthday = normalizeContactBirthday;
exports.extractVCardBirthday = extractVCardBirthday;
exports.extractVCardUid = extractVCardUid;
exports.parseVCard = parseVCard;
exports.normalizeDavUid = normalizeDavUid;
exports.getContactDavUid = getContactDavUid;
exports.getContactHref = getContactHref;
exports.getContactHrefForDavUid = getContactHrefForDavUid;
exports.normalizeVCardData = normalizeVCardData;
exports.patchVCardData = patchVCardData;
exports.contactEtag = contactEtag;
exports.listContacts = listContacts;
exports.listContactsOnConnection = listContactsOnConnection;
exports.listContactsUpdatedSince = listContactsUpdatedSince;
exports.listContactTombstonesSince = listContactTombstonesSince;
exports.listRecentContactTombstones = listRecentContactTombstones;
exports.contactTombstoneDavUids = contactTombstoneDavUids;
exports.contactSyncTokenVersion = contactSyncTokenVersion;
exports.nextContactSyncTokenOnConnection = nextContactSyncTokenOnConnection;
exports.getContactByDavUid = getContactByDavUid;
exports.getContactByDavUidOnConnection = getContactByDavUidOnConnection;
exports.getContactMutationMetadataOnConnection = getContactMutationMetadataOnConnection;
exports.getEasContactByDavUidOnConnection = getEasContactByDavUidOnConnection;
exports.recordContactTombstoneOnConnection = recordContactTombstoneOnConnection;
exports.recordContactTombstone = recordContactTombstone;
exports.findContactDavUidByVCardUidOnConnection = findContactDavUidByVCardUidOnConnection;
exports.saveContactFromVCardOnConnection = saveContactFromVCardOnConnection;
exports.saveContactFromVCard = saveContactFromVCard;
exports.deleteContactByDavUidOnConnection = deleteContactByDavUidOnConnection;
exports.deleteContactByDavUid = deleteContactByDavUid;
exports.softDeleteContactById = softDeleteContactById;
exports.softDeleteContactsByIds = softDeleteContactsByIds;
exports.restoreContactById = restoreContactById;
exports.purgeExpiredContacts = purgeExpiredContacts;
exports.addressBookSyncToken = addressBookSyncToken;
exports.getContactCollectionRevisionOnConnection = getContactCollectionRevisionOnConnection;
exports.contactVCard = contactVCard;
const crypto_1 = require("crypto");
const db_1 = require("./db");
const birthday_calendar_1 = require("./birthday-calendar");
class InvalidContactBirthdayError extends Error {
    constructor() {
        super('Invalid birthday; expected YYYY-MM-DD or a yearless --MM-DD date');
        this.name = 'InvalidContactBirthdayError';
    }
}
exports.InvalidContactBirthdayError = InvalidContactBirthdayError;
class AmbiguousVCardUidError extends Error {
    constructor() {
        super('The vCard UID does not identify exactly one existing contact');
        this.name = 'AmbiguousVCardUidError';
    }
}
exports.AmbiguousVCardUidError = AmbiguousVCardUidError;
function birthdayIdentityFromContact(contact) {
    return {
        contactId: contact.id,
        davUid: contact.dav_uid,
        name: contact.name,
        email: contact.email,
    };
}
exports.EAS_CONTACT_SOURCE_COLUMNS = [
    'dav_uid', 'vcard_data', 'name', 'email', 'phone', 'emails_json', 'phones_json',
    'addresses_json', 'job_title', 'organization', 'notes', 'photo_url', 'prefix', 'first_name', 'middle_name',
    'last_name', 'suffix', 'nickname', 'department', 'birthday', 'website_url',
];
const easContactSourceBytesExpression = () => exports.EAS_CONTACT_SOURCE_COLUMNS.map(column => `COALESCE(OCTET_LENGTH(${column}), 0)`).join(' + ');
exports.easContactSourceBytesExpression = easContactSourceBytesExpression;
function createContactUid() {
    return (0, crypto_1.randomUUID)();
}
function contactIdentityRank(contact) {
    const davUid = String(contact.dav_uid || '');
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(davUid) ? 1 : 0;
}
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
                    emails_json JSON NULL,
                    phones_json JSON NULL,
                    addresses_json JSON NULL,
                    job_title VARCHAR(255) NULL,
                    organization VARCHAR(255) NULL,
                    notes TEXT NULL,
                    labels_json JSON NULL,
                    KEY idx_contacts_username (username),
                    KEY idx_contacts_user_dav_uid (username, dav_uid)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            `);
            await db_1.pool.query(`
                CREATE TABLE IF NOT EXISTS contact_labels (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    username VARCHAR(255) NOT NULL,
                    name VARCHAR(255) NOT NULL,
                    color VARCHAR(32) NOT NULL DEFAULT '#60a5fa',
                    KEY idx_contact_labels_username (username)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            `);
            await db_1.pool.query(`
                CREATE TABLE IF NOT EXISTS contact_tombstones (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    username VARCHAR(255) NOT NULL,
                    dav_uid VARCHAR(255) NOT NULL,
                    deleted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    sync_token BIGINT UNSIGNED NOT NULL DEFAULT 1,
                    UNIQUE KEY uniq_contact_tombstone_user_uid (username, dav_uid),
                    KEY idx_contact_tombstones_user_sync (username, sync_token),
                    KEY idx_contact_tombstones_deleted_at (deleted_at)
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
            if (!columnNames.has('emails_json')) {
                await db_1.pool.query('ALTER TABLE contacts ADD COLUMN emails_json JSON NULL AFTER updated_at');
            }
            if (!columnNames.has('phones_json')) {
                await db_1.pool.query('ALTER TABLE contacts ADD COLUMN phones_json JSON NULL AFTER emails_json');
            }
            if (!columnNames.has('addresses_json')) {
                await db_1.pool.query('ALTER TABLE contacts ADD COLUMN addresses_json JSON NULL AFTER phones_json');
            }
            if (!columnNames.has('job_title')) {
                await db_1.pool.query('ALTER TABLE contacts ADD COLUMN job_title VARCHAR(255) NULL AFTER addresses_json');
            }
            if (!columnNames.has('organization')) {
                await db_1.pool.query('ALTER TABLE contacts ADD COLUMN organization VARCHAR(255) NULL AFTER job_title');
            }
            if (!columnNames.has('notes')) {
                await db_1.pool.query('ALTER TABLE contacts ADD COLUMN notes TEXT NULL AFTER organization');
            }
            if (!columnNames.has('labels_json')) {
                await db_1.pool.query('ALTER TABLE contacts ADD COLUMN labels_json JSON NULL AFTER notes');
            }
            if (!columnNames.has('photo_url')) {
                await db_1.pool.query('ALTER TABLE contacts ADD COLUMN photo_url MEDIUMTEXT NULL AFTER labels_json');
            }
            if (!columnNames.has('is_favorite')) {
                await db_1.pool.query('ALTER TABLE contacts ADD COLUMN is_favorite TINYINT(1) NOT NULL DEFAULT 0 AFTER photo_url');
            }
            const structuredCols = [
                ['prefix', 'VARCHAR(32) NULL AFTER is_favorite'],
                ['first_name', 'VARCHAR(128) NULL AFTER prefix'],
                ['middle_name', 'VARCHAR(128) NULL AFTER first_name'],
                ['last_name', 'VARCHAR(128) NULL AFTER middle_name'],
                ['suffix', 'VARCHAR(32) NULL AFTER last_name'],
                ['nickname', 'VARCHAR(128) NULL AFTER suffix'],
                ['department', 'VARCHAR(255) NULL AFTER nickname'],
                ['birthday', 'VARCHAR(16) NULL AFTER department'],
                ['website_url', 'VARCHAR(500) NULL AFTER birthday'],
            ];
            for (const [col, def] of structuredCols) {
                if (!columnNames.has(col)) {
                    await db_1.pool.query(`ALTER TABLE contacts ADD COLUMN ${col} ${def}`);
                }
            }
            if (!columnNames.has('deleted_at')) {
                await db_1.pool.query('ALTER TABLE contacts ADD COLUMN deleted_at TIMESTAMP NULL AFTER website_url');
            }
            await db_1.pool.query(`
                CREATE TABLE IF NOT EXISTS contact_groups (
                    id INT AUTO_INCREMENT PRIMARY KEY,
                    username VARCHAR(255) NOT NULL,
                    name VARCHAR(255) NOT NULL,
                    color VARCHAR(32) NOT NULL DEFAULT '#60a5fa',
                    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    KEY idx_contact_groups_username (username)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            `);
            await db_1.pool.query(`
                CREATE TABLE IF NOT EXISTS contact_group_members (
                    group_id INT NOT NULL,
                    contact_id INT NOT NULL,
                    PRIMARY KEY (group_id, contact_id),
                    KEY idx_group_members_contact (contact_id)
                ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
            `);
            const [indexes] = await db_1.pool.query("SHOW INDEX FROM contacts WHERE Key_name = 'idx_contacts_user_dav_uid'");
            if (indexes.length === 0) {
                await db_1.pool.query('ALTER TABLE contacts ADD KEY idx_contacts_user_dav_uid (username, dav_uid)');
            }
            await db_1.pool.query("UPDATE contacts SET dav_uid = CONCAT('contact-', id) WHERE dav_uid IS NULL OR dav_uid = ''");
        })();
    }
    return schemaPromise;
}
function contactMutationLockName(user) {
    return (0, crypto_1.createHash)('sha256').update(`openmailstack:contacts:${user.trim().toLowerCase()}`).digest('hex');
}
/**
 * Acquire the per-user contact lock on an existing dedicated connection.
 * Composite PIM transactions must acquire their PIM lock first, then this lock,
 * before BEGIN; they must release this lock before the PIM lock after COMMIT or ROLLBACK.
 */
async function acquireContactMutationLock(connection, user) {
    const lockName = contactMutationLockName(user);
    const [rows] = await connection.query('SELECT GET_LOCK(?, ?) AS acquired', [lockName, 10]);
    if (Number(rows[0]?.acquired) !== 1) {
        throw new Error('Timed out waiting for the contact mutation lock');
    }
    return { lockName };
}
async function releaseContactMutationLock(connection, lease) {
    const [rows] = await connection.query('SELECT RELEASE_LOCK(?) AS released', [lease.lockName]);
    if (Number(rows[0]?.released) !== 1) {
        throw new Error('The contact mutation lock was not released');
    }
}
async function withContactMutation(user, mutate) {
    await ensureContactsSchema();
    const connection = await db_1.pool.getConnection();
    let lockLease = null;
    let transactionStarted = false;
    let committed = false;
    let connectionDestroyed = false;
    let operationError = null;
    try {
        lockLease = await acquireContactMutationLock(connection, user);
        await connection.beginTransaction();
        transactionStarted = true;
        const result = await mutate(connection);
        await connection.commit();
        transactionStarted = false;
        committed = true;
        return result;
    }
    catch (error) {
        operationError = error;
        if (!lockLease) {
            connection.destroy();
            connectionDestroyed = true;
        }
        else if (transactionStarted) {
            try {
                await connection.rollback();
            }
            catch {
                console.error('[Contacts] Failed to roll back a contact mutation; destroying its connection');
                connection.destroy();
                connectionDestroyed = true;
            }
        }
        else {
            connection.destroy();
            connectionDestroyed = true;
        }
        throw error;
    }
    finally {
        try {
            if (lockLease && !connectionDestroyed) {
                await releaseContactMutationLock(connection, lockLease);
            }
        }
        catch (releaseError) {
            console.error('[Contacts] Failed to release a contact mutation lock; destroying its connection');
            connection.destroy();
            connectionDestroyed = true;
            if (!committed && !operationError)
                throw releaseError;
        }
        finally {
            if (!connectionDestroyed)
                connection.release();
        }
    }
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
function vcardRevisionTimestamp(date) {
    return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}
function vcardPropertyName(line) {
    const separatorIndex = line.indexOf(':');
    const raw = separatorIndex >= 0 ? line.slice(0, separatorIndex) : line;
    const baseName = raw.split(';')[0].toUpperCase();
    const dotIndex = baseName.indexOf('.');
    return dotIndex >= 0 ? baseName.slice(dotIndex + 1) : baseName;
}
function stampVCardRevision(vcard, date = new Date()) {
    const lines = unfoldVCard(vcard);
    if (lines.length === 0)
        return vcard;
    const nextLines = lines.filter(line => vcardPropertyName(line) !== 'REV');
    const endIndex = nextLines.findIndex(line => line.toUpperCase() === 'END:VCARD');
    const revisionLine = `REV:${vcardRevisionTimestamp(date)}`;
    if (endIndex >= 0) {
        nextLines.splice(endIndex, 0, revisionLine);
    }
    else {
        nextLines.push(revisionLine);
    }
    return `${nextLines.join('\r\n')}\r\n`;
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
        const raw = candidate.slice(0, separatorIndex);
        // Strip group prefix (e.g. "item1.EMAIL" -> "EMAIL") before matching
        const baseName = raw.split(';')[0].toUpperCase();
        const dotIndex = baseName.indexOf('.');
        const name = dotIndex >= 0 ? baseName.slice(dotIndex + 1) : baseName;
        return name === upperName;
    });
    if (!line)
        return '';
    const separatorIndex = line.indexOf(':');
    return vcardUnescape(line.slice(separatorIndex + 1).trim());
}
function firstVCardRawValue(lines, propertyName) {
    const upperName = propertyName.toUpperCase();
    const line = lines.find(candidate => vcardPropertyName(candidate) === upperName);
    if (!line)
        return '';
    return line.slice(line.indexOf(':') + 1).trim();
}
function splitEscapedVCardComponents(value, count) {
    const parts = [];
    let start = 0;
    for (let index = 0; index < value.length; index += 1) {
        if (value[index] !== ';')
            continue;
        let slashes = 0;
        for (let prior = index - 1; prior >= 0 && value[prior] === '\\'; prior -= 1)
            slashes += 1;
        if (slashes % 2 === 0) {
            parts.push(vcardUnescape(value.slice(start, index).trim()));
            start = index + 1;
        }
    }
    parts.push(vcardUnescape(value.slice(start).trim()));
    while (parts.length < count)
        parts.push('');
    return parts.slice(0, count);
}
function vCardAddress(lines) {
    const vals = [];
    for (const line of lines) {
        const propUpper = line.split(':')[0].split(';')[0].toUpperCase();
        if (propUpper !== 'ADR')
            continue;
        const raw = firstVCardRawValue([line], 'ADR');
        const parts = splitEscapedVCardComponents(raw, 7).filter(Boolean);
        if (parts.length > 0)
            vals.push(parts.join(', '));
    }
    return vals.join(' | ') || '';
}
function allVCardValues(lines, propertyName) {
    const upperName = propertyName.toUpperCase();
    const results = [];
    for (const candidate of lines) {
        const separatorIndex = candidate.indexOf(':');
        if (separatorIndex < 0)
            continue;
        const raw = candidate.slice(0, separatorIndex);
        const baseName = raw.split(';')[0].toUpperCase();
        const dotIndex = baseName.indexOf('.');
        const name = dotIndex >= 0 ? baseName.slice(dotIndex + 1) : baseName;
        if (name === upperName) {
            results.push(vcardUnescape(candidate.slice(separatorIndex + 1).trim()));
        }
    }
    return results;
}
function normalizeContactBirthday(value) {
    if (value === null || value === undefined)
        return null;
    if (typeof value !== 'string')
        throw new InvalidContactBirthdayError();
    const trimmed = value.trim();
    if (!trimmed)
        return null;
    const fullDate = trimmed.match(/^(\d{4})-?(\d{2})-?(\d{2})$/);
    const yearlessDate = trimmed.match(/^(?:--)?(\d{2})-?(\d{2})$/);
    if (!fullDate && !yearlessDate)
        throw new InvalidContactBirthdayError();
    const year = fullDate ? Number(fullDate[1]) : 2000;
    const month = Number(fullDate ? fullDate[2] : yearlessDate[1]);
    const day = Number(fullDate ? fullDate[3] : yearlessDate[2]);
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if ((fullDate && year < 1) || month < 1 || month > 12 || day < 1 || day > days[month - 1]) {
        throw new InvalidContactBirthdayError();
    }
    return fullDate
        ? `${fullDate[1]}-${fullDate[2]}-${fullDate[3]}`
        : `${yearlessDate[1]}-${yearlessDate[2]}`;
}
function extractVCardBirthday(vcard) {
    const birthdayValues = allVCardValues(unfoldVCard(vcard), 'BDAY');
    if (birthdayValues.length === 0)
        return null;
    if (birthdayValues.length > 1)
        throw new InvalidContactBirthdayError();
    return normalizeContactBirthday(birthdayValues[0]);
}
function extractVCardUid(vcard) {
    const uidValues = allVCardValues(unfoldVCard(vcard), 'UID')
        .map(value => value.trim())
        .filter(Boolean);
    if (uidValues.length === 0)
        return null;
    if (uidValues.length > 1)
        throw new AmbiguousVCardUidError();
    return uidValues[0];
}
function canonicalizeVCardBirthday(vcard, birthday) {
    const lines = unfoldVCard(vcard).filter(line => vcardPropertyName(line) !== 'BDAY');
    if (birthday) {
        const endIndex = lines.findIndex(line => line.toUpperCase() === 'END:VCARD');
        const vcardBirthday = /^\d{2}-\d{2}$/.test(birthday) ? `--${birthday}` : birthday;
        lines.splice(endIndex >= 0 ? endIndex : lines.length, 0, `BDAY:${vcardBirthday}`);
    }
    return `${lines.join('\r\n')}\r\n`;
}
function vCardPhoneItems(lines) {
    const items = [];
    for (const candidate of lines) {
        const separatorIndex = candidate.indexOf(':');
        if (separatorIndex < 0)
            continue;
        const rawName = candidate.slice(0, separatorIndex);
        const baseName = rawName.split(';')[0].toUpperCase();
        const dotIndex = baseName.indexOf('.');
        if ((dotIndex >= 0 ? baseName.slice(dotIndex + 1) : baseName) !== 'TEL')
            continue;
        const types = new Set();
        for (const parameter of rawName.split(';').slice(1)) {
            const [name, value] = parameter.split('=', 2);
            const rawTypes = value === undefined ? name : name.toUpperCase() === 'TYPE' ? value : '';
            for (const type of rawTypes.split(',')) {
                const normalized = type.trim().toUpperCase();
                if (normalized)
                    types.add(normalized);
            }
        }
        const value = vcardUnescape(candidate.slice(separatorIndex + 1).trim());
        if (!value)
            continue;
        const has = (type) => types.has(type);
        const label = has('WORK') && has('FAX') ? 'Business Fax'
            : has('HOME') && has('FAX') ? 'Home Fax'
                : has('CELL') ? 'Mobile'
                    : has('WORK') ? 'Work'
                        : has('HOME') ? 'Home'
                            : has('VOICE') ? 'Voice'
                                : has('CAR') ? 'Car'
                                    : has('PAGER') ? 'Pager'
                                        : has('FAX') ? 'Fax'
                                            : 'Other';
        items.push({ value, types: [...types], label });
    }
    return items;
}
function parseVCard(vcard) {
    const lines = unfoldVCard(vcard);
    const fn = firstVCardValue(lines, 'FN');
    const nRaw = firstVCardRawValue(lines, 'N');
    // Parse structured N: LastName;FirstName;MiddleName;Prefix;Suffix
    const nParts = splitEscapedVCardComponents(nRaw, 5);
    const lastName = nParts[0] || '';
    const firstName = nParts[1] || '';
    const middleName = nParts[2] || '';
    const prefix = nParts[3] || '';
    const suffix = nParts[4] || '';
    const fallbackName = [prefix, firstName, middleName, lastName, suffix].filter(Boolean).join(' ');
    // Extract all emails and phones (iOS uses item1.EMAIL, item2.EMAIL, etc.)
    const emails = allVCardValues(lines, 'EMAIL');
    const phoneItems = vCardPhoneItems(lines);
    const phones = phoneItems.map(item => item.value);
    const primaryEmail = emails[0] || '';
    const primaryPhone = phones[0] || '';
    const organizationParts = splitEscapedVCardComponents(firstVCardRawValue(lines, 'ORG'), 2);
    let birthday;
    try {
        birthday = extractVCardBirthday(vcard) || undefined;
    }
    catch { }
    return {
        name: fn || fallbackName,
        email: primaryEmail,
        phone: primaryPhone,
        lastName: lastName || undefined,
        firstName: firstName || undefined,
        middleName: middleName || undefined,
        prefix: prefix || undefined,
        suffix: suffix || undefined,
        emails: emails.length > 1 ? emails : [],
        phones: phones.length > 1 ? phones : [],
        phoneItems,
        organization: organizationParts[0] || '',
        department: organizationParts[1]?.slice(0, 255) || undefined,
        title: firstVCardValue(lines, 'TITLE'),
        note: firstVCardValue(lines, 'NOTE'),
        address: vCardAddress(lines),
        nickname: firstVCardValue(lines, 'NICKNAME').slice(0, 128) || undefined,
        birthday,
        websiteUrl: firstVCardValue(lines, 'URL').slice(0, 500) || undefined,
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
    return getContactHrefForDavUid(user, getContactDavUid(contact));
}
function getContactHrefForDavUid(user, davUid) {
    return `/carddav/addressbooks/${user}/personal/${encodeURIComponent(normalizeDavUid(davUid))}.vcf`;
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
    else if (!lines.some(line => vcardPropertyName(line) === 'UID')) {
        const versionIndex = lines.findIndex(line => line.toUpperCase().startsWith('VERSION:'));
        lines.splice(versionIndex >= 0 ? versionIndex + 1 : 1, 0, `UID:${vcardEscape(davUid)}`);
    }
    return `${lines.join('\r\n')}\r\n`;
}
function patchVCardData(vcard, davUid, updates) {
    const trimmed = (vcard || '').trim();
    let lines = trimmed && /^BEGIN:VCARD/i.test(trimmed) ? unfoldVCard(trimmed) : ['BEGIN:VCARD', 'VERSION:3.0', 'END:VCARD'];
    if (!lines.some(line => vcardPropertyName(line) === 'UID')) {
        const versionIndex = lines.findIndex(line => line.toUpperCase().startsWith('VERSION:'));
        lines.splice(versionIndex >= 0 ? versionIndex + 1 : 1, 0, `UID:${vcardEscape(davUid)}`);
    }
    const birthdayWasUpdated = Object.prototype.hasOwnProperty.call(updates, 'birthday');
    const normalizedBirthday = birthdayWasUpdated
        ? normalizeContactBirthday(updates.birthday)
        : null;
    const firstName = updates.first_name || '';
    const lastName = updates.last_name || '';
    const middleName = updates.middle_name || '';
    const prefix = updates.prefix || '';
    const suffix = updates.suffix || '';
    let newLines = [];
    let existingN = ['', '', '', '', ''];
    const nLine = lines.find(line => vcardPropertyName(line) === 'N');
    if (nLine) {
        const val = nLine.slice(nLine.indexOf(':') + 1);
        const parts = val.split(/(?<!\\);/).map(vcardUnescape);
        for (let i = 0; i < 5; i++)
            if (parts[i])
                existingN[i] = parts[i];
    }
    if (lastName)
        existingN[0] = lastName;
    if (firstName)
        existingN[1] = firstName;
    if (middleName)
        existingN[2] = middleName;
    if (prefix)
        existingN[3] = prefix;
    if (suffix)
        existingN[4] = suffix;
    for (const line of lines) {
        if (line.toUpperCase().startsWith('BEGIN:') || line.toUpperCase().startsWith('END:') || line.toUpperCase().startsWith('VERSION:') || vcardPropertyName(line) === 'UID') {
            newLines.push(line);
            continue;
        }
        const propUpper = vcardPropertyName(line);
        if (['FN', 'N', 'EMAIL', 'TEL', 'ORG', 'TITLE', 'NOTE'].includes(propUpper)
            || (birthdayWasUpdated && propUpper === 'BDAY')) {
            continue; // We will insert these manually at the end
        }
        newLines.push(line);
    }
    const endIndex = newLines.findIndex(l => l.toUpperCase() === 'END:VCARD');
    const insertAt = endIndex >= 0 ? endIndex : newLines.length;
    newLines.splice(insertAt, 0, `FN:${vcardEscape(updates.name || '')}`);
    newLines.splice(insertAt + 1, 0, `N:${existingN.map(vcardEscape).join(';')}`);
    const emails = Array.isArray(updates.emails_json) && updates.emails_json.length > 0 ? updates.emails_json : (updates.email ? [{ value: updates.email, type: 'INTERNET' }] : []);
    for (const email of emails) {
        if (email.value)
            newLines.splice(insertAt + 2, 0, `EMAIL;TYPE=${email.type || 'INTERNET'}:${vcardEscape(email.value)}`);
    }
    const phones = Array.isArray(updates.phones_json) && updates.phones_json.length > 0 ? updates.phones_json : (updates.phone ? [{ value: updates.phone, type: 'CELL' }] : []);
    for (const phone of phones) {
        if (phone.value)
            newLines.splice(insertAt + 2, 0, `TEL;TYPE=${phone.type || 'CELL'}:${vcardEscape(phone.value)}`);
    }
    if (updates.organization || updates.department) {
        const organization = vcardEscape(updates.organization || '');
        const department = updates.department ? `;${vcardEscape(updates.department)}` : '';
        newLines.splice(insertAt + 2, 0, `ORG:${organization}${department}`);
    }
    if (updates.job_title)
        newLines.splice(insertAt + 2, 0, `TITLE:${vcardEscape(updates.job_title)}`);
    if (updates.notes)
        newLines.splice(insertAt + 2, 0, `NOTE:${vcardEscape(updates.notes)}`);
    if (normalizedBirthday) {
        const vcardBirthday = /^\d{2}-\d{2}$/.test(normalizedBirthday)
            ? `--${normalizedBirthday}`
            : normalizedBirthday;
        newLines.splice(insertAt + 2, 0, `BDAY:${vcardBirthday}`);
    }
    if (updates.photo_url && /^data:image\//.test(updates.photo_url))
        newLines.splice(insertAt + 2, 0, `PHOTO;ENCODING=BASE64;TYPE=JPEG:${updates.photo_url.replace(/^data:image\/[^;]+;base64,/, '')}`);
    if (endIndex < 0)
        newLines.push('END:VCARD');
    return stampVCardRevision(`${newLines.join('\r\n')}\r\n`);
}
function contactEtag(contact) {
    const hash = (0, crypto_1.createHash)('sha1');
    hash.update(String(contact.id));
    hash.update('\0');
    hash.update(getContactDavUid(contact));
    hash.update('\0');
    hash.update(String(contact.sync_token || 0));
    return `"${hash.digest('hex')}"`;
}
async function listContacts(user) {
    await ensureContactsSchema();
    const [rows] = await db_1.pool.query('SELECT * FROM contacts WHERE username = ? AND deleted_at IS NULL ORDER BY is_favorite DESC, name ASC, email ASC, id ASC', [user]);
    return rows;
}
/** @internal Call from an existing contact mutation when a transaction-consistent snapshot is required. */
async function listContactsOnConnection(connection, user) {
    const [rows] = await connection.query('SELECT * FROM contacts WHERE username = ? AND deleted_at IS NULL ORDER BY is_favorite DESC, name ASC, email ASC, id ASC', [user]);
    return rows;
}
async function listContactsUpdatedSince(user, syncToken) {
    await ensureContactsSchema();
    const [rows] = await db_1.pool.query(`SELECT * FROM contacts
         WHERE username = ? AND deleted_at IS NULL AND sync_token > ?
         ORDER BY sync_token ASC, id ASC`, [user, syncToken]);
    return rows;
}
async function listContactTombstonesSince(user, syncToken) {
    await ensureContactsSchema();
    const [rows] = await db_1.pool.query(`SELECT contact_tombstones.*,
                (SELECT MIN(contacts.id)
                 FROM contacts
                 WHERE contacts.username = ?
                   AND contacts.dav_uid COLLATE utf8mb4_unicode_ci = contact_tombstones.dav_uid) AS contact_id
         FROM contact_tombstones
         WHERE username = ? AND sync_token > ?
         ORDER BY sync_token ASC, id ASC`, [user, user, syncToken]);
    return rows;
}
async function listRecentContactTombstones(user) {
    await ensureContactsSchema();
    const [rows] = await db_1.pool.query(`SELECT contact_tombstones.*,
                (SELECT MIN(contacts.id)
                 FROM contacts
                 WHERE contacts.username = ?
                   AND contacts.dav_uid COLLATE utf8mb4_unicode_ci = contact_tombstones.dav_uid) AS contact_id
         FROM contact_tombstones
         WHERE username = ? AND deleted_at > DATE_SUB(NOW(), INTERVAL 30 DAY)
         ORDER BY sync_token ASC, id ASC`, [user, user]);
    return rows;
}
function contactTombstoneDavUids(tombstone) {
    const uids = [normalizeDavUid(tombstone.dav_uid)];
    if (tombstone.contact_id) {
        uids.push(normalizeDavUid(`contact-${tombstone.contact_id}`));
    }
    return Array.from(new Set(uids));
}
function contactSyncTokenVersion(token) {
    if (!token)
        return 0;
    const trimmed = String(token).trim();
    const lastSegment = trimmed.slice(trimmed.lastIndexOf('/') + 1);
    const normalized = lastSegment.startsWith('contacts-') ? lastSegment.slice('contacts-'.length) : lastSegment;
    const parts = normalized.split('-');
    if (parts.length >= 2) {
        const parsed = Number.parseInt(parts[1], 10);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
    }
    const parsed = Number.parseInt(normalized, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}
/** @internal Call only from inside withContactMutation. */
async function nextContactSyncTokenOnConnection(connection, user) {
    const [rows] = await connection.query(`SELECT GREATEST(
                    COALESCE((SELECT MAX(sync_token) FROM contacts WHERE username = ?), 0),
                    COALESCE((SELECT MAX(sync_token) FROM contact_tombstones WHERE username = ?), 0)
                ) + 1 AS next_sync_token`, [user, user]);
    return Number(rows[0]?.next_sync_token || 1);
}
async function getContactByDavUid(user, davUid) {
    await ensureContactsSchema();
    const [rows] = await db_1.pool.query('SELECT * FROM contacts WHERE username = ? AND dav_uid = ? AND deleted_at IS NULL ORDER BY id ASC LIMIT 1', [user, davUid]);
    return rows.length > 0 ? rows[0] : null;
}
/** @internal Call only from inside withContactMutation. */
async function getContactByDavUidOnConnection(connection, user, davUid) {
    const [rows] = await connection.query('SELECT * FROM contacts WHERE username = ? AND dav_uid = ? AND deleted_at IS NULL ORDER BY id ASC LIMIT 1', [user, davUid]);
    return rows.length > 0 ? rows[0] : null;
}
/** Load the exact identity/version fields needed by a locked contact mutation. */
async function getContactMutationMetadataOnConnection(connection, user, davUid) {
    const [rows] = await connection.query(`SELECT id, dav_uid, sync_token, name, email, birthday
         FROM contacts
         WHERE username = ? AND dav_uid = ? AND deleted_at IS NULL
         ORDER BY id ASC LIMIT 1`, [user, normalizeDavUid(davUid)]);
    if (rows.length === 0)
        return null;
    return {
        id: Number(rows[0].id),
        dav_uid: normalizeDavUid(rows[0].dav_uid || davUid),
        sync_token: Number(rows[0].sync_token || 0),
        name: String(rows[0].name || ''),
        email: String(rows[0].email || ''),
        birthday: rows[0].birthday ? String(rows[0].birthday) : null,
    };
}
/** Load only the columns covered by the bounded EAS snapshot on its locked connection. */
async function getEasContactByDavUidOnConnection(connection, user, davUid, expectedSyncToken, expectedSourceBytes) {
    if (!Number.isSafeInteger(expectedSyncToken) || expectedSyncToken < 1
        || !Number.isSafeInteger(expectedSourceBytes) || expectedSourceBytes < 0) {
        return null;
    }
    const sourceBytes = (0, exports.easContactSourceBytesExpression)();
    const [rows] = await connection.query(`SELECT id, username, sync_token, ${exports.EAS_CONTACT_SOURCE_COLUMNS.join(', ')}
         FROM contacts
         WHERE username = ? AND dav_uid = ? AND deleted_at IS NULL
           AND sync_token = ? AND (${sourceBytes}) = ?
         ORDER BY id ASC LIMIT 1`, [user, davUid, expectedSyncToken, expectedSourceBytes]);
    return rows.length > 0 ? rows[0] : null;
}
async function upsertContactTombstone(connection, user, davUid, syncToken) {
    await connection.query(`INSERT INTO contact_tombstones (username, dav_uid, deleted_at, sync_token)
         VALUES (?, ?, NOW(), ?)
         ON DUPLICATE KEY UPDATE deleted_at = NOW(), sync_token = VALUES(sync_token)`, [user, normalizeDavUid(davUid), syncToken]);
}
/** @internal Call only from inside withContactMutation. */
async function recordContactTombstoneOnConnection(connection, user, davUid) {
    const syncToken = await nextContactSyncTokenOnConnection(connection, user);
    await upsertContactTombstone(connection, user, davUid, syncToken);
    return syncToken;
}
async function recordContactTombstone(user, davUid) {
    return withContactMutation(user, connection => recordContactTombstoneOnConnection(connection, user, davUid));
}
async function clearContactTombstone(connection, user, davUid) {
    await connection.query('DELETE FROM contact_tombstones WHERE username = ? AND dav_uid = ?', [user, normalizeDavUid(davUid)]);
}
function escapeContactUidLikePattern(value) {
    return value.replace(/[!%_]/g, character => `!${character}`);
}
/** Resolve only an exact immutable UID stored inside a vCard; never infer identity from mutable fields. */
async function findContactDavUidByVCardUidOnConnection(connection, user, vcardUid) {
    const exactUid = vcardUid.trim();
    if (!exactUid)
        return null;
    const escapedUid = vcardEscape(exactUid);
    const [rows] = await connection.query(`SELECT id, dav_uid, vcard_data
         FROM contacts
         WHERE username = ?
           AND (vcard_data LIKE ? ESCAPE '!' OR vcard_data LIKE ? ESCAPE '!')
         ORDER BY id ASC LIMIT 3
         FOR UPDATE`, [
        user,
        `%${escapeContactUidLikePattern(exactUid)}%`,
        `%${escapeContactUidLikePattern(escapedUid)}%`,
    ]);
    const matches = [];
    for (const row of rows) {
        const storedUid = extractVCardUid(String(row.vcard_data || ''));
        if (storedUid === exactUid)
            matches.push(row);
    }
    if (matches.length > 1 || rows.length >= 3)
        throw new AmbiguousVCardUidError();
    return matches.length === 1 ? normalizeDavUid(matches[0].dav_uid || `contact-${matches[0].id}`) : null;
}
/** @internal Call only from inside withContactMutation. */
async function saveContactFromVCardOnConnection(connection, user, davUid, vcard, expectedSyncToken) {
    const normalizedDavUid = normalizeDavUid(davUid);
    const birthday = extractVCardBirthday(vcard);
    const canonicalVCard = canonicalizeVCardBirthday(vcard, birthday);
    const parsed = parseVCard(canonicalVCard);
    const normalized = stampVCardRevision(normalizeVCardData(canonicalVCard, normalizedDavUid, parsed));
    const emailsJson = parsed.emails && parsed.emails.length > 1
        ? JSON.stringify(parsed.emails.map(value => ({ value, label: 'Other' })))
        : null;
    const phoneItems = parsed.phoneItems || [];
    const phonesJson = phoneItems.length > 1 || phoneItems.some(item => item.types.length > 0)
        ? JSON.stringify(phoneItems.map(item => ({
            value: item.value,
            label: item.label,
            ...(item.types.length > 0 ? { type: item.types.join(',') } : {}),
        })))
        : null;
    const addressesJson = parsed.address
        ? JSON.stringify([{ value: parsed.address, label: 'Other' }])
        : null;
    const [existingRows] = await connection.query(`SELECT id, dav_uid, sync_token, name, email, birthday, deleted_at IS NULL AS is_active
         FROM contacts
         WHERE username = ? AND dav_uid = ?
         ORDER BY deleted_at IS NULL DESC, id ASC LIMIT 1`, [user, normalizedDavUid]);
    const existing = existingRows.length > 0 ? {
        id: Number(existingRows[0].id),
        dav_uid: normalizeDavUid(existingRows[0].dav_uid || normalizedDavUid),
        sync_token: Number(existingRows[0].sync_token || 0),
        name: String(existingRows[0].name || ''),
        email: String(existingRows[0].email || ''),
        birthday: existingRows[0].birthday ? String(existingRows[0].birthday) : null,
    } : null;
    const existingIsActive = Boolean(existing) && Number(existingRows[0].is_active ?? 1) === 1;
    if (expectedSyncToken !== undefined) {
        if (expectedSyncToken === null
            ? existingIsActive
            : !existingIsActive || !existing || Number(existing.sync_token) !== expectedSyncToken) {
            return null;
        }
    }
    const syncToken = await nextContactSyncTokenOnConnection(connection, user);
    if (existing) {
        const [updateResult] = await connection.query(`UPDATE contacts
             SET name = ?,
                 email = ?,
                 phone = ?,
                 vcard_data = ?,
                 emails_json = ?,
                 phones_json = ?,
                 addresses_json = ?,
                 job_title = ?,
                 organization = ?,
                 notes = ?,
                 first_name = ?,
                 last_name = ?,
                 middle_name = ?,
                 prefix = ?,
                 suffix = ?,
                 nickname = ?,
                 department = ?,
                 birthday = ?,
                 website_url = ?,
                 deleted_at = NULL,
                 sync_token = ?
             WHERE id = ? AND username = ?${expectedSyncToken === undefined
            ? ''
            : expectedSyncToken === null
                ? ' AND deleted_at IS NOT NULL'
                : ' AND sync_token = ? AND deleted_at IS NULL'}`, [
            parsed.name || '',
            parsed.email || '',
            parsed.phone || '',
            normalized,
            emailsJson,
            phonesJson,
            addressesJson,
            parsed.title || null,
            parsed.organization || null,
            parsed.note || null,
            parsed.firstName || null,
            parsed.lastName || null,
            parsed.middleName || null,
            parsed.prefix || null,
            parsed.suffix || null,
            parsed.nickname || null,
            parsed.department || null,
            parsed.birthday || null,
            parsed.websiteUrl || null,
            syncToken,
            existing.id,
            user,
            ...(typeof expectedSyncToken === 'number' ? [expectedSyncToken] : []),
        ]);
        if (expectedSyncToken !== undefined && !updateResult.affectedRows)
            return null;
        await clearContactTombstone(connection, user, normalizedDavUid);
        const contact = {
            id: existing.id,
            dav_uid: normalizedDavUid,
            sync_token: syncToken,
            name: parsed.name || '',
            email: parsed.email || '',
            birthday: parsed.birthday || null,
        };
        await (0, birthday_calendar_1.syncContactBirthdayEvent)(connection, user, birthdayIdentityFromContact(contact), contact.birthday, [birthdayIdentityFromContact(existing), birthdayIdentityFromContact(contact)]);
        return { contact, created: !existingIsActive };
    }
    const [result] = await connection.query(`INSERT INTO contacts
         (username, name, email, phone, vcard_data, dav_uid, sync_token,
          emails_json, phones_json, addresses_json, job_title, organization, notes,
          first_name, last_name, middle_name, prefix, suffix, nickname, department, birthday, website_url)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
        user,
        parsed.name || '',
        parsed.email || '',
        parsed.phone || '',
        normalized,
        normalizedDavUid,
        syncToken,
        emailsJson,
        phonesJson,
        addressesJson,
        parsed.title || null,
        parsed.organization || null,
        parsed.note || null,
        parsed.firstName || null,
        parsed.lastName || null,
        parsed.middleName || null,
        parsed.prefix || null,
        parsed.suffix || null,
        parsed.nickname || null,
        parsed.department || null,
        parsed.birthday || null,
        parsed.websiteUrl || null,
    ]);
    const contact = {
        id: Number(result.insertId),
        dav_uid: normalizedDavUid,
        sync_token: syncToken,
        name: parsed.name || '',
        email: parsed.email || '',
        birthday: parsed.birthday || null,
    };
    await (0, birthday_calendar_1.syncContactBirthdayEvent)(connection, user, birthdayIdentityFromContact(contact), contact.birthday);
    return { contact, created: true };
}
async function saveContactFromVCard(user, davUid, vcard, expectedSyncToken) {
    await ensureContactsSchema();
    return withContactMutation(user, connection => saveContactFromVCardOnConnection(connection, user, davUid, vcard, expectedSyncToken));
}
/** @internal Call only from inside withContactMutation. */
async function deleteContactByDavUidOnConnection(connection, user, davUid, expectedSyncToken) {
    const normalizedDavUid = normalizeDavUid(davUid);
    const [rows] = await connection.query(`SELECT id, dav_uid, sync_token, name, email, birthday
         FROM contacts
         WHERE username = ? AND dav_uid = ? AND deleted_at IS NULL
         ORDER BY id ASC LIMIT 1`, [user, normalizedDavUid]);
    if (rows.length === 0)
        return false;
    const contact = {
        id: Number(rows[0].id),
        dav_uid: normalizeDavUid(rows[0].dav_uid || normalizedDavUid),
        sync_token: Number(rows[0].sync_token || 0),
        name: String(rows[0].name || ''),
        email: String(rows[0].email || ''),
        birthday: rows[0].birthday ? String(rows[0].birthday) : null,
    };
    if (expectedSyncToken !== undefined && contact.sync_token !== expectedSyncToken)
        return false;
    const syncToken = await nextContactSyncTokenOnConnection(connection, user);
    const [result] = await connection.query(`UPDATE contacts SET deleted_at = NOW(), sync_token = ?
         WHERE id = ? AND username = ? AND deleted_at IS NULL${expectedSyncToken === undefined ? '' : ' AND sync_token = ?'}`, [syncToken, contact.id, user, ...(expectedSyncToken === undefined ? [] : [expectedSyncToken])]);
    if (result.affectedRows > 0) {
        await upsertContactTombstone(connection, user, normalizedDavUid, syncToken);
        const identity = birthdayIdentityFromContact(contact);
        await (0, birthday_calendar_1.syncContactBirthdayEvent)(connection, user, identity, null, [identity]);
    }
    return result.affectedRows > 0;
}
async function deleteContactByDavUid(user, davUid, expectedSyncToken) {
    await ensureContactsSchema();
    return withContactMutation(user, connection => deleteContactByDavUidOnConnection(connection, user, davUid, expectedSyncToken));
}
async function softDeleteContactById(user, id) {
    await ensureContactsSchema();
    return withContactMutation(user, async (connection) => {
        const [rows] = await connection.query('SELECT id, dav_uid FROM contacts WHERE id = ? AND username = ? AND deleted_at IS NULL LIMIT 1', [id, user]);
        if (rows.length === 0)
            return false;
        const davUid = rows[0].dav_uid || `contact-${rows[0].id}`;
        const syncToken = await nextContactSyncTokenOnConnection(connection, user);
        const [result] = await connection.query('UPDATE contacts SET dav_uid = ?, deleted_at = NOW(), sync_token = ? WHERE id = ? AND username = ? AND deleted_at IS NULL', [davUid, syncToken, rows[0].id, user]);
        if (result.affectedRows > 0) {
            await upsertContactTombstone(connection, user, davUid, syncToken);
        }
        return result.affectedRows > 0;
    });
}
async function softDeleteContactsByIds(user, ids) {
    await ensureContactsSchema();
    if (ids.length === 0)
        return 0;
    return withContactMutation(user, async (connection) => {
        const placeholders = ids.map(() => '?').join(',');
        const [rows] = await connection.query(`SELECT id, dav_uid FROM contacts WHERE id IN (${placeholders}) AND username = ? AND deleted_at IS NULL`, [...ids, user]);
        if (rows.length === 0)
            return 0;
        const syncToken = await nextContactSyncTokenOnConnection(connection, user);
        const activeIds = rows.map((row) => row.id);
        const activePlaceholders = activeIds.map(() => '?').join(',');
        const [result] = await connection.query(`UPDATE contacts SET deleted_at = NOW(), sync_token = ? WHERE id IN (${activePlaceholders}) AND username = ? AND deleted_at IS NULL`, [syncToken, ...activeIds, user]);
        for (const row of rows) {
            await upsertContactTombstone(connection, user, row.dav_uid || `contact-${row.id}`, syncToken);
        }
        return Number(result.affectedRows || 0);
    });
}
async function restoreContactById(user, id) {
    await ensureContactsSchema();
    return withContactMutation(user, async (connection) => {
        const [rows] = await connection.query('SELECT id, dav_uid FROM contacts WHERE id = ? AND username = ? AND deleted_at IS NOT NULL LIMIT 1', [id, user]);
        if (rows.length === 0)
            return false;
        const davUid = rows[0].dav_uid || `contact-${rows[0].id}`;
        const syncToken = await nextContactSyncTokenOnConnection(connection, user);
        const [result] = await connection.query('UPDATE contacts SET dav_uid = ?, deleted_at = NULL, sync_token = ? WHERE id = ? AND username = ? AND deleted_at IS NOT NULL', [davUid, syncToken, rows[0].id, user]);
        if (result.affectedRows > 0) {
            await clearContactTombstone(connection, user, davUid);
        }
        return result.affectedRows > 0;
    });
}
async function purgeExpiredContacts(user) {
    await ensureContactsSchema();
    return withContactMutation(user, async (connection) => {
        const [result] = await connection.query('DELETE FROM contacts WHERE username = ? AND deleted_at IS NOT NULL AND deleted_at < NOW() - INTERVAL 30 DAY', [user]);
        return Number(result.affectedRows || 0);
    });
}
async function addressBookSyncToken(user) {
    await ensureContactsSchema();
    const [rows] = await db_1.pool.query(`SELECT
            (SELECT COUNT(*) FROM contacts WHERE username = ? AND deleted_at IS NULL) AS contact_count,
            GREATEST(
                COALESCE((SELECT MAX(sync_token) FROM contacts WHERE username = ?), 1),
                COALESCE((SELECT MAX(sync_token) FROM contact_tombstones WHERE username = ?), 1)
            ) AS max_sync_token,
            GREATEST(
                COALESCE((SELECT UNIX_TIMESTAMP(MAX(updated_at)) FROM contacts WHERE username = ?), 1),
                COALESCE((SELECT UNIX_TIMESTAMP(MAX(deleted_at)) FROM contact_tombstones WHERE username = ?), 1)
            ) AS max_updated_at`, [user, user, user, user, user]);
    const row = rows[0] || {};
    return `${row.contact_count || 0}-${row.max_sync_token || 1}-${row.max_updated_at || 1}`;
}
async function getContactCollectionRevisionOnConnection(connection, user) {
    const [rows] = await connection.query(`SELECT GREATEST(
            COALESCE((SELECT MAX(sync_token) FROM contacts WHERE username = ?), 1),
            COALESCE((SELECT MAX(sync_token) FROM contact_tombstones WHERE username = ?), 1)
        ) AS collection_revision`, [user, user]);
    const revision = String(rows[0]?.collection_revision ?? '');
    if (!/^\d+$/.test(revision))
        throw new Error('Contact collection revision is malformed');
    return revision;
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